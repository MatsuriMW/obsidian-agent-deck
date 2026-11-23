#!/usr/bin/env node
// 构建可选的 treeland 窗口激活 helper（Linux 专用；产物不入库）。
// 纯净上游用户没有 treeland / 没有编译器时跳过，不影响插件主功能。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "bin");
const out = path.join(outDir, "treeland-activate");
const source = path.join(root, "src", "native", "treeland-activate.c");
const proto = path.join(root, "src", "native", "treeland-foreign-toplevel-manager-v1-protocol.c");
const include = path.join(root, "src", "native");

const pkg = spawnSync("pkg-config", ["--cflags", "--libs", "wayland-client"], { encoding: "utf8" });
if (pkg.status !== 0) {
  console.log("skip: wayland-client pkg-config not available (treeland helper is optional)");
  process.exit(0);
}
const cc = process.env.CC || "cc";
fs.mkdirSync(outDir, { recursive: true });
const args = ["-O2", "-Wall", "-o", out, source, proto, `-I${include}`, ...String(pkg.stdout).trim().split(/\s+/)];
const built = spawnSync(cc, args, { stdio: "inherit" });
if (built.status !== 0) {
  console.error("build native helper failed (optional; Linux dispatch will fall back)");
  process.exit(built.status || 1);
}
console.log(`built ${out}`);
