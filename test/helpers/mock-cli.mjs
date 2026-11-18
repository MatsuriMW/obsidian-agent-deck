import fs from "node:fs";
import path from "node:path";
import { killChildProcess } from "../../src/security.js";

export function mockNodeScriptPath(bin) {
  return process.platform === "win32" ? String(bin).replace(/\.(?:cmd|bat)$/i, ".js") : bin;
}

export function writeMockNodeBin(dir, name, jsBody) {
  const cleanBody = String(jsBody || "").replace(/^#!\/usr\/bin\/env node\r?\n/, "");
  if (process.platform === "win32") {
    const jsPath = path.join(dir, `${name}.js`);
    const cmdPath = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(jsPath, cleanBody);
    fs.writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${jsPath}" %*\r\n`);
    return cmdPath;
  }
  const binPath = path.join(dir, name);
  fs.writeFileSync(binPath, `#!/usr/bin/env node\n${cleanBody}`);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

export function rmDirSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  } catch {
    // On Windows, a just-killed child handle may release asynchronously after test exit.
  }
}

export function cleanupDelegatorDir(d, dir) {
  for (const r of d?.runners?.values() || []) {
    r.cancel?.();
    killChildProcess(r.child);
    for (const p of r.pending?.values() || []) clearTimeout(p.timer);
  }
  clearTimeout(d?._saveT);
  rmDirSafe(dir);
}
