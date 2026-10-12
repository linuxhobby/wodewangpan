import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const NETDISK_PRESETS = [
  { key: 'quark_url', code: 'quark_code', kind: 'quark', name: '夸克网盘' },
  { key: 'baidu_url', code: 'baidu_code', kind: 'baidu', name: '百度网盘' },
  { key: 'aliyun_url', code: 'aliyun_code', kind: 'aliyun', name: '阿里云盘' },
  { key: 'tianyi_url', code: 'tianyi_code', kind: 'tianyi', name: '天翼云盘' },
  { key: 'uc_url', code: 'uc_code', kind: 'uc', name: 'UC网盘' },
  { key: 'xunlei_url', code: 'xunlei_code', kind: 'xunlei', name: '迅雷网盘' },
  { key: '115_url', code: '115_code', kind: '115', name: '115网盘' },
  { key: 'mobile_url', code: 'mobile_code', kind: 'mobile', name: '移动云盘' },
];

const MAX_DESC = 1200;

/** 正文下限：低于它详情页易被判薄内容。改这里 = 改全站标准 */
export const MIN_DESC = 300;

/**
 * 正文字数：【…】标签与结尾 ｜… 署名不计入。全站只有这一个口径，改它会同时
 * 影响 list-short-desc / fill-desc / skill 的判定，详见 docs/site-建站与开发.md。
 */
export function bodyLength(text) {
  return [
    ...String(text || '')
      .replace(/【[^】]*】/g, '')
      .replace(/｜[^｜]{1,40}\s*$/, '')
      .trim(),
  ].length;
}

/** 按字符数截断（不会切断代理对 / emoji），超长补省略号 */
export function clipDesc(text, max = MAX_DESC) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s === '' || max <= 0) return s;
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('') + '…';
}

function hashId(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'r' + (h >>> 0).toString(36);
}

/** 纯中文返回空串，由调用方回退（hashId 或原样） */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 别名没配就用分类名原样；表由 loadSite() 注入，保证链接 / sitemap / RSS 同一套路径 */
let CATEGORY_SLUGS = new Map();
function setCategorySlugs(map) {
  CATEGORY_SLUGS = new Map(
    Object.entries(map || {}).map(([k, v]) => [String(k).trim(), String(v).trim()])
  );
}

/**
 * 标签 → URL 段，三级取值：手写别名 → 拼音兜底 → 原样（编码中文）。
 * 别名表「只增不改」：给已收录的标签事后补别名等于换 URL 丢排名。
 * 完整口径与反面案例见 docs/site-建站与开发.md 第一节。
 */
let TAG_SLUGS = new Map();
function setTagSlugs(map) {
  TAG_SLUGS = new Map(
    Object.entries(map || {}).map(([k, v]) => [String(k).trim(), String(v).trim()])
  );
}
/** 拼音兜底由构建入口注入；pinyin-pro 没装时退化到第 3 级原样 */
let SLUG_FALLBACK = null;
export function setSlugFallback(fn) {
  SLUG_FALLBACK = typeof fn === 'function' ? fn : null;
}
export function tagSlug(tag) {
  const key = String(tag || '').trim();
  // 兜底返回空串（纯符号标签，拼音也救不了）时也要落回原样，不能产生空路径
  return TAG_SLUGS.get(key) || (SLUG_FALLBACK && SLUG_FALLBACK(key)) || key;
}

/** 标签聚合页的最低资源数：低于这个数不出页 */
export const MIN_TAG_ITEMS = 3;

/** 标签页与分类页的近重复阈值（Jaccard），超过就认为两页对搜索引擎是同一份内容 */
export const DEFAULT_TAG_OVERLAP_MAX = 0.8;

/**
 * 近重复检测的最小条数门槛：小集合 Jaccard 极不稳定（Linux 4 条 vs 操作系统 6 条
 * 就有 67%），而只有几条内容的页面重不重复危害都有限。配 0 表示不设门槛。
 */
export const DEFAULT_TAG_OVERLAP_MIN_SIZE = 10;

/** 标签归一键：大小写与空格不影响同一性，"Sci-Fi & Fantasy" 与 "sci-fi&fantasy" 算同一个 */
export function tagKey(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 中日韩字符（含日文假名、韩文），用来剥掉英文原名后比对标题 */
const NON_CJK = /[^\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g;
const cjkOf = (text) => String(text || '').replace(NON_CJK, '');

/**
 * 数据里大量标签其实是作品原名（「权力的游戏 第二季 Game of Thrones S02」），
 * 只属于单个资源，给它建聚合页就是只有一个成员的空壳页。
 */
function isTitleNoise(tag, title) {
  const t = tagKey(tag);
  const ti = tagKey(title);
  if (!t || !ti) return false;
  if (t === ti) return true;
  const ct = cjkOf(t);
  const ci = cjkOf(ti);
  return ct !== '' && ct === ci;
}

/**
 * 汇总「值得出聚合页」的标签。724 个去重标签里 662 个只出现 1 次，照单全收会生成
 * 600+ 个单条页面，所以做四道过滤：与分类同名 / 标题原式残留 / 资源数不足 min / exclude 名单。
 *
 * exclude 是人工兜底，留给「名字不像分类、内容却已被分类页覆盖」的近义标签
 * （如「纪录」对「纪录片」）。它只砍聚合页——标签照常显示，只是不再可点，搜索也搜得到。
 *
 * @returns {{key: string, label: string, count: number, items: object[]}[]} 按资源数倒序
 */
export function collectTags(items, { categories = [], min = MIN_TAG_ITEMS, exclude = [] } = {}) {
  const catSet = new Set((categories || []).map((c) => tagKey(c)));
  // 排除表同时收原样与规范化后的 key，配置里写「纪录」或它的 tagKey 形式都能命中
  const skip = new Set(
    (exclude || []).flatMap((x) => {
      const s = String(x ?? '').trim();
      return s ? [s, tagKey(s)] : [];
    })
  );
  const buckets = new Map();
  for (const it of items) {
    for (const raw of it.tags || []) {
      const label = String(raw || '').trim();
      const key = tagKey(label);
      if (!key) continue;
      if (catSet.has(key)) continue;
      if (skip.has(key) || skip.has(label)) continue;
      if (isTitleNoise(label, it.title)) continue;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { key, items: [], variants: new Map() }));
      b.items.push(it);
      // 同一标签可能有大小写 / 全半角写法差异，显示名取出现最多的那种
      b.variants.set(label, (b.variants.get(label) || 0) + 1);
    }
  }
  const list = [];
  for (const b of buckets.values()) {
    if (b.items.length < min) continue;
    let label = b.key;
    let best = -1;
    for (const [v, n] of b.variants) {
      if (n > best) {
        best = n;
        label = v;
      }
    }
    list.push({ key: b.key, label, count: b.items.length, items: b.items });
  }
  return list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function categorySlug(name) {
  const key = String(name).trim();
  return CATEGORY_SLUGS.get(key) || key.replace(/[\\/]+/g, '-');
}

function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 时区必须写死东八区：构建机多是 UTC，否则北京时间早上 8 点前入库的会被算到前一天 */
export function todayShanghai(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * 「最新」角标给谁：只认构建当天入库，当天有几条标几条（老片今天入库也算新）。
 * 不取「全站前 N 条」或「最近 N 天」——那会让昨天甚至更早的还挂着「最新」。
 */
export function newestIdsOf(items, today = todayShanghai()) {
  const ids = new Set();
  for (const it of items || []) if (it.added === today) ids.add(it.id);
  return ids;
}

/** 排序键 'YYYY-MM-DDTHH:mm'（字典序即时间序）；added 只写日期的按当天 00:00 */
function formatDateTime(value) {
  if (!value) return '';
  const p = (n) => String(n).padStart(2, '0');
  const d = value instanceof Date ? value : new Date(String(value).trim().replace(' ', 'T'));
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const m = String(value).match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return '';
  return `${m[1]}T${p(m[2] || 0)}:${m[3] || '00'}`;
}

function toTags(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,，、\s]+/);
  return list.map((t) => String(t).trim()).filter(Boolean);
}

// 防御：配置文件万一被复制回 data/，不把它当资源扫描。两个遍历函数共用这一份，新增配置只改这里
const NON_RESOURCE_FILES = new Set(['site.yaml', 'tags.yaml']);
function isResourceFile(f) {
  return /\.ya?ml$/i.test(f) && !NON_RESOURCE_FILES.has(f);
}

export function loadResources(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(isResourceFile).sort();

  const all = [];
  for (const file of files) {
    const parsed = yaml.load(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    if (!parsed) continue;
    const list = Array.isArray(parsed) ? parsed : parsed.resources || [];
    for (const raw of list) all.push({ ...raw, __file: file });
  }
  return all;
}

/** 刷新 data/*.yaml 头部注释里的条数（「# 电影资源（239 条）」），数字变了才写回 */
export function syncHeaderCounts(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  const changed = [];
  const files = fs.readdirSync(dataDir).filter(isResourceFile).sort();

  for (const file of files) {
    const full = path.join(dataDir, file);
    const text = fs.readFileSync(full, 'utf8');
    const headMatch = text.match(/^((?:#[^\n]*\n)+)/);
    if (!headMatch) continue; // 没有头部注释的文件不处理

    const parsed = yaml.load(text);
    const n = (Array.isArray(parsed) ? parsed : parsed?.resources || []).length;
    const head = headMatch[1];
    let next;
    if (/^#[^\n]*?（\d+ 条）/m.test(head)) {
      next = head.replace(/^(#[^\n]*?)（\d+ 条）/m, `$1（${n} 条）`);
    } else if (/^#[^\n]*资源/m.test(head)) {
      next = head.replace(/^(#[^\n]*资源)/m, `$1（${n} 条）`);
    } else {
      continue;
    }
    if (next === head) continue;

    fs.writeFileSync(full, next + text.slice(head.length));
    changed.push(`${file} → ${n} 条`);
  }
  return changed;
}

export function loadSite(configDir) {
  const file = path.join(configDir, 'site.yaml');
  const cfg = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) || {} : {};
  // 别名表要在生成任何链接之前装好，否则 categorySlug() 会退回用中文分类名
  setCategorySlugs(cfg.slugs);
  return {
    title: cfg.title || '网盘资源站',
    description: cfg.description || '',
    baseUrl: cfg.baseUrl || '',
    // 站长平台验证码：原样透传给 render 层，由它决定输出哪几个 <meta>
    verification:
      cfg.verification && typeof cfg.verification === 'object' && !Array.isArray(cfg.verification)
        ? cfg.verification
        : null,
    disclaimer: cfg.disclaimer || '',
    categories: Array.isArray(cfg.categories) ? cfg.categories.map(String) : [],
    icp: cfg.icp || '',
    contact: cfg.contact && typeof cfg.contact === 'object' ? cfg.contact : null,
    qqGroup: cfg.qqGroup || '',
    maintainer: cfg.maintainer || '',
    stats: cfg.stats || '',
    homeTitle: cfg.homeTitle || '',
    homeDesc: cfg.homeDesc || '',
    homeH1: cfg.homeH1 || '',
    pageSize: Number(cfg.pageSize) > 0 ? Number(cfg.pageSize) : 60,
    // 首页每个分类展示几条（PC 端宫格 5 列，5 条正好一行；窄屏由 CSS 按列数藏掉多出来的）
    homePerCategory: Number(cfg.homePerCategory) > 0 ? Math.floor(Number(cfg.homePerCategory)) : 5,
    // 首页分类区块顺序：fixed = site.yaml 的 categories 顺序；recent = 按各分类最新入库时间倒序
    homeCatOrder: cfg.homeCatOrder === 'recent' ? 'recent' : 'fixed',
  };
}

/** 标签定制文案（tagMeta）：只取 title / desc / h1 三个字段 */
function tagMetaOf(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [label, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    out.set(String(label).trim(), {
      title: String(v.title ?? '').trim(),
      desc: String(v.desc ?? '').trim(),
      h1: String(v.h1 ?? '').trim(),
    });
  }
  return out;
}

const toList = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/**
 * config/tags.yaml。与 site.yaml 分开是因为两类配置维护节奏不同（站点配置建站定一次，
 * 标签配置跟着内容长）。必须在第一次 tagSlug() 之前调用：别名表由它装载。
 */
export function loadTagConfig(configDir) {
  const file = path.join(configDir, 'tags.yaml');
  const cfg = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) || {} : {};
  // 别名表要早于任何标签链接生成，否则 tagSlug() 会退回拼音兜底，URL 就变了
  setTagSlugs(cfg.tagSlugs);
  return {
    // 标签聚合页的最低资源数，不配就用 MIN_TAG_ITEMS
    min: Number(cfg.tagMin) > 0 ? Number(cfg.tagMin) : MIN_TAG_ITEMS,
    // 不建页的标签（标签本身照常显示，只是不可点）
    exclude: toList(cfg.tagExclude),
    // 与分类页重合但照样要保留页面的标签：区别是 exclude 不建页，这里只是不再告警
    overlapAllow: toList(cfg.tagOverlapAllow),
    meta: tagMetaOf(cfg.tagMeta),
    // 近重复阈值（Jaccard），超了构建告警；配 1 等于关掉
    overlapMax: Number(cfg.tagOverlapMax) > 0 ? Number(cfg.tagOverlapMax) : DEFAULT_TAG_OVERLAP_MAX,
    // 近重复检测的最小条数门槛；要区分「没配」和「配了 0」
    overlapMinSize:
      cfg.tagOverlapMinSize === undefined || cfg.tagOverlapMinSize === null
        ? DEFAULT_TAG_OVERLAP_MIN_SIZE
        : Math.max(0, Number(cfg.tagOverlapMinSize) || 0),
  };
}

/** 把原始数据规整成标准结构，生成 id / 链接列表 / 时间等 */
export function normalizeResources(rawList) {
  const used = new Map();
  const items = [];

  rawList.forEach((raw, index) => {
    const title = String(raw.title || '').trim();
    if (!title) return;

    let id = String(raw.id || slugify(title) || hashId(title || String(index))).trim();
    if (used.has(id)) {
      const n = used.get(id) + 1;
      used.set(id, n);
      id = `${id}-${n}`;
    } else {
      used.set(id, 1);
    }

    const links = [];
    for (const preset of NETDISK_PRESETS) {
      const url = raw[preset.key];
      if (!url) continue;
      links.push({
        kind: preset.kind,
        name: raw[`${preset.kind}_name`] || preset.name,
        url: String(url).trim(),
        code: raw[preset.code] ? String(raw[preset.code]).trim() : '',
      });
    }
    if (Array.isArray(raw.links)) {
      for (const l of raw.links) {
        if (!l || !l.url) continue;
        links.push({
          kind: l.kind || 'other',
          name: l.name || '网盘链接',
          url: String(l.url).trim(),
          code: l.code ? String(l.code).trim() : '',
        });
      }
    }

    const date = formatDate(raw.date || raw.updated || '');
    const addedRaw = raw.added || raw.added_at || raw.created || '';
    const added = formatDate(addedRaw);
    // 排序键带时间：只写日期的按当天 00:00，写了时分的可精确到入库时刻
    const sortKey = formatDateTime(addedRaw) || '9999-12-31T00:00';
    items.push({
      id,
      title,
      category: String(raw.category || '未分类').trim(),
      tags: toTags(raw.tags),
      description: clipDesc(raw.description || raw.desc || ''),
      image: raw.image ? String(raw.image) : '',
      date,
      added,
      links,
      primary: links[0] || null,
      // 未填 added 视为最新，排在最前
      sortKey,
      order: index,
    });
  });

  /** 取 id 末尾的编号，用于同日加入时按加入顺序（编号大者在后）排序 */
  function idNum(id) {
    const m = String(id).match(/(\d+)$/);
    return m ? Number(m[1]) : -1;
  }

  // 入库时刻倒序（同一天的按实际先后）→ 同刻按编号倒序 → 上映日期倒序 → 文件内原序
  items.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
    const na = idNum(a.id);
    const nb = idNum(b.id);
    if (na !== nb) return nb - na;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.order - b.order;
  });

  const counts = new Map();
  for (const it of items) counts.set(it.category, (counts.get(it.category) || 0) + 1);
  const siteCats = new Set();
  return { items, counts };
}

/** 分类顺序：site.yaml 指定的优先，其余按资源数量倒序追加 */
export function orderCategories(site, counts) {
  const ordered = [];
  const seen = new Set();
  for (const c of site.categories) {
    if (counts.has(c) && !seen.has(c)) {
      ordered.push(c);
      seen.add(c);
    }
  }
  const rest = [...counts.entries()]
    .filter(([c]) => !seen.has(c))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  for (const [c] of rest) ordered.push(c);
  return ordered;
}
