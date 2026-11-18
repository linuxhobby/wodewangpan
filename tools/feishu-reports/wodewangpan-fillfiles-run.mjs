#!/usr/bin/env node
/**
 * 我的网盘 · 补文件清单 fill-files 一轮编排脚本
 *
 * 作用：把「对齐远端 → 跑工具 → 校验写入 → eslint + 两次构建 → 提交推送 → 飞书汇报」
 * 这一串确定性步骤收进一个脚本，任务 prompt 只剩「跑这个脚本 + 转述简报」。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-fillfiles-run.mjs
 *   node ... --dry-run          试跑：不动 git、不写盘、不发飞书，只验证流程与解析
 *   node ... --limit 3          每轮写入额度，默认 3（不要调大）
 *   node ... --no-feishu        跳过飞书卡片（调试用）
 *
 * 退出码：0 正常结束（含 0 写入 / 抓取失败）；3 停手未提交；4 环境错误（锁 / 仓库缺失）
 *
 * 规则来源：wodewangpan/AGENTS.md 的 §3 Git 约束、§4 fill-files、§5 数据铁律、§6 发布、§9 验证清单。
 * 2026-11-16 一次性转述进本脚本，此后任务执行不再读 AGENTS.md（只在脚本崩溃时人工翻手册核对）。
 * AGENTS.md 若改动，只需回来同步这几处：
 *   每轮条数与节奏      → LIMIT 硬上限、飞书 --per-day 36
 *   files: 字段集合     → FIELD_OK 白名单
 *   eslint 与两次构建   → 第 5、6 段
 *   commit message 格式 → 第 7 段
 *   飞书卡片参数        → finish() 里的 FEISHU 调用
 *   发布方式            → 本脚本不发布，只 push，等 VPS 每 2 小时 :30 的 cron
 * 运行日志与锁：~/.cache/wdp-fillfiles-*.log 与 ~/.cache/wdp-fillfiles.lock（不再新建工作目录）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.WDP_REPO || path.resolve(SCRIPTS, '..', '..');
const FEISHU = path.join(SCRIPTS, 'wodewangpan-fillfiles-feishu.mjs');
const LOG_DIR = path.join(os.homedir(), '.cache');
const LOCK = path.join(LOG_DIR, 'wdp-fillfiles.lock');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_FEISHU = argv.includes('--no-feishu');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  const v = i >= 0 ? parseInt(argv[i + 1], 10) : 3;
  if (!Number.isFinite(v) || v < 0) return 3;
  return v > 3 ? 3 : v; // 硬上限：每轮 3 条，禁止自己加量
})();

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const stamp = `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `wdp-fillfiles-${today}-${pad(now.getHours())}${pad(now.getMinutes())}.log`);
let logFd = null;
try {
  logFd = fs.openSync(LOG_FILE, 'a');
} catch {
  logFd = null;
}

function log(msg = '') {
  process.stdout.write(`${msg}\n`);
  if (logFd) {
    try {
      fs.writeSync(logFd, `${msg}\n`);
    } catch {
      /* 日志写失败不影响主流程 */
    }
  }
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeout || 900000,
    env: process.env,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, code: r.status, out, stdout: (r.stdout || '').trim() };
}
const git = (...args) => sh('git', args);
const node = (args, opts) => sh(process.execPath, args, opts);

// ---------------------------------------------------------------------------
// 本轮结果状态：所有分支最终都走 finish()，保证「每轮必发一张卡」
// ---------------------------------------------------------------------------
const R = {
  status: '成功',
  entries: [], // {id, kind: 完成|失败|跳过, detail}
  refreshed: [], // 连载轮询真正刷新的条目
  pendingCount: null,
  serial: { changed: 0, unchanged: 0, fail: 0 },
  serialIssues: [],
  todoEmpty: [],
  airing: null,
  follow: [],
  notes: [],
  commitHash: null,
  pushed: false,
  build1: null,
  build2Regen: null,
  eslint: null,
  feishu: null,
  reasons: [], // 停手原因
};

/** 拿 data/*.yaml 的 id → {title, category}，口径与飞书脚本一致 */
function loadIndex() {
  const byId = new Map();
  const dir = path.join(REPO, 'data');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') && f !== 'site.yaml');
  } catch {
    return byId;
  }
  for (const name of names) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    const starts = [];
    const lines = raw.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/^- /.test(l)) starts.push(i);
    });
    starts.push(lines.length);
    for (let s = 0; s < starts.length - 1; s++) {
      const block = lines.slice(starts[s], starts[s + 1]);
      const idm = block[0].match(/^- id:\s*(\S+)/);
      if (!idm) continue;
      const pick = (k) => {
        const hit = block.find((l) => new RegExp(`^\\s*${k}:`).test(l));
        if (!hit) return '';
        return hit
          .replace(new RegExp(`^\\s*${k}:\\s*`), '')
          .replace(/^["']|["']$/g, '')
          .trim();
      };
      byId.set(idm[1], { title: pick('title'), category: pick('category') });
    }
  }
  return byId;
}

function itemLabel(id, byId) {
  const m = byId.get(id);
  if (!m) return id;
  return `${id} ${m.title}（${m.category || '其他'}）`;
}

// ---------------------------------------------------------------------------
// 输出解析
// ---------------------------------------------------------------------------
function parseToolOutput(out) {
  const entries = [];
  const refreshed = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s*…\s*(完成|失败|跳过)（(.*)）\s*$/);
    if (m) {
      entries.push({ id: m[1], kind: m[2], detail: m[3] });
      continue;
    }
    const r = line.match(/^(\S+)\s*…\s*已刷新（(.*)）\s*$/);
    if (r) refreshed.push({ id: r[1], detail: r[2] });
  }
  const p = out.match(/待补条目：(\d+)\s*个/);
  const s = out.match(/\[连载轮询\]\s*刷新\s*(\d+)\s*·\s*无变化\s*(\d+)\s*·\s*失败\s*(\d+)/);
  const todo = out.match(/\[待加资源\]\s*盘端仍空\s*\d+\s*条：(.+)$/m);
  const airing = out.match(/^\[追更提醒\].*$/m);
  const airingHit = airing ? Number((airing[0].match(/本轮命中\s*(\d+)\s*条/) || [])[1] || 0) : 0;
  return {
    entries,
    refreshed,
    pendingCount: p ? Number(p[1]) : null,
    serial: s ? { changed: Number(s[1]), unchanged: Number(s[2]), fail: Number(s[3]) } : null,
    todoEmpty: todo && todo[1] !== '无' ? todo[1].split('、').map((x) => x.trim()).filter(Boolean) : [],
    airing: airing && airingHit > 0 ? airing[0].trim() : null,
    serialIssues: (() => {
      const idx = out.indexOf('连载轮询失败清单');
      if (idx < 0) return [];
      return out
        .slice(idx)
        .split(/\r?\n/)
        .slice(1, 6)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-') || /^[a-z]{2,3}-\d/.test(l));
    })(),
  };
}

// ---------------------------------------------------------------------------
// diff 白名单校验：只允许 files: 块与 updated 变动
// ---------------------------------------------------------------------------
const FIELD_OK = [
  /^  updated: \d{4}-\d{2}-\d{2}$/,
  /^  files:$/,
  /^    (count|episodes|size|format|resolution|audio|subtitle|packed|tree):/,
  /^      .*$/, // tree 内容（6 空格缩进）
];

function checkDiff(diffText) {
  const bad = [];
  let plusFiles = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (!line) continue;
    if (/^(diff --git|index |--- |\+\+\+ |@@|\\ No newline)/.test(line)) continue;
    const sign = line[0];
    if (sign !== '+' && sign !== '-') continue;
    const body = line.slice(1);
    if (sign === '+' && /^  files:$/.test(body)) plusFiles++;
    if (!FIELD_OK.some((re) => re.test(body))) bad.push(line.slice(0, 140));
  }
  return { bad, plusFiles };
}

// ---------------------------------------------------------------------------
// 收尾：拼飞书卡片 + 打印简报
// ---------------------------------------------------------------------------
function finish(code = 0) {
  const byId = loadIndex();
  const ok = R.entries.filter((e) => e.kind === '完成');
  const failed = R.entries.filter((e) => e.kind === '失败');
  const skipped = R.entries.filter((e) => e.kind === '跳过');

  // ---- --name：写入条目的「id 标题（分类）」一行 ----
  let name;
  if (R.status === '工作区不干净') {
    name = '工作区不干净 · 本轮未执行';
  } else if (ok.length) {
    name = ok.map((e) => itemLabel(e.id, byId)).join('｜');
  } else {
    const first = R.entries[0];
    name = first
      ? `${itemLabel(first.id, byId)} 等 ${R.entries.length} 条 · 未写入`
      : '本轮未写入任何条目';
  }

  // ---- --detail ----
  const totalItems = ok.reduce((acc, e) => {
    const m = e.detail.match(/^(\d+)\s*项/);
    return acc + (m ? Number(m[1]) : 0);
  }, 0);
  // 体积汇总：统一折算到 MB 再求和，避免「3.6 GB / 3.4 GB / 2.2 GB」堆一串
  const sizeMb = ok.reduce((acc, e) => {
    const m = e.detail.match(/(\d+(?:\.\d+)?)\s*([KMGT]B)/);
    if (!m) return acc;
    const v = Number(m[1]);
    const unit = { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 }[m[2]] || 1;
    return acc + v * unit;
  }, 0);
  const sizeStr = sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : sizeMb > 0 ? `${sizeMb.toFixed(1)} MB` : '';
  const formats = ok
    .map((e) => e.detail.split(' · ').slice(-1)[0])
    .filter((f) => f && !/项|KB|MB|GB|TB/.test(f));

  let detail;
  if (R.status === '成功' && ok.length) {
    detail = `本轮补成 ${ok.length}/${LIMIT}：合计 ${totalItems} 项` +
      (sizeStr ? ` / ${sizeStr}` : '') +
      (formats.length ? ` / ${formats[0]}` : '') +
      (R.commitHash ? ` ｜ commit ${R.commitHash} 已推送` : '');
  } else if (R.status === '成功' && R.serial.changed) {
    detail = `本轮补齐 0 条 · 连载刷新 ${R.serial.changed} 条` +
      (R.commitHash ? ` ｜ commit ${R.commitHash} 已推送` : '');
  } else if (R.status === '停手未提交' || R.status === '工作区不干净') {
    detail = R.reasons.join('；') || '本轮停手未提交';
  } else if (failed.length) {
    detail = `本轮 0 条写入，全部失败：${failed.map((e) => `${e.id} ${e.detail}`).join('；')}`;
  } else if (skipped.length) {
    detail = `本轮 0 条写入，全部跳过：${skipped[0].detail}`;
  } else {
    detail = '本轮 0 条写入';
  }
  if (detail.length > 300) detail = `${detail.slice(0, 297)}…`;

  // ---- --follow ----
  const follow = [...R.follow];
  for (const f of failed) follow.push(`${f.id}: ${f.detail}`);
  for (const s of R.serialIssues) follow.push(s);
  if (R.todoEmpty.length) follow.push(`待加资源（盘端仍空，需转存）：${R.todoEmpty.join('、')}`);
  if (R.airing) follow.push(R.airing);

  // ---- 发飞书 ----
  if (DRY || NO_FEISHU) {
    log(`[飞书] 试跑/跳过，未发送。将用：--status ${R.status} --name "${name}" --detail "${detail}"` +
      (follow.length ? ` --follow "${follow.join('｜')}"` : ''));
    R.feishu = DRY ? '试跑未发' : '已关闭';
  } else {
    const send = () => {
      const a = [FEISHU, '--name', name, '--status', R.status, '--detail', detail];
      if (follow.length) a.push('--follow', follow.slice(0, 8).join('｜'));
      const r = node(a, { cwd: SCRIPTS, timeout: 180000 });
      return { ok: r.ok, out: r.out };
    };
    let res = send();
    if (!res.ok) {
      R.notes.push('飞书首次推送失败，重试 1 次');
      res = send();
    }
    const mid = res.out.match(/message_id\s+([A-Za-z0-9_-]+)/);
    R.feishu = res.ok ? `✓ 已推送${mid ? ` (${mid[1]})` : ''}` : `× 失败（${res.out.split('\n').slice(-2).join(' ')}）`;
    log(`[飞书] ${R.feishu}`);
  }

  // ---- 简报 ----
  const brief = [];
  if (R.status === '工作区不干净') {
    brief.push(`本轮未执行：工作区有非本轮改动（${R.reasons.join('；') || '见日志'}）`);
  } else if (R.status === '停手未提交') {
    brief.push(`本轮停手未提交：${R.reasons.join('；') || '见日志'}`);
  } else if (ok.length) {
    brief.push(`本轮补齐 ${ok.length}/${LIMIT}：${ok.map((e) => itemLabel(e.id, byId)).join('、')}`);
    brief.push(`合计 ${totalItems} 项${sizeStr ? ` / ${sizeStr}` : ''}${formats.length ? ` / ${formats[0]}` : ''}`);
  } else {
    brief.push(`本轮补齐 0 条`);
  }
  if (R.pendingCount !== null) brief.push(`待补条目 ${R.pendingCount} 个｜连载刷新 ${R.serial.changed} · 无变化 ${R.serial.unchanged} · 失败 ${R.serial.fail}`);
  if (failed.length) brief.push(`失败 ${failed.length} 条：${failed.map((e) => e.id).join('、')}`);
  if (skipped.length) brief.push(`跳过 ${skipped.length} 条：${skipped.map((e) => e.id).join('、')}`);
  if (R.eslint !== null || R.build1 !== null) {
    brief.push(
      `eslint ${R.eslint ?? '未跑'}｜build 第一次${R.build1 === true ? '通过' : R.build1 === false ? '失败' : '未跑'}` +
        `${R.build2Regen !== null ? `，第二次重新生成 ${R.build2Regen} 个` : ''}`
    );
  }
  if (R.commitHash) brief.push(`commit ${R.commitHash} ${R.pushed ? '已推送，等 site 下一班上线（约 2 小时后）' : '未推送'}`);
  if (R.notes.length) brief.push(`备注：${R.notes.join('；')}`);
  brief.push(`飞书 ${R.feishu || '未发'}｜日志 ${LOG_FILE}`);

  log('\n===== 简报 =====');
  for (const l of brief) log(l);
  log('===============');

  if (logFd) try { fs.closeSync(logFd); } catch { /* ignore */ }
  try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 锁：上一轮没跑完就不要叠着跑
// ---------------------------------------------------------------------------
(function acquire() {
  try {
    const st = fs.statSync(LOCK);
    const pid = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // 只探测存在性，不发信号
        alive = true;
      } catch (e) {
        alive = e && e.code === 'EPERM'; // 存在但无权操作，也算活着
      }
    }
    const fresh = Date.now() - st.mtimeMs < 35 * 60 * 1000;
    if (alive && fresh) {
      log(`上一轮仍在运行（pid ${pid}，锁 ${LOCK}），本轮跳过。`);
      process.exit(0);
    }
    log(`清理残留锁（pid ${pid} ${alive ? '存活但已超 35 分钟' : '已不存在'}）`);
    fs.unlinkSync(LOCK);
  } catch {
    /* 无锁 */
  }
  fs.writeFileSync(LOCK, String(process.pid));
})();

// ---------------------------------------------------------------------------
// 0. 环境自检
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(REPO, 'package.json'))) {
  log(`✗ 仓库不存在：${REPO}`);
  R.status = '失败';
  R.reasons.push('仓库路径不存在');
  finish(4);
}

log(`fill-files 编排开始 ${stamp}${DRY ? '（试跑）' : ''} · 额度 ${LIMIT}`);
log(`仓库 ${REPO}`);

// ---------------------------------------------------------------------------
// 1. 对齐远端
// ---------------------------------------------------------------------------
if (!DRY) {
  const st = git('status', '--short');
  if (!st.ok) {
    R.status = '失败';
    R.reasons.push(`git status 失败：${st.out.slice(0, 200)}`);
    finish(3);
  }
  if (st.out.trim()) {
    R.status = '工作区不干净';
    const files = st.out.split(/\r?\n/).slice(0, 6).join('、');
    R.reasons.push(`未提交改动：${files}`);
    log(`✗ 工作区不干净：\n${st.out}`);
    log('  按规则不 stash、不丢弃、不写入，本轮结束。');
    finish(0);
  }

  const f = git('fetch', 'origin');
  if (!f.ok) {
    R.status = '失败';
    R.reasons.push(`git fetch 失败：${f.out.slice(0, 200)}`);
    finish(3);
  }
  const pull = git('pull', '--rebase', 'origin', 'main');
  if (!pull.ok) {
    git('rebase', '--abort');
    R.status = '停手未提交';
    R.reasons.push(`rebase 冲突，已 abort：${pull.out.split(/\r?\n/).slice(0, 3).join(' ').slice(0, 200)}`);
    log(`✗ pull --rebase 失败，已 abort：\n${pull.out}`);
    R.follow.push('需要人工跟进：rebase 冲突');
    finish(3);
  }
  log(`✓ 已对齐 origin/main（${pull.out.split(/\r?\n/)[0] || 'up to date'}）`);
} else {
  const st = git('status', '--short');
  log(`[试跑] 工作区${st.out.trim() ? '不干净（真实运行会直接结束）' : '干净'}`);
}

// ---------------------------------------------------------------------------
// 2. 跑工具
// ---------------------------------------------------------------------------
const toolArgs = ['tools/fill-files.mjs', '--limit', String(LIMIT), '--delay', DRY ? '2000' : '3000'];
if (DRY) toolArgs.push('--dry-run');
log(`\n$ node ${toolArgs.join(' ')}`);
const ff = node(toolArgs, { timeout: 1800000 });
log(ff.out || '（无输出）');

const P = parseToolOutput(ff.out);
R.entries = P.entries;
R.refreshed = P.refreshed || [];
R.pendingCount = P.pendingCount;
R.serial = P.serial || R.serial;
R.serialIssues = P.serialIssues;
R.todoEmpty = P.todoEmpty;
R.airing = P.airing;

if (!ff.ok && !P.entries.length) {
  R.status = '失败';
  R.reasons.push(`fill-files 退出码 ${ff.code}，无有效输出`);
  finish(3);
}
log(`\n解析：完成 ${P.entries.filter((e) => e.kind === '完成').length} · 跳过 ${P.entries.filter((e) => e.kind === '跳过').length} · 失败 ${P.entries.filter((e) => e.kind === '失败').length}`);

const okCount = R.entries.filter((e) => e.kind === '完成').length;
const wroteSomething = okCount > 0 || R.serial.changed > 0;

// ---------------------------------------------------------------------------
// 3. 校验写入
// ---------------------------------------------------------------------------
if (DRY) {
  log('[试跑] 跳过 diff 校验与提交；试跑不写盘，工作区应保持干净。');
  const st = git('status', '--short');
  if (st.out.trim()) {
    R.notes.push(`试跑后工作区出现改动（异常，需检查）：${st.out.split(/\r?\n/).slice(0, 3).join('、')}`);
  } else {
    R.notes.push('试跑后工作区仍干净，写入路径未触发');
  }
  finish(0);
}

const diffR = git('diff', '--', 'data/');
const { bad, plusFiles } = checkDiff(diffR.out);

if (bad.length) {
  R.status = '停手未提交';
  R.reasons.push(`diff 越界 ${bad.length} 行`);
  for (const b of bad.slice(0, 5)) R.follow.push(`可疑改动：${b.trim()}`);
  log(`✗ diff 出现 files:/updated 之外的改动，整轮不提交：`);
  for (const b of bad.slice(0, 10)) log(`  ${b}`);
  finish(3);
}

if (okCount > 0 && plusFiles === 0) {
  R.status = '停手未提交';
  R.reasons.push(`工具报写入 ${okCount} 条，但 data/ 无 files: 新增`);
  finish(3);
}
if (okCount === 0 && R.serial.changed === 0 && diffR.out.trim()) {
  R.status = '停手未提交';
  R.reasons.push('工具报 0 条写入，但 data/ 有改动');
  finish(3);
}
log(`✓ 写入校验通过：新增 files: 块 ${plusFiles} 个，diff 未越界`);

// ---------------------------------------------------------------------------
// 4. 0 写入：不提交，直接汇报
// ---------------------------------------------------------------------------
if (!wroteSomething) {
  const allFail = R.entries.length > 0 && R.entries.every((e) => e.kind !== '完成');
  R.status = allFail && R.entries.some((e) => e.kind === '失败') ? '失败' : '跳过';
  R.serial.fail = R.serial.fail || 0;
  log('本轮 0 条写入（全失败或全跳过），不产生 commit。');
  finish(0);
}

// ---------------------------------------------------------------------------
// 5. eslint
// ---------------------------------------------------------------------------
{
  const eslintBin = path.join(REPO, 'node_modules/eslint/bin/eslint.js');
  if (!fs.existsSync(eslintBin)) {
    R.eslint = '未执行（依赖未安装）';
    R.notes.push('eslint 未执行：node_modules 缺 eslint，需人工 npm install');
  } else {
    const e = node(['node_modules/eslint/bin/eslint.js', 'scripts/'], { timeout: 300000 });
    if (e.ok) {
      R.eslint = '0 错误';
      log('✓ eslint 通过');
    } else {
      R.status = '停手未提交';
      R.reasons.push(`eslint 报错：${e.out.split(/\r?\n/).slice(-5).join(' ').slice(0, 200)}`);
      log(`✗ eslint 未通过，本轮不提交：\n${e.out}`);
      finish(3);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. 两次构建
// ---------------------------------------------------------------------------
{
  const b1 = node(['scripts/build.js'], { timeout: 600000 });
  R.build1 = b1.ok;
  if (!b1.ok) {
    R.status = '停手未提交';
    R.reasons.push(`第一次 build 失败：${b1.out.split(/\r?\n/).slice(-4).join(' ').slice(0, 240)}`);
    log(`✗ 第一次 build 失败，本轮不提交：\n${b1.out.slice(-2000)}`);
    finish(3);
  }
  log('✓ 第一次 build 通过');
  const b2 = node(['scripts/build.js'], { timeout: 600000 });
  const m = b2.out.match(/重新生成\s*(\d+)\s*个/);
  R.build2Regen = m ? Number(m[1]) : null;
  if (!b2.ok) {
    R.notes.push('第二次 build 失败（首次已通过，照常提交）');
  } else if (R.build2Regen === null) {
    R.notes.push('第二次 build 未打印「重新生成 N 个」');
  } else if (R.build2Regen !== 0) {
    R.notes.push(`第二次构建重新生成 ${R.build2Regen} 个（预期 0）`);
  }
  log(`✓ 第二次 build 完成，重新生成 ${R.build2Regen ?? '未打印'} 个`);
}

// ---------------------------------------------------------------------------
// 7. 提交推送
// ---------------------------------------------------------------------------
{
  const okIds = R.entries.filter((e) => e.kind === '完成').map((e) => e.id);
  const rIds = R.refreshed.map((r) => r.id);
  let msg;
  if (okIds.length) {
    msg = `data: fill-files 补 ${okIds.length} 条文件清单（${okIds.join('、')}）`;
    if (R.serial.changed) msg += ` · 连载刷新 ${R.serial.changed} 条${rIds.length ? `（${rIds.join('、')}）` : ''}`;
  } else {
    msg = `data: fill-files 连载刷新 ${R.serial.changed} 条${rIds.length ? `（${rIds.join('、')}）` : ''}`;
  }

  const add = git('add', 'data/');
  if (!add.ok) {
    R.status = '停手未提交';
    R.reasons.push(`git add 失败：${add.out.slice(0, 200)}`);
    finish(3);
  }
  const commit = git('commit', '-m', msg);
  if (!commit.ok) {
    R.status = '停手未提交';
    R.reasons.push(`git commit 失败：${commit.out.slice(0, 200)}`);
    finish(3);
  }
  const hash = git('rev-parse', '--short', 'HEAD');
  R.commitHash = hash.out.trim().split(/\r?\n/).pop() || null;
  log(`✓ 已提交 ${R.commitHash}：${msg}`);

  const pull = git('pull', '--rebase', 'origin', 'main');
  if (!pull.ok) {
    git('rebase', '--abort');
    R.status = '停手未提交';
    R.reasons.push(`提交后 rebase 冲突，已 abort（本地有 1 个未推送提交）`);
    R.follow.push(`需要人工跟进：${R.commitHash} 提交未推送，rebase 冲突`);
    finish(3);
  }

  let push = git('push', 'origin', 'main');
  if (!push.ok) {
    log(`! 首次 push 失败，重试一次：${push.out.split(/\r?\n/).slice(0, 3).join(' ')}`);
    const p2 = git('pull', '--rebase', 'origin', 'main');
    if (!p2.ok) {
      git('rebase', '--abort');
      R.status = '停手未提交';
      R.reasons.push('push 被拒后 rebase 冲突，已 abort');
      finish(3);
    }
    push = git('push', 'origin', 'main');
  }
  if (push.ok) {
    R.pushed = true;
    log('✓ 已推送 origin/main');
  } else {
    R.status = '失败';
    R.reasons.push(`push 失败（本地已提交 ${R.commitHash}，需人工处理）`);
    log(`✗ push 失败：${push.out}`);
  }
}

finish(R.status === '成功' ? 0 : 3);
