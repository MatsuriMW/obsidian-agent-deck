[中文](FAQ-and-Troubleshooting) ｜ **English**

# FAQ & Troubleshooting

## 1. macOS says a CLI binary is not found (`claude`, `codex`, `mcode`, `t3`, `gemini`)

When Obsidian is launched from the macOS GUI (Dock / Spotlight), it often does not inherit the `PATH` configured in `.zshrc`.

- **Fix**: Run `which <binary>` in your terminal (e.g. `/opt/homebrew/bin/claude`), paste the full path into Settings → Agents, and click **Check**.
- Note: **Check** only verifies path and version; confirm login status directly inside the client or terminal.

## 2. Cursor sessions are not appearing

- Requires **Cursor 3.30.14+**.
- Enable and install **Cursor Hooks** in Agent Deck Settings (writes to `~/.cursor/hooks.json`).
- Only tracks new sessions created after Hooks are enabled; Cursor is tracking-only.

## 3. What is the current Windows support status?

Day-to-day testing is primarily on macOS. On Windows:
- **Adapted**: Core session tracking (Cursor tracking also needs `sqlite3` on `PATH`), Dashboard, auto-journaling, memory library, fractal boards, and background CLI/ACP delegation.
- **macOS-only (degrades safely without errors on Windows)**: Opening/resuming sessions in a terminal, focusing desktop app windows, Claude Desktop session tracking, and the menu bar helper.

Windows real-world feedback via [GitHub Issues](https://github.com/MatsuriMW/obsidian-agent-deck/issues) is very welcome.

## 4. How do I configure API keys and Custom ACP env vars safely?

Never store plaintext API keys inside a synced Obsidian vault. Use:

- `env:OPENAI_API_KEY` — read from your system environment
- `secret:my_key_name` — read from local secure secret storage

## 5. Why do some sessions show `0` tokens or "Unavailable"?

Agent Deck enforces **honest accounting**: when a client's local logs or cloud sandbox do not expose per-message token counts (e.g., Grok Bot, Muse, Doubao Work, some Qoder desktop records, older QwenWork JSONL), the plugin displays `0` or "Unavailable" rather than guessing from character counts.

## 6. How to file a useful bug report

1. Open the Obsidian command palette and run **Export redacted diagnostics** (automatically redacts paths, keys, and sensitive text).
2. Submit an issue using the [Bug Report form](https://github.com/MatsuriMW/obsidian-agent-deck/issues/new?template=bug_report.yml) with your OS, Obsidian version, affected agent client, and diagnostic summary.
