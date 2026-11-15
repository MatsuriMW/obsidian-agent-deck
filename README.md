# Agent Deck（智能体甲板）

> 从日记委派 AI 任务，用 Dashboard 回顾每天的 token 用量和项目投入。

**中文** ｜ [English](README.en.md) ｜ [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases) ｜ [更新日志](CHANGELOG.md)

项目目前处于早期高速迭代阶段，体验可能偶有打磨不足或破坏式更新。欢迎通过 [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) 或邮件 [klauschen2799@gmail.com](mailto:klauschen2799@gmail.com) 反馈问题与建议。

<p align="center">
  <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4"><img src="assets/demo.gif" width="800" alt="Agent Deck 演示：会话卡片拖到日记里的任务上绑定，任务拖到 Agent 上委派，状态和结论写回日记"></a>
</p>

<p align="center">25 秒演示 · 点图看 <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4">4K60 有声版</a> ｜ 国内可看：<a href="https://matsuri.site/demo/agent-deck/">matsuri.site/demo/agent-deck</a></p>

Agent Deck 把本机分散在各客户端中的 AI Agent 会话集中到 Obsidian 的同一张甲板上：哪个 Agent 在运行、哪个在等待确认、推进到哪一步，一目了然；需要派发任务时，直接从日记或笔记里的任务行委派出去，进度、用时和结论再自动写回这一行。

---

## 核心功能

### 1. 多 Agent 会话追踪面板
- **统一收拢 7 类本地 Agent**：支持 **Claude Code、Codex、WorkBuddy、DeepSeek Harness、Antigravity、OpenCode、Qoder**。
- **实时状态与跳转**：区分运行中、等待回复、需要确认、到达限额、暂停、出错、已完成等状态；点击会话卡片可直接切回对应客户端或终端标签（支持情况见下文边界表）。
- **主力与全局搜索**：可设最多 2 个主力 Agent（追踪全部历史与跨天补记），其余已启用 Agent 读取当日活跃会话；支持按标题、项目、模型、正文关键字搜索全部本地扫描到的会话，以及查看最近 14 天协作趋势。

### 2. 从笔记委派与双向拖拽
- **三种委派方式**：
  - 点击任务行末尾的纸飞机把手快速委派，或双击 / `⌘` 单击切换目标 Agent；
  - 直接将笔记列表项拖到侧栏 Agent 卡片上委派；
  - 在任务行内输入 `@` 选择 Agent，继续输入 `/` 选择模型和推理强度（如 `@codex/gpt-6.1-sol/high`）。
- **完整上下文携带**：从子任务委派时自动携带上层母项链（不含无关兄弟项）及当前任务子树；也可以在已有 AI 回复块上继续补充说明并再次委派。
- **拖拽绑定**：将面板中的会话卡片拖到已有任务行上完成绑定，或拖到空白行新建绑定任务；已有会话绑定后，任务行尾会显示动态进度 pill，支持暂停/取消与重试。

### 3. 人机共写日记、整理与归档
- **自动记日记与回写**：定时扫描当日会话，自动匹配或新建日记任务行，实时同步状态、`⏱` 活动时段、每轮简略/标准/详细记录、嵌套子代理/Side Chat 子块；后台任务会将完整对话原文归档至 `Agent Deck/Conversations/`，并在日记中附上约 240 字的 AI 总结（结论、改动、未完成）与原文链接。
- **AI 记录折叠与标题保护**：默认收起历史轮次只展示最新结论，支持手写修改 AI 标题并保留原文；所有 AI 内部定位标识仅在后台生效，完成或归档时自动清理。
- **一键整理与归档**：**整理日志**可按模板重排当天日记（已完成置顶、进行中按状态和轮数分组、保留手写笔记）；**归档已完成的日志到…** 可将已完成的 AI 任务移出日记并按日期沉淀到指定笔记。
- **兼容螺旋日程**：可与 [螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 配套使用，由 Agent Deck 接管 AI 写入、螺旋保留排程与进度展示。

### 4. 协作回顾 Dashboard（实验功能，默认开启）
- 展示 GitHub 风格的**每日 Token 热力图**（含输入、输出与缓存读取，不代表费用），支持按最近 7/30/90 天、一年或自定义日期范围筛选。
- 结合日记链接、标题、目录与别名自动统计**项目投入排名**，支持手动修正项目归属、按点击日期查看明细，并直接跳回来源日记块或原会话。

### 5. macOS 菜单栏助手与辅助功能
- **macOS 纯色菜单栏面板**：常驻菜单栏图标，点击或按全局快捷键 **`⌃⌥⌘D`**（可自定义）随时唤起，快速查看今日协作指标及运行中/待确认会话，支持直接跳转。
- **Dreaming 长期记忆（可选，默认关闭）**：基于最近 14 天日记和委派笔记提炼长期记忆，支持手动编辑、导出副本或可选同步。
- **界面语言自动跟随**：跟随 Obsidian 设置自动切换中文或英文（笔记正文与提示词不变）。

---

## 各 Agent 支持情况一览

| Agent | 日志追踪 | 后台委派 | 桌面端交接 | 终端交互 | 直达原会话跳转 |
|---|---|---|---|---|---|
| **Claude Code** | 支持 | 支持 | 支持（首轮后自动打开） | 支持 | 支持（桌面 / 终端标签） |
| **Codex** | 支持 | 支持 | 支持（App Server 首轮后打开） | 支持 | 支持（桌面 / 终端标签） |
| **DeepSeek Harness** | 支持 | 支持 | 仅唤起客户端 | — | 仅聚焦客户端并复制会话号 |
| **Antigravity** | 支持 | 支持 | 不支持 | — | 仅聚焦客户端并复制会话号 |
| **OpenCode** | 支持 | 支持 | 仅打开应用（共用本地库） | 支持 | 需在客户端手动选会话 |
| **Qoder** | 支持 | 支持（`qodercli`） | 仅复制任务并唤起桌面端 | 支持 | CLI 走终端恢复；桌面不互通 |
| **WorkBuddy** | 支持 | 不支持 | 仅复制任务并唤起桌面端 | 支持（`codebuddy`） | 仅支持原生桌面会话直达 |

---

## 安装与依赖

### 1. 安装插件
目前尚未上架 Obsidian 社区插件市场，需手动安装（当前版本 **1.9.7**，需 Obsidian **1.4.0+** 桌面端）：

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

构建完成后同样将生成的 `main.js`、`manifest.json`、`styles.css` 放入 `<Vault>/.obsidian/plugins/agent-deck/`（或运行 `npm run install:plugin -- <你的Vault路径>`）。

</details>

### 2. 运行依赖（按需准备，无需全装）

- **仅使用面板追踪、任务绑定与回顾 Dashboard**：**无需额外依赖**，直接读取本机已有客户端日志，不发起网络请求。
- **使用委派、自动记日记、AI 总结/润色与 Dreaming**：需要安装并登录你实际要用的本机 Agent CLI / 桌面端：

| 功能 / Agent | 需要提前准备什么 |
|---|---|
| **Claude Code** | 安装并登录 `claude` CLI；需桌面续聊则另装 Claude 桌面端 |
| **Codex** | 安装并登录 `codex` CLI 与 Codex 桌面端（支持使用桌面端内置 CLI） |
| **DeepSeek Harness** | 安装可运行后台委派的 `dsh`，并完成模型提供商与账号配置 |
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
   - **Windows 尚未完成实机验证**：插件在 macOS 上开发并实测；Windows 端尚未完成 1.9.7 实装验证。macOS 菜单栏助手仅在 macOS 上可用；终端自动唤醒、切换标签与部分客户端路径解析目前仍依赖 macOS 环境。
2. **无通用远程 API 委派后端**
   - 自动委派依赖本机 CLI 或桌面应用，暂不支持直接填写通用远程 API Key / SDK 进行云端委派；插件也不会自动安装 CLI 或代为登录。
3. **不支持在插件内直接续聊**
   - Obsidian 内的对话窗口仅用于查看回复正文与归档笔记，没有输入发送框；后续多轮对话需跳转回对应 Agent 的桌面客户端或终端中继续。
4. **部分客户端集成边界**
   - **WorkBuddy**：仅支持**中国版** WorkBuddy；不支持国际版（WorkBuddy AI）。不支持插件管理的后台执行；独立 CodeBuddy CLI 会话无法导入 WorkBuddy 桌面端。
   - **Qoder**：`qodercli` 会话与 Qoder 桌面端数据库相互独立不互通；桌面端未输出逐轮 token 时不做估算。
   - **Antigravity**：CLI 会话与原 IDE 会话互不相通，暂不承诺自动识别归档；导出正文不包含工具执行结果、内部推理过程与附件。
   - **DeepSeek Harness**：桌面端仍在快速迭代中，稳定性有限，且暂不支持通过链接直达具体会话。
   - **OpenCode**：后台与桌面共享会话存储，但跳转打开桌面端后仍需手动选择对应会话。
5. **终端交互委派的实测范围**
   - 在终端新开标签页自动运行交互式会话的功能，目前仅在 **Tern** 和 **Herdr** 两款终端上完整实测通过；**系统终端（Terminal.app）、iTerm2、Warp** 尚未完成实测（其中 Warp 无脚本接口，仅能唤起窗口）。
6. **规划中、尚未实现的功能**
   - **Grok Bot（Sand）会话追踪与按 Bot 过滤**、**新版 Cursor 桌面端追踪**、**Pi 支持**、**在委派确认弹窗内直接切换模型/强度/记录粒度**、**对已有 AI 记录块单独调整记录粒度/视图**，以及面向独立大纲 App 的 **LLM Wiki 自动摄入** 等能力仍在规划中，当前版本尚未提供。

---

## 隐私与开源协议

- **本地优先**：会话读取、面板统计、回顾 Dashboard 与 macOS 菜单栏助手均只读取本机文件，插件自身不上传任何数据。仅在用户主动配置并触发委派、自动整理、AI 总结或 Dreaming 时，会将对应任务文本或摘要传给你本机已登录的 CLI 模型服务。
- **开源协议**：采用 [MIT](LICENSE) 协议开源。
- **更多文档**：各版完整改动见 [CHANGELOG.md](CHANGELOG.md)；其余参考文档见 [docs/](docs/)。
- **动态与交流**：Twitter [@Matsurimywaifu](https://x.com/Matsurimywaifu)。
