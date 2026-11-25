# Triage 标签

> **当前状态：休眠。** 仓库 `has_issues: false`，票不在 GitHub Issues（见
> `docs/agents/issue-tracker.md`），所以下面这些标签挂不到任何票上 —— 标签本身还在仓库的
> Labels 页里，重新开启 Issues 后即可直接复用。
>
> 本地流程用 `docs/dev/todo.md` 的三段代替分诊：`未完成`＝已写清可开工（对应 `ready-for-agent`）、
> `待观察`＝需要更多信息或等条件成熟（对应 `needs-info`）、`待拍板`＝要人做决定（对应 `needs-triage` /
> `ready-for-human`）；决定不做的写进归档的「遗留」，不要静默删（对应 `wontfix`）。

技能用五个固定的 triage 角色说话。这张表把角色映射到本仓库实际使用的标签字符串。标签已在 `wainimaoyaao/Krss` 里建好，颜色与描述见仓库 Labels 页。

| 角色（技能内） | 本仓库标签 | 含义 |
| -------------- | ---------- | ---- |
| `needs-triage` | `needs-triage` | 维护者需要评估这条 issue |
| `needs-info` | `needs-info` | 等报告人补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已写清，可交给 agent 离线完成 |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不会处理 |

技能提到某个角色（例如「打上 AFK-ready 标签」）时，用表里对应的标签字符串。

要改词表就改「本仓库标签」这一列，并同步改仓库里的标签名。

## Wayfinder 标签

`/wayfinder` 用的五枚，同样已在仓库建好：

| 标签 | 用途 |
| ---- | ---- |
| `wayfinder:map` | 探索地图，顶层容器 |
| `wayfinder:research` | 工单：调研 |
| `wayfinder:prototype` | 工单：原型验证 |
| `wayfinder:grilling` | 工单：把决策问清楚 |
| `wayfinder:task` | 工单：直接施工 |

除这两个系列外，不再额外要求任何标签；`bug` / `enhancement` / `documentation` 等沿用仓库原有的 GitHub 默认标签，按需使用。
