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
// 会话时段存的是「从日记分界（设置里的 dayCutoff，默认早上 8 点）起算的分钟数」，写成钟点要把分界加回来。
// 插件加载、改设置时 setDayOffset(dayCutoff * 60)；测试里不设就是 0，从零点算
let DAY_OFFSET = 0;
export const setDayOffset = (min) => { DAY_OFFSET = Number(min) || 0; };
export const dayOffset = () => DAY_OFFSET;
export const clock = (t) => { const m = Math.round(t + DAY_OFFSET); return `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`; };
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
  const d = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(codex):\/\/threads\/([0-9a-f-]{36})|^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(workbuddy):\/\/chat\/([0-9A-Za-z_-]{8,})/.exec(line);
  if (d) return d[2] ? { agent: "codex", sid: d[3], title: d[1] || "" } : { agent: "workbuddy", sid: decodeURIComponent(d[6]), title: d[4] || "" };
  const b = /^\s*[-*+]\s+🔗.*`((?:session-)?[0-9a-f-]{36})`/.exec(line);
  if (!b) return null;
  const agent = /DeepSeek Harness|dsh:\/\//.test(line) ? "dsh" : /Codex[：:]/.test(line) ? "codex" : /WorkBuddy[：:]/.test(line) ? "workbuddy" : "claude";
  return { agent, sid: b[1], title: "" };
}

export function linkLine(indent, agent, title, sid) {
  const safe = String(title || "").replace(/[\[\]()`]+/g, " ").trim();
  if (agent === "claude") return `${indent}- 🔗 [Claude：${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- 🔗 [DeepSeek Harness：${safe}](dsh://open) \`${sid}\``;
  if (agent === "codex") return `${indent}- 🔗 [Codex：${safe}](codex://threads/${sid})`;
  if (agent === "workbuddy") return `${indent}- 🔗 [WorkBuddy：${safe}](workbuddy://chat/${encodeURIComponent(sid)})`;
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

// ---------- 拖拽绑定：面板里的会话卡片拖到笔记某一行上 ----------

const EMPTY_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s*$/;
const MARKER_RE = /^\s*[-*+]\s+(?:🔗|⏱|💬)/;

// 会话现在的状态 → 任务行上的关键词（和回写那一半同一套）
export function kwForState(state) {
  return ({ run: "DOING", running: "DOING", starting: "DOING", wait: "TOREVIEW", quiet: "TOREVIEW", idle: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" })[state] || "DOING";
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

// 把会话 s 绑到第 at 行（或在那儿新建一项）。s = { sid, agent, title, state, since, dropKey }
//   · 一个会话只绑一处：别处已有的 🔗 先摘掉；自动记日记替它新写过的「🤖 …」那一项（dropKey）一起收掉
//   · 原文不动，只在前面换上状态关键词（TODO / 没写关键词的 → DOING / TOREVIEW …；DONE、PAUSED 这些你定的不碰）
// 返回 { text, line, kind } 或 { text, error }
export function bindInto(text, at, s, { below = false } = {}) {
  let lines = text.split("\n");
  const target = dropKind(lines, at, below);
  if (!target) return { text, error: "这一行放不了会话：拖到列表项、空的列表项或空行上" };
  let n = target.line;
  if (target.kind === "bind") {
    const had = linkUnder(lines, n);
    if (had && had.sid === s.sid) return { text, error: "这一项已经绑着这个会话了" };
    if (had) return { text, error: "这一项已经绑着另一个会话；先删掉它下面的 🔗 行" };
  }
  const want = kwForState(s.state);
  const since = s.since || "";
  const title = resultText(s.title || "没起名的会话", 60);

  // 先把这个会话在别处的痕迹收掉，再按内容重新找回目标行
  const anchor = lines[n];
  const drop = (i) => { lines.splice(i, 1); if (i < n) n--; };
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = parseLink(lines[i]);
    if (k && k.sid === s.sid) drop(i);
  }
  if (s.dropKey) {
    const hit = taskItems(lines.join("\n")).find((t) => t.key === s.dropKey && t.body.startsWith(AUTO_MARK.trim()) && t.line !== n);
    if (hit) {
      const base = width(lines[hit.line]);
      let end = hit.line, own = true;
      for (let i = hit.line + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        if (!MARKER_RE.test(lines[i])) own = false;
        end = i;
      }
      if (own) for (let i = end; i >= hit.line; i--) drop(i);
    }
  }
  if (lines[n] !== anchor) {
    const back = lines.indexOf(anchor);
    if (back < 0) return { text, error: "笔记在拖的时候变了，再拖一次" };
    n = back;
  }

  if (target.kind === "bind") {
    const p = splitTask(lines[n]);
    if (p && !p.cb && (!p.kw || OPEN_KWS.includes(p.kw) || p.kw === "DOING" || AGENT_KW_RE.test(p.kw))) {
      lines[n] = `${p.prefix}${want} ${p.since || since} ${p.rest}`.replace(/ {2,}/g, " ").trimEnd();
    }
    lines.splice(n + 1, 0, linkLine(childIndent(lines, n), s.agent, title, s.sid));
    return { text: lines.join("\n"), line: n, kind: "bind" };
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
    const item = `${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " ");
    const lead = (/^\s*/.exec(item) || [""])[0];
    lines.splice(end + 1, 0, item, linkLine(lead + (lead && !lead.includes("\t") ? "    " : "\t"), s.agent, title, s.sid));
    return { text: lines.join("\n"), line: end + 1, kind: "after" };
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
  const item = `${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " ");
  if (target.kind === "below") { lines.splice(n + 1, 0, item); n = n + 1; }
  else if (target.kind === "new" && lines[n + 1] && lines[n + 1].trim() && !LIST_RE.test(lines[n + 1])) lines.splice(n, 0, item);   // 空行下面紧接一段文字：空行留着，不然那段会变成这一项的续行
  else lines[n] = item;
  const lead = (/^\s*/.exec(item) || [""])[0];
  lines.splice(n + 1, 0, linkLine(lead + (lead && !lead.includes("\t") ? "    " : "\t"), s.agent, title, s.sid));
  return { text: lines.join("\n"), line: n, kind: target.kind };
}
