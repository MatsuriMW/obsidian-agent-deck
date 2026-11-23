# Agent 协议接入原则与运行边界

## 新 Agent 接入三原则
1. **必须打通终端交互**：无 CLI 的客户端不纳入委派；可委派与终端交接 Agent（`delegate || terminalHandoff`）自动由 `@` 唤起列表（`routableAgents()`）动态覆盖。
2. **优先打通桌面跳转**：尽量支持会话级协议链接（Obsidian 会话回链统一经 `J.deckSessionUrl()` 构造）。
3. **插件内只读与归档**：对话窗口不设续聊输入框；ACP Runner 通过 `agent-registry.js` 声明式 capability 驱动，兼容 `configOptions` 与标准 `SessionModelState`（`session/set_model`），并扩充跨 Mac 工具链 PATH、登录 shell PATH 兜底发现及 macOS GUI 无显式代理时经 `scutil --proxy` 自动继承系统代理（60s 缓存）；`allModels()` 动态聚合所有 `settings.delegate[*].availableModels`，设置页由表驱动 `renderAcpCard` 统一渲染 ACP 卡片。

## 各 Agent 接法与隔离边界

| Agent | 委派 / 协议接口 | 交接与隔离边界 | 运行依赖 |
| --- | --- | --- | --- |
| **Claude Code** | 无头 `claude` / 终端 | 首轮后 `claude://resume` 导入桌面；未信任库切已信任目录 + `--add-dir` | `claude` CLI + 登录（桌面续聊需桌面端） |
| **Codex** | `codex app-server` / 终端 `codex` | App Server 首轮释放后打开 `codex://threads/<id>`；优先复用桌面自带 CLI | `codex` CLI + 登录 + 桌面端 |
| **DeepSeek Harness** | `dsh acp`（ACP） | `dsh://open` 仅唤起客户端并复制会话号，需手动选会话；桌面端稳定性有限 | ACP 版 `dsh` + 提供商登录 |
| **Antigravity** | `agy acp`（原生 ACP） | ACP 会话可在 Obsidian 内查看、归档和继续追问。桌面会话的进度条打开客户端并复制会话 ID，由用户在客户端定位 | 独立 `agy` CLI 已登录 |
| **OpenCode** | `opencode-cli acp` / 终端 `opencode` | 共用 `opencode.db`；优先调用 `OpenCode.app` 内置 CLI；打开桌面后需手动选会话 | OpenCode 桌面端或独立 CLI |
| **Hermes Agent** | `hermes-acp` / 终端 `hermes chat` | 声明式 capability 驱动 ACP（支持 `configOptions` 与标准 `models` / `session/set_model`），权限弹窗按 runner 排队、`option.kind \| optionId \| name` 兼容 `allow*`/`reject*`/`deny*`；只读读取 `$HERMES_HOME/state.db` | `hermes-acp` / `hermes` CLI（支持 Homebrew / `uv` / 用户登录 shell PATH 兜底发现） |
| **MiniMax Code** | `mcode acp` / 终端 `mcode --session` | 桌面与 `mcode` CLI 共用 `$MINIMAX_DATA_DIR/v2/sqlite/runtime-state.sqlite`；支持后台 ACP 委派、终端续聊与桌面端 `com.minimax.agent.cn`（回退 `minimax-cn://open`）唤起 | MiniMax Code 桌面端 / `mcode` CLI |
| **千问办公（QwenWork）** | 无非交互委派接口（仅追踪） | 只读读取 2.x 会话库 `~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`（OpenCode schema，含逐轮 token/模型）与旧版 `~/.qwenworkcn/projects` JSONL；旧 JSONL 无 usage 或 `model="unknown"` 时保持 `0`/留空；唤起 `QwenWorkCN.app` (`qwenwork-cn://`) | 千问办公桌面端（`QwenWorkCN.app`） |
| **Qoder** | `qodercli`（`-p` / `-r <sid>`） | `~/.qoder/projects` 与桌面 SQLite 不互通；CLI 走终端 `-r` 续聊，桌面复制交接 | `qodercli` + 登录；桌面缺逐轮 token 时不估算 |
| **WorkBuddy** | 桌面复制交接 / 终端 `codebuddy` | 仅中国版（`~/.workbuddy`、`workbuddy://`）；独立 `codebuddy` CLI 与桌面不互通；无后台执行 | 中国版 WorkBuddy 桌面端 |
| **Cursor** | `agent acp` / 桌面端交接 | 装有 `agent` / `cursor-agent` 时支持 `agent acp` 后台委派与同 `sid` `session/load` 续聊（`continueRequiresAcp: true` 保护桌面会话不误走 ACP）；未装 CLI 或显式选「桌面客户端」时自动回退复制交接并唤起 `cursor://`；Cursor Hooks（`v2`）捕获事件与父子代理归属 | Cursor 桌面端 / `agent` CLI + 登录；Obsidian GUI 依赖 `scutil --proxy` 系统代理注入 |
| **Gemini CLI** | `gemini --acp` / 终端 `gemini --resume` | 只读解析 `~/.gemini/tmp/<projectSlug>/chats/session-*.jsonl`；支持 `gemini --acp` 后台委派、应用内续聊与终端 `gemini --resume` 续聊 | `gemini` CLI（注：个人版 Gemini Code Assist 账号受服务端停用限制） |
| **T3 Code** | `t3 thread start` / `t3 thread send` | 通过 CLI 管理编排线程并在 AutoLog 中按 `provider_threads` / `resume_cursor_json` 去重转发的底层 Agent 会话；项目未登记时自动 `t3 project add`；桌面端唤起 `t3code://` 并复制会话号 | T3 Code 桌面服务 / `t3` CLI |
| **自定义 ACP Agent** | 任意兼容 ACP CLI（`settings.customAcpAgents`） | 启动与保存时经 `syncCustomAcpRegistry` 动态注入能力表与环境变量（支持 `secret:`/`env:` 脱敏解析）；支持设置页通用模型挑选、`@` 路由、权限护栏与 `allModels()` 动态聚合；保护免受 `harness-detect` 自动关闭 | 用户配置的兼容 ACP CLI |
| **整理 / Dreaming / 总结** | 「记录」页所选 `claude` / `codex` CLI | 只读追踪与 Dashboard 不调 CLI；设置页「检查」只验路径与版本，不验登录态 | 整理 CLI 路径、登录与额度 |
| **macOS 菜单栏** | `src/menubar.swift` 本机编译 | 仅 `darwin` 启用，Windows 自动跳过 | Xcode CLT `swiftc` |
