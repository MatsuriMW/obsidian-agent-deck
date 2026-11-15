import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
const stub=`export class WidgetType{}; export const Decoration={set:r=>r,replace:spec=>({range:(from,to)=>({from,to,spec})}),line:spec=>({range:from=>({from,to:from,spec})}),widget:spec=>({range:from=>({from,to:from,spec})})}, EditorView={}, EditorState={transactionFilter:{of:f=>f}}, StateEffect={define:()=>{const t={of:value=>({type:t,value,is:x=>x===t})};return t}}, StateField={define:c=>c}, ViewPlugin={fromClass:c=>c}, foldedRanges=s=>({between:(a,b,fn)=>{for(const f of s.folds||[])fn(f.from,f.to)}}), foldEffect={of:value=>({type:foldEffect,value,is:x=>x===foldEffect})}, unfoldEffect={of:value=>({type:unfoldEffect,value,is:x=>x===unfoldEffect})};`;
const bundle=await esbuild.build({stdin:{contents:"export * from './src/record-display.js'; export {foldEffect,unfoldEffect} from '@codemirror/language';",resolveDir:path.resolve(import.meta.dirname,'..')},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'cm-surface',setup(b){b.onResolve({filter:/^@codemirror\//},a=>({path:a.path,namespace:'cm'}));b.onLoad({filter:/.*/,namespace:'cm'},()=>({contents:stub}))}}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-refresh-'));
try{
 const file=path.join(dir,'display.mjs');fs.writeFileSync(file,bundle.outputFiles[0].text);
 const {aiRecordDisplayExtension,setRecordsOpenEffect,foldEffect,unfoldEffect}=await import(pathToFileURL(file));
 const plugin={settings:{},saveSettings(){},refreshUI(){}};
 const [field,guardHiddenTail,UnfoldPlugin]=aiRecordDisplayExtension(plugin,{});
 const state={doc:{toString:()=>'',line:()=>({from:0,to:0})}};
 const value=field.create(state);
 const after=field.update(value,{state,effects:[],docChanged:false,selection:{}});
 assert.equal(after,value,'moving the cursor must reuse record decorations instead of parsing the whole note');

 const text='- DOING task ^ad-test\n  - 🔗 [Codex](codex://threads/11111111-2222-3333-4444-555555555555)\n  - 💬 result';
 const lines=text.split('\n');
 const doc={toString:()=>text,line(n){const from=lines.slice(0,n-1).reduce((sum,l)=>sum+l.length+1,0);return {from,to:from+lines[n-1].length}}};
 plugin.settings.aiRecordExpanded={'ad-test':true};
 plugin.redundantSessionLink=()=>1;
 const decos=field.create({doc}).decorations;
 const link=doc.line(2);
 assert.ok(decos.some(r=>r.from<=link.from&&r.to>=link.to),'duplicate link stays hidden even with history expanded');
 assert.equal(decos.find(r=>r.spec.widget)?.spec.widget.count,1,'duplicate binding is excluded from the record count');
 plugin.redundantSessionLink=()=>-1;
 const fallback=field.create({doc}).decorations;
 assert.ok(!fallback.some(r=>r.from<=link.from&&r.to>=link.to),'a unique fallback link stays visible');
 assert.ok(text.includes('codex://threads/'),'display filtering keeps source binding unchanged');
 const briefLines=['- DOING Brief ^ad-brief','  - 💬 任务：缓存、兼容；结论：修复、待发布','  - 💬 有用户子块的回复','    - TODO 用户的下一步'];
 const briefDoc={toString:()=>briefLines.join('\n'),line(n){const from=briefLines.slice(0,n-1).reduce((sum,l)=>sum+l.length+1,0);return {from,to:from+briefLines[n-1].length}}};
 plugin.settings.aiRecordExpanded={};
 const closedBrief=field.create({doc:briefDoc}).decorations;
 assert.ok(closedBrief.some(r=>r.spec.class?.includes('ad-record-brief-clamped')),'closed brief task/result gets the three-line display class');
 const protectedLine=briefDoc.line(3);
 assert.ok(!closedBrief.some(r=>r.from<=protectedLine.from&&r.to>=protectedLine.to),'the reply above user descendants is never hidden');
 plugin.settings.aiRecordExpanded={'ad-brief':true};
 assert.ok(!field.create({doc:briefDoc}).decorations.some(r=>r.spec.class?.includes('ad-record-brief-clamped')),'expanding history removes the line clamp');

 const layoutLines=['个人笔记','','<!-- agent-deck:layout:start -->','','---','<!-- agent-deck:section:active:heading -->','## 正在做','- DOING 跑着','','<!-- agent-deck:section:active:end -->','---','<!-- agent-deck:layout:end -->'];
 const layoutDoc={toString:()=>layoutLines.join('\n'),line(n){const from=layoutLines.slice(0,n-1).reduce((sum,l)=>sum+l.length+1,0);return {from,to:from+layoutLines[n-1].length}}};
 const layoutDecos=field.create({doc:layoutDoc}).decorations;
 const startLine=layoutDoc.line(3), ruleLine=layoutDoc.line(5), headingComment=layoutDoc.line(6), headingLine=layoutDoc.line(7);
 assert.ok(layoutDecos.some(r=>r.from<=startLine.from&&r.to>=startLine.to),'layout start comment is hidden');
 assert.ok(layoutDecos.some(r=>r.from<=headingComment.from&&r.to>=headingComment.to),'section heading comment is hidden');
 assert.ok(!layoutDecos.some(r=>r.from<=ruleLine.from&&r.to>ruleLine.from),'horizontal rule line start stays outside replacement range');
 assert.ok(!layoutDecos.some(r=>r.from<=headingLine.from&&r.to>headingLine.from),'section heading line start stays outside replacement range');

 const makeDoc=src=>{
  const arr=src.split('\n');
  const starts=[];let off=0;for(const l of arr){starts.push(off);off+=l.length+1;}
  return {
   length:src.length,
   toString:()=>src,
   line(n){const from=starts[n-1];return {number:n,from,to:from+arr[n-1].length,text:arr[n-1]};},
   lineAt(pos){let i=0;while(i+1<starts.length&&starts[i+1]<=pos)i++;return this.line(i+1);},
  };
 };
 const foldDoc=makeDoc('- DOING fold task ^ad-fold\n  - 💬 older\n  - 💬 latest');
 plugin.settings.aiRecordDisplay='latest1';
 plugin.settings.aiRecordExpanded={'ad-fold':true};
 const foldOpenTr={docChanged:false,effects:[foldEffect.of({from:foldDoc.line(1).to,to:foldDoc.line(3).to})],startState:{doc:foldDoc,selection:{main:{empty:true,head:0}}},selection:null,scrollIntoView:false};
 const collapsedTr=guardHiddenTail(foldOpenTr);
 assert.ok(collapsedTr.effects.some(e=>e.is(setRecordsOpenEffect)&&e.value.open===false&&e.value.keys.includes('ad-fold')),'native fold on an expanded latest1 group collapses to latest1 instead of folding the task');
 plugin.settings.aiRecordExpanded={};
 const passedFoldTr=guardHiddenTail(foldOpenTr);
 assert.equal(passedFoldTr,foldOpenTr,'native fold passes through once the group is already collapsed to latest1');

 const dispatched=[];
 const mockView={state:{doc:foldDoc,folds:[{from:foldDoc.line(1).to,to:foldDoc.line(3).to}]},dispatch:spec=>dispatched.push(spec)};
 const up=new UnfoldPlugin(mockView);up.destroy();up.run(mockView);
 assert.equal(dispatched.length,0,'parent task fold (including logseq-style-fold marker lines) is never forcefully unfolded');
 mockView.state.folds=[{from:foldDoc.line(2).from,to:foldDoc.line(3).to}];
 up.run(mockView);
 assert.equal(dispatched.length,1,'folds starting inside the AI record range are still unfolded');
 console.log('PASS selection-only transactions reuse AI record decorations and native fold interop');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
