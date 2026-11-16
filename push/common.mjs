#!/usr/bin/env node
// push/common.mjs —— 各社媒推送脚本共用的流水线。
//
// 分层约定（2026-11-12 重构定死）：
//   本文件只做「读站点数据 → 判重 → 选片」这些平台无关的事，
//   文案渲染与平台 API 收发全部留在 push/<platform>/<platform>-post.mjs 平台适配层里。
//   以后新增平台 = 新建一个目录一个脚本 + 复用本文件，不再复制第三份流水线。
//
// ⚠️ 沙箱坑（别删）：existsSync 对真实存在的文件会误报 false（statSync/readFileSync 正常），
//    所有「文件在不在」的判定统一走 firstPresent / statSync。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = os.homedir();
export const firstPresent = (...c) => { for (const p of c) { try { fs.statSync(p); return p; } catch {} } return c[0]; };

// 分类轮转/加权的展示顺序；数据里出现 CAT_ORDER 之外的新分类会自动排到后面，不用改这里。
export const CAT_ORDER = ['电影', '电视剧', '纪录片', '动漫', '游戏', '软件', '课程', '电子书', '其他'];
export const DEFAULT_REPO = 'C:/Users/marco/Github/wodewangpan';
export const DEFAULT_SITE_URL = 'https://www.wodewangpan.top';

// ---------- CLI ----------
export const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
export const has = (k) => process.argv.includes(`--${k}`);
export const collectPicks = () => process.argv.reduce(
  (a, v, i) => (v === '--pick' && process.argv[i + 1] ? a.concat(process.argv[i + 1]) : a), []
);

// ---------- 凭据 ----------
// 查找顺序：调用脚本同目录的 <envName> → ~/.workbuddy（唯一权威，2026-11-14 迁移完成）。
export function findEnvFile(callerUrl, envName) {
  return firstPresent(
    path.join(path.dirname(fileURLToPath(callerUrl)), envName),
    path.join(HOME, '.workbuddy', envName),
  );
}

// env 缺失不阻断 --dry：返回空对象，真要发送时由平台层检查 token。
export function parseEnvFile(file) {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8').split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

export function loadEnv(callerUrl, envName) {
  const file = findEnvFile(callerUrl, envName);
  return { file, values: parseEnvFile(file) };
}

// ---------- 判重状态 ----------
// posted.json 是现网判重状态，永远留在本机 home、不进 git、不搬仓库（复制会导致重复发）。
export function findStateFile(dir, file = 'posted.json') {
  return firstPresent(
    path.join(HOME, '.workbuddy', dir, file),
  );
}

export function loadState(stateFile) {
  let state = { posted: {}, lastCategory: null, history: [] };
  // 人工用记事本/PowerShell 重写 posted.json 常带 UTF-8 BOM，JSON.parse 会直接抛错、判重被当成空状态。
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code !== 'ENOENT') console.log('状态读取警告：', String(e.message).slice(0, 120)); }
  state.posted = state.posted || {};
  state.history = state.history || [];
  return state;
}

export function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
}

// ---------- 网盘分享链接（2026-11-16 指挥官定：有什么链接就发什么链接） ----------
// 顺序即展示顺序，口径与站点 scripts/lib/data.js 的 NETDISK_PRESETS 一致。
// 此前推送链路只认 quark_url / baidu_url，光鸭等链接被整行丢掉；这里改成通用读取：
// 预设表覆盖已知网盘，数据里额外出现的任意 *_url 字段（值为 http 链接）也会自动带上，
// 以后站点新增网盘类型不必再改推送脚本。
export const NETDISK_PRESETS = [
  { key: 'quark_url',   code: ['quark_code', 'quark_pwd'],     kind: 'quark',   label: '夸克网盘', short: '夸克' },
  { key: 'baidu_url',   code: ['baidu_code', 'baidu_pwd'],     kind: 'baidu',   label: '百度网盘', short: '百度' },
  { key: 'guangya_url', code: ['guangya_code', 'guangya_pwd'], kind: 'guangya', label: '光鸭云盘', short: '光鸭' },
  { key: 'aliyun_url',  code: ['aliyun_code', 'aliyun_pwd'],   kind: 'aliyun',  label: '阿里云盘', short: '阿里' },
  { key: 'tianyi_url',  code: ['tianyi_code', 'tianyi_pwd'],   kind: 'tianyi',  label: '天翼云盘', short: '天翼' },
  { key: 'uc_url',      code: ['uc_code', 'uc_pwd'],           kind: 'uc',      label: 'UC网盘',   short: 'UC' },
  { key: 'xunlei_url',  code: ['xunlei_code', 'xunlei_pwd'],   kind: 'xunlei',  label: '迅雷网盘', short: '迅雷' },
  { key: '115_url',     code: ['115_code', '115_pwd'],         kind: '115',     label: '115网盘',  short: '115' },
  { key: 'mobile_url',  code: ['mobile_code', 'mobile_pwd'],   kind: 'mobile',  label: '移动云盘', short: '移动' },
];

// 非分享链接字段（海报 / 详情 / 官链 / 资料页等）不进网盘链接区
const NOT_SHARE_URL = new Set([
  'image_url', 'poster_url', 'cover_url', 'thumb_url', 'site_url', 'detail_url',
  'official_url', 'source_url', 'homepage_url', 'tmdb_url', 'douban_url', 'imdb_url',
]);

/** 从单个 YAML 条目块里抽出全部网盘分享链接（按预设表顺序，未知 *_url 兜底追加）。 */
function shareLinksOf(part, get) {
  const out = [];
  const used = new Set();
  const cleanUrl = (v) => String(v || '').replace(/^["']|["']$/g, '').trim();
  const push = (key, preset) => {
    if (used.has(key)) return;
    const url = cleanUrl(get(key));
    if (!/^https?:\/\//i.test(url)) return;   // 只认真实链接，空值/占位不进正文
    used.add(key);
    const kind = preset?.kind || key.replace(/_url$/, '');
    let code = '';
    for (const c of preset?.code || [`${kind}_code`, `${kind}_pwd`]) {
      const v = cleanUrl(get(c));
      if (v) { code = v; break; }
    }
    out.push({
      kind,
      label: preset?.label || `${kind}网盘`,
      short: preset?.short || kind,
      url,
      code,
    });
  };
  for (const p of NETDISK_PRESETS) push(p.key, p);
  for (const m of part.matchAll(/^\s*([a-z0-9_]+_url):\s*(.+)$/gmi)) {
    const key = m[1].toLowerCase();
    if (NOT_SHARE_URL.has(key)) continue;
    push(key, NETDISK_PRESETS.find((p) => p.key === key));
  }
  return out;
}

// ---------- 读站点数据 ----------
// data/*.yaml 是手写 YAML 子集，正则按行抽字段就够，别引入 YAML 解析库。
export function parseYaml(file) {
  // 软件.yaml 等是 CRLF，行尾 \r 会混进字段值（链接变坏链），统一清掉。
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const out = [];
  for (const part of raw.split(/(?=^- id: )/m)) {
    const id = part.match(/^- id:\s*"?([^"\n]+)"?/m)?.[1];
    if (!id) continue;
    const get = (k) => part.match(new RegExp(`^\\s*${k}:\\s*"([\\s\\S]*?)"\\s*$`, 'm'))?.[1]
      ?? part.match(new RegExp(`^\\s*${k}:\\s*([^\\n]+)`, 'm'))?.[1];
    const links = shareLinksOf(part, get);
    out.push({
      id,
      title: get('title') || '',
      category: get('category') || '',
      // 兼容字段继续保留（二维码 / 判重 / 网盘标签仍会用到），值与 links 同源，不会两边不一致
      quark: links.find((l) => l.kind === 'quark')?.url || '',
      baidu: links.find((l) => l.kind === 'baidu')?.url || '',
      baiduCode: links.find((l) => l.kind === 'baidu')?.code || '', // 站点数据实际用 baidu_pwd（588 条全部如此）
      links,                         // 平台文案一律按这个数组逐条输出：有什么链接就发什么链接
      desc: get('description') || '',
      date: get('date') || '',
      added: get('added') || '',
      image: get('image') || '',
      size: get('size') || '',            // files.size，缺失即空串
      tags: [...(part.match(/^\s*tags:\s*\[(.*?)\]/m)?.[1] || '').matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    });
  }
  return out;
}

export function loadItems(repo) {
  const dataDir = path.join(repo, 'data');
  let items = [];
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.yaml') || f === 'site.yaml') continue;
    items = items.concat(parseYaml(path.join(dataDir, f)));
  }
  return items;
}

// ---------- 站点路径口径（2026-11-15 全站 URL 与配图目录带分类 slug） ----------
// 详情页 /<slug>/<id>/、配图 static/images/<slug>/<id>.jpg。这张表与站点仓库
// scripts/lib/site-paths.mjs、C:/Users/marco/Scripts/ 两个飞书简报脚本共用同一份口径，
// 任何一侧改动必须三处同步。
export const PREFIX_SLUG = {
  mv: 'movie', tv: 'tv', dc: 'documentary', an: 'anime', game: 'game',
  app: 'software', bk: 'ebook', cs: 'course', ot: 'misc',
};

export const slugOf = (id) => PREFIX_SLUG[String(id).split('-')[0]] || '';

/** 详情页外链地址（站点侧以 build.js 的 setItemPaths 为准；未知前缀回退旧 /resource/ 路径） */
export const itemUrl = (siteUrl, id) => {
  const slug = slugOf(id);
  return slug ? `${siteUrl}/${slug}/${id}/` : `${siteUrl}/resource/${id}/`;
};

/**
 * 配图绝对路径。2026-11-15 起站点配图按分类 slug 分子目录（static/images/<slug>/<id>.jpg）；
 * 旧 flat 路径保留作回退——站点侧 check:images 已确认平铺目录迁空，这只是防御分支。
 * 判存在一律 statSync（沙箱里 existsSync 不可靠，见 bluesky SKILL.md 的沙箱坑记录）。
 */
export const imgPath = (repo, it) => {
  const base = path.join(repo, 'static', 'images');
  const slug = slugOf(it && it.id);
  if (slug && it.image) {
    const p = path.join(base, slug, it.image);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* fall through */ }
  }
  return path.join(base, (it && it.image) || '');
};

// 沙箱里 existsSync 不可靠，判海报一律 statSync().isFile()。
export const hasImgFile = (repo, it) => {
  if (!it.image) return false;
  try { return fs.statSync(imgPath(repo, it)).isFile(); } catch { return false; }
};

// ---------- 判重口径（用户定死）：夸克或百度链接任一相同 = 同一份资源 ----------
// 标题相同但链接不同照发（系列电影、多季剧是不同资源）；两条链接都空按 id 判重。
export const normTitle = (s) => String(s || '').replace(/[【\[(（].*?[】\])）]/g, '')
  .replace(/[\s·・:：\-_.、,，!！?？'"“”‘’]/g, '').toLowerCase();

/**
 * 判重器工厂。
 * extraSkips    ：平台专属、在链接判重**之前**跑的不可发判定（返回原因串或 null）。
 * fallbackSkips ：平台专属、在链接判重**之后**跑的判定（如 TG 的 --require-size）。
 */
export function makeDeduper({ state, items, extraSkips = [], fallbackSkips = [] }) {
  // 老记录缺字段时用当前数据回填，保证去重不留缺口
  for (const [id, rec] of Object.entries(state.posted)) {
    if (rec.quark && rec.baidu && rec.titleNorm) continue;
    const it = items.find((x) => x.id === id);
    if (it) {
      rec.quark = rec.quark || it.quark;
      rec.baidu = rec.baidu || it.baidu;
      rec.titleNorm = rec.titleNorm || normTitle(it.title);
      rec.title = rec.title || it.title;
    }
  }
  const seenLinks = new Set();
  for (const r of Object.values(state.posted)) {
    if (r.quark) seenLinks.add(r.quark);
    if (r.baidu) seenLinks.add(r.baidu);
  }
  const noteSeen = (it) => { if (it.quark) seenLinks.add(it.quark); if (it.baidu) seenLinks.add(it.baidu); };
  const skipReason = (it) => {
    for (const f of extraSkips) { const r = f(it); if (r) return r; }
    if (it.quark && seenLinks.has(it.quark)) return '夸克链接已发过（同一份资源）';
    if (it.baidu && seenLinks.has(it.baidu)) return '百度链接已发过（同一份资源）';
    if (!it.quark && !it.baidu && state.posted[it.id]) return '已发过（无链接，按 id 判重）';
    for (const f of fallbackSkips) { const r = f(it); if (r) return r; }
    return null;
  };
  return { seenLinks, noteSeen, skipReason };
}

// 发帖成功后写记录的公共字段；平台专属字段（messageId / uri 等）由平台层自己展开。
export const baseRecord = (it, text) => ({
  at: new Date().toISOString(),
  category: it.category,
  title: it.title,
  titleNorm: normTitle(it.title),
  quark: it.quark,
  baidu: it.baidu,
  text,
});

// ---------- 选片 ----------
/**
 * 选片器：latest（默认，全站按 added 倒序取最新入库的一条）/ random / rotate（按分类固定轮转）
 * / weighted（按各分类剩余可发条数加权随机选分类，再在分类内随机挑一条）。
 * pickOne(usedNow) 返回 { item, info }，info 是给人看的选片说明（可能为空串）。
 */
export function makePicker({ items, state, picks, strategy, skipReason, catOrder = CAT_ORDER }) {
  let info = '';
  function pickOne(usedNow) {
    info = '';
    const item = pickItem(usedNow);
    return { item, info };
  }
  function pickItem(usedNow) {
    if (picks.length) {
      const id = picks.shift();
      const it = items.find((x) => x.id === id);
      if (!it) throw new Error(`找不到条目 ${id}`);
      return it;
    }
    const unseen = items.filter((x) => !usedNow.has(x.id) && !skipReason(x));
    if (!unseen.length) throw new Error('没有新条目可发（全部重复或已被筛选条件排除）');
    if (strategy === 'latest') {
      // added 形如「2026-11-15」或「2026-11-15 06:37」，字符串倒序即时间倒序；
      // 同一批入库（added 相同）按 id 数值倒序，numeric 避免 mv-99 排到 mv-457 前面。
      return unseen.sort((a, b) => String(b.added).localeCompare(String(a.added))
        || b.id.localeCompare(a.id, 'en', { numeric: true }))[0];
    }
    if (strategy === 'random') return unseen[Math.floor(Math.random() * unseen.length)];
    if (strategy === 'rotate') {
      const start = state.lastCategory ? catOrder.indexOf(state.lastCategory) + 1 : 0;
      for (let k = 0; k < catOrder.length; k++) {
        const cat = catOrder[(start + k) % catOrder.length];
        const inCat = unseen.filter((x) => x.category === cat).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
        if (inCat.length) { info = `轮转分类：${cat}`; return inCat[0]; }
      }
      return unseen[0];
    }
    // weighted：库存多的分类出现得多，小分类也有机会露脸；发完的分类权重归零自动退出。
    const catSet = new Set(unseen.map((x) => x.category).filter(Boolean));
    const ordered = [...catOrder.filter((c) => catSet.has(c)), ...[...catSet].filter((c) => !catOrder.includes(c))];
    const pools = ordered.map((cat) => ({ cat, list: unseen.filter((x) => x.category === cat) })).filter((p) => p.list.length);
    if (!pools.length) throw new Error('没有新条目可发');
    const total = pools.reduce((s, p) => s + p.list.length, 0);
    let r = Math.random() * total;
    let chosen = pools[0];
    for (const p of pools) { r -= p.list.length; if (r <= 0) { chosen = p; break; } }
    info = `随机选中分类：${chosen.cat}（剩余 ${chosen.list.length} 条，权重 ${((chosen.list.length / total) * 100).toFixed(1)}%）`;
    return chosen.list[Math.floor(Math.random() * chosen.list.length)];
  }
  return { pickOne, get info() { return info; } };
}

// ---------- --audit / 汇总 ----------
export function countReasons(items, skipReason) {
  const reasons = {};
  for (const it of items) { const r = skipReason(it); if (r) reasons[r] = (reasons[r] || 0) + 1; }
  return reasons;
}

export function printSummary(results, { state, items, skipReason }) {
  console.log(`\n===== 汇总 =====`);
  console.log(`本次 ${results.length} 条 | 成功 ${results.filter((r) => r.ok).length} | 失败 ${results.filter((r) => r.ok === false).length}`);
  console.log(`已发 ${Object.keys(state.posted).length} / 全站 ${items.length} | 剩余可发 ${items.filter((x) => !skipReason(x)).length}`);
}
