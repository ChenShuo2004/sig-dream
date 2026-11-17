@echo off
REM ASCII only. If window flashes: check local-env.bat must use "exit /b" not "exit" when returning.
setlocal EnableDelayedExpansion
cd /d "%~dp0" 2>nul
if errorlevel 1 (
  echo [ERROR] cd to script dir failed.
  pause
  exit /b 1
)

set "ROOT_DIR=%cd%"
set "RESTORE_SCRIPT=restore-ecs-database.ps1"
set "LOCAL_ENV=%ROOT_DIR%\local-env.bat"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if exist "%LOCAL_ENV%" call "%LOCAL_ENV%"

if not "%~1"=="" set "DEPLOY_PG_DUMP_SQL=%~1"

if "!DEPLOY_PG_DUMP_SQL!"=="" goto :PromptSql
goto :AfterPrompt

:PromptSql
echo.
echo === Import PostgreSQL dump to ECS ===
echo If you see "relation ... already exists", the ECS DB already has tables. Either restore to an empty
echo database, or set DEPLOY_PG_RESTORE_WIPE=1 in local-env.bat ^(or pass -WipePublicSchemaFirst to ps1^)
echo to DROP SCHEMA public CASCADE before import ^(destructive^).
echo.
echo Enter FULL path to .sql file, then press Enter (you can drag the file into this window).
echo.
set "DEPLOY_PG_DUMP_SQL="
set /p "DEPLOY_PG_DUMP_SQL=SQL file path: "
REM Normalize: remove surrounding quotes from drag-drop / paste
if defined DEPLOY_PG_DUMP_SQL (
  for %%I in ("!DEPLOY_PG_DUMP_SQL!") do set "DEPLOY_PG_DUMP_SQL=%%~I"
)
if not defined DEPLOY_PG_DUMP_SQL (
  echo [ERROR] Path is empty.
  pause
  exit /b 1
)
if "!DEPLOY_PG_DUMP_SQL!"=="" (
  echo [ERROR] Path is empty.
  pause
  exit /b 1
)

:AfterPrompt
if not exist "!DEPLOY_PG_DUMP_SQL!" (
  echo [ERROR] File not found: "!DEPLOY_PG_DUMP_SQL!"
  pause
  exit /b 1
)

if not exist "%RESTORE_SCRIPT%" (
  echo [ERROR] Missing: "%ROOT_DIR%\%RESTORE_SCRIPT%"
  pause
  exit /b 1
)
if not exist "%POWERSHELL_EXE%" (
  echo [ERROR] Missing PowerShell: "%POWERSHELL_EXE%"
  pause
  exit /b 1
)

if "%SERVER_USER%"=="" set "SERVER_USER=root"
if "%SERVER_HOST%"=="" set "SERVER_HOST="
if "%REMOTE_APP_DIR%"=="" set "REMOTE_APP_DIR=/root/apps/light_content_workflow_platform"

echo.
echo == Restore DB to ECS (no code deploy) ==
echo Server: %SERVER_USER%@%SERVER_HOST%
echo RemoteAppDir: %REMOTE_APP_DIR%
echo SQL: !DEPLOY_PG_DUMP_SQL!
echo.

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%\%RESTORE_SCRIPT%" -SqlPath "!DEPLOY_PG_DUMP_SQL!" -ServerUser "%SERVER_USER%" -ServerHost "%SERVER_HOST%" -RemoteAppDir "%REMOTE_APP_DIR%"
set "ERR=!ERRORLEVEL!"

echo.
if "!ERR!"=="0" (
  echo [OK] Database restore finished.
) else (
  echo [ERROR] Failed, exit code: !ERR!
)
pause
endlocal & exit /b %ERR%
