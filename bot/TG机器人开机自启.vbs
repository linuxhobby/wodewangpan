' TG 机器人开机自启：等系统就绪后静默拉起，全程无弹窗
' 放在「启动」文件夹里由系统调用；也可手动双击
' 只负责 Telegram，和 QQ 的开机自启互不依赖：QQ 没登上也照样起 TG
Option Explicit

Dim BOT_DIR, PYW, LOG, fso, ws, svc, list, p
Dim running, act

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
LOG = BOT_DIR & "\logs\auto-start.log"

If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
  LogLine "找不到 telegram_bot.py，跳过：" & BOT_DIR
  WScript.Quit 1
End If
If Not fso.FileExists(PYW) Then PYW = "pythonw"

' 开机后等 25 秒：避开开机高峰，让网络先就绪
WScript.Sleep 25000

running = False
On Error Resume Next
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='python.exe' OR Name='pythonw.exe'")
For Each p In list
  If InStr(1, p.CommandLine & "", "telegram_bot.py", 1) > 0 Then running = True
Next
Err.Clear
On Error GoTo 0

If running Then
  act = "TG 已在运行，跳过"
Else
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\telegram_bot.py""", 0, False
  act = "已启动 TG（独立进程）"
End If

LogLine act

Sub LogLine(msg)
  On Error Resume Next
  Dim f
  Set f = fso.OpenTextFile(LOG, 8, True)
  f.WriteLine Now & "  [TG] " & msg
  f.Close
End Sub
