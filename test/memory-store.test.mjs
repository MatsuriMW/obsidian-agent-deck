import test from "node:test";
import assert from "node:assert/strict";
import { serializeMemoryFile, parseMemoryFile, renderMemoryList, renderOverview, memoryFileName, memoryIdOf, OVERVIEW_START, OVERVIEW_END } from "../src/memory-store.js";
import { memoryEntries, Dreaming } from "../src/dream.js";
import { DEFAULTS, journalPath, dayKeyToday } from "../src/constants.js";

const ENTRY = { id: "m-abc123", kind: "preference", text: "用户偏好中文回复", state: "有效", date: "2026-11-18", sources: ["[[日记/2026_11_13#^abc]]（用户日志，第 3—3 行）；原文：以后请用中文回复"] };

test("记忆文件往返：序列化后能解析回同样的条目", () => {
  const parsed = parseMemoryFile(serializeMemoryFile({ ...ENTRY, evidence: ENTRY.sources }));
  assert.equal(parsed.id, ENTRY.id);
  assert.equal(parsed.kind, "preference");
  assert.equal(parsed.title, ENTRY.text, "frontmatter 里带完整标题，供 Base 展示");
  assert.equal(parsed.text, ENTRY.text);
  assert.equal(parsed.state, "有效");
  assert.deepEqual(parsed.sources, ENTRY.sources);
  assert.deepEqual(parsed.evidence, [], "证据只在 frontmatter 的 sources 里，正文不再重复");
});

test("记忆文件容忍用户手加的 frontmatter，不因未知字段丢失", () => {
  const raw = `---\nid: m-x\nkind: lesson\ntype: 项目经验\nstate: 已拒绝\ndate: 2026-11-01\nprivate: true\n---\n\n先看结论再展开。\n`;
  const parsed = parseMemoryFile(raw);
  assert.equal(parsed.kind, "lesson");
  assert.equal(parsed.state, "已拒绝");
  assert.equal(parsed.text, "先看结论再展开。");
  assert.equal(parseMemoryFile("没有 frontmatter"), null);
});

test("渲染出的列表仍能被旧解析器读取（共享导出、陪伴档案不受影响）", () => {
  const list = renderMemoryList([ENTRY, { ...ENTRY, id: "m-def456", text: "旧事实", state: "已被替代" }]);
  const entries = memoryEntries(`# 记忆\n\n${list}\n`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].state, "有效");
  assert.equal(entries[1].state, "已被替代");
  assert.match(list, /\^dream-abc123/);
});

test("概览只重写生成区块，人工内容原样保留；标记损坏时拒绝覆盖", () => {
  const human = "# 我的长期记忆\n\n这里是我自己写的说明。\n";
  const once = renderOverview(human, [ENTRY]);
  assert.ok(once.startsWith(human.trimEnd()));
  assert.ok(once.includes(OVERVIEW_START) && once.includes(OVERVIEW_END));
  const twice = renderOverview(once, []);
  assert.ok(twice.startsWith(human.trimEnd()), "再次生成不会重复前言");
  assert.ok(!twice.includes("用户偏好中文回复"));
  assert.equal(renderOverview(`${human}${OVERVIEW_START}`, [ENTRY]), null);
});

test("文件名按日期+摘要生成且自动去重", () => {
  const taken = new Set();
  const first = memoryFileName({ date: "2026-11-18", text: "用户偏好中文回复", taken });
  taken.add(first);
  const second = memoryFileName({ date: "2026-11-18", text: "用户偏好中文回复", taken });
  assert.match(first, /^2026-11-18-用户偏好中文回复$/);
  assert.notEqual(first, second);
});

function makeVault(initial = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set();
  const ensure = (p) => { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/")); };
  for (const p of files.keys()) ensure(p);
  const file = (p) => ({ path: p, name: p.split("/").pop(), children: [] });
  const vault = {
    getAbstractFileByPath(p) {
      if (files.has(p)) return file(p);
      const kids = [...files.keys()].filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes("/"));
      if (!kids.length && !folders.has(p)) return null;
      return { path: p, name: p.split("/").pop(), children: kids.map(file) };
    },
    read: async (f) => files.get(f.path) ?? "",
    modify: async (f, t) => { files.set(f.path, t); },
    create: async (p, t) => { ensure(p); files.set(p, t); return file(p); },
    createFolder: async (p) => { folders.add(p); },
    process: async (f, fn) => { files.set(f.path, fn(files.get(f.path))); },
  };
  return { vault, files };
}

function makePlugin({ dream = {}, files = {} } = {}) {
  const { vault, files: store } = makeVault(files);
  const p = {
    settings: { dream: { ...structuredClone(DEFAULTS.dream), ...dream }, delegate: { confirmFirst: false } },
    jobs: {},
    app: { vault, plugins: {} },
    saveSettings: async () => {},
    notice: () => {},
  };
  return { p, files: store };
}

const LEGACY = [
  "# Agent Deck 长期记忆",
  "",
  "可直接修改。",
  "",
  "## 2026-11-13T08:21:03.959Z",
  "",
  "- **偏好**：用户偏好中文回复 ^dream-aaa",
  "  - 状态：有效",
  "  - 来源：[[日记/2026_11_13#^abc]]（用户日志，第 3—3 行）；原文：以后请用中文回复",
  "- **项目经验**：旧的结论 ^dream-bbb",
  "  - 状态：已被替代",
  "  - 来源：[[日记/2026_11_12]]；原文：旧结论",
  "",
].join("\n");

test("迁移：每条记忆一个文件，状态保留，人工前言留下", async () => {
  const { p, files } = makePlugin({ files: { "Agent Deck/长期记忆.md": LEGACY } });
  const dream = new Dreaming(p, async () => '{"memories":[]}');
  const added = await dream.migrateToStore();
  assert.equal(added, 2);
  assert.equal(p.settings.dream.store, "files");
  const mem = [...files.keys()].filter((k) => k.startsWith("Agent Deck/记忆/") && !k.endsWith("/索引.md"));
  assert.equal(mem.length, 2);
  const states = mem.map((k) => parseMemoryFile(files.get(k)).state).sort();
  assert.deepEqual(states, ["已被替代", "有效"]);
  const note = files.get("Agent Deck/长期记忆.md");
  assert.ok(note.includes("可直接修改。"), "人工前言保留");
  assert.ok(note.includes(OVERVIEW_START));
  assert.equal(memoryEntries(note).length, 2, "概览仍可被旧解析器读取");
});

test("文件库模式：新记忆写成文件，派发时能读到", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  const settings = p.settings;
  files.set(journalPath(p.app, settings, dayKeyToday(settings)), "- TODO 以后请用中文回复 ^user-pref\n  - 💬 AI 记录：构建完成");
  const dream = new Dreaming(p, async () => JSON.stringify({ memories: [{ text: "偏好中文回复", kind: "preference", sources: ["S1"], quotes: [{ source: "S1", text: "以后请用中文回复" }], replaces: [] }] }));
  await dream.run();
  assert.equal(p.settings.dream.lastError, "");
  const mem = [...files.keys()].filter((k) => k.startsWith("Agent Deck/记忆/") && !k.endsWith("/索引.md"));
  assert.equal(mem.length, 1);
  const parsed = parseMemoryFile(files.get(mem[0]));
  assert.equal(parsed.text, "偏好中文回复");
  assert.match(parsed.sources[0], /\[\[日记\/.*#\^/);
  const note = files.get(settings.dream.path);
  assert.ok(note.includes(OVERVIEW_START));
  assert.ok(note.includes("偏好中文回复"));
  assert.match(await dream.contextSection("请用中文回复这句话"), /偏好中文回复/);
});

test("确认与拒绝写回 frontmatter", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("Agent Deck/记忆/2026-11-13-x.md", serializeMemoryFile(ENTRY, [], []));
  const dream = new Dreaming(p, async () => '{"memories":[]}');
  assert.equal(await dream.setEntryState("Agent Deck/记忆/2026-11-13-x.md", "已拒绝"), true);
  let raw = files.get("Agent Deck/记忆/2026-11-13-x.md");
  assert.match(raw, /^state: 已拒绝$/m);
  assert.equal(await dream.setEntryState("Agent Deck/记忆/2026-11-13-x.md", "有效"), true);
  raw = files.get("Agent Deck/记忆/2026-11-13-x.md");
  assert.match(raw, /^state: 有效$/m);
  assert.match(raw, /^verified: true$/m);
  assert.equal(memoryIdOf("用户偏好中文回复"), memoryIdOf("用户偏好中文回复"));
});

test("体检：无来源 / 待确认 / 重复 / 待复核分别计数", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  const write = (name, entry) => files.set(`Agent Deck/记忆/${name}.md`, serializeMemoryFile(entry));
  write("a", { id: "m-1", kind: "fact", text: "有来源的事实", state: "有效", date: "2026-11-18", sources: ["[[日记/x#^a]]"] });
  write("b", { id: "m-2", kind: "fact", text: "没有来源的事实", state: "有效", date: "2026-11-18" });
  write("c", { id: "m-3", kind: "fact", text: "有来源的事实", state: "有效", date: "2026-11-18", sources: ["[[日记/y]]"] });
  write("d", { id: "m-4", kind: "fact", text: "很久以前的事实", state: "有效", date: "2025-01-01", sources: ["[[日记/z]]"] });
  write("e", { id: "m-5", kind: "fact", text: "被拒绝的事实", state: "已拒绝", date: "2026-11-18" });
  const dream = new Dreaming(p, async () => "{}");
  const a = await dream.audit();
  assert.equal(a.entries.length, 5);
  assert.equal(a.noSource.length, 2, "没有 sources 的两条");
  assert.equal(a.unverified.length, 4, "已拒绝的不进待审");
  assert.equal(a.stale.length, 1, "只有 2025-01-01 那条超期");
  assert.equal(a.duplicates.length, 1);
  const report = await dream.healthReport();
  assert.match(report, /\| 无来源 \| 2 \|/);
  assert.match(report, /\| 重复 \| 1 \|/);
  assert.match(report, /没有来源的事实/);
});

test("确认过的记忆不再进待审队列", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "待确认的事实", state: "有效", date: "2026-11-18", sources: ["[[日记/x]]"] }));
  const dream = new Dreaming(p, async () => "{}");
  assert.equal((await dream.audit()).unverified.length, 1);
  await dream.setEntryState("Agent Deck/记忆/a.md", "有效");
  assert.equal((await dream.audit()).unverified.length, 0);
});

test("来源锚点：行号漂移会被发现并按原文改对，原文被改过的只报告不改", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("日记/d.md", ["标题", "第一行", "第二行 用户写错的判断", "第四行"].join("\n"));
  const drifted = `[[日记/d]]（用户日志，第 9—9 行）；原文：第二行 用户写错的判断`;
  const edited = `[[日记/d]]（用户日志，第 3—3 行）；原文：第二行 用户写错的结论`;
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "有漂移的事实", state: "有效", date: "2026-11-18", sources: [drifted] }));
  files.set("Agent Deck/记忆/b.md", serializeMemoryFile({ id: "m-2", kind: "fact", text: "原文被改的事实", state: "有效", date: "2026-11-18", sources: [edited] }));
  const dream = new Dreaming(p, async () => "{}");
  const dry = await dream.verifySources();
  assert.equal(dry.drift.length, 1);
  assert.equal(dry.drift[0].to, 3, "原文实际在第 3 行");
  assert.equal(dry.edited.length, 1, "原文被改过的那条单独归类");
  assert.equal(dry.missing.length, 0);
  await dream.verifySources({ write: true });
  assert.match(files.get("Agent Deck/记忆/a.md"), /第 3—3 行/);
  assert.match(files.get("Agent Deck/记忆/b.md"), /第二行 用户写错的结论/, "原文被改过时保持原样");
  const again = await dream.verifySources();
  assert.equal(again.drift.length, 0, "改完不再漂");
});

test("给原文补块号：只追加行尾、幂等、并把记忆来源升级成块号引用", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  const journal = ["标题", "", "- 用户写的判断原文", "- 另一条用户内容"].join("\n");
  files.set("日记/d.md", journal);
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "用户写的判断", state: "有效", date: "2026-11-18", sources: ["[[日记/d]]（用户日志，第 3—3 行）；原文：用户写的判断原文"] }));
  const dream = new Dreaming(p, async () => "{}");
  const dry = await dream.ensureSourceAnchors();
  assert.equal(dry.added, 1);
  assert.equal(files.get("日记/d.md"), journal, "dry run 不写盘");
  const done = await dream.ensureSourceAnchors({ write: true });
  assert.equal(done.added, 1);
  assert.equal(done.rewritten, 1);
  const after = files.get("日记/d.md");
  assert.match(after, /^- 用户写的判断原文 \^mem-[0-9a-f]{8}$/m, "只在行尾追加块号");
  assert.equal(after.split("\n").length, journal.split("\n").length, "不增删行");
  const mem = files.get("Agent Deck/记忆/a.md");
  assert.match(mem, /\[\[日记\/d#\^mem-[0-9a-f]{8}\]\]/);
  const again = await dream.ensureSourceAnchors({ write: true });
  assert.equal(again.added, 0, "跑第二次不再加");
  assert.equal(files.get("日记/d.md"), after);
});

test("反向跳转：只在列表项下补一行回链，段落跳过，重复跑不叠加", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("日记/d.md", ["- 列表里的判断原文", "\t- 已有子项", "", "段落里的判断原文", ""].join("\n"));
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "列表判断", state: "有效", date: "2026-11-18", sources: ["[[日记/d#^mem-aaaa1111]]（用户日志，第 1—1 行）；原文：列表里的判断原文"] }));
  files.set("Agent Deck/记忆/b.md", serializeMemoryFile({ id: "m-2", kind: "fact", text: "段落判断", state: "有效", date: "2026-11-18", sources: ["[[日记/d#^mem-bbbb2222]]（用户日志，第 4—4 行）；原文：段落里的判断原文"] }));
  const dream = new Dreaming(p, async () => "{}");
  // 块号尚不存在时按原文定位，仍能判断是不是列表项
  const dry = await dream.ensureReverseLinks();
  assert.equal(dry.linked, 1, "只有列表项会被加回链");
  assert.equal(dry.skipped, 1, "段落跳过");
  assert.equal(files.get("日记/d.md").includes("⤴"), false, "dry run 不写盘");
  const done = await dream.ensureReverseLinks({ write: true });
  assert.equal(done.linked, 1);
  const after = files.get("日记/d.md");
  assert.equal(after, ["- 列表里的判断原文", "\t- 已有子项", "\t- ⤴ [[Agent Deck/记忆/a]]", "", "段落里的判断原文", ""].join("\n"));
  const again = await dream.ensureReverseLinks({ write: true });
  assert.equal(again.linked, 1, "每次先清后加，结果稳定");
  assert.equal(files.get("日记/d.md"), after, "重复运行不叠加、不漂移");
});

test("记忆被删除后，原文里的孤儿回链会在下次运行时清掉", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("日记/d.md", ["- 判断原文", ""].join("\n"));
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "判断", state: "有效", date: "2026-11-18", sources: ["[[日记/d#^mem-a1]]（用户日志，第 1—1 行）；原文：判断原文"] }));
  const dream = new Dreaming(p, async () => "{}");
  await dream.ensureReverseLinks({ write: true });
  assert.match(files.get("日记/d.md"), /⤴/);
  files.delete("Agent Deck/记忆/a.md");
  await dream.ensureReverseLinks({ write: true });
  assert.doesNotMatch(files.get("日记/d.md"), /⤴/, "记忆没了，回链也要消失");
  assert.deepEqual(p.settings.dream.backlinked, [], "清理后不再记账");
});

test("用户改过的回链行不会被再加一条（避免重复）", async () => {
  const { p, files } = makePlugin({ dream: { store: "files" } });
  files.set("日记/d.md", ["- 判断原文", "\t- ⤴ [[Agent Deck/记忆/a]] ← 我补的话", ""].join("\n"));
  files.set("Agent Deck/记忆/a.md", serializeMemoryFile({ id: "m-1", kind: "fact", text: "判断", state: "有效", date: "2026-11-18", sources: ["[[日记/d#^mem-a1]]（用户日志，第 1—1 行）；原文：判断原文"] }));
  const dream = new Dreaming(p, async () => "{}");
  const done = await dream.ensureReverseLinks({ write: true });
  assert.equal(done.linked, 0);
  assert.equal(done.already, 1);
  const text = files.get("日记/d.md");
  assert.equal(text.split("⤴").length - 1, 1, "只保留用户那一行");
  assert.match(text, /← 我补的话/);
});

test("frontmatter 里的双链必须加引号，否则 Obsidian 整段解析失败", () => {
  const raw = serializeMemoryFile(ENTRY);
  assert.match(raw, /  - "\[\[日记\/2026_11_13#\^abc\]\]/, "sources 列表项要带引号");
  assert.ok(!/  - \[\[/.test(raw), "不能再出现裸 [[" );
});

test("审阅起点跟随光标：记忆文件本身 / 日记里的回链行 / 都没有则第一条", async () => {
  const { orderForReview } = await import("../src/memory-store.js");
  const entries = [{ path: "Agent Deck/记忆/a.md" }, { path: "Agent Deck/记忆/b.md" }, { path: "Agent Deck/记忆/c.md" }];
  const dir = "Agent Deck/记忆";
  assert.deepEqual(orderForReview(entries, { path: "Agent Deck/记忆/b.md", dir }).map((e) => e.path), ["Agent Deck/记忆/b.md", "Agent Deck/记忆/c.md", "Agent Deck/记忆/a.md"]);
  assert.deepEqual(orderForReview(entries, { line: "\t- ⤴ [[Agent Deck/记忆/c]]", dir }).map((e) => e.path), ["Agent Deck/记忆/c.md", "Agent Deck/记忆/a.md", "Agent Deck/记忆/b.md"]);
  assert.deepEqual(orderForReview(entries, { path: "日记/x.md", line: "- 普通一行", dir }).map((e) => e.path), ["Agent Deck/记忆/a.md", "Agent Deck/记忆/b.md", "Agent Deck/记忆/c.md"]);
  assert.deepEqual(orderForReview(entries, {}).length, 3);
});

test("记忆索引：一个文件列出全部标题与链接，按日期倒序", async () => {
  const { renderMemoryIndex } = await import("../src/memory-store.js");
  const text = renderMemoryIndex([
    { path: "记忆/a.md", kind: "fact", title: "旧的事", date: "2026-11-01" },
    { path: "记忆/b.md", kind: "lesson", title: "新的经验", date: "2026-11-18" },
  ], "2026-11-18 05:30");
  const lines = text.split("\n");
  assert.match(lines[0], /^# 记忆索引$/);
  assert.match(text, /共 2 条/);
  assert.ok(text.indexOf("新的经验") < text.indexOf("旧的事"), "日期新的在前");
  assert.match(text, /\[\[记忆\/b\]\]/);
  assert.match(renderMemoryIndex([]), /还没有记忆/);
});
