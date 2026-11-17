function Resolve-NasApiBaseUrl {
  <#
  .SYNOPSIS
    ECS FastAPI base URL for NAS workers / LAN server / heartbeat.
    Priority: explicit -ApiBaseUrl param > nas-client/ecs-api-url.txt > env NAS_API_BASE_URL > fallback.
  #>
  param(
    [string]$Override = "",
    [string]$ScriptRoot = $PSScriptRoot,
    [string]$Fallback = "http://127.0.0.1:8000"
  )
  $u = ($Override | ForEach-Object { "$_".Trim() })
  if (-not [string]::IsNullOrWhiteSpace($u)) {
    return $u.TrimEnd("/")
  }
  $tf = Join-Path $ScriptRoot "ecs-api-url.txt"
  if (Test-Path -LiteralPath $tf) {
    foreach ($ln in Get-Content -LiteralPath $tf -Encoding UTF8) {
      $t = $ln.Trim()
      if ($t -eq "" -or $t.StartsWith("#")) { continue }
      return $t.TrimEnd("/")
    }
  }
  $envUrl = $env:NAS_API_BASE_URL
  if (-not [string]::IsNullOrWhiteSpace($envUrl)) {
    return $envUrl.Trim().TrimEnd("/")
  }
  return $Fallback.TrimEnd("/")
}
