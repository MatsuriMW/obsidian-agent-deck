import assert from 'node:assert/strict';
import { archivePath, appendArchive, archiveCompletedJournal } from '../src/journal-archive.js';
import { organizeAIJournal } from '../src/organize-journal.js';
assert.equal(archivePath('Custom/done.md'),'Custom/done.md');
for(const value of ['../x.md','/tmp/x.md','x.txt','a//x.md']) assert.throws(()=>archivePath(value));
const block='- DONE 成果 ^ad-finished\n  - 💬 详细记录\n  - 手写子项';
const once=appendArchive('# 归档\n','2026-11-13',[block]);
assert.ok(once.includes('## 2026-11-13\n\n'+block));
assert.equal(appendArchive(once,'2026-11-13',[block]),once);
assert.ok(appendArchive(once,'2026-11-14',['- DONE 第二日 ^ad-day2']).includes('## 2026-11-14'));
assert.throws(()=>appendArchive(once,'2026-11-13',[block+'改动']),/内容不同/);
function fixture(){
 const file={path:'日记/2026_11_13.md',basename:'2026_11_13'}, source=block+'\n- TODO 手动任务\n';
 const files=new Map([[file.path,{...file,text:source}]]);
 const p={settings:{doneArchivePath:'Custom/done.md'},app:{vault:{getAbstractFileByPath:path=>files.get(path),createFolder:async path=>files.set(path,{path}),create:async(path,text)=>{const f={path,text};files.set(path,f);return f;}}},readNote:async path=>files.get(path).text,autoLog:{write:async(f,b,n)=>{if(files.get(f.path).text!==b)return false;files.get(f.path).text=n;return true}}};
 return {p,file,files,source,result:organizeAIJournal(source,'done')};
}
{
 const f=fixture();await archiveCompletedJournal(f.p,f.file,f.source,f.result);
 assert.ok(f.files.get('Custom/done.md').text.includes('详细记录'));
 assert.ok(!f.files.get(f.file.path).text.includes('成果'));assert.ok(f.files.get(f.file.path).text.includes('手动任务'));
}
{
 const f=fixture();f.files.get(f.file.path).text+='新编辑';
 await assert.rejects(()=>archiveCompletedJournal(f.p,f.file,f.source,f.result),/原日记保留/);
 assert.ok(f.files.get(f.file.path).text.includes('成果'));
 assert.ok(f.files.get('Custom/done.md').text.includes('成果'));
 // Retrying after a concurrent edit never duplicates the saved block.
 const base=f.files.get(f.file.path).text;await archiveCompletedJournal(f.p,f.file,base,organizeAIJournal(base,'done'));
 assert.equal((f.files.get('Custom/done.md').text.match(/ad-finished/g)||[]).length,1);
}
{
 const f=fixture();f.p.app.vault.create=async()=>{throw Error('disk failure')};
 await assert.rejects(()=>archiveCompletedJournal(f.p,f.file,f.source,f.result),/disk failure/);
 assert.equal(f.files.get(f.file.path).text,f.source);
 f.p.settings.doneArchivePath=f.file.path;await assert.rejects(()=>archiveCompletedJournal(f.p,f.file,f.source,f.result),/不能与当前日记相同/);
}
console.log('PASS dated custom archive, intact task blocks, retry deduplication, conflict and write-failure source preservation');

const turns=new Map([['ad-low',1],['ad-high',20]]);
const firstDate=appendArchive('# 归档\n','2026-11-13',['- DONE 少轮 ^ad-low'],turns);
const dateSorted=appendArchive(firstDate,'2026-11-13',['- DONE 多轮 ^ad-high'],turns);
assert.ok(dateSorted.indexOf('多轮')<dateSorted.indexOf('少轮'));
assert.equal(appendArchive(dateSorted,'2026-11-13',['- DONE 多轮 ^ad-high'],turns),dateSorted);

const noId='- DONE 🤖 同名工作';
const acrossDates=appendArchive(appendArchive('# 归档\n','2026-11-13',[noId]),'2026-11-14',[noId]);
assert.equal((acrossDates.match(/同名工作/g)||[]).length,2);
