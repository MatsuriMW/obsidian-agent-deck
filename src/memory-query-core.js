// Pure memory tokenization, scoring, and privacy-gate helpers.
// Zero Obsidian/DOM/IO dependencies so core logic is testable and reusable.

export const MIN_MEMORY_OVERLAP = 2;

const STOP_LATIN = new Set([
  "this", "that", "with", "from", "have", "will", "your", "they", "them", "what", "when", "where", "which",
  "into", "onto", "only", "also", "more", "most", "some", "such", "than", "then", "very", "just", "like",
  "make", "made", "need", "used", "using", "work", "done", "todo", "doing", "note", "notes", "file", "files",
  "code", "test", "tests", "task", "tasks", "mode", "user", "agent", "agents", "claude", "codex", "obsidian",
  "plugin", "true", "false", "null", "none", "json", "markdown",
]);

// 中文按字组二元词、拉丁按 ≥2 字符切分，用于「记忆 vs 本次任务」的词面重叠打分。
export function terms(value) {
  return new Set(
    (String(value || "").toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]+/g) || []).flatMap((w) =>
      /^[\u4e00-\u9fff]/.test(w) ? [...w].slice(1).map((c, i) => w[i] + c) : [w],
    ),
  );
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

function entryMetaTerms(entry) {
  const parts = [];
  if (Array.isArray(entry?.tags)) parts.push(...entry.tags);
  if (entry?.domain) parts.push(entry.domain);
  if (entry?.category) parts.push(entry.category);
  if (entry?.type) parts.push(entry.type);
  for (const src of entry?.sources || []) {
    const m = /^\[\[([^\]|#]+)/.exec(String(src || ""));
    if (m) parts.push(m[1].split("/").pop());
  }
  return terms(parts.join(" "));
}

export function scoreMemoryRelevance(entry, wanted) {
  const textTerms = terms(entry?.text);
  const overlap = [...textTerms].filter((w) => wanted.has(w));
  if (overlap.length >= MIN_MEMORY_OVERLAP) return overlap.length;
  if (overlap.length === 1 && isDistinctiveLatinTerm(overlap[0])) return 1.5;
  if (overlap.length >= 1) {
    const metaTerms = entryMetaTerms(entry);
    const metaHits = [...metaTerms].filter((w) => wanted.has(w) && !textTerms.has(w));
    if (metaHits.length >= 1) return overlap.length + 0.5 * metaHits.length;
  }
  return 0;
}

export function pickMemoriesFromEntries(entries = [], text = "", {
  limit = 5,
  maxChars = 1200,
  formatLine = (e) => `- ${e.type || e.kind || ""}：${e.text}`,
} = {}) {
  const wanted = terms(text);
  if (!wanted.size) return [];
  const scored = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && entry.state === "有效" && entry.kind && !entry.private)
    .map(({ entry, index }) => ({
      entry,
      line: formatLine(entry),
      score: scoreMemoryRelevance(entry, wanted),
      index,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const out = [];
  let size = 0;
  for (const { entry, line } of scored) {
    if (out.length >= limit) break;
    if (size + line.length + 1 > maxChars) continue;
    out.push(entry);
    size += line.length + 1;
  }
  return out;
}
