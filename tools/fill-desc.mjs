/**
 * 把草稿里的简介写回 YAML（第三项 SEO 待办：补厚过短简介）。
 *
 * 用法：
 *   node tools/fill-desc.mjs                                  # 空跑，只打印将要改成什么
 *   node tools/fill-desc.mjs --apply                          # 真正写入 data/*.yaml
 *   node tools/fill-desc.mjs --draft=.tmp/desc-draft-tv.json  # 指定别的草稿文件
 *
 * 输入：.tmp/desc-draft.json，形如 { "mv-212": "新简介正文", ... }
 * 行为：
 *   1. 保留原简介里的「｜TMDB x.x」评分后缀，写在新正文之后；
 *   2. 按 `- id: xxx` 定位条目块，只改该块的 description 一行，其余内容一字不动；
 *   3. 以 JSON 双引号标量写回，中文、引号、换行都不会破坏 YAML 结构。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResources, bodyLength, MIN_DESC } from '../scripts/lib/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const strict = process.argv.includes('--strict');
/**
 * 正文下限，默认取 data.js 的 MIN_DESC——标准只在那儿定义一处。
 * 字数也直接用 data.js 的 bodyLength，不再本地另写一份：
 * 以前这里只剥开头的【…】且限 30 字，构建那边是全剥，同一个简介在两边字数
 * 会差出几个字，结果就是脚本说「够了」、构建还在告警。
 */
const MIN = Number((process.argv.find((a) => a.startsWith('--min=')) || '').split('=')[1]) || MIN_DESC;
/** 草稿路径默认 .tmp/desc-draft.json；加 --draft=xxx 可换，便于多批并行互不覆盖 */
const draftArg = (process.argv.find((a) => a.startsWith('--draft=')) || '').split('=')[1];
const draftPath = path.join(root, draftArg || '.tmp/desc-draft.json');

if (!fs.existsSync(draftPath)) {
  console.error('找不到 .tmp/desc-draft.json');
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

/** 找出每个 id 属于哪个 YAML 文件，避免全目录 grep */
const files = fs.readdirSync(path.join(root, 'data')).filter((f) => f.endsWith('.yaml'));
const idToFile = new Map();
for (const f of files) {
  const text = fs.readFileSync(path.join(root, `data/${f}`), 'utf8');
  for (const m of text.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gm)) idToFile.set(m[1], f);
}

const missing = [];
const tooShort = [];
let changed = 0;
const touched = new Map();

for (const [id, body] of Object.entries(draft)) {
  const file = idToFile.get(id);
  if (!file) {
    missing.push(id);
    continue;
  }
  const full = path.join(root, `data/${file}`);
  let text = fs.readFileSync(full, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  let cur = null;
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const idHit = lines[i].match(/^\s*-\s+id:\s*(\S+)\s*$/);
    if (idHit) cur = idHit[1];
    if (cur !== id) continue;
    const m = lines[i].match(/^(\s*)description:\s*(.*)$/);
    if (!m) continue;

    /** 先剥掉 YAML 双引号标量的外层引号，才看得到末尾的署名后缀 */
    const raw = m[2].trim();
    const inner = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    /**
     * 电视剧条目的开头带着「【第 1 季 · 共 12 集】」这样的标记，
     * 而 YAML 里没有独立的季 / 集字段，这是唯一载体，重写时必须接回去。
     */
    const head = inner.match(/^【[^】]{1,30}】/);
    const text = head && !body.trim().startsWith('【') ? head[0] + body : body;
    /**
     * 结尾的 ｜后缀同样跟着走：既有「｜TMDB 7.5」这样的评分，
     * 也有「｜Apple」「｜作者：[美] 斯蒂芬·金」这类厂商 / 作者署名，
     * 都是数据来源的痕迹，不该重写一次就丢掉。
     */
    const score = inner.match(/｜[^｜]{1,40}$/);
    const next = score && !text.includes(score[0]) ? `${text}${score[0]}` : text;
    const after = `${m[1]}description: ${JSON.stringify(next)}`;

    if (after === lines[i]) {
      done = true;
      break;
    }

    const shortfall = bodyLength(next) < MIN;
    if (shortfall) tooShort.push(id);
    // --strict：不足下限的直接跳过，不碰 YAML、不计入改动数
    if (strict && shortfall) {
      done = true;
      break;
    }
    if (apply) lines[i] = after;
    touched.set(file, (touched.get(file) || []).concat({ id, before: inner, after: next }));
    changed++;
    done = true;
    break;
  }
  if (!done) missing.push(`${id}（没找到 description 行）`);
  if (apply) fs.writeFileSync(full, lines.join(eol));
}

// 报告
for (const [file, list] of touched) {
  console.log(`\n== data/${file}（${list.length} 条）`);
  for (const { id, before, after } of list) {
    console.log(`\n  ${id}`);
    console.log(`  - ${before.slice(0, 60)}`);
    console.log(`  + ${after.slice(0, 60)}…（正文 ${bodyLength(after)} 字）`);
  }
}

if (missing.length) console.log(`\n! 未处理：${missing.join('、')}`);
if (tooShort.length) {
  console.log(`\n! 正文不足 ${MIN} 字${strict ? '（已跳过，未写入）' : '（仍会写入，加 --strict 可拦住）'}：${tooShort.join('、')}`);
} else if (changed) {
  console.log(`\n正文全部达到 ${MIN} 字`);
}
console.log(`\n${apply ? `已写入 ${changed} 条` : `空跑：将修改 ${changed} 条（加 --apply 才写入）`}`);

if (apply) {
  // 回读一遍：YAML 一旦被写坏，这里会直接抛出来
  try {
    const list = loadResources(path.join(root, 'data'));
    const still = list.filter((it) => bodyLength(it.description) < MIN);
    console.log(`回读校验：YAML 正常，载入 ${list.length} 条，其中正文仍不足 ${MIN} 字的有 ${still.length} 条`);
  } catch (e) {
    console.log(`! 回读失败，请检查 data/*.yaml：${e.message}`);
  }
}
