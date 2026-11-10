' 静默后台启动，不显示黑窗口
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run """pythonw"" ""app\bot.py""", 0, False
