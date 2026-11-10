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
import os
import re
import sys
import time
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

print("6) 入群欢迎语")
w = tg.welcome_text()
print("  文案来源：%s，共 %d 字" % (os.path.basename(tg.WELCOME_FILE), len(w)))
check("读到的是文件而不是兜底", "网盘资源索引站" in w, True)
check("含 /s 用法", "/s 关键词" in w, True)
check("含 /more 用法", "/more" in w, True)
check("含站点地址", "https://www.wodewangpan.top" in w, True)
wh = tg_render.to_html(w)
check("站点地址转成超链接", '<a href="https://www.wodewangpan.top"' in wh, True)
check("没有裸链接残留", ">https://" in wh or wh.count("https://") == wh.count("href=\"https://"), True)

print("7) handle_update 对新成员的反应（拦截发送，不联网）")
sent = []


def fake_send(chat_id, text, reply_to=None):
    sent.append((chat_id, text))
    return True


real_send = tg.send
tg.send = fake_send
tg.TG = {"welcome_enabled": True, "allowed_chats": []}


def mk_update(members, text=None):
    msg = {"message_id": 9001, "chat": {"id": -100123, "type": "supergroup", "title": "测试群"},
           "from": {"id": 42, "first_name": "新人"}}
    if members:
        msg["new_chat_members"] = members
    if text:
        msg["text"] = text
    return {"update_id": 1, "message": msg}


sent.clear()
tg.handle_update(mk_update([{"id": 42, "first_name": "新人", "is_bot": False}]))
check("真人入群发一次欢迎", len(sent), 1)
check("发到的是当前群", sent[0][0] if sent else None, -100123)

sent.clear()
tg.handle_update(mk_update([{"id": 77, "first_name": "别家Bot", "is_bot": True}]))
check("机器人入群不理", len(sent), 0)

sent.clear()
tg.handle_update(mk_update(None, "/welcome"))
check("/welcome 手动补发", len(sent), 1)

sent.clear()
tg.TG = {"welcome_enabled": False, "allowed_chats": []}
tg.handle_update(mk_update([{"id": 42, "first_name": "新人", "is_bot": False}]))
check("welcome_enabled=false 时不发", len(sent), 0)
tg.send = real_send

print("8) 私聊投递（群里只留回执，结果走私聊；发不出就给深链）")
calls = []
BLOCKED = 777          # 这个用户从没点过 Start，私聊必 403
started = set()        # 点过 Start 的人才会被放行


def fake_api(method, params=None, timeout=None):
    p = dict(params or {})
    calls.append((method, p))
    if method != "sendMessage":
        return {"ok": True, "result": {}}
    if p.get("chat_id") == BLOCKED and BLOCKED not in started:
        return {"ok": False, "error_code": 403,
                "description": "Forbidden: bot can't initiate conversation with a user"}
    return {"ok": True, "result": {"message_id": 1}}


real_api = tg._api
real_handle = tg.handlers.handle
real_cfg = tg._load_cfg_cached
tg._api = fake_api
tg._ME = {"username": BOT, "first_name": "小艾"}
# 假 handlers：由 ITEMS 控制「几条结果」，CHUNKS 控制「拆成几条消息」，
# 用来验证群回执的条数与私发的全量行为。
STATE = {"items": 1, "chunks": ["神探狄仁杰 第一部 ｜ 电视剧\n夸克网盘\thttps://pan.quark.cn/s/abc"],
         "page": None}


def fake_handle(text, cfg, key, page=None, meta=None):
    STATE["page"] = page
    if meta is not None:
        meta.update({"cmd": "search", "items": STATE["items"], "total": STATE["items"]})
    return list(STATE["chunks"])


tg.handlers.handle = fake_handle
tg._load_cfg_cached = lambda: {}
tg.TG = {"reply_mode": "private", "allowed_chats": [], "cooldown_seconds": 0,
         "global_rate_per_minute": 0, "allow_private": True}


def mk_query(uid, text, mid):
    return {"update_id": mid, "message": {
        "message_id": mid,
        "chat": {"id": -100123, "type": "supergroup", "title": "测试群"},
        "from": {"id": uid, "username": "tester"}, "text": text}}


def to_chat(chat_id):
    return [p for m, p in calls if p.get("chat_id") == chat_id]


calls.clear()
tg.handle_update(mk_query(42, "/s 神探狄仁杰", 9201))
check("结果进了私聊", len(to_chat(42)), 1)
check("私聊内容含链接", "pan.quark.cn" in (to_chat(42)[0].get("text") or ""), True)
check("群里只有一行回执", len(to_chat(-100123)), 1)
check("群里回执不含结果", "pan.quark.cn" in (to_chat(-100123)[0].get("text") or ""), False)
receipt = to_chat(-100123)[0].get("text") or ""
check("回执带条数", "1 条结果已返回" in receipt, True)
check("「助理小艾」是超链接", '<a href="https://t.me/%s">助理小艾</a>' % BOT in receipt, True)
check("群里查询一次要全量", STATE["page"], tg.PRIVATE_PAGE_SIZE)
tg.TG = dict(tg.TG, private_max_results=0)
check("配 0 表示不限", tg._page_size("supergroup"), 0)
tg.TG = dict(tg.TG, private_max_results=8)
check("配数字就按数字给", tg._page_size("supergroup"), 8)
tg.TG = dict(tg.TG)
tg.TG.pop("private_max_results", None)

# 多条结果：私聊要全量发完，群里仍只有一行
calls.clear()
STATE["items"] = 25
STATE["chunks"] = ["第 %d 条\n夸克网盘\thttps://pan.quark.cn/s/%d" % (i, i) for i in range(1, 5)]
tg.time = type("T", (), {"sleep": staticmethod(lambda s: None), "time": staticmethod(time.time),
                         "strftime": staticmethod(time.strftime)})()
tg.handle_update(mk_query(44, "/s 神探狄仁杰", 9205))
check("4 段正文全发到私聊", len(to_chat(44)), 4)
check("群里仍只有一行", len(to_chat(-100123)), 1)
check("回执写的是结果条数不是消息数", "25 条结果已返回" in (to_chat(-100123)[0].get("text") or ""), True)

# 没命中 / 帮助：短消息留在群里，不往私聊塞
calls.clear()
STATE["items"] = 0
STATE["chunks"] = ["没找到「不存在的东西」，换个关键词试试。"]
tg.handle_update(mk_query(45, "/s 不存在的东西", 9206))
check("没命中的提示发在群里", "没找到" in (to_chat(-100123)[0].get("text") or ""), True)
check("没命中不打扰私聊", len(to_chat(45)), 0)

calls.clear()
tg.handle_update(mk_query(46, "/help", 9207))
check("/help 在群里回", "指令" in (to_chat(-100123)[0].get("text") or ""), True)
check("/help 不进私聊", len(to_chat(46)), 0)
STATE["items"] = 1
STATE["chunks"] = ["神探狄仁杰 第一部 ｜ 电视剧\n夸克网盘\thttps://pan.quark.cn/s/abc"]
tg.time = time

calls.clear()
tg.handle_update(mk_query(BLOCKED, "/s 神探狄仁杰", 9202))
check("私聊发不出时不丢消息", len(to_chat(-100123)), 1)
hint = to_chat(-100123)[0].get("text") or ""
check("回了深链", "?start=q" in hint, True)

token = (re.search(r"start=(q[0-9a-f]+)", hint) or [None, ""])[1]
started.add(BLOCKED)   # 用户点了深链，等于给机器人开了私聊
calls.clear()
tg.handle_update({"update_id": 9203, "message": {
    "message_id": 9203, "chat": {"id": BLOCKED, "type": "private"},
    "from": {"id": BLOCKED, "username": "tester"}, "text": "/start " + token}})
check("点深链后补发到私聊", len(to_chat(BLOCKED)), 1)
check("补发的内容是对的", "pan.quark.cn" in (to_chat(BLOCKED)[0].get("text") or ""), True)
check("token 用完即废", tg._stash_take(token), None)

calls.clear()
tg.TG = dict(tg.TG, reply_mode="group")
tg.handle_update(mk_query(43, "/s 神探狄仁杰", 9204))
check("group 模式照旧发群里", len(to_chat(-100123)), 1)
check("group 模式不碰私聊", len(to_chat(43)), 0)

print("9) 白名单只管群，私聊由 allow_private 控制")
calls.clear()
tg.TG = {"reply_mode": "private", "allowed_chats": [-100123], "allow_private": True,
         "cooldown_seconds": 0, "global_rate_per_minute": 0}
tg.handle_update({"update_id": 9301, "message": {
    "message_id": 9301, "chat": {"id": -100999, "type": "supergroup", "title": "别人的群"},
    "from": {"id": 55, "username": "x"}, "text": "/s 神探狄仁杰"}})
check("非白名单群不回", len(calls), 0)

calls.clear()
tg.handle_update({"update_id": 9302, "message": {
    "message_id": 9302, "chat": {"id": 55, "type": "private"},
    "from": {"id": 55, "username": "x"}, "text": "/s 神探狄仁杰"}})
check("白名单外的私聊照常响应", len(calls), 1)

calls.clear()
tg.TG = dict(tg.TG, allow_private=False)
tg.handle_update({"update_id": 9303, "message": {
    "message_id": 9303, "chat": {"id": 56, "type": "private"},
    "from": {"id": 56, "username": "y"}, "text": "/s 神探狄仁杰"}})
check("allow_private=false 时私聊不理", len(calls), 0)

tg._api = real_api
tg.handlers.handle = real_handle
tg._load_cfg_cached = real_cfg

print("10) 一次给全量（handlers 的 page 参数）")
m1 = {}
handlers.handle("/s 电影", CFG, key="page-a", meta=m1)
check("默认每批 10 条", m1.get("items"), tg.handlers.PAGE_SIZE)
check("meta 带回命中总数", (m1.get("total") or 0) >= 3, True)
m2 = {}
out2 = handlers.handle("/s 电影", CFG, key="page-b", page=10, meta=m2)
check("page=10 就给 10 条", m2.get("items"), 10)
check("条数多了自动拆多条消息", len(out2) >= 1, True)
check("拆条后首条仍是资源名", "｜" in out2[0], True)
check("尾巴只挂最后一条", "更多资源访问" in out2[-1], True)
m3 = {}
handlers.handle("/cats", CFG, key="page-c", page=10, meta=m3)
check("分类不写条数（留在群里）", m3.get("items"), None)
m4 = {}
handlers.handle("/s 青之箱", CFG, key="page-d", page=1, meta=m4)
check("page=1 只给 1 条", m4.get("items"), 1)
m5 = {}
handlers.handle("/s 青之箱", CFG, key="page-e", page=0, meta=m5)
check("page=0 给全部命中", m5.get("items"), m5.get("total"))

# 排序：命中按上架日期从新到旧，先给最新的 10 条
import site_client as sc
hits, total = sc.search(CFG["site_url"], "电影", 10, 0)
dates = [it.get("date") or "" for it in hits]
check("默认 10 条", len(hits), 10)
check("按日期从新到旧", dates, sorted(dates, reverse=True))
more, _ = sc.search(CFG["site_url"], "电影", 10, 10)
check("翻页接在后面", (more[0].get("date") or "") <= dates[-1], True)

print("\n结果：%d 通过，%d 失败" % (ok, bad))
sys.exit(1 if bad else 0)
