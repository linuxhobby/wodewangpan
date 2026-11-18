# Debian 13：夸克预存资源搬运迁移（去 LLM 化部署手册）

> 记录：2026-11-17。对应 WorkBuddy 自动化任务「我的网盘.夸克预存资源搬运」（id `9221f42f-52e7-487b-b452-4633d6f9eb59`）。
> 目标是迁到一台常开的 Debian 13 主机，用 cron 直跑编排脚本，不依赖 LLM / WorkBuddy 自动化调度器。
> 与 `DEPLOY-DEBIAN-QUARK.md`（分享每日补存）同源不同流程：那是增量转存，这是分类目录间搬运 + 查重 + 随机挑。
> 本文不含任何凭据值；`<USER>` / `<DEBIAN_IP>` 按实际替换。

> 2026-11-18 更新：编排脚本已并入本仓库 `tools/quark-cron/`，cron 安装走 `deploy/install-quark-cron.sh`，本文不再内嵌脚本全文。

## 1. 这个任务做什么 / 和另一个夸克任务的区别

把根目录「预存资源」下 9 个分类目录里的资源目录，**每类随机挑 1 个**，搬到根目录「SHARE」下对应分类目录。先按目录名查重，重复的跳过、不重复才搬。搬完向飞书推一张蓝色简报卡。

| | 夸克分享补存（DEPLOY-DEBIAN-QUARK） | 本任务（预存资源搬运） |
|---|---|---|
| 网盘写操作 | `saveas-update` 增量转存 | `move` 目录搬运 |
| 判重依据 | 分享更新清单 | 源/目标两侧目录名归一化比对 |
| 选片 | 全量处理 | 每类 `crypto.randomInt` 真随机挑 1 个 |
| 调度 | 每天 17:20 | 原 `FREQ=HOURLY;INTERVAL=22`（约每天一次） |
| 定时任务现状 | 已迁走 | 当前 PAUSED（迁移前已暂停） |

原 prompt 里的判断（按名解析 fid、归一化查重、随机挑、失败重试、状态判定）此前由 LLM 现场做。迁移方案把这些**固化进一个自包含编排脚本** `tools/quark-cron/prestore-move.mjs`（已入库），cron 直跑，无需 LLM。

## 2. 依赖清单（必须全部搬到 Debian）

| 依赖 | 本机路径 | Debian 默认路径 | 说明 |
|---|---|---|---|
| 编排脚本 | 仓库 `tools/quark-cron/prestore-move.mjs` | 同（随 `git pull` 更新） | 2026-11-18 入库，固化原 prompt 全部判断逻辑 |
| quarkclouddrive CLI + 登录态 | `~/.workbuddy/skills/quarkclouddrive/` | 同（可用 `QK_SKILL_DIR` 覆盖） | 与补存任务**共用同一份**，只需传一次；含 `scripts/quark-drive.cjs` 与 `workbuddy/config.json`（cookie，敏感，绝不进 git） |
| 飞书卡片脚本 | `tools/feishu-reports/wodewangpan-move-feishu.mjs` | 同仓库路径（可用 `QK_FEISHU_SCRIPT` 覆盖） | 2026-11-17 起随仓库分发，不再单独 scp；接收人内置，不要改 |
| lark-cli 绑定 | WorkBuddy 的 lark-cli | 同机 WorkBuddy | 脚本走 `~/.workbuddy/binaries/.../@larksuite/cli/scripts/run.js`，当前绑定应用须为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 中间简报目录 | `~/.workbuddy/quark-sync-cache/` | 同（可用 `QK_CACHE_DIR` 覆盖） | 脚本自建，落 `prestore-move-*.md` |

> 若补存任务已迁到同一台 Debian，`quarkclouddrive` skill 和 lark-cli 绑定都已就位；编排脚本与飞书脚本均已入仓，**本任务只需 `git pull`**，不用再传任何脚本。

## 3. 操作步骤（顺序固定）

### 3.1 停旧机

Windows 侧「我的网盘.夸克预存资源搬运」当前已是 PAUSED，无需再动。确认没有残留进程在跑 CLI。

### 3.2 搬依赖到 Debian

```bash
# 在旧机执行（Git Bash 用 /c/... 路径）。登录态含 cookie，走 scp，绝不进任何 git 仓库
# 若同机已迁过补存任务，下面第 1 条可跳过
scp -r /c/Users/marco/.workbuddy/skills/quarkclouddrive <USER>@<DEBIAN_IP>:~/.workbuddy/skills/
# 编排脚本与飞书脚本已入仓，Debian 上 git pull 即有，不再单独 scp
```

> 若 Debian 上 `~/.workbuddy/skills/` 已有其它 skill，**只覆盖 quarkclouddrive 这一个目录**，别整目录替换。

### 3.3 Debian 上装依赖、确认飞书通道

```bash
sudo apt install -y nodejs cron                 # Node >= 18
sudo systemctl enable --now cron
node --check tools/quark-cron/prestore-move.mjs     # 脚本语法自检
ls ~/.workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/scripts/run.js
```

飞书脚本自检（不发送，只打印卡片 JSON）：

```bash
node tools/feishu-reports/wodewangpan-move-feishu.mjs --names "[01游戏] 自检" --status 成功 --dry-run
```

### 3.4 分级验证（dry → no-send → 正式）

```bash
# 1) dry：验登录/根目录/9 对分类解析/查重选片，不 move、不发卡（最安全的自检，可反复跑）
node tools/quark-cron/prestore-move.mjs --dry

# 2) no-send：照常随机挑 + 真 move，但不发飞书卡（想先看搬运结果落盘再发卡时用）
node tools/quark-cron/prestore-move.mjs --no-send

# 3) 正式：cron 自动跑；也可先手动跑一次确认卡片
node tools/quark-cron/prestore-move.mjs
```

`--dry` 输出要点：
- `[登录] OK`、`[根目录] 预存资源=… SHARE=…`、`[分类] 解析完成：9/9 对齐全`
- 每类一行 `[dry] 会搬 [目标分类] 目录名（新候选 N / 源 M）`，或 `[跳过] …`
- 每次随机结果不同属正常（真随机）；末尾简报标注「dry 预演，未落库」

### 3.5 写入 crontab
两条夸克 cron 已统一由仓库脚本安装（本任务固定 17:40，避开补存任务的 17:20）：
> ⚠️ 本机实况（2026-11-17 迁移时发现）：Debian 侧为容器环境，`/var/spool/cron` 属主为 `nobody:nogroup`，
> `crontab` 命令报 `mkstemp: 不允许的操作`；`/etc/cron.d` 也被 WorkBuddy 沙箱安全策略拦截。
> cron 写入需在宿主机真实 shell 里手动执行（见下），WorkBuddy 会话内装不了定时任务。

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
| 宿主 shell / cron 直跑报「无法识别当前 Agent 环境，禁止继续使用」 | `get-user-info` 失败，整轮不发卡 | CLI 按 env 识别 Agent（workbuddy 检测器认 `WORKBUDDY_CONFIG_DIR` 等 7 个变量）；编排脚本 `cli()` 已内置注入 `WORKBUDDY_CONFIG_DIR=~/.workbuddy`，登录态 `agent_auth` 本就按 `"workbuddy"` 键存。裸跑 quark-drive.cjs 需自行带该 env |
| 登录态 `config.json` 没拷 / cookie 过期 | `get-user-info` 失败，整轮不发卡 | scp 覆盖；脚本报错即停，不启动登录流程、不反复重试 |
| 凭据进了 git | 账号泄露 | 登录态、`.env`、`config.json` 一律只走 scp，不 commit |
| 飞书绑定成别的应用 | 卡片发错应用或失败 | 确认 lark-cli 当前应用为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 路径含 `C:/Users/...` 照搬 | Debian 上文件找不到 | 全部走 HOME 动态解析 / 环境变量覆盖 |
| 每轮跑 `install.sh` | 可能重建/覆盖登录态 | 编排脚本不调用 install.sh，skill 人工按需更新 |
| 硬编码 fid | 目录重建后搬错位置 | 脚本每次 search + browse 实时按名解析 fid，无硬编码 |
| 只看路径含 SHARE 就判重复 | 漏判/误判 | 脚本按目录名归一化比对（去编号前缀/括号/空格/大小写），保守=视为重复 |
| 从 stdout 预览取 fid | 字段错位/大输出截断 | 一律读 artifact JSONL（`data.file_path`），用 node 解析 |
| move 失败就回滚别的分类 | 破坏已成功的搬运 | 失败只记录、最多重试 1 次，继续下一类，不回滚 |
| 一次 move 多个 fid | 目标串错 | 每类单独一次 `move <fid> --target-fid <该类TARGET_FID>` |

## 5. 红线（不可协商，脚本已固化）

- 只处理表中 9 对目录，不新建任何目录、不动其它目录。
- 除 `move` 外对网盘不做任何增删改；**绝不删除、不覆盖、不改名**任何文件/目录。
- 源只取文件夹（category 0），不搬散文件；新候选为空则跳过，不补挑、不换分类。
- 每类最多搬 1 个，9 类合计最多 9 个；随机用 `crypto.randomInt`，不按名排序取第一个。
- 不写站点 `data/*.yaml`、不碰 git / build / ssh、不出分享链接、不发 TG / Bluesky。
- 唯一额外动作是发一张蓝色飞书卡；推送失败最多重试 1 次，不因推送失败回滚搬运。
- 每条夸克命令的非空 `notice.text` 只进本地简报、原样展示，不写进飞书卡。

## 6. 日常运维

```bash
# 看日志
tail -f ~/.workbuddy/quark-sync-cache/move-cron.log

# 手动补跑一次（会真搬 + 发卡）
node tools/quark-cron/prestore-move.mjs

# 只看不写（推荐日常自检）
node tools/quark-cron/prestore-move.mjs --dry

# 看最近本地简报
ls -t ~/.workbuddy/quark-sync-cache/prestore-move-*.md | head -3

# 卸载本任务 cron（保留补存任务的 wdp-quark 块）
bash deploy/install-quark-cron.sh uninstall  # 卸掉两条夸克 cron
```

状态判定（进卡片底部 note）：全部 9 类成功=成功，有成功也有跳过/失败=部分成功，全无可搬=跳过，全部尝试失败=失败，未登录=未授权，根目录找不到=目录未找到。跳过/异常分类带标签记入卡片「跳过的分类」段。

## 7. 回退

临时切回 LLM 版：用 `bash deploy/install-quark-cron.sh uninstall` 卸掉两条夸克 cron，把原自动化任务从 PAUSED 恢复 ACTIVE 即可。
两边**不要同时启用**：同一资源目录会被两条链路各搬一次，第二次必然搬空或搬错。

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
