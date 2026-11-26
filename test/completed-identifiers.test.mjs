import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class Menu{};',shortCircuit:true};return n(s,c)}`));
const J=await import('../src/journal.js');
const {planJournal,renderJournal}=await import('../src/organize-journal.js');
const {mergeArchive}=await import('../src/journal-archive.js');
const {JournalSync}=await import('../src/sync.js');
const {applyStatusChoice}=await import('../src/task-status.js');
const {adBlockIdRanges}=await import('../src/ai-records.js');
const sid='11111111-2222-4333-8444-555555555555';
const link=J.linkLine('  ','qoder','测试',sid);
const done=`- DONE 🤖 测试 ^${sid}\n${link}\n  - 💬 结果 <!-- ad-turn:${sid}:1 -->\n  - ⏱ 09:00–09:01 <!-- ad-clock:abc -->\n  - 手写备注 ^my-note\n  - 示例 \`<!-- ad-turn:${sid}:1 -->\`\n  - DOING 🤖 后续任务 ^ad-active\n    - 💬 活跃记录 <!-- ad-turn:other:1 -->\n  - 代码\n    ~~~md\n    - DONE 🤖 示例 ^ad-example\n    - 💬 示例 <!-- ad-turn:example:1 -->\n    ~~~`;
test('organize cleans finished AI identifiers and preserves links, notes, code, active children and handwritten tasks',()=>{
 const input=done+'\n- DONE 手写任务 ^personal\n  - 手写内容\n- DOING 🤖 活跃任务 ^ad-running';
 const output=renderJournal(planJournal(input));
 assert.ok(!output.includes('^'+sid));assert.ok(!output.includes(`结果 <!-- ad-turn:`));assert.ok(!output.includes('ad-clock:abc'));
 for(const text of [link,'手写备注 ^my-note',`示例 \`<!-- ad-turn:${sid}:1 -->\``,'^ad-active','活跃记录 <!-- ad-turn:other:1 -->','^ad-example','示例 <!-- ad-turn:example:1 -->','手写任务 ^personal','^ad-running'])assert.ok(output.includes(text),text);
 assert.equal(renderJournal(planJournal(output)),output);
});
test('new task IDs and provenance are compact, legacy rounds are recognized and sessions sharing a task stay distinct',()=>{
 const id=J.makeBlockId(sid);assert.match(id,/^ad-[a-z0-9]{10}$/);
 const options={sid,blockId:'ad-task',granularity:'round',rounds:[{n:1,said:'结果一'}]};
 let note=J.syncSessionEntry('- DOING 测试 ^ad-task',options).text;
 assert.ok(!note.includes(sid));assert.ok(note.includes(J.turnMarker(sid,1)));
 assert.equal(J.syncSessionEntry(note,options).text,note);
 const old=`- DOING 测试 ^ad-task\n  - 💬 保留旧记录 <!-- ad-turn:${sid}:1 -->`;
 assert.equal(J.syncSessionEntry(old,options).text,old);
 note=J.syncSessionEntry(note,{...options,sid:'other',rounds:[{n:1,said:'结果二'}]}).text;
 assert.ok(note.includes('结果一')&&note.includes('结果二'));
 assert.equal(J.syncSessionEntry(note,options).text,note);
});
test('each agent prefix works in binding, source hiding, organization and completion cleanup',()=>{
 for(const [agent,prefix] of Object.entries({antigravity:'agy',claude:'claude',codex:'codex',dsh:'dsh',workbuddy:'wb',opencode:'oc',qoder:'qoder'})){
  const id=J.makeBlockId(sid,agent);assert.match(id,new RegExp(`^${prefix}-[a-z0-9]{10}$`));
  const bound=J.bindInto('- TODO 测试',0,{sid,agent,title:'测试',ensureBlockId:true},{direct:true});
  assert.equal(bound.blockId,id);
  assert.equal(adBlockIdRanges(bound.text).filter(r=>bound.text.slice(r.from,r.to).includes('^'+id)).length,1);
  assert.equal(planJournal(bound.text).active.length,1);
  const done=J.cleanCompletedIdentifiers(bound.text.replace('DOING','DONE'));
  assert.ok(!done.includes('^'+id));assert.ok(J.parseLink(done.split('\n')[1]));
  const childBound=J.bindInto('- TODO 测试',0,{sid,agent,title:'测试',ensureBlockId:true});
  assert.equal(childBound.kind,'child');
  assert.equal(childBound.blockId,id);
  assert.ok(childBound.text.startsWith('- TODO 测试\n\t- DOING 🤖 '));
  const childDone=J.cleanCompletedIdentifiers(childBound.text.replace('DOING','DONE'));
  assert.ok(!childDone.includes('^'+id));assert.ok(J.parseLink(childDone.split('\n')[2]));
 }
 assert.equal(J.isDeckBlockId('codex-personal'),false,'custom IDs do not become generated IDs');
});
test('manual DONE removes identifiers immediately and subsequent scans cannot add them back',async()=>{
 let note=`- DOING 🤖 测试 ^ad-status\n${link}\n  - 💬 结果 <!-- ad-turn:${sid}:1 -->`;
 const p={settings:{manualTaskStates:{}},usage:{meta:new Map([[sid,{state:'run'}]]),archived:new Set()},viewForPath:()=>null,app:{vault:{getAbstractFileByPath:()=>({}),async process(f,fn){note=fn(note)}}},saveSettings:async()=>{},refreshUI(){}};
 await applyStatusChoice(p,{path:'test.md',raw:note.split('\n')[0]},'DONE');
 assert.ok(note.startsWith('- DONE'));assert.ok(!note.includes('^ad-'));assert.ok(!note.includes('<!-- ad-'));assert.ok(note.includes(link));
 const clean=note;assert.equal(new JournalSync(p).keywords(note),clean);
 assert.equal(J.syncSessionEntry(note,{sid,blockId:'ad-status',rounds:[{n:1,said:'结果'}]}).text,clean);
});
test('desktop archive completion cleans IDs, keeps links and remains stable on rescans',()=>{
 const p={settings:{},usage:{summary:()=>({list:[]}),meta:new Map([[sid,{agent:'qoder',state:'wait'}]]),archived:new Set([sid])}};
 const sync=new JournalSync(p);
 const note=sync.keywords(`- DOING 🤖 测试 ^ad-complete\n${link}\n  - 💬 结果 <!-- ad-turn:${sid}:1 -->`);
 assert.ok(note.startsWith('- DONE'));assert.ok(note.includes(link));assert.ok(!note.includes('^ad-'));assert.ok(!note.includes('<!-- ad-'));
 assert.equal(sync.keywords(note),note);
});
test('archive stores clean Markdown, dedupes retries after ID removal and detects edits',()=>{
 const body=`- DONE 🤖 测试 ^ad-done\n${link}\n  - 💬 结果 <!-- ad-turn:${sid}:1 -->`;
 const one=mergeArchive('',{date:'2026-11-15',blocks:[body]});
 assert.ok(!one.includes('^ad-'));assert.ok(!one.includes('<!-- ad-'));assert.ok(one.includes(link));
 assert.equal(mergeArchive(one,{date:'2026-11-15',blocks:[body]}),one);
 assert.throws(()=>mergeArchive(one,{date:'2026-11-15',blocks:[body.replace('结果','修改后的结果')]}),/内容不同/);
});
test('clean completed shared sessions stay stable and preserve CRLF, custom IDs and user text',()=>{
 const other=J.linkLine('  ','codex','另一个会话','other-session');
 const before=`- DONE 🤖 测试 ^ad-shared\n${link}\n${other}\n  - 💬 结果一 <!-- ad-turn:${sid}:1 -->\n  - 💬 结果二 <!-- ad-turn:other-session:1 -->\n- DONE 手写 ^custom\n  - 手写记录`;
 const clean=J.cleanCompletedIdentifiers(before.replaceAll('\n','\r\n'));
 assert.ok(!/[^\r]\n/.test(clean));assert.ok(clean.includes('手写 ^custom'));assert.ok(clean.includes(other));
 let note=J.cleanCompletedIdentifiers(before);
 for(const owner of [sid,'other-session'])note=J.syncSessionEntry(note,{sid:owner,blockId:'ad-shared',rounds:[{n:1,said:'重新扫描的结果'}]}).text;
 assert.equal(note,J.cleanCompletedIdentifiers(before));
});
