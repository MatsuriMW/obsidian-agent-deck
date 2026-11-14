// Exercise the real plugin lifecycle and lineMap, with only Obsidian/UI surfaces stubbed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
const stubs=new Map();
for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^\"]+)"/g)){
 const spec=match[2];
 if(['./constants.js','./readers.js','./workflow.js','./attention.js','./i18n.js','./journal-archive.js','./organize-journal.js','./journal-layout.js'].includes(spec)) continue;
 const exports=match[1].split(',').map(n=>n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
 stubs.set(spec,exports.map(n=>n==='Plugin'?`export class Plugin { constructor(){this.cleanups=[]} register(fn){this.cleanups.push(fn)} registerView(){} addSettingTab(){} registerEditorExtension(){} registerMarkdownPostProcessor(){} addCommand(){} registerObsidianProtocolHandler(){} registerInterval(id){this.register(()=>clearInterval(id))} }`: /^[A-Z]/.test(n)?`export class ${n} {constructor(){this.runners=new Map()} hide(){} stop(){} }`:`export function ${n}(){}`).join('\n'));
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
