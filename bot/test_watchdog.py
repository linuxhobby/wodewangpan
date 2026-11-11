# -*- coding: utf-8 -*-
"""NapCat 看门狗自检：一次长循环里模拟「在线→掉线→恢复→再掉」的完整生命周期。

sleep 打桩免等待；_napcat_online 按脚本序列返回；_feishu 收集提醒。
最后跑一次真实飞书推送，验证 notify-feishu.mjs 链路。
"""
import sys
import os
import time
import types

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))
import bot  # noqa: E402

ok = bad = 0


def check(name, got, want):
    global ok, bad
    passed = got == want
    ok, bad = ok + passed, bad + (not passed)
    print(("✓ " if passed else "✗ ") + name + ("" if passed else "（期望 %r，实际 %r）" % (want, got)), flush=True)


# sleep 打桩：探测间隔归零，但 time.time / strftime 保持真实
bot.time = types.SimpleNamespace(sleep=lambda s: None, time=time.time, strftime=time.strftime)
bot.CFG["napcat_watchdog"] = {"enabled": True, "interval_seconds": 5,
                              "down_strikes": 2, "realert_minutes": 30}

alerts = []
alert_levels = []
_real_feishu = bot._feishu          # 留住真函数，最后做真实推送
bot._feishu = lambda md, level="info": (alerts.append(md), alert_levels.append(level)) or True


def run(sequence):
    """sequence: 每次探测的在线状态序列，跑一遍看门狗，返回期间发出的提醒。"""
    states = iter(sequence)
    bot._napcat_online = lambda: next(states)
    start = len(alerts)
    bot._napcat_watchdog(max_loops=len(sequence))
    return alerts[start:]


# 1. 全程在线：不提醒
a = run([True, True, True])
check("全程在线不提醒", len(a), 0)

# 2. 在线 → 掉线连挂 2 次 → 报一次；之后掉线被 30 分钟节流；恢复报平安
a = run([True, True, False, False, False, False, True])
check("连挂 2 次才报掉线", len(a), 2)
check("第 1 条是掉线提醒", "掉线" in a[0], True)
check("掉线提醒有恢复办法", "QQ扫码登录.vbs" in a[0], True)
check("掉线提醒说明 TG 不受影响", "TG 不受影响" in a[0], True)
check("持续掉线被节流（没有重复催）", len(a), 2)
check("第 2 条是恢复报平安", "已恢复" in a[1], True)
check("掉线提醒是橙色告警级", alert_levels[-2], "warn")
check("恢复提醒是绿色正常级", alert_levels[-1], "ok")

# 3. 恢复后再掉线：仍按 2 次判定
a = run([True, False, False])
check("再次掉线也提醒", len(a), 1)

# 4. 启动就没在线过：放宽到 10 次才报（第 9 次还不出声，第 10 次报）
a = run([False] * 9)
check("未在线过 9 次不报", len(a), 0)
a = run([False])
check("续挂第 10 次也不报（两次调用状态不共享）", len(a), 0)
a = run([False] * 10)
check("单次长挂第 10 次才报", len(a), 1)

# 5. enabled=False 不启动
bot.CFG["napcat_watchdog"] = {"enabled": False}
bot._napcat_online = lambda: False
a0 = len(alerts)
bot._napcat_watchdog(max_loops=1)
check("enabled=false 不提醒", len(alerts), a0)
bot.CFG["napcat_watchdog"] = {"enabled": True, "interval_seconds": 5,
                              "down_strikes": 2, "realert_minutes": 30}

# 6. 真实飞书推送一次，验证 notify-feishu.mjs 链路（会发到飞书）
t0 = time.time()
real_ok = _real_feishu("QQ 机器人看门狗自检 ✅\n\n这是掉线提醒功能的测试推送，已改用机器人专用飞书脚本（bot/scripts/notify-feishu.mjs），收到说明链路通了。")
check("真实飞书推送成功", real_ok, True)
print(f"（真实推送用时 {time.time() - t0:.1f}s）", flush=True)

print("\n结果：%d 通过，%d 失败" % (ok, bad), flush=True)
sys.exit(1 if bad else 0)
