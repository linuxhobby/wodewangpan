#!/usr/bin/env node
// 对「分享链接失效」或「出链后目录被改名」的条目统一重新出链，并改写 data/*.yaml 的 quark_url。
//
// 出链前必须重新 browse 取 fid（fid 每次 browse 都会轮换），且 browse 与 share 在同一个进程里连续完成。
//
// 用法：
//   node reshare-batch.mjs --from-check              # 取 cache/check-share-links-last.json 里有问题的条目
//   node reshare-batch.mjs --from-check --issue renamed
//   node reshare-batch.mjs --ids mv-124 tv-077       # 指定条目
//   node reshare-batch.mjs --from-check --apply      # 顺便把新链接写回 data/*.yaml
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cfg, requireCfg, CACHE, QUARK_TASK_DIR } from './lib/config.mjs';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const list = (k) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${k}`) out.push(argv[i + 1]);
  return out;
};
const CLI = cfg.QUARK_CLI;
const SHARE_FID = cfg.SHARE_FID;
const REPO = cfg.REPO;
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);
const APPLY = has('apply');

const CATS = {
  mv: { dir: '04电影', file: 'movie.yaml' },
  tv: { dir: '03电视剧', file: 'tv.yaml' },
  dc: { dir: '06纪录片', file: 'documentary.yaml' },
  an: { dir: '05动漫', file: 'anime.yaml' },
  game: { dir: '01游戏', file: 'game.yaml' },
  app: { dir: '02应用', file: 'software.yaml' },
  bk: { dir: '08电子书', file: 'ebook.yaml' },
  ot: { dir: '010其他', file: 'misc.yaml' },
  // os：2026-11-10「操作系统」并入「软件」后的历史前缀。盘端已没有 `09操作系统` 目录，
  // 这 11 份资源住在 `02应用`，而且**目录号 ≠ id 尾号**（os-001 → 134-windows10），
  // 所以只能从条目的 `disk_dir` 字段取真实目录名来定位，不能再用 id 尾号去找 `0NN-`。
  os: { dir: '02应用', file: 'software.yaml', legacy: true },
  cs: { dir: '07课程', file: 'course.yaml' },
};
const prefixOf = (id) => String(id).replace(/-\d+$/, '');
const numOf = (id) => parseInt(String(id).match(/-(\d+)$/)?.[1] || '0', 10);

// 待处理条目
const targets = [];
if (has('from-check')) {
  const j = JSON.parse(fs.readFileSync(path.join(CACHE, 'check-share-links-last.json'), 'utf8'));
  const issues = list('issue').length ? list('issue') : ['broken', 'renamed'];
  for (const r of j.results) if (r.issue && issues.includes(r.issue)) targets.push({ id: r.id, old: r.url, issue: r.issue, old_title: r.share_title, cur: r.cur_name });
}
for (const id of list('ids')) {
  if (!targets.some((t) => t.id === id)) targets.push({ id, old: '', issue: 'manual' });
}
if (!targets.length) {
  console.error('没有待处理条目：用 --from-check 或 --ids <id>');
  process.exit(1);
}

const run = (args) =>
  new Promise((res, rej) => execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s) => (e ? rej(e) : res(s))));
/** 同 run，但失败时也要拿 stdout（CLI 出错会把 msg 打在 stdout 上并以非零码退出） */
const runSoft = (args) =>
  new Promise((res) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s = '', se = '') => res(s || se || String(e)))
  );
async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run([...base, '--task-dir', QUARK_TASK_DIR]);
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error('browse 未返回 jsonl');
  return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').map(JSON.parse);
}

const top = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
// 历史并入条目（os-）的盘端目录名记在条目 `disk_dir` 里，先建 id → disk_dir 表
const legacyDirOf = new Map();
if (targets.some((t) => CATS[prefixOf(t.id)]?.legacy)) {
  const req = createRequire(path.join(REPO, 'package.json'));
  const ym = req('js-yaml');
  for (const f of new Set(targets.map((t) => CATS[prefixOf(t.id)]?.file).filter(Boolean))) {
    const p = path.join(REPO, 'data', f);
    if (!fs.existsSync(p)) continue;
    for (const e of ym.load(fs.readFileSync(p, 'utf8')) || [])
      if (e?.id && e?.disk_dir) legacyDirOf.set(String(e.id), String(e.disk_dir));
  }
}
const byCat = new Map();
for (const t of targets) {
  const p = prefixOf(t.id);
  const c = CATS[p];
  if (!c) {
    console.log(`✖ ${t.id} 未知前缀`);
    continue;
  }
  if (!byCat.has(p)) byCat.set(p, []);
  byCat.get(p).push(t);
}

const done = [];
const failed = [];
for (const [prefix, ts] of byCat) {
  const c = CATS[prefix];
  const d = top.find((o) => o.filename === c.dir);
  if (!d) {
    console.log(`✖ 找不到分类目录 ${c.dir}`);
    continue;
  }
  const items = (await browse(d.fid)).filter((o) => String(o.file_type) === '0');
  for (const t of ts) {
    let pad;
    if (c.legacy) {
      const ld = legacyDirOf.get(t.id);
      if (!ld) {
        console.log(`✖ ${t.id} 是历史并入条目，但条目里没有 disk_dir，无法定位盘端目录（先补 disk_dir 再出链）`);
        continue;
      }
      pad = String(ld).match(/^(\d+)/)?.[1].padStart(3, '0');
    } else {
      pad = String(numOf(t.id)).padStart(3, '0');
    }
    const hit = items.find((o) => String(o.filename).startsWith(pad + '-'));
    if (!hit) {
      console.log(`✖ ${t.id} 网盘里找不到 ${pad}- 目录`);
      continue;
    }
    // CLI 出错时会以非零码退出，这里要把 stdout 也拿到才能看到 msg
    const out = await runSoft(['share', hit.fid, '--title', hit.filename, '--url-type', '1', '--expired-type', '1']);
    const m = String(out).match(/\{[\s\S]*"action"\s*:\s*"share"[\s\S]*\}/) || String(out).match(/\{[\s\S]*\}/);
    let url = '';
    let msg = '';
    try {
      const j = JSON.parse(m[0]);
      url = j?.data?.share_url || '';
      msg = j?.msg || '';
      if (j.code !== 0 || !url) throw new Error(msg || `code=${j.code}`);
    } catch (err) {
      const why = msg || String(out).slice(0, 200);
      console.log(`✖ ${t.id} 出链失败：${why}`);
      failed.push({ id: t.id, dir: hit.filename, file: c.file, msg: why });
      continue;
    }
    const rec = { id: t.id, dir: hit.filename, old_url: t.old, new_url: url, issue: t.issue, file: c.file };
    done.push(rec);
    console.log(`${t.id}  ${hit.filename}\n   ${t.old || '(失效)'} → ${url}${t.old === url ? '  （链接未变）' : ''}`);
  }
}

fs.writeFileSync(path.join(CACHE, 'reshare-last.json'), JSON.stringify({ at: new Date().toISOString(), done, failed }, null, 1));
if (failed.length) console.log(`\n出链失败 ${failed.length} 条：${failed.map((f) => f.id).join(', ')}（见报告）`);

if (APPLY && done.length) {
  const req = createRequire(path.join(REPO, 'package.json'));
  const yaml = req('js-yaml');
  const files = [...new Set(done.map((r) => r.file))];
  for (const f of files) {
    const p = path.join(REPO, 'data', f);
    let text = fs.readFileSync(p, 'utf8');
    let n = 0;
    for (const r of done.filter((x) => x.file === f)) {
      // --ids 手动模式没有 from-check 报告里的 old_url，现场从 YAML 读该 id 当前的 quark_url
      if (!r.old_url) {
        const doc = yaml.load(text) || [];
        const entry = doc.find((e) => e && String(e.id) === String(r.id));
        if (entry?.quark_url) r.old_url = String(entry.quark_url);
      }
      if (!r.old_url || r.old_url === r.new_url) continue;
      const all = text.split(r.old_url).length - 1;
      if (all !== 1) {
        console.log(`⚠ ${r.id} 旧链接出现 ${all} 次，跳过（需人工处理）`);
        continue;
      }
      text = text.replace(r.old_url, r.new_url);
      n++;
    }
    if (!n) continue;
    // 写前自检：YAML 仍能被解析且条目数不变
    const before = (yaml.load(fs.readFileSync(p, 'utf8')) || []).length;
    const after = (yaml.load(text) || []).length;
    if (before !== after) throw new Error(`${f} 解析条目数不一致，已中止`);
    fs.writeFileSync(p, text);
    console.log(`✓ ${f} 已更新 ${n} 条链接`);
  }
} else {
  console.log('\n（未写回 YAML，加 --apply 落盘）');
}
