# 入库 · 标准流程

从「网盘里多了东西」到「站点上线」的完整链路。本文是**给执行者看的 SOP**，详细配额表与分类清单以 skill 自身文档为准。

> 前置：`~/.workbuddy/skills/quark-resource-sync/`（v1.11）。环境见 [environment-环境与命令速查.md](environment-环境与命令速查.md)，内容规范见 [content-内容规范.md](content-内容规范.md)，配图见 [images-配图规范.md](images-配图规范.md)。

---

## 一、结论先写

三条最容易翻车的：

1. **先 rename 再出链**。顺序反了，出的那条链接直接作废。
2. **fid 每次 browse 都轮换**，不能跨步骤复用。旧 fid 出链会拿到 `{"code":21001,"msg":"文件找不到"}`。
3. **写完必须 `npm run build`**，否则 `public/` 里还是旧内容。

---

## 二、八步流程

### 1. 扫描

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/scan-new.mjs
```

输出各分类总数、下一可用编号、未编号目录清单，疑似重复的会标 `⚠ 疑似重复于 → xxx`。

**先看重复标注再动手**：通常是用户转存了两次，停下来问清是「删重复 / 保留补录 / 不同版本」，不要擅自删除或重复入库。

`99-待删除` 目录已排除；SHARE 下出现站点没有的分类，扫描会列出但**不入库**。

### 2. 确认范围

把待处理清单（目录名 + 拟定编号）给用户确认，再动网盘。

### 3. 重命名（必须在出链之前）

写 items JSON（**完整 FID + 原名 + 新名**），生成 16 位十六进制 batch ID，展示原名 → 新名对照后执行：

```bash
B=$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs rename --batch-id "$B" --items-file /tmp/rename-items.json
```

网盘目录格式：`001-片名`，三位补零，编号取该分类现有最大值 +1。已编号的目录不要动。

### 4. 重新 browse 取新 fid → 出链

```bash
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs share "<新 FID>" \
  --title "070-真相捕捉" --url-type 1 --expired-type 1
```

取返回的 `share_url`。要求是**公开、无提取码、永久**。

> 若某条已经提前出了链接，重命名后必须重新出链，并同步改 `data/*.yaml` 里的 `quark_url`。

### 5. 抓信息（TMDB）

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/tmdb.mjs search --type movie --query "片名"
```

TMDB 走 `api.tmdb.org`（`api.themoviedb.org` 本机可能被劫持），代理优先、失败自动直连。海报 CDN 连不上时改用豆瓣图源（见 [images-配图规范.md](images-配图规范.md)）。

### 6. 写入数据

```bash
node ~/.workbuddy/skills/quark-resource-sync/scripts/make-entry.mjs --data '{...}'
```

简介按 [content-内容规范.md](content-内容规范.md) 写，不要照抄 TMDB 原文。

### 7. 构建 + 冒烟

```bash
npm run build        # 看 SEO 提醒：薄内容条数是否下降
npm run serve        # 抽查详情页
```

### 8. 提交并推送

推 `main` 后 VPS 每 2 小时自动拉取重建，急发用 `FORCE=1 site-autoupdate`。

推送前先 `git status` 查有没有其他会话的未提交改动，**只 `git add` 自己那几个文件**，别 `git add -A`。

---

## 三、编号与 id 对照

| 网盘目录 | 站内分类 | id 前缀 | 数据文件 |
|---|---|---|---|
| `04电影` | 电影 | `mv-` | `movie.yaml` |
| `03电视剧` | 电视剧 | `tv-` | `tv.yaml` |
| `06纪录片` | 纪录片 | `dc-` | `documentary.yaml` |
| `05动漫` | 动漫 | `an-` | `anime.yaml` |
| `01游戏` | 游戏 | `game-` | `game.yaml` |
| `02应用` | 软件 | `app-` | `software.yaml` |
| `008电子书` | 电子书 | `bk-` | `ebook.yaml` |
| `007其他` | 其他 | `ot-` | `misc.yaml` |
| `09操作系统` | 操作系统 | `os-` | `os.yaml` |

- **按扫描返回顺序编号**，不要自作主张按年份 / 系列重排：站点排序是「`added` 倒序 → `id` 倒序 → 上映日期倒序」，重排会让系列作品在页面上倒过来。
- 编号只求唯一、不冲突；同系列多条不必强求连续。

---

## 四、合集拆分（一个目录拆成多条）

网盘里一个「XX 合集」目录装着整系列时，拆成独立条目再入库。规则：

1. **原目录留第一部**并改名（`025-速度与激情合集` → `025-速度与激情1`）。
2. 其余各集在**该分类目录下新建编号目录**，编号从当前最大值 +1 往后排。
3. 字幕等附属文件随正片一起移。
4. 外传 / 特别篇单独一个目录，不并入正传编号序列。
5. 顺序严格走 **rename → create-folder → move → share**：改名会让旧链接作废，出链必须放最后。
6. 站点侧：原 id 就地改写成第一部，其余按新编号新增。

详细命令与验收清单见 skill 的「合集拆分」章节（`~/.workbuddy/skills/quark-resource-sync/SKILL.md`）。

> 实操案例（2026-10-11）：`025-速度与激情合集` 拆成 11 个目录（mv-025 改第一部 + mv-337~346），见 [changelog-变更记录.md](changelog-变更记录.md)。

---

## 五、反向流程：TMDB 热门自动入库

`trending-sync.mjs` 从 TMDB 今日热门取电影 / 电视剧各 1 部，在网盘对应分类建编号目录 → 出链 → 入库 → 推送。

```bash
node scripts/trending-sync.mjs --dry-run --no-build --no-push   # 先看会做什么
```

⚠️ 真跑会**真的建网盘目录并 push**，务必先空跑确认。去重状态记在 `~/.workbuddy/quark-sync-cache/trending-seen.json`，空跑不写状态。

---

## 六、相关

- skill 本身的完整文档：`~/.workbuddy/skills/quark-resource-sync/SKILL.md`
- skill 的维护与升级：[skills-skill用法与维护.md](skills-skill用法与维护.md)
- 改动禁忌：[dev-开发注意事项.md](dev-开发注意事项.md)
- 待办与优先级：[todo-待办清单.md](todo-待办清单.md)
