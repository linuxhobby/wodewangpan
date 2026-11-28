/**
 * GitHub Pages 项目站（https://域名/仓库名/）专用：给构建产物里的站内绝对路径补前缀。
 *
 * 站点模板内部一律写 `/assets/...`、`/tv/<id>/` 这类根绝对路径，主站部署在域名根目录
 * 时正确；但项目站多了一层 `/wodewangpan/`，浏览器会把 `/assets/` 解析到域名根而 404。
 * 这里只改 public/ 产物，不改源码模板、不改 sitemap/RSS（它们已经是完整 URL）。
 *
 * 用 BASE_PATH=/wodewangpan 调用；未设置时原样跳过，主站构建不受影响。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public');
let prefix = String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '');
if (prefix && !prefix.startsWith('/')) prefix = `/${prefix}`;
if (!prefix) {
  console.log('  · BASE_PATH 未设置，跳过 GitHub Pages 路径前缀');
  process.exit(0);
}
if (!fs.existsSync(outDir)) throw new Error('public/ 不存在，请先 npm run build');

const skip = (p) => p.startsWith(`${prefix}/`) || p === prefix;
const textExt = new Set(['.html', '.js', '.css', '.json']);
let touched = 0;
let changed = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (textExt.has(path.extname(file).toLowerCase())) patch(file);
  }
}

function patch(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  let next = raw;
  if (ext === '.html') {
    next = next
      .replace(/(=")(\/[^"]*)/g, (m, a, p) => (skip(p) ? m : `${a}${prefix}${p}`))
      .replace(/url\(\s*(\/[^)]*)\)/g, (m, p) => (skip(p) ? m : `url(${prefix}${p})`));
  } else if (ext === '.js') {
    next = next
      .replace(/(['"])\/([A-Za-z0-9_?&=./-]+)\1/g, (m, q, p) => (skip(`/${p}`) ? m : `${q}${prefix}/${p}${q}`))
      .replace(/url\(\s*(\/[^)]*)\)/g, (m, p) => (skip(p) ? m : `url(${prefix}${p})`));
  } else if (ext === '.json') {
    next = next.replace(/"(href|thumb|card|image|poster|url)":"\/([^"]*)"/g,
      (m, key, p) => (skip(`/${p}`) ? m : `"${key}":"${prefix}/${p}"`));
  } else if (ext === '.css') {
    next = next.replace(/url\(\s*(\/[^)]*)\)/g, (m, p) => (skip(p) ? m : `url(${prefix}${p})`));
  }
  touched++;
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8');
    changed++;
  }
}

walk(outDir);
console.log(`  · GitHub Pages 路径前缀 ${prefix}：扫描 ${touched} 个文本文件，改写 ${changed} 个`);
