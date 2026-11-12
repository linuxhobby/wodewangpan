# mybot

wodewangpan 的机器人本体与社媒推送脚本。2026-11-12 从公开仓库
[`linuxhobby/wodewangpan`](https://github.com/linuxhobby/wodewangpan) 的 `bot/` 目录迁出，
并把 Telegram / Bluesky 推送脚本一并收进来。

- `bot/` — QQ（NapCat / OneBot）与 Telegram 两个机器人端，Python
- `push/` — 资源站 → Telegram / Bluesky 的定时推送脚本，Node.js

⚠️ `config.json` 与各 `*.env` 含真实凭据，本仓库私有，勿公开。

架构约定、运行方式与注意事项详见 [`AGENTS.md`](AGENTS.md)。
