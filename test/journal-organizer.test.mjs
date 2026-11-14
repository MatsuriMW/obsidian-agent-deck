import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { planJournal, renderJournal } from '../src/organize-journal.js';
class Element {
  constructor(options={}) { this.text=options.text;this.children=[]; }
  createEl(tag,options) { const el=new Element(options);el.tag=tag;this.children.push(el);return el; }
  createDiv(options) { return this.createEl('div',options); }
  all() {return [this,...this.children.flatMap(el=>el.all())];}
}
const notices=[];
class Notice {constructor(fragment){this.fragment=fragment;notices.push(this)} hide(){this.hidden=true}}
let day='2026-11-14';
const source=fs.readFileSync(new URL('../src/journal-organizer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const {JournalOrganizer,unorganizedRecordKeys}=vm.runInNewContext(source+'\n({JournalOrganizer,unorganizedRecordKeys})',{Notice,document:{createDocumentFragment:()=>new Element()},MarkdownView:class{},dayKeyToday:()=>day,t:text=>text,setTimeout:()=>1,clearTimeout(){},console});
const records=n=>Array.from({length:n},(_,i)=>`- DOING Task ${i} ^ad-${i}\n  - ❓ 第1轮：问题\n  - 💬 第1轮：结论`).join('\n')+'\n';
assert.equal(unorganizedRecordKeys(planJournal(records(4))).length,4);
assert.equal(unorganizedRecordKeys(planJournal(renderJournal(planJournal(records(4))))).length,0,'organized records do not count toward the next prompt');
assert.equal(unorganizedRecordKeys(planJournal('- DONE 一\n- DONE 二\n- DONE 三\n- DONE 四\n')).length,0,'manual tasks alone never count');
assert.equal(unorganizedRecordKeys(planJournal(records(1)+'  - ❓ 第2轮：问题\n  - 💬 第2轮：结论\n')).length,1,'a task and all child records count as one');
const custom=renderJournal(planJournal(records(4),{layout:{order:['notes','active','done'],titles:{notes:'Notes',active:'Working',done:'Delivered'}}}));
assert.equal(unorganizedRecordKeys(planJournal(custom)).length,0,'custom template sections count as organized');
let current={path:'日记/2026_11_14.md'},text=records(3),saves=0,cleanup;
const writes=[],events={};
const view={get file(){return current},editor:{cm:{composing:false}}};
const p={settings:{journalOrganizePrompt:{day:'',count:0,notes:{}}},app:{workspace:{on(name,fn){events[name]=fn;return {}},getActiveViewOfType:()=>view,getActiveFile:()=>current},vault:{on(name,fn){events[name]=fn;return {}}}},
  registerEvent(){},register(fn){cleanup=fn},journalTarget:()=>current,readNote:async()=>text,journalPlan:async(_,body)=>planJournal(body),saveSettings:async()=>saves++,organizeJournal:async file=>writes.push(file.path),notice(message){throw new Error(message)}};
const organizer=new JournalOrganizer(p);
assert.ok(events['file-open']&&events['editor-change']&&events.modify);
await organizer.check();assert.equal(notices.length,0,'first prompt waits for 4 scattered tasks');
text=records(4);await organizer.check();assert.equal(notices.length,1);assert.equal(writes.length,0,'detection never modifies the journal');
await notices[0].fragment.all().find(el=>el.text==='稍后').onclick();assert.ok(notices[0].hidden);
text=records(4)+'  - 💬 第2轮：新增回复\n';await organizer.check();assert.equal(notices.length,1,'new replies in an existing task do not count as new tasks');
text=records(7);await organizer.check();assert.equal(notices.length,1,'3 additional tasks are not enough');
text=records(8);await organizer.check();assert.equal(notices.length,2,'4 additional tasks trigger the second prompt');
text=records(12);await organizer.check();assert.equal(notices.length,2,'daily limit is 2');
const restarted=new JournalOrganizer(p);await restarted.check();assert.equal(notices.length,2,'limits survive reload');
current={path:'日记/2026_11_13.md'};text=records(4);await organizer.check();assert.equal(notices.length,2,'daily limit applies across all journal files');
day='2026-11-15';await organizer.check();assert.equal(notices.length,3,'daily prompt allowance resets');
current={path:'日记/2026_11_14.md'};text=records(12);await organizer.check();assert.equal(notices.length,4,'pending task counts carry across midnight');
current={path:'日记/2026_11_16.md'};text=records(3);day='2026-11-16';await organizer.check();assert.equal(notices.length,4);
day='2026-11-17';await organizer.check();assert.equal(notices.length,4,'midnight does not discard or round up a partial threshold');
text=records(4);p.settings.organizeJournalSuggest=false;await organizer.check();assert.equal(notices.length,4,'prompt can be disabled');
p.settings.organizeJournalSuggest=true;view.editor.cm.composing=true;await organizer.check();assert.equal(notices.length,4,'IME composition is not interrupted');view.editor.cm.composing=false;
await organizer.check();assert.equal(notices.length,5);
const target=current.path;current={path:'其他笔记.md'};
await notices.at(-1).fragment.all().find(el=>el.text==='整理日志').onclick();assert.deepEqual(writes,[target],'confirmation organizes the captured journal after a tab switch');
cleanup();assert.ok(notices.at(-1).hidden);assert.ok(saves>=5);
console.log('PASS organization nudges: 4 first / 4 new, global daily cap 2, cross-day progress, task identity, organized/custom sections, persistence and explicit confirmation');
