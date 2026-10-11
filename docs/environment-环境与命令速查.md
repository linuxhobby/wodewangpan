# 环境 · 本机路径与命令速查

> 换机器、重装、或者隔了几周回来忘了东西放哪儿，看这一篇。
> **凭据的真实值一律不写进文档**，这里只记「在哪、叫什么」。
> 最近更新：2026-10-11。

---

## 一、位置一览（macOS 本机）

| 项 | 路径 |
|---|---|
| 站点仓库 | `/Users/marco.chan/Documents/GitHub/wodewangpan` |
| 远端 | `git@github.com:linuxhobby/wodewangpan.git`（本机 git 身份 `linuxhobby`） |
| 线上站点 | https://www.wodewangpan.top |
| 资源同步 skill | `~/.workbuddy/skills/quark-resource-sync/`（v1.11） |
| 夸克网盘 CLI skill | `~/.workbuddy/skills/quarkclouddrive/`（CLI 本体 `scripts/quark-drive.cjs`） |
| 上传出链 skill | `~/.workbuddy/skills/quark-upload-share/` |
| skill 配置（**含凭据**） | `~/.workbuddy/skills/quark-resource-sync/config.env` |
| skill 缓存 | `~/.workbuddy/quark-sync-cache/`（`trending-seen.json` 等） |
| 双机中转目录 | `~/Documents/SynologyDrive/sync-skill/`（不含 `config.env`） |
| CodeBuddy skill 联建脚本 | `~/.workbuddy/skills/.link-codebuddy-skills.sh` |
| skill macOS 本地化脚本 | `~/.workbuddy/skills/.quark-macos-localize.py` |

Windows 兄机对应路径：`C:\Users\marco\Github\wodewangpan`、`C:\Users\marco\.workbuddy\skills\`、`C:\Users\marco\Documents\SynologyDrive\sync-skill\`。

---

## 二、config.env 的五个键

```
TMDB_TOKEN=   # Read Access Token，泄漏会被冒用配额直到吊销
PROXY=        # http://127.0.0.1:xxxx，TMDB 走代理优先，失败自动直连
REPO=         # 站点仓库绝对路径
SHARE_FID=    # 夸克 SHARE 目录标识
QUARK_CLI=    # quark-drive.cjs 绝对路径
```

取值优先级：**环境变量 > config.env > 自动探测**。查各项从哪来的（不打印值）：

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/lib/config.mjs
```

`REPO` 与 `QUARK_CLI` 留空也能跑，脚本会自动探测。

---

## 三、命令速查

### 站点

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建到 `public/`，含 SEO 自检 |
| `npm run serve` | 本地预览 http://localhost:4321 |
| `npm run dev` | 构建 + 预览 |
| `npm run new` | 交互式新建一条资源 |
| `npm run list:short` | 列出正文不足 300 字的条目（同时写 `.tmp/short-desc.md`） |
| `npm run audit:css` | CSS 自检 |

`list:short` 支持 `--max=320`、`--limit=50`、`--cat=纪录片`（注意用 `--` 分隔再传参，例：`npm run list:short -- --cat=纪录片`）。

### 简介补写

```bash
# 改写好的正文放进 .tmp/desc-draft.json  →  { "id": "新正文" }
node tools/fill-desc.mjs            # 空跑
node tools/fill-desc.mjs --apply    # 落盘
node tools/fill-desc.mjs --draft=.tmp/desc-draft-tv.json   # 多批并行各用各的草稿
npm run build                       # 验收
```

### 配图

```bash
node tools/book-cover-douban.mjs --title "书名" --out static/images/bk-001.jpg
node tools/icon-poster.mjs --icon <图标> --out static/images/app-001.png
node tools/set-poster.mjs --title "套装名" --out static/images/bk-006.jpg
node tools/share-poster.mjs         # 改完站点配置后重跑，刷新 static/share.jpg
```

### 资源同步 skill

```bash
S=~/.workbuddy/skills/quark-resource-sync/scripts
node $S/scan-new.mjs                 # 扫描 SHARE，列出待编号目录
node $S/tmdb.mjs search --type movie --query "片名"
node $S/make-entry.mjs --data '{...}'
node $S/check-desc.mjs --file movie.yaml
node $S/trending-sync.mjs --dry-run --no-build --no-push
```

---

## 四、运行时

| 项 | 值 |
|---|---|
| Node（管理版） | v22.22.2，`~/.workbuddy/binaries/node/versions/22.22.2-6/bin/node` |
| 系统 | macOS（zsh），另一台是 Windows |
| 依赖 | `js-yaml`、`sharp`、`pinyin-pro`（**必须在 `dependencies`**，理由见 [dev-开发注意事项.md](dev-开发注意事项.md) 第一节） |

写脚本时注意：**Node 只用内置模块**，不要引入需要 npm install 的库；临时文件一律走 `os.tmpdir()`，别写死 `/tmp/`（Windows 无效）。

两个 Windows 专属坑：`data/*.yaml` 是 CRLF 换行（正则匹配整块会失效，改用位置切片）；沙箱里 `spawnSync` 调 CLI 会 EBUSY（改走 bash 脚本直接调）。

---

## 五、相关

- 哪些改动会翻车：[dev-开发注意事项.md](dev-开发注意事项.md)
- 入库与 skill 用法：[workflow-入库流程.md](workflow-入库流程.md) / [skills-skill用法与维护.md](skills-skill用法与维护.md)
