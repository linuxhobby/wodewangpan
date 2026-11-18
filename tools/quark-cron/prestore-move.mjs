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
 *   node tools/quark-cron/prestore-move.mjs --dry       # 验登录/根目录/分类解析/查重选片，不 move、不发卡
 *   node tools/quark-cron/prestore-move.mjs --no-send   # 照常 move，但不发飞书卡（联调用）
 *   node tools/quark-cron/prestore-move.mjs             # 正式：move + 发卡
 *
 * 环境变量（Debian 上按需覆盖，默认走 HOME 动态解析）：
 *   QK_SKILL_DIR       quarkclouddrive skill 根目录，默认 ~/.workbuddy/skills/quarkclouddrive
 *   QK_FEISHU_SCRIPT   飞书卡片脚本，默认本仓库 tools/feishu-reports/wodewangpan-move-feishu.mjs
 *   QK_CACHE_DIR       中间文件目录，默认 ~/.workbuddy/quark-sync-cache
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
// 2026-11-18 并入站点仓库：飞书脚本默认走仓库内副本，不再依赖本机 ~/Scripts/
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = process.env.QK_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'quarkclouddrive');
const CLI = path.join(SKILL, 'scripts', 'quark-drive.cjs');
const FEISHU = process.env.QK_FEISHU_SCRIPT || path.join(REPO, 'tools', 'feishu-reports', 'wodewangpan-move-feishu.mjs');
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
    // 宿主 shell / cron 下无 WorkBuddy 注入的环境变量，CLI 的 Agent 环境守卫会报
    // 「无法识别当前 Agent 环境」；登录态 agent_auth 即按 "workbuddy" 键存，此处显式声明
    env: { ...process.env, WORKBUDDY_CONFIG_DIR: path.join(HOME, '.workbuddy') },
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
