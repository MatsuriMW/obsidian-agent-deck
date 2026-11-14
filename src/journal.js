// Agent Deck — the journal line grammar.
//
// The AI half of the human–AI journal lives here: task lines, the 🔗 / 💬 / ⏱
// marker lines, and the small helpers that let the plugin rewrite one line
// without touching the rest of the note. Everything in this file is pure: it
// takes text in and returns text out, so it can be tested without Obsidian.

import { createHash } from "crypto";
import { pad, fmtTok } from "./constants.js";
import { t } from "./i18n.js";
import { detailForRound } from "./log-detail.js";

export const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
export const STAMP_RE = /^\*\*(\d{1,2})[:：](\d{2})\*\*\s*/;
export const CHECKBOX_RE = /^\[([ xX\/\-])\]\s*/;
// 任务关键词，长的在前（TODOFORAI 在 TODO 前、WAITING 在 WAIT 前）：KEYWORD_RE 不带前瞻，靠这个顺序
export const TASK_KWS = "TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED";
export const KEYWORD_RE = new RegExp(`^(${TASK_KWS})\\s*`);
const KW_WORD_RE = new RegExp(`^(${TASK_KWS})(?=\\s|$)\\s*`);

// TOREVIEW / NEEDOK / … are the states an agent session switches a line through.
// A line only flips between DOING and these; anything else is the user's.
export const AGENT_KWS = ["TOREVIEW", "NEEDOK", "ERRORED", "HITLIMIT", "QUEUED", "DELEGATED"];
export const AGENT_KW_RE = /^(TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)$/;
export const OPEN_KWS = ["TODO", "LATER", "NOW", "WAITING", "WAIT", "TODOFORAI", "TODO4AI", "TODO2AI", "TODOTOAI"];
export const DONE_KWS = ["DONE", "CANCELED", "CANCELLED", "FAILED"];

// A choice made in the task-state menu remains manual until explicitly released.
export function isManualTask(settings, raw) {
  return !!settings?.manualTaskStates?.[blockIdOf(raw)];
}

export const LINK_RE = /^\s*[-*+]\s+🔗/;
export const RESULT_RE = /^\s*[-*+]\s+💬/;
export const CLOCK_RE = /^\s*[-*+]\s+⏱/;
export const QUESTION_RE = /^\s*[-*+]\s+❓/;
export const PLAN_RE = /^\s*[-*+]\s+📋/;
export const CONTEXT_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:💬|❓|📋)\s/;
// 本插件写下的记录行（和 ai-records.js 的 AI_RECORD_RE 一致），⏱ 也在其中
export const RECORD_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋|⏱|🔗)\s|TODO\s+🤖\s)/;
export const KID_LINK_RE = /^\s*[-*+]\s+🔗\s*(子代理|side chat)\s*`(?:pid\s*)?([0-9a-z]+)`/;
export const AUTO_MARK = "🤖 ";
export const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

export function blockIdOf(line) {
  const m = BLOCK_ID_RE.exec(String(line || ""));
  return m ? m[1] : "";
}

export function stripBlockId(s) {
  return String(s || "").replace(BLOCK_ID_RE, "").trimEnd();
}

export function makeBlockId(seed = "") {
  if (seed) return "ad-" + createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
  let h = "";
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < 6; i++) h += chars[Math.floor(Math.random() * 36)];
  return "ad-" + h;
}

export function ensureBlockId(line, preferId = "") {
  const raw = String(line || "").trimEnd();
  const existing = blockIdOf(raw);
  if (existing) return { line: raw, blockId: existing };
  const id = preferId || makeBlockId();
  return { line: `${raw} ^${id}`, blockId: id };
}

// 会话时段存的是「从日记分界（设置里的 dayCutoff，默认早上 8 点）起算的分钟数」，写成钟点要把分界加回来。
// 插件加载、改设置时 setDayOffset(dayCutoff * 60)；测试里不设就是 0，从零点算
let DAY_OFFSET = 0;
export const setDayOffset = (min) => { DAY_OFFSET = Number(min) || 0; };
export const dayOffset = () => DAY_OFFSET;
export const clock = (t) => { const m = Math.round(t + DAY_OFFSET); return `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`; };
// ⏱ 行：间隔不超过 10 分钟的时段并成一段，只写最后 8 段（ellipsis 时前面标「… 」），后面是总时长、token、哪个 Agent
export function clockLine(indent, segs, who, tok = 0, ellipsis = false) {
  const shown = [];
  for (const [a, b] of segs) {
    const prev = shown[shown.length - 1];
    if (prev && a - prev[1] <= 10) prev[1] = Math.max(prev[1], b);
    else shown.push([a, b]);
  }
  const total = Math.round(segs.reduce((n, [a, b]) => n + b - a, 0));
  const line = `${indent}- ⏱ ${ellipsis && shown.length > 8 ? "… " : ""}${shown.slice(-8).map(([a, b]) => `${clock(a)}–${clock(b)}`).join("、")} · 共 ${durTag(total)}${tok ? ` · ${fmtTok(tok)} tok` : ""}${who ? " · " + who : ""}`;
  return `${line} <!-- ad-clock:${clockHash(line)} -->`;
}

function clockHash(line) {
  let hash = 5381;
  for (const char of line.trim()) hash = Math.imul(hash, 33) ^ char.codePointAt(0);
  return (hash >>> 0).toString(16);
}

// 无原始签名的旧记录按用户内容保留；已修改、加块号或子块的记录也不再更新。
export function mutableClock(lines, n) {
  const marker = /^(.*?) <!-- ad-clock:([a-f0-9]+) -->\s*$/.exec(lines[n]);
  return !!marker && clockHash(marker[1]) === marker[2] && !blockIdOf(lines[n]) && !hasDescendants(lines, n);
}
export const durTag = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "m" : ""}` : `${Math.max(1, Math.round(m))}m`);
export const width = (line) => { let w = 0; for (const c of (/^\s*/.exec(line) || [""])[0]) w += c === "\t" ? 4 : 1; return w; };

export const workKey = (label) => stripBlockId(String(label || "")).replace(/\s*←\s*\S+\s*$/, "").trim();

// 这一行是什么任务：{ prefix, rest, since, kw, cb, blockId, body }；不是列表项返回 null
export function splitTask(raw) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(raw);
  if (!m) return null;
  let [, prefix, rest] = m;
  const st = STAMP_RE.exec(rest);
  if (st) { prefix += st[0]; rest = rest.slice(st[0].length); }
  const cb = CHECKBOX_RE.exec(rest);
  if (cb) rest = rest.slice(cb[0].length);
  const kw = KEYWORD_RE.exec(rest);
  if (kw) rest = rest.slice(kw[0].length);
  const pr = kw && /^\[#[ABC]\]\s*/.exec(rest);
  if (pr) rest = rest.slice(pr[0].length);
  let since = null;
  const t = kw && /^(\d{1,2})[:：](\d{2})(?![\d:：]|\s*[-–~～到至])\s*/.exec(rest);
  if (t) { since = `${pad(+t[1])}:${t[2]}`; rest = rest.slice(t[0].length); }
  if (pr) rest = `${pr[0].trim()} ${rest}`;
  const blockId = blockIdOf(rest);
  const body = stripBlockId(rest);
  return { prefix, rest, body, blockId, since, kw: kw ? kw[1] : null, cb: cb ? cb[1] : null };
}

// ⌘⇧D：把一行任务改成做完的样子。缩进、短横 -、复选框和时间戳都留着，
// 只换状态；checkbox 任务改成 [x]，其它任务换成 DONE。已经做完的返回 null。
export function flipToDone(raw) {
  const part = splitTask(raw);
  if (!part) return null;
  const kw = kwLine(raw)?.kw || '';
  if (DONE_KWS.includes(kw)) return null;
  const box = part.cb ? (part.cb === ' ' || part.cb === '/' ? '[x]' : `[${part.cb}]`) : '';
  const since = part.since ? `${part.since} ` : '';
  const head = box
    ? `${part.prefix}${box} ${since}${part.rest}`
    : `${part.prefix}DONE ${since}${part.rest}`;
  return head.trimEnd();
}

// 一行任务是不是已经做完：关键词（DONE / CANCELLED / FAILED）或复选框 [x] 都算。
export const isDoneLine = (raw) => DONE_KWS.includes(kwLine(raw)?.kw || '');

// 日记里的任务正文和状态（跳过 🔗 / ⏱ / 💬 / ❓ / 📋 / 🤖 记号行）
export function kwLine(raw) {
  let s = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s+/, "").replace(STAMP_RE, "");
  let kw = "";
  const cb = CHECKBOX_RE.exec(s);
  if (cb) { kw = cb[1] === " " ? "TODO" : cb[1] === "/" ? "DOING" : cb[1] === "-" ? "CANCELLED" : "DONE"; s = s.slice(cb[0].length); }
  const m = KW_WORD_RE.exec(s);
  if (m) { kw = m[1]; s = s.slice(m[0].length); }
  const blockId = blockIdOf(s);
  s = stripBlockId(s).replace(/^\[#[ABC]\]\s*/, "").replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～]\s*\d{1,2}[:：]\d{2})?\s*/, "").replace(/^\[#[ABC]\]\s*/, "").trim();
  if (!s || s.startsWith("⏱") || s.startsWith("🔗") || ((!kw && !blockId) && /^(?:💬|❓|📋)/.test(s)) || /^🤖\s*(?:子代理|side chat)/.test(s)) return null;
  return { kw, body: s, blockId };
}

export function parseLink(line) {
  const tracked = /^\s*[-*+]\s+🔗\s*\[([^\]]*)\]\(obsidian:\/\/agent-deck\?do=open&agent=(opencode|qoder)&sid=([^)]*)\)/.exec(line);
  if (tracked) return { agent: tracked[2], sid: decodeURIComponent(tracked[3]), title: tracked[1].replace(/^(OpenCode|Qoder)：/, "") };
  const m = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(claude|codex|workbuddy|dsh|antigravity):\/\/[^)]*?session=([0-9a-f-]{36})/.exec(line);
  if (m) return { agent: m[2], sid: m[3], title: m[1] || "" };
  const d = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(codex):\/\/threads\/([0-9a-f-]{36})|^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(workbuddy):\/\/chat\/([0-9A-Za-z_-]{8,})/.exec(line);
  if (d) return d[2] ? { agent: "codex", sid: d[3], title: d[1] || "" } : { agent: "workbuddy", sid: decodeURIComponent(d[6]), title: d[4] || "" };
  const b = /^\s*[-*+]\s+🔗.*`((?:session-)?[0-9a-f-]{36})`/.exec(line);
  if (!b) return null;
  const agent = /DeepSeek Harness|dsh:\/\//.test(line) ? "dsh" : /Antigravity|antigravity:\/\//i.test(line) ? "antigravity" : /Codex[：:]/.test(line) ? "codex" : /WorkBuddy[：:]/.test(line) ? "workbuddy" : "claude";
  return { agent, sid: b[1], title: "" };
}

export function linkLine(indent, agent, title, sid) {
  const safe = String(title || "").replace(/[\[\]()`]+/g, " ").trim();
  if (["opencode", "qoder"].includes(agent)) return `${indent}- 🔗 [${agent === "opencode" ? "OpenCode" : "Qoder"}：${safe}](obsidian://agent-deck?do=open&agent=${agent}&sid=${encodeURIComponent(sid)})`;
  if (agent === "claude") return `${indent}- 🔗 [Claude：${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- 🔗 [DeepSeek Harness：${safe}](dsh://open) \`${sid}\``;
  if (agent === "antigravity") return `${indent}- 🔗 [Antigravity：${safe}](antigravity://open) \`${sid}\``;
  if (agent === "codex") return `${indent}- 🔗 [Codex：${safe}](codex://threads/${sid})`;
  if (agent === "workbuddy") return `${indent}- 🔗 [WorkBuddy：${safe}](workbuddy://chat/${encodeURIComponent(sid)})`;
  return `${indent}- 🔗 ${agent}：${safe} \`${sid}\``;
}

export function markOwner(lines, i) {
  const ind = width(lines[i]);
  for (let j = i - 1; j >= 0; j--) if (lines[j].trim() && LIST_RE.test(lines[j]) && width(lines[j]) < ind) return j;
  return -1;
}

// markOwner(lines, i) for every line, in one pass. Re-planning a long journal
// asked the same question once per child line, and each answer re-walked the
// note upwards, so a 5k-line journal took ~190 ms; this is O(n) and gives the
// same answer: the nearest earlier list item with a smaller indentation.
export function ownersOf(lines) {
  const out = new Int32Array(lines.length).fill(-1);
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const w = width(lines[i]);
    while (stack.length && stack[stack.length - 1][0] >= w) stack.pop();
    if (stack.length) out[i] = stack[stack.length - 1][1];
    if (LIST_RE.test(lines[i])) stack.push([w, i]);
  }
  return out;
}

export function childMark(lines, n, pick) {
  const base = width(lines[n]);
  for (let i = n + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    const l = pick(lines[i]);
    if (l) return { line: i, ...l };
  }
  return null;
}

export function hasDescendants(lines, n) {
  for (let i = n + 1; i < lines.length; i++) {
    if (lines[i].trim()) return width(lines[i]) > width(lines[n]);
  }
  return false;
}

export const linkUnder = (lines, n) => childMark(lines, n, parseLink);
export const resultUnder = (lines, n) => childMark(lines, n, (l) => (RESULT_RE.test(l) ? {} : null));

// 会话的一条回复压成一行能放进日记的字：代码块、标题、列表符号去掉；会在库里生出东西的写法转义掉；太长在句子结尾截断
export function resultText(raw, max = 200) {
  let t = String(raw || "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ")
    .replace(/\d{12,}/g, "…")
    .replace(/\s+/g, " ").trim();
  const cap = Math.max(40, +max || 200);
  if ([...t].length > cap) {
    const cut = [...t].slice(0, cap).join("");
    const stop = Math.max(...["。", "！", "？", "；", ". ", "! ", "? "].map((c) => cut.lastIndexOf(c)));
    t = (stop > cap * 0.5 ? cut.slice(0, stop + 1) : cut).trim() + "…";
  }
  return t.replace(/\[\[/g, "\\[\\[").replace(/(^|[^\w&\\])#(?=[^\s#])/g, "$1\\#").replace(/==/g, "\\=\\=").replace(/%%/g, "\\%\\%").replace(/\$/g, "\\$").replace(/</g, "\\<").replace(/\s\^(?=[A-Za-z0-9-]+$)/, " \\^");
}

// 提取一轮回复的一句话结论：优先取明确总结句或首句，压成单句并做 Obsidian 转义
export function oneSentenceConclusion(raw, max = 90) {
  const cleaned = String(raw || "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\d{12,}/g, "…")
    .trim();
  if (!cleaned) return "";
  const lines = cleaned.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let pick = lines.find((l) => /^(?:结论|总结|核心结论|一句话总结|已完成|已修复|已更新|已实现|原因|问题在于|搞定|改好)[：:，,\s]/.test(l))
    || lines.find((l) => l.length >= 6 && !/^(?:好的|收到|明白|没问题|我来|让我|先看)[，。！!,.]*$/.test(l))
    || lines[lines.length - 1]
    || cleaned;
  // 取第一句完整的话（至少 6 个字之后的句号/叹号/问号/分号）
  const sentMatch = /^(.{6,}?[。！？；!?;])(?:\s|$)/.exec(pick);
  if (sentMatch) pick = sentMatch[1];
  return resultText(pick, max);
}

// 把会话最后说的话写到它绑着的那件任务下面；已有 💬 就换掉，没有就接在 🔗 后面（支持通过 ^blockId 或 sid 定位）
export function resultInto(text, sid, said, { blockId = "", key = "", ensureId = false } = {}) {
  if (!said) return text;
  const lines = text.split("\n");
  let at = -1, n = -1;
  if (sid && text.includes(sid)) {
    at = lines.findIndex((l) => { const k = parseLink(l); return k && k.sid === sid; });
    if (at >= 0) n = markOwner(lines, at);
  }
  if (n < 0 && blockId) {
    n = lines.findIndex((l) => blockIdOf(l) === blockId && LIST_RE.test(l));
  }
  if (n < 0 && key) {
    const found = findTask(text, key);
    if (found) n = found.line;
  }
  if (n < 0) return text;
  if (ensureId) {
    const eb = ensureBlockId(lines[n], blockId || makeBlockId(sid));
    lines[n] = eb.line;
  }
  const indent = at >= 0 ? (/^\s*/.exec(lines[at])[0]) : childIndent(lines, n);
  const line = `${indent}- 💬 ${said}`;
  const had = resultUnder(lines, n);
  if (had) { if (lines[had.line] === line) return lines.join("\n"); lines[had.line] = line; }
  else lines.splice((at >= 0 ? at : n) + 1, 0, line);
  return lines.join("\n");
}

// Preserve code contents in detailed excerpts while keeping a single foldable list record.
const detailExcerpt = (raw, max) => resultText(String(raw || "").replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm, ""), max);

// Journal detail uses one sentence even when Chinese punctuation has no following space.
const recordSentence = (raw, max) => {
  const text = oneSentenceConclusion(raw, max);
  return text.match(/^.*?[。！？；!?;]/)?.[0] || text;
};

// 把同一个窗口会话（session）里的多轮问答、每轮一句话结论、待拍板问题和 TaskCreate 进度都挂在同一个 ^xxxxx 任务条目下
function sortRecordedRounds(lines, parent) {
  const base = width(lines[parent]), child = width(childIndent(lines, parent));
  const fences = fencedLines(lines), slots = [], records = [];
  for (let i = parent + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    if (fences.has(i) || width(lines[i]) !== child || !CONTEXT_RECORD_RE.test(lines[i]) || /💬\s+累计总结[：:]/.test(lines[i]) || blockIdOf(lines[i])) continue;
    const match = /<!-- ad-turn:[^:]+:(\d+) -->/.exec(lines[i]) || /第(\d+)轮[：:]/.exec(lines[i]);
    if (!match && !RESULT_RE.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || width(lines[end]) > child)) end++;
    slots.push([i, end]);
    records.push({ n: match ? +match[1] : 1, rank: QUESTION_RE.test(lines[i]) ? 0 : RESULT_RE.test(lines[i]) ? 1 : 2, lines: lines.slice(i, end) });
    i = end - 1;
  }
  records.sort((a, b) => b.n - a.n || a.rank - b.rank);
  for (let i = slots.length - 1; i >= 0; i--) lines.splice(slots[i][0], slots[i][1] - slots[i][0], ...records[i].lines);
}

export function syncSessionEntry(text, { sid = "", blockId = "", key = "", said = "", rounds = [], todos = [], taskTodo = null, ensureId = true, detail = "brief", detailHistory = [], granularity = "", compact = null } = {}) {
  let lines = text.split("\n");
  let n = -1, linkAt = -1;
  if (blockId) n = lines.findIndex((l) => blockIdOf(l) === blockId && LIST_RE.test(l));
  if (sid && text.includes(sid)) {
    linkAt = lines.findIndex((l) => { const k = parseLink(l); return k && k.sid === sid; });
    if (linkAt >= 0) n = markOwner(lines, linkAt);
  }
  if (n < 0 && key) {
    const found = findTask(text, key);
    if (found) n = found.line;
  }
  if (n < 0) return { text, line: -1, blockId: blockId || "" };
  let activeBlockId = blockIdOf(lines[n]);
  if (ensureId || blockId) {
    const eb = ensureBlockId(lines[n], activeBlockId || blockId || makeBlockId(sid));
    lines[n] = eb.line;
    activeBlockId = eb.blockId;
  }
  const mode = ["standard", "detailed"].includes(detail) ? detail : "brief";
  // A merged summary is the visible line; the rounds behind it stay in the note
  // so the “更多” toggle can show them, whatever the granularity setting is.
  const roundLog = Boolean(compact?.text) || (granularity ? granularity === "round" : mode !== "brief");
  const base = width(lines[n]);
  const ind = linkAt >= 0 ? (/^\s*/.exec(lines[linkAt])[0]) : childIndent(lines, n);
  const childWidth = width(ind);
  const childSpan = () => {
    let end = n;
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (width(lines[i]) <= base) break;
      end = i;
    }
    return end;
  };
  // Completed records are append-only: changing detail never rewrites saved rounds.
  const fenced = fencedLines(lines), recorded = new Set();
  const sourceTurn = raw => /<!-- ad-turn:([A-Za-z0-9_-]+):(\d+) -->/.exec(raw);
  const legacyOwner = lines.slice(n + 1, childSpan() + 1).map(parseLink).find(Boolean)?.sid || sid;
  const belongs = raw => { const marker = sourceTurn(raw); return marker ? marker[1] === sid : legacyOwner === sid; };
  const provenance = rn => /^[A-Za-z0-9_-]+$/.test(sid) ? ` <!-- ad-turn:${sid}:${rn} -->` : "";
  for (let i = n + 1; i <= childSpan(); i++) {
    if (fenced.has(i) || width(lines[i]) !== childWidth || !belongs(lines[i])) continue;
    const marker = sourceTurn(lines[i]);
    const match = /^\s*[-*+]\s+💬\s+(?:第(\d+)轮[：:]|((?!累计总结[：:]).))/.exec(lines[i]);
    if (marker || match) recorded.add(marker ? +marker[2] : match[1] ? +match[1] : 1);
  }
  let validRounds = (Array.isArray(rounds) ? rounds : []).filter(r => r && (r.said || r.summary));
  if (!validRounds.length && said && !recorded.size) validRounds = [{ n: 1, said }];
  if (!roundLog) validRounds = validRounds.slice(-1);
  const fresh = validRounds.filter((r, index) => !recorded.has(r.n || index + 1));
  // Latest progress limits new additions; saved records always remain untouched.
  const append = line => {
    let at = childSpan() + 1;
    for (let i = n + 1; i < at; i++) if (width(lines[i]) === childWidth && CLOCK_RE.test(lines[i])) { at = i; break; }
    lines.splice(at, 0, line);
  };
  if (compact?.text) {
    const summary = `${ind}- 💬 累计总结：${resultText(compact.text, 170)}`;
    const marker = /^[A-Za-z0-9_-]+$/.test(sid) ? ` <!-- ad-summary:${sid}:${compact.through || 0} -->` : "";
    const saved = lines.slice(n + 1, childSpan() + 1).some(raw => width(raw) === childWidth &&
      (raw === summary || (marker && raw.includes(marker))));
    if (!saved) append(summary + marker);
  }
  for (const [index, r] of fresh.entries()) {
    const rn = r.n || index + 1;
    const level = detailForRound(mode, detailHistory, r);
    if (level !== "brief" && r.ask) {
      const ask = level === "detailed" ? detailExcerpt(r.ask, 1000) : recordSentence(r.ask, 90);
      append(`${ind}- ❓ 第${rn}轮：${ask}${provenance(rn)}`);
    }
    const raw = level === "detailed" ? (r.said || r.summary) : (r.summary || r.said);
    const task = r.taskSummary || r.ask || kwLine(lines[n])?.body?.replace(/^🤖\s*/, "") || key;
    const message = level === "detailed" ? detailExcerpt(raw, 3000) : level === "brief"
      ? `任务：${resultText(task, 45)}；结论：${resultText(raw, 65)}`
      : recordSentence(raw, 90);
    // Number the latest-progress entry too, so a setting change cannot rewrite it.
    const prefix = rn === 1 && roundLog ? "" : `第${rn}轮：`;
    append(`${ind}- 💬 ${prefix}${message}${provenance(rn)}`);
    if (level === "detailed" && r === validRounds.at(-1) && taskTodo?.total > 0) {
      append(`${ind}- 📋 第${rn}轮：步骤 ${taskTodo.done}/${taskTodo.total}${taskTodo.cur ? ` · ${resultText(taskTodo.cur, 90)}` : ""}`);
    }
  }

  // 3) 会话里需要用户拍板/确认的问题（作为子项挂在同一个任务条目下，不另起顶层条目）
  if (Array.isArray(todos) && todos.length) {
    const end = childSpan();
    const existing = lines.slice(n + 1, end + 1).join("\n");
    for (const t of todos) {
      if (!t || existing.includes(t)) continue;
      lines.splice(childSpan() + 1, 0, `${ind}- TODO ${AUTO_MARK}${t}`);
    }
  }

  sortRecordedRounds(lines, n);
  return { text: lines.join("\n"), line: n, blockId: activeBlockId };
}

// 前后两份文字不一样的那一段，换成一次按行改动
export function diffLines(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  if (s === ea && s === eb) return null;
  const mid = b.slice(s, eb);
  if (ea < a.length) return { from: { line: s, ch: 0 }, to: { line: ea, ch: 0 }, text: mid.map((l) => l + "\n").join("") };
  const end = { line: a.length - 1, ch: a[a.length - 1].length };
  if (s > 0) return { from: { line: s - 1, ch: a[s - 1].length }, to: end, text: mid.map((l) => "\n" + l).join("") };
  return { from: { line: 0, ch: 0 }, to: end, text: mid.join("\n") };
}

// 一篇日记里所有的任务行：[{ line, kw, body, key, blockId, indent, state }]
// state = done / doing / paused / open；🔗 / ⏱ / 💬 / ❓ / 📋 记号行不算
// Lines that belong to a fenced code block, so callers never treat a code
// sample as a real task.
export function fencedLines(lines) {
  const out = new Set();
  let fence = '', size = 0;
  lines.forEach((line, n) => {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence || m) out.add(n);
    if (m && !fence) { fence = m[1][0]; size = m[1].length; }
    else if (m && m[1][0] === fence && m[1].length >= size && !m[2].trim()) fence = '';
  });
  return out;
}

// The outermost task block that contains `at`, or -1. Used by the
// "mark DONE and archive" command so the cursor can sit anywhere in a block.
export function taskLineAt(lines, at) {
  if (at < 0 || at >= lines.length || !lines[at].trim()) return -1;
  const fenced = fencedLines(lines);
  if (fenced.has(at)) return -1;   // a code sample is not a task
  for (let i = 0; i <= at; i++) {
    if (fenced.has(i) || !LIST_RE.test(lines[i]) || !kwLine(lines[i])) continue;
    const indent = width(lines[i]);
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || width(lines[end]) > indent)) end++;
    if (at < end) return i;
  }
  return -1;
}

export function taskItems(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!LIST_RE.test(lines[i])) continue;
    const k = kwLine(lines[i]);
    if (!k) continue;
    const st = DONE_KWS.includes(k.kw) ? "done"
      : /^(DOING|NOW|IN-PROGRESS)$/.test(k.kw) || AGENT_KW_RE.test(k.kw) ? "doing"
      : /^(PAUSED|SUSPENDED|WAITING|WAIT)$/.test(k.kw) ? "paused" : "open";
    out.push({ line: i, kw: k.kw, body: k.body, key: workKey(k.body), blockId: k.blockId || "", indent: width(lines[i]), state: st });
  }
  return out;
}

export function findTaskByBlockId(text, blockId) {
  if (!blockId) return null;
  return taskItems(text).find((i) => i.blockId === blockId) || null;
}

// 这一行现在是什么状态（优先按 ^blockId，其次按 🔗 sid，最后按 key）；找不到返回 null
export function findTask(text, key, blockId = "", sid = "") {
  const items = taskItems(text);
  if (sid && text.includes(sid)) {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => { const p = parseLink(l); return p && p.sid === sid; });
    if (at >= 0) {
      const owner = markOwner(lines, at);
      const byOwner = items.find((i) => i.line === owner);
      if (byOwner) return byOwner;
    }
  }
  if (blockId) {
    const byId = items.find((i) => i.blockId === blockId);
    if (byId) return byId;
  }
  if (!key) return null;
  const k = workKey(key);
  const hits = items.filter((i) => i.key === k);
  return hits.find((i) => i.state === "open") || hits.find((i) => i.state === "doing") || hits[0] || null;
}

// 还没做完的任务行，给模型看
export function openTasks(text) {
  return taskItems(text).filter((i) => i.state !== "done").map((i) => ({
    label: i.body,
    doing: i.state === "doing",
    paused: i.kw === "PAUSED" || i.kw === "SUSPENDED",
    line: i.line,
  }));
}

// 一段文字里所有 🔗 绑着的会话：Map(sid → 任务名)
export function linkMap(text) {
  const out = new Map();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = parseLink(lines[i]);
    if (!l) continue;
    const n = markOwner(lines, i);
    const k = n >= 0 ? kwLine(lines[n]) : null;
    if (k) out.set(l.sid, workKey(k.body));
  }
  return out;
}

// subagent / side chat 的子块：子块下面一行「🔗 子代理 `a7de3cf8`」「🔗 side chat `pid 40948`」认它是谁；
// 跑完换成 ⏱ 行，末尾的「子代理 `…`」还认得
export function parseKid(line) {
  const m = KID_LINK_RE.exec(line);
  return m ? { kind: m[1] === "子代理" ? "sub" : "side", id: m[2] } : null;
}
export function kidUnder(lines, n) { return childMark(lines, n, parseKid); }
export function kidIdent(line) {
  const c = parseKid(line);
  if (c) return { ...c, open: true };
  const m = /^\s*[-*+]\s+⏱.*·\s*(子代理|side chat)\s*`(?:pid\s*)?([0-9a-z]+)`\s*$/.exec(line);
  return m ? { kind: m[1] === "子代理" ? "sub" : "side", id: m[2], open: false } : null;
}
export const kidNorm = (s) => String(s || "").replace(/🤖/g, "").replace(/^\s*(?:\d+[.)、]\s*)?(?:(?:TODO|DOING|LATER|NOW|WAITING|WAIT|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)\s+)?(?:\d{1,2}[:：]\d{2}\s*)?/, "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
export function kidMatch(body, desc) {
  const a = kidNorm(body), d = kidNorm(desc);
  if (a.length < 4 || d.length < 4) return false;
  return a.startsWith(d) || d.startsWith(a) || (a.length >= 8 && d.length >= 8 && a.slice(0, 8) === d.slice(0, 8));
}

// ---------- 拖拽绑定：面板里的会话卡片拖到笔记某一行上 ----------

const EMPTY_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s*$/;
const MARKER_RE = /^\s*[-*+]\s+(?:🔗|⏱|💬|❓|📋)/;

// 会话停下来的几种状态 → 任务行上的关键词；回写（sync.js）只认这几种，idle 不写
export const STATE_KW = { wait: "TOREVIEW", quiet: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" };
// 会话现在的状态 → 任务行上的关键词（和回写那一半同一套）
export function kwForState(state) {
  return ({ run: "DOING", running: "DOING", starting: "DOING", idle: "TOREVIEW", ...STATE_KW })[state] || "DOING";
}

// 拖到第 at 行会发生什么：
//   bind  这一行是有字的列表项 → 会话绑到它下面（拖到 🔗 / ⏱ / 💬 记号行上，算它的母项）
//   fill  空的列表项（「- 」「1. 」）→ 就在这一项写上会话
//   new   空行 → 在这儿新建一项
//   below 不是列表的一段文字 → 在它下面新建一项
export function dropKind(lines, at, below = false) {
  if (at < 0 || at >= lines.length) return null;
  const raw = lines[at];
  // 按住 ⌘ 拖：不绑到这一项，在它（连同子项）下面新建一项
  if (below) {
    if (/^\s*(?:#|```|~~~|\|)/.test(raw)) return null;
    const n = MARKER_RE.test(raw) ? markOwner(lines, at) : at;
    if (n < 0) return null;
    if (!raw.trim()) return { kind: "new", line: at };
    return { kind: "after", line: n };
  }
  if (MARKER_RE.test(raw)) {
    const n = markOwner(lines, at);
    return n >= 0 ? { kind: "bind", line: n } : null;
  }
  if (EMPTY_ITEM_RE.test(raw)) return { kind: "fill", line: at };
  if (!raw.trim()) return { kind: "new", line: at };
  if (LIST_RE.test(raw)) return kwLine(raw) ? { kind: "bind", line: at } : null;
  if (/^\s*(?:#|```|~~~|\||>|---)/.test(raw)) return null;   // 标题、代码块、表格、引用、分隔线上不放
  return { kind: "below", line: at };
}

// 这一项的子项用多深的缩进：已经有子项就跟着它，没有就用 tab（和委派写 🔗 的习惯一样）
export function childIndent(lines, n) {
  const base = width(lines[n]);
  for (let i = n + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) > base) return (/^\s*/.exec(lines[i]) || [""])[0];
    break;
  }
  const lead = (/^\s*/.exec(lines[n]) || [""])[0];
  return lead + (lead && !lead.includes("\t") ? "    " : "\t");
}

// 一个任务的记录块里，直属（同一缩进）的记录行号
function recordBlock(lines, n) {
  const base = width(lines[n]);
  const indent = width(childIndent(lines, n));
  const out = [];
  for (let i = n + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    if (width(lines[i]) !== indent) continue;
    if (RECORD_LINE_RE.test(lines[i])) out.push(i);
  }
  return out;
}

// ⏱ 行统一排在本任务记录的最后：先 ❓、再 💬，最后 ⏱。
// 只挪 ⏱，其他记录行（包括多轮 ❓/💬 的配对）保持原顺序。
export function clocksLast(text) {
  const lines = text.split("\n");
  const fenced = fencedLines(lines);
  for (const task of taskItems(text).reverse()) {
    const n = task.line;
    if (fenced.has(n) || !lines[n]?.trim()) continue;   // 围栏里的示例不算任务
    const records = recordBlock(lines, n).filter((i) => !fenced.has(i) && !blockIdOf(lines[i]) && !hasDescendants(lines, i));
    const clocks = records.filter((i) => CLOCK_RE.test(lines[i]));
    const rest = records.filter((i) => !CLOCK_RE.test(lines[i]));
    if (!clocks.length || !rest.length) continue;
    const last = rest[rest.length - 1];
    if (clocks[0] > last) continue;   // 已经在最后
    const moved = clocks.map((i) => lines[i]);
    for (const i of [...clocks].sort((a, b) => b - a)) lines.splice(i, 1);
    const at = last - clocks.filter((i) => i < last).length;
    lines.splice(at + 1, 0, ...moved);
  }
  return lines.join("\n");
}

// 把会话 s 绑到第 at 行（或在那儿新建一项）。s = { sid, agent, title, state, since, dropKey, blockId, ensureBlockId }
//   · 一个会话只绑一处：别处已有的 🔗 先摘掉；自动记日记替它新写过的「🤖 …」那一项（按 blockId 或 dropKey）一起合并收掉
//   · 原文不动，只在前面换上状态关键词（TODO / 没写关键词的 → DOING / TOREVIEW …；DONE、PAUSED 这些你定的不碰）
// 返回 { text, line, kind, blockId } 或 { text, error }
export function bindInto(text, at, s, { below = false } = {}) {
  let lines = text.split("\n");
  const target = dropKind(lines, at, below);
  if (!target) return { text, error: t("这一行放不了会话：拖到列表项、空的列表项或空行上") };
  let n = target.line;
  if (target.kind === "bind") {
    const had = linkUnder(lines, n);
    if (had && had.sid === s.sid) return { text, error: t("这一项已经绑着这个会话了") };
    if (had) return { text, error: t("这一项已经绑着另一个会话；先删掉它下面的 🔗 行") };
  }
  const want = kwForState(s.state);
  const since = s.since || "";
  const title = resultText(s.title || "没起名的会话", 60);
  const rescuedChildren = [];
  let rescuedBlockId = s.blockId || "";

  // 先把这个会话在别处的痕迹收掉，再按内容重新找回目标行
  const anchor = lines[n];
  const drop = (i) => { lines.splice(i, 1); if (i < n) n--; };
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = parseLink(lines[i]);
    if (k && k.sid === s.sid) drop(i);
  }
  if (s.dropKey || s.blockId) {
    const items = taskItems(lines.join("\n"));
    const hit = items.find((t) => t.line !== n && t.body.startsWith(AUTO_MARK.trim()) && ((s.blockId && t.blockId === s.blockId) || (s.dropKey && t.key === workKey(s.dropKey))));
    if (hit) {
      const base = width(lines[hit.line]);
      let end = hit.line, own = true;
      for (let i = hit.line + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        if (!MARKER_RE.test(lines[i]) && !/^\s*[-*+]\s+TODO\s+🤖/.test(lines[i])) own = false;
        end = i;
      }
      if (own) {
        if (hit.blockId && !rescuedBlockId) rescuedBlockId = hit.blockId;
        for (let i = hit.line + 1; i <= end; i++) {
          const cl = lines[i].replace(/^\s+/, "");
          if (cl && !/^[-*+]\s+(?:🔗|⏱)/.test(cl)) rescuedChildren.push(cl);
        }
        for (let i = end; i >= hit.line; i--) drop(i);
      }
    }
  }
  if (lines[n] !== anchor) {
    const back = lines.indexOf(anchor);
    if (back < 0) return { text, error: t("笔记在拖的时候变了，再拖一次") };
    n = back;
  }

  const maybeAddBlockId = (lineStr) => {
    const existing = blockIdOf(lineStr);
    if (existing) return { line: lineStr, blockId: existing };
    if (s.ensureBlockId || rescuedBlockId) {
      return ensureBlockId(lineStr, rescuedBlockId || makeBlockId(s.sid));
    }
    return { line: lineStr, blockId: "" };
  };

  if (target.kind === "bind") {
    const p = splitTask(lines[n]);
    if (p && !p.cb && (!p.kw || OPEN_KWS.includes(p.kw) || p.kw === "DOING" || AGENT_KW_RE.test(p.kw))) {
      lines[n] = `${p.prefix}${want} ${p.since || since} ${p.rest}`.replace(/ {2,}/g, " ").trimEnd();
    }
    const eb = maybeAddBlockId(lines[n]);
    lines[n] = eb.line;
    const ind = childIndent(lines, n);
    const toInsert = [linkLine(ind, s.agent, title, s.sid)];
    const existingChildText = lines.slice(n + 1, n + 15).join("\n");
    for (const rc of rescuedChildren) {
      if (!existingChildText.includes(rc)) toInsert.push(`${ind}${rc}`);
    }
    lines.splice(n + 1, 0, ...toInsert);
    return { text: lines.join("\n"), line: n, kind: "bind", blockId: eb.blockId };
  }

  let prefix;
  if (target.kind === "after") {
    // 和这一项同级，接在它的子项后面；有序列表接着编号
    const base = width(lines[n]);
    let end = n;
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) { const j = lines.findIndex((l, k) => k > i && l.trim()); if (j > 0 && width(lines[j]) > base) continue; break; }
      if (width(lines[i]) <= base) break;
      end = i;
    }
    const pm = /^(\s*)([-*+]|(\d+)([.)]))\s+/.exec(lines[n]);
    prefix = !pm ? "- " : pm[3] ? `${pm[1]}${+pm[3] + 1}${pm[4]} ` : `${pm[1]}${pm[2]} `;
    const eb = maybeAddBlockId(`${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " "));
    const item = eb.line;
    const lead = (/^\s*/.exec(item) || [""])[0];
    const ind = lead + (lead && !lead.includes("\t") ? "    " : "\t");
    lines.splice(end + 1, 0, item, linkLine(ind, s.agent, title, s.sid), ...rescuedChildren.map((rc) => `${ind}${rc}`));
    return { text: lines.join("\n"), line: end + 1, kind: "after", blockId: eb.blockId };
  }
  if (target.kind === "fill") prefix = EMPTY_ITEM_RE.exec(lines[n])[1] + " ";
  else {
    // 空行 / 段落：照着上面最近那一项的缩进和列表符号接着写；上面没有列表就用「- 」
    let prev = -1;
    for (let i = (target.kind === "below" ? n : n - 1); i >= 0; i--) { if (lines[i].trim()) { prev = i; break; } }
    const pm = prev >= 0 ? /^(\s*)([-*+]|(\d+)([.)]))\s+/.exec(lines[prev]) : null;
    prefix = !pm || MARKER_RE.test(lines[prev]) ? (pm ? (/^\s*/.exec(lines[markOwner(lines, prev)] || "") || [""])[0] + "- " : "- ")
      : pm[3] ? `${pm[1]}${+pm[3] + 1}${pm[4]} ` : `${pm[1]}${pm[2]} `;
  }
  const eb = maybeAddBlockId(`${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " "));
  const item = eb.line;
  if (target.kind === "below") { lines.splice(n + 1, 0, item); n = n + 1; }
  else if (target.kind === "new" && lines[n + 1] && lines[n + 1].trim() && !LIST_RE.test(lines[n + 1])) lines.splice(n, 0, item);   // 空行下面紧接一段文字：空行留着，不然那段会变成这一项的续行
  else lines[n] = item;
  const lead = (/^\s*/.exec(item) || [""])[0];
  const ind = lead + (lead && !lead.includes("\t") ? "    " : "\t");
  lines.splice(n + 1, 0, linkLine(ind, s.agent, title, s.sid), ...rescuedChildren.map((rc) => `${ind}${rc}`));
  return { text: lines.join("\n"), line: n, kind: target.kind, blockId: eb.blockId };
}

// 把日记里的两个任务条目（比如一条 🤖 Agent 自动记的、一条人自己写的，或者任意两条）绑定/混合成一条：
//   · 保留人写的标题（如果两条都是人写的或都是 🤖，保留目标行 dstLine 的标题）
//   · 继承活跃状态词（DOING / TOREVIEW 等）与最早的开始时间
//   · 合并两条下面的所有子项（🔗、⏱、💬、❓、📋、子待办），去重并保留/补齐 ^xxxxx 块 ID
export function mergeTasks(text, srcLine, dstLine, { preferId = "" } = {}) {
  const lines = text.split("\n");
  if (srcLine === dstLine || srcLine < 0 || dstLine < 0 || srcLine >= lines.length || dstLine >= lines.length) {
    return { text, error: t("请选择两条不同的任务行") };
  }
  if (MARKER_RE.test(lines[srcLine])) srcLine = markOwner(lines, srcLine);
  if (MARKER_RE.test(lines[dstLine])) dstLine = markOwner(lines, dstLine);
  if (srcLine < 0 || dstLine < 0 || srcLine === dstLine) return { text, error: t("这两行本身已经在同一个任务条目下了") };

  const ps = splitTask(lines[srcLine]);
  const pd = splitTask(lines[dstLine]);
  const ks = kwLine(lines[srcLine]);
  const kd = kwLine(lines[dstLine]);
  if (!ps || !pd || !ks || !kd) return { text, error: t("只能把任务列表项合并到另一条任务列表项上") };

  const blockSpan = (start) => {
    const base = width(lines[start]);
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (width(lines[i]) <= base) break;
      end = i;
    }
    return [start, end];
  };

  const [s0, s1] = blockSpan(srcLine);
  const [d0, d1] = blockSpan(dstLine);
  if ((s0 >= d0 && s0 <= d1) || (d0 >= s0 && d0 <= s1)) {
    return { text, error: t("父子任务不能直接互相合并") };
  }

  // 决定保留哪个标题：人写的优先于 🤖 自动记的；同类型则保留目标行 dstLine
  const srcIsAuto = ks.body.startsWith(AUTO_MARK.trim());
  const dstIsAuto = kd.body.startsWith(AUTO_MARK.trim());
  const keptBody = (dstIsAuto && !srcIsAuto) ? ks.body : kd.body;

  // 决定保留哪个状态关键词与开始时间
  const isLiveKw = (kw) => kw === "DOING" || AGENT_KW_RE.test(kw || "");
  const mergedKw = isLiveKw(ps.kw) ? ps.kw : isLiveKw(pd.kw) ? pd.kw : (pd.kw || ps.kw || "DOING");
  const mergedSince = (ps.since && pd.since) ? (ps.since < pd.since ? ps.since : pd.since) : (pd.since || ps.since || "");

  // 决定保留哪个 ^xxxxx 块 ID
  const blockId = pd.blockId || ps.blockId || preferId || makeBlockId(keptBody);
  const headerRaw = `${pd.prefix}${mergedKw}${mergedSince ? " " + mergedSince : ""} ${keptBody}`.replace(/ {2,}/g, " ").trimEnd();
  const { line: mergedHeader } = ensureBlockId(headerRaw, blockId);

  // 收集并合并两边子项（按目标行的子缩进重排，去重）
  const dstBase = width(lines[dstLine]);
  const srcBase = width(lines[srcLine]);
  const ind = childIndent(lines, dstLine);
  const rebaseChild = (line, base) => {
    const w = width(line);
    const extra = Math.max(0, Math.floor((w - base - 1) / 4));
    return `${ind}${"\t".repeat(extra)}${line.trim()}`;
  };

  const dstKids = lines.slice(d0 + 1, d1 + 1).filter((l) => l.trim()).map((l) => rebaseChild(l, dstBase));
  const srcKids = lines.slice(s0 + 1, s1 + 1).filter((l) => l.trim()).map((l) => rebaseChild(l, srcBase));

  const mergedKids = [...dstKids];
  const seenLinks = new Set(dstKids.map((l) => parseLink(l)?.sid).filter(Boolean));
  const seenText = new Set(dstKids.map((l) => l.trim()));
  for (const k of srcKids) {
    const lk = parseLink(k);
    if (lk && lk.sid) {
      if (seenLinks.has(lk.sid)) continue;
      seenLinks.add(lk.sid);
      mergedKids.unshift(k);
      continue;
    }
    if (CLOCK_RE.test(k)) {
      const idx = mergedKids.findIndex((x) => CLOCK_RE.test(x));
      if (idx >= 0) {
        if (k.length > mergedKids[idx].length) mergedKids[idx] = k;
        continue;
      }
    }
    if (!seenText.has(k.trim())) {
      seenText.add(k.trim());
      mergedKids.push(k);
    }
  }

  const replacement = [mergedHeader, ...mergedKids];
  let newDstLine = d0;
  if (s0 < d0) {
    lines.splice(d0, d1 - d0 + 1, ...replacement);
    lines.splice(s0, s1 - s0 + 1);
    newDstLine = d0 - (s1 - s0 + 1);
  } else {
    lines.splice(s0, s1 - s0 + 1);
    lines.splice(d0, d1 - d0 + 1, ...replacement);
    newDstLine = d0;
  }

  return {
    text: lines.join("\n"),
    line: newDstLine,
    blockId,
    key: workKey(keptBody),
    mergedBody: keptBody,
    srcKey: workKey(ks.body),
    dstKey: workKey(kd.body),
    srcBlockId: ps.blockId || "",
    dstBlockId: pd.blockId || "",
  };
}

// 找出今天日记里实际在运行的任务，等待回复的会话不算正在运行。
export function runningTaskLines(text, sessionByParent, jobs = []) {
  const lines = text.split("\n");
  return taskItems(text).filter((task) => {
    if (task.state === "done") return false;
    if (sessionByParent.get(task.line)?.state === "run") return true;
    return jobs.some((job) => ["starting", "running"].includes(job.state) &&
      ((task.blockId && job.blockId === task.blockId) || job.lineText === lines[task.line]));
  });
}
