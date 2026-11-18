import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
