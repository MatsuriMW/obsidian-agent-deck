import * as J from './journal.js';
import { readJournalLayout, renderJournalLayout } from './journal-layout.js';

// Journal layout
//
// The journal is rebuilt into three bands, top to bottom:
//
//   ## AI · 已完成      every finished task block, AI or hand-written
//   ---
//   ## AI · 进行中      unfinished AI blocks, grouped by keyword and sorted
//   ---
//   <everything else>   the user's own notes, original order
//
// Blocks are moved, never rewritten. Code fences, front matter and anything
// that is not a list task stay where they are. The old generated headings and
// the separators this function writes are stripped first, so running it twice
// produces the same file.

export const DONE_HEADING = '## 已完成';
export const ACTIVE_HEADING = '## 进行中';
// 1.7.0 wrote these; old journals are migrated by stripping them too.
export const LEGACY_HEADINGS = ['## AI · 已完成', '## AI · 进行中'];

const H2_RE = /^#{1,2}\s/;
const SUBHEAD_RE = /^###\s+[A-Z][A-Z-]*\s*$/;
const ORDER = ["DOING", "NOW", "IN-PROGRESS", "DELEGATED", "NEEDOK", "TOREVIEW", "PAUSED", "SUSPENDED", "WAITING", "WAIT", "QUEUED", "HITLIMIT", "ERRORED", "TODO", "LATER"];

const rank = (kw) => (ORDER.includes(kw) ? ORDER.indexOf(kw) : ORDER.length);
const isRule = (line) => /^\s*---+\s*$/.test(line);

// Obsidian front matter: --- key: value --- at the very top.
function splitFrontMatter(lines) {
  if ((lines[0] || '').trim() !== '---') return { head: [], start: 0 };
  // No line cap: a note with a large properties block is still front matter. The
  // key: value probe below is what tells a properties block apart from a rule.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() !== '---') continue;
    const body = lines.slice(1, i);
    if (body.some((line) => /^[\w-]+\s*:/.test(line))) return { head: lines.slice(0, i + 1), start: i + 1 };
    return { head: [], start: 0 };
  }
  return { head: [], start: 0 };
}

function blockText(lines, start, end) {
  const chunk = lines.slice(start, end);
  while (chunk.length && !chunk.at(-1).trim()) chunk.pop();
  const indent = /^[ \t]*/.exec(chunk[0] || '')[0];
  return chunk.map((line) => (indent && line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n');
}

export function roundsIn(text) {
  return Math.max(0, ...[...text.matchAll(/(?:💬|❓)\s*第(\d+)轮[：:]/g)].map((m) => +m[1]));
}

// Classify the whole note into the three bands without touching the text.
export function planJournal(text, { tracked = new Map(), archived = new Set(), turns = new Map(), layout } = {}) {
  const custom = readJournalLayout(text);
  if (custom) {
    const canonical = [custom.head, `---\n${DONE_HEADING}\n${custom.sections.done.text}\n\n---\n${ACTIVE_HEADING}\n${custom.sections.active.text}\n\n---\n`].filter(Boolean).join('\n\n');
    const plan = planJournal(canonical, { tracked, archived, turns });
    return { ...plan, rest: [plan.rest, custom.sections.notes.text].filter(Boolean).join('\n\n'), crlf: /\r\n/.test(text), layout: layout === undefined ? custom.layout : layout, tail: custom.tail, insertAt: custom.sections.active.end };
  }
  // Work in LF; renderJournal puts the note's own line endings back.
  const crlf = /\r\n/.test(String(text));
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const fence = J.fencedLines(lines);
  const { start } = splitFrontMatter(lines);
  const drop = new Set();

  // Generated headings own their section: strip the heading, the ### keyword
  // labels, and the separator that follows.
  const generated = [];
  for (let i = start; i < lines.length; i++) {
    if (fence.has(i)) continue;   // a "## 已完成" inside a code sample is content
    const title = lines[i].trim();
    const isDone = title === DONE_HEADING || title === LEGACY_HEADINGS[0];
    const isActive = title === ACTIVE_HEADING || title === LEGACY_HEADINGS[1];
    if (!isDone && !isActive) continue;
    let end = i + 1;
    while (end < lines.length && !(H2_RE.test(lines[end]) && !fence.has(end))) end++;
    generated.push({ line: i, end, active: isActive });
    drop.add(i);
  }
  // The region opens with a rule of its own: everything above it is the user's
  // and is never moved. A note written before this existed starts at the first
  // heading and gets the rule on the next render.
  // Without a generated heading there is no region yet, so the whole note is
  // scanned (that is how a first organize finds its blocks).
  let headEnd = start;
  if (generated.length) {
    let up = generated[0].line - 1;
    while (up >= start && !lines[up].trim()) up--;
    if (up >= start && isRule(lines[up])) {
      headEnd = up;
      drop.add(up);   // this rule is re-emitted below, so it is not user text
    } else {
      headEnd = generated[0].line;
    }
  }

  // The region closes at the first rule below the last band that does not
  // announce another band. Anything after it is the user's and is not scanned,
  // not sorted and not hoisted — that is the point of the frame. A note from an
  // older layout has no closing rule yet, so it is scanned whole once; the next
  // render writes the rule.
  let regionEnd = lines.length;
  if (generated.length) {
    const bandLines = new Set(generated.map((sec) => sec.line));
    for (let n = generated[generated.length - 1].line + 1; n < lines.length; n++) {
      if (fence.has(n) || !isRule(lines[n])) continue;
      let k = n + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      if (k < lines.length && bandLines.has(k)) continue;   // rule between two bands
      regionEnd = n;
      break;
    }
    if (regionEnd < lines.length) drop.add(regionEnd);
  }

  for (const sec of generated) {
    let n = sec.end;
    while (n < lines.length && !lines[n].trim()) n++;
    if (n < lines.length && isRule(lines[n])) drop.add(n);
  }
  const done = [], active = [];
  const moved = [];
  // One pass instead of J.markOwner per child line (that made a long journal
  // quadratic — see ownersOf in journal.js).
  const owner = J.ownersOf(lines);
  // Subheads this file writes only ever live inside a generated "active" band.
  // A keyword-looking "### TODO" anywhere else is the user's own.
  const inActiveBand = (n) => generated.some((sec) => sec.active && n > sec.line && n < sec.end);
  const inBand = (n, finished) => generated.some((sec) => sec.active === !finished && n > sec.line && n < Math.min(sec.end, regionEnd));
  const KW_WORDS = J.TASK_KWS.split('|');
  const dropSubheadAbove = (i) => {
    let up = i - 1;
    while (up >= headEnd && !lines[up].trim()) up--;
    if (up < headEnd || drop.has(up) || !inActiveBand(up)) return;
    const title = lines[up].trim();
    if (SUBHEAD_RE.test(title) && KW_WORDS.includes(title.replace(/^###\s+/, ''))) drop.add(up);
  };
  // 直属子项的状态关键词（journal-tidy 那种分组容器的判定要用）
  const childKeywords = (i, end) => {
    const out = [];
    for (let n = i + 1; n < end; n++) {
      if (owner[n] !== i) continue;
      const ck = J.kwLine(lines[n]);
      if (ck && ck.kw) out.push(ck.kw);
    }
    return out;
  };
  let cursor = headEnd;
  for (let i = headEnd; i < regionEnd; i++) {
    if (i < cursor || fence.has(i) || drop.has(i) || !J.LIST_RE.test(lines[i])) continue;
    const k = J.kwLine(lines[i]);
    if (!k) continue;
    const indent = J.width(lines[i]);
    let end = i + 1;
    while (end < regionEnd && (!lines[end].trim() || J.width(lines[end]) > indent)) end++;

    const sids = new Set(tracked.get(k.blockId) || []);
    for (let n = i + 1; n < end; n++) {
      if (owner[n] !== i) continue;
      const link = J.parseLink(lines[n]);
      if (link) sids.add(link.sid);
    }
    const body = String(k.body || '');
    const ai = sids.size > 0 || (k.blockId || '').startsWith('ad-') || tracked.has(k.blockId) || body.startsWith('🤖');
    const doneKw = J.DONE_KWS.includes(k.kw);
    const archivedOut = sids.size > 0 && [...sids].every((sid) => archived.has(sid));
    // journal-tidy 的分组容器：没有状态关键词、只标 🤖 的行。里面的记录全是 DONE 就整块算完成，
    // 还有没做完的就整块留在进行中；子块不拆散。
    const container = !k.kw && body.startsWith('🤖');
    const kids = container ? childKeywords(i, end) : [];
    const allKidsDone = kids.length > 0 && kids.every((kw) => J.DONE_KWS.includes(kw));
    const finished = doneKw || archivedOut || allKidsDone;

    const normalizeChunkHeader = (chunkLines, forceDone = false) => {
      if (container || !chunkLines.length) return chunkLines;
      const p = J.splitTask(chunkLines[0]);
      if (!p) return chunkLines;
      if (p.auto && !p.cb) {
        const cs = J.clockSpanFromLines(chunkLines, 0);
        const s = p.since || cs?.start || '';
        const e = (p.until && p.until !== p.since ? p.until : cs?.end) || p.until || p.since || s;
        if (s || e || forceDone) {
          return [
            J.formatAutoTaskLine({
              prefix: p.prefix,
              kw: forceDone ? 'DONE' : (p.kw || 'TODO'),
              start: s,
              end: e,
              title: p.title,
              blockId: p.blockId,
            }),
            ...chunkLines.slice(1),
          ];
        }
        return chunkLines;
      }
      if (forceDone) return [`${p.prefix}DONE ${p.since ? p.since + ' ' : ''}${p.rest}`, ...chunkLines.slice(1)];
      return chunkLines;
    };

    if (finished) {
      const chunk = normalizeChunkHeader(lines.slice(i, end), archivedOut && !doneKw);
      const block = blockText(chunk, 0, chunk.length);
      const count = Math.max(turns.get(k.blockId) || 0, [...sids].reduce((n, sid) => n + (turns.get(sid) || 0), 0), roundsIn(block));
      done.push({ text: block, blockId: k.blockId || '', turns: count, ai, sid: [...sids], at: i, organized: inBand(i, true) });
      // A block that leaves the active band must not leave its heading behind.
      dropSubheadAbove(i);
      moved.push([i, end]);
      cursor = end;
      continue;
    }
    if (!ai) continue;

    const activeChunk = normalizeChunkHeader(lines.slice(i, end), false);
    const block = blockText(activeChunk, 0, activeChunk.length);
    const count = Math.max(turns.get(k.blockId) || 0, [...sids].reduce((n, sid) => n + (turns.get(sid) || 0), 0), roundsIn(block));
    active.push({ text: block, keyword: k.kw || 'TODO', turns: count, blockId: k.blockId || '', at: i, organized: inBand(i, false) });
    dropSubheadAbove(i);
    moved.push([i, end]);
    cursor = end;
  }

  // Records the plugin itself wrote but that sit above the region's opening rule
  // are adopted into the bands once, then dropped from the head. New blocks
  // handed to done-to-top land near the top of the note, which used to leave
  // them frozen outside the frame forever. Anything else above the rule stays
  // exactly where it is.
  const adopted = [];
  if (generated.length) {
    for (let i = start; i < headEnd; i++) {
      if (fence.has(i) || !J.LIST_RE.test(lines[i])) continue;
      const k = J.kwLine(lines[i]);
      if (!k) continue;
      const indent = J.width(lines[i]);
      let end = i + 1;
      while (end < headEnd && (!lines[end].trim() || J.width(lines[end]) > indent)) end++;
      const sids = new Set(tracked.get(k.blockId) || []);
      for (let n = i + 1; n < end; n++) {
        if (owner[n] !== i) continue;
        const link = J.parseLink(lines[n]);
        if (link) sids.add(link.sid);
      }
      const body = String(k.body || '');
      const ai = sids.size > 0 || (k.blockId || '').startsWith('ad-') || tracked.has(k.blockId) || body.startsWith('🤖');
      if (!ai) continue;
      const doneKw = J.DONE_KWS.includes(k.kw);
      const archivedOut = sids.size > 0 && [...sids].every((sid) => archived.has(sid));
      const container = !k.kw && body.startsWith('🤖');
      const kids = container ? childKeywords(i, end) : [];
      const allKidsDone = kids.length > 0 && kids.every((kw) => J.DONE_KWS.includes(kw));
      let chunk = lines.slice(i, end);
      const p = !container ? J.splitTask(chunk[0]) : null;
      if (p && p.auto && !p.cb) {
        const cs = J.clockSpanFromLines(chunk, 0);
        const s = p.since || cs?.start || '';
        const e = (p.until && p.until !== p.since ? p.until : cs?.end) || p.until || p.since || s;
        if (s || e || (archivedOut && !doneKw)) {
          chunk = [
            J.formatAutoTaskLine({
              prefix: p.prefix,
              kw: archivedOut && !doneKw ? 'DONE' : (p.kw || 'TODO'),
              start: s,
              end: e,
              title: p.title,
              blockId: p.blockId,
            }),
            ...chunk.slice(1),
          ];
        }
      } else if (archivedOut && !doneKw && p) {
        chunk = [`${p.prefix}DONE ${p.since ? p.since + ' ' : ''}${p.rest}`, ...chunk.slice(1)];
      }
      const block = blockText(chunk, 0, chunk.length);
      const count = Math.max(turns.get(k.blockId) || 0, [...sids].reduce((n, sid) => n + (turns.get(sid) || 0), 0), roundsIn(block));
      if (doneKw || archivedOut || allKidsDone) done.push({ text: block, blockId: k.blockId || '', turns: count, ai, sid: [...sids], at: i, organized: false });
      else active.push({ text: block, keyword: k.kw || 'TODO', turns: count, blockId: k.blockId || '', at: i, organized: false });
      adopted.push([i, end]);
      i = end - 1;
    }
  }
  const headLines = lines.slice(0, headEnd);
  const adoptedAt = new Uint8Array(headLines.length);
  for (const [a, b] of adopted) adoptedAt.fill(1, a, b);
  const headRows = [];
  let gone = false;
  for (let i = 0; i < headLines.length; i++) {
    if (adoptedAt[i]) { gone = true; continue; }
    headRows.push({ text: headLines[i], blank: !headLines[i].trim(), gone });
    if (headLines[i].trim()) gone = false;
  }
  while (headRows.length && !headRows[0].text.trim()) headRows.shift();
  while (headRows.length && !headRows.at(-1).text.trim()) headRows.pop();
  const keptHead = [];
  for (const row of headRows) {
    // Collapse only the gap an adopted block left behind.
    if (row.gone && row.blank && !keptHead.at(-1)?.trim()) continue;
    keptHead.push(row.text);
  }
  const head = keptHead.join('\n');

  // moved.some(…) inside the two loops below was O(lines x blocks); a mask is
  // O(lines) and asks the same question.
  const movedAt = new Uint8Array(lines.length);
  for (const [a, b] of moved) movedAt.fill(1, a, b);

  // A bare --- that follows a block we just moved, or one of our headings, is a
  // separator this function wrote last time. Keeping it would stack another
  // divider on every run. A --- the user put after their own task is left alone.
  for (let n = headEnd; n < regionEnd; n++) {
    if (fence.has(n) || drop.has(n) || !isRule(lines[n])) continue;
    let p = n - 1;
    while (p >= headEnd && !lines[p].trim()) p--;
    if (p < headEnd) continue;
    const title = lines[p].trim();
    if (drop.has(p) || LEGACY_HEADINGS.includes(title) || title === DONE_HEADING || title === ACTIVE_HEADING || movedAt[p]) drop.add(n);
  }

  // 已完成区按对话轮数从多到少；同轮数保持原文里的先后。
  done.sort((a, b) => b.turns - a.turns || a.at - b.at);
  active.sort((a, b) => rank(a.keyword) - rank(b.keyword) || b.turns - a.turns || a.at - b.at);

  const rest = [];
  let removed = false;
  for (let i = headEnd; i < lines.length; i++) {
    if (drop.has(i) || movedAt[i]) { removed = true; continue; }
    rest.push({ text: lines[i], at: i, removed });
    if (lines[i].trim()) removed = false;
  }
  while (rest.length && !rest[0].text.trim()) rest.shift();
  while (rest.length && !rest.at(-1).text.trim()) rest.pop();
  const kept = [];
  for (const row of rest) {
    // A blank run is collapsed only where a block was taken out just above it
    // (that gap is ours); spacing in the user's own text, and blank lines
    // inside a code sample, are left exactly as written.
    if (row.removed && !row.text.trim() && !fence.has(row.at) && !kept.at(-1)?.trim()) continue;
    kept.push(row.text);
  }

  // Where a newly logged block belongs: the end of the region, before the rule
  // that closes it and before anything the user wrote.
  const insertAt = generated.length
    ? (moved.length ? Math.max(...moved.map(([, end]) => end)) : generated[generated.length - 1].line + 1)
    : null;

  return {
    head,
    layout,
    crlf,
    done,
    active,
    rest: kept.join('\n'),
    insertAt,
    count: { done: done.length, active: active.length, total: done.length + active.length },
  };
}

// Make sure a generated band has its opening rule. Writers that edit the
// journal without going through renderJournal (auto logging, the write-back)
// use this so a missing frame is restored instead of waiting for the next
// organize. Idempotent: a framed note comes back unchanged.
export function ensureTopRule(text) {
  if (readJournalLayout(text)) return text;
  const lines = String(text || '').split('\n');
  const fence = J.fencedLines(lines);
  const { start } = splitFrontMatter(lines);
  for (let i = start; i < lines.length; i++) {
    if (fence.has(i)) continue;
    const title = lines[i].trim();
    const generated = title === DONE_HEADING || title === ACTIVE_HEADING || LEGACY_HEADINGS.includes(title);
    if (!generated) continue;
    let up = i - 1;
    while (up >= start && !lines[up].trim()) up--;
    // The front matter's own closing rule is not a divider: it is invisible in
    // reading view, so the frame still needs one of its own.
    if (up >= start && up !== start - 1 && isRule(lines[up])) return String(text || '');
    const chunk = lines[i - 1] !== undefined && lines[i - 1].trim() ? [''] : [];
    lines.splice(i, 0, ...chunk, '---');
    return lines.join('\n');
  }
  return String(text || '');
}

// Render a plan back into note text. `done`/`active` can be turned off, and
// `skip` drops specific finished blocks (used after archiving them away).
export function renderJournal(plan, { done = true, active = true, skip = null, layout = plan.layout } = {}) {
  // `skip` is what archiving just moved out. Matching on the block id first
  // keeps two identical-looking blocks from being dropped together.
  const finished = done ? plan.done.filter((entry) => !(skip && (entry.blockId ? skip.has(entry.blockId) : skip.has(entry.text)))) : [];
  const bands = [];
  const activeBody = [];

  if (finished.length) bands.push([DONE_HEADING, ...finished.map((entry) => entry.text)].join('\n'));
  if (active && plan.active.length) {
    let previous = '';
    for (const entry of plan.active) {
      if (entry.keyword !== previous) { activeBody.push(`### ${entry.keyword}`); previous = entry.keyword; }
      activeBody.push(entry.text);
    }
    bands.push([ACTIVE_HEADING, ...activeBody].join('\n'));
  }
  if (layout) {
    const out = renderJournalLayout({ head: plan.head, done: finished.map(entry => entry.text).join('\n'), active: activeBody.join('\n'), notes: plan.rest, tail: plan.tail }, layout);
    return plan.crlf ? out.replace(/\n/g, '\r\n') : out;
  }

  // The AI region is framed by its own rules: one above the first band, one
  // before the user's notes. Everything outside those two rules is the user's
  // text and is copied through as it is — no blank-line squeezing, no trimming
  // beyond the seam that joins it to the generated part.
  const above = plan.head.replace(/\s+$/, '');
  // A rule sits directly on the heading, no blank line between them.
  const body = bands.length ? bands.join('\n\n---\n') : '';
  const rest = plan.rest.split('\n');
  // A rule left over from an older layout would sit next to the one this
  // function writes, so a run of them is dropped before the user's text.
  while (bands.length && rest.length && (!rest[0].trim() || isRule(rest[0]))) rest.shift();
  const below = rest.join('\n').replace(/\s+$/, '');

  const parts = [];
  if (above) parts.push(above);
  if (body) parts.push(`---\n${body}`);
  if (below) parts.push(`${body ? '---\n\n' : ''}${below}`);
  if (plan.tail) parts.push(plan.tail);

  const out = `${parts.join('\n\n').replace(/\n*$/, '')}\n`;
  return plan.crlf ? out.replace(/\n/g, '\r\n') : out;
}

// Collapse blank runs outside code fences only: a code sample may legitimately
// contain two empty lines in a row, so it must not be normalised.
export function squeezeBlank(text) {
  const lines = text.split('\n');
  const fence = J.fencedLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() && !fence.has(i)) {
      if (!out.length || !out[out.length - 1].trim()) continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}
