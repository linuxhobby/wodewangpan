#!/usr/bin/env node
/**
 * prune-cache.mjs — 清理 ~/.cache/quark-sync/ 里的过期缓存（默认保留 7 天）
 *
 * 这个目录是同步流水线的工作目录，四类内容：
 *   ① 状态锚点  trending-seen / trending-last / fill-files-notready …  → 永不删
 *   ② 任务交接件 llm-pending / llm-apply / llm-drafts / *-card / scan-*.json → 可删
 *   ③ 传输缓冲  quark-tasks/（夸克 CLI 的 api.jsonl + browse/*.jsonl）→ 可删
 *   ④ 临时残留  poster-tmp/*.img、llm-poster-*.img、check-*.png 等 → 可删
 *
 * 用法：
 *   node tools/quark-cron/prune-cache.mjs            # dry-run，只报告不删（默认）
 *   node tools/quark-cron/prune-cache.mjs --apply     # 真删
 *   node tools/quark-cron/prune-cache.mjs --days 3    # 自定义保留天数
 *   node tools/quark-cron/prune-cache.mjs --apply --keep-pending
 *
 * 安全约束：
 *   - 状态锚点走白名单，永远不删（删了会重复收录 / 重复跑）。
 *   - llm-pending-*.json 只有在「该批条目已全部入库」时才可删。
 *     llm-prepare 生成 pending 时已经改过盘端目录名（加了编号前缀），
 *     所以一旦 pending 被删、条目又没入库，那条资源就再也不会被 scan-new 发现 —— 永久丢失。
 *   - 删除失败不中断（工具层有「批量删除」守卫，单轮累计删太多会抛
 *     SAFE_DELETE_BULK_CONFIRM_REQUIRED），单个文件删不掉就跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = process.env.WDP_CACHE_DIR || process.env.QK_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'quark-sync');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const APPLY = has('--apply');
// 注意：不能用 `Number(x) || 7`，那样 --days 0 会被当成 falsy 变回 7。
const DAYS = (() => {
  const raw = val('--days', null);
  const n = raw === null ? 7 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 7;
})();
const KEEP_PENDING = has('--keep-pending');
const CUTOFF = Date.now() - DAYS * 86400 * 1000;

/** 状态锚点：永不删。误删会导致重复收录或重复跑。 */
const PROTECTED = new Set([
  'trending-seen.json',      // 已收录 TMDB id 台账
  'trending-last.json',      // 上轮成功时间锚（90 分钟幂等）
  'fill-files-notready.json',// 已确认空目录的 id（6h TTL）
  'guangya-sync-last.json',  // 光鸭补链进度
  'guangya-mirror-last.json',// 光鸭镜像进度
  'guangya-renumber-last.json',
  'reshare-last.json',
  'baidu-share-links-last.json',
  'remove-resource-last.json',
  'placeholder-fill-last.json',
  'check-share-links-last.json',
]);

/** 子目录级白名单：这些目录整目录跳过，不递归删里面的东西。 */
const PROTECTED_DIRS = new Set([
  'rename-records', // 盘端改名的操作记录，出问题时要回查
]);

/** 可删的文件名前缀/后缀匹配（任务交接件 + 临时残留）。 */
const PRUNABLE_PATTERNS = [
  /^llm-pending-.*\.json$/,
  /^llm-apply-.*\.json$/,
  /^llm-drafts-.*\.json$/,
  /^llm-followup-.*\.json$/,
  /^resource-sync-card-.*\.json$/,
  /^share-update-card-.*\.json$/,
  /^share-manual-.*\.json$/,
  /^prestore-move-.*\.md$/,
  /^manual-move-.*\.json$/,
  /^plan-.*\.json$/,
  /^app-plan\.json$/,
  /^llm-rename-.*\.json$/,
  /^rename-items-.*\.json$/,
  /^scan-(new|after|fresh)\.json$/,
  /^match(-fresh)?\.json$/,
  /^candidates\.json$/,
  /^results\.json$/,
  /^verify\.json$/,
  /^inspect-tree\.json$/,
  /^resource-sync-run-.*\.log$/,
  /^wdp-.*-serve\.log$/,
  /^move-cron\.log$/,
  /^share-cron\.log$/,
  // 临时残留：海报 / 人工核对用的下载图
  /^llm-poster-.*\.img$/,
  /\.img$/,
  /^(check|imgcheck|sgdb|nintendo)-.*\.(png|jpg|jpeg|webp)$/,
  /^sos-capsule\.png$/,
];

const isPrunable = (name) =>
  !PROTECTED.has(name) && PRUNABLE_PATTERNS.some((re) => re.test(name));

const fmtSize = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtAge = (ms) => {
  const d = Math.floor(ms / 86400 / 1000);
  if (d >= 1) return `${d} 天`;
  const h = Math.floor(ms / 3600 / 1000);
  return h >= 1 ? `${h} 小时` : `${Math.floor(ms / 60000)} 分钟`;
};

/**
 * 读出 data/*.yaml 里已收录条目的 id 与标题关键词。
 * 除了 id，还要收集标题：pending 里记的 id 可能是历史撞号前的旧编号
 * （如 llm-pending-202611200516 三本书都记成 bk-023，实际入库编号是 bk-026/027/028），
 * 只按 id 匹配会把「早已入库」误判成「未入库」，导致文件永远删不掉。
 */
function loadIngested() {
  const ids = new Set();
  const titles = [];
  const dataDir = path.join(REPO, 'data');
  if (!fs.existsSync(dataDir)) return { ids, titles };
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.yaml')) continue;
    const txt = fs.readFileSync(path.join(dataDir, f), 'utf8');
    // 前缀长度不固定：an/mv/tv/dc/bk/ot 是 2 字母，app/cs 是 3 字母，game 是 4 字母。
    // 写死 {2,3} 会漏掉全部 game-*，导致已入库的条目被误判成「未入库」。
    for (const m of txt.matchAll(/^\s*-?\s*id:\s*([a-z]+-\d{3})\s*$/gm)) ids.add(m[1]);
    for (const m of txt.matchAll(/^\s*title:\s*"?([^"\n]+)"?\s*$/gm)) titles.push(m[1].trim());
  }
  return { ids, titles };
}

/** 从盘端目录名里抽出可与标题比对的核心词：去掉编号前缀和括号里的作者/副信息。 */
function titleKeywords(dirName) {
  if (!dirName) return [];
  let s = String(dirName).replace(/^\s*\d+\s*[-－—.]?\s*/, ''); // 去编号前缀
  s = s.replace(/[（(\[].*?[）)\]]/g, ' ');                        // 去括号补充
  s = s.replace(/[·・:：,，.。_\-—–]/g, ' ');
  return s.split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2);
}

/**
 * 判断一份 pending 是否「可以安全删除」。
 * 保守起见：条目为空、或任一条目还没入库 → 不删。
 */
function pendingIsSafe(file, ingested) {
  if (KEEP_PENDING) return false;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false; // 解析失败就保留，别赌
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return true; // 空 pending 无信息量
  return items.every((it) => {
    if (!it) return false;
    // 优先按 id 判定
    if (it.id && ingested.ids.has(it.id)) return true;
    // id 对不上（历史撞号 / 顺延编号）时，退而按盘端目录名与站内标题做关键词匹配
    const kws = titleKeywords(it.dir_name || it.old_name || it.title);
    if (!kws.length) return false;
    return kws.some((kw) => ingested.titles.some((t) => t.includes(kw)));
  });
}

function walk(dir, out = [], topLevel = false) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (topLevel && PROTECTED_DIRS.has(e.name)) continue; // 整目录跳过
      walk(p, out, false);
    } else out.push(p);
  }
  return out;
}

if (!fs.existsSync(CACHE)) {
  console.log(`缓存目录不存在，跳过：${CACHE}`);
  process.exit(0);
}

const ingested = loadIngested();
const stats = { kept: 0, keptBytes: 0, deleted: 0, deletedBytes: 0, failed: 0, protected: 0 };
const actions = [];

// 1) 顶层文件
for (const name of fs.readdirSync(CACHE)) {
  const p = path.join(CACHE, name);
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    continue;
  }
  if (st.isDirectory()) continue;
  if (PROTECTED.has(name)) { stats.protected++; stats.kept++; stats.keptBytes += st.size; continue; }
  if (!isPrunable(name)) { stats.kept++; stats.keptBytes += st.size; continue; }
  if (st.mtimeMs >= CUTOFF) { stats.kept++; stats.keptBytes += st.size; continue; }
  if (/^llm-pending-.*\.json$/.test(name) && !pendingIsSafe(p, ingested)) {
    console.log(`  保留 ${name}（条目尚未全部入库，删了会永久丢资源）`);
    stats.kept++; stats.keptBytes += st.size;
    continue;
  }
  actions.push({ path: p, size: st.size, age: Date.now() - st.mtimeMs, name });
}

// 2) 子目录里的传输缓冲与临时残留（quark-tasks/ 的接口日志、poster-tmp/ 的海报中间物…）
//    递归整个缓存目录，逐个文件按同一套规则判定。
for (const f of walk(CACHE, [], true)) {
  const rel = path.relative(CACHE, f);
  if (!rel.includes(path.sep)) continue; // 顶层文件已在上面处理过
  const base = path.basename(f);
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    continue;
  }
  // 子目录里的 llm-pending 也走同一套入库检查
  if (/^llm-pending-.*\.json$/.test(base) && st.mtimeMs < CUTOFF && !pendingIsSafe(f, ingested)) {
    console.log(`  保留 ${rel}（条目尚未全部入库，删了会永久丢资源）`);
    stats.kept++; stats.keptBytes += st.size;
    continue;
  }
  if (st.mtimeMs >= CUTOFF) { stats.kept++; stats.keptBytes += st.size; continue; }
  actions.push({ path: f, size: st.size, age: Date.now() - st.mtimeMs, name: rel });
}

console.log(`缓存目录：${CACHE}`);
console.log(`保留期：${DAYS} 天（早于 ${new Date(CUTOFF).toLocaleString('zh-CN')} 的可删）`);
console.log(`模式：${APPLY ? '实际删除 (--apply)' : '试运行 (dry-run，加 --apply 才真删)'}`);
console.log('');

if (!actions.length) {
  console.log('没有过期文件，无需清理。');
  console.log(`  保留 ${stats.kept} 个文件（${fmtSize(stats.keptBytes)}），其中状态锚点 ${stats.protected} 个`);
  process.exit(0);
}

// 按大小倒序，方便看大头
actions.sort((a, b) => b.size - a.size);
for (const a of actions) {
  console.log(`  ${fmtSize(a.size).padStart(9)}  ${fmtAge(a.age).padStart(6)}  ${a.name}`);
}
console.log('');

if (APPLY) {
  for (const a of actions) {
    try {
      fs.rmSync(a.path, { force: true });
      stats.deleted++;
      stats.deletedBytes += a.size;
    } catch (e) {
      // 工具层的批量删除守卫可能在单轮累计删除过多时抛错，删不掉就跳过
      stats.failed++;
      console.log(`  跳过 ${a.name}：${String(e.message).slice(0, 120)}`);
    }
  }
  // 清掉因删空而剩下的空目录（从深到浅，保证父目录也能被清掉）
  try {
    const dirs = [];
    const collect = (d) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.isDirectory()) {
          const p = path.join(d, e.name);
          collect(p);
          dirs.push(p);
        }
      }
    };
    collect(CACHE);
    for (const d of dirs.reverse()) {
      try {
        if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
      } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  console.log(`已删除 ${stats.deleted} 个文件，释放 ${fmtSize(stats.deletedBytes)}${stats.failed ? `；${stats.failed} 个删不掉已跳过` : ''}`);
} else {
  console.log(`试运行结束：将删除 ${actions.length} 个文件，释放约 ${fmtSize(actions.reduce((s, a) => s + a.size, 0))}`);
}
console.log(`  保留 ${stats.kept} 个文件（${fmtSize(stats.keptBytes)}），其中状态锚点 ${stats.protected} 个未动`);
