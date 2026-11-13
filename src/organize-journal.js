import * as J from './journal.js';

// Move whole AI task blocks; fenced examples and manual tasks stay in place.
export function organizeAIJournal(text, mode, { tracked = new Map(), archived = new Set(), turns = new Map() } = {}) {
  const lines = text.split('\n'), code = new Set();
  let fence = '', size = 0;
  lines.forEach((line, n) => {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence || m) code.add(n);
    if (m && !fence) { fence = m[1][0]; size = m[1].length; }
    else if (m && m[1][0] === fence && m[1].length >= size && !m[2].trim()) fence = '';
  });
  const moved = [], entries = [];
  for (const task of J.taskItems(text)) {
    if (code.has(task.line) || moved.some(b => task.line < b.end)) continue;
    let end = task.line + 1;
    while (end < lines.length && (!lines[end].trim() || J.width(lines[end]) > task.indent)) end++;
    const sids = new Set(tracked.get(task.blockId) || []);
    for (let n = task.line + 1; n < end; n++) {
      if (J.markOwner(lines, n) === task.line) { const link = J.parseLink(lines[n]); if (link) sids.add(link.sid); }
    }
    if (!(sids.size || task.blockId?.startsWith('ad-') || tracked.has(task.blockId) || task.body.startsWith('🤖'))) continue;
    const archivedDone = task.state !== "done" && sids.size > 0 && [...sids].every(s => archived.has(s));
    const done = task.state === 'done' || archivedDone;
    if ((mode === 'done') !== done) continue;
    const chunk = lines.slice(task.line, end);
    while (chunk.length && !chunk.at(-1).trim()) chunk.pop();
    if (archivedDone && task.kw !== 'DONE') {
      const p = J.splitTask(chunk[0]);
      chunk[0] = `${p.prefix}DONE ${p.since ? p.since + ' ' : ''}${p.rest}`;
    }
    const indent = /^\s*/.exec(chunk[0])[0];
    const block = chunk.map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');
    const round = Math.max(0, ...[...block.matchAll(/(?:💬|❓)\s*第(\d+)轮[：:]/g)].map(m => +m[1]));
    const count = Math.max(turns.get(task.blockId) || 0, [...sids].reduce((n, sid) => n + (turns.get(sid) || 0), 0), round);
    entries.push({ text: block, keyword: task.kw || "TODO", turns: count });
    moved.push({ start: task.line, end });
  }
  if (!entries.length) return { text, remaining: text, blocks: [], count: 0 };
  const order = ["DOING", "NOW", "IN-PROGRESS", "DELEGATED", "NEEDOK", "TOREVIEW", "PAUSED", "SUSPENDED", "WAITING", "WAIT", "QUEUED", "HITLIMIT", "ERRORED", "TODO", "LATER"];
  const rank = kw => order.includes(kw) ? order.indexOf(kw) : order.length;
  entries.sort((a, b) => (mode === "done" ? 0 : rank(a.keyword) - rank(b.keyword)) || b.turns - a.turns);
  const blocks = entries.map(e => e.text);
  const rest = [], protectedLines = new Set();
  lines.forEach((line, n) => {
    if (moved.some(b => n >= b.start && n < b.end)) return;
    if (code.has(n)) protectedLines.add(rest.length);
    rest.push(line);
  });
  const remaining = rest.join("\n").replace(/\n*$/, "\n");
  const heading = mode === 'done' ? '## AI · 已完成' : '## AI · 进行中';
  let at = rest.findIndex((line, n) => line === heading && !protectedLines.has(n));
  if (at < 0) { while (rest.length && !rest.at(-1).trim()) rest.pop(); rest.push('', heading, ''); at = rest.length; }
  else { at++; while (at < rest.length && (protectedLines.has(at) || !/^#{1,2}\s/.test(rest[at]))) at++; }
  while (at > 0 && !rest[at - 1].trim()) { rest.splice(--at, 1); }
  // Remove only empty generated status headings before rebuilding the active region.
  if (mode !== "done") {
    const start = rest.indexOf(heading) + 1;
    for (let n = at - 1; n >= start; n--) {
      if (/^### [A-Z-]+$/.test(rest[n]) && order.includes(rest[n].slice(4)) && rest.slice(n + 1, at).every(line => !line.trim() || /^### [A-Z-]+$/.test(line))) { rest.splice(n, 1); at--; }
    }
  }
  while (at > 0 && !rest[at - 1].trim()) rest.splice(--at, 1);
  const body = [];
  let previous = "";
  for (const entry of entries) {
    if (mode !== "done" && entry.keyword !== previous) { body.push(`### ${entry.keyword}`, ""); previous = entry.keyword; }
    body.push(entry.text);
  }
  rest.splice(at, 0, '', ...body.join('\n').split('\n'), '');
  const next = rest.join('\n').replace(/\n*$/, '\n');
  return { text: next, remaining, blocks, entries, count: blocks.length };
}
