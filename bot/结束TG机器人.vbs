' 结束 TG 机器人：只结束命令行里带 telegram_bot.py 的 python / pythonw
' 不碰 QQ 机器人（app\bot.py），也不碰其它 Python 进程
Option Explicit

Dim svc, list, p, killed

killed = 0
On Error Resume Next
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
For Each p In list
  If InStr(1, p.CommandLine & "", "telegram_bot.py", 1) > 0 Then
    p.Terminate
    killed = killed + 1
  End If
Next
Err.Clear
On Error GoTo 0

If killed = 0 Then
  MsgBox "没有找到正在运行的 TG 机器人（telegram_bot.py）。" & vbCrLf & vbCrLf & _
         "它可能本来就没启动。", 64, "结束 TG 机器人"
Else
  MsgBox "已结束 TG 机器人（" & killed & " 个进程）。" & vbCrLf & vbCrLf & _
         "QQ 机器人没动，还在正常跑。" & vbCrLf & _
         "要重新启动，双击「启动TG机器人」。", 64, "结束 TG 机器人"
End If
