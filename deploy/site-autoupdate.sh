#!/bin/bash
# 站点自动更新：拉取最新代码 → 构建到临时目录 → 原子替换 public → reload nginx
#
# 用法：
#   1) install -m755 本文件到 /usr/local/bin/site-autoupdate
#   2) 站点专属的两个值写进 /etc/site-autoupdate.conf（与脚本分离，升级脚本时不会被覆盖）
#   3) 加进 root 的 crontab：0 */6 * * * /usr/local/bin/site-autoupdate >> /var/log/site-autoupdate.log 2>&1
#      （频率只决定上线延迟上限：没有新提交时脚本在下面直接 exit 0，空跑只有一次 git fetch）
#
# 手动立即发布（不想等 cron）：FORCE=1 site-autoupdate
set -euo pipefail

# cron 的 PATH 很窄，nginx / systemctl 常不在里面，这里补齐（否则构建完不会 reload）
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SITE_DIR=/opt/wodewangpan          # ← 站点目录
BASE_URL=https://your-domain.com     # ← 站点域名（影响 canonical / OG / sitemap）
LOG=/var/log/site-autoupdate.log

# 站点专属配置优先：/etc/site-autoupdate.conf 里重设 SITE_DIR / BASE_URL 即可
CONF=/etc/site-autoupdate.conf
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
