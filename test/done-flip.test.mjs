// ⌘⇧D flips one task line to its finished form. The command itself needs a
// live editor, so the pure part lives in journal.js and is checked here.

import assert from 'node:assert/strict';
import { flipToDone, kwLine, splitTask } from '../src/journal.js';

// Indentation and bullet survive: the old command ran the whole line through a
// "collapse double spaces" pass, which turned "    - " into " - ".
assert.equal(flipToDone('    - TODO x'), '    - DONE x');
assert.equal(flipToDone('\t- TODO x'), '\t- DONE x');
assert.equal(flipToDone('1. TODO x'), '1. DONE x');

// A checkbox task keeps its checkbox and is marked done, without a second
// keyword: "- [x] x", not "- DONE [x] x".
assert.equal(flipToDone('- [ ] TODO x'), '- [x] x');
assert.equal(flipToDone('- [ ] 没有关键词'), '- [x] 没有关键词');

// Timestamps and the body stay where they were.
assert.equal(flipToDone('- DOING 09:00 x'), '- DONE 09:00 x');
assert.equal(flipToDone('- [ ] DOING 09:00 x'), '- [x] 09:00 x');
assert.equal(flipToDone('- DOING 🤖 09:00-09:45 自动记录 ^ad-123456'), '- DONE 🤖 09:00-09:45 自动记录 ^ad-123456');
assert.equal(flipToDone('- DOING 09:00 🤖 旧自动记录 ^ad-123456'), '- DONE 🤖 09:00-09:00 旧自动记录 ^ad-123456');

// Double spaces inside the body are content, not layout.
assert.equal(flipToDone('- TODO a  b'), '- DONE a  b');

// Anything already finished, and anything that is not a task, is left alone.
for (const line of ['- DONE x', '- [x] x', '- CANCELED x', '- FAILED x', '正文', '', '- [x] DONE 完成', '- done x', '- canceled x']) {
  assert.equal(flipToDone(line), null, line);
}

// Lowercase block-start keywords flip cleanly and normalize in kwLine/splitTask,
// while Title Case and prefix-colliding words remain untouched body text.
assert.equal(flipToDone('- todo x'), '- DONE x');
assert.equal(flipToDone('- doing 09:00 x'), '- DONE 09:00 x');
assert.equal(flipToDone('- [ ] todo x'), '- [x] x');
assert.equal(flipToDone('- nowhere to go'), '- DONE nowhere to go');
assert.equal(flipToDone('- Now check logs'), '- DONE Now check logs');

assert.deepEqual(kwLine('- todo 写文档'), { kw: 'TODO', body: '写文档', blockId: '' });
assert.deepEqual(kwLine('- doing 修 bug ^ad-123'), { kw: 'DOING', body: '修 bug', blockId: 'ad-123' });
assert.deepEqual(kwLine('- done 已完成'), { kw: 'DONE', body: '已完成', blockId: '' });
assert.deepEqual(kwLine('- Now we ship'), { kw: '', body: 'Now we ship', blockId: '' });
assert.deepEqual(kwLine('- nowhere to go'), { kw: '', body: 'nowhere to go', blockId: '' });
assert.deepEqual(kwLine('- todolist 事项'), { kw: '', body: 'todolist 事项', blockId: '' });

assert.equal(splitTask('- todo x')?.kw, 'TODO');
assert.equal(splitTask('- doing 09:00 x')?.kw, 'DOING');
assert.equal(splitTask('- Now check logs')?.kw, null);
assert.equal(splitTask('- nowhere to go')?.kw, null);
assert.equal(splitTask('- todolist 事项')?.kw, null);

console.log('PASS done flip: indentation, checkbox, timestamp and body survive, finished lines are untouched');
