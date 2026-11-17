#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""config.json 的统一读取。

config.json 按用途分段：
    common    平台共享（目前只有 site_url）
    telegram  TG 端专属
    feishu    失效反馈的飞书凭据（profile=tg）

handlers 等共享层只认识平铺视图（site_url 在顶层），所以平台入口用
section_view() 把 common 与 telegram 段合并成平铺字典；需要读原始整份
（如飞书凭据）时用 load_raw()。
"""

import json
import os


def load_raw(root):
    """读整份 config.json（root 为 bot/ 目录）。"""
    with open(os.path.join(root, "config.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def section_view(raw, section):
    """common + <section> 合并成平铺视图；同名键平台段覆盖 common。"""
    merged = dict(raw.get("common") or {})
    merged.update(raw.get(section) or {})
    return merged
