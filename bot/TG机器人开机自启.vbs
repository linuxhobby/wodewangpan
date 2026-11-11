' 开机自启（TG 侧）：启动文件夹快捷方式的指向对象，只负责转发到统一引擎。
' 真实实现在 菜单.vbs 的 autostart-tg，改逻辑请改那里，本文件不用动。
' 本文件必须留在 bot 目录里，启动文件夹只放指向它的快捷方式。
' 编码：GBK + CRLF。
Option Explicit

Dim fso, ws, d, target
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
d = fso.GetParentFolderName(WScript.ScriptFullName)
target = d & "\菜单.vbs"
If Not fso.FileExists(target) Then WScript.Quit 1
ws.Run "wscript.exe """ & target & """ autostart-tg", 0, False
