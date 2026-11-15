import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DEFAULTS,deepMerge} from '../src/constants.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function method(name,next){
 const start=source.indexOf(`  async ${name}(`),end=source.indexOf(`  ${next}(`,start);
 assert.ok(start>=0&&end>start,`${name} method exists`);
 return runInNewContext('({'+source.slice(start,end)+'})',{DASHBOARD_TYPE:'agent-deck-dashboard'})[name];
}
test('review is enabled by default and existing off choices survive settings migration',()=>{
 assert.equal(DEFAULTS.experimentalDashboard,true);
 assert.equal(deepMerge(DEFAULTS,{experimentalDashboard:false}).experimentalDashboard,false);
});
test('disabled review refuses opening through buttons, protocol calls and restored commands',async()=>{
 const activate=method('activateDashboard','openSettings');let opened=0;
 const p={settings:{experimentalDashboard:false},app:{workspace:{getLeavesOfType(){opened++;return []}}}};
 await activate.call(p);assert.equal(opened,0);
});
test('switching review off saves the choice, closes review tabs, refreshes entries and preserves data',async()=>{
 const set=method('setExperimentalDashboard','async activateDashboard');
 const projects={sid:'Project.md'};let saved=0,closed=0,refreshed=0;
 const p={settings:{experimentalDashboard:true,dashboardProjects:projects},saveSettings:async()=>{saved++},refreshUI(){refreshed++},app:{workspace:{getLeavesOfType:()=>[{detach(){closed++}},{detach(){closed++}}]}}};
 await set.call(p,false);assert.equal(p.settings.experimentalDashboard,false);assert.equal(saved,1);assert.equal(closed,2);assert.equal(refreshed,1);assert.equal(p.settings.dashboardProjects,projects);
 await set.call(p,true);assert.equal(p.settings.experimentalDashboard,true);assert.equal(closed,2);
});
test('a failed settings write restores the choice without closing existing review tabs',async()=>{
 const set=method('setExperimentalDashboard','async activateDashboard');let closed=0;
 const p={settings:{experimentalDashboard:true},saveSettings:async()=>{throw Error('disk failure')},app:{workspace:{getLeavesOfType:()=>[{detach(){closed++}}]}}};
 await assert.rejects(set.call(p,false),/disk failure/);assert.equal(p.settings.experimentalDashboard,true);assert.equal(closed,0);
});
