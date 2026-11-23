# 架构与边界规范

## 1. 仓库结构

```text
.
├── AGENTS.md / CLAUDE.md          # 规则与接手入口（AGENTS.md 为正本）
├── esbuild.config.mjs             # 打包 src/main.js → main.js，src/styles/index.css → styles.css
├── manifest.json / versions.json  # Obsidian 插件清单与版本映射
├── main.js / styles.css           # 构建产物（勿直接修改）
├── src/
│   ├── *.js                       # 插件模块化源码（无循环依赖，见 test/architecture-refactor.test.mjs）
│   ├── menubar.swift              # macOS 原生菜单栏助手源码（darwin 按需编译）
│   ├── locales/                   # en.js + en/*.js 英文文案分片
│   └── styles/                    # CSS 源码（index.css + base/ + views/）
├── test/*.test.mjs                # Node 原生测试（npm test）
├── scripts/install.mjs            # 跨平台安装产物与 README-交接.md 至 Vault
├── scripts/eval-context.mjs       # 离线 Context 评测基准（npm run eval）
├── scripts/check-deploy.mjs       # 版本对齐、产物体积预算与外围脚本版本检查（npm run check:deploy）
├── .github/workflows/ci.yml       # 三端（Linux/macOS/Windows）测试、评测与构建 CI 矩阵
├── assets/                        # Agent 图标（agents/*.png）、架构图（architecture*.svg）与演示媒体
└── docs/                          # README.md 导航、task-workflow.zh-CN.md 交接速查、specs/*.md 规范
```

## 2. 源码分层与核心锚点（`src/`）

| 层级 | 核心文件 | 职责与关键锚点 |
| --- | --- | --- |
| 入口与设置 | `main.js`, `runtime-guard.js`, `security.js`, `security-audit.js`, `trace.js`, `update-check.js`, `constants.js`, `settings.js`, `settings-agents.js`, `harness-detect.js`, `model-groups.js` | 生命周期、`ManagedTimers` / `CircuitBreaker` / `safeRun` 定时隔离、`resolveSecret`（`env:`/`secret:`）与 `redactSecrets`、`evaluatePermissionPolicy` 风险升阶、离线历史工具调用安全回放与按高/中/低危分组的多行代码块脱敏审计报告（`runSecurityAudit` → `Agent Deck/安全审计.md`，支持 `days`/`agent`/`ignore_temp_noise`/`allowlist` 配置）、本地 JSONL `RunTrace` 与脱敏诊断导出（`exportDiagnostics`）、启动 24h 节流自动检查 GitHub Releases 更新与一键跳转提示（`checkLatestRelease` / `checkForUpdates`）、`AGENTS` 元数据、`STORE_VERSION = 1`、`MEMORY_QUERY_ASSET_VERSION = 1`、Agent 排序/主力推荐、本机 Harness 自动探测与默认关闭未安装项（`detectInstalledHarnesses` / `applyHarnessDetection`，保护自定义 ACP 项）、模型分组；`openTerminalAt` / `checkBinary`（走 `cleanEnv()`）（`main.js`） |
| 会话适配器 | `readers.js`, `sqlite.js`, `agent-ingestors.js`, `cursor-sessions.js`, `grok-bot-sessions.js`, `muse-sessions.js`, `kimicode-sessions.js`, `doubaowork-sessions.js`, `gemini-cli-sessions.js`, `desktop-sessions.js`, `codex-desktop.js`, `prompt-text.js`, `external-state.js`, `teleagent.js` | 可扩展 Agent 日志解析注册表（`registerAgentIngestor`）、跨平台 `sqlite3` CLI 探测（`resolveSqliteBinary`）、只读解析 18 家 Agent 日志/SQLite/Hooks/Persistence Blob/IndexedDB LevelDB/对话缓存/进程与外部排队状态、原生客户端标题（`custom-title` / `ai-title` / `thread_name` / DB `title`）追踪（`hasClientTitle`）；`USAGE_CACHE_VERSION = 18`（`readers.js`）；桌面 SQLite 库默认只读 `settings.fullHistoryDays` 天（`settings.desktopFullHistory` 打开后主力 Agent 读全部历史，见 `readDesktopDatabases`）；TeleAgent 的库路径由 `teleagent.js` 按平台与环境变量探测；`cleanUserPrompt` / `isPromptText`（`prompt-text.js`） |
| 委派与控制 | `agent-registry.js`, `custom-acp.js`, `harness.js`, `delegation-runners.js`, `delegation.js`, `terminals.js`, `teleagent-dispatch.js`, `teleagent-dispatch-linux.js`, `project-folders.js`, `workflow.js`, `attention.js`, `conversation.js`, `conversation-modal.js`, `dialog.js`, `project-workbench.js`, `workbench-modal.js` | 声明式 Agent 能力注册（`canContinueSession` / `unregisterAgentCapability`）、自定义 ACP Agent 通用动态注册与 `secret:`/`env:` 环境变量解析（`syncCustomAcpRegistry` / `parseCustomAcpEnv`）、可扩展 Harness 管道（`stripInternalIdentifiers` 剥离内部标识）与大纲/双链上下文解析、可扩展 Runner 注册表（`registerRunnerClass`）、表驱动主力终端注册表与唤起/切标签（`terminals.js`：支持系统终端 / iTerm2 / Warp / Ghostty / cmux / tmux / WezTerm / Kitty / Alacritty / Tern / Herdr 及 Windows `wt.exe`/`cmd.exe` 回退）、客户端派发（`teleagent-dispatch.js` 走 Windows UI Automation 并在派发后只读回读 `teleagent.db` 确认；`teleagent-dispatch-linux.js` 走 `xdotool` + 剪贴板，`src/native/treeland-activate.c` 为可选的 treeland 合成器级激活 helper，构建失败时按「请先手动切到 TeleAgent」降级）、工作位置选择、权限弹窗（含一键允许并开启自动允许）、只读对话查看与归档（`ConversationModal` 保持纯只读，应用内追问走 `taskActions` → `FollowUpModal`）、项目聚合与等待筛选（`buildProjectGroups`、`isWaitingSession`）、小队编排与副驾拆解、项目名↔目录登记与派发目录解析（`projectFolders`、`autoProjectFolder`）、未登记项目的最近会话建议（`suggestProjectForTask` / `recentProjectFolders`）、非日记笔记派发默认不重复记日记（`noteDispatchSessions` / `noteDispatchJournal`） |
| 日记与整理 | `outline.js`, `journal.js`, `autolog.js`, `note-updates.js`, `task-status.js`, `task-id.js`, `task-mentions.js`, `summary-links.js`, `background-output.js`, `organize-journal.js`, `journal-organizer.js`, `journal-layout.js`, `journal-archive.js`, `task-export.js`, `sync.js` | 共享只读大纲/双链原语（`outline.js`）、按文件排队写入、AI 总结、短链 `[🔗](url)`、语义块号生成与清理、`<!-- ad-pin -->` 关键记录标记、整理/按视图导出（PDF/HTML/MD/JSON/CSV/剪贴板）与归档 |
| 编辑器与渲染 | `editor.js`, `ai-records.js`, `record-display.js`, `fractal-board.js`, `fold-actions.js`, `fold-integration.js`, `log-detail.js`, `mention-suggest.js` | CodeMirror 扩展、阅读后处理、记录折叠与 Pin 免藏、分形看板投影（`taskBoardViews`）、视图持久化（`key` + `stableKey`）、隐藏内部编号、`@` 补全 |
| 面板与回顾 | `view.js`, `dashboard.js`, `dashboard-data.js`, `analytics.js`, `menubar.js`, `menubar.swift`, `session-titles.js`, `welcome-demo.js`, `agent-assets.js`, `icons.js`, `lattice.js` | 侧栏面板（「现在」按项目/按状态/列表三模式；最近 7/30/120 天叠放与 30 张上限）、实验回顾 Dashboard（含跨会话任务投入与安全回放护栏入口）、三语「新功能速览与交互指南」示例笔记（永远「本期新功能」置顶 + 7 张配图 + 默认预览态打开 + `shouldOpenShowcaseForVersion` 大/次版本及 `< 1.13.13 → 1.13.x` 自动弹出一次）、macOS 菜单栏悬浮常驻/置顶 Pin/同步「现在」按项目·按状态·列表三分类及双向切换（`setNowGroupBy`）/会话置顶/无客户端标题时按额度模型兜底生成（`darwin`）、Apache-2.0 点阵（`lattice`） |
| Dream 与记忆 | `dream-entries.js`, `dream.js`, `dream-sharing.js`, `memory-store.js`, `memory-query-core.js`, `memory-import.js`, `memory-review.js`, `memory-board.js`, `planner.js`, `workbench-note.js`, `skill-cards.js`, `llm.js` | 无环记忆解析与分词/隐私闸门核心模块（`memory-query-core.js`）、长期记忆整理（单文件 / 一文一条双模式，`pinned` 关键记录优先入批与提权）、记忆导入（`.md/.json/.zip` 0 Token 拆条与模型提炼）、来源块号与反向回链、记忆审阅与看板、目标→task.md 规划、工作台索引、单向共享导出与可选 Git 推送 |
| 样式层 | `styles/index.css`, `styles/base/*.css`, `styles/views/*.css` | 分层样式入口（基础层 → 视图层 → 动效降级层），`esbuild` 打包至根目录 `styles.css` |
| 国际化 | `i18n.js`, `locales/en.js`, `locales/en/*.js` | 跟随 Obsidian 语言（`zh*` 中文，其余英文） |

记忆与派发产物（均为普通 Markdown，可被 Agent 直接读）：`Agent Deck/记忆/*.md`（一文一条，frontmatter 带 `id/title/kind/type/state/date/sources`）、`Agent Deck/长期记忆.md`（人工前言 + `<!-- ad:memory:start -->` 生成区块）、`Agent Deck/记忆.base`、`Agent Deck/派发/*.md`（派发载荷快照）、`Agent Deck/任务/*.md`（Planner 产出）、`Agent Deck/工作台.md`（索引）、`技能/*.md`（外部 Skill 的库内侧影，真实路径在 frontmatter）。

持久化位置：插件状态在 Vault `data.json`（`STORE_VERSION = 1`）；用量汇总在插件目录 `usage.json`（`SUMMARY_VERSION = 3`）；解析缓存在 `~/.agent-deck/usage-cache.json.gz`（`USAGE_CACHE_VERSION = 18`）。

日记写入和回顾共用 `journalPath` 定位日记。`journal.js` 统一会话时段和任务行格式，`autolog.js` 负责自动建项，`sync.js` 负责同步已有任务。客户端日志差异在会话适配器中消化。

Dream 的只读材料采集在 `dream-evidence.js`。现有提炼由 `Dreaming.analyzeMemoryBatch` 生成候选，由 `Dreaming.run` 管理进度和落盘。主题与用语分析可共用材料边界，各自生成候选。

## 3. 十八家 Agent 能力边界

插件内对话窗口只读查看与归档，不设续聊输入框；写入格式、短链、标题保护、块号清理与 token 让渡统一走公共规则。

| Agent | 读取来源 | 工作位置 | 桌面交接与续聊边界 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects` + Claude Desktop | 桌面、后台、终端 | 首轮后用 `claude://resume` 打开桌面同一会话 |
| Codex | `~/.codex/sessions` / `state_*.sqlite` | 桌面、后台、终端 | 桌面走 `codex app-server`；`thread/start` 前按 cwd 复用或创建 Codex 项目并带上 `projectId`（`settings.delegate.codex.project`，实验性接口失败则按原样派发）；首轮释放后打开 `codex://threads/<id>` |
| DeepSeek Harness | `~/.dsh/sessions`（zstd） | 桌面、后台 | `dsh acp` 后台委派；`dsh://open` 仅唤起客户端并复制会话号；ACP 会话无 workspace ID，客户端归入「未分组」，通常需重启/刷新客户端才出现在列表 |
| Antigravity | `~/.gemini/antigravity/brain` + `~/.gemini/antigravity-cli/brain` / ACP | 后台 | `agy acp` 后台委派；同时追踪 IDE 与独立 CLI 的 brain 日志，无桌面 IDE 交接 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 桌面、后台、终端 | `opencode-cli acp` 共用 `opencode.db`；打开桌面后手动选会话 |
| Hermes Agent | `$HERMES_HOME/state.db`（含 `profiles/*/state.db`） | 后台、终端 | `hermes-acp` 后台委派（支持 `models` / `session/set_model`）或终端 `hermes chat` / `hermes --resume`；只读换算 Unix 秒与 token（`input_tokens + cache_write_tokens` / `cache_read_tokens` / `output_tokens`），跳过 `hidden=1`，保留 `active=1 OR compacted=1` |
| MiniMax Code | `$MINIMAX_DATA_DIR/v2/sqlite/runtime-state.sqlite`（默认 `~/.minimax` / `~/.mavis`） | 桌面、后台、终端 | 桌面版与 `mcode` CLI 共用 v2 SQLite（`local_runtime_sessions` / `local_runtime_message_rows` + 旧 `local_runtime_messages` 回退 / `local_runtime_token_usage` / `local_runtime_projects`，跳过 `visibility='hidden'`）；装有 `mcode` 时支持 `mcode acp` 后台委派与终端 `mcode --session` 续聊；桌面会话唤起 `com.minimax.agent.cn`（回退 `com.minimax.agent` / `minimax-cn://open`）并复制会话号 |
| 千问办公（QwenWork） | 2.x：`~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`（OpenCode schema）；旧版：`~/.qwenworkcn/projects/*/*.jsonl` | 桌面（仅追踪） | CLI / 客户端未提供非交互委派接口（`trackingOnly: true`）；SQLite 会话带逐轮 token 与模型名，旧 JSONL 缺 usage 或 `model="unknown"` 时不估算；首条用户消息的引擎注入前缀（`workspace_context` / `system-reminder` / 工具清单）在适配器层剥除；打开 `cn.qwenwork.desktop.mac` / `qwenwork-cn://` 并复制会话号 |
| Qoder | `~/.qoder/projects` / 桌面 `main.sqlite` | 桌面、后台、终端 | CLI 与桌面 SQLite 不互通；后台走 `qodercli`（终端 `-r` 续聊），桌面复制交接 |
| TeleAgent（星辰超级智能体） | `$SUPER_AGENT_APP_DATA_DIR` 或 `~/.local/share/TeleAgent` 下的 `users/<账号>/teleagent.db`（OpenCode 老版 `session`/`message`/`part` 结构） | 桌面（复制交接） | 内核是 OpenCode 派生的 Go 二进制，没有 ACP / 非交互 CLI 入口（`trackingOnly: true`）；`current-owner.json` 的 `ownerDir` 排最前，其余账号一并只读；token 取 `message.data.tokens`，缺失记 `0` 不估算；用户消息里 `<span data-path-name>` 附件的绝对路径在适配器层剥除；打开 `teleai-cowork://` 并复制会话号 |
| WorkBuddy | `~/.workbuddy/projects` / `workbuddy.db` | 桌面、终端 | 仅支持中国版；桌面复制等待粘贴，终端跑 `codebuddy`（与桌面不互通）；无后台执行 |
| Cursor | `~/.agent-deck/cursor-events/*.jsonl`（Cursor 3.30.14+ Hooks）+ 可选 WAL SQLite / transcript 元数据补全 | 桌面（仅追踪） | 显式安装 `~/.cursor/hooks.json` 后生效；不做旧版兼容与历史回填；对话视图/归档含工具时间线与折叠长结果；打开桌面端并复制会话号 |
| Grok Bot | `~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`（Base32 `last-roster` + `transcript.replicas`） | 桌面（仅追踪） | 按 `grokBotTrackedBotIds` 多选过滤（默认全不选）；云端沙箱无本地逐条 token/模型，保留为 `0`/未提供；打开 `grokbot://` / `com.anysphere.sand` 并复制 Bot 会话号 |
| T3 Code | `$T3_DATA_DIR/statev2.sqlite`（默认 `~/.t3/userdata/statev2.sqlite`，回退 `state.sqlite`） | 桌面、后台 | 只读解析 v2 编排投影表（`orchestration_v2_projection_threads` / `messages` / `runs` / `run_attempts` / `provider_turns` / `provider_threads` + `projection_projects`，支持 v1 `projection_threads` 回退），追踪 `worktreePath`、子代理 `lineage.parentThreadId`、`archived_at`、逐轮 `turnTokenUsage` 与模型名；自动记录时按 `provider_threads.nativeThreadRef.nativeId` / `provider_session_runtime.resume_cursor_json` 去重底层被转发的 Agent 会话，统一收录在 T3 Code 下；通过 `t3 thread start` / `t3 thread send` 后台委派与应用内续聊（项目未登记时自动 `t3 project add`）；打开 `com.t3tools.t3code` / `t3code://` 并复制会话号 |
| Muse | `~/Library/Caches/ConversationCache/*.json`（默认 `hatch-main.json`，支持 `MUSE_CACHE_DIR`） | 桌面（仅追踪） | 支持按 `museTrackedIds` 分对话流多选追踪（默认追踪 `hatch-main` Main Chat，上限 `museMaxTracked = 5`，设置页提供勾选器）；换算 Apple `CFAbsoluteTime` 时间戳，提取 `contentBlocks`（`markdown` + `optionWidget`）并剥离 `[[hatch_widget:...]]`；云端 VM 无本地 token/模型，保留为 `0`/未提供；打开 `com.meta.endo` / `hatch://` 并复制会话号 |
| Kimi Code | `~/.kimi-code/sessions/<wsHash>/<sessionId>/wire.jsonl`（含 `session-meta/state.json`、`workspaces.json`，支持 `KIMI_CODE_HOME` / `~/.kimi` 回退） | 桌面、CLI（仅追踪） | 只读解析 v1.5 `wire.jsonl`（`turn.prompt` / `turn_begin` / `step.begin` / `content.part` / `tool.call` / `step.end` / `turn.end`）与 `state.json` 自定义标题及归档状态；按 `inputOther + inputCacheCreation` / `inputCacheRead` / `output` 精确统计 token；打开 `com.kimi.code.desktop` / `kimi-code://` 并复制会话号 |
| 豆包工作（Doubao Work） | `~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb`（支持 `DOUBAOWORK_DATA_DIR`） | 桌面（仅追踪） | 只读扫描 LevelDB `.log` 与 Snappy 压缩 `.ldb` 块中的 V8 Structured Clone 会话列表元数据（`conversation_id`、`name` UTF-16LE/Latin-1、`create_time`、`update_time`）；完整正文存于 SQLCipher 加密的 `sdk_storage/*/messages.db`，严格不解密，token/模型保留为 `0`/未提供；打开 `com.work.pc.doubao` / `doubaowork://` 并复制会话号 |
| Gemini CLI | `~/.gemini/tmp/<projectSlug>/chats/session-*.jsonl`（兼容旧版 `session-*.json`，支持 `GEMINI_CLI_HOME`） | 后台、终端 | 通过 `~/.gemini/projects.json` 与 `.project_root` 还原 `cwd`，支持 JSONL `$set` / `$patch` / `$rewindTo` 与 `<session_context>` / `<hook_context>` 剥离；按 `input - cached` / `cached` / `output + thoughts` 精确统计 token；支持 `gemini --acp` 后台委派、应用内追问与终端 `gemini --resume <sid>` 续聊 |

## 4. 双平台与外部集成边界

- **可选集成**：Magpie、Multica、螺旋日程、Telegram Companion、Bullet 折叠与个人主库路径必须运行时探测；`manifest.json` / `package.json` 描述不带冗余 `"Obsidian"`。
- **macOS 专属与 Windows 热点**：
  - 已隔离：`src/menubar.js` 限 `process.platform === "darwin"`；`src/readers.js` 区分 `APPDATA` 与 `Library/Application Support`，并在 `win32` 跳过 `claudeDesktop`。
  - 待适配：`src/terminals.js`（Windows 终端焦点切换与非 `wt.exe`/`cmd.exe` 终端适配）。
  - 当前验证范围：macOS 已测、Windows 未测。
