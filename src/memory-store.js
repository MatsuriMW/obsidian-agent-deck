// Memory store: one Markdown file per Dreaming entry, so Bases can show a row per memory.
// Pure text <-> entry helpers only; all vault IO stays in dream.js.
import { createHash } from "crypto";

export const MEMORY_DIR_DEFAULT = "Agent Deck/记忆";
export const OVERVIEW_START = "<!-- ad:memory:start -->";
export const OVERVIEW_END = "<!-- ad:memory:end -->";
export const MEMORY_STATES = ["有效", "已拒绝", "已被替代"];
export const MEMORY_KINDS = { fact: "事实", preference: "偏好", pattern: "待验证规律", lesson: "项目经验" };

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
export const memoryIdOf = (text) => "m-" + hash(String(text || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));

// File names are for humans; identity is the `id` in frontmatter, so renaming never breaks anything.
export function memorySlug(text, max = 22) {
  // 不按标点硬切（会把"在RAG系统中，设置拒答门槛"砍成"在RAG系统中"），只截长度并清掉结尾的悬挂标点。
  const clean = String(text || "").replace(/[\\/:*?"<>|#^[\]\s]/g, "").trim();
  const cut = [...clean].slice(0, max).join("").replace(/[，。、；：！？,.;:!?（(【「《\s]+$/u, "");
  return cut || "记忆";
}

export function memoryFileName({ date, text, taken = new Set() }) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : new Date().toISOString().slice(0, 10);
  const base = `${day}-${memorySlug(text)}`;
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
  return `${base}-${Date.now()}`;
}

// `[[双链]]` 裸写进 YAML 会被当成嵌套数组，整段 frontmatter 解析失败，所以列表项一律加引号。
function yamlStr(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// 读回时去掉外层引号并还原转义，保证序列化/解析对称。
function unYamlStr(value) {
  const text = String(value ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\(["\\])/g, "$1") : text;
}

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function serializeMemoryFile({ id, kind, text, state = "有效", date = "", sources = [], supersedes = [], evidence = [] }) {
  const lines = ["---", `id: ${oneLine(id) || memoryIdOf(text)}`, `title: ${yamlStr(oneLine(text))}`, `kind: ${oneLine(kind)}`, `type: ${MEMORY_KINDS[kind] || oneLine(kind)}`, `state: ${MEMORY_STATES.includes(state) ? state : "有效"}`, `date: ${oneLine(date)}`];
  if (supersedes.length) lines.push("supersedes:", ...supersedes.map((s) => `  - ${yamlStr(s)}`));
  if (sources.length) lines.push("sources:", ...sources.map((s) => `  - ${yamlStr(s)}`));
  lines.push("---", "", oneLine(text), "");
  return lines.join("\n");
}

// Tolerant of user-added frontmatter: unknown keys are ignored, never rejected.
export function parseMemoryFile(content) {
  const lines = String(content || "").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta = {};
  let list = "";
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) { const key = m[1]; list = m[2] ? "" : key; meta[key] = m[2] ? unYamlStr(m[2]) : []; continue; }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && Array.isArray(meta[list])) meta[list].push(unYamlStr(item[1]));
  }
  const body = lines.slice(end + 1);
  const text = body.find((l) => l.trim() && l.trim() !== "## 证据")?.trim() || "";
  if (!meta.kind || !text) return null;
  const evidence = [];
  const ev = body.findIndex((l) => l.trim() === "## 证据");
  if (ev >= 0) for (const line of body.slice(ev + 1)) { const m = /^-\s+(.*)$/.exec(line); if (m) evidence.push(m[1].trim()); }
  return {
    id: meta.id || memoryIdOf(text),
    kind: meta.kind,
    title: meta.title || "",
    type: meta.type || MEMORY_KINDS[meta.kind] || "",
    text,
    state: MEMORY_STATES.includes(meta.state) ? meta.state : "有效",
    verified: meta.verified === "true",
    date: meta.date || "",
    sources: Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [],
    supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
    evidence,
  };
}

// Same list shape the old single note used, so activeMemory / sharedMemory / injection keep working unchanged.
export function renderMemoryList(entries = []) {
  return entries
    .filter((e) => e.text)
    .map((e) => {
      const anchor = `^dream-${String(e.id || memoryIdOf(e.text)).replace(/^m-/, "")}`;
      const head = `- **${MEMORY_KINDS[e.kind] || e.type || "记忆"}**：${oneLine(e.text)} ${anchor}`;
      const rows = [`  - 状态：${e.state || "有效"}`];
      for (const source of e.sources || []) rows.push(`  - 来源：${source}`);
      return [head, ...rows].join("\n");
    })
    .join("\n");
}

// The overview note keeps whatever the user wrote outside the markers; only the block is generated.
export function renderOverview(current = "", entries = []) {
  const block = `${OVERVIEW_START}\n${renderMemoryList(entries)}\n${OVERVIEW_END}`;
  const start = current.indexOf(OVERVIEW_START), end = current.indexOf(OVERVIEW_END);
  const broken = (start < 0) !== (end < 0) || (start >= 0 && (end < start || current.indexOf(OVERVIEW_START, start + 1) >= 0 || current.indexOf(OVERVIEW_END, end + 1) >= 0));
  if (broken) return null;
  if (start < 0) return `${current.trimEnd() || "# Agent Deck 长期记忆"}\n\n${block}\n`;
  return current.slice(0, start) + block + current.slice(end + OVERVIEW_END.length);
}

// Bases 视图：一行就是一条记忆。Base 只读，勾/叉仍由命令写回 frontmatter。
export function memoryBase(dir = MEMORY_DIR_DEFAULT) {
  return [
    "filters:",
    "  and:",
    `    - 'file.inFolder("${dir}")'`,
    '    - file.ext == "md"',
    "",
    "views:",
    "  - type: table",
    "    name: 全部记忆",
    "    order: [title, type, state, date]",
    "  - type: table",
    "    name: 待确认",
    "    filters:",
    "      and:",
    '        - state == "有效"',
    '        - \'!file.hasProperty("verified")\'',
    "    order: [title, type, date]",
    "  - type: table",
    "    name: 已失效",
    "    filters:",
    "      and:",
    '        - state != "有效"',
    "    order: [title, type, state]",
    "",
  ].join("\n");
}

// 来源行：`[[笔记#^块号]]（用户日志，第 3—5 行）；原文：…`
export function parseSourceLine(raw) {
  const s = String(raw || "");
  const m = /^\[\[([^\]|#]+)(?:#\^([^\]|]+))?\]\]（([^，]+)，第 (\d+)—(\d+) 行）；原文：([\s\S]*)$/.exec(s);
  if (!m) return { raw: s, target: (/^\[\[([^\]|#]+)/.exec(s) || [])[1] || "", quoted: false };
  return { raw: s, target: m[1], blockId: m[2] || "", kind: m[3], from: Number(m[4]), to: Number(m[5]), quote: m[6], quoted: true };
}

export function formatSourceLine({ target, blockId, kind, from, to, quote }) {
  return `[[${target}${blockId ? "#^" + blockId : ""}]]（${kind}，第 ${from}—${to} 行）；原文：${quote}`;
}

// 来源原文的块号。前缀刻意不用 ad-/agy- 等任务号，避免被当成任务块或内部标识清理掉。
export function memoryAnchorId(target, text) {
  return "mem-" + createHash("sha256").update(`${target}\n${String(text || "").trim()}`).digest("hex").slice(0, 8);
}

// 审阅队列的起点：优先用户光标所在的记忆（或光标所在行里的记忆回链），否则从第一条开始。
export function orderForReview(entries = [], { path = "", line = "", dir = "" } = {}) {
  const prefix = dir ? `${String(dir).replace(/\/+$/, "")}/` : "";
  let start = -1;
  if (path && prefix && path.startsWith(prefix)) start = entries.findIndex((e) => e.path === path);
  if (start < 0 && line) start = entries.findIndex((e) => line.includes(`[[${e.path.replace(/\.md$/, "")}`));
  if (start <= 0) return entries.slice();
  return [...entries.slice(start), ...entries.slice(0, start)];
}

// 记忆索引：一个文件装下全部标题，AI 一次 cat/grep 就能看到所有记忆，
// 不依赖文件名长度（文件名有 255 字节上限，中文约 85 字就会截断）。
export function renderMemoryIndex(entries = [], at = "") {
  const stamp = at || new Date().toISOString().slice(0, 16).replace("T", " ");
  const rows = [...entries]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || a.text).localeCompare(String(b.title || b.text)))
    .map((e) => `- ${e.date || "—"} · ${MEMORY_KINDS[e.kind] || e.type || "记忆"} · ${e.title || e.text} → [[${String(e.path || "").replace(/\.md$/, "")}]]`);
  return [
    "# 记忆索引",
    "",
    `共 ${entries.length} 条 · 由插件生成（${stamp}）。这里只有标题，正文在各自文件里。`,
    "AI 用法：`grep -h '^title:' 记忆/*.md` 或直接读这个文件。",
    "",
    ...(rows.length ? rows : ["- （还没有记忆）"]),
    "",
  ].join("\n");
}
