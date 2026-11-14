import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentUsage } from '../src/readers.js';
import { readConversation } from '../src/conversation.js';
import * as J from '../src/journal.js';
import { dayKey, dayKeyToday, fmtClock, AGENTS, DEFAULTS, deepMerge } from '../src/constants.js';
const quote = x => "'" + String(typeof x === 'object' ? JSON.stringify(x) : x).replaceAll("'", "''") + "'";
const now = Date.now() - 60000;
function fixture(agent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-desktop-')), db = path.join(dir, 'main.sqlite');
  const sql = s => execFileSync('/usr/bin/sqlite3', [db, s]);
  if (agent === 'opencode') {
    sql(`CREATE TABLE session_v2(id,title,directory,parent_id,model,time_created,time_updated,time_archived,time_busy,time_idle,idle_outcome);
      CREATE TABLE session_message(id,session_id,type,seq,time_created,time_updated,data);
      CREATE TABLE session_part(message_id,session_id,ordinal,type,time_created,time_updated,data);
      INSERT INTO session_v2 VALUES('ses_demo','测试','/project',NULL,NULL,${now},${now+2000},NULL,${now},${now+2000},'completed');`);
    const user = { text:'请检查代码',time:{created:now} };
    const assistant = { content:[],model:{modelID:'test-model'},tokens:{input:10,output:20,cache:{read:5,write:2}},time:{created:now+1000,completed:now+2000},finish:'stop' };
    sql(`INSERT INTO session_message VALUES('u','ses_demo','user',1,${now},${now},${quote(user)}),('a','ses_demo','assistant',2,${now+1000},${now+2000},${quote(assistant)});
      INSERT INTO session_part VALUES('a','ses_demo',0,'reasoning',${now},${now},${quote({type:'reasoning',text:'不要归档思考'})}),('a','ses_demo',1,'text',${now},${now},${quote({type:'text',text:'代码检查完成\n\n\u0060\u0060\u0060js\nconst a = 1;\n\u0060\u0060\u0060'})});`);
  } else {
    sql(`CREATE TABLE chat_sessions(session_id,title,cwd,owner_session_id,origin_session_id,model,created_at,updated_at,archived,deleted_at);
      CREATE TABLE chat_session_messages(session_id,message_id,sequence,payload_json,status,created_at,updated_at);
      INSERT INTO chat_sessions VALUES('q-demo','测试','/project',NULL,NULL,'qmodel',${now},${now+2000},0,NULL);`);
    const user = {role:'user',text:'请检查代码',timestamp:new Date(now).toISOString()};
    const assistant = {role:'assistant',text:'代码检查完成',timestamp:new Date(now).toISOString(),completedAt:new Date(now+2000).toISOString(),parts:[{type:'reasoning',text:'不要归档思考'}]};
    sql(`INSERT INTO chat_session_messages VALUES('q-demo','u',1,${quote(user)},'completed',${now},${now}),('q-demo','a',2,${quote(assistant)},'completed',${now},${now+2000});`);
  }
  const settings = deepMerge(DEFAULTS,{primaryAgents:[agent]});
  const usage = new AgentUsage({settings,cfg:settings});
  usage.desktopDatabases = () => [[db,agent]];
  usage.roots = () => [];
  for (const k of ['readCodexTitles','readCodexArchived','readClaudeDesktop','readClaudeSideChats','applyClaudeDesktop']) usage[k] = async()=>{};
  return {dir,db,sql,usage,sid:agent==='opencode'?'ses_demo':'q-demo'};
}
for (const agent of ['opencode','qoder']) test(`${agent}: snapshot, repeat scan, update, archive, conversation and cache`,async()=>{
  const f=fixture(agent),{usage,sid,sql}=f;
  try {
    let touched=await usage.scan();
    assert.ok(touched.has(dayKey(now,usage.cfg)));
    const m=usage.meta.get(sid);
    assert.equal(m.agent,agent);assert.equal(m.turns,1);assert.equal(m.state,'wait');assert.equal(m.lastText.startsWith('代码检查完成'),true);
    assert.equal(m.rounds[0].ask,'请检查代码');assert.ok(m.rounds[0].doneAt);
    const out=agent==='opencode'?20:0;
    assert.equal(m.out,out);
    const total=usage.summary(dayKey(now,usage.cfg));assert.equal(total.prompts,1);assert.equal(total.out,out);
    await usage.scan();assert.equal(usage.summary(dayKey(now,usage.cfg)).prompts,1);
    const messages=await readConversation({jobs:{},usage},{agent,sid});
    assert.equal(messages.length,2);assert.equal(messages[0].role,'user');assert.ok(!messages[1].text.includes('不要归档思考'));
    const link=J.linkLine('',agent,'测试',sid);assert.deepEqual(J.parseLink(link),{agent,sid,title:'测试'});
    if(agent==='opencode') sql(`UPDATE session_part SET data=${quote({type:'text',text:'更新后的结论'})},time_updated=${now+3000} WHERE ordinal=1; UPDATE session_v2 SET time_updated=${now+3000},time_archived=${now+4000};`);
    else sql(`UPDATE chat_session_messages SET payload_json=${quote({role:'assistant',text:'更新后的结论',completedAt:new Date(now+3000).toISOString()})},updated_at=${now+3000} WHERE message_id='a'; UPDATE chat_sessions SET updated_at=${now+3000},archived=1;`);
    await usage.scan();assert.equal(usage.meta.get(sid).lastText,'更新后的结论');assert.equal(usage.meta.get(sid).out,out);assert.ok(usage.hidden(sid));
    if(agent==='opencode') {
      // Parts stream into WAL independently of session metadata revisions.
      sql(`UPDATE session_part SET data=${quote({type:'text',text:'只更新消息片段'})},time_updated=${now+5000} WHERE ordinal=1;`);
      await usage.scan();assert.equal(usage.meta.get(sid).lastText,'只更新消息片段');
    }
    const cache=path.join(f.dir,'cache.gz');await usage.saveCache(cache);
    const restored=new AgentUsage({settings:usage.settings,cfg:usage.cfg});await restored.loadCache(cache);
    assert.equal(restored.summary(dayKey(now,usage.cfg)).out,out);
    assert.equal((await readConversation({jobs:{},usage:restored},{agent,sid}))[1].text,agent==='opencode'?'只更新消息片段':'更新后的结论');
    if(agent==='opencode')sql('UPDATE session_v2 SET time_archived=NULL;');else sql('UPDATE chat_sessions SET archived=0;');
    await usage.scan();assert.ok(!usage.hidden(sid));
  } finally {fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('disabled and scoped scans do not read desktop databases',async()=>{
 const f=fixture('qoder');try {f.usage.settings.primaryAgents=[];f.usage.settings.agents.qoder=false;await f.usage.scan();assert.equal(f.usage.files.size,0);f.usage.settings.agents.qoder=true;await f.usage.scan({agent:'claude'});assert.equal(f.usage.files.size,0);}finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('organize journal has the default Ctrl+Alt+L shortcut',()=>{
 const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(source,/id: "group-active-journal"[^\n]*hotkeys: \[\{ modifiers: \["Ctrl", "Alt"\], key: "L" \}\]/);
});

test('About lists organize journal before other common operations',()=>{
 const source=fs.readFileSync(new URL('../src/settings.js',import.meta.url),'utf8');
 const guide=source.slice(source.indexOf('const guide = this.card(body, t("常用操作"))'));
 assert.match(guide,/const rows = \[\s*\[t\("整理日志"\)/);
});

test('OpenCode legacy desktop schema preserves text, tokens and completion',async()=>{
 const f=fixture('opencode');try {
   f.sql(`DROP TABLE session_v2; DROP TABLE session_message; DROP TABLE session_part;
     CREATE TABLE session(id,title,directory,parent_id,time_created,time_updated,time_archived);
     CREATE TABLE message(id,session_id,time_created,time_updated,data);
     CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data);
     INSERT INTO session VALUES('ses_old','旧版','/project',NULL,${now},${now+1000},NULL);
     INSERT INTO message VALUES('u','ses_old',${now},${now},${quote({role:'user',time:{created:now}})}),('a','ses_old',${now+1000},${now+1000},${quote({role:'assistant',time:{created:now+1000,completed:now+2000},tokens:{input:3,output:7}})});
     INSERT INTO part VALUES('p1','u','ses_old',${now},${now},${quote({type:'text',text:'旧版问题'})}),('p2','a','ses_old',${now},${now},${quote({type:'text',text:'旧版回复'})});`);
   await f.usage.scan();assert.equal(f.usage.meta.get('ses_old').lastText,'旧版回复');assert.equal(f.usage.meta.get('ses_old').out,7);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('primary changes recover old history and preserve it on later non-primary updates',async()=>{
 const f=fixture('qoder');try {
   const old=now-3*86400000;
   f.sql(`UPDATE chat_sessions SET created_at=${old},updated_at=${now}; UPDATE chat_session_messages SET created_at=${old},updated_at=${now},payload_json=replace(payload_json,${quote(new Date(now).toISOString())},${quote(new Date(old).toISOString())});`);
   f.usage.settings.primaryAgents=[];
   await f.usage.scan();assert.equal(f.usage.meta.size,0);
   f.usage.settings.primaryAgents=['qoder'];
   await f.usage.scan();assert.equal(f.usage.meta.get(f.sid).turns,1);
   f.usage.settings.primaryAgents=[];
   await f.usage.scan();assert.equal(f.usage.meta.get(f.sid).turns,1);assert.deepEqual(f.usage.errors,[]);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('manual binding persists the note path and task identity used by conversation archive links',()=>{
 const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('  bindSessionAt('),end=source.indexOf('  // 把笔记里的第',start);
 class MarkdownView {}
 const view=new MarkdownView();
 const cm={state:{doc:{toString:()=>'- TODO 手动绑定验收\n'}}};
 view.file={path:'Agent Deck/Tests/binding.md'};view.editor={cm,transaction(){}};
 const bind=runInNewContext('({'+source.slice(start,end)+'}).bindSessionAt',{MarkdownView,J,dayKeyToday,fmtClock,Date,AGENTS,t:x=>x,setTimeout(){}});
 let bound=false;
 const plugin={settings:{},app:{workspace:{iterateAllLeaves(fn){fn({view})}}},usage:{meta:new Map(),summary:()=>null},liveSessions:()=>[],
   markBound(sid,blockId,key){const b=this.settings.taskBindings[sid];assert.equal(b.path,view.file.path);assert.equal(b.sid,sid);assert.equal(b.agent,'opencode');assert.equal(b.blockId,blockId);assert.equal(b.key,key);bound=true},
   notice(){},refreshUI(){},journalSync:{run:async()=>{}}};
 bind.call(plugin,cm,0,{agent:'opencode',sid:'ses_binding_test',title:'验收'});
 assert.ok(bound);
});
