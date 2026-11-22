// Gemini CLI (`@google/gemini-cli`) read-only local session tracker.
//
// Reads `~/.gemini/tmp/<projectSlug>/chats/session-*.jsonl` (v0.70+) and
// legacy `session-*.json`, resolving project `cwd` via `~/.gemini/projects.json`
// or `<projectDir>/.project_root`.
// Strips injected `<session_context>` and `<hook_context>` blocks from user
// messages and reads token counts strictly from `tokens` without estimation.

import fs from "fs";
import path from "path";
import os from "os";

const expandHome = (p, homeDir) => String(p || "").replace(/^~(?=\/)/, homeDir);

export function geminiCliHome(homeDir = os.homedir(), env = process.env) {
  if (env?.GEMINI_CLI_HOME) return expandHome(env.GEMINI_CLI_HOME, homeDir);
  return path.join(homeDir, ".gemini");
}

function parseIsoMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

export function stripGeminiInjectedContext(text) {
  return String(text || "")
    .replace(/<session_context>[\s\S]*?<\/session_context>/gi, "")
    .replace(/<hook_context>[\s\S]*?<\/hook_context>/gi, "")
    .trim();
}

export function extractGeminiText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === "string") {
      if (part.trim()) parts.push(part.trim());
      continue;
    }
    if (typeof part === "object" && typeof part.text === "string" && part.text.trim()) {
      parts.push(part.text.trim());
    }
  }
  return parts.join("\n").trim();
}

function loadProjectMap(baseDir) {
  const map = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(baseDir, "projects.json"), "utf8"));
    const projects = raw?.projects;
    if (projects && typeof projects === "object") {
      for (const [absPath, slug] of Object.entries(projects)) {
        if (typeof slug === "string" && slug.trim() && typeof absPath === "string" && absPath.trim()) {
          map.set(slug.trim(), absPath.trim());
        }
      }
    }
  } catch { /* optional */ }
  return map;
}

export function discoverGeminiCliSessions(opts = {}) {
  const baseDir = opts.baseDir || geminiCliHome(opts.homeDir, opts.env);
  const tmpDir = path.join(baseDir, "tmp");
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { baseDir, sessions: [] };
  }

  const projectMap = loadProjectMap(baseDir);
  const sessions = [];

  for (const ent of projectDirs) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const slug = ent.name;
    const projDir = path.join(tmpDir, slug);
    const chatsDir = path.join(projDir, "chats");
    let files;
    try {
      files = fs.readdirSync(chatsDir);
    } catch {
      continue;
    }

    let cwd = projectMap.get(slug) || "";
    if (!cwd) {
      try { cwd = fs.readFileSync(path.join(projDir, ".project_root"), "utf8").trim(); } catch { /* optional */ }
    }

    for (const name of files) {
      if (!name.startsWith("session-") || (!name.endsWith(".jsonl") && !name.endsWith(".json"))) continue;
      const filePath = path.join(chatsDir, name);
      let st;
      try { st = fs.statSync(filePath); } catch { continue; }
      if (!st.isFile() || st.size <= 0) continue;
      sessions.push({
        slug,
        cwd,
        filePath,
        isJsonl: name.endsWith(".jsonl"),
        mtimeMs: st.mtimeMs || 0,
        size: st.size || 0,
      });
    }
  }

  sessions.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.filePath.localeCompare(b.filePath));
  return { baseDir, sessions };
}

function normalizeTokens(tok) {
  if (!tok || typeof tok !== "object") return null;
  const rawInput = Number(tok.input || 0) || 0;
  const cached = Math.max(0, Number(tok.cached || 0) || 0);
  const inp = Math.max(0, rawInput - cached);
  const out = Math.max(0, (Number(tok.output || 0) || 0) + (Number(tok.thoughts || 0) || 0));
  if (!inp && !cached && !out) return null;
  return { inp, cache: cached, out };
}

export function parseGeminiCliSession(rawText, fallback = {}) {
  let meta = {};
  let rawMessages = [];

  const trimmed = String(rawText || "").trim();
  if (!trimmed) return null;

  if (!fallback.isJsonl && trimmed.startsWith("{") && !trimmed.includes("\n{")) {
    try {
      const doc = JSON.parse(trimmed);
      if (doc && typeof doc === "object" && Array.isArray(doc.messages)) {
        meta = doc;
        rawMessages = doc.messages;
      }
    } catch { /* fall through to JSONL */ }
  }

  if (!rawMessages.length) {
    const byId = new Map();
    const order = [];
    for (const rawLine of trimmed.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || typeof rec !== "object") continue;

      if (typeof rec.sessionId === "string" && !rec.$patch && !rec.$set) {
        meta = { ...meta, ...rec };
        continue;
      }
      if (rec.$set && typeof rec.$set === "object") {
        meta = { ...meta, ...rec.$set };
        continue;
      }
      if (typeof rec.$rewindTo === "string") {
        const idx = order.indexOf(rec.$rewindTo);
        if (idx !== -1) {
          const removed = order.splice(idx);
          for (const rid of removed) byId.delete(rid);
        }
        continue;
      }
      if (rec.$patch && typeof rec.$patch === "object" && typeof rec.id === "string") {
        const cur = byId.get(rec.id);
        if (cur) Object.assign(cur, rec.$patch);
        continue;
      }
      if (typeof rec.id === "string") {
        if (!byId.has(rec.id)) order.push(rec.id);
        byId.set(rec.id, { ...rec });
      }
    }
    rawMessages = order.map((id) => byId.get(id)).filter(Boolean);
  }

  const sid = String(meta.sessionId || fallback.id || path.basename(fallback.filePath || "").replace(/\.(jsonl|json)$/, "")).trim();
  if (!sid) return null;

  let startedAt = parseIsoMs(meta.startTime);
  let lastAt = parseIsoMs(meta.lastUpdated);
  let model = "";
  let lastStep = "";
  let lastRole = "";
  let lastError = "";
  const entries = [];
  const usages = [];

  const touch = (at) => {
    if (!at) return;
    if (!startedAt || at < startedAt) startedAt = at;
    if (at > lastAt) lastAt = at;
  };

  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const at = parseIsoMs(m.timestamp) || lastAt || startedAt;
    if (at) touch(at);
    if (typeof m.model === "string" && m.model.trim()) model = m.model.trim();

    if (m.type === "user") {
      const text = stripGeminiInjectedContext(extractGeminiText(m.content));
      if (!text) continue;
      lastRole = "user";
      lastError = "";
      entries.push({ id: String(m.id || `u-${entries.length}`), role: "user", at, text, tools: [] });
    } else if (m.type === "gemini") {
      const text = extractGeminiText(m.content);
      const tools = Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => ({ name: String(tc?.name || tc?.displayName || "").trim() })).filter((tc) => tc.name)
        : [];
      if (tools.length) lastStep = tools[tools.length - 1].name;
      const u = normalizeTokens(m.tokens);
      if (u) {
        usages.push({
          id: String(m.id || `g-${usages.length}`),
          at,
          model: String(m.model || model || "").trim(),
          ...u,
        });
      }
      if (text || tools.length) {
        lastRole = "assistant";
        lastError = "";
        entries.push({ id: String(m.id || `a-${entries.length}`), role: "assistant", at, text, tools });
      }
    } else if (m.type === "error") {
      const errText = extractGeminiText(m.content);
      if (errText) lastError = errText.slice(0, 200);
    }
  }

  if (!startedAt && fallback.mtimeMs) startedAt = fallback.mtimeMs;
  if (!lastAt && fallback.mtimeMs) lastAt = fallback.mtimeMs;

  const summary = String(meta.summary || "").replace(/\s+/g, " ").trim();
  const firstUser = entries.find((e) => e.role === "user" && e.text);
  const title = summary || (firstUser ? firstUser.text.replace(/\s+/g, " ").trim().slice(0, 48) : "Gemini CLI");
  const state = lastError && lastRole !== "assistant" ? "error" : "wait";

  return {
    id: sid,
    title,
    hasClientTitle: Boolean(summary),
    cwd: String(fallback.cwd || "").trim(),
    model,
    startedAt,
    lastAt,
    state,
    err: state === "error" ? lastError : "",
    lastStep: "",
    entries,
    usages,
  };
}

export function buildGeminiCliConversation(source) {
  const filePath = String(source || "").split("#")[0];
  if (!filePath) return [];
  let rawText = "";
  try { rawText = fs.readFileSync(filePath, "utf8"); } catch { return []; }
  const parsed = parseGeminiCliSession(rawText, { filePath, isJsonl: filePath.endsWith(".jsonl") });
  if (!parsed) return [];
  const out = [];
  for (const e of parsed.entries) {
    const parts = [];
    if (e.text) parts.push(e.text);
    if (e.tools?.length) parts.push(e.tools.map((t) => `[tool: ${t.name}]`).join(" "));
    const text = parts.join("\n\n").trim();
    if (!text) continue;
    out.push({ role: e.role, at: e.at, text });
  }
  return out;
}
