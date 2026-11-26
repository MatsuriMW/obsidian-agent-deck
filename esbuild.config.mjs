import esbuild from "esbuild";
import fs from "fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const constantsText = fs.readFileSync("src/constants.js", "utf8");
const mqVer = Number(/MEMORY_QUERY_ASSET_VERSION\s*=\s*(\d+)/.exec(constantsText)?.[1] || 1);
const mcpVer = Number(/MEMORY_MCP_ASSET_VERSION\s*=\s*(\d+)/.exec(constantsText)?.[1] || 1);
const banner = `/* Agent Deck ${pkg.version} — Apache-2.0 — https://github.com/MatsuriMW/obsidian-agent-deck */`;

const jsOptions = {
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "@codemirror/view", "@codemirror/state", "@codemirror/language"],
  loader: { ".swift": "text", ".png": "dataurl" },
  banner: { js: banner },
  footer: { js: "module.exports = module.exports.default;" },
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
};

const cssOptions = {
  entryPoints: ["src/styles/index.css"],
  bundle: true,
  outfile: "styles.css",
  target: "chrome108",
  banner: { css: `${banner}\n/* Generated from src/styles/ by \`npm run build\` — do not edit styles.css directly. */` },
  logLevel: "info",
};

const cliOptions = {
  entryPoints: ["src/context-core/cli.js"],
  bundle: true,
  outfile: "scripts/memory-query.mjs",
  format: "esm",
  platform: "node",
  target: "node20",
  banner: {
    js: `#!/usr/bin/env node\n/* Built from src/context-core/cli.js by \`npm run build\` — do not edit directly. */`,
  },
  footer: {
    js: `\nexport const ASSET_VERSION = ${mqVer};`,
  },
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
};

const mcpOptions = {
  entryPoints: ["src/context-core/mcp.js"],
  bundle: true,
  outfile: "scripts/memory-mcp.mjs",
  format: "esm",
  platform: "node",
  target: "node20",
  banner: {
    js: `#!/usr/bin/env node\n/* Built from src/context-core/mcp.js by \`npm run build\` — do not edit directly. */`,
  },
  footer: {
    js: `\nexport const ASSET_VERSION = ${mcpVer};`,
  },
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
};

function chmodScripts() {
  for (const out of ["scripts/memory-query.mjs", "scripts/memory-mcp.mjs"]) {
    try { fs.chmodSync(out, 0o755); } catch { /* ignore on win32 */ }
  }
}

if (watch) {
  const [jsCtx, cssCtx, cliCtx, mcpCtx] = await Promise.all([
    esbuild.context(jsOptions),
    esbuild.context(cssOptions),
    esbuild.context(cliOptions),
    esbuild.context(mcpOptions),
  ]);
  await Promise.all([jsCtx.watch(), cssCtx.watch(), cliCtx.watch(), mcpCtx.watch()]);
  console.log("watching…");
} else {
  await Promise.all([
    esbuild.build(jsOptions),
    esbuild.build(cssOptions),
    esbuild.build(cliOptions),
    esbuild.build(mcpOptions),
  ]);
  chmodScripts();
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  console.log(`built ${manifest.name} v${manifest.version} (cli v${mqVer}, mcp v${mcpVer})`);
}
