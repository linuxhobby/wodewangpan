#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""失效反馈与飞书通知（跨平台共用）。

QQ / TG 两端的 /f、/失效、/无、/无效 都汇到这里：把用户原话写进一张飞书卡片
推给管理员。用机器人专用的 bot/scripts/notify-feishu.mjs（markdown 首行作
卡片标题）；推送失败只返回 False，绝不把异常抛回群聊。
按来源分流：TG 群反馈（source=telegram，含一键按钮）走指挥官指定的另一个飞书应用
（profile=tg），QQ 反馈走默认机器人应用，两边凭据互不影响。

与 qq/bot.py 里 NapCat 看门狗的 _feishu 独立实现：那条链路带自己的日志与测试打桩，
本模块只服务用户反馈，互不影响。
"""

import os
import time
import subprocess
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))          # bot/app/core
BOT_ROOT = os.path.dirname(os.path.dirname(_HERE))           # bot/
FEISHU_SCRIPT = os.path.join(BOT_ROOT, "scripts", "notify-feishu.mjs")

# TG 群的失效反馈发到指挥官指定的另一个飞书应用：
# 凭据在 bot/config.json 的 feishu.tg（app_id / app_secret / 可选 target_union），
# 也支持环境变量 FEISHU_TG_APP_ID / FEISHU_TG_APP_SECRET 或 ~/.workbuddy/feishu-app-tg.json 覆盖。
# QQ 反馈、NapCat 看门狗通知仍走默认机器人应用。
TG_PROFILE = "tg"


def _profile_for(source, profile=None):
    """按来源选飞书通道；显式传 profile 时以显式值为准。"""
    if profile is not None:
        return profile
    return TG_PROFILE if str(source or "").lower().startswith("telegram") else ""


def push_feishu(md_text, level="info", profile=""):
    """写临时 md 文件 -> node notify-feishu.mjs --level <level> <file>。返回是否成功。

    profile 经环境变量 FEISHU_PROFILE 传给脚本（不走命令行，避免出现在进程列表）。
    """
    try:
        fd, path = tempfile.mkstemp(suffix=".md")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(md_text)
        try:
            # 显式清掉继承来的 FEISHU_PROFILE，免得父进程环境变量把默认通道带偏
            env = os.environ.copy()
            if profile:
                env["FEISHU_PROFILE"] = profile
            else:
                env.pop("FEISHU_PROFILE", None)
            r = subprocess.run(["node", FEISHU_SCRIPT, "--level", level, path],
                               capture_output=True, timeout=20, env=env)
            return r.returncode == 0
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    except Exception:
        return False


def send_feedback(text, source="", key="", title="资源失效反馈 ⚠️", profile=None):
    """把 /f 的原话推给管理员，返回是否送达。

    source/key 只用于管理员定位会话，不回显到群里。
    title 是卡片标题（md 首行）；一键按钮反馈会换成「搜索无结果反馈」。
    """
    md = (
        f"{title}\n\n"
        f"来源：{source or '未知平台'}\n"
        f"会话：{key or '未知会话'}\n"
        f"时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        f"反馈内容：\n{text}\n"
    )
    return push_feishu(md, level="warn", profile=_profile_for(source, profile))


def send_no_result_feedback(keyword, source="", key="", profile=None):
    """搜索无结果时的一键反馈：带上「资源无效 / 资源错误」与刚才搜的关键词。"""
    text = f"搜索关键词：{keyword}\n用户反馈：资源无效 / 资源错误（搜索无结果）"
    return send_feedback(text, source=source, key=key,
                         title="搜索无结果反馈 ⚠️", profile=profile)
