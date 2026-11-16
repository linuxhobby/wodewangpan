# Debian 13：用 cron 跑 TG / Bluesky 资源推送（去 LLM 化部署手册）

> 记录：2026-11-17。目标是把「我的网盘」两条社媒推送从 WorkBuddy 自动化任务迁到一台常开的 Debian 13 主机，
> 全程只跑 Node 脚本 + 系统 crontab，不依赖 LLM，也不需要 WorkBuddy 客户端常驻。
> 本文只写运维方法，不含任何凭据值；文中 `<USER>` / `<DEBIAN_IP>` / 路径前缀按实际环境替换。

## 1. 可行性结论与边界

- WorkBuddy 的自动化任务只是「一张调度单 + 一段 prompt」，真正干活的是 `mybot/push/` 下的 Node 脚本、
  `wodewangpan` 的 `data/*.yaml` 与海报、两个 `.env` 凭据、以及 `posted.json` 判重状态。
  **只复制任务定义 = 每小时准时报两次错**，必须连脚本、数据、凭据、状态一起迁移。
- 脚本本身基本跨平台：凭据和判重状态都按 `os.homedir()/.workbuddy` 定位，Linux 天然兼容；
  唯一写死的 Windows 路径是 `push/common.mjs` 里的 `DEFAULT_REPO`，但两个 `.env` 都带 `REPO=` 键，
  **改 env 一行即可，不用改代码**。
- 传输层：TG 走 Node 内置 `fetch`；Bluesky 优先 spawn `curl`、失败自动退回 `fetch`。Debian 上两者都能直连，
  比 Windows 沙箱环境更顺。
- 原调度是每小时 `:08` 发 TG、`:09` 发 Bluesky（`FREQ=HOURLY;INTERVAL=1;BYMINUTE=8/9`）。
  时区偏移是整小时，**UTC 与 Asia/Shanghai 的触发时刻完全一致**，整机时区只影响日志时间戳，不必为此改时区。

### 最重要的一条

`~/.workbuddy/telegram-posts/posted.json` 与 `~/.workbuddy/bluesky-posts/posted.json` 是判重的**唯一权威**，
而且每台机器各写各的。所以：

- 新机从空状态起跑 → 会把全站历史库存重新发一遍；
- 新旧两台同时 ACTIVE → 必然重复发帖刷屏。

**迁移必须先停旧机、再导状态、最后启新机**，顺序不能颠倒。

## 2. 前置条件

| 项 | 要求 |
|---|---|
| 主机 | Debian 13，常开，能直连 `api.telegram.org` / `bsky.social` |
| 运行时 | Node.js ≥ 18、npm、cron（`sudo apt install -y nodejs npm cron`） |
| 代码 | `mybot`（含 `push/`）与 `wodewangpan`（含 `data/`、`static/images/`）已同步到本机 |
| 凭据 | `push/telegram/wodewangpan-tg.env`、`push/bluesky/wodewangpan-bluesky.env`（含 token，**不要进 git、不要写进文档**） |
| 判重状态 | 旧机 `~/.workbuddy/{telegram-posts,bluesky-posts}/posted.json` 两份快照 |
| 依赖 | `wodewangpan/node_modules` 里有 `js-yaml`、`qrcode`（`sharp` 可选）；脚本从站点仓库里加载它们 |

`mybot` 与 `wodewangpan` 是两个独立目录，下面的命令用这两个变量：

```bash
MYBOT=/home/<USER>/Github/mybot
SITE=/home/<USER>/Github/wodewangpan
```

> 若旧机代码有**未提交改动**，`git pull` 拉到的是旧版脚本（推送文案 / 选片策略会不一致）。
> 先在新机比对 `push/common.mjs`、`push/telegram/tg-post.mjs`、`push/bluesky/bluesky-post.mjs` 的 md5，
> 不一致就用旧机的最新副本覆盖，再继续。

## 3. 操作步骤（顺序固定）

### 3.1 停旧机，冻结状态

把旧机（Windows）上两条 WorkBuddy 自动化任务置为 **PAUSED**。冻结后再导出两份 `posted.json`，
保证快照之后没有任何增量写入。旧机暂停期间会断更几小时，属正常，比双发安全。

### 3.2 把状态快照传到新机

```bash
# 在旧机执行（Git Bash 用 /c/... 路径；也可换成任意同步通道）
scp -r <旧机上 wdp-debian 目录> <USER>@<DEBIAN_IP>:~/wdp-debian
```

`state/` 结构必须是：

```
state/
├── telegram-posts/posted.json
└── bluesky-posts/posted.json
```

> `posted.json` 本来就在 home 下、且被 `.gitignore` 排除，**git 同步一定带不过来**，必须单独传。
> 这份快照只是传输用；导入后新机 `~/.workbuddy/` 下的那一份才是权威，
> 不要让双向同步软件把旧快照反向覆盖回去。

### 3.3 新机装系统依赖、对齐脚本版本

```bash
sudo apt install -y nodejs npm cron
sudo systemctl enable --now cron
cd "$MYBOT" && md5sum -c ~/wdp-debian/CHECKSUMS    # 出现 FAILED 就用旧机最新副本覆盖 push/
```

`CHECKSUMS` 里是相对 `mybot/` 的三个脚本 md5；也可以直接把旧机的 `latest/push/` 整个覆盖过去。

### 3.4 跑部署脚本

把本文附录的脚本存成 `~/wdp-debian/install.sh`，然后：

```bash
bash ~/wdp-debian/install.sh "$MYBOT" "$SITE" ~/wdp-debian/state
```

三个参数分别是 mybot 目录、wodewangpan 目录、状态快照目录；不传就用默认值
`$HOME/Github/mybot`、`$HOME/Github/wodewangpan`、脚本同目录的 `state/`。

脚本会依次：校验 Node/路径 → 补装 `js-yaml`/`qrcode` → 把两个 `.env` 的 `REPO=` 改成新机路径
（其余原样、权限 600、不打印内容）→ 导入判重状态（**缺了直接拒绝部署**）→ 跑两次 `--dry` 自检
（不登录、不发送、不写状态）→ 用标记块写入用户 crontab（不动已有条目）。

### 3.5 验证

```bash
crontab -l | grep -A3 'wdp-push'
cd "$MYBOT" && node push/telegram/tg-post.mjs --check   # 只验 token 与频道权限，不发帖
tail -f ~/.workbuddy/logs/tg-post.log ~/.workbuddy/logs/bsky-post.log
```

`--check` 通过、`:08` / `:09` 的日志里出现成功回显即可收工。若想立刻验一条真实发帖，
手动跑一次不带参数的脚本即可（**会真的发一条**），别同时跑两次。

## 4. 关键坑速查

| 坑 | 后果 | 处理 |
|---|---|---|
| 判重状态没搬 / 搬错 | 全站历史库存重发 | 导入旧机 `posted.json`；脚本检测到缺失会直接退出 |
| 新旧机同时 ACTIVE | 每小时双发 | 旧机先 PAUSED，确认新机正常再决定要不要删 |
| `.env` 里 `REPO=` 仍是旧机路径 | 读不到 `data/`，`--dry` 自检失败 | 部署脚本自动改；手动改时值用 `/home/...` 正斜杠 |
| `.env` 带 CRLF | token 尾部多 `\r`，401 | 部署脚本会 `tr -d '\r'`；手工传文件后注意行尾 |
| 站点仓库 `node_modules` 没装 | `qrcode` / `js-yaml` 加载失败 | 在 `SITE` 下 `npm install --omit=dev` |
| git 同步漏掉旧机未提交改动 | 跑旧版文案 / 选片逻辑 | 比对 md5，用最新副本覆盖 |
| cron 服务没起 / 用 root 跑 | 不触发，或状态写到 `/root/.workbuddy` | `systemctl enable --now cron`；安装与运行必须是同一个用户 |
| 双向同步把 `state/` 反向覆盖 | 判重状态回退，重复发 | 导入后把传输目录移出同步范围或设为只读 |

## 5. 日常运维

```bash
# 看日志
tail -f ~/.workbuddy/logs/tg-post.log ~/.workbuddy/logs/bsky-post.log

# 手动补发一条（脚本自带判重，不会重发已发过的）
cd "$MYBOT" && node push/bluesky/bluesky-post.mjs

# 只预览不发送（不登录、不写状态）
cd "$MYBOT" && node push/telegram/tg-post.mjs --dry

# 卸载 cron 条目（保留脚本与状态）
crontab -l | sed '/wdp-push BEGIN/,/wdp-push END/d' | crontab -
```

- 脚本每次只发 1 条，内部已对 429 做退避重试；失败不额外加重试，避免连发。
- 日志是追加写，长期跑会变大，按需 `truncate -s 0 <log>` 或自行配 logrotate。
- 建议整机设 `Asia/Shanghai` 便于看日志时间戳；**不改也不影响这两个 HOURLY 任务的触发时刻**。

## 6. 回退

新机跑不通时：

```bash
crontab -l | sed '/wdp-push BEGIN/,/wdp-push END/d' | crontab -   # 先停新机
```

再把旧机两条自动化任务恢复 ACTIVE。**注意**：如果新机已经成功发出过条目，
要把新机 `~/.workbuddy/*-posts/posted.json` 回传给旧机，否则旧机会重发那几条。

## 7. 附录：install.sh 全文

保存为 `install.sh`，用法 `bash install.sh [mybot目录] [wodewangpan目录] [state目录]`。

```bash
#!/usr/bin/env bash
# Debian 13 | 我的网盘 TG / Bluesky 推送：纯 crontab 调度，不依赖 WorkBuddy 自动化 / LLM
#
# 用法（在 Debian 上、以运行推送的那个用户身份执行）：
#   bash install.sh [mybot目录] [wodewangpan目录] [state快照目录]
# 默认：$HOME/Github/mybot、$HOME/Github/wodewangpan、脚本同目录的 state/
#
# 前置：mybot + wodewangpan 已同步；state/ 已带过来；Windows 侧两个自动化任务已停。
set -euo pipefail

MYBOT="$(realpath "${1:-$HOME/Github/mybot}")"
SITE="$(realpath "${2:-$HOME/Github/wodewangpan}")"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_SRC="${3:-$SELF_DIR/state}"
WB="$HOME/.workbuddy"
LOG="$WB/logs"

say() { printf '%s\n' "$*"; }
die() { printf 'X %s\n' "$*" >&2; exit 1; }

NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "找不到 node。Debian: sudo apt install -y nodejs npm（需 >= 18）"
NODE_VER="$("$NODE" -p 'process.versions.node')"
[ "${NODE_VER%%.*}" -ge 18 ] || die "Node 版本过低 ($NODE_VER)，需要 >= 18"

[ -f "$MYBOT/push/common.mjs" ] && [ -f "$MYBOT/push/telegram/tg-post.mjs" ] && [ -f "$MYBOT/push/bluesky/bluesky-post.mjs" ] \
  || die "mybot 路径不对：$MYBOT。请用第 1 个参数指定含 push/ 的目录"
[ -d "$SITE/data" ] || die "wodewangpan 路径不对：$SITE（缺 data/）。请用第 2 个参数指定"
command -v crontab >/dev/null || die "缺 cron。Debian: sudo apt install -y cron && sudo systemctl enable --now cron"

say "==> 检查通过  node=$NODE_VER"
say "    mybot = $MYBOT"
say "    site  = $SITE"

# 1. 站点依赖：脚本从 REPO/node_modules 里加载 qrcode / js-yaml
if [ ! -f "$SITE/node_modules/js-yaml/package.json" ] || [ ! -f "$SITE/node_modules/qrcode/package.json" ]; then
  say "==> 安装站点依赖 js-yaml / qrcode（sharp 为可选）"
  (cd "$SITE" && npm install --omit=dev --no-audit --no-fund) || die "npm install 失败"
else
  say "==> 依赖已存在，跳过 npm install"
fi

# 2. 凭据：只把 REPO 改成 Debian 路径，其余原样；顺手清掉同步可能带进来的 CR
fix_env() {
  local f="$1" tmp
  [ -f "$f" ] || die "缺凭据 $f —— .env 没同步过来？不要继续，否则发帖会 401"
  tmp="$(mktemp)"
  tr -d '\r' < "$f" | awk -v r="$SITE" '/^REPO[[:space:]]*=/{print "REPO=" r; next} {print}' > "$tmp"
  grep -q '^REPO=' "$tmp" || printf 'REPO=%s\n' "$SITE" >> "$tmp"
  mv "$tmp" "$f"
  chmod 600 "$f"
}
fix_env "$MYBOT/push/telegram/wodewangpan-tg.env"
fix_env "$MYBOT/push/bluesky/wodewangpan-bluesky.env"
say "==> 两个 .env 的 REPO 已指向 $SITE，权限 600（内容未打印）"

# 3. 判重状态：唯一权威。缺了会把全站历史库存重发一遍，所以缺就拒绝部署
mkdir -p "$WB/telegram-posts" "$WB/bluesky-posts" "$LOG"
install_state() {
  local n="$1" dst="$WB/$1/posted.json" src="$STATE_SRC/$1/posted.json"
  if [ -f "$dst" ]; then
    say "    保留现有 $dst"
  elif [ -f "$src" ]; then
    cp "$src" "$dst" && chmod 600 "$dst"
    say "    导入 $src"
  else
    die "缺判重状态 $dst，快照里也没有。请把 Windows 的 ~/.workbuddy/$1/posted.json 拷到 $STATE_SRC/$1/ 后重试；否则会把历史全部重发。"
  fi
}
install_state telegram-posts
install_state bluesky-posts

# 4. 自检：--dry 不登录、不发送、不写判重
say "==> 自检 --dry（只选片渲染，不发帖、不写状态）"
(cd "$MYBOT" && "$NODE" push/telegram/tg-post.mjs --dry 2>&1 | tail -n 8) || die "TG --dry 失败，检查 REPO / data / 依赖"
(cd "$MYBOT" && "$NODE" push/bluesky/bluesky-post.mjs --dry 2>&1 | tail -n 8) || die "Bluesky --dry 失败，检查 REPO / data / 依赖"

# 5. 写 crontab：用标记块替换，不动用户已有条目
B="# >>> wdp-push"
E="# <<< wdp-push"
tmp="$(mktemp)"
crontab -l 2>/dev/null | sed "/$B/,/$E/d" > "$tmp" || true
{
  echo "$B BEGIN (managed by install.sh, 勿手改)"
  echo "8 * * * * cd $MYBOT && $NODE push/telegram/tg-post.mjs >> $LOG/tg-post.log 2>&1"
  echo "9 * * * * cd $MYBOT && $NODE push/bluesky/bluesky-post.mjs >> $LOG/bsky-post.log 2>&1"
  echo "$E END"
} >> "$tmp"
crontab "$tmp"
rm -f "$tmp"

if command -v systemctl >/dev/null && ! systemctl is-active cron >/dev/null 2>&1; then
  say "!! cron 服务未运行，执行：sudo systemctl enable --now cron"
fi

say ""
say "==> 部署完成。当前推送条目："
crontab -l | sed -n "/$B/,/$E/p"
say ""
say "日志： tail -f $LOG/tg-post.log $LOG/bsky-post.log"
say "卸载： crontab -l | sed '/wdp-push BEGIN/,/wdp-push END/d' | crontab -"
say "备注：HOURLY 任务每分钟数固定，整机时区不影响触发频率，只影响日志时间戳。"
```
