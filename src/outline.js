// Shared read-only Markdown outline & wikilink primitives.
// Pure functions only: zero dependency on Obsidian, DOM, or note writers.

export const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
export const WIKILINK_RE = /(?<!!)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
// 与 WIKILINK_RE 相同，但包含 `![[...]]` 嵌入引用；上下文解析用，统计/归档仍按 WIKILINK_RE 排除镜像。
const EMBED_WIKILINK_RE = /!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
export const MIRROR_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s+)?(?:(?:TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)\s+)?(!?\[\[([^\]|#]+)#\^([A-Za-z0-9-]+)(?:\|([^\]]+))?\]\])\s*$/i;

export function parseMirrorRef(line) {
  const m = MIRROR_LINE_RE.exec(String(line || ""));
  if (!m) return null;
  return {
    raw: m[1],
    target: String(m[2] || "").trim(),
    blockId: String(m[3] || "").trim(),
    alias: String(m[4] || "").trim(),
  };
}

export function width(line) {
  let w = 0;
  for (const c of (/^\s*/.exec(line) || [""])[0]) w += c === "\t" ? 4 : 1;
  return w;
}

export function fencedLines(lines) {
  const out = new Set();
  let fence = "";
  let size = 0;
  for (let n = 0; n < lines.length; n++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[n]);
    if (fence || m) out.add(n);
    if (m && !fence) {
      fence = m[1][0];
      size = m[1].length;
    } else if (m && m[1][0] === fence && m[1].length >= size && !m[2].trim()) {
      fence = "";
    }
  }
  return out;
}

export function frontmatterEnd(lines) {
  if (!Array.isArray(lines) || lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return lines.length;
}

export function ownersOf(lines, fenced = null) {
  const out = new Int32Array(lines.length).fill(-1);
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced?.has(i) || !lines[i].trim()) continue;
    const w = width(lines[i]);
    while (stack.length && stack[stack.length - 1][0] >= w) stack.pop();
    if (stack.length) out[i] = stack[stack.length - 1][1];
    if (LIST_RE.test(lines[i])) stack.push([w, i]);
  }
  return out;
}

export function markOwner(lines, i) {
  const ind = width(lines[i]);
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j].trim() && LIST_RE.test(lines[j]) && width(lines[j]) < ind) return j;
  }
  return -1;
}

export function subtreeEnd(lines, startLine, maxEnd = lines.length) {
  const indent = width(lines[startLine] || "");
  let end = startLine + 1;
  const limit = Math.min(maxEnd, lines.length);
  while (end < limit && (!lines[end].trim() || width(lines[end]) > indent)) end++;
  return end;
}

// 从最外层到直接母项，保留母项正文与续行，不带兄弟分支。
export function ancestorLines(lines, at, fenced = fencedLines(lines)) {
  if (at < 0 || at >= lines.length) return [];
  const stack = [];
  for (let i = 0; i <= at; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const w = width(line);
    while (stack.length && stack.at(-1).width >= w) stack.pop();
    if (i === at) break;
    if (!fenced.has(i) && LIST_RE.test(line)) stack.push({ width: w, body: [line] });
    else if (stack.length) stack.at(-1).body.push(line);
  }
  return stack.flatMap((item) => item.body);
}

export function extractWikilinkRefs(lines = [], { embeds = false } = {}) {
  const refs = [];
  const seen = new Set();
  const re = embeds ? EMBED_WIKILINK_RE : WIKILINK_RE;
  // 多行块文本按行展开；代码块内的示例链接不算上下文引用。
  const flat = lines.flatMap((line) => String(line ?? "").split("\n"));
  const fenced = fencedLines(flat);
  for (let i = 0; i < flat.length; i++) {
    if (fenced.has(i)) continue;
    const line = flat[i];
    for (const m of line.matchAll(re)) {
      const target = String(m[1] || "").trim();
      if (!target) continue;
      const subpath = String(m[2] || "").trim();
      const alias = String(m[3] || "").trim();
      const key = `${target}#${subpath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ target, subpath, alias });
    }
  }
  return refs;
}
