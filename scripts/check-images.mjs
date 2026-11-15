#!/usr/bin/env node
/** 配图盘点（只读）：逐条确认资源能命中源图，并找出散落在旧平铺目录 / 无主的文件。
 *  2026-11-15 起 static/images/ 按分类 slug 分子目录；resolveSource() 仍兼容旧平铺路径，
 *  这个脚本就是用来发现「跨机 skill 还在往旧路径写图」这类漏改的。
 *  用法：npm run check:images
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, loadResources, normalizeResources } from './lib/data.js';
import { resolveSource } from './lib/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'static');
const imagesDir = path.join(staticDir, 'images');
// categorySlug() 的别名表由 loadSite() 注入，必须在 resolveSource() 之前调用
loadSite(path.join(root, 'config'));
const { items } = normalizeResources(loadResources(path.join(root, 'data')));

const used = new Set();
const missing = [];
const flat = [];
const byCat = new Map();
for (const it of items) {
  const src = resolveSource(it, staticDir, root);
  if (!src) {
    missing.push(it.id);
    continue;
  }
  used.add(path.resolve(src));
  const dir = path.dirname(path.resolve(src));
  if (dir === path.resolve(imagesDir)) flat.push(it.id);
  else {
    const slug = path.basename(dir);
    byCat.set(slug, (byCat.get(slug) || 0) + 1);
  }
}

const all = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else all.push(path.resolve(p));
  }
};
if (fs.existsSync(imagesDir)) walk(imagesDir);
const orphan = all.filter((p) => !used.has(p));

console.log(`配图盘点：${items.length} 条资源 · ${all.length} 个文件`);
for (const [slug, n] of [...byCat].sort()) console.log(`  ${slug.padEnd(12)} ${String(n).padStart(4)} 张`);
console.log(`  ✓ 命中 ${items.length - missing.length}（分类目录 ${[...byCat.values()].reduce((a, b) => a + b, 0)} · 旧平铺 ${flat.length}）`);
if (missing.length) console.log(`  ! 缺图 ${missing.length} 条：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`);
if (flat.length) console.log(`  ! 仍命中旧平铺路径 ${flat.length} 条：${flat.slice(0, 20).join('、')}${flat.length > 20 ? '…' : ''}`);
if (orphan.length) console.log(`  ! 孤儿文件 ${orphan.length} 个：${orphan.slice(0, 10).map((p) => path.relative(root, p)).join('、')}${orphan.length > 10 ? '…' : ''}`);
if (!missing.length && !flat.length && !orphan.length) console.log('  ✓ 缺图 0 · 孤儿文件 0');
process.exit(missing.length || flat.length || orphan.length ? 1 : 0);
