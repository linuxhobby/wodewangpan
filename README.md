# wodewangpan · 网盘资源分享站

一个纯纯的静态网站！**无数据库、无后端、无登录。**

用 YAML 写资源，构建成**纯静态站点**：海报压缩、二维码、搜索索引、SEO 标签全部在构建期生成，产物丢给 Nginx 就能跑。

| | |
|---|---|
| 网站 | https://www.wodewangpan.top |
| 仓库 | `git@github.com:linuxhobby/wodewangpan.git` |
| 更新方式 | 推到 `main`，VPS 定时自动拉取并重建（急发用 `FORCE=1 site-autoupdate`） |

## 网站特性

- **数据即内容**：一个纯静态网站！一个分类一个 YAML，改完构建就出整站
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

资源数据直接改 `data/<分类>.yaml`（字段照 `data/movie.yaml` 里的条目抄即可），或先跑通流程后再替换。

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
  course.yaml        # 课程
  misc.yaml          # 其他
config/              # 站点配置，与资源数据分开存放
  site.yaml          # 站名、分类顺序、首页每类条数与排序方式、免责声明、页脚联系方式、分类页首屏条数
  tags.yaml          # 标签聚合页：建页阈值、排除名单、近重复阈值、标签 URL 别名（没配别名的自动用拼音）
static/
  favicon.svg        # 站点图标唯一源文件（换 logo 就改它）；构建时拷到根目录并生成 favicon.ico / apple-touch-icon.png
  share.jpg          # 首页品牌分享卡（1200×630），构建时拷到站点根目录供 og:image 用
  images/            # 配图，文件名与资源 id 对应：<id>.jpg / .png / .webp / .svg；全部平铺在一个目录，不按分类分桶）
theme/assets/        # 前端样式与脚本，构建时拷到 public/assets/
scripts/             # 构建 / 预览脚本（lib/ 是构建核心：读数据、出图片、渲染页面）
tools/
  sitestats.py           # 访问统计脚本（VPS 方案用到）
  share-poster.mjs       # 生成首页品牌分享卡 static/share.jpg（改站点配置后重跑）
  fill-desc.mjs          # 把 .tmp/desc-draft.json 里的简介写回 YAML（自动接回【季/集】前缀与 ｜TMDB 后缀，--strict 拦不合格稿）
  list-short-desc.mjs    # 列出正文不足指定字数的条目（npm run list:short）
  icon-poster.mjs        # 把应用图标合成 2:3 竖版海报（软件 / 音频等非影视资源）
  book-cover-douban.mjs  # 从豆瓣图书抓书籍封面（电子书 bk- 优先用它，见 docs/content-内容生产.md）
  book-poster.mjs        # 豆瓣查无此书时，生成书封海报兜底
  set-poster.mjs         # 套装 / 合辑专用深色封面（豆瓣没有对应单册封面时用，见 docs/content-内容生产.md）
docs/                # 经验类文档（4 篇 + 索引），按干活的场景划分，见 docs/README.md
  content-内容生产.md   # 入库八步、编号、失效修复、简介文案、配图、skill
  site-建站与开发.md     # URL 禁忌、样式约定、构建部署、环境速查
  SEO-收录与流量.md   # 问题清单与本期变化、抓取预算、日志解析、nginx 爬虫治理
  record-待办变更与规划.md  # 待办 / 规划 / 变更记录
  README.md           # 索引与文档规范
deploy/              # 部署用：Nginx 配置示例、自动更新脚本、统计日志格式、搜索引擎提交脚本
public/              # 构建产物，部署这个目录（本目录不入库）
```

## 文档

`docs/` 只有 4 篇 + 索引，按「干活时在干什么」划分。索引与命名规范见 [`docs/README.md`](docs/README.md)。

| 文档 | 内容 |
|---|---|
| [`docs/content-内容生产.md`](docs/content-内容生产.md) | 入库 SOP、编号与 id、失效修复与下架、简介文案红线、配图图源与兜底工具、skill 用法与维护 |
| [`docs/site-建站与开发.md`](docs/site-建站与开发.md) | 改代码前必读：URL 与收录禁忌、样式与卡片约定、config / data、构建产物、部署与 Nginx、环境速查 |
| [`docs/SEO-收录与流量.md`](docs/SEO-收录与流量.md) | 未闭环问题清单（P1–P7）与本期变化、放行判断准则、抓取预算结论、日志解析三个坑、真人流量估算、nginx 四层策略与上线规范 |
| [`docs/record-待办变更与规划.md`](docs/record-待办变更与规划.md) | 待办与已闭环、待评审的功能 / 内容规划、变更记录 |

完整索引与文档规范见 [`docs/README.md`](docs/README.md)。



