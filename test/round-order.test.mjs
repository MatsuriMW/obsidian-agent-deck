import assert from 'node:assert/strict';
import {test} from 'node:test';
import {syncSessionEntry, makeBlockId, findTask} from '../src/journal.js';
import {aiRecordGroups, visibleRecords} from '../src/ai-records.js';
const sid='01a1da68-9fa5-7c61-809c-cb42b8a3a43a';
const rounds=[1,2,3].map(n=>({n,at:n*100,ask:`问题${n}`,said:`结论${n}`}));
const write=(text,detail='brief')=>syncSessionEntry(text,{sid,blockId:'ad-order',granularity:'round',detail,rounds}).text;
test('recover missing early rounds and sort newest first without changing saved content',()=>{
 const old=`- DOING task ^ad-order\n\t- 手写说明\n\t- 💬 第3轮：保留这条用户编辑的结论 <!-- ad-turn:${sid}:3 -->\n\t- TODO 子任务\n\t\t- 💬 第99轮：子任务记录\n`;
 const result=write(old);
 for(const line of old.trimEnd().split('\n')) assert.ok(result.split('\n').includes(line));
 const nums=[...result.matchAll(/<!-- ad-turn:[^:]+:(\d+) -->/g)].map(m=>+m[1]);
 assert.deepEqual(nums,[3,2,1]);assert.equal(write(result),result);
});
test('detailed records keep questions and answers together in descending order',()=>{
 const text=write('- DOING task ^ad-order','detailed');
 assert.ok(text.indexOf('❓ 第3轮')<text.indexOf('💬 第3轮'));
 assert.ok(text.indexOf('💬 第3轮')<text.indexOf('❓ 第2轮'));
 assert.ok(text.indexOf('💬 第2轮')<text.indexOf('❓ 第1轮'));
});
test('latest display selects the newest conclusion in both source orders',()=>{
 const descending=write('- DOING task ^ad-order');
 for(const text of [descending,descending.split('\n').slice(0,1).concat(descending.split('\n').slice(1).reverse()).join('\n')]) {
  const lines=text.split('\n'),group=aiRecordGroups(text)[0];
  const shown=visibleRecords(group,lines,'latest1');assert.equal(shown.length,1);assert.ok(lines[shown[0]].includes('结论3'));
 }
});
test('timestamp UUIDs from different sessions cannot share the same task ID',()=>{
 const other='01a1da61-bd3d-7ce3-bb9e-162c2e928b34';
 assert.notEqual(makeBlockId(sid),makeBlockId(other));assert.equal(makeBlockId(sid),makeBlockId(sid));
});
test('explicit session links override a legacy colliding block ID',()=>{
 const other='01a1da61-bd3d-7ce3-bb9e-162c2e928b34';
 const text=`- DOING other ^ad-legacy\n\t- 🔗 [Codex](codex://threads/${other})\n- DOING task ^ad-current\n\t- 🔗 [Codex](codex://threads/${sid})`;
 assert.equal(findTask(text,'task','ad-legacy',sid).line,2);
 const result=syncSessionEntry(text,{sid,blockId:'ad-legacy',rounds:[rounds[0]],granularity:'round'}).text;
 assert.ok(result.indexOf('结论1')>result.indexOf('- DOING task'));
});
