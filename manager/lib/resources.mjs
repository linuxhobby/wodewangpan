/**
 * 全站资源字段编辑的读取、校验与写盘（受控字段，不是 CMS）。
 *
 * 读取沿用 scripts/lib/data.js 的 loadResources()/normalizeResources()；
 * 写盘走 manager/lib/yaml-patch.mjs 的按行补丁，只改 title / description / 四类网盘字段，
 * 不碰 id、category、added、files、image、tags，也不整体 dump YAML。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadResources,
  normalizeResources,
  loadSite,
  categorySlug,
  todayShanghai,
  SUBTITLE_CATS,
  HAS_SUBTITLE_RE,
  isLongTitle,
} from '../../scripts/lib/data.js';
import { atomicWrite } from './atomic.mjs';
import { diffTexts, patchItem, readLines } from './yaml-patch.mjs';
import { CONFIG_DIR, DATA_DIR } from './paths.mjs';

// loadSite() 会把 config/site.yaml 的 slugs 注入 categorySlug()，详情页链接才不靠 id 前缀猜
loadSite(CONFIG_DIR);

const URL_FIELDS = ['quark_url', 'baidu_url', 'guangya_url'];
const HOST_RULES = {
  quark_url: (h) => /(^|\.)quark\.cn$/.test(h),
  baidu_url: (h) => /(^|\.)baidu\.com$/.test(h),
  guangya_url: (h) => /(^|\.)guangyapan\.com$/.test(h),
};
const LABELS = {
  quark_url: '夸克网盘',
  baidu_url: '百度网盘',
  baidu_pwd: '百度提取码',
  guangya_url: '光鸭网盘',
  title: '标题',
  description: '简介',
};

function rawById(id) {
  const key = String(id ?? '').trim();
  const raw = loadResources(DATA_DIR).find((r) => String(r.id ?? '') === key);
  if (!raw) throw new Error(`${key || '未指定 ID'} 不在 data/*.yaml 中`);
  return raw;
}

/** js-yaml 会把未加引号的 `2026-11-24` 解析成 Date，界面上要还原成日期字符串 */
const rawDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ''));

function splitTitle(title, category) {
  const s = String(title ?? '');
  if (!SUBTITLE_CATS.has(String(category ?? ''))) return { main: s, sub: '' };
  const i = s.indexOf(' - ');
  return i < 0 ? { main: s, sub: '' } : { main: s.slice(0, i), sub: s.slice(i + 3) };
}

export function all() {
  return normalizeResources(loadResources(DATA_DIR)).items;
}

export function search({ cat = '', q = '' } = {}) {
  const keyword = String(q ?? '').trim().toLowerCase();
  const category = String(cat ?? '').trim();
  return all()
    .filter((it) => !category || it.category === category)
    .filter((it) => {
      if (!keyword) return true;
      return [it.id, it.title, it.category, it.keywords].some((v) =>
        String(v || '').toLowerCase().includes(keyword)
      );
    })
    .slice(0, 20)
    .map((it) => ({
      id: it.id,
      title: it.title,
      category: it.category,
      updated: it.updated || it.added || '',
      dead: !!it.dead,
      filesCount: (it.files && it.files.count) || '',
    }));
}

/** 简介尾部的来源标识（如 ｜TMDB 6.3）：默认保留，用户关掉开关才删 */
export function sourceSuffix(description) {
  const m = String(description ?? '').match(/｜[^｜]+$/);
  return m ? m[0] : '';
}

export function get(id) {
  const raw = rawById(id);
  const title = String(raw.title ?? '');
  const description = String(raw.description ?? raw.desc ?? '');
  const { main, sub } = splitTitle(title, raw.category);
  return {
    id: String(raw.id),
    title,
    titleMain: main,
    titleSub: sub,
    category: String(raw.category ?? ''),
    description,
    sourceSuffix: sourceSuffix(description),
    quark_url: String(raw.quark_url ?? ''),
    baidu_url: String(raw.baidu_url ?? ''),
    baidu_pwd: String(raw.baidu_pwd ?? raw.baidu_code ?? ''),
    baiduKey: raw.baidu_code !== undefined ? 'baidu_code' : 'baidu_pwd',
    guangya_url: String(raw.guangya_url ?? ''),
    dead: raw.dead === true || String(raw.dead) === 'true',
    updated: rawDate(raw.updated),
    file: String(raw.__file || ''),
    href: `/${categorySlug(raw.category)}/${encodeURIComponent(String(raw.id))}/`,
  };
}

function checkUrl(field, value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let url;
  try { url = new URL(s); } catch { return `${LABELS[field]}不是有效链接`; }
  if (!['http:', 'https:'].includes(url.protocol)) return `${LABELS[field]}只接受 http/https 链接`;
  if (!HOST_RULES[field](url.hostname.toLowerCase())) return `${LABELS[field]}域名不匹配`;
  return '';
}

function mergedTitle(current, changes) {
  const main = String(changes.titleMain ?? current.titleMain ?? '').trim();
  const sub = String(changes.titleSub ?? current.titleSub ?? '').trim();
  if (!main) throw new Error('主标题不能为空');
  if (String(main).includes('"') || String(sub).includes('"')) throw new Error('标题不要含双引号');
  const combined = sub ? `${main} - ${sub}` : main;
  if ([...combined].length > 48) throw new Error('标题超过 48 字，请精简');
  if (!SUBTITLE_CATS.has(current.category)) {
    if (sub) throw new Error('影视类标题保持纯片名，不能加副标');
  } else if (!sub && !HAS_SUBTITLE_RE.test(main) && !isLongTitle(main)) {
    throw new Error('工具资料类请填副标（原名 - 客观功能描述），长标题除外');
  }
  return combined;
}

/**
 * 生成补丁但不写盘，供界面展示 before/after。
 * changes 只包含用户要改的键；原样提交（键缺失或值相同）不会产生任何写入。
 */
export function prepare(id, changes = {}, deadVerified = false) {
  const current = get(id);
  const raw = rawById(id);
  const values = {};
  const errors = [];

  if ('titleMain' in changes || 'titleSub' in changes) {
    const next = mergedTitle(current, changes);
    if (next !== current.title) values.title = next;
  }

  if ('description' in changes) {
    let desc = String(changes.description ?? '').trim();
    if (!desc) errors.push('简介不能为空');
    if (changes.keepSource === false) {
      const suffix = sourceSuffix(current.description);
      if (suffix && desc.endsWith(suffix)) desc = desc.slice(0, -suffix.length).trim();
    }
    if (desc && desc !== current.description) values.description = desc;
  }

  for (const field of URL_FIELDS) {
    if (!(field in changes)) continue;
    const next = String(changes[field] ?? '').trim();
    const why = checkUrl(field, next);
    if (why) errors.push(why);
    if (next !== String(raw[field] ?? '')) values[field] = next || null;
  }
  if ('baidu_pwd' in changes) {
    const next = String(changes.baidu_pwd ?? '').trim();
    if (next && !/^[A-Za-z0-9]{4}$/.test(next)) errors.push('百度提取码应为 4 位字母或数字');
    if (next !== current.baidu_pwd) values[current.baiduKey] = next || null;
  }
  if (errors.length) throw new Error(errors.join('；'));

  const urlChanged = ['quark_url', 'baidu_url', 'guangya_url', 'baidu_pwd'].some((k) => k in values);
  const clearDead = deadVerified === true && urlChanged && current.dead;
  const file = path.join(DATA_DIR, current.file);
  const before = fs.readFileSync(file, 'utf8');
  const today = todayShanghai();
  // patchItem 只在字段真的变化时写 updated，原样保存不会盖日期
  const { lines, changed } = patchItem(readLines(before), id, values, {
    updated: today,
    clearDead,
  });
  const after = lines.join('');
  return {
    id,
    file,
    changed,
    after,
    diff: changed ? diffTexts(before, after) : '',
    updated: changed ? today : current.updated,
    clearDead,
  };
}

export function save(id, changes = {}, deadVerified = false) {
  const result = prepare(id, changes, deadVerified);
  if (result.changed) atomicWrite(result.file, result.after);
  return {
    id: result.id,
    file: result.file,
    changed: result.changed,
    diff: result.diff,
    updated: result.updated,
    clearDead: result.clearDead,
  };
}
