# skill 用法与维护

三个夸克相关 skill 的日常用法、升级合并流程、双机同步约定。
环境路径见 [environment.md](environment.md)，入库操作见 [ingestion-workflow.md](ingestion-workflow.md)。

---

## 一、结论先写

1. **真身只有一份**，在 `~/.workbuddy/skills/`。`~/.codebuddy/skills/` 下的同名目录是**符号链接**，不要在两处各维护一份。
2. 两台机器之间经 `~/Documents/SynologyDrive/sync-skill/` 中转，`config.env` 含凭据，**不同步**。
3. 每次从上游拉完新版，跑一次 `.quark-macos-localize.py` 把 macOS 专属章节装回去。

---

## 二、三个 skill 各管什么

| skill | 版本 | 职责 |
|---|---|---|
| `quark-resource-sync` | v1.10（+ macOS 章节） | 网盘 → 站点的同步编排：扫描、编号、出链、抓 TMDB、写 YAML、热门反向同步 |
| `quarkclouddrive` | 1.0.24（官方，会自动更新） | 夸克网盘 CLI 本体：`browse` / `rename` / `share` / `search` / `upload` 等 |
| `quark-upload-share` | — | 上传本地文件到夸克并生成公开分享链接 |

`quarkclouddrive` 是官方 skill，会自行更新（本机 2026-10-11 从 1.0.22 自动升到 1.0.24）。升级它必须用 `bash scripts/install.sh`，**不要用 `quark-drive.cjs update`**（后者只更新 CLI 本体，不动 SKILL.md 与 references）。

---

## 三、配置加载（v1.9 起统一）

所有脚本改成静态 import，配置由 `scripts/lib/config.mjs` 统一加载：

```js
import { cfg, requireCfg, SKILL, CACHE, TMP } from './lib/config.mjs';
```

优先级：**环境变量 > config.env > 自动探测**。缺关键配置会退出并提示，不再静默失败。

查各项来源（不打印值）：

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/lib/config.mjs
```

---

## 四、从上游升级的合并流程

上游 = Windows 兄机经 `~/Documents/SynologyDrive/sync-skill/` 推过来的版本。固定三步：

```bash
S=~/Documents/SynologyDrive/sync-skill/quark-resource-sync
D=~/.workbuddy/skills/quark-resource-sync

# 1. 覆盖（只拷有改动的文件）
cp "$S/SKILL.md" "$D/SKILL.md"
cp "$S/references/"*.md "$D/references/"
cp "$S/scripts/"*.mjs "$D/scripts/"
cp "$S/scripts/lib/config.mjs" "$D/scripts/lib/config.mjs"

# 2. CRLF → LF
for f in "$D/SKILL.md" "$D/references/"*.md "$D/scripts/"*.mjs "$D/scripts/lib/config.mjs"; do
  perl -pi -e 's/\r\n/\n/g' "$f"
done

# 3. 装回 macOS 专属章节（幂等，锚点缺失会打印 !! 提示）
~/.workbuddy/skills/.quark-macos-localize.py
```

判定「有没有真的更新」要看内容而不是时间戳（对方与自己都会写这个目录）：

```bash
for f in SKILL.md references/*.md scripts/*.mjs; do
  diff -q <(tr -d '\r' < "$S/$f") <(tr -d '\r' < "$D/$f") >/dev/null 2>&1 \
    && echo "一致: $f" || echo "差异: $f"
done
```

合并结束后把本机结果回写中转目录。**该目录 rsync 改名会被 Synology Drive 拦（`Operation not permitted`），一律用 `cp` 覆盖**，并排除 `config.env`、`.quarkclouddrive`、`workbuddy/`（search 缓存）。

---

## 五、两端谁更新（反向同步）

三方版本号要放在一起看：中转目录可能是**落后**的一方。

| 情形 | 处理 |
|---|---|
| 上游 SKILL.md 版本号更高 | 按第四节合并进来 |
| 本机更高（如 skill 官方自动升级） | 反向 `cp` 回中转目录，让另一台机拉到最新版 |
| 版本号相同但内容不同 | 多半是多机各自改过，`diff` 后人工合并 |

---

## 六、WorkBuddy 与 CodeBuddy 联建

约定：`~/.workbuddy/skills` = 唯一真身，`~/.codebuddy/skills` = 只放符号链接。

```bash
~/.workbuddy/skills/.link-codebuddy-skills.sh            # 建/补链接（幂等）
~/.workbuddy/skills/.link-codebuddy-skills.sh --status   # 看每个 skill 的链接状态
~/.workbuddy/skills/.link-codebuddy-skills.sh --only a,b # 只链指定的
~/.workbuddy/skills/.link-codebuddy-skills.sh --dry      # 只看不落地
```

安全规则：`~/.codebuddy/skills/` 下**已存在的真实目录一律跳过**，不覆盖不删除（可能是对端独有内容）；指向错误目标的链接会自动修正。装完新 skill 跑一次即可。

---

## 七、脚本清单（`quark-resource-sync/scripts/`）

| 脚本 | 作用 |
|---|---|
| `scan-new.mjs` | 扫描 SHARE 下 9 个分类，输出待编号目录与下一可用编号 |
| `tmdb.mjs` | TMDB 搜索 / 详情 / 海报 |
| `make-entry.mjs` | 生成单条 YAML 条目 |
| `process-batch.mjs` / `app-batch.mjs` | 批量处理（内建 rename 后刷新 fid 再 share） |
| `check-desc.mjs` | 检查某分类简介字数达标情况 |
| `backfill-desc.mjs` / `backfill-icons.mjs` / `backfill-tv-spec.mjs` | 存量补齐（简介 / 图标 / 剧集季数） |
| `placeholder-fill.mjs` | 缺资源目录补占位说明文件 |
| `trending-sync.mjs` | TMDB 热门反向入库（**会真建目录并 push**） |
| `install.mjs` | 安装向导 |
| `lib/config.mjs` | 配置统一入口 |

---

## 八、相关

- 入库流程：[ingestion-workflow.md](ingestion-workflow.md)
- 环境与路径：[environment.md](environment.md)
- 完整 skill 文档：`~/.workbuddy/skills/quark-resource-sync/SKILL.md`
