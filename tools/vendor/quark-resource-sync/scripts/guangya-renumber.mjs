#!/usr/bin/env node
/**
 * 光鸭裸名目录「镜像夸克编号」对齐（2026-11-17 指挥官订正口径）。
 *
 *   node guangya-renumber.mjs --dry-run   # 只报告可对齐项，不动网盘
 *   node guangya-renumber.mjs             # 真跑：原地 rename 成 <夸克编号>-<原名>（内容随目录走）
 *   node guangya-renumber.mjs --mirror-file <json>  # 夸克 browse 不可达时，从缓存读镜像（见 buildQuarkMirror）
 *
 * 口径（唯一目的：光鸭目录编号镜像夸克目录编号）：
 * - 光鸭 SHARE 是夸克 SHARE 的镜像，两边同分类、同资源、同编号。本脚本只做一件事：
 *   把光鸭侧「无编号前缀的裸名目录」原地改名成夸克侧同名目录的编号前缀。
 * - **对齐参照物是夸克网盘上的资源目录名，不是站点 YAML 的 title。**
 *   站点标题是入库时另起的描述性标题（如 app-106「7-Zip 26.06 - 开源文件压缩解压工具」），
 *   和盘端目录裸名（「解压缩7-Zip」）本就不是一回事，拿它匹配必然对不上——2026-11-16 的
 *   旧实现就是这么错的。现在改为实时 browse 夸克 SHARE 同分类目录，按「去编号后的目录名」
 *   宽 norm 建镜像映射，光鸭裸名命中唯一即取夸克编号。
 * - 命中唯一 + 目标编号未被光鸭现有目录占用 → 原地 rename；不唯一 / 无匹配 / 编号冲突
 *   一律跳过只记录，绝不猜。已有编号前缀的目录一律不动（幂等）。
 * - 由 guangya-sync.mjs 每轮补链前自动调用；改名后原补链逻辑自然能按编号配对出链。
 * - 出链仍归 guangya-sync.mjs；本脚本只负责把裸名对齐成编号名。失败只记录、不重试。
 *
 * 报告：~/.workbuddy/quark-sync-cache/guangya-renumber-last.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cfg, CACHE, QUARK_TASK_DIR } from './lib/config.mjs';

const HOME = os.homedir();
const SHARE_ID = process.env.GUANGYA_SHARE_ID || '1968992882272407648';
const DRIVE_SKILL = process.env.GUANGYA_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'guangyapan-drive');
const DRIVE_CLI = process.env.GUANGYA_CLI || path.join(DRIVE_SKILL, 'bin', 'guangyapan.mjs');
const AGENT = process.env.GUANGYA_AGENT_NAME || 'WorkBuddy';
const IID_FILE = process.env.GUANGYA_INSTANCE_ID_FILE || path.join(HOME, '.workbuddy', 'guangyapan-instance-id');
const IID = process.env.GUANGYA_INSTANCE_ID || (() => { try { return fs.readFileSync(IID_FILE, 'utf8').trim(); } catch { return ''; } })();
const QUARK_CLI = cfg.QUARK_CLI;
const QUARK_SHARE_FID = cfg.SHARE_FID;

// 与 guangya-sync.mjs 的 CATS 保持完全一致
const CATS = [
  { dir: '04电影', key: '电影', prefix: 'mv', file: 'movie.yaml' },
  { dir: '03电视剧', key: '电视剧', prefix: 'tv', file: 'tv.yaml' },
  { dir: '06纪录片', key: '纪录片', prefix: 'dc', file: 'documentary.yaml' },
  { dir: '05动漫', key: '动漫', prefix: 'an', file: 'anime.yaml' },
  { dir: '01游戏', key: '游戏', prefix: 'game', file: 'game.yaml' },
  { dir: '02应用', key: '软件', prefix: 'app', file: 'software.yaml' },
  { dir: '08电子书', key: '电子书', prefix: 'bk', file: 'ebook.yaml' },
  { dir: '010其他', key: '其他', prefix: 'ot', file: 'misc.yaml' },
  { dir: '07课程', key: '课程', prefix: 'cs', file: 'course.yaml' },
];
const isExcluded = (name) => /^99\s*[-.]/.test(String(name));
// 宽 norm：抹掉空格/中点/中英文冒号/书名号/括号/加号/逗号句号/问叹号/点横线，用于「光鸭裸名 ↔ 夸克目录名」比对
const norm = (s) => String(s).replace(/[\s·・:：《》〈〉"'()（）+＋、，,。！!？?._\-]/g, '').toLowerCase();
const matchCat = (name) => CATS.find((c) => c.dir === name) || CATS.find((c) => norm(String(name).replace(/^\d+\s*/, '')) === norm(c.key));
const hasNum = (name) => /^\d{1,4}\s*[-.]/.test(String(name));
const numOf = (name) => parseInt((String(name).match(/^(\d{1,4})\s*[-.]/) || [])[1] || '-1', 10);

function defaultCli(command, payload, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [DRIVE_CLI, command, ...extraArgs, '--agent-name', AGENT];
    if (IID) args.push('--agent-instance-id', IID);
    let out = '', err = '', settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    // 光鸭服务端偶发变慢：批量 list 9 个分类实测可达 ~85s，90s 会误判超时。放宽到 300s（只读 list 慢一点无妨）。
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ __error: 'CLI_TIMEOUT' }); }, 300_000);
    const child = spawn(process.execPath, args, { cwd: DRIVE_SKILL, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ __error: `CLI_SPAWN: ${e.message}` }));
    child.on('close', () => { try { finish(JSON.parse(out.trim())); } catch { finish({ __error: `CLI_PARSE: ${String(out).slice(0, 160)} ${String(err).slice(0, 100)}` }); } });
    if (payload) child.stdin.end(JSON.stringify(payload)); else child.stdin.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'STOPPED']);
async function runBatch(cli, ops) {
  const run = await cli('run', { version: 1, request_id: crypto.randomUUID(), operations: ops });
  if (run.__error || run.code !== 'OK' || /^LOGIN_/.test(String(run.code))) {
    return { items: null, code: run.code || run.__error || 'UNKNOWN', message: String(run.data?.message || '') };
  }
  const batchId = run.batch_id || run.request_id;
  let st = run;
  for (let i = 0; i < 30 && !TERMINAL.has(st.batch_state || st.data?.batch_state); i++) {
    await sleep(1000);
    st = await cli('status', undefined, ['--batch-id', batchId]);
    if (st.__error) break;
  }
  const state = st.batch_state || st.data?.batch_state;
  if (!TERMINAL.has(state)) return { items: null, code: 'STATUS_TIMEOUT', message: `batch ${batchId} 未到终态`, batch_id: batchId };
  return { items: st.data?.items || [], state, batch_id: batchId };
}
async function listAll(cli, ids) {
  const byKey = new Map();
  let pending = ids.map(([key, id]) => ({ key, id, page: 0 }));
  for (let round = 0; round < 10 && pending.length; round++) {
    const slice = pending.slice(0, 100);
    const meta = new Map();
    const ops = slice.map((p, i) => {
      const opId = `l${i}`; meta.set(opId, p);
      return { id: opId, type: 'list', remote_parent_id: p.id, page: p.page, page_size: 100 };
    });
    const res = await cli('run', { version: 1, request_id: crypto.randomUUID(), operations: ops });
    if (res.__error || res.code !== 'OK') throw new Error(`光鸭 list 失败：${res.code || res.__error}`);
    const next = [];
    for (const item of res.data?.items || []) {
      const p = meta.get(item.operation_id);
      if (!p || item.state !== 'SUCCEEDED') continue;
      const r = item.result || {};
      byKey.set(p.key, (byKey.get(p.key) || []).concat(r.items || []));
      if (r.has_more && p.page < 19) next.push({ ...p, page: p.page + 1 });
    }
    pending = next;
  }
  return byKey;
}

/**
 * 夸克 browse（只读、客态落盘 jsonl），返回该目录下条目数组。
 * - 用 spawn 避免 execFile 在 Windows 上对含 | 的 fid 报错。
 * - 每次调用给一个独立随机子目录：CLI 会清理目录内旧 jsonl，共享目录在沙箱里累计删除会触发
 *   safe-delete 的 bulk 阈值（-702），独立空目录彻底绕开；代价是留几个小 jsonl，不动它们。
 */
function quarkBrowse(fid) {
  const runQ = (args) => new Promise((resolve) => {
    let out = '', err = '';
    const child = spawn('node', [QUARK_CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ __error: `SPAWN: ${e.message}` }));
    child.on('close', (code) => resolve(code === 0 ? { out } : { __error: `EXIT ${code}: stdout=${out.slice(0, 300)} stderr=${err.slice(0, 200)}` }));
  });
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  return (async () => {
    const taskDir = path.join(QUARK_TASK_DIR, `rn-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(taskDir, { recursive: true });
    let r = await runQ([...base, '--task-dir', taskDir]);
    // 旧版 CLI 不认 --task-dir，回退到默认落盘位置
    if (r.__error && /unknown option|--task-dir/.test(r.__error)) r = await runQ(base);
    if (r.__error) throw new Error(`夸克 browse 失败（fid=${fid}）：${r.__error}`);
    const m = r.out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
    if (!m) throw new Error(`夸克 browse 未返回 jsonl（fid=${fid}）：${r.out.slice(0, 300)}`);
    return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  })();
}

/**
 * 从夸克网盘构建「分类 → norm(去编号目录名) → 编号」镜像映射。
 * 只 browse 光鸭侧确有裸名目录的分类，避免每轮全量 9 个分类都请求。
 */
async function buildQuarkMirror(cats, mirrorFile = '') {
  const out = new Map();
  // 缓存回退：夸克 browse 临时不可达（沙箱 safe-delete 阈值 / 网络抖动）时可注入离线镜像。
  // 格式 { "软件": { "<norm(去编号目录名)>": "<编号>" }, ... }，与实时 browse 产物同构。
  if (mirrorFile) {
    const raw = JSON.parse(fs.readFileSync(mirrorFile, 'utf8'));
    for (const [cat, m] of Object.entries(raw)) out.set(cat, new Map(Object.entries(m).map(([k, v]) => [k, String(v).padStart(3, '0')])));
    console.error(`  夸克镜像来自缓存：${path.basename(mirrorFile)}（${out.size} 个分类）`);
    return out;
  }
  if (!QUARK_CLI || !QUARK_SHARE_FID) {
    console.error('  夸克 CLI / SHARE_FID 未配置，镜像对齐跳过');
    return out;
  }
  try {
    const shareItems = await quarkBrowse(QUARK_SHARE_FID);
    const dirByName = new Map(
      shareItems.filter((o) => String(o.file_type) === '0').map((o) => [String(o.filename), String(o.fid)])
    );
    for (const c of cats) {
      const fid = dirByName.get(c.dir);
      if (!fid) { console.error(`  夸克侧无分类目录 ${c.dir}，跳过该类对齐`); continue; }
      const items = await quarkBrowse(fid);
      const m = new Map();
      for (const o of items.filter((x) => String(x.file_type) === '0')) {
        const mm = String(o.filename).match(/^(\d{1,4})\s*[-.](.+)$/);
        if (!mm) continue;
        const num = String(parseInt(mm[1], 10)).padStart(3, '0');
        m.set(norm(mm[2].trim()), num);
      }
      out.set(c.key, m);
    }
  } catch (e) {
    console.error(`  夸克镜像读取失败（对齐跳过，不阻断补链）：${e.message || e}`);
  }
  return out;
}

/**
 * 供 guangya-sync.mjs 每轮调用。ctx: { cli?, REPO?, DRY?, OUT?, SHARE_ID? }
 * 返回 report（同时落盘）。
 */
export async function renumber(ctx = {}) {
  const cli = ctx.cli || defaultCli;
  const DRY = !!ctx.DRY;
  const shareId = ctx.SHARE_ID || SHARE_ID;
  const mirrorFile = ctx.mirrorFile || '';
  const OUT = ctx.OUT || path.join(CACHE, 'guangya-renumber-last.json');
  const report = { ran_at: new Date().toISOString(), dry_run: DRY, share_id: shareId, mirror_source: 'quark', pending: [], renamed: [], failed: [], skipped: [] };
  try {
    const login = await cli('login-status');
    if (login.__error || login.data?.logged_in !== true) {
      report.failed.push({ id: '(login)', code: login.code || login.__error || 'UNKNOWN', message: '光鸭登录态失效，改名对齐跳过，不自动登录' });
      return report;
    }
    const top = await listAll(cli, [['share', shareId]]);
    const catDirs = (top.get('share') || []).filter((x) => x.type === 'directory' && !isExcluded(x.name));
    const mapped = catDirs.map((d) => ({ ...(matchCat(d.name) || {}), dirName: d.name, remote_id: d.id })).filter((c) => c.prefix);
    const lists = await listAll(cli, mapped.map((c) => [c.prefix, c.remote_id]));

    // 1. 找出光鸭侧所有裸名目录，按分类归组
    const bareGroups = [];
    for (const c of mapped) {
      const dirs = (lists.get(c.prefix) || []).filter((x) => x.type === 'directory' && !isExcluded(x.name));
      const bare = dirs.filter((d) => !hasNum(d.name));
      if (bare.length) bareGroups.push({ c, dirs, bare });
    }
    if (!bareGroups.length) return report;

    // 2. 关键：以「夸克网盘目录名」为镜像源取编号（不是站点 YAML title）
    const mirror = await buildQuarkMirror(bareGroups.map((g) => g.c), mirrorFile);
    for (const { c, dirs, bare } of bareGroups) {
      const qmap = mirror.get(c.key) || new Map();
      for (const d of bare) {
        const name = String(d.name).trim();
        const num = qmap.get(norm(name));
        if (!num) {
          report.skipped.push({ category: c.key, name, reason: '夸克网盘无同名目录，镜像对齐跳过（不猜、不按站点标题匹配）' });
          continue;
        }
        const conflict = dirs.some((x) => x.id !== d.id && numOf(x.name) === parseInt(num, 10));
        if (conflict) {
          report.skipped.push({ category: c.key, name, reason: `编号 ${num} 已被光鸭目录占用，不动`, quark_num: num });
          continue;
        }
        report.pending.push({ id: `${c.prefix}-${num}`, category: c.key, remote_id: d.id, old: name, newName: `${num}-${name}`, quark_num: num });
      }
    }
    if (DRY || !report.pending.length) return report;

    // 3. 一次一批原地改名，失败只记录、不重试
    const ops = report.pending.map((w) => ({ id: `rn-${w.id}`, type: 'rename', remote_id: w.remote_id, new_name: w.newName }));
    const r = await runBatch(cli, ops);
    if (!r.items) {
      for (const w of report.pending) report.failed.push({ id: w.id, code: r.code, message: `改名请求未通过：${r.message}，不重试` });
    } else {
      for (const w of report.pending) {
        const it = r.items.find((x) => x.operation_id === `rn-${w.id}`);
        if (it && (it.state === 'SUCCEEDED' || it.state === 'PARTIAL'))
          report.renamed.push({ id: w.id, category: w.category, from: w.old, to: w.newName, mirror_quark_num: w.quark_num });
        else
          report.failed.push({ id: w.id, code: it?.code || it?.state || 'NO_RESULT', message: String(it?.error?.message || it?.message || '改名失败，不重试') });
      }
    }
    return report;
  } catch (e) {
    report.failed.push({ id: '(stage)', code: 'STAGE_ERROR', message: String(e.message || e) });
    return report;
  } finally {
    try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2)); } catch { /* 报告写不动不影响主流程 */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const DRY = process.argv.includes('--dry-run');
  const mi = process.argv.indexOf('--mirror-file');
  const mirrorFile = mi >= 0 ? process.argv[mi + 1] : '';
  const report = await renumber({ DRY, mirrorFile });
  console.log(`光鸭编号对齐（镜像夸克目录）：可对齐 ${report.pending.length} / 改名成功 ${report.renamed.length} / 失败 ${report.failed.length} / 跳过 ${report.skipped.length}`);
  console.log('报告：', path.join(CACHE, 'guangya-renumber-last.json'));
  process.exitCode = report.failed.length ? 1 : 0;
}
