[中文](FAQ-and-Troubleshooting) ｜ **English**

# FAQ & Troubleshooting

## 1. macOS says a CLI binary is not found (`claude`, `codex`, `mcode`, `t3`, `gemini`)

When Obsidian is launched from the macOS GUI (Dock / Spotlight), it often does not inherit the `PATH` configured in `.zshrc`.

- **Fix**: Run `which <binary>` in your terminal (e.g. `/opt/homebrew/bin/claude`), paste the full path into Settings → Agents, and click **Check**.
- Note: **Check** only verifies path and version; confirm login status directly inside the client or terminal.

## 2. Cursor or Trae sessions are not appearing

### Cursor
- Requires **Cursor 3.30.14+**.
- Install/update **Cursor Hooks** in Agent Deck Settings → Recording → More settings (writes to `~/.cursor/hooks.json`).
- Only tracks new sessions created after Hooks are enabled; supports `agent acp` background delegation when Cursor CLI (`agent` / `cursor-agent`) is installed, otherwise falls back to desktop copy-and-focus handoff.

### Trae (Trae CN / Global)
Because Trae's local `ModularData/ai-agent/database.db` is SQLCipher-encrypted (Agent Deck never decrypts it), tracking relies on Trae lifecycle hooks writing JSONL to `~/.agent-deck/trae-events/`. Prerequisites:
1. Open Obsidian Settings → Agent Deck → Recording → More settings → **Trae Hooks** and click **Install Hooks** (writes `~/.agent-deck/hooks/trae-hook.mjs` and merges `~/.trae-cn/hooks.json` / `~/.trae/hooks.json` using regex `matcher: ".*"`).
2. Open **Trae → Settings → Hooks**:
   - Turn on **Global Hooks** (disabled by default in Trae).
   - Switch **Hooks Command Execution Mode** to **Run Automatically Locally** (`host`) if sandbox mode blocks writes to `~/.agent-deck/trae-events/`.
3. **Restart Trae or start a new conversation** so Trae loads the hooks; past sessions before setup are not backfilled.
4. **Delegation**: Uses `traecli acp serve` when `traecli` is installed; with desktop-only installs, automatically falls back to copy-and-focus handoff (`Trae CN.app` / `Trae.app`) and claims the session once sent.

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

Agent Deck enforces **honest accounting**: when a client's local logs or cloud sandbox do not expose per-message billed token counts (for example, **Trae Hooks** omit token/model fields, **Orca** only records window occupancy/estimates in `contextUsage`, plus **Grok Bot**, **Muse**, **Doubao Work**, some **Qoder** desktop records, and older **QwenWork** JSONL), the plugin displays `0` or "Unavailable" rather than guessing from character counts.

## 6. How to file a useful bug report

1. Open the Obsidian command palette and run **Export redacted diagnostics** (automatically redacts paths, keys, and sensitive text).
2. Submit an issue using the [Bug Report form](https://github.com/MatsuriMW/obsidian-agent-deck/issues/new?template=bug_report.yml) with your OS, Obsidian version, affected agent client, and diagnostic summary.
