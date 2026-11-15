import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { register } from "node:module";

const cmStub = [
  "export class WidgetType {}",
  "export class RangeSetBuilder { add(){} finish(){ return {}; } }",
  "export const Prec = { low: (x) => x, high: (x) => x, highest: (x) => x };",
  "export const Decoration = { replace: () => ({ range: () => ({}) }), line: () => ({ range: () => ({}) }), widget: () => ({ range: () => ({}) }), set: () => ({}) };",
  "export const EditorView = { decorations: { from: () => ({}) }, atomicRanges: { of: () => ({}) } };",
  "export const ViewPlugin = { fromClass: () => ({}) };",
  "export const EditorState = { transactionFilter: { of: () => ({}) } };",
  "export const StateEffect = { define: () => ({}) };",
  "export const StateField = { define: () => ({}) };",
  "export const foldedRanges = () => ({ between() {} });",
  "export const foldEffect = {};",
  "export const unfoldEffect = {};",
].join("\n");

const obsidianStub = [
  "export class App {}",
  "export class Plugin {}",
  "export class Notice {}",
  "export class MarkdownView {}",
  "export class MarkdownRenderChild {}",
  "export class EditorSuggest {}",
  "export class FuzzySuggestModal {}",
  "export class Modal {}",
  "export class Menu { constructor(){this.items=[]} addSeparator(){} addItem(fn){const item={setTitle(v){this.title=v;return this},setIcon(v){this.icon=v;return this},setChecked(v){this.checked=v;return this},setDisabled(v){this.disabled=v;return this},setSubmenu(){const s=new Menu();item.submenu=s;return s},onClick(cb){this.click=cb;return this}};fn(item);this.items.push(item);return this} showAtMouseEvent(){} }",
  "export class ItemView {}",
  "export class PluginSettingTab {}",
  "export class Setting {}",
  "export class MarkdownRenderer { static async render() {} }",
  "export class Component { load() {} unload() {} }",
  "export const editorInfoField = {};",
  "export function setIcon() {}",
].join("\n");

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(s, c, n) {
  if (s.endsWith(".png") || s.endsWith(".swift") || s.endsWith(".css")) return { url: "data:text/javascript,export default '';", shortCircuit: true };
  if (s.startsWith("@codemirror/")) return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(cmStub))}, shortCircuit: true };
  if (s === "obsidian") return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(obsidianStub))}, shortCircuit: true };
  return n(s, c);
}`));

const { extractTaskBlock, buildTaskExportDocument, removeTaskBlockFromNote, writeExportFile } = await import("../src/task-export.js");
const { default: AgentDeckPlugin } = await import("../src/main.js");

test("extractTaskBlock cleans internal markers, keeps dialogue and parent task, and classifies name", () => {
  const note = [
    "- 其他任务",
    "\t- DOING 🤖 10:00-10:28 agent-deck -> 时间线优化 ^ad-time-abc1234567",
    "\t\t- ❓ 第1轮：横向时间轴可行吗？ <!-- ad-turn:abc1234567:1 -->",
    "\t\t- 💬 第1轮：可以直接复用内存 rounds 列表 <!-- ad-turn:abc1234567:1 -->",
    "\t\t\t```js",
    "\t\t\tconst sample = '^ad-keep-inside-fence';",
    "\t\t\t```",
    "\t\t- 🔗 [Claude](claude://resume?session=11111111-1111-1111-1111-111111111111) `11111111-1111-1111-1111-111111111111`",
    "\t\t- ⏱ 10:00–10:28 · 共 28m · 12k tok <!-- ad-clock:deadbeef -->",
    "",
    "- 后续任务",
  ].join("\n");

  const ex = extractTaskBlock(note, 1, "日记/2026_11_16.md");
  assert.ok(ex);
  assert.equal(ex.start, 1);
  assert.equal(ex.end, 8);
  assert.equal(ex.date, "2026-11-16");
  assert.equal(ex.title, "agent-deck -> 时间线优化");
  assert.equal(ex.category, "agent-deck");
  assert.equal(ex.suggestedName, "2026-11-16-agent-deck-时间线优化");

  const lines = ex.markdown.split("\n");
  assert.equal(lines[0], "- DOING 🤖 10:00-10:28 agent-deck -> 时间线优化");
  assert.ok(lines[1].startsWith("\t- ❓ 第1轮：横向时间轴可行吗？"));
  assert.ok(!lines[1].includes("ad-turn:"));
  assert.ok(lines[4].includes("^ad-keep-inside-fence"));
  assert.equal(lines[6], "\t- 🔗 [Claude](claude://resume?session=11111111-1111-1111-1111-111111111111)");
  assert.equal(lines[7], "\t- ⏱ 10:00–10:28 · 共 28m · 12k tok");

  const doc = buildTaskExportDocument(ex, "日记/2026_11_16.md");
  assert.ok(doc.startsWith("# agent-deck -> 时间线优化\n\n> 来源：日记/2026_11_16.md\n\n- DOING 🤖"));
});

test("removeTaskBlockFromNote removes block with zero leftover placeholder and clean spacing", () => {
  const note = [
    "- 第一条",
    "",
    "- DOING 🤖 导出测试 ^ad-test-1234567890",
    "\t- 💬 第1轮：内容",
    "",
    "- 第三条",
    "",
  ].join("\n");

  const next = removeTaskBlockFromNote(note, 2, 3);
  assert.equal(next, "- 第一条\n\n- 第三条\n");
  assert.equal(removeTaskBlockFromNote("- 唯一块\n\t- 子行\n", 0, 1), "");
});

test("writeExportFile writes inside vault via Obsidian API and outside vault via filesystem", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "ad-export-test-"));
  const vaultBase = path.join(tmpRoot, "vault");
  const outsideDir = path.join(tmpRoot, "outside");
  await fsp.mkdir(vaultBase, { recursive: true });

  const createdFolders = [];
  const createdFiles = new Map();
  const plugin = {
    app: {
      vault: {
        adapter: { basePath: vaultBase },
        getAbstractFileByPath: (p) => createdFiles.has(p) ? { path: p } : createdFolders.includes(p) ? { path: p } : null,
        createFolder: async (p) => { createdFolders.push(p); },
        create: async (p, content) => { createdFiles.set(p, content); return { path: p }; },
        modify: async (f, content) => { createdFiles.set(f.path, content); },
      },
    },
  };

  try {
    const insideTarget = path.join(vaultBase, "AI归档", "Claude", "note.md");
    const r1 = await writeExportFile(plugin, insideTarget, "# inside\n");
    assert.deepEqual(r1, { path: "AI归档/Claude/note.md", insideVault: true });
    assert.equal(createdFiles.get("AI归档/Claude/note.md"), "# inside\n");
    assert.deepEqual(createdFolders, ["AI归档", "AI归档/Claude"]);

    const outsideTarget = path.join(outsideDir, "sub", "note.md");
    const r2 = await writeExportFile(plugin, outsideTarget, "# outside\n");
    assert.deepEqual(r2, { path: outsideTarget, insideVault: false });
    assert.equal(fs.readFileSync(outsideTarget, "utf8"), "# outside\n");
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("openRecordViewMenu exposes Export submenu instead of task actions or re-delegate", () => {
  const menu = AgentDeckPlugin.prototype.openRecordViewMenu.call(
    { app: {}, settings: {} },
    {},
    { path: "日记/2026_11_16.md", line: 3, viewMode: "timeline" },
  );
  const titles = menu.items.map((i) => i.title);
  assert.deepEqual(titles, ["大纲", "表格", "卡片", "时间线", "导出"]);
  const exportItem = menu.items[4];
  assert.ok(exportItem.submenu);
  assert.deepEqual(
    exportItem.submenu.items.map((i) => i.title),
    ["导出为 PDF", "以 Markdown 格式复制到剪贴板", "另存为…"],
  );
});
