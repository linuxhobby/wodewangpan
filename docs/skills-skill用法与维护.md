# skill · 用法与维护

三个夸克相关 skill 的日常用法、安装位置、升级合并流程、双机同步约定、灾后重建。

环境路径见 [environment-环境与命令速查.md](environment-环境与命令速查.md)，入库操作见 [workflow-入库流程.md](workflow-入库流程.md)。
最近更新：2026-10-12（脚本清单补三个核对 / 重出链脚本；改名与失效修复流程见 [workflow-入库流程.md](workflow-入库流程.md) §五）。

---

## 一、结论先写

1. **真身只有一份**，在 `~/.workbuddy/skills/`。`~/.codebuddy/skills/` 下的同名目录是**符号链接**，不要在两处各维护一份。
2. **不要把自维护 skill 放在客户端的 `builtin/` 目录下**——客户端更新会清空它。稳定位置是 `~/.workbuddy/skills/`、TRAE 侧是 `~/.trae-cn/skills/`。
3. 两台机器之间经 `~/Documents/SynologyDrive/sync-skill/` 中转，`config.env` 含凭据，**不同步**。
4. 每次从上游拉完新版，跑一次 `.quark-macos-localize.py` 把 macOS 专属章节装回去。

---

## 二、三个 skill 各管什么

| skill | 版本 | 职责 |
|---|---|---|
| `quark-resource-sync` | v1.11 | 网盘 → 站点的同步编排：扫描、编号、出链、抓 TMDB、写 YAML、热门反向同步、**合集拆分** |
| `quarkclouddrive` | 1.0.24（官方，会自动更新） | 夸克网盘 CLI 本体：`browse` / `rename` / `share` / `search` / `upload` 等 |
| `quark-upload-share` | — | 上传本地文件到夸克并生成公开分享链接 |

`quarkclouddrive` 是官方 skill，会自行更新。升级它必须用 `bash scripts/install.sh`，**不要用 `quark-drive.cjs update`**（后者只更新 CLI 本体，不动 SKILL.md 与 references）。

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

## 四、安装位置的教训（2026-10-11 事故）

- **不要把自维护 skill 放在 `~/.trae-cn/builtin/` 下**。TRAE 客户端更新会清空 `builtin/` 目录（实测：skill + quarkclouddrive CLI 整个消失，仅 `~/.trae-cn/quark-sync-cache/` 幸存）。
- 稳定位置：**`~/.trae-cn/skills/`**（客户端更新不碰这里）。WorkBuddy 侧同理：`~/.workbuddy/skills/`。
- 母本永远在 SynologyDrive，本地实例丢了随时可重建（见第六节）。

---

## 五、从上游升级的合并流程

上游 = 兄机经 `~/Documents/SynologyDrive/sync-skill/` 推过来的版本。固定三步：

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

若源结构大改（如脚本统一改用 `lib/config.mjs`），全量覆盖后重跑第七节的适配清单。

验证三件套：`node --check` 全部脚本 → `node scripts/lib/config.mjs` 诊断配置 → `scan-new.mjs` 实测连通。

---

## 六、灾后重建流程（本地实例丢失时，约 10 分钟）

```bash
# 1. 复制母本
cp -R ~/Documents/SynologyDrive/sync-skill/quark-resource-sync ~/.trae-cn/skills/
# 2. 复制 CLI（从 WorkBuddy，登录态在客户端不受影响）
cp -R ~/.workbuddy/skills/quarkclouddrive ~/.trae-cn/skills/
# 3. 路径适配（见第七节清单，前缀统一改 ~/.trae-cn/skills/）
# 4. config.env 从 WorkBuddy 继承凭据（TMDB_TOKEN/PROXY/REPO/SHARE_FID 原样，QUARK_CLI 指向新位置），chmod 600
# 5. 验证三件套（同第五节）
```

---

## 七、路径适配清单（合并 / 重建时必查）

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

## 八、两端谁更新（反向同步）

三方版本号要放在一起看：中转目录可能是**落后**的一方。

| 情形 | 处理 |
|---|---|
| 上游 SKILL.md 版本号更高 | 按第五节合并进来 |
| 本机更高（如 skill 官方自动升级） | 反向 `cp` 回中转目录，让另一台机拉到最新版 |
| 版本号相同但内容不同 | 多半是多机各自改过，`diff` 后人工合并 |

---

## 九、WorkBuddy 与 CodeBuddy 联建

约定：`~/.workbuddy/skills` = 唯一真身，`~/.codebuddy/skills` = 只放符号链接。

```bash
~/.workbuddy/skills/.link-codebuddy-skills.sh            # 建/补链接（幂等）
~/.workbuddy/skills/.link-codebuddy-skills.sh --status   # 看每个 skill 的链接状态
~/.workbuddy/skills/.link-codebuddy-skills.sh --only a,b # 只链指定的
~/.workbuddy/skills/.link-codebuddy-skills.sh --dry      # 只看不落地
```

安全规则：`~/.codebuddy/skills/` 下**已存在的真实目录一律跳过**，不覆盖不删除（可能是对端独有内容）；指向错误目标的链接会自动修正。装完新 skill 跑一次即可。

---

## 十、脚本清单（`quark-resource-sync/scripts/`）

| 脚本 | 作用 |
|---|---|
| `scan-new.mjs` | 扫描 SHARE 下 9 个分类，输出待编号目录与下一可用编号 |
| `tmdb.mjs` | TMDB 搜索 / 详情 / 海报 |
| `make-entry.mjs` | 生成单条 YAML 条目 |
| `process-batch.mjs` / `app-batch.mjs` | 批量处理（内建 rename 后刷新 fid 再 share） |
| `check-desc.mjs` | 检查某分类简介字数达标情况 |
| `check-drive-sync.mjs` | 核对网盘目录名 vs 站点标题（**只比对名字，不验链接**） |
| `check-share-links.mjs` | 逐条 `share-detail` 验链接是否还有效、是否被改名 |
| `reshare-batch.mjs` | 对失效 / 改名条目重新出链，`--apply` 回写 `data/*.yaml` |
| `backfill-desc.mjs` / `backfill-icons.mjs` / `backfill-tv-spec.mjs` | 存量补齐（简介 / 图标 / 剧集季数） |
| `placeholder-fill.mjs` | 缺资源目录补占位说明文件 |
| `trending-sync.mjs` | TMDB 热门反向入库（**会真建目录并 push**） |
| `install.mjs` | 安装向导 |
| `lib/config.mjs` | 配置统一入口 |

---

## 十一、相关

- 入库流程：[workflow-入库流程.md](workflow-入库流程.md)
- 环境与路径：[environment-环境与命令速查.md](environment-环境与命令速查.md)
- 完整 skill 文档：`~/.workbuddy/skills/quark-resource-sync/SKILL.md`
