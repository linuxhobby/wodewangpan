' 重启 TG 机器人：只动 TG，不影响 QQ
' 顺序：结束旧进程 -> 等它真退干净（释放单实例锁）-> 启动 -> 等日志确认
Option Explicit

Dim BOT_DIR, PYW, fso, ws, svc, list, p, i, killed, tail

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
  BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
End If

PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(PYW) Then PYW = "pythonw"

If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
  MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram_bot.py", 16, "重启 TG 机器人"
  WScript.Quit 1
End If

On Error Resume Next

' ---------- 1. 结束旧进程 ----------
killed = 0
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
For Each p In list
  If InStr(1, p.CommandLine & "", "telegram_bot.py", 1) > 0 Then
    p.Terminate
    killed = killed + 1
  End If
Next

' ---------- 2. 等它退出（锁没释放就起新的，会直接被挡回来） ----------
i = 0
Do While TgBusy() And i < 15
  WScript.Sleep 1000
  i = i + 1
Loop
WScript.Sleep 1500

' ---------- 3. 启动 ----------
ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\telegram_bot.py""", 0, False

' ---------- 4. 等日志确认（最多 20 秒） ----------
WScript.Sleep 5000
i = 0
Do While InStr(1, LogTail(), "Telegram 机器人启动", 1) = 0 And i < 15
  If InStr(1, LogTail(), "另一个 Telegram 进程", 1) > 0 Then Exit Do
  WScript.Sleep 1000
  i = i + 1
Loop

tail = LogTail()
If InStr(1, tail, "Telegram 机器人启动", 1) > 0 Then
  MsgBox "TG 机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & vbCrLf & _
         "QQ 那边没动。" & vbCrLf & _
         "去 TG 群发 /help 试试。", 64, "重启 TG 机器人"
Else
  MsgBox "重启了，但日志里没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & _
         "完整日志：" & LogPath(), 48, "重启 TG 机器人"
End If

Function TgBusy()
  Dim q, c, busy
  busy = False
  On Error Resume Next
  Set q = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='pythonw.exe' OR Name='python.exe'")
  For Each c In q
    If InStr(1, c.CommandLine & "", "telegram_bot.py", 1) > 0 Then busy = True
  Next
  Err.Clear
  On Error GoTo 0
  TgBusy = busy
End Function

Function LogPath()
  LogPath = BOT_DIR & "\logs\tg-" & Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & ".log"
End Function

Function LogTail()
  Dim f, s, arr, k
  LogTail = "（没有日志文件）"
  On Error Resume Next
  If Not fso.FileExists(LogPath()) Then Exit Function
  Set f = fso.OpenTextFile(LogPath(), 1)
  s = f.ReadAll
  f.Close
  arr = Split(s, vbLf)
  For k = UBound(arr) To 0 Step -1
    If Len(Trim(arr(k))) > 0 Then
      LogTail = Trim(arr(k))
      Exit Function
    End If
  Next
  Err.Clear
  On Error GoTo 0
End Function
