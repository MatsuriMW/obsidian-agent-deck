# Agent Deck（智能体甲板）

> 一个面板看清本机所有 AI Agent：谁在跑、谁在等你、刚才那步到哪了；需要时从正在写的任务行直接委派。

**中文** ｜ [English](README.en.md) ｜ [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases) ｜ [更新日志](CHANGELOG.md)

<p align="center">
  <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4"><img src="assets/demo.gif" width="800" alt="Agent Deck 演示：会话卡片拖到日记里的任务上绑定，任务拖到 Agent 上委派，状态和结论写回日记"></a>
</p>

<p align="center">25 秒演示 · 点图看 <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4">4K60 有声版</a> ｜ 国内可看：<a href="https://matsuri.site/demo/agent-deck/">matsuri.site/demo/agent-deck</a></p>

Agent Deck 把散在各个客户端里的 AI Agent 会话收到 Obsidian 里的一张甲板上：哪个 Agent 在干活、哪个在等你、做到了哪一步，抬眼就能看到；要派活，就从笔记里正在写的那一行派出去，进度和结果再回到这一行。人写的计划和 Agent 跑的活，最后落在同一份日记里。

它是 Obsidian 插件，把本机 **Claude Code、Codex、WorkBuddy、DeepSeek Harness、Antigravity** 五类 Agent 会话收进同一张「甲板」：主力 Agent 全量追踪，其它 Agent 读取今天有动静的会话；在跑、等你、安静、需要你确认、额度用完、出错停下这些状态用 TODOseq 的任务关键词和颜色标出来，点一行就回到对应客户端。

笔记和面板之间可以直接拖：会话卡片拖到笔记里的一项上，就把会话绑给它；笔记里的一项拖到某个 Agent 上，就是委派。只有光标所在的那一项尾巴上有个纸飞机把手：单击确认后连同子块发给主力，双击或 ⌘ 单击选发给哪个 Agent。任务行绑定了会话后，行尾的 pill 才变成进度条，完成后把结果写回笔记。macOS 菜单栏还有一块常驻的纯色面板，菜单栏被系统藏起来时可以用自定义全局快捷键唤起。

它从[螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 里「人机协作 / AI 追踪」那一半拆出来，补上了第二个主力 Agent、DeepSeek Harness 的后台委派、模型 / 强度 / 权限模式选择、分层的模型设置页，以及一块可读性更高的 SwiftUI 菜单栏面板。

**目录**

- [更新记录](#更新记录)
- [界面语言](#界面语言)
- [当前支持追踪的 Agent](#当前支持追踪的-agent)
- [操作指南](#操作指南)
- [推荐：和螺旋日程一起用](#推荐和螺旋日程一起用)
- [功能](#功能)
- [macOS 菜单栏](#macos-菜单栏)
- [人机共写：会话写回日记](#人机共写会话写回日记)
- [委派到哪儿](#委派到哪儿)
- [Deeplink](#deeplink)
- [状态 pill](#状态-pill)
- [使用前的运行依赖](#使用前的运行依赖)
- [安装](#安装)
- [设置](#设置)
- [和螺旋日程并存](#和螺旋日程并存)
- [隐私](#隐私)
- [常见问题](#常见问题)
- [发布与校验](#发布与校验)
- [反馈与后续](#反馈与后续)
- [致谢](#致谢)
- [许可证](#许可证)

## 更新记录

当前版本 **1.6.0**。逐版细节见 [CHANGELOG.md](CHANGELOG.md)，正式产物见 [Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases)。

### 1.6.0 · 界面中英双语

界面语言跟随 Obsidian 自己的语言设置：中文界面显示中文，其余语言显示英文，不需要额外配置。命令面板的 21 条命令、设置页、主面板、任务行状态 pill、委派与对话窗口、通知、右键菜单、AI 记录折叠以及 macOS 菜单栏都有英文；中文原文留在代码里作为 key，缺英文时自动回退中文。写进笔记的内容、任务行关键词、发给命令行的提示词不随界面语言变化。

### 1.5.1 · 日志归组与上下文归档

面板提供“归组未完成日志”“归档已完成日志”和“跳到正在做”。未完成任务整块移到日记的“AI · 进行中”，按 DOING、TOREVIEW、PAUSED 等关键词分组，同组按对话轮数从多到少排序。可用会话元数据时合计同任务的会话轮数，否则使用笔记中可读取的轮次；同轮数保持原顺序。

已完成任务默认移到 `Agent Deck/done/已完成任务.md`，按原日记日期分组；同一天的任务按轮数降序，后续归档会与已有任务一起重排。位置可在“追踪 → 自动记日记 → 已完成任务归档位置”修改。先写归档，再移除源任务；写入失败或日记同时被编辑时保留源内容。客户端中归档后自动 DONE 的功能仍在；同一任务的会话全部归档才完成。

累计总结保留原轮次记录，默认显示总结，点击“更多”查看明细，编辑和阅读视图都支持。AI 记录默认折叠，用户手动展开后持久保留该任务的展开状态；由 Agent Deck 自己控制，不依赖 Logseq Style Fold。旧版本已从笔记替换掉的记录，只能在原会话日志仍可读取时恢复。不再提供默认展开或只显示最新五条的显示策略。

内部块号、UUID、会话编号在界面隐藏，原始 Markdown 保留。明确等待权限或确认时显示 Obsidian 内提示和系统通知；相同等待只提醒一次。自然语言识别有范围，无法识别客户端未暴露的等待状态。

默认快捷键为 Ctrl+Alt+D 委派／任务操作、A 任务菜单、C 查看对话、N 处理待确认、X 停止执行、J 跳到正在做。打开会话使用点击入口；AI 记录沿用 Obsidian 和 Bullet 的折叠命令，不单独占用 O／R。可在 Obsidian 设置中修改。

恢复旧光标位置也不会绕过默认折叠，只有显式展开的状态才显示明细。

任务行 Agent 补全可在“委派 → 任务行 Agent 补全”关闭或自定义触发符。默认 @，前面需空格；父子任务分别选择，代码和邮箱中不触发。委派页的“确认提示词”可关闭或修改，只在开启时追加到本次消息末尾。

### 1.4.0 · 任务行选择 Agent 与 Dreaming

写列表任务时输入 `@`，选择 Agent。继续输入 `/` 选择模型，再输入 `/` 选择推理强度，例如：

```markdown
- TODO 分析这份材料 @codex/gpt-6.1-sol/high
```

选择保留在这一行，之后点击纸飞机或拖拽派发时生效。父任务与子任务各自选择。详细委派窗口会读取任务行的选择，窗口内修改只影响本次委派。模型来自现有 Models 列表，自定义模型也可选择。WorkBuddy 使用客户端交接，模型和强度在客户端设置。Antigravity 通过 Antigravity CLI 直接委派，可选择 CLI 提供的模型与强度，并在 Obsidian 内继续对话。

设置中的 **Dreaming** 页支持“现在 Dream 一次”和“每天自动整理”。材料来自最近十四天的日记，以及已有委派任务对应笔记。每次输入有长度上限；AI 记录须已写进笔记，未落笔记的会话不在此范围内。整理沿用“追踪”中的 CLI、模型与登录，材料会发送给该 CLI 使用的模型服务。自动整理仅在插件运行时每二十四小时检查，默认关闭。

长期记忆默认保存在 `Agent Deck/长期记忆.md`。每条包含类型、来源笔记和整理时间，可以直接修改或删除。“导出长期记忆 Markdown 副本”会在 `Agent Deck/Exports/` 生成普通 `.md` 文件；你可以从库文件夹复制出去。重复运行相同材料不会再次调用模型。

开启“同步到 Telegram Companion 陪伴档案”后，Dream 完成时读取 Companion 中配置的档案路径，并更新 Agent Deck 专属区段。插件未启用或档案未创建时保留本地记忆，可稍后再 Dream 以重试。同步不会覆盖手写内容，也不会直接发 Telegram 消息。此选项默认关闭。LLM Wiki 自动摄入与有序任务强制 handoff 属于大纲日志 App 的后续规划，本版本尚未提供。

## 界面语言

跟随 Obsidian 自己的界面语言自动切换，没有单独的设置项，也不用重启：Obsidian 是中文就用中文，其余语言（英文、日文、德文……）一律用英文。

- **判定**：读 Obsidian 存在 `localStorage.language` 里的值，`zh` / `zh-TW` 走中文，其余走英文。取不到时退回系统语言，再退回英文。
- **英文覆盖**：命令面板、设置页六个标签页、主面板、任务行 pill、拖放提示、委派对话框、对话窗口、通知、右键菜单、AI 记录折叠、macOS 菜单栏。
- **不翻译**：写进笔记的内容（任务行关键词、`🔗` / `💬` / `⏱` 行、归档标题）、文件路径与默认文件名、设置里保存的值、发给 CLI 或模型的提示词。它们要么会被程序再读回去做判断，要么是数据本身。
- **macOS 菜单栏**：Swift 助手把中文常量编进二进制，插件随状态快照下发 `labels` 表；查不到就用原中文，旧快照也不会出错。
- **加文案**：`import { t } from "./i18n.js"`，中文原文直接当 key，英文补在 `src/locales/en/` 对应分片。`node test/i18n.test.mjs` 会检查漏翻、重复 key 和占位符不一致。约定见 [docs/ui-language.md](docs/ui-language.md)。

## 当前支持追踪的 Agent

当前版本支持以下 5 类 Agent 的本地会话日志：

| Agent | 主要日志来源 | 进度显示 | 委派方式 |
|---|---|---|---|
| Claude Code | `~/.claude/projects`，以及 Claude 桌面版的 Code 会话 | 优先显示 TaskCreate / TaskUpdate / TodoWrite 步骤；无清单时显示对话轮次 | 后台 CLI 或终端交互会话 |
| Codex | `~/.codex/sessions`、`archived_sessions` 与会话索引 | 对话轮次 | 桌面模式通过 App Server 完成首轮后打开 Desktop；可切换到终端 |
| WorkBuddy | `~/.workbuddy/projects`，结合 `workbuddy.db` 元数据 | 对话轮次 | 打开客户端并复制任务，用户粘贴发送 |
| DeepSeek Harness（DSH） | `~/.dsh/sessions` 的 zstd 日志及本机用量统计接口 | 对话轮次 | 后台直接委派，可选模型与推理强度 |
| Antigravity | 原 IDE 日志及插件保存的插件内问答 | 对话轮次、规划回复与工具动作 | 后台直接委派；插件内续聊和正文归档 |

这 5 类会话均可绑定日记任务、自动建项并写回结论。状态和 token 用量以各客户端实际写出的日志字段为准。Claude、Codex、WorkBuddy 和 DSH 已接入各自可识别的归档来源；Antigravity 目前不承诺自动识别归档。点击插件创建的 Antigravity 会话会打开 Obsidian 内对话；原 Antigravity IDE 会话和 DSH 客户端入口仍只打开应用并复制会话号。

模型可以在 Models 页添加或修改。新增模型不会自动新增一种 Agent 日志读取器。插件在 macOS 上开发和验证；其他系统的客户端路径与跳转行为尚未验证。

## 操作指南

插件界面上几乎不放说明文字，怎么用都写在这里；各项开关在设置里。

### 面板

| 区域 | 看什么 / 能做什么 |
|---|---|
| 顶栏 | 搜会话（标题、首条消息、项目、最近一步、最近回复、模型、Agent；空格分开的几个词都要命中）：有字时面板只显示搜索结果，范围是本机扫到的全部会话，Esc 清空；重新扫描、设置 |
| 今天 | 协作时长（较前 7 天日均）、产出 token（调用次数）、会话数（提问次数）；今天各 Agent 在哪几段干活的时间轴；花时间最多的三个项目 |
| 现在 | 在跑和等你的会话，最多 6 张。点卡片打开会话；拖到笔记里绑定（见下面的拖拽）；在列表里上下拖调整顺序，新来的排最上面；卡片上的 ×（或右键）把它从「现在」移除 |
| Agents | 每个 Agent 一张卡：点图标把客户端叫到前台，⭐ 设主力（1–2 个，主力的全部历史都读，其余只读今天有动静的会话），「追踪中」开关、「扫描」立刻重读。笔记里的一项拖上来就是委派 |
| 最近 14 天 | 按 Agent 堆叠的每天协作分钟，悬停看具体数字 |
| 最近的会话 | 最近 7 天的会话，可以按状态、Agent 筛选 |

**点会话打开到哪儿**：Claude Code 桌面版会话走 `claude://resume`，Codex 桌面版走 `codex://threads/<id>`，WorkBuddy 走 `workbuddy://chat/<id>`；DeepSeek Harness 只能聚焦客户端，会话号复制到剪贴板。**终端里的 Claude Code / Codex 会话**还开着时，切到跑它的那个终端标签（系统终端、iTerm2、Tern、Herdr 能选中标签；Warp 没有脚本接口，只能叫到前台），进程退出了才在主力终端里新开标签 resume。主力终端默认「自动」，按这台电脑挑：眼下的 `claude` / `codex` 命令行会话多半开在哪个终端就用哪个（认出来记在 `~/.agent-deck/terminal.json`），没有就用上次认出的，再没有就看开着的、装了的，先后是 Herdr → Tern → iTerm2 → Warp → 系统终端。设置 → 追踪 → Claude 桌面版里可以固定成某一个，或者都走桌面版。

### 拖拽：绑定和委派


把 Agent Deck 固定在侧栏，笔记里的列表项和面板里的会话卡片可以互相拖：

| 怎么拖 | 结果 |
|---|---|
| 「现在」里的会话卡片 → 笔记里有字的一项（有序 / 无序列表都行） | 原文不动，前面换上会话的状态关键词（`DOING` / `TOREVIEW` / `NEEDOK` …），下面多一行 `🔗` 子块。之后 `💬`、状态、`⏱` 都跟着会话走 |
| 会话卡片 → 空行、空的列表项「- 」、或一段文字上 | 在那儿新建一项 `DOING 20:05 🤖 会话标题` 并绑上；接着上面列表的缩进和编号 |
| 笔记里的一项 → Agents 里的某个 Agent | 委派。Claude Code、DeepSeek Harness 直接在后台开会话（默认模型 Opus 5.5，设置里可改）；Claude Code 答完一轮自动在桌面版打开，接着在桌面版里聊；Codex 默认通过 App Server 完成首轮，自动绑回任务并打开桌面版继续；WorkBuddy 把任务文字放进剪贴板，你在客户端粘贴发送 |
| 按住 ⌘ 把会话卡片拖到一项上 | 不绑这一项，在它（连同子项）下面新建一条并绑上 |
| 按住 ⌘ 把一项拖到 Claude Code / Codex 上 | 在主力终端里新开标签跑交互式的 `claude` / `codex`，任务直接当第一句发出去；会话一出现自动绑回这一项。设置里开了「默认在终端里开」就反过来：不按 ⌘ 是终端，按 ⌘ 是后台 / 桌面版。主力终端是 Tern 或 Herdr 时，任务放进单独的「Agent Deck」会话（Herdr 里是「Agent Deck」空间）在后台跑，不把终端叫到前台；Claude Code 在信任过的目录里起（库用 `--add-dir` 加进去），不会卡在信任提示上 |
| 笔记里的一项 → 面板里的某张会话卡片 | 把这个会话绑给它，不委派 |
| 委派出去的会话有了会话号 | 卡片从它的 Agent 卡片飞进「现在」 |
| 在客户端里归档这个会话 | 笔记里那一项自动记 `DONE` + `⏱`，收掉 `🔗` |

- **一对一**：一个会话只绑一处。拖到别的项上等于换绑；自动记日记先替它写过的「🤖 …」那一项会一起收掉，时间和状态并到你拖到的那一项上。日记里本来写着的任务和 Agent 跑的那件事其实是同一件时，拖一下就合到一起。
- **小把手 ⠿**：光标所在的列表项尾巴上有一个小把手。**单击**：先弹确认框，确认后这一项连同子块作为一条消息发给委派的默认 Agent（主力），条目随后变成 `DELEGATED`；**双击**或 **⌘ 单击**：弹出 Agent 列表（Claude Code、Codex、WorkBuddy、DeepSeek Harness、Antigravity），选哪个发给哪个，效果和拖到那张卡片上一样；**按住拖**：拖到侧栏的 Agent 卡片上委派，选中一段文字直接拖也行。拖的时候 Agent 卡片变成虚线框，悬停的那张写着松手会发生什么。
- **拖进笔记时**目标行高亮，右边标着「绑定到这一项 / 在这里新建一项」；标题、代码块、表格上不接。
- **⚠️ 终端委派只在 Tern 和 Herdr 上实测过。** 在终端里开 `claude` / `codex`，Claude Code 和 Codex 命令行在 Tern、Herdr 上都已跑通、能绑回这一项，点会话也能切回那个标签；系统终端、iTerm2、Warp 还没实测。Codex 和 Claude Code 一样：库没被信任时换到一个信任过的目录起，库用 `--add-dir` 加进去，不会停在信任提示上。后台委派（不按 ⌘ 拖到 Claude Code / DeepSeek Harness 上）不受影响。
- **动手前先确认**：每条委派消息末尾会追加一句（笔记里看不到）：有疑问先问，都清楚了先说打算，等你确认再动手。设置 → 提示词前后缀里可以关掉。
- **不会再委派的条目**：Agent 记的（🤖 开头）、已经绑着会话的、下面有 ⏱ 用时记录的。拖上去只提示原因。
- **和螺旋日程一起用**：螺旋日程在任务行下面画了会话进度行时，行尾不再画 pill，🔗 链接放淡、不可点，点螺旋的进度行打开会话。设置里可以关掉这个让位。

| | |
|---|---|
| ![会话卡片拖到条目上](assets/demo/01-drag-session-onto-item.jpg) | ![绑定之后](assets/demo/02-bound.jpg) |
| ![条目拖到 Codex 上](assets/demo/03-drag-item-onto-agent.jpg) | ![等你在客户端里发出](assets/demo/04-handoff-waiting.jpg) |
| ![卡片飞进「现在」](assets/demo/05-card-flies-into-now.jpg) | ![归档后记 DONE](assets/demo/06-archived-done.jpg) |

## 推荐：和螺旋日程一起用

两个插件是配套的两半，建议一起装：

| 插件 | 负责 |
|---|---|
| [螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) | 日记和日程本身：螺旋排程、计时、容量、回顾，以及 Agent 的追踪展示（内圈细线、状态栏、进度条、`🔗` 绑定） |
| Agent Deck | AI 写入那一半：自动记日记、状态写回、`💬`、桌面版子会话 / side chat / subagent 子块、归档 → `DONE`；以及从任务行委派 |

交接只要一步：在 Agent Deck 的 **设置 → 追踪 → 停用螺旋日程里的 AI 写入**，然后重新加载螺旋日程。螺旋只停 AI 写入，日程、螺旋和追踪展示照常；写日记交给 Agent Deck。只装 Agent Deck 也能用，只是少了螺旋的排程和展示。

![Agent Deck 设置](assets/agents.png)

## 功能

- **本机 Agent 面板**：Claude Code、Codex、WorkBuddy、DeepSeek Harness、Antigravity 的在跑、等你、安静会话，带项目、最近一步、时长和 token。点一行用 deeplink 回到那个会话。
- **Claude 桌面版的 side chat**：桌面版里从一个会话开出来的会话，侧栏里看着和它同级。Agent Deck 读 `claude-code-sessions/**/local_*.json` 里的 `spawnedFrom` 认出母子关系，把子会话缩进一层、标出从哪个会话开出；正开着 side chat 的会话带一个标签，菜单栏里也会写 `side chat ×N`。已归档的会话不列在「现在」和「最近的会话」里：Claude 桌面版读 `isArchived`，Codex 读 `state_*.sqlite` 的 `threads.archived`（老版本的 `archived_sessions/` 也认），WorkBuddy 读 `workbuddy.db` 的 `sessions.status`，DeepSeek Harness 读 `storages/workspace.json` 的 `archivedSessionIds`。
- **人机共写：自动记日记**：读今天 Claude / Codex / WorkBuddy / DeepSeek Harness / Antigravity 的会话，用所选本机 Claude / Codex CLI 起名、对上日记里已有的任务行，接不上就新写一行 `DOING HH:MM 🤖 …`；停了一阵改 `PAUSED` 并写 `⏱` 时段；桌面版 / Codex 里归档记 `DONE`；前几天还挂着的行补记。设置 → 追踪里打开，或跑命令「整理 Agent 会话进今天的日记」。
- **回写日记**：`🔗` 绑着的会话答完一轮或归档写 `💬`；状态关键词跟着会话切；桌面版子会话、开着的 side chat、Claude Code 的 subagent 写成缩进子块。
- **和螺旋日程分工**：这些 AI 写入原来在螺旋里，现在归 Agent Deck；螺旋只保留追踪展示。螺旋的 AI 追踪还开着时 Agent Deck 不写日记，点「停用螺旋日程里的 AI 写入」并重载螺旋后完全接管。
- **最多两个主力 Agent**：主力全量读（全部历史、跨天补记）；其它开着的只读今天有动静的会话。
- **从任务委派**：单击任务行纸飞机、拖到 Agent 卡片，或用 Ctrl+Alt+D。已绑定的任务打开操作菜单，可续聊、查看正文、停止或重新委派新会话。发送前预览整块，并选择 Obsidian、后台、桌面或终端中该 Agent 实际支持的位置。
- **进度只长在绑定了会话的行上**：有 `🔗` 或正在委派的行，行尾才出现状态 pill。委派中 pill 自己填充、显示已用时间，旁边有 `×` 取消。答完变成「完成」，结果写成任务下面一行 `💬`。没有会话的行保持干净。
- **记录留在笔记里**：委派会写一行 `🔗`，状态改成 `DELEGATED`；拖拽绑定也是一行 `🔗`。删掉 `🔗` 就是解绑。
- **分层模型设置**：默认模型、默认强度滑杆、能力标签、搜索筛选、启用开关、置顶排序和每行菜单。改动先放在「Unsaved changes」条里，点保存才落盘。
- **只读本机**：只读 `~/.claude`、`~/.codex`、`~/.workbuddy`、`~/.dsh`、`~/.gemini/antigravity/brain`，以及 Claude 桌面版的会话清单 `~/Library/Application Support/Claude/claude-code-sessions`，不上传。插件目录里的 `usage.json` 存按天的汇总，日志被轮转掉历史还在。
- **官方 App 图标**：面板、会话行、状态 pill 和设置页使用 Agent 图标；菜单栏未提供某个图标时显示对应字形；状态、工具和窗口图标仍是 Lucide，正在跑的图标用 CSS 旋转。
- **Agent 汇总搬到 macOS 菜单栏**：Obsidian 右下角不再显示 Agent 会话汇总。系统最上方只留一个小图标；点开是一块纯色面板，任务卡片可以直接跳会话。

![macOS 菜单栏](assets/menubar.png)

## macOS 菜单栏

菜单栏是一个很小的 SwiftUI 助手，第一次运行时编译；菜单栏上只显示一个图标。它不是面板的复制，而是「现在谁在跑、谁在等我」的快速入口。

- **纯色，不毛玻璃。** 面板是一个无边框窗口，所有表面都是不透明颜色：没有 `NSPopover`、没有 vibrancy、没有磨砂材质，在 macOS 26 上文字对比度不会被玻璃效果吃掉。浅色背景是接近 Obsidian 主题色的浅底，深色模式也有独立的纯色配色。
- **任务关键词来自 TODOseq。** 每张卡片右上角标 `DOING`、`WAITING`、`NEEDOK?`、`HITLIMIT!`、`PAUSED`、`ERRORED`、`DONE`、`LATER`、`TODO`，前面配 TODOseq 里同一个 SVG 图标和任务状态色；`DOING` 的 loader-circle 在面板打开时一直转。顶部右边统计 `DOING` / `WAITING`，有 `NEEDOK?` 会话时会出现橙色提醒条。
- **页头是今天的数字。** 左边四项：协作时长、产出 token、会话数、和前 7 天日均比多还是少（前 7 天里有用量的日子不到 3 天时不显示）。没有图标和产品名：面板本来就挂在菜单栏的图标下面。
- **卡片就是卡片。** 白底、1px 描边、柔和阴影、左侧状态色轨、Agent 图标徽章、项目名和当前步骤；鼠标悬停时卡片会轻微浮起。
- **默认五条。** 一眼先看前五个会话，其余向下滑动；底部会写清楚一共多少个。
- **在右侧，也有快捷键。** 状态项常驻菜单栏右侧；如果 macOS 因为菜单栏排满把它藏起来，按 **⌃⌥⌘D**（Control + Option + Command + D）就能在任意 App 里打开面板，再按一次收起；Esc 或点面板外面也会关掉。快捷键可以在 **设置 → 追踪 → 菜单栏快捷键** 里改，不需要辅助功能权限。
- **主力 Agent**（最多两个）给更多行：正在跑的、等你的，加上最近六小时内的会话，默认每个主力最多 6 条。
- **其它 Agent** 只给正在运行的会话，默认每个最多 3 条。切为“全部已启用”时，WorkBuddy 的等待会话也可列出。
- 顶部标签默认只显示主力和当前正在运行任务的 Agent，带今天的时长和在跑 / 等你数量。主力空闲时仍保留；其他 Agent 停止运行后收起。在“追踪 → 界面 → 菜单栏显示哪些 Agent”可改为全部已启用（`menuBarAgentScope: all`）。
- 点一行和面板里的跳转一样：Claude Code / WorkBuddy 直接打开会话；DeepSeek Harness 聚焦客户端并复制会话号；Codex 用 `codex://threads/<id>` 打开，并复制 `codex resume <id>`。
- **打开面板** 走 `obsidian://agent-deck`；**重新扫描** 立刻扫一遍；**隐藏** 从菜单栏里直接关掉。

菜单栏面板和主面板是同一套低饱和配色：暖中性的底、灰紫的强调色（`--ad-accent`）、和主面板一致的 Agent 颜色；底部按钮也是中性色。任务状态色照 TODOseq。

第一次启动需要 `swiftc`（Xcode Command Line Tools）。插件会编译 `~/.agent-deck/AgentDeckMenuBar.app` 并启动它；Obsidian 退出时它也会退出。源码已经打包在插件里，不需要另外下载。菜单栏没出现时，到 **追踪 → 重启菜单栏**，或者先运行 `xcode-select --install`。

如果菜单栏已经排满（或者 Ice 把它收进了隐藏区），按 **⌃⌥⌘D** 打开或聚焦面板（再按一次不会关闭，用 Esc 或点面板外面关闭）。也可以在命令面板里运行 **Agent Deck: 打开 macOS 菜单栏面板**。

![分层模型设置](assets/models.png)

## 人机共写：会话写回日记

你在日记里写任务，是预计；Agent 的会话日志是自己会写的实际记录。打开「自动记日记」以后，Agent Deck 每隔一阵看一眼今天开着的会话，替你把状态和用时补上：

- **在动** → 那一行改成 `DOING`；日记里没有对应的行，就新写一行 `- DOING 00:45 🤖 优化配色`。名字和“接在哪一行”由所选 Claude / Codex CLI 整理；对不上就新写。
- **停了一阵**（默认 10 分钟）→ 改成 `PAUSED`，实际时段写在下面：`- ⏱ 00:45–01:20、04:02–04:24 · 共 52m · Claude`。
- **归档** → 改成 `DONE 19:20 …`，前几天记下、还挂着的行也在当天日记里补上。四家客户端的归档都认；今天的日记没开着也照样改。
- **不猜 DONE**：机器只在 `DOING` / `PAUSED` 和等你的几种状态（`TOREVIEW` / `NEEDOK` / `ERRORED`）之间切；你觉得做完了自己改，或者去桌面版里归档。模型说「看着做完了」只在提醒里提一句。
- **绑定会话的回写**：`🔗` 行绑着的会话答完一轮写 `💬`；停在权限提示上写 `NEEDOK`，等你回复写 `TOREVIEW`，报错 `ERRORED`，限额 `HITLIMIT`；归档记 `DONE` + `⏱`。自动记的 `🤖` 那一行也一样跟着会话切 `DOING` ↔ `TOREVIEW` / `NEEDOK` / `ERRORED`，不用等停满 10 分钟才看出它在等你。
- **都能调**（设置 → 追踪 → 自动记日记）：每隔几分钟整理、启动后第几分钟先跑一次（默认 1 分钟，不用再等满一个间隔）、新会话活跃满几分钟才记（3）、停几分钟算暂停（40）、记哪几个 Agent、一轮最多问几个会话（8）、整理用的模型和等多久（`haiku`、120 秒）、模型问不到时自动整理也先用会话标题记上（默认开）、整理 CLI（Claude / Codex）及其路径、Codex 推理强度、每轮 `💬` 要不要让模型润色及润色用的模型和超时。
- **子块**：桌面版里从绑定会话开出来的会话按 `spawnedFrom` 缩进挂成子块；开着的 side chat 一个子块；Claude Code 的 subagent 读 `<会话号>/subagents/agent-*.jsonl`，在跑画 `🤖 子代理`，跑完换 `DONE` / `FAILED` + `⏱` + `💬`。
- **分工**：这些写入原来在螺旋日程里，现在归 Agent Deck；螺旋只保留追踪展示。螺旋的 AI 追踪还开着时 Agent Deck 不写日记，点「停用螺旋日程里的 AI 写入」并重载螺旋后完全接管。

默认记录最新一句简略结论，不逐轮抄写用户输入。自动记录由 Agent Deck 负责。到“设置 → Agent Deck → 追踪 → 自动记日记”关闭“自动记录到日记（总开关）”，即可停用所有后台 AI 回写；会话追踪照常，仍可手动点“现在整理一次”。

“自动记录颗粒度”控制何时留记录：最新进展覆盖上一句，每轮记录累积已完成轮次，停歇或归档只在自动暂停或识别归档时留结论。状态与用时仍按原规则同步。每轮记录可开启“累积后自动合并总结”，默认 10 条，可设 2～100 条。合并使用所选 Claude / Codex CLI，成功后显示累计总结，旧 AI 轮次保留，点击“更多”展开，后续新轮次继续保留；失败则保留原记录。手写内容、待办、用时和子任务不参与合并。

AI 记录响应现有折叠命令：Obsidian 的折叠 / 展开 / 全部折叠与展开，以及已安装的 Bullet 对应命令。快捷键由 Obsidian 快捷键设置决定，Agent Deck 联动记录的显示层。默认折叠，手动展开状态会保留，不依赖 Logseq Style Fold。它们在 Markdown 中仍是列表子块。

AI 记录默认折叠，点任务行尾小箭头旁的“记录”展开。机器记录使用较小、较淡的文字；任务状态保留原有颜色。可切换日志详细程度；手动展开状态持久保留，原文仍保留。切换日志详细程度后，下次写回会整理本任务已有的直属自动记录。`^ad-…` 块 ID 在编辑和阅读界面隐藏，Markdown 原文与块引用照常保留，不使用零宽字符。

后台按行回写；手动归组可单独撤销，跨文件归档先保存副本；正在用输入法打字的那一下不写，等下一轮；这期间日记被别处改过就放弃这一轮。

自动记日记的各项配置如下，均可在设置页修改：

| 配置字段 | 默认值 | 用途 |
|---|---|---|
| `journalFolder` | 空 | 日记所在目录；留空自动检测：Obsidian「日记」核心插件 → Periodic Notes → `日记` |
| `journalFormat` | 空 | 日记文件名格式（moment 写法，可带子目录，如 `YYYY-MM-DD`、`YYYY/MM/YYYY-MM-DD`）；留空自动检测：Obsidian「日记」核心插件 → Periodic Notes → 日记目录里已有文件的命名 → `YYYY_MM_DD` |
| `autoLog` | `false` | 是否自动整理；关闭后仍可手动整理 |
| `journalAutoWrite` | `true` | 自动记录总开关；关闭自动建项、结论、状态与合并，追踪和手动整理保留 |
| `autoLogGranularity` | `latest` | 最新进展；也可选 `round` 每轮结论、`paused` 停歇或归档后结论 |
| `autoLogMerge` | `false` | 每轮记录模式下自动合并累积结论 |
| `autoLogMergeThreshold` | `10` | 每次合并所需的新结论条数，可设 2～100 |
| `autoLogDetail` | `brief` | 每条结论约 45 字；标准结论更完整并显示步骤；详细模式在按轮记录时保留提问 |
| `aiRecordExpanded` | `{}` | 保存各任务手动展开状态；未展开的任务默认折叠，旧 `aiRecordDisplay` 策略不再覆盖此规则 |
| `autoLogEvery` | `20` 分钟 | 后续整理间隔，可设 5～240 分钟 |
| `autoLogStartDelay` | `1` 分钟 | 插件启动后首次整理的等待时间，可设 1～240 分钟 |
| `autoLogMinMinutes` | `3` 分钟 | 新会话累计活跃时长门槛；0 表示有活动就记，已归档会话不受此限制 |
| `autoLogIdle` | `10` 分钟 | 停歇多久后记为 PAUSED，可设 5～480 分钟 |
| `autoLogAgents` | 5 个 Agent 全开 | 分别选择 Claude、Codex、WorkBuddy、DSH、Antigravity |
| `autoLogBatch` | `8` | 每次交给模型的会话数，可设 1～20 |
| `autoLogProvider` | `claude` | 整理和润色使用的 CLI，可选 `claude` / `codex` |
| `autoLogModel` | `haiku` | 传给所选 CLI 的模型名；切换到 Codex 时预填 `gpt-6-luna`，可修改 |
| `autoLogEffort` | `low` | Codex 整理和润色的推理强度 |
| `autoLogTimeout` | `120` 秒 | 整理超时，可设 10～600 秒 |
| `autoLogFallback` | `true` | 后台调用失败或返回无效 JSON 时，用标题或首句先建项 |
| `autoLogPath` | 空 | 整理 CLI 路径；空值沿用对应委派路径，再从 PATH 查找 |
| `roundPolish` | `true` | 是否让模型润色每轮结论 |
| `roundPolishModel` | 空 | 润色模型；空值沿用整理模型 |
| `roundPolishTimeout` | `30` 秒 | 润色超时，可设 5～300 秒 |
| `autoLogKw` | `true` | 无 🔗 的自动条目也同步会话状态，受 `journalSync` / `agentKw` 总开关控制 |
| `autoLogArchiveDone` | `true` | 识别到客户端归档后记为 DONE |
| `autoLogNotify` | `true` | 整理后通知 |

每轮结论和状态的扫描间隔由“追踪 → 每隔几秒扫描”（`pollSeconds`，默认 20 秒）控制。今天的日记必须已存在。首次整理仍受活跃时长门槛约束，未达门槛的会话在后续整理时再处理。

## 委派到哪儿

### Claude Code

Agent Deck 用无头方式起一个 Claude Code 会话，把下面这些参数传过去：

- `--model`（默认 Opus 5.5；也可以选 Opus 5、Sonnet 5、Haiku 5.5、Fable，或自定义别名）
- `--effort`（low、medium、high、xhigh、max）
- `--permission-mode`（`plan`、`auto`、`acceptEdits`、`manual`）
- `-n` 会话名，`--add-dir` 把库加进可读目录

任务直接开跑，不会停在输入框里等你按回车。第一轮答完，会话自动用 `claude://resume?session=<id>` 在 Claude 桌面版里打开（桌面版把命令行会话导入进来），接着在桌面版里聊。「委派 → 完成后自动在桌面版打开」可以关掉，关掉后点任务行的 pill 也能打开。

发给任何 Agent 的委派消息，末尾都会追加一句（笔记里看不到）：有不清楚的先问；都清楚了先复述打算，等你确认再改文件、跑命令。「提示词前后缀 → 动手前先确认」可以关掉。

如果 Claude Code 没信任过这个库，插件会读 `~/.claude.json`，找一个已经信任的目录当工作目录，再用 `--add-dir` 把库加进去。可以在「委派 → 库没被信任时自动换个目录」关掉。

### DeepSeek Harness

通过本机 Harness 开会话，可选择模型和推理强度。任务直接开跑，答完把结论写回 `💬`。会话保存在 `~/.dsh/sessions`，Agent Deck 可以继续追踪。

2026-11-13 在 Harness 0.2.2-rc.1 上实测，`@dsh/deepseek-v4-pro/high` 能按指定模型和强度执行，并把回复写回笔记。会话会出现在 Harness 桌面侧栏的“未分组”中，手动选中后可以继续对话。Agent Deck 的 `dsh://open` 链接目前只会唤起客户端并复制会话号，不能自动定位到指定会话。

**DeepSeek Harness 桌面端仍处于快速迭代阶段，目前稳定性有限。** 不同版本的会话显示和接入行为可能变化，上述结果以实测版本为准。

Harness 的工具权限可设为自动允许一次，或拒绝并提醒。

### Codex / WorkBuddy

Codex 可设为默认委派目标。在“委派 → Codex → 派发到”选择桌面版或终端。桌面模式通过 App Server 创建持久会话，传入 `@codex/模型/强度`，完成首轮后释放会话并打开 Codex Desktop。连接失败或模型不可用时明确报错。遇到审批或交互请求时停止，打开桌面会话供你继续。按住 ⌘ 拖放仍可直接走终端。

WorkBuddy 使用桌面版交接：把一项拖到它的卡片上，任务文字（加上委派设置里的前后缀）放进剪贴板，客户端叫到前台；你新建对话、粘贴发出去。Agent Deck 每轮扫描找这个 Agent 新出现、开头对得上的会话，找到就在那一项下面写 `🔗`、改成 `DELEGATED`，面板里的卡片飞进「现在」。等待中 Agent 卡片上会挂一行「等你在 WorkBuddy 里发出：…」，点 `×` 不等了；半小时没等到自动作罢。

Codex 会话用 `codex://threads/<id>` 在桌面版打开（同时把 `codex resume <id>` 放进剪贴板）；WorkBuddy 用 `workbuddy://chat/<id>`。

## Deeplink

| Agent | 链接 | 状态 |
|---|---|---|
| Claude Code | `claude://resume?session=<id>` | 可用 |
| WorkBuddy | `workbuddy://chat/<id>` | 仅用于 WorkBuddy 自身可识别的会话；独立 CodeBuddy CLI 会话不可直接导入 |
| DeepSeek Harness | `dsh://open` | 当前集成只唤起客户端并复制会话号；请在侧栏手动选择对应会话。 |
| Codex | `codex://threads/<id>` | 可用；同时复制 `codex resume <id>` |
| Antigravity | `antigravity://` | 打开客户端并复制会话号；不直接定位某条会话 |

## 状态 pill

这个 pill 是 CodeMirror 的 widget，只出现在已经绑定了会话或正在委派的行上，不是每个列表项都有。四个状态：

1. **准备中**，会话正在创建。
2. **委派中**，液体填充 + 已用时间 + `×`。
3. **等你 / 等你允许**，缓慢呼吸。
4. **完成 / 出错**，带打开或重试。

委派失败时，点状态 pill 上的「重试」打开参数面板。

## 使用前的运行依赖

Agent Deck 当前通过本机程序完成 Claude、Codex、DSH 和 Antigravity 的自动委派。对应程序缺失或不能运行时，这条自动委派路径不可用。程序可以由桌面应用自带，不要求所有用户都额外安装一份全局 CLI。通过远程 API 或 SDK 委派也可以不依赖本机 CLI，但本版本没有提供通用远程委派后端。

只读取已有会话日志、绑定任务、查看正文和归档正文，不需要启动 Agent CLI。AI 起名、总结、润色和 Dreaming 另需一个可用且已登录的 Claude 或 Codex CLI。

| 功能 / Agent | 当前实现 | 用户需要准备什么 |
|---|---|---|
| Claude Code 自动委派 | 启动 `claude` 无头进程或终端会话 | 安装并登录 Claude Code；需要桌面续聊时另装 Claude 桌面应用 |
| Codex 桌面模式 | 启动 `codex app-server` | 可用的 Codex 程序、登录及 Codex 桌面应用；插件优先寻找桌面应用附带的程序 |
| Codex 终端模式 | 启动 `codex` 交互会话 | 终端可执行的 Codex CLI，以及该程序使用的登录 |
| DeepSeek Harness 自动委派与插件内续聊 | 通过 Harness 执行任务 | 支持后台委派的 Harness 安装，以及有效的模型 / 提供商配置和登录 |
| WorkBuddy 交接 | 复制文字并打开客户端，由用户发送 | 国内版 WorkBuddy 桌面应用；本路径不调用独立 CodeBuddy CLI |
| Antigravity 自动委派与插件内续聊 | 通过 Antigravity CLI 执行任务 | 独立 Antigravity CLI（agy）及其登录；只安装 IDE 不够 |
| 自动日记、AI 润色、Dreaming | 调用所选 `claude` 或 `codex` CLI | 单独确认整理设置中的程序路径、登录和模型可用性 |
| macOS 菜单栏助手 | 首次在本机编译 SwiftUI 程序 | Xcode Command Line Tools 中的 `swiftc`；不使用菜单栏时可关闭该功能 |

### 安装与首次检查

只准备你要使用的 Agent，不需要把表里的程序全部安装。

1. 从官方渠道安装：[Claude Code](https://code.claude.com/docs/en/setup)、[Codex](https://developers.openai.com/codex/cli/)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[Antigravity CLI](https://antigravity.google/docs/cli/acp)。使用已发布的插件文件不需要运行 `npm install`；Node.js / npm 是从本仓库源码构建时的工具。Agent 自己的安装器若另有运行依赖，以其官方说明为准。
2. 在终端确认所选程序能运行，例如 `claude --version`、`codex --version`、`dsh --help`。Antigravity 应能运行 `agy --version`，并按官方流程完成 CLI 登录。程序不在 PATH 时，使用它的完整路径。Codex 桌面模式和 Harness 可以使用应用附带的程序。
3. 按所选 Agent 的官方流程完成登录或配置提供商。版本号检查不证明账号已登录、额度充足或模型可用。不要用一个客户端的登录成功推断另一个程序也已登录。
4. 在“设置 → Agent Deck → 委派”填写需要覆盖的程序路径。macOS 从图形界面启动 Obsidian 时，PATH 可能与终端不同；路径问题优先填写完整路径。整理和 Dreaming 使用“追踪”中的整理 CLI 配置，也要单独核对。
5. 先委派一个“只回复测试口令，不调用工具”的任务。收到回复后再测试第二轮、正文归档，以及需要时的桌面续聊。任务测试会调用模型服务；只有完整流程通过，才能确认该路径可用。

本版本设置中的“检查”按钮只验证程序和版本，不完成安装或登录。插件不会自动安装 Agent、修改 shell 配置、复制账号凭证或替用户登录。菜单栏缺少编译器时，可按系统提示运行 `xcode-select --install`。

### Antigravity 在插件内委派与续聊

1. 安装官方独立 CLI，并按官方流程完成登录。在“委派 → Antigravity”检查程序，必要时填完整路径（例如 `~/.local/bin/agy`）。
2. 点击“读取 Antigravity 可用模型”，按账号实际返回的模型选择。也可以使用“CLI 当前默认模型”；强度是否可用由当前模型校验，不支持时会明确报错。
3. 从任务的 `@antigravity` 菜单、纸飞机目标或 Agent 卡片委派。任务和子块直接发送，回复写回任务，并保存在插件委派记录中。
4. 点击该任务的会话按钮或对话入口，在 Obsidian 内查看正文、继续追问、停止当前一轮或归档。恢复使用原会话号；插件重载后仍可续聊。
5. 工具需要权限时会弹出工具详情和服务端选项。关闭弹窗视为取消本次请求。插件不会默认自动批准 Antigravity 工具。

原 IDE 会话继续使用原日志入口，不与 CLI 会话混用。插件内问答随插件委派记录保存在 `data.json`；需要长期保存时请“归档到笔记”，再使用“清理已结束的委派记录”。正文归档不含工具结果、内部推理或附件。

### WorkBuddy 的两个版本

国内版 WorkBuddy 使用 `~/.workbuddy` 和 `workbuddy://`；国际版 WorkBuddy AI 使用 `~/.workbuddy-ai` 和 `workbuddy-ai://`。当前插件的 WorkBuddy 读取器和打开入口按国内版配置，尚未提供国际版的独立入口。

2026-11-13 实测，独立 CodeBuddy CLI 登录后可以完成任务，但用该 CLI 的会话 ID 打开国内版 WorkBuddy，桌面日志返回 `conversation not found`。因此安装 CodeBuddy CLI 不能让当前 WorkBuddy 交接自动变为后台委派。国际版的同会话导入和续聊尚未验证成功，不能承诺可用。

## 安装

还没上社区插件市场。手动装：

1. 下载或 clone 这个仓库。
2. 把 `main.js`、`manifest.json`、`styles.css` 放进 `<库>/.obsidian/plugins/agent-deck/`。
3. 在「设置 → 第三方插件」里启用 **Agent Deck**。

从源码构建：

```bash
git clone https://github.com/MatsuriMW/obsidian-agent-deck.git
cd obsidian-agent-deck
npm install
npm run build
```

`npm run build` 用 esbuild 生成 `main.js`。`fzstd` 是打包进插件的 JavaScript 依赖，用来解 DeepSeek Harness 的 zstd 会话日志。用户无需单独安装它；Agent 程序和登录要求见“使用前的运行依赖”。

## 设置

按 **⌃⌥J（Ctrl + Alt + J）** 或点击“跳到正在做”，定位今天日记的“AI · 进行中”区域；未归组时定位首个运行中的任务。可在 Obsidian 快捷键设置中修改。

- **Agents**：开关每个 Agent、选最多两个主力、选择 Claude / Codex / DSH / Antigravity 的默认模型和默认委派目标、立即扫描、导入历史。主力星标控制追踪范围，与默认委派目标分别设置。
- **委派**：默认目标、模型、强度、权限模式、工作目录、提示词前后缀、写回规则、信任回退。
- **Models**：管理 Claude / Codex / DSH / Antigravity 的模型，可添加和编辑显示名、CLI 模型名、DSH provider route、上下文和能力标签，启用、置顶、排序，并分别设置默认模型与推理强度。可选模型取决于客户端账号；WorkBuddy 内的模型请在客户端选择。
- **追踪**：日记分界、轮询间隔、历史天数、macOS 菜单栏开关和条数、界面开关、重算、导入，以及一键「停用螺旋日程里的 AI 写入」。
- **关于**：版本、许可证、调试信息。

## 和螺旋日程并存

Agent Deck 认同一套 `🔗` 行。两个插件都开着时，螺旋日程也会看到 Claude 会话，可能把 `DELEGATED` 改成 `TOREVIEW`。

人机共写的 AI 写入（自动记日记、状态写回、`💬`、子会话 / side chat / subagent 子块、归档 → `DONE`）现在只在 Agent Deck 里做。只要螺旋的 AI 追踪还开着（`showAi` / `resultBack` / `agentKw` / `autoLog`），Agent Deck 就不碰日记，避免两套写法互相覆盖。

要完成交接：用 **追踪 → 停用螺旋日程里的 AI 写入**，然后到 Obsidian 设置里重新加载螺旋日程（或重启 Obsidian）。它只关自动记日记、状态写回、`💬` 和子块写入；螺旋的 AI 面板、螺旋、计时这些追踪展示照常。改之前会在旁边备份一份螺旋日程的 `data.json`。Agent Deck 不会自动启停别的插件。🤖 那一项也可以在同一个设置页恢复。

Agent Deck 会自动隐藏螺旋日程右下角的 🤖 Agent 汇总。

如果你在用 **块去向（done-to-top）** 和 **日记整理（journal-tidy）**，请更新到 **done-to-top 1.17.3+** 和 **journal-tidy 1.9.1+**。这两个版本会让带「明天 / 后天 / 大后天」的 `DELEGATED` 块留在今天的 DOING 区，不会搬到明天的日记；也不会再折叠第一条分割线之前的 DOING / TODO 块。

## 隐私

- 会话日志用 Node 的 `fs` 在本地读。
- 追踪部分不发任何网络请求。
- 委派和 AI 整理会启动本机 `claude` / `codex` / `dsh`。整理会将选定会话的标题、首尾片段和今日未完成任务交给对应 CLI，CLI 按其账号服务处理；纯追踪不调用模型。
- `usage.json` 只存按天的汇总和会话摘要，不存完整对话。
- 菜单栏助手只读 `~/.agent-deck/menubar.json`，不发网络请求。

## 常见问题

- **界面是英文，能换成中文吗？** 界面语言没有独立开关，跟着 Obsidian 走。把 Obsidian 的界面语言改成中文（设置 → 关于 → 语言），重载插件即可。
- **切换语言后菜单栏还是旧文字？** 菜单栏助手读的是插件下发的 `labels`。重载插件，或在设置 → 追踪里点一次「重启菜单栏」。
- **菜单栏没有图标？** 第一次启动需要 `swiftc`（`xcode-select --install`）。也可以在设置 → 追踪里点「重启菜单栏」，或者用 **⌃⌥⌘D** 直接唤出面板。
- **命令面板里只有 Agent Deck 的命令是英文？** 那说明 Obsidian 是英文界面而其它插件没有做本地化，属于其它插件的情况。
- **委派失败先查什么？** 先在该 Agent 的设置里点「检查」，确认程序路径和版本；再看是否已登录、模型是否可用。版本检查通过不代表登录成功。
- **写进笔记的时间早了或者晚了？** 检查「追踪 → 日记分界」，时段按分界点起的分钟数存。

## 发布与校验

Release 由 GitHub Actions 从对应 tag 构建；`main.js`、`manifest.json`、`styles.css` 带 build provenance attestation，可以用 GitHub CLI 校验：

```bash
gh attestation verify main.js --repo MatsuriMW/obsidian-agent-deck
```

## 反馈与后续

想追踪后续功能、反馈问题、关注后续进展，欢迎关注我的 Twitter：[@Matsurimywaifu](https://x.com/Matsurimywaifu)。

## 致谢

- 从[螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 拆出，日程仍然是它。
- 「进度长在触发按钮里」的交互参考小红书 [@ZZ.X 的《AI 任务进度，长在触发按钮里》](https://xhslink.cn/o/3gmyiCARRj2)。
- 分层模型设置页参考 [@ZZ.X 的《AI 产品模型设置》](https://xhslink.cn/o/AwW7VhnzX6m)。

## 许可证

MIT，见 [LICENSE](LICENSE)。

---

**English**: [README.en.md](README.en.md) — the same document in English.
