// Agent Deck — local session-log readers.
//
// Everything here is read-only: Claude Code / Codex / WorkBuddy / DeepSeek Harness
// session logs are parsed into per-day usage and a live session index. Nothing is
// uploaded anywhere.

import fs from "fs";
import path from "path";
import os from "os";
import { decompress } from "fzstd";
import {
  AGENTS, AGENT_ORDER, dayKey, dayKeyToday, deepMerge, fmtTok,
  unionSegs, unionMin, clamp,
} from "./constants.js";

const fsp = fs.promises;
const AI_IDLE = 5;              // minutes between two events still counted as one working span
const LIVE_STALE = 90 * 1000;   // a running session with no new event for this long reads as quiet
const MAX_TS = 20000;
const DSH_TOUCH = new Set(["user/message","assistant/message","tool/call","tool/result","turn/start","turn/end","step/start","step/end"]);

const home = () => os.homedir();
const norm = (p) => String(p || "").replace(/^~(?=\/)/, home());

export function projectName(cwd) {
  if (!cwd) return "?";
  if (/\/WorkBuddy\/\d{4}-\d\d-\d\d/.test(cwd)) return "WorkBuddy";
  if (/\/\.dsh\/sessions\//.test(cwd)) return "DSH";
  const p = String(cwd).split("/.claude/worktrees/")[0].replace(/\/+$/, "");
  return p === home() ? "~" : (p.split("/").pop() || p);
}

export function isPromptText(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/^<(command-|local-command|system-reminder|task-notification|ci-monitor|environment_context)/.test(s)) return false;
  if (/^\[Request interrupted/.test(s)) return false;
  if (/^You are an AI agent powered by/.test(s)) return false;
  return true;
}

export function stepText(name, input) {
  const i = input || {};
  const n = String(name || "");
  const base = (x) => String(x || "").split("/").pop();
  const cut = (x) => { x = String(x || "").replace(/\s+/g, " ").trim(); return x.length > 34 ? x.slice(0, 33) + "…" : x; };
  if (/^(bash|shell|local_shell_call|exec_command|shell_command)$/i.test(n)) return cut(i.description || (Array.isArray(i.command) ? i.command[i.command.length - 1] : i.command || i.cmd) || "跑命令");
  if (/^(edit|multiedit|notebookedit|apply_patch|str_replace_editor)$/i.test(n)) return cut(`改 ${base(i.file_path || i.notebook_path || i.path) || "文件"}`);
  if (/^(write|create_file)$/i.test(n)) return cut(`写 ${base(i.file_path || i.path)}`);
  if (/^(read|view)$/i.test(n)) return cut(`读 ${base(i.file_path || i.path)}`);
  if (/^(grep|glob|search)$/i.test(n)) return cut(`找 ${i.pattern || i.query || ""}`);
  if (/^(agent|task|subagent)$/i.test(n)) return cut(`派出去：${i.description || ""}`);
  if (/^(websearch|web_search)$/i.test(n)) return cut(`搜 ${i.query || ""}`);
  if (/^(webfetch|web_fetch)$/i.test(n)) return "读网页";
  if (n === "Skill") return cut(`用技能 ${i.skill || ""}`);
  if (/^todo/.test(n)) return "整理待办";
  return cut(n.startsWith("mcp__") ? n.split("__").pop() : n);
}

export function todoOf(pairs) {
  if (!pairs || !pairs.length) return null;
  const cur = (pairs.find(([st]) => st === "in_progress") || [])[1] || "";
  return { done: pairs.filter(([st]) => st === "completed").length, total: pairs.length, cur: String(cur).replace(/\s+/g, " ").slice(0, 36) };
}

function cleanLive(v, now = Date.now()) {
  if (!v) return v;
  if (v.state === "run" && now - (v.at || 0) > LIVE_STALE) v.quiet = true;
  else v.quiet = false;
  return v;
}

export class AgentUsage {
  constructor(opts = {}) {
    this.cfg = opts.cfg || {};
    this.settings = opts.settings || {};
    this.files = new Map();      // path -> file cache
    this.meta = new Map();       // sid -> live session meta (merged across files)
    this.titles = new Map();     // codex title index
    this.codexIndexAt = 0;
    this.archived = new Set();
    this.errors = [];
    this.lastScan = 0;
  }

  get primaries() {
    const p = this.settings.primaryAgents;
    const list = Array.isArray(p) ? p : [p].filter(Boolean);
    return list.filter((x) => AGENTS[x]).slice(0, 2);
  }

  isPrimary(agent) { return this.primaries.includes(agent); }

  enabled(agent) {
    if (this.isPrimary(agent)) return true;
    const a = this.settings.agents || {};
    return a[agent] !== false;
  }

  stale(agent, ms) {
    if (this.isPrimary(agent)) return false;
    return dayKey(ms, this.cfg) < dayKeyToday(this.cfg);
  }

  // ----- roots -----
  roots() {
    const h = home();
    const out = [];
    const add = (dir, agent) => { if (this.enabled(agent)) out.push([norm(dir), agent]); };
    add(path.join(h, ".claude/projects"), "claude");
    add(path.join(h, ".config/claude/projects"), "claude");
    for (const d of String(process.env.CLAUDE_CONFIG_DIR || "").split(",").filter(Boolean)) add(path.join(d, "projects"), "claude");
    add(process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "sessions") : path.join(h, ".codex/sessions"), "codex");
    add(process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "archived_sessions") : path.join(h, ".codex/archived_sessions"), "codex");
    add(path.join(h, ".workbuddy/projects"), "workbuddy");
    add(path.join(h, ".dsh/sessions"), "dsh");
    const seen = new Set();
    return out.filter(([d]) => !seen.has(d) && seen.add(d));
  }

  sinceMs() {
    const days = clamp(Number(this.settings.fullHistoryDays) || 14, 1, 365);
    return Date.now() - days * 86400000;
  }

  // ----- scanning -----
  async scan({ since = 0, onProgress } = {}) {
    const touched = new Set();
    const floor = since || this.sinceMs();
    for (const [root, agent] of this.roots()) {
      const files = await this.walk(root, agent === "dsh" ? 4 : 5);
      for (const p of files) {
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        const fc = this.files.get(p);
        if (!fc && st.mtimeMs < floor && !this.isPrimary(agent)) continue;
        if (fc && st.size === fc.size && st.mtimeMs === fc.mtimeMs) continue;
        try {
          if (agent === "dsh") await this.readDsh(p, st, touched);
          else await this.readJsonl(p, agent, st, touched);
        } catch (e) {
          this.errors.push({ path: p, message: String(e && e.message || e) });
          if (this.errors.length > 20) this.errors.shift();
        }
        if (onProgress) onProgress(p);
        await new Promise((r) => setImmediate(r));
      }
    }
    await this.readCodexTitles();
    await this.readCodexArchived();
    this.lastScan = Date.now();
    return touched;
  }

  async walk(dir, depth) {
    const out = [];
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) out.push(...await this.walk(p, depth - 1));
      } else if (e.isFile()) {
        if (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zstd") || e.name.endsWith(".jsonl.zst")) out.push(p);
      }
    }
    return out;
  }

  async readCodexTitles() {
    const p = path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "session_index.jsonl");
    try {
      const st = await fsp.stat(p);
      if (st.mtimeMs === this.codexIndexAt) return;
      this.codexIndexAt = st.mtimeMs;
      const text = await fsp.readFile(p, "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try { const d = JSON.parse(line); if (d.id && d.thread_name) this.titles.set(d.id, String(d.thread_name)); } catch { /* partial line */ }
      }
    } catch { /* no index */ }
  }

  async readCodexArchived() {
    const dir = path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "archived_sessions");
    try {
      for (const f of await fsp.readdir(dir)) {
        const m = /([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(f);
        if (m) this.archived.add(m[1]);
      }
    } catch { /* none */ }
  }

  // ----- file caches -----
  ensureFile(p, agent) {
    let fc = this.files.get(p);
    if (!fc) {
      const base = path.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
      const sid = base.startsWith("session-") ? base : (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
      fc = {
        path: p, agent, size: 0, offset: 0, mtime: 0,
        sid, id: sid, cwd: "", app: base.startsWith("session-") ? "dsh" : "",
        model: "", days: new Map(), msgs: new Map(), titles: new Map(),
        live: null, zstd: p.endsWith(".zstd") || p.endsWith(".zst"),
        sub: "",
      };
      this.files.set(p, fc);
    }
    return fc;
  }

  dayFor(fc, key) {
    let day = fc.days.get(key);
    if (!day) fc.days.set(key, day = { sess: new Map(), prompts: 0 });
    return day;
  }

  touchSess(fc, touched, ms, sid, cwd, app) {
    const key = dayKey(ms, this.cfg);
    touched.add(key);
    const day = this.dayFor(fc, key);
    let s = day.sess.get(sid);
    if (!s) day.sess.set(sid, s = { proj: projectName(cwd), cwd: cwd || "", app: app || "", agent: fc.agent, ts: [], text: "" });
    if (s.ts.length < MAX_TS) s.ts.push(dayMinuteCfg(ms, this.cfg));
    return { key, day, s };
  }

  liveOf(fc, sid, ms) {
    if (!fc.live) fc.live = { sid, agent: fc.agent, at: 0, state: "run", step: "", todo: null, err: "", lastText: "", model: "", title: "" };
    const v = fc.live;
    if (ms >= v.at) { v.at = ms; }
    return v;
  }

  noteMeta(fc, sid, patch) {
    let m = this.meta.get(sid);
    if (!m) this.meta.set(sid, m = { sid, agent: fc.agent, title: "", text: "", cwd: fc.cwd || "", app: fc.app || "", model: "", lastAt: 0, out: 0, fresh: 0, cached: 0, calls: 0, segs: [], state: "idle", step: "", todo: null, err: "", lastText: "", archived: false });
    Object.assign(m, patch);
    if (!m.title && this.titles.has(sid)) m.title = this.titles.get(sid);
    return m;
  }

  // ----- JSONL agents -----
  async readJsonl(p, agent, st, touched) {
    const fc = this.ensureFile(p, agent);
    if (st.size < fc.size) {
      // log was rotated/rewritten: start over
      fc.size = 0; fc.offset = 0; fc.days = new Map(); fc.msgs = new Map(); fc.titles = new Map(); fc.live = null;
    }
    fc.mtime = st.mtimeMs;
    if (st.size === fc.offset) { fc.size = st.size; return; }
    const fh = await fsp.open(p, "r");
    try {
      const len = st.size - fc.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, buf.length, fc.offset);
      fc.size = st.size;
      const end = buf.lastIndexOf(10);
      if (end < 0) return;
      fc.offset += end + 1;
      const lines = buf.toString("utf8", 0, end).split("\n");
      for (let i = 0; i < lines.length; i++) {
        this.ingestJsonl(lines[i], fc, touched);
        if (i % 2000 === 1999) await new Promise((r) => setImmediate(r));
      }
    } finally { await fh.close(); }
  }

  ingestJsonl(line, fc, touched) {
    if (!line) return;
    if (fc.agent === "claude") return this.ingestClaude(line, fc, touched);
    if (fc.agent === "codex") return this.ingestCodex(line, fc, touched);
    if (fc.agent === "workbuddy") return this.ingestWorkbuddy(line, fc, touched);
  }

  // ---- Claude Code ----
  ingestClaude(line, fc, touched) {
    if (line.indexOf('"type":"assistant"') < 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"type":"custom-title"') < 0 && line.indexOf('"type":"last-prompt"') < 0) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    if (d.type === "custom-title") {
      if (d.customTitle) {
        fc.titles.set(d.sessionId, d.customTitle);
        this.titles.set(d.sessionId, d.customTitle);
        const m = this.meta.get(d.sessionId); if (m) m.title = d.customTitle;
      }
      fc.sid = d.sessionId || fc.sid;
      return;
    }
    if (d.type === "last-prompt") { fc.sid = d.sessionId || fc.sid; return; }
    if (d.type !== "assistant" && d.type !== "user") return;
    const ms = Date.parse(d.timestamp);
    if (!ms || this.stale("claude", ms)) return;
    fc.sid = d.sessionId || fc.sid;
    fc.cwd = d.cwd || fc.cwd;
    fc.app = d.entrypoint || fc.app;
    const sid = fc.sid;
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
    const v = this.liveOf(fc, sid, ms);
    v.title = fc.titles.get(sid) || this.titles.get(sid) || v.title;
    v.cwd = fc.cwd; v.app = fc.app;
    if (d.type === "assistant" && d.message) {
      v.model = d.message.model || v.model;
      const c = d.message.content;
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type === "tool_use") {
          if (b.name === "TodoWrite" && Array.isArray(b.input && b.input.todos)) v.todo = todoOf(b.input.todos.map((t) => [t.status, t.activeForm || t.content]));
          else v.step = stepText(b.name, b.input);
        }
        if (b.type === "text" && b.text) v.lastText = b.text;
      }
      const stop = d.message.stop_reason;
      v.state = stop === "end_turn" || stop === "stop_sequence" ? "wait" : "run";
      const u = d.message.usage;
      if (u && d.message.id && !d.isSidechain) {
        const id = `${d.message.id}:${d.requestId || ""}`;
        fc.msgs.set(id, { key, sid, proj: s.proj, model: d.message.model, out: u.output_tokens || 0, fresh: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, at: ms });
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: v.model, lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), out: (this.meta.get(sid)?.out || 0) + (u.output_tokens || 0), fresh: (this.meta.get(sid)?.fresh || 0) + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: (this.meta.get(sid)?.cached || 0) + (u.cache_read_input_tokens || 0), calls: (this.meta.get(sid)?.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
    } else if (d.type === "user" && !d.isSidechain) {
      const c = d.message && d.message.content;
      const text = typeof c === "string" ? c : Array.isArray(c) && !c.some((b) => b.type === "tool_result") ? c.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
      if (isPromptText(text)) {
        day.prompts++;
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        v.state = /^\s*\[Request interrupted/.test(text) ? "wait" : "run";
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), state: v.state });
      }
    }
  }

  // ---- Codex ----
  ingestCodex(line, fc, touched) {
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const p = d.payload || {};
    if (d.type === "session_meta") {
      fc.sid = p.id || fc.sid;
      fc.cwd = p.cwd || fc.cwd;
      fc.app = p.originator || fc.app || "codex";
      if (p.thread_source === "subagent" && p.parent_thread_id) fc.sid = String(p.parent_thread_id);
      return;
    }
    if (d.type === "turn_context") { if (p.model) fc.model = p.model; return; }
    const ms = Date.parse(d.timestamp);
    if (!ms || (d.type !== "event_msg" && d.type !== "response_item")) return;
    const sid = fc.sid;
    if (this.stale("codex", ms)) {
      const t = d.type === "event_msg" && p.type === "token_count" && p.info && p.info.total_token_usage;
      if (t) fc.tot = { out: t.output_tokens || 0, fresh: Math.max(0, (t.input_tokens || 0) - (t.cached_input_tokens || 0)), cached: t.cached_input_tokens || 0 };
      return;
    }
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
    const v = this.liveOf(fc, sid, ms);
    v.cwd = fc.cwd; v.app = fc.app; v.title = this.titles.get(sid) || v.title;
    if (d.type === "event_msg") {
      if (p.type === "task_complete" || p.type === "turn_aborted") v.state = "wait";
      else if (p.type === "error") { v.state = "error"; v.err = String(p.message || "").replace(/\s+/g, " ").slice(0, 80); }
      else if (p.type === "task_started" || p.type === "user_message") v.state = "run";
      else if (p.type === "agent_message" && p.message) v.lastText = String(p.message);
    }
    if (d.type === "response_item") {
      if (p.type === "message" && p.role === "user") {
        const text = (Array.isArray(p.content) ? p.content : []).filter((b) => b && b.type === "input_text").map((b) => b.text || "").join("").trim();
        if (text && isPromptText(text)) {
          day.prompts++;
          if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        }
      }
      if (p.type === "message" && p.role === "assistant") {
        const text = (Array.isArray(p.content) ? p.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ");
        if (text) v.lastText = text;
      }
      if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
        let a = {};
        try { a = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments || p.action || {}; } catch { /* not JSON */ }
        if (p.name === "update_plan" && Array.isArray(a.plan)) v.todo = todoOf(a.plan.map((x) => [x.status, x.step]));
        else v.step = stepText(p.name || p.type, a);
        v.state = "run";
      }
    }
    const t = d.type === "event_msg" && p.type === "token_count" && p.info && p.info.total_token_usage;
    if (t) {
      const prev = fc.tot || { out: 0, fresh: 0, cached: 0 };
      const cur = { out: t.output_tokens || 0, fresh: Math.max(0, (t.input_tokens || 0) - (t.cached_input_tokens || 0)), cached: t.cached_input_tokens || 0 };
      const m = { key, sid, proj: s.proj, model: fc.model, out: Math.max(0, cur.out - prev.out), fresh: Math.max(0, cur.fresh - prev.fresh), cached: Math.max(0, cur.cached - prev.cached), at: ms };
      if (m.out || m.fresh || m.cached) {
        fc.msgs.set(`codex:${fc.id}:${fc.msgs.size}`, m);
        const meta = this.meta.get(sid) || {};
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: fc.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
      fc.tot = cur;
    }
  }

  // ---- WorkBuddy ----
  ingestWorkbuddy(line, fc, touched) {
    let d;
    try { d = JSON.parse(line); } catch { return; }
    if (d.type === "ai-title") { if (d.aiTitle) { fc.titles.set(fc.sid, d.aiTitle); this.titles.set(fc.sid, d.aiTitle); } return; }
    if (!["message", "reasoning", "function_call", "function_call_result"].includes(d.type) || !+d.timestamp) return;
    const ms = +d.timestamp;
    if (this.stale("workbuddy", ms)) return;
    const { key, day, s } = this.touchSess(fc, touched, ms, fc.sid, d.cwd || fc.cwd, "workbuddy");
    const v = this.liveOf(fc, fc.sid, ms);
    v.title = fc.titles.get(fc.sid) || v.title;
    v.cwd = d.cwd || fc.cwd;
    if (d.type === "message") {
      v.state = d.role === "assistant" ? "wait" : "run";
      if (d.role === "assistant") {
        const text = (Array.isArray(d.content) ? d.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ");
        if (text) v.lastText = text;
      }
      if (d.role === "user") {
        const text = (Array.isArray(d.content) ? d.content : []).filter((b) => b && b.type === "input_text").map((b) => b.text || "").join("").replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, "").trim();
        if (isPromptText(text)) {
          day.prompts++;
          if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        }
      }
    } else if (d.type === "function_call") {
      v.state = "run";
      let a = {};
      try { a = typeof d.arguments === "string" ? JSON.parse(d.arguments) : d.arguments || {}; } catch { /* not JSON */ }
      v.step = stepText(d.name, a);
    }
    const pd = d.providerData || {}, u = pd.usage;
    if (u && pd.messageId) {
      const cached = (u.inputTokensDetails || []).reduce((k, x) => k + ((x && x.cached_tokens) || 0), 0);
      const m = { key, sid: fc.sid, proj: s.proj, model: pd.requestModelName || pd.model, out: u.outputTokens || 0, fresh: Math.max(0, (u.inputTokens || 0) - cached), cached, at: ms };
      fc.msgs.set("wb:" + pd.messageId, m);
      const meta = this.meta.get(fc.sid) || {};
      this.noteMeta(fc, fc.sid, { title: v.title, text: s.text, cwd: v.cwd, app: "workbuddy", model: m.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, lastText: v.lastText });
    }
  }

  // ----- DeepSeek Harness (zstd JSONL) -----
  async readDsh(p, st, touched) {
    const fc = this.ensureFile(p, "dsh");
    if (fc.mtime === st.mtimeMs && fc.size === st.size) return;
    fc.mtime = st.mtimeMs;
    fc.size = st.size;
    const raw = await fsp.readFile(p);
    const bytes = decompress(raw);
    const text = Buffer.from(bytes).toString("utf8");
    // A compressed session is re-read whole. Reset this file's contribution.
    fc.days = new Map();
    fc.msgs = new Map();
    fc.titles = new Map();
    fc.live = null;
    fc.tot = null;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      this.ingestDsh(lines[i], fc, touched);
      if (i % 2000 === 1999) await new Promise((r) => setImmediate(r));
    }
  }

  ingestDsh(line, fc, touched) {
    if (!line) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const t = d.type;
    const ms = +d.time || Date.parse(d.timestamp) || 0;
    if (t === "session") {
      fc.sid = d.id || fc.sid;
      fc.cwd = d.cwd || fc.cwd;
      fc.app = "dsh";
      fc.createdAt = d.createdAt || fc.createdAt;
      const m = this.noteMeta(fc, fc.sid, { cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms || d.createdAt || 0, this.meta.get(fc.sid)?.lastAt || 0) });
      return;
    }
    if (!ms) return;
    if (t === "session/title") {
      const title = d.data && d.data.title;
      if (title) {
        fc.titles.set(fc.sid, title);
        this.titles.set(fc.sid, title);
        const m = this.meta.get(fc.sid); if (m) m.title = title;
      }
      return;
    }
    if (!DSH_TOUCH.has(t) || this.stale("dsh", ms)) return;
    const sid = fc.sid;
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, "dsh");
    const v = this.liveOf(fc, sid, ms);
    v.cwd = fc.cwd;
    v.title = fc.titles.get(sid) || v.title;
    const data = d.data || {};
    if (t === "user/message") {
      const content = data.message ? data.message.content : data.content;
      const text = Array.isArray(content) ? content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("") : String(content || "");
      if (isPromptText(text) && !(data.source && data.source.kind === "system")) {
        day.prompts++;
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        v.state = "run";
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), state: "run" });
      }
    } else if (t === "turn/start") {
      v.state = "run"; v.err = "";
    } else if (t === "step/start") {
      v.state = "run";
    } else if (t === "tool/call") {
      v.state = "run";
      let a = {};
      try { a = typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments || {}; } catch { /* not JSON */ }
      v.step = stepText(data.name, a);
      if (/todo/i.test(String(data.name || "")) && Array.isArray(a.todos)) v.todo = todoOf(a.todos.map((x) => [x.status, x.content || x.activeForm]));
    } else if (t === "assistant/message") {
      v.state = "run";
      const msg = data.message || {};
      const content = msg.content || [];
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === "text" && b.text) v.lastText = b.text;
        if (b.type === "tool-call" || b.type === "tool_use") v.step = stepText(b.name, b.arguments || b.input);
      }
      const src = msg.source || {};
      if (src.model) v.model = src.model;
      const u = data.usage;
      if (u && (u.outputTokens || u.inputTokens || u.cacheReadTokens)) {
        const id = msg.id || `dsh:${sid}:${d.seq ?? fc.msgs.size}`;
        const m = {
          key, sid, proj: s.proj, model: src.model || v.model,
          out: u.outputTokens || 0,
          fresh: (u.inputTokens || 0) + (u.cacheWriteTokens || 0),
          cached: u.cacheReadTokens || 0,
          at: ms,
        };
        fc.msgs.set(id, m);
        const meta = this.meta.get(sid) || {};
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", model: m.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
    } else if (t === "turn/end") {
      const reason = data.reason || {};
      if (reason.kind === "error") { v.state = "error"; v.err = String(reason.error && reason.error.message || "").slice(0, 120); }
      else if (reason.kind === "aborted") v.state = "wait";
      else v.state = "wait";
      v.todo = null;
      const meta = this.meta.get(sid);
      if (meta) { meta.state = v.state; meta.err = v.err; meta.lastAt = Math.max(ms, meta.lastAt || 0); }
    }
  }

  // ----- derived -----
  summary(key) {
    const sessions = new Map();
    const asked = {};
    let prompts = 0;
    for (const fc of this.files.values()) {
      for (const [sid, t] of fc.titles) this.titles.set(sid, t);
      const day = fc.days.get(key);
      if (!day) continue;
      prompts += day.prompts;
      asked[fc.agent] = (asked[fc.agent] || 0) + day.prompts;
      for (const [sid, s] of day.sess) {
        const cur = sessions.get(sid);
        if (cur) {
          cur.ts.push(...s.ts);
          if (cur.text.length < 300 && s.text) cur.text += (cur.text ? " / " : "") + s.text;
        } else {
          sessions.set(sid, { sid, proj: s.proj, cwd: s.cwd, app: s.app, agent: s.agent, ts: [...s.ts], text: s.text, min: 0, out: 0, fresh: 0, cached: 0, segs: [] });
        }
      }
    }
    if (!sessions.size) return null;
    const res = { wall: 0, agent: 0, sessions: sessions.size, prompts, calls: 0, out: 0, fresh: 0, cached: 0, segs: [], proj: {}, models: {}, list: [], by: {} };
    const spans = [];
    for (const s of sessions.values()) {
      s.ts.sort((a, b) => a - b);
      let a = s.ts[0], b = a + 1;
      const g = (res.by[s.agent] ||= { wall: 0, agent: 0, out: 0, fresh: 0, cached: 0, segs: [], calls: 0, prompts: asked[s.agent] || 0, models: {} });
      const push = () => {
        spans.push([a, b]); s.segs.push([a, b]); s.min += b - a; res.agent += b - a; g.agent += b - a; g.segs.push([a, b]);
        const pj = (res.proj[s.proj] ||= { min: 0, out: 0, agents: {} });
        pj.min += b - a; pj.agents[s.agent] = (pj.agents[s.agent] || 0) + b - a;
      };
      for (const t of s.ts.slice(1)) {
        if (t - b <= AI_IDLE) b = Math.max(b, t);
        else { push(); a = t; b = t + 1; }
      }
      push();
    }
    res.segs = unionSegs(spans);
    res.wall = Math.round(res.segs.reduce((n, [a, b]) => n + b - a, 0));
    const seen = new Set();
    for (const fc of this.files.values()) {
      for (const [id, m] of fc.msgs) {
        if (m.key !== key || seen.has(id)) continue;
        seen.add(id);
        res.calls++; res.out += m.out; res.fresh += m.fresh; res.cached += m.cached;
        (res.proj[m.proj] ||= { min: 0, out: 0, agents: {} }).out += m.out;
        const liveModel = m.model && m.model !== "<synthetic>";
        if (sessions.has(m.sid)) {
          const ss = sessions.get(m.sid);
          const g = res.by[ss.agent];
          ss.out += m.out; ss.fresh += m.fresh; ss.cached += m.cached;
          g.out += m.out; g.calls++; g.fresh += m.fresh; g.cached += m.cached;
          if (liveModel) g.models[m.model] = (g.models[m.model] || 0) + m.out;
        }
        if (liveModel) res.models[m.model] = (res.models[m.model] || 0) + m.out;
      }
    }
    for (const g of Object.values(res.by)) {
      g.segs = unionSegs(g.segs);
      g.wall = Math.round(g.segs.reduce((n, [a, b]) => n + b - a, 0));
      g.agent = Math.round(g.agent);
    }
    for (const s of sessions.values()) {
      res.list.push({
        sid: s.sid, agent: s.agent, dir: s.proj, cwd: s.cwd, app: s.app,
        title: this.titles.get(s.sid) || "", text: s.text.slice(0, 300),
        min: Math.round(s.min), out: s.out, fresh: s.fresh, cached: s.cached,
        segs: s.segs.map(([a, b]) => [Math.round(a), Math.round(b)]),
      });
    }
    // per-agent session counts
    for (const x of res.list) if (res.by[x.agent]) res.by[x.agent].sessions = (res.by[x.agent].sessions || 0) + 1;
    res.wall = Math.round(res.wall); res.agent = Math.round(res.agent);
    res.segs = res.segs.map(([a, b]) => [Math.round(a), Math.round(b)]);
    for (const p of Object.values(res.proj)) { p.min = Math.round(p.min); p.out = Math.round(p.out); for (const k in p.agents || {}) p.agents[k] = Math.round(p.agents[k]); }
    res.list.sort((a, b) => (b.segs[b.segs.length - 1]?.[1] || 0) - (a.segs[a.segs.length - 1]?.[1] || 0));
    return res;
  }

  day(key) { return this.summary(key); }

  liveSessions({ since = 0, limit = 50 } = {}) {
    const out = [];
    const seen = new Set();
    for (const fc of this.files.values()) {
      const v = fc.live;
      if (!v || !v.at || v.at < since) continue;
      const sid = fc.sid;
      if (seen.has(sid)) continue;
      seen.add(sid);
      const meta = this.meta.get(sid) || {};
      const live = cleanLive({ ...v }, Date.now());
      if (live.quiet && live.state === "run") live.state = "quiet";
      out.push({ ...meta, ...live, sid, agent: fc.agent, cwd: v.cwd || fc.cwd, app: v.app || fc.app, title: v.title || meta.title || this.titles.get(sid) || "", model: v.model || meta.model || "", tokens: (meta.out || 0) + (meta.fresh || 0), lastAt: v.at });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }

  sessions({ since = 0, limit = 100, agent = "" } = {}) {
    const out = [];
    for (const m of this.meta.values()) {
      if (!m.lastAt || m.lastAt < since) continue;
      if (agent && m.agent !== agent) continue;
      out.push({ ...m, title: m.title || this.titles.get(m.sid) || "", tokens: (m.out || 0) + (m.fresh || 0) });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }
}

// minute-of-day helper that uses cfg.dayCutoff (kept local to avoid a circular import)
function dayMinuteCfg(ms, cfg) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  const d = new Date(ms - cutoff * 3600e3);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + cutoff * 3600e3;
  return Math.round((ms - start) / 60000);
}

// ----- usage store -----
export class UsageStore {
  constructor(plugin, cfg = {}) {
    this.plugin = plugin;
    this.cfg = cfg;
    this.days = {};
    this.dirty = false;
    this.saveTimer = null;
  }

  async load(file) {
    this.file = file;
    try {
      const raw = await fsp.readFile(file, "utf8");
      const d = JSON.parse(raw);
      this.days = d.days || {};
      this.imported = d.imported || {};
    } catch { this.days = {}; }
  }

  merge(touched, usage) {
    let changed = false;
    for (const key of touched) {
      const s = usage.summary(key);
      if (s) {
        if (JSON.stringify(s) !== JSON.stringify(this.days[key])) { this.days[key] = s; changed = true; }
      } else if (this.days[key] && key >= dayKeyToday(this.cfg)) {
        delete this.days[key]; changed = true;
      }
    }
    if (changed) this.queueSave();
    return changed;
  }

  queueSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch(() => {}), 800);
  }

  async save() {
    if (!this.file) return;
    this.dirty = false;
    const tmp = this.file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, days: this.days, imported: this.imported || {}, savedAt: Date.now() }), "utf8");
    await fsp.rename(tmp, this.file);
  }

  get(key) { return this.days[key] || null; }

  range(n = 14, cfg = this.cfg) {
    const out = [];
    const now = Date.now();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = dayKey(d.getTime(), cfg);
      const day = this.days[key] || null;
      out.push({ key, date: d, day, wall: day ? day.wall : 0, out: day ? day.out : 0, sessions: day ? day.sessions : 0, by: day ? day.by : {} });
    }
    return out;
  }

  prune(days = 120) {
    const cutoff = dayKey(Date.now() - days * 86400000, this.cfg);
    for (const k of Object.keys(this.days)) if (k < cutoff) delete this.days[k];
  }

  totals(days = 1) {
    const out = { wall: 0, out: 0, fresh: 0, cached: 0, sessions: 0, prompts: 0, calls: 0, by: {} };
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const key = dayKey(now - i * 86400000, this.cfg);
      const d = this.days[key];
      if (!d) continue;
      for (const k of ["wall", "out", "fresh", "cached", "sessions", "prompts", "calls"]) out[k] += d[k] || 0;
      for (const [a, v] of Object.entries(d.by || {})) {
        const g = (out.by[a] ||= { wall: 0, out: 0, agent: 0, sessions: 0, segs: [] });
        g.wall += v.wall || 0; g.out += v.out || 0; g.agent += v.agent || 0; g.sessions += v.sessions || 0; g.segs.push(...(v.segs || []));
      }
    }
    return out;
  }
}

export { dayKey };
