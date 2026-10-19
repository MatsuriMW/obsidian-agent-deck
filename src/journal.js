// Agent Deck — the journal line grammar.
//
// The AI half of the human–AI journal lives here: task lines, the 🔗 / 💬 / ⏱
// marker lines, and the small helpers that let the plugin rewrite one line
// without touching the rest of the note. Everything in this file is pure: it
// takes text in and returns text out, so it can be tested without Obsidian.

export const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
export const STAMP_RE = /^\*\*(\d{1,2})[:：](\d{2})\*\*\s*/;
export const CHECKBOX_RE = /^\[([ xX\/\-])\]\s*/;
export const KEYWORD_RE = /^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)\s*/;

// TOREVIEW / NEEDOK / … are the states an agent session switches a line through.
// A line only flips between DOING and these; anything else is the user's.
export const AGENT_KWS = ["TOREVIEW", "NEEDOK", "ERRORED", "HITLIMIT", "QUEUED", "DELEGATED"];
export const AGENT_KW_RE = /^(TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)$/;
export const OPEN_KWS = ["TODO", "LATER", "NOW", "WAITING", "WAIT", "TODOFORAI", "TODO4AI", "TODO2AI", "TODOTOAI"];
export const DONE_KWS = ["DONE", "CANCELED", "CANCELLED", "FAILED"];

export const LINK_RE = /^\s*[-*+]\s+🔗/;
export const RESULT_RE = /^\s*[-*+]\s+💬/;
export const CLOCK_RE = /^\s*[-*+]\s+⏱/;
export const KID_LINK_RE = /^\s*[-*+]\s+🔗\s*(子代理|side chat)\s*`(?:pid\s*)?([0-9a-z]+)`/;
export const AUTO_MARK = "🤖 ";

const pad = (n) => String(n).padStart(2, "0");
export const clock = (t) => `${pad(Math.floor(t / 60) % 24)}:${pad(Math.round(t % 60))}`;
export const durTag = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "m" : ""}` : `${Math.max(1, Math.round(m))}m`);
export const width = (line) => { let w = 0; for (const c of (/^\s*/.exec(line) || [""])[0]) w += c === "\t" ? 4 : 1; return w; };

export const workKey = (label) => String(label || "").replace(/\s*←\s*\S+\s*$/, "").trim();

// 这一行是什么任务：{ prefix, rest, since, kw, cb }；不是列表项返回 null
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
  return { prefix, rest, since, kw: kw ? kw[1] : null, cb: cb ? cb[1] : null };
}

// 日记里的任务正文和状态（跳过 🔗 / ⏱ / 💬 / 🤖 记号行）
export function kwLine(raw) {
  let s = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s+/, "").replace(STAMP_RE, "");
  let kw = "";
  const cb = CHECKBOX_RE.exec(s);
  if (cb) { kw = cb[1] === " " ? "TODO" : cb[1] === "/" ? "DOING" : cb[1] === "-" ? "CANCELLED" : "DONE"; s = s.slice(cb[0].length); }
  const m = /^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)(?=\s|$)\s*/.exec(s);
  if (m) { kw = m[1]; s = s.slice(m[0].length); }
  s = s.replace(/^\[#[ABC]\]\s*/, "").replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～]\s*\d{1,2}[:：]\d{2})?\s*/, "").replace(/^\[#[ABC]\]\s*/, "").trim();
  if (!s || s.startsWith("⏱") || s.startsWith("🔗") || s.startsWith("💬") || /^🤖\s*(?:子代理|side chat)/.test(s)) return null;
  return { kw, body: s };
}

export function parseLink(line) {
  const m = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(claude|codex|workbuddy|dsh):\/\/[^)]*?session=([0-9a-f-]{36})/.exec(line);
  if (m) return { agent: m[2], sid: m[3], title: m[1] || "" };
  const b = /^\s*[-*+]\s+🔗.*`([0-9a-f-]{36})`/.exec(line);
  return b ? { agent: "claude", sid: b[1], title: "" } : null;
}

export function linkLine(indent, agent, title, sid) {
  const safe = String(title || "").replace(/[\[\]]/g, " ").trim();
  if (agent === "claude") return `${indent}- 🔗 [Claude：${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- 🔗 [DeepSeek Harness：${safe}](dsh://open) \`${sid}\``;
  return `${indent}- 🔗 ${agent}：${safe} \`${sid}\``;
}

export function markOwner(lines, i) {
  const ind = width(lines[i]);
  for (let j = i - 1; j >= 0; j--) if (lines[j].trim() && LIST_RE.test(lines[j]) && width(lines[j]) < ind) return j;
  return -1;
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

// 把会话最后说的话写到它绑着的那件任务下面；已有 💬 就换掉，没有就接在 🔗 后面
export function resultInto(text, sid, said) {
  if (!said || !text.includes(sid)) return text;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => { const k = parseLink(l); return k && k.sid === sid; });
  const n = at < 0 ? -1 : markOwner(lines, at);
  if (n < 0) return text;
  const line = `${/^\s*/.exec(lines[at])[0]}- 💬 ${said}`;
  const had = resultUnder(lines, n);
  if (had) { if (lines[had.line] === line) return text; lines[had.line] = line; }
  else lines.splice(at + 1, 0, line);
  return lines.join("\n");
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

// 一篇日记里所有的任务行：[{ line, kw, body, key, indent, state }]
// state = done / doing / paused / open；🔗 / ⏱ / 💬 记号行不算
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
    out.push({ line: i, kw: k.kw, body: k.body, key: workKey(k.body), indent: width(lines[i]), state: st });
  }
  return out;
}

// 这一行现在是什么状态；找不到返回 null
export function findTask(text, key) {
  const hits = taskItems(text).filter((i) => i.key === key);
  return hits.find((i) => i.state === "open") || hits[0] || null;
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
