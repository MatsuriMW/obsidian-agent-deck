import assert from 'node:assert/strict';
import { archivePath, archiveDate, mergeArchive, archiveCompletedTo } from '../src/journal-archive.js';
import { planJournal } from '../src/organize-journal.js';

// --- path rules -------------------------------------------------------------
assert.equal(archivePath('Custom/done.md'), 'Custom/done.md');
for (const value of ['../x.md', '/tmp/x.md', 'x.txt', 'a//x.md', '']) assert.throws(() => archivePath(value));
assert.equal(archiveDate({ basename: '2026_11_13' }), '2026-11-13');
assert.equal(archiveDate({ basename: '2026-11-13' }), '2026-11-13');
assert.equal(archiveDate({ basename: '随便一个名字' }), '随便一个名字');

// --- merge: order, dedupe, conflict, turn sorting ----------------------------
const block = '- DONE 成果 ^ad-finished\n  - 💬 详细记录';
const first = mergeArchive('', { date: '2026-11-13', blocks: [block], prepend: true });
assert.ok(first.startsWith('# 已完成的 AI 任务\n'), 'a new archive gets a title');
assert.ok(first.includes('## 2026-11-13'));
assert.ok(first.includes(block));

const next = '- DONE 次日 ^ad-next';
const prepended = mergeArchive(first, { date: '2026-11-14', blocks: [next], prepend: true });
assert.ok(prepended.indexOf('2026-11-14') < prepended.indexOf('2026-11-13'), 'prepend puts the newer date on top');
const appended = mergeArchive(first, { date: '2026-11-14', blocks: [next], prepend: false });
assert.ok(appended.indexOf('2026-11-14') > appended.indexOf('2026-11-13'), 'append puts it at the end');
// An existing date keeps its place either way.
assert.equal(mergeArchive(prepended, { date: '2026-11-13', blocks: [block], prepend: true }), prepended);

assert.equal(mergeArchive(first, { date: '2026-11-13', blocks: [block] }), first, 'same block is not duplicated');
assert.throws(() => mergeArchive(first, { date: '2026-11-13', blocks: [block + '改动'] }), /内容不同/);

const turns = new Map([['ad-low', 1], ['ad-high', 20]]);
const sorted = mergeArchive(
  mergeArchive('', { date: '2026-11-13', blocks: ['- DONE 少轮 ^ad-low'], turns }),
  { date: '2026-11-13', blocks: ['- DONE 多轮 ^ad-high'], turns },
);
assert.ok(sorted.indexOf('多轮') < sorted.indexOf('少轮'));

// --- archive flow against a fake vault --------------------------------------
const SOURCE = [
  '- DONE 09:00 手写完成',
  '- DONE 🤖 AI 完成 ^ad-fin',
  '  - 💬 成果',
  '- TODO 手写待办',
].join('\n');

function fixture() {
  const file = { path: '日记/2026_11_13.md', basename: '2026_11_13' };
  const files = new Map([[file.path, { ...file, text: SOURCE }]]);
  const p = {
    settings: { doneArchivePath: 'Custom/done.md', archiveOrder: 'prepend' },
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path),
        createFolder: async (path) => files.set(path, { path }),
        create: async (path, text) => { const created = { path, text }; files.set(path, created); return created; },
      },
    },
    readNote: async (path) => files.get(path).text,
    autoLog: { write: async (f, before, after) => { if (files.get(f.path).text !== before) return false; files.get(f.path).text = after; return true; } },
    saveSettings: async () => {},
  };
  return { p, file, files };
}

{
  const f = fixture();
  const plan = planJournal(f.files.get(f.file.path).text);
  assert.equal(plan.done.filter((e) => e.ai).length, 1, 'only the AI block is archivable');
  const { target, moved } = await archiveCompletedTo(f.p, f.file, f.files.get(f.file.path).text, plan, { path: 'Custom/done.md' });
  assert.equal(moved, 1);
  assert.ok(f.files.get('Custom/done.md').text.includes('- DONE 🤖 AI 完成 ^ad-fin'));
  assert.ok(f.files.get('Custom/done.md').text.startsWith('# 已完成的 AI 任务'), 'first run writes the title');
  const journal = f.files.get(f.file.path).text;
  assert.ok(!journal.includes('AI 完成'), 'archived block left the journal');
  assert.ok(journal.includes('- DONE 09:00 手写完成'), 'hand-written DONE stays');
  assert.ok(journal.includes('- TODO 手写待办'), 'open tasks stay');
  assert.equal(f.p.settings.doneArchivePath, 'Custom/done.md');
  assert.equal(target.path, 'Custom/done.md');
  // Nothing left to archive on a second run.
  const again = planJournal(journal);
  await assert.rejects(() => archiveCompletedTo(f.p, f.file, journal, again, { path: 'Custom/done.md' }), /没有可归档/);
}

{
  // The journal changed under us: the archive copy is kept, the source is not lost.
  const f = fixture();
  const base = f.files.get(f.file.path).text;
  const plan = planJournal(base);
  f.files.get(f.file.path).text = `${base}\n- 后来的编辑\n`;
  await assert.rejects(() => archiveCompletedTo(f.p, f.file, base, plan, { path: 'Custom/done.md' }), /原日记保留/);
  assert.ok(f.files.get('Custom/done.md').text.includes('AI 完成'));
  assert.ok(f.files.get(f.file.path).text.includes('AI 完成'), 'source keeps the block');
  // Retrying with the new base never duplicates the archived block.
  const fresh = f.files.get(f.file.path).text;
  await archiveCompletedTo(f.p, f.file, fresh, planJournal(fresh), { path: 'Custom/done.md' });
  assert.equal((f.files.get('Custom/done.md').text.match(/ad-fin/g) || []).length, 1);
}

{
  const f = fixture();
  f.p.settings.doneArchivePath = f.file.path;
  const plan = planJournal(f.files.get(f.file.path).text);
  await assert.rejects(() => archiveCompletedTo(f.p, f.file, f.files.get(f.file.path).text, plan, { path: f.file.path }), /不能与当前日记相同/);
}

{
  // Nothing is written when the target cannot be created.
  const f = fixture();
  f.p.app.vault.create = async () => { throw new Error('disk failure'); };
  const plan = planJournal(f.files.get(f.file.path).text);
  await assert.rejects(() => archiveCompletedTo(f.p, f.file, f.files.get(f.file.path).text, plan, { path: 'Custom/done.md' }), /disk failure/);
  assert.equal(f.files.get(f.file.path).text, SOURCE);
}

{
  // A dated heading inside a code sample is content: the new section goes
  // around the fence, never into it.
  const fenced = ['# 已完成的 AI 任务', '', '```md', '## 2026-01-01', '- DONE 示例', '```', '', '## 2026-01-01', '', '- DONE 旧任务'].join('\n');
  const out = mergeArchive(fenced, { date: '2026-11-14', blocks: ['- DONE 新任务'], prepend: true });
  assert.ok(out.includes('```md\n## 2026-01-01\n- DONE 示例\n```'), 'sample stays intact');
  assert.ok(out.indexOf('## 2026-11-14') > out.indexOf('```\n'), 'new section is outside the fence');
}

{
  // The user's own H2 closes the dated section: their text stays in place and
  // is never sorted with the task blocks.
  const own = ['# 已完成的 AI 任务', '', '## 2026-01-01', '', '- DONE 旧任务', '', '## 我的笔记', '这是我自己写的说明'].join('\n');
  const out = mergeArchive(own, { date: '2026-01-01', blocks: ['- DONE 新任务'], prepend: true });
  assert.ok(out.includes('## 我的笔记\n这是我自己写的说明'), 'user section survives whole');
  assert.ok(out.indexOf('- DONE 新任务') < out.indexOf('## 我的笔记'), 'blocks stay inside the dated section');
}

{
  // CRLF archives keep their line endings.
  const crlf = '# 已完成的 AI 任务\r\n\r\n## 2026-01-01\r\n\r\n- DONE 旧任务\r\n';
  const out = mergeArchive(crlf, { date: '2026-01-01', blocks: ['- DONE 新任务'], prepend: true });
  assert.equal(/[^\r]\n/.test(out), false, 'no bare LF is introduced');
}

console.log('PASS archive: path rules, prepend/append, dated sections, dedupe, conflict, source preservation and single-copy retries');
