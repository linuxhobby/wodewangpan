# Debian 13：夸克分享每日补充更新迁移（去 LLM 化部署手册）

> 记录：2026-11-17。对应 WorkBuddy 自动化任务「我的网盘.夸克分享每日补充更新」（id `c165024b-1ce5-485b-9202-2758908b0790`）。
> 目标是迁到一台常开的 Debian 13 主机，用 cron 直跑编排脚本，不依赖 LLM / WorkBuddy 自动化调度器。
> TG / Bluesky 两条推送已迁移完成并验收，旧部署文档不再保留。
> 本文不含任何凭据值；`<USER>` / `<DEBIAN_IP>` 按实际替换。

## 1. 这个任务和 TG / Bluesky 的本质区别

| | TG / Bluesky 推送 | 本任务（夸克分享补存） |
|---|---|---|
| 形态 | 单文件自包含 Node 脚本 | LLM 驱动的复合流程：CLI + 登录态 + 多辅助脚本 + 飞书脚本 |
| 调度前 | `FREQ=HOURLY;BYMINUTE=8/9` | `FREQ=DAILY;BYHOUR=17;BYMINUTE=20` |
| 定时任务现状 | 已迁走 | 当前为 PAUSED（迁移前已暂停） |
| 副作用 | 对外发帖，判重靠本地 json | **网盘写操作**（`saveas-update` 增量转存），有资源目录红线 |

关键：原任务 prompt 里的大量判断（分页取完、41043/41040 语义、疑似新建目录判据、msg 原样展示）此前由 LLM 现场做。
迁移方案把这些判断**固化进一个自包含编排脚本** `share-update-cron.mjs`（本文附录全文），cron 每天 17:20 直跑，无需 LLM。

## 2. 依赖清单（必须全部搬到 Debian）

| 依赖 | 本机路径 | Debian 默认路径 | 说明 |
|---|---|---|---|
| 编排脚本 | 本文附录 | `~/share-update-cron.mjs` | 整合了原 4 个辅助脚本的逻辑 |
| quarkclouddrive CLI | `~/.workbuddy/skills/quarkclouddrive/` | 同（可用 `QK_SKILL_DIR` 覆盖） | skill 整个目录，含 `scripts/quark-drive.cjs` |
| 夸克登录态 | `.../quarkclouddrive/workbuddy/config.json` | 同 | **cookie，敏感，绝不进 git**，需 scp |
| 飞书卡片脚本 | `C:/Users/marco/Scripts/wodewangpan-share-update-feishu.mjs` | `~/Scripts/...`（可用 `QK_FEISHU_SCRIPT` 覆盖） | 从 mybot 之外单独拷 |
| lark-cli 绑定 | WorkBuddy 的 lark-cli | 同机 WorkBuddy | 脚本走 `~/.workbuddy/binaries/.../@larksuite/cli/scripts/run.js`，需当前绑定应用为「我的网盘」`cli_aa56dbd9dab8dd0f` |
| 中间文件目录 | `~/.workbuddy/quark-sync-cache/` | 同（可用 `QK_CACHE_DIR` 覆盖） | 脚本自建，落 candidates/results/verify/payload |

> 环境注记：CLI 和飞书脚本内部已用 `os.homedir()` 解析路径，跨平台；原 prompt 里的 `C:/Users/marco/...` 全部不要带到 Debian。
> `install.sh` 每轮更新 skill 的行为在脚本里**故意去掉了**（Debian 上没人值守，且它可能重建登录态配置），改成人工按需更新 skill。

## 3. 操作步骤（顺序固定）

### 3.1 停旧机

Windows 侧「我的网盘.夸克分享每日补充更新」自动化任务当前已是 PAUSED，无需再动。确认没有残留进程在跑 CLI。

### 3.2 搬依赖到 Debian

```bash
# 在旧机执行（Git Bash 用 /c/... 路径）。登录态含 cookie，走 scp，绝不进任何 git 仓库
scp -r /c/Users/marco/.workbuddy/skills/quarkclouddrive <USER>@<DEBIAN_IP>:~/.workbuddy/skills/
scp /c/Users/marco/Scripts/wodewangpan-share-update-feishu.mjs <USER>@<DEBIAN_IP>:~/Scripts/
```

> 若 Debian 上 `~/.workbuddy/skills/` 已有其它 skill，**只覆盖 quarkclouddrive 这一个目录**，别整目录替换。

### 3.3 Debian 上装依赖、确认飞书通道

```bash
sudo apt install -y nodejs cron                 # Node >= 18
sudo systemctl enable --now cron
cd ~ && node --check share-update-cron.mjs      # 脚本语法自检
```

飞书通道自检（确认 lark-cli 绑定的是「我的网盘」应用，不是院采雷达）：

```bash
ls ~/.workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/scripts/run.js
node ~/Scripts/wodewangpan-share-update-feishu.mjs --input <任一payload.json> --dry-run
```

### 3.4 分级验证（dry → no-send → 正式）

```bash
# 1) dry：只验登录/路径/翻页，不转存、不发卡（0 更新也会正常退出）
node ~/share-update-cron.mjs --dry

# 2) no-send：照常转存 + 生成 payload，但不发飞书，先看 dirs/skipped 判得对不对
node ~/share-update-cron.mjs --no-send

# 3) 正式：cron 每天 17:20 自动跑；也可先手动跑一次确认卡片
node ~/share-update-cron.mjs
```

`--no-send` 后务必看一眼 `~/.workbuddy/quark-sync-cache/share-update-card-*.json`：
`dirs` 应是「补进历史目录」的条目，`skipped` 应是失败或疑似新建目录的条目。判据不对就不要启用 cron。

### 3.5 写入 crontab

用标记块，不动已有条目（TG / Bluesky 的 cron 块保留）：

```bash
CRON_BIN="$(command -v node)"
( crontab -l 2>/dev/null | sed '/# >>> wdp-quark/,/# <<< wdp-quark/d'; cat <<EOF
# >>> wdp-quark BEGIN (managed, 勿手改)
20 17 * * * cd ~ && $CRON_BIN ~/share-update-cron.mjs >> ~/.workbuddy/quark-sync-cache/cron.log 2>&1
# <<< wdp-quark END
EOF
) | crontab -
crontab -l | grep -A2 wdp-quark
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
cd ~ && node share-update-cron.mjs

# 只看不写
cd ~ && node share-update-cron.mjs --dry

# 卸载本任务 cron（保留 TG/Bluesky 块）
crontab -l | sed '/# >>> wdp-quark/,/# <<< wdp-quark/d' | crontab -
```

- 0 条更新时脚本静默退出，不发卡、不写网盘，避免刷屏。
- 有新增成功或有异常才发一张蓝色 interactive 卡片，接收人走 lark-cli 绑定应用内的 open_id。
- 判重不建本地数据库：夸克 `get-share-update-list` 返回的更新清单本身就是判重依据。

## 7. 回退

临时切回 LLM 版（WorkBuddy 自动化）：删掉 wdp-quark 的 cron 块，把原自动化任务从 PAUSED 恢复 ACTIVE 即可。
两边**不要同时启用**：同一分享链接会被两条链路各转存一次。

## 8. 附录：share-update-cron.mjs 全文

保存为 `~/share-update-cron.mjs`（脚本用 `os.homedir()` 解析路径，勿改回绝对路径）。

```js
#!/usr/bin/env node
/**
 * 我的网盘.夸克分享每日补充更新 —— Debian cron 自包含编排脚本
 *
 * 把原 WorkBuddy 自动化 prompt 里的判断逻辑固化为代码，纯 node + CLI，不依赖 LLM。
 * 流程：验登录 → 翻页拉更新清单并去重 → 逐条 saveas-update 增量转存 →
 *       get-share-saved-dir 核验是否补进历史目录（红线）→ 生成 payload → 飞书蓝标卡片。
 *
 * 用法：
 *   node share-update-cron.mjs --dry        # 只拉清单核验，不转存、不发卡（验 login/路径/翻页）
 *   node share-update-cron.mjs --no-send    # 照常转存，生成 payload 但不发飞书（联调用）
 *   node share-update-cron.mjs              # 正式：转存 + 发卡
 *
 * 环境变量（Debian 上按需覆盖，默认走 HOME 动态解析）：
 *   QK_SKILL_DIR      quarkclouddrive skill 根目录，默认 ~/.workbuddy/skills/quarkclouddrive
 *   QK_CACHE_DIR      中间文件目录，默认 ~/.workbuddy/quark-sync-cache
 *   QK_FEISHU_SCRIPT  飞书卡片脚本，默认 ~/Scripts/wodewangpan-share-update-feishu.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const SKILL = process.env.QK_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'quarkclouddrive');
const CLI = path.join(SKILL, 'scripts', 'quark-drive.cjs');
const CACHE = process.env.QK_CACHE_DIR || path.join(HOME, '.workbuddy', 'quark-sync-cache');
const FEISHU = process.env.QK_FEISHU_SCRIPT || path.join(HOME, 'Scripts', 'wodewangpan-share-update-feishu.mjs');
const LOGIN_STATE = path.join(SKILL, 'workbuddy', 'config.json');
const SI = '检查一下夸克网盘资源有没有更新，把每天新增的资源存放到对应的资源目录下，已经存过的就不用重复存了。';

const DRY = process.argv.includes('--dry');
const NO_SEND = process.argv.includes('--no-send');
const p2 = (n) => String(n).padStart(2, '0');
const t0 = new Date();
const stamp = `${t0.getFullYear()}${p2(t0.getMonth() + 1)}${p2(t0.getDate())}-${p2(t0.getHours())}${p2(t0.getMinutes())}`;
const sid = `${t0.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
fs.mkdirSync(CACHE, { recursive: true });

const log = (...a) => console.log(...a);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

// ---------- CLI 封装：统一带 session-input / session-id，cwd 固定在 skill 根目录 ----------
function cli(args, timeoutMs = 180000) {
  const r = spawnSync('node', [CLI, ...args, '--session-input', SI, '--session-id', sid], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, cwd: SKILL,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const rows = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { rows.push(JSON.parse(t)); } catch {}
  }
  return { rows, out, error: r.error ? String(r.error.message || r.error) : null, status: r.status };
}
const resultOf = (rows) => rows.filter((x) => x && x.type === 'result').pop() || null;

// ---------- 前置检查 ----------
if (!fs.existsSync(CLI)) die(`找不到 CLI：${CLI}（quarkclouddrive skill 未安装或路径不对，用 QK_SKILL_DIR 覆盖）`);
if (!fs.existsSync(LOGIN_STATE)) die(`找不到夸克登录态：${LOGIN_STATE}（请把本机的 workbuddy/config.json 拷过来）`);

const who = cli(['get-user-info']);
const whoRes = resultOf(who.rows);
if (who.error || !whoRes || whoRes.code !== 0) {
  die(`夸克登录态失效：${who.error || (whoRes && whoRes.msg) || '无返回'}。按 §6 发异常卡片后结束，不要启动登录流程。`);
}
log(`[登录] OK${whoRes.msg ? ' ' + whoRes.msg : ''}`);

// ---------- 1. 翻页拉全部更新清单，按 share_url 去重 ----------
const seen = new Set();
const candidates = [];
for (let page = 1; page <= 30; page++) {
  const { rows, error } = cli(['get-share-update-list', '--page', String(page)]);
  if (error) die(`更新清单第 ${page} 页失败：${error}`);
  for (const row of rows) {
    if (!row || row.type !== 'list') continue;
    const d = row.data || {};
    if (!d.share_url || seen.has(d.share_url)) continue;
    seen.add(d.share_url);
    candidates.push({ url: d.share_url, title: d.title || '', updated_at: d.updated_at || '' });
  }
  const res = resultOf(rows);
  log(`[清单] page=${page} 本页累计 ${candidates.length}${res && res.data ? ` has_next=${res.data.has_next_page}` : ''}`);
  if (!res || !res.data || res.data.has_next_page !== true) break;
}
fs.writeFileSync(path.join(CACHE, 'candidates.json'), JSON.stringify(candidates, null, 2), 'utf8');
log(`[清单] 去重后 ${candidates.length} 条有更新`);
if (!candidates.length) {
  log('本轮 0 条更新，按约定不发飞书、不写网盘、退出。');
  process.exit(0);
}
if (DRY) { log('[dry] 到清单为止，不转存、不发卡。'); process.exit(0); }

// ---------- 2. 逐条增量转存（幂等，只往历史目录补新增文件） ----------
const results = [];
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  const run = () => {
    const r = cli(['saveas-update', '--url', c.url], 900000);
    return { res: resultOf(r.rows), raw: r.out, error: r.error };
  };
  let a = run();
  let code = a.res ? a.res.code : null;
  let retried = false;
  // 41043（链接未转存）不重试；其余（含 41040 无更新）最多重试 1 次
  if (code !== 0 && String(code) !== '41043') {
    retried = true;
    a = run();
    code = a.res ? a.res.code : null;
  }
  const res = a.res || {};
  const data = res.data || {};
  const sa = data.save_as || {};
  results.push({
    url: c.url, title: c.title, updated_at: c.updated_at,
    code, msg: res.msg || '', notice: res.notice ? res.notice.text || '' : '',
    save_path: data.save_path || '',
    to_pdir_fid: sa.to_pdir_fid || '', to_pdir_name: sa.to_pdir_name || '',
    added: sa.save_as_sum_num == null ? null : Number(sa.save_as_sum_num),
    retried, error: a.error,
  });
  log(`[转存 ${i + 1}/${candidates.length}] ${c.title} => code=${code}${retried ? ' (retried)' : ''}`);
  fs.writeFileSync(path.join(CACHE, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
}

// ---------- 3. 核验：只认「补进历史转存目录」，疑似新建目录上报人工（资源目录红线） ----------
const ok = results.filter((r) => r.code === 0 && r.save_path);
const verify = [];
for (let i = 0; i < ok.length; i++) {
  const r = ok[i];
  const { rows } = cli(['get-share-saved-dir', '--url', r.url]);
  const res = resultOf(rows);
  const d = (res && res.data) || {};
  const fidMatch = !!d.pdir_fid && !!r.to_pdir_fid && String(d.pdir_fid) === String(r.to_pdir_fid);
  const nameMatch = !!d.pdir_name && !!r.to_pdir_name && d.pdir_name === r.to_pdir_name;
  const isExistingDir = fidMatch || nameMatch; // 既有目录名与分享标题不同也算正常补存
  verify.push({ ...r, pdir_fid: d.pdir_fid || '', pdir_name: d.pdir_name || '', fidMatch, nameMatch, isExistingDir });
  log(`[核验 ${i + 1}/${ok.length}] ${r.title} => existing=${isExistingDir}`);
}
fs.writeFileSync(path.join(CACHE, 'verify.json'), JSON.stringify(verify, null, 2), 'utf8');
const vmap = new Map(verify.map((v) => [v.url, v]));

// ---------- 4. 生成卡片 payload（msg 原样；41040 不算失败；硬编码 NEWLY_CREATED 已废弃，改用 isExistingDir） ----------
const dirs = [], skipped = [];
let noUpdate = 0;
for (const r of results) {
  if (String(r.code) === '41040') { noUpdate++; continue; }
  if (r.code !== 0) {
    skipped.push({ name: r.title, reason: `${r.code} ${r.msg}`.trim() });
    continue;
  }
  const v = vmap.get(r.url);
  if (!v || !v.isExistingDir) {
    skipped.push({ name: r.title, reason: `疑似擅自新建目录，落点：${r.save_path}（需人工确认，未做任何删除/改名）` });
    continue;
  }
  const d = { name: r.title, path: r.save_path, msg: r.msg };
  if (v.added != null && Number.isFinite(v.added)) d.added = v.added;
  dirs.push(d);
}
const status = skipped.length ? (dirs.length ? '部分成功' : '失败') : '成功';
const payload = {
  title: '我的网盘.夸克分享每日补充更新简报',
  dirs, skipped, status,
  detail: `本轮检测 ${results.length} 条更新 ｜ 成功 ${dirs.length} ｜ 无新增 ${noUpdate} ｜ 异常 ${skipped.length}`,
};
const payloadFile = path.join(CACHE, `share-update-card-${stamp}.json`);
fs.writeFileSync(payloadFile, JSON.stringify(payload, null, 2), 'utf8');
log(`[卡片] ${payload.detail}`);
log(`[卡片] payload=${payloadFile}`);

if (!dirs.length && !skipped.length) {
  log('无新增成功、无异常，按约定不发飞书。');
  process.exit(0);
}
if (NO_SEND) { log('[no-send] 不发送，payload 已落盘。'); process.exit(0); }

// ---------- 5. 飞书蓝标卡片（最多重试 1 次；失败不重跑任何夸克命令） ----------
if (!fs.existsSync(FEISHU)) die(`找不到飞书脚本：${FEISHU}（用 QK_FEISHU_SCRIPT 覆盖）`);
const send = () => spawnSync('node', [FEISHU, '--input', payloadFile], { encoding: 'utf8', timeout: 180000 });
let s = send();
if (s.status !== 0 && !s.error) s = send();
if (s.status !== 0) die(`飞书推送失败：${String(s.stderr || s.stdout || s.error || '').slice(0, 500)}（payload 已落盘，可手动重放：node ${FEISHU} --input ${payloadFile}）`);
log(String(s.stdout || '').trim());
log('DONE');
```
