import fs from "node:fs";
import path from "node:path";

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
