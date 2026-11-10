' 开机自启：等系统与 NapCat 就绪后，静默拉起 QQ 机器人（无弹窗）
' 放在「启动」文件夹里由系统调用；也可手动双击，效果等同静默启动
Option Explicit

Dim BOT_DIR, PYW, LOG, fso, ws, svc, list, p, running, napcat
BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
LOG = BOT_DIR & "\logs\auto-start.log"

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  LogLine "找不到 bot.py，跳过：" & BOT_DIR
  WScript.Quit 1
End If
If Not fso.FileExists(PYW) Then PYW = "pythonw"

' 开机后等 25 秒：避开通开机高峰，让 NapCat（QQ）先上线
WScript.Sleep 25000

running = False
napcat = False
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
For Each p In list
  If InStr(1, p.CommandLine & "", "bot.py", 1) > 0 Then running = True
Next
Set list = svc.ExecQuery("SELECT Name FROM Win32_Process WHERE Name='NapCatWinBootMain.exe' OR Name='QQ.exe'")
For Each p In list
  napcat = True
Next

If running Then
  LogLine "已在运行，跳过"
  WScript.Quit 0
End If

ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\bot.py""", 0, False

If napcat Then
  LogLine "已启动（NapCat 在线）"
Else
  LogLine "已启动（未检测到 NapCat，请确认 QQ 端会自启）"
End If

Sub LogLine(msg)
  On Error Resume Next
  Dim f
  Set f = fso.OpenTextFile(LOG, 8, True)
  f.WriteLine Now & "  " & msg
  f.Close
End Sub
