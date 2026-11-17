#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wodewangpan 群机器人 · Telegram 端入口（Bot API 长轮询，零依赖）。

数据流：
  TG 群 /s 关键词 -> Telegram Bot API getUpdates -> 查线上站点 -> sendMessage 回群

目录定位（2026-11-12 按平台拆分后）：
  app/core/       平台无关共享层（handlers / site_client / config / runtime）
  app/telegram/   本目录：bot.py 入口 + render.py 富文本渲染
  以后新增平台照此模式加 app/<platform>/ 目录，共享层不动。

运行方式：独立进程
  python app/telegram/bot.py

约束：
  - 只用标准库。直连 api.telegram.org；需要代理时配 telegram.proxy。
  - 只读线上站点，不读本地仓库。
  - 群消息一律视为不可信输入，只认白名单指令。
"""

import os
import re
import sys
import json
import time
import uuid
import threading
import traceback
import urllib.request
import urllib.error

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # bot/app/
ROOT = os.path.dirname(APP_DIR)                                          # bot/
sys.path.insert(0, APP_DIR)

from core import handlers                        # noqa: E402
from core import feedback                        # noqa: E402
from telegram import render as tg_render         # noqa: E402
from core.config import load_raw, section_view   # noqa: E402
from core.runtime import Logger, RateControl     # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LOG_DIR = os.path.join(ROOT, "logs")
STATE_FILE = os.path.join(LOG_DIR, "tg-state.json")
LOCK_FILE = os.path.join(LOG_DIR, "tg.lock")
PID_FILE = os.path.join(LOG_DIR, "tg.pid")

log = Logger(LOG_DIR, time.strftime("tg-%Y-%m-%d.log"), tag="[TG]")

MAX_TG_LEN = 3900        # Telegram 上限 4096，留出 HTML 标签的余量
PRIVATE_PAGE_SIZE = 10   # 私发一次最多给几条；私聊不刷屏，给一批比群里多（config 可改，0=不限）

TG = {}                  # config.json 的 telegram 段
_OPEN = urllib.request.build_opener()
_ME = {}
rate = RateControl()
_STASH = {}              # 深链补发用：token -> (uid, chunks, 时间)
_STASH_TTL = 1800        # 备好的结果留 30 分钟，过期作废
_FB_STASH = {}           # 一键反馈按钮：token -> (关键词, chat_id, uid, 时间)
_FB_TTL = 1800           # 按钮 30 分钟内有效，过期提示重新搜索
FB_BTN_TEXT = "反馈资源问题"
# 搜索无结果时的提示：给一键反馈按钮（一点即送达）
TG_FEEDBACK_HINT = "搜不到？点下方按钮反馈资源无效 / 资源错误"

TG_HELP = (
    "我的网盘索引站 · 指令\n"
    "\n"
    "/s 关键词   查资源，回网盘链接\n"
    "/more       接着看下一批结果\n"
    "/latest     最近上架的资源\n"
    "/today      今天更新的资源\n"
    "/cats       各分类有多少资源\n"
    "/random     随便抽一个\n"
    "/id         看当前会话的信息\n"
    "/welcome    把入群欢迎语再发一遍\n"
    "/f 内容     反馈失效资源给管理员（/失效 /无 /无效 /错误 同，需 @我）\n"
    "/help /帮助 再看一次这份说明\n"
    "\n"
    "群里直接发 /s 关键词 就行，不用 @ 我。\n"
    "@我 之后只发关键词也能搜。\n"
    "搜不到时点消息下方的「反馈资源问题」按钮，一键反馈。"
)

# Telegram 命令名只能是拉丁字符，这里把拉丁命令映射成 handlers 认识的中文指令
CMD_MAP = {
    "start": "/help", "help": "/help",
    "s": "/s", "search": "/s", "so": "/s",
    "more": "/more", "next": "/more",
    "latest": "/latest", "new": "/latest",
    "today": "/today",
    "cats": "/cats", "category": "/cats", "categories": "/cats",
    "random": "/random",
}

def _tg_tail():
    """TG 群尾部：资源列表后空一行，再挂订阅频道与 /help 提示。

    订阅地址取 config.json 的 telegram.subscribe_url，没配就用 @myquark。
    """
    url = (TG.get("subscribe_url") or "https://t.me/myquark").rstrip("/")
    return ["", "更多资源订阅：" + url, handlers.TAIL_HELP]


# 入群欢迎语：正文放在 welcome-tg.txt，改文案不用动代码，也不用重启（按文件修改时间热加载）
WELCOME_FILE = os.path.join(ROOT, "welcome-tg.txt")
_WELCOME_FALLBACK = (
    "欢迎。发 /s 关键词 查资源，例如 /s 神探狄仁杰。\n"
    "发 /help 看全部指令。"
)
_welcome_cache = {"text": "", "mtime": 0.0}


def welcome_text():
    try:
        mtime = os.path.getmtime(WELCOME_FILE)
        if mtime != _welcome_cache["mtime"]:
            with open(WELCOME_FILE, "r", encoding="utf-8") as f:
                _welcome_cache["text"] = f.read().strip()
            _welcome_cache["mtime"] = mtime
    except Exception:
        pass
    return _welcome_cache["text"] or _WELCOME_FALLBACK


# ---------- 单实例 ----------

_lock_handle = None      # 持有锁的文件对象，进程活着就一直拿着


def _acquire_single_instance():
    """同一个 token 只能有一个进程在 getUpdates：两个实例会互相抢消息，各收一半。

    用文件排他锁而不是 pid 文件：进程被 kill / 崩溃时系统自动释放，不会留下死锁。
    返回 True 表示拿到锁（或本来就在本进程里已拿到）。
    """
    global _lock_handle
    if _lock_handle is not None:
        return True
    try:
        f = open(LOCK_FILE, "a+")
    except Exception as e:
        log("× 建不了锁文件 %s（%s），继续运行" % (LOCK_FILE, e))
        return True
    try:
        f.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        f.close()
        return False
    try:
        f.seek(0)
        f.truncate()
    except Exception:
        pass
    # pid 另存一份：锁文件被独占锁住后别的进程连读都读不了，排查时看这个
    try:
        with open(PID_FILE, "w", encoding="utf-8") as pf:
            pf.write(str(os.getpid()))
    except Exception:
        pass
    _lock_handle = f
    return True


# ---------- 配置与网络 ----------

def _load_config():
    return load_raw(ROOT)


def _setup(cfg):
    """读 telegram 段、建带代理的 opener。返回是否应该启动。

    cfg 是整份原始配置；TG 段与 handlers 用的平铺视图在这里一并备好。
    """
    global TG, _OPEN, _CFG_VIEW
    TG = cfg.get("telegram") or {}
    _CFG_VIEW = section_view(cfg, "telegram")
    proxy = (TG.get("proxy") or os.environ.get("TG_PROXY") or "").strip()
    if proxy:
        _OPEN = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    else:
        _OPEN = urllib.request.build_opener()
    if not TG.get("enabled", True):
        return False
    return bool((TG.get("token") or "").strip())


def _api(method, params=None, timeout=40):
    """调 Telegram Bot API。返回解析后的 JSON；网络层失败返回 None。"""
    token = (TG.get("token") or "").strip()
    if not token:
        return None
    url = "https://api.telegram.org/bot%s/%s" % (token, method)
    body = json.dumps(params or {}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with _OPEN.open(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "ignore")
        return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8", "ignore"))
            return {"ok": False, "error_code": e.code,
                    "description": detail.get("description") or ("HTTP %s" % e.code)}
        except Exception:
            return {"ok": False, "error_code": e.code, "description": "HTTP %s" % e.code}
    except Exception as e:
        log("× %s 连不上：%s: %s（代理是否可用？）" % (method, e.__class__.__name__, str(e)[:80]))
        return None


# ---------- 发送 ----------

def _send_raw(chat_id, text, reply_to=None, reply_markup=None):
    """发一条，返回 (是否成功, 原始响应)。优先 HTML，被拒（400）退回纯文本。
    私发全量时容易撞上 429，按 Telegram 给的 retry_after 等一次再重试。
    reply_markup 挂行内按钮（搜索无结果时的一键反馈）。"""
    body = (text or "")[:MAX_TG_LEN]
    html = tg_render.to_html(body)
    if len(html) > 4090:
        html = html[:4080]
    params = {
        "chat_id": chat_id,
        "text": html,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_to:
        params["reply_to_message_id"] = reply_to
        params["allow_sending_without_reply"] = True
    if reply_markup:
        params["reply_markup"] = reply_markup

    res = _api("sendMessage", params)
    if res and res.get("error_code") == 429:
        wait = int(((res.get("parameters") or {}).get("retry_after")) or 3)
        wait = max(1, min(wait, 30))
        log("· 触发限频，等 %ds 重试（chat %s）" % (wait, chat_id))
        time.sleep(wait)
        res = _api("sendMessage", params)
    if res and res.get("ok"):
        return True, res
    if res and res.get("error_code") == 400:
        log("· HTML 被拒（%s），改发纯文本" % (res.get("description") or "")[:60])
        params.pop("parse_mode", None)
        params["text"] = tg_render.to_plain(body)
        res = _api("sendMessage", params)
        return bool(res and res.get("ok")), res
    return False, res


def send(chat_id, text, reply_to=None, reply_markup=None):
    """优先发 HTML（网盘名可点），被拒就退回纯文本，绝不让用户收不到。"""
    ok, _ = _send_raw(chat_id, text, reply_to, reply_markup)
    return ok


# ---------- 私聊投递 ----------
#
# 群里只回一行回执，结果发到私聊，几十人同时查也不刷屏。
# 但 TG 有一条硬规则：机器人不能主动私聊从没点过 Start 的人，
# 此时 sendMessage 返回 403 not enough rights / bot can't initiate conversation。
# 兜底做法是回一条 t.me/<bot>?start=<token> 深链，用户点一下进私聊，
# 机器人从 /start 的参数里认出这是谁，把当时备好的结果补发过去。

def _private_mode():
    return (TG.get("reply_mode") or "group").lower() == "private"


def _stash_put(uid, chunks):
    """把结果暂存起来，返回深链 token。"""
    now = time.time()
    for k in [k for k, v in _STASH.items() if now - v[2] > _STASH_TTL]:
        _STASH.pop(k, None)
    token = "q" + uuid.uuid4().hex[:12]
    _STASH[token] = (uid, list(chunks), now)
    return token


def _stash_take(token):
    v = _STASH.pop(token, None)
    if not v or time.time() - v[2] > _STASH_TTL:
        return None
    return v[0], v[1]


def _dm(uid, chunks):
    """往私聊发，返回成功发出的条数。"""
    n = 0
    for chunk in chunks:
        ok, res = _send_raw(uid, chunk)
        if not ok:
            log("× 私发失败（uid %s）：%s" % (uid, ((res or {}).get("description") or "")[:60]))
            break
        n += 1
        if len(chunks) > 1:
            time.sleep(0.6)
    return n


def _page_size(ctype):
    """一次给几条：私聊投递（群里查、结果进私聊）不刷屏，一次给一大批；群里照旧一批 3 条。"""
    if ctype == "private" or _private_mode():
        v = TG.get("private_max_results")
        if v is None:
            return PRIVATE_PAGE_SIZE
        return int(v)          # 0 = 不限，全量发
    return None                # 交给 handlers 用默认的 PAGE_SIZE


def _bot_label():
    """回执里显示给用户看的名字，默认「助理 + 机器人 first_name」（现在是「助理小艾」）。
    改名或想换称呼，在 config 的 telegram.display_name 里写死即可。"""
    fixed = (TG.get("display_name") or "").strip()
    if fixed:
        return fixed
    name = (_ME.get("first_name") or "").strip()
    if not name:
        return "机器人"
    return name if name.startswith("助理") else "助理" + name


def _receipt(chat_id, uid, chunks, reply_to, items):
    """群里只留一行回执，结果全部发到私聊。
    先发第一条探路：私聊没开通就直接回深链，开了就把剩下的一次性发完。"""
    bot = _ME.get("username") or ""
    link = "https://t.me/%s" % bot
    label = _bot_label()
    ok, res = _send_raw(uid, chunks[0])
    if not ok:
        log("× 私发第一条失败（uid %s）：%s" % (uid, ((res or {}).get("description") or "")[:60]))
        token = _stash_put(uid, chunks)
        send(chat_id,
             "%d 条结果已备好，请点开[%s](%s?start=%s)开通私聊，我马上发给你。"
             % (items, label, link, token),
             reply_to=reply_to)
        return

    # 回执在发正文前就贴出来：结果多的时候群里不用干等
    send(chat_id, "%d 条结果已返回，请点击 [%s](%s) 查看。" % (items, label, link),
         reply_to=reply_to)

    rest = chunks[1:]
    if rest:
        done = _dm(uid, rest)
        if done < len(rest):
            log("× 私发中断：%d/%d 条已发（uid %s）" % (done + 1, len(chunks), uid))


def _deliver(chat_id, uid, ctype, chunks, reply_to, meta=None):
    """群里的资源查询走私聊投递，发不出去就回深链；
    帮助、分类、报错这类短消息（meta 里没有条数）照旧发在群里。"""
    items = int((meta or {}).get("items") or 0)
    if ctype in ("group", "supergroup") and _private_mode() and items and chunks:
        _receipt(chat_id, uid, chunks, reply_to, items)
        return

    kw = (meta or {}).get("feedback_kw")
    markup = _feedback_markup(kw, chat_id, uid) if kw else None
    for i, chunk in enumerate(chunks):
        # 无结果时第一条消息挂「反馈资源问题」按钮；拆条的后续条不重复挂
        ok = send(chat_id, chunk, reply_to=reply_to if i == 0 else None,
                  reply_markup=markup if i == 0 else None)
        if not ok:
            log("× 发送失败（第 %d/%d 条）" % (i + 1, len(chunks)))
            break
        if len(chunks) > 1:
            time.sleep(0.8)   # 单群约 20 条/分钟，留点间隔


# ---------- 解析 ----------

def _text_of(m):
    return (m.get("text") or m.get("caption") or "").strip()


def _mentioned(m, username):
    """是否 @ 了机器人。entities 优先，另外兜底按 @username 文本判断。"""
    if not username:
        return False
    target = ("@" + username).lower()
    txt = _text_of(m)
    for e in list(m.get("entities") or []) + list(m.get("caption_entities") or []):
        etype = e.get("type")
        if etype == "mention":
            off, ln = int(e.get("offset") or 0), int(e.get("length") or 0)
            if txt[off:off + ln].lower() == target:
                return True
        elif etype == "text_mention":
            u = e.get("user") or {}
            if (u.get("username") or "").lower() == username.lower():
                return True
    return target in txt.lower()


def normalize(text, username=""):
    """去掉 /cmd@botname 里的 @botname，剥掉 @提及，压掉多余空白。"""
    t = (text or "").strip()
    if t.startswith("/") or t.startswith("／"):
        head, sep, rest = t.partition(" ")
        if "@" in head:
            head = head.split("@")[0]
        t = head + (sep + rest if sep else "")
    if username:
        t = t.replace("@" + username, " ")
        t = t.replace("@" + username.lower(), " ")
    t = re.sub(r"\s+", " ", t).strip()
    # 中文全角斜杠统一成半角，交给 handlers 识别
    if t[:1] in ("／",):
        t = "/" + t[1:]
    return t


def _canonical(text):
    """把拉丁命令换成 handlers 认识的中文指令；没映射的原样返回。"""
    t = text.strip()
    if not t.startswith("/"):
        return t
    head, sep, rest = t[1:].partition(" ")
    key = head.lower().strip()
    if key in CMD_MAP:
        return CMD_MAP[key] + ((" " + rest) if rest else "")
    return t


# ---------- 搜索无结果时的一键反馈按钮 ----------
# callback_data 上限 64 字节，中文关键词放不下，所以只带一个短 token；
# 关键词与会话信息留在进程内存里，按钮 30 分钟过期，重启后旧按钮会提示重新搜索。

def _fb_put(kw, chat_id, uid):
    now = time.time()
    for k in [k for k, v in _FB_STASH.items() if now - v[3] > _FB_TTL]:
        _FB_STASH.pop(k, None)
    token = uuid.uuid4().hex[:12]
    _FB_STASH[token] = (kw, chat_id, uid, now)
    return token


def _fb_take(token):
    v = _FB_STASH.pop(token, None)
    if not v or time.time() - v[3] > _FB_TTL:
        return None
    return v[:3]


def _feedback_markup(kw, chat_id, uid):
    token = _fb_put(kw, chat_id, uid)
    return {"inline_keyboard": [[{"text": FB_BTN_TEXT, "callback_data": "fb:" + token}]]}


def _spawn(target, *args):
    """后台跑：飞书推送可能耗时几秒，别让它卡住 getUpdates 轮询。"""
    threading.Thread(target=target, args=args, daemon=True).start()


def _safe_callback(cb):
    try:
        _handle_callback(cb)
    except Exception:
        log("× 处理反馈按钮异常\n" + traceback.format_exc())


def _handle_callback(cb):
    """点一下按钮就把「资源无效 / 资源错误 + 搜索关键词」推给管理员，零输入。"""
    cid = cb.get("id") or ""
    data = cb.get("data") or ""
    chat_id = ((cb.get("message") or {}).get("chat") or {}).get("id")
    uid = (cb.get("from") or {}).get("id")
    if not data.startswith("fb:"):
        _api("answerCallbackQuery", {"callback_query_id": cid})
        return
    got = _fb_take(data[3:])
    if not got:
        _api("answerCallbackQuery", {"callback_query_id": cid,
                                     "text": "按钮已过期，请重新搜索或发 /f 反馈"})
        return
    kw, saved_chat, saved_uid = got
    if chat_id is not None and str(chat_id) != str(saved_chat):
        _api("answerCallbackQuery", {"callback_query_id": cid, "text": "这个按钮不是本会话的"})
        return
    ok = feedback.send_no_result_feedback(
        kw, source="telegram", key="tg:%s:%s" % (chat_id, uid or saved_uid))
    _api("answerCallbackQuery", {"callback_query_id": cid,
                                 "text": "已反馈给管理员，谢谢" if ok else "反馈没发出去，请稍后再试"})
    if ok and chat_id is not None:
        send(chat_id, handlers.FEEDBACK_REPLY)


# ---------- 单条更新 ----------

def handle_update(update):
    cb = update.get("callback_query")
    if cb:
        _spawn(_safe_callback, cb)
        return
    msg = update.get("message")
    if not msg:
        return
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    ctype = chat.get("type") or ""
    user = msg.get("from") or {}
    uid = user.get("id")
    name = user.get("username") or user.get("first_name") or str(uid)

    if not chat_id:
        return

    # 白名单管的是群和频道；私聊单独由 allow_private 控制。
    # 不然群成员点深链进私聊时，他的 user_id 不在白名单就会被丢掉，深链也就白给了。
    wl = [str(x) for x in (TG.get("allowed_chats") or [])]
    if ctype == "private":
        if not TG.get("allow_private", True):
            log("· 私聊已关闭（allow_private=false），忽略 %s" % (uid,))
            return
    elif wl and str(chat_id) not in wl:
        log("· 跳过非白名单会话 %s（%s）" % (chat_id, chat.get("title") or ctype))
        return

    # 新成员入群：发一遍欢迎语（里面就是指令表）。只对真人触发，别家机器人入群不理。
    joined = [m for m in (msg.get("new_chat_members") or []) if not m.get("is_bot")]
    if joined:
        if not TG.get("welcome_enabled", True):
            return
        if rate.dup("%s:join:%s" % (chat_id, msg.get("message_id"))):
            return
        who = "、".join(m.get("username") or m.get("first_name") or str(m.get("id")) for m in joined)
        log("· %s 有新成员入群（%s），发欢迎语" % (chat_id, who))
        send(chat_id, welcome_text(), reply_to=msg.get("message_id"))
        return

    text_raw = _text_of(msg)
    if not text_raw:
        return
    if user.get("is_bot"):
        return

    username = _ME.get("username") or ""
    at_me = _mentioned(msg, username)
    text = normalize(text_raw, username)

    if ctype in ("group", "supergroup"):
        # 隐私模式默认只推 /命令、@我、回复我三种。纯闲聊不要进来乱回。
        if not (text.startswith("/") or at_me):
            if not TG.get("reply_to_any_text"):
                return
    elif ctype == "private":
        if not TG.get("allow_private", True):
            return
    elif ctype == "channel":
        return

    if not text:
        text = "/help"

    if rate.dup("%s:%s" % (chat_id, msg.get("message_id"))):
        return

    # 本地指令，不走站点
    low = text.lower()
    if ctype == "private" and low.startswith("/start ") and _STASH:
        got = _stash_take(text[7:].strip())
        if got:
            log("→ 深链补发 %d 条给 uid %s" % (len(got[1]), got[0]))
            _dm(got[0], got[1])
            return
    if low in ("/id", "/chatid"):
        send(chat_id,
             "会话 type：%s\nchat_id：%s\n你的 user_id：%s\n\n"
             "把这个 chat_id 填进 config.json 的 telegram.allowed_chats 即可只在这个群响应。"
             % (ctype, chat_id, uid), reply_to=msg.get("message_id"))
        return
    if low in ("/help", "/start", "/帮助"):
        send(chat_id, TG_HELP, reply_to=msg.get("message_id"))
        return
    if low in ("/welcome", "/公告"):
        # 手动贴一遍欢迎语，方便随时重新置顶
        send(chat_id, welcome_text(), reply_to=msg.get("message_id"))
        return

    # 私聊投递时翻页状态跟着人走：群里的 /more 和私聊里的 /more 接着的是同一批结果
    if _private_mode() and ctype in ("group", "supergroup"):
        key = "tg:u:%s" % uid
    else:
        key = "tg:%s:%s" % (chat_id, uid)
    if rate.too_fast(key, TG.get("cooldown_seconds")):
        log("· 限频忽略 %s「%s」" % (key, text[:20]))
        return
    if rate.over_rate(TG.get("global_rate_per_minute")):
        log("· 触发全局频率上限，丢弃本条")
        return

    log("→ [%s %s] %s：%s" % (ctype, chat_id, name, text[:60]))
    meta = {}
    replies = handlers.handle(_canonical(text), _load_cfg_cached(), key,
                              page=_page_size(ctype), meta=meta,
                              tail=_tg_tail(), platform="telegram",
                              feedback_hint=TG_FEEDBACK_HINT)
    if replies:
        _deliver(chat_id, uid, ctype, replies, msg.get("message_id"), meta)


_CFG_VIEW = {}


def _load_cfg_cached():
    """handlers 只认平铺视图（site_url 在顶层）：common + telegram 合并后的那份。"""
    return _CFG_VIEW or section_view(_load_config(), "telegram")


# ---------- offset 持久化 ----------

def _load_offset():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return int(json.load(f).get("offset") or 0)
    except Exception:
        return 0


def _save_offset(offset):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"offset": offset, "ts": time.strftime("%Y-%m-%d %H:%M:%S")}, f)
    except Exception:
        pass


# ---------- 主循环 ----------

def run_forever(cfg=None, stop_event=None):
    global _ME
    if cfg is None:
        cfg = _load_config()
    if not _setup(cfg):
        log("· 未启用或未配 token，停止")
        return

    if not _acquire_single_instance():
        log("· 已经有另一个 Telegram 进程在跑了，本进程退出（不退出会互相抢消息，各收一半）")
        log("  想换进程：先用「结束TG机器人」停掉旧的，再启动新的。")
        return

    me = _api("getMe", timeout=20)
    if me is None:
        log("× 拿不到机器人信息，网络不通（国内需配 telegram.proxy，或放到海外 VPS）")
        return
    if not me.get("ok"):
        log("× token 无效：%s" % (me.get("description") or ""))
        return
    _ME = me.get("result") or {}

    chats = TG.get("allowed_chats") or []
    log("=" * 52)
    log("Telegram 机器人启动：@%s（id %s）" % (_ME.get("username"), _ME.get("id")))
    log("站点：%s" % (_CFG_VIEW.get("site_url") or ""))
    log("群白名单：%s" % (chats if chats else "未设置（任何群都响应，建议用 /id 取回后回填）"))
    log("代理：%s" % (TG.get("proxy") or "未设置（直连）"))
    log("进程：pid %d（独立进程守着 %s）" % (os.getpid(), os.path.basename(LOCK_FILE)))
    log("=" * 52)

    offset = _load_offset()
    poll = int(TG.get("poll_timeout") or 25)
    backoff = 3
    while True:
        if stop_event is not None and stop_event.is_set():
            log("· 收到停止信号，退出轮询")
            return
        res = _api("getUpdates",
                   {"offset": offset, "timeout": poll,
                    "allowed_updates": ["message", "callback_query"]},
                   timeout=poll + 20)
        if res is None:
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        if not res.get("ok"):
            log("× getUpdates 失败：%s" % (res.get("description") or ""))
            if res.get("error_code") == 409:
                log("· 409 说明同一个 token 还有另一个实例在跑，先把旧的停掉")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        backoff = 3
        ups = res.get("result") or []
        for u in ups:
            offset = max(offset, int(u.get("update_id") or 0) + 1)
            try:
                handle_update(u)
            except Exception:
                log("× 处理更新异常\n" + traceback.format_exc())
        if ups:
            _save_offset(offset)


def _safe_run(cfg, stop_event):
    try:
        run_forever(cfg, stop_event)
    except Exception:
        log("× 轮询线程异常退出\n" + traceback.format_exc())


def start(cfg, stop_event=None):
    """起一个后台轮询线程（embedded 模式预留）。cfg 是整份原始配置。"""
    try:
        if not _setup(cfg):
            log("· 未配置 telegram.token，不启动 Telegram 适配器")
            return None
    except Exception:
        log("× 读取 telegram 配置失败\n" + traceback.format_exc())
        return None
    t = threading.Thread(target=_safe_run, args=(cfg, stop_event), name="telegram", daemon=True)
    t.start()
    return t


def main():
    stop = threading.Event()
    try:
        run_forever(stop_event=stop)
    except KeyboardInterrupt:
        stop.set()
        log("收到中断，退出")


if __name__ == "__main__":
    main()
