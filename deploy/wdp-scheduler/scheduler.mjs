#!/usr/bin/env node
// wdp-scheduler.mjs —— 纯本地常驻调度器，等效 cron：每小时 :08 发 TG、:09 发 Bluesky
// 不依赖 WorkBuddy / LLM，只调用本仓库 push/ 下的 Node 脚本。
// 2026-11-17 并入仓库 deploy/wdp-scheduler/：路径全部按脚本自身位置解析，不再写死。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');   // deploy/wdp-scheduler/ → 仓库根
const NODE = process.execPath;
const LOGDIR = path.join(HERE, 'logs');
const STATE = path.join(HERE, 'lastrun.json');
const JOBS = [
  { key: 'tg', minute: 8, script: 'push/telegram/tg-post.mjs', log: 'tg-post.log' },
  { key: 'bs', minute: 9, script: 'push/bluesky/bluesky-post.mjs', log: 'bsky-post.log' },
];

fs.mkdirSync(LOGDIR, { recursive: true });
let last = {};
try { last = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}

const pad = (n) => String(n).padStart(2, '0');
const minuteKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const log = (line) => process.stdout.write(`[${new Date().toISOString()}] ${line}\n`);

function run(job) {
  const key = minuteKey(new Date());
  if (last[job.key] === key) return;
  last[job.key] = key;
  try { fs.writeFileSync(STATE, JSON.stringify(last)); } catch {}
  log(`触发 ${job.key} -> ${job.script}`);
  const lp = path.join(LOGDIR, job.log);
  const out = fs.openSync(lp, 'a');
  const child = spawn(NODE, [job.script], { cwd: REPO, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  child.on('error', (e) => log(`${job.key} 启动失败: ${e.message}`));
  fs.closeSync(out);
  log(`${job.key} 已启动 pid=${child.pid}`);
}

log(`调度器启动 pid=${process.pid} node=${NODE}`);
log(`任务: ${JOBS.map((j) => `${j.key}@:${j.minute}`).join(', ')}`);
setInterval(() => {
  const d = new Date();
  if (d.getSeconds() > 2) return;
  for (const job of JOBS) if (d.getMinutes() === job.minute) run(job);
}, 1000);
