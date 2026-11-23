// Agent Deck — English UI strings (view).
// Keys are the Chinese source strings; placeholders use {name}.
// Strings the inline editor also shows (会话 / 等你 / 等你允许 / 出错) are defined
// once in en/editor.js, so the merged table has no duplicate keys.

export default {
  "设为主力（最多三个）": "Set as primary (up to three)",
  "按正在做、还要做、已完成重排日记里的已有条目": "Rearrange existing journal entries into in-progress, to-do, and completed sections",

  "还没有 Agent 卡片，点「管理」添加。": "No Agent cards yet. Choose Manage to add one.",
  "已置顶": "Pinned",
  "扫描 {name} 最近 7 天的会话": "Scan sessions updated in the last 7 days for {name}",
  "拖动排序；方向键调整位置": "Drag to reorder; use arrow keys to move",
  "管理 {name} 卡片": "Manage {name} card",
  "取消置顶": "Unpin",
  "置顶卡片": "Pin card",
  "从侧边栏移除": "Remove from sidebar",
  "管理 Agent 卡片": "Manage Agent cards",
  "置顶卡片排在前面，同组内可拖动排序。移除只隐藏卡片，不删除会话或关闭追踪。": "Pinned cards appear first. Drag to reorder within each group. Removing a card only hides it; sessions and tracking are kept.",
  "上移": "Move up",
  "下移": "Move down",
  "添加卡片": "Add cards",
  "所有可用的 Agent 都已添加。": "All available Agents have been added.",
  "添加到侧边栏": "Add to sidebar",
  "Agent 设置": "Agent settings",
  // Dashboard header + search
  "搜会话：标题、项目、第一步…": "Search sessions: title, project, first message…",
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
  "{n} 个 · 最近 {days} 天": "{n} · last {days} days",
  "{days} 天": "{days}d",
  "共 {total} 条 {agent} 对话 · 点击展开 +{more}": "{total} {agent} sessions · click to expand +{more}",
  "{agent} · 共 {total} 条对话": "{agent} · {total} sessions",
  "已达单页 {max} 张卡片上限，另有 {n} 条较早会话未显示": "Page cap of {max} cards reached; {n} older sessions hidden",
  "已显示最新 {shown} / 共 {total} 张卡片，更多请用顶部搜索": "Showing latest {shown} of {total} cards; use search above for more",
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
  "整理日志版面": "Tidy journal layout",
  "整理日志": "Tidy log",
  "已完成的任务放到最上面，一条分割线，再下面是未完成的 AI 日志，最后是你自己写的内容":
    "Finished tasks go on top, then a rule, then the unfinished AI log, then your own notes",
  "归档已完成的日志到…": "Archive finished logs to…",
  "把已完成的 AI 日志移出这篇日记，写进你选的归档文件":
    "Move the finished AI log out of this journal into an archive file you pick",

  // Project rows under the day timeline
  "{project} · 今天 {time}": "{project} · {time} today",

  // Project-first process view & Fractal board
  "打开项目工作台（小队编排与拆解派发）": "Open Project Workbench (team setup & task planning)",
  "按项目": "By project",
  "按状态": "By status",
  "列表": "List",
  "⏳ 待认领": "⏳ Unclaimed",
  "异常": "Issues",
  "按 Agent": "By agent",
  "{n} 异常": "{n} issues",
  "在项目工作台编排小队": "Configure team in Project Workbench",
  "停止本项目的活跃任务": "Stop active tasks in this project",
  "{project} · 共 {total} 条对话 · 点击展开 +{more}": "{project} · {total} sessions · click to expand +{more}",
  "{project} · 共 {total} 条对话": "{project} · {total} sessions",
  "切回大纲视图": "Switch back to outline",
  "切换为分形看板（{n} 张子卡）": "Switch to fractal board ({n} cards)",
  "看板 {n}": "Board {n}",
  "分形看板": "Fractal board",
  "小队 / 拆解": "Team / Plan",
  "派发 TODO ({n})": "Dispatch TODO ({n})",
  "切回大纲": "Outline",
  "空": "Empty",
  "点击切回大纲定位编辑": "Click to jump to outline for editing",
  "未指定": "Unassigned",
  "派发": "Send",
  "按状态分列": "By status",
  "按子组分列": "By group",
  "新增子卡到 {title}…（回车写入 TODO）": "Add card to {title}… (Enter to create TODO)",
  "不指定 Agent": "No Agent",
  "+ 子卡": "+ Card",
  "点击打开镜像源：{path}": "Click to open mirror source: {path}",
  "下钻聚焦到子看板": "Zoom into sub-board",
  "镜像": "Mirror",
  "停止": "Stop",
  "正文": "Transcript",
  "未分组": "Ungrouped",
  "选择本列卡片": "Select cards in this column",
  "选择卡片": "Select card",
  "已选 {n} 张": "{n} selected",
  "改为状态": "Change status",
  "删除 {n} 张卡片": "Delete {n} cards",
  "清空选择": "Clear selection",
  "置顶所选": "Pin selected",
  "置顶（移到本列最前）": "Pin to the top of this column",
  "删除": "Delete",
  "确认删除 {n} 张": "Confirm delete {n}",
  "清空": "Clear",
  "所选卡片中没有可改状态的卡（镜像卡请到源笔记修改）": "No editable cards selected (change mirror cards in their source note)",
  "当前笔记没有可写入的编辑器": "This note has no writable editor",
  "镜像卡不能删除，请到源笔记修改": "Mirror cards cannot be deleted here; edit the source note",
  "镜像卡还没解析到源笔记，请稍后刷新或打开源笔记修改": "This mirror card has not resolved to its source note yet. Refresh, or edit the source note.",
  "镜像源任务已变化，请刷新看板后重试": "The mirror source task changed. Refresh the board and try again.",
  "已跳过 {n} 张镜像卡（请到源笔记修改）": "Skipped {n} mirror card(s); edit the source note",
  "已删除 {n} 张卡片": "Deleted {n} cards",
  "打开项目目录：{cwd}": "Open project folder: {cwd}",
  "🧭 管家 {agent} 待命中 · 队员已完成 {done}/{total}": "🧭 Steward {agent} standing by · {done}/{total} finished",
  "🧭 管家 {agent} 正在收集 {total} 位队员结果并推进（第 {round} 轮）…": "🧭 Steward {agent} collecting {total} results & advancing (round {round})…",
  "⚠️ 管家 {agent} 汇总失败：{err}": "⚠️ Steward {agent} synthesis failed: {err}",
  "立即汇总": "Summarize now",
  "停止管家": "Stop Steward",
  "取消管家": "Cancel Steward",
  "重试汇总": "Retry",
  "忽略": "Dismiss",
  "千问办公": "QwenWork",
  "豆包工作": "Doubao Work",
  "第 {n} 轮": "Round {n}",
};
