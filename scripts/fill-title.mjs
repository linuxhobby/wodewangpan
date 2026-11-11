#!/usr/bin/env node
/**
 * 批量补/改资源标题副标（口径与 data/software.yaml 已改的 95 条一致：`原名 - 客观功能描述`）。
 *
 * 分类口径（改任何一侧都要同步 new-resource.js 的 SUBTITLE_CATS）：
 *  - 适用副标：游戏 / 软件 / 电子书 / 课程 / 其他 —— 工具、资料类，一句话说清「是什么/干什么用」。
 *  - 不适用副标：电影 / 电视剧 / 动漫 / 纪录片 —— 标题就是作品名，
 *    scripts/lib/tmdb.mjs 的剧名检索、季号识别、追更提醒与 TMDB 热门同步都按精确片名匹配，
 *    加副标会打断这些链路；详情页 <title> 也已由 render.js 拼了年份 + 分类后缀。
 *  - 已经自带副标（` - ` / `: ` / 括号 / 圆点 / 破折号）或中文长名的条目不再叠加。
 *
 * 副标必须可溯源（从该条 description / tags 提炼），**脚本不自动编造文案**；
 * 因此写盘走映射文件，盘点模式负责列出待补清单供人工/模型逐条提炼。
 *
 * 用法：
 *   node scripts/fill-title.mjs --audit                          # 盘点待补（只读，默认 30 条）
 *   node scripts/fill-title.mjs --audit --only 课程 --limit 0     # 某分类全量清单
 *   node scripts/fill-title.mjs --map /tmp/titles.json           # 空跑，只打印将要改的行
 *   node scripts/fill-title.mjs --map /tmp/titles.json --apply    # 真正写盘
 *   node scripts/fill-title.mjs --map ... --only 游戏 --apply
 *
 * map 格式：{ "game-031": "Tailscale - WireGuard 零配置组网", ... }
 *
 * 写盘方式：按 `- id:` 定位块、只替换 `  title:` 一行，逐行保留原行尾（LF），
 * 不整块重写、不写 `updated`、不动 id / URL / canonical（§5 铁律）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);

const CAT_BY_FILE = {
  'movie.yaml': '电影',
  'tv.yaml': '电视剧',
  'documentary.yaml': '纪录片',
  'anime.yaml': '动漫',
  'game.yaml': '游戏',
  'software.yaml': '软件',
  'ebook.yaml': '电子书',
  'course.yaml': '课程',
  'misc.yaml': '其他',
};
const SUBTITLE_CATS = new Set(['游戏', '软件', '电子书', '课程', '其他']);
const HAS_SUB_RE = /\s-\s|:\s|：|\(|（|•|—|\s·\s/;
const LONG_CN_RE = /[\u4e00-\u9fff]/;
const BANNED_RE = /最好|最佳|最强|第一|必备|最便捷|排第二/;

const field = (block, key) => {
  const m = block.match(new RegExp(`^  ${key}: (.+)$`, 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

/** 读全部分类，返回 [{ file, category, id, title, tags, desc, block }]；按 `- id:` 切块，不重写文件 */
function collect() {
  const rows = [];
  for (const file of fs.readdirSync(dataDir).filter((f) => f.endsWith('.yaml')).sort()) {
    const category = CAT_BY_FILE[file];
    if (!category) continue;
    const text = fs.readFileSync(path.join(dataDir, file), 'utf8');
    for (const block of text.split(/(?=^- id: )/m).slice(1)) {
      const id = (block.match(/^- id: (\S+)/m) || [])[1];
      if (!id) continue;
      rows.push({
        file,
        category,
        id,
        title: field(block, 'title'),
        tags: field(block, 'tags'),
        desc: field(block, 'description'),
      });
    }
  }
  return rows;
}

/** 是否还需要补副标：分类适用 + 标题里还没有副标 + 不是中文长名 */
function needsSubtitle(row) {
  if (!SUBTITLE_CATS.has(row.category)) return false;
  if (HAS_SUB_RE.test(row.title)) return false;
  if (LONG_CN_RE.test(row.title) && [...row.title].length >= 10) return false;
  return true;
}

function audit() {
  const only = arg('only', '');
  const limit = Number(arg('limit', '30'));
  const rows = collect().filter((r) => !only || r.category === only);
  const pending = rows.filter(needsSubtitle);
  const byCat = new Map();
  for (const r of pending) byCat.set(r.category, (byCat.get(r.category) || 0) + 1);
  console.log(`共 ${rows.length} 条，待补副标 ${pending.length} 条：`);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`  ${c}：${n} 条`);
  const show = limit === 0 ? pending : pending.slice(0, limit);
  console.log(`\n清单（${show.length} 条，--limit 0 看全量）：`);
  for (const r of show) {
    const first = r.desc.split(/[。！？]/)[0].slice(0, 60);
    console.log(`  ${r.id} | ${r.title} | ${r.tags} | ${first}`);
  }
  console.log('\n把逐条提炼好的标题写成 {"id":"新标题"} 映射，再用 --map 空跑、--apply 写盘。');
}

function validate(map, rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const errors = [];
  for (const [id, title] of Object.entries(map)) {
    const row = byId.get(id);
    if (!row) errors.push(`${id}：data/*.yaml 里找不到`);
    else if (!SUBTITLE_CATS.has(row.category)) errors.push(`${id}：${row.category} 不适用副标（影视片名要保持精确）`);
    if (typeof title !== 'string' || !/\s-\s/.test(title)) errors.push(`${id}：新标题必须含「 - 」分隔`);
    if (BANNED_RE.test(String(title))) errors.push(`${id}：含绝对化/主观用语，改为客观功能描述`);
    if ([...String(title)].length > 48) errors.push(`${id}：标题超过 48 字，副标建议 8~12 字`);
    if (String(title).includes('"')) errors.push(`${id}：标题不要含双引号`);
  }
  if (errors.length) {
    console.error('校验未通过，一个字都没写：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  return byId;
}

function apply(map, byId) {
  const only = arg('only', '');
  const targets = Object.keys(map).filter((id) => !only || byId.get(id).category === only);
  const byFile = new Map();
  for (const id of targets) {
    const file = byId.get(id).file;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(id);
  }

  let changed = 0;
  let same = 0;
  const preview = [];
  for (const [file, ids] of byFile) {
    const p = path.join(dataDir, file);
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    let cur = null;
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^- id: (\S+)/);
      if (m) {
        cur = m[1];
        continue;
      }
      if (!cur || !ids.includes(cur) || !/^  title: /.test(lines[i])) continue;
      if (seen.has(cur)) throw new Error(`${file} 里 ${cur} 出现多条 title 行`);
      seen.add(cur);
      const old = lines[i].slice(9).trim().replace(/^"|"$/g, '');
      const next = map[cur];
      if (old === next) {
        same++;
        continue;
      }
      preview.push(`  ${cur}  ${old}  →  ${next}`);
      lines[i] = `  title: "${next}"`;
      changed++;
    }
    const miss = ids.filter((id) => !seen.has(id));
    if (miss.length) throw new Error(`${file} 里找不到 title 行：${miss.join(', ')}`);
    if (has('apply')) fs.writeFileSync(p, lines.join('\n'));
  }
  console.log(preview.slice(0, 40).join('\n') || '（无变化）');
  if (preview.length > 40) console.log(`  … 另有 ${preview.length - 40} 条`);
  console.log(`\n${has('apply') ? '已写入' : '空跑（未写盘）'}：改 ${changed} 条，标题相同跳过 ${same} 条。`);
  if (!has('apply') && changed) console.log('确认无误后加 --apply 写盘，随后 npm run build 两次并抽查详情页 H1。');
}

const rows = collect();
if (has('audit')) {
  audit();
} else {
  const mapFile = arg('map');
  if (!mapFile) {
    console.error('用法：node scripts/fill-title.mjs --audit [--only 分类] [--limit N]');
    console.error('      node scripts/fill-title.mjs --map <映射.json> [--only 分类] [--apply]');
    process.exit(1);
  }
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const byId = validate(map, rows);
  apply(map, byId);
}
