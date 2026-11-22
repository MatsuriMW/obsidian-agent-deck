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

const expandHome = (p, homeDir) => String(p || "").replace(/^~(?=\/)/, homeDir);

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

function loadWorkspaceMap(baseDir) {
  const map = new Map();
  const data = readJsonSafe(path.join(baseDir, "workspaces.json"));
  const ws = data?.workspaces;
  if (!ws || typeof ws !== "object") return map;
  for (const [id, entry] of Object.entries(ws)) {
    if (!entry || typeof entry !== "object") continue;
    const dir = String(entry.path || entry.dir || entry.workdir || entry.root || "").trim();
    if (dir) {
      map.set(id, dir);
      if (entry.hash) map.set(String(entry.hash), dir);
      if (entry.id) map.set(String(entry.id), dir);
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
        const wirePath = path.join(sessionDir, "wire.jsonl");
        const metaPath = path.join(sessionDir, "session-meta", "state.json");

        let wireStat = null;
        try { wireStat = fs.statSync(wirePath); } catch { /* may not exist yet */ }
        let metaStat = null;
        try { metaStat = fs.statSync(metaPath); } catch { /* optional */ }
        if (!wireStat && !metaStat) continue;

        const key = `${wsEnt.name}/${sessionId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const meta = metaStat ? readJsonSafe(metaPath) : null;
        const cwd = String(
          meta?.workspaceDir || meta?.workdir || meta?.cwd || wsMap.get(wsEnt.name) || "",
        ).trim();
        const mtimeMs = Math.max(wireStat?.mtimeMs || 0, metaStat?.mtimeMs || 0);
        const size = (wireStat?.size || 0) + (metaStat?.size || 0);

        sessions.push({
          id: sessionId,
          wsHash: wsEnt.name,
          sessionDir,
          wirePath: wireStat ? wirePath : "",
          metaPath: metaStat ? metaPath : "",
          meta,
          cwd,
          mtimeMs,
          size,
          app: baseDir.endsWith(".kimi-code") ? "desktop" : "cli",
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
  let startedAt = kimiCodeTime(meta?.createdAt || meta?.created_at);
  let lastAt = kimiCodeTime(meta?.updatedAt || meta?.updated_at);
  let model = String(meta?.model || meta?.modelAlias || "").trim();
  let title = String(meta?.title || "").trim();
  if (title === "New Session") title = "";
  const isCustomTitle = Boolean(meta?.isCustomTitle && title);
  let cwd = String(meta?.workspaceDir || meta?.workdir || meta?.cwd || fallback.cwd || "").trim();
  let lastStep = "";
  let inTurn = false;
  let lastRole = "";
  let lineIdx = 0;

  const touch = (at) => {
    if (!at) return;
    if (!startedAt || at < startedAt) startedAt = at;
    if (at > lastAt) lastAt = at;
  };

  const lines = String(wireText || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    lineIdx += 1;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== "object") continue;

    const at = kimiCodeTime(d.time ?? d.timestamp ?? d.created_at ?? d.createdAt) || lastAt || startedAt;
    if (at) touch(at);
    if (typeof d.model === "string" && d.model.trim()) model = d.model.trim();
    if (typeof d.cwd === "string" && d.cwd.trim() && !cwd) cwd = d.cwd.trim();

    switch (d.type) {
      case "metadata": {
        const created = kimiCodeTime(d.created_at);
        if (created) touch(created);
        break;
      }
      case "turn_begin": {
        const text = typeof d.userInput === "string" ? d.userInput.trim() : extractKimiContentText(d.userInput);
        inTurn = true;
        if (text) {
          lastRole = "user";
          entries.push({ id: `u-${lineIdx}`, role: "user", at, text, tools: [] });
        }
        break;
      }
      case "turn.prompt": {
        if (d.origin?.kind && d.origin.kind !== "user") break;
        const text = extractKimiContentText(d.input);
        inTurn = true;
        if (text) {
          lastRole = "user";
          entries.push({ id: `u-${lineIdx}`, role: "user", at, text, tools: [] });
        }
        break;
      }
      case "context.append_message": {
        const m = d.message;
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
      case "step.begin": {
        if (d.uuid) {
          openSteps.set(d.uuid, { at, texts: [], tools: [] });
        }
        inTurn = true;
        break;
      }
      case "content.part": {
        const step = d.stepUuid ? openSteps.get(d.stepUuid) : null;
        const part = d.part;
        if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
          if (step) step.texts.push(part.text);
        }
        break;
      }
      case "tool.call": {
        const name = String(d.name || "").trim();
        if (name) {
          lastStep = name;
          const step = d.stepUuid ? openSteps.get(d.stepUuid) : null;
          if (step) step.tools.push({ name, args: d.args });
        }
        break;
      }
      case "step.end": {
        const step = d.uuid ? openSteps.get(d.uuid) : null;
        if (d.uuid) openSteps.delete(d.uuid);
        const u = normalizeUsage(d.usage);
        if (u) {
          usages.push({
            id: String(d.messageId || d.uuid || `step-${lineIdx}`),
            at,
            model: String(d.model || model || "").trim(),
            ...u,
          });
        }
        const text = step ? step.texts.join("").trim() : "";
        const tools = step ? step.tools : [];
        if (text || tools.length) {
          lastRole = "assistant";
          entries.push({
            id: String(d.messageId || d.uuid || `a-${lineIdx}`),
            role: "assistant",
            at,
            text,
            tools,
            finishReason: String(d.finishReason || ""),
          });
        }
        break;
      }
      case "turn.end":
      case "turn_end": {
        inTurn = false;
        break;
      }
      case "status_update":
      case "StatusUpdate": {
        const u = normalizeUsage(d.token_usage || d.usage);
        if (u) {
          usages.push({
            id: `su-${lineIdx}`,
            at,
            model: String(d.model || model || "").trim(),
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
  const sessionDir = path.dirname(filePath);
  const meta = readJsonSafe(path.join(sessionDir, "session-meta", "state.json")) || {};
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
