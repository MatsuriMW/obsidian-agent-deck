import assert from 'node:assert/strict';
import { planJournal, renderJournal } from '../src/organize-journal.js';
import { builtinJournalLayout, readJournalLayout } from '../src/journal-layout.js';

const options = { layout: builtinJournalLayout('zh') };
const organize = text => renderJournal(planJournal(text, options));
const above = '\n---\ndate: 2026-11-15\n---\n\n个人笔记  \n\n\n- DONE 区外完成 ^ad-outside\n';
const below = '\n\n私人记录  \n- TODO 区外待办\n\n## 已完成\n- DONE 同名标题下也不动 ^ad-outside2\n\n\n';
const body = '---\n## 正在做\n- TODO 待处理 ^ad-todo\n- DOING 正在执行 ^ad-active\n  - 手写子项\n- DONE 已经做完 ^ad-finished\n\n---\n## 还要做\n- TODO 手写待办\n- DOING 手写执行中\n\n---\n## 已完成\n- DONE 原有完成\n\n---';
const first = organize(above + body + below);
assert.deepEqual(readJournalLayout(first).layout.order, ['active', 'todo', 'done']);
assert.ok(first.startsWith(above), 'leading whitespace and outside AI records stay byte for byte');
assert.ok(first.endsWith(below), 'trailing whitespace and same-name headings outside stay byte for byte');
const parsed = readJournalLayout(first);
assert.ok(parsed.sections.active.text.includes('正在执行') && !parsed.sections.active.text.includes('手写执行中'), 'only AI entries move between sections');
assert.ok(parsed.sections.todo.text.includes('待处理') && parsed.sections.todo.text.includes('手写待办') && parsed.sections.todo.text.includes('手写执行中'), 'manual entries stay in their own section untouched');
assert.ok(!parsed.sections.active.text.includes('待处理'));
assert.ok(parsed.sections.done.text.includes('已经做完') && parsed.sections.done.text.includes('原有完成'));
assert.equal((first.slice(above.length, -below.length).match(/^---$/gm) || []).length, 4);
assert.ok(first.includes('<!-- agent-deck:layout:start -->\n\n---') && !first.includes('<!-- agent-deck:layout:start -->\n---'), 'opening marker is separated from --- so Markdown does not parse it as a Setext heading');
assert.equal(organize(first), first, 'repeated organization is a no-op');
assert.ok(first.includes('  - 手写子项'), 'whole task blocks remain intact');

for (const text of ['', '- DONE 未划分的任务 ^ad-keep\n\n个人笔记\n', '---\nk: v\n---\n\n## 进行中\n- DOING 没有结束边界 ^ad-keep\n', '```md\n' + body + '\n```\n']) {
  const result = organize(text);
  assert.ok(result.startsWith(text), 'no bounded region: existing text remains untouched');
  const region = readJournalLayout(result);
  assert.ok(Object.values(region.sections).every(section => !section.text.trim()), 'only empty sections are created');
  assert.equal(organize(result), result);
}
const legacy = above + '---\n## 已完成\n- DONE 旧完成 ^ad-old\n\n---\n## 进行中\n### TODO\n- TODO 旧待办 ^ad-pending\n\n---' + below;
const migrated = organize(legacy);
assert.ok(migrated.startsWith(above) && migrated.endsWith(below), 'legacy bounded sections migrate without touching outside notes');
assert.ok(readJournalLayout(migrated).sections.todo.text.includes('旧待办'));
assert.equal(organize(migrated), migrated);
const crlf = (above + body + below).replace(/\n/g, '\r\n');
const out = organize(crlf);
assert.ok(out.startsWith(above.replace(/\n/g, '\r\n')) && out.endsWith(below.replace(/\n/g, '\r\n')));
assert.equal(/[^\r]\n/.test(out), false);
assert.equal(organize(out), out);
console.log('PASS bounded journal: active/todo/done, exact outside preservation, empty initialization, legacy migration, fences, CRLF and idempotence');
