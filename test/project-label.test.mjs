// Project labels in the day summary: a real project folder keeps its name, a
// machine-generated workspace (Codex per-task folder, DSH default workspace)
// is labelled with the session title so the ranking reads as tasks.

import assert from 'node:assert/strict';
import { AgentUsage, UsageStore, isScratchCwd, SUMMARY_VERSION } from '../src/readers.js';

// --- which directories are machine workspaces -------------------------------
for (const cwd of [
  '/Users/x/Documents/Codex/2026-11-13/zhe',
  '/Users/x/Documents/Codex/2026-11-13/w-s',
  '/Users/x/Documents/Codex/2026-11-13/a',
  '/Users/x/Documents/Codex/2026-11-13/1-5031567a-cc11-4b71-a9ec-8a290ee39dc9',
  '/Users/x/Documents/deepseek-harness/default-workspace',
]) assert.equal(isScratchCwd(cwd), true, cwd);

for (const cwd of [
  '/Users/x/claude/agent-deck',
  '/Users/x/claude/nautilus-spiral',
  '/Users/x/Library/Mobile Documents/iCloud~md~obsidian/Documents/马自立',
  '',
  // Short names are only treated as machine slugs when they look like one:
  // a real project called "api", "web", "app", "ui" or "go" keeps its name.
  '/Users/x/work/api',
  '/Users/x/work/web',
  '/Users/x/work/app',
  '/Users/x/work/ui',
  '/Users/x/work/go',
  '/Users/x/work/AI',
]) assert.equal(isScratchCwd(cwd), false, cwd);

// --- the summary groups scratch sessions under their title -------------------
const KEY = '2026-11-13';
const day = (sessions) => ({
  sess: new Map(sessions.map(([sid, cwd, ts]) => [sid, { proj: cwd.split('/').pop(), cwd, app: 'codex', agent: 'codex', ts, text: '' }])),
  prompts: 1,
});

function usage(sessions, titles) {
  const u = new AgentUsage({ settings: { agents: {}, primaryAgents: [] } });
  u.files.set('/logs/one.jsonl', {
    path: '/logs/one.jsonl', agent: 'codex', size: 1, offset: 1, mtime: 1,
    days: new Map([[KEY, day(sessions)]]), msgs: new Map(), titles: new Map(), live: null,
  });
  for (const [sid, title] of Object.entries(titles)) u.meta.set(sid, { sid, agent: 'codex', title });
  return u;
}

{
  const u = usage(
    [
      ['a', '/Users/x/Documents/Codex/2026-11-13/zhe', [600, 601, 602, 603, 604]],
      ['b', '/Users/x/claude/agent-deck', [600, 601, 602]],
    ],
    { a: '增强长期记忆共享' },
  );
  const summary = u.summary(KEY);
  assert.deepEqual(Object.keys(summary.proj).sort(), ['agent-deck', '增强长期记忆共享'].sort());
  assert.equal(summary.proj['增强长期记忆共享'].min, 4, 'scratch session keeps its minutes under the title');
  assert.equal(summary.proj['agent-deck'].min, 2, 'a real project folder keeps its name');
}

// A scratch session without a title falls back to the folder name.
{
  const u = usage([['c', '/Users/x/Documents/Codex/2026-11-13/dui', [600, 601]]], {});
  assert.deepEqual(Object.keys(u.summary(KEY).proj), ['dui']);
}

// A stored day keeps the labels it was written with until something touches it.
// When SUMMARY_VERSION moves, rebuild() must refresh every cached day — that is
// what makes a label change visible without waiting for new log lines.
{
  const u = usage([['a', '/Users/x/Documents/Codex/2026-11-13/zhe', [600, 601, 602]]], { a: '增强长期记忆共享' });
  const store = new UsageStore({}, {});
  store.days[KEY] = { proj: { zhe: { min: 2, out: 0, agents: {} } }, wall: 2, sessions: 1 };
  assert.equal(store.summary, undefined);
  assert.equal(store.rebuild(u), true, 'old labels are replaced');
  assert.deepEqual(Object.keys(store.days[KEY].proj), ['增强长期记忆共享']);
  assert.equal(store.summary, SUMMARY_VERSION);
}

console.log('PASS project labels: scratch workspaces use the session title, real folders keep their name');
