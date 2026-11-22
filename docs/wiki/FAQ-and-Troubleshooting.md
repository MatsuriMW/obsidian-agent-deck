# 常见问题与排错（FAQ & Troubleshooting）

## 1. macOS 上提示找不到 CLI（如 `claude`、`codex`、`mcode`、`t3`）

从 macOS 图形界面（Dock / Spotlight）启动 Obsidian 时，往往不会继承你在 `.zshrc` 里配置的 `PATH`。

- **解决方法**：在终端运行 `which <命令名>` 获取完整路径（例如 `/opt/homebrew/bin/claude`），填入「设置 → Agent」对应的二进制路径框中，再点「检查」。
- 注意：「检查」按钮只验证路径与版本，登录状态请在对应客户端或终端里确认。

## 2. Cursor 会话没有出现在面板里

- 需要 **Cursor 3.30.14+**。
- 请在插件设置中显式开启并安装 **Cursor Hooks**（会写入 `~/.cursor/hooks.json`）。
- 仅追踪开启 Hooks 之后的新会话，不做旧版历史回填；Cursor 目前仅支持追踪，不支持委派。

## 3. Windows 平台支持情况如何？

当前日常验证以 macOS 为主。Windows 上已适配：
- 基础会话追踪（追踪 Cursor 时需本机已安装 `sqlite3` 并在 `PATH` 中）
- Dashboard、自动记日记、记忆库、分形看板
- 后台 CLI / ACP 委派

Windows 上**暂不支持**（会安全降级、不报错）：
- 自动打开终端交互/续聊
- 唤起桌面端窗口
- Claude Desktop 桌面端会话追踪
- 菜单栏助手（macOS 专属）

欢迎 Windows 用户在 [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) 反馈真机使用情况。

## 4. 如何安全配置 API Key 与自定义 ACP 环境变量？

切勿把明文 API Key 直接存进可能同步到 Git / 云盘的 Vault 里。Agent Deck 支持两种安全引用语法：

- `env:OPENAI_API_KEY`：从系统环境变量读取
- `secret:my_key_name`：从本机安全凭据存储读取

## 5. 为什么某些会话的 Token 显示为 0 或「未提供」？

Agent Deck 坚持 **口径诚实原则**：如果某个客户端的本地日志或云端沙箱没有提供逐条 Token（例如 Grok Bot、Muse、Qoder 桌面端部分记录、旧版千问办公 JSONL），插件会如实显示 0 或「未提供」，绝不通过字数估算伪造数据。

## 6. 遇到 Bug 如何提交有效反馈？

1. 在 Obsidian 命令面板运行 **「导出脱敏诊断报告」**（会自动对路径、密钥与敏感信息脱敏）。
2. 前往 [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) 提交问题，附上你的操作系统、Obsidian 版本、涉及的客户端名称及诊断摘要。
