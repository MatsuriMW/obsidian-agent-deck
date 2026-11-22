[中文](Workflow-Markdown-Harness) ｜ **English**

# Core Workflow: Markdown as Harness

Agent Deck is built around one core principle: **Markdown, outlines, and journals are the harness**. Instead of locking tasks and conversations inside a proprietary plugin database, your regular Obsidian notes drive multi-agent collaboration and receive all results back in place.

## 1. Notes as Context: What Gets Assembled on Dispatch

When you delegate from any task or subtask (always reading unsaved editor buffers first), Agent Deck automatically assembles:

- **Parent outline chain**: The hierarchy from root heading/task down to the current subtask so the agent understands the bigger picture.
- **Prior Q&A & progress**: Existing `💬` logs, `❓` questions, and `✍️` answers under the same task.
- **Relevant long-term memories**: Up to 5 relevant entries from your memory library, each with a link back to the original journal block so the agent can verify source context.
- **Linked notes**: Excerpts from `[[wikilinks]]` referenced in the task (when there are many links, paths are passed for on-demand reading; notes marked `private` are never sent out).
- **Skill cards**: Mention `[[Skills/xxx]]` in a task to attach a local skill's instructions to that run.

> **Preview before sending**: Run `Delegate: write a draft (do not send)` to materialize the full dispatch payload right under the task line so you can edit it before sending. Actual dispatches also save an immutable snapshot (`Agent Deck/派发/*.md`) for later review.

## 2. Human-in-the-Loop Q&A

- When a background agent ends a turn with a question, a `❓` line is written under the task and surfaced in the sidebar **Reply inbox**.
- Write `✍️ Answer: …` directly in the note or use "Answer and continue" from the task menu to resume the same session without switching back to the external client.

## 3. Four Record Views & In-Place Fractal Boards

Inspect the exact same Markdown from multiple perspectives without rewriting the underlying file:

- **Four AI record views**: Outline, Table, Cards, and Timeline (interactive in Live Preview, clean read-only preview in Reading View), with view-aware export to PDF, HTML, Markdown, JSON, or CSV.
- **Pin & re-delegate**: Right-click any round in Table, Cards, Timeline, or Reading View to pin it as a key record (`<!-- ad-pin -->`, preserved when folded and prioritized by Dreaming) or re-delegate that round to your default agent or a chosen model.
- **In-place fractal boards**: Any block with multiple direct child tasks gets a **Board N** toggle — split by status or by group, drag cards across columns, zoom into nested sub-boards, and use mirror cards (`![[Note#^block-id]]`) that write status changes back to the source note.

## 4. Squads, Planning & Workbench

- **Goal → `task.md` → Board**: Run `Plan: turn this line into task.md` to break a single goal line into steps with acceptance criteria; the output automatically opens as a board.
- **Squad presets**: Five built-in squads (full-stack, debugging/refactoring, research & docs, deep report, long-form writing) that skip disabled or rate-limited agents, with a 15-minute steward check-in if a wave stalls.
- **Workbench overview**: Run `Workbench: refresh overview` to generate a single index note listing active boards, memory statistics, and recent plans.
