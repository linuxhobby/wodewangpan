' QQ 扫码登录：双击即显示登录二维码，扫完机器人自动恢复
' 逻辑：
'   1. 先探 NapCat 的 3000 端口，开着 = QQ 已在线，提示不用扫
'   2. 掉登录时，后台跑 watch_qq_login.py（自己登录 WebUI、取码、过期自动刷新、盯状态）
'   3. 等二维码图片生成本地文件后，用默认图片查看器弹出来
Option Explicit

Dim BOT_DIR, PY, QR, WS, FSO, i
BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
QR = BOT_DIR & "\logs\qq-login-qr.png"
PY = "C:\Users\marco\AppData\Local\Programs\Python\Python312\python.exe"

Set WS = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

If Not FSO.FileExists(PY) Then PY = "python"

' ---------- 1. QQ 已在线就不折腾 ----------
If Port3000() Then
  MsgBox "QQ 已经在线，不用扫码。" & vbCrLf & vbCrLf & _
         "如果群里发指令没反应，那是别的问题，跟我说「QQ 没反应」排查。", 64, "QQ 扫码登录"
  WScript.Quit 0
End If

' ---------- 2. 后台启动盯状态的脚本（隐藏窗口） ----------
If Not FSO.FileExists(BOT_DIR & "\watch_qq_login.py") Then
  MsgBox "找不到 " & BOT_DIR & "\watch_qq_login.py" & vbCrLf & _
         "仓库可能被移动了，请修改本脚本里的 BOT_DIR。", 16, "QQ 扫码登录"
  WScript.Quit 1
End If
WS.CurrentDirectory = BOT_DIR
WS.Run """" & PY & """ watch_qq_login.py", 0, False

' ---------- 3. 等二维码生成本地文件（最多 15 秒） ----------
i = 0
Do While (Not FSO.FileExists(QR)) And i < 15
  WScript.Sleep 1000
  i = i + 1
Loop
If Not FSO.FileExists(QR) Then
  MsgBox "二维码没生成出来。" & vbCrLf & vbCrLf & _
         "多半是 NapCat 没在跑（WebUI 6099 连不上）。" & vbCrLf & _
         "双击 NapCat 目录里的 napcat.bat 先把 NapCat 拉起来，再试一次。", 48, "QQ 扫码登录"
  WScript.Quit 1
End If

' ---------- 4. 用默认图片查看器弹出二维码 ----------
WS.Run """" & QR & """", 1, False

MsgBox "二维码已弹出，用手机 QQ 扫一扫登录。" & vbCrLf & vbCrLf & _
       "· 扫码成功后机器人自动恢复，不用重启任何东西" & vbCrLf & _
       "· 二维码过期后台会自动刷新；图片看着旧，关掉重开一次本脚本即可" & vbCrLf & _
       "· 登录状态由后台脚本盯着，有效窗口 10 分钟", 64, "QQ 扫码登录"

' ---------- 工具函数 ----------

' NapCat 的 OneBot 端口开着 = QQ 已登录
Function Port3000()
  Dim X
  Port3000 = False
  On Error Resume Next
  Set X = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  X.setTimeouts 800, 800, 800, 800
  X.open "GET", "http://127.0.0.1:3000/get_status", False
  X.send
  If Err.Number = 0 Then Port3000 = True
  Err.Clear
  On Error GoTo 0
End Function
