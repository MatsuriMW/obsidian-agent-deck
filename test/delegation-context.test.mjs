import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { register } from 'node:module';
import * as J from '../src/journal.js';
import { blockAt, ancestorLines, delegationText, freshTaskText, hasLink, Delegator } from '../src/delegation.js';
import { aiRecordGroups } from '../src/ai-records.js';
import { DEFAULTS, deepMerge } from '../src/constants.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{}',shortCircuit:true};return next(s,c)}`));
const { AutoLog } = await import('../src/autolog.js');
const sid = '11111111-2222-3333-4444-555555555555';
const lines = [
  '- DOING 原始任务 ^ad-parent',
  '  - 💬 AI 分析结果 <!-- ad-turn:original:1 -->',
  '    - 用户补充：采用方案二',
  '      - TODO 验证方案 @codex',
  '        - ❓ 用户改写的验收标准',
  '        - 💬 上次验证结果',
  '    - 另一条讨论分支',
  '  - 💬 其他兄弟记录',
];
const block = blockAt(lines, 3);
const context = ancestorLines(lines, 3);
assert.deepEqual(context, lines.slice(0, 3));
const text = delegationText(lines, block, { newSession: true });
for (const required of ['原始任务', 'AI 分析结果', '用户补充', '验证方案', '用户改写的验收标准', '上次验证结果']) assert.ok(text.includes(required), required);
for (const excluded of ['另一条讨论分支', '其他兄弟记录']) assert.ok(!text.includes(excluded), excluded);
assert.equal(freshTaskText(lines.slice(1, 6).join('\n')), lines.slice(1, 6).join('\n'), 'an AI reply can itself be the new task root');
const d = new Delegator({ settings: deepMerge(DEFAULTS, {}), jobs: {}, vaultPath: '/tmp' });
assert.ok(d.buildPrompt({ block, newSession: true, contextLines: context }).includes('上次验证结果'));
const nestedLink = [...lines.slice(0, 6), `        - 🔗 [Codex](codex://threads/${sid})`];
assert.equal(hasLink(nestedLink, blockAt(nestedLink, 0)), -1, 'a child binding does not bind the parent');
assert.equal(hasLink(nestedLink, blockAt(nestedLink, 3)), 6);
assert.ok(!aiRecordGroups(lines.join('\n'))[0].records.includes(1), 'an AI reply with user descendants is never hidden independently');
const delegated = `    - DELEGATED 💬 AI 分析结果 ^ad-reply\n      - 🔗 [Codex](codex://threads/${sid})`;
assert.equal(J.taskItems(delegated)[0]?.blockId, 'ad-reply', 'a delegated reply owns its own session and results');

const args = { sid, blockId: 'ad-summary', compact: { through: 2, text: '初始总结' } };
let note = J.syncSessionEntry('- DOING 任务 ^ad-summary', args).text;
note = note.replace('初始总结', '用户改写的总结') + '\n\t\t- TODO 在总结下继续验证';
const saved = note;
assert.equal(J.syncSessionEntry(note, args).text, saved, 'same summary never overwrites user edits');
note = J.syncSessionEntry(note, { ...args, compact: { through: 3, text: '下一次总结' } }).text;
assert.ok(note.includes(saved), 'a new summary preserves the prior summary and subtree');
assert.ok(note.includes('下一次总结'));
assert.equal(J.syncSessionEntry(note, { ...args, compact: { through: 3, text: '下一次总结' } }).text, note);
const al = new AutoLog({ settings: deepMerge(DEFAULTS, {}) });
const rec = { key: '🤖 原始标题', label: '🤖 原始标题', blockId: 'ad-title', created: true };
assert.ok(al.autoLine('- DOING 10:00 🤖 用户改写的标题 ^ad-title', rec, { sid, segs: [[60, 120]] }, 'paused').text.includes('用户改写的标题'));

// Exercise the actual UI entry point without starting an agent or opening Obsidian.
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('  async delegateTarget('), end = source.indexOf('\n  async delegateDrop(', start);
const target = vm.runInNewContext('({' + source.slice(start, end) + '})', { blockAt, J, findLink: (ls, b) => hasLink(ls, b) >= 0, t: x => x });
const auto = '- DOING 🤖 自动记录 ^ad-auto\n  - 💬 可继续的上下文\n  - ⏱ 10:00–11:00';
target.app = { vault: { getAbstractFileByPath: () => ({path:'note.md'}), read: async () => auto } };
target.viewForPath = () => null;
assert.ok(!(await target.delegateTarget({path:'note.md',line:0,lineText:auto.split('\n')[0]})).error, 'auto records remain available for delegation');
console.log('PASS accumulated AI context, subtree boundaries, protected summaries and titles, and delegation entry');

const multilines = ['- 项目', '  母块的补充说明', '  ```md', '  - 代码示例，不能当母块', '  ```', '  - 💬 分析结果', '    结果的补充说明', '    - TODO 执行'];
assert.deepEqual(ancestorLines(multilines, 7), multilines.slice(0, 7));
assert.deepEqual(ancestorLines(['- 旧项目', '## 新章节', '  - TODO 独立任务'], 2), [], 'a heading ends the former ancestor chain');
let clockNote = al.autoClock('- DONE 任务 ^ad-clock', '任务', [[60,120]], 'Codex', 0, '', 'ad-clock');
clockNote = clockNote.replace('Codex', 'Codex，用户补充了说明') + '\n\t\t- 用户在用时记录下继续写';
const beforeClock = clockNote;
clockNote = al.autoClock(clockNote, '任务', [[60,180]], 'Codex', 0, '', 'ad-clock');
assert.ok(clockNote.includes(beforeClock), 'clock updates preserve a reused record and its descendants');
const childClock = '- DONE 任务 ^ad-clock\n\t- TODO 子任务\n\t\t- ⏱ 用户写的时间';
assert.ok(al.autoClock(childClock, '任务', [[60,120]], 'Codex', 0, '', 'ad-clock').includes(childClock), 'parent statistics never replace a nested task clock');
const editedClock = al.autoClock('- DONE 任务 ^ad-clock', '任务', [[60,120]], 'Codex', 0, '', 'ad-clock').replace('Codex', '用户改过的说明');
assert.ok(al.autoClock(editedClock, '任务', [[60,180]], 'Codex', 0, '', 'ad-clock').includes(editedClock), 'an edited clock without children is retained too');

// A reply delegated as its own task keeps the original turn identity.
let replay = J.syncSessionEntry('- DOING 原任务 ^ad-origin', {sid:'original',blockId:'ad-origin',granularity:'round',rounds:[{n:1,said:'原 AI 结果'}]}).text;
const replyIndex = replay.split('\n').findIndex(line=>line.includes('💬'));
let current = replay;
const writer = new Delegator({settings:deepMerge(DEFAULTS,{}),jobs:{},vaultPath:'/tmp',readNote:async()=>current,writeNote:async(_,text)=>{current=text;},saveSettings(){}});
await writer.writeLink({agent:'codex',path:'note.md',lineText:current.split('\n')[replyIndex],name:'继续处理'},sid);
const original = current;
current=J.syncSessionEntry(current,{sid:'original',blockId:'ad-origin',granularity:'round',rounds:[{n:1,said:'原 AI 结果'}]}).text;
assert.equal(current,original,'parent sync never duplicates or overwrites a delegated reply');
const childId=J.blockIdOf(current.split('\n')[replyIndex]);
current=J.syncSessionEntry(current,{sid,blockId:childId,rounds:[{n:1,ask:'继续验证',said:'子任务验证通过'}]}).text;
assert.ok(current.includes('子任务验证通过') && current.includes('ad-turn:original:1'));
assert.ok(J.width(current.split('\n').find(line=>line.includes('子任务验证通过')))>J.width(current.split('\n')[replyIndex]),'new results belong under the delegated reply');

const editorSource=fs.readFileSync(new URL('../src/editor.js',import.meta.url),'utf8');
const decorStart=editorSource.indexOf('function buildDecorations('),decorEnd=editorSource.indexOf('\nexport function createEditorExtension',decorStart);
const decorate=vm.runInNewContext(editorSource.slice(decorStart,decorEnd)+'\nbuildDecorations',{J,BULLET_RE:/^(\s*)([-*+]|\d+[.)])\s+(.*)$/,RangeSetBuilder:class{constructor(){this.ranges=[];}add(from,to,spec){this.ranges.push(spec);}finish(){return this.ranges;}},Decoration:{widget:x=>x},GripWidget:class{constructor(){this.grip=true;}},PillWidget:class{}});
const record='  - 💬 可再次委派的 AI 结果';
const view={state:{field:()=>({file:{path:'note.md'}}),doc:{lineAt:()=>({number:1,from:0,to:record.length,text:record})},selection:{main:{empty:true,head:0}}},visibleRanges:[{from:0,to:record.length}]};
assert.ok(decorate(view,{settings:{showEditorPills:true},_lastEditor:view,lineMap:()=>({sessionByParent:new Map()}),jobAtLine(){}}).some(item=>item.widget.grip),'reply lines expose the real paper-plane entry');
console.log('PASS nested reply delegation, parent/child writeback and AI reply paper plane');
