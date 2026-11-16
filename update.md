# 更新记录（2026-11-16）

本轮针对全站代码做了一次体检与优化，原则是「少量、按职责的模块 + 适度局部重构」：
修掉明确的 Bug 与冗余，同时避免把 `render.js` 这类模板代码拆成一地碎片。
以下按主题记录改了什么、为什么改、怎么验证。

---

## 1. Bug 修复

### 1.1 `scripts/lib/assets.js` — `resolveSource` 重复候选路径
- 问题：`item.image` 存在时，候选列表里 `static/images/<item.image>` 被加入了两次（`path.join(staticDir, item.image)` 重复），属实现疏忽。
- 修复：候选路径去重，并理顺优先级：
  1. `static/images/<分类 slug>/<文件名>`（2026-11-15 起的分类目录）
  2. 旧平铺 `static/images/<image>`（兼容旧路径）
  3. `rootDir/<image>`（历史相对路径）
  4. 仅当 `image` 含子路径且非绝对路径时，再尝试 `static/<image>`
- 影响：行为不变（只是少一次无意义的存在性检查），可读性更好。

### 1.2 `scripts/serve.js` — 非法 URL 编码导致预览服务崩溃
- 问题：`decodeURIComponent(req.url)` 遇到非法百分号编码会抛错，整个本地预览进程退出。
- 修复：`try/catch` 包裹，解析失败返回 `400 Bad Request`。
- 影响：仅本地预览服务；不影响构建与线上。

### 1.3 `scripts/lib/data.js` — 日期解析口径不明确
- 问题：`formatDateTime` 先走隐式 `new Date(...)`，不同格式/时区下行为不够可预期。
- 修复：明确约定并写进注释：
  - 优先接受 YAML 解析出的 `Date` 对象；
  - 字符串严格接受 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm`（时/分做范围夹取，只写日期按当天 00:00）；
  - 其余格式走 `Date` 兜底，仍无法解析则返回空串。
- 影响：正常存量数据排序结果不变；异常格式不再被宽松隐式解析。

---

## 2. 构建流程拆分与去重（`build.js` 瘦身）

### 2.1 新增 `scripts/lib/buildfs.js`
- `createWriter({ outDir, prevDir })`：保留原有「内容未变就不覆盖、可从上一版产物复制并沿用 mtime」的 304 友好语义。
- `prune(dir, keep)`：原来的遗留文件清理函数，失败只计数不抛出。

### 2.2 新增 `scripts/lib/postprocess.js`
- `patchAppCardVersion(outDir, assetVersion)`：给 `assets/app.js` 里 `./card.js` 的 import 打版本号。
- `copyExtraStaticFiles({ staticDir, outDir, write })`：复制 `qq-group.png`、`quark-group.png`、`indexnow-key.txt`，`ads.txt` 走增量 `write`，递归复制 `static/promo`。
- `pruneOldOgVersions(outDir, ogVersion)`：只保留当前 `og/<version>/`，清理旧 OG 版本目录。

### 2.3 `scripts/build.js` 内部整理
- `app.js` 版本补丁由固定字符串替换改为正则匹配（兼容引号/空格/已有查询串），并带异常兜底日志。
- 静态文件复制统一为 `copyStaticFile` / `copyDirRecursive`（后已迁至 `postprocess.js`）。
- 「标签 slug 撞车检测」抽成 `checkTagSlugClashes(tags)`。
- 「旧目录/旧文件清理」抽成 `cleanupStaleOutputs({...})`。
- 「SEO 自检提醒」抽成 `printSeoWarnings({...})`。
- 接入 `pruneOldOgVersions`，配图处理阶段顺带清理旧 OG 版本目录。

### 2.4 `scripts/lib/assets.js`
- 导出 `OG_VERSION`（当前 `v2`），供构建脚本清理旧版本目录使用。

### 2.5 `scripts/lib/data.js`
- `parseFiles` 从 `normalizeResources` 内部提升到顶层，`normalizeResources` 更短、更易读；行为不变。

---

## 3. 渲染层（`render.js`，保持克制）

- `layout()`：把 `<head>` 内内容抽成 `headInner` 变量再输出，结构更清晰（**输出不变**）。
- 详情页 JSON-LD 资源节点增加 `mainEntityOfPage`，指向规范 URL（SEO 结构化数据更完整）。
- 未做大规模 HTML 骨架拆分：模板高度字符串化，一次性抽象回归风险高，留待以后按「小步替换 + 每次构建抽查」的方式推进。

---

## 4. SEO 相关小改

- `theme/assets/card.js`：列表卡片封面图 `alt` 由「标题」改为「`{标题} 资源封面`」，
  服务端渲染与前端 `app.js` 共用同一模板源，构建后自动生效。
- 详情页海报 `alt` 原本已是「`{标题}海报`」，保持不变。

---

## 5. 页脚版本号：加入后又撤销（记录原因）

- 先按需求在页脚增加站点版本号（取 `git rev-parse --short HEAD`），提交 `c137e12`。
- 随后发现隐患：`data/` 每 2 小时被自动任务提交，用 HEAD 会让页脚版本号每轮都变，
  导致**全站页面被判为内容变化、全部重写**，破坏「内容未变不覆盖」的 304/mtime 机制、白烧抓取预算。
- 曾改为「最近一次改动 `scripts/theme/config` 的提交」的 `vYYYYMMDD-<hash>` 格式，但最终确认**不需要版本号**。
- 已用 `d7e1879` 整体 revert（构建逻辑、页脚输出、样式 `foot__ver` 一并移除），并重新发布，线上页脚已恢复原样。

---

## 6. 提交记录

| 提交 | 说明 |
|---|---|
| `dcde689` | `refactor: 优化构建流程与SEO细节（拆分postprocess/buildfs、修复细节、补充JSON-LD）` |
| `c137e12` | `feat: 页脚增加站点版本号（构建时取提交短哈希）`（**已撤销**） |
| `d7e1879` | `Revert "feat: 页脚增加站点版本号（构建时取提交短哈希）"` |

---

## 7. 验证

- `npm run lint`：通过。
- `npm run build`：通过；多次构建输出正常（增量复用与重新生成计数符合预期）。
- 线上发布：已在 VPS 执行 `flock -w 180 /tmp/wdwp-autoupdate.lock wdwp-autoupdate`，
  日志确认 `发布完成：d7e1879`，线上 `public/index.html` 已无 `foot__ver`。

---

## 8. 未做与后续建议

- **`render.js` 大规模骨架拆分**：暂不做。若要做，建议只抽高频复用的 `head/meta/JSON-LD` 外壳，
  每改一小块就 `npm run build` 并抽查首页、分类页、详情页 HTML。
- **增量模块化的度**：继续保持「少量、按职责」的模块边界（`buildfs` / `postprocess` 这类），
  避免为了 DRY 把模板或流程拆成大量小碎片文件。
- **SEO 侧**：canonical/OG/JSON-LD/sitemap/robots/死链 noindex 等代码侧已具备基础，
  后续重点在搜索引擎平台提交与监控、标签/薄内容治理、内链与内容质量。
