param(
  [string]$ApiBaseUrl = "",
  [string]$NasShare = "\\192.168.1.66\nas-file",
  [string]$NasDrive = "Z:",
  [string]$NasUser = "PA",
  [string]$NasPassword = "",
  [string]$NasClientToken = "",
  [string]$MountRoot = "Z:\material-assets",
  [int]$PollIntervalSeconds = 3,
  [int]$HttpTimeoutSeconds = 60,
  [int]$PrepareUploadTimeoutSeconds = 900,
  [int]$DownloadChunkSizeBytes = 16777216,
  [int]$WorkerConcurrency = 3,
  [string]$PollJobTypes = "",
  [string]$ExcludePollJobTypes = "",
  # analyze_content: OpenAI-compatible Qwen backend by default. Leave empty to keep worker.py defaults.
  [string]$VlmBaseUrl = "",
  [string]$VlmModel = "",
  [string]$VlmProvider = "",
  [string]$VlmApiKey = "",
  [int]$VlmVideoFrames = 0
)

$ErrorActionPreference = "Stop"

$NasClientToken = ([string]$NasClientToken).Trim().TrimStart([char]0xFEFF)
$NasPassword = ([string]$NasPassword).Trim()

. "$PSScriptRoot\_resolve-nas-api-base.ps1"
$ApiBaseUrl = Resolve-NasApiBaseUrl -Override $ApiBaseUrl -ScriptRoot $PSScriptRoot

# Do not force chcp 65001 here: on many CN Windows consoles it causes mojibake with mixed encodings.

if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  throw "NasClientToken is required. Please pass -NasClientToken."
}

if ([string]::IsNullOrWhiteSpace($NasPassword)) {
  throw "NasPassword is required. Please pass -NasPassword."
}

if (-not [string]::IsNullOrWhiteSpace($PollJobTypes)) {
  $Host.UI.RawUI.WindowTitle = "NAS worker - thumbnails only (generate_derivatives)"
} elseif (-not [string]::IsNullOrWhiteSpace($ExcludePollJobTypes)) {
  $Host.UI.RawUI.WindowTitle = "NAS worker - full queue except excluded job types"
} else {
  $Host.UI.RawUI.WindowTitle = "NAS worker - all nas_jobs"
}
Write-Host ""
Write-Host "  [This window]" -ForegroundColor Cyan
if (-not [string]::IsNullOrWhiteSpace($PollJobTypes)) {
  Write-Host "  Thumbnail-only: poll only listed job types (e.g. generate_derivatives), ffmpeg on this PC." -ForegroundColor Gray
} elseif (-not [string]::IsNullOrWhiteSpace($ExcludePollJobTypes)) {
  Write-Host "  Full worker paired with thumbnail worker: store_original, prepare_download, trash, etc." -ForegroundColor Gray
  Write-Host "  Excluded types are handled by the other PowerShell window." -ForegroundColor Gray
} else {
  Write-Host "  Single full worker: all job types. If you also run thumbnail-only worker, pass -ExcludePollJobTypes generate_derivatives." -ForegroundColor Gray
}
Write-Host ""
# Single-quoted Write-Host avoids Windows PS parsing "|" as a pipeline in some console encodings.
Write-Host '  [Important] This window is the nas_jobs Worker only (no HTTP listener; no phone/browser LAN upload logs here).' -ForegroundColor Yellow
Write-Host '        For client_ip, POST /upload path, data paths: see run-download-server.ps1' -ForegroundColor Yellow
Write-Host '        LAN upload window title is usually like: NAS LAN transfer - upload + ticket download ...' -ForegroundColor Yellow
Write-Host ""

. "$PSScriptRoot\_nas-share-map.ps1"

Write-Host "==> [1/6] Map NAS share to $NasDrive"
Repair-NasNetUse -NasShare $NasShare -NasDrive $NasDrive -NasUser $NasUser -NasPassword $NasPassword

Write-Host "==> [2/6] Ensure mount root $MountRoot"
New-Item -ItemType Directory -Force $MountRoot | Out-Null

Write-Host "==> [3/6] Prepare Python venv"
if (!(Test-Path ".\.venv\Scripts\python.exe")) {
  python -m venv .venv
}
& ".\.venv\Scripts\Activate.ps1"
pip install -r requirements.txt | Out-Null

Write-Host "==> [4/6] Export runtime env"
$env:NAS_API_BASE_URL = $ApiBaseUrl
$env:NAS_CLIENT_TOKEN = $NasClientToken
$env:NAS_MOUNT_ROOT = $MountRoot
$env:NAS_POLL_INTERVAL_SECONDS = "$PollIntervalSeconds"
$env:NAS_HTTP_TIMEOUT_SECONDS = "$HttpTimeoutSeconds"
$env:NAS_PREPARE_UPLOAD_TIMEOUT_SECONDS = "$PrepareUploadTimeoutSeconds"
$env:NAS_DOWNLOAD_CHUNK_SIZE_BYTES = "$DownloadChunkSizeBytes"
$env:NAS_WORKER_CONCURRENCY = "$WorkerConcurrency"
if (-not [string]::IsNullOrWhiteSpace($VlmBaseUrl)) { $env:NAS_VLM_BASE_URL = $VlmBaseUrl.Trim() }
if (-not [string]::IsNullOrWhiteSpace($VlmModel)) { $env:NAS_VLM_MODEL = $VlmModel.Trim() }
if (-not [string]::IsNullOrWhiteSpace($VlmProvider)) { $env:NAS_VLM_PROVIDER = $VlmProvider.Trim() }
if (-not [string]::IsNullOrWhiteSpace($VlmApiKey)) { $env:NAS_VLM_API_KEY = $VlmApiKey.Trim() }
if ($VlmVideoFrames -gt 0) { $env:NAS_VLM_VIDEO_FRAMES = "$VlmVideoFrames" }
Remove-Item env:NAS_POLL_JOB_TYPES -ErrorAction SilentlyContinue
Remove-Item env:NAS_EXCLUDE_JOB_TYPES -ErrorAction SilentlyContinue
if (-not [string]::IsNullOrWhiteSpace($PollJobTypes)) {
  $env:NAS_POLL_JOB_TYPES = $PollJobTypes.Trim()
  $env:NAS_WORKER_LABEL = "derivatives"
} elseif (-not [string]::IsNullOrWhiteSpace($ExcludePollJobTypes)) {
  $env:NAS_EXCLUDE_JOB_TYPES = $ExcludePollJobTypes.Trim()
  $env:NAS_WORKER_LABEL = "full"
} else {
  $env:NAS_WORKER_LABEL = "full"
}

Write-Host "==> [5/6] Current config"
Write-Host "API_BASE_URL=$env:NAS_API_BASE_URL"
Write-Host "MOUNT_ROOT=$env:NAS_MOUNT_ROOT"
Write-Host "POLL_INTERVAL_SECONDS=$env:NAS_POLL_INTERVAL_SECONDS"
Write-Host "HTTP_TIMEOUT_SECONDS=$env:NAS_HTTP_TIMEOUT_SECONDS"
Write-Host "PREPARE_UPLOAD_TIMEOUT_SECONDS=$env:NAS_PREPARE_UPLOAD_TIMEOUT_SECONDS"
Write-Host "DOWNLOAD_CHUNK_SIZE_BYTES=$env:NAS_DOWNLOAD_CHUNK_SIZE_BYTES"
Write-Host "WORKER_CONCURRENCY=$env:NAS_WORKER_CONCURRENCY"
if ($env:NAS_POLL_JOB_TYPES) {
  Write-Host "NAS_POLL_JOB_TYPES=$env:NAS_POLL_JOB_TYPES (poll only these types)"
}
if ($env:NAS_EXCLUDE_JOB_TYPES) {
  Write-Host "NAS_EXCLUDE_JOB_TYPES=$env:NAS_EXCLUDE_JOB_TYPES (skip these; pair with run-derivative-worker.ps1)"
}
if ($env:NAS_POLL_JOB_TYPES -match "analyze_content") {
  Write-Host "NAS_VLM_BASE_URL=$(if ($env:NAS_VLM_BASE_URL) { $env:NAS_VLM_BASE_URL } else { 'http://127.0.0.1:23333/v1 (default)' })"
  Write-Host "NAS_VLM_MODEL=$(if ($env:NAS_VLM_MODEL) { $env:NAS_VLM_MODEL } else { 'Qwen2.5-VL-7B-Instruct (default)' })"
  Write-Host "Hint: start a Qwen OpenAI-compatible server first, e.g. nas-client\run-qwen-vlm.cmd"
}
Write-Host "NAS_WORKER_LABEL=$env:NAS_WORKER_LABEL"
Write-Host "Hint: 16777216 = 16MB, 8388608 = 8MB"

if ($env:NAS_EXCLUDE_JOB_TYPES -match "generate_derivatives") {
  Write-Host ""
  Write-Host "  *** REQUIRED PAIR ***" -ForegroundColor Red
  Write-Host "  This window does NOT run job_type=generate_derivatives (no ffmpeg thumbnail, no MP4 faststart)." -ForegroundColor Red
  Write-Host "  You MUST also run run-derivative-worker.ps1 in another window, OR use start-nas-direct-services.bat (starts both)." -ForegroundColor Yellow
  Write-Host "  Otherwise large MP4 in-browser playback stays broken (moov-at-end) and derivative jobs never finish." -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "==> [6/6] Start worker (Ctrl+C to stop; auto-restart if worker.py exits)"
# If python crashes/OOM-exits, keep the PowerShell child alive and relaunch.
# Otherwise start-nas MAIN still looks "up" while lan_yue2 jobs sit pending forever.
$restartDelaySec = 5
while ($true) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] launching worker.py" -ForegroundColor Cyan
  & python worker.py
  $code = $LASTEXITCODE
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] worker.py exited (code=$code). Restarting in ${restartDelaySec}s..." -ForegroundColor Yellow
  Start-Sleep -Seconds $restartDelaySec
  if ($restartDelaySec -lt 60) {
    $restartDelaySec = [Math]::Min(60, $restartDelaySec + 5)
  }
}
