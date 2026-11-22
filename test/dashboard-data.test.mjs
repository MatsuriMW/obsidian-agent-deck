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

  // 单模型按天汇总可直接填充模型名，多模型混用时不强猜
  p.store.days['2026_11_14'].by = { codex: { models: { 'gpt-5-codex': 25 } } };
  assert.equal((await loader.load()).rows.find(r => r.sid === sid).model, 'gpt-5-codex');
  p.store.days['2026_11_14'].by = { codex: { models: { 'gpt-5-codex': 15, 'gpt-4o': 10 } } };
  assert.equal((await loader.load()).rows.find(r => r.sid === sid).model, '');
});

test('来源读取失败不伪装为完整数据，其他日记录仍然可用', async () => {
  const p = { settings: { journalFolder: '日记', journalFormat: 'YYYY-MM-DD' }, store: { days: { '2026-11-14': { list: [{ sid: 'a', out: 5 }] } } }, usage: { meta: new Map() }, app: {
    vault: { getAbstractFileByPath: path => ({ path, extension: 'md', stat: { mtime: 1, size: 1 } }), cachedRead: async () => { throw Error('no access'); }, getMarkdownFiles: () => [] }, metadataCache: {} } };
  const data = await new DashboardData(p).load();
  assert.equal(data.unreadable, 1); assert.equal(data.rows.length, 1); assert.equal(data.rows[0].out, 5);
});

test('T3 Code 转发会话自动去重且不泄漏为历史残余；加载安全审计摘要', async () => {
  const auditFile = { path: 'Agent Deck/安全审计.md', extension: 'md', basename: '安全审计' };
  const auditMd = [
    '---',
    'days: 30',
    'agent: ""',
    'ignore_temp_noise: true',
    'generated_at: "2026-11-22 20:00"',
    'scanned_sessions: 12',
    'tool_calls: 88',
    'findings: 3',
    'suppressed_allowlist: 2',
    'suppressed_noise: 5',
    'allowlist:',
    '  - "cmd:rm -rf dist"',
    '---',
    '# 安全回放与审计报告',
  ].join('\n');
  const p = {
    settings: { journalFolder: '日记', journalFormat: 'YYYY-MM-DD' },
    store: {
      days: {
        '2026-11-22': {
          out: 150,
          fresh: 300,
          cached: 0,
          list: [
            { sid: 'thread:t3:1', agent: 't3code', out: 100, fresh: 200, segs: [[10, 20]] },
            { sid: 'codex-forwarded-1', agent: 'codex', out: 50, fresh: 100, segs: [[10, 20]] },
            { sid: 'hatch-main', agent: 'muse', out: 0, fresh: 0, segs: [[30, 35]] },
          ],
        },
      },
    },
    usage: {
      meta: new Map(),
      t3OwnerOf: (sid) => (sid === 'codex-forwarded-1' ? 'thread:t3:1' : ''),
    },
    app: {
      vault: {
        getAbstractFileByPath: (path) => (path === auditFile.path ? auditFile : null),
        cachedRead: async (file) => (file === auditFile ? auditMd : ''),
        getMarkdownFiles: () => [],
      },
      metadataCache: {},
    },
  };
  const data = await new DashboardData(p).load();
  assert.deepEqual(data.rows.map((r) => `${r.agent}:${r.sid}`), ['t3code:thread:t3:1', 'muse:hatch-main']);
  assert.equal(data.rows.some((r) => r.residual), false, '被 T3 Code 去重的转发会话不应变成历史残余');
  assert.ok(data.securityAudit);
  assert.equal(data.securityAudit.scannedSessions, 12);
  assert.equal(data.securityAudit.totalToolCalls, 88);
  assert.equal(data.securityAudit.totalFindings, 3);
  assert.equal(data.securityAudit.allowlistCount, 1);
});
