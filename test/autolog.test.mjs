// node test/autolog.test.mjs —— 自动记日记（非日记发起的会话）的配置项与触发门槛
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class Notice{constructor(){}};export class MarkdownView{}", shortCircuit: true };
  return next(spec, ctx);
}`));
const { DEFAULTS, deepMerge, dayKeyToday, dayMinute } = await import("../src/constants.js");
const { AutoLog } = await import("../src/autolog.js");
const { resolveCliModel, codexCliArgs } = await import("../src/delegation.js");
const { JournalSync } = await import("../src/sync.js");

let fail = 0;
const check = (name, ok, out) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fail++; console.log(out); } };

// 假插件：日记文件放在内存里，会话列表和 meta 由测试给
function fakePlugin(journal, list, meta = {}, cfg = {}) {
  const settings = deepMerge(DEFAULTS, cfg);
  const day = dayKeyToday(settings);
  const file = { path: `日记/${day}.md`, extension: "md" };
  const p = {
    settings, journal, day,
    app: {
      vault: {
        getAbstractFileByPath: (path) => (path === file.path ? file : null),
        read: async () => p.journal,
        process: async (_f, fn) => { p.journal = fn(p.journal); },
      },
      workspace: { iterateAllLeaves() {} },
      plugins: { plugins: {} },
    },
    usage: { summary: () => ({ list }), meta: new Map(Object.entries(meta)), archived: new Set(), archivedClaude: new Set() },
    saveSettings: async () => {},
    refreshUI() {},
    scanNow: async () => {},
  };
  return p;
}
const nowSegs = (min) => { const m = dayMinute(Date.now(), DEFAULTS); return [[m - min, m]]; };

{ // 门槛 ①：新会话活跃时长门槛可调；没勾的 Agent 不记
  const list = [
    { sid: "a-short", agent: "antigravity", min: 2, segs: nowSegs(2), title: "短会话" },
    { sid: "c-off", agent: "codex", min: 10, segs: nowSegs(10), title: "Codex 会话" },
  ];
  const p = fakePlugin("- TODO 别的\n", list, {}, { autoLogMinMinutes: 1, autoLogAgents: { codex: false } });
  const al = new AutoLog(p);
  let asked = [];
  al.ask = async (items) => { asked = items.map((i) => i.x.sid); return new Map(items.map(({ x }) => [x.sid, { label: "整理会话", summary: "", matchKey: null, done: false, todos: [], skip: false }])); };
  await al.run();
  check("minMinutes=1 lets 2-minute session in; disabled agent skipped", asked.join() === "a-short", asked);
  check("auto item written for antigravity session", /DOING \d\d:\d\d 🤖 整理会话 \^ad-/.test(p.journal), p.journal);
}
{ // 默认 3 分钟门槛照旧
  const p = fakePlugin("", [{ sid: "a-short", agent: "antigravity", min: 2, segs: nowSegs(2) }]);
  const al = new AutoLog(p);
  let n = 0;
  al.ask = async () => { n++; return new Map(); };
  await al.run();
  check("default 3-minute threshold", n === 0, n);
}
{ // 一轮最多问几个会话可调
  const list = [1, 2, 3].map((i) => ({ sid: `s${i}`, agent: "claude", min: 5, segs: nowSegs(5) }));
  const p = fakePlugin("", list, {}, { autoLogBatch: 2 });
  const al = new AutoLog(p);
  let n = 0;
  al.ask = async (items) => { n = items.length; return new Map(); };
  await al.run();
  check("autoLogBatch limits asked sessions", n === 2, n);
}
{ // 门槛 ①：启动后按 autoLogStartDelay 先跑一次；门槛 ②：后台整理也带 fallback
  const p = fakePlugin("", [], {}, { autoLog: true, autoLogStartDelay: 1, autoLogEvery: 20 });
  const al = new AutoLog(p);
  const calls = [];
  al.run = async (o) => { calls.push(o); return { changes: [], asked: 0 }; };
  al.tick();
  check("no run before start delay", calls.length === 0, calls);
  al._born = Date.now() - 61e3;
  al.tick();
  await new Promise((r) => setTimeout(r, 10));
  check("first run after start delay, with fallback", calls.length === 1 && calls[0].fallback === true, calls);
  al.tick();
  await new Promise((r) => setTimeout(r, 10));
  check("then waits a full interval", calls.length === 1, calls);
  p.settings.autoLogFallback = false;
  al._at = Date.now() - 21 * 60e3;
  al.tick();
  await new Promise((r) => setTimeout(r, 10));
  check("fallback follows autoLogFallback", calls.length === 2 && calls[1].fallback === false, calls);
}
{ // 门槛 ③：自动建的条目（无 🔗）也跟着会话切 TOREVIEW / DOING；PAUSED 不动
  const sid = "abcdef12-0000-0000-0000-000000000000";
  const sid2 = "99999999-0000-0000-0000-000000000000";
  const text = "- DOING 10:00 🤖 写测试 ^ad-aaaaaa\n- PAUSED 🤖 另一件 ^ad-bbbbbb\n";
  const p = fakePlugin(text, [], { [sid]: { state: "wait" }, [sid2]: { state: "run" } });
  p.settings.autoLogState = { [p.day]: {
    [sid]: { key: "🤖 写测试", label: "🤖 写测试", blockId: "ad-aaaaaa", status: "doing" },
    [sid2]: { key: "🤖 另一件", label: "🤖 另一件", blockId: "ad-bbbbbb", status: "paused" },
  } };
  const js = new JournalSync(p);
  let out = js.keywords(text);
  check("auto item DOING → TOREVIEW when session waits", out.startsWith("- TOREVIEW 10:00 🤖 写测试 ^ad-aaaaaa\n"), out);
  check("PAUSED auto item untouched", out.includes("- PAUSED 🤖 另一件 ^ad-bbbbbb"), out);
  p.usage.meta.get(sid).state = "run";
  out = js.keywords(out);
  check("auto item TOREVIEW → DOING when session runs again", out.startsWith("- DOING 10:00 🤖 写测试 ^ad-aaaaaa\n"), out);
  p.settings.autoLogKw = false;
  p.usage.meta.get(sid).state = "wait";
  check("autoLogKw=false leaves it alone", js.keywords(out) === out, js.keywords(out));
}
{ // 门槛 ④：非 Claude 会话归档时也收掉它的 🔗 行
  const sid = "cccccccc-1111-2222-3333-444444444444";
  const p = fakePlugin("", []);
  const al = new AutoLog(p);
  const text = `- DONE 11:00 做事 ^ad-cccccc\n\t- 🔗 Codex：做事 \`${sid}\`\n`;
  const out = al.autoClock(text, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  check("codex 🔗 line folded into ⏱", !out.includes("🔗") && out.includes("⏱"), out);
}


{ // 已有相同的时段行时，仍必须收掉非 Claude 的绑定行
  const al = new AutoLog(fakePlugin("", []));
  const sid = "cccccccc-1111-2222-3333-444444444444";
  const first = al.autoClock(`- DONE 做事 ^ad-cccccc\n\t- 🔗 Codex：做事 \`${sid}\`\n`, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  const again = al.autoClock(first + `\t- 🔗 Codex：做事 \`${sid}\`\n`, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  check("unchanged clock still removes the session link", !again.includes("🔗"), again);
}


{ // 自定义模型传 CLI 别名，不把内部 ID 传过去
  const plugin = { settings: deepMerge(DEFAULTS, {}), modelById: (id) => id === "custom-test" ? { cli: "real-alias" } : null };
  check("custom Claude model resolves CLI alias", resolveCliModel(plugin, "claude", "custom-test") === "real-alias");
  const args = codexCliArgs(plugin, {model:"custom-test",effort:"medium"});
  check("Codex delegation uses chosen custom model, effort and sandbox", args.includes("real-alias") && args.includes('model_reasoning_effort="medium"') && args.includes("workspace-write"), args);
}
{ // 不是只测试 tick 的参数：实际启动失败时也要兜底建项
  const x = {sid:"fallback-test",agent:"codex",min:5,segs:nowSegs(5),title:"修复配置"};
  const p = fakePlugin("", [x], {}, {autoLogProvider:"codex",autoLogPath:"/nonexistent/agent-deck-test-cli"});
  const al = new AutoLog(p);
  const r = await al.run({fallback:true});
  check("CLI failure falls back to title and reports error", p.journal.includes("🤖 修复配置") && !!r.error, {journal:p.journal,error:r.error});
}
{ // 归档时长不足也建项，并且最终直接 DONE
  const x = {sid:"archive-short",agent:"antigravity",min:1,segs:nowSegs(1)};
  const p = fakePlugin("", [x]); p.usage.archived.add(x.sid);
  const al = new AutoLog(p);
  al.ask = async () => new Map([[x.sid,{label:"归档测试",todos:[]}]]);
  await al.run();
  check("archived short session bypasses threshold and records DONE", /- DONE .*归档测试/.test(p.journal) && p.journal.includes("⏱"), p.journal);
}


{ // 后台实时写回同样使用所选详细程度，不能只在首次建项生效
  const sid = "detail-sync";
  const p = fakePlugin("",[],{[sid]:{agent:"codex",state:"wait",rounds:[{n:1,ask:"最初要求",said:"完成基础功能。"},{n:2,ask:"追加的用户要求",said:"完成新增配置。"}]}});
  p.settings.autoLogState={[p.day]:{[sid]:{key:"任务",blockId:"ad-detail",status:"doing"}}};
  const js = new JournalSync(p);
  const text = "- DOING 任务 ^ad-detail\n";
  let out = js.results(text);
  // 默认每轮保存结论，简略模式只保留最近提问；显示策略不影响写回。
  check("default live sync combines each task and conclusion", out.includes("任务：追加的用户要求；结论：完成新增配置。") && !out.includes("❓") && out.includes("最初要求") && (out.match(/💬/g)||[]).length===2,out);
  p.settings.autoLogDetail="detailed"; p.settings.autoLogGranularity="round";
  out=js.results(text);
  check("live sync honors detailed setting", out.includes("❓ 第2轮：追加的用户要求"),out);
}


{ // 总开关关闭后所有后台写入停止，手动整理保留。
  const x={sid:"master-switch",agent:"codex",min:5,segs:nowSegs(5),title:"总开关测试"};
  const p=fakePlugin("",[x],{}, {autoLog:true,journalAutoWrite:false});
  const al=new AutoLog(p); let asked=0;
  al.ask=async()=>{asked++;return new Map([[x.sid,{label:"验证手动整理",todos:[]}]]);};
  await al.run();
  check("master off prevents automatic naming and journal writes",asked===0&&p.journal==="");
  al._born=Date.now()-10*60e3;al.tick();
  check("master off also prevents the timer",asked===0);
  const js=new JournalSync(p);let viewed=0;js.openViews=()=>{viewed++;return [];};
  await js.run({force:true});
  check("master off stops live result and keyword synchronization",viewed===0);
  await al.logNow();
  check("explicit manual organize still works when automatic writing is disabled",asked===1&&p.journal.includes("验证手动整理"),p.journal);
}


{ // 每轮记录和详细程度互相独立；停止模式等到暂停才写。
  const sid="grain-sync", rounds=[{n:1,ask:"用户要求一",said:"完成基础功能。"},{n:2,ask:"用户要求二",said:"完成新增配置。"}];
  const p=fakePlugin("",[],{[sid]:{agent:"codex",state:"wait",rounds}},{autoLogGranularity:"round"});
  p.settings.autoLogState={[p.day]:{[sid]:{key:"任务",blockId:"ad-grain",status:"doing"}}};
  const js=new JournalSync(p), text="- DOING 任务 ^ad-grain\n";
  let out=js.results(text);
  check("round granularity keeps each task and conclusion in one paragraph",(out.match(/💬/g)||[]).length===2&&!out.includes("❓")&&out.includes("任务：用户要求一；结论：完成基础功能。"),out);
  p.settings.autoLogGranularity="paused";
  check("paused granularity does not write while merely waiting for user",js.results(text)===text);
  p.settings.autoLogState[p.day][sid].status="paused";
  check("paused granularity writes after inactivity pause",js.results(text).includes("完成新增配置"));
}

{ // 只有够数量才调用模型，成功后保存滚动总结；失败不删原记录。
  const fs=await import("node:fs"), os=await import("node:os"), path=await import("node:path");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ad-merge-test-")), bin=path.join(dir,"model");
  fs.writeFileSync(bin,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({result:"完成基础功能，新增配置；发布仍待验证。"})));\n`,{mode:0o755});
  try {
    const p=fakePlugin("手写内容",[],{},{autoLogGranularity:"round",autoLogMerge:true,autoLogMergeThreshold:2,autoLogPath:bin});
    const js=new JournalSync(p);let refreshed=0;js.run=async()=>{refreshed++;};
    const rounds=[{n:1,said:"完成基础功能。",doneAt:Date.now()},{n:2,said:"新增配置，待发布。",doneAt:Date.now()}];
    await js.queueMerge("merge",rounds.slice(0,1));
    check("merge below threshold does not call or store summary",refreshed===0&&!p.settings.autoLogSummaries[p.day]);
    await js.queueMerge("merge",rounds);
    const summary=p.settings.autoLogSummaries[p.day]?.merge;
    check("merge stores successful summary and refreshes journal",summary?.through===2&&summary.text.includes("待验证")&&refreshed===1,summary);
    js._mergeAt.clear();await js.queueMerge("merge",rounds);
    check("already summarized rounds do not trigger another merge",refreshed===1);
    js._mergeAt.clear();await js.queueMerge("merge",[...rounds,{n:3,said:"验证完成。"},{n:4,said:"发布完成。"}]);
    check("subsequent merge rolls prior summary forward",p.settings.autoLogSummaries[p.day].merge.through===4&&refreshed===2);
    p.settings.autoLogPath=path.join(dir,"missing");
    await js.queueMerge("failed",rounds);
    check("failed merge preserves journal and does not save replacement",!p.settings.autoLogSummaries[p.day].failed&&p.journal==="手写内容");
    p.settings.journalAutoWrite=false;
    await js.queueMerge("off",rounds);
    check("master off also stops automatic merging",!p.settings.autoLogSummaries[p.day].off&&refreshed===2);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

{ // 合并保留本任务 AI 轮次，保留待办、手写内容与更深层子任务。
  const J=await import("../src/journal.js");
  const text="- DOING 任务 ^ad-merge1\n\t- 💬 完成第一轮。\n\t- 💬 第2轮：完成第二轮。\n\t- ❓ 第2轮：用户追问\n\t- TODO 手动待办\n\t- 手写备注\n\t- 子任务\n\t\t- 💬 第2轮：子任务自己的记录\n";
  const args={blockId:"ad-merge1",detail:"brief",granularity:"round",compact:{through:2,text:"完成基础功能，新增配置；发布仍待验证。"},rounds:[{n:1,said:"完成第一轮。"},{n:2,said:"完成第二轮。"},{n:3,said:"完成第三轮。"}]};
  const out=J.syncSessionEntry(text,args).text;
  check("compaction retains summary, later turns and manual content",out.includes("累计总结：完成基础功能，新增配置；发布仍待验证。")&&out.includes("第3轮：任务：任务；结论：完成第三轮。")&&out.includes("完成第二轮")&&out.includes("用户追问")&&out.includes("TODO 手动待办")&&out.includes("手写备注")&&out.includes("子任务自己的记录"),out);
  check("compaction is idempotent",J.syncSessionEntry(out,args).text===out);
}

{ // 客户端归档是明确完成动作；多会话须全部归档。
  const sid = "11111111-2222-3333-4444-555555555555", other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const link = id => `\t- 🔗 [Codex](codex://threads/${id})`;
  const p = fakePlugin("", [], {}); p.usage.archived.add(sid);
  const sync = new JournalSync(p);
  check("archived manually paused task becomes DONE", sync.keywords(`- PAUSED 任务 ^ad-done\n${link(sid)}`).startsWith("- DONE"));
  check("one archived session cannot complete a multi-session task", !sync.keywords(`- DOING 任务 ^ad-multi\n${link(sid)}\n${link(other)}`).startsWith("- DONE"));
  const al = new AutoLog(p), st = { [sid]: {blockId:"ad-multi"}, [other]:{blockId:"ad-multi"} };
  check("automatic log also waits for all sessions to archive", !al.allArchived(st,sid,st[sid],p.usage.archived));
  p.usage.archived.add(other);
  check("all archived sessions complete their shared task", sync.keywords(`- PAUSED 任务 ^ad-multi\n${link(sid)}\n${link(other)}`).startsWith("- DONE") && al.allArchived(st,sid,st[sid],p.usage.archived));
}

{ // 新记录落进 AI 区域之内，不会跑到用户笔记下面
  const region = ['---', '', '## 进行中', '### DOING', '- DOING 老记录 ^ad-a', '', '---', '', '我的笔记', ''].join('\n');
  const p = fakePlugin(region, []);
  const out = new AutoLog(p).placeBlock(region, ['- DOING 🤖 新记录 ^ad-b']);
  check('a new auto record lands inside the AI region', out.indexOf('新记录') < out.indexOf('我的笔记') && out.indexOf('## 进行中') < out.indexOf('新记录'), out);
  check('and stays attached to the band', /- DOING 老记录 \^ad-a\n\n- DOING 🤖 新记录 \^ad-b\n\n---/.test(out), out);

  // 还没有区域时，顺手在末尾开一个区域：用户写在上面，记录在里面
  const plain = '- TODO 手写\n';
  const opened = new AutoLog(fakePlugin(plain, [])).placeBlock(plain, ['- DOING 🤖 新记录 ^ad-b']);
  check('without a region one is opened around the record', opened === '- TODO 手写\n\n---\n## 进行中\n\n- DOING 🤖 新记录 ^ad-b\n', opened);

  // 区域里只有「已完成」时，先补一个「进行中」，别把 DOING 记到已完成下面
  const doneOnly = ['---', '', '## 已完成', '- DONE 旧的 ^ad-old', '', '---', '', '我的笔记', ''].join('\n');
  const withActive = new AutoLog(fakePlugin(doneOnly, [])).placeBlock(doneOnly, ['- DOING 🤖 新记录 ^ad-b']);
  check('a finished-only region gains an active band', withActive.indexOf('## 进行中') > withActive.indexOf('## 已完成') && withActive.indexOf('新记录') < withActive.indexOf('我的笔记'), withActive);

  // 有区域时不再把放置交给 done-to-top：它的分区在区域上面，会把记录放到框外
  const framed = ['---', '', '## 进行中', '### DOING', '- DOING 老记录 ^ad-a', '', '---', '', '我的笔记', ''].join('\n');
  const p2 = fakePlugin(framed, []);
  let asked = false;
  p2.app.plugins.plugins = { 'done-to-top': { core: { addBlock: (text) => { asked = true; return '- DOING 新记录 ^ad-b\n' + text; } } } };
  const out2 = new AutoLog(p2).placeBlock(framed, ['- DOING 新记录 ^ad-b']);
  check('a framed journal never hands placement to done-to-top', !asked && out2.indexOf('## 进行中') < out2.indexOf('新记录') && out2.indexOf('新记录') < out2.indexOf('我的笔记'), out2);

  // 没有区域时才让 done-to-top 按它的分区放
  const bare = '- DONE 旧的 ^ad-old\n';
  const p3 = fakePlugin(bare, []);
  p3.app.plugins.plugins = { 'done-to-top': { core: { addBlock: (text) => '- DOING 新记录 ^ad-b\n' + text } } };
  check('without a region done-to-top still places the block', new AutoLog(p3).placeBlock(bare, ['- DOING 新记录 ^ad-b']).startsWith('- DOING 新记录'));
}

{ // 没有分割线时，自动记录顺手把「进行中」上的分割线补上
  const unframed = '## 进行中\n- DOING 老记录 ^ad-a\n';
  const out = new AutoLog(fakePlugin(unframed, [])).placeBlock(unframed, ['- DOING 🤖 新记录 ^ad-b']);
  check('auto logging restores the opening rule', out.startsWith('---\n## 进行中'), out);
}

{
  const { planJournal, renderJournal } = await import('../src/organize-journal.js');
  const { readJournalLayout } = await import('../src/journal-layout.js');
  const layout={order:['notes','done','active'],titles:{done:'Completed',active:'In progress',notes:'Personal notes'}};
  const base=renderJournal(planJournal('- DONE Existing ^ad-done\n- DOING Running ^ad-running\n\nPersonal text\n',{layout}));
  const next=new AutoLog(fakePlugin(base,[])).placeBlock(base,['- DOING New task ^ad-new','  - 💬 Keep this result']);
  const parsed=readJournalLayout(next);
  check('new auto logs stay inside the custom active section',parsed.sections.active.text.includes('New task')&&!parsed.sections.notes.text.includes('New task'));
  check('custom headings survive auto logging',!next.includes('## 进行中')&&next.includes('## In progress'));
  check('custom auto logging preserves personal notes',parsed.sections.notes.text==='Personal text');
  check('custom auto logging remains organizeable',renderJournal(planJournal(renderJournal(planJournal(next))))===renderJournal(planJournal(next)));
}

if (fail) { console.log(`${fail} failed`); process.exit(1); }
console.log("all passed");
