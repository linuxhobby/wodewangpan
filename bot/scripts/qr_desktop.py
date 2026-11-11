# -*- coding: utf-8 -*-
r"""QQ 登录二维码放大落桌面（供 菜单.vbs 序号 4 调用）。

用法: python qr_desktop.py [napcat二维码路径]
默认取 NapCat Shell v4 的 napcat/cache/qrcode.png。
输出: 桌面\QQ登录二维码.png（放大 4 倍 + 静区白边，覆盖旧文件）。
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else \
    r"C:\Users\marco\Downloads\NapCatOneKey\NapCat.Shell.v4\napcat\cache\qrcode.png"
DESKTOP = os.path.join(os.environ["USERPROFILE"], "Desktop")
OUT = os.path.join(DESKTOP, "QQ登录二维码.png")

if not os.path.isfile(SRC):
    print("二维码文件不存在:", SRC)
    sys.exit(1)

im = Image.open(SRC).convert("L")

# 整数倍最近邻放大，保持模块边缘锐利；目标约 600px 宽
scale = max(4, 600 // im.width)
big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)

# 静区白边 80px，手机识别更稳
pad = 80
canvas = Image.new("L", (big.width + pad * 2, big.height + pad * 2), 255)
canvas.paste(big, (pad, pad))
canvas.save(OUT)
print("已保存:", OUT, canvas.size)

# 原图备份（万一放大版反而不认）
try:
    import shutil
    shutil.copyfile(SRC, os.path.join(DESKTOP, "QQ登录二维码-原图.png"))
except OSError as e:
    print("原图备份失败(忽略):", e)
