# 数据与笔记格式契约

## 1. 日记任务行与 AI 记录

- **标题格式与记录规则层（`recordRules`）**：默认生成 `任务状态 + 🤖 + HH:MM-HH:MM + **总结标题**`（自动剥离原始路径、URL 与口语前缀；工作区项目与 Grok Bot 会话自动带 `项目名 -> ` / `Bot名 -> ` 前缀，整段标题默认使用 Markdown `**...**` 加粗且不双重包裹）。规则细则统一由 `DEFAULT_RECORD_RULES` / `resolveRecordRules` 管理，并在「设置 → 记录 → 日记与归档 → 更多设置 → 记录规则细则」开放配置：`boldTitle`（母块标题自动加粗，默认开）、`projectPrefix`（项目/Bot 名前缀，默认开）、`showTimeRange`（起止时段，默认开）、`titleMax`（标题字数上限，默认 `22`）及 `autoLogGrokBotDoneMinutes`（Grok Bot 闲置自动 `DONE` 分钟数，默认 `120`）；子块（如委派/旁聊子项）不套用母块加粗。自动记录关键词复用既有词表：进行中为 `DOING`，正常停顿为 `PAUSED`，模型判断整件事做完的停顿态切为 `TOREVIEW`，阻塞/异常态（`needs-approval` / `error` / `limit` / `queued`）对应 `NEEDOK` / `ERRORED` / `HITLIMIT` / `QUEUED`，归档或长闲置才记 `DONE`。
- **用户标题保护**：已写出的父项标题与用户手写修改过的 AI 标题按原文保留（`preserveTitle`），跳过空格压缩、时间前缀剥离与重复加粗，不因状态切换或整理而覆盖。
- **关键词**：`DOING` / `NOW` / `IN-PROGRESS`（进行中）、`TOREVIEW`（待查看）、`NEEDOK`（待授权）、`ERRORED` / `FAILED`、`HITLIMIT`、`QUEUED`、`DELEGATED`、`TODO` / `LATER`、`PAUSED` / `SUSPENDED`、`WAITING` / `WAIT`、`DONE`、`CANCELED` / `CANCELLED`、`TODOFORAI` / `TODO4AI` / `TODO2AI` / `TODOTOAI`；支持 `[ ]` `[/]` `[x]` `[-]`。块首关键词同时识别全大写与全小写形式（如 `todo` / `doing` / `done`），不匹配首字母大写的普通英文词（如 `Now` / `Wait` / `Later`）以免误伤正文；内部解析归一化为大写。人工改写关键词锁定自动状态同步（内容仍继续记录）。
- **摘要短链与 AI 总结**：
  - 摘要中的长网址与文件路径使用 `[🔗](完整地址)`（不截断目标，编码空格与括号）；详细摘录与完整归档保留原文。
  - 用户输入清洗走 `src/prompt-text.js` 的 `cleanUserPrompt` / `isPromptText`；AI 自动记录（`❓`、简略 `任务：` 及模型摘要入参）额外走 `condenseUserPrompt` 过滤口语废话以提高信息密度。
  - 日记内仅记录时间（`HH:mm`），不重复写日期；默认以自然日零点（`dayCutoff: 0`）分割，跨日延续对话保留在原起始日日记中并合并时段，零点后新对话写入新一天。
  - 后台回答按清理后的正文计数：不超过 500 字，完整原文直接写入子块；超过 500 字，只写完整问答文件链接。文件保存在 `Agent Deck/Answers/`，包含完整问题与回答；不写会话号、定位标识或追踪注释。保留正文代码、命令与链接，不另调总结模型。文件校验值保存在插件状态中，手动修改过的文件不覆盖。
  - 普通会话的结论长度默认 350，保留用户自定义值；与后台 500 字分流规则独立。
- **一个会话只认一条日记条目（`findSessionTask`）**：`findTask()` 的定位顺序是「🔗 深链 → `^blockId` → 会话标记 → 标题 key」，新增的会话标记匹配读子行里的 `<!-- ad-turn:<短会话号>:N -->` / `<!-- ad-summary:… -->`，所以标题被模型改写、块号在 DONE 后清掉，也能把同一个会话认回原来那条（`src/autolog.js` 建项前先按会话认领）。已 DONE 的条目只有在「这轮对话都记过」时才复用，真接着聊仍按新条目记。
- **中断与额度不足记一句原因（`aborted` / `quota`）**：DSH 的 `turn/end` 带 `reason`；`aborted` 标在轮次上（`r.aborted`），`error` 里命中 `ACCOUNT_QUOTA|Insufficient Balance|402|quota|rate limit|额度|余额` 的既标 `r.quota`，又把会话状态记成 `limit`（日记里落到 `HITLIMIT`，不再混进 `ERRORED`）。这些轮次即使没有正文也会写一行 `第N轮：**任务**：…；**结论**：本轮被中断，没有结论。` / `…；**结论**：额度不足，本轮未完成。`，普通报错仍记 `ERRORED`。
- **AI 结论行格式与图标渲染（`src/record-icons.js`）**：新写入的每轮 AI 结论行（含第 1 轮）统一为 `- 第N轮：**任务**：…；**结论**：…`（不再带 `💬`，`❓` 提问行与 `💬 累计总结：` 保持原样）；编辑视图（Live Preview，光标落入区间时退回源码）与阅读视图会将 `第N轮：` 及历史 `💬 第N轮：` 渲染为带轮次数字的圆圈 icon（`.ad-round-badge`：`16×16`、`vertical-align: middle; position: relative; top: -0.15em;`，内层 `.ad-round-badge__num` 采用 `text-box-trim: trim-both; text-box-edge: cap alphabetic;` 光学居中，悬浮/无障碍文本本地化为 `t("第 {n} 轮", { n: round })`），并将任务行中的 `🤖` 按 `^blockId` 前缀 / `🔗` / `⏱` / `autoLogState` 推断结果渲染为对应 Agent 的官方桌面 App 小图标（`.ad-agent-mark`：`16×16`、`top: -0.09em`，识别不到时保留 `🤖`）；`parseLink()` 对所有内置 `obsidian://agent-deck` 短链（含 `T3 Code` / `Cindy` / `Orca` / `Muse` / `Kimi Code` / `豆包工作` / `Gemini CLI` 等）完整剥离标题前缀，解析层与视图投影完整兼容新旧格式。
- **轮次文本不跨轮泄漏（`startRound`）**：`startRound()` 换轮时清空 live 上的 `lastText`，没有文字回答的轮次（全是工具调用）结论为空，不会把上一轮最后那句话当成本轮结论（`src/agent-ingestors.js`，五个客户端共用）。
- **记录粒度**：简略 / 标准 / 详细（上限 1000/3000 字），配置变更仅作用于新开始轮次，不重写已有记录。
- **分区标记坏了分级无损自愈，修不了才问（`repairJournalLayout` / `stripJournalLayout` / `hasBoundedJournalFrame` / `JournalMarkerModal`）**：`readJournalLayout` 校验失败统一抛出带稳定错误码 `JOURNAL_LAYOUT_INCOMPLETE` 的异常（中英文一致触发 `isJournalLayoutIncompleteError`）。点「整理日志」或「现在整理一次」遇到坏标记时按三层处理：① 最小确定性修复（`repairJournalLayout`：非代码块内联粘连拆行、去重多余外框、补齐缺失的 `layout:start/end` 或单侧开闭标记、恰好缺 1 个分区时优先按可见 `## 标题` 包回或按顺序补空分区、`- ---` 还原 `---`，绝不猜分区外正文归属）；② 可见标题框架兜底（残余标记无法最小修复时，先用 `stripJournalLayout` 剥除非代码块里的所有 `<!-- agent-deck:… -->` 标记且保留正文，若 `hasBoundedJournalFrame` 识别到至少 2 个 `---` + `## 标题` 分区，直接按标题边界无损整理并重写干净标记）；③ 前两层都无法安全接管时才弹 `JournalMarkerModal` 问「帮我重建分区」，不点头一个字都不动。「现在整理一次」扫描最近 14 天坏掉的日记：能无损自愈的直接修，其余合并弹窗问一次后重跑。状态标记 `settings.journalMarkerIntroShown`（只影响是否再解释一次）。
- **💬 结论分「编码」与「知识问答」两类**：`kind` 由润色模型在 JSON 里给出（`{"task","result","kind":"code|qa"}`，整理时的会话摘要同样带 `kind`）；润色没跑成时 `conclusionKind()`（`src/journal.js`）按「用户是在派活还是提问」兜底判断（指令 > 提问 > 回复证据，拿不准按 `code`）。编码类写「做了什么、现在什么状态」，字数 `conclusionMaxCode`（默认 `65`）；知识问答类取这一轮给出的判断，字数 `conclusionMaxQA`（默认 `160`），先看有没有「先说结论 / 推荐 / 所以 / 答案是」这类判断段，没有才退到结尾那段，并把上一段带上补上下文。
- **💬 结论取「最后的落点」**：`conclusionSentence()`（`src/journal.js`）按四级取句——① 回复里显式写出的结论段（`结论：` / `总结：` / `综上` / `总之` / `最终` / `结果` / `复盘`；`结论：` 这类字段名会去掉，因为记录行自己带字段名）；② 只有一个自然段且整段放得进本条记录的字数预算时，原样保留整段（这时开头就是全部内容）；③ 从最后一段往前最多看 6 段，取第一句不像收尾客套、不像下一步计划的话（跳过 `要不要` / `需要我` / `接下来` / `如果…` / `随时` 这类收尾与疑问句）；④ 全程都是客套与计划时退回最后一段。润色成功时仍以模型给的 `summary` 为准。`❓` 里的用户提问仍走 `oneSentenceConclusion()` 取开头，不用这套规则。
- **API 花钱前先问人（`autoLogApiConfirm`，默认开）**：`runJournalModel()` 在**自动**调用（自动整理、每轮润色、累积合并总结；`automatic: true`）且这次真的会走 `api` 来源时，先经 `setJournalApiConsent()` 注入的问询函数确认一次——macOS 用 `osascript display dialog`（「允许 / 这次不用」，60 秒无人应答＝不用），其它平台与 osascript 失败时用应用内弹窗（`ApiConsentModal`）。同意后 30 分钟内不再问（进程内授权，重启失效）；拒绝后同一窗口内也不再问，直接走本地规则。自动调用点包括自动整理、每轮润色、累积合并总结、定时 Dreaming 与语义块号命名（`src/task-id.js`）；手动操作（「现在整理一次」「测试连接」「工作台生成计划」「立即做梦」）与 `autoLogApiConfirm: false` 不问；没有可问的人一律按「不花这笔钱」处理，`task-id` 拿不到授权就退回本地 slug，Dreaming 直接报错停下。
- **整理来源的备用链（`autoLogFailover` / `autoLogBackupProvider` / `autoLogCooldownMin`）**：默认关闭，打开后主来源（`autoLogProvider`）最多再接**一个**备用来源（`auto`＝下一个已登录 CLI，没有就用已配好的 API；也可指定某个 CLI 或 `api`）。只有「限额 / 额度 / 429 / rate limit / 超时 / 起不来 / 非零退出」这类错误才换下一家，`请先填写…` 这种配置缺失直接报错；两家都问不到才退回本地规则（会话标题 + `conclusionSentence`）。命中限额关键字的来源进入冷却（默认 `30` 分钟，进程内状态），冷却期内直接用备用来源，上次成功的来源优先——这两项不写进 `data.json`。`testJournalModel()` 仍只测主来源。
- **轮次窗口（`autoLogFirstRounds` / `autoLogSeen`）**：每个会话只追最近的活动。第一次接入某个会话 / Bot 时只补最近 `autoLogFirstRounds` 轮（默认 `10`，设置「记录 → 日记与归档 → 更多设置 → 首次记录最近多少轮」）；之后同一个会话只补「当天产生」的轮次（按 `dayCutoff` 分界，跨日延续的会话也按今天追加到起始日那篇），更早的历史不再写进笔记。判定走 `settings.autoLogSeen`（会话号 → 首次记录时间，180 天懒清理、封顶 2000 条），老版本存在 `autoLogState` 里的会话自动算作见过；`trackedRounds()`（`src/constants.js`）统一给 `autolog.js` 的自动建项与 `sync.js` 的 🔗 回写用，没时间戳的轮次不受当天过滤影响。已有笔记里的历史记录不裁剪（笔记无损）。
- **当天日记缺失与默认开关**：自动会话记录默认打开（`DEFAULTS.autoLog`）、扫描间隔默认 `30` 秒（`DEFAULTS.pollSeconds`）、默认自动记录最短时长 `autoLogMinMinutes = 1` 分钟，老库由一次性标记 `settings.defaultsMigratedAutoLog` 迁移到新默认后不再改动用户选择。确有会话要写而当天日记不存在时，`AutoLog.createJournal` 先按 Obsidian「日记」核心插件配置的模板建笔记（`{{title}}` / `{{date}}` / `{{time}}` 与 `{{date:…}}` / `{{time:…}}` 按「模板」插件的日期时间格式替换，没配模板就建空文件），AI 分区骨架仍由 `placeBlock` 生成；没有需要记录的会话不建笔记。
- **全 Agent 子代理不独立记日记**：`AgentUsage.isSubagentSession(sid)`（O(1) 查 `subagentSids` / `meta` / `deskBySid` / `cursorParents`）在 `AutoLog`（跨日分流前 + `processDay`）、`JournalSync`（`results` / `autoKeywords`）与 `Delegator.resolveHandoffs` 统一跳过子代理/子会话（token 统计仍保留）；Claude Code 子代理文件（`<parent>/subagents/agent-*.jsonl` 与母会话共用 `fc.sid` 且带 `fc.sub`）通过 `!fc?.sub` 守卫禁止误标母会话；Cursor `ingestCursorEvent` 在 `sessionStart` / `afterAgentResponse` / `stop` 提前返回前完成父子绑定。
- **聚合端统一去重（`delegatedOwners`）**：T3 Code（经 6 张投影/运行时表提取 `t3CodeDelegatedSids`，解码 `:native-thread:` 并过滤 `provider-session:provider-instance:` 与 URL 编码 `pending%3A...` 占位符）、Cindy（经 `sessions.sdk_session_id`、`messages.agent_meta`、`agent_switch`、`subagent_runs`、`skill_usage_sources` 提取 `cindyDelegatedSids`）与 Orca（经 `agent_session_records.adopted_native_id` 与 `record_json.providerHandleChain[]` 提取 `orcaDelegatedSids`）在 `AgentUsage.delegatedOwners`（`Map<sid, Map<ownerAgent, ownerSid>>`）中建立统一归属映射；`delegatedOwnerOf(sid, selfAgent)` 支持沿 `parentSid`/`cursorParents` 最多 5 跳父链向上传递，在 `summary()`、`liveSessions()`、`sessions()`、`AutoLog`、`JournalSync`、`DashboardData`、`Delegator.resolveHandoffs`、`recommendPrimaryAgents`、设置页记录卡片统计、`main.js` 活态注入与 `runSecurityAudit` 中仅保留启用中聚合端会话，关闭聚合端后底层会话立即恢复；首次初始化与单卡重扫经 `mergeDelegatedOwners` 增量同步，全量强扫与 `rebuildUsage()` 前执行 `delegatedOwners.clear()` 重建。
- **Muse 主动推送过滤与防重复连发**：`museTrackProactive` 默认关闭（`false`），通过 `nonProactiveIds` 集合追踪用户触发的整条回复链（含助手连续多气泡回复上一条助手消息），过滤定时简报与主动推送；开启 `museTrackProactive` 后可全量入账。

- **DOING 时段**从会话开始算到最近一次刷新，适用于自动新建的条目和绑定会话的已有任务。会话停止或超出活跃窗口后，结束时间取最后一条已知事件。`⏱` 和活跃时长仍按日志中实际记录的时段计算。
- **归档重激活全 Agent 通用恢复**：`AgentUsage.isArchived(sid)` 统一汇总 `archived`、`archivedClaude` 与 `meta.archived`（`readCodexArchived` 支持 `force: true` 跳过 15 秒缓存节流并修复 WorkBuddy `deleted_at = -1` 哨兵误判，并同步清理/更新 `codex`/`workbuddy`/`dsh`/`cursor`/`kimicode` 的归档标记；`organizeJournal` 整理前强制刷新归档状态）。此前因客户端归档自动标 `DONE`（含 `organizeJournal`、`JournalSync.finish` 或「归档已完成的日志到…」移出日记）或跨日已完成的会话，在客户端取消归档或产生新轮次重新激活后，`AutoLog`（同日原位重开并恢复 `^blockId`、移出后重建今日新块、跨日重新记入今日日记且仅按今天起始时段和增量轮次记账）与 `JournalSync`（`keywords` / `autoKeywords` 重开 `archivedDone` 条目并补写新轮次）对全部追踪 Agent 均自动恢复追踪，同时严格保留人工 `DONE` 锁、真跨夜进行中会话与 Grok Bot 闲置分段规则。

## 2. 内部定位标识与清理

- 新任务块号使用「Agent 前缀 + 1–2 个英文任务关键词 + 10 位短尾码」，改标题或切换模型不换号，兼容历史 `^ad-…` 与 UUID 块号。
- 编辑与阅读视图隐藏内部块号、UUID 及绑定行尾会话号；`DONE`、会话归档与整理已完成日志时自动清理内部标识，同时保留会话链接、手写块号、`<!-- ad-pin -->` 关键记录标注、手写内容与代码块。委派 Prompt、双链上下文与同看板兄弟分工通过 `stripInternalIdentifiers`（`src/harness.js`）在非代码块区域剥离内部 `^ad-*` 块号、`<!-- ad-* -->` 追踪注释与 `<!-- ad-pin -->`。
- **关键对话记录 Pin 住（Pin as a chapter）**：`<!-- ad-pin -->`（插入在行尾 `^blockId` 前）只从右键菜单或命令切换——编辑器源码行尾留给段落委派箭头，表格／卡片／时间线视图与阅读视图的行不再有行内 📌，右键行即出现「Pin／取消 Pin + 委派（默认模型／选模型）」菜单。折叠／收起模式下始终保留被 Pin 记录；`Dreaming`（`src/dream.js`）在单批 `48000` 字符预算内优先装入 `pinned: true` 块并给予更高权重（仍严格遵守 `user`/`ai` 来源核验约束）。

## 3. 并发写入、整理与归档

- **写入队列**：按文件排队执行；只在 `source` 编辑模式走编辑器事务，阅读视图（`preview`）及未打开笔记统一经 `Vault` 读写与 `Vault.process()`（避免读取隐藏的过期 `editor`）；模型等待在锁外完成，返回后校验笔记是否变更。
- **整理日志**：默认按 `---` → 正在做 → `---` → 还要做 → `---` → 已完成 → `---` 排列。只整理顶格（无前置缩进）的 AI 记录条目；任何不顶格的缩进条目（包括合并分组到父项下的多条 AI 记录或 `🤖` 日志、已缩进嵌套的 AI 子项）及非 AI 条目均原位保留不拆散、不触发分散提醒。没有完整分区时只追加空分区，不收集旧内容。重复整理不叠加分区或分割线。分区标题注释前或末分区 `layout:end` 缺失时安全保留内容并恢复。
- **写入职责**：AI 自动建项、状态同步、归档记 DONE 和结论回写由 Agent Deck 负责。螺旋日程只读取 AI 记录用于展示，不再通过旧开关决定写入归属。
- 日记目录和文件名格式留空时，优先跟随 Obsidian 核心「日记」设置。核心「日记」未指定目录或格式时，分别使用库根目录和 `YYYY-MM-DD`。核心插件关闭时，依次尝试 Periodic Notes 和已有日记命名。修改核心设置后，Agent Deck 下次解析即使用新路径。
- 「重新扫描本机会话并整理今天的日记」按配置范围重读日志并提示结果。日记写入开启时，更新已有记录并补记今天尚未入账的会话。跨午夜会话仍记在起始日的日记。
- 自动记录的进度条保留跨天和重扫期间的会话入口。Codex 桌面会话可直达对应对话。Antigravity 桌面会话会打开客户端并复制会话 ID，由用户在客户端定位。
- 与螺旋日程同时启用时，自动记录沿用螺旋日程的可调日界。修改日界后重算会话归日，已有记录留在原日记。单独使用 Agent Deck 时可在自身设置中改日界。
- **已完成归档**：只移出已完成 **AI** 块（默认 `Agent Deck/done/已完成任务.md`），先写归档、成功后删源；冲突时保留源内容不覆盖。

## 4. 持久化与口径

- **`data.json`**（`STORE_VERSION = 1`）：`archiveTaskTurns`、`aiRecordExpanded`、`aiRecordClosed`、`aiRecordViews`、`taskBoardViews`、`projectTeams`（含 `stewards` 管家偏好）、`workbenchWaves`、`projectFolders`（项目名 → 工作目录，派发后按项目名记住）、`noteDispatchSessions`（从非日记笔记派发的会话号 → 时间，自动记日记跳过）、`museTrackProactive`（Muse 主动推送追踪开关，默认 `false`）、`menuBarPinnedSids`（菜单栏置顶会话号）、`menuBarAutoTitles`（无原生标题会话的模型缓存总结）与 `ui.nowGroupBy` / `ui.recentGroupBy` 存插件设置，不污染 Markdown。切换大纲／表格／卡片／时间线／分形看板视图仅改变编辑器渲染，不改写 Markdown 内容、层级、顺序或块号。
- **`usage.json` 缓存**（`USAGE_CACHE_VERSION = 23`、`SUMMARY_VERSION = 3` in `src/readers.js`，`usage-cache.json.gz` 另持久化 `cursorParents` 与 `delegatedOwners` 并在加载时重建 `subagentSids`）：修改会话解析或清洗规则时必须递增 `USAGE_CACHE_VERSION`；变更日汇总结构或项目标签口径时必须递增 `SUMMARY_VERSION`。macOS 菜单栏与侧栏「现在」共用 `buildProjectGroups` / `buildNowStatusGroups` / `orderNowSessions` 口径并双向同步 `ui.nowGroupBy`（`project` / `status` / `flat`），优先展示客户端原生/自动标题（`custom-title` / `ai-title` / `thread_name` / DB `title`），无原生标题时（如 Antigravity）在有可用免费/CLI 额度且无需未经授权计费 API 时后台生成简短标题，限额或失败时静默退回首句/任务名。
- **Token 让渡**：仅当螺旋日程实际匹配同一会话且提供相应 token 时让出显示；否则由 Agent Deck 显示。
- **项目归属与「等你」口径**：
  - 项目分组以 `normalizeProjectRoot`（剥离 `/.claude/worktrees/...`）作为唯一身份键，不同路径同名目录绝不合并，仅在同名碰撞时追加最短区分父目录名；`/Codex/YYYY-MM-DD/...`（含多级子目录）、`/Cindy/owners/<hash>/dialogues/...`（含 `CindyGlobal`/`xdt-maker`，`projectName()` 映射为 `"Cindy"`）与 `default-workspace` 等视为临时目录；带 `parentSid` 的子代理自动通过 `parentSid` / `parentCwd` 继承母会话项目。
  - DSH / Codex 子代理正常结束收口为 `done`、中断/中止收口为 `cancelled`；侧栏「现在」、「最近的会话 → 等你」与 macOS 菜单栏等待计数仅纳入 `needs-approval`、`queued`、活跃后台任务及最近 `WAIT_ACTIVE_MS = 30 分钟` 内的非子代理 `wait` / `quiet` 会话。
- **Dashboard 回顾口径**：汇总输入/输出/缓存读取 token、去重活跃耗时与会话数（沿用日记分界）；**缺失数据绝不估算**；不改写日记、不调用外部模型。项目归属除 `🔗` 链接外，也结合日记文件名日期与 `autoLogState` 溯源无 `🔗` 的 AI 自动记录块。（已在 macOS 实测；Windows 端未测）

## 5. 记忆库、派发载荷与注入口径（2026-11-18）

- **记忆库双模式（`settings.dream.store`）**：`text`（默认，单个 `长期记忆.md` 列表，旧行为不变）与 `files`（一文一条）。迁移命令一次性执行，迁移后两者互斥、不并存，`长期记忆.md` 降级为「人工前言 + `<!-- ad:memory:start/end -->` 生成区块」。
- **记忆索引（`记忆/索引.md`）**：由 `syncOverview` 自动刷新，一行一条（日期 · 类型 · 标题 · 双链），按日期倒序。用途是**替代"把标题写进文件名"**——文件名有 255 字节上限（中文约 85 字，实测 33 条记忆标题中位 201 字节），塞全文会静默截断；索引文件可一次 `cat`，或 `grep -h '^title:' 记忆/*.md` 拿全部标题。
- **记忆批量导入（模式 A 直接拆条 / 模式 B 模型提炼）**：入口位于记忆看板顶栏 `导入…` 按钮（及直接把 `.md / .json / .zip` 文件拖入记忆看板）、Obsidian 文件树右键 `导入到 Agent Deck 记忆库…` 与命令面板 `记忆：从 Markdown / JSON 导入到记忆库…`。模式 A（0 Token）支持直接解析外部 Agent 导出的列表笔记、单条记忆文件及 Claude `memories-*.json / .zip`（自动展开 `memory_files`）；模式 B 按文档分批送入 Dreaming 模型提炼。两种模式均在弹窗展示去重后的候选勾选列表与类型微调下拉框，落盘时若尚未开启 `files` 模式会自动完成迁移并补齐 `记忆.base`。
- **记忆库增删与 `记忆.base` 双向同步（2026-11-19）**：`memoryBase` 默认排除 `<dir>/索引.md`；`watchMemoryFolder` 监听记忆目录的 `create`/`modify`/`delete`/`rename`，对 Bases 新建或行内编辑的记忆条目通过 `reconcileMemoryFile` 自动补全 `id`/`kind`/`type`/`state`/`date` 并双向同步 `title` 与正文，`parseMemoryFile` 与 `scripts/memory-query.mjs` 均兼容仅含 `title`/`type`/`state` 的条目；记忆看板提供 `+ 新建` 与卡片 `删除`（走 `vault.trash` 并清孤儿回链），命令面板提供 `记忆：新建一条记忆` 与 `记忆：删除当前这条记忆`。
- **记忆文件格式**：frontmatter `id / title（完整正文，供 Base 展示）/ kind / type / state（有效|已拒绝|已被替代）/ date / sources[]`；正文第一行是记忆原句。`sources` 每项形如 `"[[日记/x#^mem-xxxxxxxx]]（用户日志，第 a—b 行）；原文：…"`，**列表项必须加 YAML 引号**，否则 `[[` 会被当成嵌套数组导致整段 frontmatter 解析失败（已踩过）。
- **块号分类**：`^ad-*` / `^dsh-*` 等任务号由插件生成，会随 `DONE` 清理或标题变化换号，**注入前剥除**；`^mem-*` 与 Obsidian 自动生成的 6 位号（形如 `^651b6c`）是定位锚，**永不剥除**。
- **注入降噪（`agentText`）**：注入边界统一去掉 `**加粗**`、`%%注释%%`、HTML 注释、零宽字符与行尾空白；代码块与行内代码先遮蔽后处理；**不动 `__`**（会误伤 `__name__`）。
- **记忆注入口径**：仅注入 `state=有效` 且与任务词面重合 ≥2 个词的条目，最多 5 条 / 1200 字；每条不带加粗，来源收在文末一行 `来源：[[…]]`；`pattern` 标「（待验证推断）」。
- **派发草稿（先看再发）**：命令生成草稿时 frontmatter 记 `status: draft`、正文即完整 prompt，并在任务块下插入 `- 📝 [[…|派发草稿]]`；用户改完后点委派，`findDraftLink` 取**子树里最后一份**草稿，正文直接作为 prompt，草稿改标 `status: dispatched` + `dispatched:` 时间。没有草稿时才走"派发瞬间现生成"的老路径。
- **派发载荷**：**按块号命名** `Agent Deck/派发/YYYY-MM-DD-^块号-<slug>.md`（无块号才退回 `YYYY-MM-DD-HHmmss-<slug>.md`），同一任务块后续派发**覆盖同一文件**，文件数 ≈ 任务数；，frontmatter `type: 派发载荷 / agent / task / anchor（回指 [[笔记#^块号]]）/ created`，正文是完整 prompt；原文任务块下插入 `- 📄 [[…|本次载荷]]`；prompt 头部改为「载荷绝对路径 + 冲突以文件为准」，因此不再受 12000 字截断限制。job 记录 `payloadPath` / `payloadHash`，用于识别"人改过的载荷"。
- **反向回链**：`- ⤴ [[记忆/…]]` 只在列表项下、每个顶层块只加一次；函数自归一化（先清旧回链再加），孤儿回链靠 `settings.dream.backlinked` 追踪。
- **技能卡（`技能/<name>.md`）**：frontmatter `type: 技能 / skill / path（真实 SKILL.md 绝对路径）/ dir / source（skillshare|dsh|claude）/ synced_at`；正文是 description 摘要与用法。**不搬文件、不做软链**（库在 iCloud + git，软链会断）。委派解析顺序：草稿 frontmatter 的 `skill:` → 任务行里的 `[[技能/x]]` → **短链**（任务行里任一 `[[name]]` 只要库里存在 `技能/name.md` 即视为技能）；命中后把 `path` 前置成「使用技能：…（路径）——先读它，按其中流程执行」。技能内容不进 prompt，只给路径。
- **被引用笔记传路径**：任务行里的普通 `[[笔记]]` 会解析成绝对路径列进 prompt（「任务里引用的笔记（可直接读全文）」），让 Agent 读全文而不是 600 字摘要；技能卡不在此列，也不整段注入（`harness` 里跳过 `技能/` 前缀的摘录）。
- **回复协议（2026-11-18）**：任务块下的 `- ❓ 第N轮：…` 与 `- ✍️ 答：…` 是普通列表项，也是一轮问答；状态不另造关键字（`❓` 未答 = 等你，`✍️` = 已答，之后 `💬` = 已跑完）。两行各带**块号**：`❓ … ^ad-q-xxxxxxxx`、`✍️ 答：… ^ad-a-xxxxxxxx`（`ad-a-` 由 `ad-q-` 稳定派生，改答案不换号），于是 `[[笔记#^ad-q-…]]` 能直接指到某一问；因为属 `^ad-*` 类，注入前会被 `stripInternalIdentifiers` 剥掉，prompt 里不留噪音。老笔记（没有块号）可用命令「给这一块的问答补块号」一次性升级，幂等。`enrichPrompt` 把「最近 3 轮问答 + 还在等的那一问」作为固定段注入（去掉 `**` 与反引号，和 `agentText` 同口径）；同句重复写不产生第二行。**❓ 由谁写**：`Delegator.writeResult` / `writeBackgroundResult` 记完 `💬` 后，若这一轮回答的最后 3 行里有以问号结尾的句子，就自动补一行 `❓`（同句不重复），所以"Agent 问了、人得去会话里找"这条路已经不需要走。空白 `✍️ 答：` 视为留位、不算已答。**回复信箱注册表**存在 `settings.replyInbox`（不落进笔记、不进 `data.json` 之外），每条 `{ path, blockId, questionId, question, agent, sid, title, at }`；它只是索引，渲染前用 `stillPending` 回笔记核对，答过/删掉的条目自动清掉，所以不存在"信箱里挂着但笔记已答"的漂移。
- **`enrichPrompt` 共用**：草稿与派发走同一份富化逻辑（技能路径 + 被引用笔记路径），所以"你看的草稿"和"实际发出去的内容"一致。
- **技能卡手改保护**：frontmatter 记 `body_hash`；刷新时若当前正文 hash 与之不符，视为人改过 → **保留正文**，只刷新 `path/dir/source/synced_at` 并标 `edited: true`。

### Dream 分析扩展

分析共用只读材料入口。日记材料保留作者类别、原文和定位信息。采集时跳过 `private: true` 和用户设定的排除目录。现有长期记忆提炼也走这个入口，并独立维护处理进度。

- **近期主题（优先）**。先手动预览，按主题出现在多少天、多少个独立会话里排序。候选带原记录链接。用户选中后创建或更新同一篇主题笔记。用次周回访和继续编辑判断笔记有没有用。
- **个人术语与风格（后续）**。先做用户自己定义的词义和项目简称。风格分析按口播、文章等场景启用，从用户原始消息取样，排除转述、粘贴材料和注入上下文。用户确认的持久信息才进入长期记忆检索与共享。
