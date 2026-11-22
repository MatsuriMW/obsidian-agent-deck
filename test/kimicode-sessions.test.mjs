import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverKimiCodeSessions,
  parseKimiCodeSession,
  buildKimiCodeConversation,
} from "../src/kimicode-sessions.js";

test("discoverKimiCodeSessions discovers wire.jsonl + state.json + workspaces.json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-kimi-"));
  try {
    const base = path.join(tmp, ".kimi-code");
    const sessDir = path.join(base, "sessions", "ws_abc123", "sess-001");
    fs.mkdirSync(path.join(sessDir, "session-meta"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "workspaces.json"),
      JSON.stringify({ version: 1, workspaces: { ws_abc123: { path: "/Users/demo/repo" } } }),
    );
    fs.writeFileSync(
      path.join(sessDir, "session-meta", "state.json"),
      JSON.stringify({ title: "重构登录模块", isCustomTitle: true, model: "kimi-code/k3", createdAt: 1795360000000 }),
    );
    fs.writeFileSync(
      path.join(sessDir, "wire.jsonl"),
      [
        JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1795360000000 }),
        JSON.stringify({ type: "turn.prompt", time: 1795360001, input: [{ type: "text", text: "帮我检查 auth.js" }], origin: { kind: "user" } }),
        JSON.stringify({ type: "step.begin", uuid: "s1", turnId: "t1", step: 1, time: 1795360002 }),
        JSON.stringify({ type: "tool.call", stepUuid: "s1", toolCallId: "tc1", name: "read_file", args: { path: "auth.js" }, time: 1795360003 }),
        JSON.stringify({ type: "content.part", stepUuid: "s1", part: { type: "text", text: "已检查 auth.js，发现一处空指针。" }, time: 1795360004 }),
        JSON.stringify({
          type: "step.end",
          uuid: "s1",
          turnId: "t1",
          step: 1,
          finishReason: "stop",
          time: 1795360005,
          usage: { inputOther: 1200, inputCacheCreation: 300, inputCacheRead: 5000, output: 450 },
        }),
        JSON.stringify({ type: "turn.end", turnId: "t1", time: 1795360006 }),
      ].join("\n") + "\n",
    );

    const { sessions } = discoverKimiCodeSessions({ homeDir: tmp, env: {} });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "sess-001");
    assert.equal(sessions[0].cwd, "/Users/demo/repo");
    assert.equal(sessions[0].app, "desktop");

    const parsed = parseKimiCodeSession(fs.readFileSync(sessions[0].wirePath, "utf8"), sessions[0].meta, sessions[0]);
    assert.equal(parsed.title, "重构登录模块");
    assert.equal(parsed.hasClientTitle, true);
    assert.equal(parsed.model, "kimi-code/k3");
    assert.equal(parsed.state, "wait");
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0].role, "user");
    assert.equal(parsed.entries[0].text, "帮我检查 auth.js");
    assert.equal(parsed.entries[1].role, "assistant");
    assert.equal(parsed.entries[1].text, "已检查 auth.js，发现一处空指针。");
    assert.equal(parsed.usages.length, 1);
    assert.deepEqual(
      { inp: parsed.usages[0].inp, cache: parsed.usages[0].cache, out: parsed.usages[0].out },
      { inp: 1500, cache: 5000, out: 450 },
    );

    const conv = buildKimiCodeConversation(`${sessions[0].wirePath}#sess-001`);
    assert.equal(conv.length, 2);
    assert.match(conv[1].text, /\[tool: read_file\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseKimiCodeSession marks open streaming step as run and ignores New Session title", () => {
  const wire = [
    JSON.stringify({ type: "turn_begin", time: 1795361000, userInput: "写个单元测试" }),
    JSON.stringify({ type: "step.begin", uuid: "s-open", turnId: "t1", step: 1, time: 1795361001 }),
    JSON.stringify({ type: "tool.call", stepUuid: "s-open", toolCallId: "tc2", name: "run_command", args: { cmd: "npm test" }, time: 1795361002 }),
  ].join("\n");

  const parsed = parseKimiCodeSession(wire, { title: "New Session" }, { id: "sess-run" });
  assert.equal(parsed.state, "run");
  assert.equal(parsed.lastStep, "run_command");
  assert.equal(parsed.hasClientTitle, false);
  assert.equal(parsed.title, "写个单元测试");
  assert.equal(parsed.usages.length, 0);
});
