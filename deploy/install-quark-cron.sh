#!/usr/bin/env bash
# 我的网盘 · 两条夸克 cron 幂等安装（分享每日更新 17:20 / 预存资源搬运 17:40）
# 2026-11-18 并入仓库。在 Debian 机真实 shell、以运行用户（marco）执行：
#   bash deploy/install-quark-cron.sh            # 安装/刷新
#   bash deploy/install-quark-cron.sh uninstall  # 卸载这两条
#
# 幂等：只覆盖本脚本管理的两个标记块，不动已有 crontab 条目。
# 注意：本脚本写的是「执行者本人」的 crontab；不要用 sudo 跑，除非目标是 root 的 crontab。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"
LOG_DIR="${HOME}/.workbuddy/quark-sync-cache"

Q_BEGIN='# >>> wdp-quark'
Q_END='# <<< wdp-quark'
M_BEGIN='# >>> wdp-move'
M_END='# <<< wdp-move'

say() { printf '%s\n' "$*"; }
die() { printf 'X %s\n' "$*" >&2; exit 1; }

strip_blocks() {
  # 从 stdin 读 crontab，删掉两个标记块后写到 stdout
  sed "/$Q_BEGIN/,/$Q_END/d; /$M_BEGIN/,/$M_END/d"
}

case "${1:-install}" in
  install) ;;
  uninstall)
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | strip_blocks > "$tmp" || true
    crontab "$tmp"; rm -f "$tmp"
    say '==> 已卸载两条夸克 cron（其他条目保留）'
    exit 0
    ;;
  *) die "用法: $0 [install|uninstall]" ;;
esac

# 前提校验：脚本、skill、登录态缺一即停，不写半套 cron
[ -n "$NODE" ] || die '找不到 node，先装：sudo apt install -y nodejs'
for f in tools/quark-cron/share-update.mjs tools/quark-cron/prestore-move.mjs; do
  [ -f "$REPO/$f" ] || die "缺 $REPO/$f，先 git pull"
done
[ -d "$HOME/.workbuddy/skills/quarkclouddrive" ] || die '缺 quarkclouddrive skill，先 scp 到 ~/.workbuddy/skills/'
[ -f "$HOME/.workbuddy/skills/quarkclouddrive/workbuddy/config.json" ] || die '缺夸克登录态 config.json（走 scp，不进 git）'
mkdir -p "$LOG_DIR"

tmp="$(mktemp)"
crontab -l 2>/dev/null | strip_blocks > "$tmp" || true
{
  echo "$Q_BEGIN BEGIN (managed, 勿手改)"
  echo "20 17 * * * cd $REPO && $NODE tools/quark-cron/share-update.mjs >> $LOG_DIR/cron.log 2>&1"
  echo "$Q_END END"
  echo "$M_BEGIN BEGIN (managed, 勿手改)"
  echo "40 17 * * * cd $REPO && $NODE tools/quark-cron/prestore-move.mjs >> $LOG_DIR/move-cron.log 2>&1"
  echo "$M_END END"
} >> "$tmp"
crontab "$tmp"; rm -f "$tmp"

say '==> 已写入两条 cron：'
crontab -l | sed -n "/$Q_BEGIN/,/$Q_END/p; /$M_BEGIN/,/$M_END/p"
say ''
say '提示：旧的 ~/share-update-cron.mjs、~/prestore-move-cron.mjs 不再使用；'
say '      若以前手工写过不带标记块的条目，请自行 crontab -l 核查删除，避免重复跑。'
