import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { AGENT_ORDER } from '../src/constants.js';
import { recommendPrimaryAgents } from '../src/settings-agents.js';
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('  async initializePrimaryAgents()'), source.indexOf('  async scanNow('));
function fixture(wait = async () => {}) {
  let scans = 0, saved = 0;
  const meta = new Map();
  for (const [agent, count] of [['codex', 5], ['claude', 4], ['qoder', 3], ['dsh', 2]]) for (let n = 0; n < count; n++) meta.set(agent+n, {sid:agent+n, agent, lastAt:Date.now()-1000});
  class AgentUsage {
    constructor(options) { assert.deepEqual(options.historyAgents, AGENT_ORDER); Object.assign(this, { meta, files:new Map(), titles:new Map(), subs:new Map(), archived:new Set(), archivedClaude:new Set(), errors:[] }); }
    async scan(options) { scans++; assert.equal(options.strictSince,true); assert.ok(Math.abs(options.since-(Date.now()-30*86400000))<1000); await wait(); return new Set(['today']); }
  }
  const p = vm.runInNewContext('({'+method+'})', {AgentUsage,AGENT_ORDER,recommendPrimaryAgents});
  Object.assign(p, { settings:{primaryAgentsInitialized:false,primaryAgents:[]}, app:{setting:{}}, settingTab:{}, agentEnabled:()=>true,
    usage:{files:new Map(),meta:new Map(),titles:new Map(),subs:new Map(),archived:new Set(),archivedClaude:new Set()}, saveSettings:async()=>saved++ });
  return {p, scans:()=>scans, saved:()=>saved};
}
test('first install scans all agents once, chooses the top three, and persists without overwriting later choices', async () => {
  const f=fixture(); await f.p.initializePrimaryAgents();
  assert.deepEqual(Array.from(f.p.settings.primaryAgents),['codex','claude','qoder']);
  assert.equal(f.p.settings.primaryAgentsInitialized,true); assert.equal(f.saved(),1);
  f.p.settings.primaryAgents=['dsh']; await f.p.initializePrimaryAgents();
  assert.equal(f.scans(),1); assert.deepEqual(f.p.settings.primaryAgents,['dsh']);
});
test('manual selection or unloading while history is being read cancels the automatic recommendation', async () => {
  for (const unload of [false,true]) {
    let release; const wait=new Promise(resolve=>{release=resolve}); const f=fixture(()=>wait);
    const pending=f.p.initializePrimaryAgents();
    if(unload) f.p._unloaded=true; else {f.p.settings.primaryAgents=['opencode'];f.p.settings.primaryAgentsInitialized=true;}
    release(); await pending;
    assert.equal(f.saved(),0);
    if(!unload) assert.deepEqual(f.p.settings.primaryAgents,['opencode']);
  }
});
