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