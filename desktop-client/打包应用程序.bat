@echo off
REM ASCII-only launcher: pack Windows installers (+ macOS hint). Keep inside desktop-client.
cd /d "%~dp0"
if not exist "package.json" (
  echo [LCP Pack] ERROR: package.json not found. Keep this .bat inside desktop-client folder.
  pause
  exit /b 1
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [LCP Pack] ERROR: powershell.exe not found.
  pause
  exit /b 1
)
echo [LCP Pack] Desktop Material Assistant - build installers
echo [LCP Pack] Windows: NSIS setup + ZIP  ^(this machine^)
echo [LCP Pack] macOS:   DMG + ZIP on a Mac only ^(see 打包应用程序-mac.sh^)
echo [LCP Pack] Publish: run 打包并发布到GitHub.bat ^(needs GITHUB_TOKEN^)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-desktop.ps1" -Platform win
set "EC=%ERRORLEVEL%"
echo.
pause
exit /b %EC%
