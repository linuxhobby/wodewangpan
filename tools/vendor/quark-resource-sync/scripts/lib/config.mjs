/**
 * 统一配置加载 —— 双机（macOS / Windows）各配各的，凭据不落 Git、不随脚本走。
 *
 * 取值优先级：**环境变量 > config.env > 自动探测 > 默认值**
 *  1. 环境变量：适合不想把值写进文件的机器（Windows 用户变量 / macOS shell 配置）
 *  2. config.env：单机默认写法，含凭据，**不同步**
 *  3. 自动探测：REPO / QUARK_CLI 这类路径可自动找到，换机器基本不用改
 *
 * 环境变量名：
 *   TMDB_TOKEN        TMDB Read Access Token
 *   QUARK_PROXY       代理地址（如 http://127.0.0.1:1087）；未设则回退 HTTPS_PROXY
 *   QUARK_REPO        站点仓库绝对路径
 *   QUARK_SHARE_FID   夸克 SHARE 目录 fid
 *   QUARK_CLI         夸克 CLI 脚本绝对路径
 *   BD_PAN_CLI        百度网盘 bdpan CLI 绝对路径（未设则自动探测，找不到就跳过百度镜像）
 *   BAIDU_ROOT        百度侧镜像根目录（默认 /apps/bdpan，即「我的应用数据/bdpan」）
 *
 * 自诊断：node scripts/lib/config.mjs（只打印来源与长度，不打印值）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const HOME = os.homedir();
/** 沙箱里 fs.existsSync 对存在的文件也会返回 false，statSync 正常 —— 存在性判定统一用它 */
export const present = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
// 缓存目录（2026-11-18 本机迁移）：统一落 ~/.cache/quark-sync，可用 WDP_CACHE_DIR 覆盖
export const CACHE = process.env.WDP_CACHE_DIR
  ? path.resolve(process.env.WDP_CACHE_DIR)
  : path.join(HOME, '.cache', 'quark-sync');
export const TMP = os.tmpdir();

/**
 * 夸克 CLI 的 browse 任务目录。
 *
 * 背景（2026-10-11 实测）：quarkclouddrive 1.0.22 的 browse 把 JSONL 写到 CLI 自身目录下，
 * 1.0.24 起改为写到「执行时的 CWD」下的 browse/ 子目录 —— 脚本不设 cwd 时会污染仓库工作区。
 * 故统一显式传 `--task-dir` 把落盘收敛到本缓存目录（CLI 要求该目录已存在，用前 mkdirSync）。
 */
export const QUARK_TASK_DIR = path.join(CACHE, 'quark-tasks');

/** 环境变量候选（按顺序取第一个非空值） */
const ENV_KEYS = {
  TMDB_TOKEN: ['TMDB_TOKEN'],
  PROXY: ['QUARK_PROXY', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY'],
  REPO: ['QUARK_REPO'],
  SHARE_FID: ['QUARK_SHARE_FID'],
  QUARK_CLI: ['QUARK_CLI'],
  BD_PAN_CLI: ['BD_PAN_CLI', 'BAIDU_PAN_CLI'],
  BAIDU_ROOT: ['BAIDU_ROOT'],
};

const strip = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');
/** 展开 ~ 开头的路径（config.env 里常这么写，node 不会自动展开） */
const expandHome = (v) => {
  const s = strip(v);
  if (!s) return '';
  if (s === '~') return HOME;
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(HOME, s.slice(2));
  return s;
};

function readEnvFile() {
  const file = path.join(SKILL, 'config.env');
  // 沙箱里 existsSync 不可靠（存在的文件也返回 false），直接 try-read
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return i < 0 ? null : [l.slice(0, i).trim(), strip(l.slice(i + 1))];
      })
      .filter(Boolean)
  );
}

const first = (...vals) => vals.map(strip).find((v) => v !== '') || '';

/** 站点仓库自动探测：候选路径里找存在 data/site.yaml 的目录 */
function detectRepo() {
  const bases = ['Documents', ''];
  const names = ['wodewangpan', 'ShareResource'];
  const candidates = [];
  for (const b of bases) {
    for (const n of names) {
      candidates.push(b ? path.join(HOME, b, 'GitHub', n) : path.join(HOME, 'GitHub', n));
      candidates.push(b ? path.join(HOME, b, 'Github', n) : path.join(HOME, 'Github', n));
    }
  }
  candidates.push(path.join(HOME, 'Documents', 'ShareResource'), path.join(HOME, 'ShareResource'), path.join(HOME, 'Desktop', 'ShareResource'));
  return (
    candidates.find((d) => present(path.join(d, 'data', 'site.yaml'))) ||
    candidates.find((d) => present(d)) ||
    ''
  );
}

/** 夸克 CLI 自动探测：workbuddy / codebuddy 三种 skills 根目录都认 */
function detectCli() {
  const roots = ['.workbuddy', '.codebuddy'];
  for (const r of roots) {
    const p = path.join(HOME, r, 'skills', 'quarkclouddrive', 'scripts', 'quark-drive.cjs');
    if (present(p)) return p;
  }
  return '';
}

/** 百度网盘 CLI（bdpan）自动探测：Windows 官方安装位 %LOCALAPPDATA%\bdpan，mac/linux 看常见 bin 目录 */
function detectBdpan() {
  if (process.platform === 'win32') {
    const p = path.join(HOME, 'AppData', 'Local', 'bdpan', 'bdpan.exe');
    return present(p) ? p : '';
  }
  for (const d of [path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin']) {
    const p = path.join(d, 'bdpan');
    if (present(p)) return p;
  }
  return '';
}

const file = readEnvFile();

export const cfg = {
  get TMDB_TOKEN() {
    return first(...ENV_KEYS.TMDB_TOKEN.map((k) => process.env[k]), file.TMDB_TOKEN);
  },
  get PROXY() {
    return first(...ENV_KEYS.PROXY.map((k) => process.env[k]), file.PROXY);
  },
  get REPO() {
    return expandHome(first(...ENV_KEYS.REPO.map((k) => process.env[k]), file.REPO, detectRepo()));
  },
  get SHARE_FID() {
    return first(...ENV_KEYS.SHARE_FID.map((k) => process.env[k]), file.SHARE_FID);
  },
  get QUARK_CLI() {
    return expandHome(first(...ENV_KEYS.QUARK_CLI.map((k) => process.env[k]), file.QUARK_CLI, detectCli()));
  },
  /** 百度网盘 CLI（bdpan）。为空表示本机未装 → 镜像步骤自动跳过并记录原因 */
  get BD_PAN_CLI() {
    return expandHome(first(...ENV_KEYS.BD_PAN_CLI.map((k) => process.env[k]), file.BD_PAN_CLI, detectBdpan()));
  },
  /** 百度侧镜像根目录（bdpan 应用数据下的相对路径） */
  get BAIDU_ROOT() {
    return first(...ENV_KEYS.BAIDU_ROOT.map((k) => process.env[k]), file.BAIDU_ROOT) || '/apps/bdpan';
  },
};

/** 记录某项配置来自哪里，排障时用（不打印值） */
export const sourceOf = (key) =>
  (ENV_KEYS[key] || []).some((k) => strip(process.env[k]))
    ? '环境变量'
    : file[key]
      ? 'config.env'
      : ['REPO', 'QUARK_CLI', 'BD_PAN_CLI'].includes(key)
        ? '自动探测'
        : key === 'BAIDU_ROOT'
          ? '默认值'
          : '未配置';

/** 缺关键配置时给出可操作的提示 */
export function requireCfg(keys = ['TMDB_TOKEN', 'SHARE_FID']) {
  const miss = keys.filter((k) => !cfg[k]);
  if (!miss.length) return cfg;
  console.error('配置缺失：' + miss.join(' / '));
  console.error('任选一种补齐（二选一即可）：');
  console.error(`  A. 写入 ${path.join(SKILL, 'config.env')}`);
  console.error('  B. 设为环境变量，例如：');
  console.error('     macOS:  export TMDB_TOKEN=你的token');
  console.error('     Windows PowerShell:  setx TMDB_TOKEN "你的token"');
  console.error('排障：node ' + path.join('scripts', 'lib', 'config.mjs') + '（只看来源，不显示值）');
  process.exit(1);
}

/** 直接运行本文件时打印诊断（只显示来源与长度，不显示值） */
const KEYS = ['TMDB_TOKEN', 'PROXY', 'REPO', 'SHARE_FID', 'QUARK_CLI', 'BD_PAN_CLI', 'BAIDU_ROOT'];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('SKILL =', SKILL);
  console.log('HOME  =', HOME);
  console.log('TMP   =', TMP);
  console.log('CACHE =', CACHE);
  for (const k of KEYS) {
    const v = String(cfg[k] || '');
    console.log(
      `${k.padEnd(11)} 来源=${sourceOf(k).padEnd(6)} 长度=${String(v.length).padEnd(4)} ${v ? '已配置' : '未配置'}`
    );
  }
  const miss = KEYS.filter((k) => !cfg[k]);
  console.log(miss.length ? `缺失：${miss.join(' / ')}` : '全部就绪');
}
