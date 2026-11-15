import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class ItemView{constructor(l){Object.assign(this,l)}registerEvent(){}};export class Menu{};export class Modal{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const { sessionProjectName } = await import("../src/readers.js");
const J = await import("../src/journal.js");
const { AutoLog } = await import("../src/autolog.js");
const { AGENT_ORDER } = await import("../src/constants.js");

const viewStubs = {
  obsidian: "export class ItemView{constructor(l){Object.assign(this,l)}registerEvent(){}};export class Menu{};export class Modal{};",
  "./icons.js": "export function agentIcon(){};export function setLucide(){};export function stateIcon(){};",
  "./lattice.js": "export function lattice(){};",
  "./editor.js": 'export const SESSION_MIME="test";',
};
const viewBundle = await esbuild.build({
  entryPoints: [path.resolve(import.meta.dirname, "../src/view.js")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "view-mock",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (viewStubs[a.path] ? { path: a.path, namespace: "ui" } : undefined));
        b.onLoad({ filter: /.*/, namespace: "ui" }, (a) => ({ contents: viewStubs[a.path] }));
      },
    },
  ],
});
const viewTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-recent-view-"));
const viewFile = path.join(viewTmpDir, "view.mjs");
fs.writeFileSync(viewFile, viewBundle.outputFiles[0].text);
test.after(() => fs.rmSync(viewTmpDir, { recursive: true, force: true }));
const {
  AgentDeckView,
  filterRecentRows,
  planRecentDisplay,
  MAX_RECENT_CARDS,
  RECENT_DAY_OPTIONS,
} = await import(pathToFileURL(viewFile));

test("sessionProjectName distinguishes concrete workspace folders from standalone/scratch sessions", () => {
  assert.equal(sessionProjectName(""), "");
  assert.equal(sessionProjectName("~"), "");
  assert.equal(sessionProjectName("/"), "");
  assert.equal(sessionProjectName(os.homedir()), "");
  assert.equal(sessionProjectName("/Users/x/Documents/Codex/2026-11-13/w-s"), "");
  assert.equal(sessionProjectName("/Users/x/Documents/deepseek-harness/default-workspace"), "");
  assert.equal(sessionProjectName("/Users/x/.dsh/sessions/abc"), "");
  assert.equal(sessionProjectName("/Users/x/.gemini/antigravity/brain/conv-1"), "");
  assert.equal(sessionProjectName("/Users/x/WorkBuddy/2026-11-15/session-1"), "");

  assert.equal(sessionProjectName("/Users/x/claude/agent-deck"), "agent-deck");
  assert.equal(sessionProjectName("/Users/x/claude/agent-deck/.claude/worktrees/feat-x"), "agent-deck");
  assert.equal(sessionProjectName("/Users/x/work/antigravity-demo"), "antigravity-demo");
});

test("formatProjectAutoTitle prepends '项目名 -> ' cleanly without chopping project name or doubling", () => {
  assert.equal(J.formatProjectAutoTitle("修复 Cursor 追踪状态", "agent-deck"), "agent-deck -> 修复 Cursor 追踪状态");
  assert.equal(
    J.formatProjectAutoTitle("agent-deck -> 修复 Cursor 追踪状态", "agent-deck"),
    "agent-deck -> 修复 Cursor 追踪状态",
  );
  assert.equal(
    J.formatProjectAutoTitle("very-long-workspace-folder-name -> 实现新功能并运行全量测试", "very-long-workspace-folder-name"),
    "very-long-workspace-folder-name -> 实现新功能并运行全量测试",
  );
  assert.equal(J.formatProjectAutoTitle("单独聊两句", ""), "单独聊两句");
});

test("AutoLog prefixes project folder titles across all agents and keeps standalone/manual titles untouched", async () => {
  const folderSess = AGENT_ORDER.map((agent, i) => ({
    sid: `s-folder-${agent}`,
    agent,
    cwd: `/Users/x/work/proj-${agent}`,
    title: `完成 ${agent} 功能`,
    text: `完成 ${agent} 功能`,
    min: 10,
    segs: [[60 + i, 70 + i]],
  }));
  const standaloneSess = [
    {
      sid: "s-agy-solo",
      agent: "antigravity",
      cwd: "/Users/x/.gemini/antigravity/brain/solo-1",
      title: "单开 Antigravity 会话",
      text: "单开 Antigravity 会话",
      min: 8,
      segs: [[90, 98]],
    },
    {
      sid: "s-dsh-solo",
      agent: "dsh",
      cwd: "/Users/x/.dsh/sessions/solo-2",
      title: "单开 DSH 会话",
      text: "单开 DSH 会话",
      min: 8,
      segs: [[100, 108]],
    },
  ];
  const all = [...folderSess, ...standaloneSess];
  const meta = new Map(all.map((s) => [s.sid, { cwd: s.cwd, state: "wait", lastText: "已完成" }]));
  let noteText = "---\n正在做\n\n---\n还要做\n\n---\n已完成\n---\n";

  const plugin = {
    settings: { autoLogPath: "/definitely-missing-cli/claude", autoLogFallback: true, autoLogBatch: 20 },
    jobs: {},
    saveSettings: async () => {},
    usage: {
      meta,
      archivedClaude: new Set(),
      archived: new Set(),
      summary: () => ({ list: all }),
    },
    app: {
      vault: {
        getAbstractFileByPath: () => ({ path: "日记/2026-11-15.md", extension: "md" }),
        read: async () => noteText,
        process: async (_f, fn) => {
          noteText = fn(noteText);
          return noteText;
        },
      },
      workspace: { iterateAllLeaves() {} },
    },
  };

  const al = new AutoLog(plugin);
  await al.run({ fallback: true, manual: true });

  for (const agent of AGENT_ORDER) {
    assert.ok(noteText.includes(`proj-${agent} -> 完成 ${agent} 功能`), `${agent} folder session receives project prefix`);
  }
  assert.ok(noteText.includes("🤖 01:30-01:38 单开 Antigravity 会话"));
  assert.ok(!noteText.includes("Antigravity ->"), "standalone antigravity session must not get prefix");
  assert.ok(noteText.includes("🤖 01:40-01:48 单开 DSH 会话"));
  assert.ok(!noteText.includes("DSH ->"), "standalone DSH session must not get prefix");

  // Re-running with user-edited title preserves manual edits without re-prefixing.
  noteText = noteText.replace("proj-cursor -> 完成 cursor 功能", "我手动改过的 Cursor 标题");
  await al.run({ fallback: true, manual: true });
  assert.ok(noteText.includes("我手动改过的 Cursor 标题"), "user-edited title stays intact");
  assert.ok(!noteText.includes("proj-cursor -> 我手动改过的"));
});

test("planRecentDisplay stacks by agent, allows multi-expand, flattens single-agent filter and enforces 30-card cap", () => {
  assert.deepEqual(RECENT_DAY_OPTIONS, [7, 30, 120]);
  assert.equal(MAX_RECENT_CARDS, 30);

  const mk = (agent, count, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({
      sid: `${agent}-${i}`,
      agent,
      state: i === 0 ? "run" : "wait",
      lastAt: Date.now() - (offset + i) * 60000,
      title: `${agent} task ${i}`,
    }));

  const rows = [...mk("claude", 25, 0), ...mk("codex", 20, 30), ...mk("cursor", 1, 60)];

  // Collapsed default: 1 card per group -> 3 cards total, multi-item groups are stacked.
  const collapsed = planRecentDisplay(rows, { filter: "all", expanded: new Set(), maxCards: 30 });
  assert.equal(collapsed.mode, "grouped");
  assert.equal(collapsed.renderedCount, 3);
  assert.equal(collapsed.groups[0].stacked, true);
  assert.equal(collapsed.groups[1].stacked, true);
  assert.equal(collapsed.groups[2].stacked, false);

  // Expanding both large groups simultaneously respects strict 30-card screen limit.
  const bothOpen = planRecentDisplay(rows, { filter: "all", expanded: new Set(["claude", "codex"]), maxCards: 30 });
  assert.equal(bothOpen.renderedCount, 30);
  assert.equal(bothOpen.groups[0].visibleItems.length, 25);
  assert.equal(bothOpen.groups[1].visibleItems.length, 4);
  assert.equal(bothOpen.groups[1].unshownCount, 16);
  assert.equal(bothOpen.groups[2].visibleItems.length, 1);

  // Single-agent filter switches to flat mode, also capped at 30.
  const flatRows = filterRecentRows(mk("claude", 42), "claude");
  const flat = planRecentDisplay(flatRows, { filter: "claude", expanded: new Set(), maxCards: 30 });
  assert.equal(flat.mode, "flat");
  assert.equal(flat.renderedCount, 30);
  assert.equal(flat.hiddenCount, 12);
});

class MockDomNode {
  constructor(tag = "div", opts = {}) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.classes = new Set(String(opts.cls || "").split(/\s+/).filter(Boolean));
    this.textContent = opts.text ?? "";
    this.style = { setProperty() {} };
    this.parentElement = null;
    this.listeners = {};
    if (opts.attr) {
      for (const [k, v] of Object.entries(opts.attr)) {
        this.attrs[k] = String(v);
        if (k === "value") this.value = String(v);
      }
    }
  }
  get firstElementChild() { return this.children[0] || null; }
  addClass(c) { for (const k of String(c).split(/\s+/).filter(Boolean)) this.classes.add(k); }
  removeClass(c) { for (const k of String(c).split(/\s+/).filter(Boolean)) this.classes.delete(k); }
  toggleClass(c, on) { if (on) this.addClass(c); else this.removeClass(c); }
  hasClass(c) { return this.classes.has(c); }
  empty() { this.children = []; this.textContent = ""; }
  createEl(tag, opts = {}) {
    const n = new MockDomNode(tag, opts);
    n.parentElement = this;
    this.children.push(n);
    return n;
  }
  createDiv(opts = {}) { return this.createEl("div", opts); }
  createSpan(opts = {}) { return this.createEl("span", opts); }
  setAttr(k, v) { this.attrs[k] = String(v); }
  setText(v) { this.textContent = String(v); }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  querySelectorAll(sel) {
    const cls = sel.startsWith(".") ? sel.slice(1) : "";
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (!cls || c.classes.has(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

test("AgentDeckView renders 7/30/120 switcher, stacks by agent with click expand and never renders >30 cards", () => {
  globalThis.document = { activeElement: null };
  try {

    const mk = (agent, count, baseAt) =>
      Array.from({ length: count }, (_, i) => ({
        sid: `${agent}-${i}`,
        agent,
        state: "wait",
        lastAt: baseAt - i * 1000,
        title: `${agent} session ${i}`,
        cwd: `/tmp/${agent}`,
      }));

    const calls = [];
    const saved = { ui: { recentDays: 7, agentCards: { order: [...AGENT_ORDER], hidden: [], pinned: [] } } };
    const plugin = {
      views: new Set(),
      settings: saved,
      jobs: {},
      usage: { subsOf: () => [] },
      store: { get: () => null, range: () => [] },
      agentEnabled: () => true,
      isPrimary: () => false,
      liveSessions: () => [],
      recentSessions({ days }) {
        calls.push(days);
        const now = Date.now();
        if (days === 7) return [...mk("claude", 4, now), ...mk("codex", 3, now - 50000)];
        return [...mk("claude", 26, now), ...mk("codex", 26, now - 50000), ...mk("cursor", 2, now - 90000)];
      },
      saveSettings: async () => {},
      acceptsItemDrag: () => false,
      openSession: () => {},
      openConversation: () => {},
    };

    const contentEl = new MockDomNode("div");
    const leaf = { containerEl: { isShown: () => true }, contentEl };
    const view = new AgentDeckView(leaf, plugin);
    view.render();

    assert.equal(calls[0], 7);
    const recSec = contentEl.querySelector(".ad-sec--recent");
    assert.equal(recSec.querySelectorAll(".ad-sess").length, 2, "collapsed renders only 1 top card per agent");
    assert.equal(recSec.querySelectorAll(".ad-stack").length, 2);

    // Click top card of claude stack -> expands claude to all 4 cards while codex stays stacked (4 + 1 = 5).
    recSec.querySelectorAll(".ad-stack")[0].querySelector(".ad-sess").onclick();
    assert.equal(recSec.querySelectorAll(".ad-sess").length, 5);

    // Switch to 120d -> saves setting & renders <= 30 cards across multi-expanded huge stacks.
    const rangeBtns = recSec.querySelectorAll(".ad-range__btn");
    assert.equal(rangeBtns.length, 3);
    rangeBtns[2].onclick();
    assert.equal(plugin.settings.ui.recentDays, 120);
    assert.equal(calls.at(-1), 120);

    // Re-query recSec after full render.
    const recSec120 = contentEl.querySelector(".ad-sec--recent");
    // Expand codex as well (claude already expanded with 26 items, codex has 26, cursor has 2).
    const stacks120 = recSec120.querySelectorAll(".ad-stack");
    stacks120[1].querySelector(".ad-stack__bar").onclick();
    assert.equal(recSec120.querySelectorAll(".ad-sess").length, 30, "page never renders more than 30 recent session cards");
  } finally {
    delete globalThis.document;
  }
});

test("Collapsing a high-positioned recent stack keeps its viewport Y anchored and sheds bottom slack on scroll up", async () => {
  globalThis.document = { activeElement: null };
  try {
    const mk = (agent, count, baseAt) =>
      Array.from({ length: count }, (_, i) => ({
        sid: `${agent}-${i}`,
        agent,
        state: "wait",
        lastAt: baseAt - i * 1000,
        title: `${agent} session ${i}`,
        cwd: `/tmp/${agent}`,
      }));

    class ScrollMockNode extends MockDomNode {
      constructor(tag = "div", opts = {}) {
        super(tag, opts);
        this.props = {};
        const self = this;
        this.style = {
          setProperty(k, v) { self.props[k] = String(v); },
        };
        this._scrollTop = 0;
        this._clientHeight = 700;
      }
      createEl(tag, opts = {}) {
        const n = new ScrollMockNode(tag, opts);
        n.parentElement = this;
        this.children.push(n);
        return n;
      }
      get clientHeight() { return this._clientHeight; }
      get scrollHeight() {
        const dash = this.querySelector(".ad-dash");
        if (!dash) return this._clientHeight;
        const slack = parseFloat(dash.props["--ad-slack"] || "0") || 0;
        const stacks = dash.querySelectorAll(".ad-stack");
        const sessTotal = stacks.reduce((sum, st) => sum + (st.hasClass("is-expanded") ? st.querySelectorAll(".ad-sess").length * 60 + 40 : 90), 0);
        return Math.max(this._clientHeight, 760 + sessTotal + 38 + slack);
      }
      get scrollTop() {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        if (this._scrollTop > max) this._scrollTop = max;
        return this._scrollTop;
      }
      set scrollTop(v) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        this._scrollTop = Math.max(0, Math.min(max, Number(v) || 0));
      }
      getBoundingClientRect() {
        if (this.classes.has("ad-view")) return { top: 0 };
        if (this.classes.has("ad-stack")) {
          let root = this;
          while (root && !root.classes.has("ad-view")) root = root.parentElement;
          const stacks = root.querySelectorAll(".ad-stack");
          let contentTop = 760;
          for (const st of stacks) {
            if (st === this) break;
            contentTop += st.hasClass("is-expanded") ? st.querySelectorAll(".ad-sess").length * 60 + 40 + 5 : 95;
          }
          return { top: contentTop - root.scrollTop };
        }
        return { top: 0 };
      }
    }

    const now = Date.now();
    const saved = { ui: { recentDays: 30, agentCards: { order: [...AGENT_ORDER], hidden: [], pinned: [] } } };
    const plugin = {
      views: new Set(),
      settings: saved,
      jobs: {},
      usage: { subsOf: () => [] },
      store: { get: () => null, range: () => [] },
      agentEnabled: () => true,
      isPrimary: () => false,
      liveSessions: () => [],
      recentSessions: () => [...mk("claude", 20, now), ...mk("codex", 2, now - 50000)],
      saveSettings: async () => {},
      acceptsItemDrag: () => false,
      openSession: () => {},
      openConversation: () => {},
    };

    const contentEl = new ScrollMockNode("div");
    const leaf = {
      containerEl: { isShown: () => true },
      contentEl,
      app: { workspace: { on: () => ({}) } },
    };
    const view = new AgentDeckView(leaf, plugin);
    view.app = leaf.app;
    await view.onOpen();

    // Expand Claude (20 sessions) and scroll so Claude's top bar sits high in the viewport (relTop = 60).
    const claudeBefore = contentEl.querySelectorAll(".ad-stack")[0];
    claudeBefore.querySelector(".ad-stack__bar").onclick();
    contentEl.scrollTop = 700;
    for (const fn of contentEl.listeners.scroll || []) fn();

    const claudeExpanded = contentEl.querySelectorAll(".ad-stack")[0];
    const relTopBefore = claudeExpanded.getBoundingClientRect().top - contentEl.getBoundingClientRect().top;
    assert.equal(relTopBefore, 60);

    // Click "收起 ▴" -> stack collapses, viewport Y stays 60 (zero jump) instead of clamping down.
    claudeExpanded.querySelector(".ad-stack__head").onclick();
    const claudeCollapsed = contentEl.querySelectorAll(".ad-stack")[0];
    const relTopAfter = claudeCollapsed.getBoundingClientRect().top - contentEl.getBoundingClientRect().top;
    assert.equal(relTopAfter, 60);
    assert.equal(contentEl.scrollTop, 700);
    assert.ok(view._bottomSlack > 0);

    // Background render preserves anchor while user stays scrolled there.
    view.render();
    assert.equal(contentEl.scrollTop, 700);
    assert.equal(
      contentEl.querySelectorAll(".ad-stack")[0].getBoundingClientRect().top - contentEl.getBoundingClientRect().top,
      60,
    );

    // Scrolling back up sheds the extra bottom slack down to 0.
    contentEl.scrollTop = 200;
    for (const fn of contentEl.listeners.scroll || []) fn();
    assert.equal(view._bottomSlack, 0);
    assert.equal(contentEl.querySelector(".ad-dash").props["--ad-slack"], "0px");
  } finally {
    delete globalThis.document;
  }
});
