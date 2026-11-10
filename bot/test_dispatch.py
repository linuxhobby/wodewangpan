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

import bot  # noqa: E402

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

    total = len(results)
    passed = sum(1 for r in results if r)
    print(f"\n{passed}/{total} 通过")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
