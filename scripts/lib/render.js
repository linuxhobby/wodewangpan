import { categorySlug } from './data.js';
// 卡片模板与浏览器端（theme/assets/app.js）共用同一份：改结构两边同步生效
import { esc, tileHtml } from '../../theme/assets/card.js';

/** 列表最前面多少条打「最新」角标 */
const NEWEST_BADGE = 6;

/** 页脚访问统计（site.yaml 里 stats: local 时启用）：读取 VPS 上由 nginx 日志生成的 /stats.json，不依赖任何第三方。
 *  同时种一年期 vid cookie 供服务端区分访客；接口不可用时数字保持占位符，不影响页面 */
const STATS_HTML =
  '<p class="foot__stat">总访问量 <span id="stat-pv">–</span> · 访客数 <span id="stat-uv">–</span>' +
  ' · 今日 <span id="stat-tpv">–</span> · 访客 <span id="stat-tuv">–</span></p>';
const STATS_SCRIPT = `<script>
(function () {
  var exp = new Date(Date.now() + 31536000000).toUTCString();
  if (!/(^|; )vid=/.test(document.cookie)) {
    document.cookie = 'vid=v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) +
      '; expires=' + exp + '; path=/; SameSite=Lax';
  }
  // 回发确认信标：服务端据此把「首访即走」的访客也计入 UV（信标本身不计访问量）
  try {
    if (navigator.sendBeacon) navigator.sendBeacon('/hit');
    else fetch('/hit', { method: 'POST', keepalive: true }).catch(function () {});
  } catch (e) {}
  fetch('/stats.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var m = { 'stat-pv': s.pv, 'stat-uv': s.uv, 'stat-tpv': s.today_pv, 'stat-tuv': s.today_uv };
      for (var id in m) {
        var el = document.getElementById(id);
        if (el && m[id] != null) el.textContent = m[id];
      }
    })
    .catch(function () {});
})();
</script>`;

/** 平台图标：24×24 视口，fill currentColor（页脚只出图标，不出账号文字）。 */
const ICONS = {
  // 邮箱：Lucide 图标库的 mail（ISC 协议），24×24 描边信封
  email:
    '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="4" width="20" height="16" rx="2"/>' +
    '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/>' +
    '</g>',
  // QQ：官方品牌图标（企鹅剪影），取自 Simple Icons（CC0 协议），24×24 视口实心路径
  qq:
    '<path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/>',
};
const iconSvg = (key) =>
  ICONS[key]
    ? `<svg class="foot__icon" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">${ICONS[key]}</svg>`
    : '';

/**
 * 页脚导航：全站每页底部的固定入口。
 * href 写站内路径（同时用于 aria-current 比对）；
 * abs: true 的条目输出时拼上站点域名，写成完整网址。
 */
const FOOT_NAV = [
  { href: '/', label: '网站首页', abs: true },
  { href: '/about/', label: '关于本站' },
  // 全量索引页：每页底部都有一条入口，蜘蛛从任何一页都能走到全部详情页
  { href: '/all/', label: '全部资源' },
  { href: '/sitemap.xml', label: '网站地图', abs: true },
  { href: '/rss/', label: 'RSS订阅' },
];
const footNav = (current = '', baseUrl = '') =>
  `<nav class="foot__nav" aria-label="站点导航">${FOOT_NAV.map(
    (i, n) =>
      `${n ? '<span class="foot__sep" aria-hidden="true">|</span>' : ''}<a href="${esc(
        i.abs && baseUrl ? `${baseUrl}${i.href}` : i.href
      )}"${i.href === current ? ' aria-current="page"' : ''}>${esc(i.label)}</a>`
  ).join('')}</nav>`;

/** contact 的 key 允许中英多写法（email / 邮箱、qq / qq群），统一转小写后比对 */
const EMAIL_KEY = /^(email|邮箱)$/;
const QQ_KEY = /^(qq|qq群|qq group)$/;
const HTTP_RE = /^https?:/;
const PATH_RE = /^\//;

/** 在 site.contact 里按 key 取第一个非空值；accept 可再加一道值校验（如必须是链接） */
function contactValue(contact, keyRe, accept = () => true) {
  if (!contact || typeof contact !== 'object') return '';
  for (const [k, v] of Object.entries(contact)) {
    const val = String(v ?? '').trim();
    if (val && keyRe.test(String(k).trim().toLowerCase()) && accept(val)) return val;
  }
  return '';
}
/** 备用邮箱（key 写 email 或 邮箱 都认），没有则返回空串 */
const emailOf = (contact) => contactValue(contact, EMAIL_KEY);
/** QQ 群加入链接（key 写 qq / qq群 / qq group，且必须是个网址），没有则返回空串 */
const qqLinkOf = (contact) => contactValue(contact, QQ_KEY, (v) => HTTP_RE.test(v));

/** 页脚联系方式：site.yaml 的 contact 写成 { 平台: 账号或链接 }，留空整段则不渲染。
 *  页面上只显示图标，账号名写进 aria-label / title，不直接露出。
 *  groupName = site.yaml 的 qqGroup（QQ 群名），有值时群名一并写进 title / aria-label。 */
const contactItems = (contact, groupName = '') => {
  const group = String(groupName || '').trim();
  return contact && typeof contact === 'object'
    ? Object.entries(contact)
        .filter(([, v]) => v && String(v).trim())
        .map(([rawKey, rawVal]) => {
          const key = String(rawKey).trim().toLowerCase();
          const val = String(rawVal).trim();
          if (EMAIL_KEY.test(key))
            return { label: '邮箱', icon: iconSvg('email'), href: `mailto:${val}`, text: val };
          if (QQ_KEY.test(key))
            return {
              label: group ? `QQ群「${group}」` : 'QQ群',
              icon: iconSvg('qq'),
              href: val,
              text: `加入${group || 'QQ群'}`,
            };
          return {
            label: rawKey,
            href: HTTP_RE.test(val) || PATH_RE.test(val) ? val : '',
            text: val,
          };
        })
    : [];
};
const contactHtml = (contact, groupName = '') => {
  const items = contactItems(contact, groupName);
  if (!items.length) return '';
  const links = items
    .map((i) => {
      const inner = i.icon || esc(i.label);
      const aria = ` aria-label="${esc(i.label)} ${esc(i.text)}"`;
      const title = ` title="${esc(i.label)}"`;
      if (!i.href) return `<span${title}>${inner}</span>`;
      const attrs = HTTP_RE.test(i.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(i.href)}"${attrs}${title}${aria}>${inner}</a>`;
    })
    .join('');
  return `<p class="foot__contact">${links}</p>`;
};

/** 详情页链接：id 一律 encodeURIComponent，中文 / 特殊字符 id 才不会破坏 URL */
export function itemHref(id) {
  return `/resource/${encodeURIComponent(id)}/`;
}
/** 分类页链接 */
export function catHref(category) {
  return `/category/${encodeURIComponent(categorySlug(category))}/`;
}
/** 分类 RSS 地址：分类页路径后面直接接 feed.xml */
export function catFeedHref(category) {
  return `${catHref(category)}feed.xml`;
}

function catNav(categories, counts, activeCat, total, wide) {
  const items = [
    `<a class="cat${activeCat ? '' : ' is-on'}" href="/">全部<span class="cat__n">${total}</span></a>`,
    ...categories.map(
      (c) =>
        `<a class="cat${c === activeCat ? ' is-on' : ''}" href="${catHref(c)}">${esc(c)}<span class="cat__n">${counts.get(c) || 0}</span></a>`
    ),
  ];
  return `<nav class="cats${wide ? ' cats--wide' : ''}" aria-label="分类">${items.join('')}</nav>`;
}

/** 分类 → schema.org 类型，帮助搜索引擎理解资源类型 */
const SCHEMA_TYPE = { 电影: 'Movie', 电视剧: 'TVSeries', 纪录片: 'TVSeries' };

/** 结构化数据里最多列多少条：全量链接由正文的 <a> 给蜘蛛，这里只给个概览 */
const JSONLD_ITEMS = 30;

/** ItemList 节点：列表页与全量索引页共用 */
function itemListJsonLd(items, baseUrl) {
  return {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.slice(0, JSONLD_ITEMS).map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${baseUrl}${itemHref(it.id)}`,
      name: it.title,
    })),
  };
}
/** WebSite 节点：Google「网站名称」功能读它（要求 name + url） */
function websiteJsonLd(baseUrl, site) {
  return {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    url: `${baseUrl}/`,
    name: site.title,
    description: site.description,
  };
}
/** CollectionPage 节点：列表页与全量索引页共用 */
function collectionPageJsonLd({ baseUrl, path, name, items }) {
  return {
    '@type': 'CollectionPage',
    '@id': `${baseUrl}${path}#page`,
    url: `${baseUrl}${path}`,
    name,
    isPartOf: { '@id': `${baseUrl}/#website` },
    mainEntity: itemListJsonLd(items, baseUrl),
  };
}

function jsonLdBlock(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function layout({
  site,
  title,
  description,
  activeCat,
  categories,
  counts,
  total,
  body,
  head = '',
  wide = false,
  baseUrl = '',
  canonicalPath = '/',
  ogImage = '',
  ogImageSize = null,
  ogType = 'website',
  jsonLd = null,
  keywords = '',
  noindex = false,
  assetVersion = '',
  footNavCurrent = '',
  rssHref = '/feed.xml',
  iconVersion = '',
}) {
  // 静态资源带版本号：nginx 对 css/js/图片设了 30 天缓存，改了必须换 URL 才会被重新拉取
  const v = assetVersion ? `?v=${assetVersion}` : '';
  // 图标按文件内容取版本：只换 logo 时也能立刻破掉浏览器缓存，不必等 css 版本号变化
  const iv = iconVersion ? `?v=${iconVersion}` : v;
  // 标题里已含站名（如首页 homeTitle）时不再重复拼接
  const fullTitle = title === site.title || title.includes(site.title) ? title : `${title} - ${site.title}`;
  const canonical = `${baseUrl}${canonicalPath}`;
  const ogImg = ogImage && ogImage.startsWith('/') ? `${baseUrl}${ogImage}` : ogImage;
  // 访问统计：页脚占位数字 + 取数脚本成对出现，判断一次就够
  const localStats = site.stats === 'local';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg${iv}" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico${iv}" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png${iv}">
${
  rssHref
    ? `<link rel="alternate" type="application/rss+xml" title="${esc(site.title)} RSS" href="/${rssHref.replace(/^\//, '')}">\n`
    : ''
}<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
${keywords ? `<meta name="keywords" content="${esc(keywords)}">\n` : ''}<meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow'}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#4B3FE3">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="zh_CN">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">\n` : ''}${ogImg && ogImageSize ? `<meta property="og:image:width" content="${ogImageSize.w}">\n<meta property="og:image:height" content="${ogImageSize.h}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description || site.description)}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">\n` : ''}<link rel="stylesheet" href="/assets/style.css${v}">
${head}
${jsonLd ? jsonLdBlock(jsonLd) : ''}
</head>
<body>
<header class="top">
  <div class="wrap${wide ? ' wrap--wide' : ''} top__inner">
    <a class="top__brand" href="/"><img class="top__logo" src="/favicon.svg${iv}" width="24" height="24" alt="">${esc(site.title)}</a>
    <form class="top__search" role="search" onsubmit="return false">
      <input id="q" type="search" placeholder="搜索资源…" autocomplete="off" aria-label="搜索资源">
    </form>
  </div>
</header>
${catNav(categories, counts, activeCat, total, wide)}
<main class="wrap${wide ? ' wrap--wide' : ''}">
${body}
</main>
<footer class="foot wrap${wide ? ' wrap--wide' : ''}">
  ${footNav(footNavCurrent, baseUrl)}
  ${localStats ? STATS_HTML : ''}
  <p>共 ${total} 个资源 · ${esc(site.disclaimer)}</p>
  ${site.icp ? `<p class="foot__icp">${esc(site.icp)}</p>` : ''}
  ${contactHtml(site.contact, site.qqGroup)}
</footer>
${localStats ? STATS_SCRIPT : ''}
<script type="module" src="/assets/app.js${v}"></script>
</body>
</html>
`;
}

/** 宫格卡片（海报墙）：最新资源排在最前，前 newest 条打「最新」角标 */
/** 构建期渲染卡片：把资源条目与配图映射摊平成模板需要的字段 */
function cardHtml(item, images, isNew = false, eager = false) {
  const img = images.get(item.id) || {};
  return tileHtml({
    href: itemHref(item.id),
    src: img.card || img.thumb,
    title: item.title,
    category: item.category,
    date: item.date,
    isNew,
    eager,
  });
}

export function listPage(ctx) {
  const { site, items, categories, activeCat, total, pageSize, images, baseUrl, indexAll, shareImage } = ctx;
  const first = items.slice(0, pageSize);
  // 首页 SEO 文案取自 site.yaml 的 homeTitle / homeDesc / homeH1，占位符 {total}、{categories}
  const catList = (categories || []).join('、');
  const homeTitle = site.homeTitle || site.title;
  const homeDesc = String(site.homeDesc || site.description)
    .replace(/\{total\}/g, total)
    .replace(/\{categories\}/g, catList);
  const homeH1 = site.homeH1 || '全部资源';
  const newestCount = Math.min(NEWEST_BADGE, items.length);
  const indexData = (indexAll || [])
    .filter((it) => !activeCat || it.category === activeCat)
    .map((it, i) => ({ ...it, isNew: i < newestCount }));

  const heading = activeCat
    ? `<h1 class="page__title">${esc(activeCat)}<span class="page__n">${items.length} 个资源</span></h1>`
    : `<h1 class="page__title">${esc(homeH1)}<span class="page__n">${total} 个资源</span></h1>`;

  const canonicalPath = activeCat ? catHref(activeCat) : '/';
  const firstImg = (images.get(items[0]?.id) || {}).card || '';

  // 结构化数据：站点 + 当前列表
  // 注意：不要再加 SearchAction（站点链接搜索框）——Google 已于 2024-11-21 下线该富媒体结果，
  // 而且它的 urlTemplate `/?q=` 已被 robots.txt 屏蔽，留着是互相矛盾的死标记。
  // WebSite 本身要保留：Google 的「网站名称」功能仍读它（要求 name + url）。
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      websiteJsonLd(baseUrl, site),
      collectionPageJsonLd({
        baseUrl,
        path: canonicalPath,
        name: activeCat ? `${activeCat} - ${site.title}` : homeTitle,
        items,
      }),
    ],
  };

  // 列表数据：只内联前两屏（够首屏 + 一次「加载更多」），剩余按需异步补齐，避免 HTML 过大导致抓取超时
  const body = `${heading}
<div id="results" class="results" hidden></div>
<ul id="list" class="grid">
${first.map((it, i) => cardHtml(it, images, i < newestCount, i < 5)).join('\n')}
</ul>
${
  items.length > pageSize
    ? `<button id="more" class="btn btn--more" type="button" data-page-size="${pageSize}">加载更多（剩余 ${items.length - pageSize}）</button>`
    : ''
}
${items.length === 0 ? '<p class="empty">该分类下暂无资源</p>' : ''}
<!-- data-newest：「最新」角标条数，由构建端注入，app.js 不再自己写死这个数 -->
<script type="application/json" id="list-data" data-total="${indexData.length}" data-category="${esc(activeCat)}" data-newest="${newestCount}">${JSON.stringify(indexData.slice(0, pageSize * 2)).replace(/</g, '\\u003c')}</script>`;

  return layout({
    ...ctx,
    title: activeCat || `${homeTitle}（${total} 项）`,
    description: activeCat
      ? `${activeCat}资源合集，共 ${items.length} 个，夸克网盘链接，扫码即存`
      : homeDesc,
    body,
    wide: true,
    canonicalPath,
    ogImage: activeCat ? firstImg : shareImage || firstImg,
    ogImageSize: activeCat || !shareImage ? null : { w: 1200, h: 630 },
    jsonLd,
    keywords: activeCat ? `${activeCat},${activeCat}资源` : categories.join(','),
    rssHref: activeCat ? catFeedHref(activeCat) : '/feed.xml',
  });
}

function linkRow(link) {
  const code = link.code
    ? `<span class="linkrow__code">提取码 <b>${esc(link.code)}</b><button class="btn btn--mini" type="button" data-copy="${esc(link.code)}">复制</button></span>`
    : '';
  return `<div class="linkrow">
  <span class="linkrow__name">${esc(link.name)}</span>
  <code class="linkrow__url">${esc(link.url)}</code>
  ${code}
  <a class="btn" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">打开</a>
  <button class="btn btn--primary" type="button" data-copy="${esc(link.url)}">复制链接</button>
</div>`;
}

/**
 * 详情页「相关推荐」：同分类优先，标签重合多的排前面；同分类凑不够时用跨分类同标签的补齐。
 *
 * 存在理由（SEO）：详情页之间原本零互链，蜘蛛爬进来就出不去，593 个详情页各自是孤岛。
 * 这段是构建期静态输出的，不依赖 JS，蜘蛛能顺着它继续往深处走。
 *
 * 取 10 条是因为宫格桌面端一行 5 列：10 条正好排满两行。窄屏减列后由 CSS
 * （style.css 的 .grid--fit）自动藏掉末行零头，保证任何宽度下都是整行整行地出现。
 */
function relatedOf(item, all, n = 10) {
  const tags = new Set(item.tags || []);
  const score = (it) => (it.tags || []).filter((t) => tags.has(t)).length;
  const newer = (a, b) =>
    String(b.added || '').localeCompare(String(a.added || '')) || String(b.id).localeCompare(String(a.id));
  const picked = all
    .filter((it) => it.id !== item.id && it.category === item.category)
    .sort((a, b) => score(b) - score(a) || newer(a, b))
    .slice(0, n);
  if (picked.length < n) {
    const seen = new Set([item.id, ...picked.map((it) => it.id)]);
    picked.push(
      ...all
        .filter((it) => !seen.has(it.id) && score(it) > 0)
        .sort((a, b) => score(b) - score(a) || newer(a, b))
        .slice(0, n - picked.length)
    );
  }
  return picked;
}

/** 相关推荐整段：够一行才交给 CSS 修掉末行零头，不足一行就不干预（本来就只有一行） */
function relatedBlock(related, images) {
  const fit = related.length >= 5 ? ' grid--fit' : '';
  return `<h2>相关推荐</h2>
<ul class="grid${fit}">${related.map((it) => cardHtml(it, images, false, false)).join('')}</ul>`;
}

export function detailPage(ctx) {
  const { site, item, images, qrLinks, baseUrl, items } = ctx;
  const img = images.get(item.id) || {};
  const primary = qrLinks[0];

  const qrSwitch =
    qrLinks.length > 1
      ? `<div class="qrbox__switch">${qrLinks
          .map(
            (l, i) =>
              `<button class="qrbtn${i === 0 ? ' is-on' : ''}" type="button" data-qr="${esc(l.qr)}" data-cap="扫码转存 · ${esc(l.name)}">${esc(l.name)}</button>`
          )
          .join('')}</div>`
      : '';

  const qrBlock = primary
    ? `<div class="qrbox">
  <img id="qrImg" class="qrbox__img" src="${esc(primary.qr)}" width="120" height="120" alt="${esc(primary.name)}二维码">
  <div class="qrbox__cap" id="qrCap">扫码转存 · ${esc(primary.name)}</div>
  ${qrSwitch}
</div>`
    : '';

  // 资源信息块：分类 / 年份 / 入库 / 标签 / 转存来源集中成一眼能扫完的一块，
  // 数据全部来自 YAML 已有字段，不必为它额外维护数据
  const year = item.date ? String(item.date).slice(0, 4) : '';
  const panNames = [...new Set(item.links.map((l) => l.name))].join(' / ');
  const source = item.links.length
    ? `${panNames}（${item.links.length} 个链接${item.links.some((l) => l.code) ? ' · 部分需提取码' : ''}）`
    : '暂无可用链接';
  const facts = [
    ['分类', `<a href="${catHref(item.category)}">${esc(item.category)}</a>`],
    ...(year ? [['上映 / 发行', esc(year)]] : []),
    ...(item.added ? [['入库日期', esc(item.added)]] : []),
    ['标签', item.tags.length ? item.tags.map((t) => esc(t)).join(' · ') : '—'],
    ['转存方式', esc(source)],
  ];
  const factsHtml = `<table class="facts">
  <tbody>
${facts.map(([k, v]) => `    <tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('\n')}
  </tbody>
</table>`;

  const related = relatedOf(item, items || []);

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><a href="${catHref(item.category)}">${esc(item.category)}</a></nav>
<article class="detail">
  <div class="detail__media">
    <img class="poster" src="${esc(img.detail)}" width="240" height="360" alt="${esc(item.title)}海报" decoding="async" fetchpriority="high">
    ${qrBlock}
  </div>
  <div class="detail__main">
    <h1 class="detail__title">${esc(item.title)}</h1>
    <div class="tags">
      <a class="tag tag--cat" href="${catHref(item.category)}">${esc(item.category)}</a>
      ${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
      ${item.date ? `<span class="tag tag--plain">${esc(item.date)}</span>` : ''}
    </div>
    ${factsHtml}
    <p class="detail__desc">${esc(item.description) || '<span class="muted">暂无介绍</span>'}</p>
    <div class="links">
      ${item.links.length ? item.links.map(linkRow).join('\n') : '<p class="muted">暂无可用链接</p>'}
    </div>
  </div>
</article>${related.length ? relatedBlock(related, images) : ''}`;

  const canonicalPath = itemHref(item.id);
  const schemaType = SCHEMA_TYPE[item.category] || 'CreativeWork';
  // 简介截取一次：meta 用前 160 字，结构化数据用前 200 字
  const descLong = item.description.slice(0, 200) || item.title;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': schemaType,
        '@id': `${baseUrl}${canonicalPath}#resource`,
        name: item.title,
        url: `${baseUrl}${canonicalPath}`,
        description: descLong,
        genre: item.tags.filter((t) => t !== item.category),
        ...(img.detail ? { image: `${baseUrl}${img.detail}` } : {}),
        ...(item.date ? { datePublished: item.date } : {}),
        inLanguage: 'zh-CN',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.title, item: `${baseUrl}/` },
          {
            '@type': 'ListItem',
            position: 2,
            name: item.category,
            item: `${baseUrl}${catHref(item.category)}`,
          },
          { '@type': 'ListItem', position: 3, name: item.title },
        ],
      },
    ],
  };

  return layout({
    ...ctx,
    title: item.title,
    description: `${item.category} · ${descLong.slice(0, 160)}`,
    activeCat: item.category,
    body,
    canonicalPath,
    ogType: 'article',
    ogImage: img.detail,
    jsonLd,
    keywords: [item.title, item.category, ...item.tags].slice(0, 8).join(','),
    rssHref: catFeedHref(item.category),
    // 详情页与首页/分类页同宽容器，海报卡片左右边线才能严格对齐
    wide: true,
    footNavCurrent: canonicalPath,
  });
}

/**
 * 404 插画：三张海报，中间那张「消失」（虚线框 + 禁用符号），
 * 与本站最常见的 404 原因——资源被取消分享——对应得上。
 */
const NF_ART = `<svg class="nf__art" viewBox="0 0 240 116" role="presentation" aria-hidden="true">
  <rect x="18" y="24" width="54" height="76" rx="8" fill="var(--fill-placeholder)"/>
  <rect x="93" y="24" width="54" height="76" rx="8" fill="none" stroke="var(--brand)" stroke-width="2" stroke-dasharray="6 6"/>
  <rect x="168" y="24" width="54" height="76" rx="8" fill="var(--fill-placeholder)"/>
  <circle cx="120" cy="62" r="19" fill="none" stroke="var(--brand)" stroke-width="3"/>
  <line x1="107" y1="49" x2="133" y2="75" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/**
 * 404 页面：沿用内容页骨架（面包屑 + 卡片）。
 * 除了大号 404 与操作按钮，再给出「大家在找」标签入口和一行最新资源，
 * 让人不必退回搜索引擎，从这一页就能继续走下去。
 */
export function notFoundPage(ctx) {
  const { images, indexAll } = ctx;
  const picks = (indexAll || []).slice(0, 5);
  const grid = picks.length
    ? `<h2>最新入库</h2>
<ul class="grid">${picks.map((it) => cardHtml(it, images, false, true)).join('')}</ul>`
    : '';

  // 全站出现频次最高的标签作为快捷搜索入口；同一分类最多占 2 个位置，
  // 否则热词会清一色来自收录最多的那个分类（电影），覆盖不到软件 / 电子书等
  // 跨分类的标签按首次出现的分类归属，限流粒度因此是「主要分类」而非严格去重
  const tagStat = new Map();
  for (const it of indexAll || []) {
    for (const t of it.tags || []) {
      const s = tagStat.get(t);
      if (s) s.n++;
      else tagStat.set(t, { n: 1, cat: it.category });
    }
  }
  const perCat = new Map();
  const tagsRow = [...tagStat]
    .sort((a, b) => b[1].n - a[1].n)
    .filter(([, s]) => {
      const used = perCat.get(s.cat) || 0;
      if (used >= 2) return false;
      perCat.set(s.cat, used + 1);
      return true;
    })
    .slice(0, 8)
    .map(([t]) => `<a class="cat" href="/?q=${encodeURIComponent(t)}">${esc(t)}</a>`)
    .join('');

  return layout({
    ...ctx,
    title: '页面不存在',
    activeCat: '',
    canonicalPath: '/404.html',
    // 与首页 / 分类页 / 内容页同宽容器，顶栏到页脚的左右边线一致
    wide: true,
    body: `<nav class="crumb"><a href="/">首页</a><span>/</span><span>页面不存在</span></nav>
<div class="card-page">
  <div class="nf">
    ${NF_ART}
    <h1 class="nf__code">404</h1>
    <p class="nf__title">这个资源没能打开</p>
    <p class="nf__desc">没有找到你想要的资源，看看下面的最新入库，或者用顶部搜索框按片名、拼音首字母搜。</p>
    <p class="nf__acts">
      <a class="btn btn--primary" href="/">返回首页</a>
      <a class="btn" href="/rss/">订阅更新</a>
    </p>
    ${tagsRow ? `<p class="nf__tags"><span class="nf__tagslabel">大家在找</span>${tagsRow}</p>` : ''}
  </div>
  ${grid}
</div>`,
    noindex: true,
  });
}

/* ── 全量索引页 /all/ ─────────── */

/**
 * 全量索引页：把所有详情页的链接平铺成纯 HTML，按分类分组。
 *
 * 存在的理由（SEO）：列表页 HTML 里只渲染前 pageSize 张卡片，其余靠 JS 拉
 * search-index.json 补齐——不执行 JS 的蜘蛛走到列表页就没有下一条路了
 * （实测 Googlebot 只覆盖了 122 个资源页，而 Yandex 靠 sitemap 走了 514 个）。
 * 这一页给蜘蛛一条「一次抓取即可走完全站」的通道，也不需要任何 JS。
 */
export function allPage(ctx) {
  const { site, items, categories, total, baseUrl } = ctx;

  // 分类顺序沿用导航栏；site.yaml 里没列出的分类排在后面，保证这一页真的是「全量」
  const order = [...(categories || [])];
  const byCat = new Map(order.map((c) => [c, []]));
  for (const it of items) {
    if (!byCat.has(it.category)) {
      order.push(it.category);
      byCat.set(it.category, []);
    }
    byCat.get(it.category).push(it);
  }
  const groups = order.map((c) => ({ cat: c, list: byCat.get(c) })).filter((g) => g.list.length);

  const row = (it) => {
    const tags = (it.tags || []).filter((t) => t && t !== it.category);
    return `<li><a href="${itemHref(it.id)}">${esc(it.title)}</a>${
      it.date ? `<span class="muted"> · ${esc(it.date)}</span>` : ''
    }${tags.length ? `<span class="muted"> · ${tags.map(esc).join(' · ')}</span>` : ''}</li>`;
  };

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><span>全部资源</span></nav>
<h1 class="page__title page__title--doc">全部资源索引<span class="page__n">${total} 个资源</span></h1>
<div class="card-page">
  <p>这一页列出本站全部 <strong>${total}</strong> 个资源，按分类排列，点标题直接进入详情页。</p>
${groups
  .map(
    (g) => `<h2>${esc(g.cat)}<span class="muted"> · ${g.list.length} 个</span></h2>
<ul>
${g.list.map(row).join('\n')}
</ul>`
  )
  .join('\n')}
</div>`;

  return layout({
    ...ctx,
    title: '全部资源索引',
    description: `${site.title}全部 ${total} 个资源的完整索引，按${(categories || []).join('、')}分类排列，一页直达所有资源详情页`,
    activeCat: '',
    body,
    canonicalPath: '/all/',
    footNavCurrent: '/all/',
    wide: true,
    keywords: `全部资源,资源索引,${(categories || []).join(',')},网盘资源`,
    // 与列表页共用 CollectionPage：结构化数据里只列前 30 条，全量链接靠正文的 <a> 给蜘蛛
    jsonLd: {
      '@context': 'https://schema.org',
      ...collectionPageJsonLd({
        baseUrl,
        path: '/all/',
        name: `全部资源索引 - ${site.title}`,
        items,
      }),
    },
  });
}

/* ── 独立页面：关于本站 / RSS 订阅 ─────────── */

/** RSS 2.0 的日期必须是 RFC 822（如 Sat, 08 Oct 2026 07:00:00 GMT） */
function rfc822(value) {
  const d = value instanceof Date ? value : new Date(String(value || '').trim().replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toUTCString();
}

/** RSS 里最多放多少条（够订阅器拉取，也不至于让文件过大） */
const RSS_MAX = 50;

/**
 * RSS 2.0 源：全站或单个分类的最新资源。
 * description 里放海报 + 简介 + 网盘链接，订阅器里直接能看到转存入口。
 */
export function feedXml({ site, items, baseUrl, categories, feedPath = '/feed.xml', title, description }) {
  const self = `${baseUrl}${feedPath}`;
  const homeLink = `${baseUrl}/`;
  const itemsXml = items
    .slice(0, RSS_MAX)
    .map((it) => {
      const url = `${baseUrl}${itemHref(it.id)}`;
      const poster = it.poster ? `${baseUrl}${it.poster}` : '';
      const links = (it.links || [])
        .map(
          (l) =>
            `<p>${esc(l.name)}${l.code ? `（提取码 ${esc(l.code)}）` : ''}：<a href="${esc(l.url)}">${esc(l.url)}</a></p>`
        )
        .join('');
      const desc = [
        poster ? `<p><img src="${esc(poster)}" width="240" alt="${esc(it.title)}"></p>` : '',
        it.description ? `<p>${esc(it.description)}</p>` : '',
        links,
      ]
        .filter(Boolean)
        .join('');
      return `  <item>
    <title>${esc(it.title)}</title>
    <link>${esc(url)}</link>
    <guid isPermaLink="true">${esc(url)}</guid>
    <pubDate>${rfc822(it.added || it.date)}</pubDate>
    <category>${esc(it.category)}</category>
    <description><![CDATA[${desc}]]></description>
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(title || site.title)}</title>
  <link>${esc(homeLink)}</link>
  <description>${esc(description || site.description)}</description>
  <language>zh-CN</language>
  <lastBuildDate>${rfc822(lastmodOfList(items))}</lastBuildDate>
  <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
${(categories || [])
  .map((c) => `  <category>${esc(c)}</category>`)
  .join('\n')}
${itemsXml}
</channel>
</rss>
`;
}

/** RSS 订阅地址一行：地址 + 复制按钮 + 直接打开 */
function feedRow(baseUrl, href, label, note = '') {
  const url = `${baseUrl}${href}`;
  return `<div class="feed-url">
  <span class="feed-url__label">${esc(label)}${note ? `<span class="muted"> · ${esc(note)}</span>` : ''}</span>
  <code class="feed-url__code">${esc(url)}</code>
  <a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">打开</a>
  <button class="btn btn--primary" type="button" data-copy="${esc(url)}">复制地址</button>
</div>`;
}

export function aboutPage(ctx) {
  const { site, categories, counts, total, items, baseUrl } = ctx;
  const updated = lastmodOfList(items);
  const newest = items.slice(0, 5);
  /** QQ 群名（site.yaml 的 qqGroup），留空则回退为通用「QQ群」 */
  const qqName = String(site.qqGroup || '').trim();
  /** QQ 群链接（site.yaml 的 contact.qq / contact.qq群） */
  const qqLink = qqLinkOf(site.contact);
  /** 备用邮箱（site.yaml 的 contact.邮箱），加不了群时的兜底通道 */
  const contactEmail = emailOf(site.contact);
  /** 维护者署名（site.yaml 的 maintainer），留空则不输出这一行 */
  const maintainer = String(site.maintainer || '').trim();
  const catRows = (categories || [])
    .map(
      (c) =>
        `<tr><th scope="row">${esc(c)}</th><td>${counts.get(c) || 0} 个</td><td><a href="${catHref(c)}">查看</a> · <a href="${catFeedHref(c)}">RSS</a></td></tr>`
    )
    .join('\n');

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><span>关于本站</span></nav>
<h1 class="page__title page__title--doc">关于本站</h1>
<div class="card-page">
  <p><strong>${esc(site.title)}</strong> 是一个纯静态的网盘资源索引站：把散落在各处的夸克 / 百度 / 阿里云盘资源整理成条目，
  统一给出海报、简介、标签和转存链接，打开网页即可直接使用，无需注册登录。</p>

  <h2>站点概况</h2>
  <ul>
    <li>已收录资源：<strong>${total}</strong> 个</li>
    <li>资源分类：<strong>${(categories || []).length}</strong> 类（${(categories || []).join('、')}）</li>
    <li>最近更新：${updated ? `<strong>${esc(updated)}</strong>` : '暂无记录'}</li>
    <li>整站纯静态：页面预先生成，加载快、无广告、不追踪个人信息</li>
  </ul>

  <h2>怎么用</h2>
  <ol>
    <li>首页或分类页浏览海报，也可以直接用顶部搜索框按片名、标签搜索（支持拼音首字母）。</li>
    <li>点进资源页，用手机<strong>扫码</strong>或点「复制链接」粘贴到浏览器，即可转存到自己的网盘。</li>
    <li>部分资源有提取码，页面上标明并附带一键复制按钮。</li>
  </ol>

  <h2>分类一览</h2>
  <table>
    <thead><tr><th scope="col">分类</th><th scope="col">数量</th><th scope="col">入口</th></tr></thead>
    <tbody>
${catRows}
    </tbody>
  </table>

  <h2>内容来源与版权</h2>
  <p>${esc(site.disclaimer)}。本站不存储任何影片、软件或电子书本体，所有文件均存放在第三方网盘上；
  若你是版权方或发现链接失效，欢迎通过下方方式联系，我们会在核实后第一时间处理。</p>

  <h2 id="qq-group">加入${qqName ? `「${esc(qqName)}」` : ''}QQ群</h2>
  <p>有问题、想交流资源，或者发现链接失效？欢迎扫码加入${qqName ? `QQ群<strong>${esc(qqName)}</strong>` : '本站QQ群'}交流反馈。</p>
  <div class="qq-qr">
    ${qqLink ? `<a href="${esc(qqLink)}" target="_blank" rel="noopener noreferrer">` : ''}
    <img src="/qq-group.png" alt="${qqName ? `${esc(qqName)} ` : ''}QQ群二维码" width="260" height="260" loading="lazy">
    ${qqLink ? '</a>' : ''}
    <p class="muted">扫码加入${qqName ? `QQ群「${esc(qqName)}」` : 'QQ群'}</p>
  </div>
  ${qqLink ? `<p>也可直接 <a href="${esc(qqLink)}" target="_blank" rel="noopener noreferrer">点击加入 QQ 群</a>。</p>` : ''}
  ${contactEmail ? `<p>不方便加群也可以发邮件到 <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>，我们同样会处理。</p>` : ''}

  <h2>订阅与推荐</h2>
  <p>新资源入库后可以 RSS 订阅，不必每天来刷页面：<a href="/rss/">查看 RSS 订阅方式与地址</a>。
  觉得有用也可以把首页加入浏览器书签，便于随时回来找资源。</p>

  <h2>最新入库</h2>
  <ul>
${newest
  .map(
    (it) =>
      `<li><a href="${itemHref(it.id)}">${esc(it.title)}</a><span class="muted"> · ${esc(it.category)}${it.added ? ` · ${esc(it.added)}` : ''}</span></li>`
  )
  .join('\n')}
  </ul>

  <p class="muted">${esc(site.title)} · <a href="${esc(baseUrl)}/">${esc(baseUrl)}</a></p>
  ${maintainer ? `<p class="muted">维护：${esc(maintainer)}</p>` : ''}
</div>`;

  return layout({
    ...ctx,
    title: '关于本站',
    description: `关于${site.title}：收录 ${total} 个网盘资源，介绍站点定位、使用方式与版权声明`,
    activeCat: '',
    body,
    canonicalPath: '/about/',
    footNavCurrent: '/about/',
    // 与首页 / 分类页 / 资源页同宽容器，卡片左右边线严格对齐
    wide: true,
    keywords: `关于${site.title},${site.title},网盘资源索引`,
  });
}

export function rssPage(ctx) {
  const { site, categories, counts, total, items, baseUrl } = ctx;
  const updated = lastmodOfList(items);
  const catFeeds = (categories || [])
    .map((c) =>
      feedRow(baseUrl, catFeedHref(c), `${c} RSS`, `${counts.get(c) || 0} 个资源`)
    )
    .join('\n');

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><span>RSS 订阅</span></nav>
<h1 class="page__title page__title--doc">RSS 订阅</h1>
<div class="card-page">
  <p>本站所有新资源都会实时写入 RSS 源，用任意 RSS 阅读器订阅后，更新会自动推送到你面前，不必再来站点手动刷首页。</p>

  <h2>全站订阅（推荐）</h2>
  ${feedRow(baseUrl, '/feed.xml', '全站最新资源', `当前共 ${total} 个资源，最近 ${updated || '暂无更新'}`)}

  <h2>按分类订阅</h2>
  <p>只关心某一类，可以单独订阅该分类的源：</p>
${catFeeds}

  <h2>怎么订阅</h2>
  <ol>
    <li>复制上面的订阅地址。</li>
    <li>打开你的 RSS 阅读器（如 Feedly、Inoreader、Reeder、NetNewsWire、RSSHub Radder、堪称 · Follow 等）。</li>
    <li>选择「添加订阅源 / Add Feed」，粘贴地址即可。</li>
    <li>也可以直接点右侧「打开」按钮，浏览器会自动识别为源地址。</li>
  </ol>

  <h2>说明</h2>
  <ul>
    <li>源内含最新 ${Math.min(RSS_MAX, items.length)} 条资源，条目里带海报、简介与转存链接。</li>
    <li>每条资源的 <code>pubDate</code> 取入库日期，阅读器可按时间排序。</li>
    <li>本站是纯静态站，源随每次构建更新，通常每天都会刷新。</li>
  </ul>

  <p>更多关于本站的介绍见 <a href="/about/">关于本站</a>。</p>
</div>`;

  return layout({
    ...ctx,
    title: 'RSS 订阅',
    description: `${site.title} 的 RSS 订阅地址与使用方法，订阅后新资源实时推送`,
    activeCat: '',
    body,
    canonicalPath: '/rss/',
    footNavCurrent: '/rss/',
    // 与首页 / 分类页 / 资源页同宽容器，卡片左右边线严格对齐
    wide: true,
    keywords: `${site.title},RSS订阅,RSS feed,网盘资源`,
  });
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 页面真实更新日期：优先入库日 added，回退内容日期 date；都没有则返回空（此时不写 lastmod） */
function lastmodOf(item) {
  if (DAY_RE.test(item.added || '')) return item.added;
  if (DAY_RE.test(item.date || '')) return item.date;
  return '';
}

/** 一组资源里最新的更新日期，用作首页 / 分类页的 lastmod */
export function lastmodOfList(list) {
  return list.map(lastmodOf).filter(Boolean).sort().pop() || '';
}

export function sitemapXml(baseUrl, resources, categories, extras = []) {
  // 首页 / 关于本站 / RSS 订阅 / 各分类页
  const line = (loc, lastmod, priority) =>
    `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority></url>`;
  // lastmod 必须是页面真实变化日期：每次构建把全站刷成同一天，搜索引擎会判定为不可信并降低抓取频率
  const siteLastmod = lastmodOfList(resources);
  const urls = [
    line(`${baseUrl}/`, siteLastmod, '1.0'),
    ...extras.map((e) => line(`${baseUrl}${e.path}`, e.lastmod || siteLastmod, e.priority || '0.5')),
    ...categories.map((c) =>
      line(
        `${baseUrl}${catHref(c)}`,
        lastmodOfList(resources.filter((r) => r.category === c)),
        '0.8'
      )
    ),
    ...resources.map((r) => line(`${baseUrl}${itemHref(r.id)}`, lastmodOf(r), '0.6')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
