#!/usr/bin/env node
/**
 * 本机 Web 管理工具，默认只监听 127.0.0.1:8787，无鉴权、零新增依赖。
 * 需要局域网访问时可用环境变量指定监听地址与来源 IP 白名单，IP 不写进仓库。
 * 四个视图共用一套 API：追热播编排 / 字段编辑 / 连载看板 / 资源删除。
 * 所有清单读写走 manager/following.mjs，资源写盘走 manager/lib/resources.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { loadSite, categorySlug } from '../scripts/lib/data.js';
import * as following from './following.mjs';
import * as resources from './lib/resources.mjs';
import * as dashboard from './lib/dashboard.mjs';
import * as actions from './lib/actions.mjs';
import { MANAGER_PUBLIC, ROOT } from './lib/paths.mjs';

const HOST = process.env.FOLLOWING_UI_HOST || '127.0.0.1';
const PORT = Number(process.env.FOLLOWING_UI_PORT) || 8787;
// 来源白名单：逗号分隔的 IPv4；未配置时只允许本机。IP 不放进仓库，启动时从环境变量传入。
const ALLOW_IPS = new Set(
  String(process.env.FOLLOWING_UI_ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
const isLocal = (ip) => !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
const isAllowed = (ip) => isLocal(ip) || ALLOW_IPS.has(ip) || ALLOW_IPS.has(ip.replace(/^::ffff:/, ''));
const categories = loadSite(path.join(ROOT, 'config')).categories;
// 删除必须先试跑：这里只记本进程内通过试跑的 ID，服务重启后需重新试跑
const dryPassed = new Set();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file) {
  const full = path.resolve(file);
  const base = full.startsWith(`${MANAGER_PUBLIC}${path.sep}`) ? MANAGER_PUBLIC : ROOT;
  if (!full.startsWith(`${base}${path.sep}`) && full !== path.join(ROOT, 'favicon.svg')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404).end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

function previewView(r) {
  return {
    id: r.id,
    file: r.file,
    changed: r.changed,
    diff: r.diff,
    updated: r.updated,
    clearDead: r.clearDead,
  };
}

function candidates(q = '') {
  const keyword = String(q).trim().toLowerCase();
  const statuses = new Map();
  for (const [key, list] of Object.entries(dashboard.status(['电视剧']).groups)) {
    for (const row of list) statuses.set(row.id, key);
  }
  return resources
    .all()
    .filter((it) => it.category === '电视剧' && !it.dead)
    .filter((it) => !keyword || [it.id, it.title, it.keywords].some((v) => String(v || '').toLowerCase().includes(keyword)))
    .slice(0, 30)
    .map((it) => ({
      id: it.id,
      title: it.title,
      updated: it.updated || it.added || '',
      status: statuses.get(it.id) || '',
      image: it.image ? `/static/images/${categorySlug(it.category)}/${encodeURIComponent(it.image)}` : '',
    }));
}

async function handle(req, res) {
  const remote = req.socket.remoteAddress || '';
  if (!isAllowed(remote)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;
  const params = url.searchParams;
  const method = req.method || 'GET';

  if (method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(MANAGER_PUBLIC, 'index.html'));
  if (method === 'GET' && (p === '/app.js' || p === '/style.css')) return serveFile(res, path.join(MANAGER_PUBLIC, path.basename(p)));
  if (method === 'GET' && p.startsWith('/static/')) {
    return serveFile(res, path.join(ROOT, p.replace(/^\/static\//, '')));
  }

  let body = {};
  if (['POST', 'PUT'].includes(method)) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw new Error('请求体过大');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text) body = JSON.parse(text);
  }

  if (method === 'GET' && p === '/api/state') return send(res, 200, following.read());
  if (method === 'GET' && p === '/api/candidates') return send(res, 200, { items: candidates(params.get('q') || '') });
  if (method === 'POST' && p === '/api/add') return send(res, 200, { state: await following.add(body) });
  if (method === 'POST' && p === '/api/archive') return send(res, 200, { state: await following.archive(body) });
  if (method === 'POST' && p === '/api/remove') return send(res, 200, { state: await following.remove(body) });
  if (method === 'POST' && p === '/api/restore') return send(res, 200, { state: await following.restore(body) });
  if (method === 'POST' && p === '/api/note') return send(res, 200, { state: await following.setNote(body) });
  if (method === 'POST' && p === '/api/reorder') return send(res, 200, { state: await following.reorder(body) });

  if (method === 'GET' && p === '/api/resources') {
    return send(res, 200, { categories, items: resources.search({ cat: params.get('cat') || '', q: params.get('q') || '' }) });
  }
  if (method === 'GET' && p === '/api/titles') {
    const wanted = new Set((params.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean));
    const titles = {};
    for (const it of resources.all()) {
      if (wanted.has(it.id)) {
        titles[it.id] = { title: it.title, category: it.category, updated: it.updated || it.added || '', href: `/${categorySlug(it.category)}/${encodeURIComponent(it.id)}/`, dead: !!it.dead };
      }
    }
    return send(res, 200, { titles });
  }
  if (method === 'GET' && p === '/api/resource') return send(res, 200, { resource: resources.get(params.get('id') || '') });
  if (method === 'POST' && p === '/api/resource/preview') {
    return send(res, 200, previewView(resources.prepare(body.id, body.changes || {}, body.deadVerified === true)));
  }
  if (method === 'POST' && p === '/api/resource/update') {
    return send(res, 200, resources.save(body.id, body.changes || {}, body.deadVerified === true));
  }

  if (method === 'GET' && p === '/api/serials/status') {
    const cats = params.get('cats');
    return send(res, 200, dashboard.status(cats ? cats.split(',').map((s) => s.trim()).filter(Boolean) : undefined));
  }
  if (method === 'GET' && p === '/api/serials/todo') return send(res, 200, { items: dashboard.todo() });

  if (method === 'GET' && p === '/api/delete/impact') return send(res, 200, actions.deleteImpact(params.get('id') || ''));
  if (method === 'POST' && p === '/api/delete/dry') {
    const r = actions.deleteDry(body);
    if (r.code === 0) dryPassed.add(String(body.id || ''));
    return send(res, 200, r);
  }
  if (method === 'POST' && p === '/api/delete/apply') {
    if (!dryPassed.has(String(body.id || ''))) throw new Error('请先对同一 ID 试跑并确认输出');
    const r = actions.deleteApply(body);
    dryPassed.delete(String(body.id || ''));
    return send(res, 200, r);
  }

  if (method === 'GET' && p === '/api/diff') return send(res, 200, actions.diffPreview());
  if (method === 'GET' && p === '/api/publish/info') return send(res, 200, actions.remoteInfo());
  if (method === 'POST' && p === '/api/publish') return send(res, 200, actions.publish(body));
  if (method === 'POST' && p === '/api/build') return send(res, 200, actions.buildSite());
  if (method === 'GET' && p === '/api/preview') return send(res, 200, await actions.openPreview());

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: `未知接口 ${p}` }));
}

http
  .createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, 400, { error: e.message || '请求处理失败' });
      else res.end();
    });
  })
  .listen(PORT, HOST, () => {
    const extra = ALLOW_IPS.size ? `（另放行 ${ALLOW_IPS.size} 个来源 IP）` : '';
    console.log(`追热播管理工具已启动：http://${HOST}:${PORT}${extra}`);
  });
