@echo off
REM Must be ASCII-only: cmd.exe uses system ANSI (e.g. GBK); UTF-8 breaks parsing on Chinese paths.
cd /d "%~dp0"
if not exist "package.json" (
  echo [LCP] ERROR: package.json not found. Keep this .bat inside desktop-client folder.
  pause
  exit /b 1
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [LCP] ERROR: powershell.exe not found.
  pause
  exit /b 1
)
echo [LCP] Launching run-desktop.ps1 ...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-desktop.ps1"
set "EC=%ERRORLEVEL%"
echo.
pause
exit /b %EC%
