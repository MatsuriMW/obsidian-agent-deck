import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Delegator } from '../src/delegation.js';
import { DEFAULTS } from '../src/constants.js';

function fixture(mode = 'normal') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-dsh-'));
  const bin = path.join(dir, 'dsh'), events = path.join(dir, 'events.jsonl');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs=require('fs'), rl=require('readline').createInterface({input:process.stdin});
const mode=${JSON.stringify(mode)};
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const configOptions=[{id:'model',category:'model',type:'select',currentValue:'["custom","private-model"]',options:[{group:'custom',name:'My Provider',options:[{value:'["custom","private-model"]',name:'Private Model'}]}]},{id:'reasoning_effort',options:[{value:'high',name:'High'}]}];
rl.on('line',line=>{const m=JSON.parse(line); fs.appendFileSync(${JSON.stringify(events)},line+'\\n');
if(m.method==='initialize'){if(mode==='exit'){process.exit(0)};send({id:m.id,result:{agentCapabilities:{sessionCapabilities:{resume:{},close:{}}}}});return;}
if(m.method==='session/new'||m.method==='session/resume'){send({id:m.id,result:{sessionId:m.params.sessionId||'test-session',configOptions}});return;}
if(m.method==='session/set_config_option'){if(mode==='bad-model'&&m.params.configId==='model')send({id:m.id,error:{message:'selected model unavailable'}});else send({id:m.id,result:{configOptions}});return;}
if(m.method==='session/prompt'){
 if(mode==='wait')return;
 if(mode==='permission'){global.promptId=m.id;send({id:999,method:'session/request_permission',params:{options:[{optionId:'permit-tool-42',kind:'allow_once'},{optionId:'deny-tool-42',kind:'reject_once'}]}});return;}
 send({method:'session/update',params:{sessionId:'test-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'完整中文回复'}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;
}
if(m.id===999){send({id:global.promptId,result:{stopReason:'end_turn'}});return;}
if(m.id!=null)send({id:m.id,result:{}});
});
`);
  fs.chmodSync(bin, 0o755);
  const settings = structuredClone(DEFAULTS);
  settings.delegate.dsh.path = bin; settings.delegate.dsh.autoApprove = true;
  settings.delegate.dsh.model = '["custom","private-model"]';
  settings.delegate.writeLink = false;
  let note = '- TODO feedback task';
  const plugin = { settings, jobs: {}, vaultPath: dir, notice(){}, refreshUI(){}, saveJobs(){}, saveSettings(){}, readNote:async()=>note, writeNote:async(_,t)=>{note=t}, modelById:()=>null };
  const d = new Delegator(plugin);
  const readEvents = () => fs.existsSync(events) ? fs.readFileSync(events,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const cleanup=()=>{for(const r of d.runners.values()){r.cancel();r.child?.kill();for(const p of r.pending?.values()||[])clearTimeout(p.timer)}clearTimeout(d._saveT);fs.rmSync(dir,{recursive:true,force:true})};
  return {d,plugin,dir,readEvents,cleanup,send:()=>d.delegate({agent:'dsh',file:{path:'task.md'},line:0})};
}
async function settled(job) {
  const end=Date.now()+1500;
  while(!['done','error','cancelled'].includes(job.state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
}

test('DSH: configured model failure must stop before prompt',async()=>{
 const f=fixture('bad-model');try{const j=await f.send();await settled(j);assert.equal(j.state,'error');assert.match(j.error,/model unavailable/);assert.equal(f.readEvents().some(m=>m.method==='session/prompt'),false)}finally{f.cleanup()}
});
test('DSH: permission selects advertised option ID',async()=>{
 const f=fixture('permission');try{const j=await f.send();await settled(j);assert.equal(j.state,'done');assert.equal(f.readEvents().find(m=>m.id===999)?.result?.outcome?.optionId,'permit-tool-42')}finally{f.cleanup()}
});
test('DSH: clean early process exit fails immediately',async()=>{
 const f=fixture('exit');try{const j=await Promise.race([f.send(),new Promise(r=>setTimeout(()=>r(null),1200))]);assert.ok(j,'initialize must not hang until the request timeout');assert.equal(j.state,'error')}finally{f.cleanup()}
});
test('DSH: cancellation sends notification and drains pending requests',async()=>{
 const f=fixture('wait');try{const j=await f.send();const r=f.d.runners.get(j.id);r.cancel();await new Promise(r=>setTimeout(r,100));assert.ok(f.readEvents().some(m=>m.method==='session/cancel'));assert.equal(r.pending.size,0)}finally{f.cleanup()}
});

test('DSH: discovers grouped custom models without sending a prompt',async()=>{
 const f=fixture();try{const models=await f.d.refreshDshModels();assert.equal(models[0].name,'Private Model');assert.match(models[0].id,/^dsh-acp-[A-Za-z0-9_-]+$/);assert.equal(models[0].value,'["custom","private-model"]');assert.equal(f.readEvents().some(m=>m.method==='session/prompt'),false)}finally{f.cleanup()}
});
test('DSH: second turn resumes the same session and preserves full messages',async()=>{
 const f=fixture();try{const j=await f.send();await settled(j);const prompt='继续追问\n'+ '完整内容'.repeat(4000);const again=await f.d.continueSession({agent:'dsh',sid:j.sessionId},prompt);await settled(again);assert.equal(again.id,j.id);assert.equal(again.state,'done');assert.equal(again.conversation.length,4);assert.equal(again.conversation[2].text,prompt);assert.equal(f.readEvents().filter(m=>m.method==='session/new').length,1);assert.equal(f.readEvents().find(m=>m.method==='session/resume').params.sessionId,'test-session');assert.equal(f.readEvents().filter(m=>m.method==='session/prompt').length,2)}finally{f.cleanup()}
});
test('DSH: active turn refuses a concurrent follow-up',async()=>{
 const f=fixture('wait');try{
  const j=await f.send();
  const end=Date.now()+1500;
  while(!f.readEvents().some(m=>m.method==='session/prompt')&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.readEvents().filter(m=>m.method==='session/prompt').length,1,'the fixture received the active prompt');
  await assert.rejects(()=>f.d.continueSession({agent:'dsh',sid:j.sessionId},'追问'),/当前这一轮/);
  assert.equal(f.readEvents().filter(m=>m.method==='session/prompt').length,1);
 }finally{f.cleanup()}
});
test('DSH: plugin reload can resume a historic session without creating a new one',async()=>{
 const f=fixture();try{const j=await f.d.continueSession({agent:'dsh',sid:'historic-session',cwd:f.dir,title:'旧对话'},'接着说');await settled(j);assert.equal(j.sessionId,'historic-session');assert.equal(j.state,'done');assert.equal(f.readEvents().some(m=>m.method==='session/new'),false);assert.equal(f.readEvents().some(m=>m.method==='session/set_config_option'),false)}finally{f.cleanup()}
});

// Use the same real ACP stream for manual permissions as Antigravity.
test('DSH: manual permission waits for Obsidian and returns the chosen option',async()=>{
 const f=fixture('permission');try{f.plugin.settings.delegate.dsh.autoApprove=false;let called=false;f.plugin.requestAcpPermission=async({agent,options})=>{called=true;assert.equal(agent,'dsh');return options[0].optionId};const j=await f.send();await settled(j);assert.equal(called,true);assert.equal(j.state,'done');assert.equal(f.readEvents().find(m=>m.id===999).result.outcome.outcome,'selected')}finally{f.cleanup()}
});
