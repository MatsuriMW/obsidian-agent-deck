// 回复信箱的纯逻辑：谁还没答、怎么去重、怎么排序、怎么核对。
// 存的是"注册表"（settings.replyInbox），渲染前回笔记核对一遍，旧条目不会永久赖着。
import { blockIdOf } from "./journal.js";
import { parseThread, pendingQuestion } from "./thread-replies.js";

export const inboxKey = (item = {}) => `${item.path || ""}#${item.questionId || item.question || ""}`;

export function inboxAdd(list = [], item = {}) {
  if (!item?.path || !item?.question) return list || [];
  const key = inboxKey(item);
  const rest = (list || []).filter((x) => inboxKey(x) !== key);
  return [{ ...item, at: Number(item.at) || Date.now() }, ...rest];
}

export const inboxRemove = (list = [], item = {}) => (list || []).filter((x) => inboxKey(x) !== inboxKey(item));

// 新的在前。
export const inboxSorted = (list = []) => [...(list || [])].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));

const widthOf = (line) => ((/^[ \t]*/.exec(line) || [""])[0]).replace(/\t/g, "    ").length;

// 块的范围：从锚点行到下一个同级列表项之前。
function blockRange(lines, blockId) {
  const start = blockId ? lines.findIndex((l) => blockIdOf(l) === blockId) : -1;
  if (start < 0) return null;
  const base = widthOf(lines[start]);
  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (widthOf(lines[i]) <= base && /^\s*[-*+]\s+/.test(lines[i])) { end = i - 1; break; }
  }
  return { start, end };
}

// 渲染前核对：笔记里这一问是不是还没答（删了 / 改了 / 已答 → 返回 false）。
export function stillPending(noteText = "", item = {}) {
  const lines = String(noteText || "").split("\n");
  let range = item.blockId ? blockRange(lines, item.blockId) : null;
  if (!range) range = { start: 0, end: lines.length - 1 };
  const open = pendingQuestion(parseThread(lines, range));
  if (!open) return false;
  if (item.questionId && open.id) return open.id === item.questionId;
  return open.text === String(item.question || "").trim();
}
