#!/usr/bin/env bash
# 我的网盘 TG / Bluesky 推送 —— 纯系统 cron 一键部署（Debian 13）
# 在 Debian 主机的真实终端，以有 sudo 权限的用户执行：
#   sudo bash /home/marco/wdp-scheduler/install.sh
#
# 幂等：重复执行只会覆盖本脚本管理的两条 cron 条目，不动你已有的 crontab 内容。
# 关键：cron 任务以「调用 sudo 的普通用户」运行（非 root）。因此凭据、判重状态、
#       日志目录的属主必须全部归该用户，否则脚本读不到 REPO 会回退到 Windows 默认路径。
set -euo pipefail

MYBOT=/home/marco/github/wodewangpan
SITE=/home/marco/github/wodewangpan
STATE_SRC="$MYBOT/state"
WB=/home/marco/.workbuddy
LOG="$WB/logs"
NODE="$(command -v node || true)"
BASH="# >>> wdp-push"
EASH="# <<< wdp-push"

say() { printf '%s\n' "$*"; }
die() { printf 'X %s\n' "$*" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "请用 sudo 以 root 执行：sudo bash $0"

# cron 运行用户 = 调用 sudo 的那个普通用户（默认 marco）
CRON_USER="${SUDO_USER:-}"
[ -n "$CRON_USER" ] && [ "$CRON_USER" != "root" ] || CRON_USER="marco"
CRON_GROUP="$(id -gn "$CRON_USER" 2>/dev/null || printf '%s' "$CRON_USER")"
CRON_HOME="$(eval echo ~"$CRON_USER")"
say "==> cron 运行用户：$CRON_USER（home=$CRON_HOME）"

# ---------- 0. 环境与依赖 ----------
[ -n "$NODE" ] || die "找不到 node，先装：sudo apt install -y nodejs npm"
NODE_VER="$("$NODE" -p 'process.versions.node')"
[ "${NODE_VER%%.*}" -ge 18 ] || die "Node 需 >= 18，当前 $NODE_VER"
[ -f "$MYBOT/push/telegram/tg-post.mjs" ] || die "仓库路径不对（push/ 不存在）：$MYBOT"
[ -d "$SITE/data" ] || die "wodewangpan 路径不对：$SITE"
say "==> 检查通过  node=$NODE_VER"

if ! command -v crontab >/dev/null 2>&1; then
  say "==> 安装 cron"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y cron
fi

# 修复常见的 spool 属主异常（Debian 正常应为 root:crontab 1730）
SPOOL=/var/spool/cron/crontabs
[ -d "$SPOOL" ] || mkdir -p "$SPOOL"
chown root:crontab "$SPOOL"
chmod 1730 "$SPOOL"
chmod 4755 /usr/bin/crontab
say "==> cron spool 权限已规范（root:crontab 1730）"

# 站点依赖
if [ ! -f "$SITE/node_modules/js-yaml/package.json" ] || [ ! -f "$SITE/node_modules/qrcode/package.json" ]; then
  say "==> 安装站点依赖"
  (cd "$SITE" && npm install --omit=dev --no-audit --no-fund)
fi

# ---------- 1. 凭据：改 REPO 路径 + 属主归 cron 用户 ----------
fix_env() {
  local f="$1" tmp
  [ -f "$f" ] || die "缺凭据 $f"
  tmp="$(mktemp)"
  tr -d '\r' < "$f" | awk -v r="$SITE" '/^REPO[[:space:]]*=/{print "REPO=" r; next} {print}' > "$tmp"
  grep -q '^REPO=' "$tmp" || printf 'REPO=%s\n' "$SITE" >> "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"          # 保留原 inode/属主，再显式 chown
  chown "$CRON_USER:$CRON_GROUP" "$f"
  chmod 600 "$f"                             # 仅 cron 用户可读写，token 不外泄
}
fix_env "$MYBOT/push/telegram/wodewangpan-tg.env"
fix_env "$MYBOT/push/bluesky/wodewangpan-bluesky.env"
say "==> 两个 .env 的 REPO 已指向站点，属主 $CRON_USER，权限 600（内容未打印）"

# ---------- 2. 判重状态：唯一权威，缺失即拒绝 ----------
mkdir -p "$WB/telegram-posts" "$WB/bluesky-posts" "$LOG"
chown "$CRON_USER:$CRON_GROUP" "$WB/telegram-posts" "$WB/bluesky-posts" "$LOG"
chmod 700 "$WB/telegram-posts" "$WB/bluesky-posts"
install_state() {
  local d="$1" dst="$WB/$1/posted.json" src="$STATE_SRC/$1/posted.json"
  if [ -f "$dst" ]; then
    say "    保留现有 $dst"
  elif [ -f "$src" ]; then
    cp "$src" "$dst"; say "    导入 $src"
  else
    die "缺判重状态 $dst 且快照 $src 也不存在——从空状态起跑会重发全站历史，拒绝部署。"
  fi
  chown "$CRON_USER:$CRON_GROUP" "$dst"
  chmod 600 "$dst"
}
install_state telegram-posts
install_state bluesky-posts

# ---------- 3. --dry 自检：必须「以 cron 用户身份」跑，否则测不出属主/权限问题 ----------
say "==> --dry 自检（以 $CRON_USER 身份，不登录、不发送、不写状态）"
runuser -u "$CRON_USER" -- env HOME="$CRON_HOME" bash -c "cd '$MYBOT' && '$NODE' push/telegram/tg-post.mjs --dry >/dev/null 2>&1" || die "TG --dry 失败（以 $CRON_USER 身份）"
runuser -u "$CRON_USER" -- env HOME="$CRON_HOME" bash -c "cd '$MYBOT' && '$NODE' push/bluesky/bluesky-post.mjs --dry >/dev/null 2>&1" || die "Bluesky --dry 失败（以 $CRON_USER 身份）"
say "==> 两个 --dry 自检通过（cron 用户可读凭据与判重状态）"

# ---------- 4. 写 crontab ----------
# 4a. 清理旧版本可能误装到 root crontab 的条目（早期 install.sh 缺陷）
if crontab -l 2>/dev/null | grep -q 'wdp-push BEGIN'; then
  tmp="$(mktemp)"
  crontab -l 2>/dev/null | sed "/$BASH/,/$EASH/d" > "$tmp" || true
  crontab "$tmp"; rm -f "$tmp"
  say "==> 已清理 root crontab 中误装的旧条目"
fi

# 4b. 写 cron 用户的 crontab（任务以普通用户运行，权限最小）
tmp="$(mktemp)"
crontab -u "$CRON_USER" -l 2>/dev/null | sed "/$BASH/,/$EASH/d" > "$tmp" || true
{
  echo "$BASH BEGIN (managed by install.sh, 勿手改)"
  echo "3 * * * * cd $MYBOT && $NODE push/telegram/tg-post.mjs >> $LOG/tg-post.log 2>&1"
  echo "8 * * * * cd $MYBOT && $NODE push/bluesky/bluesky-post.mjs >> $LOG/bsky-post.log 2>&1; $NODE tools/feishu-reports/wodewangpan-push-fix.mjs --apply >> $LOG/push-fix.log 2>&1; $NODE tools/feishu-reports/wodewangpan-push-sync.mjs >> $LOG/push-sync.log 2>&1"
  echo "$EASH END"
} >> "$tmp"
crontab -u "$CRON_USER" "$tmp"; rm -f "$tmp"
say "==> crontab 已写入（用户 $CRON_USER）"

# ---------- 5. 启动 cron 守护 ----------
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl enable --now cron
elif command -v service >/dev/null 2>&1; then
  service cron start || true
else
  pgrep -x cron >/dev/null || /usr/sbin/cron
fi
pgrep -x cron >/dev/null && say "==> cron 守护进程已运行" || say "!! cron 未启动，请检查：sudo service cron status"

say ""
say "==> 部署完成。当前推送条目（$CRON_USER 的 crontab）："
crontab -u "$CRON_USER" -l | sed -n "/$BASH/,/$EASH/p"
say ""
say "日志： tail -f $LOG/tg-post.log $LOG/bsky-post.log"
say "卸载： crontab -l | sed '/wdp-push BEGIN/,/wdp-push END/d' | crontab -"
say "验证： 下个整点后 tail -n 20 $LOG/tg-post.log $LOG/bsky-post.log"
