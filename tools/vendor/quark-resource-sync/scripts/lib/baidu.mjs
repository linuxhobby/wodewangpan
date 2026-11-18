/**
 * 百度网盘镜像操作（bdpan.exe 封装）—— 2026-11-01 新增。
 *
 * 背景：TMDB 每日热门同步原先只在夸克建编号目录；将军要求百度盘对应分类下
 * 建立**同名**目录（编号与夸克同步），两盘目录一一对应。
 *
 * 实测口径（2026-11-01，bdpan 3.8.7）：
 *  - bdpan 的命令路径是**应用目录相对路径**，`/apps/bdpan/xxx` 即网页端「我的应用数据/bdpan/xxx」。
 *  - `mkdir` 幂等：对已存在路径重复执行返回成功（不报错、不产生重复目录）。
 *  - `ls --folder --json` 列目录时，条目里的 server_filename 可能为空，**名字一律从 path 最后一段取**。
 *  - 登录为 OAuth（bdpan login --device-code 可非交互重新授权），凭据由 bdpan 自管，本模块不碰任何 token。
 *  - 出错时 JSON 错误体走 stdout、进程退出码仍为 0，故成功判定要「解析 JSON + 看有无错误字段」。
 *
 * 失败语义：镜像失败**不阻断**夸克主流程，调用方把结果记进 rec.baidu / 报告即可。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 自动探测 bdpan 可执行文件（env BD_PAN_CLI / config.env BD_PAN_CLI 优先，由 cfg 层处理） */
export function detectBdpan() {
  const HOME = os.homedir();
  const plat = process.platform;
  if (plat === 'win32') return path.join(HOME, 'AppData', 'Local', 'bdpan', 'bdpan.exe');
  const bin = 'bdpan';
  for (const d of [path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin']) {
    const p = path.join(d, bin);
    try { fs.statSync(p); return p; } catch {}
  }
  return '';
}

/** baidu 侧根目录（应用数据下的镜像根，可用 config.env BAIDU_ROOT 覆盖） */
export const BAIDU_ROOT = '/apps/bdpan';

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');

/** 拼百度侧完整目录路径：baiduCatPath('03电视剧','145-xxx') → /apps/bdpan/03电视剧/145-xxx */
export function baiduCatPath(root, catDir) {
  return `${stripSlash(root)}/${catDir}`;
}
export function baiduDirPath(root, catDir, dirname) {
  return `${baiduCatPath(root, catDir)}/${dirname}`;
}

/**
 * 调 bdpan。返回 { ok, data }；失败时 data 为 null、err 带简述。
 * 超时视为失败（无人值守环境不能卡死）。
 */
export function bd(bin, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, [...args, '--json', '--no-check-update'],
      { maxBuffer: 64e6, encoding: 'buffer', timeout },
      (e, s, x) => {
        const out = s.toString('utf8').trim();
        let j = null;
        try { j = JSON.parse(out); } catch {}
        if (e) return resolve({ ok: false, err: String(x?.toString('utf8') || e.message).slice(0, 200), data: j });
        // bdpan 业务错误：stdout 里有 code（非 0）/ error 字段
        if (j && (j.error || (j.code !== undefined && j.code !== 0))) {
          return resolve({ ok: false, err: String(j.error || j.msg || JSON.stringify(j)).slice(0, 200), data: j });
        }
        resolve({ ok: true, data: j });
      });
  });
}

/** 登录态检查（whoami.authenticated）。失败/未登录返回 { ok:false, err }。 */
export async function bdWhoami(bin) {
  const r = await bd(bin, ['whoami'], { timeout: 30000 });
  if (!r.ok) return r;
  const a = r.data || {};
  if (!a.authenticated) return { ok: false, err: `未登录或 token 失效（expires_at=${a.expires_at || '?'}），需 bdpan login --device-code 重新授权` };
  return { ok: true, expires_at: a.expires_at };
}

/** 列分类目录下的子目录名（数组，取自 path 最后一段；自动剔除目录自身） */
export async function bdListDir(bin, root, catDir) {
  const r = await bd(bin, ['ls', baiduCatPath(root, catDir), '--folder']);
  if (!r.ok) return r;
  const arr = Array.isArray(r.data) ? r.data : [];
  const parent = baiduCatPath(root, catDir);
  const names = arr.map((x) => String(x.path || '').split('/').filter(Boolean).pop()).filter(Boolean);
  return { ok: true, names: [...new Set(names.filter((n) => n !== catDir.split('/').pop()))] };
}

/** 列任意完整路径下的**直接子项名**（文件+子目录都含，取 path 末段；用于判断占位是否已存在） */
export async function bdListEntries(bin, fullPath) {
  const r = await bd(bin, ['ls', fullPath]);
  if (!r.ok) return r;
  const arr = Array.isArray(r.data) ? r.data : [];
  const names = arr.map((x) => String(x.path || '').split('/').filter(Boolean).pop()).filter(Boolean);
  return { ok: true, names: [...new Set(names)] };
}

/** 建目录（幂等） */
export async function bdMkdir(bin, root, catDir, dirname) {
  const p = baiduDirPath(root, catDir, dirname);
  const r = await bd(bin, ['mkdir', p]);
  return r.ok ? { ok: true, path: p } : r;
}

/**
 * 上传占位说明文件（镜像夸克行为）。remote 单文件路径不能以 / 结尾。
 * localFile 需已写好内容；返回 { ok } 。
 */
export async function bdUploadFile(bin, root, catDir, dirname, localFile, fileName) {
  const p = `${baiduDirPath(root, catDir, dirname)}/${fileName}`;
  return bd(bin, ['upload', localFile, p]);
}

/** 从 bdpan share 输出解析链接与提取码（stdout 可能混有 ❌ 横幅，用正则兜底） */
export function parseShareOut(raw) {
  const m = String(raw || '').match(/https:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]{10,}/);
  if (!m) return { ok: false, err: '输出中无 pan.baidu.com/s 链接' };
  let pwd = null;
  for (const key of ['pwd', 'passcode', 'pass_code', 'extract_code', 'extraction_code', 'code']) {
    const mm = String(raw).match(new RegExp(`"${key}"\\s*:\\s*"([A-Za-z0-9]{3,8})"`, 'i'));
    if (mm) { if (key === 'code' && /^\d+$/.test(mm[1])) continue; pwd = mm[1]; break; }
  }
  return { ok: true, link: m[0], pwd };
}

/**
 * 创建百度分享链接（2026-11-04 新增）。优先 period（默认 0=永久），被拒自适应降级 fallbacks。
 * 返回 { ok, link, pwd, period, tried } 或 { ok:false, err, tried }；**永不抛错**（无人值守口径，与镜像一致）。
 * 注意：分享接口走百度 openapi，列表接口被风控时 share 也一并失败（错误里带 errno=-7 / HTTP 403）。
 */
export async function bdShare(bin, fullPath, { period = 0, fallbacks = [30, 7], timeout = 60000 } = {}) {
  const tried = [];
  for (const d of [...new Set([period, ...fallbacks])]) {
    const r = await bd(bin, ['share', fullPath, '-d', String(d)], { timeout });
    tried.push({ period: d, err: r.ok ? null : r.err });
    if (r.ok) {
      const ps = parseShareOut(r.raw);
      if (ps.ok) return { ok: true, link: ps.link, pwd: ps.pwd || null, period: d, tried };
      tried[tried.length - 1].err = ps.err;
    }
  }
  return { ok: false, err: tried.map((t) => `d${t.period}:${t.err || '?'}`).join(' | ').slice(0, 300), tried };
}
