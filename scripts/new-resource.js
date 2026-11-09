import fs from 'node:fs';
import readline from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = '') => rl.question(`${q}${def ? `（默认 ${def}）` : ''}：`);

const get = async (q, def = '') => (await ask(q, def)).trim() || def;

console.log('新增资源（直接回车留空即可）\n');
const title = await get('标题');
if (!title) {
  console.log('标题不能为空');
  rl.close();
  process.exit(1);
}

// 数据文件统一用英文/缩写命名（中文文件名在命令行、Git 与部分工具里容易变成转义串）
// 分类 → data/<file>.yaml；未列出的分类按同名文件落到 data/<分类>.yaml
const DATA_FILE = {
  电影: 'movie',
  电视剧: 'tv',
  纪录片: 'documentary',
  动漫: 'anime',
  游戏: 'game',
  软件: 'software',
  电子书: 'ebook',
  课程: 'course',
  其他: 'misc',
};

const category = await get('分类', '影视');
// 反查：输入的是文件名或英文缩写时也能落到已存在的文件
const known = Object.entries(DATA_FILE).find(
  ([cn, en]) => category === cn || String(category).toLowerCase() === en
);
const base = known ? known[1] : category.replace(/[\\/]/g, '-');
const file = path.join(root, 'data', `${base}.yaml`);
const tags = await get('标签（逗号分隔）');
const quark = await get('夸克链接');
const baidu = await get('百度链接');
const code = baidu ? await get('百度提取码') : '';
const description = await get('一句话介绍');
const date = await get('日期', new Date().toISOString().slice(0, 10));
const id = await get('ID（对应配图文件名，留空自动生成）');

const entry = [`- title: "${title.replace(/"/g, '\\"')}"`];
if (id) entry.push(`  id: ${id}`);
entry.push(`  category: "${category}"`);
if (tags) entry.push(`  tags: [${tags.split(/[,，]/).map((t) => t.trim()).join(', ')}]`);
if (quark) entry.push(`  quark_url: "${quark}"`);
if (baidu) entry.push(`  baidu_url: "${baidu}"`);
if (code) entry.push(`  baidu_pwd: "${code}"`);
if (description) entry.push(`  description: "${description.replace(/"/g, '\\"')}"`);
entry.push(`  date: ${date}`);
// 文件清单模板（注释形态）：从夸克网盘目录抄真实数据，字段全可留空；有独有数据才有收录竞争力
entry.push(
  [
    `  # 最近校验日（复核链接 / 补内容的当天日期，sitemap lastmod 会真实更新）：`,
    `  # updated: ${date}`,
    `  # 文件清单（可选，全字段可留空，有什么写什么）：`,
    `  # files:`,
    `  #   count: 42              # 文件总数`,
    `  #   episodes: 第 1-24 集    # 季/集数（剧集、动漫用）`,
    `  #   size: 18.6 GB          # 总大小`,
    `  #   format: MP4 / MKV      # 格式`,
    `  #   resolution: 1080p      # 分辨率 / 画质`,
    `  #   audio: 国语 AAC 2.0     # 音轨`,
    `  #   subtitle: 内封简繁中字   # 字幕`,
    `  #   packed: false          # true=压缩包需解压 / false=散装`,
    `  #   tree: |                # 目录结构（可选，最多 40 行）`,
    `  #     资源名/`,
    `  #     ├─ E01.mp4`,
    `  #     └─ E02.mp4`,
  ].join('\n')
);

if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${category} 资源\n`);
fs.appendFileSync(file, `\n${entry.join('\n')}\n`);
console.log(`\n已写入 ${path.relative(root, file)}，运行 npm run build 生成页面`);
rl.close();
