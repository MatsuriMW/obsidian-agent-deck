// Shared PATH expansion, binary lookup, and system proxy environment helpers.
// Leaf module (Node built-ins only) to avoid circular dependencies across runners/llm.

import fs from "fs";
import os from "os";
import path from "path";
import { execFile, execFileSync } from "child_process";

const home = () => os.homedir();

function scanGlobBins(baseDir, sub = "bin", reverse = false) {
  try {
    const ents = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    if (reverse) ents.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return ents.map((name) => (sub ? path.join(baseDir, name, sub) : path.join(baseDir, name)));
  } catch { return []; }
}

export function expandedPathEntries(basePath = process.env.PATH || "", homeDir = home()) {
  const sep = process.platform === "win32" ? ";" : ":";
  const parts = new Set(String(basePath || "").split(sep).filter(Boolean));
  const staticDirs = process.platform === "win32"
    ? [
        path.join(homeDir, ".local", "bin"),
        path.join(homeDir, ".bun", "bin"),
        path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "npm"),
        path.join(process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "pnpm"),
        path.join(homeDir, "scoop", "shims"),
      ]
    : [
        path.join(homeDir, ".local/bin"),
        ...scanGlobBins(path.join(homeDir, ".nvm/versions/node"), "bin", true),
        path.join(homeDir, ".volta/bin"),
        path.join(homeDir, ".fnm/aliases/default/bin"),
        path.join(homeDir, ".fnm/current/bin"),
        path.join(homeDir, ".npm-global/bin"),
        path.join(homeDir, "Library/pnpm"),
        path.join(homeDir, ".local/share/pnpm"),
        path.join(homeDir, ".bun/bin"),
        path.join(homeDir, ".cargo/bin"),
        ...scanGlobBins(path.join(homeDir, ".local/share/uv/tools"), "bin"),
        path.join(homeDir, ".pyenv/shims"),
        path.join(homeDir, ".pyenv/bin"),
        path.join(homeDir, "miniconda3/bin"),
        path.join(homeDir, "anaconda3/bin"),
        path.join(homeDir, "miniforge3/bin"),
        path.join(homeDir, "mambaforge/bin"),
        "/opt/homebrew/Caskroom/miniconda/base/bin",
        ...scanGlobBins("/opt/homebrew/opt", "bin"),
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ];
  for (const dir of staticDirs) parts.add(dir);
  return [...parts];
}

export function findInPathDirs(name, dirs) {
  if (!name || String(name).includes("/") || String(name).includes("\\")) return "";
  const pathext = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const exts = process.platform === "win32"
    ? (path.extname(name) ? ["", ...pathext] : [...pathext, ""])
    : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch { /* next */ }
    }
  }
  return "";
}

let cachedLoginShellPath = null;
export function resetLoginShellPathCache() { cachedLoginShellPath = null; }

export function resolveLoginShellPath() {
  if (cachedLoginShellPath !== null) return Promise.resolve(cachedLoginShellPath);
  if (process.platform === "win32") return Promise.resolve(cachedLoginShellPath = "");
  const shell = process.env.SHELL || "/bin/zsh";
  const marker = "__AD_PATH__";
  return new Promise((resolve) => {
    execFile(shell, ["-lc", `printf "${marker}%s${marker}" "$PATH"`], { encoding: "utf8", timeout: 3000 }, (err, out) => {
      const m = !err && /__AD_PATH__([\s\S]*?)__AD_PATH__/.exec(out || "");
      cachedLoginShellPath = m ? m[1].trim() : "";
      resolve(cachedLoginShellPath);
    });
  });
}

let cachedSystemProxy = null;
let cachedSystemProxyAt = 0;

export function resetSystemProxyCache() {
  cachedSystemProxy = null;
  cachedSystemProxyAt = 0;
}

export function parseScutilProxy(text) {
  const out = {};
  if (!text || typeof text !== "string") return out;
  const scalar = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m").exec(text);
    return m ? m[1].trim() : "";
  };
  if (scalar("HTTPEnable") === "1" && scalar("HTTPProxy") && scalar("HTTPPort")) {
    out.HTTP_PROXY = out.http_proxy = `http://${scalar("HTTPProxy")}:${scalar("HTTPPort")}`;
  }
  if (scalar("HTTPSEnable") === "1" && scalar("HTTPSProxy") && scalar("HTTPSPort")) {
    out.HTTPS_PROXY = out.https_proxy = `http://${scalar("HTTPSProxy")}:${scalar("HTTPSPort")}`;
  }
  if (scalar("SOCKSEnable") === "1" && scalar("SOCKSProxy") && scalar("SOCKSPort")) {
    out.ALL_PROXY = out.all_proxy = `socks5://${scalar("SOCKSProxy")}:${scalar("SOCKSPort")}`;
  }
  if (!Object.keys(out).length) return out;
  const noProxy = new Set();
  const exc = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/m.exec(text);
  if (exc) {
    for (const line of exc[1].split(/\r?\n/)) {
      const m = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(line);
      const item = m ? m[1].trim() : "";
      if (item && item !== "<local>") noProxy.add(item);
    }
  }
  for (const base of ["127.0.0.1", "localhost", "::1"]) noProxy.add(base);
  out.NO_PROXY = out.no_proxy = [...noProxy].join(",");
  return out;
}

function readMacSystemProxyEnv() {
  if (process.platform !== "darwin") return {};
  const now = Date.now();
  if (cachedSystemProxy !== null && now - cachedSystemProxyAt < 60000) return cachedSystemProxy;
  try {
    const raw = execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 500, stdio: ["ignore", "pipe", "ignore"] });
    cachedSystemProxy = parseScutilProxy(raw);
  } catch {
    cachedSystemProxy = {};
  }
  cachedSystemProxyAt = now;
  return cachedSystemProxy;
}

function normalizeProxyUrl(addr, defaultScheme = "http") {
  const clean = String(addr || "").trim();
  if (!clean) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) return clean;
  return `${defaultScheme}://${clean}`;
}

export function parseWindowsRegProxy(text) {
  const out = {};
  if (!text || typeof text !== "string") return out;
  const enableMatch = /^\s*ProxyEnable\s+REG_\w+\s+0x([0-9a-f]+)|\bProxyEnable\s+REG_\w+\s+(\d+)/im.exec(text);
  const enabledHex = enableMatch?.[1];
  const enabledDec = enableMatch?.[2];
  const enabled = enabledHex ? parseInt(enabledHex, 16) === 1 : enabledDec ? Number(enabledDec) === 1 : false;
  if (!enabled) return out;
  const serverMatch = /^\s*ProxyServer\s+REG_\w+\s+(.+?)\s*$/im.exec(text);
  const rawServer = serverMatch ? serverMatch[1].trim() : "";
  if (!rawServer) return out;
  if (rawServer.includes("=")) {
    for (const part of rawServer.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const proto = part.slice(0, eq).trim().toLowerCase();
      const addr = part.slice(eq + 1).trim();
      if (!addr) continue;
      if (proto === "http") out.HTTP_PROXY = out.http_proxy = normalizeProxyUrl(addr, "http");
      else if (proto === "https") out.HTTPS_PROXY = out.https_proxy = normalizeProxyUrl(addr, "http");
      else if (proto === "socks") out.ALL_PROXY = out.all_proxy = normalizeProxyUrl(addr, "socks5");
    }
  } else {
    const url = normalizeProxyUrl(rawServer, "http");
    out.HTTP_PROXY = out.http_proxy = url;
    out.HTTPS_PROXY = out.https_proxy = url;
  }
  if (!Object.keys(out).length) return out;
  const noProxy = new Set();
  const overrideMatch = /^\s*ProxyOverride\s+REG_\w+\s+(.+?)\s*$/im.exec(text);
  if (overrideMatch) {
    for (const item of overrideMatch[1].split(";").map((s) => s.trim()).filter(Boolean)) {
      if (item.toLowerCase() !== "<local>") noProxy.add(item);
    }
  }
  for (const base of ["127.0.0.1", "localhost", "::1"]) noProxy.add(base);
  out.NO_PROXY = out.no_proxy = [...noProxy].join(",");
  return out;
}

function readWindowsSystemProxyEnv() {
  if (process.platform !== "win32") return {};
  const now = Date.now();
  if (cachedSystemProxy !== null && now - cachedSystemProxyAt < 60000) return cachedSystemProxy;
  try {
    const raw = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      { encoding: "utf8", timeout: 500, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    cachedSystemProxy = parseWindowsRegProxy(raw);
  } catch {
    cachedSystemProxy = {};
  }
  cachedSystemProxyAt = now;
  return cachedSystemProxy;
}

export function cleanEnv(extra = {}) {
  const proxyKeys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
  const hasExplicitProxy = proxyKeys.some((k) => Boolean(process.env[k]) || (extra != null && Object.prototype.hasOwnProperty.call(extra, k)));
  const sysProxy = hasExplicitProxy ? {} : (process.platform === "win32" ? readWindowsSystemProxyEnv() : readMacSystemProxyEnv());
  const env = { ...sysProxy, ...process.env, ...extra };
  const sep = process.platform === "win32" ? ";" : ":";
  const base = cachedLoginShellPath ? `${env.PATH || ""}${sep}${cachedLoginShellPath}` : (env.PATH || "");
  env.PATH = expandedPathEntries(base).join(sep);
  return env;
}
