# Changelog

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
