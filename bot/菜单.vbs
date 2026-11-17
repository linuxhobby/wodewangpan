 ' 机器人控制台：TG 机器人动作的唯一实现（2026-11-13 QQ 端迁绿联后精简）
' 用法：
'   wscript 菜单.vbs                 打开大字号图形菜单 菜单.hta
'   wscript 菜单.vbs 1..3           直接执行对应动作（5..7 为旧编号兼容）
'   wscript 菜单.vbs autostart-tg   开机静默拉起 TG 侧
'   wscript 菜单.vbs --check        只做语法自检，不执行任何动作
' 桌面与启动文件夹的快捷方式指向本文件或同目录垫片，文件名不要改。
' 编码：GBK + CRLF。wscript 按系统 ANSI 代码页读脚本，存成 UTF-8 中文弹窗会花。
Option Explicit

Dim fso, ws, BOT_DIR
Dim PYW, LOG_FILE
Dim action, labels, n

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)

PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(PYW) Then PYW = "pythonw"
LOG_FILE = BOT_DIR & "\logs\auto-start.log"

labels = Array("启动TG机器人", "重启TG机器人", "结束TG机器人")

action = ""
If WScript.Arguments.Count > 0 Then action = LCase(Trim(WScript.Arguments(0)))

If action = "--check" Then WScript.Quit 0

If action = "" Then
  ShowMenu
ElseIf IsNumeric(action) Then
  n = CInt(action)
  If n >= 1 And n <= 3 Then RunAction n
  If n >= 5 And n <= 7 Then RunAction n - 4
Else
  Select Case action
    Case "autostart-tg"
      AutoStart
    Case Else
      MsgBox "不认识的参数：" & action & vbCrLf & vbCrLf & "可用：1 到 3、autostart-tg。", 48, "机器人控制台"
  End Select
End If

WScript.Quit 0


' ---------- 图形菜单与兜底 ----------

Sub ShowMenu()
  Dim hta, mshta, env, i, pick, m
  hta = BOT_DIR & "\菜单.hta"
  mshta = ws.ExpandEnvironmentStrings("%WINDIR%") & "\System32\mshta.exe"
  If fso.FileExists(hta) And fso.FileExists(mshta) Then
    Set env = ws.Environment("Process")
    env("WODEWANGPAN_BOT_DIR") = BOT_DIR
    ws.Run "mshta.exe """ & hta & """", 1, False
    Exit Sub
  End If
  m = "机器人控制台" & vbCrLf & String(30, "-") & vbCrLf
  For i = 0 To UBound(labels)
    m = m & "  " & (i + 1) & ". " & labels(i) & vbCrLf
  Next
  m = m & String(30, "-") & vbCrLf & "输入序号执行，空或取消退出："
  Do
    pick = InputBox(m, "机器人控制台")
    If pick = "" Then Exit Do
    pick = Trim(pick)
    If IsNumeric(pick) Then
      n = CInt(pick)
      If n >= 1 And n <= UBound(labels) + 1 Then
        RunAction n
        Exit Do
      End If
    End If
    MsgBox "无效输入：请输入 1-" & (UBound(labels) + 1) & " 的序号。", 48, "机器人控制台"
  Loop
End Sub

Sub RunAction(num)
  Select Case num
    Case 1
      StartTG
    Case 2
      RestartTG
    Case 3
      StopTG
  End Select
End Sub


' ---------- 三个动作 ----------

Sub StartTG()
  Dim tail
  If Not fso.FileExists(BOT_DIR & "\app\telegram\bot.py") Then
    MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram\bot.py", 16, "启动 TG 机器人"
    Exit Sub
  End If
  If ProcessBusy() Then
    MsgBox "TG 机器人已经在运行，没有重复启动。" & vbCrLf & vbCrLf & "要让改动生效，用序号 2 重启。", 64, "启动 TG 机器人"
    Exit Sub
  End If
  LaunchTG
  WScript.Sleep 5000
  tail = LogTail()
  If InStr(1, tail, "Telegram 机器人启动", 1) > 0 Then
    MsgBox "TG 机器人已启动（独立进程）。" & vbCrLf & vbCrLf & "去 TG 群发 /help 试试。", 64, "启动 TG 机器人"
  ElseIf InStr(1, tail, "另一个 Telegram 进程", 1) > 0 Then
    MsgBox "已经有一个 TG 进程在跑了，这次启动的实例自动退出。" & vbCrLf & vbCrLf & "要换进程请先用序号 3 结束，再执行序号 1。", 48, "启动 TG 机器人"
  Else
    MsgBox "已启动，但日志里还没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & "完整日志：" & TgLogPath(), 48, "启动 TG 机器人"
  End If
End Sub

Sub RestartTG()
  Dim killed, i, tail, msg
  If Not fso.FileExists(BOT_DIR & "\app\telegram\bot.py") Then
    MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram\bot.py", 16, "重启 TG 机器人"
    Exit Sub
  End If
  killed = KillBy()
  i = 0
  Do While ProcessBusy() And i < 15
    WScript.Sleep 1000
    i = i + 1
  Loop
  WScript.Sleep 1500
  LaunchTG
  WScript.Sleep 5000
  i = 0
  Do While InStr(1, LogTail(), "Telegram 机器人启动", 1) = 0 And i < 15
    If InStr(1, LogTail(), "另一个 Telegram 进程", 1) > 0 Then Exit Do
    WScript.Sleep 1000
    i = i + 1
  Loop
  tail = LogTail()
  If InStr(1, tail, "Telegram 机器人启动", 1) > 0 Then
    msg = "TG 机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & vbCrLf & "去 TG 群发 /help 试试。"
    MsgBox msg, 64, "重启 TG 机器人"
  Else
    MsgBox "重启了，但日志里没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & "完整日志：" & TgLogPath(), 48, "重启 TG 机器人"
  End If
End Sub

Sub StopTG()
  Dim killed
  killed = KillBy()
  If killed = 0 Then
    MsgBox "没有找到正在运行的 TG 机器人（app\telegram\bot.py）。" & vbCrLf & vbCrLf & "它可能本来就没启动。", 64, "结束 TG 机器人"
  Else
    MsgBox "已结束 TG 机器人（" & killed & " 个进程）。" & vbCrLf & vbCrLf & "要重新启动，用菜单序号 1。", 64, "结束 TG 机器人"
  End If
End Sub


' ---------- 开机自启 ----------

Sub AutoStart()
  Dim act
  WScript.Sleep 25000
  If Not fso.FileExists(BOT_DIR & "\app\telegram\bot.py") Then
    LogLine "[TG] 找不到 app\telegram\bot.py，跳过：" & BOT_DIR
    Exit Sub
  End If
  If ProcessBusy() Then
    act = "[TG] 已在运行，跳过"
  Else
    LaunchTG
    act = "[TG] 已启动 TG（独立进程）"
  End If
  LogLine act
End Sub


' ---------- 公共工具 ----------

Sub LaunchTG()
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\telegram\bot.py""", 0, False
End Sub

Function ProcessBusy()
  Dim svc, list, p, cmd, nm, busy
  busy = False
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each p In list
    cmd = p.CommandLine & ""
    nm = LCase(p.Name & "")
    If InStr(1, nm, "python", 1) > 0 Then
      If InStr(1, cmd, "app\telegram\bot.py", 1) > 0 Then busy = True
    End If
  Next
  Err.Clear
  On Error GoTo 0
  ProcessBusy = busy
End Function

Function KillBy()
  Dim svc, list, p, cmd, nm, cnt, hit
  cnt = 0
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each p In list
    cmd = p.CommandLine & ""
    nm = LCase(p.Name & "")
    hit = False
    If InStr(1, nm, "python", 1) > 0 Then
      If InStr(1, cmd, "app\telegram\bot.py", 1) > 0 Then hit = True
    End If
    If hit Then
      p.Terminate
      cnt = cnt + 1
    End If
  Next
  Err.Clear
  On Error GoTo 0
  KillBy = cnt
End Function

Function TgLogPath()
  TgLogPath = BOT_DIR & "\logs\tg-" & Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & ".log"
End Function

Function LogTail()
  Dim f, s, arr, k
  LogTail = "（没有日志文件）"
  On Error Resume Next
  If Not fso.FileExists(TgLogPath()) Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  Set f = fso.OpenTextFile(TgLogPath(), 1)
  s = f.ReadAll
  f.Close
  arr = Split(s, vbLf)
  For k = UBound(arr) To 0 Step -1
    If Len(Trim(arr(k))) > 0 Then
      LogTail = Trim(arr(k))
      Err.Clear
      On Error GoTo 0
      Exit Function
    End If
  Next
  Err.Clear
  On Error GoTo 0
End Function

Sub LogLine(text)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(LOG_FILE, 8, True)
  f.WriteLine Now & "  " & text
  f.Close
  Err.Clear
  On Error GoTo 0
End Sub
