param(
  [string]$ApiBaseUrl = "",
  [string]$NasShare = "\\YOUR_NAS_HOST\nas-file",
  [string]$NasDrive = "Z:",
  [string]$NasUser = "PA",
  [string]$NasPassword = "",
  [string]$NasClientToken = "",
  [string]$MountRoot = "Z:\material-assets",
  [string]$BindHost = "0.0.0.0",
  [int]$Port = 9001,
  [int]$TlsPort = 9443,
  [string]$TlsExtraHosts = ""
)

$ErrorActionPreference = "Stop"

$NasClientToken = ([string]$NasClientToken).Trim().TrimStart([char]0xFEFF)
$NasPassword = ([string]$NasPassword).Trim()

. "$PSScriptRoot\_resolve-nas-api-base.ps1"
. "$PSScriptRoot\_office-lan-https.ps1"
$ApiBaseUrl = Resolve-NasApiBaseUrl -Override $ApiBaseUrl -ScriptRoot $PSScriptRoot

# Do not force chcp 65001: avoids garbled text on default CN Windows consoles.

$Host.UI.RawUI.WindowTitle = "NAS LAN transfer | upload + ticket download port $Port"
Write-Host ""
Write-Host "  [This window]" -ForegroundColor Cyan
Write-Host "  Runs download_server.py: HTTP on this machine for LAN upload and ticketed download." -ForegroundColor Gray
Write-Host "  Does NOT poll nas_jobs (unlike run-worker.ps1)." -ForegroundColor Gray
Write-Host ""

if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  throw "NasClientToken is required. Please pass -NasClientToken."
}
if ([string]::IsNullOrWhiteSpace($NasPassword)) {
  throw "NasPassword is required. Please pass -NasPassword."
}

. "$PSScriptRoot\_nas-share-map.ps1"

Write-Host "==> [1/5] Map NAS share to $NasDrive"
Repair-NasNetUse -NasShare $NasShare -NasDrive $NasDrive -NasUser $NasUser -NasPassword $NasPassword

Write-Host "==> [2/5] Ensure mount root $MountRoot"
New-Item -ItemType Directory -Force $MountRoot | Out-Null

Write-Host "==> [3/5] Prepare Python venv"
if (!(Test-Path ".\.venv\Scripts\python.exe")) {
  python -m venv .venv
}
& ".\.venv\Scripts\Activate.ps1"
pip install -r requirements.txt | Out-Null

Write-Host "==> [4/5] Export runtime env"
$env:NAS_API_BASE_URL = $ApiBaseUrl
$env:NAS_CLIENT_TOKEN = $NasClientToken
$env:NAS_MOUNT_ROOT = $MountRoot
$env:NAS_DOWNLOAD_HOST = $BindHost
$env:NAS_DOWNLOAD_PORT = "$Port"

$certDir = Join-Path $PSScriptRoot "certs"
$certPem = Join-Path $certDir "lan-download.crt"
$keyPem = Join-Path $certDir "lan-download.key"
$sanSidecar = Join-Path $certDir "lan-download.hosts"
$sanHosts = @(Get-OfficeLanSanHosts -ExtraHosts @($TlsExtraHosts))
$sanKey = ($sanHosts | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique) -join ","
$needNewCert = $true
if ((Test-Path -LiteralPath $certPem) -and (Test-Path -LiteralPath $keyPem) -and (Test-Path -LiteralPath $sanSidecar)) {
  $prev = ((Get-Content -LiteralPath $sanSidecar -Raw -ErrorAction SilentlyContinue) + "").Trim()
  if ($prev -eq $sanKey) { $needNewCert = $false }
}
if ($TlsPort -gt 0) {
  if ($needNewCert) {
    New-Item -ItemType Directory -Force $certDir | Out-Null
    Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
      Where-Object { $_.FriendlyName -eq "LCP LAN download TLS" } |
      ForEach-Object { Remove-Item -LiteralPath $_.PSPath -Force -ErrorAction SilentlyContinue }
    $sanExt = New-OfficeLanSanExtension -Hosts $sanHosts
    $cert = New-SelfSignedCertificate -Subject "CN=LCP-LAN-download" -NotAfter (Get-Date).AddYears(5) `
      -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 `
      -KeyExportPolicy Exportable -FriendlyName "LCP LAN download TLS" `
      -TextExtension @($sanExt)
    $der = [Convert]::ToBase64String($cert.RawData)
    $crt = New-Object System.Text.StringBuilder
    [void]$crt.AppendLine("-----BEGIN CERTIFICATE-----")
    for ($i = 0; $i -lt $der.Length; $i += 64) {
      [void]$crt.AppendLine($der.Substring($i, [Math]::Min(64, $der.Length - $i)))
    }
    [void]$crt.AppendLine("-----END CERTIFICATE-----")
    Set-Content -LiteralPath $certPem -Value $crt.ToString() -Encoding ascii
    Export-OfficeLanPemKey -Certificate $cert -KeyPath $keyPem
    Set-Content -LiteralPath $sanSidecar -Value $sanKey -Encoding ascii
    Write-Host "Created self-signed TLS cert SAN: $sanKey" -ForegroundColor Yellow
  }
  $env:NAS_DOWNLOAD_TLS_PORT = "$TlsPort"
  $env:NAS_DOWNLOAD_TLS_CERT = $certPem
  $env:NAS_DOWNLOAD_TLS_KEY = $keyPem
}

Write-Host "API_BASE_URL=$env:NAS_API_BASE_URL"
Write-Host "MOUNT_ROOT=$env:NAS_MOUNT_ROOT"
Write-Host ("DOWNLOAD={0}:{1}" -f $env:NAS_DOWNLOAD_HOST, $env:NAS_DOWNLOAD_PORT)
if ($env:NAS_DOWNLOAD_TLS_PORT) {
  Write-Host ("DOWNLOAD_TLS={0}:{1}" -f $env:NAS_DOWNLOAD_HOST, $env:NAS_DOWNLOAD_TLS_PORT)
  $httpsBases = @(Get-OfficeLanHttpsBases -TlsPort $TlsPort)
  if ($httpsBases.Count -eq 0) { $httpsBases = @("https://127.0.0.1:$TlsPort") }
  Write-Host "First visit each LAN HTTPS /health once and continue past the cert warning:" -ForegroundColor Yellow
  foreach ($b in $httpsBases) {
    Write-Host ("  {0}/health" -f $b) -ForegroundColor Yellow
  }
}

Write-Host "==> [5/5] Start LAN transfer server (Ctrl+C to stop)"
python download_server.py
