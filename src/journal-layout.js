import { fencedLines } from './journal.js';
import { t, currentLanguage } from './i18n.js';

export const JOURNAL_LAYOUT_DEFAULT = { order: ['active', 'todo', 'done'], titles: { active: '正在做', todo: '还要做', done: '已完成' } };
const START = '<!-- agent-deck:layout:start -->';
const END = '<!-- agent-deck:layout:end -->';
const KEYS = JOURNAL_LAYOUT_DEFAULT.order;
const MARKER_TOKEN_RE = /(<!-- agent-deck:(?:layout:(?:start|end)|section:(?:done|active|todo|notes):(?:heading|plain|end)) -->)/g;
const SECTION_OPEN_RE = /^<!-- agent-deck:section:(done|active|todo|notes):(heading|plain) -->$/;

export function builtinJournalLayout(language = currentLanguage()) {
  return { order: [...KEYS], titles: language === 'en' ? { active: 'In progress', todo: 'To do', done: 'Completed' } : { ...JOURNAL_LAYOUT_DEFAULT.titles } };
}

export function configuredJournalLayout(settings = {}) {
  if (settings.journalLayout) {
    const layout = journalLayout(settings.journalLayout);
    if (!layout.order.includes('notes')) return layout;
    const defaults = builtinJournalLayout(settings.journalLayoutLanguage === 'auto' ? currentLanguage() : settings.journalLayoutLanguage);
    return { order: layout.order.map(key => key === 'notes' ? 'todo' : key), titles: { active: layout.titles.active, done: layout.titles.done, todo: defaults.titles.todo } };
  }
  const language = settings.journalLayoutLanguage && settings.journalLayoutLanguage !== 'auto' ? settings.journalLayoutLanguage : currentLanguage();
  return builtinJournalLayout(language);
}

// 分区标记被删掉一半时，按「缺哪个补哪个」修回去；修不好的返回 null，绝不猜内容归属。
// 只补外框和缺失的分区开标记，不动任何正文行。
// 标记烂到补不回来时，去掉所有标记交给整理重建分区（正文一行不删，条目按关键字归区）。
export function stripJournalLayout(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .filter((line) => !/^<!-- agent-deck:(?:layout:(?:start|end)|section:(?:done|active|todo|notes):(?:heading|plain|end)) -->$/.test(line.trim()))
    .map((line) => (/^\s*[-*+]\s+---\s*$/.test(line) ? '---' : line))
    .join('\n');
}

export function repairJournalLayout(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  if (!normalized.includes('<!-- agent-deck:')) return null;
  const lines = normalized.split('\n');
  const markerRe = /^<!-- agent-deck:(?:layout:(?:start|end)|section:(?:done|active|todo|notes):(?:heading|plain|end)) -->$/;
  const isMarker = (line) => markerRe.test(String(line).trim());
  const markerIdx = () => lines.map((line, i) => (isMarker(line) ? i : -1)).filter((i) => i >= 0);
  if (!markerIdx().length) return null;

  // 1) 外框：开头缺 layout:start 就补在最前面的分区标记之前，结尾缺 layout:end 就补在最后面。
  let idx = markerIdx();
  if (lines[idx[0]].trim() !== START) lines.splice(idx[0], 0, START);
  idx = markerIdx();
  if (lines[idx[idx.length - 1]].trim() !== END) lines.splice(idx[idx.length - 1] + 1, 0, END);

  // 2) 分区标记：有 end 没 heading/plain 的补开标记；有开标记没 end 的补结束标记。
  for (const key of ['active', 'todo', 'done', 'notes']) {
    const endLine = `<!-- agent-deck:section:${key}:end -->`;
    const headingLine = `<!-- agent-deck:section:${key}:heading -->`;
    const plainLine = `<!-- agent-deck:section:${key}:plain -->`;
    const endAt = lines.findIndex((line) => line.trim() === endLine);
    const openAt = lines.findIndex((line) => line.trim() === headingLine || line.trim() === plainLine);
    if (endAt < 0 && openAt < 0) continue;
    if (endAt >= 0 && openAt < 0) {
      let insertAt = 0;
      for (let i = 0; i < endAt; i++) {
        const v = lines[i].trim();
        if (v === START || /^<!-- agent-deck:section:[a-z]+:end -->$/.test(v)) insertAt = i + 1;
      }
      lines.splice(insertAt, 0, headingLine);
      continue;
    }
    if (openAt >= 0 && endAt < 0) {
      let insertAt = lines.length;
      for (let i = openAt + 1; i < lines.length; i++) {
        const v = lines[i].trim();
        if (v === END || /^<!-- agent-deck:section:[a-z]+:(?:heading|plain) -->$/.test(v)) { insertAt = i; break; }
      }
      lines.splice(insertAt, 0, endLine);
    }
  }

  // 3) 分区之间被写成列表项的「- ---」还原成单独的分割线。
  idx = markerIdx();
  for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (/^\s*[-*+]\s+---\s*$/.test(lines[i])) lines[i] = '---';

  const out = lines.join('\n');
  try { readJournalLayout(out); } catch { return null; }
  return out;
}

export function journalLayout(value) {
  const order = value?.order;
  const keys = order?.includes('notes') ? ['done', 'active', 'notes'] : KEYS;
  if (!Array.isArray(order) || order.length !== 3 || new Set(order).size !== 3 || order.some(key => !keys.includes(key))) throw new Error(t('整理模板必须包含正在做、还要做和已完成三个分区。'));
  const titles = {};
  for (const key of keys) {
    const title = String(value.titles?.[key] ?? JOURNAL_LAYOUT_DEFAULT.titles[key] ?? '').trim();
    if (title.length > 60 || /[\r\n<>]/.test(title) || (key !== 'notes' && !title)) throw new Error(t('分区标题请填 1–60 字的单行文字。'));
    titles[key] = title;
  }
  return { order: [...order], titles };
}

// Stable, invisible boundaries let a template change without mistaking a user
// heading or code example for a generated section.
export function readJournalLayout(text) {
  if (!String(text).includes('<!-- agent-deck:')) return null;
  const normalized = String(text).replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const rawFences = fencedLines(rawLines);
  // 实时预览里分区注释是隐藏的，用户退格或同行续写时容易把注释粘到前后文字上；
  // 拆分非代码块行里的内联标记，同时保留原文本切片偏移。
  const vLines = [];
  let pos = 0;
  for (let r = 0; r < rawLines.length; r++) {
    const raw = rawLines[r];
    MARKER_TOKEN_RE.lastIndex = 0;
    if (!rawFences.has(r) && MARKER_TOKEN_RE.test(raw)) {
      MARKER_TOKEN_RE.lastIndex = 0;
      let cursor = 0, match;
      while ((match = MARKER_TOKEN_RE.exec(raw))) {
        const before = raw.slice(cursor, match.index);
        if (before.trim()) vLines.push({ text: before, startOffset: pos + cursor, endOffset: pos + match.index, rawLine: r, fenced: false });
        vLines.push({ text: match[1], startOffset: pos + match.index, endOffset: pos + match.index + match[1].length, rawLine: r, fenced: false });
        cursor = match.index + match[1].length;
      }
      const after = raw.slice(cursor);
      if (after.trim()) vLines.push({ text: after, startOffset: pos + cursor, endOffset: pos + raw.length, rawLine: r, fenced: false });
    } else {
      vLines.push({ text: raw, startOffset: pos, endOffset: pos + raw.length, rawLine: r, fenced: rawFences.has(r) });
    }
    pos += raw.length + 1;
  }
  const markers = vLines.flatMap((v, i) => !v.fenced && (v.text === START || v.text === END || /^<!-- agent-deck:section:/.test(v.text)) ? [{ line: v.text, i }] : []);
  if (!markers.length) return null;
  const invalid = () => { throw new Error(t('整理模板的分区标记不完整，请先修复标记；原文未修改。')); };
  const hasStart = markers[0].line === START;
  const hasEnd = markers.length > 1 && markers.at(-1).line === END;
  const inner = markers.slice(hasStart ? 1 : 0, hasEnd ? -1 : undefined);
  // 只要三个完整分区的起止标记都在，允许外框 layout:start / layout:end 被误删后按分割线恢复。
  if (inner.length !== 6 || inner.some(m => m.line === START || m.line === END)) invalid();
  const markerIndices = new Set(markers.map(m => m.i));
  const sections = {}, order = [], titles = {}, headingRows = new Set(), owned = new Set();
  for (let n = 0; n < 6; n += 2) {
    const open = inner[n], close = inner[n + 1];
    const match = SECTION_OPEN_RE.exec(open.line);
    if (!match || sections[match[1]] || close.line !== `<!-- agent-deck:section:${match[1]}:end -->`) invalid();
    const [, key, kind] = match;
    let headingRow = -1;
    if (kind === 'heading') {
      for (let i = open.i + 1; i < close.i; i++) {
        if (!vLines[i].fenced && /^## .+/.test(vLines[i].text)) { headingRow = i; break; }
      }
      if (headingRow >= 0) {
        headingRows.add(headingRow);
        titles[key] = vLines[headingRow].text.slice(3).trim();
      } else {
        titles[key] = builtinJournalLayout().titles[key] || JOURNAL_LAYOUT_DEFAULT.titles[key] || '';
        if (!titles[key]) invalid();
      }
    } else {
      titles[key] = '';
    }
    for (let i = open.i + 1; i < close.i; i++) owned.add(i);
    const beforeHeading = headingRow > open.i + 1 ? vLines.slice(open.i + 1, headingRow).map(v => v.text).filter(line => line.trim()) : [];
    const afterHeading = vLines.slice(headingRow >= 0 ? headingRow + 1 : open.i + 1, close.i).map(v => v.text);
    const bodyLines = beforeHeading.length ? [...beforeHeading, ...afterHeading] : afterHeading;
    const startV = headingRow >= 0 ? headingRow + 1 : open.i + 1;
    sections[key] = { text: bodyLines.join('\n'), start: vLines[Math.min(startV, close.i)].rawLine, end: vLines[close.i].rawLine };
    order.push(key);
  }
  const checkFrom = hasStart ? markers[0].i + 1 : inner[0].i;
  const checkTo = hasEnd ? markers.at(-1).i : inner[5].i;
  // Anything between sections must be the spacing/rules we wrote. Unexpected
  // text is never silently discarded by a later organize.
  for (let i = checkFrom; i < checkTo; i++) {
    if (owned.has(i) || markerIndices.has(i) || headingRows.has(i)) continue;
    if (vLines[i].text.trim() && vLines[i].text.trim() !== '---') invalid();
  }
  if (!sections.done || !sections.active || !(sections.todo || sections.notes) || (sections.todo && sections.notes)) invalid();
  let openAt = hasStart ? markers[0].i : inner[0].i;
  if (!hasStart) {
    let k = openAt - 1;
    while (k >= 0 && !vLines[k].text.trim()) k--;
    if (k >= 0 && !vLines[k].fenced && vLines[k].text.trim() === '---') openAt = k;
  }
  let closeAt = hasEnd ? markers.at(-1).i : inner[5].i;
  if (!hasEnd) {
    let k = closeAt + 1;
    while (k < vLines.length && !vLines[k].text.trim()) k++;
    if (k < vLines.length && !vLines[k].fenced && vLines[k].text.trim() === '---') closeAt = k;
  }
  const rawHead = normalized.slice(0, vLines[openAt].startOffset);
  const rawTail = normalized.slice(vLines[closeAt].endOffset);
  return { rawHead, rawTail, head: rawHead.trimEnd(), tail: rawTail.trim(), sections, layout: { order, titles } };
}

export function renderJournalLayout({ head, done, active, todo = '', notes = '', tail = '' }, value) {
  const layout = journalLayout(value);
  const content = { done, active, todo, notes };
  const bands = layout.order.map(key => {
    const title = layout.titles[key];
    return [`<!-- agent-deck:section:${key}:${title ? 'heading' : 'plain'} -->`, ...(title ? [`## ${title}`] : []), content[key].replace(/\n*$/, ''), `<!-- agent-deck:section:${key}:end -->`].filter((line, i) => line || i !== (title ? 2 : 1)).join('\n');
  });
  if (layout.order.includes('todo')) return head + `${START}\n\n---\n${bands.join('\n\n---\n')}\n\n---\n${END}` + tail;
  return [head.trimEnd(), `${START}\n${bands.join('\n\n---\n\n')}\n${END}`, tail].filter(Boolean).join('\n\n').replace(/\n*$/, '\n');
}
