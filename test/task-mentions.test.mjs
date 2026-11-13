import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
globalThis.require = createRequire(import.meta.url);
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class EditorSuggest{constructor(app){this.app=app}close(){}};',shortCircuit:true};return n(s,c)}`));
const { TaskAgentSuggest } = await import('../src/mention-suggest.js');
const { taskMention, mentionOptions, stripTaskMention, mentionSuggestions } = await import('../src/task-mentions.js');
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ad-mention-'));
try {
  const bin = path.join(dir,'claude'), argvPath=path.join(dir,'argv.json');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nrequire("fs").writeFileSync('+JSON.stringify(argvPath)+',JSON.stringify(process.argv.slice(2)));\n');
  fs.chmodSync(bin,0o755);
  p.vaultPath=dir;p.settings.delegate.claude.path=bin;p.settings.delegate.claude.cwd=dir;
  p.settings.delegate.claude.openDesktop=false;p.saveSettings=()=>{};p.saveJobs=()=>{};p.refreshUI=()=>{};p.notice=()=>{};
  const actual = new Delegator(p);actual.onSession=()=>{};actual.onDone=()=>{};actual.onError=()=>{};
  const model = p.modelsFor('claude')[0].id;
  const job=await actual.delegate({file:{path:'task.md'},lines:['- TODO fake @claude/'+model+'/max'],line:0,agent:'codex'});
  for(let i=0;i<500 && job.state==='running';i++) await new Promise(r=>setTimeout(r,10));
  const argv=JSON.parse(fs.readFileSync(argvPath,'utf8'));
  assert.equal(job.agent,'claude');assert.equal(job.effort,'max');assert.equal(argv[argv.indexOf('--effort')+1],'max');
  assert.ok(!argv.at(-1).includes('@claude/'));assert.equal(job.state,'done');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS real runner subprocess receives the selected Claude model and effort');
const acpDir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-acp-'));
try {
  const bin=path.join(acpDir,'dsh'), events=path.join(acpDir,'events.jsonl');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');if(m.method==='session/close')process.exit(0);let result={};if(m.method==='session/new')result={sessionId:'fake-acp-session',configOptions:${JSON.stringify([{id:'model'},{id:'reasoning_effort'}])}};if(m.method==='session/prompt')result={stopReason:'end_turn'};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')});\n`);
  fs.chmodSync(bin,0o755);p.settings.delegate.dsh.path=bin;p.settings.delegate.dsh.cwd=acpDir;
  const actual=new Delegator(p);actual.onSession=()=>{};actual.onDone=()=>{};actual.onError=()=>{};
  const job=await actual.delegate({file:{path:'task.md'},lines:['- TODO fake @dsh/deepseek-v4-pro/max'],line:0,agent:'claude'});
  for(let i=0;i<500 && job.state==='running';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(job.state,'done');
  const requests=fs.readFileSync(events,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  assert.ok(requests.some(x=>x.method==='session/set_config_option'&&x.params.configId==='model'&&x.params.value.includes('deepseek-v4-pro')));
  assert.ok(requests.some(x=>x.method==='session/set_config_option'&&x.params.configId==='reasoning_effort'&&x.params.value==='max'));
  // An older ACP server that offers no model controls must fail before prompting.
  fs.writeFileSync(bin,fs.readFileSync(bin,'utf8').replace('configOptions:[{"id":"model"},{"id":"reasoning_effort"}]','configOptions:[]'));
  fs.writeFileSync(events,'');
  const failed=await actual.delegate({file:{path:'task.md'},lines:['- TODO fake @dsh/deepseek-v4-pro/high'],line:0,agent:'claude'});
  assert.equal(failed.state,'error');assert.match(failed.error,/未提供模型/);
  assert.ok(!fs.readFileSync(events,'utf8').includes('session/prompt'));
}finally{fs.rmSync(acpDir,{recursive:true,force:true})}
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
