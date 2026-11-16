// Agent-specific delegation runners & CLI environment helpers.
//
// Each runner implements start(opts) and cancel() against the Delegator
// host interface. New runner kinds can be registered via registerRunnerClass().

import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { spawn, execFile } from "child_process";
import { AGENTS, DEFAULTS, MODEL_CATALOG, truncate } from "./constants.js";
import { CodexDesktopRunner } from "./codex-desktop.js";
import { t } from "./i18n.js";
import { expandHome, localDataDir, mergePathEnv, resolveExecutable, spawnOptions, wrapSpawnCommand } from "./platform.js";

const fsp = fs.promises;
const home = () => os.homedir();
const norm = (p) => expandHome(p, home());

const AGENT_BINARY_SPECS = {
  codex: { fallback: "codex", candidates: () => [] },
  dsh: {
    fallback: "dsh",
    candidates: () => [
      "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
      path.join(home(), "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"),
      path.join(home(), ".local/bin/dsh"),
      "/opt/homebrew/bin/dsh",
      "/usr/local/bin/dsh",
    ],
  },
  antigravity: {
    fallback: "agy",
    candidates: () => [
      path.join(home(), ".local/bin/agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy",
    ],
  },
  opencode: {
    fallback: "opencode",
    candidates: () => [
      "/Applications/OpenCode.app/Contents/Resources/opencode-cli",
      path.join(home(), "Applications/OpenCode.app/Contents/Resources/opencode-cli"),
      path.join(home(), ".local/bin/opencode"),
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
    ],
  },
  qoder: {
    fallback: "qodercli",
    candidates: () => [
      path.join(home(), ".qoder/bin/qodercli/qodercli"),
      path.join(home(), ".local/bin/qodercli"),
      path.join(home(), ".local/bin/qoder"),
      path.join(home(), ".qoder/entry/qoder"),
      "/opt/homebrew/bin/qodercli",
      "/usr/local/bin/qodercli",
    ],
  },
  workbuddy: {
    fallback: "codebuddy",
    candidates: () => [
      path.join(home(), ".local/bin/codebuddy"),
      "/opt/homebrew/bin/codebuddy",
      "/usr/local/bin/codebuddy",
    ],
  },
  claude: {
    fallback: "claude",
    candidates: () => [
      path.join(home(), ".local/bin/claude"),
      path.join(localDataDir(), "Programs", "claude", "claude.exe"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    ],
  },
};

function findBinary(configured, candidates, fallback) {
  return resolveExecutable(fallback, configured, { candidates, homeDir: home() });
}

export function findAgentBinary(agent, configured = "") {
  const spec = AGENT_BINARY_SPECS[agent];
  if (!spec) {
    const custom = configured && String(configured).trim();
    return custom ? norm(custom) : agent || "";
  }
  return findBinary(configured, spec.candidates(), spec.fallback);
}

export const findDshBinary = (configured = "") => findAgentBinary("dsh", configured);
export const findAgyBinary = (configured = "") => findAgentBinary("antigravity", configured);
export const findOpenCodeBinary = (configured = "") => findAgentBinary("opencode", configured);
export const findQoderBinary = (configured = "") => findAgentBinary("qoder", configured);
export const findWorkbuddyBinary = (configured = "") => findAgentBinary("workbuddy", configured);
export const findClaudeBinary = (configured = "") => findAgentBinary("claude", configured);

function pickTrusted(list, vaultPath) {
  if (list.includes(vaultPath)) return vaultPath;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const isTemp = (p) => /^\/(?:private\/)?(?:tmp|var)\//i.test(p) || /^[a-z]:[\\/].*[\\/]temp(?:[\\/]|$)/i.test(p);
  const trusted = list.filter((p) => isDir(p) && !isTemp(p));
  const vp = String(vaultPath || "");
  const notAncestor = trusted.filter((p) => {
    const clean = p.replace(/[\\/]+$/, "");
    return p !== vp && !vp.startsWith(clean + "/") && !vp.startsWith(clean + "\\");
  });
  notAncestor.sort((a, b) => a.length - b.length);
  if (notAncestor.length) return notAncestor[0];
  trusted.sort((a, b) => a.length - b.length);
  return trusted[0] || vaultPath;
}

export async function findTrustedDir(vaultPath) {
  try {
    const projects = JSON.parse(await fsp.readFile(path.join(home(), ".claude.json"), "utf8")).projects || {};
    return pickTrusted(Object.keys(projects).filter((p) => projects[p] && projects[p].hasTrustDialogAccepted), vaultPath);
  } catch { return vaultPath; }
}

export async function findCodexTrustedDir(vaultPath) {
  try {
    const toml = await fsp.readFile(path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "config.toml"), "utf8");
    const list = [...toml.matchAll(/^\[projects\."([^"]+)"\]\s*\n\s*trust_level\s*=\s*"trusted"/gm)].map((m) => m[1]);
    return pickTrusted(list, vaultPath);
  } catch { return vaultPath; }
}

export function cleanEnv(extra = {}) {
  return mergePathEnv(process.env, { extra, homeDir: home() });
}

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
    const launch = wrapSpawnCommand(bin, args, { env });
    try { child = spawn(launch.command, launch.args, spawnOptions(launch, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })); }
    catch (e) { return resolve({ ok: false, out: "", err: String(e && e.message || e) }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGTERM"); } catch { /* gone */ } resolve({ ok: false, out, err: err || t("超时") }); } }, timeout);
    child.stdout.on("data", (b) => { out += b.toString(); if (out.length > 20000) out = out.slice(-20000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 10000) err = err.slice(-10000); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, out, err: String(e && e.message || e) }); });
    child.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, out, err, code }); });
  });
}

function execCapture(bin, args, { cwd, env, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const launch = wrapSpawnCommand(bin, args, { env });
    execFile(launch.command, launch.args, spawnOptions(launch, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }), (err, out, errOut) => {
      resolve({ ok: !err, out: String(out || ""), err: String(errOut || (err && err.message) || "") });
    });
  });
}

// 内置模型在命令行里的名字（opus / sonnet …）；不在目录里的原样传
export function resolveCliModel(plugin, agent, model) {
  const m = plugin?.modelById?.(model) || MODEL_CATALOG.find((m) => m.agent === agent && m.id === model);
  return m?.cli || m?.value || model;
}

export function codexCliArgs(plugin, opts = {}) {
  const cfg = plugin.settings.delegate.codex || DEFAULTS.delegate.codex;
  const model = resolveCliModel(plugin, "codex", opts.model || cfg.model);
  const effort = opts.effort || cfg.effort || "low";
  return ["--model", model, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "--sandbox", cfg.sandbox || "workspace-write"];
}

export function resolveDshModel(id) {
  const m = MODEL_CATALOG.find((x) => x.agent === "dsh" && x.id === id);
  if (m) return { value: m.value };
  if (String(id || "").startsWith("[")) return { value: id };
  return null;
}

export function dshEffort(e) {
  const map = { off: "off", low: "low", medium: "high", high: "high", xhigh: "max", max: "max" };
  return map[e] || "high";
}

export function acpModels(agent, configOptions) {
  const option = configOptions.find((x) => x.category === "model" || x.id === "model");
  const result = [];
  for (const group of option?.options || []) {
    for (const item of group.options || [group]) {
      if (typeof item.value !== "string") continue;
      const builtin = MODEL_CATALOG.find((m) => m.agent === agent && m.value === item.value);
      result.push({
        id: builtin?.id || `${agent}-acp-${Buffer.from(item.value).toString("base64url")}`,
        agent,
        name: item.name || item.value,
        value: item.value,
        provider: group.options ? group.name : AGENTS[agent].name,
        context: "—",
        tags: [],
        note: item.description || t("ACP 服务端返回的模型"),
      });
    }
  }
  return result;
}

export function dshModels(configOptions) {
  return acpModels("dsh", configOptions);
}

// ----- Shared runner lifecycle base -----
class BaseRunner {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.finished = false;
    this.timer = null;
    this.sessionTimer = null;
    this.pollTimer = null;
  }

  _clearTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.sessionTimer);
    clearTimeout(this.pollTimer);
    this.timer = null;
    this.sessionTimer = null;
    this.pollTimer = null;
  }

  _finish(state, beforeSave) {
    if (this.finished) return false;
    this.finished = true;
    this._clearTimers();
    beforeSave?.();
    this.job.state = state;
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    return true;
  }

  _recordAssistantText(text, { updateLastText = false } = {}) {
    if (!text) return;
    this.job.result = text;
    if (updateLastText) this.job.lastText = text.slice(-2000);
    this.job.conversation ||= [];
    this.job.conversation.push({ role: "assistant", text, at: Date.now() });
  }

  _killChild() {
    if (this.child) {
      try { this.child.kill("SIGTERM"); } catch { /* gone */ }
    }
  }

  cancel() {
    if (!this._finish("cancelled", () => this.onCleanup("cancel"))) return;
    this.onAfterCancel?.();
  }

  done(result) {
    if (!this._finish("done", () => this.onDoneCleanup?.(result))) return;
    this.onAfterDone?.();
    this.d.onDone(this.job);
  }

  fail(message) {
    if (!this._finish("error", () => {
      this.onCleanup("fail");
      this.job.error = String(message || "").slice(0, 500);
    })) return;
    this.onAfterFail?.();
    this.d.onError(this.job);
  }

  onCleanup(_reason) {}
}

// ----- Claude Code -----
export class ClaudeRunner extends BaseRunner {
  constructor(delegator, job) {
    super(delegator, job);
    this.short = "";
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
          d.notice(t("Claude Code 没有信任库目录，改在 {cwd} 里跑；库已经用 --add-dir 加进去了。", { cwd }));
        }
      }
    }
    const model = opts.model || cfg.model || "claude-opus-5-5";
    const modelCli = resolveCliModel(d.plugin, "claude", model);
    const effort = opts.effort || cfg.effort || "high";
    const permission = opts.permission || cfg.permission || "auto";
    const addVault = cfg.addVault !== false && d.vaultPath && d.vaultPath !== cwd;
    const common = ["--model", modelCli, "--effort", effort, "--permission-mode", permission, "-n", name];
    if (addVault) common.push("--add-dir", d.vaultPath);
    if (cfg.extraArgs && cfg.extraArgs.trim()) common.push(...splitArgs(cfg.extraArgs));
    const prompt = opts.prompt;
    if (cfg.useBackground === true && this.job.destination !== "background") {
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
    const sid = randomUUID();
    const args2 = ["-p", "--session-id", sid, ...common, "--", prompt];
    this.job.command = `${bin} ${args2.slice(0, -2).join(" ")} …`;
    const env = cleanEnv();
    const launch = wrapSpawnCommand(bin, args2, { env });
    const child = spawn(launch.command, launch.args, spawnOptions(launch, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }));
    this.child = child;
    this.fallbackStarted = true;
    this.job.sessionId = sid;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.short = "";
    this.job.agentState = "headless";
    let err = "";
    const output = [];
    this.job.conversation = [{ role: "user", text: prompt, at: Date.now() }];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", s => { output.push(s); this.job.lastText = ((this.job.lastText || "") + s).slice(-2000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("close", (code) => {
      if (this.finished) return;
      if (code === 0) {
        this.job.result = output.join("");
        this.job.conversation.push({ role: "assistant", text: this.job.result, at: Date.now() });
        this.done();
      }
      else this.fail(err.trim() || t("claude 退出码 {code}", { code }));
    });
    this.d.saveJobs();
    this.d.onSession(this.job, sid);
    if (this.d.C.claude.useBackground === true) this.d.notice?.(t("Claude 后台服务没起来，已改用无头会话（答完可以点任务行打开）"));
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
    const model = this.job.model || cfg.model || "claude-opus-5-5";
    const modelCli = resolveCliModel(this.d.plugin, "claude", model);
    const addVault = cfg.addVault !== false && this.d.vaultPath && this.d.vaultPath !== (this.job.cwd || cfg.cwd);
    const out = ["--model", modelCli, "--effort", this.job.effort || cfg.effort || "high", "--permission-mode", this.job.permission || cfg.permission || "auto", "-n", this.job.name];
    if (addVault) out.push("--add-dir", this.d.vaultPath);
    return out;
  }

  onCleanup(reason) {
    if (reason !== "cancel") return;
    if (this.short) {
      const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
      const env = cleanEnv();
      const launch = wrapSpawnCommand(bin, ["stop", this.short], { env });
      execFile(launch.command, launch.args, spawnOptions(launch, { env }), () => {});
    }
    this._killChild();
  }
}

// ----- Qoder CLI: one-shot headless execution with Desktop handoff fallback -----
export function qoderPermissionArgs(permission) {
  if (permission === "plan") return ["--work-mode", "spec", "--permission-mode", "default"];
  if (permission === "acceptEdits") return ["--permission-mode", "accept_edits"];
  if (permission === "manual") return ["--permission-mode", "default"];
  return ["--permission-mode", "auto"];
}

export class QoderRunner extends BaseRunner {
  constructor(delegator, job) {
    super(delegator, job);
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.qoder || DEFAULTS.delegate.qoder;
    const bin = findQoderBinary(cfg.path || "");
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    const model = resolveCliModel(d.plugin, "qoder", opts.model || cfg.model || "qoder-ultimate");
    const effort = opts.effort || cfg.effort || "high";
    const perm = opts.permission || cfg.permission || "auto";
    const sid = opts.sessionId || randomUUID();
    this.sessionId = sid;
    if (opts.sessionId) this.job.sessionId = sid;
    this.job.cwd = cwd;
    this.job.app = "cli";
    const sessionArgs = opts.sessionId ? ["-r", sid] : ["--session-id", sid];
    const args = ["-p", ...sessionArgs, "-w", cwd, "-m", model, "--reasoning-effort", effort, ...qoderPermissionArgs(perm)];
    if (!opts.sessionId && opts.name) args.push("-n", opts.name);
    if (d.vaultPath && cwd !== d.vaultPath) args.push("--add-dir", d.vaultPath);
    for (const a of splitArgs(cfg.extraArgs || "")) args.push(a);
    args.push("--", opts.prompt);
    this.job.command = [bin, ...args.slice(0, -1), "<prompt>"].join(" ");
    const env = cleanEnv();
    const launch = wrapSpawnCommand(bin, args, { env });
    const child = spawn(launch.command, launch.args, spawnOptions(launch, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }));
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.conversation ||= [];
    this.job.conversation.push({ role: "user", text: opts.prompt, at: Date.now() });
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      if (this.finished) return;
      this.d.onSession(this.job, this.sessionId);
    }, 250);
    let out = "", err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      out += text;
      this.job.lastText = out.slice(-2000);
      this.d.saveJobsSoon();
      this.d.refreshUI();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
      if (err.length > 4000) err = err.slice(-4000);
      this.job.stderr = err.slice(-1000);
    });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("close", (code) => {
      if (this.finished) return;
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
      const combined = `${err}\n${out}`.trim();
      if (code !== 0 && /not logged in|qodercli login/i.test(combined)) {
        if (this.job.destination === "background") this.fail(combined);
        else this.fallbackToDesktop(opts.prompt);
        return;
      }
      if (code === 0) {
        if (!this.job.sessionId) this.d.onSession(this.job, this.sessionId);
        this.done(out);
      } else {
        this.fail(combined || t("qoder 退出码 {code}", { code }));
      }
    });
    this.timer = setTimeout(() => this.fail(t("委派超过 30 分钟没有结束")), 30 * 60000);
    return true;
  }

  fallbackToDesktop(prompt) {
    this.finished = true;
    clearTimeout(this.timer);
    this.job.handoff = true;
    this.job.cli = false;
    this.job.app = "";
    this.job.sessionId = "";
    this.job.state = "starting";
    this.job.step = t("等你在 {agent} 里发出去", { agent: AGENTS.qoder.name });
    this.d.saveJobs();
    this.d.copyText(prompt);
    this.d.openAgentApp("qoder");
    this.d.notice(t("📋 Qoder CLI 尚未登录，已复制任务并打开 Qoder 桌面版（也可在设置里登录 CLI）"), 10000);
    this.d.refreshUI();
  }

  onCleanup() {
    this._killChild();
  }

  onDoneCleanup(result) {
    this._recordAssistantText(result, { updateLastText: true });
  }

  onAfterCancel() {
    this.d.refreshUI();
  }
}

// ----- Local ACP agents: Harness, Antigravity, and OpenCode -----
export class AcpRunner extends BaseRunner {
  constructor(delegator, job) {
    super(delegator, job);
    this.agent = job.agent || "dsh";
    this.label = AGENTS[this.agent]?.name || this.agent;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.assistantText = "";
    this.lastStep = "";
    this.sessionId = "";
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate[this.agent];
    const bin = findAgentBinary(this.agent, cfg.path || "");
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    const model = opts.model || cfg.model || (this.agent === "dsh" ? "deepseek-v4-pro" : "");
    const effort = opts.effort || cfg.effort || (this.agent === "dsh" ? "high" : "");
    this.job.command = `${bin} acp`;
    const env = cleanEnv();
    const launch = wrapSpawnCommand(bin, ["acp", ...splitArgs(cfg.extraArgs || "")], { env });
    const child = spawn(launch.command, launch.args, spawnOptions(launch, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }));
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => this.onData(text));
    child.stdin.on("error", (e) => this.fail(e.message));
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      this.fail(err.trim() || t("{agent} ACP 提前退出（{code}）", { agent: this.label, code }));
    });
    try {
      const init = await this.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 30000);
      this.capabilities = init?.agentCapabilities || {};
      if (opts.sessionId && !this.capabilities.sessionCapabilities?.resume && !this.capabilities.loadSession) {
        throw new Error(t("{agent} 未声明会话恢复能力，请升级后再续聊", { agent: this.label }));
      }
      const method = opts.sessionId ? (this.capabilities.sessionCapabilities?.resume ? "session/resume" : "session/load") : "session/new";
      this.loadingSession = !!opts.sessionId;
      const made = await this.request(method, { cwd, mcpServers: [], ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) }, 60000);
      this.loadingSession = false;
      if (this.finished) return false;
      this.sessionId = opts.sessionId || made?.sessionId || made?.session_id;
      if (!this.sessionId) throw new Error(t("{agent} 没有返回会话号", { agent: this.label }));
      this.job.sessionId = this.sessionId;
      this.job.transport = "acp";
      let configOptions = made?.configOptions || [];
      const available = acpModels(this.agent, configOptions);
      if (available.length) {
        cfg.availableModels = available;
        this.job.availableModels = available;
      }
      if (opts.discoverOnly) { this.done({}); return true; }
      this.job.state = "running";
      this.d.saveJobs();
      this.d.onSession(this.job, this.sessionId);
      const isDefault = (this.agent === "antigravity" || this.agent === "opencode") && (!model || model === `${this.agent}-default`);
      const modelOption = configOptions.find((x) => x.category === "model" || x.id === "model");
      if (opts.model && !isDefault && !modelOption) throw new Error(t("{agent} 未提供模型选择", { agent: this.label }));
      if (modelOption && !isDefault && (!opts.sessionId || opts.model)) {
        const custom = this.d.plugin?.modelById?.(model);
        const selected = custom?.value || (this.agent === "dsh" ? resolveDshModel(model)?.value : model);
        if (!selected) throw new Error(t("无法识别 {agent} 模型：{model}", { agent: this.label, model }));
        const changed = await this.request("session/set_config_option", { sessionId: this.sessionId, configId: modelOption.id, value: selected }, 15000);
        configOptions = changed?.configOptions || configOptions;
      }
      const effortOption = configOptions.find((x) => x.category === "thought_level" || x.id === "reasoning_effort" || x.id === "variant");
      if (opts.effort && !effortOption && this.agent !== "opencode") throw new Error(t("{agent} 未提供推理强度选择", { agent: this.label }));
      if (effortOption && effort && (!opts.sessionId || opts.effort)) {
        const value = this.agent === "dsh" ? dshEffort(effort) : effort;
        if (this.agent === "antigravity" && !effortOption.options?.some((o) => o.value === value)) throw new Error(t("当前模型不支持推理强度 {value}", { value }));
        await this.request("session/set_config_option", { sessionId: this.sessionId, configId: effortOption.id, value }, 15000);
      }
      if (this.finished) return false;
      this.job.conversation ||= [];
      this.job.conversation.push({ role: "user", text: opts.prompt, at: Date.now() });
      this.timer = setTimeout(() => this.fail(t("委派超过 30 分钟没有结束")), 30 * 60000);
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
    if (this.finished) return;
    const method = msg.method;
    if (!method) return;
    const params = msg.params || {};
    if (method === "session/update") {
      const u = params.update || {};
      const kind = u.sessionUpdate;
      if (kind === "agent_message_chunk" && !this.loadingSession) {
        const t = u.content && u.content.text;
        if (t) { this.assistantText += t; this.job.lastText = this.assistantText.slice(-2000); }
      } else if (kind === "agent_thought_chunk") {
        const t = u.content && u.content.text;
        if (t) this.job.thought = t.slice(-500);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const name = u.title || u.kind || u.toolName || "tool";
        this.lastStep = truncate(name, 40);
        this.job.step = this.lastStep;
        if (this.job.state !== "needs-approval") this.job.state = "running";
      } else if (kind === "usage_update") {
        this.job.contextUsed = u.used;
        this.job.contextSize = u.size;
      }
      this.d.saveJobsSoon();
      this.d.refreshUI();
      return;
    }
    if (method === "session/request_permission") {
      const cfg = this.d.settings.delegate[this.agent];
      const options = params.options || [];
      if (this.d.plugin?.requestAcpPermission && cfg.autoApprove !== true) {
        this.job.state = "needs-approval";
        this.job.step = params.toolCall?.title || t("等待工具授权");
        this.d.saveJobs(); this.d.refreshUI();
        Promise.resolve().then(() => this.d.plugin.requestAcpPermission({ agent: this.agent, toolCall: params.toolCall, options }, this))
          .then((optionId) => {
            if (this.finished) return;
            const selected = options.find((o) => o.optionId === optionId);
            this.respond(msg.id, { outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" } });
            this.job.state = "running"; this.job.step = "";
            this.d.saveJobs(); this.d.refreshUI();
          }).catch(() => {
            if (this.finished) return;
            this.respond(msg.id, { outcome: { outcome: "cancelled" } });
            this.job.state = "running"; this.job.step = t("工具调用已取消");
            this.d.saveJobs(); this.d.refreshUI();
          });
        return;
      }
      const auto = cfg.autoApprove === true;
      const option = options.find((o) => o.kind === (auto ? "allow_once" : "reject_once"));
      if (!auto) {
        this.job.step = t("工具调用已拒绝");
        this.d.notify({ title: t("{agent} 需要你允许", { agent: this.label }), body: t("「{name}」的工具调用已拒绝。可在委派设置中调整权限后重试。", { name: this.job.name }), job: this.job });
      }
      this.respond(msg.id, { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } });
      return;
    }
    if (msg.id != null) this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unsupported method: ${method}` } });
  }

  respond(id, result) { this.send({ jsonrpc: "2.0", id, result }); }

  send(o) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) return;
    try { this.child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* closed */ }
  }

  request(method, params, timeout = 20000) {
    if (this.finished) return Promise.reject(new Error(t("{agent} 连接已关闭", { agent: this.label })));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(t("{method} 超时", { method }))); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  onCleanup(reason) {
    this.permissionModal?.close();
    this.clearPending();
    if (reason === "cancel") {
      if (this.sessionId) { try { this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
      this.close();
    }
  }

  onAfterCancel() {
    this.d.refreshUI();
  }

  onDoneCleanup(result) {
    this.permissionModal?.close();
    this.clearPending();
    this.job.stopReason = result && result.stopReason || "";
    this._recordAssistantText(this.assistantText);
  }

  onAfterDone() {
    this.close();
  }

  onAfterFail() {
    this.close();
  }

  clearPending() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(t("{agent} 连接已结束", { agent: this.label }))); }
    this.pending.clear();
  }

  close() {
    if (this.sessionId && this.capabilities?.sessionCapabilities?.close) { try { this.send({ jsonrpc: "2.0", id: this.nextId++, method: "session/close", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
    if (this.child) {
      this.child.stdin.end();
      const timer = setTimeout(() => { try { this.child.kill("SIGTERM"); } catch { /* gone */ } }, 1200);
      this.child.once("close", () => clearTimeout(timer));
      timer.unref();
    }
    this.d.refreshUI();
  }
}

const CUSTOM_RUNNER_CLASSES = new Map();

export const BUILTIN_RUNNER_CLASSES = {
  claude: ClaudeRunner,
  codex: CodexDesktopRunner,
  acp: AcpRunner,
  qoder: QoderRunner,
};

export function registerRunnerClass(kind, RunnerClass) {
  const key = String(kind || "").trim();
  if (!key || typeof RunnerClass !== "function") throw new Error("Runner class requires kind and constructor");
  CUSTOM_RUNNER_CLASSES.set(key, RunnerClass);
  return () => CUSTOM_RUNNER_CLASSES.delete(key);
}

export function getRunnerClasses(overrides = {}) {
  return {
    ...BUILTIN_RUNNER_CLASSES,
    ...Object.fromEntries(CUSTOM_RUNNER_CLASSES),
    ...overrides,
  };
}
