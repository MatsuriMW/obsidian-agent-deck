// Cross-platform helpers for paths, CLI discovery, command spawning, and OS tools.
// Pure leaf module (Node built-ins only) so any module can import it without cycles.

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

export function expandHome(raw, homeDir = os.homedir()) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/^~(?=[\\/]|$)/, homeDir);
}

export function userDataDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") return env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
}

export function localDataDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") return env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support");
  return env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
}

export function pathDelimiter(platform = process.platform) {
  return platform === "win32" ? ";" : ":";
}

export function extraBinDirs(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return [
      path.join(appData, "npm"),
      path.join(homeDir, ".local", "bin"),
      path.join(localAppData, "Microsoft", "WinGet", "Links"),
      path.join(localAppData, "Microsoft", "WindowsApps"),
      path.join(homeDir, "scoop", "shims"),
    ];
  }
  return [
    path.join(homeDir, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

export function mergePathEnv(env = process.env, { extra = {}, homeDir = os.homedir(), platform = process.platform } = {}) {
  const merged = { ...env, ...extra };
  const sep = pathDelimiter(platform);
  const parts = String(merged.PATH || merged.Path || "").split(sep).filter(Boolean);
  const combined = [...new Set([...parts, ...extraBinDirs(homeDir, platform, merged)])].join(sep);
  merged.PATH = combined;
  if (platform === "win32" && "Path" in merged) delete merged.Path;
  return merged;
}

export function resolveExecutable(name, configured = "", {
  candidates = [],
  homeDir = os.homedir(),
  env = process.env,
  platform = process.platform,
  fsMod = fs,
} = {}) {
  const custom = expandHome(configured, homeDir);
  if (custom) return custom;
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const existsFile = (p) => {
    try {
      const st = fsMod.statSync(p);
      return st.isFile() || st.isSymbolicLink();
    } catch {
      try {
        // Windows Store App Execution Aliases (e.g. LocalAppData\Microsoft\WindowsApps\wt.exe)
        // are NTFS reparse points where statSync may fail; lstatSync succeeds on the alias entry.
        const lst = fsMod.lstatSync(p);
        return lst.isFile() || lst.isSymbolicLink();
      } catch {
        return false;
      }
    }
  };
  for (const rawCandidate of candidates) {
    const c = expandHome(rawCandidate, homeDir);
    if (!c) continue;
    if (existsFile(c)) return c;
    if (platform === "win32" && !path.extname(c)) {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        if (existsFile(c + ext)) return c + ext;
      }
    }
  }
  const sep = pathDelimiter(platform);
  const pathDirs = String(env?.PATH || env?.Path || "").split(sep).filter(Boolean);
  const dirs = [...new Set([...extraBinDirs(homeDir, platform, env), ...pathDirs])];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, `${name}${ext}`);
      if (existsFile(p)) return p;
    }
  }
  return name;
}

export function nodeBinary({ homeDir = os.homedir(), env = process.env, platform = process.platform, fsMod = fs } = {}) {
  const baseExec = path.basename(process.execPath || "").toLowerCase();
  if ((platform === "win32" && baseExec === "node.exe") || (platform !== "win32" && baseExec === "node")) {
    return process.execPath;
  }
  const candidates = [];
  if (platform === "win32") {
    const pf = env?.ProgramFiles || "C:\\Program Files";
    const pf86 = env?.["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    candidates.push(
      path.join(pf, "nodejs", "node.exe"),
      path.join(pf86, "nodejs", "node.exe"),
      path.join(localDataDir(homeDir, "win32", env), "Programs", "nodejs", "node.exe"),
    );
    if (env?.NVM_SYMLINK) candidates.push(path.join(env.NVM_SYMLINK, "node.exe"));
    const nvmHome = env?.NVM_HOME || path.join(userDataDir(homeDir, "win32", env), "nvm");
    try {
      if (fsMod.existsSync(nvmHome)) {
        for (const v of fsMod.readdirSync(nvmHome).sort().reverse()) {
          candidates.push(path.join(nvmHome, v, "node.exe"));
        }
      }
    } catch { /* no nvm */ }
  } else {
    candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");
    try {
      const nvmDir = path.join(homeDir, ".nvm", "versions", "node");
      if (fsMod.existsSync(nvmDir)) {
        for (const v of fsMod.readdirSync(nvmDir).sort().reverse()) {
          candidates.push(path.join(nvmDir, v, "bin", "node"));
        }
      }
    } catch { /* no nvm */ }
  }
  return resolveExecutable("node", "", { candidates, homeDir, env, platform, fsMod });
}

function resolveCmdShimNodeScript(cmdPath, { homeDir, env, fsMod }) {
  try {
    const content = fsMod.readFileSync(cmdPath, "utf8");
    const m = /["']?(%(?:dp0|~dp0|basedir)%[\\/]|%~dp0)([^"'\r\n]+\.(?:js|mjs|cjs))["']?/i.exec(content);
    if (!m) return null;
    const rel = m[2].replace(/[\\/]+/g, path.sep);
    const script = path.resolve(path.dirname(cmdPath), rel);
    if (!fsMod.existsSync(script)) return null;
    const siblingNode = path.join(path.dirname(cmdPath), "node.exe");
    const nodeBin = fsMod.existsSync(siblingNode)
      ? siblingNode
      : nodeBinary({ homeDir, env, platform: "win32", fsMod });
    if (!nodeBin || nodeBin === "node" || !fsMod.existsSync(nodeBin)) return null;
    return { nodeBin, script };
  } catch {
    return null;
  }
}

function cmdQuoteArg(arg) {
  let s = String(arg ?? "").replace(/\r?\n/g, " ");
  s = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  s = `"${s}"`;
  return s.replace(/([()!^"%<>&|])/g, "^$1");
}

// Wrap .cmd/.bat shims or bare command names on Windows so Node 20+ spawn/execFile
// succeeds without EINVAL, unwraps npm .cmd node shims directly to node.exe when possible,
// and quotes complex cmd.exe fallback arguments safely.
export function wrapSpawnCommand(bin, args = [], { platform = process.platform, env = process.env, homeDir = os.homedir(), fsMod = fs } = {}) {
  const target = String(bin || "").trim();
  const list = Array.isArray(args) ? args : [];
  if (platform !== "win32" || !target) return { command: target, args: list };

  let effective = target;
  if (!/[\\/]/.test(effective) && !path.extname(effective)) {
    const resolved = resolveExecutable(effective, "", { homeDir, env, platform, fsMod });
    if (resolved && resolved !== effective) effective = resolved;
  }

  const lower = effective.toLowerCase();
  if (lower.endsWith(".exe")) return { command: effective, args: list };

  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const unwrapped = resolveCmdShimNodeScript(effective, { homeDir, env, fsMod });
    if (unwrapped) {
      return { command: unwrapped.nodeBin, args: [unwrapped.script, ...list] };
    }
  }

  if (lower.endsWith(".cmd") || lower.endsWith(".bat") || !/[\\/]/.test(effective)) {
    const comspec = env?.ComSpec || env?.COMSPEC || "cmd.exe";
    const unsafe = /[\s"&|<>()^%!;,\r\n]/;
    if (!unsafe.test(effective) && list.every((a) => !unsafe.test(String(a ?? "")))) {
      return {
        command: comspec,
        args: ["/d", "/c", effective, ...list],
      };
    }
    const quotedCmd = /[\s"&|<>()^%!;,]/.test(effective) ? `"${effective.replace(/"/g, "")}"` : effective;
    const commandLine = [quotedCmd, ...list.map(cmdQuoteArg)].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: effective, args: list };
}

export function spawnOptions(launch, extra = {}) {
  return {
    ...extra,
    windowsHide: true,
    ...(launch?.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  };
}

export function sqlite3Binary({ homeDir = os.homedir(), env = process.env, platform = process.platform, fsMod = fs } = {}) {
  const candidates = platform === "win32"
    ? [path.join(env?.ProgramData || "C:\\ProgramData", "chocolatey", "bin", "sqlite3.exe")]
    : ["/usr/bin/sqlite3"];
  const found = resolveExecutable("sqlite3", "", { candidates, homeDir, env, platform, fsMod });
  try {
    if (found && (found.includes("\\") || found.includes("/")) && fsMod.existsSync(found)) return found;
  } catch { /* fall through */ }
  return platform === "win32" ? "" : "/usr/bin/sqlite3";
}

export function posixShellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\"'\"'") + "'";
}

export function pwshQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

export function shellQuote(s, platform = process.platform) {
  return platform === "win32" ? pwshQuote(s) : posixShellQuote(s);
}

export function openUrlCrossPlatform(url, { platform = process.platform, exec = execFile } = {}) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") {
      Promise.resolve(shell.openExternal(target)).catch(() => {});
      return true;
    }
  } catch { /* not electron */ }
  try {
    if (platform === "win32") {
      exec(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", target], { windowsHide: true }, () => {});
      return true;
    }
    if (platform === "darwin") {
      exec("/usr/bin/open", [target], () => {});
      return true;
    }
    exec("xdg-open", [target], () => {});
    return true;
  } catch {
    return false;
  }
}

export function windowsShellBinary(which = "auto", { env = process.env, homeDir = os.homedir(), fsMod = fs } = {}) {
  const winRoot = env?.SystemRoot || env?.WINDIR || "C:\\Windows";
  const wt = resolveExecutable("wt", "", { homeDir, env, platform: "win32", fsMod });
  const pwsh = resolveExecutable("pwsh", "", { homeDir, env, platform: "win32", fsMod });
  const powershell = resolveExecutable("powershell", "", {
    candidates: [path.join(winRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")],
    homeDir, env, platform: "win32", fsMod,
  });
  const hasPwsh = pwsh && pwsh !== "pwsh" && fsMod.existsSync(pwsh);
  const hasPowershell = powershell && powershell !== "powershell" && fsMod.existsSync(powershell);
  const shellBin = hasPwsh ? pwsh : (hasPowershell ? powershell : "powershell.exe");
  const hasWt = wt && wt !== "wt" && fsMod.existsSync(wt);
  return { which: which === "powershell" || !hasWt ? "powershell" : "wt", wt: hasWt ? wt : "", shellBin };
}
