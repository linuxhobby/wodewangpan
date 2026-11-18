#!/usr/bin/env node
// 给存量电视剧（默认）/纪录片/动漫的简介补「第几季 · 共多少集」标签（SKILL 2026-10-06 要求）。
// 只改 description 行：正文前加（或替换）【…】标签，保留正文与结尾 ｜TMDB 评分。
// 数据源：TMDB tv detail 的 number_of_seasons / number_of_episodes / seasons。
//
// 用法：
//   node backfill-tv-spec.mjs --dry --limit 5          # 预览前 5 条，不写文件
//   node backfill-tv-spec.mjs --file tv.yaml        # 只处理某个数据文件（可多次）
//   node backfill-tv-spec.mjs --only tv-008,tv-002     # 只处理指定 id
//   node backfill-tv-spec.mjs --strict                 # 只写「标题完全匹配」的条目
//   node backfill-tv-spec.mjs                          # 全量写入（写前自动备份到 os.tmpdir()）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cfg, requireCfg, TMP } from './lib/config.mjs';

const { TMDB_TOKEN, PROXY } = cfg;
requireCfg(['TMDB_TOKEN', 'REPO']);
const REPO = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : cfg.REPO;

const argvOf = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const DRY = process.argv.includes('--dry');
// --new-body：连简介正文与评分一起换成 TMDB 官方的（用于「整条入库错了」的条目重新入库）
const NEW_BODY = process.argv.includes('--new-body');
const STRICT = process.argv.includes('--strict');
const LIMIT = Number(argvOf('limit') || 0);
const ONLY = (argvOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
// 手工指定 TMDB id：--map tv-033=221300,tv-058=61889（搜索对不上时用）
const MAP = Object.fromEntries(
  (argvOf('map') || '')
    .split(',')
    .filter(Boolean)
    .map((s) => s.split('=').map((x) => x.trim()))
);
const FILES = (process.argv.filter((a, i) => process.argv[i - 1] === '--file') || []);
const TARGETS = FILES.length ? FILES : ['tv.yaml'];
const CONC = Number(process.env.CONC || 6);

const require = createRequire(path.join(REPO, 'package.json'));
const yaml = require('js-yaml');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 代理优先，失败回退直连（与 tmdb.mjs 一致）
const curl = (url, useProxy = true) =>
  new Promise((res, rej) => {
    const args = ['-s', '-m', '25', ...(useProxy && PROXY ? ['-x', PROXY] : []), '-H', `Authorization: Bearer ${TMDB_TOKEN}`, url];
    execFile('curl', args, { maxBuffer: 32e6 }, (e, s) => (e ? rej(e) : res(s ?? '')));
  });
const get = async (url) => {
  let s = '';
  try {
    s = await curl(url);
  } catch {
    s = '';
  }
  if (!s || s.startsWith('<')) s = await curl(url, false).catch(() => '');
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`TMDB 返回异常：${String(s).slice(0, 120)}`);
  }
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s:：·、,，.。!！?？'"“”‘’()（）[\]【】\-—_/\\]/g, '');

/** 搜索电视剧，优先年份吻合的一条 */
async function searchTv(query, year) {
  const q = encodeURIComponent(query);
  const base = `https://api.tmdb.org/3/search/tv?query=${q}&language=zh-CN&include_adult=false`;
  let rows = (await get(year ? `${base}&year=${year}` : base)).results || [];
  if (!rows.length && year) rows = (await get(base)).results || [];
  if (!rows.length) return [];
  const yOf = (r) => Number((r.first_air_date || '').slice(0, 4)) || 0;
  if (year) {
    const ex = rows.find((r) => Math.abs(yOf(r) - year) <= 1);
    if (ex) return [ex, ...rows];
    if (Math.abs(yOf(rows[0]) - year) > 1) return rows; // 年份不符，交由 matched 判定
  }
  return rows;
}

/** 季/集标签（只按 TMDB 官方数据，不核对网盘实际存了几集） */
function specTag(d) {
  const seasons = (d.seasons || []).filter((s) => (s.season_number || 0) > 0 && (s.episode_count || 0) > 0);
  const nS = Number(d.number_of_seasons || 0) || seasons.length;
  const nE = Number(d.number_of_episodes || 0) || seasons.reduce((a, s) => a + (Number(s.episode_count) || 0), 0);
  if (nS > 1 && nE) return `【全剧 ${nS} 季 · 共 ${nE} 集】`;
  if (nE) return `【第 ${nS || 1} 季 · 共 ${nE} 集】`;
  if (nS > 1) return `【全剧 ${nS} 季】`;
  return '';
}

/** 从条目标题里解析「第 N 季」（支持阿拉伯数字与中文数字），没有则 null */
function seasonOf(title) {
  const m = String(title || '').match(/第\s*([0-9一二三四五六七八九十]+)\s*季/);
  if (!m) return null;
  const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return /^[0-9]+$/.test(m[1]) ? Number(m[1]) : cn[m[1]] || null;
}

/** 只替换指定 id 条目块里的 description，保持文件其余内容原样。
 *  注意：存量里存在「多行标量」写法的 description（人工编辑时真换行），
 *  必须整块替换，只换首行会残留续行导致 YAML 语法损坏。 */
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
      // 续行：缩进更深的文本行、空行，直到下一个同缩进的 key 或下一条目
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
const unsure = [];
const backupDir = path.join(TMP, `backfill-tv-spec-${Date.now()}`);

for (const file of TARGETS) {
  const full = path.join(REPO, 'data', file);
  if (!fs.existsSync(full)) {
    console.log(`（跳过：${file} 不存在）`);
    continue;
  }
  const orig = fs.readFileSync(full, 'utf8');
  const arr = yaml.load(orig) || [];
  let cands = arr.filter((r) => r && r.id && r.description !== undefined);
  if (ONLY.length) cands = cands.filter((r) => ONLY.includes(r.id));
  if (LIMIT) cands = cands.slice(0, LIMIT);
  if (!cands.length) continue;

  const done = [];
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const rs = await Promise.all(
      slice.map(async (r) => {
        const year = Number(String(r.date || '').slice(0, 4)) || 0;
        const mapped = MAP[r.id];
        const seasonNo = seasonOf(r.title);
        try {
          let hit;
          let d;
          let matched = true;
          if (mapped) {
            // --map 指定了 TMDB id：跳过搜索，直接用（搜索对不上时的人工兜底）
            d = await get(`https://api.tmdb.org/3/tv/${mapped}?language=zh-CN`);
            hit = { id: d.id, name: d.name, original_name: d.original_name, first_air_date: d.first_air_date };
          } else {
            const rows = await searchTv(r.title, year);
            if (!rows.length) return { r, res: { err: 'TMDB 无搜索结果' } };
            hit = rows[0];
            d = await get(`https://api.tmdb.org/3/tv/${hit.id}?language=zh-CN`);
            matched =
              norm(hit.name) === norm(r.title) ||
              norm(hit.original_name) === norm(r.title) ||
              norm(d.name) === norm(r.title) ||
              norm(d.original_name) === norm(r.title);
          }
          // 标题写明「第 N 季」的条目：按该季取集数（官方季详情优先）
          let tag = '';
          if (seasonNo != null) {
            const sd = await get(`https://api.tmdb.org/3/tv/${d.id}/season/${seasonNo}?language=zh-CN`).catch(() => null);
            const fromList = ((d.seasons || []).find((s) => s.season_number === seasonNo) || {}).episode_count || 0;
            const ep = (sd && Array.isArray(sd.episodes) && sd.episodes.length) || fromList;
            if (ep) tag = `【第 ${seasonNo} 季 · 共 ${ep} 集${(d.number_of_seasons || 0) > 1 ? ` · 全剧 ${d.number_of_seasons} 季` : ''}】`;
          }
          const body = NEW_BODY ? String(d.overview || '').replace(/\s+/g, ' ').trim() : '';
          const vote = NEW_BODY && d.vote_average ? Number(d.vote_average).toFixed(1) : '';
          return { r, res: { hit, d, matched, tag: tag || specTag(d), body, vote } };
        } catch (e) {
          return { r, res: { err: `请求失败：${String(e.message).slice(0, 60)}` } };
        }
      })
    );
    done.push(...rs);
    process.stdout.write(`  …${file} ${Math.min(i + CONC, cands.length)}/${cands.length}\r`);
    await sleep(200);
  }
  total += cands.length;

  let text = orig;
  let fileUpdated = 0;
  for (const { r, res } of done) {
    if (res.err) {
      skipped.push(`${r.id} ${r.title} → ${res.err}`);
      continue;
    }
    const tag = res.tag || specTag(res.d);
    if (!tag) {
      skipped.push(`${r.id} ${r.title} → TMDB 无集数信息`);
      continue;
    }
    if (!res.matched) {
      unsure.push(`${r.id} ${r.title} → TMDB：${res.hit.name || ''} / ${res.hit.original_name || ''}（${res.hit.first_air_date || '?'}）`);
      if (STRICT) continue;
    }
    const oldDesc = String(r.description || '');
    const oldBody = oldDesc.replace(/^【[^】]*】/, '').replace(/｜TMDB\s*[\d.]+\s*$/, '');
    const body = res.body || oldBody;
    const suffix = res.vote ? `｜TMDB ${res.vote}` : (oldDesc.match(/｜TMDB\s*[\d.]+\s*$/) || [''])[0];
    const out = replaceDesc(text, r.id, tag + body + suffix);
    if (!out) {
      skipped.push(`${r.id} ${r.title} → 未找到 description 行`);
      continue;
    }
    text = out.text;
    fileUpdated++;
    updated++;
    if (DRY) console.log(`［预览］${r.id} ${r.title} → ${tag}${body.slice(0, 28)}…`);
  }

  if (!DRY && fileUpdated && text !== orig) {
    try {
      yaml.load(text); // 写前自检：解析不过就绝不落盘
    } catch (e) {
      console.error(`\n✗ ${file} 写入前 YAML 校验失败，未改动文件：${String(e.message).slice(0, 140)}`);
      continue;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(full, path.join(backupDir, file));
    fs.writeFileSync(full, text);
    console.log(`\n  ${file}：写入 ${fileUpdated} 条（备份 ${backupDir}\\${file}）`);
  }
}

console.log(`\n共检查 ${total} 条，${DRY ? '预计更新' : '已更新'} ${updated} 条，跳过 ${skipped.length} 条，标题存疑 ${unsure.length} 条`);
if (skipped.length) console.log('跳过明细（前 15）：\n  ' + skipped.slice(0, 15).join('\n  '));
if (unsure.length) console.log(`标题存疑（前 20${STRICT ? '，--strict 已跳过未写入' : '，已按首条结果写入，请抽查'}）：\n  ` + unsure.slice(0, 20).join('\n  '));
if (DRY) console.log('（--dry 未写文件，去掉该参数即写入）');
