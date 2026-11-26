// Shared Memory operations for CLI, MCP, and runtime contexts.
// Reuses memory-query-core, memory-store, and memory-graph as the single source of truth.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  STOP_LATIN,
  STOP_CJK,
  rawTerms,
  terms,
  isHybridTerm,
  isDistinctiveLatinTerm,
  isPrivateFrontmatter,
  isPathExcluded,
  deriveTrustLevel,
  isMemoryStale,
  computeIdfMap,
  PROPOSAL_ONLY_RE,
  normalizeProjectKey,
  entryMetaTerms,
  analyzeTextHits,
} from "../memory-query-core.js";
import {
  MEMORY_DIR_DEFAULT,
  MEMORY_LOG_FILE,
  MEMORY_ARCHIVE_SUBDIR,
  STATE_TO_STATUS,
  STATUS_TO_STATE,
  deriveProvenance,
  memoryIdOf,
  yamlStr,
  parseMemoryFile,
  classifyAnchorStatus,
} from "../memory-store.js";
import { deriveShortMemoryTitle, normalizeLinkName } from "../memory-graph.js";
import {
  resolveVault,
  readPluginConfig,
  memoryDirOf,
  excludedDirsOf,
} from "./config.js";

export {
  MEMORY_DIR_DEFAULT,
  MEMORY_LOG_FILE,
  MEMORY_ARCHIVE_SUBDIR,
  STOP_LATIN,
  STOP_CJK,
  rawTerms,
  terms,
  deriveProvenance,
  deriveTrustLevel,
  isMemoryStale,
  classifyAnchorStatus,
  resolveVault,
  readPluginConfig,
  memoryDirOf,
  excludedDirsOf,
};

export const MAX_OUTPUT = 6000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_BY_LABEL = { 事实: "fact", 偏好: "preference", 待验证规律: "pattern", 项目经验: "lesson" };
const LABEL_BY_KIND = { fact: "事实", preference: "偏好", pattern: "待验证规律", lesson: "项目经验" };
const TRUST_ALIASES = {
  human: "human-reviewed",
  "human-reviewed": "human-reviewed",
  user: "user-authored",
  "user-authored": "user-authored",
  ai: "ai-derived",
  "ai-derived": "ai-derived",
};

const normProject = normalizeProjectKey;
const stripLink = (raw) => normalizeLinkName(raw);
export const sourceLink = (raw) => (/^\[\[[^\]]+\]\]/.exec(String(raw || "").trim()) || [])[0] || "";
export const linkTarget = (link) => String(link || "").replace(/^\[\[|\]\]$/g, "").split("#")[0].trim();

export function parseMemory(content) {
  const parsed = parseMemoryFile(content);
  if (!parsed) return null;
  if (!parsed.sourceNotes?.length && parsed.sources?.length) {
    parsed.sourceNotes = parsed.sources.map(sourceLink).filter(Boolean);
  }
  return parsed;
}

export function countArchivedMemories(vault, opts = {}) {
  const archiveDir = path.join(memoryDirOf(vault, opts), MEMORY_ARCHIVE_SUBDIR);
  try {
    return fs.readdirSync(archiveDir).filter((n) => n.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

export function loadMemories(vault, { includeArchived = false, configDir = "" } = {}) {
  const dir = memoryDirOf(vault, { configDir });
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
      const raw = fs.readFileSync(abs, "utf8");
      if (isPrivateFrontmatter(raw)) continue;
      const parsed = parseMemory(raw);
      if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs });
    } catch { /* skip unreadable */ }
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
        const raw = fs.readFileSync(abs, "utf8");
        if (isPrivateFrontmatter(raw)) continue;
        const parsed = parseMemory(raw);
        if (parsed && !parsed.private) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs, archived: true });
      } catch { /* skip corrupt archived entry */ }
    }
  }
  return { dir, entries };
}

export const activeMemories = (entries) => entries.filter((e) => e.state === "有效" && !e.private);

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
  const idf = pool.length >= 6 ? computeIdfMap(pool) : null;
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
      return lc.length >= 2 && (/^[a-z0-9_.-]+$/.test(lc)
        ? new RegExp(`(?<![a-z0-9])${lc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(lowQuery)
        : lowQuery.includes(lc));
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
    const { overlappedOnly } = analyzeTextHits(entry.text, wanted);
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

export const inDateRange = (entry, { since = "", until = "" } = {}) => {
  if (!since && !until) return true;
  const day = String(entry?.date || "");
  if (!DATE_RE.test(day)) return false;
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
};

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

export function notePathOf(vault, target) {
  const rel = String(target || "").trim().replace(/\\/g, "/");
  if (!vault || !rel || rel.split("/").includes("..")) return "";
  const excluded = excludedDirsOf(vault);
  for (const candidate of [`${rel}.md`, rel]) {
    if (isPathExcluded(candidate, excluded)) return "";
    const abs = path.join(vault, ...candidate.split("/").filter(Boolean));
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        if (isPrivateFrontmatter(fs.readFileSync(abs, "utf8"))) return "";
        return abs;
      }
    } catch { /* ignore */ }
  }
  return "";
}

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

export function graphOf(entries = [], ref = "", { vault = "", depth = 2 } = {}) {
  const clean = stripLink(ref);
  if (!clean) return null;
  const activePool = activeMemories(entries);
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

export function withBudget(blocks, maxOutput = MAX_OUTPUT) {
  const out = [];
  let size = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (size + blocks[i].length + 1 > maxOutput) {
      out.push(`（已省略 ${blocks.length - i} 条，用 --k 缩小范围或直接 read 具体文件）`);
      return out.join("\n");
    }
    out.push(blocks[i]);
    size += blocks[i].length + 1;
  }
  return out.join("\n");
}

export function formatIndex(entries = [], { kind = "", project = "", limit = 30 } = {}) {
  const wantKind = KIND_BY_LABEL[kind] || kind;
  const wantProj = normProject(project);
  const filtered = activeMemories(entries).filter((e) => {
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

export function proposeMemory(vault, { text, kind = "fact", shortTitle = "", description = "", domain = "", project = "", projectLink = "", concepts = [], tags = [], source = "agent-mcp", configDir = "" } = {}) {
  const clean = String(text || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean || clean.length < 4 || clean.length > 500 || /[<>]/.test(clean)) {
    throw new Error("记忆正文需为 4–500 字的单行纯文本，且不能包含 <>");
  }
  const cleanKind = KIND_BY_LABEL[kind] || kind;
  if (!Object.hasOwn(LABEL_BY_KIND, cleanKind)) throw new Error(`未知记忆类型：${kind}`);
  const { dir, entries } = loadMemories(vault, { includeArchived: true, configDir });
  const id = memoryIdOf(clean);
  const existing = entries.find((e) => e.id === id);
  if (existing) return { created: false, duplicate: true, rejected: existing.state === "已拒绝", entry: existing };
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const nameBase = shortTitle
    ? String(shortTitle).replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24).replace(/[，。、；：！？,.;:!?（(【「《\s]+$/u, "") || "记忆"
    : deriveShortMemoryTitle(clean, 22);
  const taken = new Set(fs.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)));
  let name = nameBase;
  for (let n = 2; taken.has(name) && n < 100; n++) name = `${nameBase}-${n}`;
  const cleanDesc = String(description || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 160);
  const cleanDomain = String(domain || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 40);
  const cleanProj = String(project || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 60);
  const cleanSingleLineLink = (raw) => stripLink(String(raw || "").replace(/[\r\n]+/g, " ")).replace(/[\r\n]+/g, " ").trim();
  const rawProjLink = cleanSingleLineLink(projectLink);
  const cleanProjLink = rawProjLink ? `[[${rawProjLink}]]` : "";
  const cleanConcepts = [...new Set((Array.isArray(concepts) ? concepts : [])
    .map((x) => cleanSingleLineLink(x))
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
