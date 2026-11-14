// Agent Deck — English UI strings (dialogs).
// Keys are the Chinese source strings; placeholders use {name}.

export default {
  // ----- delegation options / confirm dialog -----
  "光标要放在一个列表项里": "Put the cursor inside a list item",
  "CLI / 终端": "CLI / Terminal",
  "首轮后打开桌面版": "Desktop app after the first turn",
  "读取 {agent} 可用模型": "Load the models available to {agent}",
  "ACP 模式没有 plan/auto 这个切换；关掉自动允许时，Harness 的权限请求会在 Obsidian 中逐次确认。":
    "ACP mode has no plan/auto switch. With auto-allow off, Harness asks you to confirm each permission request inside Obsidian.",
  "ACP 模式没有 plan/auto 这个切换；关掉自动允许时，权限请求会在 Obsidian 中逐次确认。":
    "ACP mode has no plan/auto switch. With auto-allow off, each permission request is confirmed in Obsidian.",
  "qoder 退出码 {code}": "qoder exited with code {code}",
  "📋 Qoder CLI 尚未登录，已复制任务并打开 Qoder 桌面版（也可在设置里登录 CLI）":
    "📋 Qoder CLI is not signed in; copied the task and opened Qoder Desktop (or sign in to the CLI in Settings)",
  "通过 agy acp 委派，工具请求会在 Obsidian 中逐次确认；完成后可打开会话正文继续追问。推理强度以当前模型支持的值为准。":
    "Delegated through agy acp, so tool requests are confirmed one by one in Obsidian. When it finishes, open the transcript to keep asking. Reasoning effort follows what the current model supports.",
  "留空 = 插件设置里的目录（默认是库根目录）。":
    "Leave empty to use the folder from plugin settings (the vault root by default).",
  "加在这次委派最后的话": "Text to add at the end of this delegation",
  "重新委派给 {agent}": "Delegate again to {agent}",
  "发给 {agent}": "Send to {agent}",
  "这次将新建会话，原会话及记录保留。":
    "This starts a new session; the original session and its log are kept.",
  "连同 {n} 行子块，作为一条消息": "Sent as one message with {n} child lines",
  "作为一条消息": "Sent as one message",
  "带上 {n} 层母项作为上下文": "Parent lines included as context ({n})",
  "这条任务在笔记里挂的位置，只做最里面这一项：":
    "Where this task sits in the note. Only do the innermost item:",
  "发送": "Send",
  "接下来在哪里工作": "Where to work next",

  // ----- conversation / ACP permission dialogs -----
  "会话正文": "Session transcript",
  "刷新正文": "Refresh transcript",
  "在客户端打开": "Open in client",
  "保存对话到笔记": "Save conversation to note",
  "已归档：{path}": "Archived: {path}",
  "保存对话（⌘S / Ctrl+S）": "Save conversation (⌘S / Ctrl+S)",
  "保存用户消息与回复正文；会话可继续，任务状态不受影响。工具结果、内部推理和附件不包含在内。":
    "Saves your messages and the replies. The session can continue and the task state is untouched. Tool results, internal reasoning and attachments are not included.",
  "在原会话中继续追问…": "Ask a follow-up in the same session…",
  "发送到原会话": "Send to the original session",
  "发送（⌘Enter / Ctrl+Enter）": "Send (⌘Enter / Ctrl+Enter)",
  "停止当前一轮": "Stop the current turn",
  "此 Agent 的续聊请在原客户端完成。": "Continue this agent's conversation in its own client.",
  "暂未读到正文。可先扫描本机会话，再刷新。":
    "No transcript yet. Scan local sessions first, then refresh.",
  "用户": "User",
  "本轮失败：{error}": "This turn failed: {error}",
  "等待工具权限确认…": "Waiting for tool permission…",
  "正在回复…": "Replying…",
  "读取失败：{error}": "Could not read: {error}",
  "{agent} 请求工具权限": "{agent} requests tool permission",
  "Agent 请求执行工具操作，请选择是否允许。":
    "The agent wants to run a tool call. Choose whether to allow it.",
  "查看操作详情": "Show operation details",

  // ----- destinations -----
  "在 Obsidian 中聊": "Chat in Obsidian",
  "发送后打开对话，在原会话中继续追问。":
    "Opens the conversation after sending; keep asking in the same session.",
  "在桌面客户端中聊": "Chat in the desktop app",
  "复制任务并打开客户端，等待你粘贴发送。":
    "Copies the task and opens the client; paste it and send from there.",
  "建立会话后打开 Harness；当前轮结束后在侧栏选择同一会话继续。":
    "Starts the session, then opens Harness; when this turn ends, pick the same session in the sidebar to continue.",
  "先执行首轮，结束后打开桌面中的同一会话；首轮期间避免两边同时发送。":
    "Runs the first turn, then opens the same session on the desktop; avoid sending from both sides during that turn.",
  "后台执行": "Run in background",
  "留在当前笔记，完成或需要处理时提醒。":
    "Stays in this note and notifies you when it finishes or needs you.",
  "在终端中聊": "Chat in the terminal",
  "打开交互终端，后续在终端继续。": "Opens an interactive terminal; continue there.",

  // ----- @ mentions -----
  "使用 {trigger}agent/model/effort 指定委派": "Use {trigger}agent/model/effort to route the task",
  "{agent} 已关闭，请先在设置中启用": "{agent} is disabled. Enable it in settings first.",
  "{trigger}{agent} 的模型不存在，请从 Agent 菜单选择或先添加自定义模型":
    "No such model for {trigger}{agent}. Pick one from the Agent menu or add a custom model first.",
  "{trigger}{agent} 不支持强度 {effort}": "{trigger}{agent} does not support effort {effort}",
  "选择后继续选择具体模型": "Pick this agent, then choose a model",
  "客户端交接；模型与强度在客户端设置": "Handed off to its client; set model and effort there",
  "选定模型；可继续输入 / 选择强度": "Model selected; type / to choose effort",

  // ----- delegation runtime notices and errors -----
  "已切到 Warp": "Switched to Warp",
  "这个会话还没有会话号，稍等一秒再点": "This session has no session ID yet; try again in a second",
  "已打开 DeepSeek Harness；会话号已复制": "Opened DeepSeek Harness; session ID copied",
  "已打开 Antigravity；会话号已复制": "Opened Antigravity; session ID copied",
  "Claude Code 没有信任库目录，改在 {cwd} 里跑；库已经用 --add-dir 加进去了。":
    "Claude Code does not trust the vault folder, so it runs in {cwd}; the vault was added with --add-dir.",
  "Claude 后台服务没起来，已改用无头会话（答完可以点任务行打开）":
    "Claude's background service did not start; using a headless session instead (click the task line when it is done).",
  "{agent} ACP 提前退出（{code}）": "{agent} ACP exited early ({code})",
  "{agent} 未声明会话恢复能力，请升级后再续聊":
    "{agent} does not advertise session resume; upgrade before continuing.",
  "{agent} 没有返回会话号": "{agent} returned no session ID",
  "无法识别 {agent} 模型：{model}": "Unrecognized {agent} model: {model}",
  "{agent} 未提供推理强度选择": "{agent} offers no reasoning-effort choice",
  "委派超过 30 分钟没有结束": "The delegation ran for more than 30 minutes without finishing",
  "{agent} 需要你允许": "{agent} needs your approval",
  "「{name}」的工具调用已拒绝。可在委派设置中调整权限后重试。":
    "The tool call for {name} was rejected. Adjust permissions in the delegation settings and retry.",
  "{agent} 连接已关闭": "{agent} connection is closed",
  "{method} 超时": "{method} timed out",
  "{agent} 连接已结束": "{agent} connection ended",
  "ACP 服务端返回的模型": "Model reported by the ACP server",
  "没有当前笔记": "No active note",
  "🛫 正在委派给 {agent}：{name}": "🛫 Delegating to {agent}: {name}",
  "这个 Agent 不支持在 Obsidian 内续聊": "This agent cannot continue inside Obsidian",
  "请输入追问内容": "Enter a follow-up message",
  "这个会话还没有会话号": "This session has no session ID yet",
  "{agent} 会话": "{agent} conversation",
  "要拖一个列表项": "Drag a list item",
  "📋 任务已复制，粘贴到 {agent} 里发出": "📋 Task copied; paste it into {agent} and send",
  "已在 {terminal} 里开 {agent}": "Opened {agent} in {terminal}",
  "半小时里没在客户端看到这个任务的新会话":
    "No new session for this task appeared in the client within half an hour",
  "✅ {agent} 做完了一轮：{name}": "✅ {agent} finished a turn: {name}",
  "Claude Code 不信任这个工作目录：{cwd} 在终端里 cd 到那儿运行一次 claude，接受信任提示；或者在「委派」设置里把工作目录换成一个已经信任的目录。（这次没有真正跑起来，已经把 🔗 和 DELEGATED 撤回）":
    "Claude Code does not trust this working directory: {cwd}. cd there in a terminal and run claude once to accept the trust prompt, or change the working directory in the Delegation settings to one Claude Code already trusts. (This run never actually started, so 🔗 and DELEGATED were rolled back)",
  "Claude Code 不认识传过去的参数：{error} 把「委派 → 额外参数」清空，或检查 claude --help。":
    "Claude Code did not recognize the arguments it received: {error} Clear Delegation → Extra args, or run claude --help.",
  "⚠️ {agent} 没跑完：{name} {error}": "⚠️ {agent} did not finish: {name} {error}",
  "详情见控制台": "See the console for details",

  // delegation.js — task actions, ACP steps, resume and stop errors
  "{agent} 未提供模型选择": "{agent} did not offer a model picker",
  "当前模型不支持推理强度 {value}": "The current model does not support effort {value}",
  "等待工具授权": "Waiting for tool approval",
  "工具调用已取消": "Tool call cancelled",
  "工具调用已拒绝": "Tool call rejected",
  "此 Agent 不支持所选工作位置": "This agent does not support the chosen working location",
  "这一块下面已经有 🔗 了；要重发先删掉那一行":
    "This block already has a 🔗 below it. Delete that line before sending again.",
  "请等当前这一轮结束后再发送": "Wait for the current turn to finish before sending",
  "这是 Antigravity 桌面会话，请在客户端继续；在插件中新建 ACP 委派后可在 Obsidian 内续聊":
    "This is an Antigravity desktop session, so continue in the client. New ACP delegations can be continued inside Obsidian.",
  "等你在 {agent} 里发出去": "Waiting for you to send it in {agent}",
  "在终端里开 {agent}": "Opening {agent} in the terminal",

  // workflow.js — lifecycle wording shown on the task line
  "等待终端会话建立": "Waiting for the terminal session",
  "等待你在客户端粘贴发送": "Waiting for you to paste and send in the client",
  "首轮执行中，结束后打开桌面": "Running the first turn, then opening the desktop app",
  "已停止": "Stopped",
  "工作区": "Workspace",
  "会话工作区": "Session workspace",

  // task-mentions.js
  "一条任务只能指定一个 Agent 标记": "A task can carry only one agent marker",

  // Archive target sheet
  "归档已完成的日志": "Archive finished logs",
  "{n} 个已完成的 AI 任务将被移出这篇日记": "{n} finished AI tasks will be moved out of this journal",
  "归档到哪个文件": "Archive to which file",
  "插到文件开头": "Top of the file",
  "追加到文件末尾": "End of the file",
  "写入顺序：{order}（在 设置 → 追踪 里改）": "Write order: {order} (change it in Settings → Tracking)",
  "写入顺序：{order}（在 设置 → 记录 里改）": "Write order: {order} (change it in Settings → Recording)",
  "归档": "Archive",
};
