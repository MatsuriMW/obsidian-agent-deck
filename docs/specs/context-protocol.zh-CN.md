# 双链上下文协议（草案 v0.1）

> 状态：**M1.1–M1.3 已在 `src/context-core/`、`src/harness.js`、`src/delegation.js` 落地（2026-11-26）；M2（四维正交字段 / 断言级 `sources` 核验）与 M3 仍为规划草案**。本文件定义契约与边界，全链路流转与装配图见 [`information-flow.zh-CN.md`](information-flow.zh-CN.md)。

## 1. 定位

把"笔记库"从**被检索的素材**升级为 agent 的**运行时上下文环境**：派发时只给一张入口地图，agent 在运行中按需读取、按需追溯来源；结论写回时带上可核验的出处与信任标注，形成下次派发可复用的知识节点。

三条来源的关系：

| 来源 | 提供什么 | 不提供什么 |
| --- | --- | --- |
| Obsidian 双链笔记 | 用户手工标注的结构（大纲层级、块引用、双链、属性） | 机器可判定的信任与新鲜度 |
| OKF v0.2 | 信任/来源/生命周期/版本的自描述字段 | 检索策略（spec 明确列为 non-goal） |
| Agent Deck harness | 派发、运行时工具、回写 | 知识格式（不自造） |

**不自造格式**：能与 OKF 对齐的字段一律用 OKF v0.2 的键名与语义；不能用 OKF 表达的部分（Obsidian 原生链接语法、块号命名空间）用**转换层**处理，不发明平行字段。

## 2. Obsidian 原生语法基线（硬约束）

用户继续用 Obsidian 记笔记，同时用客户端派发。**笔记正文里只允许出现 Obsidian 原生可渲染的语法**，自定义引用语法（如 `path#^id@hash`）不得写进 `.md`。

必须无损支持的语法：

| 语法 | 形态 | 说明 |
| --- | --- | --- |
| 双链 | `[[笔记]]`、`[[笔记\|别名]]`、`[[笔记#标题]]`、`[[笔记#^块号]]`、`[[#标题]]` | 名字解析（name-based），移动文件不破；**块首 / 块尾 / 独占带子块判强信号，句中提及判弱信号** |
| 嵌入 | `![[笔记]]`、`![[笔记#标题]]`、`![[图.png]]` | 上下文解析时按引用计入，统计时仍排除镜像 |
| 块号 | 行尾 `^block-id`（字母/数字/连字符） | 文件内唯一，跨文件用 `[[文件#^id]]` |
| 属性 | YAML frontmatter，支持 Obsidian 属性类型（文本、列表、数字、日期、链接、tags） | 现有 `domain`/`def`/`type`/`father` 等全部保留 |
| 脚注 | `[^id]` + `[^id]: 定义` | **证据链的载体**（见 §6），Obsidian 原生渲染 |
| 标注块 | `> [!note] 标题` | 解析时标为 callout，不参与大纲层级 |
| 标签 | `#tag`、`tags:` / `tag:` 属性 | 与 OKF `tags` 合并，并作为范围筛选与强弱辅助信号（不含 `💬` 内未转义假标签） |
| 注释 | `%%行内%%` / 块级 | 正文解析剥离；不得作为证据来源 |
| 大纲 | `- ` / `1.` / `1)` 缩进嵌套 | 层级只由缩进决定，序号只作顺序语义 |

不支持/不写：dataview 查询语法、插件专有内联语法（外部插件的 `:::` 之类）。遇到即原样保留、不解释。

## 3. 锚点引用协议

### 3.1 内部表示（机器侧，不写进笔记）

```text
ref := { target, subpath?, anchor?: { kind, hash } }
target  := 笔记路径（库内相对路径，含 .md 或不含均可），派发时立即解析为绝对路径
subpath := "#^<blockId>" | "#<标题>" | 空
kind    := hard（有块号）| soft（无块号，用标题路径 + 内容指纹）
hash    := 锚点文本规范化后的 sha256 前 8 位
```

- **canonical 身份是路径**，不是显示名：同名笔记按 Obsidian 的最短路径规则解析后立刻固化为路径。原始文本保留，用于回写时还原成用户写法。
- **复合键** `path#^blockId` 是唯一的可引用身份；文件内块号重复视为数据异常，取首个并记一条警告。
- 派发时把 `hash` 写进 job 记录与注入清单，**不写进笔记**。

### 3.2 缺失块号时的软锚点

笔记里大多数块没有 `^id`。不为读操作补写块号（避免无谓写入），改用软锚点：

```text
soft anchor := 标题路径（章节 > 子章节）+ 首行内容规范化后 hash
```

读取时校验 soft anchor：命中则用；不命中则**明确返回「锚点已漂移」**并附「当前最近的候选（标题 + 首行）」，由 agent 决定是否重新读取。禁止"找不到就返回文件开头"这类静默降级。

### 3.3 校验语义

运行中每次 `read(ref)` 都返回 `changedSinceDispatch: boolean`（用 hash 比对）。为 `true` 时附带一行提示：原文已变，注入的摘要可能过期，需要重新确认。

## 4. 节点元信息：现有字段 → OKF 子集

**只读映射，不要求改库**。派发时按此表把现有属性归一化成统一结构，供 agent 消费。

| 现有属性 | OKF 键 | 处理 |
| --- | --- | --- |
| `def` | `description` | 单句摘要；缺失时退到首段首句 |
| `type`（人物/书/选题/工具…） | `type` | 原值保留，不注册中心词表（OKF 明确要求消费方容忍未知 type） |
| `domain` | 自定义键 `domain`（不映射到 `tags`） | 结构边，参与关联权重 |
| `category` | 自定义键 `category` | 同上 |
| `father` | 自定义键 `father` | 结构边，**单向声明**（见 §5） |
| `sons` | 派生视图，不读原字段 | 见 §5 |
| `aliases` | `title` 的候选 | 显示名优先 `title`，其次首个 alias，其次文件名 |
| `related` / `related to` | 无直接对应 | 视为弱结构边，权重低于 `domain`/`father` |
| `tags` | `tags` | 合并 |
| 其余未知键 | 原样保留 | 不丢弃、不报错（OKF §11） |

派发注入时**只带 4–6 个键**：`type`、`description`（或 `def`）、`domain`/`category`、`status`/`verified` 的存在性。不整块 dump frontmatter。

## 5. `father` 单向化与 `sons` 只读推导

- **唯一声明源 = `father`**（子笔记声明父笔记）。
- `sons` 不再作为输入：父笔记的"子概念列表"由全库扫描推导（`father` 指向我的笔记）。
- 推导视图**默认不写回**任何笔记；需要落盘时作为生成文件，不与手写属性混存。
- 断链容忍：`father` 指向不存在的笔记 = 待写概念，标注而不是报错（OKF §6.1）。

已知数据现状（扫描 5486 篇，2026-11-18）：`father` 21 篇、`sons` 43 篇、两者共存 0 篇；`sons` 声明的 57 个子项里回指一致 0 个，其中 8 个项目标不存在；`father` 的父笔记里只有 2 次在 `sons` 中被列出。这组数据是本次单向化决策的依据。

## 6. 证据链：断言级归因

把 `[[X]]` 从"提到 X"升级为"这句断言源自 X 的某处"，载体是 **Obsidian 原生脚注**。

### 6.1 笔记里的写法（全部原生）

```markdown
---
type: 概念
def: "把译文再译回原语言、对照原文学习的方法"
domain: ["[[英语学习]]"]
father: "[[英语学习]]"
sources:
  - id: s1
    resource: "[[日记/2026_11_13#^abc123]]"
    author: "human:chenchen"
generated: { by: "human:chenchen", at: "2026-11-13T08:00:00Z" }
verified: { by: "human:chenchen", at: "2026-11-14T09:00:00Z" }
status: stable
---

回译能同时暴露原语与译语的差异。[^s1]

[^s1]: 见 [[日记/2026_11_13#^abc123]]：译文再译回原语言后与原文逐句对照。
```

要点：

- 脚注标记在句末，脚注定义里放**可点击的双链**——Obsidian 阅读视图里能直接跳转，人用不受影响。
- `sources[].id` 与脚注标签是同一个键。**用 id 不用位置索引**：agent 反复改写文档时，位置索引一重排就静默错配（OKF §5.1 的理由）。
- `resource` 存 `"[[X#^id]]"` 字符串（Obsidian 链接型属性），既是人可点链接，也是机器可解析引用。

### 6.2 运行时怎么用

1. agent 读到 `[^s1]` → 在 frontmatter `sources` 里按 `id` 查到 `resource`。
2. `read("[[日记/2026_11_13#^abc123]]")` → 拿到原文那一块（不是整篇）。
3. 逐字比对：只要断言声称"摘自某处"，注入层就随包提供原文摘录，agent 可机械核对 `原文.includes(摘录)`。此机制在 Dreaming 已实现（`matchVerbatimQuote`），本次是把同一套核验从"记忆整理"推广到"通用写作与派发"。
4. 核不上 → agent 有义务标明"无法核实"，而不是照抄。

### 6.3 分档要求（避免写作成本爆炸）

不是每句话都要挂脚注：

| 档 | 场景 | 要求 |
| --- | --- | --- |
| L0 | 日记流水、随手记 | 不要求任何归因 |
| L1 | 概念笔记的定义句、结论句 | 建议至少一个 `sources`，不强制脚注 |
| L2 | 可被引用/反驳的断言、AI 产出的结论 | 必须脚注 + `sources[].id` |

## 7. 派发注入层（一次性，预算受限，前稳后动）

派发时注入的不是"上下文内容"，而是**入口地图**。装配顺序按**跨轮次稳定度「前稳后动」**排列以保护模型 Prefix Cache（KV Cache）；`src/harness.js` 已实现轻量中英加权 `estimateTokens()`（中文 1.25 / ASCII 0.28）、默认外围预算 `DEFAULT_PERIPHERAL_TOKEN_BUDGET = 950`、超限时仅压缩外围引用并**显式声明可用 `vault_outline` / `vault_read` 按需展开**（永不截断用户任务块与对话问答），以及 `entryMapMode`（仅注入 `[[双链]]` 路径、OKF 摘要、标题行号 TOC 或无标题正文行数提示，由 `agent-registry.js` `canAgentReadLocalFiles(agent, destination)` 对能自主读文件的 CLI/ACP 后台与终端 Agent 自动启用，纯桌面/剪贴板交接保留摘要内联）；`src/delegation.js` 通过 `detectRepoRuleFiles()` 自动识别代码仓库根 `AGENTS.md`/`CLAUDE.md` 与 `memoryToolHint()` 分工（详图见 [`information-flow.zh-CN.md`](information-flow.zh-CN.md) 图 2）。

| 顺序 | 内容 | 上限 / 规则 |
| --- | --- | --- |
| 1 | **最稳前缀**：全局指令 + 可用工具/MCP 用法 + 技能卡路径 | 固定不变（不插动态问答或时间戳） |
| 2 | **次稳入口**：本文属性摘要（§4 的 4–6 键）+ 祖先链（母项正文 + 续行，不带兄弟分支） | 属性 300 字；祖先链 ≤ 12 行 |
| 3 | **引用外置**：`[[双链]]` 摘录（截断时附 `## 标题(L行号)` 目录；正文为空时按 `def` → 正文 → 强/弱反链块退路）+ 邻居清单 + 证据清单 | 反链 ≤ 3 块 × 200 字（>30 条领域词只计数）；邻居 ≤ 8 条 × 60 字；证据 ≤ 5 条 |
| 4 | **动态末端（带资料隔离）**：资料边界声明 + Dream 记忆（按任务域分流） + 当前块原文（去内部标识）+ 最新 `❓/✍️` 问答回灌与变更提醒 | 当前块沿用 6000 字上限；明确标注背景资料非新指令 |

裁剪规则：优先裁减第 3 段的证据/邻居描述/反链展开（只留指针），再裁第 2 段属性摘要。**任何一段被裁剪都必须写一行"已省略 N 条，可用 read()/related() 查"**，长笔记截断必附后续章节行号目录——静默丢弃比不注入更糟。预算已完成向中英加权 `estimateTokens()` 估算收口（消除中英文 4–6 倍偏差）；代码仓库内自带的 `AGENTS.md`/`CLAUDE.md` 负责仓内约束，Agent Deck 记忆负责跨仓经验与个人动态事实，两者分工不叠塞。

### 7.1 Dream 记忆按任务域分流规则（M2，零额外模型成本）

不要求用户手动选择任务类型，也不在派发前调用额外模型分类，直接复用 `resolveDispatchFolder` 与 `[[双链]]`/`domain` 结构信号做作用域加权过滤：

| 判定信号 | 工程域 (`lesson`) | 交互风格类 `preference` | 个人经历 `fact` / 规律 `pattern` |
| --- | --- | --- | --- |
| **工程域**（命中 `projectFolders` 或 `cwd !== vaultPath`，含工程问答） | **优先注入**（命中当前项目加权，附项目 Quickstart / 症状→修法） | **允许保留**（影响回答风格） | **默认过滤**（防噪音污染） |
| **个人 / 写作 / 复盘域**（`cwd === vaultPath` 且含个人或概念上下文） | 仅显式命中技术词时带入 | **优先注入** | **优先注入** |
| **纯通用外部知识问答**（无项目命中且词元未命中记忆） | **0 注入** | **0 注入**（或仅按需保留极简交互偏好） | **0 注入** |

极少数跨界判偏由 `ConfirmSendModal` 折叠预览清单（带类型角标）单条取消勾选兜底。

## 8. 运行时工具（纯 Node 内核 + CLI v9 + stdio MCP v8）

| 动词 | 输入 | 输出 | 约束 |
| --- | --- | --- | --- |
| `vault_find` (`vault-find`) | `query`, `k=8`, `domain`, `type`, `tag`, `fulltext=true` | 命中的非私密用户笔记路径、OKF 摘要、高亮正文 `片段：` 与命中 `why` | 基于 `node:sqlite` FTS5 `trigram` + 2 字词回退 + 元信息（严格排除 AI 自动记录子树与 `Agent Deck/` 插件生成目录及记忆库文件；不返回分数；混合独特词缺失时不误召回） |
| `vault_outline` (`vault-outline`) | §3 的 `ref` | 标题树、顶层列表类型、OKF 4–6 键摘要与 `^mem-*`/6 位块锚点清单 | 只给结构不带正文，自动跳过 AI 自动记录行，用于"先看目录再决定读哪段" |
| `vault_read` (`vault-read`) | §3 的 `ref` / `start_line` / `max_lines` / `expected_hash` / `include_ai_logs=false` | 正文、行范围、`changedSinceDispatch` 漂移标记、可展开子锚点；空正文页附高信号反链摘要 | 剥离 `^ad-*` 内部块号，保留 `^mem-*` 与 6 位块号；默认过滤 AI 自动记录子树并硬拒绝插件生成文件/记忆库（记忆走 `memory_*`）；超过 30 条反链宽泛词只计数提示缩窄；私密笔记硬拒绝 |
| `vault_related` (`vault-related`) | `ref`, `k=8` | 一跳结构邻居（`father`/推导 `sons`/`domain`/强信号用户反链/出链）+ 关联 Dream 记忆 | 每条必带人话理由（`why`）；不返回分数 |
| `memory_{index,search,read,recent,graph}` + 可选 `--allow-write` `memory_propose` | 见 [`architecture-and-boundaries.md`](architecture-and-boundaries.md) | 长期记忆 目录 / 检索 / 原文溯源 / 近期 / 图谱 1–2 跳（写提案仅落待审） | CLI（[memory-query.mjs](../../scripts/memory-query.mjs) `v9`）与 stdio MCP（[memory-mcp.mjs](../../scripts/memory-mcp.mjs) `v8`）共用零 Obsidian [src/context-core/](../../src/context-core/index.js) 内核 |

> 2026-11-26–27 落地：`src/context-core/`（`note-hygiene.js` 统一净化叶子层，`INDEX_VERSION = 2` / `FTS_SCHEMA_VERSION = 2`）同时兼容 `.obsidian/`、`.outline-journal/`、`--config-dir` 与纯 Markdown 目录，维护 `~/.agent-deck/index/*.json` + `*.fts.sqlite` 可丢弃增量索引（长驻 MCP 带 2.5s 内存 TTL 复用）；**严格落实「AI 自动生成物不视作用户数据」契约**——日记中的 `🤖` 自动记录子树、`💬`/`第N轮`/`Round N`/`⏱`/`📋`/`🔗`/`❓`、`<!-- ad-* -->` 与 `Agent Deck/` 下自动生成目录（含 `派发/`、`Answers/`、`Conversations/`、`Exports/`、`任务/`、`done/`、`记忆/` 及 `长期记忆.md`/`安全审计.md`/`工作台.md`/`记忆-体检.md`）均不进 `docs_fts`、反链图、`vault_find`、`vault_outline` 与默认 `vault_read`，同时保留手写条目与 `✍️ 答：`；已沉淀记忆统一走 `memory_*` 门控服务。`mcp-clients.js` + 设置页实验功能「外部 Agent 接入」支持自动解析真机 `node`（解决 macOS GUI `Obsidian Helper` + 精简 `PATH` 问题）并一键无损写入 **9 家外部客户端**（Claude Code / Codex TOML / Cursor / Antigravity / Claude Desktop / Gemini CLI / OpenCode / DeepSeek Harness Desktop & ACP）及实机握手校验。

## 9. 回写层

- 结论仍写回原任务块（保持现有 🔗 短链 + 结论格式，笔记无损）。
- 日记块没有 frontmatter，因此信任信息走**注释通道**：`<!-- ad-attest: {<OKF 字段子集>} -->`。该注释必须能被 `stripInternalIdentifiers` 剥掉，不进入任何 prompt。
- 值得沉淀的结论可选升级为独立概念文件（`type: 结论`，带完整 OKF 子集），此时 `sources` 指向原日记块。
- 变更历史追加到目录级 `log.md`（date-grouped，`**Update**` / `**Creation**` / `**Deprecation**`），**不走 git diff**：无需子进程、无平台差异、记录语义变更而非文本差异。
- 未在 Obsidian 场景验证的写入路径不得声明双平台通过；Windows 未测时明确标注。

## 10. 信任与新鲜度推导

| 字段 | 推导 | 回落 |
| --- | --- | --- |
| 信任档 | 无 `verified` ⇒ unverified；仅非 `human:` 验证者 ⇒ machine-confirmed；有 `human:` ⇒ human-reviewed | 无字段一律 unverified，不拒绝 |
| 新鲜度 | `now >= stale_after` ⇒ stale | 无 `stale_after` ⇒ 不判断（不猜 TTL） |
| 生命周期 | `status` 缺省 ⇒ stable | `deprecated` 仍可读，但注入时标注"仅供参考，勿作为当前结论" |

Dreaming 记忆的映射：`pattern`（待验证规律）⇒ unverified；用户日志来源亲历 ⇒ `verified: { by: human:… }`；AI 记录来源 ⇒ machine-confirmed。**"待验证"从此是字段，不是形容词。**

## 10.1 记忆的四个正交维度

现在 dream 用一个 `状态` 字段（`有效` / `已拒绝` / `已被替代`）混装四件互不相干的事。"状态机不够用"的根因是字段混装，不是取值太少。拆开之后每个维度都能单独筛选、单独解释。

| 维度 | 字段 | 取值 | 回答什么 | 谁能改 |
| --- | --- | --- | --- | --- |
| 生命周期 | `status` | `active` / `deprecated` | 现在还算不算数 | 用户、dream |
| 可信度 | `verified[]` | 无 / 仅非 `human:` / 含 `human:` | 能信到什么程度 | 用户确认 |
| 谱系 | `supersedes` / `superseded_by` | `[[记忆/…]]` | 被谁换代 | dream、用户 |
| 判定 | `verdict` | `pending` / `confirmed` / `refuted` | 仅"待验证规律"有意义 | 用户 |

四类记忆的流转不同，不能套同一套规则：

| 类型 | 初始 | 可能的流转 | 触发者 |
| --- | --- | --- | --- |
| 事实 | `active` + unverified | → `verified(human:)` 或 → `deprecated` | 用户确认/证伪 |
| 偏好 | `active` + `valid_from` | → 填 `valid_until` 封口，新条目接着开 | 用户更新（**不是替代**） |
| 待验证规律 | `verdict: pending` | → `confirmed` / `refuted` → `deprecated` | 用户判定 |
| 项目经验 | `active` + 适用条件 | → `deprecated`，或条件收窄 | 换项目时 |

## 10.2 画像字段契约

一条画像 = 一个文件 = 一个字段，便于 Base 一行一行展示、逐条勾/叉/改（也是 §D10 的存储前提）。

| 键 | 用途 | 取值 | 必填 |
| --- | --- | --- | --- |
| `type` | 固定为画像 | `画像` | 是 |
| `field` | 字段标识 | 职业 / 身份 / 长期偏好 / 在意什么 / 表达习惯 … | 是 |
| `value` | 字段值（一句人话） | ≤ 200 字 | 是 |
| `status` | 审阅状态 | `proposed` / `confirmed` / `rejected` | 是 |
| `confidence` | 归纳把握 | `low` / `medium` / `high` | 否 |
| `sources` | 证据 | `[[笔记#^块]]` 列表 | 是（`proposed` 至少 1 条） |
| `layer` | 归属层 | `L1` / `L2` / `L3` | 是 |
| `generated` | 谁生成 | `{ by, at }` | 是 |
| `verified` | 用户确认事件 | `[{ by: "human:…", at }]` | 否 |
| `reviewed_at` | 上次审阅时间 | ISO 8601 | 否 |
| `stale_after` | 过期时刻 | ISO 8601 | 否 |
| `supersedes` | 替代的旧字段 | `[[…]]` | 否 |
| `private` | 禁止注入 | `true` | 否 |

硬规则：

1. `status: proposed` **不进入任何 prompt**；只有 `confirmed` 可注入。
2. `rejected` 永不重新生成（复用现有 `reconcile` 的拒绝语义）。
3. `value` 必须能追到 `sources` 里的原文摘录，核不上就降级为 `rejected`——**画像可追溯是它和星座运势的唯一区别**。
4. 性格类字段只写**可观察的行为证据**（"反复在 X 场景下选 Y"），不写人格标签（"你是 INTJ"）。标签不可证伪，也不可纠正。

## 10.3 勾 / 叉 / 编辑的写路径

Bases 是只读视图，**不能承载写操作**，所以三个动作都必须有明确落点：

| 动作 | 界面 | 写入 |
| --- | --- | --- |
| 确认 ✅ | 插件命令或审阅视图按钮 | `status: confirmed` + `verified: [{ by: "human:…", at }]` |
| 拒绝 ❌ | 同上 | `status: rejected` |
| 编辑 ✎ | 直接改文件属性或正文（Obsidian 原生） | 保留 `status`，只更新 `reviewed_at` |
| 批量复审 | Base 按 `reviewed_at` 筛选出队列 | 逐条走上面三个动作 |

## 11. 与现有实现的接缝

| 现有模块 | 复用方式 | 已落地 / 演进点 |
| --- | --- | --- |
| `src/context-core/*` | 零 Obsidian / DOM 纯 Node 内核 | 统一 `.obsidian` / `.outline-journal` / 纯目录、`~/.agent-deck/index/` 增量 JSON + `node:sqlite` FTS5（含 `peekVaultIndexStatus` O(1) 状态探测与手动重建）、`vault_{find,outline,read,related}` + `memory_*`（支持 `dream.mcp.toolsMode` 动态切换 `all` 9 工具 / `memory-only` 5 工具、`dream.mcp.excludeAiLogs` 控制全库检索 AI 记录隔离，以及 `dream.mcp.{allowWrite,agentPrompt}` 持久化）、`mcp-clients.js` 9 家一键接入、CLI `v9` + stdio MCP `v8`（`index.js` 省略 `vault-ops.js` 保持 `main.js` 精简并挂 `this.contextCore`） |
| `src/harness.js` `resolveDelegationContext` | 注入层由它产出 | 已切「前稳后动」`ContextBundle`、中英加权 `estimateTokens`、外围预算压缩、可选 `entryMapMode` 与 `AGENTS.md`/`CLAUDE.md` 分工 |
| `src/harness.js` `resolveWikilinkSnippets` | 保留为兜底 | 超限改指针清单；截断附章节行号目录；OKF 4–6 键摘要；正文为空由 `vaultRead` 退到高信号反链 |
| `src/outline.js` `ancestorLines` / `extractWikilinkRefs` / `frontmatterEnd` | 零改动复用 | 由 `harness.js`、`vault-index.js`、`vault-ops.js` 与 `fts-index.js` 共用 |
| `src/dream.js` `matchVerbatimQuote` / `activeMemory` / `relatedMemories` | 逐字核验与相关度打分直接借到派发侧 | 记忆注入改按 `verified` 分层与任务域分流；`main.js` `dream-memory` resolver 传入 `{ projectName, isCodeProject }`；显式透出 `dropped`、保留 `state.processed` 历史 key 并界定 `reconcile` 改写不误拒 |
| `src/memory-store.js` `renderMemoryIndex` & YAML 解析 | 保留全库标题平铺目录能力与 Bases 兼容 | `renderMemoryIndex` 过滤 `private: true` 与非 `有效` 状态并按 `kind`/域轻量分组；M2.1 前与 `scripts/memory-query.mjs` 统一单层/嵌套 YAML 解析契约 |
| `src/delegation.js` `continueSession` / `handoff` | 复用现有续聊与交接主干 | `continueSession` 与 `handoff` 补齐 `RunTrace`（含非 ACP runner 关键帧）；`handoff` 补走 `resolveDispatchFolder` 获取项目归属 |
| `src/trace.js` + `scripts/eval-context.mjs` | 保留既有轻量 Trace 与离线评测 | M3 接入轨迹失败样本脱敏回流 Golden 集，作为 Prompt/召回迭代门禁 |
| `src/readers.js` `USAGE_CACHE_VERSION` | 不涉及 | 不改 |
| `registerContextResolver` | 个人 schema 走解析器，不进主库 | 不新增硬编码字段 |

## 12. 红线

1. 笔记正文只写 Obsidian 原生语法；自定义引用只活在机器侧。
2. 不静默丢上下文：任何裁剪都要有省略声明。
3. 不存"关联分数"，只存信号，查询时算；每条关联必须可解释（`why`）。
4. 软锚点找不到时明确报漂移，不拿文件开头冒充。
5. 内部注释只能占用 `ad-` 命名空间，且必须可被 `stripInternalIdentifiers` 剥离。
6. 不新增"必须填"的字段；缺字段不得拒绝已有笔记（OKF §11）。
7. 缺数据不估算（沿用现有口径）。
8. 全库合规不做：日记保持 L0，只让被 agent 消费的子集达到 L1/L2。

## 13. 已决与待决问题

- `father` 单向化后，`sons` 派生视图（**已定**）：由 `vault-index.js` 扫描后放内存 `sonsByFather` 派生视图，不写回原笔记。
- 运行时工具形态（**已定**）：stdio MCP（`scripts/memory-mcp.mjs` `v7`）与 CLI（`scripts/memory-query.mjs` `v8`）双出，签名完全一致，同源打包自 `src/context-core/`。
- 独立客户端存储抽象（**已定**）：文件系统 Markdown 正本 + `~/.agent-deck/index/` 可丢弃增量 JSON + SQLite FTS5，已同步至 `Outline Journal` 桌面端共用。
- 待定：`def` → `description` 是否双向同步（当前保持只读兼容映射）；TTL 是否按 `type` 提供推荐默认值（当前仅显式 `stale_after` 参与判定）。
