import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DashboardData } from '../src/dashboard-data.js';

test('加载日记、绑定与归档，缓存不漏编辑器草稿，历史日桶不用会话终身 token', async () => {
  const sid = '11111111-1111-1111-1111-111111111111';
  const note = name => `- DOING ${name}\n  - 🔗 [Codex](codex://threads/${sid})\n  - 💬 完成图表`;
  const journal = { path: '日记/2026-11-14.md', extension: 'md', basename: '2026-11-14', stat: { mtime: 1, size: 100 } };
  const page = { path: '项目/Agent Deck.md', extension: 'md', basename: 'Agent Deck' };
  let reads = 0, draft;
  const p = {
    settings: { journalFolder: '日记', journalFormat: 'YYYY-MM-DD' }, jobs: {},
    store: { days: { '2026_11_14': { list: [{ sid, agent: 'codex', out: 10, fresh: 20, segs: [[0, 10]] }] } } },
    usage: { meta: new Map([[sid, { out: 90000 }]]) },
    autoLog: { viewFor: () => draft === undefined ? null : { editor: { getValue: () => draft } } },
    app: {
      vault: { getAbstractFileByPath: path => path === journal.path ? journal : null, getMarkdownFiles: () => [journal, page], cachedRead: async () => { reads++; return note('[[Agent Deck]]'); } },
      metadataCache: { getFirstLinkpathDest: () => page, getFileCache: () => ({ frontmatter: { aliases: ['智能体甲板'] } }) },
    },
  };
  const loader = new DashboardData(p);
  const first = await loader.load();
  assert.equal(first.rows[0].out, 10);
  assert.equal(first.rows[0].day, '2026-11-14', '内部下划线日期转成日历日期');
  assert.equal(first.rows[0].project, page.path);
  assert.equal(first.rows[0].sources.length, 1);
  assert.equal(first.pages.length, 1, '日记不作为项目候选');
  await loader.load(); assert.equal(reads, 1, '未变化的来源不重读');
  draft = note('手写新草稿');
  const next = await loader.load();
  assert.ok(next.rows[0].sources[0].text.includes('手写新草稿'));
  assert.equal(reads, 1, '优先读未保存的编辑器内容');
  p.settings.dashboardProjects = { [sid]: '' };
  assert.equal((await loader.load()).rows[0].project, '', '更正持久设置优先');
  draft = undefined; journal.stat.mtime++;
  await loader.load(); assert.equal(reads, 2);
  p.store.days['2026-11-13'] = { out: 40, fresh: 50, cached: 60, segs: [[0, 5]] };
  const legacy = (await loader.load()).rows.find(r => r.legacy);
  assert.equal(legacy.out, 40); assert.equal(legacy.cached, 60);
  p.store.days['2026_11_14'].out = 25;
  const remainder = (await loader.load()).rows.find(r => r.residual);
  assert.equal(remainder.out, 15, '旧汇总中没有会话明细的已知用量仍参与统计');
});

test('来源读取失败不伪装为完整数据，其他日记录仍然可用', async () => {
  const p = { settings: { journalFolder: '日记', journalFormat: 'YYYY-MM-DD' }, store: { days: { '2026-11-14': { list: [{ sid: 'a', out: 5 }] } } }, usage: { meta: new Map() }, app: {
    vault: { getAbstractFileByPath: path => ({ path, extension: 'md', stat: { mtime: 1, size: 1 } }), cachedRead: async () => { throw Error('no access'); }, getMarkdownFiles: () => [] }, metadataCache: {} } };
  const data = await new DashboardData(p).load();
  assert.equal(data.unreadable, 1); assert.equal(data.rows.length, 1); assert.equal(data.rows[0].out, 5);
});
