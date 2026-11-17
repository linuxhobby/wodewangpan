#!/usr/bin/env node
// 删除本账号的帖子（维护工具，不参与自动发布）。
// 用途：清理测试帖（--no-state 发出去但那轮改动还没定稿时留下的帖子）。
// 用法：
//   node delete-posts.mjs --date 2026-11-15 --dry   # 列出当天发的帖子，不删
//   node delete-posts.mjs --date 2026-11-15         # 真删
//   node delete-posts.mjs --rkey 3n2edn44rf72i ...  # 精确删指定 rkey
// 凭据：与 bluesky-post.mjs 同目录的 wodewangpan-bluesky.env（不打印、不落盘）。
import { loadEnv } from '../common.mjs';

const { values: env } = loadEnv(import.meta.url, 'wodewangpan-bluesky.env');
const IDENTIFIER = env.BLUESKY_IDENTIFIER;
const APP_PASSWORD = env.BLUESKY_APP_PASSWORD;
const PDS = env.BLUESKY_PDS || 'https://bsky.social';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const dateArg = (() => {
  const i = argv.indexOf('--date');
  return i >= 0 ? argv[i + 1] : null;
})();
const rkeys = (() => {
  const out = [];
  argv.forEach((a, i) => { if (a === '--rkey') out.push(argv[i + 1]); });
  return out.filter((x) => x && !x.startsWith('--'));
})();
if (!dateArg && rkeys.length === 0) {
  console.error('× 需要 --date YYYY-MM-DD 或 --rkey <rkey>');
  process.exit(1);
}

const post = async (method, body) => {
  const r = await fetch(`${PDS}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
const get = async (path) => {
  const r = await fetch(`${PDS}/xrpc/${path}`);
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
};

if (!IDENTIFIER || !APP_PASSWORD) {
  console.error('× 凭据缺失：wodewangpan-bluesky.env 里需要 BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD');
  process.exit(1);
}

const sess = await post('com.atproto.server.createSession', { identifier: IDENTIFIER, password: APP_PASSWORD });
const authHeaders = { authorization: `Bearer ${sess.accessJwt}`, 'content-type': 'application/json' };

// 收集待删 rkey：按日期时翻页列全部帖子再按 createdAt 过滤
let targets = [];
if (dateArg) {
  let cursor = null;
  do {
    const q = new URLSearchParams({ repo: sess.did, collection: 'app.bsky.feed.post', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const r = await fetch(`${PDS}/xrpc/com.atproto.repo.listRecords?${q}`, { headers: authHeaders });
    const text = await r.text();
    if (!r.ok) throw new Error(`listRecords ${r.status}: ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    for (const rec of j.records || []) {
      if (String(rec.value?.createdAt || '').startsWith(dateArg)) {
        targets.push({ rkey: String(rec.uri).split('/').pop(), text: String(rec.value?.text || '') });
      }
    }
    cursor = j.cursor;
  } while (cursor);
} else {
  targets = rkeys.map((rkey) => ({ rkey, text: '(按 rkey 指定)' }));
}

if (targets.length === 0) {
  console.log('没有匹配的帖子，无需删除。');
  process.exit(0);
}

console.log(`待删 ${targets.length} 条：`);
for (const t of targets) console.log(`  ${t.rkey} | ${t.text.split('\n')[0].slice(0, 32)}`);
if (DRY) {
  console.log('\n（--dry：只列出，未删除）');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const t of targets) {
  const r = await fetch(`${PDS}/xrpc/com.atproto.repo.deleteRecord`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', rkey: t.rkey }),
  });
  if (r.ok) { ok++; console.log(`✓ 已删除 ${t.rkey}`); }
  else { fail++; console.log(`× 删除失败 ${t.rkey}：${(await r.text()).slice(0, 160)}`); }
}
console.log(`\n完成：成功 ${ok} 条，失败 ${fail} 条。`);
process.exit(fail ? 1 : 0);
