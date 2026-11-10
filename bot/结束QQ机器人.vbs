' 结束 QQ 机器人：只结束命令行里带 bot.py 的 python / pythonw（刻意排除 telegram_bot.py）
' 不动其它 Python 进程（比如 WorkBuddy 自己的 venv pythonw）
Option Explicit

Dim fso, ws, svc, list, p, killed
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

killed = 0
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
For Each p In list
  If (InStr(1, p.CommandLine & "", "bot.py", 1) > 0 And InStr(1, p.CommandLine & "", "telegram_bot.py", 1) = 0) Then
    p.Terminate
    killed = killed + 1
  End If
Next

If killed = 0 Then
  MsgBox "没有找到正在运行的 QQ 机器人（bot.py）。" & vbCrLf & vbCrLf & _
         "它可能本来就没启动。", 64, "结束 QQ 机器人"
Else
  MsgBox "已结束 QQ 机器人（" & killed & " 个进程）。" & vbCrLf & vbCrLf & _
         "TG 机器人是独立进程，也没动；其它 Python 进程同样没动。" & vbCrLf & _
         "要重新启动，双击「启动QQ机器人」。", 64, "结束 QQ 机器人"
End If
