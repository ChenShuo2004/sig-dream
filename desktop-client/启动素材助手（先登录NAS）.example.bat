@echo off
REM For installed desktop app on LAN PCs. Copy and edit DESKTOP_EXE path.
REM Requires repo local-env.bat with NAS_PASSWORD, or copy map-nas-z-drive.bat once.

setlocal EnableExtensions
cd /d "%~dp0"

if exist "%~dp0..\local-env.bat" call "%~dp0..\local-env.bat"
if exist "%~dp0local-env.bat" call "%~dp0local-env.bat"

REM Edit: path to installed 桌面素材助手.exe
set "DESKTOP_EXE=C:\Program Files\桌面素材助手\桌面素材助手.exe"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-nas-smb.ps1"
if errorlevel 1 (
  echo NAS login failed.
  pause
  exit /b 1
)

if not exist "%DESKTOP_EXE%" (
  echo ERROR: Edit DESKTOP_EXE in this script. File not found: %DESKTOP_EXE%
  pause
  exit /b 1
)

start "" "%DESKTOP_EXE%"
exit /b 0
