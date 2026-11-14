# Changelog

## 1.9.3

- 新增 OpenCode 与 Qoder 委派及插件内续聊：OpenCode 支持通过 `opencode-cli acp`（或 `opencode`）后台委派、插件内同会话续聊与终端交互；Qoder 支持通过 `qodercli`（`-p -f stream-json` / `-r <sessionId>`）后台委派与插件内续聊、桌面客户端交接和终端交互。
- 统一所有 AI 自动写的任务行标题格式为 `任务状态 + 🤖 + 开始对话时间-最后一次对话时间 + 总结标题`（例如 `- DOING 🤖 14:52-15:52 调整 Agent Deck 侧边栏面板`），覆盖自动记日记、拖拽会话建项、状态切换、会话回写、子会话／side chat／subagent 子块与整理日志；自动剥离原始路径、URL 与口语前缀，提炼简短总结标题。
- 修正 `manifest.json` 与 `package.json` 的插件描述（移除冗余的 `"Obsidian"` 一词），符合社区插件市场审核要求。

## 1.9.2

- 设置页重组为 **委派、记录、Dreaming、关于** 四页：Models 并入委派页内的“管理模型”，Agents 的追踪设置并入记录页。
- 同一个设置只保留一个编辑位置：全局默认委派目标唯一；每个可配置 Agent 的默认模型与推理强度各保留一处编辑入口；合并重复的菜单栏重启与螺旋日程历史导入入口，按作用范围区分“委派任务回写”与“自动会话记录”。
- 模型目录的保存（⌘S）与放弃只作用于目录项（启用、置顶、排序、自定义模型），不会覆盖委派页刚修改的默认模型或强度；兼容并自动迁移旧版默认配置。
- OpenCode 与 Qoder 使用客户端应用图标。

## 1.9.1

- 新增 OpenCode、Qoder 桌面版会话追踪、任务绑定、日记回写和正文归档；两者暂不支持委派与插件内续聊。
- 重排全部六个设置页，统一文字左对齐和控件列起点，收紧页边距、分区和行距，精简说明；适配窄窗口及深浅色主题。Models 和委派展示全部 7 个 Agent，未接入功能显示简短状态。
- 默认“每轮记录”补齐第一轮至最新已完成轮次，按最新到最早排列；同轮提问、结论与步骤一起移动，保留已有正文和子任务。
- 修复不同会话共用 UUID 时间前缀时的任务块号冲突；查找绑定优先使用完整会话链接。
- 整理日志新增默认快捷键 **Ctrl+Alt+L**，在“关于 → 常用操作”排第一。

## 1.9.0

- AI 回复可作为母块继续编辑、添加子任务或再次委派。委派携带祖先链正文、续行和当前子树，不包含兄弟分支；新会话保留已有 AI 记录作为上下文。
- 后续回传保留用户修改、嵌套委派和旧累计总结，保护改写的任务标题与用时记录，避免父子任务互相覆盖。
- 简略日志将任务和结论浓缩为关键词或短语，合成一段；收起时最多显示三行，展开可查看完整记录。已有历史保持原样。
- Models 的 Agent 分区支持手动折叠和展开。隐藏或关闭 Agent 时自动折叠，恢复显示时自动展开；置顶模型排在所属分区前面。
- 设置选择按钮统一使用强调色底和勾选标记，适配深浅色主题；修复部分单选项点击后仍显示旧选中状态的问题。

## 1.8.0

- Agents 自动切换布局：1–3 个显示详细横条，4 个及以上显示紧凑卡片；按钮收拢到更多菜单，主力星标保留。
- pin 始终置顶；未 pin 的运行中 Agent 优先，同级保留手动顺序。支持管理卡片、持久化排序／置顶／移除，关闭追踪后隐藏，可从设置恢复。
- Agent 扫描默认补读本 Agent 最近七天有更新的会话，保留旧历史，重复扫描不重复累计 token。
- 整理引导改为首次四条散落 AI 任务、之后每新增四条再询问；全局每天最多两次，跨日和重载保留累计。同一任务的子记录不另计数，确认后才整理。
- 内置中英文整理模板，默认跟随界面；支持自定义分区标题与六种顺序，兼容自动记录、归档和模板切换，保护任务、问答、手写内容及围栏代码。
- 简化 AI 记录显示方式说明，重新组织关于页，README 开头补充早期迭代说明与 Issue／邮件反馈入口。
- 下一步预告：OpenCode 支持（后续开发计划）。

## 1.7.1

- “动手前先确认”改名为“委派附加要求”，默认仅在关键问题不明确时提问，信息充分时继续执行与验证；保留自定义正文。
- 设置页分行解释简略、标准、详细的内容范围与适用场景，开发日志推荐详细＋每轮记录。
- 切换“最新进展”只限制本次新增的轮次，不覆盖或删除已保存的提问、结论和步骤；详细程度仅作用于之后新开始的轮次。

- 委派确认弹窗移除左侧重复的发送／取消快捷键说明，只保留右侧按钮；保留发送聚焦与原有键盘操作。
- 更新中英文 README：补充自动记录用于每日回顾、任务续接、开发记录、检索结论和长期记忆的具体用法与保留范围。
- 同步本地安装说明，修正暂停默认值与 Antigravity 模型选择说明；一并发布下列 1.7.0 本地已有功能和修复。

## 1.7.0

- 点击任务状态关键词切换状态，替代打开 Query；常用与其他状态分组，菜单移除 TODOFORAI／TODO4AI／TODO2AI／TODOTOAI／NOW 五种别名但保留旧笔记解析。人工选择后锁定该任务的自动状态改写，保留内容记录，可恢复自动跟随。
- 日志详细程度区分为：简略仅一句结论、标准一问一答各一句、详细较完整问答摘录与可用步骤。设置变更只作用于新开始的轮次，历史已保存记录不重写。新轮次使用隐藏的会话标记区分多会话，保留用户／AI 证据角色供开发日志与 Dreaming 使用。

- 螺旋日程的进度行能打开同一会话时，隐藏展开记录里的重复 🔗 入口，保留绑定原文；无匹配进度、多个会话或阅读视图没有进度行时保留链接。备用链接不再禁用点击。

- 修复用量／解析缓存的并发保存：写入期间的新变化保持待保存，失败可重试，唯一临时文件避免覆盖；卸载快照提交后，旧的执行中与排队写入不能覆盖新实例的数据。
- 隐藏的面板延迟 DOM 重建，恢复可见、调整尺寸或切回标签时刷新；代码块里的示例任务不再生成 AI 折叠控制，选择默认展开时累计总结也遵循该设置。

- 启动注册不再等待 usage.json 和解析缓存，改到布局就绪后恢复；卸载时取消延迟任务，恢复途中卸载也不会再启动扫描。
- 任务行绑定映射复用一次会话快照与共用的缩进解析；扫描后更新状态，即使笔记没编辑也不会一直显示旧 pill。移动光标复用 AI 记录装饰，不再每次重解析整篇笔记。
- 修：缓存只存最后 10 条消息，重载后重算会漏掉调用与 token；改为完整保留计数所需消息，同时恢复等待会话的显示状态。缓存版本升到 4，首次会后台重建旧缓存。
- 面板普通刷新复用解析缓存；完整重算仍使用「重新计算全部历史」。

- AI 记录默认组合改为“每轮记录＋最新一条结论”。记录颗粒度、文字详细程度与显示范围独立；新增最新三条，最新一／三／五条都按 AI 结论计数，提问等明细在“更多”展开后查看，DONE 遵循同一规则。已有个人设置保留。
- 修：默认展开模式手动收起仍显示全部；详细模式遗漏首轮提问；原生折叠清理扩展没有接收 refreshEffect，界面刷新时可能抛错。

- 修（整理日志）：装了 done-to-top（任务归位）时，新记录被它的 `addBlock` 放到 `## 已完成` 上面，而整理只认区域里的块，这些 AI 记录就永久留在框外、已完成区永远落后一截。现在有 AI 区域时不再把放置交给 done-to-top，一律写进区域；没有区域时才用它的分区。
- 修（整理日志）：`- ---` 是 done-to-top 的分区线，整理会把它当「旧的手写分割线」删掉，把它的分区拆散。现在不删。
- 修（整理日志）：框外由本插件写下、但跑到区域上面的 AI 块（带 `^ad-` 编号、`🤖` 开头或有已追踪会话），整理时收进区域一次；框外的手写内容一点不动。
- 新：`## 已完成` 按对话轮数从多到少排，同轮数保持原文顺序。
- 修（整理日志）：journal-tidy 写的 `- 🤖 Agent 记录 · N 条` 分组容器没有状态关键词，之前被当成「进行中」整块搬走，里面已完成的记录也就进不了 `## 已完成`。现在容器里的记录全是 `DONE` 就整块进已完成，还有没做完的就整块留在进行中，子块不拆散。
- 修：记录块被 Obsidian 原生折叠（点箭头、⌘⇧[、折叠插件按标记补折、上次留下的折叠状态）时，原生占位「…」会和我们的折叠钮「⋯ 更多 3」同时出现两个省略号。记录层的折叠归本插件管，这类落在记录块里的原生折叠现在会自动撤掉，只留「更多 / 收起」。
- 新：从列表子项委派时，把母项一直带到最顶层列表项，各取一行、保留原缩进放进 prompt 当上下文，前面加一句「这条任务在笔记里挂的位置，只做最里面这一项」；母项下的兄弟项不带。确认弹窗的预览按同样层级显示，并标出带了几层母项。
- 修：委派列表子项时，母项用空格缩进、子项用 tab（或反过来）的混合缩进会让 `blockAt` 把更深的子块当成同级截掉，发出去的内容缺尾巴。现在缩进按视觉宽度算（tab = 4 列），并把子项带子块、不并进兄弟项、混合缩进写成回归测试。
- 任务行下面的记录顺序固定成「❓ 最近一轮的提问 → 💬 结论 → ⏱ 实际用时」，⏱ 永远排在最后；已经写进日记的旧记录会在下一轮自动整理或会话回写时顺手理顺，只挪 ⏱，其他行（含多轮 ❓/💬 配对、手写笔记）保持原顺序。
- 日记版面固定成五段：`## 已完成`（手写的 `DONE` 也一起收上去）→ 一条分割线 → `## 进行中`（保留 `### DOING` / `### PAUSED` 分组、组内按轮数降序）→ 一条分割线 → 你自己写的其余内容。标题和它下面的列表之间不留空行。
- 标题不再带 `AI · ` 前缀；1.7.0 早期写下的 `## AI · 进行中` / `## AI · 已完成` 在整理时就地改名，旧标题和上一轮写的分割线都会被收掉重建，重复整理不叠加线条；frontmatter、代码块、手写内容保持原样，只移动整块。
- 「归档已完成日志」换成「归档已完成的日志到…」：弹窗选目标文件（库内任意 `.md`，默认 `Agent Deck/done/已完成任务.md`，记住上次用过的）。归档只针对 AI 块，手写的 `DONE` 留在日记里。
- 新增「归档顺序」设置（插到开头 / 追加到末尾），默认插到开头；同一日期段落保持原位置，只按轮数重排。
- 归档文件按需创建目录与标题；依旧先写归档再删源，并发修改保留源内容，同块号内容不同时停手。
- 新增 **⌘⇧D「标记 DONE 并归档到「已完成」区」**：光标放在任务块里任意一行，一条可撤销的编辑同时把关键词改成 DONE 并把它挪到顶部区，光标跟到新位置。只在日记里生效。
- AI 记录的折叠只用 Obsidian 自带的折叠命令，状态存在插件设置里，不再需要在文档里提第三方折叠插件。
- 性能：`重新扫描`、`立即扫描` 和 `?do=scan` 改为复用解析缓存，只重读变了的日志——本机 2.7 GB / 664 个 Claude 日志，第一次全量约 13.8 秒，之后再扫约 50 毫秒；要丢弃缓存重算仍然走「重新计算全部历史」。
- 性能：插件加载后的首次扫描一开始就先画一次面板，用上次存下的数字顶上，不再空着等十几秒。
- 性能：解析结果落盘做缓存（`~/.agent-deck/usage-cache.json.gz`）。按本库设置（Claude 只读 14 天、DSH 全量）实测：重载后首次扫描从 9.2 秒降到 0.16 秒，缓存 0.37 MB；把 Claude 设成主力读全史时是 13.7 秒 → 0.28 秒、缓存 5.7 MB。缓存损坏、版本不符或日志被改写都会自动退回全量扫描；写盘按 5 分钟节流，退出时补存一次。
- 修：笔记开头或用户在段落之间写的 `---`，会在每次「整理日志」时多叠一条分割线（连按几次会越叠越多）。现在只保留生成的那一条，重复整理字节不变。
- 修（严重）：扫描缓存把 `day.sess`、`tasks.seen/map`、`rounds.seen` 这些 Map/Set 当成普通对象存了，读回来一迭代就抛 `day.sess is not iterable`，导致每次扫描失败、面板停在旧数据。现在按原类型序列化，并把缓存版本提到 3，旧缓存自动作废（会多扫一次）。
- 修：`⌘⇧D` 在围栏代码块里的示例任务上也会改关键词（把代码示例改成 `DONE`），现在围栏内的行不算任务。
- 修：日记放在库根目录时，`⌘⇧D` 会误报「只在日记里用」——路径比较没处理根目录。
- 修：整理时如果这篇日记一条 AI 块都没有，会在 frontmatter 后凭空插一条 `---`（归档掉最后一批也会遇到）；现在没有区块就不加线。
- 「今天」的项目时长排行不再显示 Codex 每次任务自动生成的目录名（`a`、`dui`、`w-s`、`1-5031567a-…` 这种）：这类机器工作目录改用会话标题，排行变成「今天最花时间的几件事」；真正的项目目录（如 `~/claude/agent-deck`）保持原名。
- 新装用户第一次加载时，面板自动放进右侧栏（只做一次，之后按 Obsidian 记住的位置走，不抢焦点）；启动时打开面板仍由「启动时打开面板」控制。
- 项目时长条的行补了悬停提示，被截断的项目名能看到全名和当天时长。
- 更新中英文 README 与工作流说明；重写版面与归档的回归测试。

## 1.6.0

- 界面语言跟随 Obsidian 自己的语言：Obsidian 是中文就用中文，其余语言一律用英文。不需要额外设置，也没有重启开关。
- 命令面板 21 条命令、设置页六个标签页、主面板、任务行状态 pill、委派与对话窗口、通知、右键菜单、AI 记录折叠、工具栏提示、macOS 菜单栏全部有英文；中文原文留在代码里作为 key，缺英文时自动回退中文。
- macOS 菜单栏助手改成按 key 查表：插件随状态快照下发 `labels`，Swift 侧查不到就用编进二进制的中文。
- 写进笔记的内容、任务行关键词、发给 CLI／LLM 的提示词、文件路径与设置存储值保持原样，不随界面语言变化。
- 新增 `test/i18n.test.mjs`：检查英文表无残留中文、分片无重复 key、每个 `t("…")` 都有英文、占位符两边一致。
- 面板页头的「会话」改为「会话数」，英文下为 Sessions，避免和任务行 pill 的 Session 混用。

## 1.5.1

- 修复恢复旧光标到 AI 记录内部时绕过默认折叠的问题；只有显式展开状态才显示明细。
- 实测默认折叠、手动展开跨重载保留、再次折叠，以及旧光标位置恢复。

## 1.5.0

- 未完成 AI 任务按状态分组，同组按会话轮数降序；已完成任务移入可自定义的独立归档文件，按日期及轮数整理。
- 累计总结保留轮次明细，编辑和阅读视图均可点击“更多”；最新五条模式可展开全部。
- 增加跳到正在做区域、去重权限／确认通知、内部编号隐藏，精简重复快捷键。
- 客户端归档可将手动暂停任务记 DONE；多会话任务等待全部归档。归档写入失败和并发编辑时保留源内容。
- 发布此前本机已完成的聊天位置选择、多会话续聊／重新委派、正文回链、触发符候选及确认提示设置。
- 更新中英文 README 与工作流说明，补充原生 UI、归档、排序和协议回归。

## 1.4.5

- Antigravity 接入官方 `agy acp`，支持任务直接委派、读取账号可用模型及校验推理强度。
- 新建的 Antigravity ACP 会话可在 Obsidian 查看回复、恢复同一会话续聊、停止当前轮次和归档正文；任务链接、状态按钮和菜单栏默认进入插件内对话。
- 工具权限请求在 Obsidian 展示服务端工具详情和真实选项，关闭窗口视为取消；认证或模型错误会明确失败。
- 保留原 Antigravity IDE 日志追踪；桌面会话与 CLI 会话不混用，不承诺 IDE 同会话恢复。
- 更新中英文运行依赖、ACP 接入矩阵与首次检查说明；增加 ACP 回归测试。

## 1.4.4

- 修复 Harness 默认模型切换错误被忽略、权限选项 ID 写死、进程退出后等待超时，以及取消消息未发送的问题。
- 可读取 Harness 返回的可用模型，包含自定义提供商和模型，保留原始模型路由。
- 会话卡片增加对话入口；Harness 可在 Obsidian 内恢复原会话并继续追问，支持停止当前轮次。
- Claude、Codex、WorkBuddy 和 Harness 可从本机日志查看与归档用户消息及回复正文。归档保留换行和长文本，更新时保留区段外的人工备注，拒绝覆盖手改正文。工具结果、内部推理和附件不包含在内。
- 增加 ACP 生命周期、模型发现、续聊与对话归档测试。WorkBuddy 的委派和续聊仍需原客户端。

## 1.4.3

- Telegram Companion 联动设置仅在检测到已安装该插件时显示，包含已安装但未启用的情况。
- Dream 按钮运行时禁用重复点击，显示采集、模型整理、写入和同步阶段及耗时；完成或失败后保留结果。
- 长期记忆可手动、在 Dream 后或每隔 1～168 小时同步到指定 Markdown 文件，供其他 Agent 读取。共享快照保留人工说明、有效记忆和来源，排除已拒绝和已被替代条目。
- 可将共享文件放在 GitHub 仓库的本地克隆中，使用已有 Git 登录自动提交并推送到 origin 当前分支。只提交共享文件，失败一小时后重试；自动同步默认关闭，仅在插件运行时执行。
- 增加外部文件导出、定时同步、并发、源文件保护、Git 提交范围及推送重试测试。

## 1.4.2

- 更新 Harness 中英文说明：记录 ACP 指定模型与强度、回复写回和桌面手动续聊的实测结果；说明当前链接不能自动定位会话，以及桌面端快速迭代期间的稳定性限制。
- Codex 增加桌面版与终端派发选项，默认使用桌面版。任务行的 `@codex/模型/强度` 会传给 App Server 新会话。
- 桌面模式在后台完成第一轮，释放会话后打开 Codex Desktop 继续。模型不可用或连接失败时明确报错；遇到审批或交互请求时停止，并提示到桌面继续。
- 保留按住 ⌘ 拖放到终端的入口，增加会话持久化、模型与强度、失败处理和桌面交接回归测试。

## 1.4.1

- 修复任务行 `@` 补全：选择 Agent 后自动打开模型列表，支持用 GPT、DeepSeek 搜索；旧配置未启用模型时仍展示该 Agent 的模型目录。
- Dreaming 按内容块增量处理，长日志分批继续，设置页显示已处理与待处理数量；区分 AI 嵌套回复和用户追问，每条新记忆必须附可核对的原文摘录。
- 长期记忆支持替代历史、拒绝与删除后排除，各目标笔记独立记录进度；合并时保留并发手工修改。
- 陪伴档案只同步当前有效记忆，限制长度；删除全部记忆后清除同步内容，并限制提炼时的历史上下文大小。
- 增加模型补全及记忆生命周期回归测试，放宽子进程测试的等待上限，避免启动较慢时误报失败。

## 1.4.0

- 写任务时输入 `@`，逐步选择 Agent、模型与推理强度。任务行保存为 `@agent/model/effort`，各派发入口读取同一配置，子块的选择只属于子块。
- Claude、Codex 和 DeepSeek Harness 支持模型与强度；WorkBuddy、Antigravity 交接到客户端设置。未启用 Agent、未知模型和无效强度会报错，Harness 拒绝指定配置时不静默换成默认值。
- 新增 Dreaming：从最近十四天的用户日志和已写入笔记的 AI 记录，整理带来源的 Markdown 长期记忆。支持手动运行和每二十四小时自动运行，沿用日记整理的 CLI 与模型设置。
- 记忆可导出为独立 Markdown 副本；可同步到 Telegram Companion 已配置的陪伴档案。只更新专属区段，保留手写内容，不直接发送 Telegram 消息。
- 增加任务路由、补全、子进程参数、记忆来源校验、重复运行、导出、档案保留、失败重试和并发运行测试。自动 Dreaming 与档案同步默认关闭，可在新设置页开启。

## 1.3.4

- 会话搜索改为全局搜索：顶栏搜索框有字时面板只显示搜索结果，范围是本机扫到的全部会话，不再只筛最近 7 天；空格分开的几个词都要命中，可查标题、首条消息、项目路径、最近一步、最近回复、模型、Agent 名和会话号，最多显示最近 100 条，Esc 清空。
- 搜索框兼容中文输入法：拼写期间不重画面板，拼完再更新结果，不会打断输入；搜索和结果列表与原来的「最近的会话」筛选互不影响。
- 日记目录和文件名格式留空时自动检测：先读 Obsidian「日记」核心插件和 Periodic Notes 的配置，再按日记目录里已有文件的命名推断，最后回退 `YYYY_MM_DD`；也可手动填 moment 写法（可带子目录）。设置里直接显示检测到的目录、格式和今天的日记路径，旧配置里默认的「日记」只迁移一次为留空。

## 1.3.3

- 增加自动记录总开关，关闭自动建项、结论、状态和合并，保留追踪及手动整理。
- 记录颗粒度可选最新进展、每轮记录、停歇或归档；与文字详细程度分别配置。
- 每轮记录可按 2～100 条阈值自动合并总结，复用所选 Claude / Codex CLI；失败保留原记录，保留手写内容、待办、用时和子任务。
- AI 记录联动 Obsidian、Bullet 和 Logseq Style Fold 的折叠命令，使用用户现有快捷键。

## 1.3.2

- 编辑器和阅读视图隐藏 Agent Deck 的块 ID；Markdown 原文与块引用保留，不插入零宽字符，代码示例不受影响。
- AI 记录入口统一为任务行尾的小箭头、记录和条数，折叠后不再占独立行；移除大按钮底色，弱化会话标签边框与展开记录的文字层级。
- 增加“跳转到日记中正在运行的项目”命令，默认 Ctrl + Alt + J，可在 Obsidian 快捷键中修改；多个项目时连续按依次跳转。
- 菜单栏默认只显示主力和当前正在运行任务的 Agent；可以在“追踪 → 界面 → 菜单栏显示哪些 Agent”切回全部已启用。


## 1.3.1

- 自动日志详细程度可选简略、标准、详细，默认简略：只保留最新一句结论，不逐轮抄写用户提问，也不追加步骤行。标准保留各轮结论，详细模式再记录各轮提问。
- AI 记录显示方式可选默认折叠、默认展开、只展示最新 5 条，默认折叠。编辑器与阅读视图均可收起记录；只改变显示，不删除正文。手写笔记与子任务不受折叠影响。
- 简略模式在后续写回时整理已有的直属自动记录；保留需要用户处理的待办与子任务里的记录。


## 1.3.0

- 自动记日记显式配置启动延迟、活跃时长门槛、整理间隔、Agent 范围、批量大小、CLI、模型、超时和失败兜底。支持 Codex CLI 整理与每轮结论润色。
- 后台整理失败默认用标题兜底；无绑定链接的自动条目同步等待、审批和错误状态；所有 Agent 的时段结算均按会话号收起绑定链接。
- Agents、委派、Models 可选择 Claude / Codex / DSH 默认模型与委派目标，分别设置推理强度；补充 Codex 模型和 CLI 路径、目录与沙箱设置；自定义模型支持编辑，CLI 使用真实模型名。
- 同一会话的多轮结论与进度写回同一块 ID，支持任务绑定与合并；Claude 优先显示步骤，其余 Agent 显示轮次。
- 加入 Antigravity 追踪，并改进 WorkBuddy 元数据、活跃时间与用量去重。


## 1.2.10

- **会话搜索框挪到最上面。** 页头的图标、「Agent Deck / 智能体甲板」和日期去掉，换成搜索框加刷新、设置两个按钮；搜的还是「最近的会话」。
- **今天那张卡放更有用的数字。** 协作时长（下面一行是较前 7 天日均多还是少）、产出 token（调用次数）、会话数（提问次数）。原来的「在跑」在「现在」那一节标题里已经有，去掉。
- **加一条今天的时间轴。** 从第一段会话所在的整点画到现在，每个 Agent 一条、用它自己的颜色，看得出哪几段在干活。
- **列出今天花时间最多的三个项目**，带时长条。原来页头的「主力」一行去掉，主力照旧在 Agents 卡片上用星标设。

## 1.2.9

- **菜单栏面板换成和主面板同一套配色。** 底色从偏紫的浅色换成暖中性色；强调色用主面板的灰紫（`--ad-accent`），不再是饱和的紫；四个 Agent 的颜色和主面板里的卡片一致。深色模式跟着调了。
- **页头放数字，不放图标和名字。** 原来的图标和「Agent Deck」字样去掉，换成今天的四项：协作时长、产出 token、会话数、和前 7 天日均比多还是少（前 7 天里有用量的日子不到 3 天时不显示这一项）。
- **每个 Agent 的小标签多了今天的时长。**
- **底部按钮改成中性浅色。**「打开面板」比背景深一档，「重新扫描」是描边，不再是一块实心紫。

## 1.2.8

- **菜单栏快捷键按一下开、再按一下收。** 以前再按只会把面板留着，要关得按 Esc 或点外面。
- **设置里的开关点得动了。** 开关以前只记得创建时的值：点一下样子不变，再点发的还是同一个值，看上去像点不动。所有开关都改好了。
- **「macOS 菜单栏」开关和菜单栏图标对得上了。**
  - 在菜单栏面板里点「隐藏」，设置里的开关跟着关上；
  - 助手起不来（比如没装 Xcode Command Line Tools）时把开关关上并说明原因，不再亮着却没有图标；
  - 编译那几秒里关掉开关，编译完不会再把助手拉起来；
  - 助手被杀或崩了，几秒内自动拉回来（以前状态没变化时不会补）。
- **修好菜单栏助手有时编译失败、图标不出来。** 关旧助手用的 `pkill` 会顺带匹配到正在编译的 swiftc，把编译杀掉；现在只认助手本身，并且等它关完再编译、再启动。
- 菜单栏助手的状态文件没变时不再每秒重读。

## 1.2.7

- **支持 Herdr 当终端。** 按住 ⌘ 拖到 Claude Code / Codex 上时，用 `hc` 起终端、带上 Herdr 的空间和标签记号，任务出现在 Herdr 里单独的「Agent Deck」空间、标签名是任务标题，不把 Herdr 叫到前台；resume 这类你点出来的会切过去。点 Herdr 里正开着的命令行会话，切到它所在的标签（没有标签的先给它一个）。
- **主力终端默认「自动」，按这台电脑挑。** 眼下的 `claude` / `codex` 命令行会话多半开在哪个终端就用哪个，认出来记在 `~/.agent-deck/terminal.json`；没有就用上次认出的，再没有就看开着的、装了的，先后是 Herdr → Tern → iTerm2 → Warp → 系统终端。设置里照样可以固定成某一个（新加了 Herdr）。
- 委派后的通知写明开在哪个终端里。

## 1.2.6

把发到每个 Agent 的路径都实测了一遍（Claude Code 后台、DeepSeek Harness、Codex 桌面版、WorkBuddy、Claude Code 命令行、Codex 命令行），修了三处跑不通的：

- **Codex 桌面版的会话认不出来。** 新版 Codex 会把 AGENTS.md、打开的页面这些上下文当成第一条用户消息写进会话，交接时拿它比对任务开头就对不上，任务一直停在「等你在 Codex 里发出去」。现在读会话时跳过这类消息。
- **在终端里委派（按住 ⌘ 拖）起不来。** 任务以「- TODO」开头，被 `claude` / `codex` 当成命令行参数，报 `unknown option`。现在任务前面加 `--`。
- **Codex 命令行停在信任提示上。** 和 Claude Code 一样：库没被 Codex 信任过时，换到一个信任过的目录起（读 `~/.codex/config.toml`），库用 `--add-dir` 加进去。挑目录时跳过临时目录。

终端委派目前只在 Tern 上实测过，系统终端、iTerm2、Warp 还没测。

## 1.2.5

- **列表项尾巴上的把手换成纸飞机，点一下就能委派。** 光标所在的列表项尾巴上一直有它（不再要求面板开着）：
  - **单击**：弹出确认框，看一眼要发出去的整块（这一项连同子块，按缩进排好），回车发给主力；
  - **双击或 ⌘ 单击**：弹出开着的 Agent（Claude Code、Codex、WorkBuddy、DeepSeek Harness），选哪个发给哪个，和拖到那张卡片上一样；
  - **按住拖**：照旧拖到侧栏的 Agent 卡片上委派。
- **Claude Code 直接开跑，答完在桌面版打开。** 不按 ⌘ 拖到 Claude Code（以及单击发给主力、菜单里选 Claude Code）都在后台直接起会话，不停在输入框里等你按回车；条目马上变成 `DELEGATED` 并挂上 `🔗`，第一轮答完自动用 `claude://resume` 在 Claude 桌面版里打开，接着在桌面版聊。按住 ⌘ 拖还是在终端里开 `claude`。
- **默认模型改成 Opus 5.5**，模型选择器里加了 Opus 5.5；设置里照样可以换。
- **动手前先确认。** 发给任何 Agent 的委派消息末尾都追加一句（笔记里看不到）：有疑问先问，都清楚了先复述打算，等你确认再改文件、跑命令。设置 → 提示词前后缀 → 动手前先确认 可以关掉。
- **macOS 菜单栏只显示图标**，不再带「Agent Deck」和「2 跑 · 1 等」这类文字，挤占更少。
- 后台委派不再每次都弹「后台服务没起来，已改用无头会话」：只有真的开了 `claude --bg` 又起不来时才提示。

## 1.2.4

整体精简了一遍代码，功能不变，省下不少后台开销：

- **少写盘。** 用量统计 `usage.json` 以前每 20 秒无条件重写一遍（库在 iCloud 里就跟着同步），现在只在统计真的变了时写；菜单栏状态文件以前每 1.8 秒写一次，现在内容没变就不写；DeepSeek Harness 委派时流式输出的每一小段都会存一次 `data.json`，现在攒 1.5 秒存一次，结束、出错、取消时立刻存。
- **扫描更快。** 「日志没变就跳过」的缓存以前因为字段名写错一直没生效，每轮都把几百个没变的日志重新过一遍，现在会跳过；每日汇总只看当天有记录的日志。
- **同一件事只写一份。** 任务关键词表、会话状态 → 关键词的对照、⏱ 行的写法、模型名对照、找 `claude` 命令行、时间格式这些，原来在好几个文件里各抄一份，现在各留一份。
- **设置里去掉了两项不起作用的选项**：「追踪 → 多久没动算安静」和「Models → Task models」，改了也没有任何效果。设置页顶部的版本号改为读插件自己的版本（以前写死成 v1.0.2）。
- 删掉没有调用方的函数、常量和导入。

## 1.2.3

- **「现在」里的卡片可以拖动排序。** 在列表里上下拖会话卡片调整顺序，顺序会记住；新来的会话排在最上面。拖动时面板暂停重画，拖着的卡片不会被换掉；拖进笔记里或半路放弃，卡片回原位。
- **「现在」里的卡片可以移除。** 悬停时卡片右侧出现 ×，右键菜单里也有「从『现在』移除」。
- **等待动画换成点阵。** 任务行按钮「准备中」是绕圈的点阵、「委派中」是蛇形的点阵；委派对话框的 Delegating、侧栏「等你发出」那一行、「在跑」状态标签也换掉了转圈图标。点阵移植自 [React Bits](https://reactbits.dev/c/micro/lattice-loader) 的 Lattice Loader（MIT + Commons Clause，保留了原作者版权声明）；系统开了「减少动态效果」时只做同步的呼吸。

## 1.2.2

- **主力终端默认是 macOS 系统终端**（设置里可以改成自动 / iTerm2 / Warp / Tern）。
- ⚠️ **已知问题**：委派到 Agent 的命令行（在终端里开 `claude` / `codex`）还有 bug，目前只在 Tern + Claude Code 上实测跑通；系统终端、iTerm2、Warp 和 Codex 命令行没完整测过。
- **终端里还开着的会话，点开就切过去。** Claude Code（读 `~/.claude/sessions/<pid>.json`）和 Codex 命令行（看哪个带 tty 的 codex 进程开着这个会话的 rollout 文件）的会话还在跑时，点开不再 resume，而是找到它的 tty、顺着父进程认出是哪个终端：系统终端、iTerm2 选中那个标签并把窗口提到最前，Tern 用它的命令行（`tern ls` / `tern process` 对上进程，`tern focus` 切过去）；Warp 没有脚本接口，只能叫到前台。进程已经退出才在新标签里 resume。
- **按住 ⌘ 拖到 Claude Code / Codex 上 = 在终端里委派。** 在主力终端里新开一个标签跑交互式的 `claude` / `codex`，任务直接当第一句发出去；会话一出现照交接的办法绑回这一项（只认命令行会话）。拖动时卡片提示跟着 ⌘ 换。设置里可以改成不按 ⌘ 就在终端里开（按 ⌘ 反过来）。主力终端是 Tern 时放进它单独的「Agent Deck」会话后台跑，不抢显示、不叫到前台；Claude Code 换到信任过的目录起、库用 `--add-dir` 加进去、带上设置里的权限模式，任务不会停在信任提示上。
- **设置 → 主力终端**：自动（装了 Warp 用 Warp）/ 系统终端 / iTerm2 / Warp / Tern（`tern new tab`），resume 和终端委派都在这里开新标签。
- **运行界面上不再放说明文字。** 面板副标题、空状态的提示、卡片悬停说明、拖放提示、pill 上的「点击打开」之类都删了，通知只说结果；怎么操作写进 README「操作指南」和设置 → 关于。
- **有螺旋日程的进度行时让给它。** 螺旋日程在任务行下面画了会话进度行，这一行就不再画 pill，🔗 链接放淡、不可点；点进度行（螺旋日程那边改成单击）交给 Agent Deck 打开。新增 `openSessionBySid()` 给别的插件调用。设置里可以关掉。
## 1.2.1

- **终端里的会话回终端打开。** 终端里起的 Claude Code 会话、Codex 命令行（`codex` / `codex exec`）会话，点开时在终端新标签里 `cd` 到会话目录接着聊（`claude --resume <id>` / `codex resume <id>`）；装了 Warp 用 Warp（写一份启动配置再用 `warp://launch/` 打开），没装用系统终端。菜单栏里点这类会话也一样（经 `obsidian://agent-deck?do=open` 交回插件）。设置 → 追踪 →「终端里的会话点开到哪儿」可以改回桌面版。
- **会话卡片上标出在跑的子代理。** Claude Code（终端版和桌面版一样）派出去的 subagent 在卡片上显示「子代理 ×N」，悬停看各自在做什么。
- **Codex、DeepSeek Harness 的子会话挂到母会话下面。** Codex 读 `session_meta` 的 `parent_thread_id`（或 `source.subagent.thread_spawn.parent_thread_id`），DSH 读会话头一行的 `parentSession`；子会话单独成行、缩进，标出从哪个会话开出。以前 Codex 子代理的用量直接并进母会话、列表里看不到。
- **DeepSeek Harness 的日志接着读。** DSH 的会话是一段段追加的 zstd 帧：文件只是长了，就从上次读完的整帧接着解压，不再每次把整个文件重解一遍；末尾那一帧还在写的话，先解到最后一个完整的帧，下一轮再接。文件被改写才整个重读。
- **Codex 会话标题补全。** `session_index.jsonl` 没收的（桌面版的、老的）从 `state_*.sqlite` 的 `threads.title` 补。
- **按住 ⌘ 拖会话卡片 = 在下面新建一项。** 不按 ⌘ 拖到有字的条目上是绑定；按住 ⌘ 拖到任意一行上，就在这一行（连同它的子项）下面新建一条 `DOING HH:MM 🤖 会话标题` 并绑上，有序列表接着编号。拖动时目标行的提示跟着 ⌘ 换。
- **只有人写的条目才委派。** 条目拖到 Agent 卡片上：人写的文字条目照旧委派；Agent 记的（🤖）、已经绑着会话的、有 ⏱ 用时记录的，不再开新会话，提示原因。
- **委派只剩两个入口。** 人写的一项拖到面板的 Agent 卡片上，或者块去向的「委派给 Claude」（⌥⌘D）。命令面板里的「委派光标所在块」「委派选项…」撤掉了；委派失败后状态 pill 上的「重试」还在。
- **条目拖到会话卡片上 = 绑定。** 笔记里的一项拖到「现在」或「最近的会话」里的某张卡片上，就把这个会话绑给它，和卡片拖到条目上一样，不委派。
- DSH 接着读、子会话挂母会话、Codex 标题补全，参考了 [Magpie](https://github.com/yetone/magpie)（MIT）读各家会话文件的做法。

## 1.2.0

- **笔记 ⇄ 面板拖拽。** 「现在」里的会话卡片拖到笔记里有字的一项上，原文不动、前面换上会话的状态关键词，下面写 `🔗` 子块，之后 `💬` / 状态 / `⏱` / 归档都跟着会话走；拖到空行、空的列表项或一段文字上，就在那儿新建一项并绑上（接着上面列表的缩进和编号）。拖动时目标行高亮并标出「绑定到这一项 / 在这里新建一项」。
- **一对一绑定。** 一个会话只绑一处：换个地方拖等于换绑；自动记日记先替它写过的「🤖 …」一项会一起收掉，日记里原有的任务和 Agent 跑的那件事合成一行。绑过的会话登记下来，归档收掉 `🔗` 之后自动记日记不会再替它新写一行。
- **拖到 Agent 上委派。** 面板开着时，光标所在的列表项尾巴上有一个拖拽把手（选中文字直接拖也行），拖到 Agents 里的某张卡片上：Claude Code / DeepSeek Harness 照旧后台开会话；Codex / WorkBuddy 走「打开客户端交接」——任务放进剪贴板、客户端叫到前台，你粘贴发出后，Agent Deck 认出新会话自动绑回这一项（`DELEGATED` + `🔗`），半小时没等到自动作罢。
- **卡片飞进「现在」。** 委派出去的会话一有会话号，卡片从对应的 Agent 卡片飞进「现在」；系统开了「减少动态效果」时只闪一下。
- **点 App 图标打开客户端。** Agents 区每张卡片的图标可以点，按 bundle id 把 Claude / Codex / WorkBuddy / DeepSeek Harness 叫到前台。
- **四家的归档都认。** 新读 Codex `state_*.sqlite` 的 `threads.archived`、WorkBuddy `workbuddy.db` 的 `sessions.status`、DeepSeek Harness `workspace.json` 的 `archivedSessionIds`；已归档的不再出现在「现在」和「最近的会话」，委派记录也不会把它们带回来。取消归档也能跟上。在客户端里归档 → 笔记里那一项记 `DONE` + `⏱`；今天的日记没开着也照样改。
- **Codex deeplink。** Codex 会话用 `codex://threads/<id>` 在桌面版打开（面板、菜单栏、状态 pill 都是），恢复命令仍复制到剪贴板；Codex / WorkBuddy 的 `🔗` 行写成可点的链接。
- **修：日记里的时间早了 8 小时。** 时段按「日记分界（默认 8 点）起的分钟数」存，写成钟点时漏加了分界，自动记日记和归档收尾写的 `DOING HH:MM` / `⏱` 都早了 `dayCutoff` 小时。
- **修：重载插件后侧栏面板消失。** 卸载时不再 detach 面板，固定在侧栏的位置留着。
- 写回开着的笔记时按行改一处，不再整篇 `setValue`，光标、折叠和撤销记录都留着。
- 设置 → 界面新增「列表项尾巴上的拖拽把手」开关。

## 1.1.1

- 四个 Agent 换成各自官方 App 的 icon：Claude（`Claude.app`）、Codex（`ChatGPT.app` 里的 Codex 图标）、WorkBuddy（`WorkBuddy.app`）、DeepSeek Harness（`DeepSeek Harness.app`）。面板的 Agent 卡片、会话行、状态 pill、设置页和 macOS 菜单栏用同一套图；读不到图时退回原来的 Lucide 字形。
- 图标以 PNG 编进 `main.js`，菜单栏助手从 `~/.agent-deck/agents/` 读同一份，不需要额外下载资源。

## 1.1.0

- **人机共写的 AI 流程从螺旋日程搬进 Agent Deck。** 会话到日记行的那一半不再依赖螺旋：自动记日记、状态写回、`💬` 结果、subagent / side chat / 桌面版子会话的子块、归档 → `DONE`，都在这里做；螺旋只保留追踪展示。设置 → 追踪新增「自动记日记」一节，命令面板新增「整理 Agent 会话进今天的日记」。
- **自动记日记**：读今天 Claude Code / Codex / WorkBuddy / DeepSeek Harness 的会话，用本机的 `claude -p` 起名、对上日记里已有的任务行，接不上就新写一行 `DOING HH:MM 🤖 …`；停了一阵改成 `PAUSED` 并把 `⏱` 时段写在下面；桌面版 / Codex 里归档记成 `DONE`；前几天还挂着的行在归档后补成 `DONE`。机器不在 `DOING` / `PAUSED` 之外猜状态。
- **回写日记**：`🔗` 绑着的会话答完一轮或归档写 `💬`；状态关键词跟着会话在 `DOING` / `TOREVIEW` / `NEEDOK` / `ERRORED` / `HITLIMIT` 之间切；归档记 `DONE` + `⏱` 并收掉 `🔗` 行。
- **子块**：桌面版里从绑定会话开出来的子会话写成缩进子块（读 `spawnedFrom`）；开着的 side chat 一个子块，进程退出记 `DONE` + `⏱`；Claude Code 派出去的 subagent 读 `<会话号>/subagents/agent-*.jsonl` 和 `.meta.json`，在跑的画 `🤖 子代理`，跑完换 `DONE` / `FAILED` + `⏱` + `💬`。
- **两套不打架**：螺旋日程的 AI 追踪还开着（`showAi` / `resultBack` / `agentKw` / `autoLog`）时，Agent Deck 暂不写日记，只做追踪；在 Agent Deck 里点「停用螺旋日程里的 AI 追踪」并重载螺旋后，写入完全交给 Agent Deck。
- 关闭开关：`回写日记`、`会话结论写回`、`状态关键词跟着会话`、`子会话和 side chat 子块`，都在「自动记日记」一节里。

## 1.0.10

- **Claude 桌面版的 side chat 找回来了。** 读 `claude-code-sessions/**/local_*.json` 里的 `spawnedFrom.sessionId`：侧栏里看着同级、其实是「从某个会话开出来」的会话，在面板里缩进一层并标出 `↳ 从「母会话」开出`；菜单栏标题前面加 `↳`。
- 正开着 side chat 的会话带一个 `side chat` 标签（看 `claude --fork-session --no-session-persistence --resume <sid>` 进程），菜单栏详情里也会写 `side chat ×N`。
- 桌面版里归档的会话不再出现在「现在」和「最近的会话」里；Codex 的 `archived_sessions` 之前只是读了没用上，这次一起生效。
- 设置 → 追踪新增「Claude 桌面版」一节：可以关掉 side chat 识别，或让归档的会话重新列出来。

## 1.0.9

- Releases are now built by GitHub Actions from the tagged commit, with build provenance attestations for `main.js`, `manifest.json` and `styles.css`. Verify with `gh attestation verify main.js --repo MatsuriMW/obsidian-agent-deck`.
- Added the release workflow (`.github/workflows/release.yml`) and a Chinese README introduction refresh.
- No plugin behavior changes from 1.0.8.

## 1.0.8

- **Marketplace review fix:** the manifest description no longer contains the word "Obsidian".
- **Marketplace review fix:** removed the programmatic `disablePlugin` / `enablePlugin` calls used by the Nautilus Spiral pause action. The action now only backs up and writes Nautilus's settings and asks the user to reload it from Obsidian's settings (or restart Obsidian). Agent Deck never enables or disables another plugin.

## 1.0.7

- The global shortcut now **opens or focuses** the panel; pressing it again no longer closes an open panel. Use Escape or click outside to close.
- Reduced wake latency: the panel is ordered on screen before macOS activation, and the data is pre-rendered at launch so the first shortcut feels immediate.
- The Carbon handler calls the panel directly instead of hopping through the main queue.
- The shortcut remains customizable; default ⌃⌥⌘D.

## 1.0.6

- The menu bar shortcut is now customizable in **设置 → 追踪 → 菜单栏快捷键**. Click the field and press a new combination; at least one of ⌃ / ⌥ / ⌘ is required. Default is ⌃⌥⌘D.
- The chosen shortcut is sent to the helper in `menubar.json` and re-registered live; the old combination is released.
- The shortcut still opens/closes the panel from any app when macOS has hidden the status item.

## 1.0.5

- Removed the left-side fallback overlay. The status item stays on the right side of the menu bar.
- Added a global shortcut, **Control + Option + Command + D**, that opens or closes the panel even when macOS has hidden the status item. It works from any app and does not need Accessibility access.
- The **Agent Deck: 打开 macOS 菜单栏面板** command remains as a second fallback.

## 1.0.4

- Added a fallback menu-bar icon for crowded menu bars. When macOS parks the real status item off-screen, a small wand icon appears in the free area left of the status items; it opens and closes the same panel and disappears once the real status item is visible. It carries a small state dot for running / waiting.
- Removed the status item autosave name so a saved off-screen position cannot pin the real item away from the bar.
- The **Agent Deck: 打开 macOS 菜单栏面板** command remains as a keyboard-only fallback.

## 1.0.3

- Rebuilt the macOS menu bar as a solid, opaque panel. It no longer uses `NSPopover` or any frosted/translucent material, so text keeps its contrast on macOS 26.
- The menu bar now speaks TODOseq's task-keyword language: `DOING`, `WAITING`, `NEEDOK?`, `HITLIMIT!`, `PAUSED`, `ERRORED`, `DONE`, `LATER` and `TODO`, with the same SVG icons and task-state colours as the TODOseq panel. The DOING loader-circle spins while the panel is open. The header counts DOING / WAITING, and NEEDOK sessions get an orange reminder.
- Card list rebuilt with white surfaces, 1px borders, soft shadows, a state-coloured rail and an agent glyph badge. Each card shows the project and current step.
- At most five sessions are visible at once; the rest are a scroll away. The footer shows the total session count.
- The light panel uses a near-white background with a slight tint of the current Obsidian theme; dark mode has its own solid palette. The dashboard keeps the calmer 1.0.2 palette.
- Fixed the helper window growing to the full screen height when the session list was empty.
- Added **Agent Deck: 打开 macOS 菜单栏面板** so the panel can still be opened when the menu bar is full or a menu-bar manager has hidden the status item. The helper also falls back to the top-right corner instead of the bottom-left when the status item's window is off-screen.

## 1.0.2

- The macOS menu bar now lists WorkBuddy's waiting sessions as well as its running sessions. Other non-primary agents still contribute only running sessions.
- Lower-saturation, warmer palette across the dashboard, settings and menu-bar popover: muted terracotta / slate / sage / periwinkle agent colours, parchment accents, softer gold stars and calmer status colours.
- The menu-bar popover uses the same muted palette, including a toned-down primary button.


## 1.0.1

- Delegation is command-driven: removed the per-item "Delegate" trigger. Only lines already bound to a session or delegation show a status/progress pill.
- Replaced the UI glyphs with Lucide icons (agent, status, tabs, stars, arrows, buttons); running states use a CSS spinner. The macOS menu-bar icon is the Lucide `wand-sparkles` SVG.
- Compatibility fix in **done-to-top 1.17.3** and **journal-tidy 1.9.1**: `DELEGATED` (and other agent-tracked) blocks that mention 明天 / 后天 / 大后天 are no longer moved into the next day, and DOING/TODO blocks before the first separator are no longer folded. Update those two plugins as well if you use them.
- Removed the duplicated `DELEGATED` blocks that earlier tidy runs had copied into `2026_10_20.md`.


## 0.2.0

- Moved the agent summary out of Obsidian's bottom-right status bar into a native macOS menu bar item.
- The menu bar item shows a compact icon + short text; clicking it opens a detailed SwiftUI popover with session rows and deeplinks.
- Primary agents show more sessions (default 6 each); other agents show only running sessions (default 3 each).
- The helper is compiled on first use with `swiftc` and exits when Obsidian quits.
- Agent Deck no longer creates an Obsidian status bar item.
- Nautilus Spiral's 🤖 agent status item is hidden while Agent Deck owns the menu bar; its planner status bar is untouched.


## 0.1.0

- Extracted the AI/agent tracking from Nautilus Spiral into a standalone plugin.
- Added Claude Code, Codex, WorkBuddy and DeepSeek Harness session readers.
- Added up to two primary agents with full-history tracking.
- Added Claude Code delegation with model, effort and permission mode.
- Added DeepSeek Harness delegation over ACP with model and reasoning effort.
- Added the inline delegate button with liquid progress, elapsed time and cancel.
- Added the layered Models settings page with draft/save/discard.
- Added Claude Code, WorkBuddy, DeepSeek Harness and terminal deep links.
- Added Nautilus Spiral history import and an optional AI-tracking pause.
