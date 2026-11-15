import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class Modal{};export class Component{};export const MarkdownRenderer={render:async()=>{}};',shortCircuit:true};return n(s,c)}`,
    ),
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cursor-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpRoot;

const CS = await import("../src/cursor-sessions.js");
const { AgentUsage, USAGE_CACHE_VERSION } = await import("../src/readers.js");
const { conversationMessages, conversationMarkdown, readConversation, archiveConversation } = await import("../src/conversation.js");
const J = await import("../src/journal.js");
const { AGENTS, DEFAULTS } = await import("../src/constants.js");

function runSql(dbFile, sql) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  execFileSync("/usr/bin/sqlite3", [dbFile, sql], { stdio: "pipe" });
}

function runHook(scriptPath, event, payload, homeDir) {
  const out = execFileSync(process.execPath, [scriptPath, event], {
    input: JSON.stringify(payload),
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8",
  });
  return JSON.parse(out.trim());
}

test("cursor constants, cache version and defaults are wired", () => {
  assert.equal(AGENTS.cursor.trackingOnly, true);
  assert.equal(AGENTS.cursor.desktopOnly, true);
  assert.equal(DEFAULTS.agents.cursor, true);
  assert.equal(DEFAULTS.autoLogAgents.cursor, true);
  assert.ok(USAGE_CACHE_VERSION >= 7);
});

test("cursorHooksStatus, installCursorHooks and uninstallCursorHooks merge and clean safely", () => {
  const homeDir = path.join(tmpRoot, "hooks-home");
  const hooksJson = CS.cursorHooksJsonPath(homeDir);
  fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
  fs.writeFileSync(
    hooksJson,
    JSON.stringify({ version: 1, hooks: { stop: [{ command: "/usr/local/bin/user-custom-hook" }] } }, null, 2),
  );

  let status = CS.cursorHooksStatus({ homeDir });
  assert.equal(status.installed, false);
  assert.equal(status.outdated, false);

  const installed = CS.installCursorHooks({ homeDir, nodePath: process.execPath });
  assert.ok(fs.existsSync(installed.scriptPath));
  assert.ok(fs.existsSync(installed.eventsDir));

  status = CS.cursorHooksStatus({ homeDir });
  assert.equal(status.installed, true);
  assert.equal(status.outdated, false);
  assert.equal(status.matchedEvents, CS.CURSOR_HOOK_EVENTS.length);

  // User hook in stop must still be present alongside Agent Deck entry.
  const parsed = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
  assert.equal(parsed.hooks.stop.length, 2);
  assert.equal(parsed.hooks.stop[0].command, "/usr/local/bin/user-custom-hook");

  // Re-installing updates in place without duplicating Agent Deck entries.
  CS.installCursorHooks({ homeDir, nodePath: process.execPath });
  const reparsed = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
  assert.equal(reparsed.hooks.stop.length, 2);

  // Outdated script banner triggers outdated flag.
  fs.writeFileSync(installed.scriptPath, `// ${CS.CURSOR_HOOK_MARKER} v0\n`);
  status = CS.cursorHooksStatus({ homeDir });
  assert.equal(status.outdated, true);

  CS.uninstallCursorHooks({ homeDir });
  status = CS.cursorHooksStatus({ homeDir });
  assert.equal(status.installed, false);
  assert.equal(status.matchedEvents, 0);
  const afterUninstall = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
  assert.deepEqual(afterUninstall.hooks.stop, [{ command: "/usr/local/bin/user-custom-hook" }]);
});

test("cursor-hook.mjs returns valid responses without followup loops and caps huge tool output", () => {
  const homeDir = path.join(tmpRoot, "exec-home");
  const { scriptPath } = CS.installCursorHooks({ homeDir, nodePath: process.execPath });
  const sid = "11111111-2222-3333-4444-555555555555";
  const gen = "gen-1";

  const r1 = runHook(
    scriptPath,
    "sessionStart",
    {
      hook_event_name: "sessionStart",
      conversation_id: sid,
      cursor_version: "3.30.14",
      workspace_roots: ["/tmp/proj"],
    },
    homeDir,
  );
  assert.deepEqual(r1, { continue: true });

  const r2 = runHook(
    scriptPath,
    "beforeSubmitPrompt",
    {
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: sid,
      generation_id: gen,
      cursor_version: "3.30.14",
      prompt: "<user_query>Fix Cursor tracking</user_query>",
    },
    homeDir,
  );
  assert.deepEqual(r2, { continue: true });

  const hugeOut = "x".repeat(70000);
  const r3 = runHook(
    scriptPath,
    "postToolUse",
    {
      hook_event_name: "postToolUse",
      conversation_id: sid,
      generation_id: gen,
      cursor_version: "3.30.14",
      tool_name: "read_file",
      tool_use_id: "call-huge",
      tool_input: { path: "big.log" },
      tool_output: hugeOut,
      duration_ms: 42,
    },
    homeDir,
  );
  assert.deepEqual(r3, {});

  const r4 = runHook(
    scriptPath,
    "stop",
    {
      hook_event_name: "stop",
      conversation_id: sid,
      generation_id: gen,
      cursor_version: "3.30.14",
      status: "completed",
      loop_count: 0,
    },
    homeDir,
  );
  assert.deepEqual(r4, {});
  assert.equal("followup_message" in r4, false);

  const evFile = path.join(CS.cursorEventsDir(homeDir), `${sid}.jsonl`);
  const lines = fs.readFileSync(evFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 4);
  const toolEv = lines.find((l) => l.callId === "call-huge");
  assert.equal(toolEv.outputTruncated, true);
  assert.equal(toolEv.outputLength, 70000);
  assert.ok(toolEv.output.length < 70000);
  assert.equal(toolEv.durationMs, 42);
});

test("Cursor < 3.30.14 events and unhooked legacy DB sessions are excluded from tracking", async () => {
  const sidLegacy = "aaaaaaaa-0000-0000-0000-000000000001";
  const sidOldVer = "bbbbbbbb-0000-0000-0000-000000000002";

  // Seed Cursor DB with a legacy session that has NO hook events.
  const trackDb = CS.cursorTrackingDbPath(tmpRoot);
  runSql(
    trackDb,
    `CREATE TABLE IF NOT EXISTS conversation_summaries (conversationId TEXT PRIMARY KEY, title TEXT, model TEXT);
     INSERT OR REPLACE INTO conversation_summaries VALUES ('${sidLegacy}', 'Legacy Unhooked Title', 'claude-4.5');`,
  );

  // Write an old-version hook event (< 3.30.14).
  const evDir = CS.cursorEventsDir(tmpRoot);
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(
    path.join(evDir, `${sidOldVer}.jsonl`),
    JSON.stringify({
      event: "beforeSubmitPrompt",
      sid: sidOldVer,
      gen: "g0",
      at: Date.now(),
      version: "3.29.0",
      prompt: "old cursor version",
    }) + "\n",
  );

  const usage = new AgentUsage({ cfg: { dayCutoff: 4 }, settings: { agents: { cursor: true } } });
  await usage.scan({ since: 0 });
  assert.equal(usage.meta.has(sidLegacy), false, "legacy DB session without hook events must not be discovered");
  assert.equal(usage.meta.has(sidOldVer), false, "Cursor < 3.30.14 events must be ignored");
  assert.equal(buildMessagesLen(path.join(evDir, `${sidOldVer}.jsonl`)), 0);
});

function buildMessagesLen(file) {
  return conversationMessages("cursor", fs.readFileSync(file, "utf8")).length;
}

test("AgentUsage incrementally tracks Cursor lifecycle, WAL metadata, subagents, cache and missing tokens", async () => {
  const sid = "22222222-3333-4444-5555-666666666666";
  const sidArchived = "33333333-3333-4444-5555-666666666666";
  const evDir = CS.cursorEventsDir(tmpRoot);
  const evFile = path.join(evDir, `${sid}.jsonl`);
  const evArch = path.join(evDir, `${sidArchived}.jsonl`);
  fs.mkdirSync(evDir, { recursive: true });

  const now = Date.now() - 2000;
  const rows1 = [
    { event: "sessionStart", sid, at: now, version: "3.30.14", roots: ["/tmp/my-app"] },
    { event: "beforeSubmitPrompt", sid, gen: "g1", at: now + 50, version: "3.30.14", prompt: "<user_query>Add Cursor support</user_query>" },
    { event: "preToolUse", sid, gen: "g1", callId: "c1", at: now + 100, version: "3.30.14", tool: "Shell", input: { command: "npm test" } },
    { event: "postToolUseFailure", sid, gen: "g1", callId: "c1", at: now + 150, version: "3.30.14", tool: "Shell", error: "exit 1", failureType: "error", durationMs: 50 },
    { event: "subagentStart", sid, subId: "sub-1", task: "Inspect DB", subType: "explore", at: now + 160, version: "3.30.14" },
  ];
  fs.writeFileSync(evFile, rows1.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const stateDb = CS.cursorStateDbPath(tmpRoot, process.platform, process.env);
  runSql(
    stateDb,
    `PRAGMA journal_mode=WAL;
     CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
     INSERT OR REPLACE INTO cursorDiskKV VALUES ('composerData:${sid}', '${JSON.stringify({
       name: "Cursor Meta Title",
       isArchived: false,
       workspaceIdentifier: { uri: { fsPath: "/tmp/my-app" } },
       modelConfig: { modelName: "composer-1.5" },
     }).replaceAll("'", "''")}');
     INSERT OR REPLACE INTO cursorDiskKV VALUES ('composerData:${sidArchived}', '${JSON.stringify({
       name: "Done Composer",
       isArchived: true,
       workspaceIdentifier: { uri: { fsPath: "/tmp/my-app" } },
     }).replaceAll("'", "''")}');`,
  );

  // Verify live running state + tool failure doesn't falsely error the turn.
  const usage = new AgentUsage({ cfg: { dayCutoff: 4 }, settings: { agents: { cursor: true }, hideArchived: true } });
  await usage.scan({ since: 0 });

  let meta = usage.meta.get(sid);
  assert.ok(meta);
  assert.equal(meta.agent, "cursor");
  assert.equal(meta.state, "run", "postToolUseFailure in middle of turn must remain run");
  assert.equal(meta.title, "Cursor Meta Title");
  assert.equal(meta.cwd, "/tmp/my-app");
  assert.equal(meta.model, "composer-1.5");
  assert.equal(meta.out, 0, "missing tokens must stay 0");
  assert.equal(meta.fresh, 0, "missing tokens must stay 0");
  assert.equal(usage.subs.get(sid)?.get("sub-1")?.state, "run");

  // Append duplicate preToolUse, recovery response with real tokens, subagentStop, and completed stop.
  const rows2 = [
    { event: "preToolUse", sid, gen: "g1", callId: "c1", at: now + 100, version: "3.30.14", tool: "Shell", input: { command: "npm test" } },
    { event: "subagentStop", sid, subId: "sub-1", status: "completed", summary: "Found tables", at: now + 220, version: "3.30.14" },
    {
      event: "afterAgentResponse", sid, gen: "g1", at: now + 300, version: "3.30.14",
      text: "Recovered and passed tests.", inTok: 100, outTok: 40, cacheRead: 25, cacheWrite: 10,
    },
    { event: "stop", sid, gen: "g1", at: now + 350, version: "3.30.14", status: "completed", loopCount: 0 },
  ];
  fs.appendFileSync(evFile, rows2.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // Also add archived session with hook events so WAL isArchived filtering is verified.
  fs.writeFileSync(
    evArch,
    [
      { event: "beforeSubmitPrompt", sid: sidArchived, gen: "g9", at: now + 10, version: "3.30.14", prompt: "Archived task" },
      { event: "stop", sid: sidArchived, gen: "g9", at: now + 40, version: "3.30.14", status: "completed" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );

  await usage.scan({ since: 0 });
  meta = usage.meta.get(sid);
  assert.equal(meta.state, "wait");
  assert.equal(meta.out, 40);
  assert.equal(meta.fresh, 110);
  assert.equal(meta.cached, 25);
  assert.equal(meta.turns, 1);
  assert.equal(usage.subs.get(sid)?.get("sub-1")?.state, "done");
  assert.equal(usage.hidden(sidArchived), true, "archived Cursor session is hidden when hideArchived != false");

  // Cache save + reload preserves dedup state and totals without double counting on repeat scan.
  const cachePath = path.join(tmpRoot, "usage-cache.json.gz");
  await usage.saveCache(cachePath);
  const usage2 = new AgentUsage({ cfg: { dayCutoff: 4 }, settings: { agents: { cursor: true }, hideArchived: true } });
  const loaded = await usage2.loadCache(cachePath);
  assert.equal(loaded, true);
  await usage2.scan({ since: 0 });
  const meta2 = usage2.meta.get(sid);
  assert.equal(meta2.out, 40);
  assert.equal(meta2.fresh, 110);
  assert.equal(meta2.turns, 1);
});

test("Conversation tool timeline pairs tools, marks missing results, folds long outputs, aligns resumed turns and protects edits", async () => {
  const sid = "44444444-5555-6666-7777-888888888888";
  const trFile = path.join(tmpRoot, "transcripts", `${sid}.jsonl`);
  fs.mkdirSync(path.dirname(trFile), { recursive: true });
  // Resumed session: turn 1 happened BEFORE Hooks, turn 2 happened AFTER Hooks and missed afterAgentResponse.
  fs.writeFileSync(
    trFile,
    [
      { role: "user", message: { content: [{ type: "text", text: "<user_query>Legacy turn 1</user_query>" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Legacy reply 1" }] } },
      { role: "user", message: { content: [{ type: "text", text: "<user_query>Post-hook turn 2</user_query>" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Supplemented reply 2" }] } },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );

  const longOutput = Array.from({ length: 12 }, (_, i) => `line ${i + 1}: output payload`).join("\n");
  const evFile = path.join(CS.cursorEventsDir(tmpRoot), `${sid}.jsonl`);
  const t0 = Date.now() - 1000;
  fs.writeFileSync(
    evFile,
    [
      { event: "beforeSubmitPrompt", sid, gen: "g2", at: t0, version: "3.30.14", prompt: "Post-hook turn 2", transcript: trFile },
      // Deliberately out-of-order postToolUse before preToolUse for c_oo
      { event: "postToolUse", sid, gen: "g2", callId: "c_oo", at: t0 + 80, version: "3.30.14", tool: "read_file", output: longOutput, outputLength: longOutput.length, durationMs: 60 },
      { event: "preToolUse", sid, gen: "g2", callId: "c_oo", at: t0 + 20, version: "3.30.14", tool: "read_file", input: { path: "src/main.js" } },
      // Missing result tool
      { event: "preToolUse", sid, gen: "g2", callId: "c_miss", at: t0 + 90, version: "3.30.14", tool: "grep", input: { pattern: "cursor" } },
      { event: "stop", sid, gen: "g2", at: t0 + 120, version: "3.30.14", status: "completed" },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );

  const mockPlugin = {
    jobs: {},
    usage: { files: new Map([[evFile, { path: evFile, agent: "cursor", sid, sub: "", cursor: { transcript: trFile } }]]) },
    app: { vault: new MockVault() },
    readNote: null,
    writeNote: null,
  };

  const msgs = await readConversation(mockPlugin, { agent: "cursor", sid });
  assert.equal(msgs.length, 2, "must not backfill pre-Hook turn 1");
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "Post-hook turn 2");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].text, "Supplemented reply 2");
  assert.equal(msgs[1].tools.length, 2);
  assert.equal(msgs[1].tools[0].status, "success");
  assert.equal(msgs[1].tools[1].missingResult, true);

  const md = conversationMarkdown({ agent: "cursor", sid, title: "Cursor Demo" }, msgs);
  assert.ok(md.includes("### 工具时间线"));
  assert.ok(md.includes("<details>\n<summary>展开完整工具结果"));
  assert.ok(md.includes("_未采集到工具结果_"));

  const file = await archiveConversation(mockPlugin, { agent: "cursor", sid, title: "Cursor Demo" });
  const stored = mockPlugin.app.vault.files.get(file.path);
  assert.ok(stored.includes("### 工具时间线"));

  // Editing archived body manually prevents silent overwrite.
  mockPlugin.app.vault.files.set(file.path, stored + "\nHandwritten note");
  //Wait: check edit outside comment vs inside comment:
  mockPlugin.app.vault.files.set(file.path, stored.replace("Supplemented reply 2", "User edited reply"));
  await assert.rejects(() => archiveConversation(mockPlugin, { agent: "cursor", sid, title: "Cursor Demo" }), /手工修改/);
});

test("Journal links and cleanup support Cursor sessions", () => {
  const sid = "55555555-6666-7777-8888-999999999999";
  const line = J.linkLine("  ", "cursor", "修复状态刷新", sid).trimEnd();
  assert.ok(line.includes("agent=cursor"));
  const parsed = J.parseLink(line);
  assert.equal(parsed.agent, "cursor");
  assert.equal(parsed.sid, sid);
  assert.ok(J.isDeckBlockId(`ad-cursor-${sid.slice(0, 8)}`));
});

class MockVault {
  constructor() {
    this.files = new Map();
    this.folders = new Set();
  }
  getAbstractFileByPath(p) {
    if (this.files.has(p)) return { path: p };
    if (this.folders.has(p)) return { path: p, children: [] };
    return null;
  }
  async createFolder(p) { this.folders.add(p); }
  async create(p, content) { this.files.set(p, content); return { path: p }; }
  async read(f) { return this.files.get(f.path) || ""; }
  async modify(f, content) { this.files.set(f.path, content); }
  async process(f, fn) {
    const next = fn(this.files.get(f.path) || "");
    this.files.set(f.path, next);
    return next;
  }
}

test.after(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
