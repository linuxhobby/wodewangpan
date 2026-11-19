---
name: quark-resource-sync
description: 同步夸克网盘 SHARE 目录的新增资源到 ShareResource 静态站：扫描未编号目录 → 按分类顺序编号重命名 → 生成永久公开分享链接 → 抓取 TMDB 中文信息与海报 → 写入 data/*.yaml → 构建并冒烟 → 提交并推送 GitHub。当用户说"网盘新增了资源""同步夸克""补录资源""把新电影/新剧加到网站""给夸克目录编号""夸克目录改名"时使用。**也覆盖合集拆分**（一个编号目录里装了整个系列，如「025-速度与激情合集」）：原目录留给第一部，其余按系列新建编号目录并移入，逐部入库；当用户说"合集拆分""这个目录里有多部""把系列拆开"时使用。也覆盖反向流程（scripts/trending-sync.mjs）：从 TMDB 今日热门电影/电视剧各 1 部 → 在网盘对应分类目录按序建编号目录 → 出链 → 入库 → 推送，每日 23:00 由自动化触发；当用户说"每日热门""TMDB 热门自动入库""每天建目录"时使用。**每轮同步还要跑 scripts/guangya-sync.mjs 给光鸭网盘 SHARE 资源补 guangya_url**（出链一次、失败不重试）；当用户说"光鸭扫描入库""光鸭补链""给光鸭资源出链"时使用。**百度网盘同名镜像与百度出链已于 2026-11-08 起停止**：两条流程都不再在百度 `/apps/bdpan/<分类>/` 建同名目录、也不再出百度链接（`trending-sync.mjs` 默认关闭镜像，恢复必须人工显式 `--baidu`；第 3b 步的 `mirror-baidu.mjs` / `baidu-share-links.mjs` 不再被任何自动化调用，只有用户当面要求重新开启时才可手动跑）。**存量不动**：`data/*.yaml` 里已有的 582 条 `baidu_url`/`baidu_pwd`、百度侧已建目录与已出分享链接一律保持原样，不取消分享、不删目录、不改写；切换时也不做最后一轮出链回补。
version: "1.27"
agent_created: true
---

# 夸克网盘 → 资源站同步

把夸克网盘 `SHARE/` 下新增的资源目录，编号、出链、抓取信息后上线到 ShareResource 静态站。

**目录命名口径（2026-11-08 用户定夺，v1.22）**：待编号目录改名时**一律去掉中括号**（`[]` 与 `【】`），把括号里的文字并进主名、用空格分隔，例如 `[静谧田园][Village in the Shade]` → `019-静谧田园 Village in the Shade`、`018-switch大气层整合包[ns游戏仓库]` → `018-switch大气层整合包`。**存量已编号目录不回头改**（用户明确「之前的不管了」，2026-11-08 实测其他分类还剩 30 个带括号目录：03电视剧 23、04电影 4、07课程 3），只有当某条因别的原因要改名重出链时才顺手去括号。附带后果：`scan-new.mjs` 的重复判定按「剥掉括号内容」归一化，整名被括号包住的旧目录会归一化成空串、`includes('')` 恒真，于是**新目录会被误标「疑似重复」**；这是误报不是真重复，逐条核对后照常入库（判定逻辑本身未改）。

## 运行模式：定时任务（无人值守）

本 skill 主要由自动化每 6 小时静默触发一次，**没有人在屏幕前**。这种调用方式下：

- **禁止向用户提问**：不调用提问 / AskUser 类工具，不输出「请确认后我再执行」这类等待语，不把任务停在「等用户回复」。
- **禁止为拿授权而中断**：命令、写文件、`ssh`、`git push`、网络请求被拒绝或超时（permission denied、`SAFE_DELETE_REQUIRED`、连接被拒），**记下报错直接进下一步**，同一操作最多重试 1 次，绝不停下来等人批准。
- 文中所有「向用户展示…确认后再动」的环节，一律按下面的表**自主执行**，把「做了什么 / 跳过了什么」写进收尾报告（报告同时用于飞书推送），用户事后看报告即可。

### 确认点 → 无人值守默认动作

| 原流程里的确认点                                     | 无人值守默认动作                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| 第 1 步「疑似重复 → 停下来问用户删重复/保留/不同版本」               | **不删、不重复入库**：跳过该目录并保持未编号，标注 `duplicate_suspect`，列出对照的已编号目录               |
| 第 2 步「展示待处理清单，确认后再动网盘」                       | **直接执行**：按 `scan-new.mjs` 返回顺序，用**空洞优先**分配编号（先填该分类的可补位空洞，用完才「最大编号 +1」顺延）重命名，原名→新名 + 编号来源（补位/顺延）写进报告  |
| SHARE 下出现站点没有对应分类的目录                          | **不动**：不重命名、不出链、不入库，标注 `unknown_category` 报告，等用户定归属                    |
| 已编号目录里装了多部作品（合集拆分，需 move 网盘文件）                | **不拆分**：标注 `needs_split` + 目录内清单报告，等用户确认后另行执行                            |
| 用户在网盘取消了分享（`41012`）                           | **不重试、不重建**：列进 `cancelled_share`，有百度兜底的靠百度，其余等用户决定下架还是补资源            |
| 需要删除网盘或站点文件（下架、清 `public/` 产物）                 | **一律不删**：只输出待删清单与建议步骤交用户执行；本 skill 在无人值守下不做任何删除动作                   |
| TMDB 未命中 / 拿不到季集信息                            | 按第 5 步的降级写法入库（目录原名去编号做标题、中性一句简介），并在报告点名说明                             |
| 构建失败 / 冒烟未通过                                   | **不推 GitHub**（不推坏数据）：保留本地改动，报告写明失败文件与报错                                |
| `git push` 被拒（`fetch first`）                    | `git fetch origin` → `git rebase origin/main` → 重推 1 次；仍失败报告「GitHub 未推送」+原因 |
| VPS 即时重建 / 飞书推送失败                             | 非致命：重试 1 次后只在报告与 footer 标注，不回滚已完成的入库与推送                                |
| 第 3b 步百度网盘同名镜像 + 出链                          | **已停止（2026-11-08 用户定夺）：整节跳过**，不建百度目录、不出百度链接、不调 `mirror-baidu.mjs` / `baidu-share-links.mjs`，也不进「需要人工跟进」；存量百度字段与已出链接不动。恢复只在用户当面显式要求时，无人值守轮次严禁自行开启          |
| 光鸭补链某条出链失败 / 结果未确认 / 登录态失效                | **不重试、不重建、不自动登录**：脚本一次提交后只写 `failed` / `unconfirmed` / `skipped`，继续下一批；登录失效整阶段跳过并写进「需要人工跟进」            |
| 扫描后无新增资源                                       | **夸克侧直接结束**：不编号、不出链。但**第 6b 步光鸭补链照跑**，光鸭也 0 条待补才整轮结束，不构建、不提交、不触发 VPS 重建、不发飞书（避免空报刷屏）              |

### 收尾报告必带的两段

1. **本轮已执行**：改名与编号（**每条编号要写明来源：补位空洞 / 补位并就地改写死链旧条目 `<id>` / 顺延**）、分享链接、TMDB 命中情况、海报、构建与冒烟结果、commit hash、推送状态、VPS 重建结果、飞书 message_id。**外加各分类的「编号对账」——站点条目数 / 夸克网盘最大编号，对不上的差值逐类列出（电视剧、软件当前有空洞属预期）。**（**百度镜像与百度出链自 2026-11-08 起已停止，报告里不再出现这两项**；若脚本输出「百度镜像：已停用…」，那是预期状态，不必解释也不必跟进。）**再加一行「光鸭补链：成功 x/N（失败 id：…）」**，取 `~/.workbuddy/quark-sync-cache/guangya-sync-last.json` 的 `created` / `pending` / `failed`。
2. **需要人工跟进**：`duplicate_suspect` / `unknown_category` / `needs_split` / `cancelled_share` / `skipped_by_permission` / `guangya_failed` / `guangya_unconfirmed` 以及被拒或失败的操作，逐条列出并给建议动作；没有就明写「无需人工跟进」。**这两段直接映射到第 9 步飞书卡片的 `skipped`（未入库原因）与 `reconcile`（编号对账）字段——卡片上必须看得见，是将军点名要看的。** **百度镜像/出链的失败与待补不再进这一栏**（功能已停用）。

> 交互式使用（用户当面说「网盘新增了资源」）时仍按下面的原流程走，该问就问；上面这套默认动作只在无人值守的自动化轮次生效。

## 前置

`~` = 用户主目录（Windows 下即 `C:\Users\<用户名>`）。

| 项                                                 | 位置                                                                                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地配置（TMDB token / 代理 / 仓库路径 / SHARE fid / CLI 路径） | `~/.workbuddy/skills/quark-resource-sync/config.env`（**含凭据，不入库**）；统一由 `scripts/lib/config.mjs` 加载，见下方「配置怎么加载」                                                                                                                          |
| 夸克 CLI                                            | `~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs`（未配则自动探测）                                                                                                                                                                 |
| 站点仓库                                              | `config.env` 的 `REPO`（未配则自动探测 `~/Documents/GitHub/wodewangpan` 等候选）                                                                                                                                                                    |
| 数据文件                                              | `$REPO/data/` 下按分类分文件，**文件名是英文、分类名是中文**，2026-11-10 起共 **9 个**：`movie.yaml` 电影、`tv.yaml` 电视剧、`documentary.yaml` 纪录片、`anime.yaml` 动漫、`game.yaml` 游戏、`software.yaml` 软件、`ebook.yaml` 电子书、`course.yaml` 课程、`misc.yaml` 其他。**`os.yaml` 已删除**（2026-11-10「操作系统」并入「软件」，11 条 `os-` 前缀条目搬进 `software.yaml`，保留原 id 与详情页 URL），**任何情况下都不要重新创建 `data/os.yaml`**——站点 `config/site.yaml` 已经没有「操作系统」分类，但 `orderCategories()` 会把数据里出现的未知分类照样排进导航，等于复活 `/os/` 页面与 sitemap，而线上 nginx 正把旧分类页 `/category/os/` 301 到 `/software/`。另有 `site.yaml`（站点配置，不存资源，不一定存在） |
| 海报目录                                              | `$REPO/static/images/<slug>/`                                                                                                                                                                                                                 |

TMDB 走官方域名 `api.tmdb.org`（`api.themoviedb.org` 在本机可能被 DNS 劫持）；脚本「代理优先 → 失败自动直连」，代理没开也能用。海报 CDN `image.tmdb.org` 若连不上，按 `references/troubleshooting.md` 改用豆瓣图源。

**本机 shell 环境会漂移（2026-11-09 实测）**：定时任务的 PowerShell 有时 `PATH` 里没有 `git` / `bash`（`C:\Program Files\Git\cmd` 在 PATH 里但目录已不存在，Git 实际是 PortableGit）。这时别放弃 git 操作，用绝对路径：`C:\Users\<用户>\.workbuddy\bin\git\cmd\git.exe`（同目录 `bin\bash.exe` 可跑 `.sh`），需要子进程找得到 git 时把该 `cmd` 目录临时前置进 `$env:PATH`。另外 `data/` 下**不一定还有 `site.yaml`**（2026-11-09 本机就没有），上表按实际文件为准。

**夸克 CLI 的调用入口只有一个**：`node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs <command>`。同目录还有一份 `scripts/scripts/quark-drive.cjs` 副本，用它跑 `get-user-info` 会报「未登录 -103」（配置目录解析不同），别用；子命令名也**不要凭印象猜**，先 `node … --help` 看真实列表（没有 `whoami`，查登录态是 `get-user-info`；`rename` 只有 `--batch-id` + `--items-file`，没有 `--fid/--precise/--cap-dims-json` 那套）。

## 配置怎么加载

所有脚本**只从 `scripts/lib/config.mjs` 取配置**，不各自解析 `config.env`。取值优先级：

**环境变量 > `config.env` > 自动探测**

| 配置项          | 环境变量名                                       | 自动探测                                                                                           | 说明                   |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| `TMDB_TOKEN` | `TMDB_TOKEN`                                | —                                                                                              | Read Access Token，必填 |
| `PROXY`      | `QUARK_PROXY` → `HTTPS_PROXY` → `ALL_PROXY` | —                                                                                              | 代理挂了自动直连，可不填         |
| `REPO`       | `QUARK_REPO`                                | ✅ 在 `~/Documents/GitHub`、`~/Github` 下找 `wodewangpan` / `ShareResource`（命中 `data/site.yaml` 优先） | 站点仓库路径               |
| `SHARE_FID`  | `QUARK_SHARE_FID`                           | —                                                                                              | 夸克 SHARE 目录 fid，必填   |
| `QUARK_CLI`  | `QUARK_CLI`                                 | ✅ `~/.workbuddy` / `~/.codebuddy` 下的 `quarkclouddrive/scripts/quark-drive.cjs`                 | 夸克 CLI               |

要点：

- **换机器基本不用改配置**：`REPO` / `QUARK_CLI` 留空也能自动找到；真找不到再填。
- **凭据可以不落盘**：不想写 `config.env` 的机器，用环境变量即可（Windows `setx TMDB_TOKEN "..."`；macOS `export ...`），优先级高于文件。
- 路径支持 `~` 开头，会自动展开。
- 缺关键配置时脚本直接退出并提示补齐方式，不会带着空值跑一半才报错。
- **排障先看来源**：`node scripts/lib/config.mjs`，只打印「来源 + 长度」，不打印值：

```bash
node scripts/lib/config.mjs
# TMDB_TOKEN  来源=config.env 长度=244  已配置
# PROXY       来源=环境变量   长度=22   已配置
# REPO        来源=config.env 长度=33   已配置
```

新增脚本一律 `import { cfg, requireCfg, SKILL, CACHE, TMP } from './lib/config.mjs'`；`CACHE` = `~/.workbuddy/quark-sync-cache`（进度/状态文件），`TMP` = 系统临时目录。别再手写 `os.homedir()` / `os.tmpdir()` 拼路径。

## 敏感数据

**只有 `config.env` 是敏感的**：`TMDB_TOKEN`（Read Access Token，泄漏会被冒用配额直至吊销）和 `SHARE_FID`（夸克 SHARE 目录标识）。`SKILL.md`、`references/`、`scripts/` 里没有任何凭据、IP 或绝对路径，可直接入库 / 公开。

搬运到别的机器（含 Windows）用 `scripts/install.mjs`，它会跳过 `config.env` 并单独生成目标机器的那份：

```bash
# macOS / Linux
node scripts/install.mjs --target ~/.workbuddy/skills

# Windows（PowerShell）
node scripts/install.mjs --target "$env:USERPROFILE\.workbuddy\skills" `
  --repo  "$env:USERPROFILE\Documents\GitHub\ShareResource" `
  --cli   "$env:USERPROFILE\.workbuddy\skills\quarkclouddrive\scripts\quark-drive.cjs" `
  --proxy "http://127.0.0.1:7890"
```

行为：复制 `SKILL.md` / `references/` / `scripts/` → 生成 `config.env`（本机已有配置自动继承，也可用 `--config <路径>` 指定来源，`--token --proxy --repo --share-fid --cli` 覆盖单项）→ 校验并提示缺什么。缺 `TMDB_TOKEN` / `SHARE_FID` 时脚本会给出获取方式，手动补进 `config.env` 即可。

## 扫描范围

- 覆盖 `SHARE/` 下**所有**分类目录，不只电影/剧集，2026-11-10 起共 **9 个**：电影 / 电视剧 / 纪录片 / 动漫 / 游戏 / 应用（网盘目录 `02应用`，站内分类名「软件」）/ **电子书（网盘目录 `08电子书`，2026-10-07 新增）** / 其他（网盘目录 `010其他`）/ **课程（网盘目录 `07课程`，2026-10-13 新增）**。
- ⛔ **「操作系统」分类已于 2026-11-10 并入「软件」**：网盘 `09操作系统` 目录被删掉，11 份系统镜像物理移入 `02应用`（实号 130-140），站点 `data/os.yaml` 被删除、条目并进 `data/software.yaml`（**保留 `os-` 原 id 与详情页 URL**），`config/site.yaml` 的 `categories`/`slugs` 也去掉了操作系统，线上 nginx 把旧分类页 `/category/os/` 301 到 `/software/`。之后**新的系统镜像资源一律按「软件」分类、`app-` 前缀入库，绝不新建 `data/os.yaml`、绝不写 `category: 操作系统`**（`make-entry.mjs` 已把该分类拒掉）。
- **排除 `99-` 开头的目录**（现名 `99-需要删除的移动到这里`，此前叫 `99-待删除`）：不扫描、不编号、不出链、不入站。里面的东西视为待清理，由用户在网盘自行处理。
- ⚠️ **分类目录名以网盘为准**：用户会在网盘里改分类目录名（`008电子书`→`08电子书`、`007其他`→`010其他`、`99-待删除`→`99-需要删除的移动到这里`，2026-10-12 实测）。改完必须同步 `scan-new.mjs` / `check-drive-sync.mjs` / `reshare-batch.mjs` 里的 `dir`，否则该分类扫不到；`99-` 排除项已改成按前缀判定，不受改名影响。
- SHARE 下若出现站点没有对应分类的目录，扫描照列但标注 ⚠ 并**不入库**，先问用户归属再动（**无人值守轮次不问、不动**：标注 `unknown_category` 进报告，等用户处理）。要新增分类**不是只建一个 YAML**，站点侧 5 处 + skill 侧 2 处都要改，清单见下方「新增分类：两边都要改」。
- 分类目录里只统计子目录（一个资源 = 一个目录）；散落文件单独计数提示，不参与编号，也不出链。

## 新增分类：两边都要改

整理自 2026-10-09 新增「操作系统」的实操（站点 README「经验总结」有同款清单）。**漏项是静默的**：构建不报错，但分类页 URL 变中文、缺图海报塌成文件夹样式、或者新分类的资源根本扫不出来。表里出现的「操作系统」是那次实操的历史案例；该分类已于 2026-11-10 又并回「软件」（下表反过来用就是「合并/撤销分类」清单）。

| # | 位置                           | 改什么                                                                         | 漏了会怎样                                      |
| - | ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| 1 | skill `scripts/scan-new.mjs` | `CATS` 加一行：`dir`（网盘目录） / `key`（站内中文分类名） / `prefix`（id 前缀） / `file`（英文数据文件名） | SHARE 下该目录提示「站点无对应分类」，只列出不入库               |
| 2 | skill `SKILL.md`             | 本文件的数据文件表、编号与 id 规则、扫描范围三处各加一条                                              | 自动化同步按老路径走，新分类扫不出来                         |
| 3 | 站点 `data/site.yaml`          | `categories` 加分类名（顺序即分类栏顺序）；`slugs` 配英文别名                                   | 分类栏排到末尾；分类页 URL 变 `/操作系统/`（中文一级目录，非英文 slug）    |
| 4 | 站点 `data/<英文>.yaml`          | 新建数据文件，英文 / 缩写命名                                                            | 中文文件名在 Git 与命令行里会变成转义串                     |
| 5 | 站点 `tools/new-resource.js` | `DATA_FILE` 加一行（中文分类 → 英文基名）                                                | `npm run new` 按中文名建出 `data/操作系统.yaml`，数据分散 |
| 6 | 站点 `scripts/lib/assets.js`   | `CAT_STYLE` 加 `c1` / `c2` / `icon` / `en` / `tex`（图标取自 `ICONS`，底纹取自 `TEX`）  | 新分类缺图海报一律是「派生色相 + 文件夹图标 + 波浪底纹」            |
| 7 | 站点 `README.md`               | 「配图规范」补一行图源，「数据格式」的 `data/` 列表补一行                                           | 下次补图不知道这一类去哪儿找图                            |
| 8 | 站点 `scripts/lib/render.js`  | `SCHEMA_TYPE` 补 schema.org 类型、`TITLE_SUFFIX` 补详情页 title 后缀                      | 落到 `CreativeWork` 与通用后缀，「分类 + 网盘资源」长尾接不住    |
| 9 | 站点 `docs/content-内容生产.md`  | 「编号与 id 对照」表补一行、「各分类的写法侧重」补一行、脚本清单里 `scan-new.mjs` 的分类数同步                | 入库时不知道这一类按什么编号、简介怎么写                       |

顺序：先做 skill 侧（1、2）保证能扫出来 → 再做站点侧（3~9）→ 最后跑同步入库、构建、冒烟。

## 编号与 id 规则

- 网盘目录名：`001-片名`、`070-真相捕捉 1-2季全集…`，三位补零。**编号口径（2026-11-04 改）：空洞优先**——先把该分类 `001`～现有最大编号整条序列扫一遍，取「夸克网盘上没有对应目录」的最小空编号补位；空洞用完了才按「最大编号 +1」顺延。旧口径「一律 max+1」已废，见下节「编号回收与死链就地改写」。
- 资源 id：分类目录 `04电影`→`mv-`、`03电视剧`→`tv-`、`06纪录片`→`dc-`、`05动漫`→`an-`、`01游戏`→`game-`、`02应用`→`app-`（网盘目录名 `02应用` 保持不动，站内分类名是「软件」；**2026-11-10 起系统镜像也归这一类**）、`08电子书`→`bk-`（2026-10-07 新增）、`010其他`→`ot-`（站内分类名「其他」）、`07课程`→`cs-`（2026-10-13 新增），后接同一编号。`os-` 是已废弃的历史前缀，只存在于 `software.yaml` 里的 11 条存量条目，**新资源不得再用**。
- ⚠ **一般铁律是「id 尾号 = 网盘目录编号」，唯一例外是那 11 条 `os-`**：它们的目录号是 130-140、id 尾号是 001-011，两边对不上。为了让人和脚本都能认领，这 11 条各自多一个 `disk_dir` 字段（值 = 盘端目录实名，如 `disk_dir: "134-windows10"`，从 `share-detail` 的 `data.files[0].filename` 取，不手写不猜）。`check-drive-sync.mjs` 按它认领、`reshare-batch.mjs` 按它定位目录；站点 `normalizeResources()` 是字段白名单，`disk_dir` 不进任何页面、不影响 SEO 与构建产物。**新入库条目不需要 `disk_dir`**（尾号本来就等于目录号）；只有将来再发生「分类合并、条目换了盘端位置但 id 不变」时才给受影响的条目补这个字段。
- **页面标题不带编号**，编号只用于网盘排序与资源 id（全站 150+ 条一致，勿破例）。
- 已编号的目录**不要动**，只处理未编号目录。
- 所有分类一视同仁：游戏、软件（网盘目录 `02应用`）这类目录同样按 `001-名称` 接续编号，不因为是软件就免编号。
- ⚠️ **未编号的目录禁止直接出链**。必须先重命名再出链：重命名会改变分享标题，且重命名后重新出链拿到的是**另一个 URL**，先出的那条即作废。
- `scan-new.mjs` 覆盖 SHARE 下全部 9 个分类（游戏、软件、电子书、课程同样参与编号），各分类顺序一致，一律先 `rename` 再出链。
- ⚠ **`02应用` 的空洞里如果出现 130～140 这一段，停手只报告、不要用**：那说明某份系统镜像的盘端目录被删了，而站点还留着对应的 `os-` 条目（死链候选）。`scan-new` 只看夸克目录、不认识 `disk_dir`，会把这段当成可用空洞，补一个新资源进去就会让那条 `os-` 彻底没人认领。交人工按 `os-` 条目的 `quark_url` 核验（`check-share-links.mjs`），确认删了再由人工决定改写或下架。
- **按扫描返回顺序分配可用编号即可，不要自作主张按年份/系列重排**：可用编号 = 空洞（升序）+ 顺延，扫描顺序决定哪条拿哪个号，不要自己排序。已知代价（2026-11-04 用户定夺：暂不处理）：站点列表排序是「added 倒序 → id 倒序 → 上映日期倒序」（`scripts/lib/data.js`），补位拿到的低编号在同一天多条里会排到顺延条目**后面**，系列作品的页面呈现顺序可能被打乱——**优先保编号紧凑与死链修复，排序问题不动**。
- 同系列多条时，页面上是否好看由上面这条排序规则决定；编号只求唯一、不冲突。

## 编号回收与死链就地改写（2026-11-04 新增）

**要解决的问题**：网盘目录被删（用户清理空壳目录、资源下架）之后，旧口径「max+1 顺延」让这个编号永久空置，站点里指向它的条目点了就是失效页——死链只增不减，编号序列越来越稀。2026-11-04 起改成**顺序检查 + 空洞补位**：编号先填网盘上已释放的空洞，空洞用完才顺延，序列保持紧凑，死链随编号被新资源回收而消掉。

**判定权威 = 夸克实时目录列表**（用户定夺）。百度不做判定（**2026-11-08 起百度盘镜像已停止，网盘上不会再有对应的百度目录，编号分配从此与百度完全无关**）。百度侧若残留着「同编号-旧片名」的空目录，与新目录并存，**不删**（本 skill 从不删网盘文件）。

`scan-new.mjs` 把每个分类的空洞分三类列出来（JSON 字段 `holes_free` / `holes_reclaim` / `holes_blocked`，`next_number` 附带 `next_kind`）：

| 类别 | 含义 | 怎么用 |
| --- | --- | --- |
| `holes_free` | 网盘没目录、站点也没有同 id 条目 | 直接补位，**追加**新条目 |
| `holes_reclaim` | 网盘没目录，但**本分类** `data/*.yaml` 还留着同 id 旧条目（=那条死链本身） | 补位并**就地改写**旧条目（见下） |
| `holes_blocked` | 网盘没目录，但这个 id 被**别的分类文件**占着（现存实例：`documentary.yaml` 里那条 id 写成 `mv-046` 的历史异常） | **不要用**，用了会全站 id 撞号；分配器自动跳过，报告里点名 |

### 就地改写（reclaim）的字段口径

补位拿到 `holes_reclaim` 的编号时，**整块替换**站点里同 id 的那条旧条目，`id` 与详情页地址 `/<slug>/<id>/` 保持不变，条目总数不变：

- 换掉：`title`、`category`、`tags`、`quark_url`、`description`、`date`、`added`（更新为当天）、`image`；
- **整块替换意味着旧条目的 `baidu_url` / `baidu_pwd` 一并消失**——**2026-11-08 起百度镜像与出链已停止，新条目从此不再带百度字段，这就是最终状态，不要手工把旧百度的链接补回新条目**（那是上一份资源的死链）；停用前那种「新资源若本轮百度镜像+出链成功会带上自己的新百度链接」的情形已不会再出现；
- 海报覆盖 `static/images/<slug>/<id>.jpg`；构建会重建 `public/<slug>/<id>/`、`public/img/<id>-*`、`public/qr/<id>-*`；
- 副作用（已知并接受）：这个 URL 之前被搜索引擎收录过旧内容，现在同址换成新资源。

实现走 `scripts/lib/yaml-store.mjs` 的 `upsertEntry()`：在完整行数组上只替换目标条目那一段，写前校验条目数与首行 `# XX资源（N 条）` 注释（⚠️ 正是下文「取消分享的处理边界」里那个「切块 join 重写丢文件头」的坑），校验不过就不落盘；头部条数注释跟着真实条数走。

**无人值守轮次**照此自动执行，不提问：报告里要把每条编号的来源写清楚——`补位（空洞）` / `补位（改写死链 <id>）` / `顺延`，机读报告字段是 `rec.number_kind`（`hole` / `reclaim` / `append`）与 `rec.yaml_mode`（`appended` / `replaced`）。

### 存量空洞不回补

2026-11-04 按夸克实时目录实测：可补位空洞共 **62 处**（`03电视剧` 44、`02应用` 14、`05动漫` 3、`06纪录片` 1），**全部是 `holes_free`**（网盘与站点都没有记录），当时**一处 `holes_reclaim` 都没有**。另有两个反向缺口（网盘有目录、站点没条目）：`mv-212`，以及 `mv-046`——它的条目其实存在，只是被写进了 `documentary.yaml`（分类错位，id 前缀没改）。

**用户定夺：存量一律不回补、不 special-case**——不批量重编号、不回填、不动那条 `mv-046`。新规则只从下一轮起对新增资源生效：今后网盘删目录留下的空洞会被下一批新资源自动吃掉，若站点还留着旧条目就顺带走「就地改写」，死链随之归零。

## 流程

### 1. 扫描

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/scan-new.mjs --out "$(node -e "console.log(require('os').tmpdir())")/scan-new.json"
```

> ⚠️ 别写死 `/tmp/...`（Windows 下无效）：临时文件一律走 `os.tmpdir()`，`--out` 可省略（脚本默认就写那儿）。下面 rename 的 items 文件同理。

输出每个分类的总数、**现有最大编号、可补位空洞清单（`holes_free` / `holes_reclaim` / `holes_blocked`）、下一可用编号 `next_number` 与其来源 `next_kind`**、未编号目录清单，并对疑似重复项标注 `⚠ 疑似重复于 → 015-疑犯追踪`。编号一律按上面的「空洞优先」取，不再直接用 max+1。

**先看重复标注**：归一化后与某个已编号目录同名，通常是用户转存了两次。**交互式**：停下来问用户「删重复的 / 保留并补录 / 是不同版本」，不要在未确认时删除或重复入库。**无人值守**：不问也不删，直接跳过该目录，标注 `duplicate_suspect` 进报告（见「运行模式」表）。

### 2. 确认范围

**交互式**：向用户展示待处理清单（目录名 + 拟定编号 + 编号来源「补位/顺延」），确认后再动网盘。
**无人值守（定时任务）**：不展示、不等待确认——按 `scan-new.mjs` 的返回顺序直接给每个未编号目录分配**当前最小可用编号**（先填 `holes_free` + `holes_reclaim` 两类空洞，空洞用完才取「最大编号 +1」顺延；`holes_blocked` 不用）并进入第 3 步；原名→新名对照 + 每条编号来源留在收尾报告里供用户事后核对。补到 `holes_reclaim` 编号时，站点同 id 旧条目按「编号回收与死链就地改写」整块改写。已编号目录照旧不动。

### 3. 重命名（必须在出链之前）

按 `quarkclouddrive` 技能的规范：写 items JSON 到可写目录，生成 16 位十六进制 batch ID，展示原名→新名对照后执行：

```json
{ "schema_version": 1, "items": [{ "fid": "<完整 FID>", "old_name": "真相捕捉 1-2季全集…", "new_name": "070-真相捕捉 1-2季全集…" }] }
```

```bash
B=$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs rename --batch-id "$B" --items-file /tmp/rename-items.json
```

⚠️ **fid 每次 browse 都会轮换，别跨步骤复用**（2026-10-09 实测修正，这里原先写的「改名不改 fid」不成立）：同一目录连续两次 browse，返回的 fid **全部不同**（变的是 `|` 前面那一段，`|` 后面那个 ID 段始终不变），重命名前后对比也一样，连没有改名的目录都跟着变。用旧 fid 出链会拿到 `{"code":21001,"msg":"文件找不到"}`。

正确顺序：`browse` 取 fid → `rename` → **重新 `browse` 一次取新 fid** → `share`。一次浏览里拿到的 fid 尽快用掉，不要存到下一步再用。批量脚本已在 rename 与 share 之间内建了刷新这一步（`process-batch.mjs` / `app-batch.mjs`），手工单条同样要现取现用。

> 若发现某条已经提前出了链接，重命名后**必须重新出链**，并同步改写 `data/*.yaml` 里的 `quark_url`（旧 URL 与新目录名不对应，且链接本身也会变）。
> 批量改名（含用户自己在网盘里改完再来找你）走「网盘改名 / 分享失效后的修复流程」那一节的三步：核对目录名 → 核对链接 → 重出链回写。

### 3b. 百度网盘同名镜像 + 出链（**2026-11-08 起已停止，本节整节跳过**）

⛔ **停止口径（用户 2026-11-08 明确）：后续不再镜像百度盘目录，也不再给新资源出百度链接。** 无人值守轮次与交互式轮次**都不执行**本节任何命令：不调 `mirror-baidu.mjs`，不调 `baidu-share-links.mjs`，不检查 `bdpan` 登录态（token 过期从此不用再续），报告与飞书卡片里不再有「百度镜像 / 百度出链」两项。

- **存量保持原样**：`data/*.yaml` 已有的 582 条 `baidu_url` / `baidu_pwd` 不改、不删、不取消分享；百度侧已建的镜像目录一律不动（本 skill 从不删网盘文件）。
- **不做最后一班车**：切换时已明确决定不回补「百度侧有同名目录但条目缺 `baidu_url`」的历史缺口，此后也不补。
- **恢复条件**：只有用户当面显式要求「重新开启百度镜像 / 出链」时，才按下面停用前的留档步骤手动执行；自动化任务严禁自行恢复。`trending-sync.mjs` 的默认值也已翻转为关闭，必须显式 `--baidu` 才会镜像。

以下内容是停用前的原流程，**仅作留档**，不要照它执行：

夸克本轮每个新编号目录（rename 成 `编号-名称` 之后）**都要**在百度网盘对应分类下建**完全同名**目录并补占位 md；镜像成功的目录再出**百度永久分享链接**写进条目。与 trending-sync.mjs 内建的「镜像+出链」同理，只是这里是 agent 手动流程：镜像用 `mirror-baidu.mjs --new-dirs` 精确增量，出链用 `baidu-share-links.mjs --no-publish`：

1. 把本轮新建的目录整理成 JSON 数组写到临时文件（UTF-8，**别带 BOM**），元素形如 `{"catDir":"04电影","dirname":"070-真相捕捉","oldName":"真相捕捉 1-2季全集…"}`；`catDir` 用夸克 SHARE 里的分类目录**原名**（`04电影`/`03电视剧`/`05动漫`/`06纪录片`/`01游戏`/`02应用`/`08电子书`/`07课程`/`010其他`，2026-11-10 起 9 个，`09操作系统` 已删），`dirname` 用改名后的 `编号-名称`，`oldName`（选填但**强烈建议带**）用该目录在夸克**改名前的原名**。
2. 镜像：
   ```bash
   node ~/.workbuddy/skills/quark-resource-sync/scripts/mirror-baidu.mjs --new-dirs "<list.json 绝对路径>"
   ```
   逐个 `bdpan mkdir`（幂等）+ 缺占位才传占位（内置 800ms 限速防风控），输出「请求 N / 镜像成功 x / 失败 y」，机读报告在 `~/.workbuddy/quark-sync-cache/mirror-baidu-last.json`（字段 `new_dirs.{requested,ok,failed}`）。
3. **只镜像本轮新建的目录，绝不跑全量回补**：不要用 `--cats` / `--cats all` 的对账模式（那会把历史缺口一起补，将军已明确历史缺口不补）。`--cats all` 只在用户显式要求「回补历史」时才用。
4. **出链并写库（2026-11-04 起，镜像成功的目录都要做）**：等**第 6 步条目写入 `data/*.yaml` 之后、第 7 步构建之前**执行（出链结果要进本轮 commit，顺序不能反）：
   ```bash
   node ~/.workbuddy/skills/quark-resource-sync/scripts/baidu-share-links.mjs --no-publish
   ```
   幂等：只给「缺 `baidu_url` 且百度侧有同名编号目录」的条目出**永久**分享链接（被拒自适应降级 30/7 天），把 `baidu_url`/`baidu_pwd` 插到条目 `quark_url` 之后并做全量 js-yaml 校验；百度侧没有同名目录的条目自动跳过。退出码 `3`=百度列表接口被限（稍后单独重跑即可，不阻断本轮），`0`=正常（含无可出链条目）。机读报告 `~/.workbuddy/quark-sync-cache/baidu-share-links-last.json`。

要点与边界（同 trending-sync 内建口径）：
- 两盘目录逐字同名、编号跟随夸克本轮值；百度侧**只建同名空目录 + 占位文件，不上传真实资源**；镜像成功的目录**当场出百度永久分享链接写入条目**（`baidu_url`/`baidu_pwd`，2026-11-04 起），站点页面仍只渲染夸克链接（百度字段在数据层，供社媒/外部分享用）。
- **百度侧已有同名资源目录时改名对齐、不新建**（2026-11-04 起硬规则）：用户经常把资源**同时转存到百度**（用夸克改名前的原名），镜像时若百度已存在该 `oldName` 目录，脚本会把它**原地改名**成 `编号-名称`（内容随目录走、分享链接直接有效），**绝不新建空目录造成同剧两份**。所以清单里务必带 `oldName`；漏带且百度已有同名资源时，会新建出空目录，事后要按「移内容进编号目录」返工（2026-11-04 太空部队等 5 条踩过）。
- **bdpan 未登录/token 过期**（whoami 失败）：整轮镜像与出链跳过，**不阻断**夸克入库、出链、构建、推送、飞书；无人值守时无法完成设备码登录，只在简报「需要人工跟进」写「百度镜像/出链本轮跳过：需在终端 `C:/Users/marco/AppData/Local/bdpan/bdpan.exe login --device-code` 重新授权」（token 有效期约 1 周，实测到 2026-11-09），不要反复重试。
- **个别目录失败**（百度风控/特殊字符/瞬时 400）：记进简报「需要人工跟进」；镜像缺口可事后单独再跑一次 `--new-dirs` 补，出链缺口重跑一次 `baidu-share-links.mjs --no-publish`（幂等）即可；不阻断主流程。
- 本轮没有任何新建目录时跳过本节。

### 4. 出链（公开 · 无提取码 · 永久）

```bash
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs share "<FID>" \
  --title "070-真相捕捉" --url-type 1 --expired-type 1
```

取返回的 `share_url`。

> **`--url-type 1` 绝不能省（2026-11-09 实测踩坑）**：只带 `--expired-type 1` 而省略 `--url-type` 时，服务端实际回的是 `url_type: 2` + 一个随机 `passcode`，即**加密链接（带提取码）**，与站内其余永久公开链接不一致，而且**本 CLI 没有取消分享的命令**，错了只能让用户在夸克客户端手动删。出链后务必核对返回的 `data.url_type == 1` 且没有 `passcode` 再写库。

> **fid 轮换**：Windows PowerShell 会把 Tab 当分隔符拆开 native 输出，逐行 `split("`t")` 解析多列结果会错位（2026-11-09 就是这样给错目录出过一次链）。要按 `filename → fid` 匹配时，一律让 node 脚本把结果写成 JSON 文件再读，别在 PowerShell 里解析文本行。

> fid 要用**刚 browse 到的那个**（见第 3 步的轮换说明），别拿扫描阶段存下来的旧 fid 直接出链。


### 5. 抓信息（TMDB）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/tmdb.mjs search --type tv --query "真相捕捉" [--year 2019]
node ~/.workbuddy/skills/quark-resource-sync/scripts/tmdb.mjs detail --type tv --id 93166 \
  --poster "$REPO/static/images/tv/tv-070.jpg"
```

- `--type` 电影用 `movie`，剧集/纪录片用 `tv`。
- 搜索无结果或明显不是同一部 → 走「TMDB 未命中」：标题用网盘目录原名（去掉编号与技术规格），简介写一句中性描述，并在报告里说明。
- **电视剧（`tv-`）必须在简介里标注「第几季 / 共多少集」**（2026-10-06 新增，硬要求）：
  - 数据源**只用官方（TMDB）资料**：`number_of_seasons` / `number_of_episodes`（`tmdb.mjs detail` 输出的 `seasons` / `episodes` / `season_list`）。**不用核对夸克网盘里实际存了几集 / 哪几季**（2026-10-06 用户明确：按官方资料写就行）。
  - 写法：在简介**正文之前**加一段方括号标签（不留分隔符），仍以 `｜TMDB <评分>` 收尾：
    - 单季剧：`【第 1 季 · 共 12 集】剧情简介…｜TMDB 7.6`
    - 多季剧：`【全剧 6 季 · 共 86 集】剧情简介…｜TMDB 8.1`
    - 某一季（`trending-sync` 自动入库的新剧会这样写）：`【第 2 季 · 共 10 集 · 全剧 3 季】剧情简介…｜TMDB 7.9`
  - `trending-sync.mjs` 已内建该逻辑：取**最新一季**的季号 + 该季**官方整季集数**生成 `【第 N 季 · 共 M 集 · 全剧 X 季】`；`process-batch.mjs` 按整剧生成 `【共 M 集】` / `【全剧 X 季 · 共 M 集】`；手工补录按上面三种写法选一种。
  - **口径是「官方整季有多少集」，不是网盘里存了几集**（2026-10-06 用户明确：按官方资料写就行，不用关注夸克网盘上保存了多少集）。在播剧也按整季集数写，不按已播集数。
  - TMDB 未命中也要标：从目录名 / 已知信息推断（如 `070-真相捕捉 1-2季全集` → `【全剧 2 季】`）；确实拿不到才省略，并在收尾报告里点名说明。
  - 动漫 / 纪录片这类分集资源同样处理（能拿到集数就标）。
  - **存量条目暂不回填**（2026-10-06 用户决定：已经存在的不用改，只保证今后新增的按此规则走）。要回填时用 `scripts/backfill-tv-spec.mjs`（先 `--dry` 预览），它会先备份再写。
- **⚠ 禁止 AI 文生图（2026-11-19 指挥官定，全局生效）**：**任何分类都不得用 AI 文生图（ImageGen 等）生成海报主视觉**。没有官方封面的资源（课程 `cs-`、音乐合辑、特辑等）一律**先上网找真实图片**——官方 / 半官方宣传图、课程平台详情页头图、电商详情主图、Pexels / Unsplash 等公开图库；全网都找不到才退 `poster.mjs` 自绘兜底。指挥官原话「我不要 AI 生成图片，你自己想办法去网上找图片」。此前「课程类主流做法就是文生图」的口径**作废**。
- **⚠ 自绘 / 合成海报一律用亮色底（2026-11-17 指挥官定，全局生效）**：凡是由我们决定底色的海报（`poster.mjs` 的 `scene` / `icon` / `book` / `set` 等所有合成模式），**底色必须明亮**（暖白 / 浅粉 / 暖橙 / 浅蓝这类明亮渐变），**禁止纯黑 / 深灰 / 深色渐变那种「黑乎乎」的版式**。`set` 预设的深色收藏版式已弃用，套装 / 合辑改用 `scene` 的亮色预设或新增亮色预设；需要深色的场景（如 `silk` 夜色金月、`dl` 深蓝发光）不要再用于新条目，已有存量不动。指挥官原话「以后不要这种黑乎乎的海报了」。**边界**：本条只约束自绘海报；影视 / 游戏 / 书籍抓来的官方原版海报即使本身偏暗，属原素材照用，不算违规。
- **配图：先按分类选图源，合成 2:3 竖版**（2026-10-09 依站点 README「配图规范」与「经验总结」整理成决策表）：
  | 分类                  | 图源                                                                                                          | 工具                                  |
  | ------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
  | 电影 / 电视剧 / 纪录片 / 动漫 | TMDB 海报 `https://image.tmdb.org/t/p/w500/<path>.jpg`（500×750，正好 2:3）                                        | `tmdb.mjs detail --poster`          |
  | 游戏                  | ① **Steam 官方竖版封面 600×900**（走下方「Steam 取图标准姿势」，`poster.mjs` 合成图不算真实海报）→ ② 英文维基百科官方盒绘（`upload.wikimedia.org`，约 256×364，够用）→ ③ Wikimedia Commons 官方 logo（矢量）→ ④ 自绘 | 直接下载；logo 走 `tools/poster.mjs icon` |
  | 软件（`app-`）          | ① App Store 官方图标 → ② 官网 `og:image` / `apple-touch-icon` → ③ GitHub 项目 / 组织头像 → ④ 自绘白色线性图标                   | `tools/poster.mjs icon`             |
  | 系统镜像（归「软件」`app-`；存量 11 条 `os-`） | simple-icons 官方标志（CDN 直取，单色图标）                                                           | `tools/poster.mjs icon`             |
  | 电子书（`bk-`）          | 豆瓣正版封面 → 套装用 `poster.mjs set` → 查无才 `poster.mjs book`                                                       | 见下方电子书条目                            |
  | 查不到图                | **兜底**才不填 `image`，构建按分类回退占位海报                                                                               | —                                   |
  **非影视资源配图（用户 2026-11-08 明确口径）**：入库只需 **有一张配图 + 简介字数达标**（正文 ≥150 字，2026-11-12 起）。尽量按上表降级取真实素材（TMDB 一定命中不了，别偷懒留占位），但**「英文维基百科官方盒绘」不是硬性指定图源、「出图后必须打开看一眼」的强制目视核验也不是用户要求**——取不到合适图就直接用分类占位海报入库，无人值守轮**绝不因配图而停下或阻断**。（若能顺手看图发现明显问题再修，但不作为入库前置条件。）脚本只打印尺寸。

  **⓪ 真实素材优先：自绘是最后手段，不是首选**（2026-10-09 返工教训：一批 12 条里 5 条直接自绘，上线后被要求全部换成官方素材重做）。开工前先把「官方 logo / 官方盒绘 / 官方图标 / 网上真实图片」这几条路走一遍，走不通再自绘；判据很简单，**自绘图没有参考物、观感与官方素材差一档，一排卡片里一眼就看出来**。课程类同理：先找课程平台详情页封面、官方宣传图、电商主图，找不到才自绘，**不得用 AI 文生图代替找图**。
  - **尺寸判据（省掉大量无用探测）**：站点列表页与详情页共用同一张 **240×360** 海报（`scripts/lib/assets.js` 的 `CARD`，`fit: 'cover'` 裁切）。所以源图**宽度 ≥240 就够用**，不必死磕高清源；维基百科那种约 256×364 的官方盒绘完全达标。别再为「找不到 600×900」反复试站——**但游戏类例外：Steam 的 600×900 原图按下面固定三步必然拿到，该用它就别退到 256px 盒绘**。
  - **图源探测结论（2026-10-09 实测，按可用性排序，下次直接照抄，别重复试）**：
    | 图源                                                   | 结论                                      | 说明                                         |
    | ---------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
    | Steam `store_item_assets`（配合 IsThereAnyDeal 资源页定位 URL） | ✅ **游戏首选**                              | 官方竖版封面 600×900，天然 2:3；新条目路径多一段 sha1，猜不中，见下方标准姿势 |
    | `upload.wikimedia.org`（英文维基百科官方盒绘 / Commons 矢量 logo） | ✅ **首选**（软件 logo；游戏类是 Steam 取不到时的降级） | 游戏盒绘、软件与开源工具的官方 logo 都能直取；**必须带浏览器 UA**，封面常只有 253–316px |
    | App Store `artworkUrl512`（iTunes Search API）         | ✅ 可用                                    | 软件类首选，`entity=macSoftware` / `software` 都试 |
    | TMDB 节目海报                                            | ✅ 可用                                    | 综艺 / 剧集类，`tmdb.mjs detail --poster`        |
    | simple-icons CDN                                     | ✅ 可用                                    | 发行版 / 操作系统标志、品牌标志（单色 SVG）              |
    | `cnc.fandom.com` / `zelda.fandom.com` 等 Fandom       | ❌ 本机整站连不通（API 与 `Special:FilePath` 均超时） | 别在 Fandom 上耗时间                             |
    | MobyGames 封面                                         | ❌ 403                                   | 直取被挡                                       |
    | 任天堂官网 `assets.nintendo.com` 猜路径                      | ❌ 不可靠                                   | 路径带机型 / 区域段，猜不中                            |
  - **英文维基百科取官方图的标准姿势**（游戏盒绘与官方 logo 通用）：
    ```bash
    # 1) 找页面上的图片文件名（游戏条目常见 xxx cover.jpg，软件常见 Logo.svg）
    curl -s -H "User-Agent: Mozilla/5.0" \
      "https://en.wikipedia.org/w/api.php?action=query&titles=<Page_Title>&prop=images&imlimit=50&format=json&redirects=1"
    # 2) 批量拿直链 + 尺寸 + 格式（一次查多个文件用 | 分隔）
    curl -s -H "User-Agent: Mozilla/5.0" \
      "https://en.wikipedia.org/w/api.php?action=query&titles=File:A.jpg%7CFile:B.svg&prop=imageinfo&iiprop=url%7Csize%7Cmime&format=json"
    # 3) 下载（带 UA，否则 403）
    curl -sL -H "User-Agent: Mozilla/5.0" -o "$REPO/.tmp/cover.jpg" "<imageinfo.url>"
    ```
    两种用法：**盒绘**（`non-free` 的 `xxx cover.jpg`）直接 `cp` 成 `static/images/<slug>/<id>.jpg`（约 256×364，够用）；**官方 logo**（Commons 上的矢量 SVG）交给 `tools/poster.mjs icon` 配品牌色作底（如 Ryujinx 官方双色 #02c5e5 + #ff5f55），比自绘的通用符号强得多。查不到条目名就先 WebSearch 一次拿到准确的英文条目名。
  - **Steam 竖版封面取原图的标准姿势（游戏首选，2026-11-10 实测；天然 2:3，比维基 256×364 清晰一档）**：
    ```bash
    # 1) 英文名 → appid（顺带拿中文条目名与发售日）
    curl -s -A "Mozilla/5.0" \
      "https://store.steampowered.com/api/storesearch/?term=EA%20SPORTS%20FC%2027&l=schinese&cc=cn"
    # 2) 先试无 hash 的老路径：老条目命中，新上架条目一律 404
    curl -sI -A "Mozilla/5.0" \
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/<appid>/library_600x900.jpg"
    # 3) 404 就去 IsThereAnyDeal 的资源页取带 hash 的完整 URL —— 页面直接列出各商店 BoxArt 的地址与尺寸，
    #    不用猜：https://isthereanydeal.com/game/<slug>/assets/
    curl -sL -A "Mozilla/5.0" -o "$REPO/.tmp/capsule.jpg" "<上一步拿到的 URL>"
    ```
    竖版原图就四种名字，认准 `_2x` 那档（600×900）：老条目 `library_600x900.jpg`(300×450) / `library_600x900_2x.jpg`(600×900)，新条目 `library_capsule.jpg`(300×450) / `library_capsule_2x.jpg`(600×900)。
    落图**只做等比缩放**——不裁切、不加中文标题、不配渐变底（在仓库根目录跑，`sharp` 从 `node_modules` 解析）：
    ```bash
    cd "$REPO" && node -e "require('sharp')('$REPO/.tmp/capsule.jpg').toColorspace('srgb')\
      .resize(480,720,{fit:'cover',kernel:'lanczos3'}).jpeg({quality:82,mozjpeg:true})\
      .toFile('static/images/<slug>/<id>.jpg')"
    ```
    `toColorspace('srgb')` 不能省：Steam 老素材常见 CMYK JPEG（`file` 显示 `components 4`），不转直接上线会偏色。
    - **实测样本**：`game-025` EA SPORTS FC 27 = appid 4080220 → `…/4080220/81210d53…/library_capsule_2x.jpg`（标准版封面）；`game-026` 植物大战僵尸精华版 = appid 3590 → `…/3590/library_600x900_2x.jpg`（GOTY 封面，CMYK 需转）。
    - **民间修改版**（精华版 / 西游版 / 融合版这类）**没有自己的官方海报**，取原版游戏的官方封面即可，别为了「对得上魔改内容」去自绘。
    - **反例（2026-11-10 被用户退回重做）**：`tools/poster.mjs` 那套「渐变底 + 素材 + 中文标题」合成图**不算真实海报**，游戏类不许拿它当成品交付；它只用于软件 / 系统镜像这类只有单色 logo、必须配底色的资源。
    - 无人值守轮口径不变：Steam 与维基都取不到就用分类占位入库，**绝不因配图停下或阻断**（以本节上方「非影视资源配图」的用户口径为准，取图步骤只是把首选路径写清楚，不是新增前置条件）。
  **① App Store 官方图标（软件首选，无需鉴权）**
  ```bash
  # Mac 应用用 entity=macSoftware，iOS / 通用用 entity=software
  curl -s "https://itunes.apple.com/search?term=AdGuard&entity=macSoftware&country=cn&limit=3"
  # 结果取 artworkUrl512（512×512）

  node "$REPO/tools/poster.mjs icon" --icon "<artworkUrl512>" --out "$REPO/static/images/app/app-005.jpg" \
    --title "AdGuard" --sub "广告拦截 · 隐私保护" --c1 "#2f8f5b" --c2 "#7ccb95" --radius 22
  ```
  | 参数                  | 作用                                 |
  | ------------------- | ---------------------------------- |
  | `--icon`            | 图标，本地文件路径或图片 URL 都行                |
  | `--title` / `--sub` | 海报上的应用名与一句话定位，都可省（不给就留白）           |
  | `--c1` / `--c2`     | 背景渐变两端，默认墨绿；拿不准就用默认                |
  | `--radius`          | 图标圆角，按边长百分比；直角方形图标给 `22`，本身已带圆角就别加 |
  | `--icon-size`       | 图标边长，默认 300；源图小时调小，避免放大发糊          |
  输出固定 480×720 JPEG，图标居中偏上，与站内其它海报同一套观感。

  四条踩过的经验：
  1. **别拿搜索结果第一条就用**：同一个词常回来好几个不相干的应用（搜 `AdGuard` 会混进 AdBlocker Pro、uBlock Origin Lite）。`limit` 给 3~5 条，比对 `trackName` / `sellerName` / `bundleId` 确认是同一个东西，再取 `artworkUrl512`。
  2. 关键词宁短勿长：`Parallels Desktop 18` 带版本号经常搜不到，用 `Parallels Desktop` 再自己挑版本。`entity` 选错（Mac 应用去 `software` 里搜）会一无所获，两个都试一遍；`country=cn` 影响结果集与名称本地化。
  3. 圆角只加一次：先打开 `artworkUrl512` 原图看一眼，图标本身已带圆角就不要再给 `--radius`，直角方形图标才加 `--radius 22`，加两层会看到明显的双圆角。
  4. **出图尽量抽查一眼（非硬性前置）**：标题顶边、图标偏小、`--sub` 缺省时标题位置下移，能看图发现就顺手修；但用户 2026-11-08 明确不要求强制目视核验，看图与否都不阻断入库。批量补图时（本站一次补过 49 / 51 条）可抽查几张，别只看脚本打印的尺寸。
  **② 系统镜像 / 发行版：simple-icons 官方标志**（这类资源现在归「软件」、id 用 `app-`；Windows、Ubuntu、Debian、Fedora、Linux 等都有官方 slug）：
  ```bash
  # 图标名 = 官方 slug（全小写、无空格）；先探活再取，404 就是名字不对
  curl -s -o NUL -w '%{http_code}\n' https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/fedora.svg
  curl -sL https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/fedora.svg -o "$REPO/.tmp/fedora.svg"

  node "$REPO/tools/poster.mjs icon" --icon "$REPO/.tmp/fedora.svg" --out "$REPO/static/images/app/app-141.jpg" \
    --title "Fedora 44" --sub "Workstation Live · x86_64" --c1 "#1b3a6b" --c2 "#5f9bd8"
  ```
  （存量 11 条历史条目的海报仍叫 `static/images/software/os-001.jpg ~ os-011.jpg`，id 没改、文件也没改名，别去动它们。）
  - **别手动改 SVG 的 `fill`**：这类单色图标的 `<path>` 不带 `fill`，直接渲染是一块黑。`tools/poster.mjs icon` 现在会自动在 `<svg>` 根元素补 `--svg-fill`（默认 `#fff`，SVG 的 fill 可继承），要保留原色就显式传 `--svg-fill black` 之类，或传 `--svg-fill` 空字符串关掉。
  - CDN 不通时换源：`https://unpkg.com/simple-icons@latest/icons/<slug>.svg` 或 `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/<slug>.svg`（图标名同样是官方 slug）。
  - **配色跟发行版品牌色走**：Debian 红、Fedora 蓝、Ubuntu 橙、Windows 深蓝。分类页一排看下去能一眼分辨是哪个发行版，比统一配色有用。
  - 发行版版本号别写错：`--title` 用「发行版 + 版本」（`Windows 11 26H2`、`Debian 13.7`），`--sub` 放镜像形态与架构（`Workstation Live · x86_64`、`amd64 DVD-1 镜像`）。
  **③ GitHub 项目 / 组织头像**（开源工具常能取到）：`https://github.com/<org>.png?size=460` 直接取，**别去猜组织的数字 ID**，猜错会拿到完全不相干的头像。⚠️ 有些组织**已把头像清掉**，取回来是默认 identicon（灰底几何图形），这种要**打开看一眼**再决定用不用（实测 2026-10-09：Ryujinx 组织头像已失效）；此时改去 Wikipedia Commons 找官方 logo（见 ⓪ 档），别退回自绘。

  **④ 自己画**：Windows 工具类资源（驱动、激活工具、Office 部署器）**把 ⓪ 档四类官方图源都试完**（App Store / 官网 og:image 与 apple-touch-icon / GitHub / Wikipedia）确实都不像样时，才画一个 512×512 的白色线性图标（WiFi 信号、钥匙、下载箭头这类通用符号就够），参数同上（`--title` / `--sub` / `--c1` / `--c2` 控制文字与配色）。**顺带在收尾报告里点明哪几条是自绘**，便于下一轮再找真实素材替换。

  **⑤ 兜底**：实在找不到才退回 `image: placeholder.svg`（构建时自动套用所属分类的占位海报：渐变底 + 专属底纹 + 分类图标 + 分类名）。
- **电子书（`bk-`，网盘目录 `08电子书`，2026-10-07 新增）**：TMDB 没有书籍数据（Google Books / Open Library 本机实测都不通），元数据一律人工整理：
  - 简介自己写：内容梗概 + 作者信息，结尾用 `｜作者：[国籍] 姓名`；**正文前加 `【epub · pdf · mobi · azw3】`** 标出资源里实际有哪些格式（001 这类多格式的要写全）。
  - `date` 填首版出版年份（月份日期拿不准就 `01-01`），`tags` 首个为「电子书」，末尾放「中文名 原名」。
  - **封面优先抓豆瓣图书正版封面**（2026-10-07 落地，比生成式书封好看得多）：`node "$REPO/tools/poster.mjs" douban --title "书名" [--author 作者关键字] [--pick 豆瓣条目id] --out "$REPO/static/images/ebook/bk-002.jpg"`，`--list` 只看候选不下载。同一书名的多个版本用 `--author` 或 `--pick` 选定；**下载后必须用 sharp 看一眼实际画面**，豆瓣上有些条目封面是「封面+封底」展开图，那种要换别的版本。豆瓣查无此书（如已下架）才退回 `tools/poster.mjs book` 生成（渐变底 + 书本图形 + 书名自动分行 + 作者 · 年份），别留占位图：
    ```bash
    node "$REPO/tools/poster.mjs" book --title "牧羊少年奇幻之旅" --author "[巴西] 保罗·柯艾略" \
      --year 1988 --out "$REPO/static/images/ebook/bk-002.jpg" --c1 "#8a5a33" --c2 "#e3b98f"
    ```
  - **套装 / 合辑**（如《斯蒂芬·金的王牌惊悚套装》共 17 册）没有对应的单册封面，豆瓣条目多半只有展开图或干脆无图，改用 `tools/poster.mjs set` 自排深色收藏版式（2026-10-07 落地）：`node "$REPO/tools/poster.mjs" set --kicker "STEPHEN KING" --prefix "斯蒂芬·金的" --title "王牌惊悚套装" --badge "共 17 册" --label "COLLECTED WORKS" --formats "epub · mobi · azw3" --author "[美] 斯蒂芬·金" --out "$REPO/static/images/ebook/bk-006.jpg"`。参数都可缺省，`--accent` 换主色。**别拿 book 模式凑（它画的是单本书，语义不对）**；自排封面没有参考物，出图必须打开看了一眼再入库。套装 `date` 填**套装的出版时间**，不是里面某一本的首版年。
  - 豆瓣抓取要点（工具已封装，改脚本时别踩）：搜索页 `book.douban.com/subject_search?search_text=` 内嵌 `"items": [...]` JSON，从 `"items": [` 后做括号配对切数组再 `JSON.parse`；封面地址把 `/m/public/` 换 `/l/public/` 得大图（约 500×750）；请求**必须带**浏览器 UA + `Referer: https://book.douban.com/`，且要 limit 频率（脚本内置重试与间隔）。`/j/subject_suggest?q=` 接口索引不全，别用。
  - 一个 ✖ 目录 = 一本书：本色电子书（同名不同格式的多个文件）直接放在同一编号目录里，不出来单成一条。
- **系统镜像（归「软件」分类、id `app-`，盘端住在 `02应用`；2026-10-09 曾单列为「操作系统 / `os-` / `09操作系统`」，2026-11-10 已并入软件，存量 11 条仍叫 `os-001~os-011`）**：TMDB 没有系统数据，元数据人工整理：
  - **`date` 填该版本的发布 / 发行日期，必须核实过**（`added` 才是入库时间）。两个实测坑：**构建号不等于版本通道**，Windows `26300.9457` 属 **26H2 正式版**，写成「Insider 预览」等于把正式版说成测试版；**点版本要对齐点版本自己的日期**，Debian 13.7 是 trixie 的第 7 个点版本（2026-09-12），不能拿 13.0 的发布时间顶上。查不到确切日期就**留空**，不要填一个「差不多」的日期（详情页显示的就是这个字段，填错比不填更糟）。
  - **简介写清版本定位与适用场景，且必须与目录内容一致**：目录里只有 `.torrent` 种子就写「当前提供的是种子」，别写成「官方 ISO 镜像」。正文同样按 ≥ 150 字（≤ 700 字）、自写文案禁止破折号的口径写，末尾不加 `｜TMDB …` 署名。
  - `tags` 首个仍写「操作系统」——**这是标签页在用的标签，与分类无关**（站内 `/tag/操作系统/` 聚合页照旧存在，存量 11 条也带着它），`category` 必须写「软件」；末尾放「中文名 原名」（如 `Windows 10 企业版 LTSC 2019 Windows 10 Enterprise LTSC 2019`）。
- **非影视资源的 `date` 一律填版本发布 / 出版日期并核实过**（软件、系统镜像、电子书通用）：能在官网 / 官方博客查到就查（本次 5 条里 4 条核过），查不到就留空。影视类从 TMDB 取，不受此条约束。
- **网盘目录为空也照样出链入库**（2026-10-09 实测 `005-ubuntu`）：资源可能还在上传。分享链接长期有效，资源转存进去后同一条链接直接生效，不用回头改 YAML；空目录的占位 md 见「占位说明文件补齐」。
- **剧情简介必须二次加工，禁止照搬 TMDB 原文**（2026-10-08 新增，硬要求）。TMDB 中文 overview 多是简述式的一两句，直接入库有两个毛病：正文与 TMDB、豆瓣等站点高度雷同（不利于收录），以及信息量太薄撑不起详情页。拿到 overview 后按下面四条处理：
  1. **改写，不是同义词替换**：事实全保留（人物、关系、核心冲突、类型、年代、产地），换掉叙述顺序与句式，把 TMDB 那种「一句话带过」的写法展开成完整段落。同一部片子换个人来写，读起来应该看得出不同。
  2. **补料扩写**：素材从 `tmdb.mjs detail` 已经返回的字段里取（`genres` / `tagline` / 上映年份 / 导演 / 主演 / 季数与集数 / 片长 / 产地 / 评分），融进正文，比如点出导演风格、主演阵容、类型看点、与前作的关联。**只陈述拿得到的事实，不编造情节**，宁可写短一点也不写没发生过的事。
  3. **正文下限 150 字**：改写后的正文（先去掉 `【第 N 季 · 共 M 集】` 这类方括号标签，再去掉结尾 `｜TMDB <评分>`）**不少于 150 字**。TMDB 原文即使已经超过 150 字，也照样要改写（目的就是不雷同），改完同样不得低于 150 字；上限 **700 字**（2026-11-12 起从 200/1200 调整为 150/700）。
  4. **结构与收尾**：开头一句点出类型与背景，中间展开人物与冲突，结尾落在看点或风格；电视剧先写 `【第 N 季 · 共 M 集】` 再进正文；结尾照旧追加 `｜TMDB <评分>`，评分值不改。自己写的部分仍然禁止破折号（见下方标点规范）。
  字数按 `[...正文].length` 计（一个汉字、一个标点都算 1），统计前先剥掉标签与评分尾巴：
  ```bash
  node ~/.workbuddy/skills/quark-resource-sync/scripts/check-desc.mjs          # 列出全部条目里正文不足 150 字的
  node …/check-desc.mjs --min 150 --file movie.yaml                             # 只看某一份数据
  node …/check-desc.mjs --show                                                 # 连同正文一起打印，方便直接改写
  node …/check-desc.mjs --draft "$REPO/.tmp/desc-draft.json"                   # 导出改写骨架，交给 fill-desc.mjs
  ```
  入库前用上面第一条自查一遍。**批量补写走仓库那条链路**（比对脚本更顺手）：
  ```bash
  cd "$REPO"
  npm run list:short                        # 列出正文不足 150 字的条目（默认阈值取仓库 data.js 的 MIN_DESC），清单落 .tmp/short-desc.md
  # 改写后把正文写进 .tmp/desc-draft.json（{ "mv-212": "新正文" }，只写正文，标签与署名脚本会自己接回去）
  node tools/fill-desc.mjs                  # 空跑，会点名不足 150 字的条目
  node tools/fill-desc.mjs --strict         # 不足 150 字的直接跳过不写
  node tools/fill-desc.mjs --apply          # 落盘，随后构建 + 推送
  ```
  补写进度见站点 README「建议优化」第 3 项。**下限沿革**：2026-10-08 从 200 提到 300 → 2026-10-22 下调回 200 → **2026-11-12 起调整为 150**，新增与补写一律按 150 字下限走。存量条目「以前的数据不管」，不批量回填，撞线的只在自然复核时顺手改。
- **标点规范（将军的硬要求，优先级最高）**：**自己撰写或改写的简介正文里禁止出现破折号（`——`）**，要断句就用逗号（，）或冒号（：）。适用所有人工文案（电子书、软件等）。TMDB / 豆瓣抓回来的第三方原文**保持原样不动**（电影 / 电视剧 / 纪录片分类里的破折号就是这么来的，别去改）。替换时注意两点：别造成「：」叠用（前一句刚用过冒号就用逗号），同一行多处破折号要统一处理成同一种符号，保持并列项一致。
- **软件分类（`app-`）的简介必须是中文，且不得半句截断**：iTunes / GitHub 抓到的原始简介多为英文，`app-batch.mjs` 只是机械入库，**入库后必须逐条检查并把英文简介改写成完整中文**（保留「（开源免费，主页 URL）」与结尾「｜开发者」），再提交推送。描述正文写入上限 **700 字**（2026-11-12 起），要覆盖产品定位 + 主要功能，不要留 `……` 或句子中断的痕迹——**若 700 字把句子切在半截，按本条口径必须人工压缩重写到 700 字以内，不能就这么入库**。判断是否有漏网英文：统计中文字符占比 < 15% 即视为英文，需改写。

### 6. 写入数据

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/make-entry.mjs --data '{
  "id":"tv-070","title":"真相捕捉","category":"电视剧",
  "tags":["电视剧","犯罪","剧情","悬疑","真相捕捉 The Capture"],
  "quark_url":"https://pan.quark.cn/s/xxxx","description":"【第 1 季 · 共 6 集 · 全剧 2 季】…｜TMDB 7.6",
  "date":"2019-09-03","added":"2026-09-29","image":"tv-070.jpg"}'
```

脚本校验 id / 分类 / 链接 / 日期格式与海报是否存在，输出 YAML 片段；确认后追加到对应 `data/<分类>.yaml` 末尾。字段含义见 `references/site-schema.md`。

> **标题副标（2026-11-16 补强校验）**：只有游戏 / 软件 / 电子书 / 课程 / 其他 五类需要副标，写成「**原名 - 客观功能描述**」（如 `Git for Windows - 分布式版本控制工具`，副标 8~12 字、从 description/tags 提炼、禁用「最好/必备/第一」等绝对化词）。**电影 / 电视剧 / 动漫 / 纪录片一律纯作品名、不加副标**（TMDB 剧名检索、季号识别依赖精确片名；指挥官 2026-11-16 重申）。以下情况**不再叠加副标**：标题已自带 `-`/`：`/括号/圆点等形态；**长标题本身自解释可不用**（中文≥10 字 或 任意字符总长≥18，口径 = 仓库 `scripts/lib/data.js` 的 `isLongTitle()`，即指挥官「主标题已经很长的前提下也可以不用副标题」）。`make-entry.mjs` 会强校验这条，不符合直接报错不入库。**2026-11-16 的 app-105 就因绕过 make-entry 用自写脚本写入而漏了副标，事后用 `tools/fill-title.mjs --map` 补回**——非影视类务必走 make-entry 或自写脚本时自行套同一口径，别再漏。

> **`added` 建议带上入库时刻**（2026-10-08 起支持）：写成 `"2026-10-07 17:40"`（**要加引号**），首页就能按实际入库先后排，后加的排在最前；只写 `2026-10-07` 的按当天 00:00，会落在同日带时刻的条目之后。新资源一律带时刻。

> **标题口径**：优先用 TMDB 中文名（`tmdb.mjs detail` 的 `title`）。若该字段回落到英文（TMDB 没登记中文译名，如 `mv-251 Resident Evil: Welcome to Raccoon City`），改用**网盘目录里的中文名**（`新生化危机`）。网盘目录名可保留「第N部」这类分集字样，页面标题用 TMDB 正式名，两者不必一致。
>
> **解析 YAML 校验**：仓库依赖是 `js-yaml`（`require('js-yaml')`），**没有** `yaml` 包；跑校验脚本时要 `cd` 到仓库或用 `NODE_PATH` 指向 `$REPO/node_modules`，否则报 `Cannot find module 'yaml'`。

### 6b. 光鸭网盘 SHARE 补链（每轮必跑，2026-11-16 新增）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/guangya-sync.mjs
# 只扫描不出链：加 --dry-run；排障：--only bk --limit 2
```

- **定位**：光鸭网盘 `SHARE/` 下是夸克资源在第二个网盘的副本，分类目录名与夸克一致。站点条目已存在，这一阶段只给**缺 `guangya_url` 的条目**补光鸭公开分享链接，不新建条目、不动 `added` / `updated` / `files:` / 海报，也不自己构建或推送。
- **顺序**：夸克写 `data/*.yaml` → `fill-files.mjs` 补文件清单 → **光鸭补链** → 构建。放在 fill-files 之后，是因为后者会校验 diff 只有 `files:` 新增行，提前写光鸭链接会被误判成「`files:` 以外的内容被改」。
- **编号对齐（2026-11-16 定，2026-11-17 指挥官订正参照物）**：补链前先跑 `guangya-renumber.mjs`（已由 `guangya-sync.mjs` 自动调用，不必单独执行），把光鸭侧**无编号前缀的裸名目录**原地 `rename` 成 `<夸克编号>-<原名>`（如夸克侧是 `106-解压缩7-Zip`，光鸭裸名 `解压缩7-Zip` → `106-解压缩7-Zip`），内容随目录走、不建空目录。**对齐参照物是夸克网盘上的同名资源目录，不是站点 YAML 的 `title`**——站点标题是入库时另起的描述性标题（如 app-106「7-Zip 26.06 - 开源文件压缩解压工具」），跟盘端目录裸名（`解压缩7-Zip`）本就不是一回事，拿它匹配必然对不上；2026-11-16 的旧实现错在这里，2026-11-17 改为实时 `browse` 夸克 SHARE 同分类目录、按「去编号后的目录名」宽 norm 建镜像映射。判定极保守：光鸭裸名与夸克同分类目录名**唯一命中** + 目标编号未被光鸭现有目录占用 → 取夸克编号改名；不唯一/无匹配/编号冲突一律跳过只记录，已有编号前缀的目录幂等不动。改名成功后紧接着 list 即可按新编号配对出链。可单独 `node scripts/guangya-renumber.mjs --dry-run` 只查不改，报告 `~/.workbuddy/quark-sync-cache/guangya-renumber-last.json`（`mirror_source: quark`）。**光鸭是夸克的镜像，编号必须逐条对齐夸克目录**，这是本机制的唯一目的；夸克侧也无同名目录的裸名不猜、不改名，进「需要人工跟进」。
- **匹配**：按目录名开头编号配对站点 id（`08电子书/004-…` → `bk-004` → `data/ebook.yaml`），已有 `guangya_url` 的跳过；站点没有对应 id、分类对不上、目录没编号的只进 `unmatched` 报告，**绝不自动建条目**。`99-` 开头的待清理目录排除。
- **出链**：`create_share`，`share_type=0`（无提取码）+ `validity_seconds=0`（永久），一批最多 100 条。**每条只提交一次**：失败、状态超时、登录态失效都只记录到 `failed` / `unconfirmed` / `skipped`，不重试、不恢复批次、不重出链、不启动登录（无人值守没人扫码）。这是指挥官 2026-11-16 明确要求的口径。
- **写回**：只把成功链接插到该条目 `quark_url` 行之后，保留原文件 CRLF/LF 与其它字段。站点 `scripts/lib/data.js`、`render.js` 已支持 `guangya_url` / `guangya_code`。
- **报告**：`~/.workbuddy/quark-sync-cache/guangya-sync-last.json`，字段 `categories` / `pending` / `created` / `failed` / `unmatched` / `unconfirmed` / `skipped` / `login_required` / `renumber`（编号对齐结果：`pending` / `renamed` / `failed` / `skipped`）。收尾报告写「光鸭补链：成功 x/N（失败 id：…）」，失败项进「需要人工跟进」与飞书 `skipped`；编号对齐里 `skipped` 的裸名（站点无同标题条目）也要写进「需要人工跟进」；0 条待补时静默跳过，不单独发飞书。
- **只有光鸭补链也算本轮有改动**：即使夸克侧 0 条新增，只要 `created` 非空，仍要构建、冒烟、提交并推送，让链接进同一轮 commit；飞书不单独发（不属于新资源入库），VPS 即时重建按主流程「有新资源入库」的判定，没触发就交给每 2 小时的 cron 兜底。
- **依赖**：`guangyapan-drive` skill 的 bundled CLI（勿 `npm install`），实例绑定走 `~/.workbuddy/guangyapan-instance-id`，命令固定带 `--agent-name WorkBuddy --agent-instance-id`，与登录时的 scope 必须一致。旧的 `--agent-profile-dir` 凭据已失效，不要用。登录过期时本阶段退出码 2，只记录、不自动登录。
- 分享链接创建成功只表示链接生成，内容需经分享审核，审核通过前文件可能暂不可见。

### 6c. 光鸭网盘镜像 TMDB 今日热门（trending-sync 后置阶段，2026-11-16 新增）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/guangya-mirror.mjs
# 只扫描不动网盘：加 --dry-run；排障：--limit 1；不自动 commit/push：--no-commit
```

- **定位**：「TMDB 今日热门」任务的后置阶段。读 `trending-last.json` 的 `created[]`，在光鸭 SHARE 对应分类（movie→`04电影` / tv→`03电视剧` / anime→`05动漫`）下建**同名空目录**（目录名直接用 trending 报告的 `dirname`，如 `456-野兽座驾`），出公开永久链接并把 `guangya_url` 写进对应条目。**不转存内容**（指挥官 2026-11-16 拍板：链接初期指向空目录，内容后续人工或其它任务搬运）。
- **幂等**：分类下已有同编号目录就复用不重建；条目已有 `guangya_url` 就跳过。trending 报告无新增时整阶段直接结束。
- **不重试**：建目录、出链每步一次提交，失败 / 状态超时 / 登录态失效只记录 `failed` / `unconfirmed` / `skipped`，不重试、不自动登录。
- **发布**：成功后自动 `git add` 涉及的 data 文件、commit（`data: 光鸭镜像 TMDB 今日热门 N 条（…）`）、fetch + rebase + push；报告 `~/.workbuddy/quark-sync-cache/guangya-mirror-last.json` 记录 `commit` / `pushed`。**VPS 重建由主流程在镜像 push 成功后再触发一次**（对本 commit），收尾简报写「光鸭镜像：x/N」。飞书卡片脚本不改，卡片不含光鸭信息属预期。

### 7. 构建 + 冒烟

```bash
cd "$REPO" && npm run build
```

再启动 `node scripts/serve.js`，对 `/`、`/<slug>/<id>/`（slug 按 id 前缀，如 mv→movie）、`/img/<id>-240.webp`、`/qr/<id>-quark.svg`、`/<slug>/` 各取一次 HTTP 状态，全部 200 才算完成；详情页需 grep 到正确的 `pan.quark.cn/s/...`。

> **每次同步结束都要自动打开本地预览**（用户偏好）：冒烟通过后**不要** `pkill`，保留 `scripts/serve.js` 在后台运行，并用 IDE 预览能力打开 `http://localhost:4321/`（服务已跑则直接打开，别重启）。收尾报告里带上预览地址。

### 8. 提交并推送 GitHub（必须，用户要求）

冒烟通过后**必须**把本次改动提交并推送到 GitHub，否则服务器拉不到、新资源不上线：

```bash
cd "$REPO"
git add data/ static/images/
git commit -m "feat: 同步夸克新增资源 <数量> 条（<分类>+id 范围，如 app-010~119）"
git push origin main
```

- 身份已固化在仓库本地配置（`linuxhobby <marco.chan@ymail.com>`），无需 `-c` 覆盖。
- 逐条改动可一次提交；提交信息里写清分类与 id 范围，便于回溯。
- **先看 `git status` 有没有「别人的」未提交改动**（另一会话可能正在做软件图标、剧集回填等）：确有无关改动时，**拆成两个 commit**，别一股脑塞进本次同步的提交里；在收尾报告里点明顺手带了哪些、以及哪些仍未提交（如 `scripts/*.mjs` 工具改动不属于 `data/ static/images/`，可不提交）。
- 推送失败（网络/凭据）时**不要静默跳过**：在收尾报告里明确标注「GitHub 未推送」及原因，并提示用户稍后手动 `git push`。
- 服务器侧构建脚本 `deploy/site-autoupdate.sh` 拉取该仓库自动重建；推送成功即视同"上线流程已触发"。
- **VPS 主机别名是 `hty22`**（38.190.227.56:37212，**唯一现网主机**；`/opt/wodewangpan` + `/usr/local/bin/wdwp-autoupdate` + `/usr/local/bin/site-weekly-report.py` 均已就位，构建一次约 42 秒）。⚠️ 重建脚本实名是 **`wdwp-autoupdate`**（不是 `site-autoupdate`，机器上没有那个文件）；它**内部自带临时目录原子替换**（`public.new` → 换 `public`），不需要外部 `flock`。crontab 为 `0 */3 * * * /usr/local/bin/wdwp-autoupdate >> /var/log/wdwp-autoupdate.log 2>&1`（每 3 小时；无新提交时脚本自己 `exit 0`）。**即时强制重建**：`ssh hty22 "bash -c 'FORCE=1 /usr/local/bin/wdwp-autoupdate; tail -n 25 /var/log/wdwp-autoupdate.log'"`（`FORCE=1` 才会即使 LOCAL=REMOTE 也重建；有新 commit 时不加 FORCE 也会拉取重建）。日志 `/var/log/wdwp-autoupdate.log`，成功尾部为「发布完成：<短 hash>」；站点配置在 `/etc/wdwp-autoupdate.conf`（`SITE_DIR`/`BASE_URL`）。院采雷达是另一个站用 `ycld-autoupdate`，别混。
  - ⚠️ Windows 下别用 `execSync('ssh hty22 \x27…\x27')`：本地 `cmd.exe` 会吃掉单引号、把远端命令整体当一个文件名（`No such file or directory`），命令里的 `|` 也会被拼进参数后在远端当管道执行。正解是把整条远端命令**作为单个 argv 元素**用 `spawnSync('ssh', ['hty22', remoteCmd])` 传，`remoteCmd` 内部自己用 `bash -c '…'` 包好。
  - **DNS 待办（2026-11-03 核查）**：apex `wodewangpan.top` 与 `www.yuancaileida.com` 已指向 hty22，但 **`www.wodewangpan.top` 的解析还没切过来**，走 www 域名的用户目前打不开站（hty22 自身服务 www 完全正常，首页/详情页/robots/sitemap 都是 200）。解析由将军在 DNS 控制台手动改；改完这条待办即可删掉。
  - 除 `hty22` 外**不要连任何其它 VPS 做发布或取数据**：迁移前的旧主机已彻底下线、按将军要求不再提及，它上面的历史 nginx 日志也随之下线（hty22 的日志从 2026-11-03 起算，周报要 11-10 才有完整 7 天窗口）。
  - 注意 `rc`（172.245.159.232）是另一台机器（微信公众号发布引擎），与本站无关，别一起改。

### 9. 飞书推送（仅当本轮有新资源入库时）

无新增**不要发**（自动化每 8 小时一轮，空报会刷屏）。有新增时，在构建 + 推送 GitHub 之后把结果推给将军（飞书 bot 单向 P2P）。

> **2026-11-08 改版：从富文本 post 换成蓝色卡片（`interactive`，仿「院采雷达 · 采集简报」）。** 卡片标题固定在蓝色头部、只出现一次（默认「夸克资源同步任务简报」，payload 的 `title` 可覆盖但**别在正文再写一遍**，post 时代「标题重复两次」的问题已随卡片化消除）。除按分类的入库清单外，卡片**必须**再带两段：**未入库资源及原因**（`skipped`）与**编号对账**（`reconcile`）——这两段是将军明确点名要看的。

1. 写 payload JSON（UTF-8）到临时文件：

```json
{
  "title": "夸克资源同步任务简报",
  "groups": [
    { "label": "🎬 纪录片",
      "items": [ { "id": "dc-085", "name": "朝鲜战争",
                   "quark": "https://pan.quark.cn/s/9ad29ef2303d",
                   "site": "https://www.wodewangpan.top/documentary/dc-085/" } ] },
    { "label": "📺 电视剧",
      "items": [ { "id": "tv-144", "name": "逐玉",
                   "quark": "https://pan.quark.cn/s/02227f047c2b",
                   "site": "https://www.wodewangpan.top/tv/tv-144/" } ] }
  ],
  "skipped": [
    { "name": "007-某综艺合集", "reason": "needs_split：单目录装了多部，待确认后拆分" },
    { "name": "BBC.蓝色星球-第二季", "reason": "duplicate_suspect：疑似与 dc-094 同资源" }
  ],
  "reconcile": [
    { "cat": "🎞 电影", "site": 428, "max": 430 },
    { "cat": "📺 电视剧", "site": 162, "max": 184 },
    { "cat": "🎬 纪录片", "site": 96, "max": 95 },
    { "cat": "💻 软件", "site": 116, "max": 129 }
  ],
  "footer": "commit 5fa864a ｜ 本轮入库 2 条 ｜ 构建 904 资源 ｜ 冒烟 15/15 ｜ ✅ 已推送 GitHub ｜ ✅ 已上线 ｜ www.wodewangpan.top"
}
```

- **`groups`（入库新增）**：分类 label 带 emoji 前缀（🎞 电影 / 📺 电视剧 / 🎬 纪录片 / 🎌 动漫 / 🎮 游戏 / 💻 软件 / 📚 电子书 / 🎓 课程 / 📦 其他，2026-11-10 起「🖥 操作系统」已取消——系统镜像归 💻 软件），items 按编号升序，`name` 用站内中文标题；无新增的分类不出现在 groups 里。
- **`skipped`（未入库 / 需人工跟进）**：把本轮所有「扫到但没入库」的目录逐条列出并给原因——`duplicate_suspect` / `unknown_category` / `needs_split` / `cancelled_share` / `skipped_by_permission` / 构建或推送失败等，**没有异常就省略这个字段**（省略 = 卡片不渲染这一段；不要塞占位行）。字段值 `name` 用目录原名（去编号前缀可读即可），`reason` 一句话写清「为什么没入库 + 建议动作」。这是将军最关心的一段，绝不能漏。
- **`reconcile`（编号对账，本轮有入库即必填）**：每个有变动的分类给出「站点条目数 `site` / 夸克网盘该分类最大编号 `max`」，脚本自动标 ✅/⚠ 差值。**取数方式**：`site` = `data/<分类>.yaml` 里 `- id:` 计数；`max` = 本轮 `scan-new.mjs` 输出的 `categories[].max_number`（`parseInt` 去前导零），若本轮新建了超过缓存扫描的编号，用本轮实际最大编号覆盖。`max>site` = 网盘有空洞或站点缺条目（电视剧、软件当前就是没补齐）；`site>max` = 站点条目多于网盘目录（如纪录片那条 `mv-046` 误写进 `documentary.yaml` 的历史异常）。**理想态是补齐空洞后 `site == max`**；对不上的差值本身就是给人工看的信号，不用强行凑平。**脚本自检（2026-11-16 起）**：payload 有 `groups` 却缺 `reconcile` 时，`notify-feishu.mjs` 会打印「⚠ 本轮有入库但 payload 缺 reconcile」，看到就必须补齐再发；这是为了堵住 2026-11-09 12:29 起 10 轮简报静默丢段的漏洞。
- 脚本会自动在标题下方插一行「**同步时间**」（本机本地时区），payload 里给 `time` 可覆盖（补发历史轮次用），footer 不再重复写时间。

发送：

```bash
node scripts/notify-feishu.mjs --input "<payload 绝对路径>"   # 加 --dry-run 只打印卡片 JSON 自检
```

成功打印 `[飞书] ✓ 已推送 N 条 (message_id om_...)`。

- 底层走 `lark-cli` 的 bot 身份 `--msg-type interactive`；lark-cli 是 sh 包装脚本，Windows 下不能直接 CreateProcess，脚本已改为调用其底层 `node + run.js`（路径自动探测 `~/.workbuddy` / `~/.workbuddy` / `~/.codebuddy`），无需手动指定。
- 接收人默认 `ou_5c0d1b0b62e3bef0ffa84b7b496c18f5`（将军，当前 lark-cli 应用 `cli_aa56dbd9dab8dd0f` 内 open_id，2026-10-28 实测可送达；旧值 `ou_0764f86861e2cf5828510280f4372df8` 已因应用变更报 99992361 失效），可用环境变量 / `config.env` 的 `FEISHU_TO` 覆盖。
- **推送失败不致命**：最多重试 1 次，仍失败只在收尾报告里标注「飞书推送失败 + 报错」，不回滚已完成的入库与 GitHub 推送。

## 网盘改名 / 分享失效后的修复流程（2026-10-12 新增）

用户在网盘里改目录名、改编号、或手动取消分享之后，站点数据与网盘会脱节。三步走，**顺序不能颠倒**：

### ① 目录名核对：`check-drive-sync.mjs`

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-drive-sync.mjs         # 只列不一致的
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-drive-sync.mjs --all   # 连一致的也列出
```

按**编号**把网盘目录与 `data/*.yaml` 条目配对，报三类问题：`name_diff`（改名，需重出链）、`no_dir`（站点有条目、网盘没目录）、`no_entry`（网盘有目录、站点没条目）。

⚠️ **它只比对目录名，不验链接**：目录名一致 ≠ 链接还能打开。改名修复必须走到第 ② 步。

### ② 链接核对：`check-share-links.mjs`

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-share-links.mjs            # 全量
node ~/.workbuddy/skills/quark-resource-sync/scripts/check-share-links.mjs --id mv-240 # 单条
```

`share-detail` 逐条打，判两类问题：`broken`（链接打不开）、`renamed`（出链时写死的分享标题 ≠ 网盘当前目录名）。结果写 `cache/check-share-links-last.json`。

失效原因要**分清楚再动手**，处理方式完全不同：

| 现象 | 含义 | 能不能自动修 |
|---|---|---|
| `41004 分享的文件不存在` | 文件被移动 / 删除 / 改名后旧链接指向丢失 | ✅ 目录还在就能重出链 |
| `41012 该链接已被用户取消分享` | 用户在网盘端主动取消了分享 | ❌ 见下方「取消分享的处理边界」 |
| `status=3`（code 0 但打不开） | 分享状态异常 | ⚠️ 先试重出链，仍不行按取消处理 |

### ③ 重出链并回写：`reshare-batch.mjs`

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/reshare-batch.mjs --from-check            # 取上一步的结果
node ~/.workbuddy/skills/quark-resource-sync/scripts/reshare-batch.mjs --from-check --apply    # 顺便写回 data/*.yaml
node ~/.workbuddy/skills/quark-resource-sync/scripts/reshare-batch.mjs --ids mv-124 dc-017     # 指定条目
```

- 内部已「重新 browse 取 fid → share」，不用手工补 fid。
- **只把成功的写回**：出链失败的条目进 `failed`，不碰 YAML（旧链接出现多次时也会跳过并提示人工处理）。
- `--apply` 写回前会校验 YAML 条目数不变。

### 取消分享的处理边界（2026-10-12 实测）

- 用户取消的分享**重建不了**：对同一目录重新 `share` 返回 `41026 没有可分享的文件`，连目录内单个文件也出不了链。
- 这类目录通常**只有占位 md 或干脆是空的**（资源还没转存进去），用户看到空的才取消的。先 `browse` 看目录内容：空目录 → 标记为「待补资源」，等资源到位再出链，别写 YAML。
- 站点上这些条目的夸克按钮点了就是失效页。报告里要**逐条列出**并给出建议：有百度兜底的先靠百度，没有兜底的问用户是下架还是等补资源（无人值守轮次不问，进「需要人工跟进」清单）。
- 已取消的条目**不要**反复重试出链，纯浪费时间。
- 用户若把目录也删了 → 站点下架，清四处（构建不回收旧产物）（⚠ **无人值守轮次不执行这里任何删除**，只输出待删清单交用户处理）：`data/*.yaml` 删条目并改头部条数注释 → 删 `static/images/<slug>/<id>.jpg` → 删 `public/<slug>/<id>/`、`public/img/<id>-*`、`public/qr/<id>-*` → 重建 + 冒烟（首页 200、已下架详情页 404）+ 提交推送。删除前确认 Git 已提交当前状态，需要时可从历史恢复。
  - ⚠️ 删 YAML 条目**不要用「按 `- id:` 切块再 join 重写」的脚本**（2026-10-12 踩过）：它只保留条目块，会把文件头的 `# XX资源（N 条）` 注释整段丢掉。删完校验两件事——`js-yaml` 解析条数与预期一致、文件首行仍是 `#`。
- 批量下架前先做一次**交叉验证**：把「网盘无编号目录」的条目拿去跟网盘**全部目录名**（含未编号的）做归一化包含匹配，确认不是换了编号或挪进未编号目录。归一化太粗会误判（如 `Ice` 命中 `078-Ice`），命中结果要人工看一眼再决定。

## 合集拆分（一个编号目录里装了多部作品）

> **无人值守轮次不执行拆分**：要动网盘已有文件（rename + mkdir + move），风险高且需要用户确认系列归属。定时任务扫到已编号目录里装多部时，只标注 `needs_split` + 目录内清单进报告，等用户当面说「拆」再走本节。

网盘里常见 `025-速度与激情合集` 这种一个目录塞进整个系列的情况。站点要求**一个资源 = 一个编号目录 = 一条条目**，所以要拆。2026-10-11 首次实操（速度与激情 10 部正传 + 1 部外传），以下规则照抄即可，别自创。

### 拆分规则

1. **原目录留给第一部，沿用原编号**：`025-速度与激情合集` → `025-速度与激情1`。它已经出过链、也可能已经入库，编号不动就不会出现「id 与网盘编号对不上」。
2. **其余各部在该分类目录下新建 `编号-片名`**，编号按**空洞优先**依次往下排（2026-11-04 起：先填该分类的空洞，用完才从最大编号顺延；2026-10-11 当时最大 336 → 337…346 就是顺延段），**按系列顺序分配**，不要按扫描返回顺序乱排。
3. **附属文件随正片走**：字幕（`.ass` / `.srt`）、花絮、nfo 跟所属那一部一起移，别留在原目录。
4. 外传 / 特别篇（如《速度与激情：特别行动》）单独一个目录，排在正传之后。目录名里的全角冒号没问题，别改。

### 执行顺序（不能颠倒）

`rename 原目录` → `create-folder 建 N 个新目录` → `move 逐个移入` → `share 逐个出链`

- **改名与建目录都必须在出链之前**：改名会改变分享标题，且重新出链拿到的是另一个 URL，先出的那条作废。原目录**已经出过链**的话，改名后**必须重新出链**，并同步改写 `data/*.yaml` 里的 `quark_url`。
- `move` 一次只能有一个 `--target-fid`（可带多个源 fid，上限 100），所以**每个目标目录各调一次**。

### fid 轮换（最容易翻车）

`browse` 返回的 fid 每次都变，旧 fid 再用会报「文件找不到」，所以**每一步都现取现用**：

- rename 前：重新 `browse` 分类目录取原目录 fid
- move 每个目标：先 `browse` 分类目录取目标 fid，再 `browse` 原目录取文件 fid，然后立刻 `move`
- share 前：`browse` 分类目录取全部目录 fid，逐个出链

### Windows 沙箱：别用 spawnSync 调 CLI

脚本里 `spawnSync(process.execPath, [CLI, ...])` 在 Windows 沙箱下直接 `EBUSY`（stdout 全空，连错误都没有）。改成**在 bash 脚本里直接调 CLI**，解析交给 `node -e` 读 browse 落盘的 JSONL。把拆分计划写成数组（`编号|目录名|文件名`），分 `plan / rename / mkdir / move / share / verify` 几个阶段跑，每阶段结束都能核对，出问题不用整批重来。

### 站点侧怎么改

- **原 id 对应的条目就地改写**：`title` / `tags` / `quark_url` / `description` / `date` / `image` 全换成第一部，`added` 改成今天带时刻。原来那一版若误写成系列中的某一部（这次原 `mv-025` 是「速度与激情10」），那段正文正好**挪给对应的新条目**（第 10 部），别浪费，也别留着给第一部。
- 其余各部按正常新增条目追加到 `data/<分类>.yaml` 末尾，id 与网盘编号对应。
- ⚠️ `data/*.yaml` 是 **CRLF** 换行，按正则整块替换（`- id: mv-025\n...`）会匹配不上，**用 `indexOf` 定位后切片替换并沿用 `\r\n`**，否则会把全文换行风格搞乱、diff 变得没法看。
- 评分用 `toFixed(1)`：`7.022 → 7.0`。别写 `String(Math.round(v*10)/10)`，7.0 会输出成 `7`。
- **百度网盘侧没拆**时，原条目的 `baidu_url` 保留不动（不删数据），在收尾报告里点明「百度链接仍是原合集链接，如需一致先在百度网盘做同样拆分」。
- 各部简介仍然按第 5 步的 150 字口径写，且**不得互相套模板**：同一系列 11 条要各有侧重（原点 / 转型 / 转折 / 收束 / 外传），开头句式与叙述顺序都得换。

### 验收

`verify` 逐个列出目录内容（确认每部只剩自己那一部）→ `npm run build` → 启 `scripts/serve.js` 冒烟（首页 / 各详情页 / 海报 / 二维码 / 分类页全 200，详情页 grep 到正确的 `pan.quark.cn/s/...`）→ 提交推送。

### 用户自己拆好了目录的情况（2026-10-23「天作不合的我们」）

自动同步建的目录常常只是空壳占位（里面是本流程那三份说明 md：`资源在24小时内更新-请先转存-更新会自动通知.md`、`资源缺失反馈请加QQ群1045824859.md`、`关于我的网盘索引站.md`；存量目录里导流那份可能看到的是定稿前的旧名 `我的网盘网址www.wodewangpan.top.md`，两者等价），用户转存资源时会**自己删掉原目录、按季 / 按部手工建几个未编号目录**（如 `天作不合的我们-第一季（2024）全10集`、`…-第二季（2025）全10集`）。这种不用重走上面那套 move 流程，直接：

1. `browse` 分类目录取这些未编号目录的 fid（**现取现用**）→ 批量 `rename` 成 `编号-片名`，编号按**空洞优先**分配（2026-11-04 起：原编号已随目录删除释放、正落在空洞里，会被优先复用；空洞用完才从最大编号顺延）→ 重新 `browse` 取新 fid → 逐个 `share` 出链（旧链接随目录删除已失效，必须重出并回写 YAML）。
2. 站点侧：原 id 条目就地改写为**第一部 / 第一季**，其余各部追加新条目，id 与网盘编号对应。
3. **季拆分的字段口径**（照抄，别自创）：
   - `title` 用「片名 第一季 / 第二季」（存量一致，见 `tv.yaml` 的「安多 第二季」「猎犬 第一季」），**不带编号**；
   - `description` 前缀 `【第 N 季 · 共 M 集 · 全剧 X 季】`，正文按第 5 步 150 字口径**各自写、不套模板**；
   - 评分用 **TMDB 该季的 `vote_average`**（`/tv/<id>/season/<n>`），不是整剧评分；
   - `date` 用**该季首播日**（第一季即整剧首播日）；
   - `image` 用**该季海报**（season 的 `poster_path`），两条各一张，别共用主海报；
   - `tags` 末位写「中文名 原名 S0N」。
4. 用户手工建的目录通常**已经有真实资源**（各季 10 集之类），这种情况不需要补占位 md，先 `browse` 看一眼目录内容再决定。

## TMDB 今日热门自动同步（`trending-sync.mjs`）

**反向流程**：常规流程是「网盘已有资源 → 编号入库」；这条是「TMDB 有热门 → 先在网盘建目录 → 再入库」，用于每天自动补充热门新片条目。

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/trending-sync.mjs   # 默认电影/电视剧各 1 部，跑完自动构建+提交+推送
node …/trending-sync.mjs --dry-run                                       # 只打印选中条目，不动网盘、不推送
node …/trending-sync.mjs --movies 3 --tv 3                               # 想多补就显式传数量
node …/trending-sync.mjs --movies 5 --tv 3 --no-filter-anime --allow-original
node …/trending-sync.mjs --recency-months 6    # 把年份窗口从默认 12 个月改成 6 个月
node …/trending-sync.mjs --no-recency          # 关掉年份窗口，回到「只看今天热不热」的旧口径
node …/trending-sync.mjs --allow-program       # 放开节目类黑名单（默认排除脱口秀 / 真人秀 / 新闻，2026-11-11 起）
node …/trending-sync.mjs --no-push                                       # 入库但不推送（调试用）
node …/trending-sync.mjs --publish-only                                  # 只发布仓库里待提交的数据变更
```

端到端行为（一次调用全部完成）：

1. 拉 TMDB `trending/movie/day` + `trending/tv/day`（`language=zh-CN`）。
2. **三层去重**：① 已处理状态（TMDB id / 剧集类按季键）→ ② 站点 `data/*.yaml` 已有标题 → ③ 网盘分类目录已有同名目录。命中即跳过并顺延取下一条。**三层的键口径见下一条「按季去重」**。
3. **筛选与去重（2026-10-25 起「按季去重」）**：
   - **剧集类候选（`type === tv`，含动漫分类里来自剧集榜的动画）先解析「目标季」**（`pickSeason`：优先已播出的最新一季，无播出日期退化为编号最大的一季），再用 **`片名 + 第N季`** 参与所有比对与命名。
   - 旧版只拿 TMDB 裸剧名与站内 `title` 做归一化**全等**比较，而站内剧集条目一直是「母狮 第三季」「权力的游戏 第七季」这种带季号的写法，裸名判不上 → 2026-10-24 那轮把已有 tv-073 的《母狮》第三季又收了一遍建成 tv-168（`tv.yaml` 122 条里有 21 条是带季号的季级条目，全都暴露在这个缺口下）。
   - 比对键统一走 `normTitle()`：**先剥全角括号 `（）` 里的内容**（`norm()` 只处理半角 `()[]` 与 `【】`，不剥全角括号，`073-母狮（第三季-2026）` 会残留成 `母狮（2026）` 把键污染），再剥编号、`第N季 / 第N部 / 第N篇 / N季 / 结尾 S0N`。所以「母狮」「母狮 第三季」「073-母狮（第三季-2026）」三者同键。
   - **三层去重**相应升级：① 已处理状态键剧集类用 `<tmdb_id>:S<季号>`（同一部剧出新季仍可入库，电影仍用裸 id；`loadState()` 会给历史已入库记录补写这个键，裸 id 键保留继续挡历史整剧条目）→ ② 站内标题（`normTitle` 比对）→ ③ 网盘目录名（`normTitle` 比对）。
   - **新建的目录名与条目 `title` 都带季号**（`168-母狮 第三季` / `母狮 第三季`），与站内既有写法一致；`description` 的 `【第 N 季 · 共 M 集 · 全剧 X 季】` 口径不变。
   - 默认跳过电视剧榜单里的动画（`genre_ids` 含 16）与无中文译名条目；`--no-filter-anime` / `--allow-original` 可分别关闭。
   - **节目类黑名单（2026-11-11 用户定夺：「以后脱口秀之类的节目尽量排除掉」）**：候选的 `genre_ids` 命中 **10767 脱口秀（Talk）/ 10764 真人秀（Reality）/ 10763 新闻（News）** 任一，即跳过并顺延取下一条（这三个 id 只存在于 TMDB 剧集类型表，电影类型表没有，所以实际只挡剧集类候选）。
     - 背景：`tv-103 吉米·坎摩尔直播秀 第二十五季`（TMDB 1489，类型「脱口秀 / 喜剧」，★5.3）就是这类深夜脱口秀——每天开播、每季 30+ 集、无「资源」可言，占了编号也等不来人工转存，用户已把网盘目录 `103-…` 删掉并要求把站点条目一并回收。同类的「肥伦今夜秀 第十四季」是 2026-11-10 靠年份窗口挡掉的（当时还没黑名单），现在两道口径叠着，脱口秀类在窗口判断之前就被挡下。
     - 判断在 `processType` 循环里**早于按季解析**，命中就跳过，不浪费 `latestSeasonOf` 的请求；`kind === 'anime'` 不参与本判断（动漫候选已要求 genre 16，避免误伤「动画 + 脱口秀」杂交候选的动画身份）。
     - 被挡掉的候选进 `report.skipped`，reason 前缀固定 **`节目类（脱口秀 / 真人秀 / 新闻）`**（逐条最多列 5 条，其余并成「另有 N 条今日热门」一行），机读报告另有 `report.program_filter{enabled,genres,label}`；`C:/Users/marco/Scripts/wodewangpan-trending-feishu.mjs` 的 `BENIGN` 白名单已同步收录 `节目类（` 前缀，卡片按「↷ 正常顺延」渲染，**不要**当异常跟进。
     - **与年份窗口同口径：不写 `trending-seen.json`**，黑名单以后调整（或人工加 `--allow-program`）时这些条目还能重新参与筛选。
     - 存量不回溯：已入库的脱口秀/真人秀条目一律不动，要清由人工点名。
   - **年份窗口（2026-11-10 用户定夺：滚动 12 个月）**：TMDB trending/day 是「今天热度」榜，经典老片靠话题回潮、老剧靠新季上榜都会混进来（实测 2026-11-10 那轮收到「肥伦今夜秀 第十四季」2014 首播、「Re：从零开始的异世界生活」2016 首播）。现在按**内容日期**设窗口，超出即跳过并顺延取下一条：
     - 电影（含热门电影榜里归入动漫的动画电影）→ `release_date`；
     - 剧集（含热门剧集榜里归入动漫的动画剧集）→ **目标季 `air_date`**，TMDB 没填才回落整剧 `first_air_date`。用季首播日而不是整剧首播日，是为了「跨年老剧出新一季」仍能收（实测《辛普森一家》整剧 1989、第 38 季 2026-09-27，窗口内照收），挡掉的是纯粹回潮的老片；
     - 日期缺失按「不在窗口内」处理（宁可少收，不猜年份）；
     - 窗口 = 本机日期往前推 `--recency-months`（默认 12）个月，`--no-recency` 整体关闭；非法值（0 / 负数 / 非数字）自动退回 12；
     - 被挡掉的候选进 `report.skipped`，reason 前缀固定 **`年份窗口外`**（逐条最多列 5 条，其余并成「另有 N 条今日热门」一行），机读报告另有 `report.recency{enabled,months,from}`；`C:/Users/marco/Scripts/wodewangpan-trending-feishu.mjs` 的 `BENIGN` 白名单已同步收录该前缀，卡片按「↷ 正常顺延」渲染，**不要**当异常跟进；
     - **不写 `trending-seen.json`**：窗口口径以后可能调，不把被挡掉的条目永久钉死在已处理清单里（与「无中文译名 / 站内已有」会写 seen 的做法不同，是刻意的）；
     - 存量条目不回溯：这条只管今后每天的选择，已经入库的老片不动。
4. 实时 browse 分类目录，按**空洞优先**取该分类最小可用编号（`lib/number.mjs` 的 `createAllocator`：先填网盘空洞，用完才从最大编号顺延；被别的分类文件占用的 id 自动跳过），`create-folder` 建 `编号-片名` 目录（剧集类带季号，见第 3 条；半角 `\/:*?"<>|` 自动转全角），同名目录幂等不会重复建。

    4b. **建完目录立刻上传占位说明文件**（2026-10-06 用户要求，2026-10-24 改名改文案，**2026-11-08 起三份**）：唯一定义在 `scripts/lib/placeholder.mjs` 的 `PLACEHOLDER_FILES`，三份都预置到刚建的目录里（此刻还没有资源，先占位，等资源转存进去后可更新）：
       - `资源在24小时内更新-请先转存-更新会自动通知.md`（95 字节）— 两行：`1、看官请先转存本资源。` / `2、目录若暂时空白，资源会在24小时内补齐。`
         （第 2 行 2026-11-08 晚改成**条件句**，因为这一份现在也会进已有正片的目录，无条件句在那儿是假话。⚠ 网盘改不了已上传文件的内容，此前写进去的约 28 份仍是旧文案，只能客户端手动删除后重铺。）
       - `资源缺失反馈请加QQ群1045824859.md`（51 字节）— 一行：`资源缺失或失效请加QQ群反馈：1045824859`
       - `关于我的网盘索引站.md`（330 字节，4 行）— 站点导流：首行 `我的网盘索引站｜https://www.wodewangpan.top`，正文讲分类 / 海报 / 简介 / 每天更新 / 站内搜索，末行邀请用户到站内反馈缺漏。**正文与文件名都不要出现「百度」字样**（将军 2026-11-08 明确要求）。
         ⚠ 这一份当天改过名：最早定稿前的 `我的网盘网址www.wodewangpan.top.md` 已经铺进 **643 个夸克目录**，而夸克 CLI 没有删除命令，所以它永久保留为该条目的 `aliases`，**两个作用缺一不可**：判定「已满足」认它（否则同一目录会被再塞一份导流说明），识别「非资源」也认它（否则 `fill-files` 会把那 643 份当真实资源批量写进 `files:` 假清单）。中间还试过一个以 `www.` 开头的名字，**实测一份都没落过盘**（search 唯一命中是无关 mp3 的分词误匹配），已从定义与识别表彻底移除。别把 aliases 里那条当历史垃圾删掉。

       文件名里的 dots 实测夸克/百度都原样接受（2026-11-08 在 `04电影/005-山竹刀` 验证），但**必须以 `.md` 结尾**：`placeholder-fill` 的 `hasResource` 与站点 `fill-files` 都按「非 `.md` 条目」判定真实资源，少了扩展名会被当成资源文件——目录被误判为「已有资源」而永不补占位，还会被写进 `files:` 假清单。

       逐份上传，**失败只告警不阻断**（分享链接照出、条目照入库），全部成功才记文件名列表、否则记 `失败：<哪份>：<原因>`，写在报告 `rec.placeholder`。`--no-placeholder` 关闭；`--placeholder-name` / `--placeholder-text` **只改写第一份**（更新通知），另两份保持内置。
       ⚠ 站点仓库 `C:/Users/marco/Github/wodewangpan/tools/fill-files.mjs` 里有一份同义的 `PLACEHOLDER_FILE_RE`（跨仓库、无法 import），改占位文件名必须同步改它，否则占位 md 会被当成真实资源写进 `files:` 假清单。

    4c. **百度网盘同名镜像**（2026-11-01 起有，**2026-11-08 起默认停用**）：停用前的行为是夸克每新建一个 `编号-片名` 目录，紧接着用本机 `bdpan` CLI 在百度网盘 `/apps/bdpan/<分类目录>/<同名目录>` 建**完全同名**的目录，并传**同名的占位 md**（与夸克同一组内容，当时两份；现在是三份，见 4b）。现在**默认不做**，要点：
       - 两盘目录逐字同名、编号同步（百度不自算编号，永远跟随夸克本轮生成的 `dirname`）。
       - `bdpan mkdir` **幂等**（已存在返回成功，不产生重复目录，2026-11-01 实测）。
       - bdpan 的路径参数是**应用目录相对路径**（根即网页端「我的应用数据/bdpan」）；`ls --folder --json` 列目录时条目 `server_filename` 可能为空串，**名字要从 `path` 最后一段取**（`lib/baidu.mjs` 已处理）。
       - bdpan 出错时 JSON 错误体走 stdout、**退出码仍为 0**，成功判定必须解析 JSON 看 `code`/`error`（同上已处理）。
       - **登录**：`bdpan login --device-code`（或 `--qrcode`），token 有效期约 1 周（2026-11-01 实测到 2026-11-09）。脚本每轮开始先 `whoami` 检查；**未登录/过期 → 整轮跳过镜像并明确记录**，不阻断夸克主流程，无人值守时只能等人重新授权（简报会写清楚）。
       - **默认已翻转关闭**（2026-11-08）：不加参数就是「不镜像、不出链」，脚本打印「百度镜像：已停用（2026-11-08 起默认不镜像百度盘…）」，`rec.baidu` 为 null、条目不带 `baidu_url`/`baidu_pwd`，机读报告 `report.baidu.enabled=false`。想临时恢复必须人工显式 `--baidu`；`--no-baidu` 保留为兼容写法（等于再关一次，不报错）。启用时单条镜像失败记 `rec.baidu`（`ok` / `失败：…`），汇总打印「百度镜像：N 条同名目录已建」，机读报告在 `report.baidu`。
       - 站点条目**仍然只挂夸克链接**，百度镜像只是同名目录 + 占位文件（`data/*.yaml` 结构不变）。
       - 存量缺口（镜像上线前的历史目录）原本用 `scripts/mirror-baidu.mjs` 补齐，见下节；**2026-11-08 起整条链路已停用，历史缺口从此不回补**。
 5. `share --url-type 1 --expired-type 1` 出**公开永久**链接（**空目录也能出链**，已实测）。
6. 拉 TMDB detail（电视剧额外查**最新一季**的季号与该季**官方整季集数**，`rec.season` / `rec.episodes` / `rec.total_seasons` 会进机读报告）、下载海报到 `$REPO/static/images/<id>.jpg`，`make-entry.mjs` 校验后由 `lib/yaml-store.mjs` 的 `upsertEntry()` 写入 `data/<分类>.yaml`——**同 id 已有条目（补位回收来的死链）就整块就地改写，没有才追加**；电视剧的 description 会自动带上 `【第 N 季 · 共 M 集 · 全剧 X 季】`。

   6b. **简介不足 150 字一律补齐，不再跳过**（2026-10-23 用户定夺：短板要补，不是把条目丢掉；2026-11-12 下限从 200 降到 150）。detail 请求带 `append_to_response=credits`，正文由 `scripts/lib/desc.mjs` 的 `buildBody()` 拼：原 overview 打底 → 官方标语 → 类型 → 年代 / 片长（剧集为首播年、播出状态、季数、集数、单集时长、播出平台）→ 制片国家地区 → 导演 → 编剧 → 主创 → 主演 → 出品方 → 对白语言 → 系列归属，凑够 150 字即停。**只拼 TMDB 拿得到的事实，不编造情节**；overview 本身已超 150 字则原样保留（`rec.desc_filled=false`）。机读报告里记 `desc_raw_len` / `desc_len` / `desc_filled`，跑完可用 `check-desc.mjs --only <id>` 复核。
       - 需要二次改写（第 5 步要求不雷同）时仍走人工：加 `--no-push` 先入库，改完 `--publish-only` 推；已推上去的改完单独提交一次 `data/`。
7. 写状态 + 机读报告。
8. **收尾发布（默认自动执行）**：`node scripts/build.js` 构建 → `git add data/ static/images/` → `git commit` → `git push origin main`。这一步已内置在脚本里，**入库即自动推送到 GitHub，无需再手工 git**。构建失败会**中止推送**（不推坏数据）；工作区无变更则跳过提交；`--no-build` / `--no-push` 可分别关闭，`--publish-only` 表示不抓新片、只把仓库里待提交的数据变更构建并推上去。提交信息自动生成为 `feat: 同步 TMDB 今日热门 N 条（电影 mv-xxx~xxx、电视剧 tv-xxx~xxx）`。

| 文件                                                 | 作用                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `~/.workbuddy/quark-sync-cache/trending-seen.json` | 已处理 TMDB id（`{seen:{movie:{<id>:{...}},tv:{...}}}`），**去重唯一依据，勿手删** |
| `~/.workbuddy/quark-sync-cache/trending-last.json` | 最近一次运行的机读报告（created / skipped / errors）                            |
| `scripts/lib/desc.mjs`                          | 简介正文构造（`buildBody`），短简介补料到 150 字；`DESC_MIN` / `DESC_MAX` 即写入侧口径上下限（150 / 700） |
| `scripts/lib/number.mjs`                        | **编号分配（2026-11-04 空洞优先）**：`numOf` 解析目录名前缀编号、`usedSet`/`holesOf` 算网盘空洞、`classifyHoles` 把空洞分成 `free`/`reclaim`/`blocked`、`createAllocator().next()` 取最小可用编号、`.release()` 失败归还 |
| `scripts/lib/yaml-store.mjs`                    | **站点条目按 id 写入（2026-11-04）**：`idOccupancy()` 扫全站 `data/*.yaml` 的 id→文件映射，`upsertEntry()` 同 id 就地改写（整块替换、保住文件头条数注释、写前校验条目数）、无同 id 才追加 |

- 「各 1 部」指**成功新建** 1 条（2026-10-06 起从各 3 部改为各 1 部）；被去重或筛选跳过的会往下顺延，凑不出 1 条时不硬凑。
- **短简介再也不是跳过理由**（2026-10-23）：此前一批条目只因 overview 不足 200 字被写进 `trending-seen.json` 标成 `skipped`，实际从未入库。`loadState()` 现在会自动剔除 `skipped === '简介不足200字'` 的历史记录（首轮释放了 15 条），让它们重新参与筛选。
- **三个分类做全量标题交叉去重**（2026-10-23）：动漫收走的动画电影 / 动画剧集，不会被电影、电视剧分类再收一遍（此前只对动漫单向生效，出现过 `荒野丛林` 同类重复的风险）。
- 单条失败会**把编号还回池子**（`alloc.release(numVal)`，下一条重新取到它，不跳号），错误记入 `errors`，不影响同批其他条目。
- 脚本内部已用 `process.execPath` 调子进程；Windows 沙箱下不要用 `node -e` 内联 `spawnSync`（会 `EBUSY`）。
- 入库后脚本会自动构建 + 提交 + 推送（见第 8 点）；剩下的只有本地冒烟与简报，定时任务的编排见 WorkBuddy 自动化「TMDB 今日热门影视每日同步」（每天 23:00）。

## 百度网盘同名镜像补齐（`mirror-baidu.mjs`）

> ⛔ **2026-11-08 起本节已停用**：百度盘镜像整体停止，本脚本（三种模式：`--new-dirs` 增量、`--cats` 对账、`--fill-placeholders` 占位回填）**都不再被任何自动化任务调用**。历史缺口本来就不回补，现在连增量也没有了。只有用户当面显式要求重新开启百度镜像时，才照下面的说明手动执行。

同一个脚本三种模式，用途完全不同，别混：

- **增量模式 `--new-dirs <list.json>`（日常、本流程第 3b 步用这个）**：只镜像显式清单里的 `{catDir,dirname}`，逐个幂等建同名目录 + 缺占位才传占位。供手动流程逐轮调用，**不碰历史缺口**。清单元素 `{"catDir":"04电影","dirname":"070-真相捕捉"}`（UTF-8 无 BOM，脚本会兜底剥 BOM）。报告字段 `new_dirs.{requested,ok,failed}`。
- **对账/回补模式 `--cats <分类>` / `--cats all`（默认）**：扫描指定分类（逗号分隔，`all`=SHARE 下全部非 `99-` 分类）里「夸克有、百度没有」的子目录并同名补建。用于**历史缺口**或**单条失败后的分类级补录**。日常**不要用**它（会把没补的历史一起补）。

2026-11-01 上线时实测缺口（对账模式 `--cats all --dry-run`）：`04电影` 0 条（早已同名）、`03电视剧` 缺 133、`05动漫` 缺 41；其余分类（02应用 115、06纪录片 91、01游戏 11、07课程 12、08电子书 12、09操作系统 8、010其他 7）此前从未镜像。**将军决定：历史缺口不补，只保持增量同步**。要回补历史须用户另行显式要求，并分轮 `--cats <分类> --limit 20` 跑（百度风控敏感）。（这段是 2026-11-01 的历史快照，照原样留存：百度链路已于 2026-11-08 停止，`09操作系统` 目录也已于 2026-11-10 并入 `02应用`，数字现在对不上属正常。）

```bash
node …/mirror-baidu.mjs --new-dirs list.json          # 增量：只镜像清单里的本轮新目录（第 3b 步用）
node …/mirror-baidu.mjs --new-dirs list.json --dry-run # 增量预览，不动百度
node ~/.workbuddy/skills/quark-resource-sync/scripts/mirror-baidu.mjs --dry-run    # 对账：只看默认三类缺口
node …/mirror-baidu.mjs --cats all --dry-run           # 对账：看全部非 99 分类缺口
node …/mirror-baidu.mjs --cats 03电视剧,05动漫 --limit 20     # 回补：本轮最多补 20 条（防风控，可分轮）
node …/mirror-baidu.mjs --no-placeholder               # 只建目录不传占位文件
node …/mirror-baidu.mjs --fill-placeholders --dry-run  # 占位回填（第 3 种模式）：只看百度已有目录缺哪份占位，不上传
node …/mirror-baidu.mjs --fill-placeholders --limit 20 # 占位回填：本轮最多补 20 个目录（百度风控敏感，可分轮跑完）
```

- **`--fill-placeholders` 占位回填模式**（2026-11-08 加，为「占位由一份改两份」回补百度存量）：**只往百度已有目录补缺失的占位说明，绝不新建 / 删除 / 改名目录**。目录里有「非 `.md` 条目」判为已有真实资源 → 不动；百度 `ls` 不可靠，**看不见「更新通知」那份占位就判为无法确认、直接跳过**（宁漏不猜，避免把占位塞进资源目录）。报告字段 `fill_placeholders.{scanned,has_resource,already_ok,filled,files,unverifiable,ls_failed,failed}`。夸克侧同类回补走 `placeholder-fill.mjs --scope all`。

- 判定口径：**目录名逐字相同**即视为同一目录；只读夸克、只在百度新建，**绝不删除/改名任何一边的东西**。
- 每条间隔 800ms 轻限速；报告写 `~/.workbuddy/quark-sync-cache/mirror-baidu-last.json`。
- bdpan 未登录时直接报错退出，提示 `bdpan login --device-code`（增量模式用于无人值守时同理，跳过即可，不阻断主流程）。
- ⚠️ 百度 app-data 分类节点（`/apps/bdpan/03电视剧`、`05动漫` 等）的子目录 `ls` **列举不可靠**（条目常 `fs_id:0 / 文件缺少 fsid`、时列时列不空），**写入/`mkdir` 正常**。判断某目录是否已镜像，用直连具体路径 `bdpan ls "/apps/bdpan/<分类>/<编号-名称>"` 比列父目录稳；`--cats` 对账模式的「缺失」计数可能因此偏大，别据此断定历史缺口真实量。

## 占位说明文件补齐（`placeholder-fill.mjs`）

新目录建好时资源还没转存进去，目录是空的；老目录若资源被清掉也会变空。这类目录要补一个说明 md，让用户点进去有交代（`trending-sync.mjs` 只管它自己新建的那一条，存量/漏补的靠这个脚本兜）。

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/placeholder-fill.mjs --dry   # 只扫描列出待补清单，不上传
node ~/.workbuddy/skills/quark-resource-sync/scripts/placeholder-fill.mjs         # 扫描并补齐
node …/placeholder-fill.mjs --scope today     # 只处理今天入库的条目
node …/placeholder-fill.mjs --scope movie-all # 电影目录全量
node …/placeholder-fill.mjs --scope all       # 电影+电视剧+动漫全量（存量回补用）
node …/placeholder-fill.mjs --cats all --include-filled # 全部 9 个分类 / 约 950 个编号目录（现口径，见下；数字随入库变动）
node …/placeholder-fill.mjs --cats 06纪录片 --dry # 只看某个分类的缺口
node …/placeholder-fill.mjs --only 资源缺失反馈 # 只补名字含该串的那份占位（存量回补的标准口径，见下）
node …/placeholder-fill.mjs --ids mv-005,tv-086 # 只处理指定站点条目（单目录试写 / 定点回补；按编号定位，与标题无关）
node …/placeholder-fill.mjs --limit 20        # 最多处理 N 个目录（调试用）
node …/placeholder-fill.mjs --from-last       # 按上次扫描报告直接补，不重新扫描（全量扫描要十几分钟，务必用它）
```

**存量回补口径（2026-11-08 晚定稿，别改回去）**：**三份占位铺满全部分类的所有编号目录**（将军定夺），一条命令跑完——

```bash
node …/placeholder-fill.mjs --cats all --include-filled          # 9 个分类 / 约 950 个编号目录
node …/placeholder-fill.mjs --cats 06纪录片,02应用 --dry         # 只看某一组的缺口
```

- `--cats all` = SHARE 下**全部**一级分类目录（`99-需要删除的移动到这里` 永不处理）；不给 `--cats` 时仍是影视三类。
- `--include-filled` = 允许进入「已有真实资源」的目录。三道都已在 `lib/placeholder.mjs` 标 `forFilledDirs: true`，所以现在**不加这个开关就铺不满**（这正是当晚报废「道歉类只进空壳」旧口径的原因）。
- 道歉类文案（第 1 份第 2 行）已改成条件句，因此在正片目录里也不失真；但它此前写入的约 28 份仍是旧无条件文案，网盘删不掉，要统一只能客户端手删后重铺。

历史沿革（免得有人再按老口径改回去）：当天上午的口径是「道歉类只补空壳、导流类铺全部」，当晚改为「三份都铺所有编号目录」。中途还有一次改名，定稿前的旧名以 `aliases` 永久保留 —— 那 643 份删不掉，既不重复上传也不被当成资源。

扫描很慢（每个目录一次 browse，全量 117 个约 13 分钟），所以**先 `--dry` 扫一遍看清单，再用 `--from-last` 补**，不要直接跑全量实补。

判定规则：

- **有资源** = 目录内存在任意「非 `.md` 的文件」**或**存在子目录（分季目录也算有内容）→ 不动。
- **空目录** = 既没有资源文件也没有子目录 → 补占位。
- **缺哪份补哪份**：清单内的占位都在 → 跳过；只缺其中一份 → 单独补那一份。**绝不重复上传同名文件**（夸克会生成 `xxx(1).md`），`--from-last` 靠报告里 `empty[].missing` 记录的缺口精确补，老报告没这个字段时对该目录单独 `browse` 一次并按 `hasResource` 重新分类确认（比全量扫描便宜得多）。
- 只处理**已编号**目录（`编号-片名`），未编号的不碰。

默认范围：电影只查**今天入库**的（避免打扰历史条目），电视剧**全量**（用户明确要求电视剧目录全查）。

占位文件与正文见 `scripts/lib/placeholder.mjs`（**唯一权威定义**，2026-11-08 起三份：更新通知 80 字节、QQ 群缺失反馈 51 字节、站点导流「关于我的网盘索引站」330 字节）。`--placeholder-name` / `--placeholder-text` 只改写第一份。上传失败只记录不中断，报告写入 `~/.workbuddy/quark-sync-cache/placeholder-fill-last.json`（每个待补目录带 `missing: [文件名]`）。

同文件的 `PLACEHOLDER_PREFIXES` 是**识别口径**（比写入清单多一项）：除本流程三份外，还登记了一份历史/人工放过的「资源正在陆续更新上传中…」（2026-11-08 实测全盘仅 1 处，在 `04电影/005-山竹刀`）。识别多一项是为了让 `baidu-share-links.mjs` 与站点 `tools/fill-files.mjs` 不把这类说明文件当真实资源；**它刻意不在 `PLACEHOLDER_FILES` 里**，所以回填不会去创建它。改这几处任一口径时，站点 `tools/fill-files.mjs` 的 `PLACEHOLDER_FILE_RE` 必须同步改（跨仓库不能 import），否则占位 md 会被写进 `files:` 假清单。

百度侧存量目录的同组占位回补用 `mirror-baidu.mjs --fill-placeholders`（见上一节），**不要**在本脚本里处理百度。

**提醒用户**：夸克 CLI 没有删除命令，资源转存进去后目录里的占位 md 要用户自己手动删（导流那份可以留着，它不承诺任何事）。

## 收尾报告

向用户汇报：目录原名→新名、分享链接、TMDB 命中情况（id / 评分 / 类型）、海报、数据文件、构建结果、冒烟结果、**GitHub 推送结果（commit hash）**、**飞书推送结果（message_id；有新增才推）**；未命中或异常单独列出。

## 边界

- **无人值守轮次（定时任务）不提问、不等人工批准、不删任何文件**：所有确认点按「运行模式：定时任务（无人值守）」的默认动作执行，被拒或失败记进报告并继续下一步。

- **剧集类（`type === tv`）一律按季处理**：解析目标季 → 用「片名 + 第N季」参与去重、命名网盘目录、写条目 `title`；比对键走 `normTitle()`（剥季号），不要用裸 `norm()` 直接比剧名（2026-10-24《母狮》第三季被重复收录成 tv-168 就是这么来的）。电影不受此条约束。
- 不删除任何网盘文件（CLI 无删除命令，重复目录交给用户手动处理并给出清单）。
- 不在页面标题加编号。
- 电视剧简介不得漏标「第几季 / 共多少集」（第 5 步硬要求）；存量条目缺失时用 `scripts/backfill-tv-spec.mjs`（先 `--dry --limit 5` 预览再全量）补，补完要构建 + 推送。
- 影视类简介**不得照抄 TMDB overview**，必须二次加工且正文 ≥ 150 字（第 5 步硬要求，2026-11-12 起）；入库前用 `scripts/check-desc.mjs` 自查，存量条目默认不批量回填（要回填先 `--show` 导出清单再逐条改写）。
- 软件条目缺海报时首选 App Store 官方图标（`itunes.apple.com/search`，见第 5 步五档降级），批量兜底用 `scripts/backfill-icons.mjs`（iTunes 精确同名 → GitHub 仓库 raw/README/API 树 → 官网 apple-touch-icon/favicon/og:image → Google favicon 兜底），补完要构建 + 推送；`--map id=主页URL` 给没链接的条目指路。⚠️ 主页是 `github.com` 时不能用 favicon 兜底（会拿到 GitHub 自己的标志）。
- 系统镜像类条目缺海报用 simple-icons 官方标志（CDN 直取，`tools/poster.mjs icon` 会自动补白色，见第 5 步第 ② 档），别用各发行版官网 favicon（多为彩色小图，放大发糊）。这类资源现在归「软件」，`--out` 写 `static/images/app-<编号>.jpg`。
- ⚠️ `data/*.yaml` 里存在**多行标量**写法的 description（人工编辑时真换行），任何按行替换 description 的脚本都必须整块替换，只换首行会残留续行、把 YAML 写坏（`backfill-desc.mjs` / `backfill-tv-spec.mjs` 已修 + 写前 `yaml.load` 自检）。
- 不对未编号目录出链。手动处理单条（不走 `process-batch.mjs`）时一样先 `rename` 再 `share`，脚本已经把「重命名 → 出链」写死，手动流程不得绕过。
- **已编号目录里若装了多部作品**（`025-速度与激情合集` 这类），不走上面这套「新增资源」流程，走 [合集拆分](#合集拆分一个编号目录里装了多部作品)：原目录留给第一部，其余新建编号目录移入后各自入库。别把整个合集当成一部作品出链入库。
- 不改动 `theme/`；要调页面观感另开任务。
- 一次批量处理多部时，逐部执行 3→6 步，避免串号；编号按扫描结果顺序从**可用编号池**（空洞升序 + 顺延段）里取，分配器自己记录本轮已分配的号，中途不重新查询网盘。
- **编号空洞只以夸克实时目录为判定依据**（2026-11-04 用户定夺）：不要用百度侧目录、也不要用 `data/*.yaml` 反推「哪些号空着」。`holes_blocked`（id 被别的分类文件占着）一律跳过。
- **补位改写是「更新条目」，不是删除**：无人值守轮次允许对同 id 旧条目整块就地改写（`upsertEntry`）；但不许删条目、不许清空 `data/*.yaml`。改写后旧条目的 `baidu_url` / `baidu_pwd` 随整块替换消失，**不要手工补回去**（那是上一份资源的死链）。

## Windows 实测（本机，2026-10-04）

| 项          | 值                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Node       | v24（Git Bash 下执行；脚本只用内置模块，无需 npm install）                                                                                                  |
| config.env | `C:\Users\marco\.workbuddy\skills\quark-resource-sync\config.env`（TMDB_TOKEN / SHARE_FID / REPO / QUARK_CLI 均已填；REPO / QUARK_CLI 现在也能自动探测） |
| 站点仓库       | `C:\Users\marco\Github\wodewangpan`（GitHub 仓库 `linuxhobby/wodewangpan`，2026-10-05 由 shareResource 更名）                                      |
| 夸克 CLI     | `C:\Users\marco\.workbuddy\skills\quarkclouddrive\scripts\quark-drive.cjs`                                                                 |

- 脚本已做跨平台处理：临时文件走 `scripts/lib/config.mjs` 的 `TMP`（本机 `C:\Users\marco\AppData\Local\Temp\scan-new.json`），不要用 `--out /tmp/...`；`browse` 的 artifact 路径从输出里的 `"file_path"` 反解析，兼容 Windows 的反斜杠转义。
- **夸克 CLI 的落盘位置随「执行时的 CWD」走**（2026-10-11 实测；1.0.22 → 1.0.24 的行为变更）：1.0.22 把 browse 的 JSONL 写到 CLI 自身目录下，1.0.24 起改为写到 CWD 的 `browse/` 子目录，另在 CWD 落 `.quarkclouddrive/` 写权限探针。带 `.mjs` 的 5 个脚本（`scan-new` / `app-batch` / `process-batch` / `trending-sync` / `placeholder-fill`）已统一显式传 `--task-dir`（取 `scripts/lib/config.mjs` 的 `QUARK_TASK_DIR` = `~/.workbuddy/quark-sync-cache/quark-tasks`），把任务 JSONL 收敛到缓存目录，避免污染仓库工作区；遇到不认该参数的旧版 CLI 会自动回退。仓库 `.gitignore` 同时忽略 `browse/` 与 `.quarkclouddrive/` 兜底。
  - 注意：`--task-dir` 指向的目录**必须已存在**（CLI 会 stat，不存在直接报错），脚本里已用 `fs.mkdirSync(..., { recursive: true })` 兜住。
- 网盘目录 `010其他` → id 前缀 `ot-`、数据文件 `data/misc.yaml`（`scan-new.mjs` 的 CATS 曾漏此项，已补）。
- TMDB 用 `api.tmdb.org`，代理不通时自动回退直连，本机实测 `PROXY=http://127.0.0.1:10808` 下 search 正常返回。
- ⚠️ **git 可能不在当前会话的 PATH 里**（2026-10-30 实测：同一轮定时任务前半段能跑 `git`，会话重建后切到 PowerShell 就 `'git' 不是内部或外部命令`）。QoderWork 自带的 git 在 `~/.workbuddy/bin/git/cmd/git.exe`，报找不到 git 时**直接用绝对路径调**（`& "$env:USERPROFILE\.workbuddy\bin\git\cmd\git.exe" -C "$REPO" status --porcelain`），别因为 PATH 里没有就判定「GitHub 未推送」而跳过第 8 步。

## 与站点 README 的同步约定

站点 README（`linuxhobby/wodewangpan`）有一章「SKILL 变更」，是本 skill 与仓库脚本的规范对照表。**改下面任意一条，必须同时改 skill 与仓库脚本**，否则那天入库的新资源会当场不合规。

| 规范                                                      | skill 侧                                                                                                                                                                                            | 仓库侧                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 简介正文下限 **150 字**（沿革：2026-10-08 提到 300 → 10-22 降回 200 → **2026-11-12 起 150**；下限是**补齐线不是筛选线**，2026-10-23 用户定夺；**只管新入库，存量不回填**） | `SKILL.md` 第 5 步、`scripts/check-desc.mjs` 的 `MIN`、`scripts/lib/desc.mjs` 的 `DESC_MIN`（`trending-sync.mjs` 用它补料，不再跳过）、`match-batch.mjs` 写入的 `desc_body` 与 `process-batch.mjs` 的预筛（2026-11-12 已改成**补齐**：短简介由 match-batch 用同一次 detail 扩写，process-batch 不再跳过出链与入库，补料仍不足 150 只打警告） | `scripts/lib/data.js` 的 `MIN_DESC`（2026-11-12 从长期漂移的 300 校正为 150）→ `tools/fill-desc.mjs` 的 `MIN`、`scripts/list-short-desc.mjs` 的默认 `max` 都取这一处 |
| 简介写入上限 **700 字**（2026-11-12 从 1200 下调，只约束新入库内容） | `SKILL.md` 第 5 步与软件分类两条；`process-batch.mjs` / `app-batch.mjs` / `backfill-desc.mjs` 的预截断阈值、`lib/desc.mjs` 的 `DESC_MAX`（`trending-sync.mjs` 走它） | `scripts/lib/data.js` 的 `MAX_DESC` **刻意保留 1200** 当构建期兜底：它对所有条目生效，降到 700 会把存量最长的那条（`app-136`，710 字）在构建时截成省略号，属于「动以前的数据」，不做 |
| **分类文件用英文命名**（2026-10-09 全量改完）                          | `SKILL.md` 数据文件表、`references/site-schema.md`、`scan-new.mjs` / `make-entry.mjs` / `trending-sync.mjs` 的 `CATS`、`process-batch.mjs` 的 `fileMap`、`backfill-desc.mjs` 的 `FILES`、`placeholder-fill.mjs` | `tools/new-resource.js` 的 `DATA_FILE`                              |
| 电视剧简介带 `【第 N 季 · 共 M 集】`                                | `SKILL.md` 电视剧条目、`trending-sync.mjs` / `process-batch.mjs` / `backfill-tv-spec.mjs`                                                                                                                | `tools/fill-desc.mjs`（自动把原前缀接回新正文之前）                                 |
| 结尾 `｜TMDB <评分>` 署名                                      | `SKILL.md` 第 5 步第 4 条                                                                                                                                                                              | `tools/fill-desc.mjs`（自动接到新正文之后）                                     |
| 自写文案**禁止破折号**（第三方原文保持原样）                                | `SKILL.md` 标点规范                                                                                                                                                                                    | —                                                                    |
| 软件分类简介必须是完整中文                                           | `SKILL.md` 软件分类                                                                                                                                                                                    | —                                                                    |
| 配图按分类选图源（真实素材优先，自绘兜底；OS 用 simple-icons 官方标志；游戏优先 Steam 官方竖版封面 600×900，IsThereAnyDeal 资源页定位 URL） | `SKILL.md` 第 5 步决策表与 ⓪ / ① / ② 档                                                                                                                                                                       | `tools/poster.mjs icon`（单色 SVG 自动补 `--svg-fill`，默认白）；站点 README「配图规范」 |
| 非影视 `date` 填版本发布时间并核实过                                  | `SKILL.md` 第 5 步                                                                                                                                                                                   | 站点 README「经验总结 · 非影视资源的 date」                                        |

**字数统计口径三处必须一致**：`scripts/check-desc.mjs` 的 `bodyOf`、`tools/fill-desc.mjs` 与 `scripts/list-short-desc.mjs` 的 `bodyLen`，都按「剥掉 `【…】` 标签 + 剥掉结尾 `｜…` 署名」来算。改了其中一处，另外两处要跟着改，否则同一个条目两边会报出不同的字数。

skill 唯一维护地：`~/.workbuddy/skills/quark-resource-sync/`（QoderWork 的 Skill 工具与所有定时任务都读这一份）。⚠️ 实测（2026-10-30）：`~/.codebuddy/skills/quark-resource-sync` 是指向 `~/.workbuddy/skills/quark-resource-sync` 的 junction，指向的是**另一份独立文件**（当时停在 1.13，且与本页同样的 frontmatter 损坏），并不是指向本文件的符号链接——改这里**不会**同步到那份，两边都要动时先以本文件为准逐条对照，别整份覆盖。

## 参考

- `scripts/lib/config.mjs` — 统一配置加载（环境变量 > config.env > 自动探测）；直接运行可自诊断
- `references/site-schema.md` — 数据字段、分类与 id 映射、构建产物、冒烟清单
- `references/troubleshooting.md` — 授权过期、代理不通、TMDB 未命中、海报缺失、编号冲突
- `scripts/check-desc.mjs` — 简介正文长度自检（默认下限 150 字，只读不写；`--draft` 可导出改写骨架）
- `scripts/notify-feishu.mjs` — 把本轮新增结果以飞书富文本 post 推送给将军（bot P2P，接收人内置/`FEISHU_TO` 可覆盖；`--dry-run` 自检）
