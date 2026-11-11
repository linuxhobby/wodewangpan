#!/usr/bin/env node
/**
 * 导出「全部资源」Markdown 清单：按站点分类顺序分组，逐条列出资源名称与网盘分享链接。
 * 复用 scripts/lib/data.js 的解析、链接提取与排序口径，保证与站点 /all/ 是同一份数据、同一顺序。
 * 用法：node scripts/export-all-resources.mjs [--out <路径>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSite,
  loadResources,
  normalizeResources,
  orderCategories,
  todayShanghai,
} from './lib/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile =
  outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.join(ROOT, 'exports', '全部资源.md');

const SITE_URL = 'https://www.wodewangpan.top';
/** 文档页首的 Telegram 群入口（只写进文档，不动站点） */
const TG_GROUP = {
  url: 'https://t.me/wodewangpantop',
  text: 't.me/wodewangpantop',
  note: '群内有资源查询机器人（`/s 关键词`），新资源同步在群里发',
};
const LINK_LABELS = {
  quark: '夸克',
  baidu: '百度',
  aliyun: '阿里云盘',
  tianyi: '天翼云盘',
  uc: 'UC 网盘',
  xunlei: '迅雷网盘',
  '115': '115 网盘',
  mobile: '移动云盘',
};

/** 表格单元格：压掉换行、转义竖线，避免标题里的 | 把表格拆列 */
function cell(text) {
  return String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function linkCell(links) {
  if (!links.length) return '—';
  return links
    .map((link) => {
      const label = LINK_LABELS[link.kind] || link.name || '网盘';
      const code = link.code ? `（提取码 ${cell(link.code)}）` : '';
      return `[${cell(label)}](<${String(link.url).trim()}>)${code}`;
    })
    .join(' · ');
}

const site = loadSite(path.join(ROOT, 'config'));
const { items, counts } = normalizeResources(loadResources(path.join(ROOT, 'data')));
const categories = orderCategories(site, counts);

const groups = new Map(categories.map((name) => [name, []]));
for (const item of items) {
  if (!groups.has(item.category)) groups.set(item.category, []);
  groups.get(item.category).push(item);
}

const lines = [
  '# 全部资源',
  '',
  `> **Telegram 群组**：[${TG_GROUP.text}](${TG_GROUP.url}) · ${TG_GROUP.note}`,
  '',
  `> ${SITE_URL} · 网盘资源总清单`,
  '',
  `- 数据来源：\`data/*.yaml\`（与站点同一份数据，顺序按入库时间倒序）`,
  `- 生成日期：${todayShanghai()}`,
  `- 合计：**${items.length} 个资源 · ${groups.size} 个分类**`,
  '- 链接说明：点击「夸克 / 百度」打开对应分享链接；夸克链接无需提取码，百度链接后标注提取码。',
  '- 已人工核验失效的资源仍在清单里，名称后标「（已失效）」；实际可用性以站点为准。',
  '',
  '## 分类目录',
  '',
  '| 分类 | 资源数 |',
  '| --- | ---: |',
];

for (const [name, group] of groups) {
  lines.push(`| [${cell(name)}](#${cell(name)}) | ${group.length} |`);
}

for (const [name, group] of groups) {
  lines.push('', `## ${cell(name)}`, '', `共 ${group.length} 个资源`, '', '| # | 资源名称 | 网盘分享链接 |', '| ---: | --- | --- |');
  group.forEach((item, index) => {
    const title = cell(item.title) + (item.dead ? '（已失效）' : '');
    lines.push(`| ${index + 1} | ${title} | ${linkCell(item.links)} |`);
  });
}

lines.push('', '---', '', `本清单由 \`scripts/export-all-resources.mjs\` 生成，请勿手工编辑；最新数据以 ${SITE_URL} 为准。`, '');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(`已生成 ${path.relative(ROOT, outFile)}：${items.length} 个资源 / ${groups.size} 个分类`);
