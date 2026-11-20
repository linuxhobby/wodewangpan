import fs from 'node:fs';
import readline from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 分类 → data 文件映射与副标口径收口在 lib/data.js（fill-title.mjs 同源），勿另抄
import { CATEGORY_FILES, SUBTITLE_CATS, HAS_SUBTITLE_RE, isLongTitle, todayShanghai } from '../scripts/lib/data.js';

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

// 数据文件统一用英文/缩写命名（中文文件名在命令行、Git 与部分工具里容易变成转义串）。
// 分类 → data/<file>.yaml 的映射（CATEGORY_FILES）与副标口径（SUBTITLE_CATS）收口在 lib/data.js，
// 未列出的分类按同名文件落到 data/<分类>.yaml
const category = await get('分类', '电影');
// 反查：输入的是文件名或英文缩写时也能落到已存在的文件
const known = Object.entries(CATEGORY_FILES).find(
  ([cn, en]) => category === cn || String(category).toLowerCase() === en
);
const categoryCn = known ? known[0] : category;
const base = known ? known[1] : category.replace(/[\\/]/g, '-');
const file = path.join(root, 'data', `${base}.yaml`);

// 副标从简介/标签里提炼，脚本不替人编造；入库时就按 fill-title.mjs 的同一套标准把关，
// 写进来的标题直接是终态，省掉后续批量补副标。长标题（本身自解释）豁免：
// 电影/电视剧/动漫不适用副标（SUBTITLE_CATS 不含）；主标题已很长也可不用（isLongTitle）。
let fullTitle = title;
if (SUBTITLE_CATS.has(categoryCn) && !HAS_SUBTITLE_RE.test(title) && !isLongTitle(title)) {
  for (;;) {
    const subtitle = await get('副标（客观功能描述，留空则保持原名）');
    if (!subtitle) {
      console.log('提示：工具/资料类建议写「原名 - 客观功能描述」。');
      break;
    }
    if ([...`${title} - ${subtitle}`].length > 48) {
      console.log('标题合计超过 48 字，副标建议 8~12 字');
      continue;
    }
    fullTitle = `${title} - ${subtitle}`;
    break;
  }
}

const tags = await get('标签（逗号分隔）');
const quark = await get('夸克链接');
const baidu = await get('百度链接');
const code = baidu ? await get('百度提取码') : '';
const guangya = await get('光鸭链接');
const description = await get('一句话介绍');
const date = await get('日期', todayShanghai());
const id = await get('ID（对应配图文件名，留空自动生成）');

const entry = [`- title: "${fullTitle.replace(/"/g, '\\"')}"`];
if (id) entry.push(`  id: ${id}`);
entry.push(`  category: "${category}"`);
if (tags) entry.push(`  tags: [${tags.split(/[,，]/).map((t) => t.trim()).join(', ')}]`);
if (quark) entry.push(`  quark_url: "${quark}"`);
if (baidu) entry.push(`  baidu_url: "${baidu}"`);
if (code) entry.push(`  baidu_pwd: "${code}"`);
if (guangya) entry.push(`  guangya_url: "${guangya}"`);
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
