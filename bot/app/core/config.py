#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""config.json 的统一读取。

config.json 只放**非敏感**配置（开关、白名单、文案、站点地址兜底）。
凭据（TG token / 飞书 app 凭据）统一放运行机 ~/.config/ 下的 env 文件，
与 push/ 共用同一处，不入库：

    ~/.config/wodewangpan-tg.env        TG_BOT_TOKEN、SITE_URL
    ~/.config/wodewangpan-feishu.env    FEISHU_APP_ID、FEISHU_APP_SECRET

凭据只从 ~/.config/ 的 env 文件读取；飞书凭据额外注入 os.environ 的
FEISHU_TG_*，供 notify-feishu.mjs 子进程继承。

handlers 等共享层只认识平铺视图（site_url 在顶层），所以平台入口用
section_view() 把 common 与 telegram 段合并成平铺字典。
"""

import json
import os

_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config")
_TG_ENV = os.path.join(_CONFIG_DIR, "wodewangpan-tg.env")
_FEISHU_ENV = os.path.join(_CONFIG_DIR, "wodewangpan-feishu.env")


def _read_env(path):
    """读 KEY=VALUE 的 env 文件；不存在或读不了就返回空 dict，绝不抛异常。"""
    out = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def load_raw(root):
    """读整份配置，并用 ~/.config/ 的凭据覆盖敏感字段。"""
    try:
        with open(os.path.join(root, "config.json"), "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}

    tg = _read_env(_TG_ENV)
    if tg.get("TG_BOT_TOKEN"):
        cfg.setdefault("telegram", {})["token"] = tg["TG_BOT_TOKEN"]
    if tg.get("SITE_URL"):
        cfg.setdefault("common", {})["site_url"] = tg["SITE_URL"]

    fs = _read_env(_FEISHU_ENV)
    if fs.get("FEISHU_APP_ID") and fs.get("FEISHU_APP_SECRET"):
        # notify-feishu.mjs --profile tg 从 FEISHU_TG_* 读，子进程继承 os.environ。
        # target_union 不覆盖：脚本内置的是 on_ 开头的 union_id，
        # 而 feishu.env 的 FEISHU_TO 是 ou_ 开头的 open_id，喂进去会发送失败。
        os.environ.setdefault("FEISHU_TG_APP_ID", fs["FEISHU_APP_ID"])
        os.environ.setdefault("FEISHU_TG_APP_SECRET", fs["FEISHU_APP_SECRET"])

    return cfg


def section_view(raw, section):
    """common + <section> 合并成平铺视图；同名键平台段覆盖 common。"""
    merged = dict(raw.get("common") or {})
    merged.update(raw.get(section) or {})
    return merged
