#!/usr/bin/env node
/**
 * 「我的网盘.夸克分享更新每日补存」任务的飞书汇报。
 *
 * 蓝色 interactive 卡片（与「预存资源搬运简报」「资源文件清单补齐简报」同一套版式）：
 *   蓝色头部标题一次 → 更新时间 → 本轮更新的资源目录 → 需人工跟进 → 底部 note 结果行。
 *
 * 发送通道：lark-cli 以 bot 身份发 interactive 卡片，当前绑定应用为
 *   「我的网盘」cli_aa56dbd9dab8dd0f，接收人默认该应用内将军的 open_id
 *   ou_5c0d1b0b62e3bef0ffa84b7b496c18f5（可用 FEISHU_TO 覆盖）。
 *   lark-cli 是 sh 包装脚本，Windows 下不能直接 CreateProcess，故走底层 node + run.js。
 *
 * 用法：
 *   node C:/Users/marco/Scripts/wodewangpan-share-update-feishu.mjs --input <payload.json> [--dry-run]
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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const has = (k) => args.includes(k);

const DEFAULT_TITLE = '我的网盘.夸克分享每日补充更新简报';
const DEFAULT_TO = 'ou_5c0d1b0b62e3bef0ffa84b7b496c18f5';

function readFeishuTo() {
  const file = path.join(HOME, '.workbuddy', 'skills', 'quark-resource-sync', 'config.env');
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    if (t.slice(0, i).trim() === 'FEISHU_TO') return t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
const TO = (process.env.FEISHU_TO || readFeishuTo() || '').trim() || DEFAULT_TO;

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

function detectRunJs() {
  for (const r of ['.workbuddy', '.codebuddy']) {
    const p = path.join(HOME, r, 'binaries', 'node', 'cli-connector-packages', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
    try { fs.statSync(p); return p; } catch {}
  }
  return '';
}
const runJs = detectRunJs();
if (!runJs) {
  console.error('未找到 lark-cli 底层 run.js，无法发送');
  process.exit(3);
}

const contentFile = path.join(os.tmpdir(), `feishu-share-update-card-${Date.now()}.json`);
fs.writeFileSync(contentFile, payload, 'utf8');

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `share-update-${stamp}`);
const cliArgs = [runJs, 'im', '+messages-send', '--as', 'bot', '--user-id', TO,
  '--msg-type', 'interactive', '--content', `@${contentFile}`, '--idempotency-key', idem];

const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let r;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  r = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  if (!r.error) break;
  if (!['EBUSY', 'ETXTBSY', 'EAGAIN', 'EPERM'].includes(r.error.code)) break;
  if (attempt < 3) nap(1500 * attempt);
}
if (r.error) {
  console.error(`[发送失败] 无法启动子进程：${r.error.code} ${r.error.message}`);
  console.error('内容已落盘，可在 shell 里直接原样重放（一级进程一般不受限）：');
  console.error(`  node "${runJs}" im +messages-send --as bot --user-id ${TO} --msg-type interactive --content "@${contentFile}" --idempotency-key ${idem}`);
  process.exit(4);
}
if (r.status !== 0) {
  const detail2 = String(r.stderr || r.stdout || '').trim() || `退出码 ${r.status}`;
  console.error('[发送失败]', detail2.slice(0, 600));
  process.exit(r.status || 1);
}
let mid = '';
try { mid = JSON.parse(r.stdout).data?.message_id || ''; } catch { mid = (String(r.stdout).match(/om_[A-Za-z0-9]+/) || [''])[0]; }
console.log(`[飞书] ✓ 已推送分享更新简报卡片 (message_id ${mid || 'unknown'}) ｜ 更新 ${dirs.length} 条目录 ｜ 状态 ${status}`);
