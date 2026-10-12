// 宫格卡片的唯一一份模板：构建期刷进首屏 HTML，浏览器端渲染「加载更多」和搜索结果。
// 只做字符串拼接，不碰 DOM 与 Node API，两端才能共用（详见 docs/site-建站与开发.md）。

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// o.titleHtml：搜索结果用它塞 <mark> 高亮，不传则转义 title；o.eager 给首屏图抢 LCP
export function tileHtml({
  href,
  src,
  title,
  titleHtml = '',
  category,
  date = '',
  isNew = false,
  eager = false,
}) {
  const loading = eager ? 'eager" fetchpriority="high' : 'lazy';
  return `<li class="tile-item">
  <a class="tile" href="${esc(href)}">
    <span class="tile__poster">
      <img class="tile__img" src="${esc(src)}" width="240" height="360" alt="${esc(title)}" loading="${loading}" decoding="async">
      ${isNew ? '<span class="tile__new">最新</span>' : ''}
    </span>
    <span class="tile__title">${titleHtml || esc(title)}</span>
    <span class="tile__meta">${esc(category)}${date ? ` · ${esc(date)}` : ''}</span>
  </a>
</li>`;
}
