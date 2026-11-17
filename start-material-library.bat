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