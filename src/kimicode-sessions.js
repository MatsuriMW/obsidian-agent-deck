// Kimi Code (`com.kimi.code.desktop` / `~/.kimi-code`) & Kimi CLI (`~/.kimi`)
// read-only session collector and transcript normalizer.
//
// Reads `<baseDir>/sessions/<wsHash>/<sessionId>/wire.jsonl` alongside optional
// `session-meta/state.json` and `<baseDir>/workspaces.json`.
// Token usage is read strictly from `step.end` / `status_update` usage fields
// without estimation when absent.

import fs from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";

const expandHome = (p, homeDir) => String(p || "").replace(/^~(?=[\\/])/, homeDir);

export function kimiCodeDataDirs(homeDir = os.homedir(), env = process.env) {
  const dirs = [];
  const push = (p) => {
    const clean = expandHome(p, homeDir).trim();
    if (clean && !dirs.includes(clean)) dirs.push(clean);
  };
  if (env?.KIMI_CODE_HOME) push(env.KIMI_CODE_HOME);
  push(path.join(homeDir, ".kimi-code"));
  if (env?.KIMI_HOME) push(env.KIMI_HOME);
  push(path.join(homeDir, ".kimi"));
  return dirs;
}

export function kimiCodeTime(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return kimiCodeTime(num);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function statFileSafe(filePath) {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function resolveKimiWireFile(sessionDir) {
  const candidates = [
    path.join(sessionDir, "agents", "main", "wire.jsonl"),
    path.join(sessionDir, "wire.jsonl"),
  ];
  for (const p of candidates) {
    const st = statFileSafe(p);
    if (st) return { wirePath: p, wireStat: st };
  }
  const agentsDir = path.join(sessionDir, "agents");
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const p = path.join(agentsDir, ent.name, "wire.jsonl");
      const st = statFileSafe(p);
      if (st) return { wirePath: p, wireStat: st };
    }
  } catch { /* no agents dir */ }
  return { wirePath: "", wireStat: null };
}

function resolveKimiMetaFile(sessionDir) {
  const candidates = [
    path.join(sessionDir, "state.json"),
    path.join(sessionDir, "session-meta", "state.json"),
    path.join(sessionDir, "metadata.json"),
  ];
  for (const p of candidates) {
    const st = statFileSafe(p);
    if (st) return { metaPath: p, metaStat: st };
  }
  return { metaPath: "", metaStat: null };
}

function resolveKimiSessionDirFromWire(filePath) {
  const dir = path.dirname(filePath);
  const parent = path.dirname(dir);
  if (path.basename(parent) === "agents") return path.dirname(parent);
  return dir;
}

function loadWorkspaceMap(baseDir) {
  const map = new Map();
  // 1. Kimi Code Desktop v2: projects.json
  const projectsData = readJsonSafe(path.join(baseDir, "projects.json"));
  const projects = projectsData?.projects;
  if (projects && typeof projects === "object") {
    for (const [id, entry] of Object.entries(projects)) {
      if (!entry || typeof entry !== "object") continue;
      const dir = String(entry.root || entry.path || entry.dir || entry.workdir || "").trim();
      if (dir) map.set(id, dir);
    }
  }
  // 2. Kimi Code Desktop v1: workspaces.json
  const wsData = readJsonSafe(path.join(baseDir, "workspaces.json"));
  const ws = wsData?.workspaces;
  if (ws && typeof ws === "object") {
    for (const [id, entry] of Object.entries(ws)) {
      if (!entry || typeof entry !== "object") continue;
      const dir = String(entry.path || entry.dir || entry.workdir || entry.root || "").trim();
      if (dir) {
        if (!map.has(id)) map.set(id, dir);
        if (entry.hash && !map.has(String(entry.hash))) map.set(String(entry.hash), dir);
        if (entry.id && !map.has(String(entry.id))) map.set(String(entry.id), dir);
      }
    }
  }
  // 3. Kimi CLI: kimi.json work_dirs (hashed via md5 of path)
  const kimiJson = readJsonSafe(path.join(baseDir, "kimi.json"));
  if (Array.isArray(kimiJson?.work_dirs)) {
    for (const entry of kimiJson.work_dirs) {
      const dir = String(entry?.path || entry?.dir || "").trim();
      if (!dir) continue;
      const hash = createHash("md5").update(dir).digest("hex");
      if (!map.has(hash)) map.set(hash, dir);
    }
  }
  return map;
}

export function extractKimiContentText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === "string") {
      if (part.trim()) parts.push(part.trim());
      continue;
    }
    if (typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      parts.push(part.text.trim());
    } else if (part.type === "image_url") {
      parts.push("[image]");
    } else if (part.type === "audio_url") {
      parts.push("[audio]");
    } else if (part.type === "video_url") {
      parts.push("[video]");
    }
  }
  return parts.join("\n").trim();
}

function normalizeUsage(u) {
  if (!u || typeof u !== "object") return null;
  const inputOther = Number(u.inputOther ?? u.input_other ?? 0) || 0;
  const inputCacheCreation = Number(u.inputCacheCreation ?? u.input_cache_creation ?? 0) || 0;
  const inputCacheRead = Number(u.inputCacheRead ?? u.input_cache_read ?? 0) || 0;
  const output = Number(u.output ?? u.output_tokens ?? u.completion_tokens ?? 0) || 0;
  const promptFallback = Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
  const inp = (inputOther + inputCacheCreation) || Math.max(0, promptFallback - inputCacheRead);
  const cache = Math.max(0, inputCacheRead);
  const out = Math.max(0, output);
  if (!inp && !cache && !out) return null;
  return { inp, cache, out };
}

export function discoverKimiCodeSessions(opts = {}) {
  const dirs = opts.baseDirs
    ? opts.baseDirs
    : opts.baseDir
      ? [opts.baseDir]
      : kimiCodeDataDirs(opts.homeDir, opts.env);

  const sessions = [];
  const seen = new Set();

  for (const baseDir of dirs) {
    const sessionsRoot = path.join(baseDir, "sessions");
    let wsEntries;
    try {
      wsEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const wsMap = loadWorkspaceMap(baseDir);

    for (const wsEnt of wsEntries) {
      if (!wsEnt.isDirectory() || wsEnt.name.startsWith(".")) continue;
      const wsDir = path.join(sessionsRoot, wsEnt.name);
      let sessEntries;
      try {
        sessEntries = fs.readdirSync(wsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const sEnt of sessEntries) {
        if (!sEnt.isDirectory() || sEnt.name.startsWith(".")) continue;
        const sessionId = sEnt.name;
        const sessionDir = path.join(wsDir, sessionId);
        const { wirePath, wireStat } = resolveKimiWireFile(sessionDir);
        const { metaPath, metaStat } = resolveKimiMetaFile(sessionDir);
        if (!wireStat && !metaStat) continue;

        const key = `${wsEnt.name}/${sessionId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const meta = metaStat ? readJsonSafe(metaPath) : null;
        const cwd = String(
          meta?.workspaceDir || meta?.workdir || meta?.workDir || meta?.cwd || wsMap.get(wsEnt.name) || "",
        ).trim();
        const mtimeMs = Math.max(wireStat?.mtimeMs || 0, metaStat?.mtimeMs || 0);
        const size = (wireStat?.size || 0) + (metaStat?.size || 0);

        sessions.push({
          id: sessionId,
          wsHash: wsEnt.name,
          sessionDir,
          wirePath,
          metaPath,
          meta,
          cwd,
          mtimeMs,
          size,
          app: /[\\/]\.kimi-code$/i.test(baseDir) ? "desktop" : "cli",
        });
      }
    }
  }

  sessions.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.id.localeCompare(b.id));
  return { sessions };
}

export function parseKimiCodeSession(wireText, meta = {}, fallback = {}) {
  const entries = [];
  const usages = [];
  const openSteps = new Map();
  let cliStepKey = "";
  let cliStepSeq = 0;
  let startedAt = kimiCodeTime(meta?.createdAt || meta?.created_at);
  let lastAt = kimiCodeTime(meta?.updatedAt || meta?.updated_at);
  let model = String(meta?.model || meta?.modelAlias || "").trim();
  let title = String(meta?.title || "").trim();
  if (title === "New Session") title = "";
  const isCustomTitle = Boolean((meta?.isCustomTitle || meta?.titleKind === "custom") && title);
  let cwd = String(meta?.workspaceDir || meta?.workdir || meta?.workDir || meta?.cwd || fallback.cwd || "").trim();
  let lastStep = "";
  let inTurn = false;
  let lastRole = "";
  let lineIdx = 0;
  let lastAnonUsage = null;

  const touch = (at) => {
    if (!at) return;
    if (!startedAt || at < startedAt) startedAt = at;
    if (at > lastAt) lastAt = at;
  };

  const closeCliStep = () => {
    if (!cliStepKey) return;
    const step = openSteps.get(cliStepKey);
    openSteps.delete(cliStepKey);
    cliStepKey = "";
    if (!step) return;
    const text = step.texts.join("").trim();
    if (text || step.tools.length) {
      lastRole = "assistant";
      entries.push({
        id: `cli-${cliStepSeq}`,
        role: "assistant",
        at: step.at || lastAt,
        text,
        tools: step.tools,
        finishReason: "stop",
      });
    }
  };

  const ensureCliStep = (at) => {
    if (cliStepKey && openSteps.has(cliStepKey)) return openSteps.get(cliStepKey);
    cliStepSeq += 1;
    cliStepKey = `cli-step-${cliStepSeq}`;
    const step = { at, texts: [], tools: [] };
    openSteps.set(cliStepKey, step);
    return step;
  };

  const handleLoopEvent = (ev, at) => {
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "step.begin": {
        if (ev.uuid) openSteps.set(ev.uuid, { at, texts: [], tools: [] });
        inTurn = true;
        break;
      }
      case "content.part": {
        const step = ev.stepUuid ? openSteps.get(ev.stepUuid) : null;
        const part = ev.part;
        if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
          if (step) step.texts.push(part.text);
        }
        break;
      }
      case "tool.call": {
        const name = String(ev.name || "").trim();
        if (name) {
          lastStep = name;
          const step = ev.stepUuid ? openSteps.get(ev.stepUuid) : null;
          if (step) step.tools.push({ name, args: ev.args });
        }
        break;
      }
      case "step.end": {
        const step = ev.uuid ? openSteps.get(ev.uuid) : null;
        if (ev.uuid) openSteps.delete(ev.uuid);
        const u = normalizeUsage(ev.usage);
        if (u) {
          const rec = {
            id: String(ev.messageId || ev.uuid || `step-${lineIdx}`),
            at,
            model: String(ev.model || model || "").trim(),
            ...u,
          };
          // Kimi Code v2 emits `usage.record` (without messageId) immediately before `step.end` with identical counts.
          if (
            lastAnonUsage &&
            lastAnonUsage.idx === usages.length - 1 &&
            lastAnonUsage.inp === u.inp &&
            lastAnonUsage.cache === u.cache &&
            lastAnonUsage.out === u.out &&
            Math.abs((at || 0) - (lastAnonUsage.at || 0)) <= 2000
          ) {
            usages[lastAnonUsage.idx] = rec;
          } else {
            usages.push(rec);
          }
          lastAnonUsage = null;
        }
        const text = step ? step.texts.join("").trim() : "";
        const tools = step ? step.tools : [];
        if (text || tools.length) {
          lastRole = "assistant";
          entries.push({
            id: String(ev.messageId || ev.uuid || `a-${lineIdx}`),
            role: "assistant",
            at,
            text,
            tools,
            finishReason: String(ev.finishReason || ""),
          });
        }
        break;
      }
      default:
        break;
    }
  };

  const lines = String(wireText || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    lineIdx += 1;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== "object") continue;

    // Normalize Kimi CLI `{ timestamp, message: { type, payload } }` and `{ event, ... }` envelopes
    let msgType = d.type;
    let payload = d;
    if (!msgType && d.message && typeof d.message === "object" && typeof d.message.type === "string") {
      msgType = d.message.type;
      payload = d.message.payload && typeof d.message.payload === "object" ? d.message.payload : d.message;
    } else if (!msgType && typeof d.event === "string") {
      msgType = d.event;
      payload = d;
    }

    const at = kimiCodeTime(d.time ?? d.timestamp ?? d.created_at ?? d.createdAt ?? payload.time ?? payload.timestamp) || lastAt || startedAt;
    if (at) touch(at);
    const evModel = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim()
      : (typeof payload.modelAlias === "string" && payload.modelAlias.trim() ? payload.modelAlias.trim()
        : (typeof d.model === "string" && d.model.trim() ? d.model.trim()
          : (typeof d.modelAlias === "string" && d.modelAlias.trim() ? d.modelAlias.trim() : "")));
    if (evModel) model = evModel;
    const evCwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd.trim()
      : (typeof d.cwd === "string" && d.cwd.trim() ? d.cwd.trim() : "");
    if (evCwd && !cwd) cwd = evCwd;

    switch (msgType) {
      case "metadata": {
        const created = kimiCodeTime(payload.created_at ?? d.created_at);
        if (created) touch(created);
        break;
      }
      case "turn_begin":
      case "TurnBegin": {
        const userInput = payload.user_input ?? payload.userInput ?? d.userInput ?? d.user_input;
        const text = typeof userInput === "string" ? userInput.trim() : extractKimiContentText(userInput);
        inTurn = true;
        if (text) {
          lastRole = "user";
          entries.push({ id: `u-${lineIdx}`, role: "user", at, text, tools: [] });
        }
        break;
      }
      case "turn.prompt": {
        if (payload.origin?.kind && payload.origin.kind !== "user") break;
        const text = extractKimiContentText(payload.input);
        inTurn = true;
        if (text) {
          lastRole = "user";
          entries.push({ id: `u-${lineIdx}`, role: "user", at, text, tools: [] });
        }
        break;
      }
      case "context.append_message": {
        const m = payload.message;
        if (!m || typeof m !== "object") break;
        if (m.origin?.kind === "injection" || m.origin?.kind === "compaction_summary") break;
        const text = extractKimiContentText(m.content);
        if (m.role === "user" && text) {
          const prev = entries[entries.length - 1];
          if (!(prev && prev.role === "user" && prev.text === text)) {
            inTurn = true;
            lastRole = "user";
            entries.push({ id: `cm-${lineIdx}`, role: "user", at, text, tools: [] });
          }
        } else if (m.role === "assistant" && text) {
          lastRole = "assistant";
          entries.push({ id: `cm-${lineIdx}`, role: "assistant", at, text, tools: [] });
        }
        break;
      }
      case "context.append_loop_event": {
        handleLoopEvent(payload.event, at);
        break;
      }
      case "context.clear": {
        openSteps.clear();
        cliStepKey = "";
        inTurn = false;
        break;
      }
      case "step.begin":
      case "content.part":
      case "tool.call":
      case "step.end": {
        handleLoopEvent(payload, at);
        break;
      }
      case "StepBegin": {
        closeCliStep();
        inTurn = true;
        ensureCliStep(at);
        break;
      }
      case "ContentPart": {
        if (payload.type === "text" && typeof payload.text === "string") {
          ensureCliStep(at).texts.push(payload.text);
        }
        break;
      }
      case "ToolCall": {
        const name = String(payload.function?.name || payload.name || "").trim();
        if (name) {
          lastStep = name;
          let args = payload.args ?? payload.function?.arguments;
          if (typeof args === "string") {
            try { args = JSON.parse(args); } catch { /* keep raw */ }
          }
          ensureCliStep(at).tools.push({ name, args });
        }
        break;
      }
      case "usage.record": {
        const u = normalizeUsage(payload.usage);
        if (u) {
          const hasId = Boolean(payload.messageId || payload.id);
          usages.push({
            id: String(payload.messageId || payload.id || `ur-${lineIdx}`),
            at,
            model: evModel || model || "",
            ...u,
          });
          lastAnonUsage = !hasId ? { idx: usages.length - 1, at, ...u } : null;
        }
        break;
      }
      case "turn.end":
      case "turn.ended":
      case "turn_end":
      case "TurnEnd": {
        closeCliStep();
        inTurn = false;
        break;
      }
      case "status_update":
      case "StatusUpdate": {
        const u = normalizeUsage(payload.token_usage || payload.usage);
        if (u) {
          usages.push({
            id: String(payload.message_id || `su-${lineIdx}`),
            at,
            model: evModel || model || "",
            ...u,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Flush any still-open streaming step
  for (const [uuid, step] of openSteps) {
    const text = step.texts.join("").trim();
    if (text || step.tools.length) {
      lastRole = "assistant";
      entries.push({ id: `open-${uuid}`, role: "assistant", at: lastAt || step.at, text, tools: step.tools, streaming: true });
    }
  }

  if (!entries.length && meta?.lastPrompt) {
    const at = lastAt || startedAt || fallback.mtimeMs || 0;
    if (at) {
      touch(at);
      entries.push({ id: "meta-prompt", role: "user", at, text: String(meta.lastPrompt).trim(), tools: [] });
    }
  }

  if (!startedAt && fallback.mtimeMs) startedAt = fallback.mtimeMs;
  if (!lastAt && fallback.mtimeMs) lastAt = fallback.mtimeMs;

  if (!title) {
    const firstUser = entries.find((e) => e.role === "user" && e.text);
    if (firstUser) title = firstUser.text.replace(/\s+/g, " ").trim().slice(0, 48);
  }

  const state = (openSteps.size > 0 || (inTurn && lastRole === "user")) ? "run" : "wait";

  return {
    id: fallback.id || "",
    title: title || fallback.id || "Kimi Code",
    hasClientTitle: isCustomTitle || Boolean(meta?.title && meta.title !== "New Session"),
    cwd,
    model,
    archived: Boolean(meta?.archived || meta?.archivedAt),
    startedAt,
    lastAt,
    state,
    lastStep: state === "run" ? lastStep : "",
    entries,
    usages,
  };
}

export function buildKimiCodeConversation(source) {
  const filePath = String(source || "").split("#")[0];
  if (!filePath) return [];
  let wireText = "";
  try { wireText = fs.readFileSync(filePath, "utf8"); } catch { return []; }
  const sessionDir = resolveKimiSessionDirFromWire(filePath);
  const { metaPath } = resolveKimiMetaFile(sessionDir);
  const meta = (metaPath ? readJsonSafe(metaPath) : null) || {};
  const parsed = parseKimiCodeSession(wireText, meta);
  const out = [];
  for (const e of parsed.entries) {
    const parts = [];
    if (e.text) parts.push(e.text);
    if (e.tools?.length) {
      parts.push(e.tools.map((tool) => `[tool: ${tool.name}]`).join(" "));
    }
    const text = parts.join("\n\n").trim();
    if (!text) continue;
    out.push({ role: e.role, at: e.at, text });
  }
  return out;
}
