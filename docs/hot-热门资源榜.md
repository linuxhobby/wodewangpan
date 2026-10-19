# 热门资源榜（/hot/）

按真实访问统计对全站资源排序的独立页面，入口在导航栏「热门」。

## 入口与位置
- 页面路径：`/hot/`（构建产物 `public/hot/index.html`）。
- 导航栏常驻「热门」链接，当前页高亮（`catNav` 的 `hotOn` 透传到 `layout`）。
- 已加入 `sitemap.xml`，供搜索引擎发现。

## 排序维度
页面顶部两个切换按钮，由前端即时重排（无需重新请求）：
- **按浏览量**：资源详情页被打开的总次数（PV，同一访客反复看都计）。
- **按人数**：去重后的独立访客数（UV，按浏览器 `vid` cookie 去重）。

默认按浏览量降序，取前 30 名。

## 数据来源
- 数据来自 `/stats.json` 的 `res` 字段（每个资源 `{pv, uv}` 全量字典），前端 `fetch` 后自行排序、渲染。
- `stats.json` 由 `tools/sitestats.py` 基于 nginx `access.log` 生成，cron 每 10 分钟增量更新（`/usr/local/bin` 旧版已替换为仓库版 `tools/sitestats.py`，见 `deploy/enable-stats.sh` 与 VPS 上的修复记录）。
- 资源标题/链接映射在构建期内联进页面（`#hot-index` 的 `{id:{title,href,category}}`），前端不再额外请求 `search-index.json`。
- 与详情页「N 次浏览 · M 人」、列表卡片「· N人看过」**同一套统计口径**，数字一致。

## 实现位置
| 文件 | 职责 |
|---|---|
| `scripts/lib/render.js` | `hotPage()` 模板：排序按钮 + `#hot-list` 容器 + 内联索引；`catNav`/`layout` 加「热门」入口 |
| `scripts/build.js` | 导入 `hotPage`，生成 `/hot/index.html`，sitemap 加入 `/hot/` |
| `theme/assets/app.js` | `initHot()`：读取内联索引 + fetch `/stats.json`，按 pv/uv 排序渲染、切换、降级 |
| `theme/assets/style.css` | `.hot` 相关样式（排名序号、列表、切换高亮） |

## 降级与边界
- `/stats.json` 取不到（本地预览无日志、或接口异常）时，列表显示「统计暂不可用，请稍后刷新」。
- 本地预览无真实访问日志，浏览量恒为占位；可临时放一份 `public/stats.json`（mock）看排版，该文件已被 gitignore，不会进仓库。
- 只统计带 `vid` cookie 的真浏览器请求，爬虫/脚本不计，故「人数」偏真实人气而非请求数。
