@echo off
REM Quick check: local-env.bat GH_TOKEN can call GitHub API (before full pack+publish).
cd /d "%~dp0"
if not exist "local-env.bat" (
  echo [LCP Pack] ERROR: missing local-env.bat
  echo Copy local-env.example.bat to local-env.bat and set GH_TOKEN=ghp_your_token
  pause
  exit /b 1
)
call "%~dp0local-env.bat"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-desktop.ps1" -TestGitHubTokenOnly
exit /b %ERRORLEVEL%
