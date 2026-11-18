# 我的网盘 · 四个常驻 cron 任务

> 2026-11-18 定稿。本文合并原 `DEPLOY-DEBIAN-QUARK.md` 与 `DEPLOY-DEBIAN-QUARK-UPDATE.md`，并补入 Telegram / Bluesky 两条推送任务。
> 运行机：Debian 13（主机名 `debian13`），仓库 `/home/marco/Documents/Github/wodewangpan`，运行用户 `marco`。
> **四个任务全部是纯 Node + 系统 cron，不依赖 LLM，也不依赖 WorkBuddy 自动化调度。**

## 1. 任务总表

| 任务 | 节奏 | 脚本 | 外部副作用 | 判重 / 状态 | 日志 |
|---|---|---|---|---|---|
| 我的网盘.资源推送 Telegram 频道 | 每小时 `:03` | `push/telegram/tg-post.mjs` | 发帖到 `@myquark` | `state/telegram-posts/posted.json` | `~/.cache/wdp-tg-post.log` |
| 我的网盘.资源推送到 Bluesky | 每小时 `:05` | `push/bluesky/bluesky-post.mjs` | 发帖到 Bluesky | `state/bluesky-posts/posted.json` | `~/.cache/wdp-bsky-post.log` |
| 我的网盘.夸克分享每日补充更新 | 每天 `16:10` | `tools/quark-cron/share-update.mjs` | 夸克 `saveas-update` 增量转存 | 夸克接口返回的更新清单 | `~/.cache/quark-sync/share-cron.log` |
| 我的网盘.夸克预存资源搬运 | 每天 `01:40` | `tools/quark-cron/prestore-move.mjs` | 夸克 `move` 目录搬运 | 源/目标目录名实时归一化比对 | `~/.cache/quark-sync/move-cron.log` |

共同原则：

1. 凭据只在运行机本地、权限 `600`，**不进 git**，也不写进本文。
2. `posted.json` 留在仓库工作区但已从 git 取消跟踪；删掉会重复发帖。
3. 夸克中间产物只落 `~/.cache/quark-sync/`，可随时清理，不影响判重。
4. 所有 cron 用标记块管理，幂等替换，不碰块外条目。
5. 任何任务都不写 `data/*.yaml`、不 build、不 ssh；两条夸克任务互不发帖，两条推送任务不碰网盘。

## 2. 环境与凭据

### 2.1 系统依赖

```bash
sudo apt-get install -y nodejs npm cron
cd /home/marco/Documents/Github/wodewangpan
npm install --omit=dev --no-audit --no-fund
sudo systemctl enable --now cron
```

要求 Node >= 18（现为 v20.19.2）；cron 需 `active`。

### 2.2 凭据清单

| 文件 | 内容（键名） | 用途 |
|---|---|---|
| `~/.config/wodewangpan-tg.env` | `TG_BOT_TOKEN` / `TG_CHAT` / `REPO` / `SITE_URL` | Telegram 发帖 |
| `~/.config/wodewangpan-bluesky.env` | `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` / `REPO` / `SITE_URL` | Bluesky 发帖 |
| `~/.config/wodewangpan-feishu.env` | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_TO` | 两条夸克任务的飞书简报卡 |
| `~/.workbuddy/skills/quarkclouddrive/workbuddy/config.json` | 夸克登录态 | 两条夸克任务共用，**绝不进 git** |

全部权限 `600`。推送脚本会先找自身同目录的 `*.env`（临时覆盖），再找 `~/.config/`；**不再读 `~/.workbuddy/*.env`**。

### 2.3 夸克 skill

安装在 `~/.workbuddy/skills/quarkclouddrive`（官方 zip 1.0.25），可用 `QK_SKILL_DIR` 覆盖。登录态在该目录下 `workbuddy/config.json`。
编排脚本会给 CLI 注入 `WORKBUDDY_CONFIG_DIR` 等环境变量，那只是 CLI 的 Agent 环境守卫要求，不是启动 LLM / 调度器。

### 2.4 飞书直发

`tools/feishu-reports/feishu-api.mjs` 是发卡唯一实现，走飞书开放 API（tenant_access_token → im/v1/messages），**不依赖 lark-cli / WorkBuddy**。
接收人取 `~/.config/wodewangpan-feishu.env` 的 `FEISHU_TO`，内置默认 open_id 仅作兜底。

### 2.5 缓存与状态目录

- `~/.cache/quark-sync/`：`candidates.json`、`results.json`、`verify.json`、`share-update-card-*.json`、`prestore-move-*.md`、两条 cron 日志。可用 `QK_CACHE_DIR` 覆盖。
- `state/telegram-posts/posted.json`、`state/bluesky-posts/posted.json`：判重唯一依据，已从 git 取消跟踪。

## 3. crontab 全文

```cron
# >>> wdp-push (managed, 勿手改)
PATH=/usr/bin:/bin
3 * * * * cd /home/marco/Documents/Github/wodewangpan && /usr/bin/node push/telegram/tg-post.mjs >> /home/marco/.cache/wdp-tg-post.log 2>&1
5 * * * * cd /home/marco/Documents/Github/wodewangpan && /usr/bin/node push/bluesky/bluesky-post.mjs >> /home/marco/.cache/wdp-bsky-post.log 2>&1
# <<< wdp-push
# >>> wdp-quark BEGIN (managed, 勿手改)
10 16 * * * cd /home/marco/Documents/Github/wodewangpan && QK_CACHE_DIR=/home/marco/.cache/quark-sync /usr/bin/node tools/quark-cron/share-update.mjs >> /home/marco/.cache/quark-sync/share-cron.log 2>&1
# <<< wdp-quark END
# >>> wdp-move BEGIN (managed, 勿手改)
40 1 * * * cd /home/marco/Documents/Github/wodewangpan && QK_CACHE_DIR=/home/marco/.cache/quark-sync /usr/bin/node tools/quark-cron/prestore-move.mjs >> /home/marco/.cache/quark-sync/move-cron.log 2>&1
# <<< wdp-move END
```

- `wdp-push` 块由人工按上面全文维护（`crontab -e`）。
- 两条夸克 cron 用仓库脚本幂等安装：

```bash
bash deploy/install-quark-cron.sh            # 安装/刷新，只覆盖 wdp-quark / wdp-move 两个块
bash deploy/install-quark-cron.sh uninstall  # 只卸这两条，保留 wdp-push
crontab -l
```

## 4. Telegram / Bluesky 推送

### 4.1 行为

- 每轮各发 1 条，按 `added` 最新优先选片。
- 链接展示：有什么网盘链接就发什么（夸克/百度/光鸭/阿里/天翼/UC/迅雷/115/移动，以及任意 `*_url` 分享字段），非分享字段除外；光鸭等链接**会发**。
- 判重只认夸克/百度链接（任一相同即同一份），其他链接**会发但不参与判重**；两条链接都空按 id 判重；标题相同但链接不同照发。
- 发送成功后写 `posted.json`；**失败不写状态**，下一轮会自动重试同一条。
- TG 偶发 `fetch failed / other side closed` 多为网络抖动，不是配置问题；`--check` 可验 token 与频道管理员权限。

### 4.2 自检

```bash
node push/telegram/tg-post.mjs --dry       # 只看文案（不需要 token）
node push/telegram/tg-post.mjs --check     # 验 token + @myquark 权限
node push/bluesky/bluesky-post.mjs --dry
```

### 4.3 运维

```bash
tail -f ~/.cache/wdp-tg-post.log ~/.cache/wdp-bsky-post.log
python3 -c "import json;print(len(json.load(open('state/telegram-posts/posted.json'))['posted']))"
```

判重文件不要拷贝、不要提交、不要删除；换机迁移要用现网最新那份，否则会重复发帖。

## 5. 夸克分享每日补充更新（16:10）

原 LLM prompt 里的判断已固化进 `tools/quark-cron/share-update.mjs`。流程：验登录 → 翻页拉更新清单并按 `share_url` 去重 → 逐条 `saveas-update` 增量转存 → `get-share-saved-dir` 核验是否补进历史目录 → 生成 payload → 飞书蓝卡。

### 5.1 分级验证

```bash
node tools/quark-cron/share-update.mjs --dry       # 只拉清单，不转存、不发卡
node tools/quark-cron/share-update.mjs --no-send   # 真转存 + 生成 payload，但不发卡
node tools/quark-cron/share-update.mjs             # 正式（cron 自动跑）
```

`--no-send` 后看 `~/.cache/quark-sync/share-update-card-*.json`：`dirs` 应是补进历史目录的条目，`skipped` 应是失败或疑似新建目录的条目。判据不对不要启用 cron。

### 5.2 红线

- 唯一网盘写操作是 `saveas-update` 往该链接**上次转存的已有目录**补新增文件；不 `create-folder`、不 `move`、不首次 `saveas`、不删不改目录、不碰「预存资源」。
- 疑似新建目录只进卡片 `skipped` 上报人工，脚本不自行清理。
- 0 条更新静默退出，不发卡；有新增成功或异常才发一张蓝卡。
- `saveas-update` 成功不重试；确定性失败码 `41043` / `41040` / `41006` / `41009` / `41031` 不重试；其余瞬时错误最多重试 1 次。
- 卡片 `msg` 原样展示，不改写、不概括、不加前后缀。

## 6. 夸克预存资源搬运（01:40）

把「预存资源」下 9 个分类目录的资源目录，每类随机挑 1 个，搬到「SHARE」下对应分类；先按目录名归一化查重，重复跳过。

9 对目录固定为：`001游戏→01游戏`、`002应用→02应用`、`003电视剧→03电视剧`、`004电影→04电影`、`005动漫→05动漫`、`006纪录片→06纪录片`、`007课程→07课程`、`008电子书→08电子书`、`0010其他→010其他`。

### 6.1 分级验证

```bash
node tools/quark-cron/prestore-move.mjs --dry      # 验登录/根目录/9 对分类/查重选片，不 move、不发卡
node tools/quark-cron/prestore-move.mjs --no-send  # 真 move，但不发卡
node tools/quark-cron/prestore-move.mjs            # 正式（cron 自动跑）
```

`--dry` 正常输出：`[登录] OK`、`[根目录] 预存资源=… SHARE=…`、`[分类] 解析完成：9/9 对齐全`；每次随机结果不同属正常。

### 6.2 红线

- 只处理上述 9 对目录，不新建任何目录、不动其它目录；除 `move` 外不做任何增删改，**绝不删除、覆盖、改名**。
- 源只取文件夹（category 0），不搬散文件；新候选为空则跳过，不补挑、不换分类。
- 每类最多搬 1 个，9 类合计最多 9 个；随机用 `crypto.randomInt`。
- 每次 `search` + `browse` 实时按名解析 fid，不硬编码；查重按归一化目录名（去编号前缀/括号/空格/大小写），保守视为重复。
- move 失败只记录、最多重试 1 次，继续下一类，不回滚；每类单独一次 `move <fid> --target-fid <该类TARGET_FID>`。
- 唯一额外动作是发一张蓝卡；推送失败最多重试 1 次，不因推送失败回滚搬运；每轮必发卡。
- CLI 的 `notice.text` 只进本地简报、原样展示，不写进飞书卡。

## 7. 故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 夸克报「无法识别当前 Agent 环境」 | 裸跑 CLI 缺 env | 用编排脚本跑（已内置注入）；裸跑需带 `WORKBUDDY_CONFIG_DIR` |
| 预存搬运报「服务器内部异常{0}」 | 夸克 `search` 偶发抖动 | `findRoot()` 已内置最多重试 1 次；仍失败再手动重跑 |
| 夸克报未登录 / `-103` | 登录态缺失或 cookie 过期 | 重新授权或 scp `workbuddy/config.json`；脚本不会启动登录流程 |
| TG 报 `fetch failed / other side closed` | 网络抖动 | 失败不写状态，下轮自动重试；`--check` 验权限 |
| 飞书发送失败 | 凭据缺失 / app 配错 / 网络 | 检查 `~/.config/wodewangpan-feishu.env` 三个键与权限 600 |
| 重复发帖 | 判重文件被删或跨机复制 | 用现网最新 `posted.json` 恢复；不要两端同时跑 |
| 同一资源被转存/搬运两次 | LLM 版与 cron 版同时启用 | 必须二选一，见第 8 节 |

## 8. 回退与互斥

- 推送任务：不要同时启用 WorkBuddy 自动化与这套 cron，否则每小时双发。
- 夸克任务：`bash deploy/install-quark-cron.sh uninstall` 卸掉两条 cron 后，才能把旧 WorkBuddy 自动化从 PAUSED 恢复；两边同时开会对同一链接/目录各操作一次。
- 卸载推送 cron：`crontab -e` 删除 `wdp-push` 标记块整段；不要误删另外两个夸克块。

## 9. 脚本权威源

| 用途 | 仓库路径 |
|---|---|
| TG 推送 | `push/telegram/tg-post.mjs` |
| Bluesky 推送 | `push/bluesky/bluesky-post.mjs` |
| 推送共享流水线 / 状态路径 | `push/common.mjs` |
| 分享补存编排 | `tools/quark-cron/share-update.mjs` |
| 预存搬运编排 | `tools/quark-cron/prestore-move.mjs` |
| 飞书卡片直发（唯一实现） | `tools/feishu-reports/feishu-api.mjs` |
| 飞书卡片（补存 / 搬运） | `tools/feishu-reports/wodewangpan-{share-update,move}-feishu.mjs` |
| 夸克 cron 幂等安装 | `deploy/install-quark-cron.sh` |

改脚本一律改仓库版并 `git pull` 到运行机，不要在 `~/` 留副本。
