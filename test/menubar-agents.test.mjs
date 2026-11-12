import assert from 'node:assert/strict';
import { visibleMenuAgents } from '../src/constants.js';
const agents = [
 {id:'claude',primary:true,running:0,waiting:0},
 {id:'codex',primary:false,running:1,waiting:0},
 {id:'workbuddy',primary:false,running:0,waiting:2},
 {id:'dsh',primary:true,running:0,waiting:0},
 {id:'antigravity',primary:false,running:0,waiting:6},
];
assert.deepEqual(visibleMenuAgents(agents).map(x=>x.id),['claude','codex','dsh']);
assert.deepEqual(visibleMenuAgents(agents,'all'),agents);
assert.equal(agents.length,5);
agents[1].running=0;
assert.deepEqual(visibleMenuAgents(agents).map(x=>x.id),['claude','dsh']);
console.log('PASS menu defaults to primary/running agents, removes stopped agents and can show all');
