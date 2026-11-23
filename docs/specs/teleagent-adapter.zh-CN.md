# TeleAgent（星辰超级智能体）接入方案

> 状态：**P0（只读追踪）、P1（复制交接）与 Linux「填入式」派发已实现**（2026-11-19，分支 `feat/teleagent-adapter`）。核验平台：**Windows 11**（TeleAgent 桌面版 1.2.27；真实库 810 MB / 4365 会话 / 48609 消息 / 173493 part）+ **Linux**（Deepin 25 / treeland Wayland + XWayland，客户端 3.1.1-rc.1；Linux 派发后端见 §5 与 UI Automation 派发实测）。**macOS 未实机核验**，按 AGENTS.md 口径不外推。P2（深链与状态增强）仍未实现。
> 本文只定义数据契约、委派设计与改动面，不含实现代码。

## 0. 结论

- **可以接入**，定位为第 12 家 Agent（上游 1.13.x 已有 11 家）：**只读追踪 + 复制交接式委派**，与 WorkBuddy 同档（`desktopHandoffOnly`）。
- **不做**后台执行、不做终端交互委派：桌面端没有 CLI/ACP，`/usr/bin/teleagent` 只是 GUI 启动器，按 [`acp-integration.zh-CN.md`](acp-integration.zh-CN.md) 第 1 条「无 CLI 的客户端不纳入委派」处理。
- 相对 WorkBuddy 的两个有利条件：
  1. 会话**全部落在本地 SQLite**（本机样本 115 个会话里 106 个是云端路径或空目录，说明云电脑会话也会出现在本地库），只读追踪不依赖客户端保持运行；
  2. `teleagent.db` 与 **OpenCode 同构**（`session` / `message` / `part`），可复用现有 `src/desktop-sessions.js`，不必新写解析器。
- 预估：P0 追踪 1.5–3 人日；P1 复制交接 1–2 人日；P2 深链/认领增强 1–2 人日。

## 1. 已核验事实

| 项 | 实测结果 |
|---|---|
| 安装形态 | `/opt/TeleAgent`（Electron 主程序）+ `/usr/bin/teleagent` → `/opt/TeleAgent/teleagent-launcher`（bash 包装） |
| 内核 | `runtimes/super-agent-code/bin/TeleAgent`，Go 静态二进制，包名 `@teleai-agent/super-agent-code-linux-x64` 3.0.0-dev |
| 数据根 | `~/.local/share/TeleAgent`（Linux / macOS），Windows 同布局 `%USERPROFILE%\.local\share\TeleAgent` |
| 数据根覆盖 | **实测内核读 `SUPER_AGENT_APP_DATA_DIR`**（配置目录是 `SUPER_AGENT_APP_CONFIG_DIR`）。2026-11-19 在 Windows 内核 `runtimes/super-agent-code/bin/TeleAgent.exe` 的字符串里核到这两个变量；**上一版本文写的 `TELEAGENT_HOME` 是错的**，本机环境里也不存在 |
| 多账号 | `current-owner.json` 给出 `ownerDir`、`tenantId`、`userId`；每账号独立 `users/<ownerDir>/teleagent.db` |
| 会话库 | `users/<ownerDir>/teleagent.db`，SQLite **WAL** 模式（实测 26.9 MB） |
| 表结构 | `session` / `message` / `part` / `todo` / `permission` / `permission_rule` / `project` + FTS |
| 规模（本机样本） | 115 会话 / 2143 消息 / 8724 part；70 个会话有 `parent_id`；10 个有 `workspace_id`；0 归档 |
| 时间跨度 | 2026-09-24 → 2026-11-12 |
| token | `message.data.tokens = {total, input, output, reasoning, cache:{read, write}}`；1876/1890 条 assistant 带 `time.completed` |
| part 类型 | `tool` 1940 / `step-start` 1890 / `step-finish` 1848 / `text` 1555 / `reasoning` 1491 |
| 会话目录 | 9 个本地路径、106 个云端或空（其中 68 个 `directory` 为空） |
| 应用协议 | 桌面入口注册 `x-scheme-handler/teleai-cowork`，语义未验证 |
| 版本标记 | `session.version` 出现 `v3`、`1.2.27` |

社区资料可交叉印证（非官方接口文档，仅作旁证）：本地内核为 OpenCode 风格 HTTP API（[teleagent-proxy](https://github.com/liao96312/teleagent-proxy)）；数据根默认 `~/.local/share/TeleAgent`（[dsh-teleagent](https://github.com/KUMAKAIHA/dsh-teleagent)）；数据按 `users/<id>/` 分区、记忆含 `USER.md`/`MEMORY.md`（[dsh-connect-teleagent](https://github.com/anbulang/dsh-connect-teleagent)）。官方文档给出的 Windows 工作空间示例为 `C:\Users\<用户>\.local\share\TeleAgent\...`（[安装指南](https://www.teleai.com.cn/doc/bKrLmQNepNQpUHjWEfqX/pUxSKj00HB5artzpBdgZ)），本地/云电脑工作空间见[操作手册](https://www.teleai.com.cn/doc/7czHMDStGDQr1JsAMKcZ/Gik5VRTWAer7xDrqNBS7)。

## 2. 数据契约

### 2.1 路径发现

```text
root  = env.TELEAGENT_HOME || join(home(), ".local", "share", "TeleAgent")
owner = JSON.parse(readFile(join(root, "current-owner.json"))).ownerDir
db    = join(root, "users", owner, "teleagent.db")
```

- `current-owner.json` 缺失或解析失败时：取 `users/*/teleagent.db` 中 `mtime` 最新者。
- Windows 待实机确认：按官方文档示例应为 `%USERPROFILE%\.local\share\TeleAgent\users\<owner>\teleagent.db`（与 Linux 同构，不是 `%APPDATA%`）。
- 不读取 `app-auth/token.json`、`device-meta.json` 等凭据文件；只读会话库。

### 2.2 表映射

| Agent Deck 字段 | 来源 |
|---|---|
| `sid` | `session.id` |
| `cwd` | `session.directory`（空值走 2.6 回退） |
| `title` | `session.title` |
| `parentSid` | `session.parent_id` |
| `startedAt` | `session.time_created` |
| `updatedAt` / `revision` | `max(session.time_updated, max(message.time_updated))` |
| `archived` | `session.time_archived` 非空 |
| `app` | 固定 `"desktop"` |

`desktopSessions()` 现有 OpenCode 分支（`src/desktop-sessions.js:26-32`）的 SQL 可直接复用；TeleAgent 没有 `session_v2`，固定走 `session` 表，且 `session` 表**没有 `model` 列**，模型名从 `message.data.modelID` 取。

### 2.3 消息与 part

- `message.data`：`{role, providerID, modelID, agent, mode, cost, tokens, time:{created, completed}, finish, path, summary, error, parentID}`。
- `part.data`：`text`（`type=text` 正文）、`tool`（工具名，可作「进行到哪一步」）、`reasoning`、`step-start` / `step-finish`。
- 正文拼接规则与现有 `desktopMessages()` 一致：只取 `type === "text"` 且非 synthetic/ignored。
- 推理与工具结果**不写入日记**，与现有 OpenCode 处理保持一致。

### 2.4 token 口径

- 直接取 `tokens.output`、`tokens.input`、`tokens.cache.read`、`tokens.cache.write`，与 `src/desktop-sessions.js:57` 现有字段完全一致，Dashboard 热力图/缓存命中率可直接复用。
- 缺失时显示「用量未提供」，**不估算**（AGENTS.md 第 3 条）。
- `reasoning` 计入输出还是单列，需按 Dashboard 现行口径统一；不在本方案内改动统计定义。

### 2.5 状态推导

TeleAgent 的 `session` 表没有 `time_busy` / `idle_outcome`，无法像新版 OpenCode 那样直接读运行态。建议：

```text
单条消息：role=user → run；error/finish=error → error；
         finish ∈ {stop, length} 且 time.completed 存在 → wait；其余 → run
会话级：最近一条消息 age <= 90s 且状态 run → 显示「在跑」，否则「安静」
```

两个必须处理的细节：

1. `finish` 实际值包含 **`tool_calls`（下划线）**，而现有代码判断的是 `"tool-calls"`（`src/desktop-sessions.js:54`），直接复用会把工具调用中的消息误判成 `wait`，需加归一化。
2. `permission` 表可能承载待审批项，可用于派生「等你允许」；数据结构未验证，列入 P2。

### 2.6 项目归属

- `directory` 非空时按现有规则（`sessionProjectName`）推断项目。
- 68 个云端会话 `directory` 为空：回退顺序为 `workspace_id` 映射 → 标题前缀 → 归入「未归类」，**不猜测**。
- `session.parent_id` 非空的可作为子会话来展示，与 DSH/Antigravity 的子块展示规则一致。

## 3. 委派设计（WorkBuddy 同款「复制 + 唤起」）

### 3.1 流程

1. 拖任务到 TeleAgent 卡片 / 行内 `@teleagent` → 走 `handoff()`（`src/delegation.js:632`）。
2. 任务正文复制到剪贴板，唤起 TeleAgent 桌面端，侧栏提示「📋 任务已复制，粘贴到 TeleAgent 里发出」。
3. 任务行进入交接态（`state = starting`，30 分钟超时）。
4. 用户在 TeleAgent 里粘贴执行；插件每轮扫描读 `teleagent.db`，由 `resolveHandoffs()`（`src/delegation.js:735`）按「Agent + 新会话时间 + 正文相似度」认领。
5. 认领后写回 `- 🔗 [...]` 链接行、把任务标成 `DELEGATED`，一轮结束后按 `autoWriteResult` 写结论。

### 3.2 复用点

| 能力 | 现有实现 | 需要补的 |
|---|---|---|
| 复制 + 唤起 | `handoff()` `src/delegation.js:632-658` | `AGENT_APPS.teleagent` 的启动方式 |
| 认领 | `resolveHandoffs()` `:735-763` | 无需改逻辑，只需 reader 产出 `meta.text/lastAt` |
| 链接行 | `J.linkLine()` `src/journal.js:412-423` | 加 `teleagent` 分支，用 `obsidian://agent-deck?do=open&agent=teleagent&sid=…`（同 cursor/grokbot） |
| 打开会话 | `openSession()` `src/delegation.js:428-438` | 归入「复制 sid + 唤起 app」组 |

### 3.3 认领与防误绑

- 沿用现有判定：会话 `lastAt >= job.startedAt - 5s`，且 `text/title` 包含任务名头部或正文头部。
- TeleAgent 会话按任务落本地库，认领成功率应高于 WorkBuddy；但**用户手动开同类任务**仍可能误绑（「一次任务一个会话」是假设，需实机确认）。缓解：认领后提供「这不是这个任务的会话」解绑入口；或 P2 增加「认领需确认」开关。
- 30 分钟未认领 → `cancelled` 并提示，与现有行为一致。

### 3.4 跳转与深链

- 深链：`teleai-cowork` 已注册，但**能否带会话参数未验证**；P2 实测前不承诺会话级直达。
- MVP：点会话 = 唤起 TeleAgent + 复制会话号，用户手动选择（Qoder/WorkBuddy 同款降级）。
- 启动方式需按平台处理：
  - Linux：`/usr/bin/teleagent`（或 `teleagent-launcher`）直接拉起；
  - Windows：安装目录 exe 或 `start`（路径待实机确认）；
  - macOS：`open -a TeleAgent`。
  - 兜底：`openExternal("teleai-cowork://")`（Electron `shell.openExternal`，三平台通用）。

### 3.5 明确不做

- 不启动内核二进制、不调本地 HTTP API、不读取进程环境里的会话密钥——避免逆向依赖与 ToS 风险。
- 不做终端交互、不做后台执行、不做「自动发送」。
- 不在无 token 的情况下估算用量。

## 4. 代码改动清单

| 文件 | 改动 | 估行 |
|---|---|---|
| `src/constants.js` | `AGENTS.teleagent`（`desktopOnly: true`、`trackingOnly` 可先不加）、`AGENT_ORDER`、`DEFAULTS.agents`、`autoLogAgents` | ~15 |
| `src/agent-registry.js` | 能力表：`delegate:false`、`runnerKind:"handoff"`、`desktopHandoffOnly:true`、`terminalHandoff:false` | ~12 |
| `src/readers.js` | `desktopDatabases()` 增加 TeleAgent 库；`roots()` 不动；桌面 SQLite 库默认只读 `settings.fullHistoryDays` 天（`settings.desktopFullHistory` 可切回主力读全量，实测 4367 会话 / 498 MB 库全量读会卡几分钟） | ~10 |
| `src/desktop-sessions.js` | 新增 `teleagent` 分支（复用 `session`/`message`/`part` SQL）、`finish` 归一化、模型名回退 | ~40 |
| `src/delegation.js` | `AGENT_APPS.teleagent`、`openAgentApp` 平台分支、`openSession` 分支 | ~25 |
| `src/journal.js` | `linkLine()` 的 `teleagent` 分支（`obsidian://agent-deck?…`） | ~3 |
| `src/settings.js` / `src/settings-agents.js` | Agent 卡片、来源与扫描、启用状态 | ~25 |
| `src/locales/en/*.js` | 新增文案英文 | ~10 |
| `test/teleagent-sessions.test.mjs` | 建夹具库、路径发现、解析、token、认领 | ~150 |
| `README.md`（英文）/ `README.zh-CN.md`（中文） | 支持表加一行（追踪 ✅ / 后台委派 ❌ / 桌面交接 ✅ 复制 / 终端 ❌ / 直达 ⚠️ 唤起+复制）；1.13.17 起 `README.en.md` 已被上游删除，英文正本是 `README.md` | ~4 |
| `docs/specs/architecture-and-boundaries.md`、`acp-integration.zh-CN.md`、`docs/README.md` | 十一家 → 十八家（1.13.4 时为十二家，1.13.17 合并后上游已扩到十七家 + TeleAgent）、接入原则表加一行、索引加本文 | ~11 |

## 5. 跨平台

| 平台 | 数据路径 | 启动方式 | 状态 |
|---|---|---|---|
| Linux | `~/.local/share/TeleAgent/users/<owner>/teleagent.db` | `/usr/bin/teleagent` | **已实测**（数据面 + 填入式派发；默认不自动提交，见 §5.1） |
| Windows | `%USERPROFILE%\.local\share\TeleAgent\users\<owner>\teleagent.db` | 安装目录 exe / `start` | 待实机 |
| macOS | `~/.local/share/TeleAgent/users/<owner>/teleagent.db` | `open -a TeleAgent` | 待实机 |

两个共用阻塞点（与 Linux/Windows 移植任务重叠）：

1. **`sqlite3` CLI**：**已解决**。1.13.1 起 `src/sqlite.js` 的 `resolveSqliteBinary()` 跨平台探测 `sqlite3` / `sqlite3.exe`（PATH、`/usr/bin`、Homebrew、chocolatey、scoop、WinGet Links），`readers.js` / `desktop-sessions.js` / `cursor-sessions.js` 与测试夹具都改走它；找不到时回退裸名，由调用方按失败处理。
2. **WAL 并发读**：客户端运行时库处于 WAL，读取需 `-readonly` + 失败重试；现有 OpenCode 读取路径可参考。

### 5.1 Linux 派发的实现范围（2026-11-19）

- 模块 `src/teleagent-dispatch-linux.js`：xdotool 定位 XWayland 主窗 → **可选原生 helper `bin/treeland-activate` 做合成器级激活**（treeland 忽略 X11 激活请求；helper 源码在 `src/native/`，`node scripts/build-native.mjs` 按需构建，产物不入库）→ 一次 xdotool 调用内完成「焦点 + 按相对比例点输入框 + `Ctrl+V`」→ 剪贴板写入优先 Obsidian Electron clipboard、回退 xclip；缺 helper 时要求用户先手动切到 TeleAgent，不盲点盲打；
- **默认只做到“填入 + 提示用户手动点运行”**；`submitTeleAgentDispatch` 必须显式 `confirm:true`，未接入 UI。2026-11-19 22:29 在负责人批准下用一次真实提交完成端到端验证（会话 `ses_e0bc97898ffe3NfF3EYllOYSgv`，基于 Windows UI Automation / Linux 坐标实测）；
- 成功判据统一走 `verifyDispatchedSession` 的只读 SQL；填入阶段返回 `verified:false, reason:"not-submitted"`；
- **未验证**：AT-SPI（依赖 root 装包 + 客户端重启，不外推）、多屏/DPI/窗口缩放下的坐标稳定性、深链唤起。

建议顺序：跨平台移植（阶段 A/B）已在 1.13.1 完成（`src/sqlite.js` 探测 + `.cmd`/`.bat` 拉起 + 进程树清理），可以直接接 TeleAgent；接入时注意 Windows 下 `.cmd` 包装脚本经 `cmd.exe` 传参会截断换行，提示词需压成单行（`src/llm.js` 的 `flattenForCmd` 是现成写法）。

## 6. 测试计划

| 层级 | 用例 |
|---|---|
| 单测 | 路径发现（`current-owner.json` 正常 / 缺失 / 损坏）；多账号取最新；`finish` 归一化；token 求和与缺失分支；空 `directory` 回退；归档与子会话 |
| 夹具 | 用 `sqlite3` 建最小 `session/message/part` 库，插入已知 token 与时间，断言解析结果 |
| 集成 | Linux 实机只读核对：面板会话数 = `select count(*) from session`；token 合计 = SQL 汇总 |
| 回归 | `npm test && npm run build && git diff --check`；`test/architecture-refactor.test.mjs` 零循环约束 |
| 边界 | 客户端运行中读库；库增长（27 MB → 增量读）；云电脑空目录；多账号切换 |

## 7. 未验证项与验收标准

未验证（需实机动作，当前未执行）：

1. 客户端**运行时**是否实时写库（30 秒轮询能否看到新增行 / 状态）；
2. Windows 数据路径与启动器；
3. `teleai-cowork://` 是否支持会话定位或预填；
4. 云电脑会话的回写频率；
5. `permission` 表能否派生「等你允许」。

验收标准：

- **P0**：面板出现 TeleAgent 会话且数量与库一致；token 合计与 SQL 汇总一致；无新增网络请求；测试/构建通过。
- **P1**：拖任务后剪贴板有正文、客户端被唤起、笔记出现 `🔗` 链接与 `DELEGATED`、30 分钟内认领成功、超时有提示。
- **P2**：深链可用（或明确记录不可用）；误绑可解绑。

## 8. 分阶段

| 阶段 | 内容 | 产出 | 状态 |
|---|---|---|---|
| P0 | 追踪（路径发现 + 解析 + 设置卡片 + 测试） | 面板 / 日记 / Dashboard 可见 TeleAgent | ✅ 已实现（Windows 实机核验） |
| P1 | 复制交接（handoff + 认领 + 链接行） | 从笔记派任务、结果回写 | ✅ 已实现（拖拽 → 复制 → 唤起 → 文本前缀认领 → 🔗 + DELEGATED；30 分钟超时会提示） |
| P2 | 深链与状态增强（scheme 实测、permission 表、认领确认） | 体验补齐 | ⬜ 未实现 |
| P3 | 文档与 PR（README / specs / CHANGELOG） | 可上游 | 🟡 文档已同步；未提 PR |

## 9. 口径与合规

- 只读本地库，不读取凭据文件、不启动内核、不调本地 API、不发网络请求。
- 不估算缺失 token；单平台实测不外推（AGENTS.md 第 3、5 条）。
- Apache-2.0 / NOTICE 不变；上游 PR 需同步 `docs/specs/` 与 README 支持表。
- 接入完成后把本方案的状态行改为「已实现」，并补实测平台与未测空白。

## 附：核验命令（只读，可复现）

```bash
ROOT="$HOME/.local/share/TeleAgent"
DB="$ROOT/users/$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["ownerDir"])' "$ROOT/current-owner.json")/teleagent.db"
sqlite3 -readonly "$DB" ".tables"
sqlite3 -readonly "$DB" "select count(*) from session; select count(*) from message; select count(*) from part;"
sqlite3 -readonly "$DB" "select distinct j.key from message, json_each(message.data) j;"
```
