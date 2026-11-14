import assert from 'node:assert/strict';
import { syncSessionEntry } from '../src/journal.js';
const base = '- DOING 修复缓存 ^ad-brief';
const args = { blockId: 'ad-brief', sid: 'brief-session', detail: 'brief', granularity: 'round', rounds: [{n:1,ask:'修复缓存；保留旧数据',said:'已修复缓存；旧数据保留；发布待验证'}] };
const note = syncSessionEntry(base,args).text;
assert.equal(note.split('\n').length,2,'one paragraph per round');
assert.ok(note.includes('任务：修复缓存；保留旧数据；结论：已修复缓存；旧数据保留；发布待验证'));
assert.ok(!note.includes('❓'),'task and result share the same record');
assert.equal(syncSessionEntry(note,args).text,note,'no rewrite of a saved brief record');
const keywords = syncSessionEntry(base,{...args,rounds:[{n:1,ask:'长任务说明',taskSummary:'缓存、兼容',said:'长结果说明',summary:'修复；验证通过；待发布'}]}).text;
assert.ok(keywords.includes('任务：缓存、兼容；结论：修复；验证通过；待发布'),'model keywords and result status stay intact');
const fallback = syncSessionEntry(base,{...args,rounds:[{n:1,said:'完成'}]}).text;
assert.ok(fallback.includes('任务：修复缓存；结论：完成'),'missing prompt uses task title');
const long = syncSessionEntry(base,{...args,rounds:[{n:1,ask:'要求'.repeat(100),said:'结果'.repeat(200)}]}).text;
assert.ok(long.split('\n')[1].length < 220,'local fallback stays concise without a model call');
console.log('PASS brief record: task and result, keyword summaries, title fallback, single paragraph and preservation');

// Run the real polishing flow against a local fake CLI; no service is contacted.
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{}',shortCircuit:true};return next(s,c)}`));
const { JournalSync } = await import('../src/sync.js');
const { DEFAULTS, deepMerge } = await import('../src/constants.js');
const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ad-brief-'));
let timer;
try {
  const bin = path.join(dir,'polish');
  fs.writeFileSync(bin, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({result:JSON.stringify({task:'缓存、兼容',result:'修复；测试通过；待发布'})})));\n`, {mode:0o755});
  const plugin = {settings:deepMerge(DEFAULTS,{autoLogPath:bin}),usage:{meta:new Map()}};
  const sync = new JournalSync(plugin);
  const polished = new Promise(resolve=>{sync.run=async()=>resolve();});
  const round = {n:1,ask:'请修复缓存，并保证兼容旧数据',said:'已修复缓存并保留旧数据，测试全部通过，尚未发布，需要在发布环境进一步核对缓存命中率。'};
  sync.queueRefineTurn('brief-session',round,round.said);
  await Promise.race([polished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('polishing timeout')),3000);})]);
  assert.equal(round.taskSummary,'缓存、兼容');
  assert.equal(round.summary,'修复；测试通过；待发布');
  assert.ok(syncSessionEntry(base,{...args,rounds:[round]}).text.includes('任务：缓存、兼容；结论：修复；测试通过；待发布'));
  console.log('PASS brief polishing extracts task and result keywords through the real CLI flow');
} finally { clearTimeout(timer); fs.rmSync(dir,{recursive:true,force:true}); }
