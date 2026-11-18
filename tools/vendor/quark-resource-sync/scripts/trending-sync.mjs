#!/usr/bin/env node
// TMDB 今日热门 → 夸克网盘建编号目录 → 出链 → 海报 → 写 data/*.yaml。
// （百度网盘同名镜像 2026-11-01 起加过，**2026-11-08 起默认停用**：不再建百度目录、不再出百度链接，
//   存量条目的 baidu_url/baidu_pwd 一律不动；只有人工显式 --baidu 才临时恢复镜像+出链。）
// 用法：
//   node trending-sync.mjs [--movies 3] [--tv 3] [--anime 1] [--dry-run] [--allow-original] [--no-filter-anime] [--allow-program] [--baidu] [--recency-months 12] [--no-recency]
// 每天定时执行，已处理过的 TMDB id 记录在 ~/.workbuddy/quark-sync-cache/trending-seen.json，不会重复。
// 输出：stdout 人类可读摘要 + 机读 JSON 写入 ~/.workbuddy/quark-sync-cache/trending-last.json
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, SKILL, CACHE, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
import { posterDir } from './lib/site-paths.mjs';
import { isJpegFile } from '../../../lib/image-check.mjs';
import { buildBody, DESC_MIN } from './lib/desc.mjs';
import { bd, bdWhoami, bdListDir, bdMkdir, bdUploadFile, bdShare } from './lib/baidu.mjs';
import { resolvePlaceholders } from './lib/placeholder.mjs';
// 编号分配（2026-11-04 起空洞优先）+ 站点 yaml 按 id 就地改写（回收编号时顶掉死链旧条目）
import { usedSet, classifyHoles, createAllocator, pad3 } from './lib/number.mjs';
import { idOccupancy, upsertEntry } from './lib/yaml-store.mjs';

const STATE = path.join(CACHE, 'trending-seen.json');
const REPORT = path.join(CACHE, 'trending-last.json');

// ---------- 配置 ----------
const { TMDB_TOKEN, PROXY, REPO, SHARE_FID } = cfg;
const CLI = cfg.QUARK_CLI;
requireCfg(['TMDB_TOKEN', 'QUARK_CLI', 'SHARE_FID', 'REPO']);
const MAKE = path.join(SKILL, 'scripts', 'make-entry.mjs');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const DRY = has('dry-run');
const N_MOVIE = parseInt(arg('movies', '1'), 10);
const N_TV = parseInt(arg('tv', '1'), 10);
const N_ANIME = parseInt(arg('anime', '1'), 10);
const ALLOW_ORIGINAL = has('allow-original'); // 允许无中文译名的条目（默认跳过）
const NO_FILTER_ANIME = has('no-filter-anime'); // 不过滤动画（默认过滤 genre 16）
// 节目类黑名单（2026-11-11 用户要求：「以后脱口秀之类的节目尽量排除掉」）
// TMDB 剧集类型：10767 脱口秀（Talk）、10764 真人秀（Reality）、10763 新闻（News）。
// 这三个 id 只存在于剧集类型表里（电影类型表没有），所以实际只挡剧集类候选；
// 动漫候选已在上面要求 genre 16，不参与本判断，避免误伤「动画 + 脱口秀」这类杂交条目的动画身份。
// 与年份窗口同口径：命中只跳过并顺延，**不写 seen 状态**（榜单每天在变，黑名单以后可能调，不永久钉死）。
const PROGRAM_GENRES = new Set([10767, 10764, 10763]);
const PROGRAM_LABEL = '脱口秀 / 真人秀 / 新闻';
const ALLOW_PROGRAM = has('allow-program'); // 人工显式放开节目类黑名单
const NO_BUILD = has('no-build'); // 跳过构建
const NO_PUSH = has('no-push'); // 跳过提交与推送
// 百度网盘镜像与出链：**2026-11-08 起默认关闭**（用户要求后续不再镜像百度盘目录；存量 582 条 baidu_url 保持不动）。
// 想临时恢复必须人工显式加 --baidu；--no-baidu 保留为兼容写法（等于再关一次，不报错）。
const BAIDU_MIRROR = has('baidu') && !has('no-baidu');
const PUBLISH_ONLY = has('publish-only'); // 不抓新片，只把仓库里未提交的数据变更构建并推上去
// 新建目录此刻还没有资源 → 预置说明文件占位，等转存后可更新（2026-10-06 用户要求）
// 2026-11-08 起两份（更新通知 + QQ 群缺失反馈），唯一定义在 ./lib/placeholder.mjs
// --placeholder-name / --placeholder-text 只改写第一份（更新通知），QQ 反馈份保持内置
const PLACEHOLDERS = resolvePlaceholders(arg('placeholder-name', ''), arg('placeholder-text', ''));
const NO_PLACEHOLDER = has('no-placeholder');
const SESSION_INPUT =
  arg('session-input', '每天从TMDB中，搜索今日热门电影或电视剧，各3部，在夸克网盘对应的电影或电视剧目录，按照顺序建立目录，并且入库。不能重复。');
const SID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- 百度网盘镜像（2026-11-01 起有过，**2026-11-08 起默认停用**：不建同名目录、不出链接） ----------
// 默认整轮跳过，夸克主流程（建目录 / 出链 / 入库 / 构建 / 推送 / 飞书）完全不受影响；
// 只有人工显式 --baidu 才进入下面的探测；未装 bdpan / 未登录 / 显式 --no-baidu 时同样整轮跳过；
// 单条镜像失败只记录（rec.baidu='失败：…'），不阻断该条目的夸克入库。
const BAIDU = { bin: cfg.BD_PAN_CLI, root: cfg.BAIDU_ROOT, on: false, note: '' };
if (!BAIDU_MIRROR) BAIDU.note = '已停用（2026-11-08 起默认不镜像百度盘；恢复需人工显式 --baidu）';
else if (!BAIDU.bin) BAIDU.note = '本机未找到 bdpan，跳过百度镜像';
else {
  const w = await bdWhoami(BAIDU.bin);
  if (w.ok) { BAIDU.on = true; console.log(`[百度] bdpan 已登录（${w.expires_at ? 'token 有效至 ' + String(w.expires_at).slice(0, 10) : 'token 有效期未知'}）`); }
  else BAIDU.note = `bdpan 未登录/授权失效：${w.err}｜跳过百度镜像`;
}
if (!BAIDU.on) console.log(`[百度] ${BAIDU.note}`);
/**
 * 镜像一个目录到百度。2026-11-04 起：先探测百度该分类下是否已存在**等价的未编号目录**
 * （用户常把同一资源用原名手动转存到百度，如「诡术」）。命中就**原地改名**成 `编号-名称`
 * 与夸克对齐（内容随目录走、原分享链接仍有效），**绝不新建空目录造成同剧两份**；
 * 未命中才建目录 + 传占位说明文件。返回 'ok…' 或 '失败：…'（不抛错）。
 * @param {string} catDir  百度分类目录名（如 04电影）
 * @param {string} dirname 目标编号目录名（如 172-诡术）
 * @param {string[]} [nameHints] 候选「未编号原名」（TMDB 中文名 / 原语言名等），逐字命中才改名
 */
async function baiduMirrorDir(catDir, dirname, nameHints = []) {
  if (!BAIDU.on) return BAIDU.note || '跳过';
  try {
    // 1) 改名对齐：百度已有逐字等于某个候选原名的目录（且它本身不是编号目录）→ 原地改名，不新建
    const hints = [...new Set(nameHints.filter(Boolean))]
      .map((s) => String(s).trim())
      .filter((s) => s && s !== dirname && !(/^\d{3}-/.test(s)));
    if (hints.length) {
      const bl = await bdListDir(BAIDU.bin, BAIDU.root, catDir);
      if (bl.ok) {
        const hit = hints.find((h) => bl.names.includes(h));
        if (hit) {
          const rn = await bd(BAIDU.bin, ['rename', `${catDir}/${hit}`, dirname]);
          if (rn.ok) return `ok（改名对齐：${hit} → ${dirname}，内容随目录走，未新建）`;
          return `改名对齐失败：${rn.err}`;
        }
      }
      // bl 失败（限流等）：不阻断，继续走 mkdir 流程
    }
    // 2) 未命中 → 建目录 + 传占位
    const mk = await bdMkdir(BAIDU.bin, BAIDU.root, catDir, dirname);
    if (!mk.ok) return `建目录失败：${mk.err}`;
    if (NO_PLACEHOLDER) return 'ok（占位文件关闭，未传）';
    // 两份占位说明逐个上传；任一失败整体记为失败（与改前一致，不影响夸克主流程）
    const bad = [];
    for (const ph of PLACEHOLDERS) {
      const mdPath = path.join(TMP, ph.name);
      try {
        fs.writeFileSync(mdPath, ph.text, 'utf8');
        const up = await bdUploadFile(BAIDU.bin, BAIDU.root, catDir, dirname, mdPath, ph.name);
        if (!up.ok) bad.push(`${ph.name}：${up.err}`);
      } catch (e) { bad.push(`${ph.name}：${String(e.message).slice(0, 80)}`); }
      finally { try { fs.rmSync(mdPath, { force: true }); } catch {} }
      await sleep(300); // 轻限速，防百度风控
    }
    return bad.length ? `占位文件上传失败：${bad.join(' / ').slice(0, 150)}` : 'ok';
  } catch (e) {
    return `失败：${String(e.message).slice(0, 150)}`;
  }
}

// ---------- 工具 ----------
const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6, ...opts }, (e, s, x) =>
      e ? rej(new Error(String(x || e.message).slice(0, 300))) : res(s)
    )
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** TMDB 请求：代理优先，失败回退直连 */
async function tmdb(pathname) {
  const url = `https://api.tmdb.org/3${pathname}`;
  const call = (useProxy) =>
    run('curl', [
      '-s', '--max-time', '25',
      ...(useProxy && PROXY ? ['-x', PROXY] : []),
      '-H', `Authorization: Bearer ${TMDB_TOKEN}`,
      url,
    ]);
  let s = '';
  try { s = await call(true); } catch { s = ''; }
  if (!s || !s.trim().startsWith('{')) s = await call(false).catch(() => '');
  try { return JSON.parse(s); } catch { throw new Error(`TMDB 返回异常：${String(s).slice(0, 200)}`); }
}

/** 夸克 CLI 调用 */
const q = (args, opts = {}) =>
  run(process.execPath, [CLI, ...args, '--session-input', SESSION_INPUT, '--session-id', SID], opts);

/** browse 结果落 jsonl，读回来 */
async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await q([...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    // 旧版 CLI 不认 --task-dir（报 unknown option），回退到默认落盘位置
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return q(base);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  const p = JSON.parse(`"${m[1]}"`);
  if (!fs.existsSync(p)) throw new Error(`browse 结果文件不存在：${p}`);
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

const norm = (s) =>
  String(s || '')
    .replace(/^\d+\s*[-.]/, '')
    .replace(/[\[\(【].*?[\]\)】]/g, '')
    .replace(/[\s·・:：\-_.、,，!！?？'"“”‘’]/g, '')
    .toLowerCase();

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));

// ---------- 季号口径（2026-10-25 起「按季去重」） ----------
// 站内剧集类条目一直是「片名 第N季」的写法（权力的游戏 第一季、安多 第二季、天作不合的我们 第一季…），
// 而 TMDB 的剧名是不带季号的裸名。旧版只比裸名，「母狮 第三季」在站内、TMDB 剧名「母狮」判不上，
// 于是 2026-10-24 那轮把同一季又收了一遍建成 tv-168。现在统一：剧集类候选一律先解析出目标季，
// 用「片名 + 第N季」参与去重、命名目录、写条目 title。
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const cnNum = (n) => {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return String(n);
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return '十' + CN_NUM[n - 10];
  return CN_NUM[Math.floor(n / 10)] + '十' + (n % 10 ? CN_NUM[n % 10] : '');
};
/** 剧集类带季号的展示标题；电影与非剧集原样返回 */
const seasonAwareTitle = (it) => (it.type === 'tv' && it.season ? `${it.zh} 第${cnNum(it.season)}季` : it.zh);
/**
 * 季感知归一化：让「母狮」「母狮 第三季」「073-母狮（第三季-2026）」落到同一个键。
 * 注意 norm() 只去半角括号与【】，**不去全角（）**，所以这里要先自己剥一遍括号内容，
 * 否则「（第三季-2026）」会留下「（2026）」把键污染掉。
 */
const normTitle = (s) =>
  String(s || '')
    .replace(/[\[\(（【].*?[\]\)）】]/g, '')
    .replace(/^\d+\s*[-.\s]*/, '')
    .replace(/第[0-9一二三四五六七八九十百]+[季部篇]/g, '')
    .replace(/[\s·・:：\-_.、,，!！?？'"“”‘’]/g, '')
    .toLowerCase()
    .replace(/[0-9]+季/g, '')
    .replace(/s0*[1-9][0-9]*$/g, '');

/** 网盘目录名清洗：半角非法字符转全角 */
const cleanName = (s) =>
  String(s || '')
    .replace(/[\\/:*?"<>|]/g, (c) => ({ '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' }[c]))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

// ---------- 状态 ----------
function loadState() {
  let st = { seen: {} };
  try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { seen: {} }; }
  st.seen = st.seen || {};
  // 2026-10-23：短简介从「跳过」改成「补齐」，历史上一批只因简介不足 200 字被标成 skipped 的
  // 条目其实从未入库，这里放出来让它们重新参与筛选（真正的已入库条目有 id 字段，不受影响）。
  let dropped = 0;
  for (const k of Object.keys(st.seen)) {
    const g = st.seen[k];
    if (!g || typeof g !== 'object') continue;
    for (const id of Object.keys(g)) {
      if (g[id] && g[id].skipped === '简介不足200字') { delete g[id]; dropped += 1; }
    }
  }
  if (dropped) console.log(`[状态] 释放 ${dropped} 条历史「简介不足200字」误标条目，本轮可重新入库`);
  // 2026-10-25「按季去重」：剧集类已入库条目的键从裸 TMDB id 迁移到 `<id>:S<季号>`，
  // 这样同一部剧今后出新季还能被收进来；裸 id 键原样保留，继续挡住历史整剧条目。
  let migrated = 0;
  for (const k of Object.keys(st.seen)) {
    const g = st.seen[k];
    if (!g || typeof g !== 'object') continue;
    for (const id of Object.keys(g)) {
      const e = g[id];
      if (!e || e.id == null || e.season == null || !/^\d+$/.test(id)) continue;
      const nk = `${id}:S${e.season}`;
      if (!g[nk]) { g[nk] = { ...e }; migrated += 1; }
    }
  }
  if (migrated) console.log(`[状态] ${migrated} 条已入库记录补写「按季」键（<id>:S<季号>）`);
  return st;
}
function saveState(st) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
}

/** 从剧集 detail 里挑「目标季」：优先已播出的最新一季，没有播出日期就退化成编号最大的一季 */
function pickSeason(d) {
  const today = localDate();
  const seasons = (d.seasons || []).filter((s) => (s.season_number || 0) > 0 && (s.episode_count || 0) > 0);
  const aired = seasons.filter((s) => !s.air_date || s.air_date <= today);
  const target = (aired.length ? aired : seasons).slice().sort((a, b) => b.season_number - a.season_number)[0];
  const season = target ? target.season_number : d.last_episode_to_air?.season_number ?? null;
  // air_date = 目标季首播日，供年份窗口判定；TMDB 没填就是空串，由调用方回落整剧 first_air_date
  return { season, episodes: target ? target.episode_count : 0, air_date: target ? target.air_date || '' : '' };
}
/** 去重阶段用：单独取一次 detail 解析目标季（picked 之后第 3b 步会复用同一个结果，不重复请求） */
async function latestSeasonOf(tmdbId) {
  try {
    const d = await tmdb(`/tv/${tmdbId}?language=zh-CN`);
    return pickSeason(d);
  } catch {
    return { season: null, episodes: 0, air_date: '' };
  }
}

/** 站点 data/*.yaml 已有标题（防重复入库） */
function siteTitles(file) {
  const p = path.join(REPO, 'data', file);
  if (!fs.existsSync(p)) return new Set();
  const t = fs.readFileSync(p, 'utf8');
  return new Set([...t.matchAll(/^\s*title:\s*"?([^"\n]+)"?/gm)].map((m) => norm(m[1])));
}

// ---------- 分类映射 ----------
// file 用英文文件名（2026-10-09 起仓库 data/ 已全量改为英文命名，中文文件名会让入库落到孤立文件里）
const CATS = {
  movie: { dir: '04电影', key: '电影', prefix: 'mv', file: 'movie.yaml', tmdbType: 'movie', label: '电影' },
  tv: { dir: '03电视剧', key: '电视剧', prefix: 'tv', file: 'tv.yaml', tmdbType: 'tv', label: '电视剧' },
  // 动漫（2026-10-10 起并入每日同步）：候选池 = 今日热门「电影」榜的动画优先，其次「剧集」榜的动画；
  // 动画判定统一用 TMDB genre 16，不限语种。电影榜里常有动画电影但很少，取不到就自动退到剧集榜。
  anime: { dir: '05动漫', key: '动漫', prefix: 'an', file: 'anime.yaml', sources: ['movie', 'tv'], label: '动漫' },
};

// ---------- 发布：构建 → 提交 → 推送 GitHub ----------
/** 按 kind 汇总 id 范围，生成提交信息用的描述 */
const KIND_LABEL = { movie: '电影', tv: '电视剧', anime: '动漫' };
function idRange(list) {
  const byKind = { movie: [], tv: [], anime: [] };
  list.forEach((r) => byKind[r.kind]?.push(r.id));
  return Object.entries(byKind)
    .filter(([, ids]) => ids.length)
    .map(([kind, ids]) => {
      const sorted = [...ids].sort();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return `${KIND_LABEL[kind] || kind} ${first}${first === last ? '' : `~${last}`}`;
    })
    .join('、');
}

async function publish(report) {
  const created = report.created.filter((r) => r.status === 'ok');
  if (DRY) {
    console.log('\n[发布] dry-run：跳过构建与推送');
    report.publish = { skipped: 'dry-run' };
    return;
  }
  if (!created.length && !PUBLISH_ONLY) {
    console.log('\n[发布] 本轮无新增条目，跳过构建与推送');
    report.publish = { skipped: '无新增条目' };
    return;
  }

  const git = (args) => run('git', args, { cwd: REPO, maxBuffer: 32e6 });
  const pub = { build: null, commit: null, push: null };

  // 1) 构建（失败即中止，不推有问题的数据）
  if (!NO_BUILD) {
    try {
      const out = await run(process.execPath, ['scripts/build.js'], { cwd: REPO, maxBuffer: 64e6 });
      const line = (out.match(/完成：.*/) || [''])[0].trim();
      pub.build = line || 'ok';
      console.log(`\n[发布] 构建通过：${pub.build}`);
    } catch (e) {
      pub.build = `失败：${String(e.message).slice(0, 200)}`;
      console.log(`\n[发布] ✗ 构建失败，已中止推送：${pub.build}`);
      report.publish = pub;
      return;
    }
  } else {
    pub.build = 'skipped';
  }

  // 2) 暂存 + 提交（无变更则跳过）
  try {
    await git(['add', 'data/', 'static/images/']);
    const status = (await git(['status', '--porcelain'])).trim();
    if (!status) {
      pub.commit = 'skipped（无文件变更）';
      console.log('[发布] 工作区无数据变更，跳过提交与推送');
      report.publish = pub;
      return;
    }
    const msg = created.length
      ? `feat: 同步 TMDB 今日热门 ${created.length} 条（${idRange(created)}）`
      : 'chore: 发布待提交的站点数据更新';
    await git(['commit', '-m', msg]);
    const hash = (await git(['rev-parse', '--short', 'HEAD'])).trim();
    pub.commit = `${hash}  ${msg}`;
    console.log(`[发布] 已提交 ${hash}：${msg}`);
  } catch (e) {
    pub.commit = `失败：${String(e.message).slice(0, 200)}`;
    console.log(`[发布] ✗ 提交失败：${pub.commit}`);
    report.publish = pub;
    return;
  }

  // 3) 推送
  if (NO_PUSH) {
    pub.push = 'skipped（--no-push）';
  } else {
    try {
      const out = await git(['push', 'origin', 'main']);
      pub.push = (out.match(/main\s*->\s*main/) || ['已推送'])[0];
      console.log(`[发布] ✓ 已推送 GitHub：${pub.push}`);
    } catch (e) {
      pub.push = `失败：${String(e.message).slice(0, 200)}`;
      console.log(`[发布] ✗ 推送失败（本地提交已保留，可稍后手动 git push）：${pub.push}`);
    }
  }
  report.publish = pub;
}

// ---------- 本地时区日期工具 ----------
// 站点排序键是 added（scripts/lib/data.js），只写日期会被折叠成当天 00:00，
// 排在带时分的条目之后；且 toISOString() 是 UTC，凌晨跑会把日期算成前一天。
const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localStamp = (d = new Date()) => `${localDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ---------- 年份窗口（2026-11-10 用户定夺）----------
// 只收「上映/首播落在近 N 个月内」的今日热门条目。TMDB trending/day 是今天热度榜，
// 经典老片与新剧新季都能靠话题重新上榜（肥伦今夜秀 2014 首播、Re:ゼロ 2016 首播都进过当日榜），
// 旧口径不看年份，于是站内一直在收老内容。现在按内容日期设窗口：
//   · 电影（含热门电影榜里归入动漫的动画电影）→ release_date
//   · 剧集（含热门剧集榜里归入动漫的动画剧集）→ 目标季 air_date，缺失才回落整剧 first_air_date
// 用「目标季首播日」而不是整剧首播日，是为了让「跨年老剧出新一季」仍能收进来。
// --recency-months N 改窗口；--no-recency 彻底关掉，回到「只看今天热不热」的旧口径。
const RECENCY_RAW = parseInt(arg('recency-months', '12'), 10);
// 非法值（0 / 负数 / 非数字）一律退回 12，避免打印的窗口月数与实际算出的日期不一致
const RECENCY_MONTHS = Number.isInteger(RECENCY_RAW) && RECENCY_RAW > 0 ? RECENCY_RAW : 12;
const NO_RECENCY = has('no-recency');
const WINDOW_FROM = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - RECENCY_MONTHS);
  return localDate(d);
})();
/** 内容日期是否落在窗口内；日期缺失或不在窗口都算 false（宁可少收，不猜年份） */
const inWindow = (dateStr) => !!dateStr && String(dateStr) >= WINDOW_FROM;
const windowText = NO_RECENCY ? '已关闭（--no-recency，任何年份的今日热门都可入库）' : `只收近 ${RECENCY_MONTHS} 个月内上映/首播的条目（${WINDOW_FROM} 之后）`;

// ---------- 主流程 ----------
const report = { ran_at: new Date().toISOString(), dry_run: DRY, created: [], skipped: [], errors: [] };
// 年份窗口口径也进机读报告，供简报与后续任务核对（2026-11-10 起）
report.recency = { enabled: !NO_RECENCY, months: NO_RECENCY ? null : RECENCY_MONTHS, from: NO_RECENCY ? null : WINDOW_FROM };
// 节目类黑名单口径同样进机读报告，供简报与后续任务核对（2026-11-11 起）
report.program_filter = { enabled: !ALLOW_PROGRAM, genres: [...PROGRAM_GENRES], label: PROGRAM_LABEL };

if (!PUBLISH_ONLY) {
const state = loadState();
state.seen = state.seen || {};
console.log(`[年份窗口] ${windowText}`);

// SHARE 下分类目录 fid
const shareDirs = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
const dirFid = (name) => shareDirs.find((d) => d.filename === name)?.fid;

async function processType(kind) {
  const cat = CATS[kind];
  const seenSet = new Set(state.seen[kind] ? Object.keys(state.seen[kind]) : []);
  // 三个分类的标题全量交叉比对：同一部作品只允许落在一个分类里
  // （2026-10-23 起对电影 / 电视剧也生效：动漫收走的动画电影，不该再被电影分类收一遍）
  const titles = new Set();
  for (const f of ['movie.yaml', 'tv.yaml', 'anime.yaml']) for (const t of siteTitles(f)) titles.add(t);

  // 候选池：电影 / 电视剧取各自榜单；动漫 = 热门电影榜的动画优先，其次热门剧集榜的动画
  const srcTypes = kind === 'anime' ? cat.sources : [cat.tmdbType];
  const pool = [];
  for (const src of srcTypes) {
    const tr = await tmdb(`/trending/${src}/day?language=zh-CN`);
    for (const r of tr.results || []) {
      pool.push({
        type: src, // 该候选项属于 movie 还是 tv（详情接口与季集标注都要用）
        tmdb_id: String(r.id),
        zh: r.title || r.name || '',
        original: r.original_title || r.original_name || '',
        date: r.release_date || r.first_air_date || '',
        vote: r.vote_average || 0,
        votes: r.vote_count || 0,
        overview: r.overview || '',
        poster_path: r.poster_path || '',
        genres: r.genre_ids || [],
      });
    }
  }

  const limit = kind === 'movie' ? N_MOVIE : kind === 'tv' ? N_TV : N_ANIME;
  // 动漫的 seen 键带类型前缀（movie / tv 的 TMDB id 是两套命名空间，可能撞号）
  const seenKeyOf = (it) => (kind === 'anime' ? `${it.type}:${it.tmdb_id}` : it.tmdb_id);

  const picked = [];
  const tooOld = []; // 被年份窗口挡掉的候选，循环后汇总进 report.skipped
  const programs = []; // 被节目类黑名单挡掉的候选（脱口秀 / 真人秀 / 新闻），同上
  for (const it of pool) {
    if (picked.length >= limit) break;
    const isAnime = it.genres.includes(16);
    if (kind === 'anime' && !isAnime) continue; // 动漫：只收动画（genre 16）
    // 节目类黑名单（2026-11-11）：脱口秀 / 真人秀 / 新闻不入库，顺延取下一条
    if (!ALLOW_PROGRAM && kind !== 'anime' && it.genres.some((g) => PROGRAM_GENRES.has(g))) {
      programs.push({ title: seasonAwareTitle(it) || it.original || it.tmdb_id });
      continue;
    }
    const seenKey = seenKeyOf(it);
    if (seenSet.has(seenKey)) { report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: it.zh, reason: '已同步过' }); continue; }
    if (seenSet.has(String(it.tmdb_id))) { report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: it.zh, reason: '已同步过（历史整剧键）' }); continue; }

    // 剧集类：先解析目标季，拿「片名 + 第N季」参与去重与后续命名（2026-10-25 按季去重）
    if (it.type === 'tv') {
      const s = await latestSeasonOf(it.tmdb_id);
      it.season_air_date = s.air_date || ''; // 目标季首播日，年份窗口按它判（缺失回落整剧首播日）
      if (s.season != null) {
        it.season = s.season;
        it.seenKey = `${it.tmdb_id}:S${s.season}`;
        if (seenSet.has(it.seenKey)) { report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: `${it.zh} 第${cnNum(s.season)}季`, reason: '该季已同步过' }); continue; }
      }
    }
    const cmpTitle = seasonAwareTitle(it);
    if (titles.has(normTitle(cmpTitle)) || titles.has(normTitle(it.original))) {
      report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: cmpTitle, reason: '站内已有' });
      state.seen[kind] = state.seen[kind] || {};
      state.seen[kind][it.seenKey || seenKey] = { title: cmpTitle, id: null, skipped: '站内已有', at: report.ran_at };
      continue;
    }
    if (!NO_FILTER_ANIME && kind === 'tv' && isAnime) {
      report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: it.zh, reason: '动画（genre 16，归入动漫分类）' });
      continue;
    }
    if (!ALLOW_ORIGINAL && !hasCJK(it.zh)) {
      report.skipped.push({ kind, tmdb_id: it.tmdb_id, title: it.zh || it.original, reason: '无中文译名' });
      state.seen[kind] = state.seen[kind] || {};
      state.seen[kind][seenKey] = { title: it.zh, id: null, skipped: '无中文译名', at: report.ran_at };
      continue;
    }
    // 年份窗口（2026-11-10 用户定夺）：上映/首播不在近 RECENCY_MONTHS 个月内的，跳过并顺延取下一条。
    // 剧集类先看目标季首播日（老剧出新一季仍能收），拿不到才回落整剧首播日。
    // 这类跳过**不写 seen 状态**：榜单每天在变，窗口口径以后也可能调，不把它永久钉死在已处理清单里。
    if (!NO_RECENCY) {
      const cd = it.type === 'tv' ? it.season_air_date || it.date : it.date;
      if (!inWindow(cd)) { tooOld.push({ title: seasonAwareTitle(it), date: cd || '日期缺失' }); continue; }
    }
    // 简介不足 150 字不再跳过（2026-10-23 用户定夺：短板要补，不是丢掉条目；2026-11-12 下限从 200 下调到 150）。
    // 入库时用 TMDB detail 的真实字段（标语 / 类型 / 年代 / 产地 / 导演 / 主演 / 出品…）扩写到 150 字以上，
    // 见 lib/desc.mjs 的 buildBody，口径与 check-desc.mjs 一致。
    picked.push(it);
  }

  // 年份窗口挡掉的候选：逐条最多列 5 条，剩下的并成一行，避免卡片被「今天榜上的老片」刷屏。
  // reason 前缀固定「年份窗口外」，与飞书简报脚本 BENIGN 白名单里的同一词，卡片按「↷ 正常顺延」渲染。
  if (tooOld.length) {
    const shown = tooOld.slice(0, 5);
    for (const t of shown) report.skipped.push({ kind, title: t.title, reason: `年份窗口外（上映/首播 ${t.date}）` });
    if (tooOld.length > shown.length)
      report.skipped.push({ kind, title: `另有 ${tooOld.length - shown.length} 条今日热门`, reason: `年份窗口外（窗口 ${WINDOW_FROM} 起）` });
    console.log(`  ↷ 年份窗口挡掉 ${tooOld.length} 条（窗口 ${WINDOW_FROM} 起，近 ${RECENCY_MONTHS} 个月）`);
  }

  // 节目类挡掉的候选：与年份窗口同一套列法（逐条最多 5 条，其余合并），reason 前缀固定「节目类（」，
  // 飞书简报脚本 BENIGN 白名单同词，卡片按「↷ 正常顺延」渲染，不算异常。
  if (programs.length) {
    const shown = programs.slice(0, 5);
    for (const t of shown) report.skipped.push({ kind, title: t.title, reason: `节目类（${PROGRAM_LABEL}）` });
    if (programs.length > shown.length)
      report.skipped.push({ kind, title: `另有 ${programs.length - shown.length} 条今日热门`, reason: `节目类（${PROGRAM_LABEL}）` });
    console.log(`  ↷【${cat.label}】节目类挡掉 ${programs.length} 条（${PROGRAM_LABEL}，--allow-program 可放开）`);
  }

  if (!picked.length) { console.log(`【${cat.label}】无可用新条目`); return; }
  if (DRY) {
    console.log(`【${cat.label}】dry-run 命中 ${picked.length} 条：`);
    picked.forEach((p) => console.log(`  · ${p.zh}（TMDB ${p.tmdb_id}｜${p.date}｜★${p.vote}）`));
    report.created.push(...picked.map((p) => ({ kind, ...p, dry: true })));
    return;
  }

  // 实时取可用编号：夸克目录为唯一权威，先填网盘空洞（001..max 之间没有目录的编号），填完才顺延
  const fid = dirFid(cat.dir);
  if (!fid) throw new Error(`找不到网盘分类目录：${cat.dir}`);
  const items = (await browse(fid)).filter((o) => String(o.file_type) === '0');
  const used = usedSet(items.map((o) => o.filename));
  const maxNum = used.size ? Math.max(...used) : 0;
  const existing = new Set(items.map((o) => normTitle(o.filename)));
  const OCC = idOccupancy(path.join(REPO, 'data'));
  const holes = classifyHoles(used, maxNum, { prefix: cat.prefix, file: cat.file, occupancy: OCC });
  const alloc = createAllocator(used, maxNum, { blocked: new Set(holes.blocked) });
  if (holes.blocked.length)
    console.log(`  ⚠ 空洞 ${holes.blocked.map(pad3).join(' ')} 的 ${cat.prefix}- id 已被别的分类文件占用，本轮跳过不用`);

  console.log(
    `【${cat.label}】待建 ${picked.length} 条，当前最大编号 ${maxNum}，可补位空洞 ${holes.free.length + holes.reclaim.length} 处` +
      (holes.reclaim.length ? `（其中 ${holes.reclaim.length} 处站点留有旧死链条目 → 就地改写：${holes.reclaim.map(pad3).join(' ')}）` : '')
  );

  for (const it of picked) {
    const rec = { kind, tmdb_id: it.tmdb_id, title: seasonAwareTitle(it), original: it.original, date: it.date, vote: it.vote };
    let numVal = null; // 本轮分配到的编号（数值），失败时还回池子；num 是它的三位补零写法
    let num = null;
    try {
      const base = it.zh || it.original;
      const title = it.type === 'tv' && it.season ? `${base} 第${cnNum(it.season)}季` : base;
      if (existing.has(normTitle(title))) { rec.error = '网盘已有同名目录'; report.skipped.push({ ...rec, reason: '网盘已有同名目录' }); continue; }
      numVal = alloc.next();
      num = pad3(numVal);
      const id = `${cat.prefix}-${num}`;
      const dirname = `${num}-${cleanName(title)}`;
      rec.id = id; rec.dirname = dirname;
      rec.number_kind = holes.reclaim.includes(numVal) ? 'reclaim' : holes.free.includes(numVal) ? 'hole' : 'append';
      if (rec.number_kind === 'reclaim') rec.reclaim_note = `补位编号 ${num}：站点 ${cat.file} 里同 id 旧条目（死链）将被就地改写`;

      // 1) 建目录
      const cr = JSON.parse(await q(['create-folder', '--dir-path', dirname, '--parent-fid', fid]));
      if (cr.code !== 0) throw new Error(`建目录失败：${cr.msg}`);
      const newFid = cr.data.fid;
      rec.fid = newFid;

      // 1a) 镜像到百度网盘：**2026-11-08 起默认停用**，只有人工显式 --baidu 才执行，停用时 rec.baidu=null（不打印、不计失败）
      //     启用时逻辑不变：若百度已存在同资源的未编号目录（用户手动转存过），原地改名对齐；否则建目录+占位。
      //     候选原名 = 本季标题 / 无季号基名 / TMDB 中文名 / 原语言名（逐字命中才改名，失败不阻断，结果记在 rec.baidu）
      rec.baidu = BAIDU_MIRROR ? await baiduMirrorDir(cat.dir, dirname, [title, base, it.zh, it.original]) : null;
      if (BAIDU_MIRROR) {
        if (String(rec.baidu).startsWith('ok')) console.log(`  ✓ ${id} 百度镜像 ${BAIDU.root}/${cat.dir}/${dirname}`);
        else console.log(`  ! ${id} 百度镜像：${rec.baidu}`);
      }

      // 1b) 百度出链（2026-11-04 起）：镜像成功的目录当场出分享链接并随条目入库（失败不阻断）。
      //     优先永久（-d 0），被拒自适应降级 30/7 天；百度侧无目录（镜像失败/跳过）则不出链。
      rec.baidu_url = null;
      rec.baidu_pwd = null;
      if (BAIDU.on && String(rec.baidu).startsWith('ok')) {
        const bs = await bdShare(BAIDU.bin, `${BAIDU.root}/${cat.dir}/${dirname}`, { period: 0 });
        if (bs.ok) {
          rec.baidu_url = bs.link;
          rec.baidu_pwd = bs.pwd;
          console.log(`  ✓ ${id} 百度出链 ${bs.link}${bs.pwd ? ` 提取码 ${bs.pwd}` : ''}（${bs.period === 0 ? '永久' : `${bs.period} 天`}）`);
        } else {
          rec.baidu_share = `失败：${bs.err}`;
          console.log(`  ! ${id} 百度出链：${rec.baidu_share}`);
        }
        await sleep(900); // 轻限速，防百度风控
      }

      // 1.5) 预置占位说明文件（此刻还没有资源；失败不阻断，链接照出）
      // 2026-11-08 起两份：更新通知 + QQ 群缺失反馈，逐份上传
      if (!NO_PLACEHOLDER) {
        const bad = [];
        for (const ph of PLACEHOLDERS) {
          const mdPath = path.join(TMP, ph.name);
          try {
            fs.writeFileSync(mdPath, ph.text, 'utf8');
            const up = await q(['upload', mdPath, '--parent-fid', newFid]);
            const last = up
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.startsWith('{'))
              .map((l) => {
                try { return JSON.parse(l); } catch { return null; }
              })
              .filter(Boolean)
              .pop();
            if (!(last && last.code === 0)) bad.push(`${ph.name}：${last?.msg || '未知错误'}`);
          } catch (e) {
            bad.push(`${ph.name}：${String(e.message).slice(0, 100)}`);
          } finally {
            try { fs.rmSync(mdPath, { force: true }); } catch {}
          }
          await sleep(300);
        }
        if (bad.length) {
          rec.placeholder = `失败：${bad.join(' / ').slice(0, 150)}`;
          console.log(`  ! ${id} 占位文件上传失败：${rec.placeholder}`);
        } else {
          rec.placeholder = PLACEHOLDERS.map((p) => p.name).join(' + ');
        }
      }

      // 2) 出链（公开 · 永久 · 无提取码）
      await sleep(1200);
      const sh = JSON.parse(await q(['share', newFid, '--title', dirname, '--url-type', '1', '--expired-type', '1']));
      if (sh.code !== 0) throw new Error(`出链失败：${sh.msg}`);
      rec.quark_url = sh.data.share_url;

      // 3) 详情 + 海报
      await sleep(600);
      const d = await tmdb(`/${it.type}/${it.tmdb_id}?language=zh-CN&append_to_response=credits`);
      const overview = String(d.overview || it.overview || '').replace(/\s+/g, ' ').trim();
      const vote = Number(d.vote_average ?? it.vote ?? 0);
      const genres = (d.genres || []).map((g) => g.name);
      const date = d.release_date || d.first_air_date || it.date;
      rec.genres = genres; rec.date = date; rec.vote = vote;

      // 3b) 剧集类（电视剧 / 来自剧集榜的动漫）：查最新一季的季号与集数，写进资源说明
      let seasonTag = '';
      if (it.type === 'tv') {
        // 目标季在去重阶段已解析过（it.season），这里只补集数并复用，不再重复选季逻辑
        const pickedSeason = it.season != null ? { season: it.season, episodes: 0 } : pickSeason(d);
        const seasonNo = pickedSeason.season;
        let epCount = pickedSeason.episodes;
        if (seasonNo != null) {
          // 季详情的实际集数更准；这里取该季总集数（在播剧也按整季算，资源目录最终就是整季）
          const sd = await tmdb(`/tv/${it.tmdb_id}/season/${seasonNo}?language=zh-CN`).catch(() => null);
          if (sd && Array.isArray(sd.episodes) && sd.episodes.length) epCount = sd.episodes.length;
        }
        rec.season = seasonNo;
        rec.episodes = epCount || d.number_of_episodes || 0;
        rec.total_seasons = d.number_of_seasons || 0;
        if (seasonNo != null && epCount) {
          seasonTag = `【第 ${seasonNo} 季 · 共 ${epCount} 集${
            (d.number_of_seasons || 0) > 1 ? ` · 全剧 ${d.number_of_seasons} 季` : ''
          }】`;
        } else if (d.number_of_episodes) {
          seasonTag = `【共 ${d.number_of_episodes} 集】`;
        }
      }

      let image = '';
      const poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null;
      if (poster) {
        const dest = path.join(posterDir(REPO, id), `${id}.jpg`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        for (const useProxy of [true, false]) {
          await run('curl', ['-s', '--max-time', '60', ...(useProxy && PROXY ? ['-x', PROXY] : []), '-o', dest, poster]).catch(() => {});
          if (isJpegFile(dest)) { image = `${id}.jpg`; break; }
        }
        if (!image && fs.existsSync(dest)) fs.unlinkSync(dest);
      }
      rec.image = image;

      // 4) 生成 YAML 片段：正文用 buildBody 补到 ≥150 字（写入上限 700 字，站点构建护栏 data.js 的 MAX_DESC 仍留 1200）
      const built = buildBody({ overview, d, type: it.type, title, original: it.original });
      rec.desc_raw_len = built.rawLen;
      rec.desc_len = built.len;
      rec.desc_filled = built.filled;
      if (built.len < DESC_MIN) console.log(`  ! ${id} 简介仅 ${built.len} 字（补料已用尽）`);
      const desc = `${seasonTag}${built.body}｜TMDB ${vote.toFixed(1)}`;
      const payload = {
        id,
        title,
        category: cat.key,
        tags: [cat.key, ...genres.slice(0, 3), it.original ? `${title} ${it.original}` : title].filter(Boolean),
        quark_url: rec.quark_url,
        description: desc || `${title}｜TMDB ${vote.toFixed(1)}`,
        date: date || localDate(),
        // 带入库时刻的本地时间，保证当天最新入库的排在最前
        added: localStamp(),
        image,
        ...(rec.baidu_url ? { baidu_url: rec.baidu_url, ...(rec.baidu_pwd ? { baidu_pwd: rec.baidu_pwd } : {}) } : {}),
      };
      const yamlBlock = await run(process.execPath, [MAKE, '--data', JSON.stringify(payload)]);
      rec.yaml = yamlBlock.trim();
      rec.status = 'ok';
      console.log(`  ✓ ${id} ${title} → ${rec.quark_url}`);

      state.seen[kind] = state.seen[kind] || {};
      // 剧集类按「<tmdb_id>:S<季号>」记账，同一部剧今后出新季还能被收；电影仍用裸 id
      state.seen[kind][it.seenKey || seenKeyOf(it)] = { title, id, dirname, url: rec.quark_url, at: report.ran_at, season: it.season ?? null };
      report.created.push(rec);
    } catch (e) {
      rec.error = String(e.message).slice(0, 200);
      report.errors.push(rec);
      console.log(`  ✗ ${rec.title || it.tmdb_id} ${rec.error}`);
      if (numVal) alloc.release(numVal); // 还回编号池子，下一条重新取，不跳号
    }
  }

  // 5) 写入 data/<分类>.yaml：同 id 已有条目（补位回收来的死链旧条目）→ 就地改写；没有 → 追加
  const ok = report.created.filter((r) => r.kind === kind && r.yaml);
  if (ok.length) {
    const target = path.join(REPO, 'data', cat.file);
    let replaced = 0, appended = 0;
    for (const r of ok) {
      try {
        const res = upsertEntry(target, r.id, r.yaml);
        r.yaml_mode = res.mode;
        if (res.mode === 'replaced') {
          replaced++;
          console.log(`  ↻ ${r.id} 已就地改写站点旧条目（补位回收：网盘目录已不在，原死链由新资源顶替，详情页地址与 id 不变）`);
        } else appended++;
      } catch (e) {
        r.yaml_mode = 'failed';
        r.error = `写 YAML 失败：${String(e.message).slice(0, 160)}`;
        report.errors.push(r);
        console.log(`  ✗ ${r.id} ${r.error}`);
      }
    }
    const written = replaced + appended;
    console.log(`  → 已写入 ${written}/${ok.length} 条到 data/${cat.file}（追加 ${appended} / 就地改写 ${replaced}）`);
  }
}

for (const kind of ['movie', 'tv', 'anime']) {
  try { await processType(kind); } catch (e) { report.errors.push({ kind, error: String(e.message).slice(0, 200) }); console.log(`【${kind}】失败：${e.message}`); }
}

if (!DRY) saveState(state);
} // end if (!PUBLISH_ONLY)

console.log('\n===== 汇总 =====');
console.log(`新建并入库：${report.created.filter((r) => r.status === 'ok').length} 条`);
report.created.filter((r) => r.status === 'ok').forEach((r) => console.log(`  ${r.id}  ${r.title}  ${r.quark_url}`));
if (report.errors.length) console.log(`失败：${report.errors.length} 条 → 见报告`);
console.log(`跳过：${report.skipped.length} 条`);
// 年份窗口小结（2026-11-10 起）：让无人值守的简报一眼看出老片是被窗口挡掉的，不是异常
{
  const n = report.skipped.filter((s) => String(s.reason || '').startsWith('年份窗口外')).length;
  if (NO_RECENCY) console.log('年份窗口：已关闭（--no-recency），今日热门不看年份');
  else console.log(`年份窗口：${WINDOW_FROM} 之后上映/首播才算（近 ${RECENCY_MONTHS} 个月），本轮挡掉 ${n} 行（含合并计数）`);
}
// 百度镜像小结
{
  const okAll = report.created.filter((r) => r.status === 'ok' && String(r.baidu).startsWith('ok'));
  const bad = report.created.filter((r) => r.status === 'ok' && r.baidu && !String(r.baidu).startsWith('ok'));
  if (!BAIDU_MIRROR) console.log('百度镜像：已停用（2026-11-08 起默认不再镜像百度盘；属预期，不是异常，无需人工跟进）');
  else if (!BAIDU.on) console.log(`百度镜像：未执行（${BAIDU.note}）`);
  else if (!okAll.length && !bad.length) console.log('百度镜像：本轮无新增，无镜像动作');
  else {
    console.log(`百度镜像：${okAll.length} 条同名目录已建`);
    bad.forEach((r) => console.log(`  ! ${r.id} 百度镜像 ${r.baidu}`));
  }
  report.baidu = { enabled: BAIDU.on, note: BAIDU.note || null, ok: okAll.length, failed: bad.map((r) => ({ id: r.id, baidu: r.baidu })) };
  // 百度出链小结（2026-11-04 起：镜像成功的目录当场出分享链接写入条目；失败不阻断）
  const shOk = report.created.filter((r) => r.status === 'ok' && r.baidu_url);
  const shBad = report.created.filter((r) => r.status === 'ok' && r.baidu_share);
  if (BAIDU.on && report.created.some((r) => r.status === 'ok')) {
    console.log(`百度出链：${shOk.length} 条分享链接已写入条目`);
    shBad.forEach((r) => console.log(`  ! ${r.id} 百度出链 ${r.baidu_share}`));
  }
  report.baidu_share = { enabled: BAIDU.on, ok: shOk.length, failed: shBad.map((r) => ({ id: r.id, err: r.baidu_share })) };
}

// 入库完成 → 构建 → 提交 → 推送 GitHub
await publish(report);

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(`报告：${REPORT}`);
