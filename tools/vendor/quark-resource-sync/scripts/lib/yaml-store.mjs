/**
 * 站点 data/*.yaml 条目读写 —— 支持「按 id 就地改写」（2026-11-04 新增，配合编号回收修死链）
 *
 * 背景：编号改成空洞优先之后，新资源会拿到一个网盘上已释放、但站点里可能还留着旧条目的编号。
 * 那种旧条目正是死链（网盘目录已删，链接点了就是失效页），处理口径是**就地改写**：id 与详情页
 * `/resource/<id>/` 地址不变，内容整块换成新资源，条目总数不变。
 *
 * 为什么不用「按 `- id:` 切块再 join 重写」那种写法（SKILL.md 第 492 行踩过坑）：
 * 它只保留条目块，会把文件头的 `# XX资源（N 条）` 注释整段丢掉。本模块全程在**完整行数组**上
 * 操作，只替换目标条目那一段，写之前还要校验条目数与首行注释，坏了就不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 条目起始行：`- id: mv-046` */
export const ENTRY_RE = /^- id: (\S+)[ \t]*$/;

/** 全站 data/*.yaml 的 id → 所在文件名（用于判断编号是否被别的分类占用） */
export function idOccupancy(dataDir) {
  const map = new Map();
  if (!fs.existsSync(dataDir)) return map;
  for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.yaml'))) {
    const raw = fs.readFileSync(path.join(dataDir, f), 'utf8');
    for (const m of raw.matchAll(/^- id: (\S+)[ \t]*$/gm)) map.set(m[1], f);
  }
  return map;
}

const toArr = (s) => String(s).split(/\r?\n/);
const countEntries = (lines) => lines.filter((l) => ENTRY_RE.test(l)).length;

/**
 * 写入一条条目：文件里已有同 id 就**整块就地替换**（死链改写），没有就追加到末尾。
 * @param {string} filePath  data/<分类>.yaml 绝对路径
 * @param {string} id        形如 mv-046
 * @param {string} block     完整 YAML 块文本（make-entry.mjs 的输出即可，首行须是 `- id: <id>`）
 * @returns {{mode:'replaced'|'appended', before:number, after:number, eol:string}}
 */
export function upsertEntry(filePath, id, block) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = toArr(raw);
  const before = countEntries(lines);
  if (!before && !/^#/.test(lines[0] || '')) throw new Error(`${path.basename(filePath)} 里没有条目，且首行不是注释，拒绝写入`);

  // 规范块文本：去首尾空行，制表符转空格
  const body = toArr(block).map((l) => l.replace(/\t/g, '    '));
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (!body.length || body[0].trim() !== `- id: ${id}`)
    throw new Error(`写入块首行必须是 "- id: ${id}"，当前：${body[0] ?? '(空)'}`);

  const start = lines.findIndex((l) => l.trim() === `- id: ${id}`);
  let mode;
  if (start < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', ...body, '');
    mode = 'appended';
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (ENTRY_RE.test(lines[i])) { end = i; break; }
    lines.splice(start, end - start, ...body, '');
    mode = 'replaced';
  }

  const after = countEntries(lines);
  const expect = mode === 'replaced' ? before : before + 1;
  if (after !== expect) throw new Error(`条目数校验不过（${before} → ${after}，应为 ${expect}），未写入`);

  // 头部 `# XX资源（N 条）` 注释跟着真实条数走；没有这句式的文件不动
  if (/^#\s.*（\d+ 条）/.test(lines[0])) {
    lines[0] = lines[0].replace(/（\d+ 条）/, `（${after} 条）`);
  }
  if (!/^#/.test(lines[0])) throw new Error('首行注释在校验后丢失，未写入');

  fs.writeFileSync(filePath, lines.join(eol));
  return { mode, before, after, eol };
}
