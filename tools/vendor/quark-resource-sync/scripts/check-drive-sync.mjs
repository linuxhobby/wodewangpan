#!/usr/bin/env node
// 核对「夸克网盘 SHARE 目录现状」与「站点 data/*.yaml」是否一致。
// 用途：用户在网盘里重命名/改编号之后，找出需要重新出链或改数据的条目。
//
// 用法：
//   node check-drive-sync.mjs                # 全量核对，打印差异
//   node check-drive-sync.mjs --all          # 连一致的也列出
//   node check-drive-sync.mjs --out <file>   # 结果写 JSON
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cfg, requireCfg, TMP, QUARK_TASK_DIR } from './lib/config.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CLI = cfg.QUARK_CLI;
const SHARE_FID = arg('share-fid', cfg.SHARE_FID);
const REPO = cfg.REPO;
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);
const OUT = arg('out', path.join(TMP, 'check-drive-sync.json'));

const run = (args) =>
  new Promise((res, rej) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s) => (e ? rej(e) : res(s)))
  );

async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run([...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run(base);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  return fs
    .readFileSync(JSON.parse(`"${m[1]}"`), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
}

// 网盘 SHARE 分类目录 → 站点数据文件（2026-11-10 起 9 个分类：「操作系统」已并入「软件」，
// `09操作系统` 目录与 `data/os.yaml` 都不存在了；11 条 `os-` 条目物理住在 `02应用`，靠 disk_dir 认领）
const CATS = [
  { dir: '04电影', key: '电影', prefix: 'mv', file: 'movie.yaml' },
  { dir: '03电视剧', key: '电视剧', prefix: 'tv', file: 'tv.yaml' },
  { dir: '06纪录片', key: '纪录片', prefix: 'dc', file: 'documentary.yaml' },
  { dir: '05动漫', key: '动漫', prefix: 'an', file: 'anime.yaml' },
  { dir: '01游戏', key: '游戏', prefix: 'game', file: 'game.yaml' },
  { dir: '02应用', key: '软件', prefix: 'app', file: 'software.yaml' },
  { dir: '08电子书', key: '电子书', prefix: 'bk', file: 'ebook.yaml' },
  { dir: '010其他', key: '其他', prefix: 'ot', file: 'misc.yaml' },
  { dir: '07课程', key: '课程', prefix: 'cs', file: 'course.yaml' },
];

const norm = (s) =>
  String(s)
    .replace(/^\d+\s*[-.]/, '')
    .replace(/[\[\(【].*?[\]\)】]/g, '')
    .replace(/[\s·・:：\-_.]/g, '')
    .toLowerCase();
const numOf = (name) => parseInt(String(name).match(/^(\d+)\s*[-.]/)?.[1] || '0', 10);
// 注意：这里不再有「剥掉字母前缀取尾号」的 idNum —— 2026-11-10 起同一份 yaml 里可能住着
// 两种前缀（software.yaml = app- + os-），只按尾号建索引必然撞车，改用下面的 idParts 按前缀分流。

// js-yaml 在站点仓库的 node_modules 里，用 createRequire 指过去加载
const yaml = (() => {
  const req = createRequire(path.join(REPO, 'package.json'));
  try {
    return req('js-yaml');
  } catch {
    return req(path.join(REPO, 'node_modules', 'js-yaml', 'index.js'));
  }
})();

const top = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
const report = { scanned_at: new Date().toISOString(), categories: [] };

for (const c of CATS) {
  const d = top.find((o) => o.filename === c.dir);
  if (!d) {
    report.categories.push({ ...c, missing_dir: true });
    console.log(`【${c.dir}】⚠ SHARE 下找不到该分类目录`);
    continue;
  }
  const items = (await browse(d.fid)).filter((o) => String(o.file_type) === '0');
  const dirByNum = new Map();
  for (const o of items) {
    const n = numOf(o.filename);
    if (n) dirByNum.set(n, o);
  }
  const entries = yaml.load(fs.readFileSync(path.join(REPO, 'data', c.file), 'utf8')) || [];
  // 只认本分类前缀的条目。2026-11-10「操作系统」并入「软件」后，software.yaml 里同时住着
  // app- 和 os- 两套尾号，按尾号建索引会互相顶掉（os-001 会盖掉 app-001），对账就成了假告警。
  const idParts = (id) => String(id).match(/^([a-zA-Z]+)-(\d+)$/);
  const entByNum = new Map();
  const legacy = []; // 前缀与本分类不同的历史条目（os-001~os-011 物理住在 02应用）
  for (const e of entries) {
    const m = idParts(e.id);
    if (!m) continue;
    if (m[1].toLowerCase() === c.prefix.toLowerCase()) entByNum.set(Number(m[2]), e);
    else legacy.push(e);
  }
  // 历史并入的条目「盘端目录号 ≠ id 尾号」，一律按条目里的 disk_dir 认领
  const legacyByNum = new Map();
  for (const e of legacy) {
    const n = Number(String(e.disk_dir || '').match(/^(\d+)/)?.[1] || 0);
    if (n) legacyByNum.set(n, e);
  }

  const rows = [];
  for (const [n, e] of entByNum) {
    const o = dirByNum.get(n);
    if (!o) {
      rows.push({ id: e.id, title: e.title, issue: 'no_dir', detail: `网盘里没有 ${String(n).padStart(3, '0')}- 目录` });
      continue;
    }
    const dn = norm(o.filename);
    const tn = norm(e.title);
    const ok = dn === tn || dn.startsWith(tn) || tn.startsWith(dn) || (tn.length >= 3 && dn.includes(tn));
    rows.push({
      id: e.id,
      title: e.title,
      dir: o.filename,
      fid: o.fid,
      quark_url: e.quark_url || '',
      ok,
      issue: ok ? null : 'name_diff',
    });
  }
  for (const [n, o] of dirByNum) {
    if (entByNum.has(n)) continue;
    const le = legacyByNum.get(n);
    if (le) {
      // 历史并入：目录号来自 disk_dir，名称应与 disk_dir 完全一致
      const ok = norm(o.filename) === norm(le.disk_dir);
      rows.push({
        id: le.id,
        title: le.title,
        dir: o.filename,
        fid: o.fid,
        quark_url: le.quark_url || '',
        legacy: true,
        ok,
        issue: ok ? null : 'name_diff',
        detail: ok ? '历史并入条目，按 disk_dir 认领' : `条目 disk_dir「${le.disk_dir}」与网盘目录「${o.filename}」不符`,
      });
      continue;
    }
    rows.push({ id: `${c.prefix}-${String(n).padStart(3, '0')}`, dir: o.filename, fid: o.fid, issue: 'no_entry', detail: '网盘有目录但站点无条目' });
  }
  // 历史并入的条目反过来查：盘端目录被删了就是死链；没写 disk_dir 的无法按编号对账
  for (const e of legacy) {
    const n = Number(String(e.disk_dir || '').match(/^(\d+)/)?.[1] || 0);
    if (!n) {
      rows.push({ id: e.id, title: e.title, quark_url: e.quark_url || '', legacy: true, issue: 'no_disk_dir', detail: '历史并入条目但缺 disk_dir，无法按编号对账（人工补或按 URL 体检）' });
      continue;
    }
    if (!dirByNum.has(n)) {
      rows.push({ id: e.id, title: e.title, quark_url: e.quark_url || '', legacy: true, issue: 'no_dir', detail: `网盘里没有 disk_dir 记录的 ${e.disk_dir}` });
    }
  }
  const bad = rows.filter((r) => r.issue);
  report.categories.push({ ...c, total_entries: entries.length, total_dirs: dirByNum.size, rows });

  console.log(`【${c.dir}】站点 ${entries.length} 条（本分类前缀 ${entByNum.size}${legacy.length ? ` + 历史并入 ${legacy.length}` : ''}）/ 网盘已编号 ${dirByNum.size} 个 → 不一致 ${bad.length}`);
  const show = process.argv.includes('--all') ? rows : bad;
  for (const r of show) {
    const tag =
      r.issue === 'name_diff' ? '⚠ 名称不符'
      : r.issue === 'no_dir' ? '✖ 缺目录'
      : r.issue === 'no_entry' ? '✖ 缺条目'
      : r.issue === 'no_disk_dir' ? '⚠ 缺 disk_dir（历史并入，无法按编号对账）'
      : r.legacy ? '✓（历史并入）'
      : '✓';
    console.log(`  ${tag} ${r.id}  站点「${r.title ?? '-'}」  网盘「${r.dir ?? '-'}」${r.detail ? '  ' + r.detail : ''}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`\nJSON 已写入 ${OUT}`);
