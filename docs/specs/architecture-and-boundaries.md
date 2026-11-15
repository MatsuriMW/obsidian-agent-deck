# 架构与边界规范

## 1. 源码分层与核心锚点（`src/`）

| 层级 | 核心文件 | 职责与关键锚点 |
| --- | --- | --- |
| 入口与设置 | `main.js`, `constants.js`, `settings.js`, `model-groups.js` | 生命周期、`AGENTS` 元数据、`STORE_VERSION = 1`、模型分组；`openTerminalAt`（`main.js`） |
| 会话适配器 | `readers.js`, `cursor-sessions.js`, `desktop-sessions.js`, `codex-desktop.js`, `prompt-text.js` | 只读解析 8 家 Agent 日志/SQLite/Hooks/进程；`USAGE_CACHE_VERSION = 7`（`readers.js`）；`cleanUserPrompt` / `isPromptText`（`prompt-text.js`） |
| 委派与控制 | `delegation.js`, `workflow.js`, `attention.js`, `conversation.js`, `conversation-modal.js`, `dialog.js` | 预览发送、工作位置选择、权限弹窗、只读对话查看与归档（Cursor 含工具时间线）；`openTerminal` / `osa`（`delegation.js`） |
| 日记与整理 | `journal.js`, `autolog.js`, `note-updates.js`, `task-status.js`, `task-id.js`, `task-mentions.js`, `summary-links.js`, `background-output.js`, `organize-journal.js`, `journal-organizer.js`, `journal-layout.js`, `journal-archive.js`, `sync.js` | 按文件排队写入、AI 总结、短链 `[🔗](url)`、语义块号生成与清理、整理与归档 |
| 编辑器与渲染 | `editor.js`, `ai-records.js`, `record-display.js`, `fold-actions.js`, `fold-integration.js`, `log-detail.js`, `mention-suggest.js` | CodeMirror 扩展、阅读后处理、记录折叠、隐藏内部编号、`@` 补全 |
| 面板与回顾 | `view.js`, `dashboard.js`, `dashboard-data.js`, `analytics.js`, `menubar.js`, `menubar.swift`, `agent-assets.js`, `icons.js`, `lattice.js` | 侧栏面板、实验回顾 Dashboard、macOS 菜单栏（`darwin`）、Apache-2.0 点阵（`lattice`） |
| Dream 与记忆 | `dream.js`, `dream-sharing.js`, `llm.js` | 长期记忆整理、单向共享导出与可选 Git 推送 |
| 国际化 | `i18n.js`, `locales/en.js`, `locales/en/*.js` | 跟随 Obsidian 语言（`zh*` 中文，其余英文） |

持久化位置：插件状态在 Vault `data.json`；用量汇总在插件目录 `usage.json`；解析缓存在 `~/.agent-deck/usage-cache.json.gz`。

## 2. 八家 Agent 能力边界

插件内对话窗口只读查看与归档，不设续聊输入框；写入格式、短链、标题保护、块号清理与 token 让渡统一走公共规则。

| Agent | 读取来源 | 工作位置 | 桌面交接与续聊边界 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects` + Claude Desktop | 桌面、后台、终端 | 首轮后用 `claude://resume` 打开桌面同一会话 |
| Codex | `~/.codex/sessions` / `state_*.sqlite` | 桌面、后台、终端 | 桌面走 `codex app-server`；首轮释放后打开 `codex://threads/<id>` |
| DeepSeek Harness | `~/.dsh/sessions`（zstd） | 桌面、后台 | `dsh acp` 后台委派；`dsh://open` 仅唤起客户端并复制会话号 |
| Antigravity | `~/.gemini/antigravity/brain` / ACP | 后台 | `agy acp` 后台委派；无桌面 IDE 交接，IDE 与 CLI 会话不混用 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 桌面、后台、终端 | `opencode-cli acp` 共用 `opencode.db`；打开桌面后手动选会话 |
| Qoder | `~/.qoder/projects` / 桌面 `main.sqlite` | 桌面、后台、终端 | CLI 与桌面 SQLite 不互通；后台走 `qodercli`（终端 `-r` 续聊），桌面复制交接 |
| WorkBuddy | `~/.workbuddy/projects` / `workbuddy.db` | 桌面、终端 | 仅支持中国版；桌面复制等待粘贴，终端跑 `codebuddy`（与桌面不互通）；无后台执行 |
| Cursor | `~/.agent-deck/cursor-events/*.jsonl`（Cursor 3.30.14+ Hooks）+ 可选 WAL SQLite / transcript 元数据补全 | 桌面（仅追踪） | 显式安装 `~/.cursor/hooks.json` 后生效；不做旧版兼容与历史回填；对话视图/归档含工具时间线与折叠长结果；打开桌面端并复制会话号 |

## 3. 双平台与外部集成边界

- **可选集成**：Magpie、Multica、螺旋日程、Telegram Companion、Bullet 折叠与个人主库路径必须运行时探测；`manifest.json` / `package.json` 描述不带冗余 `"Obsidian"`。
- **macOS 专属与 Windows 热点**：
  - 已隔离：`src/menubar.js` 限 `process.platform === "darwin"`；`src/readers.js` 区分 `APPDATA` 与 `Library/Application Support`，并在 `win32` 跳过 `claudeDesktop`。
  - 待适配：`src/delegation.js`（`findBin` / `pickTerminal` / `openTerminal` / `osa`）与 `src/main.js`（`openTerminalAt`）。
