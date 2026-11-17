# SSH to ECS: install nginx if missing, write site for reverse-proxy to local Next (default 127.0.0.1:3000), nginx -t + reload.
# Reuses SERVER_USER, SERVER_HOST, DEPLOY_SSH_IDENTITY_FILE, DEPLOY_SSH_INTERACTIVE from local-env.bat (same as release-new-version).

param(
  [string]$ServerUser = "",
  [string]$ServerHost = "",
  [string]$SshIdentityFile = "",
  [bool]$SshInteractivePassword = $false,
  # Space-separated server_name values, e.g. "yideapi.com www.yideapi.com"
  [string]$ServerNames = "",
  [int]$ListenPort = 80,
  [string]$UpstreamHost = "127.0.0.1",
  [int]$UpstreamPort = 3000
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ([string]::IsNullOrWhiteSpace($ServerUser) -and $env:SERVER_USER) { $ServerUser = "$($env:SERVER_USER)".Trim() }
if ([string]::IsNullOrWhiteSpace($ServerHost) -and $env:SERVER_HOST) { $ServerHost = "$($env:SERVER_HOST)".Trim().Trim('"') }
if ([string]::IsNullOrWhiteSpace($ServerUser)) { $ServerUser = "root" }
if ([string]::IsNullOrWhiteSpace($ServerHost)) {
  throw "SERVER_HOST is empty. Set SERVER_HOST in local-env.bat (run setup-nginx-reverse-proxy.bat so local-env is applied) or pass -ServerHost 'x.x.x.x'. Do not rely on a built-in default IP."
}

if ([string]::IsNullOrWhiteSpace($SshIdentityFile) -and $env:DEPLOY_SSH_IDENTITY_FILE) {
  $SshIdentityFile = $env:DEPLOY_SSH_IDENTITY_FILE.Trim().Trim('"')
}
if (-not $SshInteractivePassword) {
  $rawInteractive = if ($null -ne $env:DEPLOY_SSH_INTERACTIVE) { "$($env:DEPLOY_SSH_INTERACTIVE)".Trim() } else { "" }
  if ($rawInteractive -in @("1", "true", "yes", "Y", "y")) {
    $SshInteractivePassword = $true
  }
}

if ([string]::IsNullOrWhiteSpace($ServerNames) -and $env:NGINX_SERVER_NAME) {
  $ServerNames = "$($env:NGINX_SERVER_NAME)".Trim().Trim('"')
}
if ($null -ne $env:NGINX_LISTEN_PORT -and "$($env:NGINX_LISTEN_PORT)".Trim() -match '^\d+$') {
  $ListenPort = [int]"$($env:NGINX_LISTEN_PORT)".Trim()
}
if ($null -ne $env:NGINX_UPSTREAM_HOST -and -not [string]::IsNullOrWhiteSpace("$($env:NGINX_UPSTREAM_HOST)".Trim())) {
  $UpstreamHost = "$($env:NGINX_UPSTREAM_HOST)".Trim().Trim('"')
}
if ($null -ne $env:NGINX_UPSTREAM_PORT -and "$($env:NGINX_UPSTREAM_PORT)".Trim() -match '^\d+$') {
  $UpstreamPort = [int]"$($env:NGINX_UPSTREAM_PORT)".Trim()
}

if ([string]::IsNullOrWhiteSpace($ServerNames)) {
  $ServerNames = (Read-Host "Enter server_name (space-separated), e.g. yideapi.com www.yideapi.com").Trim()
}
if ([string]::IsNullOrWhiteSpace($ServerNames)) {
  throw "server_name is required. Set NGINX_SERVER_NAME in local-env.bat or pass -ServerNames."
}
if ($ServerNames -match '[;{}#\\$`]') {
  throw "server_name contains forbidden characters. Use letters, digits, dot, hyphen only (space-separated)."
}
if ($ListenPort -lt 1 -or $ListenPort -gt 65535) { throw "ListenPort out of range" }
if ($UpstreamPort -lt 1 -or $UpstreamPort -gt 65535) { throw "UpstreamPort out of range" }

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

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$StdinFile = $null,
    [int]$RetryCount = 1,
    [int]$RetryDelaySec = 5
  )
  $useStdinFile = $PSBoundParameters.ContainsKey("StdinFile") -and -not [string]::IsNullOrWhiteSpace($StdinFile)
  $attempt = 1
  while ($attempt -le [Math]::Max(1, $RetryCount)) {
    Write-Host ">> $FilePath $($Arguments -join ' ') (attempt $attempt/$RetryCount)"
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
      } else {
        $out = & $FilePath @Arguments 2>&1
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
      return
    }
    if ($attempt -ge $RetryCount) {
      throw "Command failed (exit $exitCode): $FilePath $($Arguments -join ' ')"
    }
    Write-Host "Retry in ${RetryDelaySec}s..." -ForegroundColor Yellow
    Start-Sleep -Seconds $RetryDelaySec
    $attempt++
  }
}

$sshTarget = "${ServerUser}@${ServerHost}"
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
$sshArgsList.AddRange(
  [string[]]@(
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=10",
    "-o", "ServerAliveCountMax=3",
    [string]$sshTarget,
    "bash -s"
  )
)
$sshArgsArray = $sshArgsList.ToArray()

$heredocMarker = "LCWPNGINX_" + [guid]::NewGuid().ToString("n").ToUpperInvariant() + "_EOF"
$nginxSite = @"
server {
    listen $ListenPort;
    server_name $ServerNames;

    location / {
        proxy_pass http://${UpstreamHost}:${UpstreamPort};
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
    }
}
"@

$remoteScript = @"
set -euo pipefail
echo '[lcwp-nginx] target: $sshTarget'
export DEBIAN_FRONTEND=noninteractive
if command -v nginx >/dev/null 2>&1; then
  echo '[lcwp-nginx] nginx already installed'
elif command -v apt-get >/dev/null 2>&1; then
  echo '[lcwp-nginx] installing nginx (apt)...'
  apt-get update -qq
  apt-get install -y nginx
elif command -v dnf >/dev/null 2>&1; then
  echo '[lcwp-nginx] installing nginx (dnf)...'
  dnf install -y nginx
elif command -v yum >/dev/null 2>&1; then
  echo '[lcwp-nginx] installing nginx (yum)...'
  yum install -y nginx
else
  echo '[lcwp-nginx][error] cannot install nginx: no apt-get/dnf/yum'
  exit 2
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true
if [ -d /etc/nginx/sites-enabled ]; then
  cat > /etc/nginx/sites-available/lcwp-frontend.conf <<'$heredocMarker'
$nginxSite
$heredocMarker
  ln -sf /etc/nginx/sites-available/lcwp-frontend.conf /etc/nginx/sites-enabled/lcwp-frontend.conf
  if [ -e /etc/nginx/sites-enabled/default ]; then
    echo '[lcwp-nginx] disabling stock default site (Debian-style)'
    rm -f /etc/nginx/sites-enabled/default
  fi
else
  echo '[lcwp-nginx] no sites-enabled; writing conf.d/lcwp-frontend.conf'
  cat > /etc/nginx/conf.d/lcwp-frontend.conf <<'$heredocMarker'
$nginxSite
$heredocMarker
fi

nginx -t
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable nginx 2>/dev/null || true
  systemctl reload nginx || systemctl restart nginx
else
  nginx -s reload || true
fi
echo '[lcwp-nginx] done. listen $ListenPort -> http://${UpstreamHost}:${UpstreamPort} server_name $ServerNames'
"@

$remoteScript = $remoteScript.Replace("`r", "")
$normalized = ((($remoteScript -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n")
$tmpPath = Join-Path ([System.IO.Path]::GetTempPath()) ("lcwp-nginx-setup-" + [guid]::NewGuid().ToString("n") + ".sh")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
  [System.IO.File]::WriteAllText($tmpPath, $normalized, $utf8NoBom)
  Write-Host ""
  Write-Host "== Nginx reverse proxy on ECS ==" -ForegroundColor Cyan
  Write-Host "  SSH: $sshTarget"
  Write-Host "  listen: $ListenPort  server_name: $ServerNames"
  Write-Host "  proxy_pass: http://${UpstreamHost}:${UpstreamPort}"
  Write-Host ""
  Invoke-Native -FilePath "ssh" -Arguments $sshArgsArray -StdinFile $tmpPath -RetryCount 1 -RetryDelaySec 8
} finally {
  Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "[ok] Nginx site written: /etc/nginx/sites-available/lcwp-frontend.conf" -ForegroundColor Green
Write-Host "Open ECS security group for TCP $ListenPort if users reach the site by domain/IP on that port." -ForegroundColor DarkGray
