@echo off
REM Local Next.js dev server for UI checks. ASCII-only in REM lines (GBK cmd).
title light_content_workflow_platform - local UI

setlocal
set "ROOT_DIR=%~dp0"
set "LOCAL_ENV=%ROOT_DIR%local-env.bat"

if exist "%LOCAL_ENV%" (
  call "%LOCAL_ENV%"
)

pushd "%ROOT_DIR%frontend" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot cd to: "%ROOT_DIR%frontend"
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not in PATH. Install Node.js LTS and reopen this window.
  popd
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [INFO] node_modules missing, running npm install ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    pause
    exit /b 1
  )
)

echo.
echo [INFO] Next.js: http://127.0.0.1:3000
echo [INFO] /api-proxy rewrites to NEXT_PUBLIC_API_BASE_URL or default http://127.0.0.1:8000 (see frontend/next.config.ts)
echo [INFO] Start backend on :8000 when you need real API data.
echo.
call npm run dev:local
set "ERR=%ERRORLEVEL%"
popd >nul 2>nul
if not "%ERR%"=="0" (
  echo [ERROR] dev server exited with code %ERR%
  pause
  exit /b %ERR%
)

endlocal
exit /b 0
