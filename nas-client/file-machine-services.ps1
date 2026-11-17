# Shared catalog for file-machine (素材库) services.
# Add a new entry here when you introduce another always-on process; 一键启动/重启 bat will pick it up.

param(
  [ValidateSet("Stop", "Status")]
  [string]$Action = "Status"
)

$ErrorActionPreference = "Continue"

# Match against Win32_Process.CommandLine (regex). Prefer script names over bare python.exe.
$Script:FileMachineServiceMatchers = @(
  @{ Id = "nas-main"; Label = "NAS MAIN orchestrator"; Pattern = "start-nas-direct-services\.ps1" },
  @{ Id = "full-worker"; Label = "Full NAS worker"; Pattern = "run-worker\.ps1" },
  @{ Id = "derivative-worker"; Label = "Derivative / analyze worker"; Pattern = "run-derivative-worker\.ps1" },
  @{ Id = "download-server"; Label = "LAN download server"; Pattern = "run-download-server\.ps1|download_server\.py" },
  @{ Id = "qwen-vlm"; Label = "Qwen VLM"; Pattern = "run-qwen-vlm\.ps1|qwen_openai_bridge\.py" },
  @{ Id = "heartbeat"; Label = "File-service heartbeat"; Pattern = "report-file-service-heartbeat\.ps1" },
  @{ Id = "db-pull-loop"; Label = "ECS DB backup pull loop"; Pattern = "run-ecs-db-backup-pull-loop\.ps1" },
  @{ Id = "worker-py"; Label = "worker.py"; Pattern = "[\\/]nas-client[\\/].*worker\.py|nas-client\\.*worker\.py" }
)

function Get-FileMachineServiceProcesses {
  $list = @()
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine }
  foreach ($svc in $Script:FileMachineServiceMatchers) {
    foreach ($p in $procs) {
      if ($p.CommandLine -match $svc.Pattern) {
        $list += [pscustomobject]@{
          Id = $svc.Id
          Label = $svc.Label
          ProcessId = $p.ProcessId
          Name = $p.Name
          CommandLine = $p.CommandLine
        }
      }
    }
  }
  return $list | Sort-Object ProcessId -Unique
}

function Stop-FileMachineServices {
  $hits = Get-FileMachineServiceProcesses
  if (-not $hits.Count) {
    Write-Host "[file-machine] no matching service processes" -ForegroundColor DarkYellow
    return 0
  }
  $ids = $hits.ProcessId | Sort-Object -Unique
  Write-Host "[file-machine] stopping $($ids.Count) process(es)..." -ForegroundColor Cyan
  foreach ($row in $hits) {
    Write-Host ("  stop pid={0} {1}" -f $row.ProcessId, $row.Label) -ForegroundColor Gray
  }
  foreach ($id in $ids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  $left = @(Get-FileMachineServiceProcesses)
  if ($left.Count) {
    Write-Host "[file-machine] still running: $($left.Count) — force again" -ForegroundColor Yellow
    foreach ($row in $left) {
      Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
  }
  return $ids.Count
}

function Show-FileMachineServiceStatus {
  $hits = Get-FileMachineServiceProcesses
  if (-not $hits.Count) {
    Write-Host "[file-machine] status: none running" -ForegroundColor DarkYellow
    return
  }
  Write-Host "[file-machine] status: $($hits.Count) process(es)" -ForegroundColor Green
  $hits | ForEach-Object {
    Write-Host ("  pid={0} {1}" -f $_.ProcessId, $_.Label) -ForegroundColor Gray
  }
}

switch ($Action) {
  "Stop" { [void](Stop-FileMachineServices) }
  default { Show-FileMachineServiceStatus }
}
