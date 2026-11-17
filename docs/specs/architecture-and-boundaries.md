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
├── assets/                        # Agent 图标（agents/*.png）、架构图（architecture*.svg）与演示媒体
└── docs/                          # README.md 导航、task-workflow.zh-CN.md 交接速查、specs/*.md 规范
```

## 2. 源码分层与核心锚点（`src/`）

| 层级 | 核心文件 | 职责与关键锚点 |
| --- | --- | --- |
| 入口与设置 | `main.js`, `runtime-guard.js`, `constants.js`, `settings.js`, `settings-agents.js`, `model-groups.js` | 生命周期、`ManagedTimers` / `CircuitBreaker` / `safeRun` 定时隔离、`AGENTS` 元数据、`STORE_VERSION = 1`、Agent 排序/主力推荐、模型分组；`openTerminalAt`（`main.js`） |
| 会话适配器 | `readers.js`, `agent-ingestors.js`, `cursor-sessions.js`, `grok-bot-sessions.js`, `desktop-sessions.js`, `codex-desktop.js`, `prompt-text.js`, `external-state.js` | 可扩展 Agent 日志解析注册表（`registerAgentIngestor`）、只读解析 9 家 Agent 日志/SQLite/Hooks/Persistence Blob/进程与外部排队状态；`USAGE_CACHE_VERSION = 12`（`readers.js`）；`cleanUserPrompt` / `isPromptText`（`prompt-text.js`） |
| 委派与控制 | `agent-registry.js`, `harness.js`, `delegation-runners.js`, `delegation.js`, `project-folders.js`, `workflow.js`, `attention.js`, `conversation.js`, `conversation-modal.js`, `dialog.js`, `project-workbench.js`, `workbench-modal.js` | 声明式 Agent 能力注册、可扩展 Harness 管道（`stripInternalIdentifiers` 剥离内部标识）与大纲/双链上下文解析、可扩展 Runner 注册表（`registerRunnerClass`）、工作位置选择、权限弹窗、只读对话查看与归档、项目聚合与等待筛选（`buildProjectGroups`、`isWaitingSession`）、小队编排与副驾拆解、项目名↔目录登记与派发目录解析（`projectFolders`、`autoProjectFolder`）、未登记项目的最近会话建议（`suggestProjectForTask` / `recentProjectFolders`）、非日记笔记派发默认不重复记日记（`noteDispatchSessions` / `noteDispatchJournal`）；`openTerminal` / `osa`（`delegation.js`） |
| 日记与整理 | `outline.js`, `journal.js`, `autolog.js`, `note-updates.js`, `task-status.js`, `task-id.js`, `task-mentions.js`, `summary-links.js`, `background-output.js`, `organize-journal.js`, `journal-organizer.js`, `journal-layout.js`, `journal-archive.js`, `task-export.js`, `sync.js` | 共享只读大纲/双链原语（`outline.js`）、按文件排队写入、AI 总结、短链 `[🔗](url)`、语义块号生成与清理、整理/按视图导出（PDF/HTML/MD/JSON/CSV/剪贴板）与归档 |
| 编辑器与渲染 | `editor.js`, `ai-records.js`, `record-display.js`, `fractal-board.js`, `fold-actions.js`, `fold-integration.js`, `log-detail.js`, `mention-suggest.js` | CodeMirror 扩展、阅读后处理、记录折叠、分形看板投影（`taskBoardViews`）、视图持久化（`key` + `stableKey`）、隐藏内部编号、`@` 补全 |
| 面板与回顾 | `view.js`, `dashboard.js`, `dashboard-data.js`, `analytics.js`, `menubar.js`, `menubar.swift`, `welcome-demo.js`, `agent-assets.js`, `icons.js`, `lattice.js` | 侧栏面板（按项目/列表、7/30/120 天叠放与 30 张上限）、实验回顾 Dashboard、功能示例笔记（`SHOWCASE_VERSION`）、macOS 菜单栏（`darwin`）、Apache-2.0 点阵（`lattice`） |
| Dream 与记忆 | `dream-entries.js`, `dream.js`, `dream-sharing.js`, `llm.js` | 无环记忆解析基础模块、长期记忆整理、单向共享导出与可选 Git 推送 |
| 样式层 | `styles/index.css`, `styles/base/*.css`, `styles/views/*.css` | 分层样式入口（基础层 → 视图层 → 动效降级层），`esbuild` 打包至根目录 `styles.css` |
| 国际化 | `i18n.js`, `locales/en.js`, `locales/en/*.js` | 跟随 Obsidian 语言（`zh*` 中文，其余英文） |

持久化位置：插件状态在 Vault `data.json`（`STORE_VERSION = 1`）；用量汇总在插件目录 `usage.json`（`SUMMARY_VERSION = 3`）；解析缓存在 `~/.agent-deck/usage-cache.json.gz`（`USAGE_CACHE_VERSION = 12`）。

## 3. 九家 Agent 能力边界

插件内对话窗口只读查看与归档，不设续聊输入框；写入格式、短链、标题保护、块号清理与 token 让渡统一走公共规则。

| Agent | 读取来源 | 工作位置 | 桌面交接与续聊边界 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects` + Claude Desktop | 桌面、后台、终端 | 首轮后用 `claude://resume` 打开桌面同一会话 |
| Codex | `~/.codex/sessions` / `state_*.sqlite` | 桌面、后台、终端 | 桌面走 `codex app-server`；`thread/start` 前按 cwd 复用或创建 Codex 项目并带上 `projectId`（`settings.delegate.codex.project`，实验性接口失败则按原样派发）；首轮释放后打开 `codex://threads/<id>` |
| DeepSeek Harness | `~/.dsh/sessions`（zstd） | 桌面、后台 | `dsh acp` 后台委派；`dsh://open` 仅唤起客户端并复制会话号；ACP 会话无 workspace ID，客户端归入「未分组」，通常需重启/刷新客户端才出现在列表 |
| Antigravity | `~/.gemini/antigravity/brain` / ACP | 后台 | `agy acp` 后台委派；无桌面 IDE 交接，IDE 与 CLI 会话不混用 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 桌面、后台、终端 | `opencode-cli acp` 共用 `opencode.db`；打开桌面后手动选会话 |
| Qoder | `~/.qoder/projects` / 桌面 `main.sqlite` | 桌面、后台、终端 | CLI 与桌面 SQLite 不互通；后台走 `qodercli`（终端 `-r` 续聊），桌面复制交接 |
| WorkBuddy | `~/.workbuddy/projects` / `workbuddy.db` | 桌面、终端 | 仅支持中国版；桌面复制等待粘贴，终端跑 `codebuddy`（与桌面不互通）；无后台执行 |
| Cursor | `~/.agent-deck/cursor-events/*.jsonl`（Cursor 3.30.14+ Hooks）+ 可选 WAL SQLite / transcript 元数据补全 | 桌面（仅追踪） | 显式安装 `~/.cursor/hooks.json` 后生效；不做旧版兼容与历史回填；对话视图/归档含工具时间线与折叠长结果；打开桌面端并复制会话号 |
| Grok Bot | `~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`（Base32 `last-roster` + `transcript.replicas`） | 桌面（仅追踪） | 按 `grokBotTrackedBotIds` 多选过滤（默认全不选）；云端沙箱无本地逐条 token/模型，保留为 `0`/未提供；打开 `grokbot://` / `com.anysphere.sand` 并复制 Bot 会话号 |

## 4. 双平台与外部集成边界

- **可选集成**：Magpie、Multica、螺旋日程、Telegram Companion、Bullet 折叠与个人主库路径必须运行时探测；`manifest.json` / `package.json` 描述不带冗余 `"Obsidian"`。
- **macOS 专属与 Windows 热点**：
  - 已隔离：`src/menubar.js` 限 `process.platform === "darwin"`；`src/readers.js` 区分 `APPDATA` 与 `Library/Application Support`，并在 `win32` 跳过 `claudeDesktop`。
  - 待适配：`src/delegation.js`（`findBin` / `pickTerminal` / `openTerminal` / `osa`）与 `src/main.js`（`openTerminalAt`）。
  - 当前验证范围：macOS 已测、Windows 未测。
