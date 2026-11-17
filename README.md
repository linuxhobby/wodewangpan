# wodewangpan · 网盘资源分享站
用 YAML 写资源，构建成**纯静态站点**：海报压缩、二维码、搜索索引、SEO 标签全部在构建期生成，产物丢给 Nginx 就能跑。

- **加入 Telegram 群**： [https://t.me/wodewangpantop](https://t.me/wodewangpantop) ，群里有查询机器人

- **加入 Telegram 订阅号**：[https://t.me/myquark](https://t.me/myquark) ，更新站内最新资源
一个纯纯的静态网站！**无数据库、无后端、无登录。**


| | |
|---|---|
| 网站 | https://www.wodewangpan.top [衡天云VPS](https://www.htstack.com/activity/act_openyear.shtml?aff=31743) | 
| 仓库 | `git@github.com:linuxhobby/wodewangpan.git` |
| 更新方式 | 推到 `main`，VPS 定时自动拉取并重建（急发用 `FORCE=1 wdwp-autoupdate`） |




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
| **A · [VPS + Nginx](https://www.htstack.com/activity/act_openyear.shtml?aff=31743)**（推荐，本站线上方案） | 有域名、有VPS主机 | 完全可控，SEO 与访问速度最好 |
| B · GitHub Pages | 免费、不想管服务器 | 国内访问不稳定 |
| C · Cloudflare Pages | 免费、海外快 | 同上，国内偶发不通 |

> 本站线上跑的是**方案 A**，服务器用的[衡天云](https://www.htstack.com/activity/act_openyear.shtml?aff=31743)的香港 VPS。同样一台「2核2G」的 VPS，阿里云、腾讯云的国际线路价格要翻好几倍，而衡天云 12 元/月起，走的是针对国内优化的专线，海外机房的延迟和丢包表现比大厂同价位款好不少——本站在国内打开的速度就是最直观的例子。这种纯静态站没有数据库、内存占用低，最便宜的款也扛得住，与其给大厂交品牌溢价，不如把钱省下来。

前置：Node ≥ 18（VPS 方案另需 Nginx、Git，Python 3 只在用访问统计时需要）。

### 方案 A：[VPS + Nginx](https://www.htstack.com/activity/act_openyear.shtml?aff=31743)

#### 一键部署（推荐）

一台干净的 Debian / Ubuntu VPS、root 权限，域名 A 记录指向本机即可：

```bash
curl -fsSL -o /tmp/wdwp-setup.sh https://raw.githubusercontent.com/linuxhobby/wodewangpan/main/deploy/setup-vps.sh
sudo bash /tmp/wdwp-setup.sh --domain example.com --email me@example.com
```

**配置域名**：脚本只写 `config/site.yaml` 的 `baseUrl`，Nginx、证书、构建、自动发布与统计都随 `--domain` 配好；DNS 未生效时先停在可用的 HTTP，之后重跑即可补上证书。

常用参数：`--email`、`--repo` / `--branch` / `--dir`、`--skip-https`、`--no-stats`、`--autoupdate`；全部参数看 `--help`。

脚本可重复执行，参数记在 `/etc/wodewangpan-setup.env`。启用定时发布时需把 `config/site.yaml` 提交到该仓库，否则 `git reset --hard` 会覆盖 `baseUrl`。

> 脚本全文见仓库 [`deploy/setup-vps.sh`](deploy/setup-vps.sh)；README 不再内嵌副本（避免两处漂移）。不 clone 仓库时直接用上面的 `curl` 命令下载即可。


<details>
<summary>展开：手工分步（与一键脚本等价，排错时看）</summary>

下面 1~9 步与一键脚本等价。站点目录默认 `/opt/wodewangpan`；命令走 `apt`，Debian / Ubuntu 都能照抄。

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

**3）站点配置（保持原值即可）**

只想换个域名就跳过本步，直接做 4）的 `BASE_URL` 与 5）的 `server_name`；一键脚本同样只写 `config/site.yaml` 的 `baseUrl`。

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

示例配置已含 `root`、`try_files`、`error_page`，不用手改。

**6）HTTPS**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx --redirect -d 你的域名 -d www.你的域名
```

`-d` 写两个名字覆盖裸域与 www；`--redirect` 自动把 80 端口 301 到 https。签完按 `deploy/nginx-site.conf.example` 第 2 段把裸域 https 也 301 到 www，全站只留一个 200。

**7）验证**

打开 `https://你的域名`，再跑一遍 [上线自检](#上线自检)。

**8）自动更新（可选，强烈建议）**

推到 `main` 后服务器自动拉取、重建、reload nginx：

```bash
sudo install -m755 deploy/wdwp-autoupdate.sh /usr/local/bin/wdwp-autoupdate
sudo tee /etc/wdwp-autoupdate.conf >/dev/null <<'EOF'
SITE_DIR=/opt/wodewangpan
BASE_URL=https://你的域名
EOF
sudo crontab -e
# 加入一行：
30 */2 * * * /usr/local/bin/wdwp-autoupdate >> /var/log/wdwp-autoupdate.log 2>&1
```

看运行结果：`tail -20 /var/log/wdwp-autoupdate.log`。

急发用 `FORCE=1 wdwp-autoupdate`；回滚用 `git reset --hard <上一个 commit>` 再 `FORCE=1 wdwp-autoupdate`。发布先构建到 `public.new` 再整体替换，nginx 不会读到半成品。

**9）访问统计（可选）**

```bash
sudo install -m755 scripts/sitestats.py /usr/local/bin/sitestats.py
sudo install -m644 deploy/00-sitestats.conf /etc/nginx/conf.d/00-sitestats.conf
sudo mkdir -p /var/lib/sitestats
sudo crontab -e
# 加入一行：
*/5 * * * * /usr/local/bin/sitestats.py >> /var/log/sitestats.log 2>&1
```

`config/site.yaml` 保持 `stats: local`；不想统计就跳过本步（页脚数字留空）。改完 `sudo nginx -t && sudo systemctl reload nginx`。

</details>

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
for u in / /movie/ /all/ /movie/mv-010/ /sitemap.xml \
         /robots.txt /search-index.json /img/mv-010-240.webp /qr/mv-010-quark.svg \
         /nope; do
  printf '%-38s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$S$u")"
done
curl -s $S/ | grep canonical       # 应是你的真实域名
```

除 `/nope` 应为 **404**，其余全部 **200**。分类页一级目录是英文 slug，无需 percent-encoding；旧 `/category/movie/` 与 `/resource/<id>/` 由 nginx 301 到新地址。

## 目录结构

```
data/                # 一个分类一个 YAML（英文文件名），构建时自动合并
  movie.yaml         # 电影
  tv.yaml            # 电视剧
  documentary.yaml   # 纪录片
  anime.yaml         # 动漫
  game.yaml          # 游戏
  software.yaml      # 软件
  ebook.yaml         # 电子书
  course.yaml        # 课程
  misc.yaml          # 其他
config/              # 站点配置，与资源数据分开存放
  site.yaml          # 站名、分类顺序、首页每类条数与排序方式、免责声明、页脚联系方式、分类页首屏条数
  tags.yaml          # 标签聚合页：建页阈值、排除名单、近重复阈值、标签 URL 别名（没配别名的自动用拼音）
static/
  favicon.svg        # 站点图标唯一源文件（换 logo 就改它）；构建时拷到根目录并生成 favicon.ico / apple-touch-icon.png
  share.jpg          # 首页品牌分享卡（1200×630），构建时拷到站点根目录供 og:image 用
  images/            # 配图，按分类 slug 分子目录：images/<slug>/<id>.jpg / .png / .webp / .svg（产物 /img/ 仍按 id 平铺）
theme/assets/        # 前端样式与脚本，构建时拷到 public/assets/
scripts/             # 站点脚本目录：构建 / 预览（lib/ 是构建核心：读数据、出图片、渲染页面）
  sitestats.py           # 访问统计脚本（VPS 方案用到）
tools/                # 工具目录：数据采集与内容生产（依赖夸克 CLI / TMDB 凭据，站点构建不引用）
  fill-files.mjs         # 补文件清单 files: 块（连载轮询、待办扫描）
  scan-drive-fids.mjs    # 扫夸克 SHARE 目录生成 config/drive-fids.json
  sort-trees.mjs         # 回填 files.tree 行序（幂等，不动内容与日期）
  list-ongoing.mjs       # 只读盘点连载条目状态
  new-resource.js        # 交互式新增资源条目（npm run new）
  fill-desc.mjs          # 把 .tmp/desc-draft.json 里的简介写回 YAML（自动接回【季/集】前缀与 ｜TMDB 后缀，--strict 拦不合格稿）
  fill-title.mjs         # 批量补标题
  list-short-desc.mjs    # 列出正文不足指定字数的条目（npm run list:short）
  poster.mjs             # 海报/封面生成器，单入口五模式：book（生成书封兜底）/ icon（图标合成竖版）/ set（套装深色封面）/ scene（编辑式主题版式，saas/arch/silk/dl 预设）/ douban（抓豆瓣正版封面）
  share-poster.mjs       # 生成首页品牌分享卡 static/share.jpg（改站点配置后重跑）
  export-all-resources.mjs # 导出全部资源 Markdown 清单（群机器人用）
  lib/                   # 工具专用共享库：quark-cli（夸克 CLI 探测）/ serials（连载轮询口径）/ tree-sort（目录树排序）/ tmdb（TMDB 查询）
docs/                # 经验类文档（已合并为单一 README.md，含建站/内容/SEO/待办/规划），见 docs/README.md
deploy/              # 部署用：setup-vps.sh 一键部署、Nginx 配置示例、自动更新脚本、统计日志格式、搜索引擎提交脚本
public/              # 构建产物，部署这个目录（本目录不入库）
```

## 文档

经验类文档已合并为单一 [`docs/README.md`](docs/README.md)，按「铁律 / 样式 / 配置 / 构建 / 部署 / 内容生产 / SEO / 功能模块 / 待办规划 / 环境速查」分节，覆盖建站、内容生产、SEO 与待办变更。结论只写一份，过程留 Git 历史。


## 机器人与社媒推送（2026-11-17 并自 mybot 仓）

- `bot/` — Telegram 群查询机器人（Python 标准库），失效反馈走飞书，用法见 [`bot/README.md`](bot/README.md)
- `push/` — 资源站 → Telegram 频道 / Bluesky 的定时推送脚本（Node.js）
- ⚠️ 本仓库公开：`bot/config.json` 与 `push/**/*.env` 含真实凭据，**一律不进 git**（已加 .gitignore，历史已清洗），凭据只留各运行机本地
- QQ 群查询机器人已迁至绿联 NAS Docker，不在本仓库
