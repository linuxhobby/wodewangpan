// 连载资源（电视剧 / 动漫）的自动轮询：候选口径、轮换选条、快照比对、写盘。
//
// 判定信号只有一个：盘端目录还在不在变。变了才重写 files 块并写当天 updated，
// 没变一个字都不写——所以「哪些还没更新完」不需要任何人去记，也不需要额外标记字段。
// 静止满 IDLE_DAYS 天降为低频复查（不再每轮轮询），但永不宣称完结：老剧后来又补内容也能被发现。
//
// 这里是口径的唯一实现，fill-files（写）与 list-ongoing（读）都从这里取，别另写一份。
import fs from 'node:fs';

/** 只轮询这两个分类：影视剧是文件类里唯一会持续追加内容的资源 */
export const SERIAL_FILES = ['tv.yaml', 'anime.yaml'];
/** 距最近一次真实内容变化满多少天算「已定格」，降入低频复查池 */
export const IDLE_DAYS = 60;
/** 轮换时间片：与 fill-files 的例行节奏一致，每 2 小时推进一格 */
const SLOT_MS = 2 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
/** 每 N 轮里抽 1 轮复查已定格条目，防止老剧后来补了内容却永远没人发现 */
const SETTLED_EVERY = 10;

const unquote = (s) => String(s ?? '').trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
const norm = (v) => String(v ?? '').trim();

/** 逐行保留原行尾：data/*.yaml 是混排文件，统一行尾会让整文件进 diff */
export function splitLines(raw) {
  const parts = raw.split(/(\r\n|\r|\n)/);
  const lines = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(i + 1 < parts.length ? parts[i] + parts[i + 1] : parts[i]);
  }
  return lines;
}

/** 解析单个 data 文件，返回「已有 files: 块且带夸克链接」的条目及其行号定位 */
export function parseSerialFile(file, raw = fs.readFileSync(file, 'utf8')) {
  const lines = splitLines(raw);
  const starts = [];
  lines.forEach((l, i) => {
    if (/^- /.test(l)) starts.push(i);
  });
  starts.push(lines.length);
  const items = [];
  for (let s = 0; s < starts.length - 1; s++) {
    const from = starts[s];
    const to = starts[s + 1];
    const text = lines.slice(from, to).join('\n');
    const id = (text.match(/^- id:\s*(\S+)/m) || [])[1] || '';
    if (!id) continue;
    const quarkUrl = unquote((text.match(/^  quark_url:\s*"?(.*?)"?\s*$/m) || [])[1]);
    if (!quarkUrl) continue;

    let filesFrom = -1;
    for (let i = from; i < to; i++) {
      if (/^  files:/.test(lines[i])) { filesFrom = i; break; }
    }
    if (filesFrom < 0) continue;
    // files 块止于下一个顶层字段（两空格）或下一条目；尾部空行留在块外，删块时不动它们。
    let last = filesFrom;
    let filesEnd = to;
    for (let i = filesFrom + 1; i < to; i++) {
      if (/^  \S/.test(lines[i]) || /^- /.test(lines[i])) { filesEnd = i; break; }
      if (lines[i].trim()) last = i;
    }
    filesEnd = Math.min(filesEnd, last + 1);

    items.push({
      id,
      file,
      lines,
      from,
      to,
      title: unquote((text.match(/^  title:\s*(.*)$/m) || [])[1]),
      quarkUrl,
      added: unquote((text.match(/^  added:\s*"?([^"\n]*)"?/m) || [])[1]),
      updated: unquote((text.match(/^  updated:\s*"?([^"\n]*)"?/m) || [])[1]),
      dead: /^  dead:\s*true/m.test(text),
      filesFrom,
      filesEnd,
    });
  }
  return items;
}

/** 最近一次真实内容变化日 → 活跃 / 已定格；updated 优先，没有则退回入库日 */
export function itemState(item, today) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(item.updated || item.added || '');
  if (!m) return { kind: 'active', days: 0 };
  const days = Math.max(
    0,
    Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m[1]}T00:00:00Z`)) / DAY_MS)
  );
  return { kind: days >= IDLE_DAYS ? 'settled' : 'active', days };
}

/**
 * 无状态轮换：每 2 小时按时间片从活跃池取 n 条，每 SETTLED_EVERY 轮抽一次已定格池。
 * 不写任何游标文件，重复执行同一轮永远选到同一批（幂等），也不会和并行任务抢状态。
 */
export function pickSerials(items, now, n, today) {
  const usable = items.filter((x) => !x.dead);
  const active = [];
  const settled = [];
  for (const it of usable) {
    (itemState(it, today).kind === 'active' ? active : settled).push(it);
  }
  const slot = Math.floor(now / SLOT_MS);
  const revisit = slot % SETTLED_EVERY === 0 && settled.length > 0;
  const pool = revisit ? settled : (active.length ? active : settled);
  if (!pool.length) return [];
  const out = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    out.push(pool[(slot + i) % pool.length]);
  }
  return out;
}

const SIG_KEYS = ['count', 'size', 'format', 'packed', 'tree'];

/** 新抓到的聚合结果 → 可比签名 */
export function signatureOf(agg) {
  const o = {};
  for (const k of SIG_KEYS) o[k] = norm(agg[k]);
  return JSON.stringify(o);
}

/** 条目里已有 files: 块 → 同口径签名（只比真实规格字段，忽略行尾与无关字段） */
export function signatureFromLines(lines, from, to) {
  const o = {};
  for (const k of SIG_KEYS) o[k] = '';
  const tree = [];
  let inTree = false;
  for (let i = from; i < to; i++) {
    const line = lines[i].replace(/\r?\n$/, '');
    if (/^    tree:\s*\|/.test(line)) { inTree = true; continue; }
    if (inTree && /^      /.test(line)) { tree.push(line.slice(6)); continue; }
    inTree = false;
    const m = /^    ([a-z]+):\s*(.*)$/.exec(line);
    if (m && Object.prototype.hasOwnProperty.call(o, m[1])) o[m[1]] = norm(unquote(m[2]));
  }
  o.tree = tree.join('\n').trim();
  return JSON.stringify(o);
}

/**
 * 用新快照整体替换某个条目的 files: 块：删旧块与旧 updated，在条目末尾追加
 * updated + 新 files。逐行沿用原行尾，未动过的行不进 diff。
 * makeSnippet() 由调用方提供（复用 fill-files 的 toYamlLines，避免两份 YAML 生成逻辑）。
 */
export function rewriteSerialFiles(file, id, makeSnippet) {
  const items = parseSerialFile(file);
  const it = items.find((x) => x.id === id);
  if (!it || it.filesFrom < 0) return false;

  const kept = [];
  for (let i = 0; i < it.lines.length; i++) {
    const inItem = i >= it.from && i < it.to;
    if (inItem && i >= it.filesFrom && i < it.filesEnd) continue;
    if (inItem && /^  updated:/.test(it.lines[i])) continue;
    kept.push(it.lines[i]);
  }
  let end = kept.length;
  for (let i = it.from + 1; i < kept.length; i++) {
    if (/^- /.test(kept[i])) { end = i; break; }
  }
  let at = end - 1;
  while (at > it.from && !kept[at].trim()) at--;

  const nl = /\r\n$/.test(kept[at]) ? '\r\n' : '\n';
  kept.splice(at + 1, 0, ...makeSnippet().map((l) => l + nl));
  fs.writeFileSync(file, kept.join(''));
  return true;
}
