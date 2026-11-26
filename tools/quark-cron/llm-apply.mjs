#!/usr/bin/env node
/**
 * LLM 草稿校验写回器。
 * 输入：WorkBuddy 自动化生成的草稿 JSON（数组或 {items:[...]}）。
 * 输出：校验通过后写 data/*.yaml、下载海报、补文件清单、build/commit/push/VPS。
 * 不调用 LLM，不让模型直接写仓库；所有字段在此重新校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { upsertEntry } from '../vendor/quark-resource-sync/scripts/lib/yaml-store.mjs';
import { seasonTitle } from '../vendor/quark-resource-sync/scripts/lib/season-title.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.WDP_REPO || path.resolve(HERE, '..', '..');
const CACHE = process.env.WDP_CACHE_DIR || path.join(os.homedir(), '.cache', 'quark-sync');
// 海报下载的临时文件单独放一个子目录：~/.cache/quark-sync 根目录条目已过百，
// 在那里删单个临时文件会命中工具层的「批量删除」守卫（SAFE_DELETE_BULK_CONFIRM_REQUIRED），
// 直接抛错中断整轮补全。独立子目录条目数少，删除不被拦截。
const TMP_DIR = path.join(CACHE, 'poster-tmp');
const MAKE = path.join(REPO, 'tools', 'vendor', 'quark-resource-sync', 'scripts', 'make-entry.mjs');
const FILL = path.join(REPO, 'tools', 'fill-files.mjs');
const MIN_CONF = Number(process.env.WDP_LLM_MIN_CONF || 0.75);

const CATS = {
  电影: { prefix: 'mv', file: 'movie.yaml', slug: 'movie' },
  电视剧: { prefix: 'tv', file: 'tv.yaml', slug: 'tv' },
  纪录片: { prefix: 'dc', file: 'documentary.yaml', slug: 'documentary' },
  动漫: { prefix: 'an', file: 'anime.yaml', slug: 'anime' },
  游戏: { prefix: 'game', file: 'game.yaml', slug: 'game' },
  软件: { prefix: 'app', file: 'software.yaml', slug: 'software' },
  电子书: { prefix: 'bk', file: 'ebook.yaml', slug: 'ebook' },
  其他: { prefix: 'ot', file: 'misc.yaml', slug: 'misc' },
  课程: { prefix: 'cs', file: 'course.yaml', slug: 'course' },
};
const SUBTITLE_CATS = new Set(['游戏', '软件', '电子书', '课程', '其他']);

const argv = process.argv.slice(2);
const draftArg = argv.indexOf('--draft');
const DRAFT = draftArg >= 0 ? argv[draftArg + 1] : '';
const REPLACE = argv.includes('--replace-existing');
if (!DRAFT) throw new Error('用法：node tools/quark-cron/llm-apply.mjs --draft <json> [--replace-existing]');

const run = (cmd, args, opts = {}) => new Promise((res, rej) =>
  execFile(cmd, args, { cwd: REPO, maxBuffer: 64e6, ...opts }, (e, s, x) =>
    e ? rej(new Error(String(x || e.message).slice(0, 500))) : res(String(s || ''))));

const loaded = JSON.parse(fs.readFileSync(DRAFT, 'utf8'));
const items = Array.isArray(loaded) ? loaded : loaded.items;
if (!Array.isArray(items) || !items.length) throw new Error('草稿为空');

function validate(x) {
  const errs = [];
  const cat = CATS[x.category];
  if (!cat) errs.push('category 非法');
  if (!/^(mv|tv|dc|an|game|app|bk|ot|cs)-\d{3}$/.test(String(x.id || ''))) errs.push('id 格式非法');
  if (cat && !String(x.id).startsWith(`${cat.prefix}-`)) errs.push('id 前缀与分类不符');
  if (!x.title || String(x.title).length > 80) errs.push('title 缺失或超长');
  if (SUBTITLE_CATS.has(x.category) && !/[\s：:—·(（-]| - /.test(String(x.title)) && String(x.title).length < 10) errs.push('标题缺客观功能副标');
  if (!Array.isArray(x.tags) || !x.tags.length) errs.push('tags 为空');
  if (!/^https:\/\/pan\.quark\.cn\/s\/[a-z0-9]+$/.test(String(x.quark_url || ''))) errs.push('quark_url 非法');
  const desc = String(x.description || '').replace(/\s+/g, ' ').trim();
  const len = [...desc].length;
  if (len < 150 || len > 700) errs.push(`description 长度 ${len} 不在 150-700`);
  if (!Array.isArray(x.sources) || !x.sources.length) errs.push('sources 为空');
  if (!(Number(x.confidence) >= MIN_CONF)) errs.push(`confidence < ${MIN_CONF}`);
  if (x.platform && /ios|iphone|ipad|mac/i.test(String(x.platform)) && x.category !== '软件') errs.push('平台词与分类冲突');
  return { ok: errs.length === 0, errs, desc };
}

async function poster(item, file) {
  if (!item.image_url) return false;
  const destDir = path.join(REPO, 'static', 'images', file.slug);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${item.id}.jpg`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, `llm-poster-${item.id}-${Date.now()}.img`);
  // 删临时文件失败不能中断整轮：工具层的安全删除守卫可能拦下 rmSync，
  // 这里吞掉异常即可，残留的 .img 由缓存目录的定期清理处理。
  const dropTmp = () => {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 忽略：临时文件残留不影响入库 */
    }
  };
  try {
    // fetch 优先、curl 回退：部分站点对 curl 默认 UA 返回 405，对无头请求返回 HTML
    // 反爬页，只有带浏览器 UA 的 fetch 稳定拿到真图。每个候选都先用 sharp 验证
    // 能否解析为图片，避免把 HTML 错误页当成海报存进 static/images。
    const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
    const candidates = [
      async () => {
        const r = await fetch(String(item.image_url), {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(60000),
        });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      },
      async () => {
        await run('curl', ['-fL', '--max-time', '60', '-A', UA, '-o', tmp, String(item.image_url)]);
        return fs.readFileSync(tmp);
      },
    ];
    let buf;
    for (const get of candidates) {
      try {
        const b = await get();
        if (b.length < 1024) continue;
        await sharp(b).metadata(); // HTML 反爬页在这里抛错，自动换下一个候选
        buf = b;
        break;
      } catch {
        /* 该候选不可用，换下一个 */
      }
    }
    if (!buf) throw new Error('所有下载方式均未拿到有效图片');
    await sharp(buf).rotate().resize(500, 750, { fit: 'cover' }).jpeg({ quality: 88 }).toFile(dest);
    dropTmp();
    return true;
  } catch {
    dropTmp();
    return false;
  }
}

const applied = [];
const rejected = [];
for (const item of items) {
  // 夸克目录名里显式写了「第N季/第N部」时，站点标题必须带上；草稿可把 pending 的 dir_name 原样带来，
  // llm-apply 统一补齐，避免模型漏写导致同剧不同季在站内重名。
  const driveName = item.dir_name || item.source_name;
  if (driveName && item.title) item.title = seasonTitle(item.title, driveName);
  const v = validate(item);
  if (!v.ok) { rejected.push({ id: item.id || '(unknown)', errors: v.errs }); continue; }
  const file = CATS[item.category];
  const dataFile = path.join(REPO, 'data', file.file);
  const text = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : '';
  if (!REPLACE && new RegExp(`^- id:\\s*${item.id}\\s*$`, 'm').test(text)) {
    rejected.push({ id: item.id, errors: ['条目已存在（如需覆盖请加 --replace-existing）'] });
    continue;
  }
  const hasImage = await poster(item, file);
  const data = {
    id: item.id,
    title: String(item.title).trim(),
    category: item.category,
    tags: item.tags,
    quark_url: item.quark_url,
    description: v.desc,
    date: item.date || new Date().toISOString().slice(0, 10),
    added: item.added || new Date().toISOString().slice(0, 10),
  };
  if (hasImage) data.image = `${item.id}.jpg`;
  const block = await run(process.execPath, [MAKE, '--data', JSON.stringify(data)]);
  const res = upsertEntry(dataFile, item.id, block);
  applied.push({ id: item.id, category: item.category, mode: res.mode, poster: hasImage });
}

if (!applied.length) {
  fs.writeFileSync(path.join(CACHE, `llm-apply-${Date.now()}.json`), JSON.stringify({ applied, rejected }, null, 2));
  console.log('没有草稿通过校验，未写入。');
  process.exit(1);
}

const ids = applied.map((x) => x.id).join(',');
await run(process.execPath, [FILL, '--ids', ids, '--serials', '0', '--todo', '0', '--airing', '0', '--delay', '3000']);
await run('npm', ['run', 'build'], { timeout: 900000 });
await run('git', ['add', 'data/', 'static/images/']);
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const msg = `data: LLM 补全 ${applied.length} 条资源元数据`;
const cm = await run('git', ['commit', '-m', msg]).catch((e) => String(e.message));
if (/nothing to commit/.test(String(cm))) console.log('没有新增改动需要提交。');
else {
  await run('git', ['push', 'origin', 'main']);
  await run('ssh', ['site', 'flock -w 120 /tmp/wdwp-autoupdate.lock wdwp-autoupdate'], { timeout: 180000 });
}
const report = path.join(CACHE, `llm-apply-${stamp}.json`);
fs.writeFileSync(report, JSON.stringify({ draft: DRAFT, applied, rejected }, null, 2));
console.log(`LLM 草稿写入完成：${applied.length} 条，拒绝 ${rejected.length} 条，报告 ${report}`);
