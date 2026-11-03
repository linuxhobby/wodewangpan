# 热门资源榜（/hot/）

按真实访问统计对全站资源排序的独立页面，入口在首页与分类页的 H1 同一行（标题栏右侧）。

## 入口与位置
- 页面路径：`/hot/`（构建产物 `public/hot/index.html`）。
- 首页 H1（「网盘资源索引 · 分类浏览 N 个资源」）与各分类页 H1（如「动漫 N 个资源」）同一行右侧，各有一个「热榜 TOP 30 →」链接指向 `/hot/`（不在顶部导航栏）。
- 同一行、热榜入口**之前**还有两个邀请链接（腾讯 WorkBuddy 2000 积分、抖音 TRAE AI 5000 积分），与热榜一起构成「右侧链接组」，由 `render.js` 的 `PAGE_INVITES` + `titleAsideLinks()` 统一输出，三处不再各写一遍。新增/更换邀请链接只改 `PAGE_INVITES` 数组。
- 该组共输出在**三处**：首页 H1、分类页 H1、以及**资源详情页的面包屑行**（2026-10-25 加）。详情页里它落在 `.crumb` 内，而 `.crumb a` 的权重高于 `.page__invite` / `.page__hot`，所以面包屑的链接色规则用 `:not(.page__invite):not(.page__hot)` 排除这组，否则同一组链接在详情页褪成灰色、跟首页不一致。改动这一组时要一并确认三处（含详情页）的颜色与换行表现。
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
| `scripts/lib/render.js` | `hotPage()` 模板：排序按钮 + `#hot-list` 容器 + 内联索引；`titleAsideLinks()` 给首页/分类页 H1 拼「邀请链接 + 查看热门榜 TOP 30」右侧链接组（导航栏不再含热榜） |
| `scripts/build.js` | 导入 `hotPage`，生成 `/hot/index.html`，sitemap 加入 `/hot/` |
| `theme/assets/app.js` | `initHot()`：读取内联索引 + fetch `/stats.json`，按 pv/uv 排序渲染、切换、降级 |
| `theme/assets/style.css` | `.hot` 相关样式（排名序号、列表、切换高亮） |

## 降级与边界
- `/stats.json` 取不到（本地预览无日志、或接口异常）时，列表显示「统计暂不可用，请稍后刷新」。
- 本地预览无真实访问日志，浏览量恒为占位；可临时放一份 `public/stats.json`（mock）看排版，该文件已被 gitignore，不会进仓库。
- 只统计带 `vid` cookie 的真浏览器请求，爬虫/脚本不计，故「人数」偏真实人气而非请求数。
- 热榜只展示站内当前存在的资源：`res` 会累积已删除资源的历史统计，前端按内联索引过滤，避免出现裸 id 标题与 404 详情页。

## 迁移服务器（排名全变的根因与处理）
统计库与代码仓库**无关**，只活在服务器本地：
- 累计数据：`/var/lib/sitestats/stats.db`（SQLite，存历史 PV/UV、`since`、访客指纹）
- 原始日志：`/var/log/nginx/access.log`

换服务器时这两样默认都不在，新机从零统计 → 历史 PV/UV 归零、热榜排名全部重排（且短期内接近随机）。**这是正常现象，不是 bug。**

**想保留旧排名**：迁移前先把旧机的库拷过来，再带 `OLD_STATS_DB` 跑 `enable-stats.sh`：
```bash
# 旧机 -> 本机
scp 旧机:/var/lib/sitestats/stats.db /tmp/old-stats.db
# 新机启用统计时导入（会跳过 --reset，历史被保留，新访问在其上累加）
OLD_STATS_DB=/tmp/old-stats.db bash deploy/enable-stats.sh
```
注意：
- 必须在新机**尚未跑过统计**时导入；若新机已写入增量，导入会覆盖掉那部分（可接受，但别在跑了一阵之后才导）。
- 只导 `stats.db` 即可，历史全在库里；`access.log` 不用导，新机日志会从头重新回填。
- 确认是否重置：看 `stats.json` 的 `since` 字段——是迁移日说明已重置，是更早的日期说明旧库已生效。

旧库没备份则无法恢复，只能等迁移后新流量重新累积。
