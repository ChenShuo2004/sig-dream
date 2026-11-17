# One-click deploy script (run locally)
# Flow: git add/commit/push -> optional ECS pg_dump + scp to local BEFORE deploy.sh -> ssh run deploy.sh -> quick checks
# Integrated DB backup: BACKUP_OUTPUT_DIR; skip with DEPLOY_POST_RELEASE_DB_BACKUP=0 (runs pre-deploy so a bad deploy does not lose the last good dump pull)

param(
  [string]$CommitMessage = "chore: one-click deploy",
  [string]$ServerUser = "root",
  [string]$ServerHost = "",
  [string]$RemoteAppDir = "/root/apps/light_content_workflow_platform",
  [string]$BuildVersion = "",
  [switch]$SkipCommit,
  # Private key for ECS (recommended). If empty, ssh uses default agent / %USERPROFILE%\.ssh\id_* .
  [string]$SshIdentityFile = "",
  # When true: omit BatchMode=yes so ssh can prompt for password (run from an interactive console).
  [bool]$SshInteractivePassword = $false,
  # If present: if RemoteAppDir is missing on the server, run git clone from current origin (after push). Same when env DEPLOY_REMOTE_AUTO_CLONE=1.
  [switch]$RemoteAutoCloneIfMissing,
  # After a successful deploy: merge this value into remote backend/.env as NAS_CLIENT_TOKEN=... and restart light-content-api. Also reads env DEPLOY_NAS_CLIENT_TOKEN or first line of nas-client/nas-client-token.txt when empty.
  [string]$NasClientTokenForRemoteEnv = ""
)

$ErrorActionPreference = "Stop"
# Prevent native command stderr warnings (e.g. git CRLF warning)
# from being treated as terminating PowerShell errors.
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# Optional: set in local-env.bat (same cmd session) before calling release-new-version.bat / one-click migrate .bat
if ([string]::IsNullOrWhiteSpace($SshIdentityFile) -and $env:DEPLOY_SSH_IDENTITY_FILE) {
  $SshIdentityFile = $env:DEPLOY_SSH_IDENTITY_FILE.Trim().Trim('"')
}
if (-not $SshInteractivePassword) {
  $rawInteractive = if ($null -ne $env:DEPLOY_SSH_INTERACTIVE) { $env:DEPLOY_SSH_INTERACTIVE.Trim() } else { "" }
  if ($rawInteractive -in @("1", "true", "yes", "Y", "y")) {
    $SshInteractivePassword = $true
  }
}
$useRemoteAutoCloneIfMissing = [bool](
  $RemoteAutoCloneIfMissing.IsPresent -or ($env:DEPLOY_REMOTE_AUTO_CLONE -match '^(1|true|yes|Y|y)$')
)
$bootstrapPostgresFlag = "0"
if ($env:DEPLOY_BOOTSTRAP_POSTGRES -match '^(1|true|yes|Y|y)$') {
  $bootstrapPostgresFlag = "1"
}
if ([string]::IsNullOrWhiteSpace($NasClientTokenForRemoteEnv) -and $null -ne $env:DEPLOY_NAS_CLIENT_TOKEN) {
  $NasClientTokenForRemoteEnv = "$($env:DEPLOY_NAS_CLIENT_TOKEN)".Trim().Trim('"').TrimStart([char]0xFEFF)
}
if ([string]::IsNullOrWhiteSpace($NasClientTokenForRemoteEnv)) {
  $nasTokFile = Join-Path $PSScriptRoot "nas-client\nas-client-token.txt"
  if (Test-Path -LiteralPath $nasTokFile) {
    try {
      $NasClientTokenForRemoteEnv = (Get-Content -LiteralPath $nasTokFile -TotalCount 1 -Encoding UTF8).Trim().TrimStart([char]0xFEFF)
    } catch {
      # ignore unreadable token file
    }
  }
}
function Escape-ForBashSingleQuotedContent([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  return $s.Replace("'", "'\''")
}

function Test-IsPlaceholderNasClientToken([string]$t) {
  $x = ("$t").Trim().TrimStart([char]0xFEFF)
  if ([string]::IsNullOrWhiteSpace($x)) { return $true }
  $lower = $x.ToLowerInvariant()
  if ($lower -eq "replace_me") { return $true }
  if ($lower -like "replace_with*") { return $true }
  if ($lower -match "change-this-nas-client-token") { return $true }
  return $false
}

function Remove-WindowsReservedGitArtifactFiles {
  param([string]$RepoRoot)
  if ([string]::IsNullOrWhiteSpace($RepoRoot)) { return }
  $rootFull = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction SilentlyContinue)
  if ($null -eq $rootFull) { return }
  $base = $rootFull.Path.TrimEnd('\', '/')
  foreach ($rel in @("frontend\NUL", "NUL")) {
    $p = Join-Path $base $rel
    $long = if ($p -match '^\\\\') { $p } else { "\\?\$p" }
    if (Test-Path -LiteralPath $long) {
      try {
        Remove-Item -LiteralPath $long -Force -ErrorAction Stop
        Write-Host "Removed Windows artifact file: $rel" -ForegroundColor DarkYellow
      } catch {
        Write-Host "WARN: could not remove reserved-name file: $rel — delete manually or adjust .gitignore" -ForegroundColor Yellow
      }
    }
  }
}

function Resolve-RemoteGitCloneUrl([string]$origin) {
  $o = ($origin | ForEach-Object { "$_".Trim() })
  if ([string]::IsNullOrWhiteSpace($o)) { return "" }
  $manual = if ($null -ne $env:DEPLOY_GIT_CLONE_URL) { "$($env:DEPLOY_GIT_CLONE_URL)".Trim() } else { "" }
  if (-not [string]::IsNullOrWhiteSpace($manual)) { return $manual }
  if ($env:DEPLOY_GIT_CLONE_USE_ORIGIN -match '^(1|true|yes|Y|y)$') { return $o }
  # ECS cannot prompt for HTTPS username; GitHub private repos need token or SSH. Prefer SSH form for github.com HTTPS.
  if ($o -imatch '^https://github\.com/([^/]+)/(.+)$') {
    $owner = $Matches[1]
    $repoPath = ($Matches[2] -replace '/$', '').Trim()
    $repo = $repoPath -replace '\.git$', ''
    if (-not [string]::IsNullOrWhiteSpace($repo)) {
      return "git@github.com:${owner}/${repo}.git"
    }
  }
  return $o
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

function Step($msg) {
  Write-Host "`n== $msg ==" -ForegroundColor Cyan
}

function Get-NativeOutput {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $FilePath @Arguments 2>&1
  } finally {
    $ErrorActionPreference = $oldEap
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $FilePath $($Arguments -join ' ')`n$(Format-NativeCommandOutputLines $out)"
  }
  return (Format-NativeCommandOutputLines $out)
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$StdinText = $null,
    # Windows PowerShell: piping multiline text to native ssh can inject CR; use a UTF-8 LF-only temp file instead.
    [string]$StdinFile = $null,
    [int]$RetryCount = 1,
    [int]$RetryDelaySec = 5,
    [switch]$StreamOutput
  )
  # Do not use "both non-null" alone: scope/pipeline can leave [string] params non-$null without being explicitly passed.
  $useStdinFile = $PSBoundParameters.ContainsKey("StdinFile") -and -not [string]::IsNullOrWhiteSpace($StdinFile)
  $useStdinText = $PSBoundParameters.ContainsKey("StdinText") -and -not [string]::IsNullOrWhiteSpace($StdinText)
  if ($useStdinFile -and $useStdinText) {
    throw "Invoke-Native: specify only one of StdinFile or StdinText"
  }
  $attempt = 1
  while ($attempt -le [Math]::Max(1, $RetryCount)) {
    if ($useStdinFile) {
      Write-Host ">> $FilePath $($Arguments -join ' ') stdin=<file> (attempt $attempt/$RetryCount)"
    } else {
      Write-Host ">> $FilePath $($Arguments -join ' ') (attempt $attempt/$RetryCount)"
    }
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
        if ($useStdinText) {
          $StdinText | & $FilePath @Arguments
        } else {
          & $FilePath @Arguments
        }
        $out = @()
        $exitCode = $LASTEXITCODE
      } else {
        if ($useStdinText) {
          $out = $StdinText | & $FilePath @Arguments 2>&1
        } else {
          $out = & $FilePath @Arguments 2>&1
        }
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

Step "Local repository check"
$branch = Get-NativeOutput -FilePath "git" -Arguments @("rev-parse", "--abbrev-ref", "HEAD")
if (-not $branch) { throw "Cannot detect git branch" }
Invoke-Native -FilePath "git" -Arguments @("status", "--short")

if (-not $SkipCommit) {
  Step "Stage and commit"
  Remove-WindowsReservedGitArtifactFiles -RepoRoot $PSScriptRoot
  # -c reduces CRLF/LF warnings on Windows; stderr is still normalized in Invoke-Native.
  Invoke-Native -FilePath "git" -Arguments @("-c", "core.autocrlf=false", "add", "-A")
  $pending = Get-NativeOutput -FilePath "git" -Arguments @("diff", "--cached", "--name-only")
  if (-not [string]::IsNullOrWhiteSpace($pending)) {
    Invoke-Native -FilePath "git" -Arguments @("commit", "-m", $CommitMessage)
  } else {
    Write-Host "No staged changes. Skip commit." -ForegroundColor Yellow
  }
}

Step "Push branch"
$originUrl = Get-NativeOutput -FilePath "git" -Arguments @("remote", "get-url", "origin")

function Convert-GitHubOriginUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][ValidateSet("https", "ssh")][string]$TargetProtocol
  )
  if ($TargetProtocol -eq "https" -and $Url -match "^git@github\.com:(.+?)(\.git)?$") {
    return "https://github.com/$($Matches[1]).git"
  }
  if ($TargetProtocol -eq "ssh" -and $Url -match "^https://github\.com/(.+?)(\.git)?$") {
    return "git@github.com:$($Matches[1]).git"
  }
  return $Url
}

$protocolOrder = @()
if ($originUrl -match "^git@github\.com:") {
  $protocolOrder = @("ssh", "https")
} elseif ($originUrl -match "^https://github\.com/") {
  $protocolOrder = @("https", "ssh")
} else {
  # Non-GitHub remote: only retry current URL.
  $protocolOrder = @("custom")
}

$pushAttemptsPerProtocol = 2
$pushDelaySec = 8
$pushOk = $false

foreach ($protocol in $protocolOrder) {
  if ($protocol -eq "custom") {
    $targetUrl = $originUrl
  } else {
    $targetUrl = Convert-GitHubOriginUrl -Url $originUrl -TargetProtocol $protocol
  }

  Write-Host ">> origin url => $targetUrl" -ForegroundColor Yellow
  Invoke-Native -FilePath "git" -Arguments @("remote", "set-url", "origin", $targetUrl)

  for ($i = 1; $i -le $pushAttemptsPerProtocol; $i++) {
    Write-Host ">> git push origin $branch ($protocol attempt $i/$pushAttemptsPerProtocol)"
    & git push origin $branch
    if ($LASTEXITCODE -eq 0) {
      $pushOk = $true
      break
    }
    if ($i -lt $pushAttemptsPerProtocol) {
      Write-Host "Push failed (exit $LASTEXITCODE). Retrying in ${pushDelaySec}s..." -ForegroundColor Yellow
      Start-Sleep -Seconds $pushDelaySec
    }
  }

  if ($pushOk) { break }
}

if (-not $pushOk) {
  throw @"
git push failed (HTTPS and SSH were both tried for GitHub remotes).

Common causes:
  - HTTPS 'Connection was reset': corporate firewall / ISP / region routing. Try VPN, another network, or: git push from a machine that can reach github.com.
  - SSH 'Permission denied (publickey)': this PC has no GitHub SSH key. Add a key: https://github.com/settings/keys (or use HTTPS with a Personal Access Token: git remote set-url origin https://<TOKEN>@github.com/owner/repo.git — do not commit the token).

If code is already pushed elsewhere, you can deploy only:
  .\deploy-oneclick.ps1 -SkipCommit

Then on this machine fix git remote / credentials and push manually when ready.
"@
}

$gitOriginUrlForRemote = (Get-NativeOutput -FilePath "git" -Arguments @("remote", "get-url", "origin")).Trim()
$gitCloneUrlForRemote = Resolve-RemoteGitCloneUrl $gitOriginUrlForRemote
$bashEscapedGitCloneUrl = Escape-ForBashSingleQuotedContent $gitCloneUrlForRemote

Step "Resolve build version"
$resolvedBuildVersion = $BuildVersion.Trim()
if ([string]::IsNullOrWhiteSpace($resolvedBuildVersion)) {
  $commit = Get-NativeOutput -FilePath "git" -Arguments @("rev-parse", "--short", "HEAD")
  $suffix = Get-Date -Format "yyyyMMdd-HHmmss"
  $resolvedBuildVersion = "$commit-$suffix"
}
Write-Host "Build version: $resolvedBuildVersion" -ForegroundColor Yellow

Step "Remote deploy"
if (-not $SshInteractivePassword) {
  Write-Host "SSH: BatchMode=yes (no password prompt). Use DEPLOY_SSH_IDENTITY_FILE, ssh-agent, or DEPLOY_SSH_INTERACTIVE=1." -ForegroundColor DarkGray
} else {
  Write-Host "SSH: interactive password allowed (BatchMode off)." -ForegroundColor DarkGray
}
if ($useRemoteAutoCloneIfMissing) {
  Write-Host "RemoteAutoCloneIfMissing: ECS will git clone from: $gitCloneUrlForRemote" -ForegroundColor DarkGray
  if ($gitCloneUrlForRemote -ne $gitOriginUrlForRemote) {
    Write-Host "  (origin was $gitOriginUrlForRemote ; HTTPS github.com is rewritten to SSH for non-interactive clone)" -ForegroundColor DarkGray
  }
  Write-Host "  ECS needs read access to that URL (e.g. GitHub Deploy Key on the server for SSH). Override: DEPLOY_GIT_CLONE_URL" -ForegroundColor DarkGray
}
# Long `deploy.sh` (npm build) with stdout fully redirected can look "idle" to NAT/firewalls → RST.
# Stream deploy output via `tee` (see remote script). Tune keepalive: DEPLOY_SSH_SERVER_ALIVE_INTERVAL / DEPLOY_SSH_SERVER_ALIVE_COUNT_MAX.
$sshAliveInterval = 30
$sshAliveCountMax = 24
if ($null -ne $env:DEPLOY_SSH_SERVER_ALIVE_INTERVAL -and "$($env:DEPLOY_SSH_SERVER_ALIVE_INTERVAL)".Trim() -match '^\d+$') {
  $sshAliveInterval = [int]$env:DEPLOY_SSH_SERVER_ALIVE_INTERVAL.Trim()
}
if ($null -ne $env:DEPLOY_SSH_SERVER_ALIVE_COUNT_MAX -and "$($env:DEPLOY_SSH_SERVER_ALIVE_COUNT_MAX)".Trim() -match '^\d+$') {
  $sshAliveCountMax = [int]$env:DEPLOY_SSH_SERVER_ALIVE_COUNT_MAX.Trim()
}
$sshTarget = "$ServerUser@$ServerHost"
$escapedRemoteAppDir = $RemoteAppDir.Replace("'", '''"''"''')
$escapedBuildVersion = $resolvedBuildVersion.Replace("'", '''"''"''')
$autoCloneFlag = if ($useRemoteAutoCloneIfMissing) { "1" } else { "0" }
$remoteScriptTemplate = @'
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail
echo '[remote] connected'
echo "[remote] PATH=$PATH"
if ! command -v git >/dev/null 2>&1 && [ -x /usr/bin/git ]; then
  export PATH="/usr/bin:$PATH"
fi
if ! command -v git >/dev/null 2>&1 && [ -x /usr/lib/git-core/git ]; then
  echo '[remote] found git at /usr/lib/git-core/git, repairing /usr/bin/git symlink'
  mkdir -p /usr/bin
  ln -sf /usr/lib/git-core/git /usr/bin/git
  export PATH="/usr/bin:/usr/lib/git-core:$PATH"
fi
if ! command -v git >/dev/null 2>&1; then
  echo '[remote] git missing, trying package manager (absolute paths)...'
  export DEBIAN_FRONTEND=noninteractive
  if [ -x /usr/bin/apt-get ] || [ -x /bin/apt-get ]; then
    /usr/bin/apt-get update
    /usr/bin/apt-get install -y git
  elif [ -x /usr/bin/apt ]; then
    /usr/bin/apt update
    /usr/bin/apt install -y git
  elif [ -x /usr/bin/yum ]; then
    /usr/bin/yum install -y git
  elif [ -x /bin/yum ]; then
    /bin/yum install -y git
  elif [ -x /usr/bin/dnf ]; then
    /usr/bin/dnf install -y git
  elif [ -x /bin/dnf ]; then
    /bin/dnf install -y git
  elif [ -x /usr/bin/microdnf ]; then
    /usr/bin/microdnf install -y git
  elif [ -x /usr/bin/zypper ]; then
    /usr/bin/zypper --non-interactive install git
  elif [ -x /usr/bin/pacman ]; then
    /usr/bin/pacman -Sy --noconfirm git
  elif [ -x /sbin/apk ]; then
    /sbin/apk add --no-cache git
  elif [ -x /bin/apk ]; then
    /bin/apk add --no-cache git
  else
    echo '[remote][error] git not found and no supported package manager available'
    echo '[remote][diag] uname:'
    uname -a || true
    echo '[remote][diag] os-release:'
    cat /etc/os-release 2>/dev/null || true
    echo '[remote][diag] common package manager paths:'
    ls -l /usr/bin/apt-get /bin/apt-get /usr/bin/apt /usr/bin/yum /bin/yum /usr/bin/dnf /bin/dnf /usr/bin/microdnf /usr/bin/zypper /usr/bin/pacman /sbin/apk /bin/apk 2>/dev/null || true
    exit 127
  fi
fi
if ! command -v git >/dev/null 2>&1; then
  echo '[remote][error] git not in PATH after install'
  exit 127
fi
REMOTE_ROOT='__REMOTE_APP_DIR__'
AUTO_CLONE='__AUTO_CLONE_FLAG__'
GIT_CLONE_URL='__GIT_CLONE_URL__'
if [ ! -d "$REMOTE_ROOT" ]; then
  if [ "$AUTO_CLONE" != "1" ] || [ -z "$GIT_CLONE_URL" ]; then
    echo "[remote][error] App directory does not exist: $REMOTE_ROOT"
    echo "[remote] This is normal on a brand-new ECS. Either:"
    echo "[remote]   A) Set DEPLOY_REMOTE_AUTO_CLONE=1 (or pass -RemoteAutoCloneIfMissing) and rerun deploy, or"
    echo "[remote]   B) On the server: mkdir -p /root/apps && cd /root/apps && git clone GIT_URL " "$(basename "$REMOTE_ROOT")"
    echo "[remote]   C) Deploy with -RemoteAppDir pointing at an existing clone."
    exit 2
  fi
  echo "[remote][warn] App directory missing; cloning (AUTO_CLONE=1, non-interactive)..."
  parent=$(dirname "$REMOTE_ROOT")
  base=$(basename "$REMOTE_ROOT")
  mkdir -p "$parent"
  cd "$parent"
  if [ -e "$base" ]; then
    echo "[remote][error] Refuse to clone: $parent/$base already exists (not a usable repo dir?)"
    exit 2
  fi
  export GIT_TERMINAL_PROMPT=0
  if ! git clone "$GIT_CLONE_URL" "$base"; then
    echo "[remote][error] git clone failed. If SSH: add a read-only Deploy Key to this repo for /root/.ssh on this server."
    echo "[remote][error] If HTTPS private: set DEPLOY_GIT_CLONE_URL to https://<TOKEN>@github.com/owner/repo.git (do not commit that URL)."
    exit 128
  fi
fi
cd "$REMOTE_ROOT"
echo '[remote] entered app dir'
BUILD_VERSION='__BUILD_VERSION__'
if [ -f './backend/.env' ]; then
  echo '[remote] writing APP_BUILD_VERSION to backend/.env'
  sed -i '/^APP_BUILD_VERSION=/d' ./backend/.env
  echo "APP_BUILD_VERSION=$BUILD_VERSION" >> ./backend/.env
fi
if [ ! -f './deploy.sh' ]; then
  echo '[remote][warn] deploy.sh missing, trying to restore from git'
  git checkout -- ./deploy.sh 2>/dev/null || git checkout origin/main -- ./deploy.sh 2>/dev/null || true
fi
if [ ! -f './deploy.sh' ]; then
  echo '[remote][error] deploy.sh still missing after git restore'
  exit 1
fi
chmod +x ./deploy.sh || true
echo '[remote] checking postgresql client tools (pg_dump/psql)'
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo '[remote] postgresql-client missing, installing...'
  export DEBIAN_FRONTEND=noninteractive
  if [ -x /usr/bin/apt-get ] || [ -x /bin/apt-get ]; then
    /usr/bin/apt-get update
    /usr/bin/apt-get install -y postgresql-client
  elif [ -x /usr/bin/apt ]; then
    /usr/bin/apt update
    /usr/bin/apt install -y postgresql-client
  elif [ -x /usr/bin/yum ]; then
    /usr/bin/yum install -y postgresql-client || /usr/bin/yum install -y postgresql
  elif [ -x /bin/yum ]; then
    /bin/yum install -y postgresql-client || /bin/yum install -y postgresql
  elif [ -x /usr/bin/dnf ]; then
    /usr/bin/dnf install -y postgresql
  elif [ -x /bin/dnf ]; then
    /bin/dnf install -y postgresql
  elif [ -x /usr/bin/microdnf ]; then
    /usr/bin/microdnf install -y postgresql
  elif [ -x /usr/bin/zypper ]; then
    /usr/bin/zypper --non-interactive install postgresql
  elif [ -x /usr/bin/pacman ]; then
    /usr/bin/pacman -Sy --noconfirm postgresql-libs postgresql
  else
    echo '[remote][error] cannot auto-install pg_dump/psql'
    exit 1
  fi
else
  echo '[remote] postgresql-client already installed'
fi
if [ '__BOOTSTRAP_PG__' = '1' ] && command -v apt-get >/dev/null 2>&1; then
  _pgurl_file=''
  if [ -f ./backend/.env ]; then
    _pgurl_file='./backend/.env'
  elif [ -f ./backend/.env.example ]; then
    _pgurl_file='./backend/.env.example'
  fi
  if [ -n "$_pgurl_file" ] && grep -qE '^DATABASE_URL=.*@(127\.0\.0\.1|localhost):' "$_pgurl_file" 2>/dev/null; then
    if command -v pg_isready >/dev/null 2>&1 && ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null && ! pg_isready -h localhost -p 5432 -q 2>/dev/null; then
      echo '[remote] DEPLOY_BOOTSTRAP_POSTGRES=1: install postgresql server before deploy.sh so old deploy.sh still passes [2b]'
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y postgresql postgresql-contrib
      systemctl enable postgresql
      systemctl start postgresql
      sleep 2
      sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" || true
      sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'light_content'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE light_content;"
    fi
  fi
fi
echo '[remote] ensure systemd units before deploy.sh (one-click new ECS)'
_app="$(pwd)"
if [ ! -f /etc/systemd/system/light-content-api.service ]; then
  cat >/etc/systemd/system/light-content-api.service <<LIGHTAPIUNIT
[Unit]
Description=Light Content Workflow FastAPI
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=root
Group=root
WorkingDirectory=$_app/backend
Environment=PATH=$_app/backend/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$_app/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
LIGHTAPIUNIT
fi
if [ ! -f /etc/systemd/system/light-content-web.service ]; then
  cat >/etc/systemd/system/light-content-web.service <<LIGHTWEBUNIT
[Unit]
Description=Light Content Workflow Next.js
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=$_app/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
LIGHTWEBUNIT
fi
systemctl daemon-reload
systemctl enable light-content-api 2>/dev/null || true
systemctl enable light-content-web 2>/dev/null || true
if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo '[remote] install Node.js 20 LTS before deploy.sh (bare ECS, Next.js needs Node 18+)'
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y ca-certificates curl gnupg
    if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
      apt-get install -y nodejs
    else
      echo '[remote][error] NodeSource setup failed; install Node 20+ manually on ECS.'
      exit 127
    fi
  else
    echo '[remote][error] no apt-get; cannot install node/npm.'
    exit 127
  fi
fi
echo '[remote] killing potential uvicorn conflict on 8000'
pkill -f "uvicorn app.main:app --host 0.0.0.0 --port 8000" || true
sleep 1
export DEPLOY_BOOTSTRAP_POSTGRES='__BOOTSTRAP_PG__'
echo '[remote] running deploy.sh (streaming log to this SSH session + /tmp/light-content-deploy.log)'
set +e
if command -v timeout >/dev/null 2>&1; then
  timeout 1800 ./deploy.sh 2>&1 | tee /tmp/light-content-deploy.log
  deploy_rc=${PIPESTATUS[0]}
else
  ./deploy.sh 2>&1 | tee /tmp/light-content-deploy.log
  deploy_rc=${PIPESTATUS[0]}
fi
set -e
[ -n "$deploy_rc" ] || deploy_rc=1
if [ "$deploy_rc" -ne 0 ]; then
  if [ "$deploy_rc" -eq 127 ] && grep -q "curl: command not found" /tmp/light-content-deploy.log 2>/dev/null; then
    echo '[remote][warn] deploy.sh exited due to missing curl; continue with Python health checks.'
  else
    echo "[remote][error] deploy.sh failed, exit=$deploy_rc"
    exit "$deploy_rc"
  fi
fi
echo '[remote] deploy.sh done'
echo
echo '== remote version =='
(cd '__REMOTE_APP_DIR__' && command -v git >/dev/null 2>&1 && git rev-parse --short HEAD) || echo '(git rev-parse skipped)'
echo "app_build_version=$BUILD_VERSION"
echo
echo '== remote quick checks =='
python3 -c 'import json,urllib.request; data=json.loads(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=8).read().decode("utf-8")); print(json.dumps(data, ensure_ascii=False))'
echo
python3 -c 'import urllib.request; req=urllib.request.Request("http://127.0.0.1:3000/materials", method="HEAD"); resp=urllib.request.urlopen(req, timeout=8); print("HTTP", resp.status)'
'@
$remoteScript = $remoteScriptTemplate.Replace("__REMOTE_APP_DIR__", $escapedRemoteAppDir).Replace("__BUILD_VERSION__", $escapedBuildVersion).Replace("__GIT_CLONE_URL__", $bashEscapedGitCloneUrl).Replace("__AUTO_CLONE_FLAG__", $autoCloneFlag).Replace("__BOOTSTRAP_PG__", $bootstrapPostgresFlag)
# Important: force LF line endings before piping to `ssh ... bash -s`.
# If CRLF is sent, bash may read path checks like /usr/bin/apt-get\r and all -x probes fail.
$remoteScript = $remoteScript.Replace("`r", "")
$sshArgsList = [System.Collections.Generic.List[string]]::new()
if (-not [string]::IsNullOrWhiteSpace($SshIdentityFile)) {
  $keyPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SshIdentityFile.Trim())
  if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "SshIdentityFile not found: $SshIdentityFile (resolved: $keyPath)"
  }
  $sshArgsList.Add("-i")
  $sshArgsList.Add($keyPath)
}
if (-not $SshInteractivePassword) {
  $sshArgsList.Add("-o")
  $sshArgsList.Add("BatchMode=yes")
}
# List[string].AddRange requires IEnumerable[string]; PS literal arrays are Object[].
$sshArgsList.AddRange(
  [string[]]@(
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=$sshAliveInterval",
    "-o", "ServerAliveCountMax=$sshAliveCountMax",
    [string]$sshTarget,
    "bash -s"
  )
)
$sshArgsArray = $sshArgsList.ToArray()

Step "Pre-deploy: ECS pg_dump + pull SQL to local (safety backup)"
$skipIntegratedDbBackup = $false
if ($null -ne $env:DEPLOY_POST_RELEASE_DB_BACKUP) {
  $rawPost = "$($env:DEPLOY_POST_RELEASE_DB_BACKUP)".Trim()
  if ($rawPost -match '^(0|false|no|N|skip)$') {
    $skipIntegratedDbBackup = $true
  }
}
if ($skipIntegratedDbBackup) {
  Write-Host "[skip] Integrated DB backup: DEPLOY_POST_RELEASE_DB_BACKUP=0 (or false/no/skip)." -ForegroundColor Yellow
} else {
  $remoteBackupFile = "/root/light-content-db-backups/light-content-latest.sql"
  if ($null -ne $env:ECS_BACKUP_REMOTE_FILE -and -not [string]::IsNullOrWhiteSpace("$($env:ECS_BACKUP_REMOTE_FILE)".Trim())) {
    $remoteBackupFile = "$($env:ECS_BACKUP_REMOTE_FILE)".Trim().Trim('"')
  }
  $backupOutDir = $PSScriptRoot
  if ($null -ne $env:BACKUP_OUTPUT_DIR -and -not [string]::IsNullOrWhiteSpace("$($env:BACKUP_OUTPUT_DIR)".Trim())) {
    $backupOutDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath("$($env:BACKUP_OUTPUT_DIR)".Trim().Trim('"'))
  }
  if (-not (Test-Path -LiteralPath $backupOutDir)) {
    try {
      New-Item -ItemType Directory -Path $backupOutDir -Force | Out-Null
    } catch {
      Write-Host "[warn] Pre-deploy DB backup: cannot create BACKUP_OUTPUT_DIR=$backupOutDir — $($_.Exception.Message)" -ForegroundColor Yellow
      $backupOutDir = $PSScriptRoot
    }
  }
  $hostTag = ($ServerHost -replace "[:\\/]", "-")
  $ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss-fffZ"
  $localBackupName = "light-content-pre-deploy-${hostTag}-${ts}.sql"
  $localBackupPath = Join-Path $backupOutDir $localBackupName
  $escapedRemoteRoot = Escape-ForBashSingleQuotedContent $RemoteAppDir.TrimEnd("/")
  $preBackupRemoteSh = @"
set -euo pipefail
ROOT='__ROOT__'
SCRIPT="`$ROOT/scripts/ecs-backup-db-local.sh"
if [ ! -f "`$SCRIPT" ]; then echo "[pre-deploy-backup][error] missing `$SCRIPT"; exit 2; fi
chmod +x "`$SCRIPT" 2>/dev/null || true
"`$SCRIPT"
"@
  $preBackupRemoteSh = $preBackupRemoteSh.Replace("__ROOT__", $escapedRemoteRoot).Replace("`r", "")
  $normalizedPre = ((($preBackupRemoteSh -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n")
  $prePath = Join-Path ([System.IO.Path]::GetTempPath()) ("lcwp-pre-deploy-backup-" + [guid]::NewGuid().ToString("n") + ".sh")
  $utf8NoBomPre = New-Object System.Text.UTF8Encoding($false)
  try {
    [System.IO.File]::WriteAllText($prePath, $normalizedPre, $utf8NoBomPre)
    try {
      Write-Host "Remote: run ecs-backup-db-local.sh then scp -> $localBackupPath" -ForegroundColor DarkGray
      Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinFile $prePath -RetryCount 1 -RetryDelaySec 10
      $scpArgsList = [System.Collections.Generic.List[string]]::new()
      if (-not [string]::IsNullOrWhiteSpace($SshIdentityFile)) {
        $keyPathScp = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SshIdentityFile.Trim())
        if (Test-Path -LiteralPath $keyPathScp) {
          $scpArgsList.Add("-i")
          $scpArgsList.Add($keyPathScp)
        }
      }
      if (-not $SshInteractivePassword) {
        $scpArgsList.Add("-o")
        $scpArgsList.Add("BatchMode=yes")
      }
      $scpArgsList.AddRange(
        [string[]]@(
          "-o", "StrictHostKeyChecking=accept-new",
          "-o", "ConnectTimeout=12",
          "-o", "ServerAliveInterval=$sshAliveInterval",
          "-o", "ServerAliveCountMax=$sshAliveCountMax",
          "${sshTarget}:${remoteBackupFile}",
          $localBackupPath
        )
      )
      Invoke-Native -FilePath "scp" -Arguments $scpArgsList.ToArray() -RetryCount 1 -RetryDelaySec 10
      Write-Host "[ok] Pre-deploy DB backup saved: $localBackupPath" -ForegroundColor Green
    } catch {
      Write-Host "[warn] Pre-deploy DB backup failed (deploy will continue): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  } finally {
    Remove-Item -LiteralPath $prePath -Force -ErrorAction SilentlyContinue
  }
}

$prepPythonVenv = [bool](
  $null -ne $env:DEPLOY_REMOTE_PREP_PYTHON_VENV -and ($env:DEPLOY_REMOTE_PREP_PYTHON_VENV.Trim() -match '^(1|true|yes|Y|y)$')
)
if ($prepPythonVenv) {
  Step "Remote prep: python3-venv (DEPLOY_REMOTE_PREP_PYTHON_VENV)"
  $prepScript = @'
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo '[remote-prep] apt: python3-venv (bare Debian/Ubuntu; ignore if already installed)'
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  set +e
  apt-get update -qq
  apt-get install -y python3-venv
  _py_ver="$(python3 -c 'import sys; print("%d.%d" % (sys.version_info[0], sys.version_info[1]))' 2>/dev/null || true)"
  if [ -n "${_py_ver}" ]; then
    apt-get install -y "python${_py_ver}-venv" 2>/dev/null || true
  fi
  echo '[remote-prep] done'
else
  echo '[remote-prep] skip: no apt-get'
fi
true
'@
  $normalized = ((($prepScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n")
  $prepPath = Join-Path ([System.IO.Path]::GetTempPath()) ("light-content-remote-prep-" + [guid]::NewGuid().ToString("n") + ".sh")
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  try {
    [System.IO.File]::WriteAllText($prepPath, $normalized, $utf8NoBom)
    # Do not pipe script into ssh on Windows PS (injects CR -> bash: $'\r': command not found). Use stdin file.
    Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinFile $prepPath -RetryCount 1 -RetryDelaySec 10
  } finally {
    Remove-Item -LiteralPath $prepPath -Force -ErrorAction SilentlyContinue
  }
}

try {
  Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinText $remoteScript -RetryCount 1 -RetryDelaySec 10 -StreamOutput
} catch {
  $errText = $_.Exception.Message
  if ($errText -match "Connection reset|Broken pipe|Operation timed out|Connection closed") {
    Write-Host "[warn] SSH disconnected during remote deploy. Trying reconnect recovery..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
    $recoverScript = @'
set -euo pipefail
echo '[recover] reconnected'
if [ -f /tmp/light-content-deploy.log ]; then
  if pgrep -f "./deploy.sh|npm run build|pip install -r requirements.txt|alembic -c alembic.ini upgrade head" >/dev/null 2>&1; then
    echo '[recover] deploy still running, waiting up to 20 minutes...'
    for i in $(seq 1 120); do
      if ! pgrep -f "./deploy.sh|npm run build|pip install -r requirements.txt|alembic -c alembic.ini upgrade head" >/dev/null 2>&1; then
        break
      fi
      sleep 10
    done
  fi
  echo '[recover] recent deploy log:'
  tail -n 200 /tmp/light-content-deploy.log || true
else
  echo '[recover][warn] /tmp/light-content-deploy.log not found'
fi
echo '[recover] service status:'
systemctl is-active light-content-api || true
systemctl is-active light-content-web || true
echo '[recover] health checks:'
python3 -c 'import json,urllib.request; data=json.loads(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=10).read().decode("utf-8")); print(json.dumps(data, ensure_ascii=False))'
python3 -c 'import urllib.request; req=urllib.request.Request("http://127.0.0.1:3000/materials", method="HEAD"); resp=urllib.request.urlopen(req, timeout=10); print("HTTP", resp.status)'
'@
    try {
      Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinText $recoverScript -RetryCount 2 -RetryDelaySec 6 -StreamOutput
      Write-Host "[recover] Remote checks passed after reconnect; treat deploy as success." -ForegroundColor Green
      $errText = ""
    } catch {
      $recoverErr = $_.Exception.Message
      throw "SSH disconnected during deploy, and recovery check failed.`nOriginal error:`n$errText`n`nRecovery error:`n$recoverErr"
    }
  }
  if ([string]::IsNullOrWhiteSpace($errText)) {
    # recovered successfully
  } elseif ($errText -match "Failed to compile\." -or $errText -match "Type error:") {
    throw "Remote frontend build failed (type/lint). This is a blocking compile error, not npm audit warning.`n$errText"
  } elseif ($errText -match "npm audit fix" -and $errText -notmatch "Failed to compile\.") {
    throw "Remote deploy failed for reasons other than npm vulnerabilities. Note: npm audit warnings are non-blocking by default.`n$errText"
  } elseif ($errText -match "Permission denied \(publickey") {
    throw @"
SSH authentication failed (BatchMode disables password prompts).

Fix one of:
  1) Add your public key to the server: ssh-copy-id ${ServerUser}@${ServerHost}
  2) In local-env.bat set: set "DEPLOY_SSH_IDENTITY_FILE=%USERPROFILE%\.ssh\YOUR_KEY"
  3) For password login from an interactive console: set DEPLOY_SSH_INTERACTIVE=1

Original:
$errText
"@
  } else {
    throw
  }
}

function Get-DeployEnvMergeLanPublic {
  $m = @{}
  $defs = @(
    @{ Key = "LAN_UPLOAD_BASE_URL"; Env = "DEPLOY_LAN_UPLOAD_BASE_URL" },
    @{ Key = "LAN_DOWNLOAD_BASE_URL"; Env = "DEPLOY_LAN_DOWNLOAD_BASE_URL" },
    @{ Key = "PUBLIC_UPLOAD_BASE_URL"; Env = "DEPLOY_PUBLIC_UPLOAD_BASE_URL" },
    @{ Key = "PUBLIC_DOWNLOAD_BASE_URL"; Env = "DEPLOY_PUBLIC_DOWNLOAD_BASE_URL" }
  )
  foreach ($pair in $defs) {
    $raw = [Environment]::GetEnvironmentVariable($pair.Env, "Process")
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
    $v = "$raw".Trim().Trim('"').TrimStart([char]0xFEFF).TrimEnd("/")
    if ([string]::IsNullOrWhiteSpace($v)) { continue }
    $low = $v.ToLowerInvariant()
    if ($low -match "replace_me|replace_with|change-this|example\.com") { continue }
    $m[$pair.Key] = $v
  }
  return $m
}

Step "Optional: merge NAS_CLIENT_TOKEN on ECS (.env) + restart API"
if (-not [string]::IsNullOrWhiteSpace($NasClientTokenForRemoteEnv)) {
  if (Test-IsPlaceholderNasClientToken $NasClientTokenForRemoteEnv) {
    Write-Host "[skip] Remote NAS_CLIENT_TOKEN merge: value looks like a placeholder. Set DEPLOY_NAS_CLIENT_TOKEN in local-env.bat or put a real token in nas-client/nas-client-token.txt." -ForegroundColor Yellow
  } else {
    $tok = $NasClientTokenForRemoteEnv.Trim().TrimStart([char]0xFEFF)
    $backendPath = ($RemoteAppDir.TrimEnd("/") + "/backend")
    $bdEscaped = Escape-ForBashSingleQuotedContent $backendPath
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($tok))
    $injectScript = @"
set -euo pipefail
cd '$bdEscaped'
export LCWP_B64='$b64'
python3 <<'PYEOF'
import base64
import os
import pathlib

tok = base64.b64decode(os.environ['LCWP_B64']).decode('utf-8').strip().strip('\ufeff')
p = pathlib.Path('.env')
if not p.is_file():
    raise SystemExit('missing .env')
text = p.read_text(encoding='utf-8')
lines = text.splitlines(keepends=True)
out = []
replaced = False
for line in lines:
    if line.startswith('NAS_CLIENT_TOKEN='):
        out.append('NAS_CLIENT_TOKEN=' + tok + '\n')
        replaced = True
    else:
        out.append(line)
if not replaced:
    if out and not (out[-1].endswith('\n') or out[-1].endswith('\r\n')):
        out.append('\n')
    out.append('NAS_CLIENT_TOKEN=' + tok + '\n')
p.write_text(''.join(out), encoding='utf-8')
print('[merge-nas-token] wrote NAS_CLIENT_TOKEN to .env')
PYEOF
systemctl restart light-content-api
sleep 2
systemctl is-active light-content-api || true
"@
    $injectScript = $injectScript.Replace("`r", "")
    $normalizedInject = ((($injectScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n")
    $injPath = Join-Path ([System.IO.Path]::GetTempPath()) ("lcwp-merge-nas-" + [guid]::NewGuid().ToString("n") + ".sh")
    $utf8NoBomInject = New-Object System.Text.UTF8Encoding($false)
    try {
      [System.IO.File]::WriteAllText($injPath, $normalizedInject, $utf8NoBomInject)
      Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinFile $injPath -RetryCount 1 -RetryDelaySec 8
    } finally {
      Remove-Item -LiteralPath $injPath -Force -ErrorAction SilentlyContinue
    }
  }
}

Step "Optional: merge DEPLOY_LAN_* / DEPLOY_PUBLIC_* into remote backend/.env (+ restart API)"
$mergeLanPublic = Get-DeployEnvMergeLanPublic
if ($mergeLanPublic.Count -eq 0) {
  Write-Host "[skip] Remote LAN/PUBLIC URL merge: set DEPLOY_LAN_UPLOAD_BASE_URL, DEPLOY_LAN_DOWNLOAD_BASE_URL, DEPLOY_PUBLIC_* in local-env.bat (same cmd session) before deploy so ECS download-route returns file-machine bases." -ForegroundColor Yellow
} else {
  $jsonMerge = ($mergeLanPublic | ConvertTo-Json -Compress -Depth 5)
  $mergeB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($jsonMerge))
  $backendPathLan = ($RemoteAppDir.TrimEnd("/") + "/backend")
  $bdLanEscaped = Escape-ForBashSingleQuotedContent $backendPathLan
  $injectLanScript = @"
set -euo pipefail
cd '$bdLanEscaped'
export LCWP_MERGE_B64='$mergeB64'
python3 <<'PYEOF'
import base64
import json
import os
import pathlib

data = json.loads(base64.b64decode(os.environ['LCWP_MERGE_B64']).decode('utf-8'))
p = pathlib.Path('.env')
if not p.is_file():
    raise SystemExit('missing .env')
text = p.read_text(encoding='utf-8')
lines = text.splitlines(keepends=True)
keys = set(data.keys())
out = []
for line in lines:
    if '=' in line:
        k = line.split('=', 1)[0].strip()
        if k in keys:
            continue
    out.append(line)
for k in sorted(data.keys()):
    v = str(data[k]).strip().rstrip('/')
    if not v:
        continue
    if out and not (out[-1].endswith('\n') or out[-1].endswith('\r\n')):
        out.append('\n')
    out.append(k + '=' + v + '\n')
p.write_text(''.join(out), encoding='utf-8')
print('[merge-lan-public] wrote:', ','.join(sorted(data.keys())))
PYEOF
systemctl restart light-content-api
sleep 2
systemctl is-active light-content-api || true
"@
  $injectLanScript = $injectLanScript.Replace("`r", "")
  $normalizedLan = ((($injectLanScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n")
  $injLanPath = Join-Path ([System.IO.Path]::GetTempPath()) ("lcwp-merge-lan-" + [guid]::NewGuid().ToString("n") + ".sh")
  $utf8NoBomLan = New-Object System.Text.UTF8Encoding($false)
  try {
    [System.IO.File]::WriteAllText($injLanPath, $normalizedLan, $utf8NoBomLan)
    Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinFile $injLanPath -RetryCount 1 -RetryDelaySec 8
  } finally {
    Remove-Item -LiteralPath $injLanPath -Force -ErrorAction SilentlyContinue
  }
}

Step "Public quick checks"
if ([string]::IsNullOrWhiteSpace($ServerHost)) {
  Write-Host "ServerHost is empty. Skip public checks." -ForegroundColor Yellow
} else {
  Invoke-Native -FilePath "curl.exe" -Arguments @("-s", "http://$ServerHost:8000/health")
  Write-Host ""
  $httpHead = & curl.exe -s -I "http://$ServerHost:3000/materials"
  if ($LASTEXITCODE -ne 0) {
    throw "Public materials check failed"
  }
  $httpHead | Select-Object -First 1
}

Write-Host "`nDone." -ForegroundColor Green
