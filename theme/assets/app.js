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
      tags: it.tags,
      isNew: !!isNew,
      resId: m ? m[1] : '',
    });
  }

  /** 浏览量回填：按 data-res-id 把 /stats.json 的 pv/uv 填进占位元素。
      缓存一份，动态渲染的卡片也能立即填充 */
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
    // 必须写根绝对路径：相对写法在 /resource/<id>/ 下会解析成 404，
    // 蜘蛛跟着渲染结果去抓就是一批白费抓取预算的硬 404
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

  // 触屏端只隐藏二维码那一行（扫码分享在手机上没意义）；「复制资源信息」必须留着——
  // 复制粘贴是资源包文本最可靠的落地方式
  if (navigator.share && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var hints = document.querySelectorAll('.share__hint');
    for (var i = 0; i < hints.length; i++) hints[i].setAttribute('hidden', '');
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

  // 复制类按钮：网盘链接 / 提取码 / 资源包（含海报）
  document.addEventListener('click', function (e) {
    // 「复制海报」要在复制文本分支之前判定：它同时带 data-copy（复用资源包文本），
    // 落在下面会退化成只复制文本
    var posterBtn = e.target.closest('[data-copy-poster]');
    if (posterBtn) {
      copyPoster(posterBtn, posterBtn.getAttribute('data-copy-poster'), posterBtn.getAttribute('data-copy'));
      return;
    }

    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      copyPacket(copyBtn, copyBtn.getAttribute('data-copy'), copyBtn.getAttribute('data-poster'));
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

    // 移动端唤起系统分享面板；不支持 share 时退化为复制资源包文本（卡片长什么样由平台决定）。
    // 只有点到「分享」按钮才走这里，面板内的复制按钮走上面的 [data-copy] 分支
    var shareBtn = e.target.closest('[data-share]');
    if (shareBtn && e.target === shareBtn) {
      var url = shareBtn.getAttribute('data-url') || location.href;
      var packet = shareBtn.getAttribute('data-text') || url;
      if (navigator.share) {
        navigator.share({
          title: shareBtn.getAttribute('data-title') || document.title,
          text: packet,
          url: url,
        }).catch(function () {});  // 用户取消（AbortError）静默忽略
        return;
      }
      copyPacket(shareBtn, packet, shareBtn.getAttribute('data-poster'));
    }
  });

  /** 按钮临时反馈文字，1.5s 后复原 */
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  /** 资源包文本 → 带海报的富文本：海报在最前当视觉锚点，其后逐行排。
      img 必须用绝对地址（构建期已拼好 baseUrl）——相对路径粘到站外就解析不出图了 */
  function packetHtml(text, poster) {
    var lines = String(text || '').split('\n').map(function (l, i) {
      var t = esc(l);
      return i === 0 ? '<b>' + t + '</b>' : t;  // 首行是「片名（年份）· 分类」，加粗当标题
    });
    return '<img src="' + esc(poster) + '" alt=""><br>' + lines.join('<br>');
  }

  /** 海报 → PNG blob。剪贴板的图片口味只认 PNG，站点图是 webp，得转一手 */
  function toPng(blob) {
    if (blob.type === 'image/png') return Promise.resolve(blob);
    var c = document.createElement('canvas');
    if (!window.createImageBitmap || !c.getContext) return Promise.resolve(blob);
    return createImageBitmap(blob)
      .then(function (bmp) {
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        return new Promise(function (res, rej) {
          c.toBlob(function (b) { (b ? res(b) : rej(new Error('toBlob 失败'))); }, 'image/png');
        });
      });
  }

  /** 把海报当图片文件复制进剪贴板，给微博这类编辑器用：
      它们粘贴时会把 HTML 里的 <img> 剥掉（微信认，微博不认），只收剪贴板里的图片文件。
      write() 必须在点击里同步发起，异步部分塞进 ClipboardItem 的 Promise 值——
      Safari 不允许 await 完再调 write，Chrome 两种都吃 */
  function copyPoster(btn, url, text) {
    if (!url || !window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      flash(btn, '浏览器不支持');
      return;
    }
    var flavors = { 'image/png': fetch(url).then(function (r) { return r.blob(); }).then(toPng) };
    // 文本一起塞：编辑器若肯同时收，一次粘贴图 + 文都到位；只收图的也不会更差
    if (text) flavors['text/plain'] = Promise.resolve(new Blob([text], { type: 'text/plain' }));
    navigator.clipboard.write([new window.ClipboardItem(flavors)]).then(
      function () { flash(btn, '已复制海报'); },
      function () { flash(btn, '复制失败'); }
    );
  }

  function plainCopy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  /** 复制资源包：支持 ClipboardItem 时同时写 text/html（含海报）+ text/plain，
      粘到微信 / QQ / 飞书 / 邮件正文这类富文本目标会连图一起出来；
      只吃纯文本的目标拿到的仍是原来那几行，不丢信息。不支持就整个退回纯文本，行为不变。 */
  function copyPacket(btn, text, poster, msg) {
    var done = function () { flash(btn, msg || '已复制'); };
    if (poster && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try {
        var item = new window.ClipboardItem({
          // Promise 形式的值：Safari 只认 Promise，Chrome 两种都吃
          'text/plain': Promise.resolve(new Blob([text], { type: 'text/plain' })),
          'text/html': Promise.resolve(new Blob([packetHtml(text, poster)], { type: 'text/html' })),
        });
        navigator.clipboard.write([item]).then(done, function () { plainCopy(text, done); });
        return;
      } catch (e) { /* 落到下面纯文本 */ }
    }
    plainCopy(text, done);
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
        // 只展示当前站内还存在的资源：stats.json 的 res 含历史上访问过但已删除的 id，
        // 不过滤会出现「裸 id 标题 + 详情页 404」
        .filter(function (id) { return !!index[id]; })
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
