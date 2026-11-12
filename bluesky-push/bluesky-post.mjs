#!/usr/bin/env node
// 把 wodewangpan 资源站的一条资源发到 Bluesky：海报图（embed images）+ 夸克/百度分享链接 + 简介。
// 素材全部来自仓库：static/images/<image>、data/<分类>.yaml 的 title/description/quark_url/baidu_url。
//
// 用法：
//   node bluesky-post.mjs --dry            # 只打印待发文案与选中条目，不发帖
//   node bluesky-post.mjs                  # 发一条（默认按分类轮转，绝不重复已发过的）
//   node bluesky-post.mjs --count 3        # 一次发 3 条（补发用）
//   node bluesky-post.mjs --pick mv-248    # 指定条目（--pick 可重复，忽略已发记录）
//   node bluesky-post.mjs --strategy latest|random|rotate   # 默认 rotate
//   node bluesky-post.mjs --no-site-link   # 正文不带站点详情页链接
//   node bluesky-post.mjs --with-site-link # 正文带站点详情页链接（默认带）
//
// 凭据：~/.qwenworkcn/wodewangpan-bluesky.env（BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD / REPO / SITE_URL）
// 已发记录：~/.qwenworkcn/bluesky-posts/posted.json（去重唯一依据，勿删；见 SKILL.md「沙箱坑」）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
// 数据目录（2026-10-30 迁移）：优先 ~/.qwenworkcn（沙箱可直接读写、写入快）；
// 老环境只有 ~/.workbuddy 时自动回退。沙箱里 existsSync 不可靠，统一用 statSync 判存在。
const firstPresent = (...c) => { for (const p of c) { try { fs.statSync(p); return p; } catch {} } return c[0]; };
const ENV_FILE = firstPresent(
  path.join(HOME, '.qwenworkcn', 'wodewangpan-bluesky.env'),
  path.join(HOME, '.workbuddy', 'wodewangpan-bluesky.env'),
);
const STATE_FILE = firstPresent(
  path.join(HOME, '.qwenworkcn', 'bluesky-posts', 'posted.json'),
  path.join(HOME, '.workbuddy', 'bluesky-posts', 'posted.json'),
);

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const IDENTIFIER = env.BLUESKY_IDENTIFIER;
const APP_PASSWORD = env.BLUESKY_APP_PASSWORD;
const PDS = env.BLUESKY_PDS || 'https://bsky.social';
const REPO = env.REPO;
const SITE_URL = (env.SITE_URL || 'https://www.wodewangpan.top').replace(/\/+$/, '');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const DRY = has('dry');
// 站里有 52 条软件类老条目没有 image 字段（无海报）。用户 2026-10-06 要求**照样发**（纯文本帖，文字+链接，不带图）；
// 想只发带图的就加 --require-image。
const ALLOW_NO_IMAGE = !has('require-image');
const COUNT = parseInt(arg('count', '1'), 10);
const STRATEGY = arg('strategy', 'weighted'); // weighted（默认）| rotate | random
const PICKS = process.argv.reduce((acc, v, i) => {
  if (v === '--pick' && process.argv[i + 1]) acc.push(process.argv[i + 1]);
  return acc;
}, []);
const WITH_SITE_LINK = !has('no-site-link');
const CAT_ORDER = ['电影', '电视剧', '纪录片', '动漫', '游戏', '软件', '电子书', '其他'];

// [沙箱兼容] 主机仍走 curl（行为完全不变）；沙箱内 curl 无法 spawn(ENOENT) 或 Schannel TLS 失败(exit 35)
// 时自动退回 Node 内置 fetch。curl 只在传输层出错才非零退出（HTTP 4xx/5xx 仍返回响应体），所以兜底语义一致。
const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6, ...opts }, (e, s, x) =>
      e ? rej(new Error(String(x || e.message).slice(0, 400))) : res(s)
    )
  );
const parseCurl = (args) => {
  const a = args.filter((t) => t !== '-s');
  let method = 'GET'; let url = null; const headers = {}; let body = null;
  for (let i = 0; i < a.length; i++) {
    const t = String(a[i]);
    if (t === '--max-time') { i++; continue; }
    if (t === '-X') { method = a[++i]; continue; }
    if (t === '-H') { const h = String(a[++i]); const k = h.indexOf(':'); headers[h.slice(0, k).trim()] = h.slice(k + 1).trim(); continue; }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      const v = String(a[++i]);
      body = v.startsWith('@') ? fs.readFileSync(v.slice(1)) : Buffer.from(v, 'utf8');
      continue;
    }
    if (/^https?:\/\//.test(t)) { url = t; continue; }
    throw new Error('未识别的 curl 参数：' + t);
  }
  if (!url) throw new Error('curl 参数缺少 URL');
  return { method, url, headers, body };
};
const curlViaFetch = async (args) => {
  const { method, url, headers, body } = parseCurl(args);
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
    duplex: 'half',
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  if (!res.ok && !text.trim()) throw new Error('HTTP ' + res.status + ' ' + url);
  return text;
};
const curl = (args) =>
  run('curl', ['-s', '--max-time', '40', ...args]).catch((e) => {
    console.log(`  （curl 不可用，退回 Node fetch：${String((e && e.message) || e).slice(0, 60)}）`);
    return curlViaFetch(args);
  });
const curlJson = async (args) => {
  const s = await curl(args);
  try { return JSON.parse(s); } catch { throw new Error(`响应非 JSON：${String(s).slice(0, 200)}`); }
};

// ---------- 读站点数据 ----------
function parseYaml(file) {
  // 部分 yaml（软件.yaml）是 CRLF，行尾的 \r 会被当成字段值的一部分，
  // 导致 id / quark_url 带上回车（链接发到 Bluesky 会坏掉），这里统一清掉。
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const out = [];
  for (const part of raw.split(/(?=^- id: )/m)) {
    const id = part.match(/^- id:\s*"?([^"\n]+)"?/m)?.[1];
    if (!id) continue;
    const get = (k) => part.match(new RegExp(`^\\s*${k}:\\s*"([\\s\\S]*?)"\\s*$`, 'm'))?.[1]
      ?? part.match(new RegExp(`^\\s*${k}:\\s*([^\\n]+)`, 'm'))?.[1];
    const title = get('title') || '';
    const category = get('category') || '';
    const quark = get('quark_url') || '';
    const baidu = get('baidu_url') || '';
    const baiduCode = get('baidu_code') || '';
    const desc = get('description') || '';
    const date = get('date') || '';
    const added = get('added') || '';
    const image = get('image') || '';
    const tagsRaw = part.match(/^\s*tags:\s*\[(.*?)\]/m)?.[1] || '';
    const tags = [...tagsRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    out.push({ id, title, category, quark, baidu, baiduCode, desc, date, added, image, tags });
  }
  return out;
}

const DATA_DIR = path.join(REPO, 'data');
const IMG_DIR = path.join(REPO, 'static', 'images');
let items = [];
for (const f of fs.readdirSync(DATA_DIR)) {
  if (!f.endsWith('.yaml') || f === 'site.yaml') continue;
  items = items.concat(parseYaml(path.join(DATA_DIR, f)));
}

// ---------- 状态 ----------
let state = { posted: {}, lastCategory: null, history: [] };
// [沙箱补丁] existsSync 在 .workbuddy 下返回 false，但 readFileSync 正常，改为直接尝试读取
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.log('状态读取警告：', String(e.message).slice(0, 120)); }
state.posted = state.posted || {};
state.history = state.history || [];

/**
 * 去重（用户定死口径，2026-10-10 修订）：**夸克分享链接或百度分享链接，任一相同即视为同一份资源**。
 * - 链接相同 → 发过就不再发；
 * - 标题相同但链接不同 → 照发（同系列电影、同一部剧的不同季都属于这种）；
 * - 两条链接都为空的条目不参与去重（按 id 判重）。
 */
const normTitle = (s) =>
  String(s || '')
    .replace(/[【\[(（].*?[】\])）]/g, '')
    .replace(/[\s·・:：\-_.、,，!！?？'"“”‘’]/g, '')
    .toLowerCase();

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
const noteSeen = (it) => {
  if (it.quark) seenLinks.add(it.quark);
  if (it.baidu) seenLinks.add(it.baidu);
};

const skipReason = (it) => {
  if (!it.image && !ALLOW_NO_IMAGE) return '无海报（--require-image 生效，跳过纯文本帖）';
  if (it.quark && seenLinks.has(it.quark)) return '夸克链接已发过（同一份资源）';
  if (it.baidu && seenLinks.has(it.baidu)) return '百度链接已发过（同一份资源）';
  if (!it.quark && !it.baidu && state.posted[it.id]) return '已发过（该条目无链接，按 id 判重）';
  return null;
};

// ---------- 选片 ----------
let pickedCategory = null;
let pickedInfo = '';
function pickOne(usedNow) {
  if (PICKS.length) {
    const id = PICKS.shift();
    const it = items.find((x) => x.id === id);
    if (!it) throw new Error(`找不到条目 ${id}`);
    return it;
  }
  const unseen = items.filter((x) => !usedNow.has(x.id) && !skipReason(x));
  if (!unseen.length) throw new Error('所有资源都已发过（或全部重复），没有新条目可发');
  if (STRATEGY === 'latest') {
    return unseen.sort((a, b) => String(b.added).localeCompare(String(a.added)) || b.id.localeCompare(a.id))[0];
  }
  if (STRATEGY === 'random') {
    return unseen[Math.floor(Math.random() * unseen.length)];
  }
  if (STRATEGY === 'rotate') {
    // 固定轮转：从上次分类的下一个开始，取该分类下编号最小的一条
    const startIdx = state.lastCategory ? CAT_ORDER.indexOf(state.lastCategory) + 1 : 0;
    for (let k = 0; k < CAT_ORDER.length; k++) {
      const cat = CAT_ORDER[(startIdx + k) % CAT_ORDER.length];
      const inCat = unseen
        .filter((x) => x.category === cat)
        .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
      if (inCat.length) return inCat[0];
    }
    return unseen[0];
  }
  // weighted（默认）：各分类剩余可发条数不一样（电影 249 / 电视剧 111 / 纪录片 77 / 软件 119 / 其他 1 …），
  // 按剩余数量加权随机选分类，再在该分类内随机挑一条。
  // 效果：库存多的分类出现得多，小分类也有机会露脸，发完的分类权重归零自动退出。
  // 分类不写死：以数据里实际出现的 category 为准，CAT_ORDER 只决定展示顺序，
  // 这样站里新增分类（如「电子书」）会自动纳入，不用回来改代码。
  const catSet = new Set(unseen.map((x) => x.category).filter(Boolean));
  const ordered = [
    ...CAT_ORDER.filter((c) => catSet.has(c)),
    ...[...catSet].filter((c) => !CAT_ORDER.includes(c)),
  ];
  const pools = ordered.map((cat) => ({ cat, list: unseen.filter((x) => x.category === cat) })).filter(
    (p) => p.list.length
  );
  if (!pools.length) throw new Error('没有新条目可发');
  const total = pools.reduce((s, p) => s + p.list.length, 0);
  let r = Math.random() * total;
  let chosen = pools[0];
  for (const p of pools) {
    r -= p.list.length;
    if (r <= 0) { chosen = p; break; }
  }
  pickedCategory = chosen.cat;
  pickedInfo = `${chosen.cat}（剩余 ${chosen.list.length} 条，权重 ${((chosen.list.length / total) * 100).toFixed(1)}%）`;
  return chosen.list[Math.floor(Math.random() * chosen.list.length)];
}

// ---------- 文案 ----------
const MAX = 300;
/** 简介的保底字数：低于这个值就让出「详情」行（见 buildText） */
const MIN_DESC = 60;
/**
 * 帖子结构（用户 2026-10-10 要求：有条目的百度链接就一起放上）：
 *   【分类】标题（年份）
 *   简介…
 *
 *   夸克网盘：https://pan.quark.cn/s/xxxx
 *   百度网盘：https://pan.baidu.com/s/xxxx（提取码 abcd）
 *   详情：https://www.wodewangpan.top/resource/<id>/
 *   #网盘资源 #分类
 * 上限 300 graphemes。放不下时**只砍简介，不动链接**；简介额度被压到 40 字以下时，
 * 先让出「详情」行（两条网盘链接是用户要的重点），网盘链接与标签始终保留，永不截断 URL。
 */
function buildText(it) {
  const year = (it.date || '').slice(0, 4);
  const header = `【${it.category}】${it.title}${year ? `（${year}）` : ''}`;
  const linkLines = [
    it.quark ? `夸克网盘：${it.quark}` : '',
    it.baidu ? `百度网盘：${it.baidu}${it.baiduCode ? `（提取码 ${it.baiduCode}）` : ''}` : '',
  ].filter(Boolean);
  const siteLine = `详情：${SITE_URL}/resource/${it.id}/`;
  // 固定加入 TG 群组链接（用户 2026-11-10 要求，同日改为永久公开链接），与网盘/详情链接一样永不被截断，落在标签行之前。
  const tgLine = '加入TG群组：https://t.me/wodewangpantop';
  const tags = `#网盘资源 #${it.category}`;
  const assemble = (desc, withSite) => {
    const lines = [...linkLines, tgLine];
    if (withSite) lines.push(siteLine);
    return `${header}\n${desc}${desc ? '\n\n' : '\n'}${lines.join('\n')}\n${tags}`;
  };

  const desc = (it.desc || '').trim();
  // 带详情行的骨架长度（desc 为空时那多出的 1 个换行由 budget 扣掉）
  let withSite = WITH_SITE_LINK;
  let budget = MAX - [...assemble('', withSite)].length - 1;
  // 简介至少留 MIN_DESC 字（长标题条目会把简介挤成干巴巴几个字，那样帖子没信息量）；
  // 不够就让出「详情」行，把额度还给简介。两条网盘链接和标签永远保留。
  if (budget < MIN_DESC && withSite) {
    withSite = false;
    budget = MAX - [...assemble('', withSite)].length - 1;
  }
  const chars = [...desc];
  const body = chars.length <= budget ? desc : chars.slice(0, Math.max(budget - 1, 0)).join('').trim() + '…';
  return assemble(body, withSite);
}

function facetsFor(text) {
  const facets = [];
  const push = (m, feature) => {
    const start = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    const end = start + Buffer.byteLength(m[0], 'utf8');
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [feature] });
  };
  // URL 到空白为止，但**必须在中日韩标点/全角符号前停下**：
  // 百度行是「…/s/xxxx（提取码 abcd）」，URL 后面直接跟全角括号、中间没有空格，
  // 若只用 [^\s]+ 会把「（提取码」也吃进链接里 → 生成一个打不开的坏链接。
  // \u3000-\u303f＝中日韩标点（、。《》「」【】），\uff00-\uffef＝全角形式（（）：；！？）
  for (const m of text.matchAll(/https?:\/\/[^\s\u3000-\u303f\uff00-\uffef]+/g)) {
    push(m, { $type: 'app.bsky.richtext.facet#link', uri: m[0] });
  }
  for (const m of text.matchAll(/#([^\s#、]+)/g)) {
    push(m, { $type: 'app.bsky.richtext.facet#tag', tag: m[1] });
  }
  return facets;
}

// ---------- Bluesky API ----------
async function session() {
  const j = await curlJson([
    '-X', 'POST', `${PDS}/xrpc/com.atproto.server.createSession`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ identifier: IDENTIFIER, password: APP_PASSWORD }),
  ]);
  if (!j.accessJwt) throw new Error(`登录失败：${j.message || j.error || JSON.stringify(j).slice(0, 160)}`);
  return { did: j.did, jwt: j.accessJwt, handle: j.handle };
}

async function uploadBlob(jwt, file) {
  const size = fs.statSync(file).size;
  if (size > 1000 * 1000) throw new Error(`图片超过 1MB（${size} 字节）：${file}`);
  const j = await curlJson([
    '-X', 'POST', `${PDS}/xrpc/com.atproto.repo.uploadBlob`,
    '-H', `Authorization: Bearer ${jwt}`,
    '-H', 'Content-Type: image/jpeg',
    '--data-binary', `@${file}`,
  ]);
  if (!j.blob) throw new Error(`图片上传失败：${JSON.stringify(j).slice(0, 200)}`);
  return j.blob;
}

async function createPost({ did, jwt, text, blob, alt }) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['zh'],
    facets: facetsFor(text),
  };
  if (blob) {
    record.embed = { $type: 'app.bsky.embed.images', images: [{ alt: alt.slice(0, 300), image: blob }] };
  }
  const payloadFile = path.join(os.tmpdir(), `bsky-post-${Date.now()}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }), 'utf8');
  const j = await curlJson([
    '-X', 'POST', `${PDS}/xrpc/com.atproto.repo.createRecord`,
    '-H', `Authorization: Bearer ${jwt}`,
    '-H', 'Content-Type: application/json',
    '--data-binary', `@${payloadFile}`,
  ]);
  fs.unlinkSync(payloadFile);
  if (!j.uri) throw new Error(`发帖失败：${JSON.stringify(j).slice(0, 250)}`);
  return j;
}

const bskyUrl = (uri, did) =>
  `https://bsky.app/profile/${IDENTIFIER}/post/${String(uri).split('/').pop()}`;

// ---------- 主流程 ----------
if (has('audit')) {
  const reasons = {};
  for (const it of items) {
    const r = skipReason(it);
    if (r) reasons[r] = (reasons[r] || 0) + 1;
  }
  console.log(`全站 ${items.length} 条，不可发 ${Object.values(reasons).reduce((a, b) => a + b, 0)} 条：`);
  console.log(JSON.stringify(reasons, null, 1));
  console.log(`可发：${items.filter((x) => !skipReason(x)).length} 条`);
  process.exit(0);
}
const usedNow = new Set();
const results = [];
let sess = null;
if (!DRY) sess = await session();

for (let n = 0; n < COUNT; n++) {
  let it;
  try {
    pickedCategory = null;
    pickedInfo = '';
    it = pickOne(usedNow);
  } catch (e) {
    console.log(`× ${e.message}`);
    break;
  }
  usedNow.add(it.id);
  state.lastCategory = it.category; // 同批次内也轮转，避免一次 --count N 全发同一分类
  const imgPath = path.join(IMG_DIR, it.image);
  // [沙箱补丁] 沙箱内 existsSync 对已存在文件会误报 false（statSync 正常），改用 statSync 判定，避免漏发海报
  const hasImg = it.image && (() => { try { return fs.statSync(imgPath).isFile(); } catch { return false; } })();
  const text = buildText(it);
  const len = [...text].length;
  const alt = `${it.title}${it.category ? `（${it.category}）` : ''} 海报`;

  console.log(`\n——— 第 ${n + 1} 条 ———`);
  console.log(`id: ${it.id} | ${it.category} | ${it.title} | 图: ${hasImg ? it.image : '（无海报，纯文本帖）'} | 字数 ${len}/300`);
  if (pickedInfo) console.log(`随机选中分类：${pickedInfo}`);
  console.log(text);
  console.log(`————————`);

  if (DRY) {
    // 干跑时把 facet 一并打出来，方便核对链接有没有被全角括号之类的字符污染
    const fcs = facetsFor(text);
    const links = fcs.filter((f) => f.features[0].$type.endsWith('#link')).map((f) => f.features[0].uri);
    const tg = fcs.filter((f) => f.features[0].$type.endsWith('#tag')).map((f) => f.features[0].tag);
    console.log(`facet：链接 ${links.length} 个`);
    for (const l of links) console.log(`  ↳ ${l}`);
    console.log(`facet：标签 ${tg.length} 个 [${tg.join(' ')}]`);
    results.push({ id: it.id, dry: true });
    continue;
  }
  try {
    let blob = null;
    if (hasImg) blob = await uploadBlob(sess.jwt, imgPath);
    const r = await createPost({ did: sess.did, jwt: sess.jwt, text, blob, alt });
    const url = bskyUrl(r.uri, sess.did);
    state.posted[it.id] = {
      at: new Date().toISOString(),
      uri: r.uri,
      cid: r.cid,
      category: it.category,
      title: it.title,
      titleNorm: normTitle(it.title),
      quark: it.quark,
      baidu: it.baidu,
      text,
    };
    noteSeen(it);
    state.lastCategory = it.category;
    state.history.push({ id: it.id, at: new Date().toISOString(), uri: r.uri });
    console.log(`✓ 已发送 → ${url}`);
    results.push({ id: it.id, ok: true, url, uri: r.uri });
  } catch (e) {
    console.log(`× 发送失败：${e.message}`);
    results.push({ id: it.id, ok: false, error: String(e.message).slice(0, 200) });
  }
}

if (!DRY) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  console.log(`\n已发记录写入：${STATE_FILE}（累计 ${Object.keys(state.posted).length} 条）`);
}
console.log(`\n===== 汇总 =====`);
console.log(`本次：${results.length} 条，成功 ${results.filter((r) => r.ok).length}，失败 ${results.filter((r) => r.ok === false).length}`);
const remaining = items.filter((x) => !skipReason(x)).length;
console.log(`已发：${Object.keys(state.posted).length} 条 | 剩余可发：${remaining} 条 / 全站 ${items.length} 条`);
console.log(JSON.stringify(results, null, 1));
