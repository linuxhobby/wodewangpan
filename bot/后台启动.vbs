' 重启机器人：先结束旧的 bot.py 进程，再静默后台启动，不显示黑窗口
' 改完代码后直接双击本文件即可，不用先去任务管理器手动杀进程
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' 写死解释器路径，避免 PATH 里有多份 Python 时起错、或者同时起两个
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(PYW) Then PYW = "pythonw"

' 只杀命令行里带 bot.py 的 python / pythonw，不碰其它 Python 进程
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT * FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
For Each p In list
  If InStr(1, p.CommandLine & "", "bot.py", 1) > 0 Then p.Terminate
Next
WScript.Sleep 1200

ws.Run """" & PYW & """ ""app\bot.py""", 0, False
