import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-review-'));
try {
  const build = await esbuild.build({ entryPoints: [path.resolve('src/dashboard.js')], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'obsidian', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class ItemView { constructor(leaf){Object.assign(this,leaf)} register(){} registerEvent(){} } export class FuzzySuggestModal {}' }));
  } }] });
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
  console.log('PASS review lifecycle: hidden view, concurrent refresh, unload, focused date control');
} finally { delete globalThis.document; fs.rmSync(dir, { recursive: true, force: true }); }
