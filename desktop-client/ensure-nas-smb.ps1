# Ensure SMB session for NAS UNC (and optional Z: map). Reads repo/desktop local-env.bat or resources\nas-smb-credentials.json
$ErrorActionPreference = 'Continue'

if (-not $PSScriptRoot) {
  $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Import-LocalEnvBatFile([string]$localBat) {
  if (-not (Test-Path -LiteralPath $localBat)) { return }
  $envDump = cmd.exe /c "call `"$localBat`" >nul 2>nul && set" 2>$null
  if (-not $envDump) { return }
  foreach ($line in $envDump) {
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1)
    if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

function Read-PackagedNasCredentials {
  $roots = @($PSScriptRoot, (Split-Path -Parent $PSScriptRoot))
  foreach ($r in $roots) {
    $fp = Join-Path $r "nas-smb-credentials.json"
    if (-not (Test-Path -LiteralPath $fp)) { continue }
    try {
      return Get-Content -LiteralPath $fp -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
      Write-Host "[LCP NAS] WARN: invalid $fp"
    }
  }
  $res = $env:RESOURCES_PATH
  if ($res) {
    $fp2 = Join-Path $res "nas-smb-credentials.json"
    if (Test-Path -LiteralPath $fp2) {
      try {
        return Get-Content -LiteralPath $fp2 -Raw -Encoding UTF8 | ConvertFrom-Json
      } catch { }
    }
  }
  return $null
}

function Start-CmdKeyAdd([string]$Target, [string]$User, [string]$Pass) {
  $keyArgs = @("/add:$Target", "/user:$User", "/pass:$Pass")
  $p = Start-Process -FilePath "cmdkey.exe" -ArgumentList $keyArgs -Wait -PassThru -NoNewWindow
  return $p.ExitCode
}

Import-LocalEnvBatFile (Join-Path $PSScriptRoot 'local-env.bat')
$repoRoot = Split-Path -Parent $PSScriptRoot
Import-LocalEnvBatFile (Join-Path $repoRoot 'local-env.bat')

$mapScript = Join-Path $PSScriptRoot '_nas-share-map.ps1'
if (-not (Test-Path -LiteralPath $mapScript)) {
  $mapScript = Join-Path $repoRoot 'nas-client\_nas-share-map.ps1'
}
if (-not (Test-Path -LiteralPath $mapScript)) {
  Write-Host "[LCP NAS] ERROR: missing $mapScript"
  exit 1
}
. $mapScript
. (Join-Path $PSScriptRoot 'resolve-nas-smb.ps1')

$pack = Read-PackagedNasCredentials

$nasHost = ''
$nasShare = 'nas-file'
$nasUser = 'PA'
$nasPass = ''

if ($pack) {
  if ($pack.host) { $nasHost = [string]$pack.host.Trim() }
  if ($pack.share) { $nasShare = [string]$pack.share.Trim() }
  if ($pack.user) { $nasUser = [string]$pack.user.Trim() }
  if ($pack.password) { $nasPass = [string]$pack.password }
}

if (-not $nasHost) {
  if ($env:NAS_HOST) { $nasHost = $env:NAS_HOST.Trim() }
  else {
    $cfg = Resolve-LcpNasSmbConfig
    $nasHost = $cfg.NasHost
    if (-not $env:NAS_SHARE) { $nasShare = $cfg.NasShare }
  }
}

if (-not $nasPass) { $nasPass = [Environment]::GetEnvironmentVariable('NAS_PASSWORD', 'Process') }
if ($env:NAS_SHARE) { $nasShare = $env:NAS_SHARE.Trim() }
if ($env:NAS_USER) { $nasUser = $env:NAS_USER.Trim() }
$mapDrive = if ($env:NAS_MAP_DRIVE) { $env:NAS_MAP_DRIVE.Trim() } else { 'Z:' }

if (-not $nasHost) {
  Write-Host '[LCP NAS] ERROR: Set NAS_HOST or LCP_MATERIAL_ASSETS_ROOT (SMB NAS host).'
  exit 1
}

if (-not $nasPass) {
  Write-Host '[LCP NAS] ERROR: NAS_PASSWORD not set. Edit repo local-env.bat or run 映射NAS-Z盘.bat after setting it.'
  exit 1
}

# Match nas-client worker: /user:PA (or HOST\USER if you set NAS_USER that way)
$cmdKeyUser = $nasUser
if ($nasUser -notmatch '\\') {
  $cmdKeyUser = "$nasHost\$nasUser"
}

$uncShare = "\\$nasHost\$nasShare"

Write-Host "[LCP NAS] SMB login: $uncShare"
Write-Host "[LCP NAS] User: $nasUser (cmdkey: $cmdKeyUser)"

Start-CmdKeyAdd -Target $nasHost -User $cmdKeyUser -Pass $nasPass | Out-Null

$shareOk = $false
try {
  Connect-NasUncShare -NasShare $uncShare -NasUser $nasUser -NasPassword $nasPass
  Write-Host "[LCP NAS] OK: share session $uncShare"
  $shareOk = $true
} catch {
  Write-Host "[LCP NAS] WARN: $($_.Exception.Message)"
}

if ($env:LCP_SKIP_NAS_DRIVE_MAP -eq '1') {
  if ($shareOk) { exit 0 }
  exit 1
}

cmd /c "net use $mapDrive /delete /y" 2>$null | Out-Null
try {
  Repair-NasNetUse -NasShare $uncShare -NasDrive $mapDrive -NasUser $nasUser -NasPassword $nasPass
  Write-Host "[LCP NAS] OK: $mapDrive -> $uncShare"
  Write-Host "[LCP NAS] Test in Explorer: $mapDrive\material-assets"
  exit 0
} catch {
  Write-Host "[LCP NAS] WARN: drive map failed: $($_.Exception.Message)"
  if ($shareOk) {
    Write-Host "[LCP NAS] OK: UNC works without $mapDrive (desktop app uses UNC path)."
    exit 0
  }
  Write-Host "[LCP NAS] ERROR: SMB login failed. Set NAS_PASSWORD or nas-smb-credentials.json in this folder."
  exit 1
}
