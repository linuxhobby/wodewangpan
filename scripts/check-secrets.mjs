#!/usr/bin/env node
/**
 * 公开仓敏感信息门禁：只扫 git 跟踪的文本文件，命中即退出 1。
 * 拦的是「地址 / 账号标识 / 邮箱」这类信息暴露，不是密钥本身；
 * 密钥继续靠 env 文件（权限 600、不进 git）管理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = ['data/', 'static/', 'tools/vendor/quarkclouddrive/', 'node_modules/.', '.git/'];
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.json', '.yaml', '.yml', '.sh', '.py', '.html', '.css', '.txt', '.conf', '.example']);

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RULES = [
  { name: 'IPv4', re: IPV4, allow: (m) => ['127.0.0.1', '0.0.0.0', '255.255.255.255'].includes(m) },
  { name: '飞书 open_id', re: /\bou_[0-9a-f]{16,}\b/g },
  { name: '飞书 union_id', re: /\bon_[0-9a-f]{16,}\b/g },
  { name: '飞书应用 id', re: /\bcli_[0-9a-f]{16,}\b/g },
  {
    name: '邮箱',
    re: EMAIL,
    allow: (m, file) => file === 'config/site.yaml' || m.toLowerCase() === 'git@github.com' || /@example\.(com|org|net)$/i.test(m),
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}).split('\0').filter(Boolean);

const hits = [];
for (const rel of tracked) {
  if (SKIP_FILES.has(rel) || SKIP_DIRS.some((d) => rel.startsWith(d))) continue;
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      for (const match of lines[i].matchAll(rule.re)) {
        if (rule.allow?.(match[0], rel)) continue;
        hits.push(`${rel}:${i + 1} [${rule.name}] ${match[0]}`);
      }
    }
  }
}

if (hits.length) {
  console.error('敏感信息扫描未通过：');
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`敏感信息扫描通过（${tracked.length} 个受跟踪文件）`);
