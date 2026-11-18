// Memory store: one Markdown file per Dreaming entry, so Bases can show a row per memory.
// Pure text <-> entry helpers only; all vault IO stays in dream.js.
import { createHash } from "crypto";
import { inflateRawSync } from "zlib";

export const MEMORY_DIR_DEFAULT = "Agent Deck/记忆";
export const OVERVIEW_START = "<!-- ad:memory:start -->";
export const OVERVIEW_END = "<!-- ad:memory:end -->";
export const MEMORY_STATES = ["有效", "已拒绝", "已被替代"];
export const MEMORY_KINDS = { fact: "事实", preference: "偏好", pattern: "待验证规律", lesson: "项目经验" };

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
export const memoryIdOf = (text) => "m-" + hash(String(text || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));

// File names are for humans; identity is the `id` in frontmatter, so renaming never breaks anything.
export function memorySlug(text, max = 40) {
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

// Tolerant of user-added frontmatter & Base-created rows: unknown keys are ignored, never rejected.
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
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const body = lines.slice(end + 1);
  const bodyText = body.find((l) => l.trim() && l.trim() !== "## 证据")?.trim() || "";
  const title = str(meta.title);
  const typeRaw = str(meta.type);
  const kindRaw = str(meta.kind);
  const stateRaw = str(meta.state);
  const idRaw = str(meta.id);
  const text = bodyText || title;
  const kind = MEMORY_KINDS[kindRaw]
    ? kindRaw
    : KIND_BY_LABEL[typeRaw] || (text && (stateRaw || idRaw) ? inferMemoryKind(text) : "");
  if (!kind || !text) return null;
  const evidence = [];
  const ev = body.findIndex((l) => l.trim() === "## 证据");
  if (ev >= 0) for (const line of body.slice(ev + 1)) { const m = /^-\s+(.*)$/.exec(line); if (m) evidence.push(m[1].trim()); }
  return {
    id: idRaw || memoryIdOf(text),
    kind,
    title,
    type: typeRaw || MEMORY_KINDS[kind] || "",
    text,
    state: MEMORY_STATES.includes(stateRaw) ? stateRaw : "有效",
    verified: str(meta.verified).toLowerCase() === "true",
    private: str(meta.private).toLowerCase() === "true",
    domain: str(meta.domain) || str(meta.category),
    tags: Array.isArray(meta.tags) ? meta.tags.filter(Boolean) : (str(meta.tags) ? [str(meta.tags)] : []),
    date: str(meta.date),
    sources: Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [],
    supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
    evidence,
  };
}

// 兼容 Obsidian Bases 行内新建/编辑：补齐缺失的 state/date/type/kind/id，并保持 title 与正文同步。
export function reconcileMemoryFile(content, { today = "" } = {}) {
  const raw = String(content ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);

  let fmLines = [], bodyLines = lines;
  const meta = {}, keyOrder = [], listValues = new Map();
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end < 0) return null;
    fmLines = lines.slice(1, end);
    bodyLines = lines.slice(end + 1);
    let activeList = "";
    for (const line of fmLines) {
      const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
      if (m) {
        const key = m[1];
        keyOrder.push(key);
        if (m[2]) { meta[key] = unYamlStr(m[2]); activeList = ""; }
        else { meta[key] = ""; listValues.set(key, []); activeList = key; }
        continue;
      }
      const item = /^\s+-\s*(.*)$/.exec(line);
      if (item && activeList) listValues.get(activeList).push(unYamlStr(item[1]));
    }
    const isMemoryNote = !raw.trim() || "kind" in meta || "state" in meta || "id" in meta || "type" in meta || "title" in meta;
    if (!isMemoryNote) return null;
  } else if (raw.trim()) {
    return null;
  }

  const title = oneLine(meta.title);
  const firstBodyIdx = bodyLines.findIndex((l) => l.trim() && l.trim() !== "## 证据");
  const bodyText = firstBodyIdx >= 0 ? oneLine(bodyLines[firstBodyIdx]) : "";
  const idNow = oneLine(meta.id);
  let text = bodyText || title;
  if (title && bodyText && title !== bodyText) {
    if (idNow && memoryIdOf(title) !== idNow && memoryIdOf(bodyText) === idNow) text = title;
    else if (idNow && memoryIdOf(bodyText) !== idNow && memoryIdOf(title) === idNow) text = bodyText;
  }

  const typeRaw = oneLine(meta.type);
  const kindRaw = oneLine(meta.kind);
  let kind = MEMORY_KINDS[kindRaw] ? kindRaw : KIND_BY_LABEL[typeRaw] || "";
  if (KIND_BY_LABEL[typeRaw] && KIND_BY_LABEL[typeRaw] !== kind) kind = KIND_BY_LABEL[typeRaw];
  if (!kind) kind = text ? inferMemoryKind(text) : "fact";
  const type = MEMORY_KINDS[kind] || typeRaw || "事实";
  const state = MEMORY_STATES.includes(oneLine(meta.state)) ? oneLine(meta.state) : "有效";
  const date = /^\d{4}-\d{2}-\d{2}/.exec(oneLine(meta.date))?.[0] || day;
  const id = text ? memoryIdOf(text) : idNow;

  const nextMeta = { ...meta, id, title: text, kind, type, state, date };
  const coreKeys = ["id", "title", "kind", "type", "state", "date"];
  const extraKeys = keyOrder.filter((k) => !coreKeys.includes(k));
  const outFm = ["---"];
  for (const key of [...coreKeys, ...extraKeys]) {
    if (listValues.has(key) && listValues.get(key).length) {
      outFm.push(`${key}:`, ...listValues.get(key).map((v) => `  - ${yamlStr(v)}`));
    } else if (key === "title") {
      outFm.push(`title: ${text ? yamlStr(text) : ""}`);
    } else if (key === "id" && !id) {
      continue;
    } else {
      const v = nextMeta[key];
      if (v === undefined || v === "") outFm.push(`${key}:`);
      else if (typeof v === "string" && (/[:#\r\n]/.test(v) || /^[\s[\]{}*&!|>'"%@`]/.test(v))) outFm.push(`${key}: ${yamlStr(v)}`);
      else outFm.push(`${key}: ${v}`);
    }
  }
  outFm.push("---");

  let nextBody = bodyLines.slice();
  if (text) {
    if (firstBodyIdx >= 0) nextBody[firstBodyIdx] = text;
    else nextBody = ["", text, ""];
  } else if (!nextBody.length) {
    nextBody = [""];
  }
  const out = [...outFm, ...nextBody].join("\n").replace(/\n*$/, "\n");
  if (out === raw || out === `${raw}\n`) return null;
  return out;
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

// Bases 视图：一行就是一条记忆；支持直接新建、改行内属性与删除文件。
export function memoryBase(dir = MEMORY_DIR_DEFAULT) {
  return [
    "filters:",
    "  and:",
    `    - 'file.inFolder("${dir}")'`,
    '    - file.ext == "md"',
    `    - 'file.path != "${dir}/索引.md"'`,
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

const KIND_BY_LABEL = Object.fromEntries(Object.entries(MEMORY_KINDS).map(([k, v]) => [v, k]));

export function inferMemoryKind(text = "", hint = "") {
  const h = String(hint || "").trim().toLowerCase();
  if (MEMORY_KINDS[h]) return h;
  if (KIND_BY_LABEL[hint]) return KIND_BY_LABEL[hint];
  const s = String(text || "");
  if (/（待验证|待验证推断|待验证）|\b(?:hypothesis|unverified)\b/i.test(s) || /^(?:用户)?推断[，：:\s]/.test(s)) return "pattern";
  if (/偏好|喜欢|不喜欢|反感|倾向|习惯|要求|严禁|不买|宁可|优先|\b(?:prefer|prefers|wants|always|never)\b/i.test(s)) return "preference";
  if (/经验|教训|踩坑|必须|应当|切忌|避免|方案|架构|系统中|在\s*[A-Za-z\u4e00-\u9fff]+\s*中[，,]/i.test(s)) return "lesson";
  return "fact";
}

// 兼容直接扔进 Claude 导出的 memories-*.json（展开里面的 memory_files）或普通 Markdown 文档。
export function expandImportedDocs(docs = []) {
  const out = [];
  for (const doc of docs || []) {
    if (!doc || typeof doc.content !== "string") continue;
    const name = String(doc.name || doc.path || "未命名.md");
    if (name.toLowerCase().endsWith(".json")) {
      try {
        const data = JSON.parse(doc.content);
        if (Array.isArray(data?.memory_files)) {
          for (const mf of data.memory_files) {
            if (mf && typeof mf.content === "string" && mf.content.trim()) {
              const date = /^\d{4}-\d{2}-\d{2}/.exec(String(mf.updated_at || ""))?.[0] || doc.date || "";
              out.push({ name: String(mf.path || name).replace(/^\/+/, ""), path: String(mf.path || name).replace(/^\/+/, ""), content: mf.content, date });
            }
          }
          continue;
        }
      } catch { /* 非 JSON 或结构不同则按普通文本回退 */ }
    }
    out.push({ name, path: String(doc.path || name), content: doc.content, date: doc.date || "" });
  }
  return out;
}

// 解析标准 ZIP（如 Claude 导出的 memories-000.zip）内的 .md / .json / .txt 文本，无需外部命令或第三方库。
export function unzipTextEntries(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const out = [];
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 || dataStart + compSize > buf.length) break;
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const raw = buf.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (name.endsWith("/") || !/\.(?:md|markdown|txt|json)$/i.test(name)) continue;
    try {
      const content = (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null)?.toString("utf8");
      if (content && content.trim()) out.push({ name, path: name, content });
    } catch { /* 跳过损坏条目 */ }
  }
  return out;
}

export async function readDroppedBrowserFiles(fileList) {
  const docs = [];
  for (const file of Array.from(fileList || [])) {
    if (!file) continue;
    const name = String(file.name || "未命名.md");
    const date = file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : "";
    if (/\.zip$/i.test(name) && typeof file.arrayBuffer === "function") {
      for (const entry of unzipTextEntries(await file.arrayBuffer())) {
        docs.push({ ...entry, date });
      }
      continue;
    }
    if (!/\.(?:md|markdown|txt|json)$/i.test(name) || typeof file.text !== "function") continue;
    const content = await file.text();
    if (content && content.trim()) docs.push({ name, path: name, content, date });
  }
  return expandImportedDocs(docs);
}

// 模式 A（0 Token 规则拆条）：支持单条记忆文件、旧版长列表、Claude [stated] 导出与普通 Markdown 列表。
export function parseMarkdownToMemories(docs = [], { defaultDate = "" } = {}) {
  const fallbackDay = /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : new Date().toISOString().slice(0, 10);
  const expanded = expandImportedDocs(docs);
  const out = [], seen = new Set();
  const push = (item) => {
    const text = oneLine(item.text);
    if (!text || text.length < 4 || text.length > 500) return;
    const id = item.id || memoryIdOf(text);
    if (seen.has(id) || seen.has(memoryIdOf(text))) return;
    seen.add(id);
    seen.add(memoryIdOf(text));
    const kind = MEMORY_KINDS[item.kind] ? item.kind : inferMemoryKind(text, item.kind);
    const date = /^\d{4}-\d{2}-\d{2}/.exec(String(item.date || ""))?.[0] || fallbackDay;
    out.push({
      id,
      kind,
      type: MEMORY_KINDS[kind],
      text,
      state: MEMORY_STATES.includes(item.state) ? item.state : "有效",
      date,
      sources: Array.isArray(item.sources) && item.sources.length ? item.sources : item.source ? [item.source] : [],
    });
  };

  for (const doc of expanded) {
    const raw = String(doc.content || "");
    const single = parseMemoryFile(raw);
    if (single) {
      push({ ...single, date: single.date || doc.date });
      continue;
    }
    const lines = raw.split("\n");
    let bodyStart = 0, fmDate = doc.date || "";
    if (lines[0]?.trim() === "---") {
      const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
      if (end > 0) {
        bodyStart = end + 1;
        for (const l of lines.slice(1, end)) {
          const m = /^(?:date|updated_at|created_at|synced_at):\s*"?(\d{4}-\d{2}-\d{2})/.exec(l.trim());
          if (m) { fmDate = m[1]; break; }
        }
      }
    }
    const label = String(doc.path || doc.name || "外部导入").replace(/\.md$/i, "");
    const srcRef = label.includes("/") && !label.startsWith("http") ? `[[${label}]]` : label;
    let inFence = false, extractedFromDoc = 0;

    for (let i = bodyStart; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (/^\s+-\s+(?:状态|来源)：/.test(line)) continue;
      const legacy = /^- \*\*(事实|偏好|待验证规律|项目经验)\*\*：(.+?)(?: \^dream-[a-f0-9]+)?$/.exec(line.trim());
      if (legacy) {
        let j = i + 1, state = "有效";
        const sources = [];
        while (j < lines.length && /^\s+\S/.test(lines[j])) {
          const st = /^\s+-\s+状态：(有效|已拒绝|已被替代)/.exec(lines[j]);
          const sr = /^\s+-\s+来源：(.*)$/.exec(lines[j]);
          if (st) state = st[1];
          if (sr && sr[1].trim()) sources.push(sr[1].trim());
          j++;
        }
        push({ kind: KIND_BY_LABEL[legacy[1]] || "fact", text: legacy[2], state, date: fmDate, sources: sources.length ? sources : [`${srcRef}（第 ${i + 1} 行）；原文：${oneLine(legacy[2])}`] });
        extractedFromDoc++;
        i = j - 1;
        continue;
      }
      const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (!bullet) continue;
      let text = bullet[1].trim().replace(/\s+\^[A-Za-z0-9-]+$/, "").trim();
      if (!text || /^[-_*]{3,}$/.test(text) || /^⤴\s+\[\[/.test(text)) continue;
      let hint = "";
      const tagMatch = /^\[([A-Za-z_\u4e00-\u9fff-]+)\]\s*(.+)$/.exec(text);
      if (tagMatch) {
        hint = tagMatch[1];
        text = tagMatch[2].trim();
      }
      const boldKind = /^\*\*(事实|偏好|待验证规律|项目经验)\*\*[：:]\s*(.+)$/.exec(text);
      if (boldKind) {
        hint = boldKind[1];
        text = boldKind[2].trim();
      }
      if (text.length < 6) continue;
      push({
        kind: inferMemoryKind(text, hint),
        text,
        date: fmDate,
        source: `${srcRef}（第 ${i + 1} 行）；原文：${oneLine(text).slice(0, 240)}`,
      });
      extractedFromDoc++;
    }

    if (!extractedFromDoc) {
      const paragraphs = lines
        .slice(bodyStart)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--") && !/^[-_*]{3,}$/.test(l));
      if (paragraphs.length === 1 && paragraphs[0].length >= 6 && paragraphs[0].length <= 400) {
        push({
          kind: inferMemoryKind(paragraphs[0]),
          text: paragraphs[0],
          date: fmDate,
          source: `${srcRef}；原文：${oneLine(paragraphs[0]).slice(0, 240)}`,
        });
      }
    }
  }
  return out;
}
