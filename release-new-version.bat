@echo off
REM ASCII-only: UTF-8 Chinese in .bat breaks under GBK cmd (random 'xxx' is not a command).
title Release New Version

REM One-click: git commit or skip empty, push, deploy-oneclick.ps1 over SSH.
REM Copy local-env.example.bat to local-env.bat and set SERVER_HOST, DEPLOY_SSH_IDENTITY_FILE, etc.
REM Postgres must be reachable from ECS for alembic. See md dated 2026-05-03 for Postgres and .env.
REM After deploy, pg_dump restore: set DEPLOY_PG_DUMP_SQL in local-env.bat and run import batch (see local-env.example.bat).
REM Optional: set DEPLOY_NAS_CLIENT_TOKEN in local-env.bat (same as nas-client-token.txt) to merge ECS backend/.env NAS_CLIENT_TOKEN after deploy + restart API.
REM Optional in local-env.bat: MIGRATE_SKIP_COMMIT=1, BUILD_VERSION=...
REM Before remote deploy.sh, deploy-oneclick.ps1 runs ECS pg_dump + scp to BACKUP_OUTPUT_DIR (default repo root) so a failed deploy still left a fresh SQL on disk. To skip: set DEPLOY_POST_RELEASE_DB_BACKUP=0

set "ROOT_DIR=%~dp0"
set "DEPLOY_SCRIPT=deploy-oneclick.ps1"
set "LOCAL_ENV=%ROOT_DIR%local-env.bat"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if exist "%LOCAL_ENV%" (
  call "%LOCAL_ENV%"
)

pushd "%ROOT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot enter project directory: "%ROOT_DIR%"
  pause
  exit /b 1
)

if not exist "%DEPLOY_SCRIPT%" (
  echo [ERROR] Missing file: "%DEPLOY_SCRIPT%"
  popd
  pause
  exit /b 1
)
if not exist "%POWERSHELL_EXE%" (
  echo [ERROR] Missing powershell executable: "%POWERSHELL_EXE%"
  popd
  pause
  exit /b 1
)

if "%COMMIT_MESSAGE%"=="" set /p COMMIT_MESSAGE=Enter commit message, default if empty:
if "%COMMIT_MESSAGE%"=="" set "COMMIT_MESSAGE=chore: one-click release"

if "%SERVER_USER%"=="" set "SERVER_USER=root"
if "%SERVER_HOST%"=="" set "SERVER_HOST="
if "%REMOTE_APP_DIR%"=="" set "REMOTE_APP_DIR=/root/apps/light_content_workflow_platform"

REM Remote apt installs python3-venv before deploy. Set DEPLOY_REMOTE_PREP_PYTHON_VENV=0 in local-env.bat to skip.
if "%DEPLOY_REMOTE_PREP_PYTHON_VENV%"=="" set "DEPLOY_REMOTE_PREP_PYTHON_VENV=1"

REM First ECS: auto git clone when remote app dir is missing. Set DEPLOY_REMOTE_AUTO_CLONE=0 in local-env.bat to skip.
if "%DEPLOY_REMOTE_AUTO_CLONE%"=="" set "DEPLOY_REMOTE_AUTO_CLONE=1"

REM When DATABASE_URL is localhost and 5432 is down, remote deploy.sh can apt-install PostgreSQL. Set DEPLOY_BOOTSTRAP_POSTGRES=0 if you use RDS only.
if "%DEPLOY_BOOTSTRAP_POSTGRES%"=="" set "DEPLOY_BOOTSTRAP_POSTGRES=1"

set "CLONE_ARG="
if /i "%DEPLOY_REMOTE_AUTO_CLONE%"=="1" set "CLONE_ARG=-RemoteAutoCloneIfMissing"

echo.
echo == One-click deploy ==
echo Server: %SERVER_USER%@%SERVER_HOST%
echo RemoteAppDir: %REMOTE_APP_DIR%
echo DEPLOY_REMOTE_PREP_PYTHON_VENV=%DEPLOY_REMOTE_PREP_PYTHON_VENV%
echo DEPLOY_REMOTE_AUTO_CLONE=%DEPLOY_REMOTE_AUTO_CLONE%
echo DEPLOY_BOOTSTRAP_POSTGRES=%DEPLOY_BOOTSTRAP_POSTGRES%
if /i "%MIGRATE_SKIP_COMMIT%"=="1" echo MIGRATE_SKIP_COMMIT=1 (no local commit)
if not "%BUILD_VERSION%"=="" echo BUILD_VERSION=%BUILD_VERSION%
if defined DEPLOY_NAS_CLIENT_TOKEN echo DEPLOY_NAS_CLIENT_TOKEN=set (remote .env merge after deploy)
if /i "%DEPLOY_POST_RELEASE_DB_BACKUP%"=="0" (
  echo DEPLOY_POST_RELEASE_DB_BACKUP=0 ^(skip integrated DB backup^)
) else (
  echo Pre-deploy DB backup: on ^(pg_dump+scp before deploy.sh; set DEPLOY_POST_RELEASE_DB_BACKUP=0 to skip^)
)
if defined BACKUP_OUTPUT_DIR echo BACKUP_OUTPUT_DIR=%BACKUP_OUTPUT_DIR%
echo.

if /i "%MIGRATE_SKIP_COMMIT%"=="1" (
  if not "%BUILD_VERSION%"=="" (
    "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\%DEPLOY_SCRIPT%" -CommitMessage "%COMMIT_MESSAGE%" -ServerUser "%SERVER_USER%" -ServerHost "%SERVER_HOST%" -RemoteAppDir "%REMOTE_APP_DIR%" -SkipCommit -BuildVersion "%BUILD_VERSION%" %CLONE_ARG%
  ) else (
    "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\%DEPLOY_SCRIPT%" -CommitMessage "%COMMIT_MESSAGE%" -ServerUser "%SERVER_USER%" -ServerHost "%SERVER_HOST%" -RemoteAppDir "%REMOTE_APP_DIR%" -SkipCommit %CLONE_ARG%
  )
) else (
  if not "%BUILD_VERSION%"=="" (
    "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\%DEPLOY_SCRIPT%" -CommitMessage "%COMMIT_MESSAGE%" -ServerUser "%SERVER_USER%" -ServerHost "%SERVER_HOST%" -RemoteAppDir "%REMOTE_APP_DIR%" -BuildVersion "%BUILD_VERSION%" %CLONE_ARG%
  ) else (
    "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\%DEPLOY_SCRIPT%" -CommitMessage "%COMMIT_MESSAGE%" -ServerUser "%SERVER_USER%" -ServerHost "%SERVER_HOST%" -RemoteAppDir "%REMOTE_APP_DIR%" %CLONE_ARG%
  )
)
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] Deploy finished.
) else (
  echo [ERROR] Deploy failed, exit code: %EXIT_CODE%
)
popd
pause
exit /b %EXIT_CODE%
