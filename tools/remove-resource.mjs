#!/usr/bin/env node
/**
 * 从站点数据库删除资源，并把两端网盘对应目录移入回收目录（2026-11-24 建立）。
 *
 *   node tools/remove-resource.mjs --ids an-034,an-036              # 试跑：只定位+报告，不动盘、不删库
 *   node tools/remove-resource.mjs --ids an-034 --apply             # 真跑：移动两端目录 → 删 YAML/配图/映射 → 构建 → 提交推送
 *   node tools/remove-resource.mjs --ids an-034 --apply --no-push   # 真跑但只本地提交，不推送
 *   node tools/remove-resource.mjs --ids an-034 --apply --skip-drive # 只删库，不碰网盘（网盘端已人工处理时用）
 *
 * 流程（每个 id，严格顺序）：
 *   1. 夸克网盘：定位「<编号>-」目录 → move 到 SHARE/99-需要移除的资源都转移到这里
 *   2. 光鸭网盘：同上 → move 到 99-需要移除的资源都转移到这里（根目录）
 *   3. 删除 data/<分类>.yaml 的整块、static/images/<slug>/<id>.jpg、config/drive-fids.json 映射
 *   4. 构建校验（npm run build）→ git add/commit/pull --rebase/push
 *
 * 安全口径：
 *   - 默认 dry-run，必须 --apply 才写；--ids 必填，绝不空跑全库。
 *   - 盘端「目录不存在」按跳过处理（用户可能已手工删），不阻断删库。
 *   - 但盘端 CLI 报错 / 登录失效 / move 失败 → 整体停手（退出码 3），不删库、不推送，报告原文。
 *   - 目标回收目录两端必须已存在，找不到就停手（不自动创建，避免误判）。
 *   - 幂等：编号已被占用但 YAML 无此 id → 报「已删除」跳过。
 *   - 推送前 fetch 并确认本地基于 origin/main；rebase 冲突 abort 后停手（不 force、不 stash）。
 *   - 工作区有非本任务改动即停手（退出码 3）。
 *
 * 退出码：0 成功（含 dry-run / 全部已删除）/ 3 停手未提交 / 4 环境错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cfg, CACHE } from './vendor/quark-resource-sync/scripts/lib/config.mjs';

const HOME = os.homedir();
const REPO = cfg.REPO;
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const IDS = (arg('ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const APPLY = process.argv.includes('--apply');
const NO_PUSH = process.argv.includes('--no-push');
const SKIP_DRIVE = process.argv.includes('--skip-drive');
const QUARK_CLI = cfg.QUARK_CLI;
const TRASH_NAME = arg('trash-name', '99-需要移除的资源都转移到这里');
const SHARE_NAME = arg('share-name', 'SHARE');

// 光鸭 CLI 配置，与 guangya-sync.mjs 完全同口径
const DRIVE_SKILL = process.env.GUANGYA_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'guangyapan-drive');
const DRIVE_CLI = process.env.GUANGYA_CLI || path.join(DRIVE_SKILL, 'bin', 'guangyapan.mjs');
const AGENT = process.env.GUANGYA_AGENT_NAME || 'WorkBuddy';
const IID_FILE = process.env.GUANGYA_INSTANCE_ID_FILE
  || [path.join(HOME, '.workbuddy', 'guangyapan-instance-id'), path.join(HOME, '.workbuddy', 'guangyapan-drive-instance-id')]
    .find((p) => fs.existsSync(p))
  || path.join(HOME, '.workbuddy', 'guangyapan-instance-id');
const IID = process.env.GUANGYA_INSTANCE_ID || (() => { try { return fs.readFileSync(IID_FILE, 'utf8').trim(); } catch { return ''; } })();

// id 前缀 → 数据文件、光鸭分类目录名、光鸭分类 remote id（2026-11-24 实测 SHARE 下列表，避免 search 跨分类撞号）
const PREFIX = {
  mv: { file: 'movie.yaml', dir: '04电影', remote: '1968993535304577054' },
  tv: { file: 'tv.yaml', dir: '03电视剧', remote: '1968993518137270362' },
  dc: { file: 'documentary.yaml', dir: '06纪录片', remote: '1968993568204693594' },
  an: { file: 'anime.yaml', dir: '05动漫', remote: '1968993551783989255' },
  game: { file: 'game.yaml', dir: '01游戏', remote: '1968993486755479581' },
  app: { file: 'software.yaml', dir: '02应用', remote: '1968993502014386188' },
  bk: { file: 'ebook.yaml', dir: '08电子书', remote: '1968993601750732883' },
  ot: { file: 'misc.yaml', dir: '010其他', remote: '1968993619530391567' },
  cs: { file: 'course.yaml', dir: '07课程', remote: '1968993585367769173' },
};
const slugOf = (() => {
  try {
    const t = fs.readFileSync(path.join(REPO, 'config', 'site.yaml'), 'utf8');
    const m = t.match(/^slugs:\s*\n((?:\s{2}\S+:\s*\S+\s*\n)+)/m);
    const map = {};
    if (m) for (const line of m[1].trim().split('\n')) { const [k, v] = line.trim().split(':').map((x) => x.trim()); map[k] = v; }
    return (cat) => map[cat] || String(cat || '');
  } catch { return (cat) => String(cat || ''); }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const numOf = (id) => String(id).match(/(\d+)$/)?.[1] || '';
const numPrefix = (id) => numOf(id).replace(/^0+/, '') || '0'; // 用去前导零的数字匹配「034-」/「34-」两种写法

/** 运行子进程拿 JSON（光鸭 CLI：stdin 传 payload，cwd 固定 skill 目录） */
function cliJson(cmd, args, payload, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish({ __error: 'CLI_TIMEOUT' }); }, 300_000);
    function finish(v) { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ __error: `CLI_SPAWN: ${e.message}` }));
    child.on('close', () => {
      // 夸克 CLI 可能输出多行 JSONL（result + artifact），逐行找 code 字段的那行
      let parsed;
      for (const line of out.trim().split('\n')) {
        try { const o = JSON.parse(line); if (o && 'code' in o) { parsed = o; break; } } catch { /* skip */ }
      }
      if (!parsed) { try { parsed = JSON.parse(out.trim()); } catch { /* fallthrough */ } }
      if (!parsed) return finish({ __error: `CLI_PARSE: ${String(out).slice(0, 200)} ${String(err).slice(0, 120)}` });
      finish(parsed);
    });
    if (payload !== undefined) child.stdin.end(JSON.stringify(payload)); else child.stdin.end();
  });
}

function gyCli(command, payload, extraArgs = []) {
  const args = [DRIVE_CLI, command, ...extraArgs, '--agent-name', AGENT];
  if (IID) args.push('--agent-instance-id', IID);
  return cliJson(process.execPath, args, payload, DRIVE_SKILL);
}

/** 夸克 CLI（node 脚本），返回解析后的 JSON */
function qCli(args) {
  return cliJson(process.execPath, [QUARK_CLI, ...args, '--session-input', 'remove-resource 定位/移动资源目录'], REPO);
}

/** 光鸭 run：提交批次 → 轮询终态；返回 {ok, items, err}。只读批次也走同一套（返回 tryOnce 结构） */
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'STOPPED']);
async function gyRun(operations, { poll = true } = {}) {
  const run = await gyCli('run', { version: 1, request_id: crypto.randomUUID(), operations });
  if (run.__error) return { ok: false, err: run.__error };
  if (/^LOGIN_/.test(String(run.code))) return { ok: false, err: `光鸭登录态失效：${run.code}` };
  if (run.code !== 'OK') return { ok: false, err: `光鸭 run 返回 ${run.code}: ${run.data?.message || ''}` };
  const batchId = run.data?.batch_id;
  if (!batchId || !poll) return { ok: true, items: run.data?.items || [], immediate: true };
  // 写操作：轮询到终态
  for (let i = 0; i < 300; i++) {
    await sleep(1000);
    const st = await gyCli('status', null, ['--batch-id', batchId]);
    if (st.__error) return { ok: false, err: `光鸭 status 错误：${st.__error}` };
    const state = st.data?.batch_state;
    if (state && TERMINAL.has(state)) {
      if (state === 'SUCCEEDED') return { ok: true, items: st.data?.items || [] };
      return { ok: false, err: `光鸭批次终态 ${state}：${JSON.stringify(st.data?.items || st.data?.error || {}).slice(0, 400)}` };
    }
  }
  return { ok: false, err: `光鸭批次 ${batchId} 轮询 300s 未达终态` };
}

/** 光鸭只读 list：返回 entries[{id,name,type,parent_id}] */
async function gyList(parentId) {
  const r = await gyRun([{ id: 'op-1', type: 'list', remote_parent_id: parentId }]);
  if (!r.ok) throw new Error(r.err);
  const item = r.items.find((x) => x.operation_id === 'op-1');
  if (item?.state !== 'SUCCEEDED') throw new Error(`光鸭 list 失败：${item?.error?.message || item?.state || '无结果'}`);
  return item.result?.items || [];
}

/** 在条目数组里找「编号-」开头的目录；去重：多个命中视为不明确，返回 null */
function findByNum(entries, num, label) {
  const re = new RegExp(`^0*${num}\\s*[-－—.]`, 'i');
  const hits = entries.filter((e) => e.type === 'directory' && re.test(e.name || e.filename || ''));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`${label} 命中 ${hits.length} 个「${num}-」目录，不明确：${hits.map((h) => h.name || h.filename).join(' / ')}`);
  return null;
}
const entryName = (e) => e.name || e.filename || '';
const entryId = (e) => e.id || e.fid || '';
const isDir = (e) => e.type === 'directory' || String(e.file_type) === '0';

/** 从 data/*.yaml 读取全部条目（保留原始文本块） */
function loadData() {
  const files = Object.values(PREFIX).map((p) => p.file).filter((v, i, a) => a.indexOf(v) === i);
  const store = {};
  for (const f of files) {
    const fp = path.join(REPO, 'data', f);
    const text = fs.readFileSync(fp, 'utf8');
    const blocks = text.split(/(?=- id: )/);
    store[f] = { text, blocks };
  }
  return store;
}
function findEntry(store, id) {
  for (const [file, { blocks }] of Object.entries(store)) {
    const idx = blocks.findIndex((b) => new RegExp(`^- id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(b));
    if (idx >= 0) {
      const block = blocks[idx];
      const category = (block.match(/^  category:\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
      return { file, idx, block, category };
    }
  }
  return null;
}

/** 从 YAML 删除指定 id 的整块，返回新文本与实际删除的 id */
function removeBlocks(text, ids) {
  const blocks = text.split(/(?=- id: )/);
  const removed = [];
  const out = blocks.filter((b) => {
    const m = b.match(/^- id:\s*(\S+)/m);
    if (m && ids.includes(m[1])) { removed.push(m[1]); return false; }
    return true;
  });
  return { text: out.join(''), removed };
}

/** 夸克 browse --all 的原始输出解析：需要读 artifact 的 JSONL 文件（browse 大目录 stdout 只给预览） */
function qBrowseRaw(fid) {
  return new Promise((resolve) => {
    const args = [QUARK_CLI, 'browse', '--parent-fid', fid, '--all', '--session-input', 'remove-resource browse 定位目录'];
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish({ __error: 'BROWSE_TIMEOUT' }); }, 180_000);
    function finish(v) { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ __error: `BROWSE_SPAWN: ${e.message}` }));
    child.on('close', () => {
      const rows = [];
      let result = null;
      for (const line of out.trim().split('\n')) {
        try {
          const o = JSON.parse(line);
          if (o.action === 'browse' && o.type === 'result') {
            if (o.code !== 0) return finish({ __error: `browse code ${o.code}: ${o.msg || ''}` });
            result = o;
            for (const f of (o.data?.file_list || [])) rows.push(f);
          } else if (o.type === 'artifact' && o.data?.file_path && fs.existsSync(o.data.file_path)) {
            // artifact JSONL 是完整结果，优先用它
            for (const l of fs.readFileSync(o.data.file_path, 'utf8').trim().split('\n')) {
              try { const f = JSON.parse(l); if (f && f.fid) rows.push(f); } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      }
      if (!result) return finish({ __error: `browse 无 result：${String(out).slice(0, 200)} ${String(err).slice(0, 100)}` });
      // 去重（stdout 预览 + artifact 可能重复）
      const seen = new Set();
      finish(rows.filter((f) => { if (seen.has(f.fid)) return false; seen.add(f.fid); return true; }));
    });
    child.stdin.end();
  });
}

/** 夸克：动态定位网盘根下的 SHARE 目录与回收目录（fid 会轮换，不依赖缓存） */
async function quarkRoots() {
  const roots = await qBrowseRaw('0');
  if (!Array.isArray(roots)) throw new Error(roots.__error || 'browse 网盘根失败');
  const share = roots.find((f) => String(f.filename) === SHARE_NAME && String(f.file_type) === '0');
  const trash = roots.find((f) => String(f.filename) === TRASH_NAME && String(f.file_type) === '0');
  if (!share) throw new Error(`夸克网盘根下找不到「${SHARE_NAME}」目录`);
  if (!trash) throw new Error(`夸克网盘根下找不到回收目录「${TRASH_NAME}」，停手（不自动创建）`);
  return { shareFid: share.fid, trashFid: trash.fid };
}

/** 夸克：定位分类目录 fid（browse SHARE 根，按中文分类名匹配）→ 在分类内按编号找资源目录 */
async function quarkFindDir(shareFid, categoryDir, num) {
  const shareRows = await qBrowseRaw(shareFid);
  if (!Array.isArray(shareRows)) throw new Error(shareRows.__error || 'browse SHARE 失败');
  const cat = shareRows.find((f) => String(f.filename) === categoryDir && String(f.file_type) === '0');
  if (!cat) throw new Error(`夸克 SHARE 下找不到分类目录「${categoryDir}」`);
  const catRows = await qBrowseRaw(cat.fid);
  if (!Array.isArray(catRows)) throw new Error(catRows.__error || `browse 分类「${categoryDir}」失败`);
  const re = new RegExp(`^0*${num}\\s*[-－—.]`, 'i');
  const hits = catRows.filter((f) => String(f.file_type) === '0' && re.test(String(f.filename || '')));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`夸克「${categoryDir}」内命中 ${hits.length} 个「${num}-」目录，不明确：${hits.map((h) => h.filename).join(' / ')}`);
  return null;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  if (!IDS.length) { log('✗ 必须用 --ids 指定要删除的资源 id（逗号分隔）'); process.exit(4); }
  if (!fs.existsSync(path.join(REPO, 'data'))) { log(`✗ 仓库路径错误：${REPO}`); process.exit(4); }
  if (!APPLY) log('※ 试跑模式（不加 --apply 不会写盘、不删库、不推送）');

  // 环境前置：工作区干净 + 两端登录/目标目录
  // 只看「已跟踪文件的改动」（diff / cached），未跟踪文件（如本脚本自身）不阻塞：
  // 本脚本只 add 指定路径，不会把外部未跟踪文件带进提交。
  const tracked = git(['status', '--porcelain', '--untracked-files=no']);
  if (tracked.out.trim()) { log('✗ 工作区有已跟踪文件改动，停手（不 stash、不丢弃）：\n' + tracked.out.trim()); process.exit(3); }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.out.trim() !== 'main') { log(`✗ 当前分支 ${branch.out.trim()}（应为 main），停手`); process.exit(3); }

  let shareFid = '', trashQfid = '', trashG = null;
  if (!SKIP_DRIVE) {
    // 夸克：从网盘根动态定位 SHARE 与回收目录（fid 每次 browse 会轮换，不能用缓存）
    const qr = await quarkRoots();
    shareFid = qr.shareFid;
    trashQfid = qr.trashFid;

    // 光鸭：全盘 search 定位回收目录
    const gr = await gyRun([{ id: 't', type: 'search', keyword: TRASH_NAME }]);
    if (!gr.ok) throw new Error(`光鸭搜索回收目录失败：${gr.err}`);
    const gitem = gr.items.find((x) => x.operation_id === 't');
    const ghits = ((gitem?.result?.items) || []).filter((e) => entryName(e) === TRASH_NAME && isDir(e));
    if (!ghits.length) throw new Error(`光鸭未找到回收目录「${TRASH_NAME}」，停手（不自动创建）`);
    trashG = ghits[0];
    log(`回收目录：夸克 fid=${trashQfid.slice(0, 16)}… / 光鸭 id=${entryId(trashG)}`);
  }

  const store = loadData();
  const plan = [];
  for (const id of IDS) {
    const e = findEntry(store, id);
    if (!e) { log(`· ${id}：YAML 中无此条目，视为已删除，跳过`); continue; }
    const num = numPrefix(id);
    const p = Object.entries(PREFIX).find(([k]) => id.startsWith(k + '-'))?.[1];
    if (!p) throw new Error(`${id}：无法从 id 前缀推断分类/数据文件`);
    if (p.file !== e.file) throw new Error(`${id}：id 前缀推断文件 ${p.file} 与实际 ${e.file} 不符，停手`);
    const imagePath = path.join(REPO, 'static', 'images', slugOf(e.category), `${id}.jpg`);
    plan.push({ id, num, ...e, prefix: p, imagePath });
  }
  if (!plan.length) { log('✓ 所有 id 均已不在库中，无需操作'); process.exit(0); }

  // 阶段 1+2：两端移动（失败即停手，不进入删库）
  if (!SKIP_DRIVE) {
    for (const item of plan) {
      log(`\n[${item.id}] ${item.block.match(/^  title:\s*(.+)$/m)?.[1]?.trim() || ''}（编号 ${item.num}，${item.category}）`);
      // 夸克：browse SHARE 分类目录 → 按编号定位（search 会跨分类撞号，不可靠）
      try {
        const hit = await quarkFindDir(shareFid, item.prefix.dir, item.num);
        if (!hit) log(`  夸克：分类「${item.prefix.dir}」内未找到「${item.num}-」目录（可能已人工删除），跳过`);
        else if (!APPLY) log(`  夸克：将移动 ${entryName(hit)}（fid=${entryId(hit).slice(0, 16)}…）→ 回收目录`);
        else {
          const mv = await qCli(['move', entryId(hit), '--target-fid', trashQfid]);
          if (mv.__error || mv.code !== 0) throw new Error(`move 失败：${mv.__error || mv.code} ${mv.msg || ''}`);
          log(`  ✓ 夸克已移动 ${entryName(hit)} → 回收目录`);
        }
      } catch (err) { log(`  ✗ 夸克端错误：${err.message}`); process.exit(3); }

      // 光鸭：用已知分类 remote id 直接 list；没有 remote id 的全盘 search 按编号定位
      try {
        let hit = null;
        if (item.prefix.remote) {
          const entries = await gyList(item.prefix.remote);
          hit = findByNum(entries, item.num, `光鸭 ${item.category}`);
        } else {
          const r = await gyRun([{ id: 's', type: 'search', keyword: `${item.num}-` }]);
          if (!r.ok) throw new Error(r.err);
          const si = r.items.find((x) => x.operation_id === 's');
          const all = (si?.result?.items || []).filter((e) => isDir(e));
          hit = findByNum(all, item.num, `光鸭 ${item.category}`);
        }
        if (!hit) log(`  光鸭：未找到「${item.num}-」目录（可能已人工删除），跳过`);
        else if (String(hit.parent_id) === String(entryId(trashG))) log(`  光鸭：已在回收目录，跳过（id=${entryId(hit)}）`);
        else if (!APPLY) log(`  光鸭：将移动 ${entryName(hit)}（id=${entryId(hit)}）→ 回收目录`);
        else {
          const mv = await gyRun([{ id: 'm', type: 'move', remote_id: entryId(hit), target_parent_id: entryId(trashG) }]);
          if (!mv.ok) throw new Error(mv.err);
          const mi = mv.items.find((x) => x.operation_id === 'm');
          if (mi && mi.state !== 'SUCCEEDED') throw new Error(`move 项状态 ${mi.state}：${JSON.stringify(mi.error || {}).slice(0, 200)}`);
          log(`  ✓ 光鸭已移动 ${entryName(hit)} → 回收目录`);
        }
      } catch (err) { log(`  ✗ 光鸭端错误：${err.message}`); process.exit(3); }
    }
  }

  // 阶段 3：删 YAML / 配图 / drive-fids（仅 --apply）
  if (!APPLY) { log('\n※ 试跑结束：以上为计划动作，未写盘。确认无误后加 --apply 执行。'); process.exit(0); }

  const byFile = {};
  for (const item of plan) (byFile[item.file] ||= []).push(item.id);
  for (const [file, ids] of Object.entries(byFile)) {
    const { text } = store[file];
    const result = removeBlocks(text, ids);
    if (result.removed.length !== ids.length) throw new Error(`${file} 删除块数 ${result.removed.length} ≠ 预期 ${ids.length}，停手`);
    fs.writeFileSync(path.join(REPO, 'data', file), result.text);
    log(`✓ ${file} 已删除 ${result.removed.join(', ')}`);
  }
  // 配图 + public 残留产物
  for (const item of plan) {
    if (fs.existsSync(item.imagePath)) { fs.unlinkSync(item.imagePath); log(`  ✓ 删除配图 ${path.relative(REPO, item.imagePath)}`); }
    const pubDir = path.join(REPO, 'public', 'img');
    if (fs.existsSync(pubDir)) for (const f of fs.readdirSync(pubDir)) if (f.startsWith(`${item.id}-`)) fs.unlinkSync(path.join(pubDir, f));
  }
  // drive-fids.json
  const fidsPath = path.join(REPO, 'config', 'drive-fids.json');
  if (fs.existsSync(fidsPath)) {
    const fids = JSON.parse(fs.readFileSync(fidsPath, 'utf8'));
    let n = 0;
    for (const item of plan) if (fids[item.id]) { delete fids[item.id]; n++; }
    if (n) { fs.writeFileSync(fidsPath, JSON.stringify(fids, null, 2) + '\n'); log(`✓ drive-fids.json 删除 ${n} 条映射`); }
  }

  // 校验 YAML 全库可解析 + 目标 id 确实消失
  const yaml = await import('js-yaml');
  for (const item of plan) {
    const d = yaml.load(fs.readFileSync(path.join(REPO, 'data', item.file), 'utf8'));
    if (d.some((x) => x.id === item.id)) throw new Error(`校验失败：${item.id} 仍在 ${item.file}`);
  }
  log('✓ YAML 校验通过（目标 id 均已移除，全库可解析）');

  // 阶段 4：构建 + 推送
  log('\n→ 构建校验 npm run build ...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (build.status !== 0) { log(`✗ 构建失败，停手（数据已改、未提交）：\n${(build.stdout || '').slice(-1500)}`); process.exit(3); }
  log('✓ 构建通过：' + (build.stdout || '').trim().split('\n').filter((l) => /完成：|资源/.test(l)).slice(-1)[0]);

  const filesToAdd = [...new Set(plan.map((i) => i.file))].map((f) => `data/${f}`);
  filesToAdd.push('config/drive-fids.json');
  // 只 add 磁盘上真实存在的配图路径（已 unlink 的用 git add -u 无法带路径，改用 git rm --cached 语义由 add -A 覆盖）
  const imgPaths = plan.map((i) => path.relative(REPO, i.imagePath));
  git(['add', ...filesToAdd]);
  // 已删除的配图：git add -A 会把删除一并 stage
  git(['add', '-A', '--', ...imgPaths]);
  const msg = `data: 删除 ${plan.length} 个失效资源（${plan.map((i) => i.id).join('/')}，网盘目录已移入回收目录）`;
  const commit = git(['commit', '-m', msg]);
  if (!commit.ok) { log('✗ git commit 失败：' + commit.out.slice(0, 400)); process.exit(3); }
  const hash = git(['rev-parse', '--short', 'HEAD']).out.trim();
  log(`✓ 已本地提交 ${hash}：${msg}`);

  if (NO_PUSH) { log('※ --no-push：未推送，请手动 push'); process.exit(0); }
  const fetch = git(['fetch', 'origin']);
  if (!fetch.ok) { log('✗ git fetch 失败：' + fetch.out.slice(0, 400)); process.exit(3); }
  const pull = git(['pull', '--rebase', 'origin', 'main']);
  if (!pull.ok) { git(['rebase', '--abort']); log('✗ rebase 冲突已 abort，停手（本地已提交，需人工处理）'); process.exit(3); }
  const push = git(['push', 'origin', 'main']);
  if (!push.ok) { log('✗ push 失败（本地已提交，需人工处理）：' + push.out.slice(0, 400)); process.exit(3); }
  log(`✓ 已推送 origin/main（${hash}）`);

  // 报告
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, 'remove-resource-last.json'), JSON.stringify({
      ran_at: new Date().toISOString(), ids: IDS, deleted: plan.map((i) => i.id), commit: hash,
    }, null, 2));
  } catch { /* 报告写不动不影响主流程 */ }
  log('\n完成。');
}

main().catch((e) => { log(`✗ 环境/未预期错误：${e.stack || e.message}`); process.exit(4); });
