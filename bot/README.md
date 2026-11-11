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
| `/搜索 关键词` | 查资源，回「名称 ｜ 类型」与各网盘链接（按最新排，一次最多 10 条） |
| `/更多` | 接着看下一批 10 条 |
| `/最新` | 最近上架的 10 条 |
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
命中 442 条，先给 10 条，发 /更多 看下一批
更多资源访问：https://www.wodewangpan.top
/帮助 — 查看指令表
```

- 网盘名与链接之间是一个制表符（`\t`），聊天窗口里读作两列
- 名称、类型、网盘名来自站点索引与详情页，提取码从详情页的 `linkrow__code` 读，跟在网盘名后面
- 链接按页面顺序排，夸克在前、百度在后；条目没有链接时写「暂无网盘链接」

**命中太多怎么办**：群里一次最多回 10 条（`handlers.py` 的 `PAGE_SIZE`），命中按**上架日期从新到旧**排，先给最新的 10 条。命中数超过 10 条时，末尾会补一句「命中 N 条，先给 10 条，发 /更多 看下一批」；`/更多` 按「群 / 私聊」分别记住上一次的关键词和已翻到的位置，只翻同一批结果，5 分钟后过期，群里几个人同时查也不会串页。TG 侧开了私聊投递也是 10 条一批（见 5.1）。

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
| `embedded` | 默认 `false`：TG 跑独立进程，QQ 那边不管它。设 `true` 则回到「QQ 进程里顺带跑 TG 线程」的老模式，省一个进程但会一起生死 |
| `token` | BotFather 给的 token，留空则整个 TG 通道不启动 |
| `allowed_chats` | 只管群和频道。先用 `/id` 取回后回填，留空表示哪都响应 |
| `allow_private` | 默认 `true`。私聊是否响应。私聊**不受** `allowed_chats` 约束，否则群成员点深链进来会被丢掉 |
| `reply_mode` | `group` 结果发在群里；`private` 发到提问者私聊，群里只留一行「N 条结果已返回，请点击 助理小艾 查看」。见 5.1 |
| `display_name` | 回执里那个可点的名字，留空则自动用「助理 + 机器人 first_name」（现在是「助理小艾」） |
| `private_max_results` | 私发一次最多给几条，默认 `10`，和群里一致；命中超过这个数会在末尾提示可以发 `/more` 接着要。填 `0` 表示不限条数（极端关键词会很啰嗦，慎用） |
| `proxy` | 形如 `http://127.0.0.1:7890`。国内必须填，否则连不上 `api.telegram.org`；海外 VPS 留空即可 |
| `poll_timeout` | 长轮询挂起秒数，默认 25 |
| `cooldown_seconds` | 同一个人同一会话多少秒内只处理一次，默认 3 |
| `reply_to_any_text` | 默认 `false`。群隐私模式关掉后想让它对纯文本也响应，才改成 `true` |
| `welcome_enabled` | 默认 `true`。新成员入群时自动发 `welcome-tg.txt`，不想要就改 `false` |

也可以不改文件，用环境变量 `TG_PROXY` 覆盖代理。

### 3. 怎么跑

**默认是独立进程**：TG 和 QQ 各跑各的，互不拖累。两种方式，同一份代码：

| 方式 | 命令 | 适用 |
|---|---|---|
| 独立进程（默认） | 双击桌面「启动TG机器人」，或 `python app/telegram_bot.py` | 本机常开。TG 单独一个进程，QQ 重启、NapCat 掉线、QQ 掉登录都不影响它 |
| 内嵌进 QQ 进程 | `config.json` 里 `telegram.embedded` 设成 `true` | 想省一个进程时用。代价是 QQ 那边重启/崩溃会连带 TG 一起停 |
| 放到海外 VPS | `python app/telegram_bot.py` | 本机不开机也要 TG 在跑 |

配了 `token` 才会启动，没配就自动跳过，不影响 QQ 那边。日志写在 `logs/tg-YYYY-MM-DD.log`。

**同一时刻只能有一个 TG 进程**：Telegram 的 `getUpdates` 是「谁取走算谁的」，两个实例同时跑会各收一半消息。所以 `telegram_bot.py` 启动时会去抢 `logs/tg.lock` 的排他锁，抢不到就直接退出并在日志里留一句「已经有另一个 Telegram 进程在跑」。进程崩了或被强杀，系统会自动释放这把锁，不用手动清理。

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

第二、三行在客户端是可点的超链接，`tg_render.py` 把 handlers 输出的「网盘名<TAB>URL」转成 `<a href>`，QQ 的纯文本版式一点没改。
想在正文任意位置放一个自定义链接文字的超链接，写成 `[文字](https://...)` 即可，渲染时转成 `<a href>`，文字与网址都会做 HTML 转义；HTML 被拒退回纯文本时，会还原成「文字（网址）」。HTML 被 TG 拒收（极少见）时会自动退回纯文本重发，保证用户一定收到。

单条上限 4096 字，实际按 3900 字截，比 QQ 的 900 字宽松；单群约 20 条/分钟，群里一次 10 条（拆成 2 条消息左右）不会撞限。走私聊投递时报文都落在私聊，不占群的额度。

### 5.1 私聊投递（`reply_mode`）

群里人多的时候，几个人同时查就把屏幕刷满了。所以结果可以改走私聊：

| 值 | 行为 |
|---|---|
| `group` | 结果直接发在群里，和以前一样（`config.example.json` 里的默认值） |
| `private` | 结果发给提问者的私聊，群里只回一行「12 条结果已返回，请点击 **助理小艾** 查看。」，其中「助理小艾」是指向 `https://t.me/<bot>` 的超链接 |

**私发同样是 10 条一批**：和群里保持一致，只是投递渠道换成私聊，一次给 10 条（`private_max_results` 可调，默认 10，填 0 为不限）。命中多于这个数时，最后一条会带「命中 442 条，先给 10 条，发 /more 看下一批」，`/more` 每按一次再给 10 条，翻到底为止。

长结果按 900 字拆成多条私信依次发，条与条之间隔 0.6 秒；撞上 TG 的 429 限频会按它给的 `retry_after` 等一下重试，不会丢条。

**一条硬规则**：Telegram 不允许机器人主动私聊从没点过 Start 的人，这时 `sendMessage` 返回 403 `bot can't initiate conversation with a user`。所以第一次会遇到兜底流程：群里回一条 `https://t.me/<bot>?start=<token>` 深链，用户点一下进私聊，机器人从 `/start` 的参数里认出是谁，把当时备好的结果补发过去。用户只需开通一次，之后都不再需要这个动作。

- 备好的结果留在内存里 30 分钟（`_STASH_TTL`），token 用一次即废
- 翻页状态按**人**记（key 为 `tg:u:<uid>`），群里 `/s` 查出结果后，去私聊发 `/more` 能接着翻同一批
- 先私发第一条探路：通了就在群里贴回执、接着把剩下的发完；一条都发不出去才回落深链
- 帮助、分类、报错、没命中这类短消息**不走私聊**，直接回在群里，省得来回切窗口

QQ 那边没做这个，因为 `send_private_msg` 要求对方是好友或能走群临时会话，可靠性远不如 TG。

### 6. 排查

| 现象 | 原因 |
|---|---|
| 日志一直 `getUpdates 连不上` | 代理不通。国内不配 `telegram.proxy` 必然如此 |
| `409` | 同一个 token 有两个实例在跑，先把旧的停掉（比如本机一个、VPS 一个，或者自启与手动各起了一份）。本机有 `logs/tg.lock` 排他锁兜着，第二个实例会自己退出并在日志里写明 |
| 群里发指令没反应 | Bot 没进群、或群是「频道」、或 `allowed_chats` 里没这个群 |
| 发出去是纯文本没有超链接 | 看日志有没有「HTML 被拒」，多半是标题里有特殊字符，转义后重试即可 |
| 群里只回「结果已备好，请点开助理小艾开通私聊」 | 提问者从没和机器人私聊过，TG 不给机器人主动私聊的权限。点一次那个链接（带 `?start=` 的深链）即可，之后直接私发 |
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

一次最多回 10 条，接着看发 /more。

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
  "reply_at_sender": false,
  "napcat_watchdog": {
    "enabled": true,
    "interval_seconds": 300,
    "down_strikes": 2,
    "realert_minutes": 30
  }
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
| `napcat_watchdog.enabled` | NapCat 看门狗开关，默认开。掉线走飞书提醒（见下方「NapCat 看门狗」） |
| `napcat_watchdog.interval_seconds` | 探活间隔，默认 300 秒（5 分钟） |
| `napcat_watchdog.down_strikes` | 连挂几次算掉线，默认 2（5 分钟一探即约 10 分钟确认） |
| `napcat_watchdog.realert_minutes` | 一直掉线时每隔几分钟再催一次，默认 30 |

#### NapCat 看门狗（掉线飞书提醒）

QQ 反复掉登录（NapCat 只有登录成功才开 OneBot 端口），掉的时候群里没反应，但往往要等发现「群里怎么不理人」才知道。看门狗后台线程定期探活，掉线第一时间走飞书推送（本机器人专用脚本 `bot/scripts/notify-feishu.mjs`，发给本人 P2P；与院采雷达的采集简报脚本互不混用）：

- **判定掉线**：连挂 `down_strikes` 次（默认 2 次，5 分钟一探即约 10 分钟确认），避免重启窗口期误报
- **启动就一直连不上**：放宽到 10 次（约 50 分钟）才报，QQ 正常登录只要几十秒
- **一直掉着**：每隔 `realert_minutes`（默认 30 分钟）再催一次，不刷屏
- **恢复**：自动报平安，附掉线时长
- **卡片样式**：markdown 首行作卡片标题，掉线告警橙色头（`--level warn`）、恢复报平安绿色头（`--level ok`）
- 提醒内容带恢复办法（双击桌面「QQ扫码登录.vbs」扫码）；推送失败只记日志，不影响机器人本体
- 自检：`python test_watchdog.py`（含一条真实测试推送）

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

两个自启脚本，互不依赖，各管一半：

| 脚本 | 管什么 | 行为 |
|---|---|---|
| `开机自启.vbs` | QQ | 等 25 秒，先拉 NapCat、再拉 `bot.py`，已在跑就跳过 |
| `TG机器人开机自启.vbs` | Telegram | 等 25 秒，拉起 `app\telegram_bot.py` 独立进程，已在跑就跳过 |

按 `Win + R` 输入 `shell:startup` 回车，把两个都复制进那个文件夹（本机已放成 `QQ机器人开机自启.vbs` 和 `TG机器人开机自启.vbs`）。

- 每次启动动作都记在 `logs/auto-start.log`（TG 那行带 `[TG]` 前缀），两个脚本写同一个文件，看时间就能对上
- **NapCat 不用再单独设自启**，QQ 那个脚本会一起拉起。若 NapCat 自己的设置里也开了开机自启，两边可能同时起两份，建议只留脚本这一条
- NapCat 路径写死在 `NAPCAT_EXE`，挪了目录要改；找不到就只启动机器人并在日志里记一笔
- 启动文件夹里那两份是 GBK 编码的独立副本，改了 `bot/` 里的记得同步一份过去

**改了代码怎么生效**：QQ 侧双击 `重启QQ机器人.vbs`，TG 侧双击 `重启TG机器人.vbs`。各自只结束自己那个进程，不会互相牵连（判断进程时会刻意排除 `telegram_bot.py`，否则 `bot.py` 这个子串会误杀 TG）。Python 没有热加载，只能重启。脚本里 `PYW` 写死了 `Python312\pythonw.exe` 的绝对路径，避免 PATH 里有多份 Python 时起错或同时起两个实例；换 Python 版本记得改这一行（找不到就自动回落到 `pythonw`）。

### 8. 桌面快捷操作

脚本都在 `bot/` 目录里，复制一份到桌面就能双击用（本机已放）：

| 脚本 | 作用 |
|---|---|
| `启动QQ机器人.vbs` | 没在跑就静默拉起；**NapCat 没在跑也一起拉起** |
| `重启QQ机器人.vbs` | 结束旧进程再拉起，改完代码用这个；同样会补拉 NapCat；等 `:3000` 就绪才报成功 |
| `结束QQ机器人.vbs` | 只结束命令行含 `bot.py` 的进程（排除 `telegram_bot.py`），不动其它 Python，也不动 NapCat |
| `开机自启.vbs` | 开机延迟 25 秒，先拉 NapCat 再拉机器人，放「启动」文件夹，见上一节 |
| `启动TG机器人.vbs` | 拉起 TG 独立进程，已在跑就提示不要重复启动 |
| `重启TG机器人.vbs` | 只重启 TG：结束旧进程 → 等锁释放 → 启动 → 读日志确认成功 |
| `结束TG机器人.vbs` | 只结束 `telegram_bot.py`，QQ 那边一点不动 |
| `TG机器人开机自启.vbs` | TG 侧的开机自启，与 QQ 那条互不依赖 |

**机器人控制台（推荐入口）**：桌面快捷方式指向仓库里的 `bot/菜单.vbs`，双击弹出大字号菜单——QQ / TG 分组列出 7 个动作，点按钮或输入 1-7 执行，Esc 退出。界面在同目录的 `菜单.hta`（系统自带 `mshta.exe`，不用装东西），`菜单.vbs` 只负责启动它和命令行直连（`菜单.vbs 3` = 结束QQ机器人，不弹窗）。原来的系统 `InputBox` 菜单留作兜底：找不到 `mshta.exe` 或 `菜单.hta` 时自动回落；想回到旧界面，把 `菜单.hta` 改名即可。两个文件必须放同一目录。

脚本会先按自己所在目录找 `app\bot.py`，找不到才回落到写死的仓库路径，所以同一份文件「在仓库里双击」和「复制到桌面双击」都能用。

判断 NapCat 在不在，看进程名里有没有 `napcat` 或 `QQ.exe`。缺失时弹窗会明确写「已顺带拉起」，不再只是提醒你去手动开。

**编码**：三类文件三套口径，别混：

- `.vbs`：GBK + CRLF。`wscript.exe` 按系统 ANSI 代码页读脚本，存成 UTF-8 中文弹窗就花；代价是 GitHub 网页上看是乱码。用记事本改完请存成 ANSI。
- `.bat`（`启动.bat`、`一键启动.bat`）：UTF-8 + 文件内 `chcp 65001`。`app/bot.py` 把 stdout 强制设成 UTF-8，控制台必须留在 65001，把 bat 改成 GBK 会让机器人日志乱码。用记事本改完请存成 UTF-8，别存成 ANSI。
- `菜单.hta`：UTF-8（HTML 里声明了 `charset=utf-8`），macOS / Windows / GitHub 网页看都正常，别存成 ANSI 或 UTF-16。

两端 VS Code 的按语言编码设置见仓库根 `.vscode/settings.json`：`.vbs` → `gbk`，`.bat` → `utf8`。

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
大概率被 QQ 风控吞了。降低频率（调大 `cooldown_seconds`），或把单次返回条数改小（`handlers.py` 里的 `PAGE_SIZE`，现为 10）。

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
NapCat 现用 **Shell v4 独立版**（`C:\Users\marco\Downloads\NapCatOneKey\NapCat.Shell.v4`，NapCat 4.18.42，2026-11-11 起替代旧 OneKey 包：旧版取码域名 `ssl.qq.com` 被腾讯停用导致无法登录）。`napcat.bat -q 909008620` 走快速登录；登录态失效时控制台直接画二维码，同时存到 `napcat\cache\qrcode.png`。OneBot 网络配置在 `NapCat.Shell.v4\napcat\config\onebot11_<uin>.json`（HTTP 服务 :3000、上报 127.0.0.1:6700）。三个 vbs 里的 `QQUIN` 常量就是干这个的，改账号只改那一行。前提是那份 QQ 数据目录里还留着登录凭证（`Documents\Tencent Files\<QQ号>` 没被清）。走二维码登录时启动日志会有「没有 -q 指令指定快速登录」这句。

**会不会封号**
会，协议端是真实 QQ 号，高频发外链是主要风险。所以用小号、控频率、别在多个群同时炸。真被限制了换号即可，代码不用改。

**和之前 WorkBuddy 那个 `/s` 技能冲突吗**
不冲突。那是另一个 QQ 账（官方机器人），群里 @ 谁就是谁响应，可以留着当备份。
