// 记忆知识图谱（standalone ItemView）：双视觉风格（编辑室莫兰迪纸墨 / 星图观测站）、
// 零外部依赖 Canvas 2D 渲染、力导向 / 项目聚类双布局、1–2 跳邻域聚焦与右侧检验抽屉。
import { ItemView } from "obsidian";
import { MEMORY_KINDS } from "./memory-store.js";
import { extractSourceNotes, normalizeLinkName } from "./memory-graph.js";
import { buildMemoryGraphModel, graphBounds, neighborhoodOf, seedGraphLayout, stepGraphLayout } from "./memory-graph-data.js";
import { t } from "./i18n.js";

export const MEMORY_GRAPH_TYPE = "agent-deck-memory-graph";
export const MEMORY_GRAPH_STYLES = ["editorial", "observatory"];

const VALID_LAYOUTS = new Set(["force", "cluster"]);
const VALID_COLORS = new Set(["kind", "trust", "heat"]);

function isDarkTheme() {
  return typeof document !== "undefined" && Boolean(document.body?.classList?.contains?.("theme-dark"));
}

function reducedMotionPreferred() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function themePalette(style, dark) {
  if (style === "observatory") {
    return {
      bg: "#090e1c",
      bgEdge: "#060913",
      vignette: "rgba(38, 72, 138, 0.28)",
      ringStroke: "rgba(145, 174, 228, 0.08)",
      tickStroke: "rgba(145, 174, 228, 0.16)",
      starDot: "rgba(210, 226, 255, 0.26)",
      clusterFill: "rgba(94, 184, 255, 0.045)",
      clusterStroke: "rgba(145, 185, 245, 0.18)",
      clusterText: "rgba(196, 218, 252, 0.86)",
      nodeStroke: "#0b1120",
      label: "#ecf2fc",
      muted: "#9eb2d4",
      pillBg: "rgba(11, 17, 32, 0.86)",
      pillBorder: "rgba(145, 174, 228, 0.22)",
      edge: "rgba(130, 165, 225, 0.18)",
      edgeHot: "rgba(165, 216, 255, 0.90)",
      sourceEdge: "rgba(110, 136, 182, 0.12)",
      conflict: "#ff6b78",
      supersedes: "#7f91b5",
      project: "#f1f5ff",
      concept: "#8fa8d4",
      conceptFill: "rgba(143, 168, 212, 0.16)",
      ghostConcept: "#9cc0f8",
      source: "#6e82a6",
      kinds: { fact: "#5eb8ff", preference: "#e879b9", lesson: "#f5b84c", pattern: "#3dd6a3" },
      trust: { high: "#3dd6a3", medium: "#f5b84c", low: "#6e82a6", disputed: "#ff6b78" },
      heatStops: ["#4b5b7a", "#6e8de0", "#e39e48", "#ff6b78"],
      glow: true,
      rings: true,
      starfield: true,
    };
  }
  return dark
    ? {
        bg: "#181715",
        gridDot: "rgba(235, 228, 216, 0.075)",
        clusterFill: "rgba(215, 202, 184, 0.045)",
        clusterStroke: "rgba(215, 202, 184, 0.15)",
        clusterText: "rgba(225, 214, 198, 0.78)",
        nodeStroke: "#181715",
        label: "#ece6dc",
        muted: "#aba091",
        pillBg: "rgba(24, 23, 21, 0.88)",
        pillBorder: "rgba(235, 228, 216, 0.14)",
        edge: "rgba(215, 202, 184, 0.16)",
        edgeHot: "rgba(236, 230, 220, 0.82)",
        sourceEdge: "rgba(190, 180, 165, 0.11)",
        conflict: "#e0766e",
        supersedes: "#a69c8e",
        project: "#ece5d8",
        concept: "#a89d8f",
        conceptFill: "rgba(168, 157, 143, 0.16)",
        ghostConcept: "#b9ad9e",
        source: "#999186",
        kinds: { fact: "#78a9d6", preference: "#cf86a8", lesson: "#dfb06a", pattern: "#6ec4a4" },
        trust: { high: "#6ec4a4", medium: "#dfb06a", low: "#999186", disputed: "#e0766e" },
        heatStops: ["#6e675e", "#8f85ad", "#cf8863", "#e06e67"],
        glow: false,
        rings: false,
        starfield: false,
      }
    : {
        bg: "#f8f6f1",
        gridDot: "rgba(60, 52, 44, 0.075)",
        clusterFill: "rgba(156, 144, 128, 0.055)",
        clusterStroke: "rgba(120, 108, 92, 0.16)",
        clusterText: "rgba(74, 65, 55, 0.78)",
        nodeStroke: "#f8f6f1",
        label: "#26221e",
        muted: "#6d645b",
        pillBg: "rgba(248, 246, 241, 0.90)",
        pillBorder: "rgba(60, 52, 44, 0.12)",
        edge: "rgba(102, 92, 80, 0.16)",
        edgeHot: "rgba(44, 39, 35, 0.78)",
        sourceEdge: "rgba(130, 120, 108, 0.12)",
        conflict: "#c9524c",
        supersedes: "#8a8177",
        project: "#262320",
        concept: "#7c7267",
        conceptFill: "rgba(124, 114, 103, 0.14)",
        ghostConcept: "#7c7267",
        source: "#9a9186",
        kinds: { fact: "#3d6e9e", preference: "#a45c7d", lesson: "#c28435", pattern: "#3e8b70" },
        trust: { high: "#3e8b70", medium: "#c28435", low: "#9a9186", disputed: "#c9524c" },
        heatStops: ["#b7b0a6", "#7a86a8", "#cc7d56", "#c9524c"],
        glow: false,
        rings: false,
        starfield: false,
      };
}

function drawPolygon(ctx, cx, cy, sides, radius, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export class MemoryGraphView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.entries = [];
    this.model = buildMemoryGraphModel([]);
    this.layoutState = seedGraphLayout(this.model);

    const ui = plugin?.settings?.ui || {};
    this.visualStyle = MEMORY_GRAPH_STYLES.includes(ui.memoryGraphStyle) ? ui.memoryGraphStyle : "editorial";
    this.layoutMode = VALID_LAYOUTS.has(ui.memoryGraphLayout) ? ui.memoryGraphLayout : "force";
    this.colorBy = VALID_COLORS.has(ui.memoryGraphColorBy) ? ui.memoryGraphColorBy : "kind";

    this.filterQuery = "";
    this.filterProject = "all";
    this.onlyPending = false;
    this.onlyConflicts = false;
    this.includeSources = false;
    this.includeArchived = false;

    this.selectedId = "";
    this.hoveredId = "";
    this.focusRootId = "";

    this.camera = { x: 480, y: 320, scale: 1 };
    this.canvasSize = { width: 960, height: 640 };

    this._rafId = 0;
    this._simAlpha = 0;
    this._settled = true;
    this._dragState = null;
    this._resizeObserver = null;
    this._canvas = null;
    this._stageEl = null;
    this._drawerEl = null;
    this._hudEl = null;
    this._tooltipEl = null;
    this._emptyEl = null;
    this._projectSelect = null;
    this._renderPending = false;
  }

  getViewType() { return MEMORY_GRAPH_TYPE; }
  getDisplayText() { return t("记忆知识图谱"); }
  getIcon() { return "git-fork"; }

  async onOpen() {
    this.buildShell();
    await this.refresh({ fit: true });
  }

  async onClose() {
    if (this._rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    this._dragState = null;
  }

  persistUiPref(key, value) {
    const ui = (this.plugin?.settings && (this.plugin.settings.ui ||= {}));
    if (ui) {
      ui[key] = value;
      this.plugin.saveSettings?.().catch?.(() => {});
    }
  }

  setVisualStyle(nextStyle) {
    if (!MEMORY_GRAPH_STYLES.includes(nextStyle) || nextStyle === this.visualStyle) return;
    this.visualStyle = nextStyle;
    this.contentEl?.setAttribute?.("data-style", nextStyle);
    this.persistUiPref("memoryGraphStyle", nextStyle);
    this.updateToolbarStates();
    this.updateLegend();
    this.requestDraw();
  }

  setLayoutMode(nextLayout) {
    if (!VALID_LAYOUTS.has(nextLayout) || nextLayout === this.layoutMode) return;
    this.layoutMode = nextLayout;
    this.persistUiPref("memoryGraphLayout", nextLayout);
    this.updateToolbarStates();
    this.reseedAndSettle(true);
  }

  setColorBy(nextColor) {
    if (!VALID_COLORS.has(nextColor) || nextColor === this.colorBy) return;
    this.colorBy = nextColor;
    this.persistUiPref("memoryGraphColorBy", nextColor);
    this.updateLegend();
    this.requestDraw();
  }

  existingNotesSet() {
    const files = this.plugin?.app?.vault?.getFiles?.() || [];
    const out = new Set();
    for (const f of files) {
      const p = String(f?.path || f || "");
      if (!p) continue;
      out.add(p);
      if (f?.basename) out.add(f.basename);
    }
    return out;
  }

  async refresh({ fit = false } = {}) {
    this.entries = await (this.plugin?.dreaming?.loadEntries?.() || Promise.resolve([]));
    this.rebuildModel({ fit });
  }

  rebuildModel({ fit = false } = {}) {
    const hitStats = this.plugin?.dreaming?.cfg?.hitStats || {};
    this.model = buildMemoryGraphModel(this.entries, {
      includeArchived: this.includeArchived,
      includeSources: this.includeSources,
      onlyPending: this.onlyPending,
      onlyConflicts: this.onlyConflicts,
      project: this.filterProject,
      query: this.filterQuery,
      hitStats,
      existingNotes: this.existingNotesSet(),
    });
    if (this.selectedId && !this.model.nodeById.has(this.selectedId)) this.selectedId = "";
    if (this.hoveredId && !this.model.nodeById.has(this.hoveredId)) this.hoveredId = "";
    if (this.focusRootId && !this.model.nodeById.has(this.focusRootId)) this.focusRootId = "";

    this.refreshProjectSelect();
    this.reseedAndSettle(fit);
    this.updateLegend();
    this.renderEmptyState();
    this.renderDrawer();
  }

  reseedAndSettle(fit = false) {
    const w = Math.max(360, this.canvasSize.width || 960);
    const h = Math.max(260, this.canvasSize.height || 640);
    this.layoutState = seedGraphLayout(this.model, { layout: this.layoutMode, width: w, height: h });
    this._simAlpha = 1;
    this._settled = false;
    const preWarmSteps = reducedMotionPreferred() ? 100 : 72;
    for (let i = 0; i < preWarmSteps && this.model.nodes.length; i++) {
      stepGraphLayout(this.model, this.layoutState, {
        layout: this.layoutMode,
        alpha: 1 - (i / (preWarmSteps + 28)),
        centerX: w * 0.5,
        centerY: h * 0.5,
      });
    }
    if (reducedMotionPreferred()) this._settled = true;
    if (fit) this.fitCamera();
    this.startLoop();
  }

  fitCamera() {
    const w = Math.max(320, this.canvasSize.width || 960);
    const h = Math.max(240, this.canvasSize.height || 640);
    const b = graphBounds(this.model, this.layoutState.positions);
    if (!b.width && !b.height) {
      this.camera = { x: w * 0.5, y: h * 0.5, scale: 1 };
      this.requestDraw();
      return;
    }
    const pad = 68;
    const scaleX = (w - pad * 2) / Math.max(80, b.width);
    const scaleY = (h - pad * 2) / Math.max(80, b.height);
    this.camera = {
      x: b.cx,
      y: b.cy,
      scale: Math.max(0.28, Math.min(1.15, Math.min(scaleX, scaleY))),
    };
    this.requestDraw();
  }

  zoomBy(factor) {
    this.camera.scale = Math.max(0.22, Math.min(3.6, (this.camera.scale || 1) * factor));
    this.requestDraw();
  }

  buildShell() {
    const root = this.contentEl;
    root.empty();
    root.addClass("ad-mem-graph");
    root.setAttribute?.("data-style", this.visualStyle);
    root.setAttribute?.("tabindex", "-1");
    if (!this._escBound) {
      this._escBound = true;
      root.addEventListener?.("keydown", (e) => {
        if (e.key === "Escape" && (this.focusRootId || this.selectedId)) {
          this.focusRootId = "";
          this.selectNode("");
        }
      });
    }

    const bar = root.createDiv({ cls: "ad-mem-graph__bar" });

    // 1. Style switcher (Editorial / Observatory)
    const styleGroup = bar.createDiv({ cls: "ad-mem-graph__seg" });
    this._styleBtns = new Map();
    for (const [id, label] of [["editorial", t("编辑室")], ["observatory", t("星图")]]) {
      const btn = styleGroup.createEl("button", { cls: "ad-mem-graph__segbtn", text: label });
      btn.addEventListener("click", () => this.setVisualStyle(id));
      this._styleBtns.set(id, btn);
    }

    // 2. Layout switcher (Force / Project Cluster)
    const layoutGroup = bar.createDiv({ cls: "ad-mem-graph__seg" });
    this._layoutBtns = new Map();
    for (const [id, label] of [["force", t("力导向")], ["cluster", t("项目聚类")]]) {
      const btn = layoutGroup.createEl("button", { cls: "ad-mem-graph__segbtn", text: label });
      btn.addEventListener("click", () => this.setLayoutMode(id));
      this._layoutBtns.set(id, btn);
    }

    // 3. Color perspective
    const colorSel = bar.createEl("select", { cls: "ad-mem-graph__sel", attr: { "aria-label": t("着色维度") } });
    for (const [id, label] of [["kind", t("按类型")], ["trust", t("按可信度")], ["heat", t("按热度")]]) {
      const opt = colorSel.createEl("option", { text: label });
      opt.value = id;
      if (this.colorBy === id) opt.selected = true;
    }
    colorSel.addEventListener("change", () => this.setColorBy(colorSel.value));

    // 4. Project filter
    this._projectSelect = bar.createEl("select", { cls: "ad-mem-graph__sel", attr: { "aria-label": t("按项目筛选") } });
    this._projectSelect.addEventListener("change", () => {
      this.filterProject = this._projectSelect.value || "all";
      this.rebuildModel({ fit: true });
    });

    // 5. Search box
    const searchIn = bar.createEl("input", {
      cls: "ad-mem-graph__search",
      attr: { type: "search", placeholder: t("搜索记忆、概念或项目…") },
    });
    this._searchInput = searchIn;
    searchIn.value = this.filterQuery;
    searchIn.addEventListener("input", () => {
      this.filterQuery = searchIn.value || "";
      this.rebuildModel({ fit: true });
    });

    // 6. Toggle pills
    const filterGroup = bar.createDiv({ cls: "ad-mem-graph__group" });
    this._filterPills = [];
    const pills = [
      { key: "onlyPending", label: t("待确认") },
      { key: "onlyConflicts", label: t("仅冲突") },
      { key: "includeSources", label: t("来源") },
      { key: "includeArchived", label: t("含归档") },
    ];
    for (const spec of pills) {
      const pill = filterGroup.createEl("button", { cls: "ad-mem-graph__pill", text: spec.label });
      pill.addEventListener("click", () => {
        this[spec.key] = !this[spec.key];
        this.updateToolbarStates();
        this.rebuildModel({ fit: true });
      });
      this._filterPills.push({ key: spec.key, el: pill });
    }

    // 7. Utility actions
    const actGroup = bar.createDiv({ cls: "ad-mem-graph__group" });
    actGroup.createEl("button", { cls: "ad-mem-graph__btn", text: t("适配视野") }).addEventListener("click", () => this.fitCamera());
    actGroup.createEl("button", { cls: "ad-mem-graph__btn", text: t("刷新") }).addEventListener("click", () => this.refresh({ fit: false }));
    actGroup.createEl("button", { cls: "ad-mem-graph__btn", text: t("看板") }).addEventListener("click", () => this.plugin?.openMemoryBoard?.());

    // Stage
    this._stageEl = root.createDiv({ cls: "ad-mem-graph__stage" });
    this._canvas = this._stageEl.createEl("canvas", { cls: "ad-mem-graph__canvas" });
    this._hudEl = this._stageEl.createDiv({ cls: "ad-mem-graph__hud" });
    this._tooltipEl = this._stageEl.createDiv({ cls: "ad-mem-graph__tooltip" });
    this._tooltipEl.style.display = "none";
    this._drawerEl = this._stageEl.createDiv({ cls: "ad-mem-graph__drawer" });
    this._drawerEl.style.display = "none";
    this._emptyEl = this._stageEl.createDiv({ cls: "ad-mem-graph__empty" });
    this._emptyEl.style.display = "none";
    const zoomBox = this._stageEl.createDiv({ cls: "ad-mem-graph__zoom" });
    zoomBox.createEl("button", { cls: "ad-mem-graph__btn ad-mem-graph__zoombtn", text: "−" })
      .addEventListener("click", () => this.zoomBy(0.8));
    zoomBox.createEl("button", { cls: "ad-mem-graph__btn ad-mem-graph__zoombtn", text: t("适配视野") })
      .addEventListener("click", () => this.fitCamera());
    zoomBox.createEl("button", { cls: "ad-mem-graph__btn ad-mem-graph__zoombtn", text: "+" })
      .addEventListener("click", () => this.zoomBy(1.25));

    this.bindCanvasEvents();
    this.observeResize();
    this.updateToolbarStates();
  }

  refreshProjectSelect() {
    const sel = this._projectSelect;
    if (!sel) return;
    sel.empty();
    sel.createEl("option", { text: t("全部项目") }).value = "all";
    for (const pname of this.model.projects || []) {
      const opt = sel.createEl("option", { text: pname });
      opt.value = pname;
      if (this.filterProject === pname) opt.selected = true;
    }
    if (this.filterProject !== "all" && !(this.model.projects || []).includes(this.filterProject)) {
      this.filterProject = "all";
    }
  }

  updateToolbarStates() {
    for (const [id, el] of this._styleBtns?.entries?.() || []) {
      el.classList?.toggle?.("is-active", this.visualStyle === id);
    }
    for (const [id, el] of this._layoutBtns?.entries?.() || []) {
      el.classList?.toggle?.("is-active", this.layoutMode === id);
    }
    for (const { key, el } of this._filterPills || []) {
      el.classList?.toggle?.("is-active", Boolean(this[key]));
    }
  }

  observeResize() {
    const updateSize = () => {
      const rect = this._stageEl?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        this.canvasSize = { width: rect.width, height: rect.height };
        this.requestDraw();
      }
    };
    if (typeof ResizeObserver !== "undefined" && this._stageEl) {
      this._resizeObserver = new ResizeObserver(updateSize);
      this._resizeObserver.observe(this._stageEl);
    }
    updateSize();
  }

  screenToWorld(sx, sy) {
    const w = this.canvasSize.width || 960;
    const h = this.canvasSize.height || 640;
    const s = this.camera.scale || 1;
    return {
      x: (sx - w * 0.5) / s + this.camera.x,
      y: (sy - h * 0.5) / s + this.camera.y,
    };
  }

  hitTest(sx, sy) {
    const world = this.screenToWorld(sx, sy);
    const pad = 6 / Math.max(0.3, this.camera.scale || 1);
    let best = null;
    let bestDist = Infinity;
    for (let i = this.model.nodes.length - 1; i >= 0; i--) {
      const n = this.model.nodes[i];
      const p = this.layoutState.positions.get(n.id);
      if (!p) continue;
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      const hitR = (n.radius || 7) + pad;
      if (d <= hitR && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  bindCanvasEvents() {
    const canvas = this._canvas;
    if (!canvas) return;

    const localXY = (e) => {
      const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
      return { sx: (e.clientX || 0) - rect.left, sy: (e.clientY || 0) - rect.top };
    };

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const { sx, sy } = localXY(e);
      const before = this.screenToWorld(sx, sy);
      const factor = Math.exp(-(e.deltaY || 0) * 0.0014);
      const nextScale = Math.max(0.22, Math.min(3.6, (this.camera.scale || 1) * factor));
      const w = this.canvasSize.width || 960;
      const h = this.canvasSize.height || 640;
      this.camera.scale = nextScale;
      this.camera.x = before.x - (sx - w * 0.5) / nextScale;
      this.camera.y = before.y - (sy - h * 0.5) / nextScale;
      this.requestDraw();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const { sx, sy } = localXY(e);
      const hit = this.hitTest(sx, sy);
      canvas.setPointerCapture?.(e.pointerId);
      if (hit) {
        const pos = this.layoutState.positions.get(hit.id);
        this._dragState = {
          kind: "node",
          nodeId: hit.id,
          startX: sx,
          startY: sy,
          moved: false,
          pos,
        };
      } else {
        this._dragState = {
          kind: "pan",
          startX: sx,
          startY: sy,
          camX: this.camera.x,
          camY: this.camera.y,
          moved: false,
        };
        canvas.classList?.add?.("is-panning");
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const { sx, sy } = localXY(e);
      if (this._dragState) {
        const ds = this._dragState;
        const dist = Math.hypot(sx - ds.startX, sy - ds.startY);
        if (dist > 3) ds.moved = true;
        if (ds.kind === "node" && ds.pos && ds.moved) {
          const w = this.screenToWorld(sx, sy);
          ds.pos.fx = w.x;
          ds.pos.fy = w.y;
          ds.pos.x = w.x;
          ds.pos.y = w.y;
          this._simAlpha = Math.max(this._simAlpha, 0.35);
          this._settled = false;
          this.startLoop();
          this.updateTooltip(null);
          return;
        }
        if (ds.kind === "pan") {
          const s = this.camera.scale || 1;
          this.camera.x = ds.camX - (sx - ds.startX) / s;
          this.camera.y = ds.camY - (sy - ds.startY) / s;
          this.requestDraw();
          this.updateTooltip(null);
          return;
        }
      }

      const hit = this.hitTest(sx, sy);
      const nextHover = hit ? hit.id : "";
      canvas.classList?.toggle?.("is-hover", Boolean(hit));
      if (nextHover !== this.hoveredId) {
        this.hoveredId = nextHover;
        this.requestDraw();
      }
      this.updateTooltip(hit, sx, sy);
    });

    canvas.addEventListener("pointerup", () => {
      canvas.classList?.remove?.("is-panning");
      const ds = this._dragState;
      this._dragState = null;
      if (!ds) return;
      if (ds.kind === "node" && ds.pos) {
        ds.pos.fx = null;
        ds.pos.fy = null;
        if (!ds.moved) {
          this.selectNode(ds.nodeId);
        }
      } else if (ds.kind === "pan" && !ds.moved) {
        this.selectNode("");
      }
    });

    canvas.addEventListener("pointerleave", () => {
      if (this.hoveredId) {
        this.hoveredId = "";
        this.requestDraw();
      }
      this.updateTooltip(null);
    });

    canvas.addEventListener("dblclick", (e) => {
      const { sx, sy } = localXY(e);
      const hit = this.hitTest(sx, sy);
      if (!hit) return;
      if (hit.nodeType === "memory" && hit.path) {
        this.plugin?.app?.workspace?.openLinkText?.(hit.path, "", false);
      } else if (hit.nodeType === "source" && hit.path) {
        this.openSourceNote(hit.path);
      } else if ((hit.nodeType === "project" || hit.nodeType === "concept") && hit.existsInVault) {
        this.openWikiTarget(hit.label);
      }
    });
  }

  openWikiTarget(rawName) {
    const clean = normalizeLinkName(rawName);
    if (!clean) return;
    const dest = this.plugin?.app?.metadataCache?.getFirstLinkpathDest?.(clean, "");
    this.plugin?.app?.workspace?.openLinkText?.(dest?.path || clean, "", false);
  }

  openSourceNote(link) {
    const target = link.split("#", 1)[0];
    const app = this.plugin?.app;
    const file = app?.metadataCache?.getFirstLinkpathDest?.(target, "");
    if (!file) return this.plugin?.notice?.(t("找不到笔记：{path}", { path: target }));
    return app.workspace?.openLinkText?.(file.path + link.slice(target.length), "", false);
  }

  selectNode(nodeId, { panTo = false } = {}) {
    this.selectedId = nodeId && this.model.nodeById.has(nodeId) ? nodeId : "";
    if (!this.selectedId && this.focusRootId) this.focusRootId = "";
    if (panTo && this.selectedId) {
      const p = this.layoutState.positions.get(this.selectedId);
      if (p) {
        this.camera.x = p.x;
        this.camera.y = p.y;
        this.camera.scale = Math.max(this.camera.scale || 1, 1.05);
      }
    }
    this.renderDrawer();
    this.requestDraw();
  }

  updateTooltip(node, sx = 0, sy = 0) {
    const tip = this._tooltipEl;
    if (!tip) return;
    if (!node) {
      tip.style.display = "none";
      return;
    }
    tip.empty();
    tip.createDiv({ cls: "ad-mem-graph__tooltiptitle", text: node.label });
    let meta = "";
    if (node.nodeType === "memory") {
      const kindLabel = t(MEMORY_KINDS[node.kind] || node.kind);
      const ver = node.verified ? t("已确认") : t("待确认");
      meta = `${kindLabel} · ${ver}${node.hits ? ` · ${t("命中 {n}", { n: node.hits })}` : ""}`;
    } else if (node.nodeType === "project") {
      meta = t("项目枢纽 · {n} 条记忆", { n: node.memoryCount });
    } else if (node.nodeType === "concept") {
      meta = node.promotionReady
        ? t("概念 · {n} 条记忆（可晋升为概念页）", { n: node.memoryCount })
        : t("概念 · {n} 条记忆", { n: node.memoryCount });
    } else if (node.nodeType === "source") {
      meta = t("来源笔记 · {n} 条记忆", { n: node.memoryCount });
    }
    tip.createDiv({ cls: "ad-mem-graph__tooltipmeta", text: meta });
    tip.style.display = "block";
    const left = Math.min(Math.max(8, sx + 14), Math.max(12, (this.canvasSize.width || 600) - 240));
    const top = Math.min(Math.max(8, sy + 14), Math.max(12, (this.canvasSize.height || 400) - 70));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  updateLegend() {
    const hud = this._hudEl;
    if (!hud) return;
    hud.empty();
    const s = this.model.stats;
    hud.createDiv({
      cls: "ad-mem-graph__stats",
      text: t("{m} 记忆 · {p} 项目 · {c} 概念 · {e} 连线", {
        m: s.memories,
        p: s.projects,
        c: s.concepts,
        e: s.edges,
      }),
    });

    const pal = themePalette(this.visualStyle, isDarkTheme());
    const lg = hud.createDiv({ cls: "ad-mem-graph__legend" });
    const addSwatch = (label, color, shapeCls = "") => {
      const item = lg.createSpan({ cls: "ad-mem-graph__lgitem" });
      const sw = item.createSpan({ cls: `ad-mem-graph__swatch ${shapeCls}`.trim() });
      sw.style.background = color;
      sw.style.color = color;
      item.createSpan({ text: label });
    };

    if (this.colorBy === "kind") {
      for (const [k, label] of Object.entries(MEMORY_KINDS)) {
        addSwatch(t(label), pal.kinds[k]);
      }
    } else if (this.colorBy === "trust") {
      addSwatch(t("高可信"), pal.trust.high);
      addSwatch(t("中可信"), pal.trust.medium);
      addSwatch(t("低可信"), pal.trust.low);
      addSwatch(t("有冲突"), pal.trust.disputed);
    } else {
      addSwatch(t("冷门"), pal.heatStops[0]);
      addSwatch(t("常用"), pal.heatStops[1]);
      addSwatch(t("高频"), pal.heatStops[3]);
    }
    addSwatch(t("项目"), pal.project, "is-hex");
    addSwatch(t("概念"), pal.concept, "is-diamond");
    if (s.ghostConcepts > 0) addSwatch(t("候选概念"), pal.ghostConcept, "is-diamond is-ghost");
    if (this.includeSources) addSwatch(t("来源"), pal.source, "is-square");
  }

  renderEmptyState() {
    const empty = this._emptyEl;
    if (!empty) return;
    const isFileStore = Boolean(this.plugin?.dreaming?.storeMode);
    if (isFileStore && this.entries.length > 0 && this.model.nodes.length > 0) {
      empty.style.display = "none";
      return;
    }
    empty.empty();
    empty.style.display = "flex";
    const card = empty.createDiv({ cls: "ad-mem-graph__emptycard" });
    if (!isFileStore) {
      card.createDiv({ cls: "ad-mem-graph__emptytitle", text: t("尚未启用一文一条记忆库") });
      card.createDiv({
        cls: "ad-mem-graph__emptydesc",
        text: t("记忆知识图谱读取 {dir} 目录下的一文一条笔记与图谱连线。迁移后即可浏览项目、概念、来源与冲突网络。", { dir: "Agent Deck/记忆/" }),
      });
      const actions = card.createDiv({ cls: "ad-mem-graph__actions" });
      const migrateBtn = actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("初始化 / 迁移记忆库") });
      migrateBtn.addEventListener("click", async () => {
        await this.plugin?.migrateMemoryToFiles?.();
        await this.refresh({ fit: true });
      });
    } else if (this.entries.length > 0 && this.model.nodes.length === 0) {
      card.createDiv({ cls: "ad-mem-graph__emptytitle", text: t("没有匹配的记忆节点") });
      card.createDiv({
        cls: "ad-mem-graph__emptydesc",
        text: t("当前筛选条件或搜索词未命中记忆节点，可以重置筛选查看全部图谱。"),
      });
      const actions = card.createDiv({ cls: "ad-mem-graph__actions" });
      actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("重置筛选") }).addEventListener("click", () => {
        this.filterQuery = "";
        this.filterProject = "all";
        this.onlyPending = false;
        this.onlyConflicts = false;
        if (this._searchInput) this._searchInput.value = "";
        if (this._projectSelect) this._projectSelect.value = "all";
        this.updateToolbarStates();
        this.rebuildModel({ fit: true });
      });
    } else {
      card.createDiv({ cls: "ad-mem-graph__emptytitle", text: t("记忆库暂时为空") });
      card.createDiv({
        cls: "ad-mem-graph__emptydesc",
        text: t("可以先运行一次 Dream 提炼近期会话记忆，或去记忆看板手动新建与导入。"),
      });
      const actions = card.createDiv({ cls: "ad-mem-graph__actions" });
      actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("立即 Dream") }).addEventListener("click", async () => {
        await this.plugin?.dreaming?.run?.(true, { drain: true });
        await this.refresh({ fit: true });
      });
      actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("打开记忆看板") }).addEventListener("click", () => {
        this.plugin?.openMemoryBoard?.();
      });
    }
  }

  renderDrawer() {
    const drawer = this._drawerEl;
    if (!drawer) return;
    const node = this.selectedId ? this.model.nodeById.get(this.selectedId) : null;
    if (!node) {
      drawer.style.display = "none";
      drawer.empty();
      return;
    }
    drawer.empty();
    drawer.style.display = "flex";

    const head = drawer.createDiv({ cls: "ad-mem-graph__drawerhead" });
    head.createDiv({ cls: "ad-mem-graph__drawertitle", text: node.label });
    head.createEl("button", { cls: "ad-mem-graph__close", text: "✕", attr: { "aria-label": t("关闭详情") } })
      .addEventListener("click", () => this.selectNode(""));

    const badges = drawer.createDiv({ cls: "ad-mem-graph__badges" });
    if (node.nodeType === "memory") {
      badges.createSpan({ cls: "ad-mem-graph__badge", text: t(MEMORY_KINDS[node.kind] || node.kind) });
      badges.createSpan({ cls: "ad-mem-graph__badge", text: t(node.state || "有效") });
      badges.createSpan({
        cls: `ad-mem-graph__badge ${node.verified ? "is-ok" : "is-warn"}`,
        text: node.verified ? t("✓ 已确认") : t("待确认"),
      });
      if (node.hasConflict) {
        badges.createSpan({ cls: "ad-mem-graph__badge is-bad", text: t("⚠ 冲突") });
      }
      if (node.date) badges.createSpan({ cls: "ad-mem-graph__badge", text: node.date });
      if (node.hits > 0) badges.createSpan({ cls: "ad-mem-graph__badge", text: t("命中 {n}", { n: node.hits }) });

      const entryText = node.entry?.text || "";
      if (entryText && entryText !== node.label) {
        drawer.createDiv({ cls: "ad-mem-graph__body", text: entryText });
      }
      if (node.entry?.description) {
        drawer.createDiv({ cls: "ad-mem-graph__tooltipmeta", text: node.entry.description });
      }

      const actions = drawer.createDiv({ cls: "ad-mem-graph__actions" });
      if (node.state === "有效" && !node.verified) {
        const okBtn = actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("✓ 确认") });
        okBtn.addEventListener("click", async () => {
          await this.plugin?.dreaming?.setEntryState?.(node.path, "有效");
          this.plugin?.dreaming?.syncOverview?.().catch?.(() => {});
          await this.plugin?.refreshMemoryBoards?.();
          await this.refresh({ fit: false });
        });
      }
      if (node.state !== "已拒绝") {
        const rejBtn = actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("✕ 拒绝") });
        rejBtn.addEventListener("click", async () => {
          await this.plugin?.dreaming?.setEntryState?.(node.path, "已拒绝");
          this.plugin?.dreaming?.syncOverview?.().catch?.(() => {});
          await this.plugin?.refreshMemoryBoards?.();
          await this.refresh({ fit: false });
        });
      }
      if (node.path) {
        actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("打开笔记") }).addEventListener("click", () => {
          this.plugin?.app?.workspace?.openLinkText?.(node.path, "", false);
        });
      }
      const focused = this.focusRootId === node.id;
      actions.createEl("button", {
        cls: `ad-mem-graph__btn ${focused ? "is-active" : ""}`.trim(),
        text: focused ? t("退出聚焦") : t("聚焦邻域"),
      }).addEventListener("click", () => {
        this.focusRootId = focused ? "" : node.id;
        this.renderDrawer();
        this.requestDraw();
      });

      if (node.project || node.concepts?.length) {
        const relSec = drawer.createDiv({ cls: "ad-mem-graph__sec" });
        relSec.createDiv({ cls: "ad-mem-graph__seclabel", text: t("关联项目与概念") });
        const list = relSec.createDiv({ cls: "ad-mem-graph__chiplist" });
        if (node.project) {
          const pId = "proj:" + node.project;
          list.createEl("button", { cls: "ad-mem-graph__chip", text: node.project }).addEventListener("click", () => {
            if (this.model.nodeById.has(pId)) this.selectNode(pId, { panTo: true });
          });
        }
        for (const c of node.concepts || []) {
          const cId = "concept:" + c;
          const cNode = this.model.nodeById.get(cId);
          list.createEl("button", {
            cls: `ad-mem-graph__chip ${cNode?.promotionReady ? "is-ghost" : ""}`.trim(),
            text: cNode?.promotionReady ? `${c} ✦` : c,
          }).addEventListener("click", () => {
            if (cNode) this.selectNode(cId, { panTo: true });
          });
        }
      }

      if (node.conflictsWith?.length) {
        const cSec = drawer.createDiv({ cls: "ad-mem-graph__sec" });
        cSec.createDiv({ cls: "ad-mem-graph__seclabel", text: t("冲突对象") });
        const list = cSec.createDiv({ cls: "ad-mem-graph__chiplist" });
        for (const rawC of node.conflictsWith) {
          const cname = normalizeLinkName(rawC);
          list.createEl("button", { cls: "ad-mem-graph__chip is-conflict", text: cname || rawC })
            .addEventListener("click", () => this.openWikiTarget(cname || rawC));
        }
      }

      if (node.parsedSources?.length) {
        const sSec = drawer.createDiv({ cls: "ad-mem-graph__sec" });
        sSec.createDiv({ cls: "ad-mem-graph__seclabel", text: t("来源定位 ({n})", { n: node.parsedSources.length }) });
        for (const src of node.parsedSources) {
          const link = extractSourceNotes([src.raw])[0]?.slice(2, -2) || "";
          const item = sSec.createEl("button", { cls: "ad-mem-graph__relitem" });
          item.createDiv({ cls: "ad-mem-graph__reltitle", text: src.quote || src.target || src.raw });
          item.createDiv({ cls: "ad-mem-graph__relmeta", text: link });
          item.disabled = !link;
          if (link) item.addEventListener("click", () => this.openSourceNote(link));
        }
      }
      return;
    }

    // Hub / Concept / Source inspector
    const hubKind = node.nodeType === "project" ? t("项目枢纽") : node.nodeType === "concept" ? t("概念节点") : t("来源笔记");
    badges.createSpan({ cls: "ad-mem-graph__badge", text: hubKind });
    badges.createSpan({ cls: "ad-mem-graph__badge", text: t("{n} 条关联记忆", { n: node.memoryCount || node.degree || 0 }) });
    if (node.promotionReady) {
      badges.createSpan({ cls: "ad-mem-graph__badge is-warn", text: t("可晋升为概念页") });
    } else if (node.existsInVault) {
      badges.createSpan({ cls: "ad-mem-graph__badge is-ok", text: t("库内已有笔记") });
    }

    const actions = drawer.createDiv({ cls: "ad-mem-graph__actions" });
    if (node.nodeType === "source" && node.path) {
      actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("打开笔记") })
        .addEventListener("click", () => this.openSourceNote(node.path));
    } else if (node.existsInVault) {
      actions.createEl("button", { cls: "ad-mem-graph__btn", text: t("打开笔记") })
        .addEventListener("click", () => this.openWikiTarget(node.label));
    }
    const focused = this.focusRootId === node.id;
    actions.createEl("button", {
      cls: `ad-mem-graph__btn ${focused ? "is-active" : ""}`.trim(),
      text: focused ? t("退出聚焦") : t("聚焦邻域"),
    }).addEventListener("click", () => {
      this.focusRootId = focused ? "" : node.id;
      this.renderDrawer();
      this.requestDraw();
    });

    const connectedIds = [...(this.model.adj.get(node.id) || [])];
    const memNeighbors = connectedIds
      .map((id) => this.model.nodeById.get(id))
      .filter((n) => n && n.nodeType === "memory");
    if (memNeighbors.length) {
      const mSec = drawer.createDiv({ cls: "ad-mem-graph__sec" });
      mSec.createDiv({ cls: "ad-mem-graph__seclabel", text: t("关联记忆") });
      for (const mn of memNeighbors.slice(0, 30)) {
        const item = mSec.createEl("button", { cls: "ad-mem-graph__relitem" });
        item.createDiv({ cls: "ad-mem-graph__reltitle", text: mn.label });
        item.createDiv({
          cls: "ad-mem-graph__relmeta",
          text: `${t(MEMORY_KINDS[mn.kind] || mn.kind)} · ${mn.verified ? t("已确认") : t("待确认")}${mn.date ? ` · ${mn.date}` : ""}`,
        });
        item.addEventListener("click", () => this.selectNode(mn.id, { panTo: true }));
      }
    }
  }

  startLoop() {
    this.requestDraw();
    if (this._settled || this._rafId || typeof requestAnimationFrame !== "function") return;
    const tick = () => {
      this._rafId = 0;
      if (!this.model.nodes.length || this._settled) {
        this.draw();
        return;
      }
      const w = Math.max(360, this.canvasSize.width || 960);
      const h = Math.max(260, this.canvasSize.height || 640);
      const disp = stepGraphLayout(this.model, this.layoutState, {
        layout: this.layoutMode,
        alpha: this._simAlpha,
        centerX: w * 0.5,
        centerY: h * 0.5,
      });
      this._simAlpha = Math.max(0.08, this._simAlpha * 0.985);
      this.draw();
      if (disp < 0.08 && !this._dragState) {
        this._settled = true;
        return;
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  requestDraw() {
    if (this._renderPending) return;
    this._renderPending = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        this._renderPending = false;
        this.draw();
      });
    } else {
      this._renderPending = false;
      this.draw();
    }
  }

  nodeFillColor(node, pal) {
    if (node.nodeType === "project") return pal.project;
    if (node.nodeType === "concept") return node.promotionReady ? pal.ghostConcept : pal.concept;
    if (node.nodeType === "source") return pal.source;

    if (this.colorBy === "trust") {
      if (node.hasConflict) return pal.trust.disputed;
      return pal.trust[node.trust] || pal.trust.medium;
    }
    if (this.colorBy === "heat") {
      const maxH = Math.max(1, this.model.maxHits || 1);
      const ratio = Math.min(1, Math.log2(1 + (node.hits || 0)) / Math.log2(1 + maxH));
      const idx = ratio >= 0.72 ? 3 : ratio >= 0.4 ? 2 : ratio > 0.05 ? 1 : 0;
      return pal.heatStops[idx];
    }
    return pal.kinds[node.kind] || pal.kinds.fact;
  }

  draw() {
    const canvas = this._canvas;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;

    const w = Math.max(240, this.canvasSize.width || 960);
    const h = Math.max(200, this.canvasSize.height || 640);
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) ? Math.min(2.5, window.devicePixelRatio) : 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    const dark = isDarkTheme();
    const pal = themePalette(this.visualStyle, dark);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Background plate
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.visualStyle === "observatory") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const maxR = Math.hypot(w, h) * 0.58;
      const grad = ctx.createRadialGradient(cx, cy, 24, cx, cy, maxR);
      grad.addColorStop(0, pal.vignette);
      grad.addColorStop(1, pal.bgEdge || "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      if (pal.starfield) {
        ctx.fillStyle = pal.starDot;
        for (let i = 0; i < 64; i++) {
          const sx = ((i * 2654435761) % 997) / 997 * w;
          const sy = (((i + 17) * 1597334677) % 991) / 991 * h;
          const sr = i % 5 === 0 ? 1.3 : 0.8;
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = pal.ringStroke;
      ctx.lineWidth = 1;
      for (const r of [110, 210, 320, 440]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = pal.tickStroke;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 314, cy + Math.sin(a) * 314);
        ctx.lineTo(cx + Math.cos(a) * 326, cy + Math.sin(a) * 326);
        ctx.stroke();
      }
    } else {
      const step = 28;
      ctx.fillStyle = pal.gridDot;
      for (let gx = (w % step) * 0.5; gx < w; gx += step) {
        for (let gy = (h % step) * 0.5; gy < h; gy += step) {
          ctx.fillRect(gx, gy, 1.2, 1.2);
        }
      }
    }

    // 2. Camera transform
    const scale = this.camera.scale || 1;
    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(scale, scale);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 3. Project / semantic cluster halos in cluster mode
    if (this.layoutMode === "cluster" && this.layoutState.clusterCenters?.size) {
      for (const cc of this.layoutState.clusterCenters.values()) {
        if (!cc.label && !cc.isKindCluster && cc.count === 0) continue;
        const clTitle = cc.label
          ? `${cc.label} · ${cc.count}`
          : cc.isKindCluster
            ? `${t(MEMORY_KINDS[cc.kind] || cc.kind)} · ${cc.count}`
            : "";
        ctx.save();
        ctx.fillStyle = pal.clusterFill;
        ctx.strokeStyle = pal.clusterStroke;
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, cc.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (clTitle) {
          ctx.setLineDash([]);
          ctx.fillStyle = pal.clusterText;
          ctx.font = `600 ${Math.max(10.5, 12 / Math.sqrt(scale))}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(clTitle, cc.x, cc.y - cc.radius - 8);
        }
        ctx.restore();
      }
    }

    // 4. Spotlight state
    const activeId = this.hoveredId || this.focusRootId || this.selectedId;
    const spot = activeId ? neighborhoodOf(this.model, activeId, 2) : null;

    // 5. Edges
    for (const edge of this.model.edges) {
      const ps = this.layoutState.positions.get(edge.source);
      const pt = this.layoutState.positions.get(edge.target);
      if (!ps || !pt) continue;

      const inSpot = !spot || spot.edgeSet.has(edge);
      const isDirect = spot && (edge.source === activeId || edge.target === activeId);
      const alpha = !spot ? 1 : isDirect ? 1 : inSpot ? 0.45 : 0.045;

      ctx.save();
      ctx.globalAlpha = alpha;
      const mx = (ps.x + pt.x) * 0.5;
      const my = (ps.y + pt.y) * 0.5;
      const dx = pt.x - ps.x;
      const dy = pt.y - ps.y;
      const bend = edge.edgeType === "conflict" ? 0.16 : 0.09;
      const cpx = mx - dy * bend;
      const cpy = my + dx * bend;

      if (edge.edgeType === "conflict") {
        ctx.strokeStyle = pal.conflict;
        ctx.lineWidth = (isDirect ? 2.1 : 1.35) / scale;
        ctx.setLineDash([5 / scale, 3 / scale]);
      } else if (edge.edgeType === "supersedes") {
        ctx.strokeStyle = pal.supersedes;
        ctx.lineWidth = 1.2 / scale;
        ctx.setLineDash([3 / scale, 3 / scale]);
      } else if (edge.edgeType === "source") {
        ctx.strokeStyle = isDirect ? pal.edgeHot : pal.sourceEdge;
        ctx.lineWidth = 0.9 / scale;
        ctx.setLineDash([2 / scale, 3 / scale]);
      } else {
        ctx.strokeStyle = isDirect ? pal.edgeHot : pal.edge;
        ctx.lineWidth = (isDirect ? 1.6 : 0.95) / scale;
      }

      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.quadraticCurveTo(cpx, cpy, pt.x, pt.y);
      ctx.stroke();

      if (edge.edgeType === "conflict" && inSpot) {
        ctx.setLineDash([]);
        ctx.fillStyle = pal.conflict;
        drawPolygon(ctx, (mx + cpx) * 0.5, (my + cpy) * 0.5, 4, 3 / Math.sqrt(scale));
        ctx.fill();
      }
      ctx.restore();
    }

    // 6. Nodes & collect label candidates
    const labelCandidates = [];
    for (const node of this.model.nodes) {
      const p = this.layoutState.positions.get(node.id);
      if (!p) continue;

      const isSelf = node.id === activeId;
      const isHop1 = spot?.hop1?.has(node.id);
      const isHop2 = spot?.hop2?.has(node.id);
      const alpha = !spot ? 1 : isSelf || isHop1 ? 1 : isHop2 ? 0.58 : 0.12;
      const fill = this.nodeFillColor(node, pal);
      const r = node.radius || 7;

      ctx.save();
      ctx.globalAlpha = alpha;

      if (pal.glow && (isSelf || isHop1 || node.nodeType === "project" || (node.nodeType === "memory" && node.verified))) {
        ctx.shadowColor = fill;
        ctx.shadowBlur = isSelf ? 18 : node.nodeType === "project" ? 14 : 7;
      }

      if (node.nodeType === "project") {
        drawPolygon(ctx, p.x, p.y, 6, r, Math.PI / 6);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.6 / scale;
        ctx.strokeStyle = pal.nodeStroke;
        ctx.stroke();
        ctx.strokeStyle = fill;
        ctx.globalAlpha = alpha * 0.42;
        ctx.lineWidth = 1.1 / scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (node.nodeType === "concept") {
        const isHub = (node.memoryCount || 0) >= 3;
        drawPolygon(ctx, p.x, p.y, 4, r);
        ctx.fillStyle = isHub ? fill : (pal.conceptFill || pal.bg);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (node.promotionReady) {
          ctx.setLineDash([2.5 / scale, 2.2 / scale]);
          ctx.strokeStyle = fill;
          ctx.lineWidth = 1.35 / scale;
          ctx.stroke();
        } else {
          ctx.strokeStyle = isHub ? pal.nodeStroke : fill;
          ctx.lineWidth = 1.15 / scale;
          ctx.stroke();
        }
      } else if (node.nodeType === "source") {
        const side = r * 1.5;
        ctx.fillStyle = fill;
        ctx.fillRect(p.x - side * 0.5, p.y - side * 0.5, side, side);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = pal.nodeStroke;
        ctx.lineWidth = 1 / scale;
        ctx.strokeRect(p.x - side * 0.5, p.y - side * 0.5, side, side);
      } else {
        if (node.verified) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = pal.nodeStroke;
          ctx.lineWidth = 1.25 / scale;
          ctx.stroke();
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha * 0.16;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 3.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha * 0.68;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = fill;
          ctx.lineWidth = 1.2 / scale;
          ctx.stroke();
        }

        if (node.hasConflict) {
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = pal.conflict;
          ctx.lineWidth = 1.6 / scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 3.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (isSelf) {
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.label;
        ctx.lineWidth = 1.8 / scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5.2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      const eligible =
        isSelf ||
        isHop1 ||
        node.nodeType === "project" ||
        (node.nodeType === "concept" && ((node.memoryCount || 0) >= 3 || ((node.memoryCount || 0) >= 2 && scale >= 0.78) || scale >= 1.25)) ||
        this.model.nodes.length <= 24 ||
        scale >= 1.35;
      if (eligible && node.shortLabel) {
        const prio = isSelf
          ? 1000
          : isHop1
            ? 820
            : node.nodeType === "project"
              ? 680
              : node.nodeType === "concept"
                ? 360 + (node.memoryCount || 1) * 28
                : 160 + (node.hits || 0) * 12 + (node.degree || 0) * 6 + (node.verified ? 15 : 0);
        labelCandidates.push({ node, p, r, isSelf, isHop1, alpha, prio });
      }
    }

    ctx.restore();

    // 7. Screen-space LOD + greedy AABB anti-collision label pass
    if (labelCandidates.length) {
      labelCandidates.sort((a, b) => b.prio - a.prio);
      const placed = [];
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const item of labelCandidates) {
        const { node, p, r, isSelf, isHop1, alpha } = item;
        const sx = (p.x - this.camera.x) * scale + w * 0.5;
        const sy = (p.y - this.camera.y) * scale + h * 0.5 + r * scale + 11;
        if (sx < -80 || sx > w + 80 || sy < -30 || sy > h + 30) continue;

        const isHub = node.nodeType === "project" || (node.nodeType === "concept" && (node.memoryCount || 0) >= 3);
        const fontSize = node.nodeType === "project" ? 11.5 : 10.5;
        ctx.font = `${isSelf || isHub ? "600" : "500"} ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const measured = ctx.measureText?.(node.shortLabel)?.width;
        const tw = typeof measured === "number" && measured > 0 ? measured : node.shortLabel.length * fontSize * 0.72;
        const pillW = tw + 12;
        const pillH = fontSize + 7;
        const bx = sx - pillW * 0.5;
        const by = sy - pillH * 0.5;

        const hits = !isSelf && placed.some((q) => (
          bx < q.x + q.w + 5 && bx + pillW + 5 > q.x && by < q.y + q.h + 3 && by + pillH + 3 > q.y
        ));
        if (hits) continue;
        placed.push({ x: bx, y: by, w: pillW, h: pillH });

        ctx.save();
        ctx.globalAlpha = isSelf || isHop1 ? 1 : Math.min(0.95, alpha + 0.1);
        drawRoundedRect(ctx, bx, by, pillW, pillH, 5);
        ctx.fillStyle = pal.pillBg;
        ctx.fill();
        if (isSelf || isHop1 || node.nodeType === "project") {
          ctx.strokeStyle = isSelf ? pal.label : pal.pillBorder;
          ctx.lineWidth = isSelf ? 1.2 : 0.8;
          ctx.stroke();
        }
        ctx.fillStyle = isSelf || isHop1 || node.nodeType === "project" ? pal.label : pal.muted;
        ctx.fillText(node.shortLabel, sx, sy + 0.5);
        ctx.restore();
      }
      ctx.restore();
    }
  }
}
