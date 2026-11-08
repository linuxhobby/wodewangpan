// tree 清单排序：目录优先 → 扩展名分组 → 组内自然序。
//
// 为什么需要：夸克分享详情接口返回的条目顺序是盘端内部顺序（按 fid/更新时间），
// 落到详情页就是「1-10.mkv、2-05.mp4、1-07.mkv」这种乱序，读者看不出集数规律。
// 排序放在写入侧而不是渲染侧，data/*.yaml 里的 tree 本身就是有序的，
// 构建逻辑（scripts/lib/render.js）不用动，也不影响 sitemap lastmod。
//
// 唯一实现：tools/fill-files.mjs 抓取新清单时用，tools/sort-trees.mjs 回填历史条目时也用，
// 避免两条路径排出两种顺序。
//
// 分组顺序与 files.format 同口径（数量多的扩展名在前，数量相同按扩展名字母序），
// 所以 MKV×10 / SRT×10 的条目会先列完十集正片，再列十份字幕。

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

const isDir = (name) => name.endsWith('/');

/** 取扩展名（大写，不含点）；目录与无扩展名文件返回 '' */
const extOf = (name) => {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name.replace(/\/$/, ''));
  return m ? m[1].toUpperCase() : '';
};

/**
 * 排好序的清单行（已去重、已剔除空行）。
 * 调用方负责截断（fill-files 取前 40 行）。
 * @param {string[]} names 形如 ['蓝色星球1-01.mkv', '066-BBC.蓝色星球/']
 * @returns {string[]}
 */
export function sortTree(names) {
  const uniq = [...new Set(names.filter((n) => n && n !== '/'))];

  // 扩展名 → 出现次数（目录、无扩展名不参与分组计数）
  const counts = new Map();
  for (const n of uniq) {
    if (isDir(n)) continue;
    const e = extOf(n);
    if (e) counts.set(e, (counts.get(e) || 0) + 1);
  }
  // 组序：数量降序，数量相同按扩展名字母序（与 format 字段一致）
  const rank = new Map(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([e], i) => [e, i])
  );

  return uniq.sort((a, b) => {
    const da = isDir(a);
    const db = isDir(b);
    if (da !== db) return da ? -1 : 1;
    if (da) return collator.compare(a, b);

    const ea = extOf(a);
    const eb = extOf(b);
    // 无扩展名的文件排在所有有扩展名的组之后
    const ra = ea ? (rank.get(ea) ?? 1e6) : 1e9;
    const rb = eb ? (rank.get(eb) ?? 1e6) : 1e9;
    if (ra !== rb) return ra - rb;
    if (ea !== eb) return ea.localeCompare(eb);
    return collator.compare(a, b);
  });
}
