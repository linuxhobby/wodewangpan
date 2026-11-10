' 重启 QQ 机器人：连 NapCat 一起重启，改完代码或掉线双击这个
' 顺序：结束旧的 bot 与 NapCat -> 起 NapCat（带账号走快速登录）-> 起 bot
Option Explicit

Dim BOT_DIR, PYW, NAPCAT_EXE, NAPCAT_DIR, QQUIN, fso, ws, svc, list, p
Dim killed, napcatKilled, msg, nm, cmdline

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

' 结束旧的 bot 与 NapCat / QQ
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

' 等进程真正退出、文件句柄释放，否则 QQ 会卡在半启动
WScript.Sleep 2500

' 起 NapCat（带账号参数，走快速登录，不用扫码）
If fso.FileExists(NAPCAT_EXE) Then
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run """" & NAPCAT_EXE & """ " & QQUIN, 0, False
  WScript.Sleep 3000
  msg = "NapCat 已拉起，正在快速登录 " & QQUIN & "（约 20 秒）。"
Else
  msg = "找不到 NapCat 程序，没能拉起：" & vbCrLf & NAPCAT_EXE
End If

' 起机器人本体
ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\bot.py""", 0, False

MsgBox msg & vbCrLf & vbCrLf & _
       "机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & _
       "等 20 秒左右，在群里发 /帮助 试试。", 64, "重启 QQ 机器人"
