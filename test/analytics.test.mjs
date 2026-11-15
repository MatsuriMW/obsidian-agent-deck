import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateDashboard, journalSources, calendarDays, heatLevel, resolveProjects } from '../src/analytics.js';

const pages = [{ path: '项目/Agent Deck.md', name: 'Agent Deck', aliases: ['智能体甲板'] }, { path: '写作.md', name: '写作' }];
const row = (sid, day, segs, out = 10) => ({ sid, day, agent: 'codex', title: 'Agent Deck 开发', out, fresh: 20, cached: 30, segs });

test('跨日按原始日桶记 token；同项目、全局分别合并重叠时段', () => {
  const rows = resolveProjects([row('a', '2026-11-14', [[0, 30]]), row('b', '2026-11-14', [[15, 45]]), row('a', '2026-11-15', [[0, 10]], 40)], pages);
  const data = aggregateDashboard(rows, '2026-11-14', '2026-11-15');
  assert.equal(data.tokens, 210);
  assert.equal(data.wall, 55);
  assert.equal(data.sessions, 2);
  assert.equal(data.projects[0].wall, 55);
  assert.equal(data.days['2026-11-14'].tokens, 120);
  assert.equal(data.days['2026-11-15'].tokens, 90);
  assert.equal(aggregateDashboard(rows, '2026-11-15', '2026-11-15').tokens, 90);
});

test('重复会话日桶只计一次，未知 token 不估算；缺少时段保留标记', () => {
  const a = row('a', '2026-11-14', [[0, 10]]);
  const data = aggregateDashboard(resolveProjects([a, a, { sid: 'b', day: a.day, agent: 'qoder', min: 20 }], pages), a.day, a.day);
  assert.equal(data.tokens, 60);
  assert.equal(data.sessions, 2);
  assert.equal(data.missingTokens, 1);
  assert.equal(data.missingSpans, 1);
  assert.equal(data.wall, 10);
});

test('页面链接优先；别名、目录和反复出现的正文关键词可匹配，短英文不误撞', () => {
  const rows = resolveProjects([
    { sid: 'a', title: '写作', sources: [{ text: '[[Agent Deck]]', links: ['项目/Agent Deck.md'] }] },
    { sid: 'b', title: '智能体甲板调整' },
    { sid: 'c', cwd: '/repo/agent-deck' },
    { sid: 'd', title: '任务', sources: [{ text: '准备 Agent Deck 的功能' }] },
    { sid: 'e', title: '任务', sources: [{ text: '完善 Agent Deck 的功能' }] },
    { sid: 'f', title: 'started working' },
  ], [...pages, { path: 'art.md', name: 'art' }]);
  assert.deepEqual(rows.slice(0, 5).map(r => r.project), Array(5).fill('项目/Agent Deck.md'));
  assert.equal(rows[5].project, '');
});

test('同名页面及同强度冲突不强行归类，手动更正与恢复自动', () => {
  const twins = [{ path: 'a/Agent Deck.md', name: 'Agent Deck' }, { path: 'b/Agent Deck.md', name: 'Agent Deck' }];
  assert.equal(resolveProjects([{ sid: 'a', title: 'Agent Deck' }], twins)[0].project, '');
  assert.equal(resolveProjects([{ sid: 'a', title: 'Agent Deck' }], twins, { a: 'b/Agent Deck.md' })[0].project, 'b/Agent Deck.md');
  assert.equal(resolveProjects([{ sid: 'a', title: 'Agent Deck' }], pages, { a: '' })[0].project, '');
  assert.equal(resolveProjects([{ sid: 'a', title: 'Agent Deck' }], pages)[0].project, pages[0].path);
  assert.equal(resolveProjects([{ sid: 'a' }], pages, { a: 'deleted.md' })[0].project, '');
});

test('中英文相邻的项目名可识别；数字目录和任务前缀不冒充项目', () => {
  const result = resolveProjects([{ sid: 'a', title: '回复agent deck英文版PR' }, { sid: 'b', title: '- TODO 测试文本 （来自 Obsidian：日记）', cwd: '/Codex/2026/task' }], [...pages, { path: 'TODO.md', name: 'TODO' }, { path: '2026.md', name: '2026' }]);
  assert.equal(result[0].project, pages[0].path);
  assert.equal(result[1].project, '');
});

test('日记条目按会话链接与最近母项提取，隔离兄弟项和代码示例，保留父项上下文', () => {
  const text = '- DOING [[Agent Deck]]\n  - DOING 子任务 ^ad-test\n    - 🔗 [Codex](codex://threads/11111111-1111-1111-1111-111111111111)\n    - 💬 修复热力图\n  - DOING [[写作]]\n    - 🔗 [Codex](codex://threads/22222222-2222-2222-2222-222222222222)\n```md\n- DOING 示例\n  - 🔗 [Codex](codex://threads/33333333-3333-3333-3333-333333333333)\n```';
  const sources = journalSources(text, '日记/2026-11-14.md');
  assert.equal(sources.length, 2);
  assert.ok(sources[0].text.includes('[[Agent Deck]]'));
  assert.ok(!sources[0].text.includes('[[写作]]'));
  assert.equal(sources[0].blockId, 'ad-test');
  assert.equal(sources[0].line, 1);
});

test('热力图按本地日历连续生成，零值独立，颜色随 token 单调加深', () => {
  assert.deepEqual(calendarDays('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(heatLevel(0, 100), 0);
  const levels = [1, 10, 25, 50, 100].map(n => heatLevel(n, 100));
  assert.deepEqual(levels, [...levels].sort());
  assert.equal(levels.at(-1), 4);
});
