@echo off
REM ASCII-only: UTF-8 Chinese in .bat breaks under GBK cmd.
REM Backs up PostgreSQL from ECS: reads DATABASE_URL on server, runs pg_dump there, downloads .sql to this PC.
REM Configure server in local-env.bat (same as release-new-version.bat): SERVER_USER, SERVER_HOST, REMOTE_APP_DIR, DEPLOY_SSH_*, BACKUP_OUTPUT_DIR (optional).

title Backup ECS database

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

if not exist "%ROOT_DIR%backup-ecs-database.ps1" (
  echo [ERROR] Missing backup-ecs-database.ps1
  popd
  pause
  exit /b 1
)

echo.
echo == Backup ECS database ==
echo Server: %SERVER_USER%@%SERVER_HOST%
echo RemoteAppDir: %REMOTE_APP_DIR%
if defined BACKUP_OUTPUT_DIR echo OutputDir: %BACKUP_OUTPUT_DIR%
echo.

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\backup-ecs-database.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd

if "%EXIT_CODE%"=="0" (
  echo [OK] Backup finished.
) else (
  echo [ERROR] Backup failed, exit code: %EXIT_CODE%
)
pause
exit /b %EXIT_CODE%
