#!/usr/bin/env node
/**
 * 配图 / 封面生成器（2:3 竖版，480×720），四个模式共用一个入口：
 *
 *   node tools/poster.mjs book   --title "牧羊少年奇幻之旅" --author "[巴西] 保罗·柯艾略" --year 1988 --out static/images/bk-002.jpg
 *   node tools/poster.mjs icon   --icon <本地文件|图片URL> --out static/images/app-005.jpg --title "AdGuard" --sub "广告拦截 · 隐私保护"
 *   node tools/poster.mjs set    --title "王牌惊悚套装" --badge "共 17 册" --out static/images/bk-006.jpg
 *   node tools/poster.mjs douban --title "飞越疯人院" --author "肯·克西" --out static/images/bk-001.jpg
 *
 * book / set 是「没封面时自己画一张」，icon 是把现成图标合成竖版，douban 是抓正版封面（优先）。
 * 出图后务必打开看一眼再入库：标题顶边、图标偏小、豆瓣的「封面+封底」展开图，只有看图能发现。
 */
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const W = 480;
const H = 720;
const FONT = 'PingFang SC,Microsoft YaHei,Helvetica Neue,Arial,sans-serif';

// sharp 是 optionalDependencies，装不上时只影响这三个出图模式，douban 仍可用
const sharp = async () => (await import('sharp')).default;

async function writeJpeg(svg, out, opts) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await (await sharp())(Buffer.from(svg)).jpeg(opts).toFile(out);
}

// ── book：生成式书封（豆瓣查无此书时的兜底）──────────────────
async function posterBook() {
  const title = arg('title', '');
  const author = arg('author', '');
  const year = arg('year', '');
  const out = arg('out');
  const c1 = arg('c1', '#2f6f5e');
  const c2 = arg('c2', '#8fd3b6');
  if (!title || !out) {
    console.error('用法：node tools/poster.mjs book --title <书名> --out <输出.jpg> [--author ..] [--year ..] [--c1 ..] [--c2 ..]');
    return 1;
  }

  // 书名分行：≤7 字单行；更长则尽量从中间断开，每行不超过 7 字
  const t = title.trim();
  const chars = [...t];
  let lines;
  if (chars.length <= 7) lines = [t];
  else {
    const half = Math.ceil(chars.length / 2);
    let cut = -1;
    for (let i = half; i >= 2 && i <= chars.length - 2; i--) {
      if (/[·:：—\-—\s，,、]/.test(chars[i]) || /[·:：—\-—\s，,、]/.test(chars[i - 1] || '')) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = half;
    lines = [chars.slice(0, cut).join(''), chars.slice(cut).join('')];
  }

  const maxLen = Math.max(...lines.map((l) => [...l].length));
  const titleSize = maxLen >= 7 ? 46 : maxLen >= 5 ? 54 : 60;
  const baseY = 596 - (lines.length - 1) * (titleSize + 8);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="34%" r="72%">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="${W / 2}" cy="258" r="188" fill="#fff" fill-opacity=".08"/>
  <g>
    <rect x="146" y="132" width="188" height="252" rx="10" fill="#fff" fill-opacity=".94"/>
    <rect x="146" y="132" width="20" height="252" rx="10" fill="#000" fill-opacity=".10"/>
    <rect x="146" y="132" width="188" height="252" rx="10" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>
    <rect x="184" y="170" width="118" height="10" rx="5" fill="${c1}" fill-opacity=".55"/>
    <rect x="184" y="198" width="118" height="6" rx="3" fill="${c1}" fill-opacity=".3"/>
    <rect x="184" y="216" width="80" height="6" rx="3" fill="${c1}" fill-opacity=".3"/>
    <rect x="184" y="240" width="118" height="6" rx="3" fill="${c1}" fill-opacity=".22"/>
    <rect x="184" y="258" width="96" height="6" rx="3" fill="${c1}" fill-opacity=".22"/>
    <rect x="184" y="276" width="118" height="6" rx="3" fill="${c1}" fill-opacity=".22"/>
    <rect x="184" y="294" width="64" height="6" rx="3" fill="${c1}" fill-opacity=".22"/>
    <circle cx="288" cy="336" r="16" fill="${c1}" fill-opacity=".35"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${lines
    .map(
      (l, i) =>
        `<text x="${W / 2}" y="${baseY + i * (titleSize + 8)}" text-anchor="middle" font-size="${titleSize}" font-weight="700" font-family="${FONT}" fill="#fff">${esc(l)}</text>`
    )
    .join('\n  ')}
  ${
    author || year
      ? `<text x="${W / 2}" y="${baseY + lines.length * (titleSize + 8) + 26}" text-anchor="middle" font-size="24" font-family="${FONT}" fill="#fff" fill-opacity=".88">${esc([author, year].filter(Boolean).join(' · '))}</text>`
      : ''
  }
</svg>`;

  await writeJpeg(svg, out, { quality: 90 });
  console.log(`书封已生成：${out}（${W}×${H}）`);
  return 0;
}

// ── icon：把方形图标合成竖版海报（软件 / 操作系统 / 音频等无 TMDB 海报的资源）──
async function posterIcon() {
  const icon = arg('icon');
  const out = arg('out');
  if (!icon || !out) {
    console.error('用法：node tools/poster.mjs icon --icon <文件|URL> --out <输出.jpg> [--title ..] [--sub ..] [--c1 ..] [--c2 ..] [--icon-size ..] [--radius ..]');
    return 1;
  }
  const title = arg('title', '');
  const sub = arg('sub', '');
  const c1 = arg('c1', '#2f8f5b');
  const c2 = arg('c2', '#7ccb95');
  const ICON = Math.max(80, Number(arg('icon-size', '300')) || 300);
  // 图标圆角占边长的百分比（0 = 不裁；App Store 的 iOS 图标是直角方形，一般给 22）
  const radiusPct = Math.max(0, Math.min(50, Number(arg('radius', '0')) || 0));

  // 图标来源：软件用 iTunes Search API 的 artworkUrl512；技术品牌用 simple-icons 的 CDN SVG；
  // 其余可用 GitHub 组织头像 https://github.com/<org>.png?size=460，或自绘 512×512 白色线性图标
  let src = /^https?:/.test(icon)
    ? Buffer.from(await (await fetch(icon)).arrayBuffer())
    : fs.readFileSync(icon);

  // 单色 SVG（simple-icons 这类，<path> 不带 fill）默认渲染成黑块。SVG 的 fill 可继承，
  // 所以在根元素上补一个 --svg-fill；图标自带 fill 的子元素会覆盖它。想保留原色就显式传黑。
  const svgFill = String(arg('svg-fill', '#fff')).replace(/"/g, '');
  if (svgFill && /<svg[\s>]/i.test(src.toString('utf8').slice(0, 4096))) {
    const text = src.toString('utf8');
    const tag = text.match(/<svg(?:\s[^>]*)?>/i);
    if (tag && !/\sfill\s*=/i.test(tag[0])) {
      src = Buffer.from(text.replace(tag[0], tag[0].replace(/<svg/i, `<svg fill="${svgFill}"`)));
    }
  }

  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="70%">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="${W / 2}" cy="286" r="196" fill="#fff" fill-opacity=".1"/>
  <circle cx="${W / 2}" cy="286" r="196" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`;

  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${
    title
      ? `<text x="${W / 2}" y="${sub ? 592 : 604}" text-anchor="middle" font-size="50" font-weight="700" font-family="${FONT}" fill="#fff">${esc(title)}</text>`
      : ''
  }
  ${sub ? `<text x="${W / 2}" y="638" text-anchor="middle" font-size="23" font-family="${FONT}" fill="#fff" fill-opacity=".86">${esc(sub)}</text>` : ''}
</svg>`;

  const sh = await sharp();
  let iconBuf = await sh(src)
    .resize(ICON, ICON, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  if (radiusPct > 0) {
    const r = Math.round((ICON * radiusPct) / 100);
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}"><rect width="${ICON}" height="${ICON}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
    );
    iconBuf = await sh(iconBuf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sh(Buffer.from(bg))
    .composite([
      { input: iconBuf, left: Math.round((W - ICON) / 2), top: 136 },
      { input: Buffer.from(text), left: 0, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toFile(out);
  console.log(`海报已生成：${out}（${W}×${H}）`);
  return 0;
}

// ── set：套装 / 合辑的深色收藏版式（豆瓣多半只有展开图或无图）──────────
async function posterSet() {
  const kicker = arg('kicker', '');
  const prefix = arg('prefix', '');
  const title = arg('title', '');
  const badge = arg('badge', '');
  const label = arg('label', '');
  const formats = arg('formats', '');
  const author = arg('author', '');
  const accent = arg('accent', '#c02222');
  const out = arg('out');
  if (!title || !out) {
    console.error('用法：node tools/poster.mjs set --title <主标题> --out <输出.jpg> \\');
    console.error('       [--kicker <顶部拉丁字母>] [--prefix <小字前缀行>] [--badge <徽标，如 共 17 册>] \\');
    console.error('       [--label <徽标下方拉丁字母>] [--formats <格式串>] [--author <作者>] [--accent <主色>]');
    return 1;
  }

  // 主色派生明暗三档，氛围光别做大范围晕染（发糊像污渍），收成书名背后一小片光池
  const hex = accent.replace('#', '');
  const [ar, ag, ab] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const shade = (k) => `#${[ar, ag, ab].map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('')}`;
  const dark = shade(0.72);
  const deep = shade(0.55);

  const titleLen = [...title].length;
  const titleSize = titleLen <= 5 ? 58 : titleLen <= 6 ? 55 : titleLen <= 8 ? 48 : 42;
  const badgeW = badge ? Math.max(148, [...badge].length * 15 + 56) : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0b0f"/>
      <stop offset="0.42" stop-color="#161821"/>
      <stop offset="1" stop-color="#08090c"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="46%" r="46%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.34"/>
      <stop offset="0.45" stop-color="${deep}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="76%">
      <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.62"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${dark}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${accent}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${dark}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="2" fill="#ffffff" fill-opacity="0.02"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>

  <rect x="17" y="17" width="${W - 34}" height="${H - 34}" fill="none" stroke="${dark}" stroke-opacity="0.5" stroke-width="1.3"/>
  <rect x="23" y="23" width="${W - 46}" height="${H - 46}" fill="none" stroke="${dark}" stroke-opacity="0.16" stroke-width="0.8"/>

  ${
    kicker
      ? `<text x="${W / 2}" y="102" text-anchor="middle" font-family="${FONT}" font-size="21" letter-spacing="7" fill="${shade(1.08)}">${esc(kicker)}</text>
  <rect x="${W / 2 - 34}" y="120" width="68" height="1.5" fill="url(#rule)"/>`
      : ''
  }
  ${prefix ? `<text x="${W / 2}" y="300" text-anchor="middle" font-family="${FONT}" font-size="40" fill="#c2c5cf">${esc(prefix)}</text>` : ''}
  <text x="${W / 2}" y="374" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="#ffffff">${esc(title)}</text>
  ${
    badge
      ? `<rect x="${(W - badgeW) / 2}" y="428" width="${badgeW}" height="46" rx="23" fill="${accent}" fill-opacity="0.15" stroke="${shade(1.12)}" stroke-opacity="0.9" stroke-width="1.4"/>
  <text x="${W / 2}" y="458" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${shade(1.3)}">${esc(badge)}</text>`
      : ''
  }
  ${label ? `<text x="${W / 2}" y="518" text-anchor="middle" font-family="${FONT}" font-size="13" letter-spacing="4" fill="#848894">${esc(label)}</text>` : ''}

  <rect x="${W / 2 - 62}" y="558" width="124" height="1.4" fill="url(#rule)"/>
  ${formats ? `<text x="${W / 2}" y="614" text-anchor="middle" font-family="${FONT}" font-size="16" fill="#767a85">${esc(formats)}</text>` : ''}
  ${author ? `<text x="${W / 2}" y="648" text-anchor="middle" font-family="${FONT}" font-size="17" fill="#a3a8b2">${esc(author)}</text>` : ''}
</svg>`;

  await writeJpeg(svg, out, { quality: 92, chromaSubsampling: '4:4:4' });
  console.log(`套装封面已生成：${out}（${W}×${H}）`);
  return 0;
}

// ── douban：抓豆瓣正版书封（电子书 bk- 优先用它）────────────────
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://book.douban.com/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 start 位置做括号配对，取出完整的 JSON 数组文本 */
function sliceArray(text, start) {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function searchBooks(q, attempt = 1) {
  const url = `https://book.douban.com/subject_search?search_text=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = await r.text();
  const at = html.indexOf('"items": [');
  if (at < 0) {
    if (attempt < 3) {
      await sleep(3000);
      return searchBooks(q, attempt + 1);
    }
    return [];
  }
  const arrText = sliceArray(html, html.indexOf('[', at));
  if (!arrText) return [];
  return (JSON.parse(arrText) || []).filter((x) => x && x.title && x.cover_url);
}

async function posterDouban() {
  const title = arg('title');
  const out = arg('out');
  const author = arg('author');
  const pick = arg('pick');
  const listOnly = process.argv.includes('--list');
  if (!title || (!out && !listOnly)) {
    console.error(
      '用法：node tools/poster.mjs douban --title "书名" --out static/images/bk-001.jpg [--author 关键字] [--pick 豆瓣id] [--list]'
    );
    return 1;
  }

  const items = await searchBooks(title);
  const key = title.replace(/\s/g, '');
  const exact = items.filter((x) => String(x.title).replace(/\s/g, '') === key);
  const candidates = exact.length ? exact : items;

  if (!candidates.length) {
    console.error(`✗ 豆瓣未找到《${title}》（可能是已下架书目，改用 node tools/poster.mjs book 生成封面）`);
    return 2;
  }

  console.log(`《${title}》候选 ${candidates.length} 条：`);
  candidates.slice(0, 8).forEach((x) => console.log(`  ${x.id}  ${String(x.abstract || '').slice(0, 70)}`));

  let target = null;
  if (pick) target = candidates.find((x) => String(x.id) === String(pick)) || items.find((x) => String(x.id) === String(pick));
  else if (author) target = candidates.find((x) => String(x.abstract || '').includes(author));
  target = target || candidates[0];

  if (!target) {
    console.error(`✗ 指定的条目 id ${pick} 不在结果中`);
    return 3;
  }
  if (listOnly) {
    console.log(`\n（--list 模式，未下载）首选：${target.id} ${String(target.abstract).slice(0, 60)}`);
    return 0;
  }

  // /m/public/ 换 /l/public/ 拿大图（约 500×750，正好是 2:3）
  const big = String(target.cover_url).replace('/m/public/', '/l/public/');
  const r = await fetch(big, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('封面下载失败 HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 8000) throw new Error(`封面文件过小（${buf.length}B），可能被限流或该条目无图`);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`\n✓ 已写入 ${out}（${(buf.length / 1024).toFixed(0)}KB，豆瓣条目 ${target.id}）`);
  console.log(`  ${String(target.abstract).slice(0, 80)}`);
  console.log('  提示：入库前看一眼实际画面，豆瓣上有条目的封面是「封面+封底」展开图，那种要换别的版本。');
  return 0;
}

const MODES = {
  book: posterBook,
  icon: posterIcon,
  set: posterSet,
  douban: posterDouban,
};

try {
  const run = MODES[mode];
  if (!run) {
    console.error(`用法：node tools/poster.mjs <${Object.keys(MODES).join('|')}> [选项]`);
    process.exitCode = 1;
  } else {
    process.exitCode = await run();
  }
} catch (e) {
  console.error('✗ ' + e.message);
  process.exitCode = 1;
}
