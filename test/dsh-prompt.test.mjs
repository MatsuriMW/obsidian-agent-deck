// DSH writes its own bookkeeping as user-role messages. Those must never be
// recorded as "what the user asked": the folded 「最新一条」 view shows that
// line, and it once ended up holding a timestamp sentence.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { AgentUsage, isPromptText, cleanUserPrompt } from "../src/readers.js";
import { DEFAULTS, deepMerge } from "../src/constants.js";

const now = Date.now();
const log = (type, seq, data) => JSON.stringify({ type, seq, time: now - 60000 + seq, data });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-dsh-log-"));
const file = path.join(dir, "session.v4.jsonl.zstd");
fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from([
  log("session", 0, null).replace('"data":null', '"id":"s1","cwd":"/tmp/x"'),
  log("user/message", 1, {
    content: [{ type: "text", text: "Time sampled while preparing turn 5, step 1: 2026-11-14T02:33:04+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai.\nElapsed since the preceding model-visible message: 8m 10s." }],
    source: { kind: "time-context" },
  }),
  log("user/message", 2, {
    content: [{ type: "text", text: "<system-reminder>\nskills…\n</system-reminder>" }],
    source: { kind: "skill-catalog" },
  }),
  log("user/message", 3, {
    content: [{ type: "text", text: "把周报写完并发给组长" }],
    source: { kind: "user" },
  }),
  log("assistant/message", 4, {
    message: { content: [{ type: "text", text: "周报写完了，还差下周计划。" }] },
  }),
  log("turn/end", 5, { reason: { kind: "end" } }),
].join("\n") + "\n")));

const settings = deepMerge(DEFAULTS, {});
const usage = new AgentUsage({ settings, cfg: settings });
await usage.readDsh(file, { mtimeMs: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }, new Set());

const fc = usage.files.get(file);
assert.ok(fc, "the log was read");
const rounds = (fc.rounds && fc.rounds.list) || [];
assert.equal(rounds.length, 1, "one round: the harness notes are not prompts");
assert.equal(rounds[0].ask, "把周报写完并发给组长", "the round keeps what the user actually asked");
assert.ok(String(rounds[0].said || "").includes("周报写完了"), "and the agent's conclusion");

// The same guards hold for logs that inline the runtime note with the prompt.
assert.equal(isPromptText("Time sampled while preparing turn 1, step 1: 2026-11-14T00:00:00+08:00"), false);
assert.equal(isPromptText("Elapsed since the preceding model-visible message: 2m"), false);
assert.equal(cleanUserPrompt("Time sampled while preparing turn 1, step 1: x\nBrowser time zone for this request: Asia/Shanghai.\n\n做这件事"), "做这件事");
assert.equal(isPromptText("把周报写完并发给组长"), true, "a normal prompt still counts");

// DSH subagents (parentSession / delegationDepth >= 1) settle to "done" on turn/end,
// aborted turns settle to "cancelled", and parentCwd is exposed for project inheritance.
{
  const subDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-dsh-sub-"));
  const parentFile = path.join(subDir, "session-parent.jsonl.zstd");
  const childFile = path.join(subDir, "sub-1.jsonl.zstd");
  const abortedFile = path.join(subDir, "session-aborted.jsonl.zstd");
  fs.writeFileSync(parentFile, zlib.zstdCompressSync(Buffer.from([
    JSON.stringify({ type: "session", seq: 0, time: now - 50000, id: "session-parent", cwd: "/Users/x/work/alpha" }),
    JSON.stringify({ type: "user/message", seq: 1, time: now - 49000, data: { content: [{ type: "text", text: "重构模块" }], source: { kind: "user" } } }),
    JSON.stringify({ type: "turn/end", seq: 2, time: now - 48000, data: { reason: { kind: "completed" } } }),
  ].join("\n") + "\n")));
  fs.writeFileSync(childFile, zlib.zstdCompressSync(Buffer.from([
    JSON.stringify({ type: "session", seq: 0, time: now - 40000, id: "sub-1", cwd: "/Users/x/Documents/deepseek-harness/default-workspace", parentSession: "session-parent", delegationDepth: 1 }),
    JSON.stringify({ type: "user/message", seq: 1, time: now - 39000, data: { content: [{ type: "text", text: "跑单测" }], source: { kind: "user" } } }),
    JSON.stringify({ type: "assistant/message", seq: 2, time: now - 38000, data: { message: { content: [{ type: "text", text: "全部通过" }] } } }),
    JSON.stringify({ type: "turn/end", seq: 3, time: now - 37000, data: { reason: { kind: "completed" } } }),
  ].join("\n") + "\n")));
  fs.writeFileSync(abortedFile, zlib.zstdCompressSync(Buffer.from([
    JSON.stringify({ type: "session", seq: 0, time: now - 30000, id: "session-aborted", cwd: "/Users/x/work/alpha" }),
    JSON.stringify({ type: "user/message", seq: 1, time: now - 29000, data: { content: [{ type: "text", text: "取消这轮" }], source: { kind: "user" } } }),
    JSON.stringify({ type: "turn/end", seq: 2, time: now - 28000, data: { reason: { kind: "aborted", reason: { kind: "user" } } } }),
  ].join("\n") + "\n")));

  const u2 = new AgentUsage({ settings, cfg: settings });
  for (const f of [parentFile, childFile, abortedFile]) {
    await u2.readDsh(f, { mtimeMs: fs.statSync(f).mtimeMs, size: fs.statSync(f).size }, new Set());
  }
  const live = u2.liveSessions({ since: now - 100000, limit: 20 });
  const parent = live.find((s) => s.sid === "session-parent");
  const child = live.find((s) => s.sid === "sub-1");
  const aborted = live.find((s) => s.sid === "session-aborted");
  assert.equal(parent.state, "wait");
  assert.equal(child.state, "done", "DSH subagent completed turn settles to done, not wait");
  assert.equal(child.parentCwd, "/Users/x/work/alpha", "child exposes parentCwd for project grouping");
  assert.equal(aborted.state, "cancelled", "DSH aborted turn settles to cancelled, not wait");
  fs.rmSync(subDir, { recursive: true, force: true });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS DSH logs: time-context and skill-catalogue messages never become the user's question");
