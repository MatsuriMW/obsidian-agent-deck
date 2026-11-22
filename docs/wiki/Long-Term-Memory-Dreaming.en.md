[中文](Long-Term-Memory-Dreaming) ｜ **English**

# Long-Term Memory (Dreaming)

Agent Deck closes the loop between daily execution and durable personal/project knowledge:

```text
Daily work / delegation → Auto-journal → Dreaming distils candidates → Human review → Auto-injected on next dispatch
```

## 1. Two Storage Modes

Under Settings → Dreaming, choose between two mutually exclusive modes (explicit migration supported):

- **One note per memory (Recommended)**: Each memory is a standalone Markdown file under `Agent Deck/记忆/*.md` with frontmatter (`id / title / kind / type / state / date / sources`).
  - Browse and filter via the **Base table** (`Agent Deck/记忆.base`).
  - Drag across states in the **Memory board**.
  - Review one by one (confirm / reject) in the review modal.
- **Single-file mode**: Writes into `Agent Deck/长期记忆.md`, preserving your handwritten preamble and manual sections while updating only the `<!-- ad:memory:start -->` generated block.

## 2. Traceability, Pin Boosting & Health Check

- **Bidirectional backlinks**: Every memory links back to its source journal block (`^mem-*`) so agents can verify the original context; the source journal line also receives a backlink.
- **Pin boosting**: Pinning a round (`<!-- ad-pin -->`) prioritizes it during Dreaming extraction and boosts its weight.
- **Memory health check**: Run `Memory: health check` to list entries missing sources, pending confirmation, or potential duplicates.
- **Memory import**: Import external `.md / .json / .zip` archives via zero-token splitting or LLM distillation.

## 3. Privacy & Security Guardrails

- **Local first**: Dreaming is off by default and only sends the last 14 days of relevant notes to your configured local CLI or OpenAI-compatible model when you explicitly enable and run it.
- **`private` isolation**: Notes marked `private` are never sent during delegation or memory extraction.
- **Offline security replay**: Replay the last 7 or 30 days of historical tool calls from the Dashboard to produce a redacted High / Medium / Low Markdown report (`Agent Deck/安全审计.md`); allowlist rules in its frontmatter sync directly to live ACP permission guardrails.
