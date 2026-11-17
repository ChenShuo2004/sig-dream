@echo off
REM ASCII-only. Start a Qwen2.5-VL OpenAI-compatible server for analyze_content.
REM Worker default: http://127.0.0.1:23333/v1  model=Qwen2.5-VL-7B-Instruct
title Qwen2.5-VL OpenAI-compatible server

set "PORT=23333"
set "MODEL=Qwen/Qwen2.5-VL-7B-Instruct"

echo.
echo This window is the Qwen vision backend (NOT Ollama).
echo Worker will call http://127.0.0.1:%PORT%/v1/chat/completions
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not in PATH.
  pause
  exit /b 1
)

python -c "import vllm" >nul 2>nul
if not errorlevel 1 (
  python -m vllm.entrypoints.openai.api_server --model %MODEL% --served-model-name Qwen2.5-VL-7B-Instruct --port %PORT%
  pause
  exit /b %ERRORLEVEL%
)

echo vLLM not installed. Starting local Qwen OpenAI bridge on :%PORT%
if "%NAS_VLM_UPSTREAM%"=="" set "NAS_VLM_UPSTREAM=http://127.0.0.1:11434"
if "%NAS_VLM_UPSTREAM_MODEL%"=="" set "NAS_VLM_UPSTREAM_MODEL=qwen2.5vl:7b"
set "NAS_VLM_PORT=%PORT%"
set "NAS_VLM_MODEL=Qwen2.5-VL-7B-Instruct"
python "%~dp0qwen_openai_bridge.py"
pause
