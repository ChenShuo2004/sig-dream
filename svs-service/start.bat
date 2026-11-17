@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=7866"
set "ROOT=%~dp0"
set "VENV=%ROOT%.venv"
set "PY=%VENV%\Scripts\python.exe"
set "PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"
set "PIP_TRUSTED=pypi.tuna.tsinghua.edu.cn"
set "MARKER=%VENV%\svs_deps_ok.txt"
set "SVS_VOICESTUDIO_URL=http://127.0.0.1:3901"

if exist "%PY%" goto :have_venv
echo [SVS] Creating venv ...
py -3.10 -m venv "%VENV%" 2>nul
if not exist "%PY%" py -3 -m venv "%VENV%"
if not exist "%PY%" (
  echo [SVS] Cannot create venv. Install Python 3.10+ first.
  pause
  exit /b 1
)

:have_venv
if /i "%~1"=="reinstall" del /f /q "%MARKER%" 2>nul
if exist "%MARKER%" goto :run_server

echo [SVS] Installing deps ...
"%PY%" -m pip install -U pip -i "%PIP_INDEX%" --trusted-host "%PIP_TRUSTED%"
if errorlevel 1 goto :fail
"%PY%" -m pip uninstall -y torch torchvision torchaudio 2>nul
echo [SVS] Installing torch CUDA 12.1 ...
"%PY%" -m pip install torch==2.4.0 --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 goto :fail
"%PY%" -m pip install -r "%ROOT%requirements.txt" -i "%PIP_INDEX%" --trusted-host "%PIP_TRUSTED%"
if errorlevel 1 goto :fail
"%PY%" -c "import torch,fastapi,librosa,pyworld,soundfile; print('ok', torch.__version__, 'cuda', torch.cuda.is_available())"
if errorlevel 1 goto :fail
echo ok> "%MARKER%"
goto :run_server

:fail
echo [SVS] Install FAILED.
pause
exit /b 1

:run_server
echo.
echo ========================================
echo  SVS lyric-remake guide service
echo  Local:  http://127.0.0.1:%PORT%
echo  LAN:    http://192.168.1.88:%PORT%
echo  Needs:  VoiceStudio on :3901  + Seed-VC on :7865
echo  Reinstall: start.bat reinstall
echo ========================================
echo.
"%PY%" -c "import torch; print('[SVS] torch', torch.__version__, 'cuda', torch.cuda.is_available())"

cd /d "%ROOT%"
"%PY%" -m uvicorn server:app --host 0.0.0.0 --port %PORT%
echo.
echo [SVS] Process exited. Code=%ERRORLEVEL%
pause
endlocal
