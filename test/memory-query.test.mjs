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
    "2026-11-15-d.md",
    ["---", "id: m-d", 'title: "无关的一条。"', "kind: preference", "type: 偏好", "state: 有效", "date: 2026-11-15", "---", "", "无关的一条。", ""].join("\n"),
  );
  return vault;
}

test("解析：只认带 kind + 正文的条目，来源里能挑出可跳转的 [[…#^mem-…]]", () => {
  const vault = makeVault();
  const { dir, entries } = loadMemories(vault);
  assert.equal(entries.length, 4, "四条都被解析出来");
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
  assert.deepEqual(hits.map((h) => h.entry.name), ["2026-11-17-a", "2026-11-17-b"], "同分同日按文件名稳定排序");
  assert.deepEqual(hits[0].why.sort(), ["拒答", "门槛"].sort(), "命中的词就是 why");
  assert.ok(hits.every((h) => h.entry.state === "有效"), "已拒绝的条目不出现在结果里");
});

test("预算：--k 限制条数，中文二元组噪声不够一半命中时返回空", () => {
  const { entries } = loadMemories(makeVault());
  const pool = entries.filter((e) => e.state === "有效");
  assert.equal(searchMemories(pool, "拒答 门槛", 1).length, 1, "--k 只留一条");
  assert.equal(searchMemories(pool, "拒答", 5).length, 2, "单个词也算命中（门槛按 1 算）；已拒绝的不在池子里");
  assert.deepEqual(searchMemories(pool, "完全不存在的词xyzzy"), [], "只撞上一两个二元组不算命中");
  assert.deepEqual(searchMemories(pool, ""), [], "空查询不猜");
});

test("recent：按日期倒序，只取有效条目并受 n 限制", () => {
  const { entries } = loadMemories(makeVault());
  const pool = entries.filter((e) => e.state === "有效");
  const list = recentMemories(pool, 2);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.name), ["2026-11-17-a", "2026-11-17-b"]);
  assert.ok(!recentMemories(pool, 10).some((e) => e.state !== "有效"));
});

test("库根与记忆目录：向上找 .obsidian；目录跟随设置 dream.dir", () => {
  const vault = makeVault({ dreamDir: "自定义/记忆库" });
  const start = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts");
  assert.equal(resolveVault(start), vault, "从插件目录向上四层找到库根");
  assert.equal(memoryDirOf(vault), path.join(vault, "自定义/记忆库"), "读得到设置里的目录");
  assert.equal(loadMemories(vault).entries.length, 4, "换目录也能读到");
});

test("CLI 三个动词与退出码（真跑进程）", () => {
  const vault = makeVault();
  const out = (args) => execFileSync(process.execPath, [SCRIPT, ...args, "--vault", vault], { encoding: "utf8" });

  const found = out(["search", "拒答 门槛", "--k", "1"]);
  assert.match(found, /^1\. 2026-11-17 \[/);
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
