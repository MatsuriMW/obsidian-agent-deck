import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import * as J from '../src/journal.js';
import {
  RECORD_VIEWS,
  aiRecordGroups,
  recordViewMode,
  visibleTableEntries,
  parseAiRecordRow,
  buildTableModel,
  recordBadgeLabel,
} from '../src/ai-records.js';

// 1. View preference defaults and top-level / nested detection.
{
  assert.deepEqual([...RECORD_VIEWS], ['outline', 'table', 'cards', 'timeline']);
  assert.equal(recordViewMode({}, { key: 'ad-1' }), 'outline');
  assert.equal(recordViewMode({ aiRecordViews: { 'ad-1': 'table' } }, { key: 'ad-1' }), 'table');
  assert.equal(recordViewMode({ aiRecordViews: { 'ad-1': 'cards' } }, { key: 'ad-1' }), 'cards');
  assert.equal(recordViewMode({ aiRecordViews: { 'ad-1': 'timeline' } }, { key: 'ad-1' }), 'timeline');
  assert.equal(recordViewMode({ aiRecordViews: { 'ad-1': 'unknown' } }, { key: 'ad-1' }), 'outline');

  const note = [
    '- DOING 14:00-14:30 🤖 顶层任务 ^claude-top-1234567890',
    '  - ❓ 第1轮：先查问题 <!-- ad-turn:s1:1 -->',
    '  - 💬 第1轮：任务：查问题；结论：已定位根因 <!-- ad-turn:s1:1 -->',
    '  - 手写备注',
    '  - DOING 嵌套子任务 ^ad-child',
    '    - 💬 子任务结论 <!-- ad-turn:s2:1 -->',
    '  - 💬 多行回复标题 <!-- ad-turn:s1:2 -->',
    '    - 第一条细节',
    '    - 第二条细节',
    '  - ⏱ 14:00–14:30 · 共 30m · 12k tok · Claude <!-- ad-clock:deadbeef -->',
    '- DOING 第二个母块 ^codex-two-1234567890',
    '  - 💬 第二块结论',
  ].join('\n');

  const groups = aiRecordGroups(note);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].key, 'claude-top-1234567890');
  assert.equal(groups[0].topLevel, true);
  assert.equal(groups[1].key, 'ad-child');
  assert.equal(groups[1].topLevel, false, 'nested child AI block is not top-level');
  assert.equal(groups[2].key, 'codex-two-1234567890');
  assert.equal(groups[2].topLevel, true);

  // Outline records still exclude lines with descendants, while tableEntries include pure multi-line AI records.
  assert.ok(!groups[0].records.includes(6), 'outline records skip multi-line entry with descendants');
  const multiEntry = groups[0].tableEntries.find((e) => e.line === 6);
  assert.ok(multiEntry, 'tableEntries include AI entry with non-task sub-items');
  assert.deepEqual(multiEntry.lineNumbers, [6, 7, 8]);
  assert.deepEqual(multiEntry.children, ['    - 第一条细节', '    - 第二条细节']);
  assert.ok(!groups[0].tableEntries.some((e) => e.line === 3 || e.line === 4), 'handwritten notes and nested tasks stay out of tableEntries');

  const lines = note.split('\n');
  const closedRows = visibleTableEntries(groups[0], lines, 'latest1', false);
  assert.deepEqual(closedRows.map((e) => e.line), [6], 'latest1 in table mode selects only latest conclusion');
  const openRows = visibleTableEntries(groups[0], lines, 'latest1', true);
  assert.deepEqual(openRows.map((e) => e.line), [1, 2, 6, 9], 'expanded table shows all entries');
}

// 2. Row parsing preserves reliable metadata and leaves missing fields blank.
{
  const brief = parseAiRecordRow('  - 💬 第3轮：任务：修复缓存；结论：已修复并测试 <!-- ad-turn:s1:3 -->');
  assert.deepEqual(brief, {
    kind: 'result',
    kindLabel: '结论',
    round: 3,
    content: '任务：修复缓存；结论：已修复并测试',
    task: '修复缓存',
    conclusion: '已修复并测试',
    meta: '',
    children: [],
  });

  const clock = parseAiRecordRow('  - ⏱ 14:00–14:30 · 共 30m · 12k tok · Claude <!-- ad-clock:1234abcd -->');
  assert.equal(clock.kind, 'clock');
  assert.equal(clock.round, null, 'clock row never fabricates a round number');
  assert.equal(clock.content, '14:00–14:30');
  assert.equal(clock.meta, '共 30m · 12k tok · Claude');

  const plan = parseAiRecordRow('  - 📋 第2轮：步骤 2/3 · 正在改代码');
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.round, 2);
  assert.equal(plan.meta, '2/3');
  assert.equal(plan.content, '正在改代码');

  const link = parseAiRecordRow('  - 🔗 [Codex：会话](codex://threads/11111111-2222-3333-4444-555555555555) `11111111-2222-3333-4444-555555555555`', [], { codex: 'Codex' });
  assert.equal(link.kind, 'link');
  assert.equal(link.content, '[Codex：会话](codex://threads/11111111-2222-3333-4444-555555555555)');
  assert.equal(link.meta, 'Codex');

  const multi = parseAiRecordRow('  - 💬 总结', ['    - 细节 A', '      - 深层 B']);
  assert.equal(multi.round, null);
  assert.equal(multi.meta, '');
  assert.deepEqual(multi.children, [
    { level: 0, text: '细节 A' },
    { level: 1, text: '深层 B' },
  ]);

  // buildTableModel: no duplicate labels on brief rows, pairs matching ❓+💬, moves clock/link to footer.
  const briefModel = buildTableModel([{ ...brief, line: 1, sig: 'b1' }]);
  assert.equal(briefModel.hasPromptCol, true);
  assert.equal(briefModel.rows.length, 1);
  assert.equal(briefModel.rows[0].badge, '');
  assert.equal(briefModel.rows[0].prompt, '修复缓存');
  assert.equal(briefModel.rows[0].conclusion, '已修复并测试');
  assert.equal(briefModel.footer.length, 0);

  const pairedModel = buildTableModel([
    { ...parseAiRecordRow('  - ❓ 第2轮：怎么看？'), line: 2, sig: 'q2' },
    { ...parseAiRecordRow('  - 💬 第2轮：看这里'), line: 3, sig: 'r2' },
    { ...plan, line: 4, sig: 'p2' },
    { ...parseAiRecordRow('  - 💬 累计总结：全部完成'), line: 5, sig: 's1' },
    { ...clock, line: 6, sig: 'c1' },
    { ...link, line: 7, sig: 'l1' },
  ]);
  assert.equal(pairedModel.hasPromptCol, true);
  assert.equal(pairedModel.rows.length, 3);
  assert.equal(pairedModel.rows[0].prompt, '怎么看？');
  assert.equal(pairedModel.rows[0].promptLine, 2);
  assert.equal(pairedModel.rows[0].conclusion, '看这里');
  assert.equal(pairedModel.rows[0].conclusionLine, 3);
  assert.equal(pairedModel.rows[1].promptStep, true);
  assert.equal(pairedModel.rows[1].promptMeta, '2/3');
  assert.equal(pairedModel.rows[2].type, 'span');
  assert.equal(pairedModel.rows[2].badge, '总结');
  assert.equal(pairedModel.footer.length, 2, 'clock and link move into footer strip');

  const compactModel = buildTableModel([{ ...parseAiRecordRow('  - 💬 第1轮：只记结论'), line: 1, sig: 'r1' }]);
  assert.equal(compactModel.hasPromptCol, false, 'omits Task/Prompt column when empty across all rows');

  const enBrief = parseAiRecordRow('  - 💬 Round 2: Task: audit module boundaries; Result: zero circular imports');
  assert.equal(enBrief.kind, 'result');
  assert.equal(enBrief.round, 2);
  assert.equal(enBrief.task, 'audit module boundaries');
  assert.equal(enBrief.conclusion, 'zero circular imports');

  const enPaired = buildTableModel([
    { ...parseAiRecordRow('  - ❓ Round 1: Check tests?'), line: 10, sig: 'eq1' },
    { ...parseAiRecordRow('  - 💬 Round 1: All tests pass'), line: 11, sig: 'er1' },
  ]);
  assert.equal(enPaired.rows.length, 1);
  assert.equal(enPaired.rows[0].round, 1);
  assert.equal(enPaired.rows[0].prompt, 'Check tests?');
  assert.equal(enPaired.rows[0].conclusion, 'All tests pass');
}

// 3. StateField view switching, per-parent persistence, table decorations, and the generic delegate arrow.
const stub = `export class WidgetType{}; export const Decoration={set:r=>r,replace:spec=>({range:(from,to)=>({from,to,spec})}),line:spec=>({range:from=>({from,to:from,spec})}),widget:spec=>({range:from=>({from,to:from,spec})})}, EditorView={}, EditorState={transactionFilter:{of:f=>f}}, StateEffect={define:()=>{const t={of:value=>({type:t,value,is:x=>x===t})};return t}}, StateField={define:c=>c}, ViewPlugin={fromClass:c=>c}, foldedRanges=s=>({between:(a,b,fn)=>{for(const f of s.folds||[])fn(f.from,f.to)}}), foldEffect={of:value=>({type:foldEffect,value,is:x=>x===foldEffect})}, unfoldEffect={of:value=>({type:unfoldEffect,value,is:x=>x===unfoldEffect})};`;
const bundle = await esbuild.build({
  stdin: { contents: "export * from './src/record-display.js';", resolveDir: path.resolve(import.meta.dirname, '..') },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{ name: 'cm-surface', setup(b) { b.onResolve({ filter: /^@codemirror\// }, a => ({ path: a.path, namespace: 'cm' })); b.onLoad({ filter: /.*/, namespace: 'cm' }, () => ({ contents: stub })); } }],
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-views-'));
try {
  const file = path.join(dir, 'display.mjs');
  fs.writeFileSync(file, bundle.outputFiles[0].text);
  const { aiRecordDisplayExtension, setRecordViewEffect, setRecordsOpenEffect, renderAIRecords } = await import(pathToFileURL(file));

  const makeDoc = (src) => {
    const arr = src.split('\n');
    const starts = [];
    let off = 0;
    for (const l of arr) { starts.push(off); off += l.length + 1; }
    return {
      length: src.length,
      lines: arr.length,
      toString: () => src,
      line(n) { const from = starts[n - 1]; return { number: n, from, to: from + arr[n - 1].length, text: arr[n - 1] }; },
      lineAt(pos) { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= pos) i++; return this.line(i + 1); },
    };
  };

  let savedCount = 0;
  const plugin = {
    settings: { aiRecordDisplay: 'latest1', aiRecordViews: {}, aiRecordExpanded: {}, aiRecordClosed: {} },
    agentShortNames: { claude: 'Claude', codex: 'Codex' },
    saveSettings() { savedCount++; },
    refreshUI() {},
  };
  const refreshType = {};
  const refreshEff = { is: (t) => t === refreshType };
  const [field] = aiRecordDisplayExtension(plugin, refreshType);
  const src = [
    '- DOING 母块一 ^ad-one',
    '  - ❓ 第1轮：问1 <!-- ad-turn:s1:1 -->',
    '  - 💬 第1轮：答1 <!-- ad-turn:s1:1 -->',
    '  - 手写笔记',
    '- DOING 母块二 ^ad-two',
    '  - 💬 第二块回答 <!-- ad-turn:s2:1 -->',
    '- TODO 普通手写任务',
  ].join('\n');

  const doc1 = makeDoc(src);
  const v0 = field.create({ doc: doc1 });
  assert.deepEqual([...v0.topLevelLines], [0, 4], 'both top-level AI parents are marked');
  assert.equal(v0.decorations.filter((d) => d.spec.widget?.viewMode === 'outline').length, 2, 'outline view toggles appear on top-level parents');

  // Switch only ad-one to table; ad-two remains outline.
  const v1 = field.update(v0, { docChanged: false, state: { doc: doc1 }, effects: [setRecordViewEffect.of({ key: 'ad-one', view: 'table' })] });
  assert.equal(plugin.settings.aiRecordViews['ad-one'], 'table');
  assert.equal(plugin.settings.aiRecordViews['ad-two'], undefined);
  assert.ok(savedCount > 0);

  const tableWidgets = v1.decorations.filter((d) => d.spec.block && d.spec.widget?.rows);
  assert.equal(tableWidgets.length, 1, 'only ad-one renders a table block widget');
  assert.equal(tableWidgets[0].spec.widget.rows.length, 1, 'latest1 in table mode shows 1 row when collapsed');
  assert.equal(tableWidgets[0].spec.widget.rows[0].content, '答1');

  const manualNoteLine = doc1.line(4);
  assert.ok(!v1.decorations.some((d) => d.spec.inclusive === false && d.from <= manualNoteLine.from && d.to >= manualNoteLine.to), 'handwritten note stays visible in table view');

  // Adding a new round updates the table widget cleanly.
  const src2 = src.replace('  - 手写笔记', '  - 💬 第2轮：新回答 <!-- ad-turn:s1:2 -->\n  - 手写笔记');
  const doc2 = makeDoc(src2);
  const v2 = field.update(v1, { docChanged: true, state: { doc: doc2 }, effects: [] });
  const updatedWidget = v2.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget;
  assert.equal(updatedWidget.rows[0].content, '新回答');
  assert.equal(updatedWidget.eq(tableWidgets[0].spec.widget), false, 'new round invalidates widget equality');

  // Switch to cards & timeline and verify widget equality & DOM output for each view mode.
  const mkNode = (tag = 'div') => {
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      hidden: false,
      attrs: {},
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener() {},
    };
    return node;
  };
  const findAll = (root, cls) => {
    const out = [];
    const tokens = String(root.className || '').split(/\s+/).filter(Boolean);
    if (tokens.includes(cls)) out.push(root);
    for (const c of root.children || []) out.push(...findAll(c, cls));
    return out;
  };
  const fakeView = {
    dom: {
      ownerDocument: {
        createElement: mkNode,
        createTextNode: (txt) => ({ nodeType: 3, textContent: String(txt ?? ''), children: [] }),
      },
    },
  };

  const vCards = field.update(v2, { docChanged: false, state: { doc: doc2 }, effects: [setRecordViewEffect.of({ key: 'ad-one', view: 'cards' })] });
  assert.equal(plugin.settings.aiRecordViews['ad-one'], 'cards');
  const cardsWidget = vCards.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget;
  assert.equal(cardsWidget.viewMode, 'cards');
  assert.equal(cardsWidget.eq(updatedWidget), false, 'switching table -> cards invalidates widget equality');
  const cardsDom = cardsWidget.toDOM(fakeView);
  assert.equal(cardsDom.dataset.view, 'cards');
  assert.equal(findAll(cardsDom, 'ad-rt-cards').length, 1);
  assert.equal(findAll(cardsDom, 'ad-rt-card').length, 1);

  const vTimeline = field.update(vCards, { docChanged: false, state: { doc: doc2 }, effects: [setRecordViewEffect.of({ key: 'ad-one', view: 'timeline' })] });
  assert.equal(plugin.settings.aiRecordViews['ad-one'], 'timeline');
  const timelineWidget = vTimeline.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget;
  assert.equal(timelineWidget.viewMode, 'timeline');
  assert.equal(timelineWidget.eq(cardsWidget), false, 'switching cards -> timeline invalidates widget equality');
  const timelineDom = timelineWidget.toDOM(fakeView);
  assert.equal(timelineDom.dataset.view, 'timeline');
  assert.equal(findAll(timelineDom, 'ad-rt-timeline').length, 1);
  assert.equal(findAll(timelineDom, 'ad-rt-tl-item').length, 1);
  assert.equal(findAll(timelineDom, 'ad-rt-timeline--timed').length, 0, 'no time axis class without round timestamps');

  // Same-day timestamps from usage.meta render HH:mm on the vertical rail and invalidate eq().
  const t1 = new Date(2026, 10, 16, 9, 5, 0).getTime();
  const t2SameDay = new Date(2026, 10, 16, 14, 27, 0).getTime();
  plugin.settings.aiRecordDisplay = 'expanded';
  plugin.settings.autoLogState = { '2026-11-16': { 's1': { blockId: 'ad-one' } } };
  plugin.usage = { meta: new Map([['s1', { rounds: [{ n: 1, at: t1 }, { n: 2, at: t2SameDay }] }]]) };
  const vTimelineTimed = field.update(vTimeline, { docChanged: false, state: { doc: doc2 }, effects: [refreshEff] });
  const timedWidget = vTimelineTimed.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget;
  assert.equal(timedWidget.eq(timelineWidget), false, 'populating round timestamps invalidates widget equality');
  const timedDom = timedWidget.toDOM(fakeView);
  const timedRail = findAll(timedDom, 'ad-rt-timeline--timed');
  assert.equal(timedRail.length, 1);
  assert.equal(findAll(timedDom, 'ad-rt-timeline--dated').length, 0, 'same-day rounds omit date prefix');
  assert.deepEqual(findAll(timedDom, 'ad-rt-tl-time').map((el) => el.textContent), ['09:05', '14:27']);

  // Cross-day rounds add --dated and show MM-DD HH:mm.
  const t2NextDay = new Date(2026, 10, 17, 1, 8, 0).getTime();
  plugin.usage.meta.set('s1', { rounds: [{ n: 1, at: t1 }, { n: 2, at: t2NextDay }] });
  const vTimelineDated = field.update(vTimelineTimed, { docChanged: false, state: { doc: doc2 }, effects: [refreshEff] });
  const datedDom = vTimelineDated.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget.toDOM(fakeView);
  assert.equal(findAll(datedDom, 'ad-rt-timeline--dated').length, 1);
  assert.deepEqual(findAll(datedDom, 'ad-rt-tl-time').map((el) => el.textContent), ['11-16 09:05', '11-17 01:08']);

  // Fallback to live delegation jobs when usage.meta does not have rounds yet.
  plugin.usage.meta.clear();
  plugin.jobs = {
    'j-live': {
      blockId: 'ad-one',
      sessionId: 's1',
      conversation: [
        { role: 'user', text: '问1', at: t1 },
        { role: 'assistant', text: '答1', at: t1 + 1000 },
        { role: 'user', text: '问2', at: t2SameDay },
      ],
    },
  };
  const vTimelineJob = field.update(vTimelineDated, { docChanged: false, state: { doc: doc2 }, effects: [refreshEff] });
  const jobDom = vTimelineJob.decorations.find((d) => d.spec.block && d.spec.widget?.rows).spec.widget.toDOM(fakeView);
  assert.deepEqual(findAll(jobDom, 'ad-rt-tl-time').map((el) => el.textContent), ['09:05', '14:27']);

  plugin.settings.aiRecordDisplay = 'latest1';
  plugin.settings.autoLogState = {};
  plugin.usage = null;
  plugin.jobs = null;

  // Switch back to outline removes sparse entry.
  const v3 = field.update(vTimeline, { docChanged: false, state: { doc: doc2 }, effects: [setRecordViewEffect.of({ key: 'ad-one', view: 'outline' })] });
  assert.equal(plugin.settings.aiRecordViews['ad-one'], undefined);
  assert.equal(v3.decorations.filter((d) => d.spec.block && d.spec.widget?.rows).length, 0);

  // The delegate arrow follows the cursor line: top-level parents, 💬 replies, plain items and manual tasks all get it.
  const editorSource = fs.readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');
  const decorStart = editorSource.indexOf('function buildDecorations('), decorEnd = editorSource.indexOf('\nexport function createEditorExtension', decorStart);
  const decorate = vm.runInNewContext(editorSource.slice(decorStart, decorEnd) + '\nbuildDecorations', {
    J,
    BULLET_RE: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    // 和真实 RangeSetBuilder 一样要求按 from 递增加入：光标行的委派箭头如果插在行首装饰之前，会抛
    // "Ranges must be added sorted"，把整层编辑器装饰（箭头、状态药丸）一起打掉。
    RangeSetBuilder: class {
      constructor() { this.ranges = []; this.lastFrom = 0; }
      add(from, to, spec) {
        if (from < this.lastFrom) throw new Error("Ranges must be added sorted by `from` position and `startSide`");
        this.lastFrom = from;
        this.ranges.push(spec);
      }
      finish() { return this.ranges; }
    },
    Decoration: { widget: x => x, line: (spec) => ({ line: true, ...spec }) },
    RESULT_LINE_RE: /^\s*[-*+]\s+💬/,
    SUB_LINE_RE: /^\s*[-*+]\s+🤖\s*(?:子代理|side chat)/,
    GripWidget: class { constructor() { this.grip = true; } },
    PillWidget: class {},
  });

  const makeEditorView = (lineIndex) => ({
    state: {
      field: (f) => (f === 'displayField' ? v0 : { file: { path: 'note.md' } }),
      doc: doc1,
      selection: { main: { empty: true, head: doc1.line(lineIndex + 1).from } },
    },
    visibleRanges: [{ from: 0, to: doc1.length }],
  });
  const mkPlugin = (view) => ({
    settings: { showEditorPills: true },
    aiRecordDisplayField: 'displayField',
    _lastEditor: view,
    lineMap: () => ({ sessionByParent: new Map() }),
    jobAtLine() {},
    nautilusOwnsLine: () => false,
  });

  // 光标所在的段落一律出委派箭头：母块、回传日志、普通列表项都一样。
  const topView = makeEditorView(0);
  assert.ok(decorate(topView, mkPlugin(topView)).some((d) => d.widget?.grip), 'top-level AI parent keeps the delegate arrow');
  const childView = makeEditorView(2);
  assert.ok(decorate(childView, mkPlugin(childView)).some((d) => d.widget?.grip), 'child AI reply keeps the delegate arrow');
  const promptView = makeEditorView(1);
  assert.ok(decorate(promptView, mkPlugin(promptView)).some((d) => d.widget?.grip), '❓ prompt row keeps the delegate arrow');
  const noteView = makeEditorView(3);
  assert.ok(decorate(noteView, mkPlugin(noteView)).some((d) => d.widget?.grip), 'a plain list item keeps the delegate arrow');
  const manualView = makeEditorView(6);
  assert.ok(decorate(manualView, mkPlugin(manualView)).some((d) => d.widget?.grip), 'manual task keeps the delegate arrow');
  const emptyCursor = decorate({ ...makeEditorView(0), state: { ...makeEditorView(0).state, selection: { main: { empty: true, head: -1 } } } }, mkPlugin(makeEditorView(0)));
  assert.ok(emptyCursor, 'no cursor line is still a valid decoration set');

  // View mode and manual fold state persist across DONE stripping ^blockId and line shifts.
  const doingSrc = [
    '- DOING 🤖 修复缓存问题 ^ad-cache',
    '  - 💬 第1轮：已修复并测试 <!-- ad-turn:sc1:1 -->',
  ].join('\n');
  const doingDoc = makeDoc(doingSrc);
  const s0 = field.create({ doc: doingDoc });
  const s1 = field.update(s0, {
    docChanged: false,
    state: { doc: doingDoc },
    effects: [setRecordViewEffect.of({ key: 'ad-cache', view: 'cards' })],
  });
  assert.equal(plugin.settings.aiRecordViews['ad-cache'], 'cards');
  assert.equal(plugin.settings.aiRecordViews['task:修复缓存问题'], 'cards');

  const doneShiftedSrc = [
    '- 普通前置新行一',
    '- 普通前置新行二',
    '- DONE 🤖 修复缓存问题',
    '  - 💬 第1轮：已修复并测试 <!-- ad-turn:sc1:1 -->',
  ].join('\n');
  const doneShiftedDoc = makeDoc(doneShiftedSrc);
  const doneGroups = aiRecordGroups(doneShiftedSrc, new Set(['ad-cache']));
  assert.equal(doneGroups.length, 1);
  assert.equal(recordViewMode(plugin.settings, doneGroups[0]), 'cards', 'view persists after DONE strips blockId and lines shift');
  const s2 = field.update(s1, { docChanged: true, state: { doc: doneShiftedDoc }, effects: [] });
  assert.ok(s2.decorations.some((d) => d.spec.block && d.spec.widget?.viewMode === 'cards'), 'editor renders persisted cards widget on DONE shifted block');
  const s3 = field.update(s2, {
    docChanged: false,
    state: { doc: doneShiftedDoc },
    effects: [setRecordViewEffect.of({ key: doneGroups[0].key, view: 'outline' })],
  });
  assert.equal(plugin.settings.aiRecordViews['task:修复缓存问题'], undefined, 'reverting DONE block to outline cleans persisted view');

  // Completed DONE subagent subtree is hidden in outline Live Preview when collapsed and shown when expanded,
  // and Reading View hides the entire subagent <li> without spawning a duplicate nested toggle button.
  const subNote = [
    '- DOING 🤖 Cursor 主任务 ^cursor-sub-fold',
    '  - 🔗 [Cursor：主任务](obsidian://agent-deck?do=open&agent=cursor&sid=c1)',
    '  - 第1轮：**任务**：排查；**结论**：已完成 <!-- ad-turn:c1:1 -->',
    '  - DONE 🤖 10:05-10:08 探索子代理',
    '    - ⏱ 10:05–10:08 · 共 3m · 子代理 `sub12345`',
    '    - 💬 子代理发现根因',
  ].join('\n');
  const subDoc = makeDoc(subNote);
  plugin.settings.aiRecordDisplay = 'latest1';
  plugin.settings.aiRecordExpanded = {};
  plugin.settings.aiRecordClosed = {};
  const subCollapsed = field.create({ doc: subDoc });
  const subHeaderFrom = subDoc.line(4).from;
  const subLastTo = subDoc.line(6).to;
  assert.ok(
    subCollapsed.decorations.some((d) => d.spec.inclusive === false && d.from <= subHeaderFrom && d.to >= subLastTo),
    'Live Preview hides completed subagent header and its ⏱/💬 subtree when collapsed',
  );
  const subTable = field.update(subCollapsed, {
    docChanged: false,
    state: { doc: subDoc },
    effects: [setRecordViewEffect.of({ key: 'cursor-sub-fold', view: 'table' })],
  });
  const subExpanded = field.update(subTable, {
    docChanged: false,
    state: { doc: subDoc },
    effects: [setRecordsOpenEffect.of({ keys: ['cursor-sub-fold'], open: true })],
  });
  const subTableWidget = subExpanded.decorations.find((d) => d.spec.block && d.spec.widget?.rows)?.spec.widget;
  assert.ok(subTableWidget);
  assert.equal(subTableWidget.model.rows.some((r) => r.badgeKind === 'subagent' && r.badge === '子代理'), true);
  assert.equal(recordBadgeLabel('subagent', '子代理'), '子代理');
  plugin.settings.aiRecordViews = {};
  const subOutlineExpanded = field.update(subCollapsed, {
    docChanged: false,
    state: { doc: subDoc },
    effects: [setRecordsOpenEffect.of({ keys: ['cursor-sub-fold'], open: true })],
  });
  assert.ok(
    !subOutlineExpanded.decorations.some((d) => d.spec.inclusive === false && d.from <= subHeaderFrom && d.to >= subLastTo),
    'expanding parent reveals completed subagent subtree in Live Preview',
  );

  // Reading View (renderAIRecords) hides completed subagent <li> without creating an inner toggle button.
  const mkDomEl = (tag, doc) => {
    const el = {
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      ownerDocument: doc,
      parentNode: null,
      parentElement: null,
      childNodes: [],
      children: [],
      id: '',
      dataset: {},
      attrs: {},
      classList: {
        _set: new Set(),
        add(...cs) { cs.forEach((c) => this._set.add(c)); },
        remove(...cs) { cs.forEach((c) => this._set.delete(c)); },
        toggle(c, f) { if (f === undefined ? !this._set.has(c) : f) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      appendChild(c) {
        c.parentNode = this;
        c.parentElement = this;
        this.childNodes.push(c);
        if (c.nodeName !== '#text') this.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        c.parentNode = this;
        c.parentElement = this;
        const idx = this.childNodes.indexOf(ref);
        if (idx >= 0) this.childNodes.splice(idx, 0, c);
        else this.childNodes.push(c);
        if (c.nodeName !== '#text') {
          const cIdx = this.children.indexOf(ref);
          if (cIdx >= 0) this.children.splice(cIdx, 0, c);
          else this.children.push(c);
        }
        return c;
      },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.childNodes = this.parentNode.childNodes.filter((x) => x !== this);
        this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener() {},
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === 'li' && cur.nodeName === 'LI') return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const parts = sel.split(',').map((s) => s.trim());
        const out = [];
        const matchOne = (node, p) => {
          if (p === ':scope > p') return node.parentElement === this && node.nodeName === 'P';
          if (p === 'li ul, li ol' || p === 'li ul') return node.nodeName === 'UL' && node.parentElement?.nodeName === 'LI';
          if (p === 'ul, ol') return node.nodeName === 'UL' || node.nodeName === 'OL';
          if (p === 'li') return node.nodeName === 'LI';
          if (p === 'a[href]') return node.nodeName === 'A' && Boolean(node.attrs.href);
          if (p === 'span:nth-child(2)') return node.nodeName === 'SPAN' && this.children.filter((c) => c.nodeName === 'SPAN')[1] === node;
          if (p === 'li code') return node.nodeName === 'CODE' && node.parentElement?.nodeName === 'LI';
          return false;
        };
        const walk = (node) => {
          for (const c of node.children) {
            if (parts.some((p) => matchOne(c, p)) || matchOne(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      get textContent() { return this.childNodes.map((c) => c.textContent).join(''); },
      set textContent(v) { this.childNodes = [{ nodeName: '#text', nodeType: 3, textContent: String(v ?? ''), parentNode: this }]; this.children = []; },
    };
    return el;
  };
  const rvDoc = {
    createElement(tag) { return mkDomEl(tag, rvDoc); },
    createTextNode(txt) { return { nodeName: '#text', nodeType: 3, textContent: String(txt ?? '') }; },
    createTreeWalker() { return { nextNode: () => null }; },
  };
  const rootUl = mkDomEl('ul', rvDoc);
  const parentLi = mkDomEl('li', rvDoc);
  parentLi.dataset.line = '0';
  const parentP = mkDomEl('p', rvDoc);
  parentP.textContent = 'DOING 🤖 Cursor 主任务 ^cursor-sub-fold';
  parentLi.appendChild(parentP);
  const childUl = mkDomEl('ul', rvDoc);
  const liLink = mkDomEl('li', rvDoc); liLink.dataset.line = '1'; liLink.textContent = '🔗 Cursor：主任务';
  const liRound = mkDomEl('li', rvDoc); liRound.dataset.line = '2'; liRound.textContent = '第1轮：任务：排查；结论：已完成';
  const liSub = mkDomEl('li', rvDoc); liSub.dataset.line = '3';
  const subP = mkDomEl('p', rvDoc); subP.textContent = 'DONE 🤖 10:05-10:08 探索子代理';
  liSub.appendChild(subP);
  const subInnerUl = mkDomEl('ul', rvDoc);
  const liSubClock = mkDomEl('li', rvDoc); liSubClock.dataset.line = '4'; liSubClock.textContent = '⏱ 10:05–10:08 · 共 3m · 子代理 sub12345';
  const liSubSaid = mkDomEl('li', rvDoc); liSubSaid.dataset.line = '5'; liSubSaid.textContent = '💬 子代理发现根因';
  subInnerUl.appendChild(liSubClock);
  subInnerUl.appendChild(liSubSaid);
  liSub.appendChild(subInnerUl);
  childUl.appendChild(liLink);
  childUl.appendChild(liRound);
  childUl.appendChild(liSub);
  parentLi.appendChild(childUl);
  rootUl.appendChild(parentLi);

  plugin.settings.aiRecordDisplay = 'latest1';
  plugin.settings.aiRecordExpanded = {};
  plugin.settings.aiRecordClosed = {};
  const rvCleanup = renderAIRecords(rootUl, plugin, { getSectionInfo: () => ({ lineStart: 0, lineEnd: 5, text: subNote }), sourcePath: 'note.md' });
  assert.equal(liSub.classList.contains('ad-record-hidden'), true, 'Reading View hides completed subagent <li> when collapsed');
  assert.equal(liRound.classList.contains('ad-record-hidden'), false, 'Reading View keeps parent round conclusion visible');
  assert.equal(subInnerUl.dataset.adRecords, 'true', 'nested subagent list is marked to prevent duplicate toggle buttons');
  assert.equal(rootUl.querySelectorAll('button').length, 0, 'Reading View creates only the single parent toggle button (inside <p>, not nested inside subagent)');
  assert.equal(parentP.children.filter((c) => c.className === 'ad-records-toggle').length, 1);
  parentP.children.find((c) => c.className === 'ad-records-toggle').onclick();
  assert.equal(liSub.classList.contains('ad-record-hidden'), false, 'clicking parent toggle expands completed subagent <li> in Reading View');
  rvCleanup();
  assert.equal(subInnerUl.dataset.adRecords, undefined, 'cleanup removes adRecords marker from nested subagent list');

  console.log('\nPASS record view switcher, table rendering, per-block persistence, DONE/shift persistence, live updates and generic delegate arrow');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
