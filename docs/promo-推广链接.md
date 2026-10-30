# 推广 / 联盟邀请链接（标题栏位）

站点标题栏（H1 同一行右侧）放的推广 / 联盟邀请链接清单：当前文案、跳转地址、出现位置，以及被替换掉的历史链接备查。

适用：要改标题栏链接时（改 `scripts/lib/render.js` 的 `PAGE_INVITES` 数组或首页 H1 行）对照本篇；线上产物在 `/opt/wodewangpan/public`。最近更新：2026-10-30。

## 当前在用的链接

所有链接共用联盟参数 `userCode=e9esmzev`；全部是外部站，渲染时统一带 `rel="noopener noreferrer nofollow"`（见 `scripts/lib/render.js` 的 `titleAsideLinks`）。

| 文案 | 跳转地址 | 出现位置 | 备注 |
|---|---|---|---|
| 学生专属算力包 | `https://www.aliyun.com/activity/ecs/student-compute-package?userCode=e9esmzev` | 各页标题栏（首页 / 分类页 / 详情页），`PAGE_INVITES[0]` | 替换原「领取腾讯 WorkBuddy 2000 积分」 |
| 一键打造你的专属AI应用 | `https://dashi.aliyun.com/activity/aigc?userCode=e9esmzev` | 各页标题栏，`PAGE_INVITES[1]` | 替换原「领取抖音 TRAE AI 5000 积分」 |
| 分钟级部署OpenClaw | `https://www.aliyun.com/activity/ecs/clawdbot?userCode=e9esmzev` | 详情页「浏览量」行右侧（同一行） | 原在首页 H1 行，后移至详情页浏览量行 |

## 历史链接（已替换，备查）

| 文案 | 原跳转地址 |
|---|---|
| 领取腾讯 WorkBuddy 2000 积分 | `https://www.workbuddy.cn/events/invite?inviteCode=4ktsif3n0ne` |
| 领取抖音 TRAE AI 5000 积分 | `https://www.trae.cn/events/code-fission/UU44ET25EK2C?utm_source=copy_link&utm_medium=code_fission` |

## 约定

- 链接位置集中两处：`PAGE_INVITES` 数组（全站标题栏右侧胶囊）与首页 H1 行里手写的 OpenClaw `<a>`。
- 外部站一律 `noopener noreferrer nofollow`，不给自己导流权重。
- 同一文案不要在同一页出现两次；新增链接若与现有位重复，优先复用现有位或换文案（如 OpenClaw 的处理）。
