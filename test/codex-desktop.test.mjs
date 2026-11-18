import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCodexDesktop } from '../src/delegation.js';
import { CodexDesktopRunner } from '../src/codex-desktop.js';
import { writeMockNodeBin } from './helpers/mock-cli.mjs';
assert.equal(isCodexDesktop('agent_deck'),true);
assert.equal(isCodexDesktop('codex_cli_rs'),false);
{
 const job={sessionId:'multi'};
 const runner=new CodexDesktopRunner({},job,()=>{});
 const message=(id,text)=>runner.receive({method:'item/completed',params:{threadId:'multi',item:{id,type:'agentMessage',text}}});
 message('progress','先完成了第一步');message('final','完整结果与尚未完成的事项');message('final','完整结果与尚未完成的事项（更新）');
 assert.equal(job.result,'先完成了第一步\n\n完整结果与尚未完成的事项（更新）');
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-desktop-'));
const events=path.join(dir,'events.jsonl'), modeFile=path.join(dir,'mode.txt');
const bin=writeMockNodeBin(dir,'codex',`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
const mode=()=>{try{return fs.readFileSync(${JSON.stringify(modeFile)},'utf8').trim()}catch{return 'existing'}};
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');if(m.id==null)return;let result={};
if(m.method==='project/list'){
  if(mode()==='unsupported'){process.stdout.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Method not found'}})+'\\n');return}
  result={data:mode()==='create'?[]:[{id:'proj-existing',name:'桌面测试',roots:[{path:${JSON.stringify(dir)}}]}],nextCursor:null};
}
if(m.method==='project/create')result={project:{id:'proj-new',name:m.params.name,roots:m.params.roots}};
if(m.method==='thread/start'){if(m.params.model==='bad-model'){process.stdout.write(JSON.stringify({id:m.id,error:{message:'model unavailable'}})+'\\n');return}result={thread:{id:'desktop-session',projectId:m.params.projectId},model:m.params.model}}
if(m.method==='turn/start')result={turn:{id:'turn-1'}};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
if(m.method==='turn/start' && m.params.input[0].text==='wait')return;
if(m.method==='turn/start' && m.params.input[0].text==='approval'){process.stdout.write(JSON.stringify({id:999,method:'item/commandExecution/requestApproval',params:{threadId:'desktop-session'}})+'\\n');return;}
if(m.method==='turn/start')setTimeout(()=>{process.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:'desktop-session',item:{type:'agentMessage',text:'DESKTOP_OK'}}})+'\\n');process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'desktop-session',turn:{id:'turn-1',status:'completed'}}})+'\\n')},20);
});`);
const all=()=>fs.existsSync(events)?fs.readFileSync(events,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const count=(method)=>all().filter(x=>x.method===method).length;
function fixture({model='gpt-6.1-sol',mode='existing',cwd=dir,project='',codex={}}={}){
 fs.writeFileSync(modeFile,mode);
 const job={model,effort:'high',cwd,name:'桌面测试',project};let opened=0;let finish;
 const ended=new Promise(r=>finish=r);
 const d={settings:{delegate:{codex:{path:bin,sandbox:'read-only',...codex}}},saveJobs(){},refreshUI(){},onSession(j,id){j.sessionId=id},onDone(){finish()},onError(){finish()}};
 const runner=new CodexDesktopRunner(d,job,()=>{opened++});
 return {job,runner,ended,opened:()=>opened};
}
try{
 const f=fixture();await f.runner.start({prompt:'只回复 DESKTOP_OK'});await f.ended;
 assert.equal(f.job.state,'done');assert.equal(f.job.result,'DESKTOP_OK');assert.equal(f.opened(),1);
 const requests=all();
 assert.deepEqual(requests.find(x=>x.method==='thread/start').params,{model:'gpt-6.1-sol',cwd:dir,ephemeral:false,sandbox:'read-only',approvalPolicy:'on-request',projectId:'proj-existing',config:{model_reasoning_effort:'high'}});
 const turn=requests.find(x=>x.method==='turn/start').params;
 assert.equal(turn.model,'gpt-6.1-sol');assert.equal(turn.effort,'high');assert.equal(turn.input[0].text,'只回复 DESKTOP_OK');

 // No project owns the folder: create one and pass its id to thread/start.
 const created=fixture({mode:'create',project:'Agent Deck'});
 const createBefore=count('project/create');
 await created.runner.start({prompt:'x'});await created.ended;
 assert.equal(count('project/create'),createBefore+1);
 const createCall=all().filter(x=>x.method==='project/create').pop();
 assert.equal(createCall.params.name,'Agent Deck');
 assert.equal(createCall.params.roots[0].path,dir);
 const createdStart=all().filter(x=>x.method==='thread/start').pop();
 assert.equal(createdStart.params.projectId,'proj-new');

 // Experimental project API missing: dispatch still works, just ungrouped.
 const unsupported=fixture({mode:'unsupported'});
 await unsupported.runner.start({prompt:'x'});await unsupported.ended;
 assert.equal(unsupported.job.state,'done');
 assert.equal(unsupported.job.result,'DESKTOP_OK');
 assert.equal(all().filter(x=>x.method==='thread/start').pop().params.projectId,undefined);

 // Project grouping switched off: never calls project/list.
 const off=fixture({codex:{project:false}});
 const listBefore=count('project/list');
 await off.runner.start({prompt:'x'});await off.ended;
 assert.equal(count('project/list'),listBefore);
 assert.equal(all().filter(x=>x.method==='thread/start').pop().params.projectId,undefined);

 // Scratch cwd (a Codex temp folder) is not a project.
 const scratch=path.join(dir,'a');
 fs.mkdirSync(scratch,{recursive:true});
 const scratchFix=fixture({cwd:scratch});
 const scratchListBefore=count('project/list');
 await scratchFix.runner.start({prompt:'x'});await scratchFix.ended;
 assert.equal(count('project/list'),scratchListBefore);
 assert.equal(all().filter(x=>x.method==='thread/start').pop().params.projectId,undefined);

 const bad=fixture({model:'bad-model'});await bad.runner.start({prompt:'x'});await bad.ended;assert.equal(bad.job.state,'error');assert.match(bad.job.error,/model unavailable/);assert.equal(bad.opened(),0);
 const approval=fixture();await approval.runner.start({prompt:'approval'});await approval.ended;assert.equal(approval.job.state,'error');assert.match(approval.job.error,/审批/);assert.equal(approval.opened(),1);
 const cancel=fixture();await cancel.runner.start({prompt:'wait'});await cancel.runner.cancel();assert.equal(cancel.job.state,'cancelled');assert.equal(cancel.opened(),0);
 const missing=fixture();missing.runner.d.settings.delegate.codex.path=path.join(dir,'missing');await missing.runner.start({prompt:'x'});await missing.ended;assert.equal(missing.job.state,'error');assert.match(missing.job.error,/ENOENT/);
 console.log('PASS Codex Desktop: persisted session, model/effort, response, desktop handoff, project group attach/reuse/create/skip, no fallback on model/connection failure');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
