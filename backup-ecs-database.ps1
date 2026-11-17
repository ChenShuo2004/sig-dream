# SSH to ECS, read backend/.env DATABASE_URL, run pg_dump on the server, download plain SQL to this PC.
# Reuses the same connection settings as deploy-oneclick / restore-ecs-database (local-env.bat optional).

param(
  [string]$ServerUser = "",
  [string]$ServerHost = "",
  [string]$RemoteAppDir = "",
  [string]$SshIdentityFile = "",
  [bool]$SshInteractivePassword = $false,
  # Local directory for the .sql file (default: repo root = script directory)
  [string]$OutputDir = "",
  # Filename prefix (host and timestamp are appended)
  [string]$OutputPrefix = "ecs-db-backup"
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ([string]::IsNullOrWhiteSpace($ServerUser) -and $env:SERVER_USER) { $ServerUser = "$($env:SERVER_USER)".Trim() }
if ([string]::IsNullOrWhiteSpace($ServerHost) -and $env:SERVER_HOST) { $ServerHost = "$($env:SERVER_HOST)".Trim() }
if ([string]::IsNullOrWhiteSpace($RemoteAppDir) -and $env:REMOTE_APP_DIR) { $RemoteAppDir = "$($env:REMOTE_APP_DIR)".Trim() }

if ([string]::IsNullOrWhiteSpace($ServerUser)) { $ServerUser = "root" }
if ([string]::IsNullOrWhiteSpace($ServerHost)) { $ServerHost = "" }
if ([string]::IsNullOrWhiteSpace($RemoteAppDir)) { $RemoteAppDir = "/root/apps/light_content_workflow_platform" }

if ([string]::IsNullOrWhiteSpace($SshIdentityFile) -and $env:DEPLOY_SSH_IDENTITY_FILE) {
  $SshIdentityFile = $env:DEPLOY_SSH_IDENTITY_FILE.Trim().Trim('"')
}
if (-not $SshInteractivePassword) {
  $rawInteractive = if ($null -ne $env:DEPLOY_SSH_INTERACTIVE) { "$($env:DEPLOY_SSH_INTERACTIVE)".Trim() } else { "" }
  if ($rawInteractive -in @("1", "true", "yes", "Y", "y")) {
    $SshInteractivePassword = $true
  }
}

if ([string]::IsNullOrWhiteSpace($OutputDir) -and $env:BACKUP_OUTPUT_DIR) {
  $OutputDir = "$($env:BACKUP_OUTPUT_DIR)".Trim().Trim('"')
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = $PSScriptRoot
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

$outDirResolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir.Trim())
if (-not (Test-Path -LiteralPath $outDirResolved)) {
  New-Item -ItemType Directory -Path $outDirResolved -Force | Out-Null
}

$hostTag = ($ServerHost -replace "[:\\/]", "-")
$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss-fffZ"
$localName = "${OutputPrefix}-${hostTag}-${ts}.sql"
$localPath = Join-Path $outDirResolved $localName

$sshTarget = "$ServerUser@$ServerHost"
$escapedRemoteAppDir = Escape-ForBashSingleQuotedContent $RemoteAppDir.TrimEnd("/")
$remoteDump = "/tmp/light-content-backup-" + [guid]::NewGuid().ToString("n") + ".sql"
$escapedRemoteDump = Escape-ForBashSingleQuotedContent $remoteDump

Write-Host "`n== Backup PostgreSQL from ECS (pg_dump on server, scp to local) ==" -ForegroundColor Cyan
Write-Host "Target: ${sshTarget}  App: $RemoteAppDir" -ForegroundColor DarkGray
Write-Host "Local file: $localPath" -ForegroundColor DarkGray

$backupTemplate = @'
set -euo pipefail
REMOTE_ROOT='__REMOTE_APP_DIR__'
REMOTE_SQL='__REMOTE_DUMP_PATH__'
cd "$REMOTE_ROOT/backend"
if [ ! -f .env ]; then echo '[backup][error] backend/.env missing'; exit 1; fi
if ! command -v pg_dump >/dev/null 2>&1; then echo '[backup][error] pg_dump not in PATH (install postgresql-client on ECS)'; exit 1; fi
if ! command -v python3 >/dev/null 2>&1; then echo '[backup][error] python3 required to parse DATABASE_URL from .env'; exit 1; fi
PGURL="$(python3 -c "
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
if [ -z "$PGURL" ]; then echo '[backup][error] DATABASE_URL not found in .env'; exit 1; fi
echo '[backup] running pg_dump (may take several minutes)...'
pg_dump "$PGURL" -Fp --no-owner --no-acl -f "$REMOTE_SQL"
ls -la "$REMOTE_SQL"
echo '[backup] remote dump ok:' "$REMOTE_SQL"
'@
$backupScript = $backupTemplate.Replace("__REMOTE_APP_DIR__", $escapedRemoteAppDir).Replace("__REMOTE_DUMP_PATH__", $escapedRemoteDump)
$backupScript = $backupScript.Replace("`r", "")
$backupPath = Join-Path ([System.IO.Path]::GetTempPath()) ("light-content-pg-backup-" + [guid]::NewGuid().ToString("n") + ".sh")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
  [System.IO.File]::WriteAllText($backupPath, (($backupScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n", $utf8NoBom)
  $sshArgs = [System.Collections.Generic.List[string]]::new()
  $sshArgs.AddRange([string[]](Get-SshPrefixArgs))
  $sshArgs.AddRange([string[]]@([string]$sshTarget, "bash -s"))
  Invoke-Native -FilePath "ssh" -Arguments $sshArgs.ToArray() -StdinFile $backupPath -RetryCount 1 -RetryDelaySec 10 -StreamOutput
} finally {
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
}

$scpArgs = [System.Collections.Generic.List[string]]::new()
$scpArgs.AddRange([string[]](Get-SshPrefixArgs))
$scpArgs.AddRange([string[]]@("${sshTarget}:${remoteDump}", $localPath))
Write-Host ">> scp <- ${sshTarget}:${remoteDump}" -ForegroundColor DarkGray
Invoke-Native -FilePath "scp" -Arguments $scpArgs.ToArray()

$rmTemplate = @'
set -euo pipefail
rm -f '__REMOTE_DUMP_PATH__'
echo '[backup] removed remote temp file'
'@
$rmScript = $rmTemplate.Replace("__REMOTE_DUMP_PATH__", $escapedRemoteDump).Replace("`r", "")
$rmPath = Join-Path ([System.IO.Path]::GetTempPath()) ("light-content-pg-backup-rm-" + [guid]::NewGuid().ToString("n") + ".sh")
try {
  [System.IO.File]::WriteAllText($rmPath, (($rmScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n", $utf8NoBom)
  $sshRm = [System.Collections.Generic.List[string]]::new()
  $sshRm.AddRange([string[]](Get-SshPrefixArgs))
  $sshRm.AddRange([string[]]@([string]$sshTarget, "bash -s"))
  Invoke-Native -FilePath "ssh" -Arguments $sshRm.ToArray() -StdinFile $rmPath -RetryCount 1 -RetryDelaySec 8
} finally {
  Remove-Item -LiteralPath $rmPath -Force -ErrorAction SilentlyContinue
}

Write-Host "`nDone. Local backup: $localPath" -ForegroundColor Green
