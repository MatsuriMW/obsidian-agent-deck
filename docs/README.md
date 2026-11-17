# Agent Deck 文档导航

- [`../AGENTS.md`](../AGENTS.md)：核心不变式、验证命令与交接规则。
- [`task-workflow.zh-CN.md`](task-workflow.zh-CN.md)：当前交付基线、双平台实测边界、活跃 Backlog 与快捷键速查（安装时同步为库内 `README-交接.md`）。

## `docs/specs/` 规范索引
| 文档 | 覆盖范围 |
| --- | --- |
| [`specs/architecture-and-boundaries.md`](specs/architecture-and-boundaries.md) | 仓库结构、`src/` 模块锚点、9 家 Agent 边界、Mac/Windows 热点与 Backlog 源码坐标 |
| [`specs/data-and-markdown-contracts.md`](specs/data-and-markdown-contracts.md) | 任务行/AI 块格式、状态关键词、语义块号清理、短链与 AI 总结、并发队列与 Dashboard 口径 |
| [`specs/vision-markdown-harness.zh-CN.md`](specs/vision-markdown-harness.zh-CN.md) | **核心构想**：为什么"Markdown 即 Harness"、三条原则、四层结构、与 RAG 的分野、已落地映射与缺口 |
| [`specs/context-protocol.zh-CN.md`](specs/context-protocol.zh-CN.md) | **契约草案**：Obsidian 原生语法基线、锚点引用、证据链（脚注归因）、注入预算、运行时工具签名、回写、记忆四维字段与画像字段契约（§10.1–10.3） |
| [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md) | **方向 + 落地记录**：十条方向（价值/现状代价/复杂度/最小切片）、快速见效清单、M0–M3 排序、风险退出条件、自审记录、§2.3 已落地批次 |
| [`specs/design-language-and-ui.md`](specs/design-language-and-ui.md) | `src/styles/` 分层架构、`--ad-*` token、默认左对齐、5 页设置秩序与验收矩阵 |
| [`specs/ui-language.md`](specs/ui-language.md) | `t()` 写法、不翻译边界与菜单栏 `labels` 同步 |
| [`specs/acp-integration.zh-CN.md`](specs/acp-integration.zh-CN.md) | 新 Agent 接入原则、协议接法与会话隔离边界 |
| [`specs/shared-memory.md`](specs/shared-memory.md) | Dreaming 单向共享文件、Git 提交范围与 Companion 联动契约 |
| [`specs/pitfalls-and-lessons.md`](specs/pitfalls-and-lessons.md) | Obsidian API、长日志性能、ACP/子进程与标题保护硬坑 |
| [`specs/spec-change-template.md`](specs/spec-change-template.md) | 契约/边界变更核对清单 |
| [`specs/fractal-boards-roadmap.md`](specs/fractal-boards-roadmap.md) | 后续方向：WorkFlowy 分形看板（意义、大纲/Harness/双链实现路线与红线） |
| [`specs/harness-delta-2026-11-18.zh-CN.md`](specs/harness-delta-2026-11-18.zh-CN.md) | 单批增量说明（文本 harness 视角）：这一轮新增了什么、因此能做到什么、回复协议的设计意见 |
| [`specs/dream-shared-memory.md`](specs/dream-shared-memory.md) | **方向草案**：Dream 记忆按条共享（scope/audience、发布层、MCP 接入、撤销红线），参照 Notion 的 MCP + personal memories 模型 |
