' QQ 扫码登录（适配 NapCat Shell v4，2026-11-11）
' 双击后：
'   1. 先探 OneBot 的 3000 端口，开着 = QQ 已在线，提示不用扫
'   2. 掉线时用「快速登录」拉起新版 NapCat（弹出一个控制台窗口），
'      平时快速登录直接就上去了，不用扫码
'   3. 如果登录态失效（半年一遇），控制台里会直接画出二维码，
'      用手机 QQ 扫它即可；同时二维码图片也存在 napcat\cache\qrcode.png
'   4. 扫码成功后机器人自动恢复，不用重启任何东西
Option Explicit

Dim BOT_DIR, NAPCAT_DIR, NAPCAT_BAT, QQUIN, QR_IMG, WS, FSO, i
BOT_DIR = "C:\Users\marco\Github\wodewangpan\bot"
NAPCAT_DIR = "C:\Users\marco\Downloads\NapCatOneKey\NapCat.Shell.v4"
NAPCAT_BAT = NAPCAT_DIR & "\napcat.bat"
QQUIN = "909008620"
QR_IMG = NAPCAT_DIR & "\napcat\cache\qrcode.png"

Set WS = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' ---------- 1. QQ 已在线就不折腾 ----------
If Port3000() Then
  MsgBox "QQ 已经在线，不用扫码。" & vbCrLf & vbCrLf & _
         "如果群里发指令没反应，那是别的问题，跟我说「QQ 没反应」排查。", 64, "QQ 扫码登录"
  WScript.Quit 0
End If

If Not FSO.FileExists(NAPCAT_BAT) Then
  MsgBox "找不到新版 NapCat：" & vbCrLf & NAPCAT_BAT & vbCrLf & vbCrLf & _
         "仓库目录没动，别改本脚本里的 NAPCAT_DIR。", 16, "QQ 扫码登录"
  WScript.Quit 1
End If

' ---------- 2. 弹出控制台快速登录（登录态有效就直接上去） ----------
WS.CurrentDirectory = NAPCAT_DIR
WS.Run "cmd /c """ & NAPCAT_BAT & """ -q " & QQUIN, 1, False

' ---------- 3. 等 OneBot 3000 端口（最多 120 秒） ----------
i = 0
Do While (Not Port3000()) And i < 120
  WScript.Sleep 2000
  i = i + 2
Loop

If Port3000() Then
  MsgBox "QQ 登录成功（快速登录，没用扫码）。" & vbCrLf & _
         "机器人自动恢复，去群里发 /帮助 试试。" & vbCrLf & vbCrLf & _
         "那个黑色控制台窗口可以关掉，关掉不影响在线。", 64, "QQ 扫码登录"
  WScript.Quit 0
End If

' ---------- 4. 快速登录失效：等用户扫控制台里的二维码 ----------
If FSO.FileExists(QR_IMG) Then
  WS.Run """" & QR_IMG & """", 1, False
End If

MsgBox "登录态已失效，需要扫码（较少发生）。" & vbCrLf & vbCrLf & _
       "刚弹出的黑色控制台窗口里已经画好二维码，" & vbCrLf & _
       "用手机 QQ 扫它即可；二维码图片也已打开。" & vbCrLf & vbCrLf & _
       "注意：二维码几分钟就过期，过期后关掉控制台窗口重新双击本脚本。" & vbCrLf & _
       "扫码成功后本窗口不用管，机器人自动恢复。", 48, "QQ 扫码登录 · 需要扫码"

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
