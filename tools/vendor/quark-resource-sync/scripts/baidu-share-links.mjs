#!/usr/bin/env node
// ⚠️【2026-11-08 起停用】将军决定：后续不再镜像百度网盘目录，也不再给新资源出百度链接。
//   本脚本**不再被任何定时任务调用**（「我的网盘.夸克资源同步」的「百度出链」节已删除；trending-sync 默认关闭镜像与出链）。
//   存量：data/*.yaml 里已有的 582 条 baidu_url/baidu_pwd 保持不变，百度侧已建的目录与已出的链接都不取消、不改写。
//   切换时明确决定**不跑最后一班车**：存量里少数「百度有同名目录但条目缺 baidu_url」的，就此打住不回补。
//   恢复条件：只有用户当面明确要求时才可手动调用；无人值守轮次严禁自动跑。
//   下面是停用前的原说明，保留备查。
// baidu-share-links.mjs —— 给 data/*.yaml 里缺百度链接的条目出分享链接并写回（2026-11-04）。
//
// 背景：TMDB 同步流程只建百度同名镜像目录、不出分享链接（SKILL.md 3b/4c 旧口径），
// 但条目实际需要 baidu_url/baidu_pwd（tv-001~140 已人工批量补齐）。将军 2026-11-04 指示：
// 「百度网盘上有相应资源目录的就建立共享链接入库，没有目录的就算了，先只管电影/电视剧/动漫」。
//
// 流程（幂等，可反复重跑）：
//   1) 探活：whoami + ls 百度「04电影」目录（ls 是 share 的前置，接口被限时直接退出码 3）；
//   2) ls 三个分类目录，拿「编号-名称」清单，与各 yaml 缺 baidu_url 的条目按编号前缀匹配；
//   3) bdpan share 出链（优先 -d 0 永久，被拒自适应降级 30 / 7 天），解析链接与提取码；
//   4) baidu_url/baidu_pwd 按既有格式插到 quark_url 之后，js-yaml 全量校验；
//   5) 构建 → 提交（仅 data/*.yaml）→ 推送（fetch first 走 rebase）→ VPS wdwp-autoupdate 重建。
//
// 用法：
//   node baidu-share-links.mjs --probe      # 只探活，LS_OK 才算接口恢复（退出码 0）
//   node baidu-share-links.mjs --dry-run    # 只做目录匹配报告，不 share、不写库、不构建
//   node baidu-share-links.mjs              # 完整执行（出链+写库+构建+提交+推送+VPS）
//   node baidu-share-links.mjs --no-publish # 只出链+写库，不构建/不提交/不推送（供同步主流程内嵌：入库后、构建前跑）
//   node baidu-share-links.mjs --period 30  # 指定首选有效期（默认 0=永久），被拒仍自动降级
//   node baidu-share-links.mjs --cats 04电影,03电视剧  # 限定分类（默认全部有镜像的分类，无目录自动跳过）
//
// 退出码：0 成功/无事可做；3 接口仍被限（可重试）；4 前置条件/校验失败；5 构建失败；6 推送失败
// 报告：~/.cache/quark-sync/baidu-share-links-last.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
// 占位 md 不算资源目录：识别正则与写入侧（trending-sync / mirror-baidu）共用同一份定义
import { PLACEHOLDER_RE } from './lib/placeholder.mjs';

const REPO = process.env.REPO || path.join(os.homedir(), 'Documents', 'Github', 'wodewangpan');
const CACHE = process.env.QWS_CACHE || path.join(os.homedir(), '.cache', 'quark-sync');
const BDPAN = process.env.BD_PAN_CLI || path.join(os.homedir(), '.local', 'bin', 'bdpan');
const BAIDU_ROOT = '/apps/bdpan';
const CALL_GAP_MS = 900;            // 百度接口间隔，防风控
const REPORT = path.join(CACHE, 'baidu-share-links-last.json');

const has = (k) => process.argv.includes(`--${k}`);
const argOf = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const DRY = has('dry-run'), PROBE = has('probe'), NO_PUBLISH = has('no-publish');
const FIRST_PERIOD = parseInt(argOf('period', '0'), 10);

// 全部分类（2026-11-04 起默认覆盖全部有镜像的分类；--cats 04电影,03电视剧 可缩小范围）。
// 口径不变：百度侧**有同名编号目录才出链**，没有就跳过。
// ⚠ 本脚本自 2026-11-08 起已停用（百度网盘镜像与出链停止），列在这里只是为了万一人工显式恢复时口径不错：
//   2026-11-10「操作系统」并入「软件」，`09操作系统` / `os.yaml` 已不存在，所以下面不再登记 os。
const ALL_CATS = [
  { file: 'movie.yaml', catDir: '04电影', label: '电影' },
  { file: 'tv.yaml', catDir: '03电视剧', label: '电视剧' },
  { file: 'anime.yaml', catDir: '05动漫', label: '动漫' },
  { file: 'documentary.yaml', catDir: '06纪录片', label: '纪录片' },
  { file: 'game.yaml', catDir: '01游戏', label: '游戏' },
  { file: 'software.yaml', catDir: '02应用', label: '软件' },
  { file: 'ebook.yaml', catDir: '08电子书', label: '电子书' },
  { file: 'course.yaml', catDir: '07课程', label: '课程' },
  { file: 'misc.yaml', catDir: '010其他', label: '其他' },
];
const CATS_RAW = argOf('cats', '');
const CATS = (CATS_RAW.trim()
  ? CATS_RAW.split(',').map((s) => s.trim()).filter(Boolean)
      .map((d) => ALL_CATS.find((c) => c.catDir === d)).filter(Boolean)
  : ALL_CATS
).filter((c) => fs.existsSync(path.join(REPO, 'data', c.file)));

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 调 bdpan（--json）。返回 { ok, data, raw }；业务错误 code!=0/error → ok:false */
function bd(bin, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, [...args, '--json', '--no-check-update'],
      { maxBuffer: 64e6, encoding: 'buffer', timeout },
      (e, s, x) => {
        const raw = s.toString('utf8');
        const errText = x ? x.toString('utf8') : '';
        const j = tryJson(raw);
        if (e && !j) return resolve({ ok: false, err: (errText || e.message).slice(0, 200), raw: raw.slice(0, 300) });
        if (j && typeof j === 'object' && !Array.isArray(j) && (j.error || (j.code !== undefined && j.code !== 0))) {
          return resolve({ ok: false, err: String(j.error || j.msg || JSON.stringify(j)).slice(0, 200), raw: raw.slice(0, 300) });
        }
        resolve({ ok: true, data: j, raw });
      });
  });
}
function tryJson(raw) {
  const t = raw.trim(); if (!t) return null;
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf('{'), a = t.indexOf('[');
  const start = (i < 0) ? a : (a < 0 ? i : Math.min(i, a));
  if (start < 0) return null;
  try { return JSON.parse(t.slice(start)); } catch { return null; }
}
const lastSeg = (p) => String(p || '').split('/').filter(Boolean).pop() || '';

/** ls 百度目录 → { ok, names }；成功但空列表视为异常（分类目录不可能为空） */
async function bdLsNames(fullPath) {
  const r = await bd(BDPAN, ['ls', fullPath]);
  if (!r.ok) return r;
  let arr = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.data) ? r.data.data : null);
  if (!arr) return { ok: false, err: `ls 返回结构异常：${r.raw.slice(0, 120)}` };
  const names = [...new Set(arr.map((x) => lastSeg(x.path || x.server_filename)).filter(Boolean))];
  if (!names.length) return { ok: false, err: `ls 成功但列表为空（异常）` };
  return { ok: true, names };
}

/** 从 share 输出里解析链接与提取码 */
function parseShare(raw) {
  const m = raw.match(/https:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]{10,}/);
  if (!m) return { ok: false, err: '输出中无 pan.baidu.com/s 链接', raw: raw.slice(0, 300) };
  const link = m[0];
  let pwd = null;
  for (const key of ['pwd', 'passcode', 'pass_code', 'extract_code', 'extraction_code', 'code']) {
    const mm = raw.match(new RegExp(`"${key}"\\s*:\\s*"([A-Za-z0-9]{3,8})"`, 'i'));
    if (mm) { if (key === 'code' && /^\d+$/.test(mm[1])) continue; pwd = mm[1]; break; }
  }
  return { ok: true, link, pwd };
}

// ---------- yaml 文本级编辑 ----------
function readBlocks(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const blocks = [];
  let cur = null;
  lines.forEach((ln, i) => {
    if (/^- id:/.test(ln)) { cur = { start: i, lines: [ln] }; blocks.push(cur); }
    else if (cur) cur.lines.push(ln);
  });
  blocks.forEach((b) => { b.end = b.start + b.lines.length; b.id = (b.lines[0].match(/- id:\s*(\S+)/) || [])[1]; });
  return { lines, blocks };
}
function padNum(id) {
  const digits = String(id || '').split('-')[1] || '';
  if (!/^\d+$/.test(digits)) return null;
  return digits.length >= 3 ? digits : digits.padStart(3, '0');
}

// ---------- git ----------
const g = (args, opts = {}) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 32e6, ...opts });

// ================= main =================
const report = { ran_at: new Date().toISOString(), mode: [DRY && 'dry-run', PROBE && 'probe', NO_PUBLISH && 'no-publish'].filter(Boolean).join('+') || 'full', steps: {} };

if (PROBE) {
  const w = await bd(BDPAN, ['whoami'], { timeout: 30000 });
  if (!w.ok || !w.data || !w.data.authenticated) { console.error('PROBE_FAIL: whoami 未通过'); process.exit(3); }
  const ls = await bdLsNames(`${BAIDU_ROOT}/04电影`);
  if (!ls.ok) { console.error(`PROBE_FAIL: ls 仍被限：${ls.err}`); process.exit(3); }
  console.log(`LS_OK: 04电影 ${ls.names.length} 个目录，接口已恢复`);
  process.exit(0);
}

const w = await bd(BDPAN, ['whoami'], { timeout: 30000 });
if (!w.ok || !w.data || !w.data.authenticated) { console.error(`bdpan 未登录：${w.err || ''}；需 bdpan login --device-code`); process.exit(3); }

// 仓库干净校验：--no-publish 供同步主流程内嵌调用（此刻 data 本来就有未提交改动），跳过该校验
if (!NO_PUBLISH) {
  const dirty = g(['status', '--porcelain']).trim();
  if (dirty) { console.error(`仓库不干净，先处理再跑：\n${dirty.slice(0, 500)}`); process.exit(4); }
}

// 1) 列百度分类目录（第一个分类是锚点：它失败 = 列表接口仍被限，退出码 3；其余分类失败按「无目录」软跳过）
const baiduNames = {};
const skippedCats = [];
for (const [i, c] of CATS.entries()) {
  const r = await bdLsNames(`${BAIDU_ROOT}/${c.catDir}`);
  if (!r.ok) {
    if (i === 0) { console.error(`ls ${c.catDir} 失败（接口仍被限）：${r.err}`); process.exit(3); }
    skippedCats.push({ cat: c.label, catDir: c.catDir, err: r.err });
    log(`! ${c.catDir} 列目录失败，按「百度无该分类目录」处理：${r.err}`);
    baiduNames[c.catDir] = { map: {}, dup: new Set(), total: 0 };
    continue;
  }
  const map = {}, dup = new Set();
  for (const n of r.names) {
    if (PLACEHOLDER_RE.test(n)) continue;
    const m = n.match(/^(\d+)-/);
    if (!m) continue;
    if (map[m[1]]) dup.add(m[1]); else map[m[1]] = n;
  }
  baiduNames[c.catDir] = { map, dup, total: r.names.length };
  log(`【${c.catDir}】百度侧 ${r.names.length} 项，可匹配编号 ${Object.keys(map).length} 个${dup.size ? `，重号 ${[...dup].join(',')}（跳过）` : ''}`);
}
report.skipped_cats = skippedCats;

// 2) 扫描 yaml 缺链条目并匹配
const work = []; // {cat, id, num, dirname, blockStart}
const skipNoDir = [], skipLinked = [];
for (const c of CATS) {
  const p = path.join(REPO, 'data', c.file);
  const { blocks } = readBlocks(p);
  const bn = baiduNames[c.catDir];
  for (const b of blocks) {
    if (b.lines.some((l) => /^\s+baidu_url:/.test(l))) { skipLinked.push(`${c.label}:${b.id}`); continue; }
    const num = padNum(b.id);
    const dirname = num && !bn.dup.has(num) ? bn.map[num] : null;
    if (!dirname) { skipNoDir.push({ cat: c.label, id: b.id, reason: bn.dup.has(num) ? '百度侧编号重名' : '百度无同名编号目录' }); continue; }
    work.push({ cat: c, id: b.id, num, dirname });
  }
}
log(`缺链待处理 ${work.length} 条（已带链接 ${skipLinked.length} 条；无目录/异常跳过 ${skipNoDir.length} 条）`);
report.match = { todo: work.map((x) => `${x.cat.label}:${x.id}→${x.dirname}`), skip_no_dir: skipNoDir, already_linked: skipLinked.length };

if (!work.length) { console.log('没有需要出链的条目，结束。'); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); process.exit(0); }
if (DRY) { console.log('（dry-run）匹配结果见上，不创建分享、不写库。'); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); process.exit(0); }

// 3) 逐条 share（自适应有效期）
let effectivePeriod = Number.isFinite(FIRST_PERIOD) ? FIRST_PERIOD : 0;
const fallbacks = [...new Set([effectivePeriod, 30, 7])];
const results = [];
for (const item of work) {
  const fullPath = `${BAIDU_ROOT}/${item.cat.catDir}/${item.dirname}`;
  let got = null, tried = [];
  for (const period of (item === work[0] ? fallbacks : [effectivePeriod])) {
    const r = await bd(BDPAN, ['share', fullPath, '-d', String(period)]);
    tried.push({ period, err: r.ok ? null : r.err });
    if (r.ok) {
      const ps = parseShare(r.raw);
      if (ps.ok) { got = { ...ps, period }; effectivePeriod = period; break; }
      tried[tried.length - 1].err = ps.err;
    }
    await sleep(CALL_GAP_MS);
  }
  if (got) {
    results.push({ ...item, ...got });
    log(`✓ ${item.cat.label} ${item.id} ${item.dirname} → ${got.link}${got.pwd ? ` 提取码 ${got.pwd}` : '（未返回提取码）'}（${got.period === 0 ? '永久' : got.period + ' 天'}）`);
  } else {
    results.push({ ...item, ok: false, tried });
    log(`✗ ${item.cat.label} ${item.id} ${item.dirname} → ${tried.map((t) => `d${t.period}:${t.err}`).join(' | ')}`);
  }
  await sleep(CALL_GAP_MS);
}
const okItems = results.filter((r) => r.link);
report.share = {
  period_effective: effectivePeriod,
  ok: okItems.map((r) => ({ id: r.id, cat: r.cat.label, dir: r.dirname, url: r.link, pwd: r.pwd || null, period: r.period })),
  failed: results.filter((r) => !r.link).map((r) => ({ id: r.id, cat: r.cat.label, dir: r.dirname, tried: r.tried })),
};
if (!okItems.length) { console.error('一条都没出成功，接口可能仍被限。'); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); process.exit(3); }

// 4) 写回 yaml（插到 quark_url 之后）+ 校验
const createRequire = (await import('node:module')).createRequire;
const yaml = createRequire(path.join(REPO, 'package.json'))('js-yaml');
let written = 0;
for (const c of CATS) {
  const items = okItems.filter((r) => r.cat.catDir === c.catDir);
  if (!items.length) continue;
  const p = path.join(REPO, 'data', c.file);
  const { lines, blocks } = readBlocks(p);
  const edits = [];
  for (const it of items) {
    const b = blocks.find((x) => x.id === it.id);
    if (!b) { console.error(`!! ${c.file} 找不到条目 ${it.id}，跳过写回`); continue; }
    const qi = b.lines.findIndex((l) => /^\s+quark_url:/.test(l));
    if (qi < 0) { console.error(`!! ${it.id} 无 quark_url 行，跳过`); continue; }
    const ind = (b.lines[qi].match(/^(\s+)/) || ['', '  '])[1];
    const add = [`${ind}baidu_url: "${it.link}"`];
    if (it.pwd) add.push(`${ind}baidu_pwd: "${it.pwd}"`);
    edits.push({ at: b.start + qi + 1, add });
  }
  edits.sort((x, y) => y.at - x.at).forEach((e) => lines.splice(e.at, 0, ...e.add));
  const before = (yaml.load(fs.readFileSync(p, 'utf8')) || []).length;
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  const after = yaml.load(fs.readFileSync(p, 'utf8')) || [];
  if (!Array.isArray(after) || after.length !== before) { console.error(`!! ${c.file} 写回校验失败（条目数 ${before}→${after && after.length}）`); process.exit(4); }
  for (const it of items) {
    const e = after.find((x) => x.id === it.id);
    if (!e || !/^https:\/\/pan\.baidu\.com\/s\//.test(e.baidu_url || '') || (it.pwd && e.baidu_pwd !== it.pwd)) {
      console.error(`!! ${it.id} 写回后字段校验失败`); process.exit(4);
    }
  }
  written += items.length;
  log(`${c.file} 写回 ${items.length} 条并通过 js-yaml 校验`);
}
report.written = written;

if (NO_PUBLISH) {
  log(`--no-publish：出链 ${okItems.length}/${work.length}、写库 ${written} 完成；构建/提交/推送/VPS 交回同步主流程`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  process.exit(0);
}

// 5) 构建
log('开始构建 site …');
let buildOut = '';
try { buildOut = execFileSync(process.execPath, ['scripts/build.js'], { cwd: REPO, encoding: 'utf8', timeout: 300000, maxBuffer: 32e6 }); }
catch (e) { console.error(`构建失败：${String(e.stdout || '').slice(-400)}\n${String(e.stderr || '').slice(-400)}`); process.exit(5); }
log(`构建完成：${buildOut.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`);
report.build_ok = true;

// 6) 提交 + 推送（fetch first → rebase → 重推）
const changed = CATS.map((c) => `data/${c.file}`).filter((f) => g(['status', '--porcelain', f]).trim());
if (!changed.length) { console.error('没有 data 文件变更可提交（异常）'); process.exit(4); }
g(['add', ...changed]);
const nByCat = CATS.filter((c) => okItems.some((r) => r.cat.catDir === c.catDir)).map((c) => c.label).join('/');
g(['commit', '-m', `feat: 为${nByCat}共 ${written} 条条目补齐百度分享链接`]);
let pushed = false, hash = g(['rev-parse', 'HEAD']).trim(), rebased = false;
const push = () => g(['push', 'origin', 'main'], { timeout: 120000 });
try { push(); pushed = true; }
catch (e) {
  const msg = String(e.stdout || '') + String(e.stderr || '');
  if (/fetch first/.test(msg)) {
    log('push 被拒（fetch first），fetch → rebase → 重推');
    g(['fetch', 'origin']); g(['rebase', 'origin/main']); rebased = true;
    hash = g(['rev-parse', 'HEAD']).trim();
    push(); pushed = true;
  } else { console.error(`推送失败：${msg.slice(-300)}`); report.push = { ok: false, hash }; fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); process.exit(6); }
}
log(`已推送 GitHub：${hash.slice(0, 7)}${rebased ? '（变基后）' : ''}`);
report.push = { ok: true, hash, rebased };

// 7) VPS 即时重建
try {
  const vps = execFileSync('ssh', [process.env.WDP_VPS_HOST || 'site', 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'],
    { encoding: 'utf8', timeout: 240000, maxBuffer: 16e6 });
  const m = vps.match(/发布完成：([0-9a-f]{7,})/);
  report.vps = m ? { ok: true, commit: m[1] } : { ok: false, tail: vps.trim().slice(-300) };
  log(m ? `VPS 发布完成：${m[1]}` : `VPS 输出无「发布完成」：${vps.trim().slice(-200)}`);
} catch (e) {
  report.vps = { ok: false, err: String(e.stderr || e.message).slice(-300) };
  log(`VPS 重建失败（非致命，等 3 小时 cron 兜底）：${report.vps.err}`);
}

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(`\n===== 完成 ===== 出链 ${okItems.length}/${work.length}，写库 ${written}，push ${hash.slice(0, 7)}，VPS ${report.vps && report.vps.ok ? '完成 ' + report.vps.commit : '未完成'}`);
