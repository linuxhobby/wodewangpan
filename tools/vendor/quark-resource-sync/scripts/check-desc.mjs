#!/usr/bin/env node
// 检查 data/*.yaml 里各条简介的正文长度（SKILL 要求：正文 ≥ 150 字，2026-11-12 起从 200 下调）。
// 统计前先剥掉正文前的【第 N 季 · 共 M 集】这类方括号标签，以及结尾 ｜TMDB 评分 / ｜作者 / ｜开发者。
// 只读不写，用来在入库前自查，或导出存量待改写清单。
//
// 用法：
//   node check-desc.mjs                          # 列出全部条目里正文不足 150 字的
//   node check-desc.mjs --min 500                # 换个下限
//   node check-desc.mjs --file movie.yaml          # 只看某一份数据（可多次）
//   node check-desc.mjs --only mv-240,tv-070     # 只看指定 id
//   node check-desc.mjs --show                   # 连同正文一起打印，方便直接改写
//   node check-desc.mjs --draft <路径>            # 导出 { "id": "现有正文" } 骨架，交给 scripts/fill-desc.mjs
//                                                #（目标文件已存在时会拒绝写，加 --force 覆盖）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cfg } from './lib/config.mjs';

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const argsOf = (k) =>
  process.argv.reduce((acc, v, i) => (v === `--${k}` && process.argv[i + 1] ? acc.concat(process.argv[i + 1].split(',')) : acc), []);
const flag = (k) => process.argv.includes(`--${k}`);

const REPO = arg('repo') || cfg.REPO;
if (!REPO || !fs.existsSync(REPO)) {
  console.error(`找不到站点仓库：${REPO || '(未配置)'}。用 --repo <路径> 指定，或在 config.env 里填 REPO。`);
  process.exit(1);
}

const require = createRequire(path.join(REPO, 'noop.js'));
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  console.error(`仓库里没装 js-yaml：${REPO}。先在仓库目录跑 npm install。`);
  process.exit(1);
}

const MIN = Number(arg('min') || 150);
const files = argsOf('file');
const only = argsOf('only').map((s) => s.trim()).filter(Boolean);
const show = flag('show');
const draft = arg('draft');
const force = flag('force');

const dataDir = path.join(REPO, 'data');
const list = (files.length ? files : fs.readdirSync(dataDir).filter((f) => f.endsWith('.yaml'))).filter(
  (f) => f !== 'site.yaml'
);

/**
 * 剥离【…】标签与结尾 ｜… 尾巴，剩下的才算「正文」。
 * 口径必须与仓库 scripts/fill-desc.mjs、scripts/list-short-desc.mjs 里的 bodyLen 完全一致
 * （README「SKILL 变更」要求：改一处就要同步另一处，否则同一条目两边报出不同字数）。
 */
const bodyOf = (desc) =>
  String(desc || '')
    .replace(/【[^】]*】/g, '')
    .replace(/｜[^｜]{1,40}\s*$/, '')
    .trim();

let total = 0;
let short = 0;
const rows = [];

for (const f of list) {
  const p = path.join(dataDir, f);
  if (!fs.existsSync(p)) {
    console.error(`跳过（文件不存在）：${f}`);
    continue;
  }
  const rows_ = yaml.load(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(rows_)) continue;
  for (const it of rows_) {
    if (!it || !it.id) continue;
    if (only.length && !only.includes(String(it.id))) continue;
    total++;
    const body = bodyOf(it.description);
    const n = [...body].length;
    if (n < MIN) {
      short++;
      rows.push({ f, id: String(it.id), n, title: it.title || '', body });
    }
  }
}

for (const r of rows) {
  console.log(`${r.f}\t${r.id}\t${r.n}字\t${r.title}`);
  if (show) console.log(`  ${r.body}\n`);
}

console.log(`\n共检查 ${total} 条，正文不足 ${MIN} 字的有 ${short} 条${rows.length ? '：' : '，全部达标。'}`);
if (rows.length && !show) console.log('（加 --show 可连同正文一起打印，方便逐条改写）');

if (draft) {
  if (fs.existsSync(draft) && !force) {
    console.error(`\n目标文件已存在，拒绝覆盖（加 --force 强制写）：${draft}`);
    process.exit(1);
  }
  const obj = {};
  for (const r of rows) obj[r.id] = r.body;
  fs.mkdirSync(path.dirname(draft), { recursive: true });
  fs.writeFileSync(draft, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  console.log(`草稿骨架已写入 ${draft}（${rows.length} 条，` +
    '改写完直接跑 node scripts/fill-desc.mjs --apply）');
}
