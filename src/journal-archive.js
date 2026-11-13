import * as J from './journal.js';
import { t } from "./i18n.js";

export function archivePath(value) {
  const path = String(value || '').trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(x => !x || x === '.' || x === '..') || !path.endsWith('.md')) throw new Error(t('归档位置必须是库内的 .md 文件路径'));
  return path;
}

export function appendArchive(text, date, blocks, turns = new Map()) {
  const lines = text.split('\n');
  const dateStart = lines.indexOf(`## ${date}`);
  let dateEnd = dateStart + 1;
  while (dateEnd < lines.length && !/^#{1,2}\s/.test(lines[dateEnd])) dateEnd++;
  const dateText = dateStart < 0 ? '' : lines.slice(dateStart, dateEnd).join('\n') + '\n';
  const pending = blocks.filter(block => {
    const id = J.blockIdOf(block.split('\n')[0]);
    const task = id && J.findTaskByBlockId(text, id);
    if (!task) return !dateText.includes(block + '\n');
    let end = task.line + 1;
    while (end < lines.length && (!lines[end].trim() || J.width(lines[end]) > task.indent)) end++;
    if (lines.slice(task.line, end).join('\n').trimEnd() !== block.trimEnd()) throw new Error(t('归档中已有同编号但内容不同的任务，已保留原日记，请先核对'));
    return false;
  });
  if (!pending.length) return text;
  const heading = `## ${date}`;
  let at = lines.indexOf(heading);
  if (at < 0) { while (lines.length && !lines.at(-1).trim()) lines.pop(); lines.push('', heading); at = lines.length; }
  else { at++; while (at < lines.length && !/^#{1,2}\s/.test(lines[at])) at++; }
  while (at > 0 && !lines[at - 1].trim()) lines.splice(--at, 1);
  lines.splice(at, 0, '', ...pending.join('\n').split('\n'), '');
  const start = lines.indexOf(heading) + 1;
  let end = start;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  const section = lines.slice(start, end), selected = [], chunks = [];
  let fence = "";
  for (let n = 0; n < section.length; n++) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(section[n]);
    if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = ""; continue; }
    if (fence || !/^(?:[-*+]|\d+[.)])\s/.test(section[n])) continue;
    const task = J.kwLine(section[n]);
    if (!task || !J.DONE_KWS.includes(task.kw)) continue;
    let last = n + 1;
    while (last < section.length && (!section[last].trim() || J.width(section[last]) > 0)) last++;
    const block = section.slice(n, last).join("\n").trimEnd();
    const rounds = Math.max(0, ...[...block.matchAll(/(?:💬|❓)\s*第(\d+)轮[：:]/g)].map(m => +m[1]));
    chunks.push({ text: block, turns: Math.max(turns.get(task.blockId) || 0, rounds) });
    selected.push([n, last]); n = last - 1;
  }
  chunks.sort((a, b) => b.turns - a.turns);
  const notes = section.filter((_, n) => !selected.some(([a, b]) => n >= a && n < b));
  while (notes.length && !notes.at(-1).trim()) notes.pop();
  lines.splice(start, end - start, ...notes, "", ...chunks.map(c => c.text).join("\n").split("\n"), "");
  return lines.join('\n').replace(/\n*$/, '\n');
}

// Write the archive first. If either note changes, keep the source rather than lose context.
export async function archiveCompletedJournal(plugin, file, base, result) {
  const path = archivePath(plugin.settings.doneArchivePath);
  if (path === file.path) throw new Error(t('归档文件不能与当前日记相同'));
  const match = /^(\d{4})[-_](\d{2})[-_](\d{2})/.exec(file.basename);
  const date = match ? match.slice(1).join('-') : file.basename;
  let target = plugin.app.vault.getAbstractFileByPath(path);
  const before = target ? await plugin.readNote(path) : '# 已完成的 AI 任务\n';
  const turns = new Map(Object.entries(plugin.settings.archiveTaskTurns || {}));
  for (const entry of result.entries || []) { const id = J.blockIdOf(entry.text.split("\n")[0]); if (id) turns.set(id, entry.turns); }
  const after = appendArchive(before, date, result.blocks, turns);
  if (target) {
    if (after !== before && !await plugin.autoLog.write(target, before, after)) throw new Error(t('归档文件刚有变化，请重试；原日记保留'));
  } else {
    const parts = path.split('/'); parts.pop(); let folder = '';
    for (const part of parts) { folder = folder ? folder + '/' + part : part; if (!plugin.app.vault.getAbstractFileByPath(folder)) await plugin.app.vault.createFolder(folder); }
    target = await plugin.app.vault.create(path, after);
  }
  if (!await plugin.autoLog.write(file, base, result.remaining)) throw new Error(t('日记刚有变化，归档副本已保存，原日记保留；重试不会重复归档'));
  plugin.settings.archiveTaskTurns = Object.fromEntries(turns);
  await plugin.saveSettings?.();
  return target;
}
