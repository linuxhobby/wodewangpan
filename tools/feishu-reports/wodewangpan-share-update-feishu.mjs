#!/usr/bin/env node
/**
 * 「我的网盘.夸克分享更新每日补存」任务的飞书汇报。
 *
 * 蓝色 interactive 卡片（与「预存资源搬运简报」「资源文件清单补齐简报」同一套版式）：
 *   蓝色头部标题一次 → 更新时间 → 本轮更新的资源目录 → 需人工跟进 → 底部 note 结果行。
 *
 * 发送通道：飞书开放 API 直发 interactive 卡片（不走 lark-cli / WorkBuddy）。
 *   凭据与接收人读 ~/.config/wodewangpan-feishu.env（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_TO，权限 600）。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-share-update-feishu.mjs --input <payload.json> [--dry-run]
 *
 * payload.json（UTF-8）结构：
 * {
 *   "title":  "我的网盘.夸克分享每日补充更新简报",   // 可选，卡片蓝色头部标题
 *   "time":   "2026-11-16 22:03",                // 可选，默认本机当前时间
 *   "dirs": [                                    // 本轮有新增并成功转存的资源目录
 *     {
 *       "name":  "分享标题",
 *       "path":  "夸克网盘/来自：分享/分享标题",   // saveas-update 返回的 data.save_path
 *       "added": 3,                              // 可选，新增文件数
 *       "msg":   "已将新增文件存入「…」"           // 可选，CLI 返回的 msg，原样展示
 *     }
 *   ],
 *   "skipped": [                                 // 可选，需人工跟进
 *     { "name": "某分享", "reason": "41043 链接未转存" }
 *   ],
 *   "status": "成功",                           // 底部状态，默认「成功」
 *   "detail": "本轮检测 2 条更新 ｜ 成功 2 ｜ 失败 0" // 可选，底部补充
 * }
 */
import fs from 'node:fs';
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';
const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const has = (k) => args.includes(k);

const DEFAULT_TITLE = '我的网盘.夸克分享每日补充更新简报';
const TO = feishuConfig().to;

const input = opt('--input');
if (!input) {
  console.error('用法: node wodewangpan-share-update-feishu.mjs --input <payload.json> [--dry-run]');
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`找不到 payload 文件: ${input}`);
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const title = String(data.title || '').trim() || DEFAULT_TITLE;
const dirs = Array.isArray(data.dirs) ? data.dirs : [];
const skipped = Array.isArray(data.skipped) ? data.skipped : [];
const status = String(data.status || '成功').trim() || '成功';
const detail = String(data.detail || '').trim();

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = String(data.time || '').trim() ||
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const elements = [];

elements.push(md(`**更新时间：** ${timeStr}`));
elements.push(hr());

// 本轮更新的资源目录
{
  const lines = [`**📂 本轮更新的资源目录（${dirs.length}）**`];
  if (!dirs.length) lines.push('· 本轮无新增资源');
  for (const d of dirs) {
    const name = String(d.name || '（未命名分享）').trim();
    const added = Number(d.added);
    const suffix = Number.isFinite(added) && added > 0 ? `（新增 ${added} 个文件）` : '';
    lines.push(`· **${name}**${suffix}`);
    const p = String(d.path || '').trim();
    if (p) lines.push(p);
    const msg = String(d.msg || '').trim();
    if (msg) lines.push(msg);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 需人工跟进
if (skipped.length) {
  const lines = [`**⚠️ 需人工跟进（${skipped.length}）**`];
  for (const s of skipped) {
    const nm = String(s.name || '（未命名）').trim();
    const reason = String(s.reason || '未说明原因').trim();
    lines.push(`· ${nm}：${reason}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

const footerParts = [`结果：${status}`, `更新 ${dirs.length} 条`];
if (detail) footerParts.push(detail);
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join(' ｜ ') }] });

const card = {
  config: { wide_screen_mode: true },
  header: { template: 'blue', title: { tag: 'plain_text', content: title } },
  elements,
};
const payload = JSON.stringify(card);

if (has('--dry-run')) {
  console.log(payload);
  console.log(`\n[dry-run] 更新 ${dirs.length} 条目录 ｜ 跟进 ${skipped.length} 条 ｜ 状态 ${status} ｜ 接收人 ${TO}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `share-update-${stamp}`);
try {
  const mid = await sendInteractiveCard(card, { to: TO, idempotencyKey: idem });
  console.log(`[飞书] ✓ 已推送分享更新简报卡片 (message_id ${mid || 'unknown'}) ｜ 更新 ${dirs.length} 条目录 ｜ 状态 ${status}`);
} catch (e) {
  console.error('[发送失败]', String(e.message || e).slice(0, 600));
  process.exit(1);
}
