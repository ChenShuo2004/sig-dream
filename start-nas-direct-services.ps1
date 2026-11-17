param(
  [string]$NasPassword = "",
  [string]$NasClientToken = "",
  [string]$ApiBaseUrl = "",
  [string]$FileServiceLanBase = "",
  [string]$FileServicePoolId = "default",
  [string]$FileServiceNodeId = "",
  [ValidateSet("Hidden", "Normal")]
  [string]$ServiceWindowStyle = "Normal",
  [switch]$SilentKeepAlive
)

$ErrorActionPreference = "Stop"

$NasClientToken = ([string]$NasClientToken).Trim().TrimStart([char]0xFEFF)
$NasPassword = ([string]$NasPassword).Trim()

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nasDir = Join-Path $rootDir "nas-client"
. "$nasDir\_resolve-nas-api-base.ps1"
. "$nasDir\_office-lan-https.ps1"
$ApiBaseUrl = Resolve-NasApiBaseUrl -Override $ApiBaseUrl -ScriptRoot $nasDir
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path (Join-Path $nasDir "_nas-share-map.ps1"))) {
  throw "Missing file: $nasDir\_nas-share-map.ps1"
}
if (-not (Test-Path (Join-Path $nasDir "run-worker.ps1"))) {
  throw "Missing file: $nasDir\run-worker.ps1"
}
if (-not (Test-Path (Join-Path $nasDir "run-download-server.ps1"))) {
  throw "Missing file: $nasDir\run-download-server.ps1"
}
if (-not (Test-Path (Join-Path $nasDir "run-derivative-worker.ps1"))) {
  throw "Missing file: $nasDir\run-derivative-worker.ps1"
}
if (-not (Test-Path $psExe)) {
  throw "Missing powershell executable: $psExe"
}
if ([string]::IsNullOrWhiteSpace($NasPassword)) {
  throw "NAS_PASSWORD is empty"
}
if ([string]::IsNullOrWhiteSpace($NasClientToken)) {
  throw "NAS_CLIENT_TOKEN is empty"
}

# Windows job object: when this orchestrator process exits (close window or Enter), OS terminates all assigned child processes.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NasServiceJob {
  public const int JobObjectExtendedLimitInformation = 9;
  public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public UInt64 ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public UInt64 ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public Int64 PerProcessUserTimeLimit;
    public Int64 PerJobUserTimeLimit;
    public UInt32 LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public UInt32 ActiveProcessLimit;
    public Int64 Affinity;
    public UInt32 PriorityClass;
    public UInt32 SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInformation, uint cbJobObjectInformationLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);

  public static IntPtr CreateKillOnCloseJob() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) {
      throw new InvalidOperationException("CreateJobObject failed");
    }
    var ex = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    ex.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    int sz = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
    IntPtr p = Marshal.AllocHGlobal(sz);
    try {
      Marshal.StructureToPtr(ex, p, false);
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, p, (uint)sz)) {
        int err = Marshal.GetLastWin32Error();
        CloseHandle(job);
        throw new InvalidOperationException("SetInformationJobObject failed: " + err);
      }
    } finally {
      Marshal.FreeHGlobal(p);
    }
    return job;
  }
}
"@ -ErrorAction Stop

$heartbeatScript = Join-Path $nasDir "report-file-service-heartbeat.ps1"
$extraLanBases = @(
  $FileServiceLanBase,
  $env:DEPLOY_LAN_DOWNLOAD_BASE_URL,
  $env:DEPLOY_LAN_UPLOAD_BASE_URL
)
$lanHttpsBases = @(Get-OfficeLanHttpsBases -TlsPort 9443 -ExtraBases $extraLanBases)
$hasHeartbeatWindow = (Test-Path $heartbeatScript) -and ($lanHttpsBases.Count -gt 0)

$pullLoopScript = Join-Path $rootDir "run-ecs-db-backup-pull-loop.ps1"
$hasDbPullLoop = $false
if ($null -ne $env:NAS_START_DB_BACKUP_PULL_LOOP -and "$($env:NAS_START_DB_BACKUP_PULL_LOOP)".Trim() -match '^(1|true|yes|Y|y)$') {
  if (Test-Path -LiteralPath $pullLoopScript) {
    $hasDbPullLoop = $true
  } else {
    Write-Warning "NAS_START_DB_BACKUP_PULL_LOOP is set but missing script: $pullLoopScript"
  }
}

$dbPullIntervalH = 24.0
if ($hasDbPullLoop) {
  $rawH = if ($null -ne $env:NAS_DB_BACKUP_PULL_INTERVAL_HOURS) { "$($env:NAS_DB_BACKUP_PULL_INTERVAL_HOURS)".Trim() } else { "" }
  if (-not [string]::IsNullOrWhiteSpace($rawH)) {
    $parsed = 0.0
    if ([double]::TryParse($rawH, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
      $dbPullIntervalH = $parsed
    }
  }
}

$startQwenVlm = -not ("$($env:NAS_START_QWEN_VLM)".Trim() -match '^(0|false|no|N|n)$')
$qwenScript = Join-Path $nasDir "run-qwen-vlm.ps1"
if ($startQwenVlm -and -not (Test-Path -LiteralPath $qwenScript)) {
  Write-Warning "Qwen starter missing: $qwenScript"
  $startQwenVlm = $false
}

$openCount = 3
if ($startQwenVlm) { $openCount++ }
if ($hasHeartbeatWindow) { $openCount++ }
if ($hasDbPullLoop) { $openCount++ }

try { $Host.UI.RawUI.WindowTitle = "NAS Direct Services (MAIN - close or Enter to stop all workers)" } catch { }

$ws = [System.Diagnostics.ProcessWindowStyle]$ServiceWindowStyle

Write-Host ""
Write-Host "MAIN window keeps services alive. Closing this window OR pressing Enter stops all $openCount child PowerShell job(s)." -ForegroundColor Cyan
Write-Host "Child window style: $ServiceWindowStyle" -ForegroundColor Gray
Write-Host "  1) Full worker (exclude generate_derivatives, analyze_content)" -ForegroundColor Gray
Write-Host "  2) Media worker (generate_derivatives + analyze_content)" -ForegroundColor Gray
Write-Host "  3) LAN server HTTP :9001 + HTTPS :9443 (192.168.1 / 192.168.2)" -ForegroundColor Gray
$nextIdx = 4
if ($startQwenVlm) {
  Write-Host "  $nextIdx) Qwen2.5-VL OpenAI-compatible server (port 23333)" -ForegroundColor Gray
  $nextIdx++
}
if ($hasHeartbeatWindow) {
  Write-Host "  $nextIdx) File-service heartbeat" -ForegroundColor Gray
  $nextIdx++
}
if ($hasDbPullLoop) {
  Write-Host "  $nextIdx) ECS DB backup pull every ${dbPullIntervalH}h" -ForegroundColor Gray
}
Write-Host ""
Write-Host "NOTE: DB SSH tunnel (if opened by .bat) is NOT in this job -- close that cmd window separately." -ForegroundColor DarkYellow
Write-Host ""

$job = [NasServiceJob]::CreateKillOnCloseJob()
$children = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

function Start-NasChild {
  param(
    [string]$WorkingDirectory,
    [string[]]$ArgumentList
  )
  $p = Start-Process -FilePath $psExe -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList -WindowStyle $ws -PassThru
  try { $null = $p.Handle } catch { }
  $ok = [NasServiceJob]::AssignProcessToJobObject($job, $p.Handle)
  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Warning "AssignProcessToJobObject failed pid=$($p.Id) err=$err (child may survive after MAIN exits)"
  }
  $children.Add($p) | Out-Null
  return $p
}

$workerArgs = @(
  "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", ".\run-worker.ps1",
  "-NasPassword", $NasPassword,
  "-NasClientToken", $NasClientToken,
  "-ExcludePollJobTypes", "generate_derivatives,analyze_content"
)
$downloadArgs = @(
  "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", ".\run-download-server.ps1",
  "-NasPassword", $NasPassword,
  "-NasClientToken", $NasClientToken,
  "-BindHost", "0.0.0.0",
  "-Port", "9001"
)
$derivativeArgs = @(
  "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", ".\run-derivative-worker.ps1",
  "-NasPassword", $NasPassword,
  "-NasClientToken", $NasClientToken
)

Start-NasChild -WorkingDirectory $nasDir -ArgumentList $workerArgs
Start-NasChild -WorkingDirectory $nasDir -ArgumentList $derivativeArgs
Start-NasChild -WorkingDirectory $nasDir -ArgumentList $downloadArgs
if ($startQwenVlm) {
  $qwenArgs = @(
    "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", ".\run-qwen-vlm.ps1"
  )
  Start-NasChild -WorkingDirectory $nasDir -ArgumentList $qwenArgs
}

if ($hasHeartbeatWindow) {
  $nid = $FileServiceNodeId.Trim()
  if (-not $nid) { $nid = $env:COMPUTERNAME }
  if (-not $nid) { $nid = "file-node-1" }
  $httpsJoined = ($lanHttpsBases -join ",")
  Write-Host "File-service heartbeat LAN bases: $httpsJoined" -ForegroundColor DarkCyan
  $pool = "default"
  if (-not [string]::IsNullOrWhiteSpace($FileServicePoolId)) { $pool = $FileServicePoolId.Trim() }
  $hbArgs = @(
    "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", ".\report-file-service-heartbeat.ps1",
    "-ApiBaseUrl", $ApiBaseUrl.TrimEnd("/"),
    "-NasClientToken", $NasClientToken,
    "-LanUploadBaseUrl", $httpsJoined,
    "-LanDownloadBaseUrl", $httpsJoined,
    "-PoolId", $pool,
    "-NodeId", $nid,
    "-IntervalSeconds", "45"
  )
  Start-NasChild -WorkingDirectory $nasDir -ArgumentList $hbArgs
} elseif (-not (Test-Path $heartbeatScript)) {
  Write-Warning "Missing heartbeat script: $heartbeatScript"
} else {
  Write-Warning "No office LAN IPv4 (192.168.1/192.168.2) detected and FileServiceLanBase/DEPLOY_LAN_* empty; heartbeat skipped."
}

if ($hasDbPullLoop) {
  $pullLoopArgs = @(
    "-NoExit", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $pullLoopScript,
    "-IntervalHours", "$dbPullIntervalH"
  )
  Start-NasChild -WorkingDirectory $rootDir -ArgumentList $pullLoopArgs
}

try {
  # Silent/autostart: never Read-Host (empty/redirected stdin would exit and kill the job object children).
  if ($SilentKeepAlive) {
    Write-Host "[NAS] Silent keep-alive: MAIN stays until this process is killed." -ForegroundColor DarkYellow
    while ($true) { Start-Sleep -Seconds 3600 }
  } else {
    Write-Host "[NAS] Press Enter to stop all services and exit this MAIN window..." -ForegroundColor Yellow
    Read-Host | Out-Null
  }
} catch {
  # Window may be closing
} finally {
  foreach ($c in $children) {
    if ($null -eq $c) { continue }
    try {
      if (-not $c.HasExited) {
        Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
  if ($job -ne [IntPtr]::Zero) {
    [void][NasServiceJob]::CloseHandle($job)
  }
}
