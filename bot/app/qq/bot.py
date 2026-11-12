#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wodewangpan 群机器人 · QQ 端入口（OneBot v11 HTTP 接入）。

数据流：
  QQ 群 @机器人 -> NapCat -> HTTP 上报到本服务(:6700) -> 查线上站点 -> 调 NapCat HTTP API 回群

目录定位（2026-11-12 按平台拆分后）：
  app/core/      平台无关共享层（handlers / site_client / config / runtime）
  app/qq/        本文件，QQ 端适配层
  app/telegram/  TG 端适配层，独立进程跑；想内嵌进本进程见 main() 里的 telegram.embedded
  以后新增平台照此模式加 app/<platform>/ 目录，共享层不动。

设计约束：
  - 只用 Python 标准库，Windows 上拷过去就能跑，不需要 pip install。
  - 只读取线上站点，不读取本地资源仓库。
  - 群消息一律视为不可信输入，只认白名单指令。
"""

import os
import sys
import json
import time
import threading
import traceback
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # bot/app/
ROOT = os.path.dirname(APP_DIR)                                          # bot/
sys.path.insert(0, APP_DIR)

from core import handlers                        # noqa: E402
from core import site_client as sc               # noqa: E402
from core.config import load_raw, section_view   # noqa: E402
from core.runtime import Logger, RateControl     # noqa: E402
from qq import render as qq_render               # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LOG_DIR = os.path.join(ROOT, "logs")
log = Logger(LOG_DIR, time.strftime("bot-%Y-%m-%d.log"))

RAW = load_raw(ROOT)          # 整份三段式配置
CFG = section_view(RAW, "qq")  # common + qq 合并的平铺视图（handlers 只认这个）

# QQ 群尾部：站点地址 + /help 提示（TG 那边换成订阅频道，由 telegram/bot.py 自己给）
QQ_TAIL = ["更多资源访问：" + CFG["site_url"], handlers.TAIL_HELP]
# 搜索无结果时的反馈入口：QQ 没有原生按钮，给一行可直接发/复制的指令。
# {kw} 由 handlers 用用户刚才搜的关键词填充。
QQ_FEEDBACK_HINT = "反馈资源无效 / 资源错误：发 /f {kw}（或 /无效 /错误）"

rate = RateControl()


def _api(action, params):
    """调用 NapCat 的 OneBot HTTP API。只连本地地址。"""
    url = CFG["napcat_api"].rstrip("/") + "/" + action
    body = json.dumps(params, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    token = CFG.get("access_token") or ""
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8", "ignore")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        log(f"× NapCat API {action} HTTP {e.code}")
    except urllib.error.URLError as e:
        log(f"× NapCat API {action} 连不上：{e.reason}（NapCat 是否已启动、端口是否对）")
    except Exception as e:
        log(f"× NapCat API {action} 失败：{e.__class__.__name__}: {e}")
    return None


def _segments(event):
    msg = event.get("message")
    if isinstance(msg, list):
        return msg
    return None


def extract(event):
    """返回 (是否 @ 了机器人, 去掉 @ 后的纯文本)。兼容 array / string 两种上报格式。"""
    self_id = str(event.get("self_id") or "")
    segs = _segments(event)
    if segs is not None:
        at_me = False
        parts = []
        for s in segs:
            t = s.get("type")
            d = s.get("data") or {}
            if t == "at":
                if str(d.get("qq")) == self_id:
                    at_me = True
            elif t == "text":
                parts.append(d.get("text") or "")
        return at_me, "".join(parts).strip()

    raw = event.get("raw_message") or ""
    at_me = f"[CQ:at,qq={self_id}]" in raw
    text = raw.replace(f"[CQ:at,qq={self_id}]", "").strip()
    return at_me, text


def process(event):
    if event.get("post_type") != "message":
        return
    if event.get("self_id") and str(event.get("user_id")) == str(event.get("self_id")):
        return

    mtype = event.get("message_type")
    group_id = event.get("group_id")
    user_id = event.get("user_id")
    nickname = event.get("sender", {}).get("card") or event.get("sender", {}).get("nickname") or user_id

    if rate.dup(event.get("message_id")):
        return

    if mtype == "group":
        wl = CFG.get("group_whitelist") or []
        if wl and str(group_id) not in [str(x) for x in wl]:
            log(f"· 跳过非白名单群 {group_id}")
            return
        at_me, text = extract(event)
        if not at_me:
            # 允许「不带 @ 的斜杠指令」：群里直接发 /搜索 xxx、/s xxx、/帮助 都能用。
            # 只认斜杠开头的，普通聊天不会被当成搜索，避免刷屏和风控。
            if CFG.get("group_no_at_slash", True) and text.strip()[:1] in ("/", "／"):
                at_me = True
                log(f"· 无 @ 的斜杠指令，放行")
            else:
                return
    elif mtype == "private":
        if not CFG.get("allow_private"):
            return
        _, text = extract(event)
    else:
        return

    if not text:
        text = "/帮助"

    key = f"{mtype}:{group_id or ''}:{user_id}"
    if rate.too_fast(key, CFG.get("cooldown_seconds")):
        log(f"· 限频忽略 {key} 「{text[:20]}」")
        return
    if rate.over_rate(CFG.get("global_rate_per_minute")):
        log("· 触发全局频率上限，丢弃本条")
        return

    log(f"→ [{mtype}:{group_id or ''}] {nickname}：{text[:60]}")
    replies = handlers.handle(text, CFG, key, tail=QQ_TAIL, platform="qq",
                              feedback_hint=QQ_FEEDBACK_HINT)
    log(f"← 准备回复 {len(replies)} 条")

    for i, chunk in enumerate(replies):
        chunk = qq_render.to_plain(chunk)   # [网盘名](URL) -> 裸 URL，QQ 客户端自动识别
        if mtype == "group":
            message = chunk
            if CFG.get("reply_at_sender") and i == 0:
                message = [{"type": "at", "data": {"qq": str(user_id)}},
                           {"type": "text", "data": {"text": "\n" + chunk}}]
            _api("send_group_msg", {"group_id": group_id, "message": message})
        else:
            _api("send_private_msg", {"user_id": user_id, "message": chunk})
        if len(replies) > 1:
            time.sleep(0.6)   # 拆条时留间隔，避免被风控判定刷屏


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass   # 关掉默认访问日志，用自己的 log()

    def _reply(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        total, with_link = (0, 0)
        try:
            total, with_link = sc.stats(CFG["site_url"])
        except Exception:
            pass
        self._reply(200, {
            "ok": True,
            "bot": "wodewangpan-qq-bot",
            "site": CFG["site_url"],
            "index_items": total,
            "with_link": with_link,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        })

    def _read_body(self):
        """读取请求体。必须同时支持 Content-Length 和 chunked。

        NapCat（Node 端）上报事件时可能不发 Content-Length，
        而是用 Transfer-Encoding: chunked 分块发送。
        早期版本只读 Content-Length，导致 chunked 请求被当成 0 字节，
        事件被静默丢弃，表面上看 NapCat 上报成功、机器人却毫无反应。
        """
        te = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in te:
            chunks = []
            while True:
                line = self.rfile.readline(65536)
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    size = int(line.split(b";")[0], 16)
                except ValueError:
                    break
                if size == 0:
                    self.rfile.readline(65536)   # 吃掉结尾的 CRLF
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)               # 每块后面的 CRLF
            return b"".join(chunks)
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def do_POST(self):
        try:
            raw = self._read_body()
            # 必须回 200 且响应体与 Content-Length 严格一致。
            # 早期版本这里回 204 却带 "{}" 响应体，204 按规范没有响应体，
            # Node 端会忽略这 2 字节并残留在连接里，污染下一次响应解析，
            # 报 "Parse Error: Expected HTTP/, RTSP/ or ICE/"。
            self._reply(200, {"status": "ok"})
        except Exception:
            log("× 读取上报请求体失败\n" + traceback.format_exc())
            return
        if not raw:
            log(f"· 收到空请求体（TE={self.headers.get('Transfer-Encoding')} CL={self.headers.get('Content-Length')}）")
            return
        try:
            event = json.loads(raw.decode("utf-8", "ignore"))
        except Exception:
            log(f"· 上报内容不是合法 JSON：{raw[:120]!r}")
            return
        threading.Thread(target=_safe_process, args=(event,), daemon=True).start()


def _safe_process(event):
    try:
        process(event)
    except Exception:
        log("× 处理异常\n" + traceback.format_exc())


def _warm():
    """启动即拉一次索引，别让群里第一个 @ 干等。"""
    try:
        t0 = time.time()
        total, with_link = sc.stats(CFG["site_url"])
        log(f"索引预热完成：{total} 条，{with_link} 条有网盘链接，用时 {time.time() - t0:.1f}s")
    except Exception as e:
        log(f"× 索引预热失败：{e}（首次查询时会自动重试）")


def _check_napcat():
    """启动时先探一下 NapCat。

    NapCat 只有 QQ 登录成功之后才会把 OneBot 的 HTTP 服务（默认 :3000）开起来；
    它没起来时本进程照样活着、TG 也照常回，但 QQ 群一条消息都收不到，
    表现就是「QQ 群挂了」。所以这里明确记一条，省得下次还要猜。
    只提醒不强退：NapCat 稍后登录成功，不用重启本进程也能自动恢复。
    """
    res = _api("get_status", {})
    if res is None:
        log("× NapCat 没就绪（%s 连不上）：QQ 群消息暂时收不到。" % CFG["napcat_api"])
        log("  多半是 QQ 还没登录完（NapCat 登录后才会开 OneBot 端口）。")
        log("  NapCat 登录成功后会自动恢复，不用重启本进程；TG 那边不受影响。")
        return False
    online = bool((res.get("data") or {}).get("online"))
    log("NapCat 就绪：online=%s" % online)
    if online:
        # 启动即已登录：后台线程立刻给飞书报一次到，别让 node 子进程拖住服务启动
        threading.Thread(target=_report_qq_online, args=("启动检查",),
                         daemon=True).start()
    else:
        log("  注意：NapCat 在线状态为 false，QQ 可能还没登录完。")
        log("  登录成功后看门狗首次探到在线，会补发一条上线汇报到飞书。")
    return True


# ---------- NapCat 看门狗：掉线走飞书提醒 ----------
#
# QQ 反复掉登录（NapCat 只有登录成功才开 OneBot 端口），掉的时候群里没反应，
# 但用户往往要等发现「群里怎么不理人」才知道。看门狗定期探活，掉线走飞书
# 标准推送（notify-feishu.mjs）第一时间告知，恢复时报平安。
# 推送失败只记日志，绝不影响机器人本体。

FEISHU_SCRIPT = os.path.join(ROOT, "scripts", "notify-feishu.mjs")


def _feishu(md_text, level="info"):
    """飞书推送：写 markdown 临时文件 -> node bot/scripts/notify-feishu.mjs。

    本机器人专用脚本（与院采雷达的采集简报脚本互不混用）：
    md_text 首行作卡片标题，其余为正文；level 决定卡片头部颜色
    （info=蓝 / warn=橙 / ok=绿 / alert=红）。"""
    try:
        import subprocess
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".md")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(md_text)
        try:
            r = subprocess.run(["node", FEISHU_SCRIPT, "--level", level, path],
                               capture_output=True, timeout=60)
            ok = r.returncode == 0
            if ok:
                log("√ 飞书提醒已发出")
            else:
                err = (r.stderr or b"").decode("utf-8", "ignore")[:120]
                log(f"× 飞书提醒失败：exit={r.returncode} {err}")
            return ok
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    except Exception as e:
        log(f"× 飞书提醒异常：{e.__class__.__name__}: {e}")
        return False


# ---------- QQ 上线汇报：登录成功后第一时间告知飞书 ----------
#
# 以前只有「掉线 → 恢复」才报平安，启动即在线（最常见的情况）反而一声不吭，
# 没法确认 QQ 是否已登录。这里按进程维度只报一次：
#   - 启动时 NapCat 已 online -> _check_napcat 后台线程立刻发
#   - 启动时还没登录       -> 看门狗首次探到 online 时补发
# 之后探活多少次、掉线恢复多少次都不再重复发「已上线」；
# 掉线告警与恢复报平安仍各走各自的卡片。

_online_reported = False
_online_report_lock = threading.Lock()


def _report_qq_online(where=""):
    """QQ 登录/上线后发一条飞书汇报，进程内只发一次（失败也不刷屏重试）。"""
    global _online_reported
    with _online_report_lock:
        if _online_reported:
            return False
        _online_reported = True

    text = (
        "QQ 机器人已上线 ✅\n\n"
        "NapCat 就绪，QQ 已登录成功，群里的 /搜索 可以正常用了。\n"
        f"上报服务：http://{CFG.get('listen_host', '127.0.0.1')}:{CFG.get('listen_port', 6700)}/\n"
        f"NapCat API：{CFG.get('napcat_api', '')}\n"
        f"上线时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"探测来源：{where or '看门狗'}"
    )
    ok = _feishu(text, level="ok")
    log("√ QQ 上线已汇报飞书" if ok else "× QQ 上线汇报没发出去（不重试，掉线/恢复提醒仍照常）")
    return ok


def _napcat_online():
    """NapCat 是否就绪（= QQ 已登录，OneBot 端口已开）。"""
    res = _api("get_status", {})
    return bool(res and ((res.get("data") or {}).get("online")))


def _napcat_watchdog(max_loops=None):
    """探活循环。

    - 判定掉线要连挂 down_strikes 次（默认 2，即约 2 分钟），避免重启窗口期误报
    - 启动后从没在线过，则放宽到 10 次才报（QQ 登录通常几十秒，超 10 分钟才是异常）
    - 一直掉着每 realert_minutes（默认 30 分钟）再催一次
    - 恢复时报平安
    max_loops 供测试限制循环次数；正式运行不传。
    """
    wd = CFG.get("napcat_watchdog") or {}
    if wd.get("enabled") is False:
        log("NapCat 看门狗：已关闭（napcat_watchdog.enabled=false）")
        return
    iv = wd.get("interval_seconds")
    interval = max(5, int(iv)) if iv else 60   # 5 分钟一探（指挥官定的）；0/缺省回落 60
    strikes_needed = max(1, int(wd.get("down_strikes") or 2))
    realert_every = max(1, int(wd.get("realert_minutes") or 30)) * 60

    strikes = 0
    down_since = None
    last_alert = None
    ever_online = False
    loops = 0
    log(f"NapCat 看门狗：每 {interval}s 探一次，连挂 {strikes_needed} 次判定掉线，"
        f"掉线期间每 {realert_every // 60} 分钟催一次")
    while True:
        time.sleep(interval)
        loops += 1
        online = _napcat_online()
        now = time.time()

        if online:
            if not _online_reported:
                # 启动时 QQ 还没登录，这里首次探到在线 -> 补一条上线汇报
                _report_qq_online("看门狗首次探活")
            elif down_since:
                mins = max(1, round((now - down_since) / 60))
                log(f"√ NapCat 已恢复（掉了约 {mins} 分钟）")
                _feishu(f"QQ 机器人已恢复 ✅\n\n掉了约 {mins} 分钟，现在在线。\n群里的 /搜索 可以正常用了。", level="ok")
            strikes = 0
            down_since = None
            last_alert = None
            ever_online = True
            if max_loops is not None and loops >= max_loops:
                return
            continue

        strikes += 1
        if down_since is None:
            down_since = now
        need = strikes_needed if ever_online else strikes_needed + 8
        if strikes < need:
            if max_loops is not None and loops >= max_loops:
                return
            continue
        if last_alert and now - last_alert < realert_every:
            if max_loops is not None and loops >= max_loops:
                return
            continue

        mins = max(1, round((now - down_since) / 60))
        log(f"⚠ NapCat 掉线约 {mins} 分钟，发飞书提醒")
        _feishu(
            "QQ 机器人掉线 ⚠️\n\n"
            f"已连不上 NapCat（{CFG['napcat_api']}）约 {mins} 分钟。\n"
            "QQ 群现在收不到消息，TG 不受影响。\n\n"
            "恢复办法：双击桌面「QQ扫码登录.vbs」扫码登录；\n"
            "若提示 NapCat 没在跑，先双击 NapCat 目录里的 napcat.bat。\n"
            "登录成功后机器人自动恢复，不用重启。", level="warn")
        last_alert = now
        if max_loops is not None and loops >= max_loops:
            return


def main():
    host = CFG.get("listen_host", "127.0.0.1")
    port = int(CFG.get("listen_port", 6700))
    log("=" * 52)
    log("wodewangpan 群机器人启动")
    log(f"站点：{CFG['site_url']}")
    log(f"上报监听：http://{host}:{port}/")
    log(f"NapCat API：{CFG['napcat_api']}")
    wl = CFG.get("group_whitelist") or []
    log(f"群白名单：{wl if wl else '未设置（所有群都响应，建议首次运行后回填群号）'}")
    log("=" * 52)
    _check_napcat()
    threading.Thread(target=_warm, daemon=True).start()
    threading.Thread(target=_napcat_watchdog, daemon=True).start()

    # Telegram 默认由独立进程跑（app/telegram/bot.py，桌面「启动TG机器人」/ 开机自启），
    # 这样 QQ 这边重启、NapCat 掉线、QQ 掉登录，都不会把 TG 一起拖下水。
    # 想回到「同一个进程里顺带跑 TG」的老模式，把 config.json 的 telegram.embedded 设成 true。
    tg_cfg = RAW.get("telegram") or {}
    if tg_cfg.get("embedded", False):
        try:
            from telegram import bot as tg_bot
            tg_bot.start(RAW)
            log("Telegram：内嵌模式（telegram.embedded=true），跑在后台线程")
        except Exception:
            log("× Telegram 适配器启动失败\n" + traceback.format_exc())
    else:
        log("Telegram：独立进程模式（telegram.embedded=false），本进程不管 TG")

    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("收到中断，退出")
        srv.shutdown()


if __name__ == "__main__":
    main()
