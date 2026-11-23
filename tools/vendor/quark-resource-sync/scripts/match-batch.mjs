#!/usr/bin/env node
// 批量把未编号目录名清洗成片名，查 TMDB 候选（只查询，不改网盘、不写站点数据）。
// 用法：node match-batch.mjs --scan /tmp/scan-new.json --out /tmp/match.json [--only mv|tv] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, TMP } from './lib/config.mjs';
import { buildBody, DESC_MIN } from './lib/desc.mjs';
import { seasonHint } from './lib/season-title.mjs';

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
// 年份不再截断 base 后，规格词会留在英文串里；复合 token（BD1080P、CHS-ENG）先整体剥掉，再走 EN_NOISE
const EN_SPEC =
  /(?:1080P|2160P|720P|480P|4K|BD|BluRay|WEB-?DL|WEB|HDTV|DVDRip|REMUX|x26[45]|H\.?26[45]|HEVC|AAC|AC3|EAC3|DTS|DD5|DDP5|Atmos|HDR|10bit|Dolby|CHS-ENG|MandarinEnglish)/gi;
// CHS / ENG 这类短标记必须整词匹配，否则会把 Vengeance 里的 eng 削掉
const EN_SHORT_SPEC = /\b(?:BD|WEB|CHS|ENG|4K)\b/gi;

function clean(name) {
  const raw = String(name).replace(/\.[a-z0-9]{1,5}$/i, '');
  const ym = raw.match(/(?:19|20)\d{2}/);
  const year = ym ? ym[0] : null;
  // 括号只当分隔符；年份从标题里整体剥掉，不再假设「片名一定在年份前面」
  const normalized = raw.replace(/[（(]/g, ' ').replace(/[）)]/g, ' ');
  const base = (year ? normalized.replace(year, ' ') : normalized).trim();

  // 规格词先从 base 里剔掉，再认中文名；中文片名末尾的续集数字/季数（虎胆龙威3、速度与激情9、第二季）是标题的一部分，不能当噪音砍掉
  const zhBase = base.replace(ZH_NOISE, '');
  let zh = (zhBase.match(/[一-龥]{2,}(?:\d+)?(?:季|部|集)?/g) || [])
    .filter((x) => !/^(?:第)?[一二两三四五六七八九十\d]+(?:季|部)$/.test(x))
    .sort((a, b) => b.length - a.length)[0] || null;
  if (zh) {
    zh = zh.replace(/[\-—]+$/, '').trim();
    if (zh.length < 2) zh = null;
  }

  let en = base.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(EN_SPEC, ' ').replace(EN_SHORT_SPEC, ' ');
  if (zh && en.includes(zh)) en = en.split(zh).pop();
  const keep = [];
  for (const t of en.split(/[.\s_-]+/).filter(Boolean)) {
    if (EN_NOISE.test(t)) break;
    if (/[一-龥]/.test(t)) continue;
    keep.push(t);
  }
  en = keep.join(' ').trim();
  if (en.length < 2) en = null;

  return { year, zh, en, season: seasonHint(name) };
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
      const { zh, en, year, season } = clean(t.filename);
      const tried = [];
      let hit = null;
      let hitDetail = null;
      const queries = [];
      if (zh) queries.push(zh);
      if (en) queries.push(en);
      for (const q of queries) {
        try {
          const r = await search(t.type, q, year);
          tried.push(`${q}${year ? `/${year}` : ''}→${r.length}`);
          if (r.length) {
            hit = r[0];
            // 季数只在「主标题命中多个候选」时用来挑人；唯一命中不干扰，仍按主标题口径
            if (season && t.type === 'tv' && r.length > 1) {
              let best = null;
              for (const cand of r.slice(0, 3)) {
                let cd;
                try { cd = await detail(t.type, cand.id); } catch { continue; }
                const seasonRow = (cd.seasons || []).find((s) => Number(s.season_number) === season);
                const has = Boolean(seasonRow) || Number(cd.number_of_seasons || 0) >= season;
                const years = [cd.release_date, cd.first_air_date, seasonRow?.air_date].map((x) => String(x || '').slice(0, 4)).filter(Boolean);
                const yearOk = Boolean(year && years.some((dy) => Math.abs(Number(dy) - Number(year)) <= 1));
                const score = (yearOk ? 2 : 0) + (has ? 1 : 0);
                const candScore = Number(cand.vote || cd.vote_average || 0);
                if (!best || score > best.score || (score === best.score && candScore > best.vote)) best = { cand, d: cd, score, vote: candScore };
              }
              if (best && best.score > 0) { hit = best.cand; hitDetail = best.d; tried.push(`季数${season}/年份→${best.cand.id}`); }
              else tried.push(`季数${season}→未判别，取默认`);
            }
            break;
          }
        } catch (e) {
          tried.push(`${q}→ERR ${e.message.slice(0, 40)}`);
        }
      }
      let info = null;
      let lowConfidence = false;
      if (hit) {
        const d = hitDetail || await detail(t.type, hit.id);
        const date = d.release_date || d.first_air_date || '';
        // 剧集带季数提示时，首播年份或该季播出年份任一接近即可；
        // TMDB 尚未收录该季时目录年份可能领先，不做年份降级，避免误伤未开播/刚开播的续集。
        const seasonRow = season && (d.seasons || []).find((s) => Number(s.season_number) === season);
        const years = [date, seasonRow?.air_date].map((x) => String(x || '').slice(0, 4)).filter(Boolean);
        if (year && !(season && !seasonRow) && !years.some((dy) => Math.abs(Number(dy) - Number(year)) <= 1)) lowConfidence = true;
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
          season_list: (d.seasons || []).map((s) => ({ season: s.season_number, episodes: s.episode_count, air_date: s.air_date || '' })),
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
      return { ...t, parsed: { zh, en, year, season }, tried, match: info, low_confidence: lowConfidence };
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
