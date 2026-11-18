import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeProjectFolder, sameFolder, projectFolderEntries, projectKey,
  projectNameForFolder, rememberProjectFolder, resolveProjectForTask, resolveDispatchFolder,
  projectCandidatesFromTask, recentProjectFolders, suggestProjectForTask,
} from '../src/project-folders.js';

const home = os.homedir();
assert.equal(normalizeProjectFolder('~/claude/agent-deck/'), path.join(home, 'claude/agent-deck').replace(/\\/g, '/'));
assert.equal(normalizeProjectFolder('~'), '');
assert.equal(normalizeProjectFolder('/'), '');
assert.equal(normalizeProjectFolder(''), '');
assert.equal(normalizeProjectFolder('relative/dir'), '', 'relative paths are not project folders');
assert.equal(normalizeProjectFolder(home), '');

const dirA = normalizeProjectFolder(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-project-a-')));
const dirB = normalizeProjectFolder(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-project-b-')));
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

  // Task-level "Project -> …" beats the note's own path (Agent Deck.md case).
  const conflict = resolveProjectForTask({
    settings: { projectFolders: { 'agent-deck': dirA, 'wuxi-english-prep': dirB } },
    notePath: 'Agent Deck.md',
    contextLines: [],
    blockText: '- wuxi-english-prep -> 测试文本',
  });
  assert.equal(conflict?.name, 'wuxi-english-prep');
  assert.equal(conflict?.source, 'title');

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

  const vault = normalizeProjectFolder(path.join(dirB, 'vault'));
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

  // The note's project outranks the per-agent default cwd.
  const projectOverDefault = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA, other: dirB } }, agentCwd: dirB, vaultPath: vault, ...task });
  assert.equal(projectOverDefault.folder, dirA);
  assert.equal(projectOverDefault.projectName, 'ad-ui-test');
  assert.equal(projectOverDefault.auto?.name, 'ad-ui-test');

  // No project in the note: the agent default is the fallback.
  const defaultCwd = resolveDispatchFolder({ settings: { projectFolders: { other: dirB } }, agentCwd: dirB, vaultPath: vault, notePath: '日记/x.md', blockText: '- TODO x' });
  assert.equal(defaultCwd.folder, dirB);
  assert.equal(defaultCwd.projectName, 'other');
  assert.equal(defaultCwd.auto, null);

  // Turning the project lookup off leaves the agent default in charge.
  const offWithDefault = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA }, autoProjectFolder: false }, agentCwd: dirB, vaultPath: vault, ...task });
  assert.equal(offWithDefault.folder, dirB);

  const off = resolveDispatchFolder({ settings: { projectFolders: { 'ad-ui-test': dirA }, autoProjectFolder: false }, vaultPath: vault, ...task });
  assert.equal(off.folder, vault);
  assert.equal(off.projectName, '');

  const named = resolveDispatchFolder({ settings: {}, explicitCwd: dirA, explicitName: '自定义名' });
  assert.equal(named.projectName, '自定义名');


  const meta = new Map([
    ['s1', { cwd: dirA, lastAt: 2 }],
    ['s2', { cwd: dirB, lastAt: 1 }],
    ['s3', { cwd: '/tmp/a', lastAt: 9 }],
    ['s4', { cwd: os.homedir(), lastAt: 9 }],
  ]);
  const recent = recentProjectFolders(meta);
  assert.equal(recent.length, 2, 'scratch and home folders are not project suggestions');
  assert.deepEqual(recent.map((r) => r.path), [dirA, dirB], 'newest first');

  assert.deepEqual(projectCandidatesFromTask({ notePath: '日记/x.md', contextLines: ['- [[agent-deck]]'], blockText: '- TODO x' }), ['agent-deck', 'x', '日记']);
  assert.ok(projectCandidatesFromTask({ notePath: 'Projects/agent-deck/task.md', blockText: '- agent-deck -> x' }).includes('agent-deck'));

  const suggestion = suggestProjectForTask({
    settings: {},
    recent: [{ name: 'agent-deck', path: dirA, lastAt: 1 }],
    notePath: '日记/x.md',
    contextLines: ['- [[agent-deck]]'],
    blockText: '- TODO x',
  });
  assert.deepEqual([suggestion?.name, suggestion?.path, suggestion?.candidate], ['agent-deck', dirA, 'agent-deck']);
  assert.equal(suggestProjectForTask({
    settings: { projectFolders: { 'agent-deck': dirA } },
    recent: [{ name: 'agent-deck', path: dirA, lastAt: 1 }],
    notePath: '日记/x.md',
    contextLines: ['- [[agent-deck]]'],
    blockText: '- TODO x',
  }), null, 'already registered projects are not suggested');
  assert.equal(suggestProjectForTask({
    settings: {},
    recent: [{ name: 'agent-deck', path: dirA, lastAt: 1 }],
    notePath: '日记/x.md',
    contextLines: [],
    blockText: '- TODO 一个和项目无关的任务',
  }), null, 'no project signal, no suggestion');

  console.log('PASS project folders: normalize, register, rename, link/path/title resolution, dispatch folder precedence');
} finally {
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
}
