import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { writeMockNodeBin } from "./helpers/mock-cli.mjs";

register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) {
    if (s === "obsidian") return { url: "data:text/javascript,export class MarkdownView{};export class Notice{};", shortCircuit: true };
    return next(s, c);
  }`,
));

const { DEFAULTS, deepMerge } = await import("../src/constants.js");
const { Delegator } = await import("../src/delegation.js");
const { resolveInstalledAgentBinary, parseScutilProxy, cleanEnv, resetSystemProxyCache } = await import("../src/delegation-runners.js");
const { canContinueSession, hasAgentCapability } = await import("../src/agent-registry.js");
const { ingestCursorEvent } = await import("../src/cursor-sessions.js");
const { AutoLog } = await import("../src/autolog.js");
const { AgentUsage } = await import("../src/readers.js");
const { ingestCodexLine, ingestDshLine } = await import("../src/agent-ingestors.js");
const { JournalSync } = await import("../src/sync.js");
const { destinations, defaultDestination } = await import("../src/workflow.js");

function makeDelegation(vault, delegateCursor = {}) {
  const settings = deepMerge(DEFAULTS, {
    delegate: { cursor: { path: "", ...delegateCursor } },
    dispatchSnapshot: false,
  });
  let noteText = "- TODO Fix Windows delegation\n";
  const file = { path: "2026_11_23.md", basename: "2026_11_23" };
  const notices = [];
  const plugin = {
    settings,
    jobs: {},
    app: {
      vault: {
        adapter: { basePath: vault },
        getAbstractFileByPath: (p) => (p === file.path ? file : null),
        read: async () => noteText,
        process: async (_f, fn) => { noteText = fn(noteText); },
      },
      workspace: { getActiveViewOfType: () => null },
    },
    readNote: async () => noteText,
    saveJobs: () => {},
    saveJobsSoon: () => {},
    saveSettings: () => {},
    refreshUI: () => {},
    notice: (msg) => notices.push(msg),
    usage: { meta: new Map() },
    modelById: () => null,
    modelsFor: () => [],
  };
  return { d: new Delegator(plugin), plugin, notices, file };
}

test("Cursor delegation uses ACP (`agent acp`) when CLI is installed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cursor-acp-"));
  const argsFile = path.join(dir, "args.json");
  const mockAcp = writeMockNodeBin(dir, "agent", `
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
      } else if (msg.method === "session/new") {
        send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "cur-acp-1", configOptions: [] } });
      } else if (msg.method === "session/prompt") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "cur-acp-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done via Cursor ACP" } } } });
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
        process.exit(0);
      }
    });
  `);
  try {
    assert.equal(hasAgentCapability("cursor", "delegate"), true);
    assert.equal(hasAgentCapability("cursor", "acp"), true);
    assert.equal(resolveInstalledAgentBinary("cursor", mockAcp), mockAcp);
    const { d, file } = makeDelegation(dir, { path: mockAcp });
    const job = await d.delegate({ agent: "cursor", file, line: 0, lineText: "- TODO Fix Windows delegation" });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = () => {
        if (job.state === "done" || job.state === "error") return resolve();
        if (Date.now() > deadline) return reject(new Error(`timeout in state ${job.state}`));
        setTimeout(poll, 30);
      };
      poll();
    });
    assert.equal(job.state, "done", job.error || "");
    assert.equal(job.transport, "acp");
    assert.equal(job.sessionId, "cur-acp-1");
    assert.match(job.result, /Done via Cursor ACP/);
    assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, "utf8")), ["acp"]);
    assert.equal(canContinueSession({ agent: "cursor", sid: "cur-acp-1", transport: "acp" }), true);
    assert.equal(canContinueSession({ agent: "cursor", sid: "cur-desk-1" }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Cursor delegation falls back to desktop handoff when CLI is not installed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cursor-handoff-"));
  const missingBin = path.join(dir, "nonexistent-cursor-agent");
  try {
    assert.equal(resolveInstalledAgentBinary("cursor", missingBin), "");
    const { d, file } = makeDelegation(dir, { path: missingBin });
    let copied = "";
    let opened = "";
    d.copyText = (txt) => { copied = txt; return true; };
    d.openAgentApp = async (agent) => { opened = agent; return true; };
    const job = await d.delegate({ agent: "cursor", file, line: 0, lineText: "- TODO Fix Windows delegation" });
    assert.equal(job.handoff, true);
    assert.equal(job.agent, "cursor");
    assert.equal(opened, "cursor");
    assert.match(copied, /Fix Windows delegation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Cursor subagent child conversation gets parentSid and AutoLog skips it as a standalone journal task", async () => {
  const settings = deepMerge(DEFAULTS, { autoLogMinMinutes: 0 });
  const usage = new AgentUsage({ settings, cfg: settings });
  const now = Date.now();
  const touched = new Set();
  const childFc = { path: "child.jsonl", agent: "cursor", sid: "cur-child-1", id: "cur-child-1", cwd: "/repo", app: "desktop", model: "", size: 0, offset: 0, mtime: now, days: new Map(), msgs: new Map(), titles: new Map(), live: null };
  const parentFc = { path: "parent.jsonl", agent: "cursor", sid: "cur-parent-1", id: "cur-parent-1", cwd: "/repo", app: "desktop", model: "", size: 0, offset: 0, mtime: now, days: new Map(), msgs: new Map(), titles: new Map(), live: null };

  // Child event scanned before parent's subagentStop
  const ctx = { usage, cfg: settings, startRound: () => {}, finishRound: () => {} };
  ingestCursorEvent(ctx, { event: "beforeSubmitPrompt", sid: "cur-child-1", at: now - 120000, prompt: "Inspect subagent files" }, childFc, touched);
  ingestCursorEvent(ctx, { event: "beforeSubmitPrompt", sid: "cur-parent-1", at: now - 180000, prompt: "Main user task" }, parentFc, touched);
  ingestCursorEvent(ctx, { event: "subagentStop", sid: "cur-parent-1", at: now - 60000, subId: "sub-1", childSid: "cur-child-1", status: "done", summary: "Subagent finished" }, parentFc, touched);

  assert.equal(usage.meta.get("cur-child-1")?.parentSid, "cur-parent-1");

  const askedIds = [];
  const file = { path: "2026_11_23.md", basename: "2026_11_23" };
  const plugin = {
    settings,
    usage,
    jobs: {},
    agentEnabled: () => true,
    saveSettings: async () => {},
    app: {
      vault: { read: async () => "", process: async () => {} },
      workspace: { iterateAllLeaves: () => {} },
    },
  };
  const al = new AutoLog(plugin);
  al.ask = async (items) => {
    for (const it of items) askedIds.push(it.x.sid);
    return new Map();
  };
  await al.processDay(
    "2026-11-23",
    file,
    [
      { sid: "cur-parent-1", agent: "cursor", segs: [[600, 610]], min: 10 },
      { sid: "cur-child-1", agent: "cursor", segs: [[602, 608]], min: 6 },
    ],
    "2026-11-23",
    new Set(),
    { dry: true },
    { asked: 0 },
  );
  assert.deepEqual(askedIds, ["cur-parent-1"]);
});

test("Subagent exclusion applies universally across all agents, AutoLog.runOnce/processDay, and JournalSync", async () => {
  const settings = deepMerge(DEFAULTS, { autoLogMinMinutes: 0 });
  const usage = new AgentUsage({ settings, cfg: settings });
  const now = Date.now();
  const touched = new Set();
  const ctx = { usage, cfg: settings, startRound: () => {}, finishRound: () => {} };

  // 1. Codex subagent without parent_thread_id (e.g. review subagent)
  const codexSubFc = { path: "codex-sub.jsonl", agent: "codex", sid: "codex-sub-1", id: "codex-sub-1", cwd: "/repo", app: "codex", model: "", size: 0, offset: 0, mtime: now, days: new Map(), msgs: new Map(), titles: new Map(), live: null };
  ingestCodexLine(ctx, JSON.stringify({ type: "session_meta", payload: { id: "codex-sub-1", cwd: "/repo", source: { subagent: "review" } } }), codexSubFc, touched);
  usage.files.set(codexSubFc.path, codexSubFc);
  assert.equal(usage.isSubagentSession("codex-sub-1"), true);

  // 2. DSH subagent via delegationDepth > 0 even without parentSession
  const dshSubFc = { path: "dsh-sub.jsonl", agent: "dsh", sid: "dsh-sub-1", id: "dsh-sub-1", cwd: "/repo", app: "dsh", model: "", size: 0, offset: 0, mtime: now, days: new Map(), msgs: new Map(), titles: new Map(), live: null };
  ingestDshLine(ctx, JSON.stringify({ type: "session", id: "dsh-sub-1", cwd: "/repo", delegationDepth: 1, createdAt: now }), dshSubFc, touched);
  usage.files.set(dshSubFc.path, dshSubFc);
  assert.equal(usage.isSubagentSession("dsh-sub-1"), true);

  // 3. Claude Desktop side chat via deskBySid
  usage.deskBySid.set("claude-side-1", { sid: "claude-side-1", parentSid: "claude-main-1" });
  assert.equal(usage.isSubagentSession("claude-side-1"), true);

  // 4. OpenCode / Qoder / T3 Code / Hermes / MiniMax subagent via meta.parentSid
  usage.meta.set("opencode-sub-1", { sid: "opencode-sub-1", agent: "opencode", parentSid: "opencode-main-1" });
  usage.meta.set("main-1", { sid: "main-1", agent: "claude", parentSid: "" });
  assert.equal(usage.isSubagentSession("opencode-sub-1"), true);
  assert.equal(usage.isSubagentSession("main-1"), false);

  // 5. AutoLog.runOnce skips all subagent sessions before today/cross-day splitting
  const askedIds = [];
  const file = { path: "2026_11_23.md", basename: "2026_11_23" };
  usage.summary = () => ({
    list: [
      { sid: "main-1", agent: "claude", segs: [[600, 610]], min: 10 },
      { sid: "codex-sub-1", agent: "codex", segs: [[601, 605]], min: 4 },
      { sid: "dsh-sub-1", agent: "dsh", segs: [[601, 605]], min: 4 },
      { sid: "claude-side-1", agent: "claude", segs: [[601, 605]], min: 4 },
      { sid: "opencode-sub-1", agent: "opencode", segs: [[601, 605]], min: 4 },
    ],
  });
  const plugin = {
    settings,
    usage,
    jobs: {},
    agentEnabled: () => true,
    saveSettings: async () => {},
    app: {
      vault: {
        getAbstractFileByPath: () => file,
        read: async () => "",
        process: async () => {},
      },
      workspace: { iterateAllLeaves: () => {} },
    },
  };
  const al = new AutoLog(plugin);
  al.dayKey = () => "2026-11-23";
  al.journalFile = () => file;
  al.ask = async (items) => {
    for (const it of items) askedIds.push(it.x.sid);
    return new Map();
  };
  await al.runOnce({ dry: true });
  assert.deepEqual(askedIds, ["main-1"]);

  // 6. JournalSync.autoKeywords skips stale autoLogState entries that are subagents
  settings.autoLogState = {
    [new Date().toISOString().slice(0, 10)]: {
      "codex-sub-1": { key: "Review subagent", blockId: "ad-sub", status: "doing" },
    },
  };
  usage.meta.get("codex-sub-1").state = "wait";
  const js = new JournalSync(plugin);
  const note = "- DOING Review subagent ^ad-sub\n";
  assert.equal(js.autoKeywords(note, () => null), note);
});

test("Claude Code parent session with subagents/agent-*.jsonl in usage.files is NOT falsely treated as a subagent", async () => {
  const settings = deepMerge(DEFAULTS, { autoLogMinMinutes: 0 });
  const usage = new AgentUsage({ settings, cfg: settings });
  const parentSid = "11111111-2222-3333-4444-555555555555";
  const now = Date.now();
  const parentFc = usage.ensureFile(`/tmp/projects/${parentSid}.jsonl`, "claude");
  const subFc = usage.ensureFile(`/tmp/projects/${parentSid}/subagents/agent-abc123.jsonl`, "claude");
  usage.noteMeta(parentFc, parentSid, { title: "Main Claude Task", lastAt: now });
  usage.noteMeta(subFc, parentSid, { lastAt: now });
  assert.equal(usage.isSubagentSession(parentSid), false);

  const askedIds = [];
  const file = { path: "2026_11_23.md", basename: "2026_11_23" };
  usage.summary = () => ({ list: [{ sid: parentSid, agent: "claude", segs: [[600, 610]], min: 10 }] });
  const plugin = {
    settings,
    usage,
    jobs: {},
    agentEnabled: () => true,
    saveSettings: async () => {},
    app: {
      vault: { getAbstractFileByPath: () => file, read: async () => "", process: async () => {} },
      workspace: { iterateAllLeaves: () => {} },
    },
  };
  const al = new AutoLog(plugin);
  al.dayKey = () => "2026-11-23";
  al.journalFile = () => file;
  al.ask = async (items) => {
    for (const it of items) askedIds.push(it.x.sid);
    return new Map();
  };
  await al.runOnce({ dry: true });
  assert.deepEqual(askedIds, [parentSid]);
});

test("Cursor & Gemini destinations/defaultDestination work and explicit desktop destination triggers handoff even with CLI installed", async () => {
  assert.deepEqual(destinations("cursor").map((d) => d.id), ["background", "desktop"]);
  assert.equal(defaultDestination({}, "cursor"), "background");
  assert.deepEqual(destinations("gemini").map((d) => d.id), ["background", "terminal"]);
  assert.equal(defaultDestination({}, "gemini"), "background");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cursor-desk-"));
  const mockCli = writeMockNodeBin(dir, "agent", "process.exit(0);\n");
  try {
    const { d, file } = makeDelegation(dir, { path: mockCli });
    let copied = "";
    let opened = "";
    d.copyText = (txt) => { copied = txt; return true; };
    d.openAgentApp = async (agent) => { opened = agent; return true; };
    const job = await d.delegate({ agent: "cursor", destination: "desktop", file, line: 0, lineText: "- TODO Fix Windows delegation" });
    assert.equal(job.handoff, true);
    assert.equal(opened, "cursor");
    assert.match(copied, /Fix Windows delegation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseScutilProxy extracts HTTP/HTTPS/SOCKS/NO_PROXY and cleanEnv respects explicit overrides", () => {
  const sample = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : *.local
    3 : <local>
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}`;
  const parsed = parseScutilProxy(sample);
  assert.equal(parsed.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(parsed.http_proxy, "http://127.0.0.1:7897");
  assert.equal(parsed.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.equal(parsed.https_proxy, "http://127.0.0.1:7897");
  assert.equal(parsed.ALL_PROXY, "socks5://127.0.0.1:7897");
  assert.equal(parsed.all_proxy, "socks5://127.0.0.1:7897");
  assert.ok(parsed.NO_PROXY.includes("192.168.0.0/16"));
  assert.ok(parsed.NO_PROXY.includes("*.local"));
  assert.ok(parsed.NO_PROXY.includes("localhost"));
  assert.ok(parsed.NO_PROXY.includes("::1"));
  assert.equal(parsed.NO_PROXY.includes("<local>"), false);

  assert.deepEqual(parseScutilProxy("<dictionary> {\n  HTTPEnable : 0\n}"), {});

  resetSystemProxyCache();
  const custom = cleanEnv({ HTTP_PROXY: "http://10.0.0.2:9000", HTTPS_PROXY: "http://10.0.0.2:9000", ALL_PROXY: "" });
  assert.equal(custom.HTTP_PROXY, "http://10.0.0.2:9000");
  assert.equal(custom.HTTPS_PROXY, "http://10.0.0.2:9000");
  assert.equal(custom.ALL_PROXY, "");
});

test("ingestCursorEvent preserves parentSid and isSubagent across sessionStart and token-bearing stop early returns", () => {
  const settings = deepMerge(DEFAULTS, {});
  const usage = new AgentUsage({ settings, cfg: settings });
  const ctx = {
    usage,
    startRound: () => {},
    finishRound: () => {},
    stepText: () => "",
  };
  const touched = new Set();
  const now = Date.now();

  const fcStart = usage.ensureFile("/tmp/cur-sub-start.jsonl", "cursor");
  ingestCursorEvent(ctx, {
    v: 2,
    at: now,
    event: "sessionStart",
    sid: "cur-child-start",
    parentSid: "cur-parent-1",
    isSubagent: true,
    cwd: "/tmp/proj",
  }, fcStart, touched);
  assert.equal(usage.isSubagentSession("cur-child-start"), true);
  assert.equal(usage.meta.get("cur-child-start")?.parentSid, "cur-parent-1");
  assert.equal(usage.meta.get("cur-child-start")?.isSubagent, true);

  const fcStop = usage.ensureFile("/tmp/cur-sub-stop.jsonl", "cursor");
  ingestCursorEvent(ctx, {
    v: 2,
    at: now + 5000,
    event: "stop",
    sid: "cur-child-stop",
    parentSid: "cur-parent-1",
    isSubagent: true,
    cwd: "/tmp/proj",
    outTok: 50,
    inTok: 100,
  }, fcStop, touched);
  assert.equal(usage.isSubagentSession("cur-child-stop"), true);
  assert.equal(usage.meta.get("cur-child-stop")?.parentSid, "cur-parent-1");
  assert.equal(usage.meta.get("cur-child-stop")?.isSubagent, true);
});
