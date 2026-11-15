import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanUserPrompt,isPromptText,AgentUsage} from '../src/readers.js';
import * as J from '../src/journal.js';
const reply='<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:'id',question:'版本号用哪个？',answer:'用 1.9.6'}])+'\n</send_user_message_question_reply>';
test('confirmation replies preserve the chosen answer without transport tags or internal IDs',()=>{
 const cleaned=cleanUserPrompt(reply);
 assert.ok(cleaned.includes('用 1.9.6'));assert.ok(!cleaned.includes('send_user_message'));assert.ok(!cleaned.includes('questionItemId'));
});
test('brief and detailed journal records do not expose question-reply envelopes, including old cached rounds',()=>{
 for(const detail of ['brief','standard','detailed']){
  const note=J.syncSessionEntry('- DOING 🤖 发布插件 ^ad-reply',{sid:'reply-session',blockId:'ad-reply',detail,granularity:'round',rounds:[{n:6,ask:reply,said:'将使用所选版本发布'}]}).text;
  assert.ok(!note.includes('send_user_message_question_reply'),note);assert.ok(note.includes('1.9.6'),note);
 }
});
test('empty transport messages are not prompts, while literal documentation examples remain user content',()=>{
 assert.equal(isPromptText(cleanUserPrompt('<send_user_message_question_reply>[]</send_user_message_question_reply>')),false);
 const literal='解释一下 `<send_user_message_question_reply>` 是什么';assert.equal(cleanUserPrompt(literal),literal);
 assert.equal(cleanUserPrompt('普通任务'), '普通任务');
});
test('real Codex logs keep confirmation answers readable and ignore empty reply envelopes',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {DEFAULTS,deepMerge}=await import('../src/constants.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-confirm-reply-')),file=path.join(dir,'session.jsonl');
 const now=Date.now()-60000;
 const event=(i,text)=>JSON.stringify({timestamp:new Date(now+i*1000).toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
 fs.writeFileSync(file,[JSON.stringify({timestamp:new Date(now).toISOString(),type:'session_meta',payload:{id:'reply-log-session',cwd:dir}}),event(1,'发布新版'),event(2,reply),event(3,'<send_user_message_question_reply>[]</send_user_message_question_reply>'),JSON.stringify({timestamp:new Date(now+4000).toISOString(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1,output_tokens:1}}}})].join('\n')+'\n');
 try{
  const settings=deepMerge(DEFAULTS,{primaryAgents:['codex']});const usage=new AgentUsage({settings,cfg:settings});usage.roots=()=>[[dir,'codex']];usage.desktopDatabases=()=>[];
  for(const key of ['readCodexTitles','readCodexArchived','readClaudeDesktop','readClaudeSideChats','applyClaudeDesktop'])usage[key]=async()=>{};
  await usage.scan({agent:'codex'});const meta=usage.meta.get('reply-log-session');
  assert.equal(meta.rounds.length,2);assert.ok(meta.rounds[1].ask.includes('用 1.9.6'));assert.ok(!JSON.stringify(meta).includes('send_user_message_question_reply'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('repair a generated control-label field while preserving its conclusion and handwritten content',()=>{
 const marker=J.turnMarker('reply-session',6);
 const broken=`- DOING 🤖 发布插件 ^ad-reply\n  - 💬 第6轮：任务：\\<send_user_message_question_reply>；结论：用户改过的结论 ${marker}\n  - 手写备注`;
 const args={sid:'reply-session',blockId:'ad-reply',rounds:[{n:6,ask:reply,said:'新的结论'}]};
 const fixed=J.syncSessionEntry(broken,args).text;
 assert.ok(!fixed.includes('send_user_message_question_reply'));assert.ok(fixed.includes('用 1.9.6'));assert.ok(fixed.includes('用户改过的结论'));assert.ok(fixed.includes('手写备注'));
 assert.equal(J.syncSessionEntry(fixed,args).text,fixed);
 const protectedRow=broken.replace(marker,marker+' ^user-result');assert.ok(J.syncSessionEntry(protectedRow,args).text.includes('send_user_message_question_reply'),'a record with its own user block ID is preserved');
});
