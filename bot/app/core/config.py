#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""config.json 的统一读取。

config.json 是单文件三段式（2026-11-12 重构定死）：
    common    全平台共享（目前只有 site_url）
    qq        QQ 端专属（NapCat / OneBot / 看门狗）
    telegram  TG 端专属

handlers 等共享层只认识平铺视图（site_url 在顶层），所以各平台入口用
section_view() 把 common 与自己那段合并成平铺字典；需要看别的平台段
（如 QQ 入口判断 telegram.embedded）时用 load_raw() 拿原始整份。
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
