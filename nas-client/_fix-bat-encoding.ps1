$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$names = @(
  "restart-material-library.bat",
  "start-material-library.bat",
  "start-nas-direct-services.bat"
)
Get-ChildItem -LiteralPath $root -Filter "*.bat" | ForEach-Object {
  $b = [IO.File]::ReadAllBytes($_.FullName)
  $bom = if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { "UTF8-BOM" } else { "no-BOM" }
  $non = @($b | Where-Object { $_ -gt 127 }).Count
  if ($non -gt 0 -or $_.Name -like "*material*" -or $_.Name -like "*restart*" -or $_.Name -like "*start-nas*") {
    Write-Output ("{0} : {1} nonAscii={2} size={3}" -f $_.Name, $bom, $non, $b.Length)
  }
}
