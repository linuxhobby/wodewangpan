' 重启 QQ 机器人：连 NapCat 一起重启，改完代码或掉线双击这个
' 顺序：结束旧的 bot 与 NapCat -> 等进程真的退干净 -> 起 NapCat（带账号快速登录）
'       -> 起 bot -> 轮询 :3000 确认 NapCat 真就绪，再明确告诉你成没成
' 为什么要轮询：NapCat 只有 QQ 登录成功后才会开 OneBot 的 3000 端口。
' 端口没起来时 bot 进程照样活着、TG 也照常回，但 QQ 群一条消息都收不到，看起来就是「挂了」。
Option Explicit

Const WAIT_EXIT = 20        ' 等旧进程真正退出的上限（秒）
Const WAIT_READY = 120      ' 等 NapCat 登录就绪的上限（秒）

Dim BOT_DIR, PYW, NAPCAT_EXE, NAPCAT_DIR, QQUIN, fso, ws, svc, list, p
Dim killed, napcatKilled, msg, nm, cmdline, i, alive

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

' 优先用脚本自己所在目录（放仓库里直接双击）；桌面上那份则回落到写死的路径
BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
End If

' 写死解释器路径，避免 PATH 里有多份 Python 时起错、或者同时起两个
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"
NAPCAT_EXE = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell\NapCatWinBootMain.exe"
NAPCAT_DIR = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell"
QQUIN = "909008620"

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py" & vbCrLf & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "重启 QQ 机器人"
  WScript.Quit 1
End If

If Not fso.FileExists(PYW) Then PYW = "pythonw"

On Error Resume Next

' ---------- 1. 结束旧的 bot 与 NapCat / QQ ----------
killed = 0
napcatKilled = 0
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
For Each p In list
  nm = p.Name & ""
  cmdline = p.CommandLine & ""
  If InStr(1, nm, "python", 1) > 0 Then
    If InStr(1, cmdline, "bot.py", 1) > 0 Then
      p.Terminate
      killed = killed + 1
    End If
  End If
  If InStr(1, nm, "napcat", 1) > 0 Or (LCase(nm) = "qq.exe" And InStr(1, cmdline, "NapCat", 1) > 0) Then
    p.Terminate
    napcatKilled = napcatKilled + 1
  End If
Next

' ---------- 2. 等进程真的退干净（QQ 的库文件句柄没释放就重启，容易卡在登录之前） ----------
i = 0
Do While (NapcatBusy() Or BotBusy()) And i < WAIT_EXIT
  WScript.Sleep 1000
  i = i + 1
  If i = 8 And NapcatBusy() Then
    KillNapcat
  End If
Loop
alive = NapcatBusy() Or BotBusy()
WScript.Sleep 2000

' ---------- 3. 起 NapCat（带账号参数，走快速登录，不用扫码） ----------
If fso.FileExists(NAPCAT_EXE) Then
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run """" & NAPCAT_EXE & """ " & QQUIN, 0, False
Else
  MsgBox "找不到 NapCat 程序，没能拉起：" & vbCrLf & NAPCAT_EXE, 16, "重启 QQ 机器人"
  WScript.Quit 1
End If

' ---------- 4. 起机器人本体 ----------
ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\bot.py""", 0, False

' ---------- 5. 等 NapCat 就绪（= QQ 真的登录上了，3000 端口开了） ----------
i = 0
Do While Not PortReady() And i < WAIT_READY
  WScript.Sleep 2000
  i = i + 2
Loop

If PortReady() Then
  msg = "已就绪（等 " & i & " 秒）。" & vbCrLf & vbCrLf & _
        "机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & _
        "去群里发 /帮助 试试。"
  MsgBox msg, 64, "重启 QQ 机器人"
Else
  msg = "QQ 这边没登录成功，所以群里还是不会有反应。" & vbCrLf & vbCrLf & _
        "NapCat 等了 " & WAIT_READY & " 秒还没开出 3000 端口，通常是 QQ 掉登录了，" & _
        "需要人工扫码一次：" & vbCrLf & vbCrLf & _
        "1）双击 " & NAPCAT_DIR & "\napcat.bat" & vbCrLf & _
        "   会开一个黑窗口，里面显示二维码和登录日志" & vbCrLf & _
        "2）用手机 QQ 扫码登录，等窗口里出现登录成功的日志" & vbCrLf & _
        "3）再双击一次本脚本，看到「已就绪」就成了" & vbCrLf & vbCrLf & _
        "注：TG 那边不受影响，它跑在同一个进程里，刚才一直是正常的。"
  MsgBox msg, 48, "重启 QQ 机器人 · QQ 未登录"
End If

' ---------- 工具函数 ----------

' NapCat / QQ 是否还在跑
Function NapcatBusy()
  Dim q, c, busy
  busy = False
  On Error Resume Next
  Set q = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each c In q
    If InStr(1, c.Name & "", "napcat", 1) > 0 Then busy = True
    If LCase(c.Name & "") = "qq.exe" And InStr(1, c.CommandLine & "", "NapCat", 1) > 0 Then busy = True
  Next
  Err.Clear
  On Error GoTo 0
  NapcatBusy = busy
End Function

' 机器人本体（python bot.py）是否还在跑
Function BotBusy()
  Dim q, c, busy
  busy = False
  On Error Resume Next
  Set q = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each c In q
    If InStr(1, c.Name & "", "python", 1) > 0 Then
      If InStr(1, c.CommandLine & "", "bot.py", 1) > 0 Then busy = True
    End If
  Next
  Err.Clear
  On Error GoTo 0
  BotBusy = busy
End Function

' 补刀：再杀一遍 NapCat / QQ
Sub KillNapcat()
  Dim q, c
  On Error Resume Next
  Set q = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
  For Each c In q
    If InStr(1, c.Name & "", "napcat", 1) > 0 Then c.Terminate
    If LCase(c.Name & "") = "qq.exe" And InStr(1, c.CommandLine & "", "NapCat", 1) > 0 Then c.Terminate
  Next
  Err.Clear
  On Error GoTo 0
End Sub

' NapCat 的 OneBot 端口是否已开（开了 = QQ 登录完成）
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
