#!/usr/bin/env node
// 只读盘点：电视剧 / 动漫里，哪些盘端目录还在更新、哪些已经定格。
//
// 不需要任何标记字段，也不需要人工维护：判定来自「最近一次真实内容变化日」
// （updated，没有则退回 added）。满 60 天没变化自动降为低频复查，不算完结。
// 本工具只读，不写 data/、不写任何状态文件。
//
//   node tools/list-ongoing.mjs          # 只看活跃（会被每轮轮询的）条目
//   node tools/list-ongoing.mjs --all    # 连同已定格、死链条目一起列出

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERIAL_FILES, IDLE_DAYS, parseSerialFile, itemState } from './lib/serials.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const showAll = process.argv.includes('--all');

const totals = { active: 0, settled: 0, dead: 0 };
console.log(`连载盘点 · ${today} · 静止 ${IDLE_DAYS} 天降为低频复查\n`);

for (const name of SERIAL_FILES) {
  const file = path.join(root, 'data', name);
  if (!fs.existsSync(file)) continue;
  const items = parseSerialFile(file);
  const groups = { active: [], settled: [], dead: [] };
  for (const it of items) {
    if (it.dead) { groups.dead.push(it); continue; }
    const st = itemState(it, today);
    groups[st.kind].push({ ...it, ...st });
  }
  for (const k of Object.keys(totals)) totals[k] += groups[k].length;

  console.log(`${name}  活跃 ${groups.active.length} · 已定格 ${groups.settled.length} · 死链 ${groups.dead.length}`);
  for (const it of groups.active) {
    console.log(`  [活跃]   ${it.id.padEnd(9)} ${(it.updated || it.added || '—').padEnd(12)} ${it.days} 天前  ${it.title}`);
  }
  if (showAll) {
    for (const it of groups.settled) {
      console.log(`  [定格]   ${it.id.padEnd(9)} ${(it.updated || it.added || '—').padEnd(12)} ${it.days} 天前  ${it.title}`);
    }
    for (const it of groups.dead) {
      console.log(`  [死链]   ${it.id.padEnd(9)} ${'—'.padEnd(12)} —      ${it.title}`);
    }
  }
  console.log('');
}

const roundDays = totals.active ? ((totals.active * 2) / 24).toFixed(1) : '0';
console.log(
  `合计：活跃 ${totals.active} 条（每 2 小时轮询 1 条，约 ${roundDays} 天覆盖一轮）· ` +
  `已定格 ${totals.settled} 条（每 10 轮抽查 1 条）· 死链 ${totals.dead} 条（不轮询）`
);
console.log('盘端目录有变化才重写文件清单并写 updated；没变化一个字都不写。无需手工标记完结。');
