#!/usr/bin/env node
// 扫描夸克网盘 SHARE 下各分类目录，找出"未编号"的新增目录，并给出编号分配方案。
// 2026-11-04 起：编号改成「空洞优先」——列出网盘上已释放的空洞编号（补位用），不再只给 max+1。
// 输出：人类可读摘要 + JSON（写入 --out 或 /tmp/scan-new.json）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cfg, requireCfg, TMP, QUARK_TASK_DIR } from './lib/config.mjs';
import { usedSet, holesOf, classifyHoles, pad3 } from './lib/number.mjs';
import { idOccupancy } from './lib/yaml-store.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CLI = cfg.QUARK_CLI;
const SHARE_FID = arg('share-fid', cfg.SHARE_FID);
requireCfg(['QUARK_CLI', 'SHARE_FID']);
const OUT = arg('out', path.join(TMP, 'scan-new.json'));

const run = (args) =>
  new Promise((res, rej) =>
    execFile('node', [CLI, ...args], { maxBuffer: 64e6 }, (e, s) => (e ? rej(e) : res(s)))
  );

// browse 把条目写到 jsonl，返回解析后的数组
async function browse(fid) {
  const base = ['browse', '--all', '--page-size', '100', '--parent-fid', fid];
  fs.mkdirSync(QUARK_TASK_DIR, { recursive: true });
  const out = await run([...base, '--task-dir', QUARK_TASK_DIR]).catch((e) => {
    // 旧版 CLI 不认 --task-dir（报 unknown option），回退到默认落盘位置
    if (!/unknown option|--task-dir/.test(String(e.message))) throw e;
    return run(base);
  });
  // artifact 行的 file_path 含 JSON 转义（Windows 为 C:\\Users\\...），取出来再反转义
  const m = out.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*\.jsonl)"/);
  if (!m) throw new Error(`browse 未返回 jsonl：${out.slice(0, 200)}`);
  return fs
    .readFileSync(JSON.parse(`"${m[1]}"`), 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map(JSON.parse);
}

// SHARE 下的分类目录 → 站点分类、id 前缀、数据文件（2026-11-10 起 9 个分类，游戏/软件/电子书/课程同样编号）
// 「操作系统」已于 2026-11-10 并入「软件」：盘端 `09操作系统` 目录与站点 `data/os.yaml` 都已不存在，
// 系统镜像类资源现在住在 `02应用`，走 `app-` 前缀。这里**故意不再登记 os**——万一网盘重新出现
// `09操作系统` 目录，它会落到下面的 unmapped 分支，只打印「站点无对应分类，不入库」，
// 而不是重新生成 data/os.yaml（那会让 /category/os/ 页面与 sitemap 复活，撞上线上 nginx 的 301）。
const CATS = [
  { dir: '04电影', key: '电影', prefix: 'mv', file: 'movie.yaml' },
  { dir: '03电视剧', key: '电视剧', prefix: 'tv', file: 'tv.yaml' },
  { dir: '06纪录片', key: '纪录片', prefix: 'dc', file: 'documentary.yaml' },
  { dir: '05动漫', key: '动漫', prefix: 'an', file: 'anime.yaml' },
  { dir: '01游戏', key: '游戏', prefix: 'game', file: 'game.yaml' },
  { dir: '02应用', key: '软件', prefix: 'app', file: 'software.yaml' },
  { dir: '08电子书', key: '电子书', prefix: 'bk', file: 'ebook.yaml' },
  { dir: '010其他', key: '其他', prefix: 'ot', file: 'misc.yaml' },
  { dir: '07课程', key: '课程', prefix: 'cs', file: 'course.yaml' },
];

// 不参与同步的目录：转存待清理，不编号、不出链、不入站。
// 目录名用户随时会改（曾用「99-待删除」，现为「99-需要删除的移动到这里」），一律按 99- 前缀判定。
const isExcluded = (name) => /^99\s*[-.]/.test(String(name));

// 目录名匹配：先用完整目录名，再用「去掉前导数字」后的名字（网盘目录改名也能对上）
const stripNum = (s) => String(s).replace(/^\d+\s*/, '');
const sameName = (a, b) => a === b || norm(a) === norm(b);
const matchCat = (name) =>
  CATS.find((c) => c.dir === name) || CATS.find((c) => sameName(stripNum(name), c.key));

// 归一化：去编号前缀、括号内容、分隔符，用于重复比对
const norm = (s) =>
  String(s)
    .replace(/^\d+\s*[-.]/, '')
    .replace(/[\[\(【].*?[\]\)】]/g, '')
    .replace(/[\s·・:：\-_.]/g, '')
    .toLowerCase();

const dirs = (await browse(SHARE_FID)).filter((o) => String(o.file_type) === '0');
// 全站 data/*.yaml 的 id → 文件：用来判断空洞编号能否直接用（REPO 未配置时退化为「不判定」）
const REPO = cfg.REPO;
const occupancy = REPO && fs.existsSync(path.join(REPO, 'data')) ? idOccupancy(path.join(REPO, 'data')) : new Map();
const result = {
  scanned_at: new Date().toISOString(),
  share_fid: SHARE_FID,
  occupancy_checked: occupancy.size > 0,
  excluded: [],
  categories: [],
};

// 遍历 SHARE 下所有目录（「99-待删除」等排除项跳过）
for (const dir of dirs) {
  if (isExcluded(dir.filename)) {
    result.excluded.push({ dir: dir.filename, fid: dir.fid });
    continue;
  }
  const c = matchCat(dir.filename) || { key: dir.filename, prefix: null, file: null, unmapped: true };
  const all = await browse(dir.fid);
  const items = all.filter((o) => String(o.file_type) === '0'); // 资源一律是目录，散落文件单独计数
  const numbered = items.filter((o) => /^\d+\s*[-.]/.test(o.filename));
  const unnumbered = items.filter((o) => !/^\d+\s*[-.]/.test(o.filename));

  // 网盘上已占用的编号 + 现有最大编号：空洞优先的判定基准（夸克实时目录是唯一权威）
  const used = usedSet(numbered.map((o) => o.filename));
  const maxNum = used.size ? Math.max(...used) : 0;
  const cls =
    c.prefix && c.file
      ? classifyHoles(used, maxNum, { prefix: c.prefix, file: c.file, occupancy })
      : { free: [], reclaim: [], blocked: [] };
  const allocatable = [...cls.free, ...cls.reclaim].sort((a, b) => a - b);
  const nextNum = allocatable.length ? allocatable[0] : maxNum + 1;
  const next_kind = cls.reclaim.includes(nextNum)
    ? 'reclaim_rewrite'
    : allocatable.includes(nextNum)
      ? 'hole'
      : 'append';

  const list = unnumbered.map((o) => {
    const kp = norm(o.filename);
    const hit = numbered.find((n) => {
      const kn = norm(n.filename);
      return kn === kp || kn.includes(kp) || (kp.length >= 3 && kp.includes(kn));
    });
    return {
      filename: o.filename,
      fid: o.fid,
      updated_at: o.updated_at ? new Date(o.updated_at).toISOString().slice(0, 10) : null,
      likely_duplicate_of: hit ? hit.filename : null,
    };
  });

  result.categories.push({
    ...c,
    dir: dir.filename,
    dir_fid: dir.fid,
    total: items.length,
    numbered: numbered.length,
    loose_files: all.length - items.length,
    max_number: pad3(maxNum),
    // 编号分配方案（2026-11-04 空洞优先）
    next_number: pad3(nextNum),
    next_kind, // hole=补纯空洞 / reclaim_rewrite=补位并就地改写站点旧条目 / append=顺延
    holes: allocatable.map(pad3),
    holes_free: cls.free.map(pad3),
    holes_reclaim: cls.reclaim.map(pad3),
    holes_blocked: cls.blocked.map((n) => `${c.prefix}-${pad3(n)}`),
    unnumbered: list,
  });
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

let todo = 0;
const KIND_TXT = { hole: '空洞补位', reclaim_rewrite: '空洞补位·站点旧条目待改写', append: '顺延' };
const brief = (arr, n = 20) => (arr.length > n ? `${arr.slice(0, n).join(' ')} …（共 ${arr.length} 处）` : arr.join(' ') || '无');
for (const c of result.categories) {
  const head = c.unmapped
    ? `【${c.dir}】⚠ SHARE 下有此目录，但站点无对应分类（只列出，不入库）`
    : `【${c.dir}】共 ${c.total} 项（已编号 ${c.numbered}，最大 ${c.max_number}）→ 下一编号 ${c.prefix}-${c.next_number}（${KIND_TXT[c.next_kind]}）`;
  console.log(head + (c.loose_files ? `  （另有 ${c.loose_files} 个散落文件，未计入）` : ''));
  if (!c.unmapped) {
    console.log(`  可补位空洞：${brief(c.holes)}${c.holes_reclaim.length ? `（其中 ${c.holes_reclaim.length} 处站点还留着旧条目 → 补位时就地改写：${brief(c.holes_reclaim, 10)}）` : ''}`);
    if (c.holes_blocked.length)
      console.log(`  ⚠ 以下空洞编号的 id 被别的分类文件占用，本轮不要用：${brief(c.holes_blocked, 10)}`);
    if (c.unnumbered.length > c.holes.length)
      console.log(`  待编号 ${c.unnumbered.length} 个 > 空洞 ${c.holes.length} 处，超出部分按最大编号顺延`);
  }
  if (!c.unnumbered.length) {
    console.log('  无未编号目录 ✓');
  } else {
    for (const u of c.unnumbered) {
      todo++;
      console.log(`  · ${u.filename}  (${u.updated_at})`);
      if (u.likely_duplicate_of) console.log(`      ⚠ 疑似重复于 → ${u.likely_duplicate_of}`);
    }
  }
}
if (!result.occupancy_checked)
  console.log('\n⚠ 未配置 REPO，未校验站点 id 占用（空洞是否已被别的分类占用无法判断）');
if (result.excluded.length)
  console.log(`\n已跳过：${result.excluded.map((e) => e.dir).join(' / ')}（不扫描、不入库）`);
console.log(`\nJSON 已写入 ${OUT}；待处理未编号目录 ${todo} 个`);
