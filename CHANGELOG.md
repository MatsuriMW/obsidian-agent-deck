# Changelog

## 1.0.7

- The global shortcut now **opens or focuses** the panel; pressing it again no longer closes an open panel. Use Escape or click outside to close.
- Reduced wake latency: the panel is ordered on screen before macOS activation, and the data is pre-rendered at launch so the first shortcut feels immediate.
- The Carbon handler calls the panel directly instead of hopping through the main queue.
- The shortcut remains customizable; default ⌃⌥⌘D.

## 1.0.6

- The menu bar shortcut is now customizable in **设置 → 追踪 → 菜单栏快捷键**. Click the field and press a new combination; at least one of ⌃ / ⌥ / ⌘ is required. Default is ⌃⌥⌘D.
- The chosen shortcut is sent to the helper in `menubar.json` and re-registered live; the old combination is released.
- The shortcut still opens/closes the panel from any app when macOS has hidden the status item.

## 1.0.5

- Removed the left-side fallback overlay. The status item stays on the right side of the menu bar.
- Added a global shortcut, **Control + Option + Command + D**, that opens or closes the panel even when macOS has hidden the status item. It works from any app and does not need Accessibility access.
- The **Agent Deck: 打开 macOS 菜单栏面板** command remains as a second fallback.

## 1.0.4

- Added a fallback menu-bar icon for crowded menu bars. When macOS parks the real status item off-screen, a small wand icon appears in the free area left of the status items; it opens and closes the same panel and disappears once the real status item is visible. It carries a small state dot for running / waiting.
- Removed the status item autosave name so a saved off-screen position cannot pin the real item away from the bar.
- The **Agent Deck: 打开 macOS 菜单栏面板** command remains as a keyboard-only fallback.

## 1.0.3

- Rebuilt the macOS menu bar as a solid, opaque panel. It no longer uses `NSPopover` or any frosted/translucent material, so text keeps its contrast on macOS 26.
- The menu bar now speaks TODOseq's task-keyword language: `DOING`, `WAITING`, `NEEDOK?`, `HITLIMIT!`, `PAUSED`, `ERRORED`, `DONE`, `LATER` and `TODO`, with the same SVG icons and task-state colours as the TODOseq panel. The DOING loader-circle spins while the panel is open. The header counts DOING / WAITING, and NEEDOK sessions get an orange reminder.
- Card list rebuilt with white surfaces, 1px borders, soft shadows, a state-coloured rail and an agent glyph badge. Each card shows the project and current step.
- At most five sessions are visible at once; the rest are a scroll away. The footer shows the total session count.
- The light panel uses a near-white background with a slight tint of the current Obsidian theme; dark mode has its own solid palette. The dashboard keeps the calmer 1.0.2 palette.
- Fixed the helper window growing to the full screen height when the session list was empty.
- Added **Agent Deck: 打开 macOS 菜单栏面板** so the panel can still be opened when the menu bar is full or a menu-bar manager has hidden the status item. The helper also falls back to the top-right corner instead of the bottom-left when the status item's window is off-screen.

## 1.0.2

- The macOS menu bar now lists WorkBuddy's waiting sessions as well as its running sessions. Other non-primary agents still contribute only running sessions.
- Lower-saturation, warmer palette across the dashboard, settings and menu-bar popover: muted terracotta / slate / sage / periwinkle agent colours, parchment accents, softer gold stars and calmer status colours.
- The menu-bar popover uses the same muted palette, including a toned-down primary button.


## 1.0.1

- Delegation is command-driven: removed the per-item "Delegate" trigger. Only lines already bound to a session or delegation show a status/progress pill.
- Replaced the UI glyphs with Lucide icons (agent, status, tabs, stars, arrows, buttons); running states use a CSS spinner. The macOS menu-bar icon is the Lucide `wand-sparkles` SVG.
- Compatibility fix in **done-to-top 1.17.3** and **journal-tidy 1.9.1**: `DELEGATED` (and other agent-tracked) blocks that mention 明天 / 后天 / 大后天 are no longer moved into the next day, and DOING/TODO blocks before the first separator are no longer folded. Update those two plugins as well if you use them.
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
