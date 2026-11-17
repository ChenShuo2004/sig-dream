@echo off
REM ASCII-only: UTF-8 Chinese in .bat breaks under GBK cmd.
REM One-click: SSH to ECS, install nginx if needed, write reverse-proxy to local Next (default 127.0.0.1:3000), reload nginx.
REM Set SERVER_USER, SERVER_HOST, DEPLOY_SSH_IDENTITY_FILE in local-env.bat (same as release-new-version.bat).
REM Set NGINX_SERVER_NAME=yideapi.com www.yideapi.com in local-env.bat or you will be prompted in PowerShell.

title Setup Nginx reverse proxy (ECS)

set "ROOT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "LOCAL_ENV=%ROOT_DIR%local-env.bat"

if exist "%LOCAL_ENV%" (
  call "%LOCAL_ENV%"
)

if not defined SERVER_HOST (
  echo [ERROR] SERVER_HOST is not set. Add SERVER_HOST=your.ecs.public.ip to local-env.bat ^(same as release-new-version.bat^).
  pause
  exit /b 1
)

pushd "%ROOT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot enter: "%ROOT_DIR%"
  pause
  exit /b 1
)

if not exist "%ROOT_DIR%setup-nginx-reverse-proxy.ps1" (
  echo [ERROR] Missing setup-nginx-reverse-proxy.ps1
  popd
  pause
  exit /b 1
)

echo.
echo == Nginx reverse proxy on ECS ==
echo Server: %SERVER_USER%@%SERVER_HOST%
if defined NGINX_SERVER_NAME echo NGINX_SERVER_NAME=%NGINX_SERVER_NAME%
if defined NGINX_UPSTREAM_PORT echo NGINX_UPSTREAM_PORT=%NGINX_UPSTREAM_PORT%
if defined NGINX_LISTEN_PORT echo NGINX_LISTEN_PORT=%NGINX_LISTEN_PORT%
echo.

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\setup-nginx-reverse-proxy.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd

if "%EXIT_CODE%"=="0" (
  echo [OK] Nginx configured.
) else (
  echo [ERROR] Exit code: %EXIT_CODE%
)
pause
exit /b %EXIT_CODE%
