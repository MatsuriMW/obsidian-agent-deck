#!/usr/bin/env node
// Copy the built plugin into a vault (cross-platform: macOS / Windows).
// Usage: node scripts/install.mjs /path/to/vault
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vault = process.argv[2];
if (!vault) {
  console.error("usage: node scripts/install.mjs <path/to/vault>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(path.resolve(vault), ".obsidian", "plugins", "agent-deck");
fs.mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css", "README.md", "README.zh-CN.md", "versions.json"]) {
  fs.copyFileSync(path.join(root, file), path.join(dest, file));
}
fs.copyFileSync(path.join(root, "docs", "task-workflow.zh-CN.md"), path.join(dest, "README-交接.md"));
// 运行时记忆查询与 MCP Server：装进插件目录，派发提示行与外部客户端指的就是这两份（向上四层即库根）。
fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "memory-query.mjs"), path.join(dest, "scripts", "memory-query.mjs"));
fs.copyFileSync(path.join(root, "scripts", "memory-mcp.mjs"), path.join(dest, "scripts", "memory-mcp.mjs"));
console.log(`installed to ${dest}`);
