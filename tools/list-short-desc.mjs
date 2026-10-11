/**
 * 列出简介过短的资源，方便逐条补写。
 *
 * Bing / Google 对「模板重 + 正文稀」的聚合页容忍度很低，简介越短越容易被判 thin content。
 * 现在的硬标准是**正文不低于 300 字**（2026-10-08 从 200 提高），所以默认阈值就是 300。
 *
 * 字数口径与 fill-desc.mjs、skill 的 check-desc.mjs 三处必须一致：
 * 先剥掉【第 N 季 · 共 M 集】这类标签，再剥掉结尾 ｜TMDB 评分 / ｜作者 / ｜开发者 署名。
 *
 * 用法：
 *   npm run list:short                 # 列出正文不足 300 字的全部条目（默认阈值 300）
 *   npm run list:short -- --max=200    # 换个阈值复核
 *   npm run list:short -- --limit=30   # 只列最前的 30 条
 *   npm run list:short -- --cat=电影    # 只看某个分类
 *
 * 结果同时写入 .tmp/short-desc.md（已 gitignore）。补写走 fill-desc.mjs：
 * 把新正文放进 .tmp/desc-draft.json（{ "id": "正文" }），node tools/fill-desc.mjs --apply，
 * 脚本会自动接回【…】标签与 ｜… 后缀，并检查新正文是否达到 300 字。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResources, normalizeResources, bodyLength, MIN_DESC } from '../scripts/lib/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
/** 取一个 --key=value 形式的参数，取不到用默认值 */
const arg = (key, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : fallback;
};

const max = Number(arg('max', MIN_DESC));
const limit = Number(arg('limit', 0)) || Infinity;
const cat = arg('cat', '');

const { items } = normalizeResources(loadResources(path.join(root, 'data')));

const short = items
  .filter((it) => (!cat || it.category === cat) && bodyLength(it.description) < max)
  .sort((a, b) => bodyLength(a.description) - bodyLength(b.description))
  .slice(0, limit);

if (!short.length) {
  console.log(`没有正文少于 ${max} 字的条目${cat ? `（分类：${cat}）` : ''}`);
  process.exit(0);
}

const lines = short.map(
  (it) =>
    `| ${bodyLength(it.description)} | ${it.id} | ${it.category} | ${it.title} | ${String(it.description || '')
      .replace(/\s+/g, ' ')
      .slice(0, 40)}… |`
);

const md = [
  `# 正文少于 ${max} 字的资源（${short.length} 条）`,
  '',
  `> 生成时间：${new Date().toISOString().slice(0, 10)}　按字数升序，排在最前面的最该先补。`,
  `> 字数按正文计（已剥掉【…】标签与 ｜… 署名后缀）。改写不是照抄 TMDB，正文补到 ${max} 字以上再落盘。`,
  '',
  '| 正文字数 | id | 分类 | 标题 | 当前简介 |',
  '|---:|---|---|---|---|',
  ...lines,
  '',
].join('\n');

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
fs.writeFileSync(path.join(root, '.tmp/short-desc.md'), md);

console.log(md);
console.log(`已写入 .tmp/short-desc.md（${short.length} 条，共 ${items.length} 条资源）`);
console.log('补写：新正文放进 .tmp/desc-draft.json → node tools/fill-desc.mjs 空跑 → --apply 落盘');
