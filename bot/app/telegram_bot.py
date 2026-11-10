#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wodewangpan 群机器人 · Telegram Bot API 接入（长轮询，零依赖）。

数据流：
  TG 群 /s 关键词 -> Telegram Bot API getUpdates -> 查线上站点 -> sendMessage 回群

两种跑法，同一份代码：
  1) 挂在 QQ 机器人进程里：bot.py 启动时调 start(CFG)，起一个后台线程；
     桌面上的启动/重启/结束 QQ 机器人脚本会一并管理它。
  2) 单独跑（放海外 VPS 时用）：python app/telegram_bot.py

约束：
  - 只用标准库。国内直连 api.telegram.org 不通，要么给 telegram.proxy 配代理，
    要么直接跑在海外 VPS 上（代码不用改）。
  - 只读线上站点，不读本地仓库。
  - 群消息一律视为不可信输入，只认白名单指令。
"""

import os
import re
import sys
import json
import time
import threading
import traceback
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
sys.path.insert(0, BASE)

import handlers      # noqa: E402
import tg_render     # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LOG_DIR = os.path.join(ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, time.strftime("tg-%Y-%m-%d.log"))
STATE_FILE = os.path.join(LOG_DIR, "tg-state.json")

TAG = "[TG]"
MAX_TG_LEN = 3900        # Telegram 上限 4096，留出 HTML 标签的余量

_log_lock = threading.Lock()

TG = {}                  # telegram 段配置
_OPEN = urllib.request.build_opener()
_ME = {}
_seen = {}
_cd = {}
_rate = []
_rate_lock = threading.Lock()

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
    "/help       再看一次这份说明\n"
    "\n"
    "群里直接发 /s 关键词 就行，不用 @ 我。\n"
    "@我 之后只发关键词也能搜。"
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



def log(msg):
    line = "%s [%s] %s" % (TAG, time.strftime("%H:%M:%S"), msg)
    with _log_lock:
        try:
            print(line, flush=True)
        except Exception:
            pass
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


# ---------- 配置与网络 ----------

def _load_config():
    with open(os.path.join(ROOT, "config.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def _setup(cfg):
    """读 telegram 段、建带代理的 opener。返回是否应该启动。"""
    global TG, _OPEN
    TG = cfg.get("telegram") or {}
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


# ---------- 限频 ----------

def _too_fast(key):
    cd = int(TG.get("cooldown_seconds") or 0)
    if cd <= 0:
        return False
    now = time.time()
    if now - _cd.get(key, 0) < cd:
        return True
    _cd[key] = now
    return False


def _over_rate():
    limit = int(TG.get("global_rate_per_minute") or 0)
    if limit <= 0:
        return False
    now = time.time()
    with _rate_lock:
        while _rate and now - _rate[0] > 60:
            _rate.pop(0)
        if len(_rate) >= limit:
            return True
        _rate.append(now)
    return False


def _dup(mid):
    if not mid:
        return False
    now = time.time()
    if mid in _seen:
        return True
    _seen[mid] = now
    for k in [k for k, v in list(_seen.items()) if now - v > 600]:
        _seen.pop(k, None)
    return False


# ---------- 发送 ----------

def send(chat_id, text, reply_to=None):
    """优先发 HTML（网盘名可点），被拒就退回纯文本，绝不让用户收不到。"""
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

    res = _api("sendMessage", params)
    if res and res.get("ok"):
        return True
    if res and res.get("error_code") == 400:
        log("· HTML 被拒（%s），改发纯文本" % (res.get("description") or "")[:60])
        params.pop("parse_mode", None)
        params["text"] = tg_render.to_plain(body)
        res = _api("sendMessage", params)
        return bool(res and res.get("ok"))
    return False


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


# ---------- 单条更新 ----------

def handle_update(update):
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

    wl = [str(x) for x in (TG.get("allowed_chats") or [])]
    if wl and str(chat_id) not in wl:
        log("· 跳过非白名单会话 %s（%s）" % (chat_id, chat.get("title") or ctype))
        return

    # 新成员入群：发一遍欢迎语（里面就是指令表）。只对真人触发，别家机器人入群不理。
    joined = [m for m in (msg.get("new_chat_members") or []) if not m.get("is_bot")]
    if joined:
        if not TG.get("welcome_enabled", True):
            return
        if _dup("%s:join:%s" % (chat_id, msg.get("message_id"))):
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

    if _dup("%s:%s" % (chat_id, msg.get("message_id"))):
        return

    # 本地指令，不走站点
    low = text.lower()
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

    key = "tg:%s:%s" % (chat_id, uid)
    if _too_fast(key):
        log("· 限频忽略 %s「%s」" % (key, text[:20]))
        return
    if _over_rate():
        log("· 触发全局频率上限，丢弃本条")
        return

    log("→ [%s %s] %s：%s" % (ctype, chat_id, name, text[:60]))
    replies = handlers.handle(_canonical(text), _load_cfg_cached(), key)
    for i, chunk in enumerate(replies):
        ok = send(chat_id, chunk, reply_to=msg.get("message_id") if i == 0 else None)
        if not ok:
            log("× 发送失败（第 %d/%d 条）" % (i + 1, len(replies)))
            break
        if len(replies) > 1:
            time.sleep(0.8)   # 单群约 20 条/分钟，留点间隔


_CFG = {}


def _load_cfg_cached():
    return _CFG or _load_config()


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
    global _ME, _CFG
    if cfg is None:
        cfg = _load_config()
    if not _setup(cfg):
        log("· 未启用或未配 token，停止")
        return
    _CFG = cfg

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
    log("站点：%s" % cfg.get("site_url"))
    log("群白名单：%s" % (chats if chats else "未设置（任何群都响应，建议用 /id 取回后回填）"))
    log("代理：%s" % (TG.get("proxy") or "未设置（直连）"))
    log("=" * 52)

    offset = _load_offset()
    poll = int(TG.get("poll_timeout") or 25)
    backoff = 3
    while True:
        if stop_event is not None and stop_event.is_set():
            log("· 收到停止信号，退出轮询")
            return
        res = _api("getUpdates",
                   {"offset": offset, "timeout": poll, "allowed_updates": ["message"]},
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
    """给 bot.py 用：起一个后台线程，失败不影响 QQ 那边。"""
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
