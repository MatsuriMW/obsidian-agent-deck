import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class ItemView{constructor(l){this.leaf=l}};export class WorkspaceLeaf{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const { groupMemories, MEMORY_STATE_ORDER } = await import("../src/memory-board.js");

test("记忆看板：按 state 分列，未知状态落回有效列", () => {
  const entries = [
    { path: "a", state: "有效" }, { path: "b", state: "有效" },
    { path: "c", state: "已拒绝" }, { path: "d", state: "已被替代" },
    { path: "e" }, { path: "f", state: "乱写" },
  ];
  const columns = groupMemories(entries);
  assert.deepEqual(columns.map((c) => c.state), MEMORY_STATE_ORDER);
  assert.equal(columns[0].items.length, 4, "有效 + 未填 + 未知都归到有效列");
  assert.equal(columns[1].items.length, 1);
  assert.equal(columns[2].items.length, 1);
  assert.deepEqual(columns.flatMap((c) => c.items).map((e) => e.path).sort(), ["a", "b", "c", "d", "e", "f"]);
});

test("记忆看板：空目录不炸，三列都在", () => {
  const columns = groupMemories([]);
  assert.equal(columns.length, 3);
  assert.ok(columns.every((c) => c.items.length === 0));
});

test("来源角标只解析 frontmatter 里的双链与块号，不碰正文", async () => {
  const { sourceRefs } = await import("../src/memory-board.js");
  const refs = sourceRefs({ sources: ["[[日记/2026_11_06#^mem-730d323d]]（用户日志，第 15 行）；原文：…", "[[日记/2026_11_13]]（用户日志，第 148 行）；原文：…"] });
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0], { path: "日记/2026_11_06", blockId: "mem-730d323d", raw: "[[日记/2026_11_06#^mem-730d323d]]（用户日志，第 15 行）；原文：…" });
  assert.equal(refs[1].blockId, "");
  assert.deepEqual(sourceRefs({}), []);
  assert.deepEqual(sourceRefs({ sources: ["没有双链"] }), []);
});

test("记忆看板：多次刷新后拖入文件只触发一次导入弹窗", async () => {
  const { MemoryBoardView } = await import("../src/memory-board.js");
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      children: [],
      addClass() {},
      removeClass() {},
      empty() { this.children = []; },
      createDiv() { return makeEl(); },
      createSpan() { return makeEl(); },
      createEl() { return makeEl(); },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      async dispatch(type, evt) {
        for (const fn of listeners.get(type) || []) await fn(evt);
      },
    };
    return el;
  };

  let opened = 0;
  const plugin = {
    dreaming: { loadEntries: async () => [] },
    openMemoryImport() { opened++; },
  };
  const view = new MemoryBoardView({}, plugin);
  view.contentEl = makeEl();
  await view.onOpen();
  await view.refresh();
  await view.refresh();

  await view.contentEl.dispatch("drop", {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: {
      files: [{ name: "note.md", lastModified: 1700000000000, text: async () => "- 用户偏好中文回复" }],
    },
  });
  assert.equal(opened, 1);
});
