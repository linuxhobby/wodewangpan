# 【归档】薄内容简介补写专项

> **任务已完成**（2026-10-11）：706 条正文全部达标，`npm run list:short` 输出「没有正文少于 300 字的条目」。
> 本文保留**可复用的口径与工具链**，逐条清单已省略。日常写简介看 [content-内容规范.md](../content-内容规范.md) 即可。

---

## 一、当时的问题

详情页正文过短会被判 **thin content**——不只是排名无望，还会拉低整站的内容质量评分，连累本来够格的页面。

起点：706 个详情页里 **387 条正文不足 300 字**（占 55%）。按字数档位：

| 正文字数 | 条数 |
|---|---:|
| 0–50 | 1 |
| 50–100 | 3 |
| 100–150 | 1 |
| 150–200 | 125 |
| 200–300 | 257 |

最短 49 字，中位 210 字，最长 299 字。**没有一条是空的**，都是「写了一半」——所以是改写补厚，不是从零写。

---

## 二、收官数据

| 分类 | 薄内容 / 总数 | 状态 |
|---|---:|---|
| 电视剧 | 0 / 138 | ✅ 已清（原 106） |
| 软件 | 0 / 126 | ✅ 已清（原 85） |
| 电影 | 0 / 333 | ✅ 已清（原 112） |
| 电子书 | 0 / 8 | ✅ 已清（原 6） |
| 游戏 | 0 / 8 | ✅ 已清（原 2） |
| 动漫 | 0 / 4 | ✅ 已清（原 1） |
| 其他 | 0 / 4 | ✅ 已清（原 1） |
| 纪录片 | 0 / 79 | ✅ 已清（原 74） |
| 操作系统 | 0 / 6 | — 本来达标 |
| **合计** | **0 / 706** | **✅ 全部达标（原 387）** |

分七批完成：纪录片三批（74 条）打头，之后电视剧 / 软件 / 电影 / 小类**四条线并行**——给 `tools/fill-desc.mjs` 加了 `--draft=` 参数，每条线用自己的草稿文件，互不覆盖；各线只写自己的 `data/*.yaml`，不冲突。

---

## 三、判定标准（精确口径）

`scripts/lib/data.js` 的 `bodyLength()` 是全站唯一口径：

```js
export function bodyLength(text) {
  return [...String(text || '')
    .replace(/【[^】]*】/g, '')        // 剥掉【第 1 季 · 共 12 集】这类标签
    .replace(/｜[^｜]{1,40}\s*$/, '')  // 剥掉结尾｜TMDB 8.5 / ｜作者：xxx 署名
    .trim()].length;                  // 按 Unicode 字符计，中文一字一符
}
```

**要点**：

- `【…】` 标签和 `｜…` 署名**不计入字数**，所以正文要写满 300 字本身。
- 结尾的 `｜TMDB 8.5` 之类是数据来源署名，**不能删**，工具会自动接回。
- 建议写到 **320–400 字**，留点余量，别贴着 300 卡线。

---

## 四、工具链

```bash
# 1. 拿到待补清单（同时写入 .tmp/short-desc.md，按字数升序，最该先补的排最前）
npm run list:short
npm run list:short -- --cat=纪录片        # 只看某个分类
npm run list:short -- --limit=50          # 只列前 50 条

# 2. 把改写好的正文写进草稿文件（JSON，键是资源 id）
#    .tmp/desc-draft.json  →  { "dc-077": "新正文……", "tv-001": "新正文……" }

# 3. 空跑：只打印将要改成什么，不写盘
node tools/fill-desc.mjs

# 4. 确认无误后落盘
node tools/fill-desc.mjs --apply

# 5. 验收
npm run list:short      # 应输出「没有正文少于 300 字的条目」
npm run build           # SEO 提醒里不该再有薄内容那条
```

`tools/fill-desc.mjs` 的行为：

- 草稿文件默认 `.tmp/desc-draft.json`；加 `--draft=.tmp/xxx.json` 可换成别的，**多批并行时各用各的**，不会互相覆盖。
- 按 `- id: xxx` 定位条目块，**只改 `description` 那一行**，其余字段一字不动。
- 自动把原有的 `【第 N 季 · 共 M 集】` 头 和 `｜TMDB x.x` 后缀接回新正文。
- 以 JSON 双引号标量写回，中文 / 引号 / 换行不会破坏 YAML。
- 加 `--strict` 可让不足 300 字的草稿直接跳过不写入。

**建议分批**：每批 30–50 条，跑一次 `--apply` 后 `npm run build` 验一遍。

---

## 五、字数自查脚本

`.tmp/check-len.mjs`（`.tmp` 不入库，丢了照下面重建）：

```js
import fs from 'node:fs';
import { bodyLength, MIN_DESC } from '../scripts/lib/data.js';
const d = JSON.parse(fs.readFileSync(process.argv[2] || '.tmp/desc-draft.json', 'utf8'));
const rows = Object.entries(d).map(([id, v]) => ({ id, len: bodyLength(v) })).sort((a, b) => a.len - b.len);
rows.forEach(r => console.log(`${r.len >= MIN_DESC ? 'OK ' : '不足'} ${r.len}  ${r.id}  差 ${Math.max(0, 320 - r.len)}`));
console.log(`共 ${rows.length} 条，不足 ${MIN_DESC} 字 ${rows.filter(r => r.len < MIN_DESC).length} 条`);
```

**这条脚本是刚需**：一次写到自认「足够」，落到纸上通常只有 255–290 字，离 320 还差 30–65 字——批次里往往只有极少数能一次写够。每批写完必须跑一遍，不足的补 1–2 句再落盘。

---

## 六、已知陷阱

1. **字数口径曾不统一**：`tools/fill-desc.mjs` 曾自带一份只剥开头 `【…】` 的 `bodyLen`，和构建用的 `bodyLength` 不一致，会出现「脚本说够了、构建还在告警」。**现已统一**，两者都用 `data.js` 的 `bodyLength` / `MIN_DESC`。
2. **别给草稿加 `【…】` 头和 `｜…` 后缀**，工具会从原文接回；自己加会被判重复拼接。
3. **改完记得构建**——`data/*.yaml` 改了不构建，`public/` 里还是旧内容。
4. **构建会刷新 YAML 头部的条数注释**（`syncHeaderCounts`），看到注释行变化是正常的，不是改错。
5. **`data/*.yaml` 是 CRLF**，写脚本改条目块时正则匹配整块会失效，改用位置切片。
6. **评分要 `toFixed(1)`**，否则 `7.0` 会写成 `7`。

---

## 七、相关文件

| 文件 | 作用 |
|---|---|
| `scripts/lib/data.js` | `MIN_DESC`（标准）、`bodyLength()`（字数口径） |
| `tools/list-short-desc.mjs` | 列出薄内容，写 `.tmp/short-desc.md` |
| `tools/fill-desc.mjs` | 把草稿写回 YAML（支持 `--draft=` / `--apply` / `--strict`） |
| `data/*.yaml` | 资源数据，按分类分文件 |
| `scripts/build.js` | 构建入口，含 SEO 自检（薄内容告警在这里） |
