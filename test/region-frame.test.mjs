// The AI region is framed by two rules: everything outside them belongs to the
// user and must survive a organize byte for byte — including blank runs that
// look like layout, code samples, and task lines the answer would otherwise
// hoist into the generated bands.

import assert from 'node:assert/strict';
import { planJournal, renderJournal, ensureTopRule } from '../src/organize-journal.js';

const above = [
  '# 我的随笔',
  '',
  '先写两句。',
  '',
  '',
  '这里留了两行空行。',
  '',
  '- TODO 我自己还没做的事',
  '- DONE 我自己已经做完的事',
  '',
  '```md',
  '- DONE 代码示例 ^ad-code',
  '',
  '',
  '```',
  '',
  '### TODO 我的小标题',
  '小标题下面的话。',
].join('\n');

const below = [
  '## 晚上回顾',
  '',
  '',
  '下面也留了两行空行。',
  '',
  '- TODO 明天要做的',
  '- DONE 今天已经做掉的',
  '',
  '```md',
  '## 已完成',
  '- DONE 示例 ^ad-code2',
  '```',
].join('\n');

const framed = [
  above,
  '',
  '---',
  '## 已完成',
  '- DONE 旧的 ^ad-old',
  '',
  '---',
  '## 进行中',
  '### DOING',
  '- DOING 写周报 ^ad-weekly',
  '',
  '---',
  '',
  below,
  '',
].join('\n');

const once = renderJournal(planJournal(framed));

assert.ok(once.startsWith(above), 'notes above the region stay byte for byte');
assert.ok(once.trimEnd().endsWith(below), 'notes below the region stay byte for byte');
assert.ok(once.includes('先写两句。\n\n\n这里留了两行空行。'), 'blank runs above are not squeezed');
assert.ok(once.includes('## 晚上回顾\n\n\n下面也留了两行空行。'), 'blank runs below are not squeezed');
assert.ok(once.includes('### TODO 我的小标题\n小标题下面的话。'), 'a heading above is not taken for a generated subhead');

// Task lines outside the region are the user's: they stay where they are and
// never join the generated bands.
assert.ok(once.includes(above) && once.includes(below), 'task lines outside the region are untouched');
assert.equal((once.match(/我自己还没做的事/g) || []).length, 1, 'a TODO above is not duplicated into a band');
assert.equal((once.match(/今天已经做掉的/g) || []).length, 1, 'a DONE below stays below');
assert.equal((once.match(/代码示例/g) || []).length, 1, 'a fenced example is not hoisted');

// The bands themselves are still rebuilt inside the frame.
assert.ok(once.includes('## 已完成\n- DONE 旧的 ^ad-old'), 'the finished band is regenerated');
assert.ok(once.includes('## 进行中\n### DOING\n- DOING 写周报 ^ad-weekly'), 'the active band is regenerated');

// Three runs in a row change nothing after the first.
const twice = renderJournal(planJournal(once));
const thrice = renderJournal(planJournal(twice));
assert.equal(twice, once, 'second run is a no-op');
assert.equal(thrice, once, 'third run is a no-op');

// A note with a closing rule but no opening one keeps its text too.
const unframed = `${above}\n\n## 已完成\n- DONE 旧的 ^ad-old\n\n## 进行中\n- DOING 写周报 ^ad-weekly\n\n---\n\n${below}\n`;
const migrated = renderJournal(planJournal(unframed));
assert.ok(migrated.includes(above), 'migration keeps the notes above');
assert.ok(migrated.trimEnd().endsWith(below), 'migration keeps the notes below');

// Writers that do not rebuild the layout (auto logging, write-back) call
// ensureTopRule: a missing opening rule is restored, a framed note is left alone.
assert.equal(ensureTopRule(framed), framed, 'a framed note is not touched');
assert.equal(ensureTopRule('## 已完成\n- DONE a\n'), '---\n## 已完成\n- DONE a\n', 'a missing rule is added');
assert.equal(ensureTopRule('只是笔记\n'), '只是笔记\n', 'a note without a band stays as it is');
assert.equal(
  ensureTopRule('---\ndate: 2026-11-14\n---\n\n## 进行中\n- DOING a\n'),
  '---\ndate: 2026-11-14\n---\n\n---\n## 进行中\n- DOING a\n',
  'front matter does not count as the divider',
);
assert.equal(
  ensureTopRule('我的笔记\n## 进行中\n- DOING a\n'),
  '我的笔记\n\n---\n## 进行中\n- DOING a\n',
  'a rule added right after text keeps a blank line',
);
// Running it twice is a no-op.
for (const doc of [framed, '## 已完成\n- DONE a\n', '---\ndate: x\n---\n\n## 进行中\n- DOING a\n']) {
  assert.equal(ensureTopRule(ensureTopRule(doc)), ensureTopRule(doc), 'ensureTopRule is idempotent');
}

console.log('PASS region frame: notes above and below the two rules survive organize untouched');
