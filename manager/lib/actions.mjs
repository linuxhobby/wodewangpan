/**
 * manager 的副作用出口：构建预览、变更预览、提交推送、删除脚本包装。
 *
 * 安全边界：只走 git remote，不接 SSH / rsync / VPS 路径；remote 地址运行时读取并显示，
 * 不在代码里硬编码。所有子进程都不经 shell，参数白名单拼接。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import {
  FOLLOWING_LOCAL,
  FOLLOWING_TRACKED,
  exportManifest,
  readFollowingManifest,
  stringifyManifest,
} from '../../scripts/lib/following-manifest.mjs';
import { categorySlug } from '../../scripts/lib/data.js';
import { atomicWrite } from './atomic.mjs';
import { diffTexts } from './yaml-patch.mjs';
import { get } from './resources.mjs';
import { CONFIG_DIR, ROOT } from './paths.mjs';

function run(cmd, args, timeout = 120000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { code: r.error ? 4 : r.status ?? 1, out, error: r.error ? r.error.message : '' };
}

function git(args, timeout) {
  return run('git', args, timeout);
}

function section(title, text) {
  return `\n── ${title} ──\n${text || '（无）'}\n`;
}

export function remoteInfo() {
  const url = git(['remote', 'get-url', 'origin']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    remote: url.code === 0 ? url.out.trim() : '',
    branch: branch.code === 0 ? branch.out.trim() : '',
  };
}

export function diffPreview() {
  const status = git(['status', '--short']);
  const unstaged = git(['diff']);
  const staged = git(['diff', '--cached']);
  const localFile = path.join(CONFIG_DIR, FOLLOWING_LOCAL);
  let following = '（本地清单不存在，发布版保持原样）';
  if (fs.existsSync(localFile)) {
    const trackedFile = path.join(CONFIG_DIR, FOLLOWING_TRACKED);
    const before = fs.existsSync(trackedFile) ? fs.readFileSync(trackedFile, 'utf8') : '';
    const after = stringifyManifest(exportManifest(readFollowingManifest(CONFIG_DIR)));
    following = before === after ? '（发布版无需更新）' : diffTexts(before, after);
  }
  return {
    text:
      section('工作区状态', status.out) +
      section('未暂存改动', unstaged.out) +
      section('已暂存改动', staged.out) +
      section('追热播发布版预览', following),
    info: remoteInfo(),
  };
}

/** 按钮显式触发：先导出清单，只暂存 manager 会改的两处，再 fetch/rebase/push。 */
export function publish({ confirm = false, message = '' } = {}) {
  if (confirm !== true) throw new Error('必须由界面二次确认后才能提交推送');
  const info = remoteInfo();
  if (info.branch !== 'main') throw new Error(`当前分支是 ${info.branch || '未知'}，只允许在 main 上发布`);
  if (!info.remote) throw new Error('没有配置 origin remote，无法推送');
  const steps = [];

  const localFile = path.join(CONFIG_DIR, FOLLOWING_LOCAL);
  const trackedFile = path.join(CONFIG_DIR, FOLLOWING_TRACKED);
  if (fs.existsSync(localFile)) {
    const next = stringifyManifest(exportManifest(readFollowingManifest(CONFIG_DIR)));
    const before = fs.existsSync(trackedFile) ? fs.readFileSync(trackedFile, 'utf8') : '';
    if (next !== before) {
      atomicWrite(trackedFile, next);
      steps.push('· 已导出追热播发布版清单');
    }
  }

  const add = git(['add', '--', 'config/following.example.json', 'data/']);
  steps.push(add.out.trim() || '· 已暂存变更');
  if (add.code !== 0) return { code: add.code, out: steps.join('\n'), ok: false };

  const staged = git(['diff', '--cached', '--name-only']);
  if (staged.code !== 0 || !staged.out.trim()) {
    return { code: 0, ok: true, out: '没有待提交的变更，仓库未改动。' };
  }

  const msg = String(message || 'data: manager 更新追热播清单与资源字段')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 100);
  const commit = git(['commit', '-m', msg]);
  steps.push(commit.out.trim());
  if (commit.code !== 0) return { code: commit.code, out: steps.join('\n'), ok: false };

  const fetch = git(['fetch', 'origin', 'main'], 180000);
  steps.push(fetch.out.trim());
  if (fetch.code !== 0) return { code: fetch.code, out: steps.join('\n'), ok: false };

  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  const behind = Number((counts.out.trim().split(/\s+/)[1] || '0'));
  if (behind > 0) {
    steps.push(`· 远程领先 ${behind} 个提交，先 rebase`);
    const rebase = git(['pull', '--rebase', 'origin', 'main'], 180000);
    steps.push(rebase.out.trim());
    // rebase 冲突时留现场给站长处理，不自动 abort、不强推
    if (rebase.code !== 0) return { code: rebase.code, out: steps.join('\n'), ok: false };
  }

  const push = git(['push', 'origin', 'main'], 180000);
  steps.push(push.out.trim());
  return { code: push.code, out: steps.join('\n'), ok: push.code === 0 };
}

export function buildSite() {
  return run('npm', ['run', 'build'], 300000);
}

function reachable(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/**
 * 构建后打开本机预览；预览服务复用 scripts/serve.js，不碰 VPS。
 * macOS 用 Safari，Linux（Debian 13pve 等）优先 Firefox，失败再退到 xdg-open。
 * 无图形环境时只是不自动开，URL 仍返回给界面手动打开。
 */
export async function openPreview() {
  const url = 'http://127.0.0.1:4321/following/';
  if (!(await reachable(url))) {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js')], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 900));
  }
  const candidates = process.platform === 'darwin'
    ? [['open', ['-a', 'Safari', url], 'Safari']]
    : [['firefox', [url], 'Firefox'], ['xdg-open', [url], '系统默认浏览器']];
  let lastError = '';
  for (const [cmd, args, label] of candidates) {
    const r = spawnSync(cmd, args, { cwd: ROOT, timeout: 15000, stdio: 'ignore' });
    if (!r.error && r.status === 0) return { url, opened: true, launcher: label };
    lastError = r.error ? r.error.message : `退出码 ${r.status}`;
  }
  return { url, opened: false, launcher: '', error: lastError };
}

const DELETE_ID = /^[a-z]+-\d+$/;

function deleteArgs(id, mode, apply) {
  if (!DELETE_ID.test(String(id || ''))) throw new Error('资源 ID 格式不合法');
  const args = ['tools/remove-resource.mjs', '--ids', String(id)];
  if (mode === 'skip-drive') args.push('--skip-drive');
  else if (mode === 'no-push') args.push('--no-push');
  else if (mode !== 'normal') throw new Error('删除模式不合法');
  if (apply) args.push('--apply');
  return args;
}

export function deleteImpact(id) {
  const item = get(id);
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    file: `data/${item.file}`,
    image: `static/images/${categorySlug(item.category)}/${item.id}.jpg`,
    quark_url: item.quark_url,
    baidu_url: item.baidu_url,
    guangya_url: item.guangya_url,
  };
}

export function deleteDry({ id, mode = 'normal' } = {}) {
  return run(process.execPath, deleteArgs(id, mode, false), 600000);
}

export function deleteApply({ id, mode = 'normal', confirmId = '' } = {}) {
  if (String(confirmId ?? '') !== String(id ?? '')) throw new Error('确认 ID 不一致，未执行删除');
  return run(process.execPath, deleteArgs(id, mode, true), 600000);
}
