// Agent Deck — English UI strings (runtime).
// Keys are the Chinese source strings; placeholders use {name}.

export default {
  // constants.js — agent descriptions shown in Settings
  "Claude Code 和 Claude 桌面版里的 Code 会话": "Code sessions in Claude Code and the Claude desktop app",
  "Codex 桌面版和 codex 命令行": "The Codex desktop app and the codex CLI",
  "WorkBuddy 桌面版": "The WorkBuddy desktop app",
  "DeepSeek Harness 桌面版、CLI 和通过 ACP 委派的任务": "The DeepSeek Harness desktop app, the CLI, and tasks delegated over ACP",
  "Antigravity 桌面版与会话日志": "The Antigravity desktop app and its session logs",

  // constants.js — model picker names, notes and effort hints
  "CLI 当前默认模型": "CLI current default model",
  "使用服务端的默认模型；读取可用模型后可指定模型。": "Uses the server's default model; pick a model once the available models are read.",
  "可用性由当前 Codex 登录账号决定。": "Availability depends on the signed-in Codex account.",
  "实际可用强度由 ACP 服务端校验": "The ACP server validates which effort levels actually work",
  "由所选 Codex 模型支持的强度决定": "Depends on the effort levels the selected Codex model supports",

  // constants.js — journal folder/format detection sources
  "Obsidian「日记」核心插件": "Obsidian's core Daily notes plugin",
  "手动设置": "Set manually",
  "默认": "Default",
  "「{folder}」里已有的 {n} 篇日记": "{n} daily notes already in \"{folder}\"",
  "库根目录里已有的 {n} 篇日记": "{n} daily notes already in the vault root",

  // llm.js — headless model call failures
  "启动 claude 失败：{msg}": "Failed to start claude: {msg}",
  "启动 codex 失败：{msg}": "Failed to start codex: {msg}",
  "claude 退出码 {code}": "claude exited with code {code}",
  "claude 返回错误": "claude returned an error",
  "codex 退出码 {code}": "codex exited with code {code}",
  "codex 没有返回文字": "codex returned no text",

  // codex-desktop.js — handoff to the Codex desktop app
  "Codex 连接已关闭": "Codex connection is closed",
  "Codex {method} 连接超时": "Codex {method} timed out",
  "Codex App Server 已退出（{code}）": "Codex App Server exited ({code})",
  "Codex 协议响应无效：{msg}": "Invalid Codex protocol response: {msg}",
  "Codex 未确认指定模型，任务未发送": "Codex did not confirm the requested model; the task was not sent",
  "Codex 请求失败": "Codex request failed",
  "Codex 首轮{status}": "Codex first turn {status}",
  "未完成": "did not complete",
  "Codex 连接已结束": "Codex connection ended",

  // conversation.js — archiving the conversation body
  "请等当前这一轮结束后再归档": "Wait for the current turn to finish before archiving",
  "暂未读取到对话正文，请扫描会话后重试": "No conversation text read yet; scan sessions and try again",

  // readers.js — what the agent is doing right now, on the card and in the menu bar
  "跑命令": "Running a command",
  "改 {file}": "Editing {file}",
  "文件": "file",
  "写 {file}": "Writing {file}",
  "读 {file}": "Reading {file}",
  "找 {pattern}": "Searching {pattern}",
  "派出去：{what}": "Delegated: {what}",
  "搜 {query}": "Searching {query}",
  "读网页": "Reading a web page",
  "用技能 {skill}": "Skill: {skill}",
  "建待办：{subject}": "New todo: {subject}",
  "完成待办 #{id}": "Todo #{id} done",
  "进行待办 #{id}": "Todo #{id} in progress",
  "更新待办 #{id}": "Todo #{id} updated",
  "整理待办": "Updating todos",
  "思考中…": "Thinking…",
};
