import { cfg, requireCfg, QUARK_TASK_DIR } from './lib/config.mjs';
import { execFile } from 'child_process';
import fs from 'fs';

requireCfg(['QUARK_CLI', 'SHARE_FID']);
const CLI = cfg.QUARK_CLI;
const SHARE_FID = cfg.SHARE_FID;
fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });

const run = (args) =>
  new Promise((res, rej) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s) => (e ? rej(e) : res(s)))
  );

async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  const out = await run([...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run(base);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error('browse 未返回 jsonl：' + out.slice(0, 300));
  return fs
    .readFileSync(JSON.parse(`"${m[1]}"`), 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map(JSON.parse);
}

const cats = await browse(SHARE_FID);
const misc = cats.find((o) => o.filename === '010其他');
const items = await browse(misc.fid);
const q = items.find((o) => /Qwen/i.test(o.filename));
console.log('FOUND:', q.filename, '| fid:', q.fid);

async function walk(fid, depth) {
  const list = await browse(fid);
  for (const it of list) {
    const isDir = String(it.file_type) === '0';
    const sz = it.size ? '(' + Math.round(Number(it.size) / 1048576) + 'MB)' : '';
    console.log('  '.repeat(depth) + (isDir ? '[DIR] ' : '[FILE] ') + it.filename + ' ' + sz);
    if (isDir && depth < 2) await walk(it.fid, depth + 1);
  }
}
await walk(q.fid, 1);
