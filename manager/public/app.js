/* 管理工具前端：零依赖，所有写操作都经本机 API，提交推送另有二次确认。 */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

let toastTimer = 0;
function toast(message, bad = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast${bad ? ' toast--bad' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

let modalAction = null;
function showModal(title, text, action) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = text || '（无）';
  modalAction = typeof action === 'function' ? action : null;
  $('modal-ok').classList.toggle('hidden', !modalAction);
  $('modal').showModal();
}
$('modal-close').addEventListener('click', () => $('modal').close());
$('modal-cancel').addEventListener('click', () => $('modal').close());
$('modal-ok').addEventListener('click', async () => {
  if (!modalAction) return;
  const fn = modalAction;
  modalAction = null;
  $('modal').close();
  try { await fn(); } catch (e) { toast(e.message, true); }
});

/* ── 视图切换 ── */
$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('is-on', b === btn));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('is-on', p.dataset.panel === btn.dataset.view));
});
function goto(view) {
  document.querySelector(`#tabs button[data-view="${view}"]`)?.click();
}

/* ── 追热播编排 ── */
const STATUS_LABEL = { active: '更新中', settled: '已定格', dead: '死链', missing: '可能缺资源' };
let fState = { active: [], archived: [], source: '' };
let fTitles = {};
let fCandidateStatus = {};
let draggedId = '';

async function loadFollowing() {
  fState = await api('/api/state');
  const ids = [...fState.active, ...fState.archived].map((x) => x.id);
  fTitles = ids.length ? (await api(`/api/titles?ids=${encodeURIComponent(ids.join(','))}`)).titles : {};
  renderFollowing();
}
function labelOf(id) {
  const t = fTitles[id];
  return t ? `${t.title} · ${id}` : id;
}
function statusBadge(status) {
  return status ? `<span class="badge badge--${esc(status)}">${STATUS_LABEL[status] || esc(status)}</span>` : '';
}
function renderFollowing() {
  $('factive').innerHTML = fState.active.length
    ? fState.active.map((entry) => {
        const t = fTitles[entry.id] || {};
        return `<div class="row" draggable="true" data-id="${esc(entry.id)}">
          <span class="grip" title="拖拽排序">::::</span>
          <span class="row__main"><a href="${esc(t.href || '#')}" target="_blank" rel="noopener">${esc(t.title || entry.id)}</a>
            <small>${esc(entry.id)}${t.updated ? ` · ${esc(t.updated)}` : ''} ${statusBadge(fCandidateStatus[entry.id] || '')}</small></span>
          <input class="note" data-note="${esc(entry.id)}" value="${esc(entry.note || '')}" placeholder="备注">
          <button type="button" class="mini" data-act="archive" data-id="${esc(entry.id)}">归档</button>
          <button type="button" class="mini ghost" data-act="remove" data-id="${esc(entry.id)}">移除</button>
        </div>`;
      }).join('')
    : '<p class="empty">当前清单为空。左侧搜索电视剧后加入。</p>';

  $('farchived-n').textContent = String(fState.archived.length);
  $('farchived').innerHTML = fState.archived.length
    ? fState.archived.map((entry) => `<div class="row"><span class="row__main"><a href="${esc((fTitles[entry.id] || {}).href || '#')}" target="_blank" rel="noopener">${esc(labelOf(entry.id))}</a><small>${esc(entry.removedAt || '')}</small></span>
        <button type="button" class="mini" data-act="restore" data-id="${esc(entry.id)}">恢复</button>
        <button type="button" class="mini ghost" data-act="remove" data-id="${esc(entry.id)}">移除</button></div>`).join('')
    : '<p class="empty">暂无归档。</p>';
}

async function searchCandidates() {
  const q = $('fq').value.trim();
  try {
    const { items } = await api(`/api/candidates?q=${encodeURIComponent(q)}`);
    const active = new Set(fState.active.map((x) => x.id));
    const archived = new Set(fState.archived.map((x) => x.id));
    fCandidateStatus = Object.fromEntries(items.map((it) => [it.id, it.status]));
    $('fresults').innerHTML = items.length
      ? items.map((it) => {
          const flag = active.has(it.id) ? '已在清单' : archived.has(it.id) ? '已归档' : '';
          const thumb = it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : '<span class="thumbph"></span>';
          return `<div class="row" data-id="${esc(it.id)}" data-status="${esc(it.status)}">
            ${thumb}<span class="row__main"><strong>${esc(it.title)}</strong><small>${esc(it.id)} · ${esc(it.updated)} ${statusBadge(it.status)}</small></span>
            <button type="button" class="mini" data-act="add" data-id="${esc(it.id)}" ${flag ? 'disabled' : ''}>${flag || '加入'}</button></div>`;
        }).join('')
      : '<p class="empty">没有匹配的电视剧。</p>';
    renderFollowing();
  } catch (e) { toast(e.message, true); }
}
let fTimer = 0;
$('fq').addEventListener('input', () => { clearTimeout(fTimer); fTimer = setTimeout(searchCandidates, 250); });
$('frefresh').addEventListener('click', () => loadFollowing().catch((e) => toast(e.message, true)));

async function followingAction(act, id, extra = {}) {
  try { await api(`/api/${act}`, { method: 'POST', body: { id, ...extra } }); await loadFollowing(); await searchCandidates(); }
  catch (e) { toast(e.message, true); }
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'add') followingAction('add', id, { note: $('fnote').value });
  else if (['archive', 'remove', 'restore'].includes(act)) followingAction(act, id);
});
$('factive').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-note]');
  if (input) followingAction('note', input.dataset.note, { note: input.value });
});
$('factive').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  draggedId = row.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
});
$('factive').addEventListener('dragover', (e) => e.preventDefault());
$('factive').addEventListener('drop', async (e) => {
  e.preventDefault();
  const target = e.target.closest('.row');
  if (!target || !draggedId || draggedId === target.dataset.id) return;
  const ids = [...$('factive').children].map((r) => r.dataset.id);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(target.dataset.id);
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  draggedId = '';
  try { await api('/api/reorder', { method: 'POST', body: { ids } }); await loadFollowing(); }
  catch (err) { toast(err.message, true); }
});

/* ── 字段编辑 ── */
let rCurrent = '';
async function initResources() {
  const { categories, items } = await api('/api/resources');
  $('rcat').innerHTML = '<option value="">全部分类</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  renderResourceList(items);
}
function renderResourceList(items) {
  $('rlist').innerHTML = items.length
    ? items.map((it) => `<button type="button" class="row linkrow" data-id="${esc(it.id)}"><span class="row__main"><strong>${esc(it.title)}</strong><small>${esc(it.id)} · ${esc(it.category)} · ${esc(it.updated)}${it.dead ? ' · 死链' : ''}</small></span></button>`).join('')
    : '<p class="empty">没有匹配资源。</p>';
}
let rTimer = 0;
async function searchResources() {
  const { items } = await api(`/api/resources?cat=${encodeURIComponent($('rcat').value)}&q=${encodeURIComponent($('rq').value.trim())}`);
  renderResourceList(items);
}
$('rq').addEventListener('input', () => { clearTimeout(rTimer); rTimer = setTimeout(() => searchResources().catch((e) => toast(e.message, true)), 250); });
$('rcat').addEventListener('change', () => searchResources().catch((e) => toast(e.message, true)));
$('rlist').addEventListener('click', (e) => {
  const row = e.target.closest('[data-id]');
  if (row) openResource(row.dataset.id);
});

async function openResource(id) {
  try {
    const { resource: x } = await api(`/api/resource?id=${encodeURIComponent(id)}`);
    rCurrent = id;
    $('rempty').hidden = true;
    // 表单初始靠 class="hidden" 隐藏，只改 hidden 属性不够，必须移除 class
    $('rform').classList.remove('hidden');
    $('rlink').innerHTML = `<a href="${esc(x.href)}" target="_blank" rel="noopener">查看详情页</a> · ${esc(x.category)} · ${esc(x.file)}`;
    $('rtitleMain').value = x.titleMain;
    $('rtitleSub').value = x.titleSub;
    $('rquark').value = x.quark_url;
    $('rbaidu').value = x.baidu_url;
    $('rpwd').value = x.baidu_pwd;
    $('rguangya').value = x.guangya_url;
    $('rdesc').value = x.description;
    $('rdead').checked = false;
    $('rkeep').checked = true;
    $('rsuffix').textContent = x.sourceSuffix ? `（${x.sourceSuffix}）` : '（本条无来源尾缀）';
    $('rdead').disabled = !x.dead;
    $('rdiff').hidden = true;
  } catch (e) { toast(e.message, true); }
}
function resourceChanges() {
  return {
    titleMain: $('rtitleMain').value,
    titleSub: $('rtitleSub').value,
    description: $('rdesc').value,
    quark_url: $('rquark').value,
    baidu_url: $('rbaidu').value,
    baidu_pwd: $('rpwd').value,
    guangya_url: $('rguangya').value,
    keepSource: $('rkeep').checked,
  };
}
function resourceBody() {
  return { id: rCurrent, changes: resourceChanges(), deadVerified: $('rdead').checked };
}
$('rpreview').addEventListener('click', async () => {
  try { const r = await api('/api/resource/preview', { method: 'POST', body: resourceBody() }); $('rdiff').textContent = r.changed ? r.diff : '无实际变化，保存不会写盘、不会改 updated。'; $('rdiff').hidden = false; }
  catch (e) { toast(e.message, true); }
});
$('rsave').addEventListener('click', async () => {
  if (!rCurrent) return;
  try {
    const r = await api('/api/resource/update', { method: 'POST', body: resourceBody() });
    toast(r.changed ? `已保存，updated 更新为 ${r.updated}` : '无实际变化，未写盘');
    $('rdiff').hidden = true;
    await searchResources();
  } catch (e) { toast(e.message, true); }
});

/* ── 连载看板 ── */
async function loadDashboard() {
  try {
    const cats = $('dcat').value;
    const r = await api(`/api/serials/status?cats=${encodeURIComponent(cats)}`);
    const s = r.summary;
    $('dsummary').textContent = `${r.today} · 静止 ${r.idleDays} 天算已定格 · 活跃 ${s.active} / 已定格 ${s.settled} / 死链 ${s.dead} / 可能缺资源 ${s.missing}。看板只读，不触发补齐。`;
    const blocks = [
      ['active', '更新中'], ['settled', '已定格'], ['dead', '死链'], ['missing', '可能缺资源'],
    ].map(([key, label]) => {
      const rows = r.groups[key].map((it) => `<div class="board__row"><span class="row__main"><strong>${esc(it.title)}</strong><small>${esc(it.id)} · ${esc(it.category)} · ${esc(it.updated || '—')}${it.count ? ` · ${esc(it.count)}` : ''}${it.days !== undefined ? ` · ${it.days} 天` : ''}</small></span>
        <button type="button" class="mini" data-join="${esc(it.id)}">加入追热播</button><button type="button" class="mini ghost" data-edit="${esc(it.id)}">编辑字段</button></div>`).join('');
      return `<section class="board__col"><h3>${label}<span>${r.groups[key].length}</span></h3>${rows || '<p class="empty">（无）</p>'}</section>`;
    });
    $('dboard').innerHTML = blocks.join('');
  } catch (e) { toast(e.message, true); }
}
$('drefresh').addEventListener('click', loadDashboard);
$('dcat').addEventListener('change', loadDashboard);
$('dboard').addEventListener('click', (e) => {
  const join = e.target.closest('[data-join]');
  const edit = e.target.closest('[data-edit]');
  if (join) {
    goto('following');
    $('fq').value = join.dataset.join;
    searchCandidates();
    toast('已带入 ID，请核对后点「加入」');
  } else if (edit) {
    goto('resources');
    $('rq').value = edit.dataset.edit;
    searchResources().then(() => openResource(edit.dataset.edit)).catch((err) => toast(err.message, true));
  }
});

/* ── 资源删除（只包装现有脚本） ── */
let dCurrent = '';
let dDryOk = false;
async function searchDelete() {
  const { items } = await api(`/api/resources?q=${encodeURIComponent($('dq').value.trim())}`);
  $('dresults').innerHTML = items.length
    ? items.map((it) => `<button type="button" class="row linkrow" data-id="${esc(it.id)}"><span class="row__main"><strong>${esc(it.title)}</strong><small>${esc(it.id)} · ${esc(it.category)}</small></span></button>`).join('')
    : '<p class="empty">没有匹配资源。</p>';
}
let dTimer = 0;
$('dq').addEventListener('input', () => { clearTimeout(dTimer); dTimer = setTimeout(() => searchDelete().catch((e) => toast(e.message, true)), 250); });
$('dresults').addEventListener('click', (e) => {
  const row = e.target.closest('[data-id]');
  if (row) openDelete(row.dataset.id);
});
async function openDelete(id) {
  try {
    const x = await api(`/api/delete/impact?id=${encodeURIComponent(id)}`);
    dCurrent = id;
    dDryOk = false;
    $('dimpact').hidden = true;
    $('dform').classList.remove('hidden');
    $('ddetail').innerHTML = [
      ['ID', x.id], ['标题', x.title], ['分类', x.category], ['YAML 条目', x.file], ['配图', x.image],
      ['夸克链接', x.quark_url || '—'], ['百度链接', x.baidu_url || '—'], ['光鸭链接', x.guangya_url || '—'],
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('dconfirm').value = '';
    $('doutput').hidden = true;
  } catch (e) { toast(e.message, true); }
}
function deleteBody() {
  return { id: dCurrent, mode: document.querySelector('input[name="dmode"]:checked').value };
}
function showScriptOutput(r) {
  $('doutput').textContent = `退出码 ${r.code}\n${r.out || '（无输出）'}`;
  $('doutput').hidden = false;
}
$('ddry').addEventListener('click', async () => {
  try {
    const r = await api('/api/delete/dry', { method: 'POST', body: deleteBody() });
    showScriptOutput(r);
    dDryOk = r.code === 0;
    if (dDryOk) toast('试跑通过，请核对输出后再输入 ID 执行');
    else toast('试跑未通过，已停止，不会执行删除', true);
  } catch (e) { toast(e.message, true); }
});
$('dapply').addEventListener('click', async () => {
  if (!dDryOk) return toast('请先试跑并确认输出', true);
  if (!dCurrent || $('dconfirm').value.trim() !== dCurrent) return toast('输入的 ID 不一致，未执行删除', true);
  try {
    const r = await api('/api/delete/apply', { method: 'POST', body: { ...deleteBody(), confirmId: $('dconfirm').value.trim() } });
    showScriptOutput(r);
    if (r.code === 0) { toast('删除脚本执行完成'); dDryOk = false; await searchDelete(); }
    else toast('删除脚本停手，请看输出', true);
  } catch (e) { toast(e.message, true); }
});

/* ── 全局：构建、变更、发布 ── */
$('btn-build').addEventListener('click', async () => {
  toast('正在构建…');
  try {
    const build = await api('/api/build', { method: 'POST', body: {} });
    if (build.code !== 0) return showModal('构建失败', build.out);
    const preview = await api('/api/preview');
    showModal('构建完成', `${build.out}\n预览地址：${preview.url}${preview.opened ? `（已在${preview.launcher}打开）` : '（未自动打开，请手动访问）'}`);
  } catch (e) { toast(e.message, true); }
});
$('btn-diff').addEventListener('click', async () => {
  try {
    const d = await api('/api/diff');
    showModal('变更预览 · 推送目标 ' + (d.info.remote || '未配置'), d.text);
  } catch (e) { toast(e.message, true); }
});
$('btn-publish').addEventListener('click', async () => {
  try {
    const d = await api('/api/diff');
    if (!d.info.remote) return toast('没有 origin remote，不能发布', true);
    showModal('提交推送 · 二次确认', `${d.text}\n将提交并推送到 ${d.info.remote}（分支 ${d.info.branch || 'main'}）。未确认前仓库不变。`, async () => {
      const r = await api('/api/publish', { method: 'POST', body: { confirm: true } });
      showModal(r.ok ? '发布完成' : '发布未完成', r.out);
      if (r.ok) await loadFollowing();
    });
  } catch (e) { toast(e.message, true); }
});

loadFollowing().catch((e) => toast(e.message, true));
initResources().catch((e) => toast(e.message, true));
