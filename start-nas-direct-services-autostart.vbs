' Autostart NAS file-machine services hidden (no console).
' Prefer this VBS from the Windows Startup folder (already points here).
' It runs start-nas-direct-services.bat silent → full worker + derivative + LAN :9001/:9443 + optional Qwen/heartbeat.
Option Explicit
Dim fso, sh, dir, bat
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
bat = dir & "\start-nas-direct-services.bat"
If Not fso.FileExists(bat) Then
  WScript.Quit 1
End If
sh.CurrentDirectory = dir
' 0 = hide window; False = do not wait (MAIN stays as SilentKeepAlive)
sh.Run "cmd /c """ & bat & """ silent", 0, False
