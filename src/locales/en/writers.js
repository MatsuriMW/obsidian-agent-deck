// Agent Deck — English UI strings (writers).
// Keys are the Chinese source strings; placeholders use {name}.

export default {
  // autolog.js — status notices and the organize summary.
  "螺旋日程的 AI 追踪还开着，先在设置里停用它":
    "Nautilus scheduling is still tracking AI sessions; turn that off in settings first",
  "今天的日记 {path} 还没建": "Today's journal {path} has not been created yet",
  "模型回的不是 JSON": "The model did not return JSON",
  "日记正在被改，这一轮没写": "The journal is being edited, so this round was not written",
  "不再管：{name}（这一行没了）": "No longer tracking: {name} (the line is gone)",
  "DONE（已归档）：{name}（{min}m）": "DONE (archived): {name} ({min}m)",
  "DOING：{name}": "DOING: {name}",
  "PAUSED：{name}（{min}m）": "PAUSED: {name} ({min}m)",
  "看着做完了：{name}": "Looks finished: {name}",
  "待拍板（挂在 {name} 下）：{text}": "Needs your decision (under {name}): {text}",
  "**{head}（{n} 件）**": "**{head} ({n})**",
  "▶ 在做": "▶ In progress",
  "⏸ {min} 分钟没动，先暂停了": "⏸ No activity for {min} min, paused",
  "📦 会话归档了，记成做完": "📦 Session archived, recorded as done",
  "✅ 看着像是做完了，要标 DONE 自己改一下": "✅ Looks finished; change it to DONE yourself if it is",
  "📌 记了要你做的": "📌 Noted for you to do",
  "🤖 整理了日记": "🤖 Journal organized",
  "没整理成：{error}": "Could not organize: {error}",
  "整理进日记了：": "Added to the journal:",
  "（模型没问到，新会话先用它自己的标题记的：{error}）":
    "(the model was not asked, so new sessions were recorded under their own titles: {error})",
  "没有要改的：会话都已经记过了，或者还太短（不到 {min} 分钟）":
    "Nothing to change: every session is already recorded, or still too short (under {min} minutes)",

  // journal.js — refusals shown when binding or merging journal lines.
  "这一项已经绑着这个会话了": "This item is already bound to this session",
  "这一项已经绑着另一个会话；先删掉它下面的 🔗 行":
    "This item is already bound to another session; remove the 🔗 line under it first",
  "笔记在拖的时候变了，再拖一次": "The note changed while dragging; drag again",
  "请选择两条不同的任务行": "Choose two different task lines",
  "这两行本身已经在同一个任务条目下了": "These two lines already belong to the same task item",
  "只能把任务列表项合并到另一条任务列表项上":
    "Only a task list item can be merged into another task list item",
  "父子任务不能直接互相合并": "A parent task and its child cannot be merged into each other",

  // dream.js — progress, notices and refusals.
  "记忆路径必须是库内的 .md 文件路径": "The memory path must be a .md file path inside the vault",
  "陪伴档案中的 Dreaming 区段不完整，请先修复标记":
    "The Dreaming section in the companion profile is incomplete; fix its markers first",
  "尚未开始": "Not started yet",
  "Dreaming 正在整理": "Dreaming is already organizing",
  "正在采集用户日志与 AI 记录…": "Collecting your journal and AI records…",
  "正在整理 {count} 块材料（共 {total} 块），等待模型返回…":
    "Organizing {count} blocks of material (of {total}); waiting for the model…",
  "正在校验并写入长期记忆…": "Validating and writing long-term memory…",
  "正在同步长期记忆…": "Syncing long-term memory…",
  "整理完成：新增 {added} 条记忆；已处理 {done}/{total} 块，待处理 {pending} 块":
    "Organized: {added} new memories; processed {done}/{total} blocks, {pending} pending",
  "Dreaming 新增 {added} 条记忆；已处理 {done}/{total} 块，待处理 {pending} 块；{sync}":
    "Dreaming added {added} memories; processed {done}/{total} blocks, {pending} pending; {sync}",
  "整理失败：{error}": "Organizing failed: {error}",
  "Dreaming 未完成：{error}": "Dreaming did not finish: {error}",
  "未开启陪伴档案同步": "Companion profile sync is off",
  "Telegram Companion 未启用，记忆已保留，稍后可重试同步":
    "Telegram Companion is not enabled; the memories are kept and sync can be retried later",
  "陪伴档案不能与长期记忆使用同一个文件":
    "The companion profile cannot use the same file as long-term memory",
  "陪伴档案尚未创建，记忆已保留":
    "The companion profile has not been created yet; the memories are kept",
  "已同步当前有效记忆到陪伴档案（最多 6000 字）":
    "Synced the current memories to the companion profile (up to 6000 characters)",
  "还没有长期记忆，请先运行 Dreaming": "There is no long-term memory yet; run Dreaming first",
  "已导出 Markdown 副本：{path}": "Exported a Markdown copy: {path}",
  "导出未完成：{error}": "Export did not finish: {error}",

  // dream-sharing.js — shared memory sync, Git push and errors.
  "共享目标必须是外部 Markdown 文件的绝对路径":
    "The shared target must be the absolute path of an external Markdown file",
  "长期记忆正在共享同步": "Long-term memory is already being shared",
  "正在读取长期记忆…": "Reading long-term memory…",
  "共享文件必须位于 Git 仓库工作区内": "The shared file must be inside a Git repository working tree",
  "正在写入共享 Markdown…": "Writing the shared Markdown…",
  "正在提交并推送共享记忆…": "Committing and pushing the shared memory…",
  "已同步并推送到 origin 当前分支": "Synced and pushed to the current origin branch",
  "已同步共享 Markdown": "Shared Markdown synced",
  "{status}：{target}": "{status}: {target}",
  "共享同步失败：{error}": "Shared memory sync failed: {error}",

  // dream.js — replies that failed the evidence checks, shown as a Notice
  "Dreaming 返回的记忆格式不正确": "Dreaming returned memories in the wrong format",
  "Dreaming 记忆缺少有效原文来源": "A Dreaming memory has no valid source excerpt",
  "用户画像不能仅以 AI 记录为依据": "The user profile cannot rest on AI records alone",
  "Dreaming 记忆缺少可核对的原文摘录": "A Dreaming memory is missing its verifiable excerpt",
  "Dreaming 原文摘录与来源不符": "A Dreaming excerpt does not match its source",
  "Dreaming 要替代的记忆不存在或已失效": "The Dreaming memory to replace is missing or no longer active",

  // dream-sharing.js
  "共享目标不能覆盖原长期记忆笔记": "The shared target cannot overwrite the original long-term memory note",
};
