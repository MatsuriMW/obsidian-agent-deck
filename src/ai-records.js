// AI 记录的显示范围；只管直属记录，不隐藏手写笔记与子任务。
import * as J from "./journal.js";
import { t } from "./i18n.js";
export const AI_RECORD_RE = J.RECORD_LINE_RE;
export const RECORD_MARKER_BODY_RE = /^(?:(?:💬|❓|📋|⏱|🔗)\s|(?:第\d+轮|Round\s+\d+)[：:]|TODO\s+🤖\s)/;
export const RECORD_VIEWS = new Set(["outline", "table", "cards", "timeline"]);
export const RECORD_VIEW_LABELS = {
  outline: "大纲",
  table: "表格",
  cards: "卡片",
  timeline: "时间线",
};
const BRIEF_LEAD_RE = /(?:💬\s+(?:(?:第\d+轮|Round\s+\d+)[：:])?|(?:^|\s)(?:第\d+轮|Round\s+\d+)[：:])/;
const BRIEF_PAIR_RE = /(?:\*\*任务\*\*|任务)[：:].+；(?:\*\*结论\*\*|结论)[：:]|(?:\*\*Task\*\*|Task):\s*.+;\s*(?:\*\*Result\*\*|Result):\s*.+/;
export const isBriefRecord = line => new RegExp(`${BRIEF_LEAD_RE.source}\\s*(?:${BRIEF_PAIR_RE.source})`).test(line);
export const isPinnedLine = line => J.hasPinMarker(line);

function groupPrefValue(map, group) {
  if (!map || !group) return undefined;
  for (const k of [group.key, group.stableKey]) {
    if (k && Object.hasOwn(map, k)) return map[k];
  }
  return undefined;
}

export function recordViewMode(settings, group) {
  const mode = groupPrefValue(settings?.aiRecordViews, group);
  return RECORD_VIEWS.has(mode) ? mode : "outline";
}

function collectChildSubtree(lines, start, indent, endLine, fenced) {
  let subEnd = start;
  let hasForeignSubtree = false;
  for (let k = start + 1; k <= endLine; k++) {
    if (!lines[k].trim()) continue;
    if (J.width(lines[k]) <= indent) break;
    subEnd = k;
    if (!fenced.has(k) && (J.kwLine(lines[k])?.kw || J.blockIdOf(lines[k]) || J.parseLink(lines[k]))) {
      hasForeignSubtree = true;
    }
  }
  return { subEnd, hasForeignSubtree };
}

const normalizeStableTaskKey = (k) => String(k || "")
  .replace(/^(?:\*\*\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\*\*|\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?)\s*/u, "")
  .replace(/^🤖\s*/u, "")
  .trim();

export function aiRecordGroups(text, trackedIds = new Set()) {
  if (!text || (!text.includes("💬") && !text.includes("❓") && !text.includes("📋") && !text.includes("⏱") && !text.includes("🔗") && !text.includes("🤖") && !text.includes("^") && !/(?:第\d+轮|Round\s+\d+)[：:]/.test(text))) return [];
  const lines = text.split("\n"), out = [], fenced = J.fencedLines(lines), titleCounts = new Map();
  for (const task of J.taskItems(text)) {
    if (fenced.has(task.line) || AI_RECORD_RE.test(lines[task.line])) continue;
    const indent = J.width(J.childIndent(lines, task.line));
    let endLine = task.line;
    for (let i = task.line + 1; i < lines.length; i++) {
      if (lines[i].trim() && J.width(lines[i]) <= task.indent) break;
      if (lines[i].trim()) endLine = i;
    }
    const records = [];
    const tableEntries = [];
    for (let i = task.line + 1; i <= endLine; i++) {
      if (fenced.has(i) || !lines[i].trim()) continue;
      const w = J.width(lines[i]);
      if (w !== indent || !AI_RECORD_RE.test(lines[i]) || J.blockIdOf(lines[i])) continue;
      const { subEnd, hasForeignSubtree } = collectChildSubtree(lines, i, indent, endLine, fenced);
      if (subEnd === i) {
        records.push(i);
        tableEntries.push({ line: i, endLine: i, lineNumbers: [i], children: [] });
      } else if (!hasForeignSubtree) {
        const lineNumbers = [];
        const children = [];
        for (let k = i; k <= subEnd; k++) {
          lineNumbers.push(k);
          if (k > i && (lines[k].trim() || fenced.has(k))) children.push(lines[k]);
        }
        tableEntries.push({ line: i, endLine: subEnd, lineNumbers, children });
      }
      i = subEnd;
    }
    if (!records.length && !tableEntries.length) continue;
    const tracked = J.isDeckBlockId(task.blockId)
      || trackedIds.has(task.blockId)
      || task.body.startsWith("🤖")
      || records.some((i) => J.parseLink(lines[i]))
      || tableEntries.some((e) => J.parseLink(lines[e.line]));
    if (tracked) {
      const baseTitle = normalizeStableTaskKey(task.key) || task.key;
      const occ = (titleCounts.get(baseTitle) || 0) + 1;
      titleCounts.set(baseTitle, occ);
      const stableKey = `task:${baseTitle}${occ > 1 ? `#${occ}` : ""}`;
      out.push({
        key: task.blockId || stableKey,
        stableKey,
        line: task.line,
        indent: task.indent,
        endLine,
        kw: task.kw,
        state: task.state,
        records,
        summaries: records.filter((n) => /💬\s+累计总结[：:]/.test(lines[n])),
        tableEntries,
      });
    }
  }
  for (const g of out) {
    g.topLevel = !out.some((outer) => outer !== g && outer.line < g.line && g.line <= outer.endLine);
  }
  return out;
}

// The display setting determines the initial state, including merged summaries.
export function recordStartsOpen(mode, group) {
  return mode === "expanded";
}

// What the user last chose wins over the mode default. Both sets are sparse:
// aiRecordExpanded holds tasks opened by hand, aiRecordClosed holds tasks folded
// by hand (only meaningful when the mode starts them open).
export function recordIsOpen(settings, mode, group) {
  const expanded = settings?.aiRecordExpanded || {};
  const closed = settings?.aiRecordClosed || {};
  if (groupPrefValue(closed, group)) return false;
  if (groupPrefValue(expanded, group)) return true;
  return recordStartsOpen(mode, group);
}

function selectVisibleLines(lineNums, lines, mode = "latest1", summaryLines = [], extraPinned = null) {
  const pinned = lineNums.filter((n) => isPinnedLine(lines[n]) || extraPinned?.has(n));
  const merge = (base) => [...new Set([...base, ...pinned])].sort((a, b) => a - b);
  const count = { latest1: 1, latest3: 3, latest5: 5 }[mode];
  if (count) {
    const results = lineNums.filter((n) => /^(?:\s*(?:[-*+]|\d+[.)])\s+)?(?:💬\s|(?:第\d+轮|Round\s+\d+)[：:])/.test(lines[n]) && !/💬\s+累计总结[：:]/.test(lines[n]));
    const round = n => {
      const m = /<!-- ad-turn:[^:]+:(\d+) -->/.exec(lines[n]) || /(?:第(\d+)轮|Round\s+(\d+))[：:]/.exec(lines[n]);
      return m ? +(m[1] || m[2]) : 0;
    };
    const picked = results.length ? results.sort((a, b) => round(b) - round(a) || b - a).slice(0, count) : summaryLines;
    return merge(picked);
  }
  // expanded 模式被手动收起后也必须隐藏明细，但保留用户 Pin 住的关键记录。
  return merge(summaryLines);
}

// 收起时按 AI 结论计数；提问、链接、用时和步骤只在展开后显示；被 Pin 的关键记录折叠时不隐藏。
// 累计总结是没有轮次结论时的回退，不占最近 N 条的名额。
export function visibleRecords(group, lines, mode = "latest1", extraPinned = null) {
  return selectVisibleLines(group.records, lines, mode, group.summaries, extraPinned);
}

export function visibleTableEntries(group, lines, mode = "latest1", open = false, redundantLine = -1) {
  const entries = (group.tableEntries || []).filter((e) => e.line !== redundantLine);
  if (open) return entries;
  const lineNums = entries.map((e) => e.line);
  const summaries = lineNums.filter((n) => /💬\s+累计总结[：:]/.test(lines[n]));
  const kept = new Set(selectVisibleLines(lineNums, lines, mode, summaries));
  return entries.filter((e) => kept.has(e.line));
}

function cleanRecordText(raw) {
  return J.stripPinMarker(String(raw || "").replace(J.RECORD_PROVENANCE_RE, ""))
    .replace(/(?:[ \t]+|^)\^[a-z0-9-]+(?:\S*)?[ \t]*$/i, "")
    .trim();
}

export function parseAiRecordRow(rawLine, childLines = [], agentNames = null) {
  const raw = String(rawLine || "");
  const turnMatch = /<!-- ad-turn:[^:]+:(\d+) -->/.exec(raw) || /(?:第(\d+)轮|Round\s+(\d+))[：:]/.exec(raw);
  const round = turnMatch ? Number(turnMatch[1] || turnMatch[2]) : null;
  const link = J.parseLink(raw);
  const body = J.stripBoundSessionSuffix(cleanRecordText(raw).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""), link);

  let kind = "result", kindLabel = "结论", content = body, meta = "", task = "", conclusion = "";
  if (/^💬\s+累计总结[：:]/.test(body)) {
    kind = "summary"; kindLabel = "总结";
    content = body.replace(/^💬\s+累计总结[：:]\s*/, "");
  } else if (/^(?:💬\s|(?:第\d+轮|Round\s+\d+)[：:])/.test(body)) {
    kind = "result"; kindLabel = "结论";
    content = body.replace(/^(?:💬\s+(?:(?:第\d+轮|Round\s+\d+)[：:])?|(?:第\d+轮|Round\s+\d+)[：:])\s*/, "");
    const brief = /^(?:\*\*任务\*\*|任务)[：:]\s*([\s\S]+?)；(?:\*\*结论\*\*|结论)[：:]\s*([\s\S]+)$/.exec(content)
      || /^(?:\*\*Task\*\*|Task):\s*([\s\S]+?);\s*(?:\*\*Result\*\*|Result):\s*([\s\S]+)$/.exec(content);
    if (brief) { task = brief[1].trim(); conclusion = brief[2].trim(); }
  } else if (/^❓\s/.test(body)) {
    kind = "question"; kindLabel = "提问";
    content = body.replace(/^❓\s+(?:(?:第\d+轮|Round\s+\d+)[：:])?\s*/, "");
  } else if (/^📋\s/.test(body)) {
    kind = "plan"; kindLabel = "步骤";
    const rest = body.replace(/^📋\s+(?:(?:第\d+轮|Round\s+\d+)[：:])?\s*/, "");
    const step = /^步骤\s+(\d+\/\d+)(?:\s*·\s*(.*))?$/.exec(rest);
    if (step) { meta = step[1]; content = (step[2] || "").trim() || rest; }
    else content = rest;
  } else if (/^⏱\s/.test(body)) {
    kind = "clock"; kindLabel = "用时";
    const rest = body.replace(/^⏱\s+/, "");
    const parts = rest.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) { content = parts[0]; meta = parts.slice(1).join(" · "); }
    else content = rest;
  } else if (/^🔗\s/.test(body)) {
    kind = "link"; kindLabel = "会话";
    content = body.replace(/^🔗\s+/, "");
    meta = link ? ((agentNames && agentNames[link.agent]) || link.agent || "") : "";
  } else if (/^TODO\s+🤖\s/.test(body)) {
    kind = "todo"; kindLabel = "待确认";
    content = body.replace(/^TODO\s+🤖\s+/, "");
  }

  const nonEmptyChildren = (childLines || []).filter((l) => String(l || "").trim());
  const baseIndent = nonEmptyChildren.length ? Math.min(...nonEmptyChildren.map((l) => J.width(l))) : 0;
  const children = nonEmptyChildren.map((l) => ({
    level: Math.max(0, Math.floor((J.width(l) - baseIndent) / 2)),
    text: cleanRecordText(l).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""),
  })).filter((c) => c.text);

  return { kind, kindLabel, round, content, task, conclusion, meta, children, ...(isPinnedLine(rawLine) ? { pinned: true } : {}) };
}

export function buildTableModel(parsedRows = []) {
  const rows = [];
  const footer = [];
  for (let i = 0; i < parsedRows.length; i++) {
    const r = parsedRows[i];
    if (r.kind === "clock" || r.kind === "link") {
      footer.push(r);
      continue;
    }
    const next = parsedRows[i + 1];
    if (
      r.kind === "question" &&
      r.round != null &&
      !r.children?.length &&
      next?.kind === "result" &&
      next.round === r.round &&
      !next.task
    ) {
      rows.push({
        type: "round",
        round: r.round,
        badge: "",
        badgeKind: "result",
        prompt: r.content,
        promptMeta: "",
        promptLine: r.line,
        conclusion: next.content,
        conclusionLine: next.line,
        line: next.line,
        pinned: Boolean(r.pinned || next.pinned),
        pinLine: next.line,
        startedAt: Number(r.startedAt || next?.startedAt) || 0,
        children: next.children || [],
        sig: `${r.sig}+${next.sig}`,
      });
      i++;
      continue;
    }
    if (r.kind === "summary" || r.kind === "todo") {
      rows.push({
        type: "span",
        round: r.round,
        badge: r.kindLabel,
        badgeKind: r.kind,
        prompt: "",
        promptMeta: "",
        promptLine: r.line,
        conclusion: r.content,
        conclusionLine: r.line,
        line: r.line,
        pinned: Boolean(r.pinned),
        pinLine: r.line,
        startedAt: Number(r.startedAt) || 0,
        children: r.children || [],
        sig: r.sig,
      });
      continue;
    }
    if (r.kind === "plan") {
      rows.push({
        type: "round",
        round: r.round,
        badge: r.round == null ? r.kindLabel : "",
        badgeKind: "plan",
        prompt: "",
        promptStep: true,
        promptMeta: r.meta || "",
        promptLine: r.line,
        conclusion: r.content,
        conclusionLine: r.line,
        line: r.line,
        pinned: Boolean(r.pinned),
        pinLine: r.line,
        startedAt: Number(r.startedAt) || 0,
        children: r.children || [],
        sig: r.sig,
      });
      continue;
    }
    if (r.kind === "question") {
      rows.push({
        type: "round",
        round: r.round,
        badge: r.round == null ? r.kindLabel : "",
        badgeKind: "question",
        prompt: r.content,
        promptMeta: "",
        promptLine: r.line,
        conclusion: "",
        conclusionLine: r.line,
        line: r.line,
        pinned: Boolean(r.pinned),
        pinLine: r.line,
        startedAt: Number(r.startedAt) || 0,
        children: r.children || [],
        sig: r.sig,
      });
      continue;
    }
    const brief = Boolean(r.task && r.conclusion);
    rows.push({
      type: "round",
      round: r.round,
      badge: r.round == null ? r.kindLabel : "",
      badgeKind: r.kind,
      prompt: brief ? r.task : "",
      promptMeta: "",
      promptLine: r.line,
      conclusion: brief ? r.conclusion : r.content,
      conclusionLine: r.line,
      line: r.line,
      pinned: Boolean(r.pinned),
      pinLine: r.line,
      startedAt: Number(r.startedAt) || 0,
      children: r.children || [],
      sig: r.sig,
    });
  }
  const hasPromptCol = rows.some((r) => Boolean(r.prompt || r.promptStep));
  return { rows, footer, hasPromptCol };
}

export function recordRuns(records) {
  const runs = [];
  for (const n of records) {
    const last = runs[runs.length - 1];
    if (last && last.to + 1 === n) last.to = n;
    else runs.push({ from: n, to: n });
  }
  return runs;
}

// 块 ID 留在 Markdown 中，仅返回要在编辑器隐藏的字符范围。
export function hiddenBlockId(id, trackedIds = new Set()) {
  return J.isDeckBlockId(id) || J.isLegacyBlockId(id) || trackedIds.has(id);
}

const LAYOUT_MARKER_RE = /^<!-- agent-deck:(?:layout:(?:start|end)|section:(?:done|active|todo|notes):(?:heading|plain|end)) -->$/;

// 分区边界注释留在 Markdown 中，但在编辑器里整行隐藏（不留多余空行，代码块内示例不动）。
export function layoutMarkerRanges(text) {
  if (!text || !text.includes("<!-- agent-deck:")) return [];
  const out = [];
  const lines = text.split("\n");
  const fenced = J.fencedLines(lines);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length;
    if (!fenced.has(i) && LAYOUT_MARKER_RE.test(line)) {
      const from = i > 0 ? offset - 1 : 0;
      let to = lineEnd;
      if (line === "<!-- agent-deck:layout:start -->" && i + 1 < lines.length && lines[i + 1] === "") {
        to = lineEnd + 1;
      }
      out.push({ from, to });
    }
    offset = lineEnd + 1;
  }
  return out;
}

export function adBlockIdRanges(text, trackedIds = new Set()) {
  if (!text || (!text.includes("^") && !text.includes("🔗"))) return [];
  const out = [];
  let offset = 0, fence = "", fenceLength = 0;
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = "";
    } else if (!fence) {
      for (const m of line.matchAll(/[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+|pin) -->/g)) {
        out.push({ from: offset + m.index, to: offset + m.index + m[0].length });
      }
      const id = /(?:[ \t]+|^)\^([a-z0-9-]+)(?:\S*)?[ \t]*$/i.exec(line);
      if (id && hiddenBlockId(id[1], trackedIds)) out.push({ from: offset + id.index, to: offset + line.length });
      const link = J.parseLink(line), suffix = /[ \t]+`([^`]+)`[ \t]*$/.exec(line);
      if (link && suffix?.[1] === link.sid) out.push({ from: offset + suffix.index, to: offset + line.length });
    }
    offset += line.length + 1;
  }
  return out;
}

// Keep user typing and cursor placement before a line-ending hidden block ID,
// while letting Enter split the line after the hidden block ID so the ID stays on the task line.
export function redirectHiddenTailTransaction(text, trackedIds = new Set(), { change = null, prevHead = -1, nextHead = -1, selectionEmpty = true } = {}) {
  const ranges = adBlockIdRanges(text, trackedIds);
  if (!ranges.length) return null;
  if (change && change.from === change.to && change.insert) {
    for (const r of ranges) {
      if (change.insert.startsWith("\n") && change.from === r.from) {
        return { change: { from: r.to, to: r.to, insert: change.insert }, head: r.to + change.insert.length };
      }
      if (!change.insert.includes("\n") && change.from > r.from && change.from <= r.to) {
        return { change: { from: r.from, to: r.from, insert: change.insert }, head: r.from + change.insert.length };
      }
    }
    return null;
  }
  if (!change && selectionEmpty && nextHead >= 0) {
    for (const r of ranges) {
      if (nextHead > r.from && nextHead <= r.to) {
        if (prevHead === r.from && nextHead === r.to) {
          return { head: r.to < text.length ? r.to + 1 : r.from };
        }
        return { head: r.from };
      }
    }
  }
  return null;
}

export function trackedBlockIds(plugin) {
  const ids = new Set();
  for (const day of Object.values(plugin?.settings?.autoLogState || {})) {
    for (const rec of Object.values(day || {})) if (rec?.blockId) ids.add(rec.blockId);
  }
  for (const rec of Object.values(plugin?.settings?.taskBindings || {})) if (rec?.blockId) ids.add(rec.blockId);
  return ids;
}

export function blockSessionMap(plugin) {
  const out = new Map();
  const add = (id, sid) => {
    if (!id || !sid) return;
    if (!out.has(id)) out.set(id, new Set());
    out.get(id).add(sid);
  };
  for (const day of Object.values(plugin?.settings?.autoLogState || {})) {
    for (const [sid, rec] of Object.entries(day || {})) add(rec?.blockId, sid);
  }
  for (const [sid, rec] of Object.entries(plugin?.settings?.taskBindings || {})) add(rec?.blockId, sid);
  for (const job of Object.values(plugin?.jobs || {})) add(job?.blockId, job?.sessionId);
  return out;
}

export function collectGroupSids(group, lines, blockMap) {
  const sids = [];
  const push = (sid) => { if (sid && !sids.includes(sid)) sids.push(sid); };
  const turnSid = (line) => /<!-- ad-turn:([A-Za-z0-9_-]+):\d+ -->/.exec(String(line || ""))?.[1];
  const id = group ? J.blockIdOf(lines[group.line]) : "";
  if (id && blockMap?.has(id)) for (const sid of blockMap.get(id)) push(sid);
  for (const n of group?.records || []) {
    push(J.parseLink(lines[n])?.sid);
    push(turnSid(lines[n]));
  }
  for (const e of group?.tableEntries || []) {
    push(J.parseLink(lines[e.line])?.sid);
    push(turnSid(lines[e.line]));
  }
  return sids;
}

export function roundStartedAt(plugin, rawLine, round, groupSids = []) {
  if (round == null || !groupSids.length) return 0;
  let sid = groupSids[0];
  if (groupSids.length > 1) {
    sid = J.parseLink(rawLine)?.sid
      || groupSids.find((id) => rawLine.includes(J.turnMarker(id, round)) || rawLine.includes(`<!-- ad-turn:${id}:${round} -->`))
      || groupSids[0];
  }
  const metaRounds = plugin?.usage?.meta?.get?.(sid)?.rounds;
  if (Array.isArray(metaRounds)) {
    const hit = metaRounds.find((r) => r && r.n === round) || metaRounds[round - 1];
    const ts = Number(hit?.at);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  for (const job of Object.values(plugin?.jobs || {})) {
    if (job?.sessionId !== sid || !Array.isArray(job.conversation)) continue;
    let seen = 0;
    for (const msg of job.conversation) {
      if (msg?.role !== "user") continue;
      seen++;
      const ts = Number(msg.at);
      if (seen === round && Number.isFinite(ts) && ts > 0) return ts;
    }
  }
  return 0;
}

const pad2 = (n) => String(n).padStart(2, "0");

export function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatTimelineAt(ms, showDate = false) {
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return showDate ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}` : hm;
}

export function formatTimelineFull(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function recordViewLabel(viewMode) {
  return t(RECORD_VIEW_LABELS[viewMode] || RECORD_VIEW_LABELS.outline);
}

export function recordBadgeLabel(kind, fallback = "") {
  if (fallback === "总结" || kind === "summary") return t("总结");
  if (fallback === "待确认" || kind === "todo") return t("待确认");
  if (fallback === "提问" || kind === "question") return t("提问");
  if (fallback === "步骤" || kind === "plan") return t("步骤");
  return t("结论");
}

export function recordStepLabel(row) {
  if (!row?.promptStep) return "";
  return row.promptMeta ? t("步骤 {step}", { step: row.promptMeta }) : t("步骤");
}

export function timelineSpanMeta(rows = []) {
  const times = rows.map((r) => Number(r.startedAt) || 0).filter((ms) => ms > 0);
  const timed = times.length > 0;
  const dated = times.length > 1 && new Set(times.map(localDayKey)).size > 1;
  return { timed, dated };
}

export function footerMetaText(item) {
  if (!item?.meta) return "";
  return item.kind === "clock" ? `· ${item.meta}` : item.meta;
}

export function buildGroupTableRows(group, entries, lines, plugin, { includeTime = false, blockMap = null, agentNames = null } = {}) {
  const groupSids = includeTime ? collectGroupSids(group, lines, blockMap || blockSessionMap(plugin)) : null;
  return entries.map((entry) => {
    const parsed = parseAiRecordRow(lines[entry.line], entry.children, agentNames);
    return {
      ...parsed,
      line: entry.line,
      startedAt: groupSids ? roundStartedAt(plugin, lines[entry.line], parsed.round, groupSids) : 0,
      sig: [lines[entry.line], ...entry.children].join("\n"),
    };
  });
}

export function tokenizeInlineMarkdown(text) {
  const s = String(text || "");
  const tokenRe = /\[([^\]\n]+)\]\(([^)\s]+(?:\([^)]*\))?[^)\s]*)\)|\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  const tokens = [];
  let last = 0;
  let m;
  while ((m = tokenRe.exec(s))) {
    if (m.index > last) tokens.push({ type: "text", text: s.slice(last, m.index) });
    if (m[1] != null) tokens.push({ type: "link", label: m[1], href: String(m[2] || "").trim() });
    else if (m[3] != null) tokens.push({ type: "wikilink", target: m[3], label: m[4] || m[3] });
    else if (m[5] != null) tokens.push({ type: "code", text: m[5] });
    else if (m[6] != null) tokens.push({ type: "bold", text: m[6] });
    else if (m[7] != null) tokens.push({ type: "italic", text: m[7] });
    last = m.index + m[0].length;
  }
  if (last < s.length) tokens.push({ type: "text", text: s.slice(last) });
  return tokens;
}
