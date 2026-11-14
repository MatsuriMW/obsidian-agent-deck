import assert from 'node:assert/strict';
import {aiRecordGroups, recordRuns, visibleRecords, recordIsOpen, recordStartsOpen} from '../src/ai-records.js';
import {DEFAULTS} from '../src/constants.js';
import {syncSessionEntry, isDoneLine, clocksLast} from '../src/journal.js';
// 默认组合必须留存每轮，并在收起时只显示最新 AI 结论。
assert.equal(DEFAULTS.autoLogGranularity, 'round');
assert.equal(DEFAULTS.aiRecordDisplay, 'latest1');
const text = '- DOING 任务 ^ad-abc123\n\t- 💬 1\n\t- 手写笔记\n\t- 💬 2\n\t- 📋 3\n\t- ❓ 4\n\t- 💬 5\n\t- 💬 6\n\t- TODO 用户任务\n\t\t- 💬 用户的嵌套记录\n- 别的任务\n\t- 💬 不属于 Agent\n';
const groups=aiRecordGroups(text);
assert.equal(groups.length,1);
assert.deepEqual(groups[0].records,[1,3,4,5,6,7]);
assert.deepEqual(recordRuns(groups[0].records),[{from:1,to:1},{from:3,to:7}]);
assert.deepEqual(groups[0].records.slice(-5),[3,4,5,6,7]);
assert.deepEqual(recordRuns(groups[0].records.slice(0,-5)),[{from:1,to:1}]);
assert.equal(aiRecordGroups('- DOING 改名 ^nw-abc\n\t- 💬 结果',new Set(['nw-abc'])).length,1);
{
  // 合并总结：可见的只有那一条，每轮明细仍在下面，供「更多」展开
  const sid = '11111111-2222-3333-4444-555555555555';
  const merged = syncSessionEntry(`- DOING 写周报 ^ad-m\n  - 🔗 [Claude：周报](claude://resume?session=${sid})\n`, {
    sid, granularity: 'latest', detail: 'brief',
    rounds: [1, 2, 3].map((n) => ({ n, ask: `问题${n}`, said: `第${n}轮结论` })),
    compact: { through: 3, text: '周报写完并发给组长，还差下周计划那一段。' },
  });
  const g = aiRecordGroups(merged.text, new Set())[0];
  assert.equal(g.summaries.length, 1, 'one merged summary line');
  assert.equal(g.records.length, 5, 'link + summary + 3 brief results');
  assert.ok(/💬 累计总结：周报写完并发给组长/.test(merged.text));
  const shownWhenClosed = g.records.filter((n) => g.summaries.includes(n));
  assert.equal(shownWhenClosed.length, 1, 'collapsed shows only the summary');
  assert.ok(merged.text.includes('💬 第3轮：任务：问题3；结论：第3轮结论'), 'round details stay in the note');
}
{
  // 显示模式：折叠时露出哪些行
  const src = [
    '- DOING 写周报 ^ad-a',
    '\t- 🔗 [c](x)',
    '\t- 💬 累计总结：总结一句',
    '\t- ❓ 第1轮：问1',
    '\t- 💬 第1轮：答1',
    '\t- ❓ 第2轮：问2',
    '\t- 💬 第2轮：答2',
    '- DONE 已完成 ^ad-b',
    '\t- ❓ 第1轮：问',
    '\t- 💬 第1轮：答',
  ].join('\n');
  const lines = src.split('\n');
  const [doing, done] = aiRecordGroups(src, new Set());
  assert.equal(doing.state, 'doing'); assert.equal(doing.kw, 'DOING');
  assert.equal(done.state, 'done');
  assert.deepEqual(visibleRecords(doing, lines, 'collapsed'), doing.summaries, 'collapsed shows only the merged summary');
  assert.deepEqual(visibleRecords(doing, lines, 'latest1'), [6], 'latest one shows only the last AI conclusion');
  assert.deepEqual(visibleRecords(done, lines, 'latest1'), [9], 'DONE follows the same latest conclusion rule');
  assert.deepEqual(visibleRecords(doing, lines, 'latest3'), [4, 6], 'links, prompts and summary do not consume conclusion slots');
  assert.deepEqual(visibleRecords(doing, lines, 'latest5'), [4, 6]);
  assert.deepEqual(visibleRecords(doing, lines, 'expanded'), doing.summaries, 'manually closing expanded mode actually hides history');

  // 没有轮次、只有一条结论时，最新一条就露这一条
  const plain = aiRecordGroups('- DOING 简单 ^ad-c\n\t- 💬 只有一条结论', new Set())[0];
  assert.deepEqual(visibleRecords(plain, '- DOING 简单 ^ad-c\n\t- 💬 只有一条结论'.split('\n'), 'latest1'), [1]);

  // 各模式的默认展开状态；手动开合优先
  const g = { key: 'ad-a', summaries: [] };
  const gs = { key: 'ad-b', summaries: [2] };
  assert.equal(recordStartsOpen('expanded', g), true);
  assert.equal(recordStartsOpen('expanded', gs), true, 'expanded also applies to merged summaries');
  for (const mode of ['collapsed', 'latest5', 'latest1']) assert.equal(recordStartsOpen(mode, g), false, mode);
  assert.equal(recordIsOpen({}, 'collapsed', g), false);
  assert.equal(recordIsOpen({ aiRecordExpanded: { 'ad-a': true } }, 'collapsed', g), true);
  assert.equal(recordIsOpen({ aiRecordClosed: { 'ad-a': true } }, 'expanded', g), false, 'folding by hand sticks in expanded mode');
  assert.equal(recordIsOpen({ aiRecordClosed: { 'ad-a': true }, aiRecordExpanded: { 'ad-a': true } }, 'expanded', g), false, 'closing wins');
}

{
  // 写回：最新进展模式下也保留最近一轮的提问，旧轮次不堆叠
  const sid = '11111111-2222-3333-4444-555555555555';
  const base = `- DOING 写周报 ^ad-z\n  - 🔗 [c](claude://resume?session=${sid})\n`;
  let text = base;
  for (const n of [1, 2]) {
    text = syncSessionEntry(text, { sid, granularity: 'latest', detail: 'brief', rounds: [{ n, ask: `第${n}轮问`, said: `第${n}轮答` }] }).text;
  }
  const asks = text.split('\n').filter((l) => /❓/.test(l));
  assert.equal(asks.length, 0, 'brief records combine task and result without a separate prompt line');
  const g = aiRecordGroups(text, new Set())[0];
  const shown = visibleRecords(g, text.split('\n'), 'latest1');
  assert.equal(shown.length, 1, 'only the AI conclusion is visible');
  assert.ok(/💬/.test(text.split('\n')[shown[0]]));
}

{
  // 做完的任务不再画行尾状态 pill（判断依据和日记里的关键词保持一致）
  assert.equal(isDoneLine('- DONE 写周报'), true);
  assert.equal(isDoneLine('- [x] 复选框任务'), true);
  assert.equal(isDoneLine('- CANCELLED 取消'), true);
  assert.equal(isDoneLine('- FAILED 失败'), true);
  assert.equal(isDoneLine('- DOING 跑着'), false);
  assert.equal(isDoneLine('- TODO 待办'), false);
  assert.equal(isDoneLine('普通正文'), false);
}

{
  // ⏱ 行排在本任务记录的最后：先 ❓、再 💬，最后 ⏱；其他行（含手写笔记、多轮配对）不动
  const src = [
    '- DOING 写周报 ^ad-q',
    '\t- ❓ 第2轮：问2',
    '\t- ⏱ 10:00–11:00 · 共 1h · Claude',
    '\t- 💬 第2轮：答2',
    '\t- 手写备注',
    '\t- ❓ 第1轮：问1',
    '\t- 💬 第1轮：答1',
    '- DONE 别的 ^ad-r',
    '\t- 💬 只有结论',
  ].join('\n');
  const want = [
    '- DOING 写周报 ^ad-q',
    '\t- ❓ 第2轮：问2',
    '\t- 💬 第2轮：答2',
    '\t- 手写备注',
    '\t- ❓ 第1轮：问1',
    '\t- 💬 第1轮：答1',
    '\t- ⏱ 10:00–11:00 · 共 1h · Claude',
    '- DONE 别的 ^ad-r',
    '\t- 💬 只有结论',
  ].join('\n');
  assert.equal(clocksLast(src), want, 'clock moves to the end of its own record block');
  assert.equal(clocksLast(want), want, 'already ordered stays untouched');
  assert.equal(clocksLast('- DOING 只有用时 ^ad-s\n\t- ⏱ 10:00–10:10 · 共 10m'), '- DOING 只有用时 ^ad-s\n\t- ⏱ 10:00–10:10 · 共 10m', 'a lone clock stays put');

  // 嵌套任务的记录块各归各的：子任务的 ⏱ 不能跑到父任务块末尾
  const nested = [
    '- DOING 父任务 ^ad-p',
    '\t- ❓ 问',
    '\t- 💬 答',
    '\t- DOING 子任务 ^ad-c',
    '\t\t- ⏱ 09:00–09:30 · 共 30m',
    '\t\t- 💬 子结论',
  ].join('\n');
  assert.equal(clocksLast(nested), [
    '- DOING 父任务 ^ad-p',
    '\t- ❓ 问',
    '\t- 💬 答',
    '\t- DOING 子任务 ^ad-c',
    '\t\t- 💬 子结论',
    '\t\t- ⏱ 09:00–09:30 · 共 30m',
  ].join('\n'), 'nested tasks keep their own clock');
  // 围栏代码块里的示例任务原样不动
  const fenced = [
    '- DOING 父任务 ^ad-f',
    '\t- ❓ 问',
    '\t```',
    '\t- DOING 示例 ^ad-x',
    '\t\t- ⏱ 10:00–10:10',
    '\t\t- 💬 示例结论',
    '\t```',
  ].join('\n');
  assert.equal(clocksLast(fenced), fenced, 'tasks inside code fences are left alone');
}
console.log('PASS AI folding groups exclude manual notes and nested tasks; latest five preserves all records; the clock line always sits last');

{
  const sid = '11111111-2222-3333-4444-555555555555';
  let note = `- DOING 多轮 ^ad-history\n  - 手写备注\n  - TODO 子任务\n    - 💬 子任务结果\n  - 🔗 [c](claude://resume?session=${sid})`;
  const rounds = [];
  for (let n = 1; n <= 6; n++) {
    rounds.push({ n, ask: `问题${n}`, said: `结论${n}` });
    note = syncSessionEntry(note, {sid, rounds, granularity: DEFAULTS.autoLogGranularity, detail: 'detailed'}).text;
  }
  const lines = note.split('\n');
  const g = aiRecordGroups(note)[0];
  for (const count of [1, 3, 5]) {
    const shown = visibleRecords(g, lines, `latest${count}`);
    assert.equal(shown.length, count);
    assert.ok(shown.every(n => /💬/.test(lines[n])));
    assert.ok(lines[shown[0]].includes('结论6'));
    assert.equal(g.records.filter(n => /💬/.test(lines[n])).length, 6, 'changing display keeps all conclusions');
  }
  assert.ok(note.includes('手写备注') && note.includes('子任务结果'));
  assert.equal(g.records.filter(n => /❓/.test(lines[n])).length, 6, 'detailed records preserve each prompt');
  assert.equal(recordIsOpen({aiRecordExpanded: {[g.key]: true}}, 'latest1', g), true);
  assert.equal(syncSessionEntry(note, {sid, rounds, granularity: 'round', detail: 'detailed'}).text, note, 'repeat write is idempotent');
}

{
 const note=['- DOING real ^ad-real','  ```md','  - DOING example ^ad-example','    - 💬 sample','  ```','  - 💬 actual result'].join('\n');
 const gs=aiRecordGroups(note);
 assert.deepEqual(gs.map(g=>g.key),['ad-real'],'code samples must not acquire real folding controls');
 assert.deepEqual(gs[0].records,[5],'code-sample records must stay visible as source examples');
 assert.equal(recordStartsOpen('expanded',{summaries:[1]}),true,'default expanded must also apply to summarized records');
}
