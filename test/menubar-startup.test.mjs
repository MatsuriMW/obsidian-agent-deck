import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
const built = await esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/menubar.js', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'process.platform': '"darwin"' }, plugins: [{ name: 'helper-source', setup(build) {
    build.onResolve({ filter: /menubar\.swift$|agent-assets\.js$/ }, args => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path.endsWith('.swift') ? 'export default "test Swift source";' : 'export function agentImageBuffer(){return null}' }));
  } }] });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-menubar-test-'));
const mod = path.join(root, 'bridge.mjs'); fs.writeFileSync(mod, built.outputFiles[0].text);
const { MenuBarBridge } = await import(pathToFileURL(mod));
function fixture(settings = {}) {
  const calls = { saved: 0, launched: 0, switched: [] };
  const p = { settings, settingTab: { mbSwitch: { setOn: value => calls.switched.push(value) } }, saveSettings: async () => calls.saved++, notice() {} };
  const bridge = new MenuBarBridge(p);
  bridge.dir = path.join(root, Math.random().toString(36)); bridge.binPath = path.join(bridge.dir, 'helper'); bridge.hashPath = path.join(bridge.dir, 'hash');
  bridge.writeAgentIcons = () => {}; bridge.compile = async () => {}; bridge.launch = () => calls.launched++; bridge.update = () => {};
  bridge.show = () => assert.fail('first compilation must not open the panel');
  return { p, bridge, calls };
}
test('first successful compilation persists enabled state, updates the switch and only launches the icon helper', async () => {
  const f = fixture();
  try {
    await f.bridge.start();
    assert.equal(f.p.settings.showMenuBar, true);
    assert.equal(f.calls.saved, 1);
    assert.equal(f.calls.switched.at(-1), true);
    assert.equal(f.calls.launched, 1);
  } finally { clearInterval(f.bridge.timer); }
});
test('explicitly disabled state and disabling during compilation never get overridden', async () => {
  const off = fixture({ showMenuBar: false }); await off.bridge.start(); assert.equal(off.calls.launched, 0);
  const f = fixture(); let release;
  f.bridge.compile = () => new Promise(resolve => { release = resolve; });
  const pending = f.bridge.start();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  f.p.settings.showMenuBar = false; release(); await pending;
  assert.equal(f.p.settings.showMenuBar, false); assert.equal(f.calls.launched, 0); assert.equal(f.calls.saved, 0);
});

test('MenuBarBridge drains togglePin commands from cmds directory without stealing focus', () => {
  const pins = new Set();
  const f = fixture({ menuBarPinnedSids: [] });
  f.p.setMenuBarSessionPinned = (sid, want) => {
    if (want) pins.add(sid); else pins.delete(sid);
    f.p.settings.menuBarPinnedSids = [...pins];
    return true;
  };
  fs.mkdirSync(f.bridge.cmdDir, { recursive: true });
  fs.writeFileSync(path.join(f.bridge.cmdDir, '001.json'), JSON.stringify({ action: 'togglePin', sid: 'ses-1', pinned: true }));
  assert.equal(f.bridge.drainCommands(), true);
  assert.deepEqual(f.p.settings.menuBarPinnedSids, ['ses-1']);
  assert.equal(fs.readdirSync(f.bridge.cmdDir).length, 0);
});

test('MenuBarBridge drains setNowGroupBy commands and ignores invalid modes', () => {
  const f = fixture({ ui: { nowGroupBy: 'project' } });
  let refreshed = 0;
  f.p.refreshUI = () => { refreshed++; };
  fs.mkdirSync(f.bridge.cmdDir, { recursive: true });
  fs.writeFileSync(path.join(f.bridge.cmdDir, '001.json'), JSON.stringify({ action: 'setNowGroupBy', mode: 'bogus' }));
  assert.equal(f.bridge.drainCommands(), false);
  assert.equal(f.p.settings.ui.nowGroupBy, 'project');

  fs.writeFileSync(path.join(f.bridge.cmdDir, '002.json'), JSON.stringify({ action: 'setNowGroupBy', mode: 'status' }));
  assert.equal(f.bridge.drainCommands(), true);
  assert.equal(f.p.settings.ui.nowGroupBy, 'status');
  assert.equal(refreshed, 1);
  assert.equal(f.calls.saved, 1);
});
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
