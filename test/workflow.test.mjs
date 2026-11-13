import assert from 'node:assert/strict';
import { destinations, defaultDestination, activeJob, canOpenClient, executionStatus, workspaceLabel } from '../src/workflow.js';
assert.deepEqual(destinations('antigravity').map(x=>x.id),['obsidian','background']);
assert.deepEqual(destinations('workbuddy').map(x=>x.id),['desktop']);
assert.ok(destinations('dsh').some(x=>x.id==='desktop'));
assert.ok(!destinations('claude').some(x=>x.id==='obsidian'));
assert.equal(canOpenClient({agent:'antigravity',transport:'acp'}),false);
assert.equal(canOpenClient({agent:'antigravity'}),true);
assert.equal(defaultDestination({settings:{delegate:{claude:{openDesktop:true}}}},'claude'),'desktop');
assert.equal(executionStatus({agent:'claude',destination:'desktop',state:'running'}),'首轮执行中，结束后打开桌面');
assert.equal(executionStatus({agent:'workbuddy',handoff:true}),'等待你在客户端粘贴发送');
assert.equal(executionStatus({state:'done'}),'本轮结束');
assert.equal(activeJob({state:'needs-approval'}),true);
console.log('PASS destinations expose real capabilities and honest lifecycle states');

assert.equal(workspaceLabel('/Users/me/claude/agent-deck'),'agent-deck');
assert.equal(workspaceLabel('/Documents/Codex/1-5031567a-cc11-4b71-a9ec-8a290ee39dc9'),'会话工作区');
