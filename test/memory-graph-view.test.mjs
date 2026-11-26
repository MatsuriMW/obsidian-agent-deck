import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class ItemView{constructor(l){this.leaf=l}};export class WorkspaceLeaf{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const {
  buildMemoryGraphModel,
  neighborhoodOf,
  seedGraphLayout,
  stepGraphLayout,
  graphBounds,
} = await import("../src/memory-graph-data.js");
const { MEMORY_GRAPH_STYLES, MEMORY_GRAPH_TYPE, MemoryGraphView } = await import("../src/memory-graph-view.js");

function makeSampleEntries() {
  return [
    {
      id: "m-1",
      path: "Agent Deck/记忆/m-1.md",
      title: "优先保留手写日记",
      text: "写回日记时绝不覆盖手写正文",
      kind: "lesson",
      state: "有效",
      verified: true,
      date: "2026-11-20",
      project: "agent-deck",
      concepts: ["[[日记无损]]", "[[块级锚点]]"],
      sources: ["[[日记/2026_11_20#^mem-111]]（用户日志，第 12 行）；原文：不要盖掉手写"],
      conflictsWith: ["[[Agent Deck/记忆/m-2.md]]"],
    },
    {
      id: "m-2",
      path: "Agent Deck/记忆/m-2.md",
      title: "允许直接整篇覆写日记",
      text: "早期方案曾直接覆写整篇笔记",
      kind: "fact",
      state: "有效",
      verified: false,
      date: "2026-11-18",
      project: "agent-deck",
      concepts: ["[[日记无损]]"],
      sources: ["[[日记/2026_11_18#^mem-222]]"],
      supersededBy: "[[m-1]]",
    },
    {
      id: "m-3",
      path: "Agent Deck/记忆/m-3.md",
      title: "偏爱莫兰迪克制配色",
      text: "图谱和看板界面优先用低饱和莫兰迪配色",
      kind: "preference",
      state: "有效",
      verified: false,
      date: "2026-11-22",
      project: "nautilus-spiral",
      concepts: ["[[日记无损]]", "[[UI 克制]]"],
      sources: ["[[日记/2026_11_22#^mem-333]]"],
    },
    {
      id: "m-4",
      path: "Agent Deck/记忆/m-4.md",
      title: "历史废弃偏好",
      text: "已拒绝的老记忆",
      kind: "preference",
      state: "已拒绝",
      verified: false,
      date: "2026-11-10",
      project: "agent-deck",
      concepts: ["[[日记无损]]"],
      sources: [],
    },
    {
      id: "m-5",
      path: "Agent Deck/记忆/m-5.md",
      title: "日志写入走单文件排队锁",
      text: "所有写回共用按文件路径排队的写入锁",
      kind: "pattern",
      state: "有效",
      verified: true,
      date: "2026-11-23",
      project: "agent-deck",
      concepts: ["[[日记无损]]"],
      sources: [],
    },
    {
      id: "m-6",
      path: "Agent Deck/记忆/m-6.md",
      title: "模型调用不能占写入锁",
      text: "LLM 请求必须在文件锁外面执行",
      kind: "lesson",
      state: "有效",
      verified: true,
      date: "2026-11-24",
      project: "agent-deck",
      concepts: ["[[日记无损]]"],
      sources: [],
    },
  ];
}

test("记忆图谱数据建模：过滤、冲突/替代边、候选概念与邻域提取", () => {
  const entries = makeSampleEntries();
  const hitStats = { "m-1": { count: 9 }, "m-5": { count: 3 } };
  const existingNotes = new Set(["Agent Deck/记忆/m-1.md", "块级锚点.md"]);

  const model = buildMemoryGraphModel(entries, {
    includeArchived: false,
    includeSources: true,
    hitStats,
    existingNotes,
    promotionMinCount: 5,
  });

  // m-4 (已拒绝) excluded by default -> 5 memories
  assert.equal(model.stats.memories, 5);
  assert.equal(model.stats.projects, 2);
  assert.equal(model.stats.sources, 3);
  assert.equal(model.stats.conflicts, 1);

  const cDiary = model.nodeById.get("concept:日记无损");
  assert.ok(cDiary);
  assert.equal(cDiary.memoryCount, 5);
  assert.equal(cDiary.promotionReady, true, "5 active hits without vault note marks concept promotion-ready");

  const cAnchor = model.nodeById.get("concept:块级锚点");
  assert.ok(cAnchor);
  assert.equal(cAnchor.existsInVault, true);
  assert.equal(cAnchor.promotionReady, false);

  assert.ok(model.edges.some((e) => e.edgeType === "conflict"), "conflict edge created");
  assert.ok(model.edges.some((e) => e.edgeType === "supersedes" && e.source === "mem:m-1" && e.target === "mem:m-2"), "supersededBy resolves directed edge m-1 -> m-2");

  const spot = neighborhoodOf(model, "mem:m-1", 2);
  assert.ok(spot.hop0.has("mem:m-1"));
  assert.ok(spot.hop1.has("mem:m-2"));
  assert.ok(spot.hop1.has("proj:agent-deck"));
  assert.ok(spot.hop2.has("mem:m-3"), "m-3 is 2 hops away via concept:日记无损");

  const pendingOnly = buildMemoryGraphModel(entries, { onlyPending: true });
  assert.equal(pendingOnly.stats.memories, 2);

  const conflictOnly = buildMemoryGraphModel(entries, { onlyConflicts: true });
  assert.equal(conflictOnly.stats.memories, 1);

  const withArchived = buildMemoryGraphModel(entries, { includeArchived: true });
  assert.equal(withArchived.stats.memories, 6);
});

test("记忆图谱物理布局：Force 与 Cluster（含 >40 节点 Barnes-Hut 路径）收敛且无 NaN", () => {
  const many = Array.from({ length: 48 }, (_, i) => ({
    id: `bulk-${i}`,
    path: `Agent Deck/记忆/bulk-${i}.md`,
    title: `记忆条目 ${i}`,
    text: `内容 ${i}`,
    kind: i % 2 === 0 ? "fact" : "lesson",
    state: "有效",
    verified: i % 3 === 0,
    project: `proj-${i % 4}`,
    concepts: [`[[概念-${i % 6}]]`],
    sources: [],
  }));
  const model = buildMemoryGraphModel(many);
  assert.ok(model.nodes.length > 40, "exercises Barnes-Hut quadtree branch");

  for (const layout of ["force", "cluster"]) {
    const state = seedGraphLayout(model, { layout, width: 960, height: 640 });
    if (layout === "cluster") {
      assert.equal(state.clusterCenters.size, 4);
    }
    let lastDisp = Infinity;
    for (let step = 0; step < 30; step++) {
      lastDisp = stepGraphLayout(model, state, { layout, alpha: 1 - step / 40, centerX: 480, centerY: 320 });
      assert.ok(Number.isFinite(lastDisp));
    }
    const b = graphBounds(model, state.positions);
    assert.ok(Number.isFinite(b.width) && b.width > 0 && Number.isFinite(b.height) && b.height > 0);
  }
});

function makeDomEl(tag = "div") {
  const listeners = new Map();
  const attrs = new Map();
  const classes = new Set();
  const el = {
    tag,
    children: [],
    style: {},
    value: "",
    textContent: "",
    selected: false,
    width: 0,
    height: 0,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c),
    },
    addClass(cls) {
      for (const c of String(cls || "").split(/\s+/).filter(Boolean)) classes.add(c);
    },
    removeClass(cls) {
      for (const c of String(cls || "").split(/\s+/).filter(Boolean)) classes.delete(c);
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) || null; },
    empty() { el.children = []; el.textContent = ""; },
    createDiv(opts = {}) { return el.createEl("div", opts); },
    createSpan(opts = {}) { return el.createEl("span", opts); },
    createEl(childTag, opts = {}) {
      const child = makeDomEl(childTag);
      if (opts.cls) child.addClass(opts.cls);
      if (opts.text != null) child.textContent = String(opts.text);
      if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, v);
      el.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async click() {
      for (const fn of listeners.get("click") || []) await fn({ preventDefault() {}, stopPropagation() {} });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
    getContext(kind) {
      if (kind !== "2d") return null;
      return {
        save() {}, restore() {}, setTransform() {}, translate() {}, scale() {},
        fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
        moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {},
        fill() {}, stroke() {}, setLineDash() {}, fillText() {},
        createRadialGradient() { return { addColorStop() {} }; },
      };
    },
    all() {
      const out = [el];
      for (const c of el.children) out.push(...c.all());
      return out;
    },
  };
  return el;
}

test("MemoryGraphView：双风格切换、交互筛选、检查抽屉动作与生命周期清理", async () => {
  assert.deepEqual(MEMORY_GRAPH_STYLES, ["editorial", "observatory"]);
  const entries = makeSampleEntries();
  const stateCalls = [];
  let refreshedBoards = 0;
  let saved = 0;
  const plugin = {
    settings: { ui: { memoryGraphStyle: "editorial", memoryGraphLayout: "force", memoryGraphColorBy: "kind" } },
    saveSettings: async () => { saved++; },
    refreshMemoryBoards: async () => { refreshedBoards++; },
    app: {
      vault: { getFiles: () => [{ path: "Agent Deck/记忆/m-1.md", basename: "m-1" }] },
      metadataCache: { getFirstLinkpathDest: () => null },
      workspace: { openLinkText() {} },
    },
    dreaming: {
      storeMode: true,
      cfg: { hitStats: { "m-1": { count: 4 } } },
      loadEntries: async () => entries,
      setEntryState: async (path, st) => { stateCalls.push({ path, st }); return true; },
      syncOverview: async () => "",
    },
  };

  const view = new MemoryGraphView({}, plugin);
  view.contentEl = makeDomEl("div");
  assert.equal(view.getViewType(), MEMORY_GRAPH_TYPE);

  await view.onOpen();
  assert.equal(view.contentEl.getAttribute("data-style"), "editorial");
  assert.equal(view.model.stats.memories, 5);

  // Switch between visual themes & layouts and ensure persistence
  view.setVisualStyle("observatory");
  assert.equal(view.contentEl.getAttribute("data-style"), "observatory");
  assert.equal(plugin.settings.ui.memoryGraphStyle, "observatory");
  assert.ok(saved >= 1);

  view.setLayoutMode("cluster");
  assert.equal(plugin.settings.ui.memoryGraphLayout, "cluster");
  view.setColorBy("trust");
  assert.equal(plugin.settings.ui.memoryGraphColorBy, "trust");

  // Draw explicitly into mock 2D context without errors
  view.draw();

  // Select pending memory m-2 and trigger confirm button from Inspector drawer
  view.selectNode("mem:m-2", { panTo: true });
  const confirmBtn = view._drawerEl.all().find((el) => el.tag === "button" && el.textContent === "✓ 确认");
  assert.ok(confirmBtn, "confirm button renders in Inspector drawer for pending memory");
  await confirmBtn.click();
  assert.deepEqual(stateCalls, [{ path: "Agent Deck/记忆/m-2.md", st: "有效" }]);
  assert.equal(refreshedBoards, 1);

  // Non-files storeMode renders migration prompt instead of throwing
  plugin.dreaming.storeMode = false;
  view.renderEmptyState();
  assert.equal(view._emptyEl.style.display, "flex");

  await view.onClose();
  assert.equal(view._rafId, 0);
});

test("记忆图谱集群分拆与节点尺度：无项目大库自动按类型拆岛、冷门概念保持轻量且无文本测量方法时可正常绘制", async () => {
  const mixed = Array.from({ length: 18 }, (_, i) => ({
    id: `u-${i}`,
    path: `Agent Deck/记忆/u-${i}.md`,
    title: `无项目记忆条目非常长的测试标题编号_${i}`,
    text: `正文 ${i}`,
    kind: ["fact", "preference", "lesson", "pattern"][i % 4],
    state: "有效",
    verified: i % 2 === 0,
    project: i < 2 ? "main-proj" : "",
    concepts: i === 0 ? ["[[核心概念]]", "[[边缘概念]]"] : i < 4 ? ["[[核心概念]]"] : [],
    sources: [],
  }));
  const model = buildMemoryGraphModel(mixed);
  const edgeC = model.nodeById.get("concept:边缘概念");
  const coreC = model.nodeById.get("concept:核心概念");
  assert.ok(edgeC.radius < 6.5 && edgeC.radius < coreC.radius, "degree-1 concept stays small vs hub concept");

  const st = seedGraphLayout(model, { layout: "cluster", width: 960, height: 640 });
  assert.ok(st.clusterCenters.has("__kind__:fact") && st.clusterCenters.has("__kind__:lesson"), "splits >=12 unassigned items into semantic kind islands");
  assert.ok(st.nodeClusterMap.get("mem:u-2")?.startsWith("__kind__:"));

  const plugin = {
    settings: { ui: { memoryGraphStyle: "editorial", memoryGraphLayout: "cluster", memoryGraphColorBy: "kind" } },
    saveSettings: async () => {},
    app: { vault: { getFiles: () => [] }, metadataCache: { getFirstLinkpathDest: () => null }, workspace: { openLinkText() {} } },
    dreaming: { storeMode: true, cfg: {}, loadEntries: async () => mixed },
  };
  const view = new MemoryGraphView({}, plugin);
  view.contentEl = makeDomEl("div");
  await view.onOpen();
  view.draw();
  view.setVisualStyle("observatory");
  view.zoomBy(1.25);
  view.draw();
  // Filter resulting in 0 matched nodes renders empty-filter prompt & resets cleanly; Escape clears focus/selection
  view.onlyConflicts = true;
  view.rebuildModel({ fit: true });
  assert.equal(view.model.nodes.length, 0);
  assert.equal(view._emptyEl.style.display, "flex");
  const resetBtn = view._emptyEl.all().find((el) => el.tag === "button" && el.textContent === "重置筛选");
  assert.ok(resetBtn, "renders reset filter button on 0-match filter");
  await resetBtn.click();
  assert.equal(view.onlyConflicts, false);
  assert.ok(view.model.nodes.length > 0);
  assert.equal(view._emptyEl.style.display, "none");

  await view.onClose();
});
