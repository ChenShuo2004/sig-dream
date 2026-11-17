# Run on file PC (or any machine with scp): pull ECS fixed-path DB dump to a local folder.
# release-new-version.bat / deploy-oneclick.ps1 runs pg_dump on ECS + scp before remote deploy.sh by default; use this script for an extra pull without releasing.
# ECS should have run scripts/ecs-backup-db-local.sh at least once (cron or last release). See 2026年5月4日ECS数据库备份到文件机.md.
# Reuses SERVER_USER, SERVER_HOST, DEPLOY_SSH_*, BACKUP_OUTPUT_DIR from local-env.bat like backup-ecs-database.ps1.

param(
  [string]$ServerUser = "",
  [string]$ServerHost = "",
  [string]$SshIdentityFile = "",
  [bool]$SshInteractivePassword = $false,
  [string]$OutputDir = "",
  # Remote file path on ECS (must match ecs-backup-db-local.sh default + BACKUP_DIR)
  [string]$RemoteBackupFile = "",
  [string]$OutputPrefix = "light-content-pulled"
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ([string]::IsNullOrWhiteSpace($ServerUser) -and $env:SERVER_USER) { $ServerUser = "$($env:SERVER_USER)".Trim() }
if ([string]::IsNullOrWhiteSpace($ServerHost) -and $env:SERVER_HOST) { $ServerHost = "$($env:SERVER_HOST)".Trim() }

if ([string]::IsNullOrWhiteSpace($ServerUser)) { $ServerUser = "root" }
if ([string]::IsNullOrWhiteSpace($ServerHost)) { $ServerHost = "" }

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

if ([string]::IsNullOrWhiteSpace($RemoteBackupFile) -and $env:ECS_BACKUP_REMOTE_FILE) {
  $RemoteBackupFile = "$($env:ECS_BACKUP_REMOTE_FILE)".Trim().Trim('"')
}
if ([string]::IsNullOrWhiteSpace($RemoteBackupFile)) {
  $RemoteBackupFile = "/root/light-content-db-backups/light-content-latest.sql"
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
    [string[]]$Arguments = @()
  )
  Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldEap
  }
  $text = Format-NativeCommandOutputLines $out
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    Write-Host $text
  }
  if ($exitCode -ne 0) {
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
Write-Host "`n== Pull DB backup from ECS (scp) ==" -ForegroundColor Cyan
Write-Host "Remote: ${sshTarget}:${RemoteBackupFile}" -ForegroundColor DarkGray
Write-Host "Local:  $localPath" -ForegroundColor DarkGray

$scpArgs = [System.Collections.Generic.List[string]]::new()
$scpArgs.AddRange([string[]](Get-SshPrefixArgs))
$scpArgs.AddRange([string[]]@("${sshTarget}:${RemoteBackupFile}", $localPath))
Invoke-Native -FilePath "scp" -Arguments $scpArgs.ToArray()

Write-Host "`nDone. $localPath" -ForegroundColor Green
