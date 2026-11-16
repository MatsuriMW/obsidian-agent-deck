# 数据与笔记格式契约

## 1. 日记任务行与 AI 记录

- **标题格式与记录规则层（`recordRules`）**：默认生成 `任务状态 + 🤖 + HH:MM-HH:MM + **总结标题**`（自动剥离原始路径、URL 与口语前缀；工作区项目与 Grok Bot 会话自动带 `项目名 -> ` / `Bot名 -> ` 前缀，整段标题默认使用 Markdown `**...**` 加粗且不双重包裹）。规则细则统一由 `DEFAULT_RECORD_RULES` / `resolveRecordRules` 管理，并在「设置 → 记录 → 日记与归档 → 更多设置 → 记录规则细则」开放配置：`boldTitle`（母块标题自动加粗，默认开）、`projectPrefix`（项目/Bot 名前缀，默认开）、`showTimeRange`（起止时段，默认开）、`titleMax`（标题字数上限，默认 `22`）及 `autoLogGrokBotDoneMinutes`（Grok Bot 闲置自动 `DONE` 分钟数，默认 `120`）；子块（如委派/旁聊子项）不套用母块加粗。自动记录关键词复用既有词表：进行中为 `DOING`，正常停顿为 `PAUSED`，模型判断整件事做完的停顿态切为 `TOREVIEW`，阻塞/异常态（`needs-approval` / `error` / `limit` / `queued`）对应 `NEEDOK` / `ERRORED` / `HITLIMIT` / `QUEUED`，归档或长闲置才记 `DONE`。
- **用户标题保护**：已写出的父项标题与用户手写修改过的 AI 标题按原文保留（`preserveTitle`），跳过空格压缩、时间前缀剥离与重复加粗，不因状态切换或整理而覆盖。
- **关键词**：`DOING` / `NOW` / `IN-PROGRESS`（进行中）、`TOREVIEW`（待查看）、`NEEDOK`（待授权）、`ERRORED` / `FAILED`、`HITLIMIT`、`QUEUED`、`DELEGATED`、`TODO` / `LATER`、`PAUSED` / `SUSPENDED`、`WAITING` / `WAIT`、`DONE`、`CANCELED` / `CANCELLED`、`TODOFORAI` / `TODO4AI` / `TODO2AI` / `TODOTOAI`；支持 `[ ]` `[/]` `[x]` `[-]`。人工改写关键词锁定自动状态同步（内容仍继续记录）。
- **摘要短链与 AI 总结**：
  - 摘要中的长网址与文件路径使用 `[🔗](完整地址)`（不截断目标，编码空格与括号）；详细摘录与完整归档保留原文。
  - 用户输入清洗走 `src/prompt-text.js` 的 `cleanUserPrompt` / `isPromptText`；AI 自动记录（`❓`、简略 `任务：` 及模型摘要入参）额外走 `condenseUserPrompt` 过滤口语废话以提高信息密度。
  - 日记内仅记录时间（`HH:mm`），不重复写日期；默认以自然日零点（`dayCutoff: 0`）分割，跨日延续对话保留在原起始日日记中并合并时段，零点后新对话写入新一天。
  - 后台回答按清理后的正文计数：不超过 500 字，完整原文直接写入子块；超过 500 字，只写完整问答文件链接。文件保存在 `Agent Deck/Answers/`，包含完整问题与回答；不写会话号、定位标识或追踪注释。保留正文代码、命令与链接，不另调总结模型。文件校验值保存在插件状态中，手动修改过的文件不覆盖。
  - 普通会话的结论长度默认 350，保留用户自定义值；与后台 500 字分流规则独立。
- **记录粒度**：简略 / 标准 / 详细（上限 1000/3000 字），配置变更仅作用于新开始轮次，不重写已有记录。
- **轮次窗口（`autoLogFirstRounds` / `autoLogSeen`）**：每个会话只追最近的活动。第一次接入某个会话 / Bot 时只补最近 `autoLogFirstRounds` 轮（默认 `10`，设置「记录 → 日记与归档 → 更多设置 → 首次记录最近多少轮」）；之后同一个会话只补「当天产生」的轮次（按 `dayCutoff` 分界，跨日延续的会话也按今天追加到起始日那篇），更早的历史不再写进笔记。判定走 `settings.autoLogSeen`（会话号 → 首次记录时间，180 天懒清理、封顶 2000 条），老版本存在 `autoLogState` 里的会话自动算作见过；`trackedRounds()`（`src/constants.js`）统一给 `autolog.js` 的自动建项与 `sync.js` 的 🔗 回写用，没时间戳的轮次不受当天过滤影响。已有笔记里的历史记录不裁剪（笔记无损）。
- **当天日记缺失与默认开关**：自动会话记录默认打开（`DEFAULTS.autoLog`）、扫描间隔默认 `30` 秒（`DEFAULTS.pollSeconds`），老库由一次性标记 `settings.defaultsMigratedAutoLog` 迁移到新默认后不再改动用户选择。确有会话要写而当天日记不存在时，`AutoLog.createJournal` 先按 Obsidian「日记」核心插件配置的模板建笔记（`{{title}}` / `{{date}}` / `{{time}}` 与 `{{date:…}}` / `{{time:…}}` 按「模板」插件的日期时间格式替换，没配模板就建空文件），AI 分区骨架仍由 `placeBlock` 生成；没有需要记录的会话不建笔记。

## 2. 内部定位标识与清理

- 新任务块号使用「Agent 前缀 + 1–2 个英文任务关键词 + 10 位短尾码」，改标题或切换模型不换号，兼容历史 `^ad-…` 与 UUID 块号。
- 编辑与阅读视图隐藏内部块号、UUID 及绑定行尾会话号；`DONE`、会话归档与整理已完成日志时自动清理内部标识，同时保留会话链接、手写块号、手写内容与代码块。委派 Prompt、双链上下文与同看板兄弟分工通过 `stripInternalIdentifiers`（`src/harness.js`）在非代码块区域剥离内部 `^ad-*` 块号与 `<!-- ad-* -->` 追踪注释。

## 3. 并发写入、整理与归档

- **写入队列**：按文件排队执行；打开的笔记走编辑器事务，未打开的笔记在 `Vault.process()` 内合并最新内容；模型等待在锁外完成，返回后校验笔记是否变更。
- **整理日志**：默认按 `---` → 正在做 → `---` → 还要做 → `---` → 已完成 → `---` 排列。只整理顶格（无前置缩进）的 AI 记录条目；任何不顶格的缩进条目（包括合并分组到父项下的多条 AI 记录或 `🤖` 日志、已缩进嵌套的 AI 子项）及非 AI 条目均原位保留不拆散、不触发分散提醒。没有完整分区时只追加空分区，不收集旧内容。重复整理不叠加分区或分割线。分区标题注释前或末分区 `layout:end` 缺失时安全保留内容并恢复。
- **写入职责**：AI 自动建项、状态同步、归档记 DONE 和结论回写由 Agent Deck 负责。螺旋日程只读取 AI 记录用于展示，不再通过旧开关决定写入归属。
- **已完成归档**：只移出已完成 **AI** 块（默认 `Agent Deck/done/已完成任务.md`），先写归档、成功后删源；冲突时保留源内容不覆盖。

## 4. 持久化与口径

- **`data.json`**（`STORE_VERSION = 1`）：`archiveTaskTurns`、`aiRecordExpanded`、`aiRecordClosed`、`aiRecordViews`、`taskBoardViews`、`projectTeams`（含 `stewards` 管家偏好）、`workbenchWaves` 与 `ui.nowGroupBy` / `ui.recentGroupBy` 存插件设置，不污染 Markdown。切换大纲／表格／卡片／时间线／分形看板视图仅改变编辑器渲染，不改写 Markdown 内容、层级、顺序或块号。
- **`usage.json` 缓存**（`USAGE_CACHE_VERSION = 12`、`SUMMARY_VERSION = 3` in `src/readers.js`）：修改会话解析或清洗规则时必须递增 `USAGE_CACHE_VERSION`；变更日汇总结构或项目标签口径时必须递增 `SUMMARY_VERSION`。
- **Token 让渡**：仅当螺旋日程实际匹配同一会话且提供相应 token 时让出显示；否则由 Agent Deck 显示。
- **项目归属与「等你」口径**：
  - 项目分组以 `normalizeProjectRoot`（剥离 `/.claude/worktrees/...`）作为唯一身份键，不同路径同名目录绝不合并，仅在同名碰撞时追加最短区分父目录名；`/Codex/YYYY-MM-DD/...`（含多级子目录）与 `default-workspace` 等视为临时目录；带 `parentSid` 的子代理自动通过 `parentSid` / `parentCwd` 继承母会话项目。
  - DSH / Codex 子代理正常结束收口为 `done`、中断/中止收口为 `cancelled`；侧栏「现在」、「最近的会话 → 等你」与 macOS 菜单栏等待计数仅纳入 `needs-approval`、`queued`、活跃后台任务及最近 `WAIT_ACTIVE_MS = 30 分钟` 内的非子代理 `wait` / `quiet` 会话。
- **Dashboard 回顾口径**：汇总输入/输出/缓存读取 token、去重活跃耗时与会话数（沿用日记分界）；**缺失数据绝不估算**；不改写日记、不调用外部模型。项目归属除 `🔗` 链接外，也结合日记文件名日期与 `autoLogState` 溯源无 `🔗` 的 AI 自动记录块。（已在 macOS 实测；Windows 端未测）
