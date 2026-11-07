# AGENTS.md — 自动化任务执行手册

给在这台仓库/站点上工作的自动化 agent（定时任务、AI 会话）看的操作手册。
人在场时可随意发挥；机器执行时**严格按本手册来**。

站点：我的网盘资源站（wodewangpan）· 静态站 · Node.js 构建 · VPS + nginx

---

## 1. 常用命令

```bash
npm run build          # 构建到 public/（本地）
npm run serve          # 本地预览 http://localhost:4321
npx eslint scripts/ tools/   # lint，提交前必须通过
node scripts/new-resource.js # 交互式新增资源条目
node tools/fill-files.mjs    # 批量补文件清单（见 §4）
node tools/fill-desc.mjs     # 批量补/改描述（谨慎，见 §5）
```

## 2. 目录结构

| 路径 | 说明 |
|---|---|
| `data/*.yaml` | 全部资源数据（movie/tv/anime/…），**站点的内容源** |
| `config/site.yaml` | 站点配置（域名、导航、分类、推广位） |
| `scripts/build.js` | 构建入口：读数据 → 写页面 → sitemap/RSS/搜索索引 |
| `scripts/lib/data.js` | 数据解析与规范化（YAML 字段语义看这里） |
| `scripts/lib/render.js` | 全部页面模板与 SEO 输出（meta/JSON-LD/sitemap） |
| `tools/*.mjs` | 批量数据工具（补描述、补文件清单、配图） |
| `theme/assets/style.css` | 全站样式（CSS 变量制，改动要克制） |
| `deploy/wdwp-autoupdate.sh` | VPS 发布脚本（cron 每 2 小时的 30 分自动跑） |

**不要动**：`scripts/lib/render.js` 的渲染逻辑、`theme/`、`deploy/` 下的 nginx 配置——这些改动影响全站 SEO 与线上可用性，只允许明确的人工指令触发。

## 3. Git 约束（重要）

- 分支就是 `main`，直接提交推送，不需要开分支。
- **推送前必须 `git fetch` 并确认本地仍基于远程 HEAD**：本仓库常有并行会话（TMDB 同步、夸克同步）同时提交 `data/`，先 `git pull --rebase` 再 push。
- 禁止 `git push --force`、禁止改写已推送的历史。
- commit message 风格：`类型: 一句话`，类型用 `feat / fix / seo / perf / docs / data`。

## 4. 每日例行任务：补文件清单（fill-files）

这是本站 SEO 的核心增量工作，**每天跑一批，宁可少不可断**。

```bash
node tools/fill-files.mjs --limit 30
```

工具行为：遍历 `data/*.yaml` 中还没有 `files:` 块的条目，从夸克分享详情接口
（客态、无需登录）抓真实文件清单，追加 `updated: 当天` + `files:` 块。

执行后 agent 必须做的事：

1. **看失败清单**：失败多为「链接失效 / 需提取码」。链接失效的条目是死链候选，
   逐条人工核验（浏览器打开确认）后在该条目加 `dead: true`，不要机器自动标。
2. **抽查数据**：随机打开 2~3 个写入块，确认 count/size/tree 来自接口真实返回。
   工具永不编造数据——如果你发现数据可疑，停下来报告，不要继续跑。
3. 构建验证：`npm run build`（应无报错；第二次构建应 0 个文件重新生成）。
4. 提交推送（按 §3），message 用 `data: fill-files 补 N 条文件清单`。
5. 发布：等 cron 自动发，或手动 `ssh www 'FORCE=1 wdwp-autoupdate'`。

剩余量与节奏：`--limit` 每天 20~30 条。不要一次跑完（约 900 条），
一次性大规模变更反而触发「批量内容」判定。

## 5. 数据规范（data/*.yaml 字段语义）

```yaml
- id: mv-001              # 必填，与配图同名
  title: "…"
  category: "电影"
  tags: [..]
  quark_url: "https://pan.quark.cn/s/xxx"
  baidu_url: …            # 可选
  baidu_pwd: …            # 可选
  description: "…"        # 一句话到一段
  date: 2026-10-09        # 内容日期（影视=上映/发行）
  added: "2026-10-09 19:42"  # 真实入库时间
  updated: 2026-11-07     # 最近校验日：仅当该条目内容真的被补全/复核过才写当天日期
  dead: true              # 仅人工核验确认失效后才标
  files:                  # 全字段可选，有什么写什么；必须来自真实接口/目录，禁止编造
    count: 510            # 文件总数
    episodes: 第 1-24 集
    size: 18.6 GB
    format: MP4 / MKV
    resolution: 1080p
    audio: 国语 AAC 2.0
    subtitle: 内封简繁中字
    packed: false         # true=压缩包
    tree: |               # 目录结构，最多 40 行
      …
```

**铁律**：

- **禁止伪造任何日期**。`added` 是事实，永远不改写；`updated` 只在内容真变化时
  写当天日期。伪造日期 = sitemap lastmod 失信 = 全站降权，这是本站第一红线。
- `files.*`、`description` 等一切内容必须可溯源（接口返回 / 目录实拍 / 影视库）。
  编造数据会让「独有内容」变成「批量伪造内容」，比没有更糟。
- 死链处理只有人工核验一条路：确认 → `dead: true` → 构建自动 noindex + 移出 sitemap。

## 6. 发布流程

正常情况不用管：VPS cron 每 2 小时的 30 分自动
`git fetch → 构建 → 原子替换 public → reload nginx → IndexNow 推送`。

手动立即发布（改完想马上上线）：

```bash
ssh www 'FORCE=1 wdwp-autoupdate'
tail -3 /var/log/wdwp-autoupdate.log   # 看到「发布完成：<hash>」即成功
```

构建失败时脚本会保留线上旧版本不切换，此时查日志找报错，**不要**手动去 VPS
改 `public/` 或重启 nginx。

## 7. SEO 现状与禁区（改代码前必读）

- sitemap 只含：详情页（排除死链）+ 首页 + 分类页 + 4 个独立页。
  `/all/`、`/hot/`、`/tags/`、标签页**有意不进 sitemap**，别加回去。
- `/all/` 是分页（每页 50 条，`/all/page/N/`）；首页 noscript 每分类只补 10 条。
  这些收缩是刻意设计，不要「优化」回全量列表。
- 死链页已 noindex 并从卡片/RSS/相关推荐剔除；tag 页有 `tagMin: 3` + 近重复告警，
  已治理过，别重复劳动。
- lastmod 优先级 `updated > added > date`，JSON-LD `dateModified` 同口径。
- 联盟链接已是 `rel="sponsored noopener noreferrer"`，规范状态，不要改成 nofollow。
- 每日 GSC「请求编入」限额约 10 条，属人工操作，agent 可在日报里提醒，不要代刷。

## 8. 验证清单（每次改完跑一遍）

```bash
npx eslint scripts/ tools/     # 0 错误
npm run build                  # 构建通过，注意「重新生成 N 个」是否合理
npm run build                  # 第二次构建应「重新生成 0 个」（304 机制未破坏）
```

涉及模板改动时，抽查 1 个详情页 HTML：meta/canonical/JSON-LD/files 块是否正常。
