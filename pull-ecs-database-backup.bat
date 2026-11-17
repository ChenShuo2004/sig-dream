@echo off
REM Pull fixed-path SQL backup from ECS to this PC (file machine). Uses local-env.bat: SERVER_*, DEPLOY_SSH_*, BACKUP_OUTPUT_DIR.
REM ECS side: cron scripts/ecs-backup-db-local.sh so light-content-latest.sql exists.

title Pull ECS database backup

set "ROOT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "LOCAL_ENV=%ROOT_DIR%local-env.bat"

if exist "%LOCAL_ENV%" (
  call "%LOCAL_ENV%"
)

pushd "%ROOT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot enter: "%ROOT_DIR%"
  pause
  exit /b 1
)

if not exist "%ROOT_DIR%pull-ecs-database-backup.ps1" (
  echo [ERROR] Missing pull-ecs-database-backup.ps1
  popd
  pause
  exit /b 1
)

echo.
echo == Pull ECS DB backup ==
echo Server: %SERVER_USER%@%SERVER_HOST%
if defined BACKUP_OUTPUT_DIR echo OutputDir: %BACKUP_OUTPUT_DIR%
if defined ECS_BACKUP_REMOTE_FILE echo RemoteFile: %ECS_BACKUP_REMOTE_FILE%
echo.

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\pull-ecs-database-backup.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd

if "%EXIT_CODE%"=="0" (
  echo [OK] Pull finished.
) else (
  echo [ERROR] Pull failed, exit code: %EXIT_CODE%
)
pause
exit /b %EXIT_CODE%
