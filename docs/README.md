# Agent Deck 文档导航

- [`../AGENTS.md`](../AGENTS.md)：核心不变式、验证命令与交接规则。
- [`task-workflow.zh-CN.md`](task-workflow.zh-CN.md)：当前交付基线、双平台实测边界、活跃 Backlog 与快捷键速查（安装时同步为库内 `README-交接.md`）。

## `docs/specs/` 规范索引
| 文档 | 覆盖范围 |
| --- | --- |
| [`specs/architecture-and-boundaries.md`](specs/architecture-and-boundaries.md) | 仓库完整项目结构、`src/` 全模块锚点（含纯 Node Context Core）、21 家 Agent + 自定义 ACP 边界、Mac/Windows 热点与交接坐标 |
| [`specs/data-and-markdown-contracts.md`](specs/data-and-markdown-contracts.md) | 任务行/AI 块格式、状态关键词、语义块号清理、短链与 AI 总结、并发队列与 Dashboard 口径 |
| [`specs/vision-markdown-harness.zh-CN.md`](specs/vision-markdown-harness.zh-CN.md) | **核心构想**：为什么"Markdown 即 Harness"、三条原则、四层结构、与 RAG 的分野、已落地映射与缺口 |
| [`specs/context-protocol.zh-CN.md`](specs/context-protocol.zh-CN.md) | **契约草案**：Obsidian 原生语法基线、锚点引用、证据链（脚注归因）、注入预算、运行时工具签名、回写、记忆四维字段与画像字段契约（§10.1–10.3） |
| [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md) | **Milestone 路线图（v4）**：代码级现状诊断、M0 基线、M1（上下文提取与 MCP 对外供给：M1.1–M1.3）、M2/M3、并行轨道与冻结边界、全量映射、止损与两轮自审 |
| [`specs/information-flow.zh-CN.md`](specs/information-flow.zh-CN.md) | **信息与功能流转**：一次派发全链路、Prompt 组装顺序（现状 vs 前稳后动）、问答闭环、Dream 三条路径与双链强弱信号治理流转图 |
| [`specs/design-language-and-ui.md`](specs/design-language-and-ui.md) | `src/styles/` 分层架构、`--ad-*` token、默认左对齐、5 页设置秩序与验收矩阵 |
| [`specs/ui-language.md`](specs/ui-language.md) | `t()` 写法、不翻译边界与菜单栏 `labels` 同步 |
| [`specs/acp-integration.zh-CN.md`](specs/acp-integration.zh-CN.md) | 新 Agent 接入原则、协议接法与会话隔离边界 |
| [`specs/shared-memory.md`](specs/shared-memory.md) | Dreaming 单向共享文件、Git 提交范围与 Companion 联动契约 |
| [`specs/dream-memory-handoff-2026-11-26.zh-CN.md`](specs/dream-memory-handoff-2026-11-26.zh-CN.md) | **Dream 升级专项交接（2026-11-26）**：不拆插件架构决策、方向 1–5 融合对照、三阶段改动台账、OKF v0.2 + 图谱契约、CLI/MCP 速查、实机备份回滚与待办 |
| [`specs/pitfalls-and-lessons.md`](specs/pitfalls-and-lessons.md) | Obsidian API、长日志性能、ACP/子进程与标题保护硬坑 |
| [`specs/spec-change-template.md`](specs/spec-change-template.md) | 契约/边界变更核对清单 |
| [`specs/fractal-boards-roadmap.md`](specs/fractal-boards-roadmap.md) | 后续方向：WorkFlowy 分形看板（意义、大纲/Harness/双链实现路线与红线） |
| [`specs/harness-delta-2026-11-18.zh-CN.md`](specs/harness-delta-2026-11-18.zh-CN.md) | 单批增量说明（文本 harness 视角）：这一轮新增了什么、因此能做到什么、回复协议的设计意见 |
| [`specs/dream-shared-memory.md`](specs/dream-shared-memory.md) | **方向草案**：Dream 记忆按条共享（scope/audience、发布层、MCP 接入、撤销红线），参照 Notion 的 MCP + personal memories 模型 |
| [`specs/teleagent-adapter.zh-CN.md`](specs/teleagent-adapter.zh-CN.md) | 已合入 1.13.20（P0 只读追踪 + P1 复制交接与 Windows UIA / Linux `xdotool` 填入式派发）：TeleAgent（星辰超级智能体）本地 SQLite 契约、`SUPER_AGENT_APP_DATA_DIR`、多账号发现与附件路径剥离；P2 深链与状态增强未实现 |
