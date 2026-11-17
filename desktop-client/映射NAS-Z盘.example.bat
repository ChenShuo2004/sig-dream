@echo off
REM Copy to map-nas-z-drive.bat or 映射NAS-Z盘.bat (gitignored). Uses repo local-env.bat for NAS_PASSWORD.
REM Or set NAS_PASS manually below. ASCII only in the local copy.

setlocal EnableExtensions
cd /d "%~dp0"

if exist "%~dp0..\local-env.bat" call "%~dp0..\local-env.bat"
if exist "%~dp0local-env.bat" call "%~dp0local-env.bat"

set "NAS_HOST=YOUR_NAS_HOST"
set "NAS_SHARE=nas-file"
set "DRIVE_LETTER=Z:"
set "NAS_USER=YOUR_NAS_USER"
if not "%NAS_PASSWORD%"=="" set "NAS_PASS=%NAS_PASSWORD%"
if "%NAS_PASS%"=="" set "NAS_PASS=CHANGE_ME"

if /i "%NAS_PASS%"=="CHANGE_ME" (
  echo ERROR: Set NAS_PASSWORD in repo local-env.bat or NAS_PASS in this script.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-nas-smb.ps1"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" pause
exit /b %EC%
