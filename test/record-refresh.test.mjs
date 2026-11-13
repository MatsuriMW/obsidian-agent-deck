import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
const stub=`export class WidgetType{}; export const Decoration={set:r=>r,replace:spec=>({range:(from,to)=>({from,to,spec})}),line:spec=>({range:from=>({from,to:from,spec})}),widget:spec=>({range:from=>({from,to:from,spec})})}, EditorView={}, StateEffect={define:()=>({})}, StateField={define:c=>c}, ViewPlugin={fromClass:()=>null}, foldedRanges=()=>{}, unfoldEffect={};`;
const bundle=await esbuild.build({entryPoints:[path.resolve(import.meta.dirname,'../src/record-display.js')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'cm-surface',setup(b){b.onResolve({filter:/^@codemirror\//},a=>({path:a.path,namespace:'cm'}));b.onLoad({filter:/.*/,namespace:'cm'},()=>({contents:stub}))}}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-refresh-'));
try{
 const file=path.join(dir,'display.mjs');fs.writeFileSync(file,bundle.outputFiles[0].text);
 const {aiRecordDisplayExtension}=await import(pathToFileURL(file));
 const plugin={settings:{},saveSettings(){},refreshUI(){}};
 const [field]=aiRecordDisplayExtension(plugin,{});
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
 console.log('PASS selection-only transactions reuse AI record decorations');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
