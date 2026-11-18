# 站点数据与产物说明

## 目录 → 分类 → id 映射

| SHARE 子目录 | 数据文件 | 站内分类名 | id 前缀 | 示例 |
|---|---|---|---|---|
| `04电影` | `data/movie.yaml` | 电影 | `mv-` | `mv-011` |
| `03电视剧` | `data/tv.yaml` | 电视剧 | `tv-` | `tv-070` |
| `06纪录片` | `data/documentary.yaml` | 纪录片 | `dc-` | `dc-007` |
| `05动漫` | `data/anime.yaml` | 动漫 | `an-` | `an-001` |
| `01游戏` | `data/game.yaml` | 游戏 | `game-` | `game-001` |
| `02应用` | `data/software.yaml` | 软件 | `app-` | `app-001` |
| `08电子书` | `data/ebook.yaml` | 电子书 | `bk-` | `bk-001` |
| `010其他` | `data/misc.yaml` | 其他 | `ot-` | `ot-001` |
| `07课程` | `data/course.yaml` | 课程 | `cs-` | `cs-001` |

编号三位补零，与网盘目录名前缀一致。**数据文件是英文命名，分类名是中文**，两者不要混。

> ⛔ **2026-11-10 分类合并**：「操作系统」并入「软件」。`09操作系统` 目录与 `data/os.yaml` 都已不存在，11 条 `os-001~os-011` 搬进 `data/software.yaml`（**id 与详情页 URL 不变**、`category` 改「软件」、`tags` 首项仍是「操作系统」），物理目录住在 `02应用` 的 **130-140**。新入库的系统镜像按「软件」分类、`app-` 前缀；**不要新建 `data/os.yaml`**。旧分类页 `/category/os/` 由线上 nginx 301 到 `/software/`。

编号分配自 2026-11-04 起是**空洞优先**（先补夸克网盘上已释放的最小空编号，用完才从最大编号顺延），目的是让编号序列紧凑、并让指向已删目录的死链条目随编号被回收而就地下线，详见 SKILL.md「编号回收与死链就地改写」。因此同 id 条目可能是**就地改写**过的（`id` 与详情页地址不变、内容换成新资源）。

## YAML 字段

```yaml
- id: tv-070                 # mv-/tv-/dc- + 三位编号
  title: "真相捕捉"           # 页面标题，不带编号
  category: 电视剧            # 电影 / 电视剧 / 纪录片
  tags: ["电视剧", "犯罪", "剧情", "悬疑", "真相捕捉 The Capture"]
                              # 首个标签为分类名，随后是 TMDB 类型，最后是「中文名 原名」
  quark_url: "https://pan.quark.cn/s/xxxx"
  description: "【第 2 季 · 共 10 集 · 全剧 3 季】…｜TMDB 7.6"
                              # 简介基于 TMDB 二次加工（不照抄原文），正文 150~700 字（2026-11-12 口径），结尾带 ｜TMDB 评分
                              # 字数按剥掉【…】标签与 ｜… 尾巴后的正文计（见 SKILL.md 第 5 步）
                              # 电视剧/分集纪录片必须在正文前加「第几季 · 共多少集」标签（见 SKILL.md 第 5 步）
  date: 2019-09-03            # 首播 / 上映日期（TMDB）
  added: 2026-09-29           # 入库日期（网盘目录新增日期）
  image: tv-070.jpg           # 位于 static/images/<slug>/<id>.jpg（slug 按 id 前缀：mv→movie、tv→tv、dc→documentary、an→anime、game→game、app→software、bk→ebook、cs→course、ot→misc）
  disk_dir: "134-windows10"    # 【可选，仅历史并入条目用】盘端目录实名；见上「2026-11-10 分类合并」
                              # 只在「id 尾号 ≠ 网盘目录编号」时 needed（现仅 os-001~os-011）；
                              # 新条目不要写（尾号天然等于目录号）；站点构建是字段白名单，该字段不上页面
```

## 图片

构建时由 `static/images/<slug>/<id>.jpg` 生成两档：`-240`（卡片 240×360，列表页与详情页共用）、`-60`（缩略图），输出为 `public/img/*.webp`。原图建议 500×750（TMDB `w500`）。详情页已不出独立的 180 档（`scripts/lib/assets.js` 里 `SIZES = [CARD, THUMB]`）。

无海报时省略 `image`，构建会回落到占位图（分类占位海报优先，只有分类未知才走通用占位图）。

**取图源按分类定**（完整决策表见 `SKILL.md` 第 5 步）：电影 / 剧 / 纪录片 / 动漫用 TMDB `w500`；游戏用 Steam `library_600x900_2x.jpg`；软件用 App Store 官方图标（iTunes Search API）；**系统镜像（现归「软件」）用 simple-icons 官方标志**（`https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg`，单色，`scripts/poster.mjs icon` 会自动补 `--svg-fill` 默认白）；电子书用豆瓣正版封面。软件 / 系统镜像 / 电子书这类没有 TMDB 海报的，一律用 `scripts/poster.mjs`（icon / douban / book / set 模式同入口）合成 480×720，不要留占位图。（2026-11-09 已确认：仓库里没有 `scripts/icon-poster.mjs` 这个文件，旧文案一律按 `scripts/poster.mjs icon` 执行。）

## 构建与产物

```bash
cd "$REPO" && npm run build     # 输出 public/
node scripts/serve.js           # 本地预览 http://localhost:4321
```

`public/` 下：资源页 `/<slug>/<id>/index.html`、分类页 `/<slug>/`、搜索索引 `/search-index.json`、站点地图 `/sitemap.xml`、二维码 `/qr/<id>-quark.svg`。带真实域名发布时必须 `BASE_URL=https://域名 npm run build`。

## 冒烟清单

| 路径 | 期望 |
|---|---|
| `/` | 200（首页宫格含新卡片） |
| `/<slug>/<id>/`（如 /movie/mv-457/） | 200，标题正确，含 `pan.quark.cn/s/...` |
| `/img/<id>-240.webp` | 200 |
| `/qr/<id>-quark.svg` | 200 |
| `/tv/` | 200（分类页是英文 slug 一级目录，无需编码） |
| `/nope` | 404 |
