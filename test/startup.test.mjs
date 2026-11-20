// Exercise the real plugin lifecycle and lineMap, with only Obsidian/UI surfaces stubbed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
import { ingestClaudeLine, ingestWorkbuddyLine, ingestAntigravityLine } from '../src/agent-ingestors.js';
import { SessionTitleManager, parseSessionTitleReply } from '../src/session-titles.js';
const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
const stubs=new Map();
for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^\"]+)"/g)){
 const spec=match[2];
 if(['./constants.js','./readers.js','./workflow.js','./attention.js','./i18n.js','./journal-archive.js','./organize-journal.js','./journal-layout.js','./project-workbench.js','./agent-registry.js','./task-mentions.js'].includes(spec)) continue;
 const exports=match[1].split(',').map(n=>n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
 stubs.set(spec,exports.map(n=>n==='Plugin'?`export class Plugin { constructor(){this.cleanups=[]} register(fn){this.cleanups.push(fn)} registerView(){} addRibbonIcon(){} addSettingTab(){} registerEditorExtension(){} registerMarkdownPostProcessor(){} addCommand(){} registerObsidianProtocolHandler(){} registerInterval(id){this.register(()=>clearInterval(id))} }`: /^[A-Z]/.test(n)?`export class ${n} {constructor(){this.runners=new Map()} hide(){} stop(){} }`:`export function ${n}(){}`).join('\n'));
}
const built=await esbuild.build({stdin:{contents:"export {default as AgentDeckPlugin} from './src/main.js'; export {AgentUsage, UsageStore} from './src/readers.js';",resolveDir:root},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'ui-only',setup(b){b.onResolve({filter:/.*/},args=>stubs.has(args.path)?{path:args.path,namespace:'ui'}:undefined);b.onLoad({filter:/.*/,namespace:'ui'},args=>({contents:stubs.get(args.path),loader:'js'}))}}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-startup-'));
const modulePath=path.join(dir,'plugin.mjs');fs.writeFileSync(modulePath,built.outputFiles[0].text);
const {AgentDeckPlugin,AgentUsage,UsageStore}=await import(pathToFileURL(modulePath));
fs.rmSync(dir,{recursive:true,force:true});
const p=new AgentDeckPlugin();
let layouts=[],reads=0,release;
const gate=new Promise(r=>release=r);
UsageStore.prototype.load=async function(file){reads++;this.file=file;await gate;};
AgentUsage.prototype.loadCache=async()=>{reads++;return false};
p.app={vault:{adapter:{getBasePath:()=>'/vault'}},workspace:{onLayoutReady(fn){layouts.push(fn)}}};p.manifest={id:'agent-deck'};p.loadData=async()=>({showMenuBar:false,importNautilus:false});p.setupRibbon=()=>{};p.refreshUI=()=>{};
const loading=p.onload();
let loaded=false;loading.then(()=>loaded=true);
await new Promise(r=>setTimeout(r,20));
assert.equal(loaded,true,'plugin registration must finish before layout or cache reads');
assert.equal(reads,0,'usage/cache IO stays off the startup barrier');
for(const ready of layouts)ready();
await new Promise(r=>setTimeout(r,0));
assert.equal(reads,1,'summary restoration starts after layout');
p.onunload();for(const fn of p.cleanups)fn();release();await new Promise(r=>setTimeout(r,0));
assert.equal(reads,1,'unload during summary read must not proceed to cache/scans');

const q=new AgentDeckPlugin();q.views=new Set();q.checkAttention=()=>{};q.app={workspace:{iterateAllLeaves(){}}};q.settings={};q._lineMaps={};q.jobs={};
let liveCalls=0;let current='wait';
q.usage={meta:new Map([['11111111-2222-3333-4444-555555555555',{sid:'11111111-2222-3333-4444-555555555555',state:'wait'}]]),liveSessions(){liveCalls++;return [{sid:'11111111-2222-3333-4444-555555555555',state:current}]}};
const doc={toString:()=>'- DOING A\n  - 🔗 [Codex](codex://threads/11111111-2222-3333-4444-555555555555)\n- DOING B\n  - 🔗 [Codex](codex://threads/11111111-2222-3333-4444-555555555555)'};
let map=q.lineMap('note.md',doc);
assert.equal(liveCalls,1,'one live snapshot per document instead of once per link');
assert.equal(map.sessionByParent.get(0).state,'wait');
current='run';q.refreshUI();await new Promise(r=>setTimeout(r,140));
map=q.lineMap('note.md',doc);
assert.equal(map.sessionByParent.get(0).state,'run','scan refresh invalidates cached session status without editing');
clearTimeout(q._refreshTimer);
console.log('PASS startup barrier, unload during restore, shared live snapshot, status invalidation');

{
 const p = new AgentDeckPlugin();
 const spiral = { journalDayCutoff: () => 7 };
 const plugins = { 'nautilus-spiral': spiral };
 p.app = { plugins: { plugins } };
 p.settings = { dayCutoff: 0 };
 p._standaloneDayCutoff = 0;
 p.syncJournalCutoff();
 assert.equal(p.settings.dayCutoff, 7, 'the installed Spiral owns the shared cutoff');
 spiral.journalDayCutoff = () => 0;
 p.syncJournalCutoff();
 assert.equal(p.settings.dayCutoff, 0, 'midnight is a valid shared cutoff');
 spiral.journalDayCutoff = () => 4.5;
 p.syncJournalCutoff();
 assert.equal(p.settings.dayCutoff, 4.5, 'changes to the shared cutoff take effect without a restart');
 delete plugins['nautilus-spiral'];
 p.syncJournalCutoff();
 assert.equal(p.settings.dayCutoff, 0, 'standalone mode restores its own cutoff');
 plugins['nautilus-spiral'] = spiral;
 p._scannedDayCutoff = 0;
 const events = [];
 p.app.workspace = { trigger: event => events.push(event) };
 p.usage = {
   files: new Map([['old-bucket', {}]]), meta: new Map(), titles: new Map(), lastScan: Date.now(),
   async scan({ since }) {
     assert.equal(since, 0, 'cutoff changes re-read cached logs with the new date');
     assert.equal(this.files.size, 0, 'the previous cutoff must not survive in parsed file caches');
     return new Set(['2026_11_20']);
   },
   maybeSaveCache() {},
 };
 p.store = { merge() {}, prune() {} };
 p.delegator = { resolveHandoffs() {} };
 p.journalSync = { run: async () => {} };
 p.refreshExternalState = async () => false;
 p.refreshUI = () => {};
 await p.scanNow(false);
 assert.deepEqual(events, ['agent-deck:sessions-changed']);
}

{
 const p=new AgentDeckPlugin();
 const notices=[], scans=[], syncs=[], writes=[];
 p.settings={};
 p.usage={files:new Map(),meta:new Map(),titles:new Map(),maybeSaveCache(){},async scan({since}){scans.push(since);return new Set(['today']);}};
 p.store={merge(){},prune(){}};
 p.delegator={resolveHandoffs(){}};
 p.journalSync={run:async(options)=>{syncs.push(options);}};
 p.logNowWithMarkerGuard=async(options)=>{writes.push(options);return {changes:['logged']};};
 p.refreshExternalState=async()=>false;
 p.refreshUI=()=>{};
 p.notice=(message)=>notices.push(message);
 await Promise.all([p.rescanAndLog(),p.rescanAndLog()]);
 assert.deepEqual(scans,[0],'manual requests perform one full scan while one is in flight');
 assert.deepEqual(syncs,[{force:true}],'manual sync bypasses the background throttle');
 assert.equal(writes.length,1,'manual scan uses the journal command path');
 assert.ok(notices.some(message=>message.includes('正在扫描')));
 assert.ok(notices.some(message=>message.includes('整理进日记 1 处')));
 p.settings.journalAutoWrite=false;
 await p.rescanAndLog();
 assert.deepEqual(scans,[0,0]);
 assert.equal(writes.length,1);
 assert.equal(syncs.length,1);
 assert.ok(notices.at(-1).includes('日记写入已关闭'));
}

{
  const sid='11111111-2222-3333-4444-555555555555';
  const mixed={toString:()=>`    - DOING parent\n\t\t- 🔗 [Codex](codex://threads/${sid})`};
  assert.ok(q.lineMap('mixed.md',mixed).sessionByParent.has(0),'shared ownership parser handles mixed tabs and spaces');
  const fenced={toString:()=>`~~~md\n- DOING example\n  - 🔗 [Codex](codex://threads/${sid})\n~~~`};
  assert.equal(q.lineMap('example.md',fenced).sessionByParent.size,0,'code examples do not bind real sessions');
}

{
 const plainCalls=liveCalls;
 q.lineMap('plain.md',{toString:()=>'- TODO no bound sessions'});
 assert.equal(liveCalls,plainCalls,'unbound notes do not compute a session snapshot');
 const s=new AgentDeckPlugin();let endScan,merged=false;
 s.usage={scan:()=>new Promise(resolve=>endScan=resolve)};
 s.store={merge(){merged=true}};s.refreshUI=()=>{};s.settings={};
 const pending=s.scanNow();await new Promise(r=>setTimeout(r,0));
 s._unloaded=true;endScan(new Set());await pending;
 assert.equal(merged,false,'a scan completing after unload must not write summaries or notes');
}

{
 const closing=new AgentDeckPlugin();let cacheFlushes=0,summaryFlushes=0;
 closing.usage={dirty:false,saving:true,saveCacheSync(){cacheFlushes++}};
 closing.store={dirty:false,saving:Promise.resolve(),saveSync(){summaryFlushes++}};
 closing.onunload();
 assert.equal(cacheFlushes,1,'unload flushes an in-flight cache even when its snapshot cleared dirty');
 assert.equal(summaryFlushes,1,'unload commits a pending summary before the next instance loads');
}

{
 const sid='11111111-2222-3333-4444-555555555555';
 const p=new AgentDeckPlugin();p.settings={};
 const provider={settings:{lineProgress:true,showAi:true},lineStatus:()=>({sid})};
 p.app={plugins:{plugins:{'nautilus-spiral':provider}}};
 const lines=['- DOING task ^ad-test',`  - 🔗 [Codex](codex://threads/${sid})`,'  - 💬 result'];
 const group={line:0,records:[1,2]};
 assert.equal(p.redundantSessionLink(group,lines),1,'same-session progress makes the link redundant');
 provider.lineStatus=()=>({sid:'different'});
 assert.equal(p.redundantSessionLink(group,lines),-1,'a progress row for another session cannot replace the link');
 provider.lineStatus=()=>({sid});provider.settings.lineProgress=false;
 assert.equal(p.redundantSessionLink(group,lines),-1,'disabled progress leaves the link usable');
 provider.settings.lineProgress=true;
 assert.equal(p.redundantSessionLink({line:0,records:[1,2,3]},[...lines,lines[1]]),-1,'multiple session links remain available');
 const far=[lines[0],...Array(12).fill('  - note'),lines[1]];
 assert.equal(p.redundantSessionLink({line:0,records:[13]},far),-1,'links outside the provider lookup range are not hidden');
 lines[0]='- DONE task ^ad-test';
 assert.equal(p.redundantSessionLink(group,lines),-1,'DONE has no replacement progress row');
}

{
 // 首次安装：面板放进右侧栏，并把右侧栏一起展开；之后不再自动打开
 const p=new AgentDeckPlugin();
 const calls=[];let expanded=0;
 p.settings={viewOpened:false};
 p.saveSettings=async()=>{calls.push('save');};
 p.app={workspace:{
  getLeavesOfType:()=>[],
  getRightLeaf:()=>({setViewState:async(state)=>{calls.push(`set:${state.type}:${state.active}`);}}),
  rightSplit:{expand:()=>{expanded++;}},
 }};
 assert.equal(p.openPanelOnce(),true,'first load opens the panel once');
 assert.equal(p.settings.viewOpened,true,'one-shot flag is persisted');
 assert.equal(calls.length,2,calls);
 assert.equal(calls[0],'save','the one-shot flag is saved before touching the layout');
 assert.ok(String(calls[1]).startsWith('set:')&&String(calls[1]).endsWith(':false'),calls[1]);
 assert.equal(expanded,1,'the right sidebar is expanded for a fresh install');
 assert.equal(p.openPanelOnce(),false,'later loads leave it alone');
 assert.equal(expanded,1,'a second load must not expand the sidebar again');

 const again=new AgentDeckPlugin();
 again.settings={viewOpened:true};
 again.saveSettings=async()=>{throw new Error('should not save');};
 again.app={workspace:{getLeavesOfType:()=>[],getRightLeaf:()=>({setViewState:async()=>{throw new Error('should not open');}}),rightSplit:{expand(){throw new Error('should not expand');}}}};
 assert.equal(again.openPanelOnce(),false,'an existing install keeps its panel position untouched');
}

{
 // 阅读视图（preview）里隐藏的 editor 内容可能是旧的：readNote / writeNote 必须读写 Vault 而不是读过期的 editor
 const q=new AgentDeckPlugin();
 let disk='- TODO 测试\n\t- 📝 [[Agent Deck/派发/draft.md|派发草稿]]\n';
 const previewView={getMode:()=>'preview',editor:{getValue(){throw new Error('must not read hidden preview editor')},transaction(){throw new Error('must not write hidden preview editor')}}};
 const sourceView={getMode:()=>'source',editor:{getValue:()=>'来自编辑器的最新内容',transaction({changes:[c]}){disk=c.text}}};
 q.viewForPath=(path)=>path==='preview.md'?previewView:sourceView;
 q.app={vault:{getAbstractFileByPath:(path)=>({path}),read:async()=>disk,process:async(_file,fn)=>{disk=fn(disk)}}};
 assert.equal(await q.readNote('preview.md'),disk);
 await q.writeNote('preview.md','磁盘新内容');
 assert.equal(disk,'磁盘新内容');
 assert.equal(await q.readNote('source.md'),'来自编辑器的最新内容');
 await q.writeNote('source.md','编辑器新内容');
 assert.equal(disk,'编辑器新内容');
}

{
 // 1. 原生客户端标题优先，WorkBuddy/Claude 的 ai-title 可更新，Antigravity 不把首句假冒成客户端标题
 const usage = new AgentUsage({});
 const claudeFc = { path: 'c.jsonl', agent: 'claude', sid: 'c1', id: 'c1', cwd: '/proj', app: 'claude', days: new Map(), msgs: new Map(), titles: new Map(), live: null };
 ingestClaudeLine({ usage }, JSON.stringify({ type: 'user', sessionId: 'c1', cwd: '/proj', timestamp: new Date().toISOString(), message: { role: 'user', content: '很长的一段第一轮原始提问，不该一直充当侧栏标题' } }), claudeFc, new Set());
 ingestClaudeLine({ usage }, JSON.stringify({ type: 'ai-title', sessionId: 'c1', aiTitle: 'Claude 自动总结标题' }), claudeFc, new Set());
 assert.equal(usage.hasClientTitle('c1'), true);
 assert.equal(usage.titles.get('c1'), 'Claude 自动总结标题');
 ingestClaudeLine({ usage }, JSON.stringify({ type: 'custom-title', sessionId: 'c1', customTitle: '用户手动重命名' }), claudeFc, new Set());
 assert.equal(usage.titles.get('c1'), '用户手动重命名');

 const wbFc = { path: 'wb.jsonl', agent: 'workbuddy', sid: 'wb1', id: 'wb1', cwd: '/proj', app: 'workbuddy', days: new Map(), msgs: new Map(), titles: new Map(), live: null };
 ingestWorkbuddyLine({ usage }, JSON.stringify({ type: 'message', role: 'user', timestamp: Date.now(), content: [{ type: 'input_text', text: 'WorkBuddy 原始首句提问' }] }), wbFc, new Set());
 assert.equal(usage.hasClientTitle('wb1'), false, 'first prompt fallback does not lock out later ai-title');
 ingestWorkbuddyLine({ usage }, JSON.stringify({ type: 'ai-title', aiTitle: 'WorkBuddy 总结名' }), wbFc, new Set());
 assert.equal(usage.hasClientTitle('wb1'), true);
 assert.equal(usage.meta.get('wb1')?.title, 'WorkBuddy 总结名');

 const agyFc = { path: 't.jsonl', agent: 'antigravity', sid: 'ag1', id: 'ag1', cwd: '/proj', app: 'antigravity', days: new Map(), msgs: new Map(), titles: new Map(), live: null };
 ingestAntigravityLine({ usage, inferWorkspaceRoot: (x) => x, projectName: () => 'proj' }, JSON.stringify({ type: 'USER_INPUT', created_at: new Date().toISOString(), content: '帮我查一下最近的记忆写入为什么变慢了' }), agyFc, new Set());
 assert.equal(usage.hasClientTitle('ag1'), false, 'Antigravity prompt excerpt must not claim to be a client summary title');

 // 2. MenuBar 置顶排序、置顶补回历史会话，以及标题有额度走模型、没额度静默退回
 const plugin = new AgentDeckPlugin();
 plugin.settings = {
  agents: { claude: true, antigravity: true },
  primaryAgents: ['claude'],
  menuBarPinnedSids: ['ag-pin'],
  menuBarPrimaryLimit: 4,
  menuBarOtherLimit: 1,
  menuBarAutoTitles: { 'ag-cached': { title: 'Antigravity 缓存总结名', at: Date.now() } },
 };
 plugin.store = new Map();
 plugin.usage = usage;
 plugin.jobs = {};
 plugin.extState = {};
 plugin._lineMaps = {};
 plugin.views = new Set();
 plugin.liveSessions = () => [
  { sid: 'c1', agent: 'claude', title: 'Claude 自动总结标题', clientTitle: true, text: 'raw', cwd: '/proj', state: 'run', lastAt: Date.now() },
  { sid: 'ag-cached', agent: 'antigravity', title: '原始首句很长很长', clientTitle: false, text: '原始首句很长很长', cwd: '/proj', state: 'run', lastAt: Date.now() - 1000 },
 ];
 plugin.recentSessions = () => [
  { sid: 'ag-pin', agent: 'antigravity', title: '两天前盯盘会话', clientTitle: false, text: '两天前盯盘会话', cwd: '/proj', state: 'wait', lastAt: Date.now() - 48 * 3600e3 },
 ];
 let mb = plugin.buildMenuBarState();
 assert.deepEqual(mb.sessions.map((s) => s.sid), ['ag-pin', 'c1', 'ag-cached'], 'pinned session stays first across sections and history');
 assert.equal(mb.sessions[0].pinned, true);
 assert.equal(mb.sessions[1].title, 'Claude 自动总结标题');
 assert.equal(mb.sessions[2].title, 'Antigravity 缓存总结名');

 // 有额度生成，撞限额静默退回、不报错弹窗
 let saves = 0;
 let refreshed = 0;
 const fakePlugin = {
  _unloaded: false,
  settings: { menuBarAutoTitles: {} },
  saveSettings: async () => { saves++; },
  menubar: { update: () => { refreshed++; } },
 };
 const mgr = new SessionTitleManager(fakePlugin, {
  detect: () => ({ available: [{ id: 'agy' }] }),
  model: async () => '{"title":"Antigravity 模型补齐标题"}',
 });
 mgr.maybeQueue([{ sid: 's-ok', clientTitle: false, text: '如何优化 Obsidian 插件内存占用' }]);
 await new Promise((r) => setTimeout(r, 20));
 assert.equal(mgr.cachedTitle('s-ok'), 'Antigravity 模型补齐标题');
 assert.equal(saves, 1);
 assert.equal(refreshed, 1);

 const quotaMgr = new SessionTitleManager(fakePlugin, {
  detect: () => ({ available: [{ id: 'agy' }] }),
  model: async () => { throw new Error('429 rate limit / 额度不足'); },
 });
 quotaMgr.maybeQueue([{ sid: 's-quota', clientTitle: false, text: '另一个需要总结的会话内容在这里' }]);
 await new Promise((r) => setTimeout(r, 20));
 assert.equal(quotaMgr.cachedTitle('s-quota'), '');
 assert.ok(quotaMgr.quotaBlockedUntil > Date.now(), 'quota error backs off silently');
 assert.equal(parseSessionTitleReply('```json\n{"title":"「测试标题」"}\n```'), '测试标题');
}
