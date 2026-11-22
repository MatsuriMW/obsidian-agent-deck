import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { AGENTS, AGENT_ORDER, DEFAULTS } from "../src/constants.js";
import {
  acpAgents,
  acpAutoApproveAgents,
  delegateAgents,
  cliHandoffAgents,
  usesDeckSessionLink,
  getAgentCapability,
} from "../src/agent-registry.js";
import { acpSpawnArgs, findAgentBinary, AcpRunner } from "../src/delegation-runners.js";
import { desktopSessions, desktopMessages } from "../src/desktop-sessions.js";
import { resolveSqliteBinary } from "../src/sqlite.js";
import { writeMockNodeBin, rmDirSafe } from "./helpers/mock-cli.mjs";
import { AgentUsage, USAGE_CACHE_VERSION } from "../src/readers.js";
import { readConversation } from "../src/conversation.js";
import { detectInstalledHarnesses } from "../src/harness-detect.js";
import { destinations, defaultDestination, canOpenClient } from "../src/workflow.js";
import { isCliSession, AGENT_APPS } from "../src/delegation.js";
import * as J from "../src/journal.js";

function createMinimaxFixtureDb(dbPath, nowMs) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sql = `
CREATE TABLE local_runtime_projects (
  project_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_kind TEXT NOT NULL,
  workspace_dir TEXT,
  display_name TEXT
);
CREATE TABLE local_runtime_sessions (
  session_id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL DEFAULT '{}',
  updated_at_ms INTEGER NOT NULL,
  agent_name TEXT,
  runtime TEXT,
  session_type TEXT,
  status TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'visible',
  session_kind TEXT NOT NULL DEFAULT 'conversation',
  parent_session_id TEXT,
  workspace_dir TEXT,
  project_workspace_dir TEXT,
  title TEXT,
  created_at_ms INTEGER,
  error_message TEXT,
  project_id INTEGER
);
CREATE TABLE local_runtime_messages (
  session_id TEXT PRIMARY KEY,
  display_messages_json TEXT NOT NULL,
  pi_history_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE local_runtime_message_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  role TEXT,
  turn_id TEXT,
  created_at_ms INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE(session_id, msg_id)
);
CREATE TABLE local_runtime_token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL DEFAULT 'mavis',
  framework_type TEXT NOT NULL DEFAULT 'pi',
  turn_id TEXT,
  model TEXT,
  ts INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_usd REAL,
  raw TEXT
);

INSERT INTO local_runtime_projects (project_id, project_kind, workspace_dir, display_name)
VALUES (1, 'workspace', '/tmp/proj-minimax', 'proj-minimax');

-- 1. Active desktop session using v2 message_rows + per-turn token usage
INSERT INTO local_runtime_sessions (
  session_id, updated_at_ms, runtime, session_type, status, archived, visibility,
  workspace_dir, project_workspace_dir, title, created_at_ms, project_id
) VALUES (
  'ses_mm_1', ${nowMs - 1000}, 'desktop', 'chat', 'idle', 0, 'visible',
  '', '', '修复登录跳转', ${nowMs - 60000}, 1
);

INSERT INTO local_runtime_message_rows (session_id, msg_id, role, turn_id, created_at_ms, data_json) VALUES
  ('ses_mm_1', 'm1', 'user', 'turn-1', ${nowMs - 50000}, '{"msg_id":"m1","role":"user","turn_id":"turn-1","msg_content":"帮我排查登录跳转循环","timestamp":${nowMs - 50000}}'),
  ('ses_mm_1', 'm2', 'assistant', 'turn-1', ${nowMs - 40000}, '{"msg_id":"m2","role":"assistant","turn_id":"turn-1","msg_content":"先看路由配置","tool_calls":[{"name":"read_file"}],"finish_reason":"tool_calls","timestamp":${nowMs - 40000}}'),
  ('ses_mm_1', 'm3', 'assistant', 'turn-1', ${nowMs - 30000}, '{"msg_id":"m3","role":"assistant","turn_id":"turn-1","msg_content":"已经修复 redirect 循环并通过单测。","finish_reason":"stop","timestamp":${nowMs - 30000}}');

INSERT INTO local_runtime_token_usage (session_id, turn_id, model, ts, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES
  ('ses_mm_1', 'turn-1', 'MiniMax-M3', ${nowMs - 40000}, 1000, 120, 500, 200),
  ('ses_mm_1', 'turn-1', 'MiniMax-M3', ${nowMs - 30000}, 400, 80, 900, 50);

-- 2. Legacy session using local_runtime_messages.display_messages_json + parent + archived + cli runtime
INSERT INTO local_runtime_sessions (
  session_id, updated_at_ms, runtime, session_type, status, archived, visibility,
  parent_session_id, workspace_dir, title, created_at_ms
) VALUES (
  'ses_mm_legacy', ${nowMs - 5000}, 'cli', 'interactive', 'idle', 1, 'visible',
  'ses_mm_1', '/tmp/proj-minimax', 'CLI 子会话', ${nowMs - 20000}
);

INSERT INTO local_runtime_messages (session_id, display_messages_json) VALUES (
  'ses_mm_legacy',
  '[{"msg_id":"lm1","role":"user","msg_content":"跑一下构建","timestamp":${nowMs - 15000}},{"msg_id":"lm2","role":"assistant","msg_content":"构建通过","finish_reason":"stop","timestamp":${nowMs - 10000}}]'
);

-- 3. Hidden internal session must be skipped
INSERT INTO local_runtime_sessions (
  session_id, updated_at_ms, runtime, status, archived, visibility, workspace_dir, title, created_at_ms
) VALUES (
  'ses_mm_hidden', ${nowMs - 500}, 'desktop', 'idle', 0, 'hidden', '/tmp/proj-minimax', 'Hidden internal', ${nowMs - 1000}
);
`;
  execFileSync(resolveSqliteBinary(), [dbPath, sql], { stdio: "pipe" });
}

test("MiniMax Code registration, capabilities, workflow and link helpers", () => {
  assert.ok(AGENT_ORDER.includes("minimax"));
  assert.equal(AGENTS.minimax.name, "MiniMax Code");
  assert.equal(DEFAULTS.agents.minimax, true);
  assert.equal(DEFAULTS.models.defaultByAgent.minimax, "minimax-default");

  assert.ok(acpAgents().includes("minimax"));
  assert.ok(acpAutoApproveAgents().includes("minimax"));
  assert.ok(delegateAgents().includes("minimax"));
  assert.ok(cliHandoffAgents().includes("minimax"));
  assert.equal(usesDeckSessionLink("minimax"), true);
  assert.equal(getAgentCapability("minimax").autoOpenDesktopOnDone, true);
  assert.deepEqual(acpSpawnArgs("minimax", "/Users/test/.minimax-code/bin/mcode", ""), ["acp"]);

  assert.deepEqual(destinations("minimax").map((d) => d.id), ["desktop", "background", "terminal"]);
  assert.equal(defaultDestination({}, "minimax"), "background");
  assert.equal(canOpenClient({ agent: "minimax", app: "desktop" }), true);
  assert.equal(isCliSession("minimax", "cli"), true);
  assert.equal(isCliSession("minimax", "desktop"), false);
  assert.equal(AGENT_APPS.minimax.bundle, "com.minimax.agent.cn");

  const line = J.linkLine("  ", "minimax", "修复登录跳转", "ses_mm_1");
  assert.deepEqual(J.parseLink(line), { agent: "minimax", sid: "ses_mm_1", title: "修复登录跳转" });
});

test("MiniMax Code SQLite reader parses v2 rows, legacy messages, per-turn tokens, project cwd and hides internal sessions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-minimax-db-"));
  const dbPath = path.join(dir, "v2", "sqlite", "runtime-state.sqlite");
  const nowMs = Date.now();
  createMinimaxFixtureDb(dbPath, nowMs);

  try {
    const sessions = await desktopSessions(dbPath, "minimax", 0);
    assert.equal(sessions.length, 2, "hidden session must be excluded");

    const s1 = sessions.find((s) => s.sid === "ses_mm_1");
    assert.ok(s1);
    assert.equal(s1.title, "修复登录跳转");
    assert.equal(s1.cwd, "/tmp/proj-minimax");
    assert.equal(s1.model, "MiniMax-M3");
    assert.equal(s1.app, "desktop");
    assert.equal(s1.archived, false);
    assert.equal(s1.out, 200);
    assert.equal(s1.fresh, 1650); // (1000+200) + (400+50)
    assert.equal(s1.cached, 1400); // 500 + 900

    const sLegacy = sessions.find((s) => s.sid === "ses_mm_legacy");
    assert.ok(sLegacy);
    assert.equal(sLegacy.archived, true);
    assert.equal(sLegacy.parentSid, "ses_mm_1");
    assert.equal(sLegacy.app, "cli");

    const msgs1 = await desktopMessages(dbPath, "minimax", "ses_mm_1");
    assert.equal(msgs1.length, 3);
    assert.equal(msgs1[0].role, "user");
    assert.equal(msgs1[0].text, "帮我排查登录跳转循环");
    assert.equal(msgs1[1].role, "assistant");
    assert.equal(msgs1[1].state, "run");
    assert.equal(msgs1[1].step, "read_file");
    assert.equal(msgs1[1].out, 0, "turn token usage attaches once to last assistant message in turn");
    assert.equal(msgs1[2].role, "assistant");
    assert.equal(msgs1[2].state, "wait");
    assert.equal(msgs1[2].model, "MiniMax-M3");
    assert.equal(msgs1[2].out, 200);
    assert.equal(msgs1[2].fresh, 1650);
    assert.equal(msgs1[2].cached, 1400);

    const msgsLegacy = await desktopMessages(dbPath, "minimax", "ses_mm_legacy");
    assert.equal(msgsLegacy.length, 2);
    assert.equal(msgsLegacy[0].text, "跑一下构建");
    assert.equal(msgsLegacy[1].text, "构建通过");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AgentUsage end-to-end scan and readConversation with MINIMAX_DATA_DIR", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-minimax-usage-"));
  const dbPath = path.join(dir, "v2", "sqlite", "runtime-state.sqlite");
  const nowMs = Date.now();
  createMinimaxFixtureDb(dbPath, nowMs);

  const prevEnv = process.env.MINIMAX_DATA_DIR;
  process.env.MINIMAX_DATA_DIR = dir;
  try {
    assert.ok(USAGE_CACHE_VERSION >= 16);
    const usage = new AgentUsage({
      agents: { minimax: true },
      primaryAgents: ["minimax"],
    });
    await usage.readDesktopDatabases({ floor: 0, onlyAgent: "minimax", strictSince: false, touched: new Set() });

    const meta = usage.meta.get("ses_mm_1");
    assert.ok(meta, "ses_mm_1 should be indexed");
    assert.equal(meta.agent, "minimax");
    assert.equal(meta.title, "修复登录跳转");
    assert.equal(meta.model, "MiniMax-M3");
    assert.equal(meta.out, 200);
    assert.equal(meta.fresh, 1650);
    assert.equal(meta.cached, 1400);
    assert.equal(meta.turns, 1);

    assert.equal(usage.archived.has("ses_mm_legacy"), true);

    const conv = await readConversation({ usage, jobs: {} }, { agent: "minimax", sid: "ses_mm_1" });
    assert.ok(conv.length >= 2);
    assert.equal(conv[0].role, "user");
    assert.equal(conv[0].text, "帮我排查登录跳转循环");
    assert.match(conv[conv.length - 1].text, /已经修复 redirect 循环/);
  } finally {
    if (prevEnv === undefined) delete process.env.MINIMAX_DATA_DIR;
    else process.env.MINIMAX_DATA_DIR = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detectInstalledHarnesses detects MiniMax Code via app, mcode CLI, or ~/.minimax", () => {
  const fakeHome = "/tmp/fake-home-mm";
  const byApp = detectInstalledHarnesses({
    homeDir: fakeHome,
    platform: "darwin",
    env: { PATH: "" },
    appDirs: ["/Applications"],
    pathEntries: [],
    exists: (p) => p === path.join("/Applications", "MiniMax Code.app"),
    isFile: () => false,
  });
  assert.equal(byApp.detected.minimax, true);
  assert.deepEqual(byApp.details.minimax.via, ["app"]);

  const byCli = detectInstalledHarnesses({
    homeDir: fakeHome,
    platform: "darwin",
    env: { PATH: "" },
    appDirs: ["/Applications"],
    pathEntries: [],
    exists: () => false,
    isFile: (p) => p === path.join(fakeHome, ".minimax-code", "bin", "mcode"),
  });
  assert.equal(byCli.detected.minimax, true);
  assert.deepEqual(byCli.details.minimax.via, ["cli"]);

  const byData = detectInstalledHarnesses({
    homeDir: fakeHome,
    platform: "darwin",
    env: { PATH: "" },
    appDirs: ["/Applications"],
    pathEntries: [],
    exists: (p) => p === path.join(fakeHome, ".minimax"),
    isFile: () => false,
  });
  assert.equal(byData.detected.minimax, true);
  assert.deepEqual(byData.details.minimax.via, ["data"]);

  assert.equal(findAgentBinary("minimax", "/custom/mcode"), "/custom/mcode");
});

test("AcpRunner delegates to MiniMax Code via mcode acp and handles default model without overriding", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-minimax-acp-"));
  const log = path.join(dir, "rpc.jsonl");
  const mockBin = writeMockNodeBin(dir, "mcode", `
const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");
rl.on("line", (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), m }) + "\\n");
  if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: 1 } });
  if (m.method === "session/new") return send({ id: m.id, result: { sessionId: "ses_mm_acp_1", models: { availableModels: [{ modelId: "MiniMax-M3", name: "M3" }] } } });
  if (m.method === "session/prompt") {
    send({ method: "session/update", params: { sessionId: "ses_mm_acp_1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "MINIMAX_ACP_OK" } } } });
    return send({ id: m.id, result: { stopReason: "end_turn" } });
  }
});
rl.on("close", () => process.exit(0));
`);

  let doneJob = null;
  const delegator = {
    settings: { delegate: { minimax: { path: mockBin, model: "minimax-default", effort: "", autoApprove: true } } },
    vaultPath: dir,
    saveJobs() {},
    saveJobsSoon() {},
    refreshUI() {},
    onSession() {},
    notify() {},
    onDone(j) { doneJob = j; },
    onError(j) { throw new Error(j.error); },
  };
  const job = { id: "j-mm-1", agent: "minimax", name: "MiniMax ACP Task", state: "starting" };
  const runner = new AcpRunner(delegator, job);
  try {
    await runner.start({ cwd: dir, prompt: "Ping MiniMax", model: "minimax-default", effort: "" });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(doneJob, "MiniMax AcpRunner completed cleanly");
    assert.equal(doneJob.sessionId, "ses_mm_acp_1");
    assert.equal(doneJob.result, "MINIMAX_ACP_OK");
    const rpc = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rpc[0].argv, ["acp"], "mcode receives acp subcommand");
    assert.equal(rpc.some((x) => x.m.method === "session/set_model"), false, "minimax-default does not override server model");
  } finally {
    runner.cancel?.();
    rmDirSafe(dir);
  }
});
