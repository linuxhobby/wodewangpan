#!/usr/bin/env node
// push/bluesky/bluesky-post.mjs —— Bluesky 平台适配层。
// 把 wodewangpan 资源站的一条资源发到 Bluesky：海报图（embed images）+ 夸克/百度分享链接 + 简介。
// 素材全部来自仓库：static/images/<image>、data/<分类>.yaml 的 title/description/quark_url/baidu_url。
// 读数据、判重、选片共用 ../common.mjs；本文件只留文案渲染与 AT Protocol 收发。
//
// 用法：
//   node bluesky-post.mjs --dry            # 只打印待发文案与选中条目，不发帖
//   node bluesky-post.mjs                  # 发一条（默认 weighted 加权随机选分类，绝不重复已发过的）
//   node bluesky-post.mjs --count 3        # 一次发 3 条（补发用）
//   node bluesky-post.mjs --pick mv-248    # 指定条目（--pick 可重复，忽略已发记录）
//   node bluesky-post.mjs --strategy latest|random|rotate   # 默认 weighted
//   node bluesky-post.mjs --no-site-link   # 正文不带站点详情页链接
//   node bluesky-post.mjs --with-site-link # 正文带站点详情页链接（默认带）
//   node bluesky-post.mjs --audit          # 打印不可发条目的原因分布
//
// 凭据：同目录 wodewangpan-bluesky.env（回退 ~/.qwenworkcn → ~/.workbuddy）
//   （BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD / BLUESKY_PDS / REPO / SITE_URL）
// 已发记录：~/.qwenworkcn/bluesky-posts/posted.json（去重唯一依据，勿删；见 SKILL.md「沙箱坑」）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  arg, has, collectPicks, loadEnv, findStateFile, loadState, saveState,
  loadItems, imgPath, makeDeduper, makePicker, baseRecord, countReasons, printSummary,
  DEFAULT_REPO, DEFAULT_SITE_URL,
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
const STRATEGY = arg('strategy', 'weighted'); // weighted（默认）| rotate | random
const PICKS = collectPicks();
const WITH_SITE_LINK = !has('no-site-link');

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
  const imgPathFull = imgPath(REPO, it.image);
  // [沙箱补丁] 沙箱内 existsSync 对已存在文件会误报 false（statSync 正常），改用 statSync 判定，避免漏发海报
  const hasImg = it.image && (() => { try { return fs.statSync(imgPathFull).isFile(); } catch { return false; } })();
  const text = buildText(it);
  const len = [...text].length;
  const alt = `${it.title}${it.category ? `（${it.category}）` : ''} 海报`;

  console.log(`\n——— 第 ${n + 1} 条 ———`);
  console.log(`id: ${it.id} | ${it.category} | ${it.title} | 图: ${hasImg ? it.image : '（无海报，纯文本帖）'} | 字数 ${len}/300`);
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
    if (hasImg) blob = await uploadBlob(sess.jwt, imgPathFull);
    const r = await createPost({ did: sess.did, jwt: sess.jwt, text, blob, alt });
    const url = bskyUrl(r.uri);
    state.posted[it.id] = { ...baseRecord(it, text), uri: r.uri, cid: r.cid };
    noteSeen(it);
    state.history.push({ id: it.id, at: new Date().toISOString(), uri: r.uri });
    console.log(`✓ 已发送 → ${url}`);
    results.push({ id: it.id, ok: true, url, uri: r.uri });
  } catch (e) {
    console.log(`× 发送失败：${e.message}`);
    results.push({ id: it.id, ok: false, error: String(e.message).slice(0, 200) });
  }
}

if (!DRY) {
  saveState(STATE_FILE, state);
  console.log(`\n已发记录写入：${STATE_FILE}（累计 ${Object.keys(state.posted).length} 条）`);
}
printSummary(results, { state, items, skipReason });
console.log(JSON.stringify(results, null, 1));
