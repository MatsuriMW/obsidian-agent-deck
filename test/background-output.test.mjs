import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeMockNodeBin } from './helpers/mock-cli.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='obsidian')return {url:'data:text/javascript,export class MarkdownView{}',shortCircuit:true};return next(spec,ctx);}`));
const J = await import('../src/journal.js');
const { Delegator, isCliSession } = await import('../src/delegation.js');
const { JournalSync } = await import('../src/sync.js');
const { DEFAULTS, deepMerge } = await import('../src/constants.js');
const longReply = '# 原文\n\n' + '中文内容🙂 保留全部空格与代码。\n'.repeat(400) + '\n```js\nconst text = "末尾 END";\n```\n';
function fixture(note) {
  const files = new Map([['journal.md', { path: 'journal.md', text: note }]]);
  const p = { settings: deepMerge(DEFAULTS, {}), jobs: {}, vaultPath: '/tmp', usage: { meta: new Map() },
    app: { vault: { getAbstractFileByPath: path => files.get(path),
      createFolder: async path => { assert.ok(!files.has(path)); await new Promise(r => setTimeout(r, 1)); files.set(path, { path }); },
      create: async (path, text) => { const file = { path, text }; files.set(path, file); return file; },
      read: async file => file.text,
      process: async (file, fn) => { await new Promise(r => setTimeout(r, 1)); file.text = fn(file.text); } } },
    readNote: async path => files.get(path).text,
    writeNote: async (path, next) => { await new Promise(r => setTimeout(r, 2)); files.get(path).text = next; },
    saveJobs() {}, saveSettings() {}, refreshUI() {}, notice() {}, note: () => files.get('journal.md').text, files };
  p.settings.autoLogDetail = 'brief'; p.settings.autoLogGranularity = 'latest';
  return p;
}
test('500 characters stay inline verbatim, 501 characters become a clean full Q&A file', async () => {
  for (const size of [500, 501]) {
    const p = fixture('- DOING 任务 ^ad-length\n');
    const reply = '🙂'.repeat(size);
    const job = { id: 'length', agent: 'claude', name: '任务', question: '- TODO 完整问题 ^ad-question', blockId: 'ad-length',
      path: 'journal.md', sessionId: 'length-session', destination: 'background', state: 'done', result: reply };
    p.jobs.length = job;
    const d = new Delegator(p);
    await d.writeResult(job);
    if (size === 500) {
      assert.ok(p.note().includes(reply));
      assert.equal([...p.files.keys()].filter(path => path.endsWith('.md')).length, 1, 'short answers create no file');
    } else {
      const file = p.files.get(job.backgroundFiles[1].path);
      assert.ok(file.text.includes('## 问题\n\n完整问题'));
      assert.ok(file.text.includes(reply));
      assert.ok(!/agent-deck|ad-question|length-session|sha256|<!--/.test(file.text));
      assert.ok(p.note().includes('[[保留占位'.replace('保留占位', job.backgroundFiles[1].path + '|')));
      assert.ok(!p.note().includes('🙂'));
    }
    const once = p.note(); await d.writeResult(job); assert.equal(p.note(), once);
  }
});
test('short Markdown, code and commands remain complete rather than being summarized', async () => {
  const p = fixture('- DOING 任务 ^ad-code\n');
  const reply = '# 标题\n\n1. 先检查\n2. 再执行\n\n```sh\nprintf "a  b"\n```\n最后核对 12345678901234567890。';
  const job = { id: 'code', agent: 'codex', name: '任务', blockId: 'ad-code', path: 'journal.md', sessionId: 'code-session', destination: 'background', state: 'done', result: reply };
  p.jobs.code = job;
  await new Delegator(p).writeResult(job);
  for (const line of reply.split('\n').filter(Boolean)) assert.ok(p.note().includes(line), line);
  assert.ok(J.hasRecordedTurn(p.note(), job.sessionId, 1));
});
test('simultaneous background results preserve each file, result and binding', async () => {
  const p = fixture('- DOING 任务 ^ad-race\n');
  const d = new Delegator(p);
  const jobs = ['a-session', 'b-session', 'c-session'].map((sid, i) => ({ id: sid, agent: 'dsh', name: '任务', question: '完整问题 ' + i,
    path: 'journal.md', blockId: 'ad-race', sessionId: sid, destination: 'background', startedAt: 1, state: 'done', result: longReply + i, linkWritten: true }));
  Object.assign(p.jobs, Object.fromEntries(jobs.map(job => [job.id, job])));
  await Promise.all([...jobs.map(j => d.writeResult(j)), d.writeLink({ agent: 'dsh', name: '任务', path: 'journal.md', blockId: 'ad-race' }, 'new-session')]);
  for (const [i, job] of jobs.entries()) {
    const path = job.backgroundFiles[1].path;
    assert.ok(p.files.get(path).text.includes(longReply + i));
    assert.ok(p.files.get(path).text.includes('完整问题 ' + i));
    assert.ok(J.hasRecordedTurn(p.note(),job.sessionId,1));
    assert.ok(p.note().includes(`[[${path}|`));
    assert.equal(job.resultWritten, true);
  }
  assert.ok(p.note().includes('new-session')); assert.ok(p.note().length < 1800);
  const before = p.note(); await Promise.all(jobs.map(j => d.writeResult(j))); assert.equal(p.note(), before);
});
test('scans use the same file policy and avoid the polish/merge paths', async () => {
  const sid = 'session-11111111-2222-4333-8444-555555555555';
  const p = fixture('- DOING 任务 ^ad-task\n' + J.linkLine('\t', 'dsh', '任务', sid));
  p.jobs.one = { id: 'one', path: 'journal.md', name: '任务', blockId: 'ad-task', agent: 'dsh', sessionId: sid, destination: 'background', state: 'done' };
  p.usage.meta.set(sid, { agent: 'dsh', state: 'wait', lastText: longReply, rounds: [{ n: 1, ask: '原始问题', said: longReply, summary: '旧摘要' }] });
  const d = new Delegator(p); let pending;
  p.delegator = { writeResult: (...args) => (pending = d.writeResult(...args)) };
  const sync = new JournalSync(p);
  sync.queueRefineTurn = () => assert.fail('no polish calls'); sync.queueMerge = () => assert.fail('no merges');
  sync.results(p.note()); await pending;
  assert.ok(p.note().includes('完整问答')); assert.ok(!p.note().includes('旧摘要'));
  assert.ok(p.files.get(p.jobs.one.backgroundFiles[1].path).text.includes('原始问题'));
});
test('Claude background subprocess drains complete UTF-8 output and automatically saves a full transcript', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-output-'));
  const jsBody = `const bytes=Buffer.from(${JSON.stringify(longReply)});let n=0;function send(){if(n===bytes.length)return;process.stdout.write(bytes.subarray(n,n+101));n=Math.min(n+101,bytes.length);setImmediate(send)}send();`;
  const bin = writeMockNodeBin(dir, 'claude', jsBody);
  const p = fixture('- TODO 原文测试 ^ad-stream\n'); p.vaultPath = dir;
  Object.assign(p.settings.delegate.claude, { path: bin, cwd: dir, autoTrustedCwd: false });
  const d = new Delegator(p);
  try {
    const job = await d.delegate({ agent: 'claude', destination: 'background', file: { path: 'journal.md' }, line: 0 });
    for (let n = 0; n < 300 && !job.resultWritten; n++) await new Promise(r => setTimeout(r, 10));
    assert.equal(job.result, longReply); assert.equal(job.state, 'done'); assert.equal(job.resultWritten, true);
    assert.ok(p.files.get(job.backgroundFiles[1].path).text.includes(longReply)); assert.ok(p.note().length < 1000);
  } finally { for (const runner of d.runners.values()) runner.cancel(); clearTimeout(d._saveT); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('WorkBuddy terminal sessions are recognized separately from desktop sessions', () => {
  assert.equal(isCliSession('workbuddy', 'cli'), true);
  assert.equal(isCliSession('workbuddy', 'workbuddy'), false);
});

test('file failures do not commit a turn and can be retried without losing concurrent notes', async () => {
  const p = fixture('- DOING 任务 ^ad-retry\n');
  const job = { id: 'retry', agent: 'claude', name: '任务', blockId: 'ad-retry', path: 'journal.md', sessionId: 'retry-session', destination: 'background', state: 'done', result: longReply };
  p.jobs.retry = job;
  const create = p.app.vault.create;
  p.app.vault.create = async () => { throw new Error('disk full'); };
  const d = new Delegator(p);
  await assert.rejects(d.writeResult(job), /disk full/);
  assert.ok(!J.hasRecordedTurn(p.note(), job.sessionId, 1)); assert.ok(!job.resultWritten);
  p.files.get('journal.md').text += '\n等待期间用户写的文字';
  p.app.vault.create = create;
  await d.retryBackgroundResults();
  assert.ok(job.resultWritten); assert.ok(p.note().includes('等待期间用户写的文字'));
  assert.ok(p.files.get(job.backgroundFiles[1].path).text.includes(longReply));
});
test('later rounds use their own question and complete answer', async () => {
  const p = fixture('- DOING 任务 ^ad-later\n');
  const job = { id: 'later', agent: 'claude', name: '任务', question: '第一轮问题', blockId: 'ad-later', path: 'journal.md', sessionId: 'later-session', destination: 'background', state: 'done', result: '第一轮短回答' };
  p.jobs.later = job;
  const d = new Delegator(p); await d.writeResult(job);
  const second = '第二轮过程。'.repeat(200) + '最终未完成：生产发布与 Windows 验证';
  await d.writeResult(job, { rounds: [{ n: 1, ask: '第一轮问题', said: job.result }, { n: 2, ask: '第二轮完整问题', said: second }] });
  const body = p.files.get(job.backgroundFiles[2].path).text;
  assert.ok(body.includes('第二轮完整问题') && body.includes(second));
  assert.ok(!body.includes('第一轮短回答')); assert.ok(p.note().includes('第一轮短回答'));
  const file = p.files.get(job.backgroundFiles[2].path); file.text += '\n用户补充';
  // A retry of the same saved result never overwrites the user's file edits.
  await d.writeResult(job, { rounds: [{ n: 2, ask: '第二轮完整问题', said: second }] });
  assert.ok(file.text.endsWith('用户补充'));
});

test('scanned follow-up files recover the full question and answer from conversation messages', async () => {
  const p = fixture('- DOING 任务 ^ad-full\n');
  const question = '完整问题。'.repeat(1800) + '\n最后的条件不能丢';
  const answer = longReply + '完整回答结尾';
  const job = { id: 'full', agent: 'dsh', name: '任务', blockId: 'ad-full', path: 'journal.md', sessionId: 'full-session', destination: 'background', state: 'done',
    conversation: [{ role: 'user', text: '第一问' }, { role: 'assistant', text: '第一答' }, { role: 'user', text: question }, { role: 'assistant', text: answer }] };
  p.jobs.full = job;
  await new Delegator(p).writeResult(job, { rounds: [{ n: 2, ask: question.slice(0,1000), said: answer.slice(0,100) }] });
  const file = p.files.get(job.backgroundFiles[2].path).text;
  assert.ok(file.includes(question) && file.includes(answer), 'file uses full source messages, not truncated scanner previews');
});

test('background follow-up turn writes round 2 conclusion without scannedRounds', async () => {
  const p = fixture('- DELEGATED @antigravity 测试追问 ^ad-follow\n');
  const d = new Delegator(p);
  const job = {
    id: 'follow', agent: 'antigravity', name: '测试追问', blockId: 'ad-follow',
    path: 'journal.md', sessionId: 'follow-session', destination: 'background',
    state: 'done', result: '第1轮答复：请选择方案 A 或 B？',
    conversation: [
      { role: 'user', text: '第1轮提问' },
      { role: 'assistant', text: '第1轮答复：请选择方案 A 或 B？' },
    ],
  };
  p.jobs.follow = job;
  await d.writeResult(job);
  assert.ok(J.hasRecordedTurn(p.note(), job.sessionId, 1));

  // Simulate continueSession Turn 2 completion without scanner metadata or scannedRounds.
  job.resultWritten = false;
  job.result = '采用方案 A：保留严格阈值拒答。';
  job.conversation.push({ role: 'user', text: '我对上一问的回答：选 A' });
  job.conversation.push({ role: 'assistant', text: job.result });
  await d.writeResult(job);

  assert.ok(J.hasRecordedTurn(p.note(), job.sessionId, 2), 'round 2 marker is recorded');
  assert.ok(p.note().includes('💬 第2轮：采用方案 A：保留严格阈值拒答。'), 'round 2 reply is appended to note');
});
