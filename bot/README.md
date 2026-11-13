# wodewangpan Telegram 群机器人

在 Telegram 群里发指令，查网盘索引站的资源，回可点的网盘链接（夸克 / 百度，含提取码）。

- 数据来源只有一处：`https://www.wodewangpan.top`，只读，不碰本地资源仓库
- Python 标准库，零第三方依赖，不需要 `pip install`
- 本网络可直连 `api.telegram.org`，`telegram.proxy` 留空即可
- QQ 群机器人已迁至绿联 NAS Docker，本仓库不再包含 QQ 端（NapCat / OneBot）代码

## 链路

```
TG 群 /s 关键词 → Telegram Bot API（getUpdates 长轮询）→ 查站点 → sendMessage 回群
```

## 指令

| 指令 | 作用 |
|---|---|
| `/s 关键词` | 查资源，一次最多 10 条（按上架日期从新到旧） |
| `/more` | 接着看下一批 10 条（5 分钟内有效，按会话记） |
| `/latest` | 最近上架 |
| `/today` | 今天更新（没有则显示最近一次更新日） |
| `/cats` | 各分类条数 |
| `/random` | 随机一条 |
| `/help` `/start` | 用法说明 |
| `/f 内容` | 反馈失效资源给管理员（`/失效` `/无` `/无效` `/错误` 同） |
| `/id` | 回当前 chat_id，用来填 `allowed_chats` |
| `/welcome` `/公告` | 重发入群欢迎语 |

中文关键词照旧，`/s 神探狄仁杰` 正常；支持拼音（`qingzhixiang`、`qzx`）。
不带命令直接发关键词也能搜，但群里需要 @机器人（TG 隐私模式默认行为）。

**反馈两个入口**：主动发 `/f 内容`；搜索无结果时给「反馈资源问题」行内按钮，点一下即送达
（飞书卡片，按钮 30 分钟内有效、用一次即废）。链路是 `core/feedback.py` →
`scripts/notify-feishu.mjs --profile tg` → `config.json` 的 `feishu.tg` 凭据。

## 回复版式

```
🔍 搜索结果
• 007：杀人执照 · 夸克网盘 · 百度网盘（提取码 fw1j）
• 权力的游戏 第八季 · 夸克网盘
命中 442 条，先给 10 条，发 /more 看下一批

更多资源订阅：https://t.me/myquark
/help  - 查看指令表
```

共享层 `handlers.py` 产出中立标记 `[网盘名](URL)`，`telegram/render.py` 转成 `<a href>`，
正文不出现裸链；列表与尾部之间空一行，订阅地址取 `telegram.subscribe_url`。
单条按 3900 字截（TG 硬限 4096）；单群约 20 条/分钟，一次 10 条不会撞限。
HTML 被拒时自动退回纯文本重发。标题、链接来自站点索引与详情页，提取码从 `linkrow__code` 读，
链接按页面顺序排（夸克在前、百度在后），没有链接时写「暂无网盘链接」。

## 配置（`bot/config.json`）

| 字段 | 说明 |
|---|---|
| `common.site_url` | 站点地址 |
| `telegram.token` | BotFather 给的 token，留空则不启动 |
| `telegram.allowed_chats` | 只管这些群/频道；先用 `/id` 取回再填，留空表示哪都响应 |
| `telegram.allow_private` | 私聊是否响应（不受 `allowed_chats` 约束） |
| `telegram.reply_mode` | `group` 发群里；`private` 走私聊，群里只留一行回执 |
| `telegram.private_max_results` | 私发一次最多几条，默认 10 |
| `telegram.display_name` | 回执里可点的名字，留空自动用「助理 + bot first_name」 |
| `telegram.subscribe_url` | 结果尾部订阅频道，默认 `https://t.me/myquark` |
| `telegram.proxy` | 需要代理时填 `http://127.0.0.1:7890`；直连留空 |
| `telegram.poll_timeout` | 长轮询挂起秒数，默认 25 |
| `telegram.cooldown_seconds` / `global_rate_per_minute` | 单人冷却 / 全局每分钟上限 |
| `telegram.welcome_enabled` | 新成员入群自动发 `welcome-tg.txt` |
| `feishu.tg` | 失效反馈专用飞书应用凭据 |

模板见 `config.example.json`。建机器人：TG 里找 `@BotFather` 发 `/newbot` 拿 token，
再发 `/setcommands` 把指令菜单粘进去。

## 运行

进程 cwd 必须是 `bot/`（代码按相对路径找 `app/` 与 `logs/`）：

```
cd bot
python app\telegram\bot.py
```

- 日志：`logs/tg-YYYY-MM-DD.log`
- 开机自启：启动文件夹 `TG机器人开机自启.lnk` → `bot\TG机器人开机自启.vbs` → `菜单.vbs autostart-tg`
- 桌面控制台：`菜单.hta`（界面）+ `菜单.vbs`（实现），可启动 / 重启 / 结束 TG 进程
- 本地验证（不连 TG、不需要 token）：`python test_local.py`

⚠️ **同一时刻只允许一个实例**：`getUpdates` 是「谁取走算谁的」，两个实例会各收一半消息。
启动时抢 `logs/tg.lock` 排他锁，抢不到就退出并记日志。锁是按目录走的，换目录部署务必
「停旧 → 确认进程消失 → 再启新」。

⚠️ `.vbs` 文件是 GBK + CRLF（wscript 按系统 ANSI 代码页读，存 UTF-8 中文会花）；
`菜单.hta` 是 UTF-8。改完用 `python check_vbs.py` 粗检。

## 私聊投递（`reply_mode=private`）

群里只回「N 条结果已返回，请点击 助理小艾 查看」，结果发到提问者私聊，同样 10 条一批，
长结果按 900 字拆条、间隔 0.6 秒，撞 429 按 `retry_after` 重试。

Telegram 不允许机器人主动私聊从没点过 Start 的人（403）。首次会回落深链
`https://t.me/<bot>?start=<token>`，用户点一下进私聊后补发备好的结果（内存留 30 分钟，token 用一次即废）。
翻页状态按人记（`tg:u:<uid>`），群里 `/s` 后去私聊发 `/more` 能接着翻。
帮助、分类、报错、没命中这类短消息不走私聊，直接回群里。

## 排查

| 现象 | 原因 |
|---|---|
| 日志一直 `getUpdates 连不上` | 代理不通或网络异常；直连环境检查 `telegram.proxy` 是否被误填 |
| `409` | 同一 token 有两个实例在跑，先停旧的（本机 + VPS / 自启 + 手动各起一份常见） |
| 群里发指令没反应 | Bot 没进群、或群是频道、或 `allowed_chats` 没这个群 |
| 发出去是纯文本没有超链接 | 看日志「HTML 被拒」，多半标题有特殊字符 |
| 群里只回「点开助理小艾开通私聊」 | 提问者没和机器人私聊过，点一次 `?start=` 深链即可 |
| 私聊收不到结果 | 用户把机器人拉黑或删了对话 |

## 入群欢迎

源文件 `bot/welcome-tg.txt`（UTF-8），真人入群自动发，`/welcome` 可重发；改文件不用重启（按修改时间热加载）。
别家机器人入群不理。机器人要是群成员才能收到入群系统消息。

## 安全设计

1. 站点客户端只允许出站 `www.wodewangpan.top`，其他 host 直接拒绝
2. 站点查询只有 GET；唯一额外出站是 `/f` 反馈走飞书（凭据在 `config.json` / 环境变量，不入库）
3. 不读本地资源仓库（配置、日志、飞书临时 md 除外）
4. 群消息一律当不可信输入，只认白名单指令，未知斜杠指令直接回「没这条指令」
5. 关键词清洗只保留中文、字母、数字、空格和 `_.-`；`/f` 保留原文、最多 500 字，只进飞书卡片
6. 同一 message_id 只处理一次，防上报重试刷屏
7. 白名单 + 单人冷却 + 全局每分钟上限，三层限频

> 定时推送（Telegram 频道 / Bluesky）在 `push/`，由 QwenWork 调度，详见仓库根 `AGENTS.md`。
