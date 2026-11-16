// node test/autolog.test.mjs —— 自动记日记（非日记发起的会话）的配置项与触发门槛
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class Notice{constructor(){}};export class MarkdownView{}", shortCircuit: true };
  return next(spec, ctx);
}`));
const { DEFAULTS, deepMerge, dayKeyToday, dayMinute, trackedRounds, startOfDay } = await import("../src/constants.js");
const { readJournalLayout } = await import("../src/journal-layout.js");
const { AutoLog } = await import("../src/autolog.js");
const { resolveCliModel, codexCliArgs } = await import("../src/delegation.js");
const { JournalSync } = await import("../src/sync.js");

let fail = 0;
const check = (name, ok, out) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fail++; console.log(out); } };

// 假插件：日记文件放在内存里，会话列表和 meta 由测试给
// opts.missingJournal 让今天的日记一开始不存在；opts.template 给「日记」核心插件的模板
function fakePlugin(journal, list, meta = {}, cfg = {}, opts = {}) {
  const settings = deepMerge(DEFAULTS, cfg);
  const day = dayKeyToday(settings);
  const file = { path: `日记/${day}.md`, extension: "md" };
  const tpl = opts.template ? { path: opts.template.path, extension: "md" } : null;
  const files = new Map();
  if (!opts.missingJournal) files.set(file.path, file);
  const p = {
    settings, journal, day, files,
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) || (tpl && path === tpl.path ? tpl : null),
        read: async (f) => (f === tpl ? opts.template.text : p.journal),
        process: async (_f, fn) => { p.journal = fn(p.journal); },
        createFolder: async (path) => { files.set(path, { path }); },
        create: async (path, content) => { const f = { path, extension: "md" }; files.set(path, f); p.journal = content; return f; },
      },
      workspace: { iterateAllLeaves() {} },
      plugins: { plugins: {} },
      internalPlugins: tpl ? {
        getPluginById: (id) => (id === "daily-notes"
          ? { enabled: true, instance: { options: { folder: "日记", format: "YYYY_MM_DD", template: tpl.path } } }
          : id === "templates" ? { enabled: true, instance: { options: { dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" } } } : null),
      } : undefined,
    },
    ensureNoteFile: async (path, content = "") => {
      const f = p.app.vault.getAbstractFileByPath(path) || await p.app.vault.create(path, content);
      return { path, file: f };
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
  check("auto item written for antigravity session", /DOING 🤖 \d\d:\d\d-\d\d:\d\d \*\*整理会话\*\* \^agy-/.test(p.journal), p.journal);
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
  check("auto item DOING → TOREVIEW when session waits", out.startsWith("- TOREVIEW 🤖 10:00-10:00 写测试 ^ad-aaaaaa\n"), out);
  check("PAUSED auto item untouched", out.includes("- PAUSED 🤖 另一件 ^ad-bbbbbb"), out);
  p.usage.meta.get(sid).state = "run";
  out = js.keywords(out);
  check("auto item TOREVIEW → DOING when session runs again", out.startsWith("- DOING 🤖 10:00-10:00 写测试 ^ad-aaaaaa\n"), out);
  p.settings.autoLogKw = false;
  p.usage.meta.get(sid).state = "wait";
  check("autoLogKw=false leaves it alone", js.keywords(out) === out, js.keywords(out));
}
{ // 完成后保留非 Claude 会话的 🔗 链接
  const sid = "cccccccc-1111-2222-3333-444444444444";
  const p = fakePlugin("", []);
  const al = new AutoLog(p);
  const text = `- DONE 11:00 做事 ^ad-cccccc\n\t- 🔗 Codex：做事 \`${sid}\`\n`;
  const out = al.autoClock(text, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  check("completed Codex keeps its session link beside the clock", out.includes("🔗") && out.includes("⏱"), out);
}


{ // 已有相同的完成时段行时，保留会话链接且不重复追加时段
  const al = new AutoLog(fakePlugin("", []));
  const sid = "cccccccc-1111-2222-3333-444444444444";
  const first = al.autoClock(`- DONE 做事 ^ad-cccccc\n\t- 🔗 Codex：做事 \`${sid}\`\n`, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  const again = al.autoClock(first + `\t- 🔗 Codex：做事 \`${sid}\`\n`, "做事", [[60, 120]], "Codex", 0, sid, "ad-cccccc");
  check("unchanged completed clock preserves the session link", again.includes("🔗") && (again.match(/⏱/g) || []).length === 1, again);
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
  check("CLI failure falls back to title and reports error", /DOING 🤖 \d\d:\d\d-\d\d:\d\d \*\*修复配置\*\*/.test(p.journal) && !!r.error, {journal:p.journal,error:r.error});
}
{ // 归档时长不足也建项，并且最终直接 DONE
  const x = {sid:"archive-short",agent:"antigravity",min:1,segs:nowSegs(1)};
  const p = fakePlugin("", [x]); p.usage.archived.add(x.sid);
  const al = new AutoLog(p);
  al.ask = async () => new Map([[x.sid,{label:"归档测试",todos:[]}]]);
  await al.run();
  check("archived short session bypasses threshold and records DONE", /- DONE 🤖 \d\d:\d\d-\d\d:\d\d \*\*归档测试\*\*/.test(p.journal) && p.journal.includes("⏱"), p.journal);
}
{ // 今天的日记还没有：按「日记」核心插件的模板建一篇，再照常写入；新默认值也跟着走
  check("automatic session recording is on by default", DEFAULTS.autoLog === true, DEFAULTS.autoLog);
  check("scan interval defaults to 30 seconds", DEFAULTS.pollSeconds === 30, DEFAULTS.pollSeconds);
  const tpl = { path: "模板/日记模板.md", text: "# {{title}}\n\n日期：{{date:YYYY/MM/DD}} {{time:HH:mm}}\n" };
  const x = { sid: "create-journal", agent: "codex", min: 6, segs: nowSegs(6), title: "建日记" };
  const p = fakePlugin("", [x], {}, {}, { missingJournal: true, template: tpl });
  const al = new AutoLog(p);
  al.ask = async (items) => new Map(items.map(({ x: s }) => [s.sid, { label: "新建日记", todos: [] }]));
  const r = await al.run();
  const created = p.files.get(`日记/${p.day}.md`);
  check("missing journal is created as a note", !!created, [...p.files.keys()]);
  check("created journal carries the daily-note template with variables filled in",
    p.journal.startsWith(`# ${p.day}\n\n日期：`) && /^日期：\d{4}\/\d\d\/\d\d \d\d:\d\d$/m.test(p.journal) && !p.journal.includes("{{"), p.journal);
  check("created journal then receives the session block", /DOING 🤖 \d\d:\d\d-\d\d:\d\d \*\*新建日记\*\*/.test(p.journal) && !r.error, { journal: p.journal, error: r.error });
}
{ // 没配日记模板时建空笔记，分区骨架由 placeBlock 生成
  const x = { sid: "create-empty", agent: "codex", min: 6, segs: nowSegs(6), title: "空模板" };
  const p = fakePlugin("", [x], {}, {}, { missingJournal: true });
  const al = new AutoLog(p);
  al.ask = async (items) => new Map(items.map(({ x: s }) => [s.sid, { label: "空模板建日记", todos: [] }]));
  const r = await al.run();
  check("journal created without a template gets the built-in layout and the record",
    p.journal.includes("## 正在做") && /DOING 🤖 .*空模板建日记/.test(p.journal) && !r.error, { journal: p.journal.slice(0, 400), error: r.error });
}
{ // 轮次窗口：第一次接入只取最近 N 轮，之后只取当天产生的轮次
  const now = Date.now(), old = now - 3 * 86400e3;
  const r = (n, at) => ({ n, at, ask: `问${n}`, said: `答${n}` });
  const rounds = [r(1, old), r(2, old), r(3, now)];
  check("first sight keeps only the latest N rounds", trackedRounds(rounds, { first: true, max: 2 }).map((x) => x.n).join() === "2,3");
  const since = startOfDay(Date.now(), DEFAULTS);
  check("afterwards only rounds produced today are tracked", trackedRounds(rounds, { since }).map((x) => x.n).join() === "3");
  check("rounds without a timestamp survive the day filter", trackedRounds([{ n: 1 }, r(2, old)], { since }).length === 1);
}
{ // 第一次接入一个有很多历史的会话：只补最近 autoLogFirstRounds 轮；之后再跑只追加当天的
  const now = Date.now(), old = now - 3 * 86400e3;
  const rounds = [];
  for (let i = 1; i <= 25; i++) rounds.push({ n: i, at: i <= 15 ? old : now, ask: `需求${i}`, said: `结论${i}` });
  const x = { sid: "window-first", agent: "codex", min: 30, segs: nowSegs(30), title: "老会话" };
  const p = fakePlugin("", [x], { "window-first": { agent: "codex", state: "wait", rounds, lastText: "结论25" } });
  const al = new AutoLog(p);
  al.ask = async (items) => new Map(items.map(({ x: s }) => [s.sid, { label: "历史会话", todos: [] }]));
  await al.run();
  const marks = (text) => [...text.matchAll(/<!-- ad-turn:[^:]+:(\d+) -->/g)].map((m) => +m[1]);
  check("first sight backfills only the latest 10 rounds", marks(p.journal).length === 10 && Math.min(...marks(p.journal)) === 16 && Math.max(...marks(p.journal)) === 25, marks(p.journal));
  check("first sight is remembered per session", !!p.settings.autoLogSeen["window-first"], p.settings.autoLogSeen);
  p.usage.meta.get("window-first").rounds.push({ n: 26, at: Date.now(), ask: "需求26", said: "结论26" });
  await al.run();
  check("later passes only add today's new round", marks(p.journal).length === 11 && marks(p.journal).includes(26) && !marks(p.journal).includes(15), marks(p.journal));
}
{ // 🔗 绑定的会话遵守同一窗口：见过之后旧轮次不再写进来
  const now = Date.now(), old = now - 2 * 86400e3;
  const rounds = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, at: i < 8 ? old : now, ask: `问${i + 1}`, said: `答${i + 1}` }));
  const sid = "11111111-2222-3333-4444-555555555555";
  const make = (list = rounds) => fakePlugin("", [], { [sid]: { agent: "codex", state: "wait", rounds: list } });
  const text = `- TOREVIEW 任务\n\t- 🔗 [Codex](codex://threads/${sid})\n`;
  const marks = (out) => [...out.matchAll(/<!-- ad-turn:[^:]+:(\d+) -->/g)].map((m) => +m[1]);
  const p1 = make();
  const js1 = new JournalSync(p1);
  const first = js1.results(text);
  check("linked session on first sight keeps the latest 10 rounds", marks(first).length === 10 && Math.min(...marks(first)) === 3, marks(first));
  p1.usage.meta.get(sid).rounds.push({ n: 13, at: Date.now(), ask: "问13", said: "答13" });
  const again = js1.results(first);
  check("linked session afterwards appends today's new round only", marks(again).length === 11 && marks(again).includes(13) && !marks(again).includes(2), marks(again));
  const p2 = make(rounds.slice(0, 12));
  p2.settings.autoLogSeen = { [sid]: Date.now() };
  const seen = new JournalSync(p2).results(text);
  check("a seen linked session gets today's rounds only", marks(seen).sort((a, b) => a - b).join() === "9,10,11,12", marks(seen));
}
{ // 没有会话可记时不去建当天的日记
  const p = fakePlugin("", [], {}, {}, { missingJournal: true });
  const r = await new AutoLog(p).run();
  check("no sessions means no journal is created", p.files.size === 0 && !r.error, [...p.files.keys()]);
}
{ // 强制格式校验：DOING / PAUSED / DONE 均保持「状态 + 🤖 + 开始时间-最后时间 + 总结标题」，并自动浓缩路径/链接前缀
  const fs = await import("node:fs");
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  check("manifest description obeys Obsidian review rules (no 'Obsidian', <=250 chars, ends with '.')", !/obsidian/i.test(manifest.description) && manifest.description.endsWith(".") && manifest.description.length <= 250, manifest.description);
  const x = { sid: "fmt-check", agent: "codex", min: 8, segs: [[600, 625]], title: "请帮我克隆 https://github.com/Anarcadia/chuanhugpt，位置在 /Users/chenchen/claude" };
  const p = fakePlugin("", [x], {}, { autoLogProvider: "codex", autoLogPath: "/nonexistent/agent-deck-test-cli" });
  const al = new AutoLog(p);
  al.nowMin = () => 700;
  await al.run({ fallback: true });
  check("PAUSED auto record includes 🤖 + start-end time + summarized title", /- PAUSED 🤖 10:00-10:25 \*\*克隆 chuanhugpt\*\* \^codex-/.test(p.journal), p.journal);
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
  check('and stays attached to the band', readJournalLayout(out).sections.active.text.includes('- DOING 老记录 ^ad-a\n- DOING 🤖 新记录 ^ad-b'), out);

  // 还没有区域时，顺手在末尾开一个区域：用户写在上面，记录在里面
  const plain = '- TODO 手写\n';
  const opened = new AutoLog(fakePlugin(plain, [])).placeBlock(plain, ['- DOING 🤖 新记录 ^ad-b']);
  check('without a region one is opened around the record', opened.startsWith(plain) && readJournalLayout(opened).sections.active.text.includes('新记录') && !readJournalLayout(opened).sections.todo.text.includes('手写'), opened);

  // 区域里只有「已完成」时，先补一个「进行中」，别把 DOING 记到已完成下面
  const doneOnly = ['---', '', '## 已完成', '- DONE 旧的 ^ad-old', '', '---', '', '我的笔记', ''].join('\n');
  const withActive = new AutoLog(fakePlugin(doneOnly, [])).placeBlock(doneOnly, ['- DOING 🤖 新记录 ^ad-b']);
  check('a finished-only region gains an active band', withActive.indexOf('## 正在做') < withActive.indexOf('## 已完成') && withActive.indexOf('新记录') < withActive.indexOf('我的笔记'), withActive);

  // 有区域时不再把放置交给 done-to-top：它的分区在区域上面，会把记录放到框外
  const framed = ['---', '', '## 进行中', '### DOING', '- DOING 老记录 ^ad-a', '', '---', '', '我的笔记', ''].join('\n');
  const p2 = fakePlugin(framed, []);
  let asked = false;
  p2.app.plugins.plugins = { 'done-to-top': { core: { addBlock: (text) => { asked = true; return '- DOING 新记录 ^ad-b\n' + text; } } } };
  const out2 = new AutoLog(p2).placeBlock(framed, ['- DOING 新记录 ^ad-b']);
  check('a framed journal never hands placement to done-to-top', !asked && out2.indexOf('## 进行中') < out2.indexOf('新记录') && out2.indexOf('新记录') < out2.indexOf('我的笔记'), out2);

  // 没有区域时建立自有分区，避免新记录落到框外
  const bare = '- DONE 旧的 ^ad-old\n';
  const p3 = fakePlugin(bare, []);
  p3.app.plugins.plugins = { 'done-to-top': { core: { addBlock: (text) => '- DOING 新记录 ^ad-b\n' + text } } };
  const initialized = new AutoLog(p3).placeBlock(bare, ['- DOING 新记录 ^ad-b']);
  check('without a region new records use an owned frame', initialized.startsWith(bare) && readJournalLayout(initialized).sections.active.text.includes('新记录'));
}

{ // 没有分割线时，自动记录顺手把「进行中」上的分割线补上
  const unframed = '## 进行中\n- DOING 老记录 ^ad-a\n';
  const out = new AutoLog(fakePlugin(unframed, [])).placeBlock(unframed, ['- DOING 🤖 新记录 ^ad-b']);
  check('auto logging keeps unbounded notes outside the new frame', out.startsWith(unframed) && readJournalLayout(out).sections.active.text.includes('新记录') && !readJournalLayout(out).sections.active.text.includes('老记录'), out);
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

{ // 模型仍在运行时，用户和另一个 Agent 的新内容必须保留。
  const x = { sid: "model-wait", agent: "codex", min: 5, segs: nowSegs(5), title: "异步整理" };
  const p = fakePlugin("- TODO 手写原文\n", [x]);
  const al = new AutoLog(p);
  al.ask = async () => {
    p.journal += "- TODO 用户刚输入的日记\n- DOING 另一个 Agent ^ad-other\n\t- 💬 另一个 Agent 刚回传\n";
    return new Map([[x.sid, { label: "异步整理", summary: "完成", todos: [], skip: false }]]);
  };
  await al.run();
  check("model waits preserve new user input and other agents' records", p.journal.includes("用户刚输入的日记") && p.journal.includes("另一个 Agent 刚回传") && p.journal.includes("异步整理"), p.journal);
}

{ // 自动整理也不能打断中文输入法组字。
  const p = fakePlugin("- TODO 原文\n", []);
  const al = new AutoLog(p);
  al.viewFor = () => ({ editor: { cm: { composing: true }, getValue: () => p.journal, transaction() { throw new Error("must not interrupt IME"); } } });
  check("AI organization skips writes while IME is composing", await al.write({}, p.journal, p.journal + "- AI 记录\n") === false);
}


{ // 命名调用同时给出英文短名，新 ID 使用语义短名，之后改标题不换号。
  const x={sid:'semantic-auto',agent:'antigravity',min:5,segs:nowSegs(5),title:'整理日志'};
  const p=fakePlugin('',[x]);const al=new AutoLog(p);
  al.ask=async()=>new Map([[x.sid,{label:'整理日志',slug:'journal-cleanup',summary:'',matchKey:null,skip:false}]]);
  await al.run();
  const {makeBlockId}=await import('../src/journal.js');
  const id=makeBlockId(x.sid,x.agent,'journal-cleanup');
  check('auto naming produces an agent/task/suffix ID',p.journal.includes('^'+id),p.journal);
  p.journal=p.journal.replace('整理日志','改过的标题');await al.run();
  check('renaming an automatic entry preserves its ID',p.journal.includes('^'+id),p.journal);
}

{
  const base = '- DONE 区外的 AI 条目 ^ad-outside\n\n';
  const next = base + '---\n## 正在做\n---\n';
  const p = fakePlugin(base, []);
  const al = new AutoLog(p);
  await al.write({ path: 'journal.md' }, base, next, { cleanup: false });
  check('prepared layout writes preserve outside identifiers and whitespace', p.journal === next, p.journal);
}
{ // 归档触发 DONE 时，结束时间按最后一次对话结束时间为准（不是归档操作时间）
  const sid1 = "11111111-1111-1111-1111-111111111111";
  const sid2 = "22222222-2222-2222-2222-222222222222";
  const baseDate = new Date();
  baseDate.setHours(10, 0, 0, 0);
  const tEnd1 = baseDate.getTime() + 12 * 60000; // 10:12
  const tEnd2 = baseDate.getTime() + 28 * 60000; // 10:28
  const p = fakePlugin("", [], {
    [sid1]: { agent: "claude", state: "wait", lastAt: tEnd1 },
    [sid2]: { agent: "codex", state: "wait", lastAt: tEnd2 },
  }, { dayCutoff: 0 });
  p.usage.archivedClaude.add(sid1);
  p.usage.archived.add(sid2);
  const js = new JournalSync(p);
  const multiNote = `- DOING 🤖 10:00-10:12 联合任务 ^ad-multi\n\t- 🔗 [Codex](codex://threads/${sid2})\n\t- 🔗 [Claude](claude://resume?session=${sid1})\n`;
  const multiOut = js.keywords(multiNote);
  check("multi-session archive uses latest conversation end time instead of bottom link or archive time", multiOut.includes("- DONE 🤖 10:00-10:28 联合任务"), multiOut);

  const al = new AutoLog(p);
  const pastNote = "- PAUSED 🤖 10:00-10:05 跨天归档 ^ad-past\n";
  const res = al.autoLine(pastNote, { key: "跨天归档", blockId: "ad-past", slug: "past" }, { sid: sid1, agent: "claude", segs: [] }, "done");
  check("autolog archive falls back to meta lastAt instead of stale p.until", res.text.startsWith("- DONE 🤖 10:00-10:12 跨天归档 ^ad-past"), res.text);
}

{ // 口语过滤 & 跨零点会话保留在前一天位置，过了零点的新会话去新一天
  const { condenseUserPrompt } = await import("../src/prompt-text.js");
  const { dayKey } = await import("../src/constants.js");
  const condensed = condenseUserPrompt("那个，就是说麻烦你帮我看一下，嗯，为什么 npm run build 会报错，谢谢！");
  check("condenseUserPrompt strips spoken filler while keeping core task", !/那个|就是说|谢谢|麻烦你/.test(condensed) && condensed.includes("npm run build"), condensed);

  const now = Date.now();
  const yMs = now - 86400e3;
  const cfg = deepMerge(DEFAULTS, { dayCutoff: 0 });
  const today = dayKey(now, cfg), yesterday = dayKey(yMs, cfg);
  const files = { [`日记/${today}.md`]: "", [`日记/${yesterday}.md`]: "- DOING 🤖 23:40-23:55 跨夜任务 ^ad-cross\n" };
  const crossSid = "cross-midnight-1", freshSid = "after-midnight-2";
  const meta = new Map([
    [crossSid, { agent: "codex", startedAt: yMs, lastAt: now, state: "wait", rounds: [{ n: 1, ask: "昨天开始" }, { n: 2, ask: "嗯，那个继续排查构建", said: "已完成跨夜构建验证。" }] }],
    [freshSid, { agent: "codex", startedAt: now, lastAt: now, state: "run" }],
  ]);
  const summaryMap = {
    [yesterday]: { list: [{ sid: crossSid, agent: "codex", min: 15, segs: [[1420, 1435]], title: "跨夜任务" }] },
    [today]: { list: [
      { sid: crossSid, agent: "codex", min: 10, segs: [[0, 10]], title: "跨夜任务" },
      { sid: freshSid, agent: "codex", min: 5, segs: [[15, 20]], title: "新的一天任务" },
    ] },
  };
  const p = {
    settings: cfg,
    app: {
      vault: {
        getAbstractFileByPath: (path) => (Object.hasOwn(files, path) ? { path, extension: "md" } : null),
        read: async (f) => files[f.path],
        process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
      },
      workspace: { iterateAllLeaves() {} },
      plugins: { plugins: {} },
    },
    usage: { summary: (d) => summaryMap[d] || { list: [] }, meta, archived: new Set(), archivedClaude: new Set() },
    saveSettings: async () => {}, refreshUI() {}, scanNow: async () => {},
  };
  cfg.autoLogState = { [yesterday]: { [crossSid]: { key: "🤖 跨夜任务", label: "🤖 跨夜任务", blockId: "ad-cross", status: "doing" } } };
  const al = new AutoLog(p);
  al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, { label: x.title, slug: "new-day", summary: "", matchKey: null, done: false, todos: [], skip: false }]));
  await al.run();
  check("cross-day conversation stays in yesterday's journal and is not duplicated in today's journal",
    !files[`日记/${today}.md`].includes("跨夜任务")
    && files[`日记/${today}.md`].includes("新的一天任务")
    && files[`日记/${yesterday}.md`].includes("23:40-00:10 跨夜任务")
    && files[`日记/${yesterday}.md`].includes("继续排查构建"),
    files);
}
{ // 自动记录区分阻塞态（NEEDOK / ERRORED / HITLIMIT / QUEUED）与 model done→TOREVIEW；正常停顿仍为 PAUSED
  const list = [
    { sid: "blk-perm", agent: "claude", min: 5, segs: [[600, 605]], title: "需授权操作" },
    { sid: "blk-err", agent: "codex", min: 5, segs: [[610, 615]], title: "编译报错" },
    { sid: "blk-lim", agent: "codex", min: 5, segs: [[620, 625]], title: "额度用尽" },
    { sid: "blk-que", agent: "claude", min: 5, segs: [[630, 635]], title: "排队等待" },
    { sid: "done-rev", agent: "dsh", min: 6, segs: [[640, 646]], title: "整件事已完成" },
    { sid: "norm-pause", agent: "dsh", min: 6, segs: [[650, 656]], title: "中途暂歇" },
  ];
  const meta = {
    "blk-perm": { state: "needs-approval" },
    "blk-err": { state: "error" },
    "blk-lim": { state: "limit" },
    "blk-que": { state: "queued" },
    "done-rev": { state: "wait" },
    "norm-pause": { state: "wait" },
  };
  const p = fakePlugin("", list, meta);
  const al = new AutoLog(p);
  al.nowMin = () => 700;
  al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, {
    label: x.title,
    summary: "",
    matchKey: null,
    done: x.sid === "done-rev",
    todos: [],
    skip: false,
  }]));
  await al.run();
  check("blocked sessions record NEEDOK/ERRORED/HITLIMIT/QUEUED instead of PAUSED",
    p.journal.includes("- NEEDOK 🤖 10:00-10:05 **需授权操作**")
    && p.journal.includes("- ERRORED 🤖 10:10-10:15 **编译报错**")
    && p.journal.includes("- HITLIMIT 🤖 10:20-10:25 **额度用尽**")
    && p.journal.includes("- QUEUED 🤖 10:30-10:35 **排队等待**"),
    p.journal);
  check("model done=true inactive session moves to TOREVIEW while normal wait stays PAUSED",
    p.journal.includes("- TOREVIEW 🤖 10:40-10:46 **整件事已完成**")
    && p.journal.includes("- PAUSED 🤖 10:50-10:56 **中途暂歇**"),
    p.journal);
  // Second pass with no changes keeps TOREVIEW and NEEDOK intact without flipping to DOING.
  await al.run();
  check("second pass preserves TOREVIEW and NEEDOK without false user-edit hold",
    p.journal.includes("- TOREVIEW 🤖 10:40-10:46 **整件事已完成**")
    && p.journal.includes("- NEEDOK 🤖 10:00-10:05 **需授权操作**"),
    p.journal);
  // Resuming blk-perm and done-rev switches them back to DOING.
  p.usage.meta.get("blk-perm").state = "run";
  p.usage.meta.get("done-rev").state = "run";
  list[0].segs = [[600, 700]];
  list[4].segs = [[640, 700]];
  await al.run();
  check("resumed blocked and TOREVIEW items switch back to DOING",
    p.journal.includes("- DOING 🤖 10:00-11:40 **需授权操作**")
    && p.journal.includes("- DOING 🤖 10:40-11:40 **整件事已完成**"),
    p.journal);
}
if (fail) { console.log(`${fail} failed`); process.exit(1); }
console.log("all passed");
