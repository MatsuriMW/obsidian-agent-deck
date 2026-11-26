// Pure memory tokenization, scoring, domain-routing, and privacy-gate helpers.
// Zero Obsidian/DOM/IO dependencies so core logic is testable and reusable.

export const MIN_MEMORY_OVERLAP = 2;

export const STOP_LATIN = new Set([
  "this", "that", "with", "from", "have", "will", "your", "they", "them", "what", "when", "where", "which",
  "into", "onto", "only", "also", "more", "most", "some", "such", "than", "then", "very", "just", "like",
  "make", "made", "need", "used", "using", "work", "done", "todo", "doing", "note", "notes", "file", "files",
  "code", "test", "tests", "task", "tasks", "mode", "user", "agent", "agents", "claude", "codex", "obsidian",
  "plugin", "true", "false", "null", "none", "json", "markdown",
]);

export const STOP_CJK = new Set([
  "用户", "可以", "需要", "通过", "进行", "使用", "一个", "没有", "不是", "这个", "那个", "如果", "因为",
  "所以", "以及", "或者", "相关", "目前", "当前", "问题", "内容", "记录", "建议", "提出", "认为", "觉得",
  "自己", "我们", "他们", "设置", "怎么", "如何", "什么", "哪些", "这样", "那样", "已经", "仍然", "还是",
  "虽然", "但是", "不过", "而且", "并且", "只是", "就是", "关于", "对于", "时候", "地方", "方面", "情况",
  "方式", "方法", "作为", "成为", "因此", "从而", "避免", "确保", "应当", "必须", "应该", "一下", "一些",
  "这些", "那些", "同时", "另外", "其余", "其他", "所有", "全部",
]);

const HYBRID_TERM_RE = /(?<![a-z0-9])[a-z]\s*[\u4e00-\u9fff]/gi;
const TOKEN_RE = /[a-z0-9_-]{2,}|[\u4e00-\u9fff]+/g;

// 提取原始词元：中文按二元组，拉丁词按 >=2 字符，另保留「单字母+中文」（如 A股 / B站 / C端）。
export function rawTerms(value) {
  const s = String(value || "");
  const out = new Set();
  for (const w of s.toLowerCase().match(TOKEN_RE) || []) {
    if (/^[\u4e00-\u9fff]/.test(w)) {
      const chars = [...w];
      for (let i = 1; i < chars.length; i++) out.add(chars[i - 1] + chars[i]);
    } else {
      out.add(w);
    }
  }
  for (const m of s.match(HYBRID_TERM_RE) || []) {
    out.add(m.replace(/\s+/g, "").toLowerCase());
  }
  return out;
}

// 过滤高频虚词，避免跨记忆噪音命中；若全被过滤则回退保留原词。
export function terms(value) {
  const raw = rawTerms(value);
  if (!raw.size) return raw;
  const filtered = new Set([...raw].filter((t) => !STOP_CJK.has(t)));
  return filtered.size ? filtered : raw;
}

export function isHybridTerm(term) {
  return /^[a-z][\u4e00-\u9fff]$/.test(String(term || ""));
}

// 单独一个中文二元词太容易误配（如「设置」「一次」）；
// 但像 esbuild / windows / sqlite 这类 ≥4 字符的非停用英文词元，或「1 个正文词 + 元数据/来源命中」应能召回。
export function isDistinctiveLatinTerm(term) {
  return /^[a-z0-9][a-z0-9_-]{3,}$/.test(term) && !/^\d+$/.test(term) && !STOP_LATIN.has(term);
}

export function isPrivateFrontmatter(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return false;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return false;
  for (const line of lines.slice(1, end)) {
    const m = /^private:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const val = m[1].replace(/^['"]|['"]$/g, "").trim().toLowerCase();
    return val === "true";
  }
  return false;
}

export function normalizeExcludedDirs(dirs = []) {
  const list = Array.isArray(dirs) ? dirs : String(dirs || "").split(/[\n,;]+/);
  return list
    .map((d) => String(d || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

export function isPathExcluded(notePath, excludedDirs = []) {
  const norm = String(notePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm) return false;
  const dirs = normalizeExcludedDirs(excludedDirs);
  return dirs.some((dir) => norm === dir || norm.startsWith(`${dir}/`));
}

function normalizeProjectKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_\-·.]+/g, "");
}

function stripLinkWrap(raw) {
  return String(raw || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
}

function entryMetaTerms(entry) {
  const parts = [];
  if (entry?.project) parts.push(entry.project);
  if (entry?.projectLink) parts.push(stripLinkWrap(entry.projectLink));
  if (Array.isArray(entry?.concepts)) parts.push(...entry.concepts.map(stripLinkWrap));
  if (Array.isArray(entry?.conflictsWith)) parts.push(...entry.conflictsWith.map(stripLinkWrap));
  if (entry?.appliesTo) parts.push(entry.appliesTo);
  if (Array.isArray(entry?.tags)) parts.push(...entry.tags);
  if (entry?.domain) parts.push(entry.domain);
  if (entry?.category) parts.push(entry.category);
  if (entry?.description) parts.push(entry.description);
  if (entry?.type) parts.push(entry.type);
  if (entry?.kind) parts.push(entry.kind);
  for (const src of entry?.sources || []) {
    const m = /^\[\[([^\]|#]+)/.exec(String(src || ""));
    if (m) parts.push(m[1].split("/").pop());
  }
  return terms(parts.join(" "));
}

const TECH_DOMAINS = new Set(["engineering", "code", "dev", "build", "cross-platform", "readers", "ops", "infra", "software", "tech"]);
const LIFE_DOMAINS = new Set(["life", "health", "personal", "lifestyle", "family", "travel", "finance", "diet", "sleep"]);
const PERSONAL_LIFE_RE = /(睡眠|作息|座驾|汽车|轮毂|健身|体重|饮食|咖啡|买房|红利股|老登股|消费板块|旅游|家人|父母|恋爱|婚姻|星座|\br90\b)/i;
const PROPOSAL_ONLY_RE = /(?:尚未实施|未实施|仍待.{0,12}验证|尚未验证|不能视为已验证|未说明是否实测|未经验证的推断|(?:只|仅)完成改造.{0,16}待.{0,8}验证)/;

export function isMemoryStale(entry, nowMs = Date.now()) {
  const raw = String(entry?.staleAfter || entry?.validUntil || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const untilMs = Date.parse(raw);
  return Number.isFinite(untilMs) && nowMs >= untilMs + 86400000;
}

export function deriveTrustLevel(entry) {
  if (!entry) return "unverified";
  if (entry.verified === true || String(entry.verifiedBy || "").trim().toLowerCase().startsWith("human:")) return "human-reviewed";
  const prov = String(entry.provenance || "").trim().toLowerCase();
  const gen = String(entry.generatedBy || "").trim().toLowerCase();
  if (prov === "ai-log" || gen === "mcp") return "ai-derived";
  if (prov) return "user-authored";
  const srcs = Array.isArray(entry.sources) ? entry.sources.map((s) => String(s || "")) : [];
  if (srcs.some((s) => s.includes("AI 记录")) && !srcs.some((s) => s.includes("用户日志"))) return "ai-derived";
  if (srcs.length) return "user-authored";
  return "unverified";
}

function isPersonalKind(entry) {
  return entry?.kind === "fact" || entry?.kind === "pattern" || entry?.type === "事实" || entry?.type === "待验证规律";
}

function isLessonKind(entry) {
  return entry?.kind === "lesson" || entry?.type === "项目经验";
}

function isTechDomain(entry) {
  return TECH_DOMAINS.has(String(entry?.domain || "").trim().toLowerCase());
}

function isLifeDomain(entry) {
  return LIFE_DOMAINS.has(String(entry?.domain || "").trim().toLowerCase());
}

// 统计独立语义命中数并标记连续重叠中文二元词，避免单一长词拆分霸占多词计数。
function analyzeTextHits(text, wanted) {
  const s = String(text || "").toLowerCase();
  const cjkOverlapped = new Set();
  const cjkNonOverlapped = new Set();
  const nonCjkHits = new Set();
  for (const w of wanted || []) {
    if (!STOP_CJK.has(w) && !/^[\u4e00-\u9fff]{2}$/.test(w) && rawTerms(s).has(w)) nonCjkHits.add(w);
  }
  let distinctCjk = 0;
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const chars = [...run];
    let lastEnd = -1;
    for (let i = 1; i < chars.length; i++) {
      const bg = chars[i - 1] + chars[i];
      if (!wanted.has(bg) || STOP_CJK.has(bg)) continue;
      if (i - 1 >= lastEnd) {
        distinctCjk++;
        lastEnd = i + 1;
        cjkNonOverlapped.add(bg);
      } else if (!cjkNonOverlapped.has(bg)) {
        cjkOverlapped.add(bg);
      }
    }
  }
  return {
    distinctHits: nonCjkHits.size + distinctCjk,
    overlappedOnly: new Set([...cjkOverlapped].filter((bg) => !cjkNonOverlapped.has(bg))),
  };
}

// 计算逆文档频率（IDF），抑制高频模板词在大量记忆中霸榜。
export function computeIdfMap(entries = []) {
  const df = new Map();
  let n = 0;
  for (const entry of entries || []) {
    if (!entry || entry.private) continue;
    n++;
    const seen = new Set([...terms(entry.text), ...entryMetaTerms(entry)]);
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  }
  const idf = new Map();
  for (const [w, count] of df) idf.set(w, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

export function scoreMemoryEntry(entry, wanted, {
  idf = null,
  projectName = "",
  isCodeProject = null,
  nowMs = Date.now(),
  includeStale = false,
  graphHit = null,
} = {}) {
  const zero = { score: 0, why: [], textHits: [], metaHits: [], projectMatch: false, trust: "unverified", stale: false, distinctHits: 0 };
  if (!entry || (!wanted?.size && !graphHit)) return zero;
  const st = String(entry.status || "").trim().toLowerCase();
  const verdict = String(entry.verdict || "").trim().toLowerCase();
  if (st === "deprecated" || st === "rejected" || verdict === "refuted") return zero;
  const stale = isMemoryStale(entry, nowMs);
  if (stale && !includeStale) return { ...zero, stale: true };

  const textTerms = terms(entry.text);
  const textHits = wanted?.size ? [...textTerms].filter((w) => wanted.has(w) && !STOP_CJK.has(w)) : [];
  const metaTerms = entryMetaTerms(entry);
  const metaHits = wanted?.size ? [...metaTerms].filter((w) => wanted.has(w) && !textTerms.has(w) && !STOP_CJK.has(w)) : [];
  const { distinctHits, overlappedOnly } = wanted?.size ? analyzeTextHits(entry.text, wanted) : { distinctHits: 0, overlappedOnly: new Set() };

  const wantProj = normalizeProjectKey(projectName);
  const entryProj = normalizeProjectKey(entry.project || entry.appliesTo || stripLinkWrap(entry.projectLink));
  const projectMatch = Boolean(wantProj && entryProj && (wantProj === entryProj || entryProj.includes(wantProj) || wantProj.includes(entryProj)));

  const hasHybrid = textHits.some(isHybridTerm);
  const hasDistinctiveLatin = textHits.some(isDistinctiveLatinTerm);
  const lexicalQualified =
    textHits.length >= MIN_MEMORY_OVERLAP ||
    hasDistinctiveLatin ||
    hasHybrid ||
    (textHits.length >= 1 && metaHits.length >= 1) ||
    (projectMatch && (textHits.length >= 1 || metaHits.length >= 1));
  const hasGraph = Boolean(graphHit && Number(graphHit.bonus) > 0);
  const hasHop1Graph = hasGraph && (graphHit.hop === 1 || graphHit.explicitRef === true);
  const hasStrongGraph = hasHop1Graph || Boolean(hasGraph && graphHit.parentEdge === true);
  if (!lexicalQualified && !hasStrongGraph) return zero;

  // 代码项目任务域分流：过滤与代码项目无关的个人生活事实/低重叠私人规律，保留技术设计与 ≥3 独立命中（或一跳图谱连通）的工程设计事实。
  if (isCodeProject === true && isPersonalKind(entry) && !projectMatch && !isTechDomain(entry) && !(wantProj && String(entry.text || "").toLowerCase().includes(wantProj))) {
    if (isLifeDomain(entry) || PERSONAL_LIFE_RE.test(entry.text) || (!hasHop1Graph && distinctHits < 3)) {
      return zero;
    }
  }

  const weightOf = (w) => {
    const base = idf?.get(w) ?? 1;
    const damp = overlappedOnly.has(w) ? 0.5 : 1;
    if (isHybridTerm(w)) return base * 1.4 * damp;
    if (isDistinctiveLatinTerm(w)) return base * 1.15 * damp;
    return base * damp;
  };
  let score = textHits.reduce((s, w) => s + weightOf(w), 0) + 0.6 * metaHits.reduce((s, w) => s + weightOf(w), 0);

  // 多词覆盖加分：防止单高频泛词（如"路径"/"默认"）盖过同时命中多关键词的经验/规则。
  const matchedTerms = new Set([...textHits, ...metaHits]);
  if (wanted?.size >= 2 && matchedTerms.size >= 2) {
    const coverage = matchedTerms.size / Math.min(wanted.size, 6);
    score += 1.45 * coverage;
  }

  // 轻度长度归一化，防止长废话条目压过精炼规则。
  score /= 1 + Math.max(0, textTerms.size - 24) * 0.015;
  if (hasGraph) score += textHits.length ? graphHit.bonus * 0.6 : graphHit.bonus;

  const trust = entry.trust || deriveTrustLevel(entry);
  if (trust === "human-reviewed") score *= 1.35;
  else if (trust === "ai-derived") score *= 0.72;
  if ((entry.kind === "pattern" || entry.type === "待验证规律") && verdict !== "confirmed") score *= 0.85;
  if (!entry.verified && PROPOSAL_ONLY_RE.test(String(entry.text || ""))) score *= 0.42;
  if (stale) score *= 0.35;
  if (projectMatch) score *= 1.35;

  if (isCodeProject === true) {
    if (isLessonKind(entry)) {
      score *= (entryProj && wantProj && !projectMatch) ? 0.55 : 1.2;
    } else if (isPersonalKind(entry)) {
      score *= 0.65;
    }
  } else if (isCodeProject === false) {
    if (!isLessonKind(entry)) score *= 1.15;
  }

  if (entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    const ageDays = (nowMs - Date.parse(entry.date)) / 86400000;
    if (Number.isFinite(ageDays)) {
      if (ageDays <= 90) score += 0.08;
      else if (ageDays > 180) score = Math.max(0.01, score - 0.05);
    }
  }

  const why = [...new Set([...textHits, ...metaHits])];
  if (projectMatch && (entry.project || entry.appliesTo)) why.push(`项目:${entry.project || entry.appliesTo}`);
  if (hasGraph && graphHit.via) why.push(`图谱:${graphHit.via}`);
  return { score, why, textHits, metaHits, projectMatch, trust, stale, distinctHits };
}

export function scoreMemoryRelevance(entry, wanted, opts = {}) {
  return scoreMemoryEntry(entry, wanted, opts).score;
}

export function pickMemoriesFromEntries(entries = [], text = "", {
  limit = 5,
  maxChars = 1200,
  formatLine = (e) => `- ${e.type || e.kind || ""}：${e.text}`,
  projectName = "",
  isCodeProject = null,
  excludeIds = null,
  includeStale = false,
  nowMs = Date.now(),
  graphHits = null,
  returnDetails = false,
} = {}) {
  const wanted = terms(text);
  const gMap = graphHits instanceof Map ? graphHits : null;
  if (!wanted.size && !(gMap && gMap.size)) return [];
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const eligible = (entries || []).filter((e) => e && e.state === "有效" && e.kind && !e.private && !excluded.has(e.id));
  if (!eligible.length) return [];
  const idf = eligible.length >= 6 ? computeIdfMap(eligible) : null;
  const scored = eligible
    .map((entry, index) => {
      const detail = scoreMemoryEntry(entry, wanted, {
        idf,
        projectName,
        isCodeProject,
        includeStale,
        nowMs,
        graphHit: gMap ? (gMap.get(entry.id) || null) : null,
      });
      return { entry, line: formatLine(entry), ...detail, index };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const out = [];
  const selectedItems = [];
  let size = 0;
  for (const item of scored) {
    if (out.length >= limit) break;
    if (size + item.line.length + 1 > maxChars) continue;
    const txt = String(item.entry?.text || "").trim();
    const curSize = terms(txt).size;
    const isNearDup = txt.length >= 16 && curSize >= 6 && selectedItems.some((prev) => {
      if (prev.length < 16 || prev.size < 6) return false;
      const sim = memorySimilarity(prev.text, txt);
      return sim.containment >= 0.65 || sim.jaccard >= 0.55;
    });
    if (isNearDup) continue;
    out.push(returnDetails ? { entry: item.entry, score: item.score, why: item.why, projectMatch: item.projectMatch, trust: item.trust, stale: item.stale } : item.entry);
    selectedItems.push({ text: txt, size: curSize, length: txt.length });
    size += item.line.length + 1;
  }
  return out;
}

// 两条记忆的词面相似度，供体检与巩固去重分组用。
export function memorySimilarity(aText, bText) {
  const a = terms(aText);
  const b = terms(bText);
  if (!a.size || !b.size) return { jaccard: 0, containment: 0, shared: 0 };
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  const minSize = Math.min(a.size, b.size);
  return {
    jaccard: union ? shared / union : 0,
    containment: minSize ? shared / minSize : 0,
    shared,
  };
}
