/**
 * data/*.yaml 的按行定点补丁。
 *
 * 不用 yaml.dump 整体重写：那会冲掉注释、打乱条数注释与 LF/CRLF 行尾。
 * 这里只在目标条目的行区间里替换/插入/删除指定字段行，其余字节原样保留。
 * 行尾沿用被替换行（或插入锚点行），与 tools/fill-title.mjs 的口径一致。
 */
import { splitLines } from '../../tools/lib/serials.mjs';

const stripEol = (line) => String(line).replace(/\r\n$|\n$|\r$/, '');
const eolOf = (line, fallback) => (/\r\n$/.test(line) ? '\r\n' : /\n$/.test(line) ? '\n' : fallback);

/** JSON 双引号串是合法 YAML 标量，且天然转义换行与双引号 */
export const scalar = (value) => JSON.stringify(String(value ?? ''));

export function locateItem(lines, id) {
  const key = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^- id:\\s*${key}\\s*$`);
  const from = lines.findIndex((l) => re.test(stripEol(l)));
  if (from < 0) throw new Error(`找不到条目 ${id}`);
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (/^- id:\s*\S+\s*$/.test(stripEol(lines[i]))) { to = i; break; }
  }
  return { from, to };
}

function fieldIndex(lines, from, to, key) {
  const re = new RegExp(`^  ${key}:\\s`);
  for (let i = from; i < to; i++) if (re.test(stripEol(lines[i]))) return i;
  return -1;
}

/**
 * values: { [字段]: 字符串 | null }；null 表示删除该字段行。
 * updated: 有真实内容变化时才写入；clearDead: 删除 `dead: true` 行。
 * 返回 { lines, changed }，调用方决定是否原子写盘。
 */
export function patchItem(lines, id, values, { updated = '', clearDead = false } = {}) {
  const work = [...lines];
  // 文件主行尾：末行可能不带换行，插入时不能凭空造出一个裸 CR
  const fallbackEol = lines.some((l) => /\r\n$/.test(l)) ? '\r\n' : '\n';
  let changed = false;
  // 条目末端会随删除而移动，每次都重新定位一次，避免行号错位
  const bounds = () => locateItem(work, id);

  for (const [key, value] of Object.entries(values)) {
    const { from: a, to: b } = bounds();
    const idx = fieldIndex(work, a, b, key);
    if (value === null) {
      if (idx >= 0) { work.splice(idx, 1); changed = true; }
      continue;
    }
    const next = `  ${key}: ${scalar(value)}`;
    if (idx >= 0) {
      if (stripEol(work[idx]) === next) continue;
      work[idx] = next + eolOf(work[idx], fallbackEol);
      changed = true;
    } else {
      // 新字段插在 title 之后（没有 title 就插在 id 之后），沿用锚点行行尾
      const anchor = fieldIndex(work, a, b, 'title');
      const at = anchor >= 0 ? anchor : a;
      work.splice(at + 1, 0, next + eolOf(work[at], fallbackEol));
      changed = true;
    }
  }

  if (changed && updated) {
    const { from: a, to: b } = bounds();
    const idx = fieldIndex(work, a, b, 'updated');
    // 日期沿用站内未加引号的写法，避免与存量 data/*.yaml 风格不一致
    const next = `  updated: ${String(updated).slice(0, 10)}`;
    if (idx >= 0) {
      if (stripEol(work[idx]) !== next) work[idx] = next + eolOf(work[idx], fallbackEol);
    } else {
      const files = fieldIndex(work, a, b, 'files');
      const anchor = files >= 0 ? files - 1 : fieldIndex(work, a, b, 'title');
      work.splice((anchor >= 0 ? anchor : a) + 1, 0, next + eolOf(work[anchor >= 0 ? anchor : a], fallbackEol));
    }
  }

  if (changed && clearDead) {
    const { from: a, to: b } = bounds();
    for (let i = b - 1; i >= a; i--) {
      if (/^  dead:\s*true\s*$/.test(stripEol(work[i]))) { work.splice(i, 1); break; }
    }
  }
  return { lines: work, changed };
}

export function readLines(raw) {
  return splitLines(raw);
}

/** 极简行级 diff：只标出首尾差异之间的删/增行，够管理界面核对 before/after */
export function diffTexts(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head && tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) tail++;
  const start = Math.max(0, head - 2);
  const out = [];
  for (let i = start; i < head; i++) out.push(`  ${a[i]}`);
  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);
  // 差异区通常只有几行；LCS 让「没动的相邻行」不混进 -/+，站长核对时少一圈噪音
  const n = aMid.length;
  const m = bMid.length;
  if (n * m <= 200000) {
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = aMid[i] === bMid[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && aMid[i] === bMid[j]) { out.push(`  ${aMid[i]}`); i++; j++; }
      else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) { out.push(`- ${aMid[i++]}`); }
      else { out.push(`+ ${bMid[j++]}`); }
    }
  } else {
    for (const line of aMid) out.push(`- ${line}`);
    for (const line of bMid) out.push(`+ ${line}`);
  }
  for (let i = a.length - tail; i < Math.min(a.length, a.length - tail + 2); i++) out.push(`  ${a[i]}`);
  return out.join('\n');
}
