import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ManagedTimers, CircuitBreaker, safeRun, bindConnectedInterval } from "../src/runtime-guard.js";
import {
  registerAgentCapability,
  getAgentCapability,
  hasAgentCapability,
  delegateAgents,
  acpAgents,
  cliHandoffAgents,
  canContinueInApp,
  archiveCapableAgents,
  permissionCapableAgents,
} from "../src/agent-registry.js";
import {
  extractWikilinkRefs,
  registerContextResolver,
  clearCustomContextResolvers,
  resolveDelegationContext,
  buildDelegationPayload,
  createDelegationRunner,
  HarnessPipeline,
} from "../src/harness.js";
import {
  fencedLines, frontmatterEnd, ownersOf, subtreeEnd, ancestorLines,
  itemLineFor, parentItem, contentSpan, blockLinesForRange, groupRowsEdit, collectSelectedRootLines,
} from "../src/outline.js";
import { registerAgentIngestor, getAgentIngestor, ingestAgentLine } from "../src/agent-ingestors.js";
import { registerRunnerClass, getRunnerClasses } from "../src/delegation-runners.js";

test("src module graph has zero circular dependencies", () => {
  const srcDir = path.resolve(import.meta.dirname, "../src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"));
  const edges = new Map();
  for (const file of files) {
    const text = fs.readFileSync(path.join(srcDir, file), "utf8");
    const deps = [...text.matchAll(/(?:from|import)\s+["']\.\/([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((d) => d.endsWith(".js"));
    edges.set(file, [...new Set(deps)]);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  const dfs = (node) => {
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      if (visiting.has(next)) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!visited.has(next)) dfs(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const file of files) if (!visited.has(file)) dfs(file);
  assert.deepEqual(cycles, [], `circular imports found: ${JSON.stringify(cycles)}`);
});

test("ManagedTimers tracks and disposes all timers and ignores new ones after dispose", () => {
  let nextId = 1;
  const activeIntervals = new Set();
  const activeTimeouts = new Set();
  const host = {
    setInterval: (_fn) => { const id = nextId++; activeIntervals.add(id); return id; },
    clearInterval: (id) => activeIntervals.delete(id),
    setTimeout: (_fn) => { const id = nextId++; activeTimeouts.add(id); return id; },
    clearTimeout: (id) => activeTimeouts.delete(id),
  };
  const timers = new ManagedTimers(host);
  const i1 = timers.setInterval(() => {}, 1000);
  const t1 = timers.setTimeout(() => {}, 1000);
  assert.equal(timers.size, 2);
  timers.clear(t1);
  assert.equal(activeTimeouts.size, 0);
  assert.equal(timers.size, 1);
  timers.dispose();
  assert.equal(activeIntervals.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(timers.setInterval(() => {}, 1000), null);
  assert.notEqual(i1, null);
});

test("bindConnectedInterval self-cleans when DOM widget disconnects", () => {
  let savedFn = null;
  let cleared = 0;
  const host = {
    setInterval: (fn) => { savedFn = fn; return 77; },
    clearInterval: (id) => { if (id === 77) cleared++; },
  };
  const el = { isConnected: true };
  let ticks = 0;
  bindConnectedInterval(el, "_adTimer", () => { ticks++; }, 500, host);
  savedFn();
  assert.equal(ticks, 1);
  el.isConnected = false;
  savedFn();
  assert.equal(ticks, 1);
  assert.equal(cleared, 1);
  assert.equal(el._adTimer, null);
});

test("CircuitBreaker isolates recurring failures and resets cleanly after cooldown success", async () => {
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 5000 });
  const errors = [];
  const r1 = await safeRun("job", () => { throw new Error("boom 1"); }, { breaker, now: 1000, onError: (e) => errors.push(e.message) });
  assert.equal(r1.ok, false);
  assert.equal(breaker.snapshot(1000).state, "closed");

  const r2 = await safeRun("job", async () => { throw new Error("boom 2"); }, { breaker, now: 2000, onError: (e) => errors.push(e.message) });
  assert.equal(r2.ok, false);
  assert.equal(breaker.snapshot(2000).state, "open");

  const skipped = await safeRun("job", () => "should skip", { breaker, now: 3000 });
  assert.equal(skipped.skipped, true);

  assert.equal(breaker.snapshot(7000).state, "half-open");
  const recovered = await safeRun("job", async () => "ok", { breaker, now: 7000 });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.value, "ok");
  assert.equal(breaker.snapshot(7000).state, "closed");
  assert.deepEqual(errors, ["boom 1", "boom 2"]);
});

test("agent-registry supports declarative capability queries and Open-Closed registration", () => {
  assert.ok(delegateAgents().includes("claude"));
  assert.ok(delegateAgents().includes("cursor"));
  assert.ok(!delegateAgents().includes("grokbot"));
  assert.deepEqual(acpAgents(), ["dsh", "antigravity", "opencode", "hermes", "minimax", "cursor", "gemini"]);
  assert.ok(cliHandoffAgents().includes("workbuddy"));
  assert.equal(canContinueInApp("dsh"), true);
  assert.equal(canContinueInApp("codex"), false);
  assert.deepEqual(archiveCapableAgents(), ["claude", "codex", "hermes", "minimax", "t3code", "kimicode"]);
  assert.deepEqual(permissionCapableAgents(), ["claude", "qoder"]);

  registerAgentCapability("custom-ext-agent", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    continueInApp: true,
  });
  assert.equal(hasAgentCapability("custom-ext-agent", "delegate"), true);
  assert.equal(getAgentCapability("custom-ext-agent").runnerKind, "acp");
  assert.ok(delegateAgents().includes("custom-ext-agent"));
});

test("harness extracts outline/wikilink context, runs extensible resolvers, hooks, and runner factory", async () => {
  clearCustomContextResolvers();
  const lines = [
    "- 模块重构计划 [[架构文档#分工|架构]]",
    "\t- TODO 完成 [[Harness规范]] 核心管道 ^ad-test",
  ];
  const block = { start: 1, end: 1, text: lines[1] };
  assert.deepEqual(extractWikilinkRefs(lines), [
    { target: "架构文档", subpath: "分工", alias: "架构" },
    { target: "Harness规范", subpath: "", alias: "" },
  ]);

  const disposeResolver = registerContextResolver({
    name: "linked-notes",
    resolve: (ctx) => ({
      section: `关联文档：${ctx.refs.map((r) => r.target).join(", ")}`,
    }),
  });

  try {
    const fakePlugin = { settings: { delegate: { confirmFirst: false } } };
    const ctx = await resolveDelegationContext({ lines, block });
    assert.equal(ctx.refs.length, 2);
    assert.match(ctx.extraSections[0], /关联文档：架构文档, Harness规范/);

    const payload = await buildDelegationPayload({ plugin: fakePlugin, file: { path: "daily/2026-11-16.md" }, lines, block });
    assert.match(payload.prompt, /模块重构计划/);
    assert.match(payload.prompt, /关联文档：架构文档, Harness规范/);
    assert.match(payload.prompt, /来自 Obsidian：daily\/2026-11-16\.md/);
  } finally {
    disposeResolver();
    clearCustomContextResolvers();
  }

  const events = [];
  const pipe = new HarnessPipeline();
  pipe.use({ beforeDelegate: (p) => events.push(`before:${p.name}`), afterResult: () => events.push("after") });
  await pipe.run("beforeDelegate", { name: "task-1" });
  await pipe.run("afterResult", {});
  assert.deepEqual(events, ["before:task-1", "after"]);

  class FakeAcp { constructor(d, j) { this.d = d; this.j = j; } }
  const runner = createDelegationRunner("opencode", { id: "del" }, { id: "job" }, { acp: FakeAcp });
  assert.ok(runner instanceof FakeAcp);
});

test("outline, agent-ingestors, and delegation-runners extension points work without cycles", () => {
  const md = ["---", "date: 2026-11-16", "---", "- Root", "  ```md", "  - Inside fence", "  ```", "  - Child", "    - Grandchild", "- Sibling"];
  assert.equal(frontmatterEnd(md), 3);
  const fenced = fencedLines(md);
  assert.ok(fenced.has(4) && fenced.has(5) && fenced.has(6));
  const owners = ownersOf(md, fenced);
  assert.equal(owners[7], 3);
  assert.equal(owners[8], 7);
  assert.equal(subtreeEnd(md, 3), 9);
  assert.deepEqual(ancestorLines(md, 8, fenced), ["- Root", "  ```md", "  - Inside fence", "  ```", "  - Child"]);

  registerAgentIngestor("custom-ingest-agent", (ctx, entry) => {
    if (entry.msg) ctx.text.add(entry.msg);
    return true;
  });
  assert.equal(typeof getAgentIngestor("custom-ingest-agent"), "function");
  const textSeen = [];
  const handled = ingestAgentLine("custom-ingest-agent", {
    text: { add: (s) => textSeen.push(s) },
  }, { msg: "hello world" });
  assert.equal(handled, true);
  assert.deepEqual(textSeen, ["hello world"]);

  class DummyRunner {}
  registerRunnerClass("customRunner", DummyRunner);
  assert.equal(getRunnerClasses().customRunner, DummyRunner);
});

test("outline navigation, groupRowsEdit, and multi-block selection helpers", () => {
  const doc = [
    "- 顶级母块 ^ad-root",
    "\t- DOING 子任务一",
    "\t  续行说明",
    "\t\t- 孙任务",
    "\t- TODO 子任务二 ^ad-c2",
    "- 顶级兄弟",
    "普通段落",
  ];
  assert.equal(itemLineFor(doc, 2), 1, "continuation line resolves to owning list item");
  assert.equal(itemLineFor(doc, 6), -1, "plain top-level paragraph is not in a list");
  assert.equal(parentItem(doc, 3), 1);
  assert.equal(parentItem(doc, 1), 0);
  assert.equal(parentItem(doc, 0), -1);

  const span = contentSpan("- [ ] TODO 标题文字 ^ad-123  ");
  assert.equal("- [ ] TODO 标题文字 ^ad-123  ".slice(span.from, span.to), "TODO 标题文字");

  assert.deepEqual(blockLinesForRange(doc, 1, 4), { start: 1, end: 4 });

  // Group rows wraps selected sibling blocks under a new empty parent at their shallowest indent.
  const grouped = groupRowsEdit(doc, [{ fromLine: 1, toLine: 4 }], "\t");
  assert.equal(grouped.startLine, 1);
  assert.equal(grouped.endLine, 4);
  assert.equal(grouped.cursorOffset, 3);
  assert.equal(grouped.insertText, [
    "\t- ",
    "\t\t- DOING 子任务一",
    "\t\t  续行说明",
    "\t\t\t- 孙任务",
    "\t\t- TODO 子任务二 ^ad-c2",
  ].join("\n"));

  // Contiguous mixed-depth selection keeps shallowest root items; multi-cursor keeps each cursor's item.
  assert.deepEqual(collectSelectedRootLines(doc, [{ fromLine: 1, toLine: 4 }]), [1, 4]);
  assert.deepEqual(collectSelectedRootLines(doc, [{ fromLine: 0, toLine: 3 }]), [0]);
  assert.deepEqual(collectSelectedRootLines(doc, [{ fromLine: 1, toLine: 1 }, { fromLine: 5, toLine: 5 }]), [1, 5]);
});
