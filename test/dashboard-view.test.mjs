import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const makeEl = (tag = 'div', opts = {}) => {
  const attrs = new Map(Object.entries(opts.attr || {}));
  const el = {
    tagName: tag.toUpperCase(),
    className: opts.cls || '',
    textContent: opts.text || '',
    value: opts.value ?? '',
    type: opts.type || '',
    title: '',
    src: '',
    alt: '',
    draggable: false,
    dataset: {},
    style: { setProperty() {} },
    ownerDocument: { createElement: (t) => makeEl(t) },
    children: [],
    classList: new Set(String(opts.cls || '').split(/\s+/).filter(Boolean)),
    listeners: new Map(),
    empty() { this.children.length = 0; this.textContent = ''; },
    setText(t) { this.textContent = String(t ?? ''); },
    addClass(c) { for (const k of String(c).split(/\s+/).filter(Boolean)) this.classList.add(k); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k); },
    addEventListener(ev, fn) { this.listeners.set(ev, fn); },
    appendChild(c) { this.children.push(c); return c; },
    contains() { return false; },
    createEl(t, o = {}) { const c = makeEl(t, o); this.children.push(c); return c; },
    createDiv(o = {}) { return this.createEl('div', o); },
    createSpan(o = {}) { return this.createEl('span', o); },
    findAll(pred) {
      const out = [];
      for (const c of this.children) {
        if (pred(c)) out.push(c);
        out.push(...c.findAll(pred));
      }
      return out;
    },
  };
  return el;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-review-'));
try {
  const build = await esbuild.build({
    entryPoints: [path.resolve('src/dashboard.js')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    loader: { '.png': 'dataurl' },
    plugins: [{
      name: 'obsidian',
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export class ItemView { constructor(leaf){Object.assign(this,leaf)} register(){} registerEvent(){} } export class FuzzySuggestModal {} export function setIcon() {}',
        }));
      },
    }],
  });
  const file = path.join(dir, 'view.mjs'); fs.writeFileSync(file, build.outputFiles[0].text);
  const { DashboardView } = await import(pathToFileURL(file));
  globalThis.document = { activeElement: null };
  let visible = false, paints = 0, loads = 0, resolve;
  const view = new DashboardView({ containerEl: { isShown: () => visible }, contentEl: { contains: () => false, setText() {} } }, { settings: {}, views: new Set() });
  view.paint = () => paints++;
  view.loader.load = () => { loads++; return new Promise(r => resolve = r); };
  await view.render(); assert.equal(loads, 0); assert.equal(view._pendingRender, true);
  visible = true;
  const pending = view.render(); await view.render();
  assert.equal(loads, 1, '并发刷新共用一次加载');
  await view.onClose(); resolve({ rows: [] }); await pending;
  assert.equal(paints, 0, '关闭后不重建 DOM');
  const focused = new DashboardView({ containerEl: { isShown: () => true }, contentEl: { contains: () => true } }, { settings: {} });
  document.activeElement = { tagName: 'INPUT' };
  focused.loader.load = () => { throw Error('must not load'); };
  await focused.render(); assert.equal(focused._pendingRender, true, '扫描不打断正在编辑的日期输入');
  let detached=0;
  const disabled=new DashboardView({leaf:{detach(){detached++}},containerEl:{},contentEl:{}},{settings:{experimentalDashboard:false},views:new Set()});
  disabled.loader.load=()=>assert.fail('disabled review must not load history');
  await disabled.onOpen();await disabled.render();assert.equal(detached,1,'restored disabled review tabs close before reading data');

  // Agent 分布使用图标而非文本 dot，且项目排序支持字段与升降序切换
  const uiView = new DashboardView({ containerEl: { isShown: () => true }, contentEl: makeEl() }, { settings: {} });
  let updated = 0;
  uiView.update = () => { updated++; };
  const agentHost = makeEl();
  uiView.agentBreakdown(agentHost, {
    tokens: 1000,
    agents: [{ agent: 'claude', tokens: 1000, share: 1, wall: 20, sessions: 2 }],
  });
  const hasCls = (n, c) => n.classList.has(c) || String(n.className).split(/\s+/).includes(c);
  assert.equal(agentHost.findAll(n => hasCls(n, 'ad-review__agent-icon')).length, 1);
  assert.equal(agentHost.findAll(n => n.tagName === 'IMG' && hasCls(n, 'ad-agentimg')).length, 1);
  assert.equal(agentHost.findAll(n => hasCls(n, 'ad-review__agent-dot')).length, 0);

  const projHost = makeEl();
  uiView.projects(projHost, {
    tokens: 300,
    projectsMaxTokens: 200,
    projects: [
      { path: 'p1.md', name: 'Alpha', tokens: 200, share: 2 / 3, wall: 10, sessions: 1, agents: ['claude', 'codex'] },
      { path: 'p2.md', name: 'Beta', tokens: 100, share: 1 / 3, wall: 30, sessions: 3, agents: ['dsh'] },
    ],
  });
  assert.equal(projHost.findAll(n => n.classList.has('ad-review__agent-badge')).length, 3);
  assert.equal(projHost.findAll(n => n.classList.has('ad-review__th-sort')).length, 4);
  const sortDirBtn = projHost.findAll(n => n.classList.has('ad-review__sortdir'))[0];
  assert.ok(sortDirBtn);
  uiView.setProjectSort('name');
  assert.equal(uiView.projectSortBy, 'name');
  assert.equal(uiView.projectSortDir, 'asc');
  uiView.setProjectSort('name');
  assert.equal(uiView.projectSortDir, 'desc');
  assert.equal(updated, 2);

  // 无 token 的 Agent（如 Muse）不显示误导性的 (0%)
  const noTokHost = makeEl();
  uiView.agentBreakdown(noTokHost, {
    tokens: 1000,
    agents: [
      { agent: 't3code', tokens: 1000, share: 1, wall: 15, sessions: 1 },
      { agent: 'muse', tokens: 0, share: 0, wall: 8, sessions: 2 },
    ],
  });
  const agentMetas = noTokHost.findAll(n => hasCls(n, 'ad-review__agent-meta')).map(n => n.textContent);
  assert.ok(agentMetas[0].includes('(100%)'));
  assert.ok(!agentMetas[1].includes('(0%)'), '无 token 用量的 Agent 不显示 (0%)');

  // 跨会话任务投入：合并多会话 token、去重重叠耗时，并使用真实子任务标题而非父级大纲
  const taskHost = makeEl();
  uiView.multiSessionTasks(taskHost, {
    rows: [
      {
        sid: 's1', agent: 'claude', day: '2026-11-22', tokens: 600, segs: [[0, 10]],
        sources: [
          { path: '日记/2026-11-22.md', blockId: 'ad-t1', line: 2, title: 'DOING 真实子任务', text: '- 父标题\n  - DOING 真实子任务 ^ad-t1' },
          { path: '日记/2026-11-22.md', blockId: 'ad-t1', line: 2, title: 'DOING 真实子任务', text: '- 父标题\n  - DOING 真实子任务 ^ad-t1' },
        ],
      },
      {
        sid: 's2', agent: 't3code', day: '2026-11-22', tokens: 400, segs: [[5, 15]],
        sources: [{ path: '日记/2026-11-22.md', blockId: 'ad-t1', line: 2, title: 'DOING 真实子任务', text: '- 父标题\n  - DOING 真实子任务 ^ad-t1' }],
      },
      {
        sid: 's3', agent: 'codex', day: '2026-11-22', tokens: 200, segs: [[20, 25]],
        sources: [{ path: '日记/2026-11-22.md', blockId: 'ad-single', line: 5, title: '单会话任务', text: '- DOING 单会话任务 ^ad-single' }],
      },
    ],
  });
  const taskBtns = taskHost.findAll(n => hasCls(n, 'ad-review__source'));
  assert.equal(taskBtns.length, 1, '只展示 >=2 会话的任务');
  assert.equal(taskBtns[0].textContent, 'DOING 真实子任务');
  assert.equal(taskHost.findAll(n => hasCls(n, 'ad-review__project-sub')).length, 1);
  assert.equal(taskHost.findAll(n => hasCls(n, 'ad-review__agent-badge')).length, 2);
  const taskCells = taskHost.findAll(n => n.tagName === 'TD').map(n => n.textContent);
  const taskSpans = taskHost.findAll(n => n.tagName === 'SPAN').map(n => n.textContent);
  assert.ok(taskSpans.some(t => t === '1k' || t === '1.0k'), `同会话重复 source 不应重复累加 Token（600 + 400 = 1k），实际：${taskSpans.join(', ')}`);
  assert.ok(taskCells.some(t => t === '15m'), '重叠时段 [0,10] + [5,15] 去重后应为 15m');

  // 安全回放与护栏区块：空态与有报告态均正常渲染
  const secEmptyHost = makeEl();
  uiView.data = { rows: [], securityAudit: null };
  uiView.plugin.settings = { securityAllowlist: ['cmd:ls'] };
  uiView.securityAuditSection(secEmptyHost);
  assert.ok(secEmptyHost.findAll(n => hasCls(n, 'ad-review__note'))[0].textContent.includes('1'));

  const secHost = makeEl();
  uiView.data = {
    rows: [],
    securityAudit: {
      generatedAt: '2026-11-22 20:00',
      days: 30,
      scannedSessions: 12,
      totalToolCalls: 88,
      totalFindings: 3,
      suppressedByAllowlist: 2,
      suppressedNoise: 5,
      allowlistCount: 1,
    },
  };
  uiView.securityAuditSection(secHost);
  const secStrongs = secHost.findAll(n => n.tagName === 'STRONG').map(n => n.textContent);
  assert.deepEqual(secStrongs, ['2026-11-22 20:00', '88', '3', '1']);

  console.log('PASS review lifecycle, agent icons, project sort, multi-session tasks & security audit');
} finally { delete globalThis.document; fs.rmSync(dir, { recursive: true, force: true }); }
