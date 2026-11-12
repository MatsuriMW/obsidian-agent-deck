import assert from 'node:assert/strict';
import { runningTaskLines } from '../src/journal.js';
const text='- DOING 运行中 ^ad-run\n- TOREVIEW 等待 ^ad-wait\n- DONE 已结束 ^ad-done\n- DOING 委派中 ^ad-job\n- TODO 人工任务\n';
const sessions=new Map([[0,{state:'run'}],[1,{state:'wait'}],[2,{state:'run'}]]);
assert.deepEqual(runningTaskLines(text,sessions,[{blockId:'ad-job',state:'starting'}]).map(t=>t.line),[0,3]);
assert.deepEqual(runningTaskLines(text,new Map()),[]);
console.log('PASS jump targets include running/beginning projects and exclude waiting, finished and unbound manual tasks');
