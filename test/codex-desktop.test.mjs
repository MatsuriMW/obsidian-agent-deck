import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCodexDesktop } from '../src/delegation.js';
import { CodexDesktopRunner } from '../src/codex-desktop.js';
assert.equal(isCodexDesktop('agent_deck'),true);
assert.equal(isCodexDesktop('codex_cli_rs'),false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-desktop-'));
const bin=path.join(dir,'codex'), events=path.join(dir,'events.jsonl');
fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');if(m.id==null)return;let result={};
if(m.method==='thread/start'){if(m.params.model==='bad-model'){process.stdout.write(JSON.stringify({id:m.id,error:{message:'model unavailable'}})+'\\n');return}result={thread:{id:'desktop-session'},model:m.params.model}}
if(m.method==='turn/start')result={turn:{id:'turn-1'}};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
if(m.method==='turn/start' && m.params.input[0].text==='wait')return;
if(m.method==='turn/start' && m.params.input[0].text==='approval'){process.stdout.write(JSON.stringify({id:999,method:'item/commandExecution/requestApproval',params:{threadId:'desktop-session'}})+'\\n');return;}
if(m.method==='turn/start')setTimeout(()=>{process.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:'desktop-session',item:{type:'agentMessage',text:'DESKTOP_OK'}}})+'\\n');process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'desktop-session',turn:{id:'turn-1',status:'completed'}}})+'\\n')},20);
});
`);fs.chmodSync(bin,0o755);
function fixture(model='gpt-6.1-sol'){
 const job={model,effort:'high',cwd:dir,name:'桌面测试'};let opened=0;let finish;
 const ended=new Promise(r=>finish=r);
 const d={settings:{delegate:{codex:{path:bin,sandbox:'read-only'}}},saveJobs(){},refreshUI(){},onSession(j,id){j.sessionId=id},onDone(){finish()},onError(){finish()}};
 const runner=new CodexDesktopRunner(d,job,()=>{opened++});
 return {job,runner,ended,opened:()=>opened};
}
try{
 const f=fixture();await f.runner.start({prompt:'只回复 DESKTOP_OK'});await f.ended;
 assert.equal(f.job.state,'done');assert.equal(f.job.result,'DESKTOP_OK');assert.equal(f.opened(),1);
 const requests=fs.readFileSync(events,'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(requests.find(x=>x.method==='thread/start').params,{model:'gpt-6.1-sol',cwd:dir,ephemeral:false,sandbox:'read-only',approvalPolicy:'on-request',config:{model_reasoning_effort:'high'}});
 const turn=requests.find(x=>x.method==='turn/start').params;
 assert.equal(turn.model,'gpt-6.1-sol');assert.equal(turn.effort,'high');assert.equal(turn.input[0].text,'只回复 DESKTOP_OK');
 const bad=fixture('bad-model');await bad.runner.start({prompt:'x'});await bad.ended;assert.equal(bad.job.state,'error');assert.match(bad.job.error,/model unavailable/);assert.equal(bad.opened(),0);
 const approval=fixture();await approval.runner.start({prompt:'approval'});await approval.ended;assert.equal(approval.job.state,'error');assert.match(approval.job.error,/审批/);assert.equal(approval.opened(),1);
 const cancel=fixture();await cancel.runner.start({prompt:'wait'});await cancel.runner.cancel();assert.equal(cancel.job.state,'cancelled');assert.equal(cancel.opened(),0);
 const missing=fixture();missing.runner.d.settings.delegate.codex.path=path.join(dir,'missing');await missing.runner.start({prompt:'x'});await missing.ended;assert.equal(missing.job.state,'error');assert.match(missing.job.error,/ENOENT/);
 console.log('PASS Codex Desktop: persisted session, model/effort, response, desktop handoff, no fallback on model/connection failure');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
