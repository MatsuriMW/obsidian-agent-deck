// Vault-level read-only context tools (`vault_find`, `vault_outline`, `vault_read`, `vault_related`).
// Zero Obsidian / Electron / i18n dependencies; enforces privacy gates and zero-silent-loss guarantees.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fencedLines, frontmatterEnd, LIST_RE, subtreeEnd, width } from "../outline.js";
import { isDistinctiveLatinTerm, isHybridTerm, isPrivateFrontmatter, STOP_CJK, terms } from "../memory-query-core.js";
import { normalizeLinkName } from "../memory-graph.js";
import { isCaseInsensitiveFs, isPathContainedIn, mcpSettingsOf, realPathSafe } from "./config.js";
import { computeAnchorHash, loadVaultIndex } from "./vault-index.js";
import {
  BLOCK_ID_SUFFIX_RE,
  isInternalTaskBlockId,
  cleanUserNoteLine,
  cleanUserNoteLines,
  extractOkfSummaryParts,
  findHeadingRange,
  collectRemainingHeadings,
  aiGeneratedLineIndices,
} from "./note-hygiene.js";
import { searchFtsIndex } from "./fts-index.js";
import { activeMemories, loadMemories, withBudget } from "./memory-ops.js";

const OKF_VAULT_KEYS = ["type", "def", "domain", "category", "father", "status", "verified"];

function blockedGeneratedError(ref, resolved) {
  if (resolved?.blockedMemoryStore) {
    return `目标属于 Agent Deck 记忆库（已沉淀记忆请使用 memory_search / memory_read / memory_index 检索，不混入普通笔记）：${ref}`;
  }
  return `目标属于 AI/插件自动生成文件，不作为用户数据参与 Vault 检索：${ref}`;
}

function readRawNote(vault, relPath, readOverride = null) {
  if (typeof readOverride === "function") {
    const ov = readOverride(relPath);
    if (typeof ov === "string") return ov;
  }
  const abs = path.join(vault, ...relPath.split("/").filter(Boolean));
  const realVault = realPathSafe(vault);
  const realTarget = (fs.realpathSync.native || fs.realpathSync)(abs);
  if (!isPathContainedIn(realVault, realTarget, { caseInsensitive: isCaseInsensitiveFs(realVault) })) {
    throw new Error(`目标路径越界（符号链接指向 Vault 外）：${relPath}`);
  }
  return fs.readFileSync(realTarget, "utf8");
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
    if (expectedTargets.has(clean) || (base && expectedTargets.has(base))) return true;
  }
  return false;
}

function extractBacklinkBlocks(vault, backlinks = [], { limit = 3, maxCharsPerBlock = 200, readOverride = null, targetNames = null } = {}) {
  const candidates = backlinks.filter((b) => !b.standaloneNoChild);
  const sorted = [...candidates].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    return b.sourcePath.localeCompare(a.sourcePath) || b.line - a.line;
  });
  const seenHashes = new Set();
  const fileLinesCache = new Map();
  const items = [];

  for (const bl of sorted) {
    if (items.length >= limit) break;
    let cached = fileLinesCache.get(bl.sourcePath);
    if (!cached) {
      try {
        const raw = readRawNote(vault, bl.sourcePath, readOverride);
        if (isPrivateFrontmatter(raw)) continue;
        const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
        const aiLines = aiGeneratedLineIndices(lines, { startLine: frontmatterEnd(lines) });
        cached = { lines, aiLines };
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
      const relIdx = expectedSet.size
        ? lines.findIndex((l, li) => !aiLines.has(li) && lineMentionsTarget(l, expectedSet))
        : -1;
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
    const dedupHash = createHash("sha256").update(cleaned.replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 12);
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
      text = outLines.join("\n").slice(0, maxCharsPerBlock).trimEnd() + "…";
    }
    const signalLabel = bl.strong ? "强信号" : "句中提及";
    items.push({
      sourcePath: bl.sourcePath,
      line: bl.line,
      strong: bl.strong,
      why: `${signalLabel} · ${bl.sourcePath.replace(/\.md$/i, "")}(L${bl.line})`,
      text,
    });
  }
  return items;
}

export function vaultFind(vault, query, { k = 8, domain = "", type = "", tag = "", fulltext = true, indexOpts = {} } = {}) {
  const q = String(query || "").trim();
  const wantK = Math.max(1, Math.min(30, Number(k) || 8));
  const wantTerms = terms(q);
  const lowQ = q.toLowerCase();
  const wantDomain = String(domain || "").trim().toLowerCase();
  const wantType = String(type || "").trim().toLowerCase();
  const wantTag = String(tag || "").trim().replace(/^#/, "").toLowerCase();

  const idx = loadVaultIndex(vault, indexOpts);
  const matchesByPath = new Map();

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
      why.push("标题精确匹配");
    } else if (aliasExact) {
      rank += 90;
      why.push(`别名精确匹配:${aliasExact}`);
    } else if (lowQ && nameLow.includes(lowQ)) {
      rank += 45;
      why.push("标题包含");
    } else if (lowQ && (entry.aliases || []).some((a) => a.toLowerCase().includes(lowQ))) {
      rank += 35;
      why.push("别名包含");
    }

    if (wantTerms.size) {
      const titleTerms = terms([entry.name, ...(entry.aliases || [])].join(" "));
      const defTerms = terms(entry.def);
      const metaTerms = terms([entry.domain, entry.category, entry.type, ...(entry.tags || [])].join(" "));
      const headTerms = terms((entry.headings || []).map((h) => h.title).join(" "));
      const pathTerms = terms(entry.path.replace(/\.md$/i, "").replace(/\//g, " "));

      const tHits = [...titleTerms].filter((w) => wantTerms.has(w));
      const dHits = [...defTerms].filter((w) => wantTerms.has(w) && !titleTerms.has(w));
      const mHits = [...metaTerms].filter((w) => wantTerms.has(w));
      const hHits = [...headTerms].filter((w) => wantTerms.has(w));
      const pHits = [...pathTerms].filter((w) => wantTerms.has(w) && !titleTerms.has(w));

      const covered = new Set([...tHits, ...dHits, ...mHits, ...hHits, ...pHits]);
      const distinctiveTerms = [...wantTerms].filter((w) => isDistinctiveLatinTerm(w) || isHybridTerm(w));
      if (!why.length) {
        let okMatch = false;
        if (distinctiveTerms.length > 0) {
          okMatch = distinctiveTerms.some((w) => covered.has(w));
        } else {
          const minCovered = wantTerms.size === 1 ? 1 : (wantTerms.size >= 4 ? Math.min(3, Math.ceil(wantTerms.size * 0.45)) : 2);
          okMatch = covered.size >= minCovered;
        }
        if (!okMatch && !wantDomain && !wantType && !wantTag) continue;
      }

      rank += tHits.length * 10 + dHits.length * 6 + mHits.length * 5 + hHits.length * 4 + pHits.length * 3;
      if (tHits.length) why.push(`标题词:${tHits.slice(0, 3).join("/")}`);
      if (dHits.length) why.push(`def:${dHits.slice(0, 3).join("/")}`);
      if (mHits.length) why.push(`属性:${mHits.slice(0, 3).join("/")}`);
      if (hHits.length) why.push(`章节:${hHits.slice(0, 2).join("/")}`);
      if (pHits.length) why.push(`路径:${pHits.slice(0, 2).join("/")}`);
    } else if (wantDomain || wantType || wantTag) {
      rank += 10;
      if (wantDomain) why.push(`领域:${entry.domain || entry.category}`);
      if (wantType) why.push(`类型:${entry.type}`);
      if (wantTag) why.push(`标签:#${wantTag}`);
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
      _rank: rank,
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
      },
    });
    for (const hit of ftsHits) {
      const entry = idx.byPath.get(hit.path);
      if (!entry || entry.isGenerated) continue;
      if (wantDomain && !`${entry.domain} ${entry.category}`.toLowerCase().includes(wantDomain)) continue;
      if (wantType && entry.type.toLowerCase() !== wantType) continue;
      if (wantTag && !(entry.tags || []).some((tg) => tg.toLowerCase() === wantTag)) continue;

      const label = hit.matchKind === "phrase" ? "正文短语命中" : "正文全文命中";
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
          _rank: rank,
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
    items,
  };
}

export function formatVaultFind(res) {
  if (!res || !res.items.length) {
    return `全库未找到匹配「${res?.query || ""}」的非私密笔记。`;
  }
  const blocks = res.items.map((it, i) => {
    const meta = [it.type ? `[${it.type}]` : "", it.domain ? `领域:${it.domain}` : "", it.backlinkCount ? `反链:${it.backlinkCount}` : ""].filter(Boolean).join(" · ");
    const rows = [`${i + 1}. [[${it.name}]] (${it.path})${meta ? ` — ${meta}` : ""}`];
    if (it.def) rows.push(`   def：${it.def}`);
    else if (it.bodyLen <= 50 && it.backlinkCount) rows.push(`   正文较短（内容主要分布在 ${it.backlinkCount} 条反链中）`);
    if (it.snippet) rows.push(`   片段：${it.snippet.replace(/\s+/g, " ").trim().slice(0, 140)}`);
    rows.push(`   命中：${it.why.join("；")}`);
    return rows.join("\n");
  });
  const tail = res.omittedCount > 0 ? `\n（共匹配 ${res.totalMatches} 篇，已显示前 ${res.items.length} 篇，省略 ${res.omittedCount} 篇；可加 --k 或缩小筛选条件）` : "";
  return withBudget(blocks) + tail;
}

export function vaultOutline(vault, ref, { readOverride = null, indexOpts = {} } = {}) {
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `目标笔记受隐私设置保护，禁止读取：${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `找不到笔记：${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  let raw = "";
  try {
    raw = readRawNote(vault, relPath, readOverride);
  } catch (e) {
    return { ok: false, error: `读取笔记失败（${relPath}）：${e?.message || e}` };
  }
  if (isPrivateFrontmatter(raw)) {
    return { ok: false, blockedPrivate: true, error: `目标笔记受隐私设置保护，禁止读取：${relPath}` };
  }
  const mcpCfg = mcpSettingsOf(vault, { configDir: indexOpts?.configDir || "" });
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = mcpCfg.excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : new Set();

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
      listSummary.push({ line: i + 1, kind: ordered ? "有序列表项" : "无序列表项", snippet });
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
    candidates: resolved.candidates,
  };
}

export function formatVaultOutline(res) {
  if (!res?.ok) return res?.error || "无法生成大纲";
  const rows = [`大纲：${res.path}（共 ${res.totalLines} 行，正文从 L${res.bodyStartLine} 起）`];
  if (res.candidates?.length > 1) rows.push(`同名候选（当前取最短/同目录）：${res.candidates.join("、")}`);
  if (res.skippedAiLines > 0) rows.push(`已过滤：跳过 ${res.skippedAiLines} 行 AI 自动记录（仅展示用户笔记结构）`);
  if (res.okf.length) rows.push(`属性：${res.okf.join(" | ")}`);
  if (res.backlinkCount || res.sonsCount) rows.push(`结构统计：反链 ${res.backlinkCount} 条 · 子概念 ${res.sonsCount} 篇`);
  if (res.headings.length) {
    rows.push("章节树（只列结构，不含正文）：");
    const maxH = 40;
    for (const h of res.headings.slice(0, maxH)) {
      rows.push(`${"  ".repeat(Math.max(0, h.level - 1))}- ${"#".repeat(h.level)} ${h.title} (L${h.line})`);
    }
    if (res.headings.length > maxH) rows.push(`  （已省略 ${res.headings.length - maxH} 个后续标题）`);
  } else if (res.listSummary.length) {
    rows.push("顶层列表项：");
    for (const item of res.listSummary.slice(0, 20)) {
      rows.push(`- [${item.kind}] L${item.line}: ${item.snippet}`);
    }
    if (res.listSummary.length > 20) rows.push(`  （已省略 ${res.listSummary.length - 20} 条顶层列表）`);
  } else {
    rows.push("（无标题或顶层列表结构，可直接用 vault_read 读取）");
  }
  if (res.anchors.length) {
    rows.push(`可用块锚点（${res.anchors.length} 个）：`);
    for (const a of res.anchors.slice(0, 20)) rows.push(`- ^${a.id} (L${a.line}): ${a.snippet}`);
    if (res.anchors.length > 20) rows.push(`  （已省略 ${res.anchors.length - 20} 个锚点）`);
  }
  return rows.join("\n");
}

export function vaultRead(vault, ref, {
  startLine = 0,
  startChar = 0,
  maxLines = 120,
  maxChars = 6000,
  expectedHash = "",
  includeAiLogs = undefined,
  readOverride = null,
  indexOpts = {},
} = {}) {
  const mcpCfg = mcpSettingsOf(vault, { configDir: indexOpts?.configDir || "" });
  const effectiveIncludeAiLogs = typeof includeAiLogs === "boolean" ? includeAiLogs : !mcpCfg.excludeAiLogs;
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `目标笔记受隐私设置保护，禁止读取：${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `找不到笔记：${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  let raw = "";
  try {
    raw = readRawNote(vault, relPath, readOverride);
  } catch (e) {
    return { ok: false, error: `读取笔记失败（${relPath}）：${e?.message || e}` };
  }
  if (isPrivateFrontmatter(raw)) {
    return { ok: false, blockedPrivate: true, error: `目标笔记受隐私设置保护，禁止读取：${relPath}` };
  }

  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = effectiveIncludeAiLogs ? new Set() : aiGeneratedLineIndices(lines, { startLine: fmEnd });
  const subpath = resolved.subpath || "";

  let sliceStart = 0;
  let sliceEnd = lines.length;
  let mode = "full";

  if (subpath.startsWith("^")) {
    mode = "block";
    const wantId = subpath.slice(1);
    const hitIdx = lines.findIndex((l, i) => !fenced.has(i) && (BLOCK_ID_SUFFIX_RE.exec(l)?.[1] || "") === wantId);
    if (hitIdx < 0) {
      return { ok: false, error: `锚点已漂移或不存在：在 ${relPath} 中找不到块 #^${wantId}（绝不回退文件开头）。` };
    }
    if (!effectiveIncludeAiLogs && aiLines.has(hitIdx)) {
      return {
        ok: false,
        blockedAiLog: true,
        error: `目标块属于 AI 自动生成的日志记录，默认不作为用户数据读取（已沉淀结论请查 memory_search；若确需排查原始日志，请传 include_ai_logs=true）：${relPath}#${subpath}`,
      };
    }
    sliceStart = hitIdx;
    sliceEnd = subtreeEnd(lines, hitIdx);
  } else if (subpath) {
    mode = "heading";
    const sec = findHeadingRange(lines, subpath, { fenced });
    if (!sec) {
      const avail = (meta?.headings || []).slice(0, 8).map((h) => `${h.title}(L${h.line})`).join("、");
      return { ok: false, error: `找不到章节：${relPath}#${subpath}${avail ? `（可用章节：${avail}）` : ""}` };
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
  const anchorHash = computeAnchorHash(`${hPath}\n${leadText}`);
  const changedSinceDispatch = Boolean(expectedHash && expectedHash !== anchorHash);

  const lineBudget = Math.max(10, Math.min(400, Number(maxLines) || 120));
  const charBudget = Math.max(400, Math.min(20000, Number(maxChars) || 6000));
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
  const remainingHeadings = truncated
    ? collectRemainingHeadings(lines, { fromIdx: shownTo, endIdx: sliceEnd, maxLevel: 4, maxItems: 6, fenced, skipLines: aiLines })
      .map((h) => `${h.hashes} ${h.title}(L${h.line})`)
    : [];

  // Empty-body concept note fallback: surface strong backlinks when note body is <= 50 non-whitespace chars.
  let backlinkFallback = null;
  if (!subpath && Number(startLine) <= 0) {
    const nonSpaceBody = filtered.map((e) => e.text).join("").replace(/\s+/g, "");
    if (nonSpaceBody.length <= 50) {
      const allBl = idx.backlinks.get(relPath) || [];
      if (allBl.length > 30) {
        backlinkFallback = { broadTopic: true, totalBacklinks: allBl.length, excerpts: [] };
      } else if (allBl.length > 0) {
        const targetNames = new Set([meta?.name, ...(meta?.aliases || []), relPath.replace(/\.md$/i, "")]
          .map((n) => normalizeLinkName(n).toLowerCase())
          .filter(Boolean));
        backlinkFallback = {
          broadTopic: false,
          totalBacklinks: allBl.length,
          excerpts: extractBacklinkBlocks(vault, allBl, { limit: 3, maxCharsPerBlock: 200, readOverride, targetNames }),
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
    absPath: path.join(vault, ...relPath.split("/").filter(Boolean)),
    subpath,
    mode,
    totalLines: lines.length,
    shownFrom,
    shownTo,
    skippedAiLines,
    truncated,
    nextStartLine: truncated ? (nextStartLineOverride || (shownTo + 1)) : 0,
    nextStartChar: truncated ? nextStartChar : 0,
    remainingHeadings,
    okf: extractOkfSummaryParts(meta, { keys: OKF_VAULT_KEYS, maxKeys: OKF_VAULT_KEYS.length }),
    anchorHash,
    changedSinceDispatch,
    expectedHash,
    childAnchors,
    content: picked.map((e) => e.text).join("\n").trimEnd(),
    backlinkFallback,
  };
}

export function formatVaultRead(res) {
  if (!res?.ok) return res?.error || "读取失败";
  const rows = [
    `笔记：${res.path}${res.subpath ? `#${res.subpath}` : ""}（L${res.shownFrom}–L${res.shownTo} / 共 ${res.totalLines} 行 · anchorHash=${res.anchorHash}）`,
    `绝对路径：${res.absPath}`,
  ];
  if (res.changedSinceDispatch) {
    rows.push(`⚠️ 原文锚点已漂移（派发时=${res.expectedHash}，当前=${res.anchorHash}），此前注入摘要可能过期，请以本次正文为准。`);
  }
  if (res.skippedAiLines > 0) {
    rows.push(`已过滤：跳过 ${res.skippedAiLines} 行 AI 自动记录（不视作用户数据；已沉淀结论请用 memory_search）`);
  }
  if (res.okf.length) rows.push(`属性：${res.okf.join(" | ")}`);
  if (res.childAnchors.length) rows.push(`段内锚点：${res.childAnchors.join("、")}`);
  rows.push("", res.content || "（正文为空）");

  if (res.backlinkFallback) {
    const fb = res.backlinkFallback;
    if (fb.broadTopic) {
      rows.push("", `反链退路：宽泛领域词，共 ${fb.totalBacklinks} 条反链（超过 30 条不展开，可用 vault_related 或搜索具体笔记）。`);
    } else if (fb.excerpts.length) {
      rows.push("", `正文较少，已从 ${fb.totalBacklinks} 条反链中抽取 ${fb.excerpts.length} 条高信号片段：`);
      for (const ex of fb.excerpts) {
        rows.push(`- [${ex.why}]\n  ${ex.text.replace(/\n/g, "\n  ")}`);
      }
      if (fb.totalBacklinks > fb.excerpts.length) {
        rows.push(`  （共 ${fb.totalBacklinks} 条反链，已内联 ${fb.excerpts.length} 条，其余可用 vault_related 查看）`);
      }
    }
  }

  if (res.truncated) {
    const toc = res.remainingHeadings.length ? `；后续章节：${res.remainingHeadings.join(" | ")}` : "";
    const cursor = res.nextStartChar > 0 ? `start_line=${res.nextStartLine}, start_char=${res.nextStartChar}` : `start_line=${res.nextStartLine}`;
    rows.push("", `（已按预算截断，可用 ${cursor} 续读${toc}）`);
  }
  return rows.join("\n");
}

export function vaultRelated(vault, ref, { k = 8, indexOpts = {} } = {}) {
  const wantK = Math.max(1, Math.min(20, Number(k) || 8));
  const idx = loadVaultIndex(vault, indexOpts);
  const resolved = idx.resolveNote(ref);
  if (resolved.blockedPrivate) {
    return { ok: false, blockedPrivate: true, error: `目标笔记受隐私设置保护，禁止访问：${ref}` };
  }
  if (resolved.blockedGenerated) {
    return { ok: false, blockedPrivate: false, blockedGenerated: true, error: blockedGeneratedError(ref, resolved) };
  }
  if (!resolved.path) {
    return { ok: false, blockedPrivate: false, error: `找不到笔记：${ref}` };
  }
  const relPath = resolved.path;
  const meta = idx.byPath.get(relPath);
  const items = [];
  const seen = new Set([relPath]);
  const pushItem = (targetPath, kind, why, extra = {}) => {
    if (!targetPath || seen.has(targetPath) || idx.privatePaths.has(targetPath) || idx.generatedPaths?.has(targetPath)) return;
    seen.add(targetPath);
    const targetMeta = idx.byPath.get(targetPath);
    items.push({
      path: targetPath,
      name: targetMeta?.name || path.posix.basename(targetPath, ".md"),
      kind,
      why,
      trust: targetMeta?.verified ? "verified" : "",
      stale: Boolean(targetMeta?.staleAfter && Date.parse(targetMeta.staleAfter) < Date.now()),
      ...extra,
    });
  };

  // 1. Explicit structural edges: father -> sons -> domain/category
  if (meta?.father) {
    const fRes = idx.resolveNote(normalizeLinkName(meta.father), relPath);
    if (fRes.path) pushItem(fRes.path, "father", `父概念 (father: ${meta.father})`);
  }
  for (const sonPath of idx.sonsByFather.get(relPath) || []) {
    pushItem(sonPath, "son", `子概念 (father 指向 [[${meta.name}]])`);
  }
  const domainTarget = meta?.domain || meta?.category || "";
  if (domainTarget) {
    const dRes = idx.resolveNote(normalizeLinkName(domainTarget), relPath);
    if (dRes.path) pushItem(dRes.path, "domain", `所属领域 (domain: ${domainTarget})`);
  }

  // 2. Backlinks (strong first, newer diary path first)
  const bls = [...(idx.backlinks.get(relPath) || [])].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    return b.sourcePath.localeCompare(a.sourcePath) || a.line - b.line;
  });
  for (const bl of bls) {
    pushItem(bl.sourcePath, "backlink", `${bl.strong ? "强信号反链" : "句中反链"} · ${bl.sourcePath.replace(/\.md$/i, "")}(L${bl.line})`);
  }

  // 3. Outgoing links
  for (const lk of meta?.links || []) {
    const dest = idx.resolveNote(lk.target, relPath);
    if (dest.path) pushItem(dest.path, "outlink", `本文引用 (L${lk.line})`);
  }

  // 4. Related Dream memories
  const memories = [];
  try {
    const { entries } = loadMemories(vault, { configDir: indexOpts.configDir || "" });
    const wantLow = meta.name.toLowerCase();
    const aliasLows = new Set((meta.aliases || []).map((a) => a.toLowerCase()));
    for (const m of activeMemories(entries)) {
      const mConcepts = [...(m.concepts || []), ...(m.projectLink ? [m.projectLink] : [])].map((c) => normalizeLinkName(c).toLowerCase());
      const mSources = (m.sourceNotes?.length ? m.sourceNotes : m.sources).map((s) => normalizeLinkName(s).toLowerCase());
      const hitConcept = mConcepts.some((c) => c === wantLow || aliasLows.has(c));
      const hitSource = mSources.some((s) => s === wantLow || s === relPath.replace(/\.md$/i, "").toLowerCase());
      if (hitConcept || hitSource) {
        memories.push({
          id: m.id,
          name: m.name,
          kind: m.type || m.kind,
          text: m.text,
          why: hitConcept ? `关联概念记忆 [${m.type || m.kind}]` : `提炼自本笔记 [${m.type || m.kind}]`,
        });
      }
    }
  } catch { /* vault has no dream memories yet */ }

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
    memories: shownMemories,
  };
}

export function formatVaultRelated(res) {
  if (!res?.ok) return res?.error || "查询关联失败";
  const rows = [`结构邻接：[[${res.name}]] (${res.path})`];
  if (res.items.length) {
    rows.push(`关联笔记（显示 ${res.items.length} / 共 ${res.totalItems} 篇）：`);
    for (const it of res.items) {
      const flags = [it.trust === "verified" ? "✓" : "", it.stale ? "过期" : ""].filter(Boolean).join(" ");
      rows.push(`- [[${it.name}]] (${it.path})${flags ? ` [${flags}]` : ""} — ${it.why}`);
    }
    if (res.omittedItems > 0) rows.push(`  （已省略 ${res.omittedItems} 篇关联笔记，可加大 k 查看）`);
  } else {
    rows.push("关联笔记：暂无显式结构边或非私密反链。");
  }
  if (res.memories.length) {
    rows.push(`关联长期记忆（显示 ${res.memories.length} / 共 ${res.totalMemories} 条）：`);
    for (const m of res.memories) rows.push(`- [[${m.name}]] (${m.id}) — ${m.why}：${m.text}`);
  }
  return rows.join("\n");
}
