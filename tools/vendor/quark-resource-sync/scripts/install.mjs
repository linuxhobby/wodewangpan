#!/usr/bin/env node
// 把 quark-resource-sync 安装到任意设备的 agent skills 目录（macOS / Linux / Windows 通用）。
// config.env 含凭据，不随 Git 走——由本脚本就地生成或就地搬运，并安装到目标 skill 目录。
//
// 用法（在 skill 目录下执行，或本机任意位置指定 --source）：
//   node scripts/install.mjs --target <目标 skills 目录> [--source <skill 源目录>]
//     [--config <已有 config.env>] [--repo <站点仓库路径>] [--cli <夸克 CLI 路径>]
//     [--proxy <代理>] [--token <TMDB Read Access Token>] [--share-fid <SHARE fid>]
//     [--force]
//
// 例（macOS 本机）：
//   node scripts/install.mjs --target ~/.workbuddy/skills
// 例（Windows，PowerShell）：
//   node scripts/install.mjs --target "$env:USERPROFILE\.workbuddy\skills" `
//     --repo "$env:USERPROFILE\Documents\GitHub\ShareResource" `
//     --cli "$env:USERPROFILE\.workbuddy\skills\quarkclouddrive\scripts\quark-drive.cjs"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const expand = (p) => String(p).replace(/^~(?=$|[\\/])/, HOME);
const here = path.dirname(fileURLToPath(import.meta.url));

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const source = expand(arg('source', path.resolve(here, '..')));
let target = arg('target');
if (!target) {
  console.error('❌ 缺少 --target <目标 skills 目录>（安装后会在其下生成 quark-resource-sync/）');
  console.error('   macOS/Linux: --target ~/.workbuddy/skills');
  console.error('   Windows:     --target "%USERPROFILE%\\.workbuddy\\skills"');
  process.exit(1);
}
target = expand(target);
if (path.basename(target) !== 'quark-resource-sync') target = path.join(target, 'quark-resource-sync');

if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
  console.error(`❌ 源目录不像 skill：${source}（没有 SKILL.md）`);
  process.exit(1);
}

// ── 1. 复制 skill 文件（config.env 永远不复制，单独处理） ──────────────
const SKIP = new Set(['config.env', '.git', 'node_modules', '.DS_Store', 'Thumbs.db']);
fs.mkdirSync(target, { recursive: true });
const copy = (srcDir, dstDir) => {
  let n = 0;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      n += copy(s, d);
    } else {
      fs.copyFileSync(s, d);
      n += 1;
    }
  }
  return n;
};
const copied = copy(source, target);

// ── 2. 处理 config.env ──────────────────────────────────────────────
/** 找一份可继承的 config.env：优先 --config，其次目标已有，再次本机 ~/.workbuddy 下的同名 skill */
const candidates = [
  arg('config'),
  path.join(target, 'config.env'),
  path.join(HOME, '.workbuddy', 'skills', 'quark-resource-sync', 'config.env'),
  path.join(HOME, '.workbuddy', 'skills', 'quark-resource-sync', 'config.env'),
  path.join(HOME, '.codebuddy', 'skills', 'quark-resource-sync', 'config.env'),
].map((p) => p && expand(p));

const targetCfg = path.join(target, 'config.env');
let cfg = null;
let cfgFrom = null;
for (const c of candidates) {
  if (c && fs.existsSync(c)) {
    cfg = fs.readFileSync(c, 'utf8');
    cfgFrom = c;
    break;
  }
}
const exampleFile = fs.existsSync(path.join(source, 'config.env.example'))
  ? path.join(source, 'config.env.example')
  : null;
if (!cfg) {
  cfg = exampleFile
    ? fs.readFileSync(exampleFile, 'utf8')
    : ['TMDB_TOKEN=', 'PROXY=', 'REPO=', 'SHARE_FID=', 'QUARK_CLI='].join('\n') + '\n';
  cfgFrom = exampleFile || '（内置模板）';
}

// 按参数覆盖 / 追加键值
const KEYMAP = {
  token: 'TMDB_TOKEN',
  proxy: 'PROXY',
  repo: 'REPO',
  sharefid: 'SHARE_FID',
  'share-fid': 'SHARE_FID',
  cli: 'QUARK_CLI',
};
const overrides = {};
for (const [flagName, key] of Object.entries(KEYMAP)) {
  const v = arg(flagName);
  if (v) overrides[key] = expand(v);
}
// 命令行参数优先级最高：先剔除同名行，再统一追加到末尾（避免重复键）
const lines = cfg.split(/\r?\n/);
const out = lines
  .map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    return m && m[1] in overrides ? null : line;
  })
  .filter((l) => l !== null);
for (const [key, val] of Object.entries(overrides)) out.push(`${key}=${val}`);
fs.writeFileSync(targetCfg, out.join('\n').replace(/\n+$/, '\n'));
try {
  fs.chmodSync(targetCfg, 0o600);
} catch {
  /* Windows 无 chmod */
}

// ── 3. 结果检查 ──────────────────────────────────────────────────────
const final = Object.fromEntries(
  fs
    .readFileSync(targetCfg, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);
const missing = ['TMDB_TOKEN', 'SHARE_FID'].filter((k) => !final[k]);

console.log(`✅ 已安装 ${copied} 个文件 → ${target}`);
console.log(`   config.env：继承 ${cfgFrom}${Object.keys(overrides).length ? `，并按参数覆盖 ${Object.keys(overrides).join(' / ')}` : ''}`);
if (missing.length) {
  console.log(`\n⚠ 还需补填：${missing.join(' / ')}`);
  console.log(`   编辑 ${targetCfg}`);
  console.log('   TMDB_TOKEN：https://www.themoviedb.org/settings/api 取 Read Access Token');
  console.log('   SHARE_FID ：对 SHARE 目录执行夸克 CLI 的 browse，取该目录 fid');
}
// Windows 盘符路径不做存在性校验（跨平台安装时本机必然不存在）
const hasDrive = (p) => /^[A-Za-z]:[\\/]/.test(p || '');
const repo = final.REPO && expand(final.REPO);
if (repo && !hasDrive(repo) && !fs.existsSync(repo))
  console.log(`\n⚠ REPO 指向的站点仓库不存在：${repo}（用 --repo 重新指定）`);
const cli = final.QUARK_CLI && expand(final.QUARK_CLI);
if (cli && !hasDrive(cli) && !fs.existsSync(cli))
  console.log(`⚠ QUARK_CLI 路径不存在：${cli}（用 --cli 重新指定）`);
if (IS_WIN) {
  console.log('\nWindows 提示：');
  console.log('  · 路径用双引号包裹，避免空格与反斜杠问题；代理端口按你本机代理软件实测填写');
  console.log('  · 需要 Node 18+（node -v 检查），skill 只用 Node 内置模块，无需 npm install');
}
console.log(
  '\n提示：REPO / QUARK_CLI 留空也能用，脚本会自动探测（找不到再填）；' +
    '配置也可改走环境变量（QUARK_REPO / QUARK_CLI / TMDB_TOKEN / QUARK_SHARE_FID / QUARK_PROXY）。\n' +
    '排障：node ' + path.join(target, 'scripts', 'lib', 'config.mjs') + '（只看来源与长度，不显示值）'
);
