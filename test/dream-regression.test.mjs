import assert from 'node:assert/strict';
import { Dreaming } from '../src/dream.js';
import { DEFAULTS, journalPath, dayKeyToday } from '../src/constants.js';
function fixture() {
  const files = new Map(), settings = structuredClone(DEFAULTS);
  const vault = {getAbstractFileByPath:p=>{if(files.has(p))return{path:p};const prefix=p.endsWith('/')?p:`${p}/`;const children=[...files.keys()].filter(k=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/')).map(k=>({path:k}));return children.length?{path:p,children}:null;},read:async f=>files.get(f.path),modify:async(f,t)=>files.set(f.path,t),process:async(f,fn)=>{files.set(f.path,fn(files.get(f.path)));},create:async(p,t)=>files.set(p,t),createFolder:async()=>{}};
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
{
  const {p,files,path}=fixture();
  const privatePath='公开目录/私密.md', excludedPath='排除/子目录/不发送.md';
  p.settings.delegate.excludedDirs=['排除'];
  p.jobs={ private:{path:privatePath}, excluded:{path:excludedPath} };
  const publicText='- TODO 用户原话 ^source-block\n  - 💬 AI 结论';
  files.set(path,publicText);
  files.set(privatePath,'---\nprivate: true\n---\n- TODO 私密内容');
  files.set(excludedPath,'- TODO 排除目录内容');
  const prompts=[];
  const d=new Dreaming(p,async prompt=>{prompts.push(prompt);return '{"memories":[]}';});
  const found=await d.collect();
  assert.deepEqual([...found.values()],evidenceBlocks(publicText,path));
  assert.equal(p.settings.dream.coverage,null,'collecting evidence alone does not update Dreaming state');
  await d.run();
  assert.equal(prompts.length,1);
  assert.match(prompts[0],/用户原话/);
  assert.doesNotMatch(prompts[0],/私密\.md|私密内容|不发送\.md|排除目录内容/);
  assert.equal(p.settings.dream.coverage.files,1);
}
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
  await d.run(true,{drain:true});assert.equal(p.settings.dream.coverage.pending,0);
}
// Tolerant Dreaming: invalid AI-only preference item does not block valid lesson items or stall progress; dividers skipped; dream model inherits autoLog or overrides separately.
{
  const { dreamModelConfig } = await import('../src/dream.js');
  const inherited = dreamModelConfig({ autoLogProvider: 'agy', autoLogModel: 'gemini-3.8-flash-low', dream: { provider: '', model: '' } });
  assert.equal(inherited.autoLogProvider, 'agy');
  assert.equal(inherited.autoLogModel, 'gemini-3.8-flash-low');
  const switched = dreamModelConfig({ autoLogProvider: 'agy', autoLogModel: 'gemini-3.8-flash-low', dream: { provider: 'codex', model: '' } });
  assert.equal(switched.autoLogProvider, 'codex');
  assert.equal(switched.autoLogModel, '');

  const blocks = evidenceBlocks('- ---\n- [x] DONE 01:00-02:00 🤖 完成构建\n  - 💬 通过测试 <!-- ad-turn:s1:1 -->\n  - ❓ 明天看下性能', 'a.md');
  assert.equal(blocks.some(b => /^- ---$/.test(b.text)), false);
  assert.equal(blocks.find(b => b.text.includes('完成构建')).kind, 'ai');
  assert.equal(blocks.find(b => b.text.includes('通过测试')).text.includes('ad-turn'), false);

  const { p, files, path } = fixture();
  files.set(path, '- DOING 🤖 修复打包\n  - 💬 先验证本地构建再发布');
  let usedCfg = null;
  const d = new Dreaming(p, async (_prompt, cfg) => {
    usedCfg = cfg;
    return JSON.stringify({
      memories: [
        { text: '用户偏好先构建', kind: 'preference', sources: ['S2'], quotes: [{ source: 'S2', text: '先验证本地构建再发布' }], replaces: [] },
        { text: '先验证本地构建再发布', kind: 'lesson', sources: ['S2'], quotes: [{ source: 'S2', text: '先验证本地构建再发布' }], replaces: [] },
      ],
    });
  });
  p.settings.autoLogProvider = 'agy';
  p.settings.autoLogModel = 'gemini-3.8-flash-low';
  p.settings.dream.model = 'gemini-3.8-flash-medium';
  await d.run();
  assert.equal(usedCfg.autoLogModel, 'gemini-3.8-flash-medium');
  assert.equal(p.settings.dream.lastError, '');
  const saved = files.get(p.settings.dream.path) || '';
  assert.ok(saved.includes('先验证本地构建再发布') && !saved.includes('用户偏好先构建'));
}
// Dreaming scope "ai-records": filters out standalone prose, manual todos and non-AI siblings, while preserving 🤖 trees and bound tasks with AI child records.
{
  const md = [
    '今天去公园散步了。',
    '',
    '- TODO 纯手写待办',
    '  - 个人备忘，没用 AI',
    '- DOING [[Agent Deck]]',
    '  - 手写子备注（无 AI）',
    '  - DONE 🤖 09:00-09:15 实现分形看板',
    '    - ❓ 只保留关键设计',
    '    - 💬 已写入路线图',
    '      - AI 嵌套解释内容',
    '- DOING 修超时 bug ^codex-fix-123',
    '  - 🔗 [Codex](codex://threads/123)',
    '  - 💬 修复了重试机制',
    '```md',
    '- DONE 🤖 代码块示例不应被采纳',
    '```',
  ].join('\n');
  const aiOnlyBlocks = evidenceBlocks(md, 'note.md', { aiOnly: true });
  const joined = aiOnlyBlocks.map((b) => b.text).join('\n');
  assert.equal(joined.includes('今天去公园散步了'), false);
  assert.equal(joined.includes('纯手写待办'), false);
  assert.equal(joined.includes('个人备忘'), false);
  assert.equal(joined.includes('手写子备注'), false);
  assert.equal(joined.includes('代码块示例'), false);
  assert.ok(joined.includes('实现分形看板'));
  assert.ok(joined.includes('只保留关键设计'));
  assert.ok(joined.includes('AI 嵌套解释内容'));
  assert.ok(joined.includes('修超时 bug'));
  assert.ok(joined.includes('修复了重试机制'));
  assert.equal(aiOnlyBlocks.find((b) => b.text.includes('只保留关键设计')).kind, 'user');
  assert.equal(aiOnlyBlocks.find((b) => b.text.includes('AI 嵌套解释内容')).kind, 'ai');
  assert.equal(aiOnlyBlocks.find((b) => b.text.includes('修超时 bug')).kind, 'user');

  const { p, files, path } = fixture();
  p.settings.dream.scope = 'ai-records';
  files.set(path, md);
  const d = new Dreaming(p, async () => JSON.stringify({
    memories: [{ text: '写规格时只保留关键设计', kind: 'preference', sources: ['S2'], quotes: [{ source: 'S2', text: '只保留关键设计' }], replaces: [] }],
  }));
  const collected = await d.collect();
  assert.equal([...collected.values()].some((s) => s.text.includes('纯手写待办')), false);
  await d.run();
  const saved = files.get(p.settings.dream.path) || '';
  assert.ok(saved.includes('写规格时只保留关键设计'));
}
// Sleep-Time Consolidation + dropped reporting + files-mode wording edit does not pollute rejected.
{
  const { parseConsolidationPlan } = await import('../src/dream.js');
  const { serializeMemoryFile, parseMemoryFile } = await import('../src/memory-store.js');
  const { p, files, path } = fixture();
  p.settings.dream.store = 'files';
  p.settings.dream.autoAnchor = false;
  files.set(path, '- TODO 以后测试\n  - 💬 AI 记录：仅 AI 的经验');
  const d = new Dreaming(p, async () => JSON.stringify({
    memories: [
      { text: 'AI 记录不能生成事实', kind: 'fact', sources: ['S2'], quotes: [{ source: 'S2', text: '仅 AI 的经验' }], replaces: [] },
      { text: 'AI 记录可以沉淀项目经验', kind: 'lesson', project: 'agent-deck', sources: ['S2'], quotes: [{ source: 'S2', text: '仅 AI 的经验' }], replaces: [] },
    ],
  }));
  await d.run();
  assert.equal(p.settings.dream.coverage.dropped, 1, '被核验丢弃的候选数应显式记入 coverage');
  assert.ok(p.settings.dream.coverage.droppedReasons.length >= 1);

  // Sleep-time consolidation merges near-duplicates, preserves verified items, and inherits sources + supersedes.
  const activeMock = [
    { id: 'm-1', kind: 'lesson', text: '旧条一', verified: false, date: '2026-11-18', sources: ['[[日记/2026_11_18]]'] },
    { id: 'm-2', kind: 'lesson', text: '旧条二', verified: false, date: '2026-11-19', sources: ['[[日记/2026_11_19]]'] },
    { id: 'm-v', kind: 'fact', text: '已确认事实', verified: true, date: '2026-11-19', sources: ['[[日记/2026_11_19]]'] },
  ];
  const parsedPlan = parseConsolidationPlan(JSON.stringify({
    merges: [{ keepText: '合并后的经验', kind: 'lesson', project: 'agent-deck', tags: ['build'], fromIds: ['m-1', 'm-2'] }],
    deprecate: [{ id: 'm-v', reason: 'verified 不得被自动淘汰' }],
    conflicts: [{ ids: ['m-1', 'm-v'], reason: '示例冲突' }],
  }), activeMock.map(e => ({ ...e, state: '有效' })));
  assert.equal(parsedPlan.merges.length, 1);
  assert.equal(parsedPlan.deprecate.length, 0, 'verified:true 条目受护栏保护绝不自动淘汰');

  files.set('Agent Deck/记忆/2026-11-18-a.md', serializeMemoryFile({ id: 'm-a1', kind: 'lesson', text: 'esbuild 打包不能包含 obsidian', date: '2026-11-18', project: 'agent-deck', sources: ['[[日记/2026_11_18]]'] }));
  files.set('Agent Deck/记忆/2026-11-19-b.md', serializeMemoryFile({ id: 'm-b1', kind: 'lesson', text: '用 esbuild 构建插件需把 obsidian 设为 external', date: '2026-11-19', project: 'agent-deck', sources: ['[[日记/2026_11_19]]'] }));
  d.model = async () => JSON.stringify({
    merges: [{ keepText: '使用 esbuild 打包插件时必须将 obsidian 设为 external', kind: 'lesson', project: 'agent-deck', tags: ['esbuild'], fromIds: ['m-a1', 'm-b1'] }],
    deprecate: [],
    conflicts: [],
  });
  const cons = await d.consolidate({ manual: false });
  assert.equal(cons.merged, 1);
  const allEntries = await d.loadEntries();
  const mergedEntry = allEntries.find(e => e.text.includes('external') && e.state === '有效');
  assert.ok(mergedEntry, '合并后生成有效新记忆');
  assert.equal(mergedEntry.supersedes.length, 2);
  assert.equal(mergedEntry.sources.length, 2, '合并继承双份来源');
  assert.equal(parseMemoryFile(files.get('Agent Deck/记忆/2026-11-18-a.md')).state, '已被替代');

  // Sleep-time consolidation writes bidirectional conflicts_with idempotently and respects autoArchive for pre-existing old deprecated items.
  p.app.vault.rename = async (f, nextPath) => {
    const content = files.get(f.path);
    files.delete(f.path);
    files.set(nextPath, content);
  };
  files.set('Agent Deck/记忆/冲突甲.md', serializeMemoryFile({ id: 'm-c1', kind: 'preference', text: '发布前必须运行完整构建校验', date: '2026-11-25', sources: ['[[日记/2026_11_25]]'] }));
  files.set('Agent Deck/记忆/冲突乙.md', serializeMemoryFile({ id: 'm-c2', kind: 'preference', text: '小改动可以跳过构建直接装库', date: '2026-11-26', sources: ['[[日记/2026_11_26]]'] }));
  files.set('Agent Deck/记忆/2025-01-01-旧废弃.md', serializeMemoryFile({ id: 'm-old-dep', kind: 'fact', text: '2025 年初已拒绝的历史记录', state: '已拒绝', date: '2025-01-01', sources: [] }));
  d.model = async () => JSON.stringify({
    merges: [],
    deprecate: [],
    conflicts: [{ ids: ['m-c1', 'm-c2'], reason: '是否跳过构建互相冲突' }],
  });
  const cons2 = await d.consolidate({ manual: false });
  assert.equal(cons2.conflictsMarked, 1);
  assert.equal(cons2.archived, 1, '已过保留期的旧失效条目应在巩固时自动归档');
  assert.ok(files.has('Agent Deck/记忆/archive/2025-01-01-旧废弃.md'));
  assert.deepEqual(parseMemoryFile(files.get('Agent Deck/记忆/冲突甲.md')).conflictsWith, ['[[Agent Deck/记忆/冲突乙]]']);
  assert.deepEqual(parseMemoryFile(files.get('Agent Deck/记忆/冲突乙.md')).conflictsWith, ['[[Agent Deck/记忆/冲突甲]]']);
  const cons3 = await d.consolidate({ manual: false });
  assert.equal(cons3.conflictsMarked, 0, '再次巩固相同冲突边应幂等不重复写入');

  // Round 2: merge preserves verified/concepts/short_title and redirects conflicts referencing merged fromIds, then rejecting one side clears residual conflict edge.
  files.set('Agent Deck/记忆/合并源一.md', serializeMemoryFile({ id: 'm-mc1', kind: 'lesson', text: '打包插件必须执行检查流程', verified: true, verifiedBy: 'human:user', concepts: ['[[Obsidian]]'], date: '2026-11-25', sources: ['[[日记/2026_11_25]]'] }));
  files.set('Agent Deck/记忆/合并源二.md', serializeMemoryFile({ id: 'm-mc2', kind: 'lesson', text: '发布插件之前需完成打包检查', verified: false, concepts: ['[[Agent Deck]]'], date: '2026-11-26', sources: ['[[日记/2026_11_26]]'] }));
  files.set('Agent Deck/记忆/冲突丙.md', serializeMemoryFile({ id: 'm-c3', kind: 'lesson', text: '热修补丁可跳过全部检查直接部署', verified: false, date: '2026-11-26', sources: ['[[日记/2026_11_26]]'] }));
  d.model = async () => JSON.stringify({
    merges: [{ keepText: '打包发布插件前必须完成全部构建检查', short_title: '测试合并与冲突迁移', kind: 'lesson', project: 'agent-deck', tags: ['deploy'], fromIds: ['m-mc1', 'm-mc2'] }],
    deprecate: [],
    conflicts: [{ ids: ['m-mc1', 'm-c3'], reason: '检查策略冲突' }],
  });
  const consRemap = await d.consolidate({ manual: false });
  assert.equal(consRemap.merged, 1);
  assert.equal(consRemap.conflictsMarked, 1, '合并同批次涉及的冲突应重映射到合并后的新条目');
  const mergedRemap = parseMemoryFile(files.get('Agent Deck/记忆/测试合并与冲突迁移.md'));
  assert.equal(mergedRemap.verified, true, '任一源条已确认，合并结果应保留已确认状态');
  assert.deepEqual(mergedRemap.concepts, ['[[Obsidian]]', '[[Agent Deck]]']);
  assert.deepEqual(mergedRemap.conflictsWith, ['[[Agent Deck/记忆/冲突丙]]']);
  assert.deepEqual(parseMemoryFile(files.get('Agent Deck/记忆/冲突丙.md')).conflictsWith, ['[[Agent Deck/记忆/测试合并与冲突迁移]]']);
  await d.setEntryState('Agent Deck/记忆/冲突丙.md', '已拒绝');
  assert.deepEqual(parseMemoryFile(files.get('Agent Deck/记忆/测试合并与冲突迁移.md')).conflictsWith, [], '拒绝冲突对手方后应清理残留 conflicts_with');

  // polishShortTitles renames dated/stiff filenames cleanly under _suppressWatch.
  files.set('Agent Deck/记忆/2026-11-20-用户在Obsidian中做有损压缩试验测试.md', serializeMemoryFile({
    id: 'm-polish1',
    kind: 'fact',
    text: '用户在 Obsidian 中做有损压缩试验以减少上下文占用',
    date: '2026-11-20',
    sources: ['[[日记/2026_11_20]]'],
  }));
  d.model = async () => JSON.stringify({ titles: [{ id: 'm-polish1', short_title: 'Obsidian 有损压缩减占用' }] });
  const polished = await d.polishShortTitles({ manual: false });
  assert.equal(polished.renamed, 1);
  assert.ok(files.has('Agent Deck/记忆/Obsidian 有损压缩减占用.md'));
  assert.match(files.get('Agent Deck/记忆/log.md'), /\*\*Short-Title-Polish\*\*/);
  const polishedAgain = await d.polishShortTitles({ manual: false });
  assert.equal(polishedAgain.renamed, 0, '已精炼的短命题不应再次触发润色循环');

  // writeEntry auto-infers project + project_link when LLM omits project field, and updateEntry updates description + concepts.
  p.settings.projectFolders = { 'agent-deck': '/tmp/mock-agent-deck' };
  const inferredPath = await d.writeEntry({
    id: 'm-autoproj',
    kind: 'lesson',
    text: 'Agent Deck 发布前必须检查 build 与 install',
    shortTitle: 'Agent Deck 发布前检查',
    concepts: ['[[Obsidian]]'],
    date: '2026-11-26',
  }, []);
  const inferredParsed = parseMemoryFile(files.get(inferredPath));
  assert.equal(inferredParsed.project, 'agent-deck', 'writeEntry 应从 projectFolders 自动推断 project');

  await d.updateEntry(inferredPath, {
    description: '适用于 Agent Deck 构建与发布',
    concepts: ['Obsidian', 'CI'],
    verified: true,
    state: '有效',
  });
  const editedParsed = parseMemoryFile(files.get(inferredPath));
  assert.equal(editedParsed.description, '适用于 Agent Deck 构建与发布');
  assert.deepEqual(editedParsed.concepts, ['[[Obsidian]]', '[[CI]]']);

  // 非严格提炼模式下，仅由 AI 归纳且未验证的"尚未实施/后续计划"过渡状态应被拦截，不进入长期记忆
  const transitionalReport = [];
  const transitionalParsed = parseMemories(
    JSON.stringify({
      memories: [{
        text: 'Agent Deck 尚未实施记忆自动合并方案，后续计划补齐测试',
        kind: 'lesson',
        sources: ['S_AI'],
        quotes: [{ source: 'S_AI', text: 'Agent Deck 尚未实施记忆自动合并方案，后续计划补齐测试' }],
        replaces: [],
      }],
    }),
    new Map([['S_AI', { kind: 'ai', text: 'Agent Deck 尚未实施记忆自动合并方案，后续计划补齐测试' }]]),
    [],
    { strict: false, report: transitionalReport },
  );
  assert.equal(transitionalParsed.length, 0);
  assert.ok(transitionalReport.some((r) => /未验证过渡状态/.test(r)));

  // 去重（MMR-lite）：两条高度重叠的近似规则只保留分高的一条，不挤占不同维度条目的配额
  const { pickMemoriesFromEntries } = await import('../src/memory-query-core.js');
  const dupPicked = pickMemoriesFromEntries([
    { id: 'd1', kind: 'lesson', state: '有效', verified: true, trust: 'human-reviewed', date: '2026-11-26', text: 'Agent Deck 发布前必须执行构建检查与插件部署校验' },
    { id: 'd2', kind: 'lesson', state: '有效', verified: false, trust: 'ai-derived', date: '2026-11-25', text: 'Agent Deck 发布前必须执行构建检查与插件部署校验并核对脚本' },
    { id: 'd3', kind: 'lesson', state: '有效', verified: true, date: '2026-11-26', text: 'Agent Deck 打包构建输出到插件根目录后需重新加载生效' },
  ], 'Agent Deck 发布 构建 检查', { limit: 2 });
  assert.equal(dupPicked.length, 2);
  assert.equal(dupPicked[0].id, 'd1');
  assert.equal(dupPicked[1].id, 'd3');

  // 命中统计 recordHits + audit().proposalOnlyCount + healthReport()
  d.recordHits([editedParsed.id]);
  d.recordHits([editedParsed.id]);
  assert.equal(p.settings.dream.hitStats[editedParsed.id].count, 2);
  const au = await d.audit();
  assert.equal(typeof au.proposalOnlyCount, 'number');
  assert.equal(au.hitActiveCount, 1);
  const hr = await d.healthReport();
  assert.match(hr, /派发命中 \/ 零命中/);
  assert.match(hr, /未验证提案\/过渡态/);
}
console.log('PASS edited-entry rejection, dream model inheritance/override, tolerant recovery and serialized evidence budget');
