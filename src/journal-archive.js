import * as J from './journal.js';
import { t } from "./i18n.js";
import { renderJournal, roundsIn, squeezeBlank } from "./organize-journal.js";

const ARCHIVE_TITLE = '# 已完成的 AI 任务';

export function archivePath(value) {
  const path = String(value || '').trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(x => !x || x === '.' || x === '..') || !path.endsWith('.md')) throw new Error(t('归档位置必须是库内的 .md 文件路径'));
  return path;
}

// The archive groups by the source journal's date, taken from its file name.
export function archiveDate(file) {
  const name = String(file?.basename || file?.path || '');
  const m = /^(\d{4})[-_](\d{2})[-_](\d{2})/.exec(name);
  return m ? m.slice(1).join('-') : name;
}

// Split a section body back into task blocks so they can be de-duplicated,
// re-sorted and merged. Text that is not a list task is kept as its own chunk.
function splitArchiveBlocks(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const k = J.LIST_RE.test(lines[i]) ? J.kwLine(lines[i]) : null;
    const indent = J.width(lines[i]);
    let end = i + 1;
    if (k) while (end < lines.length && (!lines[end].trim() || J.width(lines[end]) > indent)) end++;
    const chunk = lines.slice(i, end);
    while (chunk.length && !chunk.at(-1).trim()) chunk.pop();
    if (chunk.length) out.push({ text: chunk.join('\n'), blockId: J.blockIdOf(chunk[0]) });
    i = end - 1;
  }
  return out;
}

const DATE_HEAD_RE = /^##\s+\d{4}-\d{2}-\d{2}\s*$/;
const H2_RE = /^#{1,2}\s/;

function parseArchive(text) {
  const lines = String(text || '').split('\n');
  const fence = J.fencedLines(lines);
  const heads = [];
  // A "## 2026-01-01" inside a code sample is content, not a section.
  lines.forEach((line, i) => { if (!fence.has(i) && DATE_HEAD_RE.test(line)) heads.push(i); });
  const title = (lines.slice(0, heads.length ? heads[0] : lines.length).join('\n').trim()) || ARCHIVE_TITLE;
  const sections = [];
  for (let idx = 0; idx < heads.length; idx++) {
    const start = heads[idx];
    const nextHead = idx + 1 < heads.length ? heads[idx + 1] : lines.length;
    // The user's own H2 closes this date section. Their text is kept verbatim,
    // in place, and never sorted with the task blocks.
    let end = start + 1;
    while (end < nextHead && !(H2_RE.test(lines[end]) && !fence.has(end))) end++;
    sections.push({ name: lines[start].replace(/^##\s+/, '').trim(), blocks: splitArchiveBlocks(lines.slice(start + 1, end).join('\n')) });
    if (end < nextHead) sections.push({ raw: lines.slice(end, nextHead).join('\n') });
  }
  return { title, sections };
}

function renderArchive({ title, sections }) {
  const parts = [title.trim()];
  for (const section of sections) {
    if (section.raw) { if (section.raw.trim()) parts.push(section.raw.trim()); continue; }
    if (!section.blocks.length) continue;
    parts.push([`## ${section.name}`, '', section.blocks.map((b) => b.text).join('\n')].join('\n'));
  }
  return squeezeBlank(parts.join('\n\n')).replace(/\n*$/, '\n');
}

// Merge finished blocks into the dated section of an archive note.
// `prepend` decides where a brand-new date section goes; an existing date
// section keeps its place so repeated runs never reorder the file.
export function mergeArchive(text, { date, blocks = [], turns = new Map(), prepend = true } = {}) {
  const src = String(text || '');
  const crlf = /\r\n/.test(src);
  const archive = parseArchive(src.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const incoming = blocks.map((raw) => {
    const body = String(raw).replace(/\s+$/, '');
    return { text: body, blockId: J.blockIdOf(body.split('\n')[0]) };
  });
  let section = archive.sections.find((s) => !s.raw && s.name === date);
  if (!section) {
    section = { name: date, blocks: [] };
    if (prepend) archive.sections.unshift(section);
    else archive.sections.push(section);
  }
  for (const block of incoming) {
    const same = section.blocks.find((b) => (block.blockId ? b.blockId === block.blockId : b.text.trim() === block.text.trim()));
    if (!same) { section.blocks.push(block); continue; }
    if (same.text.trim() !== block.text.trim()) throw new Error(t('归档中已有同编号但内容不同的任务，已保留原日记，请先核对'));
  }
  const turnOf = (b) => Math.max(turns.get(b.blockId) || 0, roundsIn(b.text));
  section.blocks = section.blocks.map((b, i) => ({ b, i }))
    .sort((x, y) => turnOf(y.b) - turnOf(x.b) || x.i - y.i)
    .map(({ b }) => b);
  const out = renderArchive(archive);
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

async function ensureFolders(vault, path) {
  const parts = path.split('/');
  parts.pop();
  let folder = '';
  for (const part of parts) {
    folder = folder ? `${folder}/${part}` : part;
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
  }
}

// Move the finished AI blocks out of the journal into an archive note.
// The archive is written first: if anything else changed in between, the
// journal keeps its content instead of losing context.
export async function archiveCompletedTo(plugin, file, base, plan, { path, order = 'prepend' } = {}) {
  const targetPath = archivePath(path);
  if (targetPath === file.path) throw new Error(t('归档文件不能与当前日记相同'));
  const blocks = (plan.done || []).filter((entry) => entry.ai);
  if (!blocks.length) throw new Error(t('没有可归档的 AI 任务'));

  const date = archiveDate(file);
  const turns = new Map(Object.entries(plugin.settings.archiveTaskTurns || {}));
  for (const entry of blocks) if (entry.blockId) turns.set(entry.blockId, entry.turns);

  const existing = plugin.app.vault.getAbstractFileByPath(targetPath);
  const before = existing ? await plugin.readNote(targetPath) : '';
  const after = mergeArchive(before, { date, blocks: blocks.map((b) => b.text), turns, prepend: order !== 'append' });

  let target = existing;
  if (target) {
    if (after !== before && !await plugin.autoLog.write(target, before, after)) throw new Error(t('归档文件刚有变化，请重试；原日记保留'));
  } else {
    await ensureFolders(plugin.app.vault, targetPath);
    target = await plugin.app.vault.create(targetPath, after);
  }

  // By block id when there is one: two blocks can read the same.
  const skip = new Set(blocks.map((b) => b.blockId || b.text));
  const next = renderJournal(plan, { skip });
  if (next !== base && !await plugin.autoLog.write(file, base, next)) throw new Error(t('日记刚有变化，归档副本已保存，原日记保留；重试不会重复归档'));

  plugin.settings.archiveTaskTurns = Object.fromEntries(turns);
  plugin.settings.doneArchivePath = targetPath;
  await plugin.saveSettings?.();
  return { target, moved: blocks.length };
}
