#!/usr/bin/env node
/**
 * 为 LLM 自动化准备待处理清单：
 * 只处理夸克资源同步第一版不支持的目录（an/game/bk/cs/ot）。
 * 流程：分配编号 → 重命名网盘目录 → 刷新 fid → 生成永久公开分享链接 → 写 pending JSON。
 * 不写 data/*.yaml，不 build，不提交；真正的元数据由 LLM 自动化产出，再由 llm-apply.mjs 校验写回。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { QUARK_CLI, QUARK_CLI_ENV } from '../lib/quark-cli.mjs';

const CACHE = process.env.WDP_CACHE_DIR || path.join(os.homedir(), '.cache', 'quark-sync');
const ENV_FILE = path.join(os.homedir(), '.config', 'wodewangpan-tmdb.env');
const SCAN = path.join(CACHE, 'scan-new.json');
const TASK_DIR = path.join(CACHE, 'quark-tasks');
const PREFIXES = new Set(['an', 'game', 'bk', 'cs', 'ot']);
const CATEGORY = { an: '动漫', game: '游戏', bk: '电子书', cs: '课程', ot: '其他' };

for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (k && process.env[k] === undefined) process.env[k] = v;
}
const SHARE_FID = process.env.QUARK_SHARE_FID;
if (!SHARE_FID) throw new Error('缺少 QUARK_SHARE_FID');

const run = (bin, args, opts = {}) => new Promise((res, rej) =>
  execFile(bin, args, { maxBuffer: 64e6, env: QUARK_CLI_ENV, ...opts }, (e, s, x) =>
    e ? rej(new Error(String(x || e.message).slice(0, 300))) : res(s)));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

async function browse(fid) {
  fs.mkdirSync(TASK_DIR, { recursive: true });
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  const out = await run(process.execPath, [QUARK_CLI, ...base, '--task-dir', TASK_DIR]).catch((e) => {
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run(process.execPath, [QUARK_CLI, ...base]);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 160)}`);
  return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').map(JSON.parse);
}

async function refreshFids(items, dirName, newNames) {
  const roots = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
  const root = roots.find((o) => String(o.filename).includes(dirName));
  if (!root) throw new Error(`SHARE 下找不到分类目录「${dirName}」`);
  const byName = new Map((await browse(root.fid)).map((o) => [o.filename, o.fid]));
  let n = 0;
  for (const item of items) {
    const fresh = byName.get(item.new_name);
    if (fresh && fresh !== item.fid) { item.fid = fresh; n++; }
  }
  console.log(`  fid 刷新：${n}/${items.length}`);
  return newNames;
}

function allocNumbers(cat, count) {
  const holes = (cat.holes || []).map((x) => parseInt(x, 10)).filter(Number.isFinite).sort((a, b) => a - b);
  const max = parseInt(cat.max_number, 10) || 0;
  const nums = holes.slice(0, count);
  for (let i = nums.length; i < count; i++) nums.push(max + 1 + (i - nums.length));
  return nums;
}

const scan = JSON.parse(fs.readFileSync(SCAN, 'utf8'));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outFile = path.join(CACHE, `llm-pending-${stamp}.json`);
const pending = [];
let prepared = 0;

for (const cat of scan.categories || []) {
  const prefix = cat.prefix;
  if (!PREFIXES.has(prefix)) continue;
  const items = (cat.unnumbered || []).filter((u) => !u.likely_duplicate_of);
  if (!items.length) continue;
  const nums = allocNumbers(cat, items.length);
  const batch = items.map((u, i) => {
    const num = String(nums[i]).padStart(3, '0');
    return {
      prefix,
      category: CATEGORY[prefix],
      category_dir: cat.dir,
      id: `${prefix}-${num}`,
      fid: u.fid,
      old_name: u.filename,
      new_name: `${num}-${u.filename}`,
      added: u.updated_at || new Date().toISOString().slice(0, 10),
    };
  });
  console.log(`\n[${prefix}] 待 LLM ${batch.length} 条，编号 ${batch.map((x) => x.id).join(',')}`);

  const itemsFile = path.join(CACHE, `llm-rename-${prefix}-${stamp}.json`);
  fs.writeFileSync(itemsFile, JSON.stringify({ schema_version: 1, items: batch.map((x) => ({ fid: x.fid, old_name: x.old_name, new_name: x.new_name })) }, null, 2));
  const rr = await run(process.execPath, [QUARK_CLI, 'rename', '--batch-id', crypto.randomBytes(8).toString('hex'), '--items-file', itemsFile]);
  const rj = JSON.parse(rr || '{}');
  const rst = rj.data?.result_status || {};
  if (Number(rst.fail_count || 0) > 0) throw new Error(`${prefix} 改名失败 ${rst.fail_count}/${rst.total}`);
  fs.rmSync(itemsFile, { force: true });

  await refreshFids(batch, cat.dir, cat.dir);
  for (const item of batch) {
    const sr = await run(process.execPath, [QUARK_CLI, 'share', item.fid, '--title', item.new_name, '--url-type', '1', '--expired-type', '1']);
    const sj = JSON.parse(sr || '{}');
    const url = sj.data?.share_url || '';
    if (!/^https:\/\/pan\.quark\.cn\/s\/[a-z0-9]+$/.test(url)) throw new Error(`${item.id} 出链失败：${url || JSON.stringify(sj).slice(0, 160)}`);
    pending.push({
      id: item.id,
      prefix,
      category: item.category,
      dir_name: item.new_name,
      old_name: item.old_name,
      quark_url: url,
      added: item.added,
      source: 'resource-sync',
      reason: `unsupported_category:${prefix}`,
      status: 'pending',
    });
    prepared++;
    await sleep(1500);
  }
}

fs.writeFileSync(outFile, JSON.stringify({ source: 'resource-sync', created_at: new Date().toISOString(), items: pending }, null, 2));
console.log(`\nLLM pending 已写入 ${outFile}（${prepared} 条）`);
