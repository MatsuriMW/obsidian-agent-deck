import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as J from '../src/journal.js';
import {summarizeBackgroundReply} from '../src/background-summary.js';
const url='https://example.com/documentation/very-long-reference-page?section=tracking&token=example';
const file='/Users/example/Documents/Very Long Project Folder/implementation-notes.md';
test('brief summaries shorten address labels while keeping full working targets beyond the text cap',()=>{
 const out=J.syncSessionEntry('- DOING 测试 ^ad-links',{sid:'links',blockId:'ad-links',rounds:[{n:1,ask:'参考 '+url+' 完成修复',said:'已检查 `'+file+'`，尚未发布'}]}).text;
 assert.ok(out.includes(`[🔗](${url})`),out);assert.ok(out.includes('[🔗](file:///Users/example/Documents/Very%20Long%20Project%20Folder/implementation-notes.md)'),out);
 assert.ok(!out.includes('参考 '+url));assert.ok(out.includes('尚未发布'));
});
test('existing readable links stay readable and URLs with parentheses remain clickable',()=>{
 const out=J.oneSentenceConclusion(`已参考 [官方文档](${url}) 完成校验。`,90);
 assert.ok(out.includes(`[官方文档](${url})`),out);
 const nested='https://example.com/reference/function(call)?mode=complete';
 const text=J.oneSentenceConclusion('详见（'+nested+'），尚未发布。',90);
 assert.ok(text.includes('[🔗](https://example.com/reference/function%28call%29?mode=complete)'),text);assert.ok(text.includes('尚未发布'));
});
test('semantic background summaries preserve links instead of exposing their long labels',async()=>{
 const result=await summarizeBackgroundReply('原始回复',{},async()=>JSON.stringify({conclusion:'完成 '+url,changes:'修改 '+file.replaceAll(' ','-'),unfinished:'未发布'}));
 assert.ok(result.includes(`[🔗](${url})`),result);assert.ok(result.includes('[🔗](file:///'));assert.ok(result.includes('未发布'));
});
test('detailed excerpts keep original addresses as evidence',()=>{
 const out=J.syncSessionEntry('- DOING 测试 ^ad-links',{sid:'links',blockId:'ad-links',detail:'detailed',granularity:'round',rounds:[{n:1,ask:'查看 '+url,said:'完整地址：'+file}]}).text;
 assert.ok(out.includes(url));assert.ok(out.includes(file));
});
test('long numeric URL targets and a machine path followed by a colon remain intact',()=>{
 const value='https://example.com/document/'+ '12345678901234567890' +'?resource=unchanged';
 assert.ok(J.oneSentenceConclusion('已验证 '+value+'，尚未发布。',80).includes(`[🔗](${value})`));
 const path='/Users/example/claude/agent-deck';
 const out=J.summaryText('任务位置 '+path+': 完成修复',80);
 assert.ok(out.includes(`[🔗](file://${path}):`),out);
});
test('background summaries preserve consecutive spaces inside a file target',async()=>{
 const raw='/Users/example/Documents/Two  Spaces/implementation-notes.md';
 const result=await summarizeBackgroundReply('原文',{},async()=>JSON.stringify({conclusion:'完成',changes:'修改 `'+raw+'`',unfinished:'无'}));
 assert.ok(result.includes('file:///Users/example/Documents/Two%20%20Spaces/implementation-notes.md'),result);
});
