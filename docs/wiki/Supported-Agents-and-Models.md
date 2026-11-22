# 支持的 Agent 与主流模型

Agent Deck 的目标是成为跨模型、跨客户端的统一本地总控台：**本地文件只读追踪 + 协议化后台委派**，不绑定单一厂商生态。

## 一、主流模型支持

无论你通过本地客户端、自定义 ACP CLI 还是 OpenAI 兼容 API（用于日记总结、整理与 Dreaming）使用模型，Agent Deck 均已完整适配：

- **国际主流模型**：Claude（Anthropic）、GPT / Codex（OpenAI）、Gemini（Google）、Grok（xAI）等
- **国产主流模型**：DeepSeek、Qwen / 千问（阿里云百炼）、MiniMax、Kimi、豆包等
- **本地与聚合模型**：Ollama 本地模型、OpenRouter 及任意 OpenAI 兼容端点

在 Dashboard 中，所有客户端的 Token 消耗、缓存命中率与模型分布都会按统一口径汇总；**缺少真实用量数据时如实显示 0 或「未提供」，绝不估算**。

## 二、中文 Agent 客户端生态深度适配

针对中文开发者和办公用户日常高频使用的国产客户端，Agent Deck 专门实现了本地数据解析与追踪适配（部分支持后台委派与续聊）：

| 中文客户端 | 本地数据来源 | 支持能力 | 使用说明与边界 |
| --- | --- | --- | --- |
| **DeepSeek Harness** | `~/.dsh/sessions`（zstd） | 追踪 + 后台委派（`dsh acp`） + 唤起桌面端 | 委派会话在客户端可能落入「未分组」，通常刷新客户端后可见 |
| **MiniMax Code** | `$MINIMAX_DATA_DIR/v2/sqlite/runtime-state.sqlite` | 追踪 + 后台委派（`mcode acp`） + 桌面交接 + 终端续聊（`mcode`） | 桌面端与 `mcode` 共用会话库；只装桌面端时可纯追踪 |
| **千问办公（QwenWork）** | 2.x `~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`；旧版 JSONL | 桌面会话追踪 | 仅追踪、不支持委派；2.x 带逐轮 token 与模型名，旧日志无 token 显示 0 |
| **Qoder** | `~/.qoder/projects` / 桌面 `main.sqlite` | 追踪 + 后台委派（`qodercli`） + 桌面复制交接 + 终端 | CLI 与桌面库不互通；桌面未提供 token 时显示「未提供」 |
| **WorkBuddy（中国版）** | `~/.workbuddy/projects` / `workbuddy.db` | 追踪 + 桌面复制交接 + 终端（`codebuddy`） | 仅支持中国版；独立 `codebuddy` 与桌面不互通；无后台执行 |
| **Kimi Code** | `~/.kimi-code/sessions`（`wire.jsonl` + `session-meta/state.json`）及 `~/.kimi/sessions` | 追踪 + 唤起桌面端 | 仅追踪；支持 v1.5 `wire.jsonl` 逐轮对话、工具调用与精确 token 用量统计 |
| **豆包工作（Doubao Work）** | `~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb` | 桌面会话列表元数据追踪 + 唤起桌面端 | 仅追踪标题与活跃时间；完整正文存在本地加密库 `sdk_storage`，插件保持只读不解密，token 显示「用量未提供」 |

> 更多中文 Agent 客户端正在持续规划与接入中，欢迎通过 [新 Agent 适配模板](https://github.com/MatsuriMW/obsidian-agent-deck/issues/new?template=agent_support.yml) 反馈你使用的客户端。

## 三、全部 17 家内置 Agent + 自定义 ACP 能力矩阵

| Agent | 会话追踪 | 后台委派 | 桌面端交接 | 终端交互 |
| --- | --- | --- | --- | --- |
| **Claude Code** | 支持 | 支持 | 支持（首轮后自动打开） | 支持 |
| **Codex** | 支持 | 支持 | 支持（首轮后自动打开） | 支持 |
| **DeepSeek Harness** | 支持 | 支持 | 仅唤起客户端 | — |
| **Antigravity** | 支持 | 支持 | 不支持 | — |
| **OpenCode** | 支持 | 支持 | 首轮后自动打开 | 支持 |
| **Qoder** | 支持 | 支持 | 仅复制任务并唤起 | 支持 |
| **Hermes Agent** | 支持 | 支持 | 不支持（无桌面界面） | 支持 |
| **MiniMax Code** | 支持 | 支持（`mcode acp`） | 首轮后自动打开 | 支持（`mcode`） |
| **千问办公（QwenWork）** | 支持 | 不支持 | 不支持（仅追踪） | — |
| **WorkBuddy** | 支持 | 不支持 | 仅复制任务并唤起 | 支持 |
| **Cursor** | 支持（需开启 Hooks） | 不支持 | 不支持（仅追踪） | — |
| **Grok Bot** | 支持（按 Bot 多选） | 不支持 | 不支持（仅追踪） | — |
| **T3 Code** | 支持 | 支持（`t3 thread`） | 仅唤起客户端 | — |
| **Muse** | 支持（按对话流多选） | 不支持 | 不支持（仅追踪） | — |
| **Kimi Code** | 支持 | 不支持 | 仅唤起客户端（仅追踪） | — |
| **豆包工作** | 支持（会话列表元数据） | 不支持 | 仅唤起客户端（仅追踪） | — |
| **Gemini CLI** | 支持 | 不支持 | 不支持（无桌面界面） | 支持（`gemini --resume`） |
| **自定义 ACP Agent** | 委派会话追踪 | 支持（任意 ACP CLI） | — | — |

## 四、需要准备什么（按需依赖）

只用面板追踪、任务绑定和 Dashboard 时**不需要任何额外依赖**，插件只读本机已有的会话记录，也不联网。要用委派、自动记日记或 Dreaming 时，再准备你实际要用的客户端：

| 你要用的功能 | 需要先装好 |
| --- | --- |
| **Claude Code** | Claude Code 命令行或桌面端，并登录 |
| **Codex** | Codex 命令行与桌面端，并登录 |
| **DeepSeek Harness** | DeepSeek Harness 客户端，并配置好模型与账号 |
| **Antigravity** | 独立的 Antigravity 命令行（只装 IDE 不够） |
| **OpenCode** | OpenCode 桌面端或命令行 |
| **Qoder** | Qoder 命令行；只用桌面交接则装 Qoder 桌面端 |
| **Hermes Agent** | Hermes 命令行；不用委派时无需额外安装 |
| **MiniMax Code** | MiniMax Code 桌面端；后台委派或终端续聊另需 `mcode` 命令行 |
| **千问办公（QwenWork）** | 千问办公桌面端（仅追踪） |
| **WorkBuddy** | 中国版 WorkBuddy 桌面端；终端交互另需 `codebuddy` |
| **Cursor** | Cursor 桌面端 3.30.14+，并在设置里开启 Cursor Hooks |
| **Grok Bot** | Grok Bot 桌面端，并在设置里勾选要追踪的 Bot |
| **T3 Code** | T3 Code 桌面端；后台委派另需 `t3` 命令行 |
| **Muse** | Muse 桌面端（仅追踪） |
| **Kimi Code** | Kimi Code 桌面端或 `kimi` CLI（仅追踪） |
| **豆包工作** | 豆包工作桌面端（仅追踪会话列表元数据） |
| **Gemini CLI** | `@google/gemini-cli`（`gemini` 命令行，仅追踪与终端续聊） |
| **自定义 ACP Agent** | 任一兼容 ACP 协议的本地 CLI，在「设置 → 委派 → 自定义 ACP Agent」中填写命令与参数 |
| **自动记日记 / 总结 / Dreaming** | 任一已登录的本地 CLI，或一个 OpenAI 兼容 API（支持 DeepSeek、OpenAI、OpenRouter、百炼 Qwen、本地 Ollama 等） |
| **macOS 菜单栏助手** | Xcode Command Line Tools（未装时运行 `xcode-select --install`） |

> 从 macOS 图形界面启动 Obsidian 时可能找不到命令行工具，在插件设置里填写完整路径即可；设置页的「检查」只验证路径和版本，登录状态请在客户端确认。

## 五、当前受限与各客户端边界

1. **仅桌面端 & Windows 适配现状**：不支持 Obsidian 移动端。日常以 macOS 实测为主；Windows 已适配基础追踪（Cursor 追踪另需本机安装 `sqlite3`）、Dashboard、日记/记忆/看板以及后台 CLI/ACP 委派，但尚未经过 Windows 真机 Obsidian 全流程验证，且**暂不支持**在终端里打开/续聊会话、桌面端窗口唤起、Claude Desktop 桌面端会话追踪以及菜单栏助手（这些功能在 Windows 上会安全降级不报错）。欢迎 Windows 用户在 Issues 或用户群反馈实机问题。
2. **委派依赖本机客户端**：自动委派要本机 CLI 或桌面应用来执行，暂不支持用远程 API 直接跑任务，插件也不会替你安装或登录客户端。
3. **对话窗口只读**：Obsidian 内的对话查看用于看正文、停止当前轮和保存归档，不设自由输入框；支持的会话可从任务菜单轻量追问或「回答并继续」，其余需回客户端继续。
4. **各客户端的边界**：
   - **Cursor**：只追踪装了 Hooks 的新会话，不支持委派与终端交互。
   - **WorkBuddy**：仅中国版，独立 CodeBuddy 命令行与桌面端不互通。
   - **Qoder**：命令行与桌面端不互通，桌面端没给 token 时显示「未提供」。
   - **Antigravity**：命令行与 IDE 会话不互通；导出正文不含工具结果与内部推理。
   - **DeepSeek Harness**：客户端仍在迭代，委派会话在客户端里可能落到「未分组」，通常需刷新客户端才出现。
   - **OpenCode**：后台与桌面共用会话，但打开桌面端后仍需手动选一次。
   - **Hermes Agent**：没有桌面界面，只能在插件里看，或在终端恢复。
   - **MiniMax Code**：桌面端与 `mcode` 命令行共用本地会话库；打开桌面端后仍需手动选一次会话，只装桌面端未装 `mcode` 时仅追踪不委派。
   - **千问办公（QwenWork）**：只追踪、不能委派；新版客户端的对话已能完整读取，旧日志缺 token 时如实显示为 0。
   - **Grok Bot**：只追踪桌面端，云端沙箱不给逐条 token 时显示「用量未提供」，没有归档概念。
   - **Muse**：只追踪桌面端，云端 VM 无本地 token/模型，保留为 0/未提供。
   - **Kimi Code**：仅追踪桌面端与 CLI 会话（`wire.jsonl` v1.5），暂不支持委派。
   - **豆包工作**：只读追踪本地 IndexedDB 中的会话列表元数据（标题与活跃时间），完整正文存于本地加密数据库 `sdk_storage`，插件不解密，token 显示「用量未提供」。
   - **Gemini CLI**：只读追踪 `~/.gemini/tmp/*/chats/session-*.jsonl`（及旧版 `.json`），自动剥离 `<session_context>` / `<hook_context>` 注入块并统计 token；支持终端 `gemini --resume` 续聊。
5. **终端交互的实测范围**：自动开终端跑交互式会话目前仅限 macOS，且只在 **Tern** 和 **Herdr** 上实测通过；macOS 系统终端、iTerm2、Warp 尚未实测，Windows 终端暂未支持。
6. **正在做的方向**：派发前可视化上下文、防引用漂移、Dream 记忆按条共享、Windows 真机实测与终端适配，以及更多 Agent 与终端支持，详见 [Roadmap](https://matsuri.site/portfolio/journal-workflow/#wishlist)。

## 六、如何接入自定义 ACP Agent

如果你使用 **Gemini CLI、Kiro、Mistral Vibe** 或其他支持 ACP（Agent Client Protocol）协议的本地命令行工具：

1. 打开「设置 → 委派 → 自定义 ACP Agent」。
2. 填写名称、可执行文件完整路径与启动参数。
3. 如需传递 API Key 或敏感环境变量，使用 `env:VAR_NAME` 或 `secret:KEY_NAME` 语法，避免明文密钥写入笔记库。
4. 保存后即可像内置 Agent 一样在任务行 `@` 呼出并后台委派。
