import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function uniqResolved(dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs) {
    const trimmed = String(dir || "").trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Locate Electron userData directories used by Orca (`com.stablyai.orca`).
 * When ORCA_DATA_DIR or ORCA_USER_DATA_DIR is set, returns only those explicit directories
 * so test suites remain isolated from host state.
 */
export function orcaDataDirs(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? os.homedir();

  const explicit = [env?.ORCA_DATA_DIR, env?.ORCA_USER_DATA_DIR].filter((v) => String(v || "").trim());
  if (explicit.length > 0) return uniqResolved(explicit);

  let baseDir = "";
  if (platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support");
  } else if (platform === "win32") {
    baseDir = String(env?.APPDATA || "").trim() || path.join(home, "AppData", "Roaming");
  } else {
    baseDir = String(env?.XDG_CONFIG_HOME || "").trim() || path.join(home, ".config");
  }

  return uniqResolved([path.join(baseDir, "orca")]);
}

/**
 * Discover Orca SQLite domain databases (`agent-session-domain.db`) across configured userData directories.
 */
export function orcaDatabases(opts = {}) {
  const out = [];
  const seen = new Set();
  for (const dir of orcaDataDirs(opts)) {
    const dbPath = path.join(dir, "agent-session-domain.db");
    try {
      const st = fs.statSync(dbPath);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    if (seen.has(dbPath)) continue;
    seen.add(dbPath);
    out.push(dbPath);
  }
  return out;
}

/**
 * Extract readable text from an Orca structured journal message `payload_json` object.
 */
export function extractOrcaMessageText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const body = payload.body && typeof payload.body === "object" ? payload.body : payload;
  if (typeof body.text === "string" && body.text.trim()) return body.text.trim();
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join("\n").trim();
}
