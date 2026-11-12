#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地验证：不依赖 NapCat、不需要 QQ 登录，直接驱动指令处理逻辑。
会把每条指令的真实回复打印出来，用于确认查询与排版是否正常。
"""

import os
import sys
import json

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE, "app"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import handlers  # noqa: E402

CFG = json.load(open(os.path.join(BASE, "config.json"), encoding="utf-8"))

CASES = [
    "/搜索 青之箱",
    "/搜索 杀人执照",      # mv-412：同时有夸克与百度（带提取码），验证双网盘排版
    "权力的游戏",
    "qingzhixiang",
    "/s 夏洛克",
    "/更多",               # 翻页：接着上面那次搜索看下一批
    "/最新",
    "/今日",
    "/分类",
    "/随机",
    "/帮助",
    "三体",
    "/搜索",
    "/更多",
    "/不认识的指令 xyz",
]


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for q in CASES:
        if only and only not in q:
            continue
        print("=" * 60)
        print(f"输入：{q}")
        print("-" * 60)
        t0 = __import__("time").time()
        try:
            out = handlers.handle(q, CFG, "local-test")
        except Exception as e:
            print(f"!! 异常：{e.__class__.__name__}: {e}")
            continue
        cost = (__import__("time").time() - t0) * 1000
        for i, msg in enumerate(out, 1):
            tag = f"[第 {i}/{len(out)} 条] " if len(out) > 1 else ""
            print(tag + msg)
            if len(msg) > handlers.MAX_MSG_LEN:
                print(f"!! 超出单条长度上限：{len(msg)}")
        print(f"-- 耗时 {cost:.0f} ms，字数 {sum(len(m) for m in out)}")


if __name__ == "__main__":
    main()
