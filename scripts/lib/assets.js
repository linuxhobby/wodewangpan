import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'];
// 详情页海报不再单独出一版：直接复用列表卡片这张 240×360，
// 两页就是同一张图、同一个 2:3 比例，放大到宫格卡片宽度也不会糊
const CARD = { w: 240, h: 360 };
const THUMB = { w: 60, h: 90 };
const SIZES = [CARD, THUMB];
/** 当前正在生成的配图宽度，构建时用它清理旧尺寸遗留 */
export const POSTER_WIDTHS = SIZES.map((s) => s.w);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadSharp() {
  try {
    const mod = await import('sharp');
    return mod.default || mod;
  } catch {
    return null;
  }
}

/** ICO 容器：直接内嵌 PNG 数据（浏览器普遍支持），省掉一个图标库依赖 */
function pngToIco(pngBuf, size) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size;
  entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([dir, entry, pngBuf]);
}

/** 站点图标：static/favicon.svg → favicon.svg（矢量）＋ favicon.ico（32px）＋ apple-touch-icon.png（180px） */
export async function writeFavicon(staticDir, outDir) {
  const src = path.join(staticDir, 'favicon.svg');
  if (!fs.existsSync(src)) return false;
  const svg = fs.readFileSync(src);
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), svg);
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const png32 = await sharp(svg, { density: 384 }).resize(32, 32).png().toBuffer();
      fs.writeFileSync(path.join(outDir, 'favicon.ico'), pngToIco(png32, 32));
      const png180 = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer();
      fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), png180);
    } catch {
      console.log('  ! 图标位图生成失败，仅输出 favicon.svg');
    }
  }
  return true;
}

const FONT = 'PingFang SC,Microsoft YaHei,Hiragino Sans GB,sans-serif';
const PW = CARD.w;
const PH = CARD.h;
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 各分类占位海报：配色 + 图标 + 专属底纹 + 英文副标题；未收录的分类按名称派生色相 */
const CAT_STYLE = {
  电影: { c1: '#5138d6', c2: '#a274ff', icon: 'film', en: 'FILM', tex: 'perforation' },
  电视剧: { c1: '#0a6386', c2: '#3fc9f0', icon: 'tv', en: 'TV SERIES', tex: 'scanlines' },
  纪录片: { c1: '#04614a', c2: '#3ddc97', icon: 'globe', en: 'DOCUMENTARY', tex: 'rings' },
  动漫: { c1: '#b81a56', c2: '#ff9a4d', icon: 'bubble', en: 'ANIME', tex: 'burst' },
  游戏: { c1: '#511ec2', c2: '#f0569c', icon: 'pad', en: 'GAME', tex: 'pixels' },
  软件: { c1: '#22344c', c2: '#5b7ba6', icon: 'window', en: 'SOFTWARE', tex: 'grid' },
  电子书: { c1: '#8a5a33', c2: '#e3b98f', icon: 'book', en: 'E-BOOK', tex: 'pages' },
  操作系统: { c1: '#123b5e', c2: '#57c7e8', icon: 'disc', en: 'OPERATING SYSTEM', tex: 'disc' },
  课程: { c1: '#7d4b00', c2: '#ffc857', icon: 'cap', en: 'COURSE', tex: 'pages' },
  其他: { c1: '#6a5a4d', c2: '#b09881', icon: 'folder', en: 'MISC', tex: 'waves' },
};

/** 96×96 图标：外层 <g> 给半透明填充 + 白色描边；纯线条元素自行 fill="none" */
const ICONS = {
  film: '<rect x="12" y="30" width="72" height="48" rx="6"/><path fill="none" d="M12 30 28 20l12 10 16-10 16 10 12-8"/><path fill="none" d="M28 30v48M56 30v48" stroke-width="3"/>',
  tv: '<rect x="12" y="26" width="72" height="48" rx="6"/><path fill="none" d="M34 74h28M48 74v12M32 86h32"/><path fill="none" d="M30 26 44 12M66 26 52 12"/>',
  globe:
    '<circle cx="48" cy="48" r="34"/><path fill="none" d="M14 48h68"/><path fill="none" d="M48 14c14 12 20 24 20 34s-6 22-20 34c-14-12-20-24-20-34s6-22 20-34z"/><path fill="none" d="M18 30h60M18 66h60" stroke-width="3"/>',
  bubble:
    '<path d="M16 22h64a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H46l-16 14V72h-14a10 10 0 0 1-10-10V32a10 10 0 0 1 10-10z"/><circle cx="38" cy="45" r="4" fill="#fff" stroke="none"/><circle cx="50" cy="45" r="4" fill="#fff" stroke="none"/><circle cx="62" cy="45" r="4" fill="#fff" stroke="none"/>',
  pad:
    '<rect x="10" y="30" width="76" height="42" rx="16"/><path fill="none" d="M30 42v14M23 49h14"/><circle cx="64" cy="45" r="5" fill="#fff" stroke="none"/><circle cx="76" cy="55" r="5" fill="#fff" stroke="none"/>',
  window:
    '<rect x="14" y="20" width="68" height="56" rx="6"/><path fill="none" d="M14 38h68"/><circle cx="24" cy="29" r="3" fill="#fff" stroke="none"/><circle cx="36" cy="29" r="3" fill="#fff" stroke="none"/><path fill="none" d="M24 50h32M24 62h20" stroke-width="4"/>',
  folder:
    '<path d="M10 28a6 6 0 0 1 6-6h20l8 10h40a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z"/><path fill="none" d="M10 46h76" stroke-width="3"/>',
  // 电子书：摊开的书（两页 + 书脊）
  book:
    '<path d="M10 26c14-8 24-8 38 0v46c-14-8-24-8-38 0z"/><path d="M86 26c-14-8-24-8-38 0v46c14-8 24-8 38 0z"/><path fill="none" d="M48 26v46" stroke-width="4"/>',
  // 操作系统：光盘（镜像文件），中心孔 + 一道高光弧
  disc:
    '<circle cx="48" cy="48" r="34"/><circle cx="48" cy="48" r="12" fill="#fff" stroke="none"/><path fill="none" d="M24 24A34 34 0 0 1 77 31" stroke-width="4"/>',
  // 课程：学士帽（帽顶菱形 + 帽筒 + 右侧垂下的流苏）
  cap:
    '<path d="M48 12 88 34 48 56 8 34z"/><path d="M24 46v10c0 7 11 12 24 12s24-5 24-12V46z"/><path fill="none" d="M88 34v16" stroke-width="4"/><circle cx="88" cy="56" r="5" fill="#fff" stroke="none"/>',
};

/** 分类专属底纹（240×360 坐标系，画在渐变底之上） */
const TEX = {
  // 电影：两侧胶片齿孔
  perforation() {
    let s = '';
    for (let y = 6; y < PH; y += 30)
      s += `<rect x="13" y="${y}" width="13" height="19" rx="4" stroke="none"/><rect x="${PW - 26}" y="${y}" width="13" height="19" rx="4" stroke="none"/>`;
    return s;
  },
  // 电视剧：扫描线
  scanlines() {
    let s = '';
    for (let y = 12; y < PH; y += 15) s += `<rect x="0" y="${y}" width="${PW}" height="4" stroke="none"/>`;
    return s;
  },
  // 纪录片：等高圈
  rings() {
    let s = '';
    for (let r = 46; r <= 230; r += 38) s += `<circle cx="${PW / 2}" cy="148" r="${r}" fill="none"/>`;
    return s;
  },
  // 动漫：集中线 + 网点
  burst() {
    let s = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const c = Math.cos(a);
      const n = Math.sin(a);
      s += `<path fill="none" d="M${(PW / 2 + c * 52).toFixed(1)} ${(148 + n * 52).toFixed(1)}L${(PW / 2 + c * 260).toFixed(1)} ${(148 + n * 260).toFixed(1)}" stroke-width="8"/>`;
    }
    for (let y = 16; y < PH; y += 26)
      for (let x = 16; x < PW; x += 26) s += `<circle cx="${x}" cy="${y}" r="2" stroke="none"/>`;
    return s;
  },
  // 游戏：像素方块
  pixels() {
    let s = '';
    for (let y = 8; y < PH; y += 30)
      for (let x = 8; x < PW; x += 30)
        if (((x + y) / 30) % 3 === 0)
          s += `<rect x="${x}" y="${y}" width="15" height="15" rx="4" stroke="none"/>`;
    return s;
  },
  // 软件：网格 + 代码括号
  grid() {
    let s = '';
    for (let x = 30; x < PW; x += 40) s += `<path fill="none" d="M${x} 0V${PH}" stroke-width="2"/>`;
    for (let y = 30; y < PH; y += 40) s += `<path fill="none" d="M0 ${y}H${PW}" stroke-width="2"/>`;
    s += '<path fill="none" d="M80 112l-18 36 18 36" stroke-width="6"/><path fill="none" d="M160 112l18 36-18 36" stroke-width="6"/>';
    return s;
  },
  // 电子书：书页上的文字行（长短交错，段落首行缩进）
  pages() {
    let s = '';
    let k = 0;
    for (let y = 10; y < PH; y += 18, k++) {
      const indent = k % 5 === 0 ? 30 : 0;
      const len = Math.max(46, PW - 40 - indent - (k % 3) * 16);
      s += `<rect x="${20 + indent}" y="${y}" width="${len}" height="6" rx="3" stroke="none"/>`;
    }
    return s;
  },
  // 其他：波浪
  waves() {
    let s = '';
    for (let k = 0; k < 5; k++)
      s += `<path fill="none" d="M-20 ${46 + k * 64}q30 -22 60 0t60 0t60 0t60 0t60 0" stroke-width="3"/>`;
    return s;
  },
  // 操作系统：光盘同心纹 + 一圈点位
  disc() {
    let s = '';
    for (const r of [70, 120, 170])
      s += `<circle cx="${PW / 2}" cy="148" r="${r}" fill="none" stroke-width="2"/>`;
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      s += `<circle cx="${(PW / 2 + Math.cos(a) * 145).toFixed(1)}" cy="${(148 + Math.sin(a) * 145).toFixed(1)}" r="4" stroke="none"/>`;
    }
    return s;
  },
};

/** 某分类的占位海报 SVG：渐变底 + 专属底纹 + 圆形徽章图标 + 分类名 */
function categorySvg(name) {
  const s =
    CAT_STYLE[name] ||
    (() => {
      let h = 7;
      for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
      return { c1: `hsl(${h} 42% 40%)`, c2: `hsl(${(h + 30) % 360} 52% 62%)`, icon: 'folder', en: '', tex: 'waves' };
    })();
  const icon = ICONS[s.icon] || ICONS.folder;
  const tex = (TEX[s.tex] || TEX.waves)();
  const label = esc(name);
  const en = s.en ? esc(s.en) : '';
  const cx = PW / 2;
  const cy = 148;
  const sub = en
    ? `\n  <text x="${cx}" y="288" text-anchor="middle" font-size="11" letter-spacing="4" font-family="Helvetica Neue,Arial,sans-serif" fill="#fff" fill-opacity=".72">${en}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="${label} 暂无配图">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.c1}"/><stop offset="1" stop-color="${s.c2}"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="14%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
  </defs>
  <rect width="${PW}" height="${PH}" fill="url(#bg)"/>
  <g fill="#fff" fill-opacity=".15" stroke="#fff" stroke-opacity=".15" stroke-width="3">${tex}</g>
  <rect width="${PW}" height="${PH}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="62" fill="#fff" fill-opacity=".14"/>
  <circle cx="${cx}" cy="${cy}" r="62" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.5"/>
  <g transform="translate(${cx - 48},${cy - 48})" fill="#fff" fill-opacity=".22" stroke="#fff" stroke-opacity=".95" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
  <rect y="230" width="${PW}" height="${PH - 230}" fill="url(#shade)"/>
  <text x="${cx}" y="266" text-anchor="middle" font-size="30" font-weight="600" font-family="${FONT}" fill="#fff">${label}</text>${sub}
  <line x1="${cx - 22}" y1="304" x2="${cx + 22}" y2="304" stroke="#fff" stroke-opacity=".45" stroke-width="2"/>
  <text x="${cx}" y="326" text-anchor="middle" font-size="12" font-family="${FONT}" fill="#fff" fill-opacity=".62">暂无配图</text>
</svg>
`;
}

/** 通用占位图：分类未知时兜底（分类图标 + 暂无配图）；仅供 prepareImages 内部调用 */
function writePlaceholder(outDir) {
  const dir = path.join(outDir, 'img');
  ensureDir(dir);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="暂无配图">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5F5F8"/><stop offset="1" stop-color="#E1E1E9"/></linearGradient></defs>
  <rect width="${PW}" height="${PH}" fill="url(#bg)"/>
  <circle cx="${PW / 2}" cy="148" r="62" fill="#fff" fill-opacity=".7"/>
  <circle cx="${PW / 2}" cy="148" r="62" fill="none" stroke="#C9C9D2" stroke-width="1.5"/>
  <g transform="translate(${PW / 2 - 48},100)" fill="#fff" fill-opacity=".55" stroke="#A9A9B4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="16" y="28" width="64" height="48" rx="6"/>
    <path fill="none" d="M18 68l18-20 13 15 10-10 27 24"/>
    <circle cx="34" cy="44" r="5"/>
  </g>
  <text x="${PW / 2}" y="266" text-anchor="middle" font-size="24" font-weight="600" font-family="${FONT}" fill="#8A8A94">暂无配图</text>
</svg>
`;
  fs.writeFileSync(path.join(dir, 'placeholder.svg'), svg);
  return '/img/placeholder.svg';
}

/** 按分类生成占位海报，返回 分类名 -> URL；仅供 prepareImages 内部调用 */
function writeCategoryPlaceholders(outDir, categories = []) {
  const dir = path.join(outDir, 'img');
  ensureDir(dir);
  const map = new Map();
  for (const c of categories) {
    if (!c || map.has(c)) continue;
    const file = `placeholder-${c}.svg`;
    fs.writeFileSync(path.join(dir, file), categorySvg(c));
    map.set(c, `/img/${encodeURIComponent(file)}`);
  }
  return map;
}

function resolveSource(item, staticDir, rootDir) {
  const candidates = [];
  if (item.image) {
    candidates.push(
      path.join(staticDir, 'images', item.image),
      path.join(rootDir, item.image),
      path.join(staticDir, item.image)
    );
  } else {
    for (const ext of IMAGE_EXT) candidates.push(path.join(staticDir, 'images', `${item.id}.${ext}`));
  }
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

const VARIANTS = [
  { key: 'cardExt', size: CARD, quality: 82 },
  { key: 'thumbExt', size: THUMB, quality: 78 },
];

async function renderVariants(sharp, src, destBase) {
  const ext = path.extname(src).toLowerCase();
  if (!sharp) {
    // 没有 sharp：原图直接复用，靠 CSS 裁切
    for (const v of VARIANTS) fs.copyFileSync(src, `${destBase}-${v.size.w}.${ext.slice(1)}`);
    return { cardExt: ext.slice(1), thumbExt: ext.slice(1) };
  }
  try {
    for (const v of VARIANTS) {
      await sharp(src)
        .resize(v.size.w, v.size.h, { fit: 'cover' })
        .webp({ quality: v.quality })
        .toFile(`${destBase}-${v.size.w}.webp`);
    }
    return { cardExt: 'webp', thumbExt: 'webp' };
  } catch {
    for (const v of VARIANTS) fs.copyFileSync(src, `${destBase}-${v.size.w}${ext}`);
    return { cardExt: ext.slice(1), thumbExt: ext.slice(1) };
  }
}

/**
 * 处理全部配图：生成 240×360 海报（列表页与详情页共用）与 60×90 缩略图两份 WebP
 * 返回 id -> { detail, card, thumb }（detail 与 card 指向同一个文件）
 */
export async function prepareImages(items, { staticDir, rootDir, outDir }) {
  const sharp = await loadSharp();
  if (!sharp) {
    console.log('  ! 未安装 sharp，配图将按原图输出（npm i sharp 可自动生成压缩 WebP）');
  }
  const placeholder = writePlaceholder(outDir);
  const catPlaceholders = writeCategoryPlaceholders(outDir, [
    ...new Set(items.map((i) => i.category)),
  ]);
  const imgDir = path.join(outDir, 'img');
  ensureDir(imgDir);

  const map = new Map();
  let processed = 0;
  let missing = 0;

  for (const item of items) {
    const src = resolveSource(item, staticDir, rootDir);
    if (!src) {
      // 缺图时用该资源所属分类的占位海报，一眼能看出是哪一类
      const ph = catPlaceholders.get(item.category) || placeholder;
      map.set(item.id, { detail: ph, card: ph, thumb: ph });
      missing++;
      continue;
    }
    const destBase = path.join(imgDir, item.id);
    const { cardExt, thumbExt } = await renderVariants(sharp, src, destBase);
    const card = `/img/${encodeURIComponent(item.id)}-${CARD.w}.${cardExt}`;
    map.set(item.id, {
      detail: card,
      card,
      thumb: `/img/${encodeURIComponent(item.id)}-${THUMB.w}.${thumbExt}`,
    });
    processed++;
  }

  return { map, processed, missing };
}

/** 构建时预生成二维码 SVG（纯静态图片，无需 JS） */
export async function writeQr(item, outDir) {
  const dir = path.join(outDir, 'qr');
  ensureDir(dir);
  const results = [];
  for (const link of item.links.slice(0, 3)) {
    const file = `${item.id}-${link.kind}.svg`;
    let svg = await QRCode.toString(link.url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#171717', light: '#FFFFFF' },
    });
    svg = svg.replace('<svg ', '<svg width="120" height="120" ');
    fs.writeFileSync(path.join(dir, file), svg);
    results.push({ ...link, qr: `/qr/${encodeURIComponent(file)}` });
  }
  return results;
}

/** 本页分享二维码：内容为资源页 canonical URL（区别于 writeQr 的网盘转存深链），
 *  供分享面板里的「微信扫一扫分享」使用，长按/扫码即把本页发给好友。 */
export async function writeShareQr(pageUrl, id, outDir) {
  const dir = path.join(outDir, 'qr');
  ensureDir(dir);
  const file = `share-${id}.svg`;
  let svg = await QRCode.toString(pageUrl, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#171717', light: '#FFFFFF' },
  });
  svg = svg.replace('<svg ', '<svg width="120" height="120" ');
  fs.writeFileSync(path.join(dir, file), svg);
  return `/qr/${encodeURIComponent(file)}`;
}

/** 拷贝主题静态资源（CSS / JS） */
export function copyThemeAssets(themeDir, outDir) {
  const src = path.join(themeDir, 'assets');
  const dest = path.join(outDir, 'assets');
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
}
