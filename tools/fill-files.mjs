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
// 最多尝试次数由 --tries 兜底（默认每个写入额度 20 次请求，防止全库空目录时空转打接口）。
//
// 每个分类补齐 1 条（--per-category，2026-11-22 起为编排脚本默认口径）：
//   不再全局按 added 取前 N 条——那样电影分类会连续霸占整轮额度，其他分类长期饿死。
//   改为按分类分组，每个有待补条目的分类各取 added 升序的 1 条；该条占位/抓取失败时
//   在**本分类内**继续顺延下一条，**占位/失败不消耗该类的候选额度**（2026-11-25 修）。
//   历史 bug：原先每类最多试 20 个候选，movie 队头 20 条恰好全是占位目录，
//   导致队尾真实资源永远排不到、连续多轮「movie 未补」；现在改为：
//     · 各分类**轮流**试 1 条（防止某类把全局预算吃光），补成 1 条即退出该类；
//     · 占位/失败继续顺延，只有全局请求预算（写入额度数 × --tries）用尽或全类扫完才停。
//   --limit 在此模式下被忽略（额度=分类数）；--only / --ids 是定向用法，per-category 对它们不生效。
//   刚确认为占位的 id 记入 ~/.cache/quark-sync/fill-files-notready.json，TTL（默认 6 小时）内
//   直接跳过、不发请求也不消耗预算；资源到位后最快下下轮自动被重新检查。
//
// 排除清单（2026-11-25 起）：config/fill-files-exclude.json 里的 id 是长期占位/分享失效
//   的资源，扫描待补队列时直接跳过、不占预算；资源到位后从数组删掉即恢复例行补齐。
//   人工核实已恢复时可用 --ids 显式指定，覆盖排除清单（日志会提示）。
//
// 用法：
//   node scripts/fill-files.mjs --limit 30            # 本次最多补 30 条（默认，全局 added 升序）
//   node scripts/fill-files.mjs --per-category        # 每个分类各补 1 条（编排脚本默认口径）
//   node scripts/fill-files.mjs --limit 1             # 每日例行：只补 1 条，队首是空目录就顺延
//   node scripts/fill-files.mjs --limit 3 --only misc # 只处理 data/misc.yaml，小批试跑
//   node scripts/fill-files.mjs --ids mv-427,tv-086   # 只补指定 id（同步任务入库后当场补；已有 files: 的自动跳过）
//   node scripts/fill-files.mjs --dry-run             # 只抓取打印，不写文件
//   node scripts/fill-files.mjs --limit 50 --delay 4000  # 请求更慢更稳
//   node scripts/fill-files.mjs --limit 5 --tries 30  # 每条额度的请求预算 30 次（占位也发请求，但不占写入额度）
//   node scripts/fill-files.mjs --recheck-hours 0     # 临时关掉空目录缓存（每次都重新抓）
//   node scripts/fill-files.mjs --serials 1 --limit 0 # 只跑连载轮询（调试）
//   node scripts/fill-files.mjs --serials 0           # 临时关掉连载轮询
//   node scripts/fill-files.mjs --airing 0            # 临时关掉追更提醒
//   node scripts/fill-files.mjs --limit 0 --serials 0 --todo 40 --dry-run  # 一次看待加资源清单
//
// 建议节奏：每天跑一批（--limit 20~30），配合站点「updated 逐日分散」的策略。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortTree } from './lib/tree-sort.mjs';
import { todayShanghai } from '../scripts/lib/data.js';
import { QUARK_CLI as CLI, QUARK_CLI_ENV } from './lib/quark-cli.mjs';
import {
  SERIAL_FILES,
  splitLines,
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

// 排除清单（2026-11-25）：盘端长期只有占位说明文件、或分享失效无法抓取的 id，
// 不再每轮重复请求。格式与 config/drive-source-ids.json 相同（纯 id 数组）。
// 资源到位后从数组删掉即恢复正常；--ids 显式指定可临时覆盖排除（用于人工核实已恢复）。
const excludeFile = path.join(root, 'config', 'fill-files-exclude.json');
function loadExcludeIds() {
  try {
    const arr = JSON.parse(fs.readFileSync(excludeFile, 'utf8'));
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()) : []);
  } catch {
    return new Set();
  }
}
const excludeIds = loadExcludeIds();

// 网盘目录里的「占位说明文件」是同步任务自建（或人工放过）的工作流产物，不是资源内容。
// 2026-11-08 起 trending-sync / mirror-baidu 预置三份：更新通知、QQ 群缺失反馈、站点导流；
// 站点导流当天改过名，铺下去的旧名「我的网盘网址www.wodewangpan.top.md」已在 643 个夸克目录里
// 且网盘 CLI 无删除命令 → 新旧两名都必须识别，漏任一个就等于把几百份说明文件当真实资源写进 files:。
// 另有历史/人工放过的一份「资源正在陆续更新上传中…」（实测全盘仅 1 处，在 04电影/005-山竹刀）。
// 权威定义在 quark-resource-sync skill 的 scripts/lib/placeholder.mjs（PLACEHOLDER_PREFIXES + PLACEHOLDER_SUFFIXES）；
// 跨仓库无法 import，改那边必须同步改这里。
// 2026-11-10 追加第二类排除对象：NAS 播放器的**片头/片尾标识文件**（`.op` = opening、`.ed` = ending，将军定性），
//   紧贴正片名生成，三种形态：`.正片名.mkv.fg`、`.正片名.mkv.fg.op`、`.正片名.mkv.fg.ed`，每个约 100~140 KB。
//   它们是播放器附属产物，不是资源内容，一律不进清单。
//   这类文件名字以 `.` 开头，按行首前缀永远匹配不上 → 只能按后缀认（`\.(?:ed|op)?` 尾支）。
//   漏掉它们的后果：`count` 被虚增、扩展名分布统计成根本不存在的 `OP×N`（实测污染 10 条电视剧清单）；
//   更坏的是把「只铺了片头片尾标记、正片还没转存」误读成「资源已到位」。
//   ⚠ 只列这三种，不写成 `\.fg.*` 通配——将来播放器若另生 `.fg.xxx`（如字幕标记），通配会连真实附属信息一起误剔。
//   ⚠ 前缀那五份说明文件仍必须带 `^` 锚子，只有这一支是后缀规则。
// 2026-11-12 追加第三类排除对象：macOS / Windows 留下的**系统垃圾文件**（将军定性）。
//   `.DS_Store`（访达的图标与排序缓存）、`._xxx`（AppleDouble 伴生元数据，macOS 拷贝/压缩时给每个文件配一份，
//   所以目录里会同时出现 `.DS_Store` 和它自己的伴生件 `._.DS_Store`）、`__MACOSX`（macOS 压 ZIP 时附带的资源分支目录）、
//   `Thumbs.db` / `Desktop.ini`（Windows 的缩略图缓存与文件夹配置）。
//   它们既不是资源内容、也不是本站的工作流产物，是**上传者从自己机器上盘时顺手带进来的**，网盘删不掉。
//   实测已被写进 5 条清单：tv-019 哥谭 / tv-020 海豹六队 / tv-026 石油天王 / mv-016 隐藏的面孔 / mv-045 虎胆龙威，
//   后果与 .fg 同量级：`count` 虚增、详情页清单末行挂着 `.DS_Store`，
//   还会破坏 locateContent「本级只剩一个目录才下钻」的判断（正片目录 + 一份 .DS_Store = 两项，下钻提前停一层）。
//   ⚠ 这些名字以 `.` 或 `_` 开头，逐条**精确锚定**（`^…$`）；不要退化成无锚子的串匹配，
//     否则片名里带 Thumbs / Desktop / macOS 字样的真实文件会被连坐误剔。
//   ⚠ 唯一一支前缀规则是 `^\._`：AppleDouble 的名字跟着正片名变（`._正片名.mkv`），无法穷举，
//     但它固定以「点 + 下划线」开头，真实资源名不会以这两个字符起头。
const PLACEHOLDER_FILE_RE =
  /^(资源在24小时内更新|资源缺失反馈请加QQ群|关于我的网盘索引站|我的网盘网址|资源正在陆续更新上传中)|\.fg(?:\.ed|\.op)?$|^\.DS_Store$|^\._|^__MACOSX$|^Thumbs\.db$|^Desktop\.ini$/i;

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
// 每个分类各补 1 条：编排脚本默认口径。定向 --only/--ids 时不生效。
const perCategory = hasFlag('per-category');
// 每轮顺带抽查几条连载条目（默认 1；0 = 临时关闭）。与 --limit 的补齐额度互相独立。
const serialsN = Math.max(0, Number(getArg('serials', 1)) || 0);
// 每轮抽查几条「最近入库」的剧集目录，找出盘端仍空、需要人工加资源的（默认 3；0 = 关闭）。
// 只读，不占补齐额度、不写盘；结果由任务 agent 塞进飞书 --follow。
const todoN = Math.max(0, Number(getArg('todo', 3)) || 0);
// 连载轮询时顺带查 TMDB 播出事件（默认开；0 = 关闭）。只读、不写数据、零额外夸克请求。
const airingN = Math.max(0, Number(getArg('airing', 1)) || 0);
// 每写入 1 条允许的请求数上限（占位/失败顺延的兜底，避免空转打爆接口）。
// 注意这是「总请求预算」而不是「每类看几个候选」：占位/失败照样发请求，但不应该把
// 后面的真实资源永久挡在队头（2026-11-25 修）。
const triesPerWrite = Math.max(1, Number(getArg('tries', 20)) || 20);
// 刚确认为空目录的 id 记入缓存，TTL 内不再发请求（默认 6 小时 = 3 轮例行任务）。
// 否则 queue 修好后每轮仍要把同一批占位目录重抓一遍，真实资源永远排在请求预算之后。
// 用环境变量可改缓存位置（便于隔离测试）；--recheck-hours 0 关闭缓存。
const recheckHours = Math.max(0, Number(getArg('recheck-hours', 6)) || 0);
const notReadyFile =
  process.env.WDP_FILLFILES_NOTREADY_FILE ||
  path.join(os.homedir(), '.cache', 'quark-sync', 'fill-files-notready.json');

/**
 * 取数口径（2026-11-11 可切换；2026-11-25 默认值改为 drive）。
 *   · drive（默认）：登录态网盘目录（CLI browse --all），反映**盘端真实内容**。
 *   · share：夸克分享详情接口，客态访问、无需网盘授权，反映**访客实际能拿到什么**。
 * 默认改 drive 的原因（2026-11-25）：夸克对分享链接做**文件级屏蔽**——同一目录登录态有全集、
 * 访客只看到 2 份说明文件。之前默认 share 把 28 条判成占位，实际 20 条盘端有真资源（误判率 71%），
 * 客态 share 只能反映「平台给不给访客看」，不能用来判断资源是否到位。默认走盘端才是真实清单。
 * ⚠ share 仍保留为可选回退（`--source share`）：仅当登录态不可用、或需复核访客可见范围时用。
 * ⚠ 只换「取一个目录的直接子项」这一层：下钻、剔占位、聚合、排序、签名比对仍只有
 *   locateContent + aggregate + lib/tree-sort 一份实现。两套源写出来的 files 块必须同构，
 *   否则连载轮询会因口径差误判「盘端变了」，每轮重写并伪造 updated（AGENTS.md §5 第一红线）。
 *   2026-11-25 已实测同批条目两种口径的连载轮询结果一致，默认切 drive 不污染轮询。
 * ⚠ 走 drive 需要 config/drive-fids.json 里有该 id 的盘端 fid：当前 945 条有映射，
 *   140 条（多为新入库）缺映射会打印提示并自动回落 share，重跑 scan-drive-fids.mjs 可补全。
 */
const SOURCE = String(getArg('source', 'drive')).toLowerCase();
const DRIVE_MAP_FILE = path.join(root, 'config', 'drive-fids.json');
const DRIVE_IDS_FILE = path.join(root, 'config', 'drive-source-ids.json');
let driveMap = null;
let driveIds = null;
/** id → 盘端编号目录的 { fid, name }；映射由 scripts/scan-drive-fids.mjs 生成 */
function loadDriveMap() {
  if (driveMap !== null) return driveMap;
  try {
    driveMap = JSON.parse(fs.readFileSync(DRIVE_MAP_FILE, 'utf8'));
  } catch {
    driveMap = {};
  }
  return driveMap;
}
/** 固定走盘端口径的条目清单（被屏蔽台账）；缺文件视为空表 */
function loadDriveIds() {
  if (driveIds !== null) return driveIds;
  try {
    driveIds = new Set(JSON.parse(fs.readFileSync(DRIVE_IDS_FILE, 'utf8')));
  } catch {
    driveIds = new Set();
  }
  return driveIds;
}
/** 本条是否走登录态盘端口径 */
function useDrive(id) {
  if (SOURCE !== 'drive' && !loadDriveIds().has(id)) return false;
  const hit = loadDriveMap()[id];
  if (!hit || !hit.fid) {
    console.log(`  ${id} 指定了 drive 口径但 config/drive-fids.json 里没有它的盘端目录 fid，回落 share`);
    return false;
  }
  return true;
}

// 北京时间今天，写进条目的 updated 字段（sitemap lastmod 依此真实更新）
const today = todayShanghai();
// 夸克 skill 要求的追踪参数
const SESSION_ID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
const SESSION_INPUT = '批量抓取分享链接的文件清单';

if (!fs.existsSync(CLI)) {
  console.error(`! 找不到夸克 CLI：${CLI}`);
  console.error('  先安装 quarkclouddrive skill（bash ~/.workbuddy/skills/quarkclouddrive/scripts/install.sh）');
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
      { encoding: 'utf8', timeout: 90_000, env: QUARK_CLI_ENV }
    );
  } catch (e) {
    const detail = String(e.stderr || e.message || '').trim().split('\n').slice(-1)[0] || `exit=${e.status}`;
    return { error: `调用失败：${detail.slice(0, 300)}` };
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

/** 空目录缓存：{ id: ISO 时间戳 }。只留 TTL 内的记录，过期自动重新检查。 */
function loadNotReady(nowMs) {
  if (recheckHours <= 0) return new Map();
  try {
    const obj = JSON.parse(fs.readFileSync(notReadyFile, 'utf8'));
    const out = new Map();
    for (const [id, ts] of Object.entries(obj)) {
      const t = Date.parse(ts);
      if (Number.isFinite(t) && nowMs - t < recheckHours * 3600_000) out.set(id, ts);
    }
    return out;
  } catch {
    return new Map();
  }
}

function saveNotReady(map) {
  if (recheckHours <= 0 || dryRun) return;
  try {
    fs.mkdirSync(path.dirname(notReadyFile), { recursive: true });
    fs.writeFileSync(notReadyFile, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`);
  } catch (e) {
    console.log(`  [提醒] 空目录缓存写入失败（不影响本轮补齐）：${e.message}`);
  }
}
/** 单目录最多翻几页（50 条/页）：绝大多数目录一页就够，超大目录封顶 150 条 */
const MAX_PAGES = 3;
/** drive 口径的中间产物目录（browse 的 JSONL 落这里，绝不落在仓库里，免得污染 git status） */
const DRIVE_TMP = path.join(os.tmpdir(), 'wdwp-fill-files', SESSION_ID);

/**
 * drive 口径：登录态读某个网盘目录的直接子项。
 * 返回条目的字段（filename / file_type / size / fid）与 share-detail 一致，
 * 所以下游 locateContent、aggregate、tree-sort 一行都不用改。
 */
function fetchDriveDir(fid) {
  let out;
  try {
    fs.mkdirSync(DRIVE_TMP, { recursive: true });
    out = execFileSync(
      process.execPath,
      [
        CLI,
        'browse',
        '--parent-fid', fid,
        '--all',
        '--task-dir', DRIVE_TMP,
        '--session-input', SESSION_INPUT,
        '--session-id', SESSION_ID,
      ],
      { encoding: 'utf8', timeout: 180_000, env: QUARK_CLI_ENV }
    );
  } catch (e) {
    const detail = String(e.stderr || e.message || '').trim().split('\n').slice(-1)[0] || `exit=${e.status}`;
    return { error: `调用失败：${detail.slice(0, 300)}` };
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
    if (obj.type !== 'result' || obj.action !== 'browse') continue;
    if (obj.code !== 0) return { error: obj.msg || `code=${obj.code}` };
    const file = obj.data?.file_path;
    if (!file || !fs.existsSync(file)) return { error: 'browse 未落盘子项清单' };
    const raw = fs.readFileSync(file, 'utf8').trim();
    const files = raw ? raw.split('\n').map((l) => JSON.parse(l)) : [];
    return { data: { files } };
  }
  return { error: 'CLI 无 result 输出' };
}

/**
 * 翻页取全一个目录的文件列表；成功返回 { files }，失败返回 { error }
 * target = { url, id }：id 命中 drive 口径时走登录态，否则走分享客态。
 * drive 的第一层（pdirFid 为空）合成成「根目录里只有那个编号目录」，
 * 这样下钻与 prefix 的行为和 share 完全同构。
 */
async function fetchAll(target, pdirFid = '') {
  const { url, id } = target;
  if (useDrive(id)) {
    const hit = loadDriveMap()[id];
    if (!pdirFid) return { files: [{ fid: hit.fid, filename: hit.name, file_type: '0', size: 0 }] };
    const r = fetchDriveDir(pdirFid);
    return r.data ? { files: r.data.files } : r;
  }
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
async function locateContent(target, rootFiles) {
  let files = rootFiles.filter((f) => !PLACEHOLDER_FILE_RE.test(String(f.filename || '')));
  const prefix = [];
  let depth = 0;
  while (files.length === 1 && files[0].file_type === '0' && depth < 2) {
    const sub = await fetchAll(target, files[0].fid);
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
  // 统一交给 sortTree 排成「目录优先 → 扩展名分组 → 组内自然序」，排完再截前 100 行，
  // 这样大目录被截断时留下的是最靠前的一批，而不是接口随手给的一批。
  const tree = sortTree(
    files.map((f) => {
      const name = String(f.filename || '').trim();
      return f.file_type === '0' ? `${name}/` : name;
    })
  );
  if (tree.length) out.tree = tree.slice(0, 100).join('\n');

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
    // data/*.yaml 逐行保留各自的行尾（serials.mjs 的 splitLines 唯一实现）：
    // 若统一成一种行尾，没动过的行也会进 diff，并与并行提交 data/ 的任务互相整体覆盖。
    const lines = splitLines(fs.readFileSync(file, 'utf8'));
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

const perCatMode = perCategory && !wantedIds && !only;
console.log(
  `fill-files：${dryRun ? '试跑（不写文件）' : '写入'} · ${
    wantedIds
      ? `指定 ${wantedIds.length} 个 id`
      : perCatMode
        ? '每个分类各补 1 条（占位/失败在本分类内顺延，无待补分类跳过）'
        : `补 ${limit} 条（占位/失败顺延，最多 ${limit * triesPerWrite} 次请求）`
  } · 按 added 升序 · 间隔 ${delayMs}ms · updated=${today}`
);
const scanned = collectPending();
// 排除清单：占位/失效资源不进待补队列，也不占请求预算；--ids 显式指定时允许覆盖。
const forcedIds = wantedIds ? new Set(wantedIds) : new Set();
const excluded = scanned.filter((p) => excludeIds.has(p.id) && !forcedIds.has(p.id));
if (excluded.length) {
  console.log(`排除清单：跳过 ${excluded.length} 条（config/fill-files-exclude.json）\n`);
}
if (forcedIds.size) {
  const forced = wantedIds.filter((id) => excludeIds.has(id) && scanned.some((p) => p.id === id));
  if (forced.length) console.log(`--ids 显式指定：覆盖排除清单 ${forced.join('、')}\n`);
}
const all = scanned.filter((p) => !excluded.includes(p));
// --ids 只补同步任务本轮新增的那几条；已有 files: 的条目 collectPending 已排除，重复执行安全
let pending = all;
if (wantedIds) {
  const set = new Set(wantedIds);
  pending = all.filter((p) => set.has(p.id));
  const skipped = wantedIds.filter((id) => !pending.some((p) => p.id === id));
  console.log(
    `全库待补：${all.length} 个（排除清单外）· 本次指定：${pending.length} 个` +
      (skipped.length ? ` · 跳过（已有 files: 或仓库内不存在）：${skipped.join('、')}` : '') +
      '\n'
  );
} else {
  console.log(`待补条目：${all.length} 个\n`);
}
// --limit 是「写入额度」而不是「查看条数」：占位目录 / 抓取失败不占额度，自动顺延下一条，
// 直到写满额度，或全局请求预算用尽（--tries × 写入额度，防止全库都是空目录时空转打接口）。
// --ids 是同步任务入库后当场补的那几条，指定的全部试完，不受额度约束。
//
// 每分类 1 条（perCatMode）：把 pending 按 file 分组，每组即一个分类的候选队列（组内已按
// added 升序）。writeCap = 有待补条目的分类数（每类最多写 1 条）。各分类**轮流**试 1 条，
// 占位/失败继续在本类内往后顺延，直到本类写满 1 条或全局预算用尽。
let writeCap;
let maxTries;
let groups = null; // perCatMode 下：Array<Array<pendingItem>>，每个子数组是一个分类的候选
if (perCatMode) {
  const byFile = new Map();
  for (const p of pending) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p); // pending 全局 added 升序 → 每组内天然升序
  }
  groups = [...byFile.values()];
  writeCap = groups.length;
  maxTries = writeCap * triesPerWrite;
  console.log(`每分类 1 条模式：${writeCap} 个分类有待补条目 · 全局最多请求 ${maxTries} 次（占位/失败继续在本类顺延）\n`);
} else {
  writeCap = wantedIds ? Infinity : limit;
  maxTries = wantedIds ? pending.length : Math.min(pending.length, writeCap * triesPerWrite);
}
let tried = 0;

// 同一文件的条目共享一份 lines；插入后把同文件里更靠后条目的插入点顺移
const dirtyFiles = new Set();
let ok = 0;
let fail = 0;
let skip = 0;
const failed = [];
const notReady = [];
// 空目录缓存：TTL 内直接跳过，不发请求、不消耗全局预算（2026-11-25）
const nowMs = Date.now();
const notReadyMap = loadNotReady(nowMs);
if (notReadyMap.size) {
  console.log(`空目录缓存：${notReadyMap.size} 条在 ${recheckHours}h 内跳过，不占请求预算\n`);
}

/** 试一个候选：返回 ok / skip / fail。占位与失败都不写盘，由调用方继续在本类顺延。 */
async function tryOne(item) {
  try {
    // 根目录往往只装一个总文件夹：按 locateContent 的口径下钻（最多 2 级）拿真实内容清单
    const root = await fetchAll({ url: item.url, id: item.id });
    if (!root.files) {
      const msg = root.error || '分享内容为空';
      console.log(`失败（${msg}）`);
      fail++;
      failed.push(`${item.id}: ${msg}`);
      return 'fail';
    }
    // 占位说明文件（trending-sync / 夸克同步建目录时预置，2026-11-08 起两份）：
    //   · 更新通知「资源在24小时内更新-请先转存-更新会自动通知.md」
    //   · 缺失反馈「资源缺失反馈请加QQ群1045824859.md」
    // 是我们自己的工作流产物，不属于资源内容：
    //   · 盘端只剩它们时 = 资源还没到位（TMDB 今日热门建的就是这种空目录）→ 整条跳过、一个字不写；
    //   · 否则把它们从清单里剔掉，count / tree / format 只统计真实内容（AGENTS.md §5：宁缺勿假）。
    // ⚠ 新增/改名占位文件时必须同步改这里，否则占位 md 会被当成真实资源写进 files: 假清单。
    //   权威定义在 quark-resource-sync skill 的 scripts/lib/placeholder.mjs（本仓库 vendor 内有副本，跨仓库无法 import）。
    // 下钻（最多 2 级）与剔占位的口径只在 locateContent 一份，连载轮询共用（2026-11-10 定稿）。
    const loc = await locateContent({ url: item.url, id: item.id }, root.files);
    if (loc.error) {
      console.log(`失败（${loc.error}）`);
      fail++;
      failed.push(`${item.id}: ${loc.error}`);
      return 'fail';
    }
    const real = loc.files;
    const prefix = loc.prefix;
    if (!real.length) {
      console.log('跳过（盘端只有占位说明文件，资源还没到位）');
      skip++;
      notReady.push(item.id);
      notReadyMap.set(item.id, new Date().toISOString());
      return 'skip';
    }
    // count 用实际拿到的条目数：子目录查询的 file_num 不可靠
    const agg = aggregate({ files: real }, real.length);
    if (prefix.length && agg?.tree) agg.tree = [...prefix, ...agg.tree.split('\n')].join('\n');
    if (!agg) {
      console.log('跳过（分享内容为空）');
      fail++;
      failed.push(`${item.id}: 分享内容为空`);
      return 'fail';
    }
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
    notReadyMap.delete(item.id);
    return 'ok';
  } finally {
    if (delayMs) await sleep(delayMs);
  }
}

// 非 perCatMode 时 rounds=[pending]，单组队列 = 原有全局线性口径（行为不变）。
// perCatMode 时各组轮流一次试 1 条：占位/失败只推进该组游标，不消耗写入额度；
// 某类先补满就退出，全局请求预算用尽或所有组扫完则停。
const rounds = perCatMode ? groups : [pending];
const cursors = rounds.map(() => 0);
const written = rounds.map(() => 0);
const perGroupCap = perCatMode ? 1 : writeCap;
let active = rounds.length;
while (active > 0) {
  if (!perCatMode && ok >= writeCap) break;
  let progressed = false;
  for (let gi = 0; gi < rounds.length; gi++) {
    const group = rounds[gi];
    if (written[gi] >= perGroupCap || cursors[gi] >= group.length) continue;
    const item = group[cursors[gi]++];
    // TTL 内已确认空的目录：打印后直接跳过，不发请求也不占全局预算（2026-11-25）
    if (notReadyMap.has(item.id)) {
      console.log(`${item.id} … 跳过（空目录缓存内，${recheckHours}h 后复查）`);
      skip++;
      notReady.push(item.id);
      progressed = true;
      continue;
    }
    if (tried >= maxTries) continue; // 预算用尽；缓存内的仍能在上面被跳过
    tried++;
    process.stdout.write(`${item.id} … `);
    const result = await tryOne(item);
    if (result === 'ok') {
      written[gi]++;
      if (perCatMode) active--;
    }
    progressed = true;
  }
  if (!progressed) break;
}
saveNotReady(notReadyMap);

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
    const rootRes = await fetchAll({ url: item.quarkUrl, id: item.id });
    if (!rootRes.files) {
      const msg = rootRes.error || '分享内容为空';
      console.log(`失败（${msg}）`);
      issues.push(`${item.id}: ${msg}`);
    } else {
      // 下钻（最多 2 级）与剔占位与补齐流程共用同一份 locateContent（2026-11-10 定稿）。
      // 下钻中途抓取失败一律按失败上报：残缺的目录级快照不是「盘端变了」，绝不能整体重写清单。
      const loc = await locateContent({ url: item.quarkUrl, id: item.id }, rootRes.files);
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
    const r = await fetchAll({ url: item.url, id: item.id });
    if (!r.files) {
      console.log(`抓取失败（${r.error || '分享内容为空'}）`);
      errors.push(`${item.id}: ${r.error || '分享内容为空'}`);
    } else {
      // 与补齐 / 连载轮询共用同一份 locateContent：先剔占位再判断下钻，最多 2 级。
      // 这里只读盘点，不回填 prefix、不写盘；下钻失败只算抓取失败，不进「待加资源」清单。
      const loc = await locateContent({ url: item.url, id: item.id }, r.files);
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
