#!/usr/bin/env node
// 运行时记忆查询（默认只读；proposeMemory 仅在 MCP --allow-write 下触发）。
//
//   node memory-query.mjs index [--project P] [--kind K] [--k 30] [--vault /库根]
//   node memory-query.mjs search "关键词" [--k 5] [--kind K] [--project P] [--verified] [--all] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//   node memory-query.mjs read <记忆文件名或ID>
//   node memory-query.mjs recent [n] [--kind K] [--project P] [--verified] [--since …] [--until …]
//   node memory-query.mjs stats [--vault /库根]

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ASSET_VERSION = 6;
export const MEMORY_DIR_DEFAULT = "Agent Deck/记忆";
export const MEMORY_LOG_FILE = "log.md";
export const MEMORY_ARCHIVE_SUBDIR = "archive";
export const PLUGIN_SUBDIR = path.join(".obsidian", "plugins", "agent-deck");
const MAX_OUTPUT = 6000;
const STATUS_TO_STATE = { active: "有效", stable: "有效", confirmed: "有效", deprecated: "已被替代", superseded: "已被替代", rejected: "已拒绝" };
const STATE_TO_STATUS = { 有效: "active", 已被替代: "deprecated", 已拒绝: "rejected" };
const VALID_PROVENANCE = new Set(["user-log", "ai-log", "mixed", "import", "manual", "consolidated"]);
const PROPOSAL_ONLY_RE = /(?:尚未实施|未实施|仍待.{0,12}验证|尚未验证|不能视为已验证|未说明是否实测|未经验证的推断|(?:只|仅)完成改造.{0,16}待.{0,8}验证)/;

const STOP_LATIN = new Set([
  "this", "that", "with", "from", "have", "will", "your", "they", "them", "what", "when", "where", "which",
  "into", "onto", "only", "also", "more", "most", "some", "such", "than", "then", "very", "just", "like",
  "make", "made", "need", "used", "using", "work", "done", "todo", "doing", "note", "notes", "file", "files",
  "code", "test", "tests", "task", "tasks", "mode", "user", "agent", "agents", "claude", "codex", "obsidian",
  "plugin", "true", "false", "null", "none", "json", "markdown",
]);

const STOP_CJK = new Set([
  "用户", "可以", "需要", "通过", "进行", "使用", "一个", "没有", "不是", "这个", "那个", "如果", "因为",
  "所以", "以及", "或者", "相关", "目前", "当前", "问题", "内容", "记录", "建议", "提出", "认为", "觉得",
  "自己", "我们", "他们", "设置", "怎么", "如何", "什么", "哪些", "这样", "那样", "已经", "仍然", "还是",
  "虽然", "但是", "不过", "而且", "并且", "只是", "就是", "关于", "对于", "时候", "地方", "方面", "情况",
  "方式", "方法", "作为", "成为", "因此", "从而", "避免", "确保", "应当", "必须", "应该", "一下", "一些",
  "这些", "那些", "同时", "另外", "其余", "其他", "所有", "全部",
]);

const HYBRID_TERM_RE = /(?<![a-z0-9])[a-z]\s*[\u4e00-\u9fff]/gi;
const TOKEN_RE = /[a-z0-9_-]{2,}|[\u4e00-\u9fff]+/g;

export const rawTerms = (value) => {
  const s = String(value || "");
  const out = new Set();
  for (const w of s.toLowerCase().match(TOKEN_RE) || []) {
    if (/^[\u4e00-\u9fff]/.test(w)) {
      const chars = [...w];
      for (let i = 1; i < chars.length; i++) out.add(chars[i - 1] + chars[i]);
    } else {
      out.add(w);
    }
  }
  for (const m of s.match(HYBRID_TERM_RE) || []) out.add(m.replace(/\s+/g, "").toLowerCase());
  return out;
};

export const terms = (value) => {
  const raw = rawTerms(value);
  if (!raw.size) return raw;
  const filtered = new Set([...raw].filter((t) => !STOP_CJK.has(t)));
  return filtered.size ? filtered : raw;
};

const isHybridTerm = (term) => /^[a-z][\u4e00-\u9fff]$/.test(String(term || ""));
const isDistinctiveLatinTerm = (term) => /^[a-z0-9][a-z0-9_-]{3,}$/.test(term) && !/^\d+$/.test(term) && !STOP_LATIN.has(term);
const normProject = (s) => String(s || "").toLowerCase().replace(/[\s_\-·.]+/g, "");

const yamlStr = (value) => `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const unYamlStr = (value) => {
  const text = String(value ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\(["\\])/g, "$1") : text;
};

const KIND_BY_LABEL = { 事实: "fact", 偏好: "preference", 待验证规律: "pattern", 项目经验: "lesson" };
const LABEL_BY_KIND = { fact: "事实", preference: "偏好", pattern: "待验证规律", lesson: "项目经验" };

const parseTagsValue = (raw) => {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean);
  const s = String(raw || "").trim();
  if (!s) return [];
  return s.replace(/^\[|\]$/g, "").split(/[,，]/).map((x) => unYamlStr(x).trim()).filter(Boolean);
};

const parseInlineObj = (raw) => {
  const s = String(raw || "").trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const out = {};
  for (const part of s.slice(1, -1).split(",")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(part.trim());
    if (m) out[m[1]] = unYamlStr(m[2]);
  }
  return out;
};

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
  return "user-authored";
}

export function isMemoryStale(entry = {}, nowMs = Date.now()) {
  const raw = String(entry?.staleAfter || entry?.validUntil || "").trim();
  if (!DATE_RE.test(raw)) return false;
  const untilMs = Date.parse(raw);
  return Number.isFinite(untilMs) && nowMs >= untilMs + 86400000;
}

// 容忍用户手加的 frontmatter、OKF v0.2 字段与记忆.base 行内编辑：不认识的键忽略，不报错。
export function parseMemory(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta = {};
  let list = "";
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) {
      list = m[2] ? "" : m[1];
      meta[m[1]] = m[2] ? unYamlStr(m[2]) : [];
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && Array.isArray(meta[list])) meta[list].push(unYamlStr(item[1]));
    const sub = /^\s+([A-Za-z_][\w-]*):\s*(.+)$/.exec(line);
    if (sub && Array.isArray(meta[list]) && !meta[list].length) meta[`${list}_${sub[1]}`] = unYamlStr(sub[2]);
  }
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const body = lines.slice(end + 1);
  const bodyText = body.find((l) => l.trim() && l.trim() !== "## 证据")?.trim() || "";
  const title = str(meta.title);
  const text = bodyText || title;
  const kindRaw = str(meta.kind), typeRaw = str(meta.type), stateRaw = str(meta.state), statusRaw = str(meta.status).toLowerCase(), idRaw = str(meta.id);
  const kind = KIND_BY_LABEL[typeRaw] && !kindRaw ? KIND_BY_LABEL[typeRaw] : kindRaw || (text && (stateRaw || statusRaw || idRaw) ? "fact" : "");
  if (!kind || !text) return null;
  const genObj = parseInlineObj(meta.generated);
  const verObj = parseInlineObj(meta.verified);
  const verFirst = Array.isArray(meta.verified) ? String(meta.verified[0] || "") : "";
  const verifiedBy = str(meta.verified_by) || str(verObj?.by) || (/^by:\s*(.+)$/.exec(verFirst)?.[1] ? unYamlStr(/^by:\s*(.+)$/.exec(verFirst)[1]) : "");
  const verifiedAt = str(meta.verified_at) || str(verObj?.at);
  const verified = str(meta.verified).toLowerCase() === "true" || Boolean(verifiedBy) || Boolean(verObj?.by);
  const state = ["有效", "已拒绝", "已被替代"].includes(stateRaw) ? stateRaw : (STATUS_TO_STATE[statusRaw] || "有效");
  const status = statusRaw || STATE_TO_STATUS[state] || "active";
  const sources = Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [];
  const provenance = deriveProvenance(sources, str(meta.provenance));
  const verdict = str(meta.verdict).toLowerCase() || (kind === "pattern" ? (verified ? "confirmed" : "pending") : "");
  const evidence = [];
  const at = body.findIndex((l) => l.trim() === "## 证据");
  if (at >= 0) for (const line of body.slice(at + 1)) {
    const m = /^-\s+(.*)$/.exec(line);
    if (m) evidence.push(m[1].trim());
  }
  const entry = {
    id: idRaw || "m-" + createHash("sha256").update(text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")).digest("hex").slice(0, 24),
    kind,
    type: typeRaw || LABEL_BY_KIND[kind] || kind,
    description: str(meta.description) || str(meta.def),
    state,
    status,
    verified,
    verifiedBy,
    verifiedAt,
    provenance,
    generatedBy: str(meta.generated_by) || str(genObj?.by),
    verdict,
    validFrom: str(meta.valid_from),
    validUntil: str(meta.valid_until),
    staleAfter: str(meta.stale_after),
    private: str(meta.private).toLowerCase() === "true",
    project: str(meta.project),
    projectLink: str(meta.project_link),
    concepts: Array.isArray(meta.concepts) ? meta.concepts.filter(Boolean) : parseTagsValue(meta.concepts),
    sourceNotes: Array.isArray(meta.source_notes) ? meta.source_notes.filter(Boolean) : sources.map(sourceLink).filter(Boolean),
    conflictsWith: Array.isArray(meta.conflicts_with) ? meta.conflicts_with.filter(Boolean) : [],
    appliesTo: str(meta.applies_to),
    domain: str(meta.domain) || str(meta.category),
    tags: parseTagsValue(meta.tags),
    date: str(meta.date),
    text,
    sources,
    supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
    supersededBy: str(meta.superseded_by),
    evidence,
  };
  entry.trust = deriveTrustLevel(entry);
  return entry;
}

// `[[日记/2026_11_03#^mem-04f3aa59]]（用户日志，第 32 行）；原文：…` 只留能跳转的那段。
export const sourceLink = (raw) => (/^\[\[[^\]]+\]\]/.exec(String(raw || "").trim()) || [])[0] || "";

// 兼容真实 Vault 顶层 data.json（直接存 settings 字段）与测试夹具里的 { settings: {...} }。
export function readPluginConfig(vault) {
  try {
    const raw = fs.readFileSync(path.join(vault, PLUGIN_SUBDIR, "data.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.settings && typeof parsed.settings === "object" && (parsed.settings.dream || parsed.settings.delegate)) {
      return parsed.settings;
    }
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// 记忆目录：优先跟随插件设置 dream.dir，读不到就用默认值。
export function memoryDirOf(vault) {
  const dir = String(readPluginConfig(vault)?.dream?.dir || "").replace(/[\\/]+$/, "");
  return path.join(vault, dir || MEMORY_DIR_DEFAULT);
}

export function excludedDirsOf(vault) {
  const dirs = readPluginConfig(vault)?.delegate?.excludedDirs || [];
  const list = Array.isArray(dirs) ? dirs : String(dirs || "").split(/[\n,;]+/);
  return list.map((d) => String(d || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
}

const isPrivateNote = (content) => {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return false;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return false;
  return lines.slice(1, end).some((l) => /^private:\s*(?:"true"|'true'|true)\s*$/i.test(l));
};

const isExcludedRel = (rel, dirs = []) => {
  const norm = String(rel || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return Boolean(norm) && dirs.some((d) => norm === d || norm.startsWith(`${d}/`));
};

// 脚本装在 <库>/.obsidian/plugins/agent-deck/scripts/：向上找到带 .obsidian 的目录就是库根。
export function resolveVault(start) {
  const roots = start
    ? [path.resolve(start)]
    : [
        ...(process.argv[1] ? [path.dirname(path.resolve(process.argv[1]))] : []),
        path.dirname(fileURLToPath(import.meta.url)),
      ];
  for (const root of roots) {
    let cur = root;
    for (;;) {
      if (fs.existsSync(path.join(cur, ".obsidian"))) return cur;
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }
  return "";
}

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

export function countArchivedMemories(vault) {
  const archiveDir = path.join(memoryDirOf(vault), MEMORY_ARCHIVE_SUBDIR);
  try {
    return fs.readdirSync(archiveDir).filter((n) => n.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

export function loadMemories(vault, { includeArchived = false } = {}) {
  const dir = memoryDirOf(vault);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "索引.md" && n !== MEMORY_LOG_FILE);
  } catch {
    return { dir, entries: [] };
  }
  const entries = [];
  for (const name of names.sort()) {
    try {
      const abs = path.join(dir, name);
      const parsed = parseMemory(fs.readFileSync(abs, "utf8"));
      if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs });
    } catch {
      /* 单条读不了就跳过，不影响其他条目 */
    }
  }
  if (includeArchived) {
    const archiveDir = path.join(dir, MEMORY_ARCHIVE_SUBDIR);
    let archNames = [];
    try {
      archNames = fs.readdirSync(archiveDir).filter((n) => n.endsWith(".md"));
    } catch {
      archNames = [];
    }
    for (const name of archNames.sort()) {
      try {
        const abs = path.join(archiveDir, name);
        const parsed = parseMemory(fs.readFileSync(abs, "utf8"));
        if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs, archived: true });
      } catch {
        /* 跳过损坏的归档条 */
      }
    }
  }
  return { dir, entries };
}

const active = (entries) => entries.filter((e) => e.state === "有效" && !e.private);

const stripLink = (raw) => String(raw || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();

function entryMetaTerms(entry) {
  const parts = [];
  if (entry?.project) parts.push(entry.project);
  if (entry?.projectLink) parts.push(stripLink(entry.projectLink));
  if (Array.isArray(entry?.concepts)) parts.push(...entry.concepts.map(stripLink));
  if (Array.isArray(entry?.conflictsWith)) parts.push(...entry.conflictsWith.map(stripLink));
  if (entry?.appliesTo) parts.push(entry.appliesTo);
  if (entry?.description) parts.push(entry.description);
  if (Array.isArray(entry?.tags)) parts.push(...entry.tags);
  if (entry?.domain) parts.push(entry.domain);
  if (entry?.type) parts.push(entry.type);
  if (entry?.kind) parts.push(entry.kind);
  for (const src of entry?.sources || []) {
    const m = /^\[\[([^\]|#]+)/.exec(String(src || ""));
    if (m) parts.push(m[1].split("/").pop());
  }
  return terms(parts.join(" "));
}

function analyzeOverlap(text, wanted) {
  const s = String(text || "").toLowerCase();
  const nonOverlapped = new Set();
  const overlapped = new Set();
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const chars = [...run];
    let lastEnd = -1;
    for (let i = 1; i < chars.length; i++) {
      const bg = chars[i - 1] + chars[i];
      if (!wanted.has(bg) || STOP_CJK.has(bg)) continue;
      if (i - 1 >= lastEnd) { nonOverlapped.add(bg); lastEnd = i + 1; }
      else if (!nonOverlapped.has(bg)) overlapped.add(bg);
    }
  }
  return new Set([...overlapped].filter((bg) => !nonOverlapped.has(bg)));
}

function buildIdf(entries) {
  const df = new Map();
  let n = 0;
  for (const e of entries) {
    n++;
    for (const w of new Set([...terms(e.text), ...entryMetaTerms(e)])) df.set(w, (df.get(w) || 0) + 1);
  }
  const idf = new Map();
  for (const [w, count] of df) idf.set(w, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

const TRUST_ALIASES = { human: "human-reviewed", "human-reviewed": "human-reviewed", user: "user-authored", "user-authored": "user-authored", ai: "ai-derived", "ai-derived": "ai-derived" };

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

// IDF + OKF 可信度/新鲜度加权检索：支持单字母+中文（A股）、技术英文词、元数据通道与项目过滤；只返回命中词 why，不打印黑盒分数。
export function searchMemories(entries, query, k = 5, { kind = "", project = "", verifiedOnly = false, includeStale = false, trust = "", nowMs = Date.now() } = {}) {
  const wanted = terms(query);
  if (!wanted.size) return [];
  const wantKind = KIND_BY_LABEL[kind] || kind;
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
  const idf = pool.length >= 6 ? buildIdf(pool) : null;
  const singleTokenQuery = wanted.size === 1;
  const shortCjkQuery = wanted.size <= 2 && [...wanted].every((w) => /^[\u4e00-\u9fff]{2}$/.test(w));
  const scored = [];
  for (const entry of pool) {
    const textTerms = terms(entry.text);
    const metaTerms = entryMetaTerms(entry);
    const textHits = [...textTerms].filter((w) => wanted.has(w) && !STOP_CJK.has(w));
    const metaHits = [...metaTerms].filter((w) => wanted.has(w) && !textTerms.has(w) && !STOP_CJK.has(w));
    const projectMatch = Boolean(wantProj && (
      normProject(entry.project || entry.appliesTo) === wantProj ||
      normProject(stripLink(entry.projectLink)) === wantProj ||
      matchesProject(entry, wantProj)
    ));
    const entryConceptLabels = [
      ...(entry.concepts || []).map(stripLink),
      ...(entry.projectLink ? [stripLink(entry.projectLink)] : []),
    ].filter(Boolean);
    const lowQuery = String(query || "").toLowerCase();
    const conceptMatch = entryConceptLabels.find((c) => {
      const lc = c.toLowerCase();
      return lc.length >= 2 && (/^[a-z0-9_.-]+$/.test(lc) ? new RegExp(`(?<![a-z0-9])${lc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(lowQuery) : lowQuery.includes(lc));
    });
    const hasHybrid = textHits.some(isHybridTerm);
    const hasDistinctiveLatin = textHits.some(isDistinctiveLatinTerm);
    const qualified =
      textHits.length >= 2 ||
      (singleTokenQuery && (textHits.length >= 1 || metaHits.length >= 1)) ||
      (shortCjkQuery && (textHits.length >= 1 || metaHits.length >= 1)) ||
      hasHybrid ||
      (hasDistinctiveLatin && textHits.length >= 1) ||
      (textHits.length >= 1 && metaHits.length >= 1) ||
      Boolean(conceptMatch) ||
      (projectMatch && (textHits.length >= 1 || metaHits.length >= 1));
    if (!qualified) continue;
    const overlappedOnly = analyzeOverlap(entry.text, wanted);
    const wgt = (w) => {
      const base = idf?.get(w) ?? 1;
      const damp = overlappedOnly.has(w) ? 0.5 : 1;
      if (isHybridTerm(w)) return base * 1.4 * damp;
      if (isDistinctiveLatinTerm(w)) return base * 1.15 * damp;
      return base * damp;
    };
    let score = textHits.reduce((s, w) => s + wgt(w), 0) + 0.6 * metaHits.reduce((s, w) => s + wgt(w), 0);
    const matchedTerms = new Set([...textHits, ...metaHits]);
    if (wanted.size >= 2 && matchedTerms.size >= 1) {
      score *= 1 + 0.35 * Math.min(1, matchedTerms.size / Math.min(wanted.size, 6));
    }
    if (conceptMatch) score += textHits.length ? 1.8 : 3.0;
    score /= 1 + Math.max(0, textTerms.size - 24) * 0.015;
    const tLevel = entry.trust || deriveTrustLevel(entry);
    if (tLevel === "human-reviewed") score *= 1.35;
    else if (tLevel === "ai-derived") score *= 0.72;
    if (entry.kind === "pattern" && entry.verdict !== "confirmed") score *= 0.85;
    if (!entry.verified && PROPOSAL_ONLY_RE.test(String(entry.text || ""))) score *= 0.42;
    if (isMemoryStale(entry, nowMs)) score *= 0.35;
    if (projectMatch) score *= 1.35;
    else if (wantProj && isUniversalMemory(entry)) score *= 0.85;
    if (wantProj && (entry.kind === "lesson" || entry.type === "项目经验")) score *= 1.15;
    const why = [...new Set([...textHits, ...metaHits])];
    if (conceptMatch && !why.includes(`图谱:${conceptMatch}`)) why.push(`图谱:${conceptMatch}`);
    scored.push({ entry, why, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(b.entry.date).localeCompare(String(a.entry.date)) || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(1, k))
    .map(({ entry, why }) => ({ entry, why }));
}

// 时间过滤：只认 YYYY-MM-DD；没写日期的条目不参与过滤（在结果尾部说明排除了几条）。
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const inDateRange = (entry, { since = "", until = "" } = {}) => {
  if (!since && !until) return true;
  const day = String(entry?.date || "");
  if (!DATE_RE.test(day)) return false;
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
};

// id / name -> 条；以及"被谁取代"的反查（同时兼容 m-... ID 与 "[[记忆/...]]" 双链）。
export function buildIndexes(entries = []) {
  const byId = new Map();
  const byName = new Map();
  const supersededBy = new Map();
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

export const linkTarget = (link) => String(link || "").replace(/^\[\[|\]\]$/g, "").split("#")[0].trim();

// `[[日记/2026_11_06#^mem-…]]` → 库里真的能打开的那篇笔记的绝对路径（打不开或受隐私排除就不给，不编路径）。
export function notePathOf(vault, target) {
  const rel = String(target || "").trim();
  if (!vault || !rel) return "";
  const excluded = excludedDirsOf(vault);
  for (const candidate of [`${rel}.md`, rel]) {
    if (isExcludedRel(candidate, excluded)) return "";
    const abs = path.join(vault, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      try {
        if (isPrivateNote(fs.readFileSync(abs, "utf8"))) return "";
      } catch { /* ignore */ }
      return abs;
    }
  }
  return "";
}

// 一跳邻接：同概念节点 + 同一来源笔记的其它记忆（同源）+ 来源笔记本身（能读原文）。why 只写事实。
export function neighborsOf(entries = [], entry = null, { vault = "", limit = 2 } = {}) {
  if (!entry) return { coConcept: [], coCitation: [], notes: [] };
  const mineConcepts = new Set([...(entry.concepts || []).map(stripLink), ...(entry.projectLink ? [stripLink(entry.projectLink)] : [])].filter(Boolean));
  const coConcept = [];
  if (mineConcepts.size) {
    for (const other of entries) {
      if (other === entry || other.name === entry.name) continue;
      const otherC = [...(other.concepts || []).map(stripLink), ...(other.projectLink ? [stripLink(other.projectLink)] : [])];
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

// 1–2 跳图谱检索：支持输入记忆（文件名/id）或概念/项目名（Obsidian/RAG/心智模型），顺着概念边与演化链展开。
export function graphOf(entries = [], ref = "", { vault = "", depth = 2 } = {}) {
  const clean = stripLink(ref);
  if (!clean) return null;
  const activePool = active(entries);
  const indexes = buildIndexes(entries);
  const seedEntry = indexes.resolveRef(clean) || entries.find((e) => e.name === clean) || null;
  const conceptsOf = (e) => [...new Set([...(e?.concepts || []).map(stripLink), ...(e?.projectLink ? [stripLink(e.projectLink)] : [])].filter(Boolean))];
  if (seedEntry) {
    const near = neighborsOf(activePool, seedEntry, { vault, limit: 6 });
    const seedConcepts = conceptsOf(seedEntry);
    const hop2 = [];
    if (depth >= 2 && seedConcepts.length) {
      const seenNames = new Set([seedEntry.name, ...near.coConcept.map((x) => x.entry.name)]);
      for (const c of near.coConcept) {
        for (const cName of conceptsOf(c.entry)) {
          if (seedConcepts.includes(cName)) continue;
          for (const other of activePool) {
            if (seenNames.has(other.name)) continue;
            if (conceptsOf(other).includes(cName)) {
              seenNames.add(other.name);
              hop2.push({ entry: other, via: `${c.shared[0]} → ${cName}` });
              if (hop2.length >= 6) break;
            }
          }
          if (hop2.length >= 6) break;
        }
        if (hop2.length >= 6) break;
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
      hop2,
    };
  }
  const want = normProject(clean);
  const hop1 = activePool.filter((e) => conceptsOf(e).some((c) => normProject(c) === want || c.toLowerCase() === clean.toLowerCase()));
  if (!hop1.length) return { mode: "concept", concept: clean, hop1: [], hop2: [], notePath: notePathOf(vault, clean) };
  const hop2 = [];
  if (depth >= 2) {
    const seen = new Set(hop1.map((e) => e.name));
    const bridgeConcepts = new Set();
    for (const e of hop1) for (const c of conceptsOf(e)) if (normProject(c) !== want) bridgeConcepts.add(c);
    for (const bc of bridgeConcepts) {
      for (const e of activePool) {
        if (seen.has(e.name)) continue;
        if (conceptsOf(e).includes(bc)) {
          seen.add(e.name);
          hop2.push({ entry: e, via: `${clean} → ${bc}` });
          if (hop2.length >= 6) break;
        }
      }
      if (hop2.length >= 6) break;
    }
  }
  return { mode: "concept", concept: clean, hop1, hop2, notePath: notePathOf(vault, clean) };
}

export function formatGraph(g) {
  if (!g) return "缺少查询目标（记忆文件名、id 或概念名）";
  if (g.mode === "concept") {
    if (!g.hop1.length) return `图谱中暂无连接到「${g.concept}」的记忆${g.notePath ? `（概念文件：${g.notePath}）` : ""}。`;
    const rows = [`概念图谱：[[${g.concept}]]${g.notePath ? `（${g.notePath}）` : ""}`];
    rows.push(`一跳关联记忆（${g.hop1.length} 条）：`);
    for (const e of g.hop1.slice(0, 10)) rows.push(`- [[${e.name}]] [${e.type || e.kind}] ${e.text}`);
    if (g.hop2.length) {
      rows.push(`二跳扩展记忆（${g.hop2.length} 条）：`);
      for (const item of g.hop2) rows.push(`- [[${item.entry.name}]]（经由 ${item.via}）${item.entry.text}`);
    }
    return rows.join("\n");
  }
  const e = g.target;
  const rows = [`记忆图谱：[[${e.name}]] [${e.type || e.kind}] ${e.text}`];
  if (g.concepts.length) rows.push(`概念锚点：${g.concepts.map((c) => `[[${c}]]`).join("、")}`);
  if (e.projectLink) rows.push(`项目节点：${e.projectLink}`);
  if (g.supersedes.length) rows.push(`取代：${g.supersedes.map((x) => (typeof x === "string" ? x : `[[${x.name}]]`)).join("、")}`);
  if (g.supersededBy.length) rows.push(`已被取代：${g.supersededBy.map((x) => `[[${x.name}]]`).join("、")}`);
  if (g.conflicts.length) rows.push(`冲突边：${g.conflicts.map((x) => (typeof x === "string" ? x : `[[${x.name}]]`)).join("、")}`);
  if (g.near.coConcept.length) {
    rows.push("同概念记忆（1 跳）：");
    for (const c of g.near.coConcept) rows.push(`- [[${c.entry.name}]]（共享 ${c.shared.map((s) => `[[${s}]]`).join("、")}）：${c.entry.text}`);
  }
  if (g.near.coCitation.length) {
    rows.push("同源记忆（1 跳）：");
    for (const c of g.near.coCitation) rows.push(`- [[${c.entry.name}]]（同引 ${c.shared[0]}）：${c.entry.text}`);
  }
  if (g.hop2.length) {
    rows.push("二跳扩散记忆：");
    for (const item of g.hop2) rows.push(`- [[${item.entry.name}]]（经由 ${item.via}）：${item.entry.text}`);
  }
  if (g.near.notes.length) rows.push(`原文笔记：${g.near.notes.join("、")}`);
  return rows.join("\n");
}

export function recentMemories(entries, n = 10, { kind = "", project = "", verifiedOnly = false, includeStale = true, trust = "", nowMs = Date.now() } = {}) {
  const wantKind = KIND_BY_LABEL[kind] || kind;
  const wantProj = normProject(project);
  const wantTrust = TRUST_ALIASES[String(trust || "").trim().toLowerCase()] || "";
  return [...entries]
    .filter((e) => {
      if (wantKind && e.kind !== wantKind) return false;
      if (verifiedOnly && !e.verified) return false;
      if (wantTrust && (e.trust || deriveTrustLevel(e)) !== wantTrust) return false;
      if (!includeStale && isMemoryStale(e, nowMs)) return false;
      if (wantProj && !matchesProject(e, wantProj)) return false;
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, n));
}

// 只接受记忆目录（及 archive 子目录）里的文件名、相对/库内记忆路径或 m-... ID，挡住 `../` 越界。
export function findMemory(entries, dir, ref) {
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
  const abs = path.resolve(dir, relWant);
  const absArchive = path.resolve(dir, MEMORY_ARCHIVE_SUBDIR, path.basename(relWant));
  const insideMain = abs === path.join(dir, path.basename(abs));
  const insideArchive = abs === absArchive;
  if (!insideMain && !insideArchive) return null;
  return entries.find((e) => e.path === abs) || entries.find((e) => e.name === path.basename(relWant)) || null;
}

export const formatEntry = (entry, why = [], extra = {}) => {
  const tLevel = entry.trust || deriveTrustLevel(entry);
  const staleBadge = isMemoryStale(entry) ? " [已过复核期]" : "";
  const archBadge = entry.archived ? " [已归档]" : "";
  const verifiedBadge = tLevel === "human-reviewed" ? " ✓" : tLevel === "ai-derived" ? " [AI提炼·未确认]" : "";
  const projBadge = entry.project ? ` [${entry.project}]` : "";
  const rows = [
    `${entry.date || "无日期"} [${entry.type || entry.kind}]${projBadge}${verifiedBadge}${staleBadge}${archBadge} ${entry.text}`,
    `   文件：${entry.path}`,
  ];
  if (entry.description) rows.push(`   描述：${entry.description}`);
  if (entry.concepts?.length) rows.push(`   概念：${entry.concepts.join("、")}`);
  if (entry.projectLink) rows.push(`   项目链：${entry.projectLink}`);
  if (entry.conflictsWith?.length) rows.push(`   冲突：${entry.conflictsWith.join("、")}`);
  if (why.length) rows.push(`   命中：${why.join("、")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push(`   来源：${links.join("、")}`);
  // 取代链：这条换掉了谁 / 它又被谁换掉了 —— 偏好变了就该看见新旧，而不是只看见新的。
  const replaced = (extra.supersedes || []).map((old) => (typeof old === "string" ? old : `[[${old.name}]]（${old.date || "无日期"}）`));
  if (replaced.length) rows.push(`   取代：${replaced.join("、")}`);
  const supersededBy = (extra.supersededBy || []).map((cur) => `[[${cur.name}]]（${cur.date || "无日期"}）`);
  if (!supersededBy.length && entry.supersededBy) supersededBy.push(entry.supersededBy);
  if (supersededBy.length) rows.push(`   已被取代：${supersededBy.join("、")}`);
  const near = extra.neighbors || {};
  const nearBits = [];
  for (const c of near.coConcept || []) nearBits.push(`同概念 [[${c.entry.name}]]（${c.shared.join("、")}）`);
  for (const c of near.coCitation || []) nearBits.push(`同源 [[${c.entry.name}]]${c.shared?.length ? `（同引 ${c.shared[0]}）` : ""}`);
  for (const note of near.notes || []) nearBits.push(`原文 ${note}`);
  if (nearBits.length) rows.push(`   邻接：${nearBits.join("；")}`);
  return rows.join("\n");
};

export function formatRead(entry) {
  const tLevel = entry.trust || deriveTrustLevel(entry);
  const rows = [
    `记忆：${entry.text}`,
    `文件：${entry.path}`,
    `类型：${entry.type || entry.kind}　状态：${entry.state}（${entry.status || STATE_TO_STATUS[entry.state] || "active"}）　可信度：${tLevel}　日期：${entry.date || "无"}${entry.project ? `　项目：${entry.project}` : ""}${entry.verified ? "　已验证" : ""}`,
  ];
  if (entry.description) rows.push(`描述：${entry.description}`);
  if (entry.tags?.length) rows.push(`标签：${entry.tags.join("、")}`);
  if (entry.staleAfter || entry.validUntil) rows.push(`复核截止：${entry.staleAfter || entry.validUntil}`);
  if (entry.supersedes.length) rows.push(`替代：${entry.supersedes.join("；")}`);
  if (entry.supersededBy) rows.push(`被取代：${entry.supersededBy}`);
  if (entry.conflictsWith?.length) rows.push(`冲突：${entry.conflictsWith.join("、")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push("来源：", ...links.map((l) => `- ${l}`));
  rows.push("正文：", entry.text);
  if (entry.evidence.length) rows.push("证据：", ...entry.evidence.map((e) => `- ${e}`));
  return rows.join("\n");
}

export function formatIndex(entries = [], { kind = "", project = "", limit = 30 } = {}) {
  const wantKind = KIND_BY_LABEL[kind] || kind;
  const wantProj = normProject(project);
  const filtered = active(entries).filter((e) => {
    if (wantKind && e.kind !== wantKind) return false;
    if (wantProj && !matchesProject(e, wantProj)) return false;
    return true;
  });
  const byKind = { lesson: 0, preference: 0, fact: 0, pattern: 0 };
  const projects = new Map();
  const conceptCounts = new Map();
  let verified = 0;
  for (const e of filtered) {
    if (Object.hasOwn(byKind, e.kind)) byKind[e.kind]++;
    if (e.verified) verified++;
    if (e.project) projects.set(e.project, (projects.get(e.project) || 0) + 1);
    const seenConcept = new Set();
    for (const raw of [...(e.concepts || []), ...(e.projectLink ? [e.projectLink] : [])]) {
      const name = stripLink(raw);
      const lk = name.toLowerCase();
      if (!name || seenConcept.has(lk)) continue;
      seenConcept.add(lk);
      conceptCounts.set(name, (conceptCounts.get(name) || 0) + 1);
    }
  }
  const head = [
    `共 ${filtered.length} 条有效记忆（已确认 ${verified} 条）`,
    `分布：项目经验 ${byKind.lesson} · 偏好 ${byKind.preference} · 事实 ${byKind.fact} · 待验证规律 ${byKind.pattern}`,
  ];
  if (projects.size) {
    head.push(`项目：${[...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, c]) => `${p}(${c})`).join("、")}`);
  }
  if (conceptCounts.size) {
    head.push(`高频概念：${[...conceptCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([c, n]) => `[[${c}]](${n})`).join(" · ")}`);
  }
  const sorted = [...filtered].sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
  const rows = sorted.slice(0, Math.max(1, limit)).map((e) => {
    const tLevel = e.trust || deriveTrustLevel(e);
    const mark = isMemoryStale(e) ? "⚠ " : tLevel === "human-reviewed" ? "✓ " : tLevel === "ai-derived" ? "[AI] " : "";
    const proj = e.project ? `[${e.project}] ` : "";
    return `- ${e.date || "—"} [${e.type || e.kind}] ${mark}${proj}${e.text} (${e.name})`;
  });
  if (sorted.length > rows.length) rows.push(`（已省略 ${sorted.length - rows.length} 条，用 search 关键词或 --project/--kind 缩小范围）`);
  return withBudget([...head, "", ...rows]);
}

export function formatStats(entries = [], { vault = "", archivedCount = 0 } = {}) {
  const byState = { 有效: 0, 已拒绝: 0, 已被替代: 0 };
  const byKind = { lesson: 0, preference: 0, fact: 0, pattern: 0 };
  const byProv = { user: 0, ai: 0, mixed: 0, other: 0 };
  const existsInVault = vault
    ? (target) => {
      const clean = String(target || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!clean || clean.includes("..")) return false;
      return fs.existsSync(path.join(vault, `${clean}.md`)) || fs.existsSync(path.join(vault, clean));
    }
    : null;
  let verified = 0, unanchoredVault = 0, externalImport = 0, staleCount = 0;
  for (const e of entries) {
    if (Object.hasOwn(byState, e.state)) byState[e.state]++;
    if (e.state === "有效") {
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
  const archPart = archivedCount ? ` · 已归档 ${archivedCount} 条` : "";
  return [
    `记忆库统计：共 ${entries.length} 条`,
    `状态：有效 ${byState.有效} · 已拒绝 ${byState.已拒绝} · 已被替代 ${byState.已被替代}`,
    `有效分类：项目经验 ${byKind.lesson} · 偏好 ${byKind.preference} · 事实 ${byKind.fact} · 待验证规律 ${byKind.pattern}`,
    `来源分布：用户日志 ${byProv.user} · AI 提炼 ${byProv.ai} · 混合 ${byProv.mixed} · 导入/手动 ${byProv.other}`,
    `质量：已确认 ${verified}/${byState.有效} · 过复核期 ${staleCount} 条 · 库内可补锚 ${unanchoredVault} 条 · 外部导入免补锚 ${externalImport} 条${archPart}`,
  ].join("\n");
}

// 写入单条未确认候选记忆（仅由 MCP --allow-write 触发，默认 CLI 严格只读）。
export function proposeMemory(vault, { text, kind = "fact", shortTitle = "", description = "", domain = "", project = "", projectLink = "", concepts = [], tags = [], source = "agent-mcp" } = {}) {
  const clean = String(text || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean || clean.length < 4 || clean.length > 500 || /[<>]/.test(clean)) {
    throw new Error("记忆正文需为 4–500 字的单行纯文本，且不能包含 <>");
  }
  const cleanKind = KIND_BY_LABEL[kind] || kind;
  if (!Object.hasOwn(LABEL_BY_KIND, cleanKind)) throw new Error(`未知记忆类型：${kind}`);
  const { dir, entries } = loadMemories(vault, { includeArchived: true });
  const id = "m-" + createHash("sha256").update(clean.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")).digest("hex").slice(0, 24);
  const existing = entries.find((e) => e.id === id);
  if (existing) return { created: false, duplicate: true, rejected: existing.state === "已拒绝", entry: existing };
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rawNameSrc = String(shortTitle || clean)
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, shortTitle ? 24 : 22)
    .replace(/[，。、；：！？,.;:!?（(【「《\s]+$/u, "") || "记忆";
  const taken = new Set(fs.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)));
  let name = rawNameSrc;
  for (let n = 2; taken.has(name) && n < 100; n++) name = `${rawNameSrc}-${n}`;
  const cleanDesc = String(description || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 160);
  const cleanDomain = String(domain || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 40);
  const cleanProj = String(project || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 60);
  const rawProjLink = stripLink(projectLink);
  const cleanProjLink = rawProjLink ? `[[${rawProjLink}]]` : "";
  const cleanConcepts = [...new Set((Array.isArray(concepts) ? concepts : [])
    .map((x) => stripLink(x))
    .filter(Boolean)
    .map((c) => `[[${c}]]`))].slice(0, 5);
  const cleanTags = (Array.isArray(tags) ? tags : []).map((x) => String(x || "").replace(/[\r\n<>]+/g, " ").trim()).filter(Boolean).slice(0, 5);
  const srcLine = String(source || "agent-mcp").replace(/[\r\n]+/g, " ").trim();
  const srcLinks = [sourceLink(srcLine)].filter(Boolean);
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${yamlStr(clean)}`,
    `kind: ${cleanKind}`,
    `type: ${LABEL_BY_KIND[cleanKind]}`,
    "state: 有效",
    "status: active",
    `date: ${date}`,
    ...(cleanDesc ? [`description: ${yamlStr(cleanDesc)}`] : []),
    ...(cleanProj ? [`project: ${yamlStr(cleanProj)}`] : []),
    ...(cleanProjLink ? [`project_link: ${yamlStr(cleanProjLink)}`] : []),
    ...(cleanDomain ? [`domain: ${yamlStr(cleanDomain)}`] : []),
    ...(cleanConcepts.length ? ["concepts:", ...cleanConcepts.map((c) => `  - ${yamlStr(c)}`)] : []),
    ...(cleanTags.length ? ["tags:", ...cleanTags.map((tg) => `  - ${yamlStr(tg)}`)] : []),
    "provenance: ai-log",
    "generated_by: mcp",
    ...(cleanKind === "pattern" ? ["verdict: pending"] : []),
    ...(srcLinks.length ? ["source_notes:", ...srcLinks.map((s) => `  - ${yamlStr(s)}`)] : []),
    "sources:",
    `  - ${yamlStr(srcLine)}`,
    "---",
    "",
    clean,
    "",
  ];
  const filePath = path.join(dir, `${name}.md`);
  fs.writeFileSync(filePath, lines.join("\n"), { encoding: "utf8", flag: "wx" });
  return { created: true, duplicate: false, path: filePath, id, name };
}

const usage = () =>
  [
    "用法：",
    '  node memory-query.mjs index [--kind K] [--project P] [--k 30] [--vault /库根]',
    '  node memory-query.mjs search "关键词" [--k 5] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--include-stale] [--all] [--vault /库根]',
    "  node memory-query.mjs graph <记忆文件名/ID/概念名> [--depth 2] [--vault /库根]",
    "  node memory-query.mjs read <记忆文件名或ID> [--vault /库根]",
    "  node memory-query.mjs recent [n] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--vault /库根]",
    "  node memory-query.mjs stats [--vault /库根]",
  ].join("\n");

// 输出预算：超了要明说省略了几条（静默截断等于骗人）。
function withBudget(blocks) {
  const out = [];
  let size = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (size + blocks[i].length + 1 > MAX_OUTPUT) {
      out.push(`（已省略 ${blocks.length - i} 条，用 --k 缩小范围或直接 read 具体文件）`);
      return out.join("\n");
    }
    out.push(blocks[i]);
    size += blocks[i].length + 1;
  }
  return out.join("\n");
}

export function run(argv, { start } = {}) {
  const [verb, ...rest] = argv;
  const flags = { k: 5, depth: 2, vault: "", dir: "", since: "", until: "", kind: "", project: "", verified: false, includeStale: false, trust: "", all: false };
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--k") flags.k = Number(rest[++i]) || 5;
    else if (a === "--depth") flags.depth = Number(rest[++i]) || 2;
    else if (a === "--vault") flags.vault = rest[++i] || "";
    else if (a === "--since") flags.since = rest[++i] || "";
    else if (a === "--until") flags.until = rest[++i] || "";
    else if (a === "--kind") flags.kind = rest[++i] || "";
    else if (a === "--project") flags.project = rest[++i] || "";
    else if (a === "--verified") flags.verified = true;
    else if (a === "--include-stale") flags.includeStale = true;
    else if (a === "--trust") flags.trust = rest[++i] || "";
    else if (a === "--all") flags.all = true;
    else if (a.startsWith("--k=")) flags.k = Number(a.slice(4)) || 5;
    else if (a.startsWith("--depth=")) flags.depth = Number(a.slice(8)) || 2;
    else if (a.startsWith("--vault=")) flags.vault = a.slice(8);
    else if (a.startsWith("--since=")) flags.since = a.slice(8);
    else if (a.startsWith("--until=")) flags.until = a.slice(8);
    else if (a.startsWith("--kind=")) flags.kind = a.slice(7);
    else if (a.startsWith("--project=")) flags.project = a.slice(10);
    else if (a.startsWith("--trust=")) flags.trust = a.slice(8);
    else args.push(a);
  }
  if (!verb || verb === "-h" || verb === "--help") return { code: verb ? 0 : 2, out: usage() };

  // 没给 --vault 就向上找；找不到就报错，不拿当前目录当库根静默跑出空结果。
  const vault = flags.vault ? path.resolve(flags.vault) : resolveVault(start);
  if (!vault || !fs.existsSync(vault)) return { code: 2, out: `找不到库根；用 --vault 指过来：${flags.vault || "(未给)"}` };

  for (const [flag, value] of [["--since", flags.since], ["--until", flags.until]]) {
    if (value && !DATE_RE.test(value)) return { code: 2, out: `${flag} 要写 YYYY-MM-DD，收到的是：${value}` };
  }
  if (flags.since && flags.until && flags.since > flags.until) return { code: 2, out: `--since 比 --until 晚：${flags.since} > ${flags.until}` };

  const includeArchived = Boolean(flags.all) && (verb === "search" || verb === "recent");
  const { dir, entries } = loadMemories(vault, { includeArchived });
  const all = flags.all
    ? entries.filter((e) => !e.private)
    : active(entries);
  const pool = all.filter((e) => inDateRange(e, flags));
  const dated = all.length - pool.length;
  const rangeNote = flags.since || flags.until
    ? `（时间过滤 ${flags.since || "…"} → ${flags.until || "…"}：${dated} 条不在区间或无日期，已排除）`
    : "";
  const indexes = buildIndexes(entries);
  const extrasFor = (entry) => ({
    supersedes: (entry.supersedes || []).map((id) => indexes.resolveRef(id) || id),
    supersededBy: indexes.supersededBy.get(entry.id) || indexes.supersededBy.get(entry.name) || [],
    neighbors: neighborsOf(pool, entry, { vault, limit: 2 }),
  });

  if (verb === "index") {
    return { code: 0, out: formatIndex(pool, { kind: flags.kind, project: flags.project, limit: flags.k === 5 ? 30 : flags.k }) };
  }

  if (verb === "stats") {
    return { code: 0, out: formatStats(entries, { vault, archivedCount: countArchivedMemories(vault) }) };
  }

  if (verb === "graph") {
    const target = args.join(" ").trim();
    if (!target) return { code: 2, out: usage() };
    return { code: 0, out: formatGraph(graphOf(entries, target, { vault, depth: flags.depth })) };
  }

  if (verb === "search") {
    const query = args.join(" ").trim();
    if (!query) return { code: 2, out: usage() };
    const hits = searchMemories(pool, query, flags.k, {
      kind: flags.kind,
      project: flags.project,
      verifiedOnly: flags.verified,
      includeStale: flags.all || flags.includeStale,
      trust: flags.trust,
    });
    if (!hits.length) {
      const scope = pool.length === all.length ? `可查 ${pool.length} 条有效记忆` : `时间过滤后还有 ${pool.length} 条（原 ${all.length} 条）`;
      return { code: 0, out: `没有匹配「${query}」的记忆（${scope}，目录：${dir}）。${rangeNote}` };
    }
    const blocks = hits.map((h, i) => `${i + 1}. ${formatEntry(h.entry, h.why, extrasFor(h.entry))}`);
    return { code: 0, out: withBudget(blocks) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "recent") {
    const n = Number(args[0]) || 10;
    const list = recentMemories(pool, n, {
      kind: flags.kind,
      project: flags.project,
      verifiedOnly: flags.verified,
      includeStale: flags.all || flags.includeStale,
      trust: flags.trust,
    });
    if (!list.length) {
      const empty = all.length ? `这段时间里没有记忆（原 ${all.length} 条）` : "记忆库还是空的";
      return { code: 0, out: `${empty}（目录：${dir}）。${rangeNote}` };
    }
    return { code: 0, out: withBudget(list.map((e, i) => `${i + 1}. ${formatEntry(e, [], extrasFor(e))}`)) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "read") {
    const target = args[0];
    if (!target) return { code: 2, out: usage() };
    let allEntries = entries;
    let hit = findMemory(allEntries, dir, target);
    if (!hit) {
      allEntries = loadMemories(vault, { includeArchived: true }).entries;
      hit = findMemory(allEntries, dir, target);
    }
    if (!hit) return { code: 1, out: `找不到记忆：${target}（目录：${dir}）。先用 search 或 recent 取文件名。` };
    const readIndexes = buildIndexes(allEntries);
    const readExtras = {
      supersedes: (hit.supersedes || []).map((id) => readIndexes.resolveRef(id) || id),
      supersededBy: readIndexes.supersededBy.get(hit.id) || readIndexes.supersededBy.get(hit.name) || [],
      neighbors: neighborsOf(pool, hit, { vault, limit: 2 }),
    };
    return { code: 0, out: [formatRead(hit), formatEntry(hit, [], readExtras).split("\n").slice(2).join("\n")].filter(Boolean).join("\n") };
  }

  return { code: 2, out: `不认识的动词：${verb}\n${usage()}` };
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const real = (p) => {
      let s;
      try { s = (fs.realpathSync.native || fs.realpathSync)(p); } catch { s = path.resolve(p); }
      s = s.replace(/^(?:\\\\\?\\|\/\/\?\/)/, "").replace(/\\/g, "/");
      return process.platform === "win32" ? s.toLowerCase() : s;
    };
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out + "\n");
  process.exitCode = code;
}
