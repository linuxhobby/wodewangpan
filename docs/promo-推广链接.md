# 推广 / 联盟邀请链接（标题栏位）

站点标题栏（H1 同一行右侧）放的推广 / 联盟邀请链接清单：当前文案、跳转地址、出现位置，以及被替换掉的历史链接备查。

适用：要改标题栏链接时（改 `scripts/lib/render.js` 的 `PAGE_INVITES` 数组或首页 H1 行）对照本篇；线上产物在 `/opt/wodewangpan/public`。最近更新：2026-11-02。

## 当前在用的链接

无。2026-11-02 起全站取消所有阿里云联盟邀请链接（标题栏 `PAGE_INVITES` 置空、详情页「分类」行内联的 OpenClaw 推广也一并移除），标题栏右侧仅保留站内「热榜 TOP 30」入口。

## 历史链接（已替换 / 已下掉，备查）

| 文案 | 原跳转地址 | 状态 |
|---|---|---|
| 学生专属算力包 | `https://www.aliyun.com/activity/ecs/student-compute-package?userCode=e9esmzev` | 2026-11-02 全站下掉 |
| 一键打造你的专属AI应用 | `https://dashi.aliyun.com/activity/aigc?userCode=e9esmzev` | 2026-11-02 全站下掉 |
| 分钟级部署OpenClaw | `https://www.aliyun.com/activity/ecs/clawdbot?userCode=e9esmzev` | 2026-11-02 全站下掉 |
| 领取腾讯 WorkBuddy 2000 积分 | `https://www.workbuddy.cn/events/invite?inviteCode=4ktsif3n0ne` | 已替换 |
| 领取抖音 TRAE AI 5000 积分 | `https://www.trae.cn/events/code-fission/UU44ET25EK2C?utm_source=copy_link&utm_medium=code_fission` | 已替换 |

## 约定

- 链接位置集中两处：`PAGE_INVITES` 数组（全站标题栏右侧胶囊）与首页 H1 行里手写的 OpenClaw `<a>`。
- 外部站一律 `noopener noreferrer nofollow`，不给自己导流权重。
- 同一文案不要在同一页出现两次；新增链接若与现有位重复，优先复用现有位或换文案（如 OpenClaw 的处理）。
