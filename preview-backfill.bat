@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "LOCAL_ENV=%PROJECT_DIR%local-env.bat"
set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "LOG_FILE=%PROJECT_DIR%preview-backfill-%TS%.log"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PGCONNECT_TIMEOUT=5"
REM Local SSH forward; remote ECS Postgres stays 5432. Override in local-env.bat if needed.
set "DB_TUNNEL_LOCAL_PORT=15432"
call :ensure_log_writable "%LOG_FILE%"
if errorlevel 1 (
  set "LOG_FILE=%PROJECT_DIR%preview-backfill-%RANDOM%-%RANDOM%.log"
  call :ensure_log_writable "%LOG_FILE%"
)
echo ==================================================>> "%LOG_FILE%"
echo [START] %date% %time%>> "%LOG_FILE%"
echo [INFO] log file: %LOG_FILE%

if exist "%LOCAL_ENV%" (
  call "%LOCAL_ENV%"
)
if "%DB_TUNNEL_LOCAL_PORT%"=="" set "DB_TUNNEL_LOCAL_PORT=15432"
set "DB_TUNNEL_TITLE=DB Tunnel %DB_TUNNEL_LOCAL_PORT% -> ECS:5432"

if not exist "%PYTHON_EXE%" (
  echo [INFO] .venv not found, creating virtualenv...
  pushd "%BACKEND_DIR%"
  py -3 -m venv .venv 2>nul
  if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
  )
  if not exist ".venv\Scripts\python.exe" (
    popd
    echo [ERROR] failed to create .venv, please install Python 3 first.
    pause
    exit /b 1
  )
  set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
  echo [INFO] installing backend dependencies...
  powershell -NoProfile -Command "& { & '%PYTHON_EXE%' -m pip install -r 'requirements.txt' 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
  set "RC=!ERRORLEVEL!"
  popd
  if not "!RC!"=="0" (
    echo [ERROR] dependency install failed, exit=!RC!
    pause
    exit /b !RC!
  )
)

"%PYTHON_EXE%" -c "import sqlalchemy" >nul 2>nul
if not "%ERRORLEVEL%"=="0" (
  echo [INFO] missing dependencies, installing from backend/requirements.txt ...
  pushd "%BACKEND_DIR%"
  powershell -NoProfile -Command "& { & '%PYTHON_EXE%' -m pip install -r 'requirements.txt' 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
  set "RC=!ERRORLEVEL!"
  popd
  if not "!RC!"=="0" (
    echo [ERROR] dependency install failed, exit=!RC!
    pause
    exit /b !RC!
  )
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port %DB_TUNNEL_LOCAL_PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  where ssh >nul 2>nul
  if errorlevel 1 (
    echo [WARN] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, and ssh not found in PATH.
    echo [WARN] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, ssh missing.>> "%LOG_FILE%"
  ) else (
    if not "%SERVER_USER%"=="" if not "%SERVER_HOST%"=="" (
      echo [INFO] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, starting DB tunnel window...
      start "%DB_TUNNEL_TITLE%" cmd /k "ssh -o StrictHostKeyChecking=accept-new -L %DB_TUNNEL_LOCAL_PORT%:127.0.0.1:5432 -N %SERVER_USER%@%SERVER_HOST%"
      call :wait_db_tunnel_ready
      if errorlevel 1 (
        echo [ERROR] DB tunnel window opened but localhost:%DB_TUNNEL_LOCAL_PORT% is still unreachable.
        echo [ERROR] DB tunnel not ready.>> "%LOG_FILE%"
        pause
        exit /b 1
      )
      echo [OK] DB tunnel is ready on localhost:%DB_TUNNEL_LOCAL_PORT% -^> ECS:5432
      echo [OK] DB tunnel ready on %DB_TUNNEL_LOCAL_PORT%.>> "%LOG_FILE%"
    ) else (
      echo [WARN] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable. Please set SERVER_USER/SERVER_HOST in local-env.bat.
      echo [WARN] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, missing SERVER_USER/SERVER_HOST.>> "%LOG_FILE%"
    )
  )
)
REM If local backend/.env still points at :5432, rewrite to tunnel local port for this process only.
if defined DATABASE_URL (
  set "DATABASE_URL=!DATABASE_URL:@127.0.0.1:5432=@127.0.0.1:%DB_TUNNEL_LOCAL_PORT%!"
  set "DATABASE_URL=!DATABASE_URL:@localhost:5432=@localhost:%DB_TUNNEL_LOCAL_PORT%!"
)

pushd "%BACKEND_DIR%"
set "PYTHONPATH=%BACKEND_DIR%"
set "PYTHONUNBUFFERED=1"
echo [INFO] running preview backfill...
if "%~1"=="" (
  powershell -NoProfile -Command "& { & '%PYTHON_EXE%' 'scripts\backfill_previews.py' '--limit' '50' 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
) else (
  powershell -NoProfile -Command "& { & '%PYTHON_EXE%' 'scripts\backfill_previews.py' '--limit' '50' %* 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
)
set "RC=%ERRORLEVEL%"
popd

if not "%RC%"=="0" (
  echo [ERROR] preview backfill failed, exit=%RC%
  echo [ERROR] preview backfill failed, exit=%RC%>> "%LOG_FILE%"
  pause
  exit /b %RC%
)

echo [DONE] preview backfill finished.
echo [DONE] %date% %time%>> "%LOG_FILE%"
pause
exit /b 0

:ensure_log_writable
setlocal
set "TARGET=%~1"
2>nul (>> "%TARGET%" echo [LOG-READY] %date% %time%)
set "WRC=%ERRORLEVEL%"
endlocal & exit /b %WRC%

:wait_db_tunnel_ready
setlocal EnableExtensions DisableDelayedExpansion
set "_P=%DB_TUNNEL_LOCAL_PORT%"
if "%_P%"=="" set "_P=15432"
for /l %%I in (1,1,8) do (
  powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port %_P% -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    endlocal & exit /b 0
  )
  timeout /t 1 >nul
)
endlocal & exit /b 1
