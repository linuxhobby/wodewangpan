/** 站点路径口径（2026-11-15 全站 URL 与配图目录带分类后，Mac / Windows 两侧共用）。
 *  站点：详情页 /<slug>/<id>/、分类页 /<slug>/；配图 static/images/<slug>/<id>.jpg。
 *  前缀 → slug 与 config/site.yaml 的 slugs 一一对应；站点构建会校验 slug 合法性与保留目录撞名。
 *  ⚠ 新增分类或改别名时，这张表必须和站点 config/site.yaml 同步改，别再往 static/images/ 根目录写图。
 */
import path from 'node:path';

export const PREFIX_SLUG = {
  mv: 'movie',
  tv: 'tv',
  dc: 'documentary',
  an: 'anime',
  game: 'game',
  app: 'software',
  bk: 'ebook',
  cs: 'course',
  ot: 'misc',
};

export function slugOf(idOrPrefix) {
  const p = String(idOrPrefix).split('-')[0];
  const slug = PREFIX_SLUG[p];
  if (!slug) throw new Error(`未知 id 前缀：${idOrPrefix}（请同步 PREFIX_SLUG 与站点 slugs）`);
  return slug;
}

/** 某个资源配图应放的目录（调用方负责 mkdirSync recursive） */
export function posterDir(repo, id) {
  return path.join(repo, 'static', 'images', slugOf(id));
}

/** 详情页 URL（仅用于文档 / 冒烟提示，站点侧以 build.js 的 setItemPaths 为准） */
export function itemUrl(id) {
  return `/${slugOf(id)}/${id}/`;
}
