import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverGeminiCliSessions,
  parseGeminiCliSession,
  buildGeminiCliConversation,
} from "../src/gemini-cli-sessions.js";

test("discoverGeminiCliSessions and parseGeminiCliSession handle JSONL v0.70+ with $set, $patch, $rewindTo, context stripping, and tokens", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-gemini-"));
  try {
    const base = path.join(tmp, ".gemini");
    const chatsDir = path.join(base, "tmp", "agent-deck", "chats");
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(
      path.join(base, "projects.json"),
      JSON.stringify({ projects: { "/Users/demo/agent-deck": "agent-deck" } }),
    );
    const jsonlPath = path.join(chatsDir, "session-2026-11-22T16-00-abcd1234.jsonl");
    fs.writeFileSync(
      jsonlPath,
      [
        JSON.stringify({ sessionId: "abcd1234-0000-4000-8000-000000000001", projectHash: "h1", startTime: "2026-11-22T16:00:00.000Z", lastUpdated: "2026-11-22T16:00:00.000Z", kind: "main" }),
        JSON.stringify({ id: "ctx-1", timestamp: "2026-11-22T16:00:00.100Z", type: "user", content: [{ text: "<session_context>\nHuge directory tree\n</session_context>" }] }),
        JSON.stringify({ id: "u-rewound", timestamp: "2026-11-22T16:00:01.000Z", type: "user", content: [{ text: "failed prompt" }] }),
        JSON.stringify({ $rewindTo: "u-rewound" }),
        JSON.stringify({ id: "u-1", timestamp: "2026-11-22T16:00:05.000Z", type: "user", content: [{ text: "<hook_context>working memory</hook_context>\n\n帮我检查 README" }] }),
        JSON.stringify({ id: "g-1", timestamp: "2026-11-22T16:00:08.000Z", type: "gemini", model: "gemini-2.5-pro", content: "README 结构清晰，已核对完毕。", toolCalls: [{ name: "read_file" }] }),
        JSON.stringify({ id: "g-1", $patch: { tokens: { input: 2000, cached: 1200, output: 300, thoughts: 150, total: 2450 } } }),
        JSON.stringify({ $set: { lastUpdated: "2026-11-22T16:00:09.000Z", summary: "核对 README 文档" } }),
      ].join("\n") + "\n",
    );

    const { sessions } = discoverGeminiCliSessions({ homeDir: tmp, env: {} });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].cwd, "/Users/demo/agent-deck");
    assert.equal(sessions[0].isJsonl, true);

    const parsed = parseGeminiCliSession(fs.readFileSync(jsonlPath, "utf8"), sessions[0]);
    assert.equal(parsed.id, "abcd1234-0000-4000-8000-000000000001");
    assert.equal(parsed.title, "核对 README 文档");
    assert.equal(parsed.hasClientTitle, true);
    assert.equal(parsed.model, "gemini-2.5-pro");
    assert.equal(parsed.state, "wait");
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0].text, "帮我检查 README");
    assert.equal(parsed.entries[1].text, "README 结构清晰，已核对完毕。");
    assert.equal(parsed.usages.length, 1);
    assert.deepEqual(
      { inp: parsed.usages[0].inp, cache: parsed.usages[0].cache, out: parsed.usages[0].out },
      { inp: 800, cache: 1200, out: 450 },
    );

    const conv = buildGeminiCliConversation(`${jsonlPath}#abcd1234-0000-4000-8000-000000000001`);
    assert.equal(conv.length, 2);
    assert.match(conv[1].text, /\[tool: read_file\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseGeminiCliSession supports legacy session-*.json format", () => {
  const legacy = JSON.stringify({
    sessionId: "legacy-001",
    startTime: "2026-10-01T10:00:00.000Z",
    lastUpdated: "2026-10-01T10:02:00.000Z",
    messages: [
      { id: "m1", timestamp: "2026-10-01T10:00:05.000Z", type: "user", content: "解释一下 ACP 协议" },
      { id: "m2", timestamp: "2026-10-01T10:01:00.000Z", type: "gemini", model: "gemini-2.5-flash", content: "ACP 是 Agent Client Protocol。", tokens: { input: 500, cached: 0, output: 120 } },
    ],
  });
  const parsed = parseGeminiCliSession(legacy, { isJsonl: false, cwd: "/tmp/proj" });
  assert.equal(parsed.id, "legacy-001");
  assert.equal(parsed.title, "解释一下 ACP 协议");
  assert.equal(parsed.usages.length, 1);
  assert.equal(parsed.usages[0].inp, 500);
  assert.equal(parsed.usages[0].out, 120);
});
