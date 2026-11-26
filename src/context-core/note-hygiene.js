// Canonical note grammar, line cleaning, YAML frontmatter/OKF mapping, heading navigation,
// and AI-generated log / generated-file filtering.
// Pure Node leaf module: zero Obsidian / Electron / i18n dependencies.

import { fencedLines, frontmatterEnd, LIST_RE, width } from "../outline.js";

/** Normalize a Vault-relative POSIX path without leading or trailing slashes. */
export function normalizeRelPath(p) {
  return String(p || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export const TASK_KWS = "TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED";
export const TASK_KW_STRIP_RE = new RegExp(`^(?:${TASK_KWS})(?=\\s|$)\\s*`, "i");
export const BLOCK_ID_SUFFIX_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
export const PROVENANCE_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->/g;
export const PIN_MARKER_RE = /[ \t]*<!--\s*ad-pin\s*-->[ \t]*/gi;
export const INTERNAL_BLOCK_ID_RE = /^(?:ad-[a-z0-9-]+|(?:agy|claude|codex|dsh|wb|oc|qoder|cursor|trae|grokbot|ta|t3code|cindy|orca|muse|kimi|doubao|gemini|hermes|minimax|qwenwork)-(?:[a-z][a-z0-9]{0,15}-){0,2}[a-z0-9]{10}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

const AI_AUTO_TASK_RE = new RegExp(
  `^\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[[^\\]]\\]\\s+)?(?:(?:${TASK_KWS})\\s+)?(?:\\*{0,2}\\d{1,2}[:：]\\d{2}(?:\\s*[-–~～到至]\\s*\\d{1,2}[:：]\\d{2})?\\*{0,2}\\s+)?🤖(?=\\s|$)`,
  "i",
);
const AI_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|📋|⏱)\s|(?:第\s*\d+\s*轮|Round\s+\d+)[：:]|⏳\s*(?:第\s*\d+\s*轮|Round\s+\d+)|📄\s+\[\[Agent Deck\/(?:派发|Answers|Conversations)\/|📝\s+\[\[Agent Deck\/派发\/)/i;
const AI_LINK_RE = /^\s*(?:[-*+]|\d+[.)])\s+🔗\s+(?:(?:子代理|side chat)\b|\[(?:Antigravity|Claude(?:\s+Code)?|Codex|DSH|DeepSeek(?:\s+Harness)?|WorkBuddy|OpenCode|Qoder|Cursor|Trae|Hermes(?:\s+Agent)?|MiniMax(?:\s+Code)?|Gemini(?:\s+CLI)?|Kimi(?:\s+Code)?|GrokBot|TeleAgent|T3Code|Cindy|Orca|Muse|Doubao|千问办公)[^\]]*\]\()/i;
const AI_QUESTION_RE = /^\s*(?:[-*+]|\d+[.)])\s+❓(?=\s|$)/;
const AI_QUESTION_SIGNAL_RE = /(?:(?:第\s*\d+\s*轮|Round\s+\d+)[：:]|\^ad-q-[a-z0-9-]+|<!--\s*ad-turn:)/i;
const USER_ANSWER_RE = /^\s*(?:[-*+]|\d+[.)])\s+✍️/;
const PROVENANCE_LINE_RE = /<!--\s*ad-(?:turn|summary(?:-pending)?|clock):[^>]+-->/i;
const LAYOUT_MARKER_RE = /^\s*<!--\s*agent-deck:(?:layout|section):[^>]+-->\s*$/i;
const CONVERSATION_EXPORT_RE = /^<!--\s*agent-deck-conversation\b/i;
const GENERATED_DEMO_RE = /^agent deck\/(?:功能示例|welcome)-[^/]+\.md$/i;
const GENERATED_FM_TYPE_RE = /^type:\s*["']?(?:派发载荷|dispatch-payload)["']?\s*$/i;
const GENERATED_FM_BY_RE = /^generated_by:\s*["']?agent-deck["']?\s*$/i;

export const OKF_SUMMARY_KEYS = ["type", "description", "def", "domain", "category", "father", "status", "verified", "stale_after"];

export function isInternalTaskBlockId(id) {
  return INTERNAL_BLOCK_ID_RE.test(String(id || "").trim());
}

export function isLayoutMarkerLine(line) {
  return LAYOUT_MARKER_RE.test(String(line || ""));
}

export function cleanUserNoteLine(line, { inFence = false } = {}) {
  if (inFence) return String(line ?? "");
  const raw = String(line ?? "");
  if (isLayoutMarkerLine(raw)) return "";
  let out = raw.replace(PROVENANCE_RE, "").replace(PIN_MARKER_RE, " ");
  const m = BLOCK_ID_SUFFIX_RE.exec(out);
  if (m && isInternalTaskBlockId(m[1])) out = out.replace(BLOCK_ID_SUFFIX_RE, "");
  return out.replace(/%%[^%]*?%%/g, "").replace(/[ \t]+$/, "");
}

export function cleanUserNoteLines(lines, fenced = fencedLines(lines)) {
  return (lines || []).map((line, idx) => cleanUserNoteLine(line, { inFence: fenced.has(idx) }));
}

export function unYamlStr(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

export function parseListValue(raw) {
  if (Array.isArray(raw)) return raw.map((x) => unYamlStr(x).trim()).filter(Boolean);
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1).split(/[,，]/).map((x) => unYamlStr(x).trim()).filter(Boolean);
  }
  return s.split(/[,，]/).map((x) => unYamlStr(x).trim()).filter(Boolean);
}

export function parseFrontmatter(lines = []) {
  const fmEnd = frontmatterEnd(lines);
  if (fmEnd <= 1 || lines[fmEnd - 1]?.trim() !== "---") {
    return { fmEnd: 0, meta: {} };
  }
  const meta = {};
  let activeKey = "";
  for (const line of lines.slice(1, fmEnd - 1)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      const val = String(m[2] ?? "").trim();
      if (val) {
        activeKey = "";
        meta[key] = val.startsWith("[") && val.endsWith("]") ? parseListValue(val) : unYamlStr(val);
      } else {
        activeKey = key;
        meta[key] = [];
      }
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && activeKey && Array.isArray(meta[activeKey])) {
      const v = unYamlStr(item[1]).trim();
      if (v) meta[activeKey].push(v);
    }
  }
  return { fmEnd, meta };
}

export function extractOkfSummaryParts(source, {
  keys = OKF_SUMMARY_KEYS,
  maxKeys = 9,
  maxValLen = 0,
} = {}) {
  if (!source || typeof source !== "object") return [];
  const str = (v) => (Array.isArray(v) ? String(v[0] ?? "").trim() : String(v ?? "").trim());
  const parts = [];
  const used = new Set();

  for (const key of keys) {
    if (parts.length >= maxKeys) break;
    if (key === "def" && used.has("description")) continue;
    if (key === "description" && used.has("def")) continue;
    if (key === "category" && used.has("domain")) continue;
    if (key === "domain" && used.has("category")) continue;

    let rawVal = "";
    if (key === "status") rawVal = str(source.status) || str(source.state);
    else if (key === "verified") {
      const isV = source.verified === true || str(source.verified).toLowerCase() === "true" || Boolean(str(source.verified_by));
      rawVal = isV ? "true" : "";
    } else {
      rawVal = str(source[key]);
    }
    if (!rawVal || rawVal === "[]" || rawVal === "{}") continue;
    used.add(key);
    const val = maxValLen > 0 && rawVal.length > maxValLen ? `${rawVal.slice(0, maxValLen - 1)}…` : rawVal;
    parts.push(`${key}: ${val}`);
  }
  return parts;
}

export function findHeadingRange(lines = [], headingName = "", {
  fenced = fencedLines(lines),
  caseInsensitive = true,
} = {}) {
  const rawWant = String(headingName || "").trim();
  if (!rawWant) return null;
  const want = caseInsensitive ? rawWant.toLowerCase() : rawWant;
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (!hm) continue;
    const title = hm[2].trim();
    const cmp = caseInsensitive ? title.toLowerCase() : title;
    if (cmp !== want) continue;
    const level = hm[1].length;
    let end = i + 1;
    while (end < lines.length) {
      if (!fenced.has(end)) {
        const next = /^(#{1,6})\s+/.exec(lines[end]);
        if (next && next[1].length <= level) break;
      }
      end++;
    }
    return { start: i, end, level, title };
  }
  return null;
}

export function collectRemainingHeadings(lines = [], {
  fromIdx = 0,
  endIdx = lines.length,
  maxLevel = 4,
  maxItems = 6,
  fenced = fencedLines(lines),
  skipLines = null,
} = {}) {
  const cap = Math.min(endIdx, lines.length);
  if (fromIdx >= cap) return [];
  const headingRe = new RegExp(`^(#{1,${Math.max(1, Math.min(6, maxLevel))}})\\s+(.+?)\\s*#*$`);
  const items = [];
  for (let i = Math.max(0, fromIdx); i < cap; i++) {
    if (fenced.has(i) || skipLines?.has(i)) continue;
    const hm = headingRe.exec(lines[i]);
    if (!hm) continue;
    const title = hm[2].trim();
    if (!title) continue;
    items.push({ level: hm[1].length, hashes: hm[1], title, line: i + 1 });
    if (items.length >= maxItems) break;
  }
  return items;
}

export function buildGeneratedMatchers({
  memoryDir = "Agent Deck/记忆",
  dreamPath = "Agent Deck/长期记忆.md",
  doneArchivePath = "Agent Deck/done/已完成任务.md",
} = {}) {
  const normLow = (p) => normalizeRelPath(p).toLowerCase();
  const memRel = normLow(memoryDir || "Agent Deck/记忆") || "agent deck/记忆";
  const dreamRel = normLow(dreamPath || "Agent Deck/长期记忆.md") || "agent deck/长期记忆.md";
  const doneRel = normLow(doneArchivePath || "Agent Deck/done/已完成任务.md") || "agent deck/done/已完成任务.md";

  const dirPrefixes = [...new Set([
    "agent deck/派发/",
    "agent deck/answers/",
    "agent deck/conversations/",
    "agent deck/exports/",
    "agent deck/任务/",
    "agent deck/done/",
    "agent deck/记忆/",
    `${memRel}/`,
  ])];

  const exactPaths = new Set([
    "agent deck/长期记忆.md",
    "agent deck/工作台.md",
    "agent deck/安全审计.md",
    "agent deck/记忆-体检.md",
    "agent deck/done/已完成任务.md",
    dreamRel,
    doneRel,
  ]);

  return {
    memRel,
    memoryDirPrefix: `${memRel}/`,
    dreamPathExact: dreamRel,
    dirPrefixes,
    exactPaths,
    key: `${memRel}|${dreamRel}|${doneRel}`,
  };
}

export function isGeneratedVaultFile(relPath, raw = "", matchers = buildGeneratedMatchers()) {
  const lowPath = normalizeRelPath(relPath).toLowerCase();
  if (!lowPath) return { isGenerated: false, isMemoryStore: false };

  const inMemoryDir = lowPath.startsWith(matchers.memoryDirPrefix) || lowPath.startsWith("agent deck/记忆/");
  const isMemoryDoc = inMemoryDir || lowPath === matchers.dreamPathExact || lowPath === "agent deck/长期记忆.md";
  if (isMemoryDoc) return { isGenerated: true, isMemoryStore: true };

  if (
    matchers.dirPrefixes.some((p) => lowPath.startsWith(p))
    || matchers.exactPaths.has(lowPath)
    || GENERATED_DEMO_RE.test(lowPath)
  ) {
    return { isGenerated: true, isMemoryStore: false };
  }

  if (raw) {
    const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
    const firstNonEmpty = lines.find((l) => l.trim());
    if (firstNonEmpty && CONVERSATION_EXPORT_RE.test(firstNonEmpty.trim())) {
      return { isGenerated: true, isMemoryStore: false };
    }
    const fmEnd = frontmatterEnd(lines);
    if (fmEnd > 1 && lines[fmEnd - 1]?.trim() === "---") {
      for (let i = 1; i < fmEnd - 1; i++) {
        const trimmed = lines[i].trim();
        if (GENERATED_FM_TYPE_RE.test(trimmed) || GENERATED_FM_BY_RE.test(trimmed)) {
          return { isGenerated: true, isMemoryStore: false };
        }
      }
    }
  }

  return { isGenerated: false, isMemoryStore: false };
}

/** Return 0-based line indices belonging to AI auto-generated logs/subtrees or layout comments. */
export function aiGeneratedLineIndices(lines = [], { startLine = 0 } = {}) {
  const skipped = new Set();
  if (!Array.isArray(lines) || !lines.length) return skipped;

  const fenced = fencedLines(lines);
  const stack = [];
  let fenceOwner = "";

  for (let i = Math.max(0, startLine); i < lines.length; i++) {
    const line = lines[i] ?? "";
    const inFence = fenced.has(i);
    if (inFence) {
      const prevFence = i > 0 && fenced.has(i - 1);
      if (!prevFence) {
        const w = width(line);
        if (w === 0) {
          stack.length = 0;
          fenceOwner = "user";
        } else {
          const owner = [...stack].reverse().find((item) => item.indent < w);
          fenceOwner = owner?.kind || "user";
        }
      }
      if (fenceOwner === "ai") skipped.add(i);
      continue;
    }
    fenceOwner = "";

    if (!line.trim()) continue;
    if (isLayoutMarkerLine(line)) {
      skipped.add(i);
      continue;
    }

    const w = width(line);
    if (LIST_RE.test(line)) {
      while (stack.length && stack[stack.length - 1].indent >= w) stack.pop();
      const parent = stack[stack.length - 1];
      const isUserAnswer = USER_ANSWER_RE.test(line);
      const isAiQuestion = AI_QUESTION_RE.test(line) && (parent?.kind === "ai" || AI_QUESTION_SIGNAL_RE.test(line));
      const isAiDirect =
        AI_AUTO_TASK_RE.test(line)
        || AI_RECORD_RE.test(line)
        || AI_LINK_RE.test(line)
        || isAiQuestion
        || PROVENANCE_LINE_RE.test(line);
      const kind = isUserAnswer ? "user" : isAiDirect ? "ai" : (parent?.kind || "user");
      stack.push({ indent: w, kind });
      if (kind === "ai") skipped.add(i);
      continue;
    }

    if (PROVENANCE_LINE_RE.test(line)) {
      skipped.add(i);
      continue;
    }
    if (w === 0) {
      stack.length = 0;
      continue;
    }
    const owner = [...stack].reverse().find((item) => item.indent < w);
    if (owner?.kind === "ai") skipped.add(i);
  }

  return skipped;
}
