import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='obsidian')return {url:'data:text/javascript,export class MarkdownView{}',shortCircuit:true};return next(spec,ctx);}`));
const J = await import('../src/journal.js');
const { Delegator, isCliSession } = await import('../src/delegation.js');
const { JournalSync } = await import('../src/sync.js');
const { DEFAULTS, deepMerge } = await import('../src/constants.js');
const semantic = '结论：本地修复；改动：修复缓存与并发写入；未完成：尚未发布，Windows 未验证';
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
test('background summary stays short and repeats do not duplicate the record', () => {
  const before = '- DOING 测试 ^ad-raw\n';
  const options = { blockId: 'ad-raw', sid: 'raw-session', rounds: [{ n: 1, said: longReply, journalSummary: semantic }] };
  const output = J.syncSessionEntry(before, options).text;
  assert.ok(output.length < 400);
  assert.equal(J.syncSessionEntry(output, options).text, output);
});
test('simultaneous background results archive complete replies and preserve every journal summary and binding', async () => {
  const p = fixture('- DOING 任务 ^ad-race\n');
  const d = new Delegator(p); d.summarizeBackground = async () => semantic;
  const jobs = ['a-session', 'b-session', 'c-session'].map((sid, i) => ({ id: sid, agent: 'dsh', name: '任务',
    path: 'journal.md', blockId: 'ad-race', sessionId: sid, destination: 'background', startedAt: 1,
    result: longReply + i, linkWritten: true }));
  Object.assign(p.jobs, Object.fromEntries(jobs.map(job => [job.id, job])));
  await Promise.all([...jobs.map(j => d.writeResult(j)), d.writeLink({ agent: 'dsh', name: '任务', path: 'journal.md', blockId: 'ad-race' }, 'new-session')]);
  for (const [i, job] of jobs.entries()) {
    assert.ok(p.files.get(job.archivePath).text.includes(longReply + i), 'unabridged original includes Markdown and ending');
    assert.ok(p.note().includes(`<!-- ad-turn:${job.sessionId}:1 -->`), `kept ${job.sessionId}`);
    assert.ok(p.note().includes(`[[${job.archivePath}|`));
    assert.equal(job.resultWritten, true);
  }
  assert.ok(p.note().includes('new-session')); assert.ok(p.note().length < 1800);
  const before = p.note(); await Promise.all(jobs.map(j => d.writeResult(j))); assert.equal(p.note(), before);
});
test('background scans use the same semantic summary pipeline without saving a prefix', async () => {
  const sid = 'session-11111111-2222-4333-8444-555555555555';
  const p = fixture('- DOING 任务 ^ad-task\n' + J.linkLine('\t', 'dsh', '任务', sid));
  p.jobs.one = { id: 'one', path: 'journal.md', name: '任务', blockId: 'ad-task', agent: 'dsh', sessionId: sid,
    destination: 'background', state: 'done', conversation: [{ role: 'assistant', text: longReply }] };
  p.usage.meta.set(sid, { agent: 'dsh', state: 'wait', lastText: longReply, rounds: [{ n: 1, said: longReply, summary: '旧摘要' }] });
  const d = new Delegator(p); d.summarizeBackground = async () => semantic;
  let pending;
  p.delegator = { writeResult: (...args) => (pending = d.writeResult(...args)) };
  const sync = new JournalSync(p);
  sync.queueRefineTurn = () => assert.fail('the old short-polish path must not run');
  sync.queueMerge = () => assert.fail('background replies must not be merged');
  sync.results(p.note()); await pending;
  assert.ok(p.note().includes(semantic));
  assert.ok(!p.note().includes('旧摘要')); assert.ok(!p.note().includes('中文内容🙂'));
});
test('Claude background subprocess drains complete UTF-8 output and automatically saves a full transcript', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-output-'));
  const bin = path.join(dir, 'claude');
  const script = `#!/usr/bin/env node\nconst bytes=Buffer.from(${JSON.stringify(longReply)});let n=0;function send(){if(n===bytes.length)return;process.stdout.write(bytes.subarray(n,n+101));n=Math.min(n+101,bytes.length);setImmediate(send)}send();`;
  fs.writeFileSync(bin, script); fs.chmodSync(bin, 0o755);
  const p = fixture('- TODO 原文测试 ^ad-stream\n'); p.vaultPath = dir;
  Object.assign(p.settings.delegate.claude, { path: bin, cwd: dir, autoTrustedCwd: false });
  const d = new Delegator(p); d.summarizeBackground = async () => semantic;
  try {
    const job = await d.delegate({ agent: 'claude', destination: 'background', file: { path: 'journal.md' }, line: 0 });
    for (let n = 0; n < 300 && !job.resultWritten; n++) await new Promise(r => setTimeout(r, 10));
    assert.equal(job.result, longReply); assert.equal(job.state, 'done'); assert.equal(job.resultWritten, true);
    assert.ok(p.files.get(job.archivePath).text.includes(longReply)); assert.ok(p.note().length < 1000);
  } finally { for (const runner of d.runners.values()) runner.cancel(); clearTimeout(d._saveT); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('WorkBuddy terminal sessions are recognized separately from desktop sessions', () => {
  assert.equal(isCliSession('workbuddy', 'cli'), true);
  assert.equal(isCliSession('workbuddy', 'workbuddy'), false);
});

test('failed semantic summaries keep the original link, do not commit a turn, and retry successfully', async () => {
  const p = fixture('- DOING 任务 ^ad-retry\n');
  const job = { id: 'retry-job', path: 'journal.md', name: '任务', blockId: 'ad-retry', agent: 'claude', sessionId: 'retry-session',
    destination: 'background', state: 'done', result: longReply, linkWritten: true };
  p.jobs[job.id] = job;
  const d = new Delegator(p); let calls = 0;
  d.summarizeBackground = async () => { calls++; throw new Error('model offline'); };
  await Promise.all([d.writeResult(job), d.writeResult(job)]);
  assert.equal(calls, 1, 'one model call for the same reply');
  assert.ok(p.note().includes('总结暂未生成')); assert.ok(p.note().includes('[[' + job.archivePath + '|'));
  assert.ok(!p.note().includes('ad-turn:retry-session:1'));
  assert.ok(!p.note().includes('中文内容🙂')); assert.ok(!job.resultWritten);
  await d.writeResult(job); assert.equal(calls, 1, 'retry backoff prevents a request each scan');
  job.backgroundSummaries[1].retryAt = 0;
  d.summarizeBackground = async () => { calls++; p.files.get('journal.md').text += '\n用户等待总结期间新写的文字'; return semantic; };
  await d.retryBackgroundSummaries();
  assert.equal(calls, 2); assert.ok(p.note().includes(semantic)); assert.equal(job.resultWritten, true);
  assert.ok(!p.note().includes('总结暂未生成')); assert.ok(p.note().includes('用户等待总结期间新写的文字'));
  assert.ok(p.files.get(job.archivePath).text.includes(longReply));
});

test('a later scanned round retries with its own complete reply rather than the initial job output', async () => {
  const p = fixture('- DOING 任务 ^ad-later\n');
  const sid = 'later-session', first = '第一轮：完成基础改动', second = '第二轮过程。'.repeat(200) + '最终未完成：生产发布与 Windows 验证';
  const job = { id: 'later-job', path: 'journal.md', name: '任务', blockId: 'ad-later', agent: 'claude', sessionId: sid,
    destination: 'background', state: 'done', result: first, linkWritten: true };
  p.jobs[job.id] = job;
  const d = new Delegator(p); d.summarizeBackground = async () => '结论：第一轮结束；改动：基础改动；未完成：原文未说明';
  await d.writeResult(job);
  job.conversation = [{ role: 'assistant', text: first }, { role: 'assistant', text: second }];
  const rounds = [{ n: 1, said: first }, { n: 2, said: second }];
  p.usage.meta.set(sid, { rounds, lastText: second, state: 'wait' });
  d.summarizeBackground = async () => { throw new Error('offline'); };
  await d.writeResult(job, { rounds }); assert.equal(job.resultWritten, false);
  job.backgroundSummaries[2].retryAt = 0;
  d.summarizeBackground = async raw => { assert.equal(raw, second); return '结论：第二轮结束；改动：完成本地修改；未完成：生产发布与 Windows 验证'; };
  await d.retryBackgroundSummaries();
  assert.equal(job.resultWritten, true); assert.ok(p.note().includes('未完成：生产发布与 Windows 验证'));
  assert.ok(p.files.get(job.archivePath).text.includes(second));
});
