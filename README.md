# wodewangpan · 网盘资源分享站

用 YAML 写资源，构建成**纯静态站点**：海报压缩、二维码、搜索索引、SEO 标签全部在构建期生成，产物丢给 Nginx 就能跑。无数据库、无后端、无登录。

| | |
|---|---|
| 网站 | https://www.wodewangpan.top |
| 仓库 | `git@github.com:linuxhobby/wodewangpan.git` |
| 更新方式 | 推到 `main`，VPS 每 2 小时自动拉取并重建（急发用 `FORCE=1 site-autoupdate`） |

## 网站特性

- **数据即内容**：一个分类一个 YAML，改完构建就出整站
- **构建期出图**：配图自动压成海报与缩略图两档，缺图时有分类占位海报兜底
- **二维码预生成**：静态 SVG，扫码转存不依赖 JS
- **纯前端搜索**：支持拼音与首字母，命中高亮，搜索结果可分享链接
- **SEO 全自带**：canonical、OG / Twitter Card、JSON-LD、sitemap、robots、404 兜底
- **内链自足**：全量索引页 `/all/` + 详情页「相关推荐」，不执行 JS 也能从任一页走到全部资源
- **首页按分类分区**：每个分类在首页都有固定席位，给最新的几条 + 分类页入口，小分类不会被大分类挤下去
- **响应式宫格**：窄屏自动减列，首页每类的条数也跟着减（5 → 4 → 3 → 2），不留半行零头
- **首屏即读**：列表页首屏内容内联进 HTML，禁用 JS 也能正常浏览
- **访问统计自备**：解析 Nginx 日志得到访问数据，不依赖第三方统计

## 网站部署

产物是纯静态文件，任何能托管静态文件的地方都能跑。挑一种照着做即可：

| 方式 | 适合 | 说明 |
|---|---|---|
| **A · VPS + Nginx**（推荐，本站线上方案） | 有域名、有VPS主机 | 完全可控，SEO 与访问速度最好 |
| B · GitHub Pages | 免费、不想管服务器 | 国内访问不稳定 |
| C · Cloudflare Pages | 免费、海外快 | 同上，国内偶发不通 |

前置：Node ≥ 18（VPS 方案另需 Nginx、Git，Python 3 只在用访问统计时需要）。

### 方案 A：VPS + Nginx

站点目录 `/opt/wodewangpan`；下面命令走 `apt`，Debian / Ubuntu 都能照抄。

**1）装环境**

```bash
sudo apt update && sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
node -v   # 需 ≥ 18
```

**2）取代码、装依赖**

```bash
sudo git clone https://github.com/linuxhobby/wodewangpan.git /opt/wodewangpan
cd /opt/wodewangpan && sudo npm ci
```

> `sharp` 可选（`npm i sharp`）：负责压缩与裁切，没装就按原图复制，产物体积会大很多。

**3）改成你自己的站点**

编辑 `config/site.yaml`：`title` / `description` 站名站描述、`categories` 分类栏、`contact` 页脚联系方式、`icp` 备案号；`static/favicon.svg` 换成你的图标。

改完站点配置后，顺手重跑一次 `node tools/share-poster.mjs`，它会按新的站名与分类重新生成首页品牌分享卡 `static/share.jpg`（不重跑则沿用旧图）。

资源数据直接改 `data/<分类>.yaml`（格式见 [数据格式](#数据格式)），或先跑通流程后再替换。

**4）构建**

```bash
BASE_URL=https://你的域名 npm run build     # 必填，否则 canonical / OG / sitemap 会指向 example.com
```

产物在 `public/`。

**5）配置 Nginx**

```bash
sudo install -m644 deploy/nginx-site.conf.example /etc/nginx/conf.d/wodewangpan.conf
sudo sed -i 's/your-domain.com/你的域名/g' /etc/nginx/conf.d/wodewangpan.conf
sudo nginx -t && sudo systemctl reload nginx
```

Nginx 关键三处（示例文件里都有，不用手改）：

| 配置 | 作用 |
|---|---|
| `root /opt/wodewangpan/public` | 指向 `public/` 目录本身 |
| `try_files $uri $uri/ $uri/index.html =404` | 让 `/resource/mv-010/` 命中目录下的 `index.html` |
| `error_page 404 /404.html` | 走站内 404 页 |

**6）HTTPS**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx --redirect -d 你的域名 -d www.你的域名
```

`-d` 写两个名字，证书同时覆盖裸域与 www；`--redirect` 让 certbot 自动把 80 端口改成 301 跳 https（并保留 acme 校验路径），省得手工改。签完再按 `deploy/nginx-site.conf.example` 里的第 2 段把裸域 https 也 301 到 www——全站只留 `https://www.<域名>/` 一个 200，搜索引擎才不会把 http / https、裸域 / www 各收一份。

**7）验证**

打开 `https://你的域名`，再跑一遍 [上线自检](#上线自检)。

**8）自动更新（可选，强烈建议）**

推到 `main` 后服务器自动拉取、重建、reload nginx：

```bash
sudo install -m755 deploy/site-autoupdate.sh /usr/local/bin/site-autoupdate

# 站点专属的两个值放 /etc/site-autoupdate.conf，与脚本本身分开，
# 以后脚本升级只要重新 install 一次，配置不会丢
sudo tee /etc/site-autoupdate.conf >/dev/null <<'EOF'
SITE_DIR=/opt/wodewangpan
BASE_URL=https://你的域名
EOF

sudo crontab -e
# 加入一行（每 2 小时拉一次）
# 频率可以放心调密：脚本先比对 HEAD，没有新提交就直接退出，空跑只有一次 git fetch；
# 真有提交时才构建，而构建现在只重写字节变了的页面，未变的保留原 mtime，不会白费蜘蛛的抓取预算
0 */2 * * * /usr/local/bin/site-autoupdate >> /var/log/site-autoupdate.log 2>&1
```

看运行结果：`tail -20 /var/log/site-autoupdate.log`。

**想立刻发布、不等 cron**：服务器上执行 `FORCE=1 site-autoupdate`（cron 模式下本地 HEAD 与远端一致时会直接跳过，FORCE 用来强制重跑一次）。

**回滚**：服务器上 `git reset --hard <上一个 commit>` 再 `FORCE=1 site-autoupdate`，或本机 `git revert` 后推上去。

发布过程是原子的：先构建到临时的 `public.new`，全部就绪后才用两次 `mv` 换成 `public`，nginx 始终读到一个完整版本的产物，不会出现「新 HTML 配旧 CSS」这种中间态。

**9）访问统计（可选）**

```bash
sudo install -m755 tools/sitestats.py /usr/local/bin/sitestats.py
sudo install -m644 deploy/00-sitestats.conf /etc/nginx/conf.d/00-sitestats.conf
sudo mkdir -p /var/lib/sitestats
sudo crontab -e
# 加入一行：
*/5 * * * * /usr/local/bin/sitestats.py >> /var/log/sitestats.log 2>&1
```

`config/site.yaml` 里保持 `stats: local` 即可；不想统计就删掉这段（页脚数字留空）。已签发证书后 Nginx 配置里的 `access_log ... sitestats;` 才会生效，reload 一次：`sudo nginx -t && sudo systemctl reload nginx`。

### 方案 B：GitHub Pages

仓库 Settings → Pages → Source 选 **GitHub Actions**，新建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: BASE_URL=https://<用户名>.github.io/<仓库名> npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 方案 C：Cloudflare Pages

| 项 | 值 |
|---|---|
| Framework preset | None |
| Build command | `BASE_URL=https://<项目名>.pages.dev npm run build` |
| Build output directory | `public` |
| 环境变量 | `NODE_VERSION` = `20` |

### 上线自检

```bash
S=https://你的域名
for u in / /category/movie/ /all/ /resource/mv-010/ /sitemap.xml \
         /robots.txt /search-index.json /img/mv-010-240.webp /qr/mv-010-quark.svg \
         /nope; do
  printf '%-38s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$S$u")"
done
curl -s $S/ | grep canonical       # 应是你的真实域名
```

除 `/nope` 应为 **404**，其余全部 **200**。中文分类页用 curl 要 percent-encoding，浏览器直接访问正常。



## 目录结构

```
data/                # 一个分类一个 YAML（英文文件名），构建时自动合并
  movie.yaml         # 电影
  tv.yaml            # 电视剧
  documentary.yaml   # 纪录片
  anime.yaml         # 动漫
  game.yaml          # 游戏
  software.yaml      # 软件
  os.yaml            # 操作系统
  ebook.yaml         # 电子书
  misc.yaml          # 其他
config/              # 站点配置，与资源数据分开存放
  site.yaml          # 站名、分类顺序、首页每类条数与排序方式、免责声明、页脚联系方式、分类页首屏条数
  tags.yaml          # 标签聚合页：建页阈值、排除名单、近重复阈值、标签 URL 别名（没配别名的自动用拼音）
static/
  favicon.svg        # 站点图标唯一源文件（换 logo 就改它）；构建时拷到根目录并生成 favicon.ico / apple-touch-icon.png
  share.jpg          # 首页品牌分享卡（1200×630），构建时拷到站点根目录供 og:image 用
  images/            # 配图，文件名与资源 id 对应：<id>.jpg / .png / .webp / .svg；全部平铺在一个目录，不按分类分桶（结论见「经验总结」）
theme/assets/        # 前端样式与脚本，构建时拷到 public/assets/
scripts/             # 构建 / 预览脚本（lib/ 是构建核心：读数据、出图片、渲染页面）
tools/
  sitestats.py           # 访问统计脚本（VPS 方案用到）
  share-poster.mjs       # 生成首页品牌分享卡 static/share.jpg（改站点配置后重跑）
  fill-desc.mjs          # 把 .tmp/desc-draft.json 里的简介写回 YAML（自动接回【季/集】前缀与 ｜TMDB 后缀，--strict 拦不合格稿）
  list-short-desc.mjs    # 列出正文不足指定字数的条目（npm run list:short，默认 120 字）
  icon-poster.mjs        # 把应用图标合成 2:3 竖版海报（软件 / 音频等非影视资源）
  book-cover-douban.mjs  # 从豆瓣图书抓书籍封面（电子书 bk- 优先用它，见「经验总结」）
  book-poster.mjs        # 豆瓣查无此书时，生成书封海报兜底
  set-poster.mjs         # 套装 / 合辑专用深色封面（豆瓣没有对应单册封面时用，见「经验总结」）
deploy/              # 部署用：Nginx 配置示例、自动更新脚本、统计日志格式、搜索引擎提交脚本
public/              # 构建产物，部署这个目录（586 条时约 17MB，不入库）
```

## 配图规范

## SKILL 变更

## SEO建议优化

依据站点 Nginx 日志中各引擎蜘蛛的实际抓取记录复查（2026-10-10，数据窗口 10-03 → 10-10；sitemap 现有 702 页）。

### 收录现状



### 优化建议（按性价比排序）

- [x] **清理 `search-index.json` 残留 URL（已完成，结论有修正）**：线上实测根路径 `/search-index.json` 是 **200**，404 全在 `/resource/<id>/search-index.json`、`/category/<slug>/search-index.json` 这类**子路径**上——app.js 早期用相对路径取索引留下的历史残留（10-09 已改根绝对路径），蜘蛛按记忆重试，每多抓一个资源页就多一条，所以逐日递增。
  因此**不能连根路径一起挡**：它是 Googlebot 渲染「加载更多」的通道，挡了自断一条发现路径。只清理子路径：`robots.txt` 加 `Disallow: /*/search-index.json`，Nginx 对 `^/.+/search-index\.json$` 返回 **410**（比 404 衰退更快，且不依赖引擎是否支持通配）。
  > 附带发现：Nginx 静态资源 location 带 `access_log off`，成功的 json 请求**不进日志**，只有 404 经 `error_page` 落到 `location /` 才被记录。日志里「全是 404」有一半是采样偏差，别拿它当抓取量。
- [x] **内部接口屏蔽（已完成）**：`Disallow: /stats.json`、`Disallow: /hit` 已加入并复查确认。
- [ ] **百度破局**：站长平台已验证通过，但百度蜘蛛一个内容页都没抓。**天花板是资质不是技术**：`config/site.yaml` 的 `icp` 为空、节点在香港无备案，百度对未备案境外站点的抓取配额极低。能做的仍是：平台提交 sitemap + 「普通收录 → API 推送」（已有 `submit-baidu`）；把推送顺序改成**详情页优先**（首页它自己天天来，不占配额）；真正破局要等备案 + 大陆节点，列为长期项。
- [ ] **纠正 Google 抓取偏科**：首页被抓 583 次（约七成配额），资源页仅覆盖 159/702。复核结论——**不要冻结首页 `<lastmod>`**：首页按分类各取最新几条（`site.yaml` 的 `homePerCategory`），任何一个分类新增都会改变首页，lastmod 是真实信号，人为冻结会让 Google 判定其不可信。且 Google **官方忽略 `<priority>` / `<changefreq>`**，调这两个没用。真正的浪费在别处，见下面「下一步（待实施）」。
- [x] **Bing / 360 起步**：`ALL=1 submit-indexnow` 已跑一次全量，708 条 URL 成功 708、失败 0（`keyLocation` = `https://www.wodewangpan.top/key.txt`，与线上密钥一致）。日志显示 10-03 起每日增量推送一直成功，所以 Bing 抓得少不是推送链路的问题；Bing Webmaster Tools 的 sitemap 也已于 10-10 提交，等 1~2 周看后台 Crawl stats 是否起量。360 那边核对 301 链是否**单跳**直达 `https://www.<域名>/`。
- [ ] **新引擎破零**：搜狗 / 字节 / 华为零到访，只能在各自站长平台提交 sitemap 引蜘蛛（均无开放 API，一次性动作）。

### 下一步（待实施，按预期收益排序）

1. [x] **构建改「内容未变不覆盖」，让详情页能回 304**（已完成）：原先每小时全量重建，700 多个详情页的 mtime / ETag 每次都被刷新，蜘蛛的 `If-Modified-Since` / `If-None-Match` 永远不命中，每次都是完整 200（日志里 Google 200×810、几乎没有 304，正合这个特征）。现在 `write()` 写盘前先比对上一版产物（`BUILD_DIR=public.new` 时对照 `public/`），内容相同就沿用旧文件并 `utimes` 保留原 mtime。实测二次构建：722 个文件全部沿用、0 个重写，构建 58.7s → 34.9s；`public.new` 里的详情页 mtime 与 `public/` 完全一致。
   首页 `<lastmod>` 因此**不需要人为冻结**：它取的是资源 `added`，新增资源确实会改变首页首屏，信号是真实的；而内容没变的页面 mtime 不再抖动，蜘蛛的重复访问从 200 变 304，预算自然腾给新页。
2. [x] **重建频率定为每 2 小时**（已完成）：crontab 现在是 `0 */2 * * *`。原来那句「每小时构建一次」是误读——脚本先比对 HEAD，没新提交就 `exit 0`，实际构建次数等于提交次数。所以频率只决定「提交后多久上线」（≤2 小时），不影响抓取；空跑成本只有一次 `git fetch`，可以放心调密。要立刻上线仍走 `FORCE=1 site-autoupdate`。
3. **首页体积与去重**：首页改成分区后 102KB（gzip 26KB，大头是 noscript 里那 663 条详情页链接，不是卡片）。`/all/` 已 132KB / 702 条链接，是蜘蛛「一次抓完全站」的主通道，保持它进 sitemap 且不要被 robots 误伤。
4. **资质**：备案 + 大陆节点是百度系唯一的破局手段，其余都是配额内的优化。

（权威收录量以 Google Search Console、Bing Webmaster Tools、百度站长平台后台报表为准；脚本化 `site:` 查询受数据中心 IP 反爬干扰，不作为计数依据。）

## 最新修改

网站代码最新修改内容写在这里。

### 2026-10-10 · 构建改为「内容未变不覆盖」，让蜘蛛能命中 304

每小时全量重建会把 700 多个详情页的 mtime / ETag 一起刷新，蜘蛛带 `If-Modified-Since` 来也永远不命中，每次都是完整 200——抓取预算大半耗在重复下载上（Google 日志 200×810、几乎没有 304）。现在内容没变就沿用旧文件并保留原 mtime：

| 改动 | 文件 | 说明 |
|---|---|---|
| `write()` 先比对再写盘 | `scripts/build.js` | 依次比对 outDir 同路径与上一版产物（`BUILD_DIR=public.new` 时对照 `public/`，可用 `PREV_DIR` 改）；相同则跳过，或 `copyFile + utimes` 沿用原 mtime。只处理文本产物，图片仍每次生成（走 30 天缓存，不占抓取预算） |
| 静态资源版本号改内容哈希 | `scripts/build.js` | 原先 `?v=<commit>`：每个 commit 都改一遍所有页面的 CSS/JS 链接 → 700 多页内容全变 → mtime 全量刷新，304 照样落空。改成 theme/assets 下 css/js 的内容哈希，纯数据提交不再动任何页面 |
| 构建汇总加一行 | `scripts/build.js` | 输出「未变化文件沿用 N 个（从 public/ 沿用 M 个）；重新生成 K 个」 |
| 重建频率定为 2h | `README.md`、`deploy/site-autoupdate.sh` | 脚本无新提交时直接跳过，频率只决定上线延迟（≤2h）；急发走 `FORCE=1 site-autoupdate` |

验证：连续两次构建，722 个文件全部沿用、0 个重写（58.7s → 34.9s）；`public.new/resource/mv-010/index.html` 的 mtime 与 `public/` 中的完全一致。

### 2026-10-10 · 只清理 search-index.json 的子路径残留（不挡根路径）

蜘蛛日志里对该文件的 54 次请求全是 404，原建议是整条路径屏蔽。线上实测后修正：根路径是 200，404 全在带目录前缀的子路径上（`app.js` 早期相对路径的历史残留，10-09 已改根绝对路径，但蜘蛛仍按记忆重试）。根路径是 Googlebot 渲染「加载更多」的通道，挡掉等于自断发现路径，所以只清子路径：

| 改动 | 文件 | 说明 |
|---|---|---|
| `Disallow: /*/search-index.json` | `scripts/build.js` | 只匹配带目录前缀的索引文件，根目录那份照常允许 |
| 410 规则 | `deploy/nginx-site.conf.example` | `location ~ ^/.+/search-index\.json$ { return 410; }`，410 比 404 衰退快，且不依赖引擎是否支持通配；必须排在静态资源 location 之前（nginx 正则 location 取第一个命中） |

### 2026-10-09 · 相关推荐排版对齐（每行必须排满）

详情页「相关推荐」原来固定取 6 条，而宫格桌面端一行 5 列，第 6 张必然单独掉到第二行。现在统一按整行出牌：

| 改动 | 文件 | 说明 |
|---|---|---|
| 推荐数 6 → 10 | `scripts/lib/render.js` | `relatedOf()` 默认取 10 条（同分类优先、标签重合多的靠前，不够时跨分类同标签补齐），桌面端 5 列 × 2 行正好排满 |
| 末行零头自动裁掉 | `theme/assets/style.css` | 新增 `.grid--fit`：`nth-child(cols·n+1):nth-last-child(-n+cols-1)` 定位残缺末行的第一张卡，连同后面的兄弟一起 `display:none`。四个断点（5/4/3/2 列）各一组互斥规则，窄屏减列后同样是整行；卡片不足一行时不加这个类，避免藏过头把区块藏没 |

产物验证：668 个资源重新构建通过，660 个详情页恰好输出 10 条；`npm run audit:css` 三项全绿。


