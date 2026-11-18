import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 夸克官方 skill 的 CLI（share-detail 客态抓清单 / browse 登录态扫盘共用）。
 * 优先用仓库内 vendor 副本，避免依赖 ~/.workbuddy；旧目录仅作回退。
 * fill-files.mjs 与 scan-drive-fids.mjs 共用这一份探测逻辑，勿另抄。
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR_CLI = path.join(REPO, 'tools', 'vendor', 'quarkclouddrive', 'scripts', 'quark-drive.cjs');
const HOME = process.env.HOME || process.env.USERPROFILE || '';

const CANDIDATES = [
  process.env.QUARK_CLI,
  VENDOR_CLI,
  path.join(HOME, '.workbuddy', 'skills', 'quarkclouddrive', 'scripts', 'quark-drive.cjs'),
  path.join(HOME, '.codebuddy', 'skills', 'quarkclouddrive', 'scripts', 'quark-drive.cjs'),
].filter(Boolean);

export const QUARK_CLI = CANDIDATES.find((p) => fs.existsSync(p)) || VENDOR_CLI;

/** CLI 在 cron / 纯 shell 下需要显式声明 Agent 环境，否则报 -104「无法识别当前 Agent 环境」 */
export const QUARK_CLI_ENV = {
  ...process.env,
  WORKBUDDY_CONFIG_DIR: process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.config', 'wodewangpan-quark'),
  CLIENT_INFO_PRODUCT_NAME: process.env.CLIENT_INFO_PRODUCT_NAME || 'WorkBuddy',
};
