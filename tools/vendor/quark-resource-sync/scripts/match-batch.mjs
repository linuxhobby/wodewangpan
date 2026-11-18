#!/usr/bin/env node
// 批量把未编号目录名清洗成片名，查 TMDB 候选（只查询，不改网盘、不写站点数据）。
// 用法：node match-batch.mjs --scan /tmp/scan-new.json --out /tmp/match.json [--only mv|tv] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, TMP } from './lib/config.mjs';
import { buildBody, DESC_MIN } from './lib/desc.mjs';

const { TMDB_TOKEN, PROXY } = cfg;
requireCfg(['TMDB_TOKEN']);
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const scan = JSON.parse(
  fs.readFileSync(arg('scan', path.join(TMP, 'scan-new.json')), 'utf8')
);
const OUT = arg('out', path.join(TMP, 'match.json'));
const ONLY = arg('only', null);
const LIMIT = parseInt(arg('limit', '0'), 10);
const CONC = 4;

// 中文名里的规格/字幕噪音
const ZH_NOISE =
  /字幕|简繁|繁简|国语|粤语|英语|韩语|日语|中字|中英|英中|双语|双字|双音|特效|国英|合集|原盘|蓝光|杜比|视界|国配|内封|外挂|导演剪辑版|加长版|未删减|修复版|HDR|4K|1080P|720P|2160P|REMUX|WEB|BD/gi;
// 英文名里的发布规格 token
const EN_NOISE =
  /^(1080p|720p|2160p|480p|4k|web|web-?dl|web-?rip|bluray|bdrip|brrip|remux|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|eac3|dts|dd5|ddp5|atmos|hdr|hdr10|dv|dolby|10bit|itunes|nf|amzn|dsnp|max|hulu|diy|edith|rar-bg|cmct|hdbthd|bbqddq|dreamhd|lamatgx|huzzahtgx|xiaomi|quickio|hdsweb)$/i;

function clean(name) {
  let s = String(name).replace(/\.[a-z0-9]{1,5}$/i, '');
  const ym = s.match(/(?:19|20)\d{2}/);
  const year = ym ? ym[0] : null;
  let base = year ? s.slice(0, s.indexOf(year)) : s.split(/[.\[(]/)[0];

  let zh = (base.match(/[一-龥]{2,}/g) || []).map((x) => x).sort((a, b) => b.length - a.length)[0] || null;
  if (zh) {
    zh = zh.replace(ZH_NOISE, '').replace(/[\d\-—]+$/, '').trim();
    if (zh.length < 2) zh = null;
  }

  let en = base.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  if (zh && en.includes(zh)) en = en.split(zh).pop();
  const keep = [];
  for (const t of en.split(/[.\s_-]+/).filter(Boolean)) {
    if (EN_NOISE.test(t)) break;
    if (/[一-龥]/.test(t)) continue;
    keep.push(t);
  }
  en = keep.join(' ').trim();
  if (en.length < 2) en = null;

  return { year, zh, en };
}

const get = (url, retry = 1) =>
  new Promise((res, rej) => {
    const args = ['-s', ...(PROXY ? ['-x', PROXY] : []), '-H', `Authorization: Bearer ${TMDB_TOKEN}`, url];
    execFile('curl', args, { maxBuffer: 32e6 }, (e, s, err) => {
      try {
        const j = JSON.parse(s);
        return res(j);
      } catch {
        if (retry > 0) return setTimeout(() => get(url, retry - 1).then(res, rej), 800);
        return rej(new Error(`TMDB 返回异常：${String(s).slice(0, 120)}`));
      }
    });
  });

async function search(type, q, year) {
  // 走官方域名 api.tmdb.org（api.themoviedb.org 在本机可能被 DNS 劫持，见 SKILL.md）
  const url = `https://api.tmdb.org/3/search/${type}?query=${encodeURIComponent(q)}&language=zh-CN&include_adult=false${year ? `&year=${year}` : ''}`;
  const j = await get(url);
  return (j.results || []).slice(0, 3);
}

async function detail(type, id) {
  return get(`https://api.tmdb.org/3/${type}/${id}?language=zh-CN`);
}

const tasks = [];
for (const c of scan.categories) {
  if (!c.unnumbered) continue;
  if (ONLY && c.prefix !== ONLY) continue;
  for (const u of c.unnumbered) {
    tasks.push({ prefix: c.prefix, category: c.key, type: c.prefix === 'mv' ? 'movie' : 'tv', ...u });
  }
}
const list = LIMIT ? tasks.slice(0, LIMIT) : tasks;

const results = [];
for (let i = 0; i < list.length; i += CONC) {
  const chunk = list.slice(i, i + CONC);
  const out = await Promise.all(
    chunk.map(async (t) => {
      const { zh, en, year } = clean(t.filename);
      const tried = [];
      let hit = null;
      const queries = [];
      if (zh) queries.push(zh);
      if (en) queries.push(en);
      for (const q of queries) {
        try {
          const r = await search(t.type, q, year);
          tried.push(`${q}${year ? `/${year}` : ''}→${r.length}`);
          if (r.length) {
            hit = r[0];
            break;
          }
        } catch (e) {
          tried.push(`${q}→ERR ${e.message.slice(0, 40)}`);
        }
      }
      let info = null;
      let lowConfidence = false;
      if (hit) {
        const d = await detail(t.type, hit.id);
        const date = d.release_date || d.first_air_date || '';
        if (year && date && Math.abs(Number(date.slice(0, 4)) - Number(year)) > 1) lowConfidence = true;
        info = {
          id: d.id,
          title: d.title || d.name,
          original: d.original_title || d.original_name,
          date,
          vote: d.vote_average,
          genres: (d.genres || []).map((g) => g.name),
          poster_url: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
          seasons: d.number_of_seasons || null,
          episodes: d.number_of_episodes || null,
          season_list: (d.seasons || []).map((s) => ({ season: s.season_number, episodes: s.episode_count })),
          overview: d.overview || '',
        };
        // 简介下限 150 字是**补齐线**（2026-11-12 定夺，与 trending-sync 同口径）：原文不足时，
        // 用这同一次 detail 已拿到的真实字段（标语/类型/年代/产地/主创/阵容…）拼到 ≥150 字，
        // 不额外请求 TMDB。overview 保持 TMDB 原文不动，人工二次改写时仍以它对照。
        if (info && [...(info.overview || '')].length < DESC_MIN) {
          const built = buildBody({ overview: info.overview, d, type: t.type, title: info.title, original: info.original });
          info.desc_body = built.body;
          info.desc_len = built.len;
          info.desc_filled = built.filled;
        }
      }
      return { ...t, parsed: { zh, en, year }, tried, match: info, low_confidence: lowConfidence };
    })
  );
  results.push(...out);
  process.stderr.write(`\r匹配中 ${results.length}/${list.length}`);
}
process.stderr.write('\n');

fs.writeFileSync(OUT, JSON.stringify(results, null, 1));

const ok = results.filter((r) => r.match);
const miss = results.filter((r) => !r.match);
const low = results.filter((r) => r.low_confidence);
console.log(`总数 ${results.length} | 命中 ${ok.length} | 未命中 ${miss.length} | 年份不符（低置信）${low.length}`);
console.log('\n前 15 条对照：');
results.slice(0, 15).forEach((r) =>
  console.log(
    `  ${r.filename.slice(0, 44).padEnd(46)} → ${r.match ? `${r.match.title} (${r.match.date}) ${r.match.vote}${r.low_confidence ? ' ⚠年份不符' : ''}` : '❌ 未命中'}`
  )
);
if (miss.length) {
  console.log(`\n未命中（前 20 / ${miss.length}）：`);
  miss.slice(0, 20).forEach((r) => console.log(`  ${r.filename}`));
}
console.log(`\n完整结果：${OUT}`);
