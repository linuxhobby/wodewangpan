// 简介正文构造：TMDB 原文不足下限（默认 150 字）时，用 TMDB 已有的真实字段扩写补足，
// 而不是把条目丢掉。只陈述拿得到的事实，不编造情节。改这里等于改入库口径，SKILL.md 第 5 步同步记一笔。
//
// 输出口径与 scripts/check-desc.mjs 完全一致：正文 = 完整 description 去掉【…】标签、去掉结尾 ｜… 署名。
// 2026-11-12 起全站写入口径：正文下限 150 字、上限 700 字（原 200 / 1200）。
export const DESC_MIN = 150;
export const DESC_MAX = 700;

// 全部元数据都堆上还不够下限时，兜底补的收尾句（陈述事实，不编剧情）
const FALLBACK =
  '本条目由 TMDB 每日热门榜单自动同步入库，剧情与演职员资料均以 TMDB 官方数据为准，评分会随投票实时变动，资源链接见页面网盘地址。';

const STATUS_CN = {
  'Returning Series': '已获续订，仍在播出',
  'Ended': '已完结',
  'Canceled': '已取消',
  'In Production': '制作中',
  'Planned': '已立项',
  'Pilot': '仅播出试播集',
};

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// 句号收尾，已有标点就不再叠一个（TMDB 的 tagline 常自带句号，直接拼会出「。」「。」）
const sent = (s) => (/[。！？.!?…；;]$/.test(String(s || '').trim()) ? String(s).trim() : `${String(s).trim()}。`);

// TMDB 的 production_countries / spoken_languages 在 zh-CN 下仍返回英文名，这里换成中文
const COUNTRY_CN = {
  US: '美国', GB: '英国', JP: '日本', CN: '中国', KR: '韩国', CA: '加拿大', FR: '法国', DE: '德国',
  AU: '澳大利亚', AE: '阿联酋', NZ: '新西兰', IN: '印度', IT: '意大利', ES: '西班牙', HK: '中国香港',
  TW: '中国台湾', TH: '泰国', RU: '俄罗斯', BR: '巴西', MX: '墨西哥', IE: '爱尔兰', SE: '瑞典',
  DK: '丹麦', NO: '挪威', NL: '荷兰', CH: '瑞士', BE: '比利时', PL: '波兰', TR: '土耳其', ID: '印度尼西亚',
  PH: '菲律宾', SG: '新加坡', MY: '马来西亚', VN: '越南', IL: '以色列', ZA: '南非', AR: '阿根廷',
  CL: '智利', CO: '哥伦比亚', PT: '葡萄牙', GR: '希腊', AT: '奥地利', CZ: '捷克', HU: '匈牙利',
  FI: '芬兰', IS: '冰岛', LU: '卢森堡', RO: '罗马尼亚', UA: '乌克兰',
};
const LANG_CN = {
  en: '英语', zh: '汉语普通话', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语',
  it: '意大利语', ru: '俄语', pt: '葡萄牙语', th: '泰语', hi: '印地语', ar: '阿拉伯语', nl: '荷兰语',
  sv: '瑞典语', la: '拉丁语', he: '希伯来语', tr: '土耳其语', pl: '波兰语',
};
const countryName = (c) => COUNTRY_CN[c.iso_3166_1] || c.name;
const langName = (l) => LANG_CN[l.iso_639_1] || l.name;

/**
 * 构造 ≥ DESC_MIN 字的正文。
 * @param {object} o
 * @param {string} o.overview TMDB 中文 overview（已 trim）
 * @param {object} o.d        TMDB detail 结果（建议带 append_to_response=credits）
 * @param {'movie'|'tv'} o.type
 * @param {string} o.title     中文名
 * @param {string} o.original  原名
 * @returns {{ body: string, len: number, filled: boolean, rawLen: number }}
 */
export function buildBody({ overview = '', d = {}, type = 'movie', title = '', original = '' }) {
  const isTv = type === 'tv';
  const subj = isTv ? '本剧' : '本片';
  const raw = String(overview || '').replace(/\s+/g, ' ').trim();
  const rawLen = [...raw].length;

  const parts = [];
  const len = () => [...parts.join('')].length;
  const add = (s) => {
    const t = String(s || '').trim();
    if (t) parts.push(t);
  };
  const addIfShort = (s) => {
    if (len() >= DESC_MIN) return;
    add(s);
  };

  // 1) 原文打底（没标点结尾补一个句号，避免和后面的补料连成一句）
  if (raw) add(/[。！？.!?…；;]$/.test(raw) ? raw : `${raw}。`);
  else {
    const g0 = (d.genres || [])[0]?.name || '';
    const yr = (d.release_date || d.first_air_date || '').slice(0, 4);
    const lead = isTv
      ? `${title}（${original}）是${yr ? ` ${yr} 年` : ''}首播的${g0}剧集，官方暂未公布详细剧情简介。`
      : `${title}（${original}）是${yr ? ` ${yr} 年` : ''}上映的${g0}电影，官方暂未公布详细剧情简介。`;
    add(lead.replace(/（）/g, '').replace(/的剧集/, '剧集').replace(/的电影/, '电影'));
  }

  // 2) 依次补料，凑够 150 字就停（顺序：标语 → 类型 → 年代规格 → 产地 → 主创 → 阵容 → 出品 → 系列）
  if (d.tagline) addIfShort(sent(`官方标语：${d.tagline}`));

  const gs = (d.genres || []).map((g) => g.name).filter(Boolean);
  if (gs.length) addIfShort(sent(`${subj}类型：${gs.join(' / ')}`));

  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  if (isTv) {
    const segs = [];
    if (year) segs.push(`${year} 年首播`);
    if (STATUS_CN[d.status]) segs.push(STATUS_CN[d.status]);
    if (d.number_of_seasons) segs.push(`全剧 ${d.number_of_seasons} 季`);
    if (d.number_of_episodes) segs.push(`累计 ${d.number_of_episodes} 集`);
    const ert = (d.episode_run_time || []).filter((n) => Number(n) > 0);
    if (ert.length) segs.push(`单集约 ${ert[0]} 分钟`);
    if (segs.length) addIfShort(sent(segs.join('，')));
    const nets = (d.networks || []).map((n) => n.name).filter(Boolean);
    if (nets.length) addIfShort(sent(`播出平台：${nets.join('、')}`));
  } else {
    const segs = [];
    if (year) segs.push(`${year} 年上映`);
    if (Number(d.runtime) > 0) segs.push(`片长 ${d.runtime} 分钟`);
    if (segs.length) addIfShort(sent(segs.join('，')));
  }

  const cs = (d.production_countries || []).map(countryName).filter(Boolean);
  if (cs.length) addIfShort(sent(`制片国家/地区：${uniq(cs).join('、')}`));

  const crew = (d.credits && d.credits.crew) || [];
  const dirs = uniq(crew.filter((c) => c.job === 'Director').map((c) => c.name));
  if (dirs.length) addIfShort(sent(`导演：${dirs.slice(0, 3).join('、')}`));

  const writers = uniq(
    crew.filter((c) => ['Screenplay', 'Writer', 'Story', 'Novel'].includes(c.job)).map((c) => c.name)
  );
  if (writers.length) addIfShort(sent(`编剧：${writers.slice(0, 3).join('、')}`));

  const created = (d.created_by || []).map((c) => c.name).filter(Boolean);
  if (created.length) addIfShort(sent(`主创：${uniq(created).slice(0, 3).join('、')}`));

  const cast = ((d.credits && d.credits.cast) || []).map((c) => c.name).filter(Boolean);
  if (cast.length) addIfShort(sent(`主演：${uniq(cast).slice(0, 6).join('、')}`));

  const pcs = (d.production_companies || []).map((c) => c.name).filter(Boolean);
  if (pcs.length) addIfShort(sent(`出品方：${uniq(pcs).slice(0, 3).join('、')}`));

  const langs = (d.spoken_languages || []).map(langName).filter(Boolean);
  if (langs.length) addIfShort(sent(`对白语言：${uniq(langs).slice(0, 3).join('、')}`));

  if (d.belongs_to_collection && d.belongs_to_collection.name) {
    addIfShort(`${subj}属于「${d.belongs_to_collection.name}」系列。`);
  }

  if (len() < DESC_MIN) addIfShort(FALLBACK);

  let body = parts.join('').replace(/\s+/g, ' ').trim();
  if ([...body].length > DESC_MAX) body = [...body].slice(0, DESC_MAX).join('') + '…';
  return { body, len: [...body].length, filled: [...body].length > rawLen, rawLen };
}
