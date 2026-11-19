@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=7865"
set "ROOT=%~dp0"
set "UPSTREAM=%ROOT%upstream"
set "VENV=%ROOT%.venv"
set "PY=%VENV%\Scripts\python.exe"
set "PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"
set "PIP_TRUSTED=pypi.tuna.tsinghua.edu.cn"
set "MARKER=%VENV%\seedvc_deps_ok.txt"
set "FORCE_CUDA=%~1"

if exist "%UPSTREAM%\seed_vc_wrapper.py" goto :have_upstream
echo [Seed-VC] Cloning Plachtaa/seed-vc into upstream ...
git clone --depth 1 https://github.com/Plachtaa/seed-vc.git "%UPSTREAM%"
if errorlevel 1 (
  echo [Seed-VC] Clone failed. Put seed-vc into upstream folder manually.
  pause
  exit /b 1
)

:have_upstream
if exist "%PY%" goto :have_venv
echo [Seed-VC] Creating venv ...
py -3.10 -m venv "%VENV%" 2>nul
if not exist "%PY%" py -3 -m venv "%VENV%"
if not exist "%PY%" (
  echo [Seed-VC] Cannot create venv. Install Python 3.10+ first.
  pause
  exit /b 1
)

:have_venv
if /i "%FORCE_CUDA%"=="cuda" (
  echo [Seed-VC] Force CUDA reinstall requested.
  del /f /q "%MARKER%" 2>nul
  goto :install_deps
)

if not exist "%MARKER%" goto :install_deps

"%PY%" -c "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)"
if errorlevel 1 (
  echo [Seed-VC] CUDA is FALSE. Reinstalling GPU torch ...
  del /f /q "%MARKER%" 2>nul
  goto :install_deps
)
goto :run_server

:install_deps
echo [Seed-VC] Installing deps - may take several minutes ...
"%PY%" -m pip install -U pip -i "%PIP_INDEX%" --trusted-host "%PIP_TRUSTED%"
if errorlevel 1 goto :pip_fail

echo [Seed-VC] Uninstalling CPU torch if present ...
"%PY%" -m pip uninstall -y torch torchvision torchaudio 2>nul

echo [Seed-VC] Installing torch 2.4.0 CUDA 12.1 wheels ...
"%PY%" -m pip install torch==2.4.0 torchvision==0.19.0 torchaudio==2.4.0 --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 goto :cuda_fail

"%PY%" -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available()); raise SystemExit(0 if torch.cuda.is_available() else 2)"
if errorlevel 1 goto :cuda_fail

echo [Seed-VC] Installing inference + API packages ...
"%PY%" -m pip install -r "%ROOT%requirements-infer.txt" -i "%PIP_INDEX%" --trusted-host "%PIP_TRUSTED%"
if errorlevel 1 goto :pip_fail

"%PY%" -c "import uvicorn,fastapi,torch,librosa,transformers; print('deps ok', torch.__version__, 'cuda', torch.cuda.is_available())"
if errorlevel 1 goto :pip_fail

echo ok> "%MARKER%"
goto :run_server

:cuda_fail
echo.
echo [Seed-VC] CUDA torch install FAILED or GPU not visible.
echo   1) Install NVIDIA driver on this PC
echo   2) Run: nvidia-smi
echo   3) Rerun: start.bat cuda
echo   Will NOT fall back to CPU.
pause
exit /b 1

:pip_fail
echo.
echo [Seed-VC] Dependency install FAILED. Fix network and retry.
echo [Seed-VC] Do NOT use upstream\requirements.txt.
pause
exit /b 1

:run_server
echo.
echo ========================================
echo  Seed-VC voice convert service
echo  Local:  http://127.0.0.1:%PORT%
echo  LAN:    http://^<THIS_HOST_IP^>:%PORT%
echo  Health: GET /health  (need cuda:true)
echo  Convert: POST /convert
echo  Force GPU reinstall: start.bat cuda
echo ========================================
echo.
"%PY%" -c "import torch; print('[Seed-VC] torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU-ONLY'); raise SystemExit(0 if torch.cuda.is_available() else 1)"
if errorlevel 1 (
  echo [Seed-VC] Refusing to start without CUDA. Run: start.bat cuda
  pause
  exit /b 1
)

set "PYTHONPATH=%UPSTREAM%;%PYTHONPATH%"
cd /d "%ROOT%"
"%PY%" -m uvicorn server:app --host 0.0.0.0 --port %PORT%
echo.
echo [Seed-VC] Process exited. Code=%ERRORLEVEL%
pause
endlocal
