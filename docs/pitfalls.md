# 注意事项

按"踩了会怎样"分组。**改 URL 相关的事情排最前**——这类错了不会报错，只会悄悄丢收录。

---

## 一、URL 与收录（改了不报错，但会丢排名）

### `id` 就是 URL，绝不能改

`/resource/mv-046/` 里的 `mv-046` 直接取自 `data/*.yaml` 的 `id`。改 id = 换地址 = 已收录页面 404。

### 分类 slug：改别名等于换 URL

`config/site.yaml` 的 `slugs` 给分类配英文名。已收录之后改 = 换 URL。

### 标签 slug：三级取值，别名表「只增不改」

`scripts/lib/data.js` 的 `tagSlug()`：

```js
return TAG_SLUGS.get(key) || (SLUG_FALLBACK && SLUG_FALLBACK(key)) || key;
//      ① config/tags.yaml 的手写别名   ② 拼音兜底            ③ 原样（编码中文）
```

- ① 已配别名的（34 个英文 slug）**永远不要动**。
- ② 新标签不用手工补表，自动落拼音 URL（`科幻` → `sci-fi` 已配；没配的走 `kehuan` 这类）。
- **已经落到拼音 URL 的标签，事后再补别名同样等于换 URL**——`tagSlugs` 因此是只增不改的表，只能给还没被收录的新标签配。

### `pinyin-pro` 必须在 `dependencies`

它决定的不只是搜索体验，还有**标签 URL**。放 `devDependencies` 的话，部署机 `npm i --omit=dev` 会让它缺席：本地是拼音 URL、线上退化成 `%E7%A7%91%E5%B9%BB` 编码路径，两边不一致，直接丢排名。已移进 `dependencies` 并刷过 `package-lock.json`（dev 标记也要跟着消失）。

### 标签 slug 撞车

两个标签算出同一个 slug 会写进同一个 `/tag/xxx/`，后写的覆盖先写的，构建**不报错**、产物目录看着也齐全。拼音兜底让同音撞车概率变大，所以构建时会检测并点名。撞了就在 `config/tags.yaml` 的 `tagSlugs` 里给其中一个配别名。

---

## 二、配置与数据目录

### `config/` 和 `data/` 分开

`config/site.yaml`、`config/tags.yaml` 是配置；`data/*.yaml` 是资源数据，一个分类一个文件。

### 遍历 `data/` 时必须排除配置文件

`scripts/lib/data.js` 里 `loadResources()` 和 `syncHeaderCounts()` 都遍历整个 `data/`，共用同一个常量：

```js
const NON_RESOURCE_FILES = new Set(['site.yaml', 'tags.yaml']);
```

**新增配置文件只改这一处。** 漏改的后果不对称：`loadResources()` 只是白扫一遍（map 结构取不到数组，退化成空，不报错），但 `syncHeaderCounts()` 会去改写该文件头部的「N 条」注释——属于埋雷，哪天格式对上了就出问题。

---

## 三、构建与产物

### 内容未变不覆盖，为的是让蜘蛛命中 304

`scripts/build.js` 的 `write()` 写盘前先比对：outDir 同路径 → 上一版产物（`BUILD_DIR=public.new` 时对照 `public/`，可用 `PREV_DIR` 改）。内容相同就沿用旧文件并 `utimes` 保留原 mtime。

对应地，**静态资源版本号用内容哈希，不要用 commit 哈希**——用 commit 的话每个提交都改一遍所有页面的 CSS/JS 链接，700 多页内容全变、mtime 全量刷新，304 照样落空。

### 改完数据必须构建

`data/*.yaml` 改了不构建，`public/` 里还是旧内容。本地预览服务吃的是 `public/`，**不热更新**——改完要 `npm run build` 再刷新。

### `syncHeaderCounts` 会改 YAML 头部的条数注释

构建时自动刷新，看到注释行变化是正常的，不是改错。

---

## 四、改资源数据

### 简介一律走工具，不要手改 YAML

`.tmp/desc-draft.json` + `node tools/fill-desc.mjs`（先空跑，确认后 `--apply`）。工具只改 `description` 那一行，自动接回 `【第 N 季 · 共 M 集】` 头和 `｜TMDB x.x` 后缀，并以 JSON 双引号标量写回，不会破坏 YAML 结构。

### 字数口径全站唯一

`scripts/lib/data.js` 的 `bodyLength()` / `MIN_DESC`（300）。`【…】` 标签和 `｜…` 署名不计入字数。历史坑：`tools/fill-desc.mjs` 曾自带一份只剥开头 `【…】` 的 `bodyLen`，与构建口径不一致，出现"脚本说够了、构建还在告警"——现已统一。

---

## 五、部署与 Nginx

- 推到 `main`，VPS 每 2 小时自动拉取重建；急发走 `FORCE=1 site-autoupdate`。脚本先比对 HEAD，没新提交直接 `exit 0`，所以频率只决定上线延迟，空跑成本只有一次 `git fetch`。
- **`robots.txt` 只挡子路径** `Disallow: /*/search-index.json`。根路径 `/search-index.json` 是 Googlebot 渲染「加载更多」的通道，挡了自断一条发现路径。
- Nginx 的 410 规则（`^/.+/search-index\.json$`）**必须排在静态资源 location 之前**——nginx 正则 location 取第一个命中。
- 静态资源 location 带 `access_log off`，成功的 json 请求**不进日志**，只有 404 经 `error_page` 落到 `location /` 才被记录。日志里"全是 404"有一半是采样偏差，别拿它当抓取量。
