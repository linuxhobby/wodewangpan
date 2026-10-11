# 开发注意事项

改代码前必读，都是踩过的坑。
适用：本站（`www.wodewangpan.top`）前端与构建脚本的改动。
最近更新：2026-10-11。

---

## 1. 页面宽度只有一个开关，别逐页传

全站（首页 / 分类页 / 详情页 / 标签页 / 内容页 / 404）统一用宽容器。档位由 `<body>` 上的一个 class 决定，页内所有容器读同一个变量：

```css
body.page--wide { --page-max: var(--page-wide); }   /* 唯一开关，在 layout() 里加 */
.wrap, .cats { max-width: var(--page-max); margin: 0 auto; }
```

- `layout()` 的 `wide` **默认就是 `true`**：新增页面不用传，忘了也不会错；只有确实要窄容器才显式传 `wide: false`。
- 反面教材（2026-10-11）：加标签页 `/tag/<slug>/` 时没传 `wide`（当时默认 `false`），整页比全站窄一圈。而 `wide` 原本要传给顶栏 / 分类栏 / 正文 / 页脚**四处**，漏一处就对不齐——所以改成现在这一处开关，9 处 `wide: true` 也一并删了。
- 新区块要跟全站同宽，用现成的 `.wrap`（或 `.cats`），**不要**再造一个 `.xxx--wide` 变体：那就是这次事故的源头。

## 2. 样式只有一份、只有一类来源

- 样式全部写在 `theme/assets/style.css`：不写内联 `style="..."`，不写 `<style>` 块。散进 JS 里的样式没人找得到。
- 颜色 / 字号 / 行高 / 圆角 / 间距一律用 `:root` 令牌（`--fs-lg`、`--r-box` …）。确实缺档位就在 `:root` 加一行，**不要在区块里写死数值**——`npm run audit:css` 会直接报错。
- 同一视觉只定义一次，改一处两边同步：卡片海报与详情页海报共用 `.tile__poster, .poster`；按钮与二维码切换按钮共用 `.btn, .qrbtn`；内容页正文 / 详情页简介 / 404 说明共用同一条「字号 + 行高 + 色」；分类条 / 标签条 / 页面标题 / 首页区块的计数后缀共用同一条。
- 少用 `!important`。要覆盖就补标签名提特异性或调整顺序（见 `.foot p` 与 `p.foot__icp` 那段注释）。

## 3. 卡片结构只改一处

宫格卡片 `theme/assets/card.js` 被**两端共用**：构建期刷进首屏 HTML，浏览器里渲染「加载更多」和搜索结果。改结构只改这一份，两边各抄一份必然出现「首屏和点加载更多长得不一样」。

## 4. 新增 / 改动页面后的自检

```bash
npm run build && npm run audit:css
```

`audit:css` 查三件事：用了但没写样式的 class、写了但产物里用不到的 class（多半是 HTML 改了样式没清）、区块里写死的数值。三项全绿才算完。

新页面的宽度档位一眼可验（与首页对比）：

```bash
grep -o '<body[^>]*>\|class="wrap[^"]*"\|class="cats[^"]*"' public/index.html public/tag/<slug>/index.html
```

七类页面都应输出 `<body class="page--wide">`。
