# URL 与配图目录重构记录（2026-11-15）

> 提交 `ceaeaf9 feat: URL 与配图目录按分类 slug 重构（/<slug>/<id>/）`
> VPS 发布：`2026-11-15 21:12:47 发布完成：ceaeaf9`（构建 155.0s，1040 张图全量重出）
> 本文是本次全量改造的专项档案：改了什么、为什么这么改、怎么验证、还有哪些跨机待办。
> 日常执行的**长期维护契约**在 `AGENTS.md` §2.1，两边口径一致；本文负责记录这一次的决策与落地细节。

---

## 1. 决策与范围

- 从长远结构出发，决定 URL 带分类；采用 **A 完整版**：不只详情页，分类页也统一到一级目录，让目录树与面包屑「首页 / 电影 / 片名」一致。
- **只用英文 slug**（`config/site.yaml` 的 `slugs`），不用中文分类名。中文一级目录会让 sitemap `<loc>`、canonical、nginx `$uri` / `$request_uri`、`sitestats.py`、推送脚本出现四套编码口径；英文 slug 完全绕开，且 `categorySlug()` 现成可复用。
- 图片目录同步按 slug 分类：`static/images/` 原有 1040 张平铺，人工查找困难。这项与 URL 改造解耦——源目录不进任何对外 URL，产物名只由 `item.id` 派生，所以**线上 URL、sitemap、OG、二维码、统计逐字不变**，不需要 301。
- 两项一起做，共用同一套 slug 别名表；不做「先塞一段分类进 URL、以后再统一目录树」的过渡形态。

**已知代价**：1040 个已收录地址全换、全站 HTML 重写一次、VPS 图片产物全量重出一次（该次构建 155.0s）、收录需要重新推送。收益是结构一次到位、以后改分类只需维护一张别名表。

---

## 2. 前后对照

| 对象 | 改造前 | 改造后 |
|---|---|---|
| 资源详情页 | `/resource/mv-457/` | `/movie/mv-457/` |
| 分类页 | `/category/movie/` | `/movie/` |
| 分类 RSS | `/category/movie/feed.xml` | `/movie/feed.xml` |
| 物理目录 | `public/resource/<id>/index.html`、`public/category/<slug>/index.html` | `public/<slug>/<id>/index.html`、`public/<slug>/index.html` |
| 源配图 | `static/images/mv-457.jpg` | `static/images/movie/mv-457.jpg` |
| 图片产物（**未变**） | `/img/mv-457-240.webp`、`/og/v2/mv-457.jpg` | 同左 |
| 统计按资源聚合 | `^/resource/([^/]+)/?$` | `^/<slug>/([A-Za-z0-9_-]+)/?$`（slug 白名单） |
| 页面类型判定 | 固定前缀正则 | `pageTypeOf` 按分类 slug 集合判定 |

独立页（`/about/ /contact/ /privacy/ /all/ /hot/ /rss/ /tags/ /tag/...`）与静态目录（`img/ qr/ og/ assets/ promo/`）地址不变。

### 前缀 → slug 映射（1040 条实测一一对应，无跨分类复用）

| 数据文件 | 中文分类 | id 前缀 | slug |
|---|---|---|---|
| `movie.yaml` | 电影 | `mv` | `movie` |
| `tv.yaml` | 电视剧 | `tv` | `tv` |
| `documentary.yaml` | 纪录片 | `dc` | `documentary` |
| `anime.yaml` | 动漫 | `an` | `anime` |
| `game.yaml` | 游戏 | `game` | `game` |
| `software.yaml` | 软件 | `app` | `software` |
| `ebook.yaml` | 电子书 | `bk` | `ebook` |
| `course.yaml` | 课程 | `cs` | `course` |
| `misc.yaml` | 其他 | `ot` | `misc` |

⚠ 这张表只用于**一次性文件归位**和 nginx 旧 URL 301；站点内部一律用 `item.category → categorySlug()`，不要靠前缀推分类（历史上有 `ot-007 → app-141` 换分类重编号）。

---

## 3. 代码改动清单

`ceaeaf9`：1040 个 `R100` 图片重命名 + 13 个文件修改 + 1 个新增。

| 文件 | 改动 |
|---|---|
| `scripts/lib/render.js` | 新增 `setItemPaths(items)`（构建期注入 id → slug 的 Map）；`itemHref(id)` 改为 `/<slug>/<id>/`，未注册 id 直接抛错；`catHref()` 改为 `/<slug>/`；热门榜 `hotIndex` 的 href 改用 `itemHref()`，去掉硬编码 |
| `scripts/lib/nav.js` | 新增 `setCategoryPaths(slugs)`；`pageTypeOf()` 改为 FOOT_NAV 优先、再按 slug 集合判定 `detail`（两段）/ `category`（一段），避免把 `/about/` 误判成分类页 |
| `scripts/build.js` | 读完数据后注入两个映射；新增 `RESERVED_TOP_DIRS` 与分类 slug 校验（必须 `^[a-z0-9-]+$`、不撞保留目录，不通过直接 `process.exit(1)`）；prune 改为「删旧 `resource/` `category/` 整目录 → 一级目录白名单 → 每个分类目录内按 id 清理」；分类页/feed/详情页物理输出改到 `public/<slug>/`；搜索索引 href 与分享二维码 `pageUrl` 改用 `itemHref()` |
| `scripts/lib/assets.js` | `resolveSource()` 导出；优先找 `static/images/<slug>/<id>.jpg`，**保留旧平铺路径兼容双读**（跨机分批切换 / 灰度回退用，不是长期口径） |
| `scripts/check-images.mjs` | **新增**只读盘点：逐条验证源图命中、列出旧平铺命中与孤儿文件；`npm run check:images` 注册进 `package.json` |
| `theme/assets/app.js` | `tileOf()` 的 `resId` 直接取索引里的 `it.id`，不再从 URL 抠；热门榜兜底去掉 `/resource/` 硬编码；修掉既有的 `catch (e)` 未使用变量 |
| `scripts/sitestats.py` | `RES_RE` 改为 slug 白名单 + 末段取 id，排除 `feed.xml`；仍按 id 聚合，`stats.db` 无需迁移 |
| `scripts/poster.mjs` | 用法示例的路径改为 `static/images/<slug>/` |
| `deploy/nginx-site.conf.example` | 301 规则集全量替换（见 §5），与线上一致 |
| `deploy/setup-vps.sh` | 部署自检 probe 从 `/category/movie/` 改成 `/movie/` |
| `AGENTS.md` | 新增 §2.1 长期契约；§1 命令、§2 历史说明、§5 回收口径、§8 配图规范同步 |
| `README.md` / `docs/README.md` | 上线自检、410 策略示例、下架四处、mybot 说明、命令示例、目录结构说明同步 |

---

## 4. 图片目录迁移

- 1040 张 `git mv` 到 `static/images/<slug>/`，Git 全部识别为 `R100`；迁移脚本按前缀分组、`git mv` 批量执行，跑完即删，不留一次性工具在仓库里。
- **不能只移文件**：`data/*.yaml` 有 1040 处扁平的 `image: <id>.jpg`，而 `resolveSource()` 在 `item.image` 存在时只试平铺候选，不会走 `${id}.${ext}` 兜底。只移文件会让全站判定缺图、海报变占位图、JSON-LD / OG / sitemap 丢图。因此读取端必须同步改，YAML 反而不动（避免 1040 行大 diff 与并行任务抢写 `data/`）。
- 产物名与所有对外 URL **不变**：`public/img/<id>-240.webp`、`/og/v2/<id>.jpg`、`/qr/<id>-*.svg`。首次迁移后本地构建「重新生成 0 个」，实测线上零影响。
- 长期校验：`npm run check:images`，输出各分类张数、命中数、旧平铺命中和孤儿文件；发现异常即返回非零退出码。

---

## 5. nginx 301 规则

仓库镜像 `deploy/nginx-site.conf.example` 与线上 `/etc/nginx/conf.d/wodewangpan.conf` 各 **40 条** `rewrite`，内容一致。

| 组 | 条数 | 作用 |
|---|---|---|
| 中文分类页 | 16 | `/category/电影/(.*)` 等 8 类 ×2 → `/movie/` 等 |
| 分类合并特例 | 1 | `/category/os/(feed\.xml)?` → `/software/$1` |
| 旧英文分类页 | 2 | `/category/(slug)/index.html` → `/<slug>/`；`/category/(slug)/(feed\.xml)?` → `/<slug>/$2` |
| 历史换 id | 12 | `ot-007 → /software/app-141/`、`os-001~011 → /software/app-130~140/`（按 2026-11-10 对照表逐条映射） |
| 旧详情页泛化 | 9 | `^/resource/(mv-\|tv-\|dc-\|an-\|game-\|app-\|bk-\|cs-\|ot-)[^/]+(/index\.html\|/)?$` → `/<slug>/$1/` |

**顺序是硬要求**：历史精确 id 规则必须排在按前缀的泛化规则之前，否则 `ot-007` 会被泛化成 `/misc/ot-007/`。`ot-006` 的历史 301 已在 2026-11-13 撤销，本次由泛化规则正确落到 `/misc/ot-006/`。

- 线上配置备份：`/etc/nginx/conf.d/wodewangpan.conf.bak-urlrework-20261115`。
- **发布时序**：先改线上配置并 `nginx -t`（不 reload），再触发 VPS 发布脚本；脚本在原子替换 `public/` 后执行 `nginx -t && systemctl reload nginx`，301 规则与新目录树同时生效，不会出现「301 到还不存在的新地址」或「新页面上线但旧地址 404」的窗口。
- 另一站 `yuancaileida.conf` 里 `if ($request_uri ~ "^/resource/") { return 410; }` 属跨站隔离保护，未改动。

---

## 6. 长期维护契约

与 `AGENTS.md` §2.1 一致，摘要：

1. `config/site.yaml` 的 `slugs` 是唯一口径，**只增不改**。新增分类必须配英文小写别名，且不能撞 `RESERVED_TOP_DIRS`（`about/all/assets/contact/hot/img/og/privacy/promo/qr/rss/tag/tags`）；构建期校验失败直接退出。
2. 页面 URL 只从 `itemHref()` / `catHref()` 出；`setItemPaths()` / `setCategoryPaths()` 由构建期按 `category` 注入。
3. **改任何已收录路径必须同步 301**，线上配置与仓库镜像保持一致；规则顺序不能颠倒；换 URL 后 IndexNow 要带 `ALL=1` 全量重推。
4. 改一个 slug = 分类页 + 该分类全部详情页一起换地址，属全量迁移，不是改一行别名。
5. 新增配图一律写 `static/images/<slug>/`；旧平铺兼容只作回退；`npm run check:images` 常态巡检。
6. `scripts/sitestats.py` 的 `RES_RE` slug 白名单、跨机 skill 的 `PREFIX_SLUG`、301 的前缀规则三者都要与 `slugs` 同步。

---

## 7. 跨机 / 仓库外同步

> 2026-11-15 收尾：跨机项已由用户分配给对应机器处理，本仓库侧不再跟进；
> agent 侧唯一的跨机改动是 Mac 本机 skill，已完成。

| 位置 | 状态 | 说明 |
|---|---|---|
| Mac `~/.workbuddy/skills/quark-resource-sync` | **已完成（本仓库侧）** | 新增 `scripts/lib/site-paths.mjs`（`PREFIX_SLUG` / `posterDir()` / `itemUrl()`）；`make-entry.mjs`、`process-batch.mjs`、`trending-sync.mjs` 写图路径改为分类子目录并自动 `mkdirSync`；`SKILL.md`、`references/site-schema.md`、`references/troubleshooting.md` 的路径与冒烟 URL 口径同步；`node --check` 全通过 |
| Windows `C:/Users/marco/.workbuddy/skills/quark-resource-sync` | 用户安排任务机器自行修改 | 按 Mac 的 `site-paths.mjs` 与三处写图路径照改 |
| Windows `C:/Users/marco/.qwenworkcn/skills/quark-resource-sync` | 用户安排任务机器自行修改 | 同上；仓库内 0 引用，最容易漏 |
| 群晖中转 `~/Documents/SynologyDrive/sync-skill/wodewangpan/quark-resource-sync` | 用户确认不再维护 | 不需同步，也不再作为写入方 |
| `mybot` 私有仓 | 用户安排另一台电脑修改 | 只读 `/resource/<id>/` GET，现在返回 301；不跟随重定向的 HTTP 客户端会拿不到内容，需改 `/<slug>/<id>/` |
| Windows 飞书简报脚本 `C:/Users/marco/Scripts/wodewangpan-fillfiles-feishu.mjs` | 用户安排另一台电脑修改 | 按 id 拼详情页链接的地方改成新结构 |

这些机器改完前，未同步的写入方仍可能把新图落进 `static/images/` 根目录变成孤儿文件；两边都可用 `npm run check:images` 自检。

**百度普通收录**：`/var/lib/baidu-submitted.txt` 里都是旧 URL，新 sitemap 的 1054 条会进入 pending，按每天 10 条配额由 cron 自动排队，没有手工全量推（避免浪费配额）。IndexNow 已做全量。

---

## 8. 验证记录

| 项 | 结果 |
|---|---|
| `npx eslint scripts/ theme/assets` | 0 错误 |
| `npm run audit:css` | 通过 |
| `npm run build` 两次 | 第一次重新生成 1136 个，第二次「重新生成 0 个」（1040 资源 · 9 分类） |
| `npm run check:images` | 命中 1040（分类目录 1040 · 旧平铺 0），缺图 0、孤儿 0 |
| `public/sitemap.xml` | 1054 条 `<loc>`，含 `/resource/` 或 `/category/` 的 0 条 |
| 全站 HTML 抽查 | `/resource/` 出现 0 次；canonical、面包屑、BreadcrumbList、夸克群按钮均正常 |
| 本地预览 | `/movie/mv-457/` 200、`/movie/` 200、`/resource/mv-457/` 404、`/img/mv-457-240.webp` 200 |
| `sitestats.py` 正则单测 | 新详情页提取 id；`feed.xml`、`/tag/xxx/`、旧 `/resource/...`、分类页均不计入 |
| 线上新地址 | 详情页 / 分类页 / 分类 feed / 图片 / sitemap / 搜索索引 / 群二维码全 200 |
| 线上 301 | 9 个 id 前缀逐条核对、5 个分类页、中文分类页、`feed.xml`、`index.html`、历史 `ot-007` / `os-001` / `ot-006` 目标全部正确；跟随 301 最终 200 |
| VPS | HEAD `ceaeaf9`、工作区干净、nginx `active`、旧 `public/resource` 与 `public/category` 已不在线上产物 |
| IndexNow | `ALL=1` 全量 1054 条，成功 1054，失败 0（21:16:03） |

---

## 9. 回退路径（真需要时）

1. `git revert ceaeaf9`（或 checkout 上一版 `af37c84`）→ 图片回到平铺目录，但 `resolveSource()` 兼容双读，回退后旧代码仍可能平铺读取；按提交顺序一起回退即可。
2. 线上 nginx 用 `.bak-urlrework-20261115` 覆盖并 `nginx -t && systemctl reload nginx`。
3. 重新触发 VPS 发布，让旧目录树与旧 301 配置同时生效。
4. IndexNow 再 `ALL=1` 推一次旧地址。

⚠ 回退等于再来一次全站 URL 迁移，只在改造出现不可修复问题时使用；日常修正优先走 301 规则或局部数据修正。

---

## 10. Windows 侧补丁清单（可直接照抄）

> 面向用户安排的两台机器：**任务机器**（两份 Windows skill）与**另一台电脑**（`mybot`、飞书简报脚本）。
> 4 项：① `C:/Users/marco/.workbuddy/skills/quark-resource-sync`
> ② `C:/Users/marco/.qwenworkcn/skills/quark-resource-sync`
> ③ `mybot` 私有仓 ④ `C:/Users/marco/Scripts/wodewangpan-fillfiles-feishu.mjs`
> 前提：站点仓库已 `git pull` 到当前 HEAD、Node 可用（skill 本来就需要）。
> 群晖中转已确认停用，不在清单内。

### 10.1 公共文件全文：`site-paths.mjs`

两份 skill **各放一份**，路径 `<skill>/scripts/lib/site-paths.mjs`：

```js
/** 站点路径口径（2026-11-15 全站 URL 与配图目录带分类后，Mac / Windows 两侧共用）。
 *  站点：详情页 /<slug>/<id>/、分类页 /<slug>/；配图 static/images/<slug>/<id>.jpg。
 *  前缀 → slug 与 config/site.yaml 的 slugs 一一对应；站点构建会校验 slug 合法性与保留目录撞名。
 *  ⚠ 新增分类或改别名时，这张表必须和站点 config/site.yaml 同步改，别再往 static/images/ 根目录写图。
 */
import path from 'node:path';

export const PREFIX_SLUG = {
  mv: 'movie',
  tv: 'tv',
  dc: 'documentary',
  an: 'anime',
  game: 'game',
  app: 'software',
  bk: 'ebook',
  cs: 'course',
  ot: 'misc',
};

export function slugOf(idOrPrefix) {
  const p = String(idOrPrefix).split('-')[0];
  const slug = PREFIX_SLUG[p];
  if (!slug) throw new Error(`未知 id 前缀：${idOrPrefix}（请同步 PREFIX_SLUG 与站点 slugs）`);
  return slug;
}

/** 某个资源配图应放的目录（调用方负责 mkdirSync recursive） */
export function posterDir(repo, id) {
  return path.join(repo, 'static', 'images', slugOf(id));
}

/** 详情页 URL（仅用于文档 / 冒烟提示，站点侧以 build.js 的 setItemPaths 为准） */
export function itemUrl(id) {
  return `/${slugOf(id)}/${id}/`;
}
```

### 10.2 两份 skill 的脚本改动（每份都做一遍）

| 文件 | 改动 |
|---|---|
| `scripts/make-entry.mjs` | 在 `import { cfg } from './lib/config.mjs';` 后加一行 `import { posterDir } from './lib/site-paths.mjs';`；海报校验路径改成 `path.join(posterDir(cfg.REPO, d.id), d.image)` |
| `scripts/process-batch.mjs` | 同样加 import；删掉平铺的 `const imgDir = path.join(REPO, 'static/images');`，改成按 `p.id` 取 `destDir = posterDir(REPO, p.id)` → `fs.mkdirSync(destDir, { recursive: true })` → `dest = path.join(destDir, 文件名)`（文件名仍是 `` `${p.id}.jpg` `` 这个模板字符串） |
| `scripts/trending-sync.mjs` | 同样加 import；海报 `dest` 改成 `path.join(posterDir(REPO, id), 文件名)`（文件名仍是 `` `${id}.jpg` ``；下面原有的 `mkdirSync(path.dirname(dest), ...)` 会自动建分类目录） |

- `git add data/ static/images/` 不用改：子目录仍被 `static/images/` 递归覆盖。
- 文档口径（`SKILL.md`、`references/site-schema.md`、`references/troubleshooting.md`）建议同步，但不影响运行；关键是**别再往 `static/images/` 根目录写图**。
- ⚠ Windows 侧版本可能比 Mac 旧（例如还带着 `os.yaml` 操作系统映射）。精确字符串对不上时按上表的**目标语义**手工改，不要照搬行号；旧映射属于另一件事，本次不必顺手改，但新增分类必须配英文 slug，站点构建期会校验。
- 10.3 的一键脚本里 `PATCHES` 就是这三处改动的精确字符串，可直接对照。

### 10.3 一键补丁脚本（推荐）

保存为任意目录的 `apply-windows-patch.mjs`，在 PowerShell 执行：

```powershell
node apply-windows-patch.mjs
```

会自动在两份 skill 下创建 `site-paths.mjs`、做上面的三处替换、按 CRLF/LF 自动适配行尾、幂等跳过已改文件，并逐个 `node --check`。

```js
// apply-windows-patch.mjs —— Windows 任务机器执行一次即可；已改过再跑不会重复改
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOTS = [
  path.join(os.homedir(), '.workbuddy', 'skills', 'quark-resource-sync'),
  path.join(os.homedir(), '.qwenworkcn', 'skills', 'quark-resource-sync'),
];

// 与 10.1 全文等价；用数组拼接是为了能安全内联含反引号、${} 的原文
const SITE_PATHS = [
  '/** 站点路径口径（2026-11-15 全站 URL 与配图目录带分类后，Mac / Windows 两侧共用）。',
  " *  站点：详情页 /<slug>/<id>/、分类页 /<slug>/；配图 static/images/<slug>/<id>.jpg。",
  ' *  前缀 → slug 与 config/site.yaml 的 slugs 一一对应；站点构建会校验 slug 合法性与保留目录撞名。',
  ' *  ⚠ 新增分类或改别名时，这张表必须和站点 config/site.yaml 同步改，别再往 static/images/ 根目录写图。',
  ' */',
  "import path from 'node:path';",
  '',
  'export const PREFIX_SLUG = {',
  "  mv: 'movie',",
  "  tv: 'tv',",
  "  dc: 'documentary',",
  "  an: 'anime',",
  "  game: 'game',",
  "  app: 'software',",
  "  bk: 'ebook',",
  "  cs: 'course',",
  "  ot: 'misc',",
  '};',
  '',
  'export function slugOf(idOrPrefix) {',
  "  const p = String(idOrPrefix).split('-')[0];",
  '  const slug = PREFIX_SLUG[p];',
  '  if (!slug) throw new Error(`未知 id 前缀：${idOrPrefix}（请同步 PREFIX_SLUG 与站点 slugs）`);',
  '  return slug;',
  '}',
  '',
  '/** 某个资源配图应放的目录（调用方负责 mkdirSync recursive） */',
  'export function posterDir(repo, id) {',
  "  return path.join(repo, 'static', 'images', slugOf(id));",
  '}',
  '',
  '/** 详情页 URL（仅用于文档 / 冒烟提示，站点侧以 build.js 的 setItemPaths 为准） */',
  'export function itemUrl(id) {',
  '  return `/${slugOf(id)}/${id}/`;',
  '}',
  '',
].join('\n');

const CFG_MAKE = "import { cfg } from './lib/config.mjs';";
const CFG_BATCH = "import { cfg, requireCfg, SKILL, CACHE, TMP, QUARK_TASK_DIR } from './lib/config.mjs';";
const IMPORT = "import { posterDir } from './lib/site-paths.mjs';";

const PATCHES = {
  'scripts/make-entry.mjs': [
    [CFG_MAKE, CFG_MAKE + '\n' + IMPORT],
    ["const img = d.image ? path.join(cfg.REPO, 'static/images', d.image) : null;",
     "const img = d.image ? path.join(posterDir(cfg.REPO, d.id), d.image) : null;"],
  ],
  'scripts/process-batch.mjs': [
    [CFG_BATCH, CFG_BATCH + '\n' + IMPORT],
    ["const imgDir = path.join(REPO, 'static/images');",
     '// 配图按分类 slug 分目录（2026-11-15 起），见 scripts/lib/site-paths.mjs'],
    ["    const dest = path.join(imgDir, `${p.id}.jpg`);",
     "    const destDir = posterDir(REPO, p.id);\n" +
     '    fs.mkdirSync(destDir, { recursive: true });\n' +
     "    const dest = path.join(destDir, `${p.id}.jpg`);"],
  ],
  'scripts/trending-sync.mjs': [
    [CFG_BATCH, CFG_BATCH + '\n' + IMPORT],
    ["        const dest = path.join(REPO, 'static', 'images', `${id}.jpg`);",
     "        const dest = path.join(posterDir(REPO, id), `${id}.jpg`);"],
  ],
};

function check(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    console.log('  ! node --check 失败：', file, String(e.stderr || e.message).slice(0, 140));
  }
}

function patchFile(root, rel, pairs) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log('  跳过（文件不存在）', rel);
    return;
  }
  let t = fs.readFileSync(p, 'utf8');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const norm = (s) => s.replace(/\n/g, eol);
  let n = 0;
  let warn = 0;
  for (const [oldStr, newStr] of pairs) {
    const o = norm(oldStr);
    const nn = norm(newStr);
    if (t.includes(nn)) continue; // 已改，幂等
    if (!t.includes(o)) {
      console.log('  ! 需手工核对（找不到）：', oldStr.slice(0, 70));
      warn++;
      continue;
    }
    t = t.replace(o, nn);
    n++;
  }
  fs.writeFileSync(p, t);
  console.log('  ', rel, `改 ${n} 处${warn ? `，${warn} 处需手工核对` : ''}`);
  check(p);
}

for (const root of ROOTS) {
  console.log('\n===', root, '===');
  if (!fs.existsSync(root)) {
    console.log('  跳过（目录不存在）');
    continue;
  }
  const lib = path.join(root, 'scripts', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const sp = path.join(lib, 'site-paths.mjs');
  fs.writeFileSync(sp, SITE_PATHS);
  console.log('  已写入 scripts/lib/site-paths.mjs');
  check(sp);
  for (const [rel, pairs] of Object.entries(PATCHES)) patchFile(root, rel, pairs);
}
console.log('\n完成。随后到站点仓库执行 npm run check:images 自检。');
```

### 10.4 `mybot` 私有仓

- 搜索这些写法：`/resource/`、`'/resource/' + id + '/'`，以及模板字符串 `` `/resource/${id}/` ``，还有任何按 id 拼详情页地址的地方。
- 换成 `detailUrl(id)`；把下面这段贴进工具模块（Node 版）：

```js
const PREFIX_SLUG = {
  mv: 'movie', tv: 'tv', dc: 'documentary', an: 'anime', game: 'game',
  app: 'software', bk: 'ebook', cs: 'course', ot: 'misc',
};
function detailUrl(id) {
  const slug = PREFIX_SLUG[String(id).split('-')[0]];
  if (!slug) throw new Error('未知 id 前缀：' + id);
  return `/${slug}/${id}/`;
}
```

若 `mybot` 是 Python，等价写法：

```python
PREFIX_SLUG = {
    'mv': 'movie', 'tv': 'tv', 'dc': 'documentary', 'an': 'anime', 'game': 'game',
    'app': 'software', 'bk': 'ebook', 'cs': 'course', 'ot': 'misc',
}

def detail_url(rid):
    slug = PREFIX_SLUG.get(str(rid).split('-')[0])
    if not slug:
        raise ValueError('未知 id 前缀：' + str(rid))
    return f'/{slug}/{rid}/'
```

线上 nginx 已经 301，跟随重定向的客户端暂时可用但多一跳；不跟随重定向的 HTTP 客户端会直接拿不到内容，所以这项必须改。

### 10.5 Windows 飞书简报脚本

`C:/Users/marco/Scripts/wodewangpan-fillfiles-feishu.mjs`：

- 找到按 id 拼详情页链接的地方（通常是 `'/resource/' + id + '/'` 或 `` `/resource/${id}/` ``），改成 10.4 的 `detailUrl(id)`，并把那段映射表贴到脚本顶部。
- 其它逻辑不动：脚本按 id 回查 `data/*.yaml` 拼标题、站点详情页与夸克链接，不要自己写链接或排版；`--follow` 里的死链候选 / 待加资源 / 追更提醒段落不受影响。

### 10.6 自检（贴完补丁后）

```powershell
cd <站点仓库>
npm run check:images     # 应输出「命中 1040 · 旧平铺 0 · 孤儿文件 0」
```

- 两份 skill 的 `node --check` 由一键脚本自动做；若出现「需手工核对」提示，按 10.2 的目标语义改完再跑一次（脚本幂等）。
- 下一轮定时任务入库后，确认新图落在 `static/images/<slug>/` 而不是根目录。
- `mybot` / 飞书脚本各打印一条拼出的 URL，应形如 `/movie/mv-457/`。

---

## 附：本次涉及的关键命令

```bash
npm run check:images                  # 配图盘点
npm run build                         # 本地构建（第二次应「重新生成 0 个」）
npx eslint scripts/ theme/assets      # 提交前 lint
cd /opt/wodewangpan && ALL=1 deploy/submit-indexnow.sh www.wodewangpan.top \
  /opt/indexnow/key.txt /opt/wodewangpan/public/sitemap.xml   # VPS 全量收录推送
```
