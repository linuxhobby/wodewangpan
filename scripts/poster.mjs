#!/usr/bin/env node
/**
 * 配图 / 封面生成器（2:3 竖版，480×720），五个模式共用一个入口：
 *
 *   node scripts/poster.mjs book   --title "牧羊少年奇幻之旅" --author "[巴西] 保罗·柯艾略" --year 1988 --out static/images/bk-002.jpg
 *   node scripts/poster.mjs icon   --icon <本地文件|图片URL> --out static/images/app-005.jpg --title "AdGuard" --sub "广告拦截 · 隐私保护"
 *   node scripts/poster.mjs set    --title "王牌惊悚套装" --badge "共 17 册" --out static/images/bk-006.jpg
 *   node scripts/poster.mjs scene  --preset saas --out static/images/cs-031.jpg   # 预设还有 arch / silk
 *   node scripts/poster.mjs douban --title "飞越疯人院" --author "肯·克西" --out static/images/bk-001.jpg
 *
 * book / set 是「没封面时自己画一张」，icon 是把现成图标合成竖版，douban 是抓正版封面（优先），
 * scene 是编辑式主题版式（2026-11-13 三张重绘海报的可复现实现）：细双框 + 眉标 + 矢量主视觉 +
 * 菱形分隔线 + 主/副标题 + 页脚。--title 用 | 分行，--sub / --foot / --badge / --kicker 与配色参数
 * （--bg1 --bg2 --halo --plate --ink --line --accent）可覆盖预设；不带覆盖参数时与当时写进
 * static/images/ 的 jpg 逐字节一致，可用 shasum 核对。新增版式一律在这里加预设，别再写一次性脚本。
 * icon 模式的标题按估算宽度自适应：放得下用 50px，超了先缩到 34px，仍超则折两行 —— 不要再手改字号（旧 bug：cs-016 被裁掉首尾）。
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

// sharp 是 optionalDependencies，装不上时只影响这四个出图模式，douban 仍可用
const sharp = async () => (await import('sharp')).default;

async function writeJpeg(svg, out, opts) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await (await sharp())(Buffer.from(svg)).jpeg(opts).toFile(out);
}

// 标题排版的宽度估算：480 画布两侧各留 30px，可用宽 420。
// SVG 文本由 sharp 渲染，拿不到真实字体度量，只能按字符类型估宽（字号 1 时的 em 宽），宁松勿紧。
const TITLE_MAX_W = 420;
const charW = (ch) => {
  if (/[⺀-〿一-鿿豈-﫿＀-￯]/.test(ch)) return 1.0; // CJK 汉字 / 假名 / 全角标点
  if (ch === ' ') return 0.3;
  if (ch === '·') return 0.5;
  if (/[0-9]/.test(ch)) return 0.58; // 数字等宽
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[a-z]/.test(ch)) return 0.53;
  return 0.45; // 半角标点等
};
const estW = (s, size) => [...String(s)].reduce((w, ch) => w + charW(ch) * size, 0);

// 单行放得下就缩字号（最低 34），仍放不下则按自然断点折两行、再按最宽一行重算字号。
function titleLayout(title, { base = 50, min = 34 } = {}) {
  const s = String(title).trim();
  const sizeFor = (line) => Math.min(base, Math.floor((TITLE_MAX_W / estW(line, base)) * base));
  if (estW(s, base) <= TITLE_MAX_W) return { lines: [s], size: base };
  const fit = sizeFor(s);
  if (fit >= min) return { lines: [s], size: fit };
  const chars = [...s];
  const BRK = /[，,、。：:；;·｜|/—\s]/;
  let cut = Math.ceil(chars.length / 2);
  let best = Infinity;
  let bestAlt = Infinity;
  for (let i = 2; i <= chars.length - 2; i++) {
    if (!BRK.test(chars[i] || '') && !BRK.test(chars[i - 1] || '')) continue;
    const a = chars.slice(0, i).join('');
    const b = chars.slice(i).join('');
    const wide = Math.max(estW(a, base), estW(b, base));
    const alt = Math.abs(a.length - b.length);
    if (wide < best - 0.5 || (Math.abs(wide - best) <= 0.5 && alt < bestAlt)) {
      best = wide;
      bestAlt = alt;
      cut = i;
    }
  }
  const lines = [chars.slice(0, cut).join(''), chars.slice(cut).join('')];
  const widest = lines.reduce((a, b) => (estW(a, base) >= estW(b, base) ? a : b));
  return { lines, size: Math.max(min, sizeFor(widest)) };
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
    console.error('用法：node scripts/poster.mjs book --title <书名> --out <输出.jpg> [--author ..] [--year ..] [--c1 ..] [--c2 ..]');
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
    console.error('用法：node scripts/poster.mjs icon --icon <文件|URL> --out <输出.jpg> [--title ..] [--sub ..] [--c1 ..] [--c2 ..] [--icon-size ..] [--radius ..] [--disc ..] [--disc-r ..]');
    return 1;
  }
  const title = arg('title', '');
  const sub = arg('sub', '');
  const c1 = arg('c1', '#2f8f5b');
  const c2 = arg('c2', '#7ccb95');
  const ICON = Math.max(80, Number(arg('icon-size', '300')) || 300);
  // 图标圆角占边长的百分比（0 = 不裁；App Store 的 iOS 图标是直角方形，一般给 22）
  const radiusPct = Math.max(0, Math.min(50, Number(arg('radius', '0')) || 0));
  // --disc 给图标垫一个实心圆盘（如白色徽章盘）；留空则沿用原来的淡圆 + 描边。
  // 白色圆盘还能吃掉方形 logo 自带的白色四角，不必再靠 --radius 裁边。
  const discFill = String(arg('disc', '')).replace(/"/g, '');
  const discR = Math.max(40, Math.min(240, Number(arg('disc-r', '196')) || 196));
  const discSvg = discFill
    ? `<circle cx="${W / 2}" cy="286" r="${discR}" fill="${discFill}"/>`
    : `<circle cx="${W / 2}" cy="286" r="${discR}" fill="#fff" fill-opacity=".1"/>
  <circle cx="${W / 2}" cy="286" r="${discR}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>`;

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
  ${discSvg}
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`;

  const lay = titleLayout(title);
  const twoLine = lay.lines.length > 1;
  const titleSvg = title
    ? lay.lines
        .map(
          (l, i) =>
            `<text x="${W / 2}" y="${(sub ? 592 : 604) + i * (lay.size + 8)}" text-anchor="middle" font-size="${lay.size}" font-weight="700" font-family="${FONT}" fill="#fff">${esc(l.trim())}</text>`
        )
        .join('\n  ')
    : '';
  const subY = twoLine ? 664 : 638;

  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${titleSvg}
  ${sub ? `<text x="${W / 2}" y="${subY}" text-anchor="middle" font-size="23" font-family="${FONT}" fill="#fff" fill-opacity=".86">${esc(sub)}</text>` : ''}
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
    console.error('用法：node scripts/poster.mjs set --title <主标题> --out <输出.jpg> \\');
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

// ── scene：编辑式主题版式（2026-11-13 三张重绘海报的可复现实现）──────
// 统一骨架：细双框 + 眉标 + 矢量主视觉 + 菱形分隔线 + 主/副标题 + 页脚。
// 三套主视觉（saas 餐饮 POS / arch 分布式拓扑 / silk 丝路金月）与配色都落在下面的
// SCENES 里；不带覆盖参数时，出图与当时写进 static/images/ 的 jpg 逐字节一致。
function sceneSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="33%" r="66%">
      <stop offset="0" stop-color="${p.halo}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${p.halo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.plate}" stop-opacity="0"/>
      <stop offset="1" stop-color="${p.plate}" stop-opacity="${p.plateOpacity}"/>
    </linearGradient>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${p.line}" stroke-opacity=".075" stroke-width=".8"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <rect x="0" y="0" width="${W}" height="470" fill="url(#grid)"/>
  ${p.art}
  <rect x="0" y="455" width="${W}" height="265" fill="url(#plate)"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${p.line}" stroke-opacity=".34" stroke-width="1.2"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="${p.line}" stroke-opacity=".15" stroke-width=".8"/>
  <text x="${W / 2}" y="77" text-anchor="middle" font-family="${FONT}" font-size="13" letter-spacing="3.5" fill="${p.ink}" fill-opacity=".72">${esc(p.kicker)}</text>
  <rect x="216" y="94" width="48" height="1.4" fill="${p.line}" fill-opacity=".55"/>
  <rect x="108" y="478" width="264" height="1.2" fill="${p.line}" fill-opacity=".45"/>
  <rect x="235" y="473" width="10" height="10" fill="${p.accent}" transform="rotate(45 240 478)"/>
  ${p.text}
</svg>`;
}

const text = (x, y, s, size, fill, opts = {}) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${opts.weight || 400}"${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''} fill="${fill}"${opts.opacity ? ` fill-opacity="${opts.opacity}"` : ''}>${esc(s)}</text>`;

// saas：餐饮 SaaS 项目实战 —— 暖橙亮底 + POS 终端 / 云节点
const cs031Art = `
  <circle cx="240" cy="276" r="152" fill="#ffffff" fill-opacity=".34"/>
  <circle cx="240" cy="276" r="152" fill="none" stroke="#ffffff" stroke-opacity=".8" stroke-width="1.5"/>
  <circle cx="240" cy="276" r="127" fill="none" stroke="#b85530" stroke-opacity=".3" stroke-width="1.4" stroke-dasharray="3 9"/>
  <path d="M140 186 L188 222 M340 186 L292 222 M240 166 L240 214" stroke="#b5522e" stroke-opacity=".45" stroke-width="2" stroke-dasharray="5 7" fill="none"/>
  <circle cx="112" cy="168" r="30" fill="#ffffff" fill-opacity=".95"/>
  <path d="M96 164 Q112 183 128 164 Z" fill="#ef6b3c"/>
  <path d="M101 156 Q107 149 113 156 M109 153 Q115 146 121 153" stroke="#ef6b3c" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <circle cx="368" cy="168" r="30" fill="#ffffff" fill-opacity=".95"/>
  <rect x="355" y="152" width="26" height="33" rx="3" fill="#f2b78c"/>
  ${[159, 167, 175].map((y, i) => `<rect x="359" y="${y}" width="${i === 2 ? 12 : 18}" height="2.6" rx="1.3" fill="#ffffff" fill-opacity=".9"/>`).join('\n  ')}
  <circle cx="240" cy="140" r="26" fill="#ffffff" fill-opacity=".95"/>
  <circle cx="232" cy="142" r="7" fill="#ef6b3c"/><circle cx="244" cy="137" r="9" fill="#ef6b3c"/>
  <circle cx="253" cy="144" r="6" fill="#ef6b3c"/><rect x="230" y="142" width="26" height="8" rx="4" fill="#ef6b3c"/>
  <rect x="168" y="214" width="144" height="184" rx="16" fill="#ffffff" fill-opacity=".97"/>
  <rect x="168" y="214" width="144" height="36" rx="16" fill="#ef6b3c"/>
  <rect x="168" y="232" width="144" height="18" fill="#ef6b3c"/>
  <circle cx="186" cy="232" r="4" fill="#ffffff" fill-opacity=".9"/>
  <circle cx="200" cy="232" r="4" fill="#ffffff" fill-opacity=".6"/>
  <rect x="234" y="226" width="60" height="12" rx="6" fill="#ffffff" fill-opacity=".35"/>
  <rect x="186" y="264" width="108" height="11" rx="5.5" fill="#f6cbaa"/>
  ${[292, 320, 348].map((y, i) => `<circle cx="194" cy="${y}" r="7" fill="#f2a87c" fill-opacity="${1 - i * 0.18}"/>
  <rect x="208" y="${y - 5}" width="${80 - i * 12}" height="7" rx="3.5" fill="#e8d2c2"/>
  <rect x="208" y="${y + 6}" width="${52 - i * 6}" height="5" rx="2.5" fill="#f1e2d7"/>`).join('\n  ')}
  <rect x="186" y="368" width="108" height="20" rx="10" fill="#ef6b3c"/>
  <rect x="220" y="376" width="40" height="4" rx="2" fill="#ffffff" fill-opacity=".9"/>
  <rect x="104" y="404" width="272" height="9" rx="4.5" fill="#a84e2c" fill-opacity=".65"/>
  <rect x="132" y="413" width="10" height="36" rx="4" fill="#a84e2c" fill-opacity=".32"/>
  <rect x="338" y="413" width="10" height="36" rx="4" fill="#a84e2c" fill-opacity=".32"/>`;

const cs031Text = `
  ${text(240, 544, '基于 SaaS 的', 40, '#5a2a18', { weight: 700 })}
  ${text(240, 602, '餐掌柜项目实战', 46, '#5a2a18', { weight: 700 })}
  ${text(240, 646, '博学谷 · 餐饮 SaaS 全链路实战', 19, '#5a2a18', { opacity: 0.78 })}
  ${text(240, 688, 'JAVA  ·  多租户架构  ·  项目实战', 13, '#5a2a18', { opacity: 0.6, spacing: 1.6 })}`;

// arch：架构进阶 —— 冷青亮底 + 分布式拓扑 / 核心节点
const cs032Nodes = [[120, 176], [360, 176], [108, 276], [372, 276], [120, 376], [360, 376]]
  .map(([x, y]) => `<rect x="${x - 19}" y="${y - 19}" width="38" height="38" rx="10" fill="#ffffff" fill-opacity=".95"/>
  <circle cx="${x}" cy="${y}" r="8" fill="#188bca"/><circle cx="${x}" cy="${y}" r="3" fill="#ffffff"/>`)
  .join('\n  ');

const cs032Spokes = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((a) => {
    const rad = (a * Math.PI) / 180;
    const p1 = [240 + 34 * Math.cos(rad), 276 + 34 * Math.sin(rad)];
    const p2 = [240 + 48 * Math.cos(rad), 276 + 48 * Math.sin(rad)];
    return `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="#ffffff" stroke-opacity=".62" stroke-width="3" stroke-linecap="round"/>`;
  })
  .join('\n  ');

const cs032Art = `
  <circle cx="240" cy="276" r="152" fill="#ffffff" fill-opacity=".3"/>
  <circle cx="240" cy="276" r="152" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="1.5"/>
  <g stroke="#12608f" stroke-opacity=".42" stroke-width="2" fill="none">
    <path d="M240 276 L120 176 M240 276 L360 176 M240 276 L108 276 M240 276 L372 276 M240 276 L120 376 M240 276 L360 376"/>
  </g>
  ${cs032Nodes}
  <circle cx="240" cy="276" r="70" fill="#0f5f96" fill-opacity=".95"/>
  <circle cx="240" cy="276" r="57" fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="1.5" stroke-dasharray="5 7"/>
  ${cs032Spokes}
  <circle cx="240" cy="276" r="26" fill="#ffffff"/>
  <circle cx="240" cy="276" r="11" fill="#0f5f96"/>`;

const cs032Text = `
  ${text(240, 554, '狂野架构师', 64, '#0e3550', { weight: 700 })}
  <rect x="165" y="576" width="150" height="38" rx="19" fill="#0f5f96"/>
  ${text(240, 602, '第 3 期  ·  VOL.03', 19, '#ffffff', { weight: 600 })}
  ${text(240, 648, '博学谷 · 分布式系统架构进阶', 19, '#0e3550', { opacity: 0.78 })}
  ${text(240, 690, '高并发  ·  高可用  ·  可观测性', 13, '#0e3550', { opacity: 0.6, spacing: 1.6 })}`;

// silk：丝路音乐 20 周年 —— 夜色金月 / 沙丘 / 路线
const stars = [[68, 110], [120, 86], [398, 120], [420, 206], [72, 238], [356, 92], [300, 62], [176, 96], [96, 320], [404, 318]]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.2 : 1.4}" fill="#ffffff" fill-opacity="${i % 2 ? 0.45 : 0.72}"/>`)
  .join('\n  ');

const grooves = [90, 74, 58, 42]
  .map((r) => `<circle cx="240" cy="250" r="${r}" fill="none" stroke="#8a5a2e" stroke-opacity=".28" stroke-width="1.4"/>`)
  .join('\n  ');

const ot008Art = `
  ${stars}
  <circle cx="240" cy="250" r="106" fill="#e5bb72" fill-opacity=".95"/>
  <circle cx="240" cy="250" r="106" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="2"/>
  ${grooves}
  <path d="M162 186 A106 106 0 0 1 318 168" fill="none" stroke="#ffffff" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/>
  <circle cx="240" cy="250" r="17" fill="#132943"/>
  <circle cx="240" cy="250" r="5" fill="#e5bb72"/>
  <path d="M0 380 C90 330 160 356 240 384 C320 412 400 344 480 368 L480 480 L0 480 Z" fill="#b78449" fill-opacity=".9"/>
  <path d="M0 420 C110 382 180 428 280 410 C370 394 420 428 480 408 L480 480 L0 480 Z" fill="#6b432b" fill-opacity=".95"/>
  <path d="M0 452 C120 430 200 462 300 444 C390 428 430 452 480 442 L480 480 L0 480 Z" fill="#3a2a24" fill-opacity=".9"/>
  <path d="M42 432 C130 392 190 438 262 406 C330 376 392 418 450 388" fill="none" stroke="#f6dfae" stroke-opacity=".9" stroke-width="2.6" stroke-dasharray="2 10" stroke-linecap="round"/>
  <circle cx="42" cy="432" r="4" fill="#f6dfae"/><circle cx="450" cy="388" r="4" fill="#f6dfae"/>`;

const ot008Text = `
  ${text(240, 552, '丝绸之路', 68, '#f7efdf', { weight: 700 })}
  ${text(240, 604, '20 周年纪念特辑', 30, '#e5bb72', { weight: 600, spacing: 2 })}
  ${text(240, 650, '马友友  ·  Silk Road Music', 19, '#f7efdf', { opacity: 0.85 })}
  ${text(240, 692, 'WAV 无损  ·  2000 — 2020', 13, '#f7efdf', { opacity: 0.62, spacing: 1.6 })}`;

const SCENES = {
  saas: {
    bg1: '#fff2df', bg2: '#ffb877', halo: '#ffffff', plate: '#ffffff', plateOpacity: '.42',
    line: '#7a3a22', ink: '#5a2a18', accent: '#ef6b3c', kicker: 'BOXUEGU  /  COURSE 031',
    art: cs031Art, text: cs031Text,
    titles: ['基于 SaaS 的', '餐掌柜项目实战'],
    subText: '博学谷 · 餐饮 SaaS 全链路实战', footText: 'JAVA  ·  多租户架构  ·  项目实战',
    layout: {
      lines: [{ y: 544, size: 40, weight: 700 }, { y: 602, size: 46, weight: 700 }],
      sub: { y: 646, size: 19, opacity: 0.78 }, foot: { y: 688, size: 13, opacity: 0.6, spacing: 1.6 },
    },
  },
  arch: {
    bg1: '#edf8ff', bg2: '#78c2f2', halo: '#ffffff', plate: '#ffffff', plateOpacity: '.42',
    line: '#145a85', ink: '#0e3550', accent: '#0f5f96', kicker: 'BOXUEGU  /  ARCHITECT 03',
    art: cs032Art, text: cs032Text,
    titles: ['狂野架构师'],
    subText: '博学谷 · 分布式系统架构进阶', footText: '高并发  ·  高可用  ·  可观测性',
    layout: {
      lines: [{ y: 554, size: 64, weight: 700 }],
      badge: { y: 576, h: 38, textY: 602, size: 19, text: '第 3 期  ·  VOL.03' },
      sub: { y: 648, size: 19, opacity: 0.78 }, foot: { y: 690, size: 13, opacity: 0.6, spacing: 1.6 },
    },
  },
  silk: {
    bg1: '#0c1a30', bg2: '#2a4570', halo: '#d8ad6a', plate: '#0a1626', plateOpacity: '.58',
    line: '#e5bb72', ink: '#f7efdf', accent: '#e5bb72', kicker: 'SILK ROAD  /  20 YEARS',
    art: ot008Art, text: ot008Text,
    titles: ['丝绸之路', '20 周年纪念特辑'],
    subText: '马友友  ·  Silk Road Music', footText: 'WAV 无损  ·  2000 — 2020',
    layout: {
      lines: [{ y: 552, size: 68, weight: 700 }, { y: 604, size: 30, weight: 600, spacing: 2, accent: true }],
      sub: { y: 650, size: 19, opacity: 0.85 }, foot: { y: 692, size: 13, opacity: 0.62, spacing: 1.6 },
    },
  },
};

// 只有在 --title / --sub / --foot / --badge 覆盖时才重排文字层；默认直接用预设的
// 原始文本层，保证复现结果与当时写进 static/images/ 的 jpg 完全一致。
function buildText(p, scene) {
  const lay = scene.layout;
  const titles = arg('title', scene.titles.join('|')).split('|').map((s) => s.trim());
  const sub = arg('sub', scene.subText);
  const foot = arg('foot', scene.footText);
  const parts = [
    ...lay.lines.map((l, i) =>
      titles[i] ? `\n  ${text(W / 2, l.y, titles[i], l.size, l.accent ? p.accent : p.ink, { weight: l.weight, spacing: l.spacing })}` : ''
    ),
    lay.badge
      ? `\n  <rect x="165" y="${lay.badge.y}" width="150" height="${lay.badge.h}" rx="19" fill="${p.accent}"/>\n  ${text(W / 2, lay.badge.textY, arg('badge', lay.badge.text), lay.badge.size, '#ffffff', { weight: 600 })}`
      : '',
    sub ? `\n  ${text(W / 2, lay.sub.y, sub, lay.sub.size, p.ink, { opacity: lay.sub.opacity })}` : '',
    foot ? `\n  ${text(W / 2, lay.foot.y, foot, lay.foot.size, p.ink, { opacity: lay.foot.opacity, spacing: lay.foot.spacing })}` : '',
  ];
  return parts.join('');
}

async function posterScene() {
  const preset = arg('preset', '');
  const out = arg('out');
  const scene = SCENES[preset];
  if (!out || !scene) {
    console.error(`用法：node scripts/poster.mjs scene --preset <${Object.keys(SCENES).join('|')}> --out <输出.jpg>`);
    console.error('       [--title "第一行|第二行"] [--sub ..] [--foot ..] [--badge ..] [--kicker ..]');
    console.error('       [--bg1 ..] [--bg2 ..] [--halo ..] [--plate ..] [--ink ..] [--line ..] [--accent ..]');
    return 1;
  }
  const color = (k) => arg(k, scene[k]);
  const p = {
    bg1: color('bg1'), bg2: color('bg2'), halo: color('halo'), plate: color('plate'),
    plateOpacity: scene.plateOpacity, line: color('line'), ink: color('ink'), accent: color('accent'),
    kicker: arg('kicker', scene.kicker), art: scene.art,
  };
  const overridden = ['title', 'sub', 'foot', 'badge'].some((k) => process.argv.includes(`--${k}`));
  p.text = overridden ? buildText(p, scene) : scene.text;

  await writeJpeg(sceneSvg(p), out, { quality: 92, chromaSubsampling: '4:4:4' });
  console.log(`主题海报已生成：${out}（${W}×${H}，版式 ${preset}${overridden ? ' · 自定义文案' : ''}）`);
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
      '用法：node scripts/poster.mjs douban --title "书名" --out static/images/bk-001.jpg [--author 关键字] [--pick 豆瓣id] [--list]'
    );
    return 1;
  }

  const items = await searchBooks(title);
  const key = title.replace(/\s/g, '');
  const exact = items.filter((x) => String(x.title).replace(/\s/g, '') === key);
  const candidates = exact.length ? exact : items;

  if (!candidates.length) {
    console.error(`✗ 豆瓣未找到《${title}》（可能是已下架书目，改用 node scripts/poster.mjs book 生成封面）`);
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
  scene: posterScene,
  douban: posterDouban,
};

try {
  const run = MODES[mode];
  if (!run) {
    console.error(`用法：node scripts/poster.mjs <${Object.keys(MODES).join('|')}> [选项]`);
    process.exitCode = 1;
  } else {
    process.exitCode = await run();
  }
} catch (e) {
  console.error('✗ ' + e.message);
  process.exitCode = 1;
}
