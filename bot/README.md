# bot/ — Telegram 群查询机器人 + 社媒推送

Telegram 群查询机器人与社媒推送代码，2026-11-12 曾从站点仓拆出为私有仓 mybot，
2026-11-17 并回本仓库（同批并入 `push/` 与 `tools/feishu-reports/`）。

- `bot/` — Telegram 群查询机器人（Python 标准库），失效反馈走飞书
- `push/` — 资源站 → Telegram 频道 / Bluesky 的定时推送脚本（Node.js）

QQ 群查询机器人已迁至绿联 NAS Docker，其代码、配置与启动器不在本仓库。

⚠️ 本仓库公开：`bot/config.json` 与 `push/**/*.env` 含真实凭据，**一律不进 git**
（已列 .gitignore，并入历史已清洗），凭据只留各运行机本地，换机走 scp。

架构约定与坑点见 [`../AGENTS.md`](../AGENTS.md) §11，TG 端用法见本文与 §11.4。
