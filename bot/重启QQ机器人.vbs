' 重启 QQ 机器人：先结束旧的 bot.py 进程，再静默后台拉起
' 改完代码双击这个就生效（Python 没有热加载）
' NapCat 没在跑时会顺带把它拉起来
Option Explicit

Dim BOT_DIR, PYW, NAPCAT_EXE, NAPCAT_DIR, fso, ws, svc, list, p
Dim killed, napcat, napcatNote
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

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py" & vbCrLf & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "重启 QQ 机器人"
  WScript.Quit 1
End If

If Not fso.FileExists(PYW) Then PYW = "pythonw"

killed = 0
napcat = False
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set list = svc.ExecQuery("SELECT Name, CommandLine FROM Win32_Process")
For Each p In list
  If InStr(1, p.Name & "", "python", 1) > 0 Then
    If InStr(1, p.CommandLine & "", "bot.py", 1) > 0 Then
      p.Terminate
      killed = killed + 1
    End If
  End If
  If InStr(1, p.Name & "", "napcat", 1) > 0 Then napcat = True
  If LCase(p.Name & "") = "qq.exe" Then napcat = True
Next

WScript.Sleep 1200
ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\bot.py""", 0, False

If napcat Then
  napcatNote = "QQ 机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & vbCrLf & _
               "等 3 秒左右，在群里发 /帮助 试试。"
ElseIf fso.FileExists(NAPCAT_EXE) Then
  ws.CurrentDirectory = NAPCAT_DIR
  ws.Run """" & NAPCAT_EXE & """", 0, False
  napcatNote = "机器人已重启（结束旧进程 " & killed & " 个）；NapCat 原本没在跑，已顺带拉起。" & vbCrLf & vbCrLf & _
               "等小号自动登录后，在群里发 /帮助 试试。"
Else
  napcatNote = "机器人已重启（结束旧进程 " & killed & " 个），但找不到 NapCat 程序：" & vbCrLf & NAPCAT_EXE & vbCrLf & vbCrLf & _
               "请手动启动 NapCat，否则收不到群消息。"
End If

MsgBox napcatNote, 64, "重启 QQ 机器人"
