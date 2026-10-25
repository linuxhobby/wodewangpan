# site · 建站、开发与部署

改代码 / 改数据 / 动服务器之前必读。按「踩了会怎样」分组，**改 URL 相关的排最前**——这类错了不会报错，只会悄悄丢收录。

> 适用：本站（`www.wodewangpan.top`）前端、构建脚本、数据与部署。环境路径与命令速查在第七节。
> 最近更新：2026-10-13（由「开发注意事项 + 环境与命令速查」两篇合并）。

---

## 一、注释写结论，理由写这篇

代码注释只保留两样：**结论**和**反例**（一行以内，说明「为什么不能那样写」）。背景、来龙去脉、踩坑经过一律写进本篇。

这条本身就是踩出来的：注释一旦开始讲完整故事，就会跟代码一起变长、一起过期，而真正需要它的人（半年后改这段的人）找不到它也看不完。2026-10-12 统一清理过一轮，`build.js` 注释占比从 24% 降到 9%，`data.js` 27% → 15%，`render.js` 15% → 8%。

留下来的都是这一类：

```js
// 静态资源版本号用内容哈希，不能用 commit：commit 会让每次提交都改写所有页面的 ?v=
// 目录名用未编码的真实中文：%E5%89%A7%E6%83%A5 会被 nginx 解码再匹配文件系统
```

判据很简单：**删掉这行，会不会有人重新踩同一个坑？** 不会就删。

---

## 二、URL 与收录（改了不报错，但会丢排名）

### `id` 就是 URL，绝不能改

`/resource/mv-046/` 里的 `mv-046` 直接取自 `data/*.yaml` 的 `id`。改 id = 换地址 = 已收录页面 404。编号规则见 [content-内容生产.md](content-内容生产.md) 第三节。

### 分类 slug：改别名等于换 URL

`config/site.yaml` 的 `slugs` 给分类配英文名。已收录之后改 = 换 URL。

### 标签 slug：三级取值，别名表「只增不改」

`scripts/lib/data.js` 的 `tagSlug()`：

```js
return TAG_SLUGS.get(key) || (SLUG_FALLBACK && SLUG_FALLBACK(key)) || key;
//      ① config/tags.yaml 的手写别名   ② 拼音兜底            ③ 原样（编码中文）
```

- ① 已配别名的（34 个英文 slug）**永远不要动**。
- ② 新标签不用手工补表，自动落拼音 URL（没配的走 `kehuan` 这类）。
- **已经落到拼音 URL 的标签，事后再补别名同样等于换 URL**——`tagSlugs` 因此是只增不改的表，只能给还没被收录的新标签配。

### `pinyin-pro` 必须在 `dependencies`

它决定的不只是搜索体验，还有**标签 URL**。放 `devDependencies` 的话，部署机 `npm i --omit=dev` 会让它缺席：本地是拼音 URL、线上退化成 `%E7%A7%91%E5%B9%BB` 编码路径，两边不一致，直接丢排名。已移进 `dependencies` 并刷过 `package-lock.json`（dev 标记也要跟着消失）。

### 标签 slug 撞车

两个标签算出同一个 slug 会写进同一个 `/tag/xxx/`，后写的覆盖先写的，构建**不报错**、产物目录看着也齐全。拼音兜底让同音撞车概率变大，所以构建时会检测并点名。撞了就在 `config/tags.yaml` 的 `tagSlugs` 里给其中一个配别名。

---

## 三、前端样式与结构

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
- **合并规则的副作用（2026-10-11 踩过）**：把原本不设 `color`、靠继承父元素配色的元素，并进一条带 `color` 的公共规则，会把继承关系盖掉。`cat__n` 就是这样出的事——合并后它变成次要灰，而选中的分类胶囊是品牌紫实底，数字糊得看不见。合并前先查清楚目标元素的父元素**有没有实底 / 反白状态**。
- **一个区块一个类族，别拆着放**（2026-10-25 清理）：`style.css` 按「令牌 → 基础 → 顶栏 → 分类栏 → 列表/卡片 → 通用小件 → 内容页 → 详情页 → 按钮 → 热门榜 → 404 → 页脚 → 移动端」分段，同一功能的规则只在自己的段落里。此前 `.hot__*` 整段落被夹在「详情页」中间，且 `10px` / `999px` / `#4B3FE3` / `var(--bg-soft, …)` 全是写死的（其中 `--bg-soft` 根本没定义，一直靠兜底值生效）。已全部换成 `--r-box` / `--r-pill` / `--brand` / `--fill-soft`。
- **跨容器复用同一组链接时要查权重**：标题栏右侧链接组（`.page__invite` / `.page__hot`）放进详情页面包屑后，被 `.crumb a`（0,1,1）压成灰色，得用 `:not()` 排除，见 `.crumb` 上方注释。复用组件前先看目标容器有没有 `.xx a` 这类后代选择器。

### 卡片结构只改一处

宫格卡片 `theme/assets/card.js` 被**两端共用**：构建期刷进首屏 HTML，浏览器里渲染「加载更多」和搜索结果。改结构只改这一份，两边各抄一份必然出现「首屏和点加载更多长得不一样」。

---

## 四、配置与数据目录

### `config/` 和 `data/` 分开

`config/site.yaml`、`config/tags.yaml` 是配置；`data/*.yaml` 是资源数据，一个分类一个文件。

### `config/tags.yaml` 里三档「标签要不要出页」

| 配置 | 作用 | 适用 |
|---|---|---|
| `tagExclude` | **不建页**，标签照常显示但不可点 | 内容与某个分类页高度重合、确认没有保留价值 |
| `tagOverlapAllow` | **建页**，重合已知且接受，构建不再告警 | 覆盖面优先于去重（如 macOS） |
| `tagMeta` | 建页，并单独定制 `title` / `h1` / `desc` | 与分类页重合时，给两页不同的切入点 |

- `tagOverlapMax: 0.8` 是告警线（Jaccard = 重合数 / 两页并集）。超过就说明两页对搜索引擎基本是同一份内容。
- 判据**不能**用「标签里几成资源属于该分类」：冒险 / 科幻本来就 100% 属于电影，可只占电影一两成，用它会误报一片。
- `tagOverlapMinSize: 10` 是参与比对的最小条数：小集合 Jaccard 极不稳定（Linux 4 条 vs 操作系统 6 条就有 67%）。
- **macOS 是这套判断的现实样本**：2026-10-11 因 93% 重合被 `tagExclude` 砍掉；10-12 因为它是主要标签、用户要这个入口而放出，改挂 `tagOverlapAllow` + `tagMeta`（标题改成「Mac 专属软件与游戏资源」）。
- 某个标签该归哪一项，是判断不是计算。写进配置时请在注释里留一句为什么。

**内容重合的两页要活得下来，得让 title / h1 / description 各有切入点。只改 `<title>` 不够**——OG 标题与结构化数据里的 `name` 要跟着走，否则出现「搜索摘要是新文案、结构化数据是旧的」这种自相矛盾。用 `tagMeta` 改，别在 `render.js` 里写特例。

### 遍历 `data/` 时必须排除配置文件

`scripts/lib/data.js` 里 `loadResources()` 和 `syncHeaderCounts()` 都遍历整个 `data/`，共用同一个常量：

```js
const NON_RESOURCE_FILES = new Set(['site.yaml', 'tags.yaml']);
```

**新增配置文件只改这一处。** 漏改的后果不对称：`loadResources()` 只是白扫一遍（退化成空，不报错），但 `syncHeaderCounts()` 会去改写该文件头部的「N 条」注释——属于埋雷，哪天格式对上了就出问题。

---

## 五、构建与产物

### 内容未变不覆盖，为的是让蜘蛛命中 304

`scripts/build.js` 的 `write()` 写盘前先比对：同路径 → 上一版产物（`BUILD_DIR=public.new` 时对照 `public/`，可用 `PREV_DIR` 改）。内容相同就沿用旧文件并 `utimes` 保留原 mtime。实测二次构建 722 个文件全部沿用、0 个重写（58.7s → 34.9s）。

对应地，**静态资源版本号用内容哈希，不要用 commit 哈希**——用 commit 的话每个提交都改一遍所有页面的 CSS/JS 链接，700 多页内容全变、mtime 全量刷新，304 照样落空。

### 其他几条

- **改完数据必须构建**：`data/*.yaml` 改了不构建，`public/` 里还是旧内容。本地预览服务吃的是 `public/`，**不热更新**——改完要 `npm run build` 再刷新。
- **`syncHeaderCounts` 会改 YAML 头部的条数注释**：构建时自动刷新，看到注释行变化是正常的。
- **构建不回收已删条目的旧产物**：下架一条要手工清四处，步骤见 [content-内容生产.md](content-内容生产.md) 第五节。
- **`robots.txt` 与 `sitemap.xml` 是 `build.js` 生成的产物**：要改规则必须改 build.js 的模板字符串，手改 `/opt/wodewangpan/public/robots.txt` 会在下一次构建时被整目录换掉。

---

## 六、部署与 Nginx

- 推到 `main`，VPS 每 6 小时自动拉取重建（`0 */6`）；急发不必等 cron，在推送方执行 `ssh <host> 'flock -w 120 /tmp/site-autoupdate.lock site-autoupdate'`，约 30 秒上线。脚本先比对 HEAD，没新提交直接 `exit 0`，频率只决定上线延迟上限。
- **`robots.txt` 只挡子路径** `Disallow: /*/search-index.json`。根路径 `/search-index.json` 是 Googlebot 渲染「加载更多」的通道，挡了自断一条发现路径。
- Nginx 的 410 规则（`^/.+/search-index\.json$`）**必须排在静态资源 location 之前**——nginx 正则 location 取第一个命中。
- 静态资源 location 带 `access_log off`，成功的 json 请求**不进日志**，只有 404 经 `error_page` 落到 `location /` 才被记录。日志里「全是 404」有一半是采样偏差，别拿它当抓取量。
- `gzip_types` 必须带 `text/xml`：nginx 的 `mime.types` 把 `.xml` 映射成 **text/xml** 而不是 `application/xml`，只写后者时 `sitemap.xml` / `feed.xml` 完全不压缩（2026-10-22 实测响应头只有 `content-length: 210066 / 78433`，无 `content-encoding`，而 `/` 正常）。一并写 `application/rss+xml` `application/atom+xml`，供自建 feed 端点显式声明 Content-Type 时命中。改完 `nginx -t && systemctl reload nginx`，再用 `curl -H 'Accept-Encoding: gzip'` 逐个端点看头，别只看首页。
- 完整部署步骤（Nginx 配置、HTTPS、自动更新、访问统计）→ 根 `README.md`。
- 改 nginx 的三步走与「必须放行清单」回归 → [SEO-收录与流量.md](SEO-收录与流量.md) 第七节。

### 迁到 Cloudflare Pages：可行性与上线前必修（2026-10-12 评估，未执行）

结论：**技术上可行、免费额度足够，但不适合直接切主站**——Pages 上没有 nginx，而本站的蜘蛛治理整套长在 nginx 上。真要试，顺序是先修验证文件、用 `xxx.pages.dev` 双跑对比，而不是先改 DNS。

| 项 | 值 | 依据 |
|---|---|---|
| Framework preset | `None` | 非框架项目 |
| Build command | `npm ci && npm run build` | `package.json` 的 `build` = `node scripts/build.js` |
| Output directory | `public` | `public/` 整目录不入库，由 CI 自建 |
| Production branch | `main` | 与 VPS 拉取分支一致 |
| 环境变量 | `NODE_VERSION=20` | `engines` 只写 `>=18`，不锁死会让构建 Node 版本随 CF 默认漂移 |

额度与体积够用：`public/` 36MB、700 多页，上限 2 万文件 / 单文件 25MB；带宽与请求数不限量，构建 500 次/月。`sharp` 在 `optionalDependencies`，装不上也不中断构建，只是配图处理降级。切过去之后 `deploy/site-autoupdate.sh` 退役；IndexNow 推送只是往 `api.index-now.org` 发 POST，cron 可继续留在 VPS。

**两个必修阻塞，不修就是上线即坏：**

1. **站点验证文件会 404。** `baidu_verify_*.html` 和 IndexNow 的 `key.txt` 都被 `.gitignore` 排除，线上靠 nginx 从 `/opt/seo/`、`/opt/indexnow/` 映射。Pages 没有 nginx、构建产物里也不含这两个文件 → 百度验证失效、IndexNow 密钥不可访问。修法：仓库根建 `seo/` 放这两个文件，`.gitignore` 补 `!seo/` 例外，再在 `build.js` 末尾把 `seo/*` 拷进 `outDir`。
   > 顺带纠正一处旧记录：曾写「`baidu_verify_*.html` 永久保留在 `public/` 防丢」——`public/` 既不入库又每次被构建覆盖，那个位置保不住东西。
2. **蜘蛛治理无法平移。** 444 探针、referer 零回流 403 名单都是 nginx 逻辑；CF 侧只有 WAF 自定义规则（Free 约 10 条），做不到「看 referer 判是不是真人回流」这种带状态的判定。等于那套四层策略只剩一个粗筛。

真正的天花板还是原来那条，跟托管在哪无关：**CF Free 没有中国网络节点**，备案 + 大陆节点仍是百度系唯一破局手段（见 [SEO-收录与流量.md](SEO-收录与流量.md)）。所以 Pages 的价值主要是省运维和多一层容灾，不是解决收录。

---

## 七、环境速查

### 位置一览

| 项 | 路径 |
|---|---|
| 站点仓库 | macOS `/Users/marco.chan/Documents/GitHub/wodewangpan`；Windows `C:\Users\marco\Github\wodewangpan` |
| 远端 | `git@github.com:linuxhobby/wodewangpan.git` |
| 线上站点 | https://www.wodewangpan.top |
| 资源同步 skill | `~/.workbuddy/skills/quark-resource-sync/`（v1.11） |
| 夸克网盘 CLI skill | `~/.workbuddy/skills/quarkclouddrive/`（CLI 本体 `scripts/quark-drive.cjs`） |
| 上传出链 skill | `~/.workbuddy/skills/quark-upload-share/` |
| skill 配置（**含凭据**） | `~/.workbuddy/skills/quark-resource-sync/config.env` |
| skill 缓存 | `~/.workbuddy/quark-sync-cache/`（`trending-seen.json` 等） |
| 双机中转目录 | `~/Documents/SynologyDrive/sync-skill/`（不含 `config.env`） |
| CodeBuddy skill 联建脚本 | `~/.workbuddy/skills/.link-codebuddy-skills.sh` |
| skill macOS 本地化脚本 | `~/.workbuddy/skills/.quark-macos-localize.py` |

> **凭据的真实值一律不写进文档**，这里只记「在哪、叫什么」。

### 命令速查

站点：

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建到 `public/`，含 SEO 自检 |
| `npm run serve` | 本地预览 http://localhost:4321 |
| `npm run dev` | 构建 + 预览 |
| `npm run new` | 交互式新建一条资源 |
| `npm run list:short -- --max=320` | 列出正文不足指定字数的条目（同时写 `.tmp/short-desc.md`） |
| `npm run audit:css` | CSS 自检 |

配图与封面：

```bash
node tools/poster.mjs douban --title "书名" --out static/images/bk-001.jpg   # 抓豆瓣正版封面（电子书优先）
node tools/poster.mjs book   --title "书名" --out static/images/bk-002.jpg   # 豆瓣查无此书时生成兜底
node tools/poster.mjs icon   --icon <图标> --out static/images/app-001.png   # 图标合成竖版
node tools/poster.mjs set    --title "套装名" --out static/images/bk-006.jpg # 套装深色封面
node tools/share-poster.mjs  # 改完站点配置后重跑，刷新 static/share.jpg
```

资源同步 skill（`S=~/.workbuddy/skills/quark-resource-sync/scripts`）：

```bash
node $S/scan-new.mjs                 # 扫描 SHARE，列出待编号目录
node $S/tmdb.mjs search --type movie --query "片名"
node $S/make-entry.mjs --data '{...}'
node $S/check-desc.mjs --file movie.yaml
node $S/trending-sync.mjs --dry-run --no-build --no-push
```

### 运行时与写脚本的注意

| 项 | 值 |
|---|---|
| Node（管理版） | v22.22.2，`~/.workbuddy/binaries/node/versions/22.22.2-6/bin/node` |
| 系统 | macOS（zsh），另一台是 Windows |
| 依赖 | `js-yaml`、`sharp`、`pinyin-pro`（**必须在 `dependencies`**，理由见第二节） |

写脚本时注意：**Node 只用内置模块**，不要引入需要 npm install 的库；临时文件一律走 `os.tmpdir()`，别写死 `/tmp/`（Windows 无效）。

两个 Windows 专属坑：`data/*.yaml` 是 CRLF 换行（正则匹配整块会失效，改用位置切片）；沙箱里 `spawnSync` 调 CLI 会 EBUSY（改走 bash 脚本直接调）。

---

## 八、改完的自检

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

## 九、相关

- 入库、文案、配图、skill：[content-内容生产.md](content-内容生产.md)
- 网络侧爬虫处置：[SEO-收录与流量.md](SEO-收录与流量.md)
- 待办与变更：[record-待办变更与规划.md](record-待办变更与规划.md)
