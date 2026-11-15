import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateDashboard, formatDashboardSummaryMarkdown, journalSources, calendarDays, heatLevel, resolveProjects } from '../src/analytics.js';

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

test('AI 自动记录（无 🔗）也能通过 autoLogState 归属到对应日记项目与会话', async () => {
  const { dayFromNotePath } = await import('../src/analytics.js');
  assert.equal(dayFromNotePath('日记/2026_11_15.md'), '2026-11-15');
  const sid = 'auto-1111';
  const note = '- DOING [[Agent Deck]]\n  - DONE 🤖 09:00-09:20 清理构建 ^agy-cleanup-1234567890\n    - 💬 完成构建验证\n';
  const autoState = { [sid]: { key: '🤖 清理构建', blockId: 'agy-cleanup-1234567890', status: 'done' } };
  const sources = journalSources(note, '日记/2026_11_15.md', { autoState });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sid, sid);
  assert.ok(sources[0].text.includes('[[Agent Deck]]'));
  const rows = resolveProjects([{ sid, title: '杂项会话', sources: [{ text: sources[0].text, links: ['项目/Agent Deck.md'] }] }], pages);
  assert.equal(rows[0].project, '项目/Agent Deck.md');
});

test('Agent 分布、缓存占比、日均与峰值日、记录筛选排序及简报导出正确计算', () => {
  const mixed = resolveProjects([
    { sid: 's1', day: '2026-11-14', agent: 'claude', model: 'claude-opus-4-6', title: '重构核心管道', turns: 4, out: 100, fresh: 200, cached: 800, segs: [[10, 40]], sources: [{ path: '日记/2026-11-14.md', line: 1, links: ['项目/Agent Deck.md'], text: '[[Agent Deck]] 修复路由' }] },
    { sid: 's2', day: '2026-11-14', agent: 'codex', model: 'gpt-5-codex', title: '写作润色', turns: 2, out: 50, fresh: 100, cached: 50, segs: [[25, 55]], sources: [] },
    { sid: 's3', day: '2026-11-15', agent: 'claude', model: 'claude-sonnet-4-6', title: '杂项实验', turns: 1, out: 20, fresh: 30, cached: 50, segs: [[60, 70]], sources: [] },
  ], pages);

  const full = aggregateDashboard(mixed, '2026-11-14', '2026-11-15');
  assert.equal(full.agents.length, 2);
  assert.equal(full.agents[0].agent, 'claude');
  assert.equal(full.agents[0].tokens, 1200);
  assert.equal(full.agents[0].wall, 40);
  assert.equal(full.agents[0].sessions, 2);
  assert.equal(full.peakDay.day, '2026-11-14');
  assert.equal(full.peakDay.tokens, 1300);
  assert.equal(full.avgDailyTokens, Math.round(1400 / 2));
  assert.equal(full.journalLinked, 1);
  assert.equal(full.unclassifiedCount, 1);
  assert.ok(Math.abs(full.cacheHitRate - (900 / 1230)) < 1e-9);

  const byAgent = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { agent: 'codex' });
  assert.equal(byAgent.rows.length, 1);
  assert.equal(byAgent.tokens, 200);

  const onlyJournal = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { onlyJournaled: true });
  assert.equal(onlyJournal.rows.map((r) => r.sid).join(','), 's1');

  const onlyUnclassified = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { onlyUnclassified: true });
  assert.equal(onlyUnclassified.rows.map((r) => r.sid).join(','), 's3');

  const byQueryAndSort = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { query: 'sonnet', sortBy: 'tokens' });
  assert.equal(byQueryAndSort.rows.map((r) => r.sid).join(','), 's3');

  const sortedByWall = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { sortBy: 'wall' });
  assert.equal(sortedByWall.rows[0].min, 30);

  const md = formatDashboardSummaryMarkdown(full, { rangeLabel: '2026-11-14 — 2026-11-15' });
  assert.ok(md.includes('claude'));
  assert.ok(md.includes('2026-11-14'));
  assert.ok(md.includes('Agent Deck'));
  assert.ok(md.includes('claude-opus-4-6'));

  // 模型分布与筛选
  assert.equal(full.models.length, 3);
  assert.equal(full.models[0].model, 'claude-opus-4-6');
  assert.equal(full.models[0].tokens, 1100);
  assert.equal(full.models[0].turns, 4);
  assert.equal(full.models[0].tokensPerTurn, 275);
  assert.ok(Math.abs(full.models[0].cacheHitRate - 0.8) < 1e-9);
  const byModel = aggregateDashboard(mixed, '2026-11-14', '2026-11-15', { model: 'gpt-5-codex' });
  assert.equal(byModel.rows.length, 1);
  assert.equal(byModel.tokens, 200);
});

test('24 小时作息、多会话并发检测与跨日界线小时换算精确无误', () => {
  const rows = [
    // 同日同小时交叉（[600, 640] 与 [620, 650]）：0..1440 下为 10:00-11:00，总去重 50m，并行 20m（2 并发）
    { sid: 'a', day: '2026-11-14', agent: 'claude', model: 'm1', out: 10, segs: [[600, 640]] },
    { sid: 'b', day: '2026-11-14', agent: 'codex', model: 'm2', out: 10, segs: [[620, 650]] },
    // 紧邻片段 [650, 660] 不应算并发
    { sid: 'c', day: '2026-11-14', agent: 'dsh', model: 'm3', out: 10, segs: [[650, 660]] },
  ];
  const r = aggregateDashboard(rows, '2026-11-14', '2026-11-14');
  assert.equal(r.hours[10].minutes, 60);
  assert.equal(r.hours[10].concurrentMinutes, 20);
  assert.equal(r.hours[10].maxConcurrent, 2);
  assert.equal(r.peakHour.hour, 10);
  assert.equal(r.concurrentMinutes, 20);
  assert.equal(r.maxConcurrent, 2);

  // dayCutoff = 4 时：1190..1210（即 04:00 后 19h50m..20h10m = 23:50..00:10）应分别落入 23 时(10m) 和 00 时(10m)
  const shifted = aggregateDashboard([
    { sid: 'd', day: '2026-11-14', agent: 'claude', model: 'm1', out: 10, segs: [[1190, 1210]] },
  ], '2026-11-14', '2026-11-14', { dayCutoff: 4 });
  assert.equal(shifted.hours[23].minutes, 10);
  assert.equal(shifted.hours[0].minutes, 10);
  assert.equal(shifted.concurrentMinutes, 0);
  assert.equal(shifted.hours[23].range, '23:00–00:00');
  assert.equal(shifted.peakHour.range, '00:00–01:00');
});

test('项目投入排序支持按 Token / 耗时 / 会话数 / 名称与升降序切换，未归类按名称始终置后', () => {
  const rows = [
    { sid: 's1', day: '2026-11-14', agent: 'claude', project: 'a.md', projectName: 'Beta', out: 500, segs: [[0, 10]] },
    { sid: 's2', day: '2026-11-14', agent: 'codex', project: 'b.md', projectName: 'Alpha', out: 100, segs: [[0, 50]] },
    { sid: 's3', day: '2026-11-15', agent: 'codex', project: 'b.md', projectName: 'Alpha', out: 50, segs: [[0, 5]] },
    { sid: 's4', day: '2026-11-14', agent: 'dsh', project: 'c.md', projectName: 'Gamma', out: 300, segs: [[0, 20]] },
    { sid: 's5', day: '2026-11-14', agent: 'dsh', project: 'c.md', projectName: 'Gamma', out: 10, segs: [[10, 15]] },
    { sid: 's6', day: '2026-11-15', agent: 'dsh', project: 'c.md', projectName: 'Gamma', out: 10, segs: [[20, 25]] },
    { sid: 's7', day: '2026-11-14', agent: 'cursor', project: '', projectName: '', out: 50, segs: [[0, 5]] },
  ];
  const byTokDesc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'tokens', projectSortDir: 'desc' });
  assert.deepEqual(byTokDesc.projects.map(p => p.name), ['Beta', 'Gamma', 'Alpha', '']);
  assert.equal(byTokDesc.projectsMaxTokens, 500);

  const byTokAsc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'tokens', projectSortDir: 'asc' });
  assert.deepEqual(byTokAsc.projects.map(p => p.name), ['', 'Alpha', 'Gamma', 'Beta']);
  assert.equal(byTokAsc.projectsMaxTokens, 500);

  const byWallDesc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'wall', projectSortDir: 'desc' });
  assert.deepEqual(byWallDesc.projects.map(p => p.name), ['Alpha', 'Gamma', 'Beta', '']);

  const bySessDesc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'sessions', projectSortDir: 'desc' });
  assert.deepEqual(bySessDesc.projects.map(p => p.name), ['Gamma', 'Alpha', 'Beta', '']);

  const byNameAsc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'name', projectSortDir: 'asc' });
  assert.deepEqual(byNameAsc.projects.map(p => p.name), ['Alpha', 'Beta', 'Gamma', '']);

  const byNameDesc = aggregateDashboard(rows, '2026-11-14', '2026-11-15', { projectSortBy: 'name', projectSortDir: 'desc' });
  assert.deepEqual(byNameDesc.projects.map(p => p.name), ['Gamma', 'Beta', 'Alpha', '']);
});
