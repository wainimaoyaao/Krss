# 域文档（Domain Docs）

工程类技能在动代码之前怎么读本仓库的域知识。

## 结论：single-context

本仓库的域文档布局是 **single-context**：全仓库共用根目录一份 `GLOSSARY.md`，架构决定放 `docs/adr/`。后端（`backend/`）、前端（`frontend/`）、iOS 壳（`app/`）共用同一套词汇，各子目录不单独建 `GLOSSARY.md`，也不建 `GLOSSARY-MAP.md`。

## 动手前先读这些

- **`GLOSSARY.md`**（仓库根目录）—— 本项目的领域词汇表
- **`docs/adr/`** —— 与即将改动的区域相关的架构决定

这些文件不存在时**安静跳过**：不要提示缺失，不要主动建议先建。词条与决定按需积累，由 `/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture` 进入）在真正定下术语或决定时才创建。

## 文件结构

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-xxx.md
│   └── 0002-xxx.md
├── backend/
├── frontend/
└── app/
```

## 用词汇表里的词

输出里命名领域概念时（issue 标题、重构提案、假设、测试名），用 `GLOSSARY.md` 里定义的词，不要漂移到词汇表明确避免的同义词。

要用的概念词汇表里还没有，是个信号：要么你在发明项目不用的语言（回头想想），要么这里真有缺口（记下来交给 `/domain-modeling`）。

## ADR 冲突要摆出来

输出与既有 ADR 矛盾时，明说出来，不要悄悄盖掉：

> _与 ADR-0007（xxx）冲突，但值得重开，因为……_
