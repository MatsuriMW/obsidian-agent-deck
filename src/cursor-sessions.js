// Cursor Desktop (3.30.14+) Hook collector and session/conversation normalizer.
//
// Only Hook-discovered sessions (>= 3.30.14) are tracked. Legacy pre-3.30.14
// indexes and historical transcript imports are intentionally out of scope.

import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { cleanUserPrompt, isPromptText } from "./prompt-text.js";
import { querySqliteRows } from "./sqlite.js";

const fsp = fs.promises;

export const CURSOR_MIN_VERSION = "3.30.14";
export const CURSOR_HOOK_MARKER = "agent-deck-cursor-hook";
export const CURSOR_HOOK_VERSION = 2;
export const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "afterAgentResponse",
  "afterAgentThought",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "stop",
];

export const cursorEventsDir = (homeDir = os.homedir()) => path.join(homeDir, ".agent-deck", "cursor-events");
export const cursorHooksDir = (homeDir = os.homedir()) => path.join(homeDir, ".agent-deck", "hooks");
export const cursorHookScriptPath = (homeDir = os.homedir()) => path.join(cursorHooksDir(homeDir), "cursor-hook.mjs");
export const cursorHooksJsonPath = (homeDir = os.homedir()) => path.join(homeDir, ".cursor", "hooks.json");
export const cursorTrackingDbPath = (homeDir = os.homedir()) => path.join(homeDir, ".cursor", "ai-tracking", "ai-code-tracking.db");

export function cursorStateDbPath(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb");
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  return path.join(homeDir, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

function parseSemver(ver) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(ver || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isSupportedCursorVersion(ver) {
  if (!ver) return true;
  const cur = parseSemver(ver);
  const min = parseSemver(CURSOR_MIN_VERSION);
  if (!cur || !min) return true;
  for (let i = 0; i < 3; i++) {
    if (cur[i] !== min[i]) return cur[i] > min[i];
  }
  return true;
}

function writeAtomicSync(file, data, mode) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, data, mode ? { encoding: "utf8", mode } : "utf8");
    if (mode) try { fs.chmodSync(tmp, mode); } catch { /* ignore on win32 */ }
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch { /* committed or absent */ } }
}

const quoteShell = (s) => `"${String(s || "").replace(/(["\\$`])/g, "\\$1")}"`;

export function findNodeBinary(homeDir = os.homedir()) {
  const baseExec = path.basename(process.execPath || "").toLowerCase();
  if (baseExec === "node" || baseExec === "node.exe") return process.execPath;
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ];
  try {
    const nvmDir = path.join(homeDir, ".nvm", "versions", "node");
    if (fs.existsSync(nvmDir)) {
      const vers = fs.readdirSync(nvmDir).sort().reverse();
      for (const v of vers) candidates.push(path.join(nvmDir, v, "bin", "node"));
    }
  } catch { /* no nvm */ }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return "node";
}

export function cursorHookScript() {
  return `// ${CURSOR_HOOK_MARKER} v${CURSOR_HOOK_VERSION}
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_OUTPUT = 65536;
const MAX_INPUT = 16384;

function parseSemver(v) {
  const m = /(\\d+)\\.(\\d+)\\.(\\d+)/.exec(String(v || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function supported(v) {
  if (!v) return true;
  const c = parseSemver(v);
  if (!c) return true;
  const min = [3, 30, 14];
  for (let i = 0; i < 3; i++) if (c[i] !== min[i]) return c[i] > min[i];
  return true;
}
function capString(val, max) {
  const s = typeof val === "string" ? val : val == null ? "" : JSON.stringify(val);
  if (s.length <= max) return { text: s, truncated: false, length: s.length };
  return { text: s.slice(0, max), truncated: true, length: s.length };
}
function capInput(input) {
  if (input == null) return undefined;
  try {
    const raw = JSON.stringify(input);
    if (raw.length <= MAX_INPUT) return input;
    return { _truncated: true, _length: raw.length, preview: raw.slice(0, MAX_INPUT) };
  } catch { return undefined; }
}
function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

const eventArg = process.argv[2] || "";
let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch {}
let p = {};
try { p = raw ? JSON.parse(raw) : {}; } catch { p = {}; }

const event = String(p.hook_event_name || eventArg || "");
const sid = String(p.parent_conversation_id || p.conversation_id || p.session_id || "");

if (event && sid && supported(p.cursor_version)) {
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots.filter((x) => typeof x === "string" && x) : [];
  const cwd = String(p.cwd || roots[0] || "");
  const rec = {
    v: ${CURSOR_HOOK_VERSION},
    at: Date.now(),
    event,
    sid,
    gen: String(p.generation_id || ""),
    cwd,
    model: String(p.model || p.model_id || ""),
    version: String(p.cursor_version || ""),
    transcript: p.transcript_path ? String(p.transcript_path) : "",
  };
  const parentSid = String(p.parent_conversation_id || p.root_conversation_id || "");
  if (parentSid && parentSid !== sid) rec.parentSid = parentSid;
  if (p.is_subagent || (event !== "subagentStart" && event !== "subagentStop" && p.subagent_id)) rec.isSubagent = true;
  if (roots.length) rec.roots = roots;
  if (event === "sessionStart") {
    rec.mode = String(p.composer_mode || "");
    if (p.is_background_agent) rec.bg = true;
  } else if (event === "beforeSubmitPrompt") {
    rec.prompt = String(p.prompt || "");
    rec.mode = String(p.composer_mode || "");
  } else if (event === "preToolUse") {
    rec.tool = String(p.tool_name || "");
    rec.callId = String(p.tool_use_id || "");
    rec.input = capInput(p.tool_input);
    if (p.parent_tool_call_id) rec.parentCallId = String(p.parent_tool_call_id);
  } else if (event === "postToolUse") {
    rec.tool = String(p.tool_name || "");
    rec.callId = String(p.tool_use_id || "");
    rec.input = capInput(p.tool_input);
    const out = capString(p.tool_output, MAX_OUTPUT);
    rec.output = out.text;
    if (out.truncated) { rec.outputTruncated = true; rec.outputLength = out.length; }
    rec.durationMs = num(p.duration_ms ?? p.duration);
    if (p.parent_tool_call_id) rec.parentCallId = String(p.parent_tool_call_id);
  } else if (event === "postToolUseFailure") {
    rec.tool = String(p.tool_name || "");
    rec.callId = String(p.tool_use_id || "");
    rec.input = capInput(p.tool_input);
    rec.error = String(p.error_message || "");
    rec.failureType = String(p.failure_type || "");
    if (p.is_interrupt) rec.isInterrupt = true;
    rec.durationMs = num(p.duration_ms ?? p.duration);
    if (p.parent_tool_call_id) rec.parentCallId = String(p.parent_tool_call_id);
  } else if (event === "afterAgentResponse") {
    rec.text = String(p.text || "");
    const inT = num(p.input_tokens), outT = num(p.output_tokens), cr = num(p.cache_read_tokens), cw = num(p.cache_write_tokens);
    if (inT) rec.inTok = inT;
    if (outT) rec.outTok = outT;
    if (cr) rec.cacheRead = cr;
    if (cw) rec.cacheWrite = cw;
  } else if (event === "afterAgentThought") {
    rec.durationMs = num(p.duration_ms ?? p.duration);
  } else if (event === "stop") {
    rec.status = String(p.status || "");
    rec.loopCount = num(p.loop_count);
    const inT = num(p.input_tokens), outT = num(p.output_tokens), cr = num(p.cache_read_tokens), cw = num(p.cache_write_tokens);
    if (inT) rec.inTok = inT;
    if (outT) rec.outTok = outT;
    if (cr) rec.cacheRead = cr;
    if (cw) rec.cacheWrite = cw;
  } else if (event === "subagentStart") {
    rec.subId = String(p.subagent_id || p.tool_call_id || "");
    rec.subType = String(p.subagent_type || "");
    rec.task = String(p.task || "");
    rec.subModel = String(p.subagent_model || "");
    if (p.is_parallel_worker) rec.bg = true;
    if (p.tool_call_id) rec.parentCallId = String(p.tool_call_id);
    if (p.child_conversation_id) rec.childSid = String(p.child_conversation_id);
  } else if (event === "subagentStop") {
    rec.subId = String(p.subagent_id || p.child_conversation_id || "");
    rec.subType = String(p.subagent_type || "");
    rec.status = String(p.status || "");
    rec.durationMs = num(p.duration_ms ?? p.duration);
    rec.summary = String(p.summary || "");
    rec.error = String(p.error_message || "");
    rec.task = String(p.task || p.description || "");
    if (p.child_conversation_id) rec.childSid = String(p.child_conversation_id);
  } else if (event === "preCompact") {
    rec.trigger = String(p.trigger || "");
  }

  try {
    const dir = process.env.AGENT_DECK_CURSOR_EVENTS_DIR || path.join(os.homedir(), ".agent-deck", "cursor-events");
    fs.mkdirSync(dir, { recursive: true });
    const safeSid = sid.replace(/[^a-zA-Z0-9._-]/g, "_");
    fs.appendFileSync(path.join(dir, safeSid + ".jsonl"), JSON.stringify(rec) + "\\n");
  } catch {}
}

if (event === "sessionStart" || event === "beforeSubmitPrompt") {
  process.stdout.write('{"continue":true}\\n');
} else {
  process.stdout.write("{}\\n");
}
`;
}

const isDeckHookEntry = (entry) => typeof entry?.command === "string" && entry.command.includes("cursor-hook.mjs");

function readHooksJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { version: 1, hooks: {} };
  } catch { return { version: 1, hooks: {} }; }
}

export function cursorHooksStatus({ homeDir = os.homedir() } = {}) {
  const scriptPath = cursorHookScriptPath(homeDir);
  const hooksPath = cursorHooksJsonPath(homeDir);
  const scriptExists = fs.existsSync(scriptPath);
  let scriptUpToDate = false;
  if (scriptExists) {
    try {
      const content = fs.readFileSync(scriptPath, "utf8");
      scriptUpToDate = content.includes(`${CURSOR_HOOK_MARKER} v${CURSOR_HOOK_VERSION}`);
    } catch { scriptUpToDate = false; }
  }
  let matchedEvents = 0;
  if (fs.existsSync(hooksPath)) {
    const cfg = readHooksJson(hooksPath);
    const hooks = cfg.hooks && typeof cfg.hooks === "object" ? cfg.hooks : {};
    for (const ev of CURSOR_HOOK_EVENTS) {
      const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      if (list.some(isDeckHookEntry)) matchedEvents++;
    }
  }
  const installed = scriptExists && matchedEvents === CURSOR_HOOK_EVENTS.length;
  const outdated = (scriptExists && !scriptUpToDate) || (matchedEvents > 0 && matchedEvents < CURSOR_HOOK_EVENTS.length);
  return { installed, outdated, matchedEvents, totalEvents: CURSOR_HOOK_EVENTS.length, scriptExists, scriptPath, hooksPath };
}

export function installCursorHooks({ homeDir = os.homedir(), nodePath = "" } = {}) {
  const scriptPath = cursorHookScriptPath(homeDir);
  const hooksPath = cursorHooksJsonPath(homeDir);
  const eventsDir = cursorEventsDir(homeDir);
  fs.mkdirSync(eventsDir, { recursive: true });
  writeAtomicSync(scriptPath, cursorHookScript(), 0o755);

  const node = nodePath || findNodeBinary(homeDir);
  const cfg = readHooksJson(hooksPath);
  if (!Number.isFinite(cfg.version) || cfg.version < 1) cfg.version = 1;
  const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};

  for (const ev of CURSOR_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[ev]) ? hooks[ev].filter((e) => !isDeckHookEntry(e)) : [];
    existing.push({ command: `${quoteShell(node)} ${quoteShell(scriptPath)} ${ev}` });
    hooks[ev] = existing;
  }
  cfg.hooks = hooks;
  writeAtomicSync(hooksPath, JSON.stringify(cfg, null, 2) + "\n");
  return { scriptPath, hooksPath, eventsDir };
}

export function uninstallCursorHooks({ homeDir = os.homedir() } = {}) {
  const scriptPath = cursorHookScriptPath(homeDir);
  const hooksPath = cursorHooksJsonPath(homeDir);
  if (fs.existsSync(hooksPath)) {
    const cfg = readHooksJson(hooksPath);
    const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};
    for (const ev of Object.keys(hooks)) {
      if (!Array.isArray(hooks[ev])) continue;
      const kept = hooks[ev].filter((e) => !isDeckHookEntry(e));
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    cfg.hooks = hooks;
    writeAtomicSync(hooksPath, JSON.stringify(cfg, null, 2) + "\n");
  }
  try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  return { scriptPath, hooksPath };
}

export function isCursorRunning({ platform = process.platform, exec = execFile } = {}) {
  const cmd = platform === "win32" ? "tasklist" : platform === "darwin" ? "/bin/ps" : "ps";
  const args = platform === "win32" ? ["/FI", "IMAGENAME eq Cursor.exe", "/FO", "CSV", "/NH"] : ["-eo", "comm="];
  return new Promise((resolve) => {
    exec(cmd, args, { timeout: 2000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err) return resolve(false);
      const text = String(out || "");
      if (platform === "win32") return resolve(/"cursor\.exe"/i.test(text));
      if (platform === "darwin") return resolve(text.split("\n").some((line) => /(?:^|\/)Cursor\.app\/Contents\/MacOS\/Cursor$/i.test(line.trim())));
      return resolve(text.split("\n").some((line) => /(?:^|\/)cursor(?:\.appimage)?$/i.test(line.trim())));
    });
  });
}

// ----- DB metadata enrichment for Hook-discovered sessions ONLY -----

const sqlQuote = (s) => `'${String(s || "").replaceAll("'", "''")}'`;

export async function readCursorDbMeta(sids, { homeDir = os.homedir() } = {}) {
  const list = [...new Set((sids || []).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;

  const trackDb = cursorTrackingDbPath(homeDir);
  const inClause = list.map(sqlQuote).join(",");
  for (const row of await querySqliteRows(trackDb, `SELECT conversationId, coalesce(title,'') AS title, coalesce(model,'') AS model FROM conversation_summaries WHERE conversationId IN (${inClause})`)) {
    const sid = String(row?.conversationId || "");
    if (!sid) continue;
    const entry = out.get(sid) || {};
    const title = String(row.title || "").replace(/\s+/g, " ").trim();
    const model = String(row.model || "").trim();
    if (title) entry.title = title.slice(0, 120);
    if (model) entry.model = model;
    out.set(sid, entry);
  }

  const stateDb = cursorStateDbPath(homeDir);
  const kvKeys = list.map((id) => sqlQuote(`composerData:${id}`)).join(",");
  for (const row of await querySqliteRows(stateDb, `SELECT key, value FROM cursorDiskKV WHERE key IN (${kvKeys})`)) {
    const rawKey = String(row?.key || "");
    if (!rawKey) continue;
    const sid = rawKey.replace(/^composerData:/, "");
    let d;
    try { d = typeof row.value === "string" ? JSON.parse(row.value) : row.value; } catch { continue; }
    if (!d || typeof d !== "object") continue;
    const entry = out.get(sid) || {};
    const title = String(d.name || "").replace(/\s+/g, " ").trim();
    if (title) entry.title = title.slice(0, 120);
    if (typeof d.isArchived === "boolean") entry.archived = d.isArchived;
    const fsPath = d.workspaceIdentifier?.uri?.fsPath || "";
    if (fsPath) entry.cwd = fsPath;
    const modelName = d.modelConfig?.modelName || "";
    if (modelName && !entry.model) entry.model = modelName;
    out.set(sid, entry);
  }

  return out;
}

// ----- Event ingestion into AgentUsage -----

function ensureCursorState(fc) {
  if (!fc.cursor) fc.cursor = { seenEvents: new Set(), openTools: new Map(), closedTools: new Set(), transcript: "" };
  return fc.cursor;
}

export function packCursorState(c) {
  if (!c) return undefined;
  return {
    se: [...c.seenEvents],
    ot: [...c.openTools],
    ct: [...c.closedTools],
    tp: c.transcript || "",
  };
}

export function unpackCursorState(o) {
  if (!o) return undefined;
  return {
    seenEvents: new Set(o.se || []),
    openTools: new Map(o.ot || []),
    closedTools: new Set(o.ct || []),
    transcript: o.tp || "",
  };
}

function eventDedupKey(d) {
  const ev = d.event || "";
  if (ev === "beforeSubmitPrompt") return `p:${d.gen || d.at}`;
  if (ev === "preToolUse" || ev === "postToolUse" || ev === "postToolUseFailure") {
    return d.callId ? `${ev}:${d.callId}` : `${ev}:${d.gen || ""}:${d.at}:${d.tool || ""}`;
  }
  if (ev === "stop") return `stop:${d.gen || d.at}:${d.loopCount || 0}:${d.status || ""}`;
  if (ev === "afterAgentResponse") return `resp:${d.gen || d.at}:${d.text ? d.text.length : 0}:${d.outTok || 0}`;
  if (ev === "subagentStart" || ev === "subagentStop") return `${ev}:${d.subId || d.parentCallId || d.at}`;
  return `${ev}:${d.gen || ""}:${d.at}`;
}

function applyCursorTokens(usage, fc, sid, key, proj, model, ms, d) {
  const out = Number(d.outTok) || 0;
  const fresh = (Number(d.inTok) || 0) + (Number(d.cacheWrite) || 0);
  const cached = Number(d.cacheRead) || 0;
  if (!out && !fresh && !cached) return null;
  const msgId = `cursor:${sid}:${d.gen || ms}`;
  const prev = fc.msgs.get(msgId) || { out: 0, fresh: 0, cached: 0 };
  const m = { key, sid, proj, model: model || "cursor", out, fresh, cached, at: ms };
  fc.msgs.set(msgId, m);
  return { prev, m, isNew: !prev.out && !prev.fresh && !prev.cached };
}

function linkCursorChild(usage, parentSid, childSid) {
  if (!parentSid || !childSid || parentSid === childSid) return;
  (usage.cursorParents ||= new Map()).set(childSid, parentSid);
  usage.markSubagent?.(childSid, parentSid);
  const childMeta = usage.meta.get(childSid);
  if (childMeta && !childMeta.parentSid) childMeta.parentSid = parentSid;
}

export function ingestCursorEvent(ctx, d, fc, touched) {
  if (!d || typeof d !== "object") return;
  if (!isSupportedCursorVersion(d.version)) return;
  const ev = String(d.event || d.hook_event_name || "");
  const sid = String(d.sid || d.parent_conversation_id || d.conversation_id || d.session_id || "");
  const ms = Number(d.at) || 0;
  if (!ev || !sid || !ms) return;

  const { usage, startRound, finishRound, stepText } = ctx;
  const cs = ensureCursorState(fc);
  const dk = eventDedupKey(d);
  if (cs.seenEvents.has(dk)) return;
  cs.seenEvents.add(dk);

  fc.sid = sid;
  if (d.parentSid && d.parentSid !== sid) {
    fc.parentSid = d.parentSid;
    linkCursorChild(usage, d.parentSid, sid);
  }
  if (d.isSubagent) fc.isSubagent = true;
  if (d.cwd && (!fc.cwd || fc.cwd === "~")) fc.cwd = d.cwd;
  else if (!fc.cwd && Array.isArray(d.roots) && d.roots[0]) fc.cwd = d.roots[0];
  fc.app = "desktop";
  if (d.model) fc.model = d.model;
  if (d.transcript) cs.transcript = d.transcript;

  if (ev === "sessionStart") {
    const existingLastAt = usage.meta.get(sid)?.lastAt || 0;
    usage.noteMeta(fc, sid, {
      cwd: fc.cwd,
      app: "desktop",
      model: fc.model || usage.meta.get(sid)?.model || "",
      lastAt: existingLastAt || ms,
    });
    return;
  }

  if (usage.stale("cursor", ms)) return;

  // Closing/archiving (`sessionEnd`) or background compaction (`preCompact`) must not
  // fabricate conversation activity or bump `lastAt` past the last real turn.
  if (ev === "preCompact") return;
  if (ev === "sessionEnd") {
    cs.openTools.clear();
    if (fc.live) {
      fc.live.step = "";
      if (fc.live.state === "run") fc.live.state = "wait";
    }
    const meta = usage.meta.get(sid);
    if (meta) {
      usage.noteMeta(fc, sid, {
        state: meta.state === "run" ? "wait" : meta.state,
        step: "",
      });
    }
    return;
  }

  const { key, day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd, "desktop");
  const v = usage.liveOf(fc, sid, ms);
  v.cwd = fc.cwd;
  v.app = "desktop";
  if (fc.model) v.model = fc.model;

  if (ev === "beforeSubmitPrompt") {
    cs.openTools.clear();
    const ask = cleanUserPrompt(d.prompt || "");
    if (isPromptText(ask)) {
      day.prompts++;
      startRound(fc, ms, d.prompt || "", d.gen ? `gen:${d.gen}` : String(ms));
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
      const line = ask.replace(/\s+/g, " ").trim();
      if (s.text.length < 300) s.text += (s.text ? " / " : "") + line.slice(0, 300 - s.text.length);
    }
    v.state = "run";
    v.err = "";
    v.step = "";
  } else if (ev === "preToolUse") {
    const callId = String(d.callId || `t:${ms}:${d.tool || ""}`);
    if (!cs.closedTools.has(callId)) {
      const step = stepText(d.tool, d.input);
      cs.openTools.set(callId, { name: d.tool || "", step, at: ms });
      v.step = step;
    }
    v.state = "run";
  } else if (ev === "postToolUse" || ev === "postToolUseFailure") {
    const callId = String(d.callId || "");
    if (callId) {
      cs.openTools.delete(callId);
      cs.closedTools.add(callId);
    }
    const nextOpen = [...cs.openTools.values()].at(-1);
    v.step = nextOpen ? nextOpen.step : "";
    // A tool failure can be recovered in the same turn; never mark the turn errored here.
    v.state = "run";
  } else if (ev === "afterAgentResponse") {
    if (d.text && String(d.text).trim()) v.lastText = String(d.text);
    finishRound(fc, ms, v.lastText, false);
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
    v.state = "run";
    const tokDelta = applyCursorTokens(usage, fc, sid, key, s.proj, v.model || fc.model, ms, d);
    if (tokDelta) {
      const meta = usage.meta.get(sid) || {};
      usage.noteMeta(fc, sid, {
        title: v.title, text: s.text, cwd: v.cwd, app: "desktop", model: tokDelta.m.model,
        lastAt: Math.max(ms, meta.lastAt || 0),
        out: (meta.out || 0) - tokDelta.prev.out + tokDelta.m.out,
        fresh: (meta.fresh || 0) - tokDelta.prev.fresh + tokDelta.m.fresh,
        cached: (meta.cached || 0) - tokDelta.prev.cached + tokDelta.m.cached,
        calls: (meta.calls || 0) + (tokDelta.isNew ? 1 : 0),
        state: v.state, step: v.step, turns: v.turns, rounds: v.rounds, lastText: v.lastText, err: v.err,
      });
      return;
    }
  } else if (ev === "afterAgentThought") {
    v.state = "run";
  } else if (ev === "stop") {
    cs.openTools.clear();
    v.step = "";
    const status = String(d.status || "").toLowerCase();
    if (status === "error" || status === "failed") {
      v.state = "error";
      v.err = String(d.error || status).slice(0, 120);
    } else {
      v.state = "wait";
      v.err = "";
    }
    finishRound(fc, ms, v.lastText, v.state === "wait");
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
    const tokDelta = applyCursorTokens(usage, fc, sid, key, s.proj, v.model || fc.model, ms, d);
    if (tokDelta) {
      const meta = usage.meta.get(sid) || {};
      usage.noteMeta(fc, sid, {
        title: v.title, text: s.text, cwd: v.cwd, app: "desktop", model: tokDelta.m.model,
        lastAt: Math.max(ms, meta.lastAt || 0),
        out: (meta.out || 0) - tokDelta.prev.out + tokDelta.m.out,
        fresh: (meta.fresh || 0) - tokDelta.prev.fresh + tokDelta.m.fresh,
        cached: (meta.cached || 0) - tokDelta.prev.cached + tokDelta.m.cached,
        calls: (meta.calls || 0) + (tokDelta.isNew ? 1 : 0),
        state: v.state, step: "", turns: v.turns, rounds: v.rounds, lastText: v.lastText, err: v.err,
      });
      return;
    }
  } else if (ev === "subagentStart") {
    const subId = String(d.subId || d.parentCallId || "");
    if (subId) {
      const r = usage.subOf(sid, subId);
      if (!r.start || ms < r.start) r.start = ms;
      r.at = Math.max(r.at, ms);
      r.desc = String(d.task || r.desc || "");
      r.type = String(d.subType || r.type || "");
      r.bg = !!d.bg;
      if (!r.endAt) r.state = "run";
    }
    linkCursorChild(usage, sid, d.childSid);
  } else if (ev === "subagentStop") {
    const subId = String(d.subId || d.childSid || "");
    if (subId) {
      const r = usage.subOf(sid, subId);
      r.at = Math.max(r.at, ms);
      r.endAt = ms;
      const st = String(d.status || "").toLowerCase();
      r.state = st === "error" || st === "failed" ? "error" : "done";
      r.end = String(d.error || d.summary || d.status || "done");
      r.last = String(d.summary || d.error || "");
      if (d.task && !r.desc) r.desc = String(d.task);
      if (d.subType && !r.type) r.type = String(d.subType);
    }
    linkCursorChild(usage, sid, d.childSid);
  }

  const meta = usage.meta.get(sid) || {};
  const parentSid = fc.parentSid || usage.cursorParents?.get(sid) || meta.parentSid || "";
  const isSubagent = Boolean(fc.isSubagent || meta.isSubagent);
  usage.noteMeta(fc, sid, {
    title: v.title || meta.title || "",
    text: s.text || meta.text || "",
    cwd: v.cwd || meta.cwd || "",
    app: "desktop",
    model: v.model || fc.model || meta.model || "",
    lastAt: Math.max(ms, meta.lastAt || 0),
    parentSid,
    ...(isSubagent ? { isSubagent: true } : {}),
    state: v.state,
    step: v.step,
    turns: v.turns || 0,
    rounds: v.rounds || [],
    lastText: v.lastText || "",
    err: v.err || "",
  });
}

// ----- Conversation & Tool Timeline builder -----

function parseTranscriptTurns(transcriptText) {
  const turns = [];
  let cur = null;
  for (const line of String(transcriptText || "").split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type === "turn_ended") {
      if (cur) { cur.status = d.status || ""; cur.error = d.error || ""; }
      continue;
    }
    const content = Array.isArray(d.message?.content) ? d.message.content : [];
    const texts = content.filter((b) => b?.type === "text" && b.text).map((b) => b.text);
    const toolUses = content.filter((b) => b?.type === "tool_use").map((b) => ({ name: b.name || "", input: b.input }));
    if (d.role === "user") {
      const prompt = cleanUserPrompt(texts.join("\n"));
      cur = { prompt, responses: [], toolUses: [], status: "", error: "" };
      turns.push(cur);
    } else if (d.role === "assistant") {
      if (!cur) { cur = { prompt: "", responses: [], toolUses: [], status: "", error: "" }; turns.push(cur); }
      if (texts.length) cur.responses.push(texts.join("\n"));
      if (toolUses.length) cur.toolUses.push(...toolUses);
    }
  }
  return turns;
}

export function buildCursorConversation(eventsText, transcriptText = "") {
  const events = [];
  for (const line of String(eventsText || "").split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!isSupportedCursorVersion(d.version)) continue;
    events.push(d);
  }
  events.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));

  const turns = [];
  const byGen = new Map();
  const seenDedup = new Set();

  const getTurn = (d) => {
    const gen = String(d.gen || "");
    if (gen && byGen.has(gen)) return byGen.get(gen);
    let cur = turns[turns.length - 1];
    if (!cur || (gen && cur.gen && cur.gen !== gen)) {
      cur = { gen, at: Number(d.at) || 0, prompt: "", text: "", texts: [], tools: [], toolById: new Map(), status: "", error: "", stopped: false };
      turns.push(cur);
      if (gen) byGen.set(gen, cur);
    }
    return cur;
  };

  for (const d of events) {
    const dk = eventDedupKey(d);
    if (seenDedup.has(dk)) continue;
    seenDedup.add(dk);
    const ev = String(d.event || d.hook_event_name || "");
    const ms = Number(d.at) || 0;

    if (ev === "beforeSubmitPrompt") {
      const gen = String(d.gen || "");
      const ask = cleanUserPrompt(d.prompt || "");
      let turn = gen && byGen.get(gen);
      if (!turn) {
        turn = { gen, at: ms, prompt: ask, text: "", texts: [], tools: [], toolById: new Map(), status: "", error: "", stopped: false };
        turns.push(turn);
        if (gen) byGen.set(gen, turn);
      } else if (ask) {
        turn.prompt = ask;
        if (!turn.at || ms < turn.at) turn.at = ms;
      }
      continue;
    }

    if (ev === "preToolUse" || ev === "postToolUse" || ev === "postToolUseFailure") {
      const turn = getTurn(d);
      const callId = String(d.callId || "");
      let tool = callId ? turn.toolById.get(callId) : null;
      if (!tool) {
        tool = {
          callId: callId || `t-${turn.tools.length + 1}`,
          name: String(d.tool || ""),
          status: "running",
          input: d.input,
          output: "",
          outputTruncated: false,
          outputLength: 0,
          error: "",
          failureType: "",
          durationMs: 0,
          at: ms,
          endAt: 0,
          missingResult: false,
        };
        turn.tools.push(tool);
        if (callId) turn.toolById.set(callId, tool);
      }
      if (d.tool && !tool.name) tool.name = String(d.tool);
      if (d.input !== undefined && tool.input === undefined) tool.input = d.input;
      if (ev === "preToolUse") {
        if (!tool.at || ms < tool.at) tool.at = ms;
      } else if (ev === "postToolUse") {
        tool.status = "success";
        tool.output = String(d.output || "");
        tool.outputTruncated = !!d.outputTruncated;
        tool.outputLength = Number(d.outputLength) || tool.output.length;
        tool.durationMs = Number(d.durationMs) || (tool.at && ms >= tool.at ? ms - tool.at : 0);
        tool.endAt = ms;
      } else {
        tool.status = d.isInterrupt ? "interrupted" : "error";
        tool.error = String(d.error || d.failureType || "failed");
        tool.failureType = String(d.failureType || "");
        tool.durationMs = Number(d.durationMs) || (tool.at && ms >= tool.at ? ms - tool.at : 0);
        tool.endAt = ms;
      }
    } else if (ev === "afterAgentResponse") {
      const turn = getTurn(d);
      const txt = String(d.text || "").trim();
      if (txt && !turn.texts.includes(txt)) turn.texts.push(txt);
      turn.text = turn.texts.join("\n\n");
      turn.endAt = Math.max(turn.endAt || 0, ms);
    } else if (ev === "stop") {
      const turn = getTurn(d);
      turn.stopped = true;
      turn.status = String(d.status || "");
      turn.error = String(d.error || "");
      turn.endAt = Math.max(turn.endAt || 0, ms);
    }
  }

  // Supplement missing assistant text from Cursor's transcript ONLY for turns already started in Hooks.
  if (transcriptText && turns.length) {
    const tTurns = parseTranscriptTurns(transcriptText);
    const firstPrompt = turns.find((t) => t.prompt)?.prompt || "";
    let offset = 0;
    if (firstPrompt) {
      const matchIdx = tTurns.findIndex((tt) => tt.prompt === firstPrompt);
      if (matchIdx >= 0) offset = matchIdx;
      else offset = Math.max(0, tTurns.length - turns.length);
    }
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const tt = tTurns[offset + i];
      if (!tt) continue;
      if (firstPrompt && i === 0 && tt.prompt && tt.prompt !== firstPrompt) continue;
      if (!turn.text && tt.responses.length) turn.text = tt.responses.join("\n\n");
      if (!turn.tools.length && tt.toolUses.length) {
        turn.tools = tt.toolUses.map((tu, idx) => ({
          callId: `tr-${i}-${idx}`,
          name: tu.name,
          status: "missing",
          input: tu.input,
          output: "",
          outputTruncated: false,
          outputLength: 0,
          error: "",
          failureType: "",
          durationMs: 0,
          at: turn.at,
          endAt: 0,
          missingResult: true,
        }));
      }
    }
  }

  const messages = [];
  for (const turn of turns) {
    for (const tool of turn.tools) {
      if (tool.status === "running" && (turn.stopped || turn.text)) {
        tool.status = "missing";
        tool.missingResult = true;
      }
    }
    if (turn.prompt) messages.push({ role: "user", text: turn.prompt, at: turn.at });
    const cleanTools = turn.tools.map(({ callId, name, status, input, output, outputTruncated, outputLength, error, failureType, durationMs, at, endAt, missingResult }) => ({
      callId, name, status, input, output, outputTruncated, outputLength, error, failureType, durationMs, at, endAt, missingResult,
    }));
    if (turn.text || cleanTools.length) {
      messages.push({
        role: "assistant",
        text: turn.text || "",
        at: turn.endAt || turn.at,
        ...(cleanTools.length ? { tools: cleanTools } : {}),
      });
    }
  }
  return messages;
}

export async function readCursorTranscript(eventsText, fallbackPath = "") {
  let transcriptPath = fallbackPath || "";
  for (const line of String(eventsText || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.transcript) transcriptPath = d.transcript;
    } catch { /* ignore */ }
  }
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { path: "", mtime: 0, size: 0, text: "" };
  try {
    const st = await fsp.stat(transcriptPath);
    const text = await fsp.readFile(transcriptPath, "utf8");
    return { path: transcriptPath, mtime: st.mtimeMs, size: st.size, text };
  } catch {
    return { path: transcriptPath, mtime: 0, size: 0, text: "" };
  }
}
