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

const {
  extractTaskBlock,
  buildTaskExportDocument,
  buildTaskViewHtmlDocument,
  buildTaskExportJson,
  buildTaskExportCsv,
  buildTaskMarkdownTable,
  buildTaskPlainText,
  removeTaskBlockFromNote,
  writeExportFile,
} = await import("../src/task-export.js");
const { default: AgentDeckPlugin } = await import("../src/main.js");

const SAMPLE_NOTE = [
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

test("extractTaskBlock cleans internal markers, keeps dialogue and parent task, and classifies name", () => {
  const ex = extractTaskBlock(SAMPLE_NOTE, 1, "日记/2026_11_16.md");
  assert.ok(ex);
  assert.equal(ex.start, 1);
  assert.equal(ex.end, 8);
  assert.equal(ex.date, "2026-11-16");
  assert.equal(ex.status, "DOING");
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

test("buildTaskViewHtmlDocument renders distinct outline, table, cards and timeline views with expanded children, timestamps and safe links", () => {
  const t1 = new Date(2026, 10, 16, 9, 15, 0).getTime();
  const t2 = new Date(2026, 10, 17, 10, 40, 0).getTime();
  const note = [
    "- DOING 🤖 10:00-10:28 agent-deck -> 导出视图 ^ad-view-1234567890",
    "  - ❓ 第1轮：支持表格与 [链接](https://example.com) 吗？ <!-- ad-turn:s1:1 -->",
    "  - 💬 第1轮：支持，见 [[设计规范|UI 规范]] 与 [bad](javascript:alert(1)) <!-- ad-turn:s1:1 -->",
    "    - 细节 A：支持 `table` | `cards`",
    "      - 深层 B",
    "  - 💬 第2轮：任务：加时间线；结论：已按跨天时间轴对齐 <!-- ad-turn:s1:2 -->",
    "  - 💬 累计总结：全部导出格式就绪",
    "  - 手写补充：记得核对暗色与打印分页",
    "  - 🔗 [Codex](codex://threads/11111111-2222-3333-4444-555555555555) `11111111-2222-3333-4444-555555555555`",
    "  - ⏱ 09:15–10:40 · 共 35m · 8k tok <!-- ad-clock:cafebabe -->",
  ].join("\n");

  const plugin = {
    settings: { aiRecordViews: { "ad-view-1234567890": "timeline" } },
    agentShortNames: { codex: "Codex" },
    usage: { meta: new Map([["s1", { rounds: [{ n: 1, at: t1 }, { n: 2, at: t2 }] }]]) },
  };

  const ex = extractTaskBlock(note, 0, "日记/2026_11_16.md", plugin);
  assert.equal(ex.viewMode, "timeline");
  assert.equal(ex.structured.rows.length, 3);
  assert.equal(ex.structured.footer.length, 2);
  assert.equal(ex.structured.extraMarkdown, "- 手写补充：记得核对暗色与打印分页");

  const outlineHtml = buildTaskViewHtmlDocument(ex, "日记/2026_11_16.md", { viewMode: "outline" });
  assert.ok(outlineHtml.includes('class="ad-ex-outline"'));
  assert.ok(outlineHtml.includes("视图：大纲"));

  const tableHtml = buildTaskViewHtmlDocument(ex, "日记/2026_11_16.md", { viewMode: "table" });
  assert.ok(tableHtml.includes('data-view="table"'));
  assert.ok(tableHtml.includes('<table class="ad-record-table">'));
  assert.ok(tableHtml.includes("任务 / 提问"));
  assert.ok(tableHtml.includes("细节 A：支持"));
  assert.ok(tableHtml.includes("深层 B"));
  assert.ok(tableHtml.includes('href="https://example.com"'));
  assert.ok(!tableHtml.includes("javascript:alert"));
  assert.ok(tableHtml.includes("UI 规范"));
  assert.ok(tableHtml.includes("附注与子任务"));
  assert.ok(tableHtml.includes("手写补充：记得核对暗色与打印分页"));
  assert.ok(tableHtml.includes("ad-rt-footer"));

  const cardsHtml = buildTaskViewHtmlDocument(ex, "日记/2026_11_16.md", { viewMode: "cards" });
  assert.ok(cardsHtml.includes('data-view="cards"'));
  assert.ok(cardsHtml.includes('class="ad-rt-cards"'));
  assert.ok(cardsHtml.includes('class="ad-rt-card is-span"'));
  assert.ok(cardsHtml.includes("2026-11-16 09:15"));

  const timelineHtml = buildTaskViewHtmlDocument(ex, "日记/2026_11_16.md", { viewMode: "timeline" });
  assert.ok(timelineHtml.includes('data-view="timeline"'));
  assert.ok(timelineHtml.includes("ad-rt-timeline--timed ad-rt-timeline--dated"));
  assert.ok(timelineHtml.includes("11-16 09:15"));
  assert.ok(timelineHtml.includes("11-17 10:40"));

  // Plain task without AI records falls back cleanly to outline even if cards requested
  const plainEx = extractTaskBlock("- TODO 手写普通任务\n  - 普通子项", 0, "日记/2026_11_16.md");
  const plainHtml = buildTaskViewHtmlDocument(plainEx, "日记/2026_11_16.md", { viewMode: "cards" });
  assert.ok(plainHtml.includes('class="ad-ex-outline"'));
  assert.ok(plainHtml.includes("普通子项"));
});

test("JSON, CSV, Markdown table and plain text builders produce valid reusable outputs", () => {
  const t1 = new Date(2026, 10, 16, 14, 5, 0).getTime();
  const note = [
    "- DONE 🤖 14:00-14:20 proj -> 接口整理 ^ad-api-1234567890",
    '  - ❓ 第1轮：字段包含 "id", `name` 吗？ <!-- ad-turn:s1:1 -->',
    "  - 💬 第1轮：包含 `a | b` 与 [[Docs|文档]] <!-- ad-turn:s1:1 -->",
    "    - 子项一",
    "  - 手写注记",
    "  - ⏱ 14:00–14:20 · 共 20m · 5k tok",
  ].join("\n");
  const plugin = {
    settings: { aiRecordViews: { "ad-api-1234567890": "table" } },
    usage: { meta: new Map([["s1", { rounds: [{ n: 1, at: t1 }] }]]) },
  };
  const ex = extractTaskBlock(note, 0, "日记/2026_11_16.md", plugin);

  const json = JSON.parse(buildTaskExportJson(ex, "日记/2026_11_16.md"));
  assert.equal(json.schema, "agent-deck.task-export.v1");
  assert.equal(json.status, "DONE");
  assert.equal(json.viewMode, "table");
  assert.equal(json.rounds.length, 1);
  assert.equal(json.rounds[0].round, 1);
  assert.equal(json.rounds[0].startedAt, t1);
  assert.deepEqual(json.rounds[0].children, [{ level: 0, text: "子项一" }]);
  assert.equal(json.notes, "- 手写注记");
  assert.equal(json.footer.length, 1);

  const csv = buildTaskExportCsv(ex, "日记/2026_11_16.md");
  assert.ok(csv.startsWith("\uFEFF标题,日期,来源,轮次,类型,时间,任务 / 提问,结论 / 回复,子项\r\n"));
  assert.ok(csv.includes("#1") && csv.includes('"字段包含 ""id"", `name` 吗？"'));

  const mdTable = buildTaskMarkdownTable(ex, "日记/2026_11_16.md");
  assert.ok(mdTable.includes("| 轮次 | 任务 / 提问 | 结论 / 回复 |"));
  assert.ok(mdTable.includes("`a \\| b`"));
  assert.ok(mdTable.includes("• 子项一"));
  assert.ok(mdTable.includes("## 附注与子任务"));
  assert.ok(mdTable.includes("- ⏱ 14:00–14:20 · 共 20m · 5k tok"));

  const plain = buildTaskPlainText(ex, "日记/2026_11_16.md");
  assert.ok(!plain.includes("[[Docs|文档]]"));
  assert.ok(plain.includes("文档"));
  assert.ok(!plain.includes("`name`"));
  assert.ok(plain.includes("[#1 · 2026-11-16 14:05]"));
  assert.ok(plain.includes("  - 子项一"));
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

test("openRecordViewMenu exposes view-aware PDF and multi-format exports inside Export submenu", () => {
  const ctx = {
    app: {},
    settings: {},
    populateRecordExportMenu: AgentDeckPlugin.prototype.populateRecordExportMenu,
  };

  const viewMenu = AgentDeckPlugin.prototype.openRecordViewMenu.call(
    ctx,
    {},
    { path: "日记/2026_11_16.md", line: 3, viewMode: "timeline" },
  );
  assert.deepEqual(viewMenu.items.map((i) => i.title), ["大纲", "表格", "卡片", "时间线", "导出"]);
  const exportItem = viewMenu.items[4];
  assert.ok(exportItem.submenu);
  assert.deepEqual(
    exportItem.submenu.items.map((i) => i.title),
    [
      "导出为 PDF（时间线）",
      "导出为 HTML（时间线）",
      "导出为 Markdown (.md)",
      "导出为 JSON (.json)",
      "导出为 CSV (.csv)",
      "复制为 Markdown",
      "复制为 Markdown 表格",
      "复制为纯文本",
      "复制为 JSON",
      "另存为并移出原文…",
    ],
  );
});
