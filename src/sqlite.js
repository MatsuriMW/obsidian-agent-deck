// Cross-platform SQLite discovery and read-only query helpers.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

let cachedBin = null;
let cachedNodeSqlite = undefined;

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

/** Load built-in `node:sqlite` if the runtime exposes `DatabaseSync`, else `null`. */
export function loadNodeSqlite() {
  if (cachedNodeSqlite !== undefined) return cachedNodeSqlite;
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
        cachedNodeSqlite = mod;
        return cachedNodeSqlite;
      }
    } catch { /* try next loader */ }
  }
  cachedNodeSqlite = null;
  return cachedNodeSqlite;
}

export function resetNodeSqliteCache() {
  cachedNodeSqlite = undefined;
}

export function hasNonEmptyWal(dbPath) {
  const candidates = [dbPath];
  try {
    const real = fs.realpathSync(dbPath);
    if (real && real !== dbPath) candidates.push(real);
  } catch { /* keep original path */ }
  for (const base of candidates) {
    try {
      if (fs.statSync(`${base}-wal`).size > 0) return true;
    } catch { /* no wal sidecar */ }
  }
  return false;
}

export function toSqliteUriPath(dbPath) {
  let real = dbPath;
  try { real = fs.realpathSync(dbPath); } catch { real = path.resolve(dbPath); }
  const normalized = real.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = prefixed
    .replace(/%/g, "%25")
    .replace(/\?/g, "%3F")
    .replace(/#/g, "%23")
    .replace(/ /g, "%20");
  return `file://${encoded}?immutable=1`;
}

export function resolveSqliteBinary({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (cachedBin && fs.existsSync(cachedBin)) return cachedBin;
  const names = platform === "win32" ? ["sqlite3.exe", "sqlite3.cmd", "sqlite3"] : ["sqlite3"];
  const dirs = [];
  if (platform !== "win32") dirs.push("/usr/bin", "/opt/homebrew/bin", "/usr/local/bin");
  for (const entry of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    dirs.push(entry);
  }
  if (platform === "win32") {
    dirs.push(
      path.join(env.ProgramData || "C:\\ProgramData", "chocolatey", "bin"),
      path.join(homeDir, "scoop", "shims"),
      path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "Programs", "sqlite3"),
      path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "Microsoft", "WinGet", "Links"),
    );
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          cachedBin = candidate;
          return candidate;
        }
      } catch { /* next candidate */ }
    }
  }
  return platform === "win32" ? "sqlite3.exe" : "sqlite3";
}

export function resetSqliteBinaryCache() {
  cachedBin = null;
}

function openNodeSqliteReadOnly(DatabaseSync, dbPath, busyTimeout) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true, timeout: busyTimeout });
  } catch {
    if (!hasNonEmptyWal(dbPath)) {
      return new DatabaseSync(toSqliteUriPath(dbPath), { readOnly: true, timeout: busyTimeout });
    }
    const db = new DatabaseSync(dbPath, { timeout: busyTimeout });
    try {
      db.exec("PRAGMA query_only = ON;");
      return db;
    } catch (err) {
      try { db.close(); } catch { /* ignore */ }
      throw err;
    }
  }
}

function execSqliteCliArgs(bin, args, { timeout, maxBuffer }) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer }, (err, out) => {
      if (err) return reject(err);
      try {
        const parsed = JSON.parse(String(out || "").trim() || "[]");
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function queryViaSqliteCli(dbPath, sql, { timeout, maxBuffer, sqliteBin, transaction }) {
  const bin = sqliteBin || resolveSqliteBinary();
  const stmt = transaction ? `BEGIN; ${sql}; COMMIT;` : sql;
  const walActive = hasNonEmptyWal(dbPath);
  if (!walActive) {
    try {
      return await execSqliteCliArgs(bin, ["-readonly", "-json", "-cmd", ".timeout 2000", toSqliteUriPath(dbPath), stmt], { timeout, maxBuffer });
    } catch { /* fall through to standard read-only open */ }
  }
  try {
    return await execSqliteCliArgs(bin, ["-readonly", "-json", "-cmd", ".timeout 2000", dbPath, stmt], { timeout, maxBuffer });
  } catch (err) {
    if (!walActive) throw err;
    return execSqliteCliArgs(bin, ["-json", "-cmd", ".timeout 2000", "-cmd", "PRAGMA query_only = ON;", dbPath, stmt], { timeout, maxBuffer });
  }
}

/**
 * Run a strict read-only SELECT query, rethrowing SQL errors (`[]` when DB file is missing).
 * Uses built-in `node:sqlite` first so Windows works without `sqlite3.exe`, with CLI fallback.
 */
export async function querySqliteRowsStrict(dbPath, sql, { timeout = 10000, maxBuffer = 64 * 1024 * 1024, useNodeSqlite = true, sqliteBin, transaction = false } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const sqlite = useNodeSqlite ? loadNodeSqlite() : null;
  if (sqlite) {
    const db = openNodeSqliteReadOnly(sqlite.DatabaseSync, dbPath, Math.min(timeout, 2000));
    try {
      return db.prepare(sql).all().map((row) => ({ ...row }));
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }
  }
  return queryViaSqliteCli(dbPath, sql, { timeout, maxBuffer, sqliteBin, transaction });
}

/**
 * Run a read-only SELECT query and return plain row objects (`[]` on missing DB or error).
 * Prefers built-in `node:sqlite` (works on Windows without `sqlite3.exe`) and falls back to the `sqlite3` CLI.
 */
export async function querySqliteRows(dbPath, sql, { timeout = 5000, maxBuffer = 4 * 1024 * 1024, useNodeSqlite = true, sqliteBin } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  if (useNodeSqlite) {
    try {
      return await querySqliteRowsStrict(dbPath, sql, { timeout, maxBuffer, useNodeSqlite: true, sqliteBin });
    } catch { /* fall through to sqlite3 CLI */ }
  }
  try {
    return await queryViaSqliteCli(dbPath, sql, { timeout, maxBuffer, sqliteBin, transaction: false });
  } catch {
    return [];
  }
}

/**
 * Synchronous read-only SELECT helper for callers like TeleAgent dispatch verification.
 */
export function querySqliteRowsSync(dbPath, sql, { timeout = 5000, useNodeSqlite = true, sqliteBin, throwOnError = false } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const sqlite = useNodeSqlite ? loadNodeSqlite() : null;
  if (sqlite) {
    const db = openNodeSqliteReadOnly(sqlite.DatabaseSync, dbPath, Math.min(timeout, 2000));
    try {
      return db.prepare(sql).all().map((row) => ({ ...row }));
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }
  }
  try {
    const out = execFileSync(
      sqliteBin || resolveSqliteBinary(),
      ["-json", "-cmd", ".timeout 2000", dbPath, `PRAGMA query_only = ON; ${sql}`],
      { encoding: "utf8", timeout },
    );
    const parsed = JSON.parse(String(out || "").trim() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (throwOnError) throw err;
    return [];
  }
}
