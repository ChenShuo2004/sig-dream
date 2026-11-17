# Rewrite one-click bats as pure ASCII + CRLF (no BOM).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { throw "root empty" }

function Write-AsciiBat([string]$Path, [string]$Content) {
  $normalized = ($Content -replace "`r`n", "`n" -replace "`n", "`r`n")
  $bytes = [Text.Encoding]::ASCII.GetBytes($normalized)
  [IO.File]::WriteAllBytes($Path, $bytes)
  Write-Host ("wrote {0} bytes={1}" -f $Path, $bytes.Length)
}

$silentWorker = @'
@echo off
REM ASCII-only helper: run starter in silent mode (called detached/hidden).
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
cd /d "%~dp0"
set "NAS_SILENT=1"
call "%~dp0start-nas-direct-services.bat" silent
exit /b %errorlevel%
'@

$restart = @'
@echo off
REM ASCII-only. Stop then start file-machine services with hidden windows.
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "ROOT=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "STOP_PS1=%ROOT%nas-client\file-machine-services.ps1"
set "WORKER=%ROOT%_silent-start-nas.bat"
set "LOG=%ROOT%restart-material-library.log"

> "%LOG%" echo [%date% %time%] restart begin

if not exist "%PS%" (
  echo [ERROR] powershell missing
  exit /b 1
)
if not exist "%STOP_PS1%" (
  echo [ERROR] missing file-machine-services.ps1
  exit /b 1
)
if not exist "%WORKER%" (
  echo [ERROR] missing _silent-start-nas.bat
  exit /b 1
)

echo [1/2] Stopping file-machine services...
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%STOP_PS1%" -Action Stop >> "%LOG%" 2>&1

echo [2/2] Starting (hidden)...
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath '%WORKER%' -WorkingDirectory '%ROOT%.' -WindowStyle Hidden" >> "%LOG%" 2>&1

timeout /t 2 /nobreak >nul
>> "%LOG%" echo [%date% %time%] start launched hidden
echo Done. Services starting in background.
echo Log: "%LOG%"
endlocal & exit /b 0
'@

$start = @'
@echo off
REM ASCII-only. Start file-machine services with hidden windows.
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "ROOT=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "WORKER=%ROOT%_silent-start-nas.bat"
set "LOG=%ROOT%start-material-library.log"

> "%LOG%" echo [%date% %time%] start begin

if not exist "%WORKER%" (
  echo [ERROR] missing _silent-start-nas.bat
  exit /b 1
)

echo Starting file-machine services (hidden)...
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath '%WORKER%' -WorkingDirectory '%ROOT%.' -WindowStyle Hidden" >> "%LOG%" 2>&1

timeout /t 2 /nobreak >nul
>> "%LOG%" echo [%date% %time%] start launched hidden
echo Done. Services starting in background.
echo Log: "%LOG%"
endlocal & exit /b 0
'@

$wrapRestart = @'
@echo off
cd /d "%~dp0"
call "%~dp0restart-material-library.bat" %*
exit /b %errorlevel%
'@

$wrapStart = @'
@echo off
cd /d "%~dp0"
call "%~dp0start-material-library.bat" %*
exit /b %errorlevel%
'@

Write-AsciiBat (Join-Path $root "_silent-start-nas.bat") $silentWorker
Write-AsciiBat (Join-Path $root "restart-material-library.bat") $restart
Write-AsciiBat (Join-Path $root "start-material-library.bat") $start

$yi = [char]0x4E00
$jian = [char]0x952E
$qi = [char]0x542F
$dong = [char]0x52A8
$su = [char]0x7D20
$cai = [char]0x6750
$ku = [char]0x5E93
$chong = [char]0x91CD

$nameStart = "$yi$jian$qi$dong$su$cai$ku.bat"
$nameRestartLib = "$yi$jian$chong$qi$su$cai$ku.bat"
$nameRestart = "$yi$jian$chong$qi.bat"

Write-AsciiBat (Join-Path $root $nameStart) $wrapStart
Write-AsciiBat (Join-Path $root $nameRestartLib) $wrapRestart
Write-AsciiBat (Join-Path $root $nameRestart) $wrapRestart

$check = @(
  "_silent-start-nas.bat",
  "restart-material-library.bat",
  "start-material-library.bat",
  $nameStart, $nameRestartLib, $nameRestart
)
foreach ($leaf in $check) {
  $p = Join-Path $root $leaf
  $b = [IO.File]::ReadAllBytes($p)
  $non = @($b | Where-Object { $_ -gt 127 }).Count
  if ($non -ne 0) { throw "non-ASCII in $leaf count=$non" }
  Write-Host ("verify OK {0}" -f $leaf)
}
