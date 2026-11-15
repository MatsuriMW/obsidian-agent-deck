# Agent Deck（智能体甲板）

> 从日记委派 AI 任务，用 Dashboard 回顾每天的 token 用量和项目投入。

**中文** ｜ [English](README.en.md) ｜ [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases) ｜ [更新日志](CHANGELOG.md)

项目目前处于早期高速迭代阶段，体验可能偶有打磨不足或破坏式更新。欢迎在 [Roadmap](https://matsuri.site/portfolio/journal-workflow/#whistlist) 查看后续规划、添加建议并投票，或通过 [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) 与邮件 [klauschen2799@gmail.com](mailto:klauschen2799@gmail.com) 反馈问题。

<p align="center">
  <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4"><img src="assets/demo.gif" width="800" alt="Agent Deck 演示：会话卡片拖到日记里的任务上绑定，任务拖到 Agent 上委派，状态和结论写回日记"></a>
</p>

<p align="center">25 秒演示 · 点图看 <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4">4K60 有声版</a> ｜ 国内可看：<a href="https://matsuri.site/demo/agent-deck/">matsuri.site/demo/agent-deck</a></p>

Agent Deck 把本机分散在各客户端中的 AI Agent 会话集中到 Obsidian 的同一张甲板上：哪个 Agent 在运行、哪个在等待确认、推进到哪一步，一目了然；需要派发任务时，直接从日记或笔记里的任务行委派出去，进度、用时和结论再自动写回这一行。

---

## 核心结构与信息流转

```mermaid
flowchart LR
  subgraph NOTE["Obsidian 日记与笔记"]
    direction TB
    Task["任务行 / 大纲块\n把手 · 拖拽 · @agent"]
    Views["同源多视图与整理\n大纲 · 表格 · 卡片 · 时间线 · 归档"]
  end
  subgraph HARNESS["委派与上下文管道"]
    Ctx["Harness 上下文组装\n母项链 · 双链 · 模型与位置"]
  end
  subgraph AGENTS["本机 8 家 AI Agent"]
    direction TB
    Run["执行端\n后台 ACP/CLI · 桌面版 · 终端"]
    Logs["本机会话日志 / Hooks\nJSONL · SQLite（只读数据源）"]
  end
  subgraph DECK["Agent Deck 控制与回写"]
    direction TB
    Panel["侧栏甲板 · macOS 菜单栏\n实时状态 · 待确认提醒 · 直达跳转"]
    Sync["日志自动回写引擎\n状态 · 结论 · 时段 · 短链"]
  end
  subgraph INSIGHT["回顾分析与长期记忆"]
    direction TB
    Dash["协作回顾 Dashboard\nToken 热力图 · 项目投入排名"]
    Dream["Dreaming 长期记忆\n提炼偏好规律 · 单向共享"]
  end
  Task -->|"委派任务"| Ctx
  Ctx -->|"启动 / 续聊"| Run
  Run -->|"写入对话与事件"| Logs
  Logs -->|"只读增量扫描"| Panel
  Panel <-->|"拖放绑定 / 跳转"| Task
  Logs -->|"零点分割与口语过滤"| Sync
  Sync -->|"写回原任务块"| Views
  Logs -->|"用量汇总"| Dash
  Views -->|"日记证据归属"| Dash
  Views -->|"近 14 天证据"| Dream
```

---

## 核心功能

### 1. 多 Agent 会话追踪面板
- **统一收拢 7 类本地 Agent**：支持 **Claude Code、Codex、WorkBuddy、DeepSeek Harness、Antigravity、OpenCode、Qoder**。
- **实时状态与跳转**：区分运行中、等待回复、需要确认、到达限额、暂停、出错、已完成等状态；点击会话卡片可直接切回对应客户端或终端标签（支持范围见下文边界表）。
- **主力与全局搜索**：可设最多 2 个主力 Agent（追踪全部历史与跨天补记），其余已启用 Agent 读取当日活跃会话；支持按标题、项目、模型、正文关键字搜索全部本地扫描到的会话，并查看最近 14 天协作趋势。

### 2. 从笔记委派与双向拖拽
- **三种委派方式**：
  - 点击任务行末尾的纸飞机把手快速委派，或双击 / `⌘` 单击切换目标 Agent；
  - 直接将笔记列表项拖到侧栏 Agent 卡片上委派；
  - 在任务行内输入 `@` 选择 Agent，继续输入 `/` 选择模型和推理强度（如 `@codex/gpt-6.1-sol/high`）。
- **发送预览与完整上下文**：发送前可预览正文和子块并选择本次工作位置；从子任务委派时自动携带上层母项链（不含无关兄弟分支）及当前子树，也可以在已有 AI 回复块上补充说明并再次委派。
- **拖拽绑定**：将面板中的会话卡片拖到已有任务行上完成绑定，或拖到空白行新建绑定任务；普通绑定会话在行尾显示状态 pill；后台执行在母块下方显示单条进度，保留取消与重试入口，回答结束后隐藏。

### 3. 人机共写日记、整理与归档
- **自动记日记与回写**：定时扫描当日会话，自动匹配或新建日记任务行，实时同步状态、`⏱` 活动时段、每轮简略/标准/详细记录以及嵌套子会话 / Side Chat / Subagent 子块；后台回答不超过 500 字时完整写入子块；超过时返回 `Agent Deck/Answers/` 中的 Markdown 文件链接，文件包含完整问题与回答，清除内部追踪标识，不另调总结模型。普通会话结论默认 350 字，摘要中的长网址与文件路径折叠为可点击短链。
- **标题保护与记录折叠**：保留用户手写修改过的 AI 标题不被覆盖；默认收起历史轮次仅展示最新结论；支持人工切换并锁定任务状态；内部追踪标识在编辑与阅读视图隐藏，并在完成或归档时自动清理。
- **四种持久化记录视图**：支持同一条 AI 自动记录在**大纲 / 表格 / 卡片 / 时间线**间就地切换并按块记住视图偏好，不改写底层 Markdown：

<p align="center">
  <img src="assets/ai-record-views-1.png" width="840" alt="AI 自动记录视图对比：大纲视图与表格视图">
</p>
<p align="center">
  <img src="assets/ai-record-views-2.png" width="840" alt="AI 自动记录视图对比：卡片视图与时间线视图">
</p>

- **一键整理与归档**：**整理日志**可按模板重排当天日记（正在做、还要做、已完成，各区之间与首尾有分割线），只整理完整分区内部，区外笔记保持原样；无完整分区时只建立空分区；**归档已完成的日志到…** 可将已完成的 AI 任务移出日记并按日期沉淀到指定笔记。
- **兼容螺旋日程**：可与 [螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 配套使用，由 Agent Deck 接管 AI 写入、螺旋保留排程与进度展示（螺旋未展示同会话 token 时由 Agent Deck 补全显示）。

### 4. 协作回顾 Dashboard（实验功能，默认开启）
- 展示 GitHub 风格的**每日 Token 热力图**与**24 小时作息与并发**时段分布（含输入、输出与缓存读取，不代表费用；无数据时不估算），支持按最近 7/30/90 天、一年或自定义日期范围筛选。
- 统计 **Agent 分布**与**模型分布**（Token、轮均用量、缓存命中率等）并支持联动筛选；结合日记链接、标题、目录与别名自动汇总**项目投入**（支持按 Token / 耗时 / 会话数 / 名称与升降序排序）、手动修正项目归属、按日期下钻明细并跳回来源日记块或原会话；不调用额外模型，也不改写日记。

<p align="center">
  <img src="assets/dashboard.png" width="680" alt="Agent Deck 协作回顾 Dashboard：Token 热力图、24 小时作息与并发、Agent 与模型分布及项目投入">
</p>

### 5. macOS 菜单栏助手、Dreaming 与双语界面
- **macOS 纯色菜单栏面板**：常驻菜单栏图标，点击或按全局快捷键 **`⌃⌥⌘D`**（可自定义）随时唤起，快速查看今日协作指标及运行中/待确认会话，支持直接跳转。
- **Dreaming 长期记忆（可选，默认关闭）**：基于最近 14 天日记和委派笔记提炼可编辑的长期记忆，支持导出副本或可选同步。
- **界面语言自动跟随**：跟随 Obsidian 设置自动切换中文或英文（笔记正文与发给 CLI 的提示词保持不变）。

---

## 各 Agent 支持情况一览

| Agent | 日志追踪 | 后台委派 | 桌面端交接 | 终端交互 | 直达原会话跳转 |
|---|---|---|---|---|---|
| **Claude Code** | 支持 | 支持（`claude`） | 支持（首轮后自动打开） | 支持 | 支持（桌面 / 终端标签） |
| **Codex** | 支持 | 支持 | 支持（App Server 首轮后打开） | 支持 | 支持（桌面 / 终端标签） |
| **DeepSeek Harness** | 支持 | 支持（`dsh acp`） | 仅唤起客户端 | — | 仅聚焦客户端并复制会话号 |
| **Antigravity** | 支持 | 支持（`agy acp`） | 不支持 | — | 仅聚焦客户端并复制会话号 |
| **OpenCode** | 支持 | 支持（`opencode-cli acp`） | 仅打开应用（共用本地库） | 支持 | 需在桌面端手动选会话 |
| **Qoder** | 支持 | 支持（`qodercli`） | 仅复制任务并唤起桌面端 | 支持 | CLI 走终端恢复；桌面不互通 |
| **WorkBuddy** | 支持 | 不支持 | 仅复制任务并唤起桌面端 | 支持（`codebuddy`） | 仅支持原生桌面会话直达 |

---

## 安装与依赖

### 1. 安装插件
目前尚未上架 Obsidian 社区插件市场，需手动安装（当前版本 **1.9.8**，需 Obsidian **1.4.0+** 桌面端）：

1. 前往 [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases) 下载最新产物中的 `main.js`、`manifest.json`、`styles.css`。
2. 将这 3 个文件放入你的 Obsidian 库目录：`<Vault>/.obsidian/plugins/agent-deck/`。
3. 在 Obsidian「设置 → 第三方插件」中启用 **Agent Deck**。

<details>
<summary>从源码构建（仅开发者需要）</summary>

需要本机已安装 Node.js 与 npm：

```bash
git clone https://github.com/MatsuriMW/obsidian-agent-deck.git
cd obsidian-agent-deck
npm install
npm run build
```

构建完成后将 `main.js`、`manifest.json`、`styles.css` 放入 `<Vault>/.obsidian/plugins/agent-deck/`（或直接运行 `npm run install:plugin -- <你的Vault路径>` 跨平台复制）。

</details>

### 2. 运行依赖（按需准备，无需全装）

- **仅使用面板追踪、任务绑定与回顾 Dashboard**：**无需额外依赖**，直接读取本机已有客户端日志，不发起网络请求。
- **使用委派、自动记日记、AI 总结/润色与 Dreaming**：需要安装并登录你实际要用的本机 Agent CLI / 桌面端：

| 功能 / Agent | 需要提前准备什么 |
|---|---|
| **Claude Code** | 安装并登录 `claude` CLI；需桌面续聊则另装 Claude 桌面端 |
| **Codex** | 安装并登录 `codex` CLI 与 Codex 桌面端（支持复用桌面端内置 CLI） |
| **DeepSeek Harness** | 安装支持 ACP 的 `dsh`，并完成模型提供商与账号配置 |
| **Antigravity** | 安装并登录**独立 Antigravity CLI（`agy`）**（仅装 IDE 无法委派） |
| **OpenCode** | 安装 OpenCode 桌面端（内置 `opencode-cli`）或独立 `opencode` CLI 并完成配置 |
| **Qoder** | 后台与终端委派需安装并登录 `qodercli`；仅桌面复制交接需安装 Qoder 桌面端 |
| **WorkBuddy** | 安装中国版 WorkBuddy 桌面端（终端交互需另装 `codebuddy` CLI） |
| **自动记日记 / AI 总结 / Dreaming** | 需至少一个已登录且额度可用的 `claude` 或 `codex` CLI（在「记录 → 整理模型」单独指定） |
| **macOS 菜单栏助手** | 需 Xcode Command Line Tools 中的 `swiftc`（未安装时可运行 `xcode-select --install`）；不用可在设置中关闭 |

> **提示**：
> - 从 macOS 图形界面启动 Obsidian 时，`PATH` 可能与终端不同；若检测不到命令，请在插件设置中填写 CLI 的完整绝对路径。
> - 设置页中的「检查」按钮仅验证程序路径与版本号，**不代表账号已登录或模型可用**；请先在终端验证登录与额度后再进行委派。

---

## 当前受限与暂不支持的功能

1. **平台支持边界**
   - **仅限桌面端**：不支持 Obsidian 移动端。
   - **Windows 尚未完成实机验证**：插件在 macOS 上开发并实测；1.9.8 尚未在 Windows 上实机验证。macOS 菜单栏助手仅限 macOS；终端自动唤醒、标签切换与部分路径探测目前仍依赖 macOS 环境。
2. **无通用远程 API 委派后端**
   - 自动委派依赖本机 CLI 或桌面应用，暂不支持直接填写通用远程 API Key / SDK 进行云端委派；插件也不会自动安装 CLI 或代为登录。
3. **不支持在插件内直接续聊**
   - Obsidian 内的对话窗口仅用于查看回复正文、停止当前轮与保存归档笔记，没有输入发送框；后续追问需回到各 Agent 的桌面客户端或终端中继续。
4. **部分客户端集成边界**
   - **WorkBuddy**：仅支持**中国版** WorkBuddy；不支持国际版（WorkBuddy AI）。不支持插件管理的后台执行；独立 CodeBuddy CLI 会话无法导入 WorkBuddy 桌面端。
   - **Qoder**：`qodercli` 会话与 Qoder 桌面端数据库相互独立不互通；桌面端未输出逐轮 token 时不做估算。
   - **Antigravity**：CLI 会话与原 IDE 会话互不相通，暂不承诺自动识别归档；导出正文不包含工具执行结果、内部推理过程与附件。
   - **DeepSeek Harness**：桌面端仍在快速迭代中，稳定性有限，且暂不支持通过链接直达具体会话。
   - **OpenCode**：后台与桌面共享会话存储，但跳转打开桌面端后仍需手动选择对应会话。
5. **终端交互委派的实测范围**
   - 在终端新开标签页自动运行交互式会话的功能，目前仅在 **Tern** 和 **Herdr** 上完成端到端实测；**系统终端（Terminal.app）、iTerm2、Warp** 尚未实测（Warp 无脚本接口，仅能前置窗口）。
6. **规划中、尚未实现的功能**
   - **阅读视图下的 AI 记录多视图渲染与看板视图**、**新版 Cursor 桌面端会话追踪**、**Grok Bot（Sand）会话追踪与按 Bot 过滤**、**Pi 支持**、**在委派确认弹窗内直接切换模型/强度/记录粒度**、**对已有 AI 块单独调整粒度**、**WorkBuddy 自动发送**，以及面向独立大纲 App 的 **LLM Wiki 自动摄入** 等能力仍在规划中，当前版本尚未提供。

---

## 隐私与开源协议

- **本地优先**：会话读取、面板统计、回顾 Dashboard 与 macOS 菜单栏助手均只读取本机文件，插件自身不上传任何数据。仅在用户主动触发委派、自动整理、AI 总结或 Dreaming 时，才会将对应任务文本或摘要传给本机已登录的 CLI 模型服务。
- **开源协议**：采用 [Apache 2.0](LICENSE) 协议开源（见 [NOTICE](NOTICE)）。
- **更多文档**：各版完整改动见 [CHANGELOG.md](CHANGELOG.md)；开发者架构、规范与后续方向见 [docs/](docs/)（含 [WorkFlowy 分形看板规划](docs/specs/fractal-boards-roadmap.md)）。
- **反馈与建议**：欢迎在 [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) 反馈问题，或前往 [Roadmap](https://matsuri.site/portfolio/journal-workflow/#whistlist) 提交想法与投票；动态更新见 Twitter [@Matsurimywaifu](https://x.com/Matsurimywaifu)。
