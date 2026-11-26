// Agent Deck — the journal line grammar.
//
// The AI half of the human–AI journal lives here: task lines, the 🔗 / 💬 / ⏱
// marker lines, and the small helpers that let the plugin rewrite one line
// without touching the rest of the note. Everything in this file is pure: it
// takes text in and returns text out, so it can be tested without Obsidian.

import { createHash } from "crypto";
import { AGENTS, pad, fmtTok, fmtClock, unionSegs, DEFAULT_RECORD_RULES, resolveRecordRules } from "./constants.js";
import { t } from "./i18n.js";
import { detailForRound } from "./log-detail.js";
import { cleanUserPrompt, condenseUserPrompt } from "./prompt-text.js";
import { formatSummaryLinks } from "./summary-links.js";
import { LIST_RE, width, fencedLines, ownersOf, markOwner, subtreeEnd, parseMirrorRef } from "./outline.js";
import { TASK_KWS } from "./context-core/note-hygiene.js";

export { LIST_RE, width, fencedLines, ownersOf, markOwner, subtreeEnd, parseMirrorRef, TASK_KWS };
export const STAMP_RE = /^\*\*(\d{1,2})[:：](\d{2})\*\*\s*/;
export const CHECKBOX_RE = /^\[([ xX\/\-])\]\s*/;
// 任务关键词，长的在前（TODOFORAI 在 TODO 前、WAITING 在 WAIT 前），并要求词边界且只匹配全大写或全小写
export const TASK_KWS_RE_SRC = `${TASK_KWS}|${TASK_KWS.toLowerCase()}`;
export const KEYWORD_RE = new RegExp(`^(${TASK_KWS_RE_SRC})(?=\\s|$)\\s*`);
const KW_WORD_RE = KEYWORD_RE;

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
export const RESULT_RE = /^\s*[-*+]\s+(?:💬|(?:第\d+轮|Round\s+\d+)[：:])/;
export const CLOCK_RE = /^\s*[-*+]\s+⏱/;
export const QUESTION_RE = /^\s*[-*+]\s+❓/;
export const PLAN_RE = /^\s*[-*+]\s+📋/;
export const CONTEXT_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋)\s|(?:第\d+轮|Round\s+\d+)[：:])/;
export const RECORD_ICON_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋|⏱|🔗)\s|(?:第\d+轮|Round\s+\d+)[：:])/;
// 本插件写下的记录行（和 ai-records.js 的 AI_RECORD_RE 一致），⏱ 也在其中
export const RECORD_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋|⏱|🔗)\s|(?:第\d+轮|Round\s+\d+)[：:]|(?:TODO|todo)\s+🤖\s)/;
export const RECORD_PROVENANCE_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->/g;
export const RECORD_PROVENANCE_LINE_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->[ \t]*$/;
const RECORD_PROVENANCE_TEST_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->/;
export const PIN_MARKER = "<!-- ad-pin -->";
export const PIN_MARKER_RE = /(?:^|[ \t]+)<!--\s*ad-pin\s*-->/i;
export function hasPinMarker(line) { return PIN_MARKER_RE.test(String(line || "")); }
export function stripPinMarker(line) { return String(line || "").replace(/[ \t]*<!--\s*ad-pin\s*-->[ \t]*/gi, " ").replace(/[ \t]+(\^[A-Za-z0-9-]+\s*)$/, " $1").trimEnd(); }
export function togglePinMarker(line) {
  const s = String(line || "");
  if (hasPinMarker(s)) return stripPinMarker(s);
  const m = /\s+(\^[A-Za-z0-9-]+)\s*$/.exec(s);
  return m ? `${s.slice(0, m.index).trimEnd()} ${PIN_MARKER} ${m[1]}` : `${s.trimEnd()} ${PIN_MARKER}`;
}
const TASK_KW_LEAD_RE = new RegExp(`^\\s*(?:${TASK_KWS})\\s+`, "i");
const TASK_KW_BULLET_LEAD_RE = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:${TASK_KWS})\\s+`, "i");
export function stripTaskKeyword(raw, { allowBullet = false } = {}) {
  return String(raw || "").replace(allowBullet ? TASK_KW_BULLET_LEAD_RE : TASK_KW_LEAD_RE, "");
}
export function stripInlineTitleMarkup(raw, { stripHash = false } = {}) {
  return String(raw || "")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
    .replace(stripHash ? /[*_`~#]/g : /[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function stripBoundSessionSuffix(line, link = parseLink(line)) {
  const s = String(line || "");
  if (!link?.sid) return s;
  const suffix = /[ \t]+`([^`]+)`[ \t]*$/.exec(s);
  return suffix?.[1] === link.sid ? s.slice(0, suffix.index).trimEnd() : s;
}
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

const AGENT_ID_PREFIX = { antigravity: "agy", claude: "claude", codex: "codex", dsh: "dsh", workbuddy: "wb", opencode: "oc", qoder: "qoder", cursor: "cursor", trae: "trae", grokbot: "grokbot", teleagent: "ta", t3code: "t3code", cindy: "cindy", orca: "orca", muse: "muse", kimicode: "kimi", doubaowork: "doubao", gemini: "gemini" };
const BLOCK_ID_AGENT = Object.fromEntries(Object.entries(AGENT_ID_PREFIX).map(([agent, prefix]) => [prefix, agent]));
export function agentFromBlockId(id) {
  const m = /^([a-z0-9]+)-/i.exec(String(id || "").trim());
  return m ? (BLOCK_ID_AGENT[m[1].toLowerCase()] || "") : "";
}
export const isDeckBlockId = id => /^(?:ad-[a-z0-9-]+|(?:agy|claude|codex|dsh|wb|oc|qoder|cursor|trae|grokbot|ta|t3code|cindy|orca|muse|kimi|doubao|gemini)-(?:[a-z][a-z0-9]{0,15}-){0,2}[a-z0-9]{10})$/i.test(id || "");
export function normalizeTaskSlug(value) {
  const slug = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  return /^[a-z][a-z0-9]{0,15}(?:-[a-z][a-z0-9]{0,15})?$/.test(slug) ? slug : "";
}
// 块号里"人能看懂的那部分"：优先用标题里的英文关键词，没有英文就退到日期（如 d1118）。
// 尾部随机码只负责唯一性；至少让扫源码的人能看出这是哪天、哪个主题。
export function readableSlug(title, now = Date.now()) {
  const slug = normalizeTaskSlug(title);
  if (slug) return slug;
  const d = new Date(now);
  return `d${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export const isLegacyBlockId = id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "");
export const shortSessionId = seed => BigInt("0x" + createHash("sha256").update(String(seed)).digest("hex").slice(0, 12)).toString(36).padStart(10, "0");
export const sessionMarker = (kind, sid, round) => `<!-- ad-${kind}:${shortSessionId(sid)}:${round} -->`;
export const turnMarker = (sid, round) => sessionMarker("turn", sid, round);
export const hasRecordedTurn = (text, sid, round) => text.includes(turnMarker(sid, round)) || text.includes(`<!-- ad-turn:${sid}:${round} -->`);

export function makeBlockId(seed = "", agent = "", slug = "") {
  const task = normalizeTaskSlug(slug);
  const prefix = (AGENT_ID_PREFIX[agent] || "ad") + (task ? "-" + task : "");
  if (seed) return prefix + "-" + shortSessionId(seed);
  let h = "";
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < 10; i++) h += chars[Math.floor(Math.random() * 36)];
  return prefix + "-" + h;
}

// Only generated identifiers in completed AI tasks are removed. Links and user
// blocks remain usable; active nested tasks and fenced examples keep their IDs.
export function cleanCompletedIdentifiers(text, trackedIds = new Set()) {
  const crlf = /\r\n/.test(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n"), fenced = fencedLines(lines), owners = ownersOf(lines), ai = new Set();
  const record = raw => RECORD_LINE_RE.test(raw) || /^\s*[-*+]\s+⏳\s/.test(raw);
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const k = LIST_RE.test(lines[i]) && kwLine(lines[i]);
    if (k && (k.body.startsWith("🤖") || isDeckBlockId(k.blockId) || trackedIds.has(k.blockId))) ai.add(i);
    if ((parseLink(lines[i]) || (record(lines[i]) && RECORD_PROVENANCE_TEST_RE.test(lines[i]))) && owners[i] >= 0) ai.add(owners[i]);
  }
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i) || !lines[i].trim()) continue;
    while (stack.length && width(lines[stack.at(-1)]) >= width(lines[i])) stack.pop();
    const k = LIST_RE.test(lines[i]) && kwLine(lines[i]);
    if (k && (k.kw || ai.has(i)) && !record(lines[i])) stack.push(i);
    const parent = stack.at(-1);
    if (parent === undefined || !ai.has(parent) || !isDoneLine(lines[parent])) continue;
    if (i !== parent && !record(lines[i])) continue;
    const id = blockIdOf(lines[i]);
    if (isDeckBlockId(id) || (i === parent && isLegacyBlockId(id))) lines[i] = stripBlockId(lines[i]);
    if (record(lines[i])) lines[i] = lines[i].replace(RECORD_PROVENANCE_RE, "");
  }
  return lines.join(crlf ? "\r\n" : "\n");
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
// 与螺旋日程（AI_IDLE = 5 分钟）同一套会话活动切段规则：把分钟时间戳切分为活跃时段并求并集。
export function tsToActiveSegs(tsList = [], idleMin = 5) {
  const sorted = (tsList || []).filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const out = [];
  let a = sorted[0], b = a + 1;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    if (t - b <= idleMin) b = Math.max(b, t);
    else { out.push([a, b]); a = t; b = t + 1; }
  }
  out.push([a, b]);
  return unionSegs(out);
}

// ⏱ 行：交叠时段先按 unionSegs 去重，间隔不超过 10 分钟并成一段写最后 8 段，后面是真实净用时、token、哪个 Agent
export function clockLine(indent, segs, who, tok = 0, ellipsis = false) {
  const valid = (segs || []).filter((s) => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] >= s[0]);
  const merged = unionSegs(valid);
  const shown = [];
  for (const [a, b] of merged) {
    const prev = shown[shown.length - 1];
    if (prev && a - prev[1] <= 10) prev[1] = Math.max(prev[1], b);
    else shown.push([a, b]);
  }
  const total = Math.round(merged.reduce((n, [a, b]) => n + Math.max(0, b - a), 0));
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

// 区分 Agent Deck 写入/维护的 ⏱ 行与螺旋日程番茄钟等外部手写 ⏱ 行，避免互相覆盖或阻塞。
export function isAgentClockLine(raw, who = "") {
  const s = String(raw || "");
  if (!CLOCK_RE.test(s)) return false;
  if (/ <!-- ad-clock:[a-f0-9]+ -->\s*$/.test(s)) return true;
  if (who && stripBlockId(s).trimEnd().endsWith(` · ${who}`)) return true;
  return false;
}

// 在任务子树下新增或原地更新未手改的 Agent Deck ⏱ 行；外部 ⏱（如螺旋日程番茄钟）原样跳过不干涉。
export function upsertClockLine(lines, ownerLine, segs, who, tok = 0, ellipsis = true) {
  if (!Array.isArray(lines) || ownerLine < 0 || ownerLine >= lines.length || !segs?.length) return false;
  const line = clockLine(childIndent(lines, ownerLine), segs, who, tok, ellipsis);
  const bare = line.replace(/ <!-- ad-clock:[a-f0-9]+ -->$/, "");
  const base = width(lines[ownerLine]);
  let end = ownerLine;
  for (let i = ownerLine + 1; i < lines.length; i++) {
    if (lines[i].trim() && width(lines[i]) <= base) break;
    if (lines[i].trim()) end = i;
    if (CLOCK_RE.test(lines[i]) && markOwner(lines, i) === ownerLine) {
      if (!isAgentClockLine(lines[i], who)) continue;
      if (lines[i] === line || lines[i] === bare) return false;
      if (!mutableClock(lines, i)) return false;
      lines[i] = line;
      return true;
    }
  }
  lines.splice(end + 1, 0, line);
  return true;
}
export const durTag = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "m" : ""}` : `${Math.max(1, Math.round(m))}m`);

export const workKey = (label) => stripBlockId(String(label || "")).replace(/\s*←\s*\S+\s*$/, "").trim();

const TIME_SPAN_PREFIX_RE = /^(\d{1,2})[:：](\d{2})(?:\s*[-–~～到至]\s*(\d{1,2})[:：](\d{2}))?\s*/;
const TIME_RANGE_PREFIX_RE = /^(\d{1,2})[:：](\d{2})\s*[-–~～到至]\s*(\d{1,2})[:：](\d{2})\s*/;

// 把原始会话标题或首句提示词浓缩成简洁的任务标题（去掉路径、链接、口水前缀和过长从句）
export function summarizeAutoTitle(raw, max = 22) {
  let s = stripTaskKeyword(
    stripBlockId(String(raw || ""))
      .replace(/[\r\n←`*=~[\]|]/g, " ")
      .replace(/^🤖\s*/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""),
  )
    .replace(/^🤖\s*/, "")
    .replace(TIME_SPAN_PREFIX_RE, "")
    .replace(/^🤖\s*/, "")
    .replace(/Files mentioned by the user:\s*(?:##\s*\S+\s*)*/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/[^\s/，,。；;）)]+(?:\/[^\s/，,。；;）)]+)*\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#][^\s，,。；;）)]*)?(?=$|[\s，,。；;）)])/gi, " $1 ")
    .replace(/https?:\/\/[^\s，,。；;）)]+/gi, " ")
    .trim();

  const pathMatch = /(?:\/Users\/|~\/)(?:[^\s/\\]|\\ )+\/([A-Za-z0-9._\u4e00-\u9fa5-]+)\/?/.exec(s);
  const pathBase = pathMatch ? pathMatch[1] : "";
  s = s
    .replace(/(?:仓库|项目|目录|路径|位置|文件)[：:]\s*(?:\/Users\/|~\/)(?:[^\s，,。；;）)]|\\ )+/g, " ")
    .replace(/(?:\/Users\/|~\/)(?:[^\s，,。；;）)]|\\ )+/g, " ")
    .replace(/[（(][^）)]{14,}[）)]/g, " ")
    .replace(/[，,。；;]\s*(?:位置在|路径在|目录在|地址在|文件在|它位于|位于|顺着|有问题问我).*$/i, "")
    .replace(/^(?:你好|哈喽|嗨|请问|麻烦|请帮我|帮我|请你|我想让你|我想|我要|咱们|我们|现在|再|先|顺便|另外|还有)(?:先|再)?(?:把|给|对)?\s*/i, "")
    .replace(/^(?:继续)?(更新|修改|调整|优化|整理|检查|修复|排查|查看|看看|处理|实现|重构|分析)一下\s*/i, "$1")
    .replace(/这个\s*(?:obsidian\s*)?插件/gi, "插件")
    .replace(/(\d)[:：](\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/^[，,。；;：:、\s]+|[，,。；;：:、….\s]+$/g, "")
    .trim();

  const clauses = s.split(/[。！？；!?;]|，(?=.{6,})/).map((c) => c.trim()).filter(Boolean);
  if (clauses.length > 1 && [...clauses[0]].length >= 4) {
    s = clauses[0].replace(/^(?:关于|对于)\s*/, "").trim();
  }
  if (!s && pathBase) s = `整理 ${pathBase}`;
  if (!s) s = "整理会话";
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("").replace(/[，,。；;：:、\s]+$/, "").trim() : s;
}

export function prefixAutoTitle(title, project = "") {
  const body = String(title || "").trim();
  const proj = String(project || "").replace(/\s+/g, " ").trim();
  if (!body || !proj) return body;
  const esc = proj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = body.replace(new RegExp(`^${esc}\\s*->\\s*`), "").trim();
  return `${proj} -> ${stripped || body}`;
}

export function boldAutoTitle(title) {
  const s = String(title || "").trim();
  if (!s) return "";
  const m = /^\*\*([\s\S]+)\*\*$/.exec(s);
  if (m && !m[1].includes("**")) return s;
  return `**${s}**`;
}

export function formatProjectAutoTitle(raw, project = "", max = 22) {
  const proj = String(project || "").replace(/\s+/g, " ").trim();
  let s = stripBlockId(String(raw || ""))
    .replace(/^🤖\s*/, "")
    .replace(TIME_SPAN_PREFIX_RE, "")
    .replace(/^🤖\s*/, "")
    .replace(/^\*\*([\s\S]+)\*\*$/, "$1")
    .trim();
  if (proj) {
    const esc = proj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^${esc}\\s*->\\s*`), "").trim();
  }
  const body = summarizeAutoTitle(s, max);
  return proj ? prefixAutoTitle(body, proj) : body;
}

// 统一生成 AI 自动记录标题行：任务状态 + 🤖 + 会话时段 + 文字标题 (+ ^blockId)
export function formatAutoTaskLine({ prefix = "- ", kw = "DOING", start = "", end = "", span = "", title = "", blockId = "", summarize = false, preserveTitle = false, boldTitle = true, showTimeRange = true } = {}) {
  const existingId = blockId || blockIdOf(title);
  let cleanTitle = preserveTitle ? String(title || "") : stripBlockId(String(title || ""))
    .replace(/^🤖\s*/, "")
    .replace(TIME_SPAN_PREFIX_RE, "")
    .replace(/^🤖\s*/, "")
    .replace(TIME_SPAN_PREFIX_RE, "")
    .trim();
  if (!preserveTitle && (summarize || !cleanTitle)) cleanTitle = summarizeAutoTitle(cleanTitle || title);
  if (!preserveTitle && boldTitle && cleanTitle) cleanTitle = boldAutoTitle(cleanTitle);
  let timeRange = "";
  if (showTimeRange) {
    if (span) {
      const m = /^(\d{1,2})[:：](\d{2})(?:\s*[-–~～到至]\s*(\d{1,2})[:：](\d{2}))?$/.exec(span.trim());
      if (m) {
        const s = `${pad(+m[1])}:${m[2]}`;
        const e = m[3] ? `${pad(+m[3])}:${m[4]}` : s;
        timeRange = `${s}-${e}`;
      } else {
        timeRange = span.trim();
      }
    } else if (start || end) {
      const s = start || end;
      const e = end || start;
      timeRange = `${s}-${e}`;
    }
  }
  const raw = `${prefix}${kw ? kw + " " : ""}${AUTO_MARK}${timeRange ? timeRange + " " : ""}${cleanTitle}`;
  const head = (preserveTitle ? raw : raw.replace(/ {2,}/g, " ")).trimEnd();
  return existingId ? `${head} ^${existingId}` : head;
}

// 从任务块下面的 ⏱ 行提取「开始对话时间 - 最后一次对话时间」
export function clockSpanFromLines(lines, ownerLine) {
  if (!Array.isArray(lines) || ownerLine < 0 || ownerLine >= lines.length) return null;
  const base = width(lines[ownerLine] || "");
  for (let i = ownerLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    if (CLOCK_RE.test(lines[i]) && markOwner(lines, i) === ownerLine) {
      const matches = [...lines[i].matchAll(/(\d{1,2})[:：](\d{2})\s*[–—~～-]\s*(\d{1,2})[:：](\d{2})/g)];
      if (matches.length) {
        const first = matches[0];
        const last = matches[matches.length - 1];
        return {
          start: `${pad(+first[1])}:${first[2]}`,
          end: `${pad(+last[3])}:${last[4]}`,
        };
      }
    }
  }
  return null;
}

// The live endpoint belongs to the title only. Measured activity segments are never extended,
// and user DONE / archive timestamps are never treated as session end time.
export function sessionRecordSpan({ segs = [], meta = {}, saved = null, clockSpan = null, kw, now = Date.now(), idleMinutes = 10, startAt }) {
  const validSegs = Array.isArray(segs) && segs.length ? unionSegs(segs.filter((s) => Array.isArray(s) && s[1] >= s[0])) : [];
  const first = validSegs[0]?.[0], last = validSegs.at(-1)?.[1];
  const roundFirstAt = meta.rounds?.[0]?.at;
  const roundLastAt = meta.rounds?.reduce((latest, round) => Math.max(latest, round?.doneAt || round?.at || 0), 0);
  const firstAt = startAt ?? (first == null ? (roundFirstAt || meta.startedAt || meta.firstAt) : 0);
  const lastAt = last == null ? (roundLastAt || meta.lastAt) : 0;
  const lastEventMs = meta.lastAt || roundLastAt || 0;
  const observedEnd = last != null ? clock(last) : (lastAt ? fmtClock(lastAt) : "");
  const start = first != null ? clock(first) : (firstAt ? fmtClock(firstAt) : saved?.since || clockSpan?.start || observedEnd);
  const running = (kw === "DOING" || kw === "DELEGATED") && ["run", "running"].includes(meta.state)
    && lastEventMs > 0 && now >= lastEventMs && now - lastEventMs <= idleMinutes * 60000;
  const end = running ? fmtClock(now) : observedEnd || clockSpan?.end || saved?.until || start;
  return { start, end };
}

export function formatSessionTaskLine(task, { kw, start, end, showTimeRange }) {
  if (task.auto && !task.cb) {
    return formatAutoTaskLine({
      prefix: task.prefix, kw, start, end, title: task.title, preserveTitle: true,
      showTimeRange: showTimeRange === false ? false : (showTimeRange || Boolean(task.since || task.until)), blockId: task.blockId,
    });
  }
  if (showTimeRange) {
    const s = start || task.since || "";
    const e = end || task.until || "";
    const time = s ? (e && e !== s ? `${s}-${e} ` : `${s} `) : "";
    return `${task.prefix}${kw} ${time}${task.rest}`.trimEnd();
  }
  // 子块 ⏱ 模式：保留人工日注原本的预估/预约或间歇式时间戳，绝不覆盖母块。
  const kept = task.since ? (task.until ? `${task.since}-${task.until} ` : `${task.since} `) : "";
  return `${task.prefix}${kw} ${kept}${task.rest}`.trimEnd();
}

// 这一行是什么任务：{ prefix, rest, since, until, span, auto, title, kw, cb, blockId, body }；不是列表项返回 null
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
  let until = null;
  const rangeBeforeTitle = kw && /^(\d{1,2})[:：](\d{2})\s*[-–~～到至]\s*(\d{1,2})[:：](\d{2})\s+/.exec(rest);
  if (rangeBeforeTitle) {
    since = `${pad(+rangeBeforeTitle[1])}:${rangeBeforeTitle[2]}`;
    until = `${pad(+rangeBeforeTitle[3])}:${rangeBeforeTitle[4]}`;
    rest = rest.slice(rangeBeforeTitle[0].length);
  } else {
    const t = kw && /^(\d{1,2})[:：](\d{2})(?![\d:：]|\s*[-–~～到至])\s*/.exec(rest);
    if (t) { since = `${pad(+t[1])}:${t[2]}`; rest = rest.slice(t[0].length); }
  }
  const autoMatch = /^🤖\s*/.exec(rest);
  const auto = Boolean(autoMatch) && !(!kw && /^🤖\s*(?:子代理|side chat)/.test(rest));
  let title = "";
  if (auto) {
    let afterRobot = rest.slice(autoMatch[0].length);
    const tm = TIME_RANGE_PREFIX_RE.exec(afterRobot);
    if (tm) {
      since = `${pad(+tm[1])}:${tm[2]}`;
      until = `${pad(+tm[3])}:${tm[4]}`;
      afterRobot = afterRobot.slice(tm[0].length);
    } else if (since && !until) {
      until = since;
    }
    const bid = blockIdOf(afterRobot);
    title = stripBlockId(afterRobot).trim();
    rest = `${AUTO_MARK}${title}${bid ? ` ^${bid}` : ""}`;
  }
  if (pr) rest = `${pr[0].trim()} ${rest}`;
  const blockId = blockIdOf(rest);
  const body = stripBlockId(rest);
  if (!auto) title = body;
  const span = since ? `${since}-${until || since}` : null;
  return { prefix, rest, body, title, auto, blockId, since, until, span, kw: kw ? kw[1].toUpperCase() : null, cb: cb ? cb[1] : null };
}

// ⌘⇧D：把一行任务改成做完的样子。缩进、短横 -、复选框和时间戳都留着，
// 只换状态；checkbox 任务改成 [x]，其它任务换成 DONE。已经做完的返回 null。
export function flipToDone(raw) {
  const part = splitTask(raw);
  if (!part) return null;
  const kw = kwLine(raw)?.kw || '';
  if (DONE_KWS.includes(kw)) return null;
  if (part.auto && !part.cb) {
    return formatAutoTaskLine({
      prefix: part.prefix,
      kw: 'DONE',
      start: part.since || '',
      end: part.until || part.since || '',
      title: part.title, preserveTitle: true,
      blockId: part.blockId,
    });
  }
  const box = part.cb ? (part.cb === ' ' || part.cb === '/' ? '[x]' : `[${part.cb}]`) : '';
  const since = part.since ? `${part.until ? part.span : part.since} ` : '';
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
  if (m) { kw = m[1].toUpperCase(); s = s.slice(m[0].length); }
  const blockId = blockIdOf(s);
  s = stripBlockId(s)
    .replace(/^\[#[ABC]\]\s*/, "")
    .replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, "")
    .replace(/^\[#[ABC]\]\s*/, "")
    .replace(/^🤖\s*\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, "🤖 ")
    .trim();
  if (!s || s.startsWith("⏱") || s.startsWith("🔗") || ((!kw && !blockId) && /^(?:💬|❓|📋|(?:第\d+轮|Round\s+\d+)[：:])/.test(s)) || (!kw && /^🤖\s*(?:子代理|side chat)/.test(s))) return null;
  return { kw, body: s, blockId };
}

const TRACKED_LINK_RE = /^\s*[-*+]\s+🔗\s*\[([^\]]*)\]\(obsidian:\/\/agent-deck\?do=open&agent=([a-z][a-z0-9_-]{1,31})&sid=([^)]*)\)/;
const TRACKED_LABEL_PREFIX_RE = /^(Antigravity|OpenCode|Qoder|Hermes|MiniMax Code|MiniMax|千问办公|QwenWork|TeleAgent|WorkBuddy|Cursor|Trae|Grok Bot|T3 Code|Cindy|Orca|Muse|Kimi Code|豆包工作|Gemini CLI)：/;
const SESSION_LINK_RE = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(claude|codex|workbuddy|dsh|antigravity):\/\/[^)]*?session=([0-9a-f-]{36})/;
const THREAD_LINK_RE = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(codex):\/\/threads\/([0-9a-f-]{36})|^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(workbuddy):\/\/chat\/([0-9A-Za-z_-]{8,})/;
const BACKTICK_LINK_RE = /^\s*[-*+]\s+🔗.*`((?:session-)?[0-9a-f-]{36})`/;
const OBSIDIAN_LINK_LABELS = { opencode: "OpenCode", qoder: "Qoder", hermes: "Hermes", minimax: "MiniMax", qwenwork: "千问办公", teleagent: "TeleAgent", cursor: "Cursor", trae: "Trae", grokbot: "Grok Bot", t3code: "T3 Code", cindy: "Cindy", orca: "Orca", muse: "Muse", kimicode: "Kimi Code", doubaowork: "豆包工作", gemini: "Gemini CLI" };
const safeDecodeUri = (raw) => { try { return decodeURIComponent(raw); } catch { return raw; } };

export function parseLink(line) {
  if (!line || !line.includes("🔗")) return null;
  const tracked = TRACKED_LINK_RE.exec(line);
  if (tracked) {
    const agent = tracked[2];
    let title = tracked[1].replace(TRACKED_LABEL_PREFIX_RE, "");
    const customName = AGENTS[agent]?.customAcp ? AGENTS[agent]?.name : "";
    if (customName && title.startsWith(`${customName}：`)) title = title.slice(customName.length + 1);
    return { agent, sid: safeDecodeUri(tracked[3]), title };
  }
  const m = SESSION_LINK_RE.exec(line);
  if (m) return { agent: m[2], sid: m[3], title: m[1] || "" };
  const d = THREAD_LINK_RE.exec(line);
  if (d) return d[2] ? { agent: "codex", sid: d[3], title: d[1] || "" } : { agent: "workbuddy", sid: safeDecodeUri(d[6]), title: d[4] || "" };
  const b = BACKTICK_LINK_RE.exec(line);
  if (!b) return null;
  const agent = /DeepSeek Harness|dsh:\/\//.test(line) ? "dsh" : /Antigravity|antigravity:\/\//i.test(line) ? "antigravity" : /Codex[：:]/.test(line) ? "codex" : /WorkBuddy[：:]/.test(line) ? "workbuddy" : "claude";
  return { agent, sid: b[1], title: "" };
}

export const deckSessionUrl = (agent, sid) => `obsidian://agent-deck?do=open&agent=${encodeURIComponent(agent)}&sid=${encodeURIComponent(sid)}`;

export function linkLine(indent, agent, title, sid) {
  const safe = String(title || "").replace(/[\[\]()`]+/g, " ").trim();
  if (OBSIDIAN_LINK_LABELS[agent]) {
    return `${indent}- 🔗 [${OBSIDIAN_LINK_LABELS[agent]}：${safe}](${deckSessionUrl(agent, sid)})`;
  }
  if (AGENTS[agent]?.customAcp) {
    return `${indent}- 🔗 [${AGENTS[agent].name}：${safe}](${deckSessionUrl(agent, sid)})`;
  }
  if (agent === "claude") return `${indent}- 🔗 [Claude：${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- 🔗 [DeepSeek Harness：${safe}](dsh://open) \`${sid}\``;
  if (agent === "antigravity") return `${indent}- 🔗 [Antigravity：${safe}](antigravity://open) \`${sid}\``;
  if (agent === "codex") return `${indent}- 🔗 [Codex：${safe}](codex://threads/${sid})`;
  if (agent === "workbuddy") return `${indent}- 🔗 [WorkBuddy：${safe}](workbuddy://chat/${encodeURIComponent(sid)})`;
  return `${indent}- 🔗 ${agent}：${safe} \`${sid}\``;
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

// 摘要截短时保留完整链接目标。
export function summaryText(raw, max = 200) {
  return formatSummaryLinks(raw, text => resultText(text, max));
}

// 去掉回复里的代码块、表格、标题与列表符号，只留下能当摘要的正文。
const cleanReply = (source) => String(source || "")
  .replace(/```[\s\S]*?(?:```|$)/g, " ")
  .replace(/^\s*\|.*\|\s*$/gm, " ")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
  .replace(/^\s*>\s?/gm, "")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\d{12,}/g, "…")
  .trim();

// 取一段文字的第一句完整的话（至少 6 个字之后的句号/叹号/问号/分号）
const firstSentence = (pick, max) => {
  const sentMatch = /^(.{6,}?[。！？；!?;])(?:\s|$)/.exec(pick);
  return resultText(sentMatch ? sentMatch[1] : pick, max);
};

// 提取一轮回复的一句话结论：优先取明确总结句或首句。
export function oneSentenceConclusion(raw, max = 90) {
  return formatSummaryLinks(raw, source => {
    const cleaned = cleanReply(source);
    if (!cleaned) return "";
    const lines = cleaned.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    let pick = lines.find((l) => /^(?:结论|总结|核心结论|一句话总结|已完成|已修复|已更新|已实现|原因|问题在于|搞定|改好)[：:，,\s]/.test(l))
      || lines.find((l) => l.length >= 6 && !/^(?:好的|收到|明白|没问题|我来|让我|先看)[，。！!,.]*$/.test(l))
      || lines[lines.length - 1]
      || cleaned;
    return firstSentence(pick, max);
  });
}

// 显式写出来的结论段；「综上」「最终」这类过渡词保留，`结论：` 这类字段名去掉（调用方自己会带字段名）。
const CONCLUSION_LABEL_RE = /^(?:结论|总结|核心结论|一句话总结|结果)[：:]\s*/;
const CONCLUSION_MARK_RE = /^(?:结论|总结|核心结论|一句话总结|综上|总之|最终|结果|复盘)[：:，,\s]/;
// 知识问答里「把判断说出来」的段落，比结尾那句更像结论。
const CLAIM_MARK_RE = /^(?:先说结论|先说答案|简单说|说白了|直说|推荐|建议|结论|答案|总结|小结|一句话|核心|关键在于|本质上|归根结底|所以|因此|总的来说|我认为|我的判断|答案是)/;
// 收尾客套和下一步计划不是「这一轮做成了什么」，不能当结论。
const NEXT_STEP_RE = /^(?:要不要|要的话|需要我|需不需要|我可以|我可以帮你|下一步|接下来|之后|如果(?:你)?(?:想|需要|要|希望|愿意)|随时|有需要|先这样|你看|你只需|说一声|告诉我|回我)/;
// 顺口补充、题外话：话题相关但不是这一轮的结论。
const TANGENT_RE = /^(?:顺带|顺带一句|另外|补充|补充一句|说到|题外话|btw|注[：:]|提醒|附[：:])/i;
// 未验证 / 风险 / 限制这类段落是提醒，不是结论。
const CAVEAT_RE = /^(?:没有验证|没验证|尚未验证|未验证|没有测|没测|尚未测|未测|风险|注意|限制|前提|可选|备选|待办|todo)/i;
// 一句话少于这么多个字，多半是「尚未发布」「待验证」这种残句，单独当结论没有信息量。
const TAIL_MIN_CHARS = 4;

// Markdown 标题去掉 `#` 之后只剩一行短语，不是结论。
const isHeading = (s) => /^(?:[一二三四五六七八九十]+[、.]|[（(]?[一二三四五六七八九十0-9]+[）)]|第[一二三四五六七八九十]+[、章节部分])/.test(s)
  || ([...s].length <= 10 && !/[。！？，,；;]/.test(s));

const isNoise = (text) => {
  const s = String(text || "").trim();
  if (!s) return true;
  if (/[？?]$/.test(s)) return true;
  if (NEXT_STEP_RE.test(s) || TANGENT_RE.test(s) || CAVEAT_RE.test(s)) return true;
  if (isHeading(s)) return true;
  return /^(?:好的|收到|明白|没问题|我来|让我|先看|稍等)[，。！!,.]*$/.test(s);
};

const usableTail = (sentence) => {
  const s = String(sentence || "").trim();
  if ([...s].length < TAIL_MIN_CHARS) return false;
  return !isNoise(s);
};

// 这一轮是「知识问答」还是「改东西」。
// 先看用户是在派活还是在提问（指令 > 提问 > 回复特征），拿不准按 coding（短记录）。
const DIRECTIVE_RE = /(?:^|[，。；:：])\s*(?:请|帮我|麻烦|你|先|能|可以|可否)?\s*[^，。；:：]{0,10}?(?:发|改|修|加|删|做|写|跑|装|实现|部署|查|检查|优化|补|拉|提交|生成|换成)/;
const ASK_QUESTION_RE = /[？?]\s*$|吗\s*$|(?:为什么|为何|是什么|什么是|怎么|如何|区别|原理|本质|机制|是否|有没有|能不能|可不可以)/;
// 回复里只有这些才是「真的动手」的证据；中文动词（改完、修好）在问答里也常见，不能当证据。
const CODE_EVIDENCE_RE = /```|(?:^|\s)(?:npm|pnpm|yarn|git|node|obsidian)\s|\bsrc\/|\.(?:js|mjs|ts|tsx|json|css)\b|\/Users\/|~\/|(?:测试通过|构建通过|已提交)/;

export function conclusionKind(ask = "", said = "") {
  const question = String(ask || "").trim();
  const reply = String(said || "");
  if (!question) return "code";
  if (DIRECTIVE_RE.test(question)) return "code";
  if (ASK_QUESTION_RE.test(question)) return "qa";
  if (CODE_EVIDENCE_RE.test(reply)) return "code";
  return "code";
}

// 把一处回复按句切分，保留标点贴在句尾。
const sentences = (text) => String(text || "").split(/(?<=[。！？；!?;])/).map((s) => s.trim()).filter(Boolean);

// 结论取「最后的落点」而不是开头：显式结论段 → 短回复原样 → 从结尾往前找第一句不像收尾客套的话。
export function conclusionSentence(raw, max = 90) {
  return formatSummaryLinks(raw, source => {
    const cleaned = cleanReply(source);
    if (!cleaned) return "";
    const lines = cleaned.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const flat = lines.join(" ").trim();
    const marked = lines.find((l) => CONCLUSION_MARK_RE.test(l));
    if (marked) return firstSentence(marked.replace(CONCLUSION_LABEL_RE, ""), max);
    // 只有一个自然段、而且整段放得进这条记录：开头就是全部内容，没必要再切。
    if (lines.length <= 1 && [...flat].length <= max) return resultText(flat, max);
    // 只看最后几段，避免一路往上游走到开头那段铺垫；整段是提醒 / 客套就跳过它。
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      if (isNoise(lines[i])) continue;
      const tail = sentences(lines[i]).reverse().find(usableTail);
      if (tail) return resultText(tail, max);
    }
    // 全程都在说客套和下一步：退回最后一段，至少是这一轮最新的状态。
    return firstSentence(lines[lines.length - 1], max);
  });
}

// 知识问答的结论可以长一点：取最后一段说得清楚的判断；段落太短就把上一段带上。
export function answerConclusion(raw, max = 160) {
  return formatSummaryLinks(raw, source => {
    const cleaned = cleanReply(source);
    if (!cleaned) return "";
    const paras = cleaned.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!paras.length) return "";
    if (paras.length === 1) return resultText(paras[0], max);
    // 「推荐」「所以」「答案是」这段才是判断本身，比结尾那句更值得记。
    const marked = [...paras].reverse().find((p) => CLAIM_MARK_RE.test(p) && [...p].length >= 20);
    let pick = marked || "";
    if (!pick) {
      for (let i = paras.length - 1; i >= Math.max(0, paras.length - 5); i--) {
        if (isNoise(paras[i])) continue;
        pick = paras[i];
        break;
      }
    }
    if (!pick) pick = paras[paras.length - 1];
    // 段内的题外话、追问、客套整句去掉，别让「顺带一句…」混进结论。
    const kept = sentences(pick).filter((x) => !isNoise(x));
    if (kept.length) pick = kept.join(" ");
    // 只有「顺出来的一小截」才补上一段；显式判断句本身就是结论，不用再拼。
    if (!marked && [...pick].length < 60) {
      for (let i = paras.indexOf(pick) - 1; i >= 0 && i >= paras.length - 6; i--) {
        if (isNoise(paras[i]) || [...paras[i]].length < 15) continue;
        pick = `${paras[i]} ${pick}`.trim();
        if ([...pick].length >= 60) break;
      }
    }
    return resultText(pick, max);
  });
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

// 标准记录只要一句话：取收尾那句，避免把整段塞进一行。
const tailSentence = (raw, max) => {
  const parts = sentences(raw);
  return resultText(parts[parts.length - 1] || String(raw || ""), max);
};

// Journal detail uses one sentence even when Chinese punctuation has no following space.
const recordSentence = (raw, max) => {
  return formatSummaryLinks(raw, masked => {
    const text = oneSentenceConclusion(masked, max);
    return text.match(/^.*?[。！？；!?;]/)?.[0] || text;
  });
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

export function syncSessionEntry(text, { sid = "", agent = "", blockId = "", key = "", said = "", rounds = [], todos = [], taskTodo = null, ensureId = true, detail = "brief", detailHistory = [], granularity = "", compact = null, codeMax = 65, qaMax = 160 } = {}) {
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
  // A cleaned completed record is final. Re-scans cannot reconstruct per-session
  // ownership after provenance is removed, so keep its saved results intact.
  if (isDoneLine(lines[n]) && !activeBlockId && resultUnder(lines, n)) {
    return { text: cleanCompletedIdentifiers(text), line: n, blockId: "" };
  }
  if (ensureId || blockId) {
    const eb = ensureBlockId(lines[n], activeBlockId || blockId || makeBlockId(sid, agent || (linkAt >= 0 && parseLink(lines[linkAt])?.agent)));
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
  const sourceRounds = new Map((Array.isArray(rounds) ? rounds : []).filter(Boolean).map((round, i) => [round.n || i + 1, round]));
  const sourceTurn = raw => /<!-- ad-turn:([A-Za-z0-9_-]+):(\d+) -->/.exec(raw);
  const legacyOwner = lines.slice(n + 1, childSpan() + 1).map(parseLink).find(Boolean)?.sid || sid;
  const belongs = raw => { const marker = sourceTurn(raw); return marker ? marker[1] === sid || marker[1] === shortSessionId(sid) : legacyOwner === sid; };
  const provenance = rn => sid ? ` ${turnMarker(sid, rn)}` : "";
  const recordedEnd = childSpan();
  for (let i = n + 1; i <= recordedEnd; i++) {
    if (fenced.has(i) || width(lines[i]) !== childWidth || !belongs(lines[i])) continue;
    const marker = sourceTurn(lines[i]);
    // Repair only the known generated task field, keeping the saved conclusion
    // and any user-owned record or subtree untouched.
    if (marker && RESULT_RE.test(lines[i]) && !blockIdOf(lines[i]) && !hasDescendants(lines, i)) {
      const brokenTask = /(\*\*任务\*\*|任务)：\\?<send_user_message_question_reply>[^；]*(?=；(?:\*\*结论\*\*|结论)：)/;
      if (brokenTask.test(lines[i])) {
        const round = sourceRounds.get(+marker[2]);
        const task = condenseUserPrompt(round?.taskSummary || round?.ask);
        if (task) lines[i] = lines[i].replace(brokenTask, (_, label) => `${label}：${summaryText(task, 45)}`);
      }
    }
    const match = /^\s*[-*+]\s+(?:(?:💬\s+)?(?:第(\d+)轮|Round\s+(\d+))[：:]|💬\s+((?!累计总结[：:]).))/.exec(lines[i]);
    if (marker || match) recorded.add(marker ? +marker[2] : (match[1] || match[2]) ? +(match[1] || match[2]) : 1);
  }
  let validRounds = (Array.isArray(rounds) ? rounds : []).filter(r => r && (r.said || r.summary || r.aborted || r.quota));
  if (!validRounds.length && said && !recorded.size) validRounds = [{ n: 1, said }];
  if (!roundLog) validRounds = validRounds.slice(-1);
  const fresh = validRounds.filter((r, index) => !recorded.has(r.n || index + 1));
  // Latest progress limits new additions; saved records always remain untouched.
  const append = line => {
    let at = childSpan() + 1;
    for (let i = n + 1; i < at; i++) if (width(lines[i]) === childWidth && CLOCK_RE.test(lines[i])) { at = i; break; }
    lines.splice(at, 0, ...line.split("\n"));
  };
  if (compact?.text) {
    const summary = `${ind}- 💬 累计总结：${summaryText(compact.text, 170)}`;
    const marker = sid ? ` ${sessionMarker("summary", sid, compact.through || 0)}` : "";
    const legacyMarker = ` <!-- ad-summary:${sid}:${compact.through || 0} -->`;
    const saved = lines.slice(n + 1, childSpan() + 1).some(raw => width(raw) === childWidth &&
      (raw === summary || (marker && (raw.includes(marker) || raw.includes(legacyMarker)))));
    if (!saved) append(summary + marker);
  }
  for (const [index, r] of fresh.entries()) {
    const rn = r.n || index + 1;
    const level = detailForRound(mode, detailHistory, r);
    const userAsk = condenseUserPrompt(r.ask);
    if (level !== "brief" && userAsk) {
      const ask = level === "detailed" ? detailExcerpt(userAsk, 1000) : recordSentence(userAsk, 90);
      append(`${ind}- ❓ 第${rn}轮：${ask}${provenance(rn)}`);
    }
    const raw = level === "detailed" ? (r.said || r.summary) : (r.summary || r.said);
    const task = condenseUserPrompt(r.taskSummary || r.ask) || kwLine(lines[n])?.body?.replace(/^🤖\s*/, "") || key;
    // 模型判过就听模型的；本地只在润色没跑成时兜底，判不清按 coding（短）。
    const kind = r.kind === "qa" || r.kind === "code" ? r.kind : conclusionKind(r.ask, r.said);
    const conclusion = kind === "qa" ? answerConclusion(r.said, qaMax) : conclusionSentence(r.said, codeMax);
    // 整轮被中断 / 额度断掉：没有正文也要在日记里留一句为什么。
    const missing = !String(r.said || "").trim() && !String(r.summary || "").trim();
    const fallbackLine = missing ? (r.quota ? "额度不足，本轮未完成。" : r.aborted ? "本轮被中断，没有结论。" : "") : "";
    const stdCap = kind === "qa" ? 120 : 90;
    // 模型偶尔把 kind 当结论写回来（"qa" 这种），当它没给，用本地规则。
    const givenSummary = String(r.summary || "").trim();
    const polished = [...givenSummary].length >= 4 && !/^(?:code|qa|json)$/i.test(givenSummary);
    const message = fallbackLine
      ? (level === "brief" ? `**任务**：${summaryText(task, 45)}；**结论**：${fallbackLine}` : fallbackLine)
      : r.replyText !== undefined ? r.replyText : r.journalSummary ? summaryText(r.journalSummary, [...r.journalSummary].length) : level === "detailed" ? detailExcerpt(raw, 3000) : level === "brief"
      ? `**任务**：${summaryText(task, 45)}；**结论**：${polished ? summaryText(givenSummary, kind === "qa" ? qaMax : codeMax) : conclusion}`
      : polished ? recordSentence(givenSummary, stdCap) : tailSentence(kind === "qa" ? answerConclusion(r.said, stdCap) : conclusionSentence(r.said, stdCap), stdCap);
    // Always include the round prefix (including round 1) so the circle-number badge renders cleanly without 💬.
    const prefix = `第${rn}轮：`;
    if (r.replyText !== undefined) {
      const [first, ...rest] = message.split("\n");
      append([`${ind}- ${prefix}${first}${provenance(rn)}`, ...rest.map(line => `${ind}  ${line}`)].join("\n"));
    } else append(`${ind}- ${prefix}${message}${provenance(rn)}`);
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
  return { text: cleanCompletedIdentifiers(lines.join("\n")), line: n, blockId: activeBlockId };
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
// The outermost task block that contains `at`, or -1. Used by the
// "mark DONE and archive" command so the cursor can sit anywhere in a block.
export function taskLineAt(lines, at) {
  if (at < 0 || at >= lines.length || !lines[at].trim()) return -1;
  const fenced = fencedLines(lines);
  if (fenced.has(at)) return -1;   // a code sample is not a task
  for (let i = 0; i <= at; i++) {
    if (fenced.has(i) || !LIST_RE.test(lines[i]) || !kwLine(lines[i])) continue;
    if (at < subtreeEnd(lines, i)) return i;
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
    out.push({ line: i, kw: k.kw, body: k.body, key: workKey(k.body), auto: k.body.startsWith(AUTO_MARK.trim()), blockId: k.blockId || "", indent: width(lines[i]), state: st });
  }
  return out;
}

export function findTaskByBlockId(text, blockId) {
  if (!blockId) return null;
  return taskItems(text).find((i) => i.blockId === blockId) || null;
}

// 这一块是不是这个会话的：🔗 链接，或者子行里留下的 ad-turn / ad-summary 注释（DSH 没有深链）。
const ownedBySession = (lines, sid) => {
  if (!sid) return -1;
  const short = shortSessionId(sid);
  for (let i = 0; i < lines.length; i++) {
    const link = parseLink(lines[i]);
    if (link && (link.sid === sid || link.sid === short)) return markOwner(lines, i);
    const marker = /<!-- ad-(?:turn|summary):([A-Za-z0-9_-]+):\d+ -->/.exec(lines[i]);
    if (marker && (marker[1] === sid || marker[1] === short)) return markOwner(lines, i);
  }
  return -1;
};

// 只按会话认领，不猜标题：已经建过这一项的会话（哪怕标题被改、块号被清）也认得回来。
export function findSessionTask(text, sid = "") {
  if (!sid) return null;
  const owner = ownedBySession(text.split("\n"), sid);
  return owner >= 0 ? taskItems(text).find((i) => i.line === owner) || null : null;
}

// 这一行现在是什么状态（优先按 ^blockId，其次按 🔗 sid / 轮次标记，最后按 key）；找不到返回 null
export function findTask(text, key, blockId = "", sid = "") {
  const items = taskItems(text);
  if (sid && (text.includes(sid) || text.includes("<!-- ad-"))) {
    const owner = ownedBySession(text.split("\n"), sid);
    const hit = owner >= 0 ? items.find((i) => i.line === owner) : null;
    if (hit) return hit;
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
const KID_NORM_RE = new RegExp(`^\\s*(?:\\d+[.)、]\\s*)?(?:(?:${TASK_KWS_RE_SRC})\\s+)?(?:\\d{1,2}[:：]\\d{2}(?:\\s*[-–~～到至]\\s*\\d{1,2}[:：]\\d{2})?\\s*)?`);
export const kidNorm = (s) => String(s || "").replace(/🤖/g, "").replace(KID_NORM_RE, "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
export function kidMatch(body, desc) {
  const a = kidNorm(body), d = kidNorm(desc);
  if (a.length < 4 || d.length < 4) return false;
  return a.startsWith(d) || d.startsWith(a) || (a.length >= 8 && d.length >= 8 && a.slice(0, 8) === d.slice(0, 8));
}

// ---------- 拖拽绑定：面板里的会话卡片拖到笔记某一行上 ----------

const EMPTY_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s*$/;
const MARKER_RE = /^\s*[-*+]\s+(?:🔗|⏱|💬|❓|📋|(?:第\d+轮|Round\s+\d+)[：:])/;

// 会话停下来的几种状态 → 任务行上的关键词；回写（sync.js）只认这几种，idle 不写
export const STATE_KW = { wait: "TOREVIEW", quiet: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" };
// 会话现在的状态 → 任务行上的关键词（和回写那一半同一套）
export function kwForState(state) {
  return ({ run: "DOING", running: "DOING", starting: "DOING", idle: "TOREVIEW", ...STATE_KW })[state] || "DOING";
}

// 拖到第 at 行会发生什么：
//   child 这一行是有字的列表项 → 默认挂成它的子块（不改动母块原文）
//   bind  按住 ⌥ 拖到列表项上 → 直接把会话绑到这一项自身
//   fill  空的列表项（「- 」「1. 」）→ 就在这一项写上会话
//   new   空行 → 在这儿新建一项
//   below 不是列表的一段文字 → 在它下面新建一项
export function dropKind(lines, at, below = false, direct = false) {
  if (at < 0 || at >= lines.length) return null;
  const raw = lines[at];
  const itemKind = direct ? "bind" : "child";
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
    return n >= 0 ? { kind: itemKind, line: n } : null;
  }
  if (EMPTY_ITEM_RE.test(raw)) return { kind: "fill", line: at };
  if (!raw.trim()) return { kind: "new", line: at };
  if (LIST_RE.test(raw)) return kwLine(raw) ? { kind: itemKind, line: at } : null;
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

function blockSpan(lines, start) {
  const base = width(lines[start]);
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    end = i;
  }
  return [start, end];
}

// 把会话 s 绑到第 at 行（默认挂为它的子块，不改动母块原文；按住 ⌥ 则直接绑到这一项自身）。
// s = { sid, agent, title, state, since, until, dropKey, blockId, ensureBlockId, segs, tok }
// 返回 { text, line, kind, blockId, parentLine? } 或 { text, error }
export function bindInto(text, at, s, { below = false, direct = false, ensureBlockId: ensureIdOpt = false, rules = null } = {}) {
  let lines = text.split("\n");
  const target = dropKind(lines, at, below, direct);
  if (!target) return { text, error: t("这一行放不了会话：拖到列表项、空的列表项或空行上") };
  let n = target.line;
  if (target.kind === "child") {
    const [n0, n1] = blockSpan(lines, n);
    const short = shortSessionId(s.sid);
    for (let i = n0; i <= n1; i++) {
      const lk = parseLink(lines[i]);
      if (lk && lk.sid === s.sid) return { text, error: t("这一项已经绑着这个会话了") };
      const mk = /<!-- ad-(?:turn|summary(?:-pending)?):([A-Za-z0-9_-]+):\d+ -->/.exec(lines[i]);
      if (mk && (mk[1] === s.sid || mk[1] === short)) return { text, error: t("这一项已经绑着这个会话了") };
    }
  } else if (target.kind === "bind") {
    const had = linkUnder(lines, n);
    if (had && had.sid === s.sid) return { text, error: t("这一项已经绑着这个会话了") };
    if (had) return { text, error: t("这一项已经绑着另一个会话；先删掉它下面的 🔗 行") };
  }
  const r = resolveRecordRules(rules ? { recordRules: rules } : {});
  const want = kwForState(s.state);
  const since = s.since || "";
  const until = s.until || since;
  const title = resultText(s.title || "没起名的会话", 60);
  const autoTitle = summarizeAutoTitle(s.title || "没起名的会话", r.titleMax);
  const who = AGENTS[s.agent]?.short || s.agent;
  const rescuedChildren = [];
  let rescuedBlockId = s.blockId || "";
  let migratedHeader = "";
  let migratedBody = null;

  // 先查找同一会话已有的 🤖 自动记录块（必须在删除 🔗 之前，否则 ownedBySession 找不到仅靠 🔗 关联的项）
  const anchor = lines[n];
  const drop = (i) => { lines.splice(i, 1); if (i < n) n--; };
  const itemsBefore = taskItems(lines.join("\n"));
  const ownedLine = ownedBySession(lines, s.sid);
  const autoHit = (ownedLine >= 0 && itemsBefore.find((it) => it.line === ownedLine && it.body.startsWith(AUTO_MARK.trim())))
    || itemsBefore.find((it) => it.line !== n && it.body.startsWith(AUTO_MARK.trim())
      && ((s.blockId && it.blockId === s.blockId) || (s.dropKey && it.key === workKey(s.dropKey))));

  if (target.kind === "child" && autoHit && autoHit.line !== n && !(autoHit.line < n && n < subtreeEnd(lines, autoHit.line))) {
    const [h0, h1] = blockSpan(lines, autoHit.line);
    migratedHeader = lines[h0];
    migratedBody = lines.slice(h0 + 1, h1 + 1).filter((l) => l.trim());
    if (autoHit.blockId && !rescuedBlockId) rescuedBlockId = autoHit.blockId;
    for (let i = h1; i >= h0; i--) drop(i);
  }

  // 把这个会话在别处残留的 🔗 摘掉，并按原逻辑收掉单纯的自动记录项
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = parseLink(lines[i]);
    if (k && k.sid === s.sid) drop(i);
  }
  if (!migratedBody && (s.dropKey || s.blockId)) {
    const items = taskItems(lines.join("\n"));
    const hit = items.find((item) => item.line !== n && item.body.startsWith(AUTO_MARK.trim()) && ((s.blockId && item.blockId === s.blockId) || (s.dropKey && item.key === workKey(s.dropKey))));
    if (hit) {
      const base = width(lines[hit.line]);
      let end = hit.line, own = true;
      for (let i = hit.line + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        if (!MARKER_RE.test(lines[i]) && !/^\s*[-*+]\s+(?:TODO|todo)\s+🤖/.test(lines[i])) own = false;
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
    if (s.ensureBlockId || ensureIdOpt || rescuedBlockId) {
      return ensureBlockId(lineStr, rescuedBlockId || makeBlockId(s.sid, s.agent));
    }
    return { line: lineStr, blockId: "" };
  };

  if (target.kind === "child") {
    const ind = childIndent(lines, n);
    const unit = ind.includes("\t") ? "\t" : " ".repeat(Math.max(2, width(ind) - width(lines[n])));
    const grandInd = ind + unit;
    const [, nEnd] = blockSpan(lines, n);
    const insertAt = nEnd + 1;
    if (migratedBody !== null) {
      const hp = splitTask(migratedHeader);
      const keptBlockId = (hp && hp.blockId) || rescuedBlockId;
      const lockedKw = hp?.kw && (DONE_KWS.includes(hp.kw) || hp.kw === "PAUSED" || hp.kw === "SUSPENDED" || hp.kw === "WAITING" || hp.kw === "WAIT");
      const keptKw = lockedKw ? hp.kw : want;
      const rawTitle = hp?.title || "";
      const unbold = rawTitle ? rawTitle.replace(/^\*\*([^*]+)\*\*$/, "$1") : autoTitle;
      const eb = maybeAddBlockId(formatAutoTaskLine({
        prefix: `${ind}- `,
        kw: keptKw,
        start: hp?.since || since,
        end: hp?.until || until || hp?.since || since,
        title: unbold,
        preserveTitle: Boolean(rawTitle),
        boldTitle: false,
        showTimeRange: r.showTimeRange,
        blockId: keptBlockId,
      }));
      const srcBase = width(migratedHeader);
      const firstChild = migratedBody[0];
      const srcStep = firstChild && width(firstChild) > srcBase ? Math.max(1, width(firstChild) - srcBase) : 4;
      const rebasedBody = migratedBody.map((line) => {
        const w = width(line);
        const extra = firstChild && w > width(firstChild) ? Math.max(1, Math.round((w - width(firstChild)) / srcStep)) : 0;
        return `${grandInd}${unit.repeat(extra)}${line.trim()}`;
      });
      if (!rebasedBody.some((l) => parseLink(l)?.sid === s.sid)) {
        rebasedBody.unshift(linkLine(grandInd, s.agent, title, s.sid));
      }
      if (!r.showTimeRange && s.segs?.length && !rebasedBody.some((l) => CLOCK_RE.test(l))) {
        rebasedBody.push(clockLine(grandInd, s.segs, who, s.tok || 0, true));
      }
      lines.splice(insertAt, 0, eb.line, ...rebasedBody);
      return { text: lines.join("\n"), line: insertAt, parentLine: n, kind: "child", blockId: eb.blockId };
    }
    const eb = maybeAddBlockId(formatAutoTaskLine({
      prefix: `${ind}- `,
      kw: want,
      start: since,
      end: until,
      title: autoTitle,
      boldTitle: false,
      showTimeRange: r.showTimeRange,
    }));
    const children = [linkLine(grandInd, s.agent, title, s.sid)];
    if (!r.showTimeRange && s.segs?.length) {
      children.push(clockLine(grandInd, s.segs, who, s.tok || 0, true));
    }
    lines.splice(insertAt, 0, eb.line, ...children);
    return { text: lines.join("\n"), line: insertAt, parentLine: n, kind: "child", blockId: eb.blockId };
  }

  if (target.kind === "bind") {
    const p = splitTask(lines[n]);
    if (p && !p.cb && (!p.kw || OPEN_KWS.includes(p.kw) || p.kw === "DOING" || AGENT_KW_RE.test(p.kw))) {
      lines[n] = formatSessionTaskLine(p, { kw: want, start: p.since || since, end: p.until || until || p.since || since, showTimeRange: r.showTimeRange });
    }
    const eb = maybeAddBlockId(lines[n]);
    lines[n] = eb.line;
    const ind = childIndent(lines, n);
    const toInsert = [linkLine(ind, s.agent, title, s.sid)];
    const existingChildText = lines.slice(n + 1, n + 15).join("\n");
    for (const rc of rescuedChildren) {
      if (!existingChildText.includes(rc)) toInsert.push(`${ind}${rc}`);
    }
    if (!r.showTimeRange && s.segs?.length) {
      const [, spanEnd] = blockSpan(lines, n);
      const hasOwnClock = lines.slice(n + 1, spanEnd + 1).some((l) => isAgentClockLine(l, who));
      if (!hasOwnClock) toInsert.push(clockLine(ind, s.segs, who, s.tok || 0, true));
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
    const eb = maybeAddBlockId(formatAutoTaskLine({ prefix, kw: want, start: since, end: until, title: autoTitle, boldTitle: r.boldTitle, showTimeRange: r.showTimeRange }));
    const item = eb.line;
    const lead = (/^\s*/.exec(item) || [""])[0];
    const ind = lead + (lead && !lead.includes("\t") ? "    " : "\t");
    const extraClock = !r.showTimeRange && s.segs?.length ? [clockLine(ind, s.segs, who, s.tok || 0, true)] : [];
    lines.splice(end + 1, 0, item, linkLine(ind, s.agent, title, s.sid), ...rescuedChildren.map((rc) => `${ind}${rc}`), ...extraClock);
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
  const eb = maybeAddBlockId(formatAutoTaskLine({ prefix, kw: want, start: since, end: until, title: autoTitle, boldTitle: r.boldTitle, showTimeRange: r.showTimeRange }));
  const item = eb.line;
  if (target.kind === "below") { lines.splice(n + 1, 0, item); n = n + 1; }
  else if (target.kind === "new" && lines[n + 1] && lines[n + 1].trim() && !LIST_RE.test(lines[n + 1])) lines.splice(n, 0, item);   // 空行下面紧接一段文字：空行留着，不然那段会变成这一项的续行
  else lines[n] = item;
  const lead = (/^\s*/.exec(item) || [""])[0];
  const ind = lead + (lead && !lead.includes("\t") ? "    " : "\t");
  const extraClock = !r.showTimeRange && s.segs?.length ? [clockLine(ind, s.segs, who, s.tok || 0, true)] : [];
  lines.splice(n + 1, 0, linkLine(ind, s.agent, title, s.sid), ...rescuedChildren.map((rc) => `${ind}${rc}`), ...extraClock);
  return { text: lines.join("\n"), line: n, kind: target.kind, blockId: eb.blockId };
}

// 把笔记里的第 srcLine 条任务整块挂为第 dstLine 条任务的子块：双方原文与块号均不改写。
export function nestTask(text, srcLine, dstLine) {
  const lines = text.split("\n");
  if (srcLine === dstLine || srcLine < 0 || dstLine < 0 || srcLine >= lines.length || dstLine >= lines.length) {
    return { text, error: t("请选择两条不同的任务行") };
  }
  if (MARKER_RE.test(lines[srcLine])) srcLine = markOwner(lines, srcLine);
  if (MARKER_RE.test(lines[dstLine])) dstLine = markOwner(lines, dstLine);
  if (srcLine < 0 || dstLine < 0 || srcLine === dstLine) return { text, error: t("这两行本身已经在同一个任务条目下了") };
  if (!LIST_RE.test(lines[srcLine]) || !LIST_RE.test(lines[dstLine]) || !kwLine(lines[srcLine]) || !kwLine(lines[dstLine])) {
    return { text, error: t("只能把任务列表项挂到另一条任务列表项下") };
  }
  const [s0, s1] = blockSpan(lines, srcLine);
  const [d0, d1] = blockSpan(lines, dstLine);
  if (d0 >= s0 && d0 <= s1) return { text, error: t("父子任务不能互相挂载") };
  if (s0 > d0 && s0 <= d1 && markOwner(lines, s0) === d0) {
    return { text, error: t("这一项已经是它的子块了") };
  }
  const dstInd = childIndent(lines, d0);
  const unit = dstInd.includes("\t") ? "\t" : " ".repeat(Math.max(2, width(dstInd) - width(lines[d0])));
  const chunk = lines.slice(s0, s1 + 1).filter((l) => l.trim());
  const srcBase = width(chunk[0]);
  const firstKid = chunk.slice(1).find((l) => width(l) > srcBase);
  const srcStep = firstKid ? Math.max(1, width(firstKid) - srcBase) : 4;
  const rebased = chunk.map((line, idx) => {
    if (idx === 0) return `${dstInd}${line.trim()}`;
    const w = width(line);
    const level = w > srcBase ? Math.max(1, Math.round((w - srcBase) / srcStep)) : 0;
    return `${dstInd}${unit.repeat(level)}${line.trim()}`;
  });
  let newDstLine = d0;
  let insertAt = d1 + 1;
  if (s0 < d0) {
    lines.splice(insertAt, 0, ...rebased);
    lines.splice(s0, s1 - s0 + 1);
    const removed = s1 - s0 + 1;
    newDstLine = d0 - removed;
    insertAt -= removed;
  } else {
    lines.splice(s0, s1 - s0 + 1);
    lines.splice(insertAt, 0, ...rebased);
  }
  const ks = kwLine(rebased[0]);
  const kd = kwLine(lines[newDstLine]);
  return {
    text: lines.join("\n"),
    line: insertAt,
    parentLine: newDstLine,
    blockId: blockIdOf(rebased[0]),
    body: ks ? ks.body : rebased[0].trim(),
    key: ks ? workKey(ks.body) : "",
    dstBody: kd ? kd.body : lines[newDstLine].trim(),
  };
}

// 把日记里的两个任务条目（比如一条 🤖 Agent 自动记的、一条人自己写的，或者任意两条）绑定/混合成一条：
//   · 保留人写的标题（如果两条都是人写的或都是 🤖，保留目标行 dstLine 的标题）
//   · 继承活跃状态词（DOING / TOREVIEW 等）与最早的开始时间
//   · 合并两条下面的所有子项（🔗、⏱、💬、❓、📋、子待办），去重并保留/补齐 ^xxxxx 块 ID
export function mergeTasks(text, srcLine, dstLine, { preferId = "", showTimeRange = DEFAULT_RECORD_RULES.showTimeRange } = {}) {
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
  const mergedUntil = (ps.until && pd.until) ? (ps.until > pd.until ? ps.until : pd.until) : (pd.until || ps.until || mergedSince);

  // 决定保留哪个 ^xxxxx 块 ID
  const blockId = pd.blockId || ps.blockId || preferId || makeBlockId(keptBody);
  const keptIsAuto = keptBody.startsWith(AUTO_MARK.trim());
  const headerRaw = keptIsAuto
    ? formatAutoTaskLine({ prefix: pd.prefix, kw: mergedKw, start: mergedSince, end: mergedUntil, title: pd.title, preserveTitle: true, showTimeRange })
    : formatSessionTaskLine({ prefix: pd.prefix, rest: keptBody, since: pd.since || "", until: pd.until || "" }, { kw: mergedKw, start: mergedSince, end: mergedUntil, showTimeRange });
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
    if (CLOCK_RE.test(k) && isAgentClockLine(k)) {
      const idx = mergedKids.findIndex((x) => CLOCK_RE.test(x) && isAgentClockLine(x));
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

const PROG_CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const PROG_END_LOOKAHEAD = "(?=$|[\\s）)】\\]，,。.;；·])";
const PROG_PCT_MATCH_RE = new RegExp(`(?:^|[\\s（(【\\[,，·\\-–—])((?:进度\\s*[:：]?\\s*)?(\\d{1,3})\\s*[%％])${PROG_END_LOOKAHEAD}`);
const PROG_PREFIX_FRAC_MATCH_RE = new RegExp(`(?:进度\\s*[:：]?\\s*)((\\d{1,2})\\s*\\/\\s*(\\d{1,2}))${PROG_END_LOOKAHEAD}`);
const PROG_FRAC_MATCH_RE = new RegExp(`(?:^|[\\s（(【\\[,，·])((\\d{1,2})\\s*\\/\\s*(\\d{1,2}))${PROG_END_LOOKAHEAD}`);
const PROG_CN_FRAC_MATCH_RE = /(?:进度\s*[:：]?\s*)?([一二两三四五六七八九十]+)分之([一二两三四五六七八九十]+)/;
const PROG_HALF_MATCH_RE = new RegExp(`((?:做了|完成了?)?一半)${PROG_END_LOOKAHEAD}`);

/** Extract explicit task progress (`40%`, `1/3`, `三分之一`, `一半`) ignoring code, comments, and wikilinks. */
export function extractTaskProgress(raw) {
  const cleaned = stripBlockId(String(raw || ""))
    .replace(/`[^`]*`/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/%%[^%]*?%%/g, " ")
    .replace(/!?\[\[[^\]]*\]\]/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  let m = PROG_PCT_MATCH_RE.exec(cleaned);
  if (m && Number(m[2]) >= 0 && Number(m[2]) <= 100) {
    return { pct: Math.round(Number(m[2])), raw: m[1].trim() };
  }
  m = PROG_PREFIX_FRAC_MATCH_RE.exec(cleaned);
  if (m) {
    const a = Number(m[2]), b = Number(m[3]);
    if (b >= 1 && b <= 99 && a >= 0 && a <= b) {
      return { pct: Math.round((a / b) * 100), raw: m[0].trim() };
    }
  }
  m = PROG_FRAC_MATCH_RE.exec(cleaned);
  if (m) {
    const a = Number(m[2]), b = Number(m[3]);
    if (b >= 2 && b <= 10 && a >= 0 && a <= b) {
      return { pct: Math.round((a / b) * 100), raw: m[1].trim() };
    }
  }
  m = PROG_CN_FRAC_MATCH_RE.exec(cleaned);
  if (m) {
    const b = PROG_CN_NUM[m[1]], a = PROG_CN_NUM[m[2]];
    if (b > 0 && a >= 0 && a <= b) {
      return { pct: Math.round((a / b) * 100), raw: m[0].trim() };
    }
  }
  m = PROG_HALF_MATCH_RE.exec(cleaned);
  if (m) {
    return { pct: 50, raw: m[1].trim() };
  }
  return null;
}
