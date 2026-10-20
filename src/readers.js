// Agent Deck — local session-log readers.
//
// Everything here is read-only: Claude Code / Codex / WorkBuddy / DeepSeek Harness
// session logs are parsed into per-day usage and a live session index. Nothing is
// uploaded anywhere.

import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
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
    this.archived = new Set();       // Codex archived_sessions
    this.desk = new Map();           // Claude desktop local_*.json path -> desktop session entry
    this.deskBySid = new Map();      // cliSessionId -> desktop session entry
    this.deskByLocal = new Map();    // desktop sessionId (local_…) -> desktop session entry
    this.archivedClaude = new Set(); // sessions archived in the Claude desktop app
    this.sideChats = new Map();      // sid -> [{ pid, since }] currently open side chats
    this.subs = new Map();           // sid -> Map(agentId -> subagent record)
    this.sideAt = 0;
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
    await this.readClaudeDesktop();
    await this.readClaudeSideChats();
    this.applyClaudeDesktop();
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

  // 桌面版以外几家的「归档」各记在各的地方，每轮重读一遍（取消归档也能跟上）：
  //   Codex：老版本把日志挪进 archived_sessions/，新版在 state_*.sqlite 的 threads.archived
  //   WorkBuddy：workbuddy.db 的 sessions.status = 'archived'（删掉的有 deleted_at）
  //   DeepSeek Harness：storages/workspace.json 的 global.archivedSessionIds
  async readCodexArchived() {
    const out = new Set();
    const codex = process.env.CODEX_HOME || path.join(home(), ".codex");
    try {
      for (const f of await fsp.readdir(path.join(codex, "archived_sessions"))) {
        const m = /([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(f);
        if (m) out.add(m[1]);
      }
    } catch { /* none */ }
    if (Date.now() - (this._dbAt || 0) > 15000 || !this._dbArchived) {
      this._dbAt = Date.now();
      const db = new Set();
      try {
        const states = (await fsp.readdir(codex)).filter((f) => /^state_\d+\.sqlite$/.test(f)).sort();
        if (states.length) for (const id of await sqliteColumn(path.join(codex, states[states.length - 1]), "select id from threads where archived = 1")) db.add(id);
      } catch { /* no codex state */ }
      for (const id of await sqliteColumn(path.join(home(), ".workbuddy/workbuddy.db"), "select id from sessions where status = 'archived' or deleted_at is not null")) db.add(id);
      try {
        const ws = JSON.parse(await fsp.readFile(path.join(home(), ".dsh/storages/workspace.json"), "utf8"));
        for (const id of (ws && ws.global && ws.global.archivedSessionIds) || []) db.add(String(id));
      } catch { /* no harness */ }
      this._dbArchived = db;
    }
    for (const id of this._dbArchived) out.add(id);
    this.archived = out;
  }

  // ----- Claude desktop session index -----
  // 桌面版给每个会话存一份 claude-code-sessions/<账号>/<组织>/local_*.json。
  // 侧栏里看着同一级的两个会话，如果是后者从前者开出来的，只有这里有线索：
  // spawnedFrom.sessionId 是母会话的 local_ 号；归档也只是把 isArchived 设成 true，
  // ~/.claude/projects 里的 .jsonl 照旧。sid 用 cliSessionId，和 .jsonl 同名。
  deskRoots() {
    const h = home();
    const base = process.platform === "darwin" ? path.join(h, "Library/Application Support")
      : process.platform === "win32" ? (process.env.APPDATA || path.join(h, "AppData/Roaming"))
      : (process.env.XDG_CONFIG_HOME || path.join(h, ".config"));
    return [path.join(base, "Claude", "claude-code-sessions")];
  }

  async readClaudeDesktop() {
    this.deskBySid.clear();
    this.deskByLocal.clear();
    this.archivedClaude.clear();
    if (this.settings.claudeDesktop === false || !this.enabled("claude")) return;
    const cutoff = Date.now() - 7 * 864e5;   // 一周没动过的会话不看；归档状态只影响最近这些
    const walk = async (dir, depth) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) await walk(p, depth + 1); continue; }
        if (!e.isFile() || !/^local_.*\.json$/.test(e.name)) continue;
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        if (st.mtimeMs < cutoff) continue;
        let d = this.desk.get(p);
        if (!d || d.mtime !== st.mtimeMs) {
          let raw;
          try { raw = JSON.parse(await fsp.readFile(p, "utf8")); } catch { continue; }   // 桌面版正在写：下一轮再读
          d = {
            mtime: st.mtimeMs,
            sid: String(raw.cliSessionId || ""),
            local: String(raw.sessionId || e.name.replace(/\.json$/, "")),
            title: String(raw.title || ""),
            parentLocal: String((raw.spawnedFrom && raw.spawnedFrom.sessionId) || ""),
            created: +raw.createdAt || 0,
            active: +raw.lastActivityAt || +raw.createdAt || 0,
            archived: raw.isArchived === true,
            parentSid: "",
            parentTitle: "",
          };
          this.desk.set(p, d);
        }
        if (!d.sid) continue;
        this.deskBySid.set(d.sid, d);
        this.deskByLocal.set(d.local, d);
      }
    };
    for (const root of this.deskRoots()) await walk(root, 0);
    // 母会话的 sid 和标题要整份清单读完才知道，第二遍补上
    for (const d of this.deskBySid.values()) {
      const par = d.parentLocal ? this.deskByLocal.get(d.parentLocal) : null;
      d.parentSid = par ? par.sid : "";
      d.parentTitle = par ? par.title : "";
      if (d.archived) this.archivedClaude.add(d.sid);
    }
    for (const [p, d] of this.desk) if (!this.deskBySid.has(d.sid)) this.desk.delete(p);
  }

  // 开着的 side chat：桌面版给每个 side chat 起一个 claude 子进程，参数里带
  // --fork-session --no-session-persistence --resume <母会话 sid>；进程不在就是关了。
  readClaudeSideChats() {
    if (this.settings.claudeDesktop === false || !this.enabled("claude") || process.platform === "win32") {
      this.sideChats.clear();
      return Promise.resolve(this.sideChats);
    }
    if (Date.now() - this.sideAt < 10000) return Promise.resolve(this.sideChats);   // 每十秒看一次 ps 就够
    this.sideAt = Date.now();
    return new Promise((resolve) => {
      execFile("ps", ["-axo", "pid=,etime=,command="], { maxBuffer: 16 << 20 }, (err, text) => {
        const out = new Map();
        if (!err) for (const line of String(text).split("\n")) {
          if (!line.includes("--fork-session") || !line.includes("--no-session-persistence")) continue;
          if (line.includes("disclaimer")) continue;   // 外层包装进程带着同样的参数，只认真正的 claude
          const m = /--resume[= ]([0-9a-f]{8}-[0-9a-f-]{27})/.exec(line);
          if (!m) continue;
          const [pid, et] = line.trim().split(/\s+/);
          const t = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(et || "");
          const age = t ? ((+t[1] || 0) * 86400 + (+t[2] || 0) * 3600 + +t[3] * 60 + +t[4]) * 1000 : 0;
          if (!out.has(m[1])) out.set(m[1], []);
          out.get(m[1]).push({ pid: +pid, since: Date.now() - age });
        }
        this.sideChats = out;
        resolve(out);
      });
    });
  }

  // 把桌面版清单和 side chat 状态贴到会话索引上：parentSid / parentTitle 是母子关系，
  // archived 是桌面版里归档了，sideChats / sideSince 是正开着的 side chat 数和最早那个的开始时间。
  applyClaudeDesktop() {
    for (const m of this.meta.values()) {
      if (m.agent !== "claude") continue;
      m.deskTitle = ""; m.parentSid = ""; m.parentTitle = ""; m.archived = false;
      m.sideChats = 0; m.sideSince = 0;
    }
    for (const d of this.deskBySid.values()) {
      const m = this.meta.get(d.sid);
      if (!m) continue;
      m.deskTitle = d.title;
      if (!m.title && d.title) m.title = d.title;
      m.parentSid = d.parentSid || "";
      m.parentTitle = d.parentTitle || "";
      m.archived = d.archived === true;
      if (d.created && !m.startedAt) m.startedAt = d.created;
    }
    for (const [sid, list] of this.sideChats) {
      const m = this.meta.get(sid);
      if (!m || !list.length) continue;
      const since = list.map((x) => x.since || 0).filter(Boolean);
      m.sideChats = list.length;
      m.sideSince = since.length ? Math.min(...since) : 0;
    }
  }

  // 归档 = 做完：桌面版里归档的、Codex archived_sessions 里的都可以从会话列表里收起来
  hidden(sid) {
    if (this.settings.hideArchived === false) return false;
    return this.archivedClaude.has(sid) || this.archived.has(sid);
  }

  // ----- file caches -----
  ensureFile(p, agent) {
    let fc = this.files.get(p);
    if (!fc) {
      const base = path.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
      const flat = p.replace(/\\/g, "/");
      const sm = /([0-9a-f]{8}-[0-9a-f-]{27})\/subagents\/agent-([^/]+)\.jsonl$/.exec(flat);
      const sid = sm ? sm[1] : base.startsWith("session-") ? base : (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
      fc = {
        path: p, agent, size: 0, offset: 0, mtime: 0,
        sid, id: sid, cwd: "", app: base.startsWith("session-") ? "dsh" : "",
        model: "", days: new Map(), msgs: new Map(), titles: new Map(),
        live: null, zstd: p.endsWith(".zstd") || p.endsWith(".zst"),
        sub: sm ? sm[2] : "", parentSid: sm ? sm[1] : "", metaRead: false,
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
    if (fc.sub && !fc.metaRead) {
      fc.metaRead = true;
      this.readSubMeta(p, fc).catch(() => {});
    }
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
    if (fc.agent === "claude" && fc.sub) this.subLine(fc, line);
    if (fc.agent === "claude") return this.ingestClaude(line, fc, touched);
    if (fc.agent === "codex") return this.ingestCodex(line, fc, touched);
    if (fc.agent === "workbuddy") return this.ingestWorkbuddy(line, fc, touched);
  }

  // ---- Claude Code subagents ----
  // 会话派一个 subagent，日志另起一个文件：<会话号>/subagents/agent-<agentId>.jsonl，
  // 旁边的 .meta.json 写着 { description, agentType, requestShape }。每个子代理单独记一份，
  // 给日记里的「🤖 子代理」子块用；跑完 / 出错 / 被停也看父会话收到的 <task-notification>。
  subOf(sid, id) {
    let m = this.subs.get(sid);
    if (!m) this.subs.set(sid, m = new Map());
    let r = m.get(id);
    if (!r) m.set(id, r = { id, desc: "", type: "", bg: false, start: 0, at: 0, state: "run", step: "", last: "", end: "", endAt: 0, tok: new Map() });
    return r;
  }

  subsOf(sid) {
    return [...(this.subs.get(sid) || new Map()).values()].filter((r) => r.start).sort((a, b) => a.start - b.start);
  }

  async readSubMeta(p, fc) {
    try {
      const m = JSON.parse(await fsp.readFile(p.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      const r = this.subOf(fc.parentSid, fc.sub);
      r.desc = String(m.description || "");
      r.type = String(m.agentType || "");
      r.bg = m.requestShape === "background";
    } catch { /* 老版本没有 meta */ }
  }

  subLine(fc, line) {
    if (line.indexOf('"isSidechain":true') < 0) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const ms = Date.parse(d.timestamp);
    if (!ms) return;
    const r = this.subOf(fc.parentSid, fc.sub);
    if (!r.start || ms < r.start) r.start = ms;
    if (ms < r.at) return;
    r.at = ms;
    if (r.end && ms > r.endAt) r.end = "";
    const c = d.message && d.message.content;
    if (d.type === "user") { if (!r.end && !r.handed) r.state = "run"; return; }
    const stop = d.message && d.message.stop_reason;
    const tools = (Array.isArray(c) ? c : []).filter((b) => b && b.type === "tool_use");
    if (tools.length) r.handed = tools.some((b) => b.name === "SubagentHandback");
    if (!r.end) r.state = r.handed || stop === "end_turn" || stop === "stop_sequence" ? "done" : "run";
    for (const b of tools) if (b.name !== "SubagentHandback") r.step = stepText(b.name, b.input);
    const hb = tools.find((b) => b.name === "SubagentHandback");
    const said = (Array.isArray(c) ? c : []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n").trim();
    if (hb && hb.input) r.last = String(hb.input.message || hb.input.report || hb.input.result || "");
    else if (said && !r.handed) r.last = said;
    const u = d.message && d.message.usage;
    if (u && d.message.id) r.tok.set(d.message.id, (u.output_tokens || 0) + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  }

  // 父会话收到的「后台任务结束了」：只管 subagent 的（后台命令也发这种通知，没有对应子代理的不管）
  subNotice(sid, text, ms) {
    const id = (/<task-id>([^<]+)<\/task-id>/.exec(text) || [])[1], st = (/<status>([^<]+)<\/status>/.exec(text) || [])[1];
    if (!id || !st) return;
    const known = this.subs.get(sid) && this.subs.get(sid).get(id), sum = /<summary>Agent "([^"]*)"/.exec(text);
    if (!known && !sum) return;
    const r = this.subOf(sid, id);
    if (!r.desc && sum) r.desc = sum[1];
    if (!r.start) r.start = ms;
    if (ms < r.endAt) return;
    r.end = st; r.endAt = ms; r.at = Math.max(r.at, ms);
    r.state = st === "completed" ? "done" : "fail";
  }

  // ---- Claude Code ----
  ingestClaude(line, fc, touched) {
    // 父会话正忙时，subagent 的结束通知先进排队（queue-operation），再作为附件塞进下一轮，不是 user 行
    if (line.indexOf("<task-notification>") >= 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"isSidechain":true') < 0) {
      let q;
      try { q = JSON.parse(line); } catch { return; }
      const text = q.type === "queue-operation" && q.operation === "enqueue" ? q.content
        : q.attachment && q.attachment.type === "queued_command" ? q.attachment.prompt : "";
      if (typeof text === "string" && text.startsWith("<task-notification>") && q.sessionId) this.subNotice(q.sessionId, text, Date.parse(q.timestamp) || 0);
      return;
    }
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
      const meta = this.meta.get(sid) || {};
      const live = cleanLive({ ...v }, Date.now());
      if (live.quiet && live.state === "run") live.state = "quiet";
      // 归档了的不再当成待办；真要还在跑就留着
      if (this.hidden(sid) && !["run", "running", "starting"].includes(live.state)) continue;
      seen.add(sid);
      out.push({ ...meta, ...live, sid, agent: fc.agent, cwd: v.cwd || fc.cwd, app: v.app || fc.app, title: v.title || meta.title || this.titles.get(sid) || "", model: v.model || meta.model || "", tokens: (meta.out || 0) + (meta.fresh || 0), lastAt: v.at });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }

  sessions({ since = 0, limit = 100, agent = "" } = {}) {
    const out = [];
    for (const m of this.meta.values()) {
      if (!m.lastAt || m.lastAt < since) continue;
      if (agent && m.agent !== agent) continue;
      if (this.hidden(m.sid) && !["run", "running", "starting"].includes(m.state)) continue;
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

// 查一列（只跑 select）：macOS 自带 /usr/bin/sqlite3。不加 -readonly：WAL 模式的库（Codex）只读打不开。查不到返回空数组。
function sqliteColumn(db, sql) {
  return new Promise((resolve) => {
    if (!fs.existsSync(db)) return resolve([]);
    execFile("/usr/bin/sqlite3", ["-noheader", db, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(String(out || "").split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}
