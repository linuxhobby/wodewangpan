# docs · 站点经验总览（单一文档）

本站（`www.wodewangpan.top`，我的网盘资源站）的经验类内容**统一在本篇**：踩坑、流程、规范、SEO、待办、变更。原 `docs/` 下按主题拆的多篇已合并于此，删重去旧。

> **原则**：结论只写一份；过程与历史细节在 Git 历史里随时能捞，不占正文。根 `README.md` 只讲「怎么把站点跑起来」，冲突以本篇为准。

---

## 一、铁律：改 URL / 数据 / 服务器之前必读

（这类错了不报错，只会悄悄丢排名）

- **`id` 就是 URL**（`/resource/mv-046/` 的 `mv-046` 取自 `data/*.yaml` 的 `id`）。改 id = 换地址 = 已收录页 404。**绝不能改**。
- **分类 slug 改别名 = 换 URL**（`config/site.yaml` 的 `slugs`）。已收录后改 = 丢排名。
- **标签 slug 三级取值，别名表只增不改**：`scripts/lib/data.js` 的 `tagSlug()` → ① `config/tags.yaml` 手写别名（34 个英文 slug，**永远别动**）② 拼音兜底 ③ 原样。已落到拼音 URL 的标签事后补别名 = 换 URL，所以 `tagSlugs` 只增不改。
- **`pinyin-pro` 必须在 `dependencies`**：它决定标签 URL，放 devDependencies 会让部署机 `npm i --omit=dev` 时缺席 → 线上退化成 `%E7%A7%91%E5%B9%BB` 编码路径，两边不一致，直接丢排名。
- **标签 slug 撞车**：两标签算出同 slug 会写进同一 `/tag/xxx/` 且构建**不报错**，撞了就在 `config/tags.yaml` 给其一配别名。

---

## 二、前端与样式约定

- **页面宽度只有一个开关**：`<body class="page--wide">`（`layout()` 的 `wide` 默认 `true`）。新区块用现成的 `.wrap`/`.cats`，**不要**再造 `.xxx--wide` 变体（曾因此整页比全站窄一圈）。
- **样式只在 `theme/assets/style.css`**：不写内联 `style=`、不写 `<style>` 块。颜色/字号/行高/圆角/间距一律用 `:root` 令牌；区块里**写死数值 `npm run audit:css` 会报错**。
- **卡片结构只改一处**：`theme/assets/card.js` 被构建端 `render.js` 与浏览器端 `app.js` 共用，**改结构只改这一个文件**，两边各抄必致首屏与「加载更多」长得不一样。
- 合并 CSS 规则前先查目标元素的父元素有没有实底/反白状态（曾把 `cat__n` 合并丢色）。
- 跨容器复用同一组链接时查权重：`.crumb a`（0,1,1）会压暗详情页面包屑里的邀请/热榜链接，需用 `:not()` 排除（`.page__invite`/`.page__hot`）。

---

## 三、配置与数据目录

- `config/site.yaml`、`config/tags.yaml` 是配置；`data/*.yaml` 一个分类一个文件，全英文命名。
- `config/tags.yaml` 三档「标签要不要出页」：`tagExclude`（不建页，标签照常显示但不可点）、`tagOverlapAllow`（建页，接受重合）、`tagMeta`（建页 + 定制 title/h1/desc）。`tagOverlapMax: 0.8` 是 Jaccard 告警线（重合数/两页并集）。某标签归哪档是**判断不是计算**，写配置时留一句为什么。
- 遍历 `data/` 必须排除配置：`scripts/lib/data.js` 的 `NON_RESOURCE_FILES = new Set(['site.yaml','tags.yaml'])`。**新增配置文件只改这一处**（漏改会让 `syncHeaderCounts()` 去改写该文件头部条数注释，埋雷）。

---

## 四、构建与产物

- **内容未变不覆盖**，为的是让蜘蛛命中 304：`scripts/build.js` 的 `write()` 写盘前比对，相同则沿用旧文件并 `utimes` 保留 mtime。实测二次构建 722 文件全沿用（58.7s → 34.9s）。
- **静态资源版本号用内容哈希，不用 commit**：用 commit 会让每次提交改写所有页面的 CSS/JS 链接，mtime 全刷，304 落空。
- **改完数据必须 `npm run build`**：`public/` 不热更新。
- `syncHeaderCounts` 会改 YAML 头部条数注释（正常）。
- **下架条目 `public/` 不自动回收**，见第六节「清四处」。
- `robots.txt` 与 `sitemap.xml` 是 `build.js` 生成产物，手改线上文件下次构建会被覆盖——要改规则改 `build.js` 模板字符串。
- **`ads.txt` 源文件在 `static/ads.txt`**（当前一行：`google.com, pub-5363695594162175, DIRECT, f08c47fec0942fa0`），由 `build.js` 复制到 `public/` 根目录，用于 AdSense「ads.txt 片段」验证。构建**不整体复制 `static/`**，新增根目录静态文件必须在 `build.js` 里显式拷贝。

---

## 五、部署与 Nginx

- 推 `main` 后 VPS **每 6 小时自动拉取重建**（`0 */6`）；急发：`ssh <host> 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'`（约 30 秒，无新提交直接 `exit 0`，频率只决定上线延迟上限）。
- `wdwp-autoupdate.sh` 不覆盖 nginx conf，线上直改 nginx 安全，但**记得回写 `deploy/` 镜像**。
- **`robots.txt` 只挡子路径** `Disallow: /*/search-index.json`；根 `/search-index.json` 是 Googlebot 渲染「加载更多」的通道，挡了自断发现路径。
- 410 规则（`^/.+/search-index\.json$`）**必须排在静态资源 location 之前**（nginx 正则 location 取首个命中）。
- `gzip_types` 必须带 `text/xml`（`mime.types` 把 `.xml` 映射成 text/xml，只写 application/xml 时 sitemap/feed 完全不压缩）。
- **nginx 四层策略**（仓库镜像在 `deploy/`）：① `return 410` 已死 URL（`/resource/*/search-index.json`）② `return 444` 漏洞扫描 ③ `return 403` 零回流爬虫 ④ robots.txt 礼貌层。
  - 410 而非 404：让蜘蛛衰减更快（子路径从 80→2 次/天）。
  - `if ... return` 放 server 块最前（先于 http→https 的 if，避免探测白吃 301）；server-rewrite 阶段早于 preaccess，故优先于 `limit_req`。
  - 444 绕开 `key.txt`/`baidu_verify_*.html`/`.well-known/acme-challenge/`/根 `search-index.json`。
- 改 nginx 三步走：`cp -a` 备份 → 改 → `nginx -t` 通过才 `reload`；`nginx -T` 确认文件真被载入。

---

## 六、内容生产（从网盘到条目）

### 入库八步（摘要）

1. 扫描 `scan-new.mjs`，**先看重复标注**（转存两次会标 ⚠）再动手。
2. 确认范围（目录名 + 拟定编号）给用户。
3. **先 rename 再出链**（顺序反了链接作废）。
4. 重新 browse 取新 fid → `share`（公开/无码/永久）。
5. 抓 TMDB 信息（`api.tmdb.org`，代理优先）。
6. `make-entry.mjs` 写入，**简介不照抄 TMDB 原文**。
7. `npm run build` + 抽查详情页。
8. 提交推送（`git status` 查别的会话改动，只 `git add` 自己文件，别 `-A`）。

### 编号与 id

| 网盘目录 | 站内分类 | id 前缀 | 数据文件 |
|---|---|---|---|
| `04电影` | 电影 | `mv-` | `movie.yaml` |
| `03电视剧` | 电视剧 | `tv-` | `tv.yaml` |
| `06纪录片` | 纪录片 | `dc-` | `documentary.yaml` |
| `05动漫` | 动漫 | `an-` | `anime.yaml` |
| `01游戏` | 游戏 | `game-` | `game.yaml` |
| `02应用` | 软件 | `app-` | `software.yaml` |
| `08电子书` | 电子书 | `bk-` | `ebook.yaml` |
| `07课程` | 课程 | `cs-` | `course.yaml` |
| `010其他` | 其他 | `ot-` | `misc.yaml` |
| `09操作系统` | 操作系统 | `os-` | `os.yaml` |

- 按扫描顺序编号，别按年份/系列重排（排序是 `added`→`id`→日期倒序，重排让系列在页面上倒过来）。
- `id` 是 URL 绝不能改；页面标题不带编号；`added` 带时刻（`"2026-10-11 16:30"`，要引号）排序更准。
- 新增分类动站点 5 处 + skill 2 处，漏项静默（构建不报错，但分类页 URL 变中文、缺图海报塌成文件夹样式）。

### 合集拆分

原目录留第一部并改名 → 其余各集新建编号目录 → 顺序 `rename → create-folder → move → share`（出链最后）→ 站点侧原 id 改第一部、其余按新编号新增。

### 网盘失效修复（顺序不能颠倒）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-drive-sync.mjs   # ① 只比目录名
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-share-links.mjs  # ② 验链接
node ~/.workbuddy/skills/quark-resource-sync/scripts/reshare-batch.mjs --from-check --apply  # ③ 重出链写回 YAML
```

- `41004` 改名可重出链；`41012`/`41026` 用户取消/风控，**不可恢复**，标「待补资源」或问下架。
- 分类目录改名须同步 skill 的 `dir` 常量（否则该分类静默扫不到）。

### 下架一条要清四处

1. `data/*.yaml` 删条目（改头部条数注释；**别用「按 `- id:` 切块重写」脚本删**——会吃掉文件头 `# XX资源（N 条）` 注释，用 js-yaml 校验）。
2. `static/images/<id>.jpg` 删海报。
3. `public/` 删 `resource/<id>/`、`img/<id>-*.webp`、`qr/<id>-*.svg`。
4. 重新构建 + 冒烟（首页 200、已下架详情页 404）→ 提交推送。

> **SEO 视角**：下架是 SEO 动作。构建期输出下架清单 + nginx 410/301（见第五/六节），把 Googlebot 重试从 33 次/天压下来。

### 简介文案规范

- 字数：`scripts/lib/data.js` 的 `MIN_DESC = 300`（标签 `【…】` 与结尾 `｜TMDB x.x` 署名不计入），建议写 **320–400**；上限 `MAX_DESC = 1200` 截断。自查 `npm run list:short -- --max=320`。
- 必须：原创改写、写具体（类型/年代/看点/适合谁）、每条有区分度。
- 禁止：关键词堆砌、编造事实、空洞形容词、复用同段、**正文用破折号**（改逗号/冒号）。
- 特殊字段别自己写：`【第 N 季 · 共 M 集】` 与 `｜TMDB 8.5` 由 `fill-desc.mjs` 接回。
- 各分类侧重：软件（干什么/痛点/差异）、电子书（作者与体裁/主张/读者）、OS·其他（版本，非影视 `date` 填版本发布日）、纪录片（题材/视角）、电视剧（题材/主线）、课程（内容/节数/基础/学完能做）。
- 批量补写工具链：正文放 `.tmp/desc-draft.json`（`{ "id": "新正文" }`）→ `node tools/fill-desc.mjs`（空跑）→ `--apply` 落盘（只改 description，自动接回头尾）。

### 配图：图源与兜底

- 放 `static/images/`，全站平铺，文件名 = id。卡片 240×360 `fit:cover`，源图宽 ≥240 即达标（维基 ~256×364 够用）。
- **真实素材优先**：Wikimedia ✅首选（带浏览器 UA）／ TMDB 海报 ✅ ／ iTunes 512 ✅ ／ simple-icons ✅ ／ 豆瓣图书 ✅（电子书主力）／ weserv 代理 ✅；Fandom／MobyGames／Google Books ❌。课程无 TMDB 海报：官方图→维基→`tools/poster.mjs icon` 合成。
- **假图识别**：下载完 `file` 看 image/JPEG/PNG 且宽 ≥200；出图必须打开看一眼（`app.js` 取图、图标偏小、identicon 假头像只有看图能发现）。
- **自绘兜底** `tools/poster.mjs`（douban/book/icon/set 四模式）+ `tools/share-poster.mjs`（首页品牌分享卡 `static/share.jpg`，改站名/分类后重跑）。

### 三个 skill

| skill | 版本 | 职责 |
|---|---|---|
| `quark-resource-sync` | v1.11 | 同步编排：扫描/编号/出链/抓 TMDB/写 YAML/热门反向同步/合集拆分 |
| `quarkclouddrive` | 1.0.24（官方，自动更新） | 夸克 CLI：`browse`/`rename`/`share`/`search`/`upload` |
| `quark-upload-share` | — | 上传本地文件并生成公开分享链接 |

- 真身只在 `~/.workbuddy/skills/`；`~/.codebuddy/skills/` 是符号链接。**别放进客户端 builtin/**（更新会清空）。
- 升级 `quarkclouddrive` 用 `bash scripts/install.sh`，不用 `quark-drive.cjs update`。
- 两台机经 `~/Documents/SynologyDrive/sync-skill/` 中转，`config.env` 含凭据不同步。
- 脚本清单（`quark-resource-sync/scripts/`）：`scan-new` / `tmdb` / `make-entry` / `check-desc` / `check-drive-sync` / `check-share-links` / `reshare-batch` / `backfill-*` / `placeholder-fill` / `trending-sync` / `install` / `lib/config`。

---

## 七、SEO 与流量

### 当前未闭环问题（按优先级）

- **P1 补 `config/site.yaml` 的 `verification`**：Google ✅已配（2026-11-05）；Bing 待 `msvalidate.01` 码；百度验证 ✅保留（不再关注其收录）；360/搜狗 已放弃。
- **P2 百度收录（已搁置）**：根因资质（`icp` 空 + 香港节点无备案）。2026-11-05 决定：**百度站长验证保留，但不再跟踪其收录、不做专项 SEO 推送**；站点不备案，破局成本不划算，主动 SEO 只投 Google + Bing。360/搜狗 同理放弃。
- **P3 下架留 404 尾巴**：构建期输出下架清单 + nginx 410/301（见第五/六节）。
- **P4 Yandex 断档**（观察）／ **P5 AI 爬虫静默**／ **P6 360 断档 + 301 单跳核对**／ **P7 首页体积**（noscript 收敛为 9 分类 + `/all/`）。

### 判断准则：值不值得放行

**看 referer 真人回流，不看抓取量**。零回流的 SEO/AI 爬虫（Semrush/Ahrefs/MJ12 + ShapBot/KeenableBot 等）403；会带流量的（Google/Yandex/Bing/百度 + Perplexity/OAI/Claude-SearchBot）保留。全站真人 UV 九天仅 186，三家 AI+四家 SEO 工具合计 7,723 次请求。

- **引擎策略（2026-11-05 定，当日修正）**：站点无法 ICP 备案，**放弃 360/搜狗等境内引擎**；百度**站长验证保留**（已验证、无害），但**不再关注其收录、不做百度专项 SEO 推送**。主动 SEO 只面向 **Google + Bing**（Bing 靠已接好的 IndexNow 实时推送，全量 935 条已推，2026-11-05）。Yandex 仍保留（IndexNow 覆盖）。

### 抓取预算结论

- **304 才是腾预算的手段**（改「内容未变不覆盖」后重复访问从 200 变 304）。
- 版本号跟内容走，不跟 commit。
- 推翻的结论（别回头）：冻结首页 lastmod ❌、调 priority/changefreq ❌（Google 忽略）、整条屏蔽 search-index.json ❌（只挡子路径）。
- 页面存在理由：`/all/`（蜘蛛一次抓全站主通道，保持进 sitemap）、详情页相关推荐 10 条、热门标签前 20、`/tags/` 总览、图片 sitemap `image:loc`、真实 lastmod、占位海报排除出图索引。

### 日志解析三坑

1. 按引号切字段再匹配 URI（整行 grep 会误报，如 UA 含 `.php`）。
2. 服务器 mawk：不支持 `{3}` 区间、正则 `{` 当区间、超长 alternation 报 runaway → 用 `index(u,"kw")`。
3. 444 看 curl 退出码（52）+ 别 `set -e`。

### 真人流量估算

- 下界（可信）：`vid` cookie + `/hit` 信标 → UV 186/9天 ≈ 20/天。
- 上界（宽）：浏览器 UA + 真实路由 + 剔单 IP>30 次 → 944 IP。
- 识别伪装脚本：固定过时 UA / 请求-IP 比高 / 云厂商 IP / 扫描路径占比高（命中两条即非人）。

### 复核方法

权威只有两处：站点访问日志（蜘蛛来没来、抓了啥、返回啥）+ 各家站长后台（精确收录量）。**别从数据中心 IP 跑 `site:` 查询**（Google/百度返空或验证码，Bing 返查询词回显假阳性）。

> 姊妹站（院采雷达）同类问题在 `~/Documents/GitHub/yuancaileida/docs/SEO-收录与流量.md`。

---

## 八、功能模块

### QQ 群查询机器人（2026-11-10 上线）

- 代码在本站仓库的 `bot/` 目录下（原独立目录 `wodewangpan-bot` 已于 2026-11-10 并入）。**与站点构建完全隔离**：`npm run lint` 只扫 `scripts theme/assets tools`，`scripts/build.js` 只从 `theme/`、`static/`、`share.jpg` 等显式路径取文件、从不扫描仓库根目录，所以 `bot/` 不会被打进 `public/` 上线。
- `bot/config.json`（真实群号）与 `bot/logs/` 走 `bot/.gitignore`，不入库；`bot/config.example.json` 是模板，首次部署复制成 `config.json` 再改。
- 链路：群消息 → NapCat（真 QQ 号 909008620「艾特我」）→ OneBot HTTP 上报 `127.0.0.1:6700` → 查 `www.wodewangpan.top` → 回群。
- **只读线上站**：数据源只有 `/search-index.json` 与 `/resource/<id>/` 两个 HTTP GET，不读 `data/*.yaml`，不依赖仓库，也不写任何本地资源。
- 群里以 `/` 开头**免 @** 直接执行；裸关键词仍需 @（否则正常群聊会被当搜索，刷屏且招风控）。开关 `config.json` 的 `group_no_at_slash`。

| 指令 | 作用 |
|---|---|
| `/搜索 关键词`（`/s` `/搜` `/找` `/查` `/so`） | 回「名称 \| 类型 \| 网盘」+ 链接，最多 3 条 |

回复版式（2026-11-10 定）：一条资源一行标题（名称 | 类型 | 网盘名），下一行放该网盘的链接；同一资源有第二个网盘时再接一组「网盘名（提取码）」+ 链接；资源之间空一行；`网站地址：` 只在末尾出现一次。提取码从详情页 `.linkrow__code > b` 读，链接顺序按页面（夸克在前、百度在后）。

**富媒体试过但不可用**：OneBot 的 `markdown` 段被 QQ 内核拒绝（`NodeIKernelMsgService/sendMsg` 超时，普通 QQ 号没有签名能力，NapCat 源码里该转换器标注 `// Need signing`）；Ark 卡片（`json` 段）能发出去、retcode 0，但多数客户端提示「发送者版本过低，无法展示内容」。所以最终走纯文本，靠 QQ 自动识别 URL 成可点击。
| `/最新` | 最近上架 8 条 |
| `/今日` | 今天更新，无则退到最近一次更新日 |
| `/分类` | 各分类条数 |
| `/随机` | 随机一条 |
| `/帮助` | 指令表 |

- 拼音直接命中：索引自带 `py`/`py1`（全拼 + 首字母），`qingzhixiang`、`qzx` 都能搜。
- 端口全绑 `127.0.0.1`：NapCat WebUI `6099`、OneBot HTTP `3000`、机器人上报 `6700`。

**踩过的坑（都很难查，别再踩）**

1. **HTTP 上报回 204 不能带响应体**。回 204 又写 `{}` 会让 Node 端按规范忽略这 2 字节、残留在 keep-alive 连接里，之后每个事件都报 `Parse Error: Expected HTTP/, RTSP/ or ICE/`；curl 却能容忍，本地测试全绿。正确做法是回 200 且 `Content-Length` 与响应体严格一致。
2. **上报请求体可能是 chunked**。只读 `Content-Length` 会把请求体当 0 字节，事件被静默丢弃，表现为「NapCat 上报成功、机器人毫无反应」。两种传输都要支持。
3. **改 `config/onebot11_<uin>.json` 不热加载**，必须重启 NapCat（杀 `NapCatWinBootMain` 与全部 `QQ` 进程后再启动）。
4. **重启后不会自动登录**。`config/webui.json` 的 `autoLoginAccount` 填小号 QQ 号（或用环境变量 `NAPCAT_QUICK_ACCOUNT`），启动即快速登录，不用重新扫码。
5. **NapCat 4.18.42 有 bug**：注入成功但核心静默不启动，无端口无日志，报 `error code v2:-8`。**锁 4.18.41**，别升级。
6. **不能拿机器人自己的号发指令**。号主自己发的消息是 self message，默认不上报，看起来就像「群里没反应」，其实是指令根本没送到。
7. WebUI 的 `/api/auth/login` 从外部 curl 调不通（返回 `token is empty` 或 `Unauthorized`），**直接改配置文件比调 API 快**。
8. NapCat 的 `logs/` 默认是空的（`fileLog:false`），日志只在启动器控制台；排查先看那个黑窗口。

**运维**

- `一键启动.bat`：先拉起 NapCat，轮询 `3000` 端口就绪后再起 bot，避免竞态。
- 群白名单在 `config.json` 的 `group_whitelist`（当前只放行 `1045824859` 我的网盘资源站）。
- 限频兜底：同一人 15 秒、全局每分钟 20 条；回复拆条间隔 0.6 秒。
- 风险：协议端是真实 QQ 号，高频发外链是主要封号触发点，别用主号挂。

### 热门榜 `/hot/`

- 入口：首页/分类页 H1 行右侧「热榜 TOP 30 →」+ 详情页面包屑（同组 `.page__invite/.page__hot`，面包屑里用 `:not()` 排除防褪色），已进 sitemap。
- 排序：按浏览量(PV)/人数(UV)，前端即时切换，默认 PV 降序 Top30。
- 数据 `/stats.json`（cron 10 分钟增量，SQLite `/var/lib/sitestats/stats.db`）→ 前端 fetch 排序；与详情页「N次浏览·M人」同口径。取不到显示「统计暂不可用」。
- **迁移服务器排名全变是正常的**：统计库只在服务器本地，换机从零。保留旧排名：先 `scp 旧机:/var/lib/sitestats/stats.db /tmp/old-stats.db`，再 `OLD_STATS_DB=/tmp/old-stats.db bash deploy/enable-stats.sh`（须在新机未跑统计前导入）。

### 资源分享功能

- 分享的是**资源包文本**（网盘在前、页面在后），不是页面 URL（平台卡片渲染不可控，且群里要多走一步）。
- 格式：`{标题}（{年份}）·{分类}\n{一句话概要}\n{网盘}：{链接}...\n更多同类→{canonical}`。概要取简介首句（`summaryOf()`，≤60 字，全角 `｜` 切尾标，退到句读断）。
- 桌面端：分享(`navigator.share`→退化复制) / 复制资源信息(富文本带海报) / 复制海报(image/png 给微博) / 微信二维码。
- 富文本：`navigator.clipboard.write()` 同时写 `text/html`(海报`<img>`最前+各行) + `text/plain`；不支持就整段退回纯文本。海报用绝对地址、占位图不复制。
- 微博只吃图片文件 → 单独「复制海报」按钮（webp→canvas→`image/png`；`write()` 同步发起，异步转码塞进 `ClipboardItem` Promise 值）。**不并入「复制资源信息」**（微信会走图片分支丢文字）。
- 微信网页分享无官方 SDK：放本页 URL 二维码 + 系统面板。
- 实现：`render.js`(`shareTextOf`/`sharePoster`/`detail__share`) + `app.js`(`copyPoster`/`copyPacket`/`packetHtml`) + `assets.js`(`writeShareQr`) + `build.js`。

### 推广 / 联盟链接

2026-11-02 起全站取消所有阿里云联盟邀请链接（标题栏 `PAGE_INVITES` 置空，详情页 OpenClaw 推广移除），标题栏右侧仅保留站内「热榜 TOP 30」。历史链接见 Git 历史，不再单列。

---

## 九、待办、规划与变更

### 当前待办（仍有效）

- 补 `verification`：Google ✅已配；Bing 待 msvalidate 码；百度验证保留（不关注收录）；360/搜狗 放弃
- ~~百度收录专项~~ → 百度验证保留但不关注收录，不投专项 SEO；360/搜狗 已放弃（站点不备案）
- 新引擎破零：字节/华为 提交 sitemap（搜狗随境内引擎放弃）
- IndexNow 主动推送 ✅已接发布钩子 + 全量推送 935 条（2026-11-05）
- 首页瘦身（noscript 收敛 9 分类 + `/all/`）
- 重合标签差异化（仅 macOS 配了 `tagMeta`）
- 核对 360 的 301 是否单跳
- 重建爬虫限速（per-UA 方案，放进 `deploy/` + `deploy/nginx-site.conf.example` 补 `limit_req`）
- 补百度网盘链接（2026-10-28 清空 623 条，补链时按原字段写回）

### 功能与内容规划（待评审，只排序未决定）

四个瓶颈：内容同质化 / 详情页孤岛 / 回访动机弱 / 链接失效靠人工。

- 用户侧（纯前端）：A1 失效反馈 ✅已落地 / A2 收藏看过 / A3 排序筛选 / A4 上-下一个 / A5 深色模式
- 内容结构化（抗同质化主力）：B1 series / B2 年份切面 / B3 规格字段 / B4 评分字段 / B5 分类导语+FAQ / B6 策展专题
- 可靠性工程化（最省人工）：C1 失效自动降级(`dead:true`) / C2 public 残留回收 / C3 周体检+CI 冒烟
- SEO 补丁：D1 verification / D2 IndexNow / D3 详情 OG 图 / D4 首页瘦身
- **明确不做**：评论/登录/积分/投稿、在线播放、采集同类站、给短板分类硬凑、SW 全站离线缓存。
- 红线：A2/A3 视图状态不得进 URL/canonical/sitemap；robots 已挡 `?q=`。
- Cloudflare Pages 曾评估，结论不适合切主站（验证文件 404 + 蜘蛛治理无法平移），维持现状。

### 变更记录（压缩）

- 2026-11-10 新增 QQ 群查询机器人（代码在本站仓库 `bot/`，NapCat + OneBot，群里 `/` 开头免 @ 查资源回夸克链接）；回复版式改为「名称 | 类型 | 网盘」+ 链接、末尾统一网站地址；详见第八节。
- 2026-11-06 加 `static/ads.txt`（AdSense 发布商 `pub-5363695594162175`），构建复制到根目录供 AdSense「ads.txt 片段」验证。
- 2026-11-02 robots 放开 `/stats.json`（前端 fetch 取数 + Googlebot 渲染需要；`/hit`/`/*/search-index.json`/`/*?q=` 保留）；取消全站阿里云联盟链接。
- 2026-10-30 复制改富文本 + 复制海报按钮；2026-10-28 清空 623 条百度链接、反馈条扩到许愿。
- 2026-10-22 分享从页面链接改资源包文本、删四平台按钮；2026-10-21 详情页反馈条/A1 落地。
- 2026-10-13 docs 多篇合并为单篇总览；2026-10-12 多批下架使全站 676→673→729→671 条、薄内容补写 387 条全达标。
- 2026-10-10~11 构建改「内容未变不覆盖」+ 内容哈希版本号；标签页宽度归位；7 家零回流爬虫 403；Bing/360 全量推送；相关推荐 6→10。

---

## 十、环境速查

### 位置

| 项 | 路径 |
|---|---|
| 仓库 | macOS `/Users/marco.chan/Documents/GitHub/wodewangpan`；Windows `C:\Users\marco\Github\wodewangpan` |
| QQ 机器人代码 | 站内 `bot/`（原 `C:\Users\marco\Github\wodewangpan-bot` 已并入；NapCat 在 `C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell`） |
| 远端 | `git@github.com:linuxhobby/wodewangpan.git` |
| 线上 | https://www.wodewangpan.top |
| 技能真身 | `~/.workbuddy/skills/`（`quark-resource-sync` v1.11 / `quarkclouddrive` / `quark-upload-share`）；`~/.codebuddy/skills/` 为符号链接 |
| 凭据 | `~/.workbuddy/skills/quark-resource-sync/config.env`（含凭据，不写进文档） |
| 中转 | `~/Documents/SynologyDrive/sync-skill/`（不含 `config.env`） |
| VPS autoupdate | `/usr/local/bin/wdwp-autoupdate`（拉取→npm ci→构建→原子替换 public→reload nginx） |

> 凭据真实值一律不写进文档，只记「在哪、叫什么」。

### 命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建到 `public/`，含 SEO 自检 |
| `npm run serve` | 预览 http://localhost:4321 |
| `npm run dev` | 构建+预览 |
| `npm run new` | 交互新建资源 |
| `npm run list:short -- --max=320` | 列出正文不足字数条目 |
| `npm run audit:css` | CSS 自检 |
| `npm run lint` | ESLint（CI 也跑） |

配图/封面：

```bash
node tools/poster.mjs douban --title "书名" --out static/images/bk-001.jpg   # 抓豆瓣正版封面（电子书优先）
node tools/poster.mjs book   --title "书名" --out static/images/bk-002.jpg   # 豆瓣查无此书时生成兜底
node tools/poster.mjs icon   --icon <图标> --out static/images/app-001.png   # 图标合成竖版
node tools/poster.mjs set    --title "套装名" --out static/images/bk-006.jpg # 套装深色封面
node tools/share-poster.mjs  # 改完站点配置后重跑，刷新 static/share.jpg
```

资源同步 skill（`S=~/.workbuddy/skills/quark-resource-sync/scripts`）：

```bash
node $S/scan-new.mjs
node $S/tmdb.mjs search --type movie --query "片名"
node $S/make-entry.mjs --data '{...}'
node $S/check-desc.mjs --file movie.yaml
node $S/trending-sync.mjs --dry-run --no-build --no-push
```

### 运行时与写脚本注意

- Node（管理版）v22.22.2；系统 macOS(zsh)/Windows。依赖 `js-yaml`/`sharp`/`pinyin-pro`（必须 `dependencies`）。
- 写脚本：Node 只用内置模块；临时文件走 `os.tmpdir()`，别写死 `/tmp/`（Windows 无效）。
- Windows 坑：`data/*.yaml` 是 CRLF（正则整块匹配失效，用位置切片）；沙箱 `spawnSync` 调 CLI 会 EBUSY（改 bash 脚本）。

### 改完自检

```bash
npm run build && npm run audit:css
```

七类页面 `<body class="page--wide">` 应一致：

```bash
grep -o '<body[^>]*>\|class="wrap[^"]*"\|class="cats[^"]*"' public/index.html public/tag/<slug>/index.html
```
