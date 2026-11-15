#!/usr/bin/env node
// push/telegram/tg-post.mjs —— Telegram 平台适配层。
// 把 wodewangpan 资源站的一条资源发到 Telegram 订阅号/频道：
//   sendPhoto（海报）+ caption（名称 / 描述 / 链接 / 大小 / 标签）
// 读数据、判重、选片共用 ../common.mjs；本文件只留文案渲染与 TG API 收发。
//
// 用法：
//   node tg-post.mjs --dry                 # 只打印选中条目与渲染后的 caption，不发送（无需 token）
//   node tg-post.mjs                       # 发一条
//   node tg-post.mjs --count 3             # 连发 3 条（补发用）
//   node tg-post.mjs --pick game-012       # 指定条目（可重复传，忽略已发记录）
//   node tg-post.mjs --strategy weighted|rotate|random|latest
//   node tg-post.mjs --desc-len 200        # 描述目标字数（默认 200）
//   node tg-post.mjs --require-size        # 只发有 files.size 的条目（默认缺大小就省略该行）
//   node tg-post.mjs --require-image       # 只发有海报的（默认无海报退回纯文本 sendMessage）
//   node tg-post.mjs --with-site-link      # 正文额外带站点详情页链接
//   node tg-post.mjs --qr                  # 方案 A 前身：海报+正方形码合并成相册；默认不发
//   node tg-post.mjs --qr-split            # 方案 C：海报独占一条消息，二维码另发第二条并回复上一条；默认不发
//   node tg-post.mjs --qr-size 640         # 二维码像素边长（默认 480，仅 --qr / --qr-split 生效）
//   node tg-post.mjs --check               # 只校验 token 与 chat 可达（getMe + 目标信息）
//   node tg-post.mjs --retract <id>        # 撤回之前由本脚本发出去的某条目消息（调试用）
//   node tg-post.mjs --audit               # 打印不可发条目的原因分布
//
// 凭据：同目录 wodewangpan-tg.env（回退 ~/.workbuddy → ~/.workbuddy）—— TG_BOT_TOKEN / TG_CHAT / REPO / SITE_URL
//   （TG_CHAT 填 @频道用户名 或 -100 开头的数字 ID；bot 必须是该频道管理员并有「发布消息」权限）
// 已发记录：~/.workbuddy/telegram-posts/posted.json —— 去重唯一依据，勿删，不随仓库搬
//
// 传输只用 Node 内置 fetch（本机实测 api.telegram.org 直连 200），不走 curl，避开沙箱里 curl 无法 spawn 的坑。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  arg, has, collectPicks, loadEnv, findStateFile, loadState, saveState,
  loadItems, imgPath, hasImgFile, makeDeduper, makePicker, baseRecord,
  countReasons, printSummary, DEFAULT_REPO, DEFAULT_SITE_URL, itemUrl,
} from '../common.mjs';

const { file: ENV_FILE, values: env } = loadEnv(import.meta.url, 'wodewangpan-tg.env');
const TOKEN = env.TG_BOT_TOKEN || '';
const CHAT = env.TG_CHAT || '';
const REPO = env.REPO || DEFAULT_REPO;
const SITE_URL = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
const API_ROOT = env.TG_API_ROOT || 'https://api.telegram.org';

const DRY = has('dry');
const PICKS = collectPicks();
// 传了 --pick 就按指定条数发，不用额外记 --count
const COUNT = Math.max(parseInt(arg('count', '1'), 10), PICKS.length);
const STRATEGY = arg('strategy', 'weighted');
const DESC_LEN = parseInt(arg('desc-len', '200'), 10);
const ALLOW_NO_IMAGE = !has('require-image');
const REQUIRE_SIZE = has('require-size');
const WITH_SITE_LINK = has('with-site-link');   // 默认不带，用户样例只要网盘链接
// 二维码：指挥官 2026-11-12 先要求加，看完 A/B/C 等比模拟一度撤掉；现在按 C 方案单独试（--qr-split）。
// QR_MODE：'none'（默认，单图海报）| 'album'（--qr，海报+方码一个相册，两格对半分宽度，方码比竖海报宽 1.5 倍，已判定喧宾夺主）
//          | 'split'（--qr-split，方案 C：海报独占气泡满宽 + 二维码另发第二条回复上一条）。
// 注意 --album 那版用的仍是正方形 480 码；讨论中拟改进的「2:3 白底卡片码」只做到预览文件，没接进脚本。
const QR_MODE = has('qr-split') ? 'split' : (has('qr') ? 'album' : 'none');
const NO_QR = QR_MODE === 'none';
const QR_SIZE = parseInt(arg('qr-size', '480'), 10);

// Telegram caption 硬上限 1024，这里留 24 字符余量
const MAX_CAPTION = 1000;
const MIN_DESC = 60;      // 描述保底，低于这个字数就腾位置
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

// ---------- 数据与状态（共享流水线） ----------
const STATE_FILE = findStateFile('telegram-posts');
const items = loadItems(REPO);
const state = loadState(STATE_FILE);

const deduper = makeDeduper({
  state, items,
  fallbackSkips: [REQUIRE_SIZE ? (it) => (!it.size ? '缺 files.size（--require-size 生效）' : null) : null].filter(Boolean),
});
const { noteSeen, skipReason } = deduper;
const picker = makePicker({ items, state, picks: PICKS, strategy: STRATEGY, skipReason });

// ---------- 文案 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => String(s || '').replace(/^["']|["']$/g, '').trim();

// 订阅号 caption 末尾固定一行：联系小艾。想换人或换链接，在 env 里写
// TG_CONTACT_NAME / TG_CONTACT_URL 覆盖即可，不用改代码。
const CONTACT_URL = (env.TG_CONTACT_URL || 'https://t.me/wodewangpantop').trim();
const CONTACT_NAME = (env.TG_CONTACT_NAME || '小艾').trim();
const CONTACT_LINE = `查询更多资源请联系 <a href="${esc(CONTACT_URL)}">${esc(CONTACT_NAME)}</a>`;

/** 标签：空格与非法字符一律换成下划线（TG hashtag 不能带空格，否则 #暗黑破坏神3 永恒典藏版 会断成半截） */
function hashTags(it) {
  const src = (it.tags && it.tags.length ? it.tags : [it.category]).map(clean).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const t of src) {
    const h = t.replace(/[\s\u3000]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '_')
      .replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
    if (!h || seen.has(h)) continue;
    seen.add(h); out.push('#' + h);
  }
  return out;
}

/** 描述截断：在 DESC_LEN 内优先收在句号/问号/感叹号上，收不住就硬截加省略号。 */
function cutDesc(desc) {
  const chars = [...desc];
  if (chars.length <= DESC_LEN) return desc;
  const win = chars.slice(0, DESC_LEN + 1).join('');
  const stop = Math.max(...[...win].map((c, i) => ('。！？!?'.includes(c) ? i + 1 : 0)));
  if (stop >= Math.min(DESC_LEN * 0.6, 120)) return win.slice(0, stop);
  return win.slice(0, DESC_LEN).trimEnd() + '…';
}

/**
 * caption 结构（用户 2026-11-12 定的样例，同日改口径：不写「链接」，明确标网盘名）：
 *   名称：…
 *   描述：…（默认 200 字）
 *
 *   夸克：<a href=quark>quark</a>                 ← 条目有 quark_url 才有
 *   百度：<a href=baidu>baidu</a>（提取码 abcd）   ← 条目有 baidu_url 才有
 *   大小：1.2 GB                                  ← 缺 files.size 整行省略
 *   标签：#游戏 #动作角色扮演 …
 *   查询更多资源请联系 小艾（小艾指向 t.me/wodewangpantop）
 * 超预算时只砍描述；描述压到 MIN_DESC 仍不够就让出百度行；链接、标签、联系行永不截断。
 */
function buildCaption(it) {
  const q = clean(it.quark), b = clean(it.baidu), bc = clean(it.baiduCode);
  const linkLines = [];
  if (q) linkLines.push(`<b>夸克：</b><a href="${esc(q)}">${esc(q)}</a>`);
  const baiduLine = b ? `<b>百度：</b><a href="${esc(b)}">${esc(b)}</a>${bc ? `（提取码 ${esc(bc)}）` : ''}` : '';
  const sizeLine = it.size ? `<b>大小：</b>${esc(clean(it.size))}` : '';
  const siteLine = WITH_SITE_LINK ? `<b>详情：</b><a href="${itemUrl(SITE_URL, it.id)}">${itemUrl(SITE_URL, it.id)}</a>` : '';
  const tagLine = `<b>标签：</b>${hashTags(it).join(' ')}`;
  const name = clean(it.title) || it.id;
  const year = clean(it.date).slice(0, 4);

  const assemble = (desc, extra) => {
    const head = `<b>名称：</b>${esc(name)}${year ? `<b>（${year}）</b>` : ''}`;
    const lines = [head];
    if (desc) lines.push(`<b>描述：</b>${esc(desc)}`);
    lines.push('');
    if (q) lines.push(linkLines[0]);
    if (extra.baidu && baiduLine) lines.push(baiduLine);
    if (extra.site && siteLine) lines.push(siteLine);
    if (extra.size && sizeLine) lines.push(sizeLine);
    lines.push(tagLine);
    lines.push(CONTACT_LINE);
    return lines.join('\n');
  };

  let desc = cutDesc(clean(it.desc));
  const cost = (d) => [...assemble(d, { baidu: !!b, site: !!siteLine, size: !!sizeLine })].length;
  if (cost(desc) > MAX_CAPTION) {
    // 从 DESC_LEN 往下一档档退让，先退到 MIN_DESC
    let n = Math.min(DESC_LEN, MIN_DESC);
    for (; n >= 20; n -= 10) {
      desc = cutDesc([...clean(it.desc)].slice(0, n).join('') + (clean(it.desc).length > n ? '。' : ''));
      if (cost(desc) <= MAX_CAPTION) break;
    }
    // 还不够就丢可选行，顺序：站点详情 → 大小 → 百度（网盘链接和标签死保）
    if (cost(desc) > MAX_CAPTION && siteLine) return assemble(desc, { baidu: !!b, site: false, size: !!sizeLine });
    if (cost(desc) > MAX_CAPTION && sizeLine) return assemble(desc, { baidu: !!b, site: false, size: false });
    if (cost(desc) > MAX_CAPTION && baiduLine) return assemble(desc, { baidu: false, site: false, size: false });
  }
  return assemble(desc, { baidu: !!b, site: !!siteLine, size: !!sizeLine });
}

// 可见长度（去掉 HTML 标记后 TG 实际计入 1024 的字符数），用于打印核对
const visible = (s) => [...s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')].length;

// ---------- 夸克二维码 ----------
// 用仓库已装的 qrcode 库（scripts/lib/assets.js 生成站点 /qr/*.svg 用的就是它）按条目的 quark_url
// 现场生成 PNG：码与正文那条链接同一次取值，永远不会出现「码指 A、链是 B」。
// 站点现成的 SVG 不能用——Telegram 只认位图；库取不到时降级成「不发二维码」，绝不因此把整轮发送拖失败。
const QR_LIB = path.join(REPO, 'node_modules', 'qrcode', 'lib', 'index.js');
let qrMod = null, qrTried = false;
async function loadQR() {
  if (qrTried) return qrMod;
  qrTried = true;
  try { qrMod = (await import(pathToFileURL(QR_LIB).href)).default; }
  catch (e) { console.log(`  （qrcode 库不可用，本轮不发二维码：${String(e.message).slice(0, 80)}）`); qrMod = null; }
  return qrMod;
}
async function qrPng(url) {
  const QR = await loadQR();
  if (!QR || !url) return null;
  try {
    return await QR.toBuffer(url, { type: 'png', width: QR_SIZE, margin: 2, errorCorrectionLevel: 'M' });
  } catch (e) { console.log(`  二维码生成失败：${String(e.message).slice(0, 80)}`); return null; }
}

// ---------- Telegram API ----------
// Bot API 的 URL 里带 token，网络层异常（超时/DNS/TLS）常把完整 URL 写进 message 或 cause；
// 一律过一道打码再往外抛，避免 token 落到对话与日志里。
const redact = (s) => (TOKEN ? String(s || '').split(TOKEN).join('***') : String(s || ''));
async function tgCall(method, fields, files) {
  if (!TOKEN) throw new Error('缺少 TG_BOT_TOKEN，请写进 ' + ENV_FILE);
  let body;
  if (files && files.length) {
    // multipart 的**字段名**就是 TG 认领附件的键（sendPhoto 必须叫 photo；相册用 attach://<键> 引用），
    // 文件名走 append 的第三个参数——把 basename 当字段名会被 TG 判成「there is no photo in the request」。
    const fd = new FormData();
    // 嵌套参数（reply_parameters、media 数组等）在 multipart 里必须是 **JSON 字符串**，
    // 直接 String(obj) 会变成 "[object Object]" → TG 报 400 "can't parse reply parameters JSON object"。
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    for (const f of files) {
      const buf = f.buffer ?? fs.readFileSync(f.path);
      fd.append(f.field || 'photo', new Blob([buf], { type: f.mime || 'image/jpeg' }),
        f.filename || path.basename(f.path));
    }
    body = fd;
  } else {
    body = JSON.stringify(fields);
  }
  let res;
  try {
    res = await fetch(`${API_ROOT}/bot${TOKEN}/${method}`, {
      method: 'POST',
      ...(files && files.length ? {} : { headers: { 'Content-Type': 'application/json' } }),
      body,
      duplex: 'half',
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new Error(`网络失败：${redact(`${e.name} ${e.message} ${e.cause?.message || ''}`).slice(0, 240)}`);
  }
  const j = await res.json().catch(() => null);
  if (!j) throw new Error(`HTTP ${res.status}，响应不是 JSON`);
  if (!j.ok) {
    const ra = j.parameters?.retry_after;
    if (res.status === 429 && ra) return sleepThenRetry(method, fields, files, ra);
    const hint = {
      400: '（chat 目标或参数不合法、caption 超长、附件字段名/图片有问题）',
      401: '（bot token 不对）',
      403: '（bot 不在该群/不是频道管理员，或被限制发消息）',
      404: '（方法名或 token 路径不对）',
    }[j.error_code] || '';
    throw new Error(`${method} → ${j.error_code} ${j.description}${hint}`);
  }
  return j.result;
}
async function sleepThenRetry(method, fields, files, ra) {
  console.log(`  ! 触发限流，${ra}s 后重试一次`);
  await new Promise((r) => setTimeout(r, (ra + 1) * 1000));
  return tgCall(method, fields, files);
}
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'image/jpeg';
const sendText = (caption) => tgCall('sendMessage', { chat_id: CHAT, text: caption, parse_mode: 'HTML', disable_web_page_preview: true });
const sendPhoto = (caption, imgPath2) => tgCall('sendPhoto',
  { chat_id: CHAT, caption, parse_mode: 'HTML' },
  [{ field: 'photo', path: imgPath2, mime: mimeOf(imgPath2) }]);
const sendPhotoBuf = (caption, buf, filename) => tgCall('sendPhoto',
  { chat_id: CHAT, caption, parse_mode: 'HTML' },
  [{ field: 'photo', buffer: buf, filename, mime: 'image/png' }]);
/**
 * 相册（sendMediaGroup）：海报在前、夸克二维码在后，两条链接与文字仍是同一个 caption。
 * 两个坑：① caption/parse_mode 必须写在 media 数组的**第一个** InputMedia 里，
 * sendMediaGroup 顶层的 parse_mode 明确「不影响 media 里 caption 的解析方式」，写在顶层等于退回 MarkdownV2 并报 400；
 * ② 相册元素只能用 attach://<键> 引用同一次 multipart 里同名部件。
 */
const sendAlbum = (caption, posterPath, qrBuf, id) => {
  const media = [{ type: 'photo', media: 'attach://poster', caption, parse_mode: 'HTML' }];
  const files = [{ field: 'poster', path: posterPath, mime: mimeOf(posterPath) }];
  if (qrBuf) {
    media.push({ type: 'photo', media: 'attach://qr' });
    files.push({ field: 'qr', buffer: qrBuf, filename: `${id}-quark-qr.png`, mime: 'image/png' });
  }
  return tgCall('sendMediaGroup', { chat_id: CHAT, media: JSON.stringify(media) }, files);
};
/**
 * 方案 C 的第二条消息：只发二维码、回复上一条资源卡，让码落在标签**下面**且完全不与海报抢宽度。
 * 广播频道对 reply_parameters 的支持不如群和私聊确定，所以 400 时退化成独立的第二条，不整轮失败。
 */
async function sendQrFollow(qrBuf, id, replyTo) {
  const files = [{ field: 'photo', buffer: qrBuf, filename: `${id}-quark-qr.png`, mime: 'image/png' }];
  const caption = '扫码转存 · 夸克网盘';
  try {
    return await tgCall('sendPhoto', { chat_id: CHAT, caption, reply_parameters: { message_id: replyTo } }, files);
  } catch (e) {
    if (!/→ 400/.test(e.message)) throw e;
    console.log(`  （回复形式不被接受，退化为独立第二条：${e.message.slice(0, 70)}）`);
    return tgCall('sendPhoto', { chat_id: CHAT, caption }, files);
  }
}

// ---------- 主流程 ----------
if (has('audit')) {
  const reasons = countReasons(items, skipReason);
  console.log(`全站 ${items.length} 条 | 已发 ${Object.keys(state.posted).length} | 不可发 ${items.filter((x) => skipReason(x)).length}`);
  console.log('原因分布：' + JSON.stringify(reasons));
  console.log(`缺 files.size 的条目：${items.filter((x) => !x.size).length}（默认省略「大小」行）`);
  process.exit(0);
}

if (has('retract')) {
  const id = arg('retract', '');
  const rec = state.posted[id];
  const ids = rec ? (rec.messageIds && rec.messageIds.length ? rec.messageIds : [rec.messageId].filter(Boolean)) : [];
  if (!ids.length) { console.log(`× 记录里没有 ${id} 的消息 ID，撤不回（可能不是本脚本发的）`); process.exit(1); }
  try {
    // 相册是一条消息、纯文本也是一条；将来若改成「正文 + 二维码两条」就要全删，所以按 messageIds 数组处理
    for (const mid of ids) await tgCall('deleteMessage', { chat_id: CHAT, message_id: mid });
    console.log(`✓ 已撤回 ${id}（message_id ${ids.join('、')}）；记录保留，重发请加 --pick ${id}`);
  } catch (e) { console.log(`× 撤回失败：${e.message}`); process.exit(1); }
  process.exit(0);
}

if (!DRY && has('check') === false && (!TOKEN || !CHAT)) {
  console.log(`× 凭据不完整：需要 TG_BOT_TOKEN 与 TG_CHAT（写在 ${ENV_FILE}）。\n  想先看文案请跑 --dry（不需要 token）。`);
  process.exit(1);
}

// ---------- 单实例锁 ----------
// posted.json 是唯一权威判重状态：两个进程同时跑会各读到同一份状态、各挑一条再各自写回，
// 后写的把先写的记录覆盖掉，既重复发又丢判重记录。排他锁保证同一时刻只有一个发布进程。
// 人工 --pick / --count 补发同样受锁保护；--dry 与 --check 不发送，不占锁。
const PUSH_DIR = path.dirname(STATE_FILE);
const LOCK_FILE = path.join(PUSH_DIR, 'tg-post.lock');

function acquireLock() {
  fs.mkdirSync(PUSH_DIR, { recursive: true });
  const body = `${process.pid}\n${new Date().toISOString()}\n`;
  const release = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
  try {
    fs.writeFileSync(LOCK_FILE, body, { flag: 'wx' });
  } catch {
    let stale = true;
    try { stale = Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 10 * 60 * 1000; } catch { stale = true; }
    if (!stale) {
      let pid = '?';
      try { pid = fs.readFileSync(LOCK_FILE, 'utf8').split('\n')[0].trim() || '?'; } catch {}
      console.log(`× 另一个推送进程正在运行（pid ${pid}），本次跳过，避免重复发。`);
      process.exit(0);
    }
    fs.writeFileSync(LOCK_FILE, body);
  }
  process.on('exit', release);
}

if (!DRY && !has('check')) acquireLock();

let sess = null;
if (!DRY) {
  try { sess = await tgCall('getMe', {}); }
  catch (e) { console.log(`× getMe 失败：${e.message}`); process.exit(1); }
  console.log(`✓ token 有效：@${sess.username}（${sess.first_name}）| 目标 chat：${CHAT}`);
  if (has('check')) {
    // 不发消息也能确认：目标是什么类型、bot 在不在里面、有没有发帖权限
    try {
      const c = await tgCall('getChat', { chat_id: CHAT });
      console.log(`✓ 目标：${c.title || c.username || c.first_name} | 类型 ${c.type}${c.username ? ` | @${c.username}` : ''}`);
      const m = await tgCall('getChatMember', { chat_id: CHAT, user_id: sess.id });
      const rights = m.can_post_message === undefined ? '' : ` | can_post_message=${m.can_post_message}`;
      console.log(`✓ bot 身份：${m.status}${rights}`);
      if (m.status === 'kicked') console.log('  ! 被移出/拉黑，发不出去');
      else if (m.status === 'left' || m.status === 'member') console.log('  ! 频道需要 admin 才能发消息，请在频道管理里把 bot 设为管理员并授予「发布消息」');
    } catch (e) {
      // 广播频道默认隐藏订阅者名单，getChatMember 会报 400 "member list is inaccessible"——
      // 这不代表没权限。注意 getChat 对公开频道即使 bot 不在里面也能返回标题，所以它证明不了成员关系，
      // 唯一可靠的权限判据是真发一条（没加管理员会明确回 403 bot is not a member of the channel chat）。
      console.log(`× 权限查不了：${e.message}`);
      console.log('  广播频道隐藏成员名单属正常；要确认权限只能真发一条（403 = 还没把 bot 加为频道管理员）。');
    }
    process.exit(0);
  }
}

const usedNow = new Set();
const results = [];
for (let n = 0; n < COUNT; n++) {
  let it, pickedInfo;
  try { ({ item: it, info: pickedInfo } = picker.pickOne(usedNow)); }
  catch (e) { console.log(`× ${e.message}`); break; }
  usedNow.add(it.id);
  state.lastCategory = it.category;   // 同批次内也轮转，避免一次 --count N 全发同一分类

  const caption = buildCaption(it);
  const imgPathFull = imgPath(REPO, it);
  const imgOk = hasImgFile(REPO, it);
  if (!imgOk && !ALLOW_NO_IMAGE) { console.log(`× ${it.id} 无海报，--require-image 生效，跳过`); continue; }
  const tooBig = imgOk && fs.statSync(imgPathFull).size > PHOTO_MAX_BYTES;
  const qrBuf = NO_QR ? null : await qrPng(clean(it.quark));

  console.log(`\n——— 第 ${n + 1} 条 ———`);
  console.log(`id ${it.id} | ${it.category} | 大小 ${it.size || '（缺）'} | 海报 ${imgOk && !tooBig ? it.image : '（无/过大，纯文本）'} | 二维码 ${qrBuf ? `${(qrBuf.length / 1024).toFixed(1)}KB` : '（不发）'}`);
  if (pickedInfo) console.log(pickedInfo);
  console.log(`caption 原始 ${[...caption].length} 字符 / 可见 ${visible(caption)} 字符（TG 上限 1024）`);
  console.log(caption);
  console.log('————————');

  if (DRY) {
    console.log(`将发：${QR_MODE === 'split' ? '海报单图（满宽）+ 二维码另发第二条并回复上一条'
      : qrBuf ? '一个相册（海报 + 方码并排，两格对半分宽）' : (imgOk && !tooBig ? '单条消息：海报单图' : '单条消息：纯文本')}`);
    results.push({ id: it.id, dry: true, visible: visible(caption), qr: qrBuf ? QR_MODE : 'none' }); continue;
  }
  try {
    const mainHasImg = imgOk && !tooBig;
    let r, extra = null;
    if (QR_MODE === 'split') {
      r = mainHasImg ? await sendPhoto(caption, imgPathFull) : await sendText(caption);
      if (qrBuf) extra = await sendQrFollow(qrBuf, it.id, r.message_id);
    } else if (qrBuf) {
      r = mainHasImg ? await sendAlbum(caption, imgPathFull, qrBuf, it.id) : await sendPhotoBuf(caption, qrBuf, `${it.id}-quark-qr.png`);
    } else {
      r = mainHasImg ? await sendPhoto(caption, imgPathFull) : await sendText(caption);
    }
    const msgs = Array.isArray(r) ? r : [r];
    const messageIds = msgs.map((m) => m.message_id);
    if (extra) messageIds.push(extra.message_id);
    state.posted[it.id] = {
      ...baseRecord(it, caption),
      messageId: messageIds[0], messageIds, chatId: msgs[0].chat?.id,
    };
    noteSeen(it);
    state.history.push({ id: it.id, at: new Date().toISOString(), messageId: messageIds[0], messageIds });
    const shape = QR_MODE === 'split'
      ? (extra ? '海报满宽单图 + 二维码第二条（回复）' : '海报满宽单图（二维码没发出去）')
      : Array.isArray(r) ? '相册（海报+夸克码）' : (qrBuf && !mainHasImg ? '单图（夸克码，无海报）' : (mainHasImg ? '单图（海报）' : '纯文本'));
    console.log(`✓ 已发送 message_id=${messageIds.join('、')} | ${shape}`);
    results.push({ id: it.id, ok: true, messageId: messageIds[0], messageIds, shape });
  } catch (e) {
    console.log(`× 发送失败：${e.message}`);
    results.push({ id: it.id, ok: false, error: String(e.message).slice(0, 200) });
  }
}

if (!DRY) {
  saveState(STATE_FILE, state);
  console.log(`\n已发记录写入 ${STATE_FILE}（累计 ${Object.keys(state.posted).length} 条）`);
}
printSummary(results, { state, items, skipReason });
