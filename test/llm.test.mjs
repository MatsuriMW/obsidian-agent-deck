import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodex, runJournalModel } from '../src/llm.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-llm-test-'));
const bin = path.join(dir, 'fake-cli');
fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
 if (input.includes('FAIL')) { console.error('test CLI failure'); process.exit(1); }
 if (input.includes('HANG')) { setTimeout(() => {}, 10000); return; }
 const out = JSON.stringify({args, input});
 if (args[0] === 'exec') fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], out);
 else console.log(JSON.stringify({result: out}));
});
`);
fs.chmodSync(bin, 0o755);
try {
  await test('Codex journaling passes model, effort, isolation flags and stdin without a shell', async () => {
    const r = JSON.parse(await runJournalModel('正文 $(echo nope)', {autoLogProvider:'codex', autoLogPath:bin, autoLogModel:'custom model', autoLogEffort:'low'}));
    assert.equal(r.args[r.args.indexOf('--model')+1], 'custom model');
    for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) assert.ok(r.args.includes(flag));
    assert.ok(r.args.includes('model_reasoning_effort="low"'));
    assert.equal(r.args[r.args.indexOf('--sandbox')+1], 'read-only');
    assert.ok(r.input.includes('$(echo nope)'));
    assert.ok(!fs.existsSync(path.dirname(r.args[r.args.indexOf('--output-last-message')+1])));
  });
  await test('Polish model override and same-model fallback use the selected CLI', async () => {
    const cfg = {autoLogProvider:'codex', delegate:{codex:{path:bin}}, autoLogModel:'small', roundPolishModel:'polish'};
    let r = JSON.parse(await runJournalModel('总结', cfg, {polish:true}));
    assert.equal(r.args[r.args.indexOf('--model')+1], 'polish');
    cfg.roundPolishModel = '';
    r = JSON.parse(await runJournalModel('总结', cfg, {polish:true}));
    assert.equal(r.args[r.args.indexOf('--model')+1], 'small');
  });
  await test('Existing Claude configuration remains supported', async () => {
    const r = JSON.parse(await runJournalModel('总结', {autoLogPath:bin, autoLogModel:'haiku'}));
    assert.ok(r.args.includes('--no-session-persistence'));
    assert.equal(r.args[r.args.indexOf('--model')+1], 'haiku');
  });
  await test('CLI failure and timeout reject instead of returning a false success', async () => {
    await assert.rejects(runCodex('FAIL', {bin}), /test CLI failure/);
    await assert.rejects(runCodex('HANG', {bin, timeout:0.1}), /没回来/);
  });
} finally { fs.rmSync(dir, {recursive:true,force:true}); }
