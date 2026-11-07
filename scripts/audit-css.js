/**
 * 样式体检：跑一遍就能发现「风格没统一」的隐患。
 *
 * 检查两件事：
 * 1. 页面里用到的 class，CSS 里是否有对应规则（漏样式）；
 * 2. CSS 里的 class，是否还能在产物中找到（死样式，通常说明 HTML 已改但样式没清）。
 *
 * 用法：先 npm run build，再 npm run audit:css
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssFile = path.join(root, 'theme/assets/style.css');
const outDir = path.join(root, 'public');

if (!fs.existsSync(outDir)) {
  console.error('! 找不到 public/，请先执行 npm run build');
  process.exit(1);
}

const css = fs.readFileSync(cssFile, 'utf8');
/** CSS 里出现过的所有类名（含伪类里的，如 .tile:hover .tile__title） */
const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/** 收集产物里实际用到的 class：静态 HTML + 前端 JS 里拼出来的标签都要算 */
const used = new Map();
const collect = (text, source) => {
  for (const m of text.matchAll(/class="([^"]+)"/g)) {
    // JS 里常见 'class="foo' + v + '"' 拼接：只取第一个引号前的静态前缀，丢弃拼接段
    const value = m[1].split(/['`]/)[0];
    for (const cls of value.split(/\s+/).filter(Boolean)) {
      if (!used.has(cls)) used.set(cls, source);
    }
  }
};

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(html|js)$/.test(entry.name) && entry.name !== 'search-index.json') {
      collect(fs.readFileSync(full, 'utf8'), path.relative(outDir, full));
    }
  }
};
walk(outDir);

const missing = [...used].filter(([cls]) => !defined.has(cls));
const unused = [...defined].filter((cls) => !used.has(cls));

console.log(`样式表：${cssFile}`);
console.log(`CSS 类名 ${defined.size} 个 · 产物中使用 ${used.size} 个\n`);

if (missing.length) {
  console.log(`✗ 用了但没有对应样式（${missing.length}）：`);
  for (const [cls, from] of missing) console.log(`   .${cls}  ← ${from}`);
} else {
  console.log('✓ 页面用到的 class 都有样式');
}

if (unused.length) {
  console.log(`\n? CSS 里存在但产物没用到（${unused.length}）：${unused.map((c) => `.${c}`).join(' ')}`);
  console.log('  多为条件渲染（提取码 / 多网盘切换 / ICP 备案号），当前数据没触发属正常。');
} else {
  console.log('\n✓ 没有多余样式');
}

// 还有一个最容易「改一处漏一处」的点：在样式区块里写死数值
const hardcoded = css
  .split('\n')
  .map((line, i) => [i + 1, line.trim()])
  .filter(([n, line]) => n > 1 && /(font-size|line-height|border-radius|color|background)\s*:\s*[0-9#]/.test(line) && !line.startsWith('--'));

if (hardcoded.length) {
  console.log('\n✗ 样式区块里仍有写死的字号 / 行高 / 圆角 / 颜色，请改用 :root 里的令牌：');
  for (const [n, line] of hardcoded) console.log(`   ${cssFile}:${n}  ${line}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ 所有数值都来自 :root 设计令牌');
}
