/**
 * 追热播清单的公共读取与校验口径（2026-11-24）。
 *
 * 单向依赖：build.js / render.js / nav.js 只能从这里读，禁止引用 manager/ 下任何文件。
 * 本地工作清单 config/following.json 不入库；入库的 config/following.example.json
 * 是发布版清单（由管理工具导出，不含站长备注），VPS 构建时用它。
 * 两份都不存在时按空清单处理，站点照常构建。
 */
import fs from 'node:fs';
import path from 'node:path';

export const FOLLOWING_LOCAL = 'following.json';
export const FOLLOWING_TRACKED = 'following.example.json';

/** 资源 id 的稳定形态：分类前缀 + 数字编号，避免拿剧名当键 */
const ID_RE = /^[a-z]+-\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asDate(value) {
  const s = String(value ?? '').trim();
  return DATE_RE.test(s) ? s : '';
}

function normalizeEntry(entry, kind) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const id = String(entry.id ?? '').trim();
  if (!ID_RE.test(id)) return null;
  const dateKey = kind === 'active' ? 'addedAt' : 'removedAt';
  const out = { id };
  const date = asDate(entry[dateKey]);
  if (date) out[dateKey] = date;
  if (kind === 'active' && typeof entry.note === 'string' && entry.note.trim()) {
    out.note = entry.note.trim().slice(0, 200);
  }
  return out;
}

/** 校验并规范化：非法 id / 重复 id 直接剔除，不让坏清单把构建带崩 */
export function normalizeManifest(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const seen = new Set();
  const pick = (key, kind) => {
    const list = Array.isArray(source[key]) ? source[key] : [];
    const out = [];
    for (const raw of list) {
      const item = normalizeEntry(raw, kind);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };
  // 先收 active，archived 里同 id 视为重复：正在展示的剧不能再归档
  const active = pick('active', 'active');
  const archived = pick('archived', 'archived').filter((x) => !active.some((a) => a.id === x.id));
  return { active, archived };
}

/** 序列化成入库 JSON：键顺序固定、LF 行尾、末尾换行，避免每次导出都产生整文件 diff */
export function stringifyManifest(manifest) {
  const { active, archived } = normalizeManifest(manifest);
  return `${JSON.stringify({ active, archived }, null, 2)}\n`;
}

/** 发布版不带上站长备注（备注只在本地管理界面可见） */
export function exportManifest(manifest) {
  const { active, archived } = normalizeManifest(manifest);
  return {
    active: active.map(({ id, addedAt }) => ({ id, ...(addedAt ? { addedAt } : {}) })),
    archived: archived.map(({ id, removedAt }) => ({ id, ...(removedAt ? { removedAt } : {}) })),
  };
}

/**
 * 优先读本地清单；没有本地清单时回落到入库的发布版。
 * JSON 坏掉时打印一行提示并按空清单处理，不让整站构建失败。
 */
export function readFollowingManifest(configDir) {
  let firstError = '';
  for (const name of [FOLLOWING_LOCAL, FOLLOWING_TRACKED]) {
    const file = path.join(configDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...normalizeManifest(parsed), source: name, file };
    } catch (e) {
      firstError ||= `${name}: ${e.message}`;
    }
  }
  if (firstError) console.warn(`  ! 追热播清单读取失败（按空清单构建）：${firstError}`);
  return { active: [], archived: [], source: '', file: '' };
}
