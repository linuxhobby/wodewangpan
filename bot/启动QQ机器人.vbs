' 启动 QQ 机器人（静默后台运行，不弹黑窗口）
Option Explicit

Dim BOT_DIR, PYW, fso, ws, svc, list, p, running, napcat
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

' 优先用脚本自己所在目录（放仓库里直接双击）；桌面上那份则回落到写死的路径
BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
End If

' 写死解释器路径，避免 PATH 里有多份 Python 时起错、或者同时起两个
PYW = "C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe"

If Not fso.FileExists(BOT_DIR & "\app\bot.py") Then
  MsgBox "找不到机器人代码：" & vbCrLf & BOT_DIR & "\app\bot.py" & vbCrLf & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "启动 QQ 机器人"
  WScript.Quit 1
End If

If Not fso.FileExists(PYW) Then PYW = "pythonw"

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

If running Then
  MsgBox "QQ 机器人已经在运行了。" & vbCrLf & vbCrLf & _
         "要让改过的代码生效，请双击「重启QQ机器人」。", 64, "启动 QQ 机器人"
  WScript.Quit 0
End If

ws.CurrentDirectory = BOT_DIR
ws.Run """" & PYW & """ ""app\bot.py""", 0, False

If napcat Then
  MsgBox "QQ 机器人已启动。" & vbCrLf & vbCrLf & _
         "等 3 秒左右，在群里发 /帮助 试试。", 64, "启动 QQ 机器人"
Else
  MsgBox "机器人已启动，但没有检测到 NapCat（QQ 端）。" & vbCrLf & vbCrLf & _
         "请先启动 NapCat、让小号上线，否则机器人收不到群消息。", 48, "启动 QQ 机器人"
End If
