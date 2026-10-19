# Changelog

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
