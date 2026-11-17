# Resolve SMB host/share/UNC root for desktop client. ASCII-only.
# HTTP file server (DEPLOY_LAN_* :9001) may run on 192.168.1.2; SMB share nas-file is on NAS 192.168.1.66.

function Resolve-LcpNasSmbConfig {
  $nasHost = ""
  $nasShare = "nas-file"
  $materialRoot = ""

  if ($env:LCP_MATERIAL_ASSETS_ROOT) {
    $materialRoot = $env:LCP_MATERIAL_ASSETS_ROOT.Trim().TrimEnd("\")
    if ($materialRoot -match "^\\\\([^\\]+)\\([^\\]+)") {
      if (-not $env:NAS_HOST) {
        $nasHost = $Matches[1]
        $nasShare = $Matches[2]
      }
    }
  }

  if ($env:NAS_HOST) { $nasHost = $env:NAS_HOST.Trim() }
  if ($env:NAS_SHARE) { $nasShare = $env:NAS_SHARE.Trim() }

  if (-not $nasHost) {
    $nasHost = "192.168.1.66"
  }

  if (-not $materialRoot -or ($materialRoot -notmatch [regex]::Escape("\\$nasHost\\"))) {
    $materialRoot = "\\$nasHost\$nasShare\material-assets"
  }

  return [PSCustomObject]@{
    NasHost            = $nasHost
    NasShare           = $nasShare
    MaterialAssetsRoot = $materialRoot
    UncShare           = "\\$nasHost\$nasShare"
  }
}
