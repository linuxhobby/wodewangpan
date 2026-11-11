@echo off
chcp 65001 >nul
title wodewangpan 群机器人（含 NapCat）
cd /d "%~dp0"

set "NAPCAT_DIR=C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell"

echo ================================================
echo   wodewangpan 群机器人 一键启动
echo ================================================
echo.

if not exist "%NAPCAT_DIR%\NapCatWinBootMain.exe" (
  echo [错误] 找不到 NapCat：%NAPCAT_DIR%
  echo 请修改变量 NAPCAT_DIR 指向实际安装目录。
  pause
  exit /b 1
)

echo [1/2] 启动 NapCat ...
start "NapCat" /min "%NAPCAT_DIR%\NapCatWinBootMain.exe"

echo 等待 OneBot 接口就绪（端口 3000，最多 60 秒）...
set /a tries=0
:wait
timeout /t 2 >nul
set /a tries+=2
netstat -ano | findstr ":3000" | findstr LISTENING >nul
if %errorlevel%==0 goto ready
if %tries% lss 60 goto wait
echo [警告] 60 秒内端口 3000 未监听。
echo 可能需要在浏览器打开 http://127.0.0.1:6099/webui 点一下登录。
echo 机器人仍会启动，登录后会自动接上。
echo.

:ready
echo [2/2] 启动机器人 ...
echo.
echo 日志：logs\ 目录。关闭这个窗口机器人就停了。
echo.
python "%~dp0app\bot.py"

echo.
echo 机器人已退出。按任意键关闭。
pause >nul
