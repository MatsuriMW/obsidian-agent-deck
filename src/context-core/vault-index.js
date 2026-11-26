// Incremental, discardable local Vault metadata & backlink index.
// Strictly derived cache under ~/.agent-deck/index/; Markdown remains the sole source of truth.
// Private notes (`private: true` or inside `excludedDirs`) never leak metadata into the index.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fencedLines, LIST_RE, subtreeEnd } from "../outline.js";
import { isPathExcluded, isPrivateFrontmatter } from "../memory-query-core.js";
import { normalizeLinkName } from "../memory-graph.js";
import {
  excludedDirsOf,
  isCaseInsensitiveFs,
  isPathContainedIn,
  mcpSettingsOf,
  memoryDirOf,
  normalizeRelPath,
  readPluginConfig,
  readVaultFileStrict,
  realPathSafe,
} from "./config.js";
import {
  BLOCK_ID_SUFFIX_RE,
  TASK_KW_STRIP_RE,
  isInternalTaskBlockId,
  parseListValue,
  parseFrontmatter,
  aiGeneratedLineIndices,
  buildGeneratedMatchers,
  isGeneratedVaultFile,
} from "./note-hygiene.js";
import { ftsFilePath, ftsNeedsSync, loadNodeSqlite, syncFtsIndex } from "./fts-index.js";

export { isInternalTaskBlockId };
export const INDEX_VERSION = 2;
export const DEFAULT_INDEX_DIR = () => path.join(os.homedir(), ".agent-deck", "index");

const INLINE_TAG_RE = /(?:^|[\s(（\[【])#([\p{L}\p{N}_/-]{1,48})/gu;
const WIKILINK_SCAN_RE = /!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

const MEM_CACHE = new Map();

function isTestRuntime() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((a) => /(?:^|[\\/])test[\\/]|\.test\.mjs$/i.test(String(a)));
}

export function computeAnchorHash(text) {
  const norm = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 8);
}

function indexFilePath(realVault, indexDir = "") {
  const dir = indexDir ? path.resolve(indexDir) : DEFAULT_INDEX_DIR();
  const key = createHash("sha256").update(process.platform === "win32" ? realVault.toLowerCase() : realVault).digest("hex").slice(0, 16);
  return { dir, file: path.join(dir, `${key}.json`) };
}

function parseNoteMetadata(raw, relPath, stat, generatedMatchers, { excludeAiLogs = true } = {}) {
  if (isPrivateFrontmatter(raw)) {
    return {
      path: relPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      private: true,
      isGenerated: false,
      isMemoryStore: false,
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
      isMemoryStore: gen.isMemoryStore,
    };
  }

  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const { fmEnd, meta } = parseFrontmatter(lines);

  const str = (v) => (Array.isArray(v) ? String(v[0] || "").trim() : String(v || "").trim());
  const aliases = [...new Set([...parseListValue(meta.aliases), ...parseListValue(meta.alias)])];
  const tagSet = new Set();
  for (const tg of [...parseListValue(meta.tags), ...parseListValue(meta.tag)]) {
    const clean = tg.replace(/^#/, "").trim();
    if (clean) tagSet.add(clean);
  }

  const fenced = fencedLines(lines);
  const aiLines = excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : new Set();
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

    // Mask inline code and URLs before scanning inline #tags and wikilinks.
    const masked = line
      .replace(/`[^`]*`/g, "")
      .replace(/https?:\/\/\S+/gi, "");

    for (const tm of masked.matchAll(INLINE_TAG_RE)) {
      const tg = String(tm[1] || "").trim();
      if (tg && !/^\d+$/.test(tg)) tagSet.add(tg);
    }

    const strippedForPos = masked
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX/\-]\]\s+/, "")
      .replace(TASK_KW_STRIP_RE, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(BLOCK_ID_SUFFIX_RE, "")
      .replace(/%%[^%]*?%%/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();

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
          standaloneNoChild,
        });
      }
    }
  }

  const baseName = path.posix.basename(relPath, ".md");

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
    links,
  };
}

function walkVaultMarkdown(vaultDir, excludedDirs, { realVault = "", caseInsensitive = false } = {}) {
  const rootReal = realVault || realPathSafe(vaultDir);
  const found = [];
  const walk = (absDir, relPrefix) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.name || ent.name.startsWith(".") || ent.name === "node_modules") continue;
      if (ent.isSymbolicLink()) continue;
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (isPathExcluded(rel, excludedDirs, { caseInsensitive })) continue;
        const nextDir = path.join(absDir, ent.name);
        if (!isPathContainedIn(rootReal, realPathSafe(nextDir), { caseInsensitive })) continue;
        walk(nextDir, rel);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        if (isPathExcluded(rel, excludedDirs, { caseInsensitive })) continue;
        const abs = path.join(absDir, ent.name);
        try {
          const lst = fs.lstatSync(abs);
          if (lst.isSymbolicLink() || !lst.isFile()) continue;
          if (!isPathContainedIn(rootReal, realPathSafe(abs), { caseInsensitive })) continue;
          found.push({ rel, abs, mtimeMs: lst.mtimeMs, size: lst.size });
        } catch { /* ignore vanished file */ }
      }
    }
  };
  walk(rootReal, "");
  return found;
}

export function clearVaultIndexCache(vault, { indexDir = "" } = {}) {
  const realVault = realPathSafe(vault);
  const { file } = indexFilePath(realVault, indexDir);
  const ftsFile = ftsFilePath(file);
  MEM_CACHE.delete(`${realVault}|${file}`);
  for (const p of [file, ftsFile, `${ftsFile}-wal`, `${ftsFile}-shm`]) {
    try {
      if (p && fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch { /* ignore */ }
  }
}

export function loadVaultIndex(vault, {
  indexDir = "",
  persist = undefined,
  excludedDirs = null,
  memoryDir = "",
  forceRebuild = false,
  disableFts = false,
  cacheTtlMs = 0,
  configDir = "",
  excludeAiLogs = undefined,
} = {}) {
  const cleanVault = String(vault || "").trim();
  if (!cleanVault || !fs.existsSync(cleanVault)) {
    throw new Error(`找不到 Vault 目录：${vault || "(未指定)"}`);
  }
  const realVault = realPathSafe(cleanVault);
  const cfg = readPluginConfig(cleanVault, { configDir });
  const mcpCfg = mcpSettingsOf(cleanVault, { configDir });
  const effectiveExcludeAiLogs = typeof excludeAiLogs === "boolean" ? excludeAiLogs : mcpCfg.excludeAiLogs;
  const excluded = Array.isArray(excludedDirs) ? excludedDirs : excludedDirsOf(cleanVault, { configDir });
  const memRel = normalizeRelPath(memoryDir || cfg?.dream?.dir || path.relative(cleanVault, memoryDirOf(cleanVault, { configDir })));
  const generatedMatchers = buildGeneratedMatchers({
    memoryDir: memRel,
    dreamPath: cfg?.dream?.path || "",
    doneArchivePath: cfg?.doneArchivePath || "",
  });

  const caseInsensitive = isCaseInsensitiveFs(realVault);
  const { dir: cacheDir, file: cacheFile } = indexFilePath(realVault, indexDir);
  const shouldPersist = persist !== undefined ? Boolean(persist) : (Boolean(indexDir) || !isTestRuntime());
  const memKey = `${realVault}|${cacheFile}`;
  const exclKey = JSON.stringify({
    excluded: caseInsensitive ? excluded.map((d) => d.toLowerCase()) : excluded,
    generatedKey: generatedMatchers.key,
    caseInsensitive,
    excludeAiLogs: effectiveExcludeAiLogs,
  });
  const inMem = !forceRebuild ? MEM_CACHE.get(memKey) : null;

  if (
    inMem?.builtIndex &&
    inMem.version === INDEX_VERSION &&
    inMem.excludedKey === exclKey &&
    cacheTtlMs > 0 &&
    (Date.now() - inMem.builtAt) < cacheTtlMs &&
    Boolean(disableFts) === Boolean(!inMem.ftsFile)
  ) {
    return {
      ...inMem.builtIndex,
      stats: { ...inMem.builtIndex.stats, cacheHit: true, reindexedFiles: 0 },
    };
  }

  let prevEntries = null;
  let cacheHit = false;
  if (!forceRebuild) {
    if (inMem && inMem.version === INDEX_VERSION && inMem.excludedKey === exclKey) {
      prevEntries = inMem.entries;
      cacheHit = true;
    } else if (shouldPersist && fs.existsSync(cacheFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        if (raw && raw.version === INDEX_VERSION && raw.excludedKey === exclKey && raw.entries && typeof raw.entries === "object") {
          prevEntries = raw.entries;
          cacheHit = true;
        }
      } catch { /* corrupt cache, rebuild */ }
    }
  }

  const files = walkVaultMarkdown(cleanVault, excluded, { realVault, caseInsensitive });
  const nextEntries = {};
  const changedRawMap = new Map();
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
    } catch { /* unreadable or out-of-vault file skipped */ }
  }

  const deletedPaths = prevEntries ? Object.keys(prevEntries).filter((k) => !Object.hasOwn(nextEntries, k)) : [];
  const deletedCount = deletedPaths.length;
  MEM_CACHE.set(memKey, { version: INDEX_VERSION, excludedKey: exclKey, entries: nextEntries });

  if (shouldPersist && (!cacheHit || reindexedFiles > 0 || deletedCount > 0 || !fs.existsSync(cacheFile))) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({
        version: INDEX_VERSION,
        vault: realVault,
        excludedKey: exclKey,
        excludeAiLogs: effectiveExcludeAiLogs,
        updatedAt: Date.now(),
        entries: nextEntries,
      }), "utf8");
    } catch { /* cache write is best-effort */ }
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
          excludeAiLogs: effectiveExcludeAiLogs,
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

  if (
    cacheHit &&
    reindexedFiles === 0 &&
    deletedCount === 0 &&
    inMem?.builtIndex &&
    inMem.ftsFile === ftsFile &&
    inMem.ftsEngine === ftsEngine
  ) {
    inMem.builtAt = Date.now();
    return {
      ...inMem.builtIndex,
      stats: { ...inMem.builtIndex.stats, cacheHit: true, reindexedFiles: 0 },
    };
  }

  const byPath = new Map();
  const byPathLower = new Map();
  const privatePaths = new Set();
  const privateLowerNames = new Set();
  const generatedPaths = new Set();
  const generatedMemoryPaths = new Set();
  const byName = new Map();
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
      privateLowerNames.add(path.posix.basename(rel, ".md").toLowerCase());
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
        candidates: [],
      };
    }
    const direct = byPathLower.get(withMd.toLowerCase());
    if (direct) return { path: direct, subpath, blockedPrivate: false, blockedGenerated: false, blockedMemoryStore: false, candidates: [direct] };

    const bare = clean.replace(/\.md$/i, "").toLowerCase();
    const cands = byName.get(bare) || [];
    if (!cands.length) {
      return { path: "", subpath, blockedPrivate: privateLowerNames.has(bare), blockedGenerated: false, blockedMemoryStore: false, candidates: [] };
    }
    const fromDir = fromPath ? path.posix.dirname(fromPath) : "";
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

  const backlinks = new Map();
  const sonsByFather = new Map();

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
        standaloneNoChild: Boolean(lk.standaloneNoChild),
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
      ftsEngine,
    },
  };
  MEM_CACHE.set(memKey, {
    version: INDEX_VERSION,
    excludedKey: exclKey,
    entries: nextEntries,
    builtIndex,
    builtAt: Date.now(),
    ftsFile,
    ftsEngine,
  });
  return builtIndex;
}

export function peekVaultIndexStatus(vault, { indexDir = "", configDir = "" } = {}) {
  const cleanVault = String(vault || "").trim();
  const hasSqlite = Boolean(loadNodeSqlite());
  if (!cleanVault || !fs.existsSync(cleanVault)) {
    return {
      exists: false,
      ftsEngine: hasSqlite ? "sqlite-fts5" : "json-fallback",
      indexedFiles: 0,
      generatedCount: 0,
      privateCount: 0,
      totalFiles: 0,
      updatedAt: 0,
      excludeAiLogs: true,
    };
  }
  const realVault = realPathSafe(cleanVault);
  const mcpCfg = mcpSettingsOf(cleanVault, { configDir });
  const { file: cacheFile } = indexFilePath(realVault, indexDir);
  const candidateFts = ftsFilePath(cacheFile);
  const memKey = `${realVault}|${cacheFile}`;
  const inMem = MEM_CACHE.get(memKey);
  if (inMem?.builtIndex?.stats) {
    const st = inMem.builtIndex.stats;
    return {
      exists: true,
      ftsEngine: st.ftsEngine || (hasSqlite && fs.existsSync(candidateFts) ? "sqlite-fts5" : "json-fallback"),
      indexedFiles: st.indexedFiles || 0,
      generatedCount: st.generatedCount || 0,
      privateCount: st.privateCount || 0,
      totalFiles: st.totalFiles || 0,
      updatedAt: inMem.builtAt || 0,
      excludeAiLogs: mcpCfg.excludeAiLogs,
    };
  }
  if (fs.existsSync(cacheFile)) {
    try {
      const disk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const entries = disk?.entries && typeof disk.entries === "object" ? Object.values(disk.entries) : [];
      let indexedFiles = 0;
      let generatedCount = 0;
      let privateCount = 0;
      for (const e of entries) {
        if (!e || typeof e !== "object") continue;
        if (e.private) privateCount++;
        else if (e.isGenerated) generatedCount++;
        else indexedFiles++;
      }
      const stat = fs.statSync(cacheFile);
      return {
        exists: true,
        ftsEngine: hasSqlite && fs.existsSync(candidateFts) ? "sqlite-fts5" : (hasSqlite ? "sqlite-fts5" : "json-fallback"),
        indexedFiles,
        generatedCount,
        privateCount,
        totalFiles: entries.length,
        updatedAt: Number(disk?.updatedAt) || stat.mtimeMs || 0,
        excludeAiLogs: typeof disk?.excludeAiLogs === "boolean" ? disk.excludeAiLogs : mcpCfg.excludeAiLogs,
      };
    } catch { /* corrupt cache */ }
  }
  return {
    exists: false,
    ftsEngine: hasSqlite ? "sqlite-fts5" : "json-fallback",
    indexedFiles: 0,
    generatedCount: 0,
    privateCount: 0,
    totalFiles: 0,
    updatedAt: 0,
    excludeAiLogs: mcpCfg.excludeAiLogs,
  };
}
