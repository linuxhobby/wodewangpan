#!/usr/bin/env node
/**
 * 「我的网盘.夸克预存资源搬运」任务的飞书汇报。
 *
 * 蓝色 interactive 卡片（与「我的网盘.TMDB今日热门同步简报」「我的网盘.资源文件清单补齐简报」同一套版式）：
 *   蓝色头部标题一次 → 搬运时间 → 搬运资源名称 → 跳过的分类摘要 → 底部 note 状态行。
 * 本任务把「预存资源」下 9 个分类目录的资源各搬 1 个到「SHARE」下对应分类，
 * 只搬目录、不碰站点仓库，所以脚本不读 data/*.yaml、不拼详情页/夸克链接，
 * 只把搬运到的目录名原样列出来（每条带 [目标分类名] 标签）。
 *
 * 用法：
 *   node tools/feishu-reports/wodewangpan-move-feishu.mjs \
 *     --names "[01游戏] 艾尔登法环｜[04电影] 某电影" \
 *     --status 部分成功 \
 *     --skipped "[02应用] 3 项重复，无新资源" \
 *     --detail "本轮搬运 7/9 类，源目录共剩 132 个"
 *
 * 参数：
 *   --names <文本>    本轮成功移入 SHARE 对应分类的资源目录名，多条用全角｜或半角|分隔；
 *                     建议每条写成「[目标分类名] 资源目录名」，名称本身不要含分隔符；
 *                     0 条时传一行说明（如「本轮 9 个分类均无可搬运的新资源」）。
 *   --status <文本>   底部结果标签，默认「成功」；也可「部分成功」「失败」「跳过」「未授权」「目录未找到」。
 *   --detail <文本>   底部补充（分类完成情况/剩余数量/失败原因等），可选。
 *   --skipped <文本>  本轮未搬运分类的跳过摘要（带分类标签），多条用｜分隔（可选；不传则卡片不出现该段）。
 *   --time <文本>     覆盖搬运时间（默认本机当前时间 YYYY-MM-DD HH:MM）。
 *   --title <文本>    卡片蓝色头部标题，默认「我的网盘.预存资源搬运简报」。
 *   --dry-run         只打印将要发送的卡片 JSON，不发送。
 *
 * 接收人：环境变量 FEISHU_TO → ~/.config/wodewangpan-feishu.env（缺值报错）。
 * 发送走飞书开放 API 直连，不依赖 lark-cli / WorkBuddy。
 */
import { feishuConfig, sendInteractiveCard } from './feishu-api.mjs';
const args = process.argv.slice(2);
const opt = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? d : d;
};
const has = (k) => args.includes(k);

const TITLE = opt('--title', '我的网盘.预存资源搬运简报');
const TO = feishuConfig().to;

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timeStr = opt('--time') ||
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const status = opt('--status', '成功');
const detail = opt('--detail');

const nameRaw = opt('--names');
if (!nameRaw) {
  console.error('用法: 至少给 --names "<搬运到的目录名｜…>"（0 条时传一行说明）');
  process.exit(2);
}
const names = nameRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);

const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
const hr = () => ({ tag: 'hr' });

const elements = [];
elements.push(md(`**搬运时间：** ${timeStr}`));
elements.push(hr());

// 搬运资源名称
{
  const lines = [`**📦 搬运资源（${names.length}）**`];
  for (const n of names) lines.push(`· ${n}`);
  elements.push(md(lines.join('\n')));
  elements.push(hr());
}

// 未搬运分类的跳过摘要（可选，仅当传入 --skipped 时出现）
const skipRaw = opt('--skipped');
if (skipRaw) {
  const skips = skipRaw.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (skips.length) {
    const lines = [`**↻ 跳过的分类（${skips.length}）**`];
    for (const s of skips) lines.push(`· ${s}`);
    elements.push(md(lines.join('\n')));
    elements.push(hr());
  }
}

// 底部状态行（note/plain_text 不渲染 markdown，这里不能加 **）
const footerParts = [`结果：${status}`, `资源 ${names.length} 条`];
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
  console.log(`\n[dry-run] 搬运 ${names.length} 条 ｜ 状态 ${status} ｜ 接收人 ${TO}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const idem = opt('--idempotency-key', `prestore-move-${stamp}`);
try {
  const mid = await sendInteractiveCard(card, { to: TO, idempotencyKey: idem });
  console.log(`[飞书] ✓ 已推送搬运简报卡片 (message_id ${mid || 'unknown'}) ｜ 搬运 ${names.length} 条 ｜ 状态 ${status}`);
} catch (e) {
  console.error('[发送失败]', String(e.message || e).slice(0, 600));
  process.exit(1);
}
