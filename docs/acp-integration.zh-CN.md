# 运行依赖与协议接入记录



Agent Deck 当前通过本机程序完成 Claude、Codex 和 DSH 的自动委派。对应程序缺失或不能运行时，这条自动委派路径不可用。程序可以由桌面应用自带，不要求所有用户都额外安装一份全局 CLI。通过远程 API 或 SDK 委派也可以不依赖本机 CLI，但本版本没有提供通用远程委派后端。

只读取已有会话日志、绑定任务、查看正文和归档正文，不需要启动 Agent CLI。AI 起名、总结、润色和 Dreaming 另需一个可用且已登录的 Claude 或 Codex CLI。

| 功能 / Agent | 当前实现 | 用户需要准备什么 |
|---|---|---|
| Claude Code 自动委派 | 启动 `claude` 无头进程或终端会话 | 安装并登录 Claude Code；需要桌面续聊时另装 Claude 桌面应用 |
| Codex 桌面模式 | 启动 `codex app-server` | 可用的 Codex 程序、登录及 Codex 桌面应用；插件优先寻找桌面应用附带的程序 |
| Codex 终端模式 | 启动 `codex` 交互会话 | 终端可执行的 Codex CLI，以及该程序使用的登录 |
| DeepSeek Harness 自动委派与插件内续聊 | 启动 `dsh acp` | 支持 ACP 的 Harness 安装，以及有效的模型 / 提供商配置和登录 |
| WorkBuddy 交接 | 复制文字并打开客户端，由用户发送 | 国内版 WorkBuddy 桌面应用；本路径不调用独立 CodeBuddy CLI |
| Antigravity 自动委派与插件内续聊 | 启动 `agy acp` | 独立 Antigravity CLI（agy）及其登录；只安装 IDE 不够 |
| 自动日记、AI 润色、Dreaming | 调用所选 `claude` 或 `codex` CLI | 单独确认整理设置中的程序路径、登录和模型可用性 |
| macOS 菜单栏助手 | 首次在本机编译 SwiftUI 程序 | Xcode Command Line Tools 中的 `swiftc`；不使用菜单栏时可关闭该功能 |

### 安装与首次检查

只准备你要使用的 Agent，不需要把表里的程序全部安装。

1. 从官方渠道安装：[Claude Code](https://code.claude.com/docs/en/setup)、[Codex](https://developers.openai.com/codex/cli/)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[Antigravity CLI](https://antigravity.google/docs/cli/acp)。使用已发布的插件文件不需要运行 `npm install`；Node.js / npm 是从本仓库源码构建时的工具。Agent 自己的安装器若另有运行依赖，以其官方说明为准。
2. 在终端确认所选程序能运行，例如 `claude --version`、`codex --version`、`dsh --help`。DSH 还应支持 `dsh acp --help`；Antigravity 应能运行 `agy --version` 和 `agy acp --help`，并通过 `agy acp --login` 登录。程序不在 PATH 时，使用它的完整路径。Codex 桌面模式和 Harness 可以使用应用附带的程序。
3. 按所选 Agent 的官方流程完成登录或配置提供商。版本号检查不证明账号已登录、额度充足或模型可用。不要用一个客户端的登录成功推断另一个程序也已登录。
4. 在“设置 → Agent Deck → 委派”填写需要覆盖的程序路径。macOS 从图形界面启动 Obsidian 时，PATH 可能与终端不同；路径问题优先填写完整路径。整理和 Dreaming 使用“追踪”中的整理 CLI 配置，也要单独核对。
5. 先委派一个“只回复测试口令，不调用工具”的任务。收到回复后再测试第二轮、正文归档，以及需要时的桌面续聊。任务测试会调用模型服务；只有完整流程通过，才能确认该路径可用。

本版本设置中的“检查”按钮只验证程序和版本，不完成安装或登录。插件不会自动安装 Agent、修改 shell 配置、复制账号凭证或替用户登录。菜单栏缺少编译器时，可按系统提示运行 `xcode-select --install`。

### Antigravity 在插件内委派与续聊

1. 安装官方独立 CLI 并执行 `agy acp --login`。在“委派 → Antigravity ACP”检查程序，必要时填完整路径（例如 `~/.local/bin/agy`）。
2. 点击“读取 Antigravity 可用模型”，按账号实际返回的模型选择。也可以使用“CLI 当前默认模型”；强度是否可用由服务端校验，不支持时会明确报错。
3. 从任务的 `@antigravity` 菜单、纸飞机目标或 Agent 卡片委派。任务和子块直接发送，回复写回任务，并保存在插件委派记录中。
4. 点击该任务的会话按钮或对话入口，在 Obsidian 内查看正文、继续追问、停止当前一轮或归档。恢复使用原会话号；插件重载后仍可续聊。
5. 工具需要权限时会弹出工具详情和服务端选项。关闭弹窗视为取消本次请求。插件不会默认自动批准 Antigravity 工具。

原 IDE 会话继续使用原日志入口，不与 CLI 会话混用。ACP 问答随插件委派记录保存在 `data.json`；需要长期保存时请“归档到笔记”，再使用“清理已结束的委派记录”。正文归档不含工具结果、内部推理或附件。

### ACP 支持与插件接入范围

ACP（Agent Client Protocol）规定客户端与 Agent 如何交换会话和任务消息。支持 ACP 不表示桌面应用会自动显示 ACP 或独立 CLI 创建的同一个会话。下表核对于 2026-11-13。

| Agent | 程序 / 生态的 ACP 能力 | Agent Deck 当前接法 |
|---|---|---|
| DeepSeek Harness | 官方 `dsh acp`，支持创建、恢复会话及提交任务。[协议说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md) | 已使用 ACP；支持插件内续聊 |
| Claude / Claude Code | 可通过 `claude-agent-acp` 将 Claude Agent SDK 暴露给 ACP 客户端。[适配器](https://github.com/agentclientprotocol/claude-agent-acp) | 使用 `claude` CLI，未使用 ACP 适配器 |
| Codex | `codex-acp` 适配器启动 Codex App Server，并转换 ACP 请求。[适配器](https://github.com/agentclientprotocol/codex-acp) | 直接使用 [App Server](https://developers.openai.com/codex/app-server/) 或终端，不需要安装 ACP 适配器 |
| CodeBuddy / WorkBuddy | CodeBuddy CLI 官方提供 `codebuddy --acp`。[协议说明](https://www.codebuddy.ai/docs/cli/acp)；不能据此认定两版 WorkBuddy 桌面应用都能作为独立 ACP 程序使用 | WorkBuddy 仍为客户端交接；独立 CodeBuddy CLI 的会话不是 WorkBuddy 桌面会话 |
| Antigravity | 官方 CLI 提供 `agy acp`。[官方说明](https://antigravity.google/docs/cli/acp)；需安装支持此命令的版本并登录 | 已接入原生 ACP 自动委派、模型发现、权限确认、同会话插件内续聊和正文归档 |

本机 `agy 1.5.6` 已通过真实两轮任务：首轮计算返回 `AGY_391`，第二轮恢复同一个会话并正确回忆首轮口令。未验证 Antigravity IDE 能显示此 CLI 会话，不承诺桌面同会话续聊。

### WorkBuddy 的两个版本

国内版 WorkBuddy 使用 `~/.workbuddy` 和 `workbuddy://`；国际版 WorkBuddy AI 使用 `~/.workbuddy-ai` 和 `workbuddy-ai://`。当前插件的 WorkBuddy 读取器和打开入口按国内版配置，尚未提供国际版的独立入口。

2026-11-13 实测，独立 CodeBuddy CLI 登录后可以完成任务，但用该 CLI 的会话 ID 打开国内版 WorkBuddy，桌面日志返回 `conversation not found`。因此安装 CodeBuddy CLI 不能让当前 WorkBuddy 交接自动变为后台委派。国际版的同会话导入和续聊尚未验证成功，不能承诺可用。
