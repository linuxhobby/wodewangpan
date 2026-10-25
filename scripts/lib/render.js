import { categorySlug, tagSlug, tagKey } from './data.js';
// 卡片模板与浏览器端（theme/assets/app.js）共用同一份：改结构两边同步生效
import { esc, tileHtml } from '../../theme/assets/card.js';

// 「最新」角标的判定不在渲染层：build.js 用 newestIdsOf() 算好后通过 ctx.newestIds 传进来，
// 保证首页 / 分类页 / 搜索索引标的是同一批

/** 页脚访问统计（stats: local 时启用）：读 VPS 上由 nginx 日志生成的 /stats.json，另种一年期 vid cookie 区分访客 */
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
// cls 可换：图标不只页脚用（详情页反馈条也用），类名跟着所在区块走
const iconSvg = (key, cls = 'foot__icon') =>
  ICONS[key]
    ? `<svg class="${cls}" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">${ICONS[key]}</svg>`
    : '';

// 页面 H1 同一行右侧的邀请链接（首页与各分类页共用）。外部站，统一 nofollow + noopener
const PAGE_INVITES = [
  {
    href: 'https://www.workbuddy.cn/events/invite?inviteCode=4ktsif3n0ne',
    label: '领取腾讯 WorkBuddy 2000 积分',
    title: '腾讯 WorkBuddy 邀请注册，领 2000 积分',
  },
  {
    href: 'https://www.trae.cn/events/code-fission/UU44ET25EK2C?utm_source=copy_link&utm_medium=code_fission',
    label: '领取抖音 TRAE AI 5000 积分',
    title: '字节跳动 TRAE AI 邀请注册，领 5000 积分',
  },
];
/** 标题栏右侧整组链接：两个邀请在前，「热榜 TOP 30」在最后；首个链接吃掉左侧剩余空间，整组右对齐 */
const titleAsideLinks = () =>
  PAGE_INVITES.map(
    (i, n) =>
      `<a class="page__invite${n === 0 ? ' page__invite--lead' : ''}" href="${esc(
        i.href
      )}" title="${esc(i.title)}" target="_blank" rel="noopener noreferrer nofollow">${esc(i.label)}</a>`
  ).join('') + '<a class="page__hot" href="/hot/">热榜 TOP 30 →</a>';

// 全站每页底部的固定入口。abs: true 的输出时拼上站点域名
const FOOT_NAV = [
  { href: '/', label: '网站首页', abs: true },
  { href: '/about/', label: '关于本站' },
  { href: '/all/', label: '全部资源' },
  { href: '/tags/', label: '标签索引' },
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

/** 页面上只出图标，账号名写进 aria-label / title；groupName 是 site.yaml 的 qqGroup */
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
export function catHref(category) {
  return `/category/${encodeURIComponent(categorySlug(category))}/`;
}
/** 分类 RSS 地址：分类页路径后面直接接 feed.xml */
export function catFeedHref(category) {
  return `${catHref(category)}feed.xml`;
}
/** 标签聚合页链接：slug 由 tagSlug() 决定，与生成页面时用的是同一个函数 */
export function tagHref(tag) {
  return `/tag/${encodeURIComponent(tagSlug(tag))}/`;
}

function catNav(categories, counts, activeCat, total, hotOn = false) {
  const items = [
    `<a class="cat${activeCat ? '' : ' is-on'}" href="/">全部<span class="cat__n">${total}</span></a>`,
    ...categories.map(
      (c) =>
        `<a class="cat${c === activeCat ? ' is-on' : ''}" href="${catHref(c)}">${esc(c)}<span class="cat__n">${counts.get(c) || 0}</span></a>`
    ),
  ];
  return `<nav class="cats" aria-label="分类">${items.join('')}</nav>`;
}

/** 分类 → schema.org 类型。没列出的落到 CreativeWork：猜错类型比不标更糟 */
const SCHEMA_TYPE = {
  电影: 'Movie',
  电视剧: 'TVSeries',
  纪录片: 'TVSeries',
  动漫: 'Animation',
  游戏: 'VideoGame',
  软件: 'SoftwareApplication',
  电子书: 'Book',
  课程: 'Course',
};

/** 详情页 title 后缀：只有资源名的话接不住「片名 + 网盘下载」这类长尾词 */
const TITLE_SUFFIX = {
  电影: '电影网盘资源',
  电视剧: '电视剧网盘资源',
  纪录片: '纪录片网盘资源',
  动漫: '动漫网盘资源',
  游戏: '游戏网盘下载',
  软件: '软件网盘下载',
  电子书: '电子书网盘下载',
  课程: '课程网盘资源',
};

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

/** 各家 meta name 不统一（Bing 叫 msvalidate.01），手拼写错等于没验证且看不出问题，所以固定映射 */
const VERIFICATION_META = {
  google: 'google-site-verification',
  bing: 'msvalidate.01',
  baidu: 'baidu-site-verification',
  '360': '360-site-verification',
  sogou: 'sogou_site_verification',
  shenma: 'shenma-site-verification',
  bytedance: 'bytedance-verification-code',
  yandex: 'yandex-verification',
};

/** 未配置或值为空时返回空串，不往页面里塞空标签 */
function verificationMeta(site) {
  const conf = site.verification;
  if (!conf || typeof conf !== 'object') return '';
  const tags = Object.entries(conf)
    .map(([engine, token]) => {
      const content = String(token ?? '').trim();
      if (!content) return '';
      const key = String(engine).trim().toLowerCase();
      const name = VERIFICATION_META[key] || `${key}-site-verification`;
      return `<meta name="${esc(name)}" content="${esc(content)}">`;
    })
    .filter(Boolean);
  return tags.length ? `${tags.join('\n')}\n` : '';
}

function layout({
  site,
  title,
  description,
  activeCat,
  hotOn = false,
  categories,
  counts,
  total,
  body,
  head = '',
  // 默认宽容器，已经是全站唯一档位；要窄才显式传 false（见 docs/site-建站与开发.md）
  wide = true,
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
${verificationMeta(site)}<link rel="canonical" href="${esc(canonical)}">
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
<body${wide ? ' class="page--wide"' : ''}>
<header class="top">
  <div class="wrap top__inner">
    <a class="top__brand" href="/"><img class="top__logo" src="/favicon.svg${iv}" width="24" height="24" alt="">${esc(site.title)}</a>
    <form class="top__search" role="search" onsubmit="return false">
      <input id="q" type="search" placeholder="搜索资源…" autocomplete="off" aria-label="搜索资源">
    </form>
  </div>
</header>
${catNav(categories, counts, activeCat, total, hotOn)}
<main class="wrap">
${body}
</main>
<footer class="foot wrap">
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
    resId: encodeURIComponent(item.id),
  });
}

/** 首页每个分类展示的条数：PC 端宫格 5 列，取 5 正好排满一行 */
const HOME_PER_CAT = 5;

/** 顺序 fixed = site.yaml 的分类顺序（位置稳定）；recent = 按各分类最新入库倒序（新货自动上浮） */
function homeGroups(items, categories, byCat, perCat, order) {
  const pool = byCat || new Map();
  const groups = (categories || [])
    .map((cat) => {
      // byCat 由 build.js 传入；万一没传，就地按 items 分组，不至于渲染出一个空白首页
      const list = pool.get(cat) || (items || []).filter((it) => it.category === cat);
      return { cat, list, shown: list.slice(0, perCat) };
    })
    .filter((g) => g.shown.length);
  if (order !== 'recent') return groups;
  // items 已按入库时刻降序，每组的第 0 条就是该分类最新的一条
  const key = (g) => (g.list[0] && g.list[0].sortKey) || '';
  return groups.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

/** 首页卡片只有「分类数 × 每类几条」，不执行 JS 的爬虫到首页就只剩几个入口；这份清单补上这条路 */
function noscriptHome(groups) {
  const rest = groups
    .map((g) => ({ cat: g.cat, list: g.list.slice(g.shown.length) }))
    .filter((g) => g.list.length);
  if (!rest.length) return '';
  const n = rest.reduce((sum, g) => sum + g.list.length, 0);
  return `<noscript>
<h2 class="ns__h">更多资源索引（${n} 个）</h2>
${rest
  .map(
    (g) => `<h3 class="ns__cat">${esc(g.cat)}<span class="muted"> · ${g.list.length} 个</span></h3>
<ul class="ns">${g.list.map((it) => `<li><a href="${itemHref(it.id)}">${esc(it.title)}</a></li>`).join('')}</ul>`
  )
  .join('\n')}
</noscript>`;
}

/** 搜索的兜底数据（断网或还没取到 search-index.json 时也能搜）；只内联前两屏，其余异步补齐 */
function listDataScript({ indexAll, activeCat, pageSize }) {
  const indexData = (indexAll || []).filter((it) => !activeCat || it.category === activeCat);
  return `<script type="application/json" id="list-data" data-total="${indexData.length}" data-category="${esc(activeCat)}">${JSON.stringify(indexData.slice(0, pageSize * 2)).replace(/</g, '\\u003c')}</script>`;
}

/** 分区而不排一条大列表：否则电影这类大分类占满首屏，小分类永远沉底看不见 */
function homePage(ctx) {
  const { site, items, categories, total, pageSize, images, baseUrl, indexAll, shareImage, byCat } = ctx;
  // 首页 SEO 文案取自 site.yaml 的 homeTitle / homeDesc / homeH1，占位符 {total}、{categories}
  const homeTitle = site.homeTitle || site.title;
  const homeDesc = String(site.homeDesc || site.description)
    .replace(/\{total\}/g, total)
    .replace(/\{categories\}/g, (categories || []).join('、'));
  const homeH1 = site.homeH1 || '全部资源';

  const perCat =
    Number(site.homePerCategory) > 0 ? Math.floor(Number(site.homePerCategory)) : HOME_PER_CAT;
  const groups = homeGroups(items, categories, byCat, perCat, site.homeCatOrder);
  // 「最新」角标用构建端算好的那一批：今天入库的落在哪个分类就标在哪张卡上
  const newestIds = ctx.newestIds || new Set();
  const shown = groups.flatMap((g) => g.shown);
  const firstImg = (images.get(shown[0] && shown[0].id) || {}).card || '';

  const body = `<h1 class="page__title page__title--home">${esc(homeH1)}<span class="page__n">${total} 个资源</span>${titleAsideLinks()}</h1>
<div id="results" class="results" hidden></div>
<div id="home">
${groups
    .map(
      (g, gi) => `<section class="home-cat">
  <div class="home-cat__head">
    <h2 class="home-cat__title"><a href="${catHref(g.cat)}">${esc(g.cat)}</a></h2>
    <span class="home-cat__n">${g.list.length} 个</span>
    <a class="home-cat__more" href="${catHref(g.cat)}">查看全部 →</a>
  </div>
  <ul class="grid home-cat__grid">
${g.shown.map((it, i) => cardHtml(it, images, newestIds.has(it.id), gi === 0 && i < 5)).join('\n')}
  </ul>
</section>`
    )
    .join('\n')}
  <p class="home-all"><a class="btn btn--more" href="/all/">查看全部 ${total} 个资源 →</a></p>
</div>
${noscriptHome(groups)}
${listDataScript({ indexAll, activeCat: '', pageSize })}`;

  return {
    title: `${homeTitle}（${total} 项）`,
    description: homeDesc,
    body,
    canonicalPath: '/',
    ogImage: shareImage || firstImg,
    ogImageSize: shareImage ? { w: 1200, h: 630 } : null,
    // 结构化数据只列首页真渲染出来的卡片：分组后首页展示的就是这几十条，
    // 标成全量条数反而与页面上看到的内容不符
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        websiteJsonLd(baseUrl, site),
        collectionPageJsonLd({ baseUrl, path: '/', name: homeTitle, items: shown }),
      ],
    },
    keywords: (categories || []).join(','),
    rssHref: '/feed.xml',
  };
}

/** 分类页：单条按入库时间排下来的列表 + 「加载更多」（首页分区后不再走这里） */
function catPage(ctx) {
  const { site, items, activeCat, pageSize, images, baseUrl, indexAll } = ctx;
  const newestIds = ctx.newestIds || new Set();
  const firstImg = (images.get(items[0] && items[0].id) || {}).card || '';

  const restLinks = items.slice(pageSize);
  const noscriptIndex = restLinks.length
    ? `<noscript>
<h2 class="ns__h">${esc(activeCat)}资源索引（共 ${items.length} 个）</h2>
<ul class="ns">${restLinks
      .map((it) => `<li><a href="${itemHref(it.id)}">${esc(it.title)}</a></li>`)
      .join('')}</ul>
</noscript>`
    : '';
  const body = `<h1 class="page__title">${esc(activeCat)}<span class="page__n">${items.length} 个资源</span>${titleAsideLinks()}</h1>
<div id="results" class="results" hidden></div>
<ul id="list" class="grid">
${items.slice(0, pageSize).map((it, i) => cardHtml(it, images, newestIds.has(it.id), i < 5)).join('\n')}
</ul>
${
  items.length > pageSize
    ? `<button id="more" class="btn btn--more" type="button" data-page-size="${pageSize}">加载更多（剩余 ${items.length - pageSize}）</button>`
    : ''
}
${noscriptIndex}
${items.length === 0 ? '<p class="empty">该分类下暂无资源</p>' : ''}
${listDataScript({ indexAll, activeCat, pageSize })}`;

  return {
    title: activeCat,
    description: `${activeCat}资源合集，共 ${items.length} 个，夸克网盘链接，扫码即存`,
    body,
    canonicalPath: catHref(activeCat),
    ogImage: firstImg,
    ogImageSize: null,
    // 注意：不要再加 SearchAction（站点链接搜索框）——Google 已于 2024-11-21 下线该富媒体结果，
    // 而且它的 urlTemplate `/?q=` 已被 robots.txt 屏蔽，留着是互相矛盾的死标记。
    // WebSite 本身要保留：Google 的「网站名称」功能仍读它（要求 name + url）。
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        websiteJsonLd(baseUrl, site),
        collectionPageJsonLd({
          baseUrl,
          path: catHref(activeCat),
          name: `${activeCat} - ${site.title}`,
          items,
        }),
      ],
    },
    keywords: `${activeCat},${activeCat}资源`,
    rssHref: catFeedHref(activeCat),
  };
}

export function listPage(ctx) {
  return layout({ ...ctx, ...(ctx.activeCat ? catPage(ctx) : homePage(ctx)) });
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
 * 分享 / 复制的内容：一段多行「资源包」文本，而不是一个裸 URL。
 *
 * 顺序是刻意的——**网盘在前、页面在后**：
 * 1. 分享者的目的是让群里的人拿到资源，不是请人来看站；把页面链接顶在前面等于给朋友卡一道。
 * 2. 页面链接的真实价值是兜底：网盘链接会失效，页面不会（失效了会标记 / 补源），
 *    所以它放在最后一行当「更多同类」的长期入口，顺带承担引流。
 * 3. 卡片渲染由平台方决定（腾讯抓不抓、抓成什么样都不归我们管），
 *    把信息写进消息正文才是唯一 100% 可控的部分。
 */
/**
 * 分享文案里的一句话概要。简介已补到 300 字，整段放进去会淹没链接，只取第一句。
 * 两个必须处理的脏数据：
 * 1. 简介尾部常带「｜TMDB 7.1」这类标注（见 content-内容生产.md 的简介规范），先切掉；
 * 2. 硬截会切出半句话，所以按句读取第一句，只有第一句本身就超长才硬截加省略号。
 */
function summaryOf(item, max = 60) {
  const raw = String(item.description || '').trim();
  if (!raw) return '';
  const body = raw.split('｜')[0].trim();
  const first = body.match(/^[^。！？!?]+[。！？!?]?/);
  let s = ((first ? first[0] : body) || '').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    // 硬切会切出半截词（「…全球月活」），优先退到 max 内最后一个句读处再断；
    // 退得太狠（不足 6 成）就宁可硬切，否则一句话会被砍成半句。
    const last = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf('；'));
    s = last > max * 0.6 ? cut.slice(0, last) : cut.replace(/[，,、；;：:]$/, '');
    s += '…';
  }
  return s;
}

function shareTextOf(item, shareUrl) {
  const year = item.date ? String(item.date).slice(0, 4) : '';
  const head = `${item.title}${year ? `（${year}）` : ''} · ${item.category}`;
  const summary = summaryOf(item);
  const links = item.links.length
    ? item.links.map((l) => (l.code ? `${l.name}：${l.url} 提取码 ${l.code}` : `${l.name}：${l.url}`))
    : ['（暂无可用链接，页面会更新补源）'];
  return [head, summary, ...links, `更多同类 → ${shareUrl}`].filter(Boolean).join('\n');
}

/**
 * 详情页反馈条（A1「链接失效一键反馈」的落点）：紧跟在转存链接下面，
 * 这是全页意图最强的时刻——用户刚发现链接打不开，此刻正需要一个出口。
 *
 * 三条刻意的设计取舍：
 * 1. 不放二维码。海报旁那个 qrbox 是资源转存码，同屏再放一个群码会被扫错；
 *    qm.qq.com 落地页自己解决两端（手机拉起 QQ、PC 自带二维码），这里给纯链接就够。
 * 2. 不用 --brand 实底按钮。加群是兜底动作，不该抢「打开 / 复制链接」的视觉焦点。
 * 3. 纯 <a>，零 JS，noscript 可用，构建期静态输出。
 */
function feedbackBar({ site, item, baseUrl }) {
  if (site.detailFeedback === false) return '';
  const qq = qqLinkOf(site.contact);
  const email = emailOf(site.contact);
  if (!qq && !email) return '';

  const group = String(site.qqGroup || '').trim();
  const pageUrl = `${baseUrl}${itemHref(item.id)}`;
  // 邮件预填：带上 id 与页面地址，站长收到就能直接定位到是哪条资源
  const body = [
    `资源：${item.title}`,
    `ID：${item.id}`,
    `页面：${pageUrl}`,
    `问题：（链接打不开 / 文件损坏 / 内容有误 / 其他，请描述）`,
  ].join('\n');

  const hint = item.links.length ? '链接打不开或资源有误？' : '暂无可用链接？';
  const btns = [
    qq
      ? `<a class="btn" href="${esc(qq)}" target="_blank" rel="noopener noreferrer" aria-label="加入${
          group ? `${esc(group)}QQ群` : 'QQ群'
        }">${iconSvg('qq', 'feedback__icon')}加入QQ群</a>`
      : '',
    email
      ? `<a class="btn" href="mailto:${email}?subject=${encodeURIComponent(
          `[失效反馈] ${item.title}`
        )}&amp;body=${encodeURIComponent(body)}">邮件反馈</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `<aside class="feedback" aria-label="问题反馈">
  <p class="feedback__hint">${hint}</p>
  <div class="feedback__row">${btns}</div>
</aside>`;
}

// 详情页之间原本零互链，蜘蛛爬进来出不去；这段静态输出给它们一条向深处走的路（理由见 docs/growth-收录与流量.md）。
// 取 10 条 = 宫格一行 5 列排满两行，窄屏由 .grid--fit 藏掉末行零头
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
  const { site, item, images, qrLinks, baseUrl, items, tagIndex, shareQr } = ctx;
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
    // 浏览量：构建期只放占位，前端拉 /stats.json 后填入（拿不到数据时留「–」）
    ['浏览量', `<span id="stat-views" data-res-id="${esc(encodeURIComponent(item.id))}">–</span>`],
  ];
  const factsHtml = `<table class="facts">
  <tbody>
${facts.map(([k, v]) => `    <tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('\n')}
  </tbody>
</table>`;

  // 分享面板：只留「分享（系统面板）+ 复制资源信息」两个动作。
  // 原来那四个平台外链已删除——connect.qq.com 的 shareqq 组件早已失效（死链），
  // 微博 / X / Telegram 对国内网盘站使用率近零，却占了详情页的显眼位置。
  const shareUrl = `${baseUrl}${itemHref(item.id)}`;
  const shareText = shareTextOf(item, shareUrl);

  const related = relatedOf(item, items || []);

  // 面包屑同一行右侧：两个邀请 + 热榜入口，与首页/分类页共用同一组（靠右侧由 .page__invite--lead 的 margin-left:auto 顶过去）
  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><a href="${catHref(item.category)}">${esc(item.category)}</a>${titleAsideLinks()}</nav>
<article class="detail">
  <div class="detail__media">
    <img class="poster" src="${esc(img.detail)}" width="240" height="360" alt="${esc(item.title)}海报" decoding="async" fetchpriority="high">
    ${qrBlock}
  </div>
  <div class="detail__main">
    <h1 class="detail__title">${esc(item.title)}</h1>
    <div class="tags">
      <a class="tag tag--cat" href="${catHref(item.category)}">${esc(item.category)}</a>
      ${item.tags
        // 与分类同名的标签不重复展示：左边已经有分类胶囊了，再跟一个同名的就是纯重复
        // （/all/ 页的 row() 也是同样的过滤口径）
        .filter((t) => t && tagKey(t) !== tagKey(item.category))
        .map((t) => {
          // 只有建了聚合页的标签才给链接：链到一个只有 1 条资源的标签页
          // 既没内容，又把蜘蛛往垃圾页引
          const entry = tagIndex && tagIndex.get(tagKey(t));
          return entry
            ? `<a class="tag" href="${tagHref(entry.label)}">${esc(t)}</a>`
            : `<span class="tag">${esc(t)}</span>`;
        })
        .join('')}
      ${item.date ? `<span class="tag tag--plain">${esc(item.date)}</span>` : ''}
    </div>
    ${factsHtml}
    <p class="detail__desc">${esc(item.description) || '<span class="muted">暂无介绍</span>'}</p>
    <div class="links">
      ${item.links.length ? item.links.map(linkRow).join('\n') : '<p class="muted">暂无可用链接</p>'}
    </div>
    ${feedbackBar({ site, item, baseUrl })}
    <div class="detail__share">
      <button class="btn btn--mini" type="button" data-share
        data-url="${esc(shareUrl)}"
        data-title="${esc(item.title)}"
        data-text="${esc(shareText)}">分享</button>
      <div class="share__panel">
        <button class="btn btn--mini" type="button" data-copy="${esc(shareText)}">复制资源信息</button>
        <p class="share__hint">${shareQr ? `<img class="share__qr" src="${esc(shareQr)}" width="96" height="96" alt="本页分享二维码">` : ''}微信：扫一扫，把本页分享给好友</p>
      </div>
    </div>
  </div>
</article>${related.length ? relatedBlock(related, images) : ''}`;

  const canonicalPath = itemHref(item.id);
  const schemaType = SCHEMA_TYPE[item.category] || 'CreativeWork';
  // 简介截取一次：meta 用前 160 字，结构化数据用前 200 字
  const descLong = item.description.slice(0, 200) || item.title;
  // year 在上面资源信息块里已算好（没有 date 就是空串，不硬凑年份）
  const titleSuffix = TITLE_SUFFIX[item.category] || `${item.category}网盘资源`;
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
        keywords: (item.tags || []).join(' '),
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
    // 资源名 + 年份 + 需求词：既区别于同名作品，也接住「片名 网盘」的长尾搜索
    title: `${item.title}${year ? `（${year}）` : ''}${titleSuffix}`,
    description: `${item.title}${year ? `（${year}）` : ''} · ${titleSuffix} · ${descLong.slice(0, 110)}`,
    activeCat: item.category,
    body,
    canonicalPath,
    ogType: 'article',
    ogImage: img.detail,
    jsonLd,
    keywords: [item.title, titleSuffix, item.category, ...item.tags].slice(0, 10).join(','),
    rssHref: catFeedHref(item.category),
    footNavCurrent: canonicalPath,
  });
}

// 中间那张海报「消失」，对应本站最常见的 404 原因——资源被取消分享
const NF_ART = `<svg class="nf__art" viewBox="0 0 240 116" role="presentation" aria-hidden="true">
  <rect x="18" y="24" width="54" height="76" rx="8" fill="var(--fill-placeholder)"/>
  <rect x="93" y="24" width="54" height="76" rx="8" fill="none" stroke="var(--brand)" stroke-width="2" stroke-dasharray="6 6"/>
  <rect x="168" y="24" width="54" height="76" rx="8" fill="var(--fill-placeholder)"/>
  <circle cx="120" cy="62" r="19" fill="none" stroke="var(--brand)" stroke-width="3"/>
  <line x1="107" y1="49" x2="133" y2="75" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/** 404 页：除了 404 与操作按钮，再给「大家在找」标签入口和一行最新资源，让人不必退回搜索引擎 */
export function notFoundPage(ctx) {
  const { images, indexAll } = ctx;
  const picks = (indexAll || []).slice(0, 5);
  const grid = picks.length
    ? `<h2>最新入库</h2>
<ul class="grid">${picks.map((it) => cardHtml(it, images, !!it.isNew, true)).join('')}</ul>`
    : '';

  // 同一分类最多占 2 个位，否则热词清一色来自收录最多的那个分类（电影），覆盖不到小分类
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

/** 存在理由：列表页卡片是 JS 补齐的，不执行 JS 的蜘蛛到列表页就没有下一条路（见 docs/growth-收录与流量.md） */
export function allPage(ctx) {
  const { site, items, categories, total, baseUrl, tags } = ctx;

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
${tagCloudHtml(tags)}
</div>`;

  return layout({
    ...ctx,
    title: '全部资源索引',
    description: `${site.title}全部 ${total} 个资源的完整索引，按${(categories || []).join('、')}分类排列，一页直达所有资源详情页`,
    activeCat: '',
    body,
    canonicalPath: '/all/',
    footNavCurrent: '/all/',
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

/* ── 标签聚合页 /tag/xxx/ ─────── */

/** 「热门标签」区块里最多列多少个 */
const TAG_CLOUD_MAX = 20;

/** 只取前 20 个：没它标签页站内任何导航都到不了，只能等蜘蛛从 sitemap 挖（见 docs/growth-收录与流量.md） */
function tagCloudHtml(tags, currentKey = '') {
  const all = tags || [];
  const others = all.filter((t) => t.key !== currentKey).slice(0, TAG_CLOUD_MAX);
  if (!others.length) return '';
  // 云里只放前 20 个，剩下的标签站内就断了路，补一条去总览页的出口
  const more =
    all.length > TAG_CLOUD_MAX
      ? `<p class="tagcloud__more"><a href="/tags/">查看全部 ${all.length} 个标签 →</a></p>`
      : '';
  return `<h2>热门标签</h2>
<ul class="tagcloud">${others
    .map(
      (t) =>
        `<li><a class="tag" href="${tagHref(t.label)}">${esc(t.label)}<span class="tag__n">${t.count}</span></a></li>`
    )
    .join('')}</ul>
${more}`;
}

/** 详情页只有「片名 + 分类」两条路，而用户搜的是「题材/属性 + 网盘」的组合词（见 docs/growth-收录与流量.md） */
/** 热门资源排行榜：构建期只出骨架（排序按钮 + 列表容器 + 内联精简索引），
 *  实际数据由浏览器端 fetch /stats.json 后渲染（见 app.js 的 initHot）。
 *  索引内联为 id -> {title, href, category}，避免再请求 search-index.json。 */
export function hotPage(ctx) {
  const { site, items } = ctx;
  const hotIndex = {};
  for (const it of items) {
    hotIndex[it.id] = {
      title: it.title,
      href: `/resource/${encodeURIComponent(it.id)}/`,
      category: it.category,
    };
  }
  // 把 < 转义为 \u003c，防止资源标题里出现 </script> 破坏内联 JSON
  const indexJson = JSON.stringify(hotIndex).replace(/</g, '\\u003c');
  const body = `<h1 class="page__title page__title--doc">热门资源榜<span class="page__n">按真实访问统计排序</span></h1>
<div class="hot">
  <div class="hot__bar">
    <span class="hot__label">排序：</span>
    <button type="button" class="btn btn--mini is-on" data-hot-sort="pv">按浏览量</button>
    <button type="button" class="btn btn--mini" data-hot-sort="uv">按人数</button>
  </div>
  <ul id="hot-list" class="hot__list"><li class="hot__empty">加载中…</li></ul>
  <p class="hot__note">数据来自本站 nginx 访问日志的真实统计，每 10 分钟更新一次。浏览量 = 页面被打开次数；人数 = 去重后的独立访客数。</p>
  <script type="application/json" id="hot-index">${indexJson}</script>
</div>`;
  return layout({
    ...ctx,
    title: '热门资源',
    description: `${site.title}里被打开次数最多的网盘资源排行榜，可按浏览量或独立访客数排序。`,
    activeCat: '',
    body,
    canonicalPath: '/hot/',
    footNavCurrent: '/hot/',
    keywords: '热门资源,排行榜,网盘资源',
    wide: true,
  });
}

export function tagPage(ctx) {
  const { site, tag, images, baseUrl, tags } = ctx;
  const { key, label, count, items } = tag;
  const canonicalPath = tagHref(label);
  // 该标签下的分类分布：写进 description，让搜索结果里的摘要有实际信息
  const catCount = new Map();
  for (const it of items) catCount.set(it.category, (catCount.get(it.category) || 0) + 1);
  const topCats = [...catCount].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  // 定制文案（config/tags.yaml 的 tagMeta）：给与分类页重合的标签换一个视角
  const meta = (ctx.tagMeta || new Map()).get(label);
  const fill = (s) => String(s || '').replace(/\{count\}/g, count);
  const pageName = fill(meta?.title) || `${label}相关资源`;

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><a href="/all/">全部资源</a><span>/</span><span>${esc(label)}</span></nav>
<h1 class="page__title">${esc(fill(meta?.h1) || label)}<span class="page__n">${count} 个资源</span></h1>
<ul class="grid">
${items.map((it, i) => cardHtml(it, images, false, i < 5)).join('\n')}
</ul>
${tagCloudHtml(tags, key)}`;

  return layout({
    ...ctx,
    title: pageName,
    description:
      fill(meta?.desc) ||
      `带「${label}」标签的网盘资源共 ${count} 个${topCats.length ? `，以${topCats.join('、')}为主` : ''}，打开即用，扫码即存`,
    activeCat: '',
    body,
    canonicalPath,
    ogType: 'website',
    ogImage: (images.get(items[0]?.id) || {}).card || '',
    keywords: [label, `${label}资源`, ...topCats].join(','),
    // 卡片是全量渲染的，不依赖 JS，不需要 noscript 兜底
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        collectionPageJsonLd({
          baseUrl,
          path: canonicalPath,
          name: `${pageName} - ${site.title}`,
          items,
        }),
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: site.title, item: `${baseUrl}/` },
            { '@type': 'ListItem', position: 2, name: '全部资源', item: `${baseUrl}/all/` },
            { '@type': 'ListItem', position: 3, name: label },
          ],
        },
      ],
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

/** description 里放海报 + 简介 + 网盘链接，订阅器里直接能看到转存入口 */
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
        // 不少阅读器只显示 description 正文、不显示 <link>，正文里没有入口就点不回站内
        `<p><a href="${esc(url)}">阅读原文</a></p>`,
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

/** 标签云只互链前 20 个，后排标签站内任何导航都到不了；这一页给全部标签一个入口（见 docs/growth-收录与流量.md） */
export function tagsPage(ctx) {
  const { site, tags = [], baseUrl, total } = ctx;
  /** 标签下的分类分布（取前 3）：让「剧情」「Linux」这类标签一眼看出涵盖什么 */
  const catsOf = (t) => {
    const m = new Map();
    for (const it of t.items) m.set(it.category, (m.get(it.category) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3);
  };

  const cards = tags
    .map((t) => {
      const cats = catsOf(t)
        .map(([c, n]) => `${esc(c)} ${n}`)
        .join(' · ');
      return `<li><a class="tagcard" href="${tagHref(t.label)}">
    <span class="tagcard__name">${esc(t.label)}</span>
    <span class="tagcard__n">${t.count} 个资源</span>
${cats ? `    <span class="tagcard__cats">${cats}</span>\n` : ''}  </a></li>`;
    })
    .join('\n');

  const body = `<nav class="crumb"><a href="/">首页</a><span>/</span><a href="/all/">全部资源</a><span>/</span><span>标签索引</span></nav>
<h1 class="page__title page__title--doc">标签索引<span class="page__n">${tags.length} 个标签</span></h1>
<div class="card-page">
  <p>本站按题材、平台、工具类型给资源打标签，共 <strong>${tags.length}</strong> 个标签，覆盖 ${total} 个资源。
  标签比分类更细：想找「科幻」电影或者「Mac」软件，直接点下面的标签，比在分类里翻快得多。</p>
  <ul class="taglist">
${cards}
  </ul>
</div>`;

  return layout({
    ...ctx,
    title: '标签索引',
    description: `${site.title}标签索引：${tags.length} 个标签（${tags
      .slice(0, 6)
      .map((t) => t.label)
      .join('、')}等），按题材与平台浏览 ${total} 个网盘资源`,
    activeCat: '',
    body,
    canonicalPath: '/tags/',
    footNavCurrent: '/tags/',
    keywords: `标签索引,${tags.map((t) => t.label).join(',')}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          '@id': `${baseUrl}/tags/#page`,
          url: `${baseUrl}/tags/`,
          name: `标签索引 - ${site.title}`,
          isPartOf: { '@id': `${baseUrl}/#website` },
          // 这一页的主体是标签的集合，不是资源列表，所以 ItemList 里列的是标签本身
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: tags.length,
            itemListElement: tags.map((t, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: t.label,
              url: `${baseUrl}${tagHref(t.label)}`,
            })),
          },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: site.title, item: `${baseUrl}/` },
            { '@type': 'ListItem', position: 2, name: '全部资源', item: `${baseUrl}/all/` },
            { '@type': 'ListItem', position: 3, name: '标签索引' },
          ],
        },
      ],
    },
  });
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
  ${maintainer ? `<p class="muted">${esc(maintainer)}</p>` : ''}
</div>`;

  return layout({
    ...ctx,
    title: '关于本站',
    description: `关于${site.title}：收录 ${total} 个网盘资源，介绍站点定位、使用方式与版权声明`,
    activeCat: '',
    body,
    canonicalPath: '/about/',
    footNavCurrent: '/about/',
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

export function sitemapXml(baseUrl, resources, categories, extras = [], images = null) {
  // 首页 / 关于本站 / RSS 订阅 / 各分类页
  const line = (loc, lastmod, priority, extra = '') =>
    `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority>${extra}</url>`;
  /** 占位海报一张被几十个 URL 引用，写进图片索引只会稀释真海报，按文件名里的 placeholder 排除（见 docs/growth-收录与流量.md） */
  const imageExtra = (r) => {
    const detail = images ? (images.get(r.id) || {}).detail : '';
    if (!detail || detail.includes('placeholder')) return '';
    return `<image:image><image:loc>${esc(`${baseUrl}${detail}`)}</image:loc><image:title>${esc(r.title)}</image:title></image:image>`;
  };
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
    ...resources.map((r) => line(`${baseUrl}${itemHref(r.id)}`, lastmodOf(r), '0.6', imageExtra(r))),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${images ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''}>
${urls.join('\n')}
</urlset>
`;
}
