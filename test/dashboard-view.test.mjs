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

  console.log('PASS review lifecycle, agent icons & project sort controls');
} finally { delete globalThis.document; fs.rmSync(dir, { recursive: true, force: true }); }
