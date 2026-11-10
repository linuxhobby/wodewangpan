#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
指令路由与回复组装。

只做一件事：把群里 @机器人 的一句话解析成一个指令，查站点，拼成要发回群里的文本。
不碰消息发送（由 bot.py 负责），不碰本地文件。

回复版式（一条资源一块，块内不空行）：
    资源名称 ｜ 类型
    夸克网盘<TAB>链接
    百度网盘<TAB>链接
    ...
    更多资源访问：https://www.wodewangpan.top
    /帮助 — 查看指令表
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor

import site_client as sc

PAGE_SIZE = 3          # 群里一次回几条资源
MAX_MSG_LEN = 900      # 单条消息字数上限，超了拆条
PAGER_TTL = 300        # 「/更多」翻页记忆的有效期（秒）

TAIL_HELP = "/帮助 — 查看指令表"
TAIL_SITE = "更多资源访问：{url}"

HELP_TEXT = (
    "我的网盘索引站 · 指令\n"
    "\n"
    "/搜索 关键词   查资源，回网盘链接\n"
    "/更多          接着看下一批结果\n"
    "/最新          最近上架的资源\n"
    "/今日          今天更新的资源\n"
    "/分类          各分类有多少资源\n"
    "/随机          随便抽一个\n"
    "/帮助          再看一次这份说明\n"
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
}

CMD_RE = re.compile(r"^\s*[/／]?\s*([^\s]{1,8})\s*(.*)$", re.S)

# 每个会话（群 / 私聊）最近一次搜索，供 /更多 翻页用。只存内存，进程重启即清空。
_pager = {}


def sanitize(raw):
    """关键词白名单清洗，防止把群消息里的奇怪字符带进查询或日志。"""
    raw = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9 _.\-]", " ", raw or "")
    return re.sub(r"\s+", " ", raw).strip()[:60]


def parse(text):
    """返回 (cmd, arg)。没写指令的纯关键词默认当搜索；带斜杠但不认识的指令走 unknown。"""
    t = (text or "").strip()
    if not t:
        return "empty", ""
    has_slash = t[0] in "/／"
    m = CMD_RE.match(t)
    head = (m.group(1) or "").lower().rstrip(":：")
    arg = m.group(2) or ""
    if head in ALIAS:
        return ALIAS[head], sanitize(arg)
    if has_slash:
        return "unknown", sanitize(head + " " + arg)
    return "search", sanitize(t)


# ---------- 版式 ----------

def _fmt_item(it, links):
    """一条资源：首行「名称 ｜ 类型」，下面一行一个网盘，用制表符隔开网盘名与链接。"""
    title = (it.get("title") or "未命名").strip()
    cat = (it.get("category") or "其他").strip()
    lines = [f"{title} ｜ {cat}"]
    links = [x for x in (links or []) if x.get("url")]
    if not links:
        lines.append("暂无网盘链接")
        return "\n".join(lines)
    for lk in links:
        name = lk.get("name") or "网盘"
        if lk.get("code"):
            name = f"{name}（提取码 {lk['code']}）"
        lines.append(f"{name}\t{lk['url']}")
    return "\n".join(lines)


def _fmt_body(items, urls):
    """多条资源首尾相接，块与块之间不空行。"""
    return "\n".join(_fmt_item(it, u) for it, u in zip(items, urls))


def _assemble(site_url, body, note=""):
    """正文 + 固定尾巴（提示、网站地址、帮助），超长时按行拆条，尾巴只挂最后一条。"""
    tail_lines = ([note] if note else []) + [TAIL_SITE.format(url=site_url), TAIL_HELP]
    tail = "\n" + "\n".join(tail_lines)
    if len(body) + len(tail) <= MAX_MSG_LEN:
        return [body + tail]
    out, buf = [], ""
    for line in body.split("\n"):
        cand = (buf + "\n" + line) if buf else line
        if len(cand) + len(tail) > MAX_MSG_LEN and buf:
            out.append(buf)
            buf = line
        else:
            buf = cand
    if buf:
        out.append(buf)
    out[-1] += tail
    return out


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


def handle(text, cfg, key="", page=None, meta=None):
    """主入口：返回要依次发出的消息文本列表。

    key  ：区分群/私聊，供 /更多 翻页。
    page ：本次最多返回几条资源；None 用 PAGE_SIZE，传 0 表示不限（私发全量时用）。
    meta ：可选 dict，回填 items（结果条数）/ total（命中总数）/ cmd，供上层写回执。
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
        return ["在的。发 /搜索 关键词 就能查资源，发 /帮助 看全部指令。"]

    if cmd == "help":
        return [HELP_TEXT]

    if cmd == "unknown":
        return [f"没这条指令：{arg.split(' ')[0] if arg else ''}\n发 /帮助 看有哪些能用。"]

    try:
        if cmd == "search":
            if not arg:
                return ["要查什么？这样发：/搜索 青之箱"]
            hits, total = sc.search(site_url, arg, size, 0)
            if not hits:
                return [
                    f"没找到「{arg}」，换个关键词试试。\n"
                    + TAIL_SITE.format(url=site_url) + "\n"
                    + TAIL_HELP
                ]
            _pager_set(key, arg, len(hits))
            note = ""
            if total > len(hits):
                note = f"命中 {total} 条，先给 {len(hits)} 条，发 /更多 看下一批"
            urls = _fetch_many(site_url, hits)
            _meta_set(meta, "search", len(hits), total)
            return _assemble(site_url, _fmt_body(hits, urls), note)

        if cmd == "more":
            st = _pager_get(key)
            if not st:
                return ["还没搜过东西。先发 /搜索 关键词，出结果后再发 /更多 翻下一批。"]
            hits, total = sc.search(site_url, st["kw"], size, st["offset"])
            if not hits:
                return [
                    f"「{st['kw']}」的结果已经到底了。\n"
                    + TAIL_SITE.format(url=site_url) + "\n"
                    + TAIL_HELP
                ]
            start = st["offset"] + 1
            st["offset"] += len(hits)
            st["ts"] = time.time()
            note = f"「{st['kw']}」第 {start}-{st['offset']} 条，共 {total} 条"
            urls = _fetch_many(site_url, hits)
            _meta_set(meta, "more", len(hits), total)
            return _assemble(site_url, _fmt_body(hits, urls), note)

        if cmd == "latest":
            items = sc.recent(site_url, 8)
            urls = _fetch_many(site_url, items)
            _meta_set(meta, "latest", len(items))
            return _assemble(site_url, _fmt_body(items, urls))

        if cmd == "today":
            items, date = sc.today(site_url, 8)
            if not items:
                return ["今天还没有新增，明天再来看看。"]
            urls = _fetch_many(site_url, items)
            note = ""
            if date != time.strftime("%Y-%m-%d"):
                # 只有退回到更早的更新日时才加一句说明，正常情况第一行就是资源名
                note = f"今天暂无新增，以下 {len(items)} 条是 {date} 更新的"
            _meta_set(meta, "today", len(items))
            return _assemble(site_url, _fmt_body(items, urls), note)

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
            return _assemble(site_url, _fmt_body([it], [u]))

        return [HELP_TEXT + "\n\n没看懂这条指令，发 /帮助 看用法。"]

    except sc.SiteError as e:
        return [f"站点暂时查不通（{e}），过几分钟再试。"]
    except Exception as e:
        return [f"查询出错了：{e.__class__.__name__}，稍后再试。"]
