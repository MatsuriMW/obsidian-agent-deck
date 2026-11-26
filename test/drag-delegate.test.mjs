import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { register, createRequire } from "node:module";

globalThis.require = createRequire(import.meta.url);

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@codemirror/view") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        const NONE = Object.freeze({ specs: [], map() { return NONE; } });
        export class WidgetType {}
        export const Decoration = {
          none: NONE,
          set(items) { return { specs: items, map() { return this; } }; },
          line(spec) { return { range(from) { return { kind: "line", from, ...spec }; } }; },
          widget(spec) { return { range(from) { return { kind: "widget", from, ...spec }; } }; },
          replace(spec) { return { ...spec, range(from) { return { kind: "replace", from, ...spec }; } }; },
          mark(spec) { return { ...spec, range(from, to) { return { kind: "mark", from, to, ...spec }; } }; },
        };
        export const ViewPlugin = { fromClass(cls) { return { cls }; } };
        export const EditorView = {
          decorations: { from(f) { return f; } },
          domEventHandlers() { return {}; },
          theme() { return {}; },
          findFromDOM() { return null; },
        };
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "@codemirror/state") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export class RangeSetBuilder {
          constructor() { this.items = []; }
          add(from, to, value) { this.items.push({ from, to, value }); }
          finish() { return { specs: this.items }; }
        }
        export const StateEffect = {
          define() {
            const type = {};
            type.of = (value) => ({ type, value, is(target) { return target === type; } });
            return type;
          },
        };
        export const StateField = { define(cfg) { return cfg; } };
        export const Prec = { highest(x) { return x; }, high(x) { return x; }, low(x) { return x; } };
        export const EditorState = {};
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "@codemirror/language") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export function syntaxTree() { return { resolveInner() { return null; } }; }
        export function foldedRanges() { return { iter() {}, between() {} }; }
        export const foldEffect = { is() { return false; } };
        export const unfoldEffect = { is() { return false; } };
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "obsidian") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export class ItemView { constructor(leaf) { Object.assign(this, leaf); } }
        export class Modal { constructor() {} open() {} close() {} }
        export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
        export class Notice {}
        export class Component {}
        export const MarkdownRenderer = { async render() {} };
        export function setIcon() {}
      \`),
      shortCircuit: true,
    };
  }
  if (/\\.png$/.test(specifier)) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export default 'data:image/png;base64,iVBORw0KGgo=';"),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
`));

const { AGENTS, AGENT_ORDER, DEFAULTS, deepMerge } = await import("../src/constants.js");
const { canDelegateDrop } = await import("../src/agent-registry.js");
const { destinations, defaultDestination } = await import("../src/workflow.js");
const { syncCustomAcpRegistry } = await import("../src/custom-acp.js");
const {
  blockAt, blockTitle, markDelegated, STATUS_RE, isCliSession, Delegator,
} = await import("../src/delegation.js");
const { T3CodeRunner } = await import("../src/delegation-runners.js");
const J = await import("../src/journal.js");
const { agentDropMeta } = await import("../src/workflow.js");
const { AgentDeckView } = await import("../src/view.js");
const { installListDragBridge, resolveListItemFromElement } = await import("../src/editor.js");
const { taskMention, mentionOptions, stripTaskMention } = await import("../src/task-mentions.js");

function makeDomElement(tag = "div", { cls = "", text = "", attr = {} } = {}) {
  const classes = new Set(String(cls || "").split(/\s+/).filter(Boolean));
  const attrs = new Map(Object.entries(attr));
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parent: null,
    dataset: {},
    style: { setProperty() {} },
    textContent: text,
    ownerDocument: {
      createElement(t) { return makeDomElement(t); },
    },
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    classList: {
      add(...names) { for (const n of names) if (n) classes.add(n); },
      remove(...names) { for (const n of names) classes.delete(n); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
      contains(name) { return classes.has(name); },
    },
    addClass(...names) { this.classList.add(...names); },
    removeClass(...names) { this.classList.remove(...names); },
    toggleClass(name, force) { return this.classList.toggle(name, force); },
    setAttr(k, v) { attrs.set(k, String(v)); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    createEl(t, opts = {}) {
      const child = makeDomElement(t, opts);
      child.parent = el;
      if (opts.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          if (k.startsWith("data-")) {
            const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            child.dataset[key] = String(v);
          }
        }
      }
      el.children.push(child);
      return child;
    },
    createDiv(opts) { return el.createEl("div", opts); },
    createSpan(opts) { return el.createEl("span", opts); },
    empty() { el.children = []; },
    addEventListener(type, fn, capture = false) {
      const list = listeners.get(type) || [];
      list.push({ fn, capture: Boolean(capture) });
      listeners.set(type, list);
    },
    removeEventListener(type, fn, capture = false) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((x) => x.fn !== fn || x.capture !== Boolean(capture)));
    },
    dispatchEvent(type, ev = {}) {
      const event = { target: el, ...ev };
      for (const item of [...(listeners.get(type) || [])]) item.fn(event);
      return event;
    },
    all() { return [el, ...el.children.flatMap((c) => c.all())]; },
    contains(target) { return Boolean(target && el.all().includes(target)); },
    matches(selector) {
      return selector.split(",").map((s) => s.trim()).filter(Boolean).some((part) => {
        const tokens = part.match(/\.[a-zA-Z0-9_-]+/g) || [];
        return tokens.length > 0 && tokens.every((t) => classes.has(t.slice(1)));
      });
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches(selector)) return cur;
        cur = cur.parent;
      }
      return null;
    },
    querySelector(selector) {
      return el.all().find((node) => node !== el && node.matches(selector)) || null;
    },
    querySelectorAll(selector) {
      return el.all().filter((node) => node.matches(selector));
    },
  };
  if (attr) {
    for (const [k, v] of Object.entries(attr)) {
      if (k.startsWith("data-")) {
        const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[key] = String(v);
      }
    }
  }
  return el;
}

test("canDelegateDrop and destinations cover all built-in agents and Custom ACP agents", () => {
  const expectedDelegable = new Set([
    "claude", "codex", "workbuddy", "teleagent", "dsh", "antigravity",
    "opencode", "qoder", "hermes", "minimax", "cursor", "trae", "t3code", "kimicode", "gemini",
  ]);
  const expectedBlocked = new Set([
    "qwenwork", "grokbot", "cindy", "orca", "muse", "doubaowork",
  ]);

  assert.equal(AGENT_ORDER.length, expectedDelegable.size + expectedBlocked.size);
  for (const id of expectedDelegable) {
    assert.equal(canDelegateDrop(id), true, `${id} must be delegable`);
    assert.ok(destinations(id).length > 0, `${id} must expose at least one destination`);
  }
  for (const id of expectedBlocked) {
    assert.equal(canDelegateDrop(id), false, `${id} must NOT be delegable`);
    assert.deepEqual(destinations(id), [], `${id} must have no destinations`);
  }
  assert.equal(canDelegateDrop("nonexistent-agent"), false);

  try {
    syncCustomAcpRegistry([{ id: "kiro-test", name: "Kiro Test", command: "kiro-cli", args: "acp", color: "#123456" }]);
    assert.equal(canDelegateDrop("kiro-test"), true, "custom ACP agent must be delegable");
    assert.match(AGENTS["kiro-test"].soft, /color-mix/, "custom ACP agent must define soft tint CSS");
    assert.deepEqual(destinations("kiro-test").map((d) => d.id), ["background"]);
    assert.equal(defaultDestination({}, "kiro-test"), "background");
    const customLink = J.linkLine("\t", "kiro-test", "测试任务", "sid-999");
    assert.deepEqual(J.parseLink(customLink), { agent: "kiro-test", sid: "sid-999", title: "测试任务" });
  } finally {
    syncCustomAcpRegistry([]);
  }
});

test("unordered, ordered, and checkbox list blocks work with blockAt, blockTitle, STATUS_RE, and markDelegated", () => {
  const lines = [
    "- TODO 无序任务",
    "\t- 子说明",
    "1. [ ] TODO 有序复选框任务",
    "   - 嵌套细节",
    "2) [x] 已勾选任务",
    "* 普通的星号任务",
  ];

  assert.equal(blockAt(lines, 0)?.text, "- TODO 无序任务\n\t- 子说明");
  assert.equal(blockAt(lines, 2)?.text, "1. [ ] TODO 有序复选框任务\n   - 嵌套细节");
  assert.equal(blockAt(lines, 4)?.text, "2) [x] 已勾选任务");
  assert.equal(blockAt(lines, 5)?.text, "* 普通的星号任务");

  assert.equal(blockTitle({ text: "- [ ] TODO 写单测" }), "写单测");
  assert.equal(blockTitle({ text: "1. [ ] 写单测" }), "写单测");
  assert.equal(blockTitle({ text: "2) [x] DONE 已完成项" }), "已完成项");

  assert.equal(markDelegated("- [ ] TODO 写单测"), "- [ ] DELEGATED 写单测");
  assert.equal(markDelegated("1. [ ] TODO 写单测"), "1. [ ] DELEGATED 写单测");
  assert.equal(markDelegated("2) [x] 写单测"), "2) [x] DELEGATED 写单测");
  assert.equal(markDelegated("- TODO Replace TODO word"), "- DELEGATED Replace TODO word");
  assert.equal(markDelegated("1. TODO 第一个有序任务"), "1. DELEGATED 第一个有序任务");
  assert.ok(STATUS_RE.test("1. [ ] TODO 有序复选框"));
});

test("Gemini CLI handoffCli & isCliSession and T3 Code continueSession & ENOENT handling", async () => {
  assert.equal(isCliSession("gemini", "cli"), true);
  assert.equal(isCliSession("gemini", "desktop"), false);

  const plugin = {
    settings: deepMerge(DEFAULTS, {
      agents: { gemini: true, t3code: true },
      delegate: {
        gemini: { path: "/usr/local/bin/gemini", model: "gemini-2.5-pro", autoApprove: true },
        t3code: { path: "/nonexistent/t3-missing-binary" },
      },
    }),
    jobs: {},
    vaultPath: os.tmpdir(),
    usage: { meta: new Map() },
    saveSettings() {},
    saveJobs() {},
    saveJobsSoon() {},
    refreshUI() {},
    notice() {},
    readNote: async () => "1. TODO 用 Gemini 调研\n",
    writeNote: async () => {},
    agentEnabled: () => true,
    modelsFor: () => [],
    defaultModel: (id) => DEFAULTS.delegate[id]?.model || "",
  };

  // Verify gemini CLI handoff command construction cleanly without opening a real terminal.
  const src = fs.readFileSync(new URL("../src/delegation.js", import.meta.url), "utf8");
  assert.match(src, /else if \(agent === "gemini"\) \{[\s\S]*?"-i"\]/);

  // Verify T3CodeRunner gives a friendly ENOENT message instead of exit code -1.
  const errors = [];
  const d = new Delegator({
    ...plugin,
    notice(msg) { errors.push(msg); },
  });
  d.onError = (job) => errors.push(job.error);
  const job = { id: "job-t3-enoent", agent: "t3code" };
  const runner = new T3CodeRunner(d, job);
  await runner.start({ cwd: os.tmpdir(), prompt: "test missing t3" });
  assert.equal(job.state, "error");
  assert.match(job.error, /找不到 T3 Code 可执行文件/);

  // Verify continueSession routes t3code through T3CodeRunner (not AcpRunner).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-t3-cont-"));
  try {
    const argvLog = path.join(tmpDir, "args.json");
    const mockJs = path.join(tmpDir, "mock-t3.js");
    fs.writeFileSync(
      mockJs,
      `#!/usr/bin/env node
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ threadId: "thread:1", status: "completed", reply: "OK" }));
`,
      { mode: 0o755 },
    );
    let mockT3 = mockJs;
    if (process.platform === "win32") {
      mockT3 = path.join(tmpDir, "mock-t3.cmd");
      fs.writeFileSync(mockT3, `@echo off\r\n"${process.execPath}" "${mockJs}" %*\r\n`);
    }
    plugin.settings.delegate.t3code.path = mockT3;
    const d2 = new Delegator(plugin);
    d2.onDone = () => {};
    d2.onError = () => {};
    const contJob = await d2.continueSession({ agent: "t3code", sid: "thread:1", cwd: tmpDir }, "继续验证");
    assert.equal(contJob.state, "done");
    const args = JSON.parse(fs.readFileSync(argvLog, "utf8"));
    assert.deepEqual(args.slice(0, 3), ["thread", "send", "thread:1"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("view.js grays out non-delegable Agent cards, routes delegable drops, and clears sessionCard dragleave", () => {
  const dropped = [];
  const plugin = {
    settings: deepMerge(DEFAULTS, {}),
    jobs: {},
    views: new Set(),
    agentEnabled: () => true,
    isPrimary: () => false,
    liveSessions: () => [],
    usage: { meta: new Map(), subsOf: () => [] },
    acceptsItemDrag: (e) => Boolean(e._itemDrag),
    readItemDrag: (e) => e._itemDrag,
    delegateDrop: (agent, item, fromEl, opts) => dropped.push({ agent, item, opts }),
    openConversation() {},
    openSession() {},
  };
  const view = new AgentDeckView({ app: {}, contentEl: makeDomElement("div"), containerEl: { isShown: () => true } }, plugin);
  const grid = makeDomElement("div");

  view.agentCard(grid, "claude", null, "grid");
  view.agentCard(grid, "t3code", null, "grid");
  view.agentCard(grid, "grokbot", null, "grid");
  view.agentCard(grid, "muse", null, "grid");

  const claudeCard = grid.children[0];
  const t3Card = grid.children[1];
  const grokCard = grid.children[2];
  const museCard = grid.children[3];

  assert.equal(claudeCard.classList.contains("is-no-drop"), false);
  assert.equal(t3Card.classList.contains("is-no-drop"), false);
  assert.equal(grokCard.classList.contains("is-no-drop"), true);
  assert.equal(museCard.classList.contains("is-no-drop"), true);
  assert.equal(grokCard.getAttribute("data-drop-hint"), "暂不支持委派");
  assert.equal(agentDropMeta(plugin, "grokbot").delegable, false);
  assert.equal(agentDropMeta(plugin, "gemini").delegable, true);

  // Hovering & dropping on unsupported card blocks drop and never calls delegateDrop.
  let blockedPrevented = false;
  const blockedDt = { dropEffect: "copy" };
  grokCard.dispatchEvent("dragover", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    dataTransfer: blockedDt,
    preventDefault() { blockedPrevented = true; },
  });
  assert.equal(blockedPrevented, false);
  assert.equal(blockedDt.dropEffect, "none");
  assert.equal(grokCard.classList.contains("is-drop-blocked"), true);

  grokCard.dispatchEvent("dragleave", { relatedTarget: null });
  assert.equal(grokCard.classList.contains("is-drop-blocked"), false);

  grokCard.dispatchEvent("drop", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    preventDefault() {},
  });
  assert.equal(dropped.length, 0);

  // Hovering & dropping on delegable card sets copy dropEffect and passes explicitAgent: true.
  let allowPrevented = false;
  const allowDt = { dropEffect: "none" };
  claudeCard.dispatchEvent("dragover", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    metaKey: false,
    dataTransfer: allowDt,
    preventDefault() { allowPrevented = true; },
  });
  assert.equal(allowPrevented, true);
  assert.equal(allowDt.dropEffect, "copy");
  assert.equal(claudeCard.classList.contains("is-drop"), true);

  claudeCard.dispatchEvent("drop", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    metaKey: true,
    preventDefault() {},
  });
  assert.equal(claudeCard.classList.contains("is-drop"), false);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].agent, "claude");
  assert.equal(dropped[0].opts.cli, true);
  assert.equal(dropped[0].opts.explicitAgent, true);

  // Session card dragleave must clear .is-drop even for trackingOnly agents (grokbot / muse).
  const sessWrap = makeDomElement("div");
  view.sessionCard(sessWrap, { agent: "grokbot", sid: "bot-1", title: "Legal Bot", lastAt: Date.now(), state: "wait" }, false);
  const sessCard = sessWrap.children[0];
  sessCard.dispatchEvent("dragover", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    dataTransfer: { dropEffect: "" },
    preventDefault() {},
  });
  assert.equal(sessCard.classList.contains("is-drop"), true);
  sessCard.dispatchEvent("dragleave", { relatedTarget: null });
  assert.equal(sessCard.classList.contains("is-drop"), false);
});

test("installListDragBridge handles Bullet plugin and vanilla Obsidian unordered/ordered drags", async () => {
  const root = makeDomElement("div");
  const body = root.createDiv({ cls: "" });
  const editorWrap = body.createDiv({ cls: "markdown-source-view mod-cm6" });
  const contentEl = editorWrap.createDiv({ cls: "cm-content" });
  const cmEditor = contentEl.createDiv({ cls: "cm-editor" });

  const ulLine = cmEditor.createDiv({ cls: "cm-line bullet-plugin-dragging-source-line" });
  const ulBullet = ulLine.createSpan({ cls: "cm-formatting cm-formatting-list cm-formatting-list-ul" });
  ulBullet.createSpan({ cls: "list-bullet", text: "-" });

  const olLine = cmEditor.createDiv({ cls: "cm-line" });
  const olNum = olLine.createSpan({ cls: "cm-formatting cm-formatting-list cm-formatting-list-ol", text: "1. " });

  const sidebar = body.createDiv({ cls: "ad-view" });
  const claudeCard = sidebar.createDiv({ cls: "ad-agentcard", attr: { "data-agent": "claude", "data-drop-hint": "委派给 Claude" } });
  const grokCard = sidebar.createDiv({ cls: "ad-agentcard is-no-drop", attr: { "data-agent": "grokbot", "data-drop-hint": "暂不支持委派" } });
  const sessCard = sidebar.createDiv({ cls: "ad-sess", attr: { "data-sid": "sid-1", "data-agent": "dsh", "data-title": "DSH Task" } });

  const lineTexts = ["- TODO 无序项", "1. TODO 有序项"];
  let currentHit = contentEl;
  let selectionCleared = false;
  const fakeDoc = {
    body,
    addEventListener: body.addEventListener.bind(body),
    removeEventListener: body.removeEventListener.bind(body),
    elementFromPoint: () => currentHit,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  const fakeWin = {
    addEventListener() {},
    removeEventListener() {},
    getSelection() { return { removeAllRanges() { selectionCleared = true; } }; },
  };
  const fakeView = {
    state: {
      field: () => ({ file: { path: "日记/2026_11_25.md" } }),
      doc: {
        lineAt: (pos) => ({ number: pos + 1, text: lineTexts[pos], from: pos * 20 }),
        line: (n) => ({ number: n, text: lineTexts[n - 1], from: (n - 1) * 20 }),
      },
      selection: { main: { empty: false, from: 0, to: 10 } },
    },
    posAtDOM: (el) => (el === ulLine ? 0 : el === olLine ? 1 : null),
    dispatch() {},
  };

  const calls = { delegates: [], binds: [] };
  const fakePlugin = {
    editorInfoField: "editorInfo",
    delegateDrop: (agent, item, fromEl, opts) => calls.delegates.push({ agent, item, opts }),
    bindItemToSession: (item, data) => calls.binds.push({ item, data }),
  };

  const cleanup = installListDragBridge(fakePlugin, {
    doc: fakeDoc,
    win: fakeWin,
    findView: () => fakeView,
    resolveDropMeta: (id, metaKey) => agentDropMeta({ settings: {} }, id, metaKey),
  });

  // 1. Bullet plugin drag on unordered list -> hovers grokbot (blocked) then drops on claude.
  body.classList.add("bullet-plugin-dnd", "bullet-plugin-dragging");
  currentHit = grokCard;
  body.dispatchEvent("mousemove", { clientX: 50, clientY: 50, metaKey: false });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  assert.equal(grokCard.classList.contains("is-drop-blocked"), true);

  currentHit = claudeCard;
  body.dispatchEvent("mousemove", { clientX: 60, clientY: 60, metaKey: false });
  assert.equal(grokCard.classList.contains("is-drop-blocked"), false);
  assert.equal(claudeCard.classList.contains("is-drop"), true);

  body.dispatchEvent("mouseup", { clientX: 60, clientY: 60, metaKey: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body.classList.contains("ad-dragging-item"), false);
  assert.equal(claudeCard.classList.contains("is-drop"), false);
  assert.equal(calls.delegates.length, 1);
  assert.deepEqual(calls.delegates[0].item, { path: "日记/2026_11_25.md", line: 0, lineText: "- TODO 无序项" });
  assert.equal(calls.delegates[0].agent, "claude");

  // Dropping on grokCard must NOT trigger delegateDrop.
  currentHit = grokCard;
  body.dispatchEvent("mousemove", { clientX: 50, clientY: 50, metaKey: false });
  body.dispatchEvent("mouseup", { clientX: 50, clientY: 50, metaKey: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.delegates.length, 1);

  // 2. Vanilla Obsidian drag on ordered list number (`1. `) -> drops on session card & agent card.
  body.classList.remove("bullet-plugin-dnd", "bullet-plugin-dragging");
  currentHit = olNum;
  body.dispatchEvent("mousedown", { button: 0, clientX: 10, clientY: 10, target: olNum });
  // Small move inside editor does not activate drag bridge.
  body.dispatchEvent("mousemove", { clientX: 25, clientY: 10, metaKey: false });
  assert.equal(body.classList.contains("ad-dragging-item"), false);

  // Crossing into sidebar activates drag bridge; dropping on claude delegates ordered item.
  currentHit = claudeCard;
  body.dispatchEvent("mousemove", { clientX: 200, clientY: 10, metaKey: true });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  assert.equal(claudeCard.classList.contains("is-cli"), true);
  body.dispatchEvent("mouseup", { clientX: 200, clientY: 10, metaKey: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.delegates.length, 2);
  assert.deepEqual(calls.delegates[1].item, { path: "日记/2026_11_25.md", line: 1, lineText: "1. TODO 有序项" });
  assert.equal(calls.delegates[1].opts.cli, true);
  assert.equal(selectionCleared, true);

  // Dropping on session card binds instead of delegating.
  currentHit = olNum;
  body.dispatchEvent("mousedown", { button: 0, clientX: 10, clientY: 10, target: olNum });
  currentHit = sessCard;
  body.dispatchEvent("mousemove", { clientX: 200, clientY: 80, metaKey: false });
  assert.equal(sessCard.classList.contains("is-drop"), true);
  body.dispatchEvent("mouseup", { clientX: 200, clientY: 80, metaKey: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.binds.length, 1);
  assert.equal(calls.binds[0].data.sid, "sid-1");

  // Plain non-list line is rejected by resolveListItemFromElement.
  lineTexts.push("普通正文段落");
  const plainLine = cmEditor.createDiv({ cls: "cm-line" });
  assert.equal(resolveListItemFromElement(plainLine, fakePlugin, () => fakeView), null);

  cleanup();
});

test("explicitAgent card drop overrides conflicting @other_agent while keeping matching @agent/model", async () => {
  const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("  async delegateDrop(");
  const end = mainSource.indexOf("\n  async gripSend(", start);
  const sent = [];
  const fakePlugin = {
    settings: deepMerge(DEFAULTS, {}),
    app: {},
    agentEnabled: () => true,
    modelsFor: (id) => (id === "claude" ? [{ id: "claude-sonnet-5", name: "Sonnet 5" }] : []),
    modelEnabled: () => true,
    defaultModel: (id) => DEFAULTS.delegate[id]?.model || "",
    notice(msg) { throw new Error("unexpected notice: " + msg); },
    refreshUI() {},
    delegateTarget: async (item) => ({
      file: { path: item.path },
      lines: [item.lineText],
      line: 0,
      block: { start: 0, end: 0, indent: 0, text: item.lineText },
    }),
    delegator: {
      delegate: async (opts) => sent.push(opts),
    },
  };
  const ctx = {
    canDelegateDrop,
    delegationText: () => "",
    taskMention,
    mentionTrigger: () => "@",
    mentionOptions,
    hasAgentCapability: () => false,
    defaultDestination: () => "desktop",
    t: (s) => s,
  };
  const fn = vm.runInNewContext(`({${mainSource.slice(start, end)}})`, ctx).delegateDrop.bind(fakePlugin);

  // Conflicting @codex on a line dragged onto Claude card -> routes to Claude.
  await fn("claude", { path: "note.md", line: 0, lineText: "- TODO 检查日志 @codex" }, null, {
    confirmed: true,
    expectedText: "",
    explicitAgent: true,
  });
  assert.equal(sent[0].agent, "claude");

  // Matching @claude/claude-sonnet-5 on a line dragged onto Claude card -> preserves model!
  await fn("claude", { path: "note.md", line: 0, lineText: "- TODO 检查日志 @claude/claude-sonnet-5" }, null, {
    confirmed: true,
    expectedText: "",
    explicitAgent: true,
  });
  assert.equal(sent[1].agent, "claude");
  assert.equal(sent[1].model, "claude-sonnet-5");

  // Multi-mention line dropped with explicitAgent: true onto dsh -> does not throw!
  await fn("dsh", { path: "note.md", line: 0, lineText: "- TODO 对比 @claude 和 @codex" }, null, {
    confirmed: true,
    expectedText: "",
    explicitAgent: true,
  });
  assert.equal(sent[2].agent, "dsh");
  assert.equal(stripTaskMention("- TODO 对比 @claude 和 @codex"), "- TODO 对比 @claude 和 @codex");
  assert.ok(blockTitle({ text: "- TODO 对比 @claude 和 @codex" }).includes("对比"));
});

test("AgentDeckView defers render during drag, protects pending sessionCard, and saves default drop hint", async () => {
  const bound = [];
  const plugin = {
    settings: deepMerge(DEFAULTS, {}),
    jobs: {},
    views: new Set(),
    agentEnabled: () => true,
    isPrimary: () => false,
    liveSessions: () => [],
    recentSessions: () => [],
    usage: { meta: new Map(), subsOf: () => [] },
    store: { get: () => null },
    acceptsItemDrag: (e) => Boolean(e._itemDrag),
    readItemDrag: (e) => e._itemDrag,
    bindItemToSession: (item, data) => bound.push({ item, data }),
    openConversation() {},
    openSession() {},
  };
  const view = new AgentDeckView({ app: {}, contentEl: makeDomElement("div"), containerEl: { isShown: () => true } }, plugin);
  view.renderSessions = () => {};

  const prevDocument = globalThis.document;
  const fakeBody = makeDomElement("body");
  fakeBody.classList.add("ad-dragging-item");
  globalThis.document = { body: fakeBody };
  try {
    view.render();
    assert.equal(view._pendingRender, true);
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }

  const grid = makeDomElement("div");
  view.agentCard(grid, "claude", null, "grid");
  assert.equal(grid.children[0].dataset.dropHintDefault, "委派给 Claude");

  const sessWrap = makeDomElement("div");
  view.sessionCard(sessWrap, {
    agent: "claude",
    sid: "job-pending-1",
    title: "Pending Job",
    isPendingJob: true,
    job: { id: "job-pending-1", sessionId: "" },
    lastAt: Date.now(),
    state: "starting",
  }, true);
  const pendingCard = sessWrap.children[0];
  assert.equal(pendingCard.dataset.pending, "1");
  assert.equal(pendingCard.classList.contains("is-no-drop"), true);
  let prevented = false;
  const dt = { dropEffect: "copy" };
  pendingCard.dispatchEvent("dragover", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    dataTransfer: dt,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  assert.equal(dt.dropEffect, "none");
  pendingCard.dispatchEvent("drop", {
    _itemDrag: { path: "note.md", line: 0, lineText: "- TODO task" },
    preventDefault() {},
  });
  assert.equal(bound.length, 0);
});

test("installListDragBridge guards bullet fast-flick, trusted buttons:0, dragstart, vanilla no-drop selection, and pending sessions", async () => {
  const root = makeDomElement("div");
  const body = root.createDiv({ cls: "" });
  const editorWrap = body.createDiv({ cls: "markdown-source-view mod-cm6" });
  const contentEl = editorWrap.createDiv({ cls: "cm-content" });
  const cmEditor = contentEl.createDiv({ cls: "cm-editor" });

  const ulLine = cmEditor.createDiv({ cls: "cm-line bullet-plugin-dragging-source-line" });
  const ulBullet = ulLine.createSpan({ cls: "cm-formatting cm-formatting-list cm-formatting-list-ul" });
  ulBullet.createSpan({ cls: "list-bullet", text: "-" });

  const sidebar = body.createDiv({ cls: "ad-view" });
  const claudeCard = sidebar.createDiv({ cls: "ad-agentcard", attr: { "data-agent": "claude", "data-drop-hint": "委派给 Claude" } });
  const grokCard = sidebar.createDiv({ cls: "ad-agentcard is-no-drop", attr: { "data-agent": "grokbot", "data-drop-hint": "暂不支持委派" } });
  const pendingSess = sidebar.createDiv({ cls: "ad-sess is-no-drop", attr: { "data-sid": "job-1", "data-pending": "1" } });

  let currentHit = contentEl;
  let selEmpty = false;
  let selectionCleared = false;
  const dispatchedSyncMoves = [];
  const fakeDoc = {
    body,
    addEventListener: body.addEventListener.bind(body),
    removeEventListener: body.removeEventListener.bind(body),
    dispatchEvent(ev) {
      dispatchedSyncMoves.push({ type: ev.type, clientX: ev.clientX, clientY: ev.clientY });
      return body.dispatchEvent(ev.type, ev);
    },
    elementFromPoint: () => currentHit,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  const fakeWin = {
    addEventListener() {},
    removeEventListener() {},
    getSelection() { return { removeAllRanges() { selectionCleared = true; } }; },
  };
  const fakeView = {
    state: {
      field: () => ({ file: { path: "日记/2026_11_25.md" } }),
      doc: {
        lineAt: () => ({ number: 1, text: "- TODO 测试项", from: 0 }),
        line: () => ({ number: 1, text: "- TODO 测试项", from: 0 }),
      },
      selection: { main: { get empty() { return selEmpty; }, from: 0, to: 8 } },
    },
    posAtDOM: () => 0,
    dispatch(tr) { if (tr?.selection) selEmpty = true; },
  };
  let deferredRenders = 0;
  const deferredView = { _pendingRender: true, render() { deferredRenders++; this._pendingRender = false; } };
  const calls = { delegates: [], binds: [] };
  const fakePlugin = {
    editorInfoField: "editorInfo",
    views: new Set([deferredView]),
    delegateDrop: (agent, item, fromEl, opts) => calls.delegates.push({ agent, item, opts }),
    bindItemToSession: (item, data) => calls.binds.push({ item, data }),
  };

  const cleanup = installListDragBridge(fakePlugin, {
    doc: fakeDoc,
    win: fakeWin,
    findView: () => fakeView,
    resolveDropMeta: (id, metaKey) => agentDropMeta({ settings: {} }, id, metaKey),
  });

  // 1. Bullet mode fast flick directly onto sidebar dispatches mousemove sync without re-entrancy & flushes pending renders.
  body.classList.add("bullet-plugin-dnd", "bullet-plugin-dragging");
  currentHit = contentEl;
  body.dispatchEvent("mousemove", { clientX: 20, clientY: 20, metaKey: false });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  currentHit = claudeCard;
  body.dispatchEvent("mouseup", { clientX: 210, clientY: 30, metaKey: false });
  assert.equal(dispatchedSyncMoves.length, 1);
  assert.equal(dispatchedSyncMoves[0].clientX, 210);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.delegates.length, 1);
  assert.equal(deferredRenders, 1);

  // 2. Trusted mousemove with buttons: 0 clears active bullet drag.
  currentHit = contentEl;
  body.dispatchEvent("mousemove", { clientX: 30, clientY: 30, metaKey: false });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  body.dispatchEvent("mousemove", { isTrusted: true, buttons: 0, clientX: 35, clientY: 35 });
  assert.equal(body.classList.contains("ad-dragging-item"), false);

  // 3. dragstart clears active drag immediately.
  currentHit = contentEl;
  body.dispatchEvent("mousemove", { clientX: 30, clientY: 30, metaKey: false });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  body.dispatchEvent("dragstart", {});
  assert.equal(body.classList.contains("ad-dragging-item"), false);

  // 4. Vanilla drop onto grayed .is-no-drop card clears editor selection without delegating.
  body.classList.remove("bullet-plugin-dnd", "bullet-plugin-dragging");
  selEmpty = false;
  selectionCleared = false;
  currentHit = ulBullet;
  body.dispatchEvent("mousedown", { button: 0, clientX: 10, clientY: 10, target: ulBullet });
  currentHit = grokCard;
  body.dispatchEvent("mousemove", { clientX: 200, clientY: 50, metaKey: false });
  body.dispatchEvent("mouseup", { clientX: 200, clientY: 50, metaKey: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(selectionCleared, true);
  assert.equal(selEmpty, true);
  assert.equal(calls.delegates.length, 1);

  // 5. Vanilla drop onto pending session card does not call bindItemToSession.
  currentHit = ulBullet;
  body.dispatchEvent("mousedown", { button: 0, clientX: 10, clientY: 10, target: ulBullet });
  currentHit = pendingSess;
  body.dispatchEvent("mousemove", { clientX: 200, clientY: 90, metaKey: false });
  assert.equal(pendingSess.classList.contains("is-drop"), false);
  body.dispatchEvent("mouseup", { clientX: 200, clientY: 90, metaKey: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.binds.length, 0);

  cleanup();
});

test("noteDragItem clears _dragItem on non-card drop, restores data-drop-hint, and flushes deferred renders", async () => {
  const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("  noteDragItem(");
  const end = mainSource.indexOf("\n  acceptsItemDrag(", start);

  const root = makeDomElement("div");
  const body = root.createDiv({ cls: "" });
  const card = body.createDiv({
    cls: "ad-agentcard is-drop is-cli is-drop-blocked",
    attr: { "data-agent": "claude", "data-drop-hint": "在终端里开 Claude", "data-drop-hint-default": "委派给 Claude" },
  });
  const fakeDoc = {
    body,
    addEventListener: body.addEventListener.bind(body),
    removeEventListener: body.removeEventListener.bind(body),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  const deferredView = { _pendingRender: true, rendered: 0, render() { this.rendered++; this._pendingRender = false; } };
  const fakePlugin = {
    views: new Set([deferredView]),
    _dragItem: null,
    _dragCleanup: null,
  };
  const fn = vm.runInNewContext(`({${mainSource.slice(start, end)}})`, { document: fakeDoc, setTimeout }).noteDragItem.bind(fakePlugin);

  fn({ path: "note.md", line: 0, lineText: "- TODO task" });
  assert.equal(body.classList.contains("ad-dragging-item"), true);
  assert.ok(fakePlugin._dragItem);

  // Drop outside cards (non-card drop triggers capture listener)
  body.dispatchEvent("drop", { type: "drop" });
  assert.equal(body.classList.contains("ad-dragging-item"), false);
  assert.equal(card.classList.contains("is-drop"), false);
  assert.equal(card.classList.contains("is-cli"), false);
  assert.equal(card.classList.contains("is-drop-blocked"), false);
  assert.equal(card.getAttribute("data-drop-hint"), "委派给 Claude");
  // Wait for deferred setTimeout(..., 0)
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fakePlugin._dragItem, null);
  assert.equal(deferredView.rendered, 1);
});

test("parseLink fast-exits plain lines, decodes malformed URI safely, and installListDragBridge deduplicates hover work", () => {
  assert.equal(J.parseLink("plain text without link"), null);
  assert.deepEqual(
    J.parseLink("- 🔗 [OpenCode：test](obsidian://agent-deck?do=open&agent=opencode&sid=bad%ZZ)"),
    { agent: "opencode", sid: "bad%ZZ", title: "test" },
  );

  const root = makeDomElement("div");
  const body = root.createDiv({ cls: "" });
  const editorWrap = body.createDiv({ cls: "markdown-source-view mod-cm6" });
  const contentEl = editorWrap.createDiv({ cls: "cm-content" });
  const cmEditor = contentEl.createDiv({ cls: "cm-editor" });
  const ulLine = cmEditor.createDiv({ cls: "cm-line bullet-plugin-dragging-source-line" });
  const sidebar = body.createDiv({ cls: "ad-view" });
  const claudeCard = sidebar.createDiv({ cls: "ad-agentcard", attr: { "data-agent": "claude", "data-drop-hint": "委派给 Claude" } });

  let currentHit = contentEl;
  let resolveCount = 0;
  const fakeDoc = {
    body,
    addEventListener: body.addEventListener.bind(body),
    removeEventListener: body.removeEventListener.bind(body),
    elementFromPoint: () => currentHit,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  const fakeView = {
    state: {
      field: () => ({ file: { path: "日记/2026_11_25.md" } }),
      doc: { lineAt: () => ({ number: 1, text: "- TODO 重复悬停", from: 0 }) },
      selection: { main: { empty: true, from: 0, to: 0 } },
    },
    posAtDOM: () => 0,
  };
  const cleanup = installListDragBridge({ editorInfoField: "editorInfo" }, {
    doc: fakeDoc,
    win: { addEventListener() {}, removeEventListener() {} },
    findView: () => fakeView,
    resolveDropMeta: (id, metaKey) => {
      resolveCount++;
      return agentDropMeta({ settings: {} }, id, metaKey);
    },
  });

  body.classList.add("bullet-plugin-dnd", "bullet-plugin-dragging");
  currentHit = claudeCard;
  body.dispatchEvent("mousemove", { clientX: 200, clientY: 20, metaKey: false });
  body.dispatchEvent("mousemove", { clientX: 202, clientY: 22, metaKey: false });
  body.dispatchEvent("mousemove", { clientX: 204, clientY: 24, metaKey: false });
  assert.equal(resolveCount, 1);
  assert.equal(claudeCard.classList.contains("is-cli"), false);

  body.dispatchEvent("mousemove", { clientX: 204, clientY: 24, metaKey: true });
  assert.equal(resolveCount, 2);
  assert.equal(claudeCard.classList.contains("is-cli"), true);
  cleanup();
});
