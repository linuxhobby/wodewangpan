# 开发 · 注意事项与改动禁忌

改代码 / 改数据 / 动部署之前必读。按「踩了会怎样」分组，**改 URL 相关的排最前**——这类错了不会报错，只会悄悄丢收录。

适用：本站（`www.wodewangpan.top`）前端、构建脚本、数据与部署的改动。
最近更新：2026-10-11（原 `dev-notes.md` 与 `pitfalls.md` 合并）。

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

## 二、前端样式与结构

### 页面宽度只有一个开关，别逐页传

全站（首页 / 分类页 / 详情页 / 标签页 / 内容页 / 404）统一用宽容器。档位由 `<body>` 上的一个 class 决定，页内所有容器读同一个变量：

```css
body.page--wide { --page-max: var(--page-wide); }   /* 唯一开关，在 layout() 里加 */
.wrap, .cats { max-width: var(--page-max); margin: 0 auto; }
```

- `layout()` 的 `wide` **默认就是 `true`**：新增页面不用传，忘了也不会错；只有确实要窄容器才显式传 `wide: false`。
- 反面教材（2026-10-11）：加标签页 `/tag/<slug>/` 时没传 `wide`（当时默认 `false`），整页比全站窄一圈。而 `wide` 原本要传给顶栏 / 分类栏 / 正文 / 页脚**四处**，漏一处就对不齐——所以改成现在这一处开关，9 处 `wide: true` 也一并删了。
- 新区块要跟全站同宽，用现成的 `.wrap`（或 `.cats`），**不要**再造一个 `.xxx--wide` 变体：那就是这次事故的源头。

### 样式只有一份、只有一类来源

- 样式全部写在 `theme/assets/style.css`：不写内联 `style="..."`，不写 `<style>` 块。散进 JS 里的样式没人找得到。
- 颜色 / 字号 / 行高 / 圆角 / 间距一律用 `:root` 令牌（`--fs-lg`、`--r-box` …）。确实缺档位就在 `:root` 加一行，**不要在区块里写死数值**——`npm run audit:css` 会直接报错。
- 同一视觉只定义一次，改一处两边同步：卡片海报与详情页海报共用 `.tile__poster, .poster`；按钮与二维码切换按钮共用 `.btn, .qrbtn`；内容页正文 / 详情页简介 / 404 说明共用同一条「字号 + 行高 + 色」；分类条 / 标签条 / 页面标题 / 首页区块的计数后缀共用同一条。
- 少用 `!important`。要覆盖就补标签名提特异性或调整顺序（见 `.foot p` 与 `p.foot__icp` 那段注释）。
- **合并规则的副作用（2026-10-11 踩过）**：把原本不设 `color`、靠继承父元素配色的元素，并进一条带 `color` 的公共规则，会把继承关系盖掉。`cat__n` 就是这样出的事——合并后它变成次要灰，而选中的分类胶囊是品牌紫实底，数字糊得看不见。合并前先查清楚目标元素的父元素**有没有实底 / 反白状态**，有就补一条 `.xxx.is-on .xxx__n`（见 `theme/assets/style.css` 里 `.cat.is-on .cat__n`）。

### 卡片结构只改一处

宫格卡片 `theme/assets/card.js` 被**两端共用**：构建期刷进首屏 HTML，浏览器里渲染「加载更多」和搜索结果。改结构只改这一份，两边各抄一份必然出现「首屏和点加载更多长得不一样」。

---

## 三、配置与数据目录

### `config/` 和 `data/` 分开

`config/site.yaml`、`config/tags.yaml` 是配置；`data/*.yaml` 是资源数据，一个分类一个文件。

### 遍历 `data/` 时必须排除配置文件

`scripts/lib/data.js` 里 `loadResources()` 和 `syncHeaderCounts()` 都遍历整个 `data/`，共用同一个常量：

```js
const NON_RESOURCE_FILES = new Set(['site.yaml', 'tags.yaml']);
```

**新增配置文件只改这一处。** 漏改的后果不对称：`loadResources()` 只是白扫一遍（map 结构取不到数组，退化成空，不报错），但 `syncHeaderCounts()` 会去改写该文件头部的「N 条」注释——属于埋雷，哪天格式对上了就出问题。

---

## 四、构建与产物

### 内容未变不覆盖，为的是让蜘蛛命中 304

`scripts/build.js` 的 `write()` 写盘前先比对：outDir 同路径 → 上一版产物（`BUILD_DIR=public.new` 时对照 `public/`，可用 `PREV_DIR` 改）。内容相同就沿用旧文件并 `utimes` 保留原 mtime。

对应地，**静态资源版本号用内容哈希，不要用 commit 哈希**——用 commit 的话每个提交都改一遍所有页面的 CSS/JS 链接，700 多页内容全变、mtime 全量刷新，304 照样落空。

### 改完数据必须构建

`data/*.yaml` 改了不构建，`public/` 里还是旧内容。本地预览服务吃的是 `public/`，**不热更新**——改完要 `npm run build` 再刷新。

### `syncHeaderCounts` 会改 YAML 头部的条数注释

构建时自动刷新，看到注释行变化是正常的，不是改错。

---

## 五、改资源数据

### 简介一律走工具，不要手改 YAML

`.tmp/desc-draft.json` + `node tools/fill-desc.mjs`（先空跑，确认后 `--apply`）。工具只改 `description` 那一行，自动接回 `【第 N 季 · 共 M 集】` 头和 `｜TMDB x.x` 后缀，并以 JSON 双引号标量写回，不会破坏 YAML 结构。

### 字数口径全站唯一

`scripts/lib/data.js` 的 `bodyLength()` / `MIN_DESC`（300）。`【…】` 标签和 `｜…` 署名不计入字数。历史坑：`tools/fill-desc.mjs` 曾自带一份只剥开头 `【…】` 的 `bodyLen`，与构建口径不一致，出现「脚本说够了、构建还在告警」——现已统一。

### 两个 Windows 专属坑

- `data/*.yaml` 是 **CRLF 换行**，用正则匹配整块（`/- id: xxx\n…/`）会失效，要按 `\r\n` 或改用位置切片。
- 沙箱里 `child_process.spawnSync` 调 CLI 会 **EBUSY**，改走 bash 脚本直接调。

---

## 六、部署与 Nginx

- 推到 `main`，VPS 每 2 小时自动拉取重建；急发走 `FORCE=1 site-autoupdate`。脚本先比对 HEAD，没新提交直接 `exit 0`，所以频率只决定上线延迟，空跑成本只有一次 `git fetch`。
- **`robots.txt` 只挡子路径** `Disallow: /*/search-index.json`。根路径 `/search-index.json` 是 Googlebot 渲染「加载更多」的通道，挡了自断一条发现路径。
- Nginx 的 410 规则（`^/.+/search-index\.json$`）**必须排在静态资源 location 之前**——nginx 正则 location 取第一个命中。
- 静态资源 location 带 `access_log off`，成功的 json 请求**不进日志**，只有 404 经 `error_page` 落到 `location /` 才被记录。日志里「全是 404」有一半是采样偏差，别拿它当抓取量。
- 改 nginx 的三步走与「必须放行清单」回归，见 [bot-traffic-蜘蛛流量治理.md](bot-traffic-蜘蛛流量治理.md) 第七节。

---

## 七、改完的自检

```bash
npm run build && npm run audit:css
```

`audit:css` 查三件事：用了但没写样式的 class、写了但产物里用不到的 class（多半是 HTML 改了样式没清）、区块里写死的数值。三项全绿才算完。

新页面的宽度档位一眼可验（与首页对比）：

```bash
grep -o '<body[^>]*>\|class="wrap[^"]*"\|class="cats[^"]*"' public/index.html public/tag/<slug>/index.html
```

七类页面都应输出 `<body class="page--wide">`。

---

## 八、相关

- 环境与命令速查：[environment-环境与命令速查.md](environment-环境与命令速查.md)
- 内容文案与素材规范：[content-内容规范.md](content-内容规范.md)
- 网络侧爬虫处置：[bot-traffic-蜘蛛流量治理.md](bot-traffic-蜘蛛流量治理.md)
- 变更记录：[changelog-变更记录.md](changelog-变更记录.md)
