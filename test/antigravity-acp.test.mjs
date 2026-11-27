import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Delegator } from '../src/delegation.js';
import { AcpRunner, parseWindowsRegProxy } from '../src/delegation-runners.js';
import { DEFAULTS } from '../src/constants.js';
import { writeMockNodeBin, cleanupDelegatorDir, rmDirSafe } from './helpers/mock-cli.mjs';

function fixture(mode='normal') {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-agy-')),invocations=path.join(dir,'invocations.jsonl'),prompts=path.join(dir,'prompts.jsonl');
 const bin=writeMockNodeBin(dir,'agy',`const fs=require('fs');
const mode=${JSON.stringify(mode)};
const argv=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(invocations)},JSON.stringify(argv)+'\\n');
if(argv[0]==='acp'){process.stderr.write('agy acp must not be invoked');process.exit(99);}
if(argv[0]==='models'){
 process.stdout.write('Fetching available models...\\ngemini-test\\tGemini Test\\ngemini-other\\tGemini Other\\n');
 process.exit(0);
}
if(mode==='auth'){process.stderr.write('Authentication required. Please log in to Antigravity CLI.');process.exit(1);}
if(mode==='bad-model'){
 process.stdout.write(JSON.stringify({event:'init',conversation_id:'agy-err'})+'\\n');
 process.stdout.write(JSON.stringify({event:'result',result:{conversation_id:'agy-err',status:'ERROR',error:'model unavailable'}})+'\\n');
 process.exit(1);
}
if(mode==='wait'){
 process.stdout.write(JSON.stringify({event:'init',conversation_id:'agy-wait'})+'\\n');
 setInterval(()=>{},1000);
 return;
}
const rIdx=argv.indexOf('--resume');
const sid=(rIdx>=0&&argv[rIdx+1])||'agy-session';
function finishTurn(promptText){
 fs.appendFileSync(${JSON.stringify(prompts)},JSON.stringify(promptText)+'\\n');
 process.stdout.write(JSON.stringify({event:'init',conversation_id:sid,init:{model:'gemini-test'}})+'\\n');
 process.stdout.write(JSON.stringify({event:'step_update',step_update:{conversation_id:sid,step_index:1,state:'ACTIVE',step_type:'agent_response',text_delta:'AGY_'}})+'\\n');
 process.stdout.write(JSON.stringify({event:'step_update',step_update:{conversation_id:sid,step_index:1,state:'DONE',step_type:'agent_response',text_delta:'OK'}})+'\\n');
 process.stdout.write(JSON.stringify({event:'result',result:{conversation_id:sid,status:'SUCCESS',response:'AGY_OK'}})+'\\n');
}
const inFmtIdx=argv.indexOf('--input-format');
if(inFmtIdx>=0&&argv[inFmtIdx+1]==='stream-json'){
 let buf='';
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{buf+=chunk;});
 process.stdin.on('end',()=>{
  const lines=buf.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
  let promptText='';
  for(const line of lines){
   const msg=JSON.parse(line);
   if(msg.event!=='user'||typeof msg.message?.content!=='string'){process.stderr.write('invalid stream input');process.exit(1);}
   promptText=msg.message.content;
  }
  finishTurn(promptText);
 });
}else{
 const pArg=argv.find(a=>a.startsWith('--print='))||'';
 finishTurn(pArg.slice('--print='.length));
}
`);
 const settings=structuredClone(DEFAULTS);settings.delegate.antigravity={path:bin,model:'gemini-test',effort:'medium',cwd:dir,autoApprove:false,extraArgs:''};settings.autoWriteResult=false;settings.delegate.writeLink=false;settings.delegate.confirmFirst=false;
 const plugin={settings,jobs:{},vaultPath:dir,notice(){},saveSettings(){},saveJobs(){},refreshUI(){},readNote:async()=>'- TODO test task',modelById:()=>null};
 const d=new Delegator(plugin);d.handoff=()=>{throw new Error('Antigravity must use CLI runner, not clipboard handoff')};
 const read=()=>fs.existsSync(invocations)?fs.readFileSync(invocations,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const readPrompts=()=>fs.existsSync(prompts)?fs.readFileSync(prompts,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const cleanup=()=>cleanupDelegatorDir(d,dir);
 return{d,plugin,dir,read,readPrompts,cleanup,send:opts=>d.delegate({agent:'antigravity',file:{path:'test.md'},line:0,...opts})};
}
async function settle(j){const end=Date.now()+2000;while(!['done','error','cancelled'].includes(j.state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));}

test('Antigravity delegates via official agy CLI stream-json without invoking acp',async()=>{const f=fixture();try{const j=await f.send();await settle(j);assert.equal(j.state,'done',j.error||'');assert.equal(j.result,'AGY_OK');assert.equal(j.transport,'cli');assert.equal(j.app,'cli');assert.equal(j.handoff,undefined);const calls=f.read();assert.equal(calls.length,1);assert.equal(calls[0].includes('acp'),false);assert.ok(calls[0].includes('--output-format')&&calls[0].includes('stream-json'));assert.ok(calls[0].includes('--model')&&calls[0].includes('gemini-test'));assert.ok(calls[0].includes('--effort')&&calls[0].includes('medium'));assert.equal(calls[0].includes('--dangerously-skip-permissions'),false)}finally{f.cleanup()}});
test('Antigravity follow-up resumes same ID via --resume and refuses overlapping sends',async()=>{const f=fixture();try{const j=await f.send();await settle(j);const followUp='继续\n'+ '上下文'.repeat(5000);const again=await f.d.continueSession({agent:'antigravity',sid:j.sessionId,transport:'cli'},followUp);await settle(again);assert.equal(again.id,j.id);assert.equal(again.state,'done',again.error||'');assert.equal(again.conversation.length,4);const calls=f.read();assert.equal(calls.length,2);const rIdx=calls[1].indexOf('--resume');assert.ok(rIdx>=0&&calls[1][rIdx+1]==='agy-session');assert.equal(f.readPrompts()[1],followUp)}finally{f.cleanup()}});
test('Antigravity switches to --input-format stream-json stdin transport for large prompts',async()=>{const f=fixture();try{const bigPrompt='A'.repeat(60050);f.plugin.readNote=async()=>`- TODO ${bigPrompt}`;const j=await f.send();await settle(j);assert.equal(j.state,'done',j.error||'');const calls=f.read();assert.equal(calls.length,1);const idx=calls[0].indexOf('--input-format');assert.ok(idx>=0&&calls[0][idx+1]==='stream-json');assert.equal(calls[0].some(a=>a.startsWith('--print=')),false);assert.ok(f.readPrompts()[0].includes(bigPrompt))}finally{f.cleanup()}});
test('Antigravity discovers model choices via agy models without sending task',async()=>{const f=fixture();try{const models=await f.d.refreshAcpModels('antigravity');assert.equal(models[0].agent,'antigravity');assert.equal(models[0].value,'gemini-test');assert.equal(models[1].value,'gemini-other');assert.deepEqual(f.read(),[['models']])}finally{f.cleanup()}});
test('Antigravity surfaces auth/model errors cleanly on CLI failure',async()=>{for(const mode of ['auth','bad-model']){const f=fixture(mode);try{const j=await f.send();await settle(j);assert.equal(j.state,'error');assert.equal(f.read().some(a=>a.includes('acp')),false)}finally{f.cleanup()}}});
test('Antigravity passes --dangerously-skip-permissions only when autoApprove is enabled',async()=>{const f=fixture();try{f.plugin.settings.delegate.antigravity.autoApprove=true;const j=await f.send();await settle(j);assert.equal(j.state,'done',j.error||'');assert.ok(f.read()[0].includes('--dangerously-skip-permissions'))}finally{f.cleanup()}});
test('Antigravity cancels active CLI child and rejects legacy desktop resume',async()=>{const f=fixture('wait');try{const j=await f.send();for(let k=0;k<100&&!j.sessionId;k++)await new Promise(r=>setTimeout(r,10));await assert.rejects(()=>f.d.continueSession({agent:'antigravity',sid:j.sessionId,transport:'cli'},'next'),/当前这一轮/);const r=f.d.runners.get(j.id);r.cancel();assert.equal(j.state,'cancelled');await assert.rejects(()=>f.d.continueSession({agent:'antigravity',sid:'desktop-only'},'next'),/桌面会话/)}finally{f.cleanup()}});
test('Antigravity restores CLI job after plugin reload and keeps same conversation',async()=>{const f=fixture();try{const j=await f.send();await settle(j);const d=new Delegator(f.plugin);const next=await d.continueSession({agent:'antigravity',sid:j.sessionId,transport:'cli'},'after reload');await settle(next);assert.equal(next.state,'done',next.error||'');assert.equal(next.conversation.length,4);clearTimeout(d._saveT)}finally{f.cleanup()}});

test('OpenCode delegates via opencode-cli acp without requiring thought_level option and supports follow-up',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-oc-')),events=path.join(dir,'events.jsonl');
 const bin=writeMockNodeBin(dir,'opencode',`const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const options=()=>[{id:'model',category:'model',type:'select',currentValue:'opencode/minimax-m2.5-free',options:[{value:'opencode/minimax-m2.5-free',name:'MiniMax M2.5 Free'}]},{id:'mode',category:'mode',type:'select',currentValue:'build',options:[{value:'build',name:'build'},{value:'plan',name:'plan'}]}];
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(events)},line+'\\n');
if(m.method==='initialize'){send({id:m.id,result:{agentCapabilities:{loadSession:true,sessionCapabilities:{resume:{}}}}});return;}
if(m.method==='session/new'||m.method==='session/resume'){send({id:m.id,result:{sessionId:m.params.sessionId||'ses_test123',configOptions:options()}});return;}
if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OPENCODE_OK'}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
if(m.id!=null)send({id:m.id,result:{configOptions:options()}});
});
rl.on('close',()=>process.exit(0));`);
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
  cleanupDelegatorDir(d,dir);
 }
});

test('Qoder delegates via qodercli in background and uses clipboard handoff for desktop',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-qoder-')),argsFile=path.join(dir,'args.json');
 const bin=writeMockNodeBin(dir,'qodercli',`const fs=require('fs');
const argv=process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(argv));
if(process.env.QODER_MODE==='unauth'){process.stderr.write('Not logged in. Please run "qodercli login" first.\\n');process.exit(1);}
process.stdout.write('QODER_OK\\n');`);
 const settings=structuredClone(DEFAULTS);settings.delegate.qoder={path:bin,model:'qoder-ultimate',effort:'high',permission:'auto',cwd:dir,openDesktop:false};settings.autoWriteResult=false;settings.delegate.writeLink=false;settings.delegate.confirmFirst=false;
 const plugin={settings,jobs:{},vaultPath:dir,notice(){},saveSettings(){},saveJobs(){},refreshUI(){},readNote:async()=>'- TODO test qoder',modelById:()=>null};
 const d=new Delegator(plugin);
 let copied='',openedApp='';
 d.copyText=t=>{copied=t;};
 d.openAgentApp=a=>{openedApp=a;};
 try{
  const j=await d.delegate({agent:'qoder',destination:'background',file:{path:'test.md'},line:0});
  await settle(j);
  assert.equal(j.state,'done');
  assert.equal(j.result,'QODER_OK\n');
  assert.ok(j.sessionId);
  const args=JSON.parse(fs.readFileSync(argsFile,'utf8'));
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--session-id'));
  assert.ok(args.includes('ultimate'));
  assert.equal(j.conversation.length,2);

  // Explicit desktop destination goes straight to clipboard handoff without spawning qodercli
  fs.unlinkSync(argsFile);
  const jDesk=await d.delegate({agent:'qoder',destination:'desktop',file:{path:'test.md'},line:0,newSession:true});
  assert.equal(jDesk.handoff,true);
  assert.equal(jDesk.state,'starting');
  assert.equal(jDesk.sessionId,'');
  assert.equal(openedApp,'qoder');
  assert.ok(copied.includes('test qoder'));
  assert.equal(fs.existsSync(argsFile),false);

  // Explicit background execution fails visibly without opening a desktop client.
  copied='';openedApp='';
  process.env.QODER_MODE='unauth';
  const j2=await d.delegate({agent:'qoder',destination:'background',file:{path:'test.md'},line:0,newSession:true});
  await settle(j2);
  assert.equal(j2.state,'error');
  assert.match(j2.error,/Not logged in/);
  assert.equal(openedApp,'');
  assert.equal(copied,'');
 }finally{
  delete process.env.QODER_MODE;
  cleanupDelegatorDir(d,dir);
 }
});

test('Antigravity autoApprove skips permission modal and Turn 2 writeback updates the note', async () => {
  const fPerm = fixture();
  try {
    // 1. autoApprove: true passes --dangerously-skip-permissions and skips requestAcpPermission
    fPerm.plugin.settings.delegate.antigravity.autoApprove = true;
    let prompted = 0;
    fPerm.plugin.requestAcpPermission = async () => { prompted++; return 'permit-123'; };
    const jp = await fPerm.send({ destination: 'background' });
    await settle(jp);
    assert.equal(jp.state, 'done');
    assert.equal(prompted, 0, 'autoApprove: true must not ask permission');
    assert.ok(fPerm.read()[0].includes('--dangerously-skip-permissions'));
  } finally {
    fPerm.cleanup();
  }

  const f = fixture();
  let note = '- TODO 测试自动授权和续聊 ^ad-agy1\n';
  const files = new Map();
  f.plugin.readNote = async () => note;
  f.plugin.writeNote = async (_p, next) => { note = next; };
  f.plugin.app = {
    vault: {
      getAbstractFileByPath: (p) => (p === 'test.md' ? { path: p } : files.get(p) || null),
      createFolder: async () => {},
      create: async (p, text) => { const file = { path: p, text }; files.set(p, file); return file; },
      modify: async (file, text) => { file.text = text; },
      read: async (file) => file.text,
    },
  };
  f.plugin.settings.autoWriteResult = true;
  f.plugin.settings.delegate.writeLink = true;
  try {
    const j = await f.send({ destination: 'background' });
    await settle(j);
    for (let k = 0; k < 50 && !j.resultWritten; k++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(j.state, 'done');
    assert.ok(note.includes('第1轮：AGY_OK'), 'Turn 1 wrote result back to note');

    // 2. Simulating continueSession after jobs cleanup (passing path/blockId/transport) still runs Turn 2 and writes back
    delete f.plugin.jobs[j.id];
    const next = await f.d.continueSession({
      agent: 'antigravity',
      sid: j.sessionId,
      transport: 'cli',
      path: 'test.md',
      blockId: 'ad-agy1',
      destination: 'background',
      cwd: f.dir,
    }, '第二轮追问');
    await settle(next);
    for (let k = 0; k < 50 && !next.resultWritten; k++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(next.state, 'done');
    assert.ok(note.includes('第2轮：AGY_OK'), 'Turn 2 wrote result back to note');
  } finally {
    f.cleanup();
  }
});

test('parseWindowsRegProxy handles single host, multi-protocol map, ProxyOverride, and disabled ProxyEnable', () => {
  const disabled = parseWindowsRegProxy(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    127.0.0.1:7890
`);
  assert.deepEqual(disabled, {});

  const single = parseWindowsRegProxy(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride    REG_SZ    *.internal;<local>;10.0.0.0/8
`);
  assert.equal(single.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(single.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(single.NO_PROXY, '*.internal,10.0.0.0/8,127.0.0.1,localhost,::1');

  const multi = parseWindowsRegProxy(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080
`);
  assert.equal(multi.HTTP_PROXY, 'http://127.0.0.1:8080');
  assert.equal(multi.HTTPS_PROXY, 'http://127.0.0.1:8443');
  assert.equal(multi.ALL_PROXY, 'socks5://127.0.0.1:1080');
});

test('AcpRunner strips UTF-8 BOM, supports array/string chunks, prompt result fallback, and surfaces stderr on early exit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-acp-bom-'));
  const bin = writeMockNodeBin(dir, 'dsh', `const rl=require('readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write('\\uFEFF'+JSON.stringify(m)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);
if(m.method==='initialize'){send({id:m.id,result:{agentCapabilities:{sessionCapabilities:{resume:{}}}}});return;}
if(m.method==='session/new'){send({id:m.id,result:{sessionId:'bom-sess',configOptions:[]}});return;}
if(m.method==='session/prompt'){
  if(process.env.ACP_FAIL_EARLY==='1'){process.stderr.write('proxy auth failed');process.exit(1);}
  if(process.env.ACP_RESULT_FALLBACK==='1'){send({id:m.id,result:{stopReason:'end_turn',text:'FALLBACK_OK'}});return;}
  send({method:'session/update',params:{sessionId:'bom-sess',update:{sessionUpdate:'agent_thought_chunk',content:[{type:'text',text:'thinking'}]}}});
  send({method:'session/update',params:{sessionId:'bom-sess',update:{sessionUpdate:'agent_message_chunk',content:[{type:'text',text:'A'},{type:'text',text:'B'}]}}});
  send({method:'session/update',params:{sessionId:'bom-sess',update:{sessionUpdate:'agent_message_chunk',content:'C'}}});
  send({id:m.id,result:{stopReason:'end_turn'}});
  return;
}
});
rl.on('close',()=>process.exit(0));`);
  const settings = structuredClone(DEFAULTS);
  settings.delegate.dsh = { path: bin, model: 'dsh-default', effort: '', cwd: dir, autoApprove: true };
  settings.autoWriteResult = false;
  settings.delegate.writeLink = false;
  settings.delegate.confirmFirst = false;
  const plugin = { settings, jobs: {}, vaultPath: dir, notice() {}, saveSettings() {}, saveJobs() {}, refreshUI() {}, readNote: async () => '- TODO bom test', modelById: () => null };
  const d = new Delegator(plugin);
  try {
    const j1 = await d.delegate({ agent: 'dsh', file: { path: 'test.md' }, line: 0 });
    await settle(j1);
    assert.equal(j1.state, 'done', j1.error || '');
    assert.equal(j1.result, 'ABC');

    process.env.ACP_RESULT_FALLBACK = '1';
    const j2 = await d.delegate({ agent: 'dsh', file: { path: 'test.md' }, line: 0, newSession: true });
    await settle(j2);
    assert.equal(j2.state, 'done', j2.error || '');
    assert.equal(j2.result, 'FALLBACK_OK');
    delete process.env.ACP_RESULT_FALLBACK;

    process.env.ACP_FAIL_EARLY = '1';
    const j3 = await d.delegate({ agent: 'dsh', file: { path: 'test.md' }, line: 0, newSession: true });
    await settle(j3);
    assert.equal(j3.state, 'error');
    assert.match(j3.error, /proxy auth failed/);
  } finally {
    delete process.env.ACP_RESULT_FALLBACK;
    delete process.env.ACP_FAIL_EARLY;
    cleanupDelegatorDir(d, dir);
  }
});

test('recoverJobs resolves orphaned ACP jobs instead of leaving them stuck in running', () => {
  const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = mainSource.indexOf('  recoverJobs() {');
  const end = mainSource.indexOf('\n  cleanJobs()', start);
  const ctx = vm.runInNewContext('({' + mainSource.slice(start, end) + '})', { t: (s) => s });
  let saved = 0;
  let wrote = 0;
  ctx.jobs = {
    jRun: { id: 'jRun', agent: 'antigravity', transport: 'acp', sessionId: 's-run', state: 'running', startedAt: Date.now() },
    jWait: { id: 'jWait', agent: 'antigravity', transport: 'acp', sessionId: 's-wait', state: 'running', startedAt: Date.now() },
    jCli: { id: 'jCli', agent: 'claude', sessionId: 's-cli', state: 'running', startedAt: Date.now() },
  };
  ctx.delegator = { runners: new Map(), writeResult: async () => { wrote++; } };
  ctx.usage = {
    meta: new Map([
      ['s-run', { state: 'run', lastAt: Date.now(), out: 10, fresh: 5 }],
      ['s-wait', { state: 'wait', lastAt: Date.now(), out: 20, fresh: 10 }],
      ['s-cli', { state: 'run', lastAt: Date.now(), out: 30, fresh: 10 }],
    ]),
  };
  ctx.saveJobs = () => { saved++; };
  ctx.refreshUI = () => {};
  ctx.recoverJobs();
  assert.equal(ctx.jobs.jRun.state, 'error');
  assert.match(ctx.jobs.jRun.error, /ACP/);
  assert.equal(ctx.jobs.jWait.state, 'done');
  assert.equal(ctx.jobs.jCli.state, 'running');
  assert.equal(wrote, 1);
  assert.ok(saved >= 3);
});
