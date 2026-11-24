/**
 * 连载状态看板：只读呈现，不抓盘端、不写 data/。
 * 活跃/定格/死链复用 tools/lib/serials.mjs 的 itemState()；
 * 「可能缺资源」沿用 tools/fill-files.mjs --todo 的判定思路（无 files 块 / 只有占位和目录行）。
 */
import { all } from './resources.mjs';
import { itemState, IDLE_DAYS } from '../../tools/lib/serials.mjs';
import { todayShanghai } from '../../scripts/lib/data.js';

// 与 tools/fill-files.mjs 顶部的 PLACEHOLDER_FILE_RE 同口径：改那边必须同步这里。
// 这里只读展示，不参与任何写盘，因此不倒过来让 fill-files 引用 manager。
const PLACEHOLDER_FILE_RE =
  /^(资源在24小时内更新|资源缺失反馈请加QQ群|关于我的网盘索引站|我的网盘网址|资源正在陆续更新上传中)|\.fg(?:\.ed|\.op)?$|^\.DS_Store$|^\._|^__MACOSX$|^Thumbs\.db$|^Desktop\.ini$/i;

const SERIAL_CATS = ['电视剧', '动漫'];

export function filesMissing(item) {
  const tree = String(item.files?.tree ?? '');
  if (!tree.trim()) return true;
  const lines = tree
    .split('\n')
    .map((line) => line.trim().replace(/^[├└│─\s]+/, ''))
    .filter(Boolean);
  const content = lines.filter((line) => !PLACEHOLDER_FILE_RE.test(line) && !/[/\\]$/.test(line));
  return content.length === 0;
}

function row(item, extra = {}) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    updated: item.updated || item.added || '',
    count: item.files?.count || '',
    dead: !!item.dead,
    ...extra,
  };
}

export function status(cats = SERIAL_CATS) {
  const today = todayShanghai();
  const wanted = Array.isArray(cats) && cats.length ? cats : SERIAL_CATS;
  const groups = { active: [], settled: [], dead: [], missing: [] };
  for (const item of all()) {
    if (!wanted.includes(item.category)) continue;
    if (item.dead) { groups.dead.push(row(item)); continue; }
    if (filesMissing(item)) { groups.missing.push(row(item)); continue; }
    const state = itemState(item, today);
    groups[state.kind].push(row(item, { days: state.days }));
  }
  return {
    today,
    idleDays: IDLE_DAYS,
    cats: wanted,
    groups,
    summary: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
  };
}

export function todo(cats = SERIAL_CATS) {
  return status(cats).groups.missing;
}
