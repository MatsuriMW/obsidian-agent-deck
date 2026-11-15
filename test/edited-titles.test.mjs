import assert from 'node:assert/strict';
import {test} from 'node:test';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};',shortCircuit:true};return n(s,c)}`));
const J=await import('../src/journal.js');const {AutoLog}=await import('../src/autolog.js');const {JournalSync}=await import('../src/sync.js');const {planJournal,renderJournal}=await import('../src/organize-journal.js');
const sid='title-session',id='ad-edited';
const title='10:30 前检查  [[Agent Deck|甲板]]，**保留  两个空格**与完整的用户标题，后续不能重新概括';
const rec={key:'🤖 自动标题',label:'🤖 自动标题',blockId:id,created:true};
test('auto recording preserves the exact edited title through activity, pause and completion',()=>{
 const al=new AutoLog({settings:{}});
 let text=`- DOING 🤖 09:00-09:30 ${title} ^${id}`;
 for(const status of ['doing','paused','done']){
  text=al.autoLine(text,rec,{sid,segs:[[540,600]]},status).text;assert.ok(text.includes(title),text);
 }
});
test('removing the generated title format does not cause auto recording to restore its old title',()=>{
 const al=new AutoLog({settings:{}});const manual='这是我自己写的  标题';
 const output=al.autoLine(`- DOING ${manual} ^${id}`,{...rec},{sid,segs:[[540,600]]},'paused').text;
 assert.ok(output.includes(manual),output);assert.ok(!output.includes('🤖'),output);
});
test('status sync, DONE and organize preserve edited title text',()=>{
 const p={settings:{},usage:{meta:new Map([[sid,{agent:'qoder',state:'wait'}]]),summary:()=>({list:[]}),archived:new Set()}};
 let note=`- DOING 🤖 09:00-09:30 ${title} ^${id}\n`+J.linkLine('  ','qoder','旧标题',sid);
 note=new JournalSync(p).keywords(note);assert.ok(note.includes(title),note);
 note=renderJournal(planJournal(note));assert.ok(note.includes(title),note);
 const line=note.split('\n').find(l=>l.startsWith('- TOREVIEW'));assert.ok(J.flipToDone(line).includes(title));
 p.usage.archived.add(sid);note=new JournalSync(p).keywords(note);assert.ok(note.includes(title),note);
});
