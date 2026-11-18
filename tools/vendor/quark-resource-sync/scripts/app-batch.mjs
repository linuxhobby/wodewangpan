#!/usr/bin/env node
// 软件类批量入库：重命名 → 出链 → iTunes 官方图标合成海报 → 写 software.yaml
//   node app-batch.mjs --scan <scan-new.json> [--size 999] [--sleep 1500] [--init]
// 编号口径（2026-11-04 起）：自动读 scan-new 的 holes 做空洞补位，空洞用完才从最大编号顺延；
// --start 仍可手工指定连续段（例外用法）。写 YAML 走 lib/yaml-store.mjs 的 upsert（同 id 就地改写死链旧条目）。
// 可断点续跑：进度存 ~/.workbuddy/quark-sync-cache/app-plan.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, SKILL, CACHE, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
import { pad3 } from './lib/number.mjs';
import { isImageFile, isJpegFile } from '../../../lib/image-check.mjs';
import { upsertEntry } from './lib/yaml-store.mjs';

const { PROXY, REPO, QUARK_CLI: CLI, SHARE_FID } = cfg;
requireCfg(['QUARK_CLI', 'SHARE_FID', 'REPO']);
const MAKE = path.join(SKILL, 'scripts', 'make-entry.mjs');
const ICON_POSTER = path.join(REPO, 'tools', 'poster.mjs');
const IMG_DIR = path.join(REPO, 'static', 'images');
const DATA_FILE = path.join(REPO, 'data', 'software.yaml');
const PLAN = path.join(CACHE, 'app-plan.json');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const SCAN = arg('scan', path.join(TMP, 'scan-new.json'));
const START = parseInt(arg('start', '0'), 10);
const SIZE = parseInt(arg('size', '999'), 10);
const SLEEP = parseInt(arg('sleep', '1500'), 10);
const PROXY_ARGS = PROXY ? ['-x', PROXY] : [];

const run = (bin, a, o = {}) => new Promise((res, rej) =>
  execFile(bin, a, { maxBuffer: 64e6, timeout: 120000, ...o }, (e, s, x) => e ? rej(new Error(String(x || e.message).slice(0, 200))) : res(s)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = async (url) => JSON.parse(await run('curl', ['-s', '-m', '25', ...PROXY_ARGS, url]));

/** browse 把条目写到 jsonl，返回解析后的数组（与 scan-new.mjs 同款） */
async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run('node', [CLI, ...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    // 旧版 CLI 不认 --task-dir（报 unknown option），回退到默认落盘位置
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run('node', [CLI, ...base]);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  return fs.readFileSync(JSON.parse(`"${m[1]}"`), 'utf8').trim().split('\n').map(JSON.parse);
}

/**
 * 刷新 fid：实测 fid 每次 browse 都轮换（`|` 前那段），用旧 fid 出链会报 code 21001 文件找不到。
 * rename 之后重新 browse 分类目录，按新目录名取最新 fid。
 */
async function refreshFids(items) {
  if (!items.length) return;
  try {
    const roots = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
    const root = roots.find((o) => o.filename.includes('应用'));
    if (!root) throw new Error('SHARE 下找不到「02应用」目录');
    const byName = new Map((await browse(root.fid)).map((o) => [o.filename, o.fid]));
    let n = 0;
    for (const p of items) {
      const fresh = byName.get(p.new_name);
      if (fresh && fresh !== p.fid) {
        p.fid = fresh;
        n++;
      } else if (!fresh) {
        console.log(`  ! ${p.id} 未在网盘里找到 ${p.new_name}，沿用旧 fid`);
      }
    }
    console.log(`fid 刷新：${n}/${items.length} 条（fid 每次 browse 都轮换，出链必须用最新 fid）`);
  } catch (e) {
    console.log(`! fid 刷新失败，沿用扫描时的 fid：${String(e.message).slice(0, 120)}`);
  }
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
// 与 App Store 结果做宽松匹配：归一化后相等 / 互相包含
function pickApp(results, query) {
  const q = norm(query);
  for (const r of results) {
    const t = norm(r.trackName || '');
    if (t === q || (t.includes(q) && q.length >= 4) || (q.includes(t) && t.length >= 4)) return r;
  }
  return null;
}
const PALETTE = [
  ['#1e3a8a', '#3b82f6'], ['#065f46', '#10b981'], ['#7c2d12', '#f97316'],
  ['#581c87', '#a855f7'], ['#0f172a', '#64748b'], ['#831843', '#ec4899'],
  ['#134e4a', '#14b8a6'], ['#3f2d10', '#d97706'], ['#1e1b4b', '#6366f1'],
  ['#450a0a', '#ef4444'],
];

// ---------- 初始化 / 读取计划 ----------
let plan;
if (fs.existsSync(PLAN) && !process.argv.includes('--init')) {
  plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
} else {
  const scan = JSON.parse(fs.readFileSync(SCAN, 'utf8'));
  const cat = scan.categories.find((c) => c.key === '软件');
  // 空洞优先（2026-11-04）：先按升序填 scan-new 给出的可补位空洞，用完才从最大编号顺延；--start 是人工指定的例外
  const avail = (cat.holes || []).map((n) => parseInt(n, 10)).filter((n) => n > 0).sort((a, b) => a - b);
  const maxN = cat.max_number ? parseInt(cat.max_number, 10) : Math.max(0, parseInt(cat.next_number || '1', 10) - 1);
  let hi = 0;
  let tail = START ? START - 1 : maxN;
  const nextNum = () => (!START && hi < avail.length ? pad3(avail[hi++]) : pad3(++tail));
  plan = cat.unnumbered.map((u) => {
    const num = nextNum();
    return { num, id: `app-${num}`, fid: u.fid, name: u.filename, new_name: `${num}-${u.filename}`,
      added: u.updated_at || new Date().toISOString().slice(0, 10), renamed: false, status: 'pending', url: null, error: null };
  });
  fs.mkdirSync(path.dirname(PLAN), { recursive: true });
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));
  const nums = plan.map((p) => p.num);
  console.log(`计划已生成：${plan.length} 条，app-${nums[0]} ~ app-${nums[nums.length - 1]}`);
  console.log(`  编号来源：补位空洞 ${nums.filter((n) => avail.includes(parseInt(n, 10))).length} 个 / 顺延 ${nums.filter((n) => !avail.includes(parseInt(n, 10))).length} 个${START ? '（--start 手工指定）' : ''}`);
}

const todo = plan.filter((p) => p.status === 'pending');
if (!todo.length) { console.log('没有待处理条目 ✓'); process.exit(0); }
const batch = todo.slice(0, SIZE);
console.log(`本批 ${batch.length} 条（${batch[0].id} ~ ${batch[batch.length - 1].id}）`);

// ---------- 1) 重命名（一次批量，未重命名的） ----------
const needRename = batch.filter((p) => !p.renamed);
if (needRename.length) {
  const itemsFile = path.join(TMP, `app-rename-${Date.now()}.json`);
  fs.writeFileSync(itemsFile, JSON.stringify({
    schema_version: 1,
    items: needRename.map((p) => ({ fid: p.fid, old_name: p.name, new_name: p.new_name })),
  }, null, 1));
  try {
    const r = JSON.parse(await run('node', [CLI, 'rename', '--batch-id', crypto.randomBytes(8).toString('hex'), '--items-file', itemsFile]));
    console.log(`重命名：${r.data?.result_status} ${r.data?.success_count}/${r.data?.total}`);
    if (r.data?.fail_count) throw new Error(`重命名失败 ${r.data.fail_count} 条`);
    needRename.forEach((p) => { p.renamed = true; });
    fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));
  } catch (e) {
    console.error('重命名失败，已中止（网盘数据未改坏）：', e.message);
    process.exit(1);
  }
}

// ---------- 1.5) 刷新 fid（rename 之后 fid 已变，出链前必须重新取） ----------
await refreshFids(batch.filter((p) => !p.url));

// ---------- 2) 逐条：出链 → iTunes → 海报 → YAML ----------
let done = 0;
for (const p of batch) {
  try {
    // 出链
    if (!p.url) {
      const s = JSON.parse(await run('node', [CLI, 'share', p.fid, '--title', p.new_name, '--url-type', '1', '--expired-type', '1']));
      p.url = s.data?.share_url;
      if (!p.url) throw new Error('share 无返回链接');
      await sleep(SLEEP);
    }

    // iTunes 元信息
    let meta = null;
    for (const entity of ['macSoftware', 'software']) {
      try {
        const j = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(p.name)}&entity=${entity}&country=us&limit=5`);
        meta = pickApp(j.results || [], p.name);
        if (meta) break;
      } catch { /* 下一个 entity */ }
    }

    // GitHub 兜底（开源应用普遍不在 App Store）：取官方仓库描述
    let ghDesc = null, ghHome = null;
    if (!meta) {
      try {
        const g = await fetchJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(p.name)}&per_page=5`);
        const hit = (g.items || []).find((r) => norm(r.name || '') === norm(p.name))
          || (g.items || []).find((r) => (norm(r.name || '') || '').includes(norm(p.name)) && norm(p.name).length >= 4)
          || (g.items || [])[0];
        if (hit && norm(hit.name || '') === norm(p.name)) {
          ghDesc = (hit.description || '').trim() || null;
          ghHome = hit.homepage || hit.html_url;
        }
      } catch { /* 忽略，走通用文案 */ }
    }

    // 海报：官方图标 → poster.mjs icon 合成
    let image = null;
    const iconUrl = meta?.artworkUrl512 || meta?.artworkUrl100?.replace(/100x100/, '512x512');
    if (iconUrl) {
      const iconTmp = path.join(TMP, `icon-${p.id}.png`);
      const outJpg = path.join(IMG_DIR, `${p.id}.jpg`);
      try {
        await run('curl', ['-s', '-L', '-m', '40', ...PROXY_ARGS, '-o', iconTmp, iconUrl]);
        if (!isImageFile(iconTmp)) throw new Error('icon 不是有效图片');
        const [c1, c2] = PALETTE[parseInt(p.num, 10) % PALETTE.length];
        await run('node', [ICON_POSTER, '--icon', iconTmp, '--out', outJpg,
          '--title', meta?.trackName || p.name, '--sub', meta?.primaryGenreName || 'macOS 应用',
          '--c1', c1, '--c2', c2, '--radius', '22']);
        if (!isJpegFile(outJpg)) throw new Error('poster 不是有效 JPEG');
        image = `${p.id}.jpg`;
      } catch {
        image = null; // 回退占位海报
      }
    }

    // YAML
    const fallbackDesc = ghDesc
      ? `${ghDesc}（开源免费，主页 ${ghHome || '见仓库'}）`
      : `${p.name} for macOS：官方原版应用安装包，下载后拖入「应用程序」文件夹即可使用。`;
    const desc0 = (meta?.description || fallbackDesc).replace(/\s+/g, ' ').trim();
    // 描述正文写入上限 700 字（2026-11-12 全站写入口径从 1200 下调）：App Store 简介本就完整可读，
    // 700 字足以容纳绝大多数完整简介，只有超长条目才截断加省略号。站点构建护栏
    // scripts/lib/data.js 的 MAX_DESC 仍留 1200，只兜底、不会主动砍存量条目。
    // 注意：软件分类要求「简介必须是完整中文、不得半句截断」——真被截到句中时要人工压缩改写，不能就这么入库。
    const LIMIT = 700;
    const desc = (desc0.length > LIMIT ? desc0.slice(0, LIMIT) + '…' : desc0) + (meta?.artistName ? `｜${meta.artistName}` : '');
    const data = {
      id: p.id,
      title: meta?.trackName || p.name,
      category: '软件',
      tags: ['软件', ...(meta?.primaryGenreName ? [meta.primaryGenreName] : []), 'macOS', meta?.trackName || p.name],
      quark_url: p.url,
      description: desc,
      date: (meta?.releaseDate || p.added).slice(0, 10),
      added: p.added,
    };
    if (image) data.image = image;
    const y = await run('node', [MAKE, '--data', JSON.stringify(data)]);
    // 空洞补位时同 id 旧条目（死链）就地改写，正常新增仍是追加（lib/yaml-store.mjs）
    const res = upsertEntry(DATA_FILE, p.id, y);
    p.yaml_mode = res.mode;
    if (res.mode === 'replaced') console.log(`  ↻ ${p.id} 已就地改写站点旧条目（补位回收的死链）`);
    p.status = 'done';
    done++;
    console.log(`  ${p.id} ✓ ${p.new_name}${image ? '' : ' [占位海报]'}`);
  } catch (e) {
    p.error = String(e.message || e).slice(0, 160);
    console.log(`  ${p.id} ❌ ${p.error}`);
  }
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));
  await sleep(300);
}

const left = plan.filter((p) => p.status === 'pending').length;
const failed = plan.filter((p) => p.error);
console.log(`\n完成 ${done}/${batch.length}；剩余 ${left}；失败 ${failed.length}`);
if (failed.length) failed.forEach((p) => console.log(`  ${p.id} ${p.name} → ${p.error}`));
