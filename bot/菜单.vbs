' 机器人控制台（桌面唯一入口，2026-11-11）
' 双击打开大字号菜单 菜单.hta；命令行参数直连动作（菜单.vbs 3 = 结束QQ机器人）
' 本文件是桌面快捷方式的指向对象；界面在同目录 菜单.hta，两个文件要放一起。
Option Explicit

Dim fso, ws, BOT_DIR, env
Dim labels, scripts, i, n, pick, m, hta, mshta

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

' 按脚本自身位置定位，经快捷方式启动也正确
BOT_DIR = fso.GetParentFolderName(WScript.ScriptFullName)

labels = Array( _
  "启动QQ机器人", _
  "重启QQ机器人", _
  "结束QQ机器人", _
  "QQ扫码登录", _
  "启动TG机器人", _
  "重启TG机器人", _
  "结束TG机器人")

scripts = Array( _
  "启动QQ机器人.vbs", _
  "重启QQ机器人.vbs", _
  "结束QQ机器人.vbs", _
  "QQ扫码登录.vbs", _
  "启动TG机器人.vbs", _
  "重启TG机器人.vbs", _
  "结束TG机器人.vbs")

' ---------- 带参数直连（供测试/高级用法） ----------
If WScript.Arguments.Count > 0 Then
  pick = WScript.Arguments(0)
  If IsNumeric(pick) Then
    n = CInt(pick)
    If n >= 1 And n <= UBound(labels) + 1 Then
      ws.Run "wscript.exe """ & BOT_DIR & "\" & scripts(n - 1) & """", 1, False
    End If
  End If
  WScript.Quit
End If

' ---------- 打开大字号菜单（HTA 界面，字体/间距可控） ----------
hta = BOT_DIR & "\菜单.hta"
mshta = ws.ExpandEnvironmentStrings("%WINDIR%") & "\System32\mshta.exe"
If fso.FileExists(hta) And fso.FileExists(mshta) Then
  Set env = ws.Environment("Process")
  env("WODEWANGPAN_BOT_DIR") = BOT_DIR
  ws.Run "mshta.exe """ & hta & """", 1, False
  WScript.Quit
End If

' ---------- 兜底：系统 InputBox（HTA 缺失/被禁时才用） ----------
m = "机器人控制台" & vbCrLf & String(30, "-") & vbCrLf
For i = 0 To UBound(labels)
  m = m & "  " & (i + 1) & ". " & labels(i) & vbCrLf
Next
m = m & String(30, "-") & vbCrLf & "输入序号执行，空/取消退出："

Do
  pick = InputBox(m, "机器人控制台")
  If pick = "" Then WScript.Quit          ' 取消或空 = 退出
  pick = Trim(pick)
  If IsNumeric(pick) Then
    n = CInt(pick)
    If n >= 1 And n <= UBound(labels) + 1 Then
      ws.Run "wscript.exe """ & BOT_DIR & "\" & scripts(n - 1) & """", 1, False
      WScript.Quit                        ' 已执行，菜单退出
    End If
  End If
  MsgBox "无效输入：请输入 1-" & (UBound(labels) + 1) & " 的序号。", 48, "机器人控制台"
Loop
