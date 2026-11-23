[中文](Supported-Agents-and-Models) ｜ **English**

# Supported Agents & Models

Agent Deck is a local-first, vendor-neutral control deck: **read-only local session tracking + protocol-based background delegation**.

## 1. Mainstream Model Coverage

Whether through local clients, custom ACP CLIs, or OpenAI-compatible APIs (used for summaries, tidying, and Dreaming), Agent Deck covers:

- **Global models**: Claude (Anthropic), GPT / Codex (OpenAI), Gemini (Google), Grok (xAI), etc.
- **Chinese models**: DeepSeek, Qwen (Alibaba Cloud), MiniMax, Kimi, Doubao, etc.
- **Local & aggregators**: Ollama, OpenRouter, and any OpenAI-compatible endpoint.

All token usage, cache hit rates, and model distributions are aggregated honestly in the Dashboard: **missing token data is shown as 0 or "Unavailable" — never estimated**.

## 2. First-Class Chinese Agent Ecosystem Tracking

Alongside global tools, Agent Deck ships dedicated local parsers and adapters for popular Chinese agent clients:

| Client | Local Data Source | Capabilities | Notes & Boundaries |
| --- | --- | --- | --- |
| **DeepSeek Harness** | `~/.dsh/sessions` (zstd) | Tracking + Background delegation (`dsh acp`) + Focus app | Delegated sessions may land in "Ungrouped" until the client refreshes |
| **MiniMax Code** | `$MINIMAX_DATA_DIR/v2/sqlite/runtime-state.sqlite` | Tracking + Background (`mcode acp`) + Desktop handoff + Terminal (`mcode`) | Desktop and `mcode` share the SQLite store; desktop-only installs track cleanly |
| **QwenWork (千问办公)** | 2.x `~/.qwenworkcn/.harness/*/qwenwork/qwenwork.db`; legacy JSONL | Desktop session tracking | Tracking only; 2.x has per-turn tokens & models; older logs without tokens show 0 |
| **Qoder** | `~/.qoder/projects` / desktop `main.sqlite` | Tracking + Background (`qodercli`) + Desktop copy handoff + Terminal | CLI and desktop DB are separate; missing desktop tokens show "Unavailable" |
| **WorkBuddy (China)** | `~/.workbuddy/projects` / `workbuddy.db` | Tracking + Desktop copy handoff + Terminal (`codebuddy`) | China edition only; standalone `codebuddy` does not share desktop sessions |
| **Kimi Code** | `~/.kimi-code/sessions` (`wire.jsonl` + `session-meta/state.json`) & `~/.kimi/sessions` | Tracking + Focus app | Tracking only; parses v1.5 `wire.jsonl` turns, tool calls & exact token usage |
| **Doubao Work (豆包工作)** | `~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb` | Desktop session metadata tracking + Focus app | Tracks titles & active timestamps only; message bodies are encrypted in `sdk_storage` (never decrypted); tokens show "Unavailable" |
| **TeleAgent (星辰超级智能体)** | `~/.local/share/TeleAgent/users/*/teleagent.db` (plus `%LOCALAPPDATA%\TeleAgent` on Windows) | Tracking + copies the task and focuses the desktop app + reads the client database back to confirm a dispatch | Desktop client only, no CLI; the session store uses the legacy OpenCode `session`/`message`/`part` schema. Windows fills the task through UI Automation, Linux pastes through `xdotool` + clipboard |

> Want another client supported? Open a [New Agent Support Request](https://github.com/MatsuriMW/obsidian-agent-deck/issues/new?template=agent_support.yml).

## 3. Full 19 Built-in Agents + Custom ACP Matrix

| Agent | Session tracking | Background delegation | Desktop handoff | Terminal |
| --- | --- | --- | --- | --- |
| **Claude Code** | Yes | Yes | Yes (opens after first round) | Yes |
| **Codex** | Yes | Yes | Yes (opens after first round) | Yes |
| **DeepSeek Harness** | Yes | Yes | Focuses the client only | — |
| **Antigravity** | Yes (IDE + CLI) | Yes (`agy acp`) | No | — |
| **OpenCode** | Yes | Yes | Opens after first round | Yes |
| **Qoder** | Yes | Yes | Copies task and opens app | Yes |
| **Hermes Agent** | Yes | Yes | No (no desktop UI) | Yes |
| **MiniMax Code** | Yes | Yes (`mcode acp`) | Opens after first round | Yes (`mcode`) |
| **QwenWork (千问办公)** | Yes | No | No (tracking only) | — |
| **WorkBuddy** | Yes | No | Copies task and opens app | Yes |
| **Cursor** | Yes (Hooks `v2` required) | Yes (`agent acp`) | Copies & focuses app when CLI absent | — |
| **Grok Bot** | Yes (per-Bot selection) | No | No (tracking only) | — |
| **T3 Code** | Yes (deduplicates delegated sessions) | Yes (`t3 thread`) | Focuses the client only | — |
| **Cindy** | Yes (deduplicates delegated sessions) | No | Deep link / focuses app (tracking only) | — |
| **Muse** | Yes (per-stream selection) | No | No (tracking only) | — |
| **Kimi Code** | Yes | No | Focuses the client only (tracking only) | — |
| **Doubao Work (豆包工作)** | Yes (session metadata) | No | Focuses the client only (tracking only) | — |
| **Gemini CLI** | Yes | Yes (`gemini --acp`) | No (no desktop UI) | Yes (`gemini --resume`) |
| **TeleAgent (星辰超级智能体)** | Yes | No | Copies task and opens app | — |
| **Custom ACP Agents** | Delegated sessions | Yes (any ACP CLI) | — | — |

## 4. Requirements

Tracking, task binding, and the Dashboard require **no extra dependencies** and make zero network calls. Install only the clients you plan to delegate to:

| Feature / Agent | What to install first |
| --- | --- |
| **Claude Code** | Claude Code CLI or desktop app, signed in |
| **Codex** | Codex CLI and desktop app, signed in |
| **DeepSeek Harness** | DeepSeek Harness client with a model and account configured |
| **Antigravity** | Standalone `agy` CLI (tracks both `~/.gemini/antigravity/brain` and `~/.gemini/antigravity-cli/brain`; background delegation uses `agy acp`) |
| **OpenCode** | OpenCode desktop app or CLI |
| **Qoder** | Qoder CLI; desktop app for handoff only |
| **Hermes Agent** | Hermes CLI; nothing extra if you only track |
| **MiniMax Code** | MiniMax Code desktop app; `mcode` CLI for background delegation or terminal resume |
| **QwenWork (千问办公)** | QwenWork desktop app (tracking only) |
| **WorkBuddy** | China edition of WorkBuddy; `codebuddy` for terminal use |
| **Cursor** | Cursor 3.30.14+ with Cursor Hooks enabled; Cursor CLI (`agent` / `cursor-agent`) for background ACP delegation |
| **Grok Bot** | Grok Bot desktop app, with desired Bots selected in settings |
| **T3 Code** | T3 Code desktop app; `t3` CLI for background delegation |
| **Cindy** | Cindy desktop app (tracking only; automatically deduplicates delegated underlying agent sessions) |
| **Muse** | Muse desktop app (tracking only) |
| **Kimi Code** | Kimi Code desktop app or `kimi` CLI (tracking only) |
| **Doubao Work (豆包工作)** | Doubao Work desktop app (session metadata tracking only) |
| **Gemini CLI** | `@google/gemini-cli` (`gemini` CLI — supports tracking, `gemini --acp` background delegation & `gemini --resume`) |
| **TeleAgent (星辰超级智能体)** | TeleAgent desktop app (tracking, task copy/handoff and in-app dispatch; no CLI) |
| **Custom ACP Agents** | Any local ACP-compatible CLI configured under Settings → Delegation → Custom ACP Agents |
| **Auto-journal / summaries / Dreaming** | Any signed-in local CLI, or an OpenAI-compatible API (DeepSeek, OpenAI, OpenRouter, Qwen, local Ollama, …) |
| **macOS menu bar** | Xcode Command Line Tools (`xcode-select --install`) |

> When Obsidian is launched from the macOS GUI, CLI binaries may not be on `PATH`; set the full path in Settings. The "Check" button only verifies path and version — confirm sign-in in the client itself.

## 5. Known Limits & Client Boundaries

1. **Desktop only & Windows status**: Obsidian mobile is not supported. Day-to-day testing happens primarily on macOS. On Windows, core tracking (Cursor tracking also requires `sqlite3` on `PATH`), Dashboard, journaling/memory/boards, and background CLI/ACP delegation are adapted, though full end-to-end Obsidian UI testing on a real Windows machine is still limited. Opening/resuming in a terminal, focusing desktop apps, Claude Desktop session tracking, and the menu bar helper are **macOS-only** (they degrade safely without errors on Windows).
2. **Delegation needs local clients**: Tasks run through your local CLI or desktop app; remote API keys cannot replace them, and the plugin never installs or signs in for you.
3. **Read-only conversation viewer**: The in-Obsidian modal is for reading, stopping an active turn, and saving archives. Supported sessions allow follow-ups via the task menu or Reply inbox; others continue in their native client.
4. **Per-client boundaries**:
   - **Cursor**: Tracks new sessions and subagent ownership via Hooks (`v2`); when Cursor CLI (`agent` / `cursor-agent`) is installed, supports `agent acp` background delegation and in-app ACP follow-ups, otherwise falls back to desktop copy-and-focus handoff (no terminal handoff).
   - **WorkBuddy**: China edition only; standalone `codebuddy` CLI does not share desktop sessions.
   - **Qoder**: CLI and desktop databases are separate; missing desktop tokens show "Unavailable".
   - **Antigravity**: Tracks both IDE (`~/.gemini/antigravity/brain`) and standalone `agy` CLI (`~/.gemini/antigravity-cli/brain`) logs and supports `agy acp` background delegation; IDE and CLI sessions are separate with no IDE window handoff, and exports omit tool results & internal reasoning.
   - **DeepSeek Harness**: Fast-moving client; delegated sessions may appear under "Ungrouped" until refreshed.
   - **OpenCode**: Background and desktop share sessions, though you still pick the session once in the app.
   - **Hermes Agent**: No desktop UI; inspect in Obsidian or resume in terminal.
   - **MiniMax Code**: Desktop and `mcode` share SQLite storage; opening desktop still requires selecting the session once.
   - **QwenWork**: Tracking only; 2.x conversations are fully readable, older logs without tokens honestly show 0.
   - **Grok Bot**: Desktop only; cloud sandboxes without per-message tokens show "Unavailable", with no archive concept.
   - **T3 Code / Cindy aggregator deduplication**: Underlying Claude Code, Codex, or Antigravity sessions spawned by T3 Code or Cindy are deduplicated across Daily Summary, Sidebar Now/Recent, Menu Bar, AutoLog, Sync, Dashboard, Handoff claiming, primary recommendation, and Security Audit so work is counted once under the aggregator; disabling the aggregator immediately surfaces the underlying sessions again.
   - **Cindy**: Read-only tracking from local `cindy-*.db` / `xdt-maker-*.db` (including Orca worker hierarchy, per-turn tokens, tool-use security audit, and `cindy://session/<id>` deep link); tracking only (no built-in delegation).
   - **Muse**: Desktop only; cloud VM has no local tokens/models (kept as 0 / unavailable).
   - **Kimi Code**: Tracks desktop & CLI `wire.jsonl` v1.5 sessions; no built-in delegation yet.
   - **Doubao Work**: Read-only IndexedDB session list metadata (titles & timestamps); full message bodies remain encrypted in `sdk_storage` and are never decrypted.
   - **Gemini CLI**: Tracks `~/.gemini/tmp/*/chats/session-*.jsonl` (and legacy `.json`), strips `<session_context>` / `<hook_context>`, and supports `gemini --acp` delegation & `gemini --resume` terminal handoff (no desktop GUI).
5. **Terminal interaction**: The table-driven terminal registry covers 11 terminals (System Terminal, iTerm2, Warp, Ghostty, cmux, tmux, WezTerm, Kitty, Alacritty, Tern, Herdr) plus Windows `wt.exe`/`cmd.exe` fallbacks, though live visual interaction is verified on macOS with **Tern** and **Herdr** only; other terminals and real Windows UI testing remain unverified.
6. **Roadmap**: Visual pre-dispatch context preview, drift-proof references, per-memory Dream sharing, real Windows UI verification & terminal support — see the [Roadmap](https://matsuri.site/portfolio/journal-workflow/#wishlist).

## 6. Adding Custom ACP Agents

For any local ACP-compatible CLI (such as Kiro, Mistral Vibe, etc.):

1. Open Settings → Delegation → **Custom ACP Agents**.
2. Enter the ID, display name, binary path, and startup args.
3. Reference sensitive environment variables with `env:VAR_NAME` or `secret:KEY_NAME` so plaintext secrets never enter your vault.
4. Save to immediately use it via `@` mentions, permission guardrails, and in-app follow-ups.
