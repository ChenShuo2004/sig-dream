@echo off
REM Build Windows installer and upload to GitHub Releases (GitHub REST API needs PAT in GH_TOKEN).
REM git push in release-new-version.bat uses SSH keys, NOT GH_TOKEN.
cd /d "%~dp0"
if not exist "package.json" (
  echo [LCP Pack] ERROR: package.json not found.
  pause
  exit /b 1
)
echo [LCP Pack] Build + publish to GitHub Releases
if exist "%~dp0local-env.bat" call "%~dp0local-env.bat"
if exist "%~dp0..\local-env.bat" call "%~dp0..\local-env.bat"
echo [LCP Pack] Note: release-new-version.bat git push uses SSH; this script needs GH_TOKEN (ghp_...) in local-env.bat
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-desktop.ps1" -Platform win -PublishGitHub
set "EC=%ERRORLEVEL%"
echo.
if "%EC%"=="0" (
  echo [LCP Pack] OK. See release\ and GitHub Releases page.
) else (
  echo [LCP Pack] Failed. If release\ already has .exe, upload manually after fixing GH_TOKEN.
)
pause
exit /b %EC%
