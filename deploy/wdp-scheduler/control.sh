#!/usr/bin/env bash
# 常驻调度器管理脚本：start / stop / restart / status / run-now
# 2026-11-17 并入仓库：目录按脚本自身位置解析，部署时整目录放任意位置都能用。
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
NODE="${NODE:-$(command -v node)}"
SCRIPT=$DIR/scheduler.mjs
PID=$DIR/scheduler.pid
LOG=$DIR/scheduler.log

is_alive() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-}" in
  start)
    if is_alive; then echo "已在运行 pid=$(cat "$PID")"; exit 0; fi
    nohup setsid bash -c '
      while true; do
        echo "[$(date -Is)] 启动调度进程"
        "$1" "$2" >> "$3" 2>&1
        echo "[$(date -Is)] 调度进程退出，5 秒后重启"
        sleep 5
      done
    ' _ "$NODE" "$SCRIPT" "$LOG" </dev/null >> "$LOG" 2>&1 &
    echo $! > "$PID"
    sleep 1
    if is_alive; then echo "已启动 pid=$(cat "$PID")（含崩溃自重启）"; else echo "启动失败，查看 $LOG"; exit 1; fi
    ;;
  stop)
    if ! is_alive; then echo "未在运行"; rm -f "$PID"; exit 0; fi
    P=$(cat "$PID")
    # 杀掉整个进程组（setsid 启动的 bash 及其子进程）
    kill -TERM -- -"$P" 2>/dev/null || kill -TERM "$P" 2>/dev/null || true
    rm -f "$PID"
    echo "已停止"
    ;;
  restart)
    "$0" stop; sleep 1; "$0" start
    ;;
  status)
    if is_alive; then
      echo "运行中 pid=$(cat "$PID")"
      echo "--- 调度日志尾部 ---"
      tail -8 "$LOG" 2>/dev/null
      echo "--- 最近触发记录 ---"
      cat "$DIR/lastrun.json" 2>/dev/null || echo "（暂无）"
    else
      echo "未运行"
    fi
    ;;
  run-now)
    # 手动立即跑一次（真实发帖），参数：tg | bs
    case "${2:-}" in
      tg) cd "$REPO" && "$NODE" push/telegram/tg-post.mjs; echo "（TG 为异步投递，可能已另起进程，详见日志）" ;;
      bs) cd "$REPO" && "$NODE" push/bluesky/bluesky-post.mjs ;;
      *) echo "用法: $0 run-now {tg|bs}" ;;
    esac
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|run-now tg|run-now bs}"
    ;;
esac
