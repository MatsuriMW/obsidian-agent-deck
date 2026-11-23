import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class App{};export class Notice{constructor(m){globalThis.__notices?.push(m)}};export class MarkdownView{};export class MarkdownRenderChild{};export class Plugin{};export class ItemView{};export class PluginSettingTab{};export class Modal{};export class Component{};export class Setting{};export class Menu{};export class FuzzySuggestModal{};export class SuggestModal{};export class EditorSuggest{};export class AbstractInputSuggest{};export class TFile{};export class TFolder{};export function setIcon(){};export function normalizePath(p){return String(p||'');};export const MarkdownRenderer={render:async()=>{}};export const debounce=(fn)=>fn;export const requestUrl=async()=>({json:{}});export const editorLivePreviewField={};export const editorInfoField={};", shortCircuit: true };
  if (spec === "@codemirror/view") return { url: "data:text/javascript,export const Decoration={mark:()=>({}),widget:()=>({}),replace:()=>({}),line:()=>({}),none:{},set:()=>({})};export class WidgetType{};export const ViewPlugin={fromClass:()=>({})};export const EditorView={decorations:{from:()=>({})},domEventHandlers:()=>({})};", shortCircuit: true };
  if (spec === "@codemirror/state") return { url: "data:text/javascript,export const EditorState={create:()=>({})};export const StateEffect={define:()=>({of:()=>{}})};export const StateField={define:()=>({})};export const Prec={high:x=>x,low:x=>x,highest:x=>x,lowest:x=>x};export const RangeSetBuilder=class{add(){};finish(){return{}}};", shortCircuit: true };
  if (spec === "@codemirror/language") return { url: "data:text/javascript,export const foldedRanges=()=>({iter:()=>{}});export const foldEffect={of:()=>({})};export const unfoldEffect={of:()=>({})};export const syntaxTree=()=>({iterate:()=>{}});", shortCircuit: true };
  if (spec.endsWith(".png") || spec.endsWith(".swift") || spec.endsWith(".svg")) return { url: "data:text/javascript,export default '';", shortCircuit: true };
  return next(spec, ctx);
}`));

import { AGENTS, AGENT_ORDER, DEFAULTS } from "../src/constants.js";
import { getAgentCapability } from "../src/agent-registry.js";
import { desktopSessions, desktopMessages, t3CodeDelegatedSids } from "../src/desktop-sessions.js";
import {
  museTime,
  discoverMuseConversations,
  parseMuseConversation,
  buildMuseConversation,
} from "../src/muse-sessions.js";
import { AgentUsage, USAGE_CACHE_VERSION } from "../src/readers.js";
import { readConversation } from "../src/conversation.js";
import { detectInstalledHarnesses } from "../src/harness-detect.js";
import { T3CodeRunner } from "../src/delegation-runners.js";
import { resolveSqliteBinary } from "../src/sqlite.js";
import { writeMockNodeBin } from "./helpers/mock-cli.mjs";
import * as J from "../src/journal.js";

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-t3-muse-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createT3V2Db(dbPath) {
  const sql = `
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      scripts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE orchestration_v2_projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      default_provider TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      active_provider_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT,
      payload_json TEXT NOT NULL,
      provider_instance_id TEXT
    );
    CREATE TABLE orchestration_v2_projection_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      node_id TEXT,
      role TEXT NOT NULL,
      streaming INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      search_text TEXT
    );
    CREATE TABLE orchestration_v2_projection_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      provider_thread_id TEXT,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE orchestration_v2_projection_run_attempts (
      attempt_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt_ordinal INTEGER NOT NULL,
      root_node_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      provider_turn_id TEXT,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      provider_instance_id TEXT
    );
    CREATE TABLE orchestration_v2_projection_provider_turns (
      provider_turn_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      run_attempt_id TEXT,
      ordinal INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      payload_json TEXT NOT NULL
    );

    INSERT INTO projection_projects (project_id, title, workspace_root, created_at, updated_at)
    VALUES ('proj-1', 'agent-deck', '/tmp/work/agent-deck', '2026-11-22T08:00:00.000Z', '2026-11-22T08:00:00.000Z');

    -- Active thread with custom title and 2 assistant chunks in one run
    INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, created_at, updated_at, payload_json, provider_instance_id)
    VALUES (
      'thread:proj-1:main',
      'proj-1',
      'Add T3 Code tracking',
      'codex',
      '2026-11-22T08:00:00.000Z',
      '2026-11-22T08:05:00.000Z',
      '{"id":"thread:proj-1:main","modelSelection":{"instanceId":"codex","model":"gpt-5-codex"},"worktreePath":"/tmp/work/agent-deck-wt","lineage":{"parentThreadId":null,"relationshipToParent":null}}',
      'codex'
    );

    -- Subagent thread (archived) with default "New thread" title
    INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, created_at, updated_at, archived_at, payload_json, provider_instance_id)
    VALUES (
      'thread:proj-1:sub',
      'proj-1',
      'New thread',
      'codex',
      '2026-11-22T08:02:00.000Z',
      '2026-11-22T08:03:00.000Z',
      '2026-11-22T08:04:00.000Z',
      '{"id":"thread:proj-1:sub","modelSelection":{"instanceId":"codex","model":"gpt-5-codex"},"lineage":{"parentThreadId":"thread:proj-1:main","relationshipToParent":"subagent"}}',
      'codex'
    );

    -- Deleted thread (must be skipped by UsageReader)
    INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, created_at, updated_at, deleted_at, payload_json, provider_instance_id)
    VALUES (
      'thread:proj-1:del',
      'proj-1',
      'Deleted thread',
      'codex',
      '2026-11-22T08:00:00.000Z',
      '2026-11-22T08:01:00.000Z',
      '2026-11-22T08:02:00.000Z',
      '{"id":"thread:proj-1:del"}',
      'codex'
    );

    INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, provider_instance_id, status, requested_at, completed_at, payload_json)
    VALUES (
      'run-1',
      'thread:proj-1:main',
      1,
      'codex',
      'codex',
      'completed',
      '2026-11-22T08:00:05.000Z',
      '2026-11-22T08:01:00.000Z',
      '{"id":"run-1","modelSelection":{"model":"gpt-5-codex"}}'
    );

    INSERT INTO orchestration_v2_projection_run_attempts (attempt_id, thread_id, run_id, attempt_ordinal, root_node_id, provider, provider_thread_id, status, payload_json)
    VALUES ('att-1', 'thread:proj-1:main', 'run-1', 1, 'node-1', 'codex', 'pt-1', 'completed', '{}');

    INSERT INTO orchestration_v2_projection_provider_turns (provider_turn_id, thread_id, provider_thread_id, node_id, run_attempt_id, ordinal, status, started_at, completed_at, payload_json)
    VALUES (
      'turn-1',
      'thread:proj-1:main',
      'pt-1',
      'node-1',
      'att-1',
      1,
      'completed',
      '2026-11-22T08:00:05.000Z',
      '2026-11-22T08:01:00.000Z',
      '{"model":"gpt-5.4","turnTokenUsage":{"usedTokens":2000,"inputTokens":1500,"cachedInputTokens":500,"outputTokens":400,"updatedAt":"2026-11-22T08:01:00.000Z"}}'
    );

    INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json, search_text)
    VALUES
      ('m-1', 'thread:proj-1:main', 'run-1', 'user', 0, '2026-11-22T08:00:05.000Z', '2026-11-22T08:00:05.000Z', '{"text":"Implement T3 Code reader","createdBy":"user"}', 'Implement T3 Code reader'),
      ('m-2', 'thread:proj-1:main', 'run-1', 'assistant', 0, '2026-11-22T08:00:30.000Z', '2026-11-22T08:00:30.000Z', '{"text":"Reading schema..."}', 'Reading schema...'),
      ('m-3', 'thread:proj-1:main', 'run-1', 'assistant', 0, '2026-11-22T08:01:00.000Z', '2026-11-22T08:01:00.000Z', '{"text":"Done implementing T3 Code reader."}', 'Done implementing T3 Code reader'),
      ('m-sub-1', 'thread:proj-1:sub', NULL, 'user', 0, '2026-11-22T08:02:00.000Z', '2026-11-22T08:02:00.000Z', '{"text":"Check subagent task","createdBy":"user"}', 'Check subagent task'),
      ('m-sub-2', 'thread:proj-1:sub', NULL, 'assistant', 0, '2026-11-22T08:02:40.000Z', '2026-11-22T08:02:40.000Z', '{"text":"Subagent finished."}', 'Subagent finished.');
  `;
  execFileSync(resolveSqliteBinary(), [dbPath, sql], { stdio: "pipe" });
}

function createT3V1Db(dbPath) {
  const sql = `
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      worktree_path TEXT,
      model_selection_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projection_projects VALUES ('p1', 'demo', '/tmp/demo', '2026-11-22T09:00:00.000Z', '2026-11-22T09:00:00.000Z');
    INSERT INTO projection_threads VALUES ('t1', 'p1', 'Legacy thread', NULL, '{"model":"claude-sonnet"}', '2026-11-22T09:00:00.000Z', '2026-11-22T09:01:00.000Z', NULL, NULL);
    INSERT INTO projection_thread_sessions VALUES ('t1', 'running', '2026-11-22T09:01:00.000Z');
    INSERT INTO projection_thread_messages VALUES ('tm1', 't1', 'user', 'Hello V1', 0, '2026-11-22T09:00:10.000Z', '2026-11-22T09:00:10.000Z');
    INSERT INTO projection_thread_messages VALUES ('tm2', 't1', 'assistant', 'Working on it', 1, '2026-11-22T09:00:20.000Z', '2026-11-22T09:00:20.000Z');
  `;
  execFileSync(resolveSqliteBinary(), [dbPath, sql], { stdio: "pipe" });
}

test("t3code and muse are registered with valid metadata, capabilities, and links", () => {
  assert.ok(AGENT_ORDER.includes("t3code"));
  assert.ok(AGENT_ORDER.includes("muse"));
  assert.equal(AGENTS.t3code.trackingOnly, undefined);
  assert.equal(AGENTS.muse.trackingOnly, true);
  assert.equal(DEFAULTS.agents.t3code, true);
  assert.equal(DEFAULTS.agents.muse, true);
  assert.equal(USAGE_CACHE_VERSION >= 17, true);

  const t3Cap = getAgentCapability("t3code");
  assert.equal(t3Cap.delegate, true);
  assert.equal(t3Cap.runnerKind, "t3code");
  assert.equal(t3Cap.continueInApp, true);
  assert.equal(t3Cap.archiveDetection, true);
  assert.equal(t3Cap.sessionLinkScheme, "obsidian");

  const museCap = getAgentCapability("muse");
  assert.equal(museCap.delegate, false);
  assert.equal(museCap.sessionLinkScheme, "muse");

  assert.equal(J.isDeckBlockId("t3code-abcde12345"), true);
  assert.equal(J.isDeckBlockId("muse-abcde12345"), true);
  assert.deepEqual(
    J.parseLink("- 🔗 [T3 Code](obsidian://agent-deck?do=open&agent=t3code&sid=thread%3A1)"),
    { agent: "t3code", sid: "thread:1", title: "T3 Code" },
  );
  assert.deepEqual(
    J.parseLink("- 🔗 [Muse](obsidian://agent-deck?do=open&agent=muse&sid=hatch-main)"),
    { agent: "muse", sid: "hatch-main", title: "Muse" },
  );
});

test("T3 Code V2 SQLite reader parses threads, worktree cwd, subagent lineage, per-run tokens, and conversation", async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "statev2.sqlite");
    createT3V2Db(dbPath);

    const sessions = await desktopSessions(dbPath, "t3code", 0);
    assert.equal(sessions.length, 3);

    const main = sessions.find((s) => s.sid === "thread:proj-1:main");
    assert.ok(main);
    assert.equal(main.title, "Add T3 Code tracking");
    assert.equal(main.cwd, "/tmp/work/agent-deck-wt");
    assert.equal(main.model, "gpt-5.4");
    assert.equal(main.out, 400);
    assert.equal(main.fresh, 1000);
    assert.equal(main.cached, 500);
    assert.equal(main.archived, false);

    const sub = sessions.find((s) => s.sid === "thread:proj-1:sub");
    assert.ok(sub);
    assert.equal(sub.title, ""); // default "New thread" cleared so first prompt is used
    assert.equal(sub.parentSid, "thread:proj-1:main");
    assert.equal(sub.cwd, "/tmp/work/agent-deck");
    assert.equal(sub.archived, true);

    const del = sessions.find((s) => s.sid === "thread:proj-1:del");
    assert.ok(del.deletedAt > 0);

    const msgs = await desktopMessages(dbPath, "t3code", "thread:proj-1:main");
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[0].text, "Implement T3 Code reader");
    // Usage is attached only to the last assistant message of the run (no double counting)
    assert.equal(msgs[1].out, 0);
    assert.equal(msgs[2].out, 400);
    assert.equal(msgs[2].fresh, 1000);
    assert.equal(msgs[2].cached, 500);
    assert.equal(msgs[2].model, "gpt-5.4");

    const prevEnv = process.env.T3_DATA_DIR;
    process.env.T3_DATA_DIR = dir;
    try {
      const reader = new AgentUsage({
        settings: {
          agents: { t3code: true },
          primaryAgents: ["t3code"],
        },
      });
      await reader.scan({ agent: "t3code" });

      const meta = reader.meta.get("thread:proj-1:main");
      assert.ok(meta);
      assert.equal(meta.agent, "t3code");
      assert.equal(meta.title, "Add T3 Code tracking");
      assert.equal(meta.out, 400);
      assert.equal(meta.fresh, 1000);
      assert.equal(meta.cached, 500);
      assert.equal(meta.model, "gpt-5.4");
      assert.equal(reader.meta.has("thread:proj-1:del"), false);

      const subMeta = reader.meta.get("thread:proj-1:sub");
      assert.ok(subMeta);
      assert.equal(subMeta.title, "Check subagent task");
      assert.equal(subMeta.parentSid, "thread:proj-1:main");
      assert.equal(subMeta.archived, true);

      const conv = await readConversation({ usage: reader, jobs: {} }, { agent: "t3code", sid: "thread:proj-1:main" });
      assert.equal(conv.length, 3);
      assert.equal(conv[2].text, "Done implementing T3 Code reader.");
    } finally {
      if (prevEnv === undefined) delete process.env.T3_DATA_DIR;
      else process.env.T3_DATA_DIR = prevEnv;
    }
  });
});

test("T3 Code legacy V1 SQLite fallback parses threads and streaming messages", async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "state.sqlite");
    createT3V1Db(dbPath);

    const sessions = await desktopSessions(dbPath, "t3code", 0);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sid, "t1");
    assert.equal(sessions[0].title, "Legacy thread");
    assert.equal(sessions[0].cwd, "/tmp/demo");
    assert.equal(sessions[0].model, "claude-sonnet");
    assert.equal(sessions[0].state, "run");

    const msgs = await desktopMessages(dbPath, "t3code", "t1");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].state, "run");
  });
});

test("Muse reader converts Apple CFAbsoluteTime, parses contentBlocks/widgets, keeps 0 tokens, and integrates with UsageReader", async () => {
  const appleTs = 814098773.1; // 2026-10-19T10:32:53.100Z
  assert.equal(new Date(museTime(appleTs)).toISOString(), "2026-10-19T10:32:53.100Z");
  assert.equal(museTime(1792405973), 1792405973000);
  assert.equal(museTime(1792405973100), 1792405973100);

  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, ".cache_version"), "1");
    fs.writeFileSync(path.join(dir, ".user_id"), "12345");
    const sample = [
      {
        id: "assistant-1",
        sortSeq: 7,
        isUser: false,
        isStreaming: false,
        timestamp: 814098773.426,
        content: "你想叫我什么呢？[[hatch_widget:widget-1]]",
        contentBlocks: [
          { markdown: { text: "你想叫我什么呢？" } },
          { optionWidget: { _0: { selectedText: "Muse", options: ["Bodhi", "Astro", "Muse"] } } },
        ],
        activeToolCalls: [],
      },
      {
        id: "user-1",
        sortSeq: 10,
        isUser: true,
        isStreaming: false,
        timestamp: 814098888.324,
        content: "帮我制定一个力量训练计划",
        contentBlocks: [],
        activeToolCalls: [],
      },
      {
        id: "assistant-2",
        sortSeq: 12,
        isUser: false,
        isStreaming: false,
        timestamp: 814098903.163,
        content: "好的，每周 3 次全身训练。[[hatch_widget:widget-2]]",
        contentBlocks: [
          { markdown: { text: "好的，每周 3 次全身训练。" } },
          { optionWidget: { _0: { options: ["就按这个来", "再调一下"] } } },
        ],
        activeToolCalls: [],
      },
    ];
    fs.writeFileSync(path.join(dir, "hatch-main.json"), JSON.stringify(sample));

    const discovered = discoverMuseConversations({ cacheDir: dir });
    assert.equal(discovered.conversations.length, 1);
    assert.equal(discovered.conversations[0].id, "hatch-main");
    assert.equal(discovered.conversations[0].title, "Muse");

    const parsed = parseMuseConversation(JSON.stringify(sample), discovered.conversations[0]);
    assert.equal(parsed.entries.length, 3);
    assert.equal(parsed.state, "wait");
    assert.match(parsed.entries[0].text, /\[已选: Muse\]/);
    assert.equal(parsed.entries[0].summaryText, "你想叫我什么呢？");
    assert.match(parsed.entries[2].text, /\[选项: 就按这个来 \/ 再调一下\]/);

    const convDirect = buildMuseConversation(JSON.stringify(sample));
    assert.equal(convDirect.length, 3);
    assert.equal(convDirect[1].role, "user");

    const reader = new AgentUsage({
      settings: {
        agents: { muse: true },
        primaryAgents: ["muse"],
        museCacheDir: dir,
      },
    });
    await reader.scan({ agent: "muse" });

    const meta = reader.meta.get("hatch-main");
    assert.ok(meta);
    assert.equal(meta.agent, "muse");
    assert.equal(meta.title, "Muse");
    assert.equal(meta.out, 0);
    assert.equal(meta.fresh, 0);
    assert.equal(meta.cached, 0);
    assert.equal(meta.model, "");
    assert.equal(meta.state, "wait");

    const conv = await readConversation({ usage: reader, jobs: {} }, { agent: "muse", sid: "hatch-main" });
    assert.equal(conv.length, 3);
    assert.equal(conv[1].text, "帮我制定一个力量训练计划");

    // Multi-thread filtering & max cap: default tracks hatch-main only; selecting multiple enforces museMaxTracked
    fs.writeFileSync(path.join(dir, "thread-a.json"), JSON.stringify([
      { id: "ua", sortSeq: 1, isUser: true, timestamp: 814098950, content: "调研 A 方案" },
      { id: "aa", sortSeq: 2, isUser: false, timestamp: 814098960, content: "A 方案结论" },
    ]));
    fs.writeFileSync(path.join(dir, "thread-b.json"), JSON.stringify([
      { id: "ub", sortSeq: 1, isUser: true, timestamp: 814098970, content: "调研 B 方案" },
      { id: "ab", sortSeq: 2, isUser: false, timestamp: 814098980, content: "B 方案结论" },
    ]));

    const multi = discoverMuseConversations({ cacheDir: dir });
    assert.equal(multi.conversations.length, 3);
    assert.equal(multi.conversations[0].id, "hatch-main");
    assert.equal(multi.conversations[0].isMain, true);

    // Default (museTrackedIds unset) tracks hatch-main only
    const defaultReader = new AgentUsage({
      settings: { agents: { muse: true }, primaryAgents: ["muse"], museCacheDir: dir },
    });
    await defaultReader.scan({ agent: "muse" });
    assert.equal(defaultReader.meta.has("hatch-main"), true);
    assert.equal(defaultReader.meta.has("thread-a"), false);

    // Explicit selection respects museMaxTracked cap (e.g. max=2 drops 3rd)
    const cappedReader = new AgentUsage({
      settings: {
        agents: { muse: true },
        primaryAgents: ["muse"],
        museCacheDir: dir,
        museTrackedIds: ["hatch-main", "thread-a", "thread-b"],
        museMaxTracked: 2,
      },
    });
    await cappedReader.scan({ agent: "muse" });
    assert.equal(cappedReader.meta.has("hatch-main"), true);
    assert.equal(cappedReader.meta.has("thread-a"), true);
    assert.equal(cappedReader.meta.has("thread-b"), false);
  });
});

test("Muse ignores proactive-only and non-user-triggered messages by default, and tracks them when museTrackProactive is enabled", async () => {
  await withTempDir(async (dir) => {
    // 1. Pure proactive stream (e.g. scheduled briefings with no user messages)
    const proactiveOnly = [
      {
        id: "assistant-p1",
        sortSeq: 100,
        isUser: false,
        isStreaming: false,
        timestamp: 817084184.97,
        replyToMessageId: "cron-turn-1",
        executionTurnId: "cron-turn-1",
        content: "早间简报",
        contentBlocks: [{ markdown: { text: "早间简报" } }],
      },
      {
        id: "assistant-p2",
        sortSeq: 110,
        isUser: false,
        isStreaming: false,
        timestamp: 817085027.668,
        replyToMessageId: "cron-turn-2",
        executionTurnId: "cron-turn-2",
        content: "开盘前更新",
        contentBlocks: [{ markdown: { text: "开盘前更新" } }],
      },
    ];
    fs.writeFileSync(path.join(dir, "hatch-main.json"), JSON.stringify(proactiveOnly));

    const parsedProactive = parseMuseConversation(JSON.stringify(proactiveOnly), { id: "hatch-main", title: "Muse" });
    assert.equal(parsedProactive.entries.every((e) => e.isProactive), true);

    const reader = new AgentUsage({
      settings: {
        agents: { muse: true },
        primaryAgents: ["muse"],
        museCacheDir: dir,
      },
    });
    await reader.scan({ agent: "muse" });
    assert.equal(reader.meta.has("hatch-main"), false);

    // Enabling museTrackProactive invalidates cache and tracks proactive messages
    reader.settings.museTrackProactive = true;
    await reader.scan({ agent: "muse" });
    assert.equal(reader.meta.has("hatch-main"), true);
    assert.equal(reader.meta.get("hatch-main").lastText, "开盘前更新");

    // Disabling museTrackProactive prunes proactive-only session cleanly
    reader.settings.museTrackProactive = false;
    await reader.scan({ agent: "muse" });
    assert.equal(reader.meta.has("hatch-main"), false);

    // 2. Mixed conversation: proactive briefing + user turn + later proactive briefing
    const mixed = [
      {
        id: "assistant-before",
        sortSeq: 10,
        isUser: false,
        timestamp: 817000000,
        replyToMessageId: "cron-before",
        content: "前置推送",
      },
      {
        id: "user-1",
        sortSeq: 20,
        isUser: true,
        timestamp: 817080000,
        content: "帮我查一下今天财报",
      },
      {
        id: "assistant-reply",
        sortSeq: 21,
        isUser: false,
        timestamp: 817080030,
        replyToMessageId: "user-1",
        content: "这是今天的财报整理。",
      },
      {
        id: "assistant-reply-2",
        sortSeq: 22,
        isUser: false,
        timestamp: 817080035,
        replyToMessageId: "assistant-reply",
        content: "补充：科技板块领涨。",
      },
      {
        id: "assistant-after-cron",
        sortSeq: 30,
        isUser: false,
        timestamp: 817090000,
        replyToMessageId: "cron-after",
        executionTurnId: "cron-after",
        content: "晚间自动简报",
      },
    ];
    fs.writeFileSync(path.join(dir, "hatch-main.json"), JSON.stringify(mixed));

    const parsedMixed = parseMuseConversation(JSON.stringify(mixed), { id: "hatch-main", title: "Muse" });
    assert.deepEqual(
      parsedMixed.entries.map((e) => [e.id, e.isProactive]),
      [
        ["assistant-before", true],
        ["user-1", false],
        ["assistant-reply", false],
        ["assistant-reply-2", false],
        ["assistant-after-cron", true],
      ],
    );

    await reader.scan({ agent: "muse" });
    const metaDefault = reader.meta.get("hatch-main");
    assert.ok(metaDefault);
    assert.equal(metaDefault.lastText, "补充：科技板块领涨。");
    assert.equal(metaDefault.lastAt, museTime(817080035));

    reader.settings.museTrackProactive = true;
    await reader.scan({ agent: "muse" });
    const metaProactive = reader.meta.get("hatch-main");
    assert.ok(metaProactive);
    assert.equal(metaProactive.lastText, "晚间自动简报");
    assert.equal(metaProactive.lastAt, museTime(817090000));
  });
});

test("detectInstalledHarnesses detects T3 Code and Muse by app bundle or local data", async () => {
  await withTempDir((dir) => {
    const homeDir = path.join(dir, "home");
    const appDir = path.join(dir, "apps");
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(path.join(homeDir, ".t3", "userdata"), { recursive: true });
    fs.writeFileSync(path.join(homeDir, ".t3", "userdata", "statev2.sqlite"), "");
    fs.mkdirSync(path.join(appDir, "Muse.app"), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    const res = detectInstalledHarnesses({
      homeDir,
      appDirs: [appDir],
      pathEntries: [binDir],
      env: { PATH: binDir },
      platform: "darwin",
    });
    assert.equal(res.detected.t3code, true);
    assert.equal(res.detected.muse, true);
  });
});

test("T3CodeRunner delegates via t3 thread start (with auto project add), supports follow-up thread send, and handles waiting exit code 2", async () => {
  await withTempDir(async (dir) => {
    const stateFile = path.join(dir, "mock-state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ added: false, calls: [] }));
    const mockT3 = writeMockNodeBin(
      dir,
      "mock-t3",
      `
      const fs = require("fs");
      const stateFile = ${JSON.stringify(stateFile)};
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const args = process.argv.slice(2);
      const stdin = args.includes("-") ? fs.readFileSync(0, "utf8") : "";
      state.calls.push({ args, stdin });
      if (args[0] === "project" && args[1] === "add") {
        state.added = true;
        fs.writeFileSync(stateFile, JSON.stringify(state));
        process.stdout.write("Added project\\n");
        process.exit(0);
      }
      if (args[0] === "thread" && args[1] === "start") {
        if (!state.added) {
          fs.writeFileSync(stateFile, JSON.stringify(state));
          process.stderr.write("Error: No project found for path\\n");
          process.exit(1);
        }
        fs.writeFileSync(stateFile, JSON.stringify(state));
        process.stdout.write(JSON.stringify({
          threadId: "thread:proj-1:new-1",
          runId: "run-1",
          status: "completed",
          reply: "Started and finished: " + stdin.trim(),
          error: null,
        }));
        process.exit(0);
      }
      if (args[0] === "thread" && args[1] === "send") {
        fs.writeFileSync(stateFile, JSON.stringify(state));
        if (stdin.includes("WAIT_TEST")) {
          process.stdout.write(JSON.stringify({
            threadId: args[2],
            runId: "run-3",
            status: "waiting",
            reply: null,
            error: null,
          }));
          process.exit(2);
        }
        process.stdout.write(JSON.stringify({
          threadId: args[2],
          runId: "run-2",
          status: "completed",
          reply: "Continued: " + stdin.trim(),
          error: null,
        }));
        process.exit(0);
      }
      process.exit(1);
      `,
    );

    const makeDelegator = () => {
      const events = { sessions: [], done: [], failed: [] };
      const d = {
        vaultPath: dir,
        settings: { delegate: { t3code: { path: mockT3, cwd: dir, extraArgs: "" } } },
        saveJobsSoon() {},
        saveJobs() {},
        refreshUI() {},
        onSession(job, sid) { job.sessionId = sid; events.sessions.push(sid); },
        onDone(job) { job.state = "done"; events.done.push(job.result); },
        onError(job, err) { job.state = "error"; events.failed.push(err); },
      };
      return { d, events };
    };

    // 1. Start new thread (triggers auto `t3 project add` then retries)
    const { d: d1, events: e1 } = makeDelegator();
    const job1 = { id: "job-1", agent: "t3code" };
    const r1 = new T3CodeRunner(d1, job1);
    await r1.start({ prompt: "Build feature X", cwd: dir, name: "Feature X" });
    assert.deepEqual(e1.sessions, ["thread:proj-1:new-1"]);
    assert.deepEqual(e1.done, ["Started and finished: Build feature X"]);
    assert.deepEqual(e1.failed, []);

    // 2. Follow-up `t3 thread send`
    const { d: d2, events: e2 } = makeDelegator();
    const job2 = { id: "job-2", agent: "t3code" };
    const r2 = new T3CodeRunner(d2, job2);
    await r2.start({ prompt: "Add tests", cwd: dir, sessionId: "thread:proj-1:new-1" });
    assert.deepEqual(e2.done, ["Continued: Add tests"]);
    assert.deepEqual(e2.failed, []);

    // 3. Waiting for user input (exit code 2) does not fail
    const { d: d3, events: e3 } = makeDelegator();
    const job3 = { id: "job-3", agent: "t3code" };
    const r3 = new T3CodeRunner(d3, job3);
    await r3.start({ prompt: "WAIT_TEST", cwd: dir, sessionId: "thread:proj-1:new-1" });
    assert.equal(e3.done.length, 1);
    assert.deepEqual(e3.failed, []);
  });
});

test("T3 Code deduplicates delegated provider sessions in AutoLog so work is recorded once under t3code", async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "statev2.sqlite");
    createT3V2Db(dbPath);
    execFileSync(resolveSqliteBinary(), [dbPath, `
      CREATE TABLE orchestration_v2_projection_provider_threads (
        provider_thread_id TEXT PRIMARY KEY,
        thread_id TEXT,
        owner_node_id TEXT,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        status TEXT NOT NULL,
        first_run_ordinal INTEGER,
        last_run_ordinal INTEGER,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      INSERT INTO orchestration_v2_projection_provider_threads
      VALUES ('pt-codex-1', 'thread:proj-1:main', 'node-1', 'codex', 'ps-1', 'active', 1, 1, '2026-11-22T08:01:00.000Z',
        '{"nativeThreadRef":{"driver":"codex","nativeId":"codex-native-uuid-123"}}');
    `], { stdio: "pipe" });

    const delegated = await t3CodeDelegatedSids(dbPath);
    assert.equal(delegated.get("codex-native-uuid-123"), "thread:proj-1:main");
    assert.equal(delegated.get("pt-codex-1"), "thread:proj-1:main");

    const prevEnv = process.env.T3_DATA_DIR;
    process.env.T3_DATA_DIR = dir;
    try {
      const reader = new AgentUsage({
        settings: { agents: { t3code: true, codex: true }, primaryAgents: ["t3code", "codex"] },
      });
      await reader.scan({ agent: "t3code" });
      assert.equal(reader.t3OwnerOf("codex-native-uuid-123"), "thread:proj-1:main");
      assert.equal(reader.t3OwnerOf("unrelated-codex-sid"), "");

      // When t3code is disabled, t3OwnerOf returns empty so codex is not suppressed.
      reader.settings.agents.t3code = false;
      reader.settings.primaryAgents = ["codex"];
      assert.equal(reader.t3OwnerOf("codex-native-uuid-123"), "");

      // Re-enable t3code and verify AutoLog.processDay records only t3code, not the delegated codex session.
      reader.settings.agents.t3code = true;
      reader.settings.primaryAgents = ["t3code", "codex"];
      let noteText = "# 2026-11-22\n\n---\n\n---\n\n---\n";
      const plugin = {
        settings: {
          ...DEFAULTS,
          agents: { ...DEFAULTS.agents, t3code: true, codex: true },
          autoLogAgents: { ...DEFAULTS.autoLogAgents, t3code: true, codex: true },
          autoLogMinMinutes: 0,
          autoLogState: {},
        },
        usage: reader,
        jobs: {},
        agentEnabled: (id) => id === "t3code" || id === "codex",
        saveSettings: async () => {},
        notice: () => {},
        app: {
          vault: {
            getAbstractFileByPath: () => ({ path: "2026-11-22.md" }),
            read: async () => noteText,
            modify: async (_f, next) => { noteText = next; },
            process: async (_f, fn) => { noteText = fn(noteText); },
          },
          workspace: { getLeavesOfType: () => [], iterateAllLeaves: () => {} },
        },
      };
      const { AutoLog } = await import("../src/autolog.js");
      const autoLog = new AutoLog(plugin);
      autoLog.nowMin = () => 600;
      const askedSids = [];
      autoLog.ask = async (items) => {
        for (const item of items) askedSids.push(item.x.sid);
        return new Map(items.map(({ x }) => [x.sid, { title: x.title, summary: "Done" }]));
      };
      const list = [
        { sid: "thread:proj-1:main", agent: "t3code", title: "Add T3 Code tracking", min: 5, segs: [[590, 595]], out: 400 },
        { sid: "codex-native-uuid-123", agent: "codex", title: "Add T3 Code tracking", min: 5, segs: [[590, 595]], out: 400 },
      ];
      await autoLog.processDay("2026-11-22", { path: "2026-11-22.md" }, list, "2026-11-22", new Set(), { fallback: true, notify: false }, { added: [], updated: [], skipped: [] });
      assert.deepEqual(askedSids, ["thread:proj-1:main"]);
      assert.ok(plugin.settings.autoLogState["2026-11-22"]["thread:proj-1:main"], "T3 Code session is logged");
      assert.equal(plugin.settings.autoLogState["2026-11-22"]["codex-native-uuid-123"], undefined, "Delegated Codex session is NOT duplicated");
    } finally {
      if (prevEnv === undefined) delete process.env.T3_DATA_DIR;
      else process.env.T3_DATA_DIR = prevEnv;
    }
  });
});

test("Muse cache watcher rescans immediately on cache flush and stops after closeMuseWatcher", async () => {
  await withTempDir(async (dir) => {
    const { default: AgentDeckPlugin } = await import("../src/main.js");
    const p = Object.create(AgentDeckPlugin.prototype);
    p._unloaded = false;
    p._scanning = false;
    p.settings = { ...DEFAULTS, agents: { ...DEFAULTS.agents, muse: true }, museTrackedIds: ["hatch-main"], museCacheDir: dir };
    p.agentEnabled = (id) => p.settings.agents[id] !== false;
    const scans = [];
    p.scanNow = async (_full, opts) => { scans.push(opts); };

    p.watchMuseCache();
    assert.ok(p._museWatcher, "fs.watch attached to museCacheDir");
    fs.writeFileSync(path.join(dir, "hatch-main.json"), "[]");
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(scans.some((o) => o?.agent === "muse"), "cache update triggers muse rescan");

    const countBeforeClose = scans.length;
    p.closeMuseWatcher();
    assert.equal(p._museWatcher, null);
    fs.writeFileSync(path.join(dir, "hatch-main.json"), "[{}]");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(scans.length, countBeforeClose, "no rescan after closeMuseWatcher");

    // Enabling Muse notifies user about restart/history-refresh cache flush behavior
    globalThis.__notices = [];
    p.isPrimary = () => false;
    p.saveSettings = async () => {};
    p.refreshUI = () => {};
    p.app = { setting: {} };
    p.settingTab = { display() {} };
    p.settings.agents.muse = false;
    await p.setAgentEnabled("muse", true);
    assert.equal(globalThis.__notices.filter((m) => String(m).includes("Muse")).length, 1, "enabling Muse shows cache-flush hint notice");
    await p.setAgentEnabled("muse", true);
    assert.equal(globalThis.__notices.filter((m) => String(m).includes("Muse")).length, 1, "re-saving already-enabled Muse does not repeat notice");
    p.closeMuseWatcher();
    delete globalThis.__notices;
  });
});

test("allModels and modelsFor surface dynamic ACP availableModels for all ACP agents (cursor, gemini, hermes, minimax, custom)", async () => {
  const { default: AgentDeckPlugin } = await import("../src/main.js");
  const p = Object.create(AgentDeckPlugin.prototype);
  p.settings = {
    ...DEFAULTS,
    models: { ...DEFAULTS.models, custom: [], order: [] },
    delegate: {
      ...DEFAULTS.delegate,
      cursor: { ...DEFAULTS.delegate.cursor, availableModels: [{ id: "cursor-acp-gpt5", agent: "cursor", name: "GPT-5" }] },
      gemini: { ...DEFAULTS.delegate.gemini, availableModels: [{ id: "gemini-acp-pro", agent: "gemini", name: "Gemini Pro" }] },
      hermes: { ...DEFAULTS.delegate.hermes, availableModels: [{ id: "hermes-acp-1", agent: "hermes", name: "Hermes 1" }] },
      minimax: { ...DEFAULTS.delegate.minimax, availableModels: [{ id: "minimax-acp-m2", agent: "minimax", name: "M2" }] },
      "custom-agent": { model: "custom-acp-1", availableModels: [{ id: "custom-acp-1", agent: "custom-agent", name: "Custom 1" }] },
    },
  };
  assert.ok(p.modelsFor("cursor").some((m) => m.id === "cursor-acp-gpt5"));
  assert.ok(p.modelsFor("gemini").some((m) => m.id === "gemini-acp-pro"));
  assert.ok(p.modelsFor("hermes").some((m) => m.id === "hermes-acp-1"));
  assert.ok(p.modelsFor("minimax").some((m) => m.id === "minimax-acp-m2"));
  assert.ok(p.modelsFor("custom-agent").some((m) => m.id === "custom-acp-1"));
});
