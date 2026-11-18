#!/usr/bin/env node
// 补齐存量资源的简介：早期同步时 TMDB 简介被截到 95 字，这里重新抓完整简介写回 data/*.yaml。
// 只在新简介比原简介长时写入，评分后缀（｜TMDB 7.6）保留原值。
// 用法：
//   node backfill-desc.mjs --dry --limit 5        # 预览前 5 条，不写文件
//   node backfill-desc.mjs --only-truncated       # 只处理简介被截断（以 … 结尾）的条目
//   node backfill-desc.mjs                        # 全量写入（先自动备份到 /tmp/backfill-backup-*）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cfg, requireCfg, TMP } from './lib/config.mjs';

const { TMDB_TOKEN, PROXY } = cfg;
requireCfg(['TMDB_TOKEN', 'REPO']);
const REPO = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : cfg.REPO;
const DRY = process.argv.includes('--dry');
const ONLY_TRUNCATED = process.argv.includes('--only-truncated');
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
const MAX = 700; // 写入上限（2026-11-12 从 1200 下调），与 process-batch.mjs / lib/desc.mjs 的 DESC_MAX 保持一致
const CONC = Number(process.env.CONC || 8); // 并发请求数（并发过高易被代理限流，失败时可 CONC=3 重试）

const require = createRequire(path.join(REPO, 'package.json'));
const yaml = require('js-yaml');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const curl = (url) =>
  new Promise((res, rej) => {
    // -m 15：代理偶发挂起时必须超时，否则整个脚本会静默卡死
    const args = ['-s', '-m', '25', ...(PROXY ? ['-x', PROXY] : []), '-H', `Authorization: Bearer ${TMDB_TOKEN}`, url];
    execFile('curl', args, { maxBuffer: 32e6 }, (e, s) => (e ? rej(e) : res(s)));
  });

const get = async (url) => {
  const s = await curl(url);
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`TMDB 返回异常（代理是否可用？）：${s.slice(0, 120)}`);
  }
};

const typeOf = { 电影: 'movie', 电视剧: 'tv', 纪录片: 'tv', 动漫: 'tv' };
const FILES = ['movie.yaml', 'tv.yaml', 'documentary.yaml', 'anime.yaml'];

// 搜索并挑出年份吻合的那一条
async function findOverview(title, type, year) {
  const q = encodeURIComponent(title);
  // 走官方域名 api.tmdb.org（api.themoviedb.org 在本机可能被 DNS 劫持，见 SKILL.md）
  const j = await get(
    `https://api.tmdb.org/3/search/${type}?query=${q}&language=zh-CN&include_adult=false${year ? `&year=${year}` : ''}`
  );
  let rows = j.results || [];
  if (!rows.length && year) {
    const j2 = await get(`https://api.tmdb.org/3/search/${type}?query=${q}&language=zh-CN&include_adult=false`);
    rows = j2.results || [];
  }
  if (!rows.length) return { err: '无搜索结果' };
  const yOf = (r) => Number((r.release_date || r.first_air_date || '').slice(0, 4)) || 0;
  let hit = rows[0];
  if (year) {
    const exact = rows.find((r) => Math.abs(yOf(r) - year) <= 1);
    if (exact) hit = exact;
    else if (Math.abs(yOf(hit) - year) > 1) return { err: `年份不符（库内 ${year} vs TMDB ${yOf(hit)} ${hit.title || hit.name}）` };
  }
  const overview = (hit.overview || '').replace(/\s+/g, ' ').trim();
  if (!overview) return { err: 'TMDB 无中文简介' };
  return { overview: overview.length > MAX ? overview.slice(0, MAX) + '…' : overview, vote: Number(hit.vote_average || 0).toFixed(1) };
}

// 只替换指定 id 条目块里的 description，保持文件其余内容原样。
// 存量里存在「多行标量」写法的 description（人工编辑时真换行），必须整块替换，否则残留续行会破坏 YAML。
function replaceDesc(text, id, newDesc) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*['"]?${id}['"]?\\s*$`).test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+id:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  for (let i = start; i < end; i++) {
    if (/^\s{2}description:/.test(lines[i])) {
      let j = i + 1;
      while (j < end && !/^\s{2}[A-Za-z_][\w-]*:/.test(lines[j]) && !/^\s*-\s+id:/.test(lines[j])) j++;
      const old = lines.slice(i, j).join('\n');
      lines.splice(i, j - i, `  description: ${JSON.stringify(newDesc)}`);
      return { text: lines.join('\n'), old };
    }
  }
  return null;
}

let total = 0;
let updated = 0;
const skipped = [];
const backupDir = path.join(TMP, `backfill-backup-${Date.now()}`);

for (const file of FILES) {
  const full = path.join(REPO, 'data', file);
  if (!fs.existsSync(full)) continue;
  const orig = fs.readFileSync(full, 'utf8');
  const arr = yaml.load(orig) || [];

  // 1) 挑出候选条目
  const cands = [];
  for (const r of arr) {
    const type = typeOf[r.category];
    if (!type) continue;
    const oldDesc = r.description || '';
    const body = oldDesc.replace(/｜TMDB\s*[\d.]+\s*$/, '').replace(/…$/, '');
    if (ONLY_TRUNCATED && !/…$/.test(oldDesc.replace(/｜TMDB\s*[\d.]+\s*$/, ''))) continue;
    if (LIMIT && total + cands.length >= LIMIT) break;
    cands.push({ r, type, oldDesc, body });
  }
  if (!cands.length) continue;

  // 2) 并发抓取（串行太慢，且单条挂起会拖死整批）
  const done = [];
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const rs = await Promise.all(
      slice.map(async (c) => {
        const year = Number(String(c.r.date || '').slice(0, 4)) || 0;
        try {
          return { c, res: await findOverview(c.r.title, c.type, year) };
        } catch (e) {
          return { c, res: { err: `请求失败：${String(e.message).slice(0, 60)}` } };
        }
      })
    );
    done.push(...rs);
    process.stdout.write(`  …${file} ${Math.min(i + CONC, cands.length)}/${cands.length}\r`);
  }
  total += cands.length;

  // 3) 按 id 替换 description 行
  let text = orig;
  let fileUpdated = 0;
  for (const { c, res } of done) {
    if (res.err) {
      skipped.push(`${c.r.id} ${c.r.title} → ${res.err}`);
      continue;
    }
    if (res.overview.length <= c.body.length) continue; // 没有变长，跳过
    const suffix = (c.oldDesc.match(/｜TMDB\s*[\d.]+\s*$/) || [`｜TMDB ${res.vote}`])[0];
    const out = replaceDesc(text, c.r.id, res.overview + suffix);
    if (!out) {
      skipped.push(`${c.r.id} ${c.r.title} → 未找到 description 行`);
      continue;
    }
    text = out.text;
    fileUpdated++;
    updated++;
    console.log(`${DRY ? '［预览］' : '✅'} ${c.r.id} ${c.r.title}  ${c.body.length} → ${res.overview.length} 字`);
    if (DRY) console.log(`   旧：${c.body.slice(0, 60)}…\n   新：${res.overview.slice(0, 60)}…`);
  }

  if (!DRY && fileUpdated && text !== orig) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(full, path.join(backupDir, file));
    fs.writeFileSync(full, text);
    console.log(`  ${file}：写入 ${fileUpdated} 条（备份 ${backupDir}/${file}）`);
  }
}

console.log(`\n共检查 ${total} 条，${DRY ? '预计更新' : '已更新'} ${updated} 条，跳过 ${skipped.length} 条`);
if (skipped.length) console.log('跳过明细（前 15）：\n  ' + skipped.slice(0, 15).join('\n  '));
if (DRY) console.log('（--dry 未写文件，去掉该参数即写入）');
