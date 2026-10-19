// 卡片模板与构建端（scripts/lib/render.js）共用同一份：改结构两边同步生效
// （构建时会给 import 路径补上版本号，见 build.js）
import { esc, tileHtml } from './card.js';

(function () {
  'use strict';

  var dataEl = document.getElementById('list-data');
  var items = dataEl ? JSON.parse(dataEl.textContent) : [];
  // 列表总条数与分类：HTML 只内联了前两屏，其余从 search-index.json 补齐
  var TOTAL = parseInt(dataEl && dataEl.getAttribute('data-total'), 10) || items.length;
  var CAT = (dataEl && dataEl.getAttribute('data-category')) || '';
  var listEl = document.getElementById('list');
  // 首页按分类分区，整块容器是 #home（里面没有 #list，也没有「加载更多」）
  var homeEl = document.getElementById('home');
  var moreEl = document.getElementById('more');
  var input = document.getElementById('q');
  var resultsEl = document.getElementById('results');
  var PAGE = parseInt(moreEl && moreEl.getAttribute('data-page-size'), 10) || 36;
  var MAX_HITS = 120;
  var shown = PAGE;
  var globalIndex = null;
  var globalLoading = false;
  var timer = null;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 命中片段高亮：只在标题里标出用户真正输入的关键词 */
  function highlight(text, tokens) {
    var html = esc(text);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t) continue;
      html = html.replace(new RegExp(escapeRegExp(t), 'gi'), function (m) {
        return '<mark>' + m + '</mark>';
      });
    }
    return html;
  }

  /** 索引条目 → 卡片入参（索引里已带 href / card / thumb，不必再拼 URL） */
  function tileOf(it, titleHtml, isNew) {
    var m = it.href && it.href.match(/resource\/([^/]+)/);
    return tileHtml({
      href: it.href,
      src: it.card || it.thumb,
      title: it.title,
      titleHtml: titleHtml || '',
      category: it.category,
      date: it.date,
      isNew: !!isNew,
      resId: m ? m[1] : '',
    });
  }

  /**
   * 浏览量回填：拉 /stats.json（站点自带埋点生成，不依赖第三方），按 data-res-id 把
   * 对应资源的 pv/uv 填进占位元素。详情页（#stat-views）显示「次浏览 · 人」，
   * 卡片（.tile__views）显示低调的「· N人看过」；拿不到数据时元素保持空/占位。
   * statsRes 缓存一份，卡片后续由「加载更多 / 搜索」动态渲染后也能立即填充。
   */
  var statsRes = null;
  function applyViews() {
    if (!statsRes) return;
    var nodes = document.querySelectorAll('[data-res-id]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var v = statsRes[el.getAttribute('data-res-id')];
      if (!v) continue;
      if (el.id === 'stat-views') {
        el.textContent = (v.pv || 0) + ' 次浏览 · ' + (v.uv || 0) + ' 人';
      } else {
        el.textContent = ' · ' + (v.pv || 0) + ' 人看过';
      }
    }
  }
  function loadStats(cb) {
    if (statsRes) { if (cb) cb(); return; }
    fetch('/stats.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) { statsRes = (s && s.res) || {}; applyViews(); if (cb) cb(); })
      .catch(function () { if (cb) cb(); });
  }

  /** 把 items 补齐到全站/本分类全集（数据来自异步加载的 search-index.json） */
  function refill() {
    if (!globalIndex) return;
    items = CAT ? globalIndex.filter(function (it) { return it.category === CAT; }) : globalIndex;
  }

  /** 搜索时把「可浏览的列表」整块藏起来：分类页是 #list，分组首页是 #home */
  function setBrowseHidden(hidden) {
    if (homeEl) homeEl.hidden = hidden;
    if (listEl) listEl.hidden = hidden;
  }

  function paint() {
    // 分组首页没有 #list（也没有「加载更多」），只有搜索功能用得上
    if (!listEl) return;
    // isNew 由构建端按「当天入库」算好写进索引，浏览器算不出来（索引里没有 added 字段）
    listEl.innerHTML = items.slice(0, shown).map(function (it) { return tileOf(it, '', it.isNew); }).join('');
    if (moreEl) {
      moreEl.hidden = shown >= TOTAL;
      moreEl.textContent = '加载更多（剩余 ' + (TOTAL - shown) + '）';
    }
  }

  function renderMore() {
    shown = Math.min(shown + PAGE, Math.max(items.length, TOTAL));
    // 数据不够时先异步取全站索引，取到后再渲染
    if (shown > items.length && !globalIndex) {
      moreEl.textContent = '加载中…';
      loadGlobalIndex(function () { refill(); paint(); });
      return;
    }
    if (items.length < TOTAL) refill();
    paint();
    applyViews();
  }

  /**
   * 相关度打分：标题命中优先于标签、简介；完整词优先于拼音前缀
   */
  function score(it, tokens) {
    var title = (it.title || '').toLowerCase();
    var tags = (it.tags || []).join(' ').toLowerCase();
    var desc = (it.desc || '').toLowerCase();
    var py = (it.py || '').toLowerCase();
    var py1 = (it.py1 || '').toLowerCase();
    var total = 0;

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var s = 0;
      if (title === t) s = 100;
      else if (title.indexOf(t) === 0) s = 60;
      else if (title.indexOf(t) !== -1) s = 40;
      else if (tags.indexOf(t) !== -1) s = 22;
      else if (desc.indexOf(t) !== -1) s = 12;
      else if (py && py.indexOf(t) !== -1) s = py.indexOf(t) === 0 ? 30 : 18;
      else if (py1 && py1.indexOf(t) !== -1) s = py1.indexOf(t) === 0 ? 26 : 14;
      if (s === 0) return 0;      // 任一分词未命中即排除
      total += s;
    }
    return total;
  }

  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) return null;
    var tokens = q.split(/\s+/);
    var source = globalIndex || items;
    var hits = [];
    for (var i = 0; i < source.length; i++) {
      var sc = score(source[i], tokens);
      if (sc > 0) hits.push({ item: source[i], score: sc });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, MAX_HITS).map(function (h) { return h.item; });
  }

  function renderResults(query) {
    var q = query.trim();
    var hits = search(query);
    if (!hits) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      setBrowseHidden(false);
      if (moreEl) moreEl.hidden = shown >= TOTAL;
      return;
    }
    setBrowseHidden(true);
    if (moreEl) moreEl.hidden = true;
    resultsEl.hidden = false;
    var tokens = q.toLowerCase().split(/\s+/);
    resultsEl.innerHTML = hits.length
      ? '<div class="results__hint">找到 ' + hits.length + ' 个资源（按相关度排序）</div>' +
        '<ul class="grid">' + hits.map(function (it) { return tileOf(it, highlight(it.title, tokens), it.isNew); }).join('') + '</ul>'
      : '<p class="empty">没有匹配「' + esc(q) + '」的资源，试试更短的关键词或拼音首字母</p>';
    applyViews();
  }

  // 输入防抖：避免每敲一个字就重排上百个卡片
  function scheduleSearch(value) {
    clearTimeout(timer);
    timer = setTimeout(function () { renderResults(value); }, 120);
  }

  function loadGlobalIndex(cb) {
    if (globalIndex || globalLoading) return cb && cb();
    globalLoading = true;
    // 必须写根绝对路径：写成 'search-index.json' 会相对当前页面解析，
    // 在 /resource/<id>/、/category/<slug>/ 下变成 /resource/<id>/search-index.json → 404，
    // 蜘蛛跟着渲染结果去抓就是一批纯浪费抓取预算的硬 404
    fetch('/search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { globalIndex = data; globalLoading = false; cb && cb(); })
      .catch(function () { globalLoading = false; cb && cb(); });
  }

  if (moreEl) moreEl.addEventListener('click', renderMore);

  // 空闲时预取全站索引，让「加载更多」和搜索无需等待网络。
  // 只在列表页（有 #list-data）预取：详情页用不上，省掉几百个页面的无谓请求
  if (dataEl) {
    window.addEventListener('load', function () { setTimeout(loadGlobalIndex, 1000); });
  }

  // 拉取浏览量（/stats.json），覆盖首屏静态卡片 + 详情页占位
  loadStats();

  // 触屏移动端（支持 Web Share）隐藏社交按钮组，只用系统分享面板；
  // 桌面端（含支持 share 的 Chrome/Edge）始终展示按钮组，方便一键分享到各平台。
  if (navigator.share && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var sps = document.querySelectorAll('.share__panel');
    for (var i = 0; i < sps.length; i++) sps[i].setAttribute('hidden', '');
  }

  if (input) {
    input.addEventListener('input', function () {
      var v = input.value;
      scheduleSearch(v);
      syncUrl(v);
      if (v.trim() && !globalIndex) {
        loadGlobalIndex(function () { if (input.value.trim()) renderResults(input.value); });
      }
    });
    input.addEventListener('focus', function () { if (!globalIndex) loadGlobalIndex(); });

    // Esc 清空搜索，回到列表
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        input.value = '';
        renderResults('');
        syncUrl('');
        input.blur();
      }
    });

    // 支持从 /?q=关键词 直接进来（分享链接用；该形式已被 robots.txt 屏蔽，不给搜索引擎抓）
    var params = new URLSearchParams(location.search);
    var q0 = params.get('q');
    if (q0) {
      input.value = q0;
      renderResults(q0);
      loadGlobalIndex(function () { if (input.value.trim()) renderResults(input.value); });
    }
  }

  function syncUrl(value) {
    if (!history.replaceState) return;
    var url = value.trim() ? '?q=' + encodeURIComponent(value.trim()) : location.pathname;
    history.replaceState(null, '', url);
  }

  // 快捷键：Ctrl/⌘ + K 或 / 聚焦搜索框
  document.addEventListener('keydown', function (e) {
    if (!input) return;
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea';
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    }
  });

  // 复制链接 / 提取码
  document.addEventListener('click', function (e) {
    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      var text = copyBtn.getAttribute('data-copy');
      var done = function () {
        var old = copyBtn.textContent;
        copyBtn.textContent = '已复制';
        setTimeout(function () { copyBtn.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
      return;
    }

    var qrBtn = e.target.closest('.qrbtn');
    if (qrBtn) {
      var img = document.getElementById('qrImg');
      var cap = document.getElementById('qrCap');
      if (img) img.src = qrBtn.getAttribute('data-qr');
      if (cap) cap.textContent = qrBtn.getAttribute('data-cap');
      var btns = document.querySelectorAll('.qrbtn');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('is-on');
      qrBtn.classList.add('is-on');
    }

    // 原生 Web Share API：移动端直接唤起系统分享面板（含微信/QQ/微博等）；
    // 桌面端始终展示社交按钮组（见 init 的媒体查询判定），点「分享」即分享/复制本页链接。
    // 只有直接点到「分享」按钮才触发此逻辑；面板内的复制/社交链接各走各的分支或默认跳转。
    var shareBtn = e.target.closest('[data-share]');
    if (shareBtn && e.target === shareBtn) {
      var url = shareBtn.getAttribute('data-url') || location.href;
      if (navigator.share) {
        navigator.share({
          title: shareBtn.getAttribute('data-title') || document.title,
          text: shareBtn.getAttribute('data-text') || '',
          url: url,
        }).catch(function () {});  // 用户取消（AbortError）静默忽略
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { flash(shareBtn, '已复制链接'); },
          function () { fallbackCopy(url, function () { flash(shareBtn, '已复制链接'); }); }
        );
      } else {
        fallbackCopy(url, function () { flash(shareBtn, '已复制链接'); });
      }
    }
  });

  /** 按钮临时反馈文字，1.5s 后复原 */
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  // 热门榜页面（/hot/）：读取内联索引 + fetch /stats.json，按当前维度排序渲染，可切换 pv/uv
  function initHot() {
    var listEl = document.getElementById('hot-list');
    if (!listEl) return;
    var indexEl = document.getElementById('hot-index');
    var index = {};
    try { index = indexEl ? JSON.parse(indexEl.textContent) : {}; } catch (e) { index = {}; }
    var btns = document.querySelectorAll('[data-hot-sort]');
    var mode = 'pv';
    var statsRes = null;
    var HOT_N = 30;

    function render() {
      if (!statsRes) {
        listEl.innerHTML = '<li class="hot__empty">统计暂不可用，请稍后刷新。</li>';
        return;
      }
      var arr = Object.keys(statsRes)
        .map(function (id) {
          var m = index[id] || { title: id, href: '/resource/' + encodeURIComponent(id) + '/', category: '' };
          return { id: id, pv: statsRes[id].pv || 0, uv: statsRes[id].uv || 0, title: m.title, href: m.href, category: m.category };
        })
        .filter(function (x) { return x.pv > 0 || x.uv > 0; })
        .sort(function (a, b) { return mode === 'uv' ? b.uv - a.uv : b.pv - a.pv; })
        .slice(0, HOT_N);
      if (!arr.length) {
        listEl.innerHTML = '<li class="hot__empty">暂无足够统计数据。</li>';
        return;
      }
      listEl.innerHTML = arr
        .map(function (x, i) {
          var rank = i + 1;
          var rc = rank <= 3 ? ' hot__rank--top' + rank : '';
          return (
            '<li class="hot__item">' +
            '<span class="hot__rank' + rc + '">' + rank + '</span>' +
            '<span class="hot__main"><a class="hot__title" href="' + esc(x.href) + '">' + esc(x.title) + '</a>' +
            (x.category ? '<span class="hot__cat">' + esc(x.category) + '</span>' : '') + '</span>' +
            '<span class="hot__pv">' + x.pv + ' 次浏览</span>' +
            '<span class="hot__uv">' + x.uv + ' 人</span>' +
            '</li>'
          );
        })
        .join('');
    }

    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        mode = this.getAttribute('data-hot-sort') || 'pv';
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove('is-on');
        this.classList.add('is-on');
        render();
      });
    }

    listEl.innerHTML = '<li class="hot__empty">加载中…</li>';
    fetch('/stats.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { statsRes = (d && d.res) || {}; render(); })
      .catch(function () { render(); });
  }
  initHot();
})();
