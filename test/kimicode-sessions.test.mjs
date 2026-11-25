import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { cleanupDelegatorDir, writeMockNodeBin } from "./helpers/mock-cli.mjs";

register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) {
    if (s === "obsidian") return { url: "data:text/javascript,export class MarkdownView{};export class Notice{};", shortCircuit: true };
    return next(s, c);
  }`,
));

const {
  discoverKimiCodeSessions,
  parseKimiCodeSession,
  buildKimiCodeConversation,
} = await import("../src/kimicode-sessions.js");
const { DEFAULTS, deepMerge } = await import("../src/constants.js");
const { Delegator } = await import("../src/delegation.js");
const { resolveInstalledAgentBinary } = await import("../src/delegation-runners.js");
const { canContinueSession, hasAgentCapability } = await import("../src/agent-registry.js");
const { AgentUsage, USAGE_CACHE_VERSION } = await import("../src/readers.js");
const { destinations, defaultDestination } = await import("../src/workflow.js");

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

test("discoverKimiCodeSessions & parseKimiCodeSession support Desktop v2 (projects.json, state.json, agents/main/wire.jsonl, context.append_loop_event)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-kimi-v2-"));
  try {
    const base = path.join(tmp, ".kimi-code");
    const sessDir = path.join(base, "sessions", "proj_1", "sess-v2-001");
    fs.mkdirSync(path.join(sessDir, "agents", "main"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "projects.json"),
      JSON.stringify({ schema_version: 2, projects: { proj_1: { root: "/Users/demo/project-v2", name: "project-v2" } } }),
    );
    fs.writeFileSync(
      path.join(sessDir, "state.json"),
      JSON.stringify({ id: "sess-v2-001", version: 2, title: "v2 新架构会话", titleKind: "custom", model: "kimi-code/k3", createdAt: 1795580000000 }),
    );
    fs.writeFileSync(
      path.join(sessDir, "agents", "main", "wire.jsonl"),
      [
        JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1795580000000 }),
        JSON.stringify({ type: "turn.prompt", time: 1795580001000, input: [{ type: "text", text: "修复 Kimi Code 追踪" }], origin: { kind: "user" } }),
        JSON.stringify({ type: "context.append_loop_event", time: 1795580002000, event: { type: "step.begin", uuid: "s2", turnId: 1, step: 1 } }),
        JSON.stringify({ type: "context.append_loop_event", time: 1795580003000, event: { type: "tool.call", stepUuid: "s2", toolCallId: "tc-v2", name: "read_file", args: { path: "src/kimicode-sessions.js" } } }),
        JSON.stringify({ type: "context.append_loop_event", time: 1795580004000, event: { type: "content.part", stepUuid: "s2", part: { type: "text", text: "已定位到 agents/main/wire.jsonl 路径变更。" } } }),
        JSON.stringify({ type: "context.append_loop_event", time: 1795580005000, event: { type: "step.end", uuid: "s2", turnId: 1, finishReason: "stop" } }),
        JSON.stringify({ type: "usage.record", time: 1795580005500, model: "kimi-code/k3", usage: { inputOther: 800, inputCacheCreation: 200, inputCacheRead: 3000, output: 120 } }),
        JSON.stringify({ type: "turn.ended", time: 1795580006000, turnId: 1, reason: "completed" }),
      ].join("\n") + "\n",
    );

    const { sessions } = discoverKimiCodeSessions({ homeDir: tmp, env: {} });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].cwd, "/Users/demo/project-v2");
    assert.equal(sessions[0].app, "desktop");
    assert.match(sessions[0].wirePath, /agents[\\/]main[\\/]wire\.jsonl$/);

    const parsed = parseKimiCodeSession(fs.readFileSync(sessions[0].wirePath, "utf8"), sessions[0].meta, sessions[0]);
    assert.equal(parsed.title, "v2 新架构会话");
    assert.equal(parsed.hasClientTitle, true);
    assert.equal(parsed.state, "wait");
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[1].text, "已定位到 agents/main/wire.jsonl 路径变更。");
    assert.equal(parsed.usages.length, 1);
    assert.deepEqual(
      { inp: parsed.usages[0].inp, cache: parsed.usages[0].cache, out: parsed.usages[0].out },
      { inp: 1000, cache: 3000, out: 120 },
    );

    const parsedProfile = parseKimiCodeSession([
      JSON.stringify({ type: "profile.bind", agentId: "main", modelAlias: "kimi-code/kimi-for-coding" }),
      JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "你好" }], origin: { kind: "user" } }, time: 1795592442087 }),
      JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "<system-reminder>\ndate\n</system-reminder>" }], origin: { kind: "injection", variant: "date_change" } }, time: 1795592442097 }),
      JSON.stringify({ type: "context.append_loop_event", time: 1795592442100, event: { type: "step.begin", uuid: "s-live-1", turnId: 0, step: 1 } }),
      JSON.stringify({ type: "context.append_loop_event", time: 1795592442500, event: { type: "content.part", stepUuid: "s-live-1", part: { type: "text", text: "pong" } } }),
      JSON.stringify({ type: "usage.record", agentId: "main", model: "kimi-code/kimi-for-coding", usage: { inputOther: 23605, output: 3, inputCacheRead: 3840, inputCacheCreation: 0 }, usageScope: "turn", time: 1795592442530 }),
      JSON.stringify({ type: "context.append_loop_event", time: 1795592442531, event: { type: "step.end", uuid: "s-live-1", messageId: "msg-live-1", turnId: 0, finishReason: "end_turn", usage: { inputOther: 23605, output: 3, inputCacheRead: 3840, inputCacheCreation: 0 } } }),
      JSON.stringify({ type: "turn.ended", agentId: "main", turnId: 0, reason: "completed", time: 1795592442538 }),
    ].join("\n"));
    assert.equal(parsedProfile.model, "kimi-code/kimi-for-coding");
    assert.equal(parsedProfile.entries.length, 2);
    assert.equal(parsedProfile.entries[1].text, "pong");
    assert.equal(parsedProfile.usages.length, 1);
    assert.deepEqual(
      { id: parsedProfile.usages[0].id, inp: parsedProfile.usages[0].inp, cache: parsedProfile.usages[0].cache, out: parsedProfile.usages[0].out },
      { id: "msg-live-1", inp: 23605, cache: 3840, out: 3 },
    );
    assert.equal(parsedProfile.state, "wait");

    const conv = buildKimiCodeConversation(`${sessions[0].wirePath}#sess-v2-001`);
    assert.equal(conv.length, 2);
    assert.match(conv[1].text, /已定位到 agents\/main\/wire\.jsonl 路径变更/);
    assert.match(conv[1].text, /\[tool: read_file\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("discoverKimiCodeSessions & parseKimiCodeSession support Kimi CLI (~/.kimi/kimi.json + message envelope)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-kimi-cli-"));
  try {
    const cliBase = path.join(tmp, ".kimi");
    const workDir = "/Users/demo/cli-repo";
    const wsHash = createHash("md5").update(workDir).digest("hex");
    const sessDir = path.join(cliBase, "sessions", wsHash, "cli-sess-001");
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(cliBase, "kimi.json"), JSON.stringify({ work_dirs: [{ path: workDir }] }));
    fs.writeFileSync(
      path.join(sessDir, "wire.jsonl"),
      [
        JSON.stringify({ timestamp: 1795581000, message: { type: "TurnBegin", payload: { user_input: "检查 CLI 日志" } } }),
        JSON.stringify({ timestamp: 1795581001, message: { type: "StepBegin", payload: { n: 1 } } }),
        JSON.stringify({ timestamp: 1795581002, message: { type: "ToolCall", payload: { type: "function", id: "tc1", function: { name: "Shell", arguments: "{\"command\":\"ls\"}" } } } }),
        JSON.stringify({ timestamp: 1795581003, message: { type: "ContentPart", payload: { type: "text", text: "CLI 日志解析正常。" } } }),
        JSON.stringify({ timestamp: 1795581004, message: { type: "StatusUpdate", payload: { message_id: "m1", token_usage: { input_other: 400, input_cache_creation: 50, input_cache_read: 1000, output: 80 } } } }),
        JSON.stringify({ timestamp: 1795581005, message: { type: "TurnEnd", payload: {} } }),
      ].join("\n") + "\n",
    );

    const { sessions } = discoverKimiCodeSessions({ homeDir: tmp, env: {} });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].app, "cli");
    assert.equal(sessions[0].cwd, workDir);

    const parsed = parseKimiCodeSession(fs.readFileSync(sessions[0].wirePath, "utf8"), sessions[0].meta, sessions[0]);
    assert.equal(parsed.state, "wait");
    assert.equal(parsed.title, "检查 CLI 日志");
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[1].text, "CLI 日志解析正常。");
    assert.equal(parsed.entries[1].tools[0].name, "Shell");
    assert.equal(parsed.usages.length, 1);
    assert.deepEqual(
      { inp: parsed.usages[0].inp, cache: parsed.usages[0].cache, out: parsed.usages[0].out },
      { inp: 450, cache: 1000, out: 80 },
    );
    assert.ok(USAGE_CACHE_VERSION >= 23);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Kimi Code delegates via `kimi acp`, supports follow-up, and falls back to desktop handoff when CLI is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-kimi-acp-"));
  const argsFile = path.join(dir, "args.json");
  const mockKimi = writeMockNodeBin(dir, "kimi", `
    const fs = require("fs");
    const readline = require("readline");
    fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
      if (msg.method === "initialize") {
        send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
      } else if (msg.method === "session/new" || msg.method === "session/load") {
        send({ jsonrpc: "2.0", id: msg.id, result: {
          sessionId: msg.params.sessionId || "kimi-acp-1",
          configOptions: [{ id: "thinking", category: "thought_level", type: "select", currentValue: "max", options: [{ value: "low" }, { value: "high" }, { value: "max" }] }],
        } });
      } else if (msg.method === "session/set_config_option") {
        send({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [] } });
      } else if (msg.method === "session/prompt") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Kimi ACP OK" } } } });
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      }
    });
    rl.on("close", () => process.exit(0));
  `);

  const makeDelegator = (pathVal) => {
    const settings = deepMerge(DEFAULTS, {
      delegate: { kimicode: { path: pathVal } },
      dispatchSnapshot: false,
      autoWriteResult: false,
    });
    settings.delegate.writeLink = false;
    settings.delegate.confirmFirst = false;
    const noteText = "- TODO Test Kimi Code delegation\n";
    const file = { path: "2026_11_25.md", basename: "2026_11_25" };
    const plugin = {
      settings,
      jobs: {},
      vaultPath: dir,
      app: {
        vault: {
          adapter: { basePath: dir },
          getAbstractFileByPath: (p) => (p === file.path ? file : null),
          read: async () => noteText,
          process: async () => {},
        },
        workspace: { getActiveViewOfType: () => null },
      },
      readNote: async () => noteText,
      saveJobs: () => {},
      saveJobsSoon: () => {},
      saveSettings: () => {},
      refreshUI: () => {},
      notice: () => {},
      usage: { meta: new Map() },
      modelById: () => null,
      modelsFor: () => [],
    };
    return { d: new Delegator(plugin), file };
  };

  let delegator;
  let fallbackDelegator;
  try {
    assert.equal(hasAgentCapability("kimicode", "delegate"), true);
    assert.equal(hasAgentCapability("kimicode", "acp"), true);
    assert.deepEqual(destinations("kimicode").map((x) => x.id), ["background", "desktop"]);
    assert.equal(defaultDestination({}, "kimicode"), "background");
    assert.equal(resolveInstalledAgentBinary("kimicode", mockKimi), mockKimi);

    const { d, file } = makeDelegator(mockKimi);
    delegator = d;
    const job = await d.delegate({ agent: "kimicode", file, line: 0, lineText: "- TODO Test Kimi Code delegation" });
    for (let i = 0; i < 100 && !["done", "error"].includes(job.state); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(job.state, "done", job.error || "");
    assert.equal(job.transport, "acp");
    assert.equal(job.sessionId, "kimi-acp-1");
    assert.equal(job.result, "Kimi ACP OK");
    assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, "utf8")), ["acp"]);
    assert.equal(canContinueSession({ agent: "kimicode", sid: "kimi-acp-1", transport: "acp" }), true);
    assert.equal(canContinueSession({ agent: "kimicode", sid: "kimi-desk-1" }), false);

    const next = await d.continueSession({ agent: "kimicode", sid: job.sessionId, transport: "acp" }, "追问一次");
    for (let i = 0; i < 100 && !["done", "error"].includes(next.state); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(next.state, "done", next.error || "");
    assert.equal(next.conversation.length, 4);

    // Unsupported effort (`medium`) should fail fast locally against server-advertised thinking options
    const badEff = await d.delegate({ agent: "kimicode", file, line: 0, effort: "medium", newSession: true, lineText: "- TODO Test Kimi Code delegation" });
    for (let i = 0; i < 100 && !["done", "error"].includes(badEff.state); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(badEff.state, "error");
    assert.match(badEff.error, /不支持推理强度/);

    // Fallback to desktop handoff when CLI binary does not exist
    const missingBin = path.join(dir, "nonexistent-kimi");
    const fb = makeDelegator(missingBin);
    fallbackDelegator = fb.d;
    let copied = "";
    let opened = "";
    fb.d.copyText = (txt) => { copied = txt; return true; };
    fb.d.openAgentApp = async (agent) => { opened = agent; return true; };
    const fbJob = await fb.d.delegate({ agent: "kimicode", file, line: 0, lineText: "- TODO Test Kimi Code delegation" });
    assert.equal(fbJob.handoff, true);
    assert.equal(fbJob.state, "starting");
    assert.equal(opened, "kimicode");
    assert.match(copied, /Test Kimi Code delegation/);
  } finally {
    clearTimeout(fallbackDelegator?._saveT);
    cleanupDelegatorDir(delegator, dir);
  }
});
