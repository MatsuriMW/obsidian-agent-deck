// Project-folder dispatch: the resolved folder must reach the runner, not just the job record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Delegator, ancestorLines } from '../src/delegation.js';
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
  assert.equal(off.cwd, norm(vault));
  assert.equal(ranIn(), real(vault));

  console.log('PASS project dispatch: auto link folder, explicit folder + memory, off switch');
} finally {
  clearTimeout(d._saveT);
  fs.rmSync(root, { recursive: true, force: true });
}
