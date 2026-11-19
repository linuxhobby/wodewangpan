#!/usr/bin/env node
/**
 * 缺海报盘点（只读）：列出 data/*.yaml 中没有 image: 字段（或配图文件缺失）的条目。
 *
 *   node tools/list-missing-posters.mjs                 # 全部分类汇总 + 明细
 *   node tools/list-missing-posters.mjs --only mv,game  # 只看指定前缀
 *   node tools/list-missing-posters.mjs --quiet         # 只输出统计行
 *
 * 口径：
 * - `image:` 字段缺失即算缺海报（构建与详情页都以它为准）；
 * - image: 有值但 static/images/<slug>/<id>.jpg 不存在也算缺（构建会静默降级为无图）。
 * 只读不写，不下载不构建；补海报走 llm-apply（带 image_url 的草稿）或人工下载 + 裁 500x750。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || '').split(',').filter(Boolean) : [];
const QUIET = argv.includes('--quiet');

const SLUGS = {
  movie: 'movie', tv: 'tv', anime: 'anime', documentary: 'documentary',
  game: 'game', software: 'software', ebook: 'ebook', course: 'course', misc: 'misc',
};

const rows = [];
let total = 0, missing = 0;
for (const [slug] of Object.entries(SLUGS)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const file = path.join(REPO, 'data', `${slug}.yaml`);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.split(/(?=- id: )/).slice(1);
  let catTotal = 0, catMissing = 0;
  const ids = [];
  for (const b of blocks) {
    const id = (b.match(/^- id:\s*(\S+)/) || [])[1];
    if (!id) continue;
    catTotal++; total++;
    const m = b.match(/^\s*image:\s*(\S+)\s*$/m);
    let bad = !m;
    if (m) {
      const img = path.join(REPO, 'static', 'images', slug, m[1]);
      if (!fs.existsSync(img)) bad = true;
    }
    if (bad) { catMissing++; missing++; ids.push(id); }
  }
  if (catMissing) rows.push({ slug, catTotal, catMissing, ids });
}

if (!QUIET) {
  for (const r of rows) {
    console.log(`${r.slug}.yaml：${r.catMissing}/${r.catTotal} 缺海报`);
    console.log('  ' + r.ids.join(', '));
  }
  if (!rows.length) console.log('所有分类配图齐全。');
}
console.log(`合计：${missing}/${total} 条缺海报（明细来源见上，--quiet 只看本行）`);
process.exitCode = 0;
