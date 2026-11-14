import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {AgentUsage} from '../src/readers.js';
import {AGENTS, DEFAULTS, deepMerge} from '../src/constants.js';

const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('  async scanNow('),end=source.indexOf('  async rebuildUsage()',start);
const notices=[];
const scanNow=vm.runInNewContext('('+source.slice(start,end).trim().replace('async scanNow','async function scanNow')+')',{
  AgentUsage,AGENTS,Date,console,Notice:class{constructor(text){notices.push(text)}},t:(text,vars={})=>text.replace(/\{(\w+)\}/g,(_,key)=>vars[key])
});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-card-scan-'));
const original={};
try {
  const now=Date.now(),day=86400000;
  const roots=['workbuddy','claude'].map(id=>[path.join(dir,id),id]);
  for (const [root] of roots) fs.mkdirSync(root);
  function wb(name,at) {
    const file=path.join(roots[0][0],name+'.jsonl');
    const lines=[{type:'message',role:'user',timestamp:at,cwd:'/project',content:[{type:'input_text',text:'请完成这个测试任务'}]},
      {type:'message',role:'assistant',timestamp:at+1000,content:[{type:'output_text',text:'已经完成'}],providerData:{messageId:name,usage:{outputTokens:20,inputTokens:10}}}];
    fs.writeFileSync(file,lines.map(x=>JSON.stringify(x)).join('\n')+'\n');
    fs.utimesSync(file,new Date(at+1000),new Date(at+1000));return file;
  }
  const recent=wb('recent',now-3*day),old=wb('old',now-10*day);
  const other=path.join(roots[1][0],'other.jsonl');fs.writeFileSync(other,'{}\n');
  for(const key of ['roots','readCodexTitles','readCodexArchived','readClaudeDesktop','readClaudeSideChats','applyClaudeDesktop']) original[key]=AgentUsage.prototype[key];
  AgentUsage.prototype.roots=function(){return roots.filter(([,agent])=>this.enabled(agent))};
  for(const key of ['readCodexTitles','readCodexArchived','readClaudeDesktop','readClaudeSideChats','applyClaudeDesktop']) AgentUsage.prototype[key]=async()=>{};
  const settings=deepMerge(DEFAULTS,{primaryAgents:['claude']});
  const usage=new AgentUsage({settings,cfg:settings});
  // Reproduce an unchanged, non-primary file whose historical messages were skipped.
  const st=fs.statSync(recent);await usage.readJsonl(recent,'workbuddy',st,new Set());
  assert.ok(!usage.meta.has('recent'),'normal non-primary parsing skips older days');
  usage.meta.set('old',{sid:'old',agent:'workbuddy',title:'保留旧会话',out:99});
  usage.files.set(old,{sentinel:true});usage.meta.set('unrelated',{sid:'unrelated',agent:'claude'});
  usage.lastScan=now-60000;
  let merges=0,cacheWrites=0;
  usage.maybeSaveCache=()=>cacheWrites++;
  const p={settings,usage,refreshUI(){},store:{merge(touched,u){merges++;assert.ok(touched.size>0);assert.equal(u,usage)},prune(){}},
    delegator:{resolveHandoffs(){}},journalSync:{run:async()=>{}},notice(message){throw new Error(message)}};
  await scanNow.call(p,false,{agent:'workbuddy',days:7});
  assert.ok(usage.meta.has('recent'),'manual seven-day scan recovers non-primary history even with a complete parse offset');
  assert.equal(usage.meta.get('recent').out,20);
  assert.equal(usage.meta.get('old').out,99,'old session metadata is preserved');
  assert.deepEqual(usage.files.get(old),{sentinel:true},'logs outside seven days remain untouched');
  assert.ok(usage.meta.has('unrelated'),'other Agents remain intact');assert.ok(!usage.files.has(other),'other Agents are not scanned');
  assert.equal(usage.lastScan,now-60000,'scoped scan does not move the global incremental cursor');
  await scanNow.call(p,false,{agent:'workbuddy',days:7});
  assert.equal(usage.meta.get('recent').out,20,'repeated manual scans do not double token totals');
  assert.equal(merges,2);assert.equal(cacheWrites,2);assert.ok(notices.some(text=>text.includes('7')));
  const primaryOld=path.join(roots[1][0],'primary-old.jsonl');fs.writeFileSync(primaryOld,'{}\n');fs.utimesSync(primaryOld,new Date(now-10*day),new Date(now-10*day));
  const primary=new AgentUsage({settings,cfg:settings});
  await primary.scan({since:now-7*day,agent:'claude',strictSince:true});
  assert.ok(!primary.files.has(primaryOld),'primary status cannot bypass the seven-day file cutoff');
  assert.equal(primary.lastScan,0);
  console.log('PASS card scan: Agent scope, seven-day cutoff, non-primary recovery, history preservation, repeat totals and incremental cursor');
} finally {
  for (const [key,value] of Object.entries(original)) AgentUsage.prototype[key]=value;
  fs.rmSync(dir,{recursive:true,force:true});
}
