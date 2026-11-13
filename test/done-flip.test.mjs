// ⌘⇧D flips one task line to its finished form. The command itself needs a
// live editor, so the pure part lives in journal.js and is checked here.

import assert from 'node:assert/strict';
import { flipToDone } from '../src/journal.js';

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

// Double spaces inside the body are content, not layout.
assert.equal(flipToDone('- TODO a  b'), '- DONE a  b');

// Anything already finished, and anything that is not a task, is left alone.
for (const line of ['- DONE x', '- [x] x', '- CANCELED x', '- FAILED x', '正文', '', '- [x] DONE 完成']) {
  assert.equal(flipToDone(line), null, line);
}

console.log('PASS done flip: indentation, checkbox, timestamp and body survive, finished lines are untouched');
