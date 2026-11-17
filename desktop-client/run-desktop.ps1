# Desktop client launcher (UTF-8). Called by 一键运行.bat via ASCII path run-desktop.ps1
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if (-not $PSScriptRoot) {
  $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Set-Location -LiteralPath $PSScriptRoot

function PauseExit([int]$code) {
  Write-Host ''
  Write-Host 'Press Enter to close...' -ForegroundColor Yellow
  Read-Host | Out-Null
  exit $code
}

Write-Host "[LCP] Working directory: $((Get-Location).Path)"

function Import-LocalEnvBatFile([string]$localBat) {
  if (-not (Test-Path -LiteralPath $localBat)) { return }
  Write-Host "[LCP] Sourcing $(Split-Path -Leaf $localBat) ..." -ForegroundColor DarkGray
  $envDump = cmd.exe /c "call `"$localBat`" >nul 2>nul && set" 2>$null
  if ($envDump) {
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
}

Import-LocalEnvBatFile (Join-Path $PSScriptRoot 'local-env.bat')
$repoRoot = Split-Path -Parent $PSScriptRoot
Import-LocalEnvBatFile (Join-Path $repoRoot 'local-env.bat')

# If desktop has no API env, derive from deploy SERVER_HOST (release-new-version.bat).
if (-not $env:LCP_WEB_ORIGIN -and -not $env:LCP_API_BASE_URL -and $env:SERVER_HOST) {
  $hostOnly = ($env:SERVER_HOST -replace '^https?://', '').TrimEnd('/')
  if ($hostOnly) {
    $env:LCP_API_BASE_URL = "http://${hostOnly}:8000"
    Write-Host "[LCP] LCP_API_BASE_URL from SERVER_HOST => $env:LCP_API_BASE_URL" -ForegroundColor DarkGray
  }
}

if (-not $env:LCP_MATERIAL_ASSETS_ROOT) {
  . (Join-Path $PSScriptRoot 'resolve-nas-smb.ps1')
  $cfg = Resolve-LcpNasSmbConfig
  $env:LCP_MATERIAL_ASSETS_ROOT = $cfg.MaterialAssetsRoot
  Write-Host "[LCP] LCP_MATERIAL_ASSETS_ROOT => $env:LCP_MATERIAL_ASSETS_ROOT (NAS $($cfg.NasHost), not DEPLOY_LAN HTTP host)" -ForegroundColor DarkGray
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json'))) {
  Write-Host '[LCP] ERROR: package.json not found. Put scripts in desktop-client folder.' -ForegroundColor Red
  PauseExit 1
}

$candidates = @(
  (Join-Path $env:ProgramFiles 'nodejs'),
  (Join-Path $env:LOCALAPPDATA 'Programs\node')
)
$pfx86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)', 'Process')
if ($pfx86) {
  $candidates += (Join-Path $pfx86 'nodejs')
}
foreach ($dir in $candidates) {
  if (-not $dir) { continue }
  $nodeExe = Join-Path $dir 'node.exe'
  if (Test-Path -LiteralPath $nodeExe) {
    $env:PATH = "$dir;$env:PATH"
    Write-Host "[LCP] Prepended Node to PATH: $dir"
    break
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[LCP] ERROR: node not found. Install Node.js LTS and add to PATH, then reopen Explorer.' -ForegroundColor Red
  PauseExit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[LCP] ERROR: npm not found. Reinstall Node.js.' -ForegroundColor Red
  PauseExit 1
}

try {
  Write-Host "[LCP] Node $(& node -v 2>$null)"
  Write-Host "[LCP] npm  $(& npm -v 2>$null)"
} catch {
  Write-Host '[LCP] WARN: Could not read node/npm version.' -ForegroundColor DarkYellow
}

Write-Host ''

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-nas-smb.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host '[LCP] NAS SMB login failed. Fix NAS_PASSWORD in repo local-env.bat or run map-nas-z-drive.bat.' -ForegroundColor Red
  PauseExit 1
}

Write-Host ''

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host '[LCP] node_modules missing, running npm install ...' -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[LCP] npm install FAILED.' -ForegroundColor Red
    PauseExit 1
  }
  Write-Host ''
}

Write-Host '[LCP] Starting npm run electron:dev ...' -ForegroundColor Cyan
Write-Host ''

npm run electron:dev
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }

Write-Host ''
Write-Host "[LCP] Exit code: $exitCode"

PauseExit $exitCode
