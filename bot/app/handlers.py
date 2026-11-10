#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
指令路由与回复组装。

只做一件事：把群里 @机器人 的一句话解析成一个指令，查站点，拼成要发回群里的文本。
不碰消息发送（由 bot.py 负责），不碰本地文件。
"""

import re
import time
import random
from concurrent.futures import ThreadPoolExecutor

import site_client as sc

MAX_RESULT = 3
MAX_MSG_LEN = 900

HELP_TEXT = (
    "我的网盘索引站 · 指令\n"
    "\n"
    "/搜索 关键词   查资源，回网盘链接\n"
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
    "最新": "latest", "new": "latest", "latest": "latest",
    "今日": "today", "today": "today",
    "分类": "category", "categories": "category", "category": "category",
    "随机": "random", "随便": "random", "random": "random",
    "帮助": "help", "help": "help", "h": "help", "说明": "help",
}

CMD_RE = re.compile(r"^\s*[/／]?\s*([^\s]{1,8})\s*(.*)$", re.S)


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


def _fmt_item(it, links):
    """一条资源：首行「名称 | 类型 | 网盘」，下行是链接；有第二个网盘就再接一组。"""
    title = (it.get("title") or "未命名").strip()
    cat = (it.get("category") or "其他").strip()
    links = [x for x in (links or []) if x.get("url")]
    if not links:
        return f"{title} | {cat} | 暂无网盘链接"
    lines = []
    for i, lk in enumerate(links):
        name = lk.get("name") or "网盘"
        if lk.get("code"):
            name = f"{name}（提取码 {lk['code']}）"
        lines.append(f"{title} | {cat} | {name}" if i == 0 else name)
        lines.append(lk["url"])
    return "\n".join(lines)


def _fmt_list(site_url, items, urls):
    """多条资源之间空一行，网站地址只在最后出现一次。"""
    blocks = [_fmt_item(it, u) for it, u in zip(items, urls)]
    return "\n\n".join(blocks) + f"\n\n网站地址：{site_url}"


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


def split_messages(text, limit=MAX_MSG_LEN):
    """超长按空行切分，确保每条不超限。"""
    if len(text) <= limit:
        return [text]
    out, buf = [], ""
    for block in text.split("\n\n"):
        candidate = (buf + "\n\n" + block).strip() if buf else block
        if len(candidate) > limit and buf:
            out.append(buf)
            buf = block
        else:
            buf = candidate
    if buf:
        out.append(buf)
    return out or [text[:limit]]


def handle(text, cfg):
    """主入口：返回要依次发出的消息文本列表。"""
    site_url = cfg["site_url"]
    cmd, arg = parse(text)

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
            hits, total = sc.search(site_url, arg, MAX_RESULT)
            if not hits:
                return [
                    f"没找到「{arg}」，换个关键词试试。\n"
                    f"网站地址：{site_url}"
                ]
            urls = _fetch_many(site_url, hits)
            body = _fmt_list(site_url, hits, urls)
            if total > len(hits):
                body = f"命中 {total} 条，先给前 {len(hits)} 条\n\n{body}"
            return split_messages(body)

        if cmd == "latest":
            items = sc.recent(site_url, 8)
            urls = _fetch_many(site_url, items)
            return split_messages(_fmt_list(site_url, items, urls))

        if cmd == "today":
            items, date = sc.today(site_url, 8)
            if not items:
                return ["今天还没有新增，明天再来看看。"]
            urls = _fetch_many(site_url, items)
            body = _fmt_list(site_url, items, urls)
            if date != time.strftime("%Y-%m-%d"):
                # 只有退回到更早的更新日时才加一行说明，正常情况保持「第一行就是资源名」
                body = f"今天暂无新增，以下是 {date} 更新的 {len(items)} 条\n\n{body}"
            return split_messages(body)

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
            return split_messages(_fmt_list(site_url, [it], [u]))

        return [HELP_TEXT + "\n\n没看懂这条指令，发 /帮助 看用法。"]

    except sc.SiteError as e:        return [f"站点暂时查不通（{e}），过几分钟再试。"]
    except Exception as e:
        return [f"查询出错了：{e.__class__.__name__}，稍后再试。"]
