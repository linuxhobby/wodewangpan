#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 handlers 产出的纯文本版式转成 Telegram 的 HTML。

为什么要单独一层：
  QQ 只能发纯文本，靠客户端自动识别裸链；Telegram 支持 HTML/Markdown 富文本，
  可以把「夸克网盘（提取码 xxxx）」这几个字做成可点击的超链接，正文里不再出现裸链。

约定：handlers 的链接行固定是「网盘名<TAB>URL」，靠制表符就能精准识别，
不用改动 handlers 的任何逻辑，QQ 那边行为完全不变。
"""

import html
import re

# 「网盘名<TAB>https://...」
_LINK_LINE = re.compile(r"^(?P<name>[^\t]+)\t(?P<url>https?://\S+)$")

# 行内写法的超链接：[机器人](https://t.me/xxx) —— 链接文字可以自定义，不像裸链那样只能显示网址
_MD_LINK = re.compile(r"\[(?P<label>[^\[\]\n]{1,60})\]\((?P<lurl>https?://[^\s()<>]+)\)")

# 普通行里出现的裸链接（比如欢迎语里的站点地址），也做成可点
_URL_RE = re.compile(r"(https?://[^\s<>\u3000（）【】「」]+)")

# 一次扫完，行内链接优先，剩下的裸链接也接上
_INLINE_RE = re.compile(
    r"\[(?P<label>[^\[\]\n]{1,60})\]\((?P<lurl>https?://[^\s()<>]+)\)"
    r"|(?P<raw>https?://[^\s<>\u3000（）【】「」]+)"
)

SITE_TAIL_PREFIX = "更多资源访问："


def _a(url, label):
    return '<a href="%s">%s</a>' % (
        html.escape(url, quote=True),
        html.escape(label, quote=False),
    )


def _linkify(line):
    """把一行里的「[文字](网址)」和裸链接都转成 <a>，其余部分照常转义。"""
    out, pos = [], 0
    for m in _INLINE_RE.finditer(line):
        out.append(html.escape(line[pos:m.start()], quote=False))
        if m.group("lurl"):
            out.append(_a(m.group("lurl"), m.group("label")))
        else:
            out.append(_a(m.group("raw"), m.group("raw")))
        pos = m.end()
    out.append(html.escape(line[pos:], quote=False))
    return "".join(out)


def to_html(text):
    """纯文本 -> Telegram HTML。只动链接行和站点尾巴，其余原样转义。"""
    out = []
    for line in (text or "").split("\n"):
        m = _LINK_LINE.match(line.rstrip())
        if m:
            out.append(_a(m.group("url"), m.group("name").strip()))
            continue

        if line.startswith(SITE_TAIL_PREFIX):
            url = line[len(SITE_TAIL_PREFIX):].strip()
            if url.startswith("http"):
                label = url.replace("https://", "").replace("http://", "").rstrip("/")
                out.append(SITE_TAIL_PREFIX + _a(url, label))
                continue

        out.append(_linkify(line))
    return "\n".join(out)


def to_plain(text):
    """兜底：HTML 被拒时发的原样文本。
    去掉制表符（改成一个空格，手机上更好读），行内链接还原成「文字（网址）」。"""
    t = _MD_LINK.sub(lambda m: "%s（%s）" % (m.group("label"), m.group("lurl")), text or "")
    return t.replace("\t", "  ")
