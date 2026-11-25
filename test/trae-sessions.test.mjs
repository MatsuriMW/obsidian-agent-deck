import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { test } from "node:test";
import { register } from "node:module";
import { writeMockNodeBin } from "./helpers/mock-cli.mjs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class Modal{};export class Component{};export const MarkdownRenderer={render:async()=>{}};',shortCircuit:true};return n(s,c)}`,
    ),
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ad-trae-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpRoot;
const origUserProfile = process.env.USERPROFILE;
const origAppData = process.env.APPDATA;
if (process.platform === "win32") {
  process.env.USERPROFILE = tmpRoot;
  delete process.env.APPDATA;
}

const TS = await import("../src/trae-sessions.js");
const { AgentUsage, USAGE_CACHE_VERSION } = await import("../src/readers.js");
const { conversationMessages, conversationMarkdown, readConversation } = await import("../src/conversation.js");
const { extractToolCallsFromJsonl } = await import("../src/security-audit.js");
const J = await import("../src/journal.js");
const { AGENTS, DEFAULTS, deepMerge } = await import("../src/constants.js");
const { canDelegateDrop, canContinueSession, hasAgentCapability } = await import("../src/agent-registry.js");
const { Delegator } = await import("../src/delegation.js");
const { resolveInstalledAgentBinary } = await import("../src/delegation-runners.js");
const { destinations, defaultDestination } = await import("../src/workflow.js");
const { detectInstalledHarnesses, HARNESS_DETECTION_VERSION } = await import("../src/harness-detect.js");

function runHook(scriptPath, event, payload, homeDir) {
  const out = execFileSync(process.execPath, [scriptPath, event], {
    input: JSON.stringify(payload),
    env: { ...process.env, HOME: homeDir, ...(process.platform === "win32" ? { USERPROFILE: homeDir } : {}) },
    encoding: "utf8",
  });
  return JSON.parse(out.trim());
}

test("trae constants, capabilities, cache version, and harness detection version are wired", () => {
  assert.ok(!AGENTS.trae.trackingOnly);
  assert.equal(AGENTS.trae.desktopOnly, false);
  assert.equal(DEFAULTS.agents.trae, true);
  assert.equal(DEFAULTS.autoLogAgents.trae, true);
  assert.equal(DEFAULTS.delegate.trae.model, "trae-default");
  assert.equal(hasAgentCapability("trae", "delegate"), true);
  assert.equal(hasAgentCapability("trae", "acp"), true);
  assert.equal(hasAgentCapability("trae", "handoffFallback"), true);
  assert.equal(canDelegateDrop("trae"), true);
  assert.deepEqual(destinations("trae").map((d) => d.id), ["background", "desktop"]);
  assert.equal(defaultDestination({}, "trae"), "background");
  assert.ok(USAGE_CACHE_VERSION >= 25);
  assert.ok(HARNESS_DETECTION_VERSION >= 5);
});

test("traeHooksStatus, installTraeHooks and uninstallTraeHooks merge and clean safely across .trae-cn and .trae", () => {
  const homeDir = path.join(tmpRoot, "hooks-home");
  fs.mkdirSync(path.join(homeDir, ".trae-cn"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".trae"), { recursive: true });
  const cnHooks = path.join(homeDir, ".trae-cn", "hooks.json");
  const intlHooks = path.join(homeDir, ".trae", "hooks.json");
  const userGroup = { hooks: [{ type: "command", command: "/usr/local/bin/user-trae-stop" }] };
  fs.writeFileSync(cnHooks, JSON.stringify({ version: 1, hooks: { Stop: [userGroup] } }, null, 2));

  let status = TS.traeHooksStatus({ homeDir });
  assert.equal(status.installed, false);
  assert.equal(status.outdated, false);

  const installed = TS.installTraeHooks({ homeDir, nodePath: process.execPath });
  assert.ok(fs.existsSync(installed.scriptPath));
  assert.ok(fs.existsSync(installed.eventsDir));
  assert.equal(installed.hooksPaths.length, 2);

  status = TS.traeHooksStatus({ homeDir });
  assert.equal(status.installed, true);
  assert.equal(status.outdated, false);
  assert.equal(status.matchedEvents, TS.TRAE_HOOK_EVENTS.length);

  for (const hp of [cnHooks, intlHooks]) {
    const parsed = JSON.parse(fs.readFileSync(hp, "utf8"));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.hooks.PreToolUse.at(-1).matcher, ".*");
    assert.equal(parsed.hooks.PostToolUse.at(-1).matcher, ".*");
    assert.equal(parsed.hooks.UserPromptSubmit.at(-1).matcher, undefined);
  }
  const parsedCn = JSON.parse(fs.readFileSync(cnHooks, "utf8"));
  assert.equal(parsedCn.hooks.Stop.length, 2);
  assert.deepEqual(parsedCn.hooks.Stop[0], userGroup);

  // Re-installing updates in place without duplicating Agent Deck entries.
  TS.installTraeHooks({ homeDir, nodePath: process.execPath });
  assert.equal(JSON.parse(fs.readFileSync(cnHooks, "utf8")).hooks.Stop.length, 2);

  // Invalid legacy glob matcher "*" triggers outdated flag and gets upgraded to ".*".
  const badMatcherCfg = JSON.parse(fs.readFileSync(cnHooks, "utf8"));
  badMatcherCfg.hooks.PreToolUse.at(-1).matcher = "*";
  fs.writeFileSync(cnHooks, JSON.stringify(badMatcherCfg, null, 2));
  assert.equal(TS.traeHooksStatus({ homeDir }).outdated, true);
  TS.installTraeHooks({ homeDir, nodePath: process.execPath });
  assert.equal(JSON.parse(fs.readFileSync(cnHooks, "utf8")).hooks.PreToolUse.at(-1).matcher, ".*");
  assert.equal(TS.traeHooksStatus({ homeDir }).outdated, false);

  // Outdated script banner triggers outdated flag.
  fs.writeFileSync(installed.scriptPath, `// ${TS.TRAE_HOOK_MARKER} v0\n`);
  assert.equal(TS.traeHooksStatus({ homeDir }).outdated, true);

  TS.uninstallTraeHooks({ homeDir });
  status = TS.traeHooksStatus({ homeDir });
  assert.equal(status.installed, false);
  assert.equal(status.matchedEvents, 0);
  const afterUninstall = JSON.parse(fs.readFileSync(cnHooks, "utf8"));
  assert.deepEqual(afterUninstall.hooks.Stop, [userGroup]);
  assert.equal(afterUninstall.hooks.PreToolUse, undefined);
});

test("trae-hook.mjs writes events, truncates huge tool output, and returns {} passively", () => {
  const homeDir = path.join(tmpRoot, "exec-home");
  const { scriptPath } = TS.installTraeHooks({ homeDir, nodePath: process.execPath });
  const sid = "trae-sess-1";

  assert.deepEqual(
    runHook(scriptPath, "SessionStart", { hook_event_name: "SessionStart", session_id: sid, cwd: "/tmp/proj", display_model_name: "Doubao-Seed-1.6" }, homeDir),
    {},
  );
  assert.deepEqual(
    runHook(scriptPath, "UserPromptSubmit", { hook_event_name: "UserPromptSubmit", session_id: sid, prompt: "Inspect Trae hooks" }, homeDir),
    {},
  );
  const hugeOut = "z".repeat(70000);
  assert.deepEqual(
    runHook(scriptPath, "PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: sid,
      tool_name: "RunCommand",
      tool_use_id: "call-trae-huge",
      tool_input: { command: "ls" },
      tool_response: hugeOut,
      tool_success: true,
      duration_ms: 88,
    }, homeDir),
    {},
  );
  assert.deepEqual(
    runHook(scriptPath, "Stop", {
      hook_event_name: "Stop",
      session_id: sid,
      last_assistant_message: "Trae hooks checked.",
      loop_count: 1,
    }, homeDir),
    {},
  );

  const evFile = path.join(TS.traeEventsDir(homeDir), `${sid}.jsonl`);
  const lines = fs.readFileSync(evFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 4);
  const toolEv = lines.find((l) => l.callId === "call-trae-huge");
  assert.equal(toolEv.outputTruncated, true);
  assert.equal(toolEv.outputLength, 70000);
  assert.ok(toolEv.output.length < 70000);
  assert.equal(toolEv.toolSuccess, true);
  assert.equal(toolEv.durationMs, 88);
  assert.equal(lines[3].text, "Trae hooks checked.");
});

test("AgentUsage incrementally tracks Trae lifecycle, subagents, missing tokens, cache round-trip, conversation & audit", async () => {
  const sid = "trae-main-1";
  const subSid = "trae-sub-1";
  const evDir = TS.traeEventsDir(tmpRoot);
  fs.mkdirSync(evDir, { recursive: true });
  const evFile = path.join(evDir, `${sid}.jsonl`);
  const subFile = path.join(evDir, `${subSid}.jsonl`);
  const now = Date.now() - 4000;

  fs.writeFileSync(evFile, [
    { event: "SessionStart", sid, at: now, cwd: "/tmp/trae-app", model: "Claude-Sonnet", title: "Trae Main" },
    { event: "UserPromptSubmit", sid, at: now + 50, prompt: "Add Trae tracking" },
    { event: "PreToolUse", sid, callId: "t1", at: now + 100, tool: "RunCommand", input: { command: "npm test" } },
    { event: "PostToolUse", sid, callId: "t1", at: now + 200, tool: "RunCommand", output: "ok", toolSuccess: true, durationMs: 100 },
    { event: "PreToolUse", sid, callId: "t2", at: now + 250, tool: "ReadFile", input: { path: "src/main.js" } },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  fs.writeFileSync(subFile, [
    { event: "SessionStart", sid: subSid, parentSid: sid, isSubagent: true, at: now + 120, cwd: "/tmp/trae-app" },
    { event: "UserPromptSubmit", sid: subSid, parentSid: sid, isSubagent: true, at: now + 130, prompt: "Subtask" },
    { event: "Stop", sid: subSid, parentSid: sid, isSubagent: true, at: now + 190, text: "Sub done" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  const usage = new AgentUsage({ cfg: { dayCutoff: 4 }, settings: { agents: { trae: true } } });
  await usage.scan({ since: 0 });

  let meta = usage.meta.get(sid);
  assert.ok(meta);
  assert.equal(meta.agent, "trae");
  assert.equal(meta.state, "run");
  assert.equal(meta.title, "Trae Main");
  assert.equal(meta.cwd, "/tmp/trae-app");
  assert.equal(meta.model, "Claude-Sonnet");
  assert.equal(meta.out, 0, "missing tokens must stay 0");
  assert.equal(usage.isSubagentSession(subSid), true);
  assert.equal(usage.isSubagentSession(sid), false);

  // Append Stop with real tokens + PreCompact later (must not bump lastAt).
  const stopAt = now + 400;
  fs.appendFileSync(evFile, [
    { event: "Stop", sid, at: stopAt, text: "Tracking added.", status: "completed", inTok: 120, outTok: 45, cacheRead: 30, cacheWrite: 15 },
    { event: "PreCompact", sid, at: stopAt + 5000, trigger: "auto" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  await usage.scan({ since: 0 });
  meta = usage.meta.get(sid);
  assert.equal(meta.state, "wait");
  assert.equal(meta.out, 45);
  assert.equal(meta.fresh, 135);
  assert.equal(meta.cached, 30);
  assert.equal(meta.lastAt, stopAt, "PreCompact must not advance lastAt past Stop");

  // Save/load cache preserves totals without double counting.
  const cachePath = path.join(tmpRoot, "trae-usage-cache.json.gz");
  await usage.saveCache(cachePath);
  const usage2 = new AgentUsage({ cfg: { dayCutoff: 4 }, settings: { agents: { trae: true } } });
  assert.equal(await usage2.loadCache(cachePath), true);
  await usage2.scan({ since: 0 });
  const meta2 = usage2.meta.get(sid);
  assert.equal(meta2.out, 45);
  assert.equal(meta2.fresh, 135);
  assert.equal(meta2.turns, 1);

  // Conversation builder + readConversation + security audit tool extraction
  const msgs = conversationMessages("trae", fs.readFileSync(evFile, "utf8"));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].tools.length, 2);
  assert.equal(msgs[1].tools[0].status, "success");
  assert.equal(msgs[1].tools[1].missingResult, true);

  const md = conversationMarkdown({ agent: "trae", sid, title: "Trae Main" }, msgs);
  assert.ok(md.includes("### 工具时间线"));

  const readMsgs = await readConversation({ jobs: {}, usage }, { agent: "trae", sid });
  assert.equal(readMsgs.length, 2);

  const auditCalls = extractToolCallsFromJsonl("trae", fs.readFileSync(evFile, "utf8"));
  assert.equal(auditCalls.length, 2);
  assert.equal(auditCalls[0].title, "RunCommand");
  assert.equal(auditCalls[0].rawInput.command, "npm test");
  assert.ok(auditCalls[0].at > 0);
});

test("isTraeRunning detects Trae CN / Trae across platforms without false positives on helpers", async () => {
  const fakeExec = (out, err = null) => (_cmd, _args, _opts, cb) => cb(err, out);
  assert.equal(
    await TS.isTraeRunning({
      platform: "darwin",
      exec: fakeExec("/Applications/Trae CN.app/Contents/Frameworks/Trae CN Helper (Renderer).app/Contents/MacOS/Trae CN Helper (Renderer)\n"),
    }),
    false,
  );
  assert.equal(
    await TS.isTraeRunning({
      platform: "darwin",
      exec: fakeExec("/Applications/Trae CN.app/Contents/MacOS/Electron\n"),
    }),
    true,
  );
  assert.equal(
    await TS.isTraeRunning({
      platform: "darwin",
      exec: fakeExec("/Applications/Trae.app/Contents/MacOS/Electron\n"),
    }),
    true,
  );
  assert.equal(await TS.isTraeRunning({ platform: "win32", exec: fakeExec('"Trae CN.exe","1234","Console","1","120,000 K"\r\n') }), true);
  assert.equal(await TS.isTraeRunning({ platform: "linux", exec: fakeExec("/usr/bin/trae-cn\n") }), true);
});

test("harness detection detects Trae via app/data without counting plugin trae-events dir", () => {
  const fakeHome = path.join(tmpRoot, "detect-home");
  fs.mkdirSync(path.join(fakeHome, ".agent-deck", "trae-events"), { recursive: true });
  const before = detectInstalledHarnesses({ homeDir: fakeHome, platform: "darwin", appDirs: [path.join(fakeHome, "Apps")], pathEntries: [] });
  assert.equal(before.detected.trae, false, "plugin trae-events dir alone must not mark Trae installed");

  fs.mkdirSync(path.join(fakeHome, "Apps", "Trae CN.app"), { recursive: true });
  const after = detectInstalledHarnesses({ homeDir: fakeHome, platform: "darwin", appDirs: [path.join(fakeHome, "Apps")], pathEntries: [] });
  assert.equal(after.detected.trae, true);
  assert.deepEqual(after.details.trae.via, ["app"]);
});

test("Trae delegation supports `traecli acp serve` when CLI exists and desktop handoff fallback when CLI is absent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-trae-acp-"));
  const argsFile = path.join(dir, "args.json");
  const mockCli = writeMockNodeBin(dir, "traecli", `
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
        send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "trae-acp-1", configOptions: [] } });
      } else if (msg.method === "session/prompt") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "trae-acp-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done via Trae ACP" } } } });
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
        process.exit(0);
      }
    });
  `);

  try {
    assert.equal(resolveInstalledAgentBinary("trae", mockCli), mockCli);
    const makeDelegatorPlugin = (vaultDir, noteFile, initialText, delegateTrae = {}) => {
      let noteText = initialText;
      const plugin = {
        settings: deepMerge(DEFAULTS, { delegate: { trae: { path: "", ...delegateTrae } }, dispatchSnapshot: false }),
        jobs: {},
        app: {
          vault: {
            adapter: { basePath: vaultDir },
            getAbstractFileByPath: (p) => (p === noteFile.path ? noteFile : null),
            read: async () => noteText,
            process: async (_f, fn) => { noteText = fn(noteText); },
            createFolder: async () => {},
            create: async () => ({}),
            modify: async () => {},
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
      return new Delegator(plugin);
    };

    const fileAcp = { path: "2026_11_25_acp.md", basename: "2026_11_25_acp" };
    const dAcp = makeDelegatorPlugin(dir, fileAcp, "- TODO Test Trae delegation\n", { path: mockCli });
    const job = await dAcp.delegate({ agent: "trae", file: fileAcp, line: 0, lineText: "- TODO Test Trae delegation" });
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
    assert.equal(job.sessionId, "trae-acp-1");
    assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, "utf8")), ["acp", "serve"]);
    assert.equal(canContinueSession({ agent: "trae", sid: "trae-acp-1", transport: "acp" }), true);
    assert.equal(canContinueSession({ agent: "trae", sid: "trae-desk-1", transport: "" }), false);

    // Journal link round-trip
    const link = J.linkLine("  ", "trae", "Trae Task", "trae-desk-1").trimEnd();
    assert.deepEqual(J.parseLink(link), { agent: "trae", sid: "trae-desk-1", title: "Trae Task" });
    assert.ok(J.isDeckBlockId(J.makeBlockId("trae-desk-1", "trae")));

    // Explicit desktop destination handoff
    const fileDesk = { path: "2026_11_25_desk.md", basename: "2026_11_25_desk" };
    const dDesk = makeDelegatorPlugin(dir, fileDesk, "- TODO Desktop handoff\n", { path: mockCli });
    let copied = "";
    let opened = "";
    dDesk.copyText = (txt) => { copied = txt; return true; };
    dDesk.openAgentApp = async (agent) => { opened = agent; return true; };
    const hJob = await dDesk.delegate({ agent: "trae", destination: "desktop", file: fileDesk, line: 0, lineText: "- TODO Desktop handoff" });
    assert.equal(hJob.handoff, true);
    assert.equal(hJob.agent, "trae");
    assert.equal(opened, "trae");
    assert.match(copied, /Desktop handoff/);

    // Automatic fallback when traecli is absent
    const missingBin = path.join(dir, "nonexistent-traecli");
    assert.equal(resolveInstalledAgentBinary("trae", missingBin), "");
    const fileFallback = { path: "2026_11_25_fb.md", basename: "2026_11_25_fb" };
    const dFallback = makeDelegatorPlugin(dir, fileFallback, "- TODO Auto handoff fallback\n", { path: missingBin });
    let fbCopied = "";
    let fbOpened = "";
    dFallback.copyText = (txt) => { fbCopied = txt; return true; };
    dFallback.openAgentApp = async (agent) => { fbOpened = agent; return true; };
    const fbJob = await dFallback.delegate({ agent: "trae", file: fileFallback, line: 0, lineText: "- TODO Auto handoff fallback" });
    assert.equal(fbJob.handoff, true);
    assert.equal(fbJob.agent, "trae");
    assert.equal(fbOpened, "trae");
    assert.match(fbCopied, /Auto handoff fallback/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maybePromptTraeHooks prompts once when Trae is running and installs hooks on click", async () => {
  const mainSrc = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSrc.indexOf("  async maybePromptTraeHooks()");
  const end = mainSrc.indexOf("  cursorHooksStatus()", start);
  const methodSrc = mainSrc.slice(start, end).trim();

  function makeEl(tag, opts = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      cls: opts.cls || "",
      text: opts.text || "",
      children: [],
      createDiv(o) { const d = makeEl("div", o); el.children.push(d); return d; },
      createEl(t, o) { const c = makeEl(t, o); el.children.push(c); return c; },
    };
    return el;
  }

  const notices = [];
  class FakeNotice {
    constructor(content, duration) { this.content = content; this.duration = duration; this.hidden = false; notices.push(this); }
    hide() { this.hidden = true; }
  }

  let running = true;
  let installedCalls = 0;
  const plugin = vm.runInNewContext(`({ ${methodSrc} })`, {
    Notice: FakeNotice,
    t: (s) => s,
    document: { createDocumentFragment: () => makeEl("fragment") },
  });
  Object.assign(plugin, {
    _unloaded: false,
    settings: { ...DEFAULTS, traeHooksPrompted: false },
    agentEnabled: (id) => id === "trae",
    traeHooksStatus: () => ({ installed: installedCalls > 0, outdated: false }),
    isTraeRunning: async () => running,
    saveSettings: async () => {},
    installTraeHooks: () => { installedCalls++; },
    notice: () => {},
  });

  assert.equal(await plugin.maybePromptTraeHooks(), true);
  assert.equal(notices.length, 1);
  assert.ok(notices[0].content.children[0].text.includes("追踪 Trae 对话"));
  notices[0].content.children[1].children[0].onclick();
  assert.equal(installedCalls, 1);
  assert.equal(notices[0].hidden, true);
});

test.after(() => {
  process.env.HOME = origHome;
  if (process.platform === "win32") {
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
    if (origAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = origAppData;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
