# Agent Deck（智能体甲板）

> Track every agent. Delegate from the line you are already looking at.

Agent Deck is an Obsidian plugin that reads the local session logs of **Claude Code, Codex, WorkBuddy and DeepSeek Harness**, shows what each agent is doing now, and tracks delegated tasks from the editor. Delegation itself stays command-driven: Agent Deck does not put a trigger on every list item. Once a line is bound to a session, the line-end pill becomes the progress surface: the fill moves with the session, the label changes to **Delegating**, and a cancel control appears next to it.

It is the AI/agent tracking half of [Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral), extracted into a standalone plugin and extended with a second primary agent, DeepSeek Harness, model/effort/mode selection, and a layered model picker.

![Agent Deck settings](assets/agents.png)

## What it does

- **A dashboard for the agents on this Mac.** Running, waiting and quiet sessions for Claude Code, Codex, WorkBuddy and DeepSeek Harness, with project, last step, elapsed time and tokens. Click a row to open that session in its client.
- **Two primary agents, full history.** Pick up to two agents as primaries. They are read in full (all history, cross-day catch-up); every other enabled agent is only read for sessions that moved today.
- **Command-driven delegation.** Use `Agent Deck: 委派光标所在块…` or your existing **块去向 → 委派给 Claude** shortcut. Agent Deck does not put a **Delegate** button on every list item. The options sheet is still available from `Agent Deck: 委派选项…` when you want model, effort, permission mode or a working directory that differs from the defaults.
- **Progress only on bound lines.** A line with a `🔗` session or a running delegation gets a line-end pill. While the job runs the pill fills and shows the elapsed clock; the `×` cancels it. When the agent answers, the pill becomes **Done** and the result is written under the task as one `💬` line. Lines with no session stay clean.
- **Note-native records.** Delegation writes a `🔗` line under the task and changes the status to `DELEGATED`; the line is the source of truth. Delete the `🔗` line to unbind.
- **Layered model settings.** A global default model, a default effort slider, capability tags, search/filter, enable switches, pinned order, per-row menu, and task models. Changes sit in an **Unsaved changes** bar until you save them.
- **Local only.** Everything is read from `~/.claude`, `~/.codex`, `~/.workbuddy` and `~/.dsh`. Nothing is uploaded. The plugin stores its own aggregate in `usage.json` next to the plugin, so history survives log rotation.
- **Lucide icons throughout.** Agent, status, tool and window icons are Lucide; running states use a CSS spinner.
- **The agent summary lives in the macOS menu bar.** Obsidian's bottom-right status bar no longer carries the agent session summary. A small status item shows an icon plus something like `2 跑 · 1 等`; click it for a solid, opaque panel of task cards you can jump from.

![macOS menu bar](assets/menubar.png)

## macOS menu bar

The menu bar item is a tiny SwiftUI helper app compiled on first use. It is not a second copy of the dashboard: it is the quick "what is running / what needs me" surface.

- **Solid, not glassy.** The panel is a borderless window with opaque surfaces. There is no `NSPopover`, no vibrancy and no frosted material, so text keeps its contrast on macOS 26. The light background is a near-white tint of the current Obsidian theme, and dark mode has its own solid palette.
- **Rows speak TODOseq.** Each card is tagged with a TODOseq keyword — `DOING`, `WAITING`, `NEEDOK?`, `HITLIMIT!`, `PAUSED`, `ERRORED`, `DONE`, `LATER`, `TODO` — with the same SVG icon and task-state colour TODOseq uses. `DOING` keeps its loader-circle spinning while the panel is open. The header counts `DOING` / `WAITING`, and any `NEEDOK?` session gets an orange reminder.
- **Cards are card-like.** White surface, 1px border, a soft shadow, a state-coloured rail, the agent's glyph badge, the project and the current step. Hovering lifts the card.
- **Five at a time.** The first five sessions are visible; the rest are a scroll away. The footer tells you how many sessions are in the list.
- **Always clickable.** If macOS parks the status item off-screen because the menu bar has no free slot, a small wand icon appears in the free area left of the status items. It opens and closes the same panel, and hides automatically once the real status item is visible.
- **Primary agents** (up to two) contribute more rows: all live sessions plus recent sessions from the last six hours, up to six per primary by default.
- **Other agents** contribute only sessions that are currently running, up to three per agent by default. **WorkBuddy is the exception**: its waiting sessions are listed too, because they are part of the daily loop.
- The header shows all enabled agents as chips, with running and waiting counts, including agents that have no row at the moment.
- Clicking a row opens the same deeplink as the dashboard. DeepSeek Harness focuses the client and copies the session id; Codex copies `codex resume <id>`.
- **打开面板** opens the Obsidian dashboard via `obsidian://agent-deck`; **重新扫描** triggers a scan; **隐藏** disables the menu bar from inside the panel.

The dashboard itself keeps the calmer 1.0.2 palette; only the menu bar uses the vivid task-state colours.

The first start needs `swiftc` (Xcode Command Line Tools). The plugin compiles `~/.agent-deck/AgentDeckMenuBar.app`, then launches it. It exits when Obsidian exits. The source is included in the plugin bundle, so no separate download is needed. If the menu bar does not appear, open **追踪 → 重启菜单栏** or install the command line tools with `xcode-select --install`.

If the menu bar is full (or a menu-bar manager such as Ice has the item in its hidden section), look for the small wand icon in the free area left of the status items: it opens and closes the same panel. You can also run **Agent Deck: 打开 macOS 菜单栏面板** from the command palette.

![Layered model settings](assets/models.png)

## Delegate targets

### Claude Code

Agent Deck starts a headless Claude Code session with:

- `--model` (Opus 5, Sonnet 5, Haiku 5.5, Fable, or a custom alias)
- `--effort` (low, medium, high, xhigh, max)
- `--permission-mode` (`plan`, `auto`, `acceptEdits`, `manual`)
- `-n` for the session name, `--add-dir` for the vault

The first turn runs in the background. The session can then be reopened in the Claude desktop app with `claude://resume?session=<id>`.

If Claude Code has never trusted the vault, the plugin reads `~/.claude.json` and starts in a directory that Claude already trusts, adding the vault with `--add-dir`. This behaviour can be turned off in **委派 → 库没被信任时自动换个目录**.

### DeepSeek Harness

Agent Deck speaks ACP (Agent Client Protocol) to `dsh acp`. It creates a real Harness session, selects the model and `reasoning_effort`, sends the prompt, and follows the `session/update` stream. The session is persisted in `~/.dsh/sessions`, so it also appears in the dashboard afterwards.

ACP does not expose Claude-style plan/auto permission modes. Instead the plugin can auto-approve one-shot tool permissions, or reject them and notify you.

### Codex and WorkBuddy

Codex and WorkBuddy are tracked read-only. Codex has no session URL, so the dashboard copies `codex resume <id>`. WorkBuddy opens with `workbuddy://chat/<id>`.

## Deep links

| Agent | Link | State |
|---|---|---|
| Claude Code | `claude://resume?session=<id>` | Works |
| WorkBuddy | `workbuddy://chat/<id>` | Works |
| DeepSeek Harness | `dsh://open` | Opens the client; the desktop build does not expose a per-session URL yet. Agent Deck copies the session id to the clipboard so you can find it in the sidebar. |
| Codex | none | Copies `codex resume <id>` |

## The status pill

The pill is a CodeMirror widget. It only lives on lines that already have a session or delegation, not on every list item, and it has four states:

1. **Starting**, while the session is being created.
2. **Delegating**, with a liquid fill, elapsed time and `×`.
3. **Waiting / needs approval**, with a slow glow.
4. **Done** or **Error**, with an open/retry control.

The options sheet is opened from the command palette (`委派选项…`) or from the chevron on a status pill:

## Installation

This plugin is not in the community store yet. Install it manually:

1. Download or clone this repository.
2. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/agent-deck/`.
3. Enable **Agent Deck** in **Settings → Community plugins**.

To build from source:

```bash
git clone https://github.com/MatsuriMW/obsidian-agent-deck.git
cd obsidian-agent-deck
npm install
npm run build
```

`npm run build` writes `main.js` with esbuild. The only runtime dependency is `fzstd`, used to read DeepSeek Harness's zstd-compressed session logs.

## Settings

- **Agents**: enable each agent, pick up to two primaries, scan now, import Nautilus Spiral history.
- **委派**: default target, models, effort, permission mode, working directory, prompt prefix/suffix, write-back rules, trust fallback.
- **Models**: the layered picker shown above.
- **追踪**: day cutoff, polling interval, idle threshold, history depth, macOS menu bar toggle and row limits, UI switches, rebuild, import, and a one-click **pause Nautilus Spiral's AI tracking** action.
- **关于**: version, license and debug info.

## Compatibility with Nautilus Spiral

Agent Deck understands the same `🔗` line as Nautilus Spiral. If both plugins are on, Nautilus will also see the Claude sessions and may rewrite `DELEGATED` to `TOREVIEW`.

Agent Deck hides Nautilus's 🤖 agent status item automatically (the planner's own status bar and timer stay). Use **追踪 → 停用螺旋日程里的 AI 追踪** to also turn off its AI panel, automatic journal logging, status writing and `💬` writing while keeping the planner. The Nautilus settings are backed up first. The 🤖 toggle can be reversed from the same page.

If you use **done-to-top** and **journal-tidy**, update to **done-to-top 1.17.3+** and **journal-tidy 1.9.1+**. Those versions keep a `DELEGATED` block that mentions 明天 / 后天 / 大后天 in today's DOING area instead of moving it to the next day, and do not fold DOING/TODO blocks before the first separator.

## Privacy

- Session logs are read locally with Node's `fs`.
- No network requests are made by the tracking code.
- Delegation starts local CLI processes (`claude`, `dsh`) owned by the user.
- `usage.json` stores only aggregate per-day numbers and session summaries, not full conversations.
- The menu bar helper reads `~/.agent-deck/menubar.json` and makes no network requests.

## Credits

- Extracted from [Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral), which remains the planner.
- The progress-in-trigger-button interaction is inspired by [@ZZ.X's note “AI 任务进度，长在触发按钮里”](https://xhslink.cn/o/3gmyiCARRj2).
- The layered model settings page is inspired by [@ZZ.X's note “AI 产品模型设置”](https://xhslink.cn/o/AwW7VhnzX6m).

## License

MIT. See [LICENSE](LICENSE).
