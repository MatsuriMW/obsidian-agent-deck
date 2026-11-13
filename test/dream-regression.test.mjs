import assert from 'node:assert/strict';
import { Dreaming } from '../src/dream.js';
import { DEFAULTS, journalPath, dayKeyToday } from '../src/constants.js';
function fixture() {
  const files = new Map(), settings = structuredClone(DEFAULTS);
  const vault = {getAbstractFileByPath:path=>files.has(path)?{path}:null,read:async f=>files.get(f.path),modify:async(f,t)=>files.set(f.path,t),process:async(f,fn)=>{files.set(f.path,fn(files.get(f.path)));},create:async(p,t)=>files.set(p,t),createFolder:async()=>{}};
  const p = {settings,jobs:{},app:{vault,plugins:{}},saveSettings:async()=>{},notice:()=>{}};
  return {p,files,path:journalPath(p.app,settings,dayKeyToday(settings))};
}
const {p,files,path}=fixture();
files.set(path,'- TODO 手写任务\n  - 💬 AI 结论\n    - 我喜欢英文回复（AI 嵌套解释）\n  - ❓ 第2轮：以后请用中文回复');
let dream = new Dreaming(p,async()=>JSON.stringify({memories:[]}));
let sources=await dream.collect();
assert.ok([...sources.values()].some(s=>s.kind==='ai'&&s.text.includes('AI 嵌套解释')),'AI 子项继承 AI 作者');
assert.ok([...sources.values()].some(s=>s.kind==='user'&&s.text.includes('以后请用中文回复')),'用户追问属于用户');
files.set(path,'- TODO '+ '甲'.repeat(6500));
await dream.run();
files.set(path,files.get(path)+'\n- 今天新增的重要事实');
sources=await dream.collect();
assert.ok([...sources.values()].some(s=>s.text.includes('今天新增的重要事实')),'长日志尾部也能采集');
console.log('PASS Dreaming regression: nested authorship, user questions and long journal tails');
const {parseMemories,memoryEntries,activeMemory,evidenceBlocks,relatedMemories}=await import('../src/dream.js');
const mkAnswer=(text,source,quote,kind='preference',replaces=[])=>JSON.stringify({memories:[{text,kind,sources:[source],quotes:[{source,text:quote}],replaces}]});
const sourceMap=new Map([['S1',{kind:'user',text:'以后请用中文回复'}]]);
assert.throws(()=>parseMemories(mkAnswer('偏好中文','S1','不存在的引语'),sourceMap),/摘录/);
assert.throws(()=>parseMemories(mkAnswer('偏好中文','S1','以后请用中文回复','preference',['unknown']),sourceMap),/替代/);
assert.deepEqual(evidenceBlocks('---\nprivate: metadata\n---\n- TODO 真正正文','a.md').map(s=>s.text),['- TODO 真正正文']);
// A backlog is drained over multiple runs without re-sending processed blocks.
{
  const {p,files,path}=fixture();
  files.set(path,Array.from({length:40},(_,i)=>'- TODO '+i+' '+ '字'.repeat(1600)).join('\n'));
  const sent=[];
  const d=new Dreaming(p,async prompt=>{sent.push(JSON.parse(prompt.split('材料（line 为原笔记起始行号）：\n')[1]));return '{"memories":[]}';});
  await d.run(); assert.ok(p.settings.dream.coverage.pending>0);
  const first=new Set(sent[0].map(s=>s.key));
  await d.run();assert.equal(p.settings.dream.coverage.pending,0);
  assert.ok(sent[1].every(s=>!first.has(s.key)));
  const count=sent.length;await d.run();assert.equal(sent.length,count);
  files.set(path,files.get(path)+'\n- TODO 后续新增记录');
  await d.run();assert.equal(sent.at(-1).length,1);assert.ok(sent.at(-1)[0].text.includes('后续新增记录'));
  // Pending work runs after one minute; errors retain the one-hour cooldown.
  p.settings.dream.enabled=true;p.settings.dream.coverage.pending=1;p.settings.dream.lastAttempt=Date.now()-61000;
  let ticks=0;d.run=async()=>ticks++;
  await d.tick();assert.equal(ticks,1);
  p.settings.dream.lastError='failure';await d.tick();assert.equal(ticks,1);
}
// Corrections preserve history; rejections and deletions survive reprocessing and restart.
{
  const {p,files,path}=fixture();
  files.set(path,'- TODO 以后请用中文回复 ^user-preference');
  let calls=0;
  let d=new Dreaming(p,async()=>{calls++;return mkAnswer('偏好中文回复','S1','以后请用中文回复');});
  await d.run();assert.equal(p.settings.dream.lastError,'');
  let memory=files.get(p.settings.dream.path),entry=memoryEntries(memory)[0];
  assert.ok(memory.includes('[[日记/'));assert.ok(memory.includes('#^user-preference]]'));assert.ok(memory.includes('原文：以后请用中文回复'));
  files.set(path,'- TODO 现在改用英文回复');
  d.model=async()=>mkAnswer('现在偏好英文回复','S1','现在改用英文回复','preference',[entry.id]);
  await d.run();memory=files.get(p.settings.dream.path);
  assert.equal(memoryEntries(memory)[0].state,'已被替代');
  assert.ok(!activeMemory(memory).includes('偏好中文回复'));assert.ok(activeMemory(memory).includes('现在偏好英文回复'));
  files.set(p.settings.dream.path,memory.replace('状态：有效','状态：已拒绝'));
  files.set(path,'- TODO 现在改用英文回复。再次记录');
  d.model=async()=>mkAnswer('现在偏好英文回复','S1','现在改用英文回复');
  await d.run();assert.equal(memoryEntries(files.get(p.settings.dream.path)).length,2);
  assert.ok(!activeMemory(files.get(p.settings.dream.path)).includes('现在偏好英文回复'));
  // Deleting a known entry also creates a persistent exclusion.
  files.set(p.settings.dream.path,'# 手工保留的内容');
  files.set(path,'- TODO 以后请用中文回复。再次记录');
  d=new Dreaming(p,async()=>mkAnswer('偏好中文回复','S1','以后请用中文回复'));
  await d.run();assert.equal(files.get(p.settings.dream.path),'# 手工保留的内容');
  assert.ok(p.settings.dream.states[p.settings.dream.path].rejected.length>=2);
  // A new target gets independent progress and does not inherit the old target's exclusions.
  p.settings.dream.path='另一份记忆.md';await d.run();assert.ok(files.get(p.settings.dream.path).includes('偏好中文回复'));
}
// Concurrent user edits are merged inside process(), not overwritten from an earlier read.
{
  const {p,files,path}=fixture();files.set(path,'- TODO 以后请用中文回复');
  files.set(p.settings.dream.path,'# 原有手写内容');
  const process=p.app.vault.process;
  p.app.vault.process=async(f,fn)=>{files.set(f.path,files.get(f.path)+'\n最后一刻手工追加');return process(f,fn);};
  const d=new Dreaming(p,async()=>mkAnswer('偏好中文回复','S1','以后请用中文回复'));
  await d.run();assert.ok(files.get(p.settings.dream.path).includes('最后一刻手工追加'));
  const original=files.get(p.settings.dream.path),entry=memoryEntries(original)[0];
  files.set(path,'- TODO 现在改用英文回复');
  d.model=async()=>{files.set(p.settings.dream.path,original.replace('偏好中文回复','手工修正后的偏好'));return mkAnswer('现在偏好英文回复','S1','现在改用英文回复','preference',[entry.id]);};
  await d.run();assert.ok(!files.get(p.settings.dream.path).includes('现在偏好英文回复'));
}
{
  const entries=Array.from({length:100},(_,i)=>`- **事实**：${i} ${'长记忆'.repeat(80)} ^dream-${String(i).padStart(24,'0')}\n  - 状态：有效`).join('\n');
  assert.ok(activeMemory(entries).length<=6000);
  assert.ok(activeMemory(entries).includes('99 '));
}
console.log('PASS Dreaming lifecycle: exact quotes, backlog, incremental processing, replacement, rejection, deletion, per-path state, atomic edits, bounded profile');
// Empty/deleted memory must clear the generated profile section as well.
{
  const {p,files,path}=fixture();
  p.settings.dream.syncProfile=true;
  p.app.plugins.getPlugin=()=>({companion:{cfg:{profilePath:'profile.md'}}});
  files.set('profile.md','# 用户手写档案');files.set(path,'- TODO 以后请用中文回复');
  const d=new Dreaming(p,async()=>mkAnswer('偏好中文回复','S1','以后请用中文回复'));
  await d.run();assert.ok(files.get('profile.md').includes('偏好中文回复'));
  files.delete(p.settings.dream.path);
  await d.run();assert.ok(!files.get('profile.md').includes('偏好中文回复'));assert.ok(files.get('profile.md').startsWith('# 用户手写档案'));
}
console.log('PASS deleting all memories also clears the generated Companion section');

{
  const entries=Array.from({length:200},(_,i)=>({id:'m-'+i,text:i===0?'偏好中文回复':'无关信息'+i+'甲'.repeat(200),state:'有效',kind:'preference'}));
  const context=relatedMemories(entries,new Map([['S1',{text:'以后请用中文回复'}]]));
  assert.ok(context.length<=16000);assert.equal(JSON.parse(context)[0].id,'m-0');
}
console.log('PASS bounded extraction context retrieves relevant early memories');
// Rejecting a manually edited entry must exclude its current wording too.
{
  const {p,files,path}=fixture();files.set(path,'- TODO 以后请用中文回复');
  const d=new Dreaming(p,async()=>mkAnswer('偏好中文回复','S1','以后请用中文回复'));
  await d.run();
  files.set(p.settings.dream.path,files.get(p.settings.dream.path).replace('偏好中文回复','只接受中文回复').replace('状态：有效','状态：已拒绝'));
  files.set(path,'- TODO 以后请用中文回复。新的证据');
  d.model=async()=>mkAnswer('只接受中文回复','S1','以后请用中文回复');
  await d.run();assert.equal(memoryEntries(files.get(p.settings.dream.path)).length,1);
}
// The batch budget includes IDs, paths, line numbers and JSON, not just prose.
{
  const {p,files,path}=fixture();files.set(path,Array.from({length:1000},(_,i)=>'- TODO 记录'+i).join('\n'));
  let payload;
  const d=new Dreaming(p,async prompt=>{payload=prompt.split('材料（line 为原笔记起始行号）：\n')[1];return '{"memories":[]}';});
  await d.run();assert.ok(payload.length<=48002);assert.ok(p.settings.dream.coverage.pending>0);
}
console.log('PASS edited-entry rejection and serialized evidence budget');
