import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
import {AGENT_ORDER, DEFAULTS, deepMerge} from '../src/constants.js';

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.options = options; this.children = []; this.dataset = {}; this.events = {};
    this.style = {setProperty(){}}; this.classList = {contains: value => (this.options.cls || '').split(' ').includes(value)};
  }
  createEl(tag, options) { const el = new Element(tag, options); el.parent = this; this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass() {} removeClass() {} toggleClass() {} setAttr() {} empty() { this.children = []; }
  addEventListener(name, fn) { this.events[name] = fn; }
  all() { return [this, ...this.children.flatMap(el => el.all())]; }
  querySelector(selector) { return this.all().find(el => selector.startsWith('.') && el.classList.contains(selector.slice(1))); }
  closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parent?.closest(selector); }
  contains(el) { return this.all().includes(el); }
  getBoundingClientRect() { return {left:0, width:100}; }
  focus() { this.focused = true; }
}
globalThis.__CardElement = Element;
const stubs = {
  obsidian: `export class ItemView { constructor(leaf) {Object.assign(this,leaf)} };
    export class Modal { constructor(){this.contentEl = new globalThis.__CardElement();this.modalEl=new globalThis.__CardElement()} open(){this.onOpen()} close(){this.onClose()} };
    export class Menu { constructor(){globalThis.__cardMenu=this;this.items=[]} addItem(fn){const item={setTitle(v){this.title=v;return this},setIcon(){return this},setDisabled(value){this.disabled=value;return this},onClick(fn){this.run=fn;return this}};fn(item);this.items.push(item)} showAtMouseEvent(){} };`,
  './icons.js': 'export function agentIcon(){};export function setLucide(){};export function stateIcon(){};',
  './lattice.js': 'export function lattice(){};', './editor.js': 'export const SESSION_MIME="test";'
};
const built = await esbuild.build({entryPoints:['src/view.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'ui',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'ui'}:undefined);b.onLoad({filter:/.*/,namespace:'ui'},a=>({contents:stubs[a.path]}))}}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-cards-'));
try {
  const file=path.join(dir,'view.mjs');fs.writeFileSync(file,built.outputFiles[0].text);
  const {AgentDeckView,AgentCardsModal}=await import(pathToFileURL(file));
  let persisted, scans=[], delegates=0, renders=0,live=[];
  const plugin={settings:deepMerge(DEFAULTS,{}),views:new Set(),saveSettings:async()=>{persisted=JSON.stringify(plugin.settings)},
    agentEnabled:id=>plugin.settings.primaryAgents.includes(id)||plugin.settings.agents[id]!==false,isPrimary:()=>false,usage:{liveSessions:()=>live},liveSessions:()=>live,jobs:{},
    acceptsItemDrag:e=>e.note===true,delegateDrop:()=>delegates++,readItemDrag:()=>({text:'task'}),scanNow:(...args)=>scans.push(args)};
  const view=new AgentDeckView({app:{},contentEl:new Element()},plugin);
  view.render=()=>renders++; view.sparkline=()=>{}; plugin.views.add(view);
  assert.deepEqual(view.visibleAgentIds(),AGENT_ORDER,'existing installs retain all cards in the old order');
  plugin.settings.agents.workbuddy=false;
  assert.ok(!view.visibleAgentIds().includes('workbuddy'),'disabled Agents are hidden from the board');
  plugin.settings.agents.workbuddy=true;
  assert.ok(view.visibleAgentIds().includes('workbuddy'),'turning an Agent back on restores its card');
  for (const count of [1,3,4,5]) {
    plugin.settings.ui.agentCards.hidden=AGENT_ORDER.slice(count);
    const grid=view.agentSection(new Element(),null);
    assert.equal(grid.dataset.layout,count<=3?'list':'grid');
    assert.equal(grid.children.length,count);
    assert.ok(grid.children.every(card=>!!card.querySelector('.ad-agentcard__detail')===(count<=3)),'list contains detail, small cards stay compact');
    assert.ok(grid.children.every(card=>!card.querySelector('.ad-agentcard__foot')),'no button row clutter');
  }
  plugin.settings.ui.agentCards.hidden=[];
  live=[{agent:'codex',state:'run',title:'Running a task'}];
  assert.equal(view.visibleAgentIds()[0],'codex','running unpinned Agent moves above idle Agents');
  plugin.settings.ui.agentCards.pinned=['antigravity'];
  assert.deepEqual(view.visibleAgentIds().slice(0,2),['antigravity','codex'],'pin always takes priority over runtime state');
  live=[];
  assert.equal(view.visibleAgentIds()[0],'antigravity','pin stays first when execution stops');
  plugin.settings.ui.agentCards.pinned=[];
  const agentsBefore=JSON.stringify(plugin.settings.agents),primariesBefore=JSON.stringify(plugin.settings.primaryAgents);
  const modal=new AgentCardsModal(view); modal.onOpen();
  const row=id=>modal.contentEl.all().find(el=>el.options.attr?.['data-agent']===id);
  const button=(el,label)=>el.all().find(el=>el.options.attr?.['aria-label']===label || el.options.text===label);
  await button(row('antigravity'),'置顶卡片').onclick();
  assert.equal(view.visibleAgentIds()[0],'antigravity','pin moves a card ahead of all unpinned cards');
  await button(row('claude'),'从侧边栏移除').onclick();
  assert.ok(!view.visibleAgentIds().includes('claude'));
  assert.equal(JSON.stringify(plugin.settings.agents),agentsBefore,'remove does not disable tracking');
  assert.equal(JSON.stringify(plugin.settings.primaryAgents),primariesBefore,'pin and remove do not change primary agents');
  await button(row('claude'),'添加到侧边栏').onclick();
  await button(row('antigravity'),'取消置顶').onclick();
  assert.deepEqual(view.visibleAgentIds(),AGENT_ORDER,'unpin restores manual order');
  await button(row('codex'),'上移').onclick();
  assert.deepEqual(view.visibleAgentIds().slice(0,2),['codex','claude']);
  const grid=new Element(); view.agentCard(grid,'claude',null); view.agentCard(grid,'codex',null); view.agentReorder(grid);
  const card=grid.children[0],other=grid.children[1];
  const grip=card.querySelector('.ad-agentcard__grip');
  const event={target:other,clientX:10,dataTransfer:{setData(){},setDragImage(){}},preventDefault(){this.prevented=true},stopPropagation(){}};
  grip.ondragstart(event);
  card.events.drop({...event,note:true});
  assert.equal(delegates,0,'card sorting never delegates a note');
  grid.events.dragover(event);assert.ok(event.prevented);assert.equal(event.dataTransfer.dropEffect,'move');
  grid.events.drop(event);await new Promise(r=>setImmediate(r));
  assert.equal(view._dragAgent,null);assert.deepEqual(view.visibleAgentIds().slice(0,2),['claude','codex'],'drag moves a card before its target');
  grip.ondragend();
  grip.onkeydown({...event,key:'ArrowDown'});await new Promise(r=>setImmediate(r));
  assert.deepEqual(view.visibleAgentIds().slice(0,2),['codex','claude'],'keyboard reorders cards');
  card.querySelector('.ad-agentcard__more').onclick(event);
  await globalThis.__cardMenu.items.find(item=>item.title==='扫描最近 7 天的会话').run();
  assert.deepEqual(scans,[[false,{agent:'claude',days:7}]],'card scan defaults to 7 days for that Agent');
  card.events.drop({...event,note:true});assert.equal(delegates,1,'note delegation still works');
  card.querySelector('.ad-agentcard__more').onclick(event);
  await globalThis.__cardMenu.items.find(item=>item.title==='置顶卡片').run();
  assert.ok(view.agentLayout().pinned.includes('claude'),'card menu can pin');
  await globalThis.__cardMenu.items.find(item=>item.title==='从侧边栏移除').run();
  assert.ok(!view.visibleAgentIds().includes('claude'),'card menu can remove');
  const restarted=new AgentDeckView({}, {settings:deepMerge(DEFAULTS,JSON.parse(persisted)),agentEnabled:plugin.agentEnabled,liveSessions:()=>live});
  assert.deepEqual(restarted.visibleAgentIds(),view.visibleAgentIds(),'saved order, pin and hidden states survive reload');
  await view.updateAgentCards(layout=>{layout.hidden=[...AGENT_ORDER]});
  assert.deepEqual(view.visibleAgentIds(),[],'all cards may be hidden');
  modal.render();await button(row('codex'),'添加到侧边栏').onclick();
  assert.deepEqual(view.visibleAgentIds(),['codex'],'a card can be recovered from an empty sidebar');
  plugin.settings.ui.agentCards={order:['unknown','codex','codex'],hidden:['unknown'],pinned:['unknown']};
  assert.deepEqual(view.visibleAgentIds(),['codex',...AGENT_ORDER.filter(id=>id!=='codex')],'new Agents are added and stale IDs ignored');
  assert.ok(renders>0);
  console.log('PASS Agent cards: manage, drag, keyboard, pin/unpin, remove/add, empty state, persistence, scan scope and note delegation');
} finally { delete globalThis.__CardElement;delete globalThis.__cardMenu;fs.rmSync(dir,{recursive:true,force:true}); }
