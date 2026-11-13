import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {AgentUsage,UsageStore} from '../src/readers.js';

async function heldWrite(file, run) {
 const original=fs.promises.writeFile;
 let release, entered, first=true;
 const ready=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
 fs.promises.writeFile=async function(target,...args){
  if(first && String(target).startsWith(file) && String(target).endsWith('.tmp')){first=false;entered();await gate}
  return original.call(this,target,...args);
 };
 try{await run(ready,release)}finally{release();fs.promises.writeFile=original}
}
async function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-write-'));try{await run(path.join(dir,'usage.json'))}finally{fs.rmSync(dir,{recursive:true,force:true})}}
const readCache=file=>JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));

test('cache retains dirty flag for data arriving while a snapshot is being saved',()=>fixture(async file=>{
 const u=new AgentUsage();u.meta.set('s',{title:'old'});u.dirty=true;
 await heldWrite(file,async(ready,release)=>{
  const saving=u.saveCache(file);await ready;
  u.meta.set('s',{title:'new'});u.dirty=true;release();assert.equal(await saving,true);
  assert.equal(u.dirty,true,'new data must still be scheduled for persistence');
 });
}));
test('unload snapshot cannot be overwritten by an older asynchronous cache save',()=>fixture(async file=>{
 const u=new AgentUsage();u.meta.set('s',{title:'old'});
 await heldWrite(file,async(ready,release)=>{
  const saving=u.saveCache(file);await ready;
  u.meta.set('s',{title:'latest'});u.dirty=true;u.saveCacheSync(file);
  release();await saving;
  assert.equal(new Map(readCache(file).meta).get('s').title,'latest');
 });
}));
test('concurrent cache saves finish in order without sharing a temporary file',()=>fixture(async file=>{
 const u=new AgentUsage();u.meta.set('s',{title:'old'});
 await heldWrite(file,async(ready,release)=>{
  const first=u.saveCache(file);await ready;
  u.meta.set('s',{title:'latest'});u.dirty=true;const second=u.saveCache(file);release();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(new Map(readCache(file).meta).get('s').title,'latest');
 });
}));
test('usage summary remains dirty after a failed write',()=>fixture(async file=>{
 const store=new UsageStore({});store.file=file;store.days={x:{out:1}};store.dirty=true;
 const original=fs.promises.writeFile;
 fs.promises.writeFile=async()=>{throw new Error('test IO failure')};
 try{await assert.rejects(store.save(),/test IO failure/);assert.equal(store.dirty,true)}finally{fs.promises.writeFile=original}
}));
test('concurrent summary saves preserve the newest summary and both callers complete',()=>fixture(async file=>{
 const store=new UsageStore({});store.file=file;store.days={x:{out:1}};
 await heldWrite(file,async(ready,release)=>{
  const first=store.save();await ready;
  store.days.x.out=2;store.dirty=true;const second=store.save();release();
  await Promise.all([first,second]);assert.equal(JSON.parse(fs.readFileSync(file)).days.x.out,2);
 });
}));

test('unload summary supersedes an older pending save',()=>fixture(async file=>{
 const store=new UsageStore({});store.file=file;store.days={x:{out:1}};
 await heldWrite(file,async(ready,release)=>{
  const pending=store.save();await ready;store.days.x.out=2;store.dirty=true;store.saveSync();
  release();await pending;assert.equal(JSON.parse(fs.readFileSync(file)).days.x.out,2);
 });
}));

test('queued cache writes from an unloaded instance cannot overwrite the next instance',()=>fixture(async file=>{
 const u=new AgentUsage();u.meta.set('s',{title:'old'});
 await heldWrite(file,async(ready,release)=>{
  const first=u.saveCache(file);await ready;const queued=u.saveCache(file);
  u.saveCacheSync(file);
  const next=new AgentUsage();next.meta.set('s',{title:'next instance'});next.saveCacheSync(file);
  release();await Promise.all([first,queued]);
  assert.equal(new Map(readCache(file).meta).get('s').title,'next instance');
 });
}));
test('queued summary writes cannot overwrite a new plugin instance',()=>fixture(async file=>{
 const store=new UsageStore({});store.file=file;store.days={x:{out:1}};
 await heldWrite(file,async(ready,release)=>{
  const first=store.save();await ready;const queued=store.save();store.saveSync();
  const next=new UsageStore({});next.file=file;next.days={x:{out:3}};next.saveSync();
  release();await Promise.all([first,queued]);assert.equal(JSON.parse(fs.readFileSync(file)).days.x.out,3);
 });
}));
