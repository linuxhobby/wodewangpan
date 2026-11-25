#!/usr/bin/env bash
# 我的网盘 · 夸克 cron 幂等安装（当前仅预存资源搬运 01:40 + 缓存清理 04:20）
# 分享每日补充更新（原 16:10 cron）已于 2026-11-22 迁移到 WorkBuddy 自动化：
#   「我的网盘.夸克分享每日补充更新简报」每天 16:10 直接调用 tools/quark-cron/share-update.mjs。
#   本脚本 install / uninstall 都会顺带清理历史 wdp-quark 块，防止 cron 与自动化双跑。
# 2026-11-18 并入仓库。在 Debian 机真实 shell、以运行用户（marco）执行：
#   bash deploy/install-quark-cron.sh            # 安装/刷新（预存搬运 + 缓存清理）
#   bash deploy/install-quark-cron.sh uninstall  # 卸载本脚本管理的 cron（含历史分享块）
#
# 幂等：只覆盖本脚本管理的标记块，不动已有 crontab 条目。
# 注意：本脚本写的是「执行者本人」的 crontab；不要用 sudo 跑，除非目标是 root 的 crontab。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# node 路径优先用 ~/.local/bin/node（固定软链，版本升级不会失效），
# 与现有 wdp-move / wdp-push cron 的写法保持一致；找不到再回退到 PATH 里的 node。
if [ -x "$HOME/.local/bin/node" ]; then
  NODE="$HOME/.local/bin/node"
else
  NODE="$(command -v node || true)"
fi
LOG_DIR="${HOME}/.cache/quark-sync"

# 历史标记：分享更新已迁至 WorkBuddy 自动化，仅用于清理旧 cron，不再写入新条目
Q_BEGIN='# >>> wdp-quark'
Q_END='# <<< wdp-quark'
M_BEGIN='# >>> wdp-move'
M_END='# <<< wdp-move'
# 缓存清理块（2026-11-26 新增）：每天 04:20 清 ~/.cache/quark-sync 里超过 7 天的缓存
P_BEGIN='# >>> wdp-prune'
P_END='# <<< wdp-prune'

say() { printf '%s\n' "$*"; }
die() { printf 'X %s\n' "$*" >&2; exit 1; }

strip_blocks() {
  # 从 stdin 读 crontab，删掉历史分享块 wdp-quark、预存搬运块 wdp-move、缓存清理块 wdp-prune 后写到 stdout
  sed "/$Q_BEGIN/,/$Q_END/d; /$M_BEGIN/,/$M_END/d; /$P_BEGIN/,/$P_END/d"
}

case "${1:-install}" in
  install) ;;
  uninstall)
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | strip_blocks > "$tmp" || true
    crontab "$tmp"; rm -f "$tmp"
    say '==> 已卸载夸克 cron 及历史分享块（其他条目保留）'
    exit 0
    ;;
  *) die "用法: $0 [install|uninstall]" ;;
esac

# 前提校验：脚本、skill、登录态缺一即停，不写半套 cron
[ -n "$NODE" ] || die '找不到 node，先装：sudo apt install -y nodejs'
for f in tools/quark-cron/prestore-move.mjs tools/quark-cron/prune-cache.mjs; do
  [ -f "$REPO/$f" ] || die "缺 $REPO/$f，先 git pull"
done
[ -d "$HOME/.workbuddy/skills/quarkclouddrive" ] || die '缺 quarkclouddrive skill，先 scp 到 ~/.workbuddy/skills/'
[ -f "$HOME/.workbuddy/skills/quarkclouddrive/workbuddy/config.json" ] || die '缺夸克登录态 config.json（走 scp，不进 git）'
mkdir -p "$LOG_DIR"

tmp="$(mktemp)"
crontab -l 2>/dev/null | strip_blocks > "$tmp" || true
{
  echo "$M_BEGIN BEGIN (managed, 勿手改)"
  echo "40 1 * * * cd $REPO && QK_CACHE_DIR=$LOG_DIR $NODE tools/quark-cron/prestore-move.mjs >> $LOG_DIR/move-cron.log 2>&1"
  echo "$M_END END"
  echo "$P_BEGIN BEGIN (managed, 勿手改)"
  echo "20 4 * * * cd $REPO && WDP_CACHE_DIR=$LOG_DIR $NODE tools/quark-cron/prune-cache.mjs --apply >> $LOG_DIR/prune-cache.log 2>&1"
  echo "$P_END END"
} >> "$tmp"
crontab "$tmp"; rm -f "$tmp"

say '==> 已写入 2 条 cron（分享补存已交 WorkBuddy 自动化，不再写 cron）：'
crontab -l | sed -n "/$M_BEGIN/,/$M_END/p"
crontab -l | sed -n "/$P_BEGIN/,/$P_END/p"
say ''
say '提示：分享补存现由 WorkBuddy 自动化「我的网盘.夸克分享每日补充更新简报」每天 16:10'
say '      直接调用 tools/quark-cron/share-update.mjs；不要手工写回 16:10 cron，避免双跑。'
say '      缓存清理每天 04:20 跑 prune-cache.mjs --apply，默认只保留最近 7 天的缓存；'
say '      状态锚点（trending-seen / trending-last / fill-files-notready 等）永不删除。'
say '      旧的 ~/share-update-cron.mjs、~/prestore-move-cron.mjs 不再使用；'
say '      若以前手工写过不带标记块的条目，请自行 crontab -l 核查删除。'
