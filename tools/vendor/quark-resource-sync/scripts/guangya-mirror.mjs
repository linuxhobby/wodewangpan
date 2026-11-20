#!/usr/bin/env node
/**
 * 光鸭网盘镜像 TMDB 今日热门（trending-sync 的后置阶段）。
 *
 *   node guangya-mirror.mjs --dry-run      # 只读扫描 + 报告，不建目录、不出链、不改 YAML
 *   node guangya-mirror.mjs                # 真跑：建目录 → 出链 → 写 guangya_url
 *
 * 口径（2026-11-16 指挥官定）：
 * - TMDB 任务只建空目录 + 出链，不转存内容；内容后续由人工或其它任务搬运。
 * - 输入读 trending-last.json 的 created[]（kind/id/dirname/quark_url），
 *   在光鸭 SHARE 对应分类（movie→04电影 / tv→03电视剧 / anime→05动漫）下建同名目录。
 * - 光鸭分类下已有同编号目录就复用，不重建、不改名；同名冲突按失败记录，不覆盖。
 * - 出链一次提交（share_type=0 无提取码、永久），失败只记录，绝不重试。
 * - 只给缺 guangya_url 的条目出链并写回该字段，幂等；不新建条目、不碰其它字段。
 * - 本阶段自己 commit + push（data: 光鸭链接 …），VPS 重建由主流程在镜像成功后统一触发。
 * - 报告写 CACHE/guangya-mirror-last.json（~/.cache/quark-sync）。
 *
 * 依赖光鸭 skill：~/.workbuddy/skills/guangyapan-drive（bundled 版，勿 npm install）。
 * 实例绑定走 ~/.workbuddy/guangyapan-instance-id。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cfg, CACHE } from './lib/config.mjs';
import { insertGuangyaUrl } from './guangya-sync.mjs';

const HOME = os.homedir();
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const DRY = process.argv.includes('--dry-run');
const REPO = arg('repo', cfg.REPO);
const REPORT_IN = arg('report', path.join(CACHE, 'trending-last.json'));
const OUT = arg('out', path.join(CACHE, 'guangya-mirror-last.json'));
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const SHARE_ID = arg('share-id', process.env.GUANGYA_SHARE_ID || '1968992882272407648');
const DO_COMMIT = !process.argv.includes('--no-commit');
const DRIVE_SKILL = process.env.GUANGYA_SKILL_DIR || path.join(HOME, '.workbuddy', 'skills', 'guangyapan-drive');
const DRIVE_CLI = process.env.GUANGYA_CLI || path.join(DRIVE_SKILL, 'bin', 'guangyapan.mjs');
const AGENT = process.env.GUANGYA_AGENT_NAME || 'WorkBuddy';
const IID_FILE = process.env.GUANGYA_INSTANCE_ID_FILE
  || [
    path.join(HOME, '.workbuddy', 'guangyapan-instance-id'),
    path.join(HOME, '.workbuddy', 'guangyapan-drive-instance-id'),
  ].find((p) => fs.existsSync(p))
  || path.join(HOME, '.workbuddy', 'guangyapan-instance-id');
const IID = process.env.GUANGYA_INSTANCE_ID || (() => {
  try { return fs.readFileSync(IID_FILE, 'utf8').trim(); } catch { return ''; }
})();

// TMDB 任务的三类 → 光鸭 SHARE 分类目录 id。目录 id 与光鸭侧实际结构一致（2026-11-16 实测）。
const KINDS = {
  movie: { dir: '04电影', remote: '1968993535304577054', prefix: 'mv', file: 'movie.yaml' },
  tv:    { dir: '03电视剧', remote: '1968993518137270362', prefix: 'tv', file: 'tv.yaml' },
  anime: { dir: '05动漫', remote: '1968993551783989255', prefix: 'an', file: 'anime.yaml' },
};

function cli(command, payload, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [DRIVE_CLI, command, ...extraArgs, '--agent-name', AGENT];
    if (IID) args.push('--agent-instance-id', IID);
    let out = '', err = '', settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish({ __error: 'CLI_TIMEOUT' }); }, 90_000);
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

/** 提交一批写操作并轮询到终态；返回 data.items（终态未达时返回 null）。不重试。 */
async function runBatch(ops) {
  const run = await cli('run', { version: 1, request_id: crypto.randomUUID(), operations: ops });
  if (run.__error || run.code !== 'OK' || /^LOGIN_/.test(String(run.code))) {
    return { items: null, code: run.code || run.__error || 'UNKNOWN', message: String(run.data?.message || '') };
  }
  const batchId = run.batch_id || run.request_id;
  let st = run;
  for (let i = 0; i < 30 && !TERMINAL.has(st.batch_state); i++) {
    await sleep(1000);
    st = await cli('status', undefined, ['--batch-id', batchId]);
    if (st.__error) break;
  }
  if (!TERMINAL.has(st.batch_state)) return { items: null, code: 'STATUS_TIMEOUT', message: `batch ${batchId} 未到终态`, batch_id: batchId };
  return { items: st.data?.items || [], batch_id: batchId, state: st.batch_state };
}

async function listDir(remoteId) {
  const items = [];
  for (let page = 0; page < 20; page++) {
    const res = await cli('run', { version: 1, request_id: crypto.randomUUID(), operations: [{ id: `p${page}`, type: 'list', remote_parent_id: remoteId, page, page_size: 100 }] });
    if (res.__error || res.code !== 'OK') throw new Error(`光鸭 list 失败：${res.code || res.__error}`);
    const it = res.data?.items?.[0];
    if (!it || it.state !== 'SUCCEEDED') throw new Error(`光鸭 list 未成功：${it?.state || 'NO_RESULT'}`);
    items.push(...(it.result?.items || []));
    if (!it.result?.has_more) break;
  }
  return items;
}

async function main() {
  const report = {
    ran_at: new Date().toISOString(),
    repo: REPO, source: REPORT_IN, dry_run: DRY,
    login_required: false, input: 0, pending: [], folders_created: [], reused: [],
    created: [], failed: [], unconfirmed: [], skipped: [], commit: null, pushed: false,
    note: '镜像目录为空目录（内容后续人工或其它任务搬运）；分享链接创建成功仅代表链接生成，内容需经分享审核。',
  };
  let exitCode = 0;
  try {
    if (!REPO || !fs.existsSync(path.join(REPO, 'data'))) throw new Error(`站点仓库不可用：${REPO}`);
    if (!fs.existsSync(DRIVE_CLI)) throw new Error(`光鸭 CLI 不存在：${DRIVE_CLI}`);
    if (!IID) throw new Error('缺少光鸭实例绑定：guangyapan-instance-id 不可用');
    if (!fs.existsSync(REPORT_IN)) throw new Error(`找不到 trending 报告：${REPORT_IN}`);
    const trending = JSON.parse(fs.readFileSync(REPORT_IN, 'utf8'));
    const createdAll = trending.created || [];
    report.input = createdAll.length;
    if (!createdAll.length) { console.log('trending 报告无新增条目，光鸭镜像无事可做'); return { report, exitCode: 0 }; }

    const login = await cli('login-status');
    if (login.__error || login.data?.logged_in !== true) {
      report.login_required = true;
      report.failed.push({ id: '(login)', code: login.code || login.__error || 'UNKNOWN', message: '光鸭登录态失效或暂时不可验证，本阶段跳过，不自动登录、不重试' });
      throw new Error('GUANGYA_LOGIN_REQUIRED');
    }

    // 1. 读 YAML 条目块，过滤掉已有 guangya_url 的
    const wanted = [];
    const blocksByFile = new Map();
    for (const e of createdAll) {
      const k = KINDS[e.kind];
      if (!k) { report.skipped.push({ id: e.id, reason: `未知 kind ${e.kind}，不镜像` }); continue; }
      const file = path.join(REPO, 'data', k.file);
      if (!blocksByFile.has(file)) {
        const text = fs.readFileSync(file, 'utf8');
        blocksByFile.set(file, new Map(
          text.split(/(?=- id: )/).map((b) => { const m = b.match(/^- id:\s*(\S+)/); return m ? [m[1], b] : null; }).filter(Boolean)
        ));
      }
      const block = blocksByFile.get(file).get(e.id);
      if (!block) { report.skipped.push({ id: e.id, reason: `站点 ${k.file} 无 ${e.id} 条目` }); continue; }
      if (block.includes('guangya_url:')) { report.skipped.push({ id: e.id, reason: '已有 guangya_url，幂等跳过' }); continue; }
      if (!e.dirname) { report.skipped.push({ id: e.id, reason: 'trending 报告缺 dirname' }); continue; }
      wanted.push({ id: e.id, dirname: e.dirname, kind: e.kind, cat: k, file });
    }
    if (LIMIT > 0) wanted.length = Math.min(wanted.length, LIMIT);
    report.pending = wanted.map((w) => ({ id: w.id, dirname: w.dirname, category: w.cat.dir }));
    console.log(`光鸭镜像：trending 新增 ${report.input} 条，待镜像 ${wanted.length} 条${DRY ? '（dry-run，不动网盘）' : ''}`);
    if (DRY || !wanted.length) return { report, exitCode: 0 };

    // 2. 列光鸭分类目录，按编号前缀找同名目录（有就复用，不重建）
    const catIds = [...new Set(wanted.map((w) => w.cat.remote))];
    const catItems = new Map();
    for (const cid of catIds) catItems.set(cid, await listDir(cid));
    const numOf = (dirname) => (String(dirname).match(/^(\d{1,4})\s*[-.]/) || [])[1];
    for (const w of wanted) {
      const num = numOf(w.dirname);
      const hit = num && catItems.get(w.cat.remote).find(
        (x) => x.type === 'directory' && String(parseInt(num, 10)) === String(parseInt((String(x.name).match(/^(\d{1,4})\s*[-.]/) || [])[1] || 'x', 10))
      );
      if (hit) { w.remote_id = hit.id; w.resolved = 'reused'; report.reused.push({ id: w.id, dir: hit.name }); }
    }

    // 3. 缺目录的一次建齐（create_folder 返回 fileId），失败不重试
    const needFolder = wanted.filter((w) => !w.remote_id);
    if (needFolder.length) {
      const r = await runBatch(needFolder.map((w) => ({ id: `mk-${w.id}`, type: 'create_folder', remote_parent_id: w.cat.remote, name: w.dirname })));
      if (!r.items) {
        for (const w of needFolder) report.failed.push({ id: w.id, code: r.code, message: `建目录请求未通过：${r.message}，本批不重试` });
        exitCode = 1;
      } else {
        for (const w of needFolder) {
          const it = r.items.find((x) => x.operation_id === `mk-${w.id}`);
          const fid = it?.result?.fileId;
          if (it?.state === 'SUCCEEDED' && fid) {
            w.remote_id = fid; w.resolved = 'created';
            report.folders_created.push({ id: w.id, dirname: w.dirname, remote_id: fid });
          } else {
            report.failed.push({ id: w.id, code: it?.code || it?.state || 'NO_RESULT', message: String(it?.error?.message || it?.message || '建目录失败，不重试') });
            exitCode = 1;
          }
        }
      }
    }

    // 4. 对已拿到 remote_id 的目录出链，每条一次提交
    const linkable = wanted.filter((w) => w.remote_id);
    if (linkable.length) {
      const r = await runBatch(linkable.map((w) => ({ id: w.id, type: 'create_share', remote_ids: [w.remote_id], share_type: 0, validity_seconds: 0 })));
      if (!r.items) {
        for (const w of linkable) report.failed.push({ id: w.id, code: r.code, message: `出链请求未通过：${r.message}，本批不重试` });
        exitCode = 1;
      } else {
        const got = new Map();
        for (const w of linkable) {
          const it = r.items.find((x) => x.operation_id === w.id);
          const url = it?.result?.shareUrl;
          if (it?.state === 'SUCCEEDED' && /^https:\/\/[^\s"]+\/s\//.test(String(url))) {
            got.set(w.id, url);
            report.created.push({ id: w.id, dirname: w.dirname, category: w.cat.dir, folder: w.resolved, url });
          } else {
            report.failed.push({ id: w.id, code: it?.code || it?.state || 'NO_RESULT', message: String(it?.error?.message || it?.message || '出链失败，不重试') });
            exitCode = 1;
          }
        }
        // 5. 成功项写回 YAML（guangya_url 插到 quark_url 之后）
        if (got.size) {
          const byFile = new Map();
          for (const w of linkable) if (got.has(w.id)) {
            const m = byFile.get(w.file) || new Map();
            m.set(w.id, got.get(w.id));
            byFile.set(w.file, m);
          }
          for (const [file, links] of byFile) {
            const src = fs.readFileSync(file, 'utf8');
            const { text, changed, noAnchor } = insertGuangyaUrl(src, links);
            if (changed.length) fs.writeFileSync(file, text);
            for (const id of noAnchor) {
              report.failed.push({ id, code: 'NO_QUARK_URL', message: '条目缺 quark_url 锚点，未写入，需人工处理' });
              exitCode = 1;
            }
            console.log(`  写入 ${path.basename(file)}：${changed.length} 条`);
          }
        }
      }
    }

    console.log(`光鸭镜像完成：出链成功 ${report.created.length} / ${wanted.length}，建目录 ${report.folders_created.length}，复用 ${report.reused.length}，失败 ${report.failed.length}，未确认 ${report.unconfirmed.length}`);
    if (exitCode === 0 && report.created.length && DO_COMMIT) {
      const { execFileSync } = await import('node:child_process');
      const files = [...new Set(wanted.filter((w) => report.created.some((c) => c.id === w.id)).map((w) => w.file))];
      execFileSync('git', ['add', ...files.map((f) => path.relative(REPO, f))], { cwd: REPO });
      const summary = report.created.map((c) => c.id).join('、');
      execFileSync('git', ['commit', '--quiet', '-m', `data: 光鸭镜像 TMDB 今日热门 ${report.created.length} 条（${summary}）`], { cwd: REPO });
      report.commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(); } catch { return null; } })();
      try {
        execFileSync('git', ['fetch', 'origin'], { cwd: REPO, stdio: 'pipe' });
        execFileSync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO, stdio: 'pipe' });
        execFileSync('git', ['push', 'origin', 'main'], { cwd: REPO, stdio: 'pipe' });
        report.pushed = true;
        console.log(`  已提交并推送：commit ${report.commit}`);
      } catch (e) {
        report.pushed = false;
        report.failed.push({ id: '(push)', code: 'GIT_PUSH', message: `推送失败（本地提交 ${report.commit} 已保留，可手动 push）：${String(e.stderr || e.message).slice(0, 160)}` });
        exitCode = 1;
      }
    }
    return { report, exitCode };
  } catch (e) {
    const msg = String(e.message || e);
    if (!report.failed.length) report.failed.push({ id: '(stage)', code: 'STAGE_ERROR', message: msg });
    console.error(`光鸭镜像阶段中止：${msg}`);
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
