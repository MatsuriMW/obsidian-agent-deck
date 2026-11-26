// Project-folder dispatch: the resolved folder must reach the runner, not just the job record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Delegator, ancestorLines, buildWindowsPowerShellLauncher, psSingleQuote } from '../src/delegation.js';
import { parseCodexTrustedDirs } from '../src/delegation-runners.js';
import { DEFAULTS, deepMerge } from '../src/constants.js';
import { writeMockNodeBin } from './helpers/mock-cli.mjs';

const req = createRequire(import.meta.url);
globalThis.require = (s) => s === 'electron' ? { shell: { openExternal() {} } } : req(s);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-project-dispatch-'));
const vault = path.join(root, 'vault');
const project = path.join(root, 'demo-project');
const explicitProject = path.join(root, 'explicit-project');
for (const dir of [vault, project, explicitProject]) fs.mkdirSync(dir, { recursive: true });
const cwdFile = path.join(root, 'ran-in.txt');
const bin = writeMockNodeBin(root, 'claude', `
require('fs').writeFileSync(${JSON.stringify(cwdFile)}, process.cwd());
process.stdout.write('完成');
`);

let note = '- [[demo]]\n\t- TODO 只做这一项\n';
const plugin = {
  settings: deepMerge(DEFAULTS, {}),
  jobs: {},
  vaultPath: vault,
  usage: { meta: new Map() },
  saved: 0,
  saveSettings() { this.saved++; },
  saveJobs() {},
  refreshUI() {},
  notice() {},
  readNote: async () => note,
  writeNote: async (p, text) => { note = text; },
  agentEnabled: () => true,
  modelsFor: () => [],
  defaultModel: () => '',
};
Object.assign(plugin.settings.delegate.claude, { path: bin, cwd: "", autoTrustedCwd: false, openDesktop: false, useBackground: false });
plugin.settings.autoWriteResult = false;
plugin.settings.projectFolders = { demo: project };

const d = new Delegator(plugin);
const lines = () => note.split('\n');
const wait = async (job) => {
  for (let i = 0; i < 400 && ['starting', 'running'].includes(job.state); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(job.state, 'done');
};
const real = (p) => fs.realpathSync(p);
const norm = (p) => String(p || '').replace(/\\/g, '/');
const ranIn = () => fs.realpathSync(fs.readFileSync(cwdFile, 'utf8'));

try {
  // A [[demo]] ancestor link selects the registered folder for an ordinary dispatch.
  const auto = await d.delegate({ file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude', destination: 'background' });
  await wait(auto);
  assert.equal(auto.cwd, norm(project));
  assert.equal(auto.project, 'demo');
  assert.equal(ranIn(), real(project), 'the runner really started in the project folder');
  assert.deepEqual(ancestorLines(lines(), 1), ['- [[demo]]']);
  assert.ok(plugin.settings.noteDispatchSessions?.[auto.sessionId], 'ordinary-note dispatch is marked for autoLog to skip');

  // An explicit folder wins and is remembered under the given project name.
  const explicit = await d.delegate({
    file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude',
    destination: 'background', cwd: explicitProject, projectName: '显式项目', newSession: true,
  });
  await wait(explicit);
  assert.equal(explicit.cwd, norm(explicitProject));
  assert.equal(explicit.project, '显式项目');
  assert.equal(ranIn(), real(explicitProject));
  assert.equal(plugin.settings.projectFolders['显式项目'], norm(explicitProject), 'explicit folder is remembered');
  assert.ok(plugin.saved >= 1);

  // The note's project outranks the per-agent default cwd.
  plugin.settings.delegate.claude.cwd = explicitProject;
  plugin.settings.projectFolders = { demo: project };
  const priority = await d.delegate({ file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude', destination: 'background', newSession: true });
  await wait(priority);
  assert.equal(priority.cwd, norm(project), 'note project wins over delegate.claude.cwd');
  assert.equal(ranIn(), real(project));
  plugin.settings.delegate.claude.cwd = '';

  // Turning the automatic lookup off keeps the vault root.
  plugin.settings.autoProjectFolder = false;
  const off = await d.delegate({ file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude', destination: 'background', newSession: true });
  await wait(off);
  assert.equal(norm(off.cwd), norm(vault));
  assert.equal(ranIn(), real(vault));
  plugin.settings.autoProjectFolder = true;

  // explicitVault: true overrides delegate[agent].cwd and note project links.
  plugin.settings.delegate.claude.cwd = explicitProject;
  const forcedVault = await d.delegate({
    file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude',
    destination: 'background', explicitVault: true, fromDialog: true, newSession: true,
  });
  await wait(forcedVault);
  assert.equal(norm(forcedVault.cwd), norm(vault));
  assert.equal(forcedVault.project, '');
  assert.equal(ranIn(), real(vault), 'explicitVault forces runner to execute inside vaultPath');
  plugin.settings.delegate.claude.cwd = '';

  // Non-existent explicit cwd fails fast with clear error instead of ENOENT from runner.
  await assert.rejects(
    () => d.delegate({
      file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'claude',
      destination: 'background', cwd: path.join(root, 'does-not-exist'), newSession: true,
    }),
    /工作目录不存在/,
  );

  // handoffCli resolves registered project folders and passes Codex -C + --add-dir vault.
  plugin.settings.delegate.codex.path = bin;
  const termCalls = [];
  d.openTerminal = async (cmd, cwd, ...rest) => { termCalls.push({ cmd, cwd, rest }); return 'terminal'; };
  const handoffJob = await d.handoffCli({
    file: { path: 'task.md' }, lines: lines(), line: 1, agent: 'codex', newSession: true,
  });
  assert.equal(handoffJob.cwd, norm(project));
  assert.equal(handoffJob.project, 'demo');
  assert.equal(termCalls.length, 1);
  assert.equal(termCalls[0].cwd, norm(project));
  assert.ok(termCalls[0].cmd.includes(`-C '${norm(project)}'`), 'codex handoffCli sets -C project cwd');
  assert.ok(termCalls[0].cmd.includes(`--add-dir '${norm(vault)}'`), 'codex handoffCli includes --add-dir vaultPath');

  // continueSession recovers gracefully when a job's previous cwd was removed on disk.
  const goneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-gone-'));
  fs.rmSync(goneDir, { recursive: true, force: true });
  const notices = [];
  plugin.notice = (msg) => notices.push(msg);
  const contBin = writeMockNodeBin(root, 'dsh-cont', `
const fs = require('fs');
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
fs.writeFileSync(${JSON.stringify(cwdFile)}, process.cwd());
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send({ id: m.id, result: { agentCapabilities: { sessionCapabilities: { resume: {} } } } });
  if (m.method === 'session/resume' || m.method === 'session/new') return send({ id: m.id, result: { sessionId: m.params.sessionId || 'sid-gone-dir', configOptions: [] } });
  if (m.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 'sid-gone-dir', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '续聊成功' } } } });
    return send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
  if (m.id != null) send({ id: m.id, result: {} });
});
`);
  plugin.settings.delegate.dsh.path = contBin;
  const contJob = await d.continueSession({
    agent: 'dsh', sid: 'sid-gone-dir', cwd: goneDir, path: 'task.md',
  }, '继续执行');
  await wait(contJob);
  assert.equal(contJob.cwd, norm(project), 'continueSession falls back to note project when old cwd disappeared');
  assert.equal(ranIn(), real(project));
  assert.ok(notices.some((m) => /原工作目录不存在/.test(m)), 'notifies user when recovering from missing cwd');

  // Windows PowerShell UTF-8 launcher escaping & Codex TOML trusted-dirs parsing
  assert.equal(psSingleQuote("it's $var %TEMP%"), "'it''s $var %TEMP%'");
  const psScript = buildWindowsPowerShellLauncher({
    bin: 'C:\\Program Files\\nodejs\\codex.cmd',
    preArgs: ['exec', '--model', "o'3"],
    taskFile: 'C:\\Users\\陈\\AppData\\Local\\Temp\\prompt.txt',
    postArgs: ['--full'],
  });
  assert.match(psScript, /\[Console\]::InputEncoding/);
  assert.match(psScript, /\[System\.IO\.File\]::ReadAllText\('C:\\Users\\陈\\AppData\\Local\\Temp\\prompt\.txt'/);
  assert.match(psScript, /& 'C:\\Program Files\\nodejs\\codex\.cmd' 'exec' '--model' 'o''3' \$taskText '--full'/);

  const parsedTrusted = parseCodexTrustedDirs([
    '[projects."C:\\\\work\\\\My Repo"]',
    'trust_level = "trusted"',
    "[projects.'D:\\另一项目']",
    'trust_level = "trusted"',
    '[projects."C:\\\\untrusted"]',
    'trust_level = "untrusted"',
  ].join('\n'));
  assert.deepEqual(parsedTrusted, ['C:\\work\\My Repo', 'D:\\另一项目']);

  console.log('PASS project dispatch: auto link folder, explicit folder + memory, explicitVault, handoffCli, continueSession recovery');
} finally {
  clearTimeout(d._saveT);
  fs.rmSync(root, { recursive: true, force: true });
}
