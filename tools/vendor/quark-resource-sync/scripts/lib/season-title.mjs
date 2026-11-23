/**
 * 夸克目录名 → 站内标题的季/部标注（2026-11-24 起）
 *
 * 背景：TMDB 剧名通常是裸名（如「人生一串」），同一剧的不同季在夸克目录名里却明确写着
 * 「第 1 季」「第 4 季」。入库标题若直接用 TMDB 命中名，两季会变成同名条目，用户无法区分。
 * 这里集中提供解析与拼装口径，match-batch / process-batch / resource-sync 共用，勿另写正则。
 */

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 「四」→4、「第 4 季」→4、「十一」→11；无法解析返回 null */
export function cn2num(s) {
  const t = String(s || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '十') return 10;
  if (t.includes('十')) {
    const [a, b] = t.split('十');
    return (a ? CN_DIGIT[a] : 1) * 10 + (b ? CN_DIGIT[b] : 0);
  }
  return CN_DIGIT[t] ?? null;
}

/** 4→「四」、11→「十一」；与 trending-sync 的站内标题口径一致 */
export function cnNum(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return String(n);
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return '十' + CN_NUM[n - 10];
  return CN_NUM[Math.floor(n / 10)] + '十' + (n % 10 ? CN_NUM[n % 10] : '');
}

/**
 * 从夸克目录名里取「第几季 / 第几部」。
 * 只认显式标注：第 4 季、第五季、第2部、S03、Season 2；「第 4 集」不算。
 */
export function seasonMark(name) {
  const s = String(name || '');
  for (const re of [/第\s*([一二两三四五六七八九十\d]+)\s*([季部])/, /([一二两三四五六七八九十\d]+)\s*([季部])(?:[\s.（(]|$)/]) {
    const m = s.match(re);
    if (!m) continue;
    const n = cn2num(m[1]);
    if (n) return { number: n, kind: m[2] };
  }
  const m = s.match(/\bS(?:eason)?\s*(\d+)\b/i);
  const n = m && cn2num(m[1]);
  return n ? { number: n, kind: '季' } : null;
}

/** 只要季号（match-batch 的多候选判别沿用旧口径） */
export const seasonHint = (name) => seasonMark(name)?.number || null;

/** 从带规格后缀的网盘目录名里剥出裸标题，供无 TMDB 命中时兜底 */
export function driveTitleBase(name) {
  return String(name || '')
    .replace(/^\s*\d+\s*[-.]\s*/, '')
    .replace(/\s*[-—]\s*(?:第\s*[一二两三四五六七八九十\d]+\s*[季部]|S(?:eason)?\s*\d+|(?:19|20)\d{2}).*$/i, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim();
}

/**
 * TMDB 裸名 + 夸克目录名里的季/部 → 站内标题。
 * 已经是「人生一串 第四季」「虎胆龙威（第一部）」的不再重复追加。
 */
export function seasonTitle(title, nameOrMark) {
  const base = String(title || '').trim();
  if (!base) return base;
  const mark = nameOrMark && typeof nameOrMark === 'object' ? nameOrMark : seasonMark(nameOrMark);
  if (!mark) return base;
  const word = `第${cnNum(mark.number)}${mark.kind}`;
  if (base.includes(word)) return base;
  return mark.kind === '部' ? `${base}（${word}）` : `${base} ${word}`;
}
