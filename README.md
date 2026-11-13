# wodewangpan · 网盘资源分享站
用 YAML 写资源，构建成**纯静态站点**：海报压缩、二维码、搜索索引、SEO 标签全部在构建期生成，产物丢给 Nginx 就能跑。

- **Telegram 群**： [https://t.me/wodewangpantop](https://t.me/wodewangpantop) ，群里有查询机器人

- **Telegram 订阅号**：[https://t.me/myquark](https://t.me/myquark) ，更新站内最新资源
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

<details>
<summary>展开：deploy/setup-vps.sh 全文（可直接复制保存为文件执行）</summary>

内容与仓库里的 deploy/setup-vps.sh 完全一致，方便不 clone 仓库也能复制；改脚本时请同步更新本段。

```bash
#!/usr/bin/env bash
# deploy/setup-vps.sh —— 「方案 A：VPS + Nginx」一键部署
#
# 在一台干净的 Debian / Ubuntu VPS 上，把本仓库原样复制成一个可访问的站点：
#   装环境 → 取代码 → 写入域名 → 构建 → 配 Nginx → 签证书 → 自动更新/统计 → 自检
#
# 复制口径：除了域名，其他一律保持仓库原值；只写 config/site.yaml 的 baseUrl。
#
# 用法（root，域名已解析到本机）：
#   curl -fsSL -o /tmp/wdwp-setup.sh https://raw.githubusercontent.com/linuxhobby/wodewangpan/main/deploy/setup-vps.sh
#   sudo bash /tmp/wdwp-setup.sh --domain example.com --email me@example.com
#
#   --domain            必填，裸域（example.com，不要带 www）；也是唯一会改的内容
#   --email             Let's Encrypt 通知邮箱；不填则 --register-unsafely-without-email
#   --repo              git 仓库地址；fork 之后填自己的（决定能否启用自动更新）
#   --branch            分支，默认 main
#   --dir               站点目录，默认 /opt/wodewangpan
#   --skip-https        只上 HTTP（域名还没解析好时用），之后去掉本参数重跑即可切 HTTPS
#   --force-https       解析 IP 与本机出口 IP 不一致时仍尝试签证书（例如前面挂了 CDN）
#   --no-stats          不装统计 cron 与初始化（站点配置仍保持 stats: local，页脚数字会留空）
#   --autoupdate       强制安装定时发布；--no-autoupdate 强制不装
#                      默认：clone 的是自己的仓库才装
#   -h / --help         显示帮助
#
# 可重复执行：代码已 clone、证书已签不会重做；baseUrl 每次同步为当前 --domain。
# 参数记在 /etc/wodewangpan-setup.env，第二次跑只需 `sudo bash /tmp/wdwp-setup.sh`。
#
# 注意：启用定时发布时，git reset --hard origin/main 会覆盖本地的 baseUrl 改动，
# 需把 config/site.yaml 提交到该仓库。
#
# 与 deploy/nginx-site.conf.example 的关系：本脚本按同一套口径（目录式 URL、错误页、
# gzip、静态缓存、扫描器/AI 爬虫拦截、http 与裸域单跳 301 到 www）自行生成配置，
# 但不含本站历史改版留下的 301 规则——复制站点用不上那些旧 URL。
# README.md「方案 A · 一键部署」里有本文件的全文副本，改这里记得同步改那一段。
set -euo pipefail

readonly DEFAULT_REPO='https://github.com/linuxhobby/wodewangpan.git'
readonly STATE_FILE='/etc/wodewangpan-setup.env'
readonly NGINX_CONF='/etc/nginx/conf.d/wodewangpan.conf'
readonly SETUP_LOG='/var/log/wdwp-setup.log'

# ── 默认值；命令行 > /etc/wodewangpan-setup.env > 这里的默认值 ──
DOMAIN=''
EMAIL=''
REPO=''
BRANCH='main'
SITE_DIR=''
STATS=1
SKIP_HTTPS=0
FORCE_HTTPS=0
AUTOUPDATE_CHOICE='auto'   # auto / 1 / 0，来自命令行或上次的参数
AUTOUPDATE=0               # 本次实际是否安装定时发布
NGINX_MODE='http'

log()  { printf '[setup] %s\n' "$*"; }
warn() { printf '[setup] 警告：%s\n' "$*" >&2; }
die()  { printf '[setup] 错误：%s\n' "$*" >&2; exit 1; }
step() { printf '\n[setup] === %s ===\n' "$*"; }

usage() {
  # curl | sudo bash -s -- 时 $0 只是 "bash"，读不到脚本自身，给一份精简提示
  if [ -r "$0" ] && grep -q 'deploy/setup-vps.sh' "$0" 2>/dev/null; then
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  else
    cat <<'HELP'
用法：sudo bash setup-vps.sh --domain example.com [--email 邮箱] [--repo 仓库地址]
完整参数见仓库 README 的「方案 A · 一键部署」，或先下载脚本再执行 --help：
  curl -fsSL -o /tmp/wdwp-setup.sh https://raw.githubusercontent.com/linuxhobby/wodewangpan/main/deploy/setup-vps.sh
HELP
  fi
}

load_state() {
  if [ -r "$STATE_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$STATE_FILE"
    set +a
    log "已读取上次的参数：$STATE_FILE"
  fi
  [ -n "$REPO" ]   || REPO="$DEFAULT_REPO"
  [ -n "$SITE_DIR" ] || SITE_DIR='/opt/wodewangpan'
}

save_state() {
  # %q 生成可被 shell source 的安全引用，路径或地址带空格/引号也不会写坏
  {
    printf 'DOMAIN=%q\n' "$DOMAIN"
    printf 'EMAIL=%q\n' "$EMAIL"
    printf 'REPO=%q\n' "$REPO"
    printf 'BRANCH=%q\n' "$BRANCH"
    printf 'SITE_DIR=%q\n' "$SITE_DIR"
    printf 'STATS=%q\n' "$STATS"
    printf 'AUTOUPDATE_CHOICE=%q\n' "$AUTOUPDATE_CHOICE"
  } > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
}

require_value() {
  [ "$2" -ge 2 ] || die "$1 缺少取值"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --domain)        require_value "$1" "$#"; DOMAIN=$2; shift 2;;
      --email)         require_value "$1" "$#"; EMAIL=$2; shift 2;;
      --repo)          require_value "$1" "$#"; REPO=$2; shift 2;;
      --branch)        require_value "$1" "$#"; BRANCH=$2; shift 2;;
      --dir)           require_value "$1" "$#"; SITE_DIR=$2; shift 2;;
      --skip-https)    SKIP_HTTPS=1; shift;;
      --force-https)   FORCE_HTTPS=1; shift;;
      --no-stats)      STATS=0; shift;;
      --autoupdate)    AUTOUPDATE_CHOICE=1; shift;;
      --no-autoupdate) AUTOUPDATE_CHOICE=0; shift;;
      -h|--help)       usage; exit 0;;
      *)               die "未知参数：$1（用 --help 看用法）";;
    esac
  done
}

preflight() {
  [ "$(id -u)" -eq 0 ] || die "请用 root 执行（sudo bash $0 ...）"
  command -v apt-get >/dev/null 2>&1 || die "只支持 Debian / Ubuntu（需要 apt-get）；其他系统请按 README 手工部署"

  # 有人会顺手写成 www.example.com，这里统一成裸域
  case "$DOMAIN" in
    www.*) DOMAIN=${DOMAIN#www.}; warn "域名按裸域处理：$DOMAIN";;
  esac
  if [ -z "$DOMAIN" ]; then
    if [ -t 0 ]; then
      read -r -p '[setup] 你的域名（裸域，如 example.com）：' DOMAIN
    else
      die "缺少 --domain，例如：sudo bash setup-vps.sh --domain example.com"
    fi
  fi
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
    || die "域名格式不对：$DOMAIN（要裸域，如 example.com）"
  [[ "$SITE_DIR" = /* && "$SITE_DIR" != *' '* ]] \
    || die "--dir 要是不含空格的绝对路径：$SITE_DIR"

  if [ "$AUTOUPDATE_CHOICE" = 'auto' ]; then
    if [ "$REPO" = "$DEFAULT_REPO" ]; then
      AUTOUPDATE=0
      log "clone 的是本仓库，默认不装自动更新（会覆盖你的站点配置）；自己的 fork 请用 --repo 指定"
    else
      AUTOUPDATE=1
    fi
  else
    AUTOUPDATE="$AUTOUPDATE_CHOICE"
  fi
}

dns_ready() {
  local resolved public
  resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}') || true
  if [ -z "$resolved" ]; then
    warn "$DOMAIN 还没有解析记录"
    return 1
  fi
  public=$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)
  if [ -n "$public" ] && [ "$resolved" != "$public" ]; then
    warn "$DOMAIN → $resolved，本机出口 IP 是 $public；证书校验可能失败（CDN 场景可加 --force-https）"
    return 1
  fi
  log "域名解析：$DOMAIN → $resolved"
  return 0
}

install_packages() {
  local -a pkgs=(nginx git curl ca-certificates openssl python3 cron)
  [ "$SKIP_HTTPS" -eq 1 ] || pkgs+=(certbot)
  log "安装系统依赖：${pkgs[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}" >> "$SETUP_LOG" 2>&1 \
    || { tail -30 "$SETUP_LOG" >&2; die "依赖安装失败，日志：$SETUP_LOG"; }
}

ensure_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  fi
  if [[ "$major" =~ ^[0-9]+$ ]] && [ "$major" -ge 18 ]; then
    log "Node.js $(node -v)（满足 ≥18）"
    return
  fi
  log "安装 Node.js 20（apt 版过旧或没有）"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$SETUP_LOG" 2>&1 \
    || { tail -30 "$SETUP_LOG" >&2; die "NodeSource 脚本执行失败"; }
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >> "$SETUP_LOG" 2>&1 \
    || { tail -30 "$SETUP_LOG" >&2; die "nodejs 安装失败"; }
  node -v
}

fetch_code() {
  if [ -d "$SITE_DIR/.git" ]; then
    log "仓库已存在，跳过 clone：$SITE_DIR（脚本不会覆盖你已有的改动）"
  else
    [ ! -e "$SITE_DIR" ] || die "$SITE_DIR 已存在但不是 git 仓库，请换 --dir 或先移走"
    local -a args=(clone --depth 1)
    [ "$BRANCH" = 'main' ] || args+=(-b "$BRANCH")
    args+=("$REPO" "$SITE_DIR")
    log "clone $REPO → $SITE_DIR"
    git "${args[@]}" || die "clone 失败，检查 --repo 是否正确、仓库是否公开"
  fi
  cd "$SITE_DIR" || die "进不去 $SITE_DIR"
  log "npm ci（首次约 1 分钟）"
  npm ci --no-audit --no-fund >> "$SETUP_LOG" 2>&1 \
    || { tail -30 "$SETUP_LOG" >&2; die "npm ci 失败，日志：$SETUP_LOG"; }
}

# 复制口径：除了域名，其他一律保持仓库原值。
# config/site.yaml 只写 baseUrl 一行（已有则替换，没有就插在 description 后面），
# 其余字段、注释、行序、行尾都不动；逐行处理，不用 yaml.dump 以免丢注释。
configure_site() {
  log "写入域名：config/site.yaml 的 baseUrl=https://www.$DOMAIN（其余保持原值）"
  python3 - "$SITE_DIR/config/site.yaml" "$DOMAIN" <<'PY'
import json
import re
import sys

path, domain = sys.argv[1], sys.argv[2]
value = json.dumps('https://www.' + domain, ensure_ascii=False)

lines = open(path, encoding='utf-8').read().splitlines(keepends=True)
has_baseurl = any(re.match(r'^baseUrl:', ln) for ln in lines)
out = []
for line in lines:
    if re.match(r'^baseUrl:', line):
        raw = line.rstrip('\r\n')
        nl = line[len(raw):]
        comment = ' ' + raw[raw.index('#'):].rstrip() if '#' in raw else ''
        line = 'baseUrl: ' + value + comment + nl
        has_baseurl = True
    out.append(line)
    # 原仓库没有 baseUrl 字段，插在 description 后面（域名注释块之前）
    if not has_baseurl and re.match(r'^description:', line):
        out.append('baseUrl: ' + value + '\n')
        has_baseurl = True

open(path, 'w', encoding='utf-8').writelines(out)
print('  只改了 baseUrl，其余字段原样保留')
PY
}

build_site() {
  log "构建：BASE_URL=https://www.$DOMAIN npm run build"
  (cd "$SITE_DIR" && BASE_URL="https://www.$DOMAIN" npm run build) > "$SETUP_LOG" 2>&1 \
    || { tail -40 "$SETUP_LOG" >&2; die "构建失败，日志：$SETUP_LOG"; }
  tail -4 "$SETUP_LOG"
  [ -f "$SITE_DIR/public/index.html" ] || die "构建产物里没有 public/index.html"
}

install_assets() {
  local f
  for f in 00-block-probes.conf 00-block-ai.conf 00-sitestats.conf; do
    install -m644 "$SITE_DIR/deploy/$f" "/etc/nginx/conf.d/$f"
  done
  mkdir -p /var/www/html /opt/indexnow /var/lib/sitestats
  if [ ! -s /opt/indexnow/key.txt ]; then
    openssl rand -hex 16 > /opt/indexnow/key.txt
  fi
  chmod 644 /opt/indexnow/key.txt
  log "已装 http 级 Nginx 配置与 IndexNow 密钥 /opt/indexnow/key.txt"
}

# 同一份模板生成两种状态：
#   http  —— 80 端口直接出站点，供 DNS 未就绪时用，也供 certbot HTTP-01 校验
#   https —— 443 www 出站点，80 与裸域 443 都单跳 301 到 https://www.<域名>
write_nginx_conf() {
  local mode=$1 tmpl
  tmpl=$(mktemp)
  cat > "$tmpl" <<'NGINX'
# 由 deploy/setup-vps.sh 生成，重跑本脚本会覆盖；手工改动请另行备份
__EXTRA_TOP__
server {
    if ($probe_block) { return 444; }
    if ($ai_block) { return 403; }
__LISTEN__
    server_name __SERVER_NAMES__;
    root __SITE_DIR__/public;
    index index.html;
    charset utf-8;
__ACCESS_LOG__

    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json text/xml application/xml application/rss+xml application/atom+xml image/svg+xml;

    location ~* \.(css|js|json|svg|webp|png|jpg|jpeg|gif|ico)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
        access_log off;
    }

    # index.html → 目录式 URL，避免同一页面留下两个可抓取地址
    if ($request_uri ~* "^(.*/)index\.html(\?.*)?$") {
        return 301 $1;
    }
    location / {
        try_files $uri $uri/ $uri/index.html =404;
    }

    location = /stats.json {
        alias /var/lib/sitestats/stats.json;
        default_type application/json;
        add_header Cache-Control "no-store";
        add_header Access-Control-Allow-Origin "*";
    }
    location = /hit { return 204; }
    location = /key.txt { alias /opt/indexnow/key.txt; default_type text/plain; }

    error_page 404 /404.html;
    location /.well-known/acme-challenge/ { root /var/www/html; }
}
NGINX

  if [ -f "$NGINX_CONF" ] && ! grep -q '由 deploy/setup-vps.sh 生成' "$NGINX_CONF"; then
    cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%s)"
    warn "原有 $NGINX_CONF 已备份为 .bak.<时间戳>"
  fi

  MODE="$mode" DOMAIN="$DOMAIN" SITE_DIR="$SITE_DIR" \
  python3 - "$tmpl" "$NGINX_CONF" <<'PY'
import os
import sys

src, dst = sys.argv[1], sys.argv[2]
mode = os.environ['MODE']
domain = os.environ['DOMAIN']
site_dir = os.environ['SITE_DIR']
www = 'www.' + domain
cert = '/etc/letsencrypt/live/' + domain

repl = {
    '__DOMAIN__': domain,
    '__SITE_DIR__': site_dir,
    # site.yaml 保持原值 stats: local，日志格式固定带 cookie_vid
    '__ACCESS_LOG__': '    access_log /var/log/nginx/access.log sitestats;',
}

if mode == 'https':
    ssl = f"""    ssl_certificate     {cert}/fullchain.pem;
    ssl_certificate_key {cert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;"""
    repl['__LISTEN__'] = '    listen 443 ssl;\n' + ssl
    repl['__SERVER_NAMES__'] = www
    repl['__EXTRA_TOP__'] = f"""# http 与裸域统一 301 到 https://{www}/，全站只留一个 200
server {{
    if ($probe_block) {{ return 444; }}
    listen 80;
    server_name {domain} {www};
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location / {{ return 301 https://{www}$request_uri; }}
}}
server {{
    if ($probe_block) {{ return 444; }}
    listen 443 ssl;
    server_name {domain};
{ssl}
    return 301 https://{www}$request_uri;
}}
"""
else:
    repl['__LISTEN__'] = '    listen 80;'
    repl['__SERVER_NAMES__'] = f'{domain} {www}'
    repl['__EXTRA_TOP__'] = ''

t = open(src, encoding='utf-8').read()
for k, v in repl.items():
    t = t.replace(k, v)
open(dst, 'w', encoding='utf-8').write(t)
PY
  rm -f "$tmpl"
  chmod 644 "$NGINX_CONF"
  nginx -t >> "$SETUP_LOG" 2>&1 || { nginx -t >&2; die "nginx -t 失败，配置：$NGINX_CONF"; }
  systemctl enable --now nginx >> "$SETUP_LOG" 2>&1 || die "nginx 启动失败，查 $SETUP_LOG"
  systemctl reload nginx
  NGINX_MODE="$mode"
  log "Nginx 配置已生效（$mode）：$NGINX_CONF"
}

issue_cert() {
  if [ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    log "证书已存在，复用 /etc/letsencrypt/live/$DOMAIN/"
    return 0
  fi
  local -a args=(certonly --webroot -w /var/www/html
                 -d "$DOMAIN" -d "www.$DOMAIN"
                 --non-interactive --agree-tos --keep-until-expiring)
  if [ -n "$EMAIL" ]; then
    args+=(-m "$EMAIL")
  else
    args+=(--register-unsafely-without-email)
  fi
  log "申请证书：$DOMAIN + www.$DOMAIN"
  if ! certbot "${args[@]}" >> "$SETUP_LOG" 2>&1; then
    tail -25 "$SETUP_LOG" >&2
    warn "证书申请失败，站点保持在 HTTP 可用状态；DNS 生效后去掉 --skip-https 重跑本脚本即可"
    return 1
  fi
  log "证书签发成功"
}

add_cron() {
  local tag=$1 line=$2 tmp
  tmp=$(mktemp)
  crontab -l 2>/dev/null | grep -vF "$tag" > "$tmp" || true
  printf '%s\n' "$line" >> "$tmp"
  crontab "$tmp" || { rm -f "$tmp"; die "写 crontab 失败"; }
  rm -f "$tmp"
}

install_autoupdate() {
  if [ "$AUTOUPDATE" != '1' ]; then
    log "未启用定时发布（本地站点配置的改动不会被覆盖）"
    return
  fi
  install -m755 "$SITE_DIR/deploy/wdwp-autoupdate.sh" /usr/local/bin/wdwp-autoupdate
  # 发布脚本里的 IndexNow sitemap 路径写死了本站目录，换成实际 --dir
  sed -i "s#/opt/wodewangpan/public/sitemap.xml#${SITE_DIR}/public/sitemap.xml#g" \
    /usr/local/bin/wdwp-autoupdate
  printf 'SITE_DIR=%q\nBASE_URL=%q\n' "$SITE_DIR" "https://www.$DOMAIN" \
    > /etc/wdwp-autoupdate.conf
  add_cron 'wdwp-autoupdate' \
    '30 */2 * * * flock -w 120 /tmp/wdwp-autoupdate.lock /usr/local/bin/wdwp-autoupdate >> /var/log/wdwp-autoupdate.log 2>&1'
  log "已装定时发布（每 2 小时 :30，无新提交直接跳过）；日志 /var/log/wdwp-autoupdate.log"
}

install_stats() {
  if [ "$STATS" != '1' ]; then
    log "按 --no-stats 跳过统计 cron 与初始化（站点配置保持原值 stats: local）"
    return
  fi
  local py
  py=$(command -v python3)
  (cd "$SITE_DIR" && "$py" scripts/sitestats.py --reset --backfill) >> "$SETUP_LOG" 2>&1 \
    || warn "统计初始化失败（不影响站点），日志：$SETUP_LOG"
  add_cron 'scripts/sitestats.py' \
    "*/5 * * * * cd $SITE_DIR && $py scripts/sitestats.py >> /var/log/sitestats.log 2>&1"
  log "已装本地访问统计（每 5 分钟）；页脚数字会在有访问后逐步累积"
}

self_check() {
  local code failed=0 want path www="www.$DOMAIN" canonical='' probe_http=''
  step '上线自检'
  probe() {
    path=$1; want=$2
    if [ "$NGINX_MODE" = 'https' ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' \
        --resolve "$www:443:127.0.0.1" "https://$www$path" 2>/dev/null || echo 000)
    else
      code=$(curl -s -o /dev/null -w '%{http_code}' \
        -H "Host: $www" "http://127.0.0.1$path" 2>/dev/null || echo 000)
    fi
    printf '  %-30s %s（期望 %s）\n' "$path" "$code" "$want"
    [ "$code" = "$want" ] || failed=1
  }
  probe '/' 200
  probe '/sitemap.xml' 200
  probe '/robots.txt' 200
  probe '/category/movie/' 200
  probe '/key.txt' 200
  probe '/nope' 404

  if [ "$NGINX_MODE" = 'https' ]; then
    probe_http=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/ || echo 000)
    printf '  %-30s %s（期望 301）\n' 'http 裸域' "$probe_http"
    [ "$probe_http" = '301' ] || failed=1
    canonical=$(curl -s --resolve "$www:443:127.0.0.1" "https://$www/" | grep -m1 '<link rel="canonical"' || true)
  else
    canonical=$(curl -s -H "Host: $www" http://127.0.0.1/ | grep -m1 '<link rel="canonical"' || true)
  fi
  if printf '%s' "$canonical" | grep -q "https://www.$DOMAIN"; then
    printf '  %-30s %s\n' 'canonical' '指向新域名，OK'
  else
    warn "首页 canonical 没指向 https://www.$DOMAIN，请检查 config/site.yaml 的 baseUrl 与构建命令"
    failed=1
  fi
  [ "$failed" -eq 0 ] || warn "自检有未通过项，站点目录：$SITE_DIR；日志：$SETUP_LOG"
}

print_summary() {
  printf '\n[setup] === 部署结束 ===\n'
  if [ "$NGINX_MODE" = 'https' ]; then
    printf '  站点地址    https://www.%s/\n' "$DOMAIN"
  else
    printf '  站点地址    http://www.%s/（暂未启用 HTTPS）\n' "$DOMAIN"
  fi
  printf '  站点目录    %s\n' "$SITE_DIR"
  printf '  站点配置    %s/config/site.yaml（只写了 baseUrl）\n' "$SITE_DIR"
  printf '  复制口径    除域名外，其余内容保持仓库原值\n'
  printf '  Nginx 配置  %s\n' "$NGINX_CONF"
  printf '  部署日志    %s\n' "$SETUP_LOG"
  printf '  IndexNow    /opt/indexnow/key.txt（对应 https://www.%s/key.txt）\n' "$DOMAIN"
  printf '  自动发布    %s    访问统计  %s\n' \
    "$([ "$AUTOUPDATE" = '1' ] && echo 已启用 || echo 未启用)" \
    "$([ "$STATS" = '1' ] && echo 已启用 || echo 未启用)"
  if [ "$NGINX_MODE" = 'http' ]; then
    printf '\n[setup] 证书还没签：DNS 生效后重跑 sudo bash setup-vps.sh（不带 --skip-https）即可切到 HTTPS。\n'
  fi
}

main() {
  case "${1:-}" in -h|--help) usage; exit 0;; esac
  load_state
  parse_args "$@"
  preflight
  save_state

  step '1/9 系统与运行环境'
  install_packages
  ensure_node

  step '2/9 取代码、装依赖'
  fetch_code

  step '3/9 写入站点域名（其余保持原值）'
  configure_site

  step '4/9 构建'
  build_site

  step '5/9 Nginx 基础配置'
  install_assets
  write_nginx_conf http

  step '6/9 HTTPS'
  if [ "$SKIP_HTTPS" -eq 1 ]; then
    log '按 --skip-https 跳过证书，站点保持 HTTP 可用'
  elif [ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] \
       || [ "$FORCE_HTTPS" -eq 1 ] || dns_ready; then
    if issue_cert; then
      write_nginx_conf https
    fi
  else
    log '域名暂未正确解析，跳过证书；站点保持 HTTP 可用，DNS 好了重跑本脚本'
  fi

  step '7/9 定时自动发布'
  install_autoupdate

  step '8/9 本地访问统计'
  install_stats

  step '9/9 自检'
  self_check
  print_summary
}

# curl | bash -s -- 时 BASH_SOURCE 为空数组，set -u 下要用 :- 兜底；
# 为空视为直接执行，非空且与 $0 相同也是直接执行，被 source 时不跑 main
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
```

</details>

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
0 */6 * * * /usr/local/bin/wdwp-autoupdate >> /var/log/wdwp-autoupdate.log 2>&1
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
scripts/             # 站点脚本单目录：构建 / 预览 / 内容运维工具（lib/ 是构建核心：读数据、出图片、渲染页面）
  sitestats.py           # 访问统计脚本（VPS 方案用到）
  share-poster.mjs       # 生成首页品牌分享卡 static/share.jpg（改站点配置后重跑）
  fill-desc.mjs          # 把 .tmp/desc-draft.json 里的简介写回 YAML（自动接回【季/集】前缀与 ｜TMDB 后缀，--strict 拦不合格稿）
  list-short-desc.mjs    # 列出正文不足指定字数的条目（npm run list:short）
  poster.mjs             # 海报/封面生成器，单入口五模式：book（生成书封兜底）/ icon（图标合成竖版）/ set（套装深色封面）/ scene（编辑式主题版式，saas/arch/silk/dl 预设）/ douban（抓豆瓣正版封面）
docs/                # 经验类文档（已合并为单一 README.md，含建站/内容/SEO/待办/规划），见 docs/README.md
deploy/              # 部署用：setup-vps.sh 一键部署、Nginx 配置示例、自动更新脚本、统计日志格式、搜索引擎提交脚本
public/              # 构建产物，部署这个目录（本目录不入库）
```

## 文档

经验类文档已合并为单一 [`docs/README.md`](docs/README.md)，按「铁律 / 样式 / 配置 / 构建 / 部署 / 内容生产 / SEO / 功能模块 / 待办规划 / 环境速查」分节，覆盖建站、内容生产、SEO 与待办变更。结论只写一份，过程留 Git 历史。

