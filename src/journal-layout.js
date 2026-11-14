import { fencedLines } from './journal.js';
import { t, currentLanguage } from './i18n.js';

export const JOURNAL_LAYOUT_DEFAULT = { order: ['done', 'active', 'notes'], titles: { done: '已完成', active: '进行中', notes: '' } };
const START = '<!-- agent-deck:layout:start -->';
const END = '<!-- agent-deck:layout:end -->';
const KEYS = JOURNAL_LAYOUT_DEFAULT.order;

export function builtinJournalLayout(language = currentLanguage()) {
  return { order: [...KEYS], titles: language === 'en' ? { done: 'Completed', active: 'In progress', notes: '' } : { ...JOURNAL_LAYOUT_DEFAULT.titles } };
}

export function configuredJournalLayout(settings = {}) {
  if (settings.journalLayout) return journalLayout(settings.journalLayout);
  const language = settings.journalLayoutLanguage && settings.journalLayoutLanguage !== 'auto' ? settings.journalLayoutLanguage : currentLanguage();
  return language === 'en' ? builtinJournalLayout('en') : null;
}

export function journalLayout(value) {
  const order = value?.order;
  if (!Array.isArray(order) || order.length !== 3 || new Set(order).size !== 3 || order.some(key => !KEYS.includes(key))) throw new Error(t('整理模板必须包含已完成、进行中和手写内容三个分区。'));
  const titles = {};
  for (const key of KEYS) {
    const title = String(value.titles?.[key] ?? JOURNAL_LAYOUT_DEFAULT.titles[key]).trim();
    if (title.length > 60 || /[\r\n<>]/.test(title) || (key !== 'notes' && !title)) throw new Error(t('分区标题请填 1–60 字的单行文字；手写内容标题可以留空。'));
    titles[key] = title;
  }
  return { order: [...order], titles };
}

// Stable, invisible boundaries let a template change without mistaking a user
// heading or code example for a generated section.
export function readJournalLayout(text) {
  if (!String(text).includes('<!-- agent-deck:')) return null;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const fences = fencedLines(lines);
  const markers = lines.flatMap((line, i) => !fences.has(i) && (line === START || line === END || /^<!-- agent-deck:section:/.test(line)) ? [{ line, i }] : []);
  if (!markers.length) return null;
  const invalid = () => { throw new Error(t('整理模板的分区标记不完整，请先修复标记；原文未修改。')); };
  if (markers.length !== 8 || markers[0].line !== START || markers.at(-1).line !== END) invalid();
  const sections = {}, order = [], titles = {}, headingRows = new Set();
  for (let n = 1; n < 7; n += 2) {
    const open = markers[n], close = markers[n + 1];
    const match = /^<!-- agent-deck:section:(done|active|notes):(heading|plain) -->$/.exec(open.line);
    if (!match || sections[match[1]] || close.line !== `<!-- agent-deck:section:${match[1]}:end -->`) invalid();
    const [, key, kind] = match;
    const start = open.i + 1 + (kind === 'heading' ? 1 : 0);
    if (kind === 'heading' && !/^## .+/.test(lines[open.i + 1] || '')) invalid();
    if (kind === 'heading') headingRows.add(open.i + 1);
    titles[key] = kind === 'heading' ? lines[open.i + 1].slice(3) : '';
    sections[key] = { text: lines.slice(start, close.i).join('\n'), start, end: close.i };
    order.push(key);
  }
  // Anything between sections must be the spacing/rules we wrote. Unexpected
  // text is never silently discarded by a later organize.
  const owned = new Set();
  for (const section of Object.values(sections)) for (let i = section.start; i < section.end; i++) owned.add(i);
  for (let i = markers[0].i + 1; i < markers.at(-1).i; i++) {
    if (owned.has(i) || markers.some(m => m.i === i) || headingRows.has(i)) continue;
    if (lines[i].trim() && lines[i] !== '---') invalid();
  }
  return { head: lines.slice(0, markers[0].i).join('\n').trimEnd(), tail: lines.slice(markers.at(-1).i + 1).join('\n').trim(), sections, layout: { order, titles } };
}

export function renderJournalLayout({ head, done, active, notes, tail = '' }, value) {
  const layout = journalLayout(value);
  const content = { done, active, notes };
  const bands = layout.order.map(key => {
    const title = layout.titles[key];
    return [`<!-- agent-deck:section:${key}:${title ? 'heading' : 'plain'} -->`, ...(title ? [`## ${title}`] : []), content[key].replace(/\n*$/, ''), `<!-- agent-deck:section:${key}:end -->`].filter((line, i) => line || i !== (title ? 2 : 1)).join('\n');
  });
  return [head.trimEnd(), `${START}\n${bands.join('\n\n---\n\n')}\n${END}`, tail].filter(Boolean).join('\n\n').replace(/\n*$/, '\n');
}
