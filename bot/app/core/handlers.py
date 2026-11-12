#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
指令路由与回复组装。

只做一件事：把群里 @机器人 的一句话解析成一个指令，查站点，拼成要发回群里的文本。
不碰消息发送（由各平台入口 qq/bot.py、telegram/bot.py 负责），不碰本地文件。

回复版式（2026-11-12 定：🔍 + • + 中点）：
    🔍 搜索结果
    • 资源标题 · [夸克网盘](链接) · [百度网盘（提取码 xxxx）](链接)
    ...
    <提示行，例如「命中 N 条，先给 10 条，发 /更多 看下一批」>
    <平台尾部，由各平台入口通过 tail 参数传入>

链接统一写成中立标记 [网盘名](URL)：
    QQ 端 qq/render.py 转成裸 URL（客户端自动识别）；
    TG 端 telegram/render.py 转成 <a href> 超链接，正文不出现裸链。
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor

from . import site_client as sc
from . import feedback

PAGE_SIZE = 10         # 群里一次回几条资源（按最新排，最多 10 条）
MAX_MSG_LEN = 900      # 单条消息字数上限，超了拆条
PAGER_TTL = 300        # 「/更多」翻页记忆的有效期（秒）

HEAD = "🔍 搜索结果"
BULLET = "•"
SEP = " · "
TAIL_HELP = "/help  - 查看指令表"
# 不带 tail 调用时的兜底（QQ 版式）；两端入口都会显式传自己的 tail。
DEFAULT_TAIL = ["更多资源访问：https://www.wodewangpan.top", TAIL_HELP]
FEEDBACK_REPLY = "已反馈给管理员，谢谢"
FEEDBACK_FAIL = "反馈暂时没发出去，请稍后再试。"

HELP_TEXT = (
    "我的网盘索引站 · 指令\n"
    "\n"
    "/搜索 关键词   查资源，回网盘链接\n"
    "/更多          接着看下一批结果\n"
    "/最新          最近上架的资源\n"
    "/今日          今天更新的资源\n"
    "/分类          各分类有多少资源\n"
    "/随机          随便抽一个\n"
    "/帮助 /help    再看一次这份说明\n"
    "/f 内容        反馈失效资源给管理员（/失效 /无 /无效 /错误 同）\n"
    "\n"
    "群里直接发以上指令即可，不用 @ 我。\n"
    "@我 之后只发关键词也能搜。"
)

# 指令别名表：全部小写匹配
ALIAS = {
    "搜索": "search", "搜": "search", "s": "search", "search": "search",
    "找": "search", "查": "search", "so": "search",
    "更多": "more", "more": "more", "下页": "more", "下一页": "more", "next": "more",
    "最新": "latest", "new": "latest", "latest": "latest",
    "今日": "today", "today": "today",
    "分类": "category", "categories": "category", "category": "category", "cats": "category",
    "随机": "random", "随便": "random", "random": "random",
    "帮助": "help", "help": "help", "h": "help", "说明": "help",
    "f": "feedback", "feedback": "feedback",
    "失效": "feedback", "无": "feedback", "无效": "feedback",
    "错误": "feedback", "资源无效": "feedback", "资源错误": "feedback",
}

CMD_RE = re.compile(r"^\s*[/／]?\s*([^\s]{1,8})\s*(.*)$", re.S)

# 每个会话（群 / 私聊）最近一次搜索，供 /更多 翻页用。只存内存，进程重启即清空。
_pager = {}


def sanitize(raw):
    """关键词白名单清洗，防止把群消息里的奇怪字符带进查询或日志。"""
    raw = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9 _.\-]", " ", raw or "")
    return re.sub(r"\s+", " ", raw).strip()[:60]


def parse(text):
    """返回 (cmd, arg)。没写指令的纯关键词默认当搜索；带斜杠但不认识的指令走 unknown。

    反馈指令的 arg 保留原文（用户要原样带给管理员，常含分享链接），最多 500 字；
    其余指令照旧走 sanitize 白名单清洗。
    """
    t = (text or "").strip()
    if not t:
        return "empty", ""
    has_slash = t[0] in "/／"
    m = CMD_RE.match(t)
    if not m:
        return "unknown", ""
    head = (m.group(1) or "").lower().rstrip(":：")
    arg = m.group(2) or ""
    if head in ALIAS:
        cmd = ALIAS[head]
        if cmd == "feedback":
            return cmd, arg.strip()[:500]
        return cmd, sanitize(arg)
    if has_slash:
        return "unknown", sanitize(head + " " + arg)
    return "search", sanitize(t)


# ---------- 版式 ----------

def _fmt_item(it, links):
    """一条资源 = 一行：项目符号 + 标题 + 中点 + 若干网盘链接标记。

    网盘写成 [名称](URL) 中立标记，由各平台 render 决定显示成裸链还是超链接。
    """
    title = (it.get("title") or "未命名").strip()
    links = [x for x in (links or []) if x.get("url")]
    if not links:
        return f"{BULLET} {title}{SEP}暂无网盘链接"
    parts = []
    for lk in links:
        name = lk.get("name") or "网盘"
        if lk.get("code"):
            name = f"{name}（提取码 {lk['code']}）"
        parts.append(f"[{name}]({lk['url']})")
    return f"{BULLET} {title}{SEP}{SEP.join(parts)}"


def _fmt_body(items, urls):
    """🔍 标题行 + 每条资源一行，行间不空行。"""
    lines = [HEAD]
    lines.extend(_fmt_item(it, u) for it, u in zip(items, urls))
    return "\n".join(lines)


def _tail_text(note, tail):
    return "\n" + "\n".join(([note] if note else []) + list(tail or DEFAULT_TAIL))


def _assemble(body, note="", tail=None):
    """正文 + 提示 + 平台尾部；超长时按行拆条，尾部只挂最后一条。"""
    tail_str = _tail_text(note, tail)
    if len(body) + len(tail_str) <= MAX_MSG_LEN:
        return [body + tail_str]
    out, buf = [], ""
    for line in body.split("\n"):
        cand = (buf + "\n" + line) if buf else line
        if len(cand) + len(tail_str) > MAX_MSG_LEN and buf:
            out.append(buf)
            buf = line
        else:
            buf = cand
    if buf:
        out.append(buf)
    out[-1] += tail_str
    return out


def _simple(body, note="", tail=None):
    """短消息（没找到 / 到底了）也挂同一套平台尾部，但不参与拆条。"""
    return ["\n".join([body] + ([note] if note else []) + list(tail or DEFAULT_TAIL))]


def split_messages(text, limit=MAX_MSG_LEN):
    """超长按行切分（用于不含资源块尾巴的纯文本，如分类列表）。"""
    if len(text) <= limit:
        return [text]
    out, buf = [], ""
    for line in text.split("\n"):
        cand = (buf + "\n" + line) if buf else line
        if len(cand) > limit and buf:
            out.append(buf)
            buf = line
        else:
            buf = cand
    if buf:
        out.append(buf)
    return out or [text[:limit]]


# ---------- 翻页记忆 ----------

def _pager_set(key, kw, offset):
    if not key:
        return
    _pager[key] = {"kw": kw, "offset": offset, "ts": time.time()}


def _pager_get(key):
    st = _pager.get(key) if key else None
    if not st:
        return None
    if time.time() - st["ts"] > PAGER_TTL:
        _pager.pop(key, None)
        return None
    return st


# ---------- 站点访问 ----------

def _fetch_many(site_url, items):
    """并发抓详情页，最多 5 个线程，避免串行等待。"""
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(5, len(items))) as ex:
        futures = [ex.submit(_safe_links, site_url, it) for it in items]
        return [f.result() for f in futures]


def _safe_links(site_url, it):
    try:
        return sc.fetch_links(site_url, it) or []
    except Exception:
        return []


# ---------- 主入口 ----------

def _meta_set(meta, cmd, items, total=None):
    """回填本次结果的信息，供上层拼回执（例如「25 条结果已私发」）。
    只记条数，不记内容。meta 为 None 时什么都不做，老调用方无感。"""
    if meta is None:
        return
    meta.clear()
    meta["cmd"] = cmd
    meta["items"] = items
    meta["total"] = items if total is None else total


def handle(text, cfg, key="", page=None, meta=None, tail=None, platform="",
           feedback_hint=""):
    """主入口：返回要依次发出的消息文本列表。

    key           ：区分群/私聊，供 /更多 翻页。
    page          ：本次最多返回几条资源；None 用 PAGE_SIZE，传 0 表示不限（私发全量时用）。
    meta          ：可选 dict，回填 items / total / cmd，以及搜索无结果时的 feedback_kw。
    tail          ：平台尾部文案列表（QQ=站点地址，TG=订阅频道），由各平台入口传入。
    platform      ：来源标识（qq / telegram），写进失效反馈里便于管理员定位。
    feedback_hint ：搜索无结果时插在正文与尾部之间的提示模板，可含 {kw} 占位符。
                    平台各自决定给「可复制的 /f 指令行」还是「点按钮」的提示。
    """
    site_url = cfg["site_url"]
    cmd, arg = parse(text)
    if page is None:
        size = PAGE_SIZE
    else:
        size = int(page)
        if size <= 0:
            size = 10 ** 6      # 0 = 不限，给个足够大的数让切片自然取全
    if meta is not None:
        meta.clear()

    if cmd == "empty":
        return ["在的。发 /搜索 关键词 就能查资源，发 /help 看全部指令。"]

    if cmd == "help":
        return [HELP_TEXT]

    if cmd == "feedback":
        if not arg:
            return ["要反馈什么？这样发：/f 资源名或失效的链接"]
        ok = feedback.send_feedback(arg, source=platform, key=key)
        return [FEEDBACK_REPLY if ok else FEEDBACK_FAIL]

    if cmd == "unknown":
        return [f"没这条指令：{arg.split(' ')[0] if arg else ''}\n发 /help 看有哪些能用。"]

    try:
        if cmd == "search":
            if not arg:
                return ["要查什么？这样发：/搜索 青之箱"]
            hits, total = sc.search(site_url, arg, size, 0)
            if not hits:
                # 被动反馈入口：把没搜到的关键词回填给平台层（TG 拿来生成行内按钮），
                # 同时按平台模板在正文与尾部之间插一行提示。
                if meta is not None:
                    meta["feedback_kw"] = arg
                hint = feedback_hint.format(kw=arg) if feedback_hint else ""
                return _simple(f"没找到「{arg}」，换个关键词试试。", note=hint, tail=tail)
            _pager_set(key, arg, len(hits))
            note = ""
            if total > len(hits):
                note = f"命中 {total} 条，先给 {len(hits)} 条，发 /更多 看下一批"
            urls = _fetch_many(site_url, hits)
            _meta_set(meta, "search", len(hits), total)
            return _assemble(_fmt_body(hits, urls), note, tail=tail)

        if cmd == "more":
            st = _pager_get(key)
            if not st:
                return ["还没搜过东西。先发 /搜索 关键词，出结果后再发 /更多 翻下一批。"]
            hits, total = sc.search(site_url, st["kw"], size, st["offset"])
            if not hits:
                return _simple(f"「{st['kw']}」的结果已经到底了。", tail=tail)
            start = st["offset"] + 1
            st["offset"] += len(hits)
            st["ts"] = time.time()
            note = f"「{st['kw']}」第 {start}-{st['offset']} 条，共 {total} 条"
            urls = _fetch_many(site_url, hits)
            _meta_set(meta, "more", len(hits), total)
            return _assemble(_fmt_body(hits, urls), note, tail=tail)

        if cmd == "latest":
            items = sc.recent(site_url, PAGE_SIZE)
            urls = _fetch_many(site_url, items)
            _meta_set(meta, "latest", len(items))
            return _assemble(_fmt_body(items, urls), tail=tail)

        if cmd == "today":
            items, date = sc.today(site_url, PAGE_SIZE)
            if not items:
                return ["今天还没有新增，明天再来看看。"]
            urls = _fetch_many(site_url, items)
            note = ""
            if date != time.strftime("%Y-%m-%d"):
                # 只有退回到更早的更新日时才加一句说明，正常情况第一行就是资源名
                note = f"今天暂无新增，以下 {len(items)} 条是 {date} 更新的"
            _meta_set(meta, "today", len(items))
            return _assemble(_fmt_body(items, urls), note, tail=tail)

        if cmd == "category":
            cats, total = sc.categories(site_url)
            lines = [f"站里一共 {total} 条资源，分这些类：", ""]
            for c, n in cats:
                lines.append(f"{c}  {n} 条")
            lines += ["", "想看哪类，发 /搜索 分类名 就行。"]
            return split_messages("\n".join(lines))

        if cmd == "random":
            it = sc.pick_random(site_url)
            if not it:
                return ["暂时抽不出来，稍后再试。"]
            u = _safe_links(site_url, it)
            _meta_set(meta, "random", 1)
            return _assemble(_fmt_body([it], [u]), tail=tail)

        return [HELP_TEXT + "\n\n没看懂这条指令，发 /help 看用法。"]

    except sc.SiteError as e:
        return [f"站点暂时查不通（{e}），过几分钟再试。"]
    except Exception as e:
        return [f"查询出错了：{e.__class__.__name__}，稍后再试。"]
