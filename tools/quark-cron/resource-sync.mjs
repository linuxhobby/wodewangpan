#!/usr/bin/env node
/**
 * 我的网盘.夸克资源同步 —— 本机 cron 自包含编排脚本
 *
 * 流程：凭据 → git 预检/对齐 → scan-new → match-batch → 分类批量入库 →
 *       构建/冒烟 → git commit/push → VPS 重建 → 光鸭补链 → 飞书卡片。
 * 不依赖 LLM / WorkBuddy 自动化调度。
 *
 * 用法：
 *   node tools/quark-cron/resource-sync.mjs --dry-run   # 只扫描+匹配，不改网盘/不写 data/不提交
 *   node tools/quark-cron/resource-sync.mjs             # 正式（cron 每 6 小时 :10）
 *
 * 第一版支持：mv / tv / dc（process-batch）与 app（app-batch）。
 * 其它前缀（an / game / bk / cs / ot）只扫描并以 unsupported_category 上报，不自动入库。
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
const NOTIFY = path.join(SKILL, 'scripts', 'notify-feishu.mjs');
const DRY = process.argv.includes('--dry-run');

const log = (...a) => console.log(...a);
const die = (m, code = 4) => { console.error('✗ ' + m); process.exit(code); };

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
process.env.WDP_REPO = REPO;
process.env.WDP_CACHE_DIR = CACHE;
process.env.QUARK_REPO = process.env.QUARK_REPO || REPO;
for (const p of [SKILL, CACHE, path.join(SKILL, 'scripts')]) if (!fs.existsSync(p)) die(`缺路径：${p}`);

const SCRIPT = (name) => path.join(SKILL, 'scripts', name);
const SCAN_OUT = path.join(CACHE, 'scan-new.json');
const AFTER_SCAN_OUT = path.join(CACHE, 'scan-after.json');
const MATCH_OUT = path.join(CACHE, 'match.json');
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

// ---------- 0. git 预检 ----------
if (!DRY) {
  const st = run('git status', 'git', ['status', '--short']);
  if (!st.ok || st.out) die(`工作区不干净或 git 异常，本轮停手：\n${st.out}`, 3);
  if (!run('git fetch', 'git', ['fetch', 'origin']).ok) die('git fetch 失败', 3);
  if (!run('git pull --rebase', 'git', ['pull', '--rebase', 'origin', 'main']).ok) die('git pull --rebase 失败，本轮停手', 3);
}

// ---------- 1. 扫描 + TMDB 匹配（只读网盘，写缓存报告） ----------
const scan = node('scan-new', SCRIPT('scan-new.mjs'), ['--out', SCAN_OUT]);
if (!scan.ok) die('scan-new 失败', 3);
if (!DRY) node('LLM 待处理准备', path.join(HERE, 'llm-prepare.mjs'));
const match = node('match-batch', SCRIPT('match-batch.mjs'), ['--scan', SCAN_OUT, '--out', MATCH_OUT]);
if (!match.ok) die('match-batch 失败', 3);

// 低置信 / 明显错配（年份不符或评分过低）一律降级为中性简介，不把错片名写进站点
try {
  const matchData = JSON.parse(fs.readFileSync(MATCH_OUT, 'utf8'));
  let degraded = 0;
  for (const row of matchData) {
    const bad = row.low_confidence || !row.match || Number(row.match?.vote ?? 0) < 3.5;
    if (!bad) continue;
    const title = row.parsed?.zh || row.parsed?.en || String(row.filename || '').replace(/^\d+[-.]\s*/, '').replace(/\.[a-z0-9]{1,5}$/i, '');
    row.match = { title, overview: '本资源来自夸克网盘分享，简介与海报待人工补充。', vote: 0, genres: [] };
    row.low_confidence = true;
    degraded++;
  }
  fs.writeFileSync(MATCH_OUT, JSON.stringify(matchData, null, 1), 'utf8');
  log(`[匹配] 低置信降级 ${degraded} 条（按未命中写中性简介）`);
} catch (e) {
  die(`match 报告处理失败：${e.message}`, 3);
}

let report;
try { report = JSON.parse(fs.readFileSync(SCAN_OUT, 'utf8')); } catch (e) { die(`扫描报告读取失败：${e.message}`, 3); }
const cats = Array.isArray(report.categories) ? report.categories : [];
const SUPPORTED = { mv: 'mv', tv: 'tv', dc: 'dc', app: 'app' };
const skipped = [];
const planned = [];
for (const c of cats) {
  const loose = (c.unnumbered || []).filter((u) => u.likely_duplicate_of);
  for (const u of loose) skipped.push({ name: u.filename, reason: `duplicate_suspect：疑似重复于 ${u.likely_duplicate_of}，跳过不入库` });
  if (c.unmapped) {
    skipped.push({ name: c.dir, reason: 'unknown_category：站点无对应分类，跳过不入库' });
    continue;
  }
  if (!SUPPORTED[c.prefix]) {
    for (const u of c.unnumbered || []) skipped.push({ name: u.filename, reason: `unsupported_category：${c.prefix} 不在脚本直入范围，已转 LLM 补全链路（无需人工审核）` });
    continue;
  }
  const fresh = (c.unnumbered || []).filter((u) => !u.likely_duplicate_of);
  if (!fresh.length) continue;
  const holes = (c.holes || []).map((n) => parseInt(n, 10)).filter(Number.isFinite).sort((a, b) => a - b);
  const maxNum = parseInt(c.max_number, 10) || 0;
  const numbers = holes.slice(0, fresh.length);
  const holesUsed = numbers.length;
  for (let i = holesUsed; i < fresh.length; i++) numbers.push(maxNum + 1 + (i - holesUsed));
  planned.push({ prefix: c.prefix, dir: c.dir, items: fresh, numbers, holesUsed: numbers.filter((n) => holes.includes(n)).length, maxNum });
}
log(`\n[计划] 可自动处理 ${planned.length} 类 ｜ 跳过 ${skipped.length} 条`);
for (const p of planned) log(`  ${p.dir}：${p.items.length} 条，编号 ${p.numbers.join(',')}`);

if (DRY) {
  log('[dry] 只扫描+匹配，不重命名、不出链、不写 data、不提交。');
  process.exit(0);
}

// ---------- 2. 分类批量入库 ----------
const batches = [];
for (const p of planned) {
  const nums = p.numbers.join(',');
  if (p.prefix === 'app') {
    const planPath = path.join(CACHE, 'app-plan.json');
    try { fs.unlinkSync(planPath); } catch {}
    const init = node(`app-batch init（${p.dir}）`, SCRIPT('app-batch.mjs'), ['--init', '--scan', SCAN_OUT]);
    if (!init.ok) { skipped.push({ name: p.dir, reason: 'app-batch init 失败' }); continue; }
    const exec = node(`app-batch run（${p.dir}）`, SCRIPT('app-batch.mjs'), ['--scan', SCAN_OUT, '--size', '999']);
    batches.push({ prefix: p.prefix, planPath, ok: exec.ok });
  } else {
    const planPath = path.join(CACHE, `plan-${p.prefix}.json`);
    const init = node(`process-batch init（${p.dir}）`, SCRIPT('process-batch.mjs'), ['--init', '--scan', MATCH_OUT, '--only', p.prefix, '--numbers', nums, '--plan', planPath]);
    if (!init.ok) { skipped.push({ name: p.dir, reason: 'process-batch init 失败' }); continue; }
    const exec = node(`process-batch run（${p.dir}）`, SCRIPT('process-batch.mjs'), ['--plan', planPath, '--size', '999']);
    batches.push({ prefix: p.prefix, planPath, ok: exec.ok });
  }
}

const written = [];
for (const b of batches) {
  try {
    const plan = JSON.parse(fs.readFileSync(b.planPath, 'utf8'));
    for (const item of plan) {
      if (item.status === 'done') written.push({ ...item, prefix: b.prefix });
      else if (item.error) skipped.push({ name: item.old_name || item.id || '条目', reason: String(item.error).slice(0, 120) });
    }
  } catch {}
}
log(`\n[入库] 成功 ${written.length} 条 ｜ 异常 ${skipped.length} 条`);

// ---------- 2.5 本轮新条目当场补文件清单 ----------
// 只对本轮新入库 id 调用 fill-files：不掺连载轮询/待加资源扫描，失败不阻断入库，
// 占位或抓取失败的条目留给每 2 小时的 fill-files 例行任务兜底。
let fillText = '文件清单：本轮无新增';
if (written.length && process.env.WDP_SYNC_FILL !== '0') {
  const ids = written.map((w) => w.id);
  const ff = node('文件清单（新入库）', path.join(REPO, 'tools', 'fill-files.mjs'), [
    '--ids', ids.join(','), '--serials', '0', '--todo', '0', '--airing', '0', '--delay', '3000',
  ]);
  const done = [...ff.out.matchAll(/^(.+?)\s*…\s*完成（/gm)].map((m) => m[1].trim());
  const notReady = [...ff.out.matchAll(/^(.+?)\s*…\s*跳过（盘端只有占位说明文件/gm)].map((m) => m[1].trim());
  const failedFill = [...ff.out.matchAll(/^(.+?)\s*…\s*失败（/gm)].map((m) => m[1].trim());
  fillText = `文件清单：完成 ${done.length}/${ids.length}（占位 ${notReady.length}｜失败 ${failedFill.length}）`;
  if (!ff.ok) skipped.push({ name: 'fill-files', reason: `本轮补文件清单异常（退出码 ${ff.code}）` });
  for (const id of failedFill) skipped.push({ name: id, reason: 'file_list_failed：本轮文件清单抓取失败，留给 fill-files 后续重试' });
  log(fillText);
}

// ---------- 3. 构建 + 冒烟 ----------
let buildOk = false;
let smokeText = '0/0';
if (written.length) {
  buildOk = run('npm run build', 'npm', ['run', 'build'], { timeout: 900000 }).ok;
  if (!buildOk) die('构建失败，本轮不提交不推送', 3);
  const SLUG = { mv: 'movie', tv: 'tv', dc: 'documentary', app: 'software' };
  const base = 'http://127.0.0.1:4321';
  let alive = false;
  try { alive = (await fetch(base, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
  if (!alive) {
    const fd = fs.openSync(path.join(CACHE, 'wdp-resource-serve.log'), 'a');
    const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'serve.js')], { cwd: REPO, stdio: ['ignore', fd, fd], detached: true });
    child.unref();
    try { fs.closeSync(fd); } catch {}
    child.on('error', (e) => log('[冒烟] serve 启动失败：' + e.message));
    for (let i = 0; i < 10; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      try { alive = (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (alive) break;
    }
  }
  const urls = ['/'];
  for (const it of written) {
    const slug = SLUG[it.prefix];
    if (slug) urls.push(`/${slug}/${it.id}/`);
  }
  let pass = 0;
  for (const u of urls) {
    try { if ((await fetch(base + u, { signal: AbortSignal.timeout(5000) })).ok) pass++; } catch {}
  }
  smokeText = `${pass}/${urls.length}`;
  log(`[冒烟] ${smokeText}`);
}

// ---------- 4. git 提交推送 ----------
let commit = '';
let pushed = false;
if (written.length && buildOk) {
  const ids = written.map((w) => w.id);
  const msg = `feat: 同步夸克新增资源 ${ids.length} 条（${[...new Set(ids.map((id) => id.split('-')[0]))].join('/')}）`;
  run('git add', 'git', ['add', 'data/', 'static/images/']);
  const cm = run('git commit', 'git', ['commit', '-m', msg]);
  if (cm.ok) {
    commit = (cm.out.match(/\[main ([0-9a-f]+)\]/) || [])[1] || (cm.out.match(/^\s*([0-9a-f]{7,})\s/m) || [])[1] || '';
    let push = run('git push', 'git', ['push', 'origin', 'main']);
    if (!push.ok && /rejected|fetch first/i.test(push.out)) {
      run('git rebase after rejection', 'git', ['rebase', 'origin/main']);
      push = run('git push retry', 'git', ['push', 'origin', 'main']);
    }
    pushed = push.ok;
    if (!pushed) skipped.push({ name: 'git push', reason: 'GitHub 未推送（本地提交已保留）' });
  } else {
    skipped.push({ name: 'git commit', reason: '提交失败（详见日志）' });
  }
}

function vpsRebuild(tag) {
  if (!pushed && tag !== 'guangya') return 'VPS 重建跳过（GitHub 未推送）';
  const r = run(`VPS 重建（${tag}）`, 'bash', ['-lc', "ssh site 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'"], { timeout: 180000 });
  const tail = run(`VPS 日志（${tag}）`, 'bash', ['-lc', "ssh site 'tail -3 /var/log/wdwp-autoupdate.log'"], { timeout: 60000 });
  const last = tail.out.split('\n').filter(Boolean).pop() || '';
  return r.ok && /发布完成/.test(last) ? `VPS 发布完成 ${last.match(/发布完成：([0-9a-f]+)/)?.[1] || ''}`.trim() : `VPS 重建失败：${(r.out || last).slice(0, 160)}`;
}
const deployText = written.length ? vpsRebuild('主流程') : '无新增，未触发 VPS 即时重建';

// ---------- 5. 光鸭补链（每轮必跑） ----------
node('guangya-sync', SCRIPT('guangya-sync.mjs'));
let gyText = '光鸭补链：未生成报告';
try {
  const g = JSON.parse(fs.readFileSync(path.join(CACHE, 'guangya-sync-last.json'), 'utf8'));
  const n = (g.created || []).length;
  gyText = `光鸭补链：成功 ${n}/${g.pending?.length ?? 0}（失败 ${(g.failed || []).length}，未确认 ${(g.unconfirmed || []).length}）`;
  if (g.login_required) gyText += '：需人工重新登录';
  // 服务端已判定违规的条目不再逐条出现在汇报里（guangya-sync 也会永久跳过出链）。
  for (const f of g.failed || []) {
    if (f.code === 'SHARE_FILE_REJECTED') continue;
    skipped.push({ name: f.name || f.id || '光鸭条目', reason: `guangya_failed：${String(f.message || f.reason || '').slice(0, 100)}` });
  }
  // 光鸭链接是在主流程 commit/push 之后写进 data/*.yaml 的，必须单独收口，
  // 否则工作区留脏，下一轮 git 预检会直接停手。
  if (n && !DRY) {
    run('git add guangya', 'git', ['add', 'data']);
    const gc = run('git commit guangya', 'git', ['commit', '-m', `chore: 光鸭补链 ${n} 条`]);
    if (gc.ok) {
      let gp = run('git push guangya', 'git', ['push', 'origin', 'main']);
      if (!gp.ok && /rejected|fetch first/i.test(gp.out)) {
        run('git rebase guangya', 'git', ['rebase', 'origin/main']);
        gp = run('git push guangya retry', 'git', ['push', 'origin', 'main']);
      }
      if (gp.ok) gyText += ' ｜ 链接已提交推送';
      else skipped.push({ name: 'git push guangya', reason: 'GitHub 未推送（本地提交已保留）' });
      gyText += ' ｜ ' + vpsRebuild('guangya');
    } else {
      skipped.push({ name: 'git commit guangya', reason: '光鸭链接提交失败' });
    }
  }
} catch {}
log(gyText);

// ---------- 6. 飞书卡片（仅当有夸克新增） ----------
if (written.length) {
  const slugByPrefix = { mv: 'movie', tv: 'tv', dc: 'documentary', app: 'software' };
  const fileByPrefix = { mv: 'movie.yaml', tv: 'tv.yaml', dc: 'documentary.yaml', app: 'software.yaml' };
  const labelByPrefix = { mv: '🎞 电影', tv: '📺 电视剧', dc: '🎬 纪录片', app: '💻 软件' };
  const groupsMap = new Map();
  for (const w of written) {
    const slug = slugByPrefix[w.prefix];
    if (!slug) continue;
    const g = groupsMap.get(w.prefix) || { label: labelByPrefix[w.prefix], items: [] };
    g.items.push({ id: w.id, name: w.match?.title || String(w.old_name || '').replace(/^\d+[-.]\s*/, ''), quark: w.url || '', site: `https://www.wodewangpan.top/${slug}/${w.id}/` });
    groupsMap.set(w.prefix, g);
  }
  // 卡片里的网盘侧数字以改名完成后的夸克实际目录数为准；旧 scan-new 是改名前的快照，会误报「站点多 1」
  node('scan-new 复核', SCRIPT('scan-new.mjs'), ['--out', AFTER_SCAN_OUT]);
  let afterCats = cats;
  try {
    const after = JSON.parse(fs.readFileSync(AFTER_SCAN_OUT, 'utf8'));
    if (Array.isArray(after.categories) && after.categories.length) afterCats = after.categories;
  } catch {}
  const reconcile = [];
  for (const p of new Set(written.map((w) => w.prefix))) {
    const file = path.join(REPO, 'data', fileByPrefix[p]);
    let site = 0;
    try { site = (fs.readFileSync(file, 'utf8').match(/^- id:/gm) || []).length; } catch {}
    const scanCat = afterCats.find((c) => c.prefix === p);
    const quark = Number(scanCat?.total ?? scanCat?.numbered ?? scanCat?.max_number);
    reconcile.push({ cat: labelByPrefix[p], site, quark: Number.isFinite(quark) ? quark : site, max: Number.isFinite(quark) ? quark : site });
  }
  const payload = {
    title: `夸克资源同步 · 新增 ${written.length} 条`,
    groups: [...groupsMap.values()],
    skipped,
    reconcile,
    footer: `commit ${commit || 'unknown'} ｜ 构建 ${written.length} 资源 ｜ 冒烟 ${smokeText} ｜ ${fillText} ｜ ${pushed ? '已推送 GitHub' : '未推送 GitHub'} ｜ ${deployText} ｜ ${gyText}`,
  };
  const payloadFile = path.join(CACHE, `resource-sync-card-${Date.now()}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify(payload, null, 2), 'utf8');
  node('飞书简报', NOTIFY, ['--input', payloadFile]);
} else {
  log('本轮无夸克新增：不发飞书卡片；光鸭补链已执行。');
}

log('\n===== 简报 =====');
log(`入库 ${written.length} 条 ｜ 跳过/异常 ${skipped.length} 条 ｜ 冒烟 ${smokeText}`);
log(fillText);
log(deployText);
log(gyText);
