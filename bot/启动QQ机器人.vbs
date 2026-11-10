' 启动 QQ 机器人（静默后台运行，不弹黑窗口）
' 顺序：先保 NapCat（QQ 端）在跑，再保机器人本体在跑
Option Explicit

Dim BOT_DIR, PYW, NAPCAT_EXE, NAPCAT_DIR, QQUIN, fso, ws, svc, list, p
Dim running, napcat, napcatStarted, msg

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
QQUIN = "909008620"
NAPCAT_DIR = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell"

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py" & vbCrLf & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "启动 QQ 机器人"
  WScript.Quit 1
End If

If Not fso.FileExists(PYW) Then PYW = "pythonw"

running = False
napcat = False
napcatStarted = False
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
For Each p In list
  If InStr(1, p.Name & "", "python", 1) > 0 Then
    If (InStr(1, p.CommandLine & "", "bot.py", 1) > 0 And InStr(1, p.CommandLine & "", "telegram_bot.py", 1) = 0) Then running = True
  End If
  If InStr(1, p.Name & "", "napcat", 1) > 0 Then napcat = True
  If LCase(p.Name & "") = "qq.exe" And InStr(1, p.CommandLine & "", "NapCat", 1) > 0 Then napcat = True
Next

' 第一步：NapCat 不在就先拉起来，不管机器人本体在不在跑
If Not napcat Then
  If fso.FileExists(NAPCAT_EXE) Then
    ws.CurrentDirectory = NAPCAT_DIR
    ws.Run """" & NAPCAT_EXE & """ " & QQUIN, 0, False
    napcatStarted = True
    WScript.Sleep 3000
  End If
End If

' 第二步：机器人本体不在才启动
If Not running Then
  ws.CurrentDirectory = BOT_DIR
  ws.Run """" & PYW & """ ""app\bot.py""", 0, False
End If

' 第三步：汇总提示
If napcatStarted Then
  msg = "NapCat（QQ 端）原本没在跑，已拉起。小号登录需要十几秒，之后群里才有反应。"
ElseIf napcat Then
  msg = "NapCat 已在运行。"
Else
  msg = "找不到 NapCat 程序，没能拉起：" & vbCrLf & NAPCAT_EXE
End If

msg = msg & vbCrLf & vbCrLf

If running Then
  msg = msg & "QQ 机器人已经在运行，没有重复启动。改过代码请用「重启QQ机器人」。"
Else
  msg = msg & "QQ 机器人已启动，等 3 秒左右在群里发 /帮助 试试。"
End If

MsgBox msg, 64, "启动 QQ 机器人"
