import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runCodex, runJournalModel, detectJournalProviders, resolveJournalProvider, normalizeApiUrl, runOpenAiApi,
  journalProviderChain, resetJournalFailoverState, setJournalApiConsent,
} from '../src/llm.js';

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
    assert.ok(r.args.includes('--strict-mcp-config'));
    assert.equal(r.args[r.args.indexOf('--setting-sources')+1], 'user,project');
    assert.equal(r.args[r.args.indexOf('--model')+1], 'haiku');
  });
  await test('CLI failure and timeout reject instead of returning a false success', async () => {
    await assert.rejects(runCodex('FAIL', {bin}), /test CLI failure/);
    await assert.rejects(runCodex('HANG', {bin, timeout:0.1}), /没回来/);
  });

  await test('agy, qodercli, and codebuddy JSON outputs are parsed cleanly and avoid errors', async () => {
    const cliDir = path.join(dir, 'clis');
    fs.mkdirSync(cliDir, { recursive: true });
    const fakeAgy = path.join(cliDir, 'agy');
    const fakeQoder = path.join(cliDir, 'qodercli');
    const fakeCb = path.join(cliDir, 'codebuddy');
    fs.writeFileSync(fakeAgy, `#!${process.execPath}
      const args = process.argv.slice(2);
      if (args.some(a => a.includes('ERR_AGY'))) console.log(JSON.stringify({status:'ERROR', error:'quota hit'}));
      else console.log(JSON.stringify({status:'SUCCESS', response: JSON.stringify({args})}));
    `);
    fs.writeFileSync(fakeQoder, `#!${process.execPath}
      console.log(JSON.stringify({is_error:false, result: JSON.stringify({args: process.argv.slice(2)})}));
    `);
    fs.writeFileSync(fakeCb, `#!${process.execPath}
      console.log(JSON.stringify([{type:'message', role:'user'}, {type:'result', is_error:false, result: JSON.stringify({args: process.argv.slice(2)})}]));
    `);
    for (const p of [fakeAgy, fakeQoder, fakeCb]) fs.chmodSync(p, 0o755);

    const agyRes = JSON.parse(await runJournalModel('总结内容', { autoLogProvider: 'agy', autoLogPath: fakeAgy, autoLogModel: 'gemini-3.8-flash-low' }));
    assert.ok(agyRes.args.includes('--output-format'));
    assert.ok(agyRes.args.includes('gemini-3.8-flash-low'));
    assert.ok(agyRes.args.some((a) => a.startsWith('--print=') && a.includes('总结内容')));
    await assert.rejects(runJournalModel('ERR_AGY', { autoLogProvider: 'agy', autoLogPath: fakeAgy }), /quota hit/);

    const qRes = JSON.parse(await runJournalModel('整理标题', { autoLogProvider: 'qodercli', autoLogPath: fakeQoder, autoLogModel: 'auto' }));
    assert.ok(qRes.args.includes('--no-session-persistence'));
    assert.equal(qRes.args[qRes.args.indexOf('-m') + 1], 'auto');

    const cbRes = JSON.parse(await runJournalModel('CodeBuddy', { autoLogProvider: 'codebuddy', autoLogPath: fakeCb }));
    assert.ok(cbRes.args.includes('--output-format'));
    assert.ok(cbRes.args.includes('json'));
  });

  await test('automatic API calls ask first, remember the grant and the refusal', async () => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '整理好了' } }] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const apiCfg = {
      autoLogProvider: 'api', autoLogApiConfirm: true, autoLogModel: 'test-model',
      autoLogApiUrl: `http://127.0.0.1:${server.address().port}/v1`, autoLogApiKey: 'k',
    };
    let asked = 0;
    try {
      resetJournalFailoverState();
      setJournalApiConsent(() => { asked += 1; return false; });
      await assert.rejects(runJournalModel('整理', apiCfg, { automatic: true }), /没有授权调用 API/);
      assert.equal(asked, 1);
      await assert.rejects(runJournalModel('整理', apiCfg, { automatic: true }), /没有授权调用 API/);
      assert.equal(asked, 1, 'a refusal is remembered, not re-asked every cycle');

      resetJournalFailoverState();
      setJournalApiConsent(() => { asked += 1; return true; });
      assert.equal(await runJournalModel('整理', apiCfg, { automatic: true }), '整理好了');
      assert.equal(asked, 2);
      assert.equal(await runJournalModel('整理', apiCfg, { automatic: true }), '整理好了');
      assert.equal(asked, 2, 'the grant covers the following 30 minutes');

      resetJournalFailoverState();
      setJournalApiConsent(() => { throw new Error('manual calls must not ask'); });
      assert.equal(await runJournalModel('整理', apiCfg), '整理好了');
    } finally {
      setJournalApiConsent(null);
      resetJournalFailoverState();
      await new Promise((r) => server.close(r));
    }
  });

  await test('a rate-limited source falls over to the configured backup and cools down', async () => {
    const quotaBin = path.join(dir, 'quota-cli');
    fs.writeFileSync(quotaBin, `#!${process.execPath}\nconsole.error('usage limit reached, retry later'); process.exit(1);\n`);
    fs.chmodSync(quotaBin, 0o755);
    resetJournalFailoverState();
    const cfg = {
      autoLogProvider: 'codex', autoLogPath: quotaBin, autoLogFailover: true, autoLogBackupProvider: 'claude',
      delegate: { claude: { path: bin } },
    };
    assert.deepEqual(journalProviderChain(cfg).map((x) => x.id), ['codex', 'claude']);
    const answer = JSON.parse(await runJournalModel('正文', cfg));
    assert.ok(answer.args.includes('--model'), 'the backup Claude CLI answered');
    // 撞限额的那家在冷却期内被跳过，直接用上次成功的备用来源
    assert.deepEqual(journalProviderChain(cfg).map((x) => x.id), ['claude']);
    resetJournalFailoverState();
    await assert.rejects(runJournalModel('正文', { ...cfg, autoLogFailover: false }), /usage limit/);
    resetJournalFailoverState();
  });

  await test('DeepSeek CLI provider runs deepseek-ds and returns plain text', async () => {
    const dsBin = path.join(dir, 'deepseek-ds');
    fs.writeFileSync(dsBin, `#!${process.execPath}\nconsole.log(JSON.stringify({args: process.argv.slice(2)}).slice(0));\n`);
    fs.chmodSync(dsBin, 0o755);
    const out = await runJournalModel('整理一下', { autoLogProvider: 'deepseek', autoLogPath: dsBin, autoLogModel: 'deepseek-chat' });
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.args.slice(0, 6), ['-p', '整理一下', '--output-format', 'text', '--skip-trust', '-m']);
    assert.equal(parsed.args[6], 'deepseek-chat');
    assert.ok(detectJournalProviders({ cfg: { autoLogProvider: 'deepseek' } }).providers.some((p) => p.id === 'deepseek'));
  });

  await test('detectJournalProviders finds installed+signed-in local CLIs and picks default cleanly', () => {
    const fakeHome = path.join(dir, 'scan-home');
    const localBin = path.join(fakeHome, '.local', 'bin');
    fs.mkdirSync(localBin, { recursive: true });
    for (const name of ['claude', 'agy', 'qodercli']) {
      const f = path.join(localBin, name);
      fs.writeFileSync(f, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(f, 0o755);
    }
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.claude', '.credentials.json'), '{}');
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'antigravity'), { recursive: true });
    // qodercli binary present but ~/.qoder absent -> not signed in

    const res = detectJournalProviders({ homeDir: fakeHome, env: { PATH: '' } });
    assert.deepEqual(res.available.map((x) => x.id), ['agy', 'claude']);
    assert.equal(res.recommended, 'agy');
    assert.equal(resolveJournalProvider({ autoLogProvider: 'auto' }, { homeDir: fakeHome, env: { PATH: '' } }), 'agy');
    assert.equal(resolveJournalProvider({ autoLogProvider: 'auto', autoLogPath: '/tmp/custom-polish' }, { homeDir: fakeHome, env: { PATH: '' } }), 'claude');
    assert.equal(resolveJournalProvider({ autoLogProvider: 'auto', autoLogPath: '/tmp/my-codex' }, { homeDir: fakeHome, env: { PATH: '' } }), 'codex');
    assert.equal(resolveJournalProvider({ autoLogProvider: 'api' }, { homeDir: fakeHome, env: { PATH: '' } }), 'api');
    assert.equal(resolveJournalProvider({}, { homeDir: fakeHome, env: { PATH: '' } }), 'claude');
  });

  await test('detectJournalProviders recognizes Claude auth via ANTHROPIC_AUTH_TOKEN env or ~/.claude/settings.json env', () => {
    const fakeHome = path.join(dir, 'claude-settings-auth-home');
    const localBin = path.join(fakeHome, '.local', 'bin');
    fs.mkdirSync(localBin, { recursive: true });
    const claudeBin = path.join(localBin, 'claude');
    fs.writeFileSync(claudeBin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(claudeBin, 0o755);

    const claudeDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'sonnet', env: { ANTHROPIC_BASE_URL: 'https://relay.example.com' } }));

    // Only settings.json without token/API key -> not logged in
    let res = detectJournalProviders({ homeDir: fakeHome, env: { PATH: '' } });
    assert.equal(res.providers.find((x) => x.id === 'claude')?.loggedIn, false);

    // Process env ANTHROPIC_AUTH_TOKEN -> logged in
    res = detectJournalProviders({ homeDir: fakeHome, env: { PATH: '', ANTHROPIC_AUTH_TOKEN: 'tok-env' } });
    assert.equal(res.providers.find((x) => x.id === 'claude')?.available, true);

    // ~/.claude/settings.json env.ANTHROPIC_AUTH_TOKEN -> logged in even with clean process env
    fs.writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok-file', ANTHROPIC_BASE_URL: 'https://relay.example.com' } }));
    res = detectJournalProviders({ homeDir: fakeHome, env: { PATH: '' } });
    assert.equal(res.providers.find((x) => x.id === 'claude')?.available, true);
    assert.equal(res.recommended, 'claude');
    assert.equal(resolveJournalProvider({ autoLogProvider: 'auto' }, { homeDir: fakeHome, env: { PATH: '' } }), 'claude');
  });

  await test('runOpenAiApi normalizes URL, handles auth headers and errors', async () => {
    assert.equal(normalizeApiUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
    assert.equal(normalizeApiUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
    assert.equal(normalizeApiUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');

    let seenReq = null;
    const ok = await runOpenAiApi('请整理', {
      url: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      requestFn: async (u, headers, body) => {
        seenReq = { u, headers, body: JSON.parse(body) };
        return { status: 200, text: JSON.stringify({ choices: [{ message: { content: '整理好了' } }] }) };
      },
    });
    assert.equal(ok, '整理好了');
    assert.equal(seenReq.u, 'https://api.deepseek.com/chat/completions');
    assert.equal(seenReq.headers.Authorization, 'Bearer sk-test');
    assert.equal(seenReq.body.model, 'deepseek-chat');

    await assert.rejects(
      runOpenAiApi('hi', {
        url: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        requestFn: async () => ({ status: 401, text: JSON.stringify({ error: { message: 'Invalid API key' } }) }),
      }),
      /Invalid API key/,
    );
  });
} finally { fs.rmSync(dir, {recursive:true,force:true}); }
