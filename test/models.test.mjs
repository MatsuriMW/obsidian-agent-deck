import { register } from 'node:module';
import assert from 'node:assert/strict';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s.endsWith('.png'))return {url:'data:text/javascript,export default "";',shortCircuit:true};if(s==='obsidian')return {url:'data:text/javascript,export class App{};export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin}};export class Notice{};export class Modal{};export class Menu{};export function setIcon(){};',shortCircuit:true};return n(s,c)}`));
const {AgentDeckSettingsTab} = await import('../src/settings.js');
const {DEFAULTS,deepMerge} = await import('../src/constants.js');
const plugin = {settings:deepMerge(DEFAULTS,{}),saveSettings(){}};
const tab = new AgentDeckSettingsTab({},plugin);
tab.display = () => {};
tab.draft = structuredClone(plugin.settings.models);
await tab.setDefaultModel('codex','custom-model');
assert.equal(plugin.settings.delegate.codex.model,'custom-model');
assert.equal(plugin.settings.models.defaultByAgent.codex,'custom-model');
assert.equal(tab.draft.defaultByAgent.codex,'custom-model');
assert.ok(tab.draft.enabled.includes('custom-model'));
tab.draft.effortByAgent = {claude:'max',codex:'low',dsh:'off'};
tab.saveDraft();
assert.equal(plugin.settings.delegate.claude.effort,'max');
assert.equal(plugin.settings.delegate.codex.effort,'low');
assert.equal(plugin.settings.delegate.dsh.effort,'off');
assert.equal(plugin.settings.delegate.codex.model,'custom-model');
assert.equal(plugin.settings.delegate.target,'claude');
console.log('PASS defaults stay in sync across Agents / Delegation / Models; per-agent effort stays independent');

// Render the actual picker with a small DOM surface, without launching Obsidian.
class Element {
  constructor(tag='div',options={}) { this.tag=tag;this.options=options;this.children=[];this.dataset={};this.style={setProperty(){}};this.classes=new Set((options.cls||'').split(/\s+/));this.attrs={...options.attr};this.classList={add:()=>{},contains:value=>this.classes.has(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};this.open=false;this.isConnected=true; }
  setAttribute(key,value){this.attrs[key]=value;}
  createEl(tag,options){const el=new Element(tag,options);this.children.push(el);return el;}
  createDiv(options){return this.createEl('div',options);}
  createSpan(options){return this.createEl('span',options);}
  all(){return [this,...this.children.flatMap(el=>el.all())];}
}
plugin.agentEnabled=id=>plugin.settings.agents[id]!==false;
plugin.defaultTarget=()=> 'claude';
plugin.allModels=()=>[
  {id:'one',agent:'claude',name:'Claude one',tags:[]},
  {id:'two',agent:'claude',name:'Claude two',tags:[]},
  {id:'three',agent:'codex',name:'Codex one',tags:[]},
  {id:'four',agent:'dsh',name:'DSH one',tags:[]},
];
plugin.defaultModel=id=>plugin.allModels().find(m=>m.agent===id)?.id;
tab.draft={...structuredClone(plugin.settings.models),pinned:['two','four'],enabled:['one','two','three','four']};
// Keep real renderModels/groupAction behavior; icon and row internals aren't relevant here.
tab.modelRow=(parent,model,_d,_target,_defaultId,pinned)=>{const row=parent.createDiv({cls:'test-row'});row.dataset.id=model.id;row.pinned=pinned;};
const render=()=>{const body=new Element();tab.renderModels(body);return body;};
const group=(body,id)=>body.all().find(el=>el.tag==='details'&&el.dataset.agent===id);
let body=render();
assert.equal(group(body,'claude')?.open,true,'visible Agents start expanded');
assert.deepEqual(group(body,'claude').children.filter(el=>el.dataset.id).map(el=>el.dataset.id),['two','one'],'pinned models stay first inside their Agent');
plugin.settings.ui.agentCards.hidden=['dsh'];
plugin.settings.agents.codex=false;
body=render();
assert.equal(group(body,'codex').open,false,'disabled Agent folds automatically');
assert.equal(group(body,'dsh').open,false,'removed Agent folds including pinned models');
assert.equal(group(body,'dsh').children.filter(el=>el.dataset.id).length,1,'folding retains its models');
const draftBefore=JSON.stringify(tab.draft);
const hidden=group(body,'dsh');hidden.open=true;hidden.ontoggle();
assert.equal(group(render(),'dsh').open,true,'manual expansion survives a rerender while hidden');
assert.equal(JSON.stringify(tab.draft),draftBefore,'folding never changes model configuration or its draft');
const visible=group(render(),'claude');visible.open=false;visible.ontoggle();
assert.equal(group(render(),'claude').open,false,'manual collapse is remembered');
visible.isConnected=false;visible.open=true;visible.ontoggle();
assert.equal(group(render(),'claude').open,false,'delayed events from a replaced settings page cannot undo the user choice');
plugin.settings.ui.agentCards.hidden=['claude'];
render();
plugin.settings.ui.agentCards.hidden=[];
plugin.settings.agents.codex=true;
body=render();
assert.equal(group(body,'claude').open,true,'showing an Agent again automatically expands it');
assert.equal(group(body,'codex').open,true,'reenabling tracking automatically expands it');
const restarted=new AgentDeckSettingsTab({},plugin);restarted.display=()=>{};restarted.modelRow=tab.modelRow;restarted.draft=tab.draft;
const restored=new Element();restarted.renderModels(restored);
assert.equal(group(restored,'claude').open,true,'fold state survives settings recreation');
console.log('PASS collapsible model groups: card visibility, tracking, manual toggles, pinned models, and unchanged drafts');

let selected;
const choices=tab.segmented(new Element(),[{id:'a',label:'A'},{id:'b',label:'B'}],'a',value=>{selected=value;});
assert.equal(choices.children[0].attrs['aria-pressed'],'true','selected settings expose their state');
assert.equal(choices.children[1].attrs['aria-pressed'],'false');
choices.children[1].onclick();
assert.equal(selected,'b');
assert.equal(choices.children[0].classList.contains('is-on'),false,'old selection clears even when the callback does not redraw');
assert.equal(choices.children[1].classList.contains('is-on'),true,'new selection is visible immediately');
assert.equal(choices.children[0].attrs['aria-pressed'],'false');
assert.equal(choices.children[1].attrs['aria-pressed'],'true');
console.log('PASS settings choices immediately reflect the selected value without requiring a redraw');

const {syncModelGroups}=await import('../src/model-groups.js');
const fs=await import('node:fs'),vm=await import('node:vm');
const mainSource=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=mainSource.indexOf('  async saveSettings() {'),end=mainSource.indexOf('\n  saveJobs()',start);
const save=vm.runInNewContext('({'+mainSource.slice(start,end)+'})',{syncModelGroups,J:{setDayOffset(){}}});
save.settings=plugin.settings;save.jobs={};save.agentEnabled=plugin.agentEnabled;
let persisted;save.saveData=async value=>{persisted=structuredClone(value);};
plugin.settings.ui.modelGroups.claude.open=false;
plugin.settings.ui.agentCards.hidden=['claude'];await save.saveSettings();
assert.equal(persisted.ui.modelGroups.claude.open,false);
plugin.settings.ui.agentCards.hidden=[];await save.saveSettings();
assert.equal(persisted.ui.modelGroups.claude.open,true,'card off/on is persisted even while Models is closed');
console.log('PASS real settings save keeps model groups in sync outside the Models page');

for (const id of ['workbuddy','opencode','qoder']) {
  tab.modelTarget=id;
  const before=JSON.stringify(tab.draft),body=render();
  const targets=body.all().find(el=>el.options.cls==='ad-models-target');
  assert.equal(targets.children.length,7,'Models includes all tracked Agents');
  assert.equal(body.all().filter(el=>el.options.cls==='ad-modelpill').length,0,'client-managed models do not show an ineffective default selector');
  const status=body.all().find(el=>el.dataset.agent===id);
  assert.equal(status.tag,'div','client-managed model groups do not have an empty expand control');
  assert.equal(JSON.stringify(tab.draft),before,'showing a client-managed Agent preserves saved model choices');
}
console.log('PASS Models shows all seven Agents without ineffective controls for client-managed models');
