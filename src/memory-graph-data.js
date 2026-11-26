// 记忆知识图谱数据建模与力导向 / 项目聚类物理布局引擎（纯数据层，零 Obsidian / DOM / i18n 依赖）。
import { deriveProvenance, deriveTrustLevel, parseSourceLine } from "./memory-store.js";
import { extractSourceNotes, normalizeLinkName, suggestConceptPromotions } from "./memory-graph.js";

const IDEAL_EDGE_LEN = {
  project: 92,
  concept: 112,
  conflict: 94,
  supersedes: 86,
  source: 128,
};

function normKey(raw) {
  return String(raw || "")
    .replace(/\.md$/i, "")
    .trim()
    .toLowerCase();
}

function baseName(raw) {
  return String(raw || "")
    .split("/")
    .pop()
    .replace(/\.md$/i, "")
    .trim();
}

function shortText(raw, max = 26) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : s;
}

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function angleFromId(id, salt = 0) {
  const h = hashSeed(`${id}#${salt}`);
  return ((h % 10000) / 10000) * Math.PI * 2;
}

function buildExistingSet(existingNotes) {
  if (!(existingNotes instanceof Set) && !Array.isArray(existingNotes)) return null;
  const set = new Set();
  for (const raw of existingNotes) {
    const clean = String(raw || "").trim();
    if (!clean) continue;
    const base = normKey(baseName(clean));
    if (base) set.add(base);
    const full = normKey(clean);
    if (full) set.add(full);
  }
  return set;
}

function noteExists(existingSet, name) {
  if (!existingSet || !name) return false;
  return existingSet.has(normKey(name)) || existingSet.has(normKey(baseName(name)));
}

function resolveProjectName(entry) {
  const link = normalizeLinkName(entry?.projectLink || "");
  const proj = String(entry?.project || "").trim();
  return link || proj;
}

export function buildMemoryGraphModel(entries = [], options = {}) {
  const {
    includeArchived = false,
    includeSources = false,
    onlyPending = false,
    onlyConflicts = false,
    kind = "all",
    project = "all",
    query = "",
    hitStats = {},
    existingNotes = null,
    promotionMinCount = 5,
  } = options;

  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const existingSet = buildExistingSet(existingNotes);
  const activeEntries = list.filter((e) => (e.state || "有效") === "有效");
  const promo = suggestConceptPromotions(activeEntries, { existingNotes, minCount: promotionMinCount });
  const promoKeys = new Set((promo?.ghostCandidates || []).map((x) => normKey(x.name)));

  const projectNames = new Set();
  for (const e of list) {
    if (!includeArchived && (e.state || "有效") !== "有效") continue;
    const pname = resolveProjectName(e);
    if (pname) projectNames.add(pname);
  }
  const projects = [...projectNames].sort((a, b) => a.localeCompare(b));

  const q = String(query || "").trim().toLowerCase();
  const filtered = list.filter((e) => {
    const st = e.state || "有效";
    if (!includeArchived && st !== "有效") return false;
    if (onlyPending && (st !== "有效" || e.verified)) return false;
    if (onlyConflicts && !(e.conflictsWith?.length)) return false;
    if (kind && kind !== "all" && (e.kind || "fact") !== kind) return false;
    const pname = resolveProjectName(e);
    if (project && project !== "all" && pname !== project) return false;
    if (q) {
      const hay = [
        e.title,
        e.text,
        e.description,
        e.project,
        e.projectLink,
        ...(e.concepts || []),
        ...(e.tags || []),
        ...(e.sources || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const nodes = [];
  const edges = [];
  const nodeById = new Map();
  const memNodes = [];
  const memLookup = new Map();
  const projectNodes = new Map();
  const conceptNodes = new Map();
  const sourceNodes = new Map();

  let maxHits = 0;
  for (const e of filtered) {
    const id = "mem:" + (e.id || e.path || `${nodes.length}`);
    const label = String(e.title || e.text || baseName(e.path) || id).trim();
    const hits = Number(hitStats?.[e.id]?.count || e.hits || 0) || 0;
    if (hits > maxHits) maxHits = hits;
    const provenance = deriveProvenance(e.sources || [], e.provenance || "");
    const trust = deriveTrustLevel({ ...e, provenance });
    const pname = resolveProjectName(e);
    const parsedSources = (e.sources || []).map((raw) => parseSourceLine(raw)).filter(Boolean);
    const node = {
      id,
      nodeType: "memory",
      label,
      shortLabel: shortText(label, 14),
      kind: e.kind || "fact",
      state: e.state || "有效",
      verified: Boolean(e.verified),
      trust,
      provenance,
      hits,
      project: pname,
      date: e.date || "",
      path: e.path || "",
      concepts: (e.concepts || []).map((c) => normalizeLinkName(c)).filter(Boolean),
      sources: [...(e.sources || [])],
      parsedSources,
      conflictsWith: [...(e.conflictsWith || [])],
      supersedes: [...(e.supersedes || [])],
      supersededBy: String(e.supersededBy || "").trim(),
      hasConflict: (e.conflictsWith?.length || 0) > 0,
      degree: 0,
      radius: 6,
      entry: e,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    memNodes.push(node);

    const registerKey = (k) => {
      const nk = normKey(k);
      if (nk && !memLookup.has(nk)) memLookup.set(nk, node);
    };
    if (e.id) registerKey(e.id);
    if (e.path) {
      registerKey(e.path);
      registerKey(baseName(e.path));
    }
    if (e.title) registerKey(e.title);
  }

  const addEdge = (source, target, edgeType) => {
    if (!source || !target || source === target) return;
    edges.push({ source, target, edgeType });
  };

  for (const mNode of memNodes) {
    if (mNode.project) {
      const pk = normKey(mNode.project);
      let pNode = projectNodes.get(pk);
      if (!pNode) {
        pNode = {
          id: "proj:" + mNode.project,
          nodeType: "project",
          label: mNode.project,
          shortLabel: shortText(mNode.project, 22),
          memoryCount: 0,
          existsInVault: noteExists(existingSet, mNode.project),
          degree: 0,
          radius: 12,
        };
        projectNodes.set(pk, pNode);
        nodes.push(pNode);
        nodeById.set(pNode.id, pNode);
      }
      pNode.memoryCount += 1;
      addEdge(mNode.id, pNode.id, "project");
    }

    const seenConcepts = new Set();
    for (const cname of mNode.concepts) {
      const ck = normKey(cname);
      if (!ck || seenConcepts.has(ck)) continue;
      seenConcepts.add(ck);
      let cNode = conceptNodes.get(ck);
      if (!cNode) {
        const exists = noteExists(existingSet, cname);
        cNode = {
          id: "concept:" + cname,
          nodeType: "concept",
          label: cname,
          shortLabel: shortText(cname, 22),
          memoryCount: 0,
          existsInVault: exists,
          promotionReady: false,
          degree: 0,
          radius: 8,
        };
        conceptNodes.set(ck, cNode);
        nodes.push(cNode);
        nodeById.set(cNode.id, cNode);
      }
      cNode.memoryCount += 1;
      addEdge(mNode.id, cNode.id, "concept");
    }

    if (includeSources) {
      const srcPaths = extractSourceNotes(mNode.sources);
      for (const sp of srcPaths) {
        const sk = normKey(sp);
        if (!sk) continue;
        let sNode = sourceNodes.get(sk);
        if (!sNode) {
          const lbl = baseName(sp) || sp;
          sNode = {
            id: "src:" + sp,
            nodeType: "source",
            label: lbl,
            shortLabel: shortText(lbl, 22),
            path: sp,
            memoryCount: 0,
            degree: 0,
            radius: 6,
          };
          sourceNodes.set(sk, sNode);
          nodes.push(sNode);
          nodeById.set(sNode.id, sNode);
        }
        sNode.memoryCount += 1;
        addEdge(mNode.id, sNode.id, "source");
      }
    }
  }

  for (const cNode of conceptNodes.values()) {
    const ck = normKey(cNode.label);
    cNode.promotionReady = !cNode.existsInVault && (promoKeys.has(ck) || cNode.memoryCount >= promotionMinCount);
  }

  const seenConflicts = new Set();
  const seenSupersedes = new Set();
  for (const mNode of memNodes) {
    for (const rawTarget of mNode.conflictsWith) {
      const name = normalizeLinkName(rawTarget);
      const target = memLookup.get(normKey(name)) || memLookup.get(normKey(baseName(name)));
      if (!target || target.id === mNode.id) continue;
      const pairKey = mNode.id < target.id ? `${mNode.id}|${target.id}` : `${target.id}|${mNode.id}`;
      if (seenConflicts.has(pairKey)) continue;
      seenConflicts.add(pairKey);
      addEdge(mNode.id, target.id, "conflict");
      mNode.hasConflict = true;
      target.hasConflict = true;
    }

    for (const rawTarget of mNode.supersedes) {
      const name = normalizeLinkName(rawTarget);
      const target = memLookup.get(normKey(name)) || memLookup.get(normKey(baseName(name)));
      if (!target || target.id === mNode.id) continue;
      const dirKey = `${mNode.id}->${target.id}`;
      if (seenSupersedes.has(dirKey)) continue;
      seenSupersedes.add(dirKey);
      addEdge(mNode.id, target.id, "supersedes");
    }

    if (mNode.supersededBy) {
      const name = normalizeLinkName(mNode.supersededBy);
      const newer = memLookup.get(normKey(name)) || memLookup.get(normKey(baseName(name)));
      if (newer && newer.id !== mNode.id) {
        const dirKey = `${newer.id}->${mNode.id}`;
        if (!seenSupersedes.has(dirKey)) {
          seenSupersedes.add(dirKey);
          addEdge(newer.id, mNode.id, "supersedes");
        }
      }
    }
  }

  const adj = new Map();
  const edgesByNode = new Map();
  for (const n of nodes) {
    adj.set(n.id, new Set());
    edgesByNode.set(n.id, []);
  }
  for (const edge of edges) {
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
    edgesByNode.get(edge.source)?.push(edge);
    edgesByNode.get(edge.target)?.push(edge);
    const sNode = nodeById.get(edge.source);
    const tNode = nodeById.get(edge.target);
    if (sNode) sNode.degree += 1;
    if (tNode) tNode.degree += 1;
  }

  for (const n of nodes) {
    if (n.nodeType === "project") {
      n.radius = 10 + Math.min(7, Math.sqrt(n.memoryCount || 1) * 2.2);
    } else if (n.nodeType === "concept") {
      n.radius = 3.8 + Math.min(5.2, Math.sqrt(n.memoryCount || 1) * 1.45);
    } else if (n.nodeType === "source") {
      n.radius = 4.2 + Math.min(3.5, Math.sqrt(n.memoryCount || 1) * 1.1);
    } else {
      n.radius = 5.2 + Math.min(6.5, Math.log2(1 + (n.hits || 0)) * 1.6 + Math.min(4, n.degree) * 0.45) + (n.verified ? 0.7 : 0);
    }
  }

  let ghostConcepts = 0;
  for (const cNode of conceptNodes.values()) {
    if (cNode.promotionReady) ghostConcepts += 1;
  }

  const stats = {
    totalEntries: list.length,
    memories: memNodes.length,
    projects: projectNodes.size,
    concepts: conceptNodes.size,
    ghostConcepts,
    sources: sourceNodes.size,
    edges: edges.length,
    conflicts: seenConflicts.size,
    pending: memNodes.filter((n) => (n.state || "有效") === "有效" && !n.verified).length,
  };

  return {
    nodes,
    edges,
    nodeById,
    adj,
    edgesByNode,
    projects,
    maxHits,
    stats,
  };
}

export function neighborhoodOf(model, nodeId, maxHops = 2) {
  const hop0 = new Set();
  const hop1 = new Set();
  const hop2 = new Set();
  const all = new Set();
  const edgeSet = new Set();
  if (!model?.nodeById?.has(nodeId)) {
    return { hop0, hop1, hop2, all, edgeSet };
  }

  hop0.add(nodeId);
  all.add(nodeId);
  const frontier = [[nodeId, 0]];
  const depthMap = new Map([[nodeId, 0]]);
  let cursor = 0;

  while (cursor < frontier.length) {
    const [cur, depth] = frontier[cursor++];
    if (depth >= maxHops) continue;
    const neighbors = model.adj.get(cur) || new Set();
    for (const next of neighbors) {
      if (!depthMap.has(next)) {
        const nextDepth = depth + 1;
        depthMap.set(next, nextDepth);
        all.add(next);
        if (nextDepth === 1) hop1.add(next);
        else if (nextDepth === 2) hop2.add(next);
        frontier.push([next, nextDepth]);
      }
    }
  }

  for (const edge of model.edges || []) {
    if (all.has(edge.source) && all.has(edge.target)) {
      edgeSet.add(edge);
    }
  }

  return { hop0, hop1, hop2, all, edgeSet };
}

export function seedGraphLayout(model, { layout = "force", width = 960, height = 640 } = {}) {
  const positions = new Map();
  const clusterCenters = new Map();
  const nodeClusterMap = new Map();
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minDim = Math.max(240, Math.min(width, height));

  const projectNodes = (model?.nodes || []).filter((n) => n.nodeType === "project");
  const memoryNodes = (model?.nodes || []).filter((n) => n.nodeType === "memory");
  const conceptNodes = (model?.nodes || []).filter((n) => n.nodeType === "concept");
  const sourceNodes = (model?.nodes || []).filter((n) => n.nodeType === "source");

  const unassignedMemories = memoryNodes.filter((n) => !n.project);
  const unassignedCount = unassignedMemories.length;

  if (layout === "cluster") {
    const clusters = projectNodes.map((p) => ({
      key: p.label,
      label: p.label,
      count: p.memoryCount || 1,
      node: p,
    }));
    if (unassignedCount >= 12) {
      const kindCounts = new Map();
      for (const m of unassignedMemories) {
        const k = m.kind || "fact";
        kindCounts.set(k, (kindCounts.get(k) || 0) + 1);
      }
      for (const [k, cnt] of kindCounts) {
        clusters.push({
          key: `__kind__:${k}`,
          kind: k,
          label: "",
          isKindCluster: true,
          count: cnt,
          node: null,
        });
      }
    } else if (unassignedCount > 0) {
      clusters.push({
        key: "__unassigned__",
        label: "",
        count: unassignedCount,
        node: null,
      });
    }
    const total = clusters.length || 1;
    const ringR = total === 1 ? 0 : Math.max(190, Math.min(width, height) * 0.36 + total * 20);

    clusters.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    clusters.forEach((c, idx) => {
      const theta = -Math.PI / 2 + (idx / total) * Math.PI * 2;
      const x = total === 1 ? cx : cx + Math.cos(theta) * ringR;
      const y = total === 1 ? cy : cy + Math.sin(theta) * ringR;
      const radius = 70 + Math.min(92, Math.sqrt(c.count) * 21);
      clusterCenters.set(c.key, {
        key: c.key,
        kind: c.kind || "",
        label: c.label,
        isKindCluster: Boolean(c.isKindCluster),
        x,
        y,
        count: c.count,
        radius,
      });
      if (c.node) {
        positions.set(c.node.id, { x, y, vx: 0, vy: 0, pinned: false, fx: null, fy: null });
        nodeClusterMap.set(c.node.id, c.key);
      }
    });

    const clusterSlot = new Map();
    for (const m of memoryNodes) {
      const key = m.project
        ? m.project
        : unassignedCount >= 12
          ? `__kind__:${m.kind || "fact"}`
          : "__unassigned__";
      nodeClusterMap.set(m.id, key);
      const center = clusterCenters.get(key) || { x: cx, y: cy, count: 1 };
      const idx = clusterSlot.get(key) || 0;
      clusterSlot.set(key, idx + 1);
      const theta = ((idx * 2.399963) + angleFromId(m.id, 1) * 0.15) % (Math.PI * 2);
      const dist = 24 + Math.sqrt(idx + 1) * 22;
      positions.set(m.id, {
        x: center.x + Math.cos(theta) * dist,
        y: center.y + Math.sin(theta) * dist,
        vx: 0,
        vy: 0,
        pinned: false,
        fx: null,
        fy: null,
      });
    }
  } else {
    const pCount = projectNodes.length;
    const hubRadius = pCount <= 1 ? 0 : Math.min(minDim * 0.28, 120 + pCount * 22);
    const projectPos = new Map();
    projectNodes.forEach((p, idx) => {
      const theta = -Math.PI / 2 + (idx / Math.max(1, pCount)) * Math.PI * 2;
      const x = pCount <= 1 ? cx : cx + Math.cos(theta) * hubRadius;
      const y = pCount <= 1 ? cy : cy + Math.sin(theta) * hubRadius;
      projectPos.set(p.label, { x, y });
      positions.set(p.id, { x, y, vx: 0, vy: 0, pinned: false, fx: null, fy: null });
    });

    const kindSector = { fact: -Math.PI * 0.75, preference: -Math.PI * 0.25, lesson: Math.PI * 0.25, pattern: Math.PI * 0.75 };
    const memIndex = new Map();
    for (const m of memoryNodes) {
      const anchor = m.project && projectPos.get(m.project);
      if (anchor) {
        const idx = memIndex.get(m.project) || 0;
        memIndex.set(m.project, idx + 1);
        const theta = (idx * 2.399963) + angleFromId(m.id, 3) * 0.2;
        const r = 56 + Math.sqrt(idx + 1) * 24;
        positions.set(m.id, {
          x: anchor.x + Math.cos(theta) * r,
          y: anchor.y + Math.sin(theta) * r,
          vx: 0,
          vy: 0,
          pinned: false,
          fx: null,
          fy: null,
        });
      } else {
        const kKey = `__none__:${m.kind || "fact"}`;
        const idx = memIndex.get(kKey) || 0;
        memIndex.set(kKey, idx + 1);
        const baseA = kindSector[m.kind || "fact"] ?? 0;
        const theta = baseA + (((idx * 2.399963) % (Math.PI * 0.85)) - Math.PI * 0.425) + angleFromId(m.id, 5) * 0.12;
        const r = (pCount ? hubRadius + 115 : 55) + Math.sqrt(idx + 1) * 28;
        positions.set(m.id, {
          x: cx + Math.cos(theta) * r,
          y: cy + Math.sin(theta) * r,
          vx: 0,
          vy: 0,
          pinned: false,
          fx: null,
          fy: null,
        });
      }
    }
  }

  // Place concept & source nodes near centroid of connected neighbors with deterministic offset
  const placeFromNeighbors = (list, baseRadius) => {
    for (const n of list) {
      const neighbors = [...(model.adj.get(n.id) || [])];
      let sx = 0;
      let sy = 0;
      let cnt = 0;
      for (const nb of neighbors) {
        const p = positions.get(nb);
        if (p) {
          sx += p.x;
          sy += p.y;
          cnt += 1;
        }
      }
      const angle = angleFromId(n.id, 7);
      const jitter = 28 + (hashSeed(n.id) % 28);
      const x = (cnt ? sx / cnt : cx + Math.cos(angle) * baseRadius) + Math.cos(angle) * jitter;
      const y = (cnt ? sy / cnt : cy + Math.sin(angle) * baseRadius) + Math.sin(angle) * jitter;
      positions.set(n.id, { x, y, vx: 0, vy: 0, pinned: false, fx: null, fy: null });
    }
  };

  placeFromNeighbors(conceptNodes, minDim * 0.34);
  placeFromNeighbors(sourceNodes, minDim * 0.44);

  return { positions, clusterCenters, nodeClusterMap };
}

class QuadNode {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.mass = 0;
    this.cx = 0;
    this.cy = 0;
    this.body = null;
    this.children = null;
  }

  insert(item) {
    if (this.mass === 0) {
      this.mass = 1;
      this.cx = item.x;
      this.cy = item.y;
      this.body = item;
      return;
    }

    if (!this.children) {
      if (this.size < 1) {
        const total = this.mass + 1;
        this.cx = (this.cx * this.mass + item.x) / total;
        this.cy = (this.cy * this.mass + item.y) / total;
        this.mass = total;
        return;
      }
      this.subdivide();
      const existing = this.body;
      this.body = null;
      if (existing) this.putIntoChild(existing);
    }

    const total = this.mass + 1;
    this.cx = (this.cx * this.mass + item.x) / total;
    this.cy = (this.cy * this.mass + item.y) / total;
    this.mass = total;
    this.putIntoChild(item);
  }

  subdivide() {
    const half = this.size * 0.5;
    this.children = [
      new QuadNode(this.x, this.y, half),
      new QuadNode(this.x + half, this.y, half),
      new QuadNode(this.x, this.y + half, half),
      new QuadNode(this.x + half, this.y + half, half),
    ];
  }

  putIntoChild(item) {
    const half = this.size * 0.5;
    const right = item.x >= this.x + half ? 1 : 0;
    const bottom = item.y >= this.y + half ? 2 : 0;
    this.children[bottom + right].insert(item);
  }

  applyForce(target, repulsion, theta, fxOut) {
    if (this.mass === 0) return;
    let dx = target.x - this.cx;
    let dy = target.y - this.cy;
    let distSq = dx * dx + dy * dy;

    if (!this.children && this.body === target) return;

    if (!this.children || (this.size * this.size) / Math.max(distSq, 1) < theta * theta) {
      if (distSq < 1e-4) {
        const a = angleFromId(target.id, 13);
        dx = Math.cos(a) * 0.5;
        dy = Math.sin(a) * 0.5;
        distSq = 0.25;
      }
      const dist = Math.sqrt(distSq);
      const strength = (repulsion * this.mass) / (distSq + 36);
      fxOut.fx += (dx / dist) * strength;
      fxOut.fy += (dy / dist) * strength;
      return;
    }

    for (let i = 0; i < 4; i++) {
      this.children[i].applyForce(target, repulsion, theta, fxOut);
    }
  }
}

export function stepGraphLayout(model, state, { layout = "force", alpha = 1, centerX = 480, centerY = 320 } = {}) {
  const nodes = model?.nodes || [];
  const edges = model?.edges || [];
  const positions = state?.positions;
  if (!nodes.length || !positions) return 0;

  const forces = new Map();
  const items = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    forces.set(n.id, { fx: 0, fy: 0 });
    items.push({ id: n.id, node: n, pos: p, x: p.x, y: p.y });
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const repulsion = layout === "cluster" ? 2100 : 2850;
  const count = items.length;

  // 1. Repulsion (Barnes-Hut quadtree when N > 40, direct pairwise when N <= 40)
  if (count > 40) {
    const span = Math.max(64, maxX - minX, maxY - minY) + 32;
    const root = new QuadNode(minX - 16, minY - 16, span);
    for (const item of items) root.insert(item);
    for (const item of items) {
      const f = forces.get(item.id);
      root.applyForce(item, repulsion, 0.7, f);
    }
  } else {
    for (let i = 0; i < count; i++) {
      const a = items[i];
      const fa = forces.get(a.id);
      for (let j = i + 1; j < count; j++) {
        const b = items[j];
        const fb = forces.get(b.id);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1e-4) {
          const ang = angleFromId(`${a.id}:${b.id}`, 17);
          dx = Math.cos(ang) * 0.5;
          dy = Math.sin(ang) * 0.5;
          distSq = 0.25;
        }
        const dist = Math.sqrt(distSq);
        const f = repulsion / (distSq + 36);
        const ux = (dx / dist) * f;
        const uy = (dy / dist) * f;
        fa.fx += ux;
        fa.fy += uy;
        fb.fx -= ux;
        fb.fy -= uy;
      }
    }
  }

  // 2. Collision avoidance
  for (let i = 0; i < count; i++) {
    const a = items[i];
    const fa = forces.get(a.id);
    for (let j = i + 1; j < count; j++) {
      const b = items[j];
      const fb = forces.get(b.id);
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let dist = Math.hypot(dx, dy);
      const minDist = (a.node.radius || 6) + (b.node.radius || 6) + 15;
      if (dist < minDist) {
        if (dist < 1e-3) {
          const ang = angleFromId(`${a.id}:${b.id}`, 23);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          dist = 1;
        }
        const push = ((minDist - dist) / dist) * 0.42;
        fa.fx += dx * push * 6;
        fa.fy += dy * push * 6;
        fb.fx -= dx * push * 6;
        fb.fy -= dy * push * 6;
      }
    }
  }

  // 3. Edge springs
  for (const edge of edges) {
    const ps = positions.get(edge.source);
    const pt = positions.get(edge.target);
    if (!ps || !pt) continue;
    const fs = forces.get(edge.source);
    const ft = forces.get(edge.target);
    let dx = pt.x - ps.x;
    let dy = pt.y - ps.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 1e-3) {
      const ang = angleFromId(`${edge.source}->${edge.target}`, 29);
      dx = Math.cos(ang);
      dy = Math.sin(ang);
      dist = 1;
    }
    const ideal = IDEAL_EDGE_LEN[edge.edgeType] || 88;
    const k = edge.edgeType === "project" ? 0.095 : edge.edgeType === "source" ? 0.032 : 0.055;
    const spring = (dist - ideal) * k;
    const fx = (dx / dist) * spring;
    const fy = (dy / dist) * spring;
    fs.fx += fx;
    fs.fy += fy;
    ft.fx -= fx;
    ft.fy -= fy;
  }

  // 4. Center gravity or cluster anchor attraction
  const clusterCenters = state?.clusterCenters;
  const nodeClusterMap = state?.nodeClusterMap;
  for (const item of items) {
    const f = forces.get(item.id);
    if (layout === "cluster" && clusterCenters?.size) {
      if (item.node.nodeType === "project") {
        const cc = clusterCenters.get(item.node.label);
        if (cc) {
          f.fx += (cc.x - item.x) * 0.12;
          f.fy += (cc.y - item.y) * 0.12;
        }
      } else if (item.node.nodeType === "memory") {
        const cKey = nodeClusterMap?.get(item.id) || item.node.project || "__unassigned__";
        const cc = clusterCenters.get(cKey);
        if (cc) {
          f.fx += (cc.x - item.x) * 0.036;
          f.fy += (cc.y - item.y) * 0.036;
        }
      } else {
        f.fx += (centerX - item.x) * 0.005;
        f.fy += (centerY - item.y) * 0.005;
      }
    } else {
      const gravity = item.node.nodeType === "project" ? 0.018 : item.node.nodeType === "concept" ? 0.009 : 0.010;
      f.fx += (centerX - item.x) * gravity;
      f.fy += (centerY - item.y) * gravity;
    }
  }

  // 5. Integrate velocities with damping & clamp
  const stepAlpha = Math.max(0.05, Math.min(1, Number(alpha) || 1));
  let maxDisp = 0;
  for (const item of items) {
    const p = item.pos;
    if (p.pinned || p.fx != null || p.fy != null) {
      if (p.fx != null) p.x = p.fx;
      if (p.fy != null) p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    const f = forces.get(item.id);
    p.vx = (p.vx + f.fx * stepAlpha) * 0.84;
    p.vy = (p.vy + f.fy * stepAlpha) * 0.84;
    const speed = Math.hypot(p.vx, p.vy);
    const maxSpeed = 16;
    if (speed > maxSpeed) {
      p.vx = (p.vx / speed) * maxSpeed;
      p.vy = (p.vy / speed) * maxSpeed;
    }
    p.x += p.vx;
    p.y += p.vy;
    const disp = Math.hypot(p.vx, p.vy);
    if (disp > maxDisp) maxDisp = disp;
  }

  return maxDisp;
}

export function graphBounds(model, positions) {
  const nodes = model?.nodes || [];
  if (!nodes.length || !positions?.size) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    const r = n.radius || 8;
    if (p.x - r < minX) minX = p.x - r;
    if (p.x + r > maxX) maxX = p.x + r;
    if (p.y - r < minY) minY = p.y - r;
    if (p.y + r > maxY) maxY = p.y + r;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
  };
}
