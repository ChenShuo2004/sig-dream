param(
  [string]$ApiBaseUrl = "",
  [string]$NasClientToken = "",
  [string]$LanUploadBaseUrl = "http://127.0.0.1:9001",
  [string]$LanDownloadBaseUrl = "http://127.0.0.1:9001",
  [string]$PublicUploadBaseUrl = "",
  [string]$PublicDownloadBaseUrl = "",
  [string]$PoolId = "default",
  [string]$NodeId = "",
  [int]$IntervalSeconds = 45
)

$ErrorActionPreference = "Stop"

$NasClientToken = ([string]$NasClientToken).Trim().TrimStart([char]0xFEFF)

. "$PSScriptRoot\_resolve-nas-api-base.ps1"
$ApiBaseUrl = Resolve-NasApiBaseUrl -Override $ApiBaseUrl -ScriptRoot $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  throw "NasClientToken is required (same as NAS worker X-NAS-Client-Token)."
}

if ([string]::IsNullOrWhiteSpace($NodeId)) {
  $NodeId = $env:COMPUTERNAME
  if ([string]::IsNullOrWhiteSpace($NodeId)) { $NodeId = "file-node-1" }
}

$Host.UI.RawUI.WindowTitle = "NAS file-service heartbeat | pool=$PoolId node=$NodeId"
Write-Host "POST $ApiBaseUrl/nas-jobs/file-service/heartbeat every ${IntervalSeconds}s (Ctrl+C to stop)." -ForegroundColor Cyan
Write-Host "PoolId=$PoolId NodeId=$NodeId" -ForegroundColor Gray
Write-Host "LanUploadBaseUrl=$LanUploadBaseUrl" -ForegroundColor Gray
Write-Host "LanDownloadBaseUrl=$LanDownloadBaseUrl" -ForegroundColor Gray
Write-Host "PublicUploadBaseUrl=$PublicUploadBaseUrl" -ForegroundColor Gray
Write-Host "PublicDownloadBaseUrl=$PublicDownloadBaseUrl" -ForegroundColor Gray
Write-Host ""

$api = $ApiBaseUrl.TrimEnd("/")
$headers = @{
  "X-NAS-Client-Token" = $NasClientToken
  "Content-Type"       = "application/json"
}

while ($true) {
  $body = @{
    pool_id                  = $PoolId
    node_id                  = $NodeId
    lan_upload_base_url      = $LanUploadBaseUrl.TrimEnd("/")
    lan_download_base_url    = $LanDownloadBaseUrl.TrimEnd("/")
    public_upload_base_url   = ([string]$PublicUploadBaseUrl).Trim().TrimEnd("/")
    public_download_base_url = ([string]$PublicDownloadBaseUrl).Trim().TrimEnd("/")
    status                   = "online"
  } | ConvertTo-Json -Compress

  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$api/nas-jobs/file-service/heartbeat" -Headers $headers -Body $body -TimeoutSec 30
    Write-Host ("[{0}] ok pool={1} node={2} status={3}" -f (Get-Date -Format "HH:mm:ss"), $resp.pool_id, $resp.node_id, $resp.status) -ForegroundColor Green
  } catch {
    Write-Host ("[{0}] fail {1}" -f (Get-Date -Format "HH:mm:ss"), $_.Exception.Message) -ForegroundColor Red
  }

  Start-Sleep -Seconds $IntervalSeconds
}
