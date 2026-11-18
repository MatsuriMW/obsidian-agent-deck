// Cross-platform sqlite3 CLI discovery (shared by readers, desktop-sessions, cursor-sessions, and tests).

import fs from "fs";
import os from "os";
import path from "path";

let cachedBin = null;

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
