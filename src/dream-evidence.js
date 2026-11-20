import { createHash } from "crypto";
import { RECORD_ICON_RE, hasPinMarker } from "./journal.js";
import { AI_RECORD_RE } from "./ai-records.js";
import { LIST_RE, width, fencedLines, frontmatterEnd, parseMirrorRef } from "./outline.js";
import { isPathExcluded, isPrivateFrontmatter } from "./memory-query-core.js";

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);

const AI_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s+)?(?:[A-Z-]+\s+)?(?:\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s+)?🤖/;
const AD_COMMENT_RE = /(?:[ \t]*<!--\s*ad-[a-z0-9-]+(?::[^>]+)?\s*-->)+[ \t]*$/g;
const SEP_ONLY_RE = /^(?:\s*(?:[-*+]|\d+[.)])?\s*[-_*]{3,}\s*)+$/;

// Preserve authorship through nested AI replies; ❓ is a recorded user question.
export function evidenceBlocks(text, path, { aiOnly = false } = {}) {
  const lines = text.split("\n"), blocks = [], stack = [], directAiOwners = new Set();
  const fenced = fencedLines(lines), start = frontmatterEnd(lines);
  let block = null, nextItemId = 1;
  const flush = () => {
    if (block?.text.trim() && !SEP_ONLY_RE.test(block.text)) blocks.push({ ...block, key: hash(path + "\n" + block.kind + "\n" + block.text) });
    block = null;
  };
  for (let n = start; n < lines.length; n++) {
    const rawLine = lines[n];
    const inFence = fenced.has(n);
    const prevFence = n > start && fenced.has(n - 1);
    const isFenceOpener = inFence && !prevFence && /^\s*(?:`{3,}|~{3,})/.test(rawLine);
    const linePinned = !inFence && hasPinMarker(rawLine);
    const line = inFence ? rawLine : rawLine.replace(AD_COMMENT_RE, "");
    const list = (!inFence || isFenceOpener) && LIST_RE.test(line);
    if (list && !inFence && parseMirrorRef(line)) {
      flush();
      continue;
    }
    let kind = block?.kind || "user";
    let itemId = block?._itemId || 0;
    let aiRelevant = block?._aiRelevant || false;
    let pinned = block?.pinned || false;
    if (list) {
      flush();
      const indent = width(line);
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const isQuestion = /^\s*(?:[-*+]|\d+[.)])\s+❓\s/.test(line);
      const isAiLine = AI_RECORD_RE.test(line) || AI_LINE_RE.test(line);
      const isChildRecord = RECORD_ICON_RE.test(line);
      const parent = stack.at(-1);
      kind = isQuestion ? "user" : isAiLine ? "ai" : parent?.kind || "user";
      if (isChildRecord && parent?.itemId) directAiOwners.add(parent.itemId);
      aiRelevant = isAiLine || isChildRecord || Boolean(parent?.aiRelevant);
      pinned = linePinned || Boolean(parent?.pinned);
      itemId = nextItemId++;
      stack.push({ indent, kind, itemId, aiRelevant, pinned });
    } else if ((!inFence || isFenceOpener) && /^\S/.test(line)) {
      flush(); stack.length = 0; kind = "user"; itemId = 0; aiRelevant = false; pinned = linePinned;
    } else if (linePinned) {
      pinned = true;
    }
    // Split oversized records too: no prefix-only truncation, even on one long line.
    for (let offset = 0; offset < Math.max(1, line.length); offset += 3000) {
      const part = line.slice(offset, offset + 3000);
      if (block && (block.kind !== kind || block.text.length + part.length + 1 > 3000)) flush();
      if (!block) block = { path, kind, line: n + 1, endLine: n + 1, text: "", _itemId: itemId, _aiRelevant: aiRelevant, ...(pinned ? { pinned: true } : {}) };
      if (pinned) block.pinned = true;
      block.text += (block.text ? "\n" : "") + part;
      block.endLine = n + 1;
    }
  }
  flush();
  return blocks
    .filter((b) => !aiOnly || b._aiRelevant || (b._itemId && directAiOwners.has(b._itemId)))
    .map(({ _itemId, _aiRelevant, ...clean }) => clean);
}

// Shared read-only input for Dream analyzers. Keep evidence keys stable across runs.
export async function collectDreamEvidence(paths, read, { aiOnly = false, excludedDirs = [] } = {}) {
  const sources = new Map(), seen = new Set();
  for (const path of paths) {
    if (isPathExcluded(path, excludedDirs)) continue;
    const text = await read(path);
    if (isPrivateFrontmatter(text)) continue;
    for (const source of evidenceBlocks(text, path, { aiOnly })) {
      if (seen.has(source.key)) continue;
      seen.add(source.key);
      sources.set(`S${sources.size + 1}`, source);
    }
  }
  return sources;
}
