// AI 记录右键菜单的纯逻辑：行解析、母任务定位、置顶分区。
// 与 Obsidian 的 Menu/Editor 解耦，方便单测；菜单本身仍在 main.js 里组装。
import * as J from "./journal.js";

export const RECORD_MENU_SECTION = "agent-deck-record";

// Obsidian 的编辑器菜单先加默认项、再触发 editor-menu 事件，
// 所以把自定义分区插到 sections 最前面，Pin 才会真的排在第一位。
export function createRecordMenuSection(menu, section = RECORD_MENU_SECTION) {
  const sections = menu?.sections;
  if (!Array.isArray(sections) || typeof sections.unshift !== "function") return false;
  const at = sections.indexOf(section);
  if (at > 0) sections.splice(at, 1);
  if (at !== 0) sections.unshift(section);
  return true;
}

export function parentTimelineLine(lines, line) {
  const width = (text) => J.width(text || "");
  const target = width(lines[line]);
  for (let i = line - 1; i >= 0; i--) {
    const text = lines[i];
    if (!text.trim()) continue;
    if (width(text) < target && /^\s*(?:[-*+]|\d+[.)])\s+/.test(text)) return i;
  }
  return -1;
}

export function recordCopyText(line, mode = "all") {
  const text = String(line || "")
    .replace(/\s*<!--[\s\S]*?-->/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .trim();
  if (mode !== "conclusion") return text;
  const conclusion = text.match(/结论[：:]\s*([\s\S]*)$/)?.[1];
  return (conclusion || text).trim();
}

export function recordDeleteRange(lines, line) {
  if (!Array.isArray(lines) || line < 0 || line >= lines.length) return null;
  if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[line])) return null;
  const indent = J.width(lines[line]);
  let end = line;
  for (let i = line + 1; i < lines.length; i++) {
    const text = lines[i];
    if (!text.trim()) { end = i; continue; }
    if (J.width(text) <= indent) break;
    end = i;
  }
  const from = { line, ch: 0 };
  const to = end + 1 < lines.length
    ? { line: end + 1, ch: 0 }
    : { line: end, ch: (lines[end] || "").length };
  return { from, to };
}
