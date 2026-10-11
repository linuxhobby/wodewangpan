# docs · 本站经验与备忘

这个目录放**关于本站的经验、注意事项、待完成工作**，和 README 分工：

| 文件 | 给谁看 | 管什么 |
|---|---|---|
| `README.md`（仓库根） | 要上手的人 | 怎么搭、怎么部署、目录结构、命令 |
| `docs/` | 要改这个站的人 | 踩过的坑、做过的决定与依据、待办清单 |

**一句话约定：凡是「下次要注意 / 别忘了 / 待办 / 踩坑结论」，写进 `docs/`，不写进 README。**

README 里的「最新修改」这类记录以后也放这里，README 只留指向，避免两处维护。

---

- **索引与通用经验**：[`experience.md`](experience.md)——新增文档在它的目录表加一行，不要另起索引
- 单一主题的深度文档独立成篇：`pitfalls.md`、`seo-notes.md`、`bot-traffic-governance.md`、`thin-content-rewrite.md`（环境与 skill 类手册：`environment.md`、`content-rules.md`、`ingestion-workflow.md`、`skill-usage.md`）

写法：结论先行；写清依据（代码常量 / 函数名、日志数据、实测日期），没验证的标「待验证」；结论被推翻时**改结论并留一行「原结论 → 修正」**，不删历史。
