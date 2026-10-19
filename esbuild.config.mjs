import esbuild from "esbuild";
import fs from "fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const banner = `/* Agent Deck ${pkg.version} — MIT — https://github.com/MatsuriMW/obsidian-agent-deck */`;

const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "@codemirror/view", "@codemirror/state", "@codemirror/language"],
  loader: { ".swift": "text" },
  banner: { js: banner },
  footer: { js: "module.exports = module.exports.default;" },
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(options);
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  console.log(`built ${manifest.name} v${manifest.version}`);
}
