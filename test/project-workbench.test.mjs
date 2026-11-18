import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";
import esbuild from "esbuild";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class ItemView{constructor(l){Object.assign(this,l)}registerEvent(){}};export class Menu{};export class Modal{};export class Component{load(){return this}unload(){}};export const MarkdownRenderer={render:async()=>{}};',shortCircuit:true};return n(s,c)}`,
    ),
);

const {
  STANDALONE_PROJECT_ID,
  buildProjectGroups,
  buildNowStatusGroups,
  nowStatusOf,
  planRecentProjectDisplay,
  isWaitingSession,
  isActiveNowSession,
  WAIT_ACTIVE_MS,
  resolveTeamPresets,
  assignTeamToRoles,
  buildCopilotPlanPrompt,
  parseCopilotPlanResponse,
  fallbackCopilotPlan,
  formatWorkbenchTasksMarkdown,
  insertWorkbenchBlockLines,
  extractTaskBoardGroups,
  buildTaskBoardModel,
  moveTaskBoardCardStatus,
  insertTaskBoardCard,
  setTaskBoardCardAgent,
  moveTaskBoardCardSubtree,
  boardCardPinId,
  boardCardPinKey,
  sortBoardCardsByPins,
  applyTaskBoardPins,
  deleteTaskBoardCards,
  buildBoardSiblingContext,
  MAX_STEWARD_ROUNDS,
  resolveStewardConfig,
  createWorkbenchWave,
  syncWaveWithState,
  collectWaveWorkerReports,
  buildStewardPrompt,
  parseStewardOutcome,
  appendSubtasksToParentBlock,
  setTaskBlockKeywordById,
  updateTaskBlockStatusById,
  findActiveWaveForBoard,
} = await import("../src/project-workbench.js");
const { AGENT_ORDER } = await import("../src/constants.js");
const { buildDelegationPayload } = await import("../src/harness.js");
const { journalSources } = await import("../src/analytics.js");
const { evidenceBlocks } = await import("../src/dream.js");
const { aiRecordGroups } = await import("../src/ai-records.js");
const { parseMirrorRef } = await import("../src/outline.js");
const {
  SHOWCASE_VERSION,
  SHOWCASE_BOARD_KEY,
  SHOWCASE_MIRROR_SOURCE_KEY,
  SHOWCASE_RECORD_KEYS,
  showcasePath,
  applyShowcaseDefaults,
  buildShowcaseMarkdown,
} = await import("../src/welcome-demo.js");

test("buildProjectGroups aggregates multi-agent sessions and pending jobs by project", () => {
  const now = Date.now();
  const sessions = [
    { sid: "s1", agent: "claude", state: "wait", cwd: "/Users/x/work/alpha", lastAt: now - 5000, title: "Auth API" },
    { sid: "s2", agent: "codex", state: "run", cwd: "/Users/x/work/alpha/.claude/worktrees/fix-1", lastAt: now - 1000, title: "Tests" },
    { sid: "s3", agent: "opencode", state: "needs-approval", cwd: "/Users/x/work/beta", lastAt: now - 2000, title: "Migration" },
    { sid: "s4", agent: "dsh", state: "wait", cwd: "/Users/x/.dsh/sessions/solo", lastAt: now - 500, title: "Scratch chat" },
  ];
  const jobs = {
    "j-pending": {
      id: "j-pending",
      agent: "qoder",
      name: "Pending docs",
      cwd: "/Users/x/work/alpha",
      state: "starting",
      startedAt: now - 200,
    },
    "j-run": {
      id: "j-run",
      agent: "codex",
      sessionId: "s2",
      name: "Tests",
      cwd: "/Users/x/work/alpha",
      state: "running",
      startedAt: now - 1000,
    },
  };

  const groups = buildProjectGroups(sessions, { jobs, agentEnabled: () => true });
  assert.equal(groups.length, 3);
  // beta has needs-approval -> attention sorts first.
  assert.equal(groups[0].name, "beta");
  assert.equal(groups[0].counts.attention, 1);
  // alpha merges claude + codex worktree + pending qoder job.
  assert.equal(groups[1].name, "alpha");
  assert.equal(groups[1].counts.total, 3);
  assert.equal(groups[1].counts.running, 2);
  assert.equal(groups[1].counts.waiting, 1);
  assert.deepEqual(groups[1].agents, ["claude", "codex", "qoder"]);
  assert.deepEqual(groups[1].activeJobIds.sort(), ["j-pending", "j-run"]);
  // standalone scratch directory goes last.
  assert.equal(groups[2].id, STANDALONE_PROJECT_ID);
  assert.equal(groups[2].isStandalone, true);
});

test("planRecentProjectDisplay groups by project and respects maxCards cap", () => {
  const now = Date.now();
  const rows = [
    ...Array.from({ length: 18 }, (_, i) => ({
      sid: `a-${i}`,
      agent: "claude",
      state: "wait",
      cwd: "/Users/x/work/proj-a",
      lastAt: now - i * 1000,
    })),
    ...Array.from({ length: 18 }, (_, i) => ({
      sid: `b-${i}`,
      agent: "codex",
      state: "wait",
      cwd: "/Users/x/work/proj-b",
      lastAt: now - 50000 - i * 1000,
    })),
  ];

  const collapsed = planRecentProjectDisplay(rows, { expanded: new Set(), maxCards: 30 });
  assert.equal(collapsed.groups.length, 2);
  assert.equal(collapsed.renderedCount, 2);
  assert.equal(collapsed.groups[0].stacked, true);

  const expanded = planRecentProjectDisplay(rows, { expanded: new Set(["proj-a", "proj-b"]), maxCards: 30 });
  assert.equal(expanded.renderedCount, 30);
  assert.equal(expanded.groups[0].visibleItems.length, 18);
  assert.equal(expanded.groups[1].visibleItems.length, 12);
  assert.equal(expanded.groups[1].unshownCount, 6);
});

test("team presets avoid disabled and hit-limit agents while copilot parser validates JSON", () => {
  const presets = resolveTeamPresets({});
  assert.ok(presets.length >= 5);
  for (const id of ["deep-research", "editorial"]) {
    const preset = presets.find((p) => p.id === id);
    assert.ok(preset, `knowledge-work preset ${id} exists`);
    assert.equal(preset.roles.length, 3, `${id} defines three distinct roles`);
  }
  const assigned = assignTeamToRoles(presets[0], {
    availableAgents: ["claude", "codex", "dsh"],
    limitAgents: new Set(["codex"]),
  });
  // codex is hit-limit so arch falls back to healthy claude; opencode isn't enabled so explore falls back too.
  assert.equal(assigned[0].agent, "claude");
  assert.equal(assigned[0].limited, true);
  assert.equal(assigned[0].fallbackFrom, "codex");

  const prompt = buildCopilotPlanPrompt({
    goal: "实现项目工作台",
    projectName: "agent-deck",
    roles: assigned,
    availableAgents: ["claude", "codex"],
  });
  assert.ok(prompt.includes("agent-deck"));

  const fenced = "```json\n" + JSON.stringify({
    summary: "拆解任务",
    subtasks: [
      { title: "搭建状态聚合层", role: "架构与后端", agent: "codex", detail: "覆盖单测" },
      { title: "接入不可用代理测试", role: "功能与集成", agent: "cursor", detail: "应回退" },
    ],
  }) + "\n```";
  const parsed = parseCopilotPlanResponse(fenced, {
    availableAgents: ["claude", "codex"],
    roles: assigned,
    defaultAgent: "claude",
  });
  assert.equal(parsed.subtasks.length, 2);
  assert.equal(parsed.subtasks[0].agent, "codex");
  assert.equal(parsed.subtasks[1].agent, "claude", "trackingOnly/unavailable agent falls back cleanly");

  const fb = fallbackCopilotPlan({
    goal: "- 第一步调研\n- 第二步编码",
    roles: assigned,
    defaultAgent: "claude",
  });
  assert.equal(fb.subtasks.length, 2);

  const md = formatWorkbenchTasksMarkdown({
    parentTitle: "项目迭代",
    subtasks: parsed.subtasks,
    includeParent: true,
    assignBlockIds: true,
  });
  assert.match(md, /^- TODO 项目迭代 \^[a-z0-9-]+\n\t- TODO 搭建状态聚合层 @codex \^[a-z0-9-]+\n\t\t- 覆盖单测/);

  const bounded = [
    "<!-- agent-deck:layout:start -->",
    "<!-- agent-deck:section:active:heading -->",
    "## 正在做",
    "- DOING 现有任务",
    "<!-- agent-deck:section:active:end -->",
    "<!-- agent-deck:layout:end -->",
  ];
  const placed = insertWorkbenchBlockLines(bounded, md.split("\n"));
  const activeEnd = placed.lines.indexOf("<!-- agent-deck:section:active:end -->");
  assert.ok(placed.parentLine < activeEnd && placed.parentLine === 4, "places workbench task inside active journal section");
});

test("Fractal board extractor, model classification, and keyword status moves stay lossless", () => {
  const note = [
    "- TODO 发布 v2 工作台 ^ad-parent-1",
    "  - TODO 梳理数据模型 @codex",
    "  - DOING 实现看板视图 @claude",
    "    - 💬 第1轮：已完成表格布局",
    "  - NEEDOK 等待用户确认权限",
    "  - [x] DONE 完成基础测试",
    "- TODO 只有一条子任务不算看板",
    "  - TODO 单子任务",
    "```md",
    "- TODO 代码块里的例子",
    "  - TODO 子项一",
    "  - TODO 子项二",
    "```",
  ].join("\n");

  const groups = extractTaskBoardGroups(note);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "发布 v2 工作台");
  assert.equal(groups[0].cards.length, 4);
  assert.equal(groups[0].cards[0].agent, "codex");
  assert.equal(groups[0].cards[1].latestConclusion, "已完成表格布局");

  const model = buildTaskBoardModel(groups[0], { jobs: {} });
  assert.deepEqual(model.columns.map((c) => c.cards.length), [1, 1, 1, 1]);
  assert.equal(model.todoDispatchCount, 1);

  const movedDoing = moveTaskBoardCardStatus(note, 1, "doing");
  assert.equal(movedDoing.split("\n")[1], "  - DOING 梳理数据模型 @codex");
  const movedCb = moveTaskBoardCardStatus(movedDoing, 5, "todo");
  assert.equal(movedCb.split("\n")[5], "  - [ ] TODO 完成基础测试");
  assert.equal(movedCb.split("\n")[9], "- TODO 代码块里的例子", "fenced example stays untouched");
});

test("AgentDeckView renders P0 project groups in Now and supports project grouping toggle in Recent", async () => {
  class MiniNode {
    constructor(tag = "div", opts = {}) {
      this.tagName = tag.toUpperCase();
      this.classes = new Set(String(opts.cls || "").split(/\s+/).filter(Boolean));
      this.textContent = opts.text ?? "";
      this.attrs = { ...(opts.attr || {}) };
      this.dataset = {};
      this.style = { setProperty() {} };
      this.children = [];
      this.parentElement = null;
    }
    addClass(...c) { for (const x of c) for (const k of String(x).split(/\s+/).filter(Boolean)) this.classes.add(k); }
    removeClass(...c) { for (const x of c) this.classes.delete(x); }
    toggleClass(c, f) { if (f) this.addClass(c); else this.removeClass(c); }
    setAttr(k, v) { this.attrs[k] = String(v); }
    empty() { this.children = []; this.textContent = ""; }
    createDiv(o) { return this.createEl("div", o); }
    createSpan(o) { return this.createEl("span", o); }
    createEl(tag, o = {}) {
      const n = new MiniNode(tag, o);
      n.parentElement = this;
      this.children.push(n);
      return n;
    }
    addEventListener() {}
    querySelectorAll(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      const out = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (cls && c.classes.has(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }

  const stubs = {
    obsidian: "export class ItemView{constructor(l){Object.assign(this,l)}registerEvent(){}};export class Menu{};export class Modal{};",
    "./icons.js": "export function agentIcon(){};export function setLucide(){};export function stateIcon(){};",
    "./lattice.js": "export function lattice(){};",
    "./editor.js": 'export const SESSION_MIME="test";',
  };
  const bundle = await esbuild.build({
    entryPoints: [path.resolve(import.meta.dirname, "../src/view.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    loader: { ".png": "dataurl" },
    write: false,
    plugins: [{
      name: "wb-view-mock",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "ui" } : undefined));
        b.onLoad({ filter: /.*/, namespace: "ui" }, (a) => ({ contents: stubs[a.path] }));
      },
    }],
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wb-view-"));
  const viewFile = path.join(tmpDir, "view.mjs");
  fs.writeFileSync(viewFile, bundle.outputFiles[0].text);
  globalThis.document = { activeElement: null };
  try {
    const { AgentDeckView } = await import(pathToFileURL(viewFile));
    const now = Date.now();
    const stopped = [];
    const openedWb = [];
    const plugin = {
      views: new Set(),
      settings: { ui: { recentDays: 7, agentCards: { order: [...AGENT_ORDER], hidden: [], pinned: [] } } },
      jobs: {
        j1: { id: "j1", agent: "claude", sessionId: "s1", name: "Task 1", cwd: "/Users/x/work/project-alpha", state: "running", startedAt: now },
      },
      usage: { subsOf: () => [] },
      store: { get: () => null, range: () => [] },
      agentEnabled: () => true,
      isPrimary: () => false,
      liveSessions: () => [
        { sid: "s1", agent: "claude", state: "run", cwd: "/Users/x/work/project-alpha", lastAt: now, title: "Task 1" },
        { sid: "s2", agent: "codex", state: "wait", cwd: "/Users/x/work/project-alpha", lastAt: now - 1000, title: "Task 2" },
        { sid: "s3", agent: "opencode", state: "limit", cwd: "/Users/x/work/project-beta", lastAt: now - 2000, title: "Task 3" },
      ],
      recentSessions: () => [
        { sid: "s1", agent: "claude", state: "run", cwd: "/Users/x/work/project-alpha", lastAt: now, title: "Task 1" },
        { sid: "s2", agent: "codex", state: "wait", cwd: "/Users/x/work/project-alpha", lastAt: now - 1000, title: "Task 2" },
        { sid: "s3", agent: "opencode", state: "run", cwd: "/Users/x/work/project-beta", lastAt: now - 2000, title: "Task 3" },
      ],
      saveSettings: async () => {},
      acceptsItemDrag: () => false,
      openSession: () => {},
      openConversation: () => {},
      openProjectWorkbench: (o) => openedWb.push(o),
      openProjectFolder: () => {},
      cancelProjectJobs: (id, ids) => stopped.push({ id, ids }),
    };

    const contentEl = new MiniNode("div");
    const view = new AgentDeckView({ containerEl: { isShown: () => true }, contentEl }, plugin);
    view.render();

    const nowGroups = contentEl.querySelectorAll(".ad-projgroup");
    assert.equal(nowGroups.length, 2, "Now section groups active sessions including limit/error by project");
    // project-beta has limit (attention) -> sorts first.
    assert.equal(nowGroups[0].dataset.project, "project-beta");
    assert.equal(nowGroups[1].dataset.project, "project-alpha");
    assert.equal(nowGroups[1].querySelectorAll(".ad-sess").length, 2);

    // Click workbench & stop buttons on project-alpha (actionBtns[0] is folder, [1] is workbench, [2] is stop).
    const actionBtns = nowGroups[1].querySelectorAll(".ad-iconbtn--xs");
    assert.equal(actionBtns.length, 3);
    actionBtns[1].onclick({ stopPropagation() {} });
    actionBtns[2].onclick({ stopPropagation() {} });
    assert.equal(openedWb[0].projectName, "project-alpha");
    assert.deepEqual(stopped[0], { id: "project-alpha", ids: ["j1"] });

    // Switch recent section to "按项目" grouping.
    const groupBtns = contentEl.querySelectorAll(".ad-groupby__btn");
    assert.equal(groupBtns.length, 2);
    groupBtns[1].onclick();
    assert.equal(plugin.settings.ui.recentGroupBy, "project");
    assert.equal(contentEl.querySelectorAll(".ad-stack--project").length, 1, "app-one with 2 sessions renders as a project stack");

    // 「按状态」view: the third chip buckets the same live rows by status.
    const nowChips = contentEl.querySelectorAll(".ad-nowgroup__btn");
    assert.equal(nowChips.length, 3, "Now offers 按项目 / 按状态 / 列表");
    nowChips[1].onclick();
    assert.equal(plugin.settings.ui.nowGroupBy, "status");
    const statusGroups = contentEl.querySelectorAll(".ad-projgroup");
    assert.deepEqual(statusGroups.map((g) => g.dataset.status), ["waiting", "running", "error"]);
    assert.deepEqual(statusGroups.map((g) => g.querySelector(".ad-projgroup__name").textContent), ["等你", "在跑", "异常"]);
    assert.equal(statusGroups[0].querySelectorAll(".ad-sess").length, 1);
    assert.equal(statusGroups[0].querySelector(".ad-projbadge").textContent, "1");
    assert.ok(statusGroups[0].classes.has("has-attention"), "等你 is flagged as needing attention");
    assert.equal(statusGroups[0].querySelectorAll(".ad-iconbtn--xs").length, 0, "status headers carry no project actions");

    statusGroups[0].querySelector(".ad-projgroup__toggle").onclick();
    const collapsed = contentEl.querySelectorAll(".ad-projgroup");
    assert.equal(collapsed.length, 3, "collapsing keeps the other buckets");
    assert.equal(collapsed[0].querySelectorAll(".ad-sess").length, 0, "collapsed status bucket hides its cards");

    plugin.settings.ui.nowGroupBy = "nonsense";
    assert.equal(view.nowGroupBy(), "project", "unknown Now modes fall back to 按项目");
  } finally {
    delete globalThis.document;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("taskBoardExtension toggles board mode, persists taskBoardViews, and hides child lines", async () => {
  const cmStub = `
    export class WidgetType {};
    export const Decoration = {
      set: (r) => r,
      replace: (spec) => ({ range: (from, to) => ({ from, to, spec }) }),
      widget: (spec) => ({ range: (from) => ({ from, to: from, spec }) }),
    };
    export const EditorView = { decorations: { from: () => ({}) }, atomicRanges: { of: () => ({}) } };
    export const StateEffect = { define: () => { const t = { of: (value) => ({ type: t, value, is: (x) => x === t }) }; return t; } };
    export const StateField = { define: (c) => c };
    export class RangeSetBuilder { constructor() { this.items = []; } add() {} finish() { return []; } }
    export function syntaxTree() { return { resolveInner: () => null }; }
    export const ViewPlugin = { fromClass: () => ({}) };
  `;
  const bundle = await esbuild.build({
    stdin: { contents: "export * from './src/fractal-board.js';", resolveDir: path.resolve(import.meta.dirname, "..") },
    bundle: true,
    format: "esm",
    platform: "node",
    loader: { ".png": "dataurl" },
    external: ["obsidian"],
    write: false,
    plugins: [{
      name: "cm-board",
      setup(b) {
        b.onResolve({ filter: /^@codemirror\// }, (a) => ({ path: a.path, namespace: "cm" }));
        b.onLoad({ filter: /.*/, namespace: "cm" }, () => ({ contents: cmStub }));
      },
    }],
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-board-"));
  const modFile = path.join(tmpDir, "board.mjs");
  fs.writeFileSync(modFile, bundle.outputFiles[0].text);
  try {
    const { taskBoardExtension, setTaskBoardEffect } = await import(pathToFileURL(modFile));
    const src = [
      "- TODO 父项目 ^ad-proj-1",
      "  - TODO 任务甲 @codex",
      "  - DOING 任务乙 @claude",
    ].join("\n");
    const arr = src.split("\n");
    const starts = [];
    let off = 0;
    for (const l of arr) { starts.push(off); off += l.length + 1; }
    const doc = {
      length: src.length,
      lines: arr.length,
      toString: () => src,
      line(n) { const from = starts[n - 1]; return { number: n, from, to: from + arr[n - 1].length, text: arr[n - 1] }; },
    };
    const plugin = { settings: { taskBoardViews: {} }, jobs: {}, saveSettings() {}, refreshUI() {} };
    const field = taskBoardExtension(plugin, {});
    const v0 = field.create({ doc });
    assert.equal(v0.boardLines.size, 0);
    assert.equal(v0.decorations.filter((d) => d.spec.widget?.mode === "outline").length, 1);

    const v1 = field.update(v0, {
      docChanged: false,
      state: { doc },
      effects: [setTaskBoardEffect.of({ key: "ad-proj-1", mode: "board" })],
    });
    assert.equal(plugin.settings.taskBoardViews["ad-proj-1"], "board");
    assert.equal(v1.boardLines.size, 1);
    assert.equal(v1.decorations.filter((d) => d.spec.block && d.spec.widget?.model).length, 1);
    assert.equal(v1.decorations.filter((d) => d.spec.inclusive === false).length, 1, "child lines are replaced when board is open");

    // Steward active wave updates TaskBoardWidget signature and exposes activeWave state.
    plugin.settings.workbenchWaves = {
      w1: {
        id: "w1",
        path: "",
        parentBlockId: "ad-proj-1",
        parentTitle: "父项目",
        round: 1,
        state: "waiting",
        steward: { agent: "claude" },
        workers: [{ state: "done" }, { state: "running" }],
      },
    };
    const vWave = field.update(v1, {
      docChanged: false,
      state: { doc },
      effects: [setTaskBoardEffect.of({ key: "ad-proj-1", mode: "board" })],
    });
    const wBoard = vWave.decorations.find((d) => d.spec.block && d.spec.widget?.model).spec.widget;
    assert.equal(wBoard.activeWave?.id, "w1");
    assert.notEqual(wBoard.sig, v1.decorations.find((d) => d.spec.block && d.spec.widget?.model).spec.widget.sig);

    // Zoom into a nested child sub-board + toggle groupBy = children.
    const nestedSrc = [
      "- TODO 顶级项目 ^ad-root",
      "  - TODO 子阶段 A ^ad-sub-a",
      "    - TODO 孙任务 1 @codex",
      "    - DONE 孙任务 2 @claude",
      "  - DOING 子阶段 B ^ad-sub-b",
      "    - TODO 孙任务 3 @opencode",
      "  - TODO 独立卡片",
    ].join("\n");
    const nArr = nestedSrc.split("\n");
    const nStarts = [];
    let nOff = 0;
    for (const l of nArr) { nStarts.push(nOff); nOff += l.length + 1; }
    const nDoc = {
      length: nestedSrc.length,
      lines: nArr.length,
      toString: () => nestedSrc,
      line(n) { const from = nStarts[n - 1]; return { number: n, from, to: from + nArr[n - 1].length, text: nArr[n - 1] }; },
    };
    const nv0 = field.create({ doc: nDoc });
    const nv1 = field.update(nv0, {
      docChanged: false,
      state: { doc: nDoc },
      effects: [setTaskBoardEffect.of({ key: "ad-root", mode: "board", groupBy: "children" })],
    });
    const wChild = nv1.decorations.find((d) => d.spec.block && d.spec.widget?.model).spec.widget;
    assert.equal(wChild.model.groupBy, "children");
    assert.equal(wChild.model.columns.length, 3, "two child groups plus ungrouped leaf column");
    assert.equal(wChild.model.stats.progressPct, 25);

    const nvZoom = field.update(nv1, {
      docChanged: false,
      state: { doc: nDoc },
      effects: [setTaskBoardEffect.of({ key: "ad-root", zoomStack: ["ad-sub-a"] })],
    });
    const wZoom = nvZoom.decorations.find((d) => d.spec.block && d.spec.widget?.model).spec.widget;
    assert.equal(wZoom.model.key, "ad-sub-a");
    assert.equal(wZoom.breadcrumbs.length, 2);
    assert.equal(wZoom.model.stats.total, 2);
    assert.equal(wZoom.model.stats.done, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Fractal board pins, bulk delete, and column-end moves stay Markdown-native", async () => {
  const note = [
    "- TODO 根看板 ^ad-root",
    "  - TODO 卡片 A ^ad-a",
    "    - 补充细节",
    "    - 💬 记录一",
    "  - TODO 卡片 B ^ad-b",
    "  - DONE 卡片 C",
    "- TODO 尾项",
  ].join("\n");

  assert.equal(boardCardPinId({ blockId: "ad-a", title: "A" }), "block:ad-a");
  assert.equal(boardCardPinId({ isMirror: true, mirror: { target: "其他笔记", blockId: "ad-m" }, title: "M" }), "mirror:其他笔记#ad-m");
  assert.equal(boardCardPinId({ title: "  没有块号  " }), "title:没有块号");

  const columns = [{ id: "todo", cards: [
    { blockId: "a", title: "A" },
    { blockId: "b", title: "B" },
    { blockId: "c", title: "C" },
  ] }];
  sortBoardCardsByPins(columns, ["block:c"]);
  assert.deepEqual(columns[0].cards.map((card) => card.blockId), ["c", "a", "b"]);
  const plainColumns = [{ id: "todo", cards: [{ blockId: "a" }, { blockId: "b" }] }];
  sortBoardCardsByPins(plainColumns, []);
  assert.deepEqual(plainColumns[0].cards.map((card) => card.blockId), ["a", "b"]);

  const settings = {};
  applyTaskBoardPins(settings, "board:root", ["block:b"], true);
  assert.deepEqual(settings.taskBoardPins["board:root"], ["block:b"]);
  applyTaskBoardPins(settings, "board:root", ["block:b"], false);
  assert.equal(settings.taskBoardPins["board:root"], undefined);

  const mdTitleNote = [
    "- TODO Markdown 根 ^ad-md-root",
    "  - TODO **粗体** 子卡 ^ad-md-a",
    "  - TODO 普通子卡 ^ad-md-b",
  ].join("\n");
  const mdGroup = extractTaskBoardGroups(mdTitleNote).find((g) => g.key === "ad-md-root");
  assert.equal(mdGroup.cards[0].titleMarkdown, "**粗体** 子卡", "board keeps inline Markdown for rendering");
  assert.equal(mdGroup.cards[0].title, "粗体 子卡", "plain title stays markup-free for pins and context");

  const group = extractTaskBoardGroups(note).find((g) => g.key === "ad-root");
  const model = buildTaskBoardModel(group, { jobs: {} }, { pinnedIds: ["block:ad-b"] });
  assert.deepEqual(model.columns.find((c) => c.id === "todo").cards.map((card) => card.blockId), ["ad-b", "ad-a"]);

  const childGroups = extractTaskBoardGroups([
    "- TODO 子组根 ^ad-child-root",
    "  - TODO 组一 ^ad-g1",
    "    - TODO 子卡 A ^ad-ca",
    "    - TODO 子卡 B ^ad-cb",
    "  - TODO 组二 ^ad-g2",
    "    - TODO 子卡 C ^ad-cc",
    "    - TODO 子卡 D ^ad-cd",
  ].join("\n"));
  const childModel = buildTaskBoardModel(childGroups.find((g) => g.key === "ad-child-root"), { jobs: {} }, {
    groupBy: "children",
    pinnedIds: ["block:ad-cb"],
  });
  assert.deepEqual(childModel.columns[0].cards.map((card) => card.blockId), ["ad-cb", "ad-ca"]);

  const nestedGroups = extractTaskBoardGroups([
    "- TODO 嵌套根 ^ad-nested-root",
    "  - TODO 阶段 ^ad-nested-phase",
    "    - TODO 子卡 ^ad-nested-child",
    "      - TODO 孙卡 1",
    "      - TODO 孙卡 2",
    "  - TODO 另一组 ^ad-nested-other",
    "    - TODO 普通卡",
  ].join("\n"));
  const nestedPhase = nestedGroups.find((g) => g.key === "ad-nested-root").cards.find((card) => card.key === "ad-nested-phase") || nestedGroups.find((g) => g.key === "ad-nested-root").cards[0];
  assert.equal(nestedPhase.subCards[0].subBoardKey, "ad-nested-child", "group columns expose nested zoom targets");
  assert.equal(nestedPhase.subCards[0].childCardCount, 2, "nested zoom cards expose their child count");
  assert.equal(nestedPhase.subCards[0].childDoneCount, 0, "nested zoom cards expose their done count");

  const duplicateGroups = extractTaskBoardGroups([
    "- TODO 同名根 ^ad-dup-root",
    "  - TODO 同名卡",
    "  - TODO 同名卡",
    "  - TODO 别的卡",
  ].join("\n"));
  const duplicateModel = buildTaskBoardModel(duplicateGroups[0], { jobs: {} }, { pinnedIds: ["title:同名卡#2"] });
  const duplicateCards = duplicateModel.columns.find((col) => col.id === "todo").cards;
  const duplicateKeys = duplicateCards.map(boardCardPinKey);
  assert.equal(new Set(duplicateKeys).size, duplicateKeys.length, "duplicate titles get distinct pin keys");
  assert.equal(duplicateCards[0].title, "同名卡", "the second duplicate is pinned to the top");
  assert.equal(duplicateCards[0].line, 2, "the pinned duplicate is the one with occurrence 2");

  const deleted = deleteTaskBoardCards(note, [1]);
  assert.ok(!deleted.includes("卡片 A"));
  assert.ok(!deleted.includes("补充细节"));
  assert.ok(!deleted.includes("记录一"));
  assert.ok(deleted.includes("卡片 B"));
  assert.ok(deleted.includes("尾项"));

  const deletedMany = deleteTaskBoardCards(note, [1, 4]);
  assert.ok(!deletedMany.includes("卡片 A"));
  assert.ok(!deletedMany.includes("卡片 B"));
  assert.ok(deletedMany.includes("卡片 C"));
  assert.ok(deletedMany.includes("尾项"));

  const nestedSelection = deleteTaskBoardCards(note, [1, 2]);
  assert.ok(!nestedSelection.includes("卡片 A"));
  assert.ok(nestedSelection.includes("卡片 B"));

  const appendNote = ["- TODO 根 ^r", "  - TODO A ^a", "  - TODO B ^b"].join("\n");
  const appended = moveTaskBoardCardSubtree(appendNote, 1, { beforeLine: 3 });
  assert.equal(appended, ["- TODO 根 ^r", "  - TODO B ^b", "  - TODO A ^a"].join("\n"));
});

test("Fractal board Stage A/B/C: inline card edits, subtree moves, mirror isolation, and Harness context", async () => {
  const note = [
    "- TODO 根看板 ^ad-top",
    "  - TODO 分组一 ^ad-g1",
    "    - TODO 卡片 A @codex ^ad-a",
    "      - 补充细节",
    "    - DONE 卡片 B",
    "  - DOING 分组二 ^ad-g2",
    "    - TODO 卡片 C",
    "  - ![[其他笔记#^ad-remote]]",
  ].join("\n");

  const groups = extractTaskBoardGroups(note);
  assert.equal(groups.length, 2);
  const top = groups.find((g) => g.key === "ad-top");
  assert.equal(top.topLevel, true);
  assert.equal(top.cards.length, 3);
  assert.equal(top.cards[0].subBoardKey, "ad-g1");
  assert.equal(top.cards[2].isMirror, true);

  // Resolve mirror card into board model.
  const model = buildTaskBoardModel(top, { jobs: {} }, {
    groupBy: "status",
    resolveMirror: (ref) => ref.blockId === "ad-remote"
      ? {
          title: "远端关联任务",
          kw: "DOING",
          column: "doing",
          agent: "claude",
          latestConclusion: "正在推进",
          mirrorTarget: { path: "其他笔记.md", line: 4, blockId: "ad-remote" },
        }
      : null,
  });
  const mirrorCard = model.columns.find((c) => c.id === "doing").cards.find((c) => c.isMirror);
  assert.equal(mirrorCard.title, "远端关联任务");
  assert.equal(mirrorCard.mirrorTarget.path, "其他笔记.md");

  // Inline card insert & agent assignment.
  const withNew = insertTaskBoardCard(note, 1, { title: "新增卡片 D", column: "doing", agent: "claude" });
  assert.ok(withNew.includes("    - DOING 新增卡片 D @claude"));
  const withAgent = setTaskBoardCardAgent(withNew, 2, "opencode");
  assert.equal(withAgent.split("\n")[2], "    - TODO 卡片 A @opencode ^ad-a");

  // Move card subtree (with its child line) from 分组一 to 分组二.
  const movedSub = moveTaskBoardCardSubtree(note, 2, { targetParentLine: 5 });
  assert.ok(movedSub.includes("  - DOING 分组二 ^ad-g2\n    - TODO 卡片 C\n    - TODO 卡片 A @codex ^ad-a\n      - 补充细节"));
  assert.ok(!movedSub.slice(0, movedSub.indexOf("分组二")).includes("卡片 A"));

  // Stage B: Harness resolves [[wikilinks]] and sibling board division context.
  const boardContext = buildBoardSiblingContext(model, 1);
  assert.match(boardContext, /同看板协同分工/);
  assert.match(boardContext, /远端关联任务/);

  const rawMirrorBoard = [
    "- TODO 根看板 ^ad-raw-root",
    "  - TODO 子任务 A ^ad-raw-a",
    "  - ![[分形看板示例#^ad-demo-src]]",
  ].join("\n");
  const rawModel = buildTaskBoardModel(extractTaskBoardGroups(rawMirrorBoard)[0], null, { groupBy: "children" });
  const cleanBoardContext = buildBoardSiblingContext(rawModel, 1);
  assert.ok(!cleanBoardContext.includes("^ad-raw-root"));
  assert.ok(!cleanBoardContext.includes("^ad-demo-src"));
  assert.ok(cleanBoardContext.includes("分形看板示例"));

  const linkedPlugin = {
    settings: { delegate: { confirmFirst: false } },
    app: {
      metadataCache: {
        getFirstLinkpathDest: (target) => (target === "架构说明" ? { path: "docs/架构说明.md", extension: "md" } : null),
      },
    },
    readNote: async () => "---\ntags: [arch]\n---\n这里是系统架构说明正文。",
  };
  const payload = await buildDelegationPayload({
    plugin: linkedPlugin,
    file: { path: "daily/2026-11-16.md" },
    lines: ["- TODO 子任务 [[架构说明]]"],
    block: { start: 0, end: 0, text: "- TODO 子任务 [[架构说明]]" },
    opts: { boardContext },
  });
  assert.match(payload.prompt, /这里是系统架构说明正文/);
  assert.match(payload.prompt, /同看板协同分工/);

  // Stage C: Mirror lines are excluded from analytics and Dreaming extraction.
  const mirrorNote = [
    "- DOING 本地真实任务 ^ad-local",
    "  - 🔗 [Claude](claude://resume?session=11111111-1111-1111-1111-111111111111)",
    "- DOING ![[其他笔记#^ad-remote]]",
    "- [[其他笔记#^ad-remote-2]]",
  ].join("\n");
  const sources = journalSources(mirrorNote, "daily/2026-11-16.md", {
    autoState: {
      "11111111-1111-1111-1111-111111111111": { blockId: "ad-local", label: "本地真实任务" },
      "s-remote": { blockId: "ad-remote", label: "![[其他笔记#^ad-remote]]" },
    },
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].blockId, "ad-local");

  const blocks = evidenceBlocks(mirrorNote, "daily/2026-11-16.md");
  assert.ok(!blocks.some((b) => b.text.includes("ad-remote")), "Dreaming never double-collects mirror lines");
});

test("welcome showcase note builds bilingual boards, all four AI record views, and self-resolving mirror link without fake session links", () => {
  assert.equal(showcasePath("zh"), `Agent Deck/功能示例-${SHOWCASE_VERSION}.md`);
  assert.equal(showcasePath("en"), `Agent Deck/Welcome-${SHOWCASE_VERSION}.md`);

  for (const lang of ["zh", "en"]) {
    const md = buildShowcaseMarkdown(lang);
    assert.ok(!md.includes("🔗"), `${lang} showcase must not bind fake 🔗 session links`);
    if (lang === "en") {
      assert.ok(!/[\u4e00-\u9fff]/.test(md), "en showcase must not contain leftover CJK text");
    }

    const boardGroups = extractTaskBoardGroups(md);
    const rootBoard = boardGroups.find((g) => g.key === SHOWCASE_BOARD_KEY);
    assert.ok(rootBoard, `${lang} root fractal board parsed`);
    const model = buildTaskBoardModel(rootBoard, null, { groupBy: "children" });
    assert.ok(model.columns.length >= 2, `${lang} board renders child group columns`);
    const mirrorCards = model.columns.flatMap((c) => c.cards).filter((c) => c.isMirror && c.mirror);
    assert.equal(mirrorCards.length, 1, `${lang} board includes one mirror card`);
    assert.equal(mirrorCards[0].mirror.blockId, SHOWCASE_MIRROR_SOURCE_KEY);
    assert.ok(md.includes(`^${SHOWCASE_MIRROR_SOURCE_KEY}`), `${lang} showcase defines mirror source block`);
    assert.ok(parseMirrorRef(`- ${mirrorCards[0].mirror.raw}`), "mirror line matches parseMirrorRef");

    const recGroups = aiRecordGroups(md);
    for (const key of Object.values(SHOWCASE_RECORD_KEYS)) {
      const grp = recGroups.find((g) => g.key === key && g.topLevel);
      assert.ok(grp, `${lang} top-level AI record group ${key} parsed`);
      assert.ok((grp.tableEntries || []).length >= 3, `${lang} ${key} has multi-round record entries`);
    }
  }

  const settings = {};
  assert.equal(applyShowcaseDefaults(settings), true);
  assert.deepEqual(settings.taskBoardViews[SHOWCASE_BOARD_KEY], { mode: "board", groupBy: "children", zoomStack: [] });
  assert.equal(settings.aiRecordViews[SHOWCASE_RECORD_KEYS.table], "table");
  assert.equal(settings.aiRecordViews[SHOWCASE_RECORD_KEYS.cards], "cards");
  assert.equal(settings.aiRecordViews[SHOWCASE_RECORD_KEYS.timeline], "timeline");
  assert.equal(settings.aiRecordExpanded[SHOWCASE_RECORD_KEYS.outline], true);
  // Idempotent on second run and respects user customization when force=false.
  assert.equal(applyShowcaseDefaults(settings), false);
  settings.taskBoardViews[SHOWCASE_BOARD_KEY] = "outline";
  assert.equal(applyShowcaseDefaults(settings, { force: false }), false);
  assert.equal(settings.taskBoardViews[SHOWCASE_BOARD_KEY], "outline");
  assert.equal(applyShowcaseDefaults(settings, { force: true }), true);
  assert.deepEqual(settings.taskBoardViews[SHOWCASE_BOARD_KEY], { mode: "board", groupBy: "children", zoomStack: [] });
});

test("buildProjectGroups isolates same-named folders, inherits parent project for subagents, and filters stale/child wait noise", () => {
  const now = Date.now();
  const sessions = [
    { sid: "p1", agent: "codex", state: "wait", cwd: "/Users/x/team-a/work", lastAt: now - 5000, title: "Team A Work" },
    { sid: "p2", agent: "claude", state: "run", cwd: "/Users/x/team-b/work", lastAt: now - 2000, title: "Team B Work" },
    { sid: "c1", agent: "dsh", state: "done", cwd: "/Users/x/Documents/deepseek-harness/default-workspace", parentSid: "p1", lastAt: now - 1000, title: "DSH subagent" },
    { sid: "c2", agent: "dsh", state: "run", cwd: "", parentCwd: "/Users/x/team-b/work", parentSid: "missing-parent", lastAt: now - 500, title: "Running child via parentCwd" },
    { sid: "stale-main", agent: "dsh", state: "wait", cwd: "/Users/x/solo-proj", lastAt: now - WAIT_ACTIVE_MS - 60000, title: "Old ended turn" },
    { sid: "child-wait", agent: "dsh", state: "wait", cwd: "/Users/x/team-a/work", parentSid: "p1", lastAt: now - 1000, title: "Child wait ignored" },
  ];

  const groups = buildProjectGroups(sessions, { now });
  const teamA = groups.find((g) => g.id === "/Users/x/team-a/work");
  const teamB = groups.find((g) => g.id === "/Users/x/team-b/work");
  const soloProj = groups.find((g) => g.id === "solo-proj");
  assert.ok(teamA && teamB, "same-named folders in different directories never merge");
  assert.equal(teamA.name, "work (team-a)");
  assert.equal(teamB.name, "work (team-b)");
  assert.equal(teamA.sessions.some((s) => s.sid === "c1"), true, "subagent in default-workspace inherits parent project");
  assert.equal(teamB.sessions.some((s) => s.sid === "c2"), true, "subagent with parentCwd inherits parent project even if parent is absent");
  assert.equal(groups.some((g) => g.id === STANDALONE_PROJECT_ID), false, "no child leaked into standalone");
  assert.equal(teamA.counts.waiting, 1, "only main recent wait counts as waiting, not child-wait");
  assert.equal(soloProj.counts.waiting, 0, "stale wait past WAIT_ACTIVE_MS does not count as waiting");

  assert.equal(isWaitingSession(sessions[0], now), true);
  assert.equal(isWaitingSession(sessions[4], now), false);
  assert.equal(isWaitingSession(sessions[5], now), false);
  assert.equal(isActiveNowSession(sessions[4], now), false);
  assert.equal(isActiveNowSession({ sid: "n1", agent: "dsh", state: "needs-approval", lastAt: now - WAIT_ACTIVE_MS - 60000 }, now), true);
});

test("buildNowStatusGroups buckets active rows into 等你 / 待认领 / 在跑 / 异常 in order", () => {
  const now = Date.now();
  const sessions = [
    { sid: "run-old", agent: "claude", state: "run", lastAt: now - 4000, title: "旧的在跑" },
    { sid: "run-new", agent: "codex", state: "busy", lastAt: now - 1000, title: "新的在跑" },
    { sid: "appr", agent: "dsh", state: "needs-approval", lastAt: now - 2000, title: "等授权" },
    { sid: "err", agent: "qoder", state: "error", lastAt: now - 3000, title: "报错" },
    { sid: "lim", agent: "qoder", state: "limit", lastAt: now - 500, title: "撞限额" },
    { sid: "done", agent: "dsh", state: "done", lastAt: now - 100, title: "已完成" },
    { sid: "stale", agent: "dsh", state: "wait", lastAt: now - WAIT_ACTIVE_MS - 60000, title: "过期等待" },
  ];
  const jobs = { unclaimed: { id: "unclaimed", agent: "claude", state: "starting", name: "还没被接手", startedAt: now - 5000 } };
  const groups = buildNowStatusGroups(sessions, { jobs, now });
  assert.deepEqual(groups.map((g) => g.id), ["waiting", "pending", "running", "error"]);
  assert.deepEqual(groups.map((g) => g.sessions.map((s) => s.sid)), [["appr"], ["unclaimed"], ["run-new", "run-old"], ["lim", "err"]]);
  assert.equal(groups[0].label, "等你");
  assert.equal(groups[1].label, "⏳ 待认领");
  assert.equal(groups[0].sessions[0].state, "needs-approval");
  assert.equal(groups[1].sessions[0].isPendingJob, true, "a dispatched-but-unclaimed job is not running yet");
  assert.equal(nowStatusOf(sessions[5], now), "", "finished sessions belong to no status bucket");
  assert.equal(nowStatusOf(sessions[6], now), "", "wait past WAIT_ACTIVE_MS is not a live status");
  // A disabled agent drops its job row, and buckets left empty disappear.
  assert.deepEqual(
    buildNowStatusGroups(sessions, { jobs, agentEnabled: (id) => id !== "claude", now }).map((g) => g.id),
    ["waiting", "running", "error"],
  );
  assert.deepEqual(buildNowStatusGroups([], { now }), []);
});

test("Steward config, wave sync, worker report collection, prompt builder, and Markdown updates", () => {
  const cfg = resolveStewardConfig(
    {
      projectTeams: {
        stewards: {
          byProject: { "agent-deck": { enabled: true, agent: "codex", autoContinue: true } },
        },
      },
    },
    {
      projectName: "agent-deck",
      availableAgents: ["claude", "codex", "dsh"],
      limitAgents: new Set(["codex"]),
    },
  );
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.agent, "claude", "hit-limit steward falls back to healthy agent");
  assert.equal(cfg.limited, true);
  assert.equal(cfg.autoContinue, true);

  const wave = createWorkbenchWave({
    id: "wave-1",
    path: "daily/2026-11-16.md",
    parentBlockId: "ad-parent-1",
    parentTitle: "重构派发链路",
    projectName: "agent-deck",
    goal: "完成管家收集与继续推进",
    cwd: "/work/agent-deck",
    steward: { enabled: true, agent: "claude", destination: "background", autoContinue: false },
    workers: [
      { jobId: "j1", blockId: "ad-w1", title: "后端接口", agent: "codex", state: "running" },
      { jobId: "j2", blockId: "ad-w2", title: "前端交互", agent: "dsh", state: "running" },
    ],
  });

  const jobs = {
    j1: { id: "j1", state: "done", sessionId: "s1", result: "已新增 /api/wave 接口并通过单测。" },
    j2: { id: "j2", state: "bound", handoff: true, sessionId: "s2" },
  };
  const metaMap = new Map([
    ["s2", { state: "wait", lastAt: Date.now(), rounds: [{ n: 1, said: "UI 按钮与状态条已补齐。" }] }],
  ]);

  const synced = syncWaveWithState(wave, jobs, metaMap);
  assert.equal(synced.allSettled, true);
  assert.deepEqual(synced.counts, { total: 2, done: 2, error: 0, cancelled: 0, running: 0 });

  const noteText = [
    "- DOING 重构派发链路 ^ad-parent-1",
    "\t- TOREVIEW 后端接口 @codex ^ad-w1",
    "\t\t- 💬 第1轮：已新增接口",
    "\t\t- 🔗 [完整问答](Agent%20Deck/Answers/j1.md)",
    "\t- TOREVIEW 前端交互 @dsh ^ad-w2",
  ].join("\n");
  const reports = collectWaveWorkerReports(wave, { jobs, metaMap, noteText });
  assert.equal(reports.length, 2);
  assert.match(reports[0].output, /已新增 \/api\/wave 接口/);
  assert.equal(reports[0].answerLink, "Agent%20Deck/Answers/j1.md");
  assert.match(reports[1].output, /UI 按钮与状态条已补齐/);

  const prompt = buildStewardPrompt({ wave, reports, availableAgents: ["claude", "codex", "dsh"] });
  assert.match(prompt, /管家 Agent/);
  assert.match(prompt, /后端接口/);
  assert.match(prompt, /UI 按钮与状态条已补齐/);

  const rawReply = [
    "先检查示例对象 `{\"not\":\"this\"}`。",
    "《本轮验收与汇总结论》：前后端主体已完成，还差集成回归测试。",
    "```json",
    JSON.stringify({
      status: "continue",
      summary: "主体完成，待补集成测试",
      nextTasks: [
        { title: "补充波次集成测试", agent: "codex", detail: "覆盖自动触发与续派" },
        { title: "不可用代理回退测试", agent: "cursor", detail: "应回退到默认 Agent" },
      ],
    }),
    "```",
  ].join("\n");
  const outcome = parseStewardOutcome(rawReply, { availableAgents: ["claude", "codex"], defaultAgent: "claude" });
  assert.equal(outcome.status, "continue");
  assert.equal(outcome.summary, "主体完成，待补集成测试");
  assert.equal(outcome.nextTasks.length, 2);
  assert.equal(outcome.nextTasks[0].agent, "codex");
  assert.equal(outcome.nextTasks[1].agent, "claude");

  const appended = appendSubtasksToParentBlock(noteText, {
    parentBlockId: "ad-parent-1",
    subtasks: outcome.nextTasks,
    assignBlockIds: true,
    keyword: "TODO",
  });
  assert.equal(appended.addedLines.length, 2);
  assert.match(appended.text, /\t- TODO 补充波次集成测试 @codex \^[a-z0-9-]+/);

  // Status update guards preserve user-edited DONE items.
  const preserved = setTaskBlockKeywordById(
    "- DONE 手工已完 ^ad-manual\n- DELEGATED 队员中 ^ad-w1",
    { blockId: "ad-manual", keyword: "TOREVIEW", onlyIfKeywords: ["DELEGATED"] },
  );
  assert.ok(preserved.startsWith("- DONE 手工已完 ^ad-manual"));

  const moved = updateTaskBlockStatusById(noteText, {
    blockId: "ad-parent-1",
    targetColumn: "review",
    onlyFromColumns: ["doing"],
  });
  assert.ok(moved.startsWith("- NEEDOK 重构派发链路 ^ad-parent-1"));

  assert.equal(
    findActiveWaveForBoard({ [wave.id]: wave }, { path: "daily/2026-11-16.md", parentBlockId: "ad-parent-1" })?.id,
    "wave-1",
  );
});

test("AgentDeckPlugin end-to-end wave orchestration triggers Steward on completion and supports bounded auto-continue", async () => {
  const obsidianStub = `
    export class Plugin {};
    export class Modal {};
    export class ItemView {};
    export class Menu {};
    export class MarkdownView {};
    export class MarkdownRenderChild {};
    export class MarkdownRenderer {};
    export class Component {};
    export class Notice { constructor(m){ this.m = m; } hide(){} };
    export class PluginSettingTab {};
    export function setIcon(){};
    export const editorInfoField = {};
  `;
  const cmStub = `
    export class WidgetType {};
    export const Decoration = { set: () => [], replace: () => ({ range: () => ({}) }), widget: () => ({ range: () => ({}) }) };
    export const EditorView = { decorations: { from: () => ({}) }, atomicRanges: { of: () => ({}) }, scrollIntoView: () => ({}) };
    export const EditorSelection = { cursor: (p) => ({ anchor: p, head: p }) };
    export const ViewPlugin = { fromClass: () => ({}) };
    export const EditorState = { create: () => ({}) };
    export const StateEffect = { define: () => ({ of: () => ({}), is: () => false }) };
    export const StateField = { define: () => ({}) };
    export class RangeSetBuilder { constructor() { this.items = []; } add() {} finish() { return []; } }
    export function syntaxTree() { return { resolveInner: () => null }; }
    export const foldedRanges = () => ({});
    export const foldEffect = {};
    export const unfoldEffect = {};
  `;
  const extraStubs = {
    electron: "export const shell = { openExternal(){} };",
    "./editor.js": "export const editorInfoField = {}; export const createEditorExtension = () => []; export function dispatchRefresh(){}; export const ITEM_MIME = 'x';",
    "./fold-integration.js": "export function integrateRecordFolding(){}",
    "./mention-suggest.js": "export function registerTaskAgentSuggest(){}",
    "./view.js": "export class AgentDeckView {}; export const VIEW_TYPE = 'ad-view';",
    "./dashboard.js": "export class DashboardView {}; export const DASHBOARD_TYPE = 'ad-dash';",
    "./settings.js": "export class AgentDeckSettingsTab {}; export function syncDelegationSettings(s){ return s; }",
    "./menubar.js": "export class MenuBarBridge { constructor(){} start(){ return Promise.resolve(); } stop(){} }",
  };
  const bundle = await esbuild.build({
    stdin: { contents: "export { default as AgentDeckPlugin } from './src/main.js';", resolveDir: path.resolve(import.meta.dirname, "..") },
    bundle: true,
    format: "esm",
    platform: "node",
    loader: { ".png": "dataurl" },
    write: false,
    external: ["@codemirror/*"],
    plugins: [{
      name: "main-wave-test",
      setup(b) {
        b.onResolve({ filter: /^(obsidian|electron|\..*)$/ }, (a) => {
          if (a.path === "obsidian") return { path: "obsidian", namespace: "stub" };
          if (extraStubs[a.path]) return { path: a.path, namespace: "stub" };
          return undefined;
        });
        b.onResolve({ filter: /^@codemirror\// }, (a) => ({ path: a.path, namespace: "cm" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          contents: a.path === "obsidian" ? obsidianStub : extraStubs[a.path],
        }));
        b.onLoad({ filter: /.*/, namespace: "cm" }, () => ({ contents: cmStub }));
      },
    }],
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wave-e2e-"));
  const modFile = path.join(tmpDir, "plugin.mjs");
  fs.writeFileSync(modFile, bundle.outputFiles[0].text);
  try {
    const { AgentDeckPlugin } = await import(pathToFileURL(modFile));
    const notes = new Map([["daily/2026-11-16.md", "## 正在做\n"]]);
    const plugin = new AgentDeckPlugin();
    plugin.app = {
      vault: {
        getAbstractFileByPath: (p) => (notes.has(p) ? { path: p, extension: "md" } : null),
        read: async (f) => notes.get(typeof f === "string" ? f : f.path) || "",
        modify: async (f, text) => { notes.set(typeof f === "string" ? f : f.path, text); },
        process: async (f, fn) => {
          const p = typeof f === "string" ? f : f.path;
          const next = fn(notes.get(p) || "");
          notes.set(p, next);
          return next;
        },
        create: async (p, text) => { notes.set(p, text); return { path: p, extension: "md" }; },
        createFolder: async () => {},
      },
      workspace: { getLeavesOfType: () => [], getActiveFile: () => null },
      metadataCache: { getFirstLinkpathDest: () => null },
    };
    plugin.settings = {
      agents: { claude: true, codex: true, dsh: true },
      taskBoardViews: {},
      workbenchWaves: {},
      projectTeams: { presets: {}, byProject: {}, stewards: {} },
    };
    plugin.jobs = {};
    plugin.usage = { meta: new Map() };
    plugin.liveSessions = () => [];
    plugin.defaultTarget = () => "claude";
    plugin.agentEnabled = (id) => ["claude", "codex", "dsh"].includes(id);
    plugin.saveData = async () => {};
    plugin.saveSettings = async () => {};
    plugin.readNote = async (p) => notes.get(p) || "";
    plugin.refreshUI = () => {};
    plugin.viewForPath = () => null;
    plugin.openMirrorSource = async () => {};
    plugin._launchingWaves = new Set();
    plugin._finalizingWaves = new Set();
    const notices = [];
    plugin.notice = (msg) => notices.push(msg);

    let seq = 0;
    const delegatedCalls = [];
    plugin.delegator = {
      delegate: async (opts) => {
        seq += 1;
        const job = {
          id: `job-${seq}`,
          agent: opts.agent,
          name: opts.block.text.split("\n")[0],
          blockId: opts.block.text.match(/\^([a-z0-9-]+)/i)?.[1] || "",
          path: opts.file.path,
          state: "running",
          sessionId: `sid-${seq}`,
          result: "",
        };
        plugin.jobs[job.id] = job;
        delegatedCalls.push({ job, opts });
        return job;
      },
      cancel: () => {},
    };

    const saved = await plugin.writeWorkbenchTasks({
      path: "daily/2026-11-16.md",
      parentTitle: "端到端协同测试",
      subtasks: [
        { checked: true, title: "子任务一", agent: "codex", destination: "background" },
        { checked: true, title: "子任务二", agent: "dsh", destination: "background" },
      ],
      enableBoard: true,
    });
    assert.ok(saved.parentBlockId);
    assert.equal(saved.subtaskLines.length, 2);

    await plugin.dispatchWorkbenchTasks({
      path: saved.path,
      lines: saved.lines,
      subtaskLines: saved.subtaskLines,
      cwd: "/work/demo",
      parentTitle: "端到端协同测试",
      parentBlockId: saved.parentBlockId,
      goal: "实现并验证端到端功能",
      steward: { enabled: true, agent: "claude", destination: "background", autoContinue: true },
    });

    const wave1 = Object.values(plugin.settings.workbenchWaves)[0];
    assert.ok(wave1);
    assert.equal(wave1.state, "waiting");
    assert.equal(delegatedCalls.length, 2);
    assert.match(notes.get("daily/2026-11-16.md"), /^- DOING 端到端协同测试/m);

    // Worker 1 settles -> Steward must NOT launch yet.
    const j1 = delegatedCalls[0].job;
    j1.state = "done";
    j1.result = "子任务一完成了后端 API";
    await plugin.onWorkbenchJobSettled(j1);
    assert.equal(wave1.state, "waiting");
    assert.equal(delegatedCalls.length, 2);
    assert.match(notes.get("daily/2026-11-16.md"), /TOREVIEW 子任务一/);

    // Worker 2 settles -> Steward launches automatically with both worker outputs!
    const j2 = delegatedCalls[1].job;
    j2.state = "done";
    j2.result = "子任务二完成了文档与校验";
    await plugin.onWorkbenchJobSettled(j2);
    assert.equal(wave1.state, "running");
    assert.equal(delegatedCalls.length, 3);
    const stewardCall = delegatedCalls[2];
    assert.equal(stewardCall.job.agent, "claude");
    assert.match(stewardCall.opts.boardContext, /子任务一完成了后端 API/);
    assert.match(stewardCall.opts.boardContext, /子任务二完成了文档与校验/);
    assert.match(notes.get("daily/2026-11-16.md"), /🧭 管家汇总与推进/);

    // Steward finishes Round 1 with 1 follow-up task -> autoContinue dispatches Round 2!
    stewardCall.job.state = "done";
    stewardCall.job.result = [
      "已核查前两项产出，补充一条集成验证任务。",
      "```json",
      JSON.stringify({
        status: "continue",
        summary: "进入第 2 轮集成验证",
        nextTasks: [{ title: "第2轮集成验证", agent: "codex", detail: "跑通端到端测试" }],
      }),
      "```",
    ].join("\n");
    await plugin.onWorkbenchJobSettled(stewardCall.job);
    assert.equal(wave1.state, "done");
    assert.equal(delegatedCalls.length, 4, "autoContinue dispatches Round 2 worker");
    assert.match(notes.get("daily/2026-11-16.md"), /DONE 子任务一/);
    assert.match(notes.get("daily/2026-11-16.md"), /DONE 🧭 管家汇总与推进/);
    assert.match(notes.get("daily/2026-11-16.md"), /第2轮集成验证/);

    const wave2 = Object.values(plugin.settings.workbenchWaves).find((w) => w.round === 2);
    assert.ok(wave2 && wave2.state === "waiting");

    // Round 2 worker finishes -> Round 2 Steward runs -> even if it suggests nextTasks, MAX_STEWARD_ROUNDS stops auto-loop!
    const j4 = delegatedCalls[3].job;
    j4.state = "done";
    j4.result = "端到端测试全部通过";
    await plugin.onWorkbenchJobSettled(j4);
    assert.equal(delegatedCalls.length, 5, "Round 2 Steward launched");
    const steward2 = delegatedCalls[4].job;
    steward2.state = "done";
    steward2.result = '```json\n{"status":"done","summary":"全部完成","nextTasks":[]}\n```';
    await plugin.onWorkbenchJobSettled(steward2);
    assert.equal(wave2.state, "done");
    assert.equal(delegatedCalls.length, 5, "no runaway round 3");
    assert.match(notes.get("daily/2026-11-16.md"), /^- TOREVIEW 端到端协同测试/m);
    assert.ok(MAX_STEWARD_ROUNDS === 2);

    // Manual "runStewardWaveNow" & error retry & cancel paths.
    const saved2 = await plugin.writeWorkbenchTasks({
      path: "daily/2026-11-16.md",
      parentTitle: "手动汇总测试",
      subtasks: [{ checked: true, title: "慢任务", agent: "codex", destination: "background" }],
      enableBoard: true,
    });
    await plugin.dispatchWorkbenchTasks({
      path: saved2.path,
      lines: saved2.lines,
      subtaskLines: saved2.subtaskLines,
      parentTitle: "手动汇总测试",
      parentBlockId: saved2.parentBlockId,
      steward: { enabled: true, agent: "claude", destination: "background", autoContinue: false },
    });
    const manualWave = Object.values(plugin.settings.workbenchWaves).find((w) => w.parentBlockId === saved2.parentBlockId);
    assert.equal(manualWave.state, "waiting");
    await plugin.runStewardWaveNow(manualWave.id);
    assert.equal(manualWave.state, "running");
    const manualStewardJob = delegatedCalls.at(-1).job;
    manualStewardJob.state = "error";
    manualStewardJob.error = "timeout";
    await plugin.onWorkbenchJobSettled(manualStewardJob);
    assert.equal(manualWave.state, "error");
    assert.match(notes.get("daily/2026-11-16.md"), /ERRORED 🧭 管家汇总与推进/);
    await plugin.cancelWorkbenchWave(manualWave.id);
    assert.equal(manualWave.state, "cancelled");

    // Verify plugin.goToAncestor and plugin.groupRows directly on a CM6-like view.
    let outlineText = ["- 母项 ^ad-anc", "\t- 子项甲", "\t- 子项乙"].join("\n");
    const makeDoc = (str) => {
      const arr = str.split("\n");
      const starts = [];
      let off = 0;
      for (const l of arr) { starts.push(off); off += l.length + 1; }
      return {
        length: str.length,
        lines: arr.length,
        toString: () => str,
        line(n) { const from = starts[n - 1]; return { number: n, from, to: from + arr[n - 1].length, text: arr[n - 1] }; },
        lineAt(pos) {
          let idx = arr.length - 1;
          for (let i = 0; i < starts.length; i++) if (pos >= starts[i]) idx = i;
          return this.line(idx + 1);
        },
      };
    };
    let cmDoc = makeDoc(outlineText);
    const cmState = {
      get doc() { return cmDoc; },
      selection: { ranges: [{ from: cmDoc.line(2).from, to: cmDoc.line(2).from }], main: { head: cmDoc.line(2).from } },
    };
    const cmView = {
      state: cmState,
      focus() {},
      dispatch({ changes, selection }) {
        if (changes) {
          outlineText = outlineText.slice(0, changes.from) + changes.insert + outlineText.slice(changes.to);
          cmDoc = makeDoc(outlineText);
        }
        if (selection) {
          const sel = { anchor: selection.anchor, head: selection.head ?? selection.anchor };
          cmState.selection = { ranges: [sel], main: sel };
        }
      },
    };
    assert.equal(plugin.goToAncestor(cmView, false), true);
    assert.equal(cmState.selection.main.head, cmDoc.line(1).from + "- 母项".length, "cursor lands before ^ad-anc");
    const line2From = cmDoc.line(2).from;
    const line3To = cmDoc.line(3).to;
    cmState.selection = { ranges: [{ from: line2From, to: line3To }], main: { head: line3To } };
    assert.equal(plugin.groupRows(cmView), true);
    assert.equal(outlineText, ["- 母项 ^ad-anc", "\t- ", "\t\t- 子项甲", "\t\t- 子项乙"].join("\n"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
