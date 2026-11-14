import { register } from 'node:module';
import assert from 'node:assert/strict';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s.endsWith('.png'))return {url:'data:text/javascript,export default "";',shortCircuit:true};if(s==='obsidian')return {url:'data:text/javascript,export class App{};export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin}};export class Notice{};export class Modal{};export class Menu{};export function setIcon(){};',shortCircuit:true};return n(s,c)}`));
const {AgentDeckSettingsTab, TABS} = await import('../src/settings.js');
const {AGENT_ORDER, DEFAULTS, deepMerge, syncDelegationSettings} = await import('../src/constants.js');

assert.deepEqual(TABS.map(([id]) => id), ['delegate', 'record', 'dream', 'about'], 'four top-level settings pages');

const plugin = {settings:deepMerge(DEFAULTS,{}),saveSettings(){}};
const tab = new AgentDeckSettingsTab({},plugin);
tab.display = () => {};

// Legacy tab names route to the merged pages.
assert.equal(tab.normalizeTab('agents'), 'record');
assert.equal(tab.normalizeTab('tracking'), 'record');
assert.equal(tab.normalizeTab('models'), 'delegate');
assert.equal(tab.normalizeTab('delegate'), 'delegate');

// Legacy settings migration preserves defaultByAgent and effortByAgent.
const migrated = syncDelegationSettings(deepMerge(DEFAULTS, {}), {
  models: { defaultByAgent: { codex: 'legacy-codex' }, effortByAgent: { claude: 'max', dsh: 'off' } },
});
assert.equal(migrated.delegate.codex.model, 'legacy-codex');
assert.equal(migrated.delegate.claude.effort, 'max');
assert.equal(migrated.delegate.dsh.effort, 'off');

// Catalog draft save/discard only touches catalog fields and never overwrites newer delegation defaults.
tab.modelsDraft();
tab.draft.pinned.push('custom-pinned');
await tab.setDefaultModel('codex', 'custom-model');
await tab.setDefaultEffort('claude', 'max');
await tab.setDefaultEffort('codex', 'low');
await tab.setDefaultEffort('dsh', 'off');
assert.equal(plugin.settings.delegate.codex.model, 'custom-model');
assert.equal(plugin.settings.models.defaultByAgent.codex, 'custom-model');
assert.ok(tab.draft.enabled.includes('custom-model'));
// Simulate stale fields on draft to verify saveDraft/discardDraft ignore them.
tab.draft.defaultByAgent = { claude: 'stale-claude', codex: 'stale-codex' };
tab.draft.effortByAgent = { claude: 'low', codex: 'high', dsh: 'high' };
tab.saveDraft();
assert.ok(plugin.settings.models.pinned.includes('custom-pinned'), 'catalog changes are saved');
assert.equal(plugin.settings.delegate.claude.effort, 'max', 'saveDraft does not overwrite delegation effort');
assert.equal(plugin.settings.delegate.codex.effort, 'low');
assert.equal(plugin.settings.delegate.dsh.effort, 'off');
assert.equal(plugin.settings.delegate.codex.model, 'custom-model', 'saveDraft does not overwrite delegation model');
assert.equal(plugin.settings.models.defaultByAgent.codex, 'custom-model');
assert.equal(plugin.settings.delegate.target, 'claude');

tab.draft.pinned.push('unsaved-pin');
await tab.setDefaultModel('claude', 'claude-sonnet-5');
tab.discardDraft();
assert.ok(!tab.draft.pinned.includes('unsaved-pin'), 'discardDraft reverts unsaved catalog edits');
assert.equal(plugin.settings.delegate.claude.model, 'claude-sonnet-5', 'discardDraft preserves delegation defaults');
console.log('PASS defaults stay in sync; catalog draft save/discard never overwrites delegation defaults');

// Render the actual picker with a small DOM surface, without launching Obsidian.
class Element {
  constructor(tag='div',options={}) { this.tag=tag;this.options=options;this.children=[];this.dataset={...(options.attr?.['data-agent']?{agent:options.attr['data-agent']}:{})};this.style={setProperty(){}};this.classes=new Set((options.cls||'').split(/\s+/).filter(Boolean));this.attrs={...options.attr};this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),contains:value=>this.classes.has(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};this.open=false;this.isConnected=true; }
  setAttribute(key,value){this.attrs[key]=value;}
  appendChild(el){this.children.push(el);return el;}
  addEventListener(){}
  querySelector(sel){if(sel===':scope > .ad-row__right')return this.children.find(c=>c.classList.contains('ad-row__right'));if(sel===':scope > .ad-row__left')return this.children.find(c=>c.classList.contains('ad-row__left'));return null;}
  createEl(tag,options){const el=new Element(tag,options);this.children.push(el);return el;}
  createDiv(options){return this.createEl('div',options);}
  createSpan(options){return this.createEl('span',options);}
  all(){return [this,...this.children.flatMap(el=>el.all())];}
}
plugin.agentEnabled=id=>plugin.settings.agents[id]!==false;
plugin.isPrimary=id=>plugin.settings.primaryAgents.includes(id);
plugin.defaultTarget=()=> plugin.settings.delegate.target || 'claude';
plugin.allModels=()=>[
  {id:'one',agent:'claude',name:'Claude one',tags:[]},
  {id:'two',agent:'claude',name:'Claude two',tags:[]},
  {id:'three',agent:'codex',name:'Codex one',tags:[]},
  {id:'four',agent:'dsh',name:'DSH one',tags:[]},
  {id:'five',agent:'antigravity',name:'AGY one',tags:[]},
  {id:'six',agent:'opencode',name:'OpenCode one',tags:[]},
  {id:'seven',agent:'qoder',name:'Qoder one',tags:[]},
];
plugin.modelsFor=id=>plugin.allModels().filter(m=>m.agent===id);
plugin.modelById=id=>plugin.allModels().find(m=>m.id===id)||null;
plugin.modelEnabled=id=>plugin.settings.models.enabled.includes(id);
plugin.defaultModel=id=>plugin.settings.delegate[id]?.model || plugin.allModels().find(m=>m.agent===id)?.id;
plugin.usage={meta:new Map(),files:new Map(),errors:[]};
plugin.store={days:{}};
tab.draft={...structuredClone(plugin.settings.models),pinned:['two','four'],enabled:['one','two','three','four','five','six','seven']};
const origModelRow = tab.modelRow.bind(tab);
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

const modelsBody = render();
assert.equal(modelsBody.all().filter(el=>el.classList.contains('ad-modelgroup')).length, 7, 'Manage models includes all seven Agents');
assert.equal(modelsBody.all().filter(el=>el.tag==='select').length, 0, 'Manage models removes duplicate default model/effort selectors');
for (const id of ['workbuddy']) {
  const status=modelsBody.all().find(el=>el.classList.contains('ad-modelgroup')&&el.dataset.agent===id);
  assert.equal(status.tag,'div','client-managed model groups do not have an empty expand control');
}

// Verify full Delegation and Recording pages: single edit locations and independent primary vs default target.
tab.modelRow = origModelRow;
const delBody = new Element();
tab.renderDelegate(delBody);
const recBody = new Element();
tab.renderRecord(recBody);

const targetPickers = [...delBody.all(), ...recBody.all()].filter(el => el.classList.contains('ad-targetpick'));
assert.equal(targetPickers.length, 1, 'default delegation target picker appears exactly once across all pages');
assert.equal(targetPickers[0].children.length, AGENT_ORDER.length, 'default target picker shows all 7 Agents');
assert.equal(delBody.all().filter(el => el.tag === 'select').length, 6, 'exactly one default model select per configurable Agent on Delegation page');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-effort')).length, 6, 'exactly one default effort control per configurable Agent on Delegation page');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent')).length, AGENT_ORDER.length, 'Recording page lists all 7 tracked Agents');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent__config')).length, 0, 'Recording agent cards have no duplicate model or default-target controls');

console.log('PASS Delegation and Recording pages enforce a single editable home for every setting across all seven Agents');
