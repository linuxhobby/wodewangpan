#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跨平台共享的运行时基础设施：日志、消息去重、限频。

这段代码曾在 QQ 端与 TG 端入口里各抄一份，2026-11-12 重构收敛到这里。
各平台入口各自实例化，实例之间不共享状态（两个进程本来就是独立的）。
"""

import os
import time
import threading


class Logger:
    """带时间戳日志：同时写 stdout 与 logs/<filename>。

    tag 会拼在时间戳前（TG 端传 "[TG]"，保持与历史日志格式一致）。
    用法：log = Logger(log_dir, "bot-%Y-%m-%d.log"); log("启动")。
    """

    def __init__(self, log_dir, filename, tag=""):
        os.makedirs(log_dir, exist_ok=True)
        self.path = os.path.join(log_dir, filename)
        self.tag = tag
        self._lock = threading.Lock()

    def __call__(self, msg):
        ts = time.strftime("%H:%M:%S")
        head = "%s [%s]" % (self.tag, ts) if self.tag else "[%s]" % ts
        line = "%s %s" % (head, msg)
        with self._lock:
            try:
                print(line, flush=True)
            except Exception:
                pass
            try:
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except Exception:
                pass


class RateControl:
    """消息去重 + 单键冷却 + 全局每分钟上限。

    三个判定的参数都在调用时传入，由各平台从自己的配置段取值，
    本类不关心配置结构——新平台接进来只需调这三个方法。
    """

    def __init__(self):
        self._seen = {}
        self._seen_lock = threading.Lock()
        self._cooldown = {}
        self._rate = []
        self._rate_lock = threading.Lock()

    def dup(self, message_id, window=600):
        """同一 message_id 只处理一次，防止上报重试导致重复刷屏。"""
        if not message_id:
            return False
        now = time.time()
        with self._seen_lock:
            if message_id in self._seen:
                return True
            self._seen[message_id] = now
            for k in [k for k, v in list(self._seen.items()) if now - v > window]:
                self._seen.pop(k, None)
        return False

    def too_fast(self, key, cooldown_seconds):
        """同一 key（群/私聊/用户）在冷却窗口内只放行一次。"""
        cd = int(cooldown_seconds or 0)
        if cd <= 0:
            return False
        now = time.time()
        if now - self._cooldown.get(key, 0) < cd:
            return True
        self._cooldown[key] = now
        return False

    def over_rate(self, limit_per_minute):
        """全局每分钟条数上限；limit <= 0 表示不限。"""
        limit = int(limit_per_minute or 0)
        if limit <= 0:
            return False
        now = time.time()
        with self._rate_lock:
            while self._rate and now - self._rate[0] > 60:
                self._rate.pop(0)
            if len(self._rate) >= limit:
                return True
            self._rate.append(now)
        return False
