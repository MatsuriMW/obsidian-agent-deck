# Agent Deck 交接状态与速查

基线：**1.9.8**（准备发版）｜ Linear：[P-MAT-42](https://linear.app/matsurimywaifu/project/agent-deck-obsidian-插件-01b0285aef2b)

## 双平台验证边界

| 平台 | 已验证范围 | 未覆盖 / 已知代码缺口 |
| --- | --- | --- |
| **macOS** | 全量 `npm test`、构建、Vault 热重载、Dashboard、标题保护、token 显示、Qoder CLI 同会话 | 终端交互仅实测 Tern / Herdr；7 家客户端全量委派未逐一复测 |
| **Windows** | 尚未实机运行验证 | `src/delegation.js`（`findBin` / `pickTerminal` / `openTerminal` / `osa`）与 `src/main.js`（`openTerminalAt`）仍依赖 macOS `osascript`/终端；`src/readers.js` 在 `win32` 跳过 `claudeDesktop`；CLI 探测与路径短链待实测 |

## 活跃 Backlog（均未排期）

| 事项 | 范围与边界约束 | 参考 Spec / 模块 |
| --- | --- | --- |
| **AI 记录母块视图切换**（[MAT-623](https://linear.app/matsurimywaifu/issue/MAT-623)） | 顶层 AI 母块尾部改为视图切换（首版「大纲／表格」），底层 Markdown 不重写、各块记住偏好 | `design-language-and-ui`、`src/editor.js`, `src/ai-records.js`, `src/record-display.js`, `src/fold-actions.js` |
| **Grok Bot（Sand）追踪** | 读取 `bot-sessions.json` 与 `session.jsonl`，按 Bot 多选过滤并与 Claude Code 共用会话去重 | `src/constants.js`, `src/readers.js`, `src/settings.js`, `src/view.js` |
| **Pi 支持 & 委派/块级粒度** | Pi 接入、委派卡片选模型/强度/记录粒度并记住偏好、已有 AI 块单独调粒度 | `acp-integration.zh-CN`、`src/delegation.js`, `src/dialog.js`, `src/ai-records.js`, `src/autolog.js` |
| **技术债复核**（[MAT-479](https://linear.app/matsurimywaifu/issue/MAT-479)） | 逐项核实遗留问题状态并决定重构边界 | `src/readers.js`, `src/sync.js`, `src/view.js` |
| **Windows 端适配** | 替换 `osascript`/POSIX 路径假定，打通终端唤醒、桌面交接与 WorkBuddy 自动发送 | `src/delegation.js`, `src/main.js`, `src/readers.js` |

## 操作速查（同步至库内 `README-交接.md`）

- **快捷键**（macOS `Alt` = `Option`）：`Ctrl+Alt+D` 委派/任务菜单 · `Ctrl+Alt+A` 续聊/停止/重派 · `Ctrl+Alt+C` 查看与保存对话 · `Ctrl+Alt+N` 下一条待确认 · `Ctrl+Alt+X` 停止执行 · `Ctrl+Alt+J` 跳到「正在做」 · `Ctrl+Alt+L` 整理日志 · `⌃⌥⌘D` macOS 菜单栏。
- **关键词**：`DOING` / `NOW` / `IN-PROGRESS`、`TOREVIEW`、`NEEDOK`、`ERRORED` / `FAILED`、`HITLIMIT`、`QUEUED`、`DELEGATED`、`TODO` / `LATER`、`PAUSED` / `SUSPENDED`、`WAITING` / `WAIT`、`DONE`、`CANCELED` / `CANCELLED`、`TODOFORAI` / `TODO4AI` / `TODO2AI` / `TODOTOAI`，及 `[ ]` `[/]` `[x]` `[-]`。
- **整理与归档**：**整理日志**默认按 `---` → 正在做 → `---` → 还要做 → `---` → 已完成 → `---` 排列，只整理完整分区内的 **AI** 条目，非 AI 手写条目与区外笔记保持原位；无完整分区时只建立空分区。**归档已完成的日志到…** 仅移出已完成 **AI** 块（默认 `Agent Deck/done/已完成任务.md`），先写归档再删源。

## 本地修改（2026-11-15，1.9.8）

- 常用设置保留在各区域外层，低频细节收进默认折叠的“更多设置”。
- 结论字数默认 350，旧默认 240 迁移一次，保留其他自定义数值。后台回答单独按 500 字分流，不调用额外总结模型。
- 新自动记录写入明确分区。旧版有完整分割线的区域可迁移，区外任务不自动搬入。
- 螺旋日程已删除 AI 写入旧开关；移除 Agent Deck 的旧归属判断和停用按钮。
- 后台回答不超过 500 字直接回写完整原文；超过时返回 `Agent Deck/Answers/` 中的完整问答文件。清理内部块号、定位标识、追踪注释，保留正文代码与链接。
- 后台任务不显示行尾 pill；进度在母块下方显示一次，保留取消、重试和授权入口，回答结束后隐藏 Agent Deck 补充的状态行。
- 已复核 `pitfalls-and-lessons.md`，更新后台总结的过时规则，其余当前约束保留。
- 本轮 macOS 验证：完整 `npm test`、构建、双仓库 `git diff --check` 通过；两插件已热重载。实际调用整理命令验证区外原文及空白保留、重复整理不变、空分区初始化和新记录入区。临时验收笔记已删除。Windows 未实机验证。

- 后台输出专项已通过 macOS 实测：短回答完整回写、长问答无追踪标识、单条进度、取消及重试入口、回答后无行尾 pill。未调用真实模型；临时笔记、文件和测试任务已清理。
- **Cursor 桌面端追踪（[MAT-622](https://linear.app/matsurimywaifu/issue/MAT-622)）**：已实现 Cursor Desktop `3.30.14+` 仅追踪集成（`src/cursor-sessions.js`, `src/readers.js`, `src/conversation.js`, `src/conversation-modal.js`, `src/settings.js`, `src/main.js`, `src/journal.js`, `src/delegation.js`, `src/menubar.js`, `src/menubar.swift`, `assets/agents/cursor.png`）。设置页 `来源与扫描 → 更多设置` 提供 Cursor Hooks 安装/更新/卸载；`fs.watch` 去抖触发增量扫描；仅 Cursor 对话视图与 Markdown 归档包含工具调用时间线（长结果折叠 + 缺失结果标注）。macOS 已通过 `npm test`（含 `test/cursor-sessions.test.mjs`）、`npm run build`、`swiftc -typecheck src/menubar.swift`、`git diff --check`；Windows 尚未实机验证（Hooks 安装依赖可用 `node`，SQLite 元数据仅在存在 `/usr/bin/sqlite3` 的环境可用，未包含 `win32` 端到端实测）。
- **AI 自动记录项目名前缀 & 侧栏「最近的会话」改版**：工作区文件夹下的新建 AI 自动记录（全 Agent 适用）统一生成 `项目名 -> 生成的标题`（`src/readers.js` `sessionProjectName`、`src/journal.js` `formatProjectAutoTitle`/`prefixAutoTitle`、`src/autolog.js`），单开/内置暂存会话及手动修改标题不变；侧栏「最近的会话」（`src/view.js`、`src/constants.js`、`styles.css`、`src/locales/en/view.js`）支持 `7 天 / 30 天 / 120 天` 切换（持久化 `settings.ui.recentDays`）、全部视角同 Agent 默认叠放仅露最新 1 张且可多组同时点击展开（展开/收起锚定组顶部位置并按需用 `--ad-slack` 防止高处横条因高度骤减被夹紧下跳，向上滚动时自动收回余量）、单 Agent 筛选平铺，页面同时严格最多渲染 `30` 张会话卡片。macOS 已通过 `npm test`（含 `test/recent-panel-and-prefix.test.mjs`）、`npm run build`、`git diff --check`；Obsidian 界面视觉样式与 Windows 实机待后续手动复验。
- **原生点击折叠 & 整理日志 AI/非 AI 区分**：`src/record-display.js` 中 `aiRecordUnfoldExtension` 改为仅展开 AI 记录内部（`g.records[0]` 起），不再误撤母项与 `logseq-style-fold` 的原生折叠（避免闪回）；`guardHiddenTail` 在非 `expanded` 模式下拦截已展开 AI 记录块的原生 `foldEffect` 并改为按 Agent Deck 当前模式收起（`latest1`/`latest3`/`latest5`/`collapsed`），再次点击或非 AI 条目仍按 Obsidian 原生折叠。`src/organize-journal.js`（`planBoundedJournal` 按分区各自保留 `rest`、`planJournal` 对非 AI 条目跳过分类移动）改为仅对 AI 记录条目生效；`src/journal-layout.js`（`readJournalLayout`）兼容分区标题注释与 `##` 之间手写行及缺失末尾 `layout:end` 注释的恢复。macOS 已通过 `npm test`、`npm run build`、`git diff --check` 及 `马自立` Vault 真实日记实测验证（Windows 待后续实机验证）。
