import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeProjectFolder, sameFolder, projectFolderEntries, projectKey,
  projectNameForFolder, rememberProjectFolder, resolveProjectForTask, resolveDispatchFolder,
} from '../src/project-folders.js';

const home = os.homedir();
assert.equal(normalizeProjectFolder('~/claude/agent-deck/'), path.join(home, 'claude/agent-deck'));
assert.equal(normalizeProjectFolder('~'), '');
assert.equal(normalizeProjectFolder('/'), '');
assert.equal(normalizeProjectFolder(''), '');
assert.equal(normalizeProjectFolder('relative/dir'), '', 'relative paths are not project folders');
assert.equal(normalizeProjectFolder(home), '');

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-project-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-project-b-'));
try {
  assert.ok(sameFolder(dirA, dirA + '/'));
  assert.ok(sameFolder(dirA, path.join(dirA, '..', path.basename(dirA))));

  const settings = { projectFolders: { 'agent-deck': dirA, '第二大脑': dirB, bad: 'not/absolute' } };
  assert.deepEqual(projectFolderEntries(settings).map((e) => e.name).sort(), ['agent-deck', '第二大脑'].sort());
  assert.equal(projectNameForFolder(settings, dirA), 'agent-deck');
  assert.equal(projectNameForFolder(settings, path.join(dirA, 'src')), '', 'subfolders are not the project root');

  // remember: same folder keeps one name, a new folder adds one
  assert.equal(rememberProjectFolder(settings, 'Agent Deck', dirA), true);
  assert.equal(settings.projectFolders['Agent Deck'], dirA);
  assert.equal(settings.projectFolders['agent-deck'], undefined);
  assert.equal(rememberProjectFolder(settings, 'Agent Deck', dirA), false, 'unchanged mapping reports no write');

  const byLink = resolveProjectForTask({
    settings,
    notePath: '日记/2026-11-17.md',
    contextLines: ['- [[Agent Deck]] 的迭代'],
    blockText: '- TODO 把派发默认目录改成项目目录',
  });
  assert.deepEqual(byLink, { name: 'Agent Deck', path: dirA, source: 'link' });

  const byAlias = resolveProjectForTask({
    settings,
    contextLines: ['- [[agent-deck|项目笔记]]'],
    blockText: '- TODO x',
  });
  assert.equal(byAlias?.name, 'Agent Deck');

  const byPath = resolveProjectForTask({
    settings,
    notePath: 'Projects/agent-deck/任务.md',
    contextLines: [],
    blockText: '- TODO x',
  });
  assert.deepEqual(byPath, { name: 'Agent Deck', path: dirA, source: 'path' });

  const byTitle = resolveProjectForTask({
    settings,
    notePath: '日记/2026-11-17.md',
    contextLines: [],
    blockText: '- DOING agent-deck -> 修复 Codex 无项目',
  });
  assert.equal(byTitle?.name, 'Agent Deck');
  assert.equal(byTitle?.source, 'title');

  assert.equal(resolveProjectForTask({
    settings: { projectFolders: {} },
    notePath: '日记/x.md',
    contextLines: ['- [[Agent Deck]]'],
    blockText: '- TODO x',
  }), null, 'no registry, no folder');

  const byBoldTitle = resolveProjectForTask({
    settings,
    notePath: '日记/2026-11-17.md',
    contextLines: [],
    blockText: '- **agent-deck -> 修复 Codex 无项目**',
  });
  assert.equal(byBoldTitle?.source, 'title');
  assert.equal(byBoldTitle?.name, 'Agent Deck');

  assert.equal(resolveProjectForTask({
    settings: { projectFolders: { 'agent-deck': path.join(dirA, 'missing') } },
    notePath: '日记/x.md',
    contextLines: ['- [[agent-deck]]'],
    blockText: '- TODO x',
  }), null, 'a registered folder that no longer exists is not used');

  assert.equal(projectKey('Agent Deck'), projectKey('agent-deck'));
  assert.ok(projectKey('第二 大脑') === '第二大脑');

  const vault = path.join(dirB, 'vault');
  const task = { notePath: '日记/2026-11-17.md', contextLines: ['- [[ad-ui-test]]'], blockText: '- TODO x' };
  const byNote = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA } }, vaultPath: vault, ...task });
  assert.deepEqual([byNote.folder, byNote.projectName, byNote.auto?.name], [dirA, 'ad-ui-test', 'ad-ui-test']);
  assert.equal(byNote.explicit, '');

  const explicit = resolveDispatchFolder({
    settings: { projectFolders: { 'ad-ui-test': dirA, 'other': dirB } },
    explicitCwd: dirB, vaultPath: vault, ...task,
  });
  assert.equal(explicit.folder, dirB);
  assert.equal(explicit.projectName, 'other');
  assert.equal(explicit.auto, null);

  const agentCwd = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA } }, agentCwd: dirA, vaultPath: vault, ...task });
  assert.equal(agentCwd.folder, dirA);
  assert.equal(agentCwd.projectName, 'ad-ui-test');
  assert.equal(agentCwd.auto, null);

  const off = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA }, autoProjectFolder: false }, vaultPath: vault, ...task });
  assert.equal(off.folder, vault);
  assert.equal(off.projectName, '');

  const named = resolveDispatchFolder({ settings: {}, explicitCwd: dirA, explicitName: '自定义名' });
  assert.equal(named.projectName, '自定义名');

  console.log('PASS project folders: normalize, register, rename, link/path/title resolution, dispatch folder precedence');
} finally {
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
}
