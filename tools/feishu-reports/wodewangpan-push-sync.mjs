#!/usr/bin/env node
/**
 * 「我的网盘.TG / Bluesky 推送同步检查」——后发帖的 Bluesky（每小时 :08）发帖后调用。
 *
 * 两个频道各自独立发帖、各自按 latest 选片，工具**不自动补发、不改写任何 state**；
 * 本脚本只读两边 state/<平台>/posted.json，**按资源链接对账**（与判重口径一致：夸克或百度链接
 * 任一相同即同一份资源；两条都空才按 id 判）。不能只比 id——2026-11-22 出现过 game-060
 * 被复用成两个不同资源、id 集合看似一致但频道实际不同步的假象。
 * 发现不同步就发橙色告警飞书卡片，由人工决定要不要用 --pick 补发；同步时不发卡片。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-push-sync.mjs           # 检查 + 不同步时发飞书
 *   node tools/feishu-reports/wodewangpan-push-sync.mjs --dry-run  # 只打印差异与卡片 JSON
 */
import { DEFAULT_SITE_URL, findStateFile, loadState, listUncertain, itemUrl, loadEnv } from '../../push/common.mjs';
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';

const DRY = process.argv.includes('--dry-run');
const BS_HANDLE = loadEnv(import.meta.url, 'wodewangpan-bluesky.env').values.BLUESKY_IDENTIFIER || '';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const tg = loadState(findStateFile('telegram-posts'));
const bs = loadState(findStateFile('bluesky-posts'));
const tgPosted = tg.posted || {};
const bsPosted = bs.posted || {};

// 资源指纹：夸克 > 百度 > id（与 push/common.mjs 的判重口径同构）
const fpOf = (id, rec) => rec.quark ? `q:${rec.quark}` : rec.baidu ? `b:${rec.baidu}` : `id:${id}`;
const indexOf = (posted) => {
  const m = new Map();
  for (const [id, rec] of Object.entries(posted)) {
    if (rec && rec.uncertain) continue; // 送达不确定单独报，不计入已发资源
    m.set(fpOf(id, rec || {}), { id, rec: rec || {} });
  }
  return m;
};
const tgIdx = indexOf(tgPosted);
const bsIdx = indexOf(bsPosted);
const missingInBs = [...tgIdx].filter(([fp]) => !bsIdx.has(fp)).map(([, v]) => v);
const missingInTg = [...bsIdx].filter(([fp]) => !tgIdx.has(fp)).map(([, v]) => v);

// 同一 id 在两边指向不同资源（id 被复用）时额外提示，避免只看标题误判
const fpById = (posted) => Object.fromEntries(Object.entries(posted).map(([id, rec]) => [id, fpOf(id, rec || {})]));
const tgFpById = fpById(tgPosted);
const bsFpById = fpById(bsPosted);
const reusedIds = Object.keys(tgFpById).filter((id) => bsFpById[id] && bsFpById[id] !== tgFpById[id]);

const tgUncertain = listUncertain(tg);
const bsUncertain = listUncertain(bs);
const uncertain = [...tgUncertain.map(([id]) => ['TG', id]), ...bsUncertain.map(([id]) => ['BS', id])];
const same = !missingInBs.length && !missingInTg.length && !uncertain.length;

const postUrl = (v, platform) => {
  if (platform === 'bs') {
    return v.rec.uri && BS_HANDLE
      ? `https://bsky.app/profile/${BS_HANDLE}/post/${String(v.rec.uri).split('/').pop()}`
      : '';
  }
  return v.rec.messageId ? `https://t.me/myquark/${v.rec.messageId}` : '';
};
const titleOf = (id) => (tgPosted[id] || {}).title || (bsPosted[id] || {}).title || '（标题未找到）';
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const lines = (rows, platform) => {
  const out = rows.slice(0, 20).map((v) => {
    const link = postUrl(v, platform) || itemUrl(DEFAULT_SITE_URL, v.id);
    return `· ${v.id}｜${v.rec.title || '（无标题）'}｜[查看帖子](${link})`;
  });
  if (rows.length > 20) out.push(`· …另 ${rows.length - 20} 条`);
  return out.join('\n');
};

const elements = [md(`**检查时间：** ${timeStr}`), hr()];
elements.push(md(`**已发对账（按资源链接）：** TG ${Object.keys(tgPosted).length} 条 ｜ Bluesky ${Object.keys(bsPosted).length} 条 ｜ 差异 ${missingInBs.length + missingInTg.length} 条`));
if (missingInBs.length) {
  elements.push(md(`**Bluesky 漏发（TG 已发，BS 未发）· ${missingInBs.length} 条**\n${lines(missingInBs, 'tg')}`));
}
if (missingInTg.length) {
  elements.push(md(`**Telegram 漏发（BS 已发，TG 未发）· ${missingInTg.length} 条**\n${lines(missingInTg, 'bs')}`));
}
if (reusedIds.length) {
  elements.push(md(`**⚠ id 被复用（两边同一 id 指向不同资源）· ${reusedIds.length} 个**\n${reusedIds.map((id) => `· ${id}｜TG：${(tgPosted[id] || {}).title || '（无标题）'}｜BS：${(bsPosted[id] || {}).title || '（无标题）'}`).join('\n')}\n请核对 data/*.yaml 与该 id 的历史帖子，不要直接按 id 补发。`));
}
if (uncertain.length) {
  elements.push(md(`**送达不确定（需人工核对）· ${uncertain.length} 条**\n${uncertain.map(([p, id]) => `· ${p}｜${id}｜${titleOf(id)}`).join('\n')}`));
}
elements.push(md('**人工修正：** 核对后对缺帖的平台用 `--pick <id>` 补发（TG：`node push/telegram/tg-post.mjs --pick <id>`；Bluesky：`node push/bluesky/bluesky-post.mjs --pick <id>`）。若属 id 复用，先确认当前数据指向的资源再动手。工具不会自动追平。'));
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: same ? '状态：同步' : `状态：不同步 ｜ 差异 ${missingInBs.length + missingInTg.length} 条 ｜ 不确定 ${uncertain.length} 条` }] });

const card = {
  config: { wide_screen_mode: true },
  header: { template: 'orange', title: { tag: 'plain_text', content: '我的网盘.TG / Bluesky 推送同步告警' } },
  elements,
};

console.log(`[同步检查] TG ${Object.keys(tgPosted).length} ｜ BS ${Object.keys(bsPosted).length} ｜ BS 漏 ${missingInBs.length} ｜ TG 漏 ${missingInTg.length} ｜ id 复用 ${reusedIds.length} ｜ 不确定 ${uncertain.length}`);
if (same) {
  console.log('[同步检查] 两边一致，不发卡片');
  process.exit(0);
}
if (DRY) {
  console.log(JSON.stringify(card, null, 2));
  console.log(`[dry-run] 接收人 ${feishuConfig().to}`);
  process.exit(0);
}
const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
try {
  const mid = await sendInteractiveCard(card, { idempotencyKey: `push-sync-${stamp}` });
  console.log(`[飞书] ✓ 已推送同步告警卡片 (message_id ${mid || 'unknown'})`);
} catch (e) {
  console.error('[发送失败]', String(e.message || e).slice(0, 600));
  process.exit(1);
}
