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
  writeFavicon,
  copyThemeAssets,
  POSTER_WIDTHS,
} from './lib/assets.js';
import {
  listPage,
  detailPage,
  aboutPage,
  allPage,
  rssPage,
  feedXml,
  notFoundPage,
  sitemapXml,
  lastmodOfList,
  catFeedHref,
  tagPage,
  tagsPage,
  tagHref,
} from './lib/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 资源数据：一个分类一个 YAML */
const dataDir = path.join(root, 'data');
/** 配置：site.yaml / tags.yaml，与资源数据分开存放 */
const configDir = path.join(root, 'config');
const staticDir = path.join(root, 'static');
const themeDir = path.join(root, 'theme');
/**
 * 输出目录。默认仓库根的 public/。
 * 服务器做原子发布时会传 BUILD_DIR=public.new：先把整站构建到临时目录，
 * 全部就绪后再整体换到 public，构建过程中的半成品不会被 nginx 读到。
 */
const outDirName = process.env.BUILD_DIR || 'public';
const outDir = path.join(root, outDirName);
/**
 * 上一版产物目录，用于「内容未变就沿用」的比对。
 * 服务器做原子发布时构建到 public.new，此时上一版就是正在服务的 public/。
 * 直接构建到 public/ 时不需要它——文件本身就躺在 outDir 里，比对同一路径即可。
 */
const prevDirName = outDirName === 'public' ? '' : process.env.PREV_DIR || 'public';
const prevDir = prevDirName ? path.join(root, prevDirName) : '';

/** 本次构建沿用了多少个未变化的文件（只在最后汇总打一行） */
const reused = { kept: 0, copied: 0, written: 0 };

/**
 * 写文件，但内容没变就不覆盖。
 *
 * 为什么要这样：Nginx 对静态文件用 mtime + 大小生成 ETag / Last-Modified。
 * 每小时全量重建会把 700 多个详情页的 mtime 全部刷新，蜘蛛带 If-Modified-Since
 * / If-None-Match 来也永远不命中，每次都是完整 200 下载——抓取预算就这么被重复
 * 下载吃掉了（日志里 Google 200×810、几乎没有 304，正是这个特征）。
 * 内容不变就保留原文件与原 mtime，蜘蛛的重复访问变成 304，预算才腾得出去抓新页。
 *
 * 只比对文本产物（HTML / XML / JSON / robots）：抓取预算花在页面上；
 * 图片走的是 sharp 生成 + 30 天缓存，重建一次成本不高，不值得为它加复杂度。
 */
function write(file, content) {
  const rel = path.relative(outDir, file);
  const candidates = [file];
  if (prevDir && !rel.startsWith('..')) candidates.push(path.join(prevDir, rel));

  for (const target of candidates) {
    let old;
    try {
      old = fs.readFileSync(target, 'utf8');
    } catch {
      continue; // 不存在就试下一个候选
    }
    if (old !== content) continue;

    // 内容一致：已经在 outDir 里的直接不动，在上一版里的拷过来并沿用原 mtime
    if (target !== file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(target, file);
      const st = fs.statSync(target);
      fs.utimesSync(file, st.atime, st.mtime);
      reused.copied++;
    } else {
      reused.kept++;
    }
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  reused.written++;
}

/**
 * 清理目录里的遗留文件：keep(name) 返回 true 的保留，其余删除。
 * 删除失败只计数不抛出——目录残留影响不了访问，不能让构建中断。
 */
function prune(dir, keep) {
  let removed = 0;
  let failed = 0;
  if (!fs.existsSync(dir)) return { removed, failed };
  for (const name of fs.readdirSync(dir)) {
    if (keep(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

/**
 * 图标版本号：取 static/favicon.svg 的内容哈希。
 * nginx 给图片设了 30 天缓存，换 logo 后浏览器不会主动回源；
 * 内容一变 URL 就变，新 logo 立刻生效，内容不变则版本稳定、不影响缓存命中。
 */
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
/**
 * 标签配置单独一份 config/tags.yaml。必须在第一次调用 tagSlug() 之前读取：
 * 它负责装标签别名表，晚一步别名就不生效，tagSlug() 会退回拼音兜底，
 * 已收录的那批 URL 会集体变掉。
 */
const tagCfg = loadTagConfig(configDir);
/**
 * 站点域名：环境变量 BASE_URL 优先（服务器由 /etc/site-autoupdate.conf 注入），
 * 其次取 config/site.yaml 的 baseUrl，两者都没配则回退到站点默认域名。
 */
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
/**
 * 「最新」角标：只认构建当天（北京时间）入库的资源，全站口径、不设上限。
 * 在这儿算一次，首页、分类页、搜索索引共用同一份，不会出现各判一套标得不一样。
 */
const today = todayShanghai();
const newestIds = newestIdsOf(items, today);
if (newestIds.size) {
  console.log(`  · 「最新」角标：${today}（北京时间）入库 ${newestIds.size} 条`);
} else {
  console.log(`  · ${today}（北京时间）没有新入库，本次构建的「最新」角标不会出现`);
}

/**
 * 拼音：构建期生成，两处用到——
 *   1. 站内搜索的「全拼 / 首字母」输入（产物里只存字符串，不带词典）
 *   2. 标签 slug 的兜底：tagSlugs 没配别名的标签自动转成拼音 URL，
 *      不用再手工补表，也不会出现 %E7%A7%91%E5%B9%BB 这种编码路径
 * 必须在 collectTags() 之前装好：标签 slug 一旦算出来就定了，晚一步就走不到兜底。
 * pinyin-pro 是可选依赖，装不上只是退回「中文原样」，与拆表之前的行为一致。
 */
let toPinyin = null;
try {
  const { pinyin } = await import('pinyin-pro');
  const toPyArray = (text) => pinyin(text, { toneType: 'none', type: 'array' });
  toPinyin = (text) => ({
    py: toPyArray(text).join(''),
    py1: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
  });
  // 标签 slug 兜底：配了别名的照旧走别名，只有没配的才落到这里
  setSlugFallback((tag) => slugify(toPyArray(tag).join('')));
} catch {
  console.log(
    '  ! 未安装 pinyin-pro：站内搜索不支持拼音，新增标签的 URL 也会是编码的中文（npm i -D pinyin-pro 可开启）'
  );
}

// 标签聚合页：清洗后只保留资源数达标的标签（阈值 config/tags.yaml 的 tagMin，默认 3）
// tagExclude 里点名的不建页——内容与某个分类页重合时用它，避免近重复页面
const tags = collectTags(items, { categories, min: tagCfg.min, exclude: tagCfg.exclude });
/** 标签 key → 聚合信息：详情页靠它判断某个标签有没有落地页，没有就不给链接 */
const tagIndex = new Map(tags.map((t) => [t.key, t]));

// 两个标签算出同一个 slug 会写进同一个 /tag/xxx/ 目录，后写的覆盖先写的——
// 先写那个页面等于凭空消失，构建不报错、产物目录看着也齐全，只能在这儿点名。
// 拼音兜底之后概率变大了（不同汉字可能同音），所以每次构建都查一遍
{
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

if (!total) {
  console.error('! data/ 目录下没有解析到任何资源，请检查 YAML');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// 只清理已删除资源 / 分类的旧目录，其余文件直接覆盖；清理失败不影响构建
const keepIds = new Set(items.map((i) => i.id));
const keepCats = new Set(categories.map(categorySlug));
// 目录名用未编码的真实字符串：URL 里的 %E5%89%A7%E6%83%85 会被 nginx / serve.js
// 解码回「剧情」再去匹配文件系统，写成编码形式反而找不到（resource/ 与 category/ 同理）
const keepTags = new Set(tags.map((t) => tagSlug(t.label)));
let staleFailed = 0;
for (const [sub, keep] of [
  ['resource', keepIds],
  ['category', keepCats],
  ['tag', keepTags],
]) {
  staleFailed += prune(path.join(outDir, sub), (name) => keep.has(name)).failed;
}
if (staleFailed) {
  console.log(`  ! ${staleFailed} 个旧目录未能清理（不影响访问）；可手动执行 rm -rf ${outDirName} 后重新构建`);
}

console.log(`处理配图（${total} 条）…`);
const { map: images, missing } = await prepareImages(items, { staticDir, rootDir: root, outDir });
if (missing) console.log(`  · ${missing} 条缺少配图，使用占位图`);

// 配图尺寸调整后（例如详情页不再单独出 180 宽），旧宽度的文件会一直躺在 public/img
// 里越积越多，这里按当前宽度集合清理掉遗留版本
{
  const keepW = new Set(POSTER_WIDTHS.map(String));
  const { removed: staleImg } = prune(path.join(outDir, 'img'), (name) => {
    const m = /^(.*)-(\d+)\.(?:webp|jpe?g|png|avif|gif|svg)$/i.exec(name);
    return !m || keepW.has(m[2]);
  });
  if (staleImg) console.log(`  · 已清理 ${staleImg} 个旧尺寸配图（当前生成宽度：${POSTER_WIDTHS.join('/')}）`);
}

if (await writeFavicon(staticDir, outDir)) console.log('  · 已生成 favicon.svg / favicon.ico / apple-touch-icon.png');

// 首页分享卡：仓库里预渲染好的图直接拷到根目录（不依赖构建机的中文字体）
const shareSrc = path.join(staticDir, 'share.jpg');
const shareImage = fs.existsSync(shareSrc) ? '/share.jpg' : '';
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

// 全站索引：列表页内联（首屏离线可用）+ search-index.json（搜索全站）
const indexAll = items.map((it) => {
  const img = images.get(it.id) || {};
  const py = toPinyin ? toPinyin(`${it.title}${it.tags.join('')}`) : null;
  return {
    id: it.id,
    title: it.title,
    category: it.category,
    tags: it.tags,
    desc: clipDesc(it.description, 40),
    href: `/resource/${encodeURIComponent(it.id)}/`,
    date: it.date,
    thumb: img.thumb || '/img/placeholder.svg',
    card: img.card || '/img/placeholder.svg',
    // 「最新」角标：构建期就定好，前端（加载更多 / 搜索结果）直接读这个字段。
    // 索引里没有 added（入库日），浏览器自己算不出来，只能由这里给结果
    isNew: newestIds.has(it.id),
    ...(py || {}),
  };
});

/**
 * 静态资源版本号：取 theme/assets 下样式与脚本的**内容哈希**，不用 commit。
 *
 * 为什么不能用 commit：每个页面的 CSS / JS 链接都带 ?v=<assetVersion>，
 * 用 commit 就等于每次提交都改一遍所有页面的内容——哪怕只是加了一条资源数据，
 * 700 多个详情页的字节也全变了，mtime 跟着全量刷新，
 * 「内容未变不覆盖」彻底失效，蜘蛛的 304 又全部落空。
 * 改成内容哈希后：只有真改了样式 / 脚本的提交才会破缓存，纯数据提交不动任何页面。
 */
const assetVersion = (() => {
  try {
    const hash = crypto.createHash('md5');
    const files = fs
      .readdirSync(path.join(themeDir, 'assets'))
      .filter((f) => /\.(css|js)$/i.test(f))
      .sort();
    for (const f of files) hash.update(fs.readFileSync(path.join(themeDir, 'assets', f)));
    const digest = hash.digest('hex').slice(0, 8);
    // 取不到就退回固定串：绝不能用时间戳，那样每次构建都变，等于把上面的问题又引回来
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
  assetVersion,
  iconVersion,
  shareImage,
  tags,
  tagIndex,
  newestIds,
};

// 列表页与分类 RSS 各自都要按分类取子集，分组一次省掉两遍 filter
const byCat = new Map(categories.map((c) => [c, []]));
for (const it of items) {
  if (!byCat.has(it.category)) byCat.set(it.category, []);
  byCat.get(it.category).push(it);
}

console.log('生成列表页…');
// 首页按分类分区输出（每类最新的几条），byCat 供它取各分类的子集
write(
  path.join(outDir, 'index.html'),
  listPage({ ...ctxBase, activeCat: '', pageSize: site.pageSize, byCat })
);
for (const cat of categories) {
  const file = path.join(outDir, 'category', categorySlug(cat), 'index.html');
  write(file, listPage({ ...ctxBase, items: byCat.get(cat), activeCat: cat, pageSize: site.pageSize }));
}

console.log('生成详情页…');
for (const item of items) {
  write(
    path.join(outDir, 'resource', item.id, 'index.html'),
    detailPage({ ...ctxBase, item, qrLinks: qrMap.get(item.id) || [] })
  );
}

console.log(`生成标签聚合页（${tags.length} 个）…`);
for (const t of tags) {
  write(path.join(outDir, 'tag', tagSlug(t.label), 'index.html'), tagPage({ ...ctxBase, tag: t }));
}

console.log('生成关于本站 / RSS 页面…');
// 全量索引页：蜘蛛不用执行 JS 就能走完全部详情页的通道（列表页首屏之外的内容靠 JS 补齐）
write(path.join(outDir, 'all', 'index.html'), allPage(ctxBase));
write(path.join(outDir, 'about', 'index.html'), aboutPage(ctxBase));
// 标签总览页：热门标签云只互链前 20 个，这一页给全部标签一个站内入口
write(path.join(outDir, 'tags', 'index.html'), tagsPage(ctxBase));
write(path.join(outDir, 'rss', 'index.html'), rssPage(ctxBase));

// RSS 源：全站一份 + 每个分类一份，条目里带上配图与转存链接
/** 给 feed 用的资源视图（补上绝对配图路径） */
const feedItems = items.map((it) => ({ ...it, poster: (images.get(it.id) || {}).detail || '' }));
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
    path.join(outDir, 'category', categorySlug(cat), 'feed.xml'),
    feedXml({
      site,
      items: list,
      baseUrl,
      categories: [cat],
      feedPath: catFeedHref(cat),
      title: `${site.title} · ${cat}`,
      description: `${site.title}的${cat}分类，共 ${list.length} 个资源`,
    })
  );
}

console.log('生成搜索索引与附加文件…');
write(path.join(outDir, 'search-index.json'), JSON.stringify(indexAll));
write(path.join(outDir, '404.html'), notFoundPage(ctxBase));
write(
  path.join(outDir, 'robots.txt'),
  // Disallow /*?q= ：搜索结果页 /?q=关键词 与首页/分类页内容高度重合，
  // 会被当成重复内容白白吃掉抓取配额，主流搜索引擎都建议用 robots 挡掉。
  // 必须写 ?q= 而不是 q=，否则任何路径里含 "q=" 的正常页面会被误伤
  //
  // /stats.json 与 /hit 是访问统计端点，对收录毫无价值，挡掉省下抓取预算。
  //
  // /*/search-index.json 只挡子路径，根目录那份必须留：
  // 蜘蛛日志里对它的请求曾出现一批 404，根因是 app.js 早期用相对路径取索引，
  // 在 /resource/<id>/、/category/<slug>/ 下解析成不存在的子路径（已改为根绝对路径修掉），
  // 蜘蛛仍按记忆反复重试这些残留 URL。这里挡掉子路径促其衰减，
  // 根目录的 /search-index.json 仍是 Googlebot 渲染「加载更多」的通道，不能一起废掉
  // （配合 deploy/nginx-site.conf.example 里对该模式的 410，不依赖引擎是否支持通配）。
  //
  // 三家「只抓不回流」的 AI 索引爬虫单独全站 Disallow：
  // ShapBot(Parallel.ai) / KeenableBot / SkytabBot 九天合计 5800+ 次请求，
  // 日志里 referer 回流 **0 次**（同期 Google 281、百度 37、Yandex 5），
  // 且 ShapBot 只读 2 次 robots、SkytabBot 完全不读并反复抓同一页（单页 15 次）。
  // 主流能带回引荐流量的 Perplexity / OpenAI / Google-Extended 不在屏蔽之列，照旧放行。
  // 礼貌层靠这里，硬拦由 nginx 的 403 兜底（见 deploy/00-block-ai.conf）。
  // SemrushBot 同批挡掉：SEO 数据采集爬虫（变体 SemrushBot-BA/-SA/-WA/-XRL/-xy…），
  // 九天 630 次请求、referer 回流 0 次；robots 里写 SemrushBot 一个名字即覆盖全部变体。
  // AhrefsBot / MJ12bot / SerpstatBot 同理（532 / 446 / 308 次，同样零回流）——
  // 这一组全是「抓了只充实对方数据库、不给任何流量」的工具型爬虫。
  // 真正会带引荐的 PerplexityBot / OAI-SearchBot / Claude-SearchBot / Google-Extended 不在此列。
  `User-agent: *\nAllow: /\nDisallow: /*?q=\nDisallow: /stats.json\nDisallow: /hit\nDisallow: /*/search-index.json\n\nUser-agent: ShapBot\nUser-agent: KeenableBot\nUser-agent: SkytabBot\nUser-agent: SemrushBot\nUser-agent: AhrefsBot\nUser-agent: MJ12bot\nUser-agent: SerpstatBot\nDisallow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`
);
write(
  path.join(outDir, 'sitemap.xml'),
  sitemapXml(baseUrl, items, categories, [
    { path: '/about/', priority: '0.5' },
    { path: '/rss/', priority: '0.4' },
    // 全量索引页：给蜘蛛一条不依赖 JS 就能走完全部详情页的通道
    { path: '/all/', priority: '0.4', lastmod: lastmodOfList(items) },
    // 标签总览页：单标签页的入口集中地，蜘蛛从这一页能走到全部标签页
    { path: '/tags/', priority: '0.5', lastmod: lastmodOfList(items) },
    // 标签聚合页：接「属性 + 网盘」这类长尾词。优先级压在分类页（0.8）之下，
    // 因为它与分类页内容有重叠，不该抢分类页的抓取预算
    ...tags.map((t) => ({
      path: tagHref(t.label),
      priority: '0.5',
      lastmod: lastmodOfList(t.items),
    })),
    // 第 5 个参数传 images：有它才输出 image: 扩展，海报才能进图片搜索
  ], images)
);
copyThemeAssets(themeDir, outDir);

// app.js 是 ES module，会再 import 同目录的 card.js（卡片模板）。
// nginx 对 .js 统一缓存 30 天，这个二级请求也得带版本号，否则改了模板用户浏览器还拿旧的。
{
  const appFile = path.join(outDir, 'assets', 'app.js');
  const src = fs.readFileSync(appFile, 'utf8');
  const patched = src.replace("'./card.js'", `'./card.js?v=${assetVersion}'`);
  if (patched === src) console.log('  ! app.js 里没找到 ./card.js 的 import，卡片模板改版后不会破缓存');
  fs.writeFileSync(appFile, patched);
}

// 拷贝 QQ 群二维码：关于本站页展示大图，页脚通过 QQ 群链接轻量入口跳转
const qqGroupSrc = path.join(staticDir, 'qq-group.png');
const qqGroupDest = path.join(outDir, 'qq-group.png');
if (fs.existsSync(qqGroupSrc)) {
  fs.copyFileSync(qqGroupSrc, qqGroupDest);
} else {
  console.log('  ! 未找到 static/qq-group.png，关于本站页将不显示 QQ 群二维码');
}

/**
 * SEO 自检：这些都是「页面照常能打开、肉眼永远看不出问题」的隐患，
 * 只能靠构建时算一遍提醒。不影响构建结果，只是打几行字。
 */
{
  const warns = [];
  // 这里原本还检查两项，都是「有专门命令管、却每次构建都跟着报」的重复提醒，2026-10-11 去掉：
  //   · 正文过短 → 专项检查是 npm run list:short（同一口径同一阈值，还能 --cat 细分）
  //   · 未填备案号 icp → 站点在境外节点、不打算备案，这条永远不会被处理
  // 构建只保留「肉眼完全看不见、又没有别的命令管」的问题。
  if (missing) warns.push(`${missing} 条资源缺配图，详情页结构化数据与图片 sitemap 里都没有图`);
  // 拼音兜底没生效时（没装 pinyin-pro），新增标签的 URL 会退化成
  // /tag/%E5%89%A7%E6%83%85/ 这种编码形式。页面照常能打开，肉眼发现不了
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
  // 标签页 vs 分类页 近重复：两页内容几乎一样时搜索引擎只会留一个，另一个白占
  // 抓取预算。这类问题以前只能靠肉眼发现（「纪录」对「纪录片」就是这么找出来的）。
  //
  // 判据是 Jaccard = 重合数 / 两页并集大小，而不是「标签里有多少属于该分类」：
  // 后者会误报一大片——冒险、科幻、恐怖本来就 100% 属于电影，可它们只占电影
  // 分类的一两成，两页内容差得远。Jaccard 量的是两页整体有多像。
  {
    const idsByCat = new Map();
    for (const it of items) {
      let set = idsByCat.get(it.category);
      if (!set) idsByCat.set(it.category, (set = new Set()));
      set.add(it.id);
    }
    const nearDup = [];
    for (const t of tags) {
      const ids = new Set(t.items.map((x) => x.id));
      // 小样本跳过：几条内容的页面 Jaccard 极不稳定，重不重复的危害也都有限
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
      warns.push(
        `${nearDup.length} 个标签页与分类页内容高度重合（Jaccard ≥ ${tagCfg.overlapMax}），会被判近重复：`
      );
      for (const d of nearDup.sort((a, b) => b.jac - a.jac)) {
        warns.push(
          `「${d.label}」${d.size} 条 vs 「${d.cat}」${d.catSize} 条，重合 ${d.shared} 条（${(
            d.jac * 100
          ).toFixed(0)}%）→ 确认没保留价值就加进 config/tags.yaml 的 tagExclude`
        );
      }
    }
  }
  if (warns.length) {
    console.log('\n  SEO 提醒：');
    for (const w of warns) console.log(`    ! ${w}`);
  }
}

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
