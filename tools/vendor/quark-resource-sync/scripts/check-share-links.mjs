#!/usr/bin/env node
// 逐条核对站点 data/*.yaml 里的夸克分享链接是否还有效、分享标题是否与网盘当前目录名一致。
//
// 原理：share-detail 返回的 share_info.title 是「出链那一刻写死的分享标题」，
// first_file.file_name 是「网盘里当前的目录名」。两者不一致 = 出链之后目录被改名。
//
// 用法：
//   node check-share-links.mjs                    # 全量核对
//   node check-share-links.mjs --file movie.yaml  # 只核对某一份数据
//   node check-share-links.mjs --id mv-240        # 只核对某几条（可重复）
//   node check-share-links.mjs --conc 6           # 并发数（默认 5）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cfg, requireCfg, CACHE } from './lib/config.mjs';

const argv = process.argv.slice(2);
const pick = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const CLI = cfg.QUARK_CLI;
const REPO = cfg.REPO;
requireCfg(['QUARK_CLI', 'REPO']);
const CONC = Number(pick('conc', 5));
const onlyFile = pick('file', null);
const onlyIds = argv.filter((_, i) => argv[i - 1] === '--id');

const req = createRequire(path.join(REPO, 'package.json'));
const yaml = req('js-yaml');

// 2026-11-10：`os.yaml` 已随「操作系统」并入「软件」被删除（11 条 os- 条目现在 data/software.yaml 里）。
// 下面还有 existsSync 兜底，留着也不会崩，删掉只是为了不让下个会话以为这个分类还在。
const FILES = ['movie.yaml', 'tv.yaml', 'documentary.yaml', 'anime.yaml', 'game.yaml', 'software.yaml', 'ebook.yaml', 'course.yaml', 'misc.yaml'];

const jobs = [];
for (const f of FILES) {
  if (onlyFile && f !== onlyFile) continue;
  const p = path.join(REPO, 'data', f);
  if (!fs.existsSync(p)) continue;
  const list = yaml.load(fs.readFileSync(p, 'utf8')) || [];
  for (const e of list) {
    if (!e.quark_url) continue;
    if (onlyIds.length && !onlyIds.includes(e.id)) continue;
    jobs.push({ id: e.id, title: e.title, url: e.quark_url, file: f });
  }
}

const run = (args) =>
  new Promise((res) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (err, stdout) => res(stdout || String(err)))
  );

async function detail(url) {
  const out = await run(['share-detail', '--url', url]);
  const m = out.match(/\{[\s\S]*"action"\s*:\s*"share-detail"[\s\S]*\}/);
  if (!m) return { raw: out.slice(0, 300) };
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return { raw: out.slice(0, 300) };
  }
  const si = j?.data?.share_info || {};
  return {
    code: j.code,
    msg: j.msg,
    share_title: si.title || j?.data?.token_info?.title || '',
    cur_name: si.first_file?.file_name || '',
    status: si.status,
    expired_type: si.expired_type,
    file_num: si.file_num,
  };
}

const norm = (s) => String(s).replace(/^\d+\s*[-.]/, '').replace(/[\s·:：\-_.]/g, '').toLowerCase();
const results = [];
let done = 0;
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const d = await detail(job.url);
    const r = { ...job, ...d };
    const bad = d.code !== 0 || d.status !== 1;
    const renamed = !bad && d.share_title && d.cur_name && norm(d.share_title) !== norm(d.cur_name);
    r.issue = bad ? 'broken' : renamed ? 'renamed' : null;
    results.push(r);
    done++;
    if (done % 25 === 0 || done === jobs.length) process.stderr.write(`\r已核对 ${done}/${jobs.length}   `);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
process.stderr.write('\n');

const broken = results.filter((r) => r.issue === 'broken');
const renamed = results.filter((r) => r.issue === 'renamed');
console.log(`核对 ${results.length} 条 → 失效 ${broken.length} / 已改名需重出链 ${renamed.length}`);
if (broken.length) {
  console.log('\n失效链接：');
  for (const r of broken) console.log(`  ✖ ${r.id} 「${r.title}」 ${r.url}  ${r.msg ?? ''}${r.raw ?? ''}`);
}
if (renamed.length) {
  console.log('\n出链后目录被改名（需重新出链）：');
  for (const r of renamed) {
    const numDiff = (r.share_title.match(/^\d+/) || [''])[0] !== (r.cur_name.match(/^\d+/) || [''])[0];
    console.log(
      `  ⚠ ${r.id} 「${r.title}」\n      出链标题 ${r.share_title}  →  网盘现名 ${r.cur_name}${numDiff ? '   （编号也变了）' : ''}\n      ${r.url}`
    );
  }
}
const outFile = path.join(CACHE, 'check-share-links-last.json');
fs.writeFileSync(outFile, JSON.stringify({ scanned_at: new Date().toISOString(), results }, null, 1));
console.log(`\n结果已写入 ${outFile}`);
