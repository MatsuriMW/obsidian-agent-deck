import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

import { AGENTS, AGENT_ORDER, DEFAULTS, dayKeyToday } from "../src/constants.js";
import {
  getAgentCapability,
  hasAgentCapability,
  registerAgentCapability,
  acpAgents,
  acpAutoApproveAgents,
  delegateAgents,
  cliHandoffAgents,
  usesDeckSessionLink,
} from "../src/agent-registry.js";
import {
  expandedPathEntries,
  acpModels,
  acpSpawnArgs,
  isAllowPermissionOption,
  pickPermissionOption,
  AcpRunner,
} from "../src/delegation-runners.js";
import { desktopSessions, desktopMessages, hermesTime } from "../src/desktop-sessions.js";
import { resolveSqliteBinary } from "../src/sqlite.js";
import { writeMockNodeBin, rmDirSafe } from "./helpers/mock-cli.mjs";
import { AgentUsage, projectName, normalizeProjectRoot, USAGE_CACHE_VERSION } from "../src/readers.js";
import { conversationMessages, readConversation } from "../src/conversation.js";
import { destinations, defaultDestination, canOpenClient } from "../src/workflow.js";
import { Delegator } from "../src/delegation.js";
import * as J from "../src/journal.js";

test("Task 1: cross-agent ACP registry generalization & permission matching", () => {
  assert.ok(acpAgents().includes("hermes"));
  assert.deepEqual(acpAutoApproveAgents(), acpAgents());
  assert.ok(delegateAgents().includes("hermes"));
  assert.ok(!delegateAgents().includes("qwenwork"));
  assert.ok(cliHandoffAgents().includes("hermes"));

  const ext = registerAgentCapability("custom-acp-tool", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: ["--stdio"],
    acpAutoApprove: true,
    acpModelOptional: true,
    acpEffortOptional: true,
  });
  assert.equal(ext.acpAutoApprove, true);
  assert.equal(hasAgentCapability("custom-acp-tool", "acp"), true);
  assert.deepEqual(acpSpawnArgs("custom-acp-tool", "mybin", "--verbose"), ["--stdio", "--verbose"]);
  assert.deepEqual(acpSpawnArgs("hermes", "/opt/homebrew/bin/hermes-acp", ""), []);
  assert.deepEqual(acpSpawnArgs("hermes", "/opt/homebrew/bin/hermes", "--yolo"), ["acp", "--yolo"]);
  assert.deepEqual(acpSpawnArgs("dsh", "/usr/local/bin/dsh", ""), ["acp"]);

  // Permission option matching for Hermes & custom ACP servers (with/without kind)
  const hermesOpts = [
    { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
    { optionId: "allow_session", kind: "allow_always", name: "Allow for session" },
    { optionId: "deny", kind: "reject_once", name: "Deny" },
  ];
  assert.equal(pickPermissionOption(hermesOpts, true)?.optionId, "allow_once");
  assert.equal(pickPermissionOption(hermesOpts, false)?.optionId, "deny");
  assert.equal(isAllowPermissionOption(hermesOpts[1]), true);
  assert.equal(isAllowPermissionOption(hermesOpts[2]), false);

  const kindlessOpts = [
    { optionId: "allow_session", name: "Allow" },
    { optionId: "deny_always", name: "Deny always" },
  ];
  assert.equal(pickPermissionOption(kindlessOpts, true)?.optionId, "allow_session");
  assert.equal(pickPermissionOption(kindlessOpts, false)?.optionId, "deny_always");
});

test("Task 1: expandedPathEntries discovers nvm/uv/bun/conda/npm-global without user-specific paths", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-path-"));
  const nvmNew = path.join(fakeHome, ".nvm/versions/node/v22.12.0/bin");
  const nvmOld = path.join(fakeHome, ".nvm/versions/node/v20.11.0/bin");
  const uvBin = path.join(fakeHome, ".local/share/uv/tools/hermes-agent/bin");
  fs.mkdirSync(nvmNew, { recursive: true });
  fs.mkdirSync(nvmOld, { recursive: true });
  fs.mkdirSync(uvBin, { recursive: true });

  const entries = expandedPathEntries("/usr/bin", fakeHome);
  assert.ok(entries.includes(path.join(fakeHome, ".bun/bin")), "bun bin is probed on every platform");
  if (process.platform === "win32") {
    // Windows 的静态探测目录只有 .local/bin、.bun/bin 与 %APPDATA%/npm；
    // nvm / uv / pnpm / pyenv / conda 这些 POSIX 布局不参与探测。
    assert.ok(entries.includes(path.join(fakeHome, ".local", "bin")));
  } else {
    assert.ok(entries.includes(nvmNew));
    assert.ok(entries.includes(nvmOld));
    assert.ok(entries.indexOf(nvmNew) < entries.indexOf(nvmOld), "newest nvm version ordered first");
    assert.ok(entries.includes(uvBin));
    assert.ok(entries.includes(path.join(fakeHome, ".npm-global/bin")));
    assert.ok(entries.includes(path.join(fakeHome, "miniforge3/bin")));
  }
});

test("Task 1: requestAcpPermission queues concurrent modals and auto-approves queued requests once enabled", async () => {
  const mainSrc = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSrc.indexOf("  requestAcpPermission(info, runner) {");
  const end = mainSrc.indexOf("\n  openSession(", start);
  assert.ok(start > 0 && end > start);

  const opened = [];
  class FakeModal {
    constructor(app, info, resolve) { this.info = info; this.resolve = resolve; }
    open() { opened.push(this); }
    close() {}
  }
  const host = vm.runInNewContext("({" + mainSrc.slice(start, end) + "})", {
    AcpPermissionModal: FakeModal,
    AGENTS,
    t: (s) => s,
    pickPermissionOption,
  });
  host.app = {};
  host.settings = { delegate: { hermes: { autoApprove: false } } };
  host.saveSettings = async () => {};
  host.notice = () => {};

  const runner = { finished: false };
  const opts = [
    { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
    { optionId: "deny", kind: "reject_once", name: "Deny" },
  ];

  const p1 = host.requestAcpPermission({ agent: "hermes", toolCall: { title: "First" }, options: opts }, runner);
  const p2 = host.requestAcpPermission({ agent: "hermes", toolCall: { title: "Second" }, options: opts }, runner);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(opened.length, 1, "second permission request waits in queue until first closes");

  await opened[0].info.onAutoApprove();
  opened[0].resolve("allow_once");

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "allow_once");
  assert.equal(r2, "allow_once");
  assert.equal(opened.length, 1, "queued second request auto-resolved without opening a second modal");
});

test("Task 1 + Task 2: AcpRunner tolerates missing delegate[agent] settings and drives SessionModelState + set_model", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-hermes-acp-"));
  const log = path.join(dir, "rpc.jsonl");
  const bin = writeMockNodeBin(dir, "fake-hermes-acp", `const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let promptId;
rl.on("line", (line) => {
  const m = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), m }) + "\\n");
  if (m.method === "initialize") {
    send({ id: m.id, result: { agentCapabilities: { loadSession: true } } });
    return;
  }
  if (m.method === "session/new") {
    send({
      id: m.id,
      result: {
        sessionId: "hermes-sess-1",
        models: {
          currentModelId: "openrouter:default",
          availableModels: [{ modelId: "openai:gpt-5.4", name: "GPT-5.4", description: "OpenAI" }],
        },
      },
    });
    return;
  }
  if (m.method === "session/set_model") {
    send({ id: m.id, result: {} });
    return;
  }
  if (m.method === "session/prompt") {
    promptId = m.id;
    send({
      id: 777,
      method: "session/request_permission",
      params: {
        sessionId: "hermes-sess-1",
        toolCall: { title: "Run echo" },
        options: [
          { optionId: "allow_once", name: "Allow once" },
          { optionId: "deny", name: "Deny" },
        ],
      },
    });
    return;
  }
  if (m.id === 777) {
    send({ method: "session/update", params: { sessionId: "hermes-sess-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "HERMES_ACP_OK" } } } });
    send({ id: promptId, result: { stopReason: "end_turn" } });
  }
});
rl.on("close", () => process.exit(0));`);

  const models = acpModels("hermes", [], { availableModels: [{ modelId: "openai:gpt-5.4", name: "GPT-5.4" }] });
  assert.equal(models.length, 1);
  assert.equal(models[0].value, "openai:gpt-5.4");

  registerAgentCapability("fake-hermes-acp", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: [],
    acpAutoApprove: true,
    acpModelOptional: true,
    acpEffortOptional: true,
  });

  let doneJob = null;
  const delegator = {
    settings: { delegate: {} }, // Intentionally missing settings.delegate[agent]!
    vaultPath: dir,
    saveJobs() {},
    saveJobsSoon() {},
    refreshUI() {},
    onSession() {},
    notify() {},
    onDone(j) { doneJob = j; },
    onError(j) { throw new Error(j.error); },
  };
  const job = { id: "j-hermes", agent: "fake-hermes-acp", name: "Hermes Task", state: "starting" };
  const runner = new AcpRunner(delegator, job);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
    try {
      await runner.start({ cwd: dir, prompt: "Ping", model: "openai:gpt-5.4" });
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      process.env.PATH = oldPath;
    }
    assert.ok(doneJob, "ACP runner completed cleanly even with missing settings.delegate[agent]");
    assert.equal(doneJob.sessionId, "hermes-sess-1");
    assert.equal(doneJob.result, "HERMES_ACP_OK");
    assert.equal(doneJob.stopReason, "end_turn");
    assert.equal(delegator.settings.delegate["fake-hermes-acp"]?.availableModels?.length, 1, "persists discovered ACP models even if settings.delegate[agent] was absent");

    const rpc = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rpc[0].argv, [], "-acp binary does not receive spurious 'acp' subcommand");
    const setModel = rpc.find((x) => x.m.method === "session/set_model");
    assert.deepEqual(setModel?.m?.params, { sessionId: "hermes-sess-1", modelId: "openai:gpt-5.4" });
    const permReply = rpc.find((x) => x.m.id === 777);
    assert.deepEqual(permReply?.m?.result?.outcome, { outcome: "selected", optionId: "deny" }, "omitted delegate[agent] rejects via matched deny optionId without TypeError");
  } finally {
    runner.cancel?.();
    rmDirSafe(dir);
  }
});

test("Task 2: Hermes state.db SQLite tracking converts Unix seconds, preserves exact tokens, filters compacted/inactive, and reads conversations", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-hermes-db-"));
  const dbPath = path.join(dir, "state.db");
  const nowSec = Math.floor(Date.now() / 1000) - 60;
  const sql = `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT, created_source TEXT, model TEXT, parent_session_id TEXT,
      started_at REAL, ended_at REAL, end_reason TEXT, message_count INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
      cwd TEXT, title TEXT, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, last_activity_at REAL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT,
      tool_calls TEXT, tool_name TEXT, timestamp REAL, finish_reason TEXT,
      active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0
    );
    INSERT INTO sessions VALUES ('h-1','cli','cli','gpt-5.4','',${nowSec},${nowSec + 12},'',2,1200,340,800,150,'/tmp/proj-a','Hermes DB Test',0,0,${nowSec + 12});
    INSERT INTO sessions VALUES ('h-arch','acp','acp','claude-opus','',${nowSec - 20},${nowSec - 10},'',2,10,5,0,0,'/tmp/proj-a','Archived Hermes',1,0,${nowSec - 10});
    INSERT INTO sessions VALUES ('h-hidden','cron','cron','gpt-5.4','',${nowSec},${nowSec + 5},'',2,99,99,0,0,'/tmp/proj-a','Hidden Cron',0,1,${nowSec + 5});
    INSERT INTO messages (session_id,role,content,tool_calls,tool_name,timestamp,finish_reason,active,compacted) VALUES
      ('h-1','user','Check build status',NULL,NULL,${nowSec},NULL,1,0),
      ('h-1','assistant','Compacted old summary',NULL,NULL,${nowSec + 4},'stop',0,1),
      ('h-1','assistant','Rewound discarded answer',NULL,NULL,${nowSec + 6},'stop',0,0),
      ('h-1','assistant','All tests pass cleanly.',NULL,NULL,${nowSec + 12},'stop',1,0),
      ('h-arch','user','Old task',NULL,NULL,${nowSec - 20},NULL,1,0),
      ('h-arch','assistant','Done',NULL,NULL,${nowSec - 10},'stop',1,0);
  `;
  execFileSync(resolveSqliteBinary(), [dbPath], { input: sql });

  assert.equal(hermesTime(nowSec), nowSec * 1000);
  const rows = await desktopSessions(dbPath, "hermes", 0);
  assert.equal(rows.length, 2, "excludes hidden=1 internal sessions");
  const s1 = rows.find((r) => r.sid === "h-1");
  assert.equal(s1.startedAt, nowSec * 1000);
  assert.equal(s1.out, 340);
  assert.equal(s1.fresh, 1350, "input + cache_write without double counting cache_read");
  assert.equal(s1.cached, 800);
  assert.equal(s1.app, "cli");
  const sArch = rows.find((r) => r.sid === "h-arch");
  assert.equal(sArch.archived, true);
  assert.equal(sArch.app, "acp");

  const msgs = await desktopMessages(dbPath, "hermes", "h-1");
  assert.deepEqual(msgs.map((m) => m.text), [
    "Check build status",
    "Compacted old summary",
    "All tests pass cleanly.",
  ], "includes active=1 and compacted=1, drops rewound active=0 & compacted=0");

  const oldHermesHome = process.env.HERMES_HOME;
  process.env.HERMES_HOME = dir;
  try {
    assert.ok(USAGE_CACHE_VERSION >= 14);
    const usage = new AgentUsage({ settings: DEFAULTS });
    await usage.scan({ agent: "hermes" });
    const meta = usage.meta.get("h-1");
    assert.ok(meta, "AgentUsage ingested Hermes session");
    assert.equal(meta.out, 340);
    assert.equal(meta.fresh, 1350);
    assert.equal(meta.cached, 800);
    assert.equal(usage.hidden("h-arch"), true);

    const todaySummary = usage.summary(dayKeyToday({}));
    assert.equal(todaySummary.by.hermes.out, 345);
    assert.equal(todaySummary.by.hermes.fresh, 1360);
    assert.equal(todaySummary.by.hermes.cached, 800);

    const readBack = await readConversation({ jobs: {}, usage }, { agent: "hermes", sid: "h-1" });
    assert.equal(readBack.length, 3);
    assert.equal(readBack[2].text, "All tests pass cleanly.");
  } finally {
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }

  assert.deepEqual(destinations("hermes").map((d) => d.id), ["background", "terminal"]);
  assert.equal(defaultDestination({ settings: DEFAULTS }, "hermes"), "background");
  assert.equal(canOpenClient({ agent: "hermes", app: "acp" }), false);
  assert.equal(canOpenClient({ agent: "hermes", app: "cli" }), true);
});

test("Task 3: QwenWork (千问办公) JSONL session tracking, honest zero-token accounting, and journal links", async () => {
  assert.ok(AGENT_ORDER.includes("qwenwork"));
  assert.equal(AGENTS.qwenwork.trackingOnly, true);
  assert.equal(getAgentCapability("qwenwork").delegate, false);
  assert.equal(usesDeckSessionLink("qwenwork"), true);
  assert.equal(usesDeckSessionLink("hermes"), true);

  const linkQ = J.linkLine("  ", "qwenwork", "整理合同", "qw-123");
  assert.equal(J.parseLink(linkQ).agent, "qwenwork");
  assert.equal(J.parseLink(linkQ).sid, "qw-123");
  const linkH = J.linkLine("  ", "hermes", "跑回归测试", "h-123");
  assert.equal(J.parseLink(linkH).agent, "hermes");
  assert.equal(J.parseLink(linkH).sid, "h-123");

  const fakeTaskCwd = "/Users/example/.qwenworkcn/workspace/b36ce4c5-d0af-47df-9d07-675becb02f45/task-workspaces/mw6cnk2qe5kyg603";
  assert.equal(projectName(fakeTaskCwd), "QwenWork");
  assert.equal(normalizeProjectRoot(fakeTaskCwd), "");
  const fakeChatCwd = "/Users/example/.qwenworkcn/workspace/2026-11-19/mwm8qe3dg2dvpkc5";
  assert.equal(projectName(fakeChatCwd), "QwenWork", "QwenWork 2.x chat workspaces label as QwenWork");
  assert.equal(normalizeProjectRoot(fakeChatCwd), "");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-qwenwork-"));
  const projDir = path.join(dir, "projects", "-tmp-workspace");
  fs.mkdirSync(projDir, { recursive: true });
  const nowIso = new Date().toISOString();
  const sid = "4382635e-bc16-475e-a9bd-54d28ae42369";
  const jsonlPath = path.join(projDir, `${sid}.jsonl`);
  fs.writeFileSync(jsonlPath, [
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      timestamp: nowIso,
      isSidechain: false,
      cwd: fakeTaskCwd,
      sessionId: sid,
      entrypoint: "cli",
      message: { role: "user", content: [{ type: "text", text: "分析这份周报" }] },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      timestamp: nowIso,
      isSidechain: false,
      cwd: fakeTaskCwd,
      sessionId: sid,
      entrypoint: "cli",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "unknown",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "周报重点已梳理完成。" }],
      },
    }),
  ].join("\n") + "\n");

  const msgs = conversationMessages("qwenwork", fs.readFileSync(jsonlPath, "utf8"));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].text, "周报重点已梳理完成。");

  // QwenWork 2.x desktop chats live in the SQLite store of its embedded engine.
  const dbDir = path.join(dir, ".harness", "flash-cli", "qwenwork");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "qwenwork.db");
  const dbSid = "ses_qwenwork_sqlite_1";
  const dbAt = Date.now() - 60 * 1000;
  const userData = {
    role: "user",
    time: { created: dbAt },
    agent: "qwenwork",
    model: { providerID: "openai-compatible", modelID: "flash", variant: "low" },
    summary: { diffs: [] },
  };
  const assistantData = {
    role: "assistant",
    time: { created: dbAt + 400, completed: dbAt + 900 },
    agent: "qwenwork",
    modelID: "flash",
    providerID: "openai-compatible",
    tokens: { input: 120, output: 7, reasoning: 0, cache: { write: 0, read: 30 } },
    finish: "stop",
  };
  const prefixed = [
    "<workspace_context>",
    "- Workspace mode: general",
    "</workspace_context>",
    "",
    "<system-reminder>",
    "internal awareness block",
    "</system-reminder>",
    "",
    "Available MCP servers:",
    "- qwapp: No description available",
    "Use qw-builtin_list to see all tools, qw-builtin_get to get tool schema, qw-builtin_call to execute.",
    "The names under Available tools are NOT directly callable SDK tool names in lazy-load mode.",
    "Use each listed mcp__server__tool value only as the toolName field for qw-builtin_get and qw-builtin_call.",
    "Getting a tool schema does not register a new callable function. Do not guess aliases if a function is absent from the real tool list.",
    "Never call mcp__server__tool directly unless it is already exposed in the real tool list.",
    "",
    "Available tools:",
    "mcp__qwapp__docview_getlist, mcp__qwapp__save_document",
    "",
    "测试文本等待效果",
  ].join("\n");
  const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  execFileSync(resolveSqliteBinary(), ["-cmd", ".timeout 2000", dbPath], {
    input: [
      "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT, model TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);",
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);",
      "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);",
      `INSERT INTO session VALUES (${q(dbSid)}, 'New session', ${q(path.join(dir, ".qwenworkcn", "workspace", "2026-11-19", "mwm8qe3dg2dvpkc5"))}, '', 'flash', ${dbAt}, ${dbAt + 900}, NULL);`,
      `INSERT INTO message VALUES ('msg-u1', ${q(dbSid)}, ${dbAt}, ${dbAt}, ${q(JSON.stringify(userData))});`,
      `INSERT INTO message VALUES ('msg-a1', ${q(dbSid)}, ${dbAt + 400}, ${dbAt + 900}, ${q(JSON.stringify(assistantData))});`,
      `INSERT INTO part VALUES ('prt-u1', 'msg-u1', ${q(dbSid)}, ${dbAt}, ${dbAt}, ${q(JSON.stringify({ type: "text", text: prefixed }))});`,
      `INSERT INTO part VALUES ('prt-a1', 'msg-a1', ${q(dbSid)}, ${dbAt + 400}, ${dbAt + 400}, ${q(JSON.stringify({ type: "text", text: "收到，文本正常输出。" }))});`,
    ].join("\n"),
    encoding: "utf8",
  });

  const oldQwenHome = process.env.QWENWORK_HOME;
  process.env.QWENWORK_HOME = dir;
  try {
    const usage = new AgentUsage({ settings: DEFAULTS });
    await usage.scan({ agent: "qwenwork" });
    const meta = usage.meta.get(sid);
    assert.ok(meta, "QwenWork session indexed");
    assert.equal(meta.agent, "qwenwork");
    assert.equal(meta.state, "wait");
    assert.equal(meta.model, "", "filters out QwenWork placeholder 'unknown' model");
    assert.equal(meta.out, 0, "does not estimate missing tokens");
    assert.equal(meta.fresh, 0);
    assert.equal(meta.cached, 0);
    assert.equal(meta.turns, 1);

    const readBack = await readConversation({ jobs: {}, usage }, { agent: "qwenwork", sid });
    assert.equal(readBack.length, 2);

    const dbMeta = usage.meta.get(dbSid);
    assert.ok(dbMeta, "QwenWork 2.x SQLite session indexed");
    assert.equal(dbMeta.agent, "qwenwork");
    assert.equal(dbMeta.turns, 1);
    assert.equal(dbMeta.out, 7, "real output tokens from the SQLite store");
    assert.equal(dbMeta.fresh, 120);
    assert.equal(dbMeta.cached, 30);
    assert.equal(dbMeta.model, "flash");

    const dbRead = await readConversation({ jobs: {}, usage }, { agent: "qwenwork", sid: dbSid });
    assert.equal(dbRead.length, 2);
    assert.equal(dbRead[0].text, "测试文本等待效果", "engine context prefix is stripped from the user message");
    assert.equal(dbRead[1].text, "收到，文本正常输出。");
  } finally {
    if (oldQwenHome === undefined) delete process.env.QWENWORK_HOME;
    else process.env.QWENWORK_HOME = oldQwenHome;
    rmDirSafe(dir);
  }

  assert.equal(hasAgentCapability("qwenwork", "delegate"), false);
  assert.equal(hasAgentCapability("qwenwork", "desktopHandoffOnly"), true);
});

test("Menu bar snapshot matches Sidebar Now classification (project / status / flat) and ribbon omits Memory table", async () => {
  const mainSrc = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(!mainSrc.includes('addRibbonIcon("table", t("记忆表格")'), "Memory table is not placed on the left Obsidian ribbon");

  const now = Date.now();
  const buildStart = mainSrc.indexOf("  buildMenuBarState() {");
  const buildEnd = mainSrc.indexOf("\n  async restoreNautilusAgentBar()", buildStart);
  assert.ok(buildStart > 0 && buildEnd > buildStart);

  // Extract buildProjectGroups/buildNowStatusGroups/isActiveNowSession/mergeSessionsWithJobs/orderNowSessions from project-workbench.js directly
  const workbench = await import("../src/project-workbench.js");
  const { projectName } = await import("../src/readers.js");
  const host = vm.runInNewContext("({" + mainSrc.slice(buildStart, buildEnd) + "})", {
    AGENTS,
    AGENT_ORDER,
    Date,
    t: (s) => s,
    dayKeyToday: () => "2026-11-19",
    dayKey: () => "2026-11-19",
    fmtMin: (m) => `${m}m`,
    fmtTok: (n) => `${n}`,
    timeAgo: () => "1m",
    truncate: (s) => s,
    projectName,
    menuKeyword: (st) => ({ id: st === "run" ? "DOING" : "WAITING", zh: st === "run" ? "DOING" : "WAITING" }),
    menuStateLabel: (st) => st,
    menuRank: (st) => (st === "run" ? 0 : 1),
    visibleMenuAgents: (list) => list,
    isCodexDesktop: () => false,
    usesDeckSessionLink: () => true,
    isCliSession: () => true,
    sessionDeepLink: () => "",
    J: { deckSessionUrl: (a, sid) => `obsidian://agent-deck?do=open&agent=${a}&sid=${encodeURIComponent(sid)}` },
    ...workbench,
  });
  host.settings = {
    primaryAgents: ["claude"],
    agents: DEFAULTS.agents,
    ui: { nowGroupBy: "status" },
    menuBarPinnedSids: [],
    nowHidden: {},
    nowOrder: [],
  };
  host.jobs = {
    "job-pending": { id: "job-pending", agent: "hermes", name: "Queued task", state: "starting", cwd: "/tmp/proj-a", startedAt: now },
  };
  host.store = { get: () => null };
  host.usage = { hasClientTitle: () => false };
  host.sessionTitles = null;
  host.primaryAgents = () => ["claude"];
  host.agentEnabled = (id) => DEFAULTS.agents[id] !== false;
  host.sessionProgressText = () => "";
  host.menuBarSessionTitle = (s) => s.title || s.sid;
  host.liveSessions = () => [
    { sid: "s-wait", agent: "claude", state: "wait", title: "Need reply", cwd: "/tmp/proj-a", lastAt: now - 1000 },
    { sid: "s-run", agent: "hermes", state: "run", title: "Running job", cwd: "/tmp/proj-a", lastAt: now - 500 },
  ];

  const snap = host.buildMenuBarState();
  assert.equal(snap.nowGroupBy, "status");
  assert.equal(snap.projectGroups.length, 1);
  assert.equal(snap.projectGroups[0].sessions.length, 3);
  assert.deepEqual(snap.statusGroups.map((g) => g.id), ["waiting", "pending", "running"]);
  assert.equal(snap.sessions.length, 3);
});
