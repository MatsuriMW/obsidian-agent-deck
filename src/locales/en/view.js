// Agent Deck — English UI strings (view).
// Keys are the Chinese source strings; placeholders use {name}.
// Strings the inline editor also shows (会话 / 等你 / 等你允许 / 出错) are defined
// once in en/editor.js, so the merged table has no duplicate keys.

export default {
  // Dashboard header + search
  "搜会话：标题、项目、第一步…": "Search sessions: title, project, first message…",
  "重新扫描本机会话": "Rescan local sessions",
  "设置": "Settings",
  "搜索结果": "Search results",
  "{n} 个 · 显示最近 100 个": "{n} sessions · showing the latest 100",
  "{n} 个": "{n} sessions",
  "没有找到会话": "No sessions found",

  // Journal actions
  "跳到正在做": "Jump to what's running",

  // Hero numbers
  "协作时长": "Collaboration time",
  "产出 token": "Output tokens",
  "{n} 次调用": "{n} calls",
  "{n} 次提问": "{n} prompts",
  "今天还没有会话": "No sessions today yet",
  "较 7 日均 {pct}": "vs 7-day average {pct}",

  // Now
  "现在": "Now",
  "{run} 个在跑 · {wait} 个等你": "{run} running · {wait} waiting",
  "现在没有在跑的会话": "Nothing running right now",
  "从「现在」移除": "Remove from Now",

  // Usage + recent sessions
  "最近 14 天": "Last 14 days",
  "最近的会话": "Recent sessions",
  "{n} 个 · 最近 7 天": "{n} · last 7 days",
  "全部": "All",
  "在跑": "Running",
  "没有符合条件的会话": "No sessions match this filter",
  "管理": "Manage",

  // Agent cards
  "交给 {name}": "Hand to {name}",
  "委派给 {name}": "Delegate to {name}",
  "在终端里开 {name}": "Open {name} in the terminal",
  "打开 {name}": "Open {name}",
  "{n} 个在跑": "{n} running",
  "{n} 个会话": "{n} sessions",
  "今天还没动": "Not active today",
  "取消主力": "Remove primary",
  "设为主力（最多两个）": "Set as primary (up to two)",
  "等终端里的会话：{name}": "Waiting for the terminal session: {name}",
  "等你在 {agent} 里发出：{name}": "Waiting for you to send it in {agent}: {name}",
  "不等了": "Stop waiting",
  "追踪中": "Tracking",
  "已关闭": "Off",
  "扫描": "Scan",

  // Session cards
  "子代理 ×{n}": "Subagents ×{n}",
  "子代理": "Subagent",
  "{ago}开的": "started {ago}",
  "从「{title}」开出": "Opened from “{title}”",
  "母会话": "Parent session",
  "桌面版里的标题：{title}": "Title in the desktop app: {title}",
  "查看对话、续聊与归档": "View chat, continue or archive",
  "打开会话": "Open session",

  // State pills
  "安静": "Quiet",
  "限额": "Limit reached",
  "完成": "Done",
  "已取消": "Cancelled",

  // AI record folding (record-display.js)
  "收起": "Collapse",
  "更多": "More",
  "记录": "Records",
  "折叠 {n} 条 AI 记录": "Collapse {n} AI records",
  "展开 {n} 条 AI 记录": "Expand {n} AI records",

  // journal-archive.js — archiving finished tasks into their own note
  "归档位置必须是库内的 .md 文件路径": "The archive location must be a .md path inside the vault",
  "归档中已有同编号但内容不同的任务，已保留原日记，请先核对":
    "The archive already holds a task with the same number but different content. The journal was left untouched; check it first.",
  "归档文件不能与当前日记相同": "The archive file cannot be the current journal",
  "归档文件刚有变化，请重试；原日记保留":
    "The archive file just changed. Try again; the journal was left untouched.",
  "日记刚有变化，归档副本已保存，原日记保留；重试不会重复归档":
    "The journal just changed. The archive copy was saved and the journal left untouched; retrying will not duplicate it.",

  // Journal layout buttons
  "整理日志": "Tidy log",
  "已完成的任务放到最上面，一条分割线，再下面是未完成的 AI 日志，最后是你自己写的内容":
    "Finished tasks go on top, then a rule, then the unfinished AI log, then your own notes",
  "归档已完成的日志到…": "Archive finished logs to…",
  "把已完成的 AI 日志移出这篇日记，写进你选的归档文件":
    "Move the finished AI log out of this journal into an archive file you pick",

  // Project rows under the day timeline
  "{project} · 今天 {time}": "{project} · {time} today",
};
