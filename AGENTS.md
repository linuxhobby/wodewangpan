# AGENTS.md — 给 AI 编码代理的工作须知

本文件面向未来在此仓库工作的 AI 代理，汇总架构约定、坑点与运行方式。人类读者看 `README.md` / `bot/README.md`。

## 安全红线

- `bot/config.json` 与各 `*.env` 含真实凭据（bot token、飞书应用密码），**绝不进公开渠道**：
  不开 GitHub Pages、不给第三方 OAuth 应用仓库权限、协作者最小化。
- `bot/logs/`、`__pycache__/`、`*.pyc` 属运行态，不进 git（聊天日志含用户 id 与会话内容）。

## 架构约定

**共享层 + 平台适配层**，新增平台 = 新增一个目录，不动共享层：

- `bot/app/core/`（指令路由、站点客户端、配置读取、日志/去重/限频）平台无关；
  `bot/app/telegram/` 是 TG 端入口与 HTML 渲染层。
- `push/common.mjs`（读站点数据、判重、选片、CLI、凭据查找）平台无关；
  `push/telegram/tg-post.mjs`、`push/bluesky/bluesky-post.mjs` 只管各自文案渲染与 API 收发。
- `config.json` 分段式：`common`（共享）/ `telegram` / `feishu`；
  入口用 `core.config.section_view` 把 `common` 与 `telegram` 合并成平铺视图。
- 群查询回复由 `core/handlers.py` 产出中立标记 `[网盘名](URL)`，
  `telegram/render.py` 转可点超链接；尾部（TG 订阅频道）由入口注入。
- `/f`、`/失效`、`/无`、`/无效`、`/错误` 经 `core/feedback.py` 走飞书推给管理员本人；
  搜索无结果时给一键反馈按钮。

QQ 端（NapCat / OneBot）已迁至绿联 NAS Docker，本仓库不再包含其代码、配置与启动器。

## 关键文件

| 路径 | 说明 |
|---|---|
| `bot/app/core/handlers.py` | 指令路由与业务逻辑（不碰消息发送） |
| `bot/app/core/site_client.py` | 站点只读客户端（只出站 www.wodewangpan.top） |
| `bot/app/core/config.py` | config.json 统一读取 |
| `bot/app/core/runtime.py` | 日志 / 消息去重 / 限频 |
| `bot/app/core/feedback.py` | 失效反馈 → 飞书（profile=tg） |
| `bot/app/telegram/bot.py` | TG 端入口，独立进程，长轮询 getUpdates |
| `bot/app/telegram/render.py` | TG 端 HTML 富文本渲染 |
| `bot/scripts/notify-feishu.mjs` | 飞书通知脚本（TG 反馈共用） |
| `bot/config.json` | 本机真实配置（token、白名单、飞书凭据），含凭据 |
| `bot/config.example.json` | 模板，首次部署复制成 config.json 再改 |
| `bot/菜单.vbs` / `bot/菜单.hta` | 桌面启动器（仅 TG 动作）与界面 |
| `bot/check_vbs.py` | VBS 语法粗检 |
| `push/common.mjs` | 推送侧共享流水线（判重口径、选片算法唯一实现） |
| `push/telegram/tg-post.mjs` | 资源站 → Telegram 频道 `@myquark` |
| `push/bluesky/bluesky-post.mjs` | 资源站 → Bluesky |
| `push/*/wodewangpan-*.env` | 两个推送脚本的现役凭据 |

## 运行

TG 端进程 cwd 必须是 `bot/`（代码按相对路径找 `app/` 与 `logs/`）：

```
cd bot
python app\telegram\bot.py
```

开机自启：启动文件夹的 `TG机器人开机自启.lnk` → `bot\TG机器人开机自启.vbs` → `菜单.vbs autostart-tg`。
桌面控制台为 `菜单.hta`（界面）+ `菜单.vbs`（实现），可启动 / 重启 / 结束 TG 进程。

⚠️ TG 侧同一时刻只允许一个 `app\telegram\bot.py` 实例，靠 `bot/logs/tg.lock` 排他锁互斥。
**锁是按目录走的**——换目录部署时若两边同时跑，两个实例会各抢一半 `getUpdates`，表现为消息随机丢一半且不报错。
迁移务必「停旧 → 确认进程消失 → 再启新」。

⚠️ `.vbs`（`菜单.vbs`、`TG机器人开机自启.vbs`）是 GBK + CRLF：wscript 按系统 ANSI 代码页读，
存成 UTF-8 中文弹窗会花。`菜单.hta` 是 UTF-8（HTML 声明 charset=utf-8）。改完用 `python check_vbs.py` 粗检。

Python 侧无第三方依赖（全标准库）。本网络可直连 `api.telegram.org` / `bsky.social`，无需代理。

## 社媒推送

各平台互相独立，素材都取自站点仓库 `C:/Users/marco/Github/wodewangpan` 的 `data/*.yaml` 与 `static/images/`
（2026-11-15 起配图按分类 slug 分子目录 `static/images/<slug>/<id>.jpg`，详情页外链是 `/<slug>/<id>/`；
口径统一走 `push/common.mjs` 的 `PREFIX_SLUG` / `itemUrl` / `imgPath`，别在各脚本里另拼路径），
缺字段就整行省略、绝不编造。

```
node push/telegram/tg-post.mjs --dry          # 只看文案，不发送（不需要 token）
node push/telegram/tg-post.mjs                # 发一条到 @myquark
node push/telegram/tg-post.mjs --retract <id> # 撤回某条（按 messageIds 逐条删）
node push/telegram/tg-post.mjs --check        # 校验 token 与频道管理员权限
node push/bluesky/bluesky-post.mjs --dry
node push/bluesky/bluesky-post.mjs
```

TG 推送的 caption 末尾固定一行「查询更多资源请联系 [小艾](https://t.me/wodewangpantop)」；
想换称呼或目标地址，在 `push/telegram/wodewangpan-tg.env` 里写 `TG_CONTACT_NAME` / `TG_CONTACT_URL` 覆盖。

判重口径（定死，唯一实现在 `push/common.mjs`）：只认夸克或百度分享链接，任一相同即同一份资源；
**标题相同但链接不同照发**（系列电影、多季剧是不同资源）。

判重状态文件在**本机**、不在本仓库，删了会重复发：

- `~/.workbuddy/telegram-posts/posted.json`
- `~/.workbuddy/bluesky-posts/posted.json`

定时任务（WorkBuddy 自动化调度，不在仓库里）：

| 任务 | 节奏 | id |
|---|---|---|
| 我的网盘.资源推送 Telegram 频道 | 每小时第 5 分钟（`BYMINUTE=5`，起点对齐） | `4b3c64dc-f994-433d-94f3-dbd606e6aef1` |
| 我的网盘.资源推送到 Bluesky | 每小时第 7 分钟（`BYMINUTE=7`，起点对齐） | `37f6dfb3-76c2-46d3-9352-8aa4202ba3af` |

调度口径（2026-11-15 核实，别再按「每 2 小时」描述）：两个任务都是 `FREQ=HOURLY;INTERVAL=1`，各自每小时发 1 条（2026-11-16 起 TG 在 :05、Bluesky 在 :07，相差 2 分钟）。WorkBuddy 调度器的 HOURLY 分支是「上次运行 + 1 小时」滚动（`computeHourlyNextRunAt` 只加 intervalHours，不按 BYHOUR/BYMINUTE 对齐），所以 `BYMINUTE` 仅用于界面显示和 validFrom 起点对齐，逐轮会随发帖耗时后移几十秒。要长期严格落在固定分钟，只能靠脚本层门控或系统计划任务，不要误以为是 rrule 在保证。

## 代码权威源

**本仓库是唯一实现**。定时任务 prompt 若仍指向 `telegram-push/`、`bluesky-push/` 旧路径，都已失效，应改成上表的 `push/...` 路径。

- 凭据查找顺序：脚本**同目录**的 `*.env` → `~/.workbuddy/*.env`（老环境回退）。
  所以本仓库里的 `push/telegram/wodewangpan-tg.env`、`push/bluesky/wodewangpan-bluesky.env` 是**现役凭据**。
- `posted.json` 判重记录**永远留在本机** `~/.workbuddy/{telegram,bluesky}-posts/`，不进 git、不搬仓库：
  复制或搬走会让已发过的资源重复发布。
- 飞书反馈凭据在 `bot/config.json` 的 `feishu.tg`（也可用 `FEISHU_TG_APP_ID/APP_SECRET` 或
  `~/.workbuddy/feishu-app-tg.json` 覆盖）；专用通道缺凭据直接判失败，不回退默认应用。
