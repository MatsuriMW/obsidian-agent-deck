[中文](Quick-Start) ｜ **English**

# Quick Start

Get your local AI agent sessions into Obsidian and complete your first "delegate from notes → write back to journal" loop in 3 minutes.

## 1. Install the Plugin

- **Community Plugins**: Open Obsidian Settings → Community plugins → Browse, search for **Agent Deck**, install and enable.
- **Manual Install**: Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/MatsuriMW/obsidian-agent-deck/releases), copy them into `<your vault>/.obsidian/plugins/agent-deck/`, and enable the plugin in Settings.
- Requirement: Obsidian **1.4.0+** on desktop (mobile is not supported).

## 2. Zero-Dependency Tracking

On first launch, Agent Deck automatically detects installed clients on your machine and disables uninstalled ones to keep the UI clean:

1. Open the **Agent Deck** right-sidebar panel.
2. Under **Now**, group active sessions by **Project**, **Status** (waiting / unclaimed / running / error), or a flat **List**.
3. Click any session card to inspect its read-only conversation, jump back to the desktop client or terminal, or drag it onto a journal task line to bind it.
4. Open the **Collaboration Review Dashboard** to inspect your daily token heatmap, 24-hour rhythm & concurrency, agent/model breakdown, and project effort — 100% local, zero network calls, zero extra LLM calls.

> **Tip**: Mark your 1–2 most-used clients as **Primary Agents** in Settings (primary agents scan full history; all others scan today only for speed).

## 3. Enable Automatic Journaling

1. In Settings → Journal, verify your daily note path template (matches Obsidian Daily Notes or Nautilus Spiral).
2. Enable **Auto-journal** and choose a detail level (brief / standard / detailed).
3. New sessions throughout the day automatically match or create task lines in your daily note, syncing status (`DOING` / `TOREVIEW` / `DONE`), active time ranges, and per-round summaries. Long responses are saved to linked notes.
4. Hand-edited titles and manual prose are never overwritten.

## 4. Delegate Straight from Notes

From any task line or paragraph in your journal or notes, delegate in three ways:

1. **Paper-plane handle**: Click the paper-plane icon at the end of the current paragraph to preview context, choose project folder/permissions, and send.
2. **Drag and drop**: Drag a list item onto an agent card in the sidebar.
3. **Inline `@` / `/` completion**: Type `@` to pick an agent and `/` to pick a model and reasoning effort.

Progress, follow-up questions (`❓` / `✍️ Answer: …`), and final conclusions write back directly beneath the same task line.

## 5. Next Steps

- **In-place fractal board**: Any block with multiple direct child tasks shows a **Board N** button — click to toggle between outline and Kanban in place.
- **macOS menu bar helper**: Enable in Settings to access today's metrics and waiting sessions via `⌃⌥⌘D` with an optional **Pin** floating window (requires Xcode Command Line Tools).
- **Dreaming long-term memory**: Optional and off by default — see [[Long-Term Memory (Dreaming)\|Long-Term-Memory-Dreaming.en]].
