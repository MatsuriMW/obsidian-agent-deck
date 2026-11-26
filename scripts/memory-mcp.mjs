#!/usr/bin/env node
/* Built from src/context-core/mcp.js by `npm run build` — do not edit directly. */

// src/context-core/mcp.js
import fs6 from "node:fs";
import path6 from "node:path";

// src/context-core/config.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/memory-query-core.js
var STOP_LATIN = /* @__PURE__ */ new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "will",
  "your",
  "they",
  "them",
  "what",
  "when",
  "where",
  "which",
  "into",
  "onto",
  "only",
  "also",
  "more",
  "most",
  "some",
  "such",
  "than",
  "then",
  "very",
  "just",
  "like",
  "make",
  "made",
  "need",
  "used",
  "using",
  "work",
  "done",
  "todo",
  "doing",
  "note",
  "notes",
  "file",
  "files",
  "code",
  "test",
  "tests",
  "task",
  "tasks",
  "mode",
  "user",
  "agent",
  "agents",
  "claude",
  "codex",
  "obsidian",
  "plugin",
  "true",
  "false",
  "null",
  "none",
  "json",
  "markdown"
]);
var STOP_CJK = /* @__PURE__ */ new Set([
  "\u7528\u6237",
  "\u53EF\u4EE5",
  "\u9700\u8981",
  "\u901A\u8FC7",
  "\u8FDB\u884C",
  "\u4F7F\u7528",
  "\u4E00\u4E2A",
  "\u6CA1\u6709",
  "\u4E0D\u662F",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u5982\u679C",
  "\u56E0\u4E3A",
  "\u6240\u4EE5",
  "\u4EE5\u53CA",
  "\u6216\u8005",
  "\u76F8\u5173",
  "\u76EE\u524D",
  "\u5F53\u524D",
  "\u95EE\u9898",
  "\u5185\u5BB9",
  "\u8BB0\u5F55",
  "\u5EFA\u8BAE",
  "\u63D0\u51FA",
  "\u8BA4\u4E3A",
  "\u89C9\u5F97",
  "\u81EA\u5DF1",
  "\u6211\u4EEC",
  "\u4ED6\u4EEC",
  "\u8BBE\u7F6E",
  "\u600E\u4E48",
  "\u5982\u4F55",
  "\u4EC0\u4E48",
  "\u54EA\u4E9B",
  "\u8FD9\u6837",
  "\u90A3\u6837",
  "\u5DF2\u7ECF",
  "\u4ECD\u7136",
  "\u8FD8\u662F",
  "\u867D\u7136",
  "\u4F46\u662F",
  "\u4E0D\u8FC7",
  "\u800C\u4E14",
  "\u5E76\u4E14",
  "\u53EA\u662F",
  "\u5C31\u662F",
  "\u5173\u4E8E",
  "\u5BF9\u4E8E",
  "\u65F6\u5019",
  "\u5730\u65B9",
  "\u65B9\u9762",
  "\u60C5\u51B5",
  "\u65B9\u5F0F",
  "\u65B9\u6CD5",
  "\u4F5C\u4E3A",
  "\u6210\u4E3A",
  "\u56E0\u6B64",
  "\u4ECE\u800C",
  "\u907F\u514D",
  "\u786E\u4FDD",
  "\u5E94\u5F53",
  "\u5FC5\u987B",
  "\u5E94\u8BE5",
  "\u4E00\u4E0B",
  "\u4E00\u4E9B",
  "\u8FD9\u4E9B",
  "\u90A3\u4E9B",
  "\u540C\u65F6",
  "\u53E6\u5916",
  "\u5176\u4F59",
  "\u5176\u4ED6",
  "\u6240\u6709",
  "\u5168\u90E8"
]);
var HYBRID_TERM_RE = /(?<![a-z0-9])[a-z]\s*[\u4e00-\u9fff]/gi;
var TOKEN_RE = /[a-z0-9_-]{2,}|[\u4e00-\u9fff]+/g;
function rawTerms(value) {
  const s = String(value || "");
  const out = /* @__PURE__ */ new Set();
  for (const w of s.toLowerCase().match(TOKEN_RE) || []) {
    if (/^[\u4e00-\u9fff]/.test(w)) {
      const chars = [...w];
      for (let i = 1; i < chars.length; i++) out.add(chars[i - 1] + chars[i]);
    } else {
      out.add(w);
    }
  }
  for (const m of s.match(HYBRID_TERM_RE) || []) {
    out.add(m.replace(/\s+/g, "").toLowerCase());
  }
  return out;
}
function terms(value) {
  const raw = rawTerms(value);
  if (!raw.size) return raw;
  const filtered = new Set([...raw].filter((t) => !STOP_CJK.has(t)));
  return filtered.size ? filtered : raw;
}
function isHybridTerm(term) {
  return /^[a-z][\u4e00-\u9fff]$/.test(String(term || ""));
}
function isDistinctiveLatinTerm(term) {
  return /^[a-z0-9][a-z0-9_-]{3,}$/.test(term) && !/^\d+$/.test(term) && !STOP_LATIN.has(term);
}
function isPrivateFrontmatter(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return false;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return false;
  for (const line of lines.slice(1, end)) {
    const m = /^(?:private|"private"|'private')\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    let val = m[1].trim();
    if (/^["']/.test(val)) {
      const q = val[0];
      const closeIdx = val.indexOf(q, 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      val = val.replace(/\s+#.*$/, "");
    }
    return val.trim().toLowerCase() === "true";
  }
  return false;
}
function normalizeExcludedDirs(dirs = []) {
  const list = Array.isArray(dirs) ? dirs : String(dirs || "").split(/[\n,;]+/);
  return list.map((d) => String(d || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
}
function isPathExcluded(notePath, excludedDirs = [], { caseInsensitive = false } = {}) {
  const rawNorm = String(notePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rawNorm) return false;
  const norm = caseInsensitive ? rawNorm.toLowerCase() : rawNorm;
  const dirs = normalizeExcludedDirs(excludedDirs);
  return dirs.some((dir) => {
    const cmp = caseInsensitive ? dir.toLowerCase() : dir;
    return norm === cmp || norm.startsWith(`${cmp}/`);
  });
}
function normalizeProjectKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_\-·.]+/g, "");
}
function stripLinkWrap(raw) {
  return String(raw || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
}
function entryMetaTerms(entry) {
  const parts = [];
  if (entry?.project) parts.push(entry.project);
  if (entry?.projectLink) parts.push(stripLinkWrap(entry.projectLink));
  if (Array.isArray(entry?.concepts)) parts.push(...entry.concepts.map(stripLinkWrap));
  if (Array.isArray(entry?.conflictsWith)) parts.push(...entry.conflictsWith.map(stripLinkWrap));
  if (entry?.appliesTo) parts.push(entry.appliesTo);
  if (Array.isArray(entry?.tags)) parts.push(...entry.tags);
  if (entry?.domain) parts.push(entry.domain);
  if (entry?.category) parts.push(entry.category);
  if (entry?.description) parts.push(entry.description);
  if (entry?.type) parts.push(entry.type);
  if (entry?.kind) parts.push(entry.kind);
  for (const src of entry?.sources || []) {
    const m = /^\[\[([^\]|#]+)/.exec(String(src || ""));
    if (m) parts.push(m[1].split("/").pop());
  }
  return terms(parts.join(" "));
}
var PROPOSAL_ONLY_RE = /(?:尚未实施|未实施|仍待.{0,12}验证|尚未验证|不能视为已验证|未说明是否实测|未经验证的推断|(?:只|仅)完成改造.{0,16}待.{0,8}验证)/;
function isMemoryStale(entry, nowMs = Date.now()) {
  const raw = String(entry?.staleAfter || entry?.validUntil || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const untilMs = Date.parse(raw);
  return Number.isFinite(untilMs) && nowMs >= untilMs + 864e5;
}
function deriveTrustLevel(entry) {
  if (!entry) return "unverified";
  if (entry.verified === true || String(entry.verifiedBy || "").trim().toLowerCase().startsWith("human:")) return "human-reviewed";
  const prov = String(entry.provenance || "").trim().toLowerCase();
  const gen = String(entry.generatedBy || "").trim().toLowerCase();
  if (prov === "ai-log" || gen === "mcp") return "ai-derived";
  if (prov) return "user-authored";
  const srcs = Array.isArray(entry.sources) ? entry.sources.map((s) => String(s || "")) : [];
  if (srcs.some((s) => s.includes("AI \u8BB0\u5F55")) && !srcs.some((s) => s.includes("\u7528\u6237\u65E5\u5FD7"))) return "ai-derived";
  if (srcs.length) return "user-authored";
  return "unverified";
}
function analyzeTextHits(text, wanted) {
  const s = String(text || "").toLowerCase();
  const cjkOverlapped = /* @__PURE__ */ new Set();
  const cjkNonOverlapped = /* @__PURE__ */ new Set();
  const nonCjkHits = /* @__PURE__ */ new Set();
  for (const w of wanted || []) {
    if (!STOP_CJK.has(w) && !/^[\u4e00-\u9fff]{2}$/.test(w) && rawTerms(s).has(w)) nonCjkHits.add(w);
  }
  let distinctCjk = 0;
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const chars = [...run];
    let lastEnd = -1;
    for (let i = 1; i < chars.length; i++) {
      const bg = chars[i - 1] + chars[i];
      if (!wanted.has(bg) || STOP_CJK.has(bg)) continue;
      if (i - 1 >= lastEnd) {
        distinctCjk++;
        lastEnd = i + 1;
        cjkNonOverlapped.add(bg);
      } else if (!cjkNonOverlapped.has(bg)) {
        cjkOverlapped.add(bg);
      }
    }
  }
  return {
    distinctHits: nonCjkHits.size + distinctCjk,
    overlappedOnly: new Set([...cjkOverlapped].filter((bg) => !cjkNonOverlapped.has(bg)))
  };
}
function computeIdfMap(entries = []) {
  const df = /* @__PURE__ */ new Map();
  let n = 0;
  for (const entry of entries || []) {
    if (!entry || entry.private) continue;
    n++;
    const seen = /* @__PURE__ */ new Set([...terms(entry.text), ...entryMetaTerms(entry)]);
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  }
  const idf = /* @__PURE__ */ new Map();
  for (const [w, count] of df) idf.set(w, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

// src/memory-store.js
import { createHash } from "crypto";

// src/memory-graph.js
function normalizeLinkName(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  s = s.split("|")[0].split("#")[0].trim();
  if (s.toLowerCase().endsWith(".md")) s = s.slice(0, -3).trim();
  return s;
}
var QUOTE_PAIRS = [
  ["\u300C", "\u300D"],
  ["\u300E", "\u300F"],
  ["\u300A", "\u300B"],
  ["\u3010", "\u3011"],
  ["\u201C", "\u201D"],
  ["\u2018", "\u2019"]
];
function deriveShortMemoryTitle(text = "", max = 22) {
  let s = String(text || "").replace(/[\r\n]+/g, " ").trim();
  s = s.replace(/（待验证(?:推断)?）$/g, "").replace(/[（(][^）)]{1,24}[）)]/g, "").trim();
  const prefixes = [
    /^(?:用户在|用户的|用户指定|用户习惯|用户认为|用户偏好|用户要求|用户倾向|用户推断|用户以|用户按)[，：:\s]*/u,
    /^(?:AI\s*编码记录里的|AI\s*记录称|AI\s*记录建议|AI\s*记录提出|AI\s*记录认为|AI\s*记录将)[，：:\s]*/iu,
    /^(?:推断|用户)[，：:\s]+/u
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const re of prefixes) s = s.replace(re, "").trim();
  }
  s = s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "\u8BB0\u5FC6";
  const trailingRe = /[，。、；：！？,.;:!?（(【「『《“‘\-_\s]+$/u;
  const chars = [...s];
  if (chars.length <= max) {
    return s.replace(trailingRe, "") || "\u8BB0\u5FC6";
  }
  const openSet = new Set(QUOTE_PAIRS.map(([o]) => o));
  const closeToOpen = new Map(QUOTE_PAIRS.map(([o, c]) => [c, o]));
  const stack = [];
  let clauseCut = -1;
  for (let i = 0; i < Math.min(chars.length, max); i++) {
    const ch = chars[i];
    if (openSet.has(ch)) {
      stack.push(ch);
    } else if (closeToOpen.has(ch)) {
      const want = closeToOpen.get(ch);
      const pos = stack.lastIndexOf(want);
      if (pos >= 0) stack.splice(pos, 1);
    } else if (i >= 9 && stack.length === 0 && "\uFF0C\u3002\uFF1B\uFF1A\u3001,.;:".includes(ch)) {
      const candidate = chars.slice(0, i).join("").replace(trailingRe, "").trim();
      if (i <= 13 && /^(?:在.{1,10}[中时里内]|当.{1,10}时|对于.{1,10}|关于.{1,10}|涉及.{1,10})$/u.test(candidate)) {
        continue;
      }
      clauseCut = i;
      break;
    }
  }
  if (clauseCut >= 9) {
    const picked = chars.slice(0, clauseCut).join("").replace(trailingRe, "").trim();
    if (picked) return picked;
  }
  let cut = chars.slice(0, max).join("");
  if (/[A-Za-z0-9_-]$/.test(cut) && chars[max] && /[A-Za-z0-9_-]/.test(chars[max])) {
    const trimmed = cut.replace(/[A-Za-z0-9_-]+$/, "").trim();
    if ([...trimmed].length >= 6) cut = trimmed;
  }
  for (const [open, close] of QUOTE_PAIRS) {
    const openIdx = cut.lastIndexOf(open);
    const closeIdx = cut.lastIndexOf(close);
    if (openIdx >= 0 && openIdx > closeIdx) {
      const before = cut.slice(0, openIdx).replace(trailingRe, "").trim();
      if ([...before].length >= 6) cut = before;
      else cut = cut.slice(0, openIdx) + cut.slice(openIdx + open.length);
    }
  }
  const strippedDangling = cut.replace(trailingRe, "").replace(/[的了着和与及或把被将对向在为是]+$/u, "").trim();
  if ([...strippedDangling].length >= 6) cut = strippedDangling;
  return cut.replace(trailingRe, "").trim() || "\u8BB0\u5FC6";
}

// src/memory-store.js
var MEMORY_DIR_DEFAULT = "Agent Deck/\u8BB0\u5FC6";
var MEMORY_LOG_FILE = "log.md";
var MEMORY_ARCHIVE_SUBDIR = "archive";
var MEMORY_STATES = ["\u6709\u6548", "\u5DF2\u62D2\u7EDD", "\u5DF2\u88AB\u66FF\u4EE3"];
var MEMORY_KINDS = { fact: "\u4E8B\u5B9E", preference: "\u504F\u597D", pattern: "\u5F85\u9A8C\u8BC1\u89C4\u5F8B", lesson: "\u9879\u76EE\u7ECF\u9A8C" };
var STATE_TO_STATUS = { \u6709\u6548: "active", \u5DF2\u88AB\u66FF\u4EE3: "deprecated", \u5DF2\u62D2\u7EDD: "rejected" };
var STATUS_TO_STATE = { active: "\u6709\u6548", stable: "\u6709\u6548", confirmed: "\u6709\u6548", deprecated: "\u5DF2\u88AB\u66FF\u4EE3", superseded: "\u5DF2\u88AB\u66FF\u4EE3", rejected: "\u5DF2\u62D2\u7EDD" };
var VALID_PROVENANCE = /* @__PURE__ */ new Set(["user-log", "ai-log", "mixed", "import", "manual", "consolidated"]);
var VALID_VERDICTS = /* @__PURE__ */ new Set(["pending", "confirmed", "refuted"]);
function deriveProvenance(sources = [], explicit = "") {
  const clean = String(explicit || "").trim().toLowerCase();
  if (VALID_PROVENANCE.has(clean)) return clean;
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return "manual";
  let hasUser = false, hasAi = false, hasImport = false, hasLink = false;
  for (const raw of list) {
    const s = String(raw || "");
    if (s.includes("\u7528\u6237\u65E5\u5FD7")) hasUser = true;
    if (s.includes("AI \u8BB0\u5F55")) hasAi = true;
    if (s.includes("Claude \u8BB0\u5FC6\u5BFC\u51FA") || s.includes("\u5BFC\u5165")) hasImport = true;
    if (/^\[\[/.test(s)) hasLink = true;
  }
  if (hasUser && hasAi) return "mixed";
  if (hasUser) return "user-log";
  if (hasAi) return "ai-log";
  if (hasImport) return "import";
  if (hasLink) return "user-log";
  return "manual";
}
function deriveTrustLevel2(entry = {}) {
  if (!entry) return "unverified";
  if (entry.verified === true || String(entry.verifiedBy || "").trim().toLowerCase().startsWith("human:")) return "human-reviewed";
  const prov = deriveProvenance(entry.sources, entry.provenance);
  const gen = String(entry.generatedBy || "").trim().toLowerCase();
  if (prov === "ai-log" || gen === "mcp") return "ai-derived";
  if (prov === "user-log" || prov === "mixed" || prov === "import" || prov === "manual" || prov === "consolidated") return "user-authored";
  return "unverified";
}
var hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
var memoryIdOf = (text) => "m-" + hash(String(text || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));
function yamlStr(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function unYamlStr(value) {
  const text = String(value ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\(["\\])/g, "$1") : text;
}
function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}
function parseInlineObject(raw) {
  const s = oneLine(raw);
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const out = {};
  for (const part of s.slice(1, -1).split(",")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(part.trim());
    if (m) out[m[1]] = unYamlStr(m[2]);
  }
  return out;
}
function parseTagsValue(raw) {
  if (Array.isArray(raw)) return raw.map(oneLine).filter(Boolean);
  const s = oneLine(raw);
  if (!s) return [];
  return s.replace(/^\[|\]$/g, "").split(/[,，]/).map((x) => unYamlStr(x).trim()).filter(Boolean);
}
function parseMemoryFile(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta = {};
  let list = "";
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) {
      const key = m[1];
      list = m[2] ? "" : key;
      meta[key] = m[2] ? unYamlStr(m[2]) : [];
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && Array.isArray(meta[list])) meta[list].push(unYamlStr(item[1]));
    const sub = /^\s+([A-Za-z_][\w-]*):\s*(.+)$/.exec(line);
    if (sub && Array.isArray(meta[list]) && !meta[list].length) {
      meta[`${list}_${sub[1]}`] = unYamlStr(sub[2]);
    }
  }
  const str = (v) => typeof v === "string" ? v.trim() : "";
  const body = lines.slice(end + 1);
  const bodyText = body.find((l) => l.trim() && l.trim() !== "## \u8BC1\u636E")?.trim() || "";
  const title = str(meta.title);
  const typeRaw = str(meta.type);
  const kindRaw = str(meta.kind);
  const stateRaw = str(meta.state);
  const statusRaw = str(meta.status).toLowerCase();
  const idRaw = str(meta.id);
  const text = bodyText || title;
  const kind = MEMORY_KINDS[kindRaw] ? kindRaw : KIND_BY_LABEL[typeRaw] || (text && (stateRaw || statusRaw || idRaw) ? inferMemoryKind(text) : "");
  if (!kind || !text) return null;
  const genObj = parseInlineObject(meta.generated);
  const verObj = parseInlineObject(meta.verified);
  const verFirst = Array.isArray(meta.verified) ? String(meta.verified[0] || "") : "";
  const verifiedBy = str(meta.verified_by) || str(verObj?.by) || str(meta.verified_by_child) || (/^by:\s*(.+)$/.exec(verFirst)?.[1] ? unYamlStr(/^by:\s*(.+)$/.exec(verFirst)[1]) : "");
  const verifiedAt = str(meta.verified_at) || str(verObj?.at) || str(meta.verified_at_child);
  const verified = str(meta.verified).toLowerCase() === "true" || Boolean(verifiedBy) || Boolean(verObj?.by);
  const state = MEMORY_STATES.includes(stateRaw) ? stateRaw : STATUS_TO_STATE[statusRaw] || "\u6709\u6548";
  const status = statusRaw || STATE_TO_STATUS[state] || "active";
  const sources = Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [];
  const provenance = deriveProvenance(sources, str(meta.provenance));
  const verdictRaw = str(meta.verdict).toLowerCase();
  const verdict = VALID_VERDICTS.has(verdictRaw) ? verdictRaw : kind === "pattern" ? verified ? "confirmed" : "pending" : "";
  const entry = {
    id: idRaw || memoryIdOf(text),
    kind,
    title,
    type: typeRaw || MEMORY_KINDS[kind] || "",
    text,
    description: str(meta.description) || str(meta.def),
    state,
    status,
    statusAt: str(meta.status_at),
    verified,
    verifiedBy,
    verifiedAt,
    provenance,
    generatedBy: str(meta.generated_by) || str(genObj?.by) || str(meta.generated_by_child),
    verdict,
    validFrom: str(meta.valid_from),
    validUntil: str(meta.valid_until),
    staleAfter: str(meta.stale_after),
    private: str(meta.private).toLowerCase() === "true",
    project: str(meta.project),
    projectLink: str(meta.project_link),
    concepts: Array.isArray(meta.concepts) ? meta.concepts.filter(Boolean) : parseTagsValue(meta.concepts),
    sourceNotes: Array.isArray(meta.source_notes) ? meta.source_notes.filter(Boolean) : [],
    conflictsWith: Array.isArray(meta.conflicts_with) ? meta.conflicts_with.filter(Boolean) : [],
    appliesTo: str(meta.applies_to),
    domain: str(meta.domain) || str(meta.category),
    tags: parseTagsValue(meta.tags),
    date: str(meta.date),
    sources,
    supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
    supersededBy: str(meta.superseded_by),
    evidence: []
  };
  const ev = body.findIndex((l) => l.trim() === "## \u8BC1\u636E");
  if (ev >= 0) for (const line of body.slice(ev + 1)) {
    const m = /^-\s+(.*)$/.exec(line);
    if (m) entry.evidence.push(m[1].trim());
  }
  entry.trust = deriveTrustLevel2(entry);
  return entry;
}
var KIND_BY_LABEL = Object.fromEntries(Object.entries(MEMORY_KINDS).map(([k, v]) => [v, k]));
function inferMemoryKind(text = "", hint = "") {
  const h = String(hint || "").trim().toLowerCase();
  if (MEMORY_KINDS[h]) return h;
  if (KIND_BY_LABEL[hint]) return KIND_BY_LABEL[hint];
  const s = String(text || "");
  if (/（待验证|待验证推断|待验证）|\b(?:hypothesis|unverified)\b/i.test(s) || /^(?:用户)?推断[，：:\s]/.test(s)) return "pattern";
  if (/偏好|喜欢|不喜欢|反感|倾向|习惯|要求|严禁|不买|宁可|优先|\b(?:prefer|prefers|wants|always|never)\b/i.test(s)) return "preference";
  if (/经验|教训|踩坑|必须|应当|切忌|避免|方案|架构|系统中|在\s*[A-Za-z\u4e00-\u9fff]+\s*中[，,]/i.test(s)) return "lesson";
  return "fact";
}
function classifyAnchorStatus(entry = {}, { existsInVault = null } = {}) {
  const sources = Array.isArray(entry?.sources) ? entry.sources.map((s) => String(s || "").trim()).filter(Boolean) : [];
  if (!sources.length) {
    return { hasSources: false, anchored: false, unanchoredVault: false, externalImportOnly: false };
  }
  let anchoredCount = 0;
  let unanchoredVaultCount = 0;
  let externalCount = 0;
  for (const s of sources) {
    if (/^\[\[[^\]|#]+#\^[A-Za-z0-9-]+\]\]/.test(s)) {
      anchoredCount++;
      continue;
    }
    const m = /^\[\[([^\]|#]+)\]\]/.exec(s);
    if (m) {
      const target = m[1].trim();
      let anchorable = false;
      if (entry?.provenance === "import") {
        anchorable = typeof existsInVault === "function" && Boolean(existsInVault(target));
      } else if (typeof existsInVault === "function") {
        anchorable = Boolean(existsInVault(target)) || s.includes("\u7528\u6237\u65E5\u5FD7") || s.includes("AI \u8BB0\u5F55");
      } else {
        anchorable = true;
      }
      if (anchorable) unanchoredVaultCount++;
      else externalCount++;
    } else {
      externalCount++;
    }
  }
  return {
    hasSources: true,
    anchored: unanchoredVaultCount === 0 && anchoredCount > 0,
    unanchoredVault: unanchoredVaultCount > 0,
    externalImportOnly: unanchoredVaultCount === 0 && anchoredCount === 0 && externalCount > 0
  };
}

// src/outline.js
var LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
function width(line) {
  let w = 0;
  for (const c of (/^\s*/.exec(line) || [""])[0]) w += c === "	" ? 4 : 1;
  return w;
}
function fencedLines(lines) {
  const out = /* @__PURE__ */ new Set();
  let fence = "";
  let size = 0;
  for (let n = 0; n < lines.length; n++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[n]);
    if (fence || m) out.add(n);
    if (m && !fence) {
      fence = m[1][0];
      size = m[1].length;
    } else if (m && m[1][0] === fence && m[1].length >= size && !m[2].trim()) {
      fence = "";
    }
  }
  return out;
}
function frontmatterEnd(lines) {
  if (!Array.isArray(lines) || lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return lines.length;
}
function subtreeEnd(lines, startLine, maxEnd = lines.length) {
  const indent = width(lines[startLine] || "");
  let end = startLine + 1;
  const limit = Math.min(maxEnd, lines.length);
  while (end < limit && (!lines[end].trim() || width(lines[end]) > indent)) end++;
  return end;
}

// src/context-core/note-hygiene.js
function normalizeRelPath(p) {
  return String(p || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}
var TASK_KWS = "TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED";
var TASK_KW_STRIP_RE = new RegExp(`^(?:${TASK_KWS})(?=\\s|$)\\s*`, "i");
var BLOCK_ID_SUFFIX_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
var PROVENANCE_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->/g;
var PIN_MARKER_RE = /[ \t]*<!--\s*ad-pin\s*-->[ \t]*/gi;
var INTERNAL_BLOCK_ID_RE = /^(?:ad-[a-z0-9-]+|(?:agy|claude|codex|dsh|wb|oc|qoder|cursor|trae|grokbot|ta|t3code|cindy|orca|muse|kimi|doubao|gemini|hermes|minimax|qwenwork)-(?:[a-z][a-z0-9]{0,15}-){0,2}[a-z0-9]{10}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
var AI_AUTO_TASK_RE = new RegExp(
  `^\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[[^\\]]\\]\\s+)?(?:(?:${TASK_KWS})\\s+)?(?:\\*{0,2}\\d{1,2}[:\uFF1A]\\d{2}(?:\\s*[-\u2013~\uFF5E\u5230\u81F3]\\s*\\d{1,2}[:\uFF1A]\\d{2})?\\*{0,2}\\s+)?\u{1F916}(?=\\s|$)`,
  "i"
);
var AI_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|📋|⏱)\s|(?:第\s*\d+\s*轮|Round\s+\d+)[：:]|⏳\s*(?:第\s*\d+\s*轮|Round\s+\d+)|📄\s+\[\[Agent Deck\/(?:派发|Answers|Conversations)\/|📝\s+\[\[Agent Deck\/派发\/)/i;
var AI_LINK_RE = /^\s*(?:[-*+]|\d+[.)])\s+🔗\s+(?:(?:子代理|side chat)\b|\[(?:Antigravity|Claude(?:\s+Code)?|Codex|DSH|DeepSeek(?:\s+Harness)?|WorkBuddy|OpenCode|Qoder|Cursor|Trae|Hermes(?:\s+Agent)?|MiniMax(?:\s+Code)?|Gemini(?:\s+CLI)?|Kimi(?:\s+Code)?|GrokBot|TeleAgent|T3Code|Cindy|Orca|Muse|Doubao|千问办公)[^\]]*\]\()/i;
var AI_QUESTION_RE = /^\s*(?:[-*+]|\d+[.)])\s+❓(?=\s|$)/;
var AI_QUESTION_SIGNAL_RE = /(?:(?:第\s*\d+\s*轮|Round\s+\d+)[：:]|\^ad-q-[a-z0-9-]+|<!--\s*ad-turn:)/i;
var USER_ANSWER_RE = /^\s*(?:[-*+]|\d+[.)])\s+✍️/;
var PROVENANCE_LINE_RE = /<!--\s*ad-(?:turn|summary(?:-pending)?|clock):[^>]+-->/i;
var LAYOUT_MARKER_RE = /^\s*<!--\s*agent-deck:(?:layout|section):[^>]+-->\s*$/i;
var CONVERSATION_EXPORT_RE = /^<!--\s*agent-deck-conversation\b/i;
var GENERATED_DEMO_RE = /^agent deck\/(?:功能示例|welcome)-[^/]+\.md$/i;
var GENERATED_FM_TYPE_RE = /^type:\s*["']?(?:派发载荷|dispatch-payload)["']?\s*$/i;
var GENERATED_FM_BY_RE = /^generated_by:\s*["']?agent-deck["']?\s*$/i;
var OKF_SUMMARY_KEYS = ["type", "description", "def", "domain", "category", "father", "status", "verified", "stale_after"];
function isInternalTaskBlockId(id) {
  return INTERNAL_BLOCK_ID_RE.test(String(id || "").trim());
}
function isLayoutMarkerLine(line) {
  return LAYOUT_MARKER_RE.test(String(line || ""));
}
function cleanUserNoteLine(line, { inFence = false } = {}) {
  if (inFence) return String(line ?? "");
  const raw = String(line ?? "");
  if (isLayoutMarkerLine(raw)) return "";
  let out = raw.replace(PROVENANCE_RE, "").replace(PIN_MARKER_RE, " ");
  const m = BLOCK_ID_SUFFIX_RE.exec(out);
  if (m && isInternalTaskBlockId(m[1])) out = out.replace(BLOCK_ID_SUFFIX_RE, "");
  return out.replace(/%%[^%]*?%%/g, "").replace(/[ \t]+$/, "");
}
function cleanUserNoteLines(lines, fenced = fencedLines(lines)) {
  return (lines || []).map((line, idx) => cleanUserNoteLine(line, { inFence: fenced.has(idx) }));
}
function unYamlStr2(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}
function parseListValue(raw) {
  if (Array.isArray(raw)) return raw.map((x) => unYamlStr2(x).trim()).filter(Boolean);
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1).split(/[,，]/).map((x) => unYamlStr2(x).trim()).filter(Boolean);
  }
  return s.split(/[,，]/).map((x) => unYamlStr2(x).trim()).filter(Boolean);
}
function parseFrontmatter(lines = []) {
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
        meta[key] = val.startsWith("[") && val.endsWith("]") ? parseListValue(val) : unYamlStr2(val);
      } else {
        activeKey = key;
        meta[key] = [];
      }
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && activeKey && Array.isArray(meta[activeKey])) {
      const v = unYamlStr2(item[1]).trim();
      if (v) meta[activeKey].push(v);
    }
  }
  return { fmEnd, meta };
}
function extractOkfSummaryParts(source, {
  keys = OKF_SUMMARY_KEYS,
  maxKeys = 9,
  maxValLen = 0
} = {}) {
  if (!source || typeof source !== "object") return [];
  const str = (v) => Array.isArray(v) ? String(v[0] ?? "").trim() : String(v ?? "").trim();
  const parts = [];
  const used = /* @__PURE__ */ new Set();
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
    const val = maxValLen > 0 && rawVal.length > maxValLen ? `${rawVal.slice(0, maxValLen - 1)}\u2026` : rawVal;
    parts.push(`${key}: ${val}`);
  }
  return parts;
}
function findHeadingRange(lines = [], headingName = "", {
  fenced = fencedLines(lines),
  caseInsensitive = true
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
function collectRemainingHeadings(lines = [], {
  fromIdx = 0,
  endIdx = lines.length,
  maxLevel = 4,
  maxItems = 6,
  fenced = fencedLines(lines),
  skipLines = null
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
function buildGeneratedMatchers({
  memoryDir = "Agent Deck/\u8BB0\u5FC6",
  dreamPath = "Agent Deck/\u957F\u671F\u8BB0\u5FC6.md",
  doneArchivePath = "Agent Deck/done/\u5DF2\u5B8C\u6210\u4EFB\u52A1.md"
} = {}) {
  const normLow = (p) => normalizeRelPath(p).toLowerCase();
  const memRel = normLow(memoryDir || "Agent Deck/\u8BB0\u5FC6") || "agent deck/\u8BB0\u5FC6";
  const dreamRel = normLow(dreamPath || "Agent Deck/\u957F\u671F\u8BB0\u5FC6.md") || "agent deck/\u957F\u671F\u8BB0\u5FC6.md";
  const doneRel = normLow(doneArchivePath || "Agent Deck/done/\u5DF2\u5B8C\u6210\u4EFB\u52A1.md") || "agent deck/done/\u5DF2\u5B8C\u6210\u4EFB\u52A1.md";
  const dirPrefixes = [.../* @__PURE__ */ new Set([
    "agent deck/\u6D3E\u53D1/",
    "agent deck/answers/",
    "agent deck/conversations/",
    "agent deck/exports/",
    "agent deck/\u4EFB\u52A1/",
    "agent deck/done/",
    "agent deck/\u8BB0\u5FC6/",
    `${memRel}/`
  ])];
  const exactPaths = /* @__PURE__ */ new Set([
    "agent deck/\u957F\u671F\u8BB0\u5FC6.md",
    "agent deck/\u5DE5\u4F5C\u53F0.md",
    "agent deck/\u5B89\u5168\u5BA1\u8BA1.md",
    "agent deck/\u8BB0\u5FC6-\u4F53\u68C0.md",
    "agent deck/done/\u5DF2\u5B8C\u6210\u4EFB\u52A1.md",
    dreamRel,
    doneRel
  ]);
  return {
    memRel,
    memoryDirPrefix: `${memRel}/`,
    dreamPathExact: dreamRel,
    dirPrefixes,
    exactPaths,
    key: `${memRel}|${dreamRel}|${doneRel}`
  };
}
function isGeneratedVaultFile(relPath, raw = "", matchers = buildGeneratedMatchers()) {
  const lowPath = normalizeRelPath(relPath).toLowerCase();
  if (!lowPath) return { isGenerated: false, isMemoryStore: false };
  const inMemoryDir = lowPath.startsWith(matchers.memoryDirPrefix) || lowPath.startsWith("agent deck/\u8BB0\u5FC6/");
  const isMemoryDoc = inMemoryDir || lowPath === matchers.dreamPathExact || lowPath === "agent deck/\u957F\u671F\u8BB0\u5FC6.md";
  if (isMemoryDoc) return { isGenerated: true, isMemoryStore: true };
  if (matchers.dirPrefixes.some((p) => lowPath.startsWith(p)) || matchers.exactPaths.has(lowPath) || GENERATED_DEMO_RE.test(lowPath)) {
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
function aiGeneratedLineIndices(lines = [], { startLine = 0 } = {}) {
  const skipped = /* @__PURE__ */ new Set();
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
        const w2 = width(line);
        if (w2 === 0) {
          stack.length = 0;
          fenceOwner = "user";
        } else {
          const owner2 = [...stack].reverse().find((item) => item.indent < w2);
          fenceOwner = owner2?.kind || "user";
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
      const isAiDirect = AI_AUTO_TASK_RE.test(line) || AI_RECORD_RE.test(line) || AI_LINK_RE.test(line) || isAiQuestion || PROVENANCE_LINE_RE.test(line);
      const kind = isUserAnswer ? "user" : isAiDirect ? "ai" : parent?.kind || "user";
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

// src/context-core/config.js
var CONFIG_DIRS = [".outline-journal", ".obsidian"];
var PLUGIN_REL_PARTS = ["plugins", "agent-deck"];
function stripWinPrefix(p) {
  return String(p || "").replace(/^(?:\\\\\?\\UNC\\|\/\/\?\/UNC\/)/i, "\\\\").replace(/^(?:\\\\\?\\|\/\/\?\/)/, "");
}
function realPathSafe(p) {
  const clean = stripWinPrefix(p);
  try {
    return stripWinPrefix((fs.realpathSync.native || fs.realpathSync)(clean));
  } catch {
    return path.resolve(clean);
  }
}
function resolveNearestRealPath(p) {
  const clean = stripWinPrefix(path.resolve(p));
  if (fs.existsSync(clean)) return realPathSafe(clean);
  const pending = [];
  let cur = clean;
  for (; ; ) {
    const up = path.dirname(cur);
    if (up === cur) return clean;
    pending.unshift(path.basename(cur));
    if (fs.existsSync(up)) return path.join(realPathSafe(up), ...pending);
    cur = up;
  }
}
function isPathContainedIn(rootReal, targetReal, { caseInsensitive = process.platform === "win32" } = {}) {
  const norm = (s) => caseInsensitive || process.platform === "win32" ? String(s).toLowerCase() : String(s);
  const r = norm(rootReal).replace(/[\\/]+$/, "");
  const t = norm(targetReal).replace(/[\\/]+$/, "");
  return t === r || t.startsWith(r + path.sep) || t.startsWith(`${r}/`);
}
var FS_CASE_CACHE = /* @__PURE__ */ new Map();
function isCaseInsensitiveFs(dirPath) {
  const clean = stripWinPrefix(dirPath || "");
  if (!clean || !fs.existsSync(clean)) return process.platform === "win32" || process.platform === "darwin";
  const key = realPathSafe(clean);
  if (FS_CASE_CACHE.has(key)) return FS_CASE_CACHE.get(key);
  let insensitive = process.platform === "win32" || process.platform === "darwin";
  try {
    let probePath = key;
    const base = path.basename(key);
    let swappedBase = /[a-z]/.test(base) ? base.replace(/[a-z]/, (c) => c.toUpperCase()) : /[A-Z]/.test(base) ? base.replace(/[A-Z]/, (c) => c.toLowerCase()) : "";
    let probeCandidate = swappedBase ? path.join(path.dirname(key), swappedBase) : "";
    if (!swappedBase) {
      const firstAscii = fs.readdirSync(key).find((n) => /[A-Za-z]/.test(n));
      if (firstAscii) {
        probePath = path.join(key, firstAscii);
        swappedBase = /[a-z]/.test(firstAscii) ? firstAscii.replace(/[a-z]/, (c) => c.toUpperCase()) : firstAscii.replace(/[A-Z]/, (c) => c.toLowerCase());
        probeCandidate = path.join(key, swappedBase);
      }
    }
    if (probeCandidate && probeCandidate !== probePath) {
      const stOrig = fs.statSync(probePath);
      try {
        const stFlip = fs.statSync(probeCandidate);
        insensitive = stOrig.dev === stFlip.dev && stOrig.ino === stFlip.ino;
      } catch {
        insensitive = false;
      }
    }
  } catch {
  }
  FS_CASE_CACHE.set(key, insensitive);
  return insensitive;
}
function readVaultFileStrict(vaultRoot, relPath, { realVault = "" } = {}) {
  const rootReal = realVault || realPathSafe(vaultRoot);
  const parts = String(relPath || "").split("/").filter(Boolean);
  let cur = rootReal;
  for (const seg of parts) {
    if (seg === "." || seg === "..") throw new Error(`\u975E\u6CD5\u8DEF\u5F84\u6BB5\uFF1A${relPath}`);
    cur = path.join(cur, seg);
    const lst = fs.lstatSync(cur);
    if (lst.isSymbolicLink()) throw new Error(`\u62D2\u7EDD\u8BFB\u53D6\u7B26\u53F7\u94FE\u63A5\u8DEF\u5F84\uFF1A${relPath}`);
  }
  const actualReal = realPathSafe(cur);
  if (!isPathContainedIn(rootReal, actualReal, { caseInsensitive: isCaseInsensitiveFs(rootReal) })) {
    throw new Error(`\u76EE\u6807\u8DEF\u5F84\u8D8A\u754C\uFF08\u8D85\u51FA Vault \u6839\u76EE\u5F55\uFF09\uFF1A${relPath}`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(cur, flags);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`\u76EE\u6807\u4E0D\u662F\u5E38\u89C4\u6587\u4EF6\uFF1A${relPath}`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
function hasHostConfigDir(dir) {
  return CONFIG_DIRS.some((cfg) => fs.existsSync(path.join(dir, cfg)));
}
function resolveVault(start) {
  const candidates = [];
  if (start) {
    candidates.push(path.resolve(start));
    candidates.push(realPathSafe(start));
  } else {
    if (process.argv[1]) {
      const argDir = path.dirname(path.resolve(process.argv[1]));
      candidates.push(argDir, realPathSafe(argDir));
    }
    try {
      const selfDir = path.dirname(fileURLToPath(import.meta.url));
      candidates.push(selfDir, realPathSafe(selfDir));
    } catch {
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const root of candidates) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    let cur = root;
    for (; ; ) {
      if (hasHostConfigDir(cur)) return cur;
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }
  return "";
}
function parsePluginConfigFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.settings && typeof parsed.settings === "object" && (parsed.settings.dream || parsed.settings.delegate)) {
      return parsed.settings;
    }
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}
function readPluginConfig(vault, { configDir = "" } = {}) {
  const cleanVault = String(vault || "").trim();
  if (!cleanVault) return {};
  if (configDir) {
    const cleanDir = normalizeRelPath(configDir);
    if (cleanDir) {
      const target = path.join(cleanVault, cleanDir, ...PLUGIN_REL_PARTS, "data.json");
      return parsePluginConfigFile(target) || {};
    }
  }
  const found = [];
  for (const dirName of CONFIG_DIRS) {
    const target = path.join(cleanVault, dirName, ...PLUGIN_REL_PARTS, "data.json");
    try {
      const st = fs.statSync(target);
      if (st.isFile()) found.push({ target, mtimeMs: st.mtimeMs || 0 });
    } catch {
    }
  }
  if (!found.length) return {};
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of found) {
    const cfg = parsePluginConfigFile(item.target);
    if (cfg) return cfg;
  }
  return {};
}
function memoryDirOf(vault, opts = {}) {
  const dir = normalizeRelPath(readPluginConfig(vault, opts)?.dream?.dir || "");
  const candidate = path.join(vault, ...dir ? dir.split("/") : MEMORY_DIR_DEFAULT.split("/"));
  const realVault = realPathSafe(vault);
  const realCand = resolveNearestRealPath(candidate);
  if (!isPathContainedIn(realVault, realCand, { caseInsensitive: isCaseInsensitiveFs(realVault) })) {
    throw new Error(`\u8BB0\u5FC6\u76EE\u5F55\u8D8A\u754C\uFF08\u6307\u5411 Vault \u5916\uFF09\uFF1A${candidate}`);
  }
  return candidate;
}
function excludedDirsOf(vault, opts = {}) {
  return normalizeExcludedDirs(readPluginConfig(vault, opts)?.delegate?.excludedDirs || []);
}
function mcpSettingsOf(vault, opts = {}) {
  const raw = readPluginConfig(vault, opts)?.dream?.mcp || {};
  return {
    toolsMode: raw.toolsMode === "memory-only" ? "memory-only" : "all",
    allowWrite: Boolean(raw.allowWrite),
    excludeAiLogs: raw.excludeAiLogs !== false,
    agentPrompt: typeof raw.agentPrompt === "string" ? raw.agentPrompt : ""
  };
}
function isMainModule(metaUrl) {
  try {
    if (!process.argv[1]) return false;
    const real = (p) => {
      let s;
      try {
        s = (fs.realpathSync.native || fs.realpathSync)(p);
      } catch {
        s = path.resolve(p);
      }
      s = stripWinPrefix(s).replace(/\\/g, "/");
      return process.platform === "win32" ? s.toLowerCase() : s;
    };
    return real(process.argv[1]) === real(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

// src/context-core/memory-ops.js
import fs2 from "node:fs";
import path2 from "node:path";
var MAX_OUTPUT = 6e3;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var KIND_BY_LABEL2 = { \u4E8B\u5B9E: "fact", \u504F\u597D: "preference", \u5F85\u9A8C\u8BC1\u89C4\u5F8B: "pattern", \u9879\u76EE\u7ECF\u9A8C: "lesson" };
var LABEL_BY_KIND = { fact: "\u4E8B\u5B9E", preference: "\u504F\u597D", pattern: "\u5F85\u9A8C\u8BC1\u89C4\u5F8B", lesson: "\u9879\u76EE\u7ECF\u9A8C" };
var TRUST_ALIASES = {
  human: "human-reviewed",
  "human-reviewed": "human-reviewed",
  user: "user-authored",
  "user-authored": "user-authored",
  ai: "ai-derived",
  "ai-derived": "ai-derived"
};
var normProject = normalizeProjectKey;
var stripLink = (raw) => normalizeLinkName(raw);
var sourceLink = (raw) => (/^\[\[[^\]]+\]\]/.exec(String(raw || "").trim()) || [])[0] || "";
var linkTarget = (link) => String(link || "").replace(/^\[\[|\]\]$/g, "").split("#")[0].trim();
function parseMemory(content) {
  const parsed = parseMemoryFile(content);
  if (!parsed) return null;
  if (!parsed.sourceNotes?.length && parsed.sources?.length) {
    parsed.sourceNotes = parsed.sources.map(sourceLink).filter(Boolean);
  }
  return parsed;
}
function countArchivedMemories(vault, opts = {}) {
  const archiveDir = path2.join(memoryDirOf(vault, opts), MEMORY_ARCHIVE_SUBDIR);
  try {
    return fs2.readdirSync(archiveDir).filter((n) => n.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
function loadMemories(vault, { includeArchived = false, configDir = "" } = {}) {
  const dir = memoryDirOf(vault, { configDir });
  let names = [];
  try {
    names = fs2.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "\u7D22\u5F15.md" && n !== MEMORY_LOG_FILE);
  } catch {
    return { dir, entries: [] };
  }
  const entries = [];
  for (const name of names.sort()) {
    try {
      const abs = path2.join(dir, name);
      const raw = fs2.readFileSync(abs, "utf8");
      if (isPrivateFrontmatter(raw)) continue;
      const parsed = parseMemory(raw);
      if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs });
    } catch {
    }
  }
  if (includeArchived) {
    const archiveDir = path2.join(dir, MEMORY_ARCHIVE_SUBDIR);
    let archNames = [];
    try {
      archNames = fs2.readdirSync(archiveDir).filter((n) => n.endsWith(".md"));
    } catch {
      archNames = [];
    }
    for (const name of archNames.sort()) {
      try {
        const abs = path2.join(archiveDir, name);
        const raw = fs2.readFileSync(abs, "utf8");
        if (isPrivateFrontmatter(raw)) continue;
        const parsed = parseMemory(raw);
        if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs, archived: true });
      } catch {
      }
    }
  }
  return { dir, entries };
}
var activeMemories = (entries) => entries.filter((e) => e.state === "\u6709\u6548" && !e.private);
function matchesProject(entry, wantProj) {
  if (!wantProj) return true;
  if (normProject(entry.project || entry.appliesTo).includes(wantProj)) return true;
  if (normProject(stripLink(entry.projectLink)).includes(wantProj)) return true;
  if ((entry.concepts || []).some((c) => normProject(stripLink(c)).includes(wantProj))) return true;
  if (normProject(entry.text).includes(wantProj)) return true;
  return false;
}
function isUniversalMemory(entry) {
  return !entry.project && !entry.appliesTo && !entry.projectLink && (entry.kind === "lesson" || entry.kind === "preference");
}
function searchMemories(entries, query, k = 5, { kind = "", project = "", verifiedOnly = false, includeStale = false, trust = "", nowMs = Date.now() } = {}) {
  const wanted = terms(query);
  if (!wanted.size) return [];
  const wantKind = KIND_BY_LABEL2[kind] || kind;
  const wantProj = normProject(project);
  const wantTrust = TRUST_ALIASES[String(trust || "").trim().toLowerCase()] || "";
  const pool = entries.filter((e) => {
    if (!e || e.private) return false;
    if (String(e.status || "").toLowerCase() === "rejected" || String(e.verdict || "").toLowerCase() === "refuted") return false;
    if (!includeStale && isMemoryStale(e, nowMs)) return false;
    if (wantKind && e.kind !== wantKind) return false;
    if (verifiedOnly && !e.verified) return false;
    if (wantTrust && (e.trust || deriveTrustLevel(e)) !== wantTrust) return false;
    if (wantProj && !matchesProject(e, wantProj) && !isUniversalMemory(e)) return false;
    return true;
  });
  if (!pool.length) return [];
  const idf = pool.length >= 6 ? computeIdfMap(pool) : null;
  const singleTokenQuery = wanted.size === 1;
  const shortCjkQuery = wanted.size <= 2 && [...wanted].every((w) => /^[\u4e00-\u9fff]{2}$/.test(w));
  const scored = [];
  for (const entry of pool) {
    const textTerms = terms(entry.text);
    const metaTerms = entryMetaTerms(entry);
    const textHits = [...textTerms].filter((w) => wanted.has(w) && !STOP_CJK.has(w));
    const metaHits = [...metaTerms].filter((w) => wanted.has(w) && !textTerms.has(w) && !STOP_CJK.has(w));
    const projectMatch = Boolean(wantProj && (normProject(entry.project || entry.appliesTo) === wantProj || normProject(stripLink(entry.projectLink)) === wantProj || matchesProject(entry, wantProj)));
    const entryConceptLabels = [
      ...(entry.concepts || []).map(stripLink),
      ...entry.projectLink ? [stripLink(entry.projectLink)] : []
    ].filter(Boolean);
    const lowQuery = String(query || "").toLowerCase();
    const conceptMatch = entryConceptLabels.find((c) => {
      const lc = c.toLowerCase();
      return lc.length >= 2 && (/^[a-z0-9_.-]+$/.test(lc) ? new RegExp(`(?<![a-z0-9])${lc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(lowQuery) : lowQuery.includes(lc));
    });
    const hasHybrid = textHits.some(isHybridTerm);
    const hasDistinctiveLatin = textHits.some(isDistinctiveLatinTerm);
    const qualified = textHits.length >= 2 || singleTokenQuery && (textHits.length >= 1 || metaHits.length >= 1) || shortCjkQuery && (textHits.length >= 1 || metaHits.length >= 1) || hasHybrid || hasDistinctiveLatin && textHits.length >= 1 || textHits.length >= 1 && metaHits.length >= 1 || Boolean(conceptMatch) || projectMatch && (textHits.length >= 1 || metaHits.length >= 1);
    if (!qualified) continue;
    const { overlappedOnly } = analyzeTextHits(entry.text, wanted);
    const wgt = (w) => {
      const base = idf?.get(w) ?? 1;
      const damp = overlappedOnly.has(w) ? 0.5 : 1;
      if (isHybridTerm(w)) return base * 1.4 * damp;
      if (isDistinctiveLatinTerm(w)) return base * 1.15 * damp;
      return base * damp;
    };
    let score = textHits.reduce((s, w) => s + wgt(w), 0) + 0.6 * metaHits.reduce((s, w) => s + wgt(w), 0);
    const matchedTerms = /* @__PURE__ */ new Set([...textHits, ...metaHits]);
    if (wanted.size >= 2 && matchedTerms.size >= 1) {
      score *= 1 + 0.35 * Math.min(1, matchedTerms.size / Math.min(wanted.size, 6));
    }
    if (conceptMatch) score += textHits.length ? 1.8 : 3;
    score /= 1 + Math.max(0, textTerms.size - 24) * 0.015;
    const tLevel = entry.trust || deriveTrustLevel(entry);
    if (tLevel === "human-reviewed") score *= 1.35;
    else if (tLevel === "ai-derived") score *= 0.72;
    if (entry.kind === "pattern" && entry.verdict !== "confirmed") score *= 0.85;
    if (!entry.verified && PROPOSAL_ONLY_RE.test(String(entry.text || ""))) score *= 0.42;
    if (isMemoryStale(entry, nowMs)) score *= 0.35;
    if (projectMatch) score *= 1.35;
    else if (wantProj && isUniversalMemory(entry)) score *= 0.85;
    if (wantProj && (entry.kind === "lesson" || entry.type === "\u9879\u76EE\u7ECF\u9A8C")) score *= 1.15;
    const why = [.../* @__PURE__ */ new Set([...textHits, ...metaHits])];
    if (conceptMatch && !why.includes(`\u56FE\u8C31:${conceptMatch}`)) why.push(`\u56FE\u8C31:${conceptMatch}`);
    scored.push({ entry, why, score });
  }
  return scored.sort((a, b) => b.score - a.score || String(b.entry.date).localeCompare(String(a.entry.date)) || a.entry.name.localeCompare(b.entry.name)).slice(0, Math.max(1, k)).map(({ entry, why }) => ({ entry, why }));
}
var inDateRange = (entry, { since = "", until = "" } = {}) => {
  if (!since && !until) return true;
  const day = String(entry?.date || "");
  if (!DATE_RE.test(day)) return false;
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
};
function buildIndexes(entries = []) {
  const byId = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  const supersededBy = /* @__PURE__ */ new Map();
  const resolveRef = (raw) => {
    const clean = stripLink(raw);
    if (!clean) return null;
    if (/^m-[a-f0-9]+$/i.test(clean) && byId.has(clean)) return byId.get(clean);
    const base = clean.split("/").pop();
    return byId.get(clean) || byName.get(base) || null;
  };
  for (const e of entries) {
    if (e.id) byId.set(e.id, e);
    if (e.name) byName.set(e.name, e);
  }
  const addSupersededBy = (oldKey, cur) => {
    if (!oldKey || !cur) return;
    if (!supersededBy.has(oldKey)) supersededBy.set(oldKey, []);
    if (!supersededBy.get(oldKey).includes(cur)) supersededBy.get(oldKey).push(cur);
  };
  for (const e of entries) {
    for (const old of e.supersedes || []) {
      const target = resolveRef(old);
      if (target) {
        addSupersededBy(target.id, e);
        addSupersededBy(target.name, e);
      } else {
        addSupersededBy(old, e);
      }
    }
    if (e.id && e.supersededBy) {
      const repl = resolveRef(e.supersededBy);
      if (repl) {
        addSupersededBy(e.id, repl);
        if (e.name) addSupersededBy(e.name, repl);
      }
    }
  }
  return { byId, byName, resolveRef, supersededBy };
}
function notePathOf(vault, target) {
  const rel = String(target || "").trim().replace(/\\/g, "/");
  if (!vault || !rel || rel.split("/").includes("..")) return "";
  const excluded = excludedDirsOf(vault);
  for (const candidate of [`${rel}.md`, rel]) {
    if (isPathExcluded(candidate, excluded)) return "";
    const abs = path2.join(vault, ...candidate.split("/").filter(Boolean));
    try {
      if (fs2.existsSync(abs) && fs2.statSync(abs).isFile()) {
        if (isPrivateFrontmatter(fs2.readFileSync(abs, "utf8"))) return "";
        return abs;
      }
    } catch {
    }
  }
  return "";
}
function neighborsOf(entries = [], entry = null, { vault = "", limit = 2 } = {}) {
  if (!entry) return { coConcept: [], coCitation: [], notes: [] };
  const mineConcepts = new Set([...(entry.concepts || []).map(stripLink), ...entry.projectLink ? [stripLink(entry.projectLink)] : []].filter(Boolean));
  const coConcept = [];
  if (mineConcepts.size) {
    for (const other of entries) {
      if (other === entry || other.name === entry.name) continue;
      const otherC = [...(other.concepts || []).map(stripLink), ...other.projectLink ? [stripLink(other.projectLink)] : []];
      const sharedC = otherC.filter((c) => mineConcepts.has(c));
      if (sharedC.length) coConcept.push({ entry: other, shared: [...new Set(sharedC)] });
    }
    coConcept.sort((a, b) => b.shared.length - a.shared.length || String(b.entry.date).localeCompare(String(a.entry.date)));
    coConcept.length = Math.min(coConcept.length, limit);
  }
  const mine = new Set((entry.sourceNotes?.length ? entry.sourceNotes : entry.sources.map(sourceLink)).map(linkTarget).filter(Boolean));
  const coCitation = [];
  for (const other of entries) {
    if (other === entry || other.name === entry.name) continue;
    const otherSrcs = (other.sourceNotes?.length ? other.sourceNotes : other.sources.map(sourceLink)).map(linkTarget);
    const shared = otherSrcs.filter((t) => t && mine.has(t));
    if (shared.length) coCitation.push({ entry: other, shared });
  }
  coCitation.sort((a, b) => b.shared.length - a.shared.length || String(b.entry.date).localeCompare(String(a.entry.date)));
  coCitation.length = Math.min(coCitation.length, limit);
  const notes = [...mine].map((t) => notePathOf(vault, t)).filter(Boolean).slice(0, limit);
  return { coConcept, coCitation, notes };
}
function graphOf(entries = [], ref = "", { vault = "", depth = 2 } = {}) {
  const clean = stripLink(ref);
  if (!clean) return null;
  const activePool = activeMemories(entries);
  const indexes = buildIndexes(entries);
  const seedEntry = indexes.resolveRef(clean) || entries.find((e) => e.name === clean) || null;
  const conceptsOf = (e) => [...new Set([...(e?.concepts || []).map(stripLink), ...e?.projectLink ? [stripLink(e.projectLink)] : []].filter(Boolean))];
  if (seedEntry) {
    const near = neighborsOf(activePool, seedEntry, { vault, limit: 6 });
    const seedConcepts = conceptsOf(seedEntry);
    const hop22 = [];
    if (depth >= 2 && seedConcepts.length) {
      const seenNames = /* @__PURE__ */ new Set([seedEntry.name, ...near.coConcept.map((x) => x.entry.name)]);
      for (const c of near.coConcept) {
        for (const cName of conceptsOf(c.entry)) {
          if (seedConcepts.includes(cName)) continue;
          for (const other of activePool) {
            if (seenNames.has(other.name)) continue;
            if (conceptsOf(other).includes(cName)) {
              seenNames.add(other.name);
              hop22.push({ entry: other, via: `${c.shared[0]} \u2192 ${cName}` });
              if (hop22.length >= 6) break;
            }
          }
          if (hop22.length >= 6) break;
        }
        if (hop22.length >= 6) break;
      }
    }
    return {
      mode: "memory",
      target: seedEntry,
      concepts: seedConcepts,
      supersedes: (seedEntry.supersedes || []).map((id) => indexes.resolveRef(id) || id),
      supersededBy: indexes.supersededBy.get(seedEntry.id) || indexes.supersededBy.get(seedEntry.name) || [],
      conflicts: (seedEntry.conflictsWith || []).map((c) => indexes.resolveRef(c) || c),
      near,
      hop2: hop22
    };
  }
  const want = normProject(clean);
  const hop1 = activePool.filter((e) => conceptsOf(e).some((c) => normProject(c) === want || c.toLowerCase() === clean.toLowerCase()));
  if (!hop1.length) return { mode: "concept", concept: clean, hop1: [], hop2: [], notePath: notePathOf(vault, clean) };
  const hop2 = [];
  if (depth >= 2) {
    const seen = new Set(hop1.map((e) => e.name));
    const bridgeConcepts = /* @__PURE__ */ new Set();
    for (const e of hop1) for (const c of conceptsOf(e)) if (normProject(c) !== want) bridgeConcepts.add(c);
    for (const bc of bridgeConcepts) {
      for (const e of activePool) {
        if (seen.has(e.name)) continue;
        if (conceptsOf(e).includes(bc)) {
          seen.add(e.name);
          hop2.push({ entry: e, via: `${clean} \u2192 ${bc}` });
          if (hop2.length >= 6) break;
        }
      }
      if (hop2.length >= 6) break;
    }
  }
  return { mode: "concept", concept: clean, hop1, hop2, notePath: notePathOf(vault, clean) };
}
function formatGraph(g) {
  if (!g) return "\u7F3A\u5C11\u67E5\u8BE2\u76EE\u6807\uFF08\u8BB0\u5FC6\u6587\u4EF6\u540D\u3001id \u6216\u6982\u5FF5\u540D\uFF09";
  if (g.mode === "concept") {
    if (!g.hop1.length) return `\u56FE\u8C31\u4E2D\u6682\u65E0\u8FDE\u63A5\u5230\u300C${g.concept}\u300D\u7684\u8BB0\u5FC6${g.notePath ? `\uFF08\u6982\u5FF5\u6587\u4EF6\uFF1A${g.notePath}\uFF09` : ""}\u3002`;
    const rows2 = [`\u6982\u5FF5\u56FE\u8C31\uFF1A[[${g.concept}]]${g.notePath ? `\uFF08${g.notePath}\uFF09` : ""}`];
    rows2.push(`\u4E00\u8DF3\u5173\u8054\u8BB0\u5FC6\uFF08${g.hop1.length} \u6761\uFF09\uFF1A`);
    for (const e2 of g.hop1.slice(0, 10)) rows2.push(`- [[${e2.name}]] [${e2.type || e2.kind}] ${e2.text}`);
    if (g.hop2.length) {
      rows2.push(`\u4E8C\u8DF3\u6269\u5C55\u8BB0\u5FC6\uFF08${g.hop2.length} \u6761\uFF09\uFF1A`);
      for (const item of g.hop2) rows2.push(`- [[${item.entry.name}]]\uFF08\u7ECF\u7531 ${item.via}\uFF09${item.entry.text}`);
    }
    return rows2.join("\n");
  }
  const e = g.target;
  const rows = [`\u8BB0\u5FC6\u56FE\u8C31\uFF1A[[${e.name}]] [${e.type || e.kind}] ${e.text}`];
  if (g.concepts.length) rows.push(`\u6982\u5FF5\u951A\u70B9\uFF1A${g.concepts.map((c) => `[[${c}]]`).join("\u3001")}`);
  if (e.projectLink) rows.push(`\u9879\u76EE\u8282\u70B9\uFF1A${e.projectLink}`);
  if (g.supersedes.length) rows.push(`\u53D6\u4EE3\uFF1A${g.supersedes.map((x) => typeof x === "string" ? x : `[[${x.name}]]`).join("\u3001")}`);
  if (g.supersededBy.length) rows.push(`\u5DF2\u88AB\u53D6\u4EE3\uFF1A${g.supersededBy.map((x) => `[[${x.name}]]`).join("\u3001")}`);
  if (g.conflicts.length) rows.push(`\u51B2\u7A81\u8FB9\uFF1A${g.conflicts.map((x) => typeof x === "string" ? x : `[[${x.name}]]`).join("\u3001")}`);
  if (g.near.coConcept.length) {
    rows.push("\u540C\u6982\u5FF5\u8BB0\u5FC6\uFF081 \u8DF3\uFF09\uFF1A");
    for (const c of g.near.coConcept) rows.push(`- [[${c.entry.name}]]\uFF08\u5171\u4EAB ${c.shared.map((s) => `[[${s}]]`).join("\u3001")}\uFF09\uFF1A${c.entry.text}`);
  }
  if (g.near.coCitation.length) {
    rows.push("\u540C\u6E90\u8BB0\u5FC6\uFF081 \u8DF3\uFF09\uFF1A");
    for (const c of g.near.coCitation) rows.push(`- [[${c.entry.name}]]\uFF08\u540C\u5F15 ${c.shared[0]}\uFF09\uFF1A${c.entry.text}`);
  }
  if (g.hop2.length) {
    rows.push("\u4E8C\u8DF3\u6269\u6563\u8BB0\u5FC6\uFF1A");
    for (const item of g.hop2) rows.push(`- [[${item.entry.name}]]\uFF08\u7ECF\u7531 ${item.via}\uFF09\uFF1A${item.entry.text}`);
  }
  if (g.near.notes.length) rows.push(`\u539F\u6587\u7B14\u8BB0\uFF1A${g.near.notes.join("\u3001")}`);
  return rows.join("\n");
}
function recentMemories(entries, n = 10, { kind = "", project = "", verifiedOnly = false, includeStale = true, trust = "", nowMs = Date.now() } = {}) {
  const wantKind = KIND_BY_LABEL2[kind] || kind;
  const wantProj = normProject(project);
  const wantTrust = TRUST_ALIASES[String(trust || "").trim().toLowerCase()] || "";
  return [...entries].filter((e) => {
    if (wantKind && e.kind !== wantKind) return false;
    if (verifiedOnly && !e.verified) return false;
    if (wantTrust && (e.trust || deriveTrustLevel(e)) !== wantTrust) return false;
    if (!includeStale && isMemoryStale(e, nowMs)) return false;
    if (wantProj && !matchesProject(e, wantProj)) return false;
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name)).slice(0, Math.max(1, n));
}
function findMemory(entries, dir, ref) {
  const raw = String(ref || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  if (/^m-[a-f0-9]+$/i.test(raw)) return entries.find((e) => e.id === raw) || null;
  const want = raw.replace(/^\[\[|\]\]$/g, "").split("|")[0].trim().replace(/\.md$/, "");
  if (!want || want.split("/").includes("..")) return null;
  const dirNorm = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  let relWant = want;
  const segs = want.split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 1; i--) {
    const prefix = segs.slice(0, i).join("/");
    if (dirNorm.endsWith(`/${prefix}`) || dirNorm === prefix) {
      relWant = segs.slice(i).join("/");
      break;
    }
  }
  const abs = path2.resolve(dir, relWant);
  const absArchive = path2.resolve(dir, MEMORY_ARCHIVE_SUBDIR, path2.basename(relWant));
  const insideMain = abs === path2.join(dir, path2.basename(abs));
  const insideArchive = abs === absArchive;
  if (!insideMain && !insideArchive) return null;
  return entries.find((e) => e.path === abs) || entries.find((e) => e.name === path2.basename(relWant)) || null;
}
var formatEntry = (entry, why = [], extra = {}) => {
  const tLevel = entry.trust || deriveTrustLevel(entry);
  const staleBadge = isMemoryStale(entry) ? " [\u5DF2\u8FC7\u590D\u6838\u671F]" : "";
  const archBadge = entry.archived ? " [\u5DF2\u5F52\u6863]" : "";
  const verifiedBadge = tLevel === "human-reviewed" ? " \u2713" : tLevel === "ai-derived" ? " [AI\u63D0\u70BC\xB7\u672A\u786E\u8BA4]" : "";
  const projBadge = entry.project ? ` [${entry.project}]` : "";
  const rows = [
    `${entry.date || "\u65E0\u65E5\u671F"} [${entry.type || entry.kind}]${projBadge}${verifiedBadge}${staleBadge}${archBadge} ${entry.text}`,
    `   \u6587\u4EF6\uFF1A${entry.path}`
  ];
  if (entry.description) rows.push(`   \u63CF\u8FF0\uFF1A${entry.description}`);
  if (entry.concepts?.length) rows.push(`   \u6982\u5FF5\uFF1A${entry.concepts.join("\u3001")}`);
  if (entry.projectLink) rows.push(`   \u9879\u76EE\u94FE\uFF1A${entry.projectLink}`);
  if (entry.conflictsWith?.length) rows.push(`   \u51B2\u7A81\uFF1A${entry.conflictsWith.join("\u3001")}`);
  if (why.length) rows.push(`   \u547D\u4E2D\uFF1A${why.join("\u3001")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push(`   \u6765\u6E90\uFF1A${links.join("\u3001")}`);
  const replaced = (extra.supersedes || []).map((old) => typeof old === "string" ? old : `[[${old.name}]]\uFF08${old.date || "\u65E0\u65E5\u671F"}\uFF09`);
  if (replaced.length) rows.push(`   \u53D6\u4EE3\uFF1A${replaced.join("\u3001")}`);
  const supersededBy = (extra.supersededBy || []).map((cur) => `[[${cur.name}]]\uFF08${cur.date || "\u65E0\u65E5\u671F"}\uFF09`);
  if (!supersededBy.length && entry.supersededBy) supersededBy.push(entry.supersededBy);
  if (supersededBy.length) rows.push(`   \u5DF2\u88AB\u53D6\u4EE3\uFF1A${supersededBy.join("\u3001")}`);
  const near = extra.neighbors || {};
  const nearBits = [];
  for (const c of near.coConcept || []) nearBits.push(`\u540C\u6982\u5FF5 [[${c.entry.name}]]\uFF08${c.shared.join("\u3001")}\uFF09`);
  for (const c of near.coCitation || []) nearBits.push(`\u540C\u6E90 [[${c.entry.name}]]${c.shared?.length ? `\uFF08\u540C\u5F15 ${c.shared[0]}\uFF09` : ""}`);
  for (const note of near.notes || []) nearBits.push(`\u539F\u6587 ${note}`);
  if (nearBits.length) rows.push(`   \u90BB\u63A5\uFF1A${nearBits.join("\uFF1B")}`);
  return rows.join("\n");
};
function formatRead(entry) {
  const tLevel = entry.trust || deriveTrustLevel(entry);
  const rows = [
    `\u8BB0\u5FC6\uFF1A${entry.text}`,
    `\u6587\u4EF6\uFF1A${entry.path}`,
    `\u7C7B\u578B\uFF1A${entry.type || entry.kind}\u3000\u72B6\u6001\uFF1A${entry.state}\uFF08${entry.status || STATE_TO_STATUS[entry.state] || "active"}\uFF09\u3000\u53EF\u4FE1\u5EA6\uFF1A${tLevel}\u3000\u65E5\u671F\uFF1A${entry.date || "\u65E0"}${entry.project ? `\u3000\u9879\u76EE\uFF1A${entry.project}` : ""}${entry.verified ? "\u3000\u5DF2\u9A8C\u8BC1" : ""}`
  ];
  if (entry.description) rows.push(`\u63CF\u8FF0\uFF1A${entry.description}`);
  if (entry.tags?.length) rows.push(`\u6807\u7B7E\uFF1A${entry.tags.join("\u3001")}`);
  if (entry.staleAfter || entry.validUntil) rows.push(`\u590D\u6838\u622A\u6B62\uFF1A${entry.staleAfter || entry.validUntil}`);
  if (entry.supersedes.length) rows.push(`\u66FF\u4EE3\uFF1A${entry.supersedes.join("\uFF1B")}`);
  if (entry.supersededBy) rows.push(`\u88AB\u53D6\u4EE3\uFF1A${entry.supersededBy}`);
  if (entry.conflictsWith?.length) rows.push(`\u51B2\u7A81\uFF1A${entry.conflictsWith.join("\u3001")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push("\u6765\u6E90\uFF1A", ...links.map((l) => `- ${l}`));
  rows.push("\u6B63\u6587\uFF1A", entry.text);
  if (entry.evidence.length) rows.push("\u8BC1\u636E\uFF1A", ...entry.evidence.map((e) => `- ${e}`));
  return rows.join("\n");
}
function withBudget(blocks, maxOutput = MAX_OUTPUT) {
  const out = [];
  let size = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (size + blocks[i].length + 1 > maxOutput) {
      out.push(`\uFF08\u5DF2\u7701\u7565 ${blocks.length - i} \u6761\uFF0C\u7528 --k \u7F29\u5C0F\u8303\u56F4\u6216\u76F4\u63A5 read \u5177\u4F53\u6587\u4EF6\uFF09`);
      return out.join("\n");
    }
    out.push(blocks[i]);
    size += blocks[i].length + 1;
  }
  return out.join("\n");
}
function formatIndex(entries = [], { kind = "", project = "", limit = 30 } = {}) {
  const wantKind = KIND_BY_LABEL2[kind] || kind;
  const wantProj = normProject(project);
  const filtered = activeMemories(entries).filter((e) => {
    if (wantKind && e.kind !== wantKind) return false;
    if (wantProj && !matchesProject(e, wantProj)) return false;
    return true;
  });
  const byKind = { lesson: 0, preference: 0, fact: 0, pattern: 0 };
  const projects = /* @__PURE__ */ new Map();
  const conceptCounts = /* @__PURE__ */ new Map();
  let verified = 0;
  for (const e of filtered) {
    if (Object.hasOwn(byKind, e.kind)) byKind[e.kind]++;
    if (e.verified) verified++;
    if (e.project) projects.set(e.project, (projects.get(e.project) || 0) + 1);
    const seenConcept = /* @__PURE__ */ new Set();
    for (const raw of [...e.concepts || [], ...e.projectLink ? [e.projectLink] : []]) {
      const name = stripLink(raw);
      const lk = name.toLowerCase();
      if (!name || seenConcept.has(lk)) continue;
      seenConcept.add(lk);
      conceptCounts.set(name, (conceptCounts.get(name) || 0) + 1);
    }
  }
  const head = [
    `\u5171 ${filtered.length} \u6761\u6709\u6548\u8BB0\u5FC6\uFF08\u5DF2\u786E\u8BA4 ${verified} \u6761\uFF09`,
    `\u5206\u5E03\uFF1A\u9879\u76EE\u7ECF\u9A8C ${byKind.lesson} \xB7 \u504F\u597D ${byKind.preference} \xB7 \u4E8B\u5B9E ${byKind.fact} \xB7 \u5F85\u9A8C\u8BC1\u89C4\u5F8B ${byKind.pattern}`
  ];
  if (projects.size) {
    head.push(`\u9879\u76EE\uFF1A${[...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, c]) => `${p}(${c})`).join("\u3001")}`);
  }
  if (conceptCounts.size) {
    head.push(`\u9AD8\u9891\u6982\u5FF5\uFF1A${[...conceptCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([c, n]) => `[[${c}]](${n})`).join(" \xB7 ")}`);
  }
  const sorted = [...filtered].sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
  const rows = sorted.slice(0, Math.max(1, limit)).map((e) => {
    const tLevel = e.trust || deriveTrustLevel(e);
    const mark = isMemoryStale(e) ? "\u26A0 " : tLevel === "human-reviewed" ? "\u2713 " : tLevel === "ai-derived" ? "[AI] " : "";
    const proj = e.project ? `[${e.project}] ` : "";
    return `- ${e.date || "\u2014"} [${e.type || e.kind}] ${mark}${proj}${e.text} (${e.name})`;
  });
  if (sorted.length > rows.length) rows.push(`\uFF08\u5DF2\u7701\u7565 ${sorted.length - rows.length} \u6761\uFF0C\u7528 search \u5173\u952E\u8BCD\u6216 --project/--kind \u7F29\u5C0F\u8303\u56F4\uFF09`);
  return withBudget([...head, "", ...rows]);
}
function formatStats(entries = [], { vault = "", archivedCount = 0 } = {}) {
  const byState = { \u6709\u6548: 0, \u5DF2\u62D2\u7EDD: 0, \u5DF2\u88AB\u66FF\u4EE3: 0 };
  const byKind = { lesson: 0, preference: 0, fact: 0, pattern: 0 };
  const byProv = { user: 0, ai: 0, mixed: 0, other: 0 };
  const existsInVault = vault ? (target) => {
    const clean = String(target || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.includes("..")) return false;
    return fs2.existsSync(path2.join(vault, `${clean}.md`)) || fs2.existsSync(path2.join(vault, clean));
  } : null;
  let verified = 0, unanchoredVault = 0, externalImport = 0, staleCount = 0;
  for (const e of entries) {
    if (Object.hasOwn(byState, e.state)) byState[e.state]++;
    if (e.state === "\u6709\u6548") {
      if (Object.hasOwn(byKind, e.kind)) byKind[e.kind]++;
      if (e.verified) verified++;
      if (isMemoryStale(e)) staleCount++;
      const ast = classifyAnchorStatus(e, { existsInVault });
      if (ast.unanchoredVault) unanchoredVault++;
      else if (ast.externalImportOnly) externalImport++;
      const prov = e.provenance || deriveProvenance(e.sources);
      if (prov === "user-log") byProv.user++;
      else if (prov === "ai-log") byProv.ai++;
      else if (prov === "mixed") byProv.mixed++;
      else byProv.other++;
    }
  }
  const archPart = archivedCount ? ` \xB7 \u5DF2\u5F52\u6863 ${archivedCount} \u6761` : "";
  return [
    `\u8BB0\u5FC6\u5E93\u7EDF\u8BA1\uFF1A\u5171 ${entries.length} \u6761`,
    `\u72B6\u6001\uFF1A\u6709\u6548 ${byState.\u6709\u6548} \xB7 \u5DF2\u62D2\u7EDD ${byState.\u5DF2\u62D2\u7EDD} \xB7 \u5DF2\u88AB\u66FF\u4EE3 ${byState.\u5DF2\u88AB\u66FF\u4EE3}`,
    `\u6709\u6548\u5206\u7C7B\uFF1A\u9879\u76EE\u7ECF\u9A8C ${byKind.lesson} \xB7 \u504F\u597D ${byKind.preference} \xB7 \u4E8B\u5B9E ${byKind.fact} \xB7 \u5F85\u9A8C\u8BC1\u89C4\u5F8B ${byKind.pattern}`,
    `\u6765\u6E90\u5206\u5E03\uFF1A\u7528\u6237\u65E5\u5FD7 ${byProv.user} \xB7 AI \u63D0\u70BC ${byProv.ai} \xB7 \u6DF7\u5408 ${byProv.mixed} \xB7 \u5BFC\u5165/\u624B\u52A8 ${byProv.other}`,
    `\u8D28\u91CF\uFF1A\u5DF2\u786E\u8BA4 ${verified}/${byState.\u6709\u6548} \xB7 \u8FC7\u590D\u6838\u671F ${staleCount} \u6761 \xB7 \u5E93\u5185\u53EF\u8865\u951A ${unanchoredVault} \u6761 \xB7 \u5916\u90E8\u5BFC\u5165\u514D\u8865\u951A ${externalImport} \u6761${archPart}`
  ].join("\n");
}
function proposeMemory(vault, { text, kind = "fact", shortTitle = "", description = "", domain = "", project = "", projectLink = "", concepts = [], tags = [], source = "agent-mcp", configDir = "" } = {}) {
  const clean = String(text || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean || clean.length < 4 || clean.length > 500 || /[<>]/.test(clean)) {
    throw new Error("\u8BB0\u5FC6\u6B63\u6587\u9700\u4E3A 4\u2013500 \u5B57\u7684\u5355\u884C\u7EAF\u6587\u672C\uFF0C\u4E14\u4E0D\u80FD\u5305\u542B <>");
  }
  const cleanKind = KIND_BY_LABEL2[kind] || kind;
  if (!Object.hasOwn(LABEL_BY_KIND, cleanKind)) throw new Error(`\u672A\u77E5\u8BB0\u5FC6\u7C7B\u578B\uFF1A${kind}`);
  const { dir, entries } = loadMemories(vault, { includeArchived: true, configDir });
  const id = memoryIdOf(clean);
  const existing = entries.find((e) => e.id === id);
  if (existing) return { created: false, duplicate: true, rejected: existing.state === "\u5DF2\u62D2\u7EDD", entry: existing };
  fs2.mkdirSync(dir, { recursive: true });
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const nameBase = shortTitle ? String(shortTitle).replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24).replace(/[，。、；：！？,.;:!?（(【「《\s]+$/u, "") || "\u8BB0\u5FC6" : deriveShortMemoryTitle(clean, 22);
  const taken = new Set(fs2.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)));
  let name = nameBase;
  for (let n = 2; taken.has(name) && n < 100; n++) name = `${nameBase}-${n}`;
  const cleanDesc = String(description || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 160);
  const cleanDomain = String(domain || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 40);
  const cleanProj = String(project || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 60);
  const cleanSingleLineLink = (raw) => stripLink(String(raw || "").replace(/[\r\n]+/g, " ")).replace(/[\r\n]+/g, " ").trim();
  const rawProjLink = cleanSingleLineLink(projectLink);
  const cleanProjLink = rawProjLink ? `[[${rawProjLink}]]` : "";
  const cleanConcepts = [...new Set((Array.isArray(concepts) ? concepts : []).map((x) => cleanSingleLineLink(x)).filter(Boolean).map((c) => `[[${c}]]`))].slice(0, 5);
  const cleanTags = (Array.isArray(tags) ? tags : []).map((x) => String(x || "").replace(/[\r\n<>]+/g, " ").trim()).filter(Boolean).slice(0, 5);
  const srcLine = String(source || "agent-mcp").replace(/[\r\n]+/g, " ").trim();
  const srcLinks = [sourceLink(srcLine)].filter(Boolean);
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${yamlStr(clean)}`,
    `kind: ${cleanKind}`,
    `type: ${LABEL_BY_KIND[cleanKind]}`,
    "state: \u6709\u6548",
    "status: active",
    `date: ${date}`,
    ...cleanDesc ? [`description: ${yamlStr(cleanDesc)}`] : [],
    ...cleanProj ? [`project: ${yamlStr(cleanProj)}`] : [],
    ...cleanProjLink ? [`project_link: ${yamlStr(cleanProjLink)}`] : [],
    ...cleanDomain ? [`domain: ${yamlStr(cleanDomain)}`] : [],
    ...cleanConcepts.length ? ["concepts:", ...cleanConcepts.map((c) => `  - ${yamlStr(c)}`)] : [],
    ...cleanTags.length ? ["tags:", ...cleanTags.map((tg) => `  - ${yamlStr(tg)}`)] : [],
    "provenance: ai-log",
    "generated_by: mcp",
    ...cleanKind === "pattern" ? ["verdict: pending"] : [],
    ...srcLinks.length ? ["source_notes:", ...srcLinks.map((s) => `  - ${yamlStr(s)}`)] : [],
    "sources:",
    `  - ${yamlStr(srcLine)}`,
    "---",
    "",
    clean,
    ""
  ];
  const filePath = path2.join(dir, `${name}.md`);
  fs2.writeFileSync(filePath, lines.join("\n"), { encoding: "utf8", flag: "wx" });
  return { created: true, duplicate: false, path: filePath, id, name };
}

// src/context-core/vault-ops.js
import fs5 from "node:fs";
import path5 from "node:path";
import { createHash as createHash3 } from "node:crypto";

// src/context-core/vault-index.js
import fs4 from "node:fs";
import os from "node:os";
import path4 from "node:path";
import { createHash as createHash2 } from "node:crypto";

// src/context-core/fts-index.js
import fs3 from "node:fs";
import path3 from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
var FTS_SCHEMA_VERSION = 2;
var MAX_BODY_CHARS = 48e3;
var cachedSqlite = void 0;
function withoutSqliteWarning(fn) {
  const orig = process.emitWarning;
  process.emitWarning = function filteredWarning(warning, ...rest) {
    const msg = typeof warning === "string" ? warning : warning?.message || "";
    if (msg.includes("SQLite is an experimental feature")) return;
    return orig.call(this, warning, ...rest);
  };
  try {
    return fn();
  } finally {
    process.emitWarning = orig;
  }
}
function loadNodeSqlite() {
  if (cachedSqlite !== void 0) return cachedSqlite;
  const modId = "node:sqlite";
  const loaders = [];
  if (typeof module !== "undefined" && typeof module.require === "function") {
    loaders.push(() => module.require.bind(module));
  }
  loaders.push(() => createRequire(pathToFileURL(path3.join(process.cwd(), "_")).href));
  for (const makeReq of loaders) {
    try {
      const mod = withoutSqliteWarning(() => makeReq()(modId));
      if (mod && typeof mod.DatabaseSync === "function") {
        cachedSqlite = mod;
        return cachedSqlite;
      }
    } catch {
    }
  }
  cachedSqlite = null;
  return cachedSqlite;
}
function ftsFilePath(cacheFile) {
  const s = String(cacheFile || "");
  if (!s) return "";
  return s.endsWith(".json") ? `${s.slice(0, -5)}.fts.sqlite` : `${s}.fts.sqlite`;
}
function sanitizeBodyForFts(raw, { excludeAiLogs = true } = {}) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : /* @__PURE__ */ new Set();
  const kept = [];
  let total = 0;
  for (let i = fmEnd; i < lines.length; i++) {
    if (aiLines.has(i)) continue;
    const clean = cleanUserNoteLine(lines[i], { inFence: fenced.has(i) }).trimEnd();
    if (!clean && !kept.length) continue;
    kept.push(clean);
    total += clean.length + 1;
    if (total >= MAX_BODY_CHARS) break;
  }
  return kept.join("\n").slice(0, MAX_BODY_CHARS).trim();
}
function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS docs (
      path TEXT PRIMARY KEY,
      mtime_ms REAL NOT NULL,
      size INTEGER NOT NULL,
      is_private INTEGER NOT NULL,
      is_generated INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      path UNINDEXED,
      title,
      meta,
      body,
      tokenize='trigram'
    );
  `);
}
function ensureSchema(db, { realVault, excludedKey, forceRebuild = false }) {
  createTables(db);
  const getMeta = db.prepare("SELECT v FROM meta WHERE k = ?");
  const curVer = getMeta.get("schema_version")?.v || "";
  const curExcl = getMeta.get("excluded_key")?.v || "";
  const reset = forceRebuild || curVer !== String(FTS_SCHEMA_VERSION) || curExcl !== excludedKey;
  if (reset) {
    db.exec("DROP TABLE IF EXISTS docs_fts; DROP TABLE IF EXISTS docs;");
    createTables(db);
    const setMeta = db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)");
    setMeta.run("schema_version", String(FTS_SCHEMA_VERSION));
    setMeta.run("excluded_key", excludedKey);
    setMeta.run("vault", realVault);
    setMeta.run("sync_complete", "0");
  }
  return { reset };
}
function ftsNeedsSync(ftsFile, { excludedKey = "", entries = {} } = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile) return false;
  if (!fs3.existsSync(ftsFile)) return true;
  let db = null;
  try {
    db = new sqlite.DatabaseSync(ftsFile, { readOnly: true });
    const getMeta = db.prepare("SELECT v FROM meta WHERE k = ?");
    if ((getMeta.get("schema_version")?.v || "") !== String(FTS_SCHEMA_VERSION)) return true;
    if ((getMeta.get("excluded_key")?.v || "") !== excludedKey) return true;
    if ((getMeta.get("sync_complete")?.v || "") !== "1") return true;
    const rows = db.prepare("SELECT path, mtime_ms, size, is_private, is_generated FROM docs").all();
    const expectedKeys = Object.keys(entries);
    if (rows.length !== expectedKeys.length) return true;
    for (const row of rows) {
      const entry = Object.hasOwn(entries, row.path) ? entries[row.path] : null;
      if (!entry) return true;
      if (row.mtime_ms !== (entry.mtimeMs || 0) || row.size !== (entry.size || 0) || row.is_private !== (entry.private ? 1 : 0) || row.is_generated !== (entry.isGenerated ? 1 : 0)) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  } finally {
    try {
      db?.close();
    } catch {
    }
  }
}
function syncFtsIndex(ftsFile, {
  realVault = "",
  excludedKey = "",
  entries = {},
  changedRawMap = null,
  deletedPaths = [],
  readRawByPath = null,
  forceRebuild = false,
  excludeAiLogs = true
} = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile) return { enabled: false, engine: "json-fallback", syncedCount: 0, dirty: false };
  fs3.mkdirSync(path3.dirname(ftsFile), { recursive: true });
  const db = new sqlite.DatabaseSync(ftsFile);
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
  let syncedCount = 0;
  let skippedUnreadable = 0;
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const { reset } = ensureSchema(db, { realVault, excludedKey, forceRebuild });
      const existing = /* @__PURE__ */ new Map();
      if (!reset) {
        for (const row of db.prepare("SELECT path, mtime_ms, size, is_private, is_generated FROM docs").all()) {
          existing.set(row.path, row);
        }
      }
      const delDoc = db.prepare("DELETE FROM docs WHERE path = ?");
      const delFts = db.prepare("DELETE FROM docs_fts WHERE path = ?");
      const upsertDoc = db.prepare(
        "INSERT OR REPLACE INTO docs (path, mtime_ms, size, is_private, is_generated) VALUES (?, ?, ?, ?, ?)"
      );
      const insFts = db.prepare("INSERT INTO docs_fts (path, title, meta, body) VALUES (?, ?, ?, ?)");
      const setMeta = db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)");
      setMeta.run("sync_complete", "0");
      for (const rel of deletedPaths) {
        delFts.run(rel);
        delDoc.run(rel);
      }
      for (const rel of existing.keys()) {
        if (!Object.hasOwn(entries, rel)) {
          delFts.run(rel);
          delDoc.run(rel);
        }
      }
      for (const [rel, entry] of Object.entries(entries)) {
        const isPriv = entry.private ? 1 : 0;
        const isGen = entry.isGenerated ? 1 : 0;
        const prev = existing.get(rel);
        if (prev && prev.mtime_ms === entry.mtimeMs && prev.size === entry.size && prev.is_private === isPriv && prev.is_generated === isGen) {
          continue;
        }
        if (isPriv || isGen) {
          delFts.run(rel);
          upsertDoc.run(rel, entry.mtimeMs || 0, entry.size || 0, isPriv, isGen);
          syncedCount++;
          continue;
        }
        let raw = changedRawMap?.get(rel);
        if (raw == null && typeof readRawByPath === "function") {
          try {
            raw = readRawByPath(rel);
          } catch {
            raw = null;
          }
        }
        if (raw == null) {
          skippedUnreadable++;
          continue;
        }
        delFts.run(rel);
        upsertDoc.run(rel, entry.mtimeMs || 0, entry.size || 0, isPriv, isGen);
        if (isPrivateFrontmatter(raw)) {
          upsertDoc.run(rel, entry.mtimeMs || 0, entry.size || 0, 1, isGen);
          syncedCount++;
          continue;
        }
        const titleText = [entry.name || "", ...entry.aliases || []].filter(Boolean).join(" ");
        const metaText = [
          entry.def || "",
          entry.domain || "",
          entry.category || "",
          entry.type || "",
          ...entry.tags || [],
          ...(entry.headings || []).map((h) => h.title)
        ].filter(Boolean).join(" ");
        const bodyText = sanitizeBodyForFts(raw, { excludeAiLogs });
        insFts.run(rel, titleText, metaText, bodyText);
        syncedCount++;
      }
      setMeta.run("sync_complete", skippedUnreadable === 0 ? "1" : "0");
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    }
    return { enabled: true, engine: "sqlite-fts5", syncedCount, dirty: skippedUnreadable > 0 };
  } finally {
    db.close();
  }
}
function parseQueryTerms(query) {
  const clean = String(query || "").trim();
  const phrases = [];
  const rest = clean.replace(/"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) phrases.push(t);
    return " ";
  });
  const tokens = rest.split(/[\s,，、;；]+/).map((s) => s.trim()).filter(Boolean);
  const all = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of [...phrases, ...tokens]) {
    const low = item.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      all.push({ text: item, low, quoted: phrases.includes(item) });
    }
  }
  return { phrases, all };
}
function quoteFtsTerm(term) {
  return `"${String(term || "").replace(/"/g, '""')}"`;
}
function buildWindowSnippet(text, needleLow, maxLen = 96) {
  const src = String(text || "").replace(/\s+/g, " ").trim();
  if (!src) return "";
  const idx = src.toLowerCase().indexOf(needleLow);
  if (idx < 0) return src.slice(0, maxLen);
  const start = Math.max(0, idx - 24);
  const end = Math.min(src.length, idx + needleLow.length + 60);
  const prefix = start > 0 ? "\u2026" : "";
  const suffix = end < src.length ? "\u2026" : "";
  const rawMatch = src.slice(idx, idx + needleLow.length);
  return `${prefix}${src.slice(start, idx)}\xAB${rawMatch}\xBB${src.slice(idx + needleLow.length, end)}${suffix}`;
}
function searchFtsIndex(ftsFile, query, { limit = 24, filterPath = null } = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile || !fs3.existsSync(ftsFile)) return [];
  const { phrases, all } = parseQueryTerms(query);
  if (!all.length) return [];
  const wantLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  const ftsTerms = all.filter((t) => t.text.length >= 3);
  const shortTerms = all.filter((t) => t.text.length > 0 && t.text.length < 3);
  const pathAllowed = typeof filterPath === "function" ? filterPath : null;
  const db = new sqlite.DatabaseSync(ftsFile, { readOnly: true });
  try {
    if (ftsTerms.length) {
      const sql = `
        SELECT path,
               snippet(docs_fts, 3, '\xAB', '\xBB', '\u2026', 14) AS snip,
               title,
               meta,
               body,
               bm25(docs_fts, 4.0, 2.0, 2.0, 1.0) AS rank
        FROM docs_fts
        WHERE docs_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `;
      const queryFiltered = (expr) => {
        const stmt = db.prepare(sql);
        const batchSize2 = pathAllowed || shortTerms.length ? Math.max(wantLimit * 4, 80) : wantLimit;
        const hits = [];
        for (let offset = 0; offset < 2e3; offset += batchSize2) {
          const batch = stmt.all(expr, batchSize2, offset);
          for (const r of batch) {
            if (pathAllowed && !pathAllowed(r.path)) continue;
            if (shortTerms.length) {
              const hay = `${r.title || ""}
${r.meta || ""}
${r.body || ""}`.toLowerCase();
              if (!shortTerms.every((t) => hay.includes(t.low))) continue;
            }
            hits.push(r);
            if (hits.length >= wantLimit) break;
          }
          if (hits.length >= wantLimit || batch.length < batchSize2) break;
        }
        return hits;
      };
      const andExpr = ftsTerms.map((t) => quoteFtsTerm(t.text)).join(" ");
      let rows = queryFiltered(andExpr);
      if (!rows.length && ftsTerms.length > 1) {
        const orExpr = ftsTerms.map((t) => quoteFtsTerm(t.text)).join(" OR ");
        rows = queryFiltered(orExpr);
      }
      return rows.slice(0, wantLimit).map((r) => {
        const snip = String(r.snip || "").trim() || buildWindowSnippet(r.body || r.title || "", ftsTerms[0].low);
        const hay = `${r.title || ""}
${r.body || ""}`.toLowerCase();
        const isPhrase = phrases.some((p) => hay.includes(p.toLowerCase())) || all.length === 1 && all[0].text.length >= 4 && hay.includes(all[0].low);
        return {
          path: r.path,
          snippet: snip.slice(0, 140),
          matchKind: isPhrase ? "phrase" : "fts5"
        };
      });
    }
    const primary = shortTerms[0];
    const subStmt = db.prepare(`
      SELECT path, title, meta, body
      FROM docs_fts
      WHERE instr(lower(body), ?) > 0 OR instr(lower(title), ?) > 0 OR instr(lower(meta), ?) > 0
      LIMIT ? OFFSET ?
    `);
    const batchSize = pathAllowed ? Math.max(wantLimit * 4, 120) : wantLimit * 3;
    const matched = [];
    for (let offset = 0; offset < 4e3; offset += batchSize) {
      const subRows = subStmt.all(primary.low, primary.low, primary.low, batchSize, offset);
      for (const r of subRows) {
        if (pathAllowed && !pathAllowed(r.path)) continue;
        const hay = `${r.title || ""}
${r.meta || ""}
${r.body || ""}`.toLowerCase();
        if (!shortTerms.every((t) => hay.includes(t.low))) continue;
        matched.push({
          path: r.path,
          snippet: buildWindowSnippet(r.body || r.meta || r.title || "", primary.low),
          matchKind: "substr"
        });
        if (matched.length >= wantLimit) break;
      }
      if (matched.length >= wantLimit || subRows.length < batchSize) break;
    }
    return matched;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// src/context-core/vault-index.js
var INDEX_VERSION = 2;
var DEFAULT_INDEX_DIR = () => path4.join(os.homedir(), ".agent-deck", "index");
var INLINE_TAG_RE = /(?:^|[\s(（\[【])#([\p{L}\p{N}_/-]{1,48})/gu;
var WIKILINK_SCAN_RE = /!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
var MEM_CACHE = /* @__PURE__ */ new Map();
function isTestRuntime() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((a) => /(?:^|[\\/])test[\\/]|\.test\.mjs$/i.test(String(a)));
}
function computeAnchorHash(text) {
  const norm = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return createHash2("sha256").update(norm).digest("hex").slice(0, 8);
}
function indexFilePath(realVault, indexDir = "") {
  const dir = indexDir ? path4.resolve(indexDir) : DEFAULT_INDEX_DIR();
  const key = createHash2("sha256").update(process.platform === "win32" ? realVault.toLowerCase() : realVault).digest("hex").slice(0, 16);
  return { dir, file: path4.join(dir, `${key}.json`) };
}
function parseNoteMetadata(raw, relPath, stat, generatedMatchers, { excludeAiLogs = true } = {}) {
  if (isPrivateFrontmatter(raw)) {
    return {
      path: relPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      private: true,
      isGenerated: false,
      isMemoryStore: false
    };
  }
  const gen = isGeneratedVaultFile(relPath, raw, generatedMatchers);
  if (gen.isGenerated) {
    return {
      path: relPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      private: false,
      isGenerated: true,
      isMemoryStore: gen.isMemoryStore
    };
  }
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const { fmEnd, meta } = parseFrontmatter(lines);
  const str = (v) => Array.isArray(v) ? String(v[0] || "").trim() : String(v || "").trim();
  const aliases = [.../* @__PURE__ */ new Set([...parseListValue(meta.aliases), ...parseListValue(meta.alias)])];
  const tagSet = /* @__PURE__ */ new Set();
  for (const tg of [...parseListValue(meta.tags), ...parseListValue(meta.tag)]) {
    const clean = tg.replace(/^#/, "").trim();
    if (clean) tagSet.add(clean);
  }
  const fenced = fencedLines(lines);
  const aiLines = excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : /* @__PURE__ */ new Set();
  const headings = [];
  const blocks = [];
  const links = [];
  let bodyChars = 0;
  for (let i = fmEnd; i < lines.length; i++) {
    if (aiLines.has(i)) continue;
    const line = lines[i];
    if (fenced.has(i)) {
      bodyChars += line.replace(/\s+/g, "").length;
      continue;
    }
    bodyChars += line.replace(/\s+/g, "").length;
    const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (hm) {
      const title = hm[2].trim();
      if (title) headings.push({ level: hm[1].length, title, line: i + 1 });
    }
    const bm = BLOCK_ID_SUFFIX_RE.exec(line);
    if (bm && !isInternalTaskBlockId(bm[1])) {
      const cleanLine = line.replace(BLOCK_ID_SUFFIX_RE, "").trim();
      blocks.push({ id: bm[1], line: i + 1, text: cleanLine.slice(0, 140) });
    }
    const masked = line.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/gi, "");
    for (const tm of masked.matchAll(INLINE_TAG_RE)) {
      const tg = String(tm[1] || "").trim();
      if (tg && !/^\d+$/.test(tg)) tagSet.add(tg);
    }
    const strippedForPos = masked.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX/\-]\]\s+/, "").replace(TASK_KW_STRIP_RE, "").replace(/^\s*#{1,6}\s+/, "").replace(BLOCK_ID_SUFFIX_RE, "").replace(/%%[^%]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
    const matches = [...masked.matchAll(WIKILINK_SCAN_RE)];
    if (matches.length) {
      const startsWithLink = /^(?:!?\[\[)/.test(strippedForPos);
      const endsWithLink = /\]\]$/.test(strippedForPos);
      const strong = startsWithLink || endsWithLink;
      const isBareBullet = Boolean(LIST_RE.test(line)) && matches.length === 1 && strippedForPos === matches[0][0];
      const standaloneNoChild = isBareBullet && subtreeEnd(lines, i) <= i + 1;
      for (const wm of matches) {
        const target = String(wm[1] || "").trim();
        if (!target) continue;
        links.push({
          target,
          subpath: String(wm[2] || "").trim(),
          line: i + 1,
          strong,
          standaloneNoChild
        });
      }
    }
  }
  const baseName = path4.posix.basename(relPath, ".md");
  return {
    path: relPath,
    name: baseName,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    private: false,
    isGenerated: false,
    isMemoryStore: false,
    type: str(meta.type),
    def: str(meta.def) || str(meta.description),
    domain: str(meta.domain),
    category: str(meta.category),
    father: str(meta.father),
    aliases,
    tags: [...tagSet],
    status: str(meta.status) || str(meta.state),
    verified: str(meta.verified).toLowerCase() === "true" || Boolean(str(meta.verified_by)),
    staleAfter: str(meta.stale_after) || str(meta.valid_until),
    bodyLen: bodyChars,
    headings,
    blocks,
    links
  };
}
function walkVaultMarkdown(vaultDir, excludedDirs, { realVault = "", caseInsensitive = false } = {}) {
  const rootReal = realVault || realPathSafe(vaultDir);
  const found = [];
  const walk = (absDir, relPrefix) => {
    let entries;
    try {
      entries = fs4.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.name || ent.name.startsWith(".") || ent.name === "node_modules") continue;
      if (ent.isSymbolicLink()) continue;
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (isPathExcluded(rel, excludedDirs, { caseInsensitive })) continue;
        const nextDir = path4.join(absDir, ent.name);
        if (!isPathContainedIn(rootReal, realPathSafe(nextDir), { caseInsensitive })) continue;
        walk(nextDir, rel);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        if (isPathExcluded(rel, excludedDirs, { caseInsensitive })) continue;
        const abs = path4.join(absDir, ent.name);
        try {
          const lst = fs4.lstatSync(abs);
          if (lst.isSymbolicLink() || !lst.isFile()) continue;
          if (!isPathContainedIn(rootReal, realPathSafe(abs), { caseInsensitive })) continue;
          found.push({ rel, abs, mtimeMs: lst.mtimeMs, size: lst.size });
        } catch {
        }
      }
    }
  };
  walk(rootReal, "");
  return found;
}
function loadVaultIndex(vault, {
  indexDir = "",
  persist = void 0,
  excludedDirs = null,
  memoryDir = "",
  forceRebuild = false,
  disableFts = false,
  cacheTtlMs = 0,
  configDir = "",
  excludeAiLogs = void 0
} = {}) {
  const cleanVault = String(vault || "").trim();
  if (!cleanVault || !fs4.existsSync(cleanVault)) {
    throw new Error(`\u627E\u4E0D\u5230 Vault \u76EE\u5F55\uFF1A${vault || "(\u672A\u6307\u5B9A)"}`);
  }
  const realVault = realPathSafe(cleanVault);
  const cfg = readPluginConfig(cleanVault, { configDir });
  const mcpCfg = mcpSettingsOf(cleanVault, { configDir });
  const effectiveExcludeAiLogs = typeof excludeAiLogs === "boolean" ? excludeAiLogs : mcpCfg.excludeAiLogs;
  const excluded = Array.isArray(excludedDirs) ? excludedDirs : excludedDirsOf(cleanVault, { configDir });
  const memRel = normalizeRelPath(memoryDir || cfg?.dream?.dir || path4.relative(cleanVault, memoryDirOf(cleanVault, { configDir })));
  const generatedMatchers = buildGeneratedMatchers({
    memoryDir: memRel,
    dreamPath: cfg?.dream?.path || "",
    doneArchivePath: cfg?.doneArchivePath || ""
  });
  const caseInsensitive = isCaseInsensitiveFs(realVault);
  const { dir: cacheDir, file: cacheFile } = indexFilePath(realVault, indexDir);
  const shouldPersist = persist !== void 0 ? Boolean(persist) : Boolean(indexDir) || !isTestRuntime();
  const memKey = `${realVault}|${cacheFile}`;
  const exclKey = JSON.stringify({
    excluded: caseInsensitive ? excluded.map((d) => d.toLowerCase()) : excluded,
    generatedKey: generatedMatchers.key,
    caseInsensitive,
    excludeAiLogs: effectiveExcludeAiLogs
  });
  const inMem = !forceRebuild ? MEM_CACHE.get(memKey) : null;
  if (inMem?.builtIndex && inMem.version === INDEX_VERSION && inMem.excludedKey === exclKey && cacheTtlMs > 0 && Date.now() - inMem.builtAt < cacheTtlMs && Boolean(disableFts) === Boolean(!inMem.ftsFile)) {
    return {
      ...inMem.builtIndex,
      stats: { ...inMem.builtIndex.stats, cacheHit: true, reindexedFiles: 0 }
    };
  }
  let prevEntries = null;
  let cacheHit = false;
  if (!forceRebuild) {
    if (inMem && inMem.version === INDEX_VERSION && inMem.excludedKey === exclKey) {
      prevEntries = inMem.entries;
      cacheHit = true;
    } else if (shouldPersist && fs4.existsSync(cacheFile)) {
      try {
        const raw = JSON.parse(fs4.readFileSync(cacheFile, "utf8"));
        if (raw && raw.version === INDEX_VERSION && raw.excludedKey === exclKey && raw.entries && typeof raw.entries === "object") {
          prevEntries = raw.entries;
          cacheHit = true;
        }
      } catch {
      }
    }
  }
  const files = walkVaultMarkdown(cleanVault, excluded, { realVault, caseInsensitive });
  const nextEntries = {};
  const changedRawMap = /* @__PURE__ */ new Map();
  let reindexedFiles = 0;
  for (const f of files) {
    const prev = prevEntries?.[f.rel];
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
      nextEntries[f.rel] = prev;
      continue;
    }
    try {
      const raw = readVaultFileStrict(cleanVault, f.rel, { realVault });
      const parsed = parseNoteMetadata(raw, f.rel, f, generatedMatchers, { excludeAiLogs: effectiveExcludeAiLogs });
      nextEntries[f.rel] = parsed;
      if (!parsed.private && !parsed.isGenerated) changedRawMap.set(f.rel, raw);
      reindexedFiles++;
    } catch {
    }
  }
  const deletedPaths = prevEntries ? Object.keys(prevEntries).filter((k) => !Object.hasOwn(nextEntries, k)) : [];
  const deletedCount = deletedPaths.length;
  MEM_CACHE.set(memKey, { version: INDEX_VERSION, excludedKey: exclKey, entries: nextEntries });
  if (shouldPersist && (!cacheHit || reindexedFiles > 0 || deletedCount > 0 || !fs4.existsSync(cacheFile))) {
    try {
      fs4.mkdirSync(cacheDir, { recursive: true });
      fs4.writeFileSync(cacheFile, JSON.stringify({
        version: INDEX_VERSION,
        vault: realVault,
        excludedKey: exclKey,
        excludeAiLogs: effectiveExcludeAiLogs,
        updatedAt: Date.now(),
        entries: nextEntries
      }), "utf8");
    } catch {
    }
  }
  let ftsFile = "";
  let ftsEngine = "json-fallback";
  const wantFts = !disableFts && shouldPersist && Boolean(loadNodeSqlite());
  if (wantFts) {
    const candidateFts = ftsFilePath(cacheFile);
    try {
      const needsFtsSync = forceRebuild || reindexedFiles > 0 || deletedCount > 0 || ftsNeedsSync(candidateFts, { excludedKey: exclKey, entries: nextEntries });
      if (needsFtsSync) {
        const res = syncFtsIndex(candidateFts, {
          realVault,
          excludedKey: exclKey,
          entries: nextEntries,
          changedRawMap,
          deletedPaths,
          readRawByPath: (rel) => readVaultFileStrict(cleanVault, rel, { realVault }),
          forceRebuild,
          excludeAiLogs: effectiveExcludeAiLogs
        });
        if (res.enabled) {
          ftsFile = candidateFts;
          ftsEngine = res.engine;
        }
      } else {
        ftsFile = candidateFts;
        ftsEngine = "sqlite-fts5";
      }
    } catch {
      ftsFile = "";
      ftsEngine = "json-fallback";
    }
  }
  if (cacheHit && reindexedFiles === 0 && deletedCount === 0 && inMem?.builtIndex && inMem.ftsFile === ftsFile && inMem.ftsEngine === ftsEngine) {
    inMem.builtAt = Date.now();
    return {
      ...inMem.builtIndex,
      stats: { ...inMem.builtIndex.stats, cacheHit: true, reindexedFiles: 0 }
    };
  }
  const byPath = /* @__PURE__ */ new Map();
  const byPathLower = /* @__PURE__ */ new Map();
  const privatePaths = /* @__PURE__ */ new Set();
  const privateLowerNames = /* @__PURE__ */ new Set();
  const generatedPaths = /* @__PURE__ */ new Set();
  const generatedMemoryPaths = /* @__PURE__ */ new Set();
  const byName = /* @__PURE__ */ new Map();
  let privateCount = 0;
  let generatedCount = 0;
  const addName = (key, relPath) => {
    const lk = String(key || "").trim().toLowerCase();
    if (!lk) return;
    let list = byName.get(lk);
    if (!list) {
      list = [];
      byName.set(lk, list);
    }
    if (!list.includes(relPath)) list.push(relPath);
  };
  for (const [rel, entry] of Object.entries(nextEntries)) {
    if (entry.private) {
      privateCount++;
      privatePaths.add(rel);
      privatePaths.add(rel.toLowerCase());
      privateLowerNames.add(path4.posix.basename(rel, ".md").toLowerCase());
      continue;
    }
    if (entry.isGenerated) {
      generatedCount++;
      generatedPaths.add(rel);
      generatedPaths.add(rel.toLowerCase());
      if (entry.isMemoryStore) {
        generatedMemoryPaths.add(rel);
        generatedMemoryPaths.add(rel.toLowerCase());
      }
      continue;
    }
    byPath.set(rel, entry);
    byPathLower.set(rel.toLowerCase(), rel);
    addName(entry.name, rel);
    addName(rel.slice(0, -3), rel);
    for (const alias of entry.aliases || []) addName(alias, rel);
  }
  const resolveNote = (rawRef, fromPath = "") => {
    let clean = String(rawRef || "").trim();
    if (!clean) return { path: "", subpath: "", blockedPrivate: false, blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    if (clean.startsWith("[[") && clean.endsWith("]]")) clean = clean.slice(2, -2);
    clean = clean.split("|")[0].trim();
    let subpath = "";
    const hashIdx = clean.indexOf("#");
    if (hashIdx >= 0) {
      subpath = clean.slice(hashIdx + 1).trim();
      clean = clean.slice(0, hashIdx).trim();
    }
    clean = clean.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").includes("..")) {
      return { path: "", subpath, blockedPrivate: false, blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    }
    const withMd = clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
    if (isPathExcluded(withMd, excluded, { caseInsensitive }) || isPathExcluded(clean, excluded, { caseInsensitive })) {
      return { path: "", subpath, blockedPrivate: true, blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    }
    if (privatePaths.has(withMd) || privatePaths.has(withMd.toLowerCase())) {
      return { path: "", subpath, blockedPrivate: true, blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    }
    if (generatedPaths.has(withMd) || generatedPaths.has(withMd.toLowerCase())) {
      return {
        path: "",
        subpath,
        blockedPrivate: false,
        blockedGenerated: true,
        blockedMemoryStore: generatedMemoryPaths.has(withMd) || generatedMemoryPaths.has(withMd.toLowerCase()),
        candidates: []
      };
    }
    const direct = byPathLower.get(withMd.toLowerCase());
    if (direct) return { path: direct, subpath, blockedPrivate: false, blockedGenerated: false, blockedMemoryStore: false, candidates: [direct] };
    const bare = clean.replace(/\.md$/i, "").toLowerCase();
    const cands = byName.get(bare) || [];
    if (!cands.length) {
      return { path: "", subpath, blockedPrivate: privateLowerNames.has(bare), blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    }
    const fromDir = fromPath ? path4.posix.dirname(fromPath) : "";
    const sorted = [...cands].sort((a, b) => {
      const aSame = fromDir && fromDir !== "." && a.startsWith(`${fromDir}/`) ? 0 : 1;
      const bSame = fromDir && fromDir !== "." && b.startsWith(`${fromDir}/`) ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      const aDepth = a.split("/").length;
      const bDepth = b.split("/").length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return a.length - b.length || a.localeCompare(b);
    });
    return { path: sorted[0], subpath, blockedPrivate: false, blockedGenerated: false, blockedMemoryStore: false, candidates: sorted };
  };
  const backlinks = /* @__PURE__ */ new Map();
  const sonsByFather = /* @__PURE__ */ new Map();
  for (const entry of byPath.values()) {
    if (entry.father) {
      const fName = normalizeLinkName(entry.father);
      const resolvedFather = resolveNote(fName, entry.path);
      if (resolvedFather.path && resolvedFather.path !== entry.path) {
        let list = sonsByFather.get(resolvedFather.path);
        if (!list) {
          list = [];
          sonsByFather.set(resolvedFather.path, list);
        }
        if (!list.includes(entry.path)) list.push(entry.path);
      }
    }
    if (entry.isGenerated) continue;
    for (const lk of entry.links || []) {
      const dest = resolveNote(lk.target, entry.path);
      if (!dest.path || dest.path === entry.path) continue;
      let list = backlinks.get(dest.path);
      if (!list) {
        list = [];
        backlinks.set(dest.path, list);
      }
      list.push({
        sourcePath: entry.path,
        target: lk.target,
        line: lk.line,
        strong: Boolean(lk.strong),
        standaloneNoChild: Boolean(lk.standaloneNoChild)
      });
    }
  }
  const builtIndex = {
    vault: cleanVault,
    realVault,
    cacheFile,
    ftsFile,
    excludedDirs: excluded,
    byPath,
    privatePaths,
    generatedPaths,
    generatedMemoryPaths,
    byName,
    resolveNote,
    backlinks,
    sonsByFather,
    stats: {
      totalFiles: files.length,
      indexedFiles: byPath.size,
      reindexedFiles,
      privateCount,
      generatedCount,
      cacheHit,
      ftsEngine
    }
  };
  MEM_CACHE.set(memKey, {
    version: INDEX_VERSION,
    excludedKey: exclKey,
    entries: nextEntries,
    builtIndex,
    builtAt: Date.now(),
    ftsFile,
    ftsEngine
  });
  return builtIndex;
}

// src/context-core/vault-ops.js
var OKF_VAULT_KEYS = ["type", "def", "domain", "category", "father", "status", "verified"];
function blockedGeneratedError(ref, resolved) {
  if (resolved?.blockedMemoryStore) {
    return `\u76EE\u6807\u5C5E\u4E8E Agent Deck \u8BB0\u5FC6\u5E93\uFF08\u5DF2\u6C89\u6DC0\u8BB0\u5FC6\u8BF7\u4F7F\u7528 memory_search / memory_read / memory_index \u68C0\u7D22\uFF0C\u4E0D\u6DF7\u5165\u666E\u901A\u7B14\u8BB0\uFF09\uFF1A${ref}`;
  }
  return `\u76EE\u6807\u5C5E\u4E8E AI/\u63D2\u4EF6\u81EA\u52A8\u751F\u6210\u6587\u4EF6\uFF0C\u4E0D\u4F5C\u4E3A\u7528\u6237\u6570\u636E\u53C2\u4E0E Vault \u68C0\u7D22\uFF1A${ref}`;
}
function readRawNote(vault, relPath, readOverride = null) {
  if (typeof readOverride === "function") {
    const ov = readOverride(relPath);
    if (typeof ov === "string") return ov;
  }
  const abs = path5.join(vault, ...relPath.split("/").filter(Boolean));
  const realVault = realPathSafe(vault);
  const realTarget = (fs5.realpathSync.native || fs5.realpathSync)(abs);
  if (!isPathContainedIn(realVault, realTarget, { caseInsensitive: isCaseInsensitiveFs(realVault) })) {
    throw new Error(`\u76EE\u6807\u8DEF\u5F84\u8D8A\u754C\uFF08\u7B26\u53F7\u94FE\u63A5\u6307\u5411 Vault \u5916\uFF09\uFF1A${relPath}`);
  }
  return fs5.readFileSync(realTarget, "utf8");
}
function headingPathAt(lines, lineIdx, fenced) {
  const stack = [];
  for (let i = 0; i <= lineIdx && i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (!hm) continue;
    const lvl = hm[1].length;
    while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    stack.push({ lvl, title: hm[2].trim() });
  }
  return stack.map((h) => h.title).join(" > ");
}
function lineMentionsTarget(line, expectedTargets) {
  if (!expectedTargets?.size) return true;
  const masked = String(line || "").replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/gi, "");
  for (const m of masked.matchAll(/!?\[\[([^\]|#\n]+)(?:[|#][^\]]*)?\]\]/g)) {
    const clean = normalizeLinkName(m[1]).toLowerCase();
    const base = clean.split("/").pop();
    if (expectedTargets.has(clean) || base && expectedTargets.has(base)) return true;
  }
  return false;
}
function extractBacklinkBlocks(vault, backlinks = [], { limit = 3, maxCharsPerBlock = 200, readOverride = null, targetNames = null } = {}) {
  const candidates = backlinks.filter((b) => !b.standaloneNoChild);
  const sorted = [...candidates].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    return b.sourcePath.localeCompare(a.sourcePath) || b.line - a.line;
  });
  const seenHashes = /* @__PURE__ */ new Set();
  const fileLinesCache = /* @__PURE__ */ new Map();
  const items = [];
  for (const bl of sorted) {
    if (items.length >= limit) break;
    let cached = fileLinesCache.get(bl.sourcePath);
    if (!cached) {
      try {
        const raw = readRawNote(vault, bl.sourcePath, readOverride);
        if (isPrivateFrontmatter(raw)) continue;
        const lines2 = String(raw || "").replace(/\r\n/g, "\n").split("\n");
        const aiLines2 = aiGeneratedLineIndices(lines2, { startLine: frontmatterEnd(lines2) });
        cached = { lines: lines2, aiLines: aiLines2 };
        fileLinesCache.set(bl.sourcePath, cached);
      } catch {
        continue;
      }
    }
    const { lines, aiLines } = cached;
    const expectedSet = new Set(targetNames || []);
    if (bl.target) {
      const cleanT = normalizeLinkName(bl.target).toLowerCase();
      if (cleanT) {
        expectedSet.add(cleanT);
        const tail = cleanT.split("/").pop();
        if (tail) expectedSet.add(tail);
      }
    }
    let idx = bl.line - 1;
    if (idx < 0 || idx >= lines.length || aiLines.has(idx) || !lineMentionsTarget(lines[idx], expectedSet)) {
      const relIdx = expectedSet.size ? lines.findIndex((l, li) => !aiLines.has(li) && lineMentionsTarget(l, expectedSet)) : -1;
      if (relIdx < 0) continue;
      idx = relIdx;
    }
    let start = idx;
    let end = idx + 1;
    const targetLine = lines[idx];
    const picked = [];
    if (LIST_RE.test(targetLine)) {
      const targetIndent = width(targetLine);
      for (let p = idx - 1; p >= 0; p--) {
        if (!lines[p].trim() || aiLines.has(p)) continue;
        if (LIST_RE.test(lines[p]) && width(lines[p]) < targetIndent) {
          picked.push(lines[p]);
          break;
        }
        if (width(lines[p]) === 0 && !LIST_RE.test(lines[p])) break;
      }
      end = subtreeEnd(lines, idx);
    }
    for (let j = start; j < end; j++) {
      if (!aiLines.has(j)) picked.push(lines[j]);
    }
    const cleaned = cleanUserNoteLines(picked).join("\n").trim();
    if (!cleaned) continue;
    const dedupHash = createHash3("sha256").update(cleaned.replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 12);
    if (seenHashes.has(dedupHash)) continue;
    seenHashes.add(dedupHash);
    let text = cleaned;
    if (text.length > maxCharsPerBlock) {
      const outLines = [];
      let sz = 0;
      for (const l of text.split("\n")) {
        if (outLines.length && sz + l.length + 1 > maxCharsPerBlock) break;
        outLines.push(l);
        sz += l.length + 1;
      }
      text = outLines.join("\n").slice(0, maxCharsPerBlock).trimEnd() + "\u2026";
    }
    const signalLabel = bl.strong ? "\u5F3A\u4FE1\u53F7" : "\u53E5\u4E2D\u63D0\u53CA";
    items.push({
      sourcePath: bl.sourcePath,
      line: bl.line,
      strong: bl.strong,
      why: `${signalLabel} \xB7 ${bl.sourcePath.replace(/\.md$/i, "")}(L${bl.line})`,
      text
    });
  }
  return items;
}
function vaultFind(vault, query, { k = 8, domain = "", type = "", tag = "", fulltext = true, indexOpts = {} } = {}) {
  const q = String(query || "").trim();
  const wantK = Math.max(1, Math.min(30, Number(k) || 8));
  const wantTerms = terms(q);
  const lowQ = q.toLowerCase();
  const wantDomain = String(domain || "").trim().toLowerCase();
  const wantType = String(type || "").trim().toLowerCase();
  const wantTag = String(tag || "").trim().replace(/^#/, "").toLowerCase();
  const idx = loadVaultIndex(vault, indexOpts);
  const matchesByPath = /* @__PURE__ */ new Map();
  for (const entry of idx.byPath.values()) {
    if (entry.isGenerated) continue;
    if (wantDomain && !`${entry.domain} ${entry.category}`.toLowerCase().includes(wantDomain)) continue;
    if (wantType && entry.type.toLowerCase() !== wantType) continue;
    if (wantTag && !(entry.tags || []).some((tg) => tg.toLowerCase() === wantTag)) continue;
    const why = [];
    let rank = 0;
    const nameLow = entry.name.toLowerCase();
    const aliasExact = (entry.aliases || []).find((a) => a.toLowerCase() === lowQ);
    if (lowQ && nameLow === lowQ) {
      rank += 100;
      why.push("\u6807\u9898\u7CBE\u786E\u5339\u914D");
    } else if (aliasExact) {
      rank += 90;
      why.push(`\u522B\u540D\u7CBE\u786E\u5339\u914D:${aliasExact}`);
    } else if (lowQ && nameLow.includes(lowQ)) {
      rank += 45;
      why.push("\u6807\u9898\u5305\u542B");
    } else if (lowQ && (entry.aliases || []).some((a) => a.toLowerCase().includes(lowQ))) {
      rank += 35;
      why.push("\u522B\u540D\u5305\u542B");
    }
    if (wantTerms.size) {
      const titleTerms = terms([entry.name, ...entry.aliases || []].join(" "));
      const defTerms = terms(entry.def);
      const metaTerms = terms([entry.domain, entry.category, entry.type, ...entry.tags || []].join(" "));
      const headTerms = terms((entry.headings || []).map((h) => h.title).join(" "));
      const pathTerms = terms(entry.path.replace(/\.md$/i, "").replace(/\//g, " "));
      const tHits = [...titleTerms].filter((w) => wantTerms.has(w));
      const dHits = [...defTerms].filter((w) => wantTerms.has(w) && !titleTerms.has(w));
      const mHits = [...metaTerms].filter((w) => wantTerms.has(w));
      const hHits = [...headTerms].filter((w) => wantTerms.has(w));
      const pHits = [...pathTerms].filter((w) => wantTerms.has(w) && !titleTerms.has(w));
      const covered = /* @__PURE__ */ new Set([...tHits, ...dHits, ...mHits, ...hHits, ...pHits]);
      const distinctiveTerms = [...wantTerms].filter((w) => isDistinctiveLatinTerm(w) || isHybridTerm(w));
      if (!why.length) {
        let okMatch = false;
        if (distinctiveTerms.length > 0) {
          okMatch = distinctiveTerms.some((w) => covered.has(w));
        } else {
          const minCovered = wantTerms.size === 1 ? 1 : wantTerms.size >= 4 ? Math.min(3, Math.ceil(wantTerms.size * 0.45)) : 2;
          okMatch = covered.size >= minCovered;
        }
        if (!okMatch && !wantDomain && !wantType && !wantTag) continue;
      }
      rank += tHits.length * 10 + dHits.length * 6 + mHits.length * 5 + hHits.length * 4 + pHits.length * 3;
      if (tHits.length) why.push(`\u6807\u9898\u8BCD:${tHits.slice(0, 3).join("/")}`);
      if (dHits.length) why.push(`def:${dHits.slice(0, 3).join("/")}`);
      if (mHits.length) why.push(`\u5C5E\u6027:${mHits.slice(0, 3).join("/")}`);
      if (hHits.length) why.push(`\u7AE0\u8282:${hHits.slice(0, 2).join("/")}`);
      if (pHits.length) why.push(`\u8DEF\u5F84:${pHits.slice(0, 2).join("/")}`);
    } else if (wantDomain || wantType || wantTag) {
      rank += 10;
      if (wantDomain) why.push(`\u9886\u57DF:${entry.domain || entry.category}`);
      if (wantType) why.push(`\u7C7B\u578B:${entry.type}`);
      if (wantTag) why.push(`\u6807\u7B7E:#${wantTag}`);
    }
    if (!why.length) continue;
    const blCount = idx.backlinks.get(entry.path)?.length || 0;
    if (entry.def) rank += 2;
    rank += Math.min(8, Math.floor(blCount / 3));
    matchesByPath.set(entry.path, {
      path: entry.path,
      name: entry.name,
      type: entry.type,
      def: entry.def,
      domain: entry.domain || entry.category,
      tags: entry.tags,
      bodyLen: entry.bodyLen,
      backlinkCount: blCount,
      snippet: "",
      why,
      _rank: rank
    });
  }
  if (fulltext !== false && q && idx.ftsFile) {
    const ftsHits = searchFtsIndex(idx.ftsFile, q, {
      limit: wantK * 3,
      filterPath: (rel) => {
        const entry = idx.byPath.get(rel);
        if (!entry || entry.isGenerated) return false;
        if (wantDomain && !`${entry.domain} ${entry.category}`.toLowerCase().includes(wantDomain)) return false;
        if (wantType && entry.type.toLowerCase() !== wantType) return false;
        if (wantTag && !(entry.tags || []).some((tg) => tg.toLowerCase() === wantTag)) return false;
        return true;
      }
    });
    for (const hit of ftsHits) {
      const entry = idx.byPath.get(hit.path);
      if (!entry || entry.isGenerated) continue;
      if (wantDomain && !`${entry.domain} ${entry.category}`.toLowerCase().includes(wantDomain)) continue;
      if (wantType && entry.type.toLowerCase() !== wantType) continue;
      if (wantTag && !(entry.tags || []).some((tg) => tg.toLowerCase() === wantTag)) continue;
      const label = hit.matchKind === "phrase" ? "\u6B63\u6587\u77ED\u8BED\u547D\u4E2D" : "\u6B63\u6587\u5168\u6587\u547D\u4E2D";
      const prev = matchesByPath.get(entry.path);
      if (prev) {
        if (!prev.snippet && hit.snippet) prev.snippet = hit.snippet;
        if (!prev.why.includes(label)) prev.why.push(label);
        prev._rank += hit.matchKind === "phrase" ? 10 : 6;
      } else {
        const blCount = idx.backlinks.get(entry.path)?.length || 0;
        const rank = (hit.matchKind === "phrase" ? 28 : 20) + Math.min(6, Math.floor(blCount / 3));
        matchesByPath.set(entry.path, {
          path: entry.path,
          name: entry.name,
          type: entry.type,
          def: entry.def,
          domain: entry.domain || entry.category,
          tags: entry.tags,
          bodyLen: entry.bodyLen,
          backlinkCount: blCount,
          snippet: hit.snippet || "",
          why: [label],
          _rank: rank
        });
      }
    }
  }
  const matches = [...matchesByPath.values()];
  matches.sort((a, b) => b._rank - a._rank || b.backlinkCount - a.backlinkCount || a.path.localeCompare(b.path));
  const filteredMatches = [];
  for (const m of matches) {
    if (filteredMatches.length >= wantK) break;
    if (idx.stats?.cacheHit) {
      try {
        if (isPrivateFrontmatter(readRawNote(vault, m.path))) continue;
      } catch {
        continue;
      }
    }
    filteredMatches.push(m);
  }
  const totalMatches = idx.stats?.cacheHit ? filteredMatches.length : matches.length;
  const items = filteredMatches.map(({ _rank, ...rest }) => rest);
  return {
    query: q,
    engine: idx.stats.ftsEngine || "json-fallback",
    totalMatches,
    omittedCount: Math.max(0, totalMatches - items.length),
    items
  };
}
function formatVaultFind(res) {
  if (!res || !res.items.length) {
    return `\u5168\u5E93\u672A\u627E\u5230\u5339\u914D\u300C${res?.query || ""}\u300D\u7684\u975E\u79C1\u5BC6\u7B14\u8BB0\u3002`;
  }
  const blocks = res.items.map((it, i) => {
    const meta = [it.type ? `[${it.type}]` : "", it.domain ? `\u9886\u57DF:${it.domain}` : "", it.backlinkCount ? `\u53CD\u94FE:${it.backlinkCount}` : ""].filter(Boolean).join(" \xB7 ");
    const rows = [`${i + 1}. [[${it.name}]] (${it.path})${meta ? ` \u2014 ${meta}` : ""}`];
    if (it.def) rows.push(`   def\uFF1A${it.def}`);
    else if (it.bodyLen <= 50 && it.backlinkCount) rows.push(`   \u6B63\u6587\u8F83\u77ED\uFF08\u5185\u5BB9\u4E3B\u8981\u5206\u5E03\u5728 ${it.backlinkCount} \u6761\u53CD\u94FE\u4E2D\uFF09`);
    if (it.snippet) rows.push(`   \u7247\u6BB5\uFF1A${it.snippet.replace(/\s+/g, " ").trim().slice(0, 140)}`);
    rows.push(`   \u547D\u4E2D\uFF1A${it.why.join("\uFF1B")}`);
    return rows.join("\n");
  });
  const tail = res.omittedCount > 0 ? `
\uFF08\u5171\u5339\u914D ${res.totalMatches} \u7BC7\uFF0C\u5DF2\u663E\u793A\u524D ${res.items.length} \u7BC7\uFF0C\u7701\u7565 ${res.omittedCount} \u7BC7\uFF1B\u53EF\u52A0 --k \u6216\u7F29\u5C0F\u7B5B\u9009\u6761\u4EF6\uFF09` : "";
  return withBudget(blocks) + tail;
}
function vaultOutline(vault, ref, { readOverride = null, indexOpts = {} } = {}) {
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `\u76EE\u6807\u7B14\u8BB0\u53D7\u9690\u79C1\u8BBE\u7F6E\u4FDD\u62A4\uFF0C\u7981\u6B62\u8BFB\u53D6\uFF1A${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  let raw = "";
  try {
    raw = readRawNote(vault, relPath, readOverride);
  } catch (e) {
    return { ok: false, error: `\u8BFB\u53D6\u7B14\u8BB0\u5931\u8D25\uFF08${relPath}\uFF09\uFF1A${e?.message || e}` };
  }
  if (isPrivateFrontmatter(raw)) {
    return { ok: false, blockedPrivate: true, error: `\u76EE\u6807\u7B14\u8BB0\u53D7\u9690\u79C1\u8BBE\u7F6E\u4FDD\u62A4\uFF0C\u7981\u6B62\u8BFB\u53D6\uFF1A${relPath}` };
  }
  const mcpCfg = mcpSettingsOf(vault, { configDir: indexOpts?.configDir || "" });
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = mcpCfg.excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : /* @__PURE__ */ new Set();
  const headings = [];
  const listSummary = [];
  const anchors = [];
  for (let i = fmEnd; i < lines.length; i++) {
    if (fenced.has(i) || aiLines.has(i)) continue;
    const line = lines[i];
    const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (hm) headings.push({ level: hm[1].length, title: hm[2].trim(), line: i + 1 });
    const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (lm && width(line) === 0) {
      const ordered = /^\d/.test(lm[2]);
      const snippet = lm[3].replace(BLOCK_ID_SUFFIX_RE, "").trim().slice(0, 60);
      listSummary.push({ line: i + 1, kind: ordered ? "\u6709\u5E8F\u5217\u8868\u9879" : "\u65E0\u5E8F\u5217\u8868\u9879", snippet });
    }
    const bm = BLOCK_ID_SUFFIX_RE.exec(line);
    if (bm && !isInternalTaskBlockId(bm[1])) {
      anchors.push({ id: bm[1], line: i + 1, snippet: line.replace(BLOCK_ID_SUFFIX_RE, "").trim().slice(0, 60) });
    }
  }
  return {
    ok: true,
    path: relPath,
    totalLines: lines.length,
    bodyStartLine: fmEnd + 1,
    skippedAiLines: aiLines.size,
    okf: extractOkfSummaryParts(meta, { keys: OKF_VAULT_KEYS, maxKeys: OKF_VAULT_KEYS.length }),
    headings,
    listSummary,
    anchors,
    backlinkCount: idx.backlinks.get(relPath)?.length || 0,
    sonsCount: idx.sonsByFather.get(relPath)?.length || 0,
    candidates: resolved.candidates
  };
}
function formatVaultOutline(res) {
  if (!res?.ok) return res?.error || "\u65E0\u6CD5\u751F\u6210\u5927\u7EB2";
  const rows = [`\u5927\u7EB2\uFF1A${res.path}\uFF08\u5171 ${res.totalLines} \u884C\uFF0C\u6B63\u6587\u4ECE L${res.bodyStartLine} \u8D77\uFF09`];
  if (res.candidates?.length > 1) rows.push(`\u540C\u540D\u5019\u9009\uFF08\u5F53\u524D\u53D6\u6700\u77ED/\u540C\u76EE\u5F55\uFF09\uFF1A${res.candidates.join("\u3001")}`);
  if (res.skippedAiLines > 0) rows.push(`\u5DF2\u8FC7\u6EE4\uFF1A\u8DF3\u8FC7 ${res.skippedAiLines} \u884C AI \u81EA\u52A8\u8BB0\u5F55\uFF08\u4EC5\u5C55\u793A\u7528\u6237\u7B14\u8BB0\u7ED3\u6784\uFF09`);
  if (res.okf.length) rows.push(`\u5C5E\u6027\uFF1A${res.okf.join(" | ")}`);
  if (res.backlinkCount || res.sonsCount) rows.push(`\u7ED3\u6784\u7EDF\u8BA1\uFF1A\u53CD\u94FE ${res.backlinkCount} \u6761 \xB7 \u5B50\u6982\u5FF5 ${res.sonsCount} \u7BC7`);
  if (res.headings.length) {
    rows.push("\u7AE0\u8282\u6811\uFF08\u53EA\u5217\u7ED3\u6784\uFF0C\u4E0D\u542B\u6B63\u6587\uFF09\uFF1A");
    const maxH = 40;
    for (const h of res.headings.slice(0, maxH)) {
      rows.push(`${"  ".repeat(Math.max(0, h.level - 1))}- ${"#".repeat(h.level)} ${h.title} (L${h.line})`);
    }
    if (res.headings.length > maxH) rows.push(`  \uFF08\u5DF2\u7701\u7565 ${res.headings.length - maxH} \u4E2A\u540E\u7EED\u6807\u9898\uFF09`);
  } else if (res.listSummary.length) {
    rows.push("\u9876\u5C42\u5217\u8868\u9879\uFF1A");
    for (const item of res.listSummary.slice(0, 20)) {
      rows.push(`- [${item.kind}] L${item.line}: ${item.snippet}`);
    }
    if (res.listSummary.length > 20) rows.push(`  \uFF08\u5DF2\u7701\u7565 ${res.listSummary.length - 20} \u6761\u9876\u5C42\u5217\u8868\uFF09`);
  } else {
    rows.push("\uFF08\u65E0\u6807\u9898\u6216\u9876\u5C42\u5217\u8868\u7ED3\u6784\uFF0C\u53EF\u76F4\u63A5\u7528 vault_read \u8BFB\u53D6\uFF09");
  }
  if (res.anchors.length) {
    rows.push(`\u53EF\u7528\u5757\u951A\u70B9\uFF08${res.anchors.length} \u4E2A\uFF09\uFF1A`);
    for (const a of res.anchors.slice(0, 20)) rows.push(`- ^${a.id} (L${a.line}): ${a.snippet}`);
    if (res.anchors.length > 20) rows.push(`  \uFF08\u5DF2\u7701\u7565 ${res.anchors.length - 20} \u4E2A\u951A\u70B9\uFF09`);
  }
  return rows.join("\n");
}
function vaultRead(vault, ref, {
  startLine = 0,
  startChar = 0,
  maxLines = 120,
  maxChars = 6e3,
  expectedHash = "",
  includeAiLogs = void 0,
  readOverride = null,
  indexOpts = {}
} = {}) {
  const mcpCfg = mcpSettingsOf(vault, { configDir: indexOpts?.configDir || "" });
  const effectiveIncludeAiLogs = typeof includeAiLogs === "boolean" ? includeAiLogs : !mcpCfg.excludeAiLogs;
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `\u76EE\u6807\u7B14\u8BB0\u53D7\u9690\u79C1\u8BBE\u7F6E\u4FDD\u62A4\uFF0C\u7981\u6B62\u8BFB\u53D6\uFF1A${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  let raw = "";
  try {
    raw = readRawNote(vault, relPath, readOverride);
  } catch (e) {
    return { ok: false, error: `\u8BFB\u53D6\u7B14\u8BB0\u5931\u8D25\uFF08${relPath}\uFF09\uFF1A${e?.message || e}` };
  }
  if (isPrivateFrontmatter(raw)) {
    return { ok: false, blockedPrivate: true, error: `\u76EE\u6807\u7B14\u8BB0\u53D7\u9690\u79C1\u8BBE\u7F6E\u4FDD\u62A4\uFF0C\u7981\u6B62\u8BFB\u53D6\uFF1A${relPath}` };
  }
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = effectiveIncludeAiLogs ? /* @__PURE__ */ new Set() : aiGeneratedLineIndices(lines, { startLine: fmEnd });
  const subpath = resolved.subpath || "";
  let sliceStart = 0;
  let sliceEnd = lines.length;
  let mode = "full";
  if (subpath.startsWith("^")) {
    mode = "block";
    const wantId = subpath.slice(1);
    const hitIdx = lines.findIndex((l, i) => !fenced.has(i) && (BLOCK_ID_SUFFIX_RE.exec(l)?.[1] || "") === wantId);
    if (hitIdx < 0) {
      return { ok: false, error: `\u951A\u70B9\u5DF2\u6F02\u79FB\u6216\u4E0D\u5B58\u5728\uFF1A\u5728 ${relPath} \u4E2D\u627E\u4E0D\u5230\u5757 #^${wantId}\uFF08\u7EDD\u4E0D\u56DE\u9000\u6587\u4EF6\u5F00\u5934\uFF09\u3002` };
    }
    if (!effectiveIncludeAiLogs && aiLines.has(hitIdx)) {
      return {
        ok: false,
        blockedAiLog: true,
        error: `\u76EE\u6807\u5757\u5C5E\u4E8E AI \u81EA\u52A8\u751F\u6210\u7684\u65E5\u5FD7\u8BB0\u5F55\uFF0C\u9ED8\u8BA4\u4E0D\u4F5C\u4E3A\u7528\u6237\u6570\u636E\u8BFB\u53D6\uFF08\u5DF2\u6C89\u6DC0\u7ED3\u8BBA\u8BF7\u67E5 memory_search\uFF1B\u82E5\u786E\u9700\u6392\u67E5\u539F\u59CB\u65E5\u5FD7\uFF0C\u8BF7\u4F20 include_ai_logs=true\uFF09\uFF1A${relPath}#${subpath}`
      };
    }
    sliceStart = hitIdx;
    sliceEnd = subtreeEnd(lines, hitIdx);
  } else if (subpath) {
    mode = "heading";
    const sec = findHeadingRange(lines, subpath, { fenced });
    if (!sec) {
      const avail = (meta?.headings || []).slice(0, 8).map((h) => `${h.title}(L${h.line})`).join("\u3001");
      return { ok: false, error: `\u627E\u4E0D\u5230\u7AE0\u8282\uFF1A${relPath}#${subpath}${avail ? `\uFF08\u53EF\u7528\u7AE0\u8282\uFF1A${avail}\uFF09` : ""}` };
    }
    sliceStart = sec.start;
    sliceEnd = sec.end;
  } else {
    sliceStart = fmEnd;
  }
  if (Number(startLine) > 0) {
    const reqStart = Math.max(0, Number(startLine) - 1);
    if (!subpath) {
      mode = "slice";
      sliceStart = Math.min(lines.length, reqStart);
    } else {
      sliceStart = Math.min(sliceEnd, Math.max(sliceStart, reqStart));
    }
  }
  const filtered = [];
  let skippedAiLines = 0;
  for (let i = sliceStart; i < sliceEnd; i++) {
    if (aiLines.has(i)) {
      skippedAiLines++;
      continue;
    }
    const text = cleanUserNoteLine(lines[i], { inFence: fenced.has(i) });
    if (skippedAiLines > 0 && !text.trim() && filtered.length && !filtered[filtered.length - 1].text.trim()) {
      continue;
    }
    filtered.push({ origIdx: i, text });
  }
  while (skippedAiLines > 0 && filtered.length && !filtered[0].text.trim()) filtered.shift();
  const leadText = filtered.filter((e) => e.text.trim()).slice(0, 3).map((e) => e.text).join("\n");
  const hPath = headingPathAt(lines, sliceStart, fenced);
  const anchorHash = computeAnchorHash(`${hPath}
${leadText}`);
  const changedSinceDispatch = Boolean(expectedHash && expectedHash !== anchorHash);
  const lineBudget = Math.max(10, Math.min(400, Number(maxLines) || 120));
  const charBudget = Math.max(400, Math.min(2e4, Number(maxChars) || 6e3));
  const reqStartChar = Math.max(0, Number(startChar) || 0);
  const picked = [];
  let chars = 0;
  let truncated = false;
  let nextStartLineOverride = 0;
  let nextStartChar = 0;
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    if (picked.length >= lineBudget) {
      if (filtered.slice(i).some((x) => x.text.trim())) truncated = true;
      break;
    }
    const offset = picked.length === 0 ? Math.min(reqStartChar, entry.text.length) : 0;
    const lineText = offset > 0 ? entry.text.slice(offset) : entry.text;
    if (!picked.length && lineText.length > charBudget) {
      picked.push({ origIdx: entry.origIdx, text: lineText.slice(0, charBudget) });
      truncated = true;
      nextStartLineOverride = entry.origIdx + 1;
      nextStartChar = offset + charBudget;
      break;
    }
    if (picked.length && chars + lineText.length + 1 > charBudget) {
      truncated = true;
      break;
    }
    picked.push({ origIdx: entry.origIdx, text: lineText });
    chars += lineText.length + 1;
  }
  const shownFrom = picked.length ? picked[0].origIdx + 1 : sliceStart + 1;
  const shownTo = picked.length ? picked[picked.length - 1].origIdx + 1 : shownFrom;
  const remainingHeadings = truncated ? collectRemainingHeadings(lines, { fromIdx: shownTo, endIdx: sliceEnd, maxLevel: 4, maxItems: 6, fenced, skipLines: aiLines }).map((h) => `${h.hashes} ${h.title}(L${h.line})`) : [];
  let backlinkFallback = null;
  if (!subpath && Number(startLine) <= 0) {
    const nonSpaceBody = filtered.map((e) => e.text).join("").replace(/\s+/g, "");
    if (nonSpaceBody.length <= 50) {
      const allBl = idx.backlinks.get(relPath) || [];
      if (allBl.length > 30) {
        backlinkFallback = { broadTopic: true, totalBacklinks: allBl.length, excerpts: [] };
      } else if (allBl.length > 0) {
        const targetNames = new Set([meta?.name, ...meta?.aliases || [], relPath.replace(/\.md$/i, "")].map((n) => normalizeLinkName(n).toLowerCase()).filter(Boolean));
        backlinkFallback = {
          broadTopic: false,
          totalBacklinks: allBl.length,
          excerpts: extractBacklinkBlocks(vault, allBl, { limit: 3, maxCharsPerBlock: 200, readOverride, targetNames })
        };
      }
    }
  }
  const childAnchors = [];
  for (let i = sliceStart; i < sliceEnd; i++) {
    if (fenced.has(i) || aiLines.has(i)) continue;
    const bm = BLOCK_ID_SUFFIX_RE.exec(lines[i]);
    if (bm && !isInternalTaskBlockId(bm[1])) childAnchors.push(`^${bm[1]}(L${i + 1})`);
    if (childAnchors.length >= 8) break;
  }
  return {
    ok: true,
    path: relPath,
    absPath: path5.join(vault, ...relPath.split("/").filter(Boolean)),
    subpath,
    mode,
    totalLines: lines.length,
    shownFrom,
    shownTo,
    skippedAiLines,
    truncated,
    nextStartLine: truncated ? nextStartLineOverride || shownTo + 1 : 0,
    nextStartChar: truncated ? nextStartChar : 0,
    remainingHeadings,
    okf: extractOkfSummaryParts(meta, { keys: OKF_VAULT_KEYS, maxKeys: OKF_VAULT_KEYS.length }),
    anchorHash,
    changedSinceDispatch,
    expectedHash,
    childAnchors,
    content: picked.map((e) => e.text).join("\n").trimEnd(),
    backlinkFallback
  };
}
function formatVaultRead(res) {
  if (!res?.ok) return res?.error || "\u8BFB\u53D6\u5931\u8D25";
  const rows = [
    `\u7B14\u8BB0\uFF1A${res.path}${res.subpath ? `#${res.subpath}` : ""}\uFF08L${res.shownFrom}\u2013L${res.shownTo} / \u5171 ${res.totalLines} \u884C \xB7 anchorHash=${res.anchorHash}\uFF09`,
    `\u7EDD\u5BF9\u8DEF\u5F84\uFF1A${res.absPath}`
  ];
  if (res.changedSinceDispatch) {
    rows.push(`\u26A0\uFE0F \u539F\u6587\u951A\u70B9\u5DF2\u6F02\u79FB\uFF08\u6D3E\u53D1\u65F6=${res.expectedHash}\uFF0C\u5F53\u524D=${res.anchorHash}\uFF09\uFF0C\u6B64\u524D\u6CE8\u5165\u6458\u8981\u53EF\u80FD\u8FC7\u671F\uFF0C\u8BF7\u4EE5\u672C\u6B21\u6B63\u6587\u4E3A\u51C6\u3002`);
  }
  if (res.skippedAiLines > 0) {
    rows.push(`\u5DF2\u8FC7\u6EE4\uFF1A\u8DF3\u8FC7 ${res.skippedAiLines} \u884C AI \u81EA\u52A8\u8BB0\u5F55\uFF08\u4E0D\u89C6\u4F5C\u7528\u6237\u6570\u636E\uFF1B\u5DF2\u6C89\u6DC0\u7ED3\u8BBA\u8BF7\u7528 memory_search\uFF09`);
  }
  if (res.okf.length) rows.push(`\u5C5E\u6027\uFF1A${res.okf.join(" | ")}`);
  if (res.childAnchors.length) rows.push(`\u6BB5\u5185\u951A\u70B9\uFF1A${res.childAnchors.join("\u3001")}`);
  rows.push("", res.content || "\uFF08\u6B63\u6587\u4E3A\u7A7A\uFF09");
  if (res.backlinkFallback) {
    const fb = res.backlinkFallback;
    if (fb.broadTopic) {
      rows.push("", `\u53CD\u94FE\u9000\u8DEF\uFF1A\u5BBD\u6CDB\u9886\u57DF\u8BCD\uFF0C\u5171 ${fb.totalBacklinks} \u6761\u53CD\u94FE\uFF08\u8D85\u8FC7 30 \u6761\u4E0D\u5C55\u5F00\uFF0C\u53EF\u7528 vault_related \u6216\u641C\u7D22\u5177\u4F53\u7B14\u8BB0\uFF09\u3002`);
    } else if (fb.excerpts.length) {
      rows.push("", `\u6B63\u6587\u8F83\u5C11\uFF0C\u5DF2\u4ECE ${fb.totalBacklinks} \u6761\u53CD\u94FE\u4E2D\u62BD\u53D6 ${fb.excerpts.length} \u6761\u9AD8\u4FE1\u53F7\u7247\u6BB5\uFF1A`);
      for (const ex of fb.excerpts) {
        rows.push(`- [${ex.why}]
  ${ex.text.replace(/\n/g, "\n  ")}`);
      }
      if (fb.totalBacklinks > fb.excerpts.length) {
        rows.push(`  \uFF08\u5171 ${fb.totalBacklinks} \u6761\u53CD\u94FE\uFF0C\u5DF2\u5185\u8054 ${fb.excerpts.length} \u6761\uFF0C\u5176\u4F59\u53EF\u7528 vault_related \u67E5\u770B\uFF09`);
      }
    }
  }
  if (res.truncated) {
    const toc = res.remainingHeadings.length ? `\uFF1B\u540E\u7EED\u7AE0\u8282\uFF1A${res.remainingHeadings.join(" | ")}` : "";
    const cursor = res.nextStartChar > 0 ? `start_line=${res.nextStartLine}, start_char=${res.nextStartChar}` : `start_line=${res.nextStartLine}`;
    rows.push("", `\uFF08\u5DF2\u6309\u9884\u7B97\u622A\u65AD\uFF0C\u53EF\u7528 ${cursor} \u7EED\u8BFB${toc}\uFF09`);
  }
  return rows.join("\n");
}
function vaultRelated(vault, ref, { k = 8, indexOpts = {} } = {}) {
  const wantK = Math.max(1, Math.min(20, Number(k) || 8));
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `\u76EE\u6807\u7B14\u8BB0\u53D7\u9690\u79C1\u8BBE\u7F6E\u4FDD\u62A4\uFF0C\u7981\u6B62\u8BBF\u95EE\uFF1A${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  const items = [];
  const seen = /* @__PURE__ */ new Set([relPath]);
  const pushItem = (targetPath, kind, why, extra = {}) => {
    if (!targetPath || seen.has(targetPath) || idx.privatePaths.has(targetPath) || idx.generatedPaths?.has(targetPath)) return;
    seen.add(targetPath);
    const targetMeta = idx.byPath.get(targetPath);
    items.push({
      path: targetPath,
      name: targetMeta?.name || path5.posix.basename(targetPath, ".md"),
      kind,
      why,
      trust: targetMeta?.verified ? "verified" : "",
      stale: Boolean(targetMeta?.staleAfter && Date.parse(targetMeta.staleAfter) < Date.now()),
      ...extra
    });
  };
  if (meta?.father) {
    const fRes = idx.resolveNote(normalizeLinkName(meta.father), relPath);
    if (fRes.path) pushItem(fRes.path, "father", `\u7236\u6982\u5FF5 (father: ${meta.father})`);
  }
  for (const sonPath of idx.sonsByFather.get(relPath) || []) {
    pushItem(sonPath, "son", `\u5B50\u6982\u5FF5 (father \u6307\u5411 [[${meta.name}]])`);
  }
  const domainTarget = meta?.domain || meta?.category || "";
  if (domainTarget) {
    const dRes = idx.resolveNote(normalizeLinkName(domainTarget), relPath);
    if (dRes.path) pushItem(dRes.path, "domain", `\u6240\u5C5E\u9886\u57DF (domain: ${domainTarget})`);
  }
  const bls = [...idx.backlinks.get(relPath) || []].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    return b.sourcePath.localeCompare(a.sourcePath) || a.line - b.line;
  });
  for (const bl of bls) {
    pushItem(bl.sourcePath, "backlink", `${bl.strong ? "\u5F3A\u4FE1\u53F7\u53CD\u94FE" : "\u53E5\u4E2D\u53CD\u94FE"} \xB7 ${bl.sourcePath.replace(/\.md$/i, "")}(L${bl.line})`);
  }
  for (const lk of meta?.links || []) {
    const dest = idx.resolveNote(lk.target, relPath);
    if (dest.path) pushItem(dest.path, "outlink", `\u672C\u6587\u5F15\u7528 (L${lk.line})`);
  }
  const memories = [];
  try {
    const { entries } = loadMemories(vault, { configDir: indexOpts.configDir || "" });
    const wantLow = meta.name.toLowerCase();
    const aliasLows = new Set((meta.aliases || []).map((a) => a.toLowerCase()));
    for (const m of activeMemories(entries)) {
      const mConcepts = [...m.concepts || [], ...m.projectLink ? [m.projectLink] : []].map((c) => normalizeLinkName(c).toLowerCase());
      const mSources = (m.sourceNotes?.length ? m.sourceNotes : m.sources).map((s) => normalizeLinkName(s).toLowerCase());
      const hitConcept = mConcepts.some((c) => c === wantLow || aliasLows.has(c));
      const hitSource = mSources.some((s) => s === wantLow || s === relPath.replace(/\.md$/i, "").toLowerCase());
      if (hitConcept || hitSource) {
        memories.push({
          id: m.id,
          name: m.name,
          kind: m.type || m.kind,
          text: m.text,
          why: hitConcept ? `\u5173\u8054\u6982\u5FF5\u8BB0\u5FC6 [${m.type || m.kind}]` : `\u63D0\u70BC\u81EA\u672C\u7B14\u8BB0 [${m.type || m.kind}]`
        });
      }
    }
  } catch {
  }
  const totalItems = items.length;
  const shownItems = items.slice(0, wantK);
  const shownMemories = memories.slice(0, Math.max(3, Math.min(6, wantK)));
  return {
    ok: true,
    path: relPath,
    name: meta.name,
    totalItems,
    omittedItems: Math.max(0, totalItems - shownItems.length),
    items: shownItems,
    totalMemories: memories.length,
    memories: shownMemories
  };
}
function formatVaultRelated(res) {
  if (!res?.ok) return res?.error || "\u67E5\u8BE2\u5173\u8054\u5931\u8D25";
  const rows = [`\u7ED3\u6784\u90BB\u63A5\uFF1A[[${res.name}]] (${res.path})`];
  if (res.items.length) {
    rows.push(`\u5173\u8054\u7B14\u8BB0\uFF08\u663E\u793A ${res.items.length} / \u5171 ${res.totalItems} \u7BC7\uFF09\uFF1A`);
    for (const it of res.items) {
      const flags = [it.trust === "verified" ? "\u2713" : "", it.stale ? "\u8FC7\u671F" : ""].filter(Boolean).join(" ");
      rows.push(`- [[${it.name}]] (${it.path})${flags ? ` [${flags}]` : ""} \u2014 ${it.why}`);
    }
    if (res.omittedItems > 0) rows.push(`  \uFF08\u5DF2\u7701\u7565 ${res.omittedItems} \u7BC7\u5173\u8054\u7B14\u8BB0\uFF0C\u53EF\u52A0\u5927 k \u67E5\u770B\uFF09`);
  } else {
    rows.push("\u5173\u8054\u7B14\u8BB0\uFF1A\u6682\u65E0\u663E\u5F0F\u7ED3\u6784\u8FB9\u6216\u975E\u79C1\u5BC6\u53CD\u94FE\u3002");
  }
  if (res.memories.length) {
    rows.push(`\u5173\u8054\u957F\u671F\u8BB0\u5FC6\uFF08\u663E\u793A ${res.memories.length} / \u5171 ${res.totalMemories} \u6761\uFF09\uFF1A`);
    for (const m of res.memories) rows.push(`- [[${m.name}]] (${m.id}) \u2014 ${m.why}\uFF1A${m.text}`);
  }
  return rows.join("\n");
}

// src/context-core/mcp.js
var SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
var DEFAULT_PROTOCOL_VERSION = "2024-11-05";
var MAX_STDIO_HEADER_BYTES = 64 * 1024;
var MAX_STDIO_FRAME_BYTES = 4 * 1024 * 1024;
var MEMORY_TOOLS = [
  {
    name: "memory_index",
    description: "\u6D4F\u89C8 Agent Deck \u957F\u671F\u8BB0\u5FC6\u76EE\u5F55\u6982\u89C8\uFF1A\u6309\u7C7B\u578B\u4E0E\u9879\u76EE\u7EDF\u8BA1\u5206\u5E03\uFF0C\u5E76\u5217\u51FA\u8FD1\u671F/\u5DF2\u786E\u8BA4\u8BB0\u5FC6\u6807\u9898\u3002\u5F00\u59CB\u4EFB\u52A1\u524D\u8C03\u7528\u53EF\u5FEB\u901F\u4E86\u89E3\u6709\u54EA\u4E9B\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6\u53EF\u67E5\u3002",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"], description: "\u6309\u8BB0\u5FC6\u7C7B\u578B\u8FC7\u6EE4" },
        project: { type: "string", description: "\u6309\u9879\u76EE\u540D\u8FC7\u6EE4" },
        limit: { type: "integer", minimum: 1, maximum: 60, description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570\uFF0C\u9ED8\u8BA4 30" }
      }
    }
  },
  {
    name: "memory_search",
    description: "\u6309\u5173\u952E\u8BCD\u68C0\u7D22 Agent Deck \u957F\u671F\u8BB0\u5FC6\uFF08\u652F\u6301\u4E2D\u82F1\u6587\u6DF7\u5408\u8BCD\u5982 A\u80A1\u3001\u6280\u672F\u8BCD\u3001\u9879\u76EE\u540D\u3001\u65F6\u95F4\u7A97\uFF09\uFF0C\u8FD4\u56DE\u5339\u914D\u539F\u56E0\u3001\u6765\u6E90\u65E5\u8BB0\u5757\u53F7\u4E0E\u53D6\u4EE3\u94FE\u3002",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "\u68C0\u7D22\u5173\u952E\u8BCD\u6216\u77ED\u8BED" },
        k: { type: "integer", minimum: 1, maximum: 20, description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650\uFF0C\u9ED8\u8BA4 5" },
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
        project: { type: "string", description: "\u9650\u5B9A\u9879\u76EE\u540D" },
        since: { type: "string", description: "\u8D77\u59CB\u65E5\u671F YYYY-MM-DD" },
        until: { type: "string", description: "\u7ED3\u675F\u65E5\u671F YYYY-MM-DD" },
        verified_only: { type: "boolean", description: "\u53EA\u770B\u5DF2\u4EBA\u5DE5\u786E\u8BA4\u7684\u8BB0\u5FC6" },
        trust: { type: "string", enum: ["human", "user", "ai"], description: "\u6309\u53EF\u4FE1\u5EA6\u8FC7\u6EE4\uFF08human=\u5DF2\u4EBA\u5DE5\u786E\u8BA4 / user=\u7528\u6237\u65E5\u5FD7 / ai=AI\u63D0\u70BC\uFF09" },
        include_stale: { type: "boolean", description: "\u5305\u542B\u5DF2\u8FC7\u590D\u6838\u622A\u6B62\u671F\u7684\u8BB0\u5FC6" },
        include_inactive: { type: "boolean", description: "\u5305\u542B\u5DF2\u88AB\u66FF\u4EE3\u7684\u5386\u53F2\u6761\u76EE" }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_read",
    description: "\u8BFB\u53D6\u5355\u6761\u957F\u671F\u8BB0\u5FC6\u7684\u5B8C\u6574\u6B63\u6587\u3001\u6765\u6E90\u65E5\u8BB0\u94FE\u63A5\u3001\u53D6\u4EE3\u94FE\u4E0E\u6807\u7B7E\uFF08\u53EA\u8BFB\uFF0Cprivate \u8BB0\u5FC6\u4E0D\u53EF\u89C1\uFF09\u3002",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "\u8BB0\u5FC6\u6587\u4EF6\u540D\uFF08\u4E0D\u542B\u8DEF\u5F84\uFF09\u6216\u8BB0\u5FC6 id\uFF08m-...\uFF09" }
      },
      required: ["ref"]
    }
  },
  {
    name: "memory_recent",
    description: "\u6309\u65F6\u95F4\u5012\u5E8F\u5217\u51FA\u6700\u8FD1\u6C89\u6DC0\u7684\u957F\u671F\u8BB0\u5FC6\u3002",
    inputSchema: {
      type: "object",
      properties: {
        n: { type: "integer", minimum: 1, maximum: 30, description: "\u8FD4\u56DE\u6761\u6570\uFF0C\u9ED8\u8BA4 10" },
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
        project: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        verified_only: { type: "boolean" },
        trust: { type: "string", enum: ["human", "user", "ai"], description: "\u6309\u53EF\u4FE1\u5EA6\u8FC7\u6EE4\uFF08human=\u5DF2\u4EBA\u5DE5\u786E\u8BA4 / user=\u7528\u6237\u65E5\u5FD7 / ai=AI\u63D0\u70BC\uFF09" },
        include_stale: { type: "boolean", description: "\u5305\u542B\u5DF2\u8FC7\u590D\u6838\u622A\u6B62\u671F\u7684\u6709\u6548\u8BB0\u5FC6\uFF08\u9ED8\u8BA4\u5305\u542B\uFF09" },
        include_inactive: { type: "boolean", description: "\u5305\u542B\u5DF2\u88AB\u66FF\u4EE3/\u5DF2\u5F52\u6863\u7684\u5386\u53F2\u6761\u76EE" }
      }
    }
  },
  {
    name: "memory_graph",
    description: "\u6CBF Obsidian \u56FE\u8C31\u8FB9\uFF08concepts / project_link / source_notes / supersedes\uFF09\u505A 1-2 \u8DF3\u5173\u8054\u6F2B\u6E38\u3002\u53EF\u4F20\u8BB0\u5FC6\u540D\u3001m-... ID \u6216\u6982\u5FF5\u540D\uFF08\u5982 Obsidian / \u5FC3\u667A\u6A21\u578B\uFF09\u3002",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "\u8BB0\u5FC6\u6587\u4EF6\u540D\u3001id\uFF08m-...\uFF09\u6216\u6982\u5FF5/\u9879\u76EE\u540D" },
        depth: { type: "integer", minimum: 1, maximum: 2, description: "\u56FE\u8C31\u904D\u5386\u6DF1\u5EA6\uFF0C\u9ED8\u8BA4 2" }
      },
      required: ["ref"]
    }
  }
];
var VAULT_TOOLS = [
  {
    name: "vault_find",
    description: "\u6309\u6807\u9898\u3001aliases\u3001def\u3001domain\u3001tags\u3001\u7AE0\u8282\u4E0E SQLite FTS5 \u6B63\u6587\u5168\u6587\u5728\u5168\u5E93\u7528\u6237\u7B14\u8BB0\u4E2D\u5B9A\u4F4D\u5165\u53E3\uFF08\u81EA\u52A8\u6392\u9664\u79C1\u5BC6\u7B14\u8BB0\u3001AI \u81EA\u52A8\u8BB0\u5F55\u4E0E\u63D2\u4EF6\u751F\u6210\u76EE\u5F55\uFF1B\u5DF2\u6C89\u6DC0\u8BB0\u5FC6\u8BF7\u7528 memory_search\uFF09\u3002",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "\u68C0\u7D22\u5173\u952E\u8BCD\u3001\u77ED\u8BED\u6216\u7B14\u8BB0\u540D" },
        k: { type: "integer", minimum: 1, maximum: 30, description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650\uFF0C\u9ED8\u8BA4 8" },
        domain: { type: "string", description: "\u6309 domain/category \u8FC7\u6EE4" },
        type: { type: "string", description: "\u6309 frontmatter type \u8FC7\u6EE4" },
        tag: { type: "string", description: "\u6309\u6807\u7B7E\u8FC7\u6EE4\uFF08\u4E0D\u542B #\uFF09" },
        fulltext: { type: "boolean", description: "\u662F\u5426\u542F\u7528 SQLite FTS5 \u6B63\u6587\u5168\u6587\u68C0\u7D22\uFF08\u9ED8\u8BA4 true\uFF09" }
      },
      required: ["query"]
    }
  },
  {
    name: "vault_outline",
    description: "\u53EA\u8BFB\u83B7\u53D6\u5355\u7BC7\u7528\u6237\u7B14\u8BB0\u7684\u7AE0\u8282\u5927\u7EB2\u3001\u9876\u5C42\u5217\u8868\u7ED3\u6784\u3001OKF 4-6 \u952E\u5C5E\u6027\u6458\u8981\u4E0E\u53EF\u7528 ^blockId \u951A\u70B9\uFF08\u81EA\u52A8\u8DF3\u8FC7 AI \u81EA\u52A8\u8BB0\u5F55\u884C\uFF0C\u4E0D\u5410\u6B63\u6587\uFF0C\u9002\u5408\u5148\u770B\u76EE\u5F55\u518D\u6309\u6BB5\u8BFB\u53D6\uFF09\u3002",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "\u7B14\u8BB0\u540D\u3001[[\u53CC\u94FE]] \u6216\u5E93\u5185\u76F8\u5BF9\u8DEF\u5F84" }
      },
      required: ["ref"]
    }
  },
  {
    name: "vault_read",
    description: "\u6309\u5F15\u7528\u8BFB\u53D6\u5168\u5E93\u975E\u79C1\u5BC6\u7528\u6237\u7B14\u8BB0\u6B63\u6587\u3001\u6307\u5B9A #\u7AE0\u8282 \u6216 #^\u5757\u53F7\u5B50\u6811\uFF08\u9ED8\u8BA4\u8FC7\u6EE4 AI \u81EA\u52A8\u8BB0\u5F55\u4E0E\u63D2\u4EF6\u751F\u6210\u6587\u4EF6\uFF0C\u652F\u6301 start_line \u5206\u6BB5\u3001expected_hash \u951A\u70B9\u6F02\u79FB\u6821\u9A8C\u4E0E\u53CD\u94FE\u9000\u8DEF\uFF09\u3002",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "\u7B14\u8BB0\u540D\u3001\u8DEF\u5F84\u3001[[\u7B14\u8BB0#\u7AE0\u8282]] \u6216 [[\u7B14\u8BB0#^\u5757\u53F7]]" },
        start_line: { type: "integer", minimum: 1, description: "\u4ECE\u7B2C\u51E0\u884C\u8D77\u5206\u6BB5\u8BFB\u53D6\uFF081-based\uFF09" },
        start_char: { type: "integer", minimum: 0, description: "\u957F\u884C\u5B57\u7B26\u7EED\u8BFB\u504F\u79FB\uFF080-based\uFF09" },
        max_lines: { type: "integer", minimum: 10, maximum: 400, description: "\u5355\u6B21\u6700\u591A\u8FD4\u56DE\u884C\u6570\uFF0C\u9ED8\u8BA4 120" },
        expected_hash: { type: "string", description: "\u6D3E\u53D1\u65F6\u7684 8 \u4F4D\u951A\u70B9\u6307\u7EB9\uFF0C\u7528\u4E8E\u68C0\u6D4B\u539F\u6587\u662F\u5426\u6F02\u79FB" },
        include_ai_logs: { type: "boolean", description: "\u662F\u5426\u5305\u542B AI \u81EA\u52A8\u8BB0\u5F55\uFF08\u9ED8\u8BA4 false\uFF1B\u65E5\u5E38\u5206\u6790\u4FDD\u6301 false\uFF0C\u4EC5\u6392\u67E5\u539F\u59CB\u4F1A\u8BDD\u8BB0\u5F55\u65F6\u663E\u5F0F\u5F00\u542F\uFF09" }
      },
      required: ["ref"]
    }
  },
  {
    name: "vault_related",
    description: "\u83B7\u53D6\u67D0\u7BC7\u7528\u6237\u7B14\u8BB0\u7684\u4E00\u8DF3\u7ED3\u6784\u90BB\u5C45\uFF08father / \u63A8\u5BFC sons / domain / \u5F3A\u4FE1\u53F7\u7528\u6237\u53CD\u94FE / \u51FA\u94FE\uFF09\u4E0E\u5173\u8054 Dream \u8BB0\u5FC6\uFF0C\u81EA\u52A8\u6392\u9664 AI \u81EA\u52A8\u65E5\u5FD7\u6C61\u67D3\u3002",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "\u7B14\u8BB0\u540D\u3001[[\u53CC\u94FE]] \u6216\u5E93\u5185\u76F8\u5BF9\u8DEF\u5F84" },
        k: { type: "integer", minimum: 1, maximum: 20, description: "\u8FD4\u56DE\u5173\u8054\u7B14\u8BB0\u4E0A\u9650\uFF0C\u9ED8\u8BA4 8" }
      },
      required: ["ref"]
    }
  }
];
var PROPOSE_TOOL = {
  name: "memory_propose",
  description: "\u5411 Agent Deck \u8BB0\u5FC6\u5E93\u63D0\u4EA4\u4E00\u6761\u5F85\u4EBA\u5DE5\u786E\u8BA4\u7684\u5019\u9009\u8BB0\u5FC6\uFF08\u4EC5\u5F53 MCP \u670D\u52A1\u4EE5 --allow-write \u542F\u52A8\u65F6\u53EF\u7528\uFF09\u3002",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "\u4E00\u53E5\u5B8C\u6574\u7CBE\u70BC\u7684\u8BB0\u5FC6\u9648\u8FF0\uFF084-500\u5B57\uFF09" },
      kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
      short_title: { type: "string", description: "10-18 \u5B57\u56FE\u8C31\u77ED\u547D\u9898\u6587\u4EF6\u540D\uFF08\u53EF\u9009\uFF09" },
      project: { type: "string", description: "\u9002\u7528\u9879\u76EE\u540D\uFF08\u53EF\u9009\uFF09" },
      project_link: { type: "string", description: "\u9879\u76EE\u53CC\u94FE\uFF08\u5982 [[Agent Deck]]\uFF09" },
      concepts: { type: "array", items: { type: "string" }, description: "\u5173\u8054\u6982\u5FF5\u53CC\u94FE\u5217\u8868\uFF08\u5982 [[RAG]]\uFF09" },
      tags: { type: "array", items: { type: "string" }, description: "\u6700\u591A 5 \u4E2A\u5173\u952E\u8BCD\u6807\u7B7E" },
      description: { type: "string", description: "\u7B80\u77ED\u89E6\u53D1/\u9002\u7528\u6761\u4EF6\u8BF4\u660E\uFF08OKF description\uFF09" },
      domain: { type: "string", description: "\u9886\u57DF\u540D\uFF0C\u5982 engineering / life / finance" },
      source: { type: "string", description: "\u6765\u6E90\u8BF4\u660E\u6216\u4F1A\u8BDD\u5F15\u7528" }
    },
    required: ["text", "kind"]
  }
};
function createMcpServer({ vault = "", allowWrite = false, indexDir = "", configDir = "" } = {}) {
  const resolveRoot = () => {
    const root = vault ? path6.resolve(vault) : resolveVault();
    if (!root || !fs6.existsSync(root)) throw new Error(`\u627E\u4E0D\u5230 Vault \u6839\u76EE\u5F55\uFF1A${vault || "(\u672A\u6307\u5B9A)"}`);
    return root;
  };
  const resolveMcpCfg = () => {
    try {
      const root = vault ? path6.resolve(vault) : resolveVault();
      if (root && fs6.existsSync(root)) return mcpSettingsOf(root, { configDir });
    } catch {
    }
    return { toolsMode: "all", allowWrite: false, excludeAiLogs: true, agentPrompt: "" };
  };
  const resolveTools = () => {
    const cfg = resolveMcpCfg();
    const base = cfg.toolsMode === "memory-only" ? MEMORY_TOOLS : [...MEMORY_TOOLS, ...VAULT_TOOLS];
    return allowWrite ? [...base, PROPOSE_TOOL] : [...base];
  };
  const indexOpts = {
    ...indexDir ? { indexDir, persist: true } : {},
    ...configDir ? { configDir } : {},
    cacheTtlMs: 2500
  };
  const tools = resolveTools();
  const handleToolCall = (name, args = {}) => {
    const root = resolveRoot();
    if (typeof name === "string" && name.startsWith("vault_") && resolveMcpCfg().toolsMode === "memory-only") {
      return {
        isError: true,
        content: [{ type: "text", text: "\u5F53\u524D Dream \u8BBE\u7F6E\u4E2D\u5DF2\u5C06 MCP \u5DE5\u5177\u8303\u56F4\u8BBE\u4E3A\u300C\u4EC5\u957F\u671F\u8BB0\u5FC6 (memory_*)\u300D\uFF0C\u5982\u9700\u68C0\u7D22\u5168\u5E93\u7B14\u8BB0\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u5207\u6362\u4E3A\u300C\u8BB0\u5FC6 + \u5168\u5E93\u7528\u6237\u7B14\u8BB0\u300D\u3002" }]
      };
    }
    if (name === "memory_propose") {
      if (!allowWrite) return { isError: true, content: [{ type: "text", text: "\u5F53\u524D MCP \u670D\u52A1\u5904\u4E8E\u53EA\u8BFB\u6A21\u5F0F\uFF1B\u5982\u9700\u5199\u5165\u5019\u9009\u8BB0\u5FC6\u8BF7\u4F7F\u7528 --allow-write \u542F\u52A8\u3002" }] };
      try {
        const res = proposeMemory(root, {
          ...args,
          shortTitle: args.short_title || "",
          projectLink: args.project_link || "",
          configDir
        });
        const msg = res.rejected ? `\u8BE5\u8BB0\u5FC6\u66FE\u88AB\u4EBA\u5DE5\u62D2\u7EDD\uFF08${res.entry.id}\uFF09\uFF0C\u8DF3\u8FC7\u5199\u5165\u3002` : res.duplicate ? `\u5E93\u5185\u5DF2\u5B58\u5728\u76F8\u540C\u8BB0\u5FC6\uFF08${res.entry.id}\uFF09\uFF0C\u8DF3\u8FC7\u5199\u5165\u3002` : `\u5DF2\u5199\u5165\u5019\u9009\u8BB0\u5FC6\uFF08\u5F85\u7528\u6237\u5BA1\u9605\u786E\u8BA4\uFF09\uFF1A${res.path}`;
        return { content: [{ type: "text", text: msg }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message || String(e) }] };
      }
    }
    if (name === "vault_find") {
      const query = String(args.query || "").trim();
      if (!query && !args.domain && !args.type && !args.tag) {
        return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 query" }] };
      }
      const res = vaultFind(root, query, {
        k: Number(args.k) || 8,
        domain: args.domain || "",
        type: args.type || "",
        tag: args.tag || "",
        fulltext: args.fulltext !== false,
        indexOpts
      });
      return { content: [{ type: "text", text: formatVaultFind(res) }] };
    }
    if (name === "vault_outline") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 ref" }] };
      const res = vaultOutline(root, ref, { indexOpts });
      return { ...res.ok ? {} : { isError: true }, content: [{ type: "text", text: formatVaultOutline(res) }] };
    }
    if (name === "vault_read") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 ref" }] };
      const res = vaultRead(root, ref, {
        startLine: Number(args.start_line) || 0,
        startChar: Number(args.start_char) || 0,
        maxLines: Number(args.max_lines) || 120,
        expectedHash: String(args.expected_hash || ""),
        ...args.include_ai_logs !== void 0 ? { includeAiLogs: Boolean(args.include_ai_logs) } : {},
        indexOpts
      });
      return { ...res.ok ? {} : { isError: true }, content: [{ type: "text", text: formatVaultRead(res) }] };
    }
    if (name === "vault_related") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 ref" }] };
      const res = vaultRelated(root, ref, { k: Number(args.k) || 8, indexOpts });
      return { ...res.ok ? {} : { isError: true }, content: [{ type: "text", text: formatVaultRelated(res) }] };
    }
    const includeArchived = (name === "memory_search" || name === "memory_recent") && Boolean(args.include_inactive);
    const { dir, entries } = loadMemories(root, { includeArchived, configDir });
    const active = entries.filter((e) => e.state === "\u6709\u6548" && !e.private);
    const indexes = buildIndexes(entries);
    if (name === "memory_index") {
      const text = [
        formatIndex(active, { kind: args.kind || "", project: args.project || "", limit: Number(args.limit) || 30 }),
        "",
        formatStats(entries, { vault: root, archivedCount: countArchivedMemories(root, { configDir }) })
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
    if (name === "memory_read") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 ref" }] };
      let readEntries = entries;
      let hit = findMemory(readEntries, dir, ref);
      if (!hit) {
        readEntries = loadMemories(root, { includeArchived: true, configDir }).entries;
        hit = findMemory(readEntries, dir, ref);
      }
      if (!hit) return { isError: true, content: [{ type: "text", text: `\u627E\u4E0D\u5230\u8BB0\u5FC6\uFF1A${ref}` }] };
      const readIndexes = buildIndexes(readEntries);
      const extras = {
        supersedes: (hit.supersedes || []).map((id) => readIndexes.resolveRef(id) || id),
        supersededBy: readIndexes.supersededBy.get(hit.id) || readIndexes.supersededBy.get(hit.name) || [],
        neighbors: neighborsOf(active, hit, { vault: root, limit: 2 })
      };
      const out = [formatRead(hit), formatEntry(hit, [], extras).split("\n").slice(2).join("\n")].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: out }] };
    }
    const since = String(args.since || "");
    const until = String(args.until || "");
    for (const [label, val] of [["since", since], ["until", until]]) {
      if (val && !DATE_RE.test(val)) return { isError: true, content: [{ type: "text", text: `${label} \u683C\u5F0F\u9700\u4E3A YYYY-MM-DD\uFF0C\u6536\u5230\uFF1A${val}` }] };
    }
    const basePool = args.include_inactive ? entries.filter((e) => !e.private) : active;
    const pool = basePool.filter((e) => inDateRange(e, { since, until }));
    const extrasFor = (entry) => ({
      supersedes: (entry.supersedes || []).map((id) => indexes.resolveRef(id) || id),
      supersededBy: indexes.supersededBy.get(entry.id) || indexes.supersededBy.get(entry.name) || [],
      neighbors: neighborsOf(pool, entry, { vault: root, limit: 2 })
    });
    if (name === "memory_graph") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 ref" }] };
      const depth = Number(args.depth) === 1 ? 1 : 2;
      return { content: [{ type: "text", text: formatGraph(graphOf(entries, ref, { vault: root, depth })) }] };
    }
    if (name === "memory_search") {
      const query = String(args.query || "").trim();
      if (!query) return { isError: true, content: [{ type: "text", text: "\u7F3A\u5C11\u53C2\u6570 query" }] };
      const hits = searchMemories(pool, query, Number(args.k) || 5, {
        kind: args.kind || "",
        project: args.project || "",
        verifiedOnly: Boolean(args.verified_only),
        includeStale: Boolean(args.include_inactive || args.include_stale),
        trust: args.trust || ""
      });
      if (!hits.length) {
        return { content: [{ type: "text", text: `\u6CA1\u6709\u5339\u914D\u300C${query}\u300D\u7684\u8BB0\u5FC6\uFF08\u5F53\u524D\u6709\u6548\u8BB0\u5FC6 ${pool.length} \u6761\uFF09\u3002` }] };
      }
      const out = hits.map((h, i) => `${i + 1}. ${formatEntry(h.entry, h.why, extrasFor(h.entry))}`).join("\n");
      return { content: [{ type: "text", text: out }] };
    }
    if (name === "memory_recent") {
      const list = recentMemories(pool, Number(args.n) || 10, {
        kind: args.kind || "",
        project: args.project || "",
        verifiedOnly: Boolean(args.verified_only),
        trust: args.trust || "",
        includeStale: args.include_stale !== false || Boolean(args.include_inactive)
      });
      if (!list.length) return { content: [{ type: "text", text: "\u8BB0\u5FC6\u5E93\u5F53\u524D\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6761\u76EE\u3002" }] };
      return { content: [{ type: "text", text: list.map((e, i) => `${i + 1}. ${formatEntry(e, [], extrasFor(e))}`).join("\n") }] };
    }
    return { isError: true, content: [{ type: "text", text: `\u672A\u77E5\u5DE5\u5177\uFF1A${name}` }] };
  };
  const handleRequest = (msg) => {
    if (!msg || typeof msg !== "object") return null;
    const { id, method, params = {} } = msg;
    if (id === void 0 || id === null) return null;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (method === "initialize") {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion.trim() : "";
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
        return ok({
          protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "agent-deck-memory", version: "1.1.0" }
        });
      }
      if (method === "ping") return ok({});
      if (method === "tools/list") return ok({ tools: resolveTools() });
      if (method === "tools/call") return ok(handleToolCall(params?.name, params?.arguments || {}));
      if (method === "resources/list") {
        return ok({
          resources: [
            { uri: "memory://index", name: "Agent Deck \u8BB0\u5FC6\u7D22\u5F15", description: "\u5168\u90E8\u6709\u6548\u975E\u79C1\u5BC6\u957F\u671F\u8BB0\u5FC6\u6982\u89C8", mimeType: "text/plain" }
          ]
        });
      }
      if (method === "resources/read") {
        const uri = String(params?.uri || "");
        if (uri !== "memory://index") return err(-32602, `Unknown resource: ${uri}`);
        const root = resolveRoot();
        const { entries } = loadMemories(root, { configDir });
        return ok({ contents: [{ uri, mimeType: "text/plain", text: formatIndex(entries) }] });
      }
      return err(-32601, `Method not found: ${method}`);
    } catch (e) {
      return err(-32603, e?.message || String(e));
    }
  };
  return { tools, handleRequest };
}
function parseCliArgs(argv) {
  let vault = "";
  let allowWrite = false;
  let indexDir = "";
  let configDir = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") vault = argv[++i] || "";
    else if (a.startsWith("--vault=")) vault = a.slice(8);
    else if (a === "--allow-write") allowWrite = true;
    else if (a === "--index-dir") indexDir = argv[++i] || "";
    else if (a.startsWith("--index-dir=")) indexDir = a.slice(12);
    else if (a === "--config-dir") configDir = argv[++i] || "";
    else if (a.startsWith("--config-dir=")) configDir = a.slice(13);
  }
  return { vault, allowWrite, indexDir, configDir };
}
function startStdioLoop(server, input = process.stdin, output = process.stdout, { maxFrameBytes = MAX_STDIO_FRAME_BYTES } = {}) {
  let buf = Buffer.alloc(0);
  let frameMode = "auto";
  let droppingOversized = false;
  const send = (payload) => {
    if (!payload) return;
    const json = JSON.stringify(payload);
    if (frameMode === "lsp") {
      const body = Buffer.from(json, "utf8");
      output.write(`Content-Length: ${body.length}\r
\r
`);
      output.write(body);
    } else {
      output.write(json + "\n");
    }
  };
  const pump = () => {
    for (; ; ) {
      if (!buf.length) return;
      const headStr = buf.subarray(0, Math.min(buf.length, 128)).toString("utf8");
      if (/^Content-Length:\s*\d+/i.test(headStr)) {
        frameMode = "lsp";
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) {
          if (buf.length > MAX_STDIO_HEADER_BYTES) {
            buf = Buffer.alloc(0);
            send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "MCP header too large" } });
          }
          return;
        }
        const header = buf.subarray(0, sep).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          buf = buf.subarray(sep + 4);
          continue;
        }
        const len = Number(m[1]);
        if (!Number.isSafeInteger(len) || len < 0 || len > maxFrameBytes) {
          buf = Buffer.alloc(0);
          send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `MCP frame exceeds ${maxFrameBytes} bytes` } });
          return;
        }
        const bodyStart = sep + 4;
        if (buf.length < bodyStart + len) return;
        const raw = buf.subarray(bodyStart, bodyStart + len).toString("utf8");
        buf = buf.subarray(bodyStart + len);
        try {
          const res = server.handleRequest(JSON.parse(raw));
          if (res) send(res);
        } catch (e) {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e?.message || "Parse error" } });
        }
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        if (buf.length > maxFrameBytes) {
          buf = Buffer.alloc(0);
          droppingOversized = true;
          send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `MCP line exceeds ${maxFrameBytes} bytes` } });
        }
        return;
      }
      if (droppingOversized) {
        buf = buf.subarray(nl + 1);
        droppingOversized = false;
        continue;
      }
      if (nl > maxFrameBytes) {
        buf = buf.subarray(nl + 1);
        send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `MCP line exceeds ${maxFrameBytes} bytes` } });
        continue;
      }
      if (frameMode === "auto") frameMode = "jsonl";
      const line = buf.subarray(0, nl).toString("utf8").trim();
      buf = buf.subarray(nl + 1);
      if (!line) continue;
      try {
        const res = server.handleRequest(JSON.parse(line));
        if (res) send(res);
      } catch (e) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e?.message || "Parse error" } });
      }
    }
  };
  input.on("data", (chunk) => {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    if (droppingOversized) {
      const nl = part.indexOf("\n");
      if (nl < 0) return;
      buf = Buffer.from(part.subarray(nl + 1));
      droppingOversized = false;
      pump();
      return;
    }
    if (buf.length + part.length > maxFrameBytes + MAX_STDIO_HEADER_BYTES && !part.includes("\n") && !part.includes("\r\n\r\n")) {
      const headStr = (buf.length ? buf : part).subarray(0, 128).toString("utf8");
      buf = Buffer.alloc(0);
      if (!/^Content-Length:\s*\d+/i.test(headStr)) droppingOversized = true;
      send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `MCP frame exceeds ${maxFrameBytes} bytes` } });
      return;
    }
    buf = buf.length ? Buffer.concat([buf, part]) : part;
    pump();
  });
}
if (isMainModule(import.meta.url)) {
  const opts = parseCliArgs(process.argv.slice(2));
  const server = createMcpServer(opts);
  startStdioLoop(server);
}
export {
  createMcpServer,
  startStdioLoop
};

export const ASSET_VERSION = 8;
