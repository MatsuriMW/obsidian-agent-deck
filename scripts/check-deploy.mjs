#!/usr/bin/env node
// Production deploy & asset integrity gate:
// 1) manifest.json / package.json / versions.json alignment
// 2) build artifact presence & bundle size budget
// 3) external Vault script ASSET_VERSION alignment

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_MAIN_BYTES = 3.5 * 1024 * 1024;
const MAX_CSS_BYTES = 512 * 1024;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

const pkg = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

const errors = [];

if (pkg.version !== manifest.version) {
  errors.push(`version mismatch: package.json=${pkg.version} vs manifest.json=${manifest.version}`);
}
if (!Object.hasOwn(versions, manifest.version)) {
  errors.push(`versions.json missing entry for ${manifest.version}`);
}

for (const [file, maxBytes] of [["main.js", MAX_MAIN_BYTES], ["styles.css", MAX_CSS_BYTES]]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) {
    errors.push(`missing build artifact: ${file}`);
    continue;
  }
  const size = fs.statSync(p).size;
  if (size === 0 || size > maxBytes) {
    errors.push(`artifact ${file} out of budget: ${size} bytes (max ${maxBytes})`);
  }
}

const constantsText = fs.readFileSync(path.join(root, "src/constants.js"), "utf8");
const mqText = fs.readFileSync(path.join(root, "scripts/memory-query.mjs"), "utf8");
const cVer = /MEMORY_QUERY_ASSET_VERSION\s*=\s*(\d+)/.exec(constantsText)?.[1];
const mVer = /export\s+const\s+ASSET_VERSION\s*=\s*(\d+)/.exec(mqText)?.[1];
if (!cVer || !mVer || cVer !== mVer) {
  errors.push(`memory-query asset version drift: constants=${cVer || "missing"} vs script=${mVer || "missing"}`);
}

if (errors.length) {
  console.error("DEPLOY CHECK FAILED:\n  - " + errors.join("\n  - "));
  process.exit(1);
}

const mainKB = (fs.statSync(path.join(root, "main.js")).size / 1024).toFixed(1);
const cssKB = (fs.statSync(path.join(root, "styles.css")).size / 1024).toFixed(1);
console.log(`PASS deploy check: v${manifest.version}, main.js=${mainKB}KB, styles.css=${cssKB}KB, memory-query ASSET_VERSION=${mVer}`);
