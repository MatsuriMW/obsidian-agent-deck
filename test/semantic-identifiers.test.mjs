import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as J from '../src/journal.js';
import { adBlockIdRanges } from '../src/ai-records.js';
import { planJournal, renderJournal } from '../src/organize-journal.js';
const sid='11111111-2222-4333-8444-555555555555';
test('semantic IDs include agent, short task name and a collision-resistant suffix',()=>{
 const id=J.makeBlockId(sid,'antigravity','journal-cleanup');
 assert.match(id,/^agy-journal-cleanup-[a-z0-9]{10}$/);
 assert.equal(id,J.makeBlockId(sid,'antigravity','journal-cleanup'));
 assert.notEqual(id,J.makeBlockId('different-session','antigravity','journal-cleanup'));
});
test('semantic and legacy IDs share tracking, hiding and DONE cleanup without changing user IDs',()=>{
 const id=J.makeBlockId(sid,'qoder','journal-cleanup');
 assert.ok(J.isDeckBlockId(id));
 const note=`- DOING 🤖 整理日志 ^${id}\n  - 💬 结论`;
 assert.equal(adBlockIdRanges(note).length,1);
 assert.equal(planJournal(note).active.length,1);
 assert.ok(!renderJournal(planJournal(note.replace('DOING','DONE'))).includes('^'+id));
 for(const old of ['ad-old','qoder-0123456789','agy-0123456789'])assert.ok(J.isDeckBlockId(old));
 assert.equal(J.isDeckBlockId('qoder-my-personal-note'),false);
 const legacy=J.syncSessionEntry('- DOING 🤖 原任务 ^ad-legacy',{sid,agent:'qoder',slug:'new-task',blockId:'ad-legacy',rounds:[{n:1,said:'结论'}]});
 assert.equal(legacy.blockId,'ad-legacy');
});
test('Chinese names use the configured naming model once and remain stable across renames and concurrent calls',async()=>{
 const {semanticTaskId}=await import('../src/task-id.js');
 const plugin={settings:{autoLogProvider:'codex'}};let calls=0;
 const model=async(prompt,settings)=>{calls++;assert.equal(settings,plugin.settings);assert.ok(prompt.includes('整理日志'));return '{"slug":"journal-cleanup"}'};
 const [one,two]=await Promise.all([semanticTaskId(plugin,sid,'antigravity','整理日志',model),semanticTaskId(plugin,sid,'antigravity','整理日志',model)]);
 assert.equal(one,two);assert.match(one,/^agy-journal-cleanup-/);assert.equal(calls,1);
 assert.equal(await semanticTaskId(plugin,sid,'antigravity','修改后的任务标题',model),one);assert.equal(calls,1);
});
test('short English labels need no model call; failed or invalid translations preserve delegation with stable legacy IDs',async()=>{
 const {semanticTaskId}=await import('../src/task-id.js');
 const plugin={settings:{}};
 const id=await semanticTaskId(plugin,'english','codex','Journal cleanup',()=>assert.fail('already a short English label'));
 assert.match(id,/^codex-journal-cleanup-/);
 let calls=0;
 const failure=async()=>{calls++;throw Error('offline')};
 const one=await semanticTaskId(plugin,'offline','qoder','整理日志',failure);
 assert.equal(one,J.makeBlockId('offline','qoder'));
 assert.equal(await semanticTaskId(plugin,'offline','qoder','新标题',failure),one);assert.equal(calls,1);
 for(const value of ['{"slug":"这是中文"}','{"slug":"one-two-three"}','{"slug":"../../secret"}']){
  const p={settings:{}};
  assert.equal(await semanticTaskId(p,sid,'qoder','整理日志',async()=>value),J.makeBlockId(sid,'qoder'));
 }
});
test('delegation writes the prepared semantic ID against fresh note contents and preserves existing IDs',async()=>{
 const {Delegator}=await import('../src/delegation.js');
 const {DEFAULTS,deepMerge}=await import('../src/constants.js');
 let note='- TODO 整理日志';let names=0;
 const expected=J.makeBlockId(sid,'qoder','journal-cleanup');
 const p={settings:deepMerge(DEFAULTS,{}),jobs:{},readNote:async()=>note,writeNote:async(path,text)=>{note=text},saveSettings(){},refreshUI(){},notice(){},
  taskBlockId:async()=>{names++;note+='\n  - 用户刚输入的补充';return expected}};
 const d=new Delegator(p);
 const job={agent:'qoder',name:'整理日志',path:'test.md',lineText:'- TODO 整理日志'};
 await d.writeLink(job,sid);
 assert.equal(job.blockId,expected);assert.ok(note.includes('用户刚输入的补充'));
 await d.writeLink(job,'another-session');assert.equal(job.blockId,expected);assert.equal(names,1);
 assert.ok(note.includes(sid)&&note.includes('another-session'));
});
test('manual binding waits for naming, relocates the task after edits and preserves the new text',async()=>{
 const fs=await import('node:fs');const {runInNewContext}=await import('node:vm');
 const {dayKeyToday,fmtClock,AGENTS}=await import('../src/constants.js');
 const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('  async bindSessionAt('),end=source.indexOf('  // 把笔记里的第',start);
 class MarkdownView{}
 let note='- TODO 整理日志';const cm={state:{doc:{toString:()=>note}}};
 const view=new MarkdownView();view.file={path:'test.md'};view.editor={cm,transaction({changes:[change]}){
  const lines=note.split('\n');const offset=p=>lines.slice(0,p.line).reduce((n,line)=>n+line.length+1,0)+p.ch;
  note=note.slice(0,offset(change.from))+change.text+note.slice(offset(change.to));
 }};
 const bind=runInNewContext('({'+source.slice(start,end)+'}).bindSessionAt',{MarkdownView,J,dayKeyToday,fmtClock,AGENTS,Date,t:x=>x,setTimeout(){}});
 const id=J.makeBlockId(sid,'antigravity','journal-cleanup');
 const p={settings:{},app:{workspace:{iterateAllLeaves(fn){fn({view})}}},usage:{meta:new Map(),summary:()=>null},liveSessions:()=>[],
  taskBlockId:async()=>{note='- 用户新增笔记\n'+note;return id},markBound(){},notice(){},refreshUI(){},journalSync:{run:async()=>{}}};
 await bind.call(p,cm,0,{agent:'antigravity',sid,title:'整理日志'});
 assert.ok(note.startsWith('- 用户新增笔记\n'));assert.ok(note.includes('^'+id));assert.equal(p.settings.taskBindings[sid].blockId,id);
});
test('scan writeback prepares a semantic ID before saving the first result',async()=>{
 const {register}=await import('node:module');
 register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};',shortCircuit:true};return n(s,c)}`));
 const {JournalSync}=await import('../src/sync.js');
 const text='- DOING 🤖 整理日志\n'+J.linkLine('  ','qoder','整理日志',sid);
 const id=J.makeBlockId(sid,'qoder','journal-cleanup');let calls=0;
 const p={settings:{roundPolish:false},usage:{archived:new Set(),meta:new Map([[sid,{agent:'qoder',state:'wait',lastText:'完成整理',rounds:[{n:1,said:'完成整理'}]}]])},taskBlockId:async()=>{calls++;return id}};
 const sync=new JournalSync(p);sync.queueRefineTurn=()=>{};sync.queueMerge=()=>{};
 const ids=await sync.prepareTaskIds(text);const output=sync.results(text,ids);
 assert.ok(output.includes('^'+id));assert.ok(output.includes('完成整理'));assert.equal(calls,1);
 await sync.prepareTaskIds(output);await sync.prepareTaskIds(output.replace('DOING','DONE'));assert.equal(calls,1);
});
