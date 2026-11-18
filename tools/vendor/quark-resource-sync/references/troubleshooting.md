# 故障速查

## CLI 报「未登录，请先执行 login」

授权过期或被解绑：

```bash
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs login
```

登录态在客户端，过期时 `browse` / `share` / `rename` 都会失败。

## SHARE_FID 失效（找不到分类目录）

网盘 fid 形如 `~xxxx|yyyy`，一般长期有效；若 `scan-new.mjs` 报「未找到该分类目录」，重新取一次并更新 `config.env` 的 `SHARE_FID`：

```bash
node ~/.workbuddy/skills/quarkclouddrive/scripts/quark-drive.cjs browse --all --page-size 100
```

在输出里定位 `SHARE` 目录的 fid。

## TMDB 返回异常 / 超时

- 代理端口可能变了：`scutil --proxy | grep HTTPSPort`，把 `config.env` 的 `PROXY` 改成实际端口。
- **代理软件没开 / 域名被劫持**（2026-10 遇过）：`api.themoviedb.org` 被解析到 `198.19.x.x`（fake-ip）或直连超时（`code 000`）。`tmdb.mjs` 已改用官方等价域名 **`api.tmdb.org`**，并实现「代理优先 → 失败自动直连」，一般无需再管代理。
- token 失效：到 TMDB 后台重新取 Read Access Token，写入 `config.env` 的 `TMDB_TOKEN`（文件权限 600）。
- `search` 无结果：换原名（英文）再搜一次，或加 `--year`；仍无结果走未命中分支。

## 海报下载失败（image.tmdb.org 连不上）

`api.tmdb.org` 能查数据，但图片 CDN `image.tmdb.org` / `media.themoviedb.org` 可能被阻断（curl 返回 `000`）。此时改抓豆瓣海报（搜索页可直连，图片需带 UA 与 Referer）：

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
# 1) 搜索页取 subject id 与海报路径
curl -s -A "$UA" "https://movie.douban.com/subject_search?search_text=<片名>"
# 2) 下载大图（/view/photo/photo/public/ ≈ 428×600，比 s_ratio_poster 的 270×378 清晰）
curl -sL -A "$UA" -e "https://movie.douban.com/" -o static/images/<slug>/<id>.jpg \
  "https://img2.doubanio.com/view/photo/photo/public/pXXXXXXX.jpg"
```

豆瓣图片不加 UA + Referer 会返回 418。下载后 `file` 确认是 JPEG，并在报告中注明海报来源不是 TMDB。

## TMDB 未命中

保留网盘目录原名（去掉编号与分辨率/季数等规格），`image` 留空走占位图，简介用一句中性描述，报告中标记为待补。已知 6 条 BBC 冷门纪录片属此情况（原名 + 占位图）。

## 海报下载失败

`tmdb.mjs detail` 输出 `poster_url: null` 时该条目本身无海报。下载中断则重跑同一条命令；下载后确认是有效 JPEG（`file <路径>`），非 500×750 也可用，构建会自行缩放。

## 非影视资源找不到海报（别拿自绘收场）

2026-10-09 踩过：一批 12 条里 5 条（游戏 / 音频 / 综艺）直接自绘，上线后被要求全部换成官方素材重做。**自绘是最后手段**，动手前把下列官方图源走一遍，结论照抄不必重试：

| 图源 | 可用性 | 备注 |
|---|---|---|
| `upload.wikimedia.org`（英文维基官方盒绘 / Commons 矢量 logo） | ✅ 首选 | **必须带浏览器 UA**，否则 403；盒绘约 256×364 就够用 |
| App Store `artworkUrl512`（iTunes Search API） | ✅ | 软件类首选 |
| TMDB 节目海报 | ✅ | 综艺 / 剧集类 |
| simple-icons CDN | ✅ | 发行版 / 系统镜像（现归「软件」）、品牌标志（单色 SVG） |
| Fandom 各站（cnc / zelda …） | ❌ 本机超时 | API 与 `Special:FilePath` 都不通，别耗时间 |
| MobyGames | ❌ 403 | 直取被挡 |
| 任天堂官网 `assets.nintendo.com` 猜路径 | ❌ 不可靠 | 带机型 / 区域段，猜不中 |

尺寸判据：站点海报固定 **240×360**（列表页与详情页共用，`fit: 'cover'` 裁切），**源图宽 ≥240 即达标**，不必死磕高清源。取图步骤与用法见 `SKILL.md` 第 5 步「⓪ 真实素材优先」。

## rename 失败

- items JSON 必须是 `{schema_version, items:[{fid, old_name, new_name}]}`，fid 用**完整** FID。
- `new_name` 长度 ≤ 255；同名冲突时按 `quarkclouddrive` 规范让用户选择追加 `(1)` 或跳过。
- 批量失败可用 `rename-revert --batch-id <id>` 整批撤销。

## 出链异常

- 参数固定 `--url-type 1 --expired-type 1`（公开 · 无提取码 · 永久）。
- 短时间内大量出链可能触发风控，逐条执行、失败稍后重试。
- 已有分享的目录重复出链会生成新链接，入库前确认用哪一条。
- `41026 没有可分享的文件`（2026-10-12 实测）：目录里**没有可分享的内容**——空的，或只有占位 md（2026-11-08 起两份：`资源在24小时内更新-请先转存…`、`资源缺失反馈请加QQ群…`）。先 `browse` 看目录内容，空目录不要硬出链，也不能写 YAML，标记为待补资源。
- `41012 该链接已被用户取消分享`：`share-detail` 侧的报错，说明用户在网盘端主动取消了分享。对该目录重新 `share` 只会拿到 `41026`，**重建不了**，只能等用户重新分享或资源补齐后重新入库。

## 分享链接失效：三种码要分开处理（2026-10-12）

| 码 / 现象 | 含义 | 处理 |
|---|---|---|
| `41004 分享的文件不存在` | 文件被挪走 / 删除，或改名后旧链接指向丢失 | 目录还在 → `reshare-batch.mjs` 重出链即可 |
| `41012 已被用户取消分享` | 用户主动取消 | 修不了，见上；报告里逐条列出并问是否下架 |
| `status=3`（code 0 但打不开） | 分享状态异常 | 先试重出链；仍不行按取消处理 |

## 构建失败

多为 YAML 语法问题：简介里的 `"` 需转义、`：` 后不要直接跟特殊字符、标签数组用双引号。`make-entry.mjs` 已做转义与格式校验，尽量用它生成片段。

## 页面 404 / 无样式

见站点 README「常见故障」一节：`root` 指向、`try_files` 含 `$uri/index.html`、`BASE_URL`、中文分类需 URL 编码。

## 多客户端：skill 装了两份会分叉

WorkBuddy 的 skills 目录是 `~/.workbuddy/skills/`，CodeBuddy 的是 `~/.codebuddy/skills/`。两边各复制一份，改了其中一份另一份不会跟着变，很快就对不上（仓库里的归档副本就是这么废掉的，见站点仓库提交 `f25723b`，已刻意删除）。

**同一台机器上用目录联接，别复制**（2026-10-07 已落地）：把 `~/.codebuddy/skills/<skill>` 建为指向 `~/.workbuddy/skills/<skill>` 的 Junction（NTFS 层面对程序透明，不需管理员权限，物理上只有一份文件，改哪边都一样）。验证方法：在联接目录里建个临时文件，去 `~/.workbuddy/skills/<skill>/` 下能看到即成功。注意联接不能跨盘。

已建联接的三个夸克相关 skill（2026-10-07）：`quark-resource-sync`、`quarkclouddrive`、`quark-upload-share`。以后新装的 user 级 skill 若也要给 CodeBuddy 用，同样处理一遍；装完务必做一次双向读写验证。

**跨机器 / 跨平台迁移才用复制**：`node scripts/install.mjs --target <目标 skills 目录>`，脚本会跳过 `config.env`（凭据单独继承，或用 `--token` / `--share-fid` / `--repo` / `--cli` 覆盖）。这是快照式同步，改完要重跑一次。
