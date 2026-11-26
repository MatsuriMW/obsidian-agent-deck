# Harness 演进路线图：按 Milestone 推进上下文引擎

状态：**v4（按 Milestone 重构，经两轮代码与可执行性自审）**｜基线：`1.12.2` + `2026-11-18` 未发版增量（`8274a27`）｜Linear：[`P-MAT-42`](https://linear.app/matsurimywaifu/project/agent-deck-obsidian-插件-01b0285aef2b)

相关：[`vision-markdown-harness.zh-CN.md`](vision-markdown-harness.zh-CN.md) · [`context-protocol.zh-CN.md`](context-protocol.zh-CN.md) · [`information-flow.zh-CN.md`](information-flow.zh-CN.md) · [`harness-delta-2026-11-18.zh-CN.md`](harness-delta-2026-11-18.zh-CN.md) · [`dream-shared-memory.md`](dream-shared-memory.md) · [`fractal-boards-roadmap.md`](fractal-boards-roadmap.md)

> 本文件是 Agent Deck 文本 Harness 的**执行路线图**：明确每个 Milestone 交付什么、**明确不做什么**、对应源码接缝与验收判据。协议细则看 [`context-protocol.zh-CN.md`](context-protocol.zh-CN.md)，总纲构想看 [`vision-markdown-harness.zh-CN.md`](vision-markdown-harness.zh-CN.md)。

---

## 1. 核心判断与代码级现状诊断

### 1.1 四条核心判断（不变量）

1. **瓶颈已经从“取不到”变成“取不准、取不多、静默漏”。** 单靠 `MAX_LINKED_NOTES = 3` × 600 字内联摘录是无工具时代的做法；而当前 Agent 的 `cwd` 本来就在库里，缺的是精准入口与不撒谎的报错。
2. **上下文还没有进入复利，但供给端必须先于回写端做扎实。** 第一阶段（**Milestone 1**）聚焦把 Agent Deck 建成**高质量、诚实、可外供的 AI 上下文提取与提供者**；在“供得准”之前，不盲目上全库画像或复杂写回自动化。
3. **资产已经够齐，缺的是收口为同一套引擎。** 大纲祖先链、双链解析、块号、一文一条记忆库、技能卡、问答回灌、`memory-query.mjs`、9 家 Agent 能力表都已在仓库内；现在最缺的是把分散在四五个模块里的提取与组装收成唯一内核。
4. **与 RAG 的分野不变：结构优先，检索兜底。** 用户手工标注的结构（缩进、序号、块引用、`domain`/`father`/`type`）是人做过判断的注意力痕迹，信噪比高于黑盒 embedding；**不存关联分数，只存信号，每条关联必须带 `why`。**

> 外部参照（Notion）：Notion 靠「块结构 / Markdown / 向量」同步 + 可手工编辑界面 + 跨 Agent MCP 成为优秀上下文托管端；同时它收窄 AI 额度、退回托管层的选择也证明——**Agent Deck 不该把模型能力长在自己身上，而应把“库级上下文供给”做到极致。**

### 1.2 前置承诺：用户继续在 Obsidian 里原生写作

本路线图**不改变写作习惯**。日记、随手记、概念笔记照旧用 Obsidian 原生语法写，Harness 只在**读取与工具侧**做增益；唯一新增书写选项是 M2 证据链的 L2 脚注档（可选、有止损、可回退）。

| 语法 | 我们的处理 | 要求用户改动 |
| --- | --- | --- |
| 双链 `[[笔记]]`、`[[笔记\|别名]]` | 名字解析后固化为路径，回写时还原原写法 | 否 |
| 定点 `[[笔记#^块号]]` | 硬锚点 + 内容 hash 校验 | 否 |
| 章节 `[[笔记#标题]]` | 取该标题到下一个同级或更高级标题之前 | 否 |
| 嵌入 `![[…]]` | 上下文解析按引用计入，用量与 Dream 统计仍排除镜像 | 否 |
| 列表缩进 | 层级唯一依据（Tab / 空格按视觉宽度 4 列算） | 否 |
| 列表符号 | 只区分**有序 / 无序**，不取“第几项”（见下方红线） | 否 |
| 标题层级 | 作为主题锚点参与邻居描述 | 否 |
| frontmatter 属性 | 只读映射到 OKF 子集（见协议 §4） | 否 |
| 脚注 `[^id]` | 证据链载体，仅 M2 的 L2 建议使用 | **是，但可选** |
| 注释 `%%…%%` | 解析时剥离，不作证据来源 | 否 |
| 标注块 `> [!note]` | 标为 callout，不参与大纲层级 | 否 |

**有序列表技术红线**：Obsidian 会按渲染顺序自动编号，源文本可能是多个 `1.`。因此“第几项”**不能当作绝对位置或顺序数据**，顺序只能由行位置表达，Agent 侧只知“这是一个有序列表”。

### 1.3 结合最新代码（`8274a27`）与 Linear `P-MAT-42` 的真实现状诊断

昨晚至今日（`2026-11-18`）的 20 个本地提交已经把记忆库、派发草稿、载荷快照、回复协议和 `memory-query.mjs` 推到了可用状态，但直接核对源码后发现 **6 个卡住“高质量上下文提供者”定位的实际缺口**：

1. **双轨拼装分裂（`src/harness.js` vs `src/delegation.js`）**：
   - `resolveDelegationContext`（`src/harness.js:180`）先提取祖先链、前 3 篇双链摘录与 Dream 记忆；
   - `Delegator.enrichPrompt`（`src/delegation.js:535`）又在外面重新用正则扫 `block.text`（**漏扫祖先链 `contextLines`**），把引用路径、记忆工具提示、`replyPromptText`、技能卡路径**往字符串头部倒序前置**，导致每轮变化的 `replyText` 插在固定前缀前面，破坏模型 Prefix Cache（KV Cache）对齐；
   - `scripts/memory-query.mjs:25` 为了脱离仓库独立跑而复制了一份 `terms()`。**导致上下文发动机无法干干净净拆出来给 MCP 或外部客户端复用。**
2. **五处静默丢失上下文（与红线违背）**：
   - `src/harness.js:140` 超过 `MAX_LINKED_NOTES = 3` 直接 `break`，第 4 篇起没有任何省略说明；
   - `src/harness.js:172` 对截断后的长笔记仅盲截前 600 字（未附后续章节行号目录），且对正文为空的概念页直接 `if (!compact) continue;` 静默跳过（实测库内 1665 篇概念页有 1049 篇正文 ≤ 50 字，其中 995 篇的内容都在日记/概念反链里）；
   - 找不到 `#^blockId`（`:161`）、找不到 `#标题`（`:167`）直接 `continue`；读笔记异常（`:175` `catch { /* unreadable linked note */ }`）静默吞错；
   - `outlineAncestors` 没有预算保护，长笔记里可能被冗长上级标题/列表占满预算；
   - `plugin.readNote` 读缓存/磁盘而不是编辑器当前未落盘缓冲，刚改完笔记就派发可能读到旧版（G4）。
3. **结构元信息在进入模型前被整块切光**：
   - `src/harness.js:169` 一律从 `frontmatterEnd` 往后截，把 `type` / `def` / `domain` / `father` / `status` / `verified` 全部丢掉，Agent 看不到任何节点身份与信任信号。
4. **记忆检索对短中文词与单个英文词存在召回盲区**：
   - `src/dream.js:228` `pickMemories` 硬卡 `MIN_MEMORY_OVERLAP = 2`，而 `terms()` 对单个英文词（如 `Windows`、`esbuild`）或两字中文词（如 `排版`）只切出 1 个词元，等于**单关键词永远零召回**；且 `memory-query.mjs` 目前只能查 `记忆/` 33 条，无法检索库内 5486 篇概念与项目笔记。
5. **隐私与 Agent 能力边界尚未接入注入层**：
   - 目前未按 `private: true` 或排除目录拦截外发注入（G2）；也未按 `src/agent-registry.js` 区分“能自己读文件的 CLI/ACP Agent”和“只能吃一次性文本的桌面/剪贴板 Agent”（G1）。
6. **周边污染源与跨平台隐患（结合 Linear `P-MAT-42`）**：
   - `MAT-479` 记录的“**`💬` 双写手在关闭同步时残留未转义 `#词` / `[[…]]`**”会污染双链反推，必须收进 M1.1；
   - `MAT-628` 期望的“**派发前可见可勾选的上下文清单**”目前完全缺席（现行派发是黑盒自动注入，只有生成草稿后才能看见）；
   - `feat/win-compat`（`84b8c01`）仍未合入 `main`，且 `memoryToolHint()` 等处直接用 `/` 拼接路径，Windows 下跑外部上下文工具前必须把跨平台路径封装做好。

---

## 2. Milestone 路线图总览

| 阶段 | 定位与核心目标 | 涵盖内容（编号映射见 §7） | 明确不做 / 冻结 | 对应 Linear |
| --- | --- | --- | --- | --- |
| **M0 基线** | **已落地基线**：单库日记/派发/记忆库/回复协议就绪 | `1.12.2` + `2026-11-18` 20 个本地提交（Q1、D4 迁移、CLI 雏形、回复信箱、管家看护等） | — | 已完成历史记录 |
| **M1（当前主焦）** | **高质量上下文提取与提供者**：统一内核、零静默丢失、结构摘要、锚点校验、对外 stdio MCP | **M1.1** 内核收口与诚实化<br>**M1.2** 结构保真、锚点校验与派发前透明预览<br>**M1.3** 纯 Node 库级 Context MCP + CLI | **不做** D10 全库画像<br>**不做** D4 四维状态迁移<br>**不做** 记忆按条共享发布层<br>**不加** 新的看板/工作台大功能 | **M1.1 / M1.2 / M1.3**（含 `MAT-628` 轻量版、`MAT-479` 上下文污染项） |
| **M2** | **可信度与知识维护闭环**：四维记忆、全库结构体检、冲突检测、零负担证据链 | 四维拆解（`status`/`verified`/`supersedes`/`verdict`）、记忆归档、D8 断链缺口、B7 冲突检测、D5 反推 `sources` | 不强制用户在日记写脚注（L0 保持免脚注） | **M2**（含 `MAT-633`） |
| **M3** | **回写复利、按条共享与跨端底座**：用过的上下文沉淀回库、安全共享给外部 Agent、可重放 | D7 使用留痕与 `log.md`、载荷差异进 Dream、Dream 按条共享发布层 + `scope=shared` MCP、D8 可重放、D9/G10 独立底座 | 不做多人实时协同与服务端鉴权 | **M3** |
| **并行轨道** | **不阻塞 M1 的稳定性、客户端与生态扩展** | **轨道 W**：Windows 适配与实机测试（`feat/win-compat`）<br>**轨道 A**：更多 Agent 委派/记录/追踪与终端扩展（Hermes / 千问 / Kimi Code / ZCode / MiniMax Code 客户端+CLI / Claude 客户端委派 / 更多终端）<br>**轨道 T**：Muse 追踪、Claude CLI 复核、Dashboard 闭环与其余 ACP 体验优化 | 不抢占 M1.1–M1.3 上下文主线；新 Agent 优先复用 M1.3 MCP 与 `agent-registry` 注册表 | `③ 后续维护与验证`（`MAT-643`, `MAT-629`, `MAT-630`, `MAT-625`, `MAT-631`, `MAT-632`, `MAT-479` 其余项 + 轨道 A 待建卡） |

### 2.1 M0 已落地基线清单（截止 `8274a27`，全部已提交并推送 `main`，未发版）

为防止后续迭代重复建设或踩回旧坑，以下能力均**已在工作区实现并通过单测/macOS 实测**：

- **记忆库存储与读法（原 D4 / Q6）**：`Agent Deck/记忆/*.md` 一文一条（33 条已从 `长期记忆.md` 无损迁移，原文件保留人工前言 + 生成区块）、`记忆.base`、逐条审阅弹窗（`memory-review.js`）、三列记忆看板（`memory-board.js`）、记忆索引（`记忆/索引.md`）、40 字 slug 与来源块号 `^mem-*`（已为 33 条修复 10 处漂移行号、补齐双向 `- ⤴ [[记忆/…]]` 回链、0 条孤儿）。
- **记忆体检与基础注入（Q1 / B1 / B4）**：`记忆：体检` 输出无来源/待审/重复/待复核清单；派发时按词面重合 `≥2 词`、`≤5 条`、`≤1200 字` 注入（33 条真库探针 6 例：2 命中、0 噪音、4 不注入）；`agentText` 去 `**`/注释/零宽字符并保留代码块与双链，单条注入从 290 字瘦身至 193 字。
- **运行时记忆查询 CLI（D3 最小壳）**：`scripts/memory-query.mjs` 支持 `search`/`read`/`recent`、`--since/--until` 时间窗、`supersedes` 双向取代链、一跳同源记忆与原文绝对路径；只印命中词理由不印分数；随 `npm run install:plugin` 安装并在派发顶部附加一行提示。
- **派发载荷、草稿与富化闭环**：`委派：先生成草稿`（`📝` 挂回块，派发优先消费草稿并标 `status: dispatched`）；`payloadSnapshot` 先富化再落盘并按块号命名 `派发/日期-^块号-slug.md`；`enrichPrompt` 过滤代码块/行内代码/自身载荷、注入引用笔记绝对路径与 134 张技能卡（`技能/*.md`）真实路径；载荷 30 天归档与 hash 改动留痕。
- **回复协议与信箱**：笔记内 `❓ / ✍️ 答 / 💬` 三行一轮问答 + `^ad-q-*`/`^ad-a-*` 派生锚点（注入前剥除）+ 最近 3 轮问答自动回灌 + 入站 12 行窗口自动捕获提问 + 侧栏非模态「回复信箱」（`reply-inbox-view.js` 焦点归还、草稿不丢）。
- **规划、看板与运行护栏**：Planner（目标 → 可解析 `task.md`）、文件级看板（`taskBoardFiles`）、工作台总览（`工作台.md`）、管家可配置 + `stewardWatch` 15 分钟卡住中途提醒、`session-tree.js` 父子会话树、确认框临时切换工作模式/沙箱、`updateNote` 笔记已删除防御守卫、以及 `model.title` 引用崩溃修复。

> **M0 遗留未实测空白**：Windows 全端、记忆看板真实拖拽落点、管家开关 UI 视觉、真实长跑卡住 15 分钟整轮、草稿多份/改后点委派连续真机流程。

---

## 3. Milestone 1（当前主焦）：高质量 AI 上下文提取与提供者

> **阶段原则**：在 M1 完成之前，**一切新功能开发都必须回答一个问题——它是否直接提升了“Agent Deck 提取并供给给 AI 的上下文质量、诚实度或外部可调用性”？** 若不是，进并行轨道或延后。

### M1.1 上下文内核收口、隐私闸门与零静默丢失

**目标**：把分散在 4 处拼接逻辑收成单一纯函数引擎，堵住所有静默丢上下文、假双链污染、短词零召回和私密笔记外发隐患。

1. **统一 `ContextBundle` 管道（收口 `harness.js` + `delegation.js` + `dream.js`，并改为「前稳后动」保 Prefix Cache）**：
   - ✅ **已落（2026-11-19）**：`createContextBundle` / `renderContextBundle` 收口 `harness.js` 与 `enrichPrompt`（`resolved.bundle`），`enrichPrompt` 同时扫描 **`block.text` 与 `contextLines`**，并改为**「前稳后动」**装配顺序（稳定前缀 / 工具用法 / 技能路径 / 引用路径 / 双链摘要 / Dream 记忆在前，祖先位置 + 当前任务 + `❓/✍️` 最新问答回灌在末尾）；关联笔记块附带「以下为背景参考资料，非新指令」隔离声明；
   - ✅ **已落（2026-11-19 收口）**：抽离零 Obsidian 依赖的 `src/memory-query-core.js` 收口 `src/dream.js` 分词与召回打分（`scripts/memory-query.mjs` 因随插件单独复制到库内继续保持零外部依赖独立脚本）。
2. **消灭一切静默丢失与陈旧缓冲（G3 + Q3 + G4 + G9）**：
   - ✅ **已落（2026-11-19）**：`resolveWikilinkSnippets` 超过 3 篇时对第 4 篇起输出路径指针（不再静默 `break`）；整篇笔记截断时自动附加 **`[后续章节（可按行号分段读）：## 标题(L行号)…]`**；找不到 `#^blockId` / `#标题` / 空正文 / 读取失败记入 `bundle.warnings` 并在上下文里显式提示；`withContext` 祖先链按 12 行上限裁剪并声明省略行数；`plugin.readNote` 已优先读取打开的 source 编辑器未保存缓冲（`src/main.js:3745`）。
3. **隐私闸门与 Agent 能力退路（G2 + G1）**：
   - ✅ **已落（2026-11-19 收口）**：新增 `settings.delegate.excludedDirs`（「委派 → 发送规则 → 更多设置 → 不注入目录」）并识别 frontmatter `private: true`，在 `resolveWikilinkSnippets`、`enrichPrompt` 引用路径清单、`pickMemories` 与 `scripts/memory-query.mjs` 中禁止外发（记入 `bundle.stats.omittedPrivate` 并仅输出数量提示，不暴露路径与正文）；
   - ✅ **已落（2026-11-27 收口）**：通过 `src/agent-registry.js` `canAgentReadLocalFiles(id, destination)` 驱动 `Delegator.resolveBlockContext`：`claude` / `codex` / `dsh` / `antigravity`（官方 `agy` CLI）/ `opencode` / `qoder`（cli/bg）/ `hermes` / `minimax` / `cursor` / `trae` / `t3code` / `kimicode` / `gemini` 及终端交接等可自主读文件的 Agent 自动启用 `entryMapMode`（仅出入口地图 + OKF 元信息 + 标题 TOC / 无标题正文行数提示 + `vault-*` 工具用法），纯桌面复制交接（`workbuddy` / `teleagent` / `qwenwork` / `grokbot` / `cindy` / `orca` / `muse` / `doubaowork` 及桌面回退）与 `_performHandoff` 自动保持摘要内联。
4. **修复两项直接伤上下文的源码问题（检索盲区 + `MAT-479`）、索引泄露过滤与归属/丢弃补盲**：
   - ✅ **已落（2026-11-19 收口）**：`src/memory-query-core.js` 保持中文二元词 `MIN_MEMORY_OVERLAP = 2` 防噪音，同时补充**单英文技术词元（≥4 字符非停用词）与元数据通道（`tags` / `domain` / `type` / 同源 `sources`）**，解决 `esbuild` / `Windows` 等单词在 `pickMemories` 零召回的问题；
   - **清掉上游双链/块号污染（源自 `MAT-479`）**：统一 `💬` 写入器的转义规则（关闭同步时不留裸 `#词` / `[[…]]` 生成假标签和假双链），并统一 `🔗` 行与任务块的缩进解析，确保抽取到的上下文块不串行；
   - ✅ **已补 `renderMemoryIndex` 与 `renderMemoryList` 过滤分组（2026-11-26）**：`renderMemoryIndex` 只收录 `state === "有效"` 且非 `private: true` 的条目并按 `kind`/项目分组汇总；`renderMemoryList` 同步排除 `private: true`；
   - ✅ **已补 `handoff` 统一注入与 `Dreaming` `dropped` 透出（2026-11-26）**：`Delegator.handoff` / `handoffCli` 统一走 `resolveDispatchFolder` 与 `enrichPrompt`；`Dreaming.run()` 透出 `dropped` 数量与原因并在总结、看板与诊断报告中可见。
5. **无 UI 上下文账本（G5 + `MAT-631` 轻量部分）**：
   - ✅ **半落（2026-11-26）**：`Delegator.delegate` 已自动将 `bundle.stats`（含 `memoryIds` / `memoryCount`）写入 `job.contextStats`，`ConfirmSendModal` 新增可折叠「将注入记忆」预览与剔除；⏳ 待补 ACPRunner `job.contextUsed / job.contextSize` 侧栏卡片渲染。

**M1.1 验收标准**：
- `npm test` 新增单测断言：第 4 篇双链显式列路径、坏 `#^id`/`#标题`/读失败显式报错、`private: true` 与排除目录 0 泄露、祖先链双链进入路径清单、单英文词通过元数据/精确词命中、`ContextBundle` 脱离 Obsidian 定时器/UI 运行；
- 真实库验证：派发前故意修改未保存编辑器内容能立刻进上下文；关闭同步写入含 `#` 的 AI 回复不再产生假标签。

---

### M1.2 结构保真、锚点校验与派发前透明预览

**目标**：让注入的入口地图带出笔记的“结构语义”，用锚点 hash 防止引用漂移，并让用户在点击派发前看清“到底带了哪些上下文”。

1. **节点属性摘要注入（Q5 + 契约 §4）**：
   - 改变 `src/harness.js:169` 一刀切掉 frontmatter 的做法：只读提取 4–6 个高信噪比字段映射为轻量摘要行——`type`、`def`（缺失时退取首段首句，库内已有 1336 篇 `def`）、`domain` / `category`、`father`、以及 `status` / `verified` 存在性；**不整块 dump YAML，不要求改写已有笔记，容忍未知字段**。
   - **正文为空时退到反链块（概念页 = 正文 + 反链）**：库里概念页大多由日记里的双链块长出来，正文本身是空的，内容在反链面板里。2026-11-18 扫描：`Concepts/` + 根目录散页共 1665 篇，正文 ≤ 50 字的 1049 篇，其中 995 篇有反链；这些反链 3495 条来自日记、1399 条来自其他概念页。现行代码遇到空正文直接 `continue`（`src/harness.js:172`），Agent 只拿到一个打开是空的路径。改为按 **`def` → 正文 → 反链块** 逐级退：
     - **取块单位**：含 `[[X]]` 的那一行 + 它的子块；链接若在子块里，再带一行母块当面包屑（对应库内「术语作母块、相关表述作子块」的写法）。只有 `- [[X]]` 而没有子块的，只算标记，不内联、只计数。
     - **信号强弱（按位置，不打分）**：先剥掉列表符、复选框、任务关键词、标题 `#`、行尾块号与注释，再看链接两侧——**链接单独站在块的开头或结尾都是强信号**（开头是「这块讲的就是 X」，结尾相当于给这块贴的标签；连在一起的多个链接视为一组，如 `[[等待尝试]][[护肤]]`）；**两侧都有正文、嵌在句子中间的是弱信号**（`……是一个[[心理学]]术语`，这块其实在讲别的）。日记实测：独占一行 2855、块首 7165、块尾 1663、句中 6732，强信号约占 63%。已知误差：句号后的句首提及（`？[[自我决定论]] 认为……`）会被判成句中，只是排得靠后、不会被丢。**符号扩展（`#tag`）**：支持识别 `#tag` 等原生符号作为范围筛选与强弱辅助信号（例如在反链筛选或任务块里显式标注关注切面），与 `[[双链]]` 共同构成零新语法的显式上下文控制。
     - **排序与 `why`**：强信号在前，同档内日记日期新的在前（反映「用户最近在关心这个实体的什么」）；每条带人话 `why`，如「块首 · 2023-07-29 日记」「句中提及 · 人物/项飙」，**不输出分数**。
     - **预算与省略声明**：内联最多 3 块、每块约 200 字（按整行截断），其余只列软锚点指针（路径 + 行号 + 首行 hash，**不为读取去给原文补 `^id`**），并写明「共 N 条反链，已内联 3 条，其余：…」。
     - **宽泛领域词不展开**：反链超过阈值（默认 30，如 `心理学` 128、`社会学` 95、`文学` 79）时不内联，只写一行「宽泛领域词，N 条反链，可按需查询」——这类链接通常表示「属于哪个领域」，不是要它的内容。
     - **去重**：按规范化正文 hash 去重（实测 `日记/2023_07_29.md` L57 与 L112 是同一段）。
     - **排除 AI 回声**：`💬` AI 自动记录行，以及 `Agent Deck/` 下的 `派发/`、`任务/`、`记忆/`、`Answers/` 不作反链来源，避免把 AI 之前的总结当成用户原话再喂回去（同「载荷不作 Dream 二次证据」的理由）。
     - **隐私**：日记默认可作反链来源，但遵守 M1.1 的 `private: true` 与用户指定的排除目录；本次带上的每条日记块都进第 4 项的上下文预览清单，发送前可逐条取消勾选。
     - **数据来源**：插件内用 `metadataCache.resolvedLinks` 找来源文件、`getFileCache().links` 取链接行号，不做全库扫描；M1.3 纯 Node 内核需自建反链索引，与 §8.3 第 2 条 `vault_find` 的 mtime 增量缓存共用同一份。
2. **通用软/硬锚点 hash 与漂移检查（D1 + Q7 + 契约 §3）**：
   - 派发时在 job / 载荷机器侧保存目标块及被引用块的 `ref = { target, subpath, anchor: { kind, hash } }`：有 `^id` 走硬锚点，无 `^id` 用「标题路径 + 首行规范化 sha256 前 8 位」作软锚点，**绝不为只读去改用户正文加块号**；
   - 续聊或运行时二次读取时先校验 hash：漂移时返回明确警告并附最近候选（标题 + 首行），绝不拿文件开头冒充；**续聊重派同步**：若检测到上次派发读过的 `[[笔记]]` 已被用户修改，直接在追问末尾注入 `⚠️ 原文已变更` 状态提醒，防止 Agent 迷信早期会话历史里的旧版内容（或被外层防重逻辑阻断重读）。
3. **一跳结构邻接图与 `sons` 只读推导（D6 最小切片 + 契约 §5）**：
   - 以 `father` 作为唯一声明源，`sons` 仅作只读推导（按 2026-11-18 全库扫描数据：`father` 21 篇、`sons` 43 篇、`0` 互反）；
   - 从当前任务双链与所属项目节点出发，按「**显式结构边（`father`/`domain`）> 共享 `sources` > 共同邻居 > `usage_count`**」给出最多 8 条一跳邻居提示，每条带人话 `why`，**不输出分数**。
4. **派发前「上下文预览与剔除」+ 项目级入口上下文（收编 `MAT-628` 高价值切片）**：
   - 在现有 `ConfirmSendModal` 内新增**默认折叠的轻量明细**（`本次携带上下文：N 条记忆 · M 篇笔记 · K 项警告`，不做独立重型弹窗），展开后每条记忆标明类型角标（`[项目经验]` / `[偏好]` / `[事实]` / `[待验证]`），支持单条取消勾选本次不想发给模型的记忆或关联笔记，作为分流判定后的零摩擦人工兜底；
   - 当任务通过 `projectFolders` 命中已登记项目且库内存在对应项目主页/规则笔记（如 `[[项目名]]`）时，允许把该主页的 `def` 与核心摘要并入预览清单。
5. **派发前「未链接提及」提示（写时消歧，并入第 4 项的预览区，不新开界面）**：
   - **为什么**：双链的价值是让用户在写的那一刻点名实体（`[[Agent Deck]]` 就是库里那个 Agent Deck，不让模型猜）；但用户常常忘了加 `[[]]`。把 Obsidian 自带的「未链接提及」逻辑挪到派发确认框，用户点一下就完成消歧——比 M1.3 让 `vault_find` 事后按词去搜更准，因为最清楚指的是哪个的只有用户自己。
   - **匹配范围**：只扫当前任务块里用户手写的文字；跳过代码块、行内代码、已有 `[[…]]` / `![[…]]`、URL 与内部标识。候选来自 `metadataCache` 的笔记文件名 + frontmatter `aliases`；排除 `日记/`、`Agent Deck/` 下的派发/任务/记忆产物，以及 M1.1 隐私闸门命中的 `private: true` 与排除目录。
   - **防误报**：最长匹配优先（`Agent Deck` 先于 `Agent`）；英文按词边界、大小写不敏感，最短 3 个字符；中文最短 2 个字（单字名一律不提示）；每次最多 5 条。
   - **展示**：每条一行：`agent deck → [[Agent Deck]]`，附该笔记的 `def` 或首句帮助确认。同名多篇时列出全部候选让用户选，**不自动挑**；被链笔记正文为空时不说它「没内容」，改为显示「正文为空，内容在 N 条反链里」（库里多数概念页的内容在反链，见 2026-11-18 用户反馈）。
   - **动作**：默认**不勾选**、绝不自动改写。用户勾选后，只把任务块里**第一次出现**的那处包成双链；大小写或写法与文件名不同时用别名保留原文（`[[Agent Deck|agent deck]]`），整批改写只占一步撤销，然后重新解析本次上下文。这样写进笔记的链接会留下反链，下次派发也能直接用。
   - **边界**：拖拽直发（不弹确认框）时不提示也不改写，只在 job 的 `contextStats` 里记一个 `unlinkedMentions` 计数，用来判断这个功能值不值得往别处扩。

**M1.2 验收标准**：
- 单测覆盖：frontmatter 4–6 键摘要抽取与未知键容忍；空正文概念页按 `def` → 正文 → 反链块逐级退，块首 / 块尾 / 独占且带子块判强、句中判弱，强信号排在前，超过 30 条反链只出一行领域词说明，重复块只出一次，`💬` 行与 `Agent Deck/` 产物 0 进入，超预算必有「共 N 条，已内联 M 条」声明；50 组软/硬锚点在块移动、删块、改标题、重名 id 四类扰动下 100% 检出漂移；`related` 8 条输出全带 `kind` + `why` 且可复现；未链接提及在代码块 / 行内代码 / 已有双链 / URL 内 0 命中，最长匹配优先，`aliases` 能命中，同名多篇返回全部候选，单字中文名不提示，`private` / 排除目录 0 提示；
- 真实库验证：在 `ConfirmSendModal` 里肉眼可见本次命中的记忆与双链列表，剔除 1 条后生成的载荷文件确认不包含该条；任务里写「改一下 agent deck 的 README」时，确认框提示 `[[Agent Deck]]`，勾选后原行变为 `[[Agent Deck|agent deck]]`、一次撤销可还原，且新载荷包含该笔记的摘录与路径。

---

### M1.3 对外供给引擎：纯 Node CLI + stdio Vault Context MCP Server

**目标**：让 Agent Deck 从“Obsidian 插件内自产自销的提示词拼接器”，升级为**任何客户端（Claude Code / Codex / DSH / OpenCode / 未来独立 App）都能按需调用的标准只读上下文提供者**。

1. **剥离 Obsidian API 的纯 Node 内核（D9 副产品）——✅ 已落地（2026-11-26–27）**：
   - 已在 `src/context-core/`（`config.js` / `note-hygiene.js` / `vault-index.js` / `fts-index.js` / `memory-ops.js` / `vault-ops.js` / `mcp-clients.js` / `cli.js` / `mcp.js` / `index.js`）实现零 Obsidian `App`/`Vault`/DOM 依赖的纯 Node 内核，统一支持 `.outline-journal`、`.obsidian`、`--config-dir` 与纯 Markdown 目录，维护 `~/.agent-deck/index/` 可丢弃增量 JSON + Built-in `node:sqlite` FTS5 `trigram` 全文索引（`INDEX_VERSION = 2` / `FTS_SCHEMA_VERSION = 2`，支持 `--index-dir` 与 O(1) `peekVaultIndexStatus`，老 Node 自动降级 `json-fallback`）；`note-hygiene.js`（取代早期 `ai-filter.js`）作为统一净化叶子模块严格隔离 `private: true`、日记内 AI 自动记录子树（`🤖`/`💬`/`第N轮`/`⏱`/`📋`/`🔗`/`❓`/`<!-- ad-* -->`，保留手写内容与 `✍️ 答`）及 `Agent Deck/` 下插件生成文件与记忆库文件（已沉淀记忆统一走 `memory_*`），并修复 `src/memory-store.js` CRLF 解析；
   - `src/main.js` 挂载轻量 `this.contextCore` 门面（`index.js` 导出 `mcpSettingsOf`/`peekVaultIndexStatus` 等并刻意省略 `vault-ops.js` 以将 `main.js` 控制在 `3.5 MB` 部署预算内；CLI/MCP 脚本直接消费 `vault-ops.js`，`vaultRead` 预留 `readOverride` 兼容未落盘编辑缓冲）。
2. **完整库级只读工具集 + stdio MCP Server + 一键接入本机客户端（D3 + 契约 §8）——✅ 已落地（2026-11-26–27）**：
   - `esbuild.config.mjs` 四入口单源打包 `main.js`、`styles.css`、`scripts/memory-query.mjs`（`ASSET_VERSION = 9`）与 `scripts/memory-mcp.mjs`（`ASSET_VERSION = 8`），MCP 默认严格只读暴露 5 个 `memory_*` 工具 + 4 个 `vault_*` 工具 + `memory://index`（`--allow-write` 可选开放 `memory_propose`）；Dream 页新增 5 项显性 `dream.mcp` 控制（`toolsMode` 动态切换 `all` 9 工具 / `memory-only` 仅 `memory_*` 5 工具以搭配 Obsidian 官方 Connectors、持久化 `allowWrite`、`excludeAiLogs` 默认 `true` 配合 `DEFAULTS.dream.scope = "ai-records"` 实现全库检索与 Dream 提炼双向隔离、O(1) 索引状态与一键重建、可编辑外部 Agent 自动触发提示词 `agentPrompt`）；
   - 新增全库 4 动词（CLI 与 MCP 共用同一内核）：`vault_outline`、`vault_read`、`vault_related`、`vault_find`（已接入 SQLite FTS5 `trigram` 正文短语与两字回退检出，返回高亮 `片段：` 且保持严格无私密泄漏）；
   - **跨平台路径与 9 家客户端一键接入**：`mcp-clients.js` + 设置页 Dream「外部 Agent 接入」卡片支持自动探测并备份无损写入 **9 家客户端**——Claude Code（`~/.claude.json`）、Codex（TOML）、Cursor、Antigravity、Claude Desktop、Gemini CLI、OpenCode（`~/.config/opencode/opencode.json` `mcp.servers`）及 DeepSeek Harness（Desktop & ACP `cordis.patch.yml` 无损块编辑）+ 一键「检测握手」与 CLI `mcp-clients`/`mcp-install`/`mcp-uninstall`。
3. **入口地图预算裁剪、中英预算校准、仓库规则分工与真机呼出率验证（D2 + 索引导航）——🟢 代码、离线评测与隔离 3 客户端 6 任务实测已落地，日常 20 次生产派发抽检待持续积累**：
   - `src/harness.js` 已落地中英加权 `estimateTokens`、外围预算自动压缩（永不截断用户任务块并明示可用 `vault_outline` / `vault_read` 按需拉取）与按 Agent 能力自动分流的 `entryMapMode`（单篇长笔记引用实测从 `326 → 208` tokens、`eval-context.mjs` `SpecDoc` 从 `339 → 148` tokens，零静默丢失）；
   - `src/delegation.js` 已落地 `detectRepoRuleFiles` 识别外部工作目录 `AGENTS.md` / `CLAUDE.md` 并向 `memoryToolHint()` 注入「仓内规范以规则文件为准，跨仓经验/全库上下文按需调 `vault-*` / MCP」与项目入口指针；
   - **隔离真机呼出率实测（2026-11-27，macOS arm64）**：在 `/tmp` 隔离 Vault 构造 4 篇深章节测试笔记（确保入口地图不包含深层答案），用真实生成的 `entryMapMode` prompt 实测 3 家外部 Agent 各 2 任务（共 6 次）：**Antigravity 官方 `agy` CLI（2/2 读路径 + 命中）**、**DeepSeek Harness `dsh acp`（2/2 调 `read` 读路径 + 命中）**、**Codex `codex exec -m gpt-6.1-sol --sandbox read-only`（2/2 主动读取 + 命中，其中 1 次显式调用 `memory-query.mjs vault-read`）**——总计 **6/6（100%）路径/工具主动呼出且 6/6 零脑补精确作答**。后续日常真实 Vault 派发满 20 次再做自然工况抽检。

**M1.3 验收标准**：
- 纯 Node 环境（零 Obsidian 模拟对象）跑通 `src/context-core` 与 MCP 工具单测；
- 启动 stdio MCP Server，实测至少 2 家客户端（如 Claude Code 与 DSH）在**不内联全文**的任务下主动调用 `vault_outline` / `vault_read` / `memory_search` 完成任务；
- **效果止损检查（抽检 20 次真实派发）**：初始注入体积较基线（~1800 字）明显下降，且路径/工具生效率 `≥ 40%`；若连续抽检低于 `20%`（说明模型不爱调工具或 MCP 接入阻力大），立即退回“强化结构化内联摘要 + 保留人工/CLI 查询”，不继续堆工具动词。

---

## 4. Milestone 2：上下文可信度、证据链与知识维护闭环

> **前置条件**：M1 验收通过、真实库日常稳定使用。核心回答：**供给给 AI 的材料是不是过时、孤立或自相矛盾？**

1. **M2.1 记忆四维正交字段升级、任务域分流与容量归档（D4 深化 + 契约 §10.1 + G7）**：
   - 把当前单字段 `状态`（`有效`/`已拒绝`/`已被替代`）拆为四个正交维度：`status`（`active`/`deprecated`）、`verified[]`（无 / 非 `human:` / 含 `human:`，对应 unverified / machine-confirmed / human-reviewed）、`supersedes`/`superseded_by`、`verdict`（`pending`/`confirmed`/`refuted`）；
   - 四类记忆按各自生命周期流转：事实可被确认或证伪；偏好用 `valid_from` / `valid_until` 封口而非伪装成“错误被替代”；待验证规律走 `verdict`；项目经验带 `applies_to`；
   - ✅ **零成本任务域分流已落（2026-11-26）**：`resolveDispatchFolder` 识别项目上下文传入 `Dreaming.contextSection` → `pickMemoriesFromEntries({ projectName, isCodeProject })`：
     - **工程/代码域任务**：加权当前项目 `lesson` 与通用偏好，降低个人生活/通用非工程条目的干扰；
     - **个人/写作/复盘/规划域任务**（`cwd === vaultPath`）：优先召回个人 `fact / preference / pattern`；
     - **纯通用外部知识问答**（无项目且无词元命中）：保持 **0 注入**，不硬塞记忆；
   - ✅ **YAML 契约与 `reconcile` 改写边界已落（2026-11-26）**：`rewriteSources` 统一用 `yamlStr` 加引号，`writeEntry` 保留 `supersedes / project / tags / verified / private`；`reconcile` 基于已加载路径对齐，避免编辑措辞误标 `已被拒绝`/`已拒绝`；`state.processed` 按有序去重窗口保留至多 5000 条历史 key 不随 14 天扫描丢弃。
   - ✅ **OKF v0.2 + Graph-Native 融合架构、1–2 跳图谱检索、归档与 `log.md` 已落（2026-11-26）**：`memory-graph.js` / `memory-store.js` / `dream.js` / `memory-query-core.js` / `scripts/memory-query.mjs` (`ASSET_VERSION = 5`) / `scripts/memory-mcp.mjs` (`ASSET_VERSION = 4`) 统一支持扁平 Bases 兼容 OKF 字段与纯 `"[[...]]"` YAML 图谱边（`concepts` / `project_link` / `source_notes` / `conflicts_with` / `supersedes` / `superseded_by`）、短命题节点命名（`preferShort` + 引号保护 + `polishShortTitles`）、零向量 `1–2` 跳概念图谱扩展召回、`graph` CLI 动词与 `memory_graph` MCP 工具；`Dreaming.consolidate` 自动双向写入 `conflicts_with` 并支持超期失效记忆自动归档至 `<dir>/archive/`（可恢复且 CLI/MCP `--all`/`include_inactive` 可查）；`Dreaming.backfillOkfMetadata` 支持 0-Token 补齐已有记忆/图谱边与短命名重命名；`applyMemoryGraphPreset` 支持按动态 `dream.dir` 应用 `kind` / `trust` 双视角图谱配色与 `-path:"<dir>/archive"` 过滤；`run`/`consolidate`/`backfill`/`archive` 自动追加 `<dir>/log.md`；`harness.js` `extractOkfHeader` 在整篇引用笔记内联时附极简 1 行 `[元信息：…]`。
2. **M2.2 全库结构体检、缺口扫描与冲突检测（D8 缺口 + B2/B3/B5/B7/B8/B11）**：
   - ✅ **近重/同源冲突、概念升格建议、锚点分口与睡眠整理已落（2026-11-26）**：`Dreaming.audit()` 补充 `nearDuplicates`、`sameSourcePairs`、`verifiedCount`、`unanchoredVaultSources` vs `externalImportSources`、`conflicting`、`archivedCount`/`archivableCount`、`conceptPromotions`（B11 聚团 `≥ 5` 建议）与按 `kind` 分布；`Dreaming.consolidate()` 支持一键周期性合并去重、更新 `supersedes` 链、写入双向 `conflicts_with` 与项目归属。
   - **断链与待写概念扫描（零依赖快赢）**：扫全库 `father` 与 `domain` 指向不存在的笔记（2026-11-18 实测合计 34 条待写概念），出清单但不阻塞派发；
   - ⏳ **待补衍生统计**：超过 N 个月未复核的老化队列（B5）、近 N 天日记提炼覆盖率（B8）。
3. **M2.3 零负担证据链与多端轮次原因（D5 + `MAT-633`）**：
   - **L0/L1 先行，不强改写作习惯**：日记保持 L0 免脚注；先做从现有 `[[X]]` 反推 `sources` 的推导器，且**强制标 `derived: backlink` 并降置信**（绝不把“提到 X”伪装成“源自 X”）；
   - **L2 可选脚注**：对重要概念/AI 结论支持 `[^s1]` + `sources[].id` 稳定键 + `matchVerbatimQuote` 逐字核验，核不上必须报“无法核实”；若 4 周内新写 L2 笔记 `< 5` 篇，立即触发止损退回纯推导模式；
   - **收编 `MAT-633`**：补齐 Claude Code / Codex JSONL 的中断与额度结束原因识别（对齐 DSH `r.aborted` / `r.quota`），防止空白轮次或报错轮次污染记忆提炼与结论上下文。

---

## 5. Milestone 3：双向回写复利、按条共享与全平台底座

> **前置条件**：M2 可信度机制验证有效。核心实现“用过一次的上下文，下次更好用且能安全跨端/跨工具共享”。

1. **M3.1 上下文使用留痕、高信噪比回写与离线轨迹门禁（D7 + B9 + 自改进闭环）**：
   - job 与目录级 `log.md`（date-grouped `Creation` / `Update` / `Deprecation`，不依赖 git diff）记录本次派发与 MCP 实际读取了哪些文件、哪些记忆；
   - 结论块可选挂机读溯源注释 `<!-- ad-attest: {...} -->`（**未通过 `stripInternalIdentifiers` 剥除单测前不得合入**）；
   - Dreaming 优先从“已核验结论 + 实际读取范围 + 派发草稿/载荷中人改过的差异 + 报错纠偏后通过的闭环”提炼新记忆；工程类 `lesson` 引导收敛为「触发条件/症状 → 规则/修法」紧凑句式（保留 `matchVerbatimQuote` 逐字核验）；接入 B9 注入审计（统计哪些记忆频繁命中且真被引用）；
   - **离线轨迹诊断与 Eval 门禁（借鉴 *Self-Improving Memory* Stage 1）**：补齐 `continueSession`、`handoff` 与 `Dreaming.run()` 接入 `RunTrace`（含 `ClaudeRunner` / `QoderRunner` 关键事件帧与 `dropped` 计数），定期基于 `RunTrace` + 会话日志 + 审阅拒绝记录抓取「重复探索同一项目 / 跨会话重复报错 / 注入未用或拒绝复发」样本，脱敏沉淀进 `scripts/eval-context.mjs` Golden 集并保留基线快照；**严禁无评测自动改写 Dreaming Prompt 或召回权重**，任何策略迭代须经 `npm run eval` 实测指标上升才合入。
2. **M3.2 Dream 记忆按条共享发布层（[`dream-shared-memory.md`](dream-shared-memory.md) + G8）**：
   - 私有记忆增加 `scope: private|shared`（默认严格私有，旧文件不迁移）与 `audience: []`（发布筛选，文档明示不是访问控制）；
   - 实现 `发布预览` → 幂等复制到 `Agent Deck/共享记忆/`（不软链，防 iCloud/git 断链）→ `_published.md` hash 与按 id 差集删除（可证明撤销）→ 一键撤销共享；
   - 为 M1.3 的 MCP/CLI 增加 `--scope shared` / `scope=shared` 参数，让外部 Agent 与其他客户端只见共享层；
   - 将 v1 单文件快照导出与 Telegram Companion 联动（G8 `profileWithDream`）切换为从共享层生成，实测不覆盖手写档案。
3. **M3.3 可重放审计与独立客户端底座（D8 可重放 + D9/G10）**：
   - job 序列化完整注入清单与各自 hash，支持 1 秒内回放任意历史派发当时模型究竟看到了哪一版笔记；
   - 依托 M1.3 冻结的纯 Node 上下文引擎与多库 `vault?` 字段，为独立客户端（如 Electron / 桌面 App）提供零重写迁移底座。

---

## 6. 并行工程轨道与现阶段“明确冻结”边界

### 6.1 并行轨道（不阻塞 M1，可独立窗口或由协作者推进）

| 轨道 | 事项 | 说明与边界 |
| --- | --- | --- |
| **轨道 W：Windows 跨平台实测** | `feat/win-compat`（`84b8c01`）评估合入 `main` + Windows 实机验收（`src/platform.js`、`.cmd` shim、Windows Terminal/PowerShell、`APPDATA` 路径、`sqlite3.exe` 降级、Cursor Hooks、`memory-query`/MCP 脚本引号与路径） | **必须赶在 M1.3 定型前完成基础路径契约验证**，否则跨平台上下文提供者在 Windows 不可用；注意当前 `feat/win-compat` 落后 `main` 45+ 提交，合入前需专门 rebase/冲突清理 |
| **轨道 A：Agent 委派、追踪与终端矩阵扩展（既有能力纵深扩展）** | 1. **新增 Agent 委派/记录/追踪**：接入 **Hermes Agent**、**千问（Qwen）**、**Kimi Code**、**ZCode**、**MiniMax Code（客户端 + CLI）**（以及既定 **Muse** `MAT-629`、**Pi**）；按 `agent-ingestors.js` + `agent-registry.js` + `delegation-runners.js` 扩展点接入，优先只读追踪/记录/用量，有稳定 CLI/ACP 再接委派。<br>2. **Claude 客户端直接委派**：突破当前仅依赖 `claude` CLI + 首轮后 `claude://resume` 跳桌面的模式，调研并打通对 **Claude 桌面客户端**的直接委派发任务与追踪闭环。<br>3. **更多终端支持**：将 `src/delegation.js` 目前硬编码的 5 家终端（`herdr` / `tern` / `iterm` / `warp` / `terminal`）抽象为表驱动终端注册表，补齐 Ghostty、WezTerm、Kitty、Alacritty 及 Windows Terminal / PowerShell 等终端。 | 属于既有追踪/委派能力的横向深入，与 M1 上下文主线**互补但不相互阻塞**；M1.3 冻结 stdio Context MCP 后，新增 Agent 可零改造成本直接接入同一套上下文提供者。仍遵守 `acp-integration.zh-CN.md` 三原则与“缺失 token 绝不估算”红线。 |
| **轨道 T1：既有追踪与核验（高优维护）** | `MAT-629` Muse 会话追踪、`MAT-630` Claude CLI 全链路复核 | 按现有 `agent-ingestors.js` / `agent-registry.js` 规范推进，不改动 `harness.js` 主干 |
| **轨道 T2：既定分支收口与体验债（低优，M1 后再排）** | `MAT-622` Cursor Windows 实测、`MAT-623` 阅读视图评估、`MAT-624` 分形看板剩余说明整理、`MAT-625` Dashboard 任务闭环率、`MAT-631` 工具时间线/推理面板、`MAT-632` ACP 流式回写与 `allow_always`、`MAT-479` 其余重构（token 累加、设置样板、面板 HTML 性能） | 均排在 M1 之后，避免分散注意力 |

### 6.2 现阶段明确冻结（M1 验收前不动）

1. **暂停 D10（全库级稳定画像提炼）**：远期三层架构保留在本文件 §7.2 备案，但在 M1 供给引擎稳固前不动手——画像一旦提取偏差会全局污染每一次派发，且全库摘要调用云端模型成本高。
2. **暂停新增工作台 / 看板 / 编排类大特性**：Planner、文件看板、管家汇总+看护、子代理树、回复信箱刚密集落地，先在日常使用中消化并修真机 bug，不再开新战线。
3. **暂停继续产出长篇前瞻 spec**：当前 `docs/specs/` 已有 14 份文档，文档已明显超前于代码集成度；后续改为**每交付一个 M1 子里程碑同步更新一次 spec 与 `task-workflow.zh-CN.md`**。
4. **暂停技能卡双向写回**：`技能/*.md` 保持只读侧影（保留 `body_hash` 保护手改注释），不写回外部 `SKILL.md`。

### 6.3 永久红线与“明确不做”清单

- **七条红线**：① 正文只写 Obsidian 原生语法，机器锚点/hash 不写进 `.md`；② 不静默丢上下文，任何裁剪/失败必须声明；③ 不存“关联分数”，只存可解释信号（`why`）；④ 锚点漂移必报，绝不拿文件开头冒充；⑤ 内部标识只占 `ad-` 命名空间且注入前剥除（`^mem-*` 与 6 位号不剥除）；⑥ 不新增必填字段，缺字段容忍降级；⑦ 缺失 token 与活跃耗时绝不估算。
- **五条明确不做**：① 不在插件内做全功能对话宿主（模型交给各家 Agent）；② 不把向量/embedding 检索当主路径；③ 不要求全库或日记满足 OKF 合规（日记保持 L0）；④ 不自造 Markdown / Dataview 私有语法；⑤ 不在公共层为单一 Agent 写特殊分支（差异留在 `agent-registry` 与适配器层）。

---

## 7. 全量功能与编号映射索引（确保零遗漏）

### 7.1 历史方向 `D1–D10` / `Q1–Q8` / `B1–B12` / `G1–G10` / Linear 归属表

| 原编号 | 内容 | 当前归属 / 状态 |
| --- | --- | --- |
| **Q1** / **Q6** / **B1** / **B4** | 记忆按相关度注入、一文一条记忆库（33 条 + Base + 看板 + 审阅）、待审队列、无来源红线 | ✅ **M0 已落地** |
| **Q2 / Q3** | 第 4 篇起改指针不静默截断、裁剪显式省略声明 | 🎯 **M1.1** |
| **Q4** / **D8 缺口** | 断链与未写概念扫描（`father` 21 / `sons` 43 / 34 条断链） | ⏳ **M2.2**（零依赖，可提前随时跑） |
| **Q5** / **D2** | frontmatter 核心 4–6 键摘要、六段固定入口地图与预算裁剪 | 🎯 **M1.2 → M1.3** |
| **Q7 / D1** | 软/硬锚点 hash（`^id` + 标题路径/首行指纹）与漂移校验 | 🎯 **M1.2** |
| **Q8** | 兄弟项与有序列表标记进入祖先链 | 🎯 **M1.1 / M1.2**（需回归既有派发单测） |
| **D3** | 运行时工具层（`memory_search/read/recent` CLI 已落地；补 `vault_outline/read/related/find` + stdio MCP） | ✅ 雏形在 M0 → 🎯 **M1.3** 完整落地 |
| **D4** | 一文一条记忆库（✅ M0） + 四维字段拆解与生命周期流转 | ✅ 存储已迁 → ⏳ **M2.1** |
| **D5** | 证据链：L0/L1 回链反推（标 `derived: backlink`）+ L2 可选脚注 `[^id]` + `matchVerbatimQuote` | ⏳ **M2.3** |
| **D6** | 结构图与关联：`father` 单向、`sons` 只读推导、信号排序 + `why` | 🎯 **M1.2**（一跳只读视图先落） |
| **（新）未链接提及** | 派发确认框提示任务里没加 `[[]]` 的库内笔记名，用户勾选后就地链上（写时消歧） | 🎯 **M1.2**（并入第 4 项上下文预览，`vault_find` 为运行时兜底） |
| **（新）反链块退路** | 概念页正文为空时，按位置信号（块首/块尾强、句中弱）取反链块作上下文 | 🎯 **M1.2**（并入第 1 项属性摘要；M1.3 纯 Node 版共用 `vault_find` 索引） |
| **D7** | 回写闭环：`ad-attest`、目录 `log.md`、job 读取清单进 Dream | ⏳ **M3.1** |
| **D8 可重放** | 任意历史 job 1 秒还原当时注入清单与 hash | ⏳ **M3.3** |
| **D9** | 解耦与独立客户端接口（`resolveTarget` / `readConcept` 纯 Node 化） | 🎯 **M1.3**（作为 MCP 内核副产品先冻签名）→ **M3.3** |
| **D10** | 全库稳定画像 / 领域地图（L1/L2/L3，见 §7.2 远期储备） | 🧊 **M2 之后再评估（现阶段冻结）** |
| **B2 / B3 / B5 / B6 / B8 / B9 / B10 / B11 / B12** | 类型/规律统计、老化队列、取代链（`memory-query` 已支持）、冲突检测 B7、覆盖率、注入审计、主题演化、升格概念、排除清单（合并 G2） | B6 已入 M0 CLI；B12 并入 **M1.1**；其余在 **M2.2 / M3.1** |
| **G1 / G2 / G3 / G4 / G5 / G9** | Agent 能力退路、隐私排除、零静默报错、未落盘编辑器缓冲、注入账本、长笔记祖先链截断 | 🎯 **M1.1** |
| **G6** | 内部状态词（`DOING`/`🤖`/`❓`）派发侧选择性清理 | 🎯 **M1.1**（随 `ContextBundle` 清洗边界一起做） |
| **G7 / G8 / G10** | 记忆超期归档、Companion `profileWithDream` 联动测试、多 Vault `ref.vault?` 预留 | G10 在 **M1.3** 预留；G7 在 **M2.1**；G8 在 **M3.2** |
| **Linear open cards** | `MAT-628`（Context Pack）、`MAT-479`（技术债）、`MAT-629/630`（Muse/Claude CLI）、`MAT-631/632/633`（ACP/结束原因）、`MAT-625`（Dashboard 闭环）、`MAT-622/623/624`（已主干发版、余下测试/收尾） | 已分别挂入 **M1.1/M1.2**、**M2.3** 与 **并行轨道 W/T** |

### 7.2 远期储备备案：D10 全库画像三层设计（冻结中，待 M2 后评估）

保留原设计以免失传，但**M1 期间不动手**：

- **三层拆分（成本差两个数量级）**：
  - **L1 稳定画像**（职业/身份/长期偏好）：全库抽样核心笔记 frontmatter + 首段，季度级云端模型提炼（几万 token/次），**仅写作/选题/复盘/规划注入**（改代码任务不注入以免污染语气）；
  - **L2 领域地图**（双链最密概念）：纯图统计、零模型，只算概念笔记间边（排除日记/流水/归档），按跨笔记类型分布与跨月稳定性过滤，仅选题/写文章/整理概念注入；
  - **L3 当下关注**：复用 Dream 近 14–30 天记忆（已有），每次派发按相关度注入。
- **硬约束**：每条画像一文件一字段（`status: proposed/confirmed/rejected`、`sources` 必填、`proposed` 永不进 prompt、`rejected` 永不重生、只写可观察行为证据不贴人格标签）；跑前必须明示篇数/字数/目标模型，支持排除目录、分批可中断可续跑。

---

## 8. 风险、退出条件、回滚与效果判据

### 8.1 风险与止损线（行为风险优先级高于技术风险）

| 类别 | 涉及阶段 | 具体风险 | 退出条件 / 止损线 |
| --- | --- | --- | --- |
| **行为** | **M1.3 MCP / 入口地图** | Agent 忽略路径指针与 MCP 工具，仍只吃 prompt | 抽检 20 次真实派发若指针/工具调用率 `< 20%`（或连续 3 个月 `< 10%`），停止扩充动词，退回“精简结构化内联摘要 + 人工/CLI 辅查” |
| **行为** | **M1 全局** | M1.1 + M1.2 完成后，连续 2 周日常派发体感没有变准，或用户自己频繁绕过 | 立即冻结 M1.3 与 M2，复盘真实失败案例是“抽错、缺字段还是噪音”，不盲目加新功能 |
| **行为** | **M2.3 证据链** | 要求写脚注改变写作习惯导致弃用 | 4 周内新写 L2 笔记 `< 5` 篇 → 退出手写要求，全量退回“从双链反推 + 标 `derived: backlink`” |
| **技术** | **M1.1 隐私与缓冲** | `private: true` / 排除目录漏网外发，或读缓冲破坏既有派发 | 一旦发生 1 次私密外发 bug，视为 P0 缺陷立刻停用注入直至补齐回归测试 |
| **技术** | **M2.1 四维迁移** | 改动历史 `记忆/*.md` 结构 | 迁移前**必须备份 `data.json` 与 `Agent Deck/记忆/`**；回滚 = 恢复备份 + 回退解析器 |
| **技术** | **M3.1 `ad-attest`** | 内部注释漏剥进 prompt | 未通过 `stripInternalIdentifiers` 单测断言不得合入 |
| **技术** | **轨道 W Windows** | `feat/win-compat` 与 `main` 冲突过大或 MCP 路径转义失败 | 先确保 Windows 实机跑通基础加载与路径归一化，再开启 M1.3 MCP 跨端宣传 |

### 8.2 可观测效果判据（不加新 UI 即可采集）

| 判据 | 采集方式 | 目标值 | 支撑阶段 |
| --- | --- | --- | --- |
| **零静默丢失** | `npm test` 断言坏锚点/超预算/读失败输出声明 | 100% 声明、0 静默吞错 | M1.1 / M1.2 |
| **隐私 0 泄露** | `npm test` 断言 `private` / 排除目录不入 bundle/CLI/MCP | 0 泄露 | M1.1 / M1.3 |
| **初始注入体积** | job `contextStats.injectedChars` 统计 | 单次控制在 `≤ 800–1200 字`（不含任务代码块） | M1.1 → M1.3 |
| **未缓存输入效率** | Dashboard 总览 `fresh`（未缓存输入）与 `fresh / turns`（注：现行 `cacheHitRate = cached/(fresh+cached)` 在长会话里普遍为 96%–99%，仅作粗略结构参考，不能直接反映每次是否失效重算） | 同体量连续任务中 `fresh / turns` 下降、不因改前缀触发重算 | M1.1 → M1.3 |
| **指针 / 工具生效率** | 抽检 20 次派发日志，统计是否打开注入路径或调 MCP | `≥ 40%`（<20% 触发止损） | M1.3 |
| **漂移捕获** | 派发后故意修改/移动目标块再读 | 100% 报漂移，0 静默错读 | M1.2 |
| **可解释性** | 抽检 `vault_related` / `memory_search` 结果 | 100% 带 `why`，0 黑盒分数 | M1.2 / M1.3 |
| **记忆维护活跃度** | 每周人工确认/修正/拒绝数 + 拒绝复发数 | 周审 `≥ 1`，拒绝复发 `= 0` | M0 / M2 |
| **回写留痕与可重放** | job 中“读过文件”非空比例 + 历史回放耗时 | `≥ 80%` 非空；`< 1s` 还原 | M3 |

> **刻意不进主表的指标**：「隔两周同类任务命中率是否上升（上下文复利）」。因“同类任务”缺乏客观定义，只作为观察笔记，不作验收卡点。

### 8.2.1 生产四要素工程基线（Eval / Trace / Deploy / Security）

| 支柱 | 当前落地机制 | 核心守门边界 | 后续 M1.3 / M2 演进位 |
| --- | --- | --- | --- |
| **Eval（评测）** | `scripts/eval-context.mjs` + `test/context-eval.test.mjs`（`npm run eval`） | 记忆召回率 `≥ 0.9`、精确率 `≥ 0.8`、隐私 0 泄露、0 静默丢失、KV-Cache 前缀字节 0 漂移 | 随 M1.2 反链块信号与 M1.3 `vault_find` 扩充脱敏 Golden 样本集；M2 补入任务域分流样例；M3 接入 `RunTrace` 失败轨迹回流与基线版本对比，作为 Prompt/召回改动的硬门禁 |
| **Trace（可观测）** | `src/trace.js`（`RunTrace` + 30 条协议帧环形缓冲 + `~/.agent-deck/traces/*.jsonl`）与 `export-diagnostics` 命令 | 单次派发生成 `traceId` 串联 `context.resolve` / `payload.snapshot` / ACP 权限决策 / 错误分类（`classifyError`），日志自动脱敏且失败不阻断主流程 | M1.3 接入 MCP/指针实际读取追踪，反哺「指针生效率 ≥ 40%」判据；M3 补齐 `continueSession` / `handoff` / `Dreaming` 接入 `RunTrace` 与非 ACP 工具帧，支撑离线诊断 |
| **Deploy（部署）** | `.github/workflows/ci.yml`（`ubuntu`/`macos`/`windows` 三端矩阵 + `swiftc -typecheck`）与 `scripts/check-deploy.mjs`（`npm run check:deploy`） | 版本号三处对齐、`main.js ≤ 3.5MB` / `styles.css ≤ 512KB` 体积预算、`MEMORY_QUERY_ASSET_VERSION` 与库内 `memory-query.mjs` 一致性校验 | M2.1 记忆四维迁移前强制自动备份至 `.agent-deck/backups/`；Windows 实机真库验收 |
| **Security（安全）** | `src/security.js` + `src/llm.js` + `src/delegation.js` + `src/delegation-runners.js` + `src/main.js` | API Key 支持 `env:VAR` / `secret:key`（`~/.agent-deck/secrets.json` `0600`）避免明文进同步盘；`evaluatePermissionPolicy` 在 `autoApprove=true` 时仍对高危 shell、敏感路径（`.ssh`/`.aws`/`.env`）与越界写删强制升阶确认；`appleScriptString` 与独立 Warp YAML 名防注入与覆盖竞争 | M1.3 stdio Context MCP 对所有输入路径做 `realpath` 防穿越校验，统一过 `private: true` 与 `excludedDirs` 闸门 |

### 8.3 未决问题清单（需在对应节点前拍板）

| # | 问题 | 阻塞阶段 | 建议默认 | 必须拍板节点 |
| --- | --- | --- | --- | --- |
| 1 | `ContextBundle` 里技能卡多技能引用（当前只认首个 `skill`）是否进 M1.1 | M1.1 | 允许列出多个显式 `[[技能/…]]` 路径，默认上限 3 个 | M1.1 开工前 |
| 2 | `vault_find` 扫描 5486 篇全库的索引方式（实时遍历 vs 轻量 mtime 缓存索引） | M1.3 | ✅ **已落地**：纯 Node `vault-index.js` + `fts-index.js` 维护 `~/.agent-deck/index/*.json` + `node:sqlite` FTS5 增量索引（老 Node 自动回退 `json-fallback`） | 已完成 |
| 3 | `feat/win-compat` 是直接 rebase 到 `main` 还是按 `src/platform.js` 分批重接 | 轨道 W | 先基于 `main` 评估冲突，按 `platform.js` + `delegation` + `readers` 拆 2–3 个小 PR 合入 | Windows 实机测试前 |
| 4 | `def` → `description` 单向映射还是双向同步（1336 篇已用 `def`） | M1.2 | 单向只读映射，不要求改库里既有 `def` | M1.2 开工前 |
| 5 | `dream-shared-memory.md` 的 `audience` 是发布筛选还是运行时过滤、`共享记忆/` 是否进 git | M3.2 | 发布筛选（简明可证），共享目录默认不自动推公开仓库 | M3.2 开工前 |
| 6 | 未链接提及的中文最短匹配长度（2 字会命中「排版」「风控」这类常用词概念页，误报可能偏多） | M1.2 | 先用 2 字 + 默认不勾选 + 每次最多 5 条，真库试用 2 周后看误报再调 | M1.2 开工前 |
| 7 | M2.1 `verified[]`/`sources[]`/`generated` 嵌套 YAML 与当前单层正则解析器（`memory-store.js` / `memory-query.mjs`）及 Bases 的兼容方案 | M2.1 | 尽量保持 Bases 友好的扁平字段 + 紧凑字符串编码；若启用嵌套对象，必须同步升级 `memory-store.js` 与 `memory-query.mjs` 解析器 | M2.1 开工前 |

---

## 9. 迭代与自审记录

### v1 → v2（结构审计）
- 为每条方向补齐**现状代价**、复杂度四维表（标注仅 D4 迁数据、仅 D4/D6/D7 改契约）、最小 20% 切片、§8 效果判据，并合并 D9 为 D3 副产品。

### v2 → v3（执行审计）
- 增加风险退出条件（区分为概率更高的**行为风险**与**技术风险**）；修正 D5 反推必须标 `derived: backlink`；拆分 D8（缺口零依赖 vs 可重放依赖 D1/D2）；新增 M0.5 快赢；补充 `2026-11-18` 一文一条迁移与 20+ 已落地能力记录及 G1–G10。

### v3 → v4 第 1 轮迭代（代码与 Linear 对齐重构）
- **出发点**：用户明确目标为“先定 Milestone，第一阶段先把 Agent Deck 建成高质量的 AI 上下文提取和提供者”；同时昨晚今早已有 20 个新提交落地。
- **对齐与发现**：
  1. 读源码（`harness.js`、`delegation.js`、`dream.js`、`memory-query.mjs`）发现“双轨拼装分裂、祖先链漏扫、4 处静默跳过、frontmatter 被切光、单英文词零召回、`terms()` 双份复制”等具体代码病灶，原 v3 路线图里并没标出。
  2. 对照 Linear `P-MAT-42` 把 `MAT-628`（派发前可见可勾选上下文包）、`MAT-479`（`💬` 双写手污染与 `🔗` 解析统一）、`MAT-631`（ACP 上下文用量字段浪费）、`MAT-633`（其他端中断/额度原因）以及 `feat/win-compat` 未合并现状全部纳入各自合理的 Milestone。
  3. 补上 `vault_find` 动词设计，解决 `memory-query` 只查 33 条记忆、查不到 5486 篇正文/概念笔记的缺口。

### v3 → v4 第 2 轮迭代（反膨胀与可执行性压力测试）
- **砍掉了什么臃肿设计**：
  1. **削减 `MAT-628` 的 UI 膨胀风险**：第 1 轮曾考虑做完整的项目 Context Pack 独立界面；第 2 轮审视后砍掉重型界面，收口为在现有 `ConfirmSendModal` 里加一个**默认折叠的轻量预览/取消勾选列表**（最小改动验证价值）。
  2. **拒绝把 `MAT-479` 整单拖进 M1.1**：`MAT-479` 包含 token 累加、设置样板、面板 HTML 性能等大量历史重构；第 2 轮仅剥离出直接破坏上下文提取的 2 项（`💬` 双写手污染、`🔗`/块定位解析统一），其余全部留在并行维护轨道，防止 M1.1 失焦。
  3. **收紧 M1.3 止损门限与接入摩擦**：如果只写 MCP Server 而不提供“一键配置/状态探测”，用户根本不配 MCP 就会误判方向失效；同时将“指针/工具调用率 < 20% 退回结构化内联”设为硬止损，避免在 Agent 不配合的情况下死磕工具协议。
  4. **把 D10 全库画像、新看板/工作台拓展、Dream 共享发布层全部明确标为 M1 期间冻结项**，确保每一天工时都集中打穿“高质量上下文提取与提供”这一个靶心。
  5. **补入既有能力的纵深并行轨道（轨道 A）**：把 Hermes Agent、千问、Kimi Code、ZCode、MiniMax Code（客户端 + CLI）、Claude 客户端直接委派与更多终端支持单独成轨，既不打断 M1 主焦，又明确它们可零改造复用 M1.3 的 stdio Context MCP。

### v4 → v4.1（2026-11-19，对齐 Self-Improving Memory 启发与任务域分流）
- **保留与拒绝**：明确不采用 Stage 2 模型权重/LoRA 微调（维持外部供给层定位），重点吸收 Stage 1「差异化记忆策略 + 入口索引导航 + 轨迹诊断 + Eval 硬门禁」：
  1. **M1.1 补缺**：发现 `renderMemoryIndex()`（`src/memory-store.js`）未过滤 `private: true` 与非 `有效` 条目且无分组，纳入 M1.1 收口修复；
  2. **M1.2 / M1.3 联动**：`ConfirmSendModal` 预览列表标出记忆类型角标（`[项目经验]`/`[偏好]`/`[事实]`/`[待验证]`）；`memoryToolHint()` 与 MCP 入口提示带出分组后的 `索引.md` 导航或项目 Quickstart 指针；
  3. **M2.1 任务域分流**：复用 `resolveDispatchFolder`（`cwd !== vaultPath` / `projectFolders`）与 `[[双链]]`/`domain` 零成本自动分辨工程域、个人/写作域与纯通用问答，实现 `lesson` 与个人 `fact/preference/pattern` 的池子分权（保留跨任务交互偏好、通用问答保持 0 注入）；
  4. **M3.1 轨迹诊断与 Eval 门禁**：打通 `RunTrace` → 脱敏 Golden 集 → `npm run eval` 门禁，禁止无评测自动改写 Dreaming Prompt 或召回权重；
  5. **源码核查工程债务补录**：将 `handoff` 项目归属、`Dreaming` `dropped` 计数透出与 `state.processed` 保留、`continueSession` 与非 ACP runner 接入 `RunTrace`、M2.1 YAML 单层/嵌套解析契约同步、以及中英混排加权预算与仓库 `AGENTS.md` 分工纳入对应 Milestone 与 §8.3 未决清单。

### v4.1 → v4.2（2026-11-22，吸收 `obsidian-agent-client` 5 项生态借鉴）
对照 `RAIT-09/obsidian-agent-client`（Apache-2.0）梳理 5 项高价值能力并按 Agent Deck 原则分流：
1. **P0 自定义 ACP Agent 通用入口（✅ 已落地）**：新增 `src/custom-acp.js` 与 `settings.customAcpAgents`，设置页「委派 → 自定义 ACP Agent」支持配置任意 ACP CLI 命令、参数与环境变量（值走 `resolveSecret` 支持 `secret:KEY` / `env:VAR`，不落明文），动态注册进 `AGENTS` / `AGENT_ORDER` / `CAPABILITIES` 与 `@` 路由，免发版接入 Gemini CLI / Kiro / Mistral Vibe / Pi 等新 CLI。
2. **P1 会话级上下文占用指示器 + 会话 Fork（→ `MAT-631` / `MAT-632`）**：仅在日志或 ACP 协议返回真实 token 且已知模型上下文上限时在侧栏会话卡与 `FollowUpModal` 展示占用条（缺失绝不估算）；按能力位 `fork` 逐家开放 Claude `--fork-session` 与支持 fork 的 ACP 分支续聊，子会话自动纳入 `parentSid` 父子树。
3. **P1/P2 Obsidian Keychain 存储 API Key（→ §8.2.1 Security 演进）**：桌面端优先使用 Obsidian Keychain / Electron `safeStorage`（`keychain:` 后端），保留 `secret:`（`~/.agent-deck/secrets.json`）与 `env:` 给纯 Node 脚本、离线评测与测试兜底。
4. **P2 Windows WSL 模式（→ 轨道 W `MAT-643`）**：在 Windows 下提供 `wsl.exe -d <distro>` 启动封装、Windows ↔ `/mnt/<drive>/...` 双向路径转换（含 `cwd` 与注入笔记/技能路径），并支持从 `\\wsl$\<distro>\...` 读取会话日志。
5. **P2 选区行号级临时上下文 + 笔记内一键派发代码块（→ M1.2 / 轨道 T）**：派发瞬间附带编辑器精确选区行号范围（落盘引用仍坚持 `[[笔记#^块号]]` 防漂移）；支持 ```` ```agent-deck ```` 代码块渲染「派发 / 生成草稿」按钮，复用 `ConfirmSendModal` 且保持 Markdown 唯一正本。
