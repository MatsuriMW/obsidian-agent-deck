# Changelog

## 1.0.2

- The macOS menu bar now lists WorkBuddy's waiting sessions as well as its running sessions. Other non-primary agents still contribute only running sessions.
- Lower-saturation, warmer palette across the dashboard, settings and menu-bar popover: muted terracotta / slate / sage / periwinkle agent colours, parchment accents, softer gold stars and calmer status colours.
- The menu-bar popover uses the same muted palette, including a toned-down primary button.


## 1.0.1

- Delegation is command-driven: removed the per-item "Delegate" trigger. Only lines already bound to a session or delegation show a status/progress pill.
- Replaced the UI glyphs with Lucide icons (agent, status, tabs, stars, arrows, buttons); running states use a CSS spinner. The macOS menu-bar icon is the Lucide `wand-sparkles` SVG.
- Compatibility fix in **done-to-top 1.17.2** and **journal-tidy 1.9.1**: `DELEGATED` (and other agent-tracked) blocks that mention 明天 / 后天 / 大后天 are no longer moved into the next day, and DOING/TODO blocks before the first separator are no longer folded. Update those two plugins as well if you use them.
- Removed the duplicated `DELEGATED` blocks that earlier tidy runs had copied into `2026_10_20.md`.


## 0.2.0

- Moved the agent summary out of Obsidian's bottom-right status bar into a native macOS menu bar item.
- The menu bar item shows a compact icon + short text; clicking it opens a detailed SwiftUI popover with session rows and deeplinks.
- Primary agents show more sessions (default 6 each); other agents show only running sessions (default 3 each).
- The helper is compiled on first use with `swiftc` and exits when Obsidian quits.
- Agent Deck no longer creates an Obsidian status bar item.
- Nautilus Spiral's 🤖 agent status item is hidden while Agent Deck owns the menu bar; its planner status bar is untouched.


## 0.1.0

- Extracted the AI/agent tracking from Nautilus Spiral into a standalone plugin.
- Added Claude Code, Codex, WorkBuddy and DeepSeek Harness session readers.
- Added up to two primary agents with full-history tracking.
- Added Claude Code delegation with model, effort and permission mode.
- Added DeepSeek Harness delegation over ACP with model and reasoning effort.
- Added the inline delegate button with liquid progress, elapsed time and cancel.
- Added the layered Models settings page with draft/save/discard.
- Added Claude Code, WorkBuddy, DeepSeek Harness and terminal deep links.
- Added Nautilus Spiral history import and an optional AI-tracking pause.
