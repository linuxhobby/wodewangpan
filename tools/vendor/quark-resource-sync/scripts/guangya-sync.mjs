#!/usr/bin/env node
/**
 * 光鸭网盘 SHARE 补链（quark-resource-sync 每轮同步的一个阶段）。
 *
 *   node guangya-sync.mjs --dry-run            # 只扫描 + 报告，不出链、不改 YAML
 *   node guangya-sync.mjs                     # 对缺 guangya_url 的条目出链并写回 data/*.yaml
 *   node guangya-sync.mjs --only bk --limit 2  # 限定分类前缀 / 条数，排障用
 *   node guangya-sync.mjs --recheck            # 只读复核上次「未确认」批次：查结果、补写 guangya_url，绝不重提
 *
 * 口径（2026-11-16 指挥官定）：
 * - 光鸭 SHARE 下的资源只是夸克资源在第二个网盘的副本，站点条目已存在，只补 `guangya_url` 字段，
 *   不新建条目、不改 added / updated / files:、不碰海报、不构建、不推送，那些由主流程统一做。
 * - 按目录名开头的编号配对站点 id（04电影 → mv-004 → movie.yaml），已有 guangya_url 的跳过。
 * - 出链一次提交，无提取码、永久。失败只记录，绝不重试、不重建分享、不轮询等结果。
 * - 登录态失效或 CLI 异常直接结束本阶段，不启动登录流程（无人值守没人扫码）。
 * - 报告写 CACHE/guangya-sync-last.json（~/.cache/quark-sync，见 lib/config.mjs），供收尾简报取数。
 *
 * 依赖光鸭 skill：~/.workbuddy/skills/guangyapan-drive（bundled 版，勿 npm install）。
 * 实例绑定走 ~/.workbuddy/guangyapan-instance-id，与登录时的 scope 必须一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cfg, CACHE } from './lib/config.mjs';
import { renumber } from './guangya-renumber.mjs';

const HOME = os.homedir();
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const DRY = process.argv.includes('--dry-run');
const RECHECK = process.argv.includes('--recheck');
const REPO = arg('repo', cfg.REPO);
const OUT = arg('out', path.join(CACHE, 'guangya-sync-last.json'));
const ONLY = arg('only', '');
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const SHARE_ID = arg('share-id', process.env.GUANGYA_SHARE_ID || '1968992882272407648');
const DRIVE_SKILL = process.env.GUANGYA_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'guangyapan-drive');
const DRIVE_CLI = process.env.GUANGYA_CLI || path.join(DRIVE_SKILL, 'bin', 'guangyapan.mjs');
const AGENT = process.env.GUANGYA_AGENT_NAME || 'WorkBuddy';
const IID_FILE = process.env.GUANGYA_INSTANCE_ID_FILE
  || [
    path.join(HOME, '.workbuddy', 'guangyapan-instance-id'),
    path.join(HOME, '.workbuddy', 'guangyapan-drive-instance-id'),
  ].find((p) => fs.existsSync(p))
  || path.join(HOME, '.workbuddy', 'guangyapan-instance-id');
const PROFILE_DIR = process.env.GUANGYA_PROFILE_DIR || '';
const IID = process.env.GUANGYA_INSTANCE_ID || (() => {
  try { return fs.readFileSync(IID_FILE, 'utf8').trim(); } catch { return ''; }
})();

// 光鸭 SHARE 分类目录 → 站点分类、id 前缀、数据文件。与 scan-new.mjs 的 CATS 保持同一口径。
// 「操作系统」已并入「软件」，不登记；99- 开头的待清理目录一律排除。
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
const stripNum = (s) => String(s).replace(/^\d+\s*/, '');
const norm = (s) => String(s).replace(/[\s·・:：\-_.]/g, '').toLowerCase();
const matchCat = (name) =>
  CATS.find((c) => c.dir === name) || CATS.find((c) => norm(stripNum(name)) === norm(c.key));

/** 站点 YAML 按条目切块，保留全部原始字符（含 CRLF），写回时只插入一行 */
export function insertGuangyaUrl(text, links) {
  const changed = [];
  const noAnchor = [];
  const out = text.split(/(?=- id: )/).map((b) => {
    const m = b.match(/^- id:\s*(\S+)/);
    const id = m && m[1];
    const url = id && links.get(id);
    if (!url || b.includes('guangya_url:')) return b;
    const q = b.match(/(^[ \t]+quark_url:\s*"[^"]*"\r?\n)/m);
    if (!q) { noAnchor.push(id); return b; }
    const nl = q[1].endsWith('\r\n') ? '\r\n' : '\n';
    changed.push(id);
    return b.replace(q[1], q[1] + `  guangya_url: "${url}"` + nl);
  }).join('');
  return { text: out, changed, noAnchor };
}

/** 调光鸭 CLI：payload 通过 stdin 传 JSON，超时或解析失败都返回结构化错误，不重试 */
function cli(command, payload, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [DRIVE_CLI, command, ...extraArgs, '--agent-name', AGENT];
    if (IID) args.push('--agent-instance-id', IID);
    else if (PROFILE_DIR) args.push('--agent-profile-dir', PROFILE_DIR);
    let out = '', err = '', settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    // 光鸭服务端偶发变慢：批量 list 9 个分类实测可达 ~85s，90s 会误判超时。放宽到 300s（只读/出链慢一点无妨）。
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish({ __error: 'CLI_TIMEOUT' }); }, 300_000);
    const child = spawn(process.execPath, args, { cwd: DRIVE_SKILL, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ __error: `CLI_SPAWN: ${e.message}` }));
    child.on('close', () => {
      let parsed;
      try { parsed = JSON.parse(out.trim()); }
      catch { return finish({ __error: `CLI_PARSE: ${String(out).slice(0, 200)} ${String(err).slice(0, 120)}` }); }
      finish(parsed);
    });
    if (payload) child.stdin.end(JSON.stringify(payload));
    else child.stdin.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'STOPPED']);

/** 只读 list：一次请求最多放 100 个 list，分页取全 */
async function listAll(ids) {
  const byKey = new Map();
  let pending = ids.map(([key, id]) => ({ key, id, page: 0 }));
  for (let round = 0; round < 10 && pending.length; round++) {
    const slice = pending.slice(0, 100);
    const meta = new Map();
    const ops = slice.map((p, i) => {
      const opId = `l${i}`;
      meta.set(opId, p);
      return { id: opId, type: 'list', remote_parent_id: p.id, page: p.page, page_size: 100 };
    });
    const res = await cli('run', { version: 1, request_id: crypto.randomUUID(), operations: ops });
    if (res.__error || res.code !== 'OK') {
      throw new Error(`光鸭 list 失败：${res.code || res.__error} ${String(res.data?.message || '').slice(0, 120)}`);
    }
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

/** 只读复核上次未确认的批次：查结果、把已成功的链接补写回 YAML，绝不重新提交出链。 */
async function recheckUnconfirmed(report) {
  let exitCode = 0;
  const last = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const unconfirmed = last.unconfirmed || [];
  if (!unconfirmed.length) { console.log('复核：上次没有未确认批次，无事可做。'); return exitCode; }
  const batches = new Map();
  for (const u of unconfirmed) {
    if (!u.batch_id) continue;
    if (!batches.has(u.batch_id)) batches.set(u.batch_id, []);
    batches.get(u.batch_id).push(u);
  }
  // id → 所在数据文件，用于写回 guangya_url
  const idFile = new Map();
  for (const c of CATS) {
    const file = path.join(REPO, 'data', c.file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const b of text.split(/(?=- id: )/)) {
      const m = b.match(/^- id:\s*(\S+)/);
      if (m) idFile.set(m[1], file);
    }
  }
  const confirmed = new Map();
  for (const [batchId, entries] of batches) {
    let st = null;
    for (let i = 0; i < 30 && !TERMINAL.has(st?.batch_state || st?.data?.batch_state); i++) {
      if (i) await sleep(1000);
      st = await cli('status', undefined, ['--batch-id', batchId]);
      if (st.__error) break;
    }
    const state = st?.batch_state || st?.data?.batch_state;
    if (!TERMINAL.has(state)) {
      for (const u of entries) report.unconfirmed.push({ ...u, code: 'STILL_UNCONFIRMED', message: `复核后仍未确认（batch_state=${state || st?.__error || 'UNKNOWN'}），保持不重提` });
      console.log(`  批次 ${batchId}：仍未确认（${state || st?.__error || 'UNKNOWN'}）`);
      exitCode = 1;
      continue;
    }
    const items = st?.data?.items || [];
    for (const u of entries) {
      const it = items.find((x) => x.operation_id === u.id);
      const url = it?.result?.shareUrl;
      if (it?.state === 'SUCCEEDED' && /^https:\/\/[^\s"]+\/s\//.test(String(url))) {
        confirmed.set(u.id, url);
        report.created.push({ id: u.id, dir: '', url, rechecked: true });
        console.log(`  ${u.id}：出链成功，补写 ${String(url).slice(0, 60)}…`);
      } else {
        report.failed.push({ id: u.id, code: it?.code || it?.state || 'NO_RESULT', message: '复核确认出链失败，不重试' });
        console.log(`  ${u.id}：确认失败（${it?.state || it?.code || 'NO_RESULT'}）`);
        exitCode = 1;
      }
    }
  }
  if (confirmed.size) {
    const byFile = new Map();
    for (const [id, url] of confirmed) {
      const file = idFile.get(id);
      if (!file) { console.error(`  ${id}：找不到所在数据文件，跳过写盘`); exitCode = 1; continue; }
      const m = byFile.get(file) || new Map();
      m.set(id, url);
      byFile.set(file, m);
    }
    for (const [file, links] of byFile) {
      const src = fs.readFileSync(file, 'utf8');
      const { text, changed } = insertGuangyaUrl(src, links);
      if (changed.length) { fs.writeFileSync(file, text); console.log(`  写入 ${path.basename(file)}：${changed.length} 条`); }
    }
  }
  console.log(`复核完成：确认成功 ${confirmed.size} / 未确认 ${unconfirmed.length}`);
  return exitCode;
}

async function main() {
  const report = {
    scanned_at: new Date().toISOString(),
    repo: REPO, share_id: SHARE_ID, dry_run: DRY,
    login_required: false, categories: [], pending: [], created: [], failed: [], unmatched: [], unconfirmed: [], skipped: [],
    note: '分享链接创建成功仅代表链接生成，内容需经分享审核，审核通过前文件可能暂不可见。',
  };
  let exitCode = 0;
  try {
    if (!REPO || !fs.existsSync(path.join(REPO, 'data'))) throw new Error(`站点仓库不可用：${REPO}`);
    if (!fs.existsSync(DRIVE_CLI)) throw new Error(`光鸭 CLI 不存在：${DRIVE_CLI}`);
    if (!IID && !PROFILE_DIR) throw new Error('缺少光鸭实例绑定：GUANGYA_INSTANCE_ID / guangyapan-instance-id / GUANGYA_PROFILE_DIR 均不可用');

    if (RECHECK) {
      report.dry_run = false;
      report.recheck = true;
      const code = await recheckUnconfirmed(report);
      console.log('复核为只读操作：只补写已确认成功的 guangya_url，不构建、不推送（由主流程/例行任务统一处理）。');
      return { report, exitCode: code };
    }

    const login = await cli('login-status');
    if (login.__error || login.data?.logged_in !== true) {
      report.login_required = true;
      report.failed.push({ id: '(login)', code: login.code || login.__error || 'UNKNOWN', message: '光鸭登录态失效或暂时不可验证，本阶段跳过，不自动登录、不重试' });
      throw new Error('GUANGYA_LOGIN_REQUIRED');
    }

    // 0. 裸名目录镜像夸克编号对齐：改名后再扫，裸名就变成可配对的编号目录。
    //    光鸭是夸克的镜像，参照物是夸克网盘的同名目录（去编号宽 norm 匹配）取编号，
    //    不是站点 YAML 的 title（标题是另起的描述性标题，跟目录裸名对不上）。
    //    只动「无编号前缀 + 夸克同名目录唯一命中 + 编号未被占用」的目录；失败只记录，不阻断补链主流程。
    try {
      const rn = await renumber({ cli, REPO, DRY, SHARE_ID });
      report.renumber = { pending: rn.pending.length, renamed: rn.renamed, failed: rn.failed, skipped: rn.skipped };
      if (rn.renamed.length) console.log(`  编号对齐：改名 ${rn.renamed.length} 条（${rn.renamed.map((x) => x.id).join('、')}）`);
    } catch (e) {
      report.renumber = { error: String(e.message || e).slice(0, 200) };
      console.error(`  编号对齐阶段异常（不阻断补链）：${e.message || e}`);
    }

    // 1. 扫 SHARE 顶层，找出分类目录
    const top = await listAll([['share', SHARE_ID]]);
    const catDirs = (top.get('share') || []).filter((x) => x.type === 'directory' && !isExcluded(x.name));
    const mapped = [], unknown = [];
    for (const d of catDirs) {
      const c = matchCat(d.name);
      if (c && (!ONLY || ONLY.split(',').includes(c.prefix))) mapped.push({ ...c, dirName: d.name, remote_id: d.id });
      else if (!c) unknown.push({ name: d.name, reason: '站点无对应分类，不动' });
    }
    report.unmatched.push(...unknown);

    // 2. 列出各分类的资源目录，按编号配对站点条目
    const lists = await listAll(mapped.map((c) => [c.prefix, c.remote_id]));
    const wanted = [];
    for (const c of mapped) {
      const items = (lists.get(c.prefix) || []).filter((x) => x.type === 'directory' && !isExcluded(x.name));
      const file = path.join(REPO, 'data', c.file);
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const blocks = new Map(
        text.split(/(?=- id: )/)
          .map((b) => { const m = b.match(/^- id:\s*(\S+)/); return m ? [m[1], b] : null; })
          .filter(Boolean)
      );
      let missing = 0;
      for (const d of items) {
        const m = String(d.name).match(/^(\d{1,4})\s*[-.](.+)$/);
        if (!m) { report.unmatched.push({ category: c.key, name: d.name, reason: '目录名没有编号前缀' }); continue; }
        const num = String(parseInt(m[1], 10)).padStart(3, '0');
        const id = `${c.prefix}-${num}`;
        const block = blocks.get(id);
        if (!block) { report.unmatched.push({ category: c.key, name: d.name, reason: `站点无 ${id} 条目，不自动建条目` }); continue; }
        if (block.includes('guangya_url:')) continue;
        missing++;
        wanted.push({ id, category: c.key, file, dir: d.name, remote_id: d.id });
      }
      report.categories.push({ category: c.key, dir: c.dirName, dirs: items.length, missing });
    }
    if (LIMIT > 0) wanted.length = Math.min(wanted.length, LIMIT);
    report.pending = wanted.map(({ id, category, dir }) => ({ id, category, dir }));
    console.log(`光鸭补链：扫描 ${mapped.length} 个分类，待补 ${wanted.length} 条${DRY ? '（dry-run，不出链）' : ''}`);

    if (DRY || !wanted.length) return { report, exitCode: 0 };

    // 3. 一次一批出链，每条只提交一次。已创建/结果未确认的绝不重提；
    //    SHARE_FILE_REJECTED 是 CLI 预检抛出的（尚未创建任何分享），响应里带具体 file_id，
    //    只剔除那一条并把同批其余条目作为新请求提交，不把整批都误判为失败。
    const created = new Map();
    for (let off = 0; off < wanted.length; off += 100) {
      let batch = wanted.slice(off, off + 100);
      let guard = 0;
      while (batch.length && guard++ <= 100) {
        const requestId = crypto.randomUUID();
        const payload = {
          version: 1, request_id: requestId,
          operations: batch.map((w) => ({ id: w.id, type: 'create_share', remote_ids: [w.remote_id], share_type: 0, validity_seconds: 0 })),
        };
        const run = await cli('run', payload);
        if (run.code === 'SHARE_FILE_REJECTED') {
          const badId = String(run.data?.file_id || '');
          const bad = batch.find((w) => w.remote_id === badId);
          if (bad) {
            report.failed.push({ id: bad.id, code: 'SHARE_FILE_REJECTED', message: `违规文件不能创建分享：${String(run.data?.file_name || bad.dir).slice(0, 80)}` });
            batch = batch.filter((w) => w.id !== bad.id);
            exitCode = 1;
            continue;
          }
        }
        if (run.__error || run.code !== 'OK' || /^LOGIN_/.test(String(run.code))) {
          for (const w of batch) report.failed.push({ id: w.id, code: run.code || run.__error, message: String(run.data?.message || '出链请求未通过预检，本批不重试') });
          for (const w of wanted.slice(off + batch.length)) report.skipped.push({ id: w.id, reason: '前一批出链请求未通过预检，本轮不再提交，也不重试' });
          exitCode = 1;
          break;
        }
        const batchId = run.batch_id || requestId;
        let st = run;
        for (let i = 0; i < 30 && !TERMINAL.has(st.batch_state || st.data?.batch_state); i++) {
          await sleep(1000);
          st = await cli('status', undefined, ['--batch-id', batchId]);
          if (st.__error) break;
        }
        const state = st.batch_state || st.data?.batch_state;
        if (!TERMINAL.has(state)) {
          for (const w of batch) report.unconfirmed.push({ id: w.id, batch_id: batchId, code: st.__error || 'STATUS_TIMEOUT', message: '出链结果未确认，不重提，需人工按 batch_id 核对' });
          exitCode = 1;
          break;
        }
        const items = st.data?.items || [];
        for (const w of batch) {
          const it = items.find((x) => x.operation_id === w.id);
          const url = it?.result?.shareUrl;
          if (it?.state === 'SUCCEEDED' && /^https:\/\/[^\s"]+\/s\//.test(String(url))) {
            created.set(w.id, url);
            report.created.push({ id: w.id, category: w.category, dir: w.dir, url });
          } else {
            report.failed.push({ id: w.id, code: it?.code || it?.state || 'NO_RESULT', message: String(it?.error?.message || it?.message || '出链失败，不重试') });
            exitCode = 1;
          }
        }
        break;
      }
      if (batch.length) {
        for (const w of batch) report.skipped.push({ id: w.id, reason: '同批预检拒绝次数过多，未在本轮提交' });
      }
    }

    // 4. 只把成功项写回 YAML，按文件一次性插入，保留原有行尾与其它字段
    if (created.size) {
      const byFile = new Map();
      for (const w of wanted) if (created.has(w.id)) {
        const m = byFile.get(w.file) || new Map();
        m.set(w.id, created.get(w.id));
        byFile.set(w.file, m);
      }
      for (const [file, links] of byFile) {
        const src = fs.readFileSync(file, 'utf8');
        const { text, changed, noAnchor } = insertGuangyaUrl(src, links);
        if (changed.length) fs.writeFileSync(file, text);
        for (const id of noAnchor) {
          report.failed.push({ id, code: 'NO_QUARK_URL', message: '条目缺 quark_url 锚点，未写入，需人工处理' });
          created.delete(id);
          const i = report.created.findIndex((x) => x.id === id);
          if (i >= 0) report.created.splice(i, 1);
          exitCode = 1;
        }
        console.log(`  写入 ${path.basename(file)}：${changed.length} 条`);
      }
    }
    console.log(`光鸭补链完成：成功 ${report.created.length} / 待补 ${wanted.length}，失败 ${report.failed.length}，未确认 ${report.unconfirmed.length}`);
    return { report, exitCode };
  } catch (e) {
    const msg = String(e.message || e);
    if (!report.failed.length) report.failed.push({ id: '(stage)', code: 'STAGE_ERROR', message: msg });
    console.error(`光鸭补链阶段中止：${msg}`);
    return { report, exitCode: msg === 'GUANGYA_LOGIN_REQUIRED' ? 2 : 1 };
  } finally {
    try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2)); } catch { /* 报告写不动不影响主流程 */ }
    console.log(`机读报告：${OUT}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode } = await main();
  process.exitCode = exitCode;
}
