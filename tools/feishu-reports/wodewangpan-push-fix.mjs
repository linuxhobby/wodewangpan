#!/usr/bin/env node
/**
 * 「我的网盘.TG / Bluesky 推送自动追平」——只补真缺发，绝不碰节奏错位。
 *
 * 背景：wodewangpan-push-sync.mjs 每小时 :05 只对账发橙色告警，人工补发经常滞后；
 * 但**不能无脑照最近两条差异补发**——2026-11-23 的 mv-451 就是「另一侧早就发过、
 * 只是不在最近两条窗口内」，补发等于重复帖。本脚本复用告警脚本的 --json 判定，
 * 只取 trueMissingInBs / trueMissingInTg（即另一侧**全量**也没有）下发 --pick。
 *
 * 安全闸门（任一命中就不动手，留给告警卡片让人工核对）：
 *   1. 任一侧有 uncertain（送达不确定）条目 → 整轮跳过，避免"其实发出去了"造成重复；
 *   2. --pick 的 id 在 data/*.yaml 里不存在、撞号，或当前资源指纹 ≠ 已发记录的指纹
 *      （id 被复用）→ 跳过该条；
 *   3. 同一 id+侧 2 小时内不重试、累计失败 3 次后停止自动追平；
 *   4. 每轮最多补 1 条，宁可下一小时再补，不一次性刷屏；
 *   5. 补完重新读 posted.json 验证指纹真的落在目标侧，才记为成功（脚本退出 0 ≠ 发出去了）。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-push-fix.mjs             # 只看计划，不发送（默认）
 *   node tools/feishu-reports/wodewangpan-push-fix.mjs --dry-run   # 同上，显式写法
 *   node tools/feishu-reports/wodewangpan-push-fix.mjs --apply     # 真正补发（cron 用这个）
 *
 * 追平记录：~/.cache/wdp-push-sync-fix/attempts.json（本机运行态，不入库）
 * 日志：cron 里接 ~/.cache/wdp-push-fix.log
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadEnv, findStateFile, loadState, loadItems, REPO_ROOT,
} from '../../push/common.mjs';
import { sendInteractiveCard } from './feishu-api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'wodewangpan-push-sync.mjs');
const REPO = loadEnv(import.meta.url, 'wodewangpan-tg.env').values.REPO || REPO_ROOT;
const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;

const RUNDIR = path.join(os.homedir(), '.cache', 'wdp-push-sync-fix');
const LEDGER = path.join(RUNDIR, 'attempts.json');
const LOCK = path.join(RUNDIR, 'lock');
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_PER_RUN = 1;
const LOCK_STALE_MS = 15 * 60 * 1000;
const POST_TIMEOUT_MS = 180000;

const log = (s) => process.stdout.write(`[追平] ${s}\n`);
const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
};
const fpOf = (id, rec) => (rec?.quark ? `q:${rec.quark}` : rec?.baidu ? `b:${rec.baidu}` : `id:${id}`);
const fpOfItem = (it) => (it?.quark ? `q:${it.quark}` : it?.baidu ? `b:${it.baidu}` : `id:${it.id}`);
const fmtAt = (s) => (String(s || '').slice(5, 16).replace('T', ' ') || '时间未知');
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });

function acquireLock() {
  fs.mkdirSync(RUNDIR, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS; } catch {}
      if (!stale) return false;
      try { fs.unlinkSync(LOCK); } catch { return false; }
    }
  }
  return false;
}
function releaseLock() {
  try {
    if (String(fs.readFileSync(LOCK, 'utf8')).trim() === String(process.pid)) fs.unlinkSync(LOCK);
  } catch {}
}

/** 调告警脚本的 --json：判定口径只有那一份，本脚本不重写对账逻辑。 */
function analyze() {
  const r = spawnSync(process.execPath, [CHECKER, '--json'], {
    cwd: REPO, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(`对账脚本失败：${(r.error?.message || r.stderr || r.stdout || '').toString().slice(0, 300)}`);
  }
  const lines = String(r.stdout || '').trim().split('\n');
  try { return JSON.parse(lines[lines.length - 1]); }
  catch { throw new Error('对账脚本输出里找不到 JSON'); }
}

/** 验证 id 当前指向的资源与已发记录一致；撞号 / id 复用一律拒绝补发。 */
function verifyData(id, cand, byId, dupIds) {
  if (dupIds.has(id)) return `data 里 ${id} 撞号，先修 id`;
  const it = byId.get(id);
  if (!it) return `data 里找不到 ${id}，可能已下架或 id 写错`;
  const want = cand.fp;
  const got = fpOfItem(it);
  if (want !== got) return `id 复用：已发记录指向 ${want}，当前数据指向 ${got}`;
  return null;
}

/** 补发后重新读目标侧 posted.json，确认指纹真的落地（退出码 0 不代表发出去了）。 */
function delivered(side, fp) {
  const dir = side === 'TG' ? 'telegram-posts' : 'bluesky-posts';
  const posted = loadState(findStateFile(dir)).posted || {};
  return Object.entries(posted).some(([id, rec]) => rec && !rec.uncertain && fpOf(id, rec) === fp);
}

async function main() {
  if (!acquireLock()) { log('已有追平任务在跑（或锁未过期），本轮跳过'); return; }
  try {
    const a = analyze();
    log(`检查时间 ${a.timeStr} ｜ 真缺发 TG:${a.trueMissingInTg.length} BS:${a.trueMissingInBs.length} ｜ 节奏错位 ${a.offsetOnly.length} ｜ 不确定 ${a.uncertain.length}`);
    if (a.same) { log('两侧一致，无需追平'); return; }
    if (a.uncertain.length) {
      log(`存在送达不确定条目（${a.uncertain.map((x) => `${x.side}:${x.id}`).join('、')}），整轮跳过自动追平，等人工 --confirm/--unfix`);
      return;
    }

    const candidates = [
      ...a.trueMissingInTg.map((v) => ({ ...v, side: 'TG', script: 'push/telegram/tg-post.mjs' })),
      ...a.trueMissingInBs.map((v) => ({ ...v, side: 'BS', script: 'push/bluesky/bluesky-post.mjs' })),
    ];
    if (!candidates.length) { log('没有真缺发（只有节奏错位），不补发'); return; }

    const ledger = readJson(LEDGER, {});
    const items = loadItems(REPO);
    const byId = new Map();
    const dupIds = new Set();
    for (const it of items) {
      if (byId.has(it.id)) dupIds.add(it.id);
      else byId.set(it.id, it);
    }

    const skipped = [];
    const todo = [];
    for (const c of candidates) {
      const key = `${c.side}:${c.id}`;
      const prev = ledger[key];
      if (prev && Date.now() - (Date.parse(prev.at || '') || 0) < COOLDOWN_MS) {
        skipped.push({ ...c, why: `2 小时冷却中（上次 ${fmtAt(prev.at)}，第 ${prev.attempts} 次）` });
        continue;
      }
      if (prev && prev.attempts >= MAX_ATTEMPTS) {
        skipped.push({ ...c, why: `已自动尝试 ${prev.attempts} 次仍失败，停止自动追平` });
        continue;
      }
      const why = verifyData(c.id, c, byId, dupIds);
      if (why) { skipped.push({ ...c, why }); continue; }
      todo.push(c);
    }
    if (todo.length > MAX_PER_RUN) {
      for (const c of todo.slice(MAX_PER_RUN)) skipped.push({ ...c, why: `本轮已达 ${MAX_PER_RUN} 条上限，下一小时再补` });
      todo.length = MAX_PER_RUN;
    }

    const attempted = [];
    for (const c of todo) {
      const key = `${c.side}:${c.id}`;
      const label = `${c.side} ${c.id}｜${c.title || '（无标题）'}`;
      if (DRY) {
        log(`[dry-run] 将补发 ${label}（node ${c.script} --pick ${c.id}）`);
        continue;
      }
      log(`补发 ${label} → node ${c.script} --pick ${c.id}`);
      const r = spawnSync(process.execPath, [c.script, '--pick', c.id], {
        cwd: REPO, encoding: 'utf8', timeout: POST_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      });
      const tail = String(r.stdout || r.stderr || '').trim().split('\n').slice(-6).join(' / ').slice(0, 300);
      const ok = !r.error && delivered(c.side, c.fp);
      if (ok) {
        delete ledger[key];
        attempted.push({ ...c, ok: true });
        log(`✓ 已补发并验证落地：${label}`);
      } else {
        const prevN = ledger[key]?.attempts || 0;
        ledger[key] = { at: new Date().toISOString(), attempts: prevN + 1, title: c.title };
        attempted.push({ ...c, ok: false, why: tail || `退出码 ${r.status}` });
        log(`× 补发后目标侧仍查无此资源：${label}（第 ${prevN + 1} 次）${tail ? `｜${tail}` : ''}`);
      }
    }
    if (!DRY) {
      writeJson(LEDGER, ledger);
      for (const s of skipped) log(`跳过 ${s.side} ${s.id}：${s.why}`);
    }

    if (DRY || (!attempted.length && !skipped.length)) return;

    const rows = [
      ...attempted.map((v) => `· ${v.ok ? '✓' : '×'} ${v.side} ${v.id}｜${v.title || '（无标题）'}${v.ok ? '（已补发并验证落地）' : `（失败：${v.why}）`}`),
      ...skipped.map((v) => `· ⏭ ${v.side} ${v.id}｜${v.title || '（无标题）'}｜${v.why}`),
    ];
    const failed = attempted.some((v) => !v.ok) || skipped.some((v) => /复用|撞号|找不到|停止自动/.test(v.why));
    const elements = [
      md(`**检查时间：** ${a.timeStr}\n**口径：** 只补另一侧全量也没有的真缺发；节奏错位（${a.offsetOnly.map((v) => v.id).join('、') || '无'}）不补，补了就是重复帖。`),
      hr(),
      md(`**自动追平结果：**\n${rows.join('\n')}`),
      { tag: 'note', elements: [{ tag: 'plain_text', content: `${failed ? '仍有问题，等告警卡片或人工处理' : '已追平'} ｜ 补发 ${attempted.filter((v) => v.ok).length} ｜ 失败 ${attempted.filter((v) => !v.ok).length} ｜ 跳过 ${skipped.length}` }] },
    ];
    const card = {
      config: { wide_screen_mode: true },
      header: { template: failed ? 'orange' : 'green', title: { tag: 'plain_text', content: '我的网盘.TG / Bluesky 推送自动追平' } },
      elements,
    };
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    try {
      const mid = await sendInteractiveCard(card, { idempotencyKey: `push-fix-${stamp}` });
      log(`[飞书] ✓ 已推送追平结果卡片 (message_id ${mid || 'unknown'})`);
    } catch (e) {
      log(`[飞书] × 发卡片失败：${String(e.message || e).slice(0, 200)}`);
    }
  } finally {
    releaseLock();
  }
}

await main();
