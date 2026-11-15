import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as J from '../src/journal.js';
import {dayKeyToday} from '../src/constants.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const getMethod=(name,next,globals={})=>{const start=source.indexOf('  '+name+'('),end=source.indexOf(next,start);return runInNewContext('({'+source.slice(start,end)+'})',{J,dayKeyToday,parseLinkLine:raw=>J.parseLink(raw)||{},...globals})[name]};
const sid='11111111-2222-4333-8444-555555555555';
test('editor keeps its token display when the progress provider cannot represent the bound session',()=>{
 const owns=getMethod('nautilusOwnsLine','  // Hide',{NAUTILUS_LINE_RE:/^\s*- (DOING|TOREVIEW)/});
 const n={settings:{lineProgress:true,showAi:true},lineStatus:()=>null};const p={settings:{},app:{plugins:{plugins:{'nautilus-spiral':n}}}};
 const raw='- DOING 🤖 测试 ^agy-journal-cleanup-0123456789',s={sid,agent:'codex',tokens:1234};
 assert.equal(owns.call(p,raw,s),false);
 n.lineStatus=()=>({sid:'other-session',tok:1234});assert.equal(owns.call(p,raw,s),false);
 n.lineStatus=()=>({sid,tok:0});assert.equal(owns.call(p,raw,s),false);
 n.lineStatus=()=>({sid,tok:1234});assert.equal(owns.call(p,raw,s),true);
});
test('inactive session metadata retains token counts on both linked and automatic task lines',()=>{
 const lineMap=getMethod('lineMap','  jobAtLine');const settings={};settings.autoLogState={[dayKeyToday(settings)]:{[sid]:{blockId:'agy-journal-cleanup-0123456789'}}};
 const p={settings,jobs:{},_lineMaps:{},usage:{meta:new Map([[sid,{sid,agent:'codex',state:'quiet',out:100,fresh:200,cached:1000}]]),liveSessions:()=>[]}};
 const auto={toString:()=>'- DOING 🤖 测试 ^agy-journal-cleanup-0123456789'};
 assert.equal(lineMap.call(p,'auto.md',auto).sessionByParent.get(0).tokens,300);
 const linked={toString:()=>'- DOING 🤖 测试\n'+J.linkLine('  ','codex','测试',sid)};
 assert.equal(lineMap.call(p,'linked.md',linked).sessionByParent.get(0).tokens,300);
});
