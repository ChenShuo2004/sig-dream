# One-shot: GET /nas-jobs/poll with X-NAS-Client-Token. Run from nas-client folder.
# Usage: .\verify-nas-token.ps1   OR   .\verify-nas-token.ps1 -NasClientToken "yourtoken" -ApiBaseUrl "http://IP:8000"

param(
  [string]$NasClientToken = "",
  [string]$ApiBaseUrl = ""
)

$ErrorActionPreference = "Continue"
$nasDir = $PSScriptRoot
. "$nasDir\_resolve-nas-api-base.ps1"
$ApiBaseUrl = Resolve-NasApiBaseUrl -Override $ApiBaseUrl -ScriptRoot $nasDir

if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  $tf = Join-Path $nasDir "nas-client-token.txt"
  if (Test-Path -LiteralPath $tf) {
    foreach ($line in Get-Content -LiteralPath $tf -Encoding UTF8) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith("#")) { continue }
      $NasClientToken = $t
      break
    }
  }
}
$NasClientToken = ([string]$NasClientToken).Trim().TrimStart([char]0xFEFF)
if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  Write-Host "[ERROR] No token: set nas-client-token.txt or pass -NasClientToken" -ForegroundColor Red
  exit 1
}

$base = $ApiBaseUrl.TrimEnd("/")
$uri = "$base/nas-jobs/poll"
Write-Host "GET $uri"
Write-Host "Token length: $($NasClientToken.Length) (compare to ECS: wc -c or len of value in backend/.env)"
try {
  $resp = Invoke-WebRequest -Uri $uri -Headers @{ "X-NAS-Client-Token" = $NasClientToken } -UseBasicParsing -TimeoutSec 25
  Write-Host "[OK] HTTP $($resp.StatusCode)" -ForegroundColor Green
  exit 0
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  Write-Host "[FAIL] HTTP $code $($_.Exception.Message)" -ForegroundColor Red
  if ($code -eq 401) {
    Write-Host "ECS value must match exactly. On ECS: grep NAS_CLIENT_TOKEN backend/.env"
    Write-Host "Then: systemctl restart light-content-api"
  }
  exit 1
}
