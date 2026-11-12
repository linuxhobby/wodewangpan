#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QQ 端渲染：把 handlers 的中立链接标记 [网盘名](URL) 转成裸 URL。

QQ 只能发纯文本，靠客户端自动识别裸链；TG 端把同样的标记转成可点超链接
（见 telegram/render.py），这样共享层不需要知道平台差异。

提取码不能丢：标记文字里的「（提取码 xxxx）」摘出来跟在 URL 后面，用空格隔开，
避免被客户端当成 URL 的一部分。
"""

import re

_MD_LINK = re.compile(r"\[([^\[\]\n]{1,60})\]\((https?://[^\s()<>]+)\)")
_CODE = re.compile(r"（提取码 [^）]+）")


def to_plain(text):
    def repl(m):
        label, url = m.group(1), m.group(2)
        code = _CODE.search(label)
        return f"{url} {code.group(0)}" if code else url
    return _MD_LINK.sub(repl, text or "")
