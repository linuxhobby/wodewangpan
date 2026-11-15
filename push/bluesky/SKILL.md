---
name: wodewangpan-bluesky
description: 把 wodewangpan 资源站（www.wodewangpan.top）的资源发到 Bluesky，带海报图、夸克网盘 + 百度网盘分享链接（含提取码）和资源简介。当用户说"发 Bluesky""推送网盘资源到 Bluesky""Bluesky 发帖""资源站社媒同步"时使用；也覆盖定时推送的编排（每 1 小时一条、全天 24 小时轮转，自动化 id f9355e9c-86ed-424a-a286-2731684d7578）。
version: "1.2"
---

# wodewangpan → Bluesky 发帖

一条资源 = 一条 Bluesky 帖子：**海报图（embed images）+ 夸克网盘链接 + 百度网盘链接（有就带上，含提取码）+ 站点详情页链接 + 简介 + 话题标签**。所有素材都取自仓库，不联网编造。

## 前置

| 项 | 位置 |
|---|---|
| 凭据 | `push/bluesky/wodewangpan-bluesky.env`（`BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` / `BLUESKY_PDS` / `REPO` / `SITE_URL`）——**本机专用，绝不进 git，也不要打印到对话**。2026-11-12 随仓库重构迁入 `push/bluesky/`，脚本查找顺序：同目录 → `~/.workbuddy/`（老环境回退） |
| 已发记录 | `~/.workbuddy/bluesky-posts/posted.json` —— 去重唯一依据，**勿删**，删了会重发 |
| 数据源 | `C:/Users/marco/Github/wodewangpan` 的 `data/*.yaml`（id / title / category / **quark_url** / **baidu_url + baidu_pwd** / description / date / image） |
| 图片 | `static/images/<slug>/<image>`（2026-11-15 起站点配图按分类 slug 分子目录，mv→movie、tv→tv、dc→documentary、an→anime、game→game、app→software、bk→ebook、cs→course、ot→misc；脚本已适配，`common.mjs` 的 `imgPath` 带 flat 回退），全部 < 260KB（Bluesky blob 上限 1MB，目前无压缩需求） |

## 用法

```bash
node push/bluesky/bluesky-post.mjs --dry   # 只打印文案与选中条目，不发帖
node push/bluesky/bluesky-post.mjs         # 发一条
node push/bluesky/bluesky-post.mjs --count 3          # 补发多条
node push/bluesky/bluesky-post.mjs --pick mv-248      # 指定条目（可重复传，忽略已发记录）
node push/bluesky/bluesky-post.mjs --strategy latest|weighted|rotate|random   # 默认 latest（按 added 倒序，新入库优先）
node push/bluesky/bluesky-post.mjs --no-site-link     # 正文不带站点详情页链接
node push/bluesky/bluesky-post.mjs --require-image    # 只发有海报的（默认无海报也发，纯文本帖）
node push/bluesky/bluesky-post.mjs --audit            # 打印不可发条目的原因分布，排查去重用
```

## 去重口径（用户定死，2026-10-10 修订）：**只认夸克分享链接或百度分享链接**

| 情况 | 处理 |
|---|---|
| 夸克链接相同 **或** 百度链接相同 | **同一份资源**，发过就不再发 |
| 标题相同但链接都不同 | **照发**（同系列电影、同一部剧的不同季都属于这种，它们是不同资源） |
| 两条链接都为空的条目 | 不参与链接去重，按 id 判重 |

不要用标题去重 —— 系列电影、多季剧集标题本来就相近，按标题判重会误杀大量正常资源。

发过的每条都在 `~/.workbuddy/bluesky-posts/posted.json` 留标记 `{at, uri, cid, category, title, titleNorm, quark, baidu, text}`；老记录缺字段时脚本启动自动回填（`quark` / `baidu` / `titleNorm` 都会补），不留缺口。

**无海报条目照发**（用户 2026-10-06 要求）：站里有 52 条软件类老条目没有 `image` 字段，默认**照样发**，只是不带图（纯文本帖：文字 + 链接 + 标签）。想只发带图的加 `--require-image`。

- 百度链接覆盖率（2026-10-24 实测）：全站 795 条里 **623 条有** `baidu_url` + `baidu_pwd`，**172 条没有**（约占 21.6%，主要是 2026-10-19 之后新增的动漫 / 电影 / 电视剧 / 纪录片 / 电子书 / 操作系统 / 其他批次，以及 `mv-335`、`tv-129` 等老条目）。缺 `baidu_url` 的条目**只发夸克行，这是预期行为**，不是脚本 bug；核对前先 `grep baidu_url data/*.yaml` 或直接读该条目，别按「只有 3 条例外」的旧结论判定失败。
- `--audit` 可打印不可发条目的原因分布，排查用。

**默认 `latest`：最新入库优先**（用户 2026-11-15 要求）。读全站 `data/*.yaml` 的 `added`，按时间倒序取还没发过的第一条；`added` 相同（同一批入库）时按 id 数值倒序。新资源一入库就排到队首、下一轮优先发，不会压在几百条老资源后面。`added` 覆盖率 100%（现 1040 条），格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM`，字符串倒序即时间倒序。全部发完报「没有新条目可发」并停止。

**备选 `weighted`：按分类剩余量加权随机**（`--strategy weighted`，2026-11-15 之前是默认）。做法是**按各分类剩余可发条数加权随机**选一个分类，再在该分类内随机挑一条：

| 分类 | 库存 | 占比 |
|---|---|---|
| 电影 | 317 | 48.8% |
| 电视剧 | 121 | 18.6% |
| 软件 | 115 | 17.7% |
| 纪录片 | 72 | 11.1% |
| 游戏 | 8 | 1.2% |
| 电子书 | 6 | 0.9% |
| 操作系统 | 6 | 0.9% |
| 其他 | 3 | 0.5% |
| 动漫 | 1 | 0.2% |

（2026-10-10 历史数据，已发 40 / 剩余 649 / 全站 689；数字会随发帖和入库漂移，脚本实时算，不用手改。）

效果：库存多的分类出现得多，小分类也始终有机会露脸；某个分类发完权重自动归零、不再被选中。运行时会打印 `随机选中分类：电视剧（剩余 121 条，权重 18.6%）`，方便核对。

分类不写死：以数据里实际出现的 `category` 为准，`CAT_ORDER` 只决定展示顺序，站里新增分类（如「操作系统」）会自动纳入，不用回来改代码。

其余策略：`rotate`（固定顺序轮转 电影→电视剧→纪录片→动漫→游戏→软件→电子书→其他，取该分类编号最小的一条）、`random`（不分分类，直接在全部未发条目里均匀随机）。`--pick <id>` 可强制指定（此时忽略去重，仅用于补发特定条目）。

## 帖子结构

```
【电影】搏击俱乐部（1999）
<description，超长自动截断加 …>

详情：https://www.wodewangpan.top/movie/mv-075/
订阅TG：https://t.me/myquark ，关注更多资源
夸克网盘：https://pan.quark.cn/s/xxxx
百度网盘：https://pan.baidu.com/s/xxxx（提取码 wt7p）
#网盘资源 #电影 #动作
```

- 2026-11-15 版式（指挥官定）：**详情行提到链接区第一行**，其后订阅TG、夸克、百度。
- 标签规则（2026-11-15 指挥官定，三个）：`#资源名 #分类 #网盘`。资源名由标题清洗得出（去括号内容 → 砍「 - 」/`|` 副标题 → 砍中文逗号后的解释 → 只留字母数字 → 最多 14 字），如 `指环王3：王者无敌` → `#指环王3王者无敌`；分类取 `category`；网盘标签按条目实际链接走（有夸克 `#夸克网盘`，只有百度 `#百度网盘`）。三者重名会自动去重。
- 2026-11-12 版式来源：`订阅TG` 行指向 TG 订阅号 `@myquark`，替换掉 11-10 加的
  `加入TG群组：https://t.me/wodewangpantop`。所有链接统一保留 `https://` 前缀（facet 直接可点）。
- 上限 300 graphemes。放不下时**只砍简介，绝不动链接**；简介额度被压到 60 字以下（`MIN_DESC`）就先让出「详情」行，把额度还给简介 —— 两条网盘链接、订阅TG 行和标签永远保留，URL 永不截断。
- 百度行只在条目**有** `baidu_url` 时出现（2026-10-24：795 条里 623 条有，缺的不补发百度行）；有 `baidu_pwd` 就紧跟一个 `（提取码 xxxx）`，没有就只给链接。
- **字段名坑（2026-11-15 修）**：站点 `data/*.yaml` 里提取码字段叫 `baidu_pwd`（588 条全部如此，没有 `baidu_code`）。`push/common.mjs` 原来只读 `baidu_code`，导致百度行长期丢提取码；现改为 `baidu_code || baidu_pwd`，两个名字都认。核对时以 `baidu_pwd` 为准。
- **链接卡（OG 卡）**：Bluesky 的 PDS **不会**自己抓站点 OG，纯文本里的链接不会自动变卡片。要出卡片必须显式发 `app.bsky.embed.external`，`uri/title/description` 全由脚本填。`--embed auto`（默认）有海报发图片卡、无海报发详情页链接卡；`--embed external` 强制链接卡；`--embed image` 强制图片卡。一条帖只能有一个 embed，图片卡与链接卡不能同时要。
- **链接卡模式正文会自动精简**（2026-11-15 指挥官第三版，`--embed external` 生效）：标题与简介交给卡片，正文只写
  `【分类】标题（年份），关注更多资源，请加入：` + `TG群` + `TG订阅号` + `夸克/百度网盘（点击保存）` + 三个标签，
  **不写简介、不写详情行**，字数 150~220 之间。`TG订阅号` 与第一条网盘链接之间**留一个空行**（2026-11-15 指挥官定，把引流区和资源区分开）。形如：
  ```
  【电视剧】边缘世界（2022），关注更多资源，请加入：
  TG群：https://t.me/wodewangpantop
  TG订阅号：https://t.me/myquark

  夸克网盘：https://pan.quark.cn/s/d585581ba305 （点击保存）
  #边缘世界 #电视剧 #夸克网盘
  ```
- **卡片缩略图**：链接卡默认上传条目海报作 `thumb`（卡片左侧/顶部出图）；`--no-thumb` 关掉即纯文字卡片。thumb 与图片卡的图是同一张源图，区别只是卡片里显示得小。
- `--no-state`：照常发帖但不写 `posted.json`，用于测试发帖效果（日志会标「测试帖，未写入 posted.json」）。
- 图片走 `app.bsky.embed.images`，**alt 文本**写「标题（分类） 海报」；
- URL 与话题标签都生成 **richtext facet**（`byteStart/byteEnd` 用 UTF-8 字节算），所以在客户端是可点的蓝链接，不是纯文本；
- `--dry` 会把每个链接 facet 的 URI 单独打出来，改文案后值得扫一眼，确认没有多吞字符；
- `langs: ['zh']`。

## 发帖 API（AT Protocol，未用第三方库）

```
POST {PDS}/xrpc/com.atproto.server.createSession   {identifier, password}      → accessJwt / did
POST {PDS}/xrpc/com.atproto.repo.uploadBlob        二进制（Authorization: Bearer）→ blob
POST {PDS}/xrpc/com.atproto.repo.createRecord      {repo, collection, record}   → uri / cid
```

帖子链接拼法：`https://bsky.app/profile/<handle>/post/<uri 最后一段>`。
回读验证（无需鉴权）：`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&limit=1`。

## 定时任务

自动化「wodewangpan 资源推送 Bluesky」（id `f9355e9c-86ed-424a-a286-2731684d7578`），**每 1 小时一条，全天 24 小时轮转**（2026-10-10 核对：实际 rrule 已是 `FREQ=HOURLY;INTERVAL=1`，每天 24 条）。

rrule：`FREQ=HOURLY;INTERVAL=1` —— HOURLY 模式**不要加 BYHOUR/BYMINUTE**，加了反而会互相打架。

（历史记录：2026-10-08 曾用 `INTERVAL=3`（每 3 小时一条），再早用 `FREQ=HOURLY;INTERVAL=2;BYHOUR=8,10,12,14,16,18,20;BYMINUTE=0`。**`FREQ=DAILY` 不接受多值 BYHOUR**，会报 "BYHOUR must be an integer"，要用多时段得上 HOURLY + BYHOUR 列表。）

## 边界

- 每次只发 1 条；失败只重试一次，不要连发刷屏。
- 不改仓库任何文件、不碰 git；发帖内容一律取自 yaml。
- **沙箱坑（2026-10-30 踩过，脚本已内置三处兼容补丁，别删）**：在自动化沙箱里跑时
  1. `fs.existsSync()` 会**对真实存在的文件返回 false**（`~/.workbuddy` 整个目录、以及 `static/images/*.jpg` 都中招），而 `readFileSync` / `statSync` 正常。若不改，脚本会以为「已发 0 条」→ 去重全失效，并把 `posted.json` 覆盖成只剩一条（历史全丢）→ 之后必然重复发。补丁：状态文件改成直接 try-read；海报判定 `hasImg` 改用 `statSync().isFile()`。
  2. `curl` 无法 spawn（`ENOENT`），绝对路径的 `curl.exe` 又会 Schannel `exit 35`，但 **Node 内置 `fetch` 到 bsky.social 是通的**。补丁：`curl()` 先走原来的 execFile curl（主机行为完全不变），失败才退回 `curlViaFetch()`（自带 curl 参数解析：`-X/-H/-d/--data-binary @file/-s/--max-time`）。
  3. 沙箱内对 `~/.workbuddy` 的写入能成功但**很慢（>60s）**，会被工具超时打断；而 `writeFileSync` 被打断可能截断 `posted.json`。**定时/批量跑请用后台任务**（`background_bash`），别用前台命令硬等超时。
  4. 主机执行（`require_escalated`）不是必需路径，也可能被拒；沙箱补丁后不需要它也能发。
- App Password 不等于账号密码，泄露可在 Bluesky 设置里单独吊销。
- **CRLF 坑**：`data/软件.yaml` 是 CRLF 换行，字段值行尾会带上 `\r`，导致 id 匹配不上（`--pick app-010` 报"找不到条目"）、夸克链接发到 Bluesky 变坏链接。`parseYaml` 里已统一 `.replace(/\r/g, '')`，别去掉这行。
- **facet 全角括号坑**（2026-10-10 踩过）：百度行写成 `链接（提取码 xxxx）`，URL 后面**没有空格**紧跟全角左括号。facet 正则若只写 `[^\s]+`，会把 `（提取码` 一起吞进链接 → 生成打不开的坏链接。现在正则加了 `\u3000-\u303f` 与 `\uff00-\uffef` 两个全角/中日韩标点区间来终止 URL，**别简化回 `[^\s]+`**。
- **运行时沙箱模式坑**（2026-10-30 踩过、同日修复）：沙箱内 curl 无法 spawn 且 TLS 被拦（HTTP 000），但 **Node fetch 可用**（实测 bsky.social 200）；沙箱里 **existsSync 对存在的文件也返回 false**（statSync/readFileSync 正常），曾致脚本误判 0 条已发、险些覆盖 posted.json。现数据统一落 `~/.workbuddy`（env + posted.json），脚本传输 curl 失败自动退回 fetch、状态 try-read、判图 statSync、路径 statSync 探测，**沙箱内可直接全流程运行，无需宿主机授权**。若报读不到数据，多半是落在缺少状态目录的老环境，那才需要宿主机执行授权（定时无人值守时授权弹窗会过期 → 当次失败，简报写明即可，别反复诊断）。另：沙箱内对状态目录的写入有凭据钩子、极慢（单文件复制曾 237 秒）且可能被超时打断截断文件，**定时/批量跑请用后台任务**。
- **并发实例坑**（2026-10-30 踩过）：同一自动化的多个积压运行同时苏醒，会在几十秒内连发多条，并竞争写 posted.json（last-writer-wins 挤丢过一条记录，靠回读 feed 比对后补录修复）。发现并发实例先问用户要不要停掉；发完顺手核对 posted.json 条数与 feed 实际帖数是否一致，缺了按 quark 链接补记录（只增不删，先备份）。
