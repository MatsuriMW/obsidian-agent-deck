import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Delegator } from '../src/delegation.js';
import { DEFAULTS } from '../src/constants.js';

function fixture(mode='normal') {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-agy-')),bin=path.join(dir,'agy'),events=path.join(dir,'events.jsonl');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
const mode=${JSON.stringify(mode)},send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
let current='gemini-test',promptId;
const options=()=>[{id:'model',category:'model',type:'select',currentValue:current,options:[{value:'gemini-test',name:'Gemini Test'},{value:'gemini-other',name:'Gemini Other'}]},{id:'thought_level',category:'thought_level',type:'select',currentValue:'medium',options:[{value:'low'},{value:'medium'},{value:'high'}]}];
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');
if(m.method==='initialize'){send({id:m.id,result:{agentCapabilities:{sessionCapabilities:{resume:{},close:{}}}}});return;}
if(m.method==='session/new'||m.method==='session/resume'){if(mode==='auth'){send({id:m.id,error:{message:'Authentication required. Run agy acp --login'}});return;}send({id:m.id,result:{sessionId:m.params.sessionId||'agy-session',configOptions:options()}});return;}
if(m.method==='session/set_config_option'){if(m.params.configId==='model'){if(mode==='bad-model'){send({id:m.id,error:{message:'model unavailable'}});return;}current=m.params.value;}send({id:m.id,result:{configOptions:options()}});return;}
if(m.method==='session/prompt'){
 promptId=m.id;
 if(mode==='wait')return;
 if(mode==='permission'){send({id:999,method:'session/request_permission',params:{sessionId:'agy-session',toolCall:{title:'Read fixture'},options:[{optionId:'permit-123',kind:'allow_once'},{optionId:'deny-456',kind:'reject_once'}]}});return;}
 send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'AGY_OK'}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;
}
if(m.id===999){send({id:promptId,result:{stopReason:'end_turn'}});return;}
if(m.id!=null)send({id:m.id,result:{}});
});
`);fs.chmodSync(bin,0o755);
 const settings=structuredClone(DEFAULTS);settings.delegate.antigravity={path:bin,model:'gemini-test',effort:'medium',cwd:dir,autoApprove:false};settings.autoWriteResult=false;settings.delegate.writeLink=false;settings.delegate.confirmFirst=false;
 const plugin={settings,jobs:{},vaultPath:dir,notice(){},saveSettings(){},saveJobs(){},refreshUI(){},readNote:async()=>'- TODO test task',modelById:()=>null};
 const d=new Delegator(plugin);d.handoff=()=>{throw new Error('Antigravity must use ACP, not clipboard handoff')};
 const read=()=>fs.existsSync(events)?fs.readFileSync(events,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const cleanup=()=>{for(const r of d.runners.values()){r.cancel();r.child?.kill()}clearTimeout(d._saveT);fs.rmSync(dir,{recursive:true,force:true})};
 return{d,plugin,dir,read,cleanup,send:opts=>d.delegate({agent:'antigravity',file:{path:'test.md'},line:0,...opts})};
}
async function settle(j){const end=Date.now()+2000;while(!['done','error','cancelled'].includes(j.state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));}

test('Antigravity delegates via agy acp with raw model ID and thought_level',async()=>{const f=fixture();try{const j=await f.send();await settle(j);assert.equal(j.state,'done');assert.equal(j.result,'AGY_OK');assert.equal(j.handoff,undefined);const cfg=f.read().filter(m=>m.method==='session/set_config_option');assert.deepEqual(cfg.map(m=>[m.params.configId,m.params.value]),[['model','gemini-test'],['thought_level','medium']]);assert.equal(f.read().find(m=>m.method==='session/prompt').params.sessionId,'agy-session')}finally{f.cleanup()}});
test('Antigravity follow-up resumes same ID, preserves full history and refuses overlapping sends',async()=>{const f=fixture();try{const j=await f.send();await settle(j);const again=await f.d.continueSession({agent:'antigravity',sid:j.sessionId},'继续\n'+ '上下文'.repeat(5000));await settle(again);assert.equal(again.id,j.id);assert.equal(again.conversation.length,4);assert.equal(f.read().filter(m=>m.method==='session/new').length,1);assert.equal(f.read().find(m=>m.method==='session/resume').params.sessionId,'agy-session')}finally{f.cleanup()}});
test('Antigravity discovers server model choices without sending task',async()=>{const f=fixture();try{const models=await f.d.refreshAcpModels('antigravity');assert.equal(models[0].agent,'antigravity');assert.equal(models[0].value,'gemini-test');assert.equal(f.read().some(m=>m.method==='session/prompt'),false)}finally{f.cleanup()}});
test('Antigravity does not send task after auth/model errors',async()=>{for(const mode of ['auth','bad-model']){const f=fixture(mode);try{const j=await f.send();await settle(j);assert.equal(j.state,'error');assert.equal(f.read().some(m=>m.method==='session/prompt'),false)}finally{f.cleanup()}}});
test('Antigravity uses Obsidian permission callback and validates advertised option ID',async()=>{const f=fixture('permission');try{f.plugin.requestAcpPermission=async({options})=>options[0].optionId;const j=await f.send();await settle(j);assert.equal(j.state,'done');assert.equal(f.read().find(m=>m.id===999).result.outcome.optionId,'permit-123')}finally{f.cleanup()}});
test('Antigravity cancels active round and pending requests',async()=>{const f=fixture('wait');try{const j=await f.send();await assert.rejects(()=>f.d.continueSession({agent:'antigravity',sid:j.sessionId},'next'),/当前这一轮/);const r=f.d.runners.get(j.id);r.cancel();await new Promise(r=>setTimeout(r,80));assert.equal(j.state,'cancelled');assert.equal(r.pending.size,0);assert.ok(f.read().some(m=>m.method==='session/cancel'))}finally{f.cleanup()}});

test('Antigravity rejects unadvertised permission IDs and legacy desktop resume',async()=>{const f=fixture('permission');try{f.plugin.requestAcpPermission=async()=> 'invented';const j=await f.send();await settle(j);assert.deepEqual(f.read().find(m=>m.id===999).result.outcome,{outcome:'cancelled'});await assert.rejects(()=>f.d.continueSession({agent:'antigravity',sid:'desktop-only'},'next'),/桌面会话/);assert.equal(f.read().filter(m=>m.method==='session/new').length,1)}finally{f.cleanup()}});
test('Antigravity restores ACP job after plugin reload and keeps same conversation',async()=>{const f=fixture();try{const j=await f.send();await settle(j);const d=new Delegator(f.plugin);const next=await d.continueSession({agent:'antigravity',sid:j.sessionId},'after reload');await settle(next);assert.equal(next.state,'done');assert.equal(next.conversation.length,4);assert.equal(f.read().filter(m=>m.method==='session/new').length,1);clearTimeout(d._saveT)}finally{f.cleanup()}});
test('Antigravity rejects unsupported effort before sending a task',async()=>{const f=fixture();try{const j=await f.send({effort:'xhigh'});await settle(j);assert.equal(j.state,'error');assert.match(j.error,/不支持推理强度/);assert.equal(f.read().some(m=>m.method==='session/prompt'),false)}finally{f.cleanup()}});

test('OpenCode delegates via opencode-cli acp without requiring thought_level option and supports follow-up',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-oc-')),bin=path.join(dir,'opencode'),events=path.join(dir,'events.jsonl');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const options=()=>[{id:'model',category:'model',type:'select',currentValue:'opencode/minimax-m2.5-free',options:[{value:'opencode/minimax-m2.5-free',name:'MiniMax M2.5 Free'}]},{id:'mode',category:'mode',type:'select',currentValue:'build',options:[{value:'build',name:'build'},{value:'plan',name:'plan'}]}];
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');
if(m.method==='initialize'){send({id:m.id,result:{agentCapabilities:{loadSession:true,sessionCapabilities:{resume:{}}}}});return;}
if(m.method==='session/new'||m.method==='session/resume'){send({id:m.id,result:{sessionId:m.params.sessionId||'ses_test123',configOptions:options()}});return;}
if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OPENCODE_OK'}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
if(m.id!=null)send({id:m.id,result:{configOptions:options()}});
});`);
 fs.chmodSync(bin,0o755);
 const settings=structuredClone(DEFAULTS);settings.delegate.opencode={path:bin,model:'opencode-default',effort:'high',cwd:dir,autoApprove:true};settings.autoWriteResult=false;settings.delegate.writeLink=false;settings.delegate.confirmFirst=false;
 const plugin={settings,jobs:{},vaultPath:dir,notice(){},saveSettings(){},saveJobs(){},refreshUI(){},readNote:async()=>'- TODO test opencode',modelById:()=>null};
 const d=new Delegator(plugin);
 try{
  const j=await d.delegate({agent:'opencode',file:{path:'test.md'},line:0,effort:'high'});
  await settle(j);
  assert.equal(j.state,'done');
  assert.equal(j.result,'OPENCODE_OK');
  assert.equal(j.sessionId,'ses_test123');
  const next=await d.continueSession({agent:'opencode',sid:j.sessionId},'follow up');
  await settle(next);
  assert.equal(next.state,'done');
  assert.equal(next.conversation.length,4);
 }finally{
  for(const r of d.runners.values()){r.cancel();r.child?.kill()}
  clearTimeout(d._saveT);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('Qoder delegates via qodercli when signed in and falls back to desktop handoff when not logged in',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-qoder-')),bin=path.join(dir,'qodercli'),argsFile=path.join(dir,'args.json');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs');
fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2)));
if(process.env.QODER_MODE==='unauth'){process.stderr.write('Not logged in. Please run "qodercli login" first.\\n');process.exit(1);}
process.stdout.write('QODER_OK\\n');
`);
 fs.chmodSync(bin,0o755);
 const settings=structuredClone(DEFAULTS);settings.delegate.qoder={path:bin,model:'qoder-ultimate',effort:'high',permission:'auto',cwd:dir,openDesktop:false};settings.autoWriteResult=false;settings.delegate.writeLink=false;settings.delegate.confirmFirst=false;
 const plugin={settings,jobs:{},vaultPath:dir,notice(){},saveSettings(){},saveJobs(){},refreshUI(){},readNote:async()=>'- TODO test qoder',modelById:()=>null};
 const d=new Delegator(plugin);
 let copied='',openedApp='';
 d.copyText=t=>{copied=t;};
 d.openAgentApp=a=>{openedApp=a;};
 try{
  const j=await d.delegate({agent:'qoder',file:{path:'test.md'},line:0});
  await settle(j);
  assert.equal(j.state,'done');
  assert.equal(j.result,'QODER_OK');
  assert.ok(j.sessionId);
  const args=JSON.parse(fs.readFileSync(argsFile,'utf8'));
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('ultimate'));
  process.env.QODER_MODE='unauth';
  const j2=await d.delegate({agent:'qoder',file:{path:'test.md'},line:0,newSession:true});
  await new Promise(r=>setTimeout(r,120));
  assert.equal(j2.handoff,true);
  assert.equal(j2.state,'starting');
  assert.equal(j2.sessionId,'');
  assert.equal(openedApp,'qoder');
  assert.ok(copied.includes('test qoder'));
 }finally{
  delete process.env.QODER_MODE;
  for(const r of d.runners.values()){r.cancel();r.child?.kill()}
  clearTimeout(d._saveT);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
