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
  const mem = [...files.keys()].filter((k) => k.startsWith("Agent Deck/记忆/") && !k.endsWith("/索引.md") && !k.endsWith("/log.md"));
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
  assert.ok(!/\n\nverified: true/.test(raw), "frontmatter 内不出现多余空行");
  assert.equal(await dream.setEntryState("Agent Deck/记忆/2026-11-13-x.md", "有效"), false, "已是有效且 verified 时再次确认应为空操作");
  assert.equal(await dream.setEntryState("Agent Deck/记忆/2026-11-13-x.md", "已被替代"), true);
  assert.equal(await dream.setEntryState("Agent Deck/记忆/2026-11-13-x.md", "有效"), true);
  raw = files.get("Agent Deck/记忆/2026-11-13-x.md");
  const fm = raw.split("\n---\n")[0];
  assert.ok(!/\n\n/.test(fm), "多次状态切换后 frontmatter 内无空行积累");
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

test("模式 A（外部记忆直接拆条）：兼容 Claude memories.json、列表笔记与单条记忆文件", async () => {
  const { parseMarkdownToMemories } = await import("../src/memory-store.js");
  const claudeJson = JSON.stringify({
    memory_files: [
      {
        path: "/preferences.md",
        updated_at: "2026-08-18T01:49:01.000Z",
        content: "---\nname: preferences\n---\n- [stated] 用户要求涉及数字时必须核实一手信息\n- [stated] 用户推断，社会共识往往依赖经典案例构建（待验证）\n",
      },
    ],
  });
  const listMd = [
    "---",
    "date: 2026-09-12",
    "---",
    "- **项目经验**：在 RAG 系统中设置拒答门槛可避免无谓计费",
    "- 用户的日常座驾为 2025 年购入的极氪 7X",
  ].join("\n");

  const items = parseMarkdownToMemories([
    { name: "memories.json", content: claudeJson },
    { name: "笔记.md", path: "收件箱/笔记.md", content: listMd },
    { name: "single.md", content: serializeMemoryFile(ENTRY) },
  ]);
  assert.equal(items.length, 5);
  assert.equal(items[0].kind, "preference");
  assert.equal(items[0].date, "2026-08-18");
  assert.equal(items[1].kind, "pattern");
  assert.equal(items[2].kind, "lesson");
  assert.equal(items[3].kind, "fact");
  assert.equal(items[4].id, ENTRY.id);
});

test("批量导入（importEntries）与模式 B（extractFromDocs）：自动建库、去重并生成 Base 视图", async () => {
  const { parseMarkdownToMemories } = await import("../src/memory-store.js");
  const { p, files } = makePlugin({ files: { "Agent Deck/长期记忆.md": "# Agent Deck 长期记忆\n" } });
  const dream = new Dreaming(p, async () =>
    JSON.stringify({
      memories: [
        {
          text: "用户需要 7.5 小时睡眠并采用 R90 睡眠法",
          kind: "fact",
          sources: ["S1"],
          quotes: [{ source: "S1", text: "需要 7.5 小时睡眠，用 R90 睡眠法" }],
          replaces: [],
        },
      ],
    }),
  );

  // 模式 B：从长文档提炼候选记忆
  const extracted = await dream.extractFromDocs([
    { name: "self.md", path: "笔记/self.md", date: "2026-09-12", content: "- 需要 7.5 小时睡眠，用 R90 睡眠法（按 90 分钟一个周期算）" },
  ]);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].kind, "fact");
  assert.equal(extracted[0].date, "2026-09-12");

  // 模式 A + B 统一走 importEntries 落盘
  const direct = parseMarkdownToMemories([{ name: "pref.md", content: "- [stated] 用户偏好中文回复" }], { defaultDate: "2026-11-18" });
  const res1 = await dream.importEntries([...extracted, ...direct]);
  assert.equal(res1.added, 2);
  assert.equal(res1.skipped, 0);
  assert.equal(p.settings.dream.store, "files", "尚未开启文件库时自动迁移开启");
  assert.ok(files.has("Agent Deck/记忆.base"), "自动补齐 记忆.base");
  assert.ok(files.has("Agent Deck/记忆/索引.md"), "自动刷新索引");

  // 重复导入同一批，自动跳过
  const res2 = await dream.importEntries([...extracted, ...direct]);
  assert.equal(res2.added, 0);
  assert.equal(res2.skipped, 2);
});

test("记忆.base 增删与行内编辑兼容：排除索引.md、补齐空白新建行、同步 title 与正文", async () => {
  const { memoryBase, parseMemoryFile, reconcileMemoryFile } = await import("../src/memory-store.js");
  const baseYaml = memoryBase("Agent Deck/记忆");
  assert.match(baseYaml, /file\.path != "Agent Deck\/记忆\/索引\.md"/, "记忆.base 默认过滤掉 索引.md");

  // 1. Base 点击「新建」生成的空白模板：自动补齐默认值，保留在待确认视图
  const blank = "---\ntitle:\ntype:\nstate:\ndate:\n---\n";
  const filledDefaults = reconcileMemoryFile(blank, { today: "2026-11-19" });
  assert.ok(filledDefaults);
  assert.match(filledDefaults, /^type: 事实$/m);
  assert.match(filledDefaults, /^kind: fact$/m);
  assert.match(filledDefaults, /^state: 有效$/m);
  assert.match(filledDefaults, /^date: 2026-11-19$/m);

  // 2. 用户在 Base 表格内填写 title 与 type（正文为空），parseMemoryFile 直接可读，reconcileMemoryFile 同步正文与 id
  const editedInBase = "---\ntitle: \"用户周末不排长耗时电脑任务\"\ntype: 偏好\nstate: 有效\ndate: 2026-11-19\n---\n";
  const parsed = parseMemoryFile(editedInBase);
  assert.ok(parsed);
  assert.equal(parsed.kind, "preference");
  assert.equal(parsed.text, "用户周末不排长耗时电脑任务");

  const synced = reconcileMemoryFile(editedInBase, { today: "2026-11-19" });
  assert.ok(synced);
  assert.match(synced, /^id: m-/m);
  assert.match(synced, /^kind: preference$/m);
  assert.match(synced, /\n\n用户周末不排长耗时电脑任务\n$/);
  assert.equal(reconcileMemoryFile(synced, { today: "2026-11-19" }), null, "已同步的记忆再次规范化应幂等");

  // 3. 在 Base 里修改 title 时，正文同步更新
  const renamedInBase = synced.replace("用户周末不排长耗时电脑任务", "用户周六日全天上课，不排电脑任务");
  const resynced = reconcileMemoryFile(renamedInBase, { today: "2026-11-19" });
  assert.ok(resynced);
  assert.match(resynced, /\n\n用户周六日全天上课，不排电脑任务\n$/);

  // 4. createEntry 新建并写入文件 + 刷新索引与长期记忆
  const { p, files } = makePlugin({ files: { "Agent Deck/长期记忆.md": "# Agent Deck 长期记忆\n" } });
  const dream = new Dreaming(p);
  const created = await dream.createEntry({ text: "测试 Base 新建记忆条目", kind: "lesson", date: "2026-11-19" });
  assert.ok(files.has(created.path));
  assert.match(files.get("Agent Deck/记忆/索引.md"), /测试 Base 新建记忆条目/);
  assert.match(files.get("Agent Deck/长期记忆.md"), /测试 Base 新建记忆条目/);
});

test("模式 B 按文档分批提炼：多文档分别送入模型、避免后序文档被 12 条上限饿死", async () => {
  const { p } = makePlugin({ files: { "Agent Deck/长期记忆.md": "# Agent Deck 长期记忆\n" } });
  let calls = 0;
  const dream = new Dreaming(p, async (prompt) => {
    calls++;
    if (prompt.includes("doc1.md")) {
      return JSON.stringify({
        memories: [{ text: "来自第一篇的长期偏好", kind: "preference", sources: ["S1"], quotes: [{ source: "S1", text: "第一篇原文" }], replaces: [] }],
      });
    }
    return JSON.stringify({
      memories: [{ text: "来自第二篇的项目经验", kind: "lesson", sources: ["S2"], quotes: [{ source: "S2", text: "第二篇原文" }], replaces: [] }],
    });
  });

  const out = await dream.extractFromDocs([
    { name: "doc1.md", path: "doc1.md", date: "2026-11-18", content: "- 第一篇原文" },
    { name: "doc2.md", path: "doc2.md", date: "2026-11-19", content: "- 第二篇原文" },
  ]);
  assert.equal(calls, 2, "两篇独立文档应各自独立提炼");
  assert.equal(out.length, 2);
  assert.equal(out[0].date, "2026-11-18");
  assert.equal(out[1].date, "2026-11-19");
});

test("隐私与修复回归：rewriteSources 加引号、writeEntry 写全元数据、renderMemoryList/Index 过滤 private、自定义 dir 回链、空 state 容错", async () => {
  const { p, files } = makePlugin({ dream: { store: "files", dir: "自定义/记忆" } });
  const dream = new Dreaming(p, async () => "{}");

  // 1. writeEntry 完整保留 project/tags/supersedes/verified
  const writtenPath = await dream.writeEntry({
    id: "m-meta",
    kind: "lesson",
    text: "Agent Deck 需先打包再装库",
    date: "2026-11-20",
    project: "agent-deck",
    tags: ["esbuild", "deploy"],
    supersedes: ["m-old"],
    verified: true,
  }, ["[[日记/2026_11_20]]（用户日志，第 5—5 行）；原文：先打包再装库"]);
  const writtenRaw = files.get(writtenPath);
  assert.match(writtenRaw, /^project: agent-deck$/m);
  assert.match(writtenRaw, /^verified: true$/m);
  assert.match(writtenRaw, /^supersedes:\n  - "m-old"$/m);

  // 2. rewriteSources 必须加 YAML 引号（防止 [[...]] 被解析为嵌套数组）
  await dream.rewriteSources(writtenPath, ["[[日记/2026_11_20#^mem-1234]]（用户日志，第 8—8 行）；原文：先打包再装库"]);
  const afterRewrite = files.get(writtenPath);
  assert.match(afterRewrite, /  - "\[\[日记\/2026_11_20#\^mem-1234\]\]/);
  assert.ok(!/  - \[\[/.test(afterRewrite));

  // 3. renderMemoryList 与 renderMemoryIndex 过滤 private: true 和非有效状态
  const privPath = await dream.writeEntry({ id: "m-priv", kind: "fact", text: "绝密记忆内容", date: "2026-11-21", private: true }, []);
  assert.ok(files.get(privPath).includes("private: true"));
  await dream.syncOverview();
  assert.ok(!files.get("Agent Deck/长期记忆.md").includes("绝密记忆内容"), "private 记忆绝不进概览");
  assert.ok(!files.get("自定义/记忆/索引.md").includes("绝密记忆内容"), "private 记忆绝不进索引");

  // 4. 空 state: 容错并修复 setEntryState
  const malformedPath = "自定义/记忆/2026-11-17-malformed.md";
  files.set(malformedPath, "---\nid: m-mal\ntitle:\nkind: lesson\ntype:\nstate:\ndate: 2026-11-17\n---\n\n空状态测试条目\n");
  assert.equal(await dream.setEntryState(malformedPath, "有效"), true);
  assert.match(files.get(malformedPath), /^state: 有效$/m);
  assert.match(files.get(malformedPath), /^verified: true$/m);

  // 5. 自定义 dream.dir 下 ensureReverseLinks 清理与防重正常工作
  files.set("日记/2026_11_20.md", ["- 先打包再装库 ^mem-1234", ""].join("\n"));
  const rev = await dream.ensureReverseLinks({ write: true });
  assert.equal(rev.linked, 1);
  assert.match(files.get("日记/2026_11_20.md"), /- ⤴ \[\[自定义\/记忆\//);
  const revAgain = await dream.ensureReverseLinks({ write: true });
  assert.equal(revAgain.linked, 1);
  assert.equal(files.get("日记/2026_11_20.md").split("⤴").length - 1, 1);
});

test("OKF v0.2 元数据往返、衍生可信度/过期判定、log.md 与 0-Token 回填", async () => {
  const { appendMemoryLogContent, deriveProvenance, deriveTrustLevel, isMemoryStale } = await import("../src/memory-store.js");
  const okfMd = serializeMemoryFile({
    id: "m-okf",
    kind: "pattern",
    text: "测试按 OKF v0.2 写入可追溯元数据",
    state: "有效",
    date: "2026-11-26",
    description: "验证 OKF 字段完整性",
    project: "agent-deck",
    appliesTo: "dream-module",
    domain: "engineering",
    tags: ["okf", "memory"],
    generatedBy: "dream",
    verified: true,
    verifiedBy: "human:chenchen",
    verifiedAt: "2026-11-26",
    verdict: "confirmed",
    validFrom: "2026-11-01",
    staleAfter: "2026-12-31",
    supersededBy: "",
    sources: ["[[日记/2026_11_26#^mem-abcd]]（用户日志，第 1—1 行）；原文：测试"],
  });
  const parsed = parseMemoryFile(okfMd);
  assert.equal(parsed.status, "active");
  assert.equal(parsed.description, "验证 OKF 字段完整性");
  assert.equal(parsed.appliesTo, "dream-module");
  assert.equal(parsed.provenance, "user-log");
  assert.equal(parsed.trust, "human-reviewed");
  assert.equal(parsed.verifiedBy, "human:chenchen");
  assert.equal(parsed.verdict, "confirmed");
  assert.equal(parsed.staleAfter, "2026-12-31");

  // 嵌套 OKF v0.2 格式解析 + deriveTrustLevel / isMemoryStale
  const nestedOkf = "---\ntype: 经验\ndescription: \"嵌套格式\"\nstatus: deprecated\ngenerated: { by: \"ai:codex\", at: \"2026-11-25\" }\nverified: { by: \"human:chenchen\", at: \"2026-11-26\" }\nstale_after: 2025-01-01\nsources:\n  - \"[[日记/2026_11_25]]（AI 记录，第 2—2 行）；原文：记录\"\n---\n\n嵌套 OKF 元数据条目\n";
  const parsedNested = parseMemoryFile(nestedOkf);
  assert.equal(parsedNested.state, "已被替代");
  assert.equal(parsedNested.generatedBy, "ai:codex");
  assert.equal(parsedNested.verifiedBy, "human:chenchen");
  assert.equal(parsedNested.provenance, "ai-log");
  assert.equal(parsedNested.trust, "human-reviewed");
  assert.equal(isMemoryStale(parsedNested, Date.parse("2026-11-26")), true);
  assert.equal(deriveProvenance(["[[日记/x]]（AI 记录，第 1—1 行）；原文：x"]), "ai-log");
  assert.equal(deriveTrustLevel({ verified: false, provenance: "ai-log" }), "ai-derived");

  const log1 = appendMemoryLogContent("", { date: "2026-11-26", action: "Creation", summary: "新增 2 条", items: ["m-1", "m-2"] });
  assert.match(log1, /## 2026-11-26/);
  assert.match(log1, /\*\*Creation\*\*：新增 2 条/);

  // 0-Token 回填：修复空 state:、补齐 status/provenance/verdict、从 sources 推断项目且不误读 log.md
  const { p, files } = makePlugin({
    dream: { store: "files" },
  });
  p.settings.projectFolders = { "agent-deck": "/tmp/agent-deck" };
  files.set("Agent Deck/记忆/2026-11-17-bad.md", "---\nid: m-bad\ntitle: \"在 agent-deck 中保持回填安全\"\nkind: pattern\ntype: 待验证规律\nstate:\ndate: 2026-11-17\nsources:\n  - \"[[日记/2026_11_17]]（用户日志，第 1—1 行）；原文：回填\"\n---\n\n在 agent-deck 中保持回填安全\n");
  files.set("Agent Deck/记忆/log.md", log1);
  const dream = new Dreaming(p, async () => "{}");
  const bf = await dream.backfillOkfMetadata();
  assert.equal(bf.checked, 1, "log.md 不得被当成记忆条目读取");
  assert.equal(bf.updated, 1);
  assert.equal(bf.repairedState, 1);
  assert.equal(bf.inferredProject, 1);
  const patched = parseMemoryFile(files.get("Agent Deck/记忆/2026-11-17-bad.md"));
  assert.equal(patched.state, "有效");
  assert.equal(patched.status, "active");
  assert.equal(patched.provenance, "user-log");
  assert.equal(patched.verdict, "pending");
  assert.equal(patched.project, "agent-deck");
  assert.match(files.get("Agent Deck/记忆/log.md"), /\*\*OKF-Backfill\*\*/);
});

test("图谱融合：纯双链 concepts/project_link/source_notes 往返、短命题命名与 renameShort 升级", async () => {
  const raw = serializeMemoryFile({
    id: "m-graph1",
    kind: "lesson",
    text: "使用 Obsidian 关系图谱与单元测试验证记忆演化链路",
    state: "有效",
    date: "2026-11-26",
    projectLink: "[[Agent Deck]]",
    concepts: ["[[Obsidian]]", "[[单元测试]]"],
    conflictsWith: ["[[旧规范]]"],
    sources: ["[[日记/2026_11_26#^mem-1122]]（用户日志，第 2—2 行）；原文：验证记忆演化"],
  });
  const parsed = parseMemoryFile(raw);
  assert.equal(parsed.projectLink, "[[Agent Deck]]");
  assert.deepEqual(parsed.concepts, ["[[Obsidian]]", "[[单元测试]]"]);
  assert.deepEqual(parsed.sourceNotes, ["[[日记/2026_11_26#^mem-1122]]"]);
  assert.deepEqual(parsed.conflictsWith, ["[[旧规范]]"]);

  const shortName = memoryFileName({ date: "2026-11-26", text: "用户在 A 股投资中不买红利股与消费股", preferShort: true });
  assert.ok(!shortName.startsWith("2026-11-26-"));
  assert.match(shortName, /^A/);

  const { p, files } = makePlugin({
    dream: { store: "files" },
    files: {
      "Concepts/有损压缩.md": "# 有损压缩\n",
      "软件与数字工具/Obsidian.md": "# Obsidian\n",
      "Agent Deck.md": "# Agent Deck\n",
      "日记/2026_11_18.md": "- 有损压缩试验\n",
      "Agent Deck/记忆/2026-11-18-用户在Obsidian中做有损压缩试验测试.md": [
        "---",
        "id: m-old1",
        'title: "用户在 Obsidian 中做有损压缩试验测试"',
        "kind: fact",
        "type: 事实",
        "state: 有效",
        "date: 2026-11-18",
        "sources:",
        '  - "[[日记/2026_11_18#^mem-8899]]（用户日志，第 5—5 行）；原文：有损压缩试验"',
        '  - "[[areas/nonexistent-import]]（导入来源）"',
        "---",
        "",
        "用户在 Obsidian 中做有损压缩试验测试",
        "",
      ].join("\n"),
    },
  });
  p.app.vault.getMarkdownFiles = () => [...files.keys()].filter((k) => k.endsWith(".md")).map((path) => ({ path, extension: "md" }));
  p.app.metadataCache = {
    ...(p.app.metadataCache || {}),
    getFirstLinkpathDest: (link) => {
      const clean = String(link || "").replace(/\.md$/, "");
      for (const k of files.keys()) if (k === `${clean}.md` || k.endsWith(`/${clean}.md`)) return { path: k };
      return null;
    },
  };
  p.app.vault.rename = async (f, nextPath) => {
    const content = files.get(f.path);
    files.delete(f.path);
    files.set(nextPath, content);
  };
  const dream = new Dreaming(p, async () => "{}");
  const up = await dream.backfillOkfMetadata({ dryRun: false, renameShort: true, relinkGraph: true });
  assert.equal(up.updated, 1);
  assert.equal(up.renamed, 1);
  assert.ok(up.linkedConcepts >= 2);
  assert.equal(up.linkedSources, 1);
  const renamedKey = [...files.keys()].find((k) => k.startsWith("Agent Deck/记忆/") && !k.endsWith("/索引.md") && !k.endsWith("/log.md"));
  assert.ok(renamedKey && !renamedKey.includes("2026-11-18-"), "旧长文件名已升为短命题文件名");
  const after = parseMemoryFile(files.get(renamedKey));
  assert.ok(after.concepts.includes("[[Obsidian]]"));
  assert.ok(after.concepts.includes("[[有损压缩]]"));
  assert.deepEqual(after.sourceNotes, ["[[日记/2026_11_18#^mem-8899]]"], "ghost source_notes 应过滤，只保留库内真实存在的笔记");
  assert.match(files.get("Agent Deck/记忆.base"), /concepts/);
  assert.match(files.get("Agent Deck/记忆.base"), /!file\.inFolder\("Agent Deck\/记忆\/archive"\)/);
  assert.equal(await dream.reconcileFile({ path: "Agent Deck/记忆/2026-11-18-用户在Obsidian中做有损压缩试验测试.md" }), false, "重命名后旧路径触发 reconcile 不报错");
});

test("冲突边幂等写入、锚点分类口径、updateEntry 保字段、以及 archive/restore 生命周期", async () => {
  const { appendFrontmatterLinks, classifyAnchorStatus } = await import("../src/memory-store.js");
  const baseMd = "---\nid: m-1\nkind: fact\nstate: 有效\nconcepts:\n  - \"[[Obsidian]]\"\n---\n\n测试正文\n";
  const withConf1 = appendFrontmatterLinks(baseMd, "conflicts_with", ["[[Agent Deck/记忆/冲突A]]", "[[Agent Deck/记忆/冲突B]]"]);
  assert.match(withConf1, /^conflicts_with:\n  - "\[\[Agent Deck\/记忆\/冲突A\]\]"\n  - "\[\[Agent Deck\/记忆\/冲突B\]\]"/m);
  assert.equal(appendFrontmatterLinks(withConf1, "conflicts_with", ["[[Agent Deck/记忆/冲突A]]"]), null, "重复追加冲突链接应幂等");

  // 锚点分类：区分库内日记可补锚 vs 外部导入/MCP 免补锚
  assert.equal(classifyAnchorStatus({ provenance: "import", sources: ["[[areas/ext]]（导入）"] }, { existsInVault: () => false }).externalImportOnly, true);
  assert.equal(classifyAnchorStatus({ provenance: "manual", sources: ["agent-mcp"] }).externalImportOnly, true);
  assert.equal(classifyAnchorStatus({ provenance: "user-log", sources: ["[[日记/2026_11_20]]（用户日志，第 3—3 行）；原文：x"] }, { existsInVault: () => true }).unanchoredVault, true);
  assert.equal(classifyAnchorStatus({ provenance: "user-log", sources: ["[[日记/2026_11_20#^mem-1234]]（用户日志）"] }).anchored, true);

  const { p, files } = makePlugin({
    dream: { store: "files", archiveAfterDays: 30 },
    files: {
      "日记/2026_11_20.md": "- 原文",
    },
  });
  p.app.vault.rename = async (f, nextPath) => {
    const content = files.get(f.path);
    files.delete(f.path);
    files.set(nextPath, content);
  };
  p.app.metadataCache = {
    getFirstLinkpathDest: (link) => {
      const clean = String(link || "").replace(/\.md$/, "");
      return files.has(`${clean}.md`) ? { path: `${clean}.md` } : null;
    },
  };
  const dream = new Dreaming(p, async () => "{}");

  // 1. updateEntry 保留已有 OKF 与图谱边字段
  const richPath = "Agent Deck/记忆/富字段.md";
  files.set(richPath, serializeMemoryFile({
    id: "m-rich",
    kind: "lesson",
    text: "编辑后应保留图谱边与 OKF 元数据",
    state: "有效",
    date: "2026-11-20",
    description: "保留字段测试",
    concepts: ["[[Obsidian]]"],
    projectLink: "[[Agent Deck]]",
    conflictsWith: ["[[旧条目]]"],
    staleAfter: "2026-12-31",
    sources: ["[[日记/2026_11_20]]（用户日志，第 1—1 行）；原文：原文"],
  }));
  await dream.updateEntry(richPath, { text: "编辑后依然保留图谱边与 OKF 元数据", verified: true });
  const afterUpdate = parseMemoryFile(files.get(richPath));
  assert.deepEqual(afterUpdate.concepts, ["[[Obsidian]]"]);
  assert.equal(afterUpdate.projectLink, "[[Agent Deck]]");
  assert.deepEqual(afterUpdate.conflictsWith, ["[[旧条目]]"]);
  assert.equal(afterUpdate.description, "保留字段测试");
  assert.equal(afterUpdate.staleAfter, "2026-12-31");

  // 2. 外部导入条不计入缺硬锚点警告；超期失效条自动归档并可恢复
  files.set("Agent Deck/记忆/导入条.md", serializeMemoryFile({
    id: "m-imp",
    kind: "fact",
    text: "从外部导入的经验条目",
    state: "有效",
    date: "2026-11-20",
    provenance: "import",
    sources: ["Claude 记忆导出（/topics/a.md）；原文：导入经验"],
  }));
  files.set("Agent Deck/记忆/超期已替代.md", serializeMemoryFile({
    id: "m-arch",
    kind: "fact",
    text: "2025 年初已被替代的旧记录",
    state: "已被替代",
    date: "2025-01-01",
    sources: [],
  }));
  const auditBefore = await dream.audit();
  assert.equal(auditBefore.unanchoredVaultSources, 1, "只有库内日记未锚定条目计入库内可补锚");
  assert.equal(auditBefore.externalImportSources, 1, "外部导入条目单独计数，不制造假告警");
  assert.equal(auditBefore.conflicting.length, 1);
  assert.equal(auditBefore.archivableCount, 1);
  const report = await dream.healthReport();
  assert.match(report, /缺硬锚点（库内可补） \| 1/);
  assert.match(report, /外部导入\/非库来源 1 条免补锚/);
  assert.match(report, /冲突待裁决 \| 1/);

  const archRes = await dream.archiveDeprecated({ nowMs: Date.parse("2026-11-26") });
  assert.equal(archRes.archived, 1);
  assert.ok(files.has("Agent Deck/记忆/archive/超期已替代.md"));
  assert.ok(!files.has("Agent Deck/记忆/超期已替代.md"));
  assert.match(files.get("Agent Deck/记忆/log.md"), /\*\*Archive\*\*/);

  const restored = await dream.restoreArchivedEntry("Agent Deck/记忆/archive/超期已替代.md", { reactivate: true });
  assert.equal(restored.restored, true);
  assert.ok(files.has("Agent Deck/记忆/超期已替代.md"));
  assert.equal(parseMemoryFile(files.get("Agent Deck/记忆/超期已替代.md")).state, "有效");
  assert.match(files.get("Agent Deck/记忆/log.md"), /\*\*Restore\*\*/);

  // 3. Round 2 边界：清理后的 source_notes 不复活死链、reconcile 同步 verified、拒绝/归档双向清理冲突边
  const { reconcileMemoryFile, renderMemoryIndex, removeFrontmatterLinks } = await import("../src/memory-store.js");
  const stripped = serializeMemoryFile({
    id: "m-dead",
    kind: "fact",
    text: "来源已从库外删除但保留历史摘录",
    sources: ["[[日记/已删笔记]]（用户日志，第 1—1 行）；原文：旧摘录"],
    sourceNotes: [],
  });
  assert.deepEqual(parseMemoryFile(stripped).sourceNotes, [], "显式清空的 sourceNotes 不得在序列化/解析时复活");
  const baseVerifiedRec = reconcileMemoryFile("---\nid: m-pv\ntitle: \"测试规律\"\nkind: pattern\ntype: 待验证规律\nstate: 有效\nstatus: active\ndate: 2026-11-26\nverified: true\n---\n\n测试规律\n", { today: "2026-11-26" });
  assert.match(baseVerifiedRec, /^verdict: confirmed$/m);
  assert.match(baseVerifiedRec, /^verified_by: "?human:user"?$/m);
  const idxText = renderMemoryIndex([afterUpdate]);
  assert.ok(idxText.includes("高频概念："));
  assert.ok(idxText.includes("[[Agent Deck]](1)"));
  assert.ok(idxText.includes("[[Obsidian]](1)"));

  files.set("Agent Deck/记忆/冲突A.md", serializeMemoryFile({ id: "m-ca", kind: "fact", text: "规则 A", date: "2026-11-26", conflictsWith: ["[[Agent Deck/记忆/冲突B]]"] }));
  files.set("Agent Deck/记忆/冲突B.md", serializeMemoryFile({ id: "m-cb", kind: "fact", text: "规则 B", date: "2026-11-26", conflictsWith: ["[[Agent Deck/记忆/冲突A]]"] }));
  await dream.setEntryState("Agent Deck/记忆/冲突B.md", "已拒绝");
  assert.deepEqual(parseMemoryFile(files.get("Agent Deck/记忆/冲突A.md")).conflictsWith, [], "淘汰冲突一侧应自动清理另一侧残余冲突边");
  assert.equal(removeFrontmatterLinks("---\nconflicts_with:\n  - \"[[foo]]\"\n---\n", "conflicts_with", ["foo"])?.includes("conflicts_with"), false);
});
