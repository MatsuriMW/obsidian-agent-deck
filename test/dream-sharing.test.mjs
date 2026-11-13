import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DreamSharing, sharedMemory, externalMemoryPath } from '../src/dream-sharing.js';
import { Dreaming, companionInstalled } from '../src/dream.js';
import { DEFAULTS, deepMerge, journalPath, dayKeyToday } from '../src/constants.js';

const memory = '# 长期记忆\n\n手工补充说明\n\n- **偏好**：中文 ^dream-abc\n  - 状态：有效\n  - 来源：[[日记/test]]；原文：用中文\n- **事实**：旧事实 ^dream-def\n  - 状态：已被替代\n  - 来源：旧出处\n- **事实**：拒绝的事实 ^dream-fed\n  - 状态：已拒绝\n';
const fixture = (cfg = {}) => ({ settings: { dream: { share: { enabled: false, path: '', intervalHours: 24, gitPush: false, ...cfg } } }, saveSettings: async () => {}, notice: () => {} });

test('安装检测包含已禁用插件，不误判其他插件', () => {
  assert.equal(companionInstalled({ plugins: { manifests: { 'telegram-companion': {} } } }), true);
  assert.equal(companionInstalled({ plugins: { getPlugin: () => ({}) } }), true);
  assert.equal(companionInstalled({ plugins: { manifests: {} } }), false);
});
test('共享 Markdown 保留有效记忆、人工内容和来源，移除失效条目', () => {
  const text = sharedMemory(memory);
  assert.ok(text.includes('手工补充说明')); assert.ok(text.includes('中文')); assert.ok(text.includes('[[日记/test]]'));
  assert.ok(!text.includes('旧事实')); assert.ok(!text.includes('旧出处')); assert.ok(!text.includes('拒绝的事实'));
  assert.equal(sharedMemory(memory), text);
  for (const p of ['', 'memory.md', '/tmp/memory.txt']) assert.throws(() => externalMemoryPath(p));
});
test('外部文件原子更新、幂等、定时不依赖 Dream 自动整理，并保留错误可重试', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-share-'));
  try {
    const p = fixture({ enabled: true, path: path.join(dir, 'nested', 'memory.md'), intervalHours: 1 });
    const share = new DreamSharing(p, async () => memory);
    await share.tick();
    const first = await readFile(p.settings.dream.share.path, 'utf8');
    assert.equal(first, sharedMemory(memory)); assert.ok(p.settings.dream.share.lastSuccess);
    const saved = p.settings.dream.share.lastAttempt;
    await share.tick(); assert.equal(p.settings.dream.share.lastAttempt, saved);
    await share.sync(); assert.equal(await readFile(p.settings.dream.share.path, 'utf8'), first);
    p.settings.dream.share.path = 'relative.md';
    await share.sync(); assert.ok(p.settings.dream.share.lastError);
    p.settings.dream.share.path = path.join(dir, 'retry.md');
    await share.sync(); assert.equal(p.settings.dream.share.lastError, '');
    p.settings.dream.share.path = path.join(dir, 'empty.md');
    const empty = new DreamSharing(p, async () => null);
    await empty.sync(); assert.ok(p.settings.dream.share.lastError);
    const cleared = new DreamSharing(p, async () => '');
    await cleared.sync(); assert.equal(await readFile(p.settings.dream.share.path, 'utf8'), sharedMemory(''));
    assert.equal(p.settings.dream.share.lastError, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Git 只提交共享文件，推送本地模拟远端，不夹带其他暂存修改；未变化时仍重试推送', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-git-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const repo = path.join(dir, 'repo'), remote = path.join(dir, 'remote.git');
    await mkdir(repo); git(repo, 'init', '-b', 'main'); git(dir, 'init', '--bare', remote);
    git(repo, 'config', 'user.email', 'test@example.com'); git(repo, 'config', 'user.name', 'Test');
    git(repo, 'remote', 'add', 'origin', remote);
    await writeFile(path.join(repo, 'other.txt'), 'base'); git(repo, 'add', 'other.txt'); git(repo, 'commit', '-m', 'initial');
    await writeFile(path.join(repo, 'other.txt'), 'staged unrelated'); git(repo, 'add', 'other.txt');
    const p = fixture({ enabled: true, gitPush: true, path: path.join(repo, 'memory.md') });
    const share = new DreamSharing(p, async () => memory);
    await share.sync(); assert.equal(p.settings.dream.share.lastError, '');
    assert.equal(git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'memory.md');
    assert.equal(git(repo, 'diff', '--cached', '--name-only'), 'other.txt');
    assert.equal(git(dir, '--git-dir', remote, 'show', 'main:memory.md'), sharedMemory(memory).trim());
    const head = git(repo, 'rev-parse', 'HEAD');
    await share.sync(); assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
    git(repo, 'remote', 'set-url', 'origin', path.join(dir, 'missing.git'));
    await share.sync(); assert.ok(p.settings.dream.share.lastError);
    git(repo, 'remote', 'set-url', 'origin', remote);
    await share.sync(); assert.equal(p.settings.dream.share.lastError, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Dream 显示真实阶段、防止重复运行，完成后自动同步，失败时可再次运行', async () => {
  const settings = deepMerge(DEFAULTS, {}), files = new Map();
  let release, calls = 0, synced = 0;
  const vault = { getAbstractFileByPath: p => files.has(p) ? { path: p } : null, read: async f => files.get(f.path), create: async (p,t) => files.set(p,t), createFolder: async () => {}, process: async (f,fn) => files.set(f.path,fn(files.get(f.path))) };
  const p = { settings, jobs: {}, app: { vault }, saveSettings: async () => {}, notice: () => {} };
  files.set(journalPath(p.app, settings, dayKeyToday(settings)), '- TODO 用中文');
  const dream = new Dreaming(p, async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  dream.sharing.sync = async () => { synced++; };
  settings.dream.share.enabled = true;
  const run = dream.run();
  for (let i = 0; i < 30 && !release; i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(dream.busy, true); assert.equal(dream.progress.phase, 'model'); assert.ok(dream.progress.startedAt);
  await dream.run(); assert.equal(calls, 1);
  release('{"memories":[]}'); await run;
  assert.equal(dream.busy, false); assert.equal(dream.progress.phase, 'done'); assert.equal(synced, 1);
  files.set(journalPath(p.app, settings, dayKeyToday(settings)), '- TODO 新变化');
  dream.model = async () => 'invalid';
  await dream.run(); assert.equal(dream.progress.phase, 'error'); assert.equal(dream.busy, false);
});
test('共享禁止覆盖原记忆（含符号链接），失败不改变源文件', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-source-'));
  try {
    const source = path.join(dir, 'memory.md');
    await writeFile(source, memory);
    const p = fixture({ path: source }); p.vaultPath = dir; p.settings.dream.path = 'memory.md';
    const share = new DreamSharing(p, async () => memory);
    await share.sync(); assert.match(p.settings.dream.share.lastError, /覆盖/);
    assert.equal(await readFile(source, 'utf8'), memory);
    const { symlink } = await import('node:fs/promises');
    const link = path.join(dir, 'alias.md'); await symlink(source, link);
    p.settings.dream.share.path = link;
    await share.sync(); assert.match(p.settings.dream.share.lastError, /覆盖/);
    assert.equal(await readFile(source, 'utf8'), memory);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('并发共享只读写一轮，关闭自动共享时定时器不写文件', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-concurrent-'));
  try {
    const p = fixture({ path: path.join(dir, 'memory.md') });
    let calls = 0, release;
    const share = new DreamSharing(p, async () => { calls++; await new Promise(r => { release = r; }); return memory; });
    await share.tick(); assert.equal(calls, 0);
    const first = share.sync(), second = share.sync();
    for (let i = 0; i < 30 && !release; i++) await new Promise(r => setTimeout(r, 0));
    assert.equal(calls, 1); release(); await Promise.all([first, second]);
    assert.equal(share.busy, false); assert.equal(p.settings.dream.share.lastError, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
