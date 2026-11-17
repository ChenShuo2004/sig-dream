# Dot-source: net use with same logic as worker (handles error 85 / 1219).
# Keep this file ASCII-only so Windows PowerShell 5.1 parses it regardless of default encoding.
# Copy shipped with desktop-client/_nas-share-map.ps1 for standalone NAS map bat on other PCs.

function Get-NetUseRemotePath {
  param([string]$Drive)
  $text = (cmd /c "net use `"$Drive`"" 2>&1 | Out-String)
  if ($text -match '(?:Remote name)\s+(\S+)') {
    return $matches[1].Trim().TrimEnd('\')
  }
  if ($text -match '(\\\\[^\s\r\n]+)') {
    return $matches[1].Trim().TrimEnd('\')
  }
  return $null
}

function Normalize-Unc([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return "" }
  return $p.Trim().TrimEnd('\').ToLowerInvariant()
}

function Get-NasHostFromShare([string]$NasShare) {
  if ($NasShare -match '^\\\\([^\\]+)') { return $Matches[1] }
  return $null
}

function Disconnect-NasHostSessions {
  param([string]$NasHost)
  if ([string]::IsNullOrWhiteSpace($NasHost)) { return }
  $hostEsc = [regex]::Escape($NasHost.Trim())
  $out = (cmd /c "net use" 2>&1 | Out-String)
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches($out, "\\\\$hostEsc\\[^\s\r\n]+")) {
    $p = $m.Value.Trim().TrimEnd('\')
    if ($p -and -not $paths.Contains($p)) { [void]$paths.Add($p) }
  }
  foreach ($p in $paths) {
    cmd /c "net use `"$p`" /delete /y" 2>$null | Out-Null
  }
  if ($paths.Count -gt 0) {
    Write-Host "    (disconnected $($paths.Count) SMB session(s) to $NasHost)"
  }
}

function Connect-NasUncShare {
  param(
    [string]$NasShare,
    [string]$NasUser,
    [string]$NasPassword
  )
  $want = Normalize-Unc $NasShare
  $listOut = cmd /c "net use" 2>&1 | Out-String
  if ($listOut -match [regex]::Escape($NasShare.TrimEnd('\'))) {
    Write-Host "    (UNC $NasShare already in session list, skip net use)"
    return
  }
  $hostOnly = Get-NasHostFromShare $NasShare
  $mapOut = cmd /c "net use `"$NasShare`" /user:$NasUser `"$NasPassword`" /persistent:yes" 2>&1
  $mapText = ($mapOut | Out-String)
  if ($LASTEXITCODE -ne 0) {
    if ($mapText -match '\b1219\b' -or $mapText -match 'Multiple connections') {
      if ($hostOnly) { Disconnect-NasHostSessions -NasHost $hostOnly }
      $mapOut = cmd /c "net use `"$NasShare`" /user:$NasUser `"$NasPassword`" /persistent:yes" 2>&1
      $mapText = ($mapOut | Out-String)
      if ($LASTEXITCODE -eq 0) { return }
      Write-Host "    (SMB session conflict; UNC may still work via existing login)"
      return
    }
    if ($mapText -match '\b67\b' -or $mapText -match 'cannot find') {
      $hint = ""
      if ($hostOnly) {
        $viewOut = (cmd /c "net view \\$hostOnly" 2>&1 | Out-String)
        if ($viewOut -and $viewOut -notmatch 'nas-file') {
          $hint = "`nVisible SMB shares on \\${hostOnly}:`n$viewOut`nIf 'nas-file' is missing, set NAS_SHARE and LCP_MATERIAL_ASSETS_ROOT to the real UNC."
        }
      }
      throw "Cannot reach SMB share $NasShare (error 67). Check LAN, NAS_HOST/NAS_SHARE, and that the share exists.$hint"
    }
    throw "net use UNC failed: $mapText"
  }
}

function Repair-NasNetUse {
  param(
    [string]$NasShare,
    [string]$NasDrive,
    [string]$NasUser,
    [string]$NasPassword
  )
  $want = Normalize-Unc $NasShare
  $current = Get-NetUseRemotePath -Drive $NasDrive
  $currentNorm = Normalize-Unc $current

  if ($currentNorm -eq $want) {
    Write-Host "    ($NasDrive already maps to $NasShare, skip net use)"
    return
  }

  $hostOnly = Get-NasHostFromShare $NasShare
  $mapOut = cmd /c "net use $NasDrive `"$NasShare`" /user:$NasUser `"$NasPassword`" /persistent:no" 2>&1
  $mapText = ($mapOut | Out-String)
  if ($LASTEXITCODE -eq 0) { return }

  $is85 = ($mapText -match '\b85\b') -or ($mapText -match 'already in use') -or ($mapText -match 'Local device name')
  if ($is85) {
    $again = Normalize-Unc (Get-NetUseRemotePath -Drive $NasDrive)
    if ($again -eq $want) {
      Write-Host "    (net use error 85: $NasDrive already maps to $NasShare)"
      return
    }
    throw "Drive $NasDrive in use (current: $current, want: $NasShare). Try: net use $NasDrive /delete /y`n$mapText"
  }

  $is1219 = ($mapText -match '\b1219\b') -or ($mapText -match 'Multiple connections')
  if ($is1219) {
    if ($hostOnly) { Disconnect-NasHostSessions -NasHost $hostOnly }
    Connect-NasUncShare -NasShare $NasShare -NasUser $NasUser -NasPassword $NasPassword
    $mapOut = cmd /c "net use $NasDrive `"$NasShare`" /persistent:yes" 2>&1
    $mapText = ($mapOut | Out-String)
    if ($LASTEXITCODE -eq 0) {
      Write-Host "    ($NasDrive mapped using existing SMB session after clearing 1219)"
      return
    }
    $again = Normalize-Unc (Get-NetUseRemotePath -Drive $NasDrive)
    if ($again -eq $want) {
      Write-Host "    (1219 on map, but $NasDrive already points to $NasShare)"
      return
    }
    throw "net use $NasDrive failed (1219). UNC $NasShare may still work; set LCP_SKIP_NAS_DRIVE_MAP=1 to skip Z:.`n$mapText"
  }

  throw "net use failed: $mapText"
}
