@echo off
chcp 65001 >nul
title wodewangpan 群机器人
cd /d "%~dp0"
echo 正在启动 wodewangpan 群机器人...
echo 日志：logs\ 目录
echo 关闭这个窗口机器人就停了
echo.
python "app\bot.py"
echo.
echo 机器人已退出。按任意键关闭。
pause >nul
