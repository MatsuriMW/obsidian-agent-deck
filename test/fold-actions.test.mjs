import assert from 'node:assert/strict';
import {RECORD_FOLD_COMMANDS,foldTargets} from '../src/fold-actions.js';
const groups=[{key:'parent',line:0,records:[1,2,3,4]},{key:'child',line:2,records:[3,4]},{key:'next',line:8,records:[9]}];
assert.equal(foldTargets(groups,3)[0].key,'child');
assert.equal(foldTargets(groups,0)[0].key,'parent');
assert.equal(foldTargets(groups,6).length,0);
assert.equal(foldTargets(groups,6,true).length,3);
assert.equal(RECORD_FOLD_COMMANDS['bullet:unfold'].open,true);
assert.equal(RECORD_FOLD_COMMANDS['editor:unfold-all'].all,true);
console.log('PASS native/Bullet command mapping without Logseq dependency and nested AI record fold targeting');

assert.ok(!Object.keys(RECORD_FOLD_COMMANDS).some(id=>id.startsWith("logseq-style-fold:")));

const groupsWithSub = [{ key: 'parent', line: 0, records: [1, 2], recordEndLine: 4 }];
assert.equal(foldTargets(groupsWithSub, 4)[0]?.key, 'parent', 'cursor inside absorbed subagent subtree still targets parent fold group');
