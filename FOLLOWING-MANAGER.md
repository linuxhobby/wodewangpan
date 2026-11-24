# 追热播 Web 管理工具方案

> 状态：方案定稿，待实现 · 2026-11-24

## 1. 目标

建立一套本机端 Web 交互工具，用于人工指定「追热播」剧集。热播剧完全由站长指定，不从 TMDB 自动选取，也不因 TMDB 状态变化自动进出。

核心原则是**展示层与资源档案解耦**：剧集资料长期留在 `data/tv.yaml`，追热播只是一个可随时增删的虚拟栏目，不改动资源分类，不产生 URL 迁移，不留下死链。

## 2. 已定决策

| 议题 | 结论 | 理由 |
|---|---|---|
| 是否新增真分类「追热播」 | 否 | 分类是 URL 契约。播完移回「电视剧」会换 URL，必须配 301；删除则留下 404 |
| 热播剧来源 | 人工指定资源 ID | 剧名会重名，站内已有近似条目，ID 唯一且稳定 |
| 是否用标签标记 | 否 | 标签词表只写属性；`tagMin: 3` 会卡住少量剧集；无法排序、无归档语义 |
| 是否改动资源 YAML | 否 | 避免改动分散、避免与补齐任务互相覆盖 |
| 清单位置 | 本地 `config/following.json`，入库 `config/following.example.json` | 公开仓库不应暴露站长选片；每个 clone 从空清单开始 |
| 前台页面 | 虚拟栏目 `/following/`，不进 sitemap | 仿 `/hot/`、`/all/` 的通道页口径，将来下线无收录负担 |
| 管理工具位置 | 仓库根目录 `manager/` 独立目录 | 与 `tools/` 的构建、cron 脚本分开，边界清晰 |
| 技术栈 | Node 原生 `http` + 单页 HTML/JS，零新增依赖 | 仓库已是 Node ≥18，无需引入 Express 或前端构建链 |
| 发布动作 | 仅 `git push` 到当前仓库 remote，二次确认 | 不接 SSH、不接远程部署，公开仓库不能因此获得 VPS 管理权 |

## 3. 目录结构

```text
wodewangpan/
├── manager/                     # 本次新增，管理工具独立目录
│   ├── server.mjs               # Node 原生 http 服务，默认绑定 127.0.0.1:8787，可选局域网白名单
│   ├── following.mjs            # 清单读写与校验的唯一逻辑，原子写
│   └── public/
│       ├── index.html           # 单页界面
│       ├── app.js               # 交互与 API 调用
│       └── style.css            # 管理界面专用样式
├── config/
│   ├── following.example.json   # 入库示例，供他人建站复制
│   └── following.json           # 本地实际清单，加入 .gitignore
└── scripts/
    └── build.js                 # 构建时读取清单，生成 /following/
```

根 `package.json` 增加启动命令：

```json
"following:ui": "node manager/server.mjs"
```

运行 `npm run following:ui` 后，在本机浏览器打开 `http://127.0.0.1:8787`。

需要局域网其他机器用浏览器直接访问时，启动时显式指定监听地址与来源白名单（IP 不写进仓库）：

```bash
FOLLOWING_UI_HOST=0.0.0.0 FOLLOWING_UI_ALLOW_IPS=<允许的局域网 IP> npm run following:ui
```

然后那台机器打开 `http://<本机局域网 IP>:8787`。未配置白名单时只允许本机；服务仍无账号鉴权，白名单就是全部访问控制，只放行信任的固定 IP，不要对公网开放。

## 4. 清单数据格式

文件只存 ID 与少量编排信息，不存标题、链接、图片等可从 `data/tv.yaml` 派生的字段。

```json
{
  "active": [
    { "id": "tv-216", "addedAt": "2026-11-24", "note": "本周新剧" },
    { "id": "tv-212", "addedAt": "2026-11-20" }
  ],
  "archived": [
    { "id": "tv-008", "removedAt": "2026-11-24" }
  ]
}
```

字段规则：

| 字段 | 必填 | 说明 |
|---|---|---|
| `active[].id` | 是 | 电视剧资源 ID，形如 `tv-216` |
| `active[].addedAt` | 否 | 加入日期，由工具自动补 |
| `active[].note` | 否 | 站长备注，仅管理界面可见 |
| `archived[].id` | 是 | 已播完或主动下架的剧集 ID |
| `archived[].removedAt` | 否 | 移出展示的日期，由工具自动补 |

`active` 的数组顺序就是前台展示顺序。归档记录用于防止以后重复添加，不在前台展示。

## 5. Web 工具设计

### 5.1 服务端

`manager/server.mjs` 职责：

- 默认只监听 `127.0.0.1`；可通过环境变量改为监听局域网地址并限制来源 IP，无需登录鉴权。
- 提供静态页面与 JSON API。
- 所有清单读写委托给 `manager/following.mjs`，不另写一套逻辑。
- 只读 `data/tv.yaml` 用于剧集搜索，绝不写它。
- 写入清单时先写临时文件再 `rename`，保证原子写，避免中断写坏文件。

### 5.2 API

```text
GET  /api/candidates?q=      按剧名或 ID 搜索电视剧，返回 id/title/image/updated
GET  /api/state              返回 active 与 archived 清单
POST /api/add                { id, note }
POST /api/archive            { id }
POST /api/remove             { id }
POST /api/reorder            { ids }
GET  /api/diff              返回清单的 git diff
POST /api/publish            提交推送，需前端二次确认
```

### 5.3 校验规则

加入时按顺序检查：

1. ID 是否存在于 `data/tv.yaml`。
2. 该条目 `category` 是否为「电视剧」。
3. 该条目是否 `dead: true`，死链拒绝加入。
4. 是否已在 `active` 或 `archived` 中，已归档的给出提示，由站长决定是否恢复。

按剧名搜索命中多条时必须要求站长选 ID，不允许工具自动猜测。

### 5.4 界面布局

| 区域 | 内容 |
|---|---|
| 左侧 | 候选剧集搜索框与结果列表，显示封面、ID、标题、最近 `updated` |
| 右侧 | `active` 清单，可拖拽排序，每行带备注与「归档」「移除」按钮 |
| 底部 | `archived` 折叠区，带「恢复到 active」按钮 |
| 操作栏 | 「构建并在 Safari 预览」「查看变更」「提交推送」三个按钮 |

「提交推送」先展示 diff 预览，点击确认后才执行 `git add`、`git commit`、`git push`。工具不自动构建、不自动推送。

## 6. 构建侧接入

管理工具只维护清单，前台页面由构建侧生成。

| 文件 | 改动 |
|---|---|
| `scripts/build.js` | 注册保留目录 `following`；读取 `config/following.json`，不存在时按空清单处理；生成 `/following/` 页面；不写 sitemap |
| `scripts/lib/render.js` | 新增虚拟栏目页渲染函数，按清单顺序渲染卡片 |
| `scripts/lib/nav.js` | 加导航入口，页面类型标记为虚拟栏目，不渲染面包屑 |
| `theme/assets/style.css` | 前台栏目页必要样式，遵守现有 CSS 审计约束 |
| `package.json` | 加 `following:ui` 命令；lint 范围加入 `manager` |
| `eslint.config.js` | `files` 数组加入 `manager/**/*.{js,mjs}` |
| `.gitignore` | 加入 `config/following.json` |

不改 `config/site.yaml` 的 `categories` 与 `slugs`，不改 `data/`，不改 `config/tags.yaml`，不改 nginx 配置与 `scripts/sitestats.py`。

## 7. 安全边界（公开仓库前提）

仓库公开给他人建站使用，但写权限仍由 GitHub 账户控制。设计上必须保证工具无法成为通往本站 VPS 的跳板。

1. **零新增依赖**：只用 Node 内置模块与仓库已有的 `js-yaml`，减少供应链面。
2. **文件白名单**：`manager/` 只读 `data/tv.yaml` 和 `config/following.json`，不读取 `~/.config`、`~/.ssh`、`.env` 或 `config/` 下其他文件。
3. **remote 不硬编码**：发布动作从 `git remote get-url origin` 读取目标并显示给站长确认，不写死任何 VPS 地址、端口或 SSH 用户。
4. **不接远程部署**：不提供 SSH、rsync、scp、VPS 路径或重建命令，发布只走到 Git remote 为止。
5. **不接凭据链路**：管理工具不读飞书 AppSecret、TMDB token、夸克 cookie。这些继续留在原有 cron 脚本的外部配置中，两者不交叉。
6. **选片不外泄**：实际清单 `config/following.json` 加入 `.gitignore`，入库的只有 `following.example.json`。
7. **PR 必须审查**：本地工具以站长用户权限运行，CI 只能拦明显错误，拦不住恶意逻辑。公开仓库收到的 PR 未经审查不得合并。
8. **CI 敏感串扫描**：新增检查扫描 IPv4、`ou_` 开头的 open_id、邮箱等模式，阻断新增泄露。
9. **历史残留接受**：已经进入 Git 历史的信息不在此方案里清除。彻底清理需要重写历史并强推，成本高于收益，当前版本保持干净即可。

已执行的相关动作：删除 `tools/vendor/quark-resource-sync/SKILL.md` 中关于另一台机器的 IP 备注，提交 `ec7baa7`，已推送到 `origin/main`。

## 8. 日常操作

1. 发现想推的剧，在管理界面搜索，拿到唯一 ID，点「加入」。
2. 需要调整优先级时，在右侧清单拖拽排序。
3. 某剧剧情播完，点「归档」，剧集资料本身不动。
4. 确认编排后，点「查看变更」，再点「提交推送」并确认。
5. VPS 的自动构建检测到新提交后重建，前台 `/following/` 自动更新。

系统可另外提示「某条 `updated` 已超过 60 天，可考虑归档」。是否归档始终由站长决定，工具不自动执行。

## 9. 非目标

- 不从 TMDB 自动选剧，不按热度自动排序。
- 不自动判定剧集完结，不自动删除资源。
- 不修改 `data/tv.yaml` 中任何条目的 `category`、`tags`、`updated`。
- 不替代按 PV 排序的「热榜 TOP 30」，`/hot/` 保持现状。
- 不提供公网访问入口；局域网访问只能按来源 IP 白名单放行固定机器，仍无账号鉴权。

## 10. 验收清单

- `npm run following:ui` 启动后，Safari 可打开 `http://127.0.0.1:8787`。
- 按剧名和 ID 均能搜到电视剧，重名结果要求选择 ID。
- 加入、加备注、拖拽排序、归档、移除、恢复均生效，写入为原子写。
- 无效 ID、非电视剧 ID、死链 ID 被拒绝，并给出明确原因。
- `config/following.json` 不存在时构建不报错，`/following/` 显示空状态。
- 构建后 `/following/` 按清单顺序展示，详情页链接仍指向 `/tv/<id>/`。
- `/following/` 不进 sitemap，`/tv/` 与详情页 URL 不变。
- `npm run lint` 与 `npm run build` 通过，CSS 审计通过。
- 「提交推送」必须先显示 diff，确认后才执行，未确认时仓库无变化。
- 全仓检索无硬编码 VPS 地址、SSH 命令、飞书接收人 open_id。

---

# 第二部分：全站资源字段编辑模块

> 状态：方案定稿，待实现 · 2026-11-24

## 1. 目标与边界

在第一部分建立的 `manager/` 里扩展一个全站资源字段编辑器，让站长通过本机 Web 界面修改三类信息：

1. 标题，含所谓副标题。
2. 网盘 URL，包括夸克、百度与提取码、光鸭。
3. 资源简介。

这是受控字段编辑模块，不是完整 CMS。新增资源继续用 `tools/new-resource.js`，删除继续用 `tools/remove-resource.mjs`，文件清单、配图、TMDB、补齐、推送仍由现有脚本和 cron 负责。

## 2. 为什么只开放这三类字段

`data/*.yaml` 是全站事实源，有多重约束。只开放这三类字段，是因为它们改动频繁、影响局部、可溯源，且不涉及 URL 契约与自动化红线。

| 约束 | 对编辑器的要求 |
|---|---|
| 多个自动化任务并行写同一批 YAML | 编辑器写盘前必须检查工作区与远程状态，跨机协作先确认已 rebase，必要时加同机文件锁 |
| 字段有语义红线 | `added` 不可改，`updated` 只在内容真变化时写当天，`files.*` 必须来自真实接口或目录，不能手填 |
| 副标题不是独立字段 | 它嵌在 `title` 里，用 ` - ` 分隔，且只有部分分类适用，必须按现有口径校验 |
| ID 与分类决定 URL 和配图 | 改 `id` 或 `category` 等于换 URL，必须配 301，不能当普通字段编辑 |
| 已有成熟管线 | 新增、删除、补齐、海报、简介填充都有专用脚本，重写一套会造成职责冲突 |

最大的工程难点不是界面，而是在保留 YAML 注释、LF 行尾和并行写入的前提下，只改指定字段。用 `js-yaml` 整体 dump 会冲掉注释，也违反仓库的逐行保留约定，必须做按行定位的定点改写。

## 3. 字段级规则

| 编辑项 | 对应 YAML 字段 | 处理规则 |
|---|---|---|
| 标题（含副标题） | `title` | 界面拆成「主标题」「副标题」两个输入框，底层合并成一个 `title`。影视类（电影、电视剧、动漫）保持纯片名，不加副标；游戏、软件、电子书、课程、其他按 `原名 - 客观功能描述` 口径，并复用 `SUBTITLE_CATS`、`HAS_SUBTITLE_RE`、`isLongTitle` 校验 |
| 网盘 URL | `quark_url`、`baidu_url`、`baidu_pwd`、`guangya_url` | 四个独立输入框，按域名格式校验。工具不访问网盘验证可达性。若条目已是 `dead: true`，替换链接后不会自动清除死链标记，必须由站长显式勾选「已人工核验」才清除 |
| 资源简介 | `description` | 直接编辑正文。部分简介结尾带来源标识，例如 `｜TMDB 6.3`，编辑器默认保留，提供开关允许删除 |

## 4. 三个连带影响

1. **影视标题会影响追更提醒。** `tools/lib/tmdb.mjs` 用剧名检索 TMDB，改标题后可能导致追更匹配失效。编辑影视类标题时界面给出明确提示，但不阻断。
2. **实际改动才写 `updated`。** 有内容变化就写当天日期，打开后原样保存则不写。这符合仓库「不伪造日期」红线，也会真实更新 sitemap lastmod。
3. **URL 改动不等于链接可用。** 工具只做格式检查，是否失效仍以人工核验或现有检查流程为准，不让本地工具变成爬虫。

## 5. 编辑器机制

- 在 `manager/server.mjs` 增加资源查询与更新 API：

```text
GET  /api/resources?cat=&q=    按分类与关键词搜索资源
GET  /api/resource?id=         返回单条资源的可编辑字段
POST /api/resource/update      { id, changes, deadVerified }
```

- 读取沿用 `scripts/lib/data.js` 的 `loadResources()`，不另写解析器。
- 写入用按行定位的定点补丁，只替换目标字段行，保留注释、LF 行尾和其他内容，不做整体 YAML dump。
- 保存前展示 before/after diff，可先「构建并在 Safari 预览」，确认后再提交推送。
- 原子写，先写临时文件再 `rename`，避免中断写坏数据文件。
- Git 提交本身作为修改历史，不引入额外数据库。

## 6. 明确不碰的字段

以下字段只读展示，不在编辑器里开放：

```text
id / category / date / added / updated / dead / files / image / tags
```

`dead` 只有一种例外：站长显式勾选「已人工核验」后，可随链接更新一并清除。`tags` 有词表治理规则，先不开放编辑。

## 7. 界面形态

左侧是资源搜索与分类筛选，点开某条后右侧显示三块表单：标题区、链接区、简介区。下方固定展示变更 diff 与操作按钮。字段数量少，做成单页即可，不需要复杂工作流。

## 8. 与第一部分的关系

- 共用同一个 `manager/` 目录、同一个本地服务、同一套发布与安全边界。
- 第一部分维护 `config/following.json` 的选片清单，本部分维护 `data/*.yaml` 的资源字段，两者互不写对方的文件。
- 第一部分是追热播栏目的编排入口，本部分是全站资源的资料订正入口。
- 公开仓库下的 PR 审查与 CI 敏感串扫描要求同样适用；由于本模块可写全站数据，PR 审查必须更严格。

## 9. 验收清单

- 按分类与关键词能搜到全部资源，点开后正确显示三个可编辑区块。
- 影视类标题不允许加副标，工具资料类副标按现有口径校验，超限或格式错误时拒绝保存。
- 分享 URL 按域名格式校验；无效格式被拒绝，但不发起网络请求。
- 简介默认保留 `｜TMDB x.x` 之类来源尾缀，关闭开关后可删除。
- 修改 `dead: true` 条目的链接时，未勾选「已人工核验」不会清除 `dead`。
- 实际改动写当天 `updated`，原样保存不改变 `updated`。
- YAML 的注释、LF 行尾、未涉及字段和条数注释在保存后完全不变。
- before/after diff 正确显示，提交推送仍需二次确认。
- `npm run lint` 与 `npm run build` 通过，CSS 审计通过。
- 全仓检索无硬编码 VPS 地址、SSH 命令、飞书接收人 open_id。

---

# 第三部分：连载状态看板

> 状态：方案构想，待实现

## 1. 需求背景

资源数量已经多到无法人工记住每部剧的状态：哪部还在更新、哪部已经完整、哪个资源目录还缺文件。第一部分「追热播编排」只管理你手动指定的剧，不等于全站状态视图，因此需要独立的只读看板。

## 2. 数据源与判据

全部复用仓库现有口径，不另造规则，不写 `data/`。

| 状态 | 判据 | 现有依据 |
|---|---|---|
| 更新中 | `updated` 在 60 天内，`itemState()` 判为 active | `tools/lib/serials.mjs`，`IDLE_DAYS = 60` |
| 已定格 | 超过 60 天无盘端变化 | 同上 |
| 死链 | `dead: true` | 同上 |
| 可能缺资源 | 没有 `files` 块，或 `files.tree` 只有占位 md、目录条目 | 复用 `tools/fill-files.mjs --todo` 的判定思路 |

## 3. 功能设计

- 四栏展示：更新中、已定格、死链、可能缺资源。
- 支持按分类筛选，默认只看电视剧与动漫。
- 每行显示 ID、标题、分类、最近 `updated`、`files.count`、状态。
- 点击某条可直接跳到第二部分的字段编辑面板，或跳到第一部分的追热播加入操作。
- 看板完全只读：不触发补齐、不写盘、不改 `updated`、不改 `dead`。

## 4. 新增 API

```text
GET /api/serials/status    返回 tv.yaml 与 anime.yaml 的 active/settled/dead 分组
GET /api/serials/todo      返回可能缺资源的剧集清单，只读
```

真正的补齐仍由每 2 小时的 cron 负责，看板只呈现事实。

## 5. 与追热播联动

1. 候选剧集列表直接显示状态角标：更新中、已定格、死链、可能缺资源。
2. 加入追热播时，一眼看出这部剧是否还在更新，避免把已完整的剧放进去。
3. 归档时给出当前状态提示，但不自动归档，决定权仍在站长。
4. 超过 60 天无变化的活跃剧，在飞书简报或看板中提醒，不自动移出。

## 6. 验收清单

- 看板显示的 active/settled/dead 与 `node tools/list-ongoing.mjs --all` 一致。
- 「可能缺资源」列表与 `fill-files --todo` 的判定口径一致。
- 看板操作不产生任何 `data/*.yaml` 写入。
- 点击条目可正确跳转到字段编辑与追热播加入界面。
- 状态角标在追热播候选列表中正确显示。
- `npm run lint` 与 `npm run build` 通过。

---

# 第四部分：资源删除

> 状态：方案构想，待实现

## 1. 需求与性质

删除资源是真实需求，但与前三项性质不同：它有外部网盘副作用，不能当成普通字段编辑处理，也不在本地工具里重写一套逻辑。

## 2. 现有脚本能力

仓库已有 `tools/remove-resource.mjs`（2026-11-24 建立），流程如下：

1. 夸克网盘：把 `<编号>-` 目录移到 `SHARE/99-需要移除的资源都转移到这里`。
2. 光鸭网盘：把对应目录移到根目录回收目录。
3. 删除 `data/<分类>.yaml` 的整块条目、`static/images/<slug>/<id>.jpg`、`config/drive-fids.json` 映射。
4. 构建校验，再 `git add/commit/pull --rebase/push`。

现有安全口径：默认 dry-run，必须 `--apply` 才真跑；盘端 CLI 报错或登录失效则整体停手，不删库不推送；工作区有非本任务改动即停手；推送前 fetch 并确认基于远程 HEAD。另有 `--skip-drive`（网盘端已人工处理时只删库）和 `--no-push`（只本地提交，不推送）。

## 3. 本地工具接入方式

只包装，不重写。`manager/` 通过子进程调用现有脚本，并展示原文输出。

| 步骤 | 界面行为 |
|---|---|
| 搜索选中 | 按 ID 或剧名定位资源，显示分类、标题、当前链接 |
| 影响预览 | 列出将移动的两端网盘目录、将删除的 YAML 条目、配图、fid 映射 |
| 试跑 | 调用 `node tools/remove-resource.mjs --ids <id>`，原样展示 dry-run 输出 |
| 模式选择 | 正常删除 / 仅删库（`--skip-drive`）/ 只本地提交（`--no-push`） |
| 真执行 | 需要再次输入 ID 确认，才调用带 `--apply` 的命令 |
| 结果 | 展示退出码与脚本原文报告，失败时不继续任何后续动作 |

删除是不可逆操作，网盘目录进回收站、站点条目消失。界面必须把试跑和真执行分成两步，不允许一键完成。

## 4. 安全口径修正

第一部分定的「本地工具不接触网盘 CLI 和凭据」在此增加一条例外：

- 删除模块通过**调用现有脚本**间接使用网盘 CLI，凭据仍留在仓库外部的 `~/.workbuddy/skills/`，`manager/` 代码里不存任何 token 或账号。
- 这是特权操作，不是默认路径。只有主动打开删除视图、走完试跑和二次确认才执行。
- 公开仓库下，这个模块的 PR 审查必须最严格。它能移动网盘目录并删库，危害高于字段编辑。
- 删除不进自动流程，不由 cron 触发，不根据「剧已完结」自行判断。

## 5. 验收清单

- 删除视图只能通过搜索选中资源，不提供全库批量删除入口。
- 试跑与真执行分两步，未通过试跑或二次确认时不会调用 `--apply`。
- 三种模式（正常删除、`--skip-drive`、`--no-push`）的参数拼接正确，不产生额外写操作。
- 脚本输出原文展示给用户，退出码 3 或 4 时不继续后续动作。
- `manager/` 代码中无网盘 token、账号、CLI 绝对路径或 VPS 地址。
- 删除成功后，对应 YAML 条目、配图、fid 映射均不存在，构建通过。
- 删除失败时站点数据与网盘目录保持脚本停手前的状态。

---

## 总体视图

四个部分共用一个 `manager/` 服务、一套安全边界、一个「构建预览、提交推送」出口：

1. 追热播编排：人工指定哪些剧上前台。
2. 连载状态看板：全站哪些剧在更新、哪些完整、哪些缺资源。
3. 字段编辑：改标题、链接、简介，修正 LLM 错误和失效链接。
4. 资源删除：受控包装现有脚本，试跑后二次确认执行。

---

# 第五部分：代码依赖边界（全局约束）

> 状态：方案约束，适用于以上四个部分

## 1. 单向依赖规则

- `manager/` 可以引用或复用 `scripts/`、`tools/` 等目录下的现有代码。
- `scripts/`、`tools/`、`config/`、`bot/`、`deploy/` 中的任何文件都不得引用 `manager/` 下的代码。
- `manager/` 是可选的本地工具，不是站点构建和运行的依赖。

## 2. 构建侧读取清单的处理

如果 `scripts/build.js` 需要读取 `config/following.json`，清单的读取与校验逻辑必须放在 `scripts/lib/` 之类的公共位置（例如 `scripts/lib/following-manifest.mjs`），由 `manager/` 反向引用。

禁止 `build.js`、`render.js`、`nav.js`、cron 脚本引用 `manager/following.mjs` 或 `manager/` 下任何其他文件。

## 3. 删除模块的边界

`manager/` 的删除视图通过子进程调用 `tools/remove-resource.mjs`，属于 `manager → tools` 方向，符合单向依赖规则。现有脚本不得反过来调用 `manager/` 的删除视图。

## 4. 验收

- 全仓检索确认 `scripts/`、`tools/`、`config/`、`bot/`、`deploy/` 中没有指向 `manager/` 的 import 或 require。
- 临时移走整个 `manager/` 目录后，`npm run build`、`npm run lint` 与现有 cron 脚本仍能正常运行。
- 移走 `manager/` 后生成的 `public/` 内容与存在时一致。
