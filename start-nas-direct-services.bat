@echo off
REM This file must stay ASCII-only (no Chinese / full-width punctuation). Otherwise cmd.exe
REM under system default code page (e.g. GBK) mis-parses UTF-8 bytes and breaks setlocal / %% variables.
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
title NAS Direct Services Starter

cd /d "%~dp0"

set "ROOT_DIR=%~dp0"
set "LOG_FILE=%ROOT_DIR%start-nas-direct-services.log"
> "%LOG_FILE%" echo [%date% %time%] ===== start-nas-direct-services.bat begin =====
>> "%LOG_FILE%" echo ROOT_DIR=%ROOT_DIR%

REM One-click: full worker + media worker + LAN download server + Qwen VLM
REM Already includes AI-song worker (lan_yue2 / voice_convert / remix) via run-worker.ps1.
REM Boot: Startup shortcut -> start-nas-direct-services-autostart.vbs -> this bat "silent".
REM 1) run-worker.ps1 - store_original, prepare_download, lan_yue2, ...
REM 2) run-derivative-worker.ps1 - generate_derivatives + analyze_content
REM 3) run-download-server.ps1 - LAN upload/download
REM 4) run-qwen-vlm.ps1 - Qwen2.5-VL OpenAI-compatible on :23333 (set NAS_START_QWEN_VLM=0 to skip)
REM Optional extra: heartbeat if DEPLOY_LAN_* in local-env; ECS DB pull loop if NAS_START_DB_BACKUP_PULL_LOOP=1.

set "NAS_DIR=%ROOT_DIR%nas-client"
set "LOCAL_ENV=%ROOT_DIR%local-env.bat"
set "STARTER_PS1=%ROOT_DIR%start-nas-direct-services.ps1"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
REM Local SSH forward port (remote ECS Postgres stays 5432). 15432 avoids WinNAT excluded ranges around 5432.
set "DB_TUNNEL_LOCAL_PORT=15432"

if exist "%LOCAL_ENV%" (
  >> "%LOG_FILE%" echo CALL local env: "%LOCAL_ENV%"
  call "%LOCAL_ENV%"
)
if "%DB_TUNNEL_LOCAL_PORT%"=="" set "DB_TUNNEL_LOCAL_PORT=15432"
set "DB_TUNNEL_TITLE=DB Tunnel %DB_TUNNEL_LOCAL_PORT% to ECS:5432"
>> "%LOG_FILE%" echo DB_TUNNEL_LOCAL_PORT=%DB_TUNNEL_LOCAL_PORT%

REM Optional nas-client\nas-client-token.txt (gitignored): first non-empty line starting with # skipped as comment.
REM Overrides NAS_CLIENT_TOKEN from local-env.bat so you can fix 401 without editing local-env.
if exist "%NAS_DIR%\nas-client-token.txt" (
  for /f "usebackq eol=# delims=" %%T in ("%NAS_DIR%\nas-client-token.txt") do (
    set "NAS_CLIENT_TOKEN=%%T"
    echo [INFO] NAS_CLIENT_TOKEN read from nas-client\nas-client-token.txt - must match ECS backend/.env.
    >> "%LOG_FILE%" echo [INFO] NAS_CLIENT_TOKEN from nas-client-token.txt
    goto :_nas_token_file_done
  )
)
:_nas_token_file_done

if not exist "%NAS_DIR%\_nas-share-map.ps1" (
  echo [ERROR] Missing file: "%NAS_DIR%\_nas-share-map.ps1"
  pause
  exit /b 1
)

if not exist "%NAS_DIR%\run-worker.ps1" (
  echo [ERROR] Missing file: "%NAS_DIR%\run-worker.ps1"
  pause
  exit /b 1
)

if not exist "%NAS_DIR%\run-download-server.ps1" (
  echo [ERROR] Missing file: "%NAS_DIR%\run-download-server.ps1"
  pause
  exit /b 1
)
if not exist "%NAS_DIR%\run-derivative-worker.ps1" (
  echo [ERROR] Missing file: "%NAS_DIR%\run-derivative-worker.ps1"
  pause
  exit /b 1
)
if not exist "%STARTER_PS1%" (
  echo [ERROR] Missing file: "%STARTER_PS1%"
  pause
  exit /b 1
)
if not exist "%POWERSHELL_EXE%" (
  echo [ERROR] Missing powershell executable: "%POWERSHELL_EXE%"
  pause
  exit /b 1
)

REM Silent/autostart: start-nas-direct-services.bat silent   OR set NAS_SILENT=1
REM Skips choice/pause, hides MAIN+children. Tunnel failure does NOT block workers.
set "NAS_SILENT_MODE=0"
if /i "%~1"=="silent" set "NAS_SILENT_MODE=1"
if /i "%NAS_SILENT%"=="1" set "NAS_SILENT_MODE=1"
if /i "%NAS_SILENT%"=="true" set "NAS_SILENT_MODE=1"
>> "%LOG_FILE%" echo NAS_SILENT_MODE=%NAS_SILENT_MODE%

REM Child service windows: 1=Hidden (default after 60s), 2=Normal. (ASCII-only in this .bat per header.)
set "NAS_SVC_WIN=1"
if "%NAS_SILENT_MODE%"=="1" (
  >> "%LOG_FILE%" echo [INFO] Silent mode: skip window choice, force Hidden.
) else (
  echo.
  echo Service console windows: [1] Hide worker/LAN PS windows  [2] Show them. Default [1] in 60 seconds.
  choice /c 12 /n /t 60 /d 1 /m "Press 1 or 2, or wait: "
  if errorlevel 2 set "NAS_SVC_WIN=2"
)
>> "%LOG_FILE%" echo NAS_SVC_WIN=%NAS_SVC_WIN%
set "PS_WIN_STYLE=Hidden"
if "%NAS_SVC_WIN%"=="2" set "PS_WIN_STYLE=Normal"
set "MAIN_WIN_STYLE=Normal"
if "%NAS_SILENT_MODE%"=="1" (
  set "PS_WIN_STYLE=Hidden"
  set "MAIN_WIN_STYLE=Hidden"
)

where ssh >nul 2>nul
if errorlevel 1 (
  echo [WARN] ssh not found in PATH, DB tunnel auto-start skipped.
) else (
  powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port %DB_TUNNEL_LOCAL_PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul 2>nul
  if errorlevel 1 (
    if not "%SERVER_USER%"=="" if not "%SERVER_HOST%"=="" (
      echo [INFO] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, starting DB tunnel window...
      echo       ssh -L %DB_TUNNEL_LOCAL_PORT%:127.0.0.1:5432  ^(local %DB_TUNNEL_LOCAL_PORT% -^> ECS 5432^)
      if "%NAS_SVC_WIN%"=="2" (
        start "%DB_TUNNEL_TITLE%" cmd /k "ssh -N -L %DB_TUNNEL_LOCAL_PORT%:127.0.0.1:5432 -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new %SERVER_USER%@%SERVER_HOST%"
      ) else (
        "%POWERSHELL_EXE%" -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath ssh.exe -WindowStyle Hidden -ArgumentList @('-N','-L','%DB_TUNNEL_LOCAL_PORT%:127.0.0.1:5432','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','-o','StrictHostKeyChecking=accept-new','%SERVER_USER%@%SERVER_HOST%')"
      )
      >> "%LOG_FILE%" echo [INFO] DB tunnel command started local=%DB_TUNNEL_LOCAL_PORT% remote=5432
      call :wait_db_tunnel_ready
      if errorlevel 1 (
        echo [WARN] DB tunnel failed on localhost:%DB_TUNNEL_LOCAL_PORT%. Workers do not need it; continuing.
        >> "%LOG_FILE%" echo [WARN] DB tunnel unreachable; continue without local %DB_TUNNEL_LOCAL_PORT%.
      ) else (
        echo [OK] DB tunnel is ready on localhost:%DB_TUNNEL_LOCAL_PORT% -^> ECS:5432
        >> "%LOG_FILE%" echo [OK] DB tunnel ready on %DB_TUNNEL_LOCAL_PORT%.
      )
    ) else (
      echo [WARN] localhost:%DB_TUNNEL_LOCAL_PORT% not reachable, and SERVER_USER/SERVER_HOST is empty.
      echo [WARN] Please set SERVER_USER and SERVER_HOST in local-env.bat to auto-open SSH tunnel.
    )
  )
)

REM NAS_PASSWORD: local-env.bat or set/p below.
REM NAS_CLIENT_TOKEN: nas-client\nas-client-token.txt overrides local-env; else local-env; else set/p.
REM On ECS: grep NAS_CLIENT_TOKEN in backend/.env then systemctl restart light-content-api after change.

if "%NAS_PASSWORD%"=="" if not "%NAS_SILENT_MODE%"=="1" set /p NAS_PASSWORD=Enter NAS password:
if "%NAS_PASSWORD%"=="" (
  echo [ERROR] NAS_PASSWORD is required.
  >> "%LOG_FILE%" echo [ERROR] NAS_PASSWORD empty
  if not "%NAS_SILENT_MODE%"=="1" pause
  exit /b 1
)

if "%NAS_CLIENT_TOKEN%"=="" if not "%NAS_SILENT_MODE%"=="1" set /p NAS_CLIENT_TOKEN=Enter NAS client token:
if "%NAS_CLIENT_TOKEN%"=="" (
  echo [ERROR] NAS_CLIENT_TOKEN is required.
  >> "%LOG_FILE%" echo [ERROR] NAS_CLIENT_TOKEN empty
  if not "%NAS_SILENT_MODE%"=="1" pause
  exit /b 1
)
if /i "%NAS_CLIENT_TOKEN%"=="REPLACE_WITH_SAME_TOKEN_AS_ECS" (
  echo [ERROR] nas-client-token.txt still has example placeholder. Use ONE line: real token only - not inside # comments.
  if not "%NAS_SILENT_MODE%"=="1" pause
  exit /b 1
)
if not "%NAS_PASSWORD:"=%"=="%NAS_PASSWORD%" (
  echo [ERROR] NAS_PASSWORD cannot contain double quotes.
  if not "%NAS_SILENT_MODE%"=="1" pause
  exit /b 1
)
if not "%NAS_CLIENT_TOKEN:"=%"=="%NAS_CLIENT_TOKEN%" (
  echo [ERROR] NAS_CLIENT_TOKEN cannot contain double quotes.
  if not "%NAS_SILENT_MODE%"=="1" pause
  exit /b 1
)

echo.
echo ==> Starting NAS worker, derivative worker, and download server...
echo     MAIN window style: %MAIN_WIN_STYLE%. Child windows: %PS_WIN_STYLE%.
echo     Close MAIN OR press Enter there to stop ALL child workers ^(interactive only^).
echo     Log: "%LOG_FILE%"
REM children use -ServiceWindowStyle; MAIN uses MAIN_WIN_STYLE ^(Hidden when silent^).
set "FILE_SERVICE_LAN_BASE=%DEPLOY_LAN_DOWNLOAD_BASE_URL%"
if "%FILE_SERVICE_LAN_BASE%"=="" set "FILE_SERVICE_LAN_BASE=%DEPLOY_LAN_UPLOAD_BASE_URL%"
set "PS_SILENT_SWITCH="
if "%NAS_SILENT_MODE%"=="1" set "PS_SILENT_SWITCH=-SilentKeepAlive"
"%POWERSHELL_EXE%" -NoLogo -NoProfile -WindowStyle %MAIN_WIN_STYLE% -ExecutionPolicy Bypass -File "%STARTER_PS1%" -NasPassword "%NAS_PASSWORD%" -NasClientToken "%NAS_CLIENT_TOKEN%" -FileServiceLanBase "%FILE_SERVICE_LAN_BASE%" -ServiceWindowStyle %PS_WIN_STYLE% %PS_SILENT_SWITCH% >> "%LOG_FILE%" 2>&1
set "_NAS_PS_EXIT=%errorlevel%"
REM User closing MAIN console often yields -1073741510 ^(0xC000013A^) -- treat as normal shutdown.
if "%_NAS_PS_EXIT%"=="-1073741510" goto _nas_ps_ok
if "%_NAS_PS_EXIT%"=="0" goto _nas_ps_ok
echo [ERROR] Failed to start or run services ^(exit=%_NAS_PS_EXIT%^).
>> "%LOG_FILE%" echo [ERROR] PowerShell exit=%_NAS_PS_EXIT%
echo [ERROR] See log: "%LOG_FILE%"
if not "%NAS_SILENT_MODE%"=="1" pause
exit /b 1
:_nas_ps_ok

echo.
echo [OK] MAIN PowerShell session ended ^(all child worker processes in the same Windows job should be stopped^).
echo   DB SSH tunnel window ^(if started by this .bat^) is separate: closing MAIN does NOT close the tunnel.
echo   Log file: "%LOG_FILE%"
>> "%LOG_FILE%" echo [%date% %time%] ===== done =====
if not "%NAS_SILENT_MODE%"=="1" pause
endlocal
exit /b 0

:wait_db_tunnel_ready
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
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
