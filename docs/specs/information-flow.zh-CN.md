# 信息与功能流转（Harness 全链路与上下文治理）

> 状态：**2026-11-19 对齐源码与 M1 规划**（基线：`1.12.2` + 未发版增量；对应模块见 `docs/specs/architecture-and-boundaries.md`）。
> 相关：[`vision-markdown-harness.zh-CN.md`](vision-markdown-harness.zh-CN.md) · [`context-protocol.zh-CN.md`](context-protocol.zh-CN.md) · [`harness-roadmap.zh-CN.md`](harness-roadmap.zh-CN.md) · [`data-and-markdown-contracts.md`](data-and-markdown-contracts.md)
> 五张图：① 一次派发的全链路 ② Prompt 组装顺序（现状 vs 前稳后动）③ 问答闭环（含回复信箱）④ Dream 三条路径 ⑤ 双链包裹上下文与强弱信号治理（M1.2 规划）。

---

## 图 1｜一次派发的全链路

> 核心思路：用户在写任务时用 `[[双链]]` 包裹实体并借位置（块首/块尾 vs 句中）或 `#tag` 标定范围与强弱；委派时由 Harness 把笔记库当作外部存储，只内联高信噪比入口与引用指针，其余按需回查。

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"13px","lineColor":"#8A93A6"}}}%%
flowchart TB
  classDef note fill:#E7F0FB,stroke:#4C7FB0,color:#17324D,stroke-width:1.5px
  classDef plugin fill:#E6F4EA,stroke:#4E8F63,color:#173D22,stroke-width:1.5px
  classDef dream fill:#FFF3DC,stroke:#B8862B,color:#4A340A,stroke-width:1.5px
  classDef agent fill:#F1E8FB,stroke:#7A57A8,color:#2E1B45,stroke-width:1.5px
  classDef write fill:#FDEBEF,stroke:#B25A72,color:#4A1724,stroke-width:1.5px
  classDef inbox fill:#E8F6F8,stroke:#3E8E9A,color:#103A40,stroke-width:1.5px

  U["笔记里的任务块<br/>用 [[双链]] 包裹实体 · #^blockId 硬锚<br/>（可选 📝 派发草稿 / 技能短链）"]:::note
  DIR["项目目录路由<br/>显式 cwd → 笔记项目 → Agent 默认 → 库根"]:::plugin
  C["取块 + 祖先链<br/>剥 ^ad-* 内部标识 · agentText 去噪"]:::plugin
  L["[[双链]] 上下文治理（入口外置）<br/>已做：≤3 篇×600 字 + 第4篇起省略指针<br/>规划：TOC 行号 · 反链块 · #tag 信号"]:::note
  M["★ Dream 记忆段<br/>有效条目 · 词面≥2 · ≤5 条 / 1200 字"]:::dream
  P["ContextBundle（前稳后动）<br/>buildDelegationPayload + enrichPrompt"]:::plugin
  E["按稳→动重渲：前缀 / 入口 / 末端<br/>记入 job.contextStats"]:::plugin
  F["先富化再落盘：派发/*.md<br/>anchor 回指 · 头部提示「以文件为准」"]:::plugin
  A["本机 9 家 Agent 会话<br/>后台 ACP/CLI · 桌面端 · 交互终端"]:::agent
  Q["💬 结论回写<br/>后台 >500 字外存 Answers/*.md"]:::write
  IQ["❓ 入站问句检测<br/>最后 12 行抽提问 + ^ad-q-*"]:::write
  IB["回复信箱（侧栏）<br/>不抢焦点 · stillPending 校验"]:::inbox
  ANS["✍️ 答（回到原位置）<br/>^ad-a-* 派生锚点"]:::write
  W["日记 / 看板 / Dashboard<br/>统计 fresh / out / cached / turns"]:::write

  U --> DIR --> A
  U --> C --> L --> P
  C --> M --> P
  P --> E --> F --> A
  A --> Q --> W --> U
  A --> IQ --> IB --> ANS --> A
  ANS --> W
```

---

## 图 2｜Prompt 组装顺序（已改为「前稳后动」vs 后续 M1.1/M1.2 增量）

> 已从旧版 `enrichPrompt` 头部倒序前置改为 `ContextBundle`（`renderContextBundle`）统一按**前稳后动**渲染：固定提示、技能与引用入口在前，祖先链+当前任务正文及每次会变的 `❓/✍️` 问答回灌放在末尾。注：`delegate()` 写完载荷快照后还会在最外层加一句 `本次任务的完整载荷…` 指针。

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"13px","lineColor":"#8A93A6"}}}%%
flowchart LR
  classDef note fill:#E7F0FB,stroke:#4C7FB0,color:#17324D
  classDef plugin fill:#E6F4EA,stroke:#4E8F63,color:#173D22
  classDef dream fill:#FFF3DC,stroke:#B8862B,color:#4A340A,stroke-width:2px
  classDef write fill:#FDEBEF,stroke:#B25A72,color:#4A1724

  subgraph NOW["当前已实现：ContextBundle（前稳后动）"]
    direction TB
    N1["1. prefix：promptPrefix → memory-query 用法 → 技能 SKILL.md 路径"]:::plugin
    N2["2. entries：引用笔记绝对路径（含祖先链）→ 看板兄弟分工"]:::note
    N3["3. entries：[[双链]] 摘要（≤3 篇 + 第4篇起省略指针）"]:::note
    N4["4. entries：★ Dream 记忆段 & 扩展解析器"]:::dream
    N5["5. tail：祖先位置+任务正文 → ❓/✍️ 问答回灌（末尾）"]:::write
    N6["6. tail：promptSuffix → 来源路径 → confirmFirst"]:::plugin
    N1 --> N2 --> N3 --> N4 --> N5 --> N6
  end

  subgraph NEXT["M1.1 / M1.2 继续补入本管道"]
    direction TB
    T1["+ prefix 补入：MCP 工具提示（M1.3）"]:::plugin
    T2["+ entries 补入：节点 4-6 键属性摘要 & 资料非指令声明"]:::note
    T3["+ entries 补入：截断带 ## 标题(L行号) · 空正文强弱反链 · #tag"]:::note
    T4["+ entries/tail 补入：private 隐私闸门 · 续聊变更漂移提醒"]:::write
    T1 --> T2 --> T3 --> T4
  end
```

---

## 图 3｜问答闭环（三个入口，都写回原位）

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"13px","lineColor":"#8A93A6"}}}%%
flowchart TB
  classDef agent fill:#F1E8FB,stroke:#7A57A8,color:#2E1B45
  classDef write fill:#FDEBEF,stroke:#B25A72,color:#4A1724
  classDef inbox fill:#E8F6F8,stroke:#3E8E9A,color:#103A40
  classDef note fill:#E7F0FB,stroke:#4C7FB0,color:#17324D

  RUN["Agent 跑任务"]:::agent
  ASK["回答最后 12 行含问句"]:::agent
  Q["❓ 第N轮：… ^ad-q-*<br/>自动写进笔记并登记 replyInbox"]:::write
  IB["回复信箱（侧栏，还回焦点）"]:::inbox
  NOTE["笔记里直接手写"]:::note
  MODAL["Ctrl+Alt+R / 任务菜单弹窗"]:::note
  ANS["✍️ 答：… ^ad-a-*<br/>幂等插在 ❓ 下一行"]:::write
  GO["回答并继续<br/>Delegator.continueSession"]:::agent
  R2["下一轮 💬"]:::write

  RUN --> ASK --> Q --> IB
  Q --> NOTE
  Q --> MODAL
  IB --> ANS
  NOTE --> ANS
  MODAL --> ANS
  ANS --> GO --> R2
  R2 -->|又提问| ASK
```

---

## 图 4｜Dream 三条路径（一文一条记忆库 + 按需检索）

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"13px","lineColor":"#8A93A6"}}}%%
flowchart TB
  classDef src fill:#E7F0FB,stroke:#4C7FB0,color:#17324D
  classDef dream fill:#FFF3DC,stroke:#B8862B,color:#4A340A
  classDef mem fill:#E6F4EA,stroke:#4E8F63,color:#173D22
  classDef agent fill:#F1E8FB,stroke:#7A57A8,color:#2E1B45
  classDef tool fill:#E8F6F8,stroke:#3E8E9A,color:#103A40

  J["日记 / AI 记录（Pin 优先入批）"]:::src
  RUN["Dreaming.run<br/>手动 或 60s tick 到期"]:::dream
  FILE["Agent Deck/记忆/*.md<br/>id / kind / state / sources[]"]:::mem
  MEM["^mem- 锚点 + ⤴ 回链<br/>记忆.base / 看板 / 逐条审阅 / 索引.md"]:::mem
  INJ["★ 派发时注入<br/>≥2 词重合，≤5 条 / 1200 字"]:::dream
  PAY["载荷正文（一次性）"]:::mem
  HINT["prompt 里的用法行"]:::tool
  CLI["memory-query.mjs<br/>search / read / recent（--since/--until）"]:::tool
  A["Agent"]:::agent

  J --> RUN --> FILE --> MEM
  FILE --> INJ --> PAY
  FILE --> HINT
  HINT --> A
  A --> CLI --> FILE
```

---

## 图 5｜目标态：双链包裹上下文与强弱信号治理（M1.2–M1.3 规划）

> 解决两个真实痛点：① 用户写了实体名但忘了加 `[[]]`；② 库内大量概念页正文 ≤ 50 字（2026-11-18 实测 1665 篇概念页里 1049 篇正文 ≤ 50 字，其中 995 篇的内容都在日记/概念反链里），现行代码在正文为空时直接跳过。

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"13px","lineColor":"#8A93A6"}}}%%
flowchart TB
  classDef user fill:#E7F0FB,stroke:#4C7FB0,color:#17324D
  classDef gate fill:#FFF0E5,stroke:#C86428,color:#4A2108
  classDef strong fill:#E6F4EA,stroke:#4E8F63,color:#173D22
  classDef weak fill:#F5F5F5,stroke:#8A93A6,color:#333333
  classDef mcp fill:#E8F6F8,stroke:#3E8E9A,color:#103A40

  W["任务正文（用户写时消歧）"]:::user
  UL["未链接提及扫描<br/>确认框提示：agent deck → [[Agent Deck]]<br/>默认不勾选，点选后一步就地链上"]:::user
  G["隐私闸门 & 排除过滤<br/>private: true / 排除目录 / 屏蔽词<br/>排除 💬 与 Agent Deck/ AI 回声"]:::gate
  R{"[[X]] 按三级退路解析"}:::user
  D1["1. 节点属性摘要 + def<br/>type / domain / father / status"]:::strong
  D2["2. 正文摘录 + TOC 行号目录<br/>截断后附 ## 标题(L行号) 供分段读"]:::strong
  D3["3. 反链块退路（正文为空时）<br/>按位置判强弱 · >30 条宽泛词只计数"]:::strong
  S1["强信号：[[X]] 在块首 / 块尾 / 独占带子块<br/>（同档按日记日期新→旧排序）"]:::strong
  S2["弱信号：[[X]] 嵌在句中提及<br/>+ #tag 符号信号筛选与标注"]:::weak
  PV["ConfirmSendModal 预览与剔除<br/>逐条展示记忆 / 日记反链块 / 警告<br/>标明「参考资料非指令」与锚点漂移"]:::gate
  RT["运行时按需取回（M1.3 stdio MCP）<br/>vault_outline / vault_read / vault_related / vault_find"]:::mcp

  W --> UL --> G --> R
  R --> D1 --> PV
  R --> D2 --> PV
  R --> D3 --> S1 --> PV
  D3 --> S2 --> PV
  PV -->|只给入口地图 + 指针| RT
```

---

## Dream 注入与 Dashboard 口径速查

| 项 | 说明 |
|---|---|
| **Dream 触发环** | 构建载荷时（`dream-memory` resolver），即**派发那一刻**；不是运行中、不是回写后，**续聊不会重复注入** |
| **命中与预算** | 词面重合 ≥ 2 词（中文二元组 / ≥4 字符非停用英文技术词 / 元数据补盲），只取 `state=有效` 且有 `kind`（跳过 `private: true`）；最多 **5 条 / 1200 字**；M2 起按 `resolveDispatchFolder` 结果做工程域 vs 个人域分流（通用问答保持 0 注入） |
| **记忆索引与门禁** | `renderMemoryIndex()` 生成 `索引.md`（M1.1 过滤 `private` 与非 `有效` 条目并按域/类型分组）；M3.1 接通 `RunTrace` 轨迹诊断 → `eval-context.mjs` Golden 集门禁 |
| **长回答外存** | 后台回答 ≤500 字直接进子块；>500 字外存 `Agent Deck/Answers/*.md`，日记子块只保留双链 |
| **Dashboard 统计** | `usage.json` + 日记 `🔗` + `autoLogState` 汇总：总览显示 `缓存读取占比 = cached/(fresh+cached)`；「模型分布」表在 `问答轮次` 列括号内展示 `(tokens/轮)`，在 `缓存命中` 列展示比例（因包含重复缓存读取，评测上下文压缩/前缀稳定度时建议重点看未缓存输入 `fresh`） |

---

## 代码落点对照（现状基线）

| 步骤 | 代码坐标 | 说明 |
|---|---|---|
| 取块与上下文 | `src/harness.js` `resolveDelegationContext` | 祖先链、`boardContext`、`resolveWikilinkSnippets`（当前 >3 篇 `break`、空正文 `continue`）、`CONTEXT_RESOLVERS` |
| Dream 注入与索引 | `src/main.js` → `src/dream.js` / `src/memory-query-core.js` / `src/memory-store.js` | `MIN_MEMORY_OVERLAP = 2`（含单英文技术词与元数据补盲），`limit = 5`，`maxChars = 1200`；待补 `dream-memory` 传入项目上下文与 `renderMemoryIndex` 隐私/状态过滤 |
| 拼 prompt | `src/harness.js` `buildPromptFromContext` / `buildDelegationPayload` | `promptPrefix` → 祖先链+任务 → `extraSections` → `promptSuffix` → 来源路径 → `confirmFirst` |
| 富化四层 | `src/delegation.js` `Delegator.enrichPrompt` | 当前往头部倒序前置：`skillLine` / `replyText` / `memoryHint` / `notePaths` |
| 载荷快照 | `src/delegation.js` `payloadSnapshot` / `writeTaskPayload` | 无草稿时先富化再落盘；有草稿时按草稿原文再富化去重 |
| 问答写回与信箱 | `src/thread-replies.js` + `src/reply-inbox.js` + `src/reply-inbox-view.js` | `^ad-q-*` / `^ad-a-*` 锚点、`stillPending` 校对、焦点归还 |
| 续聊与轮次回写 | `src/delegation.js` `continueSession` / `src/journal.js` `syncSessionEntry` | 续聊回传 `✍️` 回答；12 行入站问句检测 |
| 卡住看护与删除守卫 | `src/steward-watch.js` + `src/note-updates.js` | 15 分钟无输出提醒一次；笔记不存在时不写入 |
| Dashboard 指标 | `src/analytics.js` + `src/dashboard.js` + `src/dashboard-data.js` | `cacheHitRate`、`tokensPerTurn`、`fresh / out / cached`、项目归属 |

---

## 还没画进去 / 边界事项

- **MCP（M1.3）**：尚未落地，Agent 运行时查库目前只有 `scripts/memory-query.mjs` CLI 一条路。
- **双链位置判强弱、TOC 截断目录与 `#tag` 信号（M1.1–M1.2）**：图 2 右半与图 5 为当前对齐后的目标流转，代码待按 Milestone 落地。
- **Windows**：全链路未做实机验证，流程以 macOS 实测为准。
- **权限类交互**：授权审批仍走 attention 通知回客户端，不走 `❓/✍️` 问答闭环。
