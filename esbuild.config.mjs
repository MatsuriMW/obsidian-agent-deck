import esbuild from "esbuild";
import fs from "fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
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

if (watch) {
  const [jsCtx, cssCtx] = await Promise.all([
    esbuild.context(jsOptions),
    esbuild.context(cssOptions),
  ]);
  await Promise.all([jsCtx.watch(), cssCtx.watch()]);
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(jsOptions), esbuild.build(cssOptions)]);
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  console.log(`built ${manifest.name} v${manifest.version}`);
}
