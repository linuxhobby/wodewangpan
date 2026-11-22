# deploy/wdp-scheduler — TG / Bluesky 推送常驻调度器

**纯本地调度，不依赖 WorkBuddy / LLM**：每小时 :03 发 Telegram、:08 发 Bluesky（间隔 5 分钟），
Bluesky 发帖进程结束后再跑 `tools/feishu-reports/wodewangpan-push-sync.mjs`（不同步才发飞书告警）。
直接调用本仓库 `push/telegram/tg-post.mjs` 与 `push/bluesky/bluesky-post.mjs`。
路径全部按脚本自身位置解析，整个目录放哪都能跑（logs/、lastrun.json、scheduler.pid
为运行态产物，自动生成在目录内，不入库）。

## 与 `deploy/deploy-cron.sh` 的关系（二选一，别同时开）

| 方案 | 入口 | 机制 | 适用 |
|---|---|---|---|
| 系统 cron | `deploy/deploy-cron.sh`（幂等安装） | 每小时 :03 / :08 由 crontab 触发 | 宿主机 cron 可写（非容器） |
| 常驻调度器 | 本目录 `control.sh start` | node 进程内 setInterval 秒级扫描，崩溃 5 秒自重启 | cron 不可用（容器内 spool 属主异常等） |

两者都以**推送脚本自带的判重与门控**兜底，重复触发不会重复发帖；但两个方案同时开
会在同一个 :03/:08 各发一轮，等于每小时两条，**严禁并存**。

## 用法

```bash
bash deploy/wdp-scheduler/control.sh start    # 启动（含崩溃自重启）
bash deploy/wdp-scheduler/control.sh status   # 运行状态 + 日志尾部 + 最近触发
bash deploy/wdp-scheduler/control.sh run-now tg   # 手动立即发一轮 TG（真实发帖）
bash deploy/wdp-scheduler/control.sh run-now bs
bash deploy/wdp-scheduler/control.sh stop     # 停止
```

前置条件：`node >= 18`（`NODE` 环境变量可覆盖，默认 `command -v node`）；
推送凭据在 `push/**/*.env`（不入库，部署时 scp 就位，见 `deploy/deploy-cron.sh` 的 fix_env）。

## 迁移旧部署（Debian 机 ~/wdp-scheduler → 仓库目录）

1. `bash ~/wdp-scheduler/control.sh stop`（旧目录版）
2. 确认 `git pull` 后仓库内 `deploy/wdp-scheduler/` 就位
3. `bash deploy/wdp-scheduler/control.sh start`
4. `status` 里确认 lastrun 与日志滚动正常；确认下个整点 :03/:08 正常发帖后删旧目录
