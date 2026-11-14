import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const stubs={
 obsidian:'export class ItemView{constructor(leaf){Object.assign(this,leaf)}registerEvent(){}};export class Menu{};export class Modal{};',
 './icons.js':'export function agentIcon(){};export function setLucide(){};export function stateIcon(){};',
 './lattice.js':'export function lattice(){};',
 './editor.js':'export const SESSION_MIME="test";'
};
const bundle=await esbuild.build({entryPoints:[path.join(root,'src/view.js')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'view-surfaces',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'ui'}:undefined);b.onLoad({filter:/.*/,namespace:'ui'},a=>({contents:stubs[a.path]}))}}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-view-'));
try{
 const file=path.join(dir,'view.mjs');fs.writeFileSync(file,bundle.outputFiles[0].text);
 const {AgentDeckView}=await import(pathToFileURL(file));
 globalThis.document={activeElement:null};
 let visible=false;const events={};
 const leaf={app:{workspace:{on(name,fn){events[name]=fn;return {}}}},containerEl:{isShown:()=>visible},contentEl:{addClass(){},empty(){throw new Error('hidden view rebuilt DOM')}}};
 const p={views:new Set()};const view=new AgentDeckView(leaf,p);
 await view.onOpen();assert.equal(view._pendingRender,true,'hidden view defers its first render');
 view.render();assert.equal(view._pendingRender,true);
 let renders=0;view.render=()=>{renders++;view._pendingRender=false};visible=true;
 view.onResize();assert.equal(renders,1,'showing a dirty view renders latest data');
 view._pendingRender=true;events['layout-change']();assert.equal(renders,2,'reopening a sidebar restores pending render');
 view._pendingRender=true;events['active-leaf-change']();assert.equal(renders,3,'switching to a hidden tab restores pending render');
 await view.onClose();assert.equal(p.views.size,0);
 console.log('PASS hidden dashboard defers DOM work and refreshes on resize, layout and tab activation');
}finally{delete globalThis.document;fs.rmSync(dir,{recursive:true,force:true})}
