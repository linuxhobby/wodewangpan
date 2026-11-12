# mybot

wodewangpan 的机器人本体与社媒推送脚本。2026-11-12 从公开仓库
[`linuxhobby/wodewangpan`](https://github.com/linuxhobby/wodewangpan) 的 `bot/` 目录迁出，
并把原本散在 `~/.qwenworkcn/` 下的 Telegram / Bluesky 推送脚本一并收进来。

> **注意**：这里的代码在公开仓库的历史提交里仍然存在，迁出不能把它们从历史中抹掉。
> 本仓库私有，且 `config.json` 与各 `.env` 含真实凭据（bot token、群号、App 密码），
> 因此：不开 GitHub Pages、不给任何第三方 OAuth 应用仓库权限、协作者按需最小化。

## 目录

| 路径 | 说明 |
|---|---|
| `bot/app/bot.py` | QQ 侧机器人本体（NapCat / OneBot），TG 侧不依赖它 |
| `bot/app/telegram_bot.py` | Telegram 侧独立进程，长轮询 `getUpdates` |
| `bot/app/handlers.py` | 两侧共用的查询与业务逻辑 |
| `bot/app/site_client.py` | 访问站点数据 |
| `bot/app/tg_render.py` | TG 侧 HTML 富文本渲染 |
| `bot/scripts/notify-feishu.mjs` | 飞书告警推送（NapCat 掉线看门狗等走这里） |
| `bot/scripts/qr_desktop.py` | 桌面二维码面板，**唯一用到 Pillow 的地方** |
| `bot/菜单.vbs` | 启动器：`autostart-qq` / `autostart-tg` / `--check`（GBK + CRLF 编码，别存成 UTF-8） |
| `bot/config.json` | 本机真实配置（token、群号、代理），含凭据 |
| `bot/config.example.json` | 模板，首次部署复制成 `config.json` 再改 |
| `telegram-push/tg-post.mjs` | 资源站 → Telegram 频道 `@myquark` 的每小时推送 |
| `bluesky-push/bluesky-post.mjs` | 资源站 → Bluesky 的每小时推送 |

`bot/logs/`、`__pycache__/`、`*.pyc` 属运行态，不进 git（聊天日志含用户 id 与会话内容）。

## 运行

机器人（都在 `bot/` 目录下起，进程 cwd 必须是 `bot/`，代码按相对路径找 `app/` 与 `logs/`）：

```
cd bot
"C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe" "app\bot.py"          # QQ 侧
"C:\Users\marco\AppData\Local\Programs\Python\Python312\pythonw.exe" "app\telegram_bot.py" # TG 侧
```

开机自启是「启动」文件夹里两个快捷方式，指向本目录的 vbs，vbs 再调同目录 `菜单.vbs`：

- `QQ机器人开机自启.lnk` → `bot\开机自启.vbs` → `菜单.vbs autostart-qq`
- `TG机器人开机自启.lnk` → `bot\TG机器人开机自启.vbs` → `菜单.vbs autostart-tg`

⚠️ `autostart-qq` 在 NapCat 没跑时会**顺手拉起 NapCat**（还会先 sleep 25 秒）。只想重启 bot 本体就别用它，直接按上面的命令起。

⚠️ TG 侧同一时刻只允许一个 `telegram_bot.py` 实例，靠 `bot/logs/tg.lock` 排他锁互斥。**锁是按目录走的**——旧目录和新目录各有一把锁，所以换目录部署时若两边同时跑，两个实例会各抢一半 `getUpdates`，表现为消息随机丢一半且不报错。迁移务必「停旧 → 确认进程消失 → 再启新」。

依赖见 `requirements.txt`：bot 本体纯标准库，只有 `qr_desktop.py` 需要 Pillow。国内跑 TG 侧必须在 `config.json` 配 `telegram.proxy`，否则连不上 `api.telegram.org`。

## 社媒推送

两侧各自独立，素材都取自站点仓库 `C:/Users/marco/Github/wodewangpan` 的 `data/*.yaml` 与 `static/images/`，缺字段就整行省略、绝不编造。

```
node telegram-push/tg-post.mjs --dry         # 只看文案，不发送（不需要 token）
node telegram-push/tg-post.mjs               # 发一条到 @myquark
node telegram-push/tg-post.mjs --retract <id> # 撤回某条（按 messageIds 逐条删）
node telegram-push/tg-post.mjs --check       # 校验 token 与频道管理员权限
node bluesky-push/bluesky-post.mjs --dry
node bluesky-push/bluesky-post.mjs
```

判重口径（定死）：只认夸克或百度分享链接，任一相同即同一份资源；**标题相同但链接不同照发**（系列电影、多季剧是不同资源）。

判重状态文件在**本机**、不在本仓库，删了会重复发：

- `~/.qwenworkcn/telegram-posts/posted.json`
- `~/.qwenworkcn/bluesky-posts/posted.json`

定时任务（QwenWork 调度，不在仓库里）：

| 任务 | 节奏 | id |
|---|---|---|
| 我的网盘.资源推送 Telegram 频道 | 每小时 `:40`，漏跑 `skip` | `21a463d6-ea25-43c1-9c4b-32327b0262ff` |
| 我的网盘.资源推送到 Bluesky | 每小时 `:10` | `f9355e9c-86ed-424a-a286-2731684d7578` |

## 代码权威源与旧路径转发壳

**本仓库是唯一实现**。2026-11-12 迁移动作之后：

- `~/.qwenworkcn/skills/wodewangpan-telegram/scripts/tg-post.mjs` 与
  `~/.qwenworkcn/skills/wodewangpan-bluesky/scripts/bluesky-post.mjs` 已改成**几行的转发壳**
  （`import` 本仓库的真身），原件备份为同目录 `*.bak-20261112`。壳存在只为让旧路径继续可用、
  避免为了改一行路径去重抄上千字的任务 prompt；真身只有一份，不会漂移。
- 「我的网盘.资源推送 Telegram 频道」的 prompt 已**直接指向本仓库**的 `telegram-push/tg-post.mjs`。
- 「我的网盘.资源推送到 Bluesky」的 prompt 仍指旧路径，靠壳转发；哪天要摘掉壳，只需把那条 prompt 里的路径改掉。
- 凭据查找顺序：脚本**同目录**的 `*.env` → `~/.qwenworkcn/*.env` → `~/.workbuddy/*.env`（老环境回退）。
  所以本仓库里的 `telegram-push/wodewangpan-tg.env`、`bluesky-push/wodewangpan-bluesky.env` 是**现役凭据**。
- `posted.json` 判重记录**永远留在本机** `~/.qwenworkcn/{telegram,bluesky}-posts/`，不进 git、不搬仓库：
  复制或搬走会让已发过的资源重复发布。

## 迁移留档

- 2026-11-12 起，两个机器人进程已从本目录运行（`app\bot.py`、`app\telegram_bot.py`，cwd 必须是 `bot/`），
  Startup 里两个自启快捷方式也已重指向本目录。**站点仓库那份 `bot/` 暂时还在原地未删**，
  等 `docs/README.md` 里两段 bot 文档如何处置定下来后再从仓库移除——它已经不再被任何进程使用。
- 副本里三处硬编码路径已改指本目录：`app/bot.py`（飞书脚本绝对路径）、`菜单.vbs`、`菜单.hta`（后者是转义反斜杠写法，容易漏）。
