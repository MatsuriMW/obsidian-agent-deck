import assert from 'node:assert/strict';
import { organizeAIJournal } from '../src/organize-journal.js';
const sid='11111111-2222-3333-4444-555555555555';
const text=`# 日记\n手写正文\n- DOING 活动 ^ad-active\n  - 💬 回复\n  - 手写子项\n- DONE 完成 ^ad-done\n  - 💬 成果\n- TODO 手动任务\n- PAUSED 已归档 ^custom\n  - 🔗 [Codex](codex://threads/${sid})\n\n## 备注\n保留\n\`\`\`md\n- DONE 示例 ^ad-code\n\`\`\`\n`;
const options={archived:new Set([sid])};
let result=organizeAIJournal(text,'active',options);
assert.equal(result.count,1);assert.ok(result.text.includes('## AI · 进行中\n\n### DOING\n\n- DOING 活动'));assert.ok(result.text.includes('  - 手写子项'));
assert.equal(organizeAIJournal(result.text,'active',options).text,result.text);
result=organizeAIJournal(result.text,'done',options);
assert.equal(result.count,2);assert.ok(result.text.includes('- DONE 已归档 ^custom'));assert.ok(result.text.includes('- TODO 手动任务'));assert.ok(result.text.includes('## 备注\n保留'));assert.ok(result.text.includes('- DONE 示例 ^ad-code'));
assert.equal(organizeAIJournal(result.text,'done',options).text,result.text);
const multi=`- PAUSED 多会话 ^ad-multi\n  - 🔗 [Codex](codex://threads/${sid})\n  - 🔗 [Claude](claude://resume?session=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)\n`;
assert.equal(organizeAIJournal(multi,'done',options).count,0);
const nested='- 手写父项\n  - TODO AI 子项 ^ad-child\n    - 💬 记录\n  - 手写兄弟\n';
result=organizeAIJournal(nested,'active');assert.ok(result.text.includes('- 手写父项\n  - 手写兄弟'));assert.ok(result.text.includes('\n- TODO AI 子项 ^ad-child\n  - 💬 记录'));
console.log('PASS whole-block grouping, archived DONE, multi-session safety, fenced examples, nested/manual preservation and idempotence');

const example='```md\n## AI · 进行中\n```\n- DOING 工作 ^ad-real\n';
const safe=organizeAIJournal(example,'active').text;
assert.ok(safe.startsWith('```md\n## AI · 进行中\n```'));
assert.equal((safe.match(/## AI · 进行中/g)||[]).length,2);

assert.ok(organizeAIJournal(`- CANCELLED 已取消 ^ad-cancel\n  - 🔗 [Codex](codex://threads/${sid})\n`,'done',options).text.includes('- CANCELLED 已取消'));

const unsorted='- PAUSED 暂停 ^ad-p\n- DOING 一轮 ^ad-one\n- TOREVIEW 待看 ^ad-review\n- DOING 十轮 ^ad-ten\n';
const sorted=organizeAIJournal(unsorted,'active',{turns:new Map([['ad-one',1],['ad-ten',10]])}).text;
assert.ok(sorted.indexOf('### DOING')<sorted.indexOf('### TOREVIEW'));
assert.ok(sorted.indexOf('### TOREVIEW')<sorted.indexOf('### PAUSED'));
assert.ok(sorted.indexOf('十轮')<sorted.indexOf('一轮'));
assert.equal(organizeAIJournal(sorted,'active',{turns:new Map([['ad-one',1],['ad-ten',10]])}).text,sorted);
