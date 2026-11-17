' Hidden Z: SMB map. The drive stays after this process exits.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "d:\CURSOR~1\LIGHT_~2\DESKTO~1"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File d:\CURSOR~1\LIGHT_~2\DESKTO~1\ENSURE~1.PS1", 0, False