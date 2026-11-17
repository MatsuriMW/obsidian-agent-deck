// 多步轮次：上一轮最后那句话不能漏进下一轮的结论；没有文字的轮次结论为空。
import assert from 'node:assert/strict';
import { startRound, finishRound, ingestDshLine } from '../src/agent-ingestors.js';

// 1) startRound 换轮时把 live 上的上轮文本清掉
{
  const fc = {};
  const live = { lastText: '上一轮最后一句话' };
  startRound(fc, 1000, '第一个问题', 'k1', live);
  assert.equal(fc.rounds.list.at(-1).said, '');
  live.lastText = '第一轮的回答';
  finishRound(fc, 1100, live.lastText, true);
  startRound(fc, 2000, '第二个问题', 'k2', live);
  assert.equal(live.lastText, '', 'new round starts with no carried-over text');
  finishRound(fc, 2100, live.lastText, true);
  assert.equal(fc.rounds.list[0].said, '第一轮的回答');
  assert.equal(fc.rounds.list[1].said, '', 'a tool-only round has no conclusion');
}

// 2) 真跑 DSH 行：第二轮只有工具调用，不能继承第一轮的回答
{
  const live = { state: 'run' };
  const meta = new Map();
  const usage = {
    stale: () => false,
    touchSess: (fc) => ({ key: fc.sid, day: { prompts: 0 }, s: { text: '', proj: '' } }),
    liveOf: () => live,
    noteMeta: () => {},
    meta,
    titles: new Map(),
  };
  const fc = { sid: 'session-test-1', cwd: '~', days: new Map(), titles: new Map(), msgs: new Map() };
  const feed = (obj) => ingestDshLine({ usage }, JSON.stringify({ time: obj.time, type: obj.type, data: obj.data, seq: obj.seq }), fc, new Set());
  feed({ type: 'user/message', time: 1000, seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一个问题是什么' }] } });
  feed({ type: 'assistant/message', time: 1100, seq: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: '第一轮的回答内容。' }] } } });
  feed({ type: 'turn/end', time: 1200, seq: 3, data: { reason: { kind: 'done' } } });
  feed({ type: 'user/message', time: 2000, seq: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二个问题是什么' }] } });
  feed({ type: 'assistant/message', time: 2100, seq: 5, data: { message: { role: 'assistant', content: [{ type: 'tool-call', id: 't1', name: 'bash', arguments: '{}' }] } } });
  feed({ type: 'turn/end', time: 2200, seq: 6, data: { reason: { kind: 'done' } } });
  const rounds = fc.rounds.list;
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].said, '第一轮的回答内容。');
  assert.equal(rounds[1].said, '', 'tool-only round must not reuse the previous reply');
}

// 3) 被中断 / 额度不足的轮次：正文为空也要在日记里留一句为什么，额度类落到 HITLIMIT
{
  const live = { state: 'run' };
  const usage = {
    stale: () => false,
    touchSess: (fc) => ({ key: fc.sid, day: { prompts: 0 }, s: { text: '', proj: '' } }),
    liveOf: () => live,
    noteMeta: () => {},
    meta: new Map(),
    titles: new Map(),
  };
  const fc = { sid: 'session-test-2', cwd: '~', days: new Map(), titles: new Map(), msgs: new Map() };
  const feed = (obj) => ingestDshLine({ usage }, JSON.stringify({ time: obj.time, type: obj.type, data: obj.data, seq: obj.seq }), fc, new Set());
  feed({ type: 'user/message', time: 1000, seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一件要做的事' }] } });
  feed({ type: 'turn/end', time: 1100, seq: 2, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } });
  feed({ type: 'user/message', time: 2000, seq: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二件要做的事' }] } });
  feed({ type: 'turn/end', time: 2100, seq: 4, data: { reason: { kind: 'error', error: { message: 'Insufficient Balance', code: 'ACCOUNT_QUOTA', status: 402 } } } });
  assert.equal(fc.rounds.list[0].aborted, true);
  assert.equal(fc.rounds.list[1].quota, true);
  assert.equal(live.state, 'limit', 'a quota error maps to limit / HITLIMIT, not error');

  const { syncSessionEntry } = await import('../src/journal.js');
  const base = '- DOING 占位 ^ad-roundflags';
  const line = (r) => syncSessionEntry(base, { sid: 'r', blockId: 'ad-roundflags', detail: 'brief', granularity: 'round', rounds: [r] }).text.split('\n').find((l) => l.includes('💬'));
  assert.ok(line(fc.rounds.list[0]).includes('结论：本轮被中断，没有结论。'), line(fc.rounds.list[0]));
  assert.ok(line(fc.rounds.list[1]).includes('结论：额度不足，本轮未完成。'), line(fc.rounds.list[1]));
}
{
  // 普通报错仍然记 ERRORED，不要都算成限额
  const live = { state: 'run' };
  const usage = { stale: () => false, touchSess: (fc) => ({ key: fc.sid, day: { prompts: 0 }, s: { text: '', proj: '' } }), liveOf: () => live, noteMeta: () => {}, meta: new Map(), titles: new Map() };
  const fc = { sid: 'session-test-3', cwd: '~', days: new Map(), titles: new Map(), msgs: new Map() };
  const feed = (obj) => ingestDshLine({ usage }, JSON.stringify({ time: obj.time, type: obj.type, data: obj.data, seq: obj.seq }), fc, new Set());
  feed({ type: 'user/message', time: 1000, seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '一件会报错的事' }] } });
  feed({ type: 'turn/end', time: 1100, seq: 2, data: { reason: { kind: 'error', error: { message: 'tool crashed' } } } });
  assert.equal(live.state, 'error');
  assert.equal(fc.rounds.list[0].quota, undefined);
}

// 3) 会话认领：标题被改、块号被清，也能按 ad-turn 注释找回同一条目
{
  const { findSessionTask, findTask, turnMarker } = await import('../src/journal.js');
  const sid = '11111111-2222-3333-4444-555555555555';
  const note = [
    '- DONE 🤖 18:15-18:18 **旧的标题 A**',
    `\t- 💬 第2轮：任务：问题；结论：旧结论 ${turnMarker(sid, 2)}`,
    '\t- ⏱ 18:15–18:18 · 共 3m',
    '- DOING 别的事',
  ].join('\n');
  const hit = findSessionTask(note, sid);
  assert.ok(hit && hit.body.includes('旧的标题 A'), `hit=${JSON.stringify(hit?.body)}`);
  assert.ok(findTask(note, '全新的标题 B', '', sid)?.body.includes('旧的标题 A'), 'label change still finds the entry');
  assert.equal(findSessionTask(note, '99999999-0000-0000-0000-000000000000'), null);
}
console.log('PASS dsh rounds + session ownership');
