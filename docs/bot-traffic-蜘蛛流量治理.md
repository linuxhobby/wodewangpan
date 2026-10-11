# 经验：蜘蛛流量分析与 nginx 爬虫治理

> 站点：`www.wodewangpan.top`（静态站，源码在本仓库）
> 服务器：VPS `43.128.54.22`（ssh 别名 `vps43`，root 免密），日志 `/var/log/nginx/access.log` 及 `.N`/`.N.gz` 轮转
> 数据窗口：2026-10-03 → 10-11（9 天，35,762 次请求）
> 适用范围：本文记录的是**方法与踩过的坑**，不是某一次的结论；结论快照见第六节，会随时间失效。

---

## 一、最重要的一条判断准则

**一个爬虫值不值得放行，看它有没有回流真人点击（referer），不要看它抓了多少。**

抓取量大 ≠ 有价值。按这个标准复核本站的 9 天数据，结论和直觉完全相反：

| 来源 | referer 回流 | 抓取量 | 处置 |
|---|---:|---:|---|
| Google | **281** | 938 | 放行，且要主动喂 |
| 百度 | 37 | 27 | 放行 |
| Yandex | 5 | 710 | 放行 |
| Bing | 1 | 16 | 放行 |
| ShapBot / KeenableBot / SkytabBot | **0** | 5,807 | 403 |
| SemrushBot / AhrefsBot / MJ12bot / serpstatbot | **0** | 1,916 | 403 |

全站真人 UV 九天只有 186 人，而这三家 AI 索引器 + 四家 SEO 工具合计 **7,723 次**请求。带宽几乎全花在不会回头客身上。

注意别一刀切：**PerplexityBot / OAI-SearchBot / Claude-SearchBot / Google-Extended 会真的带 AI 摘要与引荐链接**，本站刻意保留放行（ClaudeBot 767 次、GPTBot 620 次也未封）。判断标准是"它是否把流量还给我"，不是"它是不是机器人"。

---

## 二、别从数据中心 IP 跑 `site:` 查询

想知道被哪些引擎收录，第一反应是 `curl "https://www.google.com/search?q=site:域名"`——**这条路是错的**：

- Google / 百度 / Yandex / DuckDuckGo 直接返回空页或验证码页；
- Bing 返回 200 和一大段 HTML，但里面的域名全是**查询词回显**，真实结果指向知乎/百度经验。按 `grep -c 域名` 数会得到"26 条命中"的假阳性。

正确做法是**解析站点自己的访问日志**，按 user-agent 归类。蜘蛛来不来、抓了哪些页、返回什么状态码，日志比任何外部查询都权威。

精确收录量只能去各家站长后台（GSC / Bing Webmaster / 百度站长）看报表。

---

## 三、日志解析的三个坑

### 1. 统计状态码/路径要按引号切字段，且只匹配 `$request_uri`

nginx combined 格式一行里有 4 对引号，`-F'"'` 切完之后：

| 字段 | 内容 |
|---|---|
| `$2` | 请求行 `GET /path HTTP/1.1` |
| `$3` | 空格分隔后：第 1 段 = 状态码，第 2 段 = 字节数 |
| `$4` | referer |
| `$6` | user-agent |

**整行 grep 会误报**。本次真实案例：想统计 `.php` 探测，结果 6865 条里混进一批状态码 200 的"PHP 请求"——实际是 `facebookexternalhit` 的 **UA 里含 `externalhit_uatext.php`**，请求路径是正常资源页。凡是统计探测，必须先切出路径字段再匹配。

### 2. 服务器上是 mawk，三个语法限制

- 不支持 `{3}` 区间正则 → 写 `[0-9][0-9][0-9]` 或干脆别用；
- 正则里出现 `{` 会被当区间起始 → 写成 `[{]`（例如 `/^server [{]$/`）；
- 超长 `a|b|c|...` alternation 报 `runaway regular expression` → 改用 `index(u, "kw")` 逐串判断。

### 3. 判断 444 要看 curl 退出码，且别配 `set -e`

`return 444` 是关连接，`curl -w '%{http_code}'` 拿到 `000`、**退出码 52**。脚本里若开了 `set -e`，第一个断连测试就会把整个脚本打断（后面全不执行），排查半天像"规则没生效"。

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u"); rc=$?
[ $rc -eq 52 ] && echo "断连(444)" || echo "HTTP $code"   # 不要用 set -e
```

---

## 四、真人流量怎么估

浏览器 UA 的数量**严重虚高**，本站 17,911 次"浏览器 UA"请求里，净真人页面请求只有 1,932 次。两个口径分开用：

**下界（可信）——只有真正执行了 JS 的浏览器才有 `vid` cookie 和 `/hit` 信标。**
站点自带埋点（`render.js` 的 `STATS_SCRIPT` 种 `vid` cookie 后 `sendBeacon('/hit')`），据此得 **UV 186 人 / 9 天 ≈ 20 人/天**，与日志里 160 个 IP 触发 837 次 `/hit` 吻合。

**上界（宽口径）——浏览器 UA + 只访问站内真实路由 + 剔除单 IP > 30 次的脚本**：944 IP、1,071 访客。多出来的是"只抓 HTML、不执行 JS"的低频采集，无法与真人彻底区分。

### 识别伪装成浏览器的脚本

四个特征，命中两条以上基本就不是人：

1. **UA 是固定且过时的版本串**——真实用户的 Chrome/Safari 版本是发散的。本次：`Chrome/122.0.0.0` 2,838 次仅 4 个 IP、`Version/26.0.1` Safari 1,825 次仅 5 个 IP。
2. **请求/IP 比值高**——真人一次会话几跳到几十跳，脚本会打到几百。
3. **源 IP 落在云厂商机房段**——本次最大的一个假 iPhone 家族（`iPhone OS 13_2_3`，2020 年的 UA）1,437 次散布在 398 个 IP，全是腾讯云 / 阿里云段。
4. **扫描路径占比高**——同一 UA 大量请求 `wp-admin`、`.env`、`.php`。

---

## 五、nginx 策略：四层各管什么

现生效配置文件（`/etc/nginx/conf.d/`，仓库镜像在 `deploy/`）：

| 层 | 手段 | 针对 | 文件 |
|---|---|---|---|
| 1 | `return 410` | 蜘蛛记忆里的**已死 URL**（`/resource/*/search-index.json`） | `wodewangpan.conf` |
| 2 | `return 444` | 漏洞扫描探测（wp-admin / .env / .git / 任意 .php / phpunit / nacos…） | `00-block-probes.conf` |
| 3 | `return 403` | 零回流的 AI 与 SEO 爬虫名单 | `00-block-ai.conf` |
| 4 | robots.txt | 上述两者的"礼貌层"声明 | 构建产物 |

三条实战要点：

**410 而不是 404。** 410 Gone 让蜘蛛衰减得比 404 快得多。`search-index.json` 子路径改 410 后，实测从 10-09 的 80 次 → 10-10 的 3 次 → 10-11 的 2 次。但**根目录那份 `/search-index.json` 必须留 200**——它是 Googlebot 渲染"加载更多"的通道，一起挡等于自断发现路径。

**`if ... return` 要放 server 块最前面。** 放在裸域与 http→https 的 `if` 之后，探测请求会先白吃一个 301 再被拦（本次实测部署前有 1,371 次探测走的是 301）。顺带一个有用的性质：server-rewrite 阶段**早于** preaccess 阶段，所以 `if ... return` 优先于 `limit_req`——被 403/444 的爬虫根本不会消耗限速桶。

**只挡子路径，别误伤特例。** 444 规则要绕开 `key.txt`（IndexNow）、`baidu_verify_*.html`、`.well-known/acme-challenge/`、根 `search-index.json`。上线路径先跑一遍"必须放行"清单的 curl 回归，再动线上。

---

## 六、限速为什么整段作废（以及怎么才有效）

`00-crawler-limit.conf` 曾用 `map $http_user_agent` 命中后以 **`$binary_remote_addr`（单 IP）** 为 key，`rate=30r/m burst=20`。九天只触发了 **183 次 429**，等于没限速：

| Bot | 加限速前 | 加限速后 |
|---|---:|---:|
| ShapBot | 420/天 | 346/天 |
| KeenableBot | 36/天 | **426/天** |
| MJ12bot | 43/天 | 68/天 |

**根因**：这些 bot 只用了 9~44 个 IP 且爬得慢（ShapBot 平均 38 请求/IP/天，离"30 次/分钟"差一个数量级），单 IP 令牌桶永远填不满。

要限总量，key 必须换成**按 UA 的固定 token**（同一家 bot 的所有 IP 共用一个桶）：

```nginx
map $http_user_agent $crawler_limit_key {
    default   "";
    ~*Google  "google";      # 只给"想保留但可能抽风"的引擎封顶
    ~*Claude  "claude";
}
limit_req_zone $crawler_limit_key zone=crawler_limit:10m rate=6r/m;   # ≈8,600 次/天全局上限
```

本次的处置是：这五家已被 403 硬拦，限速条目全部失效 → **整个文件摘掉**（`mv` 成 `.disabled-时间戳`，不在 `*.conf` glob 内即不载入），而不是把一份"只用来占住变量名"的死配置塞进 git。现在 bot 策略只剩 444 + 403 一条清晰路径。

---

## 七、改动上线的操作规范（踩坑所得）

1. **`robots.txt` 和 `sitemap.xml` 是 `scripts/build.js` 生成的产物**——要改规则必须改 build.js 的模板字符串，手改 `/opt/wodewangpan/public/robots.txt` 会在下一次构建时被整目录换掉。
2. **`site-autoupdate.sh` 只做 `git pull → build → 原子换目录 → nginx -t && reload`**，不会覆盖手工改的 nginx conf；所以线上直改 nginx 是安全的，但**要记得回写 `deploy/` 镜像**，否则重装环境时丢失。
3. **不删服务器上的配置文件，改名停用。** `include /etc/nginx/conf.d/*.conf` 是 glob，改名成 `.disabled-时间戳` 即失效又可回退，比删除安全。
4. **每次改 nginx 三步走**：`cp -a` 备份 → 改 → `nginx -t` 通过才 `reload`（校验失败就把备份 copy 回去）。用 `nginx -T` 确认某文件**是否真的被载入**，别看目录里有就当生效。
5. **两个相互依赖的改动必须在同一次 reload 里做完**：删 map 文件（定义 zone）却留着 `limit_req zone=...`，`nginx -t` 会因 zone 悬空直接失败。
6. **验证要双向**：既测"该拦的拦住了"（403/444），也测"不该动的没动"（Googlebot 桌面+手机、Yandex、百度、Bing、Applebot、GoogleOther、保留的 AI、真人、`robots.txt`/`sitemap.xml`/`stats.json`/`key.txt`/404 页）。只看前者很容易把收录来源一起封掉。
7. **在共享仓库里提交前先 `git status`**：这个项目常常同时在改 `data/*.yaml`、`scripts/`。只 `git add` 自己那一个文件，别把别人的在途改动打包进自己的提交。

---

## 八、2026-10-11 结论快照

| 项 | 值 |
|---|---|
| 到访搜索引擎 | Google（Googlebot 938 + GoogleOther 622）、Yandex 710、Applebot 166、百度 27、Bing 16、360 4 |
| 零到访 | 搜狗、字节 Bytespider、华为 PetalBot、DuckDuckGo |
| 实际收录覆盖 | Yandex 遍历 601 资源页（当时 sitemap 702 页的 85%）；Google 197 去重 URL、159 资源页。站点增长很快，10-11 已扩到 753 页（706 资源 + 33 标签页 + `/tags/` 总览等），所以本表数据要用就按第三节重跑一遍 |
| 真人 | UV 186 人 / 9 天（≈20/天）；来源 Google 281、百度 37 |
| 已封 | 7 家零回流爬虫，合计 7,723 次 / 9 天 |
| 444 效果 | 全站 404 由 890 次/天 降到 3 次；探测响应由 457.8 KB/375 次 → 0 字节 |
| 410 效果 | `search-index.json` 子路径重试由 80 次/天 → 2 次/天 |

**已闭环**：`scripts/build.js` 里新增的 robots `Disallow` 组（ShapBot / KeenableBot / SkytabBot / SemrushBot / AhrefsBot / MJ12bot / SerpstatBot）已随 build.js 的其他改动一起提交并构建上线，线上 `robots.txt` 已输出这一组的 `Disallow: /`。至此 **nginx 403 与 robots 声明两层一致**。

唯一遗留：`/etc/nginx/conf.d/00-crawler-limit.conf` 已改名停用，但**没有对应的仓库镜像**（因为它是空转配置，见第六节）。若日后按第六节的 per-UA 方案重建限速，记得同时放进 `deploy/` 并在 `deploy/nginx-site.conf.example` 里补上 `limit_req` 那行。

## 九、相关

- 收录现状与优化清单：[seo-收录与优化.md](seo-收录与优化.md)
- 待办与优先级：[todo-待办清单.md](todo-待办清单.md)
