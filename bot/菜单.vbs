' 机器人控制台：QQ 与 TG 全部动作的唯一实现（2026-11-11 合并版）
' 用法：
'   wscript 菜单.vbs                 打开大字号图形菜单 菜单.hta
'   wscript 菜单.vbs 1..7           直接执行对应动作
'   wscript 菜单.vbs autostart-qq   开机静默拉起 QQ 侧
'   wscript 菜单.vbs autostart-tg   开机静默拉起 TG 侧
'   wscript 菜单.vbs --check        只做语法自检，不执行任何动作
' 桌面与启动文件夹的快捷方式指向本文件或同目录垫片，文件名不要改。
' 编码：GBK + CRLF。wscript 按系统 ANSI 代码页读脚本，存成 UTF-8 中文弹窗会花。
Option Explicit

Dim fso, ws, BOT_DIR
Dim PYW, NAPCAT_DIR, NAPCAT_BAT, QQUIN, QR_IMG, DESKTOP_QR, PY_QR, QR_TOOL, LOG_FILE
Dim action, labels, n

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
End If

PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
If Not fso.FileExists(PYW) Then PYW = "pythonw"
NAPCAT_DIR = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.Shell.v4"
NAPCAT_BAT = NAPCAT_DIR & "\napcat.bat"
QQUIN = "909008620"
QR_IMG = NAPCAT_DIR & "\napcat\cache\qrcode.png"
DESKTOP_QR = ws.SpecialFolders("Desktop") & "\QQ登录二维码.png"
PY_QR = "C:\Users\marco\.workbuddy\tools\venv\Scripts\python.exe"
QR_TOOL = BOT_DIR & "\scripts\qr_desktop.py"
LOG_FILE = BOT_DIR & "\logs\auto-start.log"

labels = Array("启动QQ机器人", "重启QQ机器人", "结束QQ机器人", "QQ扫码登录", "启动TG机器人", "重启TG机器人", "结束TG机器人")

action = ""
If WScript.Arguments.Count > 0 Then action = LCase(Trim(WScript.Arguments(0)))

If action = "--check" Then WScript.Quit 0

If action = "" Then
  ShowMenu
ElseIf IsNumeric(action) Then
  n = CInt(action)
  If n >= 1 And n <= 7 Then RunAction n
Else
  Select Case action
    Case "autostart-qq"
      AutoStart False
    Case "autostart-tg"
      AutoStart True
    Case Else
      MsgBox "不认识的参数：" & action & vbCrLf & vbCrLf & "可用：1 到 7、autostart-qq、autostart-tg。", 48, "机器人控制台"
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
      StartQQ
    Case 2
      RestartQQ
    Case 3
      StopQQ
    Case 4
      QrLogin
    Case 5
      StartTG
    Case 6
      RestartTG
    Case 7
      StopTG
  End Select
End Sub


' ---------- 七个动作 ----------

Sub StartQQ()
  Dim msg, note
  If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
    MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py", 16, "启动 QQ 机器人"
    Exit Sub
  End If
  note = EnsureNapcat()
  If ProcessBusy("bot") Then
    msg = "QQ 机器人已经在运行，没有重复启动。改过代码请用序号 2 重启。"
  Else
    LaunchBot
    msg = "QQ 机器人已启动，等 3 秒左右在群里发 /帮助 试试。"
  End If
  MsgBox note & vbCrLf & vbCrLf & msg, 64, "启动 QQ 机器人"
End Sub

Sub RestartQQ()
  Dim killed, dummy, i, msg
  If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
    MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py", 16, "重启 QQ 机器人"
    Exit Sub
  End If
  killed = KillBy("bot")
  dummy = KillBy("napcat")
  i = 0
  Do While (ProcessBusy("napcat") Or ProcessBusy("bot")) And i < 20
    WScript.Sleep 1000
    i = i + 1
    If i = 8 And ProcessBusy("napcat") Then dummy = KillBy("napcat")
  Loop
  WScript.Sleep 2000
  If Not fso.FileExists(NAPCAT_BAT) Then
    MsgBox "找不到 NapCat 程序，没能拉起：" & vbCrLf & NAPCAT_BAT, 16, "重启 QQ 机器人"
    Exit Sub
  End If
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run """" & NAPCAT_BAT & """ -q " & QQUIN, 0, False
  LaunchBot
  i = 0
  Do While Not PortReady() And i < 120
    WScript.Sleep 2000
    i = i + 2
  Loop
  If PortReady() Then
    msg = "已就绪（等 " & i & " 秒）。" & vbCrLf & vbCrLf
    msg = msg & "机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf
    msg = msg & "TG 是独立进程，这次没动它，不用管。" & vbCrLf
    msg = msg & "去群里发 /帮助 试试。"
    MsgBox msg, 64, "重启 QQ 机器人"
  Else
    msg = "QQ 这边没登录成功，所以群里还是不会有反应。" & vbCrLf & vbCrLf
    msg = msg & "NapCat 等了 120 秒还没开出 3000 端口，通常是 QQ 掉登录了，需要人工扫码一次。" & vbCrLf & vbCrLf
    msg = msg & "1）用菜单序号 4 打开 QQ 扫码登录" & vbCrLf
    msg = msg & "2）用手机 QQ 扫码，等控制台出现登录成功" & vbCrLf
    msg = msg & "3）再执行一次序号 2，看到「已就绪」就成了" & vbCrLf & vbCrLf
    msg = msg & "注：TG 跑在独立进程里，这次重启没有影响它。"
    MsgBox msg, 48, "重启 QQ 机器人 · QQ 未登录"
  End If
End Sub

Sub StopQQ()
  Dim killed
  killed = KillBy("bot")
  If killed = 0 Then
    MsgBox "没有找到正在运行的 QQ 机器人（bot.py）。" & vbCrLf & vbCrLf & "它可能本来就没启动。", 64, "结束 QQ 机器人"
  Else
    MsgBox "已结束 QQ 机器人（" & killed & " 个进程）。" & vbCrLf & vbCrLf & "TG 机器人是独立进程，没动；其它 Python 进程同样没动。" & vbCrLf & "要重新启动，用菜单序号 1。", 64, "结束 QQ 机器人"
  End If
End Sub

Sub QrLogin()
  Dim i, q, msg, oldM, haveOld, fresh
  If PortReady() Then
    MsgBox "QQ 已经在线，不用扫码。" & vbCrLf & vbCrLf & "如果群里发指令没反应，那是别的问题，跟我说「QQ 没反应」排查。", 64, "QQ 扫码登录"
    Exit Sub
  End If
  If Not fso.FileExists(NAPCAT_BAT) Then
    MsgBox "找不到新版 NapCat：" & vbCrLf & NAPCAT_BAT, 16, "QQ 扫码登录"
    Exit Sub
  End If
  ' 记住旧二维码时间：只认 NapCat 新画出来的码，避免拿上次残留的过期码
  haveOld = False
  If fso.FileExists(QR_IMG) Then
    oldM = fso.GetFile(QR_IMG).DateLastModified
    haveOld = True
  End If
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run "cmd /c """ & NAPCAT_BAT & """ -q " & QQUIN, 1, False
  fresh = False
  i = 0
  Do While i < 120
    WScript.Sleep 2000
    i = i + 2
    If PortReady() Then
      MsgBox "QQ 登录成功（快速登录，没用扫码）。" & vbCrLf & "机器人自动恢复，去群里发 /帮助 试试。" & vbCrLf & vbCrLf & "那个黑色控制台窗口可以关掉，关掉不影响在线。", 64, "QQ 扫码登录"
      Exit Sub
    End If
    If fso.FileExists(QR_IMG) Then
      If (Not haveOld) Or (fso.GetFile(QR_IMG).DateLastModified > oldM) Then
        fresh = True
        Exit Do
      End If
    End If
  Loop
  If Not fresh Then
    MsgBox "等了 120 秒：既没快速登录成功，也没等到新二维码。" & vbCrLf & "看看黑色控制台窗口里的报错，稍后重新执行菜单序号 4。", 48, "QQ 扫码登录"
    Exit Sub
  End If
  ' 新码放大落桌面并直接弹出（qr_desktop.py：4x 放大 + 静区白边）
  q = Chr(34)
  ws.Run q & PY_QR & q & " " & q & QR_TOOL & q & " " & q & QR_IMG & q, 0, True
  If fso.FileExists(DESKTOP_QR) Then
    ws.Run q & DESKTOP_QR & q, 1, False
  Else
    ws.Run q & QR_IMG & q, 1, False
  End If
  msg = "新二维码已生成，桌面「QQ登录二维码.png」已自动打开。" & vbCrLf & vbCrLf
  msg = msg & "用手机 QQ 扫它即可；黑色控制台窗口里的码太小，不用看那个。" & vbCrLf
  msg = msg & "注意：二维码几分钟就过期，过期后重新执行菜单序号 4，会自动换新码。" & vbCrLf
  msg = msg & "扫码成功后机器人自动恢复，不用重启。"
  MsgBox msg, 64, "QQ 扫码登录 · 请扫码"
End Sub

Sub StartTG()
  Dim tail
  If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
    MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram_bot.py", 16, "启动 TG 机器人"
    Exit Sub
  End If
  If ProcessBusy("tg") Then
    MsgBox "TG 机器人已经在运行，没有重复启动。" & vbCrLf & vbCrLf & "要让改动生效，用序号 6 重启。", 64, "启动 TG 机器人"
    Exit Sub
  End If
  LaunchTG
  WScript.Sleep 5000
  tail = LogTail()
  If InStr(1, tail, "Telegram 机器人启动", 1) > 0 Then
    MsgBox "TG 机器人已启动（独立进程）。" & vbCrLf & vbCrLf & "去 TG 群发 /help 试试。" & vbCrLf & "它现在和 QQ 分开跑，重启 QQ 不会把它停掉。", 64, "启动 TG 机器人"
  ElseIf InStr(1, tail, "另一个 Telegram 进程", 1) > 0 Then
    MsgBox "已经有一个 TG 进程在跑了，这次启动的实例自动退出。" & vbCrLf & vbCrLf & "要换进程请先用序号 7 结束，再执行序号 5。", 48, "启动 TG 机器人"
  Else
    MsgBox "已启动，但日志里还没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & "完整日志：" & TgLogPath(), 48, "启动 TG 机器人"
  End If
End Sub

Sub RestartTG()
  Dim killed, i, tail, msg
  If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
    MsgBox "找不到 TG 机器人代码：" & vbCrLf & BOT_DIR & "\app\telegram_bot.py", 16, "重启 TG 机器人"
    Exit Sub
  End If
  killed = KillBy("tg")
  i = 0
  Do While ProcessBusy("tg") And i < 15
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
    msg = "TG 机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & vbCrLf
    msg = msg & "QQ 那边没动。" & vbCrLf & "去 TG 群发 /help 试试。"
    MsgBox msg, 64, "重启 TG 机器人"
  Else
    MsgBox "重启了，但日志里没看到启动成功：" & vbCrLf & vbCrLf & tail & vbCrLf & vbCrLf & "完整日志：" & TgLogPath(), 48, "重启 TG 机器人"
  End If
End Sub

Sub StopTG()
  Dim killed
  killed = KillBy("tg")
  If killed = 0 Then
    MsgBox "没有找到正在运行的 TG 机器人（telegram_bot.py）。" & vbCrLf & vbCrLf & "它可能本来就没启动。", 64, "结束 TG 机器人"
  Else
    MsgBox "已结束 TG 机器人（" & killed & " 个进程）。" & vbCrLf & vbCrLf & "QQ 机器人没动，还在正常跑。" & vbCrLf & "要重新启动，用菜单序号 5。", 64, "结束 TG 机器人"
  End If
End Sub


' ---------- 开机自启 ----------

Sub AutoStart(isTg)
  Dim act
  WScript.Sleep 25000
  If isTg Then
    If Not fso.FileExists(BOT_DIR & "\app\telegram_bot.py") Then
      LogLine "[TG] 找不到 telegram_bot.py，跳过：" & BOT_DIR
      Exit Sub
    End If
    If ProcessBusy("tg") Then
      act = "[TG] 已在运行，跳过"
    Else
      LaunchTG
      act = "[TG] 已启动 TG（独立进程）"
    End If
  Else
    If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
      LogLine "找不到 bot.py，跳过：" & BOT_DIR
      Exit Sub
    End If
    If ProcessBusy("napcat") Then
      act = "NapCat 已在运行；"
    ElseIf fso.FileExists(NAPCAT_BAT) Then
      ws.CurrentDirectory = NAPCAT_DIR
      ws.Run """" & NAPCAT_BAT & """ -q " & QQUIN, 0, False
      act = "已拉起 NapCat；"
      WScript.Sleep 3000
    Else
      act = "找不到 NapCat（" & NAPCAT_BAT & "）；"
    End If
    If ProcessBusy("bot") Then
      act = act & "机器人已在运行，跳过"
    Else
      LaunchBot
      act = act & "已启动机器人"
    End If
  End If
  LogLine act
End Sub


' ---------- 公共工具 ----------

Sub LaunchBot()
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\bot.py""", 0, False
End Sub

Sub LaunchTG()
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\telegram_bot.py""", 0, False
End Sub

Function EnsureNapcat()
  If ProcessBusy("napcat") Then
    EnsureNapcat = "NapCat 已在运行。"
  ElseIf fso.FileExists(NAPCAT_BAT) Then
    ws.CurrentDirectory = NAPCAT_DIR
    ws.Run """" & NAPCAT_BAT & """ -q " & QQUIN, 0, False
    WScript.Sleep 3000
    EnsureNapcat = "NapCat（QQ 端）原本没在跑，已拉起。小号登录需要十几秒，之后群里才有反应。"
  Else
    EnsureNapcat = "找不到 NapCat 程序，没能拉起：" & vbCrLf & NAPCAT_BAT
  End If
End Function

Function ProcessBusy(kind)
  Dim svc, list, p, cmd, nm, busy
  busy = False
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each p In list
    cmd = p.CommandLine & ""
    nm = LCase(p.Name & "")
    If InStr(1, nm, "python", 1) > 0 Then
      If kind = "bot" Then
        If InStr(1, cmd, "bot.py", 1) > 0 And InStr(1, cmd, "telegram_bot.py", 1) = 0 Then busy = True
      ElseIf kind = "tg" Then
        If InStr(1, cmd, "telegram_bot.py", 1) > 0 Then busy = True
      End If
    End If
    If kind = "napcat" Then
      If InStr(1, cmd, "NapCat", 1) > 0 Then busy = True
      If nm = "qq.exe" And InStr(1, cmd, "NapCat", 1) > 0 Then busy = True
    End If
  Next
  Err.Clear
  On Error GoTo 0
  ProcessBusy = busy
End Function

Function KillBy(kind)
  Dim svc, list, p, cmd, nm, cnt, hit
  cnt = 0
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each p In list
    cmd = p.CommandLine & ""
    nm = LCase(p.Name & "")
    hit = False
    If kind = "napcat" Then
      If InStr(1, cmd, "NapCat.Shell.v4", 1) > 0 Or InStr(1, nm, "napcat", 1) > 0 Then hit = True
      If nm = "qq.exe" And InStr(1, cmd, "NapCat", 1) > 0 Then hit = True
    ElseIf InStr(1, nm, "python", 1) > 0 Then
      If kind = "bot" Then
        If InStr(1, cmd, "bot.py", 1) > 0 And InStr(1, cmd, "telegram_bot.py", 1) = 0 Then hit = True
      ElseIf kind = "tg" Then
        If InStr(1, cmd, "telegram_bot.py", 1) > 0 Then hit = True
      End If
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

Function PortReady()
  Dim x
  PortReady = False
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  x.setTimeouts 800, 800, 800, 800
  x.open "GET", "http://127.0.0.1:3000/get_status", False
  x.send
  If Err.Number = 0 Then PortReady = True
  Err.Clear
  On Error GoTo 0
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
