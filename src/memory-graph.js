// Pure Obsidian Graph & OKF link helpers for Dream memories.
// Zero Obsidian / Node / src imports so it remains a cycle-free leaf module.

export const CONCEPT_STOPWORDS = new Set([
  "ai", "agent", "llm", "app", "web", "api", "ui", "ux", "mac", "ios", "todo", "done", "note", "notes",
  "work", "code", "test", "git", "日常", "口径", "自我", "历史", "记忆", "开发", "用户", "方法", "系统",
  "工具", "项目", "概念", "问题", "记录", "内容", "设计", "视频", "文章", "学习", "投资", "管理", "工作",
  "时间", "数据", "模型", "思维", "结构", "原则", "经验", "习惯", "偏好", "分析", "写作", "产品", "知识",
  "搜索", "信息", "文件", "消费", "风险", "思路", "逻辑", "方式", "策略", "能力", "价值", "机制", "状态",
  "模式", "优化", "方案", "流程", "场景", "效果", "重点", "核心", "基础", "规则", "结论", "建议", "判断",
  "测试", "配置", "功能", "交互", "视图", "列表", "目录", "路径", "链接", "文本", "格式", "环境", "脚本",
]);

const SKIP_PREFIXES = ["日记/", "agent deck/", "技能/", "templates/", "assets/", "excalidraw/"];

export function normalizeLinkName(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  s = s.split("|")[0].split("#")[0].trim();
  if (s.toLowerCase().endsWith(".md")) s = s.slice(0, -3).trim();
  return s;
}

export function extractSourceNotes(sources = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const m = /^\[\[([^\]]+)\]\]/.exec(String(raw || "").trim());
    if (!m) continue;
    const inner = m[1].split("|")[0].trim();
    if (!inner) continue;
    const canonical = `[[${inner}]]`;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

const QUOTE_PAIRS = [
  ["「", "」"],
  ["『", "』"],
  ["《", "》"],
  ["【", "】"],
  ["“", "”"],
  ["‘", "’"],
];

export function deriveShortMemoryTitle(text = "", max = 22) {
  let s = String(text || "").replace(/[\r\n]+/g, " ").trim();
  s = s.replace(/（待验证(?:推断)?）$/g, "").replace(/[（(][^）)]{1,24}[）)]/g, "").trim();
  const prefixes = [
    /^(?:用户在|用户的|用户指定|用户习惯|用户认为|用户偏好|用户要求|用户倾向|用户推断|用户以|用户按)[，：:\s]*/u,
    /^(?:AI\s*编码记录里的|AI\s*记录称|AI\s*记录建议|AI\s*记录提出|AI\s*记录认为|AI\s*记录将)[，：:\s]*/iu,
    /^(?:推断|用户)[，：:\s]+/u,
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const re of prefixes) s = s.replace(re, "").trim();
  }
  s = s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "记忆";
  const trailingRe = /[，。、；：！？,.;:!?（(【「『《“‘\-_\s]+$/u;
  const chars = [...s];
  if (chars.length <= max) {
    return s.replace(trailingRe, "") || "记忆";
  }
  const openSet = new Set(QUOTE_PAIRS.map(([o]) => o));
  const closeToOpen = new Map(QUOTE_PAIRS.map(([o, c]) => [c, o]));
  const stack = [];
  let clauseCut = -1;
  for (let i = 0; i < Math.min(chars.length, max); i++) {
    const ch = chars[i];
    if (openSet.has(ch)) {
      stack.push(ch);
    } else if (closeToOpen.has(ch)) {
      const want = closeToOpen.get(ch);
      const pos = stack.lastIndexOf(want);
      if (pos >= 0) stack.splice(pos, 1);
    } else if (i >= 9 && stack.length === 0 && "，。；：、,.;:".includes(ch)) {
      const candidate = chars.slice(0, i).join("").replace(trailingRe, "").trim();
      if (i <= 13 && /^(?:在.{1,10}[中时里内]|当.{1,10}时|对于.{1,10}|关于.{1,10}|涉及.{1,10})$/u.test(candidate)) {
        continue;
      }
      clauseCut = i;
      break;
    }
  }
  if (clauseCut >= 9) {
    const picked = chars.slice(0, clauseCut).join("").replace(trailingRe, "").trim();
    if (picked) return picked;
  }
  let cut = chars.slice(0, max).join("");
  if (/[A-Za-z0-9_-]$/.test(cut) && chars[max] && /[A-Za-z0-9_-]/.test(chars[max])) {
    const trimmed = cut.replace(/[A-Za-z0-9_-]+$/, "").trim();
    if ([...trimmed].length >= 6) cut = trimmed;
  }
  for (const [open, close] of QUOTE_PAIRS) {
    const openIdx = cut.lastIndexOf(open);
    const closeIdx = cut.lastIndexOf(close);
    if (openIdx >= 0 && openIdx > closeIdx) {
      const before = cut.slice(0, openIdx).replace(trailingRe, "").trim();
      if ([...before].length >= 6) cut = before;
      else cut = cut.slice(0, openIdx) + cut.slice(openIdx + open.length);
    }
  }
  const strippedDangling = cut.replace(trailingRe, "").replace(/[的了着和与及或把被将对向在为是]+$/u, "").trim();
  if ([...strippedDangling].length >= 6) cut = strippedDangling;
  return cut.replace(trailingRe, "").trim() || "记忆";
}

function normKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_\-·.]+/g, "");
}

function classifyConceptTerm(term) {
  const clean = String(term || "").trim();
  const low = clean.toLowerCase();
  if (!clean || clean.length < 2 || clean.length > 24) return "";
  if (/^\d+$/.test(clean) || /^[a-z0-9_-]{1,2}$/i.test(clean)) return "";
  if (CONCEPT_STOPWORDS.has(low)) return "";
  if (/^[a-z0-9][a-z0-9 _.-]*$/i.test(clean)) return clean.length >= 3 ? "strict" : "";
  if (/^[a-z][\u4e00-\u9fff]+$/i.test(clean)) return "strict";
  if (/^[\u4e00-\u9fff]+$/.test(clean)) return [...clean].length >= 3 ? "strict" : "candidate";
  return [...clean].length >= 3 ? "strict" : "";
}

export function buildVaultConceptCatalog(files = [], {
  excludedDirs = [],
  memoryDir = "Agent Deck/记忆",
  incomingCounts = null,
  maxHubInlinks = 80,
  exemptProjects = [],
} = {}) {
  const memPrefix = `${String(memoryDir || "Agent Deck/记忆").replace(/\/+$/, "").toLowerCase()}/`;
  const excluded = (Array.isArray(excludedDirs) ? excludedDirs : []).map((d) => String(d || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase()).filter(Boolean);
  const exemptKeys = new Set((Array.isArray(exemptProjects) ? exemptProjects : []).map((p) => normKey(p)).filter(Boolean));
  const byTerm = new Map();
  const byNorm = new Map();

  for (const rawFile of files || []) {
    const filePath = typeof rawFile === "string" ? rawFile : String(rawFile?.path || "");
    if (!filePath || !filePath.toLowerCase().endsWith(".md")) continue;
    const lowPath = filePath.toLowerCase();
    if (lowPath.startsWith(memPrefix)) continue;
    if (SKIP_PREFIXES.some((p) => lowPath.startsWith(p))) continue;
    if (excluded.some((d) => lowPath === d || lowPath.startsWith(`${d}/`))) continue;

    const baseName = filePath.split("/").pop().slice(0, -3).trim();
    if (!baseName) continue;
    const aliases = Array.isArray(rawFile?.aliases)
      ? rawFile.aliases
      : (typeof rawFile?.aliases === "string" ? rawFile.aliases.split(/[,，]/) : []);
    const nk = normKey(baseName);
    const isExemptProject = (nk && exemptKeys.has(nk)) || aliases.some((a) => exemptKeys.has(normKey(a)));
    if (!isExemptProject && incomingCounts && (incomingCounts.get(filePath) || 0) >= maxHubInlinks) continue;

    if (nk && !byNorm.has(nk)) byNorm.set(nk, baseName);
    for (const alias of aliases) {
      const ank = normKey(alias);
      if (ank && !byNorm.has(ank)) byNorm.set(ank, baseName);
    }

    for (const candidate of [baseName, ...aliases]) {
      const term = String(candidate || "").trim();
      const tier = classifyConceptTerm(term);
      if (!tier) continue;
      const tk = term.toLowerCase();
      if (!byTerm.has(tk)) {
        byTerm.set(tk, {
          term,
          low: tk,
          noteName: baseName,
          path: filePath,
          tier,
          isAscii: /^[a-z0-9][a-z0-9 _.-]*$/i.test(term),
          norm: normKey(baseName),
        });
      }
    }
  }

  const items = [...byTerm.values()].sort((a, b) => b.low.length - a.low.length || a.noteName.localeCompare(b.noteName));
  return { items, byNorm };
}

function findSpanInText(lowerText, item) {
  if (item.isAscii) {
    const esc = item.low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i");
    const m = re.exec(lowerText);
    return m ? [m.index, m.index + m[0].length] : null;
  }
  const idx = lowerText.indexOf(item.low);
  return idx >= 0 ? [idx, idx + item.low.length] : null;
}

export function matchConceptLinks(text = "", catalog = null, { max = 3, strictAuto = true, projectName = "" } = {}) {
  const empty = { concepts: [], projectLink: "", candidateNames: [] };
  if (!catalog || !Array.isArray(catalog.items)) return empty;
  const projKey = normKey(projectName);
  const projNote = projKey ? (catalog.byNorm?.get(projKey) || "") : "";
  const projectLink = projNote ? `[[${projNote}]]` : "";

  const lower = String(text || "").toLowerCase();
  const spans = [];
  const chosen = [];
  const seenNote = new Set();
  if (projNote) seenNote.add(projNote.toLowerCase());

  for (const item of catalog.items) {
    if (seenNote.has(item.noteName.toLowerCase())) continue;
    const isProjectExact = projKey && item.norm === projKey;
    if (strictAuto && item.tier !== "strict" && !isProjectExact) continue;
    const span = findSpanInText(lower, item);
    if (!span) continue;
    if (spans.some(([s, e]) => span[0] >= s && span[1] <= e)) continue;
    spans.push(span);
    seenNote.add(item.noteName.toLowerCase());
    chosen.push(item.noteName);
    if (chosen.length >= max) break;
  }

  return {
    concepts: chosen.map((name) => `[[${name}]]`),
    projectLink,
    candidateNames: chosen,
  };
}

function entryConceptKeys(entry) {
  const out = [];
  const add = (raw) => {
    const name = normalizeLinkName(raw);
    const k = normKey(name);
    if (k) out.push({ name, k });
  };
  for (const c of entry?.concepts || []) add(c);
  if (entry?.projectLink) add(entry.projectLink);
  if (entry?.project) add(entry.project);
  return out;
}

export function expandGraphMemories(entries = [], queryText = "", {
  seedRefs = [],
  projectName = "",
  catalog = null,
  conceptParents = null,
  limit = 4,
} = {}) {
  const hits = new Map();
  const active = (entries || []).filter((e) => e && e.state === "有效" && !e.private && e.status !== "deprecated" && e.status !== "rejected" && e.verdict !== "refuted");
  if (!active.length) return hits;

  const seedNames = new Map(); // normKey -> display name
  const explicitSeedKeys = new Set();
  const addSeed = (raw, explicit = false) => {
    const name = normalizeLinkName(raw);
    const k = normKey(name);
    if (!k || CONCEPT_STOPWORDS.has(name.toLowerCase())) return;
    if (!seedNames.has(k)) seedNames.set(k, name);
    if (explicit) explicitSeedKeys.add(k);
  };
  for (const ref of seedRefs || []) addSeed(ref, true);
  const lowerQuery = String(queryText || "").toLowerCase();
  if (catalog) {
    const matched = matchConceptLinks(queryText, catalog, { max: 4, strictAuto: true, projectName });
    for (const c of matched.concepts) addSeed(c, false);
    if (matched.projectLink) {
      const pName = normalizeLinkName(matched.projectLink);
      if (pName && findSpanInText(lowerQuery, { low: pName.toLowerCase(), isAscii: /^[a-z0-9][a-z0-9 _.-]*$/i.test(pName) })) {
        addSeed(matched.projectLink, false);
      }
    }
  } else if (lowerQuery.trim()) {
    const candidateConcepts = new Map();
    for (const e of active) {
      for (const { name, k } of entryConceptKeys(e)) {
        if (k && !CONCEPT_STOPWORDS.has(name.toLowerCase()) && !candidateConcepts.has(k)) {
          candidateConcepts.set(k, name);
        }
      }
    }
    for (const name of candidateConcepts.values()) {
      const tier = classifyConceptTerm(name);
      if (!tier) continue;
      if (findSpanInText(lowerQuery, { low: name.toLowerCase(), isAscii: /^[a-z0-9][a-z0-9 _.-]*$/i.test(name) })) {
        addSeed(name, false);
      }
    }
  }
  if (!seedNames.size) return hits;

  const hop1Entries = [];
  for (const e of active) {
    let bestHit = null;
    for (const { name, k } of entryConceptKeys(e)) {
      if (seedNames.has(k)) {
        const isExplicit = explicitSeedKeys.has(k);
        if (!bestHit || (isExplicit && !bestHit.explicitRef)) {
          bestHit = { hop: 1, via: name, bonus: 3.2, explicitRef: isExplicit };
        }
      }
    }
    if (bestHit) {
      hits.set(e.id, bestHit);
      hop1Entries.push({ entry: e, via: bestHit.via });
    }
  }

  // Hop 2: follow concept parent edges (`father`/`domain`) + shared concept bridge from Hop-1 entries.
  const hop2ParentSeeds = new Map(); // normKey -> via string
  for (const [sk, sname] of seedNames) {
    const parents = conceptParents?.get(sk) || [];
    for (const p of parents) {
      const pn = normalizeLinkName(p);
      const pk = normKey(pn);
      if (pk && !seedNames.has(pk) && !hop2ParentSeeds.has(pk)) hop2ParentSeeds.set(pk, `${sname}→${pn}`);
    }
  }
  const hop2CoSeeds = new Map();
  for (const { entry, via } of hop1Entries.slice(0, 6)) {
    for (const { name, k } of entryConceptKeys(entry)) {
      if (!seedNames.has(k) && !hop2ParentSeeds.has(k) && !CONCEPT_STOPWORDS.has(name.toLowerCase()) && !hop2CoSeeds.has(k)) {
        hop2CoSeeds.set(k, `${via}→${name}`);
      }
    }
  }
  if (hop2ParentSeeds.size || hop2CoSeeds.size) {
    let added2 = 0;
    for (const e of active) {
      if (hits.has(e.id) || added2 >= limit) continue;
      let matched = null;
      for (const { k } of entryConceptKeys(e)) {
        if (hop2ParentSeeds.has(k)) {
          matched = { hop: 2, via: hop2ParentSeeds.get(k), bonus: 2.0, parentEdge: true };
          break;
        }
        if (!matched && hop2CoSeeds.has(k)) {
          matched = { hop: 2, via: hop2CoSeeds.get(k), bonus: 1.8 };
        }
      }
      if (matched) {
        hits.set(e.id, matched);
        added2++;
      }
    }
  }
  return hits;
}

export function suggestConceptPromotions(entries = [], { existingNotes = null, minCount = 5 } = {}) {
  const threshold = Math.max(2, Number(minCount) || 5);
  let existingSet = null;
  if (existingNotes instanceof Set || Array.isArray(existingNotes)) {
    existingSet = new Set();
    for (const raw of existingNotes) {
      const base = String(raw || "").split("/").pop().replace(/\.md$/i, "").trim();
      const nk = normKey(base);
      if (nk) existingSet.add(nk);
    }
  }
  const active = (entries || []).filter(
    (e) => e && e.state === "有效" && !e.private && e.status !== "deprecated" && e.status !== "rejected" && e.verdict !== "refuted",
  );
  const buckets = new Map();
  for (const e of active) {
    const perEntry = new Set();
    for (const raw of [...(e.concepts || []), ...(e.projectLink ? [e.projectLink] : [])]) {
      const name = normalizeLinkName(raw);
      const nk = normKey(name);
      if (!name || !nk || CONCEPT_STOPWORDS.has(name.toLowerCase()) || perEntry.has(nk)) continue;
      perEntry.add(nk);
      let b = buckets.get(nk);
      if (!b) {
        b = { name, key: nk, entries: [] };
        buckets.set(nk, b);
      }
      b.entries.push(e);
    }
  }
  const all = [...buckets.values()]
    .filter((b) => b.entries.length >= threshold)
    .map((b) => ({
      name: b.name,
      count: b.entries.length,
      exists: existingSet ? existingSet.has(b.key) : false,
      samplePaths: b.entries.slice(0, 5).map((e) => e.path).filter(Boolean),
    }))
    .sort((a, b) => Number(a.exists) - Number(b.exists) || b.count - a.count || a.name.localeCompare(b.name));
  return {
    all,
    ghostCandidates: all.filter((x) => !x.exists),
    denseConcepts: all.filter((x) => x.exists),
  };
}

export function recommendedGraphSettings(current = {}, { memoryDir = "Agent Deck/记忆", preset = "kind" } = {}) {
  const base = current && typeof current === "object" ? { ...current } : {};
  const dir = String(memoryDir || "Agent Deck/记忆").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/"/g, "") || "Agent Deck/记忆";
  const filterTokens = ["-file:\"索引\"", "-file:\"长期记忆\"", "-file:\"log\"", `-path:"${dir}/archive"`];
  const curSearch = String(base.search || "").trim();
  let mergedSearch = filterTokens.join(" ");
  if (curSearch) {
    const missing = filterTokens.filter((tok) => !curSearch.includes(tok));
    mergedSearch = missing.length ? `${curSearch} ${missing.join(" ")}` : curSearch;
  }
  const managedGroups = preset === "trust"
    ? [
      { query: `path:"${dir}" ["status":"deprecated"]`, color: { a: 1, rgb: 6582411 } },
      { query: `path:"${dir}" ["status":"rejected"]`, color: { a: 1, rgb: 5526612 } },
      { query: `path:"${dir}" ["conflicts_with"] ["status":"active"]`, color: { a: 1, rgb: 14701138 } },
      { query: `path:"${dir}" ["verified":true]`, color: { a: 1, rgb: 2278750 } },
      { query: `path:"${dir}" ["provenance":"user-log"]`, color: { a: 1, rgb: 3900150 } },
      { query: `path:"${dir}" ["provenance":"mixed"]`, color: { a: 1, rgb: 440020 } },
      { query: `path:"${dir}" ["provenance":"ai-log"]`, color: { a: 1, rgb: 15105570 } },
      { query: `path:"${dir}" ["provenance":"import"]`, color: { a: 1, rgb: 11032055 } },
      { query: 'path:"Concepts"', color: { a: 1, rgb: 15381256 } },
    ]
    : [
      { query: `path:"${dir}" ["status":"deprecated"]`, color: { a: 1, rgb: 6582411 } },
      { query: `path:"${dir}" ["status":"rejected"]`, color: { a: 1, rgb: 5526612 } },
      { query: `path:"${dir}" ["conflicts_with"] ["status":"active"]`, color: { a: 1, rgb: 14701138 } },
      { query: `path:"${dir}" ["verified":true]`, color: { a: 1, rgb: 2278750 } },
      { query: `path:"${dir}" ["kind":"lesson"]`, color: { a: 1, rgb: 16096779 } },
      { query: `path:"${dir}" ["kind":"preference"]`, color: { a: 1, rgb: 440020 } },
      { query: `path:"${dir}" ["kind":"fact"]`, color: { a: 1, rgb: 3900150 } },
      { query: `path:"${dir}" ["kind":"pattern"]`, color: { a: 1, rgb: 11032055 } },
      { query: 'path:"Concepts"', color: { a: 1, rgb: 15381256 } },
    ];
  const managedQueries = new Set(managedGroups.map((g) => g.query.trim()));
  const managedPrefixRe = new RegExp(`^path:"${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const extraUserGroups = Array.isArray(base.colorGroups)
    ? base.colorGroups.filter((g) => {
      const q = String(g?.query || "").trim();
      if (!q || managedQueries.has(q) || q === 'path:"Concepts"') return false;
      return !managedPrefixRe.test(q);
    })
    : [];
  return {
    ...base,
    showArrow: true,
    hideUnresolved: false,
    "collapse-filter": false,
    "collapse-color-groups": false,
    search: mergedSearch,
    colorGroups: [...managedGroups, ...extraUserGroups],
  };
}
