# Changelog

## 1.13.36

- **Windows 进程树清理与 Antigravity CLI 长提示词传输修复（[`src/security.js`](src/security.js)、[`src/delegation-runners.js`](src/delegation-runners.js)、[`src/main.js`](src/main.js)、[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）**：
  - 修复 Windows 下 `killChildProcess()` 在异步 `taskkill /T /F` 尚未遍历进程树前就同步杀死父壳进程，导致 `.cmd`/`.bat` 孙子进程成为孤儿进程并长期占用 stdio 句柄卡死的问题；同步将 `spawnCapture()` 超时清理收口至 `killChildProcess()`。
  - 修复 `AntigravityRunner` 在 Windows `.cmd`/`.bat` 或超长/多行提示词下继续走命令行参数 `--print=...` 触发 `The command line is too long.` 且丢失换行的问题：改用官方 `agy --input-format stream-json --output-format stream-json` 从 `stdin` 发送 NDJSON `user` 事件。
  - 为 `primaryAgents()`、`agentEnabled()` 与 `spiralUsageSnapshot()` 增加重载窗口期空防护，避免螺旋日程在 Agent Deck 卸载/重载瞬间读取未初始化 `this.settings` 抛出 `TypeError`。
  - 为 `.github/workflows/ci.yml` 增加 `timeout-minutes: 15`，并在 [`test/antigravity-acp.test.mjs`](test/antigravity-acp.test.mjs)、[`test/security-trace.test.mjs`](test/security-trace.test.mjs) 与 [`test/next-round-fixes.test.mjs`](test/next-round-fixes.test.mjs) 补充回归测试。

## 1.13.35

- **全链路压测修复（[`src/styles/views/memory-graph.css`](src/styles/views/memory-graph.css)、[`src/memory-graph-view.js`](src/memory-graph-view.js)、[`src/journal.js`](src/journal.js)、[`src/context-core/mcp-clients.js`](src/context-core/mcp-clients.js)）**：
  - 修复浅色 Obsidian 下切至「星图」暗色模式时顶栏、缩放浮窗、检查抽屉按钮/来源条目泛白及长路径横向裁切的问题；筛选/搜索结果为 0 条时展示「没有匹配的记忆节点」与一键重置按钮，搜索/筛选切入自动重新适配相机，并支持 `Esc` 退出聚焦/关抽屉。
  - 修复 `extractTaskProgress()` 误把裸 URL 路径（如 `https://.../1/3`）或链接内 `%` 认作任务进度的问题。
  - 修复 Windows CI 上 `mcp-clients` `displayPath` 含反斜杠导致测试误报的问题，实现 Linux / macOS / Windows 全绿。

## 1.13.34

- **记忆知识图谱视觉与防重叠重构（[`src/memory-graph-data.js`](src/memory-graph-data.js)、[`src/memory-graph-view.js`](src/memory-graph-view.js)、[`src/styles/views/memory-graph.css`](src/styles/views/memory-graph.css)）**：
  - 修复高密度库节点与文字堆叠：引入屏幕空间层级显隐（LOD）与 AABB 碰撞剔除 + 磨砂胶囊标签（`shortLabel` 缩短至 14 字），大幅拉宽理想边长与斥力/防碰撞间距，缩小低度数概念菱形并移除待确认节点黑虚线边框。
  - 优化无项目归属记忆分布：聚类模式下无项目条目较多（`>= 12` 条）时按 `事实 / 偏好 / 经验 / 规律` 自动拆为语义群岛，力导向模式按类型扇区排布。
  - 拉开「编辑室」暖纸墨与「星图」深海星空观测站两种视觉风格的辨识度，并在画布右下角新增浮动缩放栏（`−` / `适配视野` / `+`）。
- **跨平台 CI 修复（[`test/mcp-clients.test.mjs`](test/mcp-clients.test.mjs)）**：
  - 修复 Windows Runners 上因 NTFS 忽略 POSIX `0o644` 权限位导致的 `resolveNodeBinary` 单元测试误报失败。

## 1.13.33

- **记忆图谱视图、Dream MCP 聚焦设置与会话计时双模式收口（[`src/memory-graph-view.js`](src/memory-graph-view.js)、[`src/memory-graph-data.js`](src/memory-graph-data.js)、[`src/settings.js`](src/settings.js)、[`src/autolog.js`](src/autolog.js)、[`src/sync.js`](src/sync.js)、[`src/journal.js`](src/journal.js)）**：
  - 新增全库「记忆图谱」独立标签页视图（命令面板 `Agent Deck: 打开记忆图谱`）与双套可切换视觉主题（有机墨迹星图 / 精密星图网格），支持按类型/核验状态过滤与跳回原笔记。
  - Dream MCP 补齐 `toolsMode`（9 工具 / 仅 `memory_*` 5 工具）、`allowWrite`、全库检索排除 AI 自动记录（`excludeAiLogs`）、O(1) 本地索引状态探测与外挂自动触发提示词编辑；设置页重构统一为 `this.row(...)` 双列对齐布局。
  - 统一螺旋日程与 Agent Deck 的 AI 追踪数据源（暴露 `agentCatalog()` 21+ Agent 与 `spiralUsageSnapshot()`），`showTimeRange` 默认采用与螺旋日程一致的「子块 `- ⏱` 实际用时」保留母块预计/预约对照，同时保留传统行首 `HH:MM-HH:MM` 可选开关，并以会话真实起止事件作为自动计时口径。
- **公共镜像块解析回写桥与任务进度承接（[`src/main.js`](src/main.js)、[`src/journal.js`](src/journal.js)、[`src/harness.js`](src/harness.js)）**：
  - 暴露 `resolveMirrorLine()` / `updateMirrorBlock()` 供螺旋日程统一解析与幂等回写 `- ![[笔记#^块号]]` 镜像条目。
  - 新增 `extractTaskProgress()` 并确保任务进度（`25%`、`进度 40%`、`1/3`、`一半` 等）在所有行改写中无损保留；委派上下文对 `1%–99%` 进度任务自动附加「基于已有进度继续」提示。

## 1.13.32

- **非侵入子块拖拽绑定与纯子块计时模式补齐（[`src/journal.js`](src/journal.js)、[`src/editor.js`](src/editor.js)、[`src/view.js`](src/view.js)、[`src/main.js`](src/main.js)、[`src/autolog.js`](src/autolog.js)、[`src/sync.js`](src/sync.js)、[`src/organize-journal.js`](src/organize-journal.js)、[`src/settings.js`](src/settings.js)）**：
  - 拖拽侧栏会话卡到已有日注/任务行，或在编辑器中拖放已有任务块（`nestTask` / `nestTaskLines`）时，默认**挂为缩进子块**，完整保留母块原文、双链与时段（支持同母块挂多会话及顶格 `🤖` 块无损整块迁入并自动剥离母块级加粗，保持母块视觉优先级）；按住 `⌥` 保留原 1:1 直接绑定或合并，`⌘` 在下方新建任务。
  - 补齐 `showTimeRange: false`（纯子块 `- ⏱` 模式）：`formatSessionTaskLine` 与 `planJournal` 不再把时段反写回母行，`AutoLog` 与 `JournalSync` 通过 `upsertClockLine` 在会话进行中实时维护子块计时。
- **大纲视图 Pin 视觉突出优化（[`src/styles/views/record-views.css`](src/styles/views/record-views.css)）**：
  - 为大纲模式与阅读视图中被 Pin 的关键轮次（`.ad-record-line--pinned` / `.ad-record-pinned`）补充柔和主题色底纹与序号徽章高亮，折叠后一眼可区分常驻的关键记录。
- **双语 README 与 Wiki 新增 AI 自动记录操作指南及实机演示视频（[`README.zh-CN.md`](README.zh-CN.md)、[`README.md`](README.md)、[`docs/wiki/Workflow-Markdown-Harness.md`](docs/wiki/Workflow-Markdown-Harness.md)、[`docs/wiki/Workflow-Markdown-Harness.en.md`](docs/wiki/Workflow-Markdown-Harness.en.md)、[`assets/ai-record-operations-demo.gif`](assets/ai-record-operations-demo.gif)）**：
  - 覆盖拖拽挂子块、`⌘⌥↓` 一键成组与多层递进子块、折叠展开与右键 Pin、表格/分形看板原地切换及 `⌃⌥L` 整理日志版面的完整操作说明与 60 秒演示。

## 1.13.31

- **新功能示例文档准确性与互动看板修复（[`src/welcome-demo.js`](src/welcome-demo.js)、[`test/showcase-flows.test.mjs`](test/showcase-flows.test.mjs)）**：
  - 逐项核对并修正三语示例文档中的 UI 设置路径与命令面板名称（记忆看板、`Dreaming → 记忆库工作区 → 图谱与库维护`、项目工作台 3 个入口、最长/最短记录时长、工作目录选区与 4 家按需 CLI/桌面回退助手边界）。
  - 修复互动看板示例中的 `NEEDOK?` 卡片写法为合法状态关键词 `NEEDOK`，对齐看板切换按钮文案，并在 `test/showcase-flows.test.mjs` 新增三语卡片解析、4 组 AI 记录视图提取与仓库配图资源存在性校验。

## 1.13.30

- **Windows CI 与临时工作目录识别边界修复（[`src/readers.js`](src/readers.js)）**：
  - 将系统临时目录过滤收敛到目录建议（`isTempPath`）与受信任目录筛选层，移除 `isScratchCwd` 对 `AppData/Local/Temp` 的硬编码拦截，修复 Windows（`windows-latest`）下基于系统临时目录运行 `ConfirmSendModal` 冲突选择与任务项目建议时的跨平台行为差异。

## 1.13.29

- **Dream 记忆全链路升级、图谱融合与检索提纯（[`src/dream.js`](src/dream.js)、[`src/memory-graph.js`](src/memory-graph.js)、[`src/memory-store.js`](src/memory-store.js)、[`src/memory-query-core.js`](src/memory-query-core.js)、[`src/memory-review.js`](src/memory-review.js)、[`src/memory-board.js`](src/memory-board.js)、[`scripts/memory-query.mjs`](scripts/memory-query.mjs)、[`scripts/memory-mcp.mjs`](scripts/memory-mcp.mjs)）**：
  - 接入 Bases 兼容 OKF v0.2 元数据与纯双链语义边（`concepts`、`project_link`、`source_notes`、`conflicts_with`、`supersedes`、`superseded_by`），支持 1–2 跳概念扩散检索、`<dir>/log.md` 变更日志、`记忆.base` 双向同步，以及基于关系图谱的短命题文件名生成与模型批量润色（`polishShortTitles()`）。
  - 优化记忆整理、审阅与生命周期：支持导入、批量确认、就地冲突裁决与残余边双向清理、超期/失效自动归档至 `<dir>/archive/` 及恢复、`.obsidian/graph.json` 双视角配色预设（按类型/可信度）、以及体检对库内可补锚 vs 外部导入免补锚和概念升格建议的分口统计。
  - 提升召回实用性与准确率：`scoreMemoryEntry` 增加多词覆盖加分并将未验证提案惩罚收紧至 `0.42`；`pickMemoriesFromEntries` 增加实质长句 MMR-lite 去重；非严格提炼路径拦截纯 AI 归纳的「尚未实施/待验证」过渡状态；新增 `recordHits()` 统计 `hitStats` 并在体检中呈现命中/零命中与过渡态统计；外围只读 CLI（`memory-query.mjs` v6）与 stdio MCP Server（`memory-mcp.mjs` v5）支持短双字中文词召回、`--project` 通用经验保留、符号链接调用兼容及 `archive/` 读取。
- **委派 / 派回工作区间统一与 Windows 路径 / 终端兼容加固（[`src/project-folders.js`](src/project-folders.js)、[`src/readers.js`](src/readers.js)、[`src/security.js`](src/security.js)、[`src/delegation.js`](src/delegation.js)、[`src/delegation-runners.js`](src/delegation-runners.js)、[`src/terminals.js`](src/terminals.js)、[`src/dialog.js`](src/dialog.js)、[`src/reply-modal.js`](src/reply-modal.js)、[`src/workbench-modal.js`](src/workbench-modal.js)）**：
  - 统一 `delegate`、`handoffCli`、`_performHandoff`、`continueSession`、工作台、草稿与 `ConfirmSendModal` / `ReplyModal` 的工作区间选择、最近目录过滤与「库根目录（`explicitVault`）」覆盖；断盘旧 `cwd` 支持按项目自动恢复。
  - 加固 Windows 长路径（`\\?\` / `\\?\UNC\`）、盘符大小写无关比较、`realpathSync.native` 联结/符号链接越界拦截、Codex TOML 转义可信目录解析、`.cmd`/`.bat` 的 `stdin` 传参、PowerShell UTF-8 终端启动脚本及 Vault 相对/反斜杠 `findMemory` 路径归一化。
- **升级后新功能示例文档刷新（[`src/welcome-demo.js`](src/welcome-demo.js)）**：
  - 将 `SHOWCASE_RELEASE_FLOOR` 升至 `1.13.29`，以通俗面向用户的语言更新中/英/繁三语「本期新功能（What's New）」卡片与试用入口（覆盖 1.13.14 → 1.13.29 的记忆图谱与审阅、多 AI 分批协作工作台、工作目录与拖拽派活、21 家助手与 11 家终端扩展），更新后首次打开自动呈现一次。

## 1.13.28

- **多 Agent 编排第三轮打磨、跨平台测试与阅读视图加固（[`src/project-workbench.js`](src/project-workbench.js)、[`src/main.js`](src/main.js)、[`src/harness.js`](src/harness.js)、[`src/delegation.js`](src/delegation.js)、[`src/sync.js`](src/sync.js)、[`src/steward-watch.js`](src/steward-watch.js)、[`src/fractal-board.js`](src/fractal-board.js)、[`src/workbench-modal.js`](src/workbench-modal.js)）**：
  - **跨平台 Windows CI 修复（[`test/project-workbench.test.mjs`](test/project-workbench.test.mjs)）**：修复工作台 `cwd` 断言在 `windows-latest` 下因 `normalizeProjectFolder()` 统一正斜杠与 `path.join()` 反斜杠不一致导致失败的问题。
  - **分批失败保护、直接执行指令与无缝恢复**：
    - 新增 `DIRECT_EXECUTE` 常量，勾选「跳过首轮反问确认」（`skipConfirmFirst: true`）时明确要求队员一次性交付并在 [`src/background-output.js`](src/background-output.js) 中纳入归档剥离规则；未勾选且队员提出 `❓` 疑问（`job.awaitingReply = true`）时将子卡置为 `NEEDOK` 并暂停波次推进，支持同会话续聊、桌面端新轮次自动解锁以及看板右键「重新派发（新会话）」携带 `✍️ 答：` 接力恢复（[`src/main.js`](src/main.js) `onWorkbenchJobSettled` `onlyIfKeywords` 补入 `"NEEDOK"`）。
    - 分批波次任一队员失败时保持 `queuedStages` 队列不清空、暂停在 `error` 态支持一键「重派失败项」（重派时保留前序阶段 `upstreamReports` 并按最新 `blockId` 定位行号）或点击「跳过失败继续第 N 批」；全部失败时暂停而不浪费一次管家调用；`dispatchBoardGroup` 为未指定子卡自动分配健康已装 CLI 的 Agent，并在旧波次处于 `error` 态时允许重新挂载新管家；`finalizeStewardWave` 自动续派补齐后台 `destination`；`dispatchWorkbenchTasks` 按 `blockId` 解析最新行号防行漂移。
  - **归档摘要提取、多链状态不回跳与管家自检**：
    - `extractBlockResultText()` 同步兼容 Obsidian 双链 `[[...Answers/*.md|...]]` 与 Markdown 链接，按 `<!-- ad-turn:... -->` 隔离会话并经 `vaultPath` 解析出 `answerAbsPath` 传给后批队员与管家；`JournalSync.keywords()` 对同块多条 `🔗` 采用 4 级主链接优先级，避免重派后旧出错会话把进行中/已完成子卡回写成 `ERRORED`；`judgeWave()` 在 `wave.state === "running"` 时同步巡检管家自身是否卡住。
  - **看板阅读态与工作台弹窗体验优化**：
    - 分形看板只读视图（`.ad-board-wrap--readonly`）彻底隐藏交互控件与选区工具栏、禁掉拖拽/`<select>` 与右键菜单，改以静态 Agent 标签展示；工作台 `extractGoalFromBlock()` 打开已有看板时不把历史 `DONE`/`TODO` 子卡、`@agent` 与块号混入目标框，派发前校验 `cwd` 是否真实存在，并将任务条拆分为宽标题顶行与下方 `.ad-wb-task__meta` 参数行及粘底操作栏（[`.ad-wb-foot`](src/styles/views/modals.css)）。

## 1.13.27

- **项目协作工作台、分批多 Agent 编排与管家闭环全链路修复与升级（[`src/workbench-modal.js`](src/workbench-modal.js)、[`src/project-workbench.js`](src/project-workbench.js)、[`src/fractal-board.js`](src/fractal-board.js)、[`src/main.js`](src/main.js)、[`src/harness.js`](src/harness.js)、[`src/cli-env.js`](src/cli-env.js)）**：
  - **阻塞级 Bug 修复**：修复打开工作台 `ReferenceError: p is not defined`、看板「派发 TODO」`ReferenceError: view is not defined`、追加子任务到已有母块缩进丢失与结尾空行破坏嵌套、AI 拆解误走 30s `polish` 短超时及跨供应商串模（如 `gpt-6-luna` 漏给 DeepSeek/Antigravity）、小队与管家委派被旧 `@mention` 误拦截、`worker.blockId` 未回传导致管家结束后无法推进队员至 `DONE`、以及进程 exit 0 但正文为限额/供应商错误的回复被误标 `DONE` 等问题；同步加固 `liveSessions()` 空防护。
  - **多批依赖（Wave）与自动上游接力**：工作台与 AI 副驾拆解支持 `第 1/2/3 批` 编排；前批全部完成后由 `advanceWaveToNextStage()` 自动携带前批结果摘要（`upstreamReports`）拉起下一批，全员失败时暂停并转交管家/看板恢复；卡片与管家委派默认可勾选「跳过首轮反问确认」（`skipConfirmFirst`）。
  - **就绪感知配队、文件冲突预检与一键错峰**：接入 `uninstalledAgentsFor()` 自动绕过未安装/限额 Agent 并在健康 Agent 间均衡分工；新增拆解模型下拉切换（显示自动解析模型 + 1 次 JSON 修复重试 + `⌘/Ctrl+Enter` 快捷键）、`extractScopeTokens()` / `detectStageScopeOverlaps()` 同批文件重叠预警与「一键错峰排批」、目录/非健康 Agent 预检与「一键替换为可用 Agent」，以及无失焦局部刷新（`updateActionCounts()`）。
  - **分形看板排批感知、失败自愈与完成总结条**：待接力后批卡展示「第 N 批待接力」且不重复计入「派发 TODO」；新增 `syncWaveWithState()` 按 `blockId` 接管同卡新会话重派、错误栏一键「重派失败项」（限额/未装 CLI 自动换角并改写 `@agent`）、右键「换 Agent 重新派发（新会话）」、切换管家 Agent 重试汇总，以及可收起的波次完成总结条（`findBoardWaveBanner()` / `dismissWorkbenchWave()`）。
  - **底层 GUI 环境统一**：提取无环叶子模块 [`src/cli-env.js`](src/cli-env.js) 统一管理 GUI `PATH`、macOS/Windows 系统代理与 `cleanEnv()` 供 [`src/delegation-runners.js`](src/delegation-runners.js)、[`src/codex-desktop.js`](src/codex-desktop.js) 与 [`src/llm.js`](src/llm.js) 共用，并补充 ChatGPT.app 内嵌 `CodexCLI.app/Contents/MacOS/codex` 路径。

## 1.13.26

- **新增 Trae（Trae CN / 国际版）全链路 Hooks 追踪与委派（内置总数增至 21 家，`USAGE_CACHE_VERSION = 25`，`HARNESS_DETECTION_VERSION = 5`）**：
  - 新增 [`src/trae-sessions.js`](src/trae-sessions.js) 与 `assets/agents/trae.png`，遵循 `version: 1` `hooks.json`（`~/.trae-cn/hooks.json` / `~/.trae/hooks.json`，工具事件使用 Rust 合法正则 `matcher: ".*"`）被动只读采集 8 类生命周期事件至 `~/.agent-deck/trae-events/*.jsonl`（绝不解密加密 `database.db`），支持 `watchTraeEvents()` 实时监听、`scanNow()` 延迟补挂、对话与工具时间线还原、`security-audit.js` 提取（保留 `d.at` 时间戳）、首次运行弹窗提示与一键安装/更新/卸载，以及 `traecli acp serve` 后台委派 / 桌面端复制唤起回退。
- **修复已完成子代理子块随父块「更多 / 收起」折叠与 Orca `delegatedOwners` 去重污染**：
  - [`src/ai-records.js`](src/ai-records.js)、[`src/fold-actions.js`](src/fold-actions.js)、[`src/sync.js`](src/sync.js) 等修复父任务下已完成纯记录子代理子块被拆出父块记录组导致无法折叠的问题，并统一将 `state === "error"` 子代理回写为 `FAILED`。
  - [`src/desktop-sessions.js`](src/desktop-sessions.js) 修复 `orcaDelegatedSids` 解析 `provider_turn_id` / `item_id` 时将裸 Turn UUID 与原始 item ID 写入 `delegatedOwners` 的污染问题（经真机 Orca `agent-session-domain.db` 实测验证），仅提取真实底层原生会话/线程 ID。
- **设置页客户端边界提示与 GitHub Wiki 同步**：
  - 在设置页「委派」与「记录」卡片补充客户端不支持委派及前置安装/配置开关提示与可点击的 [GitHub Wiki（支持列表与前置要求）](https://github.com/MatsuriMW/obsidian-agent-deck/wiki/Supported-Agents-and-Models) 外链，并更新中英文 Wiki（含 Trae 前置开启「全局 Hooks」/「本地自动运行」指南及最新 21 家矩阵）。

## 1.13.25

- **全 Agent 已归档会话重新激活恢复追踪（[`src/readers.js`](src/readers.js)、[`src/autolog.js`](src/autolog.js)、[`src/sync.js`](src/sync.js)、[`src/organize-journal.js`](src/organize-journal.js)、[`src/journal-archive.js`](src/journal-archive.js)、[`src/task-status.js`](src/task-status.js)、[`src/main.js`](src/main.js)）**：
  - 新增统一 `AgentUsage.isArchived(sid)`（汇总 `archived` / `archivedClaude` / `meta.archived`，补齐 Cursor 与 Kimi Code 双向归档同步），修复 WorkBuddy `workbuddy.db` 中云端非删除哨兵 `deleted_at = -1` 误判为已归档的问题（改为 `coalesce(deleted_at, 0) > 0`），并支持在强扫（`scanNow(true)`）与「整理日志版面」（`organizeJournal()`）前跳过 15 秒缓存节流即时刷新归档状态、差量维护 `_auxArchived` 避免覆盖桌面库归档集。
  - 统一追踪 `archivedDone` / `archivedOut` 与完成锚点（`doneAtMin` / `doneEndMs` / `doneRounds`），修复同日 `DONE`、被「归档已完成的日志到…」移出日记（`rec.gone`）、`🔗` 链接会话（含多会话联合任务与 `organizeJournal()` 归档条目）以及跨日已归档/已完成会话在取消归档或续聊后不再写回日记的问题；保留人工 `DONE` 锁、真跨夜进行中会话与 Grok Bot 闲置分段规则，并新增 [`test/reactivated-archived-sessions.test.mjs`](test/reactivated-archived-sessions.test.mjs)。

## 1.13.24

- **新增 Orca 桌面版只读追踪与底层分发会话去重（内置总数增至 20 家，`HARNESS_DETECTION_VERSION = 4`）**：
  - 新增 [`src/orca-sessions.js`](src/orca-sessions.js) 与 128×128 图标 `assets/agents/orca.png`，只读解析 Orca Electron `userData` 下 `agent-session-domain.db`（支持 `ORCA_DATA_DIR` / `ORCA_USER_DATA_DIR` 测试隔离），在 [`src/harness-detect.js`](src/harness-detect.js) 通过 `appSub` 派生 `Orca.app/Contents/Resources/bin/orca` 与应用/数据探测，并补齐 `orca://` 唤起、日记块号前缀与短链解析、离线安全审计、macOS 菜单栏与中英繁文案。
  - 在 [`src/desktop-sessions.js`](src/desktop-sessions.js) 实现 Orca 会话与消息解析（支持 `launchDirectory` 及从 `location.workspaceId` `<repoId>::<path>` 提取 `cwd`、过滤 `role="reasoning"`、失败轮次状态回退、以内容与轮次时间戳作为 `revision`/`updatedAt` 锚点避免 lease 心跳导致重复扫描），并通过 `orcaDelegatedSids`（读取 `adopted_native_id` 与 `providerHandleChain[]`）及 `orcaOwnerOf`（[`src/readers.js`](src/readers.js)）接入统一 `delegatedOwners` 去重体系，自动屏蔽底层拉起的 Antigravity / OpenCode / Claude Code / Codex 原生重复会话，关闭 Orca 开关时即时恢复底层会话。
- **Kimi Code v2 会话解析升级与 `kimi acp` 后台委派（`USAGE_CACHE_VERSION = 23`）**：
  - [`src/kimicode-sessions.js`](src/kimicode-sessions.js) 兼容 Kimi Code v2 目录结构（`agents/main/wire.jsonl` 及自定义子代理目录）、`projects.json` 工作区映射、`profile.bind` `modelAlias` 与 `step.end`/`usage.record` token 去重。
  - [`src/agent-registry.js`](src/agent-registry.js)、[`src/delegation-runners.js`](src/delegation-runners.js)、[`src/constants.js`](src/constants.js) 解除 Kimi Code 仅追踪限制，新增 `kimi acp` 后台委派、`EFFORTS.kimicode`（`low`/`high`/`max`）推理强度、`handoffFallback: true`、`continueRequiresAcp: true` 与应用内同会话续聊。
- **Antigravity（`agy acp`）委派卡死修复与 Windows 代理 / 可执行文件兼容加固（`src/delegation-runners.js`、`test/antigravity-acp.test.mjs`）**：
  - 新增 `parseWindowsRegProxy` 读取 Windows 系统代理，补全 `extractAcpText` 兼容块数组文本、首行 BOM 剥离、子进程 `close` 排水与超时/异常透出脱敏 `stderr`，补充 Windows `agy.exe`/`agy.cmd` 候选路径与 `windowsHide: true`，并新增 `test/antigravity-acp.test.mjs` 与 `test/orca-sessions.test.mjs` 回归测试。

## 1.13.23

- **无序 / 有序 / 复选框列表块拖动委派全链路与 `bullet` 插件桥接（`src/editor.js`、`src/delegation.js`、`src/main.js`）**：在编辑器扩展中自动注册 `installListDragBridge`，同时支持第三方 `bullet` 插件拖拽与 Obsidian 原生 `.cm-formatting-list` / `.list-bullet` 拖拽，将无序（`-`/`*`/`+`）、有序（`1.`/`2)`）及复选框（`- [ ]` / `1. [ ]`）列表块拖至侧栏 Agent 卡片委派或会话卡片绑定；捕获阶段在拖入侧栏释放前同步 `mousemove` 清零 `bullet` 落点，防止快速甩出时误改原笔记，并在切至非列表行时同步清理 `.ad-grip` 残影，明确拖放或多 `@` 冲突时以目标卡片为准。
- **13 家内置 + Custom ACP 委派/交接全覆盖（`src/agent-registry.js`、`src/workflow.js`、`src/custom-acp.js`、`src/delegation-runners.js`、`src/journal.js`、`src/dialog.js`）**：新增 `canDelegateDrop(id)` 与 `agentDropMeta` 单源判定，补齐 `gemini` 终端交接与 `isCliSession`、修复 `t3code` 应用内续聊路由到 `T3CodeRunner` 并补全缺失可执行文件时的 `ENOENT` 本地化提示、`DelegateOptionsModal` 的「桌面版 / CLI」提示、Custom ACP 的 `soft` 配色与 `destinations` / `defaultDestination` / `obsidian://agent-deck` 短链往返解析，以及 `markDelegated` 前缀截断修复。
- **不可委派卡片灰显拦截与流程加固（`src/view.js`、`src/styles/views/dashboard-cards.css`、`src/task-mentions.js`）**：对 6 家 `trackingOnly`（千问办公 / Grok Bot / Cindy / Muse / Kimi Code / 豆包工作）及尚未认领真实 `sessionId` 的待认领任务卡片标 `.is-no-drop`，拖拽期间统一灰度降暗（`grayscale(1)`、`cursor: not-allowed`）、屏蔽子节点指针穿透并在悬停时展示中性「暂不支持委派」提示后拒绝落放；同步延后拖拽期间的侧栏 DOM 重建、修复 `.ad-sess.is-drop` / `dragleave` 状态残留、`onunload` 清理 `T3CodeRunner` 与拖放监听，并对 `parseLink` 与悬停热路径做去重和快速退出优化（`test/drag-delegate.test.mjs`）。

## 1.13.22

- **块首全小写任务状态词识别与渲染（`src/journal.js`、`src/keyword-style.js`、`src/task-status.js` 等）**：块首关键词支持全大写与全小写两种写法（如 `todo` / `doing` / `done` / `later` / `now` / `waiting` / `paused` / `in-progress` / `canceled` / `toreview` / `needok` / `todoforai` 等），同步覆盖编辑视图配色与图标、阅读视图（保留原文小写展示）、点击状态切换菜单、批量改状态、`⌘⇧D` 标记完成、日记整理/归档/同步、进度条、AI 记录图标、Pin 与 Dreaming 证据分类；严格要求词边界且不匹配首字母大写的普通英文词（如 `Now` / `Wait` / `Later` / `Failed`）或前缀粘连词（如 `nowhere` / `todolist`）。

## 1.13.21

- **Cindy 实机全链路验证与项目名归口（`src/readers.js`、`USAGE_CACHE_VERSION = 22`）**：基于真实安装的 `Cindy v0.1.144`（macOS arm64）完成端到端实测，覆盖活跃 WAL SQLite 精确读取（95,672 tok 零偏差）、Codex / `~/.claude/projects` 跨库底层会话实时去重、只读对话详情与 `cindy://session/<id>` 深链直达；新增 `CINDY_DIALOGUE_RE` 将 `Cindy/owners/<hash>/dialogues/...` 纯对话工作区归类为临时目录并由 `projectName()` 统一显示为 `"Cindy"`（不再把会话 UUID 暴露为 `dir` 标签）。
- **重新检测 Harness 自动补扫历史（`src/main.js`）**：`redetectHarnesses()` 检出新增或移除的已安装客户端时，改以 `force = true` 触发强制全量扫描（并提前展示结果通知），避免新装客户端的已有会话因 `lastScan - 60000` 增量窗口而被跳过。
- **跨平台测试修复（`test/cindy-sessions.test.mjs`、`test/harness-detect.test.mjs`）**：修复 `cindyDataDirs` `darwin` 用例在 `windows-latest` 下因缺少 `path.resolve(...)` 导致的路径断言失败，并补齐 Cindy 对话目录与 `redetectHarnesses` 强制扫描单测。

## 1.13.20

- **新增 TeleAgent（星辰超级智能体）追踪与桌面交接（合并 PR #12 + 加固修复，`src/teleagent.js`、`src/teleagent-dispatch*.js`、`src/desktop-sessions.js`）**：支持从多账号 `teleagent.db` 只读追踪会话与逐轮用量（自动剥除附件绝对路径），支持 Windows UI Automation / Linux `xdotool`（含可选 `treeland-activate`）桌面填入派发并回读确认；修复 `src/editor.js` `dropField` 参数命名遮蔽 `tr` 的拖拽高亮崩溃、SQLite 超时与只读事务约束，以及 `menubar.swift` / 样式 / 安全审计 / 文档断链。
- **新增 Cindy（`cindy`）只读会话追踪（内置总数增至 19 家，`USAGE_CACHE_VERSION = 21`，`HARNESS_DETECTION_VERSION = 3`）**：新增 `src/cindy-sessions.js` 与 128×128 图标，只读解析 Electron `Cindy` / `CindyGlobal` / `xdt-maker` 目录下 `cindy-*.db` / `xdt-maker-*.db`，支持 `'New Maker'` 标题剥除、`worktree_path > project_dir > working_dir` 优先级、`orca_workers`/`bot_delegations` 层级区分用户 Fork、`turnUsageDetails` 同轮优先防重复计费、`cindy://session/<id>` 深链回退唤起客户端，以及工具调用安全回放。
- **T3 Code & Cindy 统一聚合去重体系（`delegatedOwners`、`src/readers.js`、`src/desktop-sessions.js`）**：扩展 T3 Code 6 张投影/运行时表（含 `:native-thread:` 解码并过滤 URL 编码 `pending%3A...` / `provider-instance:` 占位符）及 Cindy 5 源映射，在 `summary()`、侧栏「现在」/最近会话、菜单栏、自动日记、`JournalSync`、`DashboardData`、`resolveHandoffs`、主力推荐、设置页卡片统计（含 `mergeDelegatedOwners` 分卡片扫描合入与重建清理）及安全审计全链路统一去重底层拉起的 Codex / Claude / Antigravity 会话；设置页 T3 Code / Cindy 卡片展示已去重会话数与「关闭可随时恢复」提示。
- **SQLite WAL 只读打开修复（`src/desktop-sessions.js`）**：无非空 `-wal` 伴生文件时改用 `?immutable=1` URI 只读打开，修复 checkpoint 后的 WAL 数据库报 `unable to open database file (14)` 故障；有非空 `-wal` 时先 `-readonly` 并在缺失 `-shm` 时回退 `PRAGMA query_only = ON;`。
- **日记圆圈数字与 Agent 小图标光学对齐及 UX 抛光（`src/record-icons.js`、`src/styles/views/record-views.css`、`src/journal.js`）**：内层数字 `.ad-round-badge__num` 启用 `text-box-trim` 在 `16×16` 正圆内居中、`top: -0.15em` 与行内正文对齐、轮次提示与无障碍标签双语本地化（`第 {n} 轮` / `Round {n}`）；补齐 `T3 Code` / `Muse` / `Kimi Code` / `豆包工作` / `Gemini CLI` 短链标题前缀剥离。

## 1.13.19

- **Cursor 后台委派（ACP）与桌面端交接回退（`src/agent-registry.js`、`src/delegation-runners.js`、`src/delegation.js`、`src/settings.js`、`src/workflow.js`、`src/main.js`）**：解除 Cursor `trackingOnly` 限制，支持 `agent acp` 后台委派与应用内续聊（`cursor-default`、`continueRequiresAcp` 保护桌面会话），未装 CLI 或选择桌面端时自动回退桌面交接并由 Hooks 认领写回；设置页统一表驱动渲染 Cursor/Gemini 等 ACP 卡片；`allModels()` 动态聚合 ACP 拉取的模型列表；`cleanEnv()` 在 macOS GUI 下经 `scutil --proxy` 自动继承系统代理；`checkBinary` / `openAgentApp` / `openExternal` 补齐跨平台兼容修复。
- **全 Agent 子代理统一排除独立日记任务（`src/readers.js`、`src/agent-ingestors.js`、`src/cursor-sessions.js`、`src/autolog.js`、`src/sync.js`、`src/delegation.js`）**：新增 O(1) `isSubagentSession()` / `subagentSids` 与 `cursorParents` 缓存持久化，修复 Claude Code 子文件误杀母会话问题，补齐 Codex / DSH / Cursor 全量父子标记；`CURSOR_HOOK_VERSION` 升至 `2` 并在启用监听时自动静默升级过期 `v1` Hook；`AutoLog`、`JournalSync` 与 `resolveHandoffs` 统一跳过子代理。
- **豆包工作跨端会话发现与 Muse 追踪收尾（`src/doubaowork-sessions.js`、`src/muse-sessions.js`、`src/readers.js`）**：豆包工作新增多 Profile / Windows `%LOCALAPPDATA%` 路径发现、V8 数值时间戳（Int32/Double）解析与按目录防碰撞会话键，`USAGE_CACHE_VERSION` 升至 `20`；Muse 新增 `watchMuseCache()` 文件监听、默认过滤主动推送消息（`museTrackProactive` + 多气泡回复链追踪）并将默认 `autoLogMinMinutes` 调为 `1` 分钟。

## 1.13.18

- **AI 自动回传日志视觉与格式升级（`src/journal.js`、`src/record-icons.js`、`src/styles/views/record-views.css`）**：
  - 简略模式记录的「任务」「结论」关键词改为 Markdown 加粗（`**任务**：…；**结论**：…`），并对历史未加粗记录在编辑/阅读视图中同步视觉加粗（不改写旧笔记原文）。
  - AI 结论行（含第 1 轮）去掉 `💬` 统一写为 `- 第N轮：…`（`❓` 提问行与 `💬 累计总结：` 保持原样），编辑与阅读视图将新旧格式的 `第N轮：` / `💬 第N轮：` 统一渲染为中性黑灰色圆圈数字 icon（`.ad-round-badge`）。
  - 任务行中的 `🤖` 在编辑与阅读视图中自动按 `^blockId` 前缀、`🔗` 链接、`⏱` 尾注与 `autoLogState` 推断所属 Agent，渲染为对应 Agent 的官方桌面 App 小图标（`.ad-agent-mark`，无法识别时保留 `🤖`）；解析层、折叠与四视图投影完整兼容新旧格式。

## 1.13.17

- **表驱动主力终端注册表扩展（`src/terminals.js`）**：将主力终端列表从 5 家扩展至 **11 家 + 自动**，新增 **cmux**、**tmux**、**Ghostty**、**WezTerm**、**Kitty**、**Alacritty** 支持，并补齐 Windows `wt.exe`/`cmd.exe` 回退；`tmux` 在 `auto` 模式下仅在检测到活跃 CLI 会话位于 `tmux` 内时命中（不抢占默认终端），支持 `tmux` 与 `WezTerm` 窗格级焦点切换；同步修复设置页终端快捷按钮（`openTerminalAt`）未读取 `cliTerminal` 的问题。
- **双语 README 切换与视觉升级**：默认 `README.md` 切换为英文正本并新增深色 Hero Banner，中文文档迁至 `README.zh-CN.md`，同步更新 Wiki 与安装脚本引用。

## 1.13.16

- **Antigravity CLI 会话追踪与内置 Gemini CLI ACP 委派**：支持追踪 `antigravity-cli` brain 会话，并为内置 Gemini CLI 启用 `gemini --acp` 后台委派与续聊。
- **Windows 兼容修复**：`execCapture` 改走跨平台 `spawnCli` / `killChildProcess`，修复 Windows 下执行 `.cmd` 报 `spawn EINVAL` 及定时器泄漏问题。
- **文档与 CI/发布流水线维护**：补齐英文 GitHub Wiki 页面与双语切换，在 README 明确第一阶段目标（Milestone 1：成为有效的 AI 上下文提供者），并将 GitHub Actions 升级至 Node 24 运行时。

## 1.13.15

- **新增 3 家内置 Agent 只读追踪（内置总数增至 17 家）**：
  - **Kimi Code**：只读解析 `~/.kimi-code/sessions/<wsHash>/<sessionId>/wire.jsonl`（v1.5 协议，支持 `KIMI_CODE_HOME` 与 `~/.kimi/sessions` 回退），联读 `session-meta/state.json`（自定义标题、归档状态、模型）和 `workspaces.json`，精确统计逐轮 Token 与工具调用，支持只读对话详情与桌面端唤起。
  - **豆包工作（Doubao Work）**：零依赖扫描 `~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb`（含 `.log` 与 Snappy 压缩 `.ldb` 块中的 V8 Structured Clone 会话列表元数据），支持唤起桌面端；严格不解密本地加密库 `sdk_storage`，Token 诚实显示「用量未提供」。
  - **Gemini CLI**：只读解析 `~/.gemini/tmp/<projectSlug>/chats/session-*.jsonl`（兼容旧版 `session-*.json`），支持 `$set` / `$patch` / `$rewindTo`、自动剥离 `<session_context>` / `<hook_context>` 注入块、精确统计 Token（含缓存与思考 Token），并支持终端 `gemini --resume` 续聊。
  - 同步 3 家官方/定制 128px 图标、本机 Harness 自动探测、macOS 菜单栏样式与中英繁文案；解析缓存版本 `USAGE_CACHE_VERSION` 递增至 `18`。
- **README 精简与 GitHub Wiki 体系**：中英文 README 明确核心定位「以 Markdown / 大纲 / 日记为正本的多客户端 AI 总控台 + 长期记忆闭环」，突出主流模型全覆盖与中文 Agent 客户端生态适配；将详细支持矩阵、按需依赖与已知边界迁入 `docs/wiki/`（7 篇完整用户文档）。
- **GitHub 自动化增强**：新增 `docs/wiki/**` 自动同步到 GitHub Wiki 的 Workflow（`sync-wiki.yml`）、结构化 Bug / 新 Agent 适配 Issue 表单模板与 Dependabot 周检配置。

## 1.13.13

- **支持 T3 Code（追踪 + `t3` CLI 委派 + 转发去重）**：只读解析 `~/.t3/userdata/statev2.sqlite`（支持 `T3_DATA_DIR` / `T3_STATE_DIR` 与 v1 `state.sqlite` 回退、逐轮 `turnTokenUsage`、工作树 `worktreePath`、子代理 `lineage` 与归档态）；支持经 `t3 thread start` / `t3 thread send` 后台委派与应用内续聊（未登记目录自动 `t3 project add`）；自动记日记时按 T3 Code 绑定表去重底层被转发的 Agent 会话，统一收录在 T3 Code 下不重复记录。
- **支持 Muse 分对话流只读追踪**：读取 `~/Library/Caches/ConversationCache/*.json`（换算 Apple `CFAbsoluteTime`、提取 `contentBlocks` 与 `optionWidget`），云端 VM 诚实显示「用量未提供」；支持按对话流多选追踪（默认追踪 `hatch-main` Main Chat，上限 `museMaxTracked = 5`），设置页提供勾选器；同步 T3 Code 与 Muse 官方图标、菜单栏配色与中英繁文案。
- **离线历史安全回放与白名单闭环**：新增命令 `安全：回放最近 30 天会话的工具调用并生成审计报告` 与 `安全：快速回放最近 7 天会话并生成审计报告`，基于 `security.js` 离线复盘 12 家客户端（含 Antigravity、DSH zstd）历史工具调用，自动降噪 `/tmp` 与常见构建目录，生成脱敏报告 `Agent Deck/安全审计.md`；支持在报告 frontmatter 修改 `days` / `agent` / `ignore_temp_noise` / `allowlist` 并自动同步到 ACP 实时护栏（明文密钥永不放行）。
- **按任务跨多会话 / 多 Agent 用量与活跃时长聚合**：同一任务块绑定多个 `🔗` 会话时，编辑器 pill/token 徽标合并展示总 token、去重真实活跃时长与会话数（`×N`），悬浮展示各 Agent 分项明细。

## 1.13.12

- **支持 MiniMax Code 客户端与 `mcode` CLI**：只读解析 `~/.minimax/v2/sqlite/runtime-state.sqlite`（支持 `MINIMAX_DATA_DIR` / `MAVIS_DATA_DIR` 与 `~/.mavis` 回退、v2 消息行与旧版消息回退、逐轮 token 与模型、工作区路径、归档与父子会话），支持本机自动探测（`MiniMax Code.app`、`mcode` CLI、`~/.minimax`）、`mcode acp` 后台委派与应用内续聊、终端 `mcode --session` 续聊及桌面端唤起；同步官方图标、设置页卡片、菜单栏配色与中英繁文案。
- **繁体中文（`zh-TW`）界面支持与日记整理布局优化**：补齐繁体中文语言包并增强日记分区布局与自动记录兼容。

## 1.13.11

- 手动重扫本机会话后整理今天的日记，并显示扫描和写入结果。旧日记里的自动记录可以跨天打开原会话，重扫期间保留跳转入口。
- 自动记录和绑定任务使用同一套起止时间规则。会话运行时，标题时段更新到刷新时间。会话停止后，结束时间取最后一条日志事件。
- 自动定位日记时读取 Obsidian 核心「日记」设置。修改设置后，下次定位即生效。与螺旋日程同时启用时，沿用它的日记分界。
- Dream 采集跳过私密笔记和排除目录，并提供供后续主题与用语分析复用的材料入口。

## 1.13.10

- **右键菜单里的默认模型名改成短写法**：`antigravity-default` / `dsh-default` 这类「不传模型参数、用客户端自己的默认」的占位符原来直接显示目录全名，标题会变成「委派（DSH · 不指定（使用 DSH 当前默认模型））」这种括号套括号。现在统一显示 `CLI 默认`：`委派（Antigravity · CLI 默认）`、二级菜单里也是 `DSH · CLI 默认`；真指定了具体模型时仍显示型号名。

## 1.13.9

- **编辑器右键菜单补上委派**：上一版只把委派放进四视图／阅读视图的行菜单，源码行右键仍只有 Pin 与记录操作。现在光标所在那一段（任务行、`💬`／`⏱`／`🔗` 回传日志、普通段落）右键就出 `委派（Agent · 模型）` 与 `委派并选择模型 ▸` 两项，和行尾纸飞机、视图行菜单共用同一份实现（`addDelegateMenuItems`）。

## 1.13.8

- **委派箭头跟着光标走，回传的日志可以再派出去**：箭头不再限定「列表项 + 任务关键词／记录前缀」——光标停在哪一段，行尾就出纸飞机，母块行、`💬`／`⏱`／`🔗` 回传日志、普通段落一视同仁；不带列表标记的段落整行当一项发（`paragraphBlock`）。同时修掉一个真 bug：箭头原先加在行首装饰之前，光标停在 `💬` 行上会抛 `Ranges must be added sorted by 'from' position and 'startSide'`，把整层编辑器装饰（箭头、状态药丸）一起打掉，看着就像「箭头没了，只剩钉子」。
- **四视图与阅读视图的行改成右键菜单**：表格／卡片／时间线／阅读视图的记录行去掉行内 📌，右键某一轮即出现 `Pin 为关键记录`／`取消 Pin`、`委派（Agent · 模型）`（直接按默认 Agent + 默认模型派）与 `委派并选择模型 ▸` 二级菜单（列出已启用 Agent 的启用模型，点哪项就派给那个模型的 Agent）。派发内容是该轮记录（连同子块），沿用原来的确认弹窗；编辑器源码行尾也不再放 📌。
- 设置里「列表项尾巴上的把手」更名为「段落尾巴上的小箭头」，说明同步改成段落口径。

## 1.13.7

- **`TOREVIEW` 关键词配色柔和化**：将 `TOREVIEW` 从高警示的红→黄渐变改为低饱和、清新的纯雾青色（`#6fa9b8`），图标颜色同步更新；因为 `TOREVIEW` 仅表示需要看一眼而未必需要决策，降低视觉打扰并同步联动螺旋日程块颜色。

## 1.13.6

- **非 macOS 平台菜单栏入口收口**：Windows / Linux 隐藏设置页中的「macOS 菜单栏」相关开关、快捷键、螺旋日程汇总切换与重启按钮，不注册 `open-menubar-panel` 命令，且 `MenuBarBridge` 彻底静默空操作（不调 `/usr/bin/pkill`、不写状态文件）；同步更新中英文 README 的 Windows 适配现状说明。
- **移除 CSS `:has()` 选择器**：将对话回放弹窗宽度与多选项设置行堆叠布局改为显式类名（`.modal.ad-conversation-modal`、`.ad-row.ad-row--stack`），消除 Obsidian 插件审核的 `:has()` 性能告警。

## 1.13.5

- **Windows CLI 兼容修复与三端测试全绿**（感谢 [@buaaflyaway](https://github.com/buaaflyaway) 提交 [#7](https://github.com/MatsuriMW/obsidian-agent-deck/pull/7)）：
  - **进程树清理与 `.cmd` 多行传参修复**：Windows 下 CLI 超时改用 `killChildProcess` 终止整棵进程树并重试清理临时目录，避免子进程占用目录导致 `EPERM`/`EBUSY` 覆盖真实超时错误；对经 `cmd.exe` 执行的 `.cmd`/`.bat` 包装脚本（`agy`、`qodercli`、`codebuddy`）压平参数换行，防止提示词在首行被静默截断。
  - **路径与可执行文件解析修复**：归一化 Windows 家目录反斜杠并忽略大小写，避免家目录被误识别为合法项目目录；裸名 CLI 查找在 Windows 上按 `PATHEXT` 优先匹配 `.exe`/`.cmd`/`.bat`（避免命中 npm 同目录的无后缀 POSIX 脚本）并回退至 `PATH` 查找。
  - **测试夹具与三端 CI**：修正 Windows 路径 URL 转换、Cursor 测试 `USERPROFILE`/`APPDATA` 隔离、平台 PATH 断言与 ACP `session/cancel` 并发轮询，Linux / macOS / Windows 三端 CI 全部通过。

## 1.13.4

- **本机 Harness 自动探测与界面降噪**：首次加载自动探测本机实际安装的 Harness/Agent（避免单装桌面聊天端 `Claude.app` 误启用 Claude Code），默认关闭未安装项并选出默认委派目标；支持在设置页和命令面板随时「重新检测 Harness」。设置页（委派目标、配置卡、公共终端、管理模型、来源与扫描折叠未安装项、`autoLogAgents`）、侧栏面板（Agent 卡片、最近筛选条、`AgentCardsModal`）、`DelegateOptionsModal` 与 `AutoLog` 统一过滤未启用项。
- **DSH 默认不指定模型与模型管理易用性修复**：DeepSeek Harness 默认使用新增的 `dsh-default`（不传模型覆写参数，直接沿用 DSH 客户端当前设置的模型；老库内置 DeepSeek 预设首次加载自动迁为 `dsh-default`）；各 CLI/ACP/Codex 桌面端 runner 支持留空/默认时不传模型覆盖；`@agent/` 二级菜单将 `*-default` 固定第一位，其余模型按调用次数从高到低排序。修复模型开关关闭（含当前默认模型）未保存或回弹问题，开关、分组内直接 `＋ 添加`（DSH `Provider route` 改为可选）及 `全部开启/关闭` 均即时保存，并为 Agent 配置卡加入「管理模型」直达入口。

## 1.13.3

- **AI 自动记录右键菜单重做**：把「Pin 为关键记录」挪到右键菜单第一位并去掉小钉子图标；新增「复制这一轮」（任务与结论 / 只复制结论）、「查看这一轮的原会话」、「跳到母任务」，以及带二次确认的「删除这一轮记录」。记录菜单项统一收进独立分区、排在 Obsidian 默认菜单项之前；解析不到原会话或旧版菜单 API 不支持分区时自动降级。

## 1.13.2

- **千问办公（QwenWork）2.x 会话追踪**：新版客户端把对话写进内置引擎的本地会话库，插件现在直接读取，会话、轮次、逐轮 token、模型与完整正文都能看到；旧版日志继续兼容。首条用户消息里由引擎拼进的工作区说明和工具清单会在显示时去掉，对话和日记只留你真正提的问题。
- **README 改版**：开头加入目录与三张功能介绍图，各功能段落只讲能做什么、怎么用；记忆库改为配 Base 表格截图。工程细节移出用户文档，安装与受限说明同步收紧。

## 1.13.1

- **跨平台 SQLite 与 Windows CLI 启动兼容**：新增 `src/sqlite.js` 跨平台探测 `sqlite3` / `sqlite3.exe` 替换各处硬编码 `/usr/bin/sqlite3`；`Delegator` / `CodexDesktopRunner` 在 Windows 下支持 `.cmd` / `.bat` 包装脚本拉起，并为 `CodexDesktopRunner` 补齐 `RunTrace` 闭环与错误脱敏；同步补齐跨平台测试夹具与 Windows CI 矩阵验证。
- **中英文 README 功能同步**：面向用户精简并补齐问答闭环与回复信箱、工作模式与高危权限拦截、子代理层级、管家中途看护、凭证引用保护及脱敏诊断导出说明。

## 1.13.0

- **Markdown 即 Harness 与 M1.1 上下文收口**：一文一条记忆库（`Agent Deck/记忆/*.md`、`记忆.base`、三列记忆看板与逐条审阅、`scripts/memory-query.mjs` 只读检索 CLI）；统一 `ContextBundle`「前稳后动」装配顺序保 KV Cache；消灭双链溢出/坏锚点/读失败静默丢失（超 3 篇改列路径、长文附后续章节行号目录），接入 `private: true` 与 `settings.delegate.excludedDirs` 隐私闸门，并支持未保存编辑器缓冲优先读取与单英文技术词/元数据召回补盲。
- **回复协议、回复信箱与派发草稿闭环**：支持 `❓ / ✍️ 答 / 💬` 三行一轮问答与 `^ad-q-*` / `^ad-a-*` 派生块号（注入前剥离）、最近 3 轮自动回灌、入站 12 行窗口自动捕获提问、非模态侧栏「回复信箱」与笔记内手写 `✍️ 答` 原地直发；新增「派发：先生成草稿」与载荷快照先富化再落盘。
- **更多 Agent、委派体验与运行护栏**：新增 Hermes Agent 与千问办公（QwenWork）追踪支持（Hermes 支持 ACP/终端委派）；确认框支持当次切换工作模式/沙箱、项目文件夹建议与预览草稿；支持 Antigravity ACP 自动允许与弹窗一键授权；新增子代理父子树展示、工作台管家中途看护（15 分钟无输出提醒）、目标→`task.md` Planner 与工作台总览。
- **生产四要素加固（Eval / Trace / Deploy / Security）**：
  - **Security**：API Key 支持 `env:VAR` 与 Vault 外 `~/.agent-deck/secrets.json`（`0600`）避免明文进同步盘；`autoApprove` 下新增 `evaluatePermissionPolicy` 对高危命令、敏感路径（`.ssh`/`.aws`/`.env`）与工作区外写删强制升阶确认；`openTerminalAt` 统一收口至 `openTerminal`，加固 AppleScript 转义与 Warp 独立配置名，并用 `path.join` 替换派发路径硬编码 `/`。
  - **Trace**：为每次派发生成 `traceId` 串联上下文解析、载荷快照、30 帧协议环形缓冲、权限决策与错误分类，脱敏落盘 `~/.agent-deck/traces/*.jsonl`（14 天滚动清理且测试期不污染本机）；新增「导出脱敏诊断报告」命令（`export-diagnostics`）。
  - **Eval & Deploy**：新增纯 Node 离线评测基准（`npm run eval`）与部署/体积/`ASSET_VERSION` 检查（`npm run check:deploy`），补齐 Linux / macOS / Windows 三端 CI 矩阵（含 `swiftc -typecheck`）。

## 1.12.2

- **侧栏「现在」新增「按状态」视图**：卡片头部的切换从「按项目 / 列表」变成「按项目 / 按状态 / 列表」三颗胶囊。按状态固定分「等你 → 待认领 → 在跑 → 异常」四档，空档不出卡片；已派发但还没有会话接手的任务单列「待认领」，不再混进在跑；组内仍按状态与最近活跃排序。状态组头只保留折叠与数量徽章（项目目录 / 工作台 / 停止本项目仍只在按项目视图里），「等你」和「异常」保留琥珀色描边；折叠记忆与按项目视图各记各的。`settings.ui.nowGroupBy` 新增 `status` 取值，旧的 `project` / `flat` 与默认值不变。
- **「在跑」徽章改用任务关键词的 DOING 红**：会话卡片的状态胶囊、按项目 / 按状态的「N 在跑」徽章与 Agent 卡片的「N 个在跑」从成功绿换成新增 token `--ad-live`（`#c8635f`，与 `keyword.css` 里 DOING / NOW / IN-PROGRESS 同一个红）；「完成」仍用绿色；在跑胶囊的呼吸脉冲保留，底色透明度由 14% 提到 20%，浅色主题下更实。

## 1.12.1

- **笔记项目优先于各 Agent 默认目录**：派发顺序改为「显式目录 → 笔记项目 → `delegate.<agent>.cwd` → 库根」，默认目录只在笔记认不出项目时兜底；关掉 `autoProjectFolder` 后仍按默认目录 / 库根。
- **项目登记不用先去设置页**：委派对话框认出笔记里的项目、但该项目还没登记目录时，会从最近追踪到的会话里给出建议（项目名 + 真实路径），点「使用并记住」立即登记；拖拽派发不弹窗，只在派发通知里提示一次。非日记的普通笔记同样适用。
- **非日记笔记的派发默认不重复进日记**：从非当天日记派发时，结论仍写回原笔记，但不再自动记进当天日记；需要时在「委派 → 项目文件夹」打开「非日记笔记的派发也记进当天日记」。旧的会话仍按原规则记录。
- **回写不再报噪音错误**：非日记笔记或分区标记坏掉时，同步流程跳过顶部分割线处理，不再抛「会话回写日记失败」。
- **不再派进错项目**：任务里的 `[[双链]]` / `项目 -> 标题` 前缀优先于笔记路径；笔记路径与任务提到的未登记项目冲突时，对话框以任务项目为预选并让你确认，拖拽派发先落库根并提示。修 `Agent Deck.md` 里写 wuxi 的任务被文件名带去 agent-deck 的问题。
- **取消 ACP 任务不再崩**：`timer.unref` 加类型判断，Obsidian 里取消 DSH/ACP 任务不再抛错。

## 1.12.0

- **按项目文件夹派活**：设置 → 委派新增「项目文件夹」（项目名 → 工作目录）。派活时按「显式目录 → 笔记里的 `[[双链]]` → 笔记路径段 → `项目 -> 标题` 前缀（兼容加粗与 🤖）→ 库根目录」解析，认出项目就换到该目录；派发一次后按项目名记住，失效目录跳过。委派对话框新增项目文件夹下拉并自动预选，项目工作台可切换；开关 `settings.autoProjectFolder`（默认开）。解析出的目录真的传给各 runner（`test/project-dispatch.test.mjs` 用假子进程验证 cwd），Claude/Qoder 继续用 `--add-dir` 把库带进去。
- **Codex 会话不再落到「无项目对话」**：Codex 桌面派发在 `thread/start` 前用 `project/list` 复用同目录项目，没有就 `project/create`（名为项目名 → 目录名），把 `projectId` 传给线程；项目接口失败时静默退回不带 projectId。scratch 目录、home、不存在的 cwd 不建项目，新建项目提示一次；开关 `settings.delegate.codex.project`（默认开）。
- **验证**：`npm test`、`npm run build`、`git diff --check` 通过（新增 `test/project-folders.test.mjs`、`test/project-dispatch.test.mjs`；`test/codex-desktop.test.mjs` 覆盖复用/创建/接口缺失/开关关闭/scratch 五条路径）。Obsidian 实机看过设置页项目行与委派对话框自动预选；真实派发一条到 `ad-e2e` 项目目录后，Codex `thread/list(projectId)` 能查到该线程，项目归组在 turn 之前完成并核对（本轮 Codex 账号撞额度，turn 未完成；测试线程/项目/笔记/设置已清理）。**Windows 未实测。**

## 1.11.0

- **💬 结论改写「最后的落点」**：`conclusionSentence()` 按「显式结论段 → 单段放得下就整段 → 从结尾往前找第一句不像客套 / 下一步的话 → 退回最后一段」取句，简略记录没润色成功时不再把回复开头 65 字当结论；`结论：` 这类字段名会去掉避免重复；润色 prompt 同步要求写落点而不是摘开头。标准记录仍只保留一句话（取收尾那句）。`❓` 的用户提问保持原规则。已有记录仍 append-only，不重算历史。
- **中断 / 额度不足的轮次会留下原因**：被用户中断的轮次记 `💬 结论：本轮被中断，没有结论。`，撞额度（402 / ACCOUNT_QUOTA / Insufficient Balance）的记 `额度不足，本轮未完成。`，并把会话状态从 `ERRORED` 改成 `HITLIMIT`；普通报错不受影响。这样日记里少一条结论时能看出为什么。
- **修两个真实问题**：① 同一个会话被模型换了标题后会被记成两条日记条目——现在 `findSessionTask()` 靠子行里的 `<!-- ad-turn:… -->` 会话标记认领（连同块号被 DONE 清掉的情况），建项前先按会话找，已记完的 DONE 条目不再重建；② 多步轮次的结论会串到上一轮——`startRound()` 换轮时清空 `lastText`，只有工具调用的轮次结论留空，不再把上一轮最后一句当本轮结论。
- **日记分区标记坏了会先问、再帮你修或重建**：点「整理日志」「现在整理一次」碰到分区标记不完整时弹窗：能补就问「帮我补齐分区」，补不回来（标记之间夹了正文）就问「帮我重建分区」（去掉标记按任务关键字重新归区，正文不删）；第一次还会说明整理靠隐藏标记和 `---` 分割线认分区。不确认就不动原文。另外新增 `DeepSeek CLI` 整理来源（走 `deepseek-ds` 包装命令：隔离配置目录 + keychain 取 key，不影响官方 `gemini` CLI）。
- **💬 结论分编码 / 知识问答两类**：润色让模型多输出一个 `kind`（这轮是改代码还是回答问题），编码类短记录（默认 65 字，写做了什么、什么状态），知识问答类可以长一些（默认 160 字，优先取「先说结论 / 推荐 / 所以 / 答案是」这类判断段，再退到结尾那段并带上上一段）。本地兜底 `conclusionKind()` 按「派活还是提问」判断，拿不准按 coding；同时把「没有验证的 / 顺带一句 / 下一步 / 要不要我…」这类段落排除在结论之外。两个长度可在「记录 → 日记与归档 → 💬 编码类结论字数 / 💬 知识问答结论字数」调。
- **自动调用 API 前先问一句**：API 会算钱，自动整理 / 每轮润色 / 累积合并总结真要调用 API 时先弹系统对话框（macOS `display dialog`，按钮「允许 / 这次不用」，60 秒无人应答＝不用；其它平台与应用内兜底用 `ApiConsentModal`）。同意后 30 分钟内不再问，拒绝后同一窗口内也不再问（都只存在进程内，重启失效）；「现在整理一次」「测试连接」「生成计划」「立即做梦」这类手动操作不问；定时 Dreaming 与自动生成块号同样受这个问询约束（拿不到授权就跳过）。开关「记录 → 日记与归档 → 更多设置 → 用 API 前先问我」（`settings.autoLogApiConfirm`，默认开）。
- **整理来源可自动换备用**：新增「主来源不可用时换备用」（`autoLogFailover`，默认关）、「备用来源」（`autoLogBackupProvider`：自动挑下一个已登录 CLI / 指定 CLI / 自填 API）与「撞限额后冷却（分钟）」（`autoLogCooldownMin`，默认 `30`）。主来源撞限额、超时或起不来时换下一个来源，最多两家，都问不到才退回「会话标题 + 本地结论」；冷却期内跳过撞墙的那家并优先上次成功的来源。macOS 已通过 `npm test`、`npm run build`、`git diff --check`，并实测 agy 撞限额后自动切换到 qodercli；Windows 未实测。

> 平台：macOS 已通过 `npm test`、`npm run build`、`git diff --check`，并在 `马自立` Vault 实测 failover、DeepSeek 整理、分区修复弹窗与设置页；Windows 未实测。

## 1.10.7

- **看板细节修复**：无块号同名卡片的 pin 改为按文档顺序生成唯一 key（`title:...#1` / `#2`），避免置顶时两张同名卡一起被 pin；旧 `title:` pin 仍兼容，新 pin 时自动迁移；列内滚动位置在刷新/重建时保留，批量删除确认计时器随看板销毁清理。macOS 已通过 `npm test`、`npm run build`、`git diff --check`，并实测同名卡只置顶一张；Windows 未实测。

## 1.10.6

- **看板回归修复**：子组模式下的子卡补上 `subBoardKey` / `childCardCount` / `childDoneCount`，恢复 `↳` 下钻与 `0/2` 计数；镜像卡未解析到源笔记时拒绝改状态，解析成功后按 `^blockId` 在源笔记重新定位，避免行号过期改到别的任务；看板 widget 签名补 `endLine` / `hasLink` / `mirrorTarget` / `childDoneCount`，源笔记插行或新增链接后不再复用旧 DOM 造成插入点错位；选择标识加入当前行号，同名无块号卡片不再一起被勾选/删除；镜像卡改为不可拖；备注改为完整 Markdown 渲染 + 4 行高度截断，避免在 `**` / `[[` 中间截断；快捷新增、行内改 Agent、拖拽写入与设置保存失败统一提示，不再 unhandled rejection。macOS 已通过 `npm test`、`npm run build`、`git diff --check`，并实测子组下钻、重复标题选择、长备注 Markdown 截断；Windows 未实测。

## 1.10.5

- **分形看板列高收敛、置顶、批量、右键菜单与 Markdown 卡面**：列高按渲染后的卡片高度动态封顶（常规约露 3 张，整列前 4 张都能放进同一高度预算时露 4 张），其余在列内滚动；拖到卡片上/下半区分别插入前后，拖到列空白处排到列尾；单卡 `📌` 或批量置顶只改投影顺序（`settings.taskBoardPins`，不动 Markdown，取消后恢复文档顺序）；卡与列头复选框支持批量改状态、置顶/取消置顶、删除整卡子树（含记录与子项，二次确认、编辑器可撤销），镜像卡只参与置顶。卡片右下角操作按钮移除：单卡「正文 / 停止 / 派发」与多选后的「改状态 / 置顶 / 删除 / 清空」自动进入右键菜单（删除走二次确认子菜单），顶部「派发 TODO」与批量操作栏保留。卡面标题与最新结论改为 Markdown 渲染（加粗、行内代码、双链/外链可点；点标题空白仍回大纲定位），标题保留 `titleMarkdown` 而 pin 标识/兄弟上下文继续使用纯文本。macOS 已通过 `npm test`、`npm run build`、`git diff --check`，并在 `马自立` Vault 临时笔记实机验证列高、滚动、拖拽、置顶、批量状态/删除、右键菜单与 Markdown 链接；Windows 未实测。

## 1.10.4

- **自动会话记录默认打开、扫描间隔 30 秒**：`DEFAULTS.autoLog` 改为开、`DEFAULTS.pollSeconds` 由 `60` 改为 `30`（`scheduleScan` 兜底值同步）；`onload` 用一次性标记 `settings.defaultsMigratedAutoLog` 把老库也迁到新默认，之后用户手动改就尊重。
- **当天日记缺失时按模板创建**：确有会话要写而当天日记不存在时，经 `plugin.ensureNoteFile` 按 Obsidian「日记」核心插件的模板建笔记，模板变量 `{{title}}` / `{{date}}` / `{{time}}` / `{{date:…}}` / `{{time:…}}` 按「模板」插件的日期时间格式替换，无模板则建空文件；AI 分区骨架仍交给 `placeBlock`，没有要记录的会话不建笔记。
- **AI 自动记录只追最近的活动**：新增「首次记录最近多少轮」（`settings.autoLogFirstRounds`，默认 `10`）；第一次接入某个会话 / Bot 只补最近 N 轮，之后同一个会话只跟当天产生的轮次（按「日记日期分界」，跨日延续也按今天），更早的历史不再写回笔记。「见过的会话」记在 `settings.autoLogSeen`（180 天懒清理、封顶 2000 条，老库从 `autoLogState` 播种）；自动建项（`src/autolog.js`）与 🔗 回写（`src/sync.js`）同规则，已有笔记内容不裁剪。
- **任务关键词的配色与图标（与 Logseq Style Tasks 一比一）**：编辑器与阅读视图给所有任务关键词上色并带 `tsq-ico` 图标，完成/归档态文字与切换关键词时的动画都与 TODOseq 一致；AI 自动记录即使 `DONE` 也不加贯穿删除线，手写任务照旧。TODOseq 在管配色或图标时按层让位，避免重复渲染；开关在「记录 → 日记与归档 → 关键词配色与图标」。
- **首次安装把面板放进右侧栏并展开**：`openPanelOnce()` 在 `settings.viewOpened` 尚未置位时，除放入右侧栏外再展开右侧栏，新库装上就能看见；已装过的库不动。
- **README 增加「合并成组（Group rows）」效果图**：中英文 README 在对应小节各插一张居中截图。
- **性能**：轮次窗口的当天过滤改为 `startOfDay` 毫秒比较（2000 轮 0.355 ms → 0.039 ms）；「见过的会话」查询提到逐会话循环外；阅读视图关键词标记先做廉价预筛；两条关键词 ViewPlugin 在 80 行可见范围各约 0.8 ms。

## 1.10.3

- **大纲「跳到母块」与「合并成组」**：新增「跳到母块（`Mod+Alt+ArrowUp`，连续按逐级向上）」「跳到最上一级的顶格母块（`Mod+Alt+Shift+ArrowUp`）」与「合并成组（Group rows，`Mod+Alt+ArrowDown`）」命令，并在编辑器右键菜单提供「合并成组（Group rows）」；跳转停在行尾 `^blockId` 之前，遇到顶格段落或标题即视为边界；合并成组按选区覆盖块（含各自子项）的最浅缩进在上方新建空母块、把选中块整体降一级，遵循 Obsidian `useTab` / `tabSize` 设置，光标直接落在新母块输入位。
- **多选块批量调整任务状态**：支持拖拽框选、跨层选区与多光标选区，按所选最浅根列表项去重（跳过 `💬` / `🔗` 等内部记录行与子项）；一次事务原子更新含关键词任务、无关键词普通列表项（不误吞 `API` 等大写正文词）与 `[ ]` / `[/]` / `[x]` / `[-]` 复选框，支持单步撤销，并正确维护 AI 条目的 `manualTaskStates` 人工锁定与恢复自动跟随、清理 `DONE` 内部块号；命令面板「批量调整选中块的任务状态…」、编辑器右键菜单「批量调整 {n} 个块的状态」与多选时直接点击状态徽章三个入口。
- **工作台管家 Agent（Steward）波次收口**：项目协作工作台新增管家配置与「自动续派管家生成的后续 TODO（最多 2 轮）」开关（持久化 `settings.projectTeams.stewards`），派发后记录持久化波次 `settings.workbenchWaves`；共用 Delegator 钩子与扫描同步队员（含 `handoff` 会话）状态，全员收口后自动插入「🧭 管家汇总与推进」子卡并携带队员产出与项目上下文派发给管家，解析结构化决策更新父任务与队员状态并把后续 `TODO` 写回分形看板（自动续派上限 2 轮）；分形看板顶部提供实时管家状态栏与「立即汇总 / 停止管家 / 取消管家 / 重试汇总」。
- **整理日志只调整顶格 AI 记录块**：`planJournal` 与上方收编仅处理顶格（无前置缩进）的 AI 记录块，任何缩进条目（手写分组下的 AI 记录、嵌套 AI 子项或挂在任务下的记录）原位保留、不拆散也不触发散落提醒；缩进在 AI 父项下的开放子任务同时阻止父块被归档误翻 `DONE`。

## 1.10.2

- **自动记录复用阻塞与待查看关键词**：`AutoLog` 不新增关键词，复用现有 `AGENT_KWS`；当会话处于 `needs-approval` / `error` / `limit` / `queued` 时分别记录为 `NEEDOK` / `ERRORED` / `HITLIMIT` / `QUEUED`，模型判定整件事完成（`done: true`）且闲置时切为 `TOREVIEW`，正常停顿保留 `PAUSED`；会话恢复运行后自动切回 `DOING`。

## 1.10.1

- **项目聚合隔离与子代理归属继承**：按规范化工作区根路径分组（合并 `/.claude/worktrees/...` 同时隔离不同路径下的同名目录，仅同名碰撞时在展示名附加区分父目录）；带 `parentSid` 的子代理（如 DSH `default-workspace`）通过 `parentSid` / `parentCwd` 继承母会话项目，不再落入「独立会话」；补齐 `/Codex/YYYY-MM-DD/...` 多级临时目录识别，递增 `USAGE_CACHE_VERSION = 12` 与 `SUMMARY_VERSION = 3`。
- **DSH/Codex 子代理状态收口与「等你」列表降噪**：DSH `turn/end` 与 Codex `task_complete` 在子代理（`parentSid` / `delegationDepth > 0`）正常结束时标为 `done`、`aborted` / `turn_aborted` 标为 `cancelled`；侧栏「现在」、「最近的会话 → 等你」及 macOS 菜单栏等待计数排除子代理与超过 30 分钟的历史正常结束会话，保留 `needs-approval`、`queued`、活跃任务与近期主会话等待。
- **工作台预设、Prompt 剥离与英文记录兼容**：新增「深度研报小队」与「深度写作小队」预设；委派上下文、双链摘录与同看板分工自动剥离内部 `^ad-*` 与 `<!-- ad-* -->` 标记；AI 记录视图与功能示例补齐英文 `Round N: Task: ...; Result: ...` 解析。

## 1.10.0

- **按项目聚合的多 Agent 进程管理**：侧栏「现在」默认按工作区项目收拢多 Agent 活跃会话（纳入 `run`、`wait`、`needs-approval`、`error`、`limit`、`queued` 状态与未就绪委派任务），支持一键打开项目目录、直达项目工作台、批量停止本项目活跃任务与切回「列表」；「最近的会话」新增「按 Agent / 按项目」分组切换。
- **项目协作工作台（小队预设、AI 副驾拆解与并发派发）**：新增 `ProjectWorkbenchModal`（侧栏入口、命令面板与任务操作菜单均可唤起），内置三套协作小队预设并自动避开已禁用或撞限额 Agent，支持调用整理模型或本地规则将目标拆解为可编辑子任务草案（预分配独立 `^blockId` 并归入日记活跃区），确认后多 Agent 并发派发并自动打开目标笔记。
- **CM6 原地分形看板（阶段 A / B / C）**：包含 2 个以上直接子任务的父任务行尾提供 `看板 N` 原地切换，支持 **按状态分列** 与 **按子组分列** 双视图、嵌套子卡无限下钻聚焦（Zoom + 面包屑）、顶栏进度条、快捷新增子卡（`+ 子卡`）、行内切换 `@agent`、跨列/跨组拖拽子树及单卡查看正文/停止/派发；委派自动解析 `[[双链]]` 笔记与同看板兄弟分工上下文；支持 `![[笔记#^blockId]]` 只读镜像卡投影与回写源笔记，同时在 Dashboard 统计与 Dreaming 记忆提取中排除镜像行以防重复计数。
- **新版功能交互示例笔记（首次升级自动打开）**：升级安装 `1.10.0` 后首次启动会在库内生成并打开纯 Markdown 模拟示例笔记（`Agent Deck/功能示例-1.10.0.md` / 英文 `Agent Deck/Welcome-1.10.0.md`），同屏预置可交互的原地分形看板（含子组 Zoom 与同笔记镜像源跳转）以及表格 / 卡片 / 时间线 / 大纲四种 AI 记录模拟视图（不绑定真实 CLI 会话、不影响统计），并可通过命令面板「打开 1.10.0 新功能示例笔记」随时重开。

### 演示素材与验证范围

| 顺序 | 截图 | 展示范围 |
| --- | --- | --- |
| 1 | [小队与可编辑草案](assets/project-workbench.png) | 本次在真实 Obsidian 中打开工作台并点击「按小队快速拆分」，展示角色、草案及确认入口；随后取消，未写入或派发。工作目录字段为展示值。 |
| 2 | [标准 Markdown 大纲](assets/fractal-board-outline.jpg) | 复用现有素材，展示任务层级、负责人和原地看板入口。 |
| 3 | [按子组分列看板](assets/fractal-board-kanban.jpg) | 复用现有素材，展示阶段列、进度、操作入口和镜像角标；不作为镜像目标解析或回写成功的证据。 |

- 本次补拍覆盖 macOS、中文、浅色主题，截图时已加载插件版本为 `1.9.11`；未调用模型、写入任务或启动 Agent。截图为本地演示材料，不用于判断 GitHub Release 发布状态。
- 多 Agent 并发默认后台策略仍待确认；Obsidian 拖拽与状态回写以同看板专门验收结果为准，截图不替代交互验收。Windows、英文及深色主题未在本次实测；阅读视图仍呈现大纲。
- 截图会话的错误缓冲含 Obsidian 内部 `TypeError` 与 `NoteGraphError`，来源及与工作台的关系未定位，不能宣称整库无报错。

## 1.9.11

- **Grok Bot（Sand）桌面端会话追踪**：新增 Grok Bot（`com.anysphere.sand`）只读追踪集成，读取本地 `sand-client-persistence` 中的对话与 Bot 列表；可在设置「记录 → 来源与扫描」的 **Grok Bot** 卡片内按 Bot 多选勾选追踪范围（默认全不选、隐藏 Bot 默认折叠），云端沙箱无本地逐条 token/模型时显示「用量未提供」且不做估算；自动记录标题统一为 `Bot名 -> 实际生成标题`，并在超过设定的无新对话时长（`autoLogGrokBotDoneMinutes`，默认 120 分钟）后自动标为 `DONE`（同日再续聊则新建活跃块）。
- **AI 记录规则层（`recordRules`）与母块标题加粗**：所有 AI 自动记录与快捷绑定新生成的母块标题默认自动使用 Markdown `**标题**` 加粗显示（不重复包裹 `****`，已存在或用户改过名的标题及子块保持不变）；在「设置 → 记录 → 日记与归档 → 更多设置 → 记录规则细则」开放母块标题加粗、项目 / Bot 名前缀、起止时间段、标题最大字数与 Grok Bot 自动 DONE 时长配置。
- **工程整理**：修复 `formatAutoTaskLine` 关闭起止时间段时的次轮回写、`mergeTasks` 合并 AI 行重复拼接 `🤖` 前缀、委派子项加粗隔离，并完成跨模块公共逻辑去重与 CSS 分层精简。

## 1.9.10

- **Claude CLI `env` 认证修复（#4）**：`runClaude()` 将 `--setting-sources` 由 `project` 调整为 `user,project`，使配置在 `~/.claude/settings.json` `env` 中的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等凭据可在无头整理与 Dreaming 子进程中正常加载；同步更新 `JOURNAL_PROVIDERS.claude.loggedIn` 探测逻辑，识别 `env.ANTHROPIC_AUTH_TOKEN` 与 `~/.claude/settings.json` `env` 中的认证字段，避免自动挑选模型时误判未登录。
- **AI 记录按视图与多格式导出**：顶层 AI 自动记录母块的视图菜单内新增「导出」子菜单，支持按当前视图（大纲／表格／卡片／时间线）导出展开后的 PDF 与独立 HTML（保留时间线时间戳与手写附注），新增无损 Markdown (`.md`)、结构化 JSON (`.json`)、UTF-8 BOM CSV (`.csv`) 文件导出，以及复制为 Markdown、Markdown 表格、纯文本与 JSON 以便数据复用。

## 1.9.9

- **协作回顾 Dashboard 增强**：新增「24 小时作息与并发」时段活跃柱状图、多会话并发统计与最活跃时段提示；新增「模型分布」统计表（Token、问答轮次、轮均 Token、缓存命中率、活跃耗时与会话数），支持点击联动筛选并纳入简报导出。
- **Agent 图标与项目投入多维排序**：Dashboard 中「Agent 分布」、模型与项目明细列表、记录明细统一改用 Agent 官方图标（`agentIcon`）；「项目投入」新增按 `Token / 耗时 / 会话 / 名称` 与「顺序 ↑ / 倒序 ↓」切换及表头点击排序。
- **AI 自动记录与日记视图持久化**：AI 自动记录按零点分割跨日对话并精简时间显示与口语冗余；AI 记录母块支持大纲／表格／卡片／时间线多视图持久化切换、行内展开深层子块与任务正文干净导出（`Agent Deck` 导出动作），归档对话自动标记对应任务完成，对话弹窗采用 `.ad-modal` 设计语言并生成语义化归档命名。
- **Dreaming 采集范围与模型联动**：修复 Dreaming 执行链路，默认跟随「AI 自动记录」的模型与 CLI（支持独立覆盖），并支持在设置中控制「Dreaming 采集范围」（仅采集含 AI 自动记录的条目，或包含全部日记与任务）。
- **无环架构重构与可扩展底座**：新增统一无环模块 `runtime-guard.js`、`agent-registry.js`、`harness.js`、`dream-entries.js`、`outline.js`（只读 Markdown 大纲与双链解析原语）、`agent-ingestors.js`（可扩展日志解析注册表）与 `delegation-runners.js`（可扩展委派 Runner 注册表），进一步厘清计算（`analytics.js`）与视图（`dashboard.js`）职责边界。
- **文档与结构图**：在 README 与设置「关于」页补充核心信息流转与 Agent 协作 Mermaid 结构图，补充 GitHub Issues／Roadmap 反馈入口，并整理 WorkFlowy 分形看板与 Dashboard 任务闭环演进方向。

## 1.9.8

- 新增 Cursor 桌面端（3.30.14+ Hooks）只读追踪与增量扫描；对话视图与归档包含工具调用时间线及折叠输出，并在设置页提供 Hooks 安装与清理入口。
- 后台任务回答不超过 500 字直接完整回写，超过时保存至 `Agent Deck/Answers/` 完整问答文件并移除行尾状态 pill；不再调用额外总结模型，普通会话结论默认 350 字并保留自定义值。
- 精简设置页面为 5 页、收拢低频开关至「更多设置」，新增主力 Agent 引导与 macOS 菜单栏状态同步。
- 日记「整理日志」默认按「正在做 / 还要做 / 已完成」固定分区边界重排，仅作用于 AI 记录条目（非 AI 手写条目与区外笔记保持原位不动），并增强分区隐藏注释在实时预览误编辑后的容错与自动恢复。
- 修复 Obsidian 原生点击折叠与 AI 记录条数控制、`logseq-style-fold` 冲突导致的闪回问题；AI 自动记录在工作区下默认带上项目名前缀。
- 侧栏「最近的会话」支持 `7 天 / 30 天 / 120 天` 切换、全部视角同 Agent 默认叠放、30 张上限控制及折叠顶部横条时的视口锚定防跳动。

## 1.9.7

- 任务与结论摘要中的长网址、文件路径使用可点击的 `[🔗](完整地址)`。已有清楚的链接文字保留；缩短摘要时保留完整目标，带空格和括号的路径可正常打开。详细摘录和原始对话归档保留原文。
- 修复 AI 自动记录条目 token 显示消失：只有螺旋日程确实表示同一会话且提供相应 token 时才让出显示；否则由 Agent Deck 显示 token 数字和数据库图标。补齐不活跃会话的 token 显示值，沿用输入加输出、缓存另计的口径。

## 1.9.6

- 用户修改的 AI 块标题按原文保留，包括双空格、页面链接和时间样式文字；暂停、完成、会话回写和整理不再重新清洗或概括标题。
- 修复 Codex 确认选项的内部回传标签进入日志：提取可读的确认答案，忽略空回传；重新解析旧缓存，并只修复有来源标记且未被单独复用的异常任务字段。
- 设置新增「实验功能」页，AI 协作回顾 Dashboard 默认开启。关闭时隐藏侧栏入口和打开命令、关闭已打开的回顾页；保留统计数据和项目归属，重启后沿用选择。
- 新任务块号采用 Agent 前缀、英文任务短名和短尾码；复用已配置的整理模型命名，改标题、切换模型与旧记录不换号。编辑与阅读界面隐藏内部标识，DONE、会话归档及整理已完成日志时自动清理，保留会话链接、手写内容和代码示例。
- 验证 Qoder 本机后台委派、同一会话终端续聊、轮次追踪、结果回写和原文归档；修复完成条目标识清理后的重复记录与归档重试兼容。
- 新增独立「AI 协作回顾」Dashboard，优先展示 GitHub 风格的每日 token 热力图；颜色随用量加深，可点击日期查看当天记录。侧栏面板新增回顾入口，命令面板可直接打开。
- 支持最近 7／30／90 天、一年及自定义日期；汇总输入、输出、缓存读取 token、去重活跃耗时、会话数与活跃天数。沿用日记分界，缺少来源数据时不作估算。
- 项目投入按 token 排名；匹配日记条目的页面链接、标题、目录和重复关键词，支持页面别名。重名／冲突保留未归类，可按会话更正并恢复自动识别。
- 记录明细可返回来源日记块、项目页面和原会话；已归档会话仍参与回顾。统计使用已保存的每日会话用量，避免把跨日会话的累计值重复分摊。
- 来源读取按文件缓存，优先使用未保存的编辑器内容；仅回顾已有数据，不改写日记，不调用外部模型。

## 1.9.5

- 总结模型阅读完整回复，分别提炼“结论、改动、未完成”。约 240 字是篇幅目标，不再截取回复开头，也不在生成后硬截断总结。
- 沿用记录设置中的整理模型／润色模型，额外调用一次。完整原文先保存，总结完成后再合并到最新日记，不占用日记写入队列。
- 总结失败时保留原文链接并显示“总结暂未生成”；之后随扫描重试，至少间隔 60 秒。相同回复的并发请求共用调用，成功总结缓存复用。
- 任务完成与后续会话扫描共用总结入口。已有手写内容和已保存历史保持原样。


## 1.9.4

- 委派只保留桌面端、后台执行和终端交互。对话窗口用于查看和保存正文，后续对话回到各 Agent 的客户端或终端。
- 后台任务在日记中写入最多约 240 字的进展／结论，并自动链接完整对话笔记。原文保存在 `Agent Deck/Conversations/`，保留代码、换行和长文本。
- 同一篇笔记的绑定、结果与归档链接按文件排队，写入时合并最新内容。自动整理等待模型期间的手写内容也保留。
- 运行时显示动态指示条和耗时；后台任务不显示估算百分比。完成或失败后保留本轮耗时。
- 补充 Qoder 和 WorkBuddy 的 CLI／桌面会话边界，移除接入原则中的插件内续聊要求。


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
- 性能：`重新扫描 `、` 立即扫描` 和 `?do=scan` 改为复用解析缓存，只重读变了的日志——本机 2.7 GB / 664 个 Claude 日志，第一次全量约 13.8 秒，之后再扫约 50 毫秒；要丢弃缓存重算仍然走「重新计算全部历史」。
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
