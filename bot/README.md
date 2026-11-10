# wodewangpan 群机器人

群里发指令，查网盘索引站的资源，直接回网盘链接（夸克 / 百度，含提取码）。

- 数据来源只有一处：`https://www.wodewangpan.top`，只读，不碰本地资源仓库
- 代码放在本站仓库的 `bot/` 目录，跟站点共用一次 `git pull`，但**不参与站点构建**（`scripts/build.js` 只读 `theme/`、`static/` 等显式路径，不扫根目录）
- 零第三方依赖，只用 Python 标准库，不需要 `pip install`
- 通道走 NapCat + OneBot v11（HTTP 上报 + HTTP API），能正常发链接，不受官方机器人「不允许发 URL」限制
- 另带一条 Telegram 通道（`app/telegram_bot.py`），共用同一套查询与排版，见下方「Telegram 群」

## 链路

```
QQ 群 @机器人  →  NapCat  →  HTTP 上报 :6700  →  查站点  →  回群
```

## 指令

| 指令 | 作用 |
|---|---|
| `/搜索 关键词` | 查资源，回「名称 ｜ 类型」与各网盘链接（一次 3 条） |
| `/更多` | 接着看下一批 3 条 |
| `/最新` | 最近上架的 8 条 |
| `/今日` | 今天更新的资源，没有则显示最近一次更新 |
| `/分类` | 各分类资源数量 |
| `/随机` | 随机抽一条 |
| `/帮助` | 用法说明 |

别名：`/s`、`/搜`、`/找`、`/查`、`/search` 都等于 `/搜索`；`/more`、`/下一页`、`/next` 等于 `/更多`；`/new`、`/latest`、`/today`、`/categories`、`/random`、`/help` 同理。

**群里不用 @ 机器人**，直接以 `/` 开头发指令即可。@ 了之后只发裸关键词也能搜，例如 `青之箱`。
（裸关键词必须 @，否则群里正常聊天会被误当搜索，既刷屏又容易触发风控。开关见 `group_no_at_slash`。）
支持拼音：`qingzhixiang`、`qzx` 都能命中。

## 回复长什么样

资源名单独一行，网上每行一个网盘；资源之间不空行；末尾固定两行网站地址与帮助提示：

```
007：杀人执照 ｜ 电影
夸克网盘	https://pan.quark.cn/s/53d0d4c3382a
百度网盘（提取码 fw1j）	https://pan.baidu.com/s/1hhjstqN6mzFj6f13djyY6Q
权力的游戏 第八季 ｜ 电视剧
夸克网盘	https://pan.quark.cn/s/f97b92e8951c
命中 8 条，先给 3 条，发 /更多 看下一批
更多资源访问：https://www.wodewangpan.top
/帮助 — 查看指令表
```

- 网盘名与链接之间是一个制表符（`\t`），聊天窗口里读作两列
- 名称、类型、网盘名来自站点索引与详情页，提取码从详情页的 `linkrow__code` 读，跟在网盘名后面
- 链接按页面顺序排，夸克在前、百度在后；条目没有链接时写「暂无网盘链接」

**命中太多怎么办**：一次只回 3 条（`handlers.py` 的 `PAGE_SIZE`）。命中数超过 3 条时，末尾会补一句「命中 N 条，先给 3 条，发 /更多 看下一批」；`/更多` 按「群 / 私聊」分别记住上一次的关键词和已翻到的位置，只翻同一批结果，5 分钟后过期，群里几个人同时查也不会串页。

**关于富媒体**：试过 OneBot 的 `markdown` 段和 Ark 卡片（`json` 段）。markdown 被 QQ 内核拒绝（`sendMsg` 超时，普通 QQ 号没有签名权限）；Ark 卡片实际发出去了，但多数客户端提示「发送者版本过低，无法展示内容」。所以最终用纯文本，链接会被 QQ 自动识别成可点击。

## Telegram 群（可选）

同一套查询逻辑，另开一个 Telegram 通道。和 QQ 的差别：TG 支持 HTML 富文本，**网盘名本身就是可点的超链接**，正文里不再出现裸链接；没有风控、不用扫码、Bot 不会掉线。

```
TG 群 /s 关键词  →  Telegram Bot API（getUpdates 长轮询）  →  查站点  →  sendMessage 回群
```

### 1. 建机器人

在 TG 里找 `@BotFather`，发 `/newbot`，按提示起名，拿到形如 `123456789:AAxxxx` 的 token。顺手发一次 `/setcommands`，粘下面这段，群里打字就会出现指令菜单：

```
s - 查资源
more - 看下一批结果
latest - 最近上架
today - 今天更新
cats - 各分类条数
random - 随机一条
help - 指令说明
id - 看当前会话信息
```

### 2. 填配置

`config.json` 的 `telegram` 段：

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关 |
| `token` | BotFather 给的 token，留空则整个 TG 通道不启动 |
| `allowed_chats` | 只管群和频道。先用 `/id` 取回后回填，留空表示哪都响应 |
| `allow_private` | 默认 `true`。私聊是否响应。私聊**不受** `allowed_chats` 约束，否则群成员点深链进来会被丢掉 |
| `reply_mode` | `group` 结果发在群里；`private` 发到提问者私聊，群里只留一行回执。见 5.1 |
| `proxy` | 形如 `http://127.0.0.1:7890`。国内必须填，否则连不上 `api.telegram.org`；海外 VPS 留空即可 |
| `poll_timeout` | 长轮询挂起秒数，默认 25 |
| `cooldown_seconds` | 同一个人同一会话多少秒内只处理一次，默认 3 |
| `reply_to_any_text` | 默认 `false`。群隐私模式关掉后想让它对纯文本也响应，才改成 `true` |
| `welcome_enabled` | 默认 `true`。新成员入群时自动发 `welcome-tg.txt`，不想要就改 `false` |

也可以不改文件，用环境变量 `TG_PROXY` 覆盖代理。

### 3. 怎么跑

两种方式，同一份代码：

| 方式 | 命令 | 适用 |
|---|---|---|
| 跟随 QQ 机器人 | 双击桌面「启动QQ机器人」 | 本机常开；TG 作为后台线程跑在同一个进程里，桌面上的启动/重启/结束脚本一并管它 |
| 单独跑 | `python app/telegram_bot.py` | 放到海外 VPS，只跑 TG 不管 QQ |

配了 `token` 才会启动，没配就自动跳过，不影响 QQ 那边。日志写在 `logs/tg-YYYY-MM-DD.log`。

### 4. 指令差异

Telegram 的命令名只允许拉丁字符，`/搜索` 这类中文命令在群里打不出来，所以 TG 侧用：

| TG 指令 | 等价 |
|---|---|
| `/s 关键词` `/search` | `/搜索` |
| `/more` `/next` | `/更多` |
| `/latest` `/new` | `/最新` |
| `/today` | `/今日` |
| `/cats` `/categories` | `/分类` |
| `/random` | `/随机` |
| `/help` `/start` | `/帮助` |
| `/id` | 只在 TG 有：回 chat_id，用来填白名单 |
| `/welcome` `/公告` | 只在 TG 有：把入群欢迎语再发一遍 |

中文关键词照旧，`/s 神探狄仁杰` 正常。不带命令直接发关键词也能搜，但群里需要 @机器人（TG 客户端只把 `/命令`、@提及、回复它的消息推给 Bot，这是隐私模式的默认行为，不用改）。

### 5. 版式

```
007：杀人执照 ｜ 电影
夸克网盘
百度网盘（提取码 fw1j）
更多资源访问：www.wodewangpan.top
/帮助 — 查看指令表
```

第二、三行在客户端是可点的超链接，`tg_render.py` 把 handlers 输出的「网盘名<TAB>URL」转成 `<a href>`，QQ 的纯文本版式一点没改。HTML 被 TG 拒收（极少见）时会自动退回纯文本重发，保证用户一定收到。

单条上限 4096 字，实际按 3900 字截，比 QQ 的 900 字宽松；单群约 20 条/分钟，一次 3 条不会撞限。

### 5.1 私聊投递（`reply_mode`）

群里人多的时候，一次查询 3 条结果，几个人同时查就把屏幕刷满了。所以结果可以改走私聊：

| 值 | 行为 |
|---|---|
| `group` | 结果直接发在群里，和以前一样（`config.example.json` 里的默认值） |
| `private` | 结果发给提问者的私聊，群里只留一行「结果已私发，点这里打开私聊」加链接 |

**一条硬规则**：Telegram 不允许机器人主动私聊从没点过 Start 的人，这时 `sendMessage` 返回 403 `bot can't initiate conversation with a user`。所以第一次会遇到兜底流程：群里回一条 `https://t.me/<bot>?start=<token>` 深链，用户点一下进私聊，机器人从 `/start` 的参数里认出是谁，把当时备好的结果补发过去。用户只需开通一次，之后都不再需要这个动作。

- 备好的结果留在内存里 30 分钟（`_STASH_TTL`），token 用一次即废
- 翻页状态按**人**记（key 为 `tg:u:<uid>`），群里 `/s` 查出结果后，去私聊发 `/more` 能接着翻同一批
- 私聊一条都发不出去时才回落深链；发出去一半的会明确告知还剩几条

QQ 那边没做这个，因为 `send_private_msg` 要求对方是好友或能走群临时会话，可靠性远不如 TG。

### 6. 排查

| 现象 | 原因 |
|---|---|
| 日志一直 `getUpdates 连不上` | 代理不通。国内不配 `telegram.proxy` 必然如此 |
| `409` | 同一个 token 有两个实例在跑，先把旧的停掉（比如本机线程和 VPS 各跑一份） |
| 群里发指令没反应 | Bot 没进群、或群是「频道」、或 `allowed_chats` 里没这个群 |
| 发出去是纯文本没有超链接 | 看日志有没有「HTML 被拒」，多半是标题里有特殊字符，转义后重试即可 |
| 群里只回「结果已备好，点下面链接开通私聊」 | 提问者从没和机器人私聊过，TG 不给机器人主动私聊的权限。点一次那条深链即可，之后直接私发 |
| 私聊收不到结果 | 看日志有没有 `× 私发失败（uid ...）`，多半是用户把机器人拉黑或删了对话 |

### 7. 群公告文案

文案的**源文件是 `bot/welcome-tg.txt`**（UTF-8）。新人入群时机器人自动发这一份，也可以随时发 `/welcome` 让它重发一遍，方便重新置顶。改这个文件不用重启，下次触发时按文件修改时间热加载。

下面是当前内容的副本，改完记得同步这一节：

```
欢迎来到「网盘资源索引站」
影视、动漫、剧集、纪录片的夸克与百度网盘资源，都在这里。

群里直接发指令，不用 @ 机器人：

/s 关键词    查资源，回网盘链接
/more        接着看下一批
/latest      最近上架
/today       今天更新
/cats        各分类条数
/random      随便抽一条
/help        这份说明

一次回 3 条，接着看发 /more。

网站：https://www.wodewangpan.top
```

### 8. 新成员入群自动欢迎

| 行为 | 说明 |
|---|---|
| 真人入群 | 自动发 `welcome-tg.txt` 的内容，作为对该系统消息的回复 |
| 别家机器人入群 | 不理，避免互相打招呼刷屏 |
| 关掉这个功能 | `config.json` 的 `telegram.welcome_enabled` 改成 `false` |
| 手动补发 | 群里发 `/welcome`（也认 `/公告`） |

**坑**：机器人要能看到「有人入群」这条系统消息，得是群成员。隐私模式不影响入群消息的推送，这条能收到。如果完全没反应，先看日志里有没有 `有新成员入群`。

## 部署步骤

### 1. 装 Python

需要 Python 3.9 或更新版本，安装时勾选 Add to PATH。
装完在命令行执行 `python --version` 能出版本号即可。

### 2. 装 NapCat

1. 去 `https://github.com/NapNeko/NapCatQQ/releases` 下载 `NapCat.Shell.Windows.OneKey.zip`
2. 解压后运行 `NapCatInstaller.exe`。它会装一份**独立的 QQ**，不会动你现有的 QQ
3. 装完后启动 NapCat 里的 QQ，**用一个 QQ 小号扫码登录**（不要用主号）
4. 浏览器打开 `http://127.0.0.1:6099` 进 WebUI，token 见 `napcat/config/webui.json`

### 3. 配 NapCat 网络（关键）

在 WebUI 的「网络配置」里加两条：

**A. HTTP 服务器**，供本程序发消息用

| 项 | 值 |
|---|---|
| Host | `127.0.0.1` |
| Port | `3000` |
| Token | 留空，或自己定一串并同步到 config.json |

**B. HTTP 客户端（HTTP 上报）**，把群消息推给本程序

| 项 | 值 |
|---|---|
| URL | `http://127.0.0.1:6700/` |
| 消息格式 | `array`（重要，别选 string） |

两条都启用后保存。

### 4. 改配置

先复制一份本机配置（`config.json` 含真实群号，已 gitignore，不入库）：

```bash
cp config.example.json config.json
```

然后打开 `config.json`：

```json
{
  "site_url": "https://www.wodewangpan.top",
  "listen_host": "127.0.0.1",
  "listen_port": 6700,
  "napcat_api": "http://127.0.0.1:3000",
  "access_token": "",
  "group_whitelist": [],
  "allow_private": true,
  "cooldown_seconds": 3,
  "global_rate_per_minute": 20,
  "reply_at_sender": false
}
```

| 字段 | 说明 |
|---|---|
| `group_whitelist` | 只响应这些群号。留空表示所有群都响应，**首次跑通后建议填上群号** |
| `group_no_at_slash` | 群里以 `/` 开头的消息免 @ 直接执行，默认 `true`。设为 `false` 就恢复「必须 @」 |
| `cooldown_seconds` | 同一个人在同一个群，多少秒内只能查一次，防刷屏。默认 3 秒；设太大会出现「发完 /帮助 接着查词没反应」，日志里写着 `限频忽略` |
| `global_rate_per_minute` | 全机器人每分钟最多回多少条，防炸群 |
| `reply_at_sender` | 回复时是否 @ 提问的人，默认关闭 |
| `access_token` | 与 NapCat HTTP 服务器的 Token 保持一致，都空也可以 |

### 5. 启动

双击 `启动.bat`，能看到日志窗口。启动时会预热索引，日志有这行就说明通了：

```
索引预热完成：963 条，963 条有网盘链接，用时 2.2s
```

浏览器打开 `http://127.0.0.1:6700/` 能看到状态 JSON。

### 6. 拉进群测试

1. 用那个小号 QQ 加入你的资源群，群设置里设成管理员（可选）
2. 在群里**直接发** `/搜索 青之箱`（不用 @），或者 @ 机器人后只发 `青之箱`
3. 正常会回资源名、类型、网盘名和三行内的链接

### 7. 开机自启

用 `开机自启.vbs`：开机后先等 25 秒（避开通开机高峰、让网络和磁盘就绪），然后**先拉 NapCat、再拉机器人**，已经在跑的就跳过，全程不弹窗。

按 `Win + R` 输入 `shell:startup` 回车，把 `开机自启.vbs` 复制进那个文件夹（本机已放成 `QQ机器人开机自启.vbs`）。

- 每次启动动作都记在 `logs/auto-start.log`（例：`已拉起 NapCat；已启动机器人`）
- **NapCat 不用再单独设自启**，这个脚本会一起拉起。若 NapCat 自己的设置里也开了开机自启，两边可能同时起两份，建议只留脚本这一条
- NapCat 路径写死在 `NAPCAT_EXE`，挪了目录要改；找不到就只启动机器人并在日志里记一笔
- 启动文件夹里那份是 GBK 编码的独立副本，改了 `bot/开机自启.vbs` 记得同步一份过去

**改了代码怎么生效**：双击 `重启QQ机器人.vbs` 即可。它会先结束旧的 `bot.py` 进程，再静默拉起新的，不用去任务管理器手动杀进程（Python 没有热加载）。脚本里 `PYW` 写死了 `Python312\pythonw.exe` 的绝对路径，避免 PATH 里有多份 Python 时起错或同时起两个实例；换 Python 版本记得改这一行（找不到就自动回落到 `pythonw`）。

### 8. 桌面快捷操作

四个脚本都在 `bot/` 目录里，把前三个复制一份到桌面就能双击用（本机已放）：

| 脚本 | 作用 |
|---|---|
| `启动QQ机器人.vbs` | 没在跑就静默拉起；**NapCat 没在跑也一起拉起** |
| `重启QQ机器人.vbs` | 结束旧进程再拉起，改完代码用这个；同样会补拉 NapCat |
| `结束QQ机器人.vbs` | 只结束命令行含 `bot.py` 的进程，不动其它 Python，也不动 NapCat |
| `开机自启.vbs` | 开机延迟 25 秒，先拉 NapCat 再拉机器人，放「启动」文件夹，见上一节 |

脚本会先按自己所在目录找 `app\bot.py`，找不到才回落到写死的仓库路径，所以同一份文件「在仓库里双击」和「复制到桌面双击」都能用。

判断 NapCat 在不在，看进程名里有没有 `napcat` 或 `QQ.exe`。缺失时弹窗会明确写「已顺带拉起」，不再只是提醒你去手动开。

**编码**：这几个 `.vbs` 按 GBK 保存，双击时中文弹窗才不乱码，代价是在 GitHub 网页上看中文是乱码，属正常现象。用记事本改完请存成 ANSI，别存成 UTF-8，否则弹窗会花。

## 不用 NapCat 时如何验证

```bash
python test_local.py      # 验证指令与查询，直接打印回复内容
python test_dispatch.py   # 验证 @ 识别、去重、限频、群白名单
```

两个脚本都不需要 QQ 登录，`test_dispatch.py` 会把要发出的消息拦下来打印。

## 安全设计

这台机器人在一个有完整文件权限的系统上跑，所以按最小权限写死：

1. 只允许出站到 `www.wodewangpan.top` 一个域名，代码里任何其他 host 都直接拒绝
2. 只有 GET 请求，没有写操作
3. 不读取本地资源仓库，不打开任何本地文件（配置和日志除外）
4. 群消息一律当不可信输入，只认白名单指令，未知斜杠指令直接回「没这条指令」
5. 关键词清洗只保留中文、字母、数字、空格和 `_.-`
6. 同一 message_id 只处理一次，防止上报重试刷屏
7. 群白名单 + 单人冷却 + 全局每分钟上限，三层限频

## 常见问题

**群里 @ 了没反应**
先看 `logs/` 里当天的日志。没有 `→` 行说明 NapCat 的上报没过来，检查 HTTP 客户端那条 URL 和端口；有 `→` 但没 `←` 说明查询卡住或报错。

**日志出现「NapCat API 连不上」**
NapCat 的 HTTP 服务器没启动，或端口不是 3000。打开 NapCat WebUI 确认那条配置已启用。

**回复发出去了但群里看不到链接**
大概率被 QQ 风控吞了。降低频率（调大 `cooldown_seconds`），或把单次返回条数改小（`handlers.py` 里的 `PAGE_SIZE`）。

**机器人掉线**
NapCat 依赖它自己那份 QQ 客户端，QQ 一退出就掉。检查那份 QQ 是否还在线。

**NapCat WebUI 输 token 提示「token is invalid」**
`config/webui.json` 带了 UTF-8 BOM，NapCat 的 `JSON.parse` 直接抛 `Unexpected token '﻿'`，于是整份配置被丢弃，token 和 `autoLoginAccount` 全部失效，它改用一个随机 token。启动日志里能看到两行证据：

```
读取配置文件失败 SyntaxError: Unexpected token '﻿'
[WebUi] WebUi Token: 063fb2f2fd3f     ← 不是配置文件里那个
```

修法是把 BOM 去掉（存成无 BOM 的 UTF-8）。用 PowerShell 的 `Out-File`、部分编辑器「另存为 UTF-8」都会加 BOM，改完务必确认前三个字节不是 `EF BB BF`。当前 token 是 `wodewangpan2026`。

**每次启动都要扫码**
`NapCatWinBootMain.exe` 支持带账号参数走快速登录：`NapCatWinBootMain.exe 909008620`。三个 vbs 里的 `QQUIN` 常量就是干这个的，改账号只改那一行。前提是那份 QQ 数据目录里还留着登录凭证（`Documents\Tencent Files\<QQ号>` 没被清）。走二维码登录时启动日志会有「没有 -q 指令指定快速登录」这句。

**会不会封号**
会，协议端是真实 QQ 号，高频发外链是主要风险。所以用小号、控频率、别在多个群同时炸。真被限制了换号即可，代码不用改。

**和之前 WorkBuddy 那个 `/s` 技能冲突吗**
不冲突。那是另一个 QQ 账（官方机器人），群里 @ 谁就是谁响应，可以留着当备份。
