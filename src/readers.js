// Agent Deck — local session-log readers.
//
// Everything here is read-only: Claude Code / Codex / WorkBuddy / DeepSeek Harness
// session logs are parsed into per-day usage and a live session index. Nothing is
// uploaded anywhere.

import fs from "fs";
import { cleanUserPrompt, isPromptText } from "./prompt-text.js";
export { cleanUserPrompt, isPromptText } from "./prompt-text.js";
import { desktopSessions, desktopMessages } from "./desktop-sessions.js";
import { expandHome, userDataDir, localDataDir, sqlite3Binary } from "./platform.js";
import {
  stepText,
  todoOf,
  applyTaskTool,
  startRound,
  finishRound,
  ingestAgentLine,
  ingestClaudeLine,
  ingestCodexLine,
  ingestWorkbuddyLine,
  ingestAntigravityLine,
  ingestDshLine,
  ingestCursorLine,
} from "./agent-ingestors.js";
export { stepText, todoOf, applyTaskTool };
import {
  cursorEventsDir,
  cursorHooksStatus,
  installCursorHooks,
  uninstallCursorHooks,
  isCursorRunning,
  readCursorDbMeta,
  packCursorState,
  unpackCursorState,
} from "./cursor-sessions.js";
import {
  discoverGrokBotStorage,
  parseGrokBotTranscript,
  grokBotPersistenceDir,
} from "./grok-bot-sessions.js";
export { grokBotPersistenceDir };
export {
  cursorEventsDir,
  cursorHooksStatus,
  installCursorHooks,
  uninstallCursorHooks,
  isCursorRunning,
};
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { decompress } from "fzstd";
import zlib from "zlib";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { t } from "./i18n.js";
import {
  AGENTS, dayKey, dayKeyToday, dayMinute, unionSegs, clamp,
} from "./constants.js";

const fsp = fs.promises;
// Unique temporary files also isolate two plugin instances during reload.
const temporaryFile = (file) => `${file}.${randomUUID()}.tmp`;
function writeAtomicSync(file, data) {
  const tmp = temporaryFile(file);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch { /* committed or not created */ } }
}
// The cache is a few hundred KB of JSON; compressing it must not block the UI
// thread, so the async pair is used everywhere except at unload.
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const AI_IDLE = 5;              // minutes between two events still counted as one working span
const LIVE_STALE = 90 * 1000;   // a running session with no new event for this long reads as quiet
const MAX_TS = 20000;

const home = () => os.homedir();
const norm = (p) => expandHome(p, home());
const normSlashes = (p) => String(p || "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
const sameDir = (a, b) => {
  const na = normSlashes(a);
  const nb = normSlashes(b);
  if (!na || !nb) return false;
  return /^[a-z]:\//i.test(na) || /^[a-z]:\//i.test(nb) ? na.toLowerCase() === nb.toLowerCase() : na === nb;
};

// Codex (and DSH's default workspace) create a folder per task, so the folder
// name is a machine slug: "a", "dui", "w-s", a session id. Those are useless as
// "project" labels, so the day summary labels them with the session title
// instead. A real project folder keeps its name.
export function isScratchCwd(cwd) {
  const p = normSlashes(cwd);
  if (!p) return false;
  const leaf = p.split("/").pop() || "";
  if (/^\d+-[0-9a-f-]{16,}$/i.test(leaf) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leaf)) return true;
  // "a" and "w-s" are Codex slugs; "api", "web", "app", "ui", "go" are real
  // project folders, so a short name alone is not enough.
  if (/^[a-z]$/i.test(leaf)) return true;
  if (/^[a-z]{1,3}-[a-z]{1,3}$/i.test(leaf)) return true;
  if (leaf === "default-workspace") return true;
  if (sameDir(p, home())) return true;   // work started from the home folder has no project
  if (/\/Codex\/\d{4}-\d{2}-\d{2}\/[^/]+$/i.test(p)) return true;
  return false;
}

export function projectName(cwd) {
  if (!cwd) return "?";
  if (/[\\/]WorkBuddy[\\/]\d{4}-\d\d-\d\d/.test(cwd)) return "WorkBuddy";
  if (/[\\/]\.dsh[\\/]sessions[\\/]/.test(cwd)) return "DSH";
  if (/[\\/]\.gemini[\\/]antigravity[\\/]/.test(cwd)) return "Antigravity";
  const p = String(cwd).split(/[\\/]\.claude[\\/]worktrees[\\/]/)[0].replace(/[\\/]+$/, "");
  return sameDir(p, home()) ? "~" : (p.split(/[\\/]/).pop() || p);
}

// Standalone / scratch directories have no concrete project folder and must
// not receive a project-name prefix in auto-generated journal titles.
// Walk upward from a touched subdirectory to the workspace/repo root so project
// labels use the project folder (e.g. agent-deck) instead of a child like src/.
const WORKSPACE_MARKERS = [".git", "package.json", "pnpm-workspace.yaml", "pyproject.toml", "Cargo.toml", "go.mod", ".hg", ".obsidian"];
export function inferWorkspaceRoot(target) {
  const clean = String(target || "").replace(/[\\/]+$/, "");
  if (!clean) return "";
  let dir = clean;
  try {
    if (fs.existsSync(clean) && !fs.statSync(clean).isDirectory()) dir = path.dirname(clean);
    else if (!fs.existsSync(clean) && /\.[a-z0-9]{1,8}$/i.test(path.basename(clean))) dir = path.dirname(clean);
  } catch { /* keep dir */ }
  const homeDir = home().replace(/[\\/]+$/, "");
  let cur = dir;
  for (let depth = 0; depth < 8 && cur && cur !== path.dirname(cur) && cur !== homeDir; depth++) {
    try {
      if (WORKSPACE_MARKERS.some((m) => fs.existsSync(path.join(cur, m)))) return cur;
    } catch { /* unreadable */ }
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return dir;
}

export function sessionProjectName(cwd) {
  const raw = String(cwd || "").trim();
  if (!raw || raw === "~" || raw === "/" || /^[a-z]:[\\/]?$/i.test(raw)) return "";
  if (isScratchCwd(raw)) return "";
  if (/[\\/]WorkBuddy[\\/]\d{4}-\d\d-\d\d/.test(raw) || /[\\/]\.dsh[\\/]sessions[\\/]/.test(raw) || /[\\/]\.gemini[\\/]antigravity[\\/]/.test(raw)) return "";
  const name = projectName(raw);
  return !name || name === "?" || name === "~" ? "" : name;
}


function cleanLive(v, now = Date.now()) {
  if (!v) return v;
  if (v.state === "run" && now - (v.at || 0) > LIVE_STALE) v.quiet = true;
  else v.quiet = false;
  return v;
}

// Parsing 2.7 GB of history again on every load is the plugin's biggest cost,
// so the per-file parse result is cached on disk. Bump CACHE_VERSION whenever the
// parsing below changes: an old cache is then ignored instead of showing stale
// numbers. Keep the complete per-message map: summary() needs historical token
// records as well as the recent tail after an incremental append.
export const USAGE_CACHE_VERSION = 11;
// Bump when the shape of summary() changes (labels, buckets, fields). The stored
// day summaries are then recomputed from the parse cache instead of staying on
// the old shape until each day happens to be touched again.
export const SUMMARY_VERSION = 2;

// Three containers inside a file record are Maps/Sets, not plain JSON:
// days[key].sess, tasks.{seen,map} and rounds.seen. Serialising them as-is would
// come back as plain objects and blow up on the first iteration.
function packDay(day) {
  return { ...day, sess: [...(day.sess instanceof Map ? day.sess : new Map())] };
}

function unpackDay(day) {
  return { ...day, sess: new Map(day.sess || []) };
}

function packFile(f) {
  const out = {
    p: f.path, a: f.agent, s: f.size, o: f.offset, m: f.mtime,
    i: f.id, sid: f.sid, cwd: f.cwd, app: f.app, model: f.model,
    d: [...f.days].map(([key, day]) => [key, packDay(day)]), tm: [...f.titles], ms: [...f.msgs], live: f.live,
    z: f.zstd ? 1 : 0, sub: f.sub, ps: f.parentSid, mr: f.metaRead ? 1 : 0,
  };
  if (f.zOff) { out.zo = f.zOff; out.zh = f.zHead; out.zc = f.zCarry || ""; }
  if (f.tot) out.tot = f.tot;
  if (f.tasks) out.tasks = { seq: f.tasks.seq, seen: [...f.tasks.seen], map: [...f.tasks.map] };
  if (f.rounds) out.rounds = { seen: [...f.rounds.seen], list: f.rounds.list };
  if (f.cursor) out.cur = packCursorState(f.cursor);
  return out;
}

function unpackFile(o) {
  return {
    path: o.p, agent: o.a, size: o.s, offset: o.o, mtime: o.m,
    id: o.i, sid: o.sid, cwd: o.cwd || "", app: o.app || "", model: o.model || "",
    days: new Map((o.d || []).map(([key, day]) => [key, unpackDay(day)])), msgs: new Map(o.ms || []), titles: new Map(o.tm || []),
    live: o.live || null, zstd: !!o.z, sub: o.sub || "", parentSid: o.ps || "",
    metaRead: !!o.mr, zOff: o.zo || 0, zHead: o.zh || "", zCarry: o.zc || "",
    tot: o.tot || null,
    tasks: o.tasks ? { seq: o.tasks.seq || 0, seen: new Set(o.tasks.seen || []), map: new Map(o.tasks.map || []) } : null,
    rounds: o.rounds ? { seen: new Set(o.rounds.seen || []), list: o.rounds.list || [] } : null,
    cursor: unpackCursorState(o.cur),
  };
}

export class AgentUsage {
  constructor(opts = {}) {
    this.cfg = opts.cfg || {};
    this.settings = opts.settings || {};
    this.historyAgents = opts.historyAgents || [];
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
    this.wbMeta = new Map();         // WorkBuddy db session metadata
    this.sideAt = 0;
    this.errors = [];
    this.lastScan = 0;
  }

  get primaries() {
    const p = this.settings.primaryAgents;
    const list = Array.isArray(p) ? p : [p].filter(Boolean);
    return list.filter((x) => AGENTS[x]).slice(0, 3);
  }

  isPrimary(agent) { return this.historyAgents.includes(agent) || this.primaries.includes(agent); }

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
  // ---- on-disk parse cache -------------------------------------------------

  // Restore what the last session parsed. Anything unreadable is ignored: a
  // bad cache must never be worse than no cache.
  async loadCache(file) {
    try {
      const raw = await fsp.readFile(file);
      const data = JSON.parse((await gunzipAsync(raw)).toString("utf8"));
      const curCutoff = Number.isFinite(this.cfg?.dayCutoff) ? this.cfg.dayCutoff : 0;
      if (!data || data.v !== USAGE_CACHE_VERSION || !Array.isArray(data.files)) return false;
      if (data.cutoff !== undefined && data.cutoff !== curCutoff) return false;
      this.files = new Map();
      for (const entry of data.files) {
        if (!entry || !entry.p) continue;
        const fc = unpackFile(entry);
        this.files.set(fc.path, fc);
      }
      if (Array.isArray(data.meta)) this.meta = new Map(data.meta);
      this.lastScan = this.files.size > 0 ? (Number(data.lastScan) || 0) : 0;
      return this.files.size > 0;
    } catch (_) {
      this.files = new Map();
      this.lastScan = 0;
      return false;
    }
  }

  cacheJSON() {
    const cutoff = Number.isFinite(this.cfg?.dayCutoff) ? this.cfg.dayCutoff : 0;
    return JSON.stringify({ v: USAGE_CACHE_VERSION, cutoff, lastScan: this.lastScan || 0, files: [...this.files.values()].map(packFile), meta: [...this.meta] });
  }

  saveCache(file) {
    const epoch = this._cacheEpoch || 0;
    const write = async () => {
      if (epoch !== (this._cacheEpoch || 0)) return false;
      let tmp;
      try {
        const payload = this.cacheJSON();
        this.dirty = false; // Later mutations mark the next snapshot dirty again.
        await fsp.mkdir(path.dirname(file), { recursive: true });
        tmp = temporaryFile(file);
        await fsp.writeFile(tmp, await gzipAsync(payload));
        if (epoch !== (this._cacheEpoch || 0)) return false; // Unload saved a newer snapshot.
        // Keep the generation check and commit in one JS turn.
        fs.renameSync(tmp, file);
        this.savedAt = Date.now();
        return true;
      } catch (e) {
        this.dirty = true;
        console.error("[agent-deck] usage cache", e);
        return false;
      } finally { if (tmp) await fsp.unlink(tmp).catch(() => {}); }
    };
    const task = (this._cacheWrite || Promise.resolve()).then(write);
    this._cacheWrite = task;
    task.then(() => { if (this._cacheWrite === task) this._cacheWrite = null; });
    return task;
  }

  saveCacheSync(file) {
    this._cacheEpoch = (this._cacheEpoch || 0) + 1;
    try {
      writeAtomicSync(file, zlib.gzipSync(this.cacheJSON()));
      this.dirty = false;
    } catch { this.dirty = true; }
  }

  // Throttled save: a scan that read nothing new costs nothing, and a busy
  // session does not rewrite several megabytes every twenty seconds.
  maybeSaveCache(file, minIntervalMs = 300000) {
    if (!this.dirty || this.saving) return false;
    if (Date.now() - (this.savedAt || 0) < minIntervalMs) return false;
    this.savedAt = Date.now();     // reserve the slot before the async write
    this.saving = true;
    this.saveCache(file).finally(() => { this.saving = false; });
    return true;
  }

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
    add(path.join(h, ".codebuddy/projects"), "workbuddy");
    add(path.join(h, ".dsh/sessions"), "dsh");
    add(path.join(h, ".gemini/antigravity/brain"), "antigravity");
    add(path.join(h, ".qoder/projects"), "qoder");
    add(cursorEventsDir(h), "cursor");
    const seen = new Set();
    return out.filter(([d]) => !seen.has(d) && seen.add(d));
  }

  sinceMs() {
    const days = clamp(Number(this.settings.fullHistoryDays) || 14, 1, 365);
    return Date.now() - days * 86400000;
  }

  // ----- scanning -----
  async scan({ since = 0, agent: onlyAgent = "", strictSince = false, onProgress } = {}) {
    const touched = new Set();
    const floor = since || this.sinceMs();
    await this.readCodexTitles();
    await this.readCodexArchived();
    await this.readDesktopDatabases({ floor, onlyAgent, strictSince, touched });
    for (const [root, agent] of this.roots()) {
      if (onlyAgent && agent !== onlyAgent) continue;
      const files = await this.walk(root, agent === "dsh" || agent === "antigravity" ? 4 : 5, agent);
      for (const p of files) {
        if (agent === "qoder") {
          const base = path.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
          const baseSid = (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
          if ([...this.files.keys()].some((k) => k.endsWith(`#${baseSid}`))) continue;
        }
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        const fc = this.files.get(p);
        if (strictSince && st.mtimeMs < floor) continue;
        if (!fc && st.mtimeMs < floor && !this.isPrimary(agent)) continue;
        if (fc && st.size === fc.size && st.mtimeMs === fc.mtime) continue;
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
    await this.readClaudeDesktop();
    await this.readClaudeSideChats();
    this.applyClaudeDesktop();
    await this.readCursorMeta({ onlyAgent });
    await this.readGrokBotSessions({ floor, onlyAgent, strictSince, touched });
    if (!onlyAgent && !strictSince) this.lastScan = Date.now();
    return touched;
  }

  desktopDatabases() {
    const h = home();
    const u = userDataDir(h);
    const l = localDataDir(h);
    return [
      [path.join(h, ".local", "share", "opencode", "opencode.db"), "opencode"],
      ...(process.platform === "win32" ? [[path.join(l, "opencode", "opencode.db"), "opencode"], [path.join(u, "opencode", "opencode.db"), "opencode"]] : []),
      [path.join(u, "com.qoder.app.stable", "main.sqlite"), "qoder"],
      ...(process.platform !== "darwin" ? [[path.join(u, "Qoder", "main.sqlite"), "qoder"]] : []),
    ];
  }

  async readDesktopDatabases({ floor, onlyAgent, strictSince, touched }) {
    for (const [db, agent] of this.desktopDatabases()) {
      if (!this.enabled(agent) || onlyAgent && agent !== onlyAgent || !fs.existsSync(db)) continue;
      try {
        const sessions = await desktopSessions(db, agent, !strictSince && this.isPrimary(agent) ? 0 : floor);
        const scope = this.isPrimary(agent) ? -1 : Number(dayKeyToday(this.cfg).replaceAll("-", ""));
        for (const row of sessions) {
          const key = `${db}#${row.sid}`;
          if (row.archived || row.deletedAt) this.archived.add(row.sid); else this.archived.delete(row.sid);
          const meta = this.meta.get(row.sid);
          if (meta) meta.archived = !!(row.archived || row.deletedAt);
          if (row.deletedAt) continue;
          const previous = this.files.get(key);
          // Query row revisions directly: WAL writes need not change the database mtime.
          if (previous?.size === row.revision && previous.offset === scope) continue;
          const messages = await desktopMessages(db, agent, row.sid);
          const fc = { path: key, agent, sid: row.sid, id: row.sid, cwd: row.cwd || "", app: "desktop", model: row.model || "", size: row.revision, offset: scope, mtime: row.updatedAt, days: new Map(), msgs: new Map(), titles: new Map(), live: null };
          // Build a replacement snapshot: streaming updates must not add usage twice.
          for (const day of previous?.days.keys() || []) touched.add(day);
          let out = 0, fresh = 0, cached = 0, calls = 0, firstText = "";
          for (const m of messages) {
            if (!m.at || this.stale(agent, m.at) && !previous?.days.has(dayKey(m.at, this.cfg))) continue;
            const { key: dayId, day, s } = this.touchSess(fc, touched, m.at, row.sid, fc.cwd, fc.app);
            const v = this.liveOf(fc, row.sid, m.end || m.at);
            v.cwd = fc.cwd; v.app = fc.app; v.title = row.title || "";
            v.state = m.state; v.step = m.step; v.err = m.error;
            if (m.model) v.model = m.model;
            if (m.role === "user" && m.text.trim()) {
              day.prompts++; startRound(fc, m.at, m.text, m.id);
              if (!firstText) firstText = m.text.slice(0, 300);
              s.text = firstText;
            } else if (m.role === "assistant") {
              if (m.text.trim()) v.lastText = m.text;
              finishRound(fc, m.end || m.at, m.text, m.state === "wait");
              out += m.out; fresh += m.fresh; cached += m.cached; calls++;
              fc.msgs.set(`${agent}:${m.id}`, { key: dayId, sid: row.sid, proj: s.proj, model: m.model || row.model || "", out: m.out, fresh: m.fresh, cached: m.cached, at: m.at });
            }
            if (m.end) this.touchSess(fc, touched, m.end, row.sid, fc.cwd, fc.app);
          }
          if (fc.live) {
            if (row.state) fc.live.state = row.state;
            fc.live.turns = fc.rounds?.list.length || 0; fc.live.rounds = fc.rounds?.list || [];
            this.noteMeta(fc, row.sid, { ...fc.live, title: row.title || firstText, text: firstText, cwd: fc.cwd, app: fc.app, model: fc.live.model || row.model || "", lastAt: fc.live.at, startedAt: row.startedAt, parentSid: row.parentSid || "", out, fresh, cached, calls, archived: !!row.archived });
          }
          this.files.set(key, fc); this.dirty = true;
        }
      } catch (e) {
        this.errors.push({ path: db, message: String(e.message || e) });
        this.errors = this.errors.slice(-20);
      }
    }
  }

  async walk(dir, depth, agent = "") {
    const out = [];
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (agent === "antigravity" && (e.name === "steps" || e.name === "chunks" || e.name === "browser_sandbox" || e.name === "scratch")) continue;
        if (depth > 0) out.push(...await this.walk(p, depth - 1, agent));
      } else if (e.isFile()) {
        if (agent === "antigravity") {
          if (e.name === "transcript.jsonl") out.push(p);
        } else if (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zstd") || e.name.endsWith(".jsonl.zst")) {
          out.push(p);
        }
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
      const codexTask = (async () => {
        try {
          const states = (await fsp.readdir(codex)).filter((f) => /^state_\d+\.sqlite$/.test(f)).sort();
          if (!states.length) return { archived: [], titles: [] };
          const st = path.join(codex, states[states.length - 1]);
          const [archived, titles] = await Promise.all([
            sqliteColumn(st, "select id from threads where archived = 1"),
            sqliteColumn(st, "select id || char(9) || replace(replace(title, char(10), ' '), char(9), ' ') from threads where title != '' and updated_at > strftime('%s','now') - 30*86400"),
          ]);
          return { archived, titles };
        } catch { return { archived: [], titles: [] }; }
      })();
      const wbDb = path.join(home(), ".workbuddy/workbuddy.db");
      const wbArchTask = sqliteColumn(wbDb, "select id from sessions where status = 'archived' or deleted_at is not null");
      const wbRowsTask = sqliteColumn(wbDb, "select id || char(9) || replace(replace(coalesce(nullif(custom_title,''), title, ''), char(10), ' '), char(9), ' ') || char(9) || coalesce(cwd,'') || char(9) || coalesce(model,'') || char(9) || coalesce(group_title,'') || char(9) || coalesce(status,'') from sessions");
      const dshTask = fsp.readFile(path.join(home(), ".dsh/storages/workspace.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);
      const [codexRes, wbArch, wbRows, ws] = await Promise.all([codexTask, wbArchTask, wbRowsTask, dshTask]);
      for (const id of codexRes.archived) db.add(id);
      for (const row of codexRes.titles) {
        const i = row.indexOf("\t"); if (i > 0 && !this.titles.has(row.slice(0, i))) this.titles.set(row.slice(0, i), row.slice(i + 1).slice(0, 120));
      }
      for (const id of wbArch) db.add(id);
      for (const row of wbRows) {
        const [id, title, cwd, model, groupTitle, status] = row.split("\t");
        if (!id) continue;
        const cleanTitle = (title || "").trim().slice(0, 120);
        if (cleanTitle && !this.titles.has(id)) this.titles.set(id, cleanTitle);
        this.wbMeta.set(id, { title: cleanTitle, cwd: cwd || "", model: model || "", groupTitle: groupTitle || "", status: status || "" });
        const m = this.meta.get(id);
        if (m) {
          if (!m.title && cleanTitle) m.title = cleanTitle;
          if (!m.model && model && model !== "auto") m.model = model;
          if (groupTitle && (!m.cwd || /[\\/]WorkBuddy[\\/]\d{4}-\d\d-\d\d/.test(m.cwd))) m.cwd = groupTitle;
        }
      }
      for (const id of (ws && ws.global && ws.global.archivedSessionIds) || []) db.add(String(id));
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
    return [path.join(userDataDir(home()), "Claude", "claude-code-sessions")];
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

  async readCursorMeta({ onlyAgent } = {}) {
    if (onlyAgent && onlyAgent !== "cursor") return;
    if (!this.enabled("cursor")) return;
    const sids = [];
    for (const fc of this.files.values()) {
      if (fc.agent === "cursor" && fc.sid) sids.push(fc.sid);
    }
    if (!sids.length) return;
    const metaMap = await readCursorDbMeta(sids, { homeDir: home() });
    for (const [sid, info] of metaMap) {
      const m = this.meta.get(sid);
      if (m) {
        if (info.title && !this.titles.has(sid)) m.title = info.title;
        if (info.cwd && (!m.cwd || m.cwd === "~")) m.cwd = info.cwd;
        if (info.model && !m.model) m.model = info.model;
        if (typeof info.archived === "boolean") m.archived = info.archived;
      }
      for (const fc of this.files.values()) {
        if (fc.agent !== "cursor" || fc.sid !== sid) continue;
        if (info.cwd && (!fc.cwd || fc.cwd === "~")) fc.cwd = info.cwd;
        if (info.model && !fc.model) fc.model = info.model;
        if (fc.live) {
          if (info.title && !fc.live.title) fc.live.title = info.title;
          if (info.cwd && (!fc.live.cwd || fc.live.cwd === "~")) fc.live.cwd = info.cwd;
          if (info.model && !fc.live.model) fc.live.model = info.model;
        }
      }
    }
  }

  async readGrokBotSessions({ floor = 0, onlyAgent = "", strictSince = false, touched = new Set() } = {}) {
    if (onlyAgent && onlyAgent !== "grokbot") return;
    const rawTracked = this.enabled("grokbot") && Array.isArray(this.settings.grokBotTrackedBotIds)
      ? this.settings.grokBotTrackedBotIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const tracked = new Set(rawTracked);

    const pruneUnselected = (keep) => {
      for (const [fileKey, fc] of [...this.files]) {
        if (fc.agent !== "grokbot" || keep.has(fc.sid)) continue;
        for (const day of fc.days?.keys() || []) touched.add(day);
        this.files.delete(fileKey);
        this.dirty = true;
      }
      for (const [sid, m] of [...this.meta]) {
        if (m.agent === "grokbot" && !keep.has(sid)) {
          this.meta.delete(sid);
          this.dirty = true;
        }
      }
    };

    if (!tracked.size) {
      pruneUnselected(tracked);
      return;
    }

    const storage = discoverGrokBotStorage(
      this.settings.grokBotPersistenceDir
        ? { persistenceDir: this.settings.grokBotPersistenceDir }
        : { homeDir: home() },
    );
    const activeTracked = new Set();
    const scope = this.isPrimary("grokbot") ? -1 : Number(dayKeyToday(this.cfg).replaceAll("-", ""));

    for (const bot of storage.bots) {
      if (!tracked.has(bot.id) || !bot.transcriptPath) continue;
      let st;
      try { st = await fsp.stat(bot.transcriptPath); } catch { continue; }
      activeTracked.add(bot.id);
      const key = `${bot.transcriptPath}#${bot.id}`;
      const previous = this.files.get(key);
      const awaiting = !!bot.awaitingUserResponse;
      if (
        previous &&
        previous.size === st.size &&
        previous.mtime === st.mtimeMs &&
        previous.offset === scope &&
        previous.metaRead === awaiting &&
        previous.titles?.get(bot.id) === bot.name
      ) {
        continue;
      }

      let rawText;
      try { rawText = await fsp.readFile(bot.transcriptPath, "utf8"); } catch { continue; }
      const parsed = parseGrokBotTranscript(rawText, bot);
      if (!parsed) continue;

      const fc = {
        path: key,
        agent: "grokbot",
        sid: bot.id,
        id: bot.id,
        cwd: "",
        app: "desktop",
        model: "",
        size: st.size,
        offset: scope,
        mtime: st.mtimeMs,
        metaRead: awaiting,
        days: new Map(),
        msgs: new Map(),
        titles: new Map([[bot.id, bot.name]]),
        live: null,
      };
      for (const day of previous?.days?.keys() || []) touched.add(day);

      let firstText = "";
      let firstEntryAt = 0;
      for (const e of parsed.entries) {
        if (!e.at) continue;
        if (strictSince && e.at < floor) continue;
        if (this.stale("grokbot", e.at) && !previous?.days.has(dayKey(e.at, this.cfg))) continue;
        if (!firstEntryAt || e.at < firstEntryAt) firstEntryAt = e.at;
        const { day, s } = this.touchSess(fc, touched, e.at, bot.id, "", "desktop");
        const v = this.liveOf(fc, bot.id, e.at);
        v.cwd = "";
        v.app = "desktop";
        v.title = bot.name;
        if (e.role === "user" && e.text.trim()) {
          day.prompts++;
          startRound(fc, e.at, e.text, e.id);
          if (!firstText) firstText = e.text.slice(0, 300);
          s.text = firstText;
          v.state = "run";
        } else if (e.role === "assistant") {
          if (e.isTurnReply && e.summaryText) {
            v.lastText = e.summaryText;
            finishRound(fc, e.at, e.summaryText, !e.isStreaming);
          }
          v.state = e.isStreaming ? "run" : "wait";
        }
      }

      if (fc.live) {
        fc.live.state = parsed.state;
        fc.live.step = parsed.step;
        fc.live.turns = fc.rounds?.list.length || 0;
        fc.live.rounds = fc.rounds?.list || [];
        this.noteMeta(fc, bot.id, {
          ...fc.live,
          title: bot.name || firstText,
          text: firstText || bot.description || bot.lastPreview || "",
          cwd: "",
          app: "desktop",
          model: "",
          lastAt: fc.live.at,
          startedAt: firstEntryAt || fc.live.at,
          out: 0,
          fresh: 0,
          cached: 0,
          calls: 0,
          archived: false,
        });
        this.files.set(key, fc);
        this.dirty = true;
      } else if (previous) {
        this.files.delete(key);
        this.meta.delete(bot.id);
        this.dirty = true;
      }
    }

    pruneUnselected(activeTracked);
  }

  // 归档 = 做完：桌面版里归档的、Codex archived_sessions 里的都可以从会话列表里收起来
  hidden(sid) {
    if (this.settings.hideArchived === false) return false;
    return this.archivedClaude.has(sid) || this.archived.has(sid) || !!this.meta.get(sid)?.archived;
  }

  // ----- file caches -----
  ensureFile(p, agent) {
    let fc = this.files.get(p);
    if (!fc) {
      const base = path.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
      const flat = p.replace(/\\/g, "/");
      const sm = /([0-9a-f]{8}-[0-9a-f-]{27})\/subagents\/agent-([^/]+)\.jsonl$/.exec(flat);
      const agm = agent === "antigravity" ? /\/brain\/([^/]+)\/\.system_generated\/logs\/transcript\.jsonl$/.exec(flat) : null;
      const sid = sm ? sm[1] : agm ? agm[1] : base.startsWith("session-") ? base : (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
      fc = {
        path: p, agent, size: 0, offset: 0, mtime: 0,
        sid, id: sid, cwd: "", app: base.startsWith("session-") ? "dsh" : agent === "antigravity" ? "antigravity" : "",
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
    if (s.ts.length < MAX_TS) s.ts.push(dayMinute(ms, this.cfg));
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
      fc.size = 0; fc.offset = 0; fc.days = new Map(); fc.msgs = new Map(); fc.titles = new Map(); fc.live = null; fc.tasks = null; fc.rounds = null; fc.cursor = null;
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
      this.dirty = true;
      for (let i = 0; i < lines.length; i++) {
        this.ingestJsonl(lines[i], fc, touched);
        if (i % 500 === 499) await new Promise((r) => setImmediate(r));
      }
    } finally { await fh.close(); }
  }

  _ingestCtx() {
    return (this._ctx ||= {
      usage: this,
      startRound,
      finishRound,
      stepText,
      dayKey: (ms) => dayKey(ms, this.cfg),
      projectName,
      inferWorkspaceRoot,
    });
  }

  ingestJsonl(line, fc, touched) {
    if (!line) return;
    if (fc.agent === "claude" && fc.sub) this.subLine(fc, line);
    ingestAgentLine(fc.agent, this._ingestCtx(), line, fc, touched);
  }

  ingestClaude(line, fc, touched) { return ingestClaudeLine(this._ingestCtx(), line, fc, touched); }
  ingestCodex(line, fc, touched) { return ingestCodexLine(this._ingestCtx(), line, fc, touched); }
  ingestWorkbuddy(line, fc, touched) { return ingestWorkbuddyLine(this._ingestCtx(), line, fc, touched); }
  ingestAntigravity(line, fc, touched) { return ingestAntigravityLine(this._ingestCtx(), line, fc, touched); }
  ingestCursor(line, fc, touched) { return ingestCursorLine(this._ingestCtx(), line, fc, touched); }

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

  // ----- DeepSeek Harness (zstd JSONL) -----
  async readDsh(p, st, touched) {
    const fc = this.ensureFile(p, "dsh");
    if (fc.mtime === st.mtimeMs && fc.size === st.size) return;
    // DSH 一批一批往文件末尾追加 zstd 帧：文件只是长了，就从上次读完的整帧接着解压，不用整个文件重解一遍
    // （Magpie 的做法）。文件变短、开头变了（被改写或换了一份），才整个重读。半截帧解不开就等下一轮。
    const fd = await fsp.open(p, "r");
    try {
      const head = Buffer.alloc(Math.min(64, st.size));
      await fd.read(head, 0, head.length, 0);
      const headHex = head.toString("hex");
      const grown = fc.zOff > 0 && st.size >= fc.zOff && fc.zHead === headHex;
      const from = grown ? fc.zOff : 0;
      const raw = Buffer.alloc(st.size - from);
      await fd.read(raw, 0, raw.length, from);
      // 末尾那一帧可能正写到一半：解到最后一个完整的帧为止，剩下的下一轮接着读
      let bytes = null, used = raw.length;
      try { bytes = decompress(raw); }
      catch {
        for (let i = raw.length - 4; i > 0 && !bytes; i--) {
          if (raw[i] !== 0x28 || raw[i + 1] !== 0xb5 || raw[i + 2] !== 0x2f || raw[i + 3] !== 0xfd) continue;
          try { bytes = decompress(raw.subarray(0, i)); used = i; } catch { /* an earlier frame */ }
        }
        if (!bytes) return;
      }
      if (!grown) { fc.days = new Map(); fc.msgs = new Map(); fc.titles = new Map(); fc.live = null; fc.tot = null; fc.tasks = null; fc.rounds = null; fc.zCarry = ""; }
      fc.mtime = used === raw.length ? st.mtimeMs : 0;   // 没读完：下一轮还要来
      fc.size = from + used;
      fc.zOff = from + used;
      fc.zHead = headHex;
      const text = (fc.zCarry || "") + Buffer.from(bytes).toString("utf8");
      const cut = text.lastIndexOf("\n");
      fc.zCarry = cut < 0 ? text : text.slice(cut + 1);
      const lines = cut < 0 ? [] : text.slice(0, cut).split("\n");
      this.dirty = true;
      for (let i = 0; i < lines.length; i++) {
        this.ingestDsh(lines[i], fc, touched);
        if (i % 500 === 499) await new Promise((r) => setImmediate(r));
      }
    } finally { await fd.close(); }
  }

  ingestDsh(line, fc, touched) { return ingestDshLine(this._ingestCtx(), line, fc, touched); }

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
      // A scratch workspace gets the session title so the ranking reads as
      // "the tasks that took the most time today" instead of folder slugs.
      s.label = s.proj;
      if (isScratchCwd(s.cwd)) {
        const meta = this.meta.get(s.sid);
        const title = String(meta?.title || s.text || "").replace(/\s+/g, " ").trim();
        if (title) s.label = title.slice(0, 24);
      }
      let a = s.ts[0], b = a + 1;
      const g = (res.by[s.agent] ||= { wall: 0, agent: 0, out: 0, fresh: 0, cached: 0, segs: [], calls: 0, prompts: asked[s.agent] || 0, models: {} });
      const push = () => {
        spans.push([a, b]); s.segs.push([a, b]); s.min += b - a; res.agent += b - a; g.agent += b - a; g.segs.push([a, b]);
        const pj = (res.proj[s.label] ||= { min: 0, out: 0, cwd: s.cwd, agents: {} });
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
      if (!fc.days.has(key)) continue;
      for (const [id, m] of fc.msgs) {
        if (m.key !== key || seen.has(id)) continue;
        seen.add(id);
        res.calls++; res.out += m.out; res.fresh += m.fresh; res.cached += m.cached;
        (res.proj[sessions.get(m.sid)?.label || m.proj] ||= { min: 0, out: 0, agents: {} }).out += m.out;
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
      const m = this.meta.get(s.sid) || {};
      res.list.push({
        sid: s.sid, agent: s.agent, dir: s.proj, cwd: s.cwd || m.cwd || "", app: s.app,
        title: this.titles.get(s.sid) || m.title || "", text: s.text.slice(0, 300),
        min: Math.round(s.min), out: s.out, fresh: s.fresh, cached: s.cached,
        turns: m.turns || 0, todo: m.todo || null,
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
      if (meta.parentSid && !meta.parentTitle) { const pm = this.meta.get(meta.parentSid); if (pm) meta.parentTitle = pm.title || this.titles.get(pm.sid) || ""; }
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
      if (m.parentSid && !m.parentTitle) { const pm = this.meta.get(m.parentSid); if (pm) m.parentTitle = pm.title || this.titles.get(pm.sid) || ""; }
      out.push({ ...m, title: m.title || this.titles.get(m.sid) || "", tokens: (m.out || 0) + (m.fresh || 0) });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }
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
      this.summary = d.summary || 0;
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

  // Recompute every day the parse cache still knows about. Used when
  // SUMMARY_VERSION moves: the labels and buckets change, but cached days are
  // never "touched" again, so merge() alone would leave the old shape in place.
  rebuild(usage) {
    const keys = new Set();
    for (const fc of usage.files.values()) for (const key of fc.days.keys()) keys.add(key);
    let changed = false;
    for (const key of keys) {
      const s = usage.summary(key);
      if (!s) continue;
      if (JSON.stringify(s) !== JSON.stringify(this.days[key])) { this.days[key] = s; changed = true; }
    }
    this.summary = SUMMARY_VERSION;
    this.queueSave();
    return changed;
  }

  queueSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch(() => {}), 800);
  }

  snapshotJSON() {
    return JSON.stringify({ version: 1, summary: this.summary, days: this.days, imported: this.imported || {}, savedAt: Date.now() });
  }

  save() {
    const epoch = this._saveEpoch || 0;
    const write = async () => {
      if (!this.file || epoch !== (this._saveEpoch || 0)) return;
      let tmp;
      try {
        const payload = this.snapshotJSON();
        this.dirty = false;
        tmp = temporaryFile(this.file);
        await fsp.writeFile(tmp, payload, "utf8");
        if (epoch === (this._saveEpoch || 0)) fs.renameSync(tmp, this.file);
      } catch (e) { this.dirty = true; throw e; }
      finally { if (tmp) await fsp.unlink(tmp).catch(() => {}); }
    };
    const task = (this.saving || Promise.resolve()).catch(() => {}).then(write);
    this.saving = task;
    const clear = () => { if (this.saving === task) this.saving = null; };
    task.then(clear, clear);
    return task;
  }

  saveSync() {
    if (!this.file) return;
    this._saveEpoch = (this._saveEpoch || 0) + 1;
    try {
      writeAtomicSync(this.file, this.snapshotJSON());
      this.dirty = false;
    } catch { this.dirty = true; }
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
    let gone = false;
    for (const k of Object.keys(this.days)) if (k < cutoff) { delete this.days[k]; gone = true; }
    if (gone) this.queueSave();
  }
}


// 查一列（只跑 select）：macOS 自带 /usr/bin/sqlite3，Windows 按 PATH/Scoop/Chocolatey 查找 sqlite3.exe。不加 -readonly：WAL 模式的库（Codex）只读打不开。查不到返回空数组。
function sqliteColumn(db, sql) {
  return new Promise((resolve) => {
    const bin = sqlite3Binary();
    if (!bin || !fs.existsSync(db)) return resolve([]);
    execFile(bin, ["-noheader", db, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => {
      if (err) return resolve([]);
      resolve(String(out || "").split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}
