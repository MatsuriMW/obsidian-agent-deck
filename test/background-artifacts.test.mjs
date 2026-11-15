import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanBackgroundText, backgroundQuestion, backgroundRounds } from '../src/background-output.js';

test('export removes plugin IDs, locators, tracking comments and binding rows', () => {
  const sid = '11111111-2222-4333-8444-555555555555';
  const raw = ['# 回答', '- DONE 结果 ^codex-export-cleanup-0123456789', '会话：' + sid, 'blockId: ad-question',
    '<!-- ad-turn:somehash:1 -->', '<!-- agent-deck-conversation sha256:abcdef -->', '<!-- /agent-deck-conversation -->',
    '- 🔗 [Codex](codex://threads/' + sid + ')', '结果保留。'].join('\n');
  const out = cleanBackgroundText(raw, { sessionId: sid, blockId: 'ad-question' });
  assert.ok(out.includes('结果保留。'));
  assert.ok(!/ad-turn|agent-deck|sha256|ad-question|codex-export|11111111|codex:\/\//.test(out), out);
});
test('code examples, business identifiers and readable links remain usable while note locators are removed', () => {
  const code = '```md\n- TODO 示例 ^ad-example\n<!-- ad-turn:example:1 -->\n```';
  const text = '业务编号 12345678901234567890；网址 [文档](https://example.com/docs?q=original)\n- 手写引用 ^my-reference\n' + code;
  assert.equal(cleanBackgroundText(text), text.replace(' ^my-reference', ''));
});
test('full questions are kept instead of the truncated title or source metadata', () => {
  const question = '- TODO ' + '完整提问。'.repeat(1800) + ' ^ad-source\n  - 保留补充条件';
  const result = backgroundQuestion({ name: '短标题', question }, { n: 1 });
  assert.ok(result.startsWith('完整提问。') && result.endsWith('  - 保留补充条件'));
  assert.ok(!result.includes('^ad-source')); assert.ok(result.length > 6000);
});
test('full conversation rounds pair all assistant parts with their question', () => {
  const rounds = backgroundRounds([{ role: 'user', text: '第一问' }, { role: 'assistant', text: '第一部分' },
    { role: 'assistant', text: '第二部分' }, { role: 'user', text: '下一问' }, { role: 'assistant', text: '下一答' }]);
  assert.deepEqual(rounds, [{ n: 1, ask: '第一问', said: '第一部分\n\n第二部分' }, { n: 2, ask: '下一问', said: '下一答' }]);
});
