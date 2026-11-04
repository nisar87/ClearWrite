Option Explicit

Dim shell, files, baseDir, electronPath
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
baseDir = files.GetParentFolderName(WScript.ScriptFullName)
electronPath = files.BuildPath(baseDir, "node_modules\electron\dist\electron.exe")

If Not files.FileExists(electronPath) Then
  MsgBox "ClearWrite could not find its Electron runtime. Run npm install in the ClearWrite folder, then try again.", vbExclamation, "ClearWrite"
  WScript.Quit 1
End If

shell.CurrentDirectory = baseDir
shell.Environment("Process")("CLEARWRITE_DATA_DIR") = files.BuildPath(baseDir, "data")
shell.Environment("Process")("ELECTRON_CONFIG_CACHE") = files.BuildPath(baseDir, "cache\electron")
shell.Run """" & electronPath & """ .", 0, False
