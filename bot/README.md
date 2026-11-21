# bot/ — Telegram 群查询机器人 + 社媒推送

Telegram 群查询机器人与社媒推送代码，2026-11-12 曾从站点仓拆出为私有仓 mybot，
2026-11-17 并回本仓库（同批并入 `push/` 与 `tools/feishu-reports/`）。

- `bot/` — Telegram 群查询机器人（Python 标准库），失效反馈走飞书
- `push/` — 资源站 → Telegram 频道 / Bluesky 的定时推送脚本（Node.js）

QQ 群查询机器人已迁至绿联 NAS Docker，其代码、配置与启动器不在本仓库。

⚠️ 本仓库公开：凭据一律不进 git，只留各运行机本地，换机走 scp。

- `push/**/*.env`、`~/.config/wodewangpan-tg.env`（TG_BOT_TOKEN / SITE_URL）、
  `~/.config/wodewangpan-feishu.env`（FEISHU_APP_ID / FEISHU_APP_SECRET）——凭据统一在 `~/.config/`，
  `bot/app/core/config.py` 的 `load_raw()` 从这里读取并注入飞书子进程所需 `FEISHU_TG_*`。
- `bot/config.json` 只放非敏感配置（开关 / 群白名单 / 文案），**不放 token 与飞书 app 凭据**。

架构约定与坑点见 [`../AGENTS.md`](../AGENTS.md) §11，TG 端用法见本文与 §11.4。
