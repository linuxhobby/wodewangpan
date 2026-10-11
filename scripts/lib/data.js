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

/**
 * 详情页简介字数上限（按 Unicode 字符计，中文一字一符）；超出才截断。
 * 资源页已改用 1180px 宽容器，正文区约 878px（每行约 60 字），
 * 1200 字约 20 行、比窄版时的 1000 字更矮，所以把天花板抬到这里是安全的。
 */
const MAX_DESC = 1200;

/** 按字符数截断（不会切断代理对 / emoji），超长补省略号 */
export function clipDesc(text, max = MAX_DESC) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s === '' || max <= 0) return s;
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('') + '…';
}

/** 内部工具：全部只在本文件使用，不对外导出 */
function hashId(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'r' + (h >>> 0).toString(36);
}

/** 英文/数字标题转 slug；中文标题返回空串，由调用方回退到 hashId */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 分类 → URL 段：优先用 site.yaml 的 slugs 里配的英文名，没配就用分类名原样。
 * 别名表由 loadSite() 写入（构建入口第一个调用），全局有效，保证链接、sitemap、RSS 用同一套路径。
 */
let CATEGORY_SLUGS = new Map();
/** 由 loadSite() 调用注入别名表，无需对外暴露 */
function setCategorySlugs(map) {
  CATEGORY_SLUGS = new Map(
    Object.entries(map || {}).map(([k, v]) => [String(k).trim(), String(v).trim()])
  );
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

/**
 * 入库日期 + 可选时间 → 排序键 'YYYY-MM-DDTHH:mm'（字典序即时间序）。
 * added 写成 "2026-10-07 17:40" 就带时间，只写 "2026-10-07" 按当天 00:00，
 * 这样同一天入库的多条也能按实际入库先后排，后加的排在最前。
 */
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

/** 读取 data/ 目录下所有 .yaml / .yml 资源文件（site.yaml 除外），合并为一个数组 */
export function loadResources(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /\.ya?ml$/i.test(f) && f !== 'site.yaml')
    .sort();

  const all = [];
  for (const file of files) {
    const parsed = yaml.load(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    if (!parsed) continue;
    const list = Array.isArray(parsed) ? parsed : parsed.resources || [];
    for (const raw of list) all.push({ ...raw, __file: file });
  }
  return all;
}

/**
 * 把 data/*.yaml 头部注释里的条数刷新为实际条数，避免手工维护时数字漂移。
 * 例：「# 电影资源（10 条）」→「# 电影资源（239 条）」；头部没有条数标记但含「资源」二字时自动补上。
 * 只有数字确实变化时才会写回文件。返回被修改的文件说明列表。
 */
export function syncHeaderCounts(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  const changed = [];
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /\.ya?ml$/i.test(f) && f !== 'site.yaml')
    .sort();

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

export function loadSite(dataDir) {
  const file = path.join(dataDir, 'site.yaml');
  const cfg = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) || {} : {};
  // 别名表要在生成任何链接之前装好，否则 categorySlug() 会退回用中文分类名
  setCategorySlugs(cfg.slugs);
  return {
    title: cfg.title || '网盘资源站',
    description: cfg.description || '',
    baseUrl: cfg.baseUrl || '',
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
