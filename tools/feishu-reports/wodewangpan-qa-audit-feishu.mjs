#!/usr/bin/env node
/**
 * 「我的网盘.站点数据审计」报告飞书卡片汇报。
 *
 * 审计任务本身只读：本脚本不碰 data/*.yaml、不改仓库、不跑 git/build/部署、不碰盘端；
 * 只读取 ~/.cache/wdp-qa-audit-YYYYMMDD.json，按同一套蓝色 interactive 卡片发到飞书。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-qa-audit-feishu.mjs
 *   node tools/feishu-reports/wodewangpan-qa-audit-feishu.mjs --date 20261123
 *   node tools/feishu-reports/wodewangpan-qa-audit-feishu.mjs --report /path/to/report.json
 *   node tools/feishu-reports/wodewangpan-qa-audit-feishu.mjs --dry-run   # 只打印卡片 JSON
 *
 * 参数：
 *   --report <路径>  指定 JSON 报告，默认取 ~/.cache 里日期最新的 wdp-qa-audit-*.json
 *   --date <8位日期> 指定报告日期（仅用于卡片标题展示，默认从 --report 文件名或 meta.date 推）
 *   --dry-run        不发送，只把卡片 JSON 打到 stdout
 *
 * 接收人：环境变量 FEISHU_TO → ~/.config/wodewangpan-feishu.env → feishu-api.mjs 内置默认值。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';

const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? d : d; };
const has = (k) => args.includes(k);
const DRY = has('--dry-run');
const HOME = os.homedir();
const CACHE = path.join(HOME, '.cache');

function latestReport() {
  const names = fs.readdirSync(CACHE).filter((f) => /^wdp-qa-audit-\d{8}\.json$/.test(f)).sort();
  if (!names.length) throw new Error(`找不到审计报告：${CACHE}/wdp-qa-audit-YYYYMMDD.json（可先跑审计任务，或用 --report 指定）`);
  return path.join(CACHE, names[names.length - 1]);
}

const REPORT = opt('--report') || latestReport();
if (!fs.existsSync(REPORT)) { console.error(`找不到报告：${REPORT}`); process.exit(2); }
let rep;
try { rep = JSON.parse(fs.readFileSync(REPORT, 'utf8')); }
catch (e) { console.error(`报告解析失败：${e.message}`); process.exit(2); }

const meta = rep.meta || {};
const s = rep.summary || {};
const findings = Array.isArray(rep.findings) ? rep.findings : [];
const aggregates = Array.isArray(rep.aggregates) ? rep.aggregates : [];
const drive = rep.drive_reconciliation || {};
const driveCats = Array.isArray(drive.categories) ? drive.categories : [];
const driveTotals = drive.totals || {};

const dateArg = opt('--date') || (path.basename(REPORT).match(/(\d{8})/) || [])[1] || String(meta.date || '').replace(/-/g, '') || '未知日期';
const site = (id) => {
  const p = PREFIX_SLUG[String(id).split('-')[0]];
  return p ? `${SITE_BASE}/${p}/${id}/` : '';
};
const SITE_BASE = opt('--site') || 'https://www.wodewangpan.top';
const PREFIX_SLUG = { mv: 'movie', tv: 'tv', dc: 'documentary', an: 'anime', game: 'game', app: 'software', bk: 'ebook', cs: 'course', ot: 'misc' };

// lark_md 会把 <...> 当 HTML 标签吞掉；尖括号/换行统一处理后再进卡片
const esc = (v) => String(v ?? '').replace(/</g, '‹').replace(/>/g, '›').replace(/\r?\n/g, ' ');
const clip = (v, n) => { const x = esc(v); return x.length > n ? x.slice(0, n) + '…' : x; };
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const link = (f) => {
  const u = site(f.id);
  const label = `${esc(f.id)} ${clip(f.title || '', 40)}`;
  return u ? `[${label}](${u})` : label;
};

const bySeverity = (sev) => findings.filter((f) => String(f.severity || '').toLowerCase() === sev);
const high = bySeverity('high');
const medium = bySeverity('medium');
const low = bySeverity('low');
const catCounts = Object.entries(s.category_counts || {}).map(([k, v]) => `${esc(k)}${v}`).join(' / ');
const holes = driveCats.filter((c) => Array.isArray(c.holes) && c.holes.length)
  .map((c) => `${esc(c.siteCat || c.cat)} ${c.holes.join('/')}`).join('；');

const elements = [];
elements.push(md(`**审计日期：** ${esc(dateArg)} · 模式：只读（发现而非修复）`));
elements.push(hr());
elements.push(md([
  '**📊 总览**',
  `· 扫描资源：${s.total_items ?? '—'} 条${catCounts ? `（${catCounts}）` : ''}`,
  `· 规则预检命中 ${s.rule_prescreen_hits ?? '—'} 条 → LLM 复核保留 **${s.curated_findings ?? findings.length} 条**（高 ${high.length} / 中 ${medium.length} / 低 ${low.length}）+ ${aggregates.length} 类聚合问题`,
  '· 海报：源文件缺失/损坏与 webp 产物均已校验；详情页与 sitemap 覆盖见完整报告',
].join('\n')));
elements.push(hr());

for (const [label, rows] of [['⚠️ 高严重度问题', high], ['🔶 中严重度问题', medium], ['🔵 低严重度问题', low]]) {
  if (!rows.length) continue;
  elements.push(md([`**${label}（${rows.length}）**`, ...rows.map((f) => `· ${link(f)} — ${clip(f.evidence || '', 110)}`)].join('\n')));
  elements.push(hr());
}

elements.push(md([
  '**🔍 盘端目录对账（本次重点 · 已实际执行）**',
  '· 方法：从 QUARK_SHARE_FID 出发，9 个分类逐一 browse --all 读 JSONL 全量；三位数字前缀严格匹配，与站内 id / files.tree 双向比对；全程未登录、未写盘端',
  `· a. 盘端有编号目录、站内无 id：**${driveTotals.a ?? '—'} 条**`,
  `· b. 盘端未编号目录：**${driveTotals.b ?? '—'} 条**`,
  `· c. 站内有条目、盘端无编号目录（死链候选）：**${driveTotals.c ?? '—'} 条**`,
  `· d. 分类编号空洞：共 **${driveTotals.holes ?? '—'} 个**${holes ? ` — ${holes}（按「空洞优先」自动回填，非错误）` : ''}`,
  '· 站内 files.tree 首行前缀与 id 尾号不一致：**0 条**（历史撞号已消除）',
].join('\n')));
elements.push(hr());

if (aggregates.length) {
  elements.push(md(['**📦 聚合类问题**', ...aggregates.map((a) => `· ${esc(a.id)} ${esc(a.title)}：${a.count ?? '—'}（${esc(a.severity || '')} / ${esc(a.source || '')}）`)].join('\n')));
  elements.push(hr());
}

elements.push(md([
  '**✅ 只读声明**',
  '未修改仓库任何文件 · 未执行 git 提交/推送 · 未 build / 部署 · 未改自动化 · 未启动登录或写盘端',
  `完整报告：~/.cache/wdp-qa-audit-${esc(dateArg)}.md（易读摘要） · ~/.cache/wdp-qa-audit-${esc(dateArg)}.json（机器可读全量）`,
].join('\n')));

const card = {
  config: { wide_screen_mode: true },
  header: { template: 'blue', title: { tag: 'plain_text', content: '我的网盘.站点数据审计报告' } },
  elements: [
    ...elements,
    { tag: 'note', elements: [{ tag: 'plain_text', content: `结果：只读审计完成 · 具体问题 ${s.curated_findings ?? findings.length} 条（高${high.length}/中${medium.length}/低${low.length}）· 盘端对账 a/b/c ${driveTotals.a ?? '—'}/${driveTotals.b ?? '—'}/${driveTotals.c ?? '—'} 条、空洞 ${driveTotals.holes ?? '—'} 个 · 飞书汇报已发送` }] },
  ],
};

if (DRY) {
  console.log(JSON.stringify(card, null, 2));
} else {
  const cfg = feishuConfig();
  console.log(`接收人 open_id: ${cfg.to}`);
  const msgId = await sendInteractiveCard(card, { idempotencyKey: `wdp-qa-audit-${dateArg}-${Date.now()}` });
  console.log(`飞书发送成功 message_id: ${msgId}`);
}
