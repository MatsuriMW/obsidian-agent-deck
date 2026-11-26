import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  loadMemories,
  searchMemories,
  recentMemories,
  findMemory,
  memoryDirOf,
  resolveVault,
  parseMemory,
  neighborsOf,
  inDateRange,
  run,
} from "../scripts/memory-query.mjs";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "memory-query.mjs");

// 造一个库：.obsidian 存在 + 记忆目录里三条记忆（两条同词、一条无关）。
function makeVault({ dreamDir = "Agent Deck/记忆" } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mem-"));
  fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"), JSON.stringify({ settings: { dream: { dir: dreamDir } } }));
  const dir = path.join(vault, dreamDir);
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  write(
    "2026-11-17-a.md",
    [
      "---",
      'id: m-a',
      'title: "在 RAG 系统中设置拒答门槛，避免无谓的生成开销。"',
      "kind: lesson",
      "type: 项目经验",
      "state: 有效",
      "date: 2026-11-17",
      "sources:",
      '  - "[[日记/2026_11_06#^mem-730d323d]]（用户日志，第 32 行）；原文：设置拒答门槛"',
      "---",
      "",
      "在 RAG 系统中设置拒答门槛，避免无谓的生成开销。",
      "",
    ].join("\n"),
  );
  write(
    "2026-11-17-b.md",
    [
      "---",
      "id: m-b",
      'title: "拒答门槛要配合重排打分。"',
      "kind: pattern",
      "type: 待验证规律",
      "state: 有效",
      "date: 2026-11-17",
      "sources:",
      '  - "[[日记/2026_11_04#^mem-216bc861]]"',
      "---",
      "",
      "拒答门槛要配合重排打分。",
      "",
    ].join("\n"),
  );
  write(
    "2026-11-16-c.md",
    ["---", "id: m-c", 'title: "已拒绝的老结论。"', "kind: fact", "type: 事实", "state: 已拒绝", "date: 2026-11-16", "---", "", "关于拒答门槛的老结论。", ""].join("\n"),
  );
  write(
    "2026-11-18-e.md",
    [
      "---",
      "id: m-e",
      'title: "拒答门槛改成按场景分档，不再一刀切。"',
      "kind: preference",
      "type: 偏好",
      "state: 有效",
      "date: 2026-11-18",
      "supersedes:",
      '  - "m-a"',
      "sources:",
      '  - "[[日记/2026_11_06#^mem-730d323d]]"',
      "---",
      "",
      "拒答门槛改成按场景分档，不再一刀切。",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(vault, "日记"), { recursive: true });
  fs.writeFileSync(path.join(vault, "日记/2026_11_06.md"), "- 原文一行 ^mem-730d323d\n");
  write(
    "2026-11-15-d.md",
    ["---", "id: m-d", 'title: "无关的一条。"', "kind: preference", "type: 偏好", "state: 有效", "date: 2026-11-15", "---", "", "无关的一条。", ""].join("\n"),
  );
  return vault;
}

test("解析：只认带 kind + 正文的条目，来源里能挑出可跳转的 [[…#^mem-…]]", () => {
  const vault = makeVault();
  const { dir, entries } = loadMemories(vault);
  assert.equal(entries.length, 5, "五条都被解析出来");
  const a = entries.find((e) => e.name === "2026-11-17-a");
  assert.equal(a.type, "项目经验");
  assert.equal(a.state, "有效");
  assert.ok(a.sources[0].startsWith("[[日记/2026_11_06#^mem-730d323d]]"));
  assert.ok(findMemory(entries, dir, "2026-11-17-a"));
  assert.ok(findMemory(entries, dir, "2026-11-17-a.md"), "带 .md 也能读");
  assert.equal(findMemory(entries, dir, "../../etc/passwd"), null, "不许越界读");
});

test("打分与排序：命中多的在前，同分按日期，已拒绝的不进搜索池", () => {
  const { entries } = loadMemories(makeVault());
  const pool = entries.filter((e) => e.state === "有效");
  const hits = searchMemories(pool, "拒答 门槛");
  assert.deepEqual(hits.map((h) => h.entry.name), ["2026-11-18-e", "2026-11-17-a", "2026-11-17-b"], "命中数优先，同分按日期由新到旧");
  assert.deepEqual(hits[0].why.sort(), ["拒答", "门槛"].sort(), "命中的词就是 why");
  assert.ok(hits.every((h) => h.entry.state === "有效"), "已拒绝的条目不出现在结果里");
});

test("预算：--k 限制条数，中文二元组噪声不够一半命中时返回空", () => {
  const { entries } = loadMemories(makeVault());
  const pool = entries.filter((e) => e.state === "有效");
  assert.equal(searchMemories(pool, "拒答 门槛", 1).length, 1, "--k 只留一条");
  assert.equal(searchMemories(pool, "拒答", 5).length, 3, "单个词也算命中（门槛按 1 算）；已拒绝的不在池子里");
  assert.deepEqual(searchMemories(pool, "完全不存在的词xyzzy"), [], "只撞上一两个二元组不算命中");
  assert.deepEqual(searchMemories(pool, ""), [], "空查询不猜");
});

test("recent：按日期倒序，只取有效条目并受 n 限制", () => {
  const { entries } = loadMemories(makeVault());
  const pool = entries.filter((e) => e.state === "有效");
  const list = recentMemories(pool, 2);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.name), ["2026-11-18-e", "2026-11-17-a"]);
  assert.ok(!recentMemories(pool, 10).some((e) => e.state !== "有效"));
});

test("库根与记忆目录：向上找 .obsidian；目录跟随设置 dream.dir", () => {
  const vault = makeVault({ dreamDir: "自定义/记忆库" });
  const start = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts");
  assert.equal(resolveVault(start), vault, "从插件目录向上四层找到库根");
  assert.equal(memoryDirOf(vault), path.join(vault, "自定义/记忆库"), "读得到设置里的目录");
  assert.equal(loadMemories(vault).entries.length, 5, "换目录也能读到");
});

test("CLI 三个动词与退出码（真跑进程）", () => {
  const vault = makeVault();
  const out = (args) => execFileSync(process.execPath, [SCRIPT, ...args, "--vault", vault], { encoding: "utf8" });

  const found = out(["search", "拒答 门槛", "--k", "1"]);
  assert.match(found, /^1\. 2026-11-18 \[/);
  assert.match(found, /命中：/);
  assert.match(found, /来源：\[\[日记\/2026_11_06#\^mem-730d323d\]\]/);

  const none = out(["search", "完全不存在的词xyzzy"]);
  assert.match(none, /没有匹配/);

  const recent = out(["recent", "1"]);
  assert.match(recent, /^1\. /);

  const read = out(["read", "2026-11-17-a"]);
  assert.match(read, /正文：/);
  assert.match(read, /^来源：$/m);

  assert.throws(() => out(["read", "../../etc/passwd"]), /找不到记忆/);
  assert.throws(() => out(["读", "x"]), /不认识的动词/);
});

test("run() 在没有库根时给出可诊断的错误，不漏成空结果", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ad-novault-"));
  const res = run(["recent"], { start: empty });
  assert.equal(res.code, 2);
  assert.match(res.out, /找不到库根/);
});

test("parseMemory 对缺 frontmatter / 缺正文的条目返回 null 而不是半条数据", () => {
  assert.equal(parseMemory("没有 frontmatter 的正文"), null);
  assert.equal(parseMemory("---\nkind: fact\n---\n"), null);
  assert.equal(parseMemory("---\nkind: fact\n---\n\n"), null);
});

test("取代链：新条目标出取代了谁，旧条目标出被谁取代（偏好变了要看得到新旧）", () => {
  const vault = makeVault();
  const out = (args) => execFileSync(process.execPath, [SCRIPT, ...args, "--vault", vault], { encoding: "utf8" });
  const found = out(["search", "拒答 门槛"]);
  assert.match(found, /取代：\[\[2026-11-17-a\]\]（2026-11-17）/, "新条目要写清取代了哪条");
  assert.match(found, /已被取代：\[\[2026-11-18-e\]\]（2026-11-18）/, "旧条目要写清被谁取代");

  const read = out(["read", "2026-11-18-e"]);
  assert.match(read, /取代：\[\[2026-11-17-a\]\]/);
});

test("时间过滤：--since / --until 只留区间内的记忆，并说明排除了几条", () => {
  const vault = makeVault();
  const out = (args) => execFileSync(process.execPath, [SCRIPT, ...args, "--vault", vault], { encoding: "utf8" });
  const onlyNew = out(["search", "拒答 门槛", "--since", "2026-11-18"]);
  assert.match(onlyNew, /2026-11-18/);
  assert.ok(!onlyNew.includes("2026-11-17 ["), "17 号的条目被排除");

  const old = out(["search", "拒答 门槛", "--until", "2026-11-16"]);
  assert.match(old, /没有匹配/, "16 号及以前没有讲拒答门槛的（11-15 那条无关）");
  assert.match(old, /不在区间或无日期/);

  const beforeAll = out(["search", "拒答 门槛", "--until", "2026-11-14"]);
  assert.match(beforeAll, /没有匹配/);

  const recentOld = out(["recent", "2", "--until", "2026-11-14"]);
  assert.match(recentOld, /这段时间里没有记忆/);

  assert.throws(() => out(["search", "拒答", "--since", "2026/11/01"]), /YYYY-MM-DD/);
  assert.throws(() => out(["search", "拒答", "--since", "2026-11-18", "--until", "2026-11-01"]), /比 --until 晚/);
});

test("图检索一跳：同源记忆与能打开的原文都列出来，打不开的链接不编路径", () => {
  const vault = makeVault();
  const { entries } = loadMemories(vault);
  const e = entries.find((x) => x.name === "2026-11-18-e");
  const near = neighborsOf(entries.filter((x) => x.state === "有效"), e, { vault, limit: 2 });
  assert.ok(near.coCitation.some((c) => c.entry.name === "2026-11-17-a"), "同引日记的那条要算作同源");
  assert.equal(near.notes.length, 1);
  assert.ok(near.notes[0].endsWith(path.join("日记", "2026_11_06.md")), "来源笔记给绝对路径");

  const out = execFileSync(process.execPath, [SCRIPT, "search", "拒答 门槛", "--vault", vault], { encoding: "utf8" });
  assert.match(out, /邻接：同源 \[\[2026-11-17-a\]\]（同引 日记\/2026_11_06）/);
  assert.match(out, /原文 .*日记[\\/]2026_11_06\.md/);
});

test("inDateRange：没日期的条目不参与时间过滤", () => {
  assert.equal(inDateRange({ date: "2026-11-17" }, { since: "2026-11-17" }), true);
  assert.equal(inDateRange({ date: "2026-11-17" }, { until: "2026-11-16" }), false);
  assert.equal(inDateRange({ date: "" }, { since: "2026-11-01" }), false);
  assert.equal(inDateRange({ date: "" }, {}), true);
});

test("隐私闸门：memory-query 跳过 private:true 记忆并屏蔽 excludedDirs 原文路径", () => {
  const vault = makeVault();
  fs.writeFileSync(
    path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"),
    JSON.stringify({ settings: { dream: { dir: "Agent Deck/记忆" }, delegate: { excludedDirs: ["私密日记"] } } }),
  );
  fs.writeFileSync(
    path.join(vault, "Agent Deck/记忆/2026-11-19-secret.md"),
    ["---", "id: m-secret", 'title: "私密拒答门槛配置"', "kind: fact", "state: 有效", "private: true", "date: 2026-11-19", "---", "", "私密拒答门槛配置", ""].join("\n"),
  );
  fs.mkdirSync(path.join(vault, "私密日记"), { recursive: true });
  fs.writeFileSync(path.join(vault, "私密日记/2026_11_19.md"), "- 私密原文\n");
  fs.writeFileSync(
    path.join(vault, "Agent Deck/记忆/2026-11-19-ref-secret.md"),
    ["---", "id: m-ref", 'title: "引用私密日记的公开总结"', "kind: lesson", "state: 有效", "date: 2026-11-19", "sources:", '  - "[[私密日记/2026_11_19]]"', "---", "", "引用私密日记的公开总结", ""].join("\n"),
  );
  const { entries } = loadMemories(vault);
  assert.ok(!entries.some((e) => e.id === "m-secret"), "private:true 记忆不被加载");
  const out = execFileSync(process.execPath, [SCRIPT, "search", "拒答 门槛", "--vault", vault], { encoding: "utf8" });
  assert.ok(!out.includes("私密拒答门槛配置"), "private:true 记忆不出现在搜索结果");
  const refEntry = entries.find((e) => e.id === "m-ref");
  assert.equal(neighborsOf(entries, refEntry, { vault }).notes.length, 0, "excludedDirs 原文不给绝对路径");
});

test("真实顶层 data.json（无 settings 包裹）同样读取自定义 dream.dir 与 excludedDirs，且支持 A股/多词召回与 index/stats", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-topcfg-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"),
      JSON.stringify({ dream: { dir: "自定义记忆" }, delegate: { excludedDirs: ["机密"] } }),
    );
    fs.mkdirSync(path.join(vault, "自定义记忆"), { recursive: true });
    fs.mkdirSync(path.join(vault, "机密"), { recursive: true });
    fs.writeFileSync(path.join(vault, "机密/a.md"), "- 机密原话");
    fs.writeFileSync(
      path.join(vault, "自定义记忆/2026-11-20-stock.md"),
      ["---", "id: m-a", 'title: "用户在 A 股投资中偏向科技股"', "kind: preference", "state: 有效", "verified: true", "date: 2026-11-20", "sources:", '  - "[[机密/a]]"', "---", "", "用户在 A 股投资中偏向科技股", ""].join("\n"),
    );
    fs.writeFileSync(
      path.join(vault, "自定义记忆/2026-11-21-demo.md"),
      ["---", "id: m-b", 'title: "录制 demo 前应先核对最新交互逻辑"', "kind: lesson", "project: agent-deck", "state: 有效", "date: 2026-11-21", "---", "", "录制 demo 前应先核对最新交互逻辑", ""].join("\n"),
    );
    const { entries } = loadMemories(vault);
    assert.equal(entries.length, 2);
    assert.equal(neighborsOf(entries, entries[0], { vault }).notes.length, 0, "顶层 delegate.excludedDirs 生效");

    const stockOut = run(["search", "A股 投资偏好", "--vault", vault]);
    assert.equal(stockOut.code, 0);
    assert.match(stockOut.out, /A 股投资/);

    const demoOut = run(["search", "如何录制 demo 视频", "--vault", vault]);
    assert.equal(demoOut.code, 0);
    assert.match(demoOut.out, /demo/);

    const idxOut = run(["index", "--project", "agent-deck", "--vault", vault]);
    assert.equal(idxOut.code, 0);
    assert.match(idxOut.out, /agent-deck/);
    assert.ok(!idxOut.out.includes("A 股投资"));

    const statsOut = run(["stats", "--vault", vault]);
    assert.equal(statsOut.code, 0);
    assert.match(statsOut.out, /已确认 1\/2/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("OKF 元数据筛选（--trust / --include-stale）、superseded_by 与 log.md 排除", async () => {
  const { ASSET_VERSION } = await import("../scripts/memory-query.mjs");
  const { MEMORY_QUERY_ASSET_VERSION } = await import("../src/constants.js");
  assert.equal(ASSET_VERSION, MEMORY_QUERY_ASSET_VERSION);

  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-okf-cli-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"), JSON.stringify({ dream: { dir: "Agent Deck/记忆" } }));
    const dir = path.join(vault, "Agent Deck", "记忆");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "log.md"), "# 记忆变更日志\n\n## 2026-11-26\n- **Creation**：打包构建日志\n");
    fs.writeFileSync(
      path.join(dir, "2026-11-20-human.md"),
      "---\nid: m-h\ntitle: \"打包构建需保留 external\"\nkind: lesson\nstate: 有效\nstatus: active\nverified: true\nprovenance: user-log\ndate: 2026-11-20\n---\n\n打包构建需保留 external\n",
    );
    fs.writeFileSync(
      path.join(dir, "2026-11-21-ai.md"),
      "---\nid: m-ai\ntitle: \"AI 记录建议换用新的打包工具\"\nkind: lesson\nstate: 有效\nstatus: active\nprovenance: ai-log\ndate: 2026-11-21\n---\n\nAI 记录建议换用新的打包工具\n",
    );
    fs.writeFileSync(
      path.join(dir, "2020-01-01-stale.md"),
      "---\nid: m-old\ntitle: \"2020 年旧打包配置方案\"\nkind: lesson\nstate: 有效\nstale_after: 2020-01-01\nsuperseded_by: m-h\ndate: 2020-01-01\n---\n\n2020 年旧打包配置方案\n",
    );

    const defOut = run(["search", "打包", "--vault", vault]);
    assert.equal(defOut.code, 0);
    assert.ok(!defOut.out.includes("2020 年旧打包配置方案"), "过期条目默认不召回");
    assert.ok(!defOut.out.includes("打包构建日志"), "log.md 不得进入记忆列表");
    assert.match(defOut.out, /\[AI提炼·未确认\]/);

    const humanOut = run(["search", "打包", "--trust", "human", "--vault", vault]);
    assert.match(humanOut.out, /保留 external/);
    assert.ok(!humanOut.out.includes("AI 记录建议"));

    const staleOut = run(["search", "旧打包", "--include-stale", "--vault", vault]);
    assert.match(staleOut.out, /\[已过复核期\]/);
    assert.match(staleOut.out, /已被取代：\[\[2026-11-20-human\]\]/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("graph 子命令沿概念边做 1-2 跳扩散，并解析双链化的 supersedes", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-graph-cli-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"), JSON.stringify({ dream: { dir: "Agent Deck/记忆" } }));
    const dir = path.join(vault, "Agent Deck", "记忆");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "口播先抛问题.md"),
      "---\nid: m-g1\ntitle: \"口播先抛问题\"\nkind: preference\nstate: 有效\ndate: 2026-11-20\nconcepts:\n  - \"[[视频口播]]\"\n  - \"[[叙事技巧]]\"\n---\n\n口播先抛问题\n",
    );
    fs.writeFileSync(
      path.join(dir, "叙事用具体类比.md"),
      "---\nid: m-g2\ntitle: \"叙事用具体类比\"\nkind: lesson\nstate: 有效\ndate: 2026-11-21\nconcepts:\n  - \"[[叙事技巧]]\"\n---\n\n叙事用具体类比\n",
    );
    fs.writeFileSync(
      path.join(dir, "旧版结尾模板.md"),
      "---\nid: m-g0\ntitle: \"旧版结尾模板\"\nkind: preference\nstate: 已被替代\nsuperseded_by: \"[[Agent Deck/记忆/口播先抛问题]]\"\ndate: 2026-10-01\n---\n\n旧版结尾模板\n",
    );

    const gConcept = run(["graph", "视频口播", "--vault", vault]);
    assert.equal(gConcept.code, 0);
    assert.match(gConcept.out, /\[\[口播先抛问题\]\]/);
    assert.match(gConcept.out, /二跳扩展记忆/);
    assert.match(gConcept.out, /\[\[叙事用具体类比\]\]/);

    const gOld = run(["graph", "旧版结尾模板", "--vault", vault]);
    assert.equal(gOld.code, 0);
    assert.match(gOld.out, /已被取代：\[\[口播先抛问题\]\]/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("stats 区分库内可补锚与外部导入免补锚，并支持 archive/ 归档检索与读取", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-arch-cli-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"), JSON.stringify({ dream: { dir: "Agent Deck/记忆" } }));
    fs.mkdirSync(path.join(vault, "日记"), { recursive: true });
    fs.writeFileSync(path.join(vault, "日记/2026_11_20.md"), "- 一行库内原文\n");
    const dir = path.join(vault, "Agent Deck", "记忆");
    const archDir = path.join(dir, "archive");
    fs.mkdirSync(archDir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "库内未锚定.md"),
      "---\nid: m-v1\ntitle: \"库内日记未补块号\"\nkind: fact\nstate: 有效\nprovenance: user-log\ndate: 2026-11-20\nconflicts_with:\n  - \"[[Agent Deck/记忆/外部导入免锚]]\"\nsources:\n  - \"[[日记/2026_11_20]]（用户日志，第 1—1 行）；原文：一行库内原文\"\n---\n\n库内日记未补块号\n",
    );
    fs.writeFileSync(
      path.join(dir, "外部导入免锚.md"),
      "---\nid: m-imp\ntitle: \"Claude 导出的跨会话习惯\"\nkind: preference\nstate: 有效\nprovenance: import\ndate: 2026-08-01\nsources:\n  - \"Claude 记忆导出（/topics/pref.md）；原文：跨会话习惯\"\n---\n\nClaude 导出的跨会话习惯\n",
    );
    fs.writeFileSync(
      path.join(archDir, "旧版归档规则.md"),
      "---\nid: m-arch1\ntitle: \"归档后的旧版打包规则\"\nkind: lesson\nstate: 已被替代\nstatus: deprecated\ndate: 2025-01-01\n---\n\n归档后的旧版打包规则\n",
    );

    const statsOut = run(["stats", "--vault", vault]);
    assert.equal(statsOut.code, 0);
    assert.match(statsOut.out, /库内可补锚 1 条/);
    assert.match(statsOut.out, /外部导入免补锚 1 条/);
    assert.match(statsOut.out, /已归档 1 条/);

    const defaultSearch = run(["search", "归档后", "--vault", vault]);
    assert.match(defaultSearch.out, /没有匹配/);

    const allSearch = run(["search", "旧版打包规则", "--all", "--vault", vault]);
    assert.equal(allSearch.code, 0);
    assert.match(allSearch.out, /\[已归档\]/);
    assert.match(allSearch.out, /归档后的旧版打包规则/);

    const staleSearch = run(["search", "旧版打包规则", "--include-stale", "--vault", vault]);
    assert.equal(staleSearch.code, 0);
    assert.match(staleSearch.out, /没有匹配/, "--include-stale 不应把 archive/ 归档条目混入");

    // --project 过滤时保留通用无项目 lesson（0.85 降权）
    fs.writeFileSync(
      path.join(dir, "通用验证规律.md"),
      "---\nid: m-univ-lesson\ntitle: \"发布前必须跑通全量测试与构建校验\"\nkind: lesson\nstate: 有效\nverified: true\nverified_by: human:user\nprovenance: user-log\ndate: 2026-11-21\n---\n\n发布前必须跑通全量测试与构建校验\n",
    );
    const univSearch = run(["search", "发布 构建", "--project", "agent-deck", "--vault", vault]);
    assert.equal(univSearch.code, 0);
    assert.match(univSearch.out, /发布前必须跑通全量测试与构建校验/);

    const conflictSearch = run(["search", "库内日记未补块号", "--vault", vault]);
    assert.match(conflictSearch.out, /冲突：\[\[Agent Deck\/记忆\/外部导入免锚\]\]/);
    const conflictRead = run(["read", "库内未锚定", "--vault", vault]);
    assert.match(conflictRead.out, /冲突：\[\[Agent Deck\/记忆\/外部导入免锚\]\]/);

    const readArch = run(["read", "旧版归档规则", "--vault", vault]);
    assert.equal(readArch.code, 0);
    assert.match(readArch.out, /归档后的旧版打包规则/);

    const badRead = run(["read", "../archive/../../etc/passwd", "--vault", vault]);
    assert.equal(badRead.code, 1);

    // 通过 symlink 路径调用 scripts/memory-query.mjs CLI 时，isMain 与 resolveVault 均必须正常工作、不能静默空输出退出。
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mq-sym-"));
    try {
      const symVault = path.join(linkDir, "sym-vault");
      fs.symlinkSync(vault, symVault);
      fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts"), { recursive: true });
      fs.copyFileSync(
        new URL("../scripts/memory-query.mjs", import.meta.url),
        path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts", "memory-query.mjs"),
      );
      const cliViaSym = spawnSync("node", [
        path.join(symVault, ".obsidian", "plugins", "agent-deck", "scripts", "memory-query.mjs"),
        "search",
        "发布 构建",
        "--project",
        "agent-deck",
      ], { encoding: "utf8" });
      assert.equal(cliViaSym.status, 0);
      assert.match(cliViaSym.stdout, /发布前必须跑通全量测试与构建校验/);
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
    }

    // 短中文双字查询召回 + 多词覆盖排序 + Windows 反斜杠 ref 读取
    fs.writeFileSync(
      path.join(dir, "软链说明.md"),
      "---\nid: m-symlink\ntitle: \"软链项目根路径解析\"\nkind: lesson\nstate: 有效\nverified: true\ndate: 2026-11-26\n---\n\n当外部项目是软链或目录名不同时用 realpath 解析项目根路径。\n",
    );
    fs.writeFileSync(
      path.join(dir, "Windows路径规则.md"),
      "---\nid: m-win-lesson\ntitle: \"Windows 路径统一转正斜杠\"\nkind: lesson\nproject: agent-deck\nstate: 有效\nverified: true\ndate: 2026-11-26\n---\n\nWindows 路径统一转正斜杠并避免盘符大小写差异。\n",
    );
    fs.writeFileSync(
      path.join(dir, "Windows路径偏好.md"),
      "---\nid: m-win-pref\ntitle: \"路径显示简洁\"\nkind: preference\ntags: [路径]\nstate: 有效\nverified: true\ndate: 2026-11-26\n---\n\n路径显示保持简洁。\n",
    );
    const shortCjk = run(["search", "软链接", "--vault", vault]);
    assert.equal(shortCjk.code, 0);
    assert.match(shortCjk.out, /软链/);

    const winRank = run(["search", "Windows 路径", "--project", "agent-deck", "--vault", vault]);
    assert.equal(winRank.code, 0);
    const idxLesson = winRank.out.indexOf("Windows 路径统一转正斜杠");
    const idxPref = winRank.out.indexOf("路径显示保持简洁");
    assert.ok(idxLesson >= 0);
    if (idxPref >= 0) assert.ok(idxLesson < idxPref, "multi-term lesson must outrank single-term preference");

    const winSlashRead = run(["read", "Agent Deck\\记忆\\Windows路径规则.md", "--vault", vault]);
    assert.equal(winSlashRead.code, 0);
    assert.match(winSlashRead.out, /Windows 路径统一转正斜杠/);
    const winArchRead = run(["read", "archive\\旧版归档规则.md", "--vault", vault]);
    assert.equal(winArchRead.code, 0);
    assert.match(winArchRead.out, /归档后的旧版打包规则/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
