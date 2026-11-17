param(
  [int]$Port = 23333,
  [string]$HfModel = "Qwen/Qwen2.5-VL-7B-Instruct",
  [string]$ServedName = "Qwen2.5-VL-7B-Instruct"
)

$ErrorActionPreference = "Continue"
try { $Host.UI.RawUI.WindowTitle = "Qwen2.5-VL OpenAI-compatible (port $Port)" } catch { }

if ($env:NAS_VLM_PORT -match '^\d+$') { $Port = [int]$env:NAS_VLM_PORT }
if (-not [string]::IsNullOrWhiteSpace($env:NAS_VLM_HF_MODEL)) { $HfModel = $env:NAS_VLM_HF_MODEL.Trim() }
if (-not [string]::IsNullOrWhiteSpace($env:NAS_VLM_MODEL)) { $ServedName = $env:NAS_VLM_MODEL.Trim() }

$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "qwen-vlm.log"

function Write-QwenLog {
  param([string]$Message, [string]$Color = "Gray")
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch { }
  Write-Host $line -ForegroundColor $Color
}

function Resolve-QwenPython {
  $candidates = @(
    (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
    (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"),
    (Get-Command py -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

Write-QwenLog "Qwen vision backend for analyze_content. Worker -> http://127.0.0.1:$Port/v1  model=$ServedName" "Cyan"

$custom = if ($null -ne $env:NAS_VLM_START_CMD) { "$($env:NAS_VLM_START_CMD)".Trim() } else { "" }
if (-not [string]::IsNullOrWhiteSpace($custom)) {
  Write-QwenLog "Using NAS_VLM_START_CMD" "Yellow"
  cmd.exe /c $custom
  exit $LASTEXITCODE
}

$py = Resolve-QwenPython
if (-not $py) {
  Write-QwenLog "python not found in PATH or common install locations. Retrying every 10s." "Red"
  while (-not $py) {
    Start-Sleep -Seconds 10
    $py = Resolve-QwenPython
  }
}
Write-QwenLog "python=$py"

$bridge = Join-Path $PSScriptRoot "qwen_openai_bridge.py"
$env:NAS_VLM_PORT = "$Port"
$env:NAS_VLM_MODEL = $ServedName
if ([string]::IsNullOrWhiteSpace($env:NAS_VLM_UPSTREAM)) { $env:NAS_VLM_UPSTREAM = "http://127.0.0.1:11434" }
if ([string]::IsNullOrWhiteSpace($env:NAS_VLM_UPSTREAM_MODEL)) { $env:NAS_VLM_UPSTREAM_MODEL = "qwen2.5vl:7b" }

while ($true) {
  $useVllm = "$($env:NAS_VLM_USE_VLLM)".Trim() -match '^(1|true|yes|Y|y)$'
  if ($useVllm) {
    Write-QwenLog "Starting vLLM on port $Port"
    & $py -m vllm.entrypoints.openai.api_server --model $HfModel --served-model-name $ServedName --port $Port
    Write-QwenLog "vLLM exited code=$LASTEXITCODE; restart in 5s" "Yellow"
    Start-Sleep -Seconds 5
    continue
  }
  if (-not (Test-Path -LiteralPath $bridge)) {
    Write-QwenLog "bridge missing: $bridge; retry in 10s" "Red"
    Start-Sleep -Seconds 10
    continue
  }
  Write-QwenLog "Starting Qwen OpenAI bridge on :$Port  upstream=$($env:NAS_VLM_UPSTREAM)"
  & $py $bridge
  Write-QwenLog "bridge exited code=$LASTEXITCODE; restart in 5s" "Yellow"
  Start-Sleep -Seconds 5
}
