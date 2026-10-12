# 变更 · 记录

网站代码与文档的最新修改都记在这里（原在根 README「最新修改」，2026-10-11 迁入）。
按时间倒序，最新在最上面。**按日期整理：一个日期一个二级标题，同一天多条更新以三级子标题并列。**

---

## 2026-10-12

### 网盘改名后重出链 24 条 + 修复流程沉淀

用户在夸克 SHARE 里改了一批子目录名（含分类目录 `008电子书`→`08电子书`、`007其他`→`010其他`），导致站点链接与网盘脱节。核对后重新出链 24 条（mv/tv/dc/an/app/ot），并顺带把 `mv-240` 的内容修正为《黑寡妇》（原条目内容与网盘目录不符，海报一并换掉）。

| 改动 | 说明 |
|---|---|
| `data/*.yaml` | 24 条 `quark_url` 换成重出链后的新链接 |
| `static/images/mv-240.jpg` | 换成《黑寡妇》官方海报 |
| skill `SKILL.md` | 新增「网盘改名 / 分享失效后的修复流程」三步法 + 取消分享的处理边界 |
| skill `references/troubleshooting.md` | 新增失效三类码（41004 / 41012 / status=3）与出链 `41026` 排障 |
| skill `scripts/check-drive-sync.mjs` | 新脚本：按编号核对网盘目录名 vs 站点标题 |
| [workflow-入库流程.md](workflow-入库流程.md) | 新增 §五「网盘改名 / 分享失效后的修复」；编号对照表同步改名后的分类目录 |
| [skills-skill用法与维护.md](skills-skill用法与维护.md) | 脚本清单补 `check-drive-sync` / `check-share-links` / `reshare-batch` |

**未闭环**：6 条被用户主动取消分享（`tv-077 / tv-080 / tv-085 / tv-088 / tv-092 / tv-144`），重新出链一律返回 `41026 没有可分享的文件`，目录里只有占位 md、资源还没转存进去，**无法恢复**。其中 4 条有百度链接兜底，`tv-077`、`tv-144` 无可用链接，待用户决定下架还是补资源。

教训：① 改名后旧链接不一定立刻失效，但出链标题与目录名对不上就是隐患，必须 `check-share-links.mjs` 逐条验；② `check-drive-sync.mjs` 只比对目录名、不验链接，两者要一起跑；③ 用户取消的分享重建不了，别反复重试出链。已写进 [todo-待办清单.md](todo-待办清单.md)。

## 2026-10-11

### 修：选中分类胶囊里的计数看不清

选中分类（`.cat.is-on`）是品牌色实底 + 白字，但计数 `.cat__n` 仍是次要灰 —— 深灰压在紫底上几乎看不见。这是把四条计数后缀合并成一条公共规则时带出来的回归：合并前 `.cat__n` 自己不设 `color`，靠继承拿到父元素的白色；合并后显式写了 `color: var(--muted)`，继承关系被盖掉。

| 改动 | 文件 | 说明 |
|---|---|---|
| 选中态计数反白 | `theme/assets/style.css` | `.cat.is-on .cat__n { color: var(--surface); opacity: .8; }`。透明度从通用的 `.65` 抬到 `.8`，补足 13px 小字在紫底上的对比度 |

教训：把原本「继承父元素颜色」的元素并进带 `color` 的公共规则时，要回头查它的父元素有没有实底状态。已记进 [dev-开发注意事项.md](dev-开发注意事项.md)。

### 根 README 清掉最后的经验摘要

删掉根 README 末尾的「开发注意事项四条要点」重复摘要（内容早已完整收录在 [dev-开发注意事项.md](dev-开发注意事项.md) §二 与 §七），根 README 现在只留「怎么把站点跑起来」+ 文档索引，与「根 README 只留跑起来指南」的定位一致。

### `docs/` 文档体系重组，统一命名与索引

13 篇经验文档重组成 11 篇 + 1 篇归档，文件名统一 `英文-中文.md`，索引与规范写进 `docs/README.md`：

| 改动 | 说明 |
|---|---|
| 重命名 | 全部改为 `英文-中文.md`（如 `pitfalls.md` → [dev-开发注意事项.md](dev-开发注意事项.md) 合并并入） |
| 合并重复 | `dev-notes.md` + `pitfalls.md` → `dev-开发注意事项.md`；`seo.md` + `seo-notes.md` → [seo-收录与优化.md](seo-收录与优化.md) |
| 拆分 | `content-rules.md` 的配图节 → [images-配图规范.md](images-配图规范.md)（补齐 README 里挂了两天的「配图经验待补」）；`experience.md` 的 skill 维护章 → [skills-skill用法与维护.md](skills-skill用法与维护.md)，待办章 → [todo-待办清单.md](todo-待办清单.md) |
| 归档 | 已完成的 [archive/thin-content-薄内容补写归档.md](archive/thin-content-薄内容补写归档.md) 移入 `docs/archive/`，正文精简为可复用口径与工具链 |
| 新增索引 | `docs/README.md`：分类索引 + 命名规范 + 写什么 / 不写什么 + 维护约定 |
| 交叉引用 | docs 内部与根 README 的链接全部同步更新 |

### `docs/` 成为经验文档目录，根 README 精简

| 改动 | 文件 | 说明 |
|---|---|---|
| 建 `docs/` 索引与约定 | `docs/README.md` | 经验 / 注意事项 / 待办 / 总结统一放 `docs/`；写什么与不写什么、文件命名、新增必须登记索引 |
| 开发注意事项迁入 | `docs/dev-notes.md` | 从根 README 整段迁入，根 README 只留 4 条要点 |
| SEO 结论与待办迁入 | `docs/seo.md` | 收录现状、优化建议、下一步，从根 README 迁入 |
| 变更记录迁入 | `docs/changelog.md` | 本文件；根 README 只留链接 |
| 根 README 精简 | `README.md` | 删掉迁走的两大节与空的「配图规范 / SKILL 变更」标题；新增「文档」索引表 |

### 标签页宽度归位 + 样式收拢

新增的标签聚合页 `/tag/<slug>/` 没走宽容器，整页比全站窄一圈。修的时候顺手把宽度开关与重复样式收了一遍：

| 改动 | 文件 | 说明 |
|---|---|---|
| 页面宽度改成一处开关 | `scripts/lib/render.js`、`theme/assets/style.css` | `<body class="page--wide">` + `--page-max` 取代原先分四处传的 `wide`；删掉 `.wrap--wide` / `.cats--wide`，`layout()` 的 `wide` 默认改 `true`，各页面里 9 处 `wide: true` 全部删除 |
| 重复样式合并 | `theme/assets/style.css` | 海报（`.tile__poster` + `.poster`）、按钮（`.btn` + `.qrbtn`）、长文本正文、四处计数后缀各自并成一条；两个 `max-width: 560px` 断点合一 |
| 去掉 3 处 `!important` | `theme/assets/style.css` | `.foot__icp` / `.foot__stat` / `.foot__contact` 补标签名提特异性；`.foot__nav` 本是 `<nav>`，不受 `.foot p` 影响，直接去掉 |

验证：`npm run build` 通过（706 个资源 · 33 个标签页）；`npm run audit:css` 三项全绿；首页 / 分类页 / 详情页 / 标签页 / 内容页 / 404 的 `<body class="page--wide">` 一致。经验已写进 [dev-开发注意事项.md](dev-开发注意事项.md)。

## 2026-10-10

### 构建改为「内容未变不覆盖」，让蜘蛛能命中 304

每小时全量重建会把 700 多个详情页的 mtime / ETag 一起刷新，蜘蛛带 `If-Modified-Since` 来也永远不命中，每次都是完整 200——抓取预算大半耗在重复下载上（Google 日志 200×810、几乎没有 304）。现在内容没变就沿用旧文件并保留原 mtime：

| 改动 | 文件 | 说明 |
|---|---|---|
| `write()` 先比对再写盘 | `scripts/build.js` | 依次比对 outDir 同路径与上一版产物（`BUILD_DIR=public.new` 时对照 `public/`，可用 `PREV_DIR` 改）；相同则跳过，或 `copyFile + utimes` 沿用原 mtime。只处理文本产物，图片仍每次生成（走 30 天缓存，不占抓取预算） |
| 静态资源版本号改内容哈希 | `scripts/build.js` | 原先 `?v=<commit>`：每个 commit 都改一遍所有页面的 CSS/JS 链接 → 700 多页内容全变 → mtime 全量刷新，304 照样落空。改成 theme/assets 下 css/js 的内容哈希，纯数据提交不再动任何页面 |
| 构建汇总加一行 | `scripts/build.js` | 输出「未变化文件沿用 N 个（从 public/ 沿用 M 个）；重新生成 K 个」 |
| 重建频率定为 2h | `README.md`、`deploy/site-autoupdate.sh` | 脚本无新提交时直接跳过，频率只决定上线延迟（≤2h）；急发走 `FORCE=1 site-autoupdate` |

验证：连续两次构建，722 个文件全部沿用、0 个重写（58.7s → 34.9s）；`public.new/resource/mv-010/index.html` 的 mtime 与 `public/` 中的完全一致。

### 只清理 search-index.json 的子路径残留（不挡根路径）

蜘蛛日志里对该文件的 54 次请求全是 404，原建议是整条路径屏蔽。线上实测后修正：根路径是 200，404 全在带目录前缀的子路径上（`app.js` 早期相对路径的历史残留，10-09 已改根绝对路径，但蜘蛛仍按记忆重试）。根路径是 Googlebot 渲染「加载更多」的通道，挡掉等于自断发现路径，所以只清子路径：

| 改动 | 文件 | 说明 |
|---|---|---|
| `Disallow: /*/search-index.json` | `scripts/build.js` | 只匹配带目录前缀的索引文件，根目录那份照常允许 |
| 410 规则 | `deploy/nginx-site.conf.example` | `location ~ ^/.+/search-index\.json$ { return 410; }`，410 比 404 衰退快，且不依赖引擎是否支持通配；必须排在静态资源 location 之前（nginx 正则 location 取第一个命中） |

## 2026-10-09

### 相关推荐排版对齐（每行必须排满）

详情页「相关推荐」原来固定取 6 条，而宫格桌面端一行 5 列，第 6 张必然单独掉到第二行。现在统一按整行出牌：

| 改动 | 文件 | 说明 |
|---|---|---|
| 推荐数 6 → 10 | `scripts/lib/render.js` | `relatedOf()` 默认取 10 条（同分类优先、标签重合多的靠前，不够时跨分类同标签补齐），桌面端 5 列 × 2 行正好排满 |
| 末行零头自动裁掉 | `theme/assets/style.css` | 新增 `.grid--fit`：`nth-child(cols·n+1):nth-last-child(-n+cols-1)` 定位残缺末行的第一张卡，连同后面的兄弟一起 `display:none`。四个断点（5/4/3/2 列）各一组互斥规则，窄屏减列后同样是整行；卡片不足一行时不加这个类，避免藏过头把区块藏没 |

产物验证：668 个资源重新构建通过，660 个详情页恰好输出 10 条；`npm run audit:css` 三项全绿。
## 2026-10-09 · 相关推荐排版对齐（每行必须排满）

详情页「相关推荐」原来固定取 6 条，而宫格桌面端一行 5 列，第 6 张必然单独掉到第二行。现在统一按整行出牌：

| 改动 | 文件 | 说明 |
|---|---|---|
| 推荐数 6 → 10 | `scripts/lib/render.js` | `relatedOf()` 默认取 10 条（同分类优先、标签重合多的靠前，不够时跨分类同标签补齐），桌面端 5 列 × 2 行正好排满 |
| 末行零头自动裁掉 | `theme/assets/style.css` | 新增 `.grid--fit`：`nth-child(cols·n+1):nth-last-child(-n+cols-1)` 定位残缺末行的第一张卡，连同后面的兄弟一起 `display:none`。四个断点（5/4/3/2 列）各一组互斥规则，窄屏减列后同样是整行；卡片不足一行时不加这个类，避免藏过头把区块藏没 |

产物验证：668 个资源重新构建通过，660 个详情页恰好输出 10 条；`npm run audit:css` 三项全绿。
