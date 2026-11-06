#!/bin/bash
# wdwp-autoupdate：给「我的网盘」(wodewangpan) 重新构建用。
#   拉取最新代码 → 构建到临时目录 → 原子替换 public → reload nginx
#   本站 = wodewangpan（/opt/wodewangpan，www.wodewangpan.top）。
#   院采雷达是另一个站，用 ycld-autoupdate（/opt/yuancaileida），两者不要混用。
#
# 用法：
#   1) install -m755 本文件到 /usr/local/bin/wdwp-autoupdate
#   2) 站点专属的两个值写进 /etc/wdwp-autoupdate.conf（与脚本分离，升级脚本时不会被覆盖）
#   3) 加进 root 的 crontab：30 */2 * * * /usr/local/bin/wdwp-autoupdate >> /var/log/wdwp-autoupdate.log 2>&1
#      （线上实际频率以此为准，2026-11-06 改为每 2 小时的 30 分；ycld 在每 2 小时的第 5 分钟，错峰不抢 CPU）
#      （频率只决定上线延迟上限：没有新提交时脚本在下面直接 exit 0，空跑只有一次 git fetch）
#
# 手动立即发布（不想等 cron）：FORCE=1 wdwp-autoupdate
set -euo pipefail

# cron 的 PATH 很窄，nginx / systemctl 常不在里面，这里补齐（否则构建完不会 reload）
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SITE_DIR=/opt/wodewangpan          # ← 站点目录
BASE_URL=https://your-domain.com     # ← 站点域名（影响 canonical / OG / sitemap）
LOG=/var/log/wdwp-autoupdate.log

# 站点专属配置优先：/etc/wdwp-autoupdate.conf 里重设 SITE_DIR / BASE_URL 即可
CONF=/etc/wdwp-autoupdate.conf
[ -r "$CONF" ] && . "$CONF"

cd "$SITE_DIR"

git fetch --depth 1 origin main -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ] && [ "${FORCE:-0}" != "1" ]; then
  exit 0                              # 没更新，直接退出
fi

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
log "开始发布：${LOCAL:0:7} → ${REMOTE:0:7}$([ "${FORCE:-0}" = "1" ] && echo '（强制）')"

git reset --hard origin/main -q
npm ci --no-audit --no-fund >> "$LOG" 2>&1

# 先构建到 public.new：构建过程完全不碰正在对外服务的 public。
# 就绪后用两次 rename 换目录，切换是瞬时的，nginx 不会读到「新 HTML 配旧资源」的中间态。
rm -rf public.new public.old
BASE_URL=$BASE_URL BUILD_DIR=public.new npm run build >> "$LOG" 2>&1

if [ ! -f public.new/index.html ]; then
  log "构建失败：public.new 不完整，保留线上旧版本不切换"
  rm -rf public.new
  exit 1
fi

if [ -d public ]; then
  mv public public.old
fi
mv public.new public
rm -rf public.old

nginx -t && systemctl reload nginx
log "发布完成：${REMOTE:0:7}"

# 发布完成后把新增 / 变更的 URL 推给 IndexNow（Bing / Yandex 等），加速收录。
# 增量模式（默认）：只推 lastmod >= 昨天的条目；首次全量补推用 ALL=1 手动跑一次。
# 密钥以线上 /opt/indexnow/key.txt 为准（与 nginx /key.txt 同源），提交失败不影响发布。
INDEXNOW_HOST=${BASE_URL#*://}
if [ -x deploy/submit-indexnow.sh ]; then
  deploy/submit-indexnow.sh "$INDEXNOW_HOST" /opt/indexnow/key.txt /opt/wodewangpan/public/sitemap.xml >> "$LOG" 2>&1 \
    && log "IndexNow 推送完成" || log "IndexNow 推送失败（不影响发布）"
fi
