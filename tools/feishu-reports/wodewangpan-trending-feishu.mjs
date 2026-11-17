#!/usr/bin/env node
/**
 * 「我的网盘.TMDB今日热门同步」（trending-sync.mjs）跑完后的飞书汇报。
 *
 * 版式与「夸克资源同步任务简报」「我的网盘.资源文件清单补齐简报」同一套蓝色 interactive 卡片：
 * 标题只在蓝色头部出现一次 → 同步时间 → 按分类的入库清单 → 📊 编号对账
 * → ⚠️ 未入库 · 需人工跟进（放最后，没有异常就不渲染）→ 底部 note 状态行。
 *
 * 与旧写法的区别：卡片内容**全部从真实数据拼**，不再让 agent 手写 payload JSON——
 *   - 标题 / 分类 / 夸克链接取自 trending-sync 的机读报告 trending-last.json；
 *   - 详情页链接按 id 生成；补位改写、补空洞的标注取自报告里的 number_kind；
 *   - 编号对账（站点条目 / 站内最大编号）扫仓库 data/*.yaml 现算；
 *   - 未入库段直接取报告的 skipped / errors，正常顺延与需要人工处理的分开标。
 * 这样 agent 只需要补三件它才知道的事实：冒烟结果、VPS 发布结果、额外的人工跟进项。
 *
 * 用法：
 *   node C:/Users/marco/Scripts/wodewangpan-trending-feishu.mjs \
 *     --status 成功 --smoke 12/12 --deploy "VPS 发布完成 441af38" \
 *     [--follow "某条 — 原因"] [--dry-run]
 *
 * 参数：
 *   --report <路径>   trending-sync 机读报告，默认 C:/Users/marco/.workbuddy/quark-sync-cache/trending-last.json
 *   --repo <路径>     站点仓库，默认 C:/Users/marco/Github/wodewangpan
 *   --status <文本>   note 状态行首项，默认取报告结果自动判定（成功 / 部分成功 / 无新增）
 *   --smoke <文本>    本地冒烟结果，如「12/12」；不传则该段不出现
 *   --deploy <文本>   VPS 发布结果，如「VPS 发布完成 441af38」或「VPS 重建失败：ssh 超时」
 *   --commit <hash>   覆盖 commit hash（默认从报告的 publish.commit 取）
 *   --detail <文本>   note 状态行追加内容
 *   --follow <文本>   额外的人工跟进项，多条用全角｜分隔，接在报告 skipped 之后
 *   --time <文本>     覆盖同步时间（默认取报告 ran_at）
 *   --title <文本>    卡片蓝色头部标题，默认「我的网盘.TMDB今日热门同步简报」
 *   --per-day / --no-reconcile  关掉编号对账段
 *   --dry-run         只打印卡片 JSON
 *
 * 接收人：环境变量 FEISHU_TO → quark-resource-sync config.env → 内置默认值。
 * 百度链路已于 2026-11-08 停止，卡片不出现任何百度相关字段。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? d : d; };
const has = (k) => args.includes(k);

const REPO = opt('--repo', 'C:/Users/marco/Github/wodewangpan');
const REPORT = opt('--report', path.join(HOME, '.workbuddy', 'quark-sync-cache', 'trending-last.json'));
const TITLE = opt('--title', '我的网盘.TMDB今日热门同步简报');
// 站点域名前缀；详情页按 id 前缀拼 /<slug>/<id>/（2026-11-15 起全站 URL 带分类，/resource/ 已成历史）
const SITE_BASE = opt('--site', 'https://www.wodewangpan.top');

/** id 前缀 → 分类 slug（与站点 config/site.yaml 的 slugs、skill 的 site-paths.mjs 同一张表） */
const PREFIX_SLUG = {
  mv: 'movie', tv: 'tv', dc: 'documentary', an: 'anime', game: 'game',
  app: 'software', bk: 'ebook', cs: 'course', ot: 'misc',
};

function siteUrl(id) {
  const slug = PREFIX_SLUG[String(id).split('-')[0]] || '';
  return slug ? `${SITE_BASE}/${slug}/${id}/` : `${SITE_BASE}/resource/${id}/`;
}
const DEFAULT_TO = 'ou_5c0d1b0b62e3bef0ffa84b7b496c18f5';

const EMOJI = { 电影: '🎞', 电视剧: '📺', 动漫: '🎌', 纪录片: '🎬', 游戏: '🎮', 软件: '💻', 电子书: '📚', 操作系统: '🖥', 课程: '🎓', 其他: '📦' };
/** trending-sync 的 kind → 站点分类 / 数据文件 / id 前缀 */
const KIND = { movie: { cat: '电影', file: 'movie.yaml', prefix: 'mv' }, tv: { cat: '电视剧', file: 'tv.yaml', prefix: 'tv' }, anime: { cat: '动漫', file: 'anime.yaml', prefix: 'an' } };

function readFeishuTo() {
  let raw = '';
  try { raw = fs.readFileSync(path.join(HOME, '.workbuddy', 'skills', 'quark-resource-sync', 'config.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i >= 0 && t.slice(0, i).trim() === 'FEISHU_TO') return t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
const TO = (process.env.FEISHU_TO || readFeishuTo() || '').trim() || DEFAULT_TO;

// ---------- 读 trending-sync 报告 ------------------------------------------------
if (!fs.existsSync(REPORT)) { console.error(`找不到 trending-sync 报告：${REPORT}（可先跑 trending-sync.mjs 或用 --report 指定）`); process.exit(2); }
let rep;
try { rep = JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch (e) { console.error(`报告解析失败：${e.message}`); process.exit(2); }

const createdAll = Array.isArray(rep.created) ? rep.created : [];
const created = createdAll.filter((r) => r.status === 'ok');
const failed = createdAll.filter((r) => r.status && r.status !== 'ok');
const skipped = Array.isArray(rep.skipped) ? rep.skipped : [];
const errors = Array.isArray(rep.errors) ? rep.errors : [];
const pub = rep.publish || {};

// ---------- 扫 data/*.yaml 做编号对账 --------------------------------------------
function reconcileFor(file, prefix) {
  const p = path.join(REPO, 'data', file);
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  const nums = [...raw.matchAll(new RegExp(`^- id: ${prefix}-(\\d+)`, 'gm'))].map((m) => Number(m[1]));
  if (!nums.length) return null;
  const uniq = [...new Set(nums)];
  const min = Math.min(...uniq);
  const max = Math.max(...uniq);
  const set = new Set(uniq);
  const missing = [];
  for (let n = min; n <= max; n++) if (!set.has(n)) missing.push(n);
  // 编号起点不是 001 时，min 之前不算空洞，但要在卡片上说明
  return { count: uniq.length, max, min, missing, dup: nums.length - uniq.length };
}

// ---------- 时间行 --------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
let when = rep.ran_at ? new Date(rep.ran_at) : new Date();
if (opt('--time')) when = new Date(opt('--time'));
if (Number.isNaN(when.getTime())) when = new Date();

// ---------- 组装卡片 -------------------------------------------------------------
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });
const elements = [];

elements.push(md(`**同步时间：** ${opt('--time') || fmt(when)}`));
elements.push(hr());

// 本轮入库清单（按分类分组，编号升序）
const byKind = new Map();
for (const r of created) { if (!byKind.has(r.kind)) byKind.set(r.kind, []); byKind.get(r.kind).push(r); }
for (const [kind, list] of byKind) {
  const meta = KIND[kind] || { cat: kind };
  const items = list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  const lines = [`**${EMOJI[meta.cat] || '📦'} ${meta.cat}（${items.length}）**`];
  for (const it of items) {
    const mark = it.number_kind === 'reclaim' ? '（补位改写）' : it.number_kind === 'hole' ? '（补空洞）' : '';
    const name = String(it.title || it.id || '').replace(/\*\*/g, '');
    const site = it.id ? siteUrl(it.id) : '';
    const link = site ? `[${name}](${site})${mark}` : `${name}${mark}`;
    lines.push(`${it.id || '—'} ${link}${it.quark_url ? ` · [夸克](${it.quark_url})` : ''}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 编号对账（站点条目 / 站内最大编号）
if (!has('--no-reconcile')) {
  const lines = ['**📊 编号对账（站点条目 / 站内最大编号）**'];
  for (const kind of ['movie', 'tv', 'anime']) {
    const meta = KIND[kind];
    const rc = reconcileFor(meta.file, meta.prefix);
    if (!rc) continue;
    let flag = ' ✅ 编号连续';
    if (rc.missing.length) flag = ` ⚠️ 空洞 ${rc.missing.length} 处${rc.missing.length <= 8 ? `（${rc.missing.join('、')}）` : ''}`;
    if (rc.dup) flag += ` ⚠️ 重复 id ${rc.dup} 个`;
    const start = rc.min === 1 ? '' : `（编号自 ${rc.min} 起）`;
    lines.push(`· ${EMOJI[meta.cat]} ${meta.cat}：${rc.count} / ${rc.max}${start}${flag}`);
  }
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 未入库 · 需人工跟进：报告 skipped + errors + 本轮失败 + --follow，固定最后一段
// 「年份窗口外」= 2026-11-10 起 trending-sync 的滚动 N 个月内容日期窗口挡掉的今日热门，
// 属设计内的正常顺延（老片回潮不再入库），不是异常，所以进白名单。
// 「节目类（」= 2026-11-11 起的脱口秀 / 真人秀 / 新闻黑名单挡掉的今日热门，同样是设计内顺延。
const BENIGN = /^(已同步过|该季已同步过|站内已有|无中文译名|动画（|年份窗口外|节目类（)/;
const follow = [];
for (const s of skipped) {
  const reason = String(s.reason || '未说明原因');
  follow.push(`${BENIGN.test(reason) ? '↷ 正常顺延 · ' : '⚠ 需人工看 · '}${s.title || s.tmdb_id || '（未命名）'} — ${reason}`);
}
for (const r of failed) follow.push(`⚠ 建目录/入库失败 · ${r.title || r.id || '（未命名）'} — ${r.error || r.status || '未说明'}`);
for (const e of errors) follow.push(`⚠ 报错 · ${typeof e === 'string' ? e : (e.title || e.message || JSON.stringify(e)).slice(0, 120)}`);
const extra = opt('--follow');
if (extra) for (const s of extra.split(/[｜|]/).map((x) => x.trim()).filter(Boolean)) follow.push(s);
if (follow.length) {
  const lines = [`**⚠️ 未入库 · 需人工跟进（${follow.length}）**`];
  for (const f of follow) lines.push(`· ${f}`);
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 底部 note 状态行（note 是 plain_text，不能放 markdown 星号）
const commitHash = (opt('--commit') || (String(pub.commit || '').match(/^[0-9a-f]{7,40}/) || [''])[0]) || '';
let status = opt('--status');
if (!status) status = created.length ? (failed.length || errors.length ? '部分成功' : '成功') : '无新增';
const footer = [`结果：${status}`, `新建并入库 ${created.length} 条`, `顺延/未入库 ${skipped.length} 条`];
if (commitHash) footer.push(`commit ${commitHash}`);
if (pub.build) footer.push(`构建 ${String(pub.build).replace(/^完成：/, '')}`);
if (pub.push) footer.push(/失败/.test(String(pub.push)) ? `GitHub 推送失败` : '已推送 GitHub');
if (opt('--smoke')) footer.push(`冒烟 ${opt('--smoke')}`);
if (opt('--deploy')) footer.push(opt('--deploy'));
if (opt('--detail')) footer.push(opt('--detail'));
footer.push('www.wodewangpan.top');
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footer.join(' ｜ ') }] });

const card = { config: { wide_screen_mode: true }, header: { template: 'blue', title: { tag: 'plain_text', content: TITLE } }, elements };
const payload = JSON.stringify(card);

console.log(payload);
console.log(`\n[摘要] 入库 ${created.length} 条 ｜ 顺延/未入库 ${skipped.length} 条 ｜ 失败 ${failed.length} ｜ 跟进段 ${follow.length} 行 ｜ ran_at ${fmt(when)}`);
if (has('--dry-run')) { console.log('[dry-run] 未发送'); process.exit(0); }

// ---------- 发送（与 fill-files 卡片同一套：底层 node + lark-cli run.js）----------
function detectRunJs() {
  for (const r of ['.workbuddy', '.codebuddy']) {
    const p = path.join(HOME, r, 'binaries', 'node', 'cli-connector-packages', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
    try { fs.statSync(p); return p; } catch {}
  }
  return '';
}
const runJs = detectRunJs();
if (!runJs) { console.error('未找到 lark-cli 底层 run.js，无法发送'); process.exit(3); }
const contentFile = path.join(os.tmpdir(), `feishu-trending-card-${Date.now()}.json`);
fs.writeFileSync(contentFile, payload, 'utf8');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `trending-sync-${stamp}`);
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
if (r.status !== 0) { console.error('[发送失败]', (String(r.stderr || r.stdout || '').trim() || `退出码 ${r.status}`).slice(0, 600)); process.exit(r.status || 1); }
let mid = '';
try { mid = JSON.parse(r.stdout).data?.message_id || ''; } catch { mid = (String(r.stdout).match(/om_[A-Za-z0-9]+/) || [''])[0]; }
console.log(`[飞书] ✓ 已推送 TMDB 同步简报卡片 (message_id ${mid || 'unknown'}) ｜ 入库 ${created.length} 条 ｜ 跟进 ${follow.length} 行`);
