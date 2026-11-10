# wodewangpan 群机器人

群里发指令，查网盘索引站的资源，直接回网盘链接（夸克 / 百度，含提取码）。

- 数据来源只有一处：`https://www.wodewangpan.top`，只读，不碰本地资源仓库
- 代码放在本站仓库的 `bot/` 目录，跟站点共用一次 `git pull`，但**不参与站点构建**（`scripts/build.js` 只读 `theme/`、`static/` 等显式路径，不扫根目录）
- 零第三方依赖，只用 Python 标准库，不需要 `pip install`
- 通道走 NapCat + OneBot v11（HTTP 上报 + HTTP API），能正常发链接，不受官方机器人「不允许发 URL」限制

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
  "cooldown_seconds": 15,
  "global_rate_per_minute": 20,
  "reply_at_sender": false
}
```

| 字段 | 说明 |
|---|---|
| `group_whitelist` | 只响应这些群号。留空表示所有群都响应，**首次跑通后建议填上群号** |
| `group_no_at_slash` | 群里以 `/` 开头的消息免 @ 直接执行，默认 `true`。设为 `false` 就恢复「必须 @」 |
| `cooldown_seconds` | 同一个人在同一个群，多少秒内只能查一次，防刷屏 |
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

按 `Win + R` 输入 `shell:startup` 回车，把 `后台启动.vbs` 的快捷方式丢进去。
注意 NapCat 也要随机器启动，在 NapCat 设置里勾选开机自启。

**改了代码怎么生效**：双击 `后台启动.vbs` 即可。它会先结束旧的 `bot.py` 进程，再静默拉起新的，不用去任务管理器手动杀进程（Python 没有热加载）。脚本里 `PYW` 写死了 `Python312\pythonw.exe` 的绝对路径，避免 PATH 里有多份 Python 时起错或同时起两个实例；换 Python 版本记得改这一行（找不到就自动回落到 `pythonw`）。

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

**会不会封号**
会，协议端是真实 QQ 号，高频发外链是主要风险。所以用小号、控频率、别在多个群同时炸。真被限制了换号即可，代码不用改。

**和之前 WorkBuddy 那个 `/s` 技能冲突吗**
不冲突。那是另一个 QQ 账（官方机器人），群里 @ 谁就是谁响应，可以留着当备份。
