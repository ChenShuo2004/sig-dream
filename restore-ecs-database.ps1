# Upload a local pg_dump plain-SQL file to ECS and restore into DATABASE_URL from remote backend/.env.
# Does NOT run deploy.sh or git. Requires remote backend/.env and backend/.venv (run release-new-version.bat first on a new ECS).
#
# If restore fails with "relation ... already exists", the target DB already has schema/data from a prior deploy.
# Re-run with -WipePublicSchemaFirst or set env DEPLOY_PG_RESTORE_WIPE=1 (destructive: drops entire public schema).

param(
  [string]$SqlPath = "",
  [string]$ServerUser = "root",
  [string]$ServerHost = "",
  [string]$RemoteAppDir = "/root/apps/light_content_workflow_platform",
  [string]$SshIdentityFile = "",
  [bool]$SshInteractivePassword = $false,
  [switch]$WipePublicSchemaFirst = $false
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ([string]::IsNullOrWhiteSpace($SqlPath) -and $null -ne $env:DEPLOY_PG_DUMP_SQL) {
  $SqlPath = "$($env:DEPLOY_PG_DUMP_SQL)".Trim().Trim('"')
}
if ([string]::IsNullOrWhiteSpace($SqlPath)) {
  throw "SqlPath is required (argument -SqlPath or env DEPLOY_PG_DUMP_SQL)."
}

if ([string]::IsNullOrWhiteSpace($SshIdentityFile) -and $env:DEPLOY_SSH_IDENTITY_FILE) {
  $SshIdentityFile = $env:DEPLOY_SSH_IDENTITY_FILE.Trim().Trim('"')
}
if (-not $SshInteractivePassword) {
  $rawInteractive = if ($null -ne $env:DEPLOY_SSH_INTERACTIVE) { $env:DEPLOY_SSH_INTERACTIVE.Trim() } else { "" }
  if ($rawInteractive -in @("1", "true", "yes", "Y", "y")) {
    $SshInteractivePassword = $true
  }
}

if (-not $WipePublicSchemaFirst) {
  $rawWipe = if ($null -ne $env:DEPLOY_PG_RESTORE_WIPE) { $env:DEPLOY_PG_RESTORE_WIPE.Trim() } else { "" }
  if ($rawWipe -in @("1", "true", "yes", "Y", "y")) {
    $WipePublicSchemaFirst = $true
  }
}

function Escape-ForBashSingleQuotedContent([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  return $s.Replace("'", "'\''")
}

function Format-NativeCommandOutputLines($raw) {
  if ($null -eq $raw) { return "" }
  $lines = @()
  foreach ($item in @($raw)) {
    if ($item -is [System.Management.Automation.ErrorRecord]) {
      $lines += $item.Exception.Message
    } else {
      $lines += "$item"
    }
  }
  return ($lines -join [Environment]::NewLine).Trim()
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$StdinFile = $null,
    [int]$RetryCount = 1,
    [int]$RetryDelaySec = 5,
    [switch]$StreamOutput
  )
  $useStdinFile = $PSBoundParameters.ContainsKey("StdinFile") -and -not [string]::IsNullOrWhiteSpace($StdinFile)
  $attempt = 1
  while ($attempt -le [Math]::Max(1, $RetryCount)) {
    Write-Host ">> $FilePath $($Arguments -join ' ') (attempt $attempt/$RetryCount)"
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      if ($useStdinFile) {
        if (-not (Test-Path -LiteralPath $StdinFile)) {
          throw "Invoke-Native: StdinFile not found: $StdinFile"
        }
        $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -RedirectStandardInput $StdinFile -NoNewWindow -Wait -PassThru
        $exitCode = $proc.ExitCode
        $out = @()
      } elseif ($StreamOutput) {
        & $FilePath @Arguments
        $out = @()
        $exitCode = $LASTEXITCODE
      } else {
        $out = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
      }
    } finally {
      $ErrorActionPreference = $oldEap
    }
    $text = Format-NativeCommandOutputLines $out
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      Write-Host $text
    }
    if ($exitCode -eq 0) {
      return $text
    }
    if ($attempt -lt $RetryCount) {
      Write-Host "Command failed (exit $exitCode). Retrying in ${RetryDelaySec}s..." -ForegroundColor Yellow
      Start-Sleep -Seconds $RetryDelaySec
      $attempt += 1
      continue
    }
    throw "Command failed (exit $exitCode): $FilePath $($Arguments -join ' ')`n$text"
  }
}

function Get-SshPrefixArgs {
  $prefix = [System.Collections.Generic.List[string]]::new()
  if (-not [string]::IsNullOrWhiteSpace($SshIdentityFile)) {
    $keyPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SshIdentityFile.Trim())
    if (-not (Test-Path -LiteralPath $keyPath)) {
      throw "SshIdentityFile not found: $SshIdentityFile (resolved: $keyPath)"
    }
    $prefix.Add("-i")
    $prefix.Add($keyPath)
  }
  if (-not $SshInteractivePassword) {
    $prefix.Add("-o")
    $prefix.Add("BatchMode=yes")
  }
  $prefix.AddRange(
    [string[]]@(
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=12",
      "-o", "ServerAliveInterval=10",
      "-o", "ServerAliveCountMax=3"
    )
  )
  return $prefix
}

Write-Host "`n== Restore PostgreSQL dump to ECS (no deploy) ==" -ForegroundColor Cyan
Write-Host "Target: ${ServerUser}@${ServerHost}  App: $RemoteAppDir" -ForegroundColor DarkGray
if ($WipePublicSchemaFirst) {
  Write-Host "WipePublicSchemaFirst: ON (will DROP SCHEMA public CASCADE before import)" -ForegroundColor Yellow
}

$localDump = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SqlPath.Trim().Trim('"'))
if (-not (Test-Path -LiteralPath $localDump)) {
  throw "Sql file not found: $localDump"
}

$sshTarget = "$ServerUser@$ServerHost"
$escapedRemoteAppDir = Escape-ForBashSingleQuotedContent $RemoteAppDir
$remoteDump = "/tmp/light-content-restore-" + [guid]::NewGuid().ToString("n") + ".sql"
$escapedRemoteDump = Escape-ForBashSingleQuotedContent $remoteDump

$scpArgs = [System.Collections.Generic.List[string]]::new()
$scpArgs.AddRange([string[]](Get-SshPrefixArgs))
$scpArgs.AddRange([string[]]@($localDump, "${sshTarget}:${remoteDump}"))
Write-Host ">> scp -> ${sshTarget}:${remoteDump}" -ForegroundColor DarkGray
Invoke-Native -FilePath "scp" -Arguments $scpArgs.ToArray()

$restoreTemplate = @'
set -euo pipefail
REMOTE_ROOT='__REMOTE_APP_DIR__'
REMOTE_SQL='__REMOTE_DUMP_PATH__'
cd "$REMOTE_ROOT/backend"
if [ ! -f .env ]; then echo '[restore][error] backend/.env missing'; exit 1; fi
if [ ! -f "$REMOTE_SQL" ]; then echo '[restore][error] dump file missing on server'; exit 1; fi
if ! command -v psql >/dev/null 2>&1; then echo '[restore][error] psql not in PATH'; exit 1; fi
if head -n 1 "$REMOTE_SQL" | grep -q '^\\restrict '; then
  echo '[restore] stripping leading \\restrict line for psql compatibility'
  tail -n +2 "$REMOTE_SQL" > "${REMOTE_SQL}.tmp"
  mv -f "${REMOTE_SQL}.tmp" "$REMOTE_SQL"
fi
PSQLURL="$(python3 -c "
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8')
for line in text.splitlines():
    s = line.strip()
    if not s or s.startswith('#'):
        continue
    if s.startswith('DATABASE_URL='):
        v = s.split('=', 1)[1].strip().strip('\"').strip(\"'\")
        v = v.replace('postgresql+psycopg://', 'postgresql://').replace('postgresql+psycopg2://', 'postgresql://').replace('postgresql+asyncpg://', 'postgresql://')
        print(v)
        break
else:
    raise SystemExit(2)
")"
if [ -z "$PSQLURL" ]; then echo '[restore][error] DATABASE_URL not found in .env'; exit 1; fi
if [ '__PG_RESTORE_WIPE__' = '1' ]; then
  echo '[restore] wiping schema public (DROP CASCADE) so plain SQL CREATE statements can apply...'
  psql "$PSQLURL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
fi
echo '[restore] applying SQL dump (may take several minutes)...'
psql "$PSQLURL" -v ON_ERROR_STOP=1 -f "$REMOTE_SQL"
echo '[restore] alembic upgrade head'
if [ ! -f .venv/bin/activate ]; then echo '[restore][error] .venv missing'; exit 1; fi
# shellcheck source=/dev/null
source .venv/bin/activate
alembic -c alembic.ini upgrade head
systemctl restart light-content-api 2>/dev/null || true
rm -f "$REMOTE_SQL"
echo '[restore] done'
'@
$wipeFlag = if ($WipePublicSchemaFirst) { "1" } else { "0" }
$restoreScript = $restoreTemplate.Replace("__REMOTE_APP_DIR__", $escapedRemoteAppDir).Replace("__REMOTE_DUMP_PATH__", $escapedRemoteDump).Replace("__PG_RESTORE_WIPE__", $wipeFlag)
$restoreScript = $restoreScript.Replace("`r", "")
$restorePath = Join-Path ([System.IO.Path]::GetTempPath()) ("light-content-pg-restore-" + [guid]::NewGuid().ToString("n") + ".sh")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
  [System.IO.File]::WriteAllText($restorePath, (($restoreScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n", $utf8NoBom)
  $sshRestoreArgs = [System.Collections.Generic.List[string]]::new()
  $sshRestoreArgs.AddRange([string[]](Get-SshPrefixArgs))
  $sshRestoreArgs.AddRange([string[]]@([string]$sshTarget, "bash -s"))
  Invoke-Native -FilePath "ssh" -Arguments $sshRestoreArgs.ToArray() -StdinFile $restorePath -RetryCount 1 -RetryDelaySec 10 -StreamOutput
} finally {
  Remove-Item -LiteralPath $restorePath -Force -ErrorAction SilentlyContinue
}

Write-Host "`nDone. Database restore finished." -ForegroundColor Green
