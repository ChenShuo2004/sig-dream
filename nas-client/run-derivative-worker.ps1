param(
  [string]$ApiBaseUrl = "",
  [string]$NasShare = "\\YOUR_NAS_HOST\nas-file",
  [string]$NasDrive = "Z:",
  [string]$NasUser = "PA",
  [string]$NasPassword = "",
  [string]$NasClientToken = "",
  [string]$MountRoot = "Z:\material-assets",
  [int]$PollIntervalSeconds = 2,
  [int]$HttpTimeoutSeconds = 120,
  [int]$PrepareUploadTimeoutSeconds = 900,
  [int]$DownloadChunkSizeBytes = 16777216,
  [int]$WorkerConcurrency = 2,
  [string]$VlmBaseUrl = "",
  [string]$VlmModel = "",
  [string]$VlmProvider = "",
  [string]$VlmApiKey = ""
)

# Media worker: polls generate_derivatives + analyze_content (ffmpeg and the vision model both run on this PC).
# Keep a separate run-worker.ps1 without -PollJobTypes for store_original / prepare_download.
$here = $PSScriptRoot
& "$here\run-worker.ps1" `
  -ApiBaseUrl $ApiBaseUrl `
  -NasShare $NasShare `
  -NasDrive $NasDrive `
  -NasUser $NasUser `
  -NasPassword $NasPassword `
  -NasClientToken $NasClientToken `
  -MountRoot $MountRoot `
  -PollIntervalSeconds $PollIntervalSeconds `
  -HttpTimeoutSeconds $HttpTimeoutSeconds `
  -PrepareUploadTimeoutSeconds $PrepareUploadTimeoutSeconds `
  -DownloadChunkSizeBytes $DownloadChunkSizeBytes `
  -WorkerConcurrency $WorkerConcurrency `
  -VlmBaseUrl $VlmBaseUrl `
  -VlmModel $VlmModel `
  -VlmProvider $VlmProvider `
  -VlmApiKey $VlmApiKey `
  -PollJobTypes "generate_derivatives,analyze_content"
