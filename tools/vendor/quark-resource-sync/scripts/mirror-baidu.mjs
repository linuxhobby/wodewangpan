#!/usr/bin/env node
// ⚠️【2026-11-08 起停用】将军决定：后续不再镜像百度网盘目录。
//   本脚本**不再被任何定时任务调用**（TMDB 今日热门走 trending-sync 默认关闭镜像；夸克资源同步的 SKILL.md 第 3b 步已删除镜像动作）。
//   存量：百度网盘上已建的镜像目录与 data/*.yaml 里 582 条 baidu_url/baidu_pwd 一律保持原样，不取消分享、不删目录、不改写。
//   恢复条件：只有用户当面明确要求「重新开启百度镜像」时才可调用本脚本；无人值守轮次严禁自动跑（含 --cats 对账模式，历史缺口本来就不回补）。
//   下面是停用前的原说明，保留备查。
// 存量补齐：把夸克 SHARE 分类目录里已有、但百度镜像目录里缺失的子目录，在百度**同名**建出来。
// 2026-11-01 新增（配合 trending-sync 的百度镜像；日常新增由 trending-sync 自己镜像，本脚本只处理历史缺口）。
// 用法：
//   node scripts/mirror-baidu.mjs                 # 全部三类，先列出缺口再补建（默认带占位文件）
//   node scripts/mirror-baidu.mjs --dry-run       # 只报告缺口，不动百度
//   node scripts/mirror-baidu.mjs --cats 03电视剧,05动漫   # 指定分类
//   node scripts/mirror-baidu.mjs --cats all               # SHARE 下全部非 99- 分类（历史回补用，量大会撞风控）
//   node scripts/mirror-baidu.mjs --no-placeholder
//   node scripts/mirror-baidu.mjs --limit 20      # 本轮最多补 20 条（防风控，可分轮跑）
//   node scripts/mirror-baidu.mjs --fill-placeholders [--cats all] [--dry-run]
//       # 占位回填模式：**只往百度已有目录补占位说明文件**，绝不新建/删除/改名目录。
//       #   目录里有「非 .md 条目」视为有资源 → 不动；百度 ls 不可靠，**看不见「更新通知」那份占位就判为无法确认、跳过不猜**，
//       #   免得把占位塞进真实资源目录。2026-11-08 为「占位文件由一份改两份」的百度侧存量回补而加。
//   node scripts/mirror-baidu.mjs --new-dirs list.json   # 增量模式：只镜像清单里的 {catDir,dirname,oldName?}（不碰历史缺口，供 agent 逐轮调用）
//     list.json = [{ "catDir":"04电影","dirname":"407-片名","oldName":"片名 1-2季全集" }, …]
//     oldName（选填）= 夸克改名前的原名；百度侧已有该原名目录（用户自行转存过）时**原地改名对齐**，内容随目录走，不再新建空目录。
// 判定口径：目录名逐字相同即视为同一目录；只读夸克、只在百度**新建**，绝不删除/改名任何一边的东西。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, CACHE, TMP } from './lib/config.mjs';
import { bd, bdWhoami, bdListDir, bdListEntries, bdMkdir, bdUploadFile, baiduDirPath } from './lib/baidu.mjs';
import { PLACEHOLDER_FILES, missingPlaceholders } from './lib/placeholder.mjs';

requireCfg(['SHARE_FID', 'QUARK_CLI']);
const CLI = cfg.QUARK_CLI;
const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const DRY = has('dry-run');
const NO_PLACEHOLDER = has('no-placeholder');
const LIMIT = parseInt(arg('limit', '0'), 10); // 0 = 不限
const CATS_RAW = arg('cats', '04电影,03电视剧,05动漫'); // 'all' → SHARE 下全部非 99- 分类
// 占位说明文件：2026-11-08 起两份（更新通知 + QQ 群缺失反馈），唯一定义见 ./lib/placeholder.mjs
const PLACEHOLDERS = PLACEHOLDER_FILES;
const SESSION_INPUT = '把夸克网盘已有编号目录在百度网盘同名补齐。';
const SID = `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
const REPORT = path.join(CACHE, 'mirror-baidu-last.json');

const run = (bin, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(bin, args, { maxBuffer: 64e6, ...opts }, (e, s, x) =>
      e ? rej(new Error(String(x || e.message).slice(0, 300))) : res(s)
    )
  );
const q = (args) => run(process.execPath, [CLI, ...args, '--session-input', SESSION_INPUT, '--session-id', SID]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browse(fid) {
  const TASK_DIR = path.join(CACHE, 'quark-tasks');
  fs.mkdirSync(TASK_DIR, { recursive: true });
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  const out = await q([...base, '--task-dir', TASK_DIR]).catch((e) => {
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return q(base);
  });
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  const p = JSON.parse(`"${m[1]}"`);
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

const BD = cfg.BD_PAN_CLI;
const ROOT = cfg.BAIDU_ROOT;
const report = { ran_at: new Date().toISOString(), dry_run: DRY, cats: {} };

if (!BD) { console.error('本机未找到 bdpan（config BD_PAN_CLI / 自动探测都为空）'); process.exit(1); }
const w = await bdWhoami(BD);
if (!w.ok) { console.error(`bdpan 未登录/授权失效：${w.err}\n请先在终端执行：bdpan login --device-code 重新授权`); process.exit(1); }

/**
 * 往百度 `catDir/dirname` 逐个上传给定的占位文件（800ms 限速防风控）。
 * 返回失败描述数组，空数组 = 全部成功；**永不抛错**（无人值守口径）。
 */
async function pushPlaceholders(catDir, dirname, files) {
  const bad = [];
  for (const ph of files) {
    const mdPath = path.join(TMP, ph.name);
    try {
      fs.writeFileSync(mdPath, ph.text, 'utf8');
      const up = await bdUploadFile(BD, ROOT, catDir, dirname, mdPath, ph.name);
      if (!up.ok) bad.push(`${ph.name}：${up.err}`);
    } catch (e) { bad.push(`${ph.name}：${String(e.message).slice(0, 80)}`); }
    finally { try { fs.rmSync(mdPath, { force: true }); } catch {} }
    await sleep(800);
  }
  return bad;
}

// ===== 占位回填模式 --fill-placeholders：只往百度**已有**目录补缺失的占位说明，绝不新建/删除/改名目录 =====
// 2026-11-08 为「占位文件由一份改两份」的百度侧存量回补而加。
// ⚠ 百度 app-data 子目录 ls 不可靠（时列时列不空，SKILL.md 已记），所以**只认正面证据**：
//   必须在该目录里**看见第一份「更新通知」占位**，才认定它是本流程建的空壳目录并可补第二份；
//   列成空 / 看不见通知 → 判为「无法确认」直接跳过，绝不猜测上传（否则会把占位塞进真实资源目录）。
if (has('fill-placeholders')) {
  report.mode = 'fill-placeholders';
  // 与夸克侧同一口径：存量回补只加「资源缺失反馈」那份，不给长期空着的目录写失真的 24 小时承诺
  const ONLY = arg('only', '');
  const TARGETS = ONLY ? PLACEHOLDERS.filter((f) => f.name.includes(ONLY)) : PLACEHOLDERS;
  if (ONLY && !TARGETS.length) { console.error(`--only ${ONLY} 没匹配到任何占位文件，可用：${PLACEHOLDERS.map((f) => f.name).join(' / ')}`); process.exit(1); }
  const NOTICE = PLACEHOLDERS[0].name;
  const catList = CATS_RAW.trim() === 'all'
    ? (await browse(cfg.SHARE_FID)).filter((o) => String(o.file_type) === '0').map((d) => d.filename).filter((n) => !/^99-/.test(String(n)))
    : CATS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
  const stat = { scanned: 0, has_resource: 0, already_ok: 0, filled: 0, files: 0, unverifiable: 0, ls_failed: 0, failed: [] };
  for (const catDir of catList) {
    const bl = await bdListDir(BD, ROOT, catDir);
    if (!bl.ok) { console.log(`【${catDir}】✗ 百度列目录失败：${bl.err}`); stat.failed.push({ dir: `【${catDir}】`, err: bl.err }); continue; }
    const dirs = bl.names.filter((n) => /^\d+/.test(n));
    console.log(`【${catDir}】百度编号目录 ${dirs.length} 个`);
    for (const dirname of dirs) {
      if (LIMIT && stat.filled >= LIMIT) { console.log(`  （已达 --limit ${LIMIT}，其余留到下一轮）`); break; }
      stat.scanned += 1;
      const ent = await bdListEntries(BD, baiduDirPath(ROOT, catDir, dirname));
      if (!ent.ok) { stat.ls_failed += 1; stat.failed.push({ dir: `${catDir}/${dirname}`, err: ent.err }); await sleep(800); continue; }
      // 有「非 .md 条目」（视频/子目录等）= 已有真实资源，不掺占位文件（口径同夸克侧 hasResource）
      if (ent.names.some((n) => !/\.md$/i.test(n))) { stat.has_resource += 1; continue; }
      if (!ent.names.includes(NOTICE)) { stat.unverifiable += 1; continue; } // 列空或列漏：无法确认，跳过不猜
      const miss = missingPlaceholders(ent.names, TARGETS);
      if (!miss.length) { stat.already_ok += 1; continue; }
      if (DRY) {
        stat.filled += 1; stat.files += miss.length;
        console.log(`  · ${dirname} 缺 ${miss.length} 份 → 待补（dry-run）`);
        continue;
      }
      const bad = await pushPlaceholders(catDir, dirname, miss);
      if (bad.length) stat.failed.push({ dir: `${catDir}/${dirname}`, err: bad.join(' / ').slice(0, 150) });
      else { stat.filled += 1; stat.files += miss.length; }
      console.log(`  ${bad.length ? '✗' : '+'} ${dirname}（补 ${miss.map((p) => p.name).join(' + ')}）${bad.length ? ` ${bad.join(' / ').slice(0, 120)}` : ''}`);
    }
  }
  report.fill_placeholders = stat;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  console.log(`\n===== 汇总（占位回填${DRY ? ' dry-run' : ''}）=====`);
  console.log(`扫描 ${stat.scanned} / 已有资源不动 ${stat.has_resource} / 两份已齐 ${stat.already_ok} / ${DRY ? '待补' : '已补'} ${stat.filled} 个目录共 ${stat.files} 份`);
  console.log(`看不见「更新通知」而跳过（百度 ls 不可靠，不猜测）：${stat.unverifiable} 个；ls 失败：${stat.ls_failed} 个`);
  stat.failed.slice(0, 20).forEach((f) => console.log(`  ! ${f.dir}：${String(f.err).slice(0, 120)}`));
  if (stat.failed.length > 20) console.log(`  …其余 ${stat.failed.length - 20} 条见报告`);
  console.log(`报告：${REPORT}`);
  process.exit(0);
}

// ===== 增量模式 --new-dirs：只镜像本轮传入清单里的目录（{catDir,dirname}），绝不碰历史缺口 =====
// 供「夸克资源同步」等 agent 流程用：agent 把本轮新编号的目录写成 JSON 数组传给这里，逐个在百度同名建目录+补占位（幂等）。
const NEW_DIRS_ARG = arg('new-dirs', '');
if (NEW_DIRS_ARG) {
  report.mode = 'new-dirs';
  let items;
  try { items = JSON.parse(fs.readFileSync(NEW_DIRS_ARG, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.error(`--new-dirs 读取/解析失败：${String(e.message).slice(0, 160)}`); process.exit(1); }
  if (!Array.isArray(items)) { console.error('--new-dirs 文件内容必须是数组 [{catDir,dirname}]'); process.exit(1); }
  const okList = [], failList = [], renamedList = [];
  for (const it of items) {
    const catDir = String(it.catDir ?? it.cat ?? '').trim();
    const dirname = String(it.dirname ?? it.name ?? '').trim();
    const oldName = String(it.oldName ?? it.old ?? '').trim();
    if (!catDir || !dirname) { failList.push({ item: it, baidu: '清单缺 catDir/dirname' }); console.log(`  ✗ ${JSON.stringify(it)} 字段不全`); continue; }
    const label = `${catDir}/${dirname}`;
    if (DRY) { console.log(`  · [dry] ${label}${oldName ? `（若百度已有「${oldName}」则改名对齐）` : ''}`); continue; }
    // 2026-11-04 起：传 oldName（夸克改名前原名）时，先探测百度是否已有该原名目录（用户自行转存过资源）；
    // 有 → 原地改名对齐（内容随目录走，不再新建空目录、不补占位）；没有 → 走原 mkdir 流程。
    if (oldName && oldName !== dirname) {
      let exists = false;
      const catList = await bdListDir(BD, ROOT, catDir);
      if (catList.ok) exists = catList.names.includes(oldName);
      if (!exists) { // ls 被限流时用 search 兜底（按精确路径匹配）
        const sr = await bd(BD, ['search', oldName, '--dir-only', '--page-size', '50']);
        const arr = (sr.ok && sr.data && Array.isArray(sr.data.items)) ? sr.data.items : [];
        exists = arr.some((x) => String(x.path || '') === baiduDirPath(ROOT, catDir, oldName));
      }
      if (exists) {
        const rn = await bd(BD, ['rename', `${catDir}/${oldName}`, dirname]);
        if (rn.ok) { renamedList.push(label); okList.push(label); console.log(`  ✓ ${label}（百度已有同名资源，改名对齐：${oldName} → ${dirname}，内容随目录走）`); await sleep(800); continue; }
        failList.push({ id: label, baidu: `改名对齐失败：${rn.err}` }); console.log(`  ✗ ${label} 改名对齐失败：${rn.err}`); await sleep(800); continue;
      }
    }
    const mk = await bdMkdir(BD, ROOT, catDir, dirname);
    if (!mk.ok) { failList.push({ id: label, baidu: `建目录失败：${mk.err}` }); console.log(`  ✗ ${label} 建目录失败：${mk.err}`); await sleep(800); continue; }
    let ph = 'ok（占位关闭）';
    if (!NO_PLACEHOLDER) {
      const ent = await bdListEntries(BD, baiduDirPath(ROOT, catDir, dirname));
      const miss = ent.ok ? missingPlaceholders(ent.names) : PLACEHOLDERS;
      if (!miss.length) ph = 'ok（占位已存在）';
      else {
        const bad = await pushPlaceholders(catDir, dirname, miss);
        ph = bad.length ? `占位上传失败：${bad.join(' / ').slice(0, 150)}` : 'ok';
      }
    }
    if (String(ph).startsWith('ok')) { okList.push(label); console.log(`  ✓ ${label}${ph.startsWith('ok（') ? `（${ph}）` : ''}`); }
    else { failList.push({ id: label, baidu: ph }); console.log(`  ! ${label} ${ph}`); }
    await sleep(800);
  }
  report.new_dirs = { requested: items.length, ok: okList.length, renamed: renamedList.length, failed: failList };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  console.log(`\n===== 汇总（增量 new-dirs）=====`);
  console.log(`请求 ${items.length} / 镜像成功 ${okList.length}（其中改名对齐 ${renamedList.length}）/ 失败 ${failList.length}${DRY ? '（dry-run 未动百度）' : ''}`);
  renamedList.forEach((l) => console.log(`  ↻ ${l}（改名对齐，内容已在）`));
  failList.forEach((f) => console.log(`  ! ${f.id || JSON.stringify(f.item)} ${f.baidu}`));
  console.log(`报告：${REPORT}`);
  process.exit(0);
}

const shareDirs = (await browse(cfg.SHARE_FID)).filter((o) => String(o.file_type) === '0');
// --cats all → 展开为夸克 SHARE 下所有分类目录（排除 99- 待删除前缀）；否则按逗号拆分
const CATS = CATS_RAW.trim() === 'all'
  ? shareDirs.map((d) => d.filename).filter((n) => !/^99-/.test(String(n)))
  : CATS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
for (const catDir of CATS) {
  const qd = shareDirs.find((d) => d.filename === catDir);
  if (!qd) { report.cats[catDir] = { error: `夸克找不到目录 ${catDir}` }; console.log(`【${catDir}】✗ 夸克找不到目录，跳过`); continue; }
  const qNames = (await browse(qd.fid)).filter((o) => String(o.file_type) === '0').map((o) => o.filename);
  const bl = await bdListDir(BD, ROOT, catDir);
  if (!bl.ok) { report.cats[catDir] = { error: `百度列目录失败：${bl.err}` }; console.log(`【${catDir}】✗ 百度列目录失败：${bl.err}`); continue; }
  const bSet = new Set(bl.names);
  const missing = qNames.filter((n) => !bSet.has(n));
  console.log(`【${catDir}】夸克 ${qNames.length} / 百度 ${bSet.size} / 缺失 ${missing.length}`);
  const done = [];
  let created = 0;
  for (const name of missing) {
    if (LIMIT && created >= LIMIT) { console.log(`  （已达 --limit ${LIMIT}，其余留到下一轮）`); break; }
    if (DRY) { done.push({ name, status: 'dry-run' }); continue; }
    const mk = await bdMkdir(BD, ROOT, catDir, name);
    if (!mk.ok) { done.push({ name, status: `失败：${mk.err}` }); console.log(`  ✗ ${name} ${mk.err}`); continue; }
    let ph = 'ok（占位关闭）';
    if (!NO_PLACEHOLDER) {
      // 刚 mkdir 出来的空目录，两份占位都缺
      const bad = await pushPlaceholders(catDir, name, PLACEHOLDERS);
      ph = bad.length ? `占位上传失败：${bad.join(' / ').slice(0, 150)}` : 'ok';
    }
    done.push({ name, status: 'created', placeholder: ph });
    created += 1;
    console.log(`  ✓ ${created} / ${missing.length} ${name}${ph.startsWith('ok') ? '' : `（${ph}）`}`);
    await sleep(800); // 轻限速，防百度风控
  }
  report.cats[catDir] = { quark: qNames.length, baidu_before: bSet.size, missing: missing.length, created, items: done };
}

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
const totalMiss = Object.values(report.cats).reduce((s, c) => s + (c.missing || 0), 0);
const totalNew = Object.values(report.cats).reduce((s, c) => s + (c.created || 0), 0);
console.log(`\n===== 汇总 =====`);
console.log(`${DRY ? '缺口（dry-run 未动百度）' : '已补建'}：${totalMiss} 条${DRY ? '' : ` / 本轮新建 ${totalNew} 条`}`);
console.log(`报告：${REPORT}`);
