#!/usr/bin/env node
// 生成首页品牌分享卡（OG / Twitter Card）：1200×630。
// 左侧品牌信息，右侧「分类海报墙」：每个分类沿用站内占位海报的渐变配色、专属图标与英文名，
// 让分享卡一眼看出站点覆盖哪些内容；分类增删跟着 config/site.yaml 自动走，不写死数量。
// 产物提交进仓库（static/share.jpg），构建时直接拷到站点根目录，不依赖服务器上的中文字体。
//
// 用法（在仓库根目录执行）：
//   node scripts/share-poster.mjs --out static/share.jpg
//   node scripts/share-poster.mjs --title "…" --tag "…" --slogan "…" --domain www.wodewangpan.top
import fs from 'node:fs';
import path from 'node:path';
// sharp 是 optionalDependencies，装不上时只影响本工具出图（与 poster.mjs 同款动态加载）
const sharpOf = async () => (await import('sharp')).default;
import yaml from 'js-yaml';
import { esc } from '../theme/assets/card.js';
import { CAT_STYLE, ICONS } from './lib/assets.js';

const W = 1200;
const H = 630;
const FONT = 'PingFang SC,Microsoft YaHei,Hiragino Sans GB,sans-serif';
const EN_FONT = 'Helvetica Neue,Arial,sans-serif';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
let cfg = {};
try {
  cfg = yaml.load(fs.readFileSync('config/site.yaml', 'utf8')) || {};
} catch {
  /* 无配置文件时用下面的兜底文案 */
}
const descParts = String(cfg.description || '夸克 / 百度 / 光鸭云盘资源索引，打开即用，扫码即存').split(/[，,]/);

const out = arg('out', 'static/share.jpg');
const title = arg('title', cfg.title || '我的网盘索引站');
const tag = arg('tag', descParts[0] || '夸克 / 百度 / 光鸭云盘资源索引');
const slogan = arg('slogan', descParts.slice(1).join(' · ') || '打开即用 · 扫码即存');
const domain = arg('domain', 'www.wodewangpan.top');
const logo = arg('logo', 'static/favicon.svg');

/** 卡片配色 / 图标 / 英文副标与站内占位海报同源，避免两处口径漂移 */
const cats = (Array.isArray(cfg.categories) && cfg.categories.length
  ? cfg.categories
  : Object.keys(CAT_STYLE)
).map(String);
const styleOf = (name) => CAT_STYLE[name] || { c1: '#4f46e5', c2: '#a274ff', icon: 'folder', en: '' };
const iconOf = (name) => ICONS[styleOf(name).icon] || ICONS.folder;

// 分类墙：9 类正好 3×3；以后分类变多自动改 4 列并重排，卡片尺寸跟着行列收放
const cols = cats.length > 9 ? 4 : 3;
const rows = Math.max(1, Math.ceil(cats.length / cols));
const BOX = { x: 606, y: 62, w: 540, h: 506 };
const GAP = 14;
const CW = (BOX.w - GAP * (cols - 1)) / cols;
const CH = (BOX.h - GAP * (rows - 1)) / rows;
const ROTS = [-2, 1.4, -1.2, 1.1, -1.6, 1.8, -0.8, 1.3, -1.4];

const cardDefs = cats
  .map((c, i) => {
    const s = styleOf(c);
    return `<linearGradient id="c${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.c1}"/><stop offset="1" stop-color="${s.c2}"/></linearGradient>`;
  })
  .join('\n  ');

const cards = cats
  .map((c, i) => {
    const s = styleOf(c);
    const x = BOX.x + (i % cols) * (CW + GAP);
    const y = BOX.y + Math.floor(i / cols) * (CH + GAP);
    const rot = ROTS[i % ROTS.length];
    const cx = CW / 2;
    const mid = CH / 2;
    const size = Math.min(76, CH * 0.46);
    const scale = size / 96;
    const iy = CH * 0.35;
    const en = s.en
      ? `\n  <text x="${cx.toFixed(1)}" y="${(CH - 12).toFixed(1)}" text-anchor="middle" font-family="${EN_FONT}" font-size="10.5" letter-spacing="2.4" fill="#fff" fill-opacity=".72">${esc(s.en)}</text>`
      : '';
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot} ${cx.toFixed(1)} ${mid.toFixed(1)})">
  <rect y="10" width="${CW.toFixed(1)}" height="${CH.toFixed(1)}" rx="20" fill="#050a2a" fill-opacity=".45" filter="url(#sh)"/>
  <rect width="${CW.toFixed(1)}" height="${CH.toFixed(1)}" rx="20" fill="url(#c${i})"/>
  <rect width="${CW.toFixed(1)}" height="${CH.toFixed(1)}" rx="20" fill="url(#cardGlow)"/>
  <rect x="1" y="1" width="${(CW - 2).toFixed(1)}" height="${(CH - 2).toFixed(1)}" rx="19" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="1.5"/>
  <circle cx="${cx.toFixed(1)}" cy="${iy.toFixed(1)}" r="${(size * 0.62).toFixed(1)}" fill="#fff" fill-opacity=".13"/>
  <circle cx="${cx.toFixed(1)}" cy="${iy.toFixed(1)}" r="${(size * 0.62).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="1.5"/>
  <g transform="translate(${(cx - size / 2).toFixed(1)} ${(iy - size / 2).toFixed(1)}) scale(${scale.toFixed(4)})" fill="#fff" fill-opacity=".24" stroke="#fff" stroke-opacity=".96" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${iconOf(c)}</g>
  <text x="${cx.toFixed(1)}" y="${(CH - 32).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="23" font-weight="600" fill="#fff">${esc(c)}</text>${en}
</g>`;
  })
  .join('\n');

let grid = '';
for (let x = 0; x <= W; x += 48) grid += `<path d="M${x} 0V${H}"/>`;
for (let y = 0; y <= H; y += 48) grid += `<path d="M0 ${y}H${W}"/>`;
const dots = [
  [560, 92, 4, 0.26], [1152, 58, 5, 0.2], [520, 524, 3, 0.24],
  [96, 600, 4, 0.18], [586, 318, 3, 0.3], [1172, 472, 4, 0.2],
]
  .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity="${o}"/>`)
  .join('');

const pills = ['分类浏览', '片名搜索', '扫码转存']
  .map((t, i) => {
    const x = 68 + i * 132;
    return `<rect x="${x}" y="396" width="120" height="42" rx="21" fill="#fff" fill-opacity=".11" stroke="#fff" stroke-opacity=".16" stroke-width="1"/>
  <text x="${x + 60}" y="423" text-anchor="middle" font-size="18" fill="#fff" fill-opacity=".9">${esc(t)}</text>`;
  })
  .join('\n  ');

// 底部一条分类色带，把左右两块视觉连起来
const bandW = (W - 136) / Math.max(1, cats.length);
const band = cats
  .map((c, i) => `<rect x="${(68 + i * bandW).toFixed(1)}" y="596" width="${(bandW - 5).toFixed(1)}" height="7" rx="3.5" fill="${styleOf(c).c2}"/>`)
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#211a7a"/><stop offset=".52" stop-color="#3033b6"/><stop offset="1" stop-color="#0c2168"/></linearGradient>
  <radialGradient id="glow" cx="20%" cy="24%" r="70%"><stop offset="0" stop-color="#8b7bff" stop-opacity=".38"/><stop offset="1" stop-color="#8b7bff" stop-opacity="0"/></radialGradient>
  <linearGradient id="vig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a2a" stop-opacity="0"/><stop offset="1" stop-color="#050a2a" stop-opacity=".42"/></linearGradient>
  <radialGradient id="cardGlow" cx="50%" cy="8%" r="85%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
  ${cardDefs}
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<g stroke="#fff" stroke-opacity=".045" stroke-width="1">${grid}</g>
<g fill="#fff">${dots}</g>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
${cards}
<g font-family="${FONT}">
  <text x="68" y="248" font-size="58" font-weight="700" fill="#fff">${esc(title)}</text>
  <text x="68" y="302" font-size="27" fill="#fff" fill-opacity=".9">${esc(tag)}</text>
  <text x="68" y="346" font-size="23" fill="#fff" fill-opacity=".72">${esc(slogan)}</text>
  ${pills}
  <line x1="68" y1="486" x2="470" y2="486" stroke="#fff" stroke-opacity=".2" stroke-width="1"/>
  <text x="68" y="558" font-size="23" fill="#fff" fill-opacity=".68">${esc(domain)}</text>
</g>
${band}
</svg>`;

const sharp = await sharpOf();
const logoPng = await sharp(logo).resize(92, 92).png().toBuffer();

fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp(Buffer.from(svg))
  .composite([{ input: logoPng, left: 68, top: 76 }])
  .jpeg({ quality: 90 })
  .toFile(out);

console.log(`分享卡已生成：${out}（${W}×${H} · ${cats.length} 个分类）`);
