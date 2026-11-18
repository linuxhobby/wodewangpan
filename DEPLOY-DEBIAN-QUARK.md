# Debian 13：夸克分享每日补充更新迁移（去 LLM 化部署手册）

> 记录：2026-11-17。对应 WorkBuddy 自动化任务「我的网盘.夸克分享每日补充更新」（id `c165024b-1ce5-485b-9202-2758908b0790`）。
> 目标是迁到一台常开的 Debian 13 主机，用 cron 直跑编排脚本，不依赖 LLM / WorkBuddy 自动化调度器。
> TG / Bluesky 两条推送已迁移完成并验收，旧部署文档不再保留。
> 本文不含任何凭据值；`<USER>` / `<DEBIAN_IP>` 按实际替换。

> 2026-11-18 更新：编排脚本已并入本仓库 `tools/quark-cron/`，cron 安装走 `deploy/install-quark-cron.sh`，本文不再内嵌脚本全文。

## 1. 这个任务和 TG / Bluesky 的本质区别

| | TG / Bluesky 推送 | 本任务（夸克分享补存） |
|---|---|---|
| 形态 | 单文件自包含 Node 脚本 | LLM 驱动的复合流程：CLI + 登录态 + 多辅助脚本 + 飞书脚本 |
| 调度前 | `FREQ=HOURLY;BYMINUTE=8/9` | `FREQ=DAILY;BYHOUR=17;BYMINUTE=20` |
| 定时任务现状 | 已迁走 | 当前为 PAUSED（迁移前已暂停） |
| 副作用 | 对外发帖，判重靠本地 json | **网盘写操作**（`saveas-update` 增量转存），有资源目录红线 |

关键：原任务 prompt 里的大量判断（分页取完、41043/41040 语义、疑似新建目录判据、msg 原样展示）此前由 LLM 现场做。
迁移方案把这些判断**固化进一个自包含编排脚本** `tools/quark-cron/share-update.mjs`（已入库），cron 每天 17:20 直跑，无需 LLM。

## 2. 依赖清单（必须全部搬到 Debian）

| 依赖 | 本机路径 | Debian 默认路径 | 说明 |
|---|---|---|---|
| 编排脚本 | 仓库 `tools/quark-cron/share-update.mjs` | 同（随 `git pull` 更新） | 2026-11-18 入库，整合原 4 个辅助脚本逻辑 |
| quarkclouddrive CLI | `~/.workbuddy/skills/quarkclouddrive/` | 同（可用 `QK_SKILL_DIR` 覆盖） | skill 整个目录，含 `scripts/quark-drive.cjs` |
| 夸克登录态 | `.../quarkclouddrive/workbuddy/config.json` | 同 | **cookie，敏感，绝不进 git**，需 scp |
| 飞书卡片脚本 | `tools/feishu-reports/wodewangpan-share-update-feishu.mjs`（2026-11-17 起在仓库内） | 同仓库路径（可用 `QK_FEISHU_SCRIPT` 覆盖） | 随仓库分发，无需单独拷 |
| lark-cli 绑定 | WorkBuddy 的 lark-cli | 同机 WorkBuddy | 脚本走 `~/.workbuddy/binaries/.../@larksuite/cli/scripts/run.js`，需当前绑定应用为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 中间文件目录 | `~/.workbuddy/quark-sync-cache/` | 同（可用 `QK_CACHE_DIR` 覆盖） | 脚本自建，落 candidates/results/verify/payload |

> 环境注记：CLI 和飞书脚本内部已用 `os.homedir()` 解析路径，跨平台；原 prompt 里的 `C:/Users/marco/...` 全部不要带到 Debian。
> 并入仓库后，编排脚本按自身位置定位仓库内飞书脚本（`tools/feishu-reports/`），本机 `~/Scripts/` 副本不再是依赖；`QK_FEISHU_SCRIPT` 仍可覆盖。
> `install.sh` 每轮更新 skill 的行为在脚本里**故意去掉了**（Debian 上没人值守，且它可能重建登录态配置），改成人工按需更新 skill。

## 3. 操作步骤（顺序固定）

### 3.1 停旧机

Windows 侧「我的网盘.夸克分享每日补充更新」自动化任务当前已是 PAUSED，无需再动。确认没有残留进程在跑 CLI。

### 3.2 搬依赖到 Debian

```bash
# 在旧机执行（Git Bash 用 /c/... 路径）。登录态含 cookie，走 scp，绝不进任何 git 仓库
# 编排脚本与飞书脚本已入仓，Debian 上 git pull 即有，不再单独 scp
scp -r /c/Users/marco/.workbuddy/skills/quarkclouddrive <USER>@<DEBIAN_IP>:~/.workbuddy/skills/
```

> 若 Debian 上 `~/.workbuddy/skills/` 已有其它 skill，**只覆盖 quarkclouddrive 这一个目录**，别整目录替换。

### 3.3 Debian 上装依赖、确认飞书通道

```bash
sudo apt install -y nodejs cron                 # Node >= 18
sudo systemctl enable --now cron
node --check tools/quark-cron/share-update.mjs    # 脚本语法自检（仓库根执行）
```

飞书通道自检（确认 lark-cli 绑定的是「我的网盘」应用，不是院采雷达）：

```bash
ls ~/.workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/scripts/run.js
node tools/feishu-reports/wodewangpan-share-update-feishu.mjs --input <任一payload.json> --dry-run
```

### 3.4 分级验证（dry → no-send → 正式）

```bash
# 1) dry：只验登录/路径/翻页，不转存、不发卡（0 更新也会正常退出）
node tools/quark-cron/share-update.mjs --dry

# 2) no-send：照常转存 + 生成 payload，但不发飞书，先看 dirs/skipped 判得对不对
node tools/quark-cron/share-update.mjs --no-send

# 3) 正式：cron 每天 17:20 自动跑；也可先手动跑一次确认卡片
node tools/quark-cron/share-update.mjs
```

`--no-send` 后务必看一眼 `~/.workbuddy/quark-sync-cache/share-update-card-*.json`：
`dirs` 应是「补进历史目录」的条目，`skipped` 应是失败或疑似新建目录的条目。判据不对就不要启用 cron。

### 3.5 写入 crontab
两条夸克 cron 已统一由仓库脚本安装：
用 `deploy/install-quark-cron.sh` 一次装好两条夸克 cron（补存 17:20 + 搬运 17:40），
脚本按标记块幂等替换，不动已有条目（TG / Bluesky 的 cron 块保留）：

```bash
# 在 Debian 机真实 shell、以运行用户（marco）执行
bash deploy/install-quark-cron.sh            # 安装/刷新
bash deploy/install-quark-cron.sh uninstall  # 卸载这两条
crontab -l | grep -A1 wdp-quark              # 验证
```

## 4. 关键坑速查

| 坑 | 后果 | 处理 |
|---|---|---|
| 登录态 `config.json` 没拷 / cookie 过期 | `get-user-info` 失败，整轮不发卡 | scp 覆盖；脚本报错即停，不会启动登录流程 |
| 凭据进了 git | 账号泄露 | 登录态、`.env`、`config.json` 一律只走 scp，不 commit |
| 飞书绑定成别的应用 | 卡片发错应用或失败 | 确认 lark-cli 当前应用为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 路径含 `C:/Users/...` 照搬 | Debian 上文件找不到 | 全部走 HOME 动态解析 / 环境变量覆盖 |
| 每轮跑 `install.sh` | 可能重建/覆盖登录态 | 编排脚本已去掉该步骤，skill 人工按需更新 |
| 只看路径含 SHARE 就判新建目录 | 正常补存被误报 | 脚本用 `get-share-saved-dir` 的 fid/name 比对（`isExistingDir`），不用路径正则 |
| 看到新建目录就删/改名 | 破坏网盘结构 | 红线：脚本只记录上报，不做任何删除/改名/建目录 |
| `saveas-update` 成功后又重试 | 重复转存 | 脚本对成功不重试；41043 不重试；其余最多 1 次 |

## 5. 红线（不可协商，脚本已固化）

- 唯一网盘写操作是 `saveas-update` 往该链接**上次转存的已有目录**补新增文件，不改目录结构。
- 不 `create-folder`、不编号补位、不拆分合集、不 `move`、不首次 `saveas`、不删不改目录、不碰「预存资源」。
- 疑似新建目录只进卡片 `skipped` 上报人工，脚本不自行清理。
- 不写站点 `data/*.yaml`、不碰 git、不 build、不 ssh、不发 TG / Bluesky。
- 本地简报与卡片 `msg` 原样展示，不改写、不概括、不加前后缀；正文不用破折号「—」。

## 6. 日常运维

```bash
# 看日志
tail -f ~/.workbuddy/quark-sync-cache/cron.log

# 手动补跑一次（会真的转存 + 发卡）
node tools/quark-cron/share-update.mjs

# 只看不写
node tools/quark-cron/share-update.mjs --dry

# 卸载本任务 cron（保留 TG/Bluesky 块）
bash deploy/install-quark-cron.sh uninstall  # 只卸两条夸克 cron
```

- 0 条更新时脚本静默退出，不发卡、不写网盘，避免刷屏。
- 有新增成功或有异常才发一张蓝色 interactive 卡片，接收人走 lark-cli 绑定应用内的 open_id。
- 判重不建本地数据库：夸克 `get-share-update-list` 返回的更新清单本身就是判重依据。

## 7. 回退

临时切回 LLM 版（WorkBuddy 自动化）：用 `bash deploy/install-quark-cron.sh uninstall` 卸掉两条夸克 cron，把原自动化任务从 PAUSED 恢复 ACTIVE 即可。
两边**不要同时启用**：同一分享链接会被两条链路各转存一次。

## 8. 脚本位置与版本

编排脚本已入库，本文不再内嵌全文。旧附录曾与实机脚本漂移（附录缺 Agent 环境注入，实机后来补过），
现在统一以仓库为准：

| 脚本 | 仓库路径 |
|---|---|
| 分享每日补存编排 | `tools/quark-cron/share-update.mjs` |
| 预存资源搬运编排 | `tools/quark-cron/prestore-move.mjs` |
| 飞书卡片（补存） | `tools/feishu-reports/wodewangpan-share-update-feishu.mjs` |
| 飞书卡片（搬运） | `tools/feishu-reports/wodewangpan-move-feishu.mjs` |
| cron 幂等安装 | `deploy/install-quark-cron.sh` |

改脚本一律改仓库版并 `git pull` 到 Debian 机，不要再在 `~/` 留副本。
两脚本默认按自身位置定位仓库内飞书脚本，`QK_FEISHU_SCRIPT` 仍可覆盖。
