# 关键技术坑与约束

- **EditorSuggest 抢占顺序**：Obsidian 按注册顺序命中即返回，加载时需将窄范围 `@` 补全重排到内部 `suggests` 列表前列，卸载时按对象移除（升级 Obsidian 需复测未公开 `suggests` 数组）。
- **第三方让渡看实际渲染**：螺旋日程开启开关不等于成功显示当前条目；必须以 `lineStatus` 实际返回同一会话且含 token 为准，否则不得让出，且不活跃会话需从备用元数据合成输入+输出 token。
- **锁外等待模型 + 局部扫描**：LLM 调用在按文件写入锁外执行，返回后校验笔记变更并避开 IME 组字；长日志同步缓存块尾偏移、隐藏编号保护仅查受影响行，避免 O(N²) 全篇重扫。
- **控制消息与缓存同步**：Codex `send_user_message_question_reply` 与 DSH 系统注入走用户消息通道，统一由 `src/prompt-text.js` 提取可读确认或剥离注入，修改解析规则后**必须递增 `USAGE_CACHE_VERSION`**。
- **子进程输出与 ACP 权限**：Claude `stdout` 流式排水等 `close`、Qoder `exit` 不丢缓冲且不 trim 首尾空白、Codex 同轮多段回复按消息 ID 去重；ACP 权限 `optionId` 读服务端返回值，进程未返结果即退出（含 code 0）按失败处理，`finished` 阶段不阻断取消与清理。
- **会话隔离边界**：CodeBuddy CLI（`~/.codebuddy/projects`）与国内版 WorkBuddy 桌面（`~/.workbuddy`）、`qodercli`（`~/.qoder/projects`）与 Qoder 桌面 SQLite 均不互通，不可跨端续聊。
- **总结与标题保护**：普通会话不能截取回复开头代替总结或生成后硬截断；后台回答不再生成总结，按 500 字分流到完整原文或干净问答文件，不能把扫描器的截短预览当原文；保留用户改过的 AI 标题时必须跳过空格压缩与时间前缀剥离，并防止历史标记触发重排。
- **同名项目聚合与子代理等待降噪**：项目分组不能直接用末级目录名当键，必须以规范化根路径隔离并在同名碰撞时附加父目录区分；子代理 `turn/end` / `task_complete` 应标为 `done`（`aborted` 标 `cancelled`）并通过 `parentSid` / `parentCwd` 继承母会话项目，避免落入「独立会话」或污染「等你」列表。
- **macOS GUI 进程不继承终端代理**：Obsidian 桌面进程 `process.env` 不含 shell 的 `HTTPS_PROXY` / `ALL_PROXY`，导致 ACP CLI 连网静默超时；`cleanEnv()` 在未显式配置代理变量时必须通过 `/usr/sbin/scutil --proxy`（60s 缓存）读取系统 HTTP/HTTPS/SOCKS 代理并补全 `127.0.0.1,localhost,::1` 至 `NO_PROXY`。
- **Claude Code 子文件共 `sid` 与 Cursor 早退丢父子**：Claude Code `<parent>/subagents/agent-*.jsonl` 共享母会话 `fc.sid` 且带 `fc.sub`，绝不能扫 `files` 凭 `fc.sub` 判子代理或把子文件 `parentSid`/`isSubagent` 写回母会话；Cursor `ingestCursorEvent` 必须在 `sessionStart` 及带 token 的 `afterAgentResponse`/`stop` 提前 `return` 之前绑定父子关系。
- **动态 ACP 模型必须统一汇入 `allModels()`**：不得在 `allModels()` 硬编码部分 Agent 白名单，必须统一遍历 `settings.delegate` 收集 `availableModels`，否则 `refreshAcpModels` 拉回模型后设置页下拉框与 `modelsFor()` 仍看不到新模型。
- **Windows `.cmd` 拉起、TDZ 与跨插件粗体 `key` 匹配**：`checkBinary()` 必须使用 `spawnCli` / `killChildProcess`（避免 Windows `.cmd` 报 `EINVAL`），且 `timer` 必须在 `done()` 回调前声明以避开 TDZ `ReferenceError`；`autoLogState` 里的 `key` 带 `**...**`，与螺旋日程等配套插件对齐去重时必须同步剥粗规范化。
