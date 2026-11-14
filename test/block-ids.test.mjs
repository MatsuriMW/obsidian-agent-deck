import assert from 'node:assert/strict';
import { adBlockIdRanges, redirectHiddenTailTransaction } from '../src/ai-records.js';
const text = '- DOING 任务 ^ad-01a1d0\n\t- 手写备注\n- PAUSED 第二件 ^ad-26d277\n- 保留其他插件 ^nw-123456\n```md\n- 文档示例 ^ad-example\n```\n';
const ranges = adBlockIdRanges(text);
assert.deepEqual(ranges.map(({from,to})=>text.slice(from,to)),[' ^ad-01a1d0',' ^ad-26d277']);
assert.equal(text.includes('^ad-01a1d0'),true);
assert.equal(adBlockIdRanges('段落文字 ^ad-abcdef').length,1);
assert.equal(adBlockIdRanges('文字中 ^ad-abcdef 还有正文').length,0);
assert.equal(adBlockIdRanges('- 普通标题').length,0);
console.log('PASS hide real Agent Deck block IDs without changing source, other IDs or code examples');
const uuid = '5031567a-cc11-4b71-a9ec-8a290ee39dc9';
assert.equal(adBlockIdRanges(`- TODO 任务 ^${uuid}`).length,1);
assert.equal(adBlockIdRanges('- DELEGATED 开头大俗，结尾大雅 ^ee0d256c-68d2-41f7-ad35-6e04c56a844b#').length,1);
assert.equal(adBlockIdRanges('- TODO 任务 ^custom',new Set(['custom'])).length,1);
assert.equal(adBlockIdRanges('- TODO 任务 ^custom').length,0);
assert.equal(adBlockIdRanges(`- 示例 \`^${uuid}\``).length,0);
assert.equal(adBlockIdRanges(`~~~md\n- 示例 ^${uuid}\n~~~`).length,0);

assert.equal(adBlockIdRanges(`  - 🔗 [DeepSeek Harness：任务](dsh://open) \`${uuid}\``).length,1);
assert.equal(adBlockIdRanges(`- 手写代码 \`${uuid}\``).length,0);

const lineWithId = '- DELEGATED 开头大俗，结尾大雅 ^ee0d256c-68d2-41f7-ad35-6e04c56a844b';
const visibleEnd = lineWithId.indexOf(' ^ee0d256c');
assert.deepEqual(redirectHiddenTailTransaction(lineWithId, new Set(), {
  change: { from: lineWithId.length, to: lineWithId.length, insert: '#' },
}), {
  change: { from: visibleEnd, to: visibleEnd, insert: '#' },
  head: visibleEnd + 1,
});
assert.deepEqual(redirectHiddenTailTransaction(lineWithId, new Set(), {
  change: { from: visibleEnd, to: visibleEnd, insert: '\n- ' },
}), {
  change: { from: lineWithId.length, to: lineWithId.length, insert: '\n- ' },
  head: lineWithId.length + 3,
});
assert.deepEqual(redirectHiddenTailTransaction(lineWithId, new Set(), {
  prevHead: 0,
  nextHead: lineWithId.length,
  selectionEmpty: true,
}), { head: visibleEnd });
