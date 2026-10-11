#!/usr/bin/env node
// 生成首页品牌分享卡（OG / Twitter Card）：1200×630，品牌渐变底 + 站点 logo + 站名 + 定位语。
// 产物提交进仓库（static/share.jpg），构建时直接拷到站点根目录，不依赖服务器上的中文字体。
//
// 用法：
//   node tools/share-poster.mjs --out static/share.jpg
//   node tools/share-poster.mjs --title "我的网盘资源站" --tag "夸克 / 百度网盘资源索引" \
//        --slogan "打开即用 · 扫码即存" --cats "电影 · 电视剧 · 纪录片 · 软件 · 电子书" \
//        --domain wodewangpan.top
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import yaml from 'js-yaml';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 默认站名 / 定位语 / 分类都从 config/site.yaml 取，改完站点配置重跑一次即可
let cfg = {};
try {
  cfg = yaml.load(fs.readFileSync('config/site.yaml', 'utf8')) || {};
} catch {
  /* 无配置文件时用下面的兜底文案 */
}
const descParts = String(cfg.description || '夸克 / 百度网盘资源索引，打开即用，扫码即存').split(/[，,]/);

/** 默认分类胶囊：从 data/*.yaml 统计各分类资源数，取数量最多的 5 个（按数量降序） */
const topCats = () => {
  const dir = 'data';
  if (!fs.existsSync(dir)) return ['电影', '电视剧', '纪录片', '软件', '电子书'];
  const counter = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    let rows;
    try {
      rows = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const c = r && (r.category || path.basename(f, path.extname(f)));
      if (c) counter.set(c, (counter.get(c) || 0) + 1);
    }
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
};
const cfgCats = topCats().join(' · ');

const out = arg('out', 'static/share.jpg');
const title = arg('title', cfg.title || '我的网盘资源站');
const tag = arg('tag', descParts[0] || '夸克 / 百度网盘资源索引');
const slogan = arg('slogan', descParts.slice(1).join(' · ') || '打开即用 · 扫码即存');
const cats = arg('cats', cfgCats);
const domain = arg('domain', 'wodewangpan.top');
// logo 源：默认用站点自己的 favicon.svg，保证与线上标识一致
const logo = arg('logo', 'static/favicon.svg');

const W = 1200;
const H = 630;
const FONT = 'PingFang SC,Microsoft YaHei,Hiragino Sans GB,sans-serif';
const LX = 88; // logo 左边距
const LOGO = 280;
const TX = 436; // 文字块左边距

/** 粗略估算文本宽度：全角按 1em、半角按 .55em、间隔号按 .5em */
const textWidth = (s, size) =>
  [...String(s)].reduce((w, ch) => {
    const code = ch.codePointAt(0);
    if (ch === '·' || ch === '/' || ch === ' ') return w + size * 0.5;
    return w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) || code > 0x2e80 ? size : size * 0.55);
  }, 0);

// 背景：与 logo 同色系的渐变（末端压深，保证白字对比度）+ 顶部柔光
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6b2ae8"/><stop offset=".55" stop-color="#2f45dd"/><stop offset="1" stop-color="#0a4fb0"/>
    </linearGradient>
    <radialGradient id="glow" cx="22%" cy="46%" r="62%">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="vig" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;

// 装饰：右侧 2×2 一排半透明「海报砖」，呼应站里的资源墙（右侧留 14px 边距，避免被画布切得生硬）
let tiles = '';
const TW = 116;
const TH = 168;
const T1 = 942;
const T2 = T1 + TW + 16;
const R1 = 82;
const R2 = R1 + TH + 22;
for (const x of [T1, T2]) {
  for (const y of [R1, R2]) {
    tiles += `<rect x="${x}" y="${y}" width="${TW}" height="${TH}" rx="14" fill="#fff" fill-opacity=".075"/>`;
  }
}
// 砖缝里补几点微光，制造景深
for (const [x, y] of [[T1 + TW + 8, 132], [T1 + TW + 8, 372], [T2 + 8, 246], [T1 + 8, 512]]) {
  tiles += `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" fill-opacity=".2"/>`;
}
const deco = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${tiles}</svg>`;

// 文字块
const TITLE_SIZE = 70;
const PILL_SIZE = 24;
const pillW = Math.round(textWidth(cats, PILL_SIZE) + 34);
const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <text x="${TX}" y="288" font-family="${FONT}" font-size="${TITLE_SIZE}" font-weight="700" fill="#fff">${esc(title)}</text>
  <text x="${TX}" y="358" font-family="${FONT}" font-size="34" fill="#fff" fill-opacity=".9">${esc(tag)}</text>
  <text x="${TX}" y="414" font-family="${FONT}" font-size="28" fill="#fff" fill-opacity=".76">${esc(slogan)}</text>
  <rect x="${TX}" y="466" width="${pillW}" height="46" rx="23" fill="#fff" fill-opacity=".16"/>
  <text x="${TX + 17}" y="496" font-family="${FONT}" font-size="${PILL_SIZE}" fill="#fff" fill-opacity=".94">${esc(cats)}</text>
  <text x="${LX + 2}" y="566" font-family="${FONT}" font-size="24" fill="#fff" fill-opacity=".62">${esc(domain)}</text>
</svg>`;

const logoPng = await sharp(logo).resize(LOGO, LOGO).png().toBuffer();

fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp(Buffer.from(bg))
  .composite([
    { input: Buffer.from(deco), left: 0, top: 0 },
    { input: logoPng, left: LX, top: Math.round((H - LOGO) / 2) },
    { input: Buffer.from(text), left: 0, top: 0 },
  ])
  .jpeg({ quality: 88 })
  .toFile(out);

console.log(`分享卡已生成：${out}（${W}×${H}）`);
