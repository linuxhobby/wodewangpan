/**
 * 全站导航的唯一来源：页脚导航链接、哪些页面出面包屑、可见层与结构化数据。
 *
 * 口径（2026-11-11）：FOOT_NAV 里的页面都是单一页面（一个页面就是一个终点），一律不出面包屑；
 *   分类页用分类导航条表达层级，只输出 BreadcrumbList 结构化数据；
 *   详情页输出可见「首页 / 分类」并在同一行挂公告 / 热榜链接组；
 *   标签页、热榜、404 等其余页面保持现状，不出面包屑。
 *
 * 要改口径只动这里：面包屑规则、层级、可见开关、结构化数据都在本文件，
 * 页面函数只传 pageType / crumbData，不要再各自手写 <nav class="crumb"> 或 BreadcrumbList。
 */
import { esc } from '../../theme/assets/card.js';

/** 页脚固定入口。type 同时是面包屑规则的页面类型；abs: true 的输出拼上站点域名 */
export const FOOT_NAV = [
  { href: '/', label: '网站首页', type: 'home', abs: true },
  { href: '/about/', label: '关于本站', type: 'about' },
  { href: '/all/', label: '全部资源', type: 'all' },
  { href: '/tags/', label: '标签索引', type: 'tags' },
  { href: '/sitemap.xml', label: '网站地图', type: 'sitemap', abs: true },
  { href: '/rss/', label: 'RSS订阅', type: 'rss' },
  { href: '/privacy/', label: '隐私政策', type: 'privacy' },
  { href: '/contact/', label: '联系我们', type: 'contact' },
];

/** 底部导航页都是单一页面；其余这几个页面按现状也不出，集中列在这里避免各自判断 */
const NO_CRUMB_TYPES = new Set([...FOOT_NAV.map((i) => i.type), 'tag', 'hot', '404']);

/** 页面类型由 URL 判定，集中在这一处；底部导航页直接取 FOOT_NAV 的 type。
 *  未识别的类型返回空串，保守不出面包屑（新增页面不会凭空冒出多余导航）。 */
export function pageTypeOf({ canonicalPath = '', footNavCurrent = '' } = {}) {
  if (/^\/resource\/[^/]+\/$/.test(canonicalPath)) return 'detail';
  if (/^\/category\/[^/]+\/$/.test(canonicalPath)) return 'category';
  const nav = FOOT_NAV.find((i) => i.href === (footNavCurrent || canonicalPath));
  if (nav) return nav.type;
  if (canonicalPath.startsWith('/tag/')) return 'tag';
  if (canonicalPath === '/hot/') return 'hot';
  if (canonicalPath === '/404.html') return '404';
  return '';
}

/** 页脚导航 HTML（唯一渲染入口，layout 调用） */
export function footNav(current = '', baseUrl = '') {
  return `<nav class="foot__nav" aria-label="站点导航">${FOOT_NAV.map(
    (i, n) =>
      `${n ? '<span class="foot__sep" aria-hidden="true">|</span>' : ''}<a href="${esc(
        i.abs && baseUrl ? `${baseUrl}${i.href}` : i.href
      )}"${i.href === current ? ' aria-current="page"' : ''}>${esc(i.label)}</a>`
  ).join('')}</nav>`;
}

/**
 * 页面类型 → 面包屑层级；返回 null 表示可见层与结构化数据都不出。
 * nodes: label 用于可见 HTML，name 用于 JSON-LD（首页可见写「首页」，结构化数据写站名），
 *        href 为空表示末级（当前页），不输出链接。
 * at: BreadcrumbList 在 @graph 里的插入位置，保持各页原有顺序。
 */
export function crumbTrail(pageType, data = {}) {
  if (!pageType || NO_CRUMB_TYPES.has(pageType)) return null;
  const home = { label: '首页', name: data.siteTitle || '首页', href: '/' };
  switch (pageType) {
    case 'detail':
      return {
        visible: true,
        aside: true,
        at: 1,
        nodes: [
          home,
          { label: data.category, name: data.category, href: data.categoryHref },
          { label: data.title, name: data.title },
        ],
      };
    case 'category':
      return {
        visible: false, // 分类导航条已经表达层级，不再渲染一行重复文字
        aside: false,
        at: 1,
        nodes: [home, { label: data.category, name: data.category, href: data.categoryHref }],
      };
    default:
      return null; // 未知类型保守不出
  }
}

/** 可见面包屑：末级由页面标题表达，只渲染前面的层级；aside 是详情页那组公告 / 热榜链接 */
export function crumbHtml(trail, aside = '') {
  if (!trail || !trail.visible) return '';
  const links = trail.nodes
    .slice(0, -1)
    .map((n) => `<a href="${esc(n.href || '/')}">${esc(n.label || n.name)}</a>`);
  return `<nav class="crumb">${links.join('<span>/</span>')}${aside}</nav>\n`;
}

/** BreadcrumbList 结构化数据，与 crumbHtml 取同一份 nodes */
export function breadcrumbJsonLd(trail, baseUrl = '') {
  if (!trail) return null;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.nodes.map((n, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: n.name || n.label,
      ...(n.href ? { item: `${baseUrl}${n.href}` } : {}),
    })),
  };
}

/** 把 BreadcrumbList 并入页面已有的 JSON-LD；位置由 trail.at 指定，保持原有顺序 */
export function withBreadcrumb(jsonLd, breadcrumb, at = -1) {
  if (!breadcrumb) return jsonLd;
  if (!jsonLd) return { '@context': 'https://schema.org', '@graph': [breadcrumb] };
  const graph = Array.isArray(jsonLd['@graph']) ? [...jsonLd['@graph']] : [jsonLd];
  const pos = at >= 0 && at <= graph.length ? at : graph.length;
  graph.splice(pos, 0, breadcrumb);
  return { ...jsonLd, '@graph': graph };
}
