# Pack desktop-client installers (UTF-8). Called by 打包应用程序.bat
param(
  [ValidateSet("win", "mac", "all")]
  [string]$Platform = "all",
  [switch]$PublishGitHub,
  [switch]$TestGitHubTokenOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if (-not $PSScriptRoot) {
  $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Set-Location -LiteralPath $PSScriptRoot

function PauseExit([int]$code) {
  Write-Host ""
  Write-Host "Press Enter to close..." -ForegroundColor Yellow
  Read-Host | Out-Null
  exit $code
}

function Ensure-Node {
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs"),
    (Join-Path $env:LOCALAPPDATA "Programs\node")
  )
  $pfx86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)", "Process")
  if ($pfx86) {
    $candidates += (Join-Path $pfx86 "nodejs")
  }
  foreach ($dir in $candidates) {
    if (-not $dir) { continue }
    $nodeExe = Join-Path $dir "node.exe"
    if (Test-Path -LiteralPath $nodeExe) {
      $env:PATH = "$dir;$env:PATH"
      break
    }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[LCP Pack] ERROR: node not found. Install Node.js LTS." -ForegroundColor Red
    PauseExit 1
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[LCP Pack] ERROR: npm not found." -ForegroundColor Red
    PauseExit 1
  }
}

function Invoke-NpmInstall {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "[LCP Pack] node_modules missing, running npm install ..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed"
    }
  }
  if (-not (Get-Command electron-builder -ErrorAction SilentlyContinue)) {
    Write-Host "[LCP Pack] Installing devDependencies (electron-builder) ..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed"
    }
  }
}

function Write-PackagedLocalSettings {
  $examplePath = Join-Path $PSScriptRoot "local.settings.example.json"
  if (-not (Test-Path -LiteralPath $examplePath)) {
    throw "Missing local.settings.example.json"
  }
  $outDir = Join-Path $PSScriptRoot "build"
  $outPath = Join-Path $outDir "local.settings.json"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null

  $raw = Get-Content -LiteralPath $examplePath -Raw -Encoding UTF8
  $obj = $raw | ConvertFrom-Json

  if ($env:LCP_WEB_ORIGIN) {
    $obj.webOrigin = $env:LCP_WEB_ORIGIN.Trim().TrimEnd("/")
    $obj.apiBaseUrl = ""
    Write-Host "[LCP Pack] Packaged settings: LCP_WEB_ORIGIN -> $($obj.webOrigin)" -ForegroundColor Cyan
  } elseif ($env:LCP_API_BASE_URL) {
    $obj.apiBaseUrl = $env:LCP_API_BASE_URL.Trim().TrimEnd("/")
    $obj.webOrigin = ""
    Write-Host "[LCP Pack] Packaged settings: LCP_API_BASE_URL -> $($obj.apiBaseUrl)" -ForegroundColor Cyan
  } elseif ($env:SERVER_HOST) {
    $hostOnly = ($env:SERVER_HOST.Trim() -replace "^https?://", "").TrimEnd("/")
    if ($hostOnly) {
      $obj.apiBaseUrl = "http://${hostOnly}:8000"
      $obj.webOrigin = ""
      Write-Host "[LCP Pack] Packaged settings: SERVER_HOST -> $($obj.apiBaseUrl)" -ForegroundColor Cyan
    }
  } else {
    Write-Host "[LCP Pack] WARN: No LCP_WEB_ORIGIN / LCP_API_BASE_URL / SERVER_HOST; installer keeps example apiBaseUrl." -ForegroundColor Yellow
  }

  $nasRoot = $null
  if ($env:LCP_MATERIAL_ASSETS_ROOT) {
    $nasRoot = $env:LCP_MATERIAL_ASSETS_ROOT.Trim().TrimEnd("\")
  } else {
    . (Join-Path $PSScriptRoot "resolve-nas-smb.ps1")
    $cfg = Resolve-LcpNasSmbConfig
    $nasRoot = $cfg.MaterialAssetsRoot
    Write-Host "[LCP Pack] NAS SMB host $($cfg.NasHost) (DEPLOY_LAN_* is HTTP only, not used for SMB path)" -ForegroundColor DarkGray
  }
  if ($nasRoot) {
    $obj.material_assets_root = $nasRoot
    $obj.nasMountRoot = $nasRoot
    Write-Host "[LCP Pack] Packaged settings: material_assets_root -> $nasRoot" -ForegroundColor Cyan
  } else {
    Write-Host "[LCP Pack] WARN: Set LCP_MATERIAL_ASSETS_ROOT or DEPLOY_LAN_* in local-env.bat for NAS UNC." -ForegroundColor Yellow
  }

  # LAN installers: UNC only; Z: is per-machine and breaks other PCs.
  if ($obj.material_assets_root -and $obj.material_assets_root.StartsWith("\\")) {
    $obj.nasMountRoot = $obj.material_assets_root
  }
  $json = $obj | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($outPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  Write-Host "[LCP Pack] Wrote $outPath (bundled as resources/local.settings.json)" -ForegroundColor DarkGray
}

function Write-GithubUpdaterToken {
  $outDir = Join-Path $PSScriptRoot "build"
  $outPath = Join-Path $outDir "github-updater-token.txt"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  if (-not $env:GH_TOKEN) {
    if (-not (Test-Path -LiteralPath $outPath)) {
      [System.IO.File]::WriteAllText($outPath, "", [System.Text.UTF8Encoding]::new($false))
    }
    Write-Host "[LCP Pack] WARN: No GH_TOKEN; private repo clients cannot check updates (404)." -ForegroundColor Yellow
    return
  }
  [System.IO.File]::WriteAllText($outPath, $env:GH_TOKEN.Trim(), [System.Text.UTF8Encoding]::new($false))
  Write-Host "[LCP Pack] Wrote github-updater-token.txt for private-repo auto-update" -ForegroundColor Cyan
}

function Write-NasSmbCredentials {
  $outDir = Join-Path $PSScriptRoot "build"
  $outPath = Join-Path $outDir "nas-smb-credentials.json"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  if (-not $env:NAS_PASSWORD) {
    Write-Host "[LCP Pack] WARN: No NAS_PASSWORD; installer will not auto-login SMB." -ForegroundColor Yellow
    return
  }
  . (Join-Path $PSScriptRoot "resolve-nas-smb.ps1")
  $cfg = Resolve-LcpNasSmbConfig
  $nasHostIp = $cfg.NasHost
  $obj = @{
    host     = $nasHostIp
    share    = $cfg.NasShare
    user     = if ($env:NAS_USER) { $env:NAS_USER.Trim() } else { "PA" }
    password = $env:NAS_PASSWORD
  }
  ($obj | ConvertTo-Json) | Set-Content -LiteralPath $outPath -Encoding UTF8
  Write-Host "[LCP Pack] Wrote nas-smb-credentials.json (packaged SMB login for $nasHostIp)" -ForegroundColor Cyan
}

function Invoke-ViteBuild {
  Write-Host "[LCP Pack] Building frontend (vite) ..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "vite build failed"
  }
}

function Invoke-ElectronBuilder([string[]]$BuilderArgs) {
  $cmd = "npx electron-builder --config electron-builder.yml " + ($BuilderArgs -join " ")
  Write-Host "[LCP Pack] $cmd" -ForegroundColor DarkGray
  & npx electron-builder --config electron-builder.yml @BuilderArgs
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed: $($BuilderArgs -join ' ')"
  }
}

# electron-builder / electron-publish only reads GH_TOKEN, not GITHUB_TOKEN alone
function Ensure-GitHubPublishToken {
  if ($env:GH_TOKEN) {
    Write-Host "[LCP Pack] GH_TOKEN is set (length $($env:GH_TOKEN.Length))." -ForegroundColor DarkGray
    return
  }
  if ($env:GITHUB_TOKEN) {
    $env:GH_TOKEN = $env:GITHUB_TOKEN
    Write-Host "[LCP Pack] Mapped GITHUB_TOKEN -> GH_TOKEN for electron-builder." -ForegroundColor DarkGray
    return
  }
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    try {
      $t = (& gh auth token 2>$null | Out-String).Trim()
      if ($t) {
        $env:GH_TOKEN = $t
        Write-Host "[LCP Pack] Using token from: gh auth token" -ForegroundColor DarkGray
        return
      }
    } catch {
      # ignore
    }
  }
  throw @"
GitHub 发布需要 Personal Access Token（环境变量名必须为 GH_TOKEN）。

任选其一：
  1) 编辑 desktop-client\local-env.bat（勿提交）:
     set "GH_TOKEN=ghp_你的完整token"
  2) PowerShell 当前窗口:
     `$env:GH_TOKEN = 'ghp_你的token'
  3) 安装 GitHub CLI 后:
     gh auth login
     （脚本会自动执行 gh auth token）

Token 须以 ghp_ 或 github_pat_ 开头；权限：repo（私有）或 public_repo（公开）。
创建：https://github.com/settings/tokens
"@
}

function Test-GitHubPublishToken {
  Ensure-GitHubPublishToken
  $token = $env:GH_TOKEN.Trim()
  if ($token -notmatch '^(ghp_|github_pat_)') {
    throw "GH_TOKEN must be a GitHub PAT (ghp_ or github_pat_ prefix). Current length: $($token.Length). Edit local-env.bat. https://github.com/settings/tokens"
  }
  $headers = @{
    Authorization = "Bearer $token"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "LCP-Desktop-Pack"
  }
  try {
    $user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -Method Get
    Write-Host "[LCP Pack] GitHub API OK. Logged in as: $($user.login)" -ForegroundColor Green
  } catch {
    $status = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    if ($status -eq 401) {
      throw "GitHub 401 Bad credentials: GH_TOKEN invalid or revoked. git push uses SSH, not GH_TOKEN. Create PAT with repo scope in local-env.bat."
    }
    throw "GitHub API check failed: $($_.Exception.Message)"
  }
}

# 无代码签名证书时跳过自动签名探测（避免 winCodeSign 缓存解压需管理员/开发者模式）
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

Write-Host "[LCP Pack] Working directory: $((Get-Location).Path)"
Write-Host "[LCP Pack] Platform mode: $Platform"
if ($PublishGitHub) {
  Write-Host "[LCP Pack] Publish: GitHub Releases (requires GH_TOKEN or gh auth login)" -ForegroundColor Cyan
}
Write-Host ""

function Import-LocalEnvBatFile([string]$localBat) {
  if (-not (Test-Path -LiteralPath $localBat)) { return }
  Write-Host "[LCP Pack] Sourcing $(Split-Path -Leaf $localBat) ($localBat) ..." -ForegroundColor DarkGray
  $envDump = cmd.exe /c "call `"$localBat`" >nul 2>nul && set" 2>$null
  if ($envDump) {
    foreach ($line in $envDump) {
      $eq = $line.IndexOf("=")
      if ($eq -lt 1) { continue }
      $name = $line.Substring(0, $eq).Trim()
      $value = $line.Substring($eq + 1)
      if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
        Set-Item -Path "Env:$name" -Value $value
      }
    }
  }
}

function Import-LocalEnvBat {
  Import-LocalEnvBatFile (Join-Path $PSScriptRoot "local-env.bat")
  $repoRoot = Split-Path -Parent $PSScriptRoot
  Import-LocalEnvBatFile (Join-Path $repoRoot "local-env.bat")
  if ($env:GH_TOKEN -and $env:GH_TOKEN.Trim() -notmatch '^(ghp_|github_pat_)') {
    Write-Host "[LCP Pack] WARNING: GH_TOKEN is not a GitHub PAT (git push over SSH does not set this). Ignoring invalid GH_TOKEN." -ForegroundColor Yellow
    Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  }
}

Import-LocalEnvBat

if ($TestGitHubTokenOnly) {
  try {
    Test-GitHubPublishToken
    PauseExit 0
  } catch {
    Write-Host ""
    Write-Host "[LCP Pack] FAILED: $($_.Exception.Message)" -ForegroundColor Red
    PauseExit 1
  }
}

if ($PublishGitHub) {
  try {
    Test-GitHubPublishToken
  } catch {
    Write-Host ""
    Write-Host "[LCP Pack] FAILED: $($_.Exception.Message)" -ForegroundColor Red
    PauseExit 1
  }
}

Ensure-Node
Write-Host "[LCP Pack] Node $(& node -v)"
Write-Host "[LCP Pack] npm  $(& npm -v)"
Write-Host ""

try {
  Invoke-NpmInstall
  Invoke-ViteBuild
  Write-PackagedLocalSettings
  Write-GithubUpdaterToken
  Write-NasSmbCredentials

  $releaseDir = Join-Path $PSScriptRoot "release"
  $isWindows = $env:OS -match "Windows" -or $PSVersionTable.Platform -eq "Win32NT"
  $isMac = $PSVersionTable.OS -match "Darwin" -or (Get-Command sw_vers -ErrorAction SilentlyContinue)

  $buildWin = $Platform -eq "win" -or $Platform -eq "all"
  $buildMac = $Platform -eq "mac" -or $Platform -eq "all"
  $publishArgs = @()
  if ($PublishGitHub) {
    $publishArgs = @("--publish", "always")
  }

  if ($buildWin) {
    if ($isMac -and -not $isWindows) {
      Write-Host "[LCP Pack] Building Windows x64 (on macOS, may require Wine for NSIS) ..." -ForegroundColor Cyan
    } else {
      Write-Host "[LCP Pack] [1/2] Building Windows x64 (NSIS + ZIP) ..." -ForegroundColor Cyan
    }
    $winArgs = @("--win", "--x64") + $publishArgs
    Invoke-ElectronBuilder $winArgs
    Write-Host "[LCP Pack] Windows artifacts -> release\" -ForegroundColor Green
  }

  if ($buildMac) {
    if ($isMac) {
      Write-Host "[LCP Pack] [2/2] Building macOS x64 + arm64 (DMG + ZIP) ..." -ForegroundColor Cyan
      $macArgs = @("--mac", "--x64", "--arm64") + $publishArgs
      Invoke-ElectronBuilder $macArgs
      Write-Host "[LCP Pack] macOS artifacts -> release\" -ForegroundColor Green
    } else {
      Write-Host ""
      Write-Host "[LCP Pack] SKIP macOS: DMG/ZIP must be built on a Mac (Apple code sign / Xcode toolchain)." -ForegroundColor Yellow
      Write-Host "[LCP Pack] On macOS, in desktop-client run: ./打包应用程序-mac.sh" -ForegroundColor Yellow
      Write-Host "[LCP Pack] Or: npm run dist:mac" -ForegroundColor Yellow
    }
  }

  Write-Host ""
  Write-Host "[LCP Pack] Done. Output folder:" -ForegroundColor Green
  Write-Host "  $releaseDir"
  if (Test-Path -LiteralPath $releaseDir) {
    Get-ChildItem -LiteralPath $releaseDir -File | ForEach-Object {
      Write-Host ("  - " + $_.Name)
    }
  }
  PauseExit 0
} catch {
  Write-Host ""
  Write-Host "[LCP Pack] FAILED: $($_.Exception.Message)" -ForegroundColor Red
  PauseExit 1
}
