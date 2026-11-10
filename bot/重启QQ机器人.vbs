' 重启 QQ 机器人：先结束旧的 bot.py 进程，再静默后台拉起
' 改完代码双击这个就生效（Python 没有热加载）
Option Explicit

Dim BOT_DIR, PYW, fso, ws, svc, list, p, killed, napcat
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
  MsgBox "QQ 机器人已重启（结束旧进程 " & killed & " 个）。" & vbCrLf & vbCrLf & _
         "等 3 秒左右，在群里发 /帮助 试试。", 64, "重启 QQ 机器人"
Else
  MsgBox "机器人已重启（结束旧进程 " & killed & " 个），但没检测到 NapCat。" & vbCrLf & vbCrLf & _
         "请先启动 NapCat、让小号上线，否则收不到群消息。", 48, "重启 QQ 机器人"
End If
