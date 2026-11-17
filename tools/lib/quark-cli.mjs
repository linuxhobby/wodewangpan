import fs from 'node:fs';
import path from 'node:path';

/** 夸克官方 skill 的 CLI（share-detail 客态抓清单 / browse 登录态扫盘共用）。
 *  客户端目录按新旧依次探测：.workbuddy（现役）→ .codebuddy（历史目录回退）。
 *  fill-files.mjs 与 scan-drive-fids.mjs 共用这一份探测逻辑，勿另抄 */
export const QUARK_CLI =
  ['.workbuddy', '.codebuddy']
    .map((dir) =>
      path.join(process.env.HOME || process.env.USERPROFILE || '', dir, 'skills/quarkclouddrive/scripts/quark-drive.cjs')
    )
    .find((p) => fs.existsSync(p)) ||
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs');
