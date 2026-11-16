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

---

# 第二轮：标签体系治理（2026-11-16 续）

第一轮只处理了构建流程与 SEO 细节，这轮处理标签：一是**词表口径**（作品名当标签的噪音），
二是**标签页内容**（三百多张卡片平铺、每页底部都是同一份「热门标签」）。

## 9. 词表口径：标签只写属性

`config/tags.yaml` 顶部新增了一段口径说明，规则是：

- `tags` 只写**属性词**：题材 / 平台 / 工具类型 / 课程方向。
- **作品名、片名、种子名不进 `tags`**。标题里已经有一份，重复写会让每张卡片副标题挂上一长串作品名，
  还会够格建出一个与分类页重复的聚合页（例：46 字符拼音 URL 的
  `/tag/yijifangchengshi-jisuzhengsheng-formula-1-drive-to-survive/`）。
- 多季剧的「同系列」关系**不靠标签维护**，改由标题自动派生（见 §10）。

## 10. 展示层兜底 + 自动「同系列」

### 10.1 `scripts/lib/data.js` — `isTitleNoise()` 强化

`normalizeResources()` 里对 `tags` 做一次过滤，判定四档：

1. 标签与标题完全同名（归一化后）；
2. 剥掉英文原名后（只留中日韩字符）与标题同名；
3. 两边都剥掉季号后同名 —— 覆盖「标签写剧名、标题写『剧名 第 N 季』」；
4. 标签里出现片源发布标记（`WEB-DL` / `BluRay` / `x265` / `HDR` / `1080p` 这类）→ 判定为种子名，直接不要。

⚠ 不要再加「标签是标题前缀就剔」这类比例规则：标题
`Parallels Desktop 18 - macOS 虚拟机软件` 会把正常标签「虚拟机」误判成作品名（已实测）。

### 10.2 `keywords` 字段：被隐掉的标签仍可搜到

被 `isTitleNoise` 剔掉的原始标签另存为 `item.keywords`，只进构建期的搜索索引（`scripts/build.js`
的 `py` 字段），不出现在卡片与详情页。这样卡片不再有整行作品名，但搜 `Zootopia` 仍能命中「疯狂动物城」。

### 10.3 同系列：按标题剥季号派生

- 新增 `SEASON_SUFFIX_RE`（`第七季` / `第 3 季` / `Season 2`）与 `parseSeasonNo()`（中文数字也认）。
- `normalizeResources()` 给每条补 `series`（去掉季号后的系列名）与 `season`（季号）。
- `render.js` 的 `seriesOf()` / `seriesBlockOf()` 在详情页**页码条之后、相关推荐之前**渲染「同系列」：
  按季号列出同一部剧的其它季，缺哪一季一眼可见。数据零维护——新增一季只要标题带季号，自动成组。

## 11. 标签页重构（`render.js` 的 `tagPage`）

| 区块 | 旧 | 新 |
|---|---|---|
| 标题 | 「动作」+ 315 个资源 | 「动作」资源 + 315 个 |
| 导语 | 无（直接铺卡片） | 按**真实分布**生成：共 N 个、分布在几类、每类几个 |
| 正文 | 315 张卡片平铺 | 按分类分块，每块标题链到分类页（`电影 · 303 个`） |
| 页尾 | 全站热门 20 个标签（每页相同） | 「相关标签」：与当前标签共现最多的 12 个，括号标重合资源数 |
| 出口 | 热门标签云尾部一条 | 「查看全部 N 个标签 →」固定保留 |

- 新增 `relatedTagsOf()` / `relatedTagsHtml()`：只列**已经建了聚合页**的标签（没建页的链过去就是 404）。
- 全站热门标签云（`tagCloudHtml`）只留给 `/all/` 第一页底部——标签页本身不再重复同一份导航。
- `theme/assets/style.css` 新增 `.tag-lead` / `.tag-group` / `.series` 三条规则。
- 顺手修掉 `relatedBlock` 里 `fit` 变量在模板串中未定义的隐患（`grid--fit` 之前不会生效）。

## 12. 数据迁移（`data/*.yaml`）

一次性脚本处理 1042 行 `tags:`，**改名 49 处、删除 17 处、行内去重 13 处**，
涉及 `anime / course / documentary / ebook / movie / software / tv` 共 66 行（加减行数相等）。

**同义标签合并（旧 → 留）**

| 旧标签 | 合并到 | 旧 URL |
|---|---|---|
| `x64` | `x86_64` | `/tag/x64/` |
| `War & Politics` | `政治` | `/tag/war-politics/` |
| `外国文学` | `文学` | `/tag/foreign-literature/` |
| `纪录` | `纪录片` | `/tag/jilu/` |
| `OpenAI Codex` | `AI编程` | `/tag/openai-codex/` |
| `雅思` | `英语考试` | `/tag/yasi/` |
| `Sci-Fi & Fantasy` | `科幻奇幻` | 同一 slug `/tag/sci-fi-fantasy/`（`tagSlugs` 保留别名） |

**删除的作品名标签**：一级方程式：疾速争胜 ×7、塔尔萨之王 ×4、降世神通：最后的气宗 ×2、
龙与地下城：侠盗荣耀 ×2、良药苦口 ×2。

标签聚合页从 **58 个降到 50 个**（`纪录片` 与分类同名，按既有规则不再建页）。

## 13. 影响与遗留

- 合并后的旧标签 URL 现在返回 404。**未改 `deploy/` 下的 nginx 配置**（仓库规定该目录只接受人工指令）。
  若需要 301，按 §12 的旧 URL → 新 URL 表加规则：
  `x64 → x86-64`、`war-politics → zhengzhi`、`foreign-literature → literature`、
  `jilu → /documentary/`、`openai-codex → aibiancheng`、`yasi → yingyukaoshi`。
- 标签页不在 sitemap 内（既有策略），旧 URL 未被 IndexNow 提交过，影响范围限于站内历史链接与已抓取快照。
- 存量条目**不做一次性回填**：展示层过滤会自动生效，数据本身已清干净；后续新增资源按 §9 口径写 `tags`。

## 14. 验证

- `npx eslint scripts/ theme/assets`：0 错误。
- `npm run build` 连跑两次：第一次「重新生成 1131 个」，第二次「重新生成 0 个」（304 机制未破坏）。
- 抽查：
  - `/tag/action/`：导语显示「315 个，分布在 5 个分类…」，按分类分块，相关标签首位「惊悚 143」。
  - `/tag/macos/`：导语「109 个，软件 107 / 游戏 2」，相关标签「实用工具 16」。
  - `/tag/sci-fi-fantasy/`：标题为「科幻奇幻」，旧 slug 继续服务新标签。
  - `/tag/` 索引页与 `/all/` 底部热门标签云正常。
  - `/documentary/dc-080/`：出现「同系列」，列出第 1–7 季（缺自身第 2 季）。
  - `/tv/tv-090/`（塔尔萨之王）：同系列列出第 1/3/4 季。
  - 卡片副标题不再出现作品名标签。
