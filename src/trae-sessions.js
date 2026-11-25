// Trae Desktop (Trae CN / Trae) Hook collector and session/conversation normalizer.
//
// Trae's local ModularData/ai-agent/database.db is encrypted (SQLCipher) and is
// strictly never decrypted. Instead, Agent Deck observes Trae lifecycle hooks
// configured via ~/.trae-cn/hooks.json / ~/.trae/hooks.json (version 1).

import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { cleanUserPrompt, isPromptText } from "./prompt-text.js";
import { findNodeBinary } from "./cursor-sessions.js";

export const TRAE_HOOK_MARKER = "agent-deck-trae-hook";
export const TRAE_HOOK_VERSION = 2;
export const TRAE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "Notification",
];
const TOOL_MATCHER_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

export const traeEventsDir = (homeDir = os.homedir()) => path.join(homeDir, ".agent-deck", "trae-events");
export const traeHooksDir = (homeDir = os.homedir()) => path.join(homeDir, ".agent-deck", "hooks");
export const traeHookScriptPath = (homeDir = os.homedir()) => path.join(traeHooksDir(homeDir), "trae-hook.mjs");

export function traeConfigDirs(homeDir = os.homedir()) {
  const candidates = [path.join(homeDir, ".trae-cn"), path.join(homeDir, ".trae")];
  const existing = candidates.filter((d) => {
    try { return fs.existsSync(d); } catch { return false; }
  });
  return existing.length ? existing : [candidates[0]];
}

export function traeHooksJsonPaths(homeDir = os.homedir()) {
  return traeConfigDirs(homeDir).map((d) => path.join(d, "hooks.json"));
}

export function traeDataDirs(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return [path.join(appData, "Trae CN"), path.join(appData, "Trae")];
  }
  if (platform === "darwin") {
    const appSup = path.join(homeDir, "Library", "Application Support");
    return [path.join(appSup, "Trae CN"), path.join(appSup, "Trae")];
  }
  const xdg = env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
  return [path.join(xdg, "Trae CN"), path.join(xdg, "Trae")];
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

export function traeHookScript() {
  return `// ${TRAE_HOOK_MARKER} v${TRAE_HOOK_VERSION}
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_OUTPUT = 65536;
const MAX_INPUT = 16384;

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
const sid = String(p.session_id || p.conversation_id || p.external_session_id || "");

if (event && sid) {
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots.filter((x) => typeof x === "string" && x) : [];
  const cwd = String(p.cwd || p.repo_working_dir || roots[0] || "");
  const rec = {
    v: ${TRAE_HOOK_VERSION},
    at: Date.now(),
    event,
    sid,
    cwd,
    model: String(p.display_model_name || p.model || p.model_id || ""),
  };
  const title = String(p.title || "").trim();
  if (title) rec.title = title.slice(0, 120);
  const parentSid = String(p.parent_session_id || p.parent_conversation_id || "");
  if (parentSid && parentSid !== sid) rec.parentSid = parentSid;
  if (p.is_subagent) rec.isSubagent = true;
  if (roots.length) rec.roots = roots;

  if (event === "SessionStart") {
    if (p.source) rec.source = String(p.source);
    if (p.chat_mode) rec.mode = String(p.chat_mode);
  } else if (event === "UserPromptSubmit") {
    rec.prompt = String(p.prompt || p.user_prompt || p.text_content || p.message || "");
    if (p.chat_mode) rec.mode = String(p.chat_mode);
  } else if (event === "PreToolUse") {
    rec.tool = String(p.tool_name || p.llm_tool_name || "");
    rec.callId = String(p.tool_use_id || p.toolcall_id || "");
    rec.input = capInput(p.tool_input);
  } else if (event === "PostToolUse") {
    rec.tool = String(p.tool_name || p.llm_tool_name || "");
    rec.callId = String(p.tool_use_id || p.toolcall_id || "");
    rec.input = capInput(p.tool_input);
    const out = capString(p.tool_response ?? p.tool_output, MAX_OUTPUT);
    rec.output = out.text;
    if (out.truncated) { rec.outputTruncated = true; rec.outputLength = out.length; }
    if (typeof p.tool_success === "boolean") rec.toolSuccess = p.tool_success;
    rec.durationMs = num(p.duration_ms ?? p.duration);
  } else if (event === "Stop") {
    rec.text = String(p.last_assistant_message || p.text_content || p.text || "");
    rec.status = String(p.status || "");
    rec.stopReason = String(p.stop_reason || p.reason || "");
    rec.loopCount = num(p.loop_count);
    const inT = num(p.prompt_tokens ?? p.input_tokens);
    const outT = num(p.completion_tokens ?? p.output_tokens);
    const cr = num(p.cache_read_input_tokens ?? p.cache_read_tokens);
    const cw = num(p.cache_creation_input_tokens ?? p.cache_write_tokens);
    if (inT) rec.inTok = inT;
    if (outT) rec.outTok = outT;
    if (cr) rec.cacheRead = cr;
    if (cw) rec.cacheWrite = cw;
  } else if (event === "Notification") {
    rec.notificationType = String(p.notification_type || "");
    rec.text = String(p.text_content || p.message || "");
  } else if (event === "PreCompact" || event === "PostCompact") {
    rec.trigger = String(p.trigger || "");
    if (p.compact_summary) rec.summary = String(p.compact_summary).slice(0, 2000);
  }

  try {
    const dir = process.env.AGENT_DECK_TRAE_EVENTS_DIR || path.join(os.homedir(), ".agent-deck", "trae-events");
    fs.mkdirSync(dir, { recursive: true });
    const safeSid = sid.replace(/[^a-zA-Z0-9._-]/g, "_");
    fs.appendFileSync(path.join(dir, safeSid + ".jsonl"), JSON.stringify(rec) + "\\n");
  } catch {}
}

process.stdout.write("{}\\n");
`;
}

const isDeckCommand = (cmd) => typeof cmd === "string" && cmd.includes("trae-hook.mjs");

function groupHasDeckHook(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (isDeckCommand(entry.command)) return true;
  if (Array.isArray(entry.hooks)) return entry.hooks.some((h) => isDeckCommand(h?.command));
  return false;
}

function stripDeckHooksFromEvent(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (isDeckCommand(entry.command)) continue;
    if (Array.isArray(entry.hooks)) {
      const kept = entry.hooks.filter((h) => !isDeckCommand(h?.command));
      if (!kept.length) continue;
      out.push({ ...entry, hooks: kept });
      continue;
    }
    out.push(entry);
  }
  return out;
}

function groupHasInvalidMatcher(ev, entry) {
  if (!TOOL_MATCHER_EVENTS.has(ev) || !groupHasDeckHook(entry)) return false;
  return entry.matcher === "*";
}

function readHooksJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { version: 1, hooks: {} };
  } catch { return { version: 1, hooks: {} }; }
}

export function traeHooksStatus({ homeDir = os.homedir() } = {}) {
  const scriptPath = traeHookScriptPath(homeDir);
  const hooksPaths = traeHooksJsonPaths(homeDir);
  const scriptExists = fs.existsSync(scriptPath);
  let scriptUpToDate = false;
  if (scriptExists) {
    try {
      const content = fs.readFileSync(scriptPath, "utf8");
      scriptUpToDate = content.includes(`${TRAE_HOOK_MARKER} v${TRAE_HOOK_VERSION}`);
    } catch { scriptUpToDate = false; }
  }
  const existingJsonPaths = hooksPaths.filter((p) => fs.existsSync(p));
  let matchedEvents = 0;
  let hasInvalidMatcher = false;
  if (existingJsonPaths.length === hooksPaths.length) {
    const configs = existingJsonPaths.map((p) => readHooksJson(p));
    for (const ev of TRAE_HOOK_EVENTS) {
      const allHave = configs.every((cfg) => {
        const list = Array.isArray(cfg.hooks?.[ev]) ? cfg.hooks[ev] : [];
        if (list.some((entry) => groupHasInvalidMatcher(ev, entry))) hasInvalidMatcher = true;
        return list.some(groupHasDeckHook);
      });
      if (allHave) matchedEvents++;
    }
  } else if (existingJsonPaths.length > 0) {
    const configs = existingJsonPaths.map((p) => readHooksJson(p));
    for (const ev of TRAE_HOOK_EVENTS) {
      if (configs.some((cfg) => {
        const list = Array.isArray(cfg.hooks?.[ev]) ? cfg.hooks[ev] : [];
        if (list.some((entry) => groupHasInvalidMatcher(ev, entry))) hasInvalidMatcher = true;
        return list.some(groupHasDeckHook);
      })) matchedEvents++;
    }
  }
  const installed = scriptExists && existingJsonPaths.length === hooksPaths.length && matchedEvents === TRAE_HOOK_EVENTS.length;
  const outdated = (scriptExists && !scriptUpToDate)
    || hasInvalidMatcher
    || (matchedEvents > 0 && (matchedEvents < TRAE_HOOK_EVENTS.length || existingJsonPaths.length < hooksPaths.length));
  return { installed, outdated, matchedEvents, totalEvents: TRAE_HOOK_EVENTS.length, scriptExists, scriptPath, hooksPath: hooksPaths[0], hooksPaths };
}

export function installTraeHooks({ homeDir = os.homedir(), nodePath = "" } = {}) {
  const scriptPath = traeHookScriptPath(homeDir);
  const hooksPaths = traeHooksJsonPaths(homeDir);
  const eventsDir = traeEventsDir(homeDir);
  fs.mkdirSync(eventsDir, { recursive: true });
  writeAtomicSync(scriptPath, traeHookScript(), 0o755);

  const node = nodePath || findNodeBinary(homeDir);
  for (const hooksPath of hooksPaths) {
    const cfg = readHooksJson(hooksPath);
    if (!Number.isFinite(cfg.version) || cfg.version < 1) cfg.version = 1;
    const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};

    for (const ev of TRAE_HOOK_EVENTS) {
      const cleaned = stripDeckHooksFromEvent(hooks[ev]);
      const group = {
        ...(TOOL_MATCHER_EVENTS.has(ev) ? { matcher: ".*" } : {}),
        hooks: [{ type: "command", command: `${quoteShell(node)} ${quoteShell(scriptPath)} ${ev}` }],
      };
      cleaned.push(group);
      hooks[ev] = cleaned;
    }
    cfg.hooks = hooks;
    writeAtomicSync(hooksPath, JSON.stringify(cfg, null, 2) + "\n");
  }
  return { scriptPath, hooksPath: hooksPaths[0], hooksPaths, eventsDir };
}

export function uninstallTraeHooks({ homeDir = os.homedir() } = {}) {
  const scriptPath = traeHookScriptPath(homeDir);
  const allTargets = [...new Set([
    ...traeHooksJsonPaths(homeDir),
    path.join(homeDir, ".trae-cn", "hooks.json"),
    path.join(homeDir, ".trae", "hooks.json"),
  ])];
  const hooksPaths = [];
  for (const hooksPath of allTargets) {
    if (!fs.existsSync(hooksPath)) continue;
    hooksPaths.push(hooksPath);
    const cfg = readHooksJson(hooksPath);
    const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};
    for (const ev of Object.keys(hooks)) {
      if (!Array.isArray(hooks[ev])) continue;
      const kept = stripDeckHooksFromEvent(hooks[ev]);
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    cfg.hooks = hooks;
    writeAtomicSync(hooksPath, JSON.stringify(cfg, null, 2) + "\n");
  }
  try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  return { scriptPath, hooksPath: hooksPaths[0] || allTargets[0], hooksPaths };
}

export function isTraeRunning({ platform = process.platform, exec = execFile } = {}) {
  const cmd = platform === "win32" ? "tasklist" : platform === "darwin" ? "/bin/ps" : "ps";
  const args = platform === "win32" ? ["/FI", "IMAGENAME eq Trae*", "/FO", "CSV", "/NH"] : ["-eo", "comm="];
  return new Promise((resolve) => {
    exec(cmd, args, { timeout: 2000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err) return resolve(false);
      const text = String(out || "");
      if (platform === "win32") return resolve(/"trae(?: cn)?\.exe"/i.test(text));
      if (platform === "darwin") return resolve(text.split("\n").some((line) => /(?:^|\/)Trae(?: CN)?\.app\/Contents\/MacOS\/(?:Electron|Trae(?: CN)?)$/i.test(line.trim())));
      return resolve(text.split("\n").some((line) => /(?:^|\/)trae(?:-cn)?(?:\.appimage)?$/i.test(line.trim())));
    });
  });
}

// ----- Event ingestion into AgentUsage -----

function ensureTraeState(fc) {
  if (!fc.trae) fc.trae = { seenEvents: new Set(), openTools: new Map(), closedTools: new Set() };
  return fc.trae;
}

export function packTraeState(t) {
  if (!t) return undefined;
  return {
    se: [...t.seenEvents],
    ot: [...t.openTools],
    ct: [...t.closedTools],
  };
}

export function unpackTraeState(o) {
  if (!o) return undefined;
  return {
    seenEvents: new Set(o.se || []),
    openTools: new Map(o.ot || []),
    closedTools: new Set(o.ct || []),
  };
}

function eventDedupKey(d) {
  const ev = d.event || d.hook_event_name || "";
  if (ev === "UserPromptSubmit") return `p:${d.at}:${(d.prompt || "").length}`;
  if (ev === "PreToolUse" || ev === "PostToolUse") {
    return d.callId ? `${ev}:${d.callId}` : `${ev}:${d.at}:${d.tool || ""}`;
  }
  if (ev === "Stop") return `stop:${d.at}:${d.loopCount || 0}:${d.status || ""}:${(d.text || "").length}`;
  return `${ev}:${d.at}`;
}

function applyTraeTokens(usage, fc, sid, key, proj, model, ms, d) {
  const out = Number(d.outTok) || 0;
  const fresh = (Number(d.inTok) || 0) + (Number(d.cacheWrite) || 0);
  const cached = Number(d.cacheRead) || 0;
  if (!out && !fresh && !cached) return null;
  const msgId = `trae:${sid}:${ms}`;
  const prev = fc.msgs.get(msgId) || { out: 0, fresh: 0, cached: 0 };
  const m = { key, sid, proj, model: model || "trae", out, fresh, cached, at: ms };
  fc.msgs.set(msgId, m);
  return { prev, m, isNew: !prev.out && !prev.fresh && !prev.cached };
}

export function ingestTraeEvent(ctx, d, fc, touched) {
  if (!d || typeof d !== "object") return;
  const ev = String(d.event || d.hook_event_name || "");
  const sid = String(d.sid || d.session_id || d.conversation_id || "");
  const ms = Number(d.at) || 0;
  if (!ev || !sid || !ms) return;

  const { usage, startRound, finishRound, stepText } = ctx;
  const ts = ensureTraeState(fc);
  const dk = eventDedupKey(d);
  if (ts.seenEvents.has(dk)) return;
  ts.seenEvents.add(dk);

  fc.sid = sid;
  if (d.parentSid && d.parentSid !== sid) {
    fc.parentSid = d.parentSid;
    usage.markSubagent?.(sid, d.parentSid);
  }
  if (d.isSubagent) fc.isSubagent = true;
  if (d.cwd && (!fc.cwd || fc.cwd === "~")) fc.cwd = d.cwd;
  else if (!fc.cwd && Array.isArray(d.roots) && d.roots[0]) fc.cwd = d.roots[0];
  fc.app = "desktop";
  if (d.model) fc.model = d.model;
  if (d.title && fc.live) fc.live.title = d.title;

  if (ev === "SessionStart") {
    const existing = usage.meta.get(sid);
    usage.noteMeta(fc, sid, {
      title: d.title || existing?.title || "",
      cwd: fc.cwd,
      app: "desktop",
      model: fc.model || existing?.model || "",
      lastAt: existing?.lastAt || ms,
      ...(fc.parentSid ? { parentSid: fc.parentSid } : {}),
      ...(fc.isSubagent ? { isSubagent: true } : {}),
    });
    return;
  }

  if (usage.stale("trae", ms)) return;
  if (ev === "PreCompact" || ev === "PostCompact") return;

  const { key, day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd, "desktop");
  const v = usage.liveOf(fc, sid, ms);
  v.cwd = fc.cwd;
  v.app = "desktop";
  if (fc.model) v.model = fc.model;
  if (d.title && !v.title) v.title = d.title;

  if (ev === "UserPromptSubmit") {
    ts.openTools.clear();
    const ask = cleanUserPrompt(d.prompt || "");
    if (isPromptText(ask)) {
      day.prompts++;
      startRound(fc, ms, d.prompt || "", String(ms));
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
      const line = ask.replace(/\s+/g, " ").trim();
      if (s.text.length < 300) s.text += (s.text ? " / " : "") + line.slice(0, 300 - s.text.length);
    }
    v.state = "run";
    v.err = "";
    v.step = "";
  } else if (ev === "PreToolUse") {
    const callId = String(d.callId || `t:${ms}:${d.tool || ""}`);
    if (!ts.closedTools.has(callId)) {
      const step = stepText(d.tool, d.input);
      ts.openTools.set(callId, { name: d.tool || "", step, at: ms });
      v.step = step;
    }
    v.state = "run";
  } else if (ev === "PostToolUse") {
    const callId = String(d.callId || "");
    if (callId) {
      ts.openTools.delete(callId);
      ts.closedTools.add(callId);
    }
    const nextOpen = [...ts.openTools.values()].at(-1);
    v.step = nextOpen ? nextOpen.step : "";
    v.state = "run";
  } else if (ev === "Notification") {
    if (/permission|approv|confirm/i.test(String(d.notificationType || ""))) {
      v.state = "needs-approval";
      v.step = "";
    }
  } else if (ev === "Stop") {
    ts.openTools.clear();
    v.step = "";
    if (d.text && String(d.text).trim()) v.lastText = String(d.text);
    const status = String(d.status || d.stopReason || "").toLowerCase();
    if (/error|failed/.test(status)) {
      v.state = "error";
      v.err = String(d.error || status).slice(0, 120);
    } else {
      v.state = "wait";
      v.err = "";
    }
    finishRound(fc, ms, v.lastText, v.state === "wait");
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
    const tokDelta = applyTraeTokens(usage, fc, sid, key, s.proj, v.model || fc.model, ms, d);
    if (tokDelta) {
      const meta = usage.meta.get(sid) || {};
      usage.noteMeta(fc, sid, {
        title: v.title || meta.title || "",
        text: s.text || meta.text || "",
        cwd: v.cwd || meta.cwd || "",
        app: "desktop",
        model: tokDelta.m.model,
        lastAt: Math.max(ms, meta.lastAt || 0),
        out: (meta.out || 0) - tokDelta.prev.out + tokDelta.m.out,
        fresh: (meta.fresh || 0) - tokDelta.prev.fresh + tokDelta.m.fresh,
        cached: (meta.cached || 0) - tokDelta.prev.cached + tokDelta.m.cached,
        calls: (meta.calls || 0) + (tokDelta.isNew ? 1 : 0),
        ...(fc.parentSid ? { parentSid: fc.parentSid } : {}),
        ...(fc.isSubagent ? { isSubagent: true } : {}),
        state: v.state,
        step: "",
        turns: v.turns,
        rounds: v.rounds,
        lastText: v.lastText || "",
        err: v.err || "",
      });
      return;
    }
  }

  const meta = usage.meta.get(sid) || {};
  const parentSid = fc.parentSid || meta.parentSid || "";
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

export function buildTraeConversation(eventsText) {
  const events = [];
  for (const line of String(eventsText || "").split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    events.push(d);
  }
  events.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));

  const turns = [];
  const seenDedup = new Set();

  const getTurn = (d) => {
    let cur = turns[turns.length - 1];
    if (!cur || cur.stopped) {
      cur = { at: Number(d.at) || 0, prompt: "", text: "", texts: [], tools: [], toolById: new Map(), status: "", stopped: false, endAt: 0 };
      turns.push(cur);
    }
    return cur;
  };

  for (const d of events) {
    const dk = eventDedupKey(d);
    if (seenDedup.has(dk)) continue;
    seenDedup.add(dk);
    const ev = String(d.event || d.hook_event_name || "");
    const ms = Number(d.at) || 0;

    if (ev === "UserPromptSubmit") {
      const ask = cleanUserPrompt(d.prompt || "");
      const turn = { at: ms, prompt: ask, text: "", texts: [], tools: [], toolById: new Map(), status: "", stopped: false, endAt: 0 };
      turns.push(turn);
      continue;
    }

    if (ev === "PreToolUse" || ev === "PostToolUse") {
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
      if (ev === "PreToolUse") {
        if (!tool.at || ms < tool.at) tool.at = ms;
      } else {
        tool.status = d.toolSuccess === false ? "error" : "success";
        tool.output = String(d.output || "");
        tool.outputTruncated = !!d.outputTruncated;
        tool.outputLength = Number(d.outputLength) || tool.output.length;
        if (d.toolSuccess === false) tool.error = tool.output.slice(0, 200) || "failed";
        tool.durationMs = Number(d.durationMs) || (tool.at && ms >= tool.at ? ms - tool.at : 0);
        tool.endAt = ms;
      }
    } else if (ev === "Stop") {
      const turn = getTurn(d);
      turn.stopped = true;
      turn.status = String(d.status || d.stopReason || "");
      const txt = String(d.text || "").trim();
      if (txt && !turn.texts.includes(txt)) turn.texts.push(txt);
      turn.text = turn.texts.join("\n\n");
      turn.endAt = Math.max(turn.endAt || 0, ms);
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
