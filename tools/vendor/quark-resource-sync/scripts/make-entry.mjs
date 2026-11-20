#!/usr/bin/env node
// 生成一条资源 YAML 片段（输出到 stdout，供人工确认后追加到 data/<分类>.yaml）。
// 用法：node make-entry.mjs --data '<json>'
// JSON 字段：id,title,category,tags,quark_url,description,date,added,image（可选：baidu_url,baidu_pwd）
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './lib/config.mjs';
import { posterDir } from './lib/site-paths.mjs';

const i = process.argv.indexOf('--data');
if (i < 0) throw new Error('用法：node make-entry.mjs --data \'<json>\'');
const d = JSON.parse(process.argv[i + 1]);

const REQUIRED = ['id', 'title', 'category', 'tags', 'quark_url', 'description', 'date', 'added'];
const miss = REQUIRED.filter((k) => d[k] === undefined || d[k] === '');
if (miss.length) throw new Error(`缺少字段：${miss.join(', ')}`);
// 分类目录 → id 前缀：04电影 mv / 03电视剧 tv / 06纪录片 dc / 05动漫 an / 01游戏 game / 02应用 app / 08电子书 bk / 010其他 ot / 07课程 cs
// 2026-11-10：「操作系统」已并入「软件」，`操作系统` 不再是一个合法 category，也**绝不允许**再写 data/os.yaml
// （站点 config/site.yaml 已删该分类，但 build 会把数据里出现的未知分类照样排进来，等于复活 /category/os/，
//  而线上 nginx 正把它 301 到 /category/software/ —— sitemap 指向 301 地址是收录事故）。
// 系统镜像类资源：category 用「软件」、id 用 app- 前缀；tags 首项仍可写「操作系统」（站内标签页在用）。
const CATS = {
  电影: { prefix: 'mv', file: 'movie.yaml' },
  电视剧: { prefix: 'tv', file: 'tv.yaml' },
  纪录片: { prefix: 'dc', file: 'documentary.yaml' },
  动漫: { prefix: 'an', file: 'anime.yaml' },
  游戏: { prefix: 'game', file: 'game.yaml' },
  软件: { prefix: 'app', file: 'software.yaml' },
  电子书: { prefix: 'bk', file: 'ebook.yaml' },
  其他: { prefix: 'ot', file: 'misc.yaml' },
  课程: { prefix: 'cs', file: 'course.yaml' },
};
const cat = CATS[d.category];
if (!cat) throw new Error(`category 只能是 ${Object.keys(CATS).join(' / ')}：${d.category}`);
if (!new RegExp(`^(${Object.values(CATS).map((c) => c.prefix).join('|')})-\\d{3}$`).test(d.id))
  throw new Error(`id 格式应为 <前缀>-001，前缀 ${Object.values(CATS).map((c) => c.prefix).join('/')}，当前：${d.id}`);
if (!d.id.startsWith(`${cat.prefix}-`))
  throw new Error(`id 前缀与分类不匹配：「${d.category}」应写作 ${cat.prefix}-xxx，当前：${d.id}`);
if (!Array.isArray(d.tags) || !d.tags.length) throw new Error('tags 必须是非空数组');
// 标题副标口径（2026-11-20 更新：绝对化禁词校验已按指挥官要求移除）。游戏/软件/电子书/课程/其他
// 必须写「原名 - 客观功能描述」；影视片名保持精确（TMDB 剧名检索/季号识别依赖）。
const SUBTITLE_CATS = new Set(['游戏', '软件', '电子书', '课程', '其他']);
const HAS_SUBTITLE_RE = /\s-\s|:\s|：|\(|（|•|—|\s·\s/;
// 长标题豁免，与仓库 scripts/lib/data.js 的 isLongTitle 同口径：中文≥10字 或 任意字符总长≥18。
// 指挥官口径：电影/电视剧/动漫不用副标（不在 SUBTITLE_CATS），主标题已很长也可不用副标。
const isLongTitle = (t) => {
  const s = String(t || '');
  return (/[\u4e00-\u9fff]/.test(s) && [...s].length >= 10) || [...s].length >= 18;
};
if (SUBTITLE_CATS.has(d.category)) {
  if (!HAS_SUBTITLE_RE.test(d.title) && !isLongTitle(d.title))
    throw new Error(`「${d.category}」标题必须写「原名 - 客观功能描述」副标（8~12字，从 description/tags 提炼），当前：${d.title}`);
  if ([...d.title].length > 48) throw new Error(`标题超过 48 字：${d.title}`);
}
if (!/^https:\/\/pan\.quark\.cn\/s\/[a-z0-9]+$/.test(d.quark_url)) throw new Error(`quark_url 不合法：${d.quark_url}`);
// 百度分享链接可选（2026-11-04 起：镜像成功的目录当场出永久链接，随条目一起入库）
if (d.baidu_url !== undefined && d.baidu_url !== null && d.baidu_url !== '' && !/^https:\/\/pan\.baidu\.com\/s\//.test(d.baidu_url))
  throw new Error(`baidu_url 不合法：${d.baidu_url}`);
if (d.baidu_pwd !== undefined && d.baidu_pwd !== null && d.baidu_pwd !== '' && !/^[A-Za-z0-9]{3,8}$/.test(d.baidu_pwd))
  throw new Error(`baidu_pwd 不合法：${d.baidu_pwd}`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// added 可带入库时刻（同一天入库的多条按先后排序，后加的排最前），站点 scripts/lib/data.js 已支持
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
if (!DATE_RE.test(d.date)) throw new Error('date 必须是 YYYY-MM-DD');
if (!DATE_RE.test(d.added) && !DATETIME_RE.test(d.added))
  throw new Error('added 必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:mm');

const img = d.image ? path.join(posterDir(cfg.REPO, d.id), d.image) : null;
if (img && !fs.existsSync(img)) console.error(`⚠ 海报不存在：${img}（先用 tmdb.mjs --poster 下载）`);

const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const tags = `[${d.tags.map(q).join(', ')}]`;

console.log(
  [
    '',
    `- id: ${d.id}`,
    `  title: ${q(d.title)}`,
    `  category: ${d.category}`,
    `  tags: ${tags}`,
    `  quark_url: ${q(d.quark_url)}`,
    ...(d.baidu_url ? [`  baidu_url: ${q(d.baidu_url)}`] : []),
    ...(d.baidu_pwd ? [`  baidu_pwd: ${q(d.baidu_pwd)}`] : []),
    `  description: ${q(d.description)}`,
    `  date: ${d.date}`,
    `  added: ${DATETIME_RE.test(d.added) ? q(d.added) : d.added}`,
    ...(d.image ? [`  image: ${d.image}`] : []),
    '',
  ].join('\n')
);
