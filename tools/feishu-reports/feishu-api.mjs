#!/usr/bin/env node
/**
 * 飞书卡片直发（不走 lark-cli / WorkBuddy）。
 *
 * 凭据：~/.config/wodewangpan-feishu.env（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_TO，权限 600）
 * 也支持同名环境变量覆盖，便于临时切换应用或接收人。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV_FILE = path.join(os.homedir(), '.config', 'wodewangpan-feishu.env');
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const SEND_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

function readEnvFile() {
  try {
    return Object.fromEntries(
      fs.readFileSync(ENV_FILE, 'utf8').split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return i < 0 ? [] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
        .filter((x) => x.length === 2)
    );
  } catch { return {}; }
}

export function feishuConfig() {
  const file = readEnvFile();
  const pick = (k) => String(process.env[k] || file[k] || '').trim();
  return {
    appId: pick('FEISHU_APP_ID'),
    appSecret: pick('FEISHU_APP_SECRET'),
    to: pick('FEISHU_TO'),
  };
}

async function postJson(url, body, token = '') {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`飞书接口返回非 JSON（HTTP ${r.status}）：${text.slice(0, 200)}`); }
  return json;
}

/** 发一张 interactive 卡片，返回 message_id。 */
export async function sendInteractiveCard(card, { to = '', idempotencyKey = '' } = {}) {
  const cfg = feishuConfig();
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，请写入 ~/.config/wodewangpan-feishu.env');
  }
  if (!to && !cfg.to) {
    throw new Error('缺少 FEISHU_TO，请写入 ~/.config/wodewangpan-feishu.env 或设为环境变量');
  }
  const tokenRes = await postJson(TOKEN_URL, { app_id: cfg.appId, app_secret: cfg.appSecret });
  if (tokenRes.code !== 0 || !tokenRes.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败：${tokenRes.code} ${tokenRes.msg || ''}`.trim());
  }
  const url = new URL(SEND_URL);
  url.searchParams.set('receive_id_type', 'open_id');
  if (idempotencyKey) url.searchParams.set('uuid', idempotencyKey);
  const sendRes = await postJson(url.toString(), {
    receive_id: to || cfg.to,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, tokenRes.tenant_access_token);
  if (sendRes.code !== 0) throw new Error(`飞书发消息失败：${sendRes.code} ${sendRes.msg || ''}`.trim());
  return sendRes.data?.message_id || '';
}
