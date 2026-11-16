# Agent Deck

> Delegate AI work from your journal. Review daily token usage and project activity in a dashboard.

[中文](README.md) ｜ **English** ｜ [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases) ｜ [Changelog](CHANGELOG.md)

This project is still early and evolving quickly. Some parts of the experience may be rough, and occasional updates may introduce breaking changes. Check the [Roadmap](https://matsuri.site/portfolio/journal-workflow/#whistlist) to submit suggestions and vote on upcoming features, or open a [GitHub Issue](https://github.com/MatsuriMW/obsidian-agent-deck/issues) / email [klauschen2799@gmail.com](mailto:klauschen2799@gmail.com) to report bugs.

<p align="center">
  <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4"><img src="assets/demo.gif" width="800" alt="Agent Deck demo: a session card dropped on a journal task binds it, a task dropped on an agent delegates it, status and the answer are written back"></a>
</p>

<p align="center">25-second demo (Chinese captions) · click for the <a href="https://github.com/MatsuriMW/obsidian-agent-deck/releases/download/1.2.1/agent-deck-demo-4k60.mp4">4K60 version with sound</a></p>

Agent Deck brings AI agent sessions scattered across separate local clients onto one deck inside Obsidian: see at a glance which agent is running, which one is waiting for you, and how far each has progressed. Delegate work directly from any task line in your notes, and let progress, active time, and answers flow back into the same journal.

---

## Core Architecture & Information Flow

<p align="center">
  <img src="assets/architecture.en.svg" width="900" alt="Agent Deck Core Architecture and Information Flow: Task delegation, 8 local AI agents, read-only tracking, multi-view journal sync, Review Dashboard, and Dreaming">
</p>

---

## Core Features

### 1. Unified Multi-Agent Session Panel
- **Tracks 9 local agents**: **Claude Code, Codex, WorkBuddy, DeepSeek Harness, Antigravity, OpenCode, Qoder**, plus **Cursor** (3.30.14+ Hooks, tracking only) and **Grok Bot** (Sand desktop client with per-bot selection, tracking only).
- **Project-first concurrency management**: The **Now** section groups active, waiting, and errored/limit-hit sessions by workspace project by default (with a one-click toggle back to flat **List**), showing participating agents, status badges, open-folder shortcut, Project Workbench launcher, and project-wide stop controls. **Recent Sessions** switches between `7 / 30 / 120` days and stacks either **By agent** or **By project**.
- **Live status & quick jump**: Distinguishes running, waiting for reply, needs approval, hit limit, paused, errored, and finished sessions; click a session card to switch back to its client or terminal tab (or jump directly to the note line for pending handoff jobs).
- **Primary agents & global search**: Pin up to 2 primary agents for full history and cross-day catch-up (other enabled agents read sessions active today); search across all scanned local sessions by title, project, model, or content, and view a 14-day activity trend.

### 2. Task-Line Delegation & Drag-and-Drop Binding
- **Three ways to delegate**:
  - Click the paper-plane grip at the end of a task line (or double-click / `⌘`-click to pick the agent);
  - Drag a list item from your note onto an agent card in the sidebar;
  - Type `@` in a task line to pick an agent, then `/` for model and reasoning effort (e.g. `@codex/gpt-6.1-sol/high`).
- **Pre-send preview & wikilink context**: Preview the block and choose a work destination before sending; delegating a sub-item automatically carries its ancestor chain (excluding unrelated sibling branches), its child subtree, and excerpts from explicit `[[wikilinks]]`, and you can edit an AI reply block to delegate again from it.
- **Drag to bind**: Drop a session card onto an existing list item to bind it, or onto an empty line to create a new bound task. Regular bound sessions show a status pill. Background tasks show one progress row below the parent task with cancel/retry actions; it disappears when the answer is ready.

### 3. Project Workbench & In-Place Fractal Boards
- **Team presets, Copilot planning & concurrent dispatch**: Open the **Project Workbench** from the sidebar, command palette, or task menu to pick from three built-in team presets (automatically routing around disabled or hit-limit agents and remembering per-project preferences), decompose goals into editable subtask drafts via the configured organizer model or quick local split, write standard `- TODO ... @agent` Markdown (placed inside the active journal band with pre-assigned block IDs), and dispatch multiple agents concurrently after review.
- **In-place Fractal Boards (Editing view)**: Any parent list item with 2 or more direct child tasks (status keywords, standard `[ ]` checkboxes, or `![[note#^blockId]]` mirrors) gets a `Board N` toggle right on its line:
  - **Dual column modes & recursive Zoom**: Switch between **By status** (`TODO / DOING / Wait / DONE`) and **By group** (direct child phases as columns, grandchild tasks as cards); click `↳` on any card with nested subtasks to zoom in with clickable breadcrumbs;
  - **Full in-board workflow**: Track completion progress, quick-add cards inline (`+ Card`), assign `@agent` per card, drag subtrees across columns or reorder cards (atomically rewriting standard Markdown without proprietary syntax), inspect transcripts, stop active runs, or batch-dispatch `TODO` cards with sibling board context injected via Harness;
  - **Single-source mirror cards**: Reference tasks across notes via `- ![[note#^blockId]]` or `- [[note#^blockId]]` as dashed **Mirror** cards—status changes write back to the primary source note, while Dashboard analytics and Dreaming explicitly ignore mirror lines to prevent double counting.

Demo order: team draft → Markdown outline → grouped board. See the [release notes](CHANGELOG.md#演示素材与验证范围) for observed behavior and pending acceptance checks.

<p align="center">
  <img src="assets/project-workbench.png" width="680" alt="Actual Obsidian Project Workbench with team roles, editable subtask drafts, and confirmation controls; no tasks dispatched">
</p>
<p align="center">
  <img src="assets/fractal-board-views.png" width="840" alt="In-place Fractal Board comparison: left shows standard Markdown outline with Board 4 toggle, status icons, @agent routing, and replies; right shows By-group Fractal Board with progress bar, quick-add, phase columns, dispatch/stop controls, and dashed mirror card">
</p>

> **Interactive 1.10.0 Welcome Showcase**: On your first launch after installing or upgrading to **1.10.0**, Agent Deck automatically creates and opens `Agent Deck/Welcome-1.10.0.md` (`功能示例-1.10.0.md` in Chinese UI) — a safe simulated sandbox (no real sessions or analytics affected) demonstrating the Fractal Board (with Zoom & mirror jump) and all four AI record views side by side. Reopen anytime via Command Palette → `Open 1.10.0 feature showcase note`.

### 4. Human–AI Journal, Organization & Archiving
- **Auto-journaling & write-back**: Periodically matches or creates daily-note task lines for today's sessions and syncs status, `⏱` active spans, per-turn records (brief / standard / detailed), and nested child session / side-chat / subagent blocks. Newly generated top-level AI record titles default to bold Markdown (`**title**`) with project/bot prefixes, and can be customized under **Settings → Records → Journal & Archive → More settings → Record formatting rules** (title bolding, project/bot prefix, time range, max title length, and Grok Bot idle auto-DONE threshold). Background answers of up to 500 characters are written inline in full; longer answers return a link to a Markdown file under `Agent Deck/Answers/` containing the full question and answer with internal tracking metadata removed (no extra summary model called). Regular session conclusions default to 350 characters, with long addresses shortened to clickable labels.
- **Title protection & record folding**: Preserves manually edited AI task titles verbatim; shows only the latest AI conclusion by default while keeping history expandable; supports manual status locking; keeps internal tracking IDs hidden and removes them automatically on completion or archival.
- **Four persistent record views & view-aware export**: Switch any top-level AI record block in place between **Outline / Table / Cards / Timeline** (persisted per block without rewriting underlying Markdown), and export from the view menu's Export submenu as expanded view-aware PDF or standalone HTML, lossless Markdown (`.md`), structured JSON (`.json`), CSV (`.csv`), or clipboard snippets:

<p align="center">
  <img src="assets/ai-record-views-1.png" width="840" alt="AI auto-record views: Outline vs Table">
</p>
<p align="center">
  <img src="assets/ai-record-views-2.png" width="840" alt="AI auto-record views: Cards vs Timeline">
</p>

- **One-click tidy & archive**: **Tidy log** reorganizes the current daily note by template (in progress, to do, completed, framed by dividers). Only complete bounded sections are organized; outside notes stay unchanged. Notes without a complete frame receive empty sections; **Archive finished logs to…** moves completed AI blocks out of the journal into a target note grouped by date.
- **Nautilus Spiral compatibility**: Works alongside [Nautilus Spiral](https://github.com/MatsuriMW/nautilus-spiral) by letting Agent Deck handle AI note writes while Nautilus keeps scheduling and tracking displays (Agent Deck restores token display whenever Nautilus does not show tokens for the same session).

### 5. Review Dashboard (Experimental, On by Default)
- Displays a GitHub-style **daily token heatmap** and **24-hour rhythm & concurrency** chart (input, output, and cache reads; does not represent monetary cost, with no estimates when missing) with 7/30/90-day, 1-year, and custom date filters.
- Summarizes **By Agent** (with official Agent icons) and **By Model** (tokens, per-turn average, cache hit ratio) for linked filtering, and aggregates **Project activity** (sortable by tokens, active time, sessions, or name in ascending/descending order) from note links, titles, folders, keywords, and aliases; supports manual project overrides, per-day drill-down, and jumping back to the source journal block or session.
- Uses only locally tracked history; makes no extra model calls and never modifies your journal.

<p align="center">
  <img src="assets/dashboard.png" width="840" alt="Agent Deck Review Dashboard (side-by-side panels): left shows Token Heatmap, 24-hour Rhythm and Concurrency, and Agent breakdown; right shows Model breakdown and Project activity">
</p>

### 6. macOS Menu Bar Helper, Dreaming & Bilingual UI
- **Solid macOS menu bar panel**: An always-accessible icon (or customizable global shortcut **`⌃⌥⌘D`**) for checking today's metrics and active/waiting sessions from any app and jumping straight to them.
- **Dreaming long-term memory (optional, off by default)**: Distills long-term memories from the past 14 days of journals and delegated notes into editable Markdown with optional export/sync.
- **Automatic UI language**: Follows Obsidian's language setting (Chinese or English) without changing note contents or CLI prompts.

---

## Supported Agents at a Glance

| Agent | Session Tracking | Background Delegation | Desktop Handoff | Terminal Interactive | Direct Session Jump |
|---|---|---|---|---|---|
| **Claude Code** | Yes | Yes (`claude`) | Yes (auto-opens after turn 1) | Yes | Yes (desktop / terminal tab) |
| **Codex** | Yes | Yes | Yes (via App Server after turn 1) | Yes | Yes (desktop / terminal tab) |
| **DeepSeek Harness** | Yes | Yes (`dsh acp`) | Opens app only | — | Focuses app & copies session ID |
| **Antigravity** | Yes | Yes (`agy acp`) | No | — | Focuses app & copies session ID |
| **OpenCode** | Yes | Yes (`opencode-cli acp`) | Auto-opens app after turn 1 (shared DB) | Yes | Manual selection in app |
| **Qoder** | Yes | Yes (`qodercli`) | Clipboard handoff to desktop | Yes (`qodercli`) | CLI resumes in terminal; desktop copies ID for manual pick |
| **WorkBuddy** | Yes | No | Clipboard handoff to desktop | Yes (`codebuddy`) | Native WorkBuddy sessions & terminal resume (`codebuddy -r`) |
| **Cursor** | Yes (3.30.14+ Hooks + logs) | No | No (tracking only) | — | Opens app & copies session ID |
| **Grok Bot** | Yes (per-bot multi-select) | No | No (tracking only) | — | Focuses Grok Bot desktop app |

---

## Installation & Requirements

### 1. Installing the Plugin
Install directly from Obsidian Community Plugins, or download manually from GitHub Releases (current version **1.10.0**, requires Obsidian **1.4.0+** desktop):

1. Open **Settings → Community plugins → Browse** in Obsidian, search for **Agent Deck**, then install and enable it.
2. Or download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/MatsuriMW/obsidian-agent-deck/releases), place them in `<your-vault>/.obsidian/plugins/agent-deck/`, and enable **Agent Deck** in **Settings → Community plugins**.

<details>
<summary>Building from source (developers only)</summary>

Requires Node.js and npm:

```bash
git clone https://github.com/MatsuriMW/obsidian-agent-deck.git
cd obsidian-agent-deck
npm install
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/agent-deck/` (or run `npm run install:plugin -- <vault-path>`).

</details>

### 2. Runtime Dependencies (Prepare Only What You Use)

- **Tracking, binding & Review Dashboard only**: **No extra dependencies required.** The plugin reads local client logs directly (Cursor requires enabling Hooks in settings) and makes no network requests.
- **Delegation, auto-journaling, AI summaries/polishing & Dreaming**: Require the corresponding local agent CLI or desktop app to be installed and authenticated, or an OpenAI-compatible API for summarization/Dreaming:

| Feature / Agent | Required on Your Machine |
|---|---|
| **Claude Code** | Installed and authenticated `claude` CLI (`/login` or `~/.claude/settings.json` `env` auth; plus Claude desktop app for desktop continuation) |
| **Codex** | Installed and authenticated `codex` CLI and Codex desktop app (bundled CLI is supported) |
| **DeepSeek Harness** | ACP-capable `dsh` installation with valid model/provider credentials |
| **Antigravity** | Standalone **Antigravity CLI (`agy`)** with CLI login (installing the IDE alone is not enough) |
| **OpenCode** | OpenCode desktop app (bundles `opencode-cli`) or standalone `opencode` CLI with configured provider |
| **Qoder** | `qodercli` installed and logged in for background/terminal delegation; Qoder desktop app for desktop handoff |
| **WorkBuddy** | Chinese-edition WorkBuddy desktop app (`codebuddy` CLI separately if using terminal mode) |
| **Cursor** | Cursor Desktop **3.30.14+** with Cursor Hooks installed via **Settings → Sources & Scan → More settings** (tracking only) |
| **Grok Bot** | Grok Bot desktop app (Sand client) with bots selected in the Grok Bot card under **Settings → Records → Sources & Scan** (none selected by default; tracking only) |
| **Auto-journaling / AI summaries / Dreaming** | Any authenticated local CLI (`agy`, `claude`, `codex`, `qodercli`, `codebuddy`, including `~/.claude/settings.json` `env` auth) OR an **OpenAI-compatible API** (presets for DeepSeek, OpenAI, OpenRouter, Alibaba Cloud Qwen, local Ollama, or custom endpoints under **Records → Journal model**; Dreaming inherits by default and can override separately) |
| **macOS menu bar helper** | `swiftc` from Xcode Command Line Tools (`xcode-select --install`); can be disabled in settings if unused |

> **Notes**:
> - When Obsidian launches from the macOS GUI, its `PATH` may differ from your terminal. If a binary isn't found, set its full absolute path in plugin settings.
> - The **Check** button in Delegation settings only verifies executable paths and versions—it does **not** prove login status or model quota. Use **Test connection** in Records / Dreaming settings (or test in your terminal) to verify live responses.

---

## Current Limitations & Unsupported Features

1. **Platform Support**
   - **Desktop only**: Obsidian mobile is not supported.
   - **Windows unverified**: Developed and tested on macOS; Windows has not been verified yet. The menu bar helper is macOS-only, and terminal tab switching / several binary discovery paths currently rely on macOS tooling.
2. **No Generic Remote API Backend for Task Delegation**
   - Automatic task delegation launches local CLI or desktop processes; there is no generic remote API/SDK runner for delegating coding tasks (while auto-journaling, AI summaries, and Dreaming do support OpenAI-compatible APIs). The plugin does not install CLIs or sign users in automatically.
3. **No In-Plugin Follow-Up Chat**
   - The transcript modal inside Obsidian is read-only (for inspecting, stopping the current turn, and archiving conversations); follow-up turns must be continued in each agent's own desktop app or terminal.
4. **Per-Agent Boundaries**
   - **Cursor**: Supports **3.30.14+ desktop** Hooks-based read-only tracking only; no task delegation or terminal interaction, and legacy unhooked DB sessions are excluded.
   - **WorkBuddy**: Only the **Chinese edition** is supported; international **WorkBuddy AI** is not supported. Managed background execution is unavailable, and independent `codebuddy` CLI sessions cannot be imported into the WorkBuddy desktop app.
   - **Qoder**: `qodercli` sessions and the Qoder desktop database are separate—background tasks resume in terminal (`qodercli -r <id>`), and desktop mode uses clipboard handoff. Token counts are not estimated when omitted by the desktop format.
   - **Antigravity**: CLI sessions and original IDE sessions do not mix, archive detection is not guaranteed, and exported transcripts exclude tool outputs, internal reasoning, and attachments.
   - **DeepSeek Harness**: The desktop client is still evolving rapidly with limited stability, and deep links do not jump directly to a specific session.
   - **OpenCode**: CLI and desktop share local storage, but launching the desktop app still requires selecting the session manually.
   - **Grok Bot**: Supports Sand desktop read-only persistence tracking and per-bot multi-select filtering only; no task delegation or terminal interaction. Token/model metrics omitted by the cloud sandbox are shown as "Usage unavailable" without estimation; there is no client archive state, so idle conversations auto-mark `DONE` after the configured inactivity window (`120` min default).
5. **Terminal Delegation Verification**
   - Interactive terminal delegation is currently verified end-to-end only on **Tern** and **Herdr**. **Terminal.app, iTerm2, and Warp** are untested (Warp lacks a scripting interface and can only be brought forward).
6. **Planned / Not Yet Implemented**
   - **Reading-view rendering for AI record multi-views and fractal boards**, **explicit Second-Brain Project Context Pack**, **Pi support**, **choosing model / effort / recording granularity directly inside the delegation sheet**, **per-block granularity overrides on existing AI blocks**, **automatic send for WorkBuddy**, and **LLM Wiki auto-ingestion** are planned on the roadmap and not available in this release.

---

## Privacy & License

- **Local-first**: Session parsing, panel analytics, the Review Dashboard, and the macOS menu bar helper only read local files and send zero telemetry. Task text or journal excerpts are sent to your locally configured CLI model provider only when you run delegation, AI organization/summarization, or Dreaming.
- **License**: [Apache 2.0](LICENSE) (see also [NOTICE](NOTICE)).
- **More docs**: Full version history in [CHANGELOG.md](CHANGELOG.md); developer specs, architecture, and roadmap notes in [docs/](docs/).
- **Feedback & Roadmap**: Open a [GitHub Issue](https://github.com/MatsuriMW/obsidian-agent-deck/issues) to report bugs or visit the [Roadmap](https://matsuri.site/portfolio/journal-workflow/#whistlist) to submit and vote on feature ideas.
- **Updates**: Follow [@Matsurimywaifu](https://x.com/Matsurimywaifu) on X/Twitter.
