import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
globalThis.require = createRequire(import.meta.url);
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class EditorSuggest{constructor(app){this.app=app}close(){}};',shortCircuit:true};return n(s,c)}`));
import { delegateAgents } from '../src/agent-registry.js';
const { TaskAgentSuggest, registerTaskAgentSuggest } = await import('../src/mention-suggest.js');
const { ROUTABLE_AGENTS, taskMention, mentionOptions, stripTaskMention, mentionSuggestions } = await import('../src/task-mentions.js');
const { DEFAULTS, MODEL_CATALOG, deepMerge } = await import('../src/constants.js');
const { Delegator, codexCliArgs } = await import('../src/delegation.js');
const p = { app: {}, settings: deepMerge(DEFAULTS, {}), jobs: {}, agentEnabled: (id) => id !== 'antigravity', modelsFor: (id) => MODEL_CATALOG.filter(m => m.agent === id), modelEnabled: () => true, defaultModel: (id) => DEFAULTS.delegate[id]?.model || '' };
const lines = ['1. TODO 写任务 @codex/gpt-6.1-sol/high', '  - TODO 子任务 @claude'];
const opts = mentionOptions(p, { lines, line: 0, agent: 'claude' });
assert.equal(opts.agent, 'codex'); assert.equal(opts.model, 'gpt-6.1-sol'); assert.equal(opts.effort, 'high');
assert.ok(codexCliArgs(p, opts).includes('model_reasoning_effort="high"'));
assert.equal(mentionOptions(p, {lines:['- TODO 父任务', '  - TODO 子任务 @codex'],line:0,agent:'claude'}).agent, 'claude');
assert.equal(stripTaskMention(lines.join('\n')), '1. TODO 写任务 \n  - TODO 子任务 @claude'.replace('任务 \n','任务\n'));
assert.equal(taskMention('- TODO mail@codex.com'), null);
assert.equal(taskMention('- TODO `@codex` [链接](https://x/@claude)'), null);
assert.throws(() => taskMention('- TODO @codex @claude'), /一个/);
for (const token of ['@codex//high', '@codex/bad-model/high', '@codex/gpt-6.1-sol/off', '@workbuddy/model', '@antigravity']) assert.throws(() => mentionOptions(p, {lines:['- TODO '+token],line:0}), token);
assert.equal(mentionOptions(p, { lines, line:0, ignoreMention:true, agent:'claude',model:'haiku' }).model, 'haiku');
assert.ok(mentionSuggestions(p, '').some(x => x.value === 'workbuddy'));
assert.ok(!mentionSuggestions(p, '').some(x => x.value === 'antigravity'));
assert.ok(mentionSuggestions(p, 'codex/gpt').some(x => x.value === 'codex/gpt-6.1-sol'));
assert.ok(mentionSuggestions(p, 'codex/gpt-6.1-sol/h').some(x => x.value.endsWith('/high')));
assert.deepEqual(mentionSuggestions(p, 'workbuddy/'), []);
const suggest = new TaskAgentSuggest(p);
const fakeEditor = (text) => ({getLine: (n) => text.split('\n')[n]});
assert.equal(suggest.onTrigger({line:1,ch:8},fakeEditor('```\n- TODO @\n```')),null);
assert.equal(suggest.onTrigger({line:0,ch:9},fakeEditor('- TODO `@')),null);
assert.equal(suggest.onTrigger({line:0,ch:8},fakeEditor('- TODO @')).query,'');
p.settings.delegate.codex.transport='terminal';
const d = new Delegator(p);
const prompt = d.buildPrompt({block:{text:lines.join('\n')}});
assert.ok(!prompt.includes('@codex/')); assert.ok(prompt.includes('子任务 @claude'));
// Verify all routing entry points, without spawning an agent or opening a terminal.
const cli = d.handoffCli.bind(d);
d.handoffCli = async (o) => o;
assert.equal((await d.delegate({lines,line:0,agent:'claude'})).effort,'high');
const delegate = d.delegate.bind(d);
d.delegate = async(o) => o;
assert.equal((await cli({lines:['- TODO @dsh'],line:0,agent:'codex'})).agent,'dsh');
const handoff = d.handoff.bind(d);
assert.equal((await handoff({lines,line:0,agent:'workbuddy'})).model,'gpt-6.1-sol');
console.log('PASS task mentions: agent/model/effort, safe boundaries, completions, all delegation routes and explicit overrides');
// A fake Claude executable proves the resolved per-task values reach spawn argv.
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { writeMockNodeBin, mockNodeScriptPath, cleanupDelegatorDir } = await import('./helpers/mock-cli.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ad-mention-'));
let actual1;
try {
  const argvPath=path.join(dir,'argv.json');
  const bin = writeMockNodeBin(dir,'claude','require("fs").writeFileSync('+JSON.stringify(argvPath)+',JSON.stringify(process.argv.slice(2)));\n');
  p.vaultPath=dir;p.settings.delegate.claude.path=bin;p.settings.delegate.claude.cwd=dir;
  p.settings.delegate.claude.openDesktop=false;p.saveSettings=()=>{};p.saveJobs=()=>{};p.refreshUI=()=>{};p.notice=()=>{};
  actual1 = new Delegator(p);actual1.onSession=()=>{};actual1.onDone=()=>{};actual1.onError=()=>{};
  const model = p.modelsFor('claude')[0].id;
  const job=await actual1.delegate({file:{path:'task.md'},lines:['- TODO fake @claude/'+model+'/max'],line:0,agent:'codex'});
  for(let i=0;i<500 && job.state==='running';i++) await new Promise(r=>setTimeout(r,10));
  const argv=JSON.parse(fs.readFileSync(argvPath,'utf8'));
  assert.equal(job.agent,'claude');assert.equal(job.effort,'max');assert.equal(argv[argv.indexOf('--effort')+1],'max');
  assert.ok(!argv.at(-1).includes('@claude/'));assert.equal(job.state,'done');
} finally {cleanupDelegatorDir(actual1,dir);}
console.log('PASS real runner subprocess receives the selected Claude model and effort');
const acpDir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-acp-'));
let actual2;
try {
  const events=path.join(acpDir,'events.jsonl');
  const bin=writeMockNodeBin(acpDir,'dsh',`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');if(m.method==='session/close')process.exit(0);let result={};if(m.method==='session/new')result={sessionId:'fake-acp-session',configOptions:${JSON.stringify([{id:'model'},{id:'reasoning_effort'}])}};if(m.method==='session/prompt')result={stopReason:'end_turn'};send({jsonrpc:'2.0',id:m.id,result})});rl.on('close',()=>process.exit(0));\n`);
  p.settings.delegate.dsh.path=bin;p.settings.delegate.dsh.cwd=acpDir;
  actual2=new Delegator(p);actual2.onSession=()=>{};actual2.onDone=()=>{};actual2.onError=()=>{};
  const job=await actual2.delegate({file:{path:'task.md'},lines:['- TODO fake @dsh/deepseek-v4-pro/max'],line:0,agent:'claude'});
  for(let i=0;i<500 && job.state==='running';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(job.state,'done');
  const requests=fs.readFileSync(events,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  assert.ok(requests.some(x=>x.method==='session/set_config_option'&&x.params.configId==='model'&&x.params.value.includes('deepseek-v4-pro')));
  assert.ok(requests.some(x=>x.method==='session/set_config_option'&&x.params.configId==='reasoning_effort'&&x.params.value==='max'));
  // An older ACP server that offers no model controls must fail before prompting.
  const scriptPath = mockNodeScriptPath(bin);
  fs.writeFileSync(scriptPath,fs.readFileSync(scriptPath,'utf8').replace('configOptions:[{"id":"model"},{"id":"reasoning_effort"}]','configOptions:[]'));
  fs.writeFileSync(events,'');
  const failed=await actual2.delegate({file:{path:'task.md'},lines:['- TODO fake @dsh/deepseek-v4-pro/high'],line:0,agent:'claude'});
  assert.equal(failed.state,'error');assert.match(failed.error,/未提供模型/);
  assert.ok(!fs.readFileSync(events,'utf8').includes('session/prompt'));
}finally{cleanupDelegatorDir(actual2,acpDir);}
console.log('PASS ACP applies the selected model/effort and rejects unsupported controls before dispatch');
// Agent selection must automatically reopen the concrete model list.
assert.equal(mentionSuggestions(p,'gpt')[0].value,'codex');
assert.equal(mentionSuggestions(p,'deepseek')[0].value,'dsh');
for(const [agent,models] of Object.entries({codex:['gpt-6.1-sol','gpt-6.1-terra'],claude:['claude-sonnet-5','claude-fable','claude-haiku-5-5'],dsh:['deepseek-v41-flash','deepseek-v4-pro']})) {
  assert.ok(mentionSuggestions(p,agent).find(x=>x.value===agent).next);
  for(const model of models)assert.ok(mentionSuggestions(p,agent+'/').some(x=>x.value===agent+'/'+model));
}
let content='- TODO @',cursor={line:0,ch:8},reopened=0;
const editor={getLine:()=>content,getCursor:()=>cursor,replaceRange:(text,start,end)=>{content=content.slice(0,start.ch)+text+content.slice(end.ch)},setCursor:c=>cursor=c};
p.app.workspace={editorSuggest:{trigger:(ed,file,force)=>{assert.equal(ed,editor);assert.equal(force,true);reopened++;}}};
suggest.context={editor,file:null,start:{line:0,ch:7},end:{line:0,ch:8}};
suggest.selectSuggestion(mentionSuggestions(p,'codex').find(x=>x.value==='codex'));
assert.equal(content,'- TODO @codex/');
await new Promise(r=>setTimeout(r,10));assert.equal(reopened,1);
suggest.context={editor,file:null,start:{line:0,ch:7},end:cursor};
suggest.selectSuggestion(mentionSuggestions(p,'codex/').find(x=>x.value==='codex/gpt-6.1-terra'));
assert.equal(content,'- TODO @codex/gpt-6.1-terra');
assert.equal(mentionOptions(p,{lines:[content],line:0}).model,'gpt-6.1-terra');
assert.equal(mentionSuggestions(p,'workbuddy')[0].next,false);
console.log('PASS chained model picker: aliases, mainstream model options, automatic reopening and selected model routing');
const disabledModels={...p,modelEnabled:()=>false};
assert.ok(mentionSuggestions(disabledModels,'codex/').some(x=>x.value==='codex/gpt-6.1-sol'));
console.log('PASS legacy settings with no enabled Codex models still show the model catalog');

// The manager stops at the first matching provider: a broad Tasks provider
// must not swallow Agent Deck's more specific @ completion.
const broadTaskSuggest = { onTrigger: () => ({ query: "task" }) };
const manager = { suggests: [broadTaskSuggest] };
const registrationPlugin = {
  ...p, app: { workspace: { editorSuggest: manager } },
  registerEditorSuggest(s) { manager.suggests.push(s); },
};
registerTaskAgentSuggest(registrationPlugin);
for (const line of ['- [ ] @', '- TODO @', '1. TODO @codex/']) {
  const cursor = { line: 0, ch: line.length };
  const first = manager.suggests.find(s => s.onTrigger(cursor, fakeEditor(line)));
  assert.ok(first instanceof TaskAgentSuggest, `${line}: Agent Deck menu must win over Tasks`);
  assert.ok(first.getSuggestions(first.onTrigger(cursor, fakeEditor(line))).length);
}
assert.equal(manager.suggests.find(s => s.onTrigger({line:0,ch:8}, fakeEditor('- [ ] hi'))), broadTaskSuggest);
console.log('PASS @ completion priority over broad task suggesters; ordinary Tasks completion preserved');
const confirmPlugin = { ...p, settings: deepMerge(DEFAULTS, {}) };
const confirmDelegator = new Delegator(confirmPlugin);
const buildConfirmPrompt = () => confirmDelegator.buildPrompt({block:{text:'- TODO 测试'}});
const defaultPrompt = buildConfirmPrompt();
assert.ok(defaultPrompt.includes('信息充分时，简要说明执行计划并继续完成任务'));
assert.ok(defaultPrompt.includes('已明确或已确认的信息不要重复询问'));
assert.ok(!defaultPrompt.includes('等我确认后再动手'));
confirmPlugin.settings.delegate.confirmFirstPrompt = '自定义确认\n请先说明方案。';
assert.ok(buildConfirmPrompt().endsWith('自定义确认\n请先说明方案。'));
assert.ok(!buildConfirmPrompt().includes('信息充分时，简要说明执行计划并继续完成任务'));
confirmPlugin.settings.delegate.confirmFirst = false;
assert.ok(!buildConfirmPrompt().includes('自定义确认'));
confirmPlugin.settings.delegate.confirmFirst = true;
confirmPlugin.settings.delegate.confirmFirstPrompt = '';
assert.ok(!buildConfirmPrompt().includes('信息充分时，简要说明执行计划并继续完成任务'));
delete confirmPlugin.settings.delegate.confirmFirstPrompt;
assert.equal(buildConfirmPrompt(), defaultPrompt);
console.log('PASS custom confirmation prompt, toggle, explicit empty text and legacy default');
// Configurable menu trigger must also route and strip the selected token.
const customPlugin = { ...p, settings: deepMerge(DEFAULTS, {}) };
const customSuggest = new TaskAgentSuggest(customPlugin);
customPlugin.settings.delegate.mentionSuggest = false;
assert.equal(customSuggest.onTrigger({line:0,ch:8},fakeEditor('- TODO @')), null);
customPlugin.settings.delegate.mentionSuggest = true;
for (const trigger of ['!', '::', '$', '/', '[', '🤖']) {
  customPlugin.settings.delegate.mentionTrigger = trigger;
  const text = '- TODO '+trigger;
  const context = customSuggest.onTrigger({line:0,ch:text.length},fakeEditor(text));
  assert.equal(context?.query, '', trigger);
  assert.equal(context.start.ch, 7);
  assert.equal(customSuggest.onTrigger({line:0,ch:8},fakeEditor('- TODO @')), null);
  const task = '- TODO 测试 '+trigger+'codex/gpt-6.1-sol/high';
  const chosen = mentionOptions(customPlugin,{lines:[task],line:0});
  assert.equal(chosen.agent,'codex');assert.equal(chosen.effort,'high');
  const prompt = new Delegator(customPlugin).buildPrompt({block:{text:task}});
  assert.ok(!prompt.includes(trigger+'codex/'),trigger+' must not leak into prompt');
  assert.equal(mentionOptions(customPlugin,{lines:['- TODO @codex'],line:0}).agent,'codex');
}
customPlugin.settings.delegate.mentionTrigger = '::';
assert.equal(taskMention('- TODO test::codex','::'),null);
assert.equal(taskMention('- TODO `::codex`','::'),null);
assert.equal(taskMention('- TODO [链接](https://x/::codex)','::'),null);
assert.throws(()=>taskMention('- TODO @codex ::claude','::'),/一个/);
customPlugin.settings.delegate.mentionSuggest = false;
assert.equal(mentionOptions(customPlugin,{lines:['- TODO ::codex'],line:0}).agent,'codex');
let customContent='- TODO ::',customCursor={line:0,ch:9},customReopen=0;
const customEditor={getLine:()=>customContent,getCursor:()=>customCursor,replaceRange:(text,start,end)=>{customContent=customContent.slice(0,start.ch)+text+customContent.slice(end.ch)},setCursor:c=>customCursor=c};
customPlugin.app={workspace:{editorSuggest:{trigger:()=>customReopen++}}};
customSuggest.app=customPlugin.app;
customSuggest.context={editor:customEditor,file:null,start:{line:0,ch:7},end:customCursor};
customSuggest.selectSuggestion(mentionSuggestions(customPlugin,'codex')[0]);
assert.equal(customContent,'- TODO ::codex/');
await new Promise(r=>setTimeout(r,10));assert.equal(customReopen,0,'disabled menu must not reopen');
console.log('PASS configurable trigger, disabled menu, legacy routing and safe symbol boundaries');
customPlugin.settings.delegate.mentionSuggest = true;
customContent='- TODO ::';customCursor={line:0,ch:9};
customSuggest.context={editor:customEditor,file:null,start:{line:0,ch:7},end:customCursor};
customSuggest.selectSuggestion(mentionSuggestions(customPlugin,'codex')[0]);
assert.equal(customContent,'- TODO ::codex/');
await new Promise(r=>setTimeout(r,10));assert.equal(customReopen,1);
customSuggest.context={editor:customEditor,file:null,start:{line:0,ch:7},end:customCursor};
customSuggest.selectSuggestion(mentionSuggestions(customPlugin,'codex/').find(x=>x.value==='codex/gpt-6.1-terra'));
assert.equal(customContent,'- TODO ::codex/gpt-6.1-terra');
assert.equal(mentionOptions(customPlugin,{lines:[customContent],line:0}).model,'gpt-6.1-terra');
for(const trigger of ['@@','.*','\\','💡']) assert.equal(taskMention('- TODO '+trigger+'codex',trigger)?.agent,'codex');
// Every delegatable agent must be routable and suggested via @ mentions.
for (const id of delegateAgents()) assert.ok(ROUTABLE_AGENTS.includes(id), `delegatable agent ${id} is routable in @ mentions`);
const allEnabledPlugin = { ...p, agentEnabled: () => true };
assert.ok(mentionSuggestions(allEnabledPlugin, '').some((x) => x.value === 'hermes'), '@ mentions list includes Hermes Agent');
assert.ok(mentionSuggestions(allEnabledPlugin, '').some((x) => x.value === 'antigravity'), '@ mentions list includes Antigravity');
const hermesMention = mentionOptions(allEnabledPlugin, { lines: ['- TODO run @hermes/hermes-default/high'], line: 0, agent: 'claude' });
assert.equal(hermesMention.agent, 'hermes');
assert.equal(hermesMention.model, 'hermes-default');
assert.equal(hermesMention.effort, 'high');

// @ secondary menu pins dsh-default first even if listed last, and sorts remaining models by user call count descending.
const dshOrderedPlugin = {
  ...p,
  agentEnabled: () => true,
  modelEnabled: () => true,
  modelsFor: (id) => id === 'dsh' ? [
    { id: 'deepseek-v4-pro', agent: 'dsh', name: 'DeepSeek-V4-Pro', model: 'deepseek-v4-pro' },
    { id: 'deepseek-v4-flash', agent: 'dsh', name: 'DeepSeek-V4-Flash', model: 'deepseek-v4-flash' },
    { id: 'deepseek-v41-flash', agent: 'dsh', name: 'DeepSeek-V4.1-Flash', model: 'deepseek-flash' },
    { id: 'custom-qwen', agent: 'dsh', name: 'Custom Qwen', value: 'qwen-3' },
    { id: 'dsh-default', agent: 'dsh', name: '不指定（使用 DSH 当前默认模型）', value: '' },
  ] : p.modelsFor(id),
  settings: {
    ...p.settings,
    models: {
      ...(p.settings.models || {}),
      callCounts: { 'custom-qwen': 15 },
    },
  },
  usage: {
    meta: new Map([
      ['s1', { sid: 's1', agent: 'dsh', model: 'deepseek-flash', turns: 40 }],
      ['s2', { sid: 's2', agent: 'dsh', model: 'deepseek-v4-pro', turns: 5 }],
    ]),
  },
  jobs: {
    j1: { agent: 'dsh', sessionId: 's2', model: 'deepseek-v4-pro' }, // same session already in usage.meta -> not double counted
    j2: { agent: 'dsh', sessionId: 's3', model: 'deepseek-v4-flash' }, // active job not yet scanned -> +1
    j3: { agent: 'dsh', sessionId: 's4', model: 'deepseek-v4-pro' }, // +1 -> 6 total for pro
  },
};
const dshMenu = mentionSuggestions(dshOrderedPlugin, 'dsh/').map((x) => x.value);
assert.deepEqual(
  dshMenu,
  ['dsh/dsh-default', 'dsh/deepseek-v41-flash', 'dsh/custom-qwen', 'dsh/deepseek-v4-pro', 'dsh/deepseek-v4-flash'],
  '@dsh/ puts dsh-default first and sorts the rest by call counts descending',
);
console.log('PASS custom symbol chained selection, concrete model routing, regex escaping and frequency-sorted @ menus');
