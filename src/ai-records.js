// AI 记录的显示范围；只管直属记录，不隐藏手写笔记与子任务。
import * as J from "./journal.js";
export const AI_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋|⏱|🔗)\s|TODO\s+🤖\s)/;
export const isBriefRecord = line => /💬\s+(?:第\d+轮[：:])?任务：.+；结论：/.test(line);

export function aiRecordGroups(text, trackedIds = new Set()) {
  const lines = text.split("\n"), out = [], fenced = J.fencedLines(lines);
  for (const task of J.taskItems(text)) {
    if (fenced.has(task.line) || AI_RECORD_RE.test(lines[task.line])) continue;
    const indent = J.width(J.childIndent(lines, task.line));
    const records = [];
    for (let i = task.line + 1; i < lines.length; i++) {
      if (fenced.has(i) || !lines[i].trim()) continue;
      const w = J.width(lines[i]);
      if (w <= task.indent) break;
      if (w === indent && AI_RECORD_RE.test(lines[i]) && !J.blockIdOf(lines[i]) && !J.hasDescendants(lines, i)) records.push(i);
    }
    if (!records.length) continue;
    const tracked = task.blockId?.startsWith("ad-") || trackedIds.has(task.blockId) || task.body.startsWith("🤖") || records.some((i) => J.parseLink(lines[i]));
    if (tracked) out.push({
      key: task.blockId || `${task.line}:${task.key}`,
      line: task.line,
      kw: task.kw,
      state: task.state,
      records,
      summaries: records.filter((n) => /💬\s+累计总结[：:]/.test(lines[n])),
    });
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
  if (closed[group.key]) return false;
  if (expanded[group.key]) return true;
  return recordStartsOpen(mode, group);
}

// 收起时按 AI 结论计数；提问、链接、用时和步骤只在展开后显示。
// 累计总结是没有轮次结论时的回退，不占最近 N 条的名额。
export function visibleRecords(group, lines, mode = "latest1") {
  const count = { latest1: 1, latest3: 3, latest5: 5 }[mode];
  if (count) {
    const results = group.records.filter((n) => /^(?:\s*(?:[-*+]|\d+[.)])\s+)?💬\s/.test(lines[n]) && !/💬\s+累计总结[：:]/.test(lines[n]));
    const round = n => +( /<!-- ad-turn:[^:]+:(\d+) -->/.exec(lines[n]) || /第(\d+)轮[：:]/.exec(lines[n]) || [0, 0])[1];
    return results.length ? results.sort((a, b) => round(b) - round(a) || b - a).slice(0, count).sort((a, b) => a - b) : group.summaries;
  }
  // expanded 模式被手动收起后也必须隐藏明细。
  return group.summaries;
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
  return /^ad-[a-z0-9-]+$/i.test(id) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || trackedIds.has(id);
}

export function adBlockIdRanges(text, trackedIds = new Set()) {
  const out = [];
  let offset = 0, fence = "", fenceLength = 0;
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = "";
    } else if (!fence) {
      const turn = /[ \t]+<!-- ad-(?:(?:turn|summary):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->/.exec(line);
      if (turn) out.push({ from: offset + turn.index, to: offset + turn.index + turn[0].length });
      const id = /(?:[ \t]+|^)\^([a-z0-9-]+)[ \t]*$/i.exec(line);
      if (id && hiddenBlockId(id[1], trackedIds)) out.push({ from: offset + id.index, to: offset + line.length });
      const link = J.parseLink(line), suffix = /[ \t]+`([^`]+)`[ \t]*$/.exec(line);
      if (link && suffix?.[1] === link.sid) out.push({ from: offset + suffix.index, to: offset + line.length });
    }
    offset += line.length + 1;
  }
  return out;
}
