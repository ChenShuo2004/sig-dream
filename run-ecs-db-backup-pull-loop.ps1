# Loop on file PC: run pull-ecs-database-backup.ps1 then sleep (hours). Same env as pull script: SERVER_* , DEPLOY_SSH_* , BACKUP_OUTPUT_DIR , ECS_BACKUP_REMOTE_FILE (from local-env.bat if started via start-nas-direct-services.bat).
# Window title is set by starter; keep English logs for console code pages.

param(
  [double]$IntervalHours = 24
)

$ErrorActionPreference = "Continue"
try {
  $Host.UI.RawUI.WindowTitle = "ECS DB backup pull (loop)"
} catch {
  # ignore
}
$pullScript = Join-Path $PSScriptRoot "pull-ecs-database-backup.ps1"
if (-not (Test-Path -LiteralPath $pullScript)) {
  Write-Host "[db-pull-loop] ERROR: missing $pullScript" -ForegroundColor Red
  exit 2
}

$sec = [int][Math]::Ceiling([Math]::Max(1.0, $IntervalHours) * 3600)
Write-Host "[db-pull-loop] interval=${IntervalHours}h (${sec}s); Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""

while ($true) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "======== $stamp pull start ========" -ForegroundColor DarkCyan
  try {
    & $pullScript
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[db-pull-loop] pull exited code $LASTEXITCODE" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[db-pull-loop] pull error: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host "[db-pull-loop] next pull in ${IntervalHours}h (sleep ${sec}s) ..." -ForegroundColor Gray
  Start-Sleep -Seconds $sec
}
