#!/usr/bin/env node
// fill-files：批量给 data/*.yaml 条目补「文件清单」（files.*）。
//
// 数据从哪来：每个条目都有 quark_url 分享链接，夸克分享详情接口支持客态访问
// （无需登录），能拿到真实的文件名 / 大小 / 类型 / 总数——这是只有本站能提供的
// 独有数据，也是别站复制不了的部分。走夸克官方 skill 的 share-detail 命令取数。
//
// 写入策略（补齐）：不动 YAML 里的已有内容，只在条目末尾追加 updated + files 块；
// 已有 files: 的条目自动跳过，可安全重复执行；盘端只剩占位说明文件（资源未到位）时整条跳过不写。
//
// 连载轮询（2026-11-10 起）：电视剧 / 动漫的夸克目录会持续追加资源，首份清单写完就过期。
// 每轮例行顺带抽查 1 条「已有 files: 块」的剧集，重抓盘端目录；只有内容真变了才整体
// 重写 files 块并写当天 updated，没变一个字都不写。静止满 60 天降为低频复查，永不宣称完结。
// 判定口径只在 tools/lib/serials.mjs，list-ongoing 与本工具共用，不要另写一份。
//
// 待办扫描（2026-11-10 起）：trending-sync 建的是空编号目录，正片由人工转存。补齐队列按
// added 升序先补老资源，新空目录排在最末发现太慢。每轮另抽查 3 条「最近入库且无清单」的
// 剧集，只读判断盘端是否仍只有占位说明文件，空目录汇总成 [待加资源] 清单推给飞书。
// 加完资源后下轮自动从清单消失，不需要任何销账动作。
//
// 追更提醒（2026-11-10 起）：复用连载轮询已抓到的盘端快照，查 TMDB 的 status 与
// last_episode_to_air（播出日期是精确事实）。最近 7 天播了新集且在播的剧，打印 [追更提醒]
// 推给飞书，让人确认盘端要不要追。只提醒、不解析也不写入「还差几集」的结论——
// tree 会截断 40 行、混 .xltd.cfg、动漫分类里还有电影和合辑，集数不是可靠事实。
// 凭据只读环境变量或本机 skill 的 config.env（tools/lib/tmdb.mjs），匹配不确定就静默跳过。
//
// 队列顺序：待补条目按 added（入库时间）升序扫描，最老的资源先补；缺 added 的排最后。
// 写入额度：--limit 是「本次要写几条」，不是「本次看几条」。占位目录 / 抓取失败不占额度，
// 自动顺延下一条（否则 --limit 1 会被队首一个空目录永久堵死，每天 0 产出）。
// 最多尝试条数由 --tries 兜底（默认每条额度试 20 个，防止全库空目录时空转打接口）。
//
// 用法：
//   node tools/fill-files.mjs --limit 30            # 本次最多补 30 条（默认）
//   node tools/fill-files.mjs --limit 1             # 每日例行：只补 1 条，队首是空目录就顺延
//   node tools/fill-files.mjs --limit 3 --only misc # 只处理 data/misc.yaml，小批试跑
//   node tools/fill-files.mjs --ids mv-427,tv-086   # 只补指定 id（同步任务入库后当场补；已有 files: 的自动跳过）
//   node tools/fill-files.mjs --dry-run             # 只抓取打印，不写文件
//   node tools/fill-files.mjs --limit 50 --delay 4000  # 请求更慢更稳
//   node tools/fill-files.mjs --limit 5 --tries 30  # 每条额度最多试 30 个候选
//   node tools/fill-files.mjs --serials 1 --limit 0 # 只跑连载轮询（调试）
//   node tools/fill-files.mjs --serials 0           # 临时关掉连载轮询
//   node tools/fill-files.mjs --airing 0            # 临时关掉追更提醒
//   node tools/fill-files.mjs --limit 0 --serials 0 --todo 40 --dry-run  # 一次看待加资源清单
//
// 建议节奏：每天跑一批（--limit 20~30），配合站点「updated 逐日分散」的策略。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortTree } from './lib/tree-sort.mjs';
import {
  SERIAL_FILES,
  parseSerialFile,
  pickSerials,
  signatureOf,
  signatureFromLines,
  rewriteSerialFiles,
} from './lib/serials.mjs';
import {
  readCredentials,
  searchTvId,
  tvAiring,
  airedWithin,
  hasEpisodeNames,
  seasonOf,
} from './lib/tmdb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
// 夸克官方 skill 的 CLI（share-detail 支持客态，不需要网盘授权）
const CLI = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.codebuddy/skills/quarkclouddrive/scripts/quark-drive.cjs'
);

// 网盘目录里的「占位说明文件」是同步任务自建（或人工放过）的工作流产物，不是资源内容。
// 2026-11-08 起 trending-sync / mirror-baidu 预置三份：更新通知、QQ 群缺失反馈、站点导流；
// 站点导流当天改过名，铺下去的旧名「我的网盘网址www.wodewangpan.top.md」已在 643 个夸克目录里
// 且网盘 CLI 无删除命令 → 新旧两名都必须识别，漏任一个就等于把几百份说明文件当真实资源写进 files:。
// 另有历史/人工放过的一份「资源正在陆续更新上传中…」（实测全盘仅 1 处，在 04电影/005-山竹刀）。
// 权威定义在 quark-resource-sync skill 的 scripts/lib/placeholder.mjs（PLACEHOLDER_PREFIXES + PLACEHOLDER_SUFFIXES）；
// 跨仓库无法 import，改那边必须同步改这里。
// 2026-11-10 追加第二类排除对象：`.正片名.mkv.fg.op` —— NAS 播放器用来识别**片头/片尾**的标识文件
//   （op = opening，将军确认），紧贴正片名生成，是播放器的附属产物而不是资源内容。
//   它不在前 5 份说明文件之列、名字又以 `.` 开头，按行首前缀永远匹配不上 → 只能按后缀认。
//   漏掉它的后果：`count` 被这些附属件虚增、扩展名分布统计成根本不存在的 `OP×N`（实测 10 条电视剧清单）；
//   更坏的是把「只铺了片头片尾标记、正片还没传」误读成「资源已到位」。
//   ⚠ 前缀那一段仍然必须带 `^` 锚子，只有这一支是后缀规则。
const PLACEHOLDER_FILE_RE =
  /^(资源在24小时内更新|资源缺失反馈请加QQ群|关于我的网盘索引站|我的网盘网址|资源正在陆续更新上传中)|\.fg\.op$/i;

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
// 每轮顺带抽查几条连载条目（默认 1；0 = 临时关闭）。与 --limit 的补齐额度互相独立。
const serialsN = Math.max(0, Number(getArg('serials', 1)) || 0);
// 每轮抽查几条「最近入库」的剧集目录，找出盘端仍空、需要人工加资源的（默认 3；0 = 关闭）。
// 只读，不占补齐额度、不写盘；结果由任务 agent 塞进飞书 --follow。
const todoN = Math.max(0, Number(getArg('todo', 3)) || 0);
// 连载轮询时顺带查 TMDB 播出事件（默认开；0 = 关闭）。只读、不写数据、零额外夸克请求。
const airingN = Math.max(0, Number(getArg('airing', 1)) || 0);
// 每写入 1 条允许尝试的候选数上限（占位/失败顺延的兜底，避免空转打爆接口）
const triesPerWrite = Math.max(1, Number(getArg('tries', 20)) || 20);

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

/**
 * 定位盘端真实内容的唯一口径（补齐与连载轮询共用，2026-11-10 定稿）。
 *   · 判断「本级是否只有一个内容条目且是目录」之前先剔除占位说明文件与播放器片头片尾标识
 *     （PLACEHOLDER_FILE_RE 一份表，两类都走它）——
 *     占位 md 自 2026-11-08 起铺满全部分类目录，若按未剔除的原始条数判断，
 *     「真内容目录 + 两份占位 md」会让下钻提前停一层，把目录级快照当清单写盘
 *     （实测 an-007：12 集被写成 count 1、size/format 全丢）。
 *   · 最多下钻 2 级（depth < 2），标准固定；再深就按「目录层」如实呈现，不追。
 *   · 下钻中途抓取失败一律返回 { error }：调用方按失败处理，绝不写残缺清单。
 * 返回 { files, prefix }：files 为最终定位层（已剔占位），prefix 为沿途目录名。
 */
async function locateContent(url, rootFiles) {
  let files = rootFiles.filter((f) => !PLACEHOLDER_FILE_RE.test(String(f.filename || '')));
  const prefix = [];
  let depth = 0;
  while (files.length === 1 && files[0].file_type === '0' && depth < 2) {
    const sub = await fetchAll(url, files[0].fid);
    if (!sub.files) return { error: sub.error || '下钻抓取失败' };
    prefix.push(`${String(files[0].filename || '').trim()}/`);
    files = sub.files.filter((f) => !PLACEHOLDER_FILE_RE.test(String(f.filename || '')));
    depth++;
    if (delayMs) await sleep(delayMs);
  }
  return { files, prefix };
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

  // 目录树：接口返回的是盘端内部顺序（按 fid/更新时间），直接写出去是乱的；
  // 统一交给 sortTree 排成「目录优先 → 扩展名分组 → 组内自然序」，排完再截前 40 行，
  // 这样大目录被截断时留下的是最靠前的一批，而不是接口随手给的一批。
  const tree = sortTree(
    files.map((f) => {
      const name = String(f.filename || '').trim();
      return f.file_type === '0' ? `${name}/` : name;
    })
  );
  if (tree.length) out.tree = tree.slice(0, 40).join('\n');

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
      // 排序键：入库时间 added，兼容 `2026-10-19` 与 `"2026-11-04 03:41"` 两种写法。
      // 补齐成定宽「YYYY-MM-DD HH:MM」后按字符串比较即可，不过 Date，避开本地/UTC 时区偏移。
      const adm = block.match(/^\s*added:\s*"?(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)"?/m);
      let addedKey = adm ? adm[1].trim().replace('T', ' ') : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(addedKey)) addedKey += ' 00:00';
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(addedKey)) addedKey = '9999-99-99 99:99';
      // 插入点：条目内最后一个非空行之后（该行属于当前条目）
      let at = to - 1;
      while (at > from && !lines[at].trim()) at--;
      pending.push({
        file,
        lines,
        id: idm[1],
        url: um[1],
        at,
        addedKey,
        hasUpdated: /^  updated:/m.test(block),
      });
    }
  }
  // 按 added 升序（老资源先补）。sort 稳定：同一天入库的条目保持
  // 「文件名字母序 + 文件内条目顺序」的原有相对次序。
  return pending.sort((a, b) => (a.addedKey < b.addedKey ? -1 : a.addedKey > b.addedKey ? 1 : 0));
}

const wantedIds = idArg
  ? idArg
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

console.log(
  `fill-files：${dryRun ? '试跑（不写文件）' : '写入'} · ${
    wantedIds ? `指定 ${wantedIds.length} 个 id` : `补 ${limit} 条（占位/失败顺延，最多试 ${limit * triesPerWrite} 个）`
  } · 按 added 升序 · 间隔 ${delayMs}ms · updated=${today}`
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
// --limit 是「写入额度」而不是「查看条数」：占位目录 / 抓取失败不占额度，自动顺延下一条，
// 直到写满额度，或试到 --tries 的兜底上限（防止全库都是空目录时空转打接口）。
// --ids 是同步任务入库后当场补的那几条，指定的全部试完，不受额度约束。
const writeCap = wantedIds ? Infinity : limit;
const maxTries = wantedIds ? pending.length : Math.min(pending.length, writeCap * triesPerWrite);
let tried = 0;

// 同一文件的条目共享一份 lines；插入后把同文件里更靠后条目的插入点顺移
const dirtyFiles = new Set();
let ok = 0;
let fail = 0;
let skip = 0;
const failed = [];
const notReady = [];

for (const item of pending.slice(0, maxTries)) {
  if (ok >= writeCap) break;
  tried++;
  process.stdout.write(`${item.id} … `);
  // 根目录往往只装一个总文件夹：按 locateContent 的口径下钻（最多 2 级）拿真实内容清单
  let root = await fetchAll(item.url);
  if (!root.files) {
    const msg = root.error || '分享内容为空';
    console.log(`失败（${msg}）`);
    fail++;
    failed.push(`${item.id}: ${msg}`);
  } else {
    // 占位说明文件（trending-sync / 夸克同步建目录时预置，2026-11-08 起两份）：
    //   · 更新通知「资源在24小时内更新-请先转存-更新会自动通知.md」
    //   · 缺失反馈「资源缺失反馈请加QQ群1045824859.md」
    // 是我们自己的工作流产物，不属于资源内容：
    //   · 盘端只剩它们时 = 资源还没到位（TMDB 今日热门建的就是这种空目录）→ 整条跳过、一个字不写；
    //   · 否则把它们从清单里剔掉，count / tree / format 只统计真实内容（AGENTS.md §5：宁缺勿假）。
    // ⚠ 新增/改名占位文件时必须同步改这里，否则占位 md 会被当成真实资源写进 files: 假清单。
    //   权威定义在 C:/Users/marco/.qwenworkcn/skills/quark-resource-sync/scripts/lib/placeholder.mjs（跨仓库，无法 import）。
    // 下钻（最多 2 级）与剔占位的口径只在 locateContent 一份，连载轮询共用（2026-11-10 定稿）。
    const loc = await locateContent(item.url, root.files);
    if (loc.error) {
      console.log(`失败（${loc.error}）`);
      fail++;
      failed.push(`${item.id}: ${loc.error}`);
      if (delayMs) await sleep(delayMs);
      continue;
    }
    const real = loc.files;
    const prefix = loc.prefix;
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

/**
 * 连载资源轮询：每轮抽查少量剧集 / 动漫，重抓盘端目录与已有 files 块比对。
 * 只有内容真变了才整体重写并写当天 updated（真实内容变化，不是伪造 lastmod）；
 * 无变化 / 盘端只剩占位 / 抓取失败一律一个字不写。
 * 抓取口径（下钻最多 2 级、先剔占位再判断、前缀回填）补齐 / 连载轮询 / 待办扫描三处
 * 共用 locateContent 一份实现，不要再另写一份，否则签名会误判「有变化」。
 */
async function runSerialRefresh() {
  // 同步任务用 --ids 当场补新条目时不掺轮询；--only 非剧集分类的试跑也不轮询。
  if (wantedIds || serialsN <= 0 || (only && !SERIAL_FILES.includes(`${only}.yaml`))) return;
  const all = [];
  for (const name of SERIAL_FILES) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) all.push(...parseSerialFile(file));
  }
  const picked = pickSerials(all, Date.now(), serialsN, today);
  console.log(`\n[连载轮询] 候选 ${all.length} 条 · 本轮抽查 ${picked.length} 条（只有盘端变了才写盘）`);
  const cred = airingN > 0 ? readCredentials() : { token: '' };
  const issues = [];
  const reminders = [];
  let changed = 0;
  let unchanged = 0;
  for (const item of picked) {
    process.stdout.write(`  ${item.id} … `);
    const rootRes = await fetchAll(item.quarkUrl);
    if (!rootRes.files) {
      const msg = rootRes.error || '分享内容为空';
      console.log(`失败（${msg}）`);
      issues.push(`${item.id}: ${msg}`);
    } else {
      // 下钻（最多 2 级）与剔占位与补齐流程共用同一份 locateContent（2026-11-10 定稿）。
      // 下钻中途抓取失败一律按失败上报：残缺的目录级快照不是「盘端变了」，绝不能整体重写清单。
      const loc = await locateContent(item.quarkUrl, rootRes.files);
      let agg = null;
      if (loc.error) {
        console.log(`失败（${loc.error}）`);
        issues.push(`${item.id}: ${loc.error}`);
      } else {
        const real = loc.files;
        agg = real.length ? aggregate({ files: real }, real.length) : null;
        if (agg?.tree && loc.prefix.length) agg.tree = [...loc.prefix, ...agg.tree.split('\n')].join('\n');
        if (!agg) {
          console.log('跳过（盘端只有占位说明文件，资源还没到位）');
        } else if (signatureFromLines(item.lines, item.filesFrom, item.filesEnd) === signatureOf(agg)) {
          console.log('无变化');
          unchanged++;
        } else {
          if (!dryRun) rewriteSerialFiles(item.file, item.id, () => toYamlLines(agg, true));
          console.log(dryRun ? '有变化（试跑，不写盘）' : `已刷新（${agg.count ?? '?'} 项）`);
          changed++;
        }
      }
      // 追更提醒（只读）：复用本轮已抓的盘端快照，零额外夸克请求。TMDB 只提供「播出事件」
      // 这个事实，不解析、不写入任何集数结论；凭据缺失 / 匹配不确定就静默跳过。
      if (agg && airingN > 0 && cred.token && hasEpisodeNames(agg.tree)) {
        const year = /(\d{4})/.exec(item.date || item.added || '')?.[1] || '';
        const hit = searchTvId(item.title, year, cred);
        const air = hit ? tvAiring(hit.id, cred) : null;
        const ep = air?.last;
        const season = seasonOf(agg.tree, item.title);
        const sameSeason = season == null || ep?.season == null || season === ep.season;
        if (hit && air && /Returning Series|In Production|Planned/.test(air.status) && ep && airedWithin(ep.date, today) && sameSeason) {
          console.log(
            `[追更提醒] ${item.id} ${item.title} · TMDB《${hit.name}》S${ep.season}E${ep.episode} 于 ${ep.date} 播出` +
            ` · 盘端当前 ${agg.count ?? '?'} 项，请确认是否已追 ${item.quarkUrl}`
          );
          reminders.push(item.id);
        }
      }
    }
    if (delayMs) await sleep(delayMs);
  }
  console.log(`[连载轮询] 刷新 ${changed} · 无变化 ${unchanged} · 失败 ${issues.length}`);
  if (issues.length) {
    console.log('连载轮询失败清单（多为链接失效 / 需提取码，需人工核验后再标 dead）：');
    for (const s of issues) console.log(`  ${s}`);
  }
  if (airingN > 0) {
    if (!cred.token) {
      console.log('[追更提醒] 未找到 TMDB_TOKEN（环境变量或 skill config.env），本轮跳过；不影响补齐 / 轮询 / 待办');
    } else {
      console.log(`[追更提醒] 本轮命中 ${reminders.length} 条${reminders.length ? `：${reminders.join('、')}` : ''}`);
    }
  }
}

await runSerialRefresh();

console.log(`\n完成：成功 ${ok} · 跳过 ${skip} · 失败 ${fail} · 尝试 ${tried} 个候选`);
if (notReady.length) {
  console.log(`盘端仍是占位目录、等资源到位再补：${notReady.join('、')}`);
}
if (failed.length) {
  console.log('失败清单（多为链接失效 / 需提取码）：');
  for (const f of failed) console.log(`  ${f}`);
}

/**
 * 人工待办扫描：trending-sync 建的是空编号目录（先出永久链、入库，正片由人工转存），
 * 而补齐队列按 added 升序先补老资源，这些新空目录排在最末，发现太慢。
 * 这里按 added 降序抽查最近入库的剧集 / 动漫，只读判断盘端是否仍只有占位说明文件。
 * 空 = 需要人往夸克目录加资源；一旦加了内容，下轮自动从清单消失，无需手工销账。
 */
async function runTodoScan() {
  if (wantedIds || todoN <= 0 || (only && !SERIAL_FILES.includes(`${only}.yaml`))) return;
  const recent = all
    .filter((p) => SERIAL_FILES.includes(path.basename(p.file)))
    .slice(-todoN)
    .reverse();
  if (!recent.length) return;
  console.log(`\n[待加资源] 抽查最近入库 ${recent.length} 条（盘端仍空 = 需要往夸克目录加资源）`);
  const empty = [];
  const errors = [];
  for (const item of recent) {
    process.stdout.write(`  ${item.id} … `);
    const r = await fetchAll(item.url);
    if (!r.files) {
      console.log(`抓取失败（${r.error || '分享内容为空'}）`);
      errors.push(`${item.id}: ${r.error || '分享内容为空'}`);
    } else {
      // 与补齐 / 连载轮询共用同一份 locateContent：先剔占位再判断下钻，最多 2 级。
      // 这里只读盘点，不回填 prefix、不写盘；下钻失败只算抓取失败，不进「待加资源」清单。
      const loc = await locateContent(item.url, r.files);
      if (loc.error) {
        console.log(`抓取失败（${loc.error}）`);
        errors.push(`${item.id}: ${loc.error}`);
      } else if (!loc.files.length) {
        console.log(`空（只有占位说明文件） ${item.url}`);
        empty.push(item.id);
      } else {
        console.log(`已有内容（${loc.files.length} 项），交给补齐队列`);
      }
    }
    if (delayMs) await sleep(delayMs);
  }
  console.log(`[待加资源] 盘端仍空 ${empty.length} 条：${empty.join('、') || '无'}`);
  if (empty.length) {
    console.log('↑ 这些 id 照抄进飞书 --follow（脚本按 id 回查 data/*.yaml 拼标题与夸克链接）；加完资源后下轮自动消失。');
  }
  if (errors.length) {
    console.log('待办扫描失败清单（需人工核验链接）：');
    for (const e of errors) console.log(`  ${e}`);
  }
}

await runTodoScan();
