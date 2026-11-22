#!/usr/bin/env node
/**
 * 「夸克资源同步 + LLM 补全」自动化任务的补充汇报卡。
 *
 * 背景：主卡由 resource-sync.mjs 在第一步末尾发出，此时第二步 LLM 补全与
 * 第三步降级兜底尚未执行。本脚本由自动化任务在三步全部结束后调用，把后两步
 * 的结果单独发一张卡，避免用户只看到第一步快照、误以为任务已结束。
 *
 * 用法：
 *   node tools/quark-cron/notify-followup.mjs --input <payload.json> [--dry-run] [--idempotency-key <key>]
 *
 * payload.json 结构：
 *   {
 *     "title": "夸克同步 · 补全与兜底补充汇报",   // 可选
 *     "time":  "2026-11-23 05:55",               // 可选，不填取本机当前时间
 *     "sections": [                               // 必填，至少一段有内容
 *       { "label": "🤖 LLM 补全（1）",
 *         "items": [ { "id": "game-066",
 *                      "name": "女巫的烘焙坊 The Witch's Bakery",
 *                      "site": "https://www.wodewangpan.top/game/game-066/",
 *                      "note": "Switch 中文 XCI + NSP 升级档；海报已下载" } ] }
 *     ],
 *     "footer": "commit e0792a9 ｜ VPS 已重建 ｜ 线上抽查 200"
 *   }
 *
 * 约定：
 *  - 无实质结果时不要调用本脚本（自动化任务安静结束即可），避免发空卡。
 *  - 卡片头用绿色，与主卡的蓝色区分；接收人、凭据与 feishu-api.mjs 一致。
 *  - 发送失败返回非 0，但由调用方决定是否影响整体任务（默认视为非致命）。
 */
import fs from 'node:fs';
import { feishuConfig, sendInteractiveCard } from '../feishu-reports/feishu-api.mjs';

const TO = feishuConfig().to;
const DEFAULT_TITLE = '夸克资源同步 · 补全与兜底补充汇报';

const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const dry = args.includes('--dry-run');
const input = opt('--input');
if (!input) {
  console.error('用法: node tools/quark-cron/notify-followup.mjs --input <payload.json> [--dry-run]');
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`找不到 payload 文件: ${input}`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const sections = Array.isArray(data.sections) ? data.sections : [];
const hasContent = sections.some((s) => Array.isArray(s.items) && s.items.length);
if (!hasContent) {
  console.error('payload 无任何 sections.items，拒绝发送空补充卡');
  process.exit(2);
}

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
let when = data.time ? new Date(data.time) : new Date();
if (Number.isNaN(when.getTime())) when = new Date();

const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const elements = [md(`**补充汇报时间：** ${fmtTime(when)}`), hr()];

let count = 0;
for (const s of sections) {
  const items = Array.isArray(s.items) ? s.items : [];
  if (!items.length) continue;
  // label 自带「（N）」时不重复追加计数（自动化任务常按人数写标题）
  const rawLabel = String(s.label || '').trim();
  const label = /（\d+）$/.test(rawLabel) ? rawLabel : `${rawLabel}（${items.length}）`;
  const lines = [`**${label}**`];
  for (const it of items) {
    count += 1;
    const nm = it.site ? `[${it.name || it.id || '（未命名）'}](${it.site})` : String(it.name || it.id || '（未命名）');
    lines.push(`· ${it.id ? `${it.id} ` : ''}${nm}${it.note ? ` — ${it.note}` : ''}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}
if (data.footer) {
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: String(data.footer) }] });
}

const card = {
  config: { wide_screen_mode: true },
  header: {
    template: 'green',
    title: { tag: 'plain_text', content: String(data.title || '').trim() || DEFAULT_TITLE },
  },
  elements,
};
const payload = JSON.stringify(card);

if (dry) {
  console.log(payload);
  console.log(`\n[dry-run] 补充汇报 ${count} 条 ｜ ${sections.filter((s) => (s.items || []).length).length} 段，接收人 ${TO}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const idem = opt('--idempotency-key', `wdp-followup-${stamp}`);
try {
  const mid = await sendInteractiveCard(JSON.parse(payload), { to: TO, idempotencyKey: idem });
  console.log(`[飞书] ✓ 补充汇报 ${count} 条已推送 (message_id ${mid || 'unknown'})`);
} catch (e) {
  console.error('[发送失败]', String(e.message || e).slice(0, 600));
  process.exit(1);
}
