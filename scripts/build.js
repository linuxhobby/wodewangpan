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

const reused = { kept: 0, copied: 0, written: 0 };

/**
 * 写文件，但内容没变就不覆盖：nginx 按 mtime + 大小生成 ETag / Last-Modified，
 * 全量重写会让蜘蛛每次都拿完整 200，304 永远落空抓取预算白烧（日志里 Google
 * 200×810、几乎没有 304 就是这症状）。只比对文本产物，图片有 sharp 缓存不必管。
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
      continue;
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

// 清理遗留文件：keep(name) 返回 true 的保留，其余删掉。失败只计数不抛出，目录残留不该中断构建
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
// 环境变量优先（服务器由 /etc/site-autoupdate.conf 注入），其次 site.yaml 的 baseUrl
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

// slug 撞车的两个标签会写进同一个目录互相覆盖，构建不报错、肉眼看不出，每次构建查一遍
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

// 只清理已删除资源 / 分类 / 标签的旧目录，其余文件靠 write() 覆盖
const keepIds = new Set(items.map((i) => i.id));
const keepCats = new Set(categories.map(categorySlug));
// 目录名用未编码的真实中文：%E5%89%A7%E6%83%85 会被 nginx 解码成「剧情」再匹配文件系统
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

// 配图改尺寸后，旧宽度的文件会一直堆在 public/img 里，按当前宽度集合清掉
{
  const keepW = new Set(POSTER_WIDTHS.map(String));
  const { removed: staleImg } = prune(path.join(outDir, 'img'), (name) => {
    const m = /^(.*)-(\d+)\.(?:webp|jpe?g|png|avif|gif|svg)$/i.exec(name);
    return !m || keepW.has(m[2]);
  });
  if (staleImg) console.log(`  · 已清理 ${staleImg} 个旧尺寸配图（当前生成宽度：${POSTER_WIDTHS.join('/')}）`);
}

if (await writeFavicon(staticDir, outDir)) console.log('  · 已生成 favicon.svg / favicon.ico / apple-touch-icon.png');

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
    // 前端直接读这个结果：索引里没有入库日，浏览器自己算不出来
    isNew: newestIds.has(it.id),
    ...(py || {}),
  };
});

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
  assetVersion,
  iconVersion,
  shareImage,
  tags,
  tagIndex,
  tagMeta: tagCfg.meta,
  newestIds,
};

// 列表页与分类 RSS 各自都要按分类取子集，分组一次省掉两遍 filter
const byCat = new Map(categories.map((c) => [c, []]));
for (const it of items) {
  if (!byCat.has(it.category)) byCat.set(it.category, []);
  byCat.get(it.category).push(it);
}

console.log('生成列表页…');
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
write(path.join(outDir, 'all', 'index.html'), allPage(ctxBase));
write(path.join(outDir, 'about', 'index.html'), aboutPage(ctxBase));
write(path.join(outDir, 'tags', 'index.html'), tagsPage(ctxBase));
write(path.join(outDir, 'rss', 'index.html'), rssPage(ctxBase));

/** 给 feed 用的资源视图：补上绝对配图路径 */
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
  // /*?q= 挡搜索结果页（与首页高度重合，白吃配额）；必须带 ? ，否则路径里含 q= 的页面会被误伤
  // /*/search-index.json 只挡子路径：根目录那份是 Googlebot 渲染「加载更多」的取数通道
  // 下面这批 AI / SEO 爬虫九天数千次请求、referer 回流为 0，硬拦由 nginx 403 兜底
  `User-agent: *\nAllow: /\nDisallow: /*?q=\nDisallow: /stats.json\nDisallow: /hit\nDisallow: /*/search-index.json\n\nUser-agent: ShapBot\nUser-agent: KeenableBot\nUser-agent: SkytabBot\nUser-agent: SemrushBot\nUser-agent: AhrefsBot\nUser-agent: MJ12bot\nUser-agent: SerpstatBot\nDisallow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`
);
write(
  path.join(outDir, 'sitemap.xml'),
  sitemapXml(baseUrl, items, categories, [
    { path: '/about/', priority: '0.5' },
    { path: '/rss/', priority: '0.4' },
    // /all/ 与 /tags/ 是蜘蛛不执行 JS 也能走完全部详情页 / 标签页的通道
    { path: '/all/', priority: '0.4', lastmod: lastmodOfList(items) },
    { path: '/tags/', priority: '0.5', lastmod: lastmodOfList(items) },
    // 标签页接长尾词，但与分类页有重叠，优先级压在分类页（0.8）之下不抢预算
    ...tags.map((t) => ({
      path: tagHref(t.label),
      priority: '0.5',
      lastmod: lastmodOfList(t.items),
    })),
    // 第 5 个参数传 images：有它才输出 image: 扩展，海报才能进图片搜索
  ], images)
);
copyThemeAssets(themeDir, outDir);

// card.js 是 app.js 的二级请求，同样缓存 30 天，也得带版本号
{
  const appFile = path.join(outDir, 'assets', 'app.js');
  const src = fs.readFileSync(appFile, 'utf8');
  const patched = src.replace("'./card.js'", `'./card.js?v=${assetVersion}'`);
  if (patched === src) console.log('  ! app.js 里没找到 ./card.js 的 import，卡片模板改版后不会破缓存');
  fs.writeFileSync(appFile, patched);
}

const qqGroupSrc = path.join(staticDir, 'qq-group.png');
const qqGroupDest = path.join(outDir, 'qq-group.png');
if (fs.existsSync(qqGroupSrc)) {
  fs.copyFileSync(qqGroupSrc, qqGroupDest);
} else {
  console.log('  ! 未找到 static/qq-group.png，关于本站页将不显示 QQ 群二维码');
}

/**
 * SEO 自检：只提醒「页面照常能打开、肉眼永远看不出」的隐患，不影响构建结果。
 * 已经有专门命令管的事（正文长度归 npm run list:short）不在这里重复报。
 */
{
  const warns = [];
  if (missing) warns.push(`${missing} 条资源缺配图，详情页结构化数据与图片 sitemap 里都没有图`);
  // 拼音兜底没生效时，新增标签的 URL 会退化成 /tag/%E5%89%A7%E6%83%85/ 这种编码形式，肉眼发现不了
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
  // 标签页 vs 分类页近重复：判据用 Jaccard（重合数 / 并集），而不是「标签里几成属于该分类」
  // ——后者会误报一大片：冒险 / 科幻本来就 100% 属于电影，可只占电影的一两成，内容差得远
  {
    const idsByCat = new Map();
    for (const it of items) {
      let set = idsByCat.get(it.category);
      if (!set) idsByCat.set(it.category, (set = new Set()));
      set.add(it.id);
    }
    const nearDup = [];
    for (const t of tags) {
      // tagOverlapAllow 里的是已决定保留的近重复，不是待办，不再提醒
      if (tagCfg.overlapAllow.includes(t.label)) continue;
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
