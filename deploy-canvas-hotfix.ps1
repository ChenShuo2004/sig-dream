# Hotfix deploy: canvas-app static + iframe cache bump + canvas_api. No git commit.
# Usage: .\deploy-canvas-hotfix.ps1
# Reads SERVER_HOST / REMOTE_APP_DIR / DEPLOY_SSH_IDENTITY_FILE from local-env.bat (gitignored).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$localEnv = Join-Path $root "local-env.bat"
if (-not (Test-Path $localEnv)) {
  throw "Missing local-env.bat. Copy local-env.example.bat and set SERVER_HOST / SSH key."
}

# Load bat env into this process
cmd /c "`"$localEnv`" && set" | ForEach-Object {
  if ($_ -match '^(SERVER_HOST|REMOTE_APP_DIR|DEPLOY_SSH_IDENTITY_FILE|SERVER_USER)=(.*)$') {
    Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
  }
}

$host_ = $env:SERVER_HOST
if ([string]::IsNullOrWhiteSpace($host_) -or $host_ -match '[<>]|YOUR_|ECS_PUBLIC') {
  throw "Set a real SERVER_HOST in local-env.bat before running this hotfix script."
}
$user = if ($env:SERVER_USER) { $env:SERVER_USER } else { "root" }
$remote = if ($env:REMOTE_APP_DIR) { $env:REMOTE_APP_DIR } else { "/root/apps/light_content_workflow_platform" }
$key = if ($env:DEPLOY_SSH_IDENTITY_FILE) { $env:DEPLOY_SSH_IDENTITY_FILE } else { "$env:USERPROFILE\.ssh\id_ed25519" }
if (-not (Test-Path $key)) { throw "SSH identity not found: $key (set DEPLOY_SSH_IDENTITY_FILE in local-env.bat)" }

$sshTarget = "${user}@${host_}"
$sshArgs = @("-i", $key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20")

Write-Host "== SSH check ==" -ForegroundColor Cyan
ssh @sshArgs $sshTarget "echo ok"
if ($LASTEXITCODE -ne 0) { throw "SSH to $host_ failed (fail2ban / proxy?). Retry later." }

Write-Host "== scp canvas-app ==" -ForegroundColor Cyan
scp @sshArgs -r "$root\frontend\public\canvas-app" "${sshTarget}:${remote}/frontend/public/"
scp @sshArgs "$root\frontend\app\canvas\page.tsx" "${sshTarget}:${remote}/frontend/app/canvas/page.tsx"
scp @sshArgs "$root\frontend\app\settings\api\page.tsx" "${sshTarget}:${remote}/frontend/app/settings/api/page.tsx"

Write-Host "== scp backend canvas_api ==" -ForegroundColor Cyan
scp @sshArgs "$root\backend\app\api\routes\canvas_api.py" "${sshTarget}:${remote}/backend/app/api/routes/canvas_api.py"

Write-Host "== restart web + api ==" -ForegroundColor Cyan
ssh @sshArgs $sshTarget "systemctl restart light-content-api light-content-web; systemctl is-active light-content-api light-content-web; grep -oE 'v=[0-9a-z]+' ${remote}/frontend/app/canvas/page.tsx | head -1"
Write-Host "Done. Hard refresh canvas (Ctrl+F5)." -ForegroundColor Green
