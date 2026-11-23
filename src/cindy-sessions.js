import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CINDY_APP_DIRS = ["Cindy", "CindyGlobal", "xdt-maker"];
const CINDY_DB_FILE_RE = /^(?:cindy|xdt-maker)-.+\.db$/i;
const CINDY_CITATION_RE = /\uE200cite(?:\uE202[^\uE201]*)?(?:\uE201|$)/g;
const CINDY_STOP_TOKENS_ONLY_RE = /^(?:\s*(?:<\|endoftext\|>|<\|eot_id\|>|<\|im_end\|>|<\|eos\|>))+\s*$/;

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
 * Locate Electron userData directories used by Cindy (CN, Global, and legacy xdt-maker).
 * When CINDY_DATA_DIR or XDT_USER_DATA_DIR is set, returns only those explicit directories
 * so test suites remain isolated from host state.
 */
export function cindyDataDirs(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? os.homedir();

  const explicit = [env?.CINDY_DATA_DIR, env?.XDT_USER_DATA_DIR].filter((v) => String(v || "").trim());
  if (explicit.length > 0) return uniqResolved(explicit);

  let baseDir = "";
  if (platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support");
  } else if (platform === "win32") {
    baseDir = String(env?.APPDATA || "").trim() || path.join(home, "AppData", "Roaming");
  } else {
    baseDir = String(env?.XDG_CONFIG_HOME || "").trim() || path.join(home, ".config");
  }

  return uniqResolved(DEFAULT_CINDY_APP_DIRS.map((name) => path.join(baseDir, name)));
}

/**
 * Discover Cindy SQLite database files across configured Electron userData directories.
 */
export function cindyDatabases(opts = {}) {
  const out = [];
  const seen = new Set();
  for (const dir of cindyDataDirs(opts)) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const matched = entries
      .filter((ent) => ent?.isFile?.() && CINDY_DB_FILE_RE.test(ent.name))
      .map((ent) => ent.name)
      .sort();
    for (const name of matched) {
      const fullPath = path.join(dir, name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      out.push(fullPath);
    }
  }
  return out;
}

/**
 * Clean Cindy message prose by removing internal web citation markers and standalone
 * end-of-sequence stop tokens without altering ordinary prose that mentions them.
 */
export function cleanCindyText(raw) {
  let text = String(raw ?? "");
  if (!text) return "";
  text = text.replace(CINDY_CITATION_RE, "");
  if (CINDY_STOP_TOKENS_ONLY_RE.test(text)) return "";
  return text.trim();
}
