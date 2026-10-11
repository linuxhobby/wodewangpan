# 配图 · 图源与出图规范

站点配图的存放约定、图源实测结论、自绘兜底工具。

适用：入库时给资源找图 / 做图。
最近更新：2026-10-11（原散在 `content-rules.md` 与根 README 的「配图经验待补」，本篇补齐落地）。

---

## 一、存放与尺寸

- 配图放 `static/images/`，**全部平铺在一个目录，不按分类分桶**；文件名与资源 id 对应：`mv-046.jpg` / `.png` / `.webp` / `.svg`。
- 站点卡片尺寸 **240×360**，`fit: cover` 裁切（列表页与详情页共用同一张）。所以**源图宽 ≥240 即达标**，不必死磕高清——维基那种 ~256×364 完全够用。
- 首页品牌分享卡 `static/share.jpg` 由 `tools/share-poster.mjs` 生成；**改完站点配置（站名 / 分类）要重跑一次**，否则沿用旧图。

---

## 二、总原则：真实素材优先

**自绘是最后手段，返工率极高。** 有真实封面 / 海报 / 官方 logo 就用真实的，找不到再考虑合成。

### 图源实测结论

| 图源 | 结论 | 说明 |
|---|---|---|
| `upload.wikimedia.org` | ✅ **首选** | 官方盒绘与 Commons 矢量 logo 都在这。**必须带浏览器 UA**，否则 403 |
| TMDB 节目海报 | ✅ | 影视类首选，走 `tmdb.mjs --poster` |
| iTunes `artworkUrl512` | ✅ | 应用图标 512 版 |
| simple-icons | ✅ | 适合取 OS / 软件标志 |
| 豆瓣图书 | ✅ | 电子书封面主力，见第三节 |
| weserv 图片代理 | ✅ | `https://images.weserv.nl/?url=<域名+路径>&w=1200`，专治 Cloudflare 403 |
| AppleInsider / Cult of Mac | ⚠️ | 直下必被 Cloudflare 403（返回 ~5KB HTML 假图），走 weserv 代理 |
| Fandom 全站 | ❌ | API 与 `Special:FilePath` 均超时 |
| MobyGames | ❌ | 403 |
| 官网猜路径（如 `assets.nintendo.com`） | ❌ | 试过，通不了 |
| Google Books / Open Library | ❌ | 配额 429 / 连接超时，别耗时间 |

### 取维基官方图的标准三步

1. `prop=images` 找到文件名（如 `File:xxx cover.jpg`）
2. `prop=imageinfo&iiprop=url|size|mime` 取直链
3. 带浏览器 UA 下载

盒绘直接 `cp`；矢量 logo 交给 `tools/icon-poster.mjs` 配品牌色合成竖版。

### 假图识别

下载完先 `file` 看一眼：输出要含 image/JPEG/PNG 且分辨率宽 ≥200。常见假图：

- Cloudflare 拦截页：文件头是 `<!D`，约 5KB
- 缩略图：80×80 之类，宽不够 240
- GitHub 组织头像被清空后的默认 identicon

**出图必须打开看一眼再入库**——标题顶边、图标偏小、identicon 假头像，只有看图能发现。

---

## 三、书籍封面（豆瓣，跨项目通用）

两步走：

1. 搜索页 `https://book.douban.com/subject_search?search_text=<书名>`，页面内嵌 `"items": [...]` JSON（含 title / abstract / cover_url / id）。正则在 `"items": [` 之后做括号配对切出数组再 `JSON.parse`。
2. 封面地址把 `/m/public/` 换成 `/l/public/` 即得大图（约 500×750，正好 2:3）。

要点：

- **必须带**浏览器 UA + `Referer: https://book.douban.com/`，否则 418/403。
- 简单接口 `/j/subject_suggest?q=` 索引不全，优先用 `subject_search`。
- 同一书名的多个版本用作者关键字或 `--pick <豆瓣id>` 指定。
- **有些条目封面是「封面+封底」展开图**，入库前务必看图确认。

已落地工具：`tools/book-cover-douban.mjs`（`--title/--out/--author/--pick/--list`）。

---

## 四、自绘兜底工具

| 脚本 | 用途 |
|---|---|
| `tools/icon-poster.mjs` | 把应用图标合成 2:3 竖版海报（软件 / 音频等非影视资源） |
| `tools/book-cover-douban.mjs` | 豆瓣抓书封（电子书 `bk-` 优先用它） |
| `tools/book-poster.mjs` | 豆瓣查无此书时生成书封兜底 |
| `tools/set-poster.mjs` | 套装 / 合辑专用深色封面 |
| `tools/share-poster.mjs` | 首页品牌分享卡 `static/share.jpg` |

### 套装 / 合辑

豆瓣多半只有展开图或无图（如《斯蒂芬·金的王牌惊悚套装》17 册），用 `set-poster.mjs` 自排深色收藏版式（`--kicker/--prefix/--title/--badge/--label/--formats/--author` 都可缺省，`--accent` 换主色，输出 480×720）。

排版经验：氛围光别做大范围晕染（发糊像污渍），收成书名背后一小片光池 + 四角压暗才干净。套装条目的 `date` 填**套装自身出版时间**，不是里面某一本的首版年。

---

## 五、相关

- 文案规范：[content-内容规范.md](content-内容规范.md)
- 入库流程里配图在哪一步：[workflow-入库流程.md](workflow-入库流程.md)
