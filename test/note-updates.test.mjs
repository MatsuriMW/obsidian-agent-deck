import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateNote } from '../src/note-updates.js';
import * as J from '../src/journal.js';

test('40 concurrent updates preserve every agent record and manual note', async () => {
  let note = '- TODO 手写内容\n';
  const p = { readNote: async () => note, writeNote: async (_path, next) => {
    await new Promise(r => setTimeout(r, 1)); note = next;
  } };
  await Promise.all(Array.from({ length: 40 }, (_, i) => updateNote(p, 'today.md', text => text + `- agent ${i}\n`)));
  assert.equal(note.split('\n').length, 42);
  for (let i = 0; i < 40; i++) assert.equal(note.split('\n').filter(line => line === `- agent ${i}`).length, 1);
  assert.ok(note.startsWith('- TODO 手写内容\n'));
});
test('a failed write releases the queue and different notes do not block each other', async () => {
  let fail = true, release;
  const hold = new Promise(r => { release = r; });
  const notes = new Map([['a.md', 'A'], ['b.md', 'B']]);
  const p = { readNote: async path => notes.get(path), writeNote: async (path, text) => {
    if (path === 'a.md' && fail) { fail = false; throw new Error('disk error'); }
    notes.set(path, text);
  } };
  const first = updateNote(p, 'a.md', text => text + 'bad');
  const second = updateNote(p, 'a.md', text => text + 'good');
  await assert.rejects(first, /disk error/); await second;
  assert.equal(notes.get('a.md'), 'Agood');
  p.readNote = async path => { if (path === 'a.md') await hold; return notes.get(path); };
  const blocked = updateNote(p, 'a.md', text => text + '!');
  await updateNote(p, 'b.md', text => text + '!');
  assert.equal(notes.get('b.md'), 'B!'); release(); await blocked;
});
test('closed notes transform the content inside Vault.process, including intervening changes', async () => {
  let text = 'old';
  const p = { app: { vault: { getAbstractFileByPath: path => ({ path }), process: async (_file, fn) => {
    text = 'external edit\n' + text; text = fn(text);
  } } }, readNote: () => assert.fail('must not read a stale snapshot') };
  await updateNote(p, 'today.md', current => current + '\nAI reply');
  assert.equal(text, 'external edit\nold\nAI reply');
});
test('open notes apply a line transaction from the current editor content', async () => {
  let text = '- 手写\n', writes = 0;
  const view = { editor: { getValue: () => text, transaction({ changes: [change] }) {
    const lines = text.split('\n');
    const offset = pos => lines.slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
    text = text.slice(0, offset(change.from)) + change.text + text.slice(offset(change.to)); writes++;
  } } };
  const p = { viewForPath: () => view };
  await Promise.all(['Claude', 'OpenCode', 'Qoder'].map(agent => updateNote(p, 'today.md', text => text + `- ${agent}\n`)));
  assert.equal(text, '- 手写\n- Claude\n- OpenCode\n- Qoder\n'); assert.equal(writes, 3);
  await updateNote(p, 'today.md', text => text); assert.equal(writes, 3);
});

test('AI waits for IME composition and preserves the newly committed user text', async () => {
  let text = '原有日记';
  const cm = { composing: true };
  const view = { editor: { cm, getValue: () => text, transaction({ changes: [change] }) { text = text.slice(0, change.from.ch) + change.text + text.slice(change.to.ch); } } };
  const p = { viewForPath: () => view };
  const pending = updateNote(p, 'today.md', current => current + ' AI 记录');
  setTimeout(() => { text += ' 用户刚输入的中文'; cm.composing = false; }, 10);
  await pending;
  assert.equal(text, '原有日记 用户刚输入的中文 AI 记录');
});
test('preview mode uses the Vault transaction instead of a hidden editor', async () => {
  let text = '预览内容';
  const p = { viewForPath: () => ({ getMode: () => 'preview', editor: { getValue() { assert.fail('hidden editor is stale'); } } }),
    app: { vault: { getAbstractFileByPath: path => ({ path }), process: async (_file, fn) => { text = fn(text); } } } };
  await updateNote(p, 'today.md', current => current + ' AI 记录');
  assert.equal(text, '预览内容 AI 记录');
});
