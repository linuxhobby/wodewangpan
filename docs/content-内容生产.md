# 内容 · 从网盘到站点条目

一条资源怎么从夸克网盘变成页面上的一张卡：流程、编号、失效修复、简介写法、配图、以及干这些活用的 skill。

> 适用：入库、改简介、换图、下架、skill 维护。构建与 URL 相关的禁忌见 [site-建站与开发.md](site-建站与开发.md)，上线之后的收录效果见 [growth-收录与流量.md](growth-收录与流量.md)。
> 最近更新：2026-10-13（由「入库流程 + 内容规范 + 配图规范 + skill 用法与维护」四篇合并）。

---

## 一、结论先写

入库三条最容易翻车的：

1. **先 rename 再出链**。顺序反了，出的那条链接直接作废。
2. **fid 每次 browse 都轮换**，不能跨步骤复用。旧 fid 出链会拿到 `{"code":21001,"msg":"文件找不到"}`。
3. **写完必须 `npm run build`**，否则 `public/` 里还是旧内容。

skill 三条：

1. **真身只有一份**，在 `~/.workbuddy/skills/`；`~/.codebuddy/skills/` 下同名目录是符号链接，别在两处各维护一份。
2. **不要把自维护 skill 放进客户端的 `builtin/` 目录**——客户端更新会清空它。稳定位置是 `~/.workbuddy/skills/`（TRAE 侧 `~/.trae-cn/skills/`）。
3. 两台机器之间经 `~/Documents/SynologyDrive/sync-skill/` 中转，`config.env` 含凭据，**不同步**。

---

## 二、八步入库流程

### 1. 扫描

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/scan-new.mjs
```

输出各分类总数、下一可用编号、未编号目录清单，疑似重复的会标 `⚠ 疑似重复于 → xxx`。

**先看重复标注再动手**：通常是用户转存了两次，停下来问清是「删重复 / 保留补录 / 不同版本」，不要擅自删除或重复入库。
`99-需要删除的移动到这里` 目录已排除；SHARE 下出现站点没有的分类，扫描会列出但**不入库**。

### 2. 确认范围

把待处理清单（目录名 + 拟定编号）给用户确认，再动网盘。

### 3. 重命名（必须在出链之前）

写 items JSON（**完整 FID + 原名 + 新名**），生成 16 位十六进制 batch ID，展示原名 → 新名对照后执行：

```bash
B=$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs rename --batch-id "$B" --items-file /tmp/rename-items.json
```

网盘目录格式：`001-片名`，三位补零，编号取该分类现有最大值 +1。已编号的目录不要动。

### 4. 重新 browse 取新 fid → 出链

```bash
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs share "<新 FID>" \
  --title "070-真相捕捉" --url-type 1 --expired-type 1
```

取返回的 `share_url`，要求是**公开、无提取码、永久**。若某条已提前出了链接，重命名后必须重新出链，并同步改 `data/*.yaml` 的 `quark_url`。

### 5. 抓信息（TMDB）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/tmdb.mjs search --type movie --query "片名"
```

TMDB 走 `api.tmdb.org`（`api.themoviedb.org` 本机可能被劫持），代理优先、失败自动直连。海报 CDN 连不上时改用豆瓣图源（见第八节）。

### 6. 写入数据

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/make-entry.mjs --data '{...}'
```

简介按第六节写，**不要照抄 TMDB 原文**。

### 7. 构建 + 冒烟

```bash
npm run build        # 看 SEO 提醒：薄内容条数是否下降
npm run serve        # 抽查详情页
```

### 8. 提交并推送

推 `main` 后 VPS 每 2 小时自动拉取重建，急发用 `FORCE=1 site-autoupdate`。
推送前先 `git status` 查有没有其他会话的未提交改动，**只 `git add` 自己那几个文件**，别 `git add -A`。

---

## 三、编号与 id 对照

| 网盘目录 | 站内分类 | id 前缀 | 数据文件 |
|---|---|---|---|
| `04电影` | 电影 | `mv-` | `movie.yaml` |
| `03电视剧` | 电视剧 | `tv-` | `tv.yaml` |
| `06纪录片` | 纪录片 | `dc-` | `documentary.yaml` |
| `05动漫` | 动漫 | `an-` | `anime.yaml` |
| `01游戏` | 游戏 | `game-` | `game.yaml` |
| `02应用` | 软件 | `app-` | `software.yaml` |
| `08电子书` | 电子书 | `bk-` | `ebook.yaml` |
| `010其他` | 其他 | `ot-` | `misc.yaml` |
| `09操作系统` | 操作系统 | `os-` | `os.yaml` |

- **按扫描返回顺序编号**，不要自作主张按年份 / 系列重排：站点排序是「`added` 倒序 → `id` 倒序 → 上映日期倒序」，重排会让系列作品在页面上倒过来。
- 编号只求唯一、不冲突；同系列多条不必强求连续。
- `id` 就是 URL（`/resource/mv-046/`），**绝不能改**。数据文件全部**英文命名**。页面标题**不带编号**，编号只用于网盘排序与资源 id。
- `added` 带时刻（`"2026-10-11 16:30"`，要加引号），首页排序更准。
- 新增分类涉及站点 5 处 + skill 2 处，漏项是静默的：构建不报错，但分类页 URL 变中文、缺图海报塌成文件夹样式。清单见 skill 的「新增分类：两边都要改」。

---

## 四、合集拆分（一个目录拆成多条）

网盘里一个「XX 合集」目录装着整系列时，拆成独立条目再入库：

1. **原目录留第一部**并改名（`025-速度与激情合集` → `025-速度与激情1`）。
2. 其余各集在**该分类目录下新建编号目录**，编号从当前最大值 +1 往后排。
3. 字幕等附属文件随正片一起移。
4. 外传 / 特别篇单独一个目录，不并入正传编号序列。
5. 顺序严格走 **rename → create-folder → move → share**：改名会让旧链接作废，出链必须放最后。
6. 站点侧：原 id 就地改写成第一部，其余按新编号新增。

详细命令与验收清单见 skill 的「合集拆分」章节（`~/.workbuddy/skills/quark-resource-sync/SKILL.md`）。

---

## 五、网盘改名 / 分享失效后的修复

用户在网盘里改目录名、改编号、或手动取消分享之后，站点数据与网盘会脱节。修复走三步，**顺序不能颠倒**：

```bash
# ① 目录名核对：按编号把网盘目录与 data/*.yaml 配对
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-drive-sync.mjs

# ② 链接核对：逐条 share-detail
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-share-links.mjs

# ③ 重出链并把新链接写回 YAML
node ~/.workbuddy/skills/quark-resource-sync/scripts/reshare-batch.mjs --from-check --apply
```

| 现象 | 含义 | 处理 |
|---|---|---|
| 目录名与站点标题对不上（`name_diff`） | 出链之后目录被改名 | 重新出链 + 改写 `quark_url` |
| `41004 分享的文件不存在` | 文件被挪走 / 删除 / 改名后旧链接指向丢失 | 目录还在，重出链即可恢复 |
| `41012 该链接已被用户取消分享` | 用户在网盘端主动取消 | **重建不了**，见下 |
| `41026 没有可分享的文件` | 重试出链时被拒（版权 / 风控） | 不是操作问题，重试无效 |

`check-drive-sync.mjs` **只比对目录名、不验链接**，改名修复必须再跑第 ② 步；反过来链接失效也不一定能在目录名上看出问题，两个脚本缺一不可。

**取消分享的边界（2026-10-12 实测）**：

- 重新 `share` 会拿 `41026`，连目录内单个文件也出不了链 —— **取消 = 不可恢复**。
- 这类目录通常只有占位 md 或干脆是空的（典型：`trending-sync` 建好目录后资源还没转存进去）。先 `browse` 看内容：空目录标「待补资源」，等资源到位再出链，**不要写 YAML**。
- 修不了的在收尾报告里逐条列出并问用户下架还是等补资源，不要反复重试。

**分类目录改名也要同步**：`008电子书`→`08电子书`、`007其他`→`010其他`、`99-待删除`→`99-需要删除的移动到这里`。改完必须同步 skill 里 `scan-new.mjs` / `check-drive-sync.mjs` / `reshare-batch.mjs` 的 `dir` 常量，否则该分类直接扫不到（静默漏掉，不报错）。

### 下架一条资源要清四处

构建**不会回收已删条目的旧产物**：

1. `data/*.yaml` 删条目（顺手改文件头部的条数注释）；
   ⚠️ **别用「按 `- id:` 切块再 join 重写」的脚本删**——它只保留条目块，会把文件开头的 `# XX资源（N 条）` 注释整段吃掉（2026-10-12 踩了，movie/tv/documentary 三个文件的头部一度全丢，只能从 `.bak` / git 历史捞回来）。删完务必校验：`js-yaml` 解析条数对得上、首行仍是 `#`。
2. `static/images/<id>.jpg` 删海报；
3. `public/` 里删 `resource/<id>/`、`img/<id>-*.webp`、`qr/<id>-*.svg`；
4. 重新构建 + 冒烟（首页 200、已下架详情页 404）→ 提交推送。

删除前确认 Git 已提交过当前状态，随时可从历史恢复（本轮 4 条有百度链接的若日后要恢复成纯百度条目，就是从历史里捞）。

---

## 六、简介文案规范

> 写任何一条资源之前先看这节。多数要求来自踩过的坑，而不是审美偏好。

### 字数

`scripts/lib/data.js` 的常量是全站唯一口径：

```js
export const MIN_DESC = 300;   // 正文下限，低于会被判薄内容
```

- `bodyLength()`：剥掉 `【…】` 标签与结尾 `｜TMDB x.x` 署名后按 Unicode 计字，**标签和署名不计入字数**，所以正文要实打实写满 300。
- 建议写 **320–400 字**，留余量，别贴着 300 卡线。上限 `MAX_DESC = 1200`，超了构建会截断。
- 经验值：一次写到「感觉够了」通常只有 **255–290 字**。补写的 1–2 句**分散在正文中间或结尾**，别全堆在末尾，比整段重写省事。
- 自查：`npm run list:short`（列出不足 300 字的条目，同时写 `.tmp/short-desc.md`；支持 `--max=320 --limit=50 --cat=纪录片`，传参要加 `--`）。

### 必须做到

1. **原创改写，不许照抄**。TMDB / 豆瓣简介原文网上到处都是，照抄等于再造一批重复内容，对 SEO 毫无价值。
2. **写具体**：这是什么（类型、年代 / 版本、背景）、核心看点（讲了什么故事 / 解决什么问题 / 独到之处）、适合谁（给什么人、什么场景）。
3. **每条要有区分度**。同一批几十条不能套一个模板，开头句式与叙述顺序都要换。

### 禁止

- **关键词堆砌**（反复塞「网盘资源」「下载」「高清」）
- **编造事实**：不确定的演职员、章节、获奖、评分、版本号一律不写。宁可写得朴素，也不能胡编。
- 空洞形容词堆砌（「精彩纷呈」「震撼人心」）
- 把同一段话换个名字复用
- **正文里用破折号**，一律改用逗号或冒号断句

### 特殊字段不要自己写

| 东西 | 谁负责 |
|---|---|
| 开头的 `【第 N 季 · 共 M 集】` | 电视剧必须有，草稿里不用写，`fill-desc.mjs` 从原文接回 |
| 结尾的 `｜TMDB 8.5`、`｜作者：[美] xxx` | 数据署名，不能删，工具自动接回 |

评分要 `toFixed(1)`：整数评分会写成 `｜TMDB 7` 而不是 `7.0`。

### 各分类的写法侧重

| 分类 | 重点 |
|---|---|
| 软件 | 干什么、解决什么痛点、相比同类有什么不同、适合什么平台与人群。别写成说明书，也别只抄官网文案 |
| 电子书 | 作者与体裁背景、核心主张、适合什么读者 |
| 操作系统 / 其他 | 写清版本；非影视资源的 `date` 填**版本发布日**并核实，查不到就留空 |
| 纪录片 | 题材、视角、讲了什么、适合什么兴趣的观众 |
| 电视剧 | 题材、主线、风格；季数集数标签由工具接回 |

套装 / 合辑的 `date` 填**套装自身出版时间**，不是里面某一本的首版年。

### 批量补写工具链

简介一律走工具，不要手改 YAML：改写好的正文放进 `.tmp/desc-draft.json`（`{ "id": "新正文" }`）→ 空跑确认 → `--apply` 落盘。工具只改 `description` 那一行，自动接回 `【…】` 头与 `｜…` 后缀，并以 JSON 双引号标量写回，不会破坏 YAML 结构。

```bash
node tools/fill-desc.mjs                                   # 空跑
node tools/fill-desc.mjs --apply                           # 落盘
node tools/fill-desc.mjs --draft=.tmp/desc-draft-tv.json    # 多批并行各用各的草稿
node tools/fill-desc.mjs --strict                          # 拦不合格稿
npm run build                                              # 验收
```

---

## 七、反向流程：TMDB 热门自动入库

`trending-sync.mjs` 从 TMDB 今日热门取电影 / 电视剧各 1 部，在网盘对应分类建编号目录 → 出链 → 入库 → 推送。

```bash
node scripts/trending-sync.mjs --dry-run --no-build --no-push   # 先看会做什么
```

⚠️ 真跑会**真的建网盘目录并 push**，务必先空跑确认。去重状态记在 `~/.workbuddy/quark-sync-cache/trending-seen.json`，空跑不写状态。

---

## 八、配图：图源与出图

### 存放与尺寸

- 配图放 `static/images/`，**全部平铺在一个目录，不按分类分桶**；文件名与资源 id 对应：`mv-046.jpg` / `.png` / `.webp` / `.svg`。
- 站点卡片尺寸 **240×360**，`fit: cover` 裁切（列表页与详情页共用同一张）。所以**源图宽 ≥240 即达标**，不必死磕高清——维基那种 ~256×364 完全够用。
- 首页品牌分享卡 `static/share.jpg` 由 `tools/share-poster.mjs` 生成；**改完站点配置（站名 / 分类）要重跑一次**，否则沿用旧图。

### 总原则：真实素材优先

**自绘是最后手段，返工率极高。** 有真实封面 / 海报 / 官方 logo 就用真实的，找不到再考虑合成。

| 图源 | 结论 | 说明 |
|---|---|---|
| `upload.wikimedia.org` | ✅ **首选** | 官方盒绘与 Commons 矢量 logo 都在这。**必须带浏览器 UA**，否则 403 |
| TMDB 节目海报 | ✅ | 影视类首选，走 `tmdb.mjs --poster` |
| iTunes `artworkUrl512` | ✅ | 应用图标 512 版 |
| simple-icons | ✅ | 适合取 OS / 软件标志 |
| 豆瓣图书 | ✅ | 电子书封面主力，见下 |
| weserv 图片代理 | ✅ | `https://images.weserv.nl/?url=<域名+路径>&w=1200`，专治 Cloudflare 403 |
| AppleInsider / Cult of Mac | ⚠️ | 直下必被 Cloudflare 403（返回 ~5KB HTML 假图），走 weserv 代理 |
| Fandom 全站 | ❌ | API 与 `Special:FilePath` 均超时 |
| MobyGames | ❌ | 403 |
| 官网猜路径（如 `assets.nintendo.com`） | ❌ | 试过，通不了 |
| Google Books / Open Library | ❌ | 配额 429 / 连接超时，别耗时间 |

**取维基官方图的标准三步**：① `prop=images` 找文件名 → ② `prop=imageinfo&iiprop=url|size|mime` 取直链 → ③ 带浏览器 UA 下载。盒绘直接 `cp`；矢量 logo 交给 `tools/icon-poster.mjs` 配品牌色合成竖版。

**假图识别**：下载完先 `file` 看一眼，输出要含 image/JPEG/PNG 且分辨率宽 ≥200。常见假图：Cloudflare 拦截页（文件头 `<!D`、约 5KB）、80×80 缩略图、GitHub 组织头像被清空后的默认 identicon。
**出图必须打开看一眼再入库**——标题顶边、图标偏小、identicon 假头像，只有看图能发现。

### 书籍封面（豆瓣）

1. 搜索页 `https://book.douban.com/subject_search?search_text=<书名>`，页面内嵌 `"items": [...]` JSON（含 title / abstract / cover_url / id）。正则在 `"items": [` 之后做括号配对切出数组再 `JSON.parse`。
2. 封面地址把 `/m/public/` 换成 `/l/public/` 即得大图（约 500×750，正好 2:3）。

要点：**必须带**浏览器 UA + `Referer: https://book.douban.com/`，否则 418/403；简单接口 `/j/subject_suggest?q=` 索引不全，优先用 `subject_search`；同一书名多版本用作者关键字或 `--pick <豆瓣id>` 指定；**有些条目封面是「封面+封底」展开图**，入库前务必看图确认。

### 自绘兜底工具

| 脚本 | 用途 |
|---|---|
| `tools/icon-poster.mjs` | 把应用图标合成 2:3 竖版海报（软件 / 音频等非影视资源） |
| `tools/book-cover-douban.mjs` | 豆瓣抓书封（电子书 `bk-` 优先用它，`--title/--out/--author/--pick/--list`） |
| `tools/book-poster.mjs` | 豆瓣查无此书时生成书封兜底 |
| `tools/set-poster.mjs` | 套装 / 合辑专用深色封面 |
| `tools/share-poster.mjs` | 首页品牌分享卡 `static/share.jpg` |

套装 / 合辑（豆瓣多半只有展开图或无图，如《斯蒂芬·金的王牌惊悚套装》17 册）用 `set-poster.mjs` 自排深色收藏版式（`--kicker/--prefix/--title/--badge/--label/--formats/--author` 都可缺省，`--accent` 换主色，输出 480×720）。
排版经验：氛围光别做大范围晕染（发糊像污渍），收成书名背后一小片光池 + 四角压暗才干净。

---

## 九、三个 skill

### 分工

| skill | 版本 | 职责 |
|---|---|---|
| `quark-resource-sync` | v1.11 | 网盘 → 站点的同步编排：扫描、编号、出链、抓 TMDB、写 YAML、热门反向同步、**合集拆分** |
| `quarkclouddrive` | 1.0.24（官方，自动更新） | 夸克网盘 CLI 本体：`browse` / `rename` / `share` / `search` / `upload` 等 |
| `quark-upload-share` | — | 上传本地文件到夸克并生成公开分享链接 |

`quarkclouddrive` 是官方 skill，会自行更新。升级它必须用 `bash scripts/install.sh`，**不要用 `quark-drive.cjs update`**（后者只更新 CLI 本体，不动 SKILL.md 与 references）。

配置加载（v1.9 起统一）：所有脚本静态 `import { cfg, requireCfg, SKILL, CACHE, TMP } from './lib/config.mjs'`，优先级**环境变量 > config.env > 自动探测**，缺关键配置会退出并提示，不再静默失败。查各项来源（不打印值）：

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/lib/config.mjs
```

`config.env` 五个键：`TMDB_TOKEN`（Read Access Token，泄漏会被冒用配额直到吊销）、`PROXY`（TMDB 走代理优先，失败自动直连）、`REPO`（站点仓库绝对路径）、`SHARE_FID`（夸克 SHARE 目录标识）、`QUARK_CLI`（CLI 绝对路径，留空自动探测）。

### 安装位置的教训（2026-10-11 事故）

- **不要把自维护 skill 放在 `~/.trae-cn/builtin/` 下**。TRAE 客户端更新会清空 `builtin/`（实测 skill + CLI 整个消失，仅 `~/.trae-cn/quark-sync-cache/` 幸存）。
- 稳定位置：**`~/.trae-cn/skills/`**；WorkBuddy 侧 **`~/.workbuddy/skills/`**。
- 母本永远在 SynologyDrive，本地实例丢了随时可重建。

### 从上游升级的合并流程

上游 = 兄机经 `~/Documents/SynologyDrive/sync-skill/` 推过来的版本。固定三步：

```bash
S=~/Documents/SynologyDrive/sync-skill/quark-resource-sync
D=~/.workbuddy/skills/quark-resource-sync

# 1. 覆盖（只拷有改动的文件）
cp "$S/SKILL.md" "$D/SKILL.md"
cp "$S/references/"*.md "$D/references/"
cp "$S/scripts/"*.mjs "$D/scripts/"
cp "$S/scripts/lib/config.mjs" "$D/scripts/lib/config.mjs"

# 2. CRLF → LF
for f in "$D/SKILL.md" "$D/references/"*.md "$D/scripts/"*.mjs "$D/scripts/lib/config.mjs"; do
  perl -pi -e 's/\r\n/\n/g' "$f"
done

# 3. 装回 macOS 专属章节（幂等，锚点缺失会打印 !! 提示）
~/.workbuddy/skills/.quark-macos-localize.py
```

判定「有没有真的更新」要看内容而不是时间戳（对方与自己都会写这个目录）：

```bash
for f in SKILL.md references/*.md scripts/*.mjs; do
  diff -q <(tr -d '\r' < "$S/$f") <(tr -d '\r' < "$D/$f") >/dev/null 2>&1 \
    && echo "一致: $f" || echo "差异: $f"
done
```

合并结束后把本机结果**回写中转目录**。**该目录 rsync 改名会被 Synology Drive 拦（`Operation not permitted`），一律用 `cp` 覆盖**，并排除 `config.env`、`.quarkclouddrive`、`workbuddy/`（search 缓存）。
若源结构大改（如脚本统一改用 `lib/config.mjs`），全量覆盖后重跑「路径适配清单」。

验证三件套：`node --check` 全部脚本 → `node scripts/lib/config.mjs` 诊断配置 → `scan-new.mjs` 实测连通。

### 灾后重建流程（本地实例丢失时，约 10 分钟）

```bash
# 1. 复制母本
cp -R ~/Documents/SynologyDrive/sync-skill/quark-resource-sync ~/.trae-cn/skills/
# 2. 复制 CLI（从 WorkBuddy，登录态在客户端不受影响）
cp -R ~/.workbuddy/skills/quarkclouddrive ~/.trae-cn/skills/
# 3. 路径适配（见下表，前缀统一改 ~/.trae-cn/skills/）
# 4. config.env 从 WorkBuddy 继承凭据（TMDB_TOKEN/PROXY/REPO/SHARE_FID 原样，QUARK_CLI 指向新位置），chmod 600
# 5. 验证三件套
```

### 路径适配清单（合并 / 重建时必查）

| 文件 | 要改的点 |
|---|---|
| `scripts/lib/config.mjs` | `CACHE` 常量 → `~/.trae-cn/quark-sync-cache`；`detectCli` 的 roots 首选 `'.trae-cn'` |
| `SKILL.md` | 全部 `~/.workbuddy/skills/` → `~/.trae-cn/skills/`（含 Windows 示例路径）；「macOS 实测」表更新为本机实况 |
| `references/troubleshooting.md` | CLI 路径 2 处 |
| `scripts/install.mjs` | 默认 target、Windows 示例、config.env 继承候选路径 |
| 脚本注释里的 CACHE 路径 | `app-batch.mjs` / `process-batch.mjs` / `trending-sync.mjs` |
| `config.env`（自持，不从母本覆盖） | `QUARK_CLI` 指向 `~/.trae-cn/skills/quarkclouddrive/scripts/quark-drive.cjs` |

替换完用 `grep -rn '\.workbuddy' <skill目录>` 终检，允许残留的只有 detectCli 回退候选与示例。

### 两端谁更新（反向同步）

三方版本号要放在一起看：中转目录可能是**落后**的一方。

| 情形 | 处理 |
|---|---|
| 上游 SKILL.md 版本号更高 | 按「合并流程」合并进来 |
| 本机更高（如 skill 官方自动升级） | 反向 `cp` 回中转目录，让另一台机拉到最新版 |
| 版本号相同但内容不同 | 多半是多机各自改过，`diff` 后人工合并 |

### WorkBuddy 与 CodeBuddy 联建

约定：`~/.workbuddy/skills` = 唯一真身，`~/.codebuddy/skills` = 只放符号链接。

```bash
~/.workbuddy/skills/.link-codebuddy-skills.sh            # 建/补链接（幂等）
~/.workbuddy/skills/.link-codebuddy-skills.sh --status   # 看每个 skill 的链接状态
~/.workbuddy/skills/.link-codebuddy-skills.sh --only a,b # 只链指定的
~/.workbuddy/skills/.link-codebuddy-skills.sh --dry      # 只看不落地
```

安全规则：`~/.codebuddy/skills/` 下**已存在的真实目录一律跳过**，不覆盖不删除（可能是对端独有内容）；指向错误目标的链接会自动修正。装完新 skill 跑一次即可。

### 脚本清单（`quark-resource-sync/scripts/`）

| 脚本 | 作用 |
|---|---|
| `scan-new.mjs` | 扫描 SHARE 下 9 个分类，输出待编号目录与下一可用编号 |
| `tmdb.mjs` | TMDB 搜索 / 详情 / 海报 |
| `make-entry.mjs` | 生成单条 YAML 条目 |
| `process-batch.mjs` / `app-batch.mjs` | 批量处理（内建 rename 后刷新 fid 再 share） |
| `check-desc.mjs` | 检查某分类简介字数达标情况 |
| `check-drive-sync.mjs` | 核对网盘目录名 vs 站点标题（**只比对名字，不验链接**） |
| `check-share-links.mjs` | 逐条 `share-detail` 验链接是否还有效、是否被改名 |
| `reshare-batch.mjs` | 对失效 / 改名条目重新出链，`--apply` 回写 `data/*.yaml` |
| `backfill-desc.mjs` / `backfill-icons.mjs` / `backfill-tv-spec.mjs` | 存量补齐（简介 / 图标 / 剧集季数） |
| `placeholder-fill.mjs` | 缺资源目录补占位说明文件 |
| `trending-sync.mjs` | TMDB 热门反向入库（**会真建目录并 push**） |
| `install.mjs` | 安装向导 |
| `lib/config.mjs` | 配置统一入口 |

---

## 十、相关

- 本机路径与命令速查、构建与部署禁忌：[site-建站与开发.md](site-建站与开发.md)
- 编号 / 条数变了之后的 SEO 影响：[growth-收录与流量.md](growth-收录与流量.md)
- 待办与变更：[record-待办变更与规划.md](record-待办变更与规划.md)
- skill 完整文档（不在本仓库）：`~/.workbuddy/skills/quark-resource-sync/SKILL.md`
