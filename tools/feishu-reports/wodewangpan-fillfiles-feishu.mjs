#!/usr/bin/env node
/**
 * 「我的网盘.文件清单补齐」（fill-files 例行任务）完成后的飞书汇报。
 *
 * 2026-11-08 改版：从富文本 post 换成**蓝色卡片（interactive）**，与「夸克资源同步任务简报」
 * 「院采雷达 · 采集简报」同一套版式：标题固定蓝色头部一次，正文按「本轮补齐清单 →
 * 补齐进度对账 → 未入库·需人工跟进（放最后）」分段，底部 note 写结果与 commit。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-fillfiles-feishu.mjs \
 *     --name "dc-066 蓝色星球 第一季（纪录片）｜ dc-067 行星（纪录片）" \
 *     --status 成功 \
 *     --detail "本轮补成 3/3：合计 52 项 / 18.6 GB ｜ commit cde248a 已推送，等 site 下一班上线"
 *
 * 参数：
 *   --name <文本>    本轮补齐的条目清单，多条用全角｜或半角|分隔，每项形如 "<id> 标题（分类）"；
 *                    脚本按「（分类）」分组（只认站点 10 个分类名）、加 emoji，并给每条拼上
 *                    站点详情页与夸克分享链接——与「夸克资源同步任务简报」同一套写法。
 *   --id <id>        兼容旧用法：只给单个 id 时脚本从 data/*.yaml 解析标题与分类填进 name。
 *   --status <文本>  底部结果标签，默认「成功」；也可「失败」「跳过」「停手未提交」「工作区不干净」。
 *   --detail <文本>  底部补充（数量/大小/格式/commit/失败原因等）。
 *   --follow <文本>  「未入库·需人工跟进」条目，多条用｜分隔（死链候选 / 可疑数据 / 停手原因），
 *                    固定渲染在卡片最后一段；不传则不显示该段。
 *   --time <文本>    覆盖补齐时间（默认本机当前时间 YYYY-MM-DD HH:MM）。
 *   --per-day <N>    进度估算节奏，默认 36（本任务约每轮 3 条、每 2 小时一轮）。
 *   --repo <路径>    仓库路径，默认按脚本自身位置解析（可用 WDP_REPO 覆盖）。
 *   --site <URL>     站点域名前缀，默认 https://www.wodewangpan.top 。详情页路径按 id
 *                    前缀拼 /<slug>/<id>/（2026-11-15 起全站 URL 带分类，不再有 /resource/ 前缀）。
 *   --title <文本>   卡片蓝色头部标题，默认「我的网盘.资源文件清单补齐简报」。
 *   --dry-run        只打印将要发送的卡片 JSON，不发送。
 *
 * 进度段（📊 补齐进度）按分类逐行给「已完成 / 待补」，末行给合计与预计天数——
 * 数字全部由脚本自己扫 data/*.yaml，口径与 tools/fill-files.mjs 的待补队列一致。
 * 接收人：环境变量 FEISHU_TO → ~/.config/wodewangpan-feishu.env → 内置默认值。
 * 发送走飞书开放 API 直连，不依赖 lark-cli / WorkBuddy。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';
const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const has = (k) => args.includes(k);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = opt('--repo', process.env.WDP_REPO || REPO_ROOT);
const DATA_DIR = path.join(REPO, 'data');
const TITLE = opt('--title', '我的网盘.资源文件清单补齐简报');
const PER_DAY = Math.max(1, parseInt(opt('--per-day', '36'), 10) || 36);
const TO = feishuConfig().to;

/** 分类名 → emoji 前缀（与夸克同步卡片同一套） */
const EMOJI = {
  电影: '🎞', 电视剧: '📺', 纪录片: '🎬', 动漫: '🎌', 游戏: '🎮',
  软件: '💻', 电子书: '📚', 操作系统: '🖥', 其他: '📦', 课程: '🎓',
};

/** 站点域名前缀；详情页路径按 id 前缀拼 /<slug>/<id>/（与「夸克资源同步任务简报」同一套链接口径）。
 *  2026-11-15 起全站 URL 与配图目录都带分类 slug，/resource/ 前缀已成历史 */
const SITE_BASE = opt('--site', 'https://www.wodewangpan.top');

/** id 前缀 → 分类 slug（与站点 config/site.yaml 的 slugs、skill 的 site-paths.mjs 同一张表） */
const PREFIX_SLUG = {
  mv: 'movie', tv: 'tv', dc: 'documentary', an: 'anime', game: 'game',
  app: 'software', bk: 'ebook', cs: 'course', ot: 'misc',
};

function siteUrl(id) {
  const slug = PREFIX_SLUG[String(id).split('-')[0]] || '';
  return slug ? `${SITE_BASE}/${slug}/${id}/` : `${SITE_BASE}/resource/${id}/`;
}

/** 扫 data/*.yaml：算已完成 / 待补 / 预计天数，并建 id→{title,category,quark} 映射（给 --id 与链接用） */
function scanData() {
  let names = [];
  try { names = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.yaml')); } catch { return { done: 0, pending: 0, byId: new Map(), byCat: new Map() }; }
  let done = 0, pending = 0;
  const byId = new Map();
  const byCat = new Map();
  for (const name of names) {
    if (name === 'site.yaml') continue;
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    const parts = raw.split(/(\r\n|\r|\n)/);
    const lines = [];
    for (let i = 0; i < parts.length; i += 2) lines.push(i + 1 < parts.length ? parts[i] + parts[i + 1] : parts[i]);
    const starts = [];
    lines.forEach((l, i) => { if (/^- /.test(l)) starts.push(i); });
    starts.push(lines.length);
    for (let s = 0; s < starts.length - 1; s++) {
      const block = lines.slice(starts[s], starts[s + 1]).join('\n');
      const idm = block.match(/^- id:\s*(\S+)/);
      if (!idm) continue;
      const title = (block.match(/^\s*title:\s*"?(.+?)"?\s*$/m) || [])[1] || '';
      const category = (block.match(/^\s*category:\s*"?(.+?)"?\s*$/m) || [])[1] || '';
      const quark = (block.match(/^\s*quark_url:\s*"?([^"\s]+)"?/m) || [])[1] || '';
      byId.set(idm[1], { title, category, quark });
      const hasFiles = /^  files:/m.test(block);
      const hasQuark = /^\s*quark_url:\s*"?([^"\s]+)"?/m.test(block);
      const cat = category || '其他';
      if (!byCat.has(cat)) byCat.set(cat, { done: 0, pending: 0 });
      if (hasFiles) { done += 1; byCat.get(cat).done += 1; }
      else if (hasQuark) { pending += 1; byCat.get(cat).pending += 1; }
    }
  }
  return { done, pending, byId, byCat };
}
const { done, pending, byId, byCat } = scanData();
const days = pending > 0 ? Math.ceil(pending / PER_DAY) : 0;

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = opt('--time') ||
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const status = opt('--status', '成功');
const detail = opt('--detail');

// 解析 name 清单：兼容 --name（多条）与旧 --id（单条）
let nameRaw = opt('--name');
if (!nameRaw) {
  const idArg = opt('--id');
  if (!idArg) { console.error('用法: 至少给 --name "<id 标题（分类）…>" 或 --id <单条 id>'); process.exit(2); }
  const hit = byId.get(idArg);
  nameRaw = hit ? `${idArg} ${hit.title}（${hit.category}）` : idArg;
}
const entries = nameRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);

/** 站点认得的分类名（EMOJI 表 + data/*.yaml 实际出现的分类），别的括注一律不当分类 */
const KNOWN_CATS = new Set([...Object.keys(EMOJI), ...byCat.keys()]);

/**
 * 拆 "<id> 标题（分类）"。只有尾括注命中站点分类名才算分类；
 * 「本轮未取队列 · 工作区不干净（movie.yaml 待提交）」这类说明行不算分类、也不拼链接。
 */
function parseEntry(line) {
  const m = line.match(/^(.*?)（([^）]+)）\s*$/);
  const cat = m && KNOWN_CATS.has(m[2].trim()) ? m[2].trim() : '其他';
  return { cat, titled: Boolean(m && cat !== '其他'), name: (m && cat !== '其他' ? m[1] : line).trim() };
}

// 按分类分组，认不出分类的归到「📦 其他」
const groups = new Map();
for (const line of entries) {
  const { cat } = parseEntry(line);
  if (!groups.has(cat)) groups.set(cat, []);
  groups.get(cat).push(line);
}

// ---------- 组装卡片元素（与 notify-feishu.mjs 同一套：div[lark_md] + hr）----------
const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });

/**
 * 「<id> 标题（分类）」渲染成参考卡片（夸克资源同步任务简报）的同款一行：
 *   `dc-066 [蓝色星球 第一季](https://www.wodewangpan.top/documentary/dc-066/) · [夸克](https://pan.quark.cn/s/xxx)`
 * 分类已在分组 label 上体现，行内不再重复；说明行或库里查不到的 id 原样保留纯文本。
 */
function renderEntry(line) {
  const { titled, name } = parseEntry(line);
  const m = name.match(/^([a-z]+-\d+)\s+(.*)$/);
  const hit = m ? byId.get(m[1]) : null;
  if (!titled || !m || !hit) return line;
  const title = (m[2] || hit.title || m[1]).trim();
  return `${m[1]} [${title}](${siteUrl(m[1])})${hit.quark ? ` · [夸克](${hit.quark})` : ''}`;
}

const elements = [];
elements.push(md(`**补齐时间：** ${timeStr}`));
elements.push(hr());

// 本轮补齐清单
if (groups.size) {
  for (const [cat, items] of groups) {
    const label = `${EMOJI[cat] || '📦'} ${cat}`;
    const lines = [`**${label}（${items.length}）**`];
    for (const it of items) lines.push(`· ${renderEntry(it)}`);
    elements.push(md(lines.join('\n')));
    elements.push(hr());
  }
}

// 补齐进度对账（照参考卡片的 📊 段：按分类一行，带完成标记）
{
  const lines = ['**📊 补齐进度（已完成 / 待补）**'];
  const cats = [...byCat.entries()].filter(([, v]) => v.pending > 0).sort((a, b) => b[1].pending - a[1].pending);
  for (const [cat, v] of cats) lines.push(`· ${EMOJI[cat] || '📦'} ${cat}：${v.done} / ${v.pending}`);
  const full = [...byCat.entries()].filter(([, v]) => v.pending === 0).map(([cat]) => cat);
  if (full.length) lines.push(`· ✅ 已补齐：${full.map((c) => `${EMOJI[c] || '📦'} ${c}`).join('、')}`);
  lines.push(`· 合计：已完成 ${done} 条 · 待补 ${pending} 条 · 约 ${pending > 0 ? `${days} 天清完` : '已全部补齐'}（按 ${PER_DAY} 条/天估算）`);
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 未入库·需人工跟进（固定放最后）
const followRaw = opt('--follow');
if (followRaw) {
  const items = followRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (items.length) {
    const lines = [`**⚠️ 未入库 · 需人工跟进（${items.length}）**`];
    for (const s of items) lines.push(`· ${s}`);
    elements.push(md(lines.join('\n')));
    elements.push(hr());
  }
}

// 底部状态行：与参考卡片一致走 note/plain_text（note 不渲染 markdown，所以这里不能加 **）
// 「写入 N 条」只数真正带「<id> 标题（分类）」的标准行，0 写入时的说明行不算条目
const writtenCount = entries.filter((l) => parseEntry(l).titled).length;
const footerParts = [`结果：${status}`, `本轮条目 ${writtenCount} 条`, `已完成 ${done} · 待补 ${pending}`];
if (detail) footerParts.push(detail);
elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footerParts.join(' ｜ ') }] });

const card = {
  config: { wide_screen_mode: true },
  header: { template: 'blue', title: { tag: 'plain_text', content: TITLE } },
  elements,
};
const payload = JSON.stringify(card);

if (has('--dry-run')) {
  console.log(payload);
  console.log(`\n[dry-run] 本轮 ${entries.length} 条 ｜ 已完成 ${done} ｜ 待补 ${pending} ｜ 估算 ${days} 天 ｜ 接收人 ${TO}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `fill-files-${stamp}`);
try {
  const mid = await sendInteractiveCard(card, { to: TO, idempotencyKey: idem });
  console.log(`[飞书] ✓ 已推送补齐简报卡片 (message_id ${mid || 'unknown'}) ｜ 本轮 ${entries.length} 条 ｜ 已完成 ${done} ｜ 待补 ${pending} ｜ 估算 ${days} 天`);
} catch (e) {
  console.error('[发送失败]', String(e.message || e).slice(0, 600));
  process.exit(1);
}
