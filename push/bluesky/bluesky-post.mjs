#!/usr/bin/env node
// push/bluesky/bluesky-post.mjs —— Bluesky 平台适配层。
// 把 wodewangpan 资源站的一条资源发到 Bluesky：默认发详情页链接卡（带海报缩略图）+ 全部网盘分享链接 + 三标签。
// 素材全部来自仓库：static/images/<image>、data/<分类>.yaml 的 title/description/*_url。
// 2026-11-16 指挥官定：有什么资源链接就发什么链接（夸克 / 百度 / 光鸭 / …），不再只认夸克与百度。
// 读数据、判重、选片共用 ../common.mjs；本文件只留文案渲染与 AT Protocol 收发。
//
// 用法：
//   node bluesky-post.mjs --dry            # 只打印待发文案与选中条目，不发帖
//   node bluesky-post.mjs                  # 发一条（默认 latest 最新入库优先，绝不重复已发过的）
//   node bluesky-post.mjs --count 3        # 一次发 3 条（补发用）
//   node bluesky-post.mjs --pick mv-248    # 指定条目（--pick 可重复，忽略已发记录）
//   node bluesky-post.mjs --strategy latest|weighted|random|rotate   # 默认 latest：按 added 倒序，新入库优先
//   node bluesky-post.mjs --no-site-link   # 正文不带站点详情页链接
//   node bluesky-post.mjs --with-site-link # 正文带站点详情页链接（默认带）
//   node bluesky-post.mjs --embed external|image|auto  # external（默认）：详情页链接卡 + 海报缩略图；
//                                                      # image 大图图片卡（旧版式）；auto 有海报发图、无海报发链接卡
//   node bluesky-post.mjs --no-thumb       # 链接卡不带缩略图（默认带条目海报）
//   node bluesky-post.mjs --no-state       # 测试用：照常发帖，但不写 posted.json（不计入判重）
//   node bluesky-post.mjs --audit          # 打印不可发条目的原因分布
//
// 凭据：同目录 wodewangpan-bluesky.env（临时覆盖）→ ~/.config/wodewangpan-bluesky.env
//   （BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD / BLUESKY_PDS / REPO / SITE_URL）
// 已发记录：仓库 state/bluesky-posts/posted.json（去重唯一依据，勿删，不推送）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  arg, has, collectPicks, loadEnv, findStateFile, loadState, saveState,
  loadItems, imgPath, makeDeduper, makePicker, baseRecord, countReasons, printSummary,
  DEFAULT_REPO, DEFAULT_SITE_URL, itemUrl,
} from '../common.mjs';

const { file: ENV_FILE, values: env } = loadEnv(import.meta.url, 'wodewangpan-bluesky.env');
const IDENTIFIER = env.BLUESKY_IDENTIFIER;
const APP_PASSWORD = env.BLUESKY_APP_PASSWORD;
const PDS = env.BLUESKY_PDS || 'https://bsky.social';
const REPO = env.REPO || DEFAULT_REPO;
const SITE_URL = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');

const DRY = has('dry');
// 站里有 52 条软件类老条目没有 image 字段（无海报）。用户 2026-10-06 要求**照样发**（纯文本帖，文字+链接，不带图）；
// 想只发带图的就加 --require-image。
const ALLOW_NO_IMAGE = !has('require-image');
const COUNT = parseInt(arg('count', '1'), 10);
const STRATEGY = arg('strategy', 'latest'); // latest（默认）| weighted | rotate | random
const PICKS = collectPicks();
const WITH_SITE_LINK = !has('no-site-link');
// 2026-11-15 指挥官提问后加：Bluesky 的 PDS 不会自己抓站点 OG，要让帖子出链接卡必须显式发 external embed。
// external（默认，2026-11-15 指挥官定版）：发详情页链接卡 + 条目海报当缩略图，正文走精简版式；
// image：强制大图图片卡（旧版式，简介写在正文）；auto：有海报发图片、无海报发链接卡（历史兼容）。
const EMBED = arg('embed', 'external');
// 测试发帖用：照常发送，但不写 posted.json（不计入累计、不影响判重）
const NO_STATE = has('no-state');
// 链接卡默认用条目海报当缩略图（thumb），--no-thumb 可关掉
const NO_THUMB = has('no-thumb');

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

// ---------- 数据与状态（共享流水线） ----------
const STATE_FILE = findStateFile('bluesky-posts');
const items = loadItems(REPO);
const state = loadState(STATE_FILE);

const deduper = makeDeduper({
  state, items,
  extraSkips: [ALLOW_NO_IMAGE ? null : (it) => (!it.image ? '无海报（--require-image 生效，跳过纯文本帖）' : null)].filter(Boolean),
});
const { noteSeen, skipReason } = deduper;
const picker = makePicker({ items, state, picks: PICKS, strategy: STRATEGY, skipReason });

// ---------- 文案 ----------
const MAX = 300;
/** 简介的保底字数：低于这个值就让出「详情」行（见 buildText） */
const MIN_DESC = 60;
/**
 * 帖子结构（2026-11-15 指挥官定版：详情行提到订阅行之前，标签加第三个业务标签）：
 *   【分类】标题（年份）
 *   简介…
 *
 *   详情：https://www.wodewangpan.top/<slug>/<id>/（slug 按 id 前缀，如 mv→movie）
 *   订阅TG：https://t.me/myquark ，关注更多资源
 *   夸克网盘：https://pan.quark.cn/s/xxxx
 *   百度网盘：https://pan.baidu.com/s/xxxx（提取码 abcd）
 *   #网盘资源 #分类 #业务标签
 * 上限 300 graphemes。放不下时**只砍简介，不动链接**；简介额度被压到 40 字以下时，
 * 先让出「详情」行（两条网盘链接是用户要的重点），网盘链接与标签始终保留，永不截断 URL。
 */
// 标题行（2026-11-15 指挥官定：不带年份，`日期` 仍在数据里，只是不上屏）
function headerOf(it) {
  return `【${it.category}】${it.title}`;
}
/**
 * 资源名做标签（2026-11-15 指挥官定）：去括号内容 → 砍掉空格连字符/竖线后的副标题 → 砍掉中文逗号后的解释 →
 * 只留字母数字（含中文）→ 最多 14 个字符。目的：让 `#资源名` 短到能读、能点，又不至于半个词断尾。
 */
function tagOfTitle(it) {
  const s = String(it.title || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+[-—–|｜]\s+.*$/, '')
    .replace(/[，。；！？,;!?].*$/, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return [...s].slice(0, 14).join('');
}
/**
 * 三个标签（2026-11-15 指挥官定）：#资源名 #分类 #网盘。
 * 资源名取标题清洗后的结果（可与分类重名，重名时自动去重后只剩两个）；网盘标签按条目实际有的链接走。
 */
function tagsOf(it) {
  const cat = String(it.category || '').replace(/[^\p{L}\p{N}]/gu, '');
  // 网盘标签按条目实际发出的第一条链接走（只有光鸭时就是 #光鸭云盘）
  const netTag = it.links?.length ? `#${it.links[0].label}` : '';
  const parts = [`#${tagOfTitle(it) || cat}`, cat ? `#${cat}` : '', netTag].filter(Boolean);
  return [...new Set(parts)].join(' ');
}
/** 网盘链接行：common.mjs 的 links 数组有什么就列什么，不预设只有夸克/百度。 */
function linkLinesOf(it, suffix = '') {
  const tail = suffix ? ` ${suffix}` : '';
  return (it.links || []).map((l) =>
    `${l.label}：${l.url}${l.code ? `（提取码 ${l.code}）` : ''}${tail}`);
}
function buildText(it, { compact = false } = {}) {
  const header = headerOf(it);
  const linkLines = linkLinesOf(it);
  const siteLine = `详情：${itemUrl(SITE_URL, it.id)}`;
  // 订阅号引导行（2026-11-12 用户定）：替换掉 11-10 加的「加入TG群组：https://t.me/wodewangpantop」；
  // 2026-11-15 指挥官定版：详情行提到最前，其后订阅行、网盘链接，末尾三个标签。
  const tgLine = '订阅TG：https://t.me/myquark ，关注更多资源';
  const tags = tagsOf(it);
  const assemble = (desc, withSite) => {
    const lines = withSite ? [siteLine, tgLine, ...linkLines] : [tgLine, ...linkLines];
    return `${header}\n${desc}${desc ? '\n\n' : '\n'}${lines.join('\n')}\n${tags}`;
  };

  // 链接卡模式（compact，2026-11-15 第三版，指挥官定）：
  // 标题与简介由卡片承担，正文只写「标题+引流语 / TG群 / TG订阅号 / 网盘（点击保存） / 标签」，
  // 不再写详情行（卡片本身就是详情链接）。
  if (compact) {
    const compactLinks = linkLinesOf(it, '（点击保存）');
    // 空行分隔（2026-11-15 指挥官定）：引流区（TG群 / 订阅号）与网盘链接区分开，视觉上不挤成一团。
    let lines = [
      'TG群：https://t.me/wodewangpantop',
      'TG订阅号：https://t.me/myquark',
      '',
      ...compactLinks,
    ];
    // 标签前也留一个空行（2026-11-15 指挥官定），把标签从链接堆里独立出来。
    const build = (ls, tgText) =>
      `${header}，关注更多资源，请加入：\n${ls.join('\n')}${tgText ? `\n\n${tgText}` : ''}`;
    let out = build(lines, tags);
    // 300 字硬上限：条目同时有夸克/百度/光鸭时链接区变长，链接行永不砍，
    // 依次让出引流区两行、再让出标签，保证所有网盘链接都能完整发出去。
    for (const drop of [/^TG群：/, /^TG订阅号：/]) {
      if ([...out].length <= MAX) break;
      lines = lines.filter((l) => !drop.test(l));
      out = build(lines, tags);
    }
    if ([...out].length > MAX) out = build(lines, '');
    return out;
  }

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
  let out = assemble(body, withSite);
  // 极端兜底：多条网盘链接把正文顶过 300 字时，依次让出订阅行 / 详情行 / 标签，链接行一条不砍
  for (const line of [tgLine, siteLine, tags]) {
    if ([...out].length <= MAX) break;
    if (line) out = out.replace(line, '');
  }
  return out;
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

async function createPost({ did, jwt, text, blob, alt, external }) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['zh'],
    facets: facetsFor(text),
  };
  if (blob) {
    record.embed = { $type: 'app.bsky.embed.images', images: [{ alt: alt.slice(0, 300), image: blob }] };
  } else if (external) {
    // 链接卡（external embed）：PDS 不会自己抓 OG，卡片内容全靠这里显式给，不给 thumb 就是无图卡片
    record.embed = { $type: 'app.bsky.embed.external', external };
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

const bskyUrl = (uri) =>
  `https://bsky.app/profile/${IDENTIFIER}/post/${String(uri).split('/').pop()}`;

// ---------- 主流程 ----------
if (has('audit')) {
  const reasons = countReasons(items, skipReason);
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
  let it, pickedInfo;
  try { ({ item: it, info: pickedInfo } = picker.pickOne(usedNow)); }
  catch (e) { console.log(`× ${e.message}`); break; }
  usedNow.add(it.id);
  state.lastCategory = it.category; // 同批次内也轮转，避免一次 --count N 全发同一分类
  const imgPathFull = imgPath(REPO, it);
  // [沙箱补丁] 沙箱内 existsSync 对已存在文件会误报 false（statSync 正常），改用 statSync 判定，避免漏发海报
  const hasImg = it.image && (() => { try { return fs.statSync(imgPathFull).isFile(); } catch { return false; } })();
  const useCard = EMBED === 'external' || (EMBED === 'auto' && !hasImg);
  // 链接卡模式：标题与简介已经由卡片展示，正文再写一遍就是重复（2026-11-15 指挥官反馈），所以正文只留链接区与标签
  const text = buildText(it, { compact: useCard });
  const len = [...text].length;
  const alt = `${it.title}${it.category ? `（${it.category}）` : ''} 海报`;

  console.log(`\n——— 第 ${n + 1} 条 ———`);
  const card = useCard
    ? { uri: itemUrl(SITE_URL, it.id), title: headerOf(it), description: (it.desc || '').trim().slice(0, 150) }
    : null;
  console.log(`id: ${it.id} | ${it.category} | ${it.title} | 图: ${useCard ? (hasImg && !NO_THUMB ? `（链接卡缩略图 ${it.image}）` : '（链接卡，无图）') : (hasImg ? it.image : '（无海报，纯文本帖）')} | 字数 ${len}/300`);
  if (pickedInfo) console.log(pickedInfo);
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
    // 图片卡：上传海报作为正文大图；链接卡：上传海报作为卡片缩略图（thumb），--no-thumb 时跳过
    if (hasImg && (!useCard || !NO_THUMB)) blob = await uploadBlob(sess.jwt, imgPathFull);
    const cardPayload = card && blob ? { ...card, thumb: blob } : card;
    const r = await createPost({ did: sess.did, jwt: sess.jwt, text, blob: useCard ? null : blob, alt, external: cardPayload });
    const url = bskyUrl(r.uri);
    if (!NO_STATE) {
      state.posted[it.id] = { ...baseRecord(it, text), uri: r.uri, cid: r.cid };
      noteSeen(it);
      state.history.push({ id: it.id, at: new Date().toISOString(), uri: r.uri });
    }
    console.log(`✓ 已发送 → ${url}${NO_STATE ? '（--no-state：测试帖，未写入 posted.json）' : ''}`);
    results.push({ id: it.id, ok: true, url, uri: r.uri, embed: useCard ? `external${cardPayload?.thumb ? '+thumb' : ''}` : (blob ? 'images' : 'none'), noState: NO_STATE || undefined });
  } catch (e) {
    console.log(`× 发送失败：${e.message}`);
    results.push({ id: it.id, ok: false, error: String(e.message).slice(0, 200) });
  }
}

if (!DRY && !NO_STATE) {
  // 写回前合并磁盘最新状态：另一个并发进程可能已写入新记录，直接覆盖会丢判重记录。
  try {
    const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [id, rec] of Object.entries(disk.posted || {})) {
      if (!state.posted[id]) state.posted[id] = rec;
    }
    const known = new Set(state.history.map((h) => h.id + '@' + h.at));
    for (const h of disk.history || []) if (!known.has(h.id + '@' + h.at)) state.history.push(h);
    state.history.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  } catch {}
  saveState(STATE_FILE, state);
  console.log(`\n已发记录写入：${STATE_FILE}（累计 ${Object.keys(state.posted).length} 条）`);
} else if (NO_STATE) {
  console.log(`\n--no-state：本次未写 ${STATE_FILE}（测试帖不计入判重）`);
}
printSummary(results, { state, items, skipReason });
console.log(JSON.stringify(results, null, 1));
