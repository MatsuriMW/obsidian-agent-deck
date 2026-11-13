import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { conversationMessages, conversationMarkdown, conversationPath, archiveConversation, readConversation } from '../src/conversation.js';
const lines=(rows)=>rows.map(JSON.stringify).join('\n');
const full='多行消息\n'+ '完整正文'.repeat(4000);

test('conversation: reads full multi-line messages from supported agents, excludes tool and reasoning blocks',()=>{
 const cases={
  dsh:[{type:'user/message',data:{message:{content:[{type:'text',text:full}]}}},{type:'assistant/message',data:{message:{content:[{type:'thinking',text:'hidden'},{type:'text',text:'回复'}]}}}],
  claude:[{type:'user',message:{content:full}},{type:'assistant',message:{content:[{type:'text',text:'回复'},{type:'tool_use',name:'Bash'}]}},{type:'assistant',isSidechain:true,message:{content:'subagent'}}],
  codex:[{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:full}]}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'回复'}]}}],
  workbuddy:[{type:'message',role:'user',content:[{type:'input_text',text:full}]},{type:'message',role:'assistant',content:[{type:'output_text',text:'回复'}]}],
 };
 for(const [agent,records]of Object.entries(cases)){const m=conversationMessages(agent,lines(records));assert.deepEqual(m.map(x=>[x.role,x.text]),[['user',full],['assistant','回复']],agent)}
});
test('conversation: latest version replaces repeated message ID without dropping distinct messages',()=>{
 const source=lines([{type:'message',id:'1',role:'assistant',content:'partial'},{type:'message',id:'1',role:'assistant',content:'complete'},{type:'message',id:'2',role:'assistant',content:'next'}]);
 assert.deepEqual(conversationMessages('workbuddy',source).map(m=>m.text),['complete','next']);
});
test('conversation: safe archive path and faithful markdown text',()=>{
 const session={agent:'dsh',sid:'../escape',title:'test\nheading'};
 assert.equal(conversationPath(session),'Agent Deck/Conversations/dsh-___escape.md');
 const md=conversationMarkdown(session,[{role:'user',text:full},{role:'assistant',text:'```js\nlet a=1;\n```'}]);
 assert.ok(md.includes(full));assert.ok(md.includes('```js\nlet a=1;\n```'));assert.ok(md.startsWith('# test heading\n'));
});
test('conversation: archive creates note, is idempotent and protects existing edits',async()=>{
 const files=new Map();const session={agent:'dsh',sid:'session-1',title:'Test'};
 const plugin={jobs:{job:{agent:'dsh',sessionId:'session-1',conversation:[{role:'user',text:full},{role:'assistant',text:'answer'}]}},usage:{files:new Map()},app:{vault:{getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,{path:p}),create:async(p,text)=>{const f={path:p,text};files.set(p,f);return f},read:async f=>f.text,modify:async(f,text)=>{f.text=text}}}};
 const file=await archiveConversation(plugin,session);assert.ok(file.text.includes(full));assert.equal(await archiveConversation(plugin,session),file);file.text=file.text.replace('answer','用户手改');await assert.rejects(()=>archiveConversation(plugin,session),/已有归档/);assert.ok(file.text.includes('用户手改'));
});
test('conversation: reads raw logs instead of truncated usage rounds and excludes child agent logs',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-conv-'));try{
 const p=path.join(dir,'log.jsonl');fs.writeFileSync(p,lines([{type:'user',message:{content:full}}]));
 const plugin={jobs:{},usage:{files:new Map([['main',{path:p,sid:'sid',agent:'claude'}],['sub',{path:p,sid:'sid',agent:'claude',sub:'agent-1'}]])}};
 const messages=await readConversation(plugin,{sid:'sid',agent:'claude'});assert.equal(messages.length,1);assert.equal(messages[0].text,full);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('conversation: DSH runtime context and skill catalogs are not user messages',()=>{
 const records=[{type:'user/message',data:{id:'user-1',source:{kind:'user'},content:'真实问题'}},{type:'user/message',data:{source:{kind:'runtime-context'},content:'系统运行环境'}},{type:'user/message',data:{source:{kind:'skill-catalog'},content:'系统技能目录'}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'真实回答'}]}}}];
 assert.deepEqual(conversationMessages('dsh',lines(records)).map(m=>m.text),['真实问题','真实回答']);
});

test('conversation: archive refresh appends later turns and preserves notes outside generated region',async()=>{
 const files=new Map();const session={agent:'dsh',sid:'update-test',title:'Test'};
 const conversation=[{role:'user',text:'first'},{role:'assistant',text:'one'}];
 const plugin={jobs:{job:{agent:'dsh',sessionId:'update-test',conversation}},usage:{files:new Map()},app:{vault:{getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,{path:p}),create:async(p,text)=>{const f={path:p,text};files.set(p,f);return f},read:async f=>f.text,modify:async(f,text)=>{f.text=text}}}};
 const file=await archiveConversation(plugin,session);file.text='手写说明\n'+file.text+'\n补充备注';conversation.push({role:'user',text:'second'},{role:'assistant',text:'two'});await archiveConversation(plugin,session);assert.ok(file.text.includes('second'));assert.ok(file.text.includes('two'));assert.ok(file.text.startsWith('手写说明\n'));assert.ok(file.text.endsWith('\n补充备注'));
});
