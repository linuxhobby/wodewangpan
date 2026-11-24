import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  loadSite,
  loadTagConfig,
  loadResources,
  normalizeResources,
  orderCategories,
  categorySlug,
  syncHeaderCounts,
  clipDesc,
  collectTags,
  tagSlug,
  setSlugFallback,
  slugify,
  todayShanghai,
  newestIdsOf,
} from './lib/data.js';
import {
  prepareImages,
  writeQr,
  writeShareQr,
  writeFavicon,
  copyThemeAssets,
  POSTER_WIDTHS,
  OG_VERSION,
} from './lib/assets.js';
import {
  listPage,
  detailPage,
  aboutPage,
  privacyPage,
  contactPage,
  allPage,
  hotPage,
  followingPage,
  rssPage,
  feedXml,
  notFoundPage,
  sitemapXml,
  catFeedHref,
  tagPage,
  tagsPage,
  ALL_PAGE_SIZE,
  setItemPaths,
  itemHref,
} from './lib/render.js';
import { setCategoryPaths } from './lib/nav.js';
import { readFollowingManifest } from './lib/following-manifest.mjs';
import { createWriter, prune } from './lib/buildfs.js';
import { patchAppCardVersion, copyExtraStaticFiles, pruneOldOgVersions } from './lib/postprocess.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');
const staticDir = path.join(root, 'static');
const themeDir = path.join(root, 'theme');
// 原子发布时构建到 public.new，就绪后整体换成 public，nginx 读不到半成品
const outDirName = process.env.BUILD_DIR || 'public';
const outDir = path.join(root, outDirName);
// 上一版产物，供 write() 比对「内容未变就沿用」；直接构建到 public/ 时不需要
const prevDirName = outDirName === 'public' ? '' : process.env.PREV_DIR || 'public';
const prevDir = prevDirName ? path.join(root, prevDirName) : '';

const { write, reused } = createWriter({ outDir, prevDir });

// 图标版本号：图片缓存 30 天，内容一变 URL 就得变，否则换了 logo 浏览器不回源
function iconVersionOf(file) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  } catch {
    return '';
  }
}

const t0 = Date.now();
console.log('读取数据源…');
const site = loadSite(configDir);
// 必须在第一次 tagSlug() 之前加载：晚一步别名表不生效，URL 会退回拼音兜底
const tagCfg = loadTagConfig(configDir);
// 环境变量优先（服务器由 /etc/wdwp-autoupdate.conf 注入），其次 site.yaml 的 baseUrl
const DEFAULT_BASE_URL = 'https://www.wodewangpan.top';
const baseUrl = (process.env.BASE_URL || site.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
if (baseUrl.includes('example.com')) {
  console.log('  ! 站点域名是占位值 example.com，canonical / OG / sitemap 会指错');
  console.log('    请用 BASE_URL=... npm run build，或在 config/site.yaml 写 baseUrl: https://你的域名');
}
// 验证 meta 不输出时页面照常能打开，看不出缺了什么，只能在构建时提醒一次
if (!site.verification || !Object.values(site.verification).filter((v) => String(v ?? '').trim()).length) {
  console.log('  ! 未配置站长验证：config/site.yaml 的 verification 为空，搜索引擎后台无法验证站点归属');
}
const raw = loadResources(dataDir);
const synced = syncHeaderCounts(dataDir);
if (synced.length) console.log(`  · 条数注释已刷新：${synced.join('、')}`);
const { items, counts } = normalizeResources(raw);
const categories = orderCategories(site, counts);
const total = items.length;

/** 一级目录保留名：分类 slug 撞上这些名字会与静态资源 / 独立页互相覆盖（构建不报错，必须提前拦）。
 *  slug 必须是英文小写：categorySlug() 未配别名时会回落中文，不能拿它当 URL 目录。 */
const RESERVED_TOP_DIRS = new Set([
  'about', 'all', 'assets', 'contact', 'following', 'hot', 'img', 'og', 'privacy', 'promo',
  'qr', 'rss', 'tag', 'tags',
]);
{
  const bad = categories
    .map(categorySlug)
    .filter((s) => RESERVED_TOP_DIRS.has(s) || !/^[a-z0-9-]+$/.test(s));
  if (bad.length) {
    console.error(`  ! 分类路径非法（撞保留目录或不是英文 slug）：${bad.join('、')}`);
    process.exit(1);
  }
}
// URL 结构：分类页 /<slug>/、详情页 /<slug>/<id>/；
// 两处注入让 itemHref() / pageTypeOf() 以数据里的 category 为准，不靠 id 前缀约定
setItemPaths(items);
setCategoryPaths(categories.map(categorySlug));

// 全站共用一份判断，免得首页 / 分类页 / 搜索索引各标一套
const today = todayShanghai();
const newestIds = newestIdsOf(items, today);
if (newestIds.size) {
  console.log(`  · 「最新」角标：${today}（北京时间）入库 ${newestIds.size} 条`);
} else {
  console.log(`  · ${today}（北京时间）没有新入库，本次构建的「最新」角标不会出现`);
}

// 拼音给两处用：站内搜索的拼音输入、标签 slug 兜底（没配别名的自动转拼音，不必手工补表）。
// 必须在 collectTags() 之前装好：slug 算出就定了，晚一步走不到兜底。装不上只是退回中文原样
let toPinyin = null;
try {
  const { pinyin } = await import('pinyin-pro');
  const toPyArray = (text) => pinyin(text, { toneType: 'none', type: 'array' });
  toPinyin = (text) => ({
    py: toPyArray(text).join(''),
    py1: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
  });
  setSlugFallback((tag) => slugify(toPyArray(tag).join('')));
} catch {
  console.log(
    '  ! 未安装 pinyin-pro：站内搜索不支持拼音，新增标签的 URL 也会是编码的中文（npm i -D pinyin-pro 可开启）'
  );
}

// 只留资源数达 tagMin 的标签（默认 3）；tagExclude 点名的不建页——页面会与分类页近重复
const tags = collectTags(items, { categories, min: tagCfg.min, exclude: tagCfg.exclude });
/** 标签 key → 聚合信息：详情页据此决定标签给不给链接 */
const tagIndex = new Map(tags.map((t) => [t.key, t]));

function checkTagSlugClashes(tags) {
  const seen = new Map();
  const clash = [];
  for (const t of tags) {
    const s = tagSlug(t.label);
    if (seen.has(s)) clash.push(`「${seen.get(s)}」与「${t.label}」→ /tag/${s}/`);
    else seen.set(s, t.label);
  }
  if (clash.length) {
    console.log(`  ! ${clash.length} 组标签 slug 撞车，页面会互相覆盖：`);
    for (const c of clash) console.log(`      ${c}`);
    console.log('      在 config/tags.yaml 的 tagSlugs 里给其中一个配个别名');
  }
}
checkTagSlugClashes(tags);

if (!total) {
  console.error('! data/ 目录下没有解析到任何资源，请检查 YAML');
  process.exit(1);
}

function cleanupStaleOutputs({ outDir, outDirName, categories, items, tags }) {
  fs.mkdirSync(outDir, { recursive: true });
  const keepIdsByCat = new Map();
  for (const it of items) {
    const slug = categorySlug(it.category);
    if (!keepIdsByCat.has(slug)) keepIdsByCat.set(slug, new Set());
    keepIdsByCat.get(slug).add(it.id);
  }
  const keepCats = new Set(categories.map(categorySlug));
  const keepTags = new Set(tags.map((t) => tagSlug(t.label)));
  let staleFailed = 0;
  for (const old of ['resource', 'category']) {
    const dir = path.join(outDir, old);
    if (!fs.existsSync(dir)) continue;
    staleFailed += prune(dir, () => false).failed;
    try {
      fs.rmdirSync(dir);
    } catch {
      staleFailed++;
    }
  }
  staleFailed += prune(outDir, (name) => {
    const st = fs.statSync(path.join(outDir, name), { throwIfNoEntry: false });
    if (st && !st.isDirectory()) return true;
    return RESERVED_TOP_DIRS.has(name) || keepCats.has(name);
  }).failed;
  for (const slug of keepCats) {
    const keep = keepIdsByCat.get(slug) || new Set();
    staleFailed += prune(path.join(outDir, slug), (name) =>
      name === 'index.html' || name === 'feed.xml' || keep.has(name)
    ).failed;
  }
  staleFailed += prune(path.join(outDir, 'tag'), (name) => keepTags.has(name)).failed;
  if (staleFailed) {
    console.log(`  ! ${staleFailed} 个旧目录未能清理（不影响访问）；可手动执行 rm -rf ${outDirName} 后重新构建`);
  }
}
cleanupStaleOutputs({ outDir, outDirName, categories, items, tags });

console.log(`处理配图（${total} 条）…`);
const { map: images, missing, reused: reusedImages } = await prepareImages(items, { staticDir, rootDir: root, outDir, prevDir });
if (missing) console.log(`  · ${missing} 条缺少配图，使用占位图`);
if (reusedImages && prevDir) console.log(`  · 配图增量复用 ${reusedImages} 张（源图未变，从 ${prevDirName}/ 沿用）`);

// 配图改尺寸后，旧宽度的文件会一直堆在 public/img 里，按当前宽度集合清掉
{
  const keepW = new Set(POSTER_WIDTHS.map(String));
  const { removed: staleImg } = prune(path.join(outDir, 'img'), (name) => {
    const m = /^(.*)-(\d+)\.(?:webp|jpe?g|png|avif|gif|svg)$/i.exec(name);
    return !m || keepW.has(m[2]);
  });
  if (staleImg) console.log(`  · 已清理 ${staleImg} 个旧尺寸配图（当前生成宽度：${POSTER_WIDTHS.join('/')}）`);
}
// 清理旧 OG 版本目录（只保留当前 OG_VERSION），避免产物堆积
pruneOldOgVersions(outDir, OG_VERSION);

if (await writeFavicon(staticDir, outDir)) console.log('  · 已生成 favicon.svg / favicon.ico / apple-touch-icon.png');

const shareSrc = path.join(staticDir, 'share.jpg');
// og:image 带内容 hash：换分享卡时站外平台才会重新抓图，不吃旧缓存
const shareImage = fs.existsSync(shareSrc)
  ? `/share.jpg?v=${crypto.createHash('sha1').update(fs.readFileSync(shareSrc)).digest('hex').slice(0, 8)}`
  : '';
if (shareImage) {
  fs.copyFileSync(shareSrc, path.join(outDir, 'share.jpg'));
  console.log('  · 已复制首页分享卡 share.jpg');
} else {
  console.log('  ! 未找到 static/share.jpg，首页分享图将回退为最新资源的配图');
}

console.log('生成二维码…');
const qrMap = new Map();
for (const item of items) {
  qrMap.set(item.id, await writeQr(item, outDir));
}

// 本页分享二维码（微信扫一扫分享资源页，区别于扫码转存的深链二维码）
const shareQrMap = new Map();
for (const item of items) {
  const pageUrl = `${baseUrl}${itemHref(item.id)}`;
  shareQrMap.set(item.id, await writeShareQr(pageUrl, item.id, outDir));
}

// 全站索引：列表页内联（首屏离线可用）+ search-index.json（搜索全站）
const indexAll = items.map((it) => {
  const img = images.get(it.id) || {};
  // 站内搜索的拼音索引带上 keywords（原始标签，含被展示层隐掉的作品英文原名）：
  // 搜「Zootopia」仍能命中「疯狂动物城」，但卡片上不会再出现整条作品名标签
  const py = toPinyin ? toPinyin(`${it.title}${it.keywords || it.tags.join('')}`) : null;
  return {
    id: it.id,
    title: it.title,
    category: it.category,
    tags: it.tags,
    desc: clipDesc(it.description, 40),
    href: itemHref(it.id),
    date: it.date,
    thumb: img.thumb || '/img/placeholder.svg',
    card: img.card || '/img/placeholder.svg',
    // 前端直接读这个结果：索引里没有入库日，浏览器自己算不出来
    isNew: newestIds.has(it.id),
    ...(py || {}),
  };
});

// 搜索索引随内容变化就得换 URL：和静态资源一样用内容哈希做版本号，否则浏览器 / CDN
// 按 nginx 的 30 天 max-age 缓存旧索引，新增资源永不进搜索（这正是「后面新增内容搜不到」的根因）
const searchIndexVersion = crypto.createHash('md5').update(JSON.stringify(indexAll)).digest('hex').slice(0, 8);
const searchIndexUrl = `/search-index.json?v=${searchIndexVersion}`;

// 静态资源版本号用内容哈希，不能用 commit：commit 会让每次提交（哪怕只加一条数据）
// 都改写所有页面的 ?v=，mtime 全量刷新，「内容未变不覆盖」就失效了
const assetVersion = (() => {
  try {
    const hash = crypto.createHash('md5');
    const files = fs
      .readdirSync(path.join(themeDir, 'assets'))
      .filter((f) => /\.(css|js)$/i.test(f))
      .sort();
    for (const f of files) hash.update(fs.readFileSync(path.join(themeDir, 'assets', f)));
    const digest = hash.digest('hex').slice(0, 8);
    // 取不到退回固定串：绝不能用时间戳，那等于把上面的问题又引回来
    return digest || 'dev';
  } catch {
    return 'dev';
  }
})();

const iconVersion = iconVersionOf(path.join(staticDir, 'favicon.svg'));
console.log(`  · 图标版本：${iconVersion || '未取到（回退到构建版本号）'}`);

const ctxBase = {
  site,
  categories,
  counts,
  total,
  items,
  images,
  baseUrl,
  indexAll,
  searchIndexUrl,
  assetVersion,
  iconVersion,
  shareImage,
  tags,
  tagIndex,
  tagMeta: tagCfg.meta,
  newestIds,
};

// 热门榜快照：stats.json 由服务器 sitestats 每 10 分钟生成、不归构建管；
// 构建时从上一版产物（线上 public/）读快照，把 top N 渲染成静态 HTML，蜘蛛不执行 JS 也能看到榜单
let hotStats = null;
for (const dir of [prevDir, outDir]) {
  if (!dir) continue;
  try {
    hotStats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')).res || null;
    if (hotStats) break;
  } catch {
    /* 没有快照就退化为最新入库兜底 */
  }
}
if (hotStats) console.log('  · 已读取访问统计快照，热门榜按真实数据静态渲染');

// 追热播是虚拟栏目：清单不存在就渲染空状态；不进 sitemap / RSS，也不改资源 URL
const following = readFollowingManifest(configDir);
if (following.active.length) {
  console.log(`  · 追热播清单：${following.active.length} 部（来源 ${following.source}）`);
}

// 列表页与分类 RSS 各自都要按分类取子集，分组一次省掉两遍 filter
const byCat = new Map(categories.map((c) => [c, []]));
for (const it of items) {
  // 死链不进分类卡片 / 翻页 / 分类 feed：详情页已 noindex，内链再往里引就白耗抓取预算
  if (it.dead) continue;
  if (!byCat.has(it.category)) byCat.set(it.category, []);
  byCat.get(it.category).push(it);
}

// 详情页「上一个 / 下一个」：只在本分类内按分类页的排序顺走，首尾缺的一侧为 null。
// 映射一次算完，避免每张详情页各 filter 一遍全量 items。
const pagerMap = new Map();
for (const list of byCat.values()) {
  for (let i = 0; i < list.length; i++) {
    pagerMap.set(list[i].id, { prev: list[i - 1] || null, next: list[i + 1] || null });
  }
}

console.log('生成列表页…');
write(
  path.join(outDir, 'index.html'),
  listPage({ ...ctxBase, activeCat: '', pageSize: site.pageSize, byCat })
);
for (const cat of categories) {
  const file = path.join(outDir, categorySlug(cat), 'index.html');
  write(file, listPage({ ...ctxBase, items: byCat.get(cat), activeCat: cat, pageSize: site.pageSize }));
}

console.log('生成详情页…');
for (const item of items) {
  write(
    path.join(outDir, categorySlug(item.category), item.id, 'index.html'),
    detailPage({
      ...ctxBase,
      item,
      qrLinks: qrMap.get(item.id) || [],
      shareQr: shareQrMap.get(item.id) || '',
      pager: pagerMap.get(item.id) || null,
    })
  );
}

console.log(`生成标签聚合页（${tags.length} 个）…`);
for (const t of tags) {
  write(path.join(outDir, 'tag', tagSlug(t.label), 'index.html'), tagPage({ ...ctxBase, tag: t }));
}

console.log('生成关于本站 / RSS 页面…');
// /all/ 是蜘蛛的全量通道，死链详情页已 noindex，这条通道里也别再列。
// 分页写出（每页 ALL_PAGE_SIZE 条）：单页近千条链接权重摊薄，蜘蛛从上一页/下一页往下走
{
  const aliveItems = items.filter((i) => !i.dead);
  const allPages = Math.max(1, Math.ceil(aliveItems.length / ALL_PAGE_SIZE));
  write(
    path.join(outDir, 'all', 'index.html'),
    allPage({ ...ctxBase, items: aliveItems, total: aliveItems.length })
  );
  for (let p = 2; p <= allPages; p++) {
    write(
      path.join(outDir, 'all', 'page', String(p), 'index.html'),
      allPage({ ...ctxBase, items: aliveItems, total: aliveItems.length, page: p })
    );
  }
  // 资源减少导致总页数变少后，旧分页目录会残留，按当前页数清掉
  const { failed: staleAllFailed } = prune(
    path.join(outDir, 'all', 'page'),
    (name) => Number(name) >= 2 && Number(name) <= allPages
  );
  if (staleAllFailed) {
    console.log(`  ! /all/page 下 ${staleAllFailed} 个旧分页目录未能清理（不影响访问）`);
  }
}
write(path.join(outDir, 'hot', 'index.html'), hotPage({ ...ctxBase, hotStats }));
write(path.join(outDir, 'following', 'index.html'), followingPage({ ...ctxBase, following }));
write(path.join(outDir, 'about', 'index.html'), aboutPage(ctxBase));
write(path.join(outDir, 'privacy', 'index.html'), privacyPage(ctxBase));
write(path.join(outDir, 'contact', 'index.html'), contactPage(ctxBase));
write(path.join(outDir, 'tags', 'index.html'), tagsPage(ctxBase));
write(path.join(outDir, 'rss', 'index.html'), rssPage(ctxBase));

/** 给 feed 用的资源视图：补上绝对配图路径；死链不进 RSS（详情页已 noindex，别再推送） */
const feedItems = items.filter((i) => !i.dead).map((it) => ({ ...it, poster: (images.get(it.id) || {}).detail || '' }));
write(
  path.join(outDir, 'feed.xml'),
  feedXml({
    site,
    items: feedItems,
    baseUrl,
    categories,
    feedPath: '/feed.xml',
    title: `${site.title} · 最新资源`,
    description: site.description || `${site.title}最新入库的网盘资源`,
  })
);
for (const cat of categories) {
  const list = feedItems.filter((i) => i.category === cat);
  write(
    path.join(outDir, categorySlug(cat), 'feed.xml'),
    feedXml({
      site,
      items: list,
      baseUrl,
      categories: [cat],
      feedPath: catFeedHref(cat),
      title: `${site.title} · ${cat}`,
      description: `${site.title}的${cat}分类，最新入库的网盘资源`,
    })
  );
}

console.log('生成搜索索引与附加文件…');
write(path.join(outDir, 'search-index.json'), JSON.stringify(indexAll));
write(path.join(outDir, '404.html'), notFoundPage(ctxBase));
write(
  path.join(outDir, 'robots.txt'),
  // /*?q= 挡搜索结果页（与首页高度重合，白吃配额）；必须带 ? ，否则路径里含 q= 的页面会被误伤
  // /*/search-index.json 只挡子路径：根目录那份是 Googlebot 渲染「加载更多」的取数通道
  // 下面这批 AI / SEO 爬虫九天数千次请求、referer 回流为 0，硬拦由 nginx 403 兜底
  // 2026-11-06：名单与 nginx conf.d/00-block-ai.conf 同步，补录 DataForSeo / SERanking / Qlyze /
  // Dot / Livelap / Reflection / BacklinksExtended / fresh-domain-watch / l9 两兄弟共 10 类；
  // ExaSearchBot 与 CAICTMedicalResearchBot 可能带来 AI 引荐，暂不拦也暂不声明。
  `User-agent: *\nAllow: /\nDisallow: /*?q=\nDisallow: /hit\nDisallow: /*/search-index.json\n\nUser-agent: ShapBot\nUser-agent: KeenableBot\nUser-agent: SkytabBot\nUser-agent: SemrushBot\nUser-agent: AhrefsBot\nUser-agent: MJ12bot\nUser-agent: SerpstatBot\nUser-agent: DataForSeoBot\nUser-agent: SERankingBacklinksBot\nUser-agent: QlyzeBot\nUser-agent: DotBot\nUser-agent: LivelapBot\nUser-agent: Reflectionbot\nUser-agent: BacklinksExtendedBot\nUser-agent: fresh-domain-watch\nUser-agent: l9explore\nUser-agent: l9tcpid\nDisallow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`
);
write(
  path.join(outDir, 'sitemap.xml'),
  // 失效资源（dead:true）不进 sitemap：避免把死链递给搜索引擎、拖累整站抓取预算
  sitemapXml(baseUrl, items.filter((i) => !i.dead), categories, [
    { path: '/about/', priority: '0.5' },
    { path: '/privacy/', priority: '0.3' },
    { path: '/contact/', priority: '0.4' },
    { path: '/rss/', priority: '0.4' },
    // /all/（含分页）、/hot/、/tags/ 与标签页不再进 sitemap：它们是通道页，
    // 蜘蛛靠站内链接（页脚 / 分类导航 / 首页）就能发现，sitemap 名额让给详情页。
    // 2026-11-07 收缩索引范围：新站配额紧张，列表页近重复度高，提交它们得不偿失
    // 第 5 个参数传 images：有它才输出 image: 扩展，海报才能进图片搜索
  ], images)
);
copyThemeAssets(themeDir, outDir);

// card.js 是 app.js 的二级请求，同样缓存 30 天，也得带版本号
patchAppCardVersion(outDir, assetVersion);
copyExtraStaticFiles({ staticDir, outDir, write });

/** SEO 自检：只提醒「页面能打开、肉眼看不出」的隐患；已有专门命令管的事（正文长度）不重复报 */
function printSeoWarnings({ missing, toPinyin, tags, tagSlug, tagCfg, items }) {
  const warns = [];
  if (missing) warns.push(`${missing} 条资源缺配图，详情页结构化数据与图片 sitemap 里都没有图`);
  if (!toPinyin) {
    const coded = tags.filter((t) => /[^\x00-\x7F]/.test(tagSlug(t.label)));
    if (coded.length) {
      warns.push(
        `${coded.length} 个标签的 URL 是编码的中文：${coded
          .map((t) => t.label)
          .join('、')}（npm i -D pinyin-pro 即可自动转成拼音）`
      );
    }
  }
  {
    const idsByCat = new Map();
    for (const it of items) {
      let set = idsByCat.get(it.category);
      if (!set) idsByCat.set(it.category, (set = new Set()));
      set.add(it.id);
    }
    const nearDup = [];
    for (const t of tags) {
      if (tagCfg.overlapAllow.includes(t.label)) continue;
      const ids = new Set(t.items.map((x) => x.id));
      if (ids.size < tagCfg.overlapMinSize) continue;
      let worst = null;
      for (const [cat, set] of idsByCat) {
        let shared = 0;
        for (const id of ids) if (set.has(id)) shared += 1;
        const jac = shared / (ids.size + set.size - shared);
        if (!worst || jac > worst.jac) worst = { cat, jac, shared, catSize: set.size };
      }
      if (worst && worst.jac >= tagCfg.overlapMax) {
        nearDup.push({ label: t.label, size: ids.size, ...worst });
      }
    }
    if (nearDup.length) {
      warns.push(`${nearDup.length} 个标签页与分类页内容高度重合（Jaccard ≥ ${tagCfg.overlapMax}），会被判近重复：`);
      for (const d of nearDup.sort((a, b) => b.jac - a.jac)) {
        warns.push(
          `「${d.label}」${d.size} 条 vs 「${d.cat}」${d.catSize} 条，重合 ${d.shared} 条（${(d.jac * 100).toFixed(0)}%）→ 确认没保留价值就加进 config/tags.yaml 的 tagExclude`
        );
      }
    }
  }
  if (warns.length) {
    console.log('\n  SEO 提醒：');
    for (const w of warns) console.log(`    ! ${w}`);
  }
}
printSeoWarnings({ missing, toPinyin, tags, tagSlug, tagCfg, items });

const reusedTotal = reused.kept + reused.copied;
if (reusedTotal) {
  console.log(
    `  · 未变化文件沿用原样（保留 mtime，蜘蛛可命中 304）：${reusedTotal} 个` +
      (reused.copied ? `（从 ${prevDirName}/ 沿用 ${reused.copied} 个）` : '') +
      `；重新生成 ${reused.written} 个`
  );
}
console.log(
  `\n完成：${total} 个资源 · ${categories.length} 个分类 · ${((Date.now() - t0) / 1000).toFixed(1)}s\n输出目录：${outDirName}/`
);
console.log(`本地预览：npm run serve  → http://localhost:4321  （站点：${site.title}）`);
