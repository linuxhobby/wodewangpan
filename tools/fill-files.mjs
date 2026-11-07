#!/usr/bin/env node
// fill-files：批量给 data/*.yaml 条目补「文件清单」（files.*）。
//
// 数据从哪来：每个条目都有 quark_url 分享链接，夸克分享详情接口支持客态访问
// （无需登录），能拿到真实的文件名 / 大小 / 类型 / 总数——这是只有本站能提供的
// 独有数据，也是别站复制不了的部分。走夸克官方 skill 的 share-detail 命令取数。
//
// 写入策略：不动 YAML 里的已有内容，只在条目末尾追加 updated + files 块；
// 已有 files: 的条目自动跳过，可安全重复执行；盘端只剩占位说明文件（资源未到位）时整条跳过不写。
//
// 用法：
//   node tools/fill-files.mjs --limit 30            # 本次最多补 30 条（默认）
//   node tools/fill-files.mjs --limit 3 --only misc # 只处理 data/misc.yaml，小批试跑
//   node tools/fill-files.mjs --ids mv-427,tv-086   # 只补指定 id（同步任务入库后当场补；已有 files: 的自动跳过）
//   node tools/fill-files.mjs --dry-run             # 只抓取打印，不写文件
//   node tools/fill-files.mjs --limit 50 --delay 4000  # 请求更慢更稳
//
// 建议节奏：每天跑一批（--limit 20~30），配合站点「updated 逐日分散」的策略。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
// 夸克官方 skill 的 CLI（share-detail 支持客态，不需要网盘授权）
const CLI = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.codebuddy/skills/quarkclouddrive/scripts/quark-drive.cjs'
);

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);
const limit = Number(getArg('limit', 30));
const delayMs = Number(getArg('delay', 3000));
const only = getArg('only', '');
const idArg = getArg('ids', '');
const dryRun = hasFlag('dry-run');

// 北京时间今天，写进条目的 updated 字段（sitemap lastmod 依此真实更新）
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// 夸克 skill 要求的追踪参数
const SESSION_ID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
const SESSION_INPUT = '批量抓取分享链接的文件清单';

if (!fs.existsSync(CLI)) {
  console.error(`! 找不到夸克 CLI：${CLI}`);
  console.error('  先安装 quarkclouddrive skill（bash ~/.codebuddy/skills/quarkclouddrive/scripts/install.sh）');
  process.exit(1);
}

/** 调 share-detail 取分享目录的一页文件列表（客态，无需登录） */
function fetchDetail(url, pdirFid = '', page = 1) {
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [
        CLI,
        'share-detail',
        '--url', url,
        '--size', '50',
        '--page', String(page),
        ...(pdirFid ? ['--pdir-fid', pdirFid] : []),
        '--session-input', SESSION_INPUT,
        '--session-id', SESSION_ID,
      ],
      { encoding: 'utf8', timeout: 90_000 }
    );
  } catch (e) {
    return { error: `调用失败：${String(e.message).split('\n')[0]}` };
  }
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type !== 'result' || obj.action !== 'share-detail') continue;
    if (obj.notice && obj.notice.text) console.log(`    · notice: ${obj.notice.text}`);
    if (obj.code !== 0) return { error: obj.msg || `code=${obj.code}` };
    return { data: obj.data };
  }
  return { error: 'CLI 无 result 输出' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 单目录最多翻几页（50 条/页）：绝大多数目录一页就够，超大目录封顶 150 条 */
const MAX_PAGES = 3;

/** 翻页取全一个目录的文件列表；成功返回 { files }，失败返回 { error } */
async function fetchAll(url, pdirFid = '') {
  const files = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = fetchDetail(url, pdirFid, page);
    if (!r.data) {
      if (page === 1) return r;
      break;
    }
    const list = r.data.files || [];
    files.push(...list);
    if (list.length < 50) break;
    if (delayMs) await sleep(delayMs);
  }
  return { files };
}

const humanSize = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
};

/** 从分享详情聚合出 files.* 字段：字段全可选，拿得到什么写什么 */
function aggregate(data, fileNum) {
  const files = data.files || [];
  const dirs = files.filter((f) => f.file_type === '0');
  const plain = files.filter((f) => f.file_type !== '0');
  const out = {};

  const total = Number(fileNum ?? data.share_info?.file_num ?? files.length);
  if (total) out.count = total;

  // 顶层全是文件时能算出真实总大小；有文件夹时顶层拿不到目录大小，宁缺勿假
  if (!dirs.length && plain.length) {
    const bytes = plain.reduce((s, f) => s + (Number(f.size) || 0), 0);
    if (bytes) out.size = humanSize(bytes);
  }

  const exts = new Map();
  for (const f of plain) {
    const m = /\.([a-z0-9]{1,6})$/i.exec(String(f.filename || ''));
    if (m) {
      const e = m[1].toUpperCase();
      exts.set(e, (exts.get(e) || 0) + 1);
    }
  }
  if (exts.size) {
    out.format = [...exts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([e, n]) => (n > 1 ? `${e}×${n}` : e))
      .join(' / ');
  }
  if ([...exts.keys()].some((e) => /^(ZIP|RAR|7Z|TAR|GZ|001)$/.test(e))) out.packed = true;

  // 目录树：顶层条目原样列出，文件夹带斜杠，最多 40 行
  const tree = files
    .slice(0, 40)
    .map((f) => {
      const name = String(f.filename || '').trim();
      return f.file_type === '0' ? `${name}/` : name;
    })
    .filter((name) => name && name !== '/');
  if (tree.length) out.tree = [...new Set(tree)].join('\n');

  return Object.keys(out).length ? out : null;
}

/** files 聚合结果 → YAML 缩进行（updated + files 块） */
function toYamlLines(files, withUpdated) {
  const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [];
  if (withUpdated) lines.push(`  updated: ${today}`);
  lines.push('  files:');
  for (const [k, v] of Object.entries(files)) {
    if (k === 'tree') {
      lines.push('    tree: |');
      for (const t of String(v).split('\n')) lines.push(`      ${t}`);
    } else if (k === 'packed') {
      lines.push(`    packed: ${v ? 'true' : 'false'}`);
    } else if (typeof v === 'number') {
      lines.push(`    ${k}: ${v}`);
    } else {
      lines.push(`    ${k}: ${q(v)}`);
    }
  }
  return lines;
}

/** 扫出待处理条目：有 quark_url 且还没有 files: 块的 */
function collectPending() {
  const names = fs.readdirSync(dataDir).filter((f) => f.endsWith('.yaml'));
  const targets = only ? names.filter((f) => f.replace(/\.yaml$/, '') === only) : names;
  const pending = [];
  for (const name of targets) {
    const file = path.join(dataDir, name);
    // data/*.yaml 是「CRLF 为主 + 夹少量裸 LF」的混排文件：逐行保留各自的行尾。
    // 若统一成一种行尾，没动过的行也会进 diff，并与并行提交 data/ 的任务互相整体覆盖。
    const raw = fs.readFileSync(file, 'utf8');
    const parts = raw.split(/(\r\n|\r|\n)/);
    const lines = [];
    for (let i = 0; i < parts.length; i += 2) {
      lines.push(i + 1 < parts.length ? parts[i] + parts[i + 1] : parts[i]);
    }
    const starts = [];
    lines.forEach((l, i) => {
      if (/^- /.test(l)) starts.push(i);
    });
    starts.push(lines.length);
    for (let s = 0; s < starts.length - 1; s++) {
      const [from, to] = [starts[s], starts[s + 1]];
      const block = lines.slice(from, to).join('\n');
      if (/^  files:/m.test(block)) continue;
      const idm = block.match(/^- id:\s*(\S+)/);
      const um = block.match(/^\s*quark_url:\s*"?([^"\s]+)"?/m);
      if (!idm || !um) continue;
      // 插入点：条目内最后一个非空行之后（该行属于当前条目）
      let at = to - 1;
      while (at > from && !lines[at].trim()) at--;
      pending.push({
        file,
        lines,
        id: idm[1],
        url: um[1],
        at,
        hasUpdated: /^  updated:/m.test(block),
      });
    }
  }
  return pending;
}

const wantedIds = idArg
  ? idArg
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

console.log(
  `fill-files：${dryRun ? '试跑（不写文件）' : '写入'} · ${wantedIds ? `指定 ${wantedIds.length} 个 id` : `上限 ${limit} 条`} · 间隔 ${delayMs}ms · updated=${today}`
);
const all = collectPending();
// --ids 只补同步任务本轮新增的那几条；已有 files: 的条目 collectPending 已排除，重复执行安全
let pending = all;
if (wantedIds) {
  const set = new Set(wantedIds);
  pending = all.filter((p) => set.has(p.id));
  const skipped = wantedIds.filter((id) => !pending.some((p) => p.id === id));
  console.log(
    `全库待补：${all.length} 个 · 本次指定：${pending.length} 个` +
      (skipped.length ? ` · 跳过（已有 files: 或仓库内不存在）：${skipped.join('、')}` : '') +
      '\n'
  );
} else {
  console.log(`待补条目：${all.length} 个\n`);
}
const cap = wantedIds ? pending.length : limit;

// 同一文件的条目共享一份 lines；插入后把同文件里更靠后条目的插入点顺移
const dirtyFiles = new Set();
let ok = 0;
let fail = 0;
let skip = 0;
const failed = [];
const notReady = [];

for (const item of pending.slice(0, cap)) {
  process.stdout.write(`${item.id} … `);
  // 根目录往往只装一个总文件夹：自动下钻（最多 2 层）拿真实内容清单
  let root = await fetchAll(item.url);
  if (!root.files) {
    const msg = root.error || '分享内容为空';
    console.log(`失败（${msg}）`);
    fail++;
    failed.push(`${item.id}: ${msg}`);
  } else {
    let files = root.files;
    const prefix = [];
    let depth = 0;
    while (files.length === 1 && files[0].file_type === '0' && depth < 2) {
      const sub = await fetchAll(item.url, files[0].fid);
      if (!sub.files) break;
      prefix.push(`${String(files[0].filename || '').trim()}/`);
      files = sub.files;
      depth++;
      if (delayMs) await sleep(delayMs);
    }
    // 占位说明文件（trending-sync / 夸克同步建目录时预置的「资源在24小时内更新-请先转存」）
    // 是我们自己的工作流产物，不属于资源内容：
    //   · 盘端只剩它时 = 资源还没到位（TMDB 今日热门建的就是这种空目录）→ 整条跳过、一个字不写；
    //   · 否则把它从清单里剔掉，count / tree / format 只统计真实内容（AGENTS.md §5：宁缺勿假）。
    const real = files.filter((f) => !/资源在24小时内更新|请先转存/.test(String(f.filename || '')));
    if (!real.length) {
      console.log('跳过（盘端只有占位说明文件，资源还没到位）');
      skip++;
      notReady.push(item.id);
      if (delayMs) await sleep(delayMs);
      continue;
    }
    // count 用实际拿到的条目数：子目录查询的 file_num 不可靠
    const agg = aggregate({ files: real }, real.length);
    if (prefix.length && agg?.tree) agg.tree = [...prefix, ...agg.tree.split('\n')].join('\n');
    if (!agg) {
      console.log('跳过（分享内容为空）');
      fail++;
      failed.push(`${item.id}: 分享内容为空`);
    } else {
      const parts = [];
      if (agg.count) parts.push(`${agg.count} 项`);
      if (agg.size) parts.push(agg.size);
      if (agg.format) parts.push(agg.format);
      console.log(`完成（${parts.join(' · ') || '有内容'}）`);
      if (!dryRun) {
        // 新增行沿用插入点那一行的行尾，与上下文保持一致
        const after = item.lines[item.at];
        const nl = /\r\n$/.test(after) ? '\r\n' : '\n';
        const snippet = toYamlLines(agg, !item.hasUpdated).map((l) => l + nl);
        item.lines.splice(item.at + 1, 0, ...snippet);
        for (const other of pending) {
          if (other.file === item.file && other.at > item.at) other.at += snippet.length;
        }
        dirtyFiles.add(item.file);
      }
      ok++;
    }
  }
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
}

if (!dryRun) {
  for (const file of dirtyFiles) {
    const item = pending.find((p) => p.file === file);
    fs.writeFileSync(file, item.lines.join(''));
  }
}

console.log(`\n完成：成功 ${ok} · 跳过 ${skip} · 失败 ${fail}`);
if (notReady.length) {
  console.log(`盘端仍是占位目录、等资源到位再补：${notReady.join('、')}`);
}
if (failed.length) {
  console.log('失败清单（多为链接失效 / 需提取码）：');
  for (const f of failed) console.log(`  ${f}`);
}
