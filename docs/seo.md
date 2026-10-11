# SEO 结论与待办

各引擎收录现状、优化建议与待办清单。
适用：本站（`www.wodewangpan.top`）的收录推进与抓取预算分配。
最近更新：2026-10-10（数据窗口 10-03 → 10-10；sitemap 现有 702 页）。

依据站点 Nginx 日志中各引擎蜘蛛的实际抓取记录复查。

---

## 收录现状

> 待补：以 Google Search Console / Bing Webmaster Tools / 百度站长平台后台报表为准。
> 脚本化 `site:` 查询受数据中心 IP 反爬干扰，不作为计数依据。

## 优化建议（按性价比排序）

- [x] **清理 `search-index.json` 残留 URL（已完成，结论有修正）**：线上实测根路径 `/search-index.json` 是 **200**，404 全在 `/resource/<id>/search-index.json`、`/category/<slug>/search-index.json` 这类**子路径**上——app.js 早期用相对路径取索引留下的历史残留（10-09 已改根绝对路径），蜘蛛按记忆重试，每多抓一个资源页就多一条，所以逐日递增。
  因此**不能连根路径一起挡**：它是 Googlebot 渲染「加载更多」的通道，挡了自断一条发现路径。只清理子路径：`robots.txt` 加 `Disallow: /*/search-index.json`，Nginx 对 `^/.+/search-index\.json$` 返回 **410**（比 404 衰退更快，且不依赖引擎是否支持通配）。
  > 附带发现：Nginx 静态资源 location 带 `access_log off`，成功的 json 请求**不进日志**，只有 404 经 `error_page` 落到 `location /` 才被记录。日志里「全是 404」有一半是采样偏差，别拿它当抓取量。
- [x] **内部接口屏蔽（已完成）**：`Disallow: /stats.json`、`Disallow: /hit` 已加入并复查确认。
- [ ] **百度破局**：站长平台已验证通过，但百度蜘蛛一个内容页都没抓。**天花板是资质不是技术**：`config/site.yaml` 的 `icp` 为空、节点在香港无备案，百度对未备案境外站点的抓取配额极低。能做的仍是：平台提交 sitemap + 「普通收录 → API 推送」（已有 `submit-baidu`）；把推送顺序改成**详情页优先**（首页它自己天天来，不占配额）；真正破局要等备案 + 大陆节点，列为长期项。
- [ ] **纠正 Google 抓取偏科**：首页被抓 583 次（约七成配额），资源页仅覆盖 159/702。复核结论——**不要冻结首页 `<lastmod>`**：首页按分类各取最新几条（`site.yaml` 的 `homePerCategory`），任何一个分类新增都会改变首页，lastmod 是真实信号，人为冻结会让 Google 判定其不可信。且 Google **官方忽略 `<priority>` / `<changefreq>`**，调这两个没用。真正的浪费在别处，见下面「下一步（待实施）」。
- [x] **Bing / 360 起步**：`ALL=1 submit-indexnow` 已跑一次全量，708 条 URL 成功 708、失败 0（`keyLocation` = `https://www.wodewangpan.top/key.txt`，与线上密钥一致）。日志显示 10-03 起每日增量推送一直成功，所以 Bing 抓得少不是推送链路的问题；Bing Webmaster Tools 的 sitemap 也已于 10-10 提交，等 1~2 周看后台 Crawl stats 是否起量。360 那边核对 301 链是否**单跳**直达 `https://www.<域名>/`。
- [ ] **新引擎破零**：搜狗 / 字节 / 华为零到访，只能在各自站长平台提交 sitemap 引蜘蛛（均无开放 API，一次性动作）。

## 下一步（待实施，按预期收益排序）

1. [x] **构建改「内容未变不覆盖」，让详情页能回 304**（已完成）：原先每小时全量重建，700 多个详情页的 mtime / ETag 每次都被刷新，蜘蛛的 `If-Modified-Since` / `If-None-Match` 永远不命中，每次都是完整 200（日志里 Google 200×810、几乎没有 304，正合这个特征）。现在 `write()` 写盘前先比对上一版产物（`BUILD_DIR=public.new` 时对照 `public/`），内容相同就沿用旧文件并 `utimes` 保留原 mtime。实测二次构建：722 个文件全部沿用、0 个重写，构建 58.7s → 34.9s；`public.new` 里的详情页 mtime 与 `public/` 完全一致。
   首页 `<lastmod>` 因此**不需要人为冻结**：它取的是资源 `added`，新增资源确实会改变首页首屏，信号是真实的；而内容没变的页面 mtime 不再抖动，蜘蛛的重复访问从 200 变 304，预算自然腾给新页。
2. [x] **重建频率定为每 2 小时**（已完成）：crontab 现在是 `0 */2 * * *`。原来那句「每小时构建一次」是误读——脚本先比对 HEAD，没新提交就 `exit 0`，实际构建次数等于提交次数。所以频率只决定「提交后多久上线」（≤2 小时），不影响抓取；空跑成本只有一次 `git fetch`，可以放心调密。要立刻上线仍走 `FORCE=1 site-autoupdate`。
3. **首页体积与去重**：首页改成分区后 102KB（gzip 26KB，大头是 noscript 里那 663 条详情页链接，不是卡片）。`/all/` 已 132KB / 702 条链接，是蜘蛛「一次抓完全站」的主通道，保持它进 sitemap 且不要被 robots 误伤。
4. **资质**：备案 + 大陆节点是百度系唯一的破局手段，其余都是配额内的优化。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `scripts/build.js` | 生成 `robots.txt` / `sitemap.xml`，含 SEO 自检（薄内容告警在这里） |
| `deploy/nginx-site.conf.example` | 410 规则、静态资源缓存、`access_log` 配置 |
| `deploy/` 下的 `submit-*` | 各引擎 sitemap / API 推送脚本 |
