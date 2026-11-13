# mybot

wodewangpan 的 Telegram 群查询机器人与社媒推送脚本。2026-11-12 从公开仓库
[`linuxhobby/wodewangpan`](https://github.com/linuxhobby/wodewangpan) 的 `bot/` 目录迁出，
并把 Telegram / Bluesky 推送脚本一并收进来。

- `bot/` — Telegram 群查询机器人（Python 标准库），失效反馈走飞书
- `push/` — 资源站 → Telegram 频道 / Bluesky 的定时推送脚本（Node.js）

QQ 群查询机器人已迁至绿联 NAS Docker，其代码、配置与启动器不在本仓库。

⚠️ `bot/config.json` 与各 `*.env` 含真实凭据，本仓库私有，勿公开。

架构约定与坑点见 [`AGENTS.md`](AGENTS.md)，TG 端用法见 [`bot/README.md`](bot/README.md)。
