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
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class ItemView{constructor(l){Object.assign(this,l)}registerEvent(){}};export class Menu{};export class Modal{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const {
  STANDALONE_PROJECT_ID,
  buildProjectGroups,
  planRecentProjectDisplay,
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
  buildBoardSiblingContext,
} = await import("../src/project-workbench.js");
const { AGENT_ORDER } = await import("../src/constants.js");
const { buildDelegationPayload } = await import("../src/harness.js");
const { journalSources } = await import("../src/analytics.js");
const { evidenceBlocks } = await import("../src/dream.js");

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
  assert.ok(presets.length >= 3);
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
  `;
  const bundle = await esbuild.build({
    stdin: { contents: "export * from './src/fractal-board.js';", resolveDir: path.resolve(import.meta.dirname, "..") },
    bundle: true,
    format: "esm",
    platform: "node",
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
