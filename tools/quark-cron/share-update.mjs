#!/usr/bin/env node
/**
 * 我的网盘.夸克分享每日补充更新 —— Debian cron 自包含编排脚本
 *
 * 把原 WorkBuddy 自动化 prompt 里的判断逻辑固化为代码，纯 node + CLI，不依赖 LLM。
 * 流程：验登录 → 翻页拉更新清单并去重 → 逐条 saveas-update 增量转存 →
 *       get-share-saved-dir 核验是否补进历史目录（红线）→ 生成 payload → 飞书蓝标卡片。
 *
 * 用法：
 *   node tools/quark-cron/share-update.mjs --dry        # 只拉清单核验，不转存、不发卡（验 login/路径/翻页）
 *   node tools/quark-cron/share-update.mjs --no-send    # 照常转存，生成 payload 但不发飞书（联调用）
 *   node tools/quark-cron/share-update.mjs              # 正式：转存 + 发卡
 *
 * 环境变量（Debian 上按需覆盖，默认走 HOME 动态解析）：
 *   QK_SKILL_DIR      quarkclouddrive skill 根目录，默认 ~/.workbuddy/skills/quarkclouddrive
 *   QK_CACHE_DIR      中间文件目录，默认 ~/.cache/quark-sync
 *   QK_FEISHU_SCRIPT  飞书卡片脚本，默认本仓库 tools/feishu-reports/wodewangpan-share-update-feishu.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
// 2026-11-18 并入站点仓库：飞书脚本默认走仓库内副本，不再依赖本机 ~/Scripts/
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = process.env.QK_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'quarkclouddrive');
const CLI = path.join(SKILL, 'scripts', 'quark-drive.cjs');
const CACHE = process.env.QK_CACHE_DIR || path.join(HOME, '.cache', 'quark-sync');
const FEISHU = process.env.QK_FEISHU_SCRIPT || path.join(REPO, 'tools', 'feishu-reports', 'wodewangpan-share-update-feishu.mjs');
const LOGIN_STATE = path.join(SKILL, 'workbuddy', 'config.json');
const SI = '检查一下夸克网盘资源有没有更新，把每天新增的资源存放到对应的资源目录下，已经存过的就不用重复存了。';

const DRY = process.argv.includes('--dry');
const NO_SEND = process.argv.includes('--no-send');
const p2 = (n) => String(n).padStart(2, '0');
const t0 = new Date();
const stamp = `${t0.getFullYear()}${p2(t0.getMonth() + 1)}${p2(t0.getDate())}-${p2(t0.getHours())}${p2(t0.getMinutes())}`;
const sid = `${t0.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
fs.mkdirSync(CACHE, { recursive: true });

const log = (...a) => console.log(...a);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

// ---------- CLI 封装：统一带 session-input / session-id，cwd 固定在 skill 根目录 ----------
// 注意：CLI 需要 Agent 环境标识，否则服务端报 -104「无法识别当前 Agent 环境」。
// cron / 纯终端没有 WorkBuddy 注入的环境变量，这里显式补上（已在 Debian cron 场景验证）。
function cli(args, timeoutMs = 180000) {
  const r = spawnSync('node', [CLI, ...args, '--session-input', SI, '--session-id', sid], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, cwd: SKILL,
    env: { ...process.env, CLIENT_INFO_PRODUCT_NAME: process.env.CLIENT_INFO_PRODUCT_NAME || 'WorkBuddy' },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const rows = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { rows.push(JSON.parse(t)); } catch {}
  }
  return { rows, out, error: r.error ? String(r.error.message || r.error) : null, status: r.status };
}
const resultOf = (rows) => rows.filter((x) => x && x.type === 'result').pop() || null;

// ---------- 前置检查 ----------
if (!fs.existsSync(CLI)) die(`找不到 CLI：${CLI}（quarkclouddrive skill 未安装或路径不对，用 QK_SKILL_DIR 覆盖）`);
if (!fs.existsSync(LOGIN_STATE)) die(`找不到夸克登录态：${LOGIN_STATE}（请把本机的 workbuddy/config.json 拷过来）`);

const who = cli(['get-user-info']);
const whoRes = resultOf(who.rows);
if (who.error || !whoRes || whoRes.code !== 0) {
  die(`夸克登录态失效：${who.error || (whoRes && whoRes.msg) || '无返回'}。按 §6 发异常卡片后结束，不要启动登录流程。`);
}
log(`[登录] OK${whoRes.msg ? ' ' + whoRes.msg : ''}`);

// ---------- 1. 翻页拉全部更新清单，按 share_url 去重 ----------
const seen = new Set();
const candidates = [];
for (let page = 1; page <= 30; page++) {
  const { rows, error } = cli(['get-share-update-list', '--page', String(page)]);
  if (error) die(`更新清单第 ${page} 页失败：${error}`);
  for (const row of rows) {
    if (!row || row.type !== 'list') continue;
    const d = row.data || {};
    if (!d.share_url || seen.has(d.share_url)) continue;
    seen.add(d.share_url);
    candidates.push({ url: d.share_url, title: d.title || '', updated_at: d.updated_at || '' });
  }
  const res = resultOf(rows);
  log(`[清单] page=${page} 本页累计 ${candidates.length}${res && res.data ? ` has_next=${res.data.has_next_page}` : ''}`);
  if (!res || !res.data || res.data.has_next_page !== true) break;
}
fs.writeFileSync(path.join(CACHE, 'candidates.json'), JSON.stringify(candidates, null, 2), 'utf8');
log(`[清单] 去重后 ${candidates.length} 条有更新`);
if (!candidates.length) {
  log('本轮 0 条更新，按约定不发飞书、不写网盘、退出。');
  process.exit(0);
}
if (DRY) { log('[dry] 到清单为止，不转存、不发卡。'); process.exit(0); }

// ---------- 2. 逐条增量转存（幂等，只往历史目录补新增文件） ----------
const results = [];
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  const run = () => {
    const r = cli(['saveas-update', '--url', c.url], 900000);
    return { res: resultOf(r.rows), raw: r.out, error: r.error };
  };
  let a = run();
  let code = a.res ? a.res.code : null;
  let retried = false;
  // 确定性失败不重试：41043 未转存 / 41040 无更新 / 41006 分享不存在 /
  // 41009 分享文件已删除 / 41031 分享者封禁查看受限。其余瞬时错误最多重试 1 次。
  const NO_RETRY = new Set(['41043', '41040', '41006', '41009', '41031']);
  if (code !== 0 && !NO_RETRY.has(String(code))) {
    retried = true;
    a = run();
    code = a.res ? a.res.code : null;
  }
  const res = a.res || {};
  const data = res.data || {};
  const sa = data.save_as || {};
  results.push({
    url: c.url, title: c.title, updated_at: c.updated_at,
    code, msg: res.msg || '', notice: res.notice ? res.notice.text || '' : '',
    save_path: data.save_path || '',
    to_pdir_fid: sa.to_pdir_fid || '', to_pdir_name: sa.to_pdir_name || '',
    added: sa.save_as_sum_num == null ? null : Number(sa.save_as_sum_num),
    retried, error: a.error,
  });
  log(`[转存 ${i + 1}/${candidates.length}] ${c.title} => code=${code}${retried ? ' (retried)' : ''}`);
  fs.writeFileSync(path.join(CACHE, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
}

// ---------- 3. 核验：只认「补进历史转存目录」，疑似新建目录上报人工（资源目录红线） ----------
const ok = results.filter((r) => r.code === 0 && r.save_path);
const verify = [];
for (let i = 0; i < ok.length; i++) {
  const r = ok[i];
  const { rows } = cli(['get-share-saved-dir', '--url', r.url]);
  const res = resultOf(rows);
  const d = (res && res.data) || {};
  const fidMatch = !!d.pdir_fid && !!r.to_pdir_fid && String(d.pdir_fid) === String(r.to_pdir_fid);
  const nameMatch = !!d.pdir_name && !!r.to_pdir_name && d.pdir_name === r.to_pdir_name;
  const isExistingDir = fidMatch || nameMatch; // 既有目录名与分享标题不同也算正常补存
  verify.push({ ...r, pdir_fid: d.pdir_fid || '', pdir_name: d.pdir_name || '', fidMatch, nameMatch, isExistingDir });
  log(`[核验 ${i + 1}/${ok.length}] ${r.title} => existing=${isExistingDir}`);
}
fs.writeFileSync(path.join(CACHE, 'verify.json'), JSON.stringify(verify, null, 2), 'utf8');
const vmap = new Map(verify.map((v) => [v.url, v]));

// ---------- 4. 生成卡片 payload（msg 原样；41040 不算失败；硬编码 NEWLY_CREATED 已废弃，改用 isExistingDir） ----------
const dirs = [], skipped = [];
let noUpdate = 0;
for (const r of results) {
  if (String(r.code) === '41040') { noUpdate++; continue; }
  if (r.code !== 0) {
    skipped.push({ name: r.title, reason: `${r.code} ${r.msg}`.trim() });
    continue;
  }
  const v = vmap.get(r.url);
  if (!v || !v.isExistingDir) {
    skipped.push({ name: r.title, reason: `疑似擅自新建目录，落点：${r.save_path}（需人工确认，未做任何删除/改名）` });
    continue;
  }
  const d = { name: r.title, path: r.save_path, msg: r.msg };
  if (v.added != null && Number.isFinite(v.added)) d.added = v.added;
  dirs.push(d);
}
const status = skipped.length ? (dirs.length ? '部分成功' : '失败') : '成功';
const payload = {
  title: '我的网盘.夸克分享每日补充更新简报',
  dirs, skipped, status,
  detail: `本轮检测 ${results.length} 条更新 ｜ 成功 ${dirs.length} ｜ 无新增 ${noUpdate} ｜ 异常 ${skipped.length}`,
};
const payloadFile = path.join(CACHE, `share-update-card-${stamp}.json`);
fs.writeFileSync(payloadFile, JSON.stringify(payload, null, 2), 'utf8');
log(`[卡片] ${payload.detail}`);
log(`[卡片] payload=${payloadFile}`);

if (!dirs.length && !skipped.length) {
  log('无新增成功、无异常，按约定不发飞书。');
  process.exit(0);
}
if (NO_SEND) { log('[no-send] 不发送，payload 已落盘。'); process.exit(0); }

// ---------- 5. 飞书蓝标卡片（最多重试 1 次；失败不重跑任何夸克命令） ----------
if (!fs.existsSync(FEISHU)) die(`找不到飞书脚本：${FEISHU}（用 QK_FEISHU_SCRIPT 覆盖）`);
const send = () => spawnSync('node', [FEISHU, '--input', payloadFile], { encoding: 'utf8', timeout: 180000 });
let s = send();
if (s.status !== 0 && !s.error) s = send();
if (s.status !== 0) die(`飞书推送失败：${String(s.stderr || s.stdout || s.error || '').slice(0, 500)}（payload 已落盘，可手动重放：node ${FEISHU} --input ${payloadFile}）`);
log(String(s.stdout || '').trim());
log('DONE');
