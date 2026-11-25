# Issue tracker：本地 Markdown

本仓库的票**不在 GitHub Issues 里**。仓库 `has_issues: false`（`gh issue list` 会直接报
`the 'wainimaoyaao/Krss' repository has disabled issues`），所以需求、规格、探索记录全部落在本机的
`docs/dev/`，而这个目录被 `.gitignore` 忽略 —— 它们不进仓库、不进 PR、换台机器就没有。

**PRs as a request surface: no.**（外部 PR 不当需求入口。）

## 四个去处，各管一件事

| 文件 | 管什么 | 不记什么 |
| --- | --- | --- |
| `docs/dev/todo.md` | 唯一任务清单：`未完成` / `待观察` / `待拍板` 三段 | 已完成的项（做完就归档） |
| `docs/dev/spec-<主题>.md` | 一份规格：范围、约束、验收口径、边界 | 进度 |
| `docs/dev/review-YYYY-MM-DD.md` | 一次审查的结论清单（编号项 B1 / S3 / F2…） | 修复进度 |
| `docs/dev/archive/YYYY-MM-DD-<主题>.md` | 一批做完的归档：改了什么、门禁数字、实测证据、遗留 | 未完成的活 |

`docs/dev/IDEA.md` 记方向与边界，`docs/dev/变更记录.md` 记批次流水，`docs/dev/移植笔记.md` 记技术坑，
`docs/dev/发版.md` 记发版口径 —— 分工写在 `AGENTS.md` 的「文档分工」一节。

## 常规操作

- **建一条任务**：在 `docs/dev/todo.md` 的 `## 未完成` 下加一行 `- [ ] <模块>：<要做什么>（<为什么>）`。
  一行一件事，能对应到一次提交。动手前先加这一行，别事后补。
- **读某条任务**：直接读 `todo.md`；需要细节时顺着它链到的 `spec-*.md` / `review-*.md`。
- **认领 / 开工**：不用改状态字段，「未完成」里还在就是没做完。多会话并行时靠 worktree 隔离
  （见 `AGENTS.md` 的子树并行一节），不靠 assignee。
- **做完了**：把该项从 `todo.md` 删掉，同时写一份 `archive/YYYY-MM-DD-<主题>.md`，把门禁数字
  （测试项数、lint 结果、实测耗时/体积）和证据文件路径写进去；`todo.md` 顶部留一行摘要指回归档。
- **不做了 / 量完发现不值得做**：不要静默删。在 `todo.md` 对应段落写成 `- [x] …（已量，不改）：<实测数字与结论>`，
  或写进归档的「遗留」一节。
- **拿不准的**：进 `## 待观察`，并写清「现在为什么先不动」和「什么条件下该翻出来」。
- **要用户拍板的**：进 `## 待拍板`，一条一个决策，别把多个决策糊在一行。

## 阻塞与顺序

没有 dependency 机制。顺序靠两种写法表达：

- 同一批里前后依赖：在任务行末尾写 `（依赖前一项）`，或干脆合并成一条。
- 跨批次依赖：在 `spec-*.md` 里写清「本规格假设 X 已合并（提交 `<sha>`）」。

判断「能不能开工」的唯一依据是：它依赖的提交是否已在 `main` 里（`git log --oneline` 核对 sha）。

## 技能说「发布到 issue tracker」

写进 `docs/dev/todo.md`（任务）或 `docs/dev/spec-<主题>.md`（规格）。不要 `gh issue create`。

## 技能说「取出对应票」

读 `docs/dev/todo.md` 里对应的那一行，需要上下文时读它链到的规格与归档。

## Wayfinder / 探索地图

本机不跑 wayfinder 那套「地图 + 子票 + 阻塞边」。探索性工作直接写进 `docs/dev/IDEA.md`：
一个问题一节，记「已经确认的」「还没确认的」「下一步先探哪个」。结论确定后转成 `todo.md` 里的任务。
