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
│   ├── server.mjs               # Node 原生 http 服务，绑定 127.0.0.1:8787
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

运行 `npm run following:ui` 后，在 Safari 打开 `http://127.0.0.1:8787`。

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

- 只监听 `127.0.0.1`，不对局域网或公网开放，无需登录鉴权。
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
- 不提供公网访问或手机端管理入口；若将来需要，另做带 token 的独立服务。

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
