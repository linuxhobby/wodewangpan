#!/usr/bin/env node
/**
 * scan-drive-fids.mjs —— 生成 config/drive-fids.json（站内 id → 夸克盘端编号目录的 fid + 目录名）
 *
 * 为什么要这份映射：fill-files 的默认口径是分享链接的**客态**视图（访客能拿到什么），
 * 而夸克会对分享里的文件做**文件级屏蔽**——同一目录登录态有 9 集、访客只看到 2 份说明文件
 * （2026-11-11 实测 tv-016 / tv-058 / tv-078 / tv-123 / dc-086）。这类条目要改读盘端真实目录，
 * 但 data/*.yaml 里只有分享链，没有盘端 fid，所以 fid 必须靠扫一遍 SHARE 目录拿到。
 *
 *   node scripts/scan-drive-fids.mjs              # 重建映射（写 config/drive-fids.json）
 *   node scripts/scan-drive-fids.mjs --dry-run    # 只打印统计，不写文件
 *   node scripts/scan-drive-fids.mjs --share 我的分享目录   # 换 SHARE 根目录名
 *
 * 只读网盘、只写这一个映射文件，不动 data/、不动站点其它文件。
 * 盘端改了目录名或换了编号，重跑一次即可；映射缺失的条目 fill-files 会自动回落 share 口径。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const outFile = path.join(root, 'config', 'drive-fids.json');
const CLI =
  ['.qwenworkcn', '.codebuddy', '.workbuddy']
    .map((dir) =>
      path.join(process.env.HOME || process.env.USERPROFILE || '', dir, 'skills/quarkclouddrive/scripts/quark-drive.cjs')
    )
    .find((p) => fs.existsSync(p)) ||
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.qwenworkcn/skills/quarkclouddrive/scripts/quark-drive.cjs');
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const dryRun = args.includes('--dry-run');
const SHARE_NAME = getArg('share', 'SHARE');
const SESSION_ID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
const SESSION_INPUT = '重建盘端目录 fid 映射';
const TASK_DIR = path.join(os.tmpdir(), 'wdwp-scan-drive-fids', SESSION_ID);
const delayMs = Number(getArg('delay', 300));

/** 用户确认永久保留、不扫描内容的盘端根目录（2026-11-13 定）：整目录排除、不进入，也不算待补分类 */
const EXCLUDED_ROOT_DIRS = new Set(['99-需要删除的移动到这里']);

/** 分类目录名 → 站内 id 前缀（按中文关键词，不按数字前缀：「010其他」会被 slice(0,2) 误判成 01游戏） */
const CAT_PREFIX = [
  ['游戏', 'game'],
  ['应用', 'app'],
  ['电视剧', 'tv'],
  ['电影', 'mv'],
  ['动漫', 'an'],
  ['纪录片', 'dc'],
  ['课程', 'cs'],
  ['电子书', 'bk'],
  ['其他', 'ot'],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 登录态列出一个目录的全部直接子项（browse --all，落盘 JSONL 再读回来） */
function browse(fid) {
  let out;
  try {
    fs.mkdirSync(TASK_DIR, { recursive: true });
    out = execFileSync(
      process.execPath,
      [
        CLI,
        'browse',
        '--parent-fid', fid,
        '--all',
        '--task-dir', TASK_DIR,
        '--session-input', SESSION_INPUT,
        '--session-id', SESSION_ID,
      ],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 1 << 26 }
    );
  } catch (e) {
    throw new Error(`browse 调用失败：${String(e.message).split('\n')[0]}`);
  }
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type !== 'result' || obj.action !== 'browse') continue;
    if (obj.code !== 0) throw new Error(`browse ${fid}：${obj.msg || `code=${obj.code}`}`);
    const file = obj.data?.file_path;
    if (!file || !fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? raw.split('\n').map((l) => JSON.parse(l)) : [];
  }
  throw new Error('browse 无 result 输出（夸克 CLI 未授权或版本过旧？）');
}

/** 站内 id 全集，用来校验盘端编号目录是否都对得上条目 */
function siteIds() {
  const set = new Set();
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.yaml')) continue;
    const items = yaml.load(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    if (!Array.isArray(items)) continue;
    for (const it of items) if (it && it.id) set.add(it.id);
  }
  return set;
}

const known = siteIds();
const rootRows = browse('0');
const share = rootRows.find((f) => String(f.filename) === SHARE_NAME && String(f.file_type) === '0');
if (!share) {
  console.error(`! 网盘根目录下找不到「${SHARE_NAME}」目录（--share <目录名> 可换）`);
  process.exit(1);
}
console.log(`网盘根目录 ${rootRows.length} 项，取「${SHARE_NAME}」为资源根`);

const map = {};
const unmatched = [];
const cats = browse(share.fid).filter((f) => String(f.file_type) === '0' && /^\d/.test(String(f.filename)));
for (const c of cats) {
  if (EXCLUDED_ROOT_DIRS.has(String(c.filename))) {
    console.log(`  · ${c.filename}：用户指定永久保留、不扫描，整目录跳过`);
    continue;
  }
  const prefix = (CAT_PREFIX.find(([k]) => String(c.filename).includes(k)) || [])[1];
  if (!prefix) {
    console.log(`  · ${c.filename} 不在分类前缀表里，整目录跳过（需要人工补 CAT_PREFIX）`);
    continue;
  }
  const rows = browse(c.fid);
  let hit = 0;
  for (const r of rows) {
    if (String(r.file_type) !== '0') continue;
    const m = /^0*(\d+)-/.exec(String(r.filename));
    if (!m) continue;
    const id = `${prefix}-${String(Number(m[1])).padStart(3, '0')}`;
    if (!known.has(id)) {
      unmatched.push(`${c.filename}/${r.filename} → ${id}（站内无此 id）`);
      continue;
    }
    map[id] = { fid: r.fid, name: String(r.filename), cat: String(c.filename) };
    hit++;
  }
  console.log(`  · ${c.filename}：子项 ${rows.length}，对上条目 ${hit}`);
  if (delayMs) await sleep(delayMs);
}

const sorted = Object.fromEntries(Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])));
console.log(`\n映射 ${Object.keys(sorted).length} 条 · 站内条目 ${known.size} 条 · 盘端对不上 ${unmatched.length} 条`);
for (const u of unmatched.slice(0, 20)) console.log(`  ${u}`);
if (unmatched.length > 20) console.log(`  … 其余 ${unmatched.length - 20} 条略`);
const missing = [...known].filter((id) => !sorted[id]);
if (missing.length) console.log(`站内有 ${missing.length} 条在盘端找不到编号目录：${missing.slice(0, 20).join('、')}${missing.length > 20 ? ' …' : ''}`);

if (dryRun) {
  console.log('\n[dry-run] 未写文件');
} else {
  fs.writeFileSync(outFile, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`\n已写入 ${path.relative(root, outFile)}`);
}
