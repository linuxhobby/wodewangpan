# AGENTS.md — 自动化任务执行手册

给在这台仓库/站点上工作的自动化 agent（定时任务、AI 会话）看的操作手册。
人在场时可随意发挥；机器执行时**严格按本手册来**。

站点：我的网盘索引站（wodewangpan）· www.wodewangpan.top · 静态站 · Node.js 构建 · VPS + nginx
数据规模、待补条数这类**会随每轮同步变动的数字不写进本手册**（手册只记规则、要求与流程）；需要时以 `data/*.yaml` 的实际条目数、`tools/fill-files.mjs` 输出的「待补条目 N 个」和构建日志的「N 个资源」为准。分类口径见 §2 与 `config/site.yaml` 的 `categories`。

---

## 1. 常用命令

```bash
npm run build              # 构建到 public/（本地）
npm run serve              # 本地预览 http://localhost:4321
npx eslint scripts/ tools/ # lint，提交前必须 0 错误
node scripts/new-resource.js        # 交互式新增资源条目
node tools/fill-files.mjs --limit 3 # 补文件清单（见 §4）
node tools/sort-trees.mjs --dry-run # 预览/回填目录树排序（见 §4）
node tools/fill-desc.mjs            # 批量补/改描述（谨慎，见 §5）
```

一次完整构建约 45~130 秒（首次全量偏慢，增量约 40 秒），第二次跑应「重新生成 0 个」。

## 2. 目录结构

> 2026-11-10 分类合并：「操作系统」并入「软件」，`data/os.yaml` 已删除，11 条 `os-` 前缀条目都在 `data/software.yaml`（保留原 id 与详情页 URL）；盘端资源也已从 `09操作系统` 移入 `02应用`。新增系统镜像类资源一律按「软件」分类、`app-` 前缀入库，不要新建 `os.yaml`。旧路径 `/category/os/` 由线上 nginx 301 到 `/category/software/`。

| 路径 | 说明 |
|---|---|
| `data/*.yaml` | 全部资源数据（movie/tv/anime/documentary/…），**站点的内容源** |
| `config/site.yaml` | 站点配置（站点名、域名、导航、分类、推广位） |
| `scripts/build.js` | 构建入口：读数据 → 写页面 → sitemap/RSS/搜索索引 |
| `scripts/lib/data.js` | 数据解析与规范化（YAML 字段语义看这里） |
| `scripts/lib/render.js` | 全部页面模板与 SEO 输出（meta/JSON-LD/sitemap） |
| `scripts/lib/assets.js` | 配图/二维码等静态资产处理 |
| `tools/fill-files.mjs` | 补「文件清单」`files:` 块（§4 例行任务的主角） |
| `tools/sort-trees.mjs` | 回填已有 `files.tree` 的行序（只重排，不动内容与日期） |
| `tools/lib/tree-sort.mjs` | 目录树排序的唯一实现，fill-files 与 sort-trees 共用，勿另写一份 |
| `tools/fill-desc.mjs`、`poster.mjs`、`share-poster.mjs`、`list-short-desc.mjs` | 批量补描述 / 配图 / 短描述盘点 |
| `theme/assets/style.css` | 全站样式（CSS 变量制，改动要克制；CI 有 `npm run audit:css`） |
| `deploy/wdwp-autoupdate.sh` | VPS 发布脚本（cron `30 */2 * * *`，见 §6） |
| `deploy/`（其余） | `submit-indexnow.sh` / `submit-baidu.sh`（收录推送）、`nginx-site.conf.example` 与 `00-*.conf`（站点配置与探针/AI 爬虫拦截）、`enable-stats.sh` + `00-sitestats.conf`（站点统计） |

**不要动**：`scripts/lib/render.js` 的渲染逻辑、`theme/`、`deploy/` 下的 nginx 配置——这些改动影响全站 SEO 与线上可用性，只允许明确的人工指令触发。

## 3. Git 约束（重要）

- 分支就是 `main`，直接提交推送，不需要开分支。
- **推送前必须 `git fetch` 并确认本地仍基于远程 HEAD**：本仓库有三个定时任务并行提交
  `data/`——fill-files 补文件清单（每 2 小时的 30 分）、夸克资源同步（每 6 小时的 10 分）、
  TMDB 今日热门（每天 3:50）。先 `git pull --rebase` 再 push，不要等被拒了才补。
  其中 fill-files 与 VPS 的发布 cron **同刻触发**（都在偶数小时 :30），互不冲突（任务只 push 不 ssh）。
- rebase 前工作区要干净（`git status --short` 无输出）。出现非本任务产生的改动就标注「工作区不干净」上报，
  **不要 stash、不要丢弃**。
- 禁止 `git push --force`、禁止改写已推送的历史。
- commit message 风格：`类型: 一句话`，类型用 `feat / fix / seo / perf / docs / data`。

## 4. 例行任务：补文件清单（fill-files）

本站 SEO 的核心增量工作，**每 2 小时一轮、每轮 3 条**（约 36 条/天），由定时任务
「我的网盘.fill-files补文件清单」在 0:30 / 2:30 / … / 22:30（Asia/Shanghai）无人值守执行。
原则是**宁可少不可断**。

```bash
node tools/fill-files.mjs --limit 3 --delay 3000
```

工具行为：遍历 `data/*.yaml` 中「有 `quark_url` 且还没有 `files:` 块」的条目，按 `added`
升序（最老资源先补）取用，从夸克分享详情接口（客态访问、无需网盘授权）抓**盘端实际目录**，
在条目末尾追加 `updated: 当天` + `files:` 块。**已有 `files:` 的条目自动跳过、绝不重写**——
所以和入库时就已用 `--ids` 当场补好的「夸克资源同步」互不干扰。

参数语义（容易误读）：

- `--limit` 是**写入额度**，不是查看条数。队首遇到占位目录或抓取失败会自动顺延下一条
  （每条额度最多试 20 个候选，`--tries` 可调），所以一轮实际写入可能是 1~3 条。
- `--ids <id,id>` 只补指定条目，供同步任务入库后当场补用；例行任务不用它。
- `--dry-run` 只抓取打印不写盘；`--only <分类>` 只处理某个 yaml；`--delay` 请求间隔毫秒。
- 根目录只有一个总文件夹时自动下钻最多 2 层拿真实内容。

**占位说明文件一律排除在文件清单之外**（2026-11-08 定稿为硬性规则）。下列都是建目录时预置的工作流产物，
**不是资源内容**，`count` / `size` / `format` / `tree` 全部不计入、不单列成一行：

1. `资源在24小时内更新-请先转存-更新会自动通知.md`（95 字节；正文第 2 行是条件句
   「目录若暂时空白，资源会在24小时内补齐。」——2026-11-08 晚改的，此前写入的约 28 份仍是旧无条件文案）
2. `资源缺失反馈请加QQ群1045824859.md`（51 字节）
3. `关于我的网盘索引站.md`（330 字节，站点导流）
4. `我的网盘网址www.wodewangpan.top.md` —— **第 3 项改名前的旧名，已存在于 643 个网盘目录**，
   网盘 CLI 删不掉，因此必须**永久**排除；只按现用名清理等于给这 643 个条目批量造假数据。
5. `资源正在陆续更新上传中-转存可以获取更新通知.md` —— 人工放过的历史件（全盘仅 1 处）。

⚠ **2026-11-08 晚起，这三份不只出现在空目录里**：全部分类（2026-11-10 起为 9 类）都已铺满，
已有正片的目录里同样常驻这些 `.md`。所以「剔除占位」不再是空目录的边界情况处理，
而是**每次聚合前必须执行的一步**——漏掉它，`count`/`size`/`format`/`tree` 会在几乎所有条目上系统性跑偏。

若盘端只剩这些，整条跳过、一个字都不写，打印「跳过（盘端只有占位说明文件，资源还没到位）」，下一轮再试。
这属正常现象，**不要**改成手工填写，也不要为了让清单「有内容」把说明文件当资源写进去。

实现与同步要求：

- 剔除靠 `tools/fill-files.mjs` 顶部的 `PLACEHOLDER_FILE_RE`，它是**行首前缀匹配**（`^`）。
  不要退化成无锚子的串匹配——那会把片名里带「请先转存」之类的真实文件也误剔出清单。
- 同一份前缀表的权威定义在 `C:/Users/marco/.qwenworkcn/skills/quark-resource-sync/scripts/lib/placeholder.mjs`
  的 `PLACEHOLDER_PREFIXES`（夸克/百度两侧写入与 `baidu-share-links.mjs` 都从它取）。两个仓库无法互相 import，
  **改任何一侧的名字口径必须同时改另一侧**，否则新建目录的占位文件会立刻变成假清单。
- 新增/改名占位文件时，旧名字一定要留在识别表里（参考上面第 4 项的教训），因为网盘删不掉。

**目录树排序**（2026-11-08 起）：工具写盘前把 `tree` 排成「目录优先 → 扩展名分组
（组序与 `format` 同口径：数量多的在前，相同按字母序）→ 组内集数自然序」，实现只在
`tools/lib/tree-sort.mjs`。历史存量用 `node tools/sort-trees.mjs` 回填——它只重排行序，
不动 `count`/`size`/`format`，也**不写 `updated`**（行序变化不是内容变化，盖日期等于伪造
lastmod），且幂等（复跑打印「重排 0 条」）。

执行后 agent 必须做的事：

1. **看失败清单**：失败多为「链接失效 / 需提取码」，是死链候选。逐条人工核验
   （浏览器打开确认）后在该条目加 `dead: true`，不要机器自动标。
2. **抽查数据**：打开本轮写入块，确认 `count`/`size`/`format`/`tree` 与工具打印一致、
   确实是该资源的内容。工具永不编造数据——发现可疑就停下来报告。
   **3 条里任一条可疑，整轮不提交**：收尾是 `git add data/` 一把过，拆开提交会把可疑那份
   一起推上远端。
3. 构建验证：`npm run build` 连跑两次（第一次必须通过，第二次应「重新生成 0 个」）。
4. 提交推送（按 §3），message 用
   `data: fill-files 补 N 条文件清单（<id1>、<id2>、<id3>）`，N 取**实际写入数**（1~3），
   只列真写进盘的 id；本轮 0 条写入就不产生 commit。
5. 发布：**不要手动触发**，等 VPS 的 `30 */2` cron（见 §6）。本任务与它同频同时刻，
   本轮提交通常赶不上同一时刻的那次 pull，要等下一班（约 2 小时后）才上线，这是预期行为。
6. 飞书汇报：每轮结束发一张**蓝色 interactive 卡片**（脚本 `C:/Users/marco/Scripts/wodewangpan-fillfiles-feishu.mjs`，接收人内置；版式与「夸克资源同步任务简报」「院采雷达 · 采集简报」一致：标题固定蓝色头部一次 → 补齐时间 → 按分类的补齐清单 → 补齐进度对账 → 未入库·需人工跟进放最后 → 底部 note 状态行）。一轮 3 条用 `--name` 把「id 标题（分类）」拼成一行（`--id` 只接受单个 id，`--name` 按 `（分类）` 自动分组加 emoji，**条目行的站点详情页与夸克链接也由脚本按 id 回查 `data/*.yaml` 拼好，`--name` 里不要自己写链接、不要自己排版**）；进度段（按分类的已完成 / 待补 + 合计 + 预计天数）由脚本自己扫 `data/*.yaml` 算、不要手工传数字，天数只是量级估算（`--per-day` 默认 36）。卡片标题固定「我的网盘.资源文件清单补齐简报」。本轮的死链候选 / 可疑数据 / 停手原因用 `--follow` 传，**没有异常就省略 `--follow`**（省略 = 卡片不渲染「未入库·需人工跟进」段）。

剩余量与节奏：**待补条数会随每轮变动，以 `tools/fill-files.mjs` 当轮输出的「待补条目：N 个」为准，本手册不写死**。规则不变——每轮 3 条、约 36 条/天就是上限，**不要**因为缺口大就自己加量，一次性大规模变更反而触发「批量内容」判定，比慢慢补更糟。

## 5. 数据规范（data/*.yaml 字段语义）

```yaml
- id: mv-001              # 必填，与配图同名
  title: "…"
  category: "电影"
  tags: [..]
  quark_url: "https://pan.quark.cn/s/xxx"
  baidu_url: …            # 可选
  baidu_pwd: …            # 可选
  description: "…"        # 一句话到一段
  date: 2026-10-09        # 内容日期（影视=上映/发行）
  added: "2026-10-09 19:42"  # 真实入库时间
  updated: 2026-11-07     # 最近校验日：仅当该条目内容真的被补全/复核过才写当天日期
  dead: true              # 仅人工核验确认失效后才标
  files:                  # 全字段可选，有什么写什么；必须来自真实接口/目录，禁止编造
    count: 510            # 文件总数
    episodes: 第 1-24 集
    size: 18.6 GB
    format: MP4 / MKV     # 扩展名分布，数量多的在前（与 tree 的分组顺序同口径）
    resolution: 1080p
    audio: 国语 AAC 2.0
    subtitle: 内封简繁中字
    packed: false         # true=压缩包
    tree: |               # 目录结构，最多 40 行；写入时已按「目录→扩展名分组→集数自然序」排好
      …
```

`data/*.yaml` 是 **CRLF 为主、夹少量裸 LF** 的混排文件。任何批量写入都要逐行保留原行尾，
否则没动过的行也会进 diff，并与并行任务互相整体覆盖。

**铁律**：

- **禁止伪造任何日期**。`added` 是事实，永远不改写（唯一例外：补位回收把同 id 的死链旧条目
  整块换成新资源，那属于事实更新）；`updated` 只在内容真变化时写当天日期。伪造日期 =
  sitemap lastmod 失信 = 全站降权，这是本站第一红线。
- `files.*`、`description` 等一切内容必须可溯源（接口返回 / 目录实拍 / 影视库）。
  编造数据会让「独有内容」变成「批量伪造内容」，比没有更糟。
- 死链处理只有人工核验一条路：确认 → `dead: true` → 构建自动 noindex + 移出 sitemap。

## 6. 发布流程

正常情况不用管：VPS cron `30 */2 * * * /usr/local/bin/wdwp-autoupdate` 每 2 小时的 30 分自动
`git fetch → 构建 → 原子替换 public → reload nginx → IndexNow 推送`。

**主机别名是 `site`**（= `hty22` = `38.190.227.56:37212`，`~/.ssh/config` 里同一条 Host 记录）。
本机**没有** `www` 别名，早期文档里的 `ssh www ...` 一律执行不了；`rc` 是另一台机（微信发布用），
不要拿它做站点发布。

判定成功看日志末行，**不要用 ssh stdout**（脚本把输出写进日志，stdout 可能为空）：

```bash
ssh site 'tail -3 /var/log/wdwp-autoupdate.log'   # 看到「发布完成：<hash>」即成功
```

手动立即发布（改完想马上上线；例行任务**不要**这么干）：

```bash
ssh site 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'
```

- 脚本自己比对本地 HEAD 与 origin/main，有新提交才构建；**没必要就别加 `FORCE=1`**
  （无更新时会白跑一次 npm ci + build）。
- 手动触发**必须套 `flock`**：脚本内部无并发锁，撞上 cron 会同时写 `public.new` 并互相破坏构建产物。
- 单次约 42 秒。构建失败时脚本保留线上旧版本不切换，此时查日志找报错，**不要**手动去 VPS
  改 `public/` 或重启 nginx。
- VPS 上另有 `*/10 * * * * tools/sitestats.py`（站点统计）、每天 3:00 `submit-indexnow`、
  3:10 `submit-baidu`，都与本仓库的发布互不干扰。

## 7. SEO 现状与禁区（改代码前必读）

- sitemap 只含：详情页（排除死链）+ 首页 + 分类页 + 4 个独立页。
  `/all/`、`/hot/`、`/tags/`、标签页**有意不进 sitemap**，别加回去。
- `/all/` 是分页（每页 50 条，`/all/page/N/`）；首页 noscript 每分类只补 10 条。
  这些收缩是刻意设计，不要「优化」回全量列表。
- 死链页已 noindex 并从卡片/RSS/相关推荐剔除；tag 页有 `tagMin: 3` + 近重复告警，
  已治理过，别重复劳动。
- lastmod 优先级 `updated > added > date`，JSON-LD `dateModified` 同口径。
- 联盟链接已是 `rel="sponsored noopener noreferrer"`，规范状态，不要改成 nofollow。
- 每日 GSC「请求编入」限额约 10 条，属人工操作，agent 可在日报里提醒，不要代刷。

## 8. 配图（海报）获取规范

海报存放 `static/images/<id>.jpg`（480×720，2:3 竖版，jpg），条目里在 `added:` 之后写
`image: <id>.jpg`。**任何来源的图都要先验类型（`file`）再看内容**——下载到 HTML/占位图、
搜错条目是最高频事故，下面各来源的坑都出自实战。

按分类选来源，优先级从上到下：

### 影视类（mv-/tv-/dc-/an-）：TMDB 官方海报

```bash
T=~/.codebuddy/skills/quark-resource-sync/scripts/tmdb.mjs
node $T search --type movie --query "All Quiet on the Western Front" --year 2022   # 先拿 id
node $T detail --type movie --id 49046 --poster static/images/mv-212.jpg           # 再下海报
```

- 中文条目名多为意译/别名，**必须用原名或英文名 + 年份检索**（「鳏夫疑案：至死不渝」=
  `The Widower: 'Til Death Do Us Part`，TMDB 1758536；同名旧作 60750/121893 都不对）。
- `search` 结果里用**年份 + 简介**甄别同名作品，选对了再 `detail`。
- ⚠️ `detail --poster` **不覆盖已存在文件**：目标路径有旧图时先 `rm` 再下载，否则静默跳过。
- 原图偏大（>300KB）或比例异常时用 sharp 统一：`resize(480,720,{fit:'cover'}).jpeg({quality:82})`。
  **sharp 必须在仓库根目录运行**（依赖本仓库 node_modules，`/tmp` 下解析不到）。

### 图书（bk-）：豆瓣书封

```bash
node tools/poster.mjs douban --title "书名" --author "作者名" --out static/images/bk-xxx.jpg
```

- 豆瓣模式**只按标题关键词模糊匹配，误抓高发**（「丝绸之路」抓到过黄自乐谱和大村一朗的
  丝路游记书）。工具打印的「作者/出版社/日期」行必须核一眼，图片必须看一眼。
- 标题搜不到/搜错就换**作者名**当关键词；仍不行别硬凑，退 `poster.mjs set` 自绘。

### 软件（app-）：App Store 官方图标 → icon 模式

```bash
curl -s "https://itunes.apple.com/search?term=tailscale&entity=software&limit=3&country=us"
# 取 results[].artworkUrl512 下载后：
node tools/poster.mjs icon --icon <图> --out static/images/app-xxx.jpg --title "名称" --sub "一句话副题"
```

- GitHub 头像接口（`github.com/<org>.png`）可能返回 HTML 而非图片，下载后必须 `file` 验证；
  失败就改走 iTunes Search API。

### 游戏（game-）：官网包装图优先

1. **官网实体版包装图**（发行商官网 product 页）：sharp `.trim()` 裁白边后
   `resize({height:720})` + 白底 extend 补到 480×720。
2. TMDB（有收录的游戏）。
3. **非游戏的 Switch 生态资源**（整合包/模拟器等）：Wikimedia Commons 的主机官方照
   （搜 `Nintendo Switch Joy-Con` 等，自由授权），`poster.mjs icon` 合成标题版。
4. 都没有 → `poster.mjs set` 自绘。

### 无封面资源（音乐合辑、特辑等）：自绘，不硬凑

```bash
node tools/poster.mjs set --title "丝绸之路" --badge "马友友 · 20 周年纪念特辑" --out static/images/ot-xxx.jpg
```

搜到的图对不上内容就删掉重来，**宁可自绘也不放错图**。

### 完成动作

`image:` 字段写入 → 复扫全库无缺图无坏链 → `npm run build` 两次 → 抽查详情页海报引用。
（批量改 yaml 时注意行尾混排问题，见 §5。）

## 9. 验证清单（每次改完跑一遍）

```bash
npx eslint scripts/ tools/     # 0 错误（tools/lib/ 也在覆盖范围内）
npm run build                  # 构建通过，注意「重新生成 N 个」是否合理
npm run build                  # 第二次构建应「重新生成 0 个」（304 机制未破坏）
```

- 涉及模板改动时，抽查 1 个详情页 HTML：meta/canonical/JSON-LD/files 块是否正常。
- 涉及 `data/*.yaml` 改动时，`git diff --numstat` 的加减行数应当只对得上预期改动，
  且不应出现整文件行尾变化。
- 只改 `AGENTS.md` 这类文档不影响构建（它不参与 `scripts/build.js` 的输出），提交推送即可。
