import { register } from 'node:module';
import assert from 'node:assert/strict';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s.endsWith('.png'))return {url:'data:text/javascript,export default "";',shortCircuit:true};if(s==='obsidian')return {url:'data:text/javascript,export class App{};export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin}};export class Notice{};export class Modal{};export class Menu{};export function setIcon(){};',shortCircuit:true};return n(s,c)}`));
const {AgentDeckSettingsTab, TABS} = await import('../src/settings.js');
const {AGENTS, AGENT_ORDER, DEFAULTS, deepMerge, syncDelegationSettings} = await import('../src/constants.js');

assert.deepEqual(TABS.map(([id]) => id), ['delegate', 'record', 'dream', 'experimental', 'about'], 'settings include an experimental features page');

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
  appendChild(el){if(el.parentElement)el.parentElement.children=el.parentElement.children.filter(child=>child!==el);el.parentElement=this;this.children.push(el);return el;}
  addEventListener(){}
  querySelector(sel){if(sel===':scope > .ad-row__right')return this.children.find(c=>c.classList.contains('ad-row__right'));if(sel===':scope > .ad-row__left')return this.children.find(c=>c.classList.contains('ad-row__left'));return null;}
  createEl(tag,options){const el=new Element(tag,options);return this.appendChild(el);}
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
  {id:'eight',agent:'hermes',name:'Hermes one',tags:[]},
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
assert.equal(group(body,'codex'),undefined,'disabled Agent is hidden from Manage models');
assert.equal(plugin.settings.ui.modelGroups.codex.open,false,'disabled Agent group state remains folded');
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
assert.equal(group(body,'codex').open,false,'reenabling a non-primary Agent keeps the default folded');
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
assert.equal(modelsBody.all().filter(el=>el.classList.contains('ad-modelgroup')).length, AGENT_ORDER.length, 'Manage models includes all Agents');
assert.equal(modelsBody.all().filter(el=>el.tag==='select').length, 0, 'Manage models removes duplicate default model/effort selectors');
for (const id of ['workbuddy', 'qwenwork', 'cursor', 'grokbot']) {
  const status=modelsBody.all().find(el=>el.classList.contains('ad-modelgroup')&&el.dataset.agent===id);
  assert.equal(status.tag,'div','client-managed model groups do not have an empty expand control');
}

// Verify full Delegation and Recording pages: single edit locations and independent primary vs default target.
tab.modelRow = origModelRow;
const origAllModels = plugin.allModels;
plugin.allModels = () => [
  ...origAllModels(),
  { id: "gpt-6.1-sol", agent: "codex", name: "GPT-6.1 Sol", tags: [] },
  { id: "gpt-6-astra", agent: "codex", name: "GPT-6 Astra", tags: [] },
];
plugin.settings.delegate.codex.model = "gpt-6.1-sol";
plugin.settings.models.enabled = ["gpt-6.1-sol"];
const delBody = new Element();
tab.renderDelegate(delBody);
const recBody = new Element();
tab.renderRecord(recBody);

const targetPickers = [...delBody.all(), ...recBody.all()].filter(el => el.classList.contains('ad-targetpick'));
assert.equal(targetPickers.length, 1, 'default delegation target picker appears exactly once across all pages');
assert.equal(targetPickers[0].children.length, AGENT_ORDER.filter(id => !AGENTS[id]?.trackingOnly).length, 'default target picker shows enabled delegable/handoff Agents');
assert.equal(delBody.all().filter(el => el.tag === 'select').length, 9, 'seven default-model selects + primary terminal select + steward agent select');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-codex-picker')).length, 0, 'Codex uses the standard select menu');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-effort')).length, 7, 'exactly one default effort control per configurable Agent on Delegation page');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent')).length, AGENT_ORDER.length, 'Recording page lists all tracked Agents');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent__config')).length, 0, 'Recording agent cards have no duplicate model or default-target controls');

console.log('PASS Delegation and Recording pages enforce a single editable home for every setting across all seven Agents');

for (const page of [delBody, recBody]) {
  const more = page.all().filter(el => el.tag === 'details' && el.children[0]?.children.some(child => child.options.text === '更多设置'));
  assert.ok(more.length >= 4, 'detailed options have a More settings entry in each busy area');
  assert.ok(more.every(el => el.open === false), 'More settings is collapsed initially');
}
const moreAncestor = el => { for (let p = el.parentElement; p; p = p.parentElement) if (p.tag === 'details' && p.children[0]?.children.some(child => child.options.text === '更多设置')) return p; };
for (const label of ['扫描间隔（秒）', '整理超时（秒）', '每个 Agent 的小火花线', ...(process.platform === 'darwin' ? ['菜单栏：其它 Agent 最多几个'] : [])]) {
  const el = recBody.all().find(el => el.options.text === label);
  assert.ok(el && moreAncestor(el), label + ' stays reachable under More settings');
}
for (const label of ['启用日记写入', '自动会话记录', '💬 最多多少个字', ...(process.platform === 'darwin' ? ['macOS 菜单栏'] : [])]) {
  const el = recBody.all().find(el => el.options.text === label);
  assert.ok(el && !moreAncestor(el), label + ' remains visible');
}
if (process.platform !== 'darwin') {
  for (const label of ['macOS 菜单栏', '菜单栏：其它 Agent 最多几个', '菜单栏快捷键', '重启菜单栏']) {
    assert.equal(recBody.all().find(el => el.options.text === label), undefined, label + ' is hidden off macOS');
  }
}
assert.equal(DEFAULTS.resultMax, 350);
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 240 })).resultMax, 350, 'old default migrates');
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 600 })).resultMax, 600, 'custom maximum survives');
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 240, resultMaxDefault350: true })).resultMax, 240, 'migration only runs once');
console.log('PASS More settings: collapsed detail controls, visible common actions and one-time result-length migration');

const delegateGroups = delBody.all().filter(el => el.classList.contains('ad-delegate-agent'));
assert.equal(delegateGroups.length, 7);
for (const card of delegateGroups) assert.equal(card.open, plugin.isPrimary(card.dataset.agent), 'delegation cards default to primary-only expansion');
const codexCard = delegateGroups.find(el => el.dataset.agent === 'codex');
const codexSelect = codexCard.all().find(el => el.tag === 'select');
const codexOptions = codexSelect.children;
assert.deepEqual(codexOptions.map(el => el.options.text), ['不指定（使用当前默认模型）', 'Codex one', 'GPT-6.1 Sol', 'GPT-6 Astra']);
assert.equal(codexOptions.filter(el => el.selected).length, 1);
codexSelect.value = 'three';
codexSelect.onchange();
assert.equal(plugin.settings.delegate.codex.model, 'three');
assert.ok(plugin.settings.models.enabled.includes('three'), 'selecting an un-enabled Codex model enables it');
codexSelect.value = '';
codexSelect.onchange();
assert.equal(plugin.settings.delegate.codex.model, '', 'can choose unspecified default model');
assert.ok(!plugin.settings.models.enabled.includes(''), 'empty model id is never stored in enabled');
syncDelegationSettings(plugin.settings);
assert.equal(plugin.settings.delegate.codex.model, '', 'syncDelegationSettings preserves explicit unspecified model');
const terminalSelect = delBody.all().filter(el => el.tag === 'select').at(-1);
assert.deepEqual(terminalSelect.children.map(el => el.attrs.value), ['auto', 'terminal', 'iterm', 'warp', 'tern', 'herdr']);
terminalSelect.value = 'iterm';
terminalSelect.onchange();
assert.equal(plugin.settings.cliTerminal, 'iterm');
console.log('PASS primary-only delegation folds and standard select menus for Codex and primary terminal');

// Regression: closing models auto-saves immediately and never re-enables disabled active defaults.
{
  let saves = 0;
  const s = deepMerge(DEFAULTS, {
    delegate: { dsh: { model: 'deepseek-v4-pro' } },
    models: {
      enabled: ['dsh-default', 'deepseek-v4-pro', 'deepseek-v41-flash'],
      defaultByAgent: { dsh: 'deepseek-v4-pro' },
    },
  });
  const p2 = {
    settings: s,
    saveSettings: async () => { saves++; },
    agentEnabled: (id) => id === 'dsh',
    isPrimary: () => true,
    defaultTarget: () => 'dsh',
    allModels: (custom = []) => [
      { id: 'dsh-default', agent: 'dsh', name: '不指定（使用 DSH 当前默认模型）', tags: [] },
      { id: 'deepseek-v4-pro', agent: 'dsh', name: 'DeepSeek-V4-Pro', tags: [] },
      { id: 'deepseek-v41-flash', agent: 'dsh', name: 'DeepSeek-V4.1-Flash', tags: [] },
      ...custom,
    ],
    modelsFor: (id) => p2.allModels().filter((m) => m.agent === id),
    modelById: (id) => p2.allModels().find((m) => m.id === id) || null,
    modelEnabled: (id) => s.models.enabled.includes(id),
    defaultModel: (id) => s.delegate[id]?.model ?? '',
    usage: { meta: new Map(), files: new Map(), errors: [] },
    store: { days: {} },
  };
  const t2 = new AgentDeckSettingsTab({}, p2);
  let scrolledTo = null;
  t2.containerEl = { querySelector: (sel) => ({ scrollIntoView: () => { scrolledTo = sel; } }) };
  t2.display = () => {};

  const mBody = new Element();
  t2.renderModels(mBody);
  const savesBeforeToggle = saves;
  const proRow = mBody.all().find((el) => el.classList.contains('ad-modelrow') && el.dataset.id === 'deepseek-v4-pro');
  const proToggle = proRow.all().find((el) => el.classList.contains('ad-switch'));
  await proToggle.onclick();
  assert.equal(saves, savesBeforeToggle + 1, 'toggling a model saves immediately without requiring draft bar');
  assert.ok(!s.models.enabled.includes('deepseek-v4-pro'), 'closed model stays disabled even when it was default');
  assert.equal(s.delegate.dsh.model, 'dsh-default', 'closing active default switches cleanly to dsh-default');
  assert.equal(t2.isDraftDirty(), false, 'draft stays clean after auto-save');

  // Re-sync must not push closed model back into enabled.
  syncDelegationSettings(s);
  assert.ok(!s.models.enabled.includes('deepseek-v4-pro'));

  // Clicking "全部开启" enables all, then "全部关闭" disables all DSH models cleanly and falls back to "".
  const mBody2 = new Element();
  t2.renderModels(mBody2);
  const openAllBtn = mBody2.all().find((el) => el.classList.contains('ad-linkbtn') && el.options.text === '全部开启');
  await openAllBtn.onclick();
  assert.equal(s.models.enabled.length, 3);
  const mBody3 = new Element();
  t2.renderModels(mBody3);
  const savesBeforeCloseAll = saves;
  const closeAllBtn = mBody3.all().find((el) => el.classList.contains('ad-linkbtn') && el.options.text === '全部关闭');
  await closeAllBtn.onclick();
  assert.equal(saves, savesBeforeCloseAll + 1);
  assert.deepEqual(s.models.enabled, []);
  assert.equal(s.delegate.dsh.model, '', 'disabling all models leaves agent unspecified ("")');

  // Legacy v1.13.3 vault upgrade migrates built-in DeepSeek presets to "dsh-default" once,
  // preserves custom/explicit user selections afterwards, and keeps dsh-default toggleable.
  const upgraded = {
    delegate: { dsh: { model: 'deepseek-v41-flash' } },
    models: { enabled: ['deepseek-v41-flash', 'deepseek-v4-pro'] },
  };
  syncDelegationSettings(upgraded, {
    delegate: { dsh: { model: 'deepseek-v41-flash' } },
    models: { enabled: ['deepseek-v41-flash', 'deepseek-v4-pro'] },
  });
  assert.ok(upgraded.models.enabled.includes('dsh-default'), 'upgraded vault receives dsh-default option once');
  assert.equal(upgraded.delegate.dsh.model, 'dsh-default', 'legacy built-in DSH preset migrates to dsh-default');
  assert.equal(upgraded.models.defaultByAgent.dsh, 'dsh-default');
  assert.equal(upgraded.dshDefaultSeeded, true);

  // Explicit user override afterwards survives re-sync, as do custom third-party DSH models on upgrade.
  upgraded.delegate.dsh.model = 'deepseek-v4-pro';
  upgraded.models.enabled = upgraded.models.enabled.filter((id) => id !== 'dsh-default');
  syncDelegationSettings(upgraded, upgraded);
  assert.equal(upgraded.delegate.dsh.model, 'deepseek-v4-pro', 'explicit selection after migration is preserved');
  assert.ok(!upgraded.models.enabled.includes('dsh-default'), 'subsequent sync respects user turning off dsh-default');

  const customDsh = {
    delegate: { dsh: { model: 'custom-third-party-model' } },
    models: { enabled: ['custom-third-party-model'] },
  };
  syncDelegationSettings(customDsh, {
    delegate: { dsh: { model: 'custom-third-party-model' } },
    models: { enabled: ['custom-third-party-model'] },
  });
  assert.equal(customDsh.delegate.dsh.model, 'custom-third-party-model', 'explicit custom third-party DSH model survives upgrade');
  assert.ok(customDsh.models.enabled.includes('dsh-default'), 'dsh-default is still seeded alongside custom model');

  // Agent card "管理模型" button opens that agent's group and scrolls to it.
  s.ui.modelGroups.dsh.open = false;
  t2.jumpToAgentModels('dsh');
  assert.equal(s.ui.modelGroups.dsh.open, true);
  assert.equal(t2._scrollToModels, 'dsh');
  console.log('PASS closing models auto-saves immediately, never snaps back, seeds dsh-default once on upgrade, and jumpToAgentModels expands target group');
}
