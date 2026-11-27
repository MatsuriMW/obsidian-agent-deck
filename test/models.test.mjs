import { register } from 'node:module';
import assert from 'node:assert/strict';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s.endsWith('.png'))return {url:'data:text/javascript,export default "";',shortCircuit:true};if(s==='obsidian')return {url:'data:text/javascript,export class App{};export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin}};export class Notice{};export class Modal{};export class Menu{};export function setIcon(){};',shortCircuit:true};return n(s,c)}`));
const {AgentDeckSettingsTab, TABS} = await import('../src/settings.js');
const {AGENTS, AGENT_ORDER, DEFAULTS, EFFORTS, deepMerge, syncDelegationSettings} = await import('../src/constants.js');
const {modelCatalogAgents} = await import('../src/agent-registry.js');

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

// Render the unified Delegation + Models view with a small DOM surface, without launching Obsidian.
class Element {
  constructor(tag='div',options={}) { this.tag=tag;this.options=options;this.children=[];this.dataset={...(options.attr?.['data-agent']?{agent:options.attr['data-agent']}:{})};this.style={setProperty(){}};this.classes=new Set((options.cls||'').split(/\s+/).filter(Boolean));this.attrs={...options.attr};this.value=options.attr?.value??'';this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:value=>this.classes.has(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};this.open=false;this.isConnected=true; }
  setAttribute(key,value){this.attrs[key]=value;}
  addClass(...v){this.classList.add(...v);}
  empty(){this.children=[];}
  setText(t){this.options={...this.options,text:t};}
  appendChild(el){if(el.parentElement)el.parentElement.children=el.parentElement.children.filter(child=>child!==el);el.parentElement=this;this.children.push(el);return el;}
  addEventListener(){}
  removeEventListener(){}
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
  {id:'two',agent:'claude',name:'Claude two',tags:['Reasoning']},
  {id:'three',agent:'codex',name:'Codex one',tags:[]},
  {id:'four',agent:'dsh',name:'DSH one',tags:['Fast']},
  {id:'five',agent:'antigravity',name:'AGY one',tags:[]},
  {id:'six',agent:'opencode',name:'OpenCode one',tags:[]},
  {id:'seven',agent:'qoder',name:'Qoder one',tags:[]},
  {id:'eight',agent:'hermes',name:'Hermes one',tags:[]},
  {id:'nine',agent:'minimax',name:'MiniMax one',tags:[]},
  {id:'ten',agent:'gemini',name:'Gemini one',tags:[]},
  {id:'eleven',agent:'cursor',name:'Cursor one',tags:[]},
  {id:'twelve',agent:'kimicode',name:'Kimi Code one',tags:[]},
  {id:'thirteen',agent:'trae',name:'Trae one',tags:[]},
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
const render=()=>{const body=new Element();tab.renderDelegate(body);return body;};
const delegateCard=(body,id)=>body.all().find(el=>el.classList.contains('ad-delegate-agent')&&el.dataset.agent===id);
const group=(body,id)=>body.all().find(el=>el.classList.contains('ad-modelgroup')&&el.dataset.agent===id);
let body=render();
assert.equal(delegateCard(body,'claude')?.open,true,'primary Agent card starts expanded');
assert.equal(group(body,'claude')?.open,false,'embedded Available models sub-accordion starts collapsed');
assert.deepEqual(group(body,'claude').all().filter(el=>el.dataset.id).map(el=>el.dataset.id),['two','one'],'pinned models stay first inside their Agent');
plugin.settings.agents.codex=false;
body=render();
assert.equal(delegateCard(body,'codex'),undefined,'disabled Agent is hidden from Agent configuration');
assert.equal(group(body,'codex'),undefined,'disabled Agent model group is hidden');
assert.equal(plugin.settings.ui.delegateGroups.codex.open,false,'disabled Agent group state remains folded');
assert.equal(group(body,'dsh').open,false,'embedded model group starts folded including pinned models');
assert.equal(group(body,'dsh').all().filter(el=>el.dataset.id).length,1,'folding retains its models');
const draftBefore=JSON.stringify(tab.draft);
const dshModels=group(body,'dsh');dshModels.open=true;dshModels.ontoggle();
assert.equal(group(render(),'dsh').open,true,'manual expansion of embedded model group survives a rerender');
assert.equal(JSON.stringify(tab.draft),draftBefore,'folding never changes model configuration or its draft');
const visibleCard=delegateCard(render(),'claude');visibleCard.open=false;visibleCard.ontoggle();
assert.equal(delegateCard(render(),'claude').open,false,'manual collapse of Agent card is remembered');
visibleCard.isConnected=false;visibleCard.open=true;visibleCard.ontoggle();
assert.equal(delegateCard(render(),'claude').open,false,'delayed events from a replaced settings page cannot undo the user choice');
plugin.settings.agents.claude=false;
render();
plugin.settings.agents.claude=true;
plugin.settings.agents.codex=true;
body=render();
assert.equal(delegateCard(body,'claude').open,true,'reenabling a primary Agent automatically expands its card');
assert.equal(delegateCard(body,'codex').open,false,'reenabling a non-primary Agent keeps the default folded');
const restarted=new AgentDeckSettingsTab({},plugin);restarted.display=()=>{};restarted.modelRow=tab.modelRow;restarted.draft=tab.draft;
const restored=new Element();restarted.renderDelegate(restored);
assert.equal(delegateCard(restored,'claude').open,true,'Agent card fold state survives settings recreation');
assert.equal(group(restored,'dsh').open,false,'embedded model sub-accordion starts collapsed on fresh settings tab');
console.log('PASS unified embedded model groups: card visibility, tracking, manual toggles, pinned models, and unchanged drafts');

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

// Verify unified Delegation and Recording pages: 4 cards on Delegation, embedded model groups, and single edit locations.
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

assert.equal(delBody.children.filter(el => el.classList.contains('ad-card')).length, 4, 'Delegation tab consolidates into 4 cards');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-models-card')).length, 1, 'Agent configuration serves as the single models card');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-modelgroup')).length, 12, '12 model-catalog Agents embed their own Available models sub-accordion');
assert.equal(delBody.all().filter(el => el.tag === 'button' && el.options.text === '管理模型').length, 0, 'modelSelect no longer renders redundant Manage models jump buttons');
const passiveSection = delBody.all().find(el => el.classList.contains('ad-delegate-passive'));
assert.deepEqual(passiveSection.all().filter(el => el.dataset.agent).map(el => el.dataset.agent), ['workbuddy', 'qwenwork', 'teleagent', 'grokbot', 'cindy', 'orca', 'muse', 'doubaowork'], 'all enabled non-configurable Agents appear dynamically in passive row');
const dshCardEl = delBody.all().find(el => el.classList.contains('ad-delegate-agent') && el.dataset.agent === 'dsh');
const dshModelsHead = dshCardEl.all().find(el => el.classList.contains('ad-modelgroup__head'));
const dshMoreDetails = dshCardEl.all().find(el => el.tag === 'details' && el.dataset.section === 'dsh-more');
assert.ok(dshModelsHead.all().some(el => el.options.text === '读取模型'), 'ACP Fetch models button lives in Available models summary');
assert.ok(!dshMoreDetails.all().some(el => el.options.text === '读取 Harness 可用模型'), 'More settings no longer duplicates Fetch models');

// Verify factual accuracy of targetHints, T3 Code config card, EFFORTS, steward options, terminal hint, and honest modelRow meta.
const agyTargetText = delBody.all().find(el => el.classList.contains('ad-settings-target') && el.dataset.agent === 'antigravity')?.all().map(e => e.options.text).filter(Boolean).join(' ');
const t3TargetText = delBody.all().find(el => el.classList.contains('ad-settings-target') && el.dataset.agent === 't3code')?.all().map(e => e.options.text).filter(Boolean).join(' ');
assert.ok(agyTargetText?.includes('agy CLI / 终端') && !agyTargetText?.includes('ACP'), 'Antigravity target hint accurately reflects agy CLI');
assert.ok(t3TargetText?.includes('t3 CLI / 桌面版') && !t3TargetText?.includes('ACP'), 'T3 Code target hint accurately reflects t3 CLI');
assert.ok(EFFORTS.antigravity.some(x => x.id === 'max'), 'Antigravity effort includes max');
for (const a of ['cursor', 'trae', 'gemini']) {
  assert.deepEqual(EFFORTS[a].map(x => x.id), ['low', 'medium', 'high'], `${a} uses 3-stop ACP effort instead of Claude 5-stop fallback`);
}
assert.equal(modelCatalogAgents().includes('t3code'), false, 't3code is excluded from modelCatalogAgents');
const t3CardEl = delBody.all().find(el => el.classList.contains('ad-delegate-agent') && el.dataset.agent === 't3code');
assert.ok(t3CardEl, 'T3 Code renders a dedicated Agent configuration accordion');
assert.ok(t3CardEl.all().some(el => el.options.text === '完成后自动在桌面版打开'), 'T3 Code exposes openDesktop toggle');
assert.ok(t3CardEl.all().some(el => el.options.text === 't3 程序路径'), 'T3 Code exposes binary path inside More settings');
assert.ok(t3CardEl.all().some(el => el.options.text === '检查 t3'), 'T3 Code exposes Check t3 button');
const stewardSelect = delBody.all().find(el => el.tag === 'select' && el.children.some(o => o.attrs.value === 'off'));
assert.ok(!stewardSelect.children.some(o => o.attrs.value === 'workbuddy'), 'Steward Agent selector excludes handoff-only WorkBuddy');
const termToggleDesc = delBody.all().find(el => el.classList.contains('ad-row__desc') && String(el.options.text || '').startsWith('适用于 '));
assert.ok(termToggleDesc?.options.text.includes('Antigravity') && termToggleDesc?.options.text.includes('Gemini CLI'), 'terminal delegation description dynamically includes all enabled terminal-capable Agents');
const minimalRowWrap = new Element();
origModelRow(minimalRowWrap, { id: 'm-min', name: 'Minimal Model', context: '—', tags: [] }, tab.modelsDraft(), 'antigravity', '', false);
assert.equal(minimalRowWrap.all().find(el => el.classList.contains('ad-modelrow__meta')), undefined, 'modelRow hides empty/placeholder metadata instead of rendering ○○○○○');

const targetPickers = [...delBody.all(), ...recBody.all()].filter(el => el.classList.contains('ad-targetpick'));
assert.equal(targetPickers.length, 1, 'default delegation target picker appears exactly once across all pages');
assert.equal(targetPickers[0].children.length, AGENT_ORDER.filter(id => !AGENTS[id]?.trackingOnly).length, 'default target picker shows enabled delegable/handoff Agents');
assert.equal(delBody.all().filter(el => el.tag === 'select').length, 14, 'twelve default-model selects + primary terminal select + steward agent select');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-codex-picker')).length, 0, 'Codex uses the standard select menu');
assert.equal(delBody.all().filter(el => el.classList.contains('ad-effort')).length, 12, 'exactly one default effort control per configurable Agent on Delegation page');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent')).length, AGENT_ORDER.length, 'Recording page lists all tracked Agents');
assert.equal(recBody.all().filter(el => el.classList.contains('ad-set-agent__config')).length, 0, 'Recording agent cards have no duplicate model or default-target controls');
for (const page of [delBody, recBody]) {
  const wikiLink = page.all().find(el => el.tag === 'a' && String(el.attrs?.href || '').includes('github.com/MatsuriMW/obsidian-agent-deck/wiki/Supported-Agents-and-Models'));
  assert.ok(wikiLink, 'settings page displays a clickable GitHub Wiki prerequisites link');
}

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
for (const label of ['启用日记写入', '自动会话记录', '结论总结风格', '结论字数上限', ...(process.platform === 'darwin' ? ['macOS 菜单栏'] : [])]) {
  const el = recBody.all().find(el => el.options.text === label);
  assert.ok(el && !moreAncestor(el), label + ' remains visible');
}
assert.equal(recBody.all().filter(el => el.classList.contains('ad-num-cell')).length, 4, 'compact conclusion limits grid exposes all 4 numeric caps');
if (process.platform !== 'darwin') {
  for (const label of ['macOS 菜单栏', '菜单栏：其它 Agent 最多几个', '菜单栏快捷键', '重启菜单栏']) {
    assert.equal(recBody.all().find(el => el.options.text === label), undefined, label + ' is hidden off macOS');
  }
}
const manySegRow = recBody.all().find(el => el.classList.contains('ad-row') && el.all().some(c => c.classList.contains('ad-seg--many')));
assert.ok(manySegRow?.classList.contains('ad-row--stack'), 'rows with .ad-seg--many receive .ad-row--stack without CSS :has()');
assert.equal(DEFAULTS.resultMax, 350);
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 240 })).resultMax, 350, 'old default migrates');
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 600 })).resultMax, 600, 'custom maximum survives');
assert.equal(syncDelegationSettings(deepMerge(DEFAULTS, { resultMax: 240, resultMaxDefault350: true })).resultMax, 240, 'migration only runs once');
console.log('PASS More settings: collapsed detail controls, visible common actions and one-time result-length migration');

const delegateGroups = delBody.all().filter(el => el.classList.contains('ad-delegate-agent'));
assert.equal(delegateGroups.length, 13);
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
assert.deepEqual(terminalSelect.children.map(el => el.attrs.value), ['auto', 'terminal', 'iterm', 'warp', 'ghostty', 'cmux', 'tmux', 'wezterm', 'kitty', 'alacritty', 'tern', 'herdr']);
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
  t2.renderDelegate(mBody);
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
  t2.renderDelegate(mBody2);
  const openAllBtn = mBody2.all().find((el) => el.classList.contains('ad-linkbtn') && el.options.text === '全部开启');
  await openAllBtn.onclick();
  assert.equal(s.models.enabled.length, 3);
  const mBody3 = new Element();
  t2.renderDelegate(mBody3);
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
  assert.ok(upgraded.models.enabled.includes('minimax-default') && upgraded.models.enabled.includes('gemini-default'), 'upgraded vault seeds new built-in *-default models once');
  assert.equal(upgraded.delegate.dsh.model, 'dsh-default', 'legacy built-in DSH preset migrates to dsh-default');
  assert.equal(upgraded.models.defaultByAgent.dsh, 'dsh-default');
  assert.equal(upgraded.dshDefaultSeeded, true);

  // Explicit user override afterwards survives re-sync, as do custom third-party DSH models on upgrade.
  upgraded.delegate.dsh.model = 'deepseek-v4-pro';
  upgraded.models.enabled = upgraded.models.enabled.filter((id) => id !== 'dsh-default' && id !== 'minimax-default');
  syncDelegationSettings(upgraded, upgraded);
  assert.equal(upgraded.delegate.dsh.model, 'deepseek-v4-pro', 'explicit selection after migration is preserved');
  assert.ok(!upgraded.models.enabled.includes('dsh-default'), 'subsequent sync respects user turning off dsh-default');
  assert.ok(!upgraded.models.enabled.includes('minimax-default'), 'subsequent sync respects user turning off seeded *-default models');

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

  // jumpToAgentModels expands both the Agent card and its embedded Available models sub-accordion.
  s.ui.delegateGroups.dsh.open = false;
  s.ui.modelGroups.dsh.open = false;
  t2.subOpen['models-dsh'] = false;
  t2.jumpToAgentModels('dsh');
  assert.equal(s.ui.delegateGroups.dsh.open, true);
  assert.equal(s.ui.modelGroups.dsh.open, true);
  assert.equal(t2.subOpen['models-dsh'], true);
  assert.equal(t2._scrollToModels, 'dsh');
  console.log('PASS closing models auto-saves immediately, never snaps back, seeds dsh-default once on upgrade, and jumpToAgentModels expands target group');
}

// Search and capability filters: isolate matching Agents, expand temporarily without mutating saved folds, and restore.
{
  const prevCodexOpen = plugin.settings.ui.delegateGroups.codex.open;
  const prevCodexModelsOpen = tab.subOpen['models-codex'];
  plugin.settings.ui.delegateGroups.codex.open = false;
  tab.subOpen['models-codex'] = false;
  tab.search = 'GPT-6.1 Sol';
  const filteredBody = new Element();
  tab.renderDelegate(filteredBody);
  const shownAgents = filteredBody.all().filter(el => el.classList.contains('ad-delegate-agent'));
  assert.deepEqual(shownAgents.map(el => el.dataset.agent), ['codex'], 'search filters Agent list to matching models');
  assert.equal(shownAgents[0].open, true, 'matching Agent card opens temporarily while searching');
  assert.equal(shownAgents[0].all().find(el => el.classList.contains('ad-modelgroup'))?.open, true, 'matching Available models opens temporarily while searching');
  assert.equal(filteredBody.all().find(el => el.classList.contains('ad-delegate-passive')), undefined, 'passive section hides while filtering models');
  assert.equal(plugin.settings.ui.delegateGroups.codex.open, false, 'search auto-expand never mutates persisted delegateGroups state');
  assert.equal(tab.subOpen['models-codex'], false, 'search auto-expand never mutates subOpen state');

  tab.search = 'no-such-model-xyz';
  const emptyBody = new Element();
  tab.renderDelegate(emptyBody);
  assert.ok(emptyBody.all().find(el => el.classList.contains('ad-empty') && el.options.text === '没有符合条件的模型'), 'shows empty notice when no models match');

  tab.search = '';
  const restoredBody = new Element();
  tab.renderDelegate(restoredBody);
  const restoredCodex = restoredBody.all().find(el => el.classList.contains('ad-delegate-agent') && el.dataset.agent === 'codex');
  assert.equal(restoredCodex.open, false, 'clearing search restores collapsed Agent state');
  assert.equal(restoredCodex.all().find(el => el.classList.contains('ad-modelgroup'))?.open, false, 'clearing search restores collapsed Available models state');
  plugin.settings.ui.delegateGroups.codex.open = prevCodexOpen;
  tab.subOpen['models-codex'] = prevCodexModelsOpen;
  console.log('PASS model search/filtering expands matches non-destructively and restores fold state');
}

// Redesigned Delegation tab invariants: order sync, summary pills, cwd tucked under More settings, custom ACP switches.
{
  const savedCwd = plugin.settings.ui.agentOrders;
  plugin.settings.ui.agentOrders = { ...(savedCwd || {}), delegation: ['hermes', 'codex', 'claude'] };
  plugin.settings.customAcpAgents = [{ id: 'kiro', name: 'Kiro', command: 'kiro-cli', args: 'acp', enabled: true, autoApprove: true }];
  const reorderedBody = new Element();
  tab.renderDelegate(reorderedBody);
  const orderedAgents = reorderedBody.all().filter(el => el.classList.contains('ad-delegate-agent')).map(el => el.dataset.agent);
  assert.deepEqual(orderedAgents.slice(0, 3), ['hermes', 'codex', 'claude'], 'Agent 配置 accordion follows delegation order');

  for (const card of reorderedBody.all().filter(el => el.classList.contains('ad-delegate-agent'))) {
    const pills = card.all().filter(el => el.classList.contains('ad-delegate-pill'));
    assert.ok(pills.length >= 2, `${card.dataset.agent} summary displays live model/mode pills`);
    const cwdLabel = card.all().find(el => el.options.text === '工作目录');
    assert.ok(cwdLabel && moreAncestor(cwdLabel), `${card.dataset.agent} 工作目录 is tucked inside 更多设置`);
  }

  const customItem = reorderedBody.all().find(el => el.classList.contains('ad-custom-acp__item'));
  assert.ok(customItem, 'custom ACP entry renders inside Agent 配置 card');
  assert.ok(customItem.all().some(el => el.classList.contains('ad-switch')), 'custom ACP uses unified ad-switch toggle');
  assert.equal(customItem.all().filter(el => el.tag === 'input' && el.attrs?.type === 'checkbox').length, 0, 'custom ACP does not render raw checkbox');
  plugin.settings.customAcpAgents = [];
  plugin.settings.ui.agentOrders = savedCwd;
  console.log('PASS redesigned Delegation layout: synced order, summary pills, cwd inside More settings, unified custom ACP toggle');
}

// Verify tab placement: AI 协作回顾 lives under Recording; 外部 Agent 接入（MCP / CLI）lives under Experiments (not Dreaming).
{
  const recPage = new Element();
  tab.renderRecord(recPage);
  assert.ok(recPage.all().some(el => el.options.text === 'AI 协作回顾'), 'Recording tab includes AI 协作回顾 toggle');

  const expPage = new Element();
  tab.renderExperimental(expPage);
  assert.ok(expPage.all().some(el => el.options.text === '外部 Agent 接入（MCP / CLI）'), 'Experiments tab hosts Memory MCP card');
  assert.ok(!expPage.all().some(el => el.options.text === 'AI 协作回顾'), 'Experiments tab no longer contains AI 协作回顾');

  const pDream = {
    ...plugin,
    app: {},
    dreaming: {
      storeMode: false,
      dir: 'Agent Deck/记忆',
      busy: false,
      progress: { phase: 'idle', message: '' },
      sharing: { busy: false, status: '' },
    },
  };
  const dreamTab = new AgentDeckSettingsTab({}, pDream);
  const dreamPage = new Element();
  dreamTab.renderDream(dreamPage);
  dreamTab.hide();
  assert.ok(!dreamPage.all().some(el => el.options.text === '外部 Agent 接入（MCP / CLI）'), 'Dreaming tab no longer contains Memory MCP card');
  console.log('PASS tab placement: AI 协作回顾 under Recording, Memory MCP under Experiments');
}

// Verify every Settings tab renders a top TOC and clicking an item scrolls and expands <details> when needed.
{
  const expectedTocByTab = {
    delegate: ['默认委派到', 'Agent 配置', '路由与发送规则', '多任务与终端'],
    record: ['来源与扫描', '日记与归档', '任务结论与总结模型', '展示与维护'],
    dream: ['记忆库工作区', 'Dreaming · 长期记忆', '与其他 Agent 共享记忆'],
    experimental: ['工具与隔离', '本地全文索引', '外部 Agent 提示词', '本机客户端接入', '手动复制配置'],
    about: ['Agent Deck', '界面语言', '核心结构与信息流转', '常用操作', '版本与支持'],
  };
  const tocTab = new AgentDeckSettingsTab({}, {
    ...plugin,
    vaultPath: '/tmp/ad-toc-test',
    manifest: { version: '1.13.38' },
    usage: { files: new Map(), meta: new Map(), errors: [] },
    app: {},
    dreaming: {
      storeMode: false,
      dir: 'Agent Deck/记忆',
      busy: false,
      progress: { phase: 'idle', message: '' },
      sharing: { busy: false, status: '' },
    },
    contextCore: {
      listMcpClients: () => [],
      installMcpClient: () => {},
      uninstallMcpClient: () => {},
      peekVaultIndexStatus: () => ({ exists: false, ftsEngine: 'sqlite-fts5' }),
    },
  });
  for (const [tabId, labels] of Object.entries(expectedTocByTab)) {
    tocTab.tab = tabId;
    tocTab.containerEl = new Element();
    tocTab.containerEl.ownerDocument = { activeElement: null };
    tocTab.display();
    const tocEl = tocTab.containerEl.all().find(el => el.classList.contains('ad-set-toc'));
    assert.ok(tocEl && !tocEl.hidden, `${tabId} renders top TOC bar`);
    const btns = tocEl.all().filter(el => el.classList.contains('ad-set-toc__item'));
    assert.deepEqual(btns.map(b => b.options.text), labels, `${tabId} TOC lists expected section labels`);
    const lastIdx = btns.length - 1;
    const scrolled = [];
    const targetCard = tocTab._tocItems.at(-1)?.el;
    assert.ok(targetCard, `${tabId} TOC target element exists`);
    targetCard.scrollIntoView = (opts) => scrolled.push(opts);
    btns[lastIdx].onclick();
    assert.equal(scrolled.length, 1, `${tabId} TOC jump scrolls to target section`);
    if (tabId === 'experimental') {
      assert.equal(targetCard.open, true, 'experimental TOC jump opens collapsed details section');
    }
  }
  tocTab.hide();
  console.log('PASS all 5 Settings tabs render top TOC with jump behavior');
}
