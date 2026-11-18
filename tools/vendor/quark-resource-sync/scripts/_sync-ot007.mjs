import { cfg, requireCfg, QUARK_TASK_DIR } from './lib/config.mjs';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

requireCfg(['QUARK_CLI', 'SHARE_FID']);
const CLI = cfg.QUARK_CLI;
const SHARE_FID = cfg.SHARE_FID;
fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });

const run = (args) =>
  new Promise((res, rej) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s, st) =>
      e ? rej(new Error((s || '') + '\n' + (st || '') + '\n' + e.message)) : res(s)
    )
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

async function findQwen() {
  const cats = await browse(SHARE_FID);
  const misc = cats.find((o) => o.filename === '010其他');
  const items = await browse(misc.fid);
  const q = items.find((o) => /Qwen/i.test(o.filename) && !/^\d{3}-/.test(o.filename));
  return q;
}

const OLD = (await findQwen()).filename;
const NEW = '007-' + OLD;
console.log('[1] 旧名:', OLD, '→ 新名:', NEW);

// 2. rename (fresh fid already from findQwen browse)
const q1 = await findQwen();
const itemsFile = path.join(os.tmpdir(), 'rename-ot007.json');
fs.writeFileSync(itemsFile, JSON.stringify({ schema_version: 1, items: [{ fid: q1.fid, old_name: OLD, new_name: NEW }] }), 'utf8');
const B = crypto.randomBytes(8).toString('hex');
const renOut = await run(['rename', '--batch-id', B, '--items-file', itemsFile]);
console.log('[2] rename batch', B, ':', renOut.trim().split('\n').slice(-3).join(' | '));

// 3. re-browse to get fresh fid of renamed dir
const q2 = await findQwen2();
async function findQwen2() {
  const cats = await browse(SHARE_FID);
  const misc = cats.find((o) => o.filename === '010其他');
  const items = await browse(misc.fid);
  return items.find((o) => /^007-Qwen/i.test(o.filename));
}
if (!q2) throw new Error('重命名后未找到 007-Qwen 目录');
console.log('[3] 重命名后 fid:', q2.fid);

// 4. share (public, no code, permanent)
const shareOut = await run(['share', q2.fid, '--title', NEW, '--url-type', '1', '--expired-type', '1']);
const urlM = shareOut.match(/https:\/\/pan\.quark\.cn\/s\/\w+/);
console.log('[4] SHARE_URL:', urlM ? urlM[0] : 'PARSE_FAIL');
console.log('---- share raw tail ----');
console.log(shareOut.trim().split('\n').slice(-6).join('\n'));
