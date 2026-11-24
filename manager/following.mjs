/**
 * 追热播清单的读写与校验（唯一实现）。
 *
 * 只处理 config/following.json；公共读取/规范化委托给 scripts/lib/following-manifest.mjs，
 * 构建侧不会反过来引用这里。所有写操作串行执行并走原子写，避免并发点击写坏清单。
 */
import {
  FOLLOWING_LOCAL,
  exportManifest,
  normalizeManifest,
  readFollowingManifest,
  stringifyManifest,
} from '../scripts/lib/following-manifest.mjs';
import { loadResources, normalizeResources, todayShanghai } from '../scripts/lib/data.js';
import { atomicWrite } from './lib/atomic.mjs';
import { CONFIG_DIR, DATA_DIR } from './lib/paths.mjs';

const LOCAL_FILE = (() => {
  // 明确写出路径是为了让下面的提示信息可读；路径常量本身来自 lib/paths.mjs
  return `${CONFIG_DIR}/${FOLLOWING_LOCAL}`;
})();

/** 串行化写操作：同一进程内两次点击不会互相覆盖 */
let queue = Promise.resolve();
function withLock(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function tvItems() {
  return normalizeResources(loadResources(DATA_DIR).filter((r) => r.__file === 'tv.yaml')).items;
}

function requireTv(id) {
  const key = String(id ?? '').trim();
  if (!/^tv-\d+$/.test(key)) throw new Error('资源 ID 必须是电视剧编号（如 tv-216）');
  const item = tvItems().find((it) => it.id === key);
  if (!item) throw new Error(`${key} 不在 data/tv.yaml 中`);
  if (item.category !== '电视剧') throw new Error(`${key} 不属于电视剧分类`);
  if (item.dead) throw new Error(`${key} 已标记死链，不能加入追热播`);
  return item;
}

export function read() {
  const { active, archived, source } = readFollowingManifest(CONFIG_DIR);
  return { active, archived, source };
}

export function exportForPublish() {
  return exportManifest(read());
}

function mutate(fn) {
  return withLock(() => {
    const current = normalizeManifest(read());
    const next = normalizeManifest(fn(current) || current);
    atomicWrite(LOCAL_FILE, stringifyManifest(next));
    return read();
  });
}

export function add({ id, note = '' } = {}) {
  const item = requireTv(id);
  return mutate((m) => {
    if (m.active.some((x) => x.id === item.id)) throw new Error(`${item.id} 已在追热播清单中`);
    if (m.archived.some((x) => x.id === item.id)) {
      throw new Error(`${item.id} 已归档，请先在底部恢复再调整`);
    }
    const entry = { id: item.id, addedAt: todayShanghai() };
    if (String(note).trim()) entry.note = String(note).trim().slice(0, 200);
    m.active.push(entry);
    return m;
  });
}

export function archive({ id } = {}) {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('缺少资源 ID');
  return mutate((m) => {
    const i = m.active.findIndex((x) => x.id === key);
    if (i < 0) throw new Error(`${key} 不在当前清单中`);
    m.active.splice(i, 1);
    m.archived.push({ id: key, removedAt: todayShanghai() });
    return m;
  });
}

/** 彻底移除：从 active 与 archived 都删掉，允许以后重新加入 */
export function remove({ id } = {}) {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('缺少资源 ID');
  return mutate((m) => {
    m.active = m.active.filter((x) => x.id !== key);
    m.archived = m.archived.filter((x) => x.id !== key);
    return m;
  });
}

export function restore({ id } = {}) {
  const key = String(id ?? '').trim();
  return mutate((m) => {
    const i = m.archived.findIndex((x) => x.id === key);
    if (i < 0) throw new Error(`${key} 不在归档清单中`);
    if (m.active.some((x) => x.id === key)) throw new Error(`${key} 已在当前清单中`);
    m.archived.splice(i, 1);
    m.active.push({ id: key, addedAt: todayShanghai() });
    return m;
  });
}

export function setNote({ id, note = '' } = {}) {
  const key = String(id ?? '').trim();
  return mutate((m) => {
    const entry = m.active.find((x) => x.id === key);
    if (!entry) throw new Error(`${key} 不在当前清单中`);
    if (String(note).trim()) entry.note = String(note).trim().slice(0, 200);
    else delete entry.note;
    return m;
  });
}

export function reorder({ ids } = {}) {
  if (!Array.isArray(ids)) throw new Error('ids 必须是数组');
  return mutate((m) => {
    const want = ids.map(String);
    const have = m.active.map((x) => x.id);
    if (want.length !== have.length || want.some((id) => !have.includes(id))) {
      throw new Error('排序必须包含当前清单的全部 ID，且不能重复');
    }
    const byId = new Map(m.active.map((x) => [x.id, x]));
    m.active = want.map((id) => byId.get(id));
    return m;
  });
}
