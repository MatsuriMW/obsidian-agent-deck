import assert from 'node:assert/strict';
import {syncSessionEntry} from '../src/journal.js';
const base='- DOING task ^ad-detail-new';
const round={n:1,at:100,ask:'请调整入口。保留旧数据。',said:'入口已经调整。旧数据完整保留。验证全部通过。'};
const write=(text,detail,rounds=[round],extra={})=>syncSessionEntry(text,{blockId:'ad-detail-new',detail,granularity:'round',rounds,...extra}).text;
const brief=write(base,'brief');
assert.ok(!brief.includes('❓'),'brief only retains an AI conclusion');
const standard=write(base,'standard');
assert.ok(standard.includes('❓')&&standard.includes('💬'));
assert.ok(!standard.includes('旧数据完整保留。'),'standard keeps one sentence from the reply');
const detailed=write(base,'detailed');
assert.ok(detailed.includes('旧数据完整保留。')&&detailed.includes('保留旧数据。'),'detailed retains more of both sides');
assert.equal(write(brief,'detailed'),brief,'changing detail must not rewrite an existing round');
const next={n:2,at:300,ask:'下一轮问题。第二句。',said:'下一轮回答。额外细节。'};
const mixed=write(brief,'detailed',[round,next]);
assert.ok(mixed.includes(brief.split('\n')[1]),'old conclusion remains byte-for-byte');
assert.ok(!mixed.includes('❓ 第1轮')&&mixed.includes('❓ 第2轮'));
assert.equal(write(mixed,'brief',[round,next]),mixed,'lowering detail preserves previously saved questions and text');
console.log('PASS distinct log detail and append-only existing rounds');

const {changeLogDetail,detailForRound}=await import('../src/log-detail.js');
const settings={autoLogDetail:'brief',autoLogDetailHistory:[]};changeLogDetail(settings,'detailed',200);
assert.equal(detailForRound(settings.autoLogDetail,settings.autoLogDetailHistory,{at:100}),'brief');
assert.equal(detailForRound(settings.autoLogDetail,settings.autoLogDetailHistory,{at:300}),'detailed');
changeLogDetail(settings,'standard',400);
assert.equal(detailForRound(settings.autoLogDetail,settings.autoLogDetailHistory,{at:300}),'detailed','round already started retains its own policy');
assert.equal(detailForRound(settings.autoLogDetail,settings.autoLogDetailHistory,{at:500}),'standard');

const {evidenceBlocks,parseMemories}=await import('../src/dream.js');
const evidence=evidenceBlocks(detailed,'copy/development-log.md');
assert.ok(evidence.some(b=>b.kind==='user'&&b.text.includes('❓')));
assert.ok(evidence.some(b=>b.kind==='ai'&&b.text.includes('💬')));
assert.ok(evidence.every(b=>b.path==='copy/development-log.md'),'copied logs keep an explicit source note for Dreaming');

{
 const a='11111111-2222-3333-4444-555555555555',b='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 let text=`- DOING multi ^ad-multi-log\n  - 🔗 [Codex](codex://threads/${a})\n  - 🔗 [Codex](codex://threads/${b})`;
 text=syncSessionEntry(text,{sid:a,granularity:'round',detail:'brief',rounds:[{n:1,said:'会话甲的结论。'}]}).text;
 text=syncSessionEntry(text,{sid:b,granularity:'round',detail:'brief',rounds:[{n:1,said:'会话乙的结论。'}]}).text;
 assert.ok(text.includes('会话甲的结论。')&&text.includes('会话乙的结论。'),'round one from a second session cannot disappear behind the first session');
}

const code=write(base,'detailed',[{n:1,ask:'请验证',said:'运行验证：\n```sh\nnpm test\n```\n结果全部通过。'}]);
assert.ok(code.includes('npm test'),'detailed excerpts preserve commands inside code blocks');

const {adBlockIdRanges}=await import('../src/ai-records.js');
const marked=syncSessionEntry(base,{blockId:'ad-detail-new',sid:'11111111-2222-3333-4444-555555555555',detail:'standard',granularity:'round',rounds:[round]}).text;
assert.ok(adBlockIdRanges(marked).some(r=>marked.slice(r.from,r.to).includes('ad-turn:')),'source identities are hidden in the editor');

// Changing retention must never delete saved conclusions, prompts or steps.
{
  const sid = '11111111-2222-3333-4444-555555555555';
  const rounds = [round, next, { n: 3, at: 500, ask: '第三轮问题。', said: '第三轮回答。' }];
  const old = syncSessionEntry(base, { sid, blockId: 'ad-detail-new', detail: 'detailed', granularity: 'round', rounds: rounds.slice(0, 2), taskTodo: { total: 2, done: 1, cur: '验证入口' } }).text;
  const update = (text, rs) => syncSessionEntry(text, { sid, blockId: 'ad-detail-new', detail: 'brief', detailHistory: [{ at: 0, detail: 'detailed' }, { at: 400, detail: 'brief' }], granularity: 'latest', rounds: rs }).text;
  assert.equal(update(old, rounds.slice(0, 2)), old, 'switching settings alone changes no saved text');
  const appended = update(old, rounds);
  for (const line of old.split('\n')) assert.ok(appended.split('\n').includes(line), 'saved line survives latest progress: ' + line);
  assert.ok(appended.includes('第三轮回答。') && !appended.includes('第三轮问题。'), 'new round uses new brief detail');
  assert.equal(update(appended, rounds), appended, 'repeated scans are idempotent');
  const more = update(appended, [...rounds, { n: 4, at: 600, ask: '第四轮问题。', said: '第四轮回答。' }]);
  for (const line of appended.split('\n')) assert.ok(more.split('\n').includes(line), 'later latest-progress writes also retain saved text');
  assert.ok(more.includes('第四轮回答。'));
}
console.log('PASS latest-progress transitions preserve all saved records and use new detail for new rounds');
