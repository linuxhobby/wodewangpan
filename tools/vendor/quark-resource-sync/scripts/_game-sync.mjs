import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);
const CLI = cfg.QUARK_CLI;
const { SHARE_FID } = cfg;
const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6, ...opts }, (e, s, x) => (e ? rej(new Error(String(x || e.message).slice(0, 400))) : res(s))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run('node', [CLI, ...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run('node', [CLI, ...base]);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').map(JSON.parse);
}

const scan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const g = scan.categories.find((c) => c.prefix === 'game');
if (!g) throw new Error('scan 中无 game 分类');
const pending = g.unnumbered; // scan order
const startNum = parseInt(g.next_number, 10); // 39 (append, holes 0)
const items = pending.map((u, i) => ({
  num: startNum + i,
  id: `game-${String(startNum + i).padStart(3, '0')}`,
  fid: u.fid,
  old_name: u.filename,
  new_name: `${String(startNum + i).padStart(3, '0')}-${u.filename}`,
}));
console.log('计划：\n' + items.map((p) => `  ${p.id}  ${p.old_name} → ${p.new_name}`).join('\n'));

// 1) rename
const itemsFile = path.join(TMP, `game-rename-${Date.now()}.json`);
fs.writeFileSync(itemsFile, JSON.stringify({ schema_version: 1, items: items.map((p) => ({ fid: p.fid, old_name: p.old_name, new_name: p.new_name })) }, null, 1));
try {
  const r = JSON.parse(await run('node', [CLI, 'rename', '--batch-id', crypto.randomBytes(8).toString('hex'), '--items-file', itemsFile]));
  console.log(`重命名：${r.data.result_status} ${r.data.success_count}/${r.data.total}`);
  if (r.data.fail_count) throw new Error(`重命名失败 ${r.data.fail_count} 条`);
} catch (e) { console.error('重命名失败：', e.message); process.exit(1); }

// 2) refresh fids
const roots = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
const root = roots.find((o) => o.filename.includes('游戏'));
if (!root) throw new Error('找不到游戏分类目录');
const byName = new Map((await browse(root.fid)).map((o) => [o.filename, o.fid]));
for (const p of items) { const f = byName.get(p.new_name); if (f) p.fid = f; else console.log(`  ! 未找到 ${p.new_name}`); }

// 3) share
const out = [];
for (const p of items) {
  try {
    const s = JSON.parse(await run('node', [CLI, 'share', p.fid, '--title', p.new_name, '--url-type', '1', '--expired-type', '1']));
    p.url = s.data.share_url; p.url_type = s.data.url_type; p.passcode = s.data.passcode || null;
    console.log(`  ${p.id} → ${p.url}  url_type=${p.url_type} passcode=${p.passcode}`);
  } catch (e) { p.error = e.message; console.log(`  ${p.id} ❌ share失败 ${p.error.slice(0, 120)}`); }
  await sleep(2000);
}
fs.writeFileSync(process.argv[3], JSON.stringify(items, null, 1));
console.log('已写：' + process.argv[3]);
