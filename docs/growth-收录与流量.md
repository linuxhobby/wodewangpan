# growth · 收录与网络流量

搜索引擎为什么抓、抓了哪些、哪些该拦：收录现状、抓取预算、日志解析方法、nginx 爬虫策略，以及还在排队的优化项。

> 适用：本站（`www.wodewangpan.top`）的收录推进、抓取预算分配与网络侧治理。
> 依据站点 Nginx 日志中各引擎蜘蛛的实际抓取记录；**脚本化 `site:` 查询不作数**（见第二节）。
> 最近更新：2026-10-13（由「SEO 收录与优化 + 蜘蛛流量治理」两篇合并）。

---

## 一、最重要的一条判断准则

**一个爬虫值不值得放行，看它有没有回流真人点击（referer），不要看它抓了多少。**

抓取量大 ≠ 有价值。按这个标准复核 9 天数据（2026-10-03 → 10-11，35,762 次请求），结论和直觉完全相反：

| 来源 | referer 回流 | 抓取量 | 处置 |
|---|---:|---:|---|
| Google | **281** | 938 | 放行，且要主动喂 |
| 百度 | 37 | 27 | 放行 |
| Yandex | 5 | 710 | 放行 |
| Bing | 1 | 16 | 放行 |
| ShapBot / KeenableBot / SkytabBot | **0** | 5,807 | 403 |
| SemrushBot / AhrefsBot / MJ12bot / serpstatbot | **0** | 1,916 | 403 |

全站真人 UV 九天只有 186 人，而这三家 AI 索引器 + 四家 SEO 工具合计 **7,723 次**请求。带宽几乎全花在不会回头客身上。

注意别一刀切：**PerplexityBot / OAI-SearchBot / Claude-SearchBot / Google-Extended 会真的带 AI 摘要与引荐链接**，本站刻意保留放行（ClaudeBot 767 次、GPTBot 620 次也未封）。判断标准是「它是否把流量还给我」，不是「它是不是机器人」。

---

## 二、别从数据中心 IP 跑 `site:` 查询

想知道被哪些引擎收录，第一反应 `curl "https://www.google.com/search?q=site:域名"`——**这条路是错的**：

- Google / 百度 / Yandex / DuckDuckGo 直接返回空页或验证码页；
- Bing 返回 200 和一大段 HTML，但里面的域名全是**查询词回显**，真实结果指向知乎/百度经验。按 `grep -c 域名` 数会得到「26 条命中」的假阳性。

正确做法是**解析站点自己的访问日志**，按 user-agent 归类。蜘蛛来不来、抓了哪些页、返回什么状态码，日志比任何外部查询都权威。

精确收录量只能去各家站长后台（GSC / Bing Webmaster / 百度站长）看报表——这也是「必须先填 `verification`」的原因（见第八节）。

---

## 三、收录现状

起步阶段，正在推收录。**权威收录量以后台报表为准**。

| 引擎 | 状态 | 天花板在哪 |
|---|---|---|
| Google | 有抓取，但偏科严重 | 抓取预算被首页吃掉 |
| Bing / 360 | 全量推送已通（708 成功 / 0 失败），等起量 | 推送链路没问题，看 Crawl stats |
| 百度 | 站长平台已验证，但**内容页零抓取** | **资质**：`icp` 为空 + 香港节点无备案 |
| 搜狗 / 字节 / 华为 | 零到访 | 无开放 API，只能提交 sitemap 引蜘蛛 |

---

## 四、抓取预算：实测与结论

**偏科数据**：首页被抓 583 次（约七成配额），资源页仅覆盖 159/702。

### 已验证的结论

- **304 才是腾预算的手段**。原先每小时全量重建 → 700 多个详情页 mtime / ETag 每次刷新 → `If-Modified-Since` 永远不命中（日志特征：200×810，几乎无 304）。改成「内容未变不覆盖」后，重复访问从 200 变 304，预算自然腾给新页。
- **静态资源版本号必须跟内容走，不能跟 commit 走**。用 commit 的话每个提交都改一遍所有页面的 CSS/JS 链接，700 多页内容全变、mtime 全量刷新，304 照样落空。

### 被推翻的结论（别再走回头路）

- ~~冻结首页 `<lastmod>` 以省预算~~ → **不要做**。首页按分类各取最新几条，任何分类新增都会改变首页，lastmod 是真实信号，人为冻结会让 Google 判定其不可信。
- ~~调 `<priority>` / `<changefreq>`~~ → **没用**，Google 官方忽略这两个字段。
- ~~整条屏蔽 `search-index.json`~~ → **只挡子路径**。线上实测根路径是 200，404 全在 `/resource/<id>/search-index.json` 这类子路径上（历史残留，蜘蛛仍按记忆重试）。根路径是 Googlebot 渲染「加载更多」的通道，一起挡等于自断一条发现路径。

### 几类页面的存在理由

| 页面 / 机制 | 为什么必须有 |
|---|---|
| 全量索引页 `/all/` | 列表页 HTML 只渲染前 `pageSize` 张卡片，其余靠 JS 补齐。不执行 JS 的蜘蛛走到列表页就没有下一条路（实测 Googlebot 只覆盖 122 个资源页，Yandex 靠 sitemap 走了 514 个） |
| 详情页「相关推荐」（10 条） | 详情页之间原本零互链，593 个详情页各自是孤岛。取 10 条是配合宫格一行 5 列排满两行 |
| 热门标签区块（前 20） | 标签页之间靠它互链。没有它，后排标签站内任何导航都到不了，只能等蜘蛛从 sitemap 挖 |
| `/tags/` 总览页 | 同上，给全部标签一个入口，不是装饰 |
| 图片 sitemap 的 `image:loc` | 详情页海报是本站唯一大批量原创图片资源，图片搜索是网页搜索之外第二个真实入口 |
| `lastmod` 写真实日期 | 每次构建把全站刷成同一天，搜索引擎会判定不可信并降低抓取频率 |
| 占位海报排除出图索引 | 「分类 + 暂无配图」一张被几十个 URL 引用，写进索引只会稀释真海报，按文件名里的 `placeholder` 排除 |

### 页面体积

| 页面 | 体积 | 备注 |
|---|---|---|
| 首页 | 102KB（gzip 26KB） | 大头是 noscript 里那 663 条详情页链接，不是卡片 |
| `/all/` | 132KB / 702 条链接 | 蜘蛛「一次抓完全站」的主通道，保持进 sitemap，别被 robots 误伤 |

---

## 五、日志解析的三个坑

### 1. 统计状态码 / 路径要按引号切字段，且只匹配请求 URI

nginx combined 一行里有 4 对引号，`-F'"'` 切完之后：

| 字段 | 内容 |
|---|---|
| `$2` | 请求行 `GET /path HTTP/1.1` |
| `$3` | 空格分隔后：第 1 段 = 状态码，第 2 段 = 字节数 |
| `$4` | referer |
| `$6` | user-agent |

**整行 grep 会误报**。真实案例：想统计 `.php` 探测，结果混进一批状态码 200 的「PHP 请求」——实际是 `facebookexternalhit` 的 **UA 里含 `externalhit_uatext.php`**，请求路径是正常资源页。凡是统计探测，必须先切出路径字段再匹配。

### 2. 服务器上是 mawk，三个语法限制

- 不支持 `{3}` 区间正则 → 写 `[0-9][0-9][0-9]`；
- 正则里出现 `{` 会被当区间起始 → 写成 `[{]`；
- 超长 `a|b|c|...` alternation 报 `runaway regular expression` → 改用 `index(u, "kw")` 逐串判断。

### 3. 判断 444 要看 curl 退出码，且别配 `set -e`

`return 444` 是关连接，`curl -w '%{http_code}'` 拿到 `000`、**退出码 52**。脚本里若开了 `set -e`，第一个断连测试就会把整个脚本打断，排查半天像「规则没生效」。

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u"); rc=$?
[ $rc -eq 52 ] && echo "断连(444)" || echo "HTTP $code"   # 不要用 set -e
```

---

## 六、真人流量怎么估

浏览器 UA 的数量**严重虚高**：本站 17,911 次「浏览器 UA」请求里，净真人页面请求只有 1,932 次。两个口径分开用：

- **下界（可信）**：只有真正执行了 JS 的浏览器才有 `vid` cookie 和 `/hit` 信标（站点自带埋点，`render.js` 的 `STATS_SCRIPT`）。据此得 **UV 186 人 / 9 天 ≈ 20 人/天**，与日志里 160 个 IP 触发 837 次 `/hit` 吻合。
- **上界（宽口径）**：浏览器 UA + 只访问站内真实路由 + 剔除单 IP > 30 次的脚本 → 944 IP、1,071 访客。多出来的是「只抓 HTML、不执行 JS」的低频采集。

### 识别伪装成浏览器的脚本

四个特征，命中两条以上基本就不是人：

1. **UA 是固定且过时的版本串**——真实用户的版本是发散的。本次：`Chrome/122.0.0.0` 2,838 次仅 4 个 IP、`Version/26.0.1` Safari 1,825 次仅 5 个 IP。
2. **请求 / IP 比值高**——真人一次会话几跳到几十跳，脚本会打到几百。
3. **源 IP 落在云厂商机房段**——本次最大的一个假 iPhone 家族（`iPhone OS 13_2_3`，2020 年的 UA）1,437 次散布在 398 个 IP，全是腾讯云 / 阿里云段。
4. **扫描路径占比高**——同一 UA 大量请求 `wp-admin`、`.env`、`.php`。

---

## 七、nginx 策略：四层各管什么

现生效配置（`/etc/nginx/conf.d/`，仓库镜像在 `deploy/`）：

| 层 | 手段 | 针对 | 文件 |
|---|---|---|---|
| 1 | `return 410` | 蜘蛛记忆里的**已死 URL**（`/resource/*/search-index.json`） | `wodewangpan.conf` |
| 2 | `return 444` | 漏洞扫描探测（wp-admin / .env / .git / 任意 .php / phpunit / nacos…） | `00-block-probes.conf` |
| 3 | `return 403` | 零回流的 AI 与 SEO 爬虫名单 | `00-block-ai.conf` |
| 4 | robots.txt | 上述两者的「礼貌层」声明 | 构建产物 |

三条实战要点：

- **410 而不是 404。** 410 Gone 让蜘蛛衰减得比 404 快得多。`search-index.json` 子路径改 410 后，实测从 10-09 的 80 次 → 10-10 的 3 次 → 10-11 的 2 次。但**根目录那份必须留 200**。
- **`if ... return` 要放 server 块最前面。** 放在裸域与 http→https 的 `if` 之后，探测请求会先白吃一个 301 再被拦（部署前实测有 1,371 次探测走的是 301）。顺带：server-rewrite 阶段**早于** preaccess 阶段，所以 `if ... return` 优先于 `limit_req`——被拦的爬虫根本不消耗限速桶。
- **只挡子路径，别误伤特例。** 444 规则要绕开 `key.txt`（IndexNow）、`baidu_verify_*.html`、`.well-known/acme-challenge/`、根 `search-index.json`。

### 改动上线的操作规范（踩坑所得）

1. **`robots.txt` 和 `sitemap.xml` 是 `build.js` 生成的产物**——手改线上文件会在下一次构建时被换掉。
2. **`site-autoupdate.sh` 不覆盖 nginx conf**，所以线上直改 nginx 是安全的，但**要记得回写 `deploy/` 镜像**。
3. **不删服务器上的配置文件，改名停用。** `include /etc/nginx/conf.d/*.conf` 是 glob，改名成 `.disabled-时间戳` 即失效又可回退。
4. **每次改 nginx 三步走**：`cp -a` 备份 → 改 → `nginx -t` 通过才 `reload`。用 `nginx -T` 确认某文件**是否真的被载入**。
5. **两个相互依赖的改动必须在同一次 reload 里做完**：删 map 文件却留着 `limit_req zone=...`，`nginx -t` 会因 zone 悬空直接失败。
6. **验证要双向**：既测「该拦的拦住了」，也测「不该动的没动」（Googlebot 桌面+手机、Yandex、百度、Bing、Applebot、保留的 AI、真人、`robots.txt` / `sitemap.xml` / `stats.json` / `key.txt` / 404 页）。
7. **在共享仓库里提交前先 `git status`**：只 `git add` 自己那一个文件，别把别人的在途改动打包进自己的提交。

### 限速为什么整段作废（以及怎么才有效）

`00-crawler-limit.conf` 曾用 `map $http_user_agent` 命中后以 **`$binary_remote_addr`（单 IP）** 为 key，`rate=30r/m burst=20`。九天只触发 183 次 429，等于没限速：ShapBot 420→346/天、KeenableBot 36→**426**/天、MJ12bot 43→68/天。

**根因**：这些 bot 只用了 9~44 个 IP 且爬得慢（ShapBot 平均 38 请求/IP/天），单 IP 令牌桶永远填不满。

要限总量，key 必须换成**按 UA 的固定 token**（同一家 bot 的所有 IP 共用一个桶）：

```nginx
map $http_user_agent $crawler_limit_key {
    default   "";
    ~*Google  "google";      # 只给"想保留但可能抽风"的引擎封顶
    ~*Claude  "claude";
}
limit_req_zone $crawler_limit_key zone=crawler_limit:10m rate=6r/m;   # ≈8,600 次/天全局上限
```

本次的处置是：这五家已被 403 硬拦，限速条目全部失效 → **整个文件摘掉**（改名 `.disabled-时间戳`），而不是把一份死配置塞进 git。若日后按此重建，**记得同时放进 `deploy/` 并在 `deploy/nginx-site.conf.example` 补上 `limit_req` 那行**。

---

## 八、优化项（按性价比排序）

已闭环：

- [x] **只清理 `search-index.json` 子路径残留**：`Disallow: /*/search-index.json` + Nginx 410。80 次/天 → 2 次/天。
- [x] **内部接口屏蔽**：`Disallow: /stats.json`、`Disallow: /hit`。
- [x] **构建改「内容未变不覆盖」**：722 个文件全部沿用、0 个重写（58.7s → 34.9s）。
- [x] **重建频率定为每 2 小时**：脚本先比对 HEAD，没新提交就 `exit 0`，空跑成本只有一次 `git fetch`。
- [x] **7 家零回流爬虫 403 封禁**，nginx 与 robots 两层一致。
- [x] **Bing / 360 全量推送**（708 成功 / 0 失败），sitemap 已提交。

进行中 / 待办：

- [ ] **百度破局**：天花板是资质不是技术。能做的：平台提交 sitemap + API 推送，并把推送顺序改成**详情页优先**（首页它自己天天来，不占配额）。真正破局要等备案 + 大陆节点。
- [ ] **新引擎破零**：搜狗 / 字节 / 华为零到访，各自站长平台提交 sitemap（均无开放 API，一次性动作）。
- [ ] **首页体积与去重**：见第四节。方向是把 noscript 的全量详情页链接收敛为「分类 + `/all/`」，详情页全量链接交给 `/all/` 承担。
- [ ] **`config/site.yaml` 补 `verification`**（五家）：无线上验证码就看不到任何一家的真实收录数据，后面所有 SEO 判断都是猜。**应排在所有 SEO 动作之前**。
- [ ] **IndexNow 主动推送**（Bing / Yandex / Seznam）：比坐等抓取快得多，`deploy/` 已有 `submit-baidu` 的范式可照抄。
- [ ] **其余高重合标签的差异化**：现在只有 macOS 配了 `tagMeta`。新出现高重合又要保留的标签，先写 `tagOverlapAllow` 止住告警，再补 `tagMeta` 文案。
- [ ] **核对 360 的 301 链是否单跳**直达 `https://www.<域名>/`（多跳会稀释权重）。
- [ ] **备案 + 大陆节点**（长期）：百度系唯一破局手段。

---

## 九、结论快照（2026-10-11）

> 数据窗口 10-03 → 10-11，会随时间失效；要用就按第五节重跑一遍。

| 项 | 值 |
|---|---|
| 到访搜索引擎 | Google（Googlebot 938 + GoogleOther 622）、Yandex 710、Applebot 166、百度 27、Bing 16、360 4 |
| 零到访 | 搜狗、字节 Bytespider、华为 PetalBot、DuckDuckGo |
| 实际收录覆盖 | Yandex 遍历 601 资源页（当时 sitemap 702 页的 85%）；Google 197 去重 URL、159 资源页 |
| 真人 | UV 186 人 / 9 天（≈20/天）；来源 Google 281、百度 37 |
| 已封 | 7 家零回流爬虫，合计 7,723 次 / 9 天 |
| 444 效果 | 全站 404 由 890 次/天 降到 3 次；探测响应 457.8 KB/375 次 → 0 字节 |
| 410 效果 | `search-index.json` 子路径重试由 80 次/天 → 2 次/天 |

---

## 十、相关

- 改 URL、加页面前的禁忌：[site-建站与开发.md](site-建站与开发.md)
- 入库与下架：[content-内容生产.md](content-内容生产.md)
- 待办优先级与规划：[record-待办变更与规划.md](record-待办变更与规划.md)
