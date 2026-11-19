# Office LAN HTTPS helpers: 192.168.1.0/24 and 192.168.2.0/24.
# Used by run-download-server.ps1 (TLS SAN) and start-nas-direct-services.ps1 (heartbeat).

function Get-OfficeLanIPv4Addresses {
  param(
    [string[]]$ExtraHosts = @()
  )
  $ips = New-Object System.Collections.Generic.List[string]
  function Add-OfficeIp([string]$raw) {
    $ip = ("$raw").Trim().TrimStart("[").TrimEnd("]")
    if ($ip -notmatch '^192\.168\.(1|2)\.(\d{1,3})$') { return }
    $last = [int]$Matches[2]
    if ($last -lt 1 -or $last -gt 254) { return }
    if (-not $ips.Contains($ip)) { [void]$ips.Add($ip) }
  }

  try {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress } |
      ForEach-Object { Add-OfficeIp $_.IPAddress }
  } catch { }

  try {
    $cfg = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=TRUE" -ErrorAction SilentlyContinue
    foreach ($c in @($cfg)) {
      foreach ($ip in @($c.IPAddress)) { Add-OfficeIp "$ip" }
    }
  } catch { }

  foreach ($h in @($ExtraHosts)) {
    if ([string]::IsNullOrWhiteSpace($h)) { continue }
    foreach ($part in ($h -split '[,;\s]+')) { Add-OfficeIp $part }
  }

  $envExtra = [Environment]::GetEnvironmentVariable("NAS_DOWNLOAD_TLS_EXTRA_HOSTS", "Process")
  if (-not [string]::IsNullOrWhiteSpace($envExtra)) {
    foreach ($part in ($envExtra -split '[,;\s]+')) { Add-OfficeIp $part }
  }

  return @($ips)
}

function ConvertTo-LanHttpsBase {
  param(
    [string]$Raw,
    [int]$TlsPort = 9443
  )
  $s = ("$Raw").Trim().TrimEnd("/")
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  if ($s -match '^https://') { return $s }
  if ($s -match '^http://(.+):9001$') { return "https://$($Matches[1]):$TlsPort" }
  if ($s -match '^http://(.+)$') { return "https://$($Matches[1]):$TlsPort" }
  if ($s -match '^[\d\.]+$') { return "https://${s}:$TlsPort" }
  return $s
}

function Get-OfficeLanHttpsBases {
  param(
    [int]$TlsPort = 9443,
    [string[]]$ExtraBases = @()
  )
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $out = New-Object System.Collections.Generic.List[string]
  function Add-Base([string]$raw) {
    $b = ConvertTo-LanHttpsBase -Raw $raw -TlsPort $TlsPort
    if ([string]::IsNullOrWhiteSpace($b)) { return }
    if ($seen.Add($b)) { [void]$out.Add($b) }
  }
  foreach ($ip in (Get-OfficeLanIPv4Addresses)) {
    Add-Base "https://${ip}:$TlsPort"
  }
  foreach ($b in @($ExtraBases)) {
    if ([string]::IsNullOrWhiteSpace($b)) { continue }
    foreach ($part in ($b -split '[,;\s]+')) { Add-Base $part }
  }
  if ($out.Count -eq 0) {
    Add-Base "https://127.0.0.1:$TlsPort"
  }
  return @($out)
}

function Get-OfficeLanSanHosts {
  param(
    [string[]]$ExtraHosts = @()
  )
  $hosts = New-Object System.Collections.Generic.List[string]
  function Add-Host([string]$raw) {
    $h = ("$raw").Trim()
    if ([string]::IsNullOrWhiteSpace($h)) { return }
    if (-not $hosts.Contains($h)) { [void]$hosts.Add($h) }
  }
  Add-Host "localhost"
  Add-Host "127.0.0.1"
  foreach ($ip in (Get-OfficeLanIPv4Addresses -ExtraHosts $ExtraHosts)) {
    Add-Host $ip
  }
  foreach ($h in @($ExtraHosts)) {
    if ([string]::IsNullOrWhiteSpace($h)) { continue }
    foreach ($part in ($h -split '[,;\s]+')) { Add-Host $part.Trim() }
  }
  if (-not ($hosts | Where-Object { $_ -like '192.168.1.*' })) {
    Add-Host "127.0.0.1"
  }
  return @($hosts)
}

function Export-OfficeLanPemKey {
  param(
    [Parameter(Mandatory = $true)]$Certificate,
    [Parameter(Mandatory = $true)][string]$KeyPath
  )
  $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($Certificate)
  if ($null -eq $rsa) { throw "Certificate has no exportable RSA private key." }
  $raw = $null
  $header = "PRIVATE KEY"
  foreach ($method in @("ExportPkcs8PrivateKey", "ExportRSAPrivateKey")) {
    try {
      $fn = $rsa.GetType().GetMethod($method, [Type[]]@())
      if ($null -eq $fn) { continue }
      $raw = $fn.Invoke($rsa, @())
      if ($method -eq "ExportRSAPrivateKey") { $header = "RSA PRIVATE KEY" }
      if ($null -ne $raw) { break }
    } catch { $raw = $null }
  }
  if ($null -eq $raw) {
    $tmpPfx = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "lcp-lan-" + [guid]::NewGuid().ToString("n") + ".pfx")
    $pwdPlain = [guid]::NewGuid().ToString("n")
    $pwd = ConvertTo-SecureString $pwdPlain -AsPlainText -Force
    try {
      Export-PfxCertificate -Cert $Certificate -FilePath $tmpPfx -Password $pwd | Out-Null
      $openssl = Get-Command openssl -ErrorAction SilentlyContinue
      if ($null -eq $openssl) { throw "Cannot export PEM key: this Windows build lacks ExportPkcs8PrivateKey and openssl." }
      $out = & openssl pkcs12 -in $tmpPfx -nocerts -nodes -passin "pass:$pwdPlain" 2>$null
      $pem = ($out | Out-String)
      if ($pem -notmatch "BEGIN .*PRIVATE KEY") { throw "openssl did not return a private key." }
      Set-Content -LiteralPath $KeyPath -Value $pem -Encoding ascii
      return
    } finally {
      Remove-Item -LiteralPath $tmpPfx -Force -ErrorAction SilentlyContinue
    }
  }
  $b64 = [Convert]::ToBase64String([byte[]]$raw)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("-----BEGIN $header-----")
  for ($i = 0; $i -lt $b64.Length; $i += 64) {
    [void]$sb.AppendLine($b64.Substring($i, [Math]::Min(64, $b64.Length - $i)))
  }
  [void]$sb.AppendLine("-----END $header-----")
  Set-Content -LiteralPath $KeyPath -Value $sb.ToString() -Encoding ascii
}

function New-OfficeLanSanExtension {
  param(
    [string[]]$Hosts
  )
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($h in @($Hosts)) {
    if ($h -eq "localhost") {
      [void]$parts.Add("DNS=localhost")
    } elseif ($h -match '^\d{1,3}(\.\d{1,3}){3}$') {
      [void]$parts.Add("IPAddress=$h")
    } elseif (-not [string]::IsNullOrWhiteSpace($h)) {
      [void]$parts.Add("DNS=$h")
    }
  }
  return "2.5.29.17={text}" + ($parts -join "&")
}
