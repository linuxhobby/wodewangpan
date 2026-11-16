# Debian 13：夸克预存资源搬运迁移（去 LLM 化部署手册）

> 记录：2026-11-17。对应 WorkBuddy 自动化任务「我的网盘.夸克预存资源搬运」（id `9221f42f-52e7-487b-b452-4633d6f9eb59`）。
> 目标是迁到一台常开的 Debian 13 主机，用 cron 直跑编排脚本，不依赖 LLM / WorkBuddy 自动化调度器。
> 与 `DEPLOY-DEBIAN-QUARK.md`（分享每日补存）同源不同流程：那是增量转存，这是分类目录间搬运 + 查重 + 随机挑。
> 本文不含任何凭据值；`<USER>` / `<DEBIAN_IP>` 按实际替换。

## 1. 这个任务做什么 / 和另一个夸克任务的区别

把根目录「预存资源」下 9 个分类目录里的资源目录，**每类随机挑 1 个**，搬到根目录「SHARE」下对应分类目录。先按目录名查重，重复的跳过、不重复才搬。搬完向飞书推一张蓝色简报卡。

| | 夸克分享补存（DEPLOY-DEBIAN-QUARK） | 本任务（预存资源搬运） |
|---|---|---|
| 网盘写操作 | `saveas-update` 增量转存 | `move` 目录搬运 |
| 判重依据 | 分享更新清单 | 源/目标两侧目录名归一化比对 |
| 选片 | 全量处理 | 每类 `crypto.randomInt` 真随机挑 1 个 |
| 调度 | 每天 17:20 | 原 `FREQ=HOURLY;INTERVAL=22`（约每天一次） |
| 定时任务现状 | 已迁走 | 当前 PAUSED（迁移前已暂停） |

原 prompt 里的判断（按名解析 fid、归一化查重、随机挑、失败重试、状态判定）此前由 LLM 现场做。迁移方案把这些**固化进一个自包含编排脚本** `prestore-move-cron.mjs`（附录全文），cron 直跑，无需 LLM。

## 2. 依赖清单（必须全部搬到 Debian）

| 依赖 | 本机路径 | Debian 默认路径 | 说明 |
|---|---|---|---|
| 编排脚本 | 本文附录 | `~/prestore-move-cron.mjs` | 固化了原 prompt 的全部判断逻辑 |
| quarkclouddrive CLI + 登录态 | `~/.workbuddy/skills/quarkclouddrive/` | 同（可用 `QK_SKILL_DIR` 覆盖） | 与补存任务**共用同一份**，只需传一次；含 `scripts/quark-drive.cjs` 与 `workbuddy/config.json`（cookie，敏感，绝不进 git） |
| 飞书卡片脚本 | `C:/Users/marco/Scripts/wodewangpan-move-feishu.mjs` | `~/Scripts/...`（可用 `QK_FEISHU_SCRIPT` 覆盖） | 接收人内置，不要改；蓝色 header、默认标题「我的网盘.预存资源搬运简报」 |
| lark-cli 绑定 | WorkBuddy 的 lark-cli | 同机 WorkBuddy | 脚本走 `~/.workbuddy/binaries/.../@larksuite/cli/scripts/run.js`，当前绑定应用须为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 中间简报目录 | `~/.workbuddy/quark-sync-cache/` | 同（可用 `QK_CACHE_DIR` 覆盖） | 脚本自建，落 `prestore-move-*.md` |

> 若补存任务已迁到同一台 Debian，`quarkclouddrive` skill 和 lark-cli 绑定都已就位，**本任务不用再传这两样**，只需单独传 `wodewangpan-move-feishu.mjs` 和本编排脚本。

## 3. 操作步骤（顺序固定）

### 3.1 停旧机

Windows 侧「我的网盘.夸克预存资源搬运」当前已是 PAUSED，无需再动。确认没有残留进程在跑 CLI。

### 3.2 搬依赖到 Debian

```bash
# 在旧机执行（Git Bash 用 /c/... 路径）。登录态含 cookie，走 scp，绝不进任何 git 仓库
# 若同机已迁过补存任务，下面第 1 条可跳过
scp -r /c/Users/marco/.workbuddy/skills/quarkclouddrive <USER>@<DEBIAN_IP>:~/.workbuddy/skills/
scp /c/Users/marco/Scripts/wodewangpan-move-feishu.mjs <USER>@<DEBIAN_IP>:~/Scripts/
scp /c/Users/marco/WorkBuddy/2026-11-17-04-15-52/wdp-debian/prestore-move-cron.mjs <USER>@<DEBIAN_IP>:~/
```

> 若 Debian 上 `~/.workbuddy/skills/` 已有其它 skill，**只覆盖 quarkclouddrive 这一个目录**，别整目录替换。

### 3.3 Debian 上装依赖、确认飞书通道

```bash
sudo apt install -y nodejs cron                 # Node >= 18
sudo systemctl enable --now cron
cd ~ && node --check prestore-move-cron.mjs     # 脚本语法自检
ls ~/.workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/scripts/run.js
```

飞书脚本自检（不发送，只打印卡片 JSON）：

```bash
node ~/Scripts/wodewangpan-move-feishu.mjs --names "[01游戏] 自检" --status 成功 --dry-run
```

### 3.4 分级验证（dry → no-send → 正式）

```bash
# 1) dry：验登录/根目录/9 对分类解析/查重选片，不 move、不发卡（最安全的自检，可反复跑）
node ~/prestore-move-cron.mjs --dry

# 2) no-send：照常随机挑 + 真 move，但不发飞书卡（想先看搬运结果落盘再发卡时用）
node ~/prestore-move-cron.mjs --no-send

# 3) 正式：cron 自动跑；也可先手动跑一次确认卡片
node ~/prestore-move-cron.mjs
```

`--dry` 输出要点：
- `[登录] OK`、`[根目录] 预存资源=… SHARE=…`、`[分类] 解析完成：9/9 对齐全`
- 每类一行 `[dry] 会搬 [目标分类] 目录名（新候选 N / 源 M）`，或 `[跳过] …`
- 每次随机结果不同属正常（真随机）；末尾简报标注「dry 预演，未落库」

### 3.5 写入 crontab

原任务是 `FREQ=HOURLY;INTERVAL=22`（约每 22 小时一次）。cron 的 `*/22` 在 0 点和 22 点触发，**间隔为 22h/2h 交替**，与「每 22 小时」不完全一致。两种取舍：

- **推荐**：固定每天一次（如 17:40，避开补存任务的 17:20），简单可预测：
  ```
  40 17 * * * ...
  ```
- 追求贴近原节奏：用 systemd timer 的 `OnUnitActiveSec=22h`（本文不展开）。

用标记块写入，不动已有条目（补存任务的 `wdp-quark` 块保留）：

```bash
CRON_BIN="$(command -v node)"
( crontab -l 2>/dev/null | sed '/# >>> wdp-move/,/# <<< wdp-move/d'; cat <<EOF
# >>> wdp-move BEGIN (managed, 勿手改)
40 17 * * * cd ~ && $CRON_BIN ~/prestore-move-cron.mjs >> ~/.workbuddy/quark-sync-cache/move-cron.log 2>&1
# <<< wdp-move END
EOF
) | crontab -
crontab -l | grep -A2 wdp-move
```

## 4. 关键坑速查

| 坑 | 后果 | 处理 |
|---|---|---|
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
cd ~ && node prestore-move-cron.mjs

# 只看不写（推荐日常自检）
cd ~ && node prestore-move-cron.mjs --dry

# 看最近本地简报
ls -t ~/.workbuddy/quark-sync-cache/prestore-move-*.md | head -3

# 卸载本任务 cron（保留补存任务的 wdp-quark 块）
crontab -l | sed '/# >>> wdp-move/,/# <<< wdp-move/d' | crontab -
```

状态判定（进卡片底部 note）：全部 9 类成功=成功，有成功也有跳过/失败=部分成功，全无可搬=跳过，全部尝试失败=失败，未登录=未授权，根目录找不到=目录未找到。跳过/异常分类带标签记入卡片「跳过的分类」段。

## 7. 回退

临时切回 LLM 版：删掉 wdp-move 的 cron 块，把原自动化任务从 PAUSED 恢复 ACTIVE 即可。
两边**不要同时启用**：同一资源目录会被两条链路各搬一次，第二次必然搬空或搬错。

## 8. 附录：prestore-move-cron.mjs 全文

保存为 `~/prestore-move-cron.mjs`（脚本用 `os.homedir()` 解析路径，勿改回绝对路径）。

```js
#!/usr/bin/env node
/**
 * 我的网盘.夸克预存资源搬运 —— Debian cron 自包含编排脚本
 *
 * 把原 WorkBuddy 自动化 prompt 的判断逻辑固化为代码，纯 node + quark-drive CLI，不依赖 LLM。
 * 流程：验登录 → 定位「预存资源」/「SHARE」根目录 → 实时按名解析 9 对分类目录 fid →
 *       每类 browse 两侧、归一化查重、crypto 真随机挑 1 个 → 逐类 move（重试 1 次）→
 *       本地简报 + 蓝色飞书卡片。
 *
 * 用法：
 *   node prestore-move-cron.mjs --dry       # 验登录/根目录/分类解析/查重选片，不 move、不发卡
 *   node prestore-move-cron.mjs --no-send   # 照常 move，但不发飞书卡（联调用）
 *   node prestore-move-cron.mjs             # 正式：move + 发卡
 *
 * 环境变量（Debian 上按需覆盖，默认走 HOME 动态解析）：
 *   QK_SKILL_DIR       quarkclouddrive skill 根目录，默认 ~/.workbuddy/skills/quarkclouddrive
 *   QK_FEISHU_SCRIPT   飞书卡片脚本，默认 ~/Scripts/wodewangpan-move-feishu.mjs
 *   QK_CACHE_DIR       中间文件目录，默认 ~/.workbuddy/quark-sync-cache
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const SKILL = process.env.QK_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'quarkclouddrive');
const CLI = path.join(SKILL, 'scripts', 'quark-drive.cjs');
const FEISHU = process.env.QK_FEISHU_SCRIPT || path.join(HOME, 'Scripts', 'wodewangpan-move-feishu.mjs');
const CACHE = process.env.QK_CACHE_DIR || path.join(HOME, '.workbuddy', 'quark-sync-cache');
const LOGIN_STATE = path.join(SKILL, 'workbuddy', 'config.json');
const SI = '把预存资源各分类的资源目录各搬一个到SHARE对应分类目录，重复的跳过';

const DRY = process.argv.includes('--dry');
const NO_SEND = process.argv.includes('--no-send');
const p2 = (n) => String(n).padStart(2, '0');
const t0 = new Date();
const stamp = `${t0.getFullYear()}${p2(t0.getMonth() + 1)}${p2(t0.getDate())}-${p2(t0.getHours())}${p2(t0.getMinutes())}`;
const sid = `${t0.getTime()}-${crypto.randomBytes(3).toString('hex')}`;
fs.mkdirSync(CACHE, { recursive: true });

// 9 对分类映射（照抄原任务口径，禁止改名/改编号/补零；注意 0010→010）
const PAIRS = [
  ['001游戏', '01游戏'],
  ['002应用', '02应用'],
  ['003电视剧', '03电视剧'],
  ['004电影', '04电影'],
  ['005动漫', '05动漫'],
  ['006纪录片', '06纪录片'],
  ['007课程', '07课程'],
  ['008电子书', '08电子书'],
  ['0010其他', '010其他'],
];

const notices = new Set();
const log = (...a) => console.log(...a);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

// ---------- CLI 封装：统一带 session-input/session-id，cwd 固定在 skill 根目录 ----------
function cli(args, timeoutMs = 300000) {
  const r = spawnSync('node', [CLI, ...args, '--session-input', SI, '--session-id', sid], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, cwd: SKILL,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const rows = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    rows.push(o);
    if (o.type === 'result' && o.notice && o.notice.text) notices.add(o.notice.text);
  }
  return { rows, out, error: r.error ? String(r.error.message || r.error) : null, status: r.status };
}
const resultOf = (rows) => rows.filter((x) => x && x.type === 'result').pop() || null;
// artifact 行（或 --task-dir 时的 result 行）里的完整清单 jsonl 路径
const filePathOf = (rows) => {
  for (const x of rows) {
    if (x && x.data && typeof x.data.file_path === 'string' && x.data.file_path.endsWith('.jsonl')) return x.data.file_path;
  }
  return '';
};
// 读 jsonl 全量条目（每行一个 BrowseFileItem），这是 fid/目录名的唯一权威来源
function readJsonl(fp) {
  if (!fp) return [];
  try {
    return fs.readFileSync(fp, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
// browse 一个目录的全部直接子项（只读）
function browseDir(fid) {
  const c = cli(['browse', '--parent-fid', fid, '--all']);
  const res = resultOf(c.rows);
  if (c.error || (res && res.code !== 0)) return { items: [], error: c.error || (res && res.msg) || 'browse 无返回' };
  return { items: readJsonl(filePathOf(c.rows)), error: null };
}
// 按目录名精确匹配（只认文件夹 category 0）
const byName = (items, name) => items.find((x) => x && x.filename === name && Number(x.category) === 0) || null;

// 归一化判重：去中括号及内容、去前导编号前缀、去空格/全角空格、大小写归一
function norm(name) {
  let s = String(name || '');
  s = s.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '');
  s = s.replace(/^\s*\d+\s*[-－—]\s*/, '');
  s = s.replace(/[\s\u3000]/g, '');
  return s.toLowerCase();
}
// 飞书卡字段里禁止出现分隔符，避免被拆成多条
const clean = (s) => String(s == null ? '' : s).replace(/[｜|]/g, '/').trim();

// 发现根目录：search 定位 + 读 artifact 全量 + 精确匹配目录名
function findRoot(keyword) {
  const c = cli(['search', '--keyword', keyword, '--search-type', 'dir', '--stdout-only']);
  const res = resultOf(c.rows);
  if (c.error || (res && res.code !== 0)) return { dir: null, error: c.error || (res && res.msg) };
  const items = readJsonl(filePathOf(c.rows));
  const hit = byName(items, keyword) || items.find((x) => x && x.filename === keyword);
  return { dir: hit ? { fid: hit.fid, name: hit.filename } : null, error: null };
}

// 飞书蓝卡（接收人内置于脚本；最多重试 1 次；失败不回滚任何搬运）
function sendCard(names, status, skipped, detail) {
  if (!fs.existsSync(FEISHU)) { log('[飞书] 跳过：找不到脚本 ' + FEISHU); return false; }
  const args = [FEISHU, '--names', names, '--status', status];
  if (skipped) args.push('--skipped', skipped);
  if (detail) args.push('--detail', detail);
  const run = () => spawnSync('node', args, { encoding: 'utf8', timeout: 180000 });
  let s = run();
  if (s.status !== 0 && !s.error) s = run();
  if (s.status !== 0) { log('[飞书] ✗ 推送失败：' + String(s.stderr || s.stdout || s.error || '').slice(0, 500)); return false; }
  log(String(s.stdout || '').trim());
  return true;
}

// ---------- 前置检查 ----------
if (!fs.existsSync(CLI)) die(`找不到 CLI：${CLI}（quarkclouddrive skill 未装或路径不对，用 QK_SKILL_DIR 覆盖）`);
if (!fs.existsSync(LOGIN_STATE)) die(`找不到夸克登录态：${LOGIN_STATE}（请把本机 workbuddy/config.json 拷过来）`);

const who = cli(['get-user-info']);
const whoRes = resultOf(who.rows);
if (who.error || !whoRes || whoRes.code !== 0) {
  const reason = who.error || (whoRes && whoRes.msg) || '无返回';
  log('[登录] 失效：' + reason);
  if (!DRY && !NO_SEND) sendCard('夸克未授权，本轮跳过', '未授权', '', reason);
  die('夸克未授权，本轮结束（不启动登录流程、不反复重试）');
}
log('[登录] OK');

// ---------- 1. 定位两个根目录 ----------
const srcRoot = findRoot('预存资源');
const dstRoot = findRoot('SHARE');
if (srcRoot.error || dstRoot.error) die(`根目录定位失败：${srcRoot.error || dstRoot.error}`);
if (!srcRoot.dir || !dstRoot.dir) {
  const reason = !srcRoot.dir && !dstRoot.dir ? '源/目标根目录均未找到' : (!srcRoot.dir ? '源根目录「预存资源」未找到' : '目标根目录「SHARE」未找到');
  log('[根目录] ' + reason);
  if (!DRY && !NO_SEND) sendCard('源/目标根目录未找到，本轮未搬运', '目录未找到', '', reason);
  die(reason + '，本轮不乱建目录、不乱移');
}
log(`[根目录] 预存资源=${srcRoot.dir.name}  SHARE=${dstRoot.dir.name}`);

// ---------- 2. 实时按名解析 9 对分类目录 fid ----------
const srcTop = browseDir(srcRoot.dir.fid);
const dstTop = browseDir(dstRoot.dir.fid);
if (srcTop.error || dstTop.error) die(`根目录子项读取失败：${srcTop.error || dstTop.error}`);
const pairs = [];
for (const [sName, tName] of PAIRS) {
  const s = byName(srcTop.items, sName);
  const t = byName(dstTop.items, tName);
  if (!s || !t) {
    pairs.push({ sName, tName, missing: !s && !t ? `源「${sName}」+目标「${tName}」均缺失` : (!s ? `源分类「${sName}」缺失` : `目标分类「${tName}」缺失`) });
  } else {
    pairs.push({ sName, tName, sFid: s.fid, tFid: t.fid });
  }
}
log(`[分类] 解析完成：${pairs.filter((p) => !p.missing).length}/9 对齐全`);

// ---------- 3. 每类：两侧 browse → 归一化查重 → crypto 真随机挑 1 ----------
const moved = [];       // 成功：[目标分类名] 目录名
const dryPicks = [];     // dry 模式会搬的清单（仅展示）
const skipped = [];      // 跳过摘要（带分类标签）
let moveFail = 0;
for (const p of pairs) {
  if (p.missing) { skipped.push(`[${p.tName}] ${p.missing}`); log(`[跳过] ${p.sName}→${p.tName}：${p.missing}`); continue; }

  const src = browseDir(p.sFid);
  const dst = browseDir(p.tFid);
  if (src.error || dst.error) {
    const reason = `读取子项失败：${src.error || dst.error}`;
    skipped.push(`[${p.tName}] ${reason}`); moveFail++; log(`[跳过] ${p.sName}→${p.tName}：${reason}`); continue;
  }
  // 源只取文件夹（资源目录），不搬散文件
  const srcDirs = src.items.filter((x) => x && Number(x.category) === 0);
  const dstNames = new Set(dst.items.map((x) => norm(x.filename)));
  const fresh = srcDirs.filter((x) => !dstNames.has(norm(x.filename)));
  if (!fresh.length) {
    const reason = srcDirs.length === 0 ? '无资源' : `${srcDirs.length} 项全部重复`;
    skipped.push(`[${p.tName}] ${reason}，无新资源`);
    log(`[跳过] ${p.sName}→${p.tName}：${reason}（源剩 ${srcDirs.length}）`);
    continue;
  }

  const pick = fresh[crypto.randomInt(fresh.length)];
  if (DRY) {
    dryPicks.push(`[${p.tName}] ${clean(pick.filename)}`);
    log(`[dry] 会搬 [${p.tName}] ${pick.filename}（新候选 ${fresh.length} / 源 ${srcDirs.length}）`);
    continue;
  }

  // ---------- 4. move：每类单独一次，失败最多重试 1 次 ----------
  let ok = false, lastMsg = '', retried = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = cli(['move', pick.fid, '--target-fid', p.tFid]);
    const res = resultOf(c.rows);
    if (!c.error && res && res.code === 0) { ok = true; break; }
    lastMsg = c.error || (res && `${res.code} ${res.msg}`) || 'move 无返回';
    if (attempt === 0) retried = true;
  }
  if (ok) {
    moved.push(`[${p.tName}] ${clean(pick.filename)}`);
    log(`[搬运] ✓ ${p.sName} → ${p.tName}：${pick.filename}${retried ? ' (retried)' : ''}`);
  } else {
    moveFail++;
    skipped.push(`[${p.tName}] move 失败：${clean(lastMsg).slice(0, 60)}`);
    log(`[搬运] ✗ ${p.sName}→${p.tName}：${lastMsg}${retried ? ' (retried)' : ''}`);
  }
}

// ---------- 5. 状态判定 + 本地简报 ----------
const total = PAIRS.length;
let status;
if (moved.length === 0 && moveFail > 0) status = '失败';
else if (moved.length === 0) status = '跳过';
else if (moved.length + skipped.length >= total && skipped.length === 0) status = '成功';
else status = '部分成功';

const names = DRY
  ? (dryPicks.length ? dryPicks.join('｜') : '本轮 9 个分类均无可搬运的新资源')
  : (moved.length ? moved.join('｜') : '本轮 9 个分类均无可搬运的新资源');
const skipText = skipped.length ? skipped.join('｜') : '';
const detail = DRY
  ? `[dry 预演] 会搬 ${dryPicks.length}/${total} 类｜跳过 ${skipped.length} 类（未实际 move、未发卡）`
  : `本轮搬运 ${moved.length}/${total} 类｜异常/跳过 ${skipped.length} 类`;

log('\n===== 本地简报' + (DRY ? '（dry 预演，未落库）' : '') + ' =====');
log(names);
if (skipText) log('跳过：' + skipText);
log(detail);
if (notices.size) {
  log('\n===== notice.text（原样展示，不进飞书卡）=====');
  for (const n of notices) log(n);
}

// 落盘一份本机简报备查
const brief = path.join(CACHE, `prestore-move-${stamp}${DRY ? '-dry' : ''}.md`);
try {
  fs.writeFileSync(brief, [`# 预存资源搬运 ${stamp}${DRY ? '（dry 预演）' : ''}`, status, '', names, skipText ? '跳过：' + skipText : '', detail, '', ...notices].join('\n'), 'utf8');
  log(`[简报] ${brief}`);
} catch {}

if (DRY) { log('[dry] 到选片为止，未 move、未发卡。'); process.exit(0); }
if (NO_SEND) { log('[no-send] 已 move，未发飞书卡。'); process.exit(0); }

// ---------- 6. 飞书蓝卡（每轮必发，一轮一张） ----------
log(`[飞书] status=${status}`);
if (!sendCard(names, status, skipText, detail)) die('飞书推送失败（搬运不回滚；可手动重放，见日志）');
log('DONE');
```
