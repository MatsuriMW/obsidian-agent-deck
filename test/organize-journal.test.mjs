import assert from 'node:assert/strict';
import { planJournal, renderJournal, DONE_HEADING, ACTIVE_HEADING } from '../src/organize-journal.js';
import { taskLineAt } from '../src/journal.js';

const sid = '11111111-2222-3333-4444-555555555555';
const source = [
  '---', 'journal: 每日', '---',
  '- DONE 09:00 手写完成',
  '- DOING 活动 ^ad-active',
  '  - 💬 回复',
  '  - 手写子项',
  '- TODO 手动任务',
  '- PAUSED 已归档 ^custom',
  `  - 🔗 [Codex](codex://threads/${sid})`,
  '- 手写正文',
  '```md',
  '- DONE 示例 ^ad-code',
  '```',
].join('\n');

const options = { archived: new Set([sid]) };
const plan = planJournal(source, options);

// Every finished block is hoisted, hand-written ones included; an archived
// session counts as finished even when the keyword says otherwise.
assert.equal(plan.done.length, 2);
assert.ok(plan.done.some((e) => e.text.startsWith('- DONE 09:00 手写完成')));
const archived = plan.done.find((e) => e.text.includes('已归档'));
assert.ok(archived.text.startsWith('- DONE'), 'archived task is rewritten as DONE');
assert.equal(archived.ai, true, 'archived task is an AI block');
assert.equal(plan.done.find((e) => e.text.includes('手写完成')).ai, false);

// Only the real AI block is left in the active band.
assert.equal(plan.active.length, 1);
assert.equal(plan.active[0].keyword, 'DOING');
assert.ok(plan.active[0].text.includes('  - 手写子项'));

const out = renderJournal(plan);
assert.ok(out.startsWith('---\njournal: 每日\n---\n\n---\n## 已完成\n- DONE 09:00 手写完成'), 'front matter stays on top, the region opens with its own rule');
assert.ok(out.indexOf(DONE_HEADING) < out.indexOf(ACTIVE_HEADING), 'finished band comes first');
assert.ok(out.includes(`\n---\n${ACTIVE_HEADING}`), 'one rule between the bands');
assert.ok(out.includes('\n---\n\n- TODO 手动任务'), 'second rule before the user notes');
assert.ok(out.includes('```md\n- DONE 示例 ^ad-code\n```'), 'fenced examples are untouched');
assert.ok(out.includes('- 手写正文'));
assert.equal(renderJournal(planJournal(out, options)), out, 'layout is idempotent');

// Legacy generated headings are rebuilt, not duplicated.
const legacy = `${DONE_HEADING}\n\n- DONE 旧 ^ad-old\n\n${ACTIVE_HEADING}\n\n### TODO\n\n- TODO 新的 ^ad-new\n\n## 备注\n\n保留\n`;
const rebuilt = renderJournal(planJournal(legacy));
assert.equal((rebuilt.match(/## 已完成/g) || []).length, 1);
assert.equal((rebuilt.match(/## 进行中/g) || []).length, 1);
assert.ok(!rebuilt.includes('AI · '), 'the old AI · prefix is gone');
assert.ok(rebuilt.includes('## 备注\n\n保留'));

// A rule that opened the note used to survive into the leftover text and stack
// another divider on top of the generated one, so every run added a line.
const stacked = '---\n\n- TODO AI 块 ^ad-s\n\n- TODO 手写\n';
const once = renderJournal(planJournal(stacked));
const twice = renderJournal(planJournal(once));
assert.equal(once, twice, 'a leading rule does not accumulate on repeated runs');
assert.ok(!/\n---\n\n---\n/.test(once), 'the generated rule is not followed by another one');

// Journals written by 1.7.0 carry the old "AI · " headings and are migrated.
const shipped = '## AI · 已完成\n\n- DONE 旧的 ^ad-old\n\n---\n\n## AI · 进行中\n\n- TODO 新的 ^ad-new\n';
const migrated = renderJournal(planJournal(shipped));
assert.ok(!migrated.includes('AI · '), 'legacy headings are rewritten');
assert.ok(migrated.startsWith('---\n## 已完成\n- DONE 旧的 ^ad-old'), 'legacy finished block moves under the new heading, inside the region');

// Grouping order and turn sorting inside the active band.
const unsorted = '- PAUSED 暂停 ^ad-p\n- DOING 一轮 ^ad-one\n- TOREVIEW 待看 ^ad-review\n- DOING 十轮 ^ad-ten\n';
const turns = new Map([['ad-one', 1], ['ad-ten', 10]]);
const sorted = renderJournal(planJournal(unsorted, { turns }));
assert.ok(sorted.indexOf('### DOING') < sorted.indexOf('### TOREVIEW'));
assert.ok(sorted.indexOf('### TOREVIEW') < sorted.indexOf('### PAUSED'));
assert.ok(sorted.indexOf('十轮') < sorted.indexOf('一轮'));

// An AI child nested under a hand-written parent moves; the parent stays.
const nested = '- 手写父项\n  - TODO AI 子项 ^ad-child\n    - 💬 记录\n  - 手写兄弟\n';
const nestedOut = renderJournal(planJournal(nested));
assert.ok(nestedOut.includes('- 手写父项\n  - 手写兄弟'));
assert.ok(nestedOut.includes(`${ACTIVE_HEADING}\n### TODO\n- TODO AI 子项 ^ad-child`));

// A rule the user wrote under their own text is theirs; only the ones this
// function generates are rebuilt.
const ownRule = '- TODO AI 块 ^ad-rule\n- 手写段落\n\n---\n\n- TODO 手写待办\n';
const ownOut = renderJournal(planJournal(ownRule));
assert.ok(ownOut.includes('- 手写段落\n\n---\n\n- TODO 手写待办'), 'a hand-written rule survives');
// Opening rule, closing rule, and the user's own rule in the notes area.
assert.equal((ownOut.match(/^---$/gm) || []).length, 3, 'region rules plus the hand-written one');

// A note with no AI blocks keeps its own text untouched: no heading, no rule.
assert.equal(renderJournal(planJournal('---\nk: v\n---\n\n- 手写\n')), '---\nk: v\n---\n\n- 手写\n');

// A task-looking line inside a fence is a code sample, not something to edit.
assert.equal(taskLineAt(['```md', '- DONE 示例 ^ad-code', '```', '', '- TODO 真任务'], 1), -1, 'fenced code is not a task');
assert.equal(taskLineAt(['```md', '- DONE 示例 ^ad-code', '```', '', '- TODO 真任务'], 4), 4);

// Nothing moves without AI content.
const plain = '- TODO 只有手写\n- DONE 手写的完成\n';
const plainPlan = planJournal(plain);
assert.equal(plainPlan.active.length, 0);
assert.equal(renderJournal(plainPlan), `---\n${DONE_HEADING}\n- DONE 手写的完成\n\n---\n\n- TODO 只有手写\n`);

// The ⌘⇧D command finds the whole block, wherever the cursor sits inside it.
const block = ['- DOING 10:00 干活 ^ad-b', '\t- 💬 记录', '\t\t- 更深'].concat(['- TODO 下一条']);
assert.equal(taskLineAt(block, 0), 0);
assert.equal(taskLineAt(block, 1), 0, 'a child line resolves to its parent task');
assert.equal(taskLineAt(block, 2), 0);
assert.equal(taskLineAt(block, 3), 3);
assert.equal(taskLineAt(['', '- TODO 孤立'], 0), -1, 'a blank line has no block');

// --- the plugin must never eat content it did not write --------------------

{
  // A second run must not delete the user's own "### TODO / ### API" headings
  // that sit below the generated band: only keyword subheads are generated.
  const once = renderJournal(planJournal(source));
  const withNotes = `${once}\n我的笔记：\n\n### TODO\n这里是用户写的\n\n### API\n说明\n`;
  const twice = renderJournal(planJournal(withNotes));
  assert.ok(twice.includes('### TODO\n这里是用户写的'), 'user ### TODO heading survives');
  assert.ok(twice.includes('### API\n说明'), 'user ### API heading survives');
  assert.equal(twice, withNotes, 'second run leaves the note alone');
}

{
  // A code sample that shows the generated headings is content, not a band.
  const sample = '- DONE a\n\n```md\n## 已完成\n- DONE 示例\n\n\n两行空行之后\n```\n\n- 手写正文\n';
  const out = renderJournal(planJournal(sample));
  assert.ok(out.includes('```md\n## 已完成\n- DONE 示例\n\n\n两行空行之后\n```'), 'fenced sample untouched, blank run kept');
  assert.ok(out.startsWith(`---\n${DONE_HEADING}\n- DONE a`), 'the real finished task still moves');
}

{
  // A properties block longer than 80 lines is still front matter.
  const fm = ['---', ...Array.from({ length: 120 }, (_, i) => `k${i}: v${i}`), '---', '', '- TODO 任务', '- 手写'].join('\n');
  const out = renderJournal(planJournal(fm));
  assert.ok(out.startsWith('---\nk0: v0'), 'long front matter stays at the top');
  assert.ok(out.includes('k119: v119\n---'), 'the closing rule is still there');
  assert.equal((out.match(/^---$/gm) || []).length, 2, 'no stray rule is left behind');
}

{
  // CRLF notes keep their line endings.
  const crlf = '- DONE x\r\n- DOING y\r\n- 手写\r\n';
  const out = renderJournal(planJournal(crlf));
  assert.ok(out.includes('\r\n'), 'CRLF preserved');
  assert.equal(/[^\r]\n/.test(out), false, 'no bare LF is introduced');
  assert.equal(renderJournal(planJournal(out)), out, 'CRLF output is stable across runs');
}

{
  // The keyword subheads are generated inside the active band only, and a block
  // that leaves the band leaves its heading behind otherwise.
  const sid = '11111111-2222-3333-4444-555555555555';
  const doc = ['## 已完成', '- DONE a', '', '---', '', '## 进行中', '### DOING', '- DOING b', `  - 🔗 [Codex](codex://threads/${sid})`, '', '我的笔记', ''].join('\n');
  const laid = renderJournal(planJournal(doc));
  assert.ok(laid.includes('### DOING\n- DOING b'), 'the active band gets its subhead');
  const archived = renderJournal(planJournal(laid, { archived: new Set([sid]) }));
  assert.equal(/### DOING/.test(archived), false, 'no stale subhead once the block is archived');
  assert.ok(archived.includes('- DONE b'), 'the block itself moved to the finished band');
  assert.ok(archived.includes('我的笔记'), 'user notes stay');

  // Two bands, two subheads: the second one is still generated and stripped.
  const two = ['## 进行中', '### DOING', '- DOING a', '  - 💬 记录', '### PAUSED', '- PAUSED b', '  - 💬 记录', '', '用户笔记', ''].join('\n');
  const once2 = renderJournal(planJournal(two, { tracked: new Map([['', new Set(['x'])]]), turns: new Map([['', 1]]) }));
  assert.equal(renderJournal(planJournal(once2, { tracked: new Map([['', new Set(['x'])]]), turns: new Map([['', 1]]) })), once2, 'multi-band layout is stable');
}

{
  // The region opens with its own rule, and everything above that rule is the
  // user's: it stays where it is and is never pulled into the generated bands.
  const doc = '# 随笔\n\n先写两句自己的想法\n\n## 已完成\n- DONE 旧的 ^ad-old\n\n---\n\n- TODO 手写\n';
  const out = renderJournal(planJournal(doc));
  assert.ok(out.startsWith('# 随笔\n\n先写两句自己的想法\n\n---\n## 已完成'), 'notes above the region stay above it');
  assert.ok(out.includes('- DONE 旧的 ^ad-old\n\n---\n\n- TODO 手写'), 'the user text below still follows the closing rule');
  assert.equal(renderJournal(planJournal(out)), out, 'stable with notes above the region');
  assert.equal((out.match(/^---$/gm) || []).length, 2, 'one opening rule, one closing rule');
}

{
  // The region already exists: the opening rule is reused, not stacked.
  const framed = '---\n## 进行中\n### DOING\n- DOING a ^ad-a\n\n---\n\n我的笔记\n';
  const out = renderJournal(planJournal(framed));
  assert.equal(out, framed, 'a framed note is left as it is');
  assert.equal(planJournal(framed).insertAt, 5, 'new records go right after the band, inside the region');
}

{
  // `- ---` 是 done-to-top 的分区线，不是我们能删的旧分割线
  const doc = ['- 记一笔', '- ---', '- TODO 手写', '- ---', '- 又一段'].join('\n');
  const out = renderJournal(planJournal(doc));
  assert.equal((out.match(/^- ---$/gm) || []).length, 2, 'list-form separators survive organize');
}

{
  // 框外由本插件写下的记录块被收进区域一次；框外的手写内容不动
  const doc = [
    '- 手写想法',
    '- DOING 03:00 🤖 跑着的活 ^ad-out',
    '\t- 💬 结论',
    '- 另一段手写',
    '',
    '---',
    '## 进行中',
    '### DOING',
    '- DOING 老记录 ^ad-in',
    '',
    '---',
    '',
    '笔记',
  ].join('\n');
  const out = renderJournal(planJournal(doc));
  assert.ok(out.indexOf('## 进行中') < out.indexOf('跑着的活'), 'stray AI block is adopted into the band');
  assert.ok(out.indexOf('手写想法') < out.indexOf('## 进行中'), 'user text above the rule stays above');
  assert.ok(out.indexOf('另一段手写') < out.indexOf('## 进行中'), 'all user text above the rule stays above');
  assert.equal((out.match(/跑着的活/g) || []).length, 1, 'adopted block is not duplicated');
  assert.equal(renderJournal(planJournal(out)), out, 'adoption happens once');
}

{
  // journal-tidy 的分组容器：没有状态关键词、只标 🤖；子块全 DONE 才整块进已完成
  const allDone = ['- 🤖 Agent 记录 · 2 条', '\t- DONE 甲 ^ad-a', '\t- DONE 乙 ^ad-b'].join('\n');
  const plan1 = planJournal(allDone);
  assert.equal(plan1.done.length, 1, 'all-done container counts as finished');
  assert.equal(plan1.active.length, 0);
  assert.ok(plan1.done[0].text.startsWith('- 🤖 Agent 记录 · 2 条'), 'container keeps its children');
  const mixed = ['- 🤖 Agent 记录 · 2 条', '\t- DONE 甲 ^ad-a', '\t- DOING 乙 ^ad-b'].join('\n');
  const plan2 = planJournal(mixed);
  assert.equal(plan2.done.length, 0, 'mixed container is not finished');
  assert.equal(plan2.active.length, 1, 'a container with unfinished records stays active');
  assert.ok(plan2.active[0].text.includes('DONE 甲') && plan2.active[0].text.includes('DOING 乙'), 'container is not split');
}

{
  // 已完成区按对话轮数降序，同轮数保持原文顺序
  const doc = ['## 已完成', '- DONE 甲 ^ad-a', '\t- ❓ 第2轮：问', '- DONE 乙 ^ad-b', '\t- ❓ 第9轮：问', '- DONE 丙 ^ad-c'].join('\n');
  const out = renderJournal(planJournal(doc));
  const order = ['乙', '甲', '丙'].map((n) => out.indexOf(`DONE ${n}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'finished band sorted by turns, ties keep order');
}

console.log('PASS journal layout: finished band on top, rule, grouped AI log, rule, user notes; front matter, fences, nesting and idempotence preserved');
