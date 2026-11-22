#!/usr/bin/env node
/**
 * 「我的网盘.TG / Bluesky 推送同步检查」——后发帖的 Bluesky（每小时 :08）发帖后调用。
 *
 * 两个频道各自独立发帖、各自按 latest 选片，工具**不自动补发、不改写任何 state**；
 * 本脚本只读两边 state/<平台>/posted.json，各取**最近发送的 2 条**按资源链接对账
 * （夸克 > 百度 > id，与判重同口径）。2026-11-22 教训：全量对账会被历史遗留记录
 * （手工迁移的 id 复用旧条目）误报；最近两条才反映当前推送节奏是否对齐。
 * 发现不同步就发橙色告警飞书卡片，由人工核对后用 --pick 补发；同步时不发卡片。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-push-sync.mjs           # 检查 + 不同步时发飞书
 *   node tools/feishu-reports/wodewangpan-push-sync.mjs --dry-run  # 只打印差异与卡片 JSON
 */
import { DEFAULT_SITE_URL, findStateFile, loadState, listUncertain, itemUrl, loadEnv } from '../../push/common.mjs';
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';

const RECENT_N = 2;
const DRY = process.argv.includes('--dry-run');
const BS_HANDLE = loadEnv(import.meta.url, 'wodewangpan-bluesky.env').values.BLUESKY_IDENTIFIER || '';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const tg = loadState(findStateFile('telegram-posts'));
const bs = loadState(findStateFile('bluesky-posts'));
const tgPosted = tg.posted || {};
const bsPosted = bs.posted || {};

const fpOf = (id, rec) => rec.quark ? `q:${rec.quark}` : rec.baidu ? `b:${rec.baidu}` : `id:${id}`;
/** 各取最近 2 条已送达记录，按发帖时间倒序；uncertain 不计入「已发」 */
const recentOf = (posted) => Object.entries(posted)
  .filter(([, r]) => r && !r.uncertain)
  .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
  .slice(0, RECENT_N)
  .map(([id, rec]) => ({ id, rec, fp: fpOf(id, rec) }));

const tgRecent = recentOf(tgPosted);
const bsRecent = recentOf(bsPosted);
const tgFps = new Set(tgRecent.map((x) => x.fp));
const bsFps = new Set(bsRecent.map((x) => x.fp));
// TG 最近两条里有、BS 最近两条里没有 = 节奏错开；反向同理
const missingInBs = tgRecent.filter((x) => !bsFps.has(x.fp));
const missingInTg = bsRecent.filter((x) => !tgFps.has(x.fp));

// 窗口差异还要再分两类（2026-11-23）：一侧**全量**发过、只是早于最近两条窗口的，属于
// 「节奏错位」——补发只会造成重复帖（这次卡片就建议 TG 重发已发过两遍的马力欧）；
// 全量也没有的才是真缺发。所以按全量指纹集合再筛一遍。
const allFp = (posted) => new Map(Object.entries(posted)
  .filter(([, r]) => r && !r.uncertain)
  .map(([id, rec]) => [fpOf(id, rec), { id, rec }]));
const tgAll = allFp(tgPosted);
const bsAll = allFp(bsPosted);
const isTrueGap = (v, otherAll) => !otherAll.has(v.fp);
const trueMissingInBs = missingInBs.filter((v) => isTrueGap(v, bsAll)); // TG 发了、BS 全量都没有
const trueMissingInTg = missingInTg.filter((v) => isTrueGap(v, tgAll)); // BS 发了、TG 全量都没有
const offsetOnly = [
  ...missingInBs.filter((v) => !isTrueGap(v, bsAll)).map((v) => ({ ...v, side: 'BS', other: bsAll.get(v.fp) })),
  ...missingInTg.filter((v) => !isTrueGap(v, tgAll)).map((v) => ({ ...v, side: 'TG', other: tgAll.get(v.fp) })),
];

const tgUncertain = listUncertain(tg);
const bsUncertain = listUncertain(bs);
const uncertain = [...tgUncertain.map(([id]) => ['TG', id]), ...bsUncertain.map(([id]) => ['BS', id])];
const same = !trueMissingInBs.length && !trueMissingInTg.length && !uncertain.length && !offsetOnly.length;

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
const lines = (rows, platform) => rows.map((v) => {
  const link = postUrl(v, platform) || itemUrl(DEFAULT_SITE_URL, v.id);
  return `· ${v.id}｜${v.rec.title || '（无标题）'}｜[查看帖子](${link})`;
}).join('\n');

const fmtAt = (at) => (String(at || '').slice(5, 16).replace('T', ' ') || '时间未知');
const elements = [md(`**检查时间：** ${timeStr}`), hr()];
elements.push(md(`**检查口径：** 两边各取最近 ${RECENT_N} 条，按资源链接比对（历史遗留条目不参与判定）。`));
elements.push(md(`**TG 最近 ${RECENT_N} 条：**\n${lines(tgRecent, 'tg') || '· 无'}\n\n**Bluesky 最近 ${RECENT_N} 条：**\n${lines(bsRecent, 'bs') || '· 无'}`));
if (trueMissingInBs.length) {
  elements.push(md(`**Bluesky 真缺发 · ${trueMissingInBs.length} 条（TG 已发、BS 全量没有）**\n${lines(trueMissingInBs, 'tg')}`));
}
if (trueMissingInTg.length) {
  elements.push(md(`**Telegram 真缺发 · ${trueMissingInTg.length} 条（BS 已发、TG 全量没有）**\n${lines(trueMissingInTg, 'bs')}`));
}
if (offsetOnly.length) {
  const rows = offsetOnly.map((v) => {
    // v.side 是「最近窗口里缺它」的那一侧；窗口里有它的是另一侧
    const ownSide = v.side === 'BS' ? 'TG' : 'BS';
    const alias = v.other.id && v.other.id !== v.id ? `（另一侧记作 ${v.other.id}）` : '';
    return `· ${v.id}｜${v.rec.title || '（无标题）'}｜${ownSide} ${fmtAt(v.rec.at)} vs ${v.side} ${fmtAt(v.other.rec.at)}${alias}`;
  });
  elements.push(md(`**节奏错位 · ${offsetOnly.length} 条（另一侧早就发过，只是不在最近 ${RECENT_N} 条窗口内）**\n${rows.join('\n')}\n这一组**不要补发**，补了就是重复帖；若确认是某一侧重复投递，用「--retract 条目id」撤掉多余那条。`));
}
if (uncertain.length) {
  elements.push(md(`**送达不确定（需人工核对）· ${uncertain.length} 条**\n${uncertain.map(([p, id]) => `· ${p}｜${id}｜${titleOf(id)}`).join('\n')}`));
}
// 注意：飞书 lark_md 会把 <id> 当 HTML 标签吞掉，卡片里只能写「条目id」，不能写尖括号占位符
// 补发命令按**实际缺的那一侧**生成（2026-11-23：原先写死的 game-056 示例正好是被重发过两遍的条目，
// 照着敲会把重复帖再发一遍）。只对「真缺发」给命令，节奏错位一律不给。
const fixLines = [];
if (trueMissingInBs.length) fixLines.push(`Bluesky 补发：${trueMissingInBs.map((v) => `\`node push/bluesky/bluesky-post.mjs --pick ${v.id}\``).join('、')}`);
if (trueMissingInTg.length) fixLines.push(`Telegram 补发：${trueMissingInTg.map((v) => `\`node push/telegram/tg-post.mjs --pick ${v.id}\``).join('、')}`);
if (fixLines.length) {
  elements.push(md(`**人工修正：** 先核对再执行，工具不会自动追平；若属 id 复用，先确认当前数据指向的资源再动手。\n${fixLines.join('\n')}`));
}
const gapCount = trueMissingInBs.length + trueMissingInTg.length;
const status = same
  ? '状态：同步'
  : `状态：${gapCount ? '不同步' : '节奏错位（无需补发）'} ｜ 最近两条差异 ${missingInBs.length + missingInTg.length} 条（真缺发 ${gapCount}）｜ 不确定 ${uncertain.length} 条`;
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: status }] });

const card = {
  config: { wide_screen_mode: true },
  header: { template: gapCount || uncertain.length ? 'orange' : 'blue', title: { tag: 'plain_text', content: '我的网盘.TG / Bluesky 推送同步告警' } },
  elements,
};

console.log(`[同步检查] 最近 ${RECENT_N} 条 ｜ 真缺发 BS:${trueMissingInBs.length} TG:${trueMissingInTg.length} ｜ 节奏错位 ${offsetOnly.length} ｜ 不确定 ${uncertain.length} ｜ TG: ${tgRecent.map((x) => x.id).join(',')} ｜ BS: ${bsRecent.map((x) => x.id).join(',')}`);
if (same) {
  console.log('[同步检查] 最近两条一致，不发卡片');
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
