# 经验与待办总览

> 本目录是「网盘资源站」的经验沉淀中心：开发、入库、skill 维护等各类经验、注意事项、待完成工作都汇总在这里。
> 单一主题的深度文档独立成篇（如 `bot-traffic-governance.md`），本文档是总索引 + 跨主题通用经验。
>
> 维护约定：每次完成重要操作（skill 升级合并、灾后重建、批量入库、踩坑排查）后，把可复用的经验追加到对应小节；完成的事项从「待办」移到「已完成」。

## 目录

| 文档 | 内容 |
|---|---|
| `experience.md`（本文） | 总索引 + skill 维护 / 入库 / 部署通用经验 + 待办清单 |
| `pitfalls.md` | 注意事项：哪些改动会换 URL、坏构建、丢收录（动站前先扫一遍） |
| `environment.md` | 本机环境：路径、config.env 五个键、命令速查、运行时版本 |
| `content-rules.md` | 内容硬规范：简介字数与写法红线、配图图源结论、id / 命名规则 |
| `ingestion-workflow.md` | 入库 SOP：八步流程、fid 轮换、id 前缀与数据文件对照表 |
| `skill-usage.md` | skill 用法与维护：三个 skill 分工、升级合并三步、双机中转、WB/CB 联建 |
| `seo-notes.md` | SEO 经验：各引擎收录现状、抓取预算、已验证与被推翻的结论 |
| `bot-traffic-governance.md` | 机器人流量治理：蜘蛛日志分析、nginx 爬虫处置 |
| `thin-content-rewrite.md` | 薄内容（简介）改写专项 |

---

## 一、skill 维护经验（TRAE 环境）

skill 母本在 `~/Documents/SynologyDrive/sync-skill/quark-resource-sync/`（Synology Drive 双机同步），TRAE 本地实例在 `~/.trae-cn/skills/quark-resource-sync/`。quarkclouddrive CLI 同样有母本与本地实例。

### 1.1 安装位置的教训（2026-10-11 事故）

- **不要把自维护 skill 放在 `~/.trae-cn/builtin/` 下**。TRAE 客户端更新会清空 `builtin/` 目录（2026-10-11 实测：skill + quarkclouddrive CLI 整个消失，仅 `~/.trae-cn/quark-sync-cache/` 幸存）。
- 稳定位置：**`~/.trae-cn/skills/`**（客户端更新不碰这里）。
- 母本永远在 SynologyDrive，本地实例丢了随时可重建（见 1.3）。

### 1.2 升级合并流程（母本升级后）

1. `diff -q` 逐文件比对源目录与 TRAE 实例，区分「实质更新」与「已知路径适配差异」。
2. 仅覆盖实质更新的文件（用 `cp`），不要全量覆盖后重做适配（省事但易漏）。
3. 若源结构大改（如脚本统一改用 `lib/config.mjs`），全量覆盖后重跑 1.4 的适配清单。
4. 验证三件套：`node --check` 全部脚本 → `node scripts/lib/config.mjs` 诊断五项配置 → `scan-new.mjs` 实测连通。

### 1.3 灾后重建流程（本地实例丢失时，约 10 分钟）

```bash
# 1. 复制母本
cp -R ~/Documents/SynologyDrive/sync-skill/quark-resource-sync ~/.trae-cn/skills/
# 2. 复制 CLI（从 WorkBuddy，登录态在客户端不受影响）
cp -R ~/.workbuddy/skills/quarkclouddrive ~/.trae-cn/skills/
# 3. 路径适配（见 1.4 清单，前缀统一改 ~/.trae-cn/skills/）
# 4. config.env 从 WorkBuddy 继承凭据（TMDB_TOKEN/PROXY/REPO/SHARE_FID 原样，QUARK_CLI 指向新位置），chmod 600
# 5. 验证三件套（同 1.2 第 4 步）
```

### 1.4 路径适配清单（合并/重建时必查）

| 文件 | 要改的点 |
|---|---|
| `scripts/lib/config.mjs` | `CACHE` 常量 → `~/.trae-cn/quark-sync-cache`；`detectCli` 的 roots 首选 `'.trae-cn'` |
| `SKILL.md` | 全部 `~/.workbuddy/skills/` → `~/.trae-cn/skills/`（含 Windows 示例路径）；「macOS 实测」表更新为本机实况 |
| `references/troubleshooting.md` | CLI 路径 2 处 |
| `scripts/install.mjs` | 默认 target、Windows 示例、config.env 继承候选路径 |
| 脚本注释里的 CACHE 路径 | `app-batch.mjs` / `process-batch.mjs` / `trending-sync.mjs` |
| `config.env`（自持，不从母本覆盖） | `QUARK_CLI` 指向 `~/.trae-cn/skills/quarkclouddrive/scripts/quark-drive.cjs` |

替换完用 `grep -rn '\.workbuddy' <skill目录>` 终检，允许残留的只有 detectCli 回退候选与示例。

---

## 二、入库经验

核心流程与硬性规则以 skill 文档为准（`~/.trae-cn/skills/quark-resource-sync/SKILL.md`），此处只记易忘点与实战补充：

- **fid 每次 browse 都会轮换**：rename 之后必须重新 browse 取新 fid 再出链，扫描阶段存的旧 fid 出链会报 21001。
- **先 rename 再出链**：顺序反了，重命名会让旧链接作废。
- **电视剧简介开头必须标** `【第 N 季 · 共 M 集】`，数字只用 TMDB 官方数据，不数网盘文件。
- **简介禁止照抄 TMDB**：正文 300~1200 字，改写而非同义词替换，结尾 `｜TMDB <评分>`。
- **自写文案禁止破折号**（`——`），断句用逗号或冒号；TMDB/豆瓣抓回的第三方原文保持原样。
- **非影视资源的 `date` 填版本发布日期并核实过**，查不到就留空，不要填「差不多」的日期。
- **出图必须打开看一眼再入库**（标题顶边、图标偏小、identicon 假头像只有看图能发现）。
- `added` 带时刻（`"2026-10-11 16:30"`，要加引号），首页排序更准。
- 编号按扫描返回顺序分配，**不要按年份/系列重排**（站点列表排序会让系列作品自然正序）。

---

## 三、部署与发布

- 入库冒烟通过后**必须提交推送 GitHub**（服务器 `deploy/site-autoupdate.sh` 拉取自动重建）。
- 推送前先 `git status` 查有没有其他会话的未提交改动，无关改动拆 commit。
- 推送失败不静默跳过，收尾报告标注原因。
- 本地预览 `node scripts/serve.js` → `http://localhost:4321/`，同步结束后保留运行。

---

## 四、待完成工作

- [ ] **同步 3 个新网盘目录入库**（2026-10-11 扫描发现，用户已确认执行）：
  - 电视剧「无可替代（2026）」
  - 动漫「哪吒之魔童闹海（2025）」
  - 动漫「哪吒之魔童降世（2019）」
  - 动手前先重跑 `scan-new.mjs` 确认编号，按 skill 流程 3→8 步执行。
- [ ] **电影分类编号核查**：2026-10-11 扫描显示 04电影已编号 339 个但下一可用编号是 337，疑似存在同号目录或跳号，值得用 `browse` 核对一遍。
- [ ] **补齐薄内容简介**（当前最大 SEO 欠账）：706 条里原有 387 条正文不足 300 字，纪录片已收尾补完，全站降至 **313 / 706**。下一个重灾区是电视剧（原本 106/138）。流程与字数口径见 `thin-content-rewrite.md`
- [ ] **首页体积与去重**：102KB（gzip 26KB），大头是 noscript 里的 663 条详情链接
- [ ] **百度推送改详情页优先**：API 配额有限，首页它自己天天来，不占配额
- [ ] **新引擎破零**：搜狗 / 字节 / 华为，各自站长平台提交 sitemap（无开放 API，一次性动作）
- [ ] **备案 + 大陆节点**（长期）：百度系唯一破局手段，`icp` 为空 + 香港节点无备案是天花板，其余都只在极低配额内挪腾
- [ ] **核对 360 的 301 链是否单跳**直达 `https://www.<域名>/`（多跳会稀释权重）
- [ ] **`config/tags.yaml` 去重**：「macOS」标签页与「软件」分类页重合 93%，确认无保留价值就加进 `tagExclude`
- [ ] **`config/site.yaml` 补 `verification`**：搜索引擎后台才能验证归属、看到真实收录数据（配置已迁到 `config/`，`data/` 下不再有 site.yaml）
- [ ] 补 README 三个空节：`## 配图规范`、`## SKILL 变更`、`### 收录现状`

## 五、已完成（近 期）

- 2026-10-11 TRAE 更新清空 `builtin/` 导致 skill 丢失，完成灾后重建并迁移到 `~/.trae-cn/skills/`。
- 2026-10-09 skill v1.10 合并（海报图源策略大改：真实素材优先、图源探测结论表）。
- 2026-10-09 skill v1.6 合并（脚本统一走 `lib/config.mjs`）。
