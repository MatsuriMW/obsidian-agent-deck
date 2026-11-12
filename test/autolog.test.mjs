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

if (fail) { console.log(`${fail} failed`); process.exit(1); }
console.log("all passed");
