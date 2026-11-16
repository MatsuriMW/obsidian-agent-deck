# Agent Deck 交接状态与速查

基线：**1.10.2**（已发版）｜ Linear：[P-MAT-42](https://linear.app/matsurimywaifu/project/agent-deck-obsidian-插件-01b0285aef2b)

## 双平台验证边界

| 平台 | 已验证范围 | 未覆盖 / 已知代码缺口 |
| --- | --- | --- |
| **macOS** | 全量 `npm test`、构建、Vault 安装与热重载（`1.10.2`）、Dashboard、标题保护、token 显示、Qoder CLI 同会话 | 终端交互仅实测 Tern / Herdr；7 家可委派客户端全量派发与 Obsidian 新版界面抽查未逐一复测 |
| **Windows** | 尚未实机运行验证 | `src/delegation.js`（`findBin` / `pickTerminal` / `openTerminal` / `osa`）与 `src/main.js`（`openTerminalAt`）仍依赖 macOS `osascript`/终端；`src/readers.js` 在 `win32` 跳过 `claudeDesktop`；CLI 探测与路径短链待实测 |

## 活跃 Backlog（均未排期）

| 事项 | 范围与边界约束 | 参考 Spec / 模块 |
| --- | --- | --- |
| **Pi 支持 & 委派/块级粒度** | Pi 接入、委派卡片选模型/强度/记录粒度并记住偏好、已有 AI 块单独调粒度 | `acp-integration.zh-CN`、`src/delegation.js`, `src/dialog.js`, `src/ai-records.js`, `src/autolog.js` |
| **Muse 追踪接入**（[MAT-629](https://linear.app/matsurimywaifu/issue/MAT-629)） | 实现对 Muse 会话的只读追踪、状态与对话读取 | `src/readers.js`, `src/agent-ingestors.js`, `src/constants.js` |
| **Claude CLI 对话追踪复核**（[MAT-630](https://linear.app/matsurimywaifu/issue/MAT-630)） | 全链路排查并确认 Claude Code CLI 对话追踪（日志发现、状态、轮次同步与查看）可稳定跑通 | `src/readers.js`, `src/agent-ingestors.js`, `src/conversation.js` |
| **技术债复核**（[MAT-479](https://linear.app/matsurimywaifu/issue/MAT-479)） | 逐项核实遗留问题状态并决定重构边界 | `src/readers.js`, `src/sync.js`, `src/view.js` |
| **Windows 端适配** | 替换 `osascript`/POSIX 路径假定，打通终端唤醒、桌面交接与 WorkBuddy 自动发送 | `src/delegation.js`, `src/main.js`, `src/readers.js` |
| **WorkFlowy 分形看板与多 Agent 编排** | 父块原地大纲↔看板双视图投影、Zoom/双链 Harness 上下文边界、同盘多 Agent 协同、单源镜像 | [`fractal-boards-roadmap`](specs/fractal-boards-roadmap.md)、`src/record-display.js`, `src/harness.js`, `src/agent-registry.js` |
| **Dashboard 任务闭环与阻塞分析**（[MAT-625](https://linear.app/matsurimywaifu/issue/MAT-625/agent-deck-dashboard日记任务闭环率与阻塞状态分析联动分形看板)） | 统计同期 AI 关联任务状态分布（`DONE`/`TOREVIEW`/`NEEDOK`/`ERRORED` 等）、任务闭环率与阻塞项，联动分形看板 | `src/journal.js`, `src/analytics.js`, `src/dashboard-data.js`, `src/dashboard.js` |

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
- **AI 记录母块视图切换（[MAT-623](https://linear.app/matsurimywaifu/issue/MAT-623)）**：最顶层 AI 自动记录母块行尾不再显示 `GripWidget` 委派小箭头，改为 `ViewToggleWidget` 视图切换入口（支持「大纲／表格／卡片／时间线」并保留「任务操作…」菜单入口），非顶层子回复行与普通任务保持原有委派把手。视图偏好按块持久化于 `settings.aiRecordViews`（`src/constants.js`），不重写底层 Markdown；`RecordViewWidget` 与 `buildTableModel`（`src/ai-records.js`、`src/record-display.js`）复用 `visibleTableEntries` 遵循原有显示范围与折叠开关，将同轮 `❓`/`💬` 配对、仅在有值时显示「任务 / 提问」列、把 `⏱`/`🔗` 收至共享底栏、支持行内展开非任务深层子块（触发 `view.requestMeasure()`），并支持点击任意视图条目切回大纲并定位原块编辑。范围限定 CM6 编辑视图，阅读视图仍保留大纲模式。macOS 已通过 `npm test`（含 `test/record-views.test.mjs`）、`npm run build`、`git diff --check` 及 `马自立` Vault 真实日记实测验证；Windows 与阅读视图渲染暂未覆盖。
- **对话弹窗改版 & 语义化归档命名**：`ConversationModal` 与 `AcpPermissionModal`（`src/conversation-modal.js`、`styles.css`）统一采用 `.ad-modal` 设计语言（Agent 徽章、项目/会话元信息、`17px` 标题、Lucide 按钮层级）；`conversationTitle` 与 `conversationPath`（`src/conversation.js`、`src/conversation-modal.js`）从会话标题或首条提示词提炼可读标题并附 8 位短哈希（如 `Agent Deck/Conversations/<语义标题>-<agent>-<hash8>.md`），避免裸 `antigravity-<uuid>` 作为标题与文件名。
- **Dashboard 视觉与排序优化 & 高价值微重构（1.9.9）**：
  - `src/dashboard.js` 与 `styles.css` 在「Agent 分布」、模型/项目明细及记录明细中统一采用 `agentIcon` 图标；「项目投入」支持按 `Token / 耗时 / 会话 / 名称` 与「顺序 ↑ / 倒序 ↓」切换及表头排序，并以 `projectsMaxTokens` 作为进度条基准、复用 `analytics.js` 预计算的时段 `range`。
  - 抽出共享只读大纲/双链模块 `src/outline.js`（由 `journal.js` / `harness.js` / `analytics.js` / `dream.js` 复用），抽出可扩展日志解析注册表 `src/agent-ingestors.js`（由 `readers.js` 委托）和委派 Runner 注册表 `src/delegation-runners.js`（由 `delegation.js` 委托）；macOS 已通过全量 `npm test` 与 `npm run build`（Windows 未实测）。
- **AI 记录多视图与多格式导出优化**：
  - 将会话轮次时间戳解析与格式化（`trackedBlockIds`、`blockSessionMap`、`collectGroupSids`、`roundStartedAt`、`localDayKey`、`formatTimelineAt`、`formatTimelineFull`）抽至 `src/ai-records.js`，由 `src/record-display.js` 与 `src/task-export.js` 复用（零循环依赖）。
  - 保留顶层 AI 自动记录母块行尾单一 `ViewToggleWidget` 入口，视图菜单内的「导出」子菜单（`populateRecordExportMenu` in `src/main.js`）自动携带当前 `viewMode`。
  - `src/task-export.js` 支持按当前视图（大纲 / 表格 / 卡片 / 时间线）导出 PDF 与独立 HTML（展开全部子项、保留时间线时间戳与手写附注）；新增无损导出 Markdown (`.md`)、结构化 JSON (`.json`)、UTF-8 BOM CSV (`.csv`)，以及复制为 Markdown、Markdown 表格、纯文本与 JSON；原移出式保存明确为「另存为并移出原文…」。
  - 验证边界：macOS 已通过全量 `npm test`（含 `test/task-export.test.mjs`、`test/record-views.test.mjs`、`test/i18n.test.mjs`、`test/architecture-refactor.test.mjs`）、`npm run build`、`git diff --check`；Obsidian 真实 PDF 渲染与 Windows 端未实测。
- **Claude CLI `env` 认证修复（[Issue #4](https://github.com/MatsuriMW/obsidian-agent-deck/issues/4)）**：`src/llm.js` 中 `runClaude()` 将 `--setting-sources` 由 `project` 调整为 `user,project`，使配置在 `~/.claude/settings.json` `env` 中的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 可被子进程正常加载；同步补全 `JOURNAL_PROVIDERS.claude.loggedIn`（`hasClaudeSettingsAuth`），识别 `env.ANTHROPIC_AUTH_TOKEN` 及 `~/.claude/settings.json` `env` 中的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 避免自动探测误判未登录（已补 `test/llm.test.mjs` 单测与 macOS 测试/构建）。
- **CSS 分层模块化与 Spec 同步（`1.9.10`）**：将根目录 `styles.css` 拆分为 `src/styles/`（`index.css`、`base/{tokens,atoms,controls,motion}.css`、`views/{dashboard,dashboard-cards,editor,record-views,settings,modals,review}.css`）并接入 `esbuild.config.mjs` 打包；同步更新 `AGENTS.md`、`docs/README.md`、`docs/specs/architecture-and-boundaries.md`（补充仓库目录结构、CSS 层与 `settings-agents.js`）、`docs/specs/design-language-and-ui.md`、`docs/specs/data-and-markdown-contracts.md`（修正 `USAGE_CACHE_VERSION = 10`）。macOS 已通过 `npm test`、`npm run build`、`git diff --check`；Obsidian 界面视觉复验与 Windows 实机待后续补充。
- **跨模块复用与去重清理（`1.9.10` 本地上限后微调）**：
  - 记录解析与视图/导出：`src/journal.js` 导出 `RECORD_ICON_RE`、`RECORD_PROVENANCE_RE`、`RECORD_PROVENANCE_LINE_RE`、`isLegacyBlockId`、`stripTaskKeyword`、`stripInlineTitleMarkup`、`stripBoundSessionSuffix`，统一 `src/llm.js` / `src/analytics.js` / `src/conversation.js` / `src/dream.js` 的清洗规则；`src/ai-records.js` 导出 `RECORD_MARKER_BODY_RE`、`RECORD_VIEW_LABELS`、`recordViewLabel`、`recordBadgeLabel`、`recordStepLabel`、`timelineSpanMeta`、`footerMetaText`、`buildGroupTableRows`、`tokenizeInlineMarkdown`，由 `src/record-display.js` 与 `src/task-export.js` 共用，并抽出 `prepareExportTarget`。
  - 委派探测与 Runner 生命周期：`src/delegation-runners.js` 合并 6 处 CLI 查找为 `findAgentBinary(agent, configured)`（保留 `find*Binary` 兼容包装并由 `src/delegation.js` / `src/main.js` 复用），并提取 `BaseRunner` 统一 `ClaudeRunner` / `QoderRunner` / `AcpRunner` 的 `cancel` / `done` / `fail` 结束流程。
  - 设置页与样式层：`src/settings.js` 新增 `rowToggle` / `rowSelect` / `rowSegmented` / `rowText` / `rowNumber` 与回调式 `row()`，消除 101 处 `:scope > .ad-row__right` DOM 查询，合并「AI 整理模型」与「Dreaming 模型」共用的来源/预设/API/推理强度/测连渲染；`src/styles/` 将控件尺寸变量、轻量按钮重置与可折叠 `<details>/<summary>` 三角样式收口到 `base/tokens.css` 与 `base/atoms.css`，减少 `views/settings.css` / `base/controls.css` / `views/modals.css` 的同构覆盖补丁。
  - 验证边界：macOS 已通过全量 `npm test`（含 `architecture-refactor.test.mjs` 零循环检查与 `i18n.test.mjs`）、`npm run build`、`git diff --check`；Obsidian UI 实机视觉抽查与 Windows 端未实测。
- **Grok Bot 桌面会话追踪（[MAT-626](https://linear.app/matsurimywaifu/issue/MAT-626)） & AI 记录规则层**：
  - Grok Bot（`com.anysphere.sand` 1.1.0）仅追踪集成：`src/grok-bot-sessions.js` 按真实持久化目录 `~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`（unpadded lowercase Base32 `roster.last-roster` + `transcript.replicas.<botId>`）读取；`grokBotTrackedBotIds` 默认全不选，在「记录 → 来源与扫描」的 Grok Bot 条目内折叠多选（隐藏 Bot 默认收起）；云端沙箱无本地逐条 token/模型，保留为 `0`/未提供；自动记录标题统一为 `Bot名 -> 实际生成标题`，无客户端归档，默认超过 `autoLogGrokBotDoneMinutes`（120 分钟）无新对话自动标为 `DONE`；`USAGE_CACHE_VERSION` 递增至 `11`。
  - AI 记录格式规则层：`DEFAULT_RECORD_RULES` / `resolveRecordRules`（`src/constants.js`）收口 `boldTitle`（默认 `true`，仅新写/重建 AI 自动记录母块标题自动加粗 `**...**`，`preserveTitle` 与委派子项不加粗）、`projectPrefix`（默认 `true`）、`showTimeRange`（默认 `true`）与 `titleMax`（默认 `22`），并在「设置 → 记录 → 日记与归档 → 更多设置 → 记录规则细则」开放用户微调（联动 `journal.js`、`autolog.js`、`main.js`、`bindInto`）。
  - 验证边界：macOS 已通过全量 `npm test`、`npm run build`、`swiftc -typecheck src/menubar.swift`、`git diff --check` 及本机真实 `sand-client-persistence` 目录只读解析校验；Obsidian 界面抽查与 Windows 端未实测。
- **P0/P1 项目协作工作台与分形看板（`1.10.0` 合入 `main`）**：
  - **P0 按项目聚合多 Agent 进程管理**（`src/project-workbench.js`, `src/view.js`, `src/main.js`, `src/styles/views/dashboard-cards.css`）：侧栏「现在」默认支持「按项目 / 列表」视图切换（`settings.ui.nowGroupBy`），将同项目多 Agent 会话与未就绪委派任务收拢到可折叠 `.ad-projgroup` 卡片（未生成 `sessionId` 的待认领任务点击直达原笔记行），展示参与 Agent 徽章与在跑/等你/异常计数，并提供打开项目目录（`openProjectFolder`）、项目级一键停止（`cancelProjectJobs`）与工作台入口；「最近的会话」新增「按 Agent / 按项目」分组切换（`settings.ui.recentGroupBy`）。
  - **P1 协作小队预设、AI 副驾拆解与完整分形看板（阶段 A / B / C）**（`src/workbench-modal.js`, `src/fractal-board.js`, `src/harness.js`, `src/outline.js`, `src/analytics.js`, `src/dream.js`, `src/editor.js`, `src/styles/views/record-views.css`, `src/styles/views/modals.css`）：
    - `ProjectWorkbenchModal`（命令面板/侧栏项目卡/任务操作菜单均可唤起）：支持选择写入目标笔记（今日日记 / 当前笔记 / 自定义路径）、5 套内置协作小队预设（全栈/排错/调研文档/深度研报/深度写作，自动规避禁用与 `limit` 限额 Agent 并保存项目偏好）、`runJournalModel` 副驾结构化拆解与无模型本地兜底、多 Agent 并发默认优先后台执行（`background`）；写入时自动归入日记「正在做」活跃分区（若存在）并为每条子任务预分配唯一 `^blockId`，并发派发自动携带同看板兄弟分工上下文并打开目标笔记。
    - 原地分形看板（`src/fractal-board.js`, `settings.taskBoardViews`）：支持 `按状态分列`（`TODO`/`DOING`/`待确认`/`DONE`）与 `按子组分列`（子任务为列、孙任务为卡）双模式切换、任意嵌套子卡下钻聚焦（Zoom + 面包屑回溯）、顶栏进度条、看板内快捷新增子卡（`+ 子卡`，隔离 CM6 按键与拖放事件）、行内 `@agent` 切换、跨列/同列子树拖拽排序（`moveTaskBoardCardSubtree`）、以及在卡片内直接查看正文/停止运行/单卡派发。
    - Harness 上下文作用域与镜像硬隔离（`src/harness.js`, `src/outline.js`, `src/analytics.js`, `src/dream.js`）：委派自动解析最多 3 处 `[[双链]]`（`#^blockId` 定点块子树、`#标题` 章节、`![[...]]` 镜像嵌入、别名保留，同目标去重；定点块/章节缺失或笔记不可读时跳过而不注入整篇开头，自定义解析器补入的 `refs` 一并纳入），注入同看板兄弟分工上下文（`buildBoardSiblingContext`），并经 `stripInternalIdentifiers` 剥离内部 `^ad-*` 与 `<!-- ad-* -->` 标记；看板支持 `![[笔记#^blockId]]` / `[[笔记#^blockId]]` 只读镜像卡投影（状态切换回写源笔记），`analytics.js` 与 `dream.js` 显式排除独立镜像行以防重复计数与重复抽取。
  - **交互示例笔记**：`src/welcome-demo.js`（`SHOWCASE_VERSION = "1.10.0"`）支持首次升级自动打开中英文纯文本模拟看板与四视图示例笔记，命令面板可重开，不影响统计与追踪。
  - 后续已暂存 Linear `P-MAT-42`：`MAT-628`（P3：第二大脑显式项目上下文包 Context Pack 与记忆反哺闭环）、`MAT-629`（Muse 会话追踪）、`MAT-630`（Claude CLI 对话追踪复核）。
- **项目聚合去重、子代理归属继承、待处理降噪与英文兼容（`1.10.1` 已发版）**：
  - `src/readers.js`（`normalizeProjectRoot`、`disambiguateProjectLabels`、`isScratchCwd` 支持 `/Codex/YYYY-MM-DD/...` 多级临时目录、`_resolveParentInfo` 为 `liveSessions`/`sessions`/`summary` 补充 `parentCwd`；`USAGE_CACHE_VERSION = 12`、`SUMMARY_VERSION = 3`）与 `src/project-workbench.js`（`buildProjectGroups` 按规范化路径聚合、仅在同名不同目录时追加父级区分名并隔离 `id`、`resolveProjectIdentity` 通过 `parentSid`/`parentCwd` 继承母会话项目）消除同名不同路径串项目及 `default-workspace` 子代理落入「独立会话」问题。
  - `src/agent-ingestors.js`（DSH `turn/end` 与 Codex `task_complete` 在 `parentSid`/`delegationDepth > 0` 子代理正常结束时收口为 `done`、中断/中止 `aborted` 收口为 `cancelled`）与 `src/project-workbench.js` / `src/view.js` / `src/main.js`（`isWaitingSession` / `isActiveNowSession`：排除子代理 `wait`/`quiet` 及超过 `WAIT_ACTIVE_MS = 30m` 的历史正常结束会话，保留 `needs-approval` / `queued` / 活跃任务，同步更新「现在」「等你」筛选与 macOS 菜单栏等待计数）。
  - `src/ai-records.js`、`src/welcome-demo.js`、`README.en.md`、`LICENSE` 与 `assets/`：补齐英文 `Round N: Task: ...; Result: ...` 记录解析、英文截图与品牌图标资源，规范化 Apache-2.0 `LICENSE` 版权声明。
  - 验证边界：macOS 已通过全量 `npm test`、`npm run build`、`git diff --check`，GitHub Release `1.10.1` 构建发布成功，并已安装至 `马自立` Vault 完成热重载；Obsidian 真实界面交互复验与 Windows 端未实测。
- **自动记录关键词状态区分（`1.10.2` 已发版）**：
  - `src/autolog.js` 与 `src/locales/en/writers.js`：不新增关键词，复用现有 `AGENT_KWS`；`AutoLog` 在会话处于 `needs-approval` / `error` / `limit` / `queued` 时写出 `NEEDOK` / `ERRORED` / `HITLIMIT` / `QUEUED`，在模型判定 `done: true` 且闲置时切为 `TOREVIEW`，正常停顿保留 `PAUSED`（续聊恢复活跃后自动切回 `DOING`）。
  - 验证边界：macOS 已通过全量 `npm test`（含 `test/autolog.test.mjs`、`test/i18n.test.mjs`）、`npm run build`、`git diff --check`、GitHub Release `1.10.2` 与 `马自立` Vault 安装热重载；Obsidian 实机与 Windows 端未实测。
