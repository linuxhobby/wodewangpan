#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram 适配层的离线自检，不联网、不需要 token。

覆盖三件事：
  1) 命令归一化：/s@bot、@bot 关键词、中文全角斜杠
  2) 拉丁命令到 handlers 指令的映射
  3) 纯文本版式 -> Telegram HTML 超链接的转换（含转义）
"""

import sys
import os

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE, "app"))

import json
import handlers
import tg_render
import telegram_bot as tg

CFG = json.load(open(os.path.join(BASE, "config.json"), encoding="utf-8"))
BOT = "wodewangpan_bot"

ok = 0
bad = 0


def check(name, got, want):
    global ok, bad
    if got == want:
        ok += 1
        print("  ✓ %s" % name)
    else:
        bad += 1
        print("  ✗ %s\n    want=%r\n    got =%r" % (name, want, got))


print("1) 命令归一化")
check("/s@bot 带空格", tg.normalize("/s@%s 神探狄仁杰" % BOT, BOT), "/s 神探狄仁杰")
check("/s@bot 无空格", tg.normalize("/s@%s" % BOT, BOT), "/s")
check("@bot + 纯关键词", tg.normalize("@%s 权力的游戏" % BOT, BOT), "权力的游戏")
check("全角斜杠", tg.normalize("／s 夏洛克", BOT), "/s 夏洛克")
check("多余空白压缩", tg.normalize("  /s   青之箱 ", BOT), "/s 青之箱")
check("普通闲聊原样", tg.normalize("今天有什么好看的", BOT), "今天有什么好看的")

print("2) 拉丁命令映射")
check("/search", tg._canonical("/search 青之箱"), "/s 青之箱")
check("/cats", tg._canonical("/cats"), "/cats")
check("/start", tg._canonical("/start"), "/help")
check("/more", tg._canonical("/more"), "/more")
check("未知命令不动", tg._canonical("/xyz"), "/xyz")
check("纯关键词不动", tg._canonical("青之箱"), "青之箱")

print("3) 版式转换")
plain = handlers.handle("/s 杀人执照", CFG, key="tg-test")[0]
html = tg_render.to_html(plain)
print("--- 纯文本 ---")
print(plain)
print("--- Telegram HTML ---")
print(html)
check("夸克是超链接", '<a href="https://pan.quark.cn/' in html, True)
check("百度是超链接", '<a href="https://pan.baidu.com/' in html, True)
check("正文不再有裸链接", "\thttps://" in html, False)
check("提取码保留在链接文字里", "提取码" in html, True)
check("站点尾巴也是链接", '<a href="https://www.wodewangpan.top"' in html, True)
check("制表符清除", "\t" in html, False)

print("4) 转义")
check("尖括号转义", tg_render.to_html("a < b & c"), "a &lt; b &amp; c")
check("链接行含特殊字符", tg_render.to_html("网盘\thttps://x.test/a?b=1&c=2"),
      '<a href="https://x.test/a?b=1&amp;c=2">网盘</a>')
check("链接名含尖括号", tg_render.to_html("a<b网盘\thttps://x.test/"),
      '<a href="https://x.test/">a&lt;b网盘</a>')

print("5) 各指令都能产出消息")
for q in ["/s 青之箱", "/latest", "/today", "/cats", "/random", "/help", "/more", "/id"]:
    try:
        out = handlers.handle(tg._canonical(q), CFG, key="tg-test")
        n = len(out)
        h = tg_render.to_html(out[0])
        assert h.strip()
        ok += 1
        print("  ✓ %-12s -> %d 条，首条 %d 字" % (q, n, len(out[0])))
    except Exception as e:
        bad += 1
        print("  ✗ %-12s 异常：%s" % (q, e))

print("\n结果：%d 通过，%d 失败" % (ok, bad))
sys.exit(1 if bad else 0)
