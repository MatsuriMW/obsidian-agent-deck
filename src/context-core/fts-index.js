// Pure Node SQLite FTS5 trigram full-text index engine (`node:sqlite` Built-in).
// Zero native dependencies; gracefully degrades to `json-fallback` on older Node runtimes.
// Strict privacy boundary: `private: true` notes never enter `docs_fts`.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fencedLines, frontmatterEnd } from "../outline.js";
import { isPrivateFrontmatter } from "../memory-query-core.js";
import { aiGeneratedLineIndices, cleanUserNoteLine } from "./note-hygiene.js";

export const FTS_SCHEMA_VERSION = 2;
const MAX_BODY_CHARS = 48000;

let cachedSqlite = undefined;

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

export function loadNodeSqlite() {
  if (cachedSqlite !== undefined) return cachedSqlite;
  const modId = "node:" + "sqlite";
  const loaders = [];
  if (typeof module !== "undefined" && typeof module.require === "function") {
    loaders.push(() => module.require.bind(module));
  }
  loaders.push(() => createRequire(pathToFileURL(path.join(process.cwd(), "_")).href));
  for (const makeReq of loaders) {
    try {
      const mod = withoutSqliteWarning(() => makeReq()(modId));
      if (mod && typeof mod.DatabaseSync === "function") {
        cachedSqlite = mod;
        return cachedSqlite;
      }
    } catch { /* try next loader */ }
  }
  cachedSqlite = null;
  return cachedSqlite;
}

export function ftsFilePath(cacheFile) {
  const s = String(cacheFile || "");
  if (!s) return "";
  return s.endsWith(".json") ? `${s.slice(0, -5)}.fts.sqlite` : `${s}.fts.sqlite`;
}

export function sanitizeBodyForFts(raw, { excludeAiLogs = true } = {}) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fmEnd = frontmatterEnd(lines);
  const fenced = fencedLines(lines);
  const aiLines = excludeAiLogs ? aiGeneratedLineIndices(lines, { startLine: fmEnd }) : new Set();
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

export function ftsNeedsSync(ftsFile, { excludedKey = "", entries = {} } = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile) return false;
  if (!fs.existsSync(ftsFile)) return true;
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
      if (
        row.mtime_ms !== (entry.mtimeMs || 0) ||
        row.size !== (entry.size || 0) ||
        row.is_private !== (entry.private ? 1 : 0) ||
        row.is_generated !== (entry.isGenerated ? 1 : 0)
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function syncFtsIndex(ftsFile, {
  realVault = "",
  excludedKey = "",
  entries = {},
  changedRawMap = null,
  deletedPaths = [],
  readRawByPath = null,
  forceRebuild = false,
  excludeAiLogs = true,
} = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile) return { enabled: false, engine: "json-fallback", syncedCount: 0, dirty: false };

  fs.mkdirSync(path.dirname(ftsFile), { recursive: true });
  const db = new sqlite.DatabaseSync(ftsFile);
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
  let syncedCount = 0;
  let skippedUnreadable = 0;

  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const { reset } = ensureSchema(db, { realVault, excludedKey, forceRebuild });
      const existing = new Map();
      if (!reset) {
        for (const row of db.prepare("SELECT path, mtime_ms, size, is_private, is_generated FROM docs").all()) {
          existing.set(row.path, row);
        }
      }

      const delDoc = db.prepare("DELETE FROM docs WHERE path = ?");
      const delFts = db.prepare("DELETE FROM docs_fts WHERE path = ?");
      const upsertDoc = db.prepare(
        "INSERT OR REPLACE INTO docs (path, mtime_ms, size, is_private, is_generated) VALUES (?, ?, ?, ?, ?)",
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
          try { raw = readRawByPath(rel); } catch { raw = null; }
        }
        if (raw == null) {
          // Leave existing docs row stale/absent and mark DB incomplete so later incremental sync retries.
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

        const titleText = [entry.name || "", ...(entry.aliases || [])].filter(Boolean).join(" ");
        const metaText = [
          entry.def || "",
          entry.domain || "",
          entry.category || "",
          entry.type || "",
          ...(entry.tags || []),
          ...((entry.headings || []).map((h) => h.title)),
        ].filter(Boolean).join(" ");
        const bodyText = sanitizeBodyForFts(raw, { excludeAiLogs });
        insFts.run(rel, titleText, metaText, bodyText);
        syncedCount++;
      }
      setMeta.run("sync_complete", skippedUnreadable === 0 ? "1" : "0");
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
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
  const seen = new Set();
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
  const prefix = start > 0 ? "…" : "";
  const suffix = end < src.length ? "…" : "";
  const rawMatch = src.slice(idx, idx + needleLow.length);
  return `${prefix}${src.slice(start, idx)}«${rawMatch}»${src.slice(idx + needleLow.length, end)}${suffix}`;
}

export function searchFtsIndex(ftsFile, query, { limit = 24, filterPath = null } = {}) {
  const sqlite = loadNodeSqlite();
  if (!sqlite || !ftsFile || !fs.existsSync(ftsFile)) return [];
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
               snippet(docs_fts, 3, '«', '»', '…', 14) AS snip,
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
        const batchSize = pathAllowed || shortTerms.length ? Math.max(wantLimit * 4, 80) : wantLimit;
        const hits = [];
        for (let offset = 0; offset < 2000; offset += batchSize) {
          const batch = stmt.all(expr, batchSize, offset);
          for (const r of batch) {
            if (pathAllowed && !pathAllowed(r.path)) continue;
            if (shortTerms.length) {
              const hay = `${r.title || ""}\n${r.meta || ""}\n${r.body || ""}`.toLowerCase();
              if (!shortTerms.every((t) => hay.includes(t.low))) continue;
            }
            hits.push(r);
            if (hits.length >= wantLimit) break;
          }
          if (hits.length >= wantLimit || batch.length < batchSize) break;
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
        const hay = `${r.title || ""}\n${r.body || ""}`.toLowerCase();
        const isPhrase = phrases.some((p) => hay.includes(p.toLowerCase())) || (all.length === 1 && all[0].text.length >= 4 && hay.includes(all[0].low));
        return {
          path: r.path,
          snippet: snip.slice(0, 140),
          matchKind: isPhrase ? "phrase" : "fts5",
        };
      });
    }

    // Sub-3-character CJK/Latin fallback (e.g. "A股", "UI", "记忆") via indexed table scan.
    const primary = shortTerms[0];
    const subStmt = db.prepare(`
      SELECT path, title, meta, body
      FROM docs_fts
      WHERE instr(lower(body), ?) > 0 OR instr(lower(title), ?) > 0 OR instr(lower(meta), ?) > 0
      LIMIT ? OFFSET ?
    `);
    const batchSize = pathAllowed ? Math.max(wantLimit * 4, 120) : wantLimit * 3;
    const matched = [];
    for (let offset = 0; offset < 4000; offset += batchSize) {
      const subRows = subStmt.all(primary.low, primary.low, primary.low, batchSize, offset);
      for (const r of subRows) {
        if (pathAllowed && !pathAllowed(r.path)) continue;
        const hay = `${r.title || ""}\n${r.meta || ""}\n${r.body || ""}`.toLowerCase();
        if (!shortTerms.every((t) => hay.includes(t.low))) continue;
        matched.push({
          path: r.path,
          snippet: buildWindowSnippet(r.body || r.meta || r.title || "", primary.low),
          matchKind: "substr",
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
