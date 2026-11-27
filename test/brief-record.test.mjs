import assert from 'node:assert/strict';
import { syncSessionEntry } from '../src/journal.js';
const base = '- DOING 修复缓存 ^ad-brief';
const args = { blockId: 'ad-brief', sid: 'brief-session', detail: 'brief', granularity: 'round', rounds: [{n:1,ask:'修复缓存；保留旧数据',said:'已修复缓存；旧数据保留；发布待验证'}] };
const note = syncSessionEntry(base,args).text;
assert.equal(note.split('\n').length,2,'one paragraph per round');
assert.ok(note.includes('第1轮：**任务**：修复缓存；保留旧数据；**结论**：已修复缓存；旧数据保留；发布待验证'));
assert.ok(!note.includes('💬'),'round records no longer include chat emoji');
assert.ok(!note.includes('❓'),'task and result share the same record');
assert.equal(syncSessionEntry(note,args).text,note,'no rewrite of a saved brief record');
const keywords = syncSessionEntry(base,{...args,rounds:[{n:1,ask:'长任务说明',taskSummary:'缓存、兼容',said:'长结果说明',summary:'修复；验证通过；待发布'}]}).text;
assert.ok(keywords.includes('第1轮：**任务**：缓存、兼容；**结论**：修复；验证通过；待发布'),'model keywords and result status stay intact');
const fallback = syncSessionEntry(base,{...args,rounds:[{n:1,said:'完成'}]}).text;
assert.ok(fallback.includes('第1轮：**任务**：修复缓存；**结论**：完成'),'missing prompt uses task title');
const long = syncSessionEntry(base,{...args,rounds:[{n:1,ask:'要求'.repeat(100),said:'结果'.repeat(200)}]}).text;
assert.ok(long.split('\n')[1].length < 220,'local fallback stays concise without a model call');
console.log('PASS brief record: task and result, keyword summaries, title fallback, single paragraph and preservation');

// Run the real polishing flow against a local fake CLI; no service is contacted.
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{}',shortCircuit:true};return next(s,c)}`));
const { JournalSync } = await import('../src/sync.js');
const { DEFAULTS, deepMerge } = await import('../src/constants.js');
const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
const { writeMockNodeBin } = await import('./helpers/mock-cli.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ad-brief-'));
let timer;
try {
  const bin = writeMockNodeBin(dir,'polish',`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({result:JSON.stringify({task:'缓存、兼容',result:'修复；测试通过；待发布'})})));\n`);
  const plugin = {settings:deepMerge(DEFAULTS,{autoLogPath:bin}),usage:{meta:new Map()}};
  const sync = new JournalSync(plugin);
  const polished = new Promise(resolve=>{sync.run=async()=>resolve();});
  const round = {n:1,ask:'请修复缓存，并保证兼容旧数据',said:'已修复缓存并保留旧数据，测试全部通过，尚未发布，需要在发布环境进一步核对缓存命中率。'};
  sync.queueRefineTurn('brief-session',round,round.said);
  await Promise.race([polished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('polishing timeout')),3000);})]);
  assert.equal(round.taskSummary,'缓存、兼容');
  assert.equal(round.summary,'修复；测试通过；待发布');
  assert.ok(syncSessionEntry(base,{...args,rounds:[round]}).text.includes('第1轮：**任务**：缓存、兼容；**结论**：修复；测试通过；待发布'));
  console.log('PASS brief polishing extracts task and result keywords through the real CLI flow');

  let capturedPrompt = '';
  const longQaResult = '核心判断：当前总结质量偏低主要是因为标准模式下被固定截断到了六十五字以内，同时长回复只截取末尾而丢失了开头给出的核心结论与因果依据，导致关键判断被直接丢弃。';
  const qaBin = writeMockNodeBin(dir, 'polish-qa', `
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      if (input.includes('TRIGGER_ERR')) { console.error('simulated cli error'); process.exit(1); }
      const fs = require('fs');
      fs.writeFileSync(${JSON.stringify(path.join(dir, 'captured-prompt.txt'))}, input);
      console.log(JSON.stringify({ result: JSON.stringify({ kind: 'qa', result: ${JSON.stringify(longQaResult)} }) }));
    });
  `);
  const pluginStd = {
    settings: deepMerge(DEFAULTS, {
      autoLogPath: qaBin,
      autoLogDetail: 'standard',
      conclusionMaxCode: 110,
      conclusionMaxQA: 220,
      summaryPrompt: '先写核心判断再写依据',
    }),
    usage: { meta: new Map() },
  };
  const syncStd = new JournalSync(pluginStd);
  const stdDone = new Promise((resolve) => { syncStd.run = async () => resolve(); });
  const longReply = '开头结论：之所以出现这个问题，是因为旧逻辑把结论截断在了 65 字以内。' + '补充分析段落。'.repeat(120) + '结尾备注：需要核对长回复头尾采样。';
  const stdRound = { n: 1, ask: '为什么结论这么差？', said: longReply };
  syncStd.queueRefineTurn('std-qa-session', stdRound, stdRound.said);
  await Promise.race([stdDone, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('std polishing timeout')), 3000); })]);
  clearTimeout(timer);
  capturedPrompt = fs.readFileSync(path.join(dir, 'captured-prompt.txt'), 'utf8');
  assert.ok(capturedPrompt.includes('不超过 110 字'), 'prompt uses conclusionMaxCode');
  assert.ok(capturedPrompt.includes('不超过 220 字'), 'prompt uses conclusionMaxQA');
  assert.ok(capturedPrompt.includes('补充要求：先写核心判断再写依据'), 'prompt appends summaryPrompt');
  assert.ok(capturedPrompt.includes('开头结论：之所以出现这个问题') && capturedPrompt.includes('结尾备注：需要核对长回复头尾采样'), 'prompt samples both head and tail');
  assert.equal(stdRound.summary, longQaResult, 'standard mode QA conclusion is not truncated at 65 chars');

  const failDone = new Promise((resolve) => { syncStd.run = async () => resolve(); });
  const failRound = { n: 2, ask: '触发错误', said: 'TRIGGER_ERR ' + 'x'.repeat(60) };
  syncStd.queueRefineTurn('std-qa-session', failRound, failRound.said);
  await Promise.race([failDone, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fail polishing timeout')), 3000); })]);
  assert.ok(syncStd._lastPolishErr.includes('simulated cli error'), `expected recorded polish error, got: ${syncStd._lastPolishErr}`);
  console.log('PASS standard polishing keeps custom QA cap, samples head+tail, and records errors');
} finally { clearTimeout(timer); fs.rmSync(dir,{recursive:true,force:true}); }
