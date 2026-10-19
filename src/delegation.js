// Agent Deck — delegate a note block to Claude Code or DeepSeek Harness.
//
// Claude Code: `claude --bg` (fallback: `claude -p --session-id`), then the
// session can be reopened in the desktop app through claude://resume.
// DeepSeek Harness: a small ACP (Agent Client Protocol) client over `dsh acp`,
// with model and reasoning-effort selection.

import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execFile } from "child_process";
import { AGENTS, AGENT_SHORT, DEFAULTS, clamp, deepMerge, fmtTok, truncate } from "./constants.js";

const fsp = fs.promises;
const home = () => os.homedir();
const norm = (p) => String(p || "").replace(/^~(?=\/)/, home());

export const BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
export const LINK_RE = /^\s*[-*+]\s+🔗/;
export const RESULT_RE = /^\s*[-*+]\s+💬/;
export const STATUS_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|IN-PROGRESS|SUSPENDED|CANCELED|CANCELLED|FAILED|DONE)(?=\s|$)/i;

export function blockAt(lines, at) {
  if (at < 0 || at >= lines.length) return null;
  const m = BULLET_RE.exec(lines[at]);
  if (!m) return null;
  const indent = m[1].length;
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { end = i; continue; }
    const indentHere = (line.match(/^[ \t]*/) || [""])[0].length;
    if (indentHere <= indent) break;
    end = i;
  }
  return { start: at, end, indent, text: lines.slice(at, end + 1).join("\n") };
}

export function blockTitle(block) {
  if (!block) return "";
  const first = block.text.split("\n")[0] || "";
  return first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/, "")
    .replace(/^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|IN-PROGRESS|SUSPENDED|CANCELED|CANCELLED|FAILED|DONE)\s+/i, "")
    .replace(/[#*_`>[\]]/g, "").trim();
}

export function hasLink(lines, block) {
  for (let i = block.start + 1; i <= block.end; i++) if (LINK_RE.test(lines[i])) return i;
  return -1;
}

export function findLink(lines, block) {
  const at = hasLink(lines, block);
  if (at < 0) return null;
  const m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(lines[at]);
  const wb = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(lines[at]);
  const back = /`([0-9a-f-]{16,}|session-[0-9a-f-]{20,})`/i.exec(lines[at]);
  return { line: at, sid: (m && m[1]) || (wb && decodeURIComponent(wb[1])) || (back && back[1]) || "", raw: lines[at] };
}

export function statusOf(line) {
  const m = STATUS_RE.exec(line || "");
  return m ? m[2].toUpperCase() : "";
}

export function markDelegated(line) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/.exec(line || "");
  if (!m) return `DELEGATED ${line || ""}`;
  const rest = m[2];
  const s = STATUS_RE.exec(line);
  if (s) return line.replace(s[2], "DELEGATED");
  return `${m[1]}DELEGATED ${rest}`;
}

export function linkLine(indent, agent, name, sid) {
  const safe = String(name || "").replace(/[\[\]()`]+/g, " ").slice(0, 48);
  if (agent === "claude") return `${indent}- 🔗 [Claude：${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- 🔗 [DeepSeek Harness：${safe}](dsh://open) \`${sid}\``;
  return `${indent}- 🔗 ${AGENT_SHORT(agent)}：${safe} \`${sid}\``;
}

export function findDshBinary() {
  const candidates = [
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
    path.join(home(), "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"),
    path.join(home(), ".local/bin/dsh"),
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* next */ } }
  return "dsh";
}

export function findClaudeBinary(configured = "") {
  if (configured && configured.trim()) return norm(configured.trim());
  const candidates = [path.join(home(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* next */ } }
  return "claude";
}

export async function findTrustedDir(vaultPath) {
  const h = home();
  try {
    const cfg = JSON.parse(await fsp.readFile(path.join(h, ".claude.json"), "utf8"));
    const projects = cfg.projects || {};
    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
    if (projects[vaultPath] && projects[vaultPath].hasTrustDialogAccepted) return vaultPath;
    const trusted = Object.keys(projects).filter((p) => projects[p] && projects[p].hasTrustDialogAccepted && isDir(p));
    // Prefer a trusted directory that is not an ancestor of the vault, so a task
    // never starts writing in the middle of the user's home directory.
    const notAncestor = trusted.filter((p) => p !== vaultPath && !String(vaultPath).startsWith(p.replace(/\/+$/, "") + "/"));
    notAncestor.sort((a, b) => a.length - b.length);
    if (notAncestor.length) return notAncestor[0];
    trusted.sort((a, b) => a.length - b.length);
    return trusted[0] || vaultPath;
  } catch { return vaultPath; }
}

export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const parts = new Set(String(env.PATH || "").split(":").filter(Boolean));
  for (const p of [path.join(home(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) parts.add(p);
  env.PATH = [...parts].join(":");
  return env;
}

export function openExternal(url) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") { shell.openExternal(url); return true; }
  } catch { /* not electron */ }
  try { execFile("/usr/bin/open", [url], () => {}); return true; } catch { return false; }
}

export function openTerminal(command) {
  try {
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`;
    execFile("/usr/bin/osascript", ["-e", script], () => {});
    return true;
  } catch { return false; }
}

export function sessionDeepLink(agent, sid) {
  if (!sid) return "";
  if (agent === "claude") return `claude://resume?session=${sid}`;
  if (agent === "workbuddy") return `workbuddy://chat/${encodeURIComponent(sid)}`;
  if (agent === "dsh") return "dsh://open";
  if (agent === "codex") return "";
  return "";
}

export function openSession(plugin, agent, sid, app = "") {
  if (!sid) { plugin.notice("这个会话还没有会话号，稍等一秒再点"); return false; }
  if (agent === "claude") {
    if (app === "cli") {
      const cmd = `claude --resume ${sid}`;
      if (plugin.settings.delegate?.claude?.terminalInsteadOfDesktop) return openTerminal(cmd);
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") { openExternal(`workbuddy://chat/${encodeURIComponent(sid)}`); return true; }
  if (agent === "codex") {
    plugin.notice("Codex 没有自己的会话 URL，已复制恢复命令");
    try { navigator.clipboard.writeText(`codex resume ${sid}`); } catch { /* clipboard */ }
    return false;
  }
  if (agent === "dsh") {
    // The desktop build currently only exposes dsh://open (focus the client). Keep the
    // session id on the clipboard and say so, instead of pretending to deep-link a row.
    openExternal("dsh://open");
    try { navigator.clipboard.writeText(sid); } catch { /* clipboard */ }
    plugin.notice(`已打开 DeepSeek Harness；会话号已复制（${sid.slice(0, 8)}…）`);
    return true;
  }
  return false;
}

// ----- Claude Code -----
class ClaudeRunner {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.short = "";
    this.pollTimer = null;
    this.finished = false;
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.claude;
    const bin = findClaudeBinary(cfg.path || "");
    const name = opts.name || "Agent Deck task";
    let cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    if (cfg.autoTrustedCwd !== false && !opts.cwd && !cfg.cwd) {
      const trusted = await findTrustedDir(d.vaultPath);
      if (trusted && trusted !== cwd) {
        cwd = trusted;
        this.job.cwd = cwd;
        if (!d._trustNoticeAt || Date.now() - d._trustNoticeAt > 10 * 60000) {
          d._trustNoticeAt = Date.now();
          d.notice(`Claude Code 没有信任库目录，改在 ${cwd} 里跑；库已经用 --add-dir 加进去了。`);
        }
      }
    }
    const model = opts.model || cfg.model || "claude-sonnet-5";
    const modelCli = model.startsWith("claude-") ? (model === "claude-opus-5" ? "opus" : model === "claude-sonnet-5" ? "sonnet" : model === "claude-haiku-5-5" ? "haiku" : model === "claude-fable" ? "fable" : model) : model;
    const effort = opts.effort || cfg.effort || "high";
    const permission = opts.permission || cfg.permission || "auto";
    const addVault = cfg.addVault !== false && d.vaultPath && d.vaultPath !== cwd;
    const common = ["--model", modelCli, "--effort", effort, "--permission-mode", permission, "-n", name];
    if (addVault) common.push("--add-dir", d.vaultPath);
    if (cfg.extraArgs && cfg.extraArgs.trim()) common.push(...splitArgs(cfg.extraArgs));
    const prompt = opts.prompt;
    // Headless is the reliable default: a child process we own, with the exact
    // model / effort / permission mode, and a session id we choose. The optional
    // `claude --bg` daemon can be flaky across CLI versions, so it is opt-in.
    if (cfg.useBackground === true) {
      const args = ["--bg", ...common, "--", prompt];
      this.job.command = `${bin} ${args.slice(0, -2).join(" ")} …`;
      const res = await spawnCapture(bin, args, { cwd, env: cleanEnv(), timeout: 30000 });
      if (res.ok) {
        const m = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(res.out || "");
        if (m) {
          this.short = m[1];
          this.job.short = this.short;
          this.job.state = "running";
          this.job.startedAt = Date.now();
          this.opts = opts;
          this.watchStart = Date.now();
          this.d.saveJobs();
          this.watchAgents();
          return true;
        }
      }
    }
    return this.startHeadless({ cwd, common, prompt, bin });
  }

  startHeadless({ cwd, common, prompt, bin }) {
    // Older CLI (or a dead background daemon): run headless with a session id we choose.
    const sid = require("crypto").randomUUID();
    const args2 = ["-p", "--session-id", sid, ...common, "--", prompt];
    this.job.command = `${bin} ${args2.slice(0, -2).join(" ")} …`;
    const child = spawn(bin, args2, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.fallbackStarted = true;
    this.job.sessionId = sid;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.short = "";
    this.job.agentState = "headless";
    let err = "";
    child.stdout.on("data", (b) => { const s = b.toString(); this.job.lastText = s.slice(-2000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      if (code === 0) this.done();
      else this.fail(err.trim() || `claude 退出码 ${code}`);
    });
    this.d.saveJobs();
    this.d.onSession(this.job, sid);
    this.d.notice?.("Claude 后台服务没起来，已改用无头会话（答完可以点任务行打开）");
    return true;
  }

  async watchAgents() {
    if (this.finished) return;
    const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
    const res = await execCapture(bin, ["agents", "--json"], { cwd: this.d.vaultPath, env: cleanEnv(), timeout: 10000 });
    let found = false;
    if (res.ok) {
      try {
        const list = JSON.parse(res.out || "[]");
        const row = list.find((x) => x.id === this.short || (x.kind === "background" && String(x.name || "") === this.job.name));
        if (row && row.sessionId) {
          found = true;
          this.job.sessionId = row.sessionId;
          this.job.status = row.status;
          this.job.agentState = row.state || row.status;
          if (!this.job.linkWritten) this.d.onSession(this.job, row.sessionId);
          if (row.status === "idle" || row.status === "done" || row.status === "stopped") {
            // give the session log one poll to settle, then finish
            this.settleStarted = this.settleStarted || Date.now();
            if (Date.now() - this.settleStarted > 5000) return this.done();
          } else this.settleStarted = 0;
        }
      } catch { /* not JSON yet */ }
    }
    if (!found && this.job.short && this.watchStart && Date.now() - this.watchStart > 8000 && !this.fallbackStarted) {
      this.fallbackStarted = true;
      return this.startHeadless({ cwd: this.job.cwd || this.d.vaultPath, common: this.commonArgs(), prompt: this.job.prompt, bin });
    }
    this.pollTimer = setTimeout(() => this.watchAgents(), 1800);
  }

  commonArgs() {
    const cfg = this.d.settings.delegate.claude;
    const model = this.job.model || cfg.model || "claude-sonnet-5";
    const modelCli = model.startsWith("claude-") ? (model === "claude-opus-5" ? "opus" : model === "claude-sonnet-5" ? "sonnet" : model === "claude-haiku-5-5" ? "haiku" : model === "claude-fable" ? "fable" : model) : model;
    const addVault = cfg.addVault !== false && this.d.vaultPath && this.d.vaultPath !== (this.job.cwd || cfg.cwd);
    const out = ["--model", modelCli, "--effort", this.job.effort || cfg.effort || "high", "--permission-mode", this.job.permission || cfg.permission || "auto", "-n", this.job.name];
    if (addVault) out.push("--add-dir", this.d.vaultPath);
    return out;
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    if (this.short) {
      const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
      execFile(bin, ["stop", this.short], { env: cleanEnv() }, () => {});
    }
    if (this.child) { try { this.child.kill("SIGTERM"); } catch { /* gone */ } }
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
  }

  done() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onDone(this.job);
  }

  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onError(this.job);
  }
}

// ----- DeepSeek Harness ACP -----
class DshRunner {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.finished = false;
    this.assistantText = "";
    this.lastStep = "";
    this.sessionId = "";
    this.timer = null;
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.dsh;
    const bin = findDshBinary();
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    const model = opts.model || cfg.model || "deepseek-v4-pro";
    const effort = opts.effort || cfg.effort || "high";
    this.job.command = `${bin} acp`;
    const child = spawn(bin, ["acp"], { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    let err = "";
    child.stdout.on("data", (b) => this.onData(b.toString()));
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      if (code !== 0) this.fail(err.trim() || `dsh acp 退出码 ${code}`);
    });
    try {
      const init = await this.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 30000);
      const made = await this.request("session/new", { cwd, mcpServers: [] }, 60000);
      this.sessionId = made && (made.sessionId || made.session_id);
      if (!this.sessionId) throw new Error("DeepSeek Harness 没有返回会话号");
      this.job.sessionId = this.sessionId;
      this.job.state = "running";
      this.d.saveJobs();
      this.d.onSession(this.job, this.sessionId);
      // model + effort, when the Harness advertises them
      const options = (made.configOptions || []).map((x) => x.id);
      if (options.includes("model")) {
        const custom = this.d.plugin && this.d.plugin.modelById ? this.d.plugin.modelById(model) : null;
        const m = (custom && custom.value) ? { value: custom.value } : resolveDshModel(model);
        if (m) { try { await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "model", value: m.value }, 15000); } catch { /* keep default */ } }
      }
      if (options.includes("reasoning_effort")) {
        const e = dshEffort(effort);
        if (e) { try { await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "reasoning_effort", value: e }, 15000); } catch { /* keep default */ } }
      }
      this.timer = setTimeout(() => this.fail("委派超过 30 分钟没有结束"), 30 * 60000);
      this.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text: opts.prompt }] }, 31 * 60000)
        .then((r) => this.done(r))
        .catch((e) => this.fail(e && e.message || String(e)));
    } catch (e) {
      this.fail(e && e.message || String(e));
    }
    return true;
  }

  onData(text) {
    this.buf += text;
    let at;
    while ((at = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, at).trim();
      this.buf = this.buf.slice(at + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.onMessage(msg);
    }
  }

  onMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    const method = msg.method;
    if (!method) return;
    const params = msg.params || {};
    if (method === "session/update") {
      const u = params.update || {};
      const kind = u.sessionUpdate;
      if (kind === "agent_message_chunk") {
        const t = u.content && u.content.text;
        if (t) { this.assistantText += t; this.job.lastText = this.assistantText.slice(-2000); }
      } else if (kind === "agent_thought_chunk") {
        const t = u.content && u.content.text;
        if (t) this.job.thought = t.slice(-500);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const name = u.title || u.kind || u.toolName || "tool";
        this.lastStep = truncate(name, 40);
        this.job.step = this.lastStep;
        this.job.state = "running";
      } else if (kind === "usage_update") {
        this.job.contextUsed = u.used;
        this.job.contextSize = u.size;
      }
      this.d.saveJobs();
      this.d.refreshUI();
      return;
    }
    if (method === "session/request_permission") {
      const auto = this.d.settings.delegate.dsh.autoApprove === true;
      if (auto) {
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: "allow-once" } });
      } else {
        this.job.state = "needs-approval";
        this.job.step = "等你允许一次工具调用";
        this.d.saveJobs();
        this.d.notify({ title: "DeepSeek Harness 需要你允许", body: `「${this.job.name}」停在了一次工具调用上。到设置里打开「自动允许」后重试，或者在 Harness 里手动继续。`, job: this.job });
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: "reject-once" } });
      }
      return;
    }
  }

  respond(id, result) { this.send({ jsonrpc: "2.0", id, result }); }

  send(o) {
    if (!this.child || !this.child.stdin || this.finished) return;
    try { this.child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* closed */ }
  }

  request(method, params, timeout = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    if (this.sessionId) { try { this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
    setTimeout(() => { try { this.child && this.child.kill("SIGTERM"); } catch { /* gone */ } }, 500);
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.refreshUI();
  }

  done(result) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.job.stopReason = result && result.stopReason || "";
    if (this.assistantText) this.job.result = this.assistantText;
    this.d.saveJobs();
    this.close();
    this.d.onDone(this.job);
  }

  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.close();
    this.d.onError(this.job);
  }

  close() {
    if (this.sessionId) { try { this.send({ jsonrpc: "2.0", id: this.nextId++, method: "session/close", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
    setTimeout(() => { try { this.child && this.child.kill("SIGTERM"); } catch { /* gone */ } }, 1200);
    this.d.refreshUI();
  }
}

export function resolveDshModel(id) {
  // dynamic import would be circular; the catalog is passed through settings if custom
  const staticMap = {
    "deepseek-v4-pro": "[\"deepseek-account\",\"deepseek-v4-pro\"]",
    "deepseek-v41-flash": "[\"deepseek-account\",\"deepseek-flash\"]",
    "deepseek-v4-flash": "[\"deepseek-official\",\"deepseek-v4-flash\"]",
    "deepseek-v4-pro-official": "[\"deepseek-official\",\"deepseek-v4-pro\"]",
  };
  if (staticMap[id]) return { value: staticMap[id] };
  if (String(id || "").startsWith("[")) return { value: id };
  return null;
}

export function dshEffort(e) {
  const map = { off: "off", low: "low", medium: "high", high: "high", xhigh: "max", max: "max" };
  return map[e] || "high";
}

export class Delegator {
  constructor(plugin) {
    this.plugin = plugin;
    this.jobs = plugin.jobs;          // by id
    this.runners = new Map();         // id -> runner
    this.settings = plugin.settings;
    this.vaultPath = plugin.vaultPath;
  }

  refreshSettings() {
    this.settings = this.plugin.settings;
    this.vaultPath = this.plugin.vaultPath;
  }

  notice(text, ms) { this.plugin.notice(text, ms); }
  notify({ title, body }) { this.plugin.notice(`${title}\n${body}`, 12000); }

  get C() { return this.settings.delegate || DEFAULTS.delegate; }

  defaultTarget() { return this.C.target === "dsh" ? "dsh" : "claude"; }

  defaultModel(agent) {
    const a = this.C[agent] || {};
    return a.model || (agent === "dsh" ? "deepseek-v4-pro" : "claude-sonnet-5");
  }

  async delegate(opts) {
    this.refreshSettings();
    const agent = opts.agent === "dsh" ? "dsh" : "claude";
    const file = opts.file;
    if (!file) throw new Error("没有当前笔记");
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error("光标要放在一个列表项里");
    if (hasLink(lines, block) >= 0) throw new Error("这一块下面已经有 🔗 了；要重发先删掉那一行");
    const title = blockTitle(block) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title });
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent, name, path: file.path, line: block.start, lineText: lines[block.start],
      blockText: block.text.slice(0, 6000), prompt: prompt.slice(0, 12000),
      originalLine: lines[block.start],
      startedAt: Date.now(), state: "starting", model: opts.model || this.defaultModel(agent),
      effort: opts.effort || (agent === "dsh" ? this.C.dsh.effort : this.C.claude.effort),
      permission: opts.permission || (agent === "dsh" ? "" : this.C.claude.permission),
      cwd: opts.cwd || (agent === "dsh" ? this.C.dsh.cwd : this.C.claude.cwd) || this.vaultPath,
      sessionId: "", linkWritten: false, resultWritten: false,
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.plugin.refreshUI();
    this.plugin.notice(`🛫 正在委派给 ${agent === "dsh" ? "DeepSeek Harness" : "Claude Code"}：${name}`);
    const runner = agent === "dsh" ? new DshRunner(this, job) : new ClaudeRunner(this, job);
    this.runners.set(job.id, runner);
    try {
      await runner.start({ ...opts, prompt, name });
    } catch (e) {
      runner.fail && runner.fail(e && e.message || String(e));
    }
    return job;
  }

  buildPrompt(opts) {
    const c = this.C;
    const parts = [];
    if (c.promptPrefix && c.promptPrefix.trim()) parts.push(c.promptPrefix.trim());
    parts.push(opts.block.text.trim());
    if (opts.promptSuffix && opts.promptSuffix.trim()) parts.push(opts.promptSuffix.trim());
    else if (c.promptSuffix && c.promptSuffix.trim()) parts.push(c.promptSuffix.trim());
    if (opts.file) parts.push(`\n（来自 Obsidian：${opts.file.path}）`);
    return parts.join("\n\n");
  }

  onSession(job, sid) {
    job.sessionId = sid;
    job.state = "running";
    this.saveJobs();
    if (job.linkWritten) return;
    job.linkWritten = true;
    job._linkPromise = this.writeLink(job, sid).catch((e) => console.error("[agent-deck] writeLink", e));
    this.refreshUI();
  }

  async writeLink(job, sid) {
    if (!this.C.writeLink) return;
    const path = job.path;
    const text = await this.plugin.readNote(path);
    const lines = text.split("\n");
    let at = lines.findIndex((l) => l === job.lineText);
    if (at < 0) at = lines.findIndex((l) => blockTitle({ text: l }) && l.includes(truncate(job.name, 20)));
    if (at < 0) return;
    const block = blockAt(lines, at);
    if (!block) return;
    if (hasLink(lines, block) >= 0) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "\t";
    const link = linkLine(indent, job.agent, job.name, sid);
    lines.splice(block.start + 1, 0, link);
    if (this.C.markStatus) lines[block.start] = markDelegated(lines[block.start]);
    await this.plugin.writeNote(path, lines.join("\n"));
    job.line = block.start;
    job.lineText = lines[block.start];
    job.linkLineText = link;
    this.saveJobs();
  }

  async onDone(job) {
    try { if (job._linkPromise) await job._linkPromise; } catch { /* link failed */ }
    this.refreshUI();
    const agent = AGENTS[job.agent];
    this.plugin.notice(`✅ ${agent ? agent.name : job.agent} 做完了一轮：${job.name}\n点任务行旁边的按钮可以在客户端里打开会话`, 8000);
    if (this.C.claude.openDesktop === true && job.agent === "claude" && job.sessionId) openSession(this.plugin, "claude", job.sessionId);
    if (this.settings.autoWriteResult && job.linkWritten) {
      try { await this.writeResult(job); } catch (e) { console.error("[agent-deck] writeResult", e); }
    }
    this.plugin.refreshUI();
  }

  onError(job) {
    this.refreshUI();
    const err = String(job.error || "");
    if (/not trusted/i.test(err)) {
      this.plugin.notice(`Claude Code 不信任这个工作目录：\n${job.cwd}\n\n在终端里 cd 到那儿运行一次 claude，接受信任提示；或者在「委派」设置里把工作目录换成一个已经信任的目录。\n（这次没有真正跑起来，已经把 🔗 和 DELEGATED 撤回）`, 16000);
    } else if (/unknown option|invalid option|unrecognized/i.test(err)) {
      this.plugin.notice(`Claude Code 不认识传过去的参数：\n${err.slice(0, 300)}\n\n把「委派 → 额外参数」清空，或检查 claude --help。`, 12000);
    } else {
      this.plugin.notice(`⚠️ ${job.agent === "dsh" ? "DeepSeek Harness" : "Claude Code"} 没跑完：${job.name}\n${err || "详情见控制台"}`, 10000);
    }
    if (job.linkWritten && Date.now() - (job.startedAt || 0) < 12000 && /not trusted|unknown option|invalid option|unrecognized|ENOENT/i.test(err)) {
      this.removeLink(job).catch(() => {});
    }
    console.error("[agent-deck] delegate failed", job.id, job.error);
  }

  async removeLink(job) {
    try {
      const text = await this.plugin.readNote(job.path);
      const lines = text.split("\n");
      const sid = job.sessionId || "";
      let li = sid ? lines.findIndex((l) => l.includes(sid)) : -1;
      if (li < 0 && job.linkLineText) li = lines.indexOf(job.linkLineText);
      if (li >= 0) lines.splice(li, 1);
      let at = lines.indexOf(job.lineText);
      if (at < 0) at = lines.findIndex((l) => /DELEGATED/.test(l) && job.originalLine && l.includes(String(job.name || "").slice(0, 16)));
      if (at >= 0 && job.originalLine) lines[at] = job.originalLine;
      await this.plugin.writeNote(job.path, lines.join("\n"));
      job.linkWritten = false;
      job.resultWritten = true;
      this.saveJobs();
    } catch (e) { console.error("[agent-deck] removeLink", e); }
  }

  async writeResult(job) {
    if (job.resultWritten) return;
    let said = job.result || job.lastText || "";
    if (!said) {
      const meta = this.plugin.usage && this.plugin.usage.meta.get(job.sessionId);
      said = meta && (meta.lastText || "");
    }
    said = String(said || "").replace(/\s+/g, " ").trim();
    if (!said) return;
    const max = clamp(Number(this.settings.resultMax) || 240, 40, 2000);
    const text = await this.plugin.readNote(job.path);
    const lines = text.split("\n");
    let at = lines.indexOf(job.lineText);
    let block = at >= 0 ? blockAt(lines, at) : null;
    if (!block) {
      const li = lines.findIndex((l) => job.sessionId && l.includes(job.sessionId));
      if (li >= 0) {
        const indent = (lines[li].match(/^[ \t]*/) || [""])[0].length;
        let parent = -1;
        for (let i = li - 1; i >= 0; i--) {
          if (!lines[i].trim()) continue;
          const ind = (lines[i].match(/^[ \t]*/) || [""])[0].length;
          if (ind < indent) {
            if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) parent = i;
            break;
          }
        }
        if (parent >= 0) { at = parent; block = blockAt(lines, parent); }
      }
    }
    if (!block) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "\t";
    let resultAt = -1;
    for (let i = block.start + 1; i <= block.end; i++) if (RESULT_RE.test(lines[i])) { resultAt = i; break; }
    const line = `${indent}- 💬 ${truncate(said, max)}`;
    if (resultAt >= 0) lines[resultAt] = line;
    else {
      const link = findLink(lines, block);
      lines.splice((link ? link.line : block.start) + 1, 0, line);
    }
    await this.plugin.writeNote(job.path, lines.join("\n"));
    job.resultWritten = true;
    this.saveJobs();
  }

  cancel(id) {
    const runner = this.runners.get(id);
    const job = this.jobs[id];
    if (!job) return false;
    if (runner) runner.cancel();
    else { job.state = "cancelled"; job.endedAt = Date.now(); this.saveJobs(); }
    this.refreshUI();
    return true;
  }

  cancelForLine(path, lineText) {
    for (const job of Object.values(this.jobs)) {
      if (job.path === path && (job.lineText === lineText || job.line === lineText) && ["starting", "running", "needs-approval"].includes(job.state)) return job;
    }
    return null;
  }

  jobsFor(path) {
    return Object.values(this.jobs).filter((j) => j.path === path && j.state !== "cancelled").sort((a, b) => b.startedAt - a.startedAt);
  }

  jobForSession(sid) {
    return Object.values(this.jobs).find((j) => j.sessionId === sid);
  }

  saveJobs() {
    const clean = {};
    for (const [id, job] of Object.entries(this.jobs)) {
      const { _linkPromise, ...rest } = job;
      clean[id] = rest;
    }
    this.plugin.settings.jobs = clean;
    this.plugin.saveSettings();
  }

  refreshUI() {
    this.plugin.refreshUI();
  }
}

// ----- process helpers -----
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function spawnCapture(bin, args, { cwd, env, timeout = 30000 }) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let child;
    try { child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ ok: false, out: "", err: String(e && e.message || e) }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGTERM"); } catch { /* gone */ } resolve({ ok: false, out, err: err || "超时" }); } }, timeout);
    child.stdout.on("data", (b) => { out += b.toString(); if (out.length > 20000) out = out.slice(-20000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 10000) err = err.slice(-10000); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, out, err: String(e && e.message || e) }); });
    child.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, out, err, code }); });
  });
}

function execCapture(bin, args, { cwd, env, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, out, errOut) => {
      resolve({ ok: !err, out: String(out || ""), err: String(errOut || (err && err.message) || "") });
    });
  });
}
