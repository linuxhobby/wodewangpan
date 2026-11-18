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
npx eslint scripts/        # lint，提交前必须 0 错误
node tools/new-resource.js        # 交互式新增资源条目
node tools/quark-cron/share-update.mjs --dry    # 夸克每日补存 dry 自检（不转存）
node tools/quark-cron/prestore-move.mjs --dry   # 预存搬运 dry 自检（不 move）
node tools/quark-cron/trending-daily.mjs --dry-run  # TMDB 同步配置/状态检查
node tools/quark-cron/resource-sync.mjs --dry-run   # 资源同步扫描+匹配（不写盘）
bash deploy/install-quark-cron.sh               # 幂等安装两条夸克 cron
node tools/fill-files.mjs --limit 3 # 补文件清单（见 §4）
node tools/sort-trees.mjs --dry-run # 预览/回填目录树排序（见 §4）
node tools/fill-desc.mjs            # 批量补/改描述（谨慎，见 §5）
npm run check:images                 # 配图盘点（分类目录命中 / 孤儿文件）
```

一次完整构建约 45~130 秒（首次全量偏慢，增量约 40 秒），第二次跑应「重新生成 0 个」。

## 2. 目录结构

> 2026-11-10 分类合并：「操作系统」并入「软件」，`data/os.yaml` 已删除，原 `os-001~011` 重编号为 `app-130~140` 并入 `data/software.yaml`——软件分类只有 `app-` 一种 id 前缀，**不要新建 `os.yaml`、不要再写 `os-` 前缀 id**。旧详情页 `/resource/os-NNN/` 与旧分类页 `/category/os/` 均由线上 nginx 301 到新地址（2026-11-15 URL 改造后规则已同步，见 §2.1；改任何已收录路径都必须同步配 301）。

| 路径 | 说明 |
|---|---|
| `data/*.yaml` | 全部资源数据（movie/tv/anime/documentary/…），**站点的内容源** |
| `config/site.yaml` | 站点配置（站点名、域名、导航、分类、推广位） |
| `scripts/build.js` | 构建入口：读数据 → 写页面 → sitemap/RSS/搜索索引 |
| `scripts/lib/data.js` | 数据解析与规范化（YAML 字段语义看这里） |
| `scripts/lib/render.js` | 全部页面模板与 SEO 输出（meta/JSON-LD/sitemap） |
| `scripts/lib/assets.js` | 配图/二维码等静态资产处理 |
| `tools/` | **工具目录（2026-11-17 拆分）**：数据采集与内容生产脚本（fill-files 全家桶、补描述/标题、海报生成、资源导出），依赖采集环境（夸克 CLI / TMDB 凭据）；站点构建不引用本目录，依赖方向单向 tools → scripts/lib |
| `tools/quark-cron/` | **四条夸克/同步编排脚本**：`share-update.mjs`（16:10）、`prestore-move.mjs`（01:40）、`trending-daily.mjs`（03:50）、`resource-sync.mjs`（每 6 小时 :10），纯 node + CLI、不依赖 LLM；缓存/日志走 `~/.cache/quark-sync/`；七个常驻 cron 任务的统一手册见 `docs/CRON-TASKS.md` |
| `deploy/install-quark-cron.sh` | 幂等安装上述两条 cron（标记块 `wdp-quark` / `wdp-move`），`uninstall` 可卸；凭据只走 scp |
| `tools/fill-files.mjs` | 补「文件清单」`files:` 块（§4 例行任务的主角） |
| `tools/sort-trees.mjs` | 回填已有 `files.tree` 的行序（只重排，不动内容与日期） |
| `tools/scan-drive-fids.mjs` | 扫夸克 SHARE 目录，生成 `config/drive-fids.json`（id → 盘端目录 fid），`--source drive` 口径依赖它 |
| `config/drive-fids.json` | 站内 id → 盘端编号目录 fid/目录名映射（只读缓存，盘端改名后重跑扫描脚本即可，不是内容源） |
| `config/drive-source-ids.json` | 被屏蔽台账：这些条目取数走盘端真实目录而非分享客态（§4） |
| `tools/lib/tree-sort.mjs` | 目录树排序的唯一实现，fill-files 与 sort-trees 共用，勿另写一份 |
| `tools/lib/serials.mjs` | 连载轮询的唯一口径（候选、无状态轮换、快照签名、保留行尾写盘），fill-files 与 list-ongoing 共用 |
| `tools/lib/tmdb.mjs` | TMDB 只读查询（凭据跨机探测、剧名年份校验、播出事件、季号识别），只供追更提醒 |
| `tools/list-ongoing.mjs` | 只读盘点「活跃 / 已定格 / 死链」的连载条目（§4） |
| `.gitattributes` | 锁 `data/*.yaml` 为 LF，跨平台不产生 CRLF 混排（§5） |
| `tools/fill-desc.mjs`、`tools/poster.mjs`、`tools/share-poster.mjs`、`tools/list-short-desc.mjs` | 批量补描述 / 配图 / 短描述盘点 |
| `theme/assets/style.css` | 全站样式（CSS 变量制，改动要克制；CI 有 `npm run audit:css`） |
| `deploy/wdwp-autoupdate.sh` | VPS 发布脚本（cron `30 */2 * * *`，见 §6） |
| `deploy/setup-vps.sh` | 方案 A 一键部署脚本（换新 VPS / 别人复制本站时用；参数与流程见 README 方案 A） |
| `deploy/`（其余） | `submit-indexnow.sh` / `submit-baidu.sh`（收录推送）、`nginx-site.conf.example` 与 `00-*.conf`（站点配置与探针/AI 爬虫拦截）、`enable-stats.sh` + `00-sitestats.conf`（站点统计） |

**不要动**：`scripts/lib/render.js` 的渲染逻辑、`theme/`、`deploy/` 下的 nginx 配置——这些改动影响全站 SEO 与线上可用性，只允许明确的人工指令触发。

### 2.1 URL 与配图目录结构（2026-11-15 定稿，长期契约）

| 对象 | 结构 |
|---|---|
| 详情页 | `/<slug>/<id>/`，物理目录 `public/<slug>/<id>/index.html` |
| 分类页 / 分类 RSS | `/<slug>/`、`/<slug>/feed.xml`，物理目录 `public/<slug>/` |
| 源配图 | `static/images/<slug>/<id>.jpg`（产物 `/img/<id>-*.webp` 仍按 id 平铺，不受影响） |

- `config/site.yaml` 的 `slugs` 是唯一口径，`categorySlug()` 取别名；`build.js` 在读完
  `data/*.yaml` 后调 `setItemPaths(items)` / `setCategoryPaths(slugs)`，页面 URL 只从
  `itemHref()` / `catHref()` 出。**不要靠 id 前缀推分类**：历史上有 `ot-007 → app-141` 换分类重编号。
- **slugs 只增不改**。新增分类必须配英文小写别名，且不能撞 `build.js` 的 `RESERVED_TOP_DIRS`
  （`about/all/assets/contact/hot/img/og/privacy/promo/qr/rss/tag/tags`）；构建期校验不通过会直接退出。
  改一个 slug = 同时换掉该分类页与整类详情页地址，属全量 URL 迁移，必须同步 301。
- **改任何已收录路径都必须同步配 301**：线上 `/etc/nginx/conf.d/wodewangpan.conf` 与
  `deploy/nginx-site.conf.example` 必须保持一致。规则顺序是「历史精确 id → 旧分类页 → 按前缀的泛化详情页」，
  顺序颠倒会让 `ot-007` 被泛化成 `/misc/ot-007/`。换 URL 后 IndexNow 要带 `ALL=1` 全量重推。
- **标签合并 / 删除同样要配 301**（2026-11-16 首次执行）：旧 `/tag/<slug>/` 要 301 到合并后的标签页，
  标签若并入分类（如「纪录」并入分类「纪录片」）或整个是作品名，就 301 到对应分类页。
  规则位置看 `deploy/nginx-site.conf.example` 的「标签词表治理」段，线上同名规则与它保持一致。
- **新增配图一律写 `static/images/<slug>/`**。`scripts/lib/assets.js` 的 `resolveSource()` 保留旧平铺路径
  兼容双读，只作灰度与跨机分批切换的回退，不是长期口径；`npm run check:images` 会把旧平铺命中与孤儿文件报出来。
  跨机 skill 的 `scripts/lib/site-paths.mjs`（Mac 本机 `~/.workbuddy/skills/quark-resource-sync`、
  Windows 侧两份；群晖中转已不再维护）里的 `PREFIX_SLUG` 必须与站点 `slugs` 同步。
- `scripts/sitestats.py` 的 `RES_RE` 里那份分类 slug 白名单与 `slugs` 同步；统计按 id 聚合，
  换 URL 不需要迁移 `stats.db`。

## 3. Git 约束（重要）

- 分支就是 `main`，直接提交推送，不需要开分支。
- **推送前必须 `git fetch` 并确认本地仍基于远程 HEAD**：本仓库有多个任务并行提交
  `data/`——fill-files 补文件清单（每 2 小时的 30 分）、夸克资源同步（每 6 小时的 10 分）、
  TMDB 今日热门（每天 3:50）等。先 `git pull --rebase` 再 push，不要等被拒了才补。
  其中 fill-files 与 VPS 的发布 cron **同刻触发**（都在偶数小时 :30），互不冲突（任务只 push 不 ssh）。
- rebase 前工作区要干净（`git status --short` 无输出）。出现非本任务产生的改动就标注「工作区不干净」上报，
  **不要 stash、不要丢弃**。
- 禁止 `git push --force`、禁止改写已推送的历史。
- commit message 风格：`类型: 一句话`，类型用 `feat / fix / seo / perf / docs / data`。

## 4. 例行任务：补文件清单（fill-files）

本站 SEO 的核心增量工作，**每 2 小时一轮、每轮 3 条**（约 36 条/天）。2026-11-18 起由本机
Debian cron（标记块 `wdp-fill`，`30 */2 * * *`）直接跑编排脚本，不再依赖 WorkBuddy / LLM；
原则是**宁可少不可断**。五个常驻任务的统一手册见 `docs/CRON-TASKS.md`。

```bash
node tools/feishu-reports/wodewangpan-fillfiles-run.mjs            # 整轮：对齐→补齐→校验→构建→推送→飞书
node tools/feishu-reports/wodewangpan-fillfiles-run.mjs --dry-run  # 试跑，不写盘不提交
```

工具行为（补齐）：遍历 `data/*.yaml` 中「有 `quark_url` 且还没有 `files:` 块」的条目，按 `added`
升序（最老资源先补）取用，从夸克分享详情接口（客态访问、无需网盘授权）抓**盘端实际目录**，
在条目末尾追加 `updated: 当天` + `files:` 块。**补齐流程里已有 `files:` 的条目自动跳过**——
和入库时就已用 `--ids` 当场补好的「夸克资源同步」互不干扰。
例外是下面「连载资源自动轮询」：电视剧 / 动漫的已有清单在盘端真变化时会整体重写。

参数语义（容易误读）：

- `--limit` 是**写入额度**，不是查看条数。队首遇到占位目录或抓取失败会自动顺延下一条
  （每条额度最多试 20 个候选，`--tries` 可调），所以一轮实际写入可能是 1~3 条。
- `--ids <id,id>` 只补指定条目，供同步任务入库后当场补用；例行任务不用它；指定时不跑连载轮询与待办扫描。
- `--dry-run` 只抓取打印不写盘；`--only <分类>` 只处理某个 yaml；`--delay` 请求间隔毫秒。
- `--serials <n>` 每轮顺带抽查几条连载条目（默认 1，`0` 临时关闭）；`--limit 0 --serials 1 --dry-run` 可只跑轮询排查。
- `--todo <n>` 每轮抽查几条最近入库的剧集目录、找出盘端仍空的待办（默认 3，`0` 关闭）；详见下面「人工待办清单」。
- `--airing <n>` 连载轮询时顺带查 TMDB 播出事件（默认开，`0` 关闭）；只读、零额外夸克请求，详见下面「追更提醒」。
- **下钻口径（2026-11-10 定稿，固定标准）**：剔除占位说明文件之后，本级恰好只剩 1 个目录才继续下钻，**最多 2 级**。
  占位 md 不参与判断——它们铺满各级目录，按原始条数判断会让下钻提前停一层，
  把「目录级残缺快照」当成清单写盘。
  下钻中途抓取失败一律按**失败**处理：宁可这一条不写，也绝不写残缺清单。
- `--source <share|drive>` 取数口径开关（2026-11-11 起，**默认 `share`，例行轮一个字都不用改**）。
  `share` = 夸克分享详情接口、客态访问，反映**访客实际能拿到什么**；`drive` = 登录态网盘目录
  （CLI `browse --all`），反映**盘端真实内容**。切换的原因：夸克会对分享链接里的文件做**文件级屏蔽**——
  同一目录登录态有全集、访客端只看到少数几份说明文件（实测多条剧集），这类条目的清单按 `share` 写出来
  不是「资源不完整」而是「平台不给访客看」，所以允许逐条改读盘端。
  - **哪些条目走 `drive` 由 `config/drive-source-ids.json` 决定**（被屏蔽台账，id 数组）。
    补齐、连载轮询、待办扫描三处都读它，**命中即走盘端**——这一步是硬要求：如果只把清单按 `drive` 写进去、
    轮询还按 `share` 抓，下一轮就会把全集缩回被屏蔽的几项并再盖一次 `updated`（§5 红线）。
  - `drive` 口径需要 id → 盘端目录 fid 的映射，即 `config/drive-fids.json`，由
    `node tools/scan-drive-fids.mjs` 扫 SHARE 生成（`--dry-run` 只看统计）；盘端改名/换号后重跑。
    映射里查不到该 id 时自动回落 `share` 并打印一行提示，不会静默降级成假清单。
    盘端根目录的「99-需要删除的移动到这里」是用户确认**永久保留、不扫描**的目录
    （2026-11-13 定，`scan-drive-fids.mjs` 的 `EXCLUDED_ROOT_DIRS` 显式排除）：
    扫描整目录跳过、不进入、不映射，属预期行为，**不要再当「需要人工分类」上报**。
  - 两套源**只换「取一个目录的直接子项」这一层**：下钻、剔占位、聚合、排序、签名比对仍然只有
    `locateContent` + `aggregate` + `tools/lib/tree-sort.mjs` 一份实现，`drive` 的第一层会合成成
    「根目录里只有那个编号目录」，保证两边写出的 `files:` 块同构。绝不许为 `drive` 另写一份口径。
  - 已知代价：`drive` 清单包含访客拿不到的文件，属于对用户的过度承诺。暂不改详情页文案，
    被屏蔽条目以 `config/drive-source-ids.json` 为准可查。存量条目**不做一次性回填**（会批量盖 `updated`），
    靠补齐队列与轮询自然消化。

**一律排除在文件清单之外的非内容文件**（2026-11-08 定稿为硬性规则，2026-11-12 扩到第 7 项）。
下列都不是资源内容，`count` / `size` / `format` / `tree` 全部不计入、不单列成一行：

1. `资源在24小时内更新-请先转存-更新会自动通知.md`
2. `资源缺失反馈请加QQ群1045824859.md`
3. `关于我的网盘索引站.md`（站点导流）
4. `我的网盘网址www.wodewangpan.top.md` —— **第 3 项改名前的旧名，永久排除**：
   已铺满网盘目录且网盘 CLI 删不掉，只按现用名清理等于给存量条目批量造假数据。
5. `资源正在陆续更新上传中-转存可以获取更新通知.md` —— 人工放过的历史件。
6. `.正片名.mkv.fg` / `.fg.op` / `.fg.ed` —— **NAS 播放器的片头/片尾标识文件**（2026-11-10 定性，三种形态都要排除）。
   `.op` = opening（片头）、`.ed` = ending（片尾），播放器附属产物、不是资源内容，一律不进清单。
   它们以 `.` 开头，按行首前缀永远匹配不上，只能按**后缀**识别；漏掉会把 `count` 虚增、
   把扩展名统计成假的 `OP×N`，还会把「只铺了片头片尾标记、正片还没转存」误读成「资源已到位」。
   识别口径：skill 侧 `PLACEHOLDER_SUFFIXES = ['fg.ed', 'fg.op', 'fg']` + 本仓库 `PLACEHOLDER_FILE_RE` 的
   `\.fg(?:\.ed|\.op)?$` 分支，**两边同改**。⚠ 不要写成通配 `\.fg.*`：将来播放器若另生 `.fg.xxx`
   （如字幕标记），通配会连有价值的附属信息一起误剔，新增形态一律在表里追加一条。
7. `.DS_Store` / `._xxx` / `__MACOSX` / `Thumbs.db` / `Desktop.ini` —— **macOS 与 Windows 的系统垃圾文件**
   （2026-11-12 定性）。本站不生成它们，是上传者从自己机器拷贝进网盘的，CLI 删不掉，只能永久识别；
   `.DS_Store` 会连带生成 `._.DS_Store`（AppleDouble 伴生元数据）。
   漏掉的后果与前两类一样：`count` 虚增、破坏下钻判断（「正片目录 + 一份 .DS_Store」= 本级两项，
   `locateContent` 会提前停一层，把目录级残缺快照当清单写盘）。
   识别口径：只在本仓库 `PLACEHOLDER_FILE_RE` 加精确锚定的五个分支（`^\.DS_Store$|^\._|^__MACOSX$|^Thumbs\.db$|^Desktop\.ini$`），
   skill 侧 `placeholder.mjs` **不同改**——那张表管的是本站自己铺的占位 `.md` 名字，两边职责不重叠。
   ⚠ 只有 `^\._` 是前缀规则（AppleDouble 的名字跟着正片名变，无法穷举），其余一律 `^…$` 精确匹配；
   不要退化成无锚子的串匹配，否则片名里带 Thumbs / Desktop / macOS 字样的真实文件会被连坐误剔。

⚠ 这几份占位 `.md` 不只出现在空目录里：全部 9 类的目录都已铺满，已有正片的目录同样常驻。
所以「剔除占位」不是空目录的边界情况处理，而是**每次聚合前必须执行的一步**——漏掉它，
`count`/`size`/`format`/`tree` 会在几乎所有条目上系统性跑偏。

若盘端只剩这些，整条跳过、一个字都不写，打印「跳过（盘端只有占位说明文件，资源还没到位）」，下一轮再试。
这属正常现象，**不要**改成手工填写，也不要为了让清单「有内容」把说明文件当资源写进去；
系统垃圾走**同一句打印**（目录里只剩 `.DS_Store` 之类 = 盘端没有正片）。
这句文案自 2026-11-08 起被两条任务 prompt 按原样引用，不要为了措辞好看去改它。

实现与同步要求：

- 剔除靠 `tools/fill-files.mjs` 顶部的 `PLACEHOLDER_FILE_RE`，它是**行首前缀匹配**（`^`）。
  不要退化成无锚子的串匹配——那会把片名里带「请先转存」之类的真实文件也误剔出清单。
- 同一份前缀表的权威定义在 `C:/Users/marco/.workbuddy/skills/quark-resource-sync/scripts/lib/placeholder.mjs`
  的 `PLACEHOLDER_PREFIXES`（夸克/百度两侧写入与 `baidu-share-links.mjs` 都从它取）。两个仓库无法互相 import，
  **改任何一侧的名字口径必须同时改另一侧**，否则新建目录的占位文件会立刻变成假清单。
- 新增/改名占位文件时，旧名字一定要留在识别表里（参考上面第 4 项的教训），因为网盘删不掉。

**存量污染条目已手工清理（2026-11-12），规则存档**：新规则只管之后写入的清单，已写盘的条目**不会自愈**——
工具跳过任何已经有 `files:` 块的条目。连载条目等轮询自然刷新；非连载条目今后照此判断：
**只删非内容行并同步 `count`；删到本级为空就整块撤下 `files:`（连 `updated` 一起删，
维持「`updated` 与 `files:` 由工具成对写入」的不变式），绝不用手工凑一份看着齐全的清单。**

**目录树排序**（2026-11-08 起）：工具写盘前把 `tree` 排成「目录优先 → 扩展名分组
（组序与 `format` 同口径：数量多的在前，相同按字母序）→ 组内集数自然序」，实现只在
`tools/lib/tree-sort.mjs`。历史存量用 `node tools/sort-trees.mjs` 回填——它只重排行序，
不动 `count`/`size`/`format`，也**不写 `updated`**（行序变化不是内容变化，盖日期等于伪造
lastmod），且幂等（复跑打印「重排 0 条」）。

**连载资源自动轮询**（2026-11-10 起）：电视剧（`tv.yaml`）与动漫（`anime.yaml`）的夸克目录会
持续追加资源，首份文件清单写完就过期。fill-files 每轮例行**顺带抽查 1 条**已有 `files:` 块的剧集，
重抓盘端目录，与已有清单比对 `count`/`size`/`format`/`packed`/`tree`：

- **只有内容真变了**才整体重写 `files:` 块并写 `updated: 当天`（真实变化，合规），打印「已刷新」；
  无变化打印「无变化」，**一个字都不写**。
- **签名里的 `tree` 与行序无关**（2026-11-11 修）。盘端接口返回子项的顺序本身不稳定，`tree-sort` 在
  「同级两个目录」这种并列情况下也不给出唯一先后，所以同一份内容两次抓取可能只是行序不同。
  签名按「拆行 → 去空白 → 排序 → 再拼」比对（`tools/lib/serials.mjs` 的 `treeKey`），纯换序判**无变化**；
  文件增减、改名、层级变化照样判有变化，重数也保留（同名两行不等于一行）。
  行序变化不是内容变化，盖日期等于伪造 lastmod（§5 第一红线）；`sort-trees.mjs` 回填行序同理不写 `updated`。
- 不需要状态字段，也不需要人工标记「完结」：判定信号就是盘端目录还在不在变。静止满 60 天降入
  低频复查池（每 10 轮抽查 1 条），永不宣称完结，老剧后来补内容也能被发现。
- 每 2 小时 1 条、按时间片无状态轮换，同一轮重复执行幂等；不会与并行任务抢状态文件。
- 候选口径、轮换、签名比对、保留行尾的写盘**只在** `tools/lib/serials.mjs`；
  `node tools/list-ongoing.mjs` 随时只读盘点「活跃 / 已定格 / 死链」清单。
- 抓取口径（下钻最多 2 级、先剔占位再判断、前缀回填）**只在** `tools/fill-files.mjs` 的 `locateContent` 一份实现，
  补齐、连载轮询、待办扫描三处共用——不要再另写一份，否则签名会误判「有变化」，导致每轮重写并伪造 updated。

**这套轮询随仓库工具更新生效，Windows 自动化机、定时任务提示词、飞书简报脚本、VPS 都不用改**：
任务启动按 §3 先 `git pull --rebase` 拿到最新 `scripts/` 即可。轮询失败（链接失效）只打印清单，
仍按下面第 1 条人工核验后才标 `dead: true`；盘端只剩占位说明文件属正常现象，不写盘、不上报异常。
飞书简报的「本轮补齐 N 条」只统计补齐写入，连载刷新不计入进度对账（刷新条目本来就有 `files:` 块）；
有刷新或失败时在 `--follow` 里带一句即可，正常刷新不单独发卡片。

**人工待办清单：哪些目录还需要往夸克加资源**（2026-11-10 起）：`trending-sync` 每天自动建编号
空目录 + 出永久链 + 入库，正片由**人工转存**（空目录出链长期有效，加完资源不用回头改 YAML）。
加资源这个动作始终是人工的，工具只负责告诉你该加哪些：

- 每轮例行按 `added` **降序**抽查 3 条最近入库、还没有 `files:` 块的电视剧 / 动漫，只读判断盘端
  是否仍只有占位说明文件，输出 `[待加资源] 盘端仍空 N 条：id、id…`。与补齐队列（升序、老资源
  优先）方向相反，专门解决新空目录排在队尾、发现太慢的问题。
- 空目录 = 需要往那个夸克编号目录加资源；**加了内容后下一轮自动从清单消失**，不需要销账、
  标记或改 YAML；随后由补齐队列写清单、连载轮询接管后续更新。
- 任务 agent 把 `[待加资源]` 里的 **id 照抄进飞书 `--follow`**（脚本按 id 回查 `data/*.yaml` 拼标题、
  站点详情页与夸克链接，不要自己写链接或排版）；清单为空时省略这一段。空目录**不是失败**：
  不标 `dead`、不进失败清单、不影响本轮提交。
- 想一次看全量：`node tools/fill-files.mjs --limit 0 --serials 0 --todo 40 --dry-run`（只读、不写盘）。

**追更提醒：本周播了新一集、盘端可能还没追**（2026-11-10 起）：连载轮询抓到盘端快照后，
顺带查 TMDB 的 `status` 与 `last_episode_to_air`（播出日期是精确事实），命中就打印
`[追更提醒] <id> … S?E? 于 YYYY-MM-DD 播出 · 盘端当前 N 项，请确认是否已追 <夸克链接>`，
由任务 agent 一并塞进飞书 `--follow`。

- 只做**提醒**，不解析、不写入「还差几集」的结论：`files.tree` 最多 40 行会截断、混
  `.xltd.cfg`、有纯目录条目，动漫分类里还混电影与合辑单文件，集数不是可靠事实。
  误判最多多一条卡片，绝不污染 `data/`。
- 凭据从环境变量 `TMDB_TOKEN` 或本机 quark-resource-sync skill 的 `config.env` 读
  （`tools/lib/tmdb.mjs`，Mac / Windows 路径都探测），**不写进仓库、不落缓存**；查不到就打印
  一行跳过提示，不影响补齐 / 轮询 / 待办。
- 防误报三道闸：标题剥季号后按剧名搜 TMDB + 首播年宽松校验（季播剧 `date` 常是某一季日期，
  硬按年份过滤会把整部剧搜没）；`status` 必须是 Returning Series / In Production / Planned；
  **条目季号要与最近播出的季一致**（从盘端 `S04E01` 或标题「第四季」取），否则「第四季播
  新集」会把第一 / 二 / 三季全提醒一遍。
- 提醒窗口 7 天，每轮随连载轮询抽查 1 条（候选数随库存浮动，覆盖一轮所需天数以实际为准）；
  `--airing 0` 可关闭。
- 仍然的边界：TMDB 未收录 / 中文译名搜不到 / 盘端文件名无任何集数样式的条目会静默跳过，
  这些仍靠人工追更。**要不要追、往盘里加哪一集，始终是你人工决定**，工具只负责把播出事件
  和当前盘端快照摆到你面前。

执行后 agent 必须做的事：

1. **看失败清单**：补齐与「[连载轮询] 失败清单」都看一遍，多为「链接失效 / 需提取码」，是死链候选。
   逐条人工核验（浏览器打开确认）后在该条目加 `dead: true`，不要机器自动标。
2. **抽查数据**：打开本轮写入块（含连载刷新重写过的 `files:` 块），确认
   `count`/`size`/`format`/`tree` 与工具打印一致、确实是该资源的内容。工具永不编造数据——
   发现可疑就停下来报告。**本轮任一条可疑，整轮不提交**：收尾是 `git add data/` 一把过，
   拆开提交会把可疑那份一起推上远端。
3. 构建验证：`npm run build` 连跑两次（第一次必须通过，第二次应「重新生成 0 个」）。
4. 提交推送（按 §3），message 用
   `data: fill-files 补 N 条文件清单（<id1>、<id2>、<id3>）`，N 取**补齐实际写入数**（1~3），
   只列真写进盘的 id；本轮有连载刷新就在后面加 `· 连载刷新 M 条`，只有刷新没有补齐时用
   `data: fill-files 连载刷新 M 条（<id>）`。补齐 0 条且刷新 0 条就不产生 commit。
5. 发布：**不要手动触发**，等 VPS 的 `30 */2` cron（见 §6）。本任务与它同频同时刻，
   本轮提交通常赶不上同一时刻的那次 pull，要等下一班（约 2 小时后）才上线，这是预期行为。
6. 飞书汇报：每轮结束发一张**蓝色 interactive 卡片**（脚本 `tools/feishu-reports/wodewangpan-fillfiles-feishu.mjs`（2026-11-17 起在仓库内，旧路径 `C:/Users/marco/Scripts/` 已作废），接收人内置；版式与「夸克资源同步任务简报」「院采雷达 · 采集简报」一致：标题固定蓝色头部一次 → 补齐时间 → 按分类的补齐清单 → 补齐进度对账 → 未入库·需人工跟进放最后 → 底部 note 状态行）。一轮 3 条用 `--name` 把「id 标题（分类）」拼成一行（`--id` 只接受单个 id，`--name` 按 `（分类）` 自动分组加 emoji，**条目行的站点详情页与夸克链接也由脚本按 id 回查 `data/*.yaml` 拼好，`--name` 里不要自己写链接、不要自己排版**）；进度段（按分类的已完成 / 待补 + 合计 + 预计天数）由脚本自己扫 `data/*.yaml` 算、不要手工传数字，天数只是量级估算（`--per-day` 默认 36）。卡片标题固定「我的网盘.资源文件清单补齐简报」。本轮的死链候选 / 可疑数据 / 停手原因、`[待加资源]` 里的 id、以及 `[追更提醒]` 那一行用 `--follow` 传（追更提醒自带播出信息与夸克链接，照抄原文即可，**不要**自己改写或补「还差几集」的结论）；**异常、待加资源、追更提醒三者都没有时才省略 `--follow`**（省略 = 卡片不渲染「未入库·需人工跟进」段）。

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
  updated: 2026-11-07     # 仅当内容真被补全/复核过才写当天；连载刷新（盘端真变化）同样写当天
  dead: true              # 仅人工核验确认失效后才标
  files:                  # 必须来自真实接口/目录；电视剧/动漫由连载轮询在盘端变化时整体重写
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

`data/*.yaml` 由根目录 `.gitattributes` 锁为 **LF**（`data/*.yaml text eol=lf`）。显式属性优先于
各机 `core.autocrlf`，Windows 自动化机与 macOS 检出、提交都是同一种行尾，历史上「CRLF 为主、
夹少量裸 LF」的混排不会再产生。**不要**为了「统一格式」再跑一次全库行尾转换，也不要删
`.gitattributes`。任何批量写入仍要逐行保留原行尾：否则没动过的行也会进 diff，并与并行任务互相整体覆盖。

**铁律**：

- **禁止伪造任何日期**。`added` 是事实，永远不改写（唯一例外：补位回收把同 id 的死链旧条目
  整块换成新资源，那属于事实更新）；`updated` 只在内容真变化时写当天日期。连载轮询重写
  `files:` 块属内容真变化，写当天合规；盘端无变化时一个字都不写。伪造日期 =
  sitemap lastmod 失信 = 全站降权，这是本站第一红线。
- `files.*`、`description` 等一切内容必须可溯源（接口返回 / 目录实拍 / 影视库）。
  编造数据会让「独有内容」变成「批量伪造内容」，比没有更糟。
- 死链处理只有人工核验一条路：确认 → `dead: true` → 构建自动 noindex + 移出 sitemap。
- **人工点名的「回收」是另一条路**（2026-11-11 首次执行：用户先删夸克编号目录、再点名把对应条目从
  `data/*.yaml` 整块删除）：删条目块 + 首行 `（N 条）` 注释同步回退 + `static/images/<slug>/<id>.jpg` 一并回收，
  编号随即变成网盘空洞，下一轮 `trending-sync` 的**空洞优先**会自动复用这个 id（站点已无同 id 条目 → `appended`，
  不走 `↻ 就地改写`）。`/<slug>/<id>/` 变 404，不做**新** 301、不加回条目。
  ⚠ 复用曾配过旧 301 的 id 前，**必须删掉线上 nginx 与 `deploy/nginx-site.conf.example` 里指向别处的旧 rewrite**，
  否则新详情页会被永久跳到旧目标。
  这条只由用户当面点名触发，无人值守任务一律仍走 `dead: true`，**绝不**自己推断「盘端目录没了就删条目」。
  注意 `trending-seen.json` 里该 TMDB id 的记录**保留**，回收过的资源不会被明天的热门榜再抓回来。

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
- VPS 上另有 `*/10 * * * * scripts/sitestats.py`（站点统计）、每天 3:00 `submit-indexnow`、
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
- 对外 SEO 文案（`<title>` / meta description / OG / Twitter / RSS description）不写资源总数、
  标签数这类动态数字：每天入库都会变，站外分享卡与搜索快照会长期缓存过期值（2026-11-15 定）。
  数量只在页面正文里实时渲染；`config/site.yaml` 的 `{total}` 已废弃，`config/tags.yaml` 的
  `{count}` 只留给页面可见文案。

## 8. 配图（海报）获取规范

海报存放 `static/images/<slug>/<id>.jpg`（480×720，2:3 竖版，jpg），条目里在 `added:` 之后写
`image: <id>.jpg`。**任何来源的图都要先验类型（`file`）再看内容**——下载到 HTML/占位图、
搜错条目是最高频事故，下面各来源的坑都出自实战。

**决策链（2026-11-13 定稿）**：官方 / 正版图源（按下面分类）→ **AI 文生图主视觉** →
tools/poster.mjs 参数化自绘兜底。上一档取不到或明显对不上内容才降一档；
**不要因为「排版可控」「省一次调用」就自行换一套出图方式**，换方案前先向人确认。
课程（`cs-`）、音乐合辑、纪念特辑这类没有官方封面的资源，历史上主流做法就是文生图
（成品右下角带平台「AI生成」水印），不是纯 SVG 手绘；`poster.mjs` 的 `icon` / `set` 模式是官方素材合成与兜底工具。

按分类选来源，优先级从上到下：

### 影视类（mv-/tv-/dc-/an-）：TMDB 官方海报

```bash
T=~/.workbuddy/skills/quark-resource-sync/scripts/tmdb.mjs
node $T search --type movie --query "All Quiet on the Western Front" --year 2022   # 先拿 id
node $T detail --type movie --id 49046 --poster static/images/movie/mv-212.jpg           # 再下海报
```

- 中文条目名多为意译/别名，**必须用原名或英文名 + 年份检索**（意译名直接搜基本搜不到）。
- `search` 结果里用**年份 + 简介**甄别同名作品，选对了再 `detail`。
- ⚠️ `detail --poster` **不覆盖已存在文件**：目标路径有旧图时先 `rm` 再下载，否则静默跳过。
- 原图偏大（>300KB）或比例异常时用 sharp 统一：`resize(480,720,{fit:'cover'}).jpeg({quality:82})`。
  **sharp 必须在仓库根目录运行**（依赖本仓库 node_modules，`/tmp` 下解析不到）。

### 图书（bk-）：豆瓣书封

```bash
node tools/poster.mjs douban --title "书名" --author "作者名" --out static/images/ebook/bk-xxx.jpg
```

- 豆瓣模式**只按标题关键词模糊匹配，误抓高发**（搜出来的常常是无关的同名词书）。工具打印的
  「作者/出版社/日期」行必须核一眼，图片必须看一眼。
- 标题搜不到/搜错就换**作者名**当关键词；仍不行别硬凑，退 `poster.mjs set` 自绘。

### 软件（app-）：App Store 官方图标 → icon 模式

```bash
curl -s "https://itunes.apple.com/search?term=tailscale&entity=software&limit=3&country=us"
# 取 results[].artworkUrl512 下载后：
node tools/poster.mjs icon --icon <图> --out static/images/software/app-xxx.jpg --title "名称" --sub "一句话副题"
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

### 无封面资源（课程、音乐合辑、特辑等）：AI 文生图优先，自绘兜底

```bash
# 兜底：没有文生图结果，或明确要求参数化自绘时
node tools/poster.mjs set --title "丝绸之路" --badge "马友友 · 20 周年纪念特辑" --out static/images/misc/ot-xxx.jpg
# 编辑式主题版式：saas / arch / silk / dl 四套预设，--title 用 | 分行，--sub / --foot / 配色可覆盖
node tools/poster.mjs scene --preset silk --out static/images/misc/ot-xxx.jpg
```

`scene` 预设不带覆盖参数时出图与当时写进 `static/images/<slug>/` 的成品逐字节一致，可用 `shasum` 核对。

文生图口径（沿用既有生成流程，具体命令 / 提示词以该流程为准，agent 不自拟工具、不擅自跳过）：

- 只让模型画**无文字、无字母、无数字**的竖版主视觉，主体居中、下方约三分之一留白；
  中文主标题、副标题、期数徽标一律本地叠加（生图写中文必错）。
- 生成结果先 `file` 验类型，再用 sharp `resize(480,720,{fit:'cover'}).jpeg({quality:82})`
  统一尺寸；构建期自动派生详情页与缩略图 webp，不要手工改 `public/`。
- 图若带平台合规水印（如右下角「AI生成」）**保留原样**，不要裁掉或抹除；用户明确不要该字样时
  走**整张重绘或换官方图源**，不要在原图上擦水印。
- 出图后逐张打开看：标题不溢出、不与副标 / 徽标重叠，主视觉没被裁坏，内容确实对得上资源。

**红线：禁止一次性临时脚本出图后删除。** 新增或调整版式时，把配色、图形、字号落进
tools/poster.mjs 的可复用模式或参数（`book` / `icon` / `set` / `scene` / `douban` 同一入口），
保证下次按同样的命令能复现；临时脚本出完就删等于把流程断在仓库外，无法复核也无法迭代。
搜到的图对不上内容就删掉重来，**宁可自绘也不放错图**。

### 完成动作

`image:` 字段写入 → `npm run check:images`（配图归位与孤儿检查）→ 复扫全库无缺图无坏链 → `npm run build` 两次 → 抽查详情页海报引用。
（批量改 yaml 时注意行尾混排问题，见 §5。）重绘已有海报同样按本节决策链；若改了
`poster.mjs`，脚本要和图一起提交，别只推图片。

## 9. 验证清单（每次改完跑一遍）

```bash
npx eslint scripts/            # 0 错误（lib/ 也在覆盖范围内）
npm run build                  # 构建通过，注意「重新生成 N 个」是否合理
npm run build                  # 第二次构建应「重新生成 0 个」（304 机制未破坏）
```

- 涉及模板改动时，抽查 1 个详情页 HTML：meta/canonical/JSON-LD/files 块是否正常。
- 涉及 `data/*.yaml` 改动时，`git diff --numstat` 的加减行数应当只对得上预期改动，
  且不应出现整文件行尾变化。
- 只改 `AGENTS.md` 这类文档不影响构建（它不参与 `scripts/build.js` 的输出），提交推送即可。

## 10. TMDB 今日热门同步的筛选口径（年份窗口 2026-11-10 起 · 节目类黑名单 2026-11-11 起）

「我的网盘.TMDB今日热门影视每日同步」2026-11-18 起由本机 cron `50 3 * * *` 跑
`tools/quark-cron/trending-daily.mjs`，脚本 vendor 在 `tools/vendor/quark-resource-sync/`，不再依赖 WorkBuddy 自动化。
从 2026-11-10 起本站的筛选口径多一条**内容日期窗口**：

- **只收上映/首播落在近 12 个月内的今日热门**（滚动窗口，下限 = 运行当天往前推 12 个月）。
- 电影（含热门电影榜里归入动漫的动画电影）按 `release_date`；剧集（含热门剧集榜里归入动漫的动画剧集）按**目标季 `air_date`**，
  TMDB 没填才回落整剧 `first_air_date`。用季首播日是为了让跨年老剧出新一季仍能收，
  挡掉的是纯粹靠话题回潮的老片。
- 不合格自动顺延取下一条。被挡掉的候选进机读报告 `skipped[]`，reason 前缀固定 `年份窗口外`，
  **属预期，不是异常，不要写进「需要人工跟进」**；报告另有 `recency{enabled,months,from}`。
- 可调：`--recency-months N` 改窗口（非法值自动退回 12），`--no-recency` 关掉窗口、回到「只看今天热不热」的旧口径。
- **存量条目不回溯**：窗口只管今后的选择，已入库的老片一律不动、不下架。
- 被窗口挡掉的条目**不写** `trending-seen.json`，以后改窗口它们还能重新参与筛选。

**节目类黑名单**（2026-11-11 用户定夺：「以后脱口秀之类的节目尽量排除掉」）：候选 `genre_ids` 命中
TMDB 剧集类型 **10767 脱口秀 / 10764 真人秀 / 10763 新闻** 任一即跳过并顺延，与年份窗口同口径、同样**不写 seen**。

- 这三个 id 只出现在 TMDB **剧集**类型表（电影类型表没有），所以实际只挡剧集候选；`kind === 'anime'`
  不参与判断（动漫候选已要求 genre 16），避免误伤动画综艺。
- 机读报告 `skipped[]` 的 reason 前缀固定 `节目类（`，`report.program_filter{enabled,genres,label}`；
  飞书简报脚本 `BENIGN` 白名单已收录该前缀，卡片按「↷ 正常顺延」渲染，**属预期，不要写进「需要人工跟进」**。
- 放开只能人工显式加 `--allow-program`，无人值守轮次不要带。
- 存量不回溯：已入库的节目类条目不动。

规则实现与完整口径在 vendor 侧 `tools/vendor/quark-resource-sync/SKILL.md` 的 trending-sync 一节；改任何一侧都要同步另一侧。

## 11. 机器人与社媒推送（2026-11-17 并自私有仓 mybot）

> 2026-11-12 机器人与推送代码曾拆到私有仓 mybot；2026-11-17 并回本仓库（`bot/`、`push/`、
> `tools/feishu-reports/`），并入历史已用 `git filter-repo` 剥离全部凭据文件。
> **本仓库公开，凭据口径与私有仓时代相反：`bot/config.json` 与 `push/**/*.env` 一律不进 git**
> （已列 .gitignore），凭据只留各运行机本地（Windows 机、Debian 机），换机走 scp，不走 git。

### 11.1 安全红线

- `bot/config.json` 与各 `*.env` 含真实凭据（bot token、飞书应用密码），**绝不进公开渠道**：
  不进 git、不开 GitHub Pages、不给第三方 OAuth 应用仓库权限、协作者最小化。
- `bot/logs/`、`__pycache__/`、`*.pyc` 属运行态，不进 git（聊天日志含用户 id 与会话内容）。

### 11.2 架构约定

**共享层 + 平台适配层**，新增平台 = 新增一个目录，不动共享层：

- `bot/app/core/`（指令路由、站点客户端、配置读取、日志/去重/限频）平台无关；
  `bot/app/telegram/` 是 TG 端入口与 HTML 渲染层。
- `push/common.mjs`（读站点数据、判重、选片、CLI、凭据查找）平台无关；
  `push/telegram/tg-post.mjs`、`push/bluesky/bluesky-post.mjs` 只管各自文案渲染与 API 收发。
- `bot/config.json` 分段式：`common`（共享）/ `telegram` / `feishu`；
  入口用 `core.config.section_view` 把 `common` 与 `telegram` 合并成平铺视图。
- 群查询回复由 `core/handlers.py` 产出中立标记 `[网盘名](URL)`，
  `telegram/render.py` 转可点超链接；尾部（TG 订阅频道）由入口注入。
- `/f`、`/失效`、`/无`、`/无效`、`/错误` 经 `core/feedback.py` 走飞书推给管理员本人；
  搜索无结果时给一键反馈按钮。

QQ 端（NapCat / OneBot）已迁至绿联 NAS Docker，本仓库不含其代码、配置与启动器。

### 11.3 关键文件

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
| `bot/config.json` | 运行机本地真实配置（token、白名单、飞书凭据），**不入库** |
| `bot/config.example.json` | 模板，首次部署复制成 config.json 再改 |
| `bot/菜单.vbs` / `bot/菜单.hta` | 桌面启动器（仅 TG 动作）与界面 |
| `bot/check_vbs.py` | VBS 语法粗检 |
| `push/common.mjs` | 推送侧共享流水线（判重口径、选片算法唯一实现） |
| `push/telegram/tg-post.mjs` | 资源站 → Telegram 频道 `@myquark` |
| `push/bluesky/bluesky-post.mjs` | 资源站 → Bluesky |
| `push/*/wodewangpan-*.env` | 两个推送脚本的现役凭据，**运行机本地，不入库** |
| `tools/feishu-reports/` | 5 个飞书简报脚本（fill-files / 资源同步等例行任务的汇报端） |
| `deploy-cron.sh` | Debian cron 推送一键部署（幂等，凭据走 scp） |
| `deploy/wdp-scheduler/` | TG / Bluesky 推送**常驻调度器**（不依赖 LLM / WorkBuddy，:08 TG、:09 Bluesky，崩溃自重启）；与 `deploy-cron.sh` 二选一，严禁同时开（见其 README） |

### 11.4 运行（TG 机器人，Windows 机）

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

### 11.5 社媒推送（TG / Bluesky）

各平台互相独立，素材取自**本仓库**的 `data/*.yaml` 与 `static/images/`
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
想换称呼或目标地址，在运行机本地的 `~/.config/wodewangpan-tg.env` 里写 `TG_CONTACT_NAME` / `TG_CONTACT_URL` 覆盖。

链接展示口径（2026-11-16 起）：**有什么网盘链接就发什么**——夸克 / 百度 / 光鸭 / 阿里 / 天翼 / UC / 迅雷 / 115 / 移动，
以及数据里任意 `*_url` 分享字段（海报、详情页、官链等非分享字段除外），实现在 `push/common.mjs` 的 `NETDISK_PRESETS`。
判重口径仍按用户定死：只认夸克或百度链接，任一相同即同一份资源；其他链接**会发但不参与判重**；
两条链接都空才按 id 判重；**标题相同但链接不同照发**（系列电影、多季剧是不同资源）。

判重状态文件（2026-11-18 起）：

- `state/telegram-posts/posted.json`
- `state/bluesky-posts/posted.json`

两个文件已从 git 取消跟踪（`.gitignore` 的 `posted.json` 规则覆盖），只留运行机磁盘、不推送；删了会重复发。
`push/common.mjs` 的 `findStateFile()` 固定读这里，不再读 `~/.workbuddy`。

**定时调度（2026-11-18 定稿，Debian 13 本机）**：两个任务不依赖 LLM / WorkBuddy，用系统 cron，
每小时 TG `:03`、Bluesky `:05`，以 `marco` 用户身份在仓库根目录执行，日志落 `~/.cache/wdp-tg-post.log`
与 `~/.cache/wdp-bsky-post.log`；crontab 由标记块 `wdp-push` 管理，手工维护时不要动块外条目。
另一台电脑上的 WorkBuddy 自动化任务已停用，不要再按 `:08/:09` 或 rrule 描述现役调度。

备选 `deploy/wdp-scheduler/control.sh`（常驻调度器，:08 / :09）与上面的 cron **二选一**，同时开会每小时双发。

### 11.6 代码权威源

**本仓库是站点 + 机器人 + 推送代码的唯一实现**。定时任务 prompt 若仍指向 `telegram-push/`、
`bluesky-push/` 或私有仓 mybot 的旧路径，都已失效，应改成 `push/...` 与 `bot/...` 的仓库内路径。

- 凭据查找顺序：脚本**同目录**的 `*.env`（临时覆盖）→ `~/.config/*.env`（现役唯一权威）。
  本机实身是 `~/.config/wodewangpan-tg.env` 与 `~/.config/wodewangpan-bluesky.env`，权限 `600`；
  仓库里没有这两个文件（不进 git），换机部署走 scp，不走 WorkBuddy 目录。
- `posted.json` 判重记录留在仓库工作区的 `state/{telegram,bluesky}-posts/posted.json`，
  但已从 git 取消跟踪、不推送；复制或搬走会让已发过的资源重复发布。
- 飞书反馈凭据在运行机本地 `bot/config.json` 的 `feishu.tg`（也可用 `FEISHU_TG_APP_ID/APP_SECRET` 或
  `~/.workbuddy/feishu-app-tg.json` 覆盖）；专用通道缺凭据直接判失败，不回退默认应用。
- 夸克两条任务的简报卡片走飞书开放 API 直发（不依赖 lark-cli / WorkBuddy）：凭据在
  `~/.config/wodewangpan-feishu.env`（`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_TO`，权限 600）；
  唯一实现在 `tools/feishu-reports/feishu-api.mjs`，两个简报脚本共用。
