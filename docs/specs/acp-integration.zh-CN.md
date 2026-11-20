# Agent 协议接入原则与运行边界

## 新 Agent 接入三原则
1. **必须打通终端交互**：无 CLI 的客户端不纳入委派；可委派与终端交接 Agent（`delegate || terminalHandoff`）自动由 `@` 唤起列表（`routableAgents()`）动态覆盖。
2. **优先打通桌面跳转**：尽量支持会话级协议链接（Obsidian 会话回链统一经 `J.deckSessionUrl()` 构造）。
3. **插件内只读与归档**：对话窗口不设续聊输入框；ACP Runner 通过 `agent-registry.js` 声明式 capability 驱动，兼容 `configOptions` 与标准 `SessionModelState`（`session/set_model`），并扩充跨 Mac 工具链 PATH 及登录 shell 兜底发现。

## 各 Agent 接法与隔离边界

| Agent | 委派 / 协议接口 | 交接与隔离边界 | 运行依赖 |
| --- | --- | --- | --- |
| **Claude Code** | 无头 `claude` / 终端 | 首轮后 `claude://resume` 导入桌面；未信任库切已信任目录 + `--add-dir` | `claude` CLI + 登录（桌面续聊需桌面端） |
| **Codex** | `codex app-server` / 终端 `codex` | App Server 首轮释放后打开 `codex://threads/<id>`；优先复用桌面自带 CLI | `codex` CLI + 登录 + 桌面端 |
| **DeepSeek Harness** | `dsh acp`（ACP） | `dsh://open` 仅唤起客户端并复制会话号，需手动选会话；桌面端稳定性有限 | ACP 版 `dsh` + 提供商登录 |
| **Antigravity** | `agy acp`（原生 ACP） | ACP 会话可在 Obsidian 内查看、归档和继续追问。桌面会话的进度条打开客户端并复制会话 ID，由用户在客户端定位 | 独立 `agy` CLI 已登录 |
| **OpenCode** | `opencode-cli acp` / 终端 `opencode` | 共用 `opencode.db`；优先调用 `OpenCode.app` 内置 CLI；打开桌面后需手动选会话 | OpenCode 桌面端或独立 CLI |
| **Hermes Agent** | `hermes-acp` / 终端 `hermes chat` | 声明式 capability 驱动 ACP（支持 `configOptions` 与标准 `models` / `session/set_model`），权限弹窗按 runner 排队、`option.kind \| optionId \| name` 兼容 `allow*`/`reject*`/`deny*`；只读读取 `$HERMES_HOME/state.db` | `hermes-acp` / `hermes` CLI（支持 Homebrew / `uv` / 用户登录 shell PATH 兜底发现） |
| **千问办公（QwenWork）** | 无非交互委派接口（仅追踪） | 只读读取 2.x 会话库 `~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`（OpenCode schema，含逐轮 token/模型）与旧版 `~/.qwenworkcn/projects` JSONL；旧 JSONL 无 usage 或 `model="unknown"` 时保持 `0`/留空；唤起 `QwenWorkCN.app` (`qwenwork-cn://`) | 千问办公桌面端（`QwenWorkCN.app`） |
| **Qoder** | `qodercli`（`-p` / `-r <sid>`） | `~/.qoder/projects` 与桌面 SQLite 不互通；CLI 走终端 `-r` 续聊，桌面复制交接 | `qodercli` + 登录；桌面缺逐轮 token 时不估算 |
| **WorkBuddy** | 桌面复制交接 / 终端 `codebuddy` | 仅中国版（`~/.workbuddy`、`workbuddy://`）；独立 `codebuddy` CLI 与桌面不互通；无后台执行 | 中国版 WorkBuddy 桌面端 |
| **整理 / Dreaming / 总结** | 「记录」页所选 `claude` / `codex` CLI | 只读追踪与 Dashboard 不调 CLI；设置页「检查」只验路径与版本，不验登录态 | 整理 CLI 路径、登录与额度 |
| **macOS 菜单栏** | `src/menubar.swift` 本机编译 | 仅 `darwin` 启用，Windows 自动跳过 | Xcode CLT `swiftc` |
