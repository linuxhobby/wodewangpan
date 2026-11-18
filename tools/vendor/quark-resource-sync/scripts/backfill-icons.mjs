#!/usr/bin/env node
// 给软件（app-）等缺海报的资源补图：官方图标 → poster.mjs icon 合成竖版海报 → 写回 image 字段。
//
// 图标来源（按质量取尺寸最大的那个）：
//   1) iTunes Search（cn/us × Mac/iOS 软件，要求同名精确匹配，512×512）
//   2) GitHub 仓库 raw 候选路径（开源应用的 logo / icon / Tauri src-tauri/icons）
//   3) 官网 apple-touch-icon / favicon / og:image（横幅类会被方形比例过滤）
//   4) Google favicon 服务（兜底）
//
// 用法：
//   node backfill-icons.mjs --dry --limit 5                          # 预览，不落盘
//   node backfill-icons.mjs --only app-010,app-011                   # 只处理指定 id
//   node backfill-icons.mjs --map app-010=https://www.openshot.org   # 手工指定主页（简介里没链接时用）
//   node backfill-icons.mjs                                          # 全量（写前自动备份 data 文件）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
// 本脚本自己的 TMP 是仓库内图标缓存目录，故配置里的系统临时目录用别名导入
import { cfg, requireCfg, TMP as SYS_TMP } from './lib/config.mjs';

const { PROXY } = cfg;
requireCfg(['REPO']);
const REPO = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : cfg.REPO;

const argvOf = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const DRY = process.argv.includes('--dry');
const DEBUG = process.argv.includes('--debug');
const LIMIT = Number(argvOf('limit') || 0);
const ONLY = (argvOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const HOMES = Object.fromEntries(
  (argvOf('map') || '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf('=');
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    })
);
const FILES = process.argv.filter((a, i) => process.argv[i - 1] === '--file');
const TARGETS = FILES.length ? FILES : ['software.yaml'];
const CONC = Number(process.env.CONC || 3);
const IMG_DIR = path.join(REPO, 'static', 'images');
const ICON_POSTER = path.join(REPO, 'tools', 'poster.mjs');
// 临时目录放仓库内：系统临时目录偶发 EPERM（被占用/杀软扫描）
const TMP = path.join(REPO, '.cache', 'icons-tmp');
fs.mkdirSync(TMP, { recursive: true });

const require = createRequire(path.join(REPO, 'package.json'));
const yaml = require('js-yaml');
const sharp = require('sharp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 32e6, ...opts }, (e, s, x) => (e ? rej(new Error(String(x || e.message).slice(0, 200))) : res(s)))
  );

const PALETTE = [
  ['#2f6f5e', '#8fd3b6'],
  ['#3a5f8a', '#9ec9ef'],
  ['#7a4a72', '#d7a8cf'],
  ['#8a5a33', '#e3b98f'],
  ['#4a5a8a', '#a8b6ef'],
  ['#5f6f3a', '#cbd69a'],
  ['#6a3a4a', '#d69ab0'],
  ['#3a6a6a', '#9ad6d6'],
];

const GH_CANDIDATES = [
  'assets/logo.png', 'assets/icon.png', 'assets/AppIcon.png', 'assets/logo.svg',
  'logo.png', 'icon.png', 'Icon.png', 'Logo.png',
  'build/icon.png', 'build/logo.png',
  'src-tauri/icons/icon.png', 'src-tauri/icons/512x512.png', 'src-tauri/icons/128x128.png',
  'resources/icon.png', 'Resources/icon.png', 'resources/logo.png',
  'src/assets/logo.png', 'src/assets/icon.png',
  'static/logo.png', 'public/logo.png', 'public/icon.png',
  'docs/logo.png', 'images/logo.png', 'media/logo.png', '.github/logo.png', 'app/icon.png',
];

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s:：·、,，.。!！?？'"“”‘’()（）[\]【】\-—_/\\+&]/g, '');

const tmpFile = (ext) => path.join(TMP, `${process.pid}-${Math.random().toString(36).slice(2)}${ext}`);

// -f：HTTP 错误码直接判失败，好回退到直连（代理返回错误页时会误当成成功）
const curlTo = async (url, out) => {
  try {
    await run('curl', ['-s', '-f', '-L', '-m', '30', ...(PROXY ? ['-x', PROXY] : []), '-o', out, url]);
  } catch {
    try {
      await run('curl', ['-s', '-f', '-L', '-m', '30', '-o', out, url]);
    } catch {
      /* ignore */
    }
  }
  return fs.existsSync(out) ? fs.statSync(out).size : 0;
};
const curlText = async (url) => {
  const f = tmpFile('.txt');
  const sz = await curlTo(url, f);
  const t = sz ? fs.readFileSync(f, 'utf8') : '';
  fs.rmSync(f, { force: true });
  return String(t).replace(/^\uFEFF/, '');
};

const fetchBuf = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};
/** 下载到内存：fetch 直连优先，失败退 curl（走代理） */
const download = async (url) => {
  try {
    const b = await fetchBuf(url);
    if (b.length >= 500) return b;
  } catch {
    /* 走 curl */
  }
  const f = tmpFile('.img');
  const sz = await curlTo(url, f);
  if (sz < 500) {
    fs.rmSync(f, { force: true });
    return null;
  }
  const b = fs.readFileSync(f);
  fs.rmSync(f, { force: true });
  return b;
};
const fetchText = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    return await r.text();
  } catch {
    return curlText(url);
  }
};

/** 可用边长：横幅类（宽高比超出 0.6~1.7）视为不可用，返回 0 */
const sizeOfBuf = async (b) => {
  try {
    const m = await sharp(b).metadata();
    const w = m.width || 0;
    const h = m.height || 0;
    const ratio = h ? w / h : 0;
    return ratio >= 0.6 && ratio <= 1.7 ? Math.min(w, h) : 0;
  } catch {
    return 0;
  }
};

/** 主页：--map 指定 > 简介里第一个 http(s) 链接 */
function homepageOf(r) {
  if (HOMES[r.id]) return HOMES[r.id];
  const m = String(r.description || '').match(/https?:\/\/[^\s）)"']+/);
  return m ? m[0].replace(/[，。）]$/, '') : '';
}

/** 收集图标候选（GH 候选顺带把图下下来，减少落盘次数） */
async function iconCandidates(r) {
  const out = [];
  const name = r.title;
  const url = homepageOf(r);

  // 1) iTunes 精确同名（cn + us，Mac 与 iOS）
  for (const country of ['cn', 'us']) {
    for (const entity of ['macSoftware', 'software']) {
      const t = await fetchText(
        `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=${entity}&country=${country}&limit=5`
      );
      let j = null;
      try {
        j = JSON.parse(String(t).trim());
      } catch {
        continue;
      }
      const hit = ((j && j.results) || []).find((x) => norm(x.trackName) === norm(name));
      if (hit) {
        const u = hit.artworkUrl512 || String(hit.artworkUrl100 || '').replace(/100x100bb/, '512x512bb');
        if (u) out.push({ url: u, source: `iTunes ${country}/${entity}｜${hit.trackName}`, genre: hit.primaryGenreName });
      }
    }
  }

  // 2) GitHub 仓库 raw 候选
  const gh = /github\.com\/([^/]+)\/([^/]+)/.exec(url || '');
  if (gh) {
    await Promise.all(
      GH_CANDIDATES.map(async (p) => {
        const buf = await download(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/HEAD/${p}`);
        if (!buf) return;
        const px = await sizeOfBuf(buf);
        if (px >= 48) out.push({ url: `GH ${p}`, source: `GH ${p}`, buf, px });
      })
    );
    // 候选路径都没命中时，退一步从 README 里的图片找（方形优先，跳过横幅）
    if (!out.some((o) => o.source.startsWith('GH '))) {
      const rd = await download(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/HEAD/README.md`);
      const imgs = rd
        ? [...rd.toString('utf8').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
            .map((m) => m[1])
            .filter((u) => /\.(png|jpe?g|webp|svg)$/i.test(u))
            .slice(0, 5)
        : [];
      for (const u of imgs) {
        const abs = /^https?:/.test(u)
          ? u
          : `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/HEAD/${u.replace(/^\.?\//, '')}`;
        const buf = await download(abs);
        if (!buf) continue;
        const px = await sizeOfBuf(buf);
        if (px >= 48) {
          out.push({ url: abs, source: `GH README ${u.slice(0, 30)}`, buf, px });
          break;
        }
      }
    }
    // 再兜底：GitHub API 树里找名字含 icon / logo 的图片（未鉴权限 60 次/小时，够用）
    if (!out.some((o) => o.source.startsWith('GH '))) {
      const t = await fetchText(`https://api.github.com/repos/${gh[1]}/${gh[2]}/git/trees/HEAD?recursive=1`);
      let j = null;
      try {
        j = JSON.parse(t);
      } catch {
        j = null;
      }
      const files = ((j && j.tree) || [])
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f.path) && /(icon|logo)/i.test(f.path))
        .slice(0, 10);
      for (const f of files) {
        const buf = await download(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/HEAD/${f.path}`);
        if (!buf) continue;
        const px = await sizeOfBuf(buf);
        if (px >= 48) out.push({ url: `GH tree ${f.path}`, source: `GH tree ${f.path.slice(0, 40)}`, buf, px });
      }
    }
  }

  // 3) 官网 apple-touch-icon / favicon / og:image（GitHub 主页跳过）
  if (url && !gh) {
    const html = await fetchText(url);
    if (DEBUG) console.log(`   [debug] ${r.id} home=${url} html=${String(html).length}`);
    const hrefs = [...html.matchAll(/<link[^>]+rel=["']?[a-z-]*apple-touch-icon[^>]*>/gi)]
      .map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1])
      .filter(Boolean);
    const icons = [...html.matchAll(/<link[^>]+rel=["']?(?:shortcut )?icon["'][^>]*>/gi)]
      .map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1])
      .filter(Boolean);
    const og =
      (html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] ||
      (html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1] ||
      '';
    const list = [...new Set([...hrefs, ...icons, og])].filter(Boolean).slice(0, 5);
    try {
      const o = new URL(url).origin;
      list.push(`${o}/apple-touch-icon.png`, `${o}/apple-touch-icon-precomposed.png`);
    } catch {
      /* ignore */
    }
    for (const h of list) {
      let abs;
      try {
        abs = /^https?:/.test(h) ? h : new URL(h, url).toString();
      } catch {
        continue;
      }
      out.push({ url: abs, source: `官网 ${h.slice(0, 40)}` });
    }
  }

  // 4) Google favicon 兜底
  if (url) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    // GitHub 域名不能用 favicon 兜底（会拿到 GitHub 自己的标志）
    if (host && !/(^|\.)github\.com$/.test(host)) {
      out.push({ url: `https://www.google.com/s2/favicons?domain=${host}&sz=256`, source: 'Google favicon' });
    }
  }
  return out;
}

/** 写入（或替换）条目里的 image 字段，保持其余内容原样 */
function setImage(text, id, value) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*['"]?${id}['"]?\\s*$`).test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+id:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const line = `  image: ${value}`;
  for (let i = start; i < end; i++) {
    if (/^\s{2}image:/.test(lines[i])) {
      lines[i] = line;
      return { text: lines.join('\n'), mode: 'replace' };
    }
  }
  let last = start;
  for (let i = start; i < end; i++) if (lines[i].trim()) last = i;
  lines.splice(last + 1, 0, line);
  return { text: lines.join('\n'), mode: 'insert' };
}

let total = 0;
let updated = 0;
const failed = [];
const backupDir = path.join(SYS_TMP, `backfill-icons-${Date.now()}`);

for (const file of TARGETS) {
  const full = path.join(REPO, 'data', file);
  if (!fs.existsSync(full)) {
    console.log(`（跳过：${file} 不存在）`);
    continue;
  }
  const orig = fs.readFileSync(full, 'utf8');
  const arr = yaml.load(orig) || [];
  let cands = arr.filter((r) => r && r.id).filter((r) => !r.image || !fs.existsSync(path.join(IMG_DIR, String(r.image))));
  if (ONLY.length) cands = cands.filter((r) => ONLY.includes(r.id));
  if (LIMIT) cands = cands.slice(0, LIMIT);
  if (!cands.length) {
    console.log(`${file}：无缺图条目`);
    continue;
  }
  console.log(`${file}：待补图 ${cands.length} 条`);

  const done = [];
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const rs = await Promise.all(
      slice.map(async (r) => {
        try {
          const list = await iconCandidates(r);
          if (!list.length) return { r, err: '无任何图标来源' };
          let best = null;
          for (const c of list) {
            const buf = c.buf || (await download(c.url));
            if (DEBUG) console.log(`   [debug] cand ${c.source} → buf=${buf ? buf.length : 0}`);
            if (!buf || buf.length < 1000) continue;
            const px = c.px || (await sizeOfBuf(buf));
            if (DEBUG) console.log(`   [debug]   px=${px}`);
            if (px < 48) continue;
            if (!best || px > best.px) best = { px, buf, source: c.source, genre: c.genre };
            if (best.px >= 256) break;
          }
          if (!best) return { r, err: '候选图都不可用' };
          if (DRY) return { r, ok: true, px: best.px, source: best.source };
          const iconFile = tmpFile('.img');
          fs.writeFileSync(iconFile, best.buf);
          const outJpg = path.join(IMG_DIR, `${r.id}.jpg`);
          const [c1, c2] = PALETTE[i % PALETTE.length];
          const iconSize = best.px >= 256 ? 300 : best.px >= 128 ? 240 : 180;
          await run(process.execPath, [
            ICON_POSTER,
            '--icon', iconFile,
            '--out', outJpg,
            '--title', r.title,
            '--sub', best.genre || 'macOS 应用',
            '--c1', c1,
            '--c2', c2,
            '--icon-size', String(iconSize),
          ]);
          fs.rmSync(iconFile, { force: true });
          if (!fs.existsSync(outJpg) || fs.statSync(outJpg).size < 5000) throw new Error('海报生成失败');
          return { r, ok: true, px: best.px, source: best.source, image: `${r.id}.jpg` };
        } catch (e) {
          return { r, err: String(e.message).slice(0, 90) };
        }
      })
    );
    done.push(...rs);
    process.stdout.write(`  …${Math.min(i + CONC, cands.length)}/${cands.length}\r`);
    await sleep(200);
  }
  total += cands.length;

  let text = orig;
  let fileUpdated = 0;
  for (const d of done) {
    if (d.err || !d.ok) {
      failed.push(`${d.r.id} ${d.r.title} → ${d.err || '未知错误'}`);
      continue;
    }
    if (DRY) {
      console.log(`［预览］${d.r.id} ${d.r.title} → ${d.px}px ${d.source}`);
      continue;
    }
    const out = setImage(text, d.r.id, d.image);
    if (!out) {
      failed.push(`${d.r.id} ${d.r.title} → 未找到条目块`);
      continue;
    }
    text = out.text;
    fileUpdated++;
    updated++;
    console.log(`✅ ${d.r.id} ${d.r.title} → ${d.image}（${d.px}px · ${d.source}）`);
  }

  if (!DRY && fileUpdated && text !== orig) {
    try {
      yaml.load(text);
    } catch (e) {
      console.error(`✗ ${file} 写入前 YAML 校验失败，未改动文件：${String(e.message).slice(0, 140)}`);
      continue;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(full, path.join(backupDir, file));
    fs.writeFileSync(full, text);
    console.log(`\n  ${file}：写入 ${fileUpdated} 条（备份 ${backupDir}\\${file}）`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n共检查 ${total} 条，${DRY ? '预计补图' : '已补图'} ${updated} 条，失败 ${failed.length} 条`);
if (failed.length) console.log('失败明细：\n  ' + failed.join('\n  '));
if (DRY) console.log('（--dry 未写图也未改数据，去掉该参数即执行）');
