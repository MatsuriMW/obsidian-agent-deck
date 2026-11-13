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

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS DSH logs: time-context and skill-catalogue messages never become the user's question");
