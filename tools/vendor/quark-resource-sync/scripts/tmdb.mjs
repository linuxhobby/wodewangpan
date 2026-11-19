#!/usr/bin/env node
// TMDB 查询 + 海报下载（走本机代理）。配置读 ../config.env。
// 用法：
//   node tmdb.mjs search --type movie|tv --query "特立独行" [--year 2026]
//   node tmdb.mjs detail --type tv --id 93166 [--poster <绝对路径>]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg } from './lib/config.mjs';

const { TMDB_TOKEN, PROXY } = cfg;
requireCfg(['TMDB_TOKEN']);

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const cmd = process.argv[2];

// 代理优先，代理挂了自动回退直连（TMDB API 一般可直连）
const curl = (url, useProxy = true, extra = []) =>
  new Promise((res, rej) => {
    const args = [
      '-s',
      '--max-time',
      '20',
      ...(useProxy && PROXY ? ['-x', PROXY] : []),
      '-H',
      `Authorization: Bearer ${TMDB_TOKEN}`,
      ...extra,
      url,
    ];
    execFile('curl', args, { maxBuffer: 32e6 }, (e, s) => (e ? rej(e) : res(s ?? '')));
  });

// 本机无 curl 时的 node fetch 回退（undici ProxyAgent 走代理）
let _undici = null;
const loadUndici = async () => (_undici ||= await import('undici'));

const fetchAgent = async (url) => {
  const { Agent, ProxyAgent } = await loadUndici();
  const dispatcher = PROXY ? new ProxyAgent(PROXY) : new Agent();
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    dispatcher,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r;
};

const fetchText = async (url) => {
  const r = await fetchAgent(url);
  return r.text();
};

const fetchToFile = async (url, out) => {
  const r = await fetchAgent(url);
  if (r.status !== 200) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) return false;
  fs.writeFileSync(out, buf);
  return true;
};

const get = async (url) => {
  let s = '';
  try {
    s = await curl(url);
  } catch {
    s = '';
  }
  if (!s) s = await curl(url, false).catch(() => '');
  if (!s) s = await fetchText(url).catch(() => ''); // 无 curl 时 fetch 回退
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`TMDB 返回异常（代理与直连均失败）：${String(s).slice(0, 200)}`);
  }
};

/** 下载文件：同样代理优先 + 直连回退，再退 node fetch */
const download = async (url, out) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  for (const useProxy of [true, false]) {
    await new Promise((res) =>
      execFile(
        'curl',
        ['-s', '--max-time', '60', ...(useProxy && PROXY ? ['-x', PROXY] : []), '-o', out, url],
        () => res()
      )
    );
    if (fs.existsSync(out) && fs.statSync(out).size > 1024) return true;
  }
  return fetchToFile(url, out); // 无 curl 时 fetch 回退
};

if (cmd === 'search') {
  const type = arg('type') || 'movie';
  const q = encodeURIComponent(arg('query') || '');
  const year = arg('year');
  if (!q) throw new Error('缺少 --query');
  const j = await get(
    `https://api.tmdb.org/3/search/${type}?query=${q}&language=zh-CN&include_adult=false${year ? `&year=${year}` : ''}`
  );
  const rows = (j.results || []).slice(0, 8).map((m) => ({
    id: m.id,
    title: m.title || m.name,
    original: m.original_title || m.original_name,
    date: m.release_date || m.first_air_date,
    vote: m.vote_average,
  }));
  if (!rows.length) console.log('（无结果 → 走"TMDB 未命中"分支：用目录原名 + 占位图）');
  rows.forEach((r) => console.log(`${r.id} | ${r.title} / ${r.original} | ${r.date} | ${r.vote}`));
} else if (cmd === 'detail') {
  const type = arg('type') || 'movie';
  const id = arg('id');
  const poster = arg('poster');
  if (!id) throw new Error('缺少 --id');
  const m = await get(`https://api.tmdb.org/3/${type}/${id}?language=zh-CN`);
  const info = {
    id: m.id,
    title: m.title || m.name,
    original: m.original_title || m.original_name,
    date: m.release_date || m.first_air_date,
    vote: m.vote_average,
    genres: (m.genres || []).map((g) => g.name),
    poster_url: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    seasons: m.number_of_seasons || null,
    episodes: m.number_of_episodes || null,
    season_list: (m.seasons || []).map((s) => ({ season: s.season_number, episodes: s.episode_count })),
    overview: m.overview || '',
  };
  console.log(JSON.stringify(info, null, 1));

  if (poster) {
    if (!info.poster_url) {
      console.log('（该条目无海报，需占位图）');
    } else {
      const ok = await download(info.poster_url, poster);
      console.log(
        ok
          ? `海报已下载：${poster}（${(fs.statSync(poster).size / 1024).toFixed(0)} KB）`
          : `海报下载失败：${info.poster_url}（代理与直连都不通，需占位图）`
      );
    }
  }
} else {
  console.log('用法：node tmdb.mjs search|detail --type movie|tv [--query|--id] [--year] [--poster 路径]');
}
