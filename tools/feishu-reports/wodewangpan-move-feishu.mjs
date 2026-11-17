#!/usr/bin/env node
/**
 * 「我的网盘.夸克预存资源搬运」任务的飞书汇报。
 *
 * 蓝色 interactive 卡片（与「我的网盘.TMDB今日热门同步简报」「我的网盘.资源文件清单补齐简报」同一套版式）：
 *   蓝色头部标题一次 → 搬运时间 → 搬运资源名称 → 跳过的分类摘要 → 底部 note 状态行。
 * 本任务把「预存资源」下 9 个分类目录的资源各搬 1 个到「SHARE」下对应分类，
 * 只搬目录、不碰站点仓库，所以脚本不读 data/*.yaml、不拼详情页/夸克链接，
 * 只把搬运到的目录名原样列出来（每条带 [目标分类名] 标签）。
 *
 * 用法：
 *   node C:/Users/marco/Scripts/wodewangpan-move-feishu.mjs \
 *     --names "[01游戏] 艾尔登法环｜[04电影] 某电影" \
 *     --status 部分成功 \
 *     --skipped "[02应用] 3 项重复，无新资源" \
 *     --detail "本轮搬运 7/9 类，源目录共剩 132 个"
 *
 * 参数：
 *   --names <文本>    本轮成功移入 SHARE 对应分类的资源目录名，多条用全角｜或半角|分隔；
 *                     建议每条写成「[目标分类名] 资源目录名」，名称本身不要含分隔符；
 *                     0 条时传一行说明（如「本轮 9 个分类均无可搬运的新资源」）。
 *   --status <文本>   底部结果标签，默认「成功」；也可「部分成功」「失败」「跳过」「未授权」「目录未找到」。
 *   --detail <文本>   底部补充（分类完成情况/剩余数量/失败原因等），可选。
 *   --skipped <文本>  本轮未搬运分类的跳过摘要（带分类标签），多条用｜分隔（可选；不传则卡片不出现该段）。
 *   --time <文本>     覆盖搬运时间（默认本机当前时间 YYYY-MM-DD HH:MM）。
 *   --title <文本>    卡片蓝色头部标题，默认「我的网盘.预存资源搬运简报」。
 *   --dry-run         只打印将要发送的卡片 JSON，不发送。
 *
 * 接收人：环境变量 FEISHU_TO → quark-resource-sync config.env → 内置默认值。
 * lark-cli 是 sh 包装脚本，Windows 下不能直接 CreateProcess，故走底层 node + run.js。
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

const TITLE = opt('--title', '我的网盘.预存资源搬运简报');
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

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = opt('--time') ||
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const status = opt('--status', '成功');
const detail = opt('--detail');

const nameRaw = opt('--names');
if (!nameRaw) {
  console.error('用法: 至少给 --names "<搬运到的目录名｜…>"（0 条时传一行说明）');
  process.exit(2);
}
const names = nameRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);

const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });

const elements = [];
elements.push(md(`**搬运时间：** ${timeStr}`));
elements.push(hr());

// 搬运资源名称
{
  const lines = [`**📦 搬运资源（${names.length}）**`];
  for (const n of names) lines.push(`· ${n}`);
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 未搬运分类的跳过摘要（可选，仅当传入 --skipped 时出现）
const skipRaw = opt('--skipped');
if (skipRaw) {
  const skips = skipRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (skips.length) {
    const lines = [`**↻ 跳过的分类（${skips.length}）**`];
    for (const s of skips) lines.push(`· ${s}`);
    elements.push(md(lines.join('\n')));
    elements.push(hr());
  }
}

// 底部状态行（note/plain_text 不渲染 markdown，这里不能加 **）
const footerParts = [`结果：${status}`, `资源 ${names.length} 条`];
if (detail) footerParts.push(detail);
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join(' ｜ ') }] });

const card = {
  config: { wide_screen_mode: true },
  header: { template: 'blue', title: { tag: 'plain_text', content: TITLE } },
  elements,
};
const payload = JSON.stringify(card);

if (has('--dry-run')) {
  console.log(payload);
  console.log(`\n[dry-run] 搬运 ${names.length} 条 ｜ 状态 ${status} ｜ 接收人 ${TO}`);
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
if (!runJs) { console.error('未找到 lark-cli 底层 run.js，无法发送'); process.exit(3); }

const contentFile = path.join(os.tmpdir(), `feishu-move-card-${Date.now()}.json`);
fs.writeFileSync(contentFile, payload, 'utf8');

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `prestore-move-${stamp}`);
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
console.log(`[飞书] ✓ 已推送搬运简报卡片 (message_id ${mid || 'unknown'}) ｜ 搬运 ${names.length} 条 ｜ 状态 ${status}`);
