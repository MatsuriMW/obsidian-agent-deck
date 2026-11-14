import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeBackgroundReply } from '../src/background-summary.js';
import * as J from '../src/journal.js';

test('the summarizer reads the entire reply and retains conclusion, changes and unfinished work at its end', async () => {
  const raw = '前面的排查过程。\n'.repeat(1500) + '\n最终结论：只完成本地修复。\n改动：修复缓存与并发写入。\n未完成：尚未发布；Windows 没有验证。';
  const summary = await summarizeBackgroundReply(raw, {}, async (prompt, _cfg, opts) => {
    assert.ok(prompt.includes(raw), 'the model must receive the complete reply');
    assert.equal(opts.polish, true);
    return JSON.stringify({ conclusion: '只完成本地修复', changes: '修复缓存与并发写入', unfinished: '尚未发布；Windows 没有验证' });
  });
  assert.match(summary, /结论：只完成本地修复/);
  assert.match(summary, /改动：修复缓存与并发写入/);
  assert.match(summary, /未完成：尚未发布；Windows 没有验证/);
});
test('missing fields and invalid JSON fail instead of falling back to a prefix excerpt', async () => {
  for (const response of ['总结好了', '{"conclusion":"完成"}', '{"conclusion":"完成","changes":"改动","unfinished":""}']) {
    await assert.rejects(summarizeBackgroundReply('原文末尾：还没发版', {}, async () => response));
  }
  await assert.rejects(summarizeBackgroundReply('原文', {}, async () => { throw new Error('offline'); }), /offline/);
});
test('a prepared semantic summary is never truncated again by journal formatting', () => {
  const journalSummary = '结论：本地修复；改动：' + '修复并验证缓存、绑定与输出归档。'.repeat(20) + '；未完成：尚未发布，Windows 未验证';
  const out = J.syncSessionEntry('- DOING 任务 ^ad-summary\n', { sid: 'summary-session', blockId: 'ad-summary', detail: 'brief',
    rounds: [{ n: 1, said: '原回复的开头', journalSummary }] }).text;
  assert.ok(out.includes(journalSummary));
  assert.ok(!out.includes('原回复的开头'));
});
