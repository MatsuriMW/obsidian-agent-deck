// AI 记录的显示范围；只管直属记录，不隐藏手写笔记与子任务。
import * as J from "./journal.js";
export const AI_RECORD_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:💬|❓|📋|⏱|🔗)\s|TODO\s+🤖\s)/;

export function aiRecordGroups(text, trackedIds = new Set()) {
  const lines = text.split("\n"), out = [];
  for (const task of J.taskItems(text)) {
    if (AI_RECORD_RE.test(lines[task.line])) continue;
    const indent = J.width(J.childIndent(lines, task.line));
    const records = [];
    for (let i = task.line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const w = J.width(lines[i]);
      if (w <= task.indent) break;
      if (w === indent && AI_RECORD_RE.test(lines[i])) records.push(i);
    }
    if (!records.length) continue;
    const tracked = task.blockId?.startsWith("ad-") || trackedIds.has(task.blockId) || task.body.startsWith("🤖") || records.some((i) => J.parseLink(lines[i]));
    if (tracked) out.push({ key: task.blockId || `${task.line}:${task.key}`, records });
  }
  return out;
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
