#!/usr/bin/env node
/**
 * notify-feishu.mjs — wodewangpan TG 群反馈专用飞书通知脚本
 *
 * 与院采雷达的 scripts/notify-feishu.mjs 互不混用：
 *   - 院采雷达版：卡片标题固定「院采雷达-<来源>采集简报」，自动加盖「采集时间」戳，服务于三个采集任务；
 *   - 本版：纯通知卡片，markdown 首行作卡片标题，其余为正文，无任何采集痕迹。
 *
 * 用法：
 *   node notify-feishu.mjs alert.md                    # 首行 = 标题，其余 = 正文
 *   echo "标题\n正文" | node notify-feishu.mjs -       # stdin（传 - 或不传文件参数都读 stdin）
 *   node notify-feishu.mjs --level warn alert.md       # 卡片头部颜色：info=blue / warn=orange / ok=green / alert=red
 *   node notify-feishu.mjs --dry-run alert.md          # 只打印卡片 JSON，不发送
 *   node notify-feishu.mjs --profile tg alert.md       # 走 TG 群反馈专用的另一个飞书应用
 *
 * 凭据来源（默认通道，优先级从高到低）：
 *   1. 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET
 *   2. ~/.workbuddy/feishu-app-bot.json（兼容回退）
 *   3. ~/.workbuddy/feishu-app.json（兼容回退，跨项目共享）
 *   4. 找不到凭据时回退 lark-cli（feishu 连接器）以尽量保证送达。
 *
 * 本仓库的 TG 群反馈走 --profile tg，凭据在 bot/config.json 的 feishu.tg。
 *
 * 专用通道 --profile <name> / 环境变量 FEISHU_PROFILE=<name>，凭据按下列顺序取、命中即止：
 *   1. bot/config.json 的 feishu.<name>.app_id / app_secret（私人仓库可直接写这里）
 *   2. 环境变量 FEISHU_<NAME>_APP_ID / FEISHU_<NAME>_APP_SECRET
 *   3. ~/.workbuddy/feishu-app-<name>.json 的 app_id / app_secret
 *   可选 target_union（或 FEISHU_<NAME>_TARGET_UNION）覆盖收件人。
 *   专用通道找不到凭据时**直接失败**，绝不回退默认应用或 lark-cli，避免反馈发错地方。
 *
 * 目标：用户本人 union_id（同一组织下跨应用通用；open_id 按应用隔离不能跨应用用）。
 *   从 FEISHU_TARGET_UNION 或 config.json 的 target_union 读，不写进仓库。
 * lark-cli 回退通道的 open_id 从 FEISHU_TARGET_OPEN_ID 读。
 * 失败处理：最多重试 1 次；最终仍失败打印错误并以退出码 0 结束（绝不阻断机器人本体）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = (() => { try { return path.dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); } })();

const TARGET_UNION = process.env.FEISHU_TARGET_UNION || '';
// lark-cli 回退走 feishu 连接器（旧应用），收件人用旧应用视角的 open_id
const TARGET_OPEN_ID = process.env.FEISHU_TARGET_OPEN_ID || '';
const LARK = process.env.LARK_CLI || 'lark-cli';
const FEISHU_API = 'https://open.feishu.cn';
const MAX_TITLE_LEN = 40;

// ---------- 凭据解析 ----------
function loadConfig() {
  const p = path.join(__dirname, '..', 'config.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function loadCredentials(profile) {
  if (profile) {
    const cfg = loadConfig();
    const app = cfg && cfg.feishu && cfg.feishu[profile];
    if (app && app.app_id && app.app_secret) {
      return { appId: app.app_id, appSecret: app.app_secret,
               src: `config.json:feishu.${profile}`,
               targetUnion: app.target_union || '' };
    }
    const tag = profile.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const envId = process.env[`FEISHU_${tag}_APP_ID`];
    const envSecret = process.env[`FEISHU_${tag}_APP_SECRET`];
    if (envId && envSecret) {
      return { appId: envId, appSecret: envSecret, src: `env:${tag}`,
               targetUnion: process.env[`FEISHU_${tag}_TARGET_UNION`] || '' };
    }
    const only = path.join(os.homedir(), '.workbuddy', `feishu-app-${profile}.json`);
    if (fs.existsSync(only)) {
      try {
        const j = JSON.parse(fs.readFileSync(only, 'utf8'));
        if (j.app_id && j.app_secret) {
          return { appId: j.app_id, appSecret: j.app_secret, src: only,
                   targetUnion: j.target_union || '' };
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  // 默认通道：优先本仓库 config.json 的 feishu.default
  const cfg = loadConfig();
  const def = cfg && cfg.feishu && cfg.feishu.default;
  if (def && def.app_id && def.app_secret) {
    return { appId: def.app_id, appSecret: def.app_secret,
             src: 'config.json:feishu.default',
             targetUnion: def.target_union || '' };
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (appId && appSecret) return { appId, appSecret, src: 'env' };

  const candidates = [
    // 机器人专用凭据优先，与院采雷达等共享凭据（feishu-app.json）解耦
    path.join(os.homedir(), '.workbuddy', 'feishu-app-bot.json'),
    path.join(os.homedir(), '.workbuddy', 'feishu-app.json'),
  ];
  for (const userPath of candidates) {
    if (fs.existsSync(userPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(userPath, 'utf8'));
        if (j.app_id && j.app_secret) return { appId: j.app_id, appSecret: j.app_secret, src: userPath };
      } catch { /* ignore */ }
    }
  }
  return null;
}

// ---------- OpenAPI ----------
async function getTenantToken(appId, appSecret) {
  const r = await fetch(`${FEISHU_API}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await r.json();
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`tenant_access_token 失败 code=${j.code} msg=${j.msg}`);
  }
  return j.tenant_access_token;
}

const LEVELS = { info: 'blue', warn: 'orange', ok: 'green', alert: 'red' };

// 首行作卡片标题（去 # / * 前后缀），其余为正文
function splitTitle(md) {
  const lines = String(md || '').trim().split(/\r?\n/);
  let title = (lines[0] || '通知').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
  if (!title) title = '通知';
  if (title.length > MAX_TITLE_LEN) title = title.slice(0, MAX_TITLE_LEN) + '…';
  const body = lines.slice(1).join('\n').trim() || title;
  return { title, body };
}

function toCard(md, level) {
  const { title, body } = splitTitle(md);
  return {
    type: 'interactive',
    header: { template: LEVELS[level] || 'blue', title: { tag: 'plain_text', content: title } },
    elements: [{ tag: 'markdown', content: body }],
  };
}

async function sendViaApi(appId, appSecret, md, level, targetUnion) {
  const token = await getTenantToken(appId, appSecret);
  const card = toCard(md, level);
  const r = await fetch(`${FEISHU_API}/open-apis/im/v1/messages?receive_id_type=union_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: targetUnion || TARGET_UNION,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`send 失败 code=${j.code} msg=${j.msg}`);
  return j;
}

function runLark(args, input) {
  const r = spawnSync(LARK, args, { shell: true, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(String(r.stderr || r.stdout || '').slice(0, 200));
  return r.stdout || '';
}

function readInput(file) {
  // file 由 parseArgs 解析出（位置参数）；null 或 '-' 都读 stdin
  if (file && file !== '-') {
    if (!fs.existsSync(file)) { console.error(`[feishu] 文件不存在: ${file}`); return ''; }
    return fs.readFileSync(file, 'utf8');
  }
  if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8');
  return '';
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { level: 'info', file: null, dryRun: false,
                profile: process.env.FEISHU_PROFILE || '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--level' || a === '-l') out.level = args[++i];
    else if (a === '--profile' || a === '-p') out.profile = args[++i] || '';
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('-')) out.file = a;
  }
  if (!(out.level in LEVELS)) out.level = 'info';
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { level, file, dryRun, profile } = parseArgs();
  const md = readInput(file).trim();
  if (!md) { console.log('[feishu] 内容为空，跳过推送'); return; }

  if (dryRun) {
    console.log('[feishu] dry-run，卡片内容如下：');
    console.log(JSON.stringify(toCard(md, level), null, 2));
    return;
  }

  const creds = loadCredentials(profile);
  if (profile && !creds) {
    const tag = profile.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    console.error(`[feishu] 专用通道 ${profile} 缺凭据：请配置 ~/.workbuddy/feishu-app-${profile}.json（app_id / app_secret）或 FEISHU_${tag}_APP_ID / FEISHU_${tag}_APP_SECRET；为避免发错应用，本次不推送`);
    process.exit(1);
  }
  if (creds && !creds.targetUnion && !TARGET_UNION) {
    console.error('[feishu] 缺少收件人 union_id：请配置 FEISHU_TARGET_UNION 或 config.json 的 target_union，本次不推送');
    process.exit(1);
  }
  if (!creds && !TARGET_OPEN_ID) {
    console.error('[feishu] 缺少收件人 open_id：请配置 FEISHU_TARGET_OPEN_ID，本次不推送');
    process.exit(1);
  }
  const mode = creds ? `自定义应用(${creds.appId}${profile ? '/' + profile : ''})` : 'lark-cli 回退';
  console.log(`[feishu] 使用通道: ${mode}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let out;
      if (creds) {
        const j = await sendViaApi(creds.appId, creds.appSecret, md, level, creds.targetUnion);
        out = `msg_id=${(j.data && j.data.message_id) || 'n/a'}`;
      } else {
        out = runLark(['im', '+messages-send', '--as', 'bot', '--user-id', TARGET_OPEN_ID, '--markdown', '-'], md);
      }
      console.log('[feishu] 推送成功:', out.slice(0, 120).replace(/\s+/g, ' '));
      return;
    } catch (e) {
      console.error(`[feishu] 第${attempt}次推送失败: ${e.message}`);
      if (attempt === 1) await sleep(2000);
    }
  }
  console.error('[feishu] 推送最终失败，已记录；不阻断机器人任务');
  process.exit(0); // 非致命
}

main();
