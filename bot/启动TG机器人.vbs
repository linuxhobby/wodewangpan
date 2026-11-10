' 启动 TG 机器人（独立进程，静默后台，不弹黑窗口）
' 这一份只管 Telegram，和 QQ 完全分开：QQ 重启、NapCat 掉线、QQ 掉登录都不影响它
Option Explicit

Dim BOT_DIR, PYW, fso, ws, svc, list, p, running, tail

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
  BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
End If

' 写死解释器，避免 PATH 里有多个 Python 时起错
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(PYW) Then PYW = "pythonw"

If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
  MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram_bot.py" & vbCrLf & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "启动 TG 机器人"
  WScript.Quit 1
End If

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
  MsgBox "TG 机器人已经在运行，没有重复启动。" & vbCrLf & vbCrLf & _
         "要让改动生效，用「重启TG机器人」。", 64, "启动 TG 机器人"
  WScript.Quit 0
End If

ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\telegram_bot.py""", 0, False

' 等它把日志写出来，再照着最后一行告诉你成没成
WScript.Sleep 5000
tail = LogTail()

If InStr(1, tail, "Telegram 机器人启动", 1) > 0 Then
  MsgBox "TG 机器人已启动（独立进程）。" & vbCrLf & vbCrLf & _
         "去 TG 群发 /help 试试。" & vbCrLf & _
         "它现在和 QQ 分开跑，重启 QQ 不会把它停掉。", 64, "启动 TG 机器人"
ElseIf InStr(1, tail, "另一个 Telegram 进程", 1) > 0 Then
  MsgBox "已经有一个 TG 进程在跑了，这次启动的实例自动退出。" & vbCrLf & vbCrLf & _
         "要换进程请先用「结束TG机器人」再启动。", 48, "启动 TG 机器人"
Else
  MsgBox "已启动，但日志里还没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & _
         "完整日志：" & LogPath(), 48, "启动 TG 机器人"
End If

Function LogPath()
  LogPath = BOT_DIR & "\logs\tg-" & Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & ".log"
End Function

Function LogTail()
  Dim f, s, arr, i
  LogTail = "（没有日志文件）"
  On Error Resume Next
  If Not fso.FileExists(LogPath()) Then Exit Function
  Set f = fso.OpenTextFile(LogPath(), 1)
  s = f.ReadAll
  f.Close
  arr = Split(s, vbLf)
  For i = UBound(arr) To 0 Step -1
    If Len(Trim(arr(i))) > 0 Then
      LogTail = Trim(arr(i))
      Exit Function
    End If
  Next
  Err.Clear
  On Error GoTo 0
End Function
