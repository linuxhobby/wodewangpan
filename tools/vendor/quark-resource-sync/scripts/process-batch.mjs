#!/usr/bin/env node
// 批量入库：编号重命名 → 出链 → 海报 → 写 YAML。
//   node process-batch.mjs --init --scan ~/.workbuddy/quark-sync-cache/match.json [--only mv] [--numbers 74,75,90 | --start 12] [--skip 关键词]
//   node process-batch.mjs [--plan <plan.json>] [--size 20] [--sleep 1500]
// 编号口径（2026-11-04 起）：--numbers 传 scan-new 给出的可补位空洞，按顺序一部一号；空洞用完再顺延。
// 写 YAML 走 lib/yaml-store.mjs 的 upsert：同 id 已存在（补位回收来的死链旧条目）就就地改写，否则追加。
// 只处理 plan 里 status=pending 的条目，完成后写回 plan（status/url/error）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, SKILL, CACHE, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
import { posterDir } from './lib/site-paths.mjs';
import { isJpegFile } from '../../../lib/image-check.mjs';
import { pad3 } from './lib/number.mjs';
import { upsertEntry } from './lib/yaml-store.mjs';

const { PROXY, REPO, SHARE_FID } = cfg;
const CLI = cfg.QUARK_CLI;
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);
const MAKE = path.join(SKILL, 'scripts', 'make-entry.mjs');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PLAN = arg('plan', path.join(CACHE, 'plan.json'));
const SIZE = parseInt(arg('size', '20'), 10);
const SLEEP = parseInt(arg('sleep', '1500'), 10);

const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6, ...opts }, (e, s, x) => (e ? rej(new Error(String(x || e.message).slice(0, 300))) : res(s)))
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** browse 把条目写到 jsonl，返回解析后的数组（与 scan-new.mjs 同款） */
async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run('node', [CLI, ...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    // 旧版 CLI 不认 --task-dir（报 unknown option），回退到默认落盘位置
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run('node', [CLI, ...base]);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').map(JSON.parse);
}

/**
 * 刷新 fid：实测 fid 每次 browse 都轮换（`|` 前那段），用旧 fid 出链会报 code 21001 文件找不到。
 * rename 之后重新 browse 分类目录，按新目录名取最新 fid。
 */
const CAT_DIR = { mv: '电影', tv: '电视剧', dc: '纪录片' };
async function refreshFids(items) {
  const key = CAT_DIR[items[0].id.slice(0, 2)];
  if (!key) return;
  try {
    const roots = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
    const root = roots.find((o) => o.filename.includes(key));
    if (!root) throw new Error(`SHARE 下找不到「${key}」分类目录`);
    const byName = new Map((await browse(root.fid)).map((o) => [o.filename, o.fid]));
    let n = 0;
    for (const p of items) {
      const fresh = byName.get(p.new_name);
      if (fresh && fresh !== p.fid) {
        p.fid = fresh;
        n++;
      } else if (!fresh) {
        console.log(`  ! ${p.id} 未在网盘里找到 ${p.new_name}，沿用旧 fid`);
      }
    }
    console.log(`\nfid 刷新：${n}/${items.length} 条（fid 每次 browse 都轮换，出链必须用最新 fid）`);
  } catch (e) {
    console.log(`\n! fid 刷新失败，沿用扫描时的 fid：${String(e.message).slice(0, 120)}`);
  }
}

/** 电视剧/分集纪录片简介前缀：第几季 / 共多少集（SKILL 2026-10-06 要求） */
function tvSpec(m) {
  const list = Array.isArray(m?.season_list) ? m.season_list.filter((s) => Number(s.season) > 0) : [];
  const nS = Number(m?.seasons || list.length || 0);
  const nE = Number(m?.episodes || list.reduce((a, s) => a + (Number(s.episodes) || 0), 0));
  if (!nE) return nS > 1 ? `【全剧 ${nS} 季】` : '';
  return nS > 1 ? `【全剧 ${nS} 季 · 共 ${nE} 集】` : `【第 ${nS || 1} 季 · 共 ${nE} 集】`;
}

// ---------- 初始化计划 ----------
if (process.argv.includes('--init')) {
  const scanPath = arg('scan', path.join(CACHE, 'match.json'));
  const only = arg('only', 'mv');
  const skip = (arg('skip', '') || '').split('|').filter(Boolean);
  const start = parseInt(arg('start', '12'), 10);
  // 空洞优先（2026-11-04）：--numbers 传 scan-new 给出的可补位空洞（离散、升序、逗号分隔），
  // 数量必须够本轮待处理条数；不给 --numbers 时退回 --start 连续段（老写法，仍可用）。
  const numbers = (arg('numbers', '') || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n > 0);

  const all = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  const list = all.filter(
    (r) => r.prefix === only && !r.likely_duplicate_of && !skip.some((s) => r.filename.includes(s))
  );
  if (numbers.length && numbers.length < list.length)
    throw new Error(`--numbers 只给了 ${numbers.length} 个，待处理 ${list.length} 条：把空洞和顺延编号一起补齐再跑`);

  const plan = list.map((r, i) => {
    const num = numbers.length ? numbers[i] : start + i;
    const padded = pad3(num);
    const id = `${only}-${padded}`;
    return {
      num: padded,
      id,
      fid: r.fid,
      old_name: r.filename,
      new_name: `${padded}-${r.filename}`,
      added: r.updated_at,
      match: r.match,
      status: 'pending',
      url: null,
      error: null,
    };
  });
  fs.mkdirSync(path.dirname(PLAN), { recursive: true });
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));
  console.log(`计划已生成：${plan.length} 条 → ${PLAN}`);
  console.log(
    numbers.length
      ? `编号（离散补位）：${plan.map((p) => `${only}-${p.num}`).join(' ')}`
      : `编号 ${only}-${pad3(start)} ~ ${only}-${pad3(start + plan.length - 1)}`
  );
  plan.slice(0, 5).forEach((p) => console.log(`  ${p.id}  ${p.old_name.slice(0, 60)}`));
  process.exit(0);
}

// ---------- 执行一批 ----------
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const batch = plan.filter((p) => p.status === 'pending').slice(0, SIZE);
if (!batch.length) {
  console.log('没有待处理条目了 ✓');
  process.exit(0);
}

console.log(`本批 ${batch.length} 条（${batch[0].id} ~ ${batch[batch.length - 1].id}）：`);
batch.forEach((p) => console.log(`  ${p.old_name}\n   → ${p.new_name}`));

// 1) 重命名
const itemsFile = path.join(TMP, `batch-rename-${batch[0].num}.json`);
fs.writeFileSync(
  itemsFile,
  JSON.stringify(
    { schema_version: 1, items: batch.map((p) => ({ fid: p.fid, old_name: p.old_name, new_name: p.new_name })) },
    null,
    1
  )
);
try {
  const r = JSON.parse(await run('node', [CLI, 'rename', '--batch-id', crypto.randomBytes(8).toString('hex'), '--items-file', itemsFile]));
  console.log(`\n重命名：${r.data.result_status} ${r.data.success_count}/${r.data.total}`);
  if (r.data.fail_count) throw new Error(`重命名失败 ${r.data.fail_count} 条，已中止`);
} catch (e) {
  console.error('重命名失败，未改动网盘数据：', e.message);
  process.exit(1);
}

// 1.5) 刷新 fid（rename 之后 fid 已变，出链前必须重新取）
await refreshFids(batch);

// 2) 出链（逐条，间隔降低风控）
for (const p of batch) {
  // 简介下限 150 字是**补齐线，不是筛选线**（2026-11-12 定夺，与 trending-sync 同口径）：
  // match-batch 已用同一次 detail 的真实字段把短简介补到 ≥150 字（match.desc_body），
  // 这里绝不因文案短而不入库；补料仍不够 150 的只打警告，留给人工补写。
  const body = (p.match?.desc_body || p.match?.overview || '').replace(/\s+/g, ' ').trim();
  if ([...body].length < 150) {
    p.desc_short = true;
    console.log(`  ${p.id} ⚠ 简介补料后仍仅 ${[...body].length} 字（<150），照常出链入库，需人工补写`);
  }
  try {
    const s = JSON.parse(await run('node', [CLI, 'share', p.fid, '--title', p.new_name, '--url-type', '1', '--expired-type', '1']));
    p.url = s.data.share_url;
    console.log(`  ${p.id} → ${p.url}`);
  } catch (e) {
    p.error = `share失败: ${e.message.slice(0, 80)}`;
    console.log(`  ${p.id} ❌ ${p.error}`);
  }
  await sleep(SLEEP);
}

// 3) 海报
// 配图按分类 slug 分目录（2026-11-15 起），见 scripts/lib/site-paths.mjs
await Promise.all(
  batch.map(async (p) => {
    if (!p.match?.poster_url) {
      p.poster = null;
      return;
    }
    const destDir = posterDir(REPO, p.id);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${p.id}.jpg`);
    try {
      await run('curl', ['-s', ...(PROXY ? ['-x', PROXY] : []), '-o', dest, p.match.poster_url]);
      if (!isJpegFile(dest)) throw new Error('不是有效 JPEG');
      p.poster = `${p.id}.jpg`;
    } catch {
      try {
        await run('curl', ['-s', ...(PROXY ? ['-x', PROXY] : []), '-o', dest, p.match.poster_url]);
        p.poster = isJpegFile(dest) ? `${p.id}.jpg` : null;
      } catch {
        p.poster = null;
      }
    }
  })
);
console.log(`\n海报：成功 ${batch.filter((p) => p.poster).length}/${batch.length}`);

// 4) 写 YAML
const fileMap = { mv: 'movie.yaml', tv: 'tv.yaml', dc: 'documentary.yaml' };
const dataFile = path.join(REPO, 'data', fileMap[batch[0].id.slice(0, 2)]);
const catMap = { mv: '电影', tv: '电视剧', dc: '纪录片' };
let written = 0;
for (const p of batch) {
  if (!p.url) continue;
  const m = p.match;
  // 正文优先用 match-batch 补齐过的 desc_body（不足 150 字时由 TMDB 真实字段扩写），没有才退回 overview 原文
  const overview = (m?.desc_body || m?.overview || '').replace(/\s+/g, ' ').trim();
  // 完整简介（写入上限 700 字，2026-11-12 起从 1200 下调；站点构建护栏 scripts/lib/data.js 的 MAX_DESC 仍留 1200，只兜底不砍存量）；详情页正文不截断，列表卡片与 meta 由构建脚本自行截取
  const spec = /^(tv|dc)-/.test(p.id) ? tvSpec(m) : '';
  const desc = spec + (overview.length > 700 ? overview.slice(0, 700) + '…' : overview) + `｜TMDB ${Number(m?.vote || 0).toFixed(1)}`;
  const data = {
    id: p.id,
    title: m?.title || p.old_name.replace(/^\d+-/, ''),
    category: catMap[p.id.slice(0, 2)],
    tags: [catMap[p.id.slice(0, 2)], ...(m?.genres || []).slice(0, 3), ...(m ? [`${m.title} ${m.original}`] : [])],
    quark_url: p.url,
    description: desc,
    date: m?.date || p.added,
    added: p.added,
    image: p.poster || '',
  };
  if (!data.image) delete data.image;
  try {
    const y = await run('node', [MAKE, '--data', JSON.stringify(data)]);
    // 空洞补位时同 id 旧条目（死链）就地改写，正常新增仍是追加（lib/yaml-store.mjs）
    const res = upsertEntry(dataFile, p.id, y);
    p.yaml_mode = res.mode;
    if (res.mode === 'replaced') console.log(`  ↻ ${p.id} 已就地改写站点旧条目（补位回收的死链）`);
    p.status = 'done';
    written++;
  } catch (e) {
    p.error = `YAML失败: ${e.message.slice(0, 120)}`;
    console.log(`  ${p.id} ❌ ${p.error}`);
  }
}
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));

const left = plan.filter((p) => p.status === 'pending').length;
console.log(`\n已写入 ${written} 条 → ${dataFile}`);
console.log(`计划剩余 ${left} 条；下一批起始 ${left ? plan.find((p) => p.status === 'pending').id : '—'}`);
