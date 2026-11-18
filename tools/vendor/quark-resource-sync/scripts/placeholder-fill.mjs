#!/usr/bin/env node
// 扫描网盘目录，给「还没有资源」的目录补齐占位说明 md（2026-11-08 起两份，缺哪份补哪份）。
// 场景：trending-sync 每天建的新目录此刻是空的；老目录若资源被清掉也该有说明。
//
// 用法：
//   node placeholder-fill.mjs --dry          # 只扫描，列出待补清单，不上传
//   node placeholder-fill.mjs                # 扫描并补齐
//   node placeholder-fill.mjs --scope today  # 只处理今天入库的条目（默认：今天入库的电影/动漫 + 电视剧全量）
//   node placeholder-fill.mjs --scope anime-all  # 单独扫 05动漫 全量
//   node placeholder-fill.mjs --scope all    # 电影+电视剧+动漫全量（存量回补用，一次十几分钟）
//   node placeholder-fill.mjs --only 资源缺失反馈   # 只补名字包含该串的那份占位（存量回补口径）
//   node placeholder-fill.mjs --include-filled --only 我的网盘网址
//       # 连「已有真实资源」的目录也补——但只会补 lib/placeholder.mjs 里标了 forFilledDirs 的那几份
//       # （站点导流）；道歉类说明即便加了本开关也不会进正片目录。
//   node placeholder-fill.mjs --limit 20     # 最多处理 N 个目录（调试用）
//
// 判定「没有资源」：目录内不存在任何「非 .md 的文件」，且不存在子目录。
// 两份占位 md 都齐的目录跳过；只缺其中一份的，单独补那一份（不会重复上传）。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, CACHE, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
import { resolvePlaceholders, missingPlaceholders, placeholdersForFilledDirs } from './lib/placeholder.mjs';

const { REPO, SHARE_FID } = cfg;
const CLI = cfg.QUARK_CLI;
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const DRY = has('dry');
const SCOPE = arg('scope', 'default'); // default | today | tv-all | movie-all | anime-all | all
const IDS_RAW = arg('ids', ''); // mv-427,tv-003 —— 只处理这些条目对应的编号目录（单目录试写/定点回补用）
const IDS = new Set(
  IDS_RAW.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => `${id.split('-')[0]}:${parseInt(id.split('-')[1], 10)}`)
);
if (IDS_RAW && !IDS.size) { console.error('--ids 解析后为空，检查写法（如 mv-427,tv-003）'); process.exit(1); }
const LIMIT = parseInt(arg('limit', '0'), 10);
const MOVIE_DIR = arg('movie-dir', '04电影');
const TV_DIR = arg('tv-dir', '03电视剧');
const ANIME_DIR = arg('anime-dir', '05动漫');
const PLACEHOLDERS = resolvePlaceholders(arg('placeholder-name', ''), arg('placeholder-text', ''));
// 只补名字包含该串的那几份。存量回补的口径（2026-11-08 将军定夺）：长期空着的目录只补
// 「资源缺失反馈请加QQ群…」，不再写「24小时内补齐」这种已经不成立的承诺 → 用 --only 资源缺失反馈。
const ONLY = arg('only', '');
const TARGETS = ONLY ? PLACEHOLDERS.filter((f) => f.name.includes(ONLY)) : PLACEHOLDERS;
if (ONLY && !TARGETS.length) { console.error(`--only ${ONLY} 没匹配到任何占位文件，可用：${PLACEHOLDERS.map((f) => f.name).join(' / ')}`); process.exit(1); }
// 对「已有真实资源」的目录也补占位——实际只会补标了 forFilledDirs 的那几份（站点导流），
// 道歉类说明（24小时内补齐 / 资源缺失反馈）不会被这个开关放进正片目录。
const INCLUDE_FILLED = has('include-filled');

// 本地时区的 YYYY-MM-DD：与 trending-sync 写入的 added 保持同一时区口径
const TODAY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const SID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
const SESSION_INPUT = '检查今天入库的电影、电视剧与动漫，以及电视剧目录下的其他电视剧，如果没有资源，填补md文件。';

const run = (bin, args) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6 }, (e, s, x) =>
      e ? rej(new Error(String(x || e.message).slice(0, 300))) : res(s)
    )
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (args, opts = {}) =>
  run(process.execPath, [CLI, ...args, '--session-input', SESSION_INPUT, '--session-id', SID], opts);

async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await q([...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    // 旧版 CLI 不认 --task-dir（报 unknown option），回退到默认落盘位置
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return q(base);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  const p = JSON.parse(`"${m[1]}"`);
  if (!fs.existsSync(p)) return [];
  const txt = fs.readFileSync(p, 'utf8').trim();
  if (!txt) return [];
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** 站点 yaml 里今天入库的条目 id → 编号 */
function todayNums(file) {
  const p = path.join(REPO, 'data', file);
  if (!fs.existsSync(p)) return new Set();
  const raw = fs.readFileSync(p, 'utf8');
  const out = new Set();
  for (const part of raw.split(/(?=^- id: )/m)) {
    const idm = part.match(/^- id:\s*(\S+)/m);
    // yaml 里 added 是带引号的（added: "2026-10-31 03:40"），旧正则不认引号会漏掉全部条目
    const adm = part.match(/^\s*added:\s*"?([\d-]+)/m);
    if (!idm || !adm) continue;
    if (adm[1] !== TODAY) continue;
    const n = parseInt(String(idm[1]).split('-')[1], 10);
    if (!Number.isNaN(n)) out.add(n);
  }
  return out;
}

const numOf = (name) => {
  const m = String(name).match(/^(\d+)\s*[-.]/);
  return m ? parseInt(m[1], 10) : null;
};

/** 目录内是否已有实际资源（非 .md 的文件 或 子目录） */
const hasResource = (items) =>
  items.some((o) => String(o.file_type) === '0') ||
  items.some((o) => String(o.file_type) !== '0' && !/\.md$/i.test(String(o.filename || '')));

/** 目录内缺哪些占位 md（默认只在本轮 TARGETS 范围内判定） */
const missingPh = (items, files = TARGETS) => missingPlaceholders(items.map((o) => String(o.filename || '')), files);

async function uploadPlaceholder(fid, ph) {
  const mdPath = path.join(TMP, ph.name);
  try {
    fs.writeFileSync(mdPath, ph.text, 'utf8');
    const out = await q(['upload', mdPath, '--parent-fid', fid]);
    const objs = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    const last = objs[objs.length - 1];
    if (last && (last.code === 0 || last.code === '0')) return 'ok';
    return `失败：${last?.msg || out.slice(0, 120)}`;
  } finally {
    try { fs.rmSync(mdPath, { force: true }); } catch {}
  }
}

// ---------- 从上次报告直接补（省掉重新扫描，扫描一次要十几分钟） ----------
const REPORT = path.join(CACHE, 'placeholder-fill-last.json');
if (has('from-last')) {
  if (!fs.existsSync(REPORT)) {
    console.log(`没有上次的扫描报告：${REPORT}`);
    process.exit(1);
  }
  const prev = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const list = prev.empty || [];
  if (!list.length) {
    console.log('上次报告里没有待补目录，无需操作。');
    process.exit(0);
  }
  console.log(`按上次报告补 md：${list.length} 个目录\n`);
  const ok = [];
  const bad = [];
  let n = 0;
  for (const t of list) {
    n++;
    // 精确补：只传报告里记录为缺失的那几份，绝不重复上传同名文件（夸克会生成 xxx(1).md）。
    // 老报告没有 missing 字段 → 单独 browse 这一个目录确认缺口（比全量扫描便宜得多），
    // 且必须重新按 hasResource 分类：否则 --include-filled 会把道歉说明传进正片目录。
    let todo;
    if (Array.isArray(t.missing)) {
      todo = TARGETS.filter((p) => t.missing.includes(p.name));
    } else {
      try {
        const its = await browse(t.fid);
        todo = hasResource(its)
          ? (INCLUDE_FILLED ? missingPh(its, placeholdersForFilledDirs(TARGETS)) : [])
          : missingPh(its);
      } catch (e) {
        bad.push({ ...t, error: `browse 失败：${String(e.message).slice(0, 100)}` });
        process.stdout.write(`[${n}/${list.length}] ✗ ${t.name} browse 失败\n`);
        continue;
      }
    }
    if (!todo.length) {
      ok.push(t);
      process.stdout.write(`[${n}/${list.length}] = ${t.name} 已齐全，无需补\n`);
      continue;
    }
    const errs = [];
    for (const ph of todo) {
      const r = await uploadPlaceholder(t.fid, ph).catch((e) => `异常：${String(e.message).slice(0, 120)}`);
      if (r !== 'ok') errs.push(`${ph.name}：${r}`);
      await sleep(300);
    }
    if (!errs.length) {
      ok.push({ ...t, missing: todo.map((p) => p.name) });
      process.stdout.write(`[${n}/${list.length}] + ${t.name}（补 ${todo.length} 份）\n`);
    } else {
      bad.push({ ...t, error: errs.join(' / ').slice(0, 150) });
      process.stdout.write(`[${n}/${list.length}] ✗ ${t.name} → ${errs.join(' / ').slice(0, 120)}\n`);
    }
  }
  console.log('\n===== 汇总 =====');
  console.log(`补齐成功：${ok.length} 个；失败：${bad.length} 个`);
  bad.forEach((b) => console.log(`  ${b.name}：${b.error}`));
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ ...prev, filled_from_last_at: new Date().toISOString(), filled: ok, errors: bad }, null, 1)
  );
  process.exit(0);
}

// ---------- 主流程 ----------
const shareDirs = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
const findDir = (name) => shareDirs.find((d) => d.filename === name);
const mvRoot = findDir(MOVIE_DIR);
const tvRoot = findDir(TV_DIR);
const anRoot = findDir(ANIME_DIR);
if (!mvRoot && !tvRoot && !anRoot) {
  console.log('未找到分类目录，实际有：', shareDirs.map((d) => d.filename).join(' / '));
  process.exit(1);
}
console.log(`分类目录 → 电影:${mvRoot?.filename || '(无)'}  电视剧:${tvRoot?.filename || '(无)'}  动漫:${anRoot?.filename || '(无)'}`);

const todayMovie = todayNums('movie.yaml');
const todayTv = todayNums('tv.yaml');
const todayAnime = todayNums('anime.yaml');
console.log(`今天(${TODAY})入库 → 电影 ${todayMovie.size} 条，电视剧 ${todayTv.size} 条，动漫 ${todayAnime.size} 条`);

const targets = [];
// 三类目录一张表跑完（2026-11-08 收敛重复代码）。set=null 表示该分类全量；
// 给了 --ids 时忽略 scope 集合，只认 id 命中的编号（单目录试写 / 定点回补用）。
// --cats all / --cats 06纪录片,02应用 → 改成覆盖 SHARE 下任意分类目录（2026-11-08 晚加，
// 将军要求三份占位铺满全部 10 个分类共 927 个编号目录；99- 待删除分类永不处理）。
// 2026-11-10 起分类并成 9 个（「操作系统」并入「软件」，`09操作系统` 目录已删）；`all` 是
// 现扫 SHARE 目录得到的，不需要改代码，上面的历史数字仅作背景。
const CATS_RAW = arg('cats', '');
if (CATS_RAW && IDS.size) { console.error('--cats 与 --ids 不能同时用：--ids 靠站点 id 定位编号，只支持影视三类'); process.exit(1); }
let CAT_PLAN = [
  { root: mvRoot, kind: '电影', prefix: 'mv', set: SCOPE === 'movie-all' || SCOPE === 'all' ? null : todayMovie },
  { root: tvRoot, kind: '电视剧', prefix: 'tv', set: SCOPE === 'today' ? todayTv : null }, // 默认电视剧全量
  { root: anRoot, kind: '动漫', prefix: 'an', set: SCOPE === 'anime-all' || SCOPE === 'all' ? null : todayAnime },
];
if (CATS_RAW) {
  const want = CATS_RAW.trim() === 'all'
    ? shareDirs.map((d) => d.filename).filter((n) => !/^99-/.test(String(n)))
    : CATS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
  CAT_PLAN = [];
  for (const n of want) {
    const r = findDir(n);
    if (!r) { console.log(`! 分类目录「${n}」在 SHARE 下不存在，跳过（实际有：${shareDirs.map((d) => d.filename).join(' / ')}）`); continue; }
    CAT_PLAN.push({ root: r, kind: n, prefix: null, set: null }); // 全量，不按 added 过滤
  }
  if (!CAT_PLAN.length) { console.error('--cats 选出来的分类目录一个都不存在，结束'); process.exit(1); }
  console.log(`--cats → 覆盖 ${CAT_PLAN.length} 个分类：${CAT_PLAN.map((c) => c.kind).join(' / ')}`);
}
if (IDS.size) console.log(`--ids 指定 ${IDS.size} 条，忽略 scope 过滤`);
for (const c of CAT_PLAN) {
  if (!c.root) continue;
  const items = (await browse(c.root.fid)).filter((o) => String(o.file_type) === '0');
  const set = IDS.size ? null : c.set;
  for (const o of items) {
    const n = numOf(o.filename);
    if (n == null) continue; // 未编号的目录不碰
    if (set && !set.has(n)) continue;
    if (IDS.size && !IDS.has(`${c.prefix}:${n}`)) continue;
    targets.push({ kind: c.kind, num: n, name: o.filename, fid: o.fid });
  }
}
if (IDS.size && !targets.length) {
  console.log(`--ids 在三个分类里没匹配到任何编号目录（${[...IDS].join(' / ')}）——确认 id 与分类是否对应，或该网盘目录是否已不存在`);
  process.exit(1);
}
const KIND_ORDER = { 电影: 0, 电视剧: 1, 动漫: 2 };
targets.sort((a, b) =>
  a.kind === b.kind ? a.num - b.num : (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
);
const list = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
console.log(`\n待检查目录：${list.length} 个${LIMIT > 0 ? `（limit ${LIMIT}）` : ''}\n`);

const empty = [];
const filled = [];
const had = [];
const errors = [];
let i = 0;
for (const t of list) {
  i++;
  let items;
  try {
    items = await browse(t.fid);
  } catch (e) {
    errors.push({ ...t, error: String(e.message).slice(0, 120) });
    console.log(`[${i}/${list.length}] ✗ ${t.name} browse 失败：${String(e.message).slice(0, 80)}`);
    continue;
  }
  const res = hasResource(items);
  let miss = missingPh(items);
  if (res) {
    // --include-filled：只对「标了 forFilledDirs 的那几份」（站点导流）放宽有资源早退；
    // 「24小时内补齐 / 资源缺失反馈」永远不进正片目录，即便加了本开关也不会（见 lib/placeholder.mjs）
    const also = INCLUDE_FILLED ? missingPh(items, placeholdersForFilledDirs(TARGETS)) : [];
    if (!also.length) {
      process.stdout.write(`[${i}/${list.length}] · ${t.name} 有资源\n`);
      continue;
    }
    t.hadResource = true;
    t.missing = also.map((p) => p.name);
    empty.push(t);
    if (DRY) {
      process.stdout.write(`[${i}/${list.length}] ! ${t.name} 已有资源但仍缺 ${also.length} 份占位 md → 待补（dry）\n`);
      continue;
    }
  } else if (!miss.length) {
    had.push(t);
    process.stdout.write(`[${i}/${list.length}] ✓ ${t.name} 占位 md 齐全\n`);
    continue;
  } else {
    t.missing = miss.map((p) => p.name); // 供 --from-last 精确补，避免重复上传同名文件
    empty.push(t);
    if (DRY) {
      process.stdout.write(`[${i}/${list.length}] ! ${t.name} 缺 ${miss.length} 份占位 md → 待补（dry）\n`);
      continue;
    }
  }
  const todo = (t.missing || []).map((n) => TARGETS.find((p) => p.name === n)).filter(Boolean);
  const errs = [];
  for (const ph of todo) {
    const r = await uploadPlaceholder(t.fid, ph).catch((e) => `异常：${String(e.message).slice(0, 120)}`);
    if (r !== 'ok') errs.push(`${ph.name}：${r}`);
    await sleep(300);
  }
  if (errs.length) {
    errors.push({ ...t, error: errs.join(' / ').slice(0, 150) });
    process.stdout.write(`[${i}/${list.length}] ✗ ${t.name} 上传失败：${errs.join(' / ').slice(0, 120)}\n`);
  } else {
    filled.push(t);
    process.stdout.write(`[${i}/${list.length}] + ${t.name} 已补 ${todo.length} 份${t.hadResource ? '（正片目录）' : ''}（${t.missing.join(' + ')}）\n`);
  }
}

const phFileCount = (arr) => arr.reduce((s, t) => s + (Array.isArray(t.missing) ? t.missing.length : 1), 0);
console.log('\n===== 汇总 =====');
console.log(`检查目录：${list.length} 个`);
console.log(`已有资源（不动）：${list.length - empty.length - had.length - errors.filter((e) => !e.upload).length} 个`);
console.log(
  `本${DRY ? '应' : '次'}补 md：${DRY ? empty.length : filled.length} 个目录 / ${DRY ? phFileCount(empty) : phFileCount(filled)} 份文件`
);
const srcEmpty = (DRY ? empty : filled).filter((t) => !t.hadResource).length;
const srcFilled = (DRY ? empty : filled).filter((t) => t.hadResource).length;
console.log(`  来源：空壳目录 ${srcEmpty} 个 / 已有正片的目录 ${srcFilled} 个${INCLUDE_FILLED ? '' : '（未加 --include-filled，正片目录一律不动）'}`);
if (empty.length) {
  console.log('待补目录清单：');
  empty.slice(0, 50).forEach((t) => console.log(`  ${t.kind} ${t.name}${t.missing ? `（缺 ${t.missing.length} 份）` : ''}`));
  if (empty.length > 50) console.log(`  …其余 ${empty.length - 50} 个见报告`);
}
if (had.length) {
  console.log(`占位 md 已齐全（跳过）：${had.length} 个`);
  had.slice(0, 20).forEach((t) => console.log(`  ${t.kind} ${t.name}`));
  if (had.length > 20) console.log(`  …其余 ${had.length - 20} 个见报告`);
}
if (errors.length) {
  console.log(`异常：${errors.length} 个`);
  errors.forEach((e) => console.log(`  ${e.name}：${e.error}`));
}

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(
  path.join(CACHE, 'placeholder-fill-last.json'),
  JSON.stringify({ ran_at: new Date().toISOString(), dry: DRY, scope: SCOPE, empty, filled, had, errors }, null, 1)
);
console.log(`报告：${path.join(CACHE, 'placeholder-fill-last.json')}`);
