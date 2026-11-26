// Memory store: one Markdown file per Dreaming entry, so Bases can show a row per memory.
// Pure text <-> entry helpers only; all vault IO stays in dream.js.
import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import { deriveShortMemoryTitle, extractSourceNotes, normalizeLinkName } from "./memory-graph.js";

export const MEMORY_DIR_DEFAULT = "Agent Deck/记忆";
export const MEMORY_LOG_FILE = "log.md";
export const MEMORY_ARCHIVE_SUBDIR = "archive";
export const OVERVIEW_START = "<!-- ad:memory:start -->";
export const OVERVIEW_END = "<!-- ad:memory:end -->";
export const MEMORY_STATES = ["有效", "已拒绝", "已被替代"];
export const MEMORY_KINDS = { fact: "事实", preference: "偏好", pattern: "待验证规律", lesson: "项目经验" };
export const STATE_TO_STATUS = { 有效: "active", 已被替代: "deprecated", 已拒绝: "rejected" };
export const STATUS_TO_STATE = { active: "有效", stable: "有效", confirmed: "有效", deprecated: "已被替代", superseded: "已被替代", rejected: "已拒绝" };
const VALID_PROVENANCE = new Set(["user-log", "ai-log", "mixed", "import", "manual", "consolidated"]);
const VALID_VERDICTS = new Set(["pending", "confirmed", "refuted"]);

export function deriveProvenance(sources = [], explicit = "") {
  const clean = String(explicit || "").trim().toLowerCase();
  if (VALID_PROVENANCE.has(clean)) return clean;
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return "manual";
  let hasUser = false, hasAi = false, hasImport = false, hasLink = false;
  for (const raw of list) {
    const s = String(raw || "");
    if (s.includes("用户日志")) hasUser = true;
    if (s.includes("AI 记录")) hasAi = true;
    if (s.includes("Claude 记忆导出") || s.includes("导入")) hasImport = true;
    if (/^\[\[/.test(s)) hasLink = true;
  }
  if (hasUser && hasAi) return "mixed";
  if (hasUser) return "user-log";
  if (hasAi) return "ai-log";
  if (hasImport) return "import";
  if (hasLink) return "user-log";
  return "manual";
}

export function deriveTrustLevel(entry = {}) {
  if (!entry) return "unverified";
  if (entry.verified === true || String(entry.verifiedBy || "").trim().toLowerCase().startsWith("human:")) return "human-reviewed";
  const prov = deriveProvenance(entry.sources, entry.provenance);
  const gen = String(entry.generatedBy || "").trim().toLowerCase();
  if (prov === "ai-log" || gen === "mcp") return "ai-derived";
  if (prov === "user-log" || prov === "mixed" || prov === "import" || prov === "manual" || prov === "consolidated") return "user-authored";
  return "unverified";
}

export function isMemoryStale(entry = {}, nowMs = Date.now()) {
  const raw = String(entry?.staleAfter || entry?.validUntil || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const untilMs = Date.parse(raw);
  return Number.isFinite(untilMs) && nowMs >= untilMs + 86400000;
}

export function appendMemoryLogContent(current = "", { date = "", action = "Update", summary = "", items = [] } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : new Date().toISOString().slice(0, 10);
  const heading = `## ${day}`;
  const cleanSummary = oneLine(summary);
  if (!cleanSummary) return String(current || "");
  const bullets = (Array.isArray(items) ? items : []).map(oneLine).filter(Boolean).slice(0, 8).map((x) => `  - ${x}`);
  const block = [`- **${oneLine(action) || "Update"}**：${cleanSummary}`, ...bullets].join("\n");
  const base = String(current || "").trim() ? String(current).replace(/\r\n/g, "\n").trimEnd() : "# 记忆变更日志\n\n按日期记录 Dreaming 提炼、睡眠合并、OKF 元信息补齐与人工审阅变更。";
  const idx = base.indexOf(heading);
  if (idx >= 0) {
    const afterHead = idx + heading.length;
    return `${base.slice(0, afterHead)}\n${block}${base.slice(afterHead)}\n`;
  }
  const firstSection = base.indexOf("\n## ");
  if (firstSection >= 0) {
    return `${base.slice(0, firstSection)}\n\n${heading}\n${block}\n${base.slice(firstSection + 1)}\n`;
  }
  return `${base}\n\n${heading}\n${block}\n`;
}

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
export const memoryIdOf = (text) => "m-" + hash(String(text || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));

// File names are for humans; identity is the `id` in frontmatter, so renaming never breaks anything.
export function memorySlug(text, max = 40) {
  // 不按标点硬切（会把"在RAG系统中，设置拒答门槛"砍成"在RAG系统中"），只截长度、保留单词间单空格并清掉结尾悬挂标点。
  const clean = String(text || "").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  const cut = [...clean].slice(0, max).join("").replace(/[，。、；：！？,.;:!?（(【「《\s]+$/u, "");
  return cut || "记忆";
}

export function memoryFileName({ date, text, shortTitle = "", preferShort = false, taken = new Set() }) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : new Date().toISOString().slice(0, 10);
  const base = (shortTitle || preferShort)
    ? (shortTitle ? memorySlug(shortTitle, 24) : deriveShortMemoryTitle(text, 22))
    : `${day}-${memorySlug(text)}`;
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
  return `${base}-${Date.now()}`;
}

// `[[双链]]` 裸写进 YAML 会被当成嵌套数组，整段 frontmatter 解析失败，所以列表项一律加引号。
export function yamlStr(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// 读回时去掉外层引号并还原转义，保证序列化/解析对称。
function unYamlStr(value) {
  const text = String(value ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\(["\\])/g, "$1") : text;
}

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function yamlScalar(value) {
  const v = oneLine(value);
  if (!v) return "";
  if (/[:#\r\n]/.test(v) || /^[\s[\]{}*&!|>'"%@`]/.test(v)) return yamlStr(v);
  return v;
}

export function serializeMemoryFile({
  id,
  kind,
  text,
  state = "有效",
  status = "",
  statusAt = "",
  date = "",
  description = "",
  sources = [],
  sourceNotes = null,
  concepts = [],
  projectLink = "",
  conflictsWith = [],
  supersedes = [],
  supersededBy = "",
  evidence = [],
  project = "",
  appliesTo = "",
  domain = "",
  tags = [],
  provenance = "",
  generatedBy = "",
  verified = false,
  verifiedBy = "",
  verifiedAt = "",
  verdict = "",
  validFrom = "",
  validUntil = "",
  staleAfter = "",
  private: isPrivate = false,
}) {
  const cleanState = MEMORY_STATES.includes(state) ? state : (STATUS_TO_STATE[oneLine(status).toLowerCase()] || "有效");
  const cleanStatus = STATE_TO_STATUS[cleanState] || "active";
  const cleanProv = deriveProvenance(sources, provenance);
  const cleanVerdict = VALID_VERDICTS.has(oneLine(verdict).toLowerCase())
    ? oneLine(verdict).toLowerCase()
    : (kind === "pattern" ? (verified ? "confirmed" : "pending") : "");
  const cleanConcepts = (Array.isArray(concepts) ? concepts : []).map(oneLine).filter(Boolean);
  const cleanConflicts = (Array.isArray(conflictsWith) ? conflictsWith : []).map(oneLine).filter(Boolean);
  const resolvedSourceNotes = Array.isArray(sourceNotes) ? sourceNotes.map(oneLine).filter(Boolean) : extractSourceNotes(sources);
  const lines = [
    "---",
    `id: ${oneLine(id) || memoryIdOf(text)}`,
    `title: ${yamlStr(oneLine(text))}`,
    `kind: ${oneLine(kind)}`,
    `type: ${MEMORY_KINDS[kind] || oneLine(kind)}`,
    `state: ${cleanState}`,
    `status: ${cleanStatus}`,
    ...(oneLine(statusAt) ? [`status_at: ${oneLine(statusAt)}`] : []),
    `date: ${oneLine(date)}`,
  ];
  if (oneLine(description)) lines.push(`description: ${yamlStr(oneLine(description).slice(0, 160))}`);
  if (oneLine(project)) lines.push(`project: ${yamlScalar(project)}`);
  if (oneLine(projectLink)) lines.push(`project_link: ${yamlStr(oneLine(projectLink))}`);
  if (oneLine(appliesTo) && oneLine(appliesTo) !== oneLine(project)) lines.push(`applies_to: ${yamlScalar(appliesTo)}`);
  if (oneLine(domain)) lines.push(`domain: ${yamlScalar(domain)}`);
  if (cleanConcepts.length) lines.push("concepts:", ...cleanConcepts.map((c) => `  - ${yamlStr(c)}`));
  const cleanTags = (Array.isArray(tags) ? tags : []).map(oneLine).filter(Boolean);
  if (cleanTags.length) lines.push("tags:", ...cleanTags.map((tg) => `  - ${yamlStr(tg)}`));
  if (cleanProv) lines.push(`provenance: ${cleanProv}`);
  if (oneLine(generatedBy)) lines.push(`generated_by: ${yamlScalar(generatedBy)}`);
  if (verified === true) {
    lines.push("verified: true");
    if (oneLine(verifiedBy)) lines.push(`verified_by: ${yamlScalar(verifiedBy)}`);
    if (oneLine(verifiedAt)) lines.push(`verified_at: ${yamlScalar(verifiedAt)}`);
  }
  if (cleanVerdict) lines.push(`verdict: ${cleanVerdict}`);
  if (oneLine(validFrom)) lines.push(`valid_from: ${oneLine(validFrom)}`);
  if (oneLine(validUntil)) lines.push(`valid_until: ${oneLine(validUntil)}`);
  if (oneLine(staleAfter)) lines.push(`stale_after: ${oneLine(staleAfter)}`);
  if (isPrivate === true) lines.push("private: true");
  if (supersedes.length) lines.push("supersedes:", ...supersedes.map((s) => `  - ${yamlStr(s)}`));
  if (oneLine(supersededBy)) lines.push(`superseded_by: ${yamlStr(supersededBy)}`);
  if (cleanConflicts.length) lines.push("conflicts_with:", ...cleanConflicts.map((c) => `  - ${yamlStr(c)}`));
  if (resolvedSourceNotes.length) lines.push("source_notes:", ...resolvedSourceNotes.map((s) => `  - ${yamlStr(s)}`));
  if (sources.length) lines.push("sources:", ...sources.map((s) => `  - ${yamlStr(s)}`));
  lines.push("---", "", oneLine(text), "");
  return lines.join("\n");
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

// Tolerant of user-added frontmatter, OKF v0.2 nested/inline attributes & Base-created rows.
export function parseMemoryFile(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta = {};
  let list = "";
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) { const key = m[1]; list = m[2] ? "" : key; meta[key] = m[2] ? unYamlStr(m[2]) : []; continue; }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && Array.isArray(meta[list])) meta[list].push(unYamlStr(item[1]));
    const sub = /^\s+([A-Za-z_][\w-]*):\s*(.+)$/.exec(line);
    if (sub && Array.isArray(meta[list]) && !meta[list].length) {
      meta[`${list}_${sub[1]}`] = unYamlStr(sub[2]);
    }
  }
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const body = lines.slice(end + 1);
  const bodyText = body.find((l) => l.trim() && l.trim() !== "## 证据")?.trim() || "";
  const title = str(meta.title);
  const typeRaw = str(meta.type);
  const kindRaw = str(meta.kind);
  const stateRaw = str(meta.state);
  const statusRaw = str(meta.status).toLowerCase();
  const idRaw = str(meta.id);
  const text = bodyText || title;
  const kind = MEMORY_KINDS[kindRaw]
    ? kindRaw
    : KIND_BY_LABEL[typeRaw] || (text && (stateRaw || statusRaw || idRaw) ? inferMemoryKind(text) : "");
  if (!kind || !text) return null;

  const genObj = parseInlineObject(meta.generated);
  const verObj = parseInlineObject(meta.verified);
  const verFirst = Array.isArray(meta.verified) ? String(meta.verified[0] || "") : "";
  const verifiedBy = str(meta.verified_by) || str(verObj?.by) || str(meta.verified_by_child) || (/^by:\s*(.+)$/.exec(verFirst)?.[1] ? unYamlStr(/^by:\s*(.+)$/.exec(verFirst)[1]) : "");
  const verifiedAt = str(meta.verified_at) || str(verObj?.at) || str(meta.verified_at_child);
  const verified = str(meta.verified).toLowerCase() === "true" || Boolean(verifiedBy) || Boolean(verObj?.by);
  const state = MEMORY_STATES.includes(stateRaw) ? stateRaw : (STATUS_TO_STATE[statusRaw] || "有效");
  const status = statusRaw || STATE_TO_STATUS[state] || "active";
  const sources = Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [];
  const provenance = deriveProvenance(sources, str(meta.provenance));
  const verdictRaw = str(meta.verdict).toLowerCase();
  const verdict = VALID_VERDICTS.has(verdictRaw) ? verdictRaw : (kind === "pattern" ? (verified ? "confirmed" : "pending") : "");
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
    evidence: [],
  };
  const ev = body.findIndex((l) => l.trim() === "## 证据");
  if (ev >= 0) for (const line of body.slice(ev + 1)) { const m = /^-\s+(.*)$/.exec(line); if (m) entry.evidence.push(m[1].trim()); }
  entry.trust = deriveTrustLevel(entry);
  return entry;
}

// 兼容 Obsidian Bases 行内新建/编辑：补齐缺失的 state/date/type/kind/id，并保持 title 与正文同步。
export function reconcileMemoryFile(content, { today = "" } = {}) {
  const raw = String(content ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);

  let fmLines = [], bodyLines = lines;
  const meta = {}, keyOrder = [], listValues = new Map();
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end < 0) return null;
    fmLines = lines.slice(1, end);
    bodyLines = lines.slice(end + 1);
    let activeList = "";
    for (const line of fmLines) {
      const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
      if (m) {
        const key = m[1];
        keyOrder.push(key);
        if (m[2]) { meta[key] = unYamlStr(m[2]); activeList = ""; }
        else { meta[key] = ""; listValues.set(key, []); activeList = key; }
        continue;
      }
      const item = /^\s+-\s*(.*)$/.exec(line);
      if (item && activeList) listValues.get(activeList).push(unYamlStr(item[1]));
    }
    const isMemoryNote = !raw.trim() || "kind" in meta || "state" in meta || "id" in meta || "type" in meta || "title" in meta;
    if (!isMemoryNote) return null;
  } else if (raw.trim()) {
    return null;
  }

  const title = oneLine(meta.title);
  const firstBodyIdx = bodyLines.findIndex((l) => l.trim() && l.trim() !== "## 证据");
  const bodyText = firstBodyIdx >= 0 ? oneLine(bodyLines[firstBodyIdx]) : "";
  const idNow = oneLine(meta.id);
  let text = bodyText || title;
  if (title && bodyText && title !== bodyText) {
    if (idNow && memoryIdOf(title) !== idNow && memoryIdOf(bodyText) === idNow) text = title;
    else if (idNow && memoryIdOf(bodyText) !== idNow && memoryIdOf(title) === idNow) text = bodyText;
  }

  const typeRaw = oneLine(meta.type);
  const kindRaw = oneLine(meta.kind);
  let kind = MEMORY_KINDS[kindRaw] ? kindRaw : KIND_BY_LABEL[typeRaw] || "";
  if (KIND_BY_LABEL[typeRaw] && KIND_BY_LABEL[typeRaw] !== kind) kind = KIND_BY_LABEL[typeRaw];
  if (!kind) kind = text ? inferMemoryKind(text) : "fact";
  const type = MEMORY_KINDS[kind] || typeRaw || "事实";
  const state = MEMORY_STATES.includes(oneLine(meta.state))
    ? oneLine(meta.state)
    : (STATUS_TO_STATE[oneLine(meta.status).toLowerCase()] || "有效");
  const status = STATE_TO_STATUS[state] || "active";
  const date = /^\d{4}-\d{2}-\d{2}/.exec(oneLine(meta.date))?.[0] || day;
  const id = text ? memoryIdOf(text) : idNow;

  const nextMeta = { ...meta, id, title: text, kind, type, state, status, date };
  const coreKeys = ["id", "title", "kind", "type", "state", "status", "date"];
  const extraKeys = keyOrder.filter((k) => !coreKeys.includes(k));
  if (oneLine(meta.verified).toLowerCase() === "true") {
    if (kind === "pattern" && oneLine(meta.verdict).toLowerCase() !== "confirmed") {
      nextMeta.verdict = "confirmed";
      if (!extraKeys.includes("verdict")) extraKeys.push("verdict");
    }
    if (!oneLine(meta.verified_by)) {
      nextMeta.verified_by = "human:user";
      if (!extraKeys.includes("verified_by")) extraKeys.push("verified_by");
    }
    if (!oneLine(meta.verified_at)) {
      nextMeta.verified_at = day;
      if (!extraKeys.includes("verified_at")) extraKeys.push("verified_at");
    }
  }
  const outFm = ["---"];
  for (const key of [...coreKeys, ...extraKeys]) {
    if (listValues.has(key) && listValues.get(key).length) {
      outFm.push(`${key}:`, ...listValues.get(key).map((v) => `  - ${yamlStr(v)}`));
    } else if (key === "title") {
      outFm.push(`title: ${text ? yamlStr(text) : ""}`);
    } else if (key === "id" && !id) {
      continue;
    } else {
      const v = nextMeta[key];
      if (v === undefined || v === "") outFm.push(`${key}:`);
      else if (typeof v === "string" && (/[:#\r\n]/.test(v) || /^[\s[\]{}*&!|>'"%@`]/.test(v))) outFm.push(`${key}: ${yamlStr(v)}`);
      else outFm.push(`${key}: ${v}`);
    }
  }
  outFm.push("---");

  let nextBody = bodyLines.slice();
  if (text) {
    if (firstBodyIdx >= 0) nextBody[firstBodyIdx] = text;
    else nextBody = ["", text, ""];
  } else if (!nextBody.length) {
    nextBody = [""];
  }
  const out = [...outFm, ...nextBody].join("\n").replace(/\n*$/, "\n");
  if (out === raw || out === `${raw}\n`) return null;
  return out;
}

// Same list shape the old single note used, so activeMemory / sharedMemory / injection keep working unchanged.
// Skip private: true entries so confidential notes never enter overview, shared snapshot, or Companion profile.
export function renderMemoryList(entries = []) {
  return entries
    .filter((e) => e.text && !e.private)
    .map((e) => {
      const anchor = `^dream-${String(e.id || memoryIdOf(e.text)).replace(/^m-/, "")}`;
      const head = `- **${MEMORY_KINDS[e.kind] || e.type || "记忆"}**：${oneLine(e.text)} ${anchor}`;
      const rows = [`  - 状态：${e.state || "有效"}`];
      for (const source of e.sources || []) rows.push(`  - 来源：${source}`);
      return [head, ...rows].join("\n");
    })
    .join("\n");
}

// The overview note keeps whatever the user wrote outside the markers; only the block is generated.
export function renderOverview(current = "", entries = []) {
  const block = `${OVERVIEW_START}\n${renderMemoryList(entries)}\n${OVERVIEW_END}`;
  const start = current.indexOf(OVERVIEW_START), end = current.indexOf(OVERVIEW_END);
  const broken = (start < 0) !== (end < 0) || (start >= 0 && (end < start || current.indexOf(OVERVIEW_START, start + 1) >= 0 || current.indexOf(OVERVIEW_END, end + 1) >= 0));
  if (broken) return null;
  if (start < 0) return `${current.trimEnd() || "# Agent Deck 长期记忆"}\n\n${block}\n`;
  return current.slice(0, start) + block + current.slice(end + OVERVIEW_END.length);
}

// Bases 视图：一行就是一条记忆；支持直接新建、改行内属性与删除文件。
export function memoryBase(dir = MEMORY_DIR_DEFAULT) {
  return [
    "filters:",
    "  and:",
    `    - 'file.inFolder("${dir}")'`,
    `    - '!file.inFolder("${dir}/${MEMORY_ARCHIVE_SUBDIR}")'`,
    '    - file.ext == "md"',
    `    - 'file.path != "${dir}/索引.md"'`,
    `    - 'file.path != "${dir}/${MEMORY_LOG_FILE}"'`,
    "",
    "views:",
    "  - type: table",
    "    name: 全部记忆",
    "    order: [title, type, project_link, concepts, state, status, verified, date]",
    "  - type: table",
    "    name: 待确认",
    "    filters:",
    "      and:",
    '        - state == "有效"',
    '        - verified != true',
    "    order: [title, type, project, provenance, date]",
    "  - type: table",
    "    name: 已失效",
    "    filters:",
    "      and:",
    '        - state != "有效"',
    "    order: [title, type, state, status, superseded_by, date]",
    "",
  ].join("\n");
}

// 来源行：`[[笔记#^块号]]（用户日志，第 3—5 行）；原文：…`
export function parseSourceLine(raw) {
  const s = String(raw || "");
  const m = /^\[\[([^\]|#]+)(?:#\^([^\]|]+))?\]\]（([^，]+)，第 (\d+)—(\d+) 行）；原文：([\s\S]*)$/.exec(s);
  if (!m) return { raw: s, target: (/^\[\[([^\]|#]+)/.exec(s) || [])[1] || "", quoted: false };
  return { raw: s, target: m[1], blockId: m[2] || "", kind: m[3], from: Number(m[4]), to: Number(m[5]), quote: m[6], quoted: true };
}

export function formatSourceLine({ target, blockId, kind, from, to, quote }) {
  return `[[${target}${blockId ? "#^" + blockId : ""}]]（${kind}，第 ${from}—${to} 行）；原文：${quote}`;
}

// 来源原文的块号。前缀刻意不用 ad-/agy- 等任务号，避免被当成任务块或内部标识清理掉。
export function memoryAnchorId(target, text) {
  return "mem-" + createHash("sha256").update(`${target}\n${String(text || "").trim()}`).digest("hex").slice(0, 8);
}

// 审阅队列的起点：优先用户光标所在的记忆（或光标所在行里的记忆回链），否则从第一条开始。
export function orderForReview(entries = [], { path = "", line = "", dir = "" } = {}) {
  const prefix = dir ? `${String(dir).replace(/\/+$/, "")}/` : "";
  let start = -1;
  if (path && prefix && path.startsWith(prefix)) start = entries.findIndex((e) => e.path === path);
  if (start < 0 && line) start = entries.findIndex((e) => line.includes(`[[${e.path.replace(/\.md$/, "")}`));
  if (start <= 0) return entries.slice();
  return [...entries.slice(start), ...entries.slice(0, start)];
}

// 记忆索引：一个文件装下全部有效非私密条目的标题，AI 一次 cat/grep 就能看到所有记忆，
// 不依赖文件名长度（文件名有 255 字节上限，中文约 85 字就会截断）。
export function renderMemoryIndex(entries = [], at = "") {
  const stamp = at || new Date().toISOString().slice(0, 16).replace("T", " ");
  const visible = (entries || []).filter((e) => e && !e.private && (!e.state || e.state === "有效"));
  const byKind = { lesson: 0, preference: 0, fact: 0, pattern: 0 };
  let verifiedCount = 0;
  const projects = new Set();
  const conceptCounts = new Map();
  for (const e of visible) {
    if (e.kind && Object.hasOwn(byKind, e.kind)) byKind[e.kind]++;
    if (e.verified) verifiedCount++;
    if (e.project) projects.add(e.project);
    const seenConcept = new Set();
    for (const raw of [...(e.concepts || []), ...(e.projectLink ? [e.projectLink] : [])]) {
      const name = String(raw || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
      const lk = name.toLowerCase();
      if (!name || seenConcept.has(lk)) continue;
      seenConcept.add(lk);
      conceptCounts.set(name, (conceptCounts.get(name) || 0) + 1);
    }
  }
  const rows = [...visible]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || a.text).localeCompare(String(b.title || b.text)))
    .map((e) => {
      const proj = e.project ? `[${e.project}] ` : "";
      const trust = deriveTrustLevel(e);
      const stale = isMemoryStale(e);
      const mark = stale ? "⚠过期 " : trust === "human-reviewed" ? "✓ " : trust === "ai-derived" ? "[AI未确认] " : "";
      const conceptLabels = (Array.isArray(e.concepts) ? e.concepts : [])
        .map((c) => String(c || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim())
        .filter(Boolean);
      const conceptTail = conceptLabels.length ? ` · ${conceptLabels.join(" / ")}` : "";
      return `- ${e.date || "—"} · ${MEMORY_KINDS[e.kind] || e.type || "记忆"} · ${mark}${proj}${e.title || e.text}${conceptTail} → [[${String(e.path || "").replace(/\.md$/, "")}]]`;
    });
  const statsParts = [
    `项目经验 ${byKind.lesson}`,
    `偏好 ${byKind.preference}`,
    `事实 ${byKind.fact}`,
    `待验证规律 ${byKind.pattern}`,
    `已确认 ${verifiedCount}`,
  ];
  const projectLine = projects.size ? `涉及项目：${[...projects].slice(0, 12).join("、")}${projects.size > 12 ? "…" : ""}` : "";
  const topConcepts = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
  const conceptLine = topConcepts.length ? `高频概念：${topConcepts.map(([name, n]) => `[[${name}]](${n})`).join(" · ")}` : "";
  return [
    "# 记忆索引",
    "",
    `共 ${visible.length} 条有效非私密记忆 · 由插件生成（${stamp}）。这里只有标题，正文在各自文件里。`,
    `分布：${statsParts.join(" · ")}${projectLine ? `｜${projectLine}` : ""}`,
    ...(conceptLine ? [conceptLine] : []),
    "AI 用法：`grep -h '^title:' 记忆/*.md`、直接读这个文件，或用 `memory-query.mjs` / MCP 检索。",
    "",
    ...(rows.length ? rows : ["- （还没有记忆）"]),
    "",
  ].join("\n");
}

const KIND_BY_LABEL = Object.fromEntries(Object.entries(MEMORY_KINDS).map(([k, v]) => [v, k]));

export function inferMemoryKind(text = "", hint = "") {
  const h = String(hint || "").trim().toLowerCase();
  if (MEMORY_KINDS[h]) return h;
  if (KIND_BY_LABEL[hint]) return KIND_BY_LABEL[hint];
  const s = String(text || "");
  if (/（待验证|待验证推断|待验证）|\b(?:hypothesis|unverified)\b/i.test(s) || /^(?:用户)?推断[，：:\s]/.test(s)) return "pattern";
  if (/偏好|喜欢|不喜欢|反感|倾向|习惯|要求|严禁|不买|宁可|优先|\b(?:prefer|prefers|wants|always|never)\b/i.test(s)) return "preference";
  if (/经验|教训|踩坑|必须|应当|切忌|避免|方案|架构|系统中|在\s*[A-Za-z\u4e00-\u9fff]+\s*中[，,]/i.test(s)) return "lesson";
  return "fact";
}

// 兼容直接扔进 Claude 导出的 memories-*.json（展开里面的 memory_files）或普通 Markdown 文档。
export function expandImportedDocs(docs = []) {
  const out = [];
  for (const doc of docs || []) {
    if (!doc || typeof doc.content !== "string") continue;
    const name = String(doc.name || doc.path || "未命名.md");
    if (name.toLowerCase().endsWith(".json")) {
      try {
        const data = JSON.parse(doc.content);
        if (Array.isArray(data?.memory_files)) {
          for (const mf of data.memory_files) {
            if (mf && typeof mf.content === "string" && mf.content.trim()) {
              const date = /^\d{4}-\d{2}-\d{2}/.exec(String(mf.updated_at || ""))?.[0] || doc.date || "";
              out.push({ name: String(mf.path || name).replace(/^\/+/, ""), path: String(mf.path || name).replace(/^\/+/, ""), content: mf.content, date });
            }
          }
          continue;
        }
      } catch { /* 非 JSON 或结构不同则按普通文本回退 */ }
    }
    out.push({ name, path: String(doc.path || name), content: doc.content, date: doc.date || "" });
  }
  return out;
}

// 解析标准 ZIP（如 Claude 导出的 memories-000.zip）内的 .md / .json / .txt 文本，无需外部命令或第三方库。
export function unzipTextEntries(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const out = [];
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 || dataStart + compSize > buf.length) break;
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const raw = buf.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (name.endsWith("/") || !/\.(?:md|markdown|txt|json)$/i.test(name)) continue;
    try {
      const content = (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null)?.toString("utf8");
      if (content && content.trim()) out.push({ name, path: name, content });
    } catch { /* 跳过损坏条目 */ }
  }
  return out;
}

export async function readDroppedBrowserFiles(fileList) {
  const docs = [];
  for (const file of Array.from(fileList || [])) {
    if (!file) continue;
    const name = String(file.name || "未命名.md");
    const date = file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : "";
    if (/\.zip$/i.test(name) && typeof file.arrayBuffer === "function") {
      for (const entry of unzipTextEntries(await file.arrayBuffer())) {
        docs.push({ ...entry, date });
      }
      continue;
    }
    if (!/\.(?:md|markdown|txt|json)$/i.test(name) || typeof file.text !== "function") continue;
    const content = await file.text();
    if (content && content.trim()) docs.push({ name, path: name, content, date });
  }
  return expandImportedDocs(docs);
}

// 模式 A（0 Token 规则拆条）：支持单条记忆文件、旧版长列表、Claude [stated] 导出与普通 Markdown 列表。
export function parseMarkdownToMemories(docs = [], { defaultDate = "" } = {}) {
  const fallbackDay = /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : new Date().toISOString().slice(0, 10);
  const expanded = expandImportedDocs(docs);
  const out = [], seen = new Set();
  const push = (item) => {
    const text = oneLine(item.text);
    if (!text || text.length < 4 || text.length > 500) return;
    const id = item.id || memoryIdOf(text);
    if (seen.has(id) || seen.has(memoryIdOf(text))) return;
    seen.add(id);
    seen.add(memoryIdOf(text));
    const kind = MEMORY_KINDS[item.kind] ? item.kind : inferMemoryKind(text, item.kind);
    const date = /^\d{4}-\d{2}-\d{2}/.exec(String(item.date || ""))?.[0] || fallbackDay;
    out.push({
      id,
      kind,
      type: MEMORY_KINDS[kind],
      text,
      state: MEMORY_STATES.includes(item.state) ? item.state : "有效",
      date,
      sources: Array.isArray(item.sources) && item.sources.length ? item.sources : item.source ? [item.source] : [],
    });
  };

  for (const doc of expanded) {
    const raw = String(doc.content || "");
    const single = parseMemoryFile(raw);
    if (single) {
      push({ ...single, date: single.date || doc.date });
      continue;
    }
    const lines = raw.split("\n");
    let bodyStart = 0, fmDate = doc.date || "";
    if (lines[0]?.trim() === "---") {
      const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
      if (end > 0) {
        bodyStart = end + 1;
        for (const l of lines.slice(1, end)) {
          const m = /^(?:date|updated_at|created_at|synced_at):\s*"?(\d{4}-\d{2}-\d{2})/.exec(l.trim());
          if (m) { fmDate = m[1]; break; }
        }
      }
    }
    const label = String(doc.path || doc.name || "外部导入").replace(/\.md$/i, "");
    const srcRef = label.includes("/") && !label.startsWith("http") ? `[[${label}]]` : label;
    let inFence = false, extractedFromDoc = 0;

    for (let i = bodyStart; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (/^\s+-\s+(?:状态|来源)：/.test(line)) continue;
      const legacy = /^- \*\*(事实|偏好|待验证规律|项目经验)\*\*：(.+?)(?: \^dream-[a-f0-9]+)?$/.exec(line.trim());
      if (legacy) {
        let j = i + 1, state = "有效";
        const sources = [];
        while (j < lines.length && /^\s+\S/.test(lines[j])) {
          const st = /^\s+-\s+状态：(有效|已拒绝|已被替代)/.exec(lines[j]);
          const sr = /^\s+-\s+来源：(.*)$/.exec(lines[j]);
          if (st) state = st[1];
          if (sr && sr[1].trim()) sources.push(sr[1].trim());
          j++;
        }
        push({ kind: KIND_BY_LABEL[legacy[1]] || "fact", text: legacy[2], state, date: fmDate, sources: sources.length ? sources : [`${srcRef}（第 ${i + 1} 行）；原文：${oneLine(legacy[2])}`] });
        extractedFromDoc++;
        i = j - 1;
        continue;
      }
      const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (!bullet) continue;
      let text = bullet[1].trim().replace(/\s+\^[A-Za-z0-9-]+$/, "").trim();
      if (!text || /^[-_*]{3,}$/.test(text) || /^⤴\s+\[\[/.test(text)) continue;
      let hint = "";
      const tagMatch = /^\[([A-Za-z_\u4e00-\u9fff-]+)\]\s*(.+)$/.exec(text);
      if (tagMatch) {
        hint = tagMatch[1];
        text = tagMatch[2].trim();
      }
      const boldKind = /^\*\*(事实|偏好|待验证规律|项目经验)\*\*[：:]\s*(.+)$/.exec(text);
      if (boldKind) {
        hint = boldKind[1];
        text = boldKind[2].trim();
      }
      if (text.length < 6) continue;
      push({
        kind: inferMemoryKind(text, hint),
        text,
        date: fmDate,
        source: `${srcRef}（第 ${i + 1} 行）；原文：${oneLine(text).slice(0, 240)}`,
      });
      extractedFromDoc++;
    }

    if (!extractedFromDoc) {
      const paragraphs = lines
        .slice(bodyStart)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--") && !/^[-_*]{3,}$/.test(l));
      if (paragraphs.length === 1 && paragraphs[0].length >= 6 && paragraphs[0].length <= 400) {
        push({
          kind: inferMemoryKind(paragraphs[0]),
          text: paragraphs[0],
          date: fmDate,
          source: `${srcRef}；原文：${oneLine(paragraphs[0]).slice(0, 240)}`,
        });
      }
    }
  }
  return out;
}

// 就地向 YAML frontmatter 列表字段追加去重后的双链（自动加引号），保留其它字段与正文不变。
export function appendFrontmatterLinks(raw, key, links = []) {
  const cleanLinks = (Array.isArray(links) ? links : [links]).map(oneLine).filter(Boolean);
  if (!cleanLinks.length) return null;
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fmEnd < 0) return null;

  const origFm = lines.slice(1, fmEnd);
  const keyRe = new RegExp(`^${key}:(?:\\s*(.*))?$`);
  const existing = [];
  let keyStart = -1;
  let keyEnd = -1;
  let scalarVal = "";
  for (let i = 0; i < origFm.length; i++) {
    const m = keyRe.exec(origFm[i]);
    if (!m) continue;
    keyStart = i;
    scalarVal = unYamlStr(m[1] || "");
    if (scalarVal) existing.push(scalarVal);
    keyEnd = i + 1;
    while (keyEnd < origFm.length && /^\s+-\s+/.test(origFm[keyEnd])) {
      const itemVal = unYamlStr(origFm[keyEnd].replace(/^\s+-\s+/, ""));
      if (itemVal) existing.push(itemVal);
      keyEnd++;
    }
    break;
  }

  const seen = new Set(existing.map((v) => (normalizeLinkName(v) || oneLine(v)).toLowerCase()).filter(Boolean));
  const toAdd = [];
  for (const link of cleanLinks) {
    const norm = (normalizeLinkName(link) || link).toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    toAdd.push(link);
  }
  if (!toAdd.length) return null;

  const nextFm = origFm.slice();
  if (keyStart >= 0) {
    if (scalarVal && keyEnd === keyStart + 1) {
      const merged = [scalarVal, ...toAdd].map((v) => `  - ${yamlStr(v)}`);
      nextFm.splice(keyStart, 1, `${key}:`, ...merged);
    } else {
      nextFm.splice(keyEnd, 0, ...toAdd.map((v) => `  - ${yamlStr(v)}`));
    }
  } else {
    nextFm.push(`${key}:`, ...toAdd.map((v) => `  - ${yamlStr(v)}`));
  }

  const out = ["---", ...nextFm, "---", ...lines.slice(fmEnd + 1)].join("\n");
  return out === text ? null : out;
}

export function removeFrontmatterLinks(raw, key, targets = []) {
  const text = String(raw || "");
  const cleanTargets = new Set(
    (Array.isArray(targets) ? targets : [])
      .map((l) => (normalizeLinkName(l) || oneLine(l)).toLowerCase())
      .filter(Boolean),
  );
  if (!cleanTargets.size) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fmEnd < 0) return null;

  const origFm = lines.slice(1, fmEnd);
  let keyStart = -1;
  let keyEnd = -1;
  let scalarVal = "";
  const existing = [];
  for (let i = 0; i < origFm.length; i++) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(origFm[i]);
    if (!m || m[1] !== key) continue;
    keyStart = i;
    if (m[2]) {
      scalarVal = unYamlStr(m[2]);
      if (scalarVal) existing.push(scalarVal);
      keyEnd = i + 1;
      break;
    }
    keyEnd = i + 1;
    while (keyEnd < origFm.length && /^\s+-\s+/.test(origFm[keyEnd])) {
      const itemVal = unYamlStr(origFm[keyEnd].replace(/^\s+-\s+/, ""));
      if (itemVal) existing.push(itemVal);
      keyEnd++;
    }
    break;
  }
  if (keyStart < 0) return null;
  const kept = existing.filter((v) => !cleanTargets.has((normalizeLinkName(v) || oneLine(v)).toLowerCase()));
  if (kept.length === existing.length) return null;
  const nextFm = origFm.slice();
  if (!kept.length) {
    nextFm.splice(keyStart, keyEnd - keyStart);
  } else {
    nextFm.splice(keyStart, keyEnd - keyStart, `${key}:`, ...kept.map((v) => `  - ${yamlStr(v)}`));
  }
  const out = ["---", ...nextFm, "---", ...lines.slice(fmEnd + 1)].join("\n");
  return out === text ? null : out;
}

// 区分「库内日记/笔记可补 ^mem-* 锚点」与「外部导入/MCP 无库内原文免补锚」。
export function classifyAnchorStatus(entry = {}, { existsInVault = null } = {}) {
  const sources = Array.isArray(entry?.sources)
    ? entry.sources.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
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
        anchorable = Boolean(existsInVault(target)) || s.includes("用户日志") || s.includes("AI 记录");
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
    externalImportOnly: unanchoredVaultCount === 0 && anchoredCount === 0 && externalCount > 0,
  };
}
