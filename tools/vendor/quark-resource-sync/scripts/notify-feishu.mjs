#!/usr/bin/env node
/**
 * 把一轮同步结果以飞书「卡片（interactive）」推送给将军（bot 身份 P2P）。
 *
 * 2026-11-08 改版：从「富文本 post」换成蓝色卡片（仿「院采雷达 · 采集简报」样式）。
 *  - 标题只出现在卡片蓝色头部一次，不再在正文里重复。
 *  - 新增两段：`skipped`（本轮未入库资源 + 原因）、`reconcile`（各分类「站点条目数 / 网盘最大编号」对账）。
 *
 * 用法：
 *   node scripts/notify-feishu.mjs --input <payload.json> [--dry-run]
 *
 * payload.json 结构：
 *   {
 *     "title":   "夸克资源同步任务简报",              // 可选，卡片标题；不填用默认值
 *     "time":    "2026-11-08 13:25",                  // 可选，同步时间；不填取本机当前时间
 *     "groups":  [                                     // 必填，本轮已入库资源，按分类
 *       { "label": "🎬 电影",
 *         "items": [ { "id": "mv-430",
 *                      "name": "生化危机：爆发夜",
 *                      "quark": "https://pan.quark.cn/s/xxxx",
 *                      "site":  "https://www.wodewangpan.top/movie/mv-430/" } ] }
 *     ],
 *     "skipped":  [                                    // 可选，本轮未入库 / 需人工跟进
 *       { "name": "某未识别目录", "reason": "unknown_category：站点无对应分类" }
 *     ],
 *     "reconcile": [                                   // 本轮有入库时必填（缺了脚本会告警）
 *       { "cat": "🎬 电影", "site": 428, "max": 430 } // max=网盘最大编号；脚本自动算差值
 *     ],
 *     "footer":  "commit 6a12ca3 ｜ 构建 904 资源 ｜ 冒烟 9/9 ｜ 已推送 GitHub ｜ 已上线"
 *   }
 *
 * 说明：
 *  - 接收人默认 config.env / 环境变量 FEISHU_TO（open_id）；未配置则用内置默认值。
 *  - lark-cli 是 sh 包装脚本，Windows 下不能直接 CreateProcess，故直接调其底层
 *    node + run.js。
 *  - 发送失败返回非 0，调用方自行决定是否致命（同步流程里视为非致命）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SKILL, HOME, TMP } from './lib/config.mjs';

/** 将军的 open_id（本应用内）；可用 config.env / 环境变量 FEISHU_TO 覆盖 */
const DEFAULT_TO = 'ou_5c0d1b0b62e3bef0ffa84b7b496c18f5';
const DEFAULT_TITLE = '夸克资源同步任务简报';

function readEnvFile() {
  const file = path.join(SKILL, 'config.env');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
      .filter(Boolean)
  );
}

const envFile = readEnvFile();
const TO = (process.env.FEISHU_TO || envFile.FEISHU_TO || '').trim() || DEFAULT_TO;

/** lark-cli 底层 run.js 自动探测（workbuddy / codebuddy 都认；沙箱用 statSync 判存在） */
function detectRunJs() {
  const roots = ['.workbuddy', '.codebuddy'];
  for (const r of roots) {
    const p = path.join(HOME, r, 'binaries', 'node', 'cli-connector-packages', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
    try { fs.statSync(p); return p; } catch {}
  }
  return '';
}

const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const dry = args.includes('--dry-run');
const input = opt('--input');
if (!input) {
  console.error('用法: node scripts/notify-feishu.mjs --input <payload.json> [--dry-run]');
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`找不到 payload 文件: ${input}`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const title = String(data.title || '').trim() || DEFAULT_TITLE;
const groups = Array.isArray(data.groups) ? data.groups : [];
const skipped = Array.isArray(data.skipped) ? data.skipped : [];
const reconcile = Array.isArray(data.reconcile) ? data.reconcile : [];

// ---- 缺段自检（2026-11-16 新增）-------------------------------------------
// 指挥官点名要看的两段（skipped / reconcile）过去是可选项，payload 漏给就静默不渲染，
// 导致 2026-11-09 起多轮简报悄悄丢掉「编号对账」。这里改成有入库就必检：
// reconcile 缺失一律告警；skipped 只在真没异常时可省，故仅在缺 reconcile 时顺带提示。
const hasNew = groups.some((g) => Array.isArray(g.items) && g.items.length > 0);
if (hasNew && !reconcile.length) {
  console.warn('[飞书] ⚠ 本轮有入库但 payload 缺 reconcile（编号对账），卡片不会渲染这一段。');
  console.warn('       请按 SKILL.md 第 9 步补：每个有变动的分类给 { cat, site（data/<分类>.yaml 条目数）, max（网盘该分类最大编号）}。');
  if (!skipped.length) console.warn('       同时缺 skipped（未入库及原因）：本轮若无异常才可省。');
}

// ---- 时间行（本地时区）-----------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
let when = data.time ? new Date(data.time) : new Date();
if (Number.isNaN(when.getTime())) when = new Date();
const timeStr = fmtTime(when);

// ---- 组装卡片元素（lark_md 文本，一段一个 div）-----------------------------
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const elements = [];

elements.push(md(`**同步时间：** ${timeStr}`));
elements.push(hr());

// 本轮已入库
let count = 0;
for (const g of groups) {
  const items = Array.isArray(g.items) ? g.items : [];
  if (!items.length) continue;
  const lines = [`**${String(g.label || '').trim()}（${items.length}）**`];
  for (const it of items) {
    count += 1;
    const link = it.site ? `[${it.name}](${it.site})` : String(it.name || '');
    const qk = it.quark ? ` · [夸克](${it.quark})` : '';
    lines.push(`${it.id} ${link}${qk}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 编号对账：站点条目数 vs 网盘最大编号（排在「未入库」之前）
if (reconcile.length) {
  const lines = ['**📊 编号对账（站点 / 网盘最大编号）**'];
  for (const r of reconcile) {
    const site = Number(r.site);
    const max = Number(r.max);
    let flag = '';
    if (Number.isFinite(site) && Number.isFinite(max)) {
      if (site === max) flag = ' ✅';
      else if (max > site) flag = ` ⚠️ 差 ${max - site}（网盘有空洞或站点缺条目）`;
      else flag = ` ⚠️ 站点多 ${site - max}（网盘目录少于条目）`;
    }
    lines.push(`· ${r.cat}：${r.site} / ${r.max}${flag}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 未入库 / 需人工跟进（固定放在最后一段）
if (skipped.length) {
  const lines = [`**⚠️ 未入库 · 需人工跟进（${skipped.length}）**`];
  for (const s of skipped) {
    const nm = s.name || s.id || '（未命名）';
    const reason = s.reason || s.kind || '未说明原因';
    lines.push(`· ${nm} — ${reason}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// footer
if (data.footer) {
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: String(data.footer) }] });
}

const card = {
  config: { wide_screen_mode: true },
  header: {
    template: 'blue',
    title: { tag: 'plain_text', content: title },
  },
  elements,
};

const payload = JSON.stringify(card);

if (dry) {
  console.log(payload);
  console.log(`\n[dry-run] 入库 ${count} 条 ｜ 未入库 ${skipped.length} 条 ｜ 对账 ${reconcile.length} 类，接收人 ${TO}`);
  process.exit(0);
}

// ---- 发送 ------------------------------------------------------------------
const runJs = detectRunJs();
if (!runJs) {
  console.error('未找到 lark-cli 底层 run.js，无法发送');
  process.exit(3);
}

// 内容走 @file 传参：避免超长命令行，也便于降级时手工重放
const contentFile = path.join(TMP, `feishu-card-${Date.now()}.json`);
fs.writeFileSync(contentFile, payload, 'utf8');

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `quark-sync-${stamp}`);
const cliArgs = [
  runJs, 'im', '+messages-send',
  '--as', 'bot', '--user-id', TO,
  '--msg-type', 'interactive', '--content', `@${contentFile}`,
  '--idempotency-key', idem,
];

// 同步 sleep（无需 async）
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let r;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  r = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  if (!r.error) break; // 进程起来了（成功或业务报错都算）
  if (!['EBUSY', 'ETXTBSY', 'EAGAIN', 'EPERM'].includes(r.error.code)) break;
  if (attempt < 3) nap(1500 * attempt);
}

if (r.error) {
  console.error(`[发送失败] 无法启动子进程：${r.error.code} ${r.error.message}`);
  console.error('内容已落盘，可在 shell 里直接重放（一级进程一般不受限）：');
  console.error(`  node "${runJs}" im +messages-send --as bot --user-id ${TO} --msg-type interactive --content "@${contentFile}" --idempotency-key ${idem}`);
  process.exit(4);
}

if (r.status !== 0) {
  const detail = String(r.stderr || r.stdout || '').trim() || `退出码 ${r.status}`;
  console.error('[发送失败]', detail.slice(0, 600));
  process.exit(r.status || 1);
}

let mid = '';
try {
  mid = JSON.parse(r.stdout).data?.message_id || '';
} catch {
  mid = (r.stdout.match(/om_[A-Za-z0-9]+/) || [''])[0];
}
console.log(`[飞书] ✓ 已推送 ${count} 条 (message_id ${mid || 'unknown'})`);
