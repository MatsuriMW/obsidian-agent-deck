# Dream 记忆系统升级与 Graph-Native OKF 融合交接文档（2026-11-26）

> 本文档为 **Dream 记忆全链路升级（阶段 A/B/C + 实机迁移验证）** 的冷启动工程交接正本，面向后续接手开发者或 Agent：读完即可直接按第 0 节命令冷启动并精确修改对应模块。

---

## 0. 接手 Agent 冷启动执行指南（Quick Start）

1. **先确认当前工作区真实状态**（当前改动**尚未 git commit**，切勿直接假设文件数量或已提交）：
   ```bash
   git status --short
   ```
2. **代码改动后必须执行的完整门禁**（最后一次源码修改后务必全跑并确认零失败）：
   ```bash
   npm test && npm run eval && npm run build && npm run check:deploy && git diff --check
   ```
3. **macOS 本机安装与 Obsidian 热重载**：
   ```bash
   npm run install:plugin -- "<Vault>" && obsidian vault=<VaultName> plugin:reload id=agent-deck
   ```
4. **硬性红线**：
   - 唯一源码正本在 `src/`，**严禁直接修改 `main.js`、`styles.css` 或 Vault 内已装文件**（必须由 `npm run build` / `npm run install:plugin` 生成与同步）。
   - **未经用户明确确认**，不得修改 `package.json` / `manifest.json` 版本号、不得打 git tag、不得执行 `git commit`。
   - **删库内或工作区文件一律用 `trash`**（严禁 `rm` / `rm -rf`）。

---

## 1. 背景与核心架构决策

### 1.1 为何不拆分为独立 Obsidian 插件
- **核心判断**：Dream 记忆流程与 `agent-deck` 主插件强耦合，依赖 21 家会话日志适配器、`AutoLog`、Pin 标记、`dayCutoff` 可调日界、`excludedDirs` 隐私排除、`projectFolders` 项目归属、`llm.js` 多模型故障切换与 API 询问确认，以及 `ContextBundle` / `ConfirmSendModal` 派发前置预览闭环。
- **架构落地**：不拆独立插件（避免双份设置同步与 Vault 写锁竞争），采用**「内部无环分层模块 + 外部零依赖 Node CLI / stdio MCP」**。任何外部 Agent（Claude Code、Codex、DSH、OpenCode 等）无需启动 Obsidian 即可按需检索与图谱漫游。

### 1.2 「一文一条 `.md` 一份多用」：Graph-Native OKF Fusion
坚持每条记忆独立为一个普通 Markdown 文件（不合并回单一大文件，不建私有向量库），让**同一份 `.md` 文件**同时服务四个消费面：
1. **文件名（短命题，无日期前缀：LLM `short_title` 走 `memorySlug(..., 24)` 上限 24 字，0-Token 回退走 `deriveShortMemoryTitle(..., 22)` 上限 22 字，重名冲突时 `memoryFileName` 追加 `-2`/`-3`）** → Obsidian **关系图谱**中直接可读的命题节点标签；
2. **YAML 扁平 OKF + 纯 `"[[...]]"` 图谱边** → 同时驱动 **Obsidian Bases 表格**、**Obsidian 关系图谱连线**（`concepts` / `project_link` / `source_notes` / `conflicts_with` / `supersedes` / `superseded_by`）、**AI 可信度与新鲜度过滤**及 **1–2 跳图谱扩散**；
3. **`title` 与正文第一行（完整原句）** → 人类精读、Bases 表格完整展示、Agent 精准消费；
4. **`sources` 原文定位串** → 无损保留行号、`^mem-*` 块号与原文摘录，供审计与反向回链使用。

### 1.3 与仓库规则文件的职责边界
- 仓库 `AGENTS.md` / `CLAUDE.md` 负责**单仓库内的代码硬约束与规范**；
- Dream 记忆系统负责**跨仓库经验（`lesson`）、交互/审美偏好（`preference`）、长期背景事实（`fact`）与待验证规律（`pattern`）**；两者互补，不在派发 prompt 里重复叠塞。

---

## 2. 「方向 1 到 5」图谱融合方案落地对照表

| 方向 | 原构想核心 | 当前落地度 | 已落地实现与实测效果 | 留给下阶段的细项 |
| --- | --- | --- | --- | --- |
| **方向 1：4 种语义边 + 冲突边** | 在 YAML 拆出纯 `"[[...]]"` 图谱边，不往正文硬塞双链 | **100%** | `concepts`（概念/工具/人物/书名）、`project_link`（项目聚团）、`supersedes` / `superseded_by`（兼容 `m-*` ID 与 `[[...]]` 双链演化链）、`source_notes`（与审计 `sources` 解耦）、`conflicts_with` 字段序列化/解析/检索均已落地；`Dreaming.consolidate` 检测到 `plan.conflicts` 后自动幂等写入双向 `conflicts_with` 并记入 `log.md` | — |
| **方向 2：短命题文件名 + 完整 `title` 分离** | 去掉 `YYYY-MM-DD-` 与 40 字截断，保留完整句在 `title` 与正文 | **100%** | `memoryFileName({ preferShort: true })`（LLM 传入 `short_title` 时走 `memorySlug(..., 24)` 上限 24 字，否则回退 `deriveShortMemoryTitle(text, 22)` 上限 22 字且保护未闭合中文引号/书名号，重名冲突追加 `-2`/`-3`）；`src/dream.js` 新提炼要求输出 `short_title` 并新增 `polishShortTitles()` 按需用模型批量润色；实测库全部 `120` 条记忆已完成短命题重命名 | 按需在设置页「图谱与库维护」点「润色短命名（模型）」即可 |
| **方向 3：视觉体检仪（配色 / 过滤 / 局部图谱）** | `.obsidian/graph.json` 配色分组、去枢纽过滤、侧栏 Local Graph | **~90%** | `recommendedGraphSettings(current, { memoryDir, preset })` / `applyMemoryGraphPreset` 支持按 `settings.dream.dir` 动态生成「类型与核验 (`kind`) / OKF 信任热力 (`trust`)」双预设、高亮 `["conflicts_with"]` 红线节点、并在 `search` 为空时默认过滤 `-file:"索引" -file:"长期记忆" -file:"log" -path:"<dir>/archive"`（已有非空 `search` 原值不覆盖）；`suggestConceptPromotions` 聚合 `≥ 5` 条概念升格建议并写入体检报告 | Local Graph 侧栏自动布置（按需手开） |
| **方向 4：零向量库 1–2 跳 GraphRAG + MCP** | 沿图谱边走 1–2 跳补充词面不重合记忆，并同步开放 MCP | **100%** | `expandGraphMemories` + `memory-query-core.js` `graphHits` 加权、`dream.js` `pickContext` 透传 `refs` 与 `conceptParents`、`memory-query.mjs` (`v5`) `graph` 动词、1 跳扩展与 `archive/` 只读检索、`memory-mcp.mjs` (`v4`) `memory_graph` | 多跳权重调参可结合后续 `RunTrace` 实跑日志继续用 `eval-context.mjs` 校准 |
| **方向 5：3 个避坑护栏** | ① 日记边与概念边分离 ② 防泛词超级节点 ③ 严控未解析死链 | **100%** | ① `source_notes` 与 `concepts` 解耦（查看纯主题时加 `-path:"日记"` 即可隔离日记聚团）；② `CONCEPT_STOPWORDS` + 目录排除 + `maxHubInlinks = 80` 黑洞抑制 + 0-Token 严格词长（英文 `≥ 3` 词边界 / 中文 `≥ 3` 字，2 字中文仅进 LLM 候选）；③ Obsidian 仅把纯 `"[[...]]"` YAML 值算入图谱边，`resolveSourceNotes` 过滤导入伪路径，同时保持 `sources:` 原文无损（实测库 `withUnresolved` 从 `35` 降至 **`0`**） | 可按日常使用体感微调 `maxHubInlinks`（默认 `80`）或扩展停用词表 |

---

## 3. 三阶段完整改动台账

### 3.1 阶段 A：全链路 Bug 修复、Sleep-Time 巩固、外部 MCP 与低摩擦交互
- **已修复的 13 处实际缺陷**：
  1. `scripts/memory-query.mjs` 读取配置兼容 Obsidian 默认顶层 `data.json` 与 `.settings` 包裹结构。
  2. `src/memory-query-core.js` 与外部脚本统一 `STOP_CJK` 停用词过滤、独立中文片段防重复、中英混合词（`A股` / `B站`）与 IDF 权重，修复单技术词或短词零召回。
  3. `src/dream.js` `rewriteSources` 统一使用 `yamlStr` 给带 `[[...]]` 的源链接加双引号，修复裸 `[[` 被 Obsidian 当嵌套数组破坏 YAML 的问题。
  4. `writeEntry` 补全 `supersedes` / `project` / `tags` / `verified` / `private` 与逐条来源元数据。
  5. `setEntryState` 限定只改 frontmatter 区间，容错缺失或空白 `state:` 字段。
  6. `src/memory-store.js` `renderMemoryList` 与 `renderMemoryIndex` 严格过滤 `private: true`，且 `renderMemoryIndex` 仅收录 `state === "有效"` 并生成按类型/项目分组摘要。
  7. `src/main.js` `reanchorMemory` 修复读取不存在的 `dry.changed`（改为 `!dry.edited.length`）。
  8. `src/dream.js` `ensureReverseLinks` 去除硬编码 `"Agent Deck/记忆"`，改为动态 `this.dir`。
  9. `reconcile` 在 `files` 模式下按已加载路径比对，防止用户手改措辞被误判为 `已拒绝`。
  10. `state.processed` 改为上限 `5000` 条的有界保留，不随扫描窗口推移丢失历史去重键。
  11. `src/delegation.js` `_performHandoff` / `handoffCli` 补齐走 `resolveDispatchFolder` 与 `enrichPrompt`，消除桌面/终端交接漏注上下文。
  12. `Dreaming.run()` 显式透出核验阶段 `dropped` 计数与原因，不再静默丢弃。
  13. `backfillOkfMetadata` 批量写入/重命名期间置位 `this._suppressWatch = true`，`watchMemoryFolder` 与 `reconcileFile` 增加存在性检查与 `ENOENT` 安全返回，消除重命名竞争报错。
- **核心能力增强**：
  - 高信噪比提炼与相对时间绝对化，`DEFAULTS.dream.autoAnchor = true` 默认开启自动回写 `^mem-*` 定位锚。
  - 新增 `parseConsolidationPlan` 与 `Dreaming.consolidate()`（Sleep-Time 巩固，持久化 `settings.dream.lastConsolidate`）：合并近似重复/同源条目、继承多源并维护 `supersedes` 链、硬性保护 `verified: true` 不被自动淘汰。
  - 任务域分流（`resolveDispatchFolder` 区分代码项目与个人域），`ConfirmSendModal` 增加可折叠「将注入记忆」预览与逐条剔除（`excludeMemoryIds`），`delegation.js` / `harness.js` 将命中记忆 `memoryIds` 记入 `contextStats`。
  - `MemoryReviewModal` 支持 `1/2/3/E/S` 快捷键、可点源链与行内编辑；`MemoryBoardView` 增加搜索、类型与核实筛选及快捷确认/拒绝；`src/settings.js` 新增「记忆库工作区」Hub 卡片、0-Token 本地召回测试器、`checkExternalAssets` 脚本版本状态检查、`coverage.dropped` 与 `lastConsolidate` 状态行，以及 3 个一键复制按钮（MCP 配置 JSON / Claude Code 命令 / CLI 查询示例）。

### 3.2 阶段 B：OKF v0.2 扁平元数据、可信度与任务域校准、`log.md`
- **Google OKF v0.2 取舍与适配**：
  - 吸收 `provenance` / `verified_by` / `verified_at` / `status` / `verdict` / `valid_from` / `valid_until` / `stale_after` / `description` / `applies_to` 及追加式 `<dir>/log.md`。
  - 因 Obsidian Bases 表格列不兼容深层对象列表（如 `verified: [{ by, at }]`），存储层统一**扁平写盘**，同时在 `parseMemoryFile` 与 `scripts/memory-query.mjs` 的读取层兼容解析 `{ by, at }` 嵌套结构。
- **检索与注入校准**：
  - `deriveTrustLevel` 分级加权：`human-reviewed`（`× 1.35`）> `user-authored`（`× 1.0`）> `ai-derived`（`× 0.72`），未实施/待验证提案另乘 `× 0.55`；自动过滤 `deprecated`/`rejected`/`refuted` 与过期条目。
  - 修复代码域过杀设计/规范类 `fact` 的问题：在代码任务中，个人生活域条目仍被过滤，但非生活域的工程/交互设计类 `fact` / `pattern` 在满足 **`hasGraph`（图谱 1–2 跳命中）或 `distinctHits >= 3`（独立非重叠命中片段 ≥ 3）** 时予以放行。
  - `memoryLine` 注入时显式标出 `（已确认）` / `（AI提炼·未确认）` / `（待验证推断）`；`src/harness.js` `extractOkfHeader` 对整篇引用笔记补充 1 行 `[元信息：…]`。
  - `<dir>/log.md` 记录 `Creation` / `Consolidation` / `OKF-Backfill` / `OKF-Graph-Upgrade` 等动作，并在 `memoryBase`、`listEntryPaths`、CLI、MCP 全链路中排除。

### 3.3 阶段 C：Graph-Native OKF Fusion
- 新增纯无环模块 `src/memory-graph.js`：`CONCEPT_STOPWORDS`、`normalizeLinkName`、`extractSourceNotes`、`deriveShortMemoryTitle`、`buildVaultConceptCatalog`、`matchConceptLinks`、`expandGraphMemories`、`recommendedGraphSettings`。
- `src/memory-store.js` 增加 `preferShort` / `shortTitle` 短命题命名、纯 `"[[...]]"` 图谱字段序列化与解析、`memoryBase` 图谱列与 `renderMemoryIndex` 兼容。
- `src/dream.js` 更新提炼 prompt（要求输出 `short_title` 与候选约束 `concepts`）、`writeEntry`（调用 `resolveSourceNotes` 与 `matchConceptLinks`）、`mergeStore`/`consolidate`（双向双链化 `supersedes`/`superseded_by`）、`backfillOkfMetadata({ dryRun, renameShort, relinkGraph })` 与 `audit()` 图谱边/孤岛统计。
- `src/memory-query-core.js` 将 `concepts` / `project_link` / `conflicts_with` 纳入 `entryMetaTerms`，并支持 `graphHits` 1–2 跳得分加权；`src/main.js` 转发 `refs` 给 `pickContext`。
- `scripts/memory-query.mjs`（`ASSET_VERSION = 4`）新增 `graph` 动词与 1 跳概念扩展；`scripts/memory-mcp.mjs`（`ASSET_VERSION = 3`）新增只读工具 `memory_graph`。
- `src/main.js` / `src/settings.js` / 三语语言包新增 `memory-graph-upgrade`、`memory-graph-preset` 命令与设置按钮。

---

## 4. 源码与测试地图

### 4.1 关键源码与脚本（`src/` & `scripts/`）
| 模块 | 职责与核心符号 |
| --- | --- |
| [`src/memory-graph.js`](../../src/memory-graph.js) | **新增无环叶子模块**：`CONCEPT_STOPWORDS`、`normalizeLinkName`、`extractSourceNotes`、`deriveShortMemoryTitle`（默认 `max = 22`）、`buildVaultConceptCatalog`（`maxHubInlinks = 80`）、`matchConceptLinks`、`expandGraphMemories`、`recommendedGraphSettings`（保留已有非空 `search`，`colorGroups` 硬编码 `Agent Deck/记忆`） |
| [`src/memory-store.js`](../../src/memory-store.js) | 存储契约与 Bases/索引渲染：`STATE_TO_STATUS`、`STATUS_TO_STATE`、`deriveProvenance`、`deriveTrustLevel`、`isMemoryStale`、`appendMemoryLogContent`、`memoryFileName`（`preferShort`）、`yamlStr`、`serializeMemoryFile`、`parseMemoryFile`、`reconcileMemoryFile`、`memoryBase`、`renderMemoryIndex` |
| [`src/memory-query-core.js`](../../src/memory-query-core.js) | 无环零依赖检索引擎：`STOP_CJK`、`STOP_LATIN`、`isHybridTerm`、`isDistinctiveLatinTerm`、`deriveTrustLevel`、`isMemoryStale`、`computeIdfMap`、`scoreMemoryEntry`（含 `graphHits`）、`pickMemoriesFromEntries`、`memorySimilarity` |
| [`src/dream-evidence.js`](../../src/dream-evidence.js) | 证据抽取、`inferEvidenceDate`、`inferEvidenceProject`、跳过 `private: true` 与 `excludedDirs` |
| [`src/dream.js`](../../src/dream.js) | `Dreaming` 全生命周期引擎：`buildConceptCatalog`、`buildConceptParents`、`resolveSourceNotes`、`writeEntry`、`reconcileFile`（含 `ENOENT` 防护）、`pickContext`（含 `refs` + `expandGraphMemories`）、`consolidate`、`backfillOkfMetadata`、`audit`、`healthReport`、`ensureReverseLinks` |
| [`src/harness.js`](../../src/harness.js) | `createContextBundle` / `renderContextBundle`、`extractOkfHeader`、`stripInternalIdentifiers` |
| [`src/delegation.js`](../../src/delegation.js) | `_performHandoff` / `handoffCli` 统一经由 `resolveDispatchFolder`（定义于 [`src/project-folders.js`](../../src/project-folders.js)）+ `enrichPrompt` + 预览剔除 |
| [`src/dialog.js`](../../src/dialog.js) | `ConfirmSendModal` 可折叠「将注入记忆」预览与单条剔除（`excludeMemoryIds`） |
| [`src/memory-review.js`](../../src/memory-review.js) / [`src/memory-board.js`](../../src/memory-board.js) | 审核弹窗快捷键与行内编辑；三列看板搜索/筛选/快捷确认拒绝 |
| [`src/main.js`](../../src/main.js) / [`src/settings.js`](../../src/settings.js) / [`src/constants.js`](../../src/constants.js) | 命令与设置 UI（记忆库工作区、折叠式「图谱与库维护」抽屉、图谱双视角切换、目录/归档天数设置、0-Token 召回测试、外部脚本状态与 3 种复制按钮）、`watchMemoryFolder`（`_suppressWatch`）、`applyMemoryGraphPreset`、`archiveDeprecatedMemories`、`polishMemoryShortTitles`、`DEFAULTS.dream`（`autoAnchor: true`, `graphPreset: "kind"`, `autoArchive: true`, `archiveAfterDays: 30`, `lastConsolidate: null`）、`STORE_VERSION = 1`、`MEMORY_QUERY_ASSET_VERSION = 5`、`MEMORY_MCP_ASSET_VERSION = 4` |
| [`src/trace.js`](../../src/trace.js) | `checkExternalAssets(vaultPath, { expectedMemoryQueryVersion, expectedMemoryMcpVersion })` 检测 Vault 中 `memory-query.mjs` / `memory-mcp.mjs` 安装与版本漂移 |
| [`src/styles/index.css`](../../src/styles/index.css) | 记忆看板筛选、审核弹窗、派发记忆预览、设置页 Hub 与召回测试器样式（构建输出至根目录 `styles.css`） |
| [`src/locales/en/*`](../../src/locales/en/settings.js) / [`src/locales/zh-TW.js`](../../src/locales/zh-TW.js) | 同步补齐全部新增命令、设置按钮与图谱文案（三语 100% 校验） |
| [`scripts/memory-query.mjs`](../../scripts/memory-query.mjs) | 外部零依赖 CLI 与共享内核（`ASSET_VERSION = 5`）：命令行提供 `index` / `search` / `graph` / `read` / `recent` / `stats`（区分库内可补锚 vs 外部导入免补锚，支持 `archive/` 检索），另导出 `proposeMemory` 供 MCP `--allow-write` 调用 |
| [`scripts/memory-mcp.mjs`](../../scripts/memory-mcp.mjs) | **新增**零依赖 stdio MCP Server（`ASSET_VERSION = 4`）：Tools `memory_index` / `memory_search` / `memory_read` / `memory_recent` / `memory_graph` / `--allow-write` 下的 `memory_propose`，及 Resource `memory://index` |
| [`scripts/install.mjs`](../../scripts/install.mjs) / [`scripts/check-deploy.mjs`](../../scripts/check-deploy.mjs) / [`scripts/eval-context.mjs`](../../scripts/eval-context.mjs) / [`package.json`](../../package.json) | 安装包同步外部 CLI/MCP 脚本；`check-deploy` 校验 `MEMORY_QUERY_ASSET_VERSION` / `MEMORY_MCP_ASSET_VERSION` 对齐与体积预算；11 组记忆检索 + KV 前缀评测；`npm test` 纳入新测试文件 |

### 4.2 对应测试文件（`test/`）
- [`test/memory-graph.test.mjs`](../../test/memory-graph.test.mjs)（新增）
- [`test/memory-mcp.test.mjs`](../../test/memory-mcp.test.mjs)（新增）
- [`test/memory-store.test.mjs`](../../test/memory-store.test.mjs)、[`test/memory-query.test.mjs`](../../test/memory-query.test.mjs)、[`test/dream-context.test.mjs`](../../test/dream-context.test.mjs)、[`test/dream-regression.test.mjs`](../../test/dream-regression.test.mjs)、[`test/harness-context.test.mjs`](../../test/harness-context.test.mjs)
- 门禁：`test/architecture-refactor.test.mjs`（0 循环依赖）、`test/i18n.test.mjs` & `test/errors-i18n.test.mjs`（100% 三语文案覆盖）。

### 4.3 必须守住的核心不变量
1. **⚠️ 双份实现同步边界（极易踩坑）**：`scripts/memory-query.mjs` 安装在 `<Vault>/.obsidian/plugins/agent-deck/scripts/` 下独立运行，**不能 `import` 仓库里的 `src/`**。凡涉及 OKF 解析、停用词、IDF、可信度分级、过期过滤或图谱扩展的改动，**必须同步修改 `src/memory-query-core.js` / `src/memory-store.js` / `src/memory-graph.js` 与 `scripts/memory-query.mjs`**，并在修改外部脚本逻辑后同步递增 `src/constants.js` 与脚本中的 `MEMORY_QUERY_ASSET_VERSION` / `MEMORY_MCP_ASSET_VERSION`（由 `npm run check:deploy` 强校验）。
2. 禁止直接修改构建产物 `main.js` / `styles.css`，唯一正本在 `src/`，改动后运行 `npm run build`。
3. `src/` 保持 0 循环依赖（`memory-graph.js`、`memory-query-core.js`、`memory-store.js` 不回指 `dream.js`/`main.js`）。
4. frontmatter 内所有含 `[[...]]` 的值必须走 `yamlStr` 加引号，否则 Obsidian 解析 YAML 失败。
5. `sources` 原文审计字符串保持无损（含 `[[日记/x#^mem-xxxxxxxx]]` 与原文摘录）；`source_notes` 在插件内经 `resolveSourceNotes` 只保留库内真实可解析双链，防止导入伪路径污染图谱未创建节点。
6. `^mem-*` 与 Obsidian 自动 6 位块号永不剥除；仅 `^ad-*`/`^dsh-*` 任务号在注入前由 `agentText` 剥除。
7. 严格遵守 `private: true` 与 `excludedDirs` 隐私边界，CLI、MCP、派发与索引生成均不可泄露；遵循 `AGENTS.md` Apache-2.0 公开隔离规范，仓内文档不硬编码个人绝对路径。
8. 未经用户明确确认，不得修改 `package.json` / `manifest.json` 版本号或打 git tag。

---

## 5. 单条记忆 Markdown 契约与实机样例

### 5.1 Frontmatter 字段总览（扁平 OKF v0.2 + Graph-Native 双链）
| 字段 | 类型 | 主消费方 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 机器 / Bases / 检索 | 稳定记忆 ID（`m-<hash>`） |
| `title` | string | 人类 / Bases / Agent | 完整精准陈述原句（不截断） |
| `kind` / `type` | enum | Bases / 图谱配色 / 域路由 | `fact(事实)` / `preference(偏好)` / `pattern(待验证规律)` / `lesson(项目经验)` |
| `state` / `status` | enum | Bases / 图谱配色 / 检索过滤 | 双向同步：`有效↔active`、`已被替代↔deprecated`、`已拒绝↔rejected` |
| `date` | date | Bases 排序 / 索引 / 时效 | `YYYY-MM-DD` |
| `sources` | `string[]` | 核验 / 回链 / `autoAnchor` | 完整审计引文，含 `[[笔记#^mem-*]]` 与原文（因含中文说明后缀，Obsidian 不把此字段计入图谱连线） |
| `concepts` | `"[[...]]"[]` | **Obsidian 图谱 + GraphRAG** | 最多 3 条精确关联的概念/工具/人物/书名双链 |
| `project_link` | `"[[...]]"` | **Obsidian 图谱 + GraphRAG** | 所属项目主页双链（若库内存在对应笔记） |
| `source_notes` | `"[[...]]"[]` | **Obsidian 图谱（可独立过滤）** | 从 `sources` 提取的纯双链（插件内过滤为库内真实存在笔记） |
| `conflicts_with` | `"[[...]]"[]` | 图谱 / 冲突审计 / 检索 | 冲突记忆双链列表 |
| `supersedes` / `superseded_by` | `"[[...]]"` or `m-*` | 图谱演化箭头 + 检索过滤 | 新版本自动指向旧版本，检索排除已被替代条目 |
| `provenance` | enum | OKF 可信度分级 / Bases | `user-log` / `ai-log` / `mixed` / `import` / `manual` / `consolidated` |
| `generated_by` | string | 审计 | `dream` / `dream-consolidate` / `import` / `manual` 等 |
| `verified` / `verified_by` / `verified_at` / `verdict` | bool / string / enum | OKF 可信度 + 图谱绿点过滤 | `verdict`: `pending` / `confirmed` / `refuted`；解析器兼容读取 `{ by, at }` |
| `description` / `project` / `applies_to` / `domain` / `tags` | string / `string[]` | 检索匹配 / 任务域路由 / Bases | 触发场景短句、工程归属与领域标签 |
| `valid_from` / `valid_until` / `stale_after` | date | 新鲜度过滤 | 超期条目默认不进注入，CLI 可用 `--include-stale` / `--all` 查看 |
| `private` | bool | 隐私硬闸门 | `true` 时在索引、CLI、MCP、派发与 `长期记忆.md` 中完全跳过 |

### 5.2 实机升级后形态示例（`Agent Deck/记忆/<短命题>.md`）
- `Agent Deck/记忆/Agent Deck 记忆体系要闭环.md`：自动挂接 `concepts: ["[[Agent Deck]]", "[[mcp]]"]` 与 `source_notes: ["[[日记/2026_11_19]]"]`，正文与 `title` 保留完整陈述。
- `Agent Deck/记忆/美债利率是全球金融市场的定价之锚.md`：通过库内概念页 `aliases` 自动挂接 `concepts: ["[[CXO]]", "[[irr]]", "[[技术可行性]]"]`（如 `biotech → [[CXO]]`、`实际利率 → [[irr]]`）。

---

## 6. 命令面板、CLI 与 MCP 接入速查

### 6.1 插件命令 ID（`src/main.js`）
- **新增图谱 / OKF / 巩固 / MCP 命令**：
  - `memory-consolidate`：「记忆：巩固去重与冲突整理（Sleep-Time）」
  - `memory-backfill-okf`：「记忆：补齐已有记忆的 OKF 元信息（0 Token）」
  - `memory-graph-upgrade`：「记忆：一键升级图谱边与短命题文件名（0 Token）」
  - `memory-graph-preset`：「记忆：应用推荐关系图谱配色与过滤预设」
  - `memory-graph-preset-trust`：「记忆：应用关系图谱 OKF 信任度热力预设」
  - `memory-archive-deprecated`：「记忆：归档超期失效记忆到 archive/」
  - `memory-polish-titles`：「记忆：用模型润色图谱短命题文件名」
  - `memory-copy-mcp`：「记忆：复制外部 Agent MCP 接入配置」
- **既有保留并修复增强的命令**：`memory-migrate`、`memory-confirm`、`memory-reject`、`memory-audit`、`memory-reanchor`、`memory-anchor-source`、`memory-backlink-source`、`memory-review`、`memory-import`、`memory-create`、`memory-delete`、`memory-board-open`。

### 6.2 外部零依赖 CLI（`ASSET_VERSION = 5`，严格 6 个只读动词）
安装后路径：`<Vault>/.obsidian/plugins/agent-deck/scripts/memory-query.mjs`
```bash
VAULT="<Vault>"
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" stats [--vault "$VAULT"]
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" graph <记忆文件名/ID/概念名> [--depth 2] [--vault "$VAULT"]
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" search "关键词" [--k 5] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--include-stale] [--all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--vault "$VAULT"]
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" index [--kind K] [--project P] [--k 30] [--vault "$VAULT"]
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" read <记忆文件名或ID> [--vault "$VAULT"]
node "$VAULT/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" recent [n] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--include-stale] [--all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--vault "$VAULT"]
```
*(注意：该脚本仅在命令行提供上述 **6 个只读动词**，**不提供 `propose` 动词与 `--json` 参数**；写入候选通过 MCP `--allow-write` 触发内部的 `proposeMemory` 导出。)*

### 6.3 外部 stdio MCP Server（`ASSET_VERSION = 4`）
安装后路径：`<Vault>/.obsidian/plugins/agent-deck/scripts/memory-mcp.mjs`
- 同时兼容 newline-delimited JSON 与 `Content-Length` stdio 帧。
- **只读工具（默认）**：`memory_index`、`memory_search`、`memory_read`、`memory_recent`、`memory_graph`（参数 `{ ref, depth? }`）。
- **只读资源（Resources）**：`resources/list` 与 `resources/read` 暴露 `memory://index`（有效非私密长期记忆索引概览）。
- **可选写入工具（需显式加 `--allow-write` 启动参数）**：`memory_propose`（带去重、OKF 默认字段与短命名落盘）。

---

## 7. 验证结果、工作区现状与真机回滚指南

### 7.1 自动化测试、Eval 与构建校验（macOS arm64，最后一次源码修改后全部通过）
- `npm test`：全部测试套件 0 失败（含 `memory-graph`、`memory-mcp`、`memory-store`、`memory-query`、`dream-context`、`dream-regression`、`harness-context`、`architecture-refactor`、`i18n`、`errors-i18n` 等）。
- `npm run eval`（[`scripts/eval-context.mjs`](../../scripts/eval-context.mjs)）：`ok: true`，11 条记忆评测用例 `recall = 1`、`precision = 1`、`orderMismatches = 0`、`privacyLeaks = 0`、`budgetViolations = 0`；Harness 3/3；KV 前缀 `driftCount = 0`。
- `npm run build` & `npm run check:deploy`：通过（`main.js = 3319.0KB`、`styles.css = 150.7KB`、`memory-query ASSET_VERSION = 5`、`memory-mcp ASSET_VERSION = 4`）。
- `git diff --check`：通过（0 空白错误）。

### 7.2 沙盒真模型与真实 Vault 实机验证记录
- **沙盒真实模型全流程 E2E（`/tmp` 隔离，真实调用 `codex / gpt-6-luna`，已清理）**：打通阶段 B 闭环与阶段 C 新提示词提炼（自动生成无日期短命题 `记忆文件名采用无日期短命题.md`、选出库内真实概念 `[[Obsidian]]` / `[[知识图谱]]`、`autoAnchor` `^mem-*`、`log.md`）。
- **真实参考 Vault（`马自立`）实机升级与复测（只读，未改动已有 120 条记忆）**：
  - 全部 `120` 条记忆已升为短命题文件名并补齐 OKF v0.2 与图谱边（`90` 篇 / `177` 条已解析边，`withUnresolved = 0`）。
  - 本轮热重载 `agent-deck` 后，`obsidian vault=马自立 dev:errors` 零 `agent-deck` 报错；`plugin.dreaming.audit()` 与已装 `memory-query.mjs`（v5）/`memory-mcp.mjs`（v4）一致精确区分 **库内可补锚 33 条 · 外部导入免补锚 56 条**（替代原 `89` 条混合误报），并识别 `Agent Deck(8)` / `Claude Code(6)` / `Obsidian(6)` / `Retrieval-Augmented Generation(5)` / `windows(5)` 5 个高密概念；Dreaming 设置页 DOM 验证通过（顶栏 5 个常用按钮、默认折叠的「图谱与库维护」抽屉及双预设、以及「更多设置」中的 `记忆库目录` / `巩固时自动归档` / `失效记忆归档天数`）。

### 7.3 工作区现状与安全回滚
- **Git 状态（尚未 commit，未改版本号，未打 tag）**：以仓库根目录运行 `git status --short` 为准；当前包含 `src/` 核心源码与新模块 `src/memory-graph.js`、外部脚本 `scripts/memory-mcp.mjs` 与 `scripts/memory-query.mjs`、对应 `test/` 测试、更新后的 `docs/` 与编译产物 `main.js` / `styles.css`。
- **参考 Vault 升级前完整备份位置**：`~/obsidian-backups/agent-deck-memory-graph-2026-11-26`（含 `记忆/` 升级前全部条目、`长期记忆.md`、`记忆.base`、`.obsidian/graph.json`）。
- **回滚原则**：若需还原参考库记忆目录，请先用 `trash` 将当前 `Agent Deck/记忆/` 送入废纸篓后再从上述备份目录拷回（**禁止使用 `rm -rf`**）；插件代码按需用 `git` 暂存或还原。

---

## 8. 已知空白与可执行待办（Actionable Next Backlog）

### 8.1 未测空白
- Windows 真机全链路、Windows 下脚本路径转义与 `memory-mcp.mjs` 外部调用未测。
- Obsidian 图形界面中关系图谱（`⌘G` / Local Graph）与 Bases 表格的真实鼠标点击交互未手工点测。
- Linear `P-MAT-42` 相关卡片进度尚未同步更新。

### 8.2 按优先级拆好的可执行待办（已完成 P1/P2 收尾，余项为发布同步）
1. **✅ P1 · `consolidate` 检测矛盾条目后自动写入双向 `conflicts_with` 红线**：`src/dream.js` (`addEntryConflicts` + `Dreaming.consolidate`) 与 `src/memory-store.js` (`appendFrontmatterLinks`) 已实现幂等双向写回与 `log.md` 记账。
2. **✅ P1 · 体检缺锚口径区分（库内日记可补锚 vs 外部导入免补锚）**：`classifyAnchorStatus` 已在 `src/memory-store.js` 与 `scripts/memory-query.mjs` (`v5`) 同步落地。
3. **✅ P2 · 超期废弃记忆自动归档至 `<dir>/archive/`（Roadmap G7）**：`Dreaming.archiveDeprecated` / `restoreArchivedEntry`、`memoryBase` 排除 `<dir>/archive/`、`consolidate` 自动归档开关与天数设置、以及 `memory-query.mjs` (`v5`) / `memory-mcp.mjs` (`v4`) 归档只读检索已落地。
4. **✅ P2 · 短命名启发式精修 & 可选 LLM 批量润色 `short_title`**：`deriveShortMemoryTitle` 已支持中文成对引号/书名号边界保护，`Dreaming.polishShortTitles` 支持显式命令与设置按钮按需模型润色。
5. **✅ P2 · 概念升格建议（Roadmap B11）与图谱双视角切换**：`suggestConceptPromotions` 已接入 `audit()` / `healthReport()`，`recommendedGraphSettings` 与设置页支持 `kind` / `trust` 双视角及自定义 `dream.dir`。
6. **P3 · 仓库提交与发版同步**
   - 在获得用户明确指令后执行 `git commit`，视需要更新版本号/tag 与 `CHANGELOG.md` 并同步 Linear `P-MAT-42`。
