' 开机自启：等系统就绪后，先拉起 NapCat（QQ 端），再拉起机器人，全程无弹窗
' 放在「启动」文件夹里由系统调用；也可手动双击
Option Explicit

Dim BOT_DIR, PYW, NAPCAT_EXE, NAPCAT_DIR, LOG, fso, ws, svc, list, p
Dim running, napcat, started, msg
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
NAPCAT_EXE = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell\NapCatWinBootMain.exe"
NAPCAT_DIR = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell"
LOG = BOT_DIR & "\logs\auto-start.log"

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  LogLine "找不到 bot.py，跳过：" & BOT_DIR
  WScript.Quit 1
End If
If Not fso.FileExists(PYW) Then PYW = "pythonw"

' 开机后等 25 秒：避开通开机高峰，让网络和磁盘先就绪
WScript.Sleep 25000

running = False
napcat = False
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
For Each p In list
  If InStr(1, p.Name & "", "python", 1) > 0 Then
    If InStr(1, p.CommandLine & "", "bot.py", 1) > 0 Then running = True
  End If
  If InStr(1, p.Name & "", "napcat", 1) > 0 Then napcat = True
  If LCase(p.Name & "") = "qq.exe" Then napcat = True
Next

started = ""
If napcat Then
  started = started & "NapCat 已在运行；"
ElseIf fso.FileExists(NAPCAT_EXE) Then
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run """" & NAPCAT_EXE & """", 0, False
  started = started & "已拉起 NapCat；"
  WScript.Sleep 3000
Else
  started = started & "找不到 NapCat（" & NAPCAT_EXE & "）；"
End If

If running Then
  started = started & "机器人已在运行，跳过"
Else
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\bot.py""", 0, False
  started = started & "已启动机器人"
End If

LogLine started

Sub LogLine(msg)
  On Error Resume Next
  Dim f
  Set f = fso.OpenTextFile(LOG, 8, True)
  f.WriteLine Now & "  " & msg
  f.Close
End Sub
