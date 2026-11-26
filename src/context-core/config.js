// Dual-host Vault config, path normalization, and script discovery.
// Zero Obsidian / Electron / i18n dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeExcludedDirs } from "../memory-query-core.js";
import { MEMORY_DIR_DEFAULT } from "../memory-store.js";
import { normalizeRelPath } from "./note-hygiene.js";

export { normalizeRelPath };
export const CONFIG_DIRS = [".outline-journal", ".obsidian"];
export const PLUGIN_REL_PARTS = ["plugins", "agent-deck"];

export function stripWinPrefix(p) {
  return String(p || "").replace(/^(?:\\\\\?\\UNC\\|\/\/\?\/UNC\/)/i, "\\\\").replace(/^(?:\\\\\?\\|\/\/\?\/)/, "");
}

export function realPathSafe(p) {
  const clean = stripWinPrefix(p);
  try {
    return stripWinPrefix((fs.realpathSync.native || fs.realpathSync)(clean));
  } catch {
    return path.resolve(clean);
  }
}

export function resolveNearestRealPath(p) {
  const clean = stripWinPrefix(path.resolve(p));
  if (fs.existsSync(clean)) return realPathSafe(clean);
  const pending = [];
  let cur = clean;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) return clean;
    pending.unshift(path.basename(cur));
    if (fs.existsSync(up)) return path.join(realPathSafe(up), ...pending);
    cur = up;
  }
}

export function isPathContainedIn(rootReal, targetReal, { caseInsensitive = process.platform === "win32" } = {}) {
  const norm = (s) => (caseInsensitive || process.platform === "win32" ? String(s).toLowerCase() : String(s));
  const r = norm(rootReal).replace(/[\\/]+$/, "");
  const t = norm(targetReal).replace(/[\\/]+$/, "");
  return t === r || t.startsWith(r + path.sep) || t.startsWith(`${r}/`);
}

const FS_CASE_CACHE = new Map();

export function isCaseInsensitiveFs(dirPath) {
  const clean = stripWinPrefix(dirPath || "");
  if (!clean || !fs.existsSync(clean)) return process.platform === "win32" || process.platform === "darwin";
  const key = realPathSafe(clean);
  if (FS_CASE_CACHE.has(key)) return FS_CASE_CACHE.get(key);
  let insensitive = process.platform === "win32" || process.platform === "darwin";
  try {
    let probePath = key;
    const base = path.basename(key);
    let swappedBase = /[a-z]/.test(base) ? base.replace(/[a-z]/, (c) => c.toUpperCase())
      : /[A-Z]/.test(base) ? base.replace(/[A-Z]/, (c) => c.toLowerCase()) : "";
    let probeCandidate = swappedBase ? path.join(path.dirname(key), swappedBase) : "";
    if (!swappedBase) {
      const firstAscii = fs.readdirSync(key).find((n) => /[A-Za-z]/.test(n));
      if (firstAscii) {
        probePath = path.join(key, firstAscii);
        swappedBase = /[a-z]/.test(firstAscii)
          ? firstAscii.replace(/[a-z]/, (c) => c.toUpperCase())
          : firstAscii.replace(/[A-Z]/, (c) => c.toLowerCase());
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
  } catch { /* fallback to platform default */ }
  FS_CASE_CACHE.set(key, insensitive);
  return insensitive;
}

export function readVaultFileStrict(vaultRoot, relPath, { realVault = "" } = {}) {
  const rootReal = realVault || realPathSafe(vaultRoot);
  const parts = String(relPath || "").split("/").filter(Boolean);
  let cur = rootReal;
  for (const seg of parts) {
    if (seg === "." || seg === "..") throw new Error(`非法路径段：${relPath}`);
    cur = path.join(cur, seg);
    const lst = fs.lstatSync(cur);
    if (lst.isSymbolicLink()) throw new Error(`拒绝读取符号链接路径：${relPath}`);
  }
  const actualReal = realPathSafe(cur);
  if (!isPathContainedIn(rootReal, actualReal, { caseInsensitive: isCaseInsensitiveFs(rootReal) })) {
    throw new Error(`目标路径越界（超出 Vault 根目录）：${relPath}`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(cur, flags);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`目标不是常规文件：${relPath}`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function hasHostConfigDir(dir) {
  return CONFIG_DIRS.some((cfg) => fs.existsSync(path.join(dir, cfg)));
}

// Walk upward from start (or invoked script location) to locate a Vault root containing `.obsidian` or `.outline-journal`.
export function resolveVault(start) {
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
    } catch { /* bundled or non-file URL */ }
  }
  const seen = new Set();
  for (const root of candidates) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    let cur = root;
    for (;;) {
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

// Supports `.outline-journal`, `.obsidian`, and plain Markdown folders (returns `{}`).
export function readPluginConfig(vault, { configDir = "" } = {}) {
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
    } catch { /* missing */ }
  }
  if (!found.length) return {};
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of found) {
    const cfg = parsePluginConfigFile(item.target);
    if (cfg) return cfg;
  }
  return {};
}

export function memoryDirOf(vault, opts = {}) {
  const dir = normalizeRelPath(readPluginConfig(vault, opts)?.dream?.dir || "");
  const candidate = path.join(vault, ...(dir ? dir.split("/") : MEMORY_DIR_DEFAULT.split("/")));
  const realVault = realPathSafe(vault);
  const realCand = resolveNearestRealPath(candidate);
  if (!isPathContainedIn(realVault, realCand, { caseInsensitive: isCaseInsensitiveFs(realVault) })) {
    throw new Error(`记忆目录越界（指向 Vault 外）：${candidate}`);
  }
  return candidate;
}

export function excludedDirsOf(vault, opts = {}) {
  return normalizeExcludedDirs(readPluginConfig(vault, opts)?.delegate?.excludedDirs || []);
}

export function mcpSettingsOf(vault, opts = {}) {
  const raw = readPluginConfig(vault, opts)?.dream?.mcp || {};
  return {
    toolsMode: raw.toolsMode === "memory-only" ? "memory-only" : "all",
    allowWrite: Boolean(raw.allowWrite),
    excludeAiLogs: raw.excludeAiLogs !== false,
    agentPrompt: typeof raw.agentPrompt === "string" ? raw.agentPrompt : "",
  };
}

function hasAnyRuntimeScript(dir) {
  if (!dir) return false;
  return fs.existsSync(path.join(dir, "memory-query.mjs")) || fs.existsSync(path.join(dir, "memory-mcp.mjs"));
}

export function resolvePluginScriptsDir(vault, { configDir = "", fallbackDir = "" } = {}) {
  const cleanVault = String(vault || "").trim();
  const cleanCfg = normalizeRelPath(configDir);
  const candidates = [];
  if (cleanVault && cleanCfg) candidates.push(path.join(cleanVault, cleanCfg, ...PLUGIN_REL_PARTS, "scripts"));
  if (cleanVault) {
    for (const dirName of [".obsidian", ".outline-journal"]) {
      const cand = path.join(cleanVault, dirName, ...PLUGIN_REL_PARTS, "scripts");
      if (!candidates.includes(cand)) candidates.push(cand);
    }
  }
  if (fallbackDir && !candidates.includes(fallbackDir)) candidates.push(fallbackDir);

  for (const dir of candidates) {
    if (hasAnyRuntimeScript(dir)) return dir;
  }
  if (cleanVault) {
    return path.join(cleanVault, cleanCfg || ".obsidian", ...PLUGIN_REL_PARTS, "scripts");
  }
  return fallbackDir || "";
}

/** Determine whether `import.meta.url` is the executed CLI entrypoint (resolving symlinks & Windows paths). */
export function isMainModule(metaUrl) {
  try {
    if (!process.argv[1]) return false;
    const real = (p) => {
      let s;
      try { s = (fs.realpathSync.native || fs.realpathSync)(p); } catch { s = path.resolve(p); }
      s = stripWinPrefix(s).replace(/\\/g, "/");
      return process.platform === "win32" ? s.toLowerCase() : s;
    };
    return real(process.argv[1]) === real(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
