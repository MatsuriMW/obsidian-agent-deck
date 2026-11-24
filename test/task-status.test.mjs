import assert from 'node:assert/strict';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class Notice{};export class Menu{constructor(){(globalThis.__statusMenus ||= []).push(this);this.items=[]}addItem(fn){const i={setTitle(v){this.title=v;return this},setChecked(){return this},setDisabled(){return this},onClick(fn){this.click=fn;return this}};fn(i);this.items.push(i);return this}addSeparator(){}showAtPosition(){}};export class MarkdownView{};',shortCircuit:true};return n(s,c)}`));
const {replaceTaskStatus,locateStatusTask,suggestedStatus,applyStatusChoice}=await import('../src/task-status.js');
const {JournalSync}=await import('../src/sync.js');
const {AutoLog}=await import('../src/autolog.js');
const J=await import('../src/journal.js');
const sid='11111111-2222-3333-4444-555555555555';
let note=`- DOING task ^ad-status\n  - 🔗 [Codex](codex://threads/${sid})\n  - 💬 old result`;
const settings={manualTaskStates:{}};
const usage={meta:new Map([[sid,{state:'run'}]]),archived:new Set(),archivedClaude:new Set(),summary:()=>null};
const p={settings,usage,viewForPath:()=>null,app:{vault:{getAbstractFileByPath:()=>({}),async process(f,fn){note=fn(note)}}},saveSettings:async()=>{},refreshUI(){}};
const target={path:'test.md',raw:note.split('\n')[0]};
await applyStatusChoice(p,target,'PAUSED');
assert.ok(note.startsWith('- PAUSED')&&settings.manualTaskStates['ad-status']);
const sync=new JournalSync(p);
assert.equal(sync.keywords(note),note,'AI running state must not override a manual pause');
usage.archived.add(sid);
assert.equal(sync.keywords(note),note,'archive also respects the explicit manual override');
const auto=new AutoLog(p);
assert.equal(auto.autoLine(note,{key:'task',blockId:'ad-status'},{sid},'doing').text,note,'AutoLog follows the same manual policy');
usage.archived.clear();
await applyStatusChoice(p,target,null);
assert.ok(note.startsWith('- DOING')&&!settings.manualTaskStates['ad-status']);
usage.meta.get(sid).state='wait';assert.ok(sync.keywords(note).startsWith('- TOREVIEW'),'automatic following resumes');
assert.equal(replaceTaskStatus('  2. [ ] TODO text ^id','DONE'),'  2. [x] DONE text ^id');
assert.equal(replaceTaskStatus('- MAYBE custom','TODO'),'- TODO custom');
assert.equal(replaceTaskStatus('- todo text','DONE'),'- DONE text');
assert.equal(replaceTaskStatus('  2. [ ] doing text ^id','DONE'),'  2. [x] DONE text ^id');
assert.equal(replaceTaskStatus('- hello world','TODO'),null);
assert.equal(replaceTaskStatus('- Todo text','DONE'),null);
assert.equal(locateStatusTask('- TODO duplicate\n- TODO duplicate',{raw:'- TODO duplicate'}),-1,'ambiguous tasks are not edited');
assert.equal(locateStatusTask('```\n- TODO example\n```',{raw:'- TODO example'}),-1,'code examples are never changed');
const other='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';usage.meta.set(other,{state:'run'});
assert.equal(suggestedStatus(settings,usage,note+`\n  - 🔗 [Codex](codex://threads/${other})`,0),'DOING');
const before=note;const old=settings.manualTaskStates['ad-status'];
p.app.vault.process=async(f,fn)=>{fn(note);throw new Error('test conflict')};
await assert.rejects(applyStatusChoice(p,target,'DONE'),/test conflict/);
assert.equal(note,before);assert.equal(settings.manualTaskStates['ad-status'],old,'failed edits roll back the lock');
assert.ok(J.isManualTask({manualTaskStates:{'ad-status':'PAUSED'}},target.raw));
console.log('PASS manual status, automatic resume, AutoLog/archive protection and safe task location');

{
 const {registerTaskStatusMenu}=await import('../src/task-status.js');
 globalThis.document={};const handlers={};
 const token={dataset:{taskKeyword:'DOING'},closest(selector){return selector==='[data-task-keyword]'?this:null},getBoundingClientRect:()=>({left:10,bottom:20})};
 const cm={dom:{contains:el=>el===token},posAtDOM:()=>0,state:{doc:{toString:()=>note,lineAt:()=>({number:1,text:note.split('\n')[0]})}}};
 p.app.workspace={iterateAllLeaves(fn){fn({view:{file:{path:'test.md'},editor:{cm}}})}};
 p.app.plugins={plugins:{tasks:{settings:{additionalInactiveKeywords:['MAYBE','TODOFORAI','TODO4AI','TODO2AI','TODOTOAI','NOW']}}}};
 p.readNote=async()=>note;p.registerDomEvent=(el,type,fn)=>handlers[type]=fn;p.registerMarkdownPostProcessor=()=>{};
 registerTaskStatusMenu(p);
 let stopped=false;handlers.click({target:token,button:0,clientX:10,clientY:20,preventDefault(){},stopImmediatePropagation(){stopped=true}});
 await new Promise(r=>setTimeout(r,0));assert.ok(stopped,'keyword clicks must not reach the Query handler');
 const menu=globalThis.__statusMenus.at(-1);assert.ok(menu.items.some(i=>i.title==='PAUSED'));
 const others=menu.items.find(i=>/Other keywords|其他关键词/.test(i.title));others.click();
 const options=globalThis.__statusMenus.at(-1).items.map(i=>i.title);
 for(const banned of ['TODOFORAI','TODO4AI','TODO2AI','TODOTOAI','NOW'])assert.ok(!options.includes(banned),'removed aliases cannot return from plugin configuration');
 assert.ok(options.includes('MAYBE'),'other custom keywords are preserved');
 delete globalThis.document;delete globalThis.__statusMenus;
}

{
  const { setTaskLineStatus, selectedTaskLines, applyBatchStatusChoice, registerTaskStatusMenu } = await import('../src/task-status.js');
  // setTaskLineStatus handles plain bullets, checkboxes, known keywords, and clearing without eating plain uppercase words like API.
  assert.equal(setTaskLineStatus('- API 设计', 'TODO'), '- TODO API 设计');
  assert.equal(setTaskLineStatus('- [ ] API 设计', 'DOING'), '- [/] DOING API 设计');
  assert.equal(setTaskLineStatus('- DOING API 设计', 'DONE'), '- DONE API 设计');
  assert.equal(setTaskLineStatus('- [x] DONE 任务', ''), '- [ ] 任务');
  assert.equal(setTaskLineStatus('- todo 任务', 'DONE'), '- DONE 任务');
  assert.equal(setTaskLineStatus('- [x] done 任务', ''), '- [ ] 任务');
  assert.equal(setTaskLineStatus('- api 设计', 'TODO'), '- TODO api 设计');
  assert.equal(setTaskLineStatus('- Done 任务', 'TODO'), '- TODO Done 任务');

  // Batch update across multiple selected blocks (mixed AI + manual + plain + nested record lines skipped).
  const batchLines = [
    '- DOING 任务甲 ^ad-b1',
    `  - 🔗 [Codex](codex://threads/${sid})`,
    '  - 💬 结论甲',
    '- [ ] 任务乙',
    '- API 规划 ^ad-b3',
  ];
  let batchText = batchLines.join('\n');
  const makeDoc = (str) => {
    const arr = str.split('\n');
    const starts = [];
    let off = 0;
    for (const l of arr) { starts.push(off); off += l.length + 1; }
    return {
      length: str.length,
      lines: arr.length,
      toString: () => str,
      line(n) { const from = starts[n - 1]; return { number: n, from, to: from + arr[n - 1].length, text: arr[n - 1] }; },
      lineAt(pos) {
        let idx = arr.length - 1;
        for (let i = 0; i < starts.length; i++) if (pos >= starts[i]) idx = i;
        return this.line(idx + 1);
      },
    };
  };
  let doc = makeDoc(batchText);
  const picked = selectedTaskLines(doc, { ranges: [{ from: 0, to: batchText.length }] });
  assert.deepEqual(picked, [0, 3, 4], 'selects all three root blocks while ignoring 🔗 and 💬 children');

  let txCount = 0;
  const fakeEditor = {
    getValue: () => batchText,
    transaction({ changes }) {
      txCount += 1;
      for (const c of changes) {
        const lines = batchText.split('\n');
        const fromOff = lines.slice(0, c.from.line).reduce((s, l) => s + l.length + 1, 0) + c.from.ch;
        const toOff = lines.slice(0, c.to.line).reduce((s, l) => s + l.length + 1, 0) + c.to.ch;
        batchText = batchText.slice(0, fromOff) + c.text + batchText.slice(toOff);
        doc = makeDoc(batchText);
      }
    },
    cm: {
      dom: { contains: () => false },
      state: { get doc() { return doc; }, selection: { ranges: [{ from: 0, to: batchText.length }], main: { head: 0 } } },
    },
  };
  const batchPlugin = {
    settings: { manualTaskStates: {} },
    usage,
    app: { plugins: { plugins: {} }, workspace: { iterateAllLeaves() {} } },
    saveSettings: async () => {},
    refreshUI() {},
  };
  const count = await applyBatchStatusChoice(batchPlugin, fakeEditor, picked, 'PAUSED');
  assert.equal(count, 3);
  assert.equal(txCount, 1, 'entire batch applies in a single undoable editor transaction');
  assert.deepEqual(batchText.split('\n')[0], '- PAUSED 任务甲 ^ad-b1');
  assert.deepEqual(batchText.split('\n')[3], '- [ ] PAUSED 任务乙');
  assert.deepEqual(batchText.split('\n')[4], '- PAUSED API 规划 ^ad-b3');
  assert.equal(batchPlugin.settings.manualTaskStates['ad-b1'], 'PAUSED');
  assert.equal(batchPlugin.settings.manualTaskStates['ad-b3'], 'PAUSED');

  // Marking batch DONE flips checkboxes, cleans internal ^ad-* IDs, and clears manual locks.
  const doneCount = await applyBatchStatusChoice(batchPlugin, fakeEditor, [0, 3, 4], 'DONE');
  assert.equal(doneCount, 3);
  assert.ok(batchText.includes('- DONE 任务甲\n'));
  assert.ok(batchText.includes('- [x] DONE 任务乙\n'));
  assert.ok(batchText.endsWith('- DONE API 规划'));

  // Clicking a status badge while multiple blocks are selected opens batch menu for all selected blocks.
  globalThis.document = {};
  const handlers = {};
  const token = { dataset: { taskKeyword: 'DONE' }, closest(s) { return s === '[data-task-keyword]' ? this : null; }, getBoundingClientRect: () => ({ left: 5, bottom: 10 }) };
  fakeEditor.cm.dom.contains = (el) => el === token;
  fakeEditor.cm.posAtDOM = () => 0;
  fakeEditor.cm.state.selection = { ranges: [{ from: 0, to: batchText.length }], main: { head: 0 } };
  batchPlugin.viewForPath = () => ({ editor: fakeEditor });
  batchPlugin.readNote = async () => batchText;
  batchPlugin.registerDomEvent = (el, type, fn) => { handlers[type] = fn; };
  batchPlugin.registerMarkdownPostProcessor = () => {};
  batchPlugin.app.workspace.iterateAllLeaves = (fn) => fn({ view: { file: { path: 'batch.md' }, editor: fakeEditor } });
  registerTaskStatusMenu(batchPlugin);
  handlers.click({ target: token, button: 0, clientX: 5, clientY: 10, preventDefault() {}, stopImmediatePropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  const batchMenu = globalThis.__statusMenus.at(-1);
  assert.match(batchMenu.items[0].title, /3/);
  await batchMenu.items.find((i) => i.title === 'TODO').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(batchText.includes('- TODO 任务甲'));
  assert.ok(batchText.includes('- [ ] TODO 任务乙'));
  assert.ok(batchText.includes('- TODO API 规划'));

  // Clicking a lowercase status badge (`- doing task ^ad-status`) locates the line and opens the menu.
  let lowerNote = `- doing task ^ad-status\n  - 🔗 [Codex](codex://threads/${sid})`;
  const lowerToken = { dataset: { taskKeyword: 'DOING' }, closest(s) { return s === '[data-task-keyword]' ? this : null; }, getBoundingClientRect: () => ({ left: 5, bottom: 10 }) };
  const lowerCm = { dom: { contains: (el) => el === lowerToken }, posAtDOM: () => 0, state: { doc: { toString: () => lowerNote, lineAt: () => ({ number: 1, text: lowerNote.split('\n')[0] }) } } };
  const lowerPlugin = {
    settings: { manualTaskStates: {} },
    usage,
    viewForPath: () => null,
    readNote: async () => lowerNote,
    registerDomEvent: (el, type, fn) => { handlers[type] = fn; },
    registerMarkdownPostProcessor: () => {},
    app: {
      plugins: { plugins: {} },
      workspace: { iterateAllLeaves: (fn) => fn({ view: { file: { path: 'lower.md' }, editor: { cm: lowerCm } } }) },
      vault: { getAbstractFileByPath: () => ({}), async process(f, fn) { lowerNote = fn(lowerNote); } },
    },
    saveSettings: async () => {},
    refreshUI() {},
  };
  registerTaskStatusMenu(lowerPlugin);
  let lowerStopped = false;
  handlers.click({ target: lowerToken, button: 0, clientX: 5, clientY: 10, preventDefault() {}, stopImmediatePropagation() { lowerStopped = true; } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(lowerStopped, 'lowercase keyword click opens status menu');
  const lowerMenu = globalThis.__statusMenus.at(-1);
  await lowerMenu.items.find((i) => i.title === 'DONE').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(lowerNote.startsWith('- DONE task'), `expected lowercase doing replaced by DONE, got: ${lowerNote}`);

  delete globalThis.document;
  delete globalThis.__statusMenus;
}
