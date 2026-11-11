#!/usr/bin/env node
// sort-trees：把 data/*.yaml 里已有的 files.tree 按 scripts/lib/tree-sort.mjs 的规则重排成有序清单。
//
// 为什么单独一个工具：fill-files 只给「还没有 files: 块」的条目写清单，已有清单的条目它不碰，
// 所以历史上抓下来的 67 条 tree 仍是夸克接口的内部顺序（乱序）。这个工具负责回填那批存量。
//
// 改动边界（重要）：
//   · 只重排 tree: | 块内的行序，count / size / format / packed 一个都不动；
//   · 绝不写 updated —— 行序变化不是内容变化，给它盖当天日期等于伪造 lastmod（AGENTS.md §5 第一红线）；
//   · 逐行保留原行尾（data/*.yaml 是 CRLF 为主夹少量裸 LF），新增位置沿用原第 k 行的行尾；
//   · 幂等：排好的条目第二次跑不会产生任何 diff。
//
// 用法：
//   node scripts/sort-trees.mjs --dry-run   # 只报告哪些条目要重排，不写盘
//   node scripts/sort-trees.mjs             # 实际写入

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortTree } from './lib/tree-sort.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const dryRun = process.argv.includes('--dry-run');

const INDENT = '      ';
const bodyOf = (line) => line.slice(INDENT.length);

let changedEntries = 0;
let changedFiles = 0;
let warned = 0;

for (const name of fs.readdirSync(dataDir).filter((f) => f.endsWith('.yaml'))) {
  const file = path.join(dataDir, name);
  const raw = fs.readFileSync(file, 'utf8');
  const parts = raw.split(/(\r\n|\r|\n)/);
  const lines = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push({ s: parts[i], e: i + 1 < parts.length ? parts[i + 1] : '' });
  }

  let touched = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^ {4}tree: \|$/.test(lines[i].s)) continue;
    let j = i + 1;
    while (j < lines.length && new RegExp(`^${INDENT}\\S`).test(lines[j].s)) j++;
    const block = lines.slice(i + 1, j);
    if (!block.length) {
      i = j - 1;
      continue;
    }
    const before = block.map((l) => bodyOf(l.s));
    const after = sortTree(before);
    if (after.length !== before.length) {
      // 原清单里有重名行：去重会静默删行，超出「只排行序」的边界，交给人工判断
      console.log(`! ${name} 第 ${i + 2} 行 tree 存在重名（${before.length}→${after.length}），本条跳过`);
      warned++;
      i = j - 1;
      continue;
    }
    if (after.every((n, k) => n === before[k])) {
      i = j - 1;
      continue;
    }
    after.forEach((n, k) => {
      lines[i + 1 + k] = { s: INDENT + n, e: block[k].e };
    });
    touched++;
    changedEntries++;
    i = j - 1;
  }

  if (touched) {
    changedFiles++;
    if (!dryRun) fs.writeFileSync(file, lines.map((l) => l.s + l.e).join(''));
    console.log(`${dryRun ? '[dry] ' : ''}${name}: 重排 ${touched} 条`);
  }
}

console.log(
  `\n${dryRun ? '试跑（未写盘）' : '已写入'}：重排 ${changedEntries} 条 tree · 涉及 ${changedFiles} 个文件` +
    (warned ? ` · ${warned} 条因重名跳过（需人工）` : '')
);
