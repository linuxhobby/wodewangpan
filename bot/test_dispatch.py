#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OneBot 接入层验证：不连 NapCat，用伪造事件驱动 process()，
把本该发出去的消息拦在 _api 这一层，确认 @ 识别、去重、限频、白名单都对。
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

from qq import bot  # noqa: E402   2026-11-12 平台拆分后 QQ 入口在 app/qq/bot.py

SENT = []


def fake_api(action, params):
    SENT.append({"action": action, "params": params})
    return {"status": "ok", "retcode": 0}


bot._api = fake_api
bot.CFG["group_whitelist"] = []
bot.CFG["cooldown_seconds"] = 15

SELF = 3000000001


def ev_group(text, user=111, mid="m1", seg=True, group=987654321):
    if seg:
        msg = [
            {"type": "at", "data": {"qq": str(SELF)}},
            {"type": "text", "data": {"text": " " + text}},
        ]
        raw = f"[CQ:at,qq={SELF}] {text}"
    else:
        msg = f"[CQ:at,qq={SELF}] {text}"
        raw = msg
    return {
        "post_type": "message", "message_type": "group",
        "self_id": SELF, "group_id": group, "user_id": user,
        "message_id": mid, "message": msg, "raw_message": raw,
        "sender": {"nickname": "测试员"},
    }


def ev_private(text, user=222, mid="p1"):
    return {
        "post_type": "message", "message_type": "private",
        "self_id": SELF, "user_id": user, "message_id": mid,
        "message": [{"type": "text", "data": {"text": text}}],
        "raw_message": text, "sender": {"nickname": "私聊用户"},
    }


def check(name, case, expect_sent, expect_kind=None):
    SENT.clear()
    case()
    ok = len(SENT) == expect_sent
    if ok and expect_sent and expect_kind:
        ok = SENT[0]["action"] == expect_kind
    flag = "PASS" if ok else "FAIL"
    detail = ""
    if SENT:
        first = SENT[0]["params"].get("message")
        preview = json.dumps(first, ensure_ascii=False)[:70]
        detail = f" | {SENT[0]['action']} {preview}"
    print(f"[{flag}] {name}  (发出 {len(SENT)} 条，期望 {expect_sent}){detail}")
    return ok


def main():
    results = []

    results.append(check("群里 @机器人 /帮助", lambda: bot.process(ev_group("/帮助")), 1, "send_group_msg"))
    results.append(check("群里 @机器人 搜索（array 段）",
                         lambda: bot.process(ev_group("/搜索 青之箱", user=112, mid="m2")), 1, "send_group_msg"))
    results.append(check("群里 @机器人 搜索（CQ 字符串上报）",
                         lambda: bot.process(ev_group("/搜索 青之箱", user=113, mid="m3", seg=False)), 1, "send_group_msg"))
    results.append(check("群里没 @ 也没斜杠（应静默，避免把聊天当搜索）",
                         lambda: bot.process({**ev_group("青之箱", user=114, mid="m4"),
                                              "message": [{"type": "text", "data": {"text": "青之箱"}}],
                                              "raw_message": "青之箱"}), 0))
    results.append(check("群里没 @ 但以 / 开头（应放行）",
                         lambda: bot.process({**ev_group("/搜索 青之箱", user=117, mid="m4b"),
                                              "message": [{"type": "text", "data": {"text": "/搜索 青之箱"}}],
                                              "raw_message": "/搜索 青之箱"}), 1, "send_group_msg"))
    results.append(check("同 message_id 重复上报（应去重）",
                         lambda: bot.process(ev_group("/帮助", user=115, mid="m2")), 0))
    results.append(check("同一人 15 秒内连发（应限频）",
                         lambda: bot.process(ev_group("/帮助", user=112, mid="m5")), 0))
    results.append(check("私聊直接发指令", lambda: bot.process(ev_private("/帮助")), 1, "send_private_msg"))

    bot.CFG["group_whitelist"] = ["123456"]
    results.append(check("非白名单群（应静默）",
                         lambda: bot.process(ev_group("/帮助", user=116, mid="m6")), 0))
    bot.CFG["group_whitelist"] = ["987654321"]
    results.append(check("白名单内的群（应放行）",
                         lambda: bot.process(ev_group("/帮助", user=119, mid="m7")), 1, "send_group_msg"))

    bot.CFG["reply_at_sender"] = True
    SENT.clear()
    bot.process(ev_group("/帮助", user=118, mid="m8"))
    at_ok = bool(SENT) and isinstance(SENT[0]["params"]["message"], list) \
        and SENT[0]["params"]["message"][0]["type"] == "at"
    print(f"[{'PASS' if at_ok else 'FAIL'}] 开启回复时 @ 发送者")
    results.append(at_ok)
    bot.CFG["reply_at_sender"] = False

    # QQ 渲染：中立标记 [网盘名](URL) -> 裸 URL，提取码不能丢
    from qq import render as qq_render
    sample = ("• 资源标题 · [夸克网盘](https://pan.quark.cn/s/abc) · "
              "[百度网盘（提取码 fw1j）](https://pan.baidu.com/s/xyz)")
    out = qq_render.to_plain(sample)
    raw_ok = ("[夸克网盘]" not in out and "https://pan.quark.cn/s/abc" in out
              and "https://pan.baidu.com/s/xyz （提取码 fw1j）" in out)
    print(f"[{'PASS' if raw_ok else 'FAIL'}] QQ 渲染成裸链并保留提取码")
    results.append(raw_ok)

    # 真实走一遍 /搜索，确认群里收到的是新版式 + 站点尾部 + /help
    SENT.clear()
    bot.process(ev_group("/搜索 杀人执照", user=120, mid="m9"))
    txt = SENT[0]["params"]["message"] if SENT else ""
    if isinstance(txt, list):
        txt = "".join(seg.get("data", {}).get("text", "") for seg in txt)
    fmt_ok = (isinstance(txt, str) and "🔍 搜索结果" in txt and "• " in txt
              and " · " in txt and "https://pan.quark.cn" in txt and "](" not in txt
              and "更多资源访问：https://www.wodewangpan.top" in txt
              and "/help  - 查看指令表" in txt)
    print(f"[{'PASS' if fmt_ok else 'FAIL'}] QQ 群查询版式（🔍/•/中点/裸链/站点尾部）")
    results.append(fmt_ok)

    # 搜索无结果：直接给可复制的 /f 指令行（被动反馈入口）
    SENT.clear()
    bot.process(ev_group("/搜索 不存在的资源xyz", user=121, mid="m10"))
    txt = SENT[0]["params"]["message"] if SENT else ""
    if isinstance(txt, list):
        txt = "".join(seg.get("data", {}).get("text", "") for seg in txt)
    fb_ok = (isinstance(txt, str) and "没找到" in txt
             and "反馈资源无效 / 资源错误" in txt
             and "/f 不存在的资源xyz" in txt)
    print(f"[{'PASS' if fb_ok else 'FAIL'}] 无结果自动带 /f 反馈指令行")
    results.append(fb_ok)

    # 主动反馈：/f 与 /错误 都认（飞书发送打桩，不真发）
    from core import feedback as fbmod
    _real_fb = fbmod.send_feedback
    fbmod.send_feedback = lambda *a, **kw: True
    SENT.clear()
    bot.process(ev_group("/错误 链接挂了", user=122, mid="m11"))
    reply = SENT[0]["params"]["message"] if SENT else ""
    cmd_ok = isinstance(reply, str) and "已反馈给管理员" in reply
    print(f"[{'PASS' if cmd_ok else 'FAIL'}] 主动指令 /错误 也可反馈")
    results.append(cmd_ok)
    fbmod.send_feedback = _real_fb

    total = len(results)
    passed = sum(1 for r in results if r)
    print(f"\n{passed}/{total} 通过")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
