# Agent Deck（智能体甲板）

> 一个面板看清本机所有 AI Agent：谁在跑、谁在等你、刚才那步到哪了；需要时从正在写的任务行直接委派。

[English](README.md) ｜ [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases)

Agent Deck 是 Obsidian 插件，把本机 **Claude Code、Codex、WorkBuddy、DeepSeek Harness** 四类 Agent 会话收进同一张「甲板」：主力 Agent 全量追踪，其它 Agent 只看正在跑的；在跑、等你、安静、需要你确认、额度用完、出错停下这些状态用 TODOseq 的任务关键词和颜色标出来，点一行就回到对应客户端。

委派保持命令驱动：不在每个列表项上放按钮；任务行绑定了会话后，行尾的 pill 才变成进度条，完成后把结果写回笔记。macOS 菜单栏还有一块常驻的纯色面板，菜单栏被系统藏起来时可以用自定义全局快捷键唤起。

它从[螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 里「人机协作 / AI 追踪」那一半拆出来，补上了第二个主力 Agent、DeepSeek Harness 的 ACP 委派、模型 / 强度 / 权限模式选择、分层的模型设置页，以及一块可读性更高的 SwiftUI 菜单栏面板。

![Agent Deck 设置](assets/agents.png)

## 功能

- **本机 Agent 面板**：Claude Code、Codex、WorkBuddy、DeepSeek Harness 的在跑、等你、安静会话，带项目、最近一步、时长和 token。点一行用 deeplink 回到那个会话。
- **最多两个主力 Agent**：主力全量读（全部历史、跨天补记）；其它开着的只读今天有动静的会话。
- **命令驱动委派**：用 `Agent Deck: 委派光标所在块…`，或者继续用你原来的 **块去向 → 委派给 Claude** 快捷键。Agent Deck 不会在每个列表项上放「委派」按钮。需要临时改模型、强度、权限模式、工作目录时，用 `Agent Deck: 委派选项…`。
- **进度只长在绑定了会话的行上**：有 `🔗` 或正在委派的行，行尾才出现状态 pill。委派中 pill 自己填充、显示已用时间，旁边有 `×` 取消。答完变成「完成」，结果写成任务下面一行 `💬`。没有会话的行保持干净。
- **记录留在笔记里**：委派会写一行 `🔗`，状态改成 `DELEGATED`。删掉 `🔗` 就是解绑。
- **分层模型设置**：默认模型、默认强度滑杆、能力标签、搜索筛选、启用开关、置顶排序、每行菜单、任务模型。改动先放在「Unsaved changes」条里，点保存才落盘。
- **只读本机**：只读 `~/.claude`、`~/.codex`、`~/.workbuddy`、`~/.dsh`，不上传。插件目录里的 `usage.json` 存按天的汇总，日志被轮转掉历史还在。
- **全站 Lucide 图标**：Agent、状态、工具和窗口图标都换成 Lucide；正在跑的图标用 CSS 旋转。
- **Agent 汇总搬到 macOS 菜单栏**：Obsidian 右下角不再显示 Agent 会话汇总。系统最上方只留一个小图标和一串短说明，比如 `2 跑 · 1 等`；点开是一块纯色面板，任务卡片可以直接跳会话。

![macOS 菜单栏](assets/menubar.png)

## macOS 菜单栏

菜单栏是一个很小的 SwiftUI 助手，第一次运行时编译。它不是面板的复制，而是「现在谁在跑、谁在等我」的快速入口。

- **纯色，不毛玻璃。** 面板是一个无边框窗口，所有表面都是不透明颜色：没有 `NSPopover`、没有 vibrancy、没有磨砂材质，在 macOS 26 上文字对比度不会被玻璃效果吃掉。浅色背景是接近 Obsidian 主题色的浅底，深色模式也有独立的纯色配色。
- **任务关键词来自 TODOseq。** 每张卡片右上角标 `DOING`、`WAITING`、`NEEDOK?`、`HITLIMIT!`、`PAUSED`、`ERRORED`、`DONE`、`LATER`、`TODO`，前面配 TODOseq 里同一个 SVG 图标和任务状态色；`DOING` 的 loader-circle 在面板打开时一直转。顶部统计 `DOING` / `WAITING`，有 `NEEDOK?` 会话时会出现橙色提醒条。
- **卡片就是卡片。** 白底、1px 描边、柔和阴影、左侧状态色轨、Agent 图标徽章、项目名和当前步骤；鼠标悬停时卡片会轻微浮起。
- **默认五条。** 一眼先看前五个会话，其余向下滑动；底部会写清楚一共多少个。
- **在右侧，也有快捷键。** 状态项常驻菜单栏右侧；如果 macOS 因为菜单栏排满把它藏起来，按 **⌃⌥⌘D**（Control + Option + Command + D）就能在任意 App 里打开或聚焦面板。再按一次不会关掉它；用 Esc 或点面板外面关闭。快捷键可以在 **设置 → 追踪 → 菜单栏快捷键** 里改，不需要辅助功能权限。
- **主力 Agent**（最多两个）给更多行：正在跑的、等你的，加上最近六小时内的会话，默认每个主力最多 6 条。
- **其它 Agent** 只给正在运行的会话，默认每个最多 3 条。**WorkBuddy 例外**：它的等待会话也会列出来，因为那是每天要接着处理的事。
- 顶部有一排所有已启用 Agent 的小标签，带在跑 / 等你数量；即使某个 Agent 当前没有可列出的会话，它的标签也在。
- 点一行和面板里的跳转一样：Claude Code / WorkBuddy 直接打开会话；DeepSeek Harness 聚焦客户端并复制会话号；Codex 复制 `codex resume <id>`。
- **打开面板** 走 `obsidian://agent-deck`；**重新扫描** 立刻扫一遍；**隐藏** 从菜单栏里直接关掉。

Agent Deck 的主面板仍然保留 1.0.2 的低饱和配色；只有 macOS 菜单栏用了这套更醒目的任务状态色。

第一次启动需要 `swiftc`（Xcode Command Line Tools）。插件会编译 `~/.agent-deck/AgentDeckMenuBar.app` 并启动它；Obsidian 退出时它也会退出。源码已经打包在插件里，不需要另外下载。菜单栏没出现时，到 **追踪 → 重启菜单栏**，或者先运行 `xcode-select --install`。

如果菜单栏已经排满（或者 Ice 把它收进了隐藏区），按 **⌃⌥⌘D** 打开或聚焦面板（再按一次不会关闭，用 Esc 或点面板外面关闭）。也可以在命令面板里运行 **Agent Deck: 打开 macOS 菜单栏面板**。

![分层模型设置](assets/models.png)

## 委派到哪儿

### Claude Code

Agent Deck 用无头方式起一个 Claude Code 会话，把下面这些参数传过去：

- `--model`（Opus 5、Sonnet 5、Haiku 5.5、Fable，或自定义别名）
- `--effort`（low、medium、high、xhigh、max）
- `--permission-mode`（`plan`、`auto`、`acceptEdits`、`manual`）
- `-n` 会话名，`--add-dir` 把库加进可读目录

第一轮在后台跑完以后，可以用 `claude://resume?session=<id>` 在 Claude 桌面版里接着聊。

如果 Claude Code 没信任过这个库，插件会读 `~/.claude.json`，找一个已经信任的目录当工作目录，再用 `--add-dir` 把库加进去。可以在「委派 → 库没被信任时自动换个目录」关掉。

### DeepSeek Harness

通过 `dsh acp` 走 ACP（Agent Client Protocol）：建真正的 Harness 会话，选模型和 `reasoning_effort`，发 prompt，跟 `session/update` 流。会话落在 `~/.dsh/sessions`，所以面板里也能追踪到。

ACP 没有 Claude 那套 plan/auto 权限模式；插件可以选择自动允许一次工具调用，或者拒绝并在通知里提醒你。

### Codex / WorkBuddy

Codex 和 WorkBuddy 只追踪，不委派。Codex 没有会话 URL，面板会复制 `codex resume <id>`；WorkBuddy 用 `workbuddy://chat/<id>` 打开。

## Deeplink

| Agent | 链接 | 状态 |
|---|---|---|
| Claude Code | `claude://resume?session=<id>` | 可用 |
| WorkBuddy | `workbuddy://chat/<id>` | 可用 |
| DeepSeek Harness | `dsh://open` | 只能聚焦客户端；当前桌面版没有按会话跳转的 URL。插件会把会话号复制到剪贴板，方便你去侧栏找。 |
| Codex | 无 | 复制 `codex resume <id>` |

## 状态 pill

这个 pill 是 CodeMirror 的 widget，只出现在已经绑定了会话或正在委派的行上，不是每个列表项都有。四个状态：

1. **准备中**，会话正在创建。
2. **委派中**，液体填充 + 已用时间 + `×`。
3. **等你 / 等你允许**，缓慢呼吸。
4. **完成 / 出错**，带打开或重试。

参数面板从命令面板的「委派选项…」打开，也可以点状态 pill 上的 ⌄：

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

`npm run build` 用 esbuild 生成 `main.js`。运行时唯一的依赖是 `fzstd`，用来解 DeepSeek Harness 的 zstd 会话日志。

## 设置

- **Agents**：开关每个 Agent、选最多两个主力、立即扫描、导入螺旋日程历史。
- **委派**：默认目标、模型、强度、权限模式、工作目录、提示词前后缀、写回规则、信任回退。
- **Models**：上面那个分层模型页。
- **追踪**：日记分界、轮询间隔、安静阈值、历史天数、macOS 菜单栏开关和条数、界面开关、重算、导入，以及一键「停用螺旋日程里的 AI 追踪」。
- **关于**：版本、许可证、调试信息。

## 和螺旋日程并存

Agent Deck 认同一套 `🔗` 行。两个插件都开着时，螺旋日程也会看到 Claude 会话，可能把 `DELEGATED` 改成 `TOREVIEW`。

Agent Deck 会自动隐藏螺旋日程右下角的 🤖 Agent 汇总；它自己的日程状态栏和计时照常。用 **追踪 → 停用螺旋日程里的 AI 追踪** 可以进一步关掉它的 AI 面板、自动记日记、状态写回和 `💬` 写回，日程本身不动。改之前会在旁边备份一份螺旋日程的 `data.json`。写入后请在 Obsidian 设置里重新加载螺旋日程（或重启 Obsidian），让它重新读取设置；Agent Deck 不会自动启停别的插件。🤖 那一项也可以在同一个设置页恢复。

如果你在用 **块去向（done-to-top）** 和 **日记整理（journal-tidy）**，请更新到 **done-to-top 1.17.3+** 和 **journal-tidy 1.9.1+**。这两个版本会让带「明天 / 后天 / 大后天」的 `DELEGATED` 块留在今天的 DOING 区，不会搬到明天的日记；也不会再折叠第一条分割线之前的 DOING / TODO 块。

## 隐私

- 会话日志用 Node 的 `fs` 在本地读。
- 追踪部分不发任何网络请求。
- 委派只是启动本机的 `claude` / `dsh` 进程。
- `usage.json` 只存按天的汇总和会话摘要，不存完整对话。
- 菜单栏助手只读 `~/.agent-deck/menubar.json`，不发网络请求。

## 发布与校验

Release 由 GitHub Actions 从对应 tag 构建；`main.js`、`manifest.json`、`styles.css` 带 build provenance attestation，可以用 GitHub CLI 校验：

```bash
gh attestation verify main.js --repo MatsuriMW/obsidian-agent-deck
```

## 致谢

- 从[螺旋日程 Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) 拆出，日程仍然是它。
- 「进度长在触发按钮里」的交互参考小红书 [@ZZ.X 的《AI 任务进度，长在触发按钮里》](https://xhslink.cn/o/3gmyiCARRj2)。
- 分层模型设置页参考 [@ZZ.X 的《AI 产品模型设置》](https://xhslink.cn/o/AwW7VhnzX6m)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
