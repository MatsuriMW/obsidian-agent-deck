import assert from 'node:assert/strict';
import {test} from 'node:test';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};',shortCircuit:true};return n(s,c)}`));
const J=await import('../src/journal.js');const {AutoLog}=await import('../src/autolog.js');
const {DEFAULT_RECORD_RULES,resolveRecordRules}=await import('../src/constants.js');
const agents=['claude','codex','dsh','workbuddy','antigravity','opencode','qoder','cursor','grokbot'];
const url='https://example.com/project/very-long-reference-document?source=all-agent-clients';
const title='10:30 前检查  [[工作计划|我的计划]]，保留用户改名';
for(const agent of agents)test(`${agent}: shared journal rules preserve semantics, compact links, edited titles and cleanup`,()=>{
 const sid=agent+'-universal-rules',blockId=J.makeBlockId(sid,agent,'journal-rules');
 const al=new AutoLog({settings:{}}),rec={key:'旧标题',label:'旧标题',created:true,agent,blockId};
 let note=`- DOING 🤖 09:00-09:30 ${title} ^${blockId}\n`+J.linkLine('  ',agent,'任务',sid);
 note=al.autoLine(note,rec,{sid,agent,segs:[[540,600]]},'paused').text;
 assert.ok(note.includes(title),'edited title is verbatim');
 const options={sid,agent,blockId,detail:'brief',granularity:'round',rounds:[{n:1,ask:'参考 '+url+' 修复缓存',summary:'缓存修复完成，尚未发布。',said:'原始回复与模型名称不影响公共格式'}]};
 note=J.syncSessionEntry(note,options).text;
 assert.ok(note.includes(`[🔗](${url})`),'full link remains clickable');
 assert.ok(note.includes('修复缓存')&&note.includes('缓存修复完成，尚未发布'),'task and outcome retain their meaning');
 assert.ok(note.includes(title));assert.equal(J.syncSessionEntry(note,options).text,note,'repeat scan is stable');
 note=al.autoLine(note,rec,{sid,agent,segs:[[540,600]]},'done').text;
 note=J.cleanCompletedIdentifiers(note);
 assert.ok(note.includes(title)&&note.includes(sid));assert.ok(!note.includes('^'+blockId)&&!note.includes('<!-- ad-turn:'));
});

test('recordRules layer: defaults, clamping, boldAutoTitle idempotency, mergeTasks, bindInto & AutoLog toggles', async () => {
 assert.deepEqual(DEFAULT_RECORD_RULES, { boldTitle: true, projectPrefix: true, showTimeRange: true, titleMax: 22 });
 assert.deepEqual(resolveRecordRules({}), DEFAULT_RECORD_RULES);
 assert.deepEqual(resolveRecordRules({ recordRules: { boldTitle: false, projectPrefix: false, showTimeRange: false, titleMax: 99 } }), { boldTitle: false, projectPrefix: false, showTimeRange: false, titleMax: 60 });
 assert.equal(resolveRecordRules({ recordRules: { titleMax: 3 } }).titleMax, 22);
 assert.equal(J.boldAutoTitle('修复缓存'), '**修复缓存**');
 assert.equal(J.boldAutoTitle('**修复缓存**'), '**修复缓存**', 'boldAutoTitle must not double-wrap ****');
 assert.equal(J.formatProjectAutoTitle('**agent-deck -> 修复缓存问题**', 'agent-deck', 22), 'agent-deck -> 修复缓存问题');

 // bindInto honors recordRules (boldTitle off, showTimeRange off, custom titleMax)
 const longTitle = '实现一套可配置且极其详细的自动记录格式规则系统以便测试长度限制';
 const bindDefault = J.bindInto('', 0, { agent: 'codex', sid: '00000000-0000-0000-0000-000000000001', title: '修复缓存', since: '09:00', until: '09:15', state: 'run' });
 assert.ok(bindDefault.text.startsWith('- DOING 🤖 09:00-09:15 **修复缓存**'));
 const bindCustom = J.bindInto('', 0, { agent: 'codex', sid: '00000000-0000-0000-0000-000000000002', title: longTitle, since: '09:00', until: '09:15', state: 'run' }, { rules: { boldTitle: false, showTimeRange: false, titleMax: 10 } });
 const firstLine = bindCustom.text.split('\n')[0];
 assert.equal(firstLine, '- DOING 🤖 实现一套可配置且极其', `got: ${firstLine}`);
 assert.ok(!firstLine.includes('**') && !firstLine.includes('09:00-09:15'));

 // mergeTasks between two AI lines does not duplicate 🤖 / HH:MM-HH:MM
 const merged = J.mergeTasks('- DOING 🤖 09:05-09:20 **任务B** ^ad-b\n', 0, 1, {});
 assert.equal(merged.error !== undefined, true);
 const twoTasks = '- DOING 🤖 09:00-09:10 **任务A** ^ad-a\n- DOING 🤖 09:05-09:20 **任务B** ^ad-b\n';
 const mOk = J.mergeTasks(twoTasks, 1, 0);
 assert.equal(mOk.text.split('\n')[0], '- DOING 🤖 09:00-09:20 **任务A** ^ad-a');

 // AutoLog honors recordRules: boldTitle=false, projectPrefix=false, showTimeRange=false across multiple ticks
 let note = '';
 const sid = 'codex-rules-toggle';
 const rec = { fresh: true, created: true, agent: 'codex', label: '测试规则开关持久化验证超过二十字' };
 const x = { sid, agent: 'codex', cwd: '/Users/chenchen/claude/agent-deck', segs: [[540, 555]] };
 const alOff = new AutoLog({ settings: { recordRules: { boldTitle: false, projectPrefix: false, showTimeRange: false, titleMax: 10 } } });
 alOff.placeBlock = (t, ls) => (t ? `${t}\n${ls.join('\n')}\n` : `${ls.join('\n')}\n`);
 let res = alOff.autoLine(note, rec, x, 'doing');
 note = res.text;
 assert.ok(note.startsWith('- DOING 🤖 测试规则开关持久化验 ^codex-'), `tick 1: ${note}`);
 // Tick 2 transitioning to paused must NOT re-inject HH:MM-HH:MM or bold when disabled
 delete rec.fresh;
 res = alOff.autoLine(note, rec, { ...x, segs: [[540, 560]] }, 'paused');
 assert.ok(res.text.startsWith('- PAUSED 🤖 测试规则开关持久化验 ^codex-'), `tick 2: ${res.text}`);
});
