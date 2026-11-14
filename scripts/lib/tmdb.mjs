// TMDB 播出进度查询（只读）：为「本周播了新一集、盘端可能还没追」提供提醒依据。
//
// 凭据只从环境变量或本机 quark-resource-sync skill 的 config.env 读，绝不写进仓库、
// 不落缓存；查不到凭据 / 标题匹配不确定就返回 null，由调用方静默跳过。
// 探测路径同时覆盖 macOS（~/.workbuddy / ~/.codebuddy）与 Windows 自动化机。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CONFIG_PATHS = [
  '.workbuddy/skills/quark-resource-sync/config.env',
  '.codebuddy/skills/quark-resource-sync/config.env',
];

const pick = (text, key) => {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

/** 环境变量优先，其次逐机探测 skill 的 config.env；缺凭据返回空 token，调用方跳过 */
export function readCredentials() {
  let token = process.env.TMDB_TOKEN || '';
  let proxy = process.env.TMDB_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY || '';
  for (const rel of CONFIG_PATHS) {
    const file = path.join(os.homedir(), rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    token = token || pick(text, 'TMDB_TOKEN');
    proxy = proxy || pick(text, 'PROXY');
    if (token) break;
  }
  return { token, proxy };
}

/** curl 走代理，代理不通自动回退直连（与 skill 的 tmdb.mjs 同口径） */
function tmdbGet(url, { token, proxy }) {
  const attempts = proxy ? [['-x', proxy], []] : [[]];
  let last = '请求失败';
  for (const extra of attempts) {
    try {
      const out = execFileSync(
        'curl',
        ['-s', '--max-time', '20', ...extra, '-H', `Authorization: Bearer ${token}`, url],
        { encoding: 'utf8', timeout: 25_000 }
      );
      const obj = JSON.parse(out);
      if (obj && !obj.status_message) return obj;
      last = obj?.status_message || '空响应';
    } catch (e) {
      last = String(e.message).split('\n')[0];
    }
  }
  throw new Error(last);
}

/** 剥掉「第一季 / 第 2 季」后缀再搜；年份只做宽松校验，不做硬过滤。
    季播剧的 date 常是某一季首播日（如第四季条目写 2025，全剧首播 2022），
    用 first_air_date_year 硬过滤会把整部剧搜没。相差超过 6 年视为不同剧，宁可不提醒。*/
export function searchTvId(title, year, cred) {
  const clean = String(title || '')
    .replace(/[\s（(]*第[一二三四五六七八九十\d]+季.*$/u, '')
    .trim();
  if (!clean) return null;
  const params = new URLSearchParams({ query: clean, language: 'zh-CN' });
  let data;
  try {
    data = tmdbGet(`https://api.themoviedb.org/3/search/tv?${params}`, cred);
  } catch {
    return null;
  }
  const rows = data.results || [];
  if (!rows.length) return null;
  const y = Number(year || 0);
  const hit = y
    ? rows.find((r) => Math.abs(Number(String(r.first_air_date || '').slice(0, 4)) - y) <= 6) || null
    : rows[0];
  if (!hit || !hit.id) return null;
  return { id: hit.id, name: hit.name || hit.original_name || '' };
}

/** 只取播出状态与最近 / 下一集，其它字段一律不要 */
export function tvAiring(id, cred) {
  let d;
  try {
    d = tmdbGet(`https://api.themoviedb.org/3/tv/${id}?language=zh-CN`, cred);
  } catch {
    return null;
  }
  const ep = (x) => (x ? { season: x.season_number, episode: x.episode_number, date: x.air_date || '' } : null);
  return {
    status: String(d.status || ''),
    last: ep(d.last_episode_to_air),
    next: ep(d.next_episode_to_air),
  };
}

/** 播出事件落在最近 days 天内（未来集不算：TMDB 偶尔给预告日期） */
export function airedWithin(airDate, today, days = 7) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(airDate || '')) return false;
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${airDate}T00:00:00Z`)) / 86400000;
  return diff >= 0 && diff <= days;
}

/** tree 里有没有集数样式文件名；电影 / 合辑单文件不参与追更提醒 */
export function hasEpisodeNames(tree) {
  return /(?:S\d{1,2})?E\d{1,3}|第\s*\d{1,3}\s*集|^\s*\d{1,3}\.(?:mp4|mkv|avi|ts)/im.test(String(tree || ''));
}

/** 条目对应第几季：优先盘端文件名的 S01E01，其次标题「第 N 季」；都没有 = 整剧目录，返回 null。
    用来对齐 TMDB 最近播出的季，避免「第四季播了新集」把第一 / 二 / 三季全提醒一遍。*/
export function seasonOf(tree, title) {
  const fromTree = String(tree || '').match(/S(\d{1,2})E\d{1,3}/i);
  if (fromTree) return Number(fromTree[1]);
  const fromTitle = String(title || '').match(/第\s*([一二三四五六七八九十\d]+)\s*季/);
  if (!fromTitle) return null;
  const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return cn[fromTitle[1]] || Number(fromTitle[1]) || null;
}
