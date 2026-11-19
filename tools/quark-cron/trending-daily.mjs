#!/usr/bin/env node
/**
 * 我的网盘.TMDB今日热门影视每日同步 —— 本机 cron 自包含编排脚本
 *
 * 流程：读本机凭据 → git 预检/对齐 → trending-sync → VPS 即时重建 →
 *       placeholder-fill → 本地冒烟 → 飞书卡片 → 光鸭镜像 → 可选第二次 VPS 重建。
 * 纯 Node + CLI，不依赖 LLM / WorkBuddy 自动化调度。
 *
 * 用法：
 *   node tools/quark-cron/trending-daily.mjs --dry-run   # 只检查配置/状态/报告路径，不跑任何外部命令
 *   node tools/quark-cron/trending-daily.mjs             # 正式（cron 50 3 * * *）
 *
 * 凭据：~/.config/wodewangpan-tmdb.env（TMDB_TOKEN / QUARK_SHARE_FID / QUARK_REPO / QUARK_CLI，权限 600）
 * 状态：~/.cache/quark-sync/（trending-seen.json / trending-last.json / 光鸭报告等）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.WDP_REPO || path.resolve(HERE, '..', '..');
const SKILL = path.join(REPO, 'tools', 'vendor', 'quark-resource-sync');
const CACHE = process.env.WDP_CACHE_DIR || path.join(os.homedir(), '.cache', 'quark-sync');
const ENV_FILE = path.join(os.homedir(), '.config', 'wodewangpan-tmdb.env');
const FEISHU = path.join(REPO, 'tools', 'feishu-reports', 'wodewangpan-trending-feishu.mjs');
const REPORT = path.join(CACHE, 'trending-last.json');
const MIRROR_REPORT = path.join(CACHE, 'guangya-mirror-last.json');
const LOCK = path.join(CACHE, 'trending-daily.lock');
const DRY = process.argv.includes('--dry-run');
// 幂等窗口：距上次成功同步 < 该值则视为重入（工具层 sandbox retry / 双触发源），直接跳过。
// 2026-11-20：曾因 WorkBuddy Bash 工具 sandbox retry 把同一条命令顺序执行两遍，导致多入库一轮。
const IDEMPOTENT_MS = Number(process.env.WDP_TRENDING_IDEMPOTENT_MS || 90 * 60 * 1000);

const log = (...a) => console.log(...a);
const die = (m, code = 4) => { console.error('✗ ' + m); process.exit(code); };
// ---------- 凭据：文件只是默认值，显式环境变量优先 ----------
function loadEnvFile() {
  let raw = '';
  try { raw = fs.readFileSync(ENV_FILE, 'utf8'); } catch { die(`缺凭据 ${ENV_FILE}`); }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile();
process.env.QUARK_REPO = process.env.QUARK_REPO || REPO;
process.env.WDP_REPO = REPO;
process.env.WDP_CACHE_DIR = CACHE;
for (const p of [SKILL, CACHE, path.join(SKILL, 'scripts')]) {
  if (!fs.existsSync(p)) die(`缺路径：${p}`);
}
if (!fs.existsSync(path.join(SKILL, 'scripts', 'trending-sync.mjs'))) die('vendored trending-sync.mjs 不存在');

if (DRY) {
  log('[dry] 配置检查通过');
  log(`  REPO=${REPO}`);
  log(`  SKILL=${SKILL}`);
  log(`  CACHE=${CACHE}`);
  log(`  报告存在=${fs.existsSync(REPORT)} 判重存在=${fs.existsSync(path.join(CACHE, 'trending-seen.json'))}`);
  log('[dry] 不执行外部命令、不写盘、不发卡。');
  process.exit(0);
}

// ---------- 重入防护（2026-11-20）：进程互斥锁 + 当日成功运行幂等 ----------
// 1) 进程锁：挡住并发的第二实例（双触发源同时起跑）。
function acquireLock() {
  try {
    const st = fs.statSync(LOCK);
    const pid = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; }
      catch (e) { alive = Boolean(e && e.code === 'EPERM'); }
    }
    if (alive) {
      log(`[重入防护] 另一个 trending-daily 实例仍在运行（pid ${pid}），本轮跳过。`);
      process.exit(0);
    }
    log(`[重入防护] 清理残留锁（pid ${pid} 已退出）`);
    fs.unlinkSync(LOCK);
  } catch { /* 无锁 */ }
  fs.writeFileSync(LOCK, String(process.pid));
}
function releaseLock() { try { fs.unlinkSync(LOCK); } catch { /* ignore */ } }
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });
// 2) 幂等：即便顺序重跑（PID 已退出，锁挡不住），距上次成功同步过近也跳过。
//    trending-sync 每轮都会重写 REPORT 的 ran_at；用它作为「上一轮成功完成」的时间锚点。
function recentRunGuard() {
  if (process.env.WDP_TRENDING_FORCE === '1') { log('[重入防护] WDP_TRENDING_FORCE=1，跳过幂等检查。'); return; }
  try {
    const rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const ran = Date.parse(rep.ran_at);
    if (Number.isFinite(ran)) {
      const age = Date.now() - ran;
      if (age >= 0 && age < IDEMPOTENT_MS) {
        log(`[重入防护] 距上次同步仅 ${Math.round(age / 1000)}s（< ${Math.round(IDEMPOTENT_MS / 60000)}min），判定为重复触发，本轮跳过。`);
        process.exit(0);
      }
    }
  } catch { /* 报告不存在/损坏：不拦，正常跑 */ }
}
acquireLock();
recentRunGuard();

const run = (label, cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeout || 900000,
    env: process.env,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  log(`\n===== ${label} =====`);
  if (out) log(out.split('\n').slice(-40).join('\n'));
  return { ok: r.status === 0, code: r.status, out, error: r.error ? String(r.error.message || r.error) : '' };
};
const node = (label, script, args = []) => run(label, process.execPath, [script, ...args]);

// ---------- 0. git 预检与对齐 ----------
const status = run('git status', 'git', ['status', '--short']);
if (!status.ok) die('git status 失败', 3);
if (status.out) die(`工作区不干净，本轮停手：\n${status.out}`, 3);
const fetch = run('git fetch', 'git', ['fetch', 'origin']);
if (!fetch.ok) die('git fetch 失败', 3);
const rebase = run('git pull --rebase', 'git', ['pull', '--rebase', 'origin', 'main']);
if (!rebase.ok) die('git pull --rebase 失败，本轮停手（不手工解冲突）', 3);

// ---------- 1. TMDB 同步（脚本自己 build + commit + push，默认不碰百度） ----------
const sync = node('trending-sync', path.join(SKILL, 'scripts', 'trending-sync.mjs'));
if (!sync.ok) die('trending-sync 失败，本轮停手', 3);

let rep;
try { rep = JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch (e) { die(`报告读取失败：${e.message}`, 3); }
const created = Array.isArray(rep.created) ? rep.created : [];
const errors = Array.isArray(rep.errors) ? rep.errors : [];
const skipped = Array.isArray(rep.skipped) ? rep.skipped : [];
log(`\n[汇总] 入库 ${created.length} 条 ｜ 顺延 ${skipped.length} 条 ｜ 失败 ${errors.length} 条`);
if (!DRY && created.length) {
  const CAT_BY_PREFIX = { mv: '电影', tv: '电视剧', an: '动漫' };
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const pendingFile = path.join(CACHE, `llm-pending-trending-${stamp}.json`);
  const items = created.map((c) => ({
    id: c.id,
    tmdb_id: c.tmdb_id,
    title: c.title,
    original: c.original,
    category: CAT_BY_PREFIX[String(c.id || '').slice(0, 2)] || '',
    date: c.date,
    vote: c.vote,
    genres: c.genres || [],
    desc_len: c.desc_len || 0,
    desc_filled: Boolean(c.desc_filled),
    image: c.image || '',
    quark_url: c.quark_url || '',
    dir_name: c.dirname || '',
    source: 'trending',
    reason: 'trending_new',
    status: 'pending',
  }));
  fs.writeFileSync(pendingFile, JSON.stringify({ source: 'trending', created_at: new Date().toISOString(), items }, null, 2));
  log(`LLM 复核 pending 已写入 ${pendingFile}（${items.length} 条）`);
}
if (!created.length) { log('本轮无新增：按口径不发飞书、不做光鸭镜像。'); process.exit(0); }

// ---------- 2. VPS 即时重建 ----------
function vpsRebuild(tag) {
  const cmd = "ssh site 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'";
  const r = run(`VPS 即时重建（${tag}）`, 'bash', ['-lc', cmd], { timeout: 180000 });
  const tail = run(`VPS 日志（${tag}）`, 'bash', ['-lc', "ssh site 'tail -3 /var/log/wdwp-autoupdate.log'"], { timeout: 60000 });
  const last = tail.out.split('\n').filter(Boolean).pop() || '';
  return { ok: r.ok && /发布完成/.test(last), text: r.ok && /发布完成/.test(last) ? `VPS 发布完成 ${last.match(/发布完成：([0-9a-f]+)/)?.[1] || ''}`.trim() : `VPS 重建失败：${(r.out || last).slice(0, 160)}` };
}
const deploy = vpsRebuild('主流程');

// ---------- 3. 占位 md 兜底 ----------
node('placeholder-fill', path.join(SKILL, 'scripts', 'placeholder-fill.mjs'), ['--scope', 'today']);

// ---------- 4. 本地冒烟 ----------
const SLUG = { mv: 'movie', tv: 'tv', an: 'anime' };
async function smoke() {
  const base = 'http://127.0.0.1:4321';
  let alive = false;
  try { alive = (await fetch(base, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
  if (!alive) {
    const logFile = path.join(CACHE, 'wdp-trending-serve.log');
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'serve.js')], { cwd: REPO, stdio: ['ignore', fd, fd], detached: true });
    child.unref();
    try { fs.closeSync(fd); } catch {}
    child.on('error', (e) => log('[冒烟] 启动 serve.js 失败：' + e.message));
    for (let i = 0; i < 10; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      try { alive = (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (alive) break;
    }
  }
  let pass = 0, total = 0;
  const urls = ['/', '/movie/', '/tv/', '/anime/'];
  for (const it of created) {
    const slug = SLUG[String(it.id).split('-')[0]] || '';
    if (slug) urls.push(`/${slug}/${it.id}/`, `/img/${it.id}-240.webp`, `/qr/${it.id}-quark.svg`);
  }
  for (const u of urls) {
    total++;
    try { if ((await fetch(base + u, { signal: AbortSignal.timeout(5000) })).ok) pass++; } catch {}
  }
  return `${pass}/${total}`;
}
const smokeResult = await smoke();
log(`[冒烟] ${smokeResult}`);

// ---------- 5. 飞书卡片 ----------
const follow = [];
for (const e of errors) follow.push(String(e.msg || e.reason || e.message || JSON.stringify(e)).slice(0, 120));
for (const e of rep.skipped || []) {
  const reason = String(e.reason || '');
  if (/年份窗口外|节目类（|无中文译名|已同步过|重复/.test(reason)) continue;
  follow.push(`${e.title || e.name || '条目'}：${reason}`.slice(0, 120));
}
const feishuArgs = ['--smoke', smokeResult, '--deploy', deploy.text];
if (rep.publish?.commit) feishuArgs.push('--commit', String(rep.publish.commit));
if (follow.length) feishuArgs.push('--follow', follow.slice(0, 8).join('｜'));
const card = node('飞书简报', FEISHU, feishuArgs);

// ---------- 6. 光鸭镜像 ----------
const mirror = node('guangya-mirror', path.join(SKILL, 'scripts', 'guangya-mirror.mjs'), ['--report', REPORT, '--out', MIRROR_REPORT]);
let mirrorText = '光鸭镜像：未执行';
if (fs.existsSync(MIRROR_REPORT)) {
  try {
    const m = JSON.parse(fs.readFileSync(MIRROR_REPORT, 'utf8'));
    const n = (m.created || []).length;
    const f = (m.folders_created || []).length;
    mirrorText = `光鸭镜像：成功 ${n}/${m.input || created.length}（新建目录 ${f}，失败 ${(m.failed || []).length}）`;
    if (m.login_required) mirrorText += '：需人工重新登录';
    if ((n || f) && mirror.ok) { const d2 = vpsRebuild('光鸭镜像'); mirrorText += ` ｜ ${d2.text}`; }
  } catch {}
}
log(`\n===== 简报 =====`);
log(`入库 ${created.length} 条 ｜ 顺延 ${skipped.length} ｜ 失败 ${errors.length}`);
log(deploy.text);
log(`冒烟 ${smokeResult}`);
log(card.ok ? '飞书卡片已推送' : '飞书卡片推送失败（详见上方日志）');
log(mirrorText);
log(`日志：cron 输出 ｜ 报告：${REPORT}`);
