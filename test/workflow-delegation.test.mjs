import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Delegator, freshTaskText, blockAt, ancestorLines, delegationText } from '../src/delegation.js';
import { DEFAULTS, deepMerge } from '../src/constants.js';
import { archiveConversation } from '../src/conversation.js';
const req=createRequire(import.meta.url),opened=[];
globalThis.require=s=>s==='electron'?{shell:{openExternal:u=>opened.push(u)}}:req(s);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-workflow-'));
const bin=path.join(dir,'claude');fs.writeFileSync(bin,'#!/usr/bin/env node\nprocess.stdout.write("完成");\n');fs.chmodSync(bin,0o755);
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
let note='- TODO 测试 ^ad-task\n\t- 手写子任务\n';
const plugin={settings:deepMerge(DEFAULTS,{}),jobs:{},vaultPath:dir,usage:{meta:new Map()},saveSettings(){},saveJobs(){},refreshUI(){},notice(){},readNote:async()=>note,writeNote:async(p,text)=>{await new Promise(r=>setTimeout(r,5));note=text;},agentEnabled:()=>true,modelsFor:()=>[],defaultModel:()=>'',openConversation:s=>opened.push('obsidian:'+s.sid)};
plugin.settings.delegate.claude.path=bin;plugin.settings.delegate.claude.cwd=dir;plugin.settings.delegate.claude.autoTrustedCwd=false;plugin.settings.delegate.claude.openDesktop=true;
plugin.settings.autoWriteResult=false;
const d=new Delegator(plugin);
{
 // 委派发出去的是「被点的那一行 + 它下面更深的子块」，母项不进 prompt
 const lines=['- TODO 做一个博客','\t- TODO 写首页','\t\t- 要求：有搜索框','\t- TODO 写归档页'];
 assert.equal(blockAt(lines,1).text,'\t- TODO 写首页\n\t\t- 要求：有搜索框','更深的子项跟着走');
 assert.ok(!blockAt(lines,1).text.includes('做一个博客'),'blockAt 只取这一项，母项由委派时另外作为上下文加');
 assert.equal(blockAt(lines,2).text,'\t\t- 要求：有搜索框');
 assert.equal(blockAt(lines,3).text,'\t- TODO 写归档页','不会并进同级的下一个子项');
 // 混合缩进：母项 4 空格、子项 tab、子子项两个 tab，也认得出更深的子块
 const mixed=['- TODO 父项','    - TODO 子项','\t\t- 更深的说明'];
 assert.equal(blockAt(mixed,1).text,'    - TODO 子项\n\t\t- 更深的说明','混合缩进按视觉宽度算');
 // 有序列表
 const ol=['1. TODO 第一步','   1. TODO 子步骤','      - 细节'];
 assert.equal(blockAt(ol,1).text,'   1. TODO 子步骤\n      - 细节');
 // 子项委派带母项：一直带到最顶层列表项，兄弟项不带，母项和任务都保留原缩进
 const tree=['- 项目 A','\t- 子任务 A.1','\t\t- 要求','\t- 子任务 A.2','- 另一个'];
 const a1=blockAt(tree,1);
 assert.deepEqual(ancestorLines(tree,a1.start),['- 项目 A'],'直接母项');
 const deep=['- 项目','\t- 阶段','\t\t- 步骤','\t\t\t- 细节'];
 assert.deepEqual(ancestorLines(deep,2),['- 项目','\t- 阶段'],'三层都带上');
 const sent=delegationText(tree,a1);
 assert.ok(sent.includes('只做最里面这一项'));
 assert.ok(sent.includes('- 项目 A')&&sent.includes('\t- 子任务 A.1'),'母项和任务都保留原缩进');
 assert.ok(!sent.includes('子任务 A.2'),'兄弟项不带');
 const prompt=d.buildPrompt({block:a1, contextLines:ancestorLines(tree,a1.start)});
 assert.ok(prompt.includes('项目 A')&&prompt.includes('子任务 A.1')&&prompt.includes('只做最里面这一项'),'prompt 带上母项上下文');
}
const wait=async j=>{for(let i=0;i<400&&['starting','running'].includes(j.state);i++)await new Promise(r=>setTimeout(r,10));assert.equal(j.state,'done')};
try{
 const one=await d.delegate({file:{path:'task.md'},lines:note.split('\n'),line:0,agent:'claude',destination:'background'});await wait(one);assert.equal(opened.length,0,'background overrides global auto-open');assert.equal(one.destination,'background');
 const firstLink=note.match(/session=([0-9a-f-]{36})/)?.[1];assert.ok(firstLink);
 await assert.rejects(()=>d.delegate({file:{path:'task.md'},lines:note.split('\n'),line:0,agent:'claude',destination:'background'}),/已经有/);
 const two=await d.delegate({file:{path:'task.md'},lines:note.split('\n'),line:0,agent:'claude',destination:'desktop',newSession:true});await wait(two);assert.equal(opened.length,1);assert.notEqual(one.sessionId,two.sessionId);assert.ok(note.includes(firstLink));assert.ok(note.includes(two.sessionId));assert.equal(two.blockId,one.blockId);
 const codex=path.join(dir,'codex');
 fs.writeFileSync(codex,`#!/usr/bin/env node
const rl=require('readline').createInterface({input:process.stdin});
rl.on('line',s=>{const m=JSON.parse(s);if(m.id==null)return;let result={};if(m.method==='thread/start')result={thread:{id:'33333333-3333-4333-8333-333333333333'},model:m.params.model};if(m.method==='turn/start')result={turn:{id:'t'}};process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');if(m.method==='turn/start')setTimeout(()=>process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'33333333-3333-4333-8333-333333333333',turn:{status:'completed'}}})+'\\n'),10)});`);
 fs.chmodSync(codex,0o755);plugin.settings.delegate.codex.path=codex;plugin.settings.delegate.codex.transport='terminal';
 const openBefore=opened.length;
 const bg=await d.delegate({file:{path:'task.md'},lines:note.split('\n'),line:0,agent:'codex',destination:'background',newSession:true});await wait(bg);
 assert.equal(opened.length,openBefore,'Codex background does not launch Desktop despite terminal default');
 assert.equal(bg.app,'vscode');

 await Promise.all(ids.map((sid,i)=>d.writeLink({id:'test'+i,agent:'dsh',name:'测试',path:'task.md',lineText:note.split('\n')[0],blockId:'ad-task',newSession:true},sid)));
 for(const sid of [...ids,one.sessionId,two.sessionId])assert.ok(note.includes(sid),'serialized binding keeps '+sid);
 const combined=note;
 await d.writeLink({agent:'dsh',path:'task.md',blockId:'ad-task'},ids[0]);assert.equal(note,combined,'same SID is idempotent');
 const job={agent:'antigravity',id:'inline',destination:'obsidian',path:'task.md',linkWritten:true};d.onSession(job,ids[0]);assert.ok(opened.includes('obsidian:'+ids[0]));
 await assert.rejects(()=>d.delegate({agent:'antigravity',destination:'desktop'}),/不支持/);
 const cleaned=freshTaskText('- TODO 测试 ^ad-task\n\t- 🔗 旧链接\n\t- 💬 旧结论\n\t- 📄 旧归档\n\t- 手写子任务');assert.equal(cleaned,'- TODO 测试\n\t- 🔗 旧链接\n\t- 💬 旧结论\n\t- 📄 旧归档\n\t- 手写子任务');
 // Saving a transcript links back to the task and leaves its state unchanged.
 const files=new Map([['task.md',{path:'task.md'}]]);
 plugin.app={vault:{getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,{path:p}),create:async(p,text)=>{const f={path:p,text};files.set(p,f);return f},read:async f=>f.text,modify:async(f,text)=>f.text=text}};
 one.conversation=[{role:'user',text:'问题'},{role:'assistant',text:'答案'}];one.state='done';
 plugin.usage.files=new Map();
 const root=note.split('\n')[0],archive=await archiveConversation(plugin,{agent:'claude',sid:one.sessionId});assert.ok(note.includes('[['+archive.path+'|对话归档'));assert.equal(note.split('\n')[0],root);const saved=note;await archiveConversation(plugin,{agent:'claude',sid:one.sessionId});assert.equal(note,saved);
 assert.ok(archive.text.includes('问题'));assert.ok(archive.text.includes('答案'));
 console.log('PASS per-dispatch destinations, real subprocess, preserved multi-session links, concurrent binding, new prompt and archive backlink');
}finally{clearTimeout(d._saveT);fs.rmSync(dir,{recursive:true,force:true})}
