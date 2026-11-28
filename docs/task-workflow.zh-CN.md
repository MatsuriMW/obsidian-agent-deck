# Agent Deck 交接状态与速查

基线：**1.13.42**（2026-11-28）｜ Linear：[P-MAT-42](https://linear.app/matsurimywaifu/project/agent-deck-obsidian-插件-01b0285aef2b)

## 1.13.42 记忆图谱来源修复与近期功能双平台回归（2026-11-28）

- Windows Server 2025 x64 和 macOS arm64 的 Obsidian 1.15.1 都复现了图谱来源节点误建带双链括号的笔记。macOS 还复现了记忆详情的普通块链接只打开笔记开头。现在两处共用已存在的笔记解析，保留块或标题锚点，失效来源仅提示找不到笔记。
- Windows Server 2025 x64 和 macOS arm64 各实跑两轮。覆盖图谱来源、空筛选和缩放、Codex 活动 WAL 和带 BOM 的 JSONL、日记首次引导及占位符写入、任务镜像和进度上下文、五页设置及总结预览、示例笔记、MCP 工具范围和设置页握手、插件重载。Windows 另验证了真实子进程树清理和 Antigravity `.cmd` 的长文本传输。macOS 另安装 Nautilus Spiral 2.6.18，验证双向日记设置同步、任务镜像和会话快照。[Windows x64 验证日志](https://github.com/MatsuriMW/obsidian-agent-deck/actions/runs/46114686517)
- Windows 11 ARM64 验证机运行原生 ARM64 Obsidian，13 项实机操作全部通过。Windows Server 2025 x64 的完整测试、上下文评估、构建和部署检查也通过。[Windows 11 ARM64 与 Windows x64 全量日志](https://github.com/MatsuriMW/obsidian-agent-deck/actions/runs/46114907255)
- 专用测试库使用本地 HTTP 回执和 CLI 探针覆盖总结及传输。Windows 11 x64 用户桌面、Windows 上的螺旋日程联装和第三方账号登录留待实测。

## macOS 和 Windows 主力终端适配（2026-11-28）

- Windows 接入 WezTerm、Warp、Alacritty、Tern、Herdr 与 WSL tmux。三个终端入口沿用原工作目录，单独传递 PowerShell 委派脚本路径及普通命令，启动失败时依次尝试 `wt.exe`、`cmd.exe`。Windows 下拉框只列已接入的选项。macOS 支持截图中的全部终端类型，补齐用户目录应用包查找，并在 Tern 启动失败时回退到系统终端。
- Windows tmux 使用已启用 Windows 互操作的默认 WSL 发行版。该发行版需要安装 tmux，并能从 `PATH` 找到 `powershell.exe`。任务和恢复命令运行 Windows Agent CLI，沿用 Windows 会话数据。
- Windows PowerShell 5.1 委派脚本使用 UTF-8 BOM，确保中文安装路径能被解析。普通命令通过 CMD 的原始参数尾部传递，保留带引号的程序路径和参数。
- macOS arm64 上 `npm test`、`npm run eval`、隔离 `npm run build`、`npm run check:deploy` 和 `git diff --check` 通过。用实际 Obsidian 和独立测试库，经 tmux 跑完两轮打开终端、终端委派和恢复 CLI 会话。此前也在隔离会话中实跑了 Herdr Core 和 Tern。
- Windows Server 2025 验证机用实际 Obsidian、WezTerm 和 Ubuntu WSL 2。WezTerm 和 WSL tmux 各通过两轮，三个入口均在带空格和中文的项目目录执行探针命令。原生 CMD 回归验证了中文、引号和 `&` 参数。WezTerm 使用了适配验证机的 WebGPU 软件渲染配置。Windows 11 用户桌面与其余 Windows 终端的 GUI 待实测。[Windows 验证日志](https://github.com/MatsuriMW/obsidian-agent-deck/actions/runs/46112750724)
- Windows 侧参考 GitHub Desktop 的安装发现和 VS Code 的系统终端回退，macOS 侧对照 OpenInTerminal 的逐终端启动方式。[GitHub Desktop](https://github.com/desktop/desktop/blob/development/app/src/lib/shells/win32.ts) · [VS Code](https://github.com/microsoft/vscode/blob/main/src/vs/platform/externalTerminal/node/externalTerminalService.ts) · [OpenInTerminal](https://github.com/ji4n1ng/OpenInTerminal)

## 1.13.39 首次缺日记统一引导共享策略与设置页顶部 TOC 发版（2026-11-27）

- **跨插件共享策略、首次缺日记引导与设置页 5 页顶部 TOC（`src/journal-policy.js`、`src/journal-setup-modal.js`、`src/main.js`、`src/autolog.js`、`src/organize-journal.js`、`src/settings.js`、`src/styles/views/{modals,settings}.css`、`src/locales/{en/dialogs,en/settings,zh-TW}.js` + 配套 `nautilus-spiral` `2.6.16`）**：
  - 当检测到今日日记尚未创建且用户尚未设定创建策略（`journalPolicy.configured !== true`，含老版本升级用户首次触发，保留原开关作为默认预选），通过全局单弹窗互斥锁（`__obSharedJournalPromptState`）仅弹出一个引导窗：支持「自动新建（Obsidian 日记模板 / 指定库内 `.md` 文件 / 手动输入自定义模板 / 空白）」或「自己手动新建（静默等待直到今天日记存在再自动读写）」，以及选择 AI 自动记录区域初始落点（日记末尾 / 开头且自动避开中文与英文 YAML frontmatter / 模板指定标题下 / `{{ai}}` 原位占位符）。
  - 关闭/点「今天先不建」当天不再在后台反复打扰，用户主动点「打开今日日记」「现在整理一次」或写入复盘时可再次唤起；两款插件通过 `getOwnJournalPolicy` / `applySharedJournalPolicy` / `shared:journal-policy-changed` 双向实时同步并各自保留无对方插件时的独立可用性。
  - 修复 `organize-journal.js` 原 `splitFrontMatter` 仅认 ASCII YAML 键导致中文 frontmatter 键（如 `归属库: Note`）无法避让的问题，并在 5 个设置页顶部增加 `.ad-set-toc` 吸顶一键跳转目录（自动展开折叠 `<details>`、>1200px 快速直达、切页回顶）。
- **验证与未测空白（macOS arm64）**：`npm run build && npm test && npm run eval && npm run check:deploy && git diff --check`、`nautilus-spiral` 全套 8 组回归（主库正本 + 公开版）、`马自立` Vault 热重载 + `dev:errors` 以及 5 轮 Obsidian 实机边界测试（模板路径缺省 `.md`/代码块假标题隔离、`CRLF`+缺标题回退末尾+关闭抑制、单插件独立弹窗/隐藏 AI 落点、弹窗期文件抢建防覆盖、双向设置页 DOM 同步与 5 页 TOC 往返滚动）全部在 macOS arm64 通过；Windows 真机 GUI 与弹窗交互未实测。

## 1.13.38 独立结论总结层、设置页整合与日记防抢跑发版（2026-11-27）

- **设置页高信息密度收口（`src/settings.js`、`src/styles/views/settings.css`、`src/locales/{en/settings,zh-TW}.js`）**：将原散落在「日记与归档」及折叠区内的详细程度、4 项字数上限（合并为 4 格紧凑 `.ad-num-grid`）、多轮合并开关与阈值全部迁入「任务结论与总结模型」同一张卡片，突出「总结使用的 Agent / 来源」可独立于委派主力单独配置，并保留 `每轮结论让模型润色`、4 段 `结论总结风格`、自定义提示词模板、`用样例试跑总结` 与错误提示。
- **两轮真实场景加测 & `recordSentence` 修复（`src/journal.js`、`test/conclusion-record.test.mjs`）**：
  - 第 1 轮（6 条全新 `~/.claude/projects/` 与 `~/.codex/sessions/` 会话 × `agy` + `deepseek` × `balanced`/`structured`/`custom` 中英模板）与第 2 轮（`AutoLog.runOnce` → `JournalSync.queueRefineTurn` `brief`/`standard` → `queueMerge` 端到端日记落盘闭环）实测发现 `journal.js` `standard` 模式对已润色 `summary` 仍调用 `recordSentence()` 在首个分号处截断导致多段结构化结论后半丢失；已改为 `summaryText(givenSummary, stdCap)` 并补充单测回归复跑通过。
- **验证与发版边界（macOS arm64）**：`npm run build && npm test && npm run eval && npm run check:deploy && git diff --check`、主库安装热重载及 `dev:errors` 零新增报错均在 macOS arm64 实测；`claude` CLI 本机账号受限未测，Windows 真机 GUI 未实测。

## 1.13.37 用户反馈修复与独立结论总结层（2026-11-27）

- **独立任务结论总结层 `src/conclusion.js`（`src/conclusion.js`、`src/constants.js`、`src/journal.js`、`src/autolog.js`、`src/sync.js`、`src/settings.js`、`src/locales/{en/settings,zh-TW}.js`、`test/conclusion-layer.test.mjs`）**：
  - 将分散在 `AutoLog.ask()` 与 `JournalSync.queueRefineTurn()`/`queueMerge()` 中的总结逻辑收口进零循环依赖独立模块 `src/conclusion.js`（仅单向依赖 `journal.js`/`prompt-text.js`/`llm.js`）。
  - 提供 4 种 `conclusionStyle`（`balanced` 精准完整 / `concise` 极简要点 / `structured` 结构化「改动·结果·遗留」 / `custom` 自定义完整提示词模板 `conclusionPromptTemplate`，支持 `{{task}}`/`{{reply}}`/`{{codeMax}}`/`{{qaMax}}` 并在省略占位符时自动附加任务与回复，支持纯文本与 JSON 双解析并拦截退化短语）；默认上限调整为 `conclusionMaxCode = 90`、`conclusionMaxQA = 200`、`conclusionMaxMerge = 180`、`roundPolishTimeout = 60`（移除旧版 `sync.js` 标准模式 `safeLabel(..., 65)` 与 `journal.js` `stdCap` 120/90 硬截断）。
  - 新增 `prepareReplyForSummary()` 折叠超长代码块（>180 字符）与大表格（>6 行）后再经 `sampleReplyForSummary()` 取头尾双段；在设置页「记录 → AI 整理模型」新增「结论总结风格」「自定义提示词模板 / 补充要求」「用样例试跑总结（`previewConclusion`）」及最近错误提示 `.ad-error-line`，「更多设置」新增「多轮合并总结字数」。
- **日记防抢跑与 Periodic Notes 模板支持（`src/constants.js`、`src/autolog.js`、`src/settings.js` + 配套 `nautilus-spiral` `autoCreateJournal` / `journalInitialContent`）**：
  - Agent Deck 新增 `journalAutoCreate`（「自动创建今日日记」，默认 `true`），关闭后 `AutoLog.runOnce()` 仅写入已存在的日记、不抢在用户自定义模板或 Templater 之前新建空文件；`journalTemplate()` 补充 Periodic Notes 每日模板回退。
  - 螺旋日程同步新增 `autoCreateJournal`（「自动新建今天的日记」）与 `journalInitialContent()`（优先读取核心「日记」/ Periodic Notes 模板）。
- **验证范围与未测空白（macOS arm64）**：
  - `npm test`（含 `test/conclusion-layer.test.mjs`）、`npm run build`、`npm run check:deploy`、`git diff --check`、主库热重载与 `nautilus-spiral` 主库/公开版回归均在 macOS arm64 通过；
  - 真实 CLI 端到端实测：`agy`（`gemini-3.8-flash-low`）与 `deepseek`（`deepseek-chat`）在 5 类场景（复杂编码长回复、问答大表格、半成品报错阻塞、多轮累积合并、本机 `~/.claude/projects/` 2 条真实长会话 × 4 种风格 + `AutoLog.ask()` + `previewConclusion()`）实跑验证（注：本机 `claude` CLI 账号当前受限未测）；Windows 真机 GUI 未实测。

## 1.13.37 跨 Agent 会话标题统一层、零依赖 `node:sqlite` 与设置页整合优化

- **跨 Agent 会话标题统一层与零依赖 `node:sqlite`（`src/sqlite.js`、`src/readers.js`、`src/agent-ingestors.js`、`src/desktop-sessions.js`、`src/cursor-sessions.js`、`src/teleagent-dispatch.js`、`src/main.js`、`test/codex-titles.test.mjs`，`USAGE_CACHE_VERSION = 27`）**：
  - 修复 Codex 标题被覆盖问题：动态探测 `state_*.sqlite` 列结构优先读取 `threads.name`、过滤与 `first_user_message` 镜像一致的伪标题、按数字序挑选 `state_<N>.sqlite` 并移除 30 天截断，按更新时间戳与 `session_index.jsonl`（UTF-8 BOM / CRLF / 同 ID 重命名覆盖）及 `.codex-global-state.{json,sqlite}` 择新合并。
  - 统一全 21 家 Agent 标题层：[`isPlaceholderClientTitle`](src/readers.js) 过滤 `"Side chat"` / `"New thread"` / `"New Maker"` / `"新对话"` 等泛化占位标题；`readClaudeDesktop()` 扩展至至少覆盖 `sinceMs()` 并支持 `titleSource: "user"` 覆盖旧命名；`readDesktopDatabases()` 在 `revision` 未变时亦即时同步重命名；`summary()` 仅采纳 `this.clientTitles.has(sid)` 条目、停止 WorkBuddy/Antigravity/DSH/Kimi Code/Gemini CLI 首句兜底污染 `fc.titles`/`usage.titles`；`resetTitles()` 完整复位标题状态并在局部扫描时同步合并 `clientTitles`/`customTitles`。
  - `src/sqlite.js` 提供 `querySqliteRowsStrict` / `querySqliteRows` / `querySqliteRowsSync`（优先使用内置 `node:sqlite` + `?immutable=1` / `PRAGMA query_only = ON` 并回退 `sqlite3` CLI），统一接管 Codex / WorkBuddy / Cursor、全部 9 家桌面 SQLite Agent 与 TeleAgent 落库校验，彻底消除 Windows 缺少 `sqlite3.exe` 的静默丢数据问题。
- **设置页「Agent 配置 + 模型」合一、标签归位与「记哪几个 Agent」折叠抽屉（`src/settings.js`、`src/agent-registry.js`、`src/constants.js`、`src/styles/`、`src/locales/{en/settings,zh-TW}.js`）**：
  - 将「Agent 配置」与「管理模型」整合为按 Agent 聚合卡片（内嵌默认折叠 `可用模型` 抽屉与跨 Agent 筛选），补齐 T3 Code 配置卡片与 11 项默认/枚举/文案一致性修正；「记忆 MCP」迁至「实验功能」、「AI 协作回顾」迁回「记录 → 展示与维护」；「记哪几个 Agent」改为默认折叠抽屉（实时计数 + `全部关闭 / 全部开启` 不触发折叠）。
- **验证范围与未测空白（macOS arm64）**：
  - **已实机验证**：`npm run build && npm test && npm run eval && npm run check:deploy && swiftc -typecheck src/menubar.swift && git diff --check` 全绿；`马自立` Vault 热重载实测全部 7 条历史错题 Codex 会话恢复真实本地名、Antigravity `agLeak = 0`、`"Side chat"` `sideChatLeak = 0`、设置页三大变更（委派整合、记录页回顾与折叠抽屉、实验功能外部接入卡片）及 `dev:errors` 零新增插件报错。
  - **未测空白**：Windows 端已通过跨平台 `node:test` 模拟 WAL / BOM / CRLF / 缺失 `sqlite3.exe` 验证，Windows 真机客户端与 Obsidian GUI 仍未现场实测。

## 1.13.36 Windows CLI 进程树终止与 `agy` 长提示词流式输入修复

- **Windows CI 与热重载实测暴露并修复的运行故障（`src/security.js`、`src/delegation-runners.js`、`src/main.js`、`test/antigravity-acp.test.mjs`、`test/security-trace.test.mjs`、`test/next-round-fixes.test.mjs`、`.github/workflows/ci.yml`）**：
  - `killChildProcess()` 在 Windows 下改为先执行 `taskkill /PID <pid> /T /F` 终止 `.cmd` 子树、仅在失败且父进程仍存活时回退 `child.kill()`，避免先杀父 `cmd.exe` 导致子孙进程孤儿化并永久锁死 stdio 句柄（同步将 `spawnCapture()` 超时清理切入 `killChildProcess()`）。
  - `AntigravityRunner` 在 Windows `.cmd`/`.bat` 包装器或超长提示词下改用官方 `agy --input-format stream-json --output-format stream-json` 通过 `stdin` 传递完整多行 NDJSON `user` 消息，避免 8191 字符命令行截断与换行丢失；CI 补充 `timeout-minutes: 15`。
  - `primaryAgents()` / `agentEnabled()` / `spiralUsageSnapshot()` 补齐重载窗口期 `this.settings` 与 `_unloaded` 空防护，修复热重载时螺旋日程偶发读取未就绪 `this.settings` 的 `TypeError`。Windows 桌面端 Obsidian GUI 仍属未测空白。

## 1.13.35 多轮压测缺陷清零（macOS 三轮实测 + Windows CI 修复）

- **压测发现并修复**：浅色 Obsidian 下星图暗色模式工具栏/缩放栏/检查抽屉按钮与 badge 泛白 + 长来源路径裁切（显式 `color-scheme: dark` 与高特异度规则）；0 命中筛选空白提示与一键重置、`Esc` 退出聚焦/抽屉；`extractTaskProgress()` 剥离裸 URL 防止 `1/3`/`50%` 误匹配；`mcp-clients.js` 非 Windows 目标 `displayPath` 统一正斜杠通过 `windows-latest` CI。Windows 桌面端 Obsidian GUI 仍属未测空白。

## 1.13.34 记忆知识图谱视觉与布局重构、跨平台 CI 修复（macOS 实测）

- **记忆图谱排版与双主题重构（`src/memory-graph-data.js`、`src/memory-graph-view.js`、`src/styles/views/memory-graph.css`、`test/memory-graph-view.test.mjs`）**：
  - 屏幕空间 LOD + 贪心 AABB 碰撞剔除与磨砂胶囊标签（`shortLabel` 默认 14 字、缩放 `< 1.35` 自动隐去边缘单条标签防重叠）；度数缩放概念宝石与去虚线实心/半透明记忆球体；无项目大库（`unassignedCount >= 12`）在聚类视图按 `fact / preference / lesson / pattern` 自动拆出语义岛；新增「编辑室（暖纸墨）」与「星图（深海星空与星座环，独立于 Obsidian 明暗主题）」清晰对比及右下角缩放浮动栏（`−` / `适配视野` / `+`）。
  - 修复 `test/mcp-clients.test.mjs` 第 178 行 `windows-latest` 下 POSIX `chmod 0o644` 测试断言，并已在 macOS `马自立` 主库实机四视图截图验收；Windows 真机 GUI 交互尚未实测。

## 1.13.33 镜像桥接与任务进度承接（macOS 验证）

- **公共镜像块解析/回写桥与任务进度保留（`src/main.js`、`src/journal.js`、`src/harness.js`、`src/locales/{en,zh-TW}`）**：
  - `AgentDeckPlugin.resolveMirrorLine(rawLine, sourcePath)` / `updateMirrorBlock(mirrorRef, mutateLine)` 基于 `outline.js` `parseMirrorRef`、`journal.js` `findTaskByBlockId` 与 `note-updates.js` `updateNote` 对 `- ![[笔记#^块号]]` 提供跨插件统一解析、围栏跳过、换行符保留与严格幂等回写（复用给 `nautilus-spiral` 展开/同步日记镜像条目）。
  - `extractTaskProgress()` 识别行内 `25%`/`进度 40%`/`1/3`/`一半`（忽略代码/注释/双链/日期），并在 `buildDelegationPayload()` 中仅当 `1 <= pct < 100` 时注入「基于已有进度继续」提示；`test/next-round-fixes.test.mjs` 与 `test/harness-context.test.mjs` 回归锁定。

## 1.13.32 非侵入子块拖拽绑定、Pin 视觉突出与 AI 自动记录操作指南

- **拖拽绑定默认挂为非侵入子块 & 纯子块 `⏱` 模式补齐 + 螺旋日程 `🤖` 子块联动适配（2026-11-26）**：
  - `src/journal.js` / `src/editor.js` / `src/view.js` / `src/main.js`：`dropKind` / `bindInto` 对已有列表项默认返回 `kind: "child"`，在目标日注下挂出缩进 `🤖` 子块并零侵入保留母块原文；挂在日注下的 `🤖` 子块不套用母块加粗（迁入顶格自动块时剥除最外层 `**...**`），保持母块视觉优先级高于子块；支持同日注挂多会话及把既有顶格 `🤖` 自动记录整块无损迁入，且 `bindSessionAt` 的 `taskBindings` / `markBound` 使用 `kwLine().body` 纯键名；新增 `nestTask` / `nestTaskLines` 使编辑器任务块互拖默认挂为子块；按住 `⌥` 保留原 1 对 1 直接绑定/合并。
  - `src/journal.js` / `src/autolog.js` / `src/sync.js` / `src/organize-journal.js`：补齐 `showTimeRange: false`（`formatSessionTaskLine` 不再反写母行时段、新增 `upsertClockLine` 供 `AutoLog` 与 `JournalSync` 在进行中实时维护子块 `- ⏱`、`planJournal(..., { showTimeRange })` 不将时段写回母行）。
  - 螺旋日程主库正本与公开版（`nautilus-spiral`）：`parseJournal` / `mainOf` 对 `🤖` 子块豁免非 `DONE` 母块状态覆盖且不触发 `container`，仅在母块标 `DONE` 时把未完成 `🤖` 子块收口为 `done`；`markMain` 不让缩进 `🤖` 子块自动继承 `[#A]` 主线、`schedule` 让顶格/母块在同状态中排在缩进 `🤖` 子块之前、`paintSegs` 按 `shallowTop` 保证母块永远压在子块上层绘制；`applyWork` / `useClockTotal` 支持无母块时段 `DOING 🤖` 读取子块 `- ⏱`。
- **大纲视图 Pin 视觉突出 & 双语操作指南与实机演示视频**：
  - `src/styles/views/record-views.css`：为大纲模式 `.ad-record-line--pinned` 与阅读视图 `.ad-record-pinned` 增加主题色柔和底纹与 `.ad-round-badge` 高亮，折叠后常驻展示更醒目。
  - `README.zh-CN.md`、`README.md`、`docs/wiki/Workflow-Markdown-Harness.md`、`docs/wiki/Workflow-Markdown-Harness.en.md`、`docs/wiki/Home.md`、`docs/wiki/Home.en.md` 及 `assets/ai-record-operations-demo.gif` / Release `1.13.32` `ai-record-operations-demo.mp4`：新增「在agent deck里你可以如何去对于 AI 自动记录的内容进行操作」（含英文版），一次性演示拖拽挂子块、`⌘⌥↓` 一键成组、3 层递进子块、展开/折叠与右键 Pin、表格/分形看板切换及 `⌃⌥L` 整理日志版面。
- **Dream MCP 显性设置、默认检索/提炼隔离与设置页统一视觉重构（2026-11-27）**：
  - **双向聚焦默认策略**：`DEFAULTS.dream.scope` 调整为 `"ai-records"`（Dream 提炼默认仅从 AI 自动记录条目采集，仍保留 `"all"` 选项），而全库检索（`vault-find` / FTS5）通过 `dream.mcp.excludeAiLogs`（默认 `true`）默认只搜用户手写内容与已沉淀记忆，形成「用户笔记/Dream 记忆供检索、AI 自动记录供 Dream 提炼」的自然闭环。
  - **Dream 设置页 5 项显性 MCP 设置（`src/constants.js` / `src/settings.js` / `src/context-core/` / 三语）**：① MCP 工具暴露范围（`dream.mcp.toolsMode`：`all` 9 工具 vs `memory-only` 仅 `memory_*` 5 工具，便于搭配 Obsidian 官方 Connectors，服务端实时 `tools/list` 动态切换且拦截禁用工具调用）；② `--allow-write` 持久化开关（`dream.mcp.allowWrite`，命令面板复制同步复用）；③ 全库检索排除 AI 自动记录开关（`dream.mcp.excludeAiLogs`，切换自动失效本地索引缓存并同步 FTS5）及隐私与目录隔离行 +「前往设置」跳转至「委派」标签（严格遵守 5 Tab 单入口不变式）；④ O(1) 本地索引状态探测 `peekVaultIndexStatus` 与「重建本地索引」按钮；⑤ 可编辑外部 Agent 自动触发提示词 `<textarea>`（`dream.mcp.agentPrompt`）+「复制提示词」+「恢复默认」。
  - **设置页统一视觉重构（`src/settings.js` / `src/styles/views/settings.css`）**：状态与索引行统一走 `this.row(...)` 两列栅格；修复 `.ad-settings .ad-btn` 被 Obsidian `button:not(.clickable-icon)` 染灰并用 `.ad-btn--soft` / `.ad-btn--ghost` / `.ad-btn--compact`（`30px`）分层；为提示词区块补 `.ad-field__desc`（`-2px 0 8px`）；全部 `.ad-mcp-*` 收敛进 `.ad-settings` 并改用 `--ad-good`/`--ad-warn`/`--ad-bad` `color-mix` 徽章与单边框 `.ad-mcp-clients__list`（`var(--ad-figure)` 路径），手动 JSON/CLI 复制收进折叠子区 `mcp-manual`。
  - **包体收敛与实测范围**：从 `src/context-core/index.js` 剥离插件宿主未用的 `vault-ops.js` 重导出，按用户要求默认仅构建并更新 Agent Deck Obsidian 插件端（不触碰 `outline-journal-app`）；`npm run build` / `npm test` / `npm run eval` / `npm run check:deploy`（`main.js = 3556.0KB`、`styles.css = 155.3KB`）全绿，Obsidian `马自立` 库热重载实测 `760px` `.ad-settings` 5 行右列像素级对齐（`464px`）、描述至输入框 `8px` 间距、`dev:errors` 零新增报错。实测仅覆盖 **macOS arm64**，Windows 端未实测。
- **按能力接通生产 `entryMapMode`、新增 OpenCode & DeepSeek Harness 一键 MCP 接入、隔离 6 次呼出率实测与全量 Spec/结构梳理（2026-11-27）**：
  - **能力自动分流（`src/agent-registry.js` / `src/delegation.js` / `src/harness.js`）**：新增 `canAgentReadLocalFiles(id, destination)`，让可自主读文件的 CLI/ACP 后台及终端 Agent 在 `resolveBlockContext` 时自动启用 `entryMapMode`（仅注入 `[[双链]]` 路径、OKF 元信息与标题 TOC / 无标题正文行数提示、入口地图隔离声明，并在 `memoryToolHint` 保留 `vault-*` 入口）；桌面复制/回退与 `_performHandoff` 保持完整摘要内联（`test/delegation-enrich.test.mjs`、`test/harness-context.test.mjs` 回归锁定）。
  - **一键 MCP 客户端扩至 9 家（`src/context-core/mcp-clients.js` / `src/settings.js` / `locales`）**：新增 **OpenCode**（`~/.config/opencode/opencode.json` `mcp.servers["agent-deck-memory"] = { type: "local", command: [...] }`，兼容并清理旧 `mcp.<name>`）与 **DeepSeek Harness Desktop & ACP**（`~/.dsh/profiles/{desktop,acp}/cordis.patch.yml` 无损文本级 Cordis 块编辑，支持 `[]` 切换、含 ` #` 路径、多行 `args`、重复条目去重并保留注释 / `!!js` / 同组 `mcp-kimi-cu`）；`dsh acp --patch ... --dump-config` 实机验证增删零报错，本机只读探测全部 9 家客户端就绪。
  - **隔离 6 次多 Agent 实测（macOS arm64，不碰主库与用户配置）**：在 `/tmp` 构造 4 篇深章节笔记并使用真实 `entryMapMode` prompt（长笔记引用 `326 → 208` tokens），实跑 `agy` CLI（2/2）、`dsh acp`（2/2）、`codex exec -m gpt-6.1-sol --sandbox read-only`（2/2，含显式 `memory-query.mjs vault-read`），**6/6 主动读取原文并精确命中深层隐藏答案**。
  - **全量 Spec 清理与项目结构梳理**：补全 [architecture-and-boundaries.md](specs/architecture-and-boundaries.md) §1 完整目录树与 §2 全量 `src/` 分层；清理 [context-protocol.zh-CN.md](specs/context-protocol.zh-CN.md)、[harness-roadmap.zh-CN.md](specs/harness-roadmap.zh-CN.md)、[information-flow.zh-CN.md](specs/information-flow.zh-CN.md)、[acp-integration.zh-CN.md](specs/acp-integration.zh-CN.md)、[data-and-markdown-contracts.md](specs/data-and-markdown-contracts.md)、[Supported-Agents-and-Models*.md](wiki/Supported-Agents-and-Models.md) 及 `outline-journal-app` Spec 中残留的 `ai-filter.js`、`agy acp`、`6 家` 与 2026-11-18 过时代码基线描述。
- **纯 Node Context Layer 内核（`src/context-core/`）、统一净化叶子层、2 轮 CodeRabbit 审查加固与 Antigravity 官方 `agy` CLI 迁移（2026-11-26 – 2026-11-27）**：
  - 将记忆与全库上下文逻辑抽离为零 Obsidian / 零 DOM 依赖的 `src/context-core/{config,note-hygiene,vault-index,fts-index,memory-ops,vault-ops,mcp-clients,cli,mcp,index}.js`，`esbuild.config.mjs` 四入口无警告单源同步产出 `main.js`（`3553.4 KB`，导出 `contextCore` 挂载 `this.contextCore`）、`scripts/memory-query.mjs`（`ASSET_VERSION = 9`）与 `scripts/memory-mcp.mjs`（`ASSET_VERSION = 8`），支持 `.obsidian/`、`.outline-journal/`、自定义 `--config-dir` 与纯 Markdown 目录。
  - **结构抽象与 `/simplify` 统一**：将分散在 5 处模块的任务关键词、21 家 Agent 内部块号规则、`cleanUserNoteLine`、YAML `parseFrontmatter`/`extractOkfSummaryParts`、`findHeadingRange`/`collectRemainingHeadings`、AI 自动记录子树判定与生成目录匹配器收口进单一纯 JS 叶子模块 `src/context-core/note-hygiene.js`（取代旧 `ai-filter.js`；禁止反向导入 `config.js`/`memory-store.js` 以免污染 `journal.js` → `harness-detect.test.mjs` UI-only stub 测试）；复用到 `memory-query-core.js` 的 `PROPOSAL_ONLY_RE` / `normalizeProjectKey` / `entryMetaTerms` / `analyzeTextHits`，`trace.js` `checkExternalAssets` 直接复用 `scriptsDir`，`cli.js`/`mcp.js` 共用 `isMainModule`，并修复 `src/harness.js` `compressLinkedSectionForBudget` 英文模式下硬编码中文哨兵标记的 bug。
  - **CodeRabbit 两轮本地审查（18 + 10 项）全修**：补齐 `isPrivateFrontmatter` 引号键（`"private": true`）与 YAML 行内 `#` 注释识别及 `loadMemories` 双循环原文隐私门；`proposeMemory` 清理 `projectLink`/`concepts` 换行防 YAML 注入；`config.js` / `vault-index.js` / `vault-ops.js` 新增 `isPathContainedIn`、`memoryDirOf` 符号链接越界拦截、`isCaseInsensitiveFs` 大小写无关目录排除、`readVaultFileStrict`（`lstatSync` + `realpathSync` + `O_NOFOLLOW`）防 TOCTOU、`JSON.stringify` 缓存键、`vaultFind` 缓存命中后隐私复检、分页过滤避免 FTS 截断丢失目标领域命中，以及 `vaultRead` `#Heading` 内 `start_line` + 超长行首行预算截断与 `start_char` 续读；`fts-index.js` 将强制重建收进单事务并通过 `sync_complete` + `ftsNeedsSync` 自动恢复 `disableFts` / 失败中断的同步；`mcp.js` 协商协议版本并限制 stdio 最大帧（`4 MiB`）；`mcp-clients.js` 校验 Node 可执行权限（`X_OK`）、支持 TOML 单/双引号键与仅子表插入、不破坏无关多行值的卸载、`0o600`+`wx` 独占写入且失败不覆盖原配置、保留 `--config-dir`，`verifyMcpHandshake` 改为分步顺序握手（`initialize` 校验后才发 `tools/list`）。
  - **Antigravity 迁移至官方 `agy` CLI（零 `agy acp` 调用）**：为避免 `agy acp` 存在被视作反代的风险，新增 `AntigravityRunner` 与 `parseAgyModelsOutput` / `fetchAgyCliModels`（走官方 `agy --output-format stream-json --print=...`、`--resume` 续聊、`agy models` 拉取 27 个模型、`--dangerously-skip-permissions` 与 `agy -i` 终端交接，兼容历史 `acp` 链接与作业恢复），`rg -n "agy acp" src/` 为 `0` 匹配。
  - **AI 自动生成物与 SQLite FTS5 边界**：`fts-index.js` 基于内置 `node:sqlite` 构建 `trigram` 增量索引（`~/.agent-deck/index/*.fts.sqlite`，`INDEX_VERSION = 2` / `FTS_SCHEMA_VERSION = 2`），屏蔽 `🤖`/`💬`/`第N轮`/`⏱`/`📋`/`🔗`/`❓` 与 `Agent Deck/` 生成文件，已沉淀记忆走 `memory_*`。
  - **一键接入外部 MCP 与 M1.3 第 3 步**：`mcp-clients.js` + `src/settings.js` Dream 卡片探测 6 家客户端并无损写入 `agent-deck-memory`；`src/harness.js` / `src/delegation.js` 落地 `estimateTokens`、`entryMapMode`（`339 → 148` tokens）与 `AGENTS.md`/`CLAUDE.md` 分工。
  - **实测与未测边界（macOS arm64，未改动 `马自立` Vault 笔记与任何真实客户端 MCP 配置）**：
    - 全量构建与自动化门禁：`npm run build`（0 警告，`main.js = 3553.4 KB`）、`npm test`（全部测试套全绿，含重写后官方 CLI 版 `test/antigravity-acp.test.mjs` 与新增安全/精度回归）、`npm run eval`（`ok: true`，`recall = 1`、`precision = 1`、`privacyLeaks = 0`、`aiLogLeaks = 0`、`generatedFileLeaks = 0`）、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`。
    - Live Obsidian & 外部 Agent 只读记忆读取实测：`马自立` Vault 重载后 `verifyMcpHandshake`（`59ms` / 9 工具）与 `fetchAgyCliModels`（`27` 个模型）通过；在 `/tmp` 隔离空目录不改写任何用户配置实跑三大 Agent 读取 `马自立/Agent Deck/记忆/`——**DeepSeek Harness**（`dsh acp`，`17.9s` 成功调用 `memory-query.mjs` 返回 3 条含 `m-...` ID 的真实记忆）、**Antigravity 官方 CLI**（`agy -p --output-format stream-json`，`12.7s` 成功执行 `memory-query.mjs search` 返回 3 条真实记忆；先前曾确认 `agy acp` 也能读但已按要求停用）、**Codex**（使用有效模型 `-m gpt-6.1-sol` + `--sandbox read-only` 走 CLI 提示 `33.9s` 成功读出 3 条真实记忆；注意本机 `~/.codex/config.toml` 当前默认 `gpt-6.2-sol` 会报 `model_not_in_accessible_catalog`，且非交互 `codex exec` 默认 `approval_policy = never` 会拦截无预授权的 MCP `memory_search` 调用）。
    - 双宿主同步：`~/claude/outline-journal-app` 同步完成（`otherRequire: 0 条`、`每条都有去向`）、`npm run verify`（单元 + 145 项 Electron 全过）、`pack:mac` 与 `smoke:packaged`（`darwin` `plugins=25+bullet`）全绿。Windows 真机 GUI 与外部客户端 MCP UI 交互点测仍未实测。
- **实测范围与未测空白**：
  - **macOS arm64 已实测**：全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`；螺旋日程主库/公开版 6 套回归及双模式（`showTimeRange: true` / `false`）两遍真实跨插件端到端实跑；并在 `马自立` Vault 实机 Obsidian 界面中完成了 6 幕端到端交互录屏与验收（`.ad-grip` 真实鼠标拖拽挂为子块、`⌘⌥↓` 一键成组、3 层递进子块、展开/折叠 + 原生右键菜单 Pin 与大纲柔和突出样式、表格视图、子主题原地分形看板、`⌃⌥L` 整理日志版面、`dev:errors` 零 `agent-deck` 报错）。
  - **未测空白**：Windows 真机桌面 GUI 交互未实测（仅 GitHub Actions `windows-latest` CI 跑单测）。

## 1.13.31 示例文档实核修正与完整性回归

- 核对并修正 `src/welcome-demo.js`（en / zh-TW / zh）全部入口路径、能力边界描述、繁体命令名、`NEEDOK` 卡片关键词及看板按钮提示，并在 `test/showcase-flows.test.mjs` 补充三语 `NEEDOK` 解析、4 组 AI 记录视图、配图存在性与无中文/繁体字符门禁；在 `马自立` Vault 阅读视图（全 5 张配图加载、只读分形看板与镜像卡、4 组视图）及编辑视图（`dev:errors` 零报错）实机验证通过。

## 1.13.30 Windows `isScratchCwd` 边界修复

- 移除 `src/readers.js` `isScratchCwd` 对 `AppData/Local/Temp` 的拦截（保留在 `src/project-folders.js` `isTempPath` 用于 `projectFolderSuggestions` 与 `pickTrusted` 过滤），修复 `1.13.29` 在 `windows-latest` CI 的 `test/next-round-fixes.test.mjs:529`（`ConfirmSendModal` 冲突选择）失败问题。

## 1.13.29 Dream 记忆全链路升级、工作区间统一、Windows 路径加固与示例文档刷新

- **升级后新功能示例文档刷新（`src/welcome-demo.js` / `test/update-check.test.mjs`）**：
  - 将 `SHOWCASE_RELEASE_FLOOR` 升至 `1.13.29`，以通俗面向用户的功能说明更新中/英/繁三语「本期新功能（What's New）」与试用入口（覆盖 `1.13.14 → 1.13.29` 的记忆图谱与审阅、多 AI 分批协作工作台、工作目录选择与拖拽派活、21 家 AI 助手与 11 家终端扩展），更新后首次加载自动弹出一次。
- **Dream 记忆全链路升级、第二轮端到端打磨与外围协议（2026-11-26）**：
  - **Round 1（Graph-Native OKF 全链路能力）**：`src/memory-graph.js` / `src/memory-store.js` / `src/memory-query-core.js` / `src/dream.js` / `src/harness.js` 与 `scripts/memory-query.mjs` / `scripts/memory-mcp.mjs` 全面接入扁平 Bases 兼容 OKF v0.2 元数据、`concepts` / `project_link` / `source_notes` / `conflicts_with` / `supersedes` / `superseded_by` 纯双链图谱边、1–2 跳概念扩散检索、`<dir>/log.md` 变更日志、`consolidate` 双向写 `conflicts_with` 与超期归档至 `<dir>/archive/`（可恢复）、`deriveShortMemoryTitle` 中文引号边界保护与模型润色短命名 `polishShortTitles()`、`classifyAnchorStatus` 区分库内可补锚 vs 外部导入免补锚、`suggestConceptPromotions`（`≥ 5` 条概念升格建议）；设置页「记忆库工作区」保留 5 个高频主按钮，抽屉「图谱与库维护」收纳图谱双视角 preset（`kind` / `trust`）、体检、OKF 补齐、润色与归档。
  - **Round 2（检索提纯、冲突闭环与 UI 降摩擦，`memory-query` v6 / `memory-mcp` v5）**：
    - Push & Pull 精度修复：`expandGraphMemories` 移除 `projectName` 零词面强塞泛洪并区分 Hop-2 `father` 父边（`parentEdge`）与普通共现桥；`buildVaultConceptCatalog` 排除 `<dir>/` 入链防止项目/枢纽自锁、豁免已配置 `projectFolders` 并规范化别名；`pickContext` 增 15s 缓存及全写操作失效；CLI `--project` 搜索保留无项目归属通用 `lesson`/`preference`（`×0.85`），分离 `--include-stale` 与 `--all` / `include_inactive`，MCP 写入默认 `provenance: ai-log` 且拦回曾拒收归档 ID；`renderMemoryIndex` / CLI / MCP 输出 Top-15 `高频概念`。
    - 数据契约与冲突自清：`parseMemoryFile` / `serializeMemoryFile` 不再复活已清死链，`memorySlug` 保留词间单空格，`deriveShortMemoryTitle` 跳过 13 字内前置框架词并剥末尾悬挂虚词；`polishShortTitles` 仅选未达标条目防循环；`consolidate` 继承双方 `concepts`/`verified` 并将冲突中涉及的旧合并 ID 重映射到合并结果；`setEntryState` 写入 `status_at` 并双向清光残余 `conflicts_with`；`memoryBase` 待确认过滤改 `verified != true` 且 `reconcileMemoryFile` 对 `verified: true` 同步补全字段。
    - UI 降摩擦：`MemoryReviewModal` 优先审阅待确认/冲突队列、新增来源徽标与 `Backspace`/`←` 回退、就地冲突裁决按钮；`MemoryBoardView` 新增「仅冲突待裁决」筛选与「批量确认本人日志 (N)」并保留滚动；`ConfirmSendModal` 切换项目动态重算记忆；MCP 设置卡新增 `--allow-write` 勾选框；`restoreCurrentArchivedMemory` 恢复时重新激活为 `有效`。
  - **本次实测记录（macOS arm64，未改动主库已有 120 条记忆）**：全量 `npm test`、`npm run eval`（`recall=1 / precision=1 / orderMismatches=0 / privacyLeaks=0`）、`npm run build`（`main.js = 3347.0KB`、`styles.css = 151.3KB`）、`npm run check:deploy`（`v6 / v5`）、`git diff --check` 全绿；`/tmp` 隔离沙盒用真实 `codex` 连跑两轮证明「重复合并 + 同批 `conflicts` 重映射（`merged:1, conflictsMarked:1, archived:1`）→ `polishShortTitles` 润色 1 条后 Pass 2 `renamed:0` 收敛 → 拒绝冲突一方后残余 `conflicts_with` 归零 → MCP `ai-log` 写入与拒收后防重」；`马自立` Vault 热重载通过、`dev:errors` 无插件报错，只读对照证明 3 项非相关 code query 从项目种子泛洪降至 `0` 噪声、`--project agent-deck` 通用经验从 `0` 命中恢复召回、`index`/`stats`/`graph`/`MCP` 全线就绪。
  - **未测空白**：Windows 真机与 Obsidian GUI 内鼠键实点 `MemoryReviewModal` 就地裁决 / `ConfirmSendModal` 切项目重算 / Graph & Bases 手工鼠标点测、以及 Linear `P-MAT-42` 进度同步。
- **Dream 全流程审计 + 委派与派回工作区间专项修复（2026-11-26）**：
  - **外围查询脚本软链静默退出修复（`scripts/memory-query.mjs`、`scripts/memory-mcp.mjs`）**：端到端实跑发现当脚本通过符号链接（如 macOS `/tmp`、`/var` 或软链插件目录）被 CLI 调用时，`path.resolve(process.argv[1]) !== fileURLToPath(import.meta.url)` 导致 `isMain` 误判 `false`、退出码 `0` 但零输出；改为 `fs.realpathSync` 比对并在 `resolveVault` 优先从 `argv[1]` 所在目录向上查找 `.obsidian`，修复后单次 `memory-query search` 即命中并准确作答。
  - **提炼 / 审阅 / 按需调用闭环（`src/dream.js`、`src/memory-review.js`、`src/delegation.js`、`src/main.js`）**：`Dreaming.writeEntry()` 自动按 `settings.projectFolders` 反推 `project` 与 `project_link`；`updateEntry()` 支持更新 `description`、`concepts` 与 `projectLink`；`MemoryReviewModal` 修复冲突裁决后仍停留在已淘汰条目上的问题、补充 `description` / `concepts` 编辑栏与「局部图谱」一键跳转，`reviewMemories()` 保留光标定位的已确认条目在队首；`memoryToolHint()` 读取 `索引.md` 有效条数、Top-6 高频概念及当前项目 `--project` 提示。
  - **委派与派回工作区间统一（`src/project-folders.js`、`src/dialog.js`、`src/reply-modal.js`、`src/workbench-modal.js`、`src/settings.js`、`src/delegation.js`、`src/main.js`）**：
    - `recentProjectFolders()` 过滤 URL、非目录文件与失效路径（清理线上 `马自立` 库中历史 `s://...` / `SKILL.md` 脏候选）；新增 `explicitVault: true` 使弹窗选「库根目录（不指定项目）」真实覆盖 `delegate[agent].cwd` 与 `dream-memory` 解析；
    - 修复 `renderProjectFolderPicker` 在 `projectConflict` 下切换 `<select>` 报错崩溃及 `__suggested` 被提前清空的问题，补充「最近使用过的工作目录」分组、原生系统目录选择器 `浏览目录…`（Settings 补充一键登记候选）与无效目录提交前校验；
    - 统一 `handoffCli()` 与 `_performHandoff()` 走 `resolveDispatchFolder()`、`rememberProjectFolder()`、`job.project` 及 Codex `--add-dir <vaultPath>`；`continueSession()` 在历史 `job.cwd` 失效时按 `job.project` / 笔记块上下文智能回退并提示；`FollowUpModal`、`ReplyModal` 展示当前会话工作目录，「重新委派（新会话）」与 `dispatchBoardGroup()`、`makeDispatchDraft` / `readDraft` 保留并传播工作区信息。
  - **本次实测记录（macOS arm64，未改动主库已有记忆）**：全量 `npm test`（含新增符号链接 CLI、项目解析、`explicitVault`、`handoffCli`、`continueSession` 回退、冲突弹窗与 `Dreaming.writeEntry`/`updateEntry`/`MemoryReviewModal` 回归测试）、`npm run eval`（11/11 全绿）、`npm run build`、`npm run check:deploy`、`git diff --check`、`/tmp` 隔离真实 `codex (gpt-6-luna)` 4 阶段端到端（提炼写入 `project` + `project_link` + `source_notes` → 审阅更新与冲突清边 → 外部目录 Agent 一次命中 `memory-query.mjs` 并答出精确端口/命令 → `explicitVault` 验证），以及 `马自立` Vault 热重载（`dev:errors` 零插件报错、`projectFolderSuggestions(8)` 全部为干净有效目录）。
  - **未测空白**：Windows 真机 GUI 与系统目录弹窗交互（仅 Node 单测覆盖逻辑，原生对话框与桌面热键未在 Windows 实机点测）。
- **Windows 路径 / 联结与终端转义加固 + 记忆检索准确性/实用性迭代（2026-11-26）**：
  - **Windows 路径与终端兼容（`src/project-folders.js`、`src/readers.js`、`src/security.js`、`src/delegation-runners.js`、`src/delegation.js`、`src/terminals.js`、`src/main.js`、`scripts/memory-query.mjs`、`scripts/memory-mcp.mjs`）**：
    - 统一清洗 Windows 长路径前缀（`\\?\` / `\\?\UNC\`，UNC 保留原生反斜杠语义并拒绝裸盘符 `C:\` 作为项目根）、支持盘符大小写无关对比（`sameFolder` / `isInsideRoot` / `allowlist`）与 `realpathSync.native` 联结/软链穿透、`AppData/Local/Temp` 与 `C:\Windows\Temp` 临时目录过滤；
    - `parseCodexTrustedDirs()` 支持 Windows 转义双引号/单引号 TOML 路径，`ClaudeRunner.startHeadless` 对 Windows `.cmd`/`.bat` 包装器改走 `stdin` 传 prompt；`handoffCli()` 在 `win32` 生成 PowerShell UTF-8 读取包装脚本（`buildWindowsPowerShellLauncher` / `psSingleQuote`）并由 `wt.exe`/`cmd.exe` 执行，`openSession()` 按平台切换引号；`memory-query.mjs` 的 `findMemory` 与双脚本 `isMain` 兼容反斜杠与跨平台真路径。
  - **记忆实用性与准确性升级（`src/memory-query-core.js`、`scripts/memory-query.mjs`、`src/dream.js`、`src/main.js`、`scripts/eval-context.mjs`）**：
    - `memory-query-core` 强化多词覆盖加分、对 substantive 长条（`terms >= 6 && length >= 16`）做 MMR-lite 近似重复多样性去重，并将未验证提案降权收紧至 `0.42`；CLI 搜索支持短双字中文词召回、多词乘法加权与代码经验倾向加权；
    - `Dreaming` 提炼约束 `description` / 跨语种 `tags`、在非严格模式下拦截仅由 AI 归纳且未验证的「尚未实施/待验证」过渡状态（补充多语提示）、新增 `recordHits()` 统计 `hitStats` 并在 `audit()` / `healthReport()` 展示「派发命中 / 零命中」与「未验证提案/过渡态」。
  - **本次实测记录（macOS arm64，未改动主库已有记忆）**：全量 `npm test`（含 Windows 长路径/大小写/PowerShell 启动脚本/Codex TOML/`findMemory` 反斜杠/MMR-lite/`recordHits` 回归测试）、`npm run eval`（13 项 `recall=1 / precision=1 / privacyLeaks=0 / orderMismatches=0`）、`npm run build`、`npm run check:deploy`、`git diff --check` 全通过；`马自立` 120 条实时库只读检索对比中，核心派发引擎 `pickMemoriesFromEntries` 对 `"Windows 路径"` 精确将跨平台 `lesson` 排至第 1 位（`score=7.20` > preference `4.14`）；`/tmp` 隔离双轮真实 `codex -m gpt-6-luna` 端到端通过（第 1 轮过滤未验证 AI 过渡态并让软链目录内外部 Codex 一次查出 `47913` + `realpath`，第 2 轮自动以 `48099` 替代旧 `47913` 并刷新检索结果）；`马自立` Vault 热重载通过、`dev:errors` 零插件报错。
  - **未测空白**：Windows 真机环境下 PowerShell / `wt.exe` 弹窗启动、NTFS junction、Codex `.cmd` 实机执行与 Obsidian Windows GUI 仍未在 Windows 实机硬件上点测，目前仅由 macOS 下的跨平台单元测试验证逻辑。

## 1.13.28 多 Agent 编排第三轮实测打磨、Windows CI 修复与阅读视图净化

- **跨平台 CI 修复**：`test/project-workbench.test.mjs` 对 `modal.cwd` 与 `path.join()` 的断言统一改为正斜杠比较，修复 `windows-latest` 因 `normalizeProjectFolder()` 统一使用 `/` 导致的唯一失败用例。
- **实跑暴露并修复的关键链路问题**：
  - **直接交付指令（`src/constants.js` / `src/harness.js` / `src/background-output.js`）**：新增 `DIRECT_EXECUTE`，当 `skipConfirmFirst: true` 时显式要求队员对非核心边界按常规直接实现并完成验证（并在归档清洗中剥离），消除实跑时 Codex 在 stage 1 因边界提问停下导致产出缺失的摩擦。
  - **反问等待与无死锁恢复（`src/delegation.js` / `src/project-workbench.js` / `src/main.js` / `src/fractal-board.js`）**：`captureQuestion()` 写入 `❓` 时记录 `awaitingReply` 与 `awaitingReplyRounds`（`continueSession()` 重置）；`skipConfirmFirst: false` 时 `syncWaveWithState()` 暂停波次并将卡片标 `NEEDOK`；支持内部续聊、桌面端新轮次（`meta.rounds.length > awaitingReplyRounds`）自动解锁，以及看板右键 `NEEDOK`「重新派发（新会话）」携带 `✍️ 答：` 接力（`onWorkbenchJobSettled` `onlyIfKeywords` 补入 `"NEEDOK"`）。
  - **多批失败保留队列与异常自愈（`src/main.js` / `src/fractal-board.js`）**：`advanceWaveToNextStage(waveId, { force })` 在单批失败时保留 `queuedStages` 暂停至 `error`（区分「第 N 批暂停」与「管家汇总失败」文案），支持一键「重派失败项」（重派时保留前序阶段 `upstreamReports` 并按最新 `blockId` 定位行号）或「跳过失败继续第 N 批」；全部失败时不再浪费一次管家调用；`dispatchBoardGroup` 为未指定子卡优先分配健康已装 Agent，且在旧波次为 `error` 时允许新建管家；`finalizeStewardWave` 自动续派补齐后台 `destination`；`dispatchWorkbenchTasks` 按 `blockId` 解析最新行号防漂移。
  - **`Answers/` 双链解析、同块多链不回跳与管家自检**：`extractBlockResultText()` 同时支持 `[[...Answers/*.md|...]]` 与 Markdown 链接、按 `<!-- ad-turn:... -->` 隔离会话并解析 `answerAbsPath`；`JournalSync.keywords()` 对同块多条 `🔗` 采用 4 级主链接选择（运行中作业 > 非归档运行态 > 非归档最近 > 最新时间戳），避免旧死链回写覆盖置换中的任务；`judgeWave()` 在 `wave.state === "running"` 时同步巡检管家卡住。
  - **工作台与阅读视图 UI 细节（`src/workbench-modal.js` / `src/styles/views/modals.css` / `src/fractal-board.js` / `src/styles/views/record-views.css` / 四国/繁体文案）**：`extractGoalFromBlock()` 跳过既有 `DONE`/`TODO` 子卡并剥除 `@agent`/`^blockId`；派发前拦截不存在的 `cwd` 并同步输入/下拉选择；任务草稿行拆分为宽标题顶栏 + 下方 `.ad-wb-task__meta` + 粘底操作条 `.ad-wb-foot`；阅读视图 `.ad-board-wrap--readonly` 隐藏复选栏与 `<select>` 并禁用拖拽与右键菜单。
- **验证范围与未测空白（macOS arm64）**：
  - **已实机验证**：
    - 真实代码编辑 E2E（`DeepSeek` 拆解 → 临时 `git` 仓库内 `Codex` 一次写入 `src/math.js` + `Antigravity` 写入 `src/format.js` 并生成 `Answers/` 归档 → 自动 Stage 2 `test/app.test.mjs` → `Codex` 管家核验与 `node --test` 3 项全绿、`noteDispatchSessions` 记录全员会话 ID）。
    - 真实混沌/恢复/反问 E2E（部分 Stage 1 限额失败保留 Stage 2 队列 → `retryFailedWaveWorkers` 换角 + `JournalSync.keywords()` 不回跳 → `autoContinue: true` 两轮完整闭环；`skipConfirmFirst: false` 反问锁定 `NEEDOK` → `applyReply` 写入 `✍️ 答：` + 重派新会话接管并跑完 Stage 2）。
    - `马自立` Obsidian Vault 实机 DOM 检查（Live Preview 错误横幅与跳过按钮、Reading View 只读零控件与禁用拖拽、`ProjectWorkbenchModal` 宽标题/粘底按钮/去重目标/无效 `cwd` 拦截、`dev:errors` 零插件报错且临时笔记与设置已清理）。
    - 全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`。
  - **未测空白**：Windows 真机 GUI 交互（仅由 GitHub Actions `windows-latest` 跨平台 CI 单测覆盖）。

## 1.13.27 项目工作台、分批多 Agent 编排与管家闭环全链路修复与升级

- **阻塞级 Bug 修复（两轮深度审计 + 实机跑通触发）**：
  - `src/workbench-modal.js`：`render()` 补齐 `const p = this.plugin;` 修复打开工作台 `ReferenceError: p is not defined`；提取目标块前 6 条非记录详情作为拆解背景；拆解调用改为 `{ polish: false }`（消除 30s 润色短超时与模型劫持）并在切换 CLI 供应商时清空不匹配的 `autoLogModel`；新增 `_closed` 守卫防止异步回包重渲已关弹窗，`detailIn.oninput` 实时重算重叠校验。
  - `src/main.js` `dispatchBoardGroup` / `delegateAtLine` / `liveSessions`：修复看板「派发 TODO」报错 `ReferenceError: view is not defined`（改为 `path`），并发派发前按组内已有块号批量写入独立 `^blockId`（`fileBoard` 标题不强插锚点）；`delegateAtLine` 尊重 `extraOpts.agent`；`liveSessions()` 判空 `typeof this.usage?.liveSessions === "function"`。
  - `src/project-workbench.js` `formatWorkbenchTasksMarkdown`：修复追加到已有母任务（`includeParent: false`）时 `subIndent` 漏加 `childIndentStr` 导致子任务与母任务平级，以及结尾空行破坏子块归属的问题。
  - `src/main.js` & `src/project-workbench.js` 波次状态机：小队成员与管家委派一律传入 `ignoreMention: true`；将回填生成的 `job.blockId` 同步写回 `wave.workers[i].blockId`，并支持 `syncWaveWithState()` 按同 `blockId` 接管后续替换 `job` 自愈推进；`onWorkbenchJobSettled` 与 `finalizeStewardWave` 共用 `isQuotaOrProviderErrorText()` 识别进程退出 0 但正文为限额/故障的回复标为 `ERRORED`；无管家模式出现失败项时正确落入 `error` 态而非误报完成；`advanceWaveToNextStage()` 跳过已有 `🔗` 或已 `DONE` 卡片并继承 `wave.skipConfirmFirst`。
  - `src/cli-env.js`（新增无环叶子模块）：收口 GUI PATH 扩展、`scutil --proxy` / `parseWindowsRegProxy` 代理继承与 `cleanEnv()` 给 `delegation-runners.js`、`codex-desktop.js`、`llm.js`，并补充 ChatGPT.app 内嵌 `CodexCLI.app/Contents/MacOS/codex` 候选路径；抽离共享 `uninstalledAgentsFor()`。
- **降摩擦与成熟多 Agent 编排实践落地**：
  - **就绪感知配队与预检（`project-workbench.js` / `workbench-modal.js`）**：按 `uninstalledAgentsFor()` 与 `limitAgentsFromSessions()` 主动绕过未装 CLI / 限额 Agent 并在健康 Agent 间均衡分配；新增拆解模型切换下拉（展示自动解析模型 + `autoLogFailover` + 1 次带约束 `buildCopilotFixPrompt()` JSON 修复重试）、`extractScopeTokens()` / `detectStageScopeOverlaps()` 同批文件重叠预警与「一键错峰排批」、目录/非健康 Agent 预检与「一键替换为可用 Agent」、默认勾选 `skipConfirmFirst`、`⌘/Ctrl+Enter` 拆解与 `updateActionCounts()` 零失焦更新。
  - **分批依赖与看板故障恢复（`main.js` / `fractal-board.js`）**：支持 `第 1/2/3 批` 编排与自动上游摘要接力（`upstreamReports`）；待接力后批卡展示「第 N 批待接力」并排除「派发 TODO」重复派发；支持右键「换 Agent 重新派发（新会话）」、错误栏「重派失败项」（`retryFailedWaveWorkers` 自动将限额/未装 CLI 子任务改派健康 Agent 并改写 `@agent`）、错误栏切换管家重试汇总，以及可收起的波次完成总结条（`findBoardWaveBanner()` / `dismissWorkbenchWave()`，UI 先于磁盘保存即时刷新）。
- **验证范围与未测空白（macOS arm64）**：
  - **已实机验证**：
    - 真实多 CLI 全链路场景 A & B：实机验证 `DeepSeek CLI`（`deepseek-chat`）、`Codex CLI` 与 `Antigravity`（`agy`）三家副驾切换拆解；端到端跑通 `DeepSeek` 拆解直派 → `Codex`（`app-server`）+ `Antigravity`（`agy acp`）第 1 批并行 → 自动携带摘要推进第 2 批 → `Codex` 管家验收（全员 `DONE` + 父项 `TOREVIEW`）；实机验证模拟第 1 批 `Antigravity` 限额报错（`ERRORED`）后调用 `retryFailedWaveWorkers` 自动换角 `codex` 重派、自愈接管并闭环第 2 批与管家总结。
    - Obsidian `马自立` Vault 实机 GUI & DOM 验证：安装 `1.13.27` 并热重载，`obsidian eval` 实测 `.ad-workbench-dialog` 自动解析拆解模型标签、`src/main.js` 重叠检测与「一键错峰排批」、零失焦编辑（`sameInputDomNode: true`），以及分形看板 `waiting`（`.ad-board__stagebadge`）、`error`（管家切换 + `重派失败项`）与 `done`（总结横幅 + 点击 `收起` 瞬时消失），`dev:errors` 零插件报错且临时笔记与设置已清理。
    - 全量 `npm test`（含 `test/project-workbench.test.mjs`、`test/codex-desktop.test.mjs`、`test/llm.test.mjs`、`test/i18n.test.mjs`、`test/architecture-refactor.test.mjs`、`test/startup.test.mjs`）、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift` 与 `git diff --check` 全部通过。
  - **未测空白**：Windows 真机环境下工作台弹窗 DOM、分批多 Agent CLI 实机派发与分形看板交互尚无真机实测。

## 1.13.26 增量功能与修复：Trae 追踪与委派、子代理折叠、Orca 真机去重修复、Wiki 与设置提示

- **Trae（Trae CN / 国际版）全链路支持（内置 Agent 增至 21 家，`USAGE_CACHE_VERSION = 25`，`HARNESS_DETECTION_VERSION = 5`，`TRAE_HOOK_VERSION = 2`）**：
  - 新增 `src/trae-sessions.js` 与 `assets/agents/trae.png`（128×128 提取自 `Trae CN.app`）：遵循 `version: 1` `hooks.json`（`~/.trae-cn/hooks.json` / `~/.trae/hooks.json`，工具事件正则 `matcher: ".*"`）只读被动采集 `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `PostCompact` / `Stop` / `Notification` 至 `~/.agent-deck/trae-events/*.jsonl`（不解密加密的 `ModularData/ai-agent/database.db`），支持增量轮次/工具时间线对话查看与归档、安全审计 `PreToolUse` 提取（保留 `d.at` 时间戳）、`isTraeRunning`（兼容 `Trae CN.app/Contents/MacOS/Electron`）、`scanNow()` 延迟挂接 `fs.watch` 与 `maybePromptTraeHooks` 首次运行提示。
  - 委派与交接：接入 `agent-registry.js` / `delegation-runners.js` / `delegation.js` / `workflow.js` / `settings.js` / `main.js` / `journal.js` / `task-mentions.js` / `menubar.swift` / 双语与繁体文案——装有 `traecli` 时支持 `traecli acp serve` 后台委派与同会话应用内续聊（`continueRequiresAcp: true`），未装 CLI 或选「桌面客户端」时自动回退复制任务并唤起 `cn.trae.app`（`trae-cn://`）；新增 `test/trae-sessions.test.mjs`。
  - **Orca 真机去重修复与设置页 Wiki 引导**：`addOrcaDelegatedRef` 增加 `{ extractedOnly: true }` 守卫防止 `provider_turn_id` / `item_id` 写入裸 Turn UUID 与前缀串污染 `delegatedOwners`；设置页「委派」「记录」卡片新增 GitHub Wiki 外链引导；同步更新 `docs/wiki/*.md` 21 家矩阵与 Trae 前置配置要求。
- **验证范围与实测修复（macOS arm64）**：
  - **已实机验证**：运行本机 `Trae CN.app` v3.4.24 真实对话（`SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification` 全部以 `Host` Exit 0 触发并入账 Obsidian）；运行本机 `Orca.app`（`com.stablyai.orca`）真实 `agent-session-domain.db` 追踪、对话与 `delegatedOwners` 去重；全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check` 与 `马自立` Vault 热重载通过。
  - **实测发现并已修复的问题**：① Trae `hooks.json` 的 `matcher` 底层走 Rust 正则（`"*"` 会报 `invalid matcher regex '*'`，已改为 `".*"` 并升级校验）；② 启动后才创建 `~/.agent-deck/trae-events` 时未补挂 `_traeWatcher`（已在 `scanNow()` 补挂）；③ `extractToolCallsFromJsonl` 未读取钩子事件 `d.at` 时间戳；④ 补充提示需在 Trae 设置 → Hooks 开启「全局 Hooks」（`global_hooks_enabled` 默认关闭，沙箱拦截写盘时切「本地自动运行」）；⑤ Orca `orcaDelegatedSids` 解析 `provider_turn_id`/`item_id` 污染 `delegatedOwners`（9 项降为精确 4 项原生会话 ID）。
  - **未测空白**：真实独立 `traecli acp serve` 二进制端到端对话（本机仅装 `Trae CN.app` 未安装 `traecli`）、以及 Windows 端 Trae / Orca 实机 GUI。

## 1.13.26 子块与子代理折叠修复：已完成子代理子块随父块「更多 / 收起」折叠

- **已完成子代理折叠修复（`src/ai-records.js`、`src/record-display.js`、`src/fold-actions.js`、`src/fold-integration.js`、`src/sync.js`、`src/view.js`、`src/styles/views/record-views.css`）**：
  - 修复父任务下已完成的子代理子块（`DONE` / `FAILED` / `CANCELLED` / `CANCELED` 或 `[x]` + `🤖`，含 `⏱` / `💬` 等纯记录子行，无独立 `^blockId`、无 `🔗` 会话链接、无手写笔记/轮次）未被纳入父块 `records` 而另立嵌套组、导致无法随父块「更多 / 收起」折叠的问题；同时兼容编辑视图（Live Preview）、阅读视图（防止内部嵌套列表重复生成折叠按钮）与四视图（新增 `subagent` 行徽章），并在折叠/展开动作与原生折叠清理中使用 `recordEndLine` 覆盖完整子代理子树。
  - 修复 `JournalSync.kidState()` 与侧栏在跑徽章对 `state === "error"` 子代理（如失败的 Cursor 子代理）的归类：回写为 `FAILED` 且不计入进行中徽章。
- **验证范围与未测空白**：
  - **已实机验证（macOS arm64）**：`npm test`、`npm run build`、`npm run check:deploy`、`git diff --check`、Vault 安装热重载与 `dev:errors` 无报错（待本次运行后确认结果）。
  - **未测空白**：Windows 真机 Cursor 子代理及 Obsidian GUI 点击「更多 / 收起」现场目视验证。

## 1.13.25：全 Agent 已归档会话重激活恢复追踪

- **全 Agent 归档会话重新激活（取消归档 / 续聊）恢复追踪**：
  - `src/readers.js`、`src/main.js`、`src/task-status.js`：新增统一 `AgentUsage.isArchived(sid)`，修复 WorkBuddy `workbuddy.db` `deleted_at = -1` 非删除哨兵被误判为已归档的问题（改为 `coalesce(deleted_at, 0) > 0`），修复 `readCodexArchived` 15 秒节流在强制扫描/`organizeJournal()` 时陈旧以及覆盖桌面库归档集、未同步 `meta.archived` 的问题，并补齐 Cursor / Kimi Code 归档状态双向同步。
  - `src/autolog.js`、`src/sync.js`、`src/organize-journal.js`、`src/journal-archive.js`：统一追踪 `archivedDone` / `archivedOut` / 完成锚点（`doneAtMin`/`doneEndMs`/`doneRounds`），解决同日 `DONE`、被「归档已完成的日志到…」移出（`rec.gone`）、`JournalSync.finish()` `markBound`（`rec.skip`、`organizeJournal()` 链接传播及多会话 `finish()`）以及跨日 `originDayOf` 把已归档/已完成会话锁死的问题；取消归档或续聊后，同日原位重开并恢复 `^blockId`，已移出或跨日会话在今日日记新建条目并只补新轮次，同时保留人工 `DONE` 锁、真跨夜未完会话与 Grok Bot 闲置分段规则；新增 `test/reactivated-archived-sessions.test.mjs`。
- **验证范围与未测空白**：
  - **已实机验证（macOS arm64）**：全量 `npm test`（含 `test/reactivated-archived-sessions.test.mjs` 7 项测试）、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、本机 `~/.workbuddy/workbuddy.db` 只读核验（`2062572036538580992` `deleted_at = -1` 不再被标归档）、以及 `马自立` Obsidian Vault 安装热重载（`dev:errors` 无 `agent-deck` 报错，`plugin.usage.isArchived("2062572036538580992") === false`）。
  - **未测空白**：Windows 真机与各客户端真实 GUI 交互点击取消归档的现场录测。

## 1.13.24：Orca 追踪与聚合去重、Kimi Code v2 追踪与 ACP 委派、Antigravity ACP 修复

- **新增 Orca 桌面版只读追踪与底层分发会话去重（内置总数增至 20 家，`HARNESS_DETECTION_VERSION = 4`）**：
  - 新增 `src/orca-sessions.js`（定位 Orca Electron `userData` 下 `agent-session-domain.db`，支持 `ORCA_DATA_DIR` / `ORCA_USER_DATA_DIR` 环境变量隔离）与 128×128 图标 `assets/agents/orca.png`，补齐 `constants.js`、`agent-registry.js`（`trackingOnly: true`、`delegate: false`、`runnerKind: "handoff"`）、`agent-assets.js`、`icons.js`、`conversation.js`、`delegation.js`（`com.stablyai.orca` / `orca://`）、`journal.js`（`orca` 块号与短链前缀）、`harness-detect.js`（经 `appSub` 派生 `Orca.app/Contents/Resources/bin/orca` 与应用/数据探测）、`settings.js`、`security-audit.js`、`menubar.swift`、`styles/views/{editor,settings}.css`、中英繁文案与 `test/orca-sessions.test.mjs`。
  - `src/desktop-sessions.js` 与 `src/readers.js` 实现 Orca 会话与消息解析（兼容 `launchDirectory` 及 `location.workspaceId` `<repoId>::<path>` 提取 `cwd`、过滤 `role="reasoning"`、失败轮次状态回退、以内容与轮次时间戳作为 `revision`/`updatedAt` 锚点避免 lease 心跳导致重复扫描），并通过 `orcaDelegatedSids`（读取 `adopted_native_id` 与 `providerHandleChain[]`）及 `orcaOwnerOf` 接入统一 `delegatedOwners` 去重体系，在 `summary()`、侧栏、AutoLog、DashboardData、`JournalSync` 与安全审计中屏蔽底层拉起的 Antigravity / OpenCode / Claude / Codex 原生会话（关闭 `settings.agents.orca` 即时恢复）。
- **Kimi Code v2 会话解析升级与 `kimi acp` 后台委派（`USAGE_CACHE_VERSION = 23`）**：
  - `src/kimicode-sessions.js` 兼容 v2 `agents/main/wire.jsonl`（含自定义子代理目录）、`projects.json` 工作区映射、`profile.bind.modelAlias` 与 `step.end`/`usage.record` token 去重；`src/agent-registry.js`、`src/delegation-runners.js`、`src/constants.js` 接入 `kimi acp` 后台委派、`EFFORTS.kimicode`（`low`/`high`/`max`）、`handoffFallback: true`、`continueRequiresAcp: true` 与应用内续聊，并更新 `test/kimicode-sessions.test.mjs`。
- **Antigravity（`agy acp`）委派卡死修复与 Windows 代理 / 可执行文件兼容加固**：
  - `src/delegation-runners.js` 新增 `parseWindowsRegProxy` 读取 Windows 系统代理，`extractAcpText` 兼容文本块数组与 `\uFEFF` BOM 剥离，改用子进程 `close` 事件排水并在超时/异常时透出脱敏 `stderr`，补充 Windows `agy.exe`/`agy.cmd` 候选路径与 `windowsHide: true`，新增 `test/antigravity-acp.test.mjs`。
- **验证范围与未测空白**：
  - **已实机验证（macOS arm64）**：
    - **Antigravity**（`agy` v1.5.14）：实时拉取 11 个模型、验证 Turn 1 `autoApprove: true/false` + 权限回调、Turn 2 `continueSession` 与 `AgentUsage` 追踪（`state: "wait"`）；
    - **Kimi Code**（`@moonshot-ai/kimi-code` v2.7.3 + `DeepSeek/deepseek-flash`）：实时跑通 `kimi acp` 委派与 v2 `wire.jsonl` 会话追踪（2 轮、`calls: 2, out: 6, fresh: 49728, cached: 5248`）；
    - **Orca**（`Orca.app` v1.4.274）：实时拉起 Antigravity / OpenCode / Claude / Codex 4 条会话，验证真实 `~/Library/Application Support/orca/agent-session-domain.db` 全链路追踪（`"pong"` / `"wait"` / `"error"`）、4 条底层原生会话 `delegatedOwnerOf` 抑制、以及关闭 `settings.agents.orca` 后原生会话即时恢复；
    - 全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、Obsidian Vault `马自立` 安装与热重载、`outline-journal-app` 同步与 `npm run verify`（含 128 项 Electron 核对）均通过。
  - **未测空白**：Windows 真机下 Antigravity / Kimi Code / Orca / Obsidian GUI 实机交互（仅经 `test/antigravity-acp.test.mjs`、`test/kimicode-sessions.test.mjs`、`test/orca-sessions.test.mjs` 的跨平台路径与 `parseWindowsRegProxy` 单元测试覆盖）。

## 1.13.23：无序/有序列表块拖动委派全链路、不可委派卡片灰显与性能优化

- **无序/有序列表块拖动委派全链路、不可委派卡片灰显与性能优化**：
  - **能力判定与元数据单源（`src/agent-registry.js`、`src/workflow.js`、`src/custom-acp.js`、`src/journal.js`）**：新增 `canDelegateDrop(id)` 区分可委派/交接的 13 个内置 Agent + Custom ACP 项与 6 个 `trackingOnly` 项（`qwenwork` / `grokbot` / `cindy` / `muse` / `kimicode` / `doubaowork`）；`destinations` / `defaultDestination` 使用模块级常量表并支持动态注册的 Custom ACP 项；`agentDropMeta(plugin, id, metaKey)` 放在 `src/workflow.js` 并直接读取 `cap.terminalHandoff` 避免每帧分配；`syncCustomAcpRegistry` 补全 `soft` 颜色字段，`journal.js` `parseLink` 增加 `"🔗"` O(1) 快速退出、模块级正则/标签表及 `safeDecodeUri` 安全解码，支持 Custom ACP 短链往返解析。
  - **全量委派链路与列表语法兼容（`src/delegation.js`、`src/delegation-runners.js`、`src/dialog.js`、`src/task-mentions.js`、`src/main.js`）**：`STATUS_RE` / `blockTitle` / `markDelegated`（精简为单一正则优先判定）兼容无序（`-`/`*`/`+`）、有序（`1.`/`2)`）及复选框（`- [ ]` / `1. [ ]` / `2) [x]`）并修复前缀截断；`isCliSession` 与 `handoffCli` 补齐 `gemini` 分支；`continueSession` 与 `onunload` 补齐 `T3CodeRunner`，并精简 `T3CodeRunner` 二进制回退路径与 `ENOENT` 友好报错；`DelegateOptionsModal` 将 `t3code` 提示改为 `t("桌面版 / CLI")`；`main.js` 的 `delegateDrop` 用 `canDelegateDrop` 拦截不可委派目标，并在卡片/抓手显式指派（`explicitAgent: true`）时由 `mentionOptions` / `stripTaskMention` 在 `ignoreMention` 路径跳过多 `@` 互斥报错。
  - **侧栏卡片灰显、编辑器拖拽桥与悬停去重（`src/view.js`、`src/styles/views/dashboard-cards.css`、`src/editor.js`、`src/main.js`、`test/drag-delegate.test.mjs`）**：不可委派 `.ad-agentcard` 与待认领 `.ad-sess[data-pending="1"]` 标 `.is-no-drop`，在 `body.ad-dragging-item` 下呈现 `filter: grayscale(1)`、降透明、`cursor: not-allowed` 与子元素 `pointer-events: none`，并在悬停时显示 `.is-drop-blocked` 中性徽标、拒绝 `drop`；`AgentDeckView.render()` 在拖拽期间设 `_pendingRender` 延后重建，`agentCard` 记录 `dataset.dropHintDefault` 并按 `dataset.adHoverMeta` 去重 `dragover` DOM 写入；`editor.js` 以 `lineHasGripTarget` 修复 `.ad-grip` 残影，并在 `createEditorExtension(plugin)` 内注册 `installListDragBridge(plugin)`（提取 `dropMetaFor` / `isBindableSessionCard`、按 `hoveredCard` + `hoveredMetaKey` 悬停去重、`onMouseUp` 同步清零 `bullet` `dropVariant` 防误改、`isTrusted && buttons === 0` / `dragstart` 清理与选区还原）；`onunload` 与 `noteDragItem` 统一清理监听器、还原 `data-drop-hint` 并补画待刷视图。
  - **验证范围与未测空白**：全量 `npm test`（含 `test/drag-delegate.test.mjs` 末批 52 项、以及全仓库全部测试套件）、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、macOS Vault 安装与 `obsidian vault=马自立 plugin:reload id=agent-deck`、`dev:errors`（无插件报错）以及实机 `eval`（验证 `plugin._listDragBridgeInstalled === true`、`.is-no-drop` 卡片全卡 `cursor: not-allowed` / `grayscale(1)` / `opacity: 0.52` / 子节点 `pointer-events: none`、`.ad-sess.is-drop` `solid` 实线与 `copy` 光标；并用 `bullet` 实装插件与拦截至只读 `delegateDrop` 跑通无序项 → Claude、复选框项 → T3 Code、无序项 → Grok Bot 拦截、以及快速甩出不改笔记的完整拖放干跑；并独立干跑验证全 19 家内置 Agent `delegateDrop` 确认弹框与 13/6 分流）均已实测通过。未测空白：Windows 全端 Obsidian GUI、真手鼠标在笔记本与 `bullet` 插件下完整拖放手感（含多行有序列表页内直接拖出）、实际发送后的 CLI/桌面启动与 `DelegateOptionsModal` 内 `t3code` 弹窗文案目视验收。

## 1.13.22：块首全小写任务状态词识别与渲染

- **块首全小写任务状态词识别与渲染**：
  - `src/journal.js`（`TASK_KWS_RE_SRC`、`KEYWORD_RE` / `KW_WORD_RE` 词边界 `(?=\s|$)`、`splitTask`/`kwLine` 归一化大写、`RECORD_LINE_RE`/`KID_NORM_RE`/`bindInto`）、`src/keyword-style.js`（`keywordOf`/`isDoneKeyword`/`LOOKS_LIKE_TASK`/编辑器与阅读视图保留原文 `hit.raw` 并输出大写 `data-task-keyword`）、`src/task-status.js`（`STATUS_TOKEN`/`replaceTaskStatus`/`setTaskLineStatus`/点击状态菜单大小写一致校验）及 `src/external-state.js`、`src/record-icons.js`、`src/ai-records.js`、`src/main.js`、`src/dream-evidence.js` 同步支持块首全小写任务状态词（`todo`/`doing`/`done` 等），严格排除首字母大写英文正文（`Now`/`Wait` 等）与前缀粘连词（`nowhere`/`todolist`），未改动 `NAUTILUS_LINE_RE`；补齐 `test/keyword-style.test.mjs`、`test/task-status.test.mjs`、`test/done-flip.test.mjs`、`test/record-icons.test.mjs`、`test/external-state.test.mjs` 用例。
  - 验证范围与未测空白：macOS 隔离 `HOME` 全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`git diff --check`、`install:plugin` 与 `马自立` Vault 热重载（`dev:errors` 无插件报错）；未测空白：Obsidian 编辑器/阅读视图 GUI 内小写任务行的实际渲染目视验收与 Windows 端。

## 1.13.21：Cindy 真机联调修复、Harness 重探测全量补扫与 Windows CI 断言修复

- **实机联调 `Cindy v0.1.144`（macOS arm64，`/Applications/Cindy.app`，`com.xd.cindycn`）与 3 项修复**：
  - **Cindy 纯对话工作区归口（`src/readers.js`，`USAGE_CACHE_VERSION = 22`）**：新增 `CINDY_DIALOGUE_RE` 匹配 `/Cindy|CindyGlobal|xdt-maker/owners/<hash>/dialogues/...`，使 `isScratchCwd` / `normalizeProjectRoot` 稳定剥离、且 `projectName()` 统一返回 `"Cindy"`（避免 `summary().list[].dir` 暴露会话 UUID）。
  - **Harness 重新检测自动补扫历史（`src/main.js`）**：`redetectHarnesses()` 在检测到新增或移除客户端时调用 `scanNow(true)` 强制全量补扫，防止新装客户端此前已有的会话被 `lastScan - 60000` 跳过，并先发通知再后台开扫；补齐 `test/harness-detect.test.mjs` 回归断言。
  - **Windows CI 单测修复（`test/cindy-sessions.test.mjs`）**：为模拟 `darwin` `cindyDataDirs` 期望路径补齐 `path.resolve(...)` 修复 `windows-latest` 盘符差异失败，并新增 macOS/Windows `dialogues` 路径用例与 `USAGE_CACHE_VERSION >= 22` 断言。
- **实测范围与未测空白**：
  - 已验证：macOS 真机安装运行 `Cindy v0.1.144`（`cindy-cmwtodjad0pa6rz01k31xh509.db` 含活跃 `-wal`）全流程——自动探测开启、Codex 会话 `95672` tok 精确对账、Codex + 真实 `~/.claude/projects/.../1adfcbbf-*.jsonl` 双端跨库去重、`ConversationModal` 纯净渲染、`cindy://session/<id>` 深链前置聚焦并跳转原对话、设置页去重计数与 `dir: "Cindy"`、`马自立` Vault 热重载与 `dev:errors` 零报错；隔离 `HOME` 全量 `npm test`、`npm run build`、`npm run eval`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`。
  - 未测空白：Windows 全端 Obsidian GUI 与 macOS 本机 TeleAgent 客户端未实机测试（PR #12 TeleAgent P0/P1 曾由贡献者在 Windows 11 与 Linux Deepin 25 实机核验）。

## 1.13.20：PR #12（TeleAgent）合并、Cindy 收录、WAL 只读修复、统一聚合去重与视觉/UX 抛光

- **合并社区 PR #12（`feat/teleagent-support`，合并提交 `5c0847d`）并修复问题**：
  - 接入 **TeleAgent（星辰超级智能体）** 只读会话追踪（`src/teleagent.js`、`src/desktop-sessions.js`、`test/teleagent-sessions.test.mjs`）及 Windows UIA / Linux `xdotool` 客户端交接派发（`src/teleagent-dispatch.js`、`src/teleagent-dispatch-linux.js`、`src/native/treeland-activate.c`、`test/teleagent-dispatch*.test.mjs`）；合并后清理了 `docs/README.md` 与 `docs/specs/teleagent-adapter.zh-CN.md` 断链，补齐 `defaultRunSql` `-cmd .timeout 2000` + `PRAGMA query_only = ON;` 与 `menubar.swift` / `styles` / `security-audit.js` 中的 `teleagent` 适配。
  - 修复 PR #12 作者反馈的 `src/editor.js` `dropField` 参数命名遮蔽 `t as tr` 导致的运行时崩溃（`tr` → `tx`），并新增 `test/editor-drop.test.mjs` 回归保护。
- **修复 SQLite WAL 模式在无 `-wal`/`-shm` 伴生文件时的只读打开失败（`src/desktop-sessions.js`）**：
  - 修复正常退出且已 checkpoint 的 WAL 库（格式位 `2,2` 但磁盘无 `-wal`/`-shm`，实测于本机 `~/.t3/userdata/statev2.sqlite`）用 `sqlite3 -readonly` 报 `unable to open database file (14)` 的故障：无非空 `-wal` 时经 `toSqliteUriPath()` 使用 `file://...?immutable=1`，有非空 `-wal` 时先 `-readonly` 并在失败时回退 `PRAGMA query_only = ON;`。
- **新增 Cindy（`cindy`）只读会话追踪（内置总数增至 19 家，`USAGE_CACHE_VERSION = 21`，`HARNESS_DETECTION_VERSION = 3`）**：
  - 新增 `src/cindy-sessions.js`（探测 Electron `Cindy` / `CindyGlobal` / `xdt-maker` 目录、`cindy-*.db` / `xdt-maker-*.db`，支持 `CINDY_DATA_DIR` / `XDT_USER_DATA_DIR` 隔离覆盖，清洗 `\uE200cite…\uE201` 与独立 stop token）、`assets/agents/cindy.png`（Apache-2.0，128×128）、`src/desktop-sessions.js`（剥除默认标题 `'New Maker'`、`worktree_path > project_dir > working_dir`、区分用户 Fork 与 `orca_workers` / `bot_delegations` 子层级、`turnUsageDetails` 优先防重复计费、`requestId` 流式去重、过滤 `[UI_ACTION_TRIGGER]` / `autoResume` / 内联子工具 / 内部卡片）。
  - 补齐 `AGENTS.cindy`（`trackingOnly: true`、`archiveDetection: true`）、`cindy://session/<id>` 深链与 `com.xd.cindycn`/`com.xd.cindy` 唤起、`journal.js` 短链与块号前缀、`conversation.js`、`harness-detect.js`、`security-audit.js`（`tool_use` 提取）、`menubar.swift`、样式与中英繁文案。
- **T3 Code & Cindy 统一聚合去重体系（`delegatedOwners`）与真机修复（`51f72e7`、`9b43237`、`fa8b835`）**：
  - `AgentUsage` 将 `t3Delegated` 升级为多聚合端 **`delegatedOwners`**（支持 `setDelegatedOwners` 多库聚合、`mergeDelegatedOwners` 覆盖首次主力初始化与单卡局部重扫 `scanNow(false, { agent, days })`、全量强扫及 `rebuildUsage()` 前清空重建、`delegatedOwnerOf(sid, selfAgent)` 沿 `parentSid`/`cursorParents` 最多 5 跳父链向上传递去重、`t3OwnerOf`/`cindyOwnerOf` 兼容，并持久化至 `usage-cache.json.gz`；关闭聚合端时即时恢复底层会话）。
  - 扩展 `t3CodeDelegatedSids` 覆盖 6 张投影/运行时表并解码 `:native-thread:` 后缀（跳过 `provider-session:provider-instance:` 及 URL 编码 `pending%3A...` 占位符），新增 `cindyDelegatedSids`（`sessions.sdk_session_id`、`messages.agent_meta`、`agent_switch`、`subagent_runs`、`skill_usage_sources`）。
  - 全链路接入：`summary()`、`liveSessions()`、`sessions()`、`AutoLog`、`JournalSync`（`results` & `autoKeywords`）、`DashboardData`、`Delegator.resolveHandoffs`、`recommendPrimaryAgents`、`main.js`（主力初始化/重探测/`extState` 活态注入）、设置页「记录」卡片统计过滤（排除已被聚合端归并的底层会话）与 `runSecurityAudit`；新增 `test/cindy-sessions.test.mjs`。
  - **两轮 UX 抛光（`63c05e7`、`fa8b835`、`d7641bd`）**：
    - 日记圆圈轮次徽标 `.ad-round-badge`（`16×16`、`flex-shrink: 0`、`top: -0.15em`、`cursor: default`、悬停边框增强）+ 内层 `.ad-round-badge__num`（`text-box-trim: trim-both; text-box-edge: cap alphabetic;` 光学居中）与 Agent 图标 `.ad-agent-mark`（`top: -0.09em`）对齐正文基线，并本地化双语悬浮提示 `t("第 {n} 轮", { n })`；
    - 设置页启用中 T3 Code / Cindy 卡片底部展示 `.ad-hint` 实时去重计数，修正 `cindy` `continueInApp: false`，新增 `openExternalAsync` 在 `cindy://` 深链拒接时回退唤起客户端并提示，`journal.js` `parseLink` 补全 `T3 Code`/`Muse`/`Kimi Code`/`豆包工作`/`Gemini CLI` 等全部内置 Agent 标题前缀剥离。
- **实测范围与未测空白**：
  - 已验证：本机真实 `$HOME/.t3/userdata/statev2.sqlite` 只读读取（`desktopSessions` 返回 1 条会话，`t3CodeDelegatedSids` 精准提取 `01a202fc-9ea5-7321-8ca4-ceaf4f1a5cb9` 且排除 `pending%3A...` 并抑制底层 Codex 重复收录）、隔离 `HOME` 全量 `npm test`、`npm run build`、`npm run eval`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、Vault 安装与 Obsidian `马自立` 热重载（`version: "1.13.20", loaded: true, errors: []`，实机 DOM 验证 `.ad-round-badge` 光学居中与 T3 Code 设置卡去重计数提示）；GitHub Release [`1.13.20`](https://github.com/MatsuriMW/obsidian-agent-deck/releases/tag/1.13.20)、`Sync Wiki` 与 `CI`（`ubuntu-latest` / `macos-latest`）均已通过。
  - CI 实报细节：`CI (windows-latest)` 其余全量用例（含 Cindy SQLite/WAL/去重与 TeleAgent 全 42 项）通过，仅 `test/cindy-sessions.test.mjs:81` 一条断言因在 Windows Runner 下测试期望未用 `path.resolve()` 而带盘符失败（纯单测断言问题，非运行时故障）。
  - 未测空白：**本机未安装 Cindy 客户端与库**（`Cindy` 适配器基于 `makecindy/cindy` `main` 源码契约与本地真实 SQLite 夹具验证）；Windows 全端 Obsidian GUI 与 macOS 本机 TeleAgent 客户端未实机测试（PR #12 TeleAgent P0/P1 曾由贡献者在 Windows 11 与 Linux Deepin 25 实机核验）。

## 1.13.15 + 后续增量：Kimi Code / 豆包工作 / Gemini CLI（ACP + 追踪）、Antigravity CLI 追踪补齐与 Wiki/GitHub 自动化

- 新增 **3 家内置 Agent（内置总数增至 17 家）**，`USAGE_CACHE_VERSION` 升至 `20`：
  - **Kimi Code（`kimicode`）**：新增 `src/kimicode-sessions.js`，只读解析 `~/.kimi-code/sessions/<wsHash>/<sessionId>/wire.jsonl`（v1.5 协议，支持 `KIMI_CODE_HOME` 与 `~/.kimi/sessions` 回退）、`session-meta/state.json`（自定义标题、归档状态、模型）与 `workspaces.json`；精确统计 `inputOther + inputCacheCreation` / `inputCacheRead` / `output` Token；支持只读对话详情与桌面端唤起（`com.kimi.code.desktop` / `kimi-code://`）；当前保持仅追踪（`trackingOnly: true`）。
  - **豆包工作（`doubaowork`）**：新增 `src/doubaowork-sessions.js`，零外部依赖扫描 `~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb`（含 `.log` WAL 与内置纯 JS Snappy 解压的 `.ldb` SSTable 块）中的 V8 Structured Clone 会话列表元数据（`conversation_id`、`name` UTF-16LE/Latin-1、`create_time`、`update_time`）；完整正文存于 SQLCipher 加密的 `sdk_storage/*/messages.db`，严格不解密，Token/模型诚实显示为「用量未提供」/`0`；支持唤起 `com.work.pc.doubao` / `doubaowork://`。
  - **Gemini CLI（`gemini`）**：新增 `src/gemini-cli-sessions.js`，只读解析 `~/.gemini/tmp/<projectSlug>/chats/session-*.jsonl`（v0.70+，支持 `$set` / `$patch` / `$rewindTo`）及旧版 `session-*.json`，通过 `~/.gemini/projects.json` 与 `.project_root` 还原 `cwd`，自动剥离 `<session_context>` / `<hook_context>` 注入块，按 `input - cached` / `cached` / `output + thoughts` 精确统计 Token；`df59825` 进一步升级为内置 **`gemini --acp` 后台委派**（`src/agent-registry.js`、`src/delegation-runners.js`、`gemini-default` 默认模型）+ 应用内追问 + 终端 `gemini --resume <sid>` 续聊。
- 补齐 **Antigravity CLI 独立会话追踪**（`df59825`）：`src/readers.js` 与 `src/harness-detect.js` 新增扫描 `~/.gemini/antigravity-cli/brain`（与 `~/.gemini/antigravity/brain` 共用 `transcript.jsonl` 解析），补全独立 `agy` CLI 会话的本地追踪。
- **表驱动主力终端注册表扩展（`src/terminals.js`）**：将原硬编码在 `src/delegation.js` 中的 5 家终端抽离为表驱动注册表 `TERMINAL_REGISTRY`，新增 **cmux**、**tmux**、**Ghostty**、**WezTerm**、**Kitty**、**Alacritty**（共 11 家终端 + `auto`），并补齐 Windows `wt.exe`/`cmd.exe` 回退；`tmux` 在 `auto` 模式下仅在检测到活跃 CLI 会话跑在 `tmux` 内时自动命中（不因本机装有 `tmux` 二进制而抢占默认终端），并支持 `tmux` 与 `WezTerm` 窗格级焦点切换；同步修复 `src/main.js` `openTerminalAt` 误读 `settings.terminal`（应为 `settings.cliTerminal`）的问题；新增 `test/terminals.test.mjs`。
- **README 精简 + GitHub Wiki 体系 + GitHub 自动化**：
  - 中英 README 明确核心定位「以 Markdown / 大纲 / 日记为正本的多客户端 AI 总控台 + 长期记忆闭环」，突出主流模型全覆盖与中文 Agent 客户端生态；将详细支持矩阵、按需依赖与已知边界迁入 `docs/wiki/`（7 篇完整用户文档）。
  - 新增 `.github/workflows/sync-wiki.yml`（`docs/wiki/**` 自动同步至 GitHub Wiki，需先在网页端初始化首篇 Wiki 页面）、`.github/ISSUE_TEMPLATE/`（Bug 反馈与新 Agent 适配表单）与 `.github/dependabot.yml`。
- **AI 自动回传日志排版与图标升级（`src/journal.js`、`src/record-icons.js`、`src/styles/views/record-views.css`）**：简略模式「任务」「结论」改为 Markdown 加粗（`**任务**：…；**结论**：…`）；每轮结论行（含第 1 轮）去掉 `💬` 统一写为 `- 第N轮：…`（`❓` 提问行与 `💬 累计总结：` 不变），解析层与四视图投影完整兼容新旧格式；编辑视图（Live Preview，光标落入源码区间时退回原文）与阅读视图将 `第N轮：` 及历史 `💬 第N轮：` 渲染为圆圈数字 icon（`.ad-round-badge`），并将任务行中的 `🤖` 按 `^blockId` 前缀 / `🔗` / `⏱` / `autoLogState` 推断替换为对应 Agent 的官方桌面 App 小图标（`.ad-agent-mark`，未知来源回退保留 `🤖`）；新增 `test/record-icons.test.mjs`。未测空白：Obsidian 实机编辑/阅读视图目视验收、Windows 端。
- **Cursor 委派支持（CLI ACP + 桌面端交接回退）**：`src/agent-registry.js`、`src/constants.js`、`src/delegation-runners.js`、`src/delegation.js`、`src/workflow.js`、`src/settings.js`、`src/harness-detect.js` 解除 Cursor `trackingOnly` 限制，新增 `cursor-default` 默认模型、`destinations`/`defaultDestination`（支持 `background` / `desktop`）、设置页统一表驱动 `renderAcpCard`（`cursor` + `gemini` + 既有 ACP Agent）与 `agent acp` 后台委派（支持应用内续聊，`continueRequiresAcp: true` 保护桌面会话不误走 ACP）；未安装 Cursor CLI（`agent` / `cursor-agent`）或显式选 `desktop` 时自动走 `_performHandoff` 桌面端交接（复制提示词并唤起 Cursor，由已验证的 Cursor Hooks 认领写回）；`openAgentApp` / `openExternal` 补齐跨平台回退，`cleanEnv()` 在 macOS GUI 无显式代理时经 `scutil --proxy` 注入系统代理（60s 缓存），`allModels()` 动态聚合所有 `settings.delegate[*].availableModels`。新增 `test/cursor-delegation.test.mjs`。macOS + Obsidian 实机实测通过 `refreshAcpModels("cursor")`（8.6s 拉取 49 个模型、设置下拉框实时渲染 50 项）、剥离代理 `env -i` 模拟 Obsidian 实测 `Delegator.delegate` Turn 1（返回 `OK`）与 `Delegator.continueSession` Turn 2（同 `sid` `session/load` 完成）。*注：一次原生探针中 Cursor 服务端曾返回 `Internal error` / `RetriableError` 断连波动；本机 Gemini CLI 个人版被服务端停用提示迁移 Antigravity（但 `refreshAcpModels("gemini")` 已能 5.8s 通过系统代理连通）；Windows 真机未测。*
- **子代理日记去重（全 Agent 统一生效）& 豆包工作跨端会话读取修复**：`src/readers.js` 新增 O(1) `AgentUsage.isSubagentSession(sid)`、`markSubagent()`、`subagentSids` 集合与 `cursorParents` 持久化（`cacheJSON`/`loadCache`），并为 `noteMeta` 增加 `!fc?.sub` 守卫修复 Claude Code 子文件与母会话共享 `fc.sid` 导致的母会话误杀；`src/agent-ingestors.js`（Codex `source.subagent` 含无 `parent_thread_id` 的 review/compact 子代理、DSH `delegationDepth > 0`）与 `src/cursor-sessions.js`（`CURSOR_HOOK_VERSION` 升至 `2`，统一 `linkCursorChild`，并在 `sessionStart`/`afterAgentResponse`/`stop` 提前返回前完成父子绑定）补齐全量标记；`watchCursorEvents()` 启用时自动静默升级过期 `v1` Cursor Hook 至 `v2`（移除误调 `closeGrokBotWatcher()`）；`src/autolog.js`、`src/sync.js` 与 `src/delegation.js`（`resolveHandoffs`）统一跳过子代理，确保全平台所有 Agent 子代理均不再独立记作日记任务或被误认领。`src/doubaowork-sessions.js` 新增多路径/多 Profile（含 Windows `%LOCALAPPDATA%\DoubaoWork\User Data` 与 `Profile *`）及任意 `*doubao*.indexeddb.leveldb` 扫描，修复 `readDoubaoWorkSessions` 会话键改用 `path.dirname(conv.filePath)#sid`，并补齐 V8 数值时间戳（Int32 `0x49` / Double `0x4E`）与 `title`/`updated_at`/`created_at`/`last_message_time` 解析；`USAGE_CACHE_VERSION` 升至 `20`。**未测空白**：Windows 真机豆包工作实测；本机 DoubaoWork IndexedDB 明文仅含 2025-01 旧元数据（近期正文位于加密 `sdk_storage`）。
- **Muse 追踪收尾（`MAT-629`）**：默认过滤 Muse 主动推送消息（`museTrackProactive`，新增 `nonProactiveIds` 追踪用户触发的多气泡回复链）并将默认 `autoLogMinMinutes` 调整为 `1` 分钟；新增 `watchMuseCache()` 监听 `~/Library/Caches/ConversationCache`（加 `.catch(() => {})`），`setAgentEnabled` 加 `wasOn` 守卫避免重复弹提示；补齐 `watchMuseCache` 与多气泡链单测（`test/t3code-muse-sessions.test.mjs`）。
- **验证范围与代码审查收敛**：macOS 隔离 `HOME` 下运行全量 `npm test`（末批 `121/121 pass`，含 `test/kimicode-sessions.test.mjs`、`test/doubaowork-sessions.test.mjs`、`test/gemini-cli-sessions.test.mjs`、`test/cursor-delegation.test.mjs`、`test/models.test.mjs`、`test/t3code-muse-sessions.test.mjs`、`test/i18n.test.mjs`、`test/errors-i18n.test.mjs`）、`npm run build`、`npm run check:deploy`、`git diff --check`、`install:plugin` 与 `obsidian vault=马自立 plugin:reload id=agent-deck`；`checkBinary` 改用 `spawnCli` + `killChildProcess`（并修复 `timer` TDZ `ReferenceError`），在 Obsidian 实机验证 `cursor`/`claude`/`codex`/`gemini` 检测、Cursor Hook `v1→v2` 自动升级、Muse 追踪、`subInDay: []` 与 `dev:errors` 无新增报错。**未测空白**：Kimi Code 真实非空会话实测（本机当前 `sessions=0`）、Gemini CLI 真实 `gemini --acp` 完整回合委派、Windows 全端真机实测。

## 1.13.13 T3 Code（追踪/委派/去重）、Muse 分对话流追踪、离线安全回放闭环与按任务用量聚合

- 新增 **自定义 ACP Agent 通用入口**（`src/custom-acp.js` + `settings.customAcpAgents` + `src/settings.js`「委派 → 自定义 ACP Agent」卡片与弹窗）：支持用户直接填写任意 ACP 兼容 CLI 的 ID、显示名、命令路径、启动参数与环境变量（每行 `KEY=VALUE`，值经 `resolveSecret` 支持 `secret:KEY` / `env:VAR` 防明文），启动与保存时动态同步至 `AGENTS` / `AGENT_ORDER` / `CAPABILITIES`（`runnerKind: "acp"`, `continueInApp: true`），天然接入 `@` 路由、ACP 权限护栏、Trace 与应用内续聊，且不被 `harness-detect` 自动关闭；同步修复 `checkBinary` 在 macOS GUI 下传入 `cleanEnv()` 以避免 `PATH` 缺失报 `ENOENT`。同步将 `obsidian-agent-client` 其余 4 项借鉴（上下文占用指示器 + 会话 Fork、Obsidian Keychain、Windows WSL 模式、选区行号临时上下文 + 一键派发代码块）纳入 [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md) v4.2 与 Linear `P-MAT-42`。
- 新增 **启动自动检查更新与一键跳转更新**（`src/update-check.js` + `settings.updateCheck` / `updateCheckLastAt` / `updateSkippedVersion` + 命令 `check-update` + 设置页「关于 → 版本与支持」开关与「检查更新」按钮）：每天最多静默检查一次 GitHub Releases，发现新版时弹出带「去更新」（直达 Release 页面）、「社区插件页」与「跳过此版」按钮的提示条；新增单测 `test/update-check.test.mjs`。
- 升级 **协作回顾 Dashboard 与离线安全审计报告排版**（`src/dashboard.js`、`src/dashboard-data.js`、`src/analytics.js`、`src/security-audit.js`）：Dashboard 新增「跨会话任务投入」与「安全回放与护栏（7 天/30 天回放、打开报告与白名单统计）」卡片；安全审计补齐临时/构建目录降噪（`ignore_temp_noise`）、Antigravity `transcript.jsonl` 工具提取，并将报告明细从窄 6 列 Markdown 表格升级为**单文件内按「🔴 高危 / 🟠 中危 / 🟡 低危」分组 + 多行脱敏代码块**（兼容大写参数名 `CommandLine`/`Path`/`Replacement`/`Content` 与截断转义还原）。
- 升级 **三语功能示例 / What's New 导览与触发规则**（`src/welcome-demo.js`、`src/main.js`、`assets/menubar.png`）：确立「顶部 2 行极简上手（默认超过 3 分钟自动记录）→ **本期新功能永远置顶** → 交互练习沙盒在后」永久排版规范，去除内部技术术语并配齐 7 张静态截图（含新版支持右上角 Pin 置顶的 `assets/menubar.png`、去掉开头 `demo.gif`）；打开示例文档默认进入**阅读/预览模式（`mode: "preview"`）**；触发规则改为 `shouldOpenShowcaseForVersion`（首次安装、从 `< 1.13.13` 升级到 `>= 1.13.13` 含跨版本如 `1.12.x → 1.13.20`、以及后续任意大/次版本升级自动刷新弹出一次，同次版本补丁更新不打扰）。
  - **验证范围**：macOS 全量 `npm test`（含新增 `test/custom-acp-agents.test.mjs`、`test/update-check.test.mjs` 与 `test/security-audit.test.mjs` 新用例）、`npm run build`、`npm run check:deploy`、`git diff --check`，已安装热重载至 Obsidian `马自立` 库并实机验证：`openWelcomeShowcase({ force: true })` 默认预览态（`mode: "preview"`）、`checkForUpdates({ manual: true })` 连通 GitHub Releases、`checkBinary("smoke-acp")` 返回 `v24.12.0`、`runSecurityAuditReport({ days: 7 })` 生成分组多行代码块脱敏报告、`dev:errors` 无插件报错；**未测空白**：真实外部自定义 ACP CLI（如 Kiro / Gemini CLI）端到端派发、Obsidian 设置页弹窗与更新提示条目视点击、Windows 全端。
- 新增 **T3 Code（`t3code`）**追踪与委派支持、**Muse（`muse`）**只读会话追踪（`trackingOnly: true`），`USAGE_CACHE_VERSION` 升至 `17`：
  - **T3 Code**：只读解析 `~/.t3/userdata/statev2.sqlite`（支持 `T3_DATA_DIR` / `T3_STATE_DIR` 与 v1 `state.sqlite` 回退），覆盖 `orchestration_v2_projection_threads` / `messages` / `runs` / `run_attempts` / `provider_turns` 与 `projection_projects`（追踪 `worktreePath`、`archived_at`、子代理 `lineage.parentThreadId`、逐轮 `turnTokenUsage` 与模型名）；新增 `T3CodeRunner`（`src/delegation-runners.js`），经 `t3 thread start <cwd> - --wait --json` 与 `t3 thread send <sid> - --wait --json` 支持后台委派与应用内续聊（项目未登记自动 `t3 project add`，退出码 2 视为等待用户输入），唤起 `com.t3tools.t3code`（回退 `t3code://`）并复制会话号。
  - **Muse**：新增 `src/muse-sessions.js`，只读解析 `~/Library/Caches/ConversationCache/*.json`（如 `hatch-main.json`，支持 `MUSE_CACHE_DIR`），换算 Apple `CFAbsoluteTime`、提取 `contentBlocks`（`markdown` + `optionWidget`）并剥离 `[[hatch_widget:...]]`；云端 VM 无本地 token/模型，诚实保留 `0`/未提供（设置页显示「用量未提供」）；Muse 无公开 CLI / AppleScript / ACP 接口，保持仅追踪；唤起 `com.meta.endo`（回退 `hatch://`）并复制会话号。
  - 同步官方 128×128 图标（`assets/agents/t3code.png` / `muse.png`）、本机 Harness 自动探测、日记链接与块号前缀、样式配色、macOS 菜单栏 `src/menubar.swift` 及中英繁文案。
- 新增 **离线历史安全回放与白名单闭环**（`src/security-audit.js` + `src/security.js` + 命令 `security-audit-replay`「安全：回放最近 30 天会话的工具调用并生成审计报告」）：复盘 `plugin.usage.files` 最近 30 天的 JSONL/zstd（含 `zOff` 断帧回退）与桌面 SQLite 工具调用（Claude Code、Codex、DSH、WorkBuddy、Cursor、Hermes、MiniMax Code、OpenCode、QwenWork、Qoder、T3 Code），复用 `evaluatePermissionPolicy` 与 `redactSecrets` 检测高危命令、结构化/Shell 敏感凭据路径、工作区外写/删与明文密钥，按严重度优先输出脱敏报告 `Agent Deck/安全审计.md`；支持在报告 frontmatter 的 `allowlist:` 中维护 `path:`/`cmd:`/`risk:` 白名单，重跑审计时自动同步至 `settings.securityAllowlist` 并立即生效于 ACP 实时护栏（`secret_exposure` 永不放行）。
- 新增 **按任务跨多会话/多 Agent 用量与活跃时长聚合**（`src/task-metrics.js` + `src/main.js` `lineMap()` + `src/editor.js`）：同一任务块绑定多个 `🔗` 会话时，在编辑器 pill/token 徽标展示合并 token、去重活跃时长（`unionSegs`）与会话数（`×N`），悬浮提示展示各 Agent 分项明细。
  - **验证范围**：macOS 全量 `npm test`（含新增 `test/t3code-muse-sessions.test.mjs`，覆盖 `T3CodeRunner` mock CLI 委派/自动加项目/续聊/等待态）、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`，以及本机真实 `T3 Code (Beta).app` / `~/.t3/userdata/statev2.sqlite` 与 `Muse.app` / `~/Library/Caches/ConversationCache/hatch-main.json`（30 条消息 / 11 轮）只读实测通过；**未测空白**：对真实运行中 T3 Code 服务发起真实委派写入与含非空 `turnTokenUsage` 的会话库、Windows 全端。

## 1.13.12 MiniMax Code 支持、繁体中文与日记整理优化

- 新增 **MiniMax Code（客户端 + `mcode` CLI/ACP）**支持（`minimax`）：只读解析 `~/.minimax/v2/sqlite/runtime-state.sqlite`（支持 `MINIMAX_DATA_DIR` / `MAVIS_DATA_DIR` / `~/.mavis` 回退，`local_runtime_sessions` / `local_runtime_message_rows` + 旧 `local_runtime_messages` 回退 / `local_runtime_token_usage` / `local_runtime_projects`，跳过 `visibility='hidden'`，追踪 `archived` 与 `parent_session_id`），`USAGE_CACHE_VERSION` 升至 `16`；支持本机 Harness 自动探测（`MiniMax Code.app`、`mcode` CLI、`~/.minimax`）、`mcode acp` 后台委派/应用内续聊、终端 `mcode --session` 续聊与桌面端 `com.minimax.agent.cn`（回退 `com.minimax.agent` / `minimax-cn://open`）唤起；同步官方图标、设置页卡片、菜单栏配色与中英繁文案。验证：macOS 全量 `npm test`（含新增 `test/minimax-sessions.test.mjs`）、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、本机真实 `MiniMax Code.app` + `~/.minimax/v2/sqlite/runtime-state.sqlite` 探测与只读查询通过；未测：真实 `mcode acp` CLI 委派（本机未装 `@minimax/code` CLI）、带非空真实会话的桌面库、Windows 全端。
- 手动重扫联动今天的日记并汇报结果，跨天自动记录保留原会话入口，任务标题统一显示会话时段。
- 日记路径跟随 Obsidian 核心「日记」设置。测试覆盖默认 `YYYY-MM-DD`、自定义路径和修改后立即生效。
- macOS 实测重扫有提示、日记已有记录会更新、DOING 时段会推进，Codex 进度条打开原会话。新增条目在隔离日记中验证。Antigravity 桌面会话打开客户端并复制会话 ID。Windows 界面未测。
- 两插件沿用螺旋日程可调日界。以 00:00 连续验证重扫、螺旋刷新、定位日记和打开对应 Codex 会话，未重复建项。
- Dream 采集和记忆提炼分开。后续主题与用语分析共用带来源的材料入口。方向见 [Dream 分析扩展](specs/data-and-markdown-contracts.md#dream-分析扩展)。

## 核心构想（接手先读这段）

**AI 生成或调用的一切都是 Markdown，所以一切都要能被人直接读、直接改、改完立刻生效。**

三条原则：

1. **Markdown 是唯一正本**——Base、看板、工作台都是投影，删掉不丢数据，改了就改数据；
2. **双链管归处，块号管精确**——行号会漂（实测 33 条记忆 10 条漂过），`[[笔记#^块号]]` 才靠谱；
3. **每份 Markdown 必须有"生效路径"**——记忆靠注入、技能靠路径、任务靠看板派发、规格靠引用时给全文路径。文件躺在库里不等于有用。

与 RAG 的分野：**结构优先**（人工标注的大纲/双链/frontmatter 信噪比高于 embedding），检索只做兜底，**不存关联分数、只存信号**。

完整构想与已落地映射见 [`specs/vision-markdown-harness.zh-CN.md`](specs/vision-markdown-harness.zh-CN.md)；契约见 [`specs/context-protocol.zh-CN.md`](specs/context-protocol.zh-CN.md)；方向与落地记录见 [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md)。

## 交接时必须知道的风险与未确认项（2026-11-18 收尾更新）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 本批改动同步 | ✅ **已发版 `1.13.8`**（tag + GitHub Release，见本页「本批发版基线」）；`origin/main` 已包含这两轮改动 |
| 2 | README 落后于功能 | ✅ 中英文各补一节「笔记即上下文：记忆库 / 派发草稿 / 技能卡」 |
| 3 | Linear `P-MAT-42` 同步 | ✅ **已对齐 Milestone v4**（新建 M1.1–M3 里程碑及 `MAT-637`–`MAT-644`；因工作区免费 issue 上限，M2.2/M2.3/M3.1–M3.3 待删掉 13 张 Done 卡后补建） |
| 4 | 测试夹具改动（`startup` 补 `addRibbonIcon`、`models` select +1、`task-export` 补 `WorkspaceLeaf`） | ✅ 已确认是预期变化，非回归 |
| 5 | 未实测项 | 🟡 部分关闭：**Planner（`agy` CLI）、Antigravity CLI（`@antigravity` `agy` CLI 两轮 `continueSession` 与 `memory-query.mjs` 工具权限；早期曾测通 `agy acp` 但已因防反代风险全面停用）、阅读模式草稿发现、记忆看板跨列拖拽、设置页管家/工作模式/看护开关、回复弹窗/信箱/入站、AI 记录 Pin 与 macOS Menu Bar 常驻/置顶/Antigravity 自动标题生成已在 Obsidian + macOS 真库验证**（共修复 6 个 bug 并补回归测试）；**仍未测**：Windows 全端、真实长跑 AI 会话 15 分钟卡住整轮、Menu Bar 悬浮窗拖拽交互肉眼目视确认 |
| 6 | 库内示例文件与 134 张技能卡 | ✅ **保留**（示例是活文档；技能卡可随时用 `技能：刷新技能卡` 重建或整目录删除） |
| 7 | 记忆文件名 22 → 40 字 | ✅ 已做：`memorySlug` 上限改 40，33 个文件重命名，`ensureReverseLinks` 归一化后 **0 条孤儿回链** |
| 8 | `mem-` 加日期前缀 | ❌ 已决定不做 |

## 双平台验证边界

| 平台 | 已验证范围 | 未覆盖 / 已知代码缺口 |
| --- | --- | --- |
| **macOS** | 全量 `npm test`、构建、`swiftc` 编译与运行（`AgentDeckMenuBar.app`）、Vault 安装与热重载（Obsidian `马自立`）、Antigravity 官方 `agy` CLI（`--output-format stream-json` / `--resume` / 27 模型）与记忆/入口地图查询、`preview` 模式草稿读取、Dashboard、AI 记录 Pin（大纲与阅读视图 DOM）、Menu Bar 会话置顶命令队列、9 家外部 MCP 客户端探测与 `dsh` Cordis YAML / `verifyMcpHandshake` 握手、Outline Journal 打包 `.app` 冒烟 | 终端交互仅实测 Tern / Herdr；11 家内置可委派客户端（+ 自定义 ACP）全量逐一派发、Menu Bar SwiftUI 悬浮窗口拖拽手感待人手目视微调；日常 20 次自然生产派发 `entryMapMode` 呼出率抽检待积累 |
| **Windows** | `windows-latest` CI 曾通过全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`（社区 PR #7 亦在 Windows 11 实机跑通全量测试）。本轮在 Windows Server 2025 的 Obsidian 中实测 WezTerm 和 WSL 2 tmux，各跑两轮 | Windows 11 用户桌面与其余 Windows 终端的 GUI 待实测。已运行 CLI 会话的标签页定位待适配，`src/readers.js` 在 `win32` 跳过 `claudeDesktop` |

## 本批发版基线（1.13.6，2026-11-19，已构建并三端 CI 全绿）

`1.13.6` 在 `1.13.5` 基础上收口非 macOS 平台的菜单栏 UI/命令与 CSS `:has()` 审核告警：
- 非 `darwin` 平台隐藏设置页菜单栏控件与 `open-menubar-panel` 命令，不自动隐藏螺旋日程 Agent 汇总，`MenuBarBridge` 彻底静默空操作；同步更新中英文 README 的 Windows 适配现状说明。
- 将 `src/styles/views/modals.css` 与 `src/styles/views/settings.css` 中的 `:has()` 选择器替换为显式类 `.modal.ad-conversation-modal` 与 `.ad-row.ad-row--stack`。

`1.13.5` 合并社区 PR [#7](https://github.com/MatsuriMW/obsidian-agent-deck/pull/7)（`@buaaflyaway`）并补齐收尾，实现 Windows CLI 兼容修复与三端 CI 全绿：
- **Windows 运行时修复**：`src/llm.js` 超时改用 `killChildProcess` 终止进程树并重试清理临时目录，`.cmd`/`.bat` 多行提示词压平防 `cmd.exe` 截断；`src/project-folders.js` 家目录反斜杠归一化并忽略大小写比较；`src/delegation-runners.js` 在 `win32` 下按 `PATHEXT` 优先匹配扩展名（避免命中 npm 同目录无后缀 POSIX 脚本）并回退至 `PATH` 查找。
- **测试夹具与三端 CI**：修正 `test/menubar-startup.test.mjs` 的 `fileURLToPath`、`test/cursor-sessions.test.mjs` 的 `USERPROFILE`/`APPDATA` 隔离、`test/acp-hermes-qwenwork.test.mjs` 平台断言，以及 `test/dsh-feedback.test.mjs` / `test/antigravity-acp.test.mjs` 的 `session/cancel` 轮询等待；`ubuntu-latest` / `macos-latest` / `windows-latest` 三端 CI 均全绿。

`1.13.4` 完成本机 Harness 自动探测降噪、模型列表即时保存与「不指定模型」全链路收口：
- **本机 Harness 自动探测与界面降噪**：新增 `src/harness-detect.js`（`detectInstalledHarnesses` / `applyHarnessDetection` / `pickDefaultDelegateTarget`），启动首次探测并默认关闭未安装的 Harness（兼容首次安装、老配置一次性迁移保留已装项的手动关闭、以及命令面板/设置页「重新检测 Harness」同步）；`Claude.app` 单独存在不误判为 Claude Code。设置页、侧栏面板、`DelegateOptionsModal` 与 `AutoLog.agentOn` 统一过滤未启用项以保持页面干净。
- **模型列表易用性、DSH 默认模型与 `@` 频次排序**：修复关闭模型（含当前默认模型）未保存或回弹问题，切换开关、分组标题行 `＋ 添加`（DSH `Provider route` 可选）、`全部开启/全部关闭` 与删改恢复均即时持久化，各 Agent 配置卡增加「管理模型」直达按钮。DSH 默认使用 `dsh-default`（不向 ACP 传模型覆写，直接使用 DSH 客户端当前默认/第三方模型；老库内置 DeepSeek 预设首次加载一次性迁为 `dsh-default`）；CLI/ACP/Codex runner 支持留空/`*-default` 跳过模型参数；`@agent/` 二级补全菜单将 `*-default` 固定第一位，其余模型按 `usage.meta`、`jobs` 与 `settings.models.callCounts` 调用次数从高到低排序。
- **验证**：macOS 已通过全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check`、Vault 安装与 Obsidian 热重载（核对 `data.json` 迁移）；Windows 真机及 Obsidian 设置页视觉点击未实操（macOS/Linux/Windows 三端由 CI 验证）。

`1.13.3` 重做了 AI 自动记录的右键菜单：Pin 挪到第一位并去掉图标，新增复制这一轮（任务与结论 / 只复制结论）、查看原会话、跳到母任务、带二次确认的删除；记录菜单项收进独立分区排在 Obsidian 默认项之前，解析不到会话或旧版菜单 API 时降级。解析、母任务定位、删除范围抽到 `src/record-menu.js` 并有 `test/record-menu.test.mjs` 覆盖；实机用 fake menu 触发 `editor-menu` 验证过顺序、无图标与会话项。

`1.13.2` 完成两件事：**千问办公 2.x 会话追踪**（读取新版客户端内置引擎的 SQLite 会话库，保留旧版 `projects` JSONL 回退，剥除首条用户消息里引擎注入的工作区说明与工具清单，缓存版本升到 15 以重读旧缓存）；**README 改版**（开头加目录与三张功能图，功能段落只留用户视角，新增记忆 Base 表格截图，英文版同步）。已随 tag `1.13.2` 发布（[Release](https://github.com/MatsuriMW/obsidian-agent-deck/releases/tag/1.13.2)），macOS / Ubuntu CI 通过；`windows-latest` 仍卡在 `test/llm.test.mjs` 的两处既有失败（超时清理 `EBUSY` 覆盖原错误、`agy --print` 断言），本次未处理。

上一版 `1.13.1` 在 `1.13.0` 基础上依据首次 `windows-latest` CI 实报缺陷完成跨平台兼容性修复（`src/sqlite.js` 跨平台探测替换 `/usr/bin/sqlite3`、Windows `.cmd`/`.bat` CLI 拉起、`CodexDesktopRunner` trace 与脱敏补齐、跨平台测试垫片 `test/helpers/mock-cli.mjs`）并面向用户刷新中英文 README 功能说明。接手后续 M1.2 / M1.3 时先看本节，再看 [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md)（方向）与 [`specs/context-protocol.zh-CN.md`](specs/context-protocol.zh-CN.md)（契约草案）。

**新增模块**

| 文件 | 职责 |
| --- | --- |
| `src/memory-store.js` | 记忆文件序列化/解析、YAML 引号、文件名 slug、概览区块、`orderForReview`、`memoryBase` |
| `src/memory-review.js` | 逐条审阅弹窗（下拉选状态） |
| `src/memory-board.js` | 记忆看板 ItemView（按 `state` 三列，拖拽写回 frontmatter） |
| `src/planner.js` | 目标 → task.md（提示词、解析、看板友好结构） |
| `src/workbench-note.js` | 工作台总览索引（只索引不复制） |
| `src/skill-cards.js` | 扫描 `~/.config/skillshare/skills/data`、`~/.dsh/skills`、`~/.claude/skills`，按 realpath 去重，生成库内技能卡（真实路径记 frontmatter） |
| `src/session-tree.js` | 会话卡片的父子树：先序排父后子、层级缩进；父不在列表/自环/成环都铺平不丢卡（只排顺序，不参与统计、不改派发） |
| `src/steward-watch.js` | 管家中途干预的判定：波次内 worker 超过 15 分钟没输出才算「卡住」；出错 / 等授权只分类不重复提醒（各自有主） |
| `src/thread-replies.js` | 回复协议（纯文本）：解析 `❓` / `✍️ 答` / `💬`，判待答、补空行、幂等写回、下一轮回灌段、从问句猜可点选项 |
| `src/reply-modal.js` | 回复提问的单字段弹窗：预填上次答案、选项 chips、按钮「记下回答 / 回答并继续」 |
| `src/reply-inbox.js` | 回复信箱的纯逻辑：入箱去重、出箱、排序、渲染前回笔记核对（`stillPending`） |
| `src/work-modes` | 见 `src/dialog.js`：一次派发能选的工作模式（claude/qoder 是 permission，codex 是 sandbox），默认值来自设置 |
| `src/memory-query-core.js` | 无 Obsidian 依赖的记忆分词、单英文技术词/元数据召回补盲与 `private: true` / `excludedDirs` 隐私闸门 |
| `src/reply-inbox-view.js` | 回复信箱侧栏视图：非模态、不抢焦点；草稿不因刷新丢失；「原文」跳定位、「回答并继续」走同一条 `applyReply` |

**改动过的既有模块**：`src/dream.js`（记忆库双模式、来源锚点、反向回链、体检、`agentText` 注入）、`src/delegation.js`（派发载荷落盘、`payloadName`/`writeTaskPayload`）、`src/harness.js`（`agentText` 注入降噪）、`src/main.js`（10 条新命令、ribbon、工作台、载荷归档）、`src/settings.js`（管家 Agent 下拉）、`src/project-workbench.js`（文件级看板合成根）、`src/fractal-board.js`（`taskBoardFiles` 开关）、`src/journal.js`（`readableSlug`）。

**新增设置键（`data.json`，`STORE_VERSION` 不变）**

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dream.inject` | `true` | 派发时注入相关记忆 |
| `dream.store` / `dream.dir` | `text` / `Agent Deck/记忆` | 记忆存储模式与目录；`files` = 一文一条 |
| `dream.backlinked` | `[]` | 加过回链的源文件，用于清孤儿回链 |
| `taskBoardFiles` | `{}` | 整篇笔记当看板的文件开关 |
| `stewardWatch` | `false` | 管家中途看护：开着时每 5 分钟看一次波次，卡住提醒一次并写回子卡 |
| `delegate.claude.permission` | `auto` | 派发确认框「这一次的权限 / 工作模式」的默认值（plan / auto / acceptEdits / manual） |
| `delegate.codex.sandbox` | `workspace-write` | 同上，Codex 口径（read-only / workspace-write / danger-full-access） |

**新命令速查**

| 命令 | 作用 |
| --- | --- |
| `记忆：把长期记忆迁移到记忆库` | 单文件 → 一文一条（一次性） |
| `记忆：确认 / 拒绝当前这条记忆` | 写回 `state`、`verified` |
| `记忆：逐条审阅（下拉框选状态）` | 起点跟随光标（记忆文件 / 日记回链行） |
| `记忆：打开记忆看板` | 三列可拖拽；ribbon 默认打开 Base 表格 |
| `记忆：体检` | 无来源 / 待审 / 重复 / 待复核 → `记忆-体检.md` |
| `记忆：重新锚定来源` | 按原文反查行号，漂移则修正，原文被改则只报告 |
| `记忆：给被提炼的原文加块号` | 原文行尾补 `^mem-xxxxxxxx`，可双向跳转 |
| `记忆：在原文列表项下加回链` | 插入 `- ⤴ [[记忆/…]]`，段落跳过 |
| `规划：把当前这一条拆成 task.md` | 光标行当目标，产出可被看板直接解析的文件 |
| `看板：把当前笔记设为看板文件` | 无母项结构时合成根 |
| `工作台：刷新总览` | 生成 `Agent Deck/工作台.md` |
| `派发载荷：归档 30 天前的旧文件` | 未被引用且超期的移到 `派发/归档/YYYY-MM/` |
| `派发载荷：列出被改过的载荷` | 比对 hash，汇总到 `派发-已改动.md` |
| `委派：先生成草稿（不发送，看完再点委派）` | 只写草稿并双链挂回任务块；点委派时优先用草稿正文 |
| `打开回复信箱（非模态，不抢焦点）` | 侧栏里列出所有待答 `❓`；`settings.replyInbox` 记注册表，渲染前回笔记核对 |
| `回复当前任务的提问（写回 ✍️ 答）`（`Ctrl+Alt+R`） | 光标所在那一块有待答 `❓` 时开单字段弹窗；「回答并继续」会续聊同一会话 |
| `在提问下补一行「✍️ 答」（直接手写）` | 不弹窗，只在 `❓` 下面补空行并把光标放进去 |
| `技能：刷新技能卡` | 134 个外部 Skill → `技能/<name>.md` + `技能/索引.md`；委派时写 `skill: "[[技能/x]]"` 即把真实 SKILL.md 路径交给 Agent |

**验证**

- `npm test`（含新增 `dream-context` / `memory-store` / `planner` / `workbench-note` / `memory-board` / `block-id-readability`）全过；`npm run build`；`git diff --check`。
- macOS 真库实测（2026-11-18 晚上复测）：全量 89 个测试文件（`npm test`）、`npm run build`、`swiftc -typecheck src/menubar.swift`、`git diff --check` 全过；Obsidian `1.15.1`（`马自立` 库）实机验证：`记忆.base` 查询（33 条）、`memory-query.mjs` CLI 四场景、`MemoryBoardView` 跨列 HTML5 拖拽状态写回、设置页 5 页与管家/工作模式/看护渲染、侧栏「现在」三视图切换、`ConfirmSendModal` 4 家 Agent 工作模式切换与 `.ad-send__modes` flex 布局、`委派：先生成草稿 → 人工修改 → payloadSnapshot` 闭环、回复协议无 `blockId` 入站捕获、`ReplyModal` chips 选择写回与 `ReplyInboxView` 焦点保持/核对移除、`stewardWatchTick` 去重提醒、以及 `updateNote` 删笔记后不误写残留编辑器。
- **2026-11-19 收口与示例全流程复核**：
  - **修复 7 处真实 bug**：① `Delegator.delegate` 在消费用户编辑后的草稿时误调用 `enrichPrompt` 并被 `resolved.bundle` 覆盖回原始正文（改为 `useRawPrompt: true` 在草稿正文上幂等富化并保留 `lead`）；`enrichPrompt` 与 `extractWikilinkRefs` 统一屏蔽行内反引号与围栏代码块里的示例双链并剥离技能名 `.md` 后缀；② `writeWorkbenchTasks`（`src/main.js`）在已有任务行写入子任务时误引用未定义变量 `grp?.title` 导致 `ReferenceError`（改为 `parentTitle || lines[existingBlock.start] || ""`）；③ `planTask` / `auditMemory` / `refreshWorkbenchNote` / `listEditedPayloads` 在全新 Vault 缺少 `Agent Deck/` 或 `Agent Deck/任务/` 目录时 `vault.create` 报错（新增 `writeVaultFile` 自动建父目录）；④ `taskBoardExtension` `StateField.update`（`src/fractal-board.js`）、`toggleTaskBoardAt` 与 `planTask`（`src/main.js`）补传 `fileBoard`；⑤ `openMemoryBoard` 放行未迁移 Vault 直接打开，在看板内提供「初始化 / 迁移记忆库」按钮并本地化列标题、修复拖入文件后列高亮残留；`MemoryImportModal` 增加关闭保护防止异步回调重绘已关闭弹窗；⑥ `thread-replies.js` 兼容英文 `Round N:` / `Answer:` 语法，`applyReply` 回答后同步移除 `replyInbox` 对应条目；⑦ `reconcileMemoryFile` 对含冒号/特殊字符的附加 YAML 标量安全加引号。
  - **M1.1 收口迭代**：抽离 `src/memory-query-core.js`（单英文技术词元 + 元数据召回补盲）与 `private: true` / `settings.delegate.excludedDirs` 隐私闸门，接入 `harness.js`、`delegation.js`、`dream.js`、`settings.js` 与 `scripts/memory-query.mjs`；新增 `test/showcase-flows.test.mjs` 与 `test/memory-query.test.mjs` 隐私用例，验证 `welcome-demo.js` 中英文示例 §1–§4 关键链路。
  - **生产四要素加固（Eval / Trace / Deploy / Security，2026-11-19）**：
    - **Security（`src/security.js`）**：`runOpenAiApi` 接入 `resolveSecret`（支持 `env:VAR` 与 Vault 外 `~/.agent-deck/secrets.json` `0600` 读写的 `secret:key`）与 `redactSecrets`（HTTP 报错、`job.command`、`job.stderr` 脱敏）；ACP `session/request_permission` 与 `requestAcpPermission` 接入 `evaluatePermissionPolicy`（`autoApprove=true` 下对高危命令、`.ssh`/`.aws`/`.env` 等敏感路径与工作区外写删强制升阶人工确认）；`openTerminalAt` 统一收口至 `openTerminal`，使用 `appleScriptString` 转义与独立 Warp 配置名；`src/delegation.js` 路径拼接统一改用 `path.join`。
    - **Trace（`src/trace.js`）**：每次派发生成 `traceId` 串联 `context.resolve`、`payload.snapshot`、30 帧协议环形缓冲（覆盖 ACP / Claude / Qoder）、权限决策与错误分类，落盘 `~/.agent-deck/traces/YYYY-MM-DD.jsonl`（默认测试态不落盘 + 14 天滚动清理）；新增命令 `export-diagnostics`（「导出脱敏诊断报告」），汇总版本、`ASSET_VERSION`、`_faultBreakers` 与 6 家 CLI provider 探测。
    - **Eval（`scripts/eval-context.mjs` + `test/context-eval.test.mjs`）**：新增纯 Node 离线上下文评测（记忆召回/精确率/隐私/预算、Harness 零静默丢失、KV-Cache 前缀稳定性、提示词块号剥离与问答提取卫生），接入 `npm run eval` 与 `npm test`。
    - **Deploy（`scripts/check-deploy.mjs` + `.github/workflows/ci.yml`）**：新增三端（Linux/macOS/Windows）CI 矩阵（含 `swiftc -typecheck`）、`main.js`/`styles.css` 体积预算检查及 `MEMORY_QUERY_ASSET_VERSION` 漂移探测；同步更新 `release.yml`。
  - **1.13.0 发版验证边界**：全量 `npm test`、`npm run eval`、`npm run build`、`npm run check:deploy`、`swiftc -typecheck src/menubar.swift`、`git diff --check` 在 macOS 全过；并在 Obsidian `1.15.1`（`马自立` 库）装库热重载实测：`export-diagnostics`（`version: 1.13.0`、`assets.ok: true`、3 组 `_faultBreakers` closed、6 家 CLI 可用）、`open-dashboard` / `open-review` / `memory-board-open` / `reply-inbox-open` / `scan-now`、以及库内 `memory-query.mjs recent 2` 均无报错；**未覆盖**：真实云端模型调用、Obsidian 鼠标点击目视复验及 Windows 实机验证（Windows 已加入 CI 矩阵待远程运行）。
- **仍未实测**：Windows 全部；真实 AI 会话长跑卡住 15 分钟以上的整轮触发；Planner 本轮未重跑真实云端模型调用。
- **本轮上线前复测修掉的 4 个真 bug（2026-11-18 晚上）**：① `Dreaming.setEntryState`（`src/dream.js`）切回 `有效` 时会在 frontmatter 内插入并累积多余空行（已修并在 `test/memory-store.test.mjs` 加回归断言）；② `appendQuestionText` / `anchorThreadText`（`src/thread-replies.js`、`src/delegation.js`、`src/main.js`）在任务尚无 `^blockId` 时回退到文件第 0 行把 `❓` 插到任务块上方（已传入 `atLine` 并抽共用 `resolveBlockRange`）；③ `lastQuestionLine` 未屏蔽围栏代码块里的示例 `❓`（已接入 `fencedLines`，并在 `test/thread-replies.test.mjs` 补用例）；④ `ConfirmSendModal` 的 `.ad-send__modes` 缺少 CSS 规则导致工作模式芯片紧贴换行异常（已补入 `src/styles/views/modals.css`）。
- **下一轮修复与降摩擦改造（2026-11-18 夜间，按 `next-round-fixes-handoff.md` 落地 P0–P2 全 8 项）**：
  1. **Antigravity ACP 自动允许与权限弹窗快捷授权**：设置页（`src/settings.js`）`antigravity` 卡片与委派弹窗（`src/dialog.js` `DelegateOptionsModal`）补齐 `autoApprove` 开关；`AcpPermissionModal`（`src/conversation-modal.js`）新增「允许并开启 {agent} 自动允许」一键按钮，授权当前工具的同时保存 `settings.delegate[agent].autoApprove = true`（`Delegator` / `AcpRunner` 同步兼容任意 `allow*` / `reject*` kind）。
  2. **`dispatchRefresh(this)` 误传 `this.app` 修复**：`planTask()` 与 `toggleBoardFile()`（`src/main.js`）改传插件实例 `this`，文件级看板切换不再触发未捕获 `TypeError`。
  3. **Obsidian 内多轮续聊收口与清理**：新增 `canContinueSession(session, jobs)`（`src/agent-registry.js`），约束 `ReplyModal`（`src/main.js`）与 `ReplyInboxView`（`src/reply-inbox-view.js`）的「回答并继续」仅在支持应用内续聊且 `sid` 就绪的会话（`dsh` / `opencode` / `antigravity` ACP）展示；`ConversationModal` 保持纯只读，在 `taskActions` 菜单提供轻量单框追问弹窗 `FollowUpModal`（`src/dialog.js`）并清除 `canOpenClient` 下语义重复的「继续对话」菜单项（只保留唯一的「在客户端打开」）；`J.parseLink`（`src/journal.js`）补入 `antigravity` 协议链接识别，`Delegator.continueSession`（`src/delegation.js`）在无历史 job 时保留 `path` / `blockId` / `destination` / `transport` 并按笔记已记录轮次计算 `roundOffset`，避免重载或清理 jobs 后 Turn 2 写回被 `hasRecordedTurn` 跳过。
  4. **Reading view（`preview` 模式）防陈旧读取**：`planTask`、`makeDispatchDraft`、`gripSend`、`taskActions`、`replyToQuestion`、`openReplySource`、`gripPick`、`delegateAtLine`、`openProjectWorkbench` 命令（`src/main.js`）与 `applyStatusChoice`（`src/task-status.js`）改走 `sourceViewForPath` / `await readNote`，避免预览态隐藏 `editor` 读到旧内容或写入过期缓冲。
  5. **派发草稿流程修顺**：`makeDispatchDraft` 经 `mentionOptions` 解析 `@agent` / 模型 / 强度并写入草稿 frontmatter；`findDraftLink` 跳过 `📄` 行、`readDraft` 仅消费 `status: draft`（支持 `{ consume: false }` 无损预览，消费后标为 `status: dispatched` 并计算 hash，同时把笔记子行从 `📝 派发草稿` 更新为 `📄 已派发载荷`）；`ConfirmSendModal` 直接预览已编辑草稿正文并标出草稿来源。
  6. **`ConfirmSendModal` 项目目录选择器**：抽共用 `resolveTaskProjectState` / `renderProjectFolderPicker`（`src/dialog.js`），`ConfirmSendModal` 直接提供项目文件夹下拉、自定义路径输入与冲突/未登记建议的一键确认，并以 `fromDialog: true` 传给 `delegator.delegate()`，减少「先退回库根发完再提示」。
  7. **手写 `✍️ 答` 原地直发**：新增 `latestWrittenAnswer`（`src/thread-replies.js`）、`submitWrittenReply`（`src/main.js`）、命令面板「把已写好的「✍️ 答」发给会话继续」及 `taskActions` 条件菜单项「把已写好的 ✍️ 答 发给会话继续」。
  8. **`lineMap()` 动静拆层与 `refreshEditorsNow()`**：`lineMap(path, doc)` 仅缓存静态文档结构（`lines` / `links` / `linkByLine` / `blockIds`），`sessionByParent` 每次即时拼装（保留单文档一次 `liveSessions` 懒快照与无绑定零开销）；新增 `refreshEditorsNow()`（`src/main.js`）供外部宿主/测试同步清空缓存并触发 `dispatchRefresh(this)`。
  - **验证边界**：全量 `npm test`（含新增 `test/next-round-fixes.test.mjs`、`test/antigravity-acp.test.mjs`、`test/thread-replies.test.mjs` 新增用例）、`npm run build`、`git diff --check` 已通过，且已安装并热重载至 macOS Obsidian `马自立` 库（`eval` 确认插件加载与新方法/命令就绪）；**未在本轮实机点击验证**：Obsidian GUI 内鼠标右键弹窗/权限弹窗/草稿确认框的目视排布、真实交互点击与 Windows 全端。
- 运行时记忆查询 CLI（`scripts/memory-query.mjs`，2026-11-18）：三个动词 `search "关键词" [--k 5]` / `read <记忆文件名>` / `recent [n]`，只读、只解析 `记忆/*.md`（不碰 `记忆.base`），`read` 只接受记忆目录内的文件名（挡 `../`）；`search` 每条带「命中」当 why、不打印分数，门槛是命中查询词的一半（中文二元组太容易误配，只中一两个不算相关）；`search`/`recent` 只看 `state=有效`，与自动注入同一个池子（33 条实测）。另有三个"变更可见"的补充：`--since/--until` 时间过滤（`YYYY-MM-DD`，没写日期的条目不参与，结果尾部说明排除了几条）；**取代链**（`supersedes` 双向显示：新条目标「取代：[[旧]]（日期）」，旧条目反向标「已被取代：[[新]]」）；**一跳图检索**（同引同一篇日记的记忆标「同源（同引 日记/…）」，`sources` 指向的原文给可打开的绝对路径，打不开就不编路径）。库根默认从脚本位置向上找 `.obsidian`，记忆目录跟随设置 `dream.dir`，`--vault` 可覆盖。脚本随 `npm run install:plugin` 装进 `<库>/.obsidian/plugins/agent-deck/scripts/`，派发/草稿 prompt 顶部加一行用法（脚本或记忆目录不在时自动不加）。单测 `test/memory-query.test.mjs`；macOS 真库手跑三动词 + 真派发一次 @dsh，Agent 按提示行执行了 `memory-query.mjs search "拒答门槛"`（退出码 0，命中 2 条并抄回结论）。
- 派发时可以选工作模式（2026-11-18）：确认框里新增「这一次的权限 / 工作模式」——Claude / Qoder 是 `plan / auto / acceptEdits / manual`，Codex 是 `read-only / workspace-write / danger-full-access`（`--sandbox`，桌面 app-server 与终端命令行都吃这次的选择），默认值来自设置页（`delegate.<agent>.permission` / `delegate.codex.sandbox`，设置页文案标明「默认」并说明确认框可临时改）。没有权限控制的 ACP Agent（dsh / antigravity / opencode）不显示这一行。`SANDBOX_ALIAS` 让 Claude 那套词也能落到沙箱上（plan/manual→read-only，auto/acceptEdits→workspace-write）。单测 `test/work-mode.test.mjs`（选项分组 / 默认读取 / 映射 / args）；macOS 真机实测：Claude 确认框显示 4 个模式且 Auto 选中、Codex 显示 3 个沙箱且 Workspace 选中。
- 回复协议（2026-11-18）：笔记里 `❓ 提问` → `✍️ 答：…` → 下一轮 `💬`，三行就是一轮问答。`src/thread-replies.js` 负责解析与写回（幂等：同句不重复、已有 `✍️` 原地改、按块号在多块笔记里定位、孤儿 `✍️` 不动别的问题）；`enrichPrompt` 把「已答的最近 3 轮 + 还在等的那一问」作为固定段注入 prompt（同样去重）；两个命令 + 任务操作菜单里的「✍️ 回复这一问…」「复制这一问的块引用」。**块号**：`❓` 行补 `^ad-q-…`、`✍️` 行补由它派生的 `^ad-a-…`（属 `^ad-*`，注入前剥掉），定位按块号不再靠正文；老笔记可用「给这一块的问答补块号」一次性升级（幂等）。**入站**：`writeResult` / `writeBackgroundResult` 记完 💬 后检查这一轮是否以问句结尾（最后 **12** 行里取最后一个问句——真实提问常是"先抛问题 → 列 A/B/C 选项 → 补一句'你选完我就照办'"，窗口太小会整段漏掉；也允许问题夹在句中），是就自动写一行 `❓ 第N轮：…`（幂等、带块号）并弹通知；结果已经记过也照样检查。空白的 `✍️ 答：` 只算留位不算已答。弹窗只是往笔记那行写字的快捷方式，不新开对话容器；「回答并继续」复用 `Delegator.continueSession` 续聊同一会话（失败会提示，回答已落笔记）。**未做**：从 attention 通知直接跳到弹窗（现在通知仍打开会话，回复入口在 `Ctrl+Alt+A` 菜单与命令）。单测 `test/thread-replies.test.mjs`（9）+ `delegation-enrich` 回灌用例；**回复信箱（2026-11-18）**：提问被写进笔记的同时登记进 `settings.replyInbox`，侧栏「回复信箱」列出全部待答项——不用回原文找那一行。第一次出现时光把侧栏亮出来、**把键盘焦点还给原元素**（实测 `document.activeElement` 前后一致），已在侧栏就不再 reveal；重绘只在条目集合变化时发生，正在输入的草稿存在 view 里不会丢；「核对一遍」按 `stillPending` 回笔记核对，答过的自动消失；信箱里「回答并继续」与笔记里写 `✍️ 答` 走同一条 `applyReply`。macOS 真机：注入提问 → 侧栏出现 2 张卡且焦点未变 → 在笔记里手写 `✍️ 答` 后点核对，条目从 2 变 1；从信箱「先记下回答」写回笔记并从信箱移除。
- macOS 真机：建示例笔记 → `reply-question-line` 插入空 `✍️ 答：` → `applyReply` 两次（第一次 true、第二次 false、文本不变）→ `❓` 不再待答 → 生成草稿时 prompt 顶部出现「任务里的问答记录」且**不含块号**（`grep -c '\^ad-q-\|\^ad-a-'` = 0）→ `anchorThread` 把没号的老问答补成 `^ad-q-8020c464` / `^ad-a-04b8fba9` → `copyQuestionRef` 复制出 `[[Agent Deck/任务/…-验收示例-回复协议#^ad-q-751248be]]`。
- 记忆查询三补充（2026-11-18）：`--since/--until` 时间过滤、`supersedes` 双向取代链、一跳邻接（同源记忆 + 可打开的原文路径）。单测在 `test/memory-query.test.mjs`（时间窗、非法日期、区间顺序、取代双向、同源与原文路径、无日期不参与过滤）；macOS 真库实测 `search "RAG 拒答" --since 2026-11-17` 与 `--until 2026-11-16`（空窗口会说明原有多少条被排除），`recent 1` 输出带「邻接：同源…（同引 日记/2026_11_03）；原文 …/日记/2026_11_03.md」。真库里目前还没有被 `supersedes` 取代的条目，取代链只有夹具覆盖。
- 载荷快照顺序修正（2026-11-18）：此前派发是**先落盘再富化**，载荷文件缺引用笔记清单、技能路径与记忆查询用法，而 prompt 里写着"两者冲突时以文件为准"，名不副实。改成 `Delegator.payloadSnapshot`：没有草稿时先 `enrichPrompt` 再 `writeTaskPayload`；草稿路径仍按草稿原文再富化一次（去重兜底）。单测 `test/delegation-enrich.test.mjs` 的「载荷快照」用例；真机无草稿派发 @dsh 后，载荷文件里确实出现了记忆查询用法行，prompt 里同一行只出现一次。
- 载荷按块号命名复验（2026-11-18）：同一带 `^ad-…` 块号的任务连续写两次载荷 → 落到同一个文件 `派发/日期-块号-slug.md`，笔记里只有一条 `📄` 链接，文件内容被覆盖（hash 变化）。走的是 `writeTaskPayload` 本体，**没有**真派发两次（`hasLink` 会拦第二次，要真派发得先删 `🔗` 行）。
- 管家中途干预（2026-11-18）：`settings.stewardWatch`（设置页「管家汇总」卡里的「管家中途看护」，默认关）打开后每 5 分钟跑一次 `stewardWatchTick`，对 `waiting`/`running` 的波次判「卡住」——**运行中且 15 分钟没有输出**才报，报一次（`wave.watchSeen` 记键，条件消失后清掉，复发可再报），同时往子卡下写一行「⚠️ 管家：… 已经 N 分钟没有输出（最后动静：…）」，不碰任务关键字、不重发。出错与待授权**不**在这里提醒：错误已由 `onWorkbenchJobSettled` 写回 `ERRORED`，待授权已由 `attention.js` + `checkAttention` 弹通知，`judgeWave` 仍用 `attentionReason` 分类（出错里"首轮需要审批或交互"归到授权那条路）。单测 `test/steward-watch.test.mjs`（阈值/结束态/分类/去重/复发/多 worker）；macOS 真机实测：注入一条 30 分钟没动静的假 worker 跑两次 tick，第一次 1 条通知 + 子卡 1 行，第二次 0 条通知、仍只有 1 行；验完删掉假数据与临时笔记。**未实测**：真实长跑会话卡住 15 分钟以上的整轮；设置页开关在界面上的落点。
- 子代理可见性（2026-11-18）：面板「最近」的会话卡片按 `parentSid` 排成父子树——父在同一份列表里就紧跟父卡、按 `--ad-tree-depth` 层层缩进（父不在列表、自环、成环都留在顶层，一条不丢）；「从『X』开出」那一行照旧显示，缩进只表示"父就在眼前"。`analytics.js` / `dream.js` 的统计口径没动（Claude 的 subagent 日志本来就按父 sid 归属，不会再算一遍）。单测 `test/session-tree.test.mjs`；macOS 真库实测：面板按 `dsh` 过滤后 33 张卡里 4 张子卡 `--ad-tree-depth=1`、各自紧跟父卡，截图核对缩进正常。
- 引用笔记绝对路径（`enrichPrompt`）验收（2026-11-18）：新增 `test/delegation-enrich.test.mjs` 覆盖同名笔记去重、非 md / 解析不到的目标、代码块与行内代码里的 `[[…]]`、任务块自身与 `Agent Deck/派发/` 下草稿链接；修复代码块内容被当引用、派发草稿被当素材两个边界。macOS 真库跑「先生成草稿」，草稿顶部出现「任务里引用的笔记（可直接读全文）」且只列真实笔记。

**本批修掉的真 bug**：`dispatchSteward` 里 `makeBlockId` 误用了不存在的 `model.title`（ReferenceError），会导致管家汇总直接失败、波次标 error；已改为 `wave.parentTitle`。

2026-11-18 又修两个：① 派发**先落盘再富化**，载荷快照缺引用笔记 / 技能 / 工具用法（改成 `Delegator.payloadSnapshot`，无草稿时先富化再写）；② `updateNote` 在笔记已从库里删掉时仍会往残留编辑器写——真机删掉被派发的临时笔记后，回写落到了另一篇打开的笔记上，**覆盖掉了一张交接卡**（已恢复）。现在 `updateNote` 只要 `vault.getAbstractFileByPath(path) === null` 就直接返回。

**已知缺口（不是 bug，是没做）**

1. ~~派发前不可编辑~~ **已实现（2026-11-18）**：命令 `委派：先生成草稿（不发送）` 把完整载荷写成草稿并以 `📝 [[…|派发草稿]]` 挂回任务块；用户改完点委派时，`findDraftLink` 优先用这份草稿的正文发送，并把草稿 frontmatter 标为 `status: dispatched` + `dispatched:` 时间。未验证：草稿过期/多份并存时的取舍（取最后一份）。
2. ~~记忆看板与 Base 是两套只读/可写视图，记忆**不能**在看板上新建。~~ **已补齐（2026-11-19）**：`记忆.base` 过滤掉 `索引.md`（`file.path != "<dir>/索引.md"`），配合 `watchMemoryFolder` + `reconcileMemoryFile` 支持在 `记忆.base` 直接新建、改行内 `title`/`type`/`state`/`date` 与删除文件并自动同步 `索引.md`、`长期记忆.md`、记忆看板与孤儿回链；记忆看板新增 `+ 新建`（`MemoryCreateModal`）与卡片 `删除` 按钮，命令面板新增 `记忆：新建一条记忆` / `记忆：删除当前这条记忆`。模式 B（`extractFromDocs`）改为按文档分批提炼，避免多文档共享单个 12 条上限。
3. 载荷被改后的差异**没有进 Dream**（只做了 hash 留痕 + 汇总清单）。

## 活跃 Backlog（主焦 Milestone 1，详细切片见 [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md)）

| 阶段 / 事项 | 范围与边界约束 | 参考 Spec / 模块 | Linear |
| --- | --- | --- | --- |
| **M1.1 上下文内核收口与诚实化** | 收口 `harness.js` / `enrichPrompt` / `replyPromptText` / `memory-query-core`，改为「前稳后动」保 Prefix Cache；零静默丢上下文（含截断带行号目录）、资料/指令隔离、编辑器缓冲、双写手去污；`private:true`/排除目录闸门、能力退路、短词检索补盲、`renderMemoryIndex` 隐私/状态过滤分组、`handoff` 补项目归属与 `Dreaming` `dropped` 计数透出；`contextStats` 账本与 ACP 用量展示 | `src/harness.js`, `src/delegation.js`, `src/dream.js`, `src/memory-query-core.js`, `src/memory-store.js`, [`information-flow.zh-CN.md`](specs/information-flow.zh-CN.md) | `MAT-637`, `MAT-638`, `MAT-639` |
| **M1.2 结构提取、锚点校验与透明预览** | 节点 4–6 键摘要（`type`/`def`/`domain`/`father`/`status`）与空正文反链块退路（位置判强弱 + `#tag` 信号）；通用软/硬锚点 sha256 漂移校验与续聊变更提醒；`father` 单向一跳邻接；`ConfirmSendModal` 轻量预览/剔除（带记忆类型角标）、未链接提及提示与项目主页入口 | `src/harness.js`, `src/outline.js`, `src/dialog.js`, [`context-protocol.zh-CN.md`](specs/context-protocol.zh-CN.md), [`information-flow.zh-CN.md`](specs/information-flow.zh-CN.md) | `MAT-640`, `MAT-641`, `MAT-628` |
| **M1.3 对外供给：纯 Node 库级 Context MCP** | 剥离 Obsidian API 的纯 Node 内核；`vault_outline` / `vault_read` / `vault_related` / `vault_find` + `memory_*` 共用 stdio MCP；跨平台路径与一键接入；入口地图预算裁剪（带分组 `索引.md`/Quickstart 导航线索、中英加权 token 校准及与仓库 `AGENTS.md` 分工）与呼出率止损 | `src/context-core.js`, `scripts/memory-query.mjs`, `src/settings.js` | `MAT-642` |
| **M2 上下文可信度与证据闭环** | 记忆四维正交升级、任务域分流（工程 `lesson` vs 个人记忆 vs 0 注入通用问答）、YAML 单层/嵌套解析契约对齐、`state.processed`/`reconcile` 改写边界与归档（`M2.1`）；全库 34 条断链缺口与同源矛盾检测（`M2.2`）；双链反推低置信 `sources` + 可选 L2 脚注（`M2.3`）；Claude/Codex 中断与额度结束原因 | `src/memory-store.js`, `src/dream.js`, `src/memory-query-core.js`, `src/agent-ingestors.js` | `MAT-644`, `MAT-633` |
| **M3 回写复利、按条共享与跨端底座** | job 读取清单、`log.md`、`ad-attest`、载荷差异与纠偏结果进 Dream（`lesson` 症状→修法）+ `continueSession`/`handoff`/`Dreaming` 全量接入 `RunTrace` 回流 `eval-context.mjs` 门禁（`M3.1`）；Dream 按条共享发布层 + `scope=shared` MCP（`M3.2`）；1 秒可重放与独立客户端底座（`M3.3`） | [`dream-shared-memory.md`](specs/dream-shared-memory.md), `src/dream-sharing.js`, `src/trace.js`, `scripts/eval-context.mjs` | 见 Milestone M3 |
| **轨道 W：Windows 端适配与实测** | 评估合入 `feat/win-compat`（`84b8c01`）+ SashaYang333 Windows 全端实机验证（含脚本路径转义） | `src/platform.js`, `src/delegation.js`, `src/main.js`, `src/readers.js` | `MAT-643` |
| **轨道 A：Agent 生态与终端扩展** | 扩大委派/记录/追踪覆盖：**Hermes Agent**、**千问**、**Kimi Code**、**ZCode**、**MiniMax Code（客户端 + CLI）**、**Claude 客户端直接委派**，以及表驱动扩展**更多终端**（Ghostty / WezTerm / Kitty / Alacritty / Windows 终端等） | `src/agent-registry.js`, `src/agent-ingestors.js`, `src/delegation-runners.js`, `src/delegation.js`, [`acp-integration.zh-CN.md`](specs/acp-integration.zh-CN.md) | 见路线图 §6.1 轨道 A |
| **轨道 T1：Muse & Claude CLI** | Muse 会话只读追踪（`MAT-629`）；Claude CLI 对话追踪全链路复核（`MAT-630`） | `src/readers.js`, `src/agent-ingestors.js`, `src/conversation.js` | `MAT-629`, `MAT-630` |
| **轨道 T2：低优体验与技术债** | Dashboard 任务闭环率、ACP 工具时间线/流式回写、`MAT-479` 其余重构、Pi 支持与块级粒度（M1 后排期） | `src/dashboard.js`, `src/delegation-runners.js`, `src/view.js` | `MAT-625`, `MAT-631`, `MAT-632`, `MAT-479` |
| **现阶段冻结项** | D10 全库稳定画像、工作台/分形看板大改版、技能卡双向写回 | [`specs/harness-roadmap.zh-CN.md`](specs/harness-roadmap.zh-CN.md) §6.2 & §7.2 | — |

## 操作速查（同步至库内 `README-交接.md`）

- **快捷键**（macOS `Alt` = `Option`）：`Ctrl+Alt+D` 委派/任务菜单 · `Ctrl+Alt+A` 续聊/停止/重派 · `Ctrl+Alt+C` 查看与保存对话 · `Ctrl+Alt+N` 下一条待确认 · `Ctrl+Alt+X` 停止执行 · `Ctrl+Alt+J` 跳到「正在做」 · `Ctrl+Alt+L` 整理日志 · `⌥⌘↑` 跳到母块（连按逐级向上）· `⌥⌘⇧↑` 跳到最上一级顶格母块 · `⌥⌘↓` 合并成组（Group rows）· `⌃⌥⌘D` macOS 菜单栏。
- **关键词**：`DOING` / `NOW` / `IN-PROGRESS`、`TOREVIEW`、`NEEDOK`、`ERRORED` / `FAILED`、`HITLIMIT`、`QUEUED`、`DELEGATED`、`TODO` / `LATER`、`PAUSED` / `SUSPENDED`、`WAITING` / `WAIT`、`DONE`、`CANCELED` / `CANCELLED`、`TODOFORAI` / `TODO4AI` / `TODO2AI` / `TODOTOAI`，及 `[ ]` `[/]` `[x]` `[-]`。
- **整理与归档**：**整理日志**默认按 `---` → 正在做 → `---` → 还要做 → `---` → 已完成 → `---` 排列，只整理完整分区内的 **AI** 条目，非 AI 手写条目与区外笔记保持原位；无完整分区时只建立空分区。**归档已完成的日志到…** 仅移出已完成 **AI** 块（默认 `Agent Deck/done/已完成任务.md`），先写归档再删源。

## 本地修改（2026-11-19，随 1.13.2 发布）：跨 Agent / 跨 Mac ACP 通用化、Hermes Agent 与千问办公

- **跨 Agent & 他人 Mac ACP 通用化**（`src/agent-registry.js`, `src/delegation-runners.js`, `src/conversation-modal.js`, `src/dialog.js`, `src/constants.js`, `src/main.js`）：
  - 在 `CAPABILITIES` 增加声明式 ACP 属性（`acpArgs`, `acpAutoApprove`, `acpDefaultModel`, `acpDefaultEffort`, `acpModelOptional`, `acpEffortOptional`, `acpAllowUnknownEffort`, `continueRequiresAcp`），消除各处的 `["dsh", "antigravity", "opencode"]` 硬编码。
  - `AcpRunner`（`start` 与 `session/request_permission`）对缺失的 `settings.delegate[agent]` 改用安全兜底；`acpModels()` 与模型切换同时兼容 `configOptions`（`session/set_config_option`）及标准 ACP `models.availableModels`（`session/set_model`）。
  - 新增 `pickPermissionOption()` / `isAllowPermissionOption()`，按 `option.kind || option.optionId || option.name` 匹配 `allow*` / `reject*` / `deny*`（兼容 Hermes `allow_once` / `allow_session` / `deny`）；`Plugin.requestAcpPermission` 按 `runner._permChain` 串行排队并追踪活跃弹窗，排队请求在用户点过一键「允许并开启自动允许」后直接放行。
  - 扩充 `cleanEnv()` / `expandedPathEntries()`（覆盖 `nvm`、`volta`、`fnm`、`npm-global`、`pnpm`、`bun`、`cargo`、`uv`、`pyenv`、`conda/miniconda/anaconda/miniforge`、`/opt/homebrew/opt/*/bin` 等），并新增按需缓存的登录 shell `PATH` 兜底（`resolveExecutableWithFallback()`）与可操作 `ENOENT` 报错；扩充 `AGENT_BINARY_SPECS`（含 `.app` 内置与 Homebrew / `uv` 候选）。
- **Hermes Agent（`hermes`）**：只读读取 `$HERMES_HOME/state.db`（及 `profiles/*/state.db`），Unix 秒精确换算毫秒，保留 `input_tokens + cache_write_tokens` / `cache_read_tokens` / `output_tokens`，过滤 `hidden = 1` 与丢弃轮次，保留 `active = 1 OR compacted = 1`；支持 `hermes-acp`（无多余 `acp` 子命令）后台委派与 `hermes chat` / `hermes --resume` 终端交互。
- **千问办公 / QwenWork（`qwenwork`）**：2.x 起对话写在 `~/.qwenworkcn/.harness/<engine>/qwenwork/qwenwork.db`（内置 OpenCode 引擎的 SQLite，含 session/message/part 与逐轮 token），旧版仍读 `~/.qwenworkcn/projects/*/*.jsonl` 作回退；两者都经 `$QWENWORK_HOME` 可覆写。读取时剥除首条用户消息里引擎注入的 `workspace_context` / `system-reminder` / 懒加载工具清单，`workspace/<日期>/<id>` 归一为项目名 `QwenWork`；旧 JSONL 跳过 `"unknown"` 占位模型名与不存在的 token（不做估算）；CLI / 客户端暂无无头问答或 ACP 接口，标记 `trackingOnly: true` 并在 README 与规范中说明。
- **实测范围与未测空白**：macOS 已跑完 `npm test`（含 `test/acp-hermes-qwenwork.test.mjs`、`test/i18n.test.mjs`、`test/architecture-refactor.test.mjs`）、`npm run build`、`swiftc -typecheck`、`git diff --check`，并实机只读验证本机 `~/.hermes/state.db`、`~/.qwenworkcn/projects` 与 2.x `~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`（真实 3 轮会话、token 与正文剥除）读取、`hermes-acp --check`；Obsidian UI 实机点击、真实 `hermes-acp` 委派多轮及 Windows 全端未测。
- **收口二轮补强与菜单栏/侧栏对齐（2026-11-19，未发版）**：
  - `@` 唤起（`src/task-mentions.js`）改由 `AGENT_ORDER` + `agent-registry` 动态派生 `routableAgents()`（补齐 `hermes` 等全部可委派与终端交接 Agent），正则与提示同步动态生成。
  - macOS 菜单栏（`src/main.js`、`src/menubar.js`、`src/menubar.swift`）改为与侧栏「现在」完全一致的 **按项目 / 按状态 / 列表** 三分类（复用 `orderNowSessions` / `buildProjectGroups` / `buildNowStatusGroups`），菜单栏头部可直接切换并经 `setNowGroupBy` 命令与 Obsidian `settings.ui.nowGroupBy` 双向同步。
  - 移除左侧 Ribbon 栏的「记忆表格」入口（`src/main.js`），并通过 `deckSessionUrl()`、`AgentDeckSettingsTab.renderAcpCard()`、`hermesBinLocations()`、`buildAcpModelEntry()` 与 `whereByAgent` 映射完成两轮 `code review --fix` + `simplify` 去重与稳健性修复；`test/menubar-startup.test.mjs` 与 `test/acp-hermes-qwenwork.test.mjs` 新增回归断言，待 macOS Obsidian 真机点击菜单栏三模式切换及 Windows 端实测。

## 本地修改（2026-11-18，1.12.2）：侧栏「现在」增加「按状态」视图

- **三视图切换**：`settings.ui.nowGroupBy` 现在接受 `project` / `status` / `flat`（`AgentDeckView.nowGroupBy()` 只认这三个值，未知值回 `project`）；卡片头部的切换按钮变成「按项目 / 按状态 / 列表」三颗，沿用既有 `ad-chip is-on` 胶囊与 `.ad-projgroup` 折叠卡片样式。
- **状态分档**：新增 `NOW_STATUS_BUCKETS` / `nowStatusOf()` / `buildNowStatusGroups()`（`src/project-workbench.js`），固定顺序「等你 → 待认领 → 在跑 → 异常」，空档不渲染。口径：等你 = `needs-approval` / 排队 / 30 分钟内的非子代理 `wait`·`quiet`；待认领 = 已派发但还没有会话接手的活跃 job（`isPendingJob`，优先于「在跑」判定，否则 `starting` 会被当成在跑）；在跑 = `run` / `starting` / `running` / `busy`；异常 = `error` / `limit`。组内沿用 `stateRank` + 最近活跃排序。
- **在跑配色**：新增 token `--ad-live: #c8635f`（`src/styles/base/tokens.css`），与会话卡片状态胶囊 `.ad-state.is-live`、项目 / 状态组头的 `N 在跑` 徽章 `.ad-projbadge.is-live`、Agent 卡片的「N 个在跑」文字共用，与 `keyword.css` 的 DOING / NOW / IN-PROGRESS 关键词红一致；`完成` 仍用 `--ad-good` 绿；在跑胶囊保留呼吸脉冲，底色透明度提到 20%（`--ad-state-alpha: 20%`），浅色主题下更实。
- **组头**：按状态只保留折叠箭头、档位名与数量徽章，不出现项目目录 / 工作台 / 停止本项目这些项目级按钮；「等你」与「异常」档沿用 `has-attention` 描边。折叠状态记忆在新加的 `collapsedNowStatus`，与按项目视图的 `collapsedNowProjects` 互不影响。
- **测试**：`test/project-workbench.test.mjs` 新增 `buildNowStatusGroups` 分档用例（四档顺序、组内排序、未认领优先于在跑、完成/过期等待不计入、禁用 Agent 掉行、全空返回空）；同文件既有的 `AgentDeckView` DOM 渲染用例补上三颗按钮、切到按状态后三档顺序 / 中文档位名 / 徽章 / `has-attention` / 组头无项目按钮 / 折叠后卡片隐藏、以及未知档位回落 `project`。全量 `npm test`（exit 0，`all passed`）、`npm run build`、`git diff --check` 通过。
- 已实机目视：Obsidian 1.15.1 里三视图切换、等你 / 在跑两档与折叠、在跑红与 20% 底色的观感。未验证：Windows、极窄侧栏下三颗胶囊的换行与徽章对齐。

## 本地修改（2026-11-17，1.12.1）：笔记项目优先于 Agent 默认目录

- `resolveDispatchFolder()`（`src/project-folders.js`）的优先级改为「显式 cwd → 笔记项目（双链 / 路径 / `项目 -> 标题`）→ 各 Agent 默认 cwd → 库根」。之前默认 cwd 会压过笔记项目，设过默认目录的 Agent 等于永远不触发项目派发；现在默认目录只在笔记认不出项目时兜底。`settings.autoProjectFolder` 关掉后仍然是默认 cwd → 库根。
- 设置 → 委派「项目文件夹」卡片的说明同步写清「笔记项目优先于各 Agent 的默认目录」。
- 测试：`test/project-folders.test.mjs` 增加项目压过默认、无项目回默认、关闭后默认生效三条；`test/project-dispatch.test.mjs` 增加默认 cwd 与笔记项目冲突时 runner 真跑在项目目录。
- 未验证：Obsidian 设置页与委派对话框的文案视觉、Windows。

## 本地修改（2026-11-17，1.12.1）：项目登记入口与非日记笔记派发

- **对话框就地登记**：`suggestProjectForTask` / `recentProjectFolders` / `projectCandidatesFromTask`（`src/project-folders.js`）从最近追踪到的会话（`usage.meta`，经 `plugin.projectFolderSuggestions()`）取「项目名 → 真实目录」，再用笔记的双链 / 路径段 / 标题前缀匹配。`DelegateOptionsModal` 在认出了项目但目录没登记时显示建议行，点「使用并记住」立即写入 `settings.projectFolders`，不用先去设置页。
- **拖拽不打断**：`Delegator.delegate()` 只在没有显式目录、也没有已登记项目时查一次建议；命中就在派发通知后面追加一行「这条笔记提到 X，还没登记目录」，同一个项目每次进程只提示一次（`_projectHinted`），不弹窗、不自动登记。对话框里已显示建议时不再重复提示（`opts.fromDialog`）。
- **非日记笔记的日记归属**：从非当天日记派发时 job 记 `noteDispatch`，`Delegator.onSession` 把会话号写入 `settings.noteDispatchSessions`（180 天懒清理、封顶 2000）；`AutoLog.processDay` 默认跳过这些会话，`settings.noteDispatchJournal`（默认关，设置 → 委派 → 项目文件夹）打开后恢复写当天日记。结论仍由 `writeResult` 写回原笔记。
- **回写噪音**：`src/sync.js` 的 `ensureTopRule` 改为 `safeTopRule`，非日记笔记或分区标记坏掉时跳过顶部分割线处理，不再让整轮 sync 抛「会话回写日记失败」。
- **进错项目的修正**：任务级信号（块内 `[[双链]]` / `项目 -> 标题` 前缀）现在优先于笔记路径，`Agent Deck.md` 里写 wuxi 的任务不会再被文件名带去 agent-deck；笔记路径与任务提到的未登记项目冲突时，对话框以任务项目为预选并给「继续用笔记的项目」，拖拽派发先落库根并提示，不静默使用路径项目。
- **取消不再崩**：`AcpRunner.close()` 的 `timer.unref()` 加类型判断，Obsidian 里取消 DSH 等 ACP 任务不再抛 `timer.unref is not a function`；`delegation-runners.js` 已实机取消一条 DSH 任务验证状态变 `cancelled`。
- 测试：`test/project-folders.test.mjs` 覆盖候选名、最近项目、建议命中/已登记不提示/无信号不提示；`test/project-dispatch.test.mjs` 断言非日记派发的会话被标进 `noteDispatchSessions`。
- 未验证：对话框建议行的视觉、拖拽通知时长、Obsidian 非日记笔记里的实际日记跳过效果、Windows。

## 本地修改（2026-11-17，1.12.0）：项目文件夹派发与 Codex 项目归属

- **项目名 ↔ 目录登记**：新增 `src/project-folders.js`、`settings.projectFolders`（`{项目名: 绝对路径}`）与开关 `settings.autoProjectFolder`（默认开）。派活时若 `opts.cwd` 为空，按「笔记里的 `[[双链]]` → 笔记路径段 → `项目 -> 标题` 前缀」顺序认出已登记的项目并换成它的目录；认不出照旧用库根目录。派发过一次带目录的任务后按项目名记住（库里已有同名/同目录条目则更新），老项目改目录直接在设置里改。
- **入口**：委派对话框（`src/dialog.js`）新增「项目文件夹」下拉，打开时自动预选解析到的项目；项目工作台（`src/workbench-modal.js`）的项目名旁同样可切换，切到项目会带出目录；设置 → 委派新增「项目文件夹」卡片（按项目名增删/改目录，目录不存在时拒绝保存）。
- **Codex 无项目对话**：`CodexDesktopRunner`（`src/codex-desktop.js`）在 `thread/start` 前调用 `project/list`，按规范化后的 cwd 复用已有项目；没有就用 `project/create` 建一个（名取 `job.project` → 登记名 → 目录名，`idempotencyKey` 按目录哈希稳定），并把 `projectId` 传给 `thread/start`。`settings.delegate.codex.project` 默认开；项目接口是实验性 API，`project/list` 报错或建项目失败时静默退回不带 `projectId`。scratch 目录（`isScratchCwd`，如 `.../Codex/YYYY-MM-DD/...`）、home 与不存在的 cwd 不建项目。新建项目时提示一次。
- **验证边界**：`npm test`、`npm run build`、`git diff --check` 通过；`test/project-folders.test.mjs` 覆盖规范化/登记/改名/双链/路径/标题/失效目录与派发目录优先级；`test/project-dispatch.test.mjs` 用假 `claude` 子进程验证解析出的项目目录真的传进 runner（自动双链、显式目录+记住、关掉开关回库根）；`test/codex-desktop.test.mjs` 用假 app-server 覆盖复用、创建、接口缺失、开关关闭、scratch 跳过五条路径。真实 Codex `0.169.0-alpha.11.1` app-server 只读实测：`project/list` / `project/create` / `thread/start(projectId)` / `thread/list(projectId)` / `thread/delete` / `project/delete` 均按预期工作（临时项目与线程已删除，`project/list` 剩原有 1 个）；真实从 Obsidian 派发一条到项目目录（`/tmp/ad-e2e-codex`）：`project/create` 建出 `ad-e2e` 项目，`thread/list(projectId)` 查到该线程（本轮 Codex 账号撞额度，turn 未完成；归组发生在 turn 之前），测试项目/线程/笔记/设置已清理。**未验证**：Codex Desktop GUI 里肉眼看到的分组、Windows。

## 本地修改（2026-11-17，1.11.0）

- **💬 结论取「最后的落点」**：新增 `conclusionSentence()`（`src/journal.js`，分层取句：显式结论段 → 单段放得下就整段 → 从结尾往前找第一句不像客套 / 下一步的话 → 退回最后一段），替换三处「拿开头当结论」的调用：简略记录没润色成功时的 `结论：` 字段、标准记录的单句结论、`autolog.js` 本地兜底与 `rawSummary`。`❓` 的用户提问仍走 `oneSentenceConclusion()`。标准记录用 `tailSentence()` 保证只留一句。润色 prompt（`src/sync.js`、`src/autolog.js`）同步改成「写落点，不要摘开头铺垫」。`test/conclusion-record.test.mjs` 新增 8 条用例并接入 `npm test`；已有记录 append-only，不重算历史。
- **整理来源备用链**：`journalProviderChain()` / `runJournalModel()`（`src/llm.js`）在 `autoLogFailover` 打开时按「主来源 → 至多一个备用来源」尝试，限额/超时/起不来才换家，`请先填写…` 直接报错；撞限额的来源进程内冷却 `autoLogCooldownMin`（默认 30 分钟），上次成功的来源优先。设置入口在「记录 → 日记与归档 → 更多设置」（`autoLogFailover` / `autoLogBackupProvider` / `autoLogCooldownMin`，默认关）。`test/llm.test.mjs` 新增降级 + 冷却 + 关闭后仍直接报错的用例。
- **中断/额度不足写原因**：`src/agent-ingestors.js` 的 DSH `turn/end` 现在把 `aborted` / 额度类 `error` 标到轮次（`r.aborted` / `r.quota`）并把状态记成 `limit`；`src/journal.js` 的 `syncSessionEntry` 在没有正文时写 `本轮被中断，没有结论。` / `额度不足，本轮未完成。`。真实 transcript 复核：第 3 轮 ABORTED、第 10 轮 QUOTA（之前都只是空白）。
- **会话认领与轮次隔离**：`findSessionTask()` / `findTask()`（`src/journal.js`）新增「按 `ad-turn` / `ad-summary` 会话标记认领条目」，`src/autolog.js` 建项前先用它认领（DONE 条目在对话都记过时复用，接着聊仍新建）；`startRound()`（`src/agent-ingestors.js`）换轮清空 `live.lastText`，五个 ingest 调用点都传入 viewer。新增 `test/dsh-rounds.test.mjs` 与 `test/autolog.test.mjs` 的改名复用用例。
- **分区标记修复与 DeepSeek CLI 来源**：`repairJournalLayout()` / `stripJournalLayout()`（`src/journal-layout.js`）与 `JournalMarkerModal`（`src/dialog.js`）接到「整理日志」「现在整理一次」两条路径（`src/main.js` 的 `repairJournalMarkers` / `logNowWithMarkerGuard` / `brokenJournals`）；新增 `deepseek` 来源（`src/llm.js`），运行 `~/.local/bin/deepseek-ds`（隔离 `HOME=~/.deepseek-cli` + keychain `agent-deck-deepseek`，官方 `gemini`/`deepseek` 命令不受影响）。马自立库里已把整理模型切到 `deepseek`/`deepseek-chat`，`autoLogBackupProvider=qodercli`。实测：11_17 分区修复后整理写入了新记录；11_16 标记夹正文补不回，走「重建分区」。
- **💬 结论按 coding / 知识问答分档**：`src/sync.js` 的润色 JSON 增加 `kind`（`code|qa`），`src/journal.js` 的 `conclusionKind()` 在润色缺席时兜底（指令 > 提问 > 回复证据，拿不准 `code`），`answerConclusion()` 取问答类的判断段（`先说结论 / 推荐 / 所以 / 答案是`），`conclusionSentence()` 仍取编码类的落点；`isNoise()` 统一排除「没有验证的 / 顺带一句 / 下一步 / 要不要我…」。长度设置 `settings.conclusionMaxCode`（65）与 `conclusionMaxQA`（160），经 `syncSessionEntry({ codeMax, qaMax })` 生效。用本对话（`session-23616433`）与 3 个历史会话的 7 轮真实回复做过抽取比对。
- **自动调用 API 前先问人**：`src/llm.js` 的 `hasApiConsent()` 在 `automatic` 且真要走 `api` 时经 `setJournalApiConsent()` 注入的问询函数确认（同意/拒绝各管 30 分钟，进程内）；`src/main.js` 的 `confirmApiCall()` 在 macOS 用 `osascript display dialog`（`systemConfirm()`，60 秒无人应答＝不用，osascript 起不来返回 `null` 再退应用内），其它平台走 `src/dialog.js` 新增的 `ApiConsentModal`。`autolog.js` / `sync.js` / `dream.js`（定时 tick）/ `task-id.js`（自动块号命名）的自动调用点传 `automatic: true`，手动「现在整理一次」「测试连接」「生成计划」「立即做梦」不传。开关 `settings.autoLogApiConfirm`（默认开）。`test/llm.test.mjs` 新增「同意后不再问 / 拒绝后不再问 / 手动不问」用例。
- macOS 验证：`npm test`、`npm run build`、`git diff --check` 通过；结论分层取句用真实长回复样例手工核对过简略/标准两种记录；系统对话框脚本用 `osacompile` 编译校验（未实际弹窗点过按钮）。**未验证**：真实 CLI 撞限额时的自动切换（只用假 CLI 模拟 quota 报错）、设置页新增行的视觉与交互（未在 Obsidian 打开设置页目视）、Windows。

## 本地修改（2026-11-16，1.10.3）

- **自动会话记录默认打开 & 扫描间隔 30 秒**：`DEFAULTS.autoLog` 改为 `true`、`DEFAULTS.pollSeconds` 由 `60` 改为 `30`（`scheduleScan` 兜底值同步），`onload` 用一次性标记 `settings.defaultsMigratedAutoLog` 把老库也迁到新默认，之后用户手动改就尊重（`src/constants.js`、`src/main.js`）。
- **当天日记不存在就建一篇**：`AutoLog.run` 在确有会话要写、当天日记缺失时，经 `plugin.ensureNoteFile`（新增可选 `content` 参数）按 Obsidian「日记」核心插件配置的模板建笔记，模板变量 `{{title}}` / `{{date}}` / `{{time}}` / `{{date:…}}` / `{{time:…}}` 按「模板」插件的日期时间格式替换，无模板则建空文件；AI 分区骨架仍交给 `placeBlock`，没有需要记录的会话不建笔记（`src/autolog.js`）。
- **AI 自动记录只追最近的活动**：新增设置 `settings.autoLogFirstRounds`（默认 `10`，「记录 → 日记与归档 → 更多设置 → 首次记录最近多少轮」）与「见过的会话」标记 `settings.autoLogSeen`（180 天懒清理、封顶 2000 条，老库从 `autoLogState` 播种）；第一次接入某个会话 / Bot 只补最近 N 轮，之后同一个会话只补当天产生的轮次（按「日记日期分界」，跨日延续也按今天），更早的历史不再写进笔记。窗口统一由 `trackedRounds()`（`src/constants.js`）与 `seenSessions()` 实现，自动建项（`src/autolog.js`）与 🔗 回写（`src/sync.js`）同规则；已有笔记内容不裁剪，委派/后台答案回写（`src/delegation.js`）仍用它自己那一轮的结论。
- **首次安装把面板放进右侧栏并展开**：`openPanelOnce()` 在 `settings.viewOpened` 尚未置位时，除 `getRightLeaf` 放面板外再调 `rightSplit.expand()`，新库一装就能看见面板；已装过的库不动（`src/main.js`、`test/startup.test.mjs` 新增用例）。
- **AI 自动记录 DONE 不再有贯穿黑线**（改在 `logseq-style-tasks` 仓库，不属于本仓库 diff）：TODOseq 新增 `src/utils/agent-deck-records.ts`（`🤖` 标记判定 + `markAgentDeckRecords`），编辑器给带 `🤖` 的行加 `todoseq-agent-record` 行类、阅读视图给最近的 `li/td/p/.todoseq-task` 加同类，`styles.css` 用该类比掉的 `todoseq-completed-keyword` / `todoseq-completed-task-text` 删除线；手写 `DONE` 仍照旧划线。TODOseq 全量测试 5338 通过、3 个既有日期时区用例（`dashboard-renderer`、`search-open-ranges`、`search-started`）在干净树上同样失败，与本改动无关；`npm run build` 通过，`马自立` Vault 覆盖安装并热重载后实测 `DONE 🤖` 行 `line-through` 为 0。
- **README 增加 Group rows 效果图**：把用户截图转成 `assets/group-rows-merged.png`（1478×1098），中英文 README 在「合并成组（Group rows）」小节各插一张居中图（`width="840"`）。
- **任务关键词视觉搬到 Agent Deck（1:1 复刻 TODOseq）**：新增 `src/keyword-style.js` 与 `src/styles/views/keyword.css`（关键词配色、`tsq-ico` 图标、切词动画、完成/归档文字整套沿用 TODOseq 的类名与 `--tsq-*` 变量，数据与样式从 `logseq-style-tasks` 拷贝）。编辑器走两条 ViewPlugin（配色/完成态 + 图标），阅读视图走 `registerMarkdownPostProcessor`；AI 自动记录（行内 🤖）即使 `DONE` 也不加 `todoseq-completed-*`，手写任务照旧划线。让位按层判断：TODOseq 的 `formatTaskKeywords` / `keywordIcons` 任一开着，本插件对应那层不渲染，避免双图标。开关「记录 → 日记与归档 → 关键词配色与图标」（`settings.keywordStyle`，默认开）。
- macOS 验证：`npm test`（含 `test/autolog.test.mjs` 新增「缺日记就建」「无会话不建」用例与两项默认值断言）、`npm run build`、`git diff --check` 通过；`马自立` Vault 安装并热重载后确认 `data.json` 迁移为 `autoLog: true`、`pollSeconds: 30`、`defaultsMigratedAutoLog: true`，笔记内容无额外写入。模板建笔记只在单测里验证——当天日记已存在，未在真实 Vault 触发；该库「日记」核心插件未配模板，Windows 未实测。

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
- **菜单里默认模型用短写法（1.13.10）**：`delegateModelLabel`（`src/main.js`）把 `value === ""` 的 `*-default` 占位符显示成 `CLI 默认`，标题与二级菜单条目同口径，不再出现「不指定（使用 DSH 当前默认模型）」的括号套括号。
- **编辑器右键菜单也放委派（1.13.9）**：光标所在那一段（任务行、`💬`／`⏱`／`🔗` 回传日志、普通段落）右键即出 `委派（Agent · 模型）` 与 `委派并选择模型 ▸`，与四视图／阅读视图行菜单共用 `addDelegateMenuItems`（`src/main.js`）；编辑器菜单的提前返回条件放宽到「这一行有字」，普通段落不再只看到 Obsidian 的原生项。
- **委派箭头回到「光标所在的那一段」**：撤销 MAT-623 的「顶层 AI 记录母块行尾不出 `GripWidget`」限制——母块行、`💬`／`⏱`／`🔗` 回传日志行、普通段落一视同仁，光标停在哪一段，行尾就出委派箭头（`src/editor.js`），所以回传的日志可以直接当任务再派出去；不带列表标记的普通段落由 `paragraphBlock`（`src/delegation.js`）+ `delegateTarget`（`src/main.js`）兜底，整行当一项发。源码行尾不再放 Pin 📌，Pin 走右键菜单。
- **四视图与阅读视图的行右键菜单**：表格／卡片／时间线／阅读视图的每条记录行去掉行内 📌，改成右键菜单：`Pin 为关键记录` / `取消 Pin`、`委派（Agent · 模型）` 标题里直接写出会用谁，点了就按默认 Agent + 默认模型派、`委派并选择模型 ▸` 二级菜单列出已启用 Agent 的启用模型（`Claude · Opus 5.5` 这种写法），点哪项就派给那个 Agent 的该模型。菜单在 `src/main.js`（`recordRowMenu` / `recordMenuModels` / `delegateViewRow`），行绑定在 `src/record-display.js`；`delegateDrop` 新增 `model` 选项，正文里写了 `@agent` 时以 @ 为准不覆盖。派发内容是该行这一轮的记录（连同子块），沿用原来的确认弹窗（可改目的地 / 工作模式 / 项目目录）。
- **AI 记录母块视图切换（[MAT-623](https://linear.app/matsurimywaifu/issue/MAT-623)）**：最顶层 AI 自动记录母块行尾改为 `ViewToggleWidget` 视图切换入口（支持「大纲／表格／卡片／时间线」并保留「任务操作…」菜单入口），非顶层子回复行与普通任务保持原有委派把手；委派箭头于 1.13.7 后回调为所有段落通用（见上一条）。视图偏好按块持久化于 `settings.aiRecordViews`（`src/constants.js`），不重写底层 Markdown；`RecordViewWidget` 与 `buildTableModel`（`src/ai-records.js`、`src/record-display.js`）复用 `visibleTableEntries` 遵循原有显示范围与折叠开关，将同轮 `❓`/`💬` 配对、仅在有值时显示「任务 / 提问」列、把 `⏱`/`🔗` 收至共享底栏、支持行内展开非任务深层子块（触发 `view.requestMeasure()`），并支持点击任意视图条目切回大纲并定位原块编辑。范围限定 CM6 编辑视图，阅读视图仍保留大纲模式。macOS 已通过 `npm test`（含 `test/record-views.test.mjs`）、`npm run build`、`git diff --check` 及 `马自立` Vault 真实日记实测验证；Windows 与阅读视图渲染暂未覆盖。
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
    - 看板密度与块操作补强（`1.10.5` / `1.10.6` / `1.10.7` 已发版；`src/fractal-board.js`, `src/project-workbench.js`, `src/main.js`, `src/styles/views/record-views.css`, `src/constants.js`）：按渲染高度给每列封顶（常规约 3 张、整列短卡时 4 张）并列内滚动；拖到卡片上/下半区插入前后、拖到列空白处排到列尾；新增 `settings.taskBoardPins` 显示层置顶（`block:`/`mirror:`/`title:` 标识，不改 Markdown）；卡片与列头复选框支持批量改状态（复用 `applyBatchStatusChoice`）、置顶/取消置顶、删除整卡子树（含记录与子项，二次确认、编辑器可撤销），镜像卡只参与置顶；卡片右下角操作按钮移除，单卡「正文 / 停止 / 派发」与多选批量操作改走右键菜单（删除为二次确认子菜单），顶部「派发 TODO」与批量栏保留；卡片标题与最新结论用 `MarkdownRenderer` 渲染，标题新增 `titleMarkdown` 保留行内 Markdown，pin 标识与兄弟上下文仍用纯文本 `title`，点标题空白仍回大纲。验证：`npm test`、`npm run build`、`git diff --check` 通过；macOS 在 `马自立` Vault 临时笔记实测 3/4 张列高与列内滚动、单卡/批量置顶、批量改状态与删除、列内前后插入与跨列拖拽、多选右键菜单、Markdown 标题/结论与可点双链；`1.10.6` 另修子组下钻计数、镜像卡源行重定位与写入保护、签名过期、同名卡选择撞车、备注 Markdown 截断与 Promise 错误提示（临时笔记与 `taskBoardViews`/`taskBoardPins`/`manualTaskStates` 残留已清理）；Windows 未实测。
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
- **工作台管家 Agent（Steward）波次收口与自动推进（`1.10.3` 已发版）**：
  - `src/project-workbench.js`, `src/workbench-modal.js`, `src/fractal-board.js`, `src/main.js`, `src/delegation.js`, `src/constants.js`：
    - `ProjectWorkbenchModal` 新增「管家 Agent（队员全部完成后自动汇总并继续推进）」配置与「自动续派管家生成的后续 TODO（最多 2 轮）」开关（持久化至 `settings.projectTeams.stewards`）；`dispatchWorkbenchTasks` 与分形看板「派发 TODO」在派发后自动创建持久化波次 `settings.workbenchWaves`。
    - 借助 `Delegator` 钩子（`afterResult`/`onError`/`onCancel`）与 `scanNow`/`recoverJobs` 同步各队员（含 `handoff` 会话）状态并回写子任务状态（`DELEGATED` → `TOREVIEW`/`ERRORED`/`CANCELED`）；全员收口后自动插入 `🧭 管家汇总与推进` 子卡并带全部队员产出与项目上下文派发给管家 Agent。
    - 管家完成后解析可选结构化决策（`done` / `continue` / `needs-review` 与 `nextTasks`），更新已核查队员与父任务状态（`DONE`/`TOREVIEW`/`NEEDOK`），并把后续 `TODO` 写回分形看板（勾选自动续派时按 `MAX_STEWARD_ROUNDS = 2` 上限自动续派下一轮）；分形看板顶部提供实时管家状态栏与「立即汇总」「停止/取消管家」「重试汇总」操作。
  - 验证边界：macOS 已通过全量 `npm test`（含 `test/project-workbench.test.mjs` 管家与端到端波次回归、`test/i18n.test.mjs`、`test/errors-i18n.test.mjs`、`test/architecture-refactor.test.mjs`）、`npm run build`、`git diff --check`、GitHub Release `1.10.3` 与 `马自立` Vault 安装热重载；Obsidian 真实界面点击与真实 CLI 多 Agent 实跑及 Windows 端尚未实测。
- **整理日志仅调整顶格 AI 记录块（`1.10.3` 已发版）**：
  - `src/organize-journal.js`（`planJournal`）：整理日志与规则上方收编仅处理顶格（`J.width(lines[i]) === 0`）的 AI 记录块；所有不顶格的缩进条目（无论挂在 `- [[Agent Deck开发日志]]` 等手写分组下、还是缩进嵌套在其他任务下）一律原位保留不拆散、不移动，也不触发 `JournalOrganizer` 散落提醒；已缩进嵌套在 AI 父项下的开放子任务同时阻止父块因归档误翻 `DONE`。
  - 验证边界：macOS 已通过全量 `npm test`（含 `test/organize-journal.test.mjs`、`test/bounded-journal.test.mjs`、`test/journal-organizer.test.mjs`）、`npm run build`、`git diff --check`、GitHub Release `1.10.3` 与 `马自立` Vault 安装热重载；Obsidian 真实界面与 Windows 端未实测。
- **大纲「跳到母块」「Group rows」与多选块批量调整任务状态（`1.10.3` 已发版）**：
  - `src/outline.js`、`src/task-status.js`、`src/main.js`、`src/locales/en/main.js`：
    - 复用并适配 Emacs Logseq Inspired Outline 的 `itemLineFor` / `parentItem` / `contentSpan` / `blockLinesForRange` / `groupRowsEdit` / `collectSelectedRootLines`：新增命令「跳到母块（`Mod+Alt+ArrowUp`）」「跳到最上一级的顶格母块（`Mod+Alt+Shift+ArrowUp`）」与「合并成组（Group rows，`Mod+Alt+ArrowDown`）」，跳到母块时光标停在行尾 `^blockId` 前，合并成组自动按选中最浅缩进新建空母块并将选中块整体降一级。
    - 支持框选、多光标选区、编辑器右键菜单（`editor-menu`）、命令面板「批量调整选中块的任务状态…」以及多选状态下直接点击任一状态徽章，一次性原子更新所有选中根列表项的状态关键词（兼容无关键词普通列表项、`[ ]`/`[/]`/`[x]`/`[-]` 复选框及 `manualTaskStates` 人工锁定与回滚，支持单步撤销）。
  - 验证边界：macOS 已通过全量 `npm test`（含 `test/architecture-refactor.test.mjs`、`test/task-status.test.mjs`、`test/project-workbench.test.mjs`、`test/i18n.test.mjs`）、`npm run build`、`git diff --check`、GitHub Release `1.10.3` 与 `马自立` Vault 安装热重载；Obsidian 真实快捷键/右键菜单交互与 Windows 端未实测。已知边界：Group rows 跨选到顶格段落或代码围栏时会把该内容同样缩进一级（整体平移、渲染等价），未做拒绝提示。

## 本地修改（2026-11-26，未改版本号）：Dream 记忆 Graph-Native OKF 融合与外部只读图谱能力
- **核心改动**（`src/memory-graph.js`, `src/memory-store.js`, `src/memory-query-core.js`, `src/dream.js`, `src/main.js`, `src/settings.js`, `src/constants.js`, `scripts/memory-query.mjs`, `scripts/memory-mcp.mjs`, `src/locales/*`）：
  - 保留「一文一条 `.md`」与扁平 Bases 兼容 OKF v0.2 元数据，新增无环模块 `src/memory-graph.js`：短命题文件名推导（`deriveShortMemoryTitle` / `preferShort`）、全库概念词典构建（`buildVaultConceptCatalog`，过滤高出度枢纽/停止词并识别英文≥3、中文词元及 aliases）、严格概念边匹配与 `1–2` 跳图谱扩散（`expandGraphMemories`）、以及 Obsidian `.obsidian/graph.json` 7 组配色预设（`applyMemoryGraphPreset`）。
  - `src/memory-store.js` 与 `scripts/memory-query.mjs`（`MEMORY_QUERY_ASSET_VERSION = 4`）/ `scripts/memory-mcp.mjs`（`MEMORY_MCP_ASSET_VERSION = 3`）支持纯 `"[[...]]"` YAML 图谱字段（`concepts` / `project_link` / `source_notes` / `conflicts_with` / `supersedes` / `superseded_by`）、`memory-query.mjs graph` 与 MCP `memory_graph` 一/二跳遍历，及 `memory-query-core.js` 零向量图谱加权召回。
  - `src/dream.js` / `src/main.js` 补强 `backfillOkfMetadata`（0-Token 补全 OKF + 图谱边 + 短命名重命名，期间 `_suppressWatch` 抑制监听且 `reconcileFile` 安全跳过 `ENOENT`，`resolveSourceNotes` 将 `source_notes` 过滤为库内实际可解析笔记同时无损保留 `sources` 原文审计串）。
- **验证边界（macOS 已测，Windows 端未测）**：
  - 已运行并全通过 `npm test`（含 `test/memory-graph.test.mjs`, `test/memory-store.test.mjs`, `test/memory-query.test.mjs`, `test/memory-mcp.test.mjs`, `test/dream-context.test.mjs`, `test/architecture-refactor.test.mjs`, `test/i18n.test.mjs`）、`npm run eval`（`ok: true`，11 条记忆用例 `recall=1, precision=1, orderMismatches=0, privacyLeaks=0, budgetViolations=0`）、`npm run build`、`npm run check:deploy` 与 `git diff --check`。
  - 实机备份至 `~/obsidian-backups/agent-deck-memory-graph-2026-11-26` 后在 `马自立` Vault 热重载执行升级与图谱预设：120 条记忆（原 `121` 篇 `.md` 含 `1` 篇 `索引.md`）全部升为短命题文件名并补齐 OKF/图谱边，`metadataCache.resolvedLinks` 从 1 篇 1 条边增至 90 篇 177 条已解析边（`withConcepts=65`、`withSourceNotes=64`、`withUnresolved=0`、`dev:errors` 无新报错），并通过库内安装脚本验证 `memory-query.mjs`（`stats` / `graph` / `search`）与 `memory-mcp.mjs`（`memory_graph`）；详见 [`specs/dream-memory-handoff-2026-11-26.zh-CN.md`](specs/dream-memory-handoff-2026-11-26.zh-CN.md)。阶段 C 新 LLM 提炼提示词（`short_title` + 候选约束 `concepts`）真机 E2E、Windows 端与 Obsidian 图形界面点击交互尚未实测。
