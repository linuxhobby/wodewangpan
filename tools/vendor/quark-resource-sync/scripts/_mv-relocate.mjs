import fs from 'node:fs';
import path from 'node:path';
import { upsertEntry, ENTRY_RE } from './lib/yaml-store.mjs';
import { cfg } from './lib/config.mjs';

const REPO = cfg.REPO;
const movieFile = path.join(REPO, 'data', 'movie.yaml');
const tvFile = path.join(REPO, 'data', 'tv.yaml');

// ── 1) 追加 mv-454 ──
const block = [
  '- id: mv-454',
  '  title: "盗墓大案"',
  '  category: 电影',
  '  tags: ["电影", "剧情", "犯罪", "悬疑", "盗墓大案"]',
  '  quark_url: "https://pan.quark.cn/s/26844fae5fc7"',
  '  description: "公安干警李方中、铁鹤等人紧盯盗墓团伙，与团伙头目\u201c老祖\u201d斗智斗勇。风水秘术盗掘千年古墓，国宝玉猪龙离奇失踪，儒雅古玩老板的真实身份逐渐浮出水面\u2014\u2014他是生意人，还是嗜血盗墓魁首？黑吃黑，局中局，内讧绑架接连上演，刑警队步步为营，最终将其擒获、把盗墓团伙一网打尽，追回并保护了国宝与文物。本片由崔景宣、王晰、董海战联合执导，李丞峰、徐光宇、石兆琪等主演，2026 年 3 月 31 日多平台上线，片长 90 分钟，类型横跨剧情、悬疑、犯罪与警匪，以古墓盗掘案件为线索展开一场智力与胆识的较量。"',
  '  date: 2026-03-31',
  '  added: 2026-11-14',
  '  image: mv-454.jpg',
  '  updated: 2026-11-14',
  '  files:',
  '    count: 1',
  '    size: "2.6 GB"',
  '    format: "MKV"',
  '    tree: |',
  '      454-盗墓大案 (2026)/',
  '      [盗墓大案].Grave.Robbers.2026.2160p.IQ.WEB-DL.H265.AAC-UBWEB.mkv',
].join('\n');

const r1 = upsertEntry(movieFile, 'mv-454', block);
console.log('movie.yaml:', r1.mode, `${r1.before} → ${r1.after}`);

// ── 2) 从 tv.yaml 删除 tv-148 ──
const raw = fs.readFileSync(tvFile, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const start = lines.findIndex((l) => l.trim() === '- id: tv-148');
if (start < 0) throw new Error('tv-148 not found in tv.yaml');
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) if (ENTRY_RE.test(lines[i])) { end = i; break; }
// 回退吸收紧邻条目前的空行分隔
let from = start;
while (from > 0 && !lines[from - 1].trim()) from--;
lines.splice(from, end - from);
const before = raw.split(/\r?\n/).filter((l) => ENTRY_RE.test(l)).length;
const after = lines.filter((l) => ENTRY_RE.test(l)).length;
if (after !== before - 1) throw new Error(`tv 删除条目数异常 ${before}→${after}`);
if (/^#\s.*（\d+ 条）/.test(lines[0])) lines[0] = lines[0].replace(/（\d+ 条）/, `（${after} 条）`);
// 去尾部多余空行，保留单结尾换行
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
lines.push('');
fs.writeFileSync(tvFile, lines.join(eol));
console.log('tv.yaml: removed tv-148', `${before} → ${after}`);
