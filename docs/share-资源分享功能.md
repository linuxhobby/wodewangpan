# 资源分享功能说明

详情页提供一个「分享本资源页」入口，把资源页本身的 URL（canonical）发出去，与已有的「复制转存链接 / 扫码转存」区分开。方案是**移动端用系统分享面板、桌面端常显社交按钮组**的渐进增强组合，纯前端、零后端依赖。

## 行为

### 桌面端（含 Chrome / Edge）
社交按钮组**默认就显示**，无需点击展开，排列顺序为：

```
分享 · QQ · 微博 · 𝕏 · Telegram · 复制链接
```

- 「分享」主按钮：点击调用 `navigator.share` 唤起系统分享面板（桌面 Chrome/Edge 支持时）；不支持的浏览器（如 Firefox 桌面）则回退为复制本页链接。
- `QQ / 微博 / 𝕏 / Telegram`：各一个外链，打开对应平台的发布框，链接与标题在**构建期**已拼好（见下文）。
- 「复制链接」：复制本资源页 canonical 地址（区别于详情页已有的「复制转存链接」）。
- 微信二维码：单独一行（见下）。

### 触屏移动端
支持 Web Share 时隐藏社交按钮组，只留「分享」按钮，点击直接唤起系统分享面板（已含微信 / QQ / 微博等）。判定用媒体查询 `(hover: hover) and (pointer: fine)`：命中即视为桌面，否则视为触屏移动端。

## 微信分享的两种路径

微信网页分享没有官方 JS SDK（需公众号 + 后端签名），因此：

1. **扫码分享本页**：分享区放一张**本页 URL 的二维码**（`/qr/share-<id>.svg`），文案「微信：扫一扫，把本页分享给好友」。
2. **系统面板**：移动端「分享」按钮调起系统面板，里面直接有微信。

注意与「扫码转存」区分：详情页左侧的 `qrBlock` 二维码内容是**网盘转存深链**，而分享区的二维码内容是**资源页 canonical URL**，二者不同，不要混用。

## 实现位置

| 文件 | 职责 |
|---|---|
| `scripts/lib/render.js` | 详情页 `.detail__share` 模板：主「分享」按钮（`data-share` / `data-url` / `data-title` / `data-text`）+ `.share__panel`（社交直链按钮组 + 本页二维码提示）。`shareUrl`、四个社交分享 URL 在构建期用 `encodeURIComponent` 拼好。 |
| `theme/assets/app.js` | 点击 `[data-share]`：支持 `navigator.share` 则调系统面板，否则复制链接；面板内 `[data-copy]` 走复制逻辑并给「已复制链接」反馈。init 里用媒体查询判定触屏移动端并隐藏面板。 |
| `theme/assets/style.css` | `.detail__share`（flex 同行）、`.share__panel`（`display: contents`，让内部子元素与「分享」按钮排同一行）、`.share__hint`（`flex-basis: 100%` 强制微信二维码换行）、`.share__qr` 样式。 |
| `scripts/lib/assets.js` | `writeShareQr(pageUrl, id, outDir)`：为每个资源生成本页 URL 的二维码 SVG，写入 `public/qr/share-<id>.svg`（依赖 `qrcode` 包）。 |
| `scripts/build.js` | 构建期调用 `writeShareQr` 生成 `shareQrMap`，把 `shareQr` 路径注入 `detailPage` 的 `ctx`。 |

## 社交平台分享 URL 格式（构建期拼装）

变量：`url` = 资源页 canonical，`title` = 资源标题，`text` = `${title} - ${站点名}`。

- **QQ**：`https://connect.qq.com/widget/shareqq/index.html?url=<encUrl>&title=<encTitle>`
- **微博**：`https://service.weibo.com/share/share.php?url=<encUrl>&title=<encTitle>`
- **𝕏**：`https://twitter.com/intent/tweet?url=<encUrl>&text=<encText>`
- **Telegram**：`https://t.me/share/url?url=<encUrl>&text=<encText>`

所有外链均带 `target="_blank" rel="noopener noreferrer"`，避免 `window.opener` 隐患、对 SEO 干净。

## 隐私口径

分享功能纯前端、不发任何统计请求，与 `/about/`「不追踪个人信息」的口径一致，无需改文案。

## 部署

构建时 `npm run build` 会为每个资源自动生成 `public/qr/share-<id>.svg`，VPS 拉取重建即生效，无需手动操作（首次部署记得 `git pull`）。

## 已知限制

- 桌面 Chrome / Edge 点「分享」主按钮也会调系统面板，与常显的社交按钮组并存，属预期（系统面板是额外便捷方式）。
- 分享依赖资源页 canonical（`baseUrl + /resource/<id>/`），`baseUrl` 需在 `config/site.yaml` 或 `BASE_URL` 环境变量正确配置，否则生成的分享链接会指向错误域名。
- 微信真正「一键分享给好友」只能靠移动端系统面板或扫码，网页端无法做到免扫码直达。
