// Agent-specific delegation runners & CLI environment helpers.
//
// Each runner implements start(opts) and cancel() against the Delegator
// host interface. New runner kinds can be registered via registerRunnerClass().

import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { spawn, execFile, execFileSync } from "child_process";
import { AGENTS, DEFAULTS, sandboxFor, SANDBOX_ALIAS, MODEL_CATALOG, truncate } from "./constants.js";
import { getAgentCapability } from "./agent-registry.js";
import { parseCustomAcpEnv } from "./custom-acp.js";
import { CodexDesktopRunner } from "./codex-desktop.js";
import { evaluatePermissionPolicy, redactSecrets, spawnCli, killChildProcess } from "./security.js";
import { t } from "./i18n.js";

const fsp = fs.promises;
const home = () => os.homedir();
const norm = (p) => String(p || "").replace(/^~(?=\/)/, home());

const AGENT_BINARY_SPECS = {
  codex: {
    fallback: "codex",
    candidates: () => [
      "/Applications/Codex.app/Contents/Resources/codex",
      path.join(home(), "Applications/Codex.app/Contents/Resources/codex"),
      path.join(home(), ".local/bin/codex"),
      path.join(home(), ".npm-global/bin/codex"),
      path.join(home(), ".bun/bin/codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ],
  },
  dsh: {
    fallback: "dsh",
    candidates: () => [
      "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
      path.join(home(), "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"),
      path.join(home(), ".local/bin/dsh"),
      path.join(home(), ".npm-global/bin/dsh"),
      "/opt/homebrew/bin/dsh",
      "/usr/local/bin/dsh",
    ],
  },
  antigravity: {
    fallback: "agy",
    candidates: () => [
      "/Applications/Antigravity.app/Contents/Resources/app/bin/agy",
      path.join(home(), "Applications/Antigravity.app/Contents/Resources/app/bin/agy"),
      path.join(home(), ".local/bin/agy"),
      path.join(home(), ".npm-global/bin/agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy",
    ],
  },
  opencode: {
    fallback: "opencode",
    candidates: () => [
      "/Applications/OpenCode.app/Contents/Resources/opencode-cli",
      path.join(home(), "Applications/OpenCode.app/Contents/Resources/opencode-cli"),
      path.join(home(), ".opencode/bin/opencode"),
      path.join(home(), ".local/bin/opencode"),
      path.join(home(), ".npm-global/bin/opencode"),
      path.join(home(), ".bun/bin/opencode"),
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
      path.join(home(), ".npm-global/bin/codebuddy"),
      "/opt/homebrew/bin/codebuddy",
      "/usr/local/bin/codebuddy",
    ],
  },
  hermes: {
    fallback: "hermes-acp",
    candidates: () => [
      ...hermesBinLocations("hermes-acp"),
      ...hermesBinLocations("hermes"),
    ],
  },
  gemini: {
    fallback: "gemini",
    candidates: () => [
      path.join(home(), ".local/bin/gemini"),
      path.join(home(), ".npm-global/bin/gemini"),
      path.join(home(), ".bun/bin/gemini"),
      "/opt/homebrew/bin/gemini",
      "/usr/local/bin/gemini",
    ],
  },
  cursor: {
    fallback: "agent",
    altFallbacks: ["cursor-agent"],
    candidates: () => process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local"), "cursor-agent", "agent.cmd"),
          path.join(process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local"), "cursor-agent", "agent.exe"),
          path.join(home(), ".local", "bin", "agent.exe"),
          path.join(home(), ".local", "bin", "agent.cmd"),
          path.join(home(), ".local", "bin", "cursor-agent.exe"),
          path.join(home(), ".local", "bin", "cursor-agent.cmd"),
        ]
      : [
          path.join(home(), ".local/bin/agent"),
          path.join(home(), ".local/bin/cursor-agent"),
          "/opt/homebrew/bin/agent",
          "/usr/local/bin/agent",
        ],
  },
  minimax: {
    fallback: "mcode",
    candidates: () => [
      path.join(home(), ".minimax-code/bin/mcode"),
      path.join(home(), ".local/bin/mcode"),
      path.join(home(), ".npm-global/bin/mcode"),
      path.join(home(), ".bun/bin/mcode"),
      "/opt/homebrew/bin/mcode",
      "/usr/local/bin/mcode",
    ],
  },
  t3code: {
    fallback: "t3",
    candidates: () => [
      path.join(home(), ".t3/bin/t3"),
      path.join(home(), ".local/bin/t3"),
      "/opt/homebrew/bin/t3",
      "/usr/local/bin/t3",
    ],
  },
  claude: {
    fallback: "claude",
    candidates: () => [
      path.join(home(), ".local/bin/claude"),
      path.join(home(), ".npm-global/bin/claude"),
      path.join(home(), ".bun/bin/claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    ],
  },
};

function scanGlobBins(baseDir, sub = "bin", reverse = false) {
  try {
    const ents = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    if (reverse) ents.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return ents.map((name) => (sub ? path.join(baseDir, name, sub) : path.join(baseDir, name)));
  } catch { return []; }
}

export function expandedPathEntries(basePath = process.env.PATH || "", homeDir = home()) {
  const sep = process.platform === "win32" ? ";" : ":";
  const parts = new Set(String(basePath || "").split(sep).filter(Boolean));
  const staticDirs = process.platform === "win32"
    ? [
        path.join(homeDir, ".local", "bin"),
        path.join(homeDir, ".bun", "bin"),
        path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "npm"),
        path.join(process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "pnpm"),
        path.join(homeDir, "scoop", "shims"),
      ]
    : [
        path.join(homeDir, ".local/bin"),
        ...scanGlobBins(path.join(homeDir, ".nvm/versions/node"), "bin", true),
        path.join(homeDir, ".volta/bin"),
        path.join(homeDir, ".fnm/aliases/default/bin"),
        path.join(homeDir, ".fnm/current/bin"),
        path.join(homeDir, ".npm-global/bin"),
        path.join(homeDir, "Library/pnpm"),
        path.join(homeDir, ".local/share/pnpm"),
        path.join(homeDir, ".bun/bin"),
        path.join(homeDir, ".cargo/bin"),
        ...scanGlobBins(path.join(homeDir, ".local/share/uv/tools"), "bin"),
        path.join(homeDir, ".pyenv/shims"),
        path.join(homeDir, ".pyenv/bin"),
        path.join(homeDir, "miniconda3/bin"),
        path.join(homeDir, "anaconda3/bin"),
        path.join(homeDir, "miniforge3/bin"),
        path.join(homeDir, "mambaforge/bin"),
        "/opt/homebrew/Caskroom/miniconda/base/bin",
        ...scanGlobBins("/opt/homebrew/opt", "bin"),
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ];
  for (const dir of staticDirs) parts.add(dir);
  return [...parts];
}

function findInPathDirs(name, dirs) {
  if (!name || String(name).includes("/") || String(name).includes("\\")) return "";
  // Windows 的 CreateProcess 只会自动补 .exe，裸名找不到 npm 装的 .cmd/.bat 包装脚本，
  // 且 npm 会在同目录放无后缀 POSIX sh 脚本，因此裸名先按 PATHEXT 试扩展名，最后兜底原名；
  // 已有扩展名时先试原名。POSIX 上 exts 只有空串，行为与原来一致。
  const pathext = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const exts = process.platform === "win32"
    ? (path.extname(name) ? ["", ...pathext] : [...pathext, ""])
    : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch { /* next */ }
    }
  }
  return "";
}

function resolveBinaryInEnv(configured, candidates, names) {
  const custom = configured && String(configured).trim();
  if (custom) {
    const p = norm(custom);
    try { if (fs.existsSync(p)) return p; } catch { /* fall through */ }
    return findInPathDirs(custom, expandedPathEntries());
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* next */ }
  }
  const dirs = expandedPathEntries();
  for (const name of names) {
    const hit = findInPathDirs(name, dirs);
    if (hit) return hit;
  }
  return "";
}

function findBinary(configured, candidates, fallback, altFallbacks = []) {
  const custom = configured && String(configured).trim();
  if (custom) return norm(custom);
  return resolveBinaryInEnv("", candidates, [fallback, ...altFallbacks]) || fallback;
}

export function resolveInstalledAgentBinary(agent, configured = "") {
  const spec = AGENT_BINARY_SPECS[agent];
  if (!spec) return resolveBinaryInEnv(configured, [], agent ? [agent] : []);
  return resolveBinaryInEnv(configured, spec.candidates(), [spec.fallback, ...(spec.altFallbacks || [])]);
}

export function findAgentBinary(agent, configured = "") {
  const spec = AGENT_BINARY_SPECS[agent];
  if (!spec) {
    const custom = configured && String(configured).trim();
    return custom ? norm(custom) : agent || "";
  }
  return findBinary(configured, spec.candidates(), spec.fallback, spec.altFallbacks || []);
}

function hermesBinLocations(name) {
  return [
    path.join(home(), `.local/bin/${name}`),
    path.join(home(), `.local/share/uv/tools/hermes-agent/bin/${name}`),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
}

export function findHermesCliBinary(configured = "") {
  const custom = configured && String(configured).trim();
  if (custom) {
    const normalized = norm(custom);
    if (path.basename(normalized) === "hermes-acp") {
      const sibling = path.join(path.dirname(normalized), "hermes");
      try { if (fs.existsSync(sibling)) return sibling; } catch { /* fallback below */ }
    } else return normalized;
  }
  return findBinary("", hermesBinLocations("hermes"), "hermes");
}

let cachedLoginShellPath = null;
export function resetLoginShellPathCache() { cachedLoginShellPath = null; }

export async function resolveLoginShellPath() {
  if (cachedLoginShellPath !== null) return cachedLoginShellPath;
  if (process.platform === "win32") return (cachedLoginShellPath = "");
  const shell = process.env.SHELL || "/bin/zsh";
  const marker = "__AD_PATH__";
  const res = await execCapture(shell, ["-lc", `printf "${marker}%s${marker}" "$PATH"`], { timeout: 3000 });
  const m = res.ok && /__AD_PATH__([\s\S]*?)__AD_PATH__/.exec(res.out || "");
  cachedLoginShellPath = m ? m[1].trim() : "";
  return cachedLoginShellPath;
}

export async function resolveExecutableWithFallback(bin, fallbackName = "") {
  if (!bin) return bin;
  if (bin.includes("/") || bin.includes("\\")) {
    try { if (fs.existsSync(bin)) return bin; } catch { /* try shell fallback if bare name available */ }
  }
  if (process.platform === "win32") {
    // Windows 没有 login shell（resolveLoginShellPath 直接返回空），改用 PATH + PATHEXT 找裸名。
    const hit = findInPathDirs(fallbackName || path.basename(bin), expandedPathEntries());
    return hit || bin;
  }
  const shellPath = await resolveLoginShellPath();
  if (!shellPath) return bin;
  const hit = findInPathDirs(fallbackName || path.basename(bin), shellPath.split(":").filter(Boolean));
  return hit || bin;
}

export const findDshBinary = (configured = "") => findAgentBinary("dsh", configured);
export const findAgyBinary = (configured = "") => findAgentBinary("antigravity", configured);
export const findOpenCodeBinary = (configured = "") => findAgentBinary("opencode", configured);
export const findQoderBinary = (configured = "") => findAgentBinary("qoder", configured);
export const findWorkbuddyBinary = (configured = "") => findAgentBinary("workbuddy", configured);
export const findClaudeBinary = (configured = "") => findAgentBinary("claude", configured);
export const findT3Binary = (configured = "") => findAgentBinary("t3code", configured);

function pickTrusted(list, vaultPath) {
  if (list.includes(vaultPath)) return vaultPath;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const trusted = list.filter((p) => isDir(p) && !/^\/(private\/)?(tmp|var)\//.test(p));
  const notAncestor = trusted.filter((p) => p !== vaultPath && !String(vaultPath).startsWith(p.replace(/\/+$/, "") + "/"));
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

let cachedSystemProxy = null;
let cachedSystemProxyAt = 0;

export function resetSystemProxyCache() {
  cachedSystemProxy = null;
  cachedSystemProxyAt = 0;
}

export function parseScutilProxy(text) {
  const out = {};
  if (!text || typeof text !== "string") return out;
  const scalar = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m").exec(text);
    return m ? m[1].trim() : "";
  };
  if (scalar("HTTPEnable") === "1" && scalar("HTTPProxy") && scalar("HTTPPort")) {
    out.HTTP_PROXY = out.http_proxy = `http://${scalar("HTTPProxy")}:${scalar("HTTPPort")}`;
  }
  if (scalar("HTTPSEnable") === "1" && scalar("HTTPSProxy") && scalar("HTTPSPort")) {
    out.HTTPS_PROXY = out.https_proxy = `http://${scalar("HTTPSProxy")}:${scalar("HTTPSPort")}`;
  }
  if (scalar("SOCKSEnable") === "1" && scalar("SOCKSProxy") && scalar("SOCKSPort")) {
    out.ALL_PROXY = out.all_proxy = `socks5://${scalar("SOCKSProxy")}:${scalar("SOCKSPort")}`;
  }
  if (!Object.keys(out).length) return out;
  const noProxy = new Set();
  const exc = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/m.exec(text);
  if (exc) {
    for (const line of exc[1].split(/\r?\n/)) {
      const m = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(line);
      const item = m ? m[1].trim() : "";
      if (item && item !== "<local>") noProxy.add(item);
    }
  }
  for (const base of ["127.0.0.1", "localhost", "::1"]) noProxy.add(base);
  out.NO_PROXY = out.no_proxy = [...noProxy].join(",");
  return out;
}

function readMacSystemProxyEnv() {
  if (process.platform !== "darwin") return {};
  const now = Date.now();
  if (cachedSystemProxy !== null && now - cachedSystemProxyAt < 60000) return cachedSystemProxy;
  try {
    const raw = execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 500, stdio: ["ignore", "pipe", "ignore"] });
    cachedSystemProxy = parseScutilProxy(raw);
  } catch {
    cachedSystemProxy = {};
  }
  cachedSystemProxyAt = now;
  return cachedSystemProxy;
}

export function cleanEnv(extra = {}) {
  const proxyKeys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
  const hasExplicitProxy = proxyKeys.some((k) => Boolean(process.env[k]) || (extra != null && Object.prototype.hasOwnProperty.call(extra, k)));
  const sysProxy = hasExplicitProxy ? {} : readMacSystemProxyEnv();
  const env = { ...sysProxy, ...process.env, ...extra };
  const sep = process.platform === "win32" ? ";" : ":";
  const base = cachedLoginShellPath ? `${env.PATH || ""}${sep}${cachedLoginShellPath}` : (env.PATH || "");
  env.PATH = expandedPathEntries(base).join(sep);
  return env;
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
    try { child = spawnCli(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ ok: false, out: "", err: String(e && e.message || e) }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGTERM"); } catch { /* gone */ } resolve({ ok: false, out, err: err || t("超时") }); } }, timeout);
    child.stdout.on("data", (b) => { out += b.toString(); if (out.length > 20000) out = out.slice(-20000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 10000) err = err.slice(-10000); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, out, err: String(e && e.message || e) }); });
    child.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, out, err, code }); });
  });
}

function execCapture(bin, args, { cwd, env, timeout = 10000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let child;
    try { child = spawnCli(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); }
    catch (e) { return resolve({ ok: false, out: "", err: String(e && e.message || e) }); }
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      killChildProcess(child, "SIGTERM");
      finish({ ok: false, out, err: err || t("超时") });
    }, timeout);
    child.stdout?.on("data", (b) => {
      out += b.toString();
      if (out.length > maxBuffer) out = out.slice(-maxBuffer);
    });
    child.stderr?.on("data", (b) => {
      err += b.toString();
      if (err.length > maxBuffer) err = err.slice(-maxBuffer);
    });
    child.on("error", (e) => finish({ ok: false, out, err: String(e && e.message || e) }));
    child.on("close", (code) => finish({ ok: code === 0, out, err }));
  });
}

// 内置模型在命令行里的名字（opus / sonnet …）；不在目录里的原样传
export function resolveCliModel(plugin, agent, model) {
  if (!model || model === `${agent}-default`) return "";
  const m = plugin?.modelById?.(model) || MODEL_CATALOG.find((m) => m.agent === agent && m.id === model);
  return m?.cli || m?.value || model;
}

export { sandboxFor, SANDBOX_ALIAS };

export function codexCliArgs(plugin, opts = {}) {
  const cfg = plugin.settings.delegate.codex || DEFAULTS.delegate.codex;
  const rawModel = opts.model !== undefined ? opts.model : (cfg.model !== undefined ? cfg.model : "");
  const model = resolveCliModel(plugin, "codex", rawModel);
  const effort = opts.effort || cfg.effort || "low";
  const sandbox = sandboxFor(opts.permission || opts.sandbox, cfg.sandbox || "workspace-write");
  return [...(model ? ["--model", model] : []), "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "--sandbox", sandbox];
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

function buildAcpModelEntry(agent, value, name, provider, description) {
  const builtin = MODEL_CATALOG.find((m) => m.agent === agent && m.value === value);
  return {
    id: builtin?.id || `${agent}-acp-${Buffer.from(value).toString("base64url")}`,
    agent,
    name: name || value,
    value,
    provider: provider || AGENTS[agent]?.name || agent,
    context: "—",
    tags: [],
    note: description || t("ACP 服务端返回的模型"),
  };
}

export function acpModels(agent, configOptions = [], modelsState = null) {
  const option = (Array.isArray(configOptions) ? configOptions : []).find((x) => x.category === "model" || x.id === "model");
  const result = [];
  for (const group of option?.options || []) {
    for (const item of group.options || [group]) {
      if (typeof item.value !== "string") continue;
      result.push(buildAcpModelEntry(agent, item.value, item.name, group.options ? group.name : "", item.description));
    }
  }
  if (!result.length && Array.isArray(modelsState?.availableModels)) {
    for (const item of modelsState.availableModels) {
      const value = typeof item?.modelId === "string" ? item.modelId : typeof item?.value === "string" ? item.value : typeof item?.id === "string" ? item.id : "";
      if (value) result.push(buildAcpModelEntry(agent, value, item.name, "", item.description));
    }
  }
  return result;
}

export function isAllowPermissionOption(option) {
  return /^(allow)|(^allow[_-])|\ballow\b|允许/i.test([option?.kind, option?.optionId, option?.name].filter(Boolean).join(" "));
}

export function pickPermissionOption(options = [], allow = true) {
  if (allow) {
    return options.find((o) => /^allow[_-]?once$/i.test(String(o?.kind || "")) || /^allow[_-]?once$/i.test(String(o?.optionId || "")))
      || options.find((o) => /^allow/i.test(String(o?.kind || "")))
      || options.find((o) => /^allow/i.test(String(o?.optionId || "")))
      || options.find((o) => /\ballow\b|允许/i.test(String(o?.name || "")))
      || options.find((o) => isAllowPermissionOption(o));
  }
  return options.find((o) => /^(reject[_-]?once|deny)$/i.test(String(o?.kind || "")) || /^(reject[_-]?once|deny)$/i.test(String(o?.optionId || "")))
    || options.find((o) => /^(reject|deny)/i.test(String(o?.kind || "")))
    || options.find((o) => /^(reject|deny)/i.test(String(o?.optionId || "")))
    || options.find((o) => /\b(reject|deny)\b|拒绝|取消/i.test(String(o?.name || "")));
}

export function acpSpawnArgs(agent, bin, extraArgs = "", cap = getAgentCapability(agent)) {
  const baseName = path.basename(String(bin || "")).replace(/\.(exe|cmd|bat)$/i, "");
  let sub = Array.isArray(cap?.acpArgs) ? [...cap.acpArgs] : ["acp"];
  if (!cap?.customAcp) {
    if (agent === "hermes" && baseName === "hermes") sub = ["acp"];
    else if (baseName.endsWith("-acp") && sub[0] === "acp") sub = [];
  }
  return [...sub, ...splitArgs(String(extraArgs || ""))];
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
    const usage = (this.job.contextUsed != null || this.job.contextSize != null)
      ? { contextUsed: this.job.contextUsed ?? null, contextSize: this.job.contextSize ?? null }
      : null;
    this.trace?.finalize(state, { error: this.job.error || "", transport: this.job.transport || "", usage });
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
    killChildProcess(this.child, "SIGTERM");
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
    const rawModel = opts.model !== undefined ? opts.model : (cfg.model !== undefined ? cfg.model : "claude-opus-5-5");
    const modelCli = resolveCliModel(d.plugin, "claude", rawModel);
    const effort = opts.effort || cfg.effort || "high";
    const permission = opts.permission || cfg.permission || "auto";
    const addVault = cfg.addVault !== false && d.vaultPath && d.vaultPath !== cwd;
    const common = [...(modelCli ? ["--model", modelCli] : []), "--effort", effort, "--permission-mode", permission, "-n", name];
    if (addVault) common.push("--add-dir", d.vaultPath);
    if (cfg.extraArgs && cfg.extraArgs.trim()) common.push(...splitArgs(cfg.extraArgs));
    const prompt = opts.prompt;
    if (cfg.useBackground === true && this.job.destination !== "background") {
      const args = ["--bg", ...common, "--", prompt];
      this.job.command = redactSecrets(`${bin} ${args.slice(0, -2).join(" ")} …`);
      this.trace?.recordFrame("claude.bg_spawn", `${path.basename(bin)} --bg`);
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
    this.job.command = redactSecrets(`${bin} ${args2.slice(0, -2).join(" ")} …`);
    this.trace?.recordFrame("claude.headless_spawn", `${path.basename(bin)} -p`);
    const child = spawnCli(bin, args2, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = redactSecrets(err.slice(-1000)); });
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
    const rawModel = this.job.model !== undefined ? this.job.model : (cfg.model !== undefined ? cfg.model : "claude-opus-5-5");
    const modelCli = resolveCliModel(this.d.plugin, "claude", rawModel);
    const addVault = cfg.addVault !== false && this.d.vaultPath && this.d.vaultPath !== (this.job.cwd || cfg.cwd);
    const out = [...(modelCli ? ["--model", modelCli] : []), "--effort", this.job.effort || cfg.effort || "high", "--permission-mode", this.job.permission || cfg.permission || "auto", "-n", this.job.name];
    if (addVault) out.push("--add-dir", this.d.vaultPath);
    return out;
  }

  onCleanup(reason) {
    if (reason !== "cancel") return;
    if (this.short) {
      const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
      execFile(bin, ["stop", this.short], { env: cleanEnv() }, () => {});
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
    const rawModel = opts.model !== undefined ? opts.model : (cfg.model !== undefined ? cfg.model : "qoder-ultimate");
    const model = resolveCliModel(d.plugin, "qoder", rawModel);
    const effort = opts.effort || cfg.effort || "high";
    const perm = opts.permission || cfg.permission || "auto";
    const sid = opts.sessionId || randomUUID();
    this.sessionId = sid;
    if (opts.sessionId) this.job.sessionId = sid;
    this.job.cwd = cwd;
    this.job.app = "cli";
    const sessionArgs = opts.sessionId ? ["-r", sid] : ["--session-id", sid];
    const args = ["-p", ...sessionArgs, "-w", cwd, ...(model ? ["-m", model] : []), "--reasoning-effort", effort, ...qoderPermissionArgs(perm)];
    if (!opts.sessionId && opts.name) args.push("-n", opts.name);
    if (d.vaultPath && cwd !== d.vaultPath) args.push("--add-dir", d.vaultPath);
    for (const a of splitArgs(cfg.extraArgs || "")) args.push(a);
    args.push("--", opts.prompt);
    this.job.command = redactSecrets([bin, ...args.slice(0, -1), "<prompt>"].join(" "));
    this.trace?.recordFrame("qoder.spawn", path.basename(bin));
    const child = spawnCli(bin, args, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
      this.job.stderr = redactSecrets(err.slice(-1000));
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
    this.trace?.recordFrame("qoder.fallback_desktop", "not logged in");
    this.trace?.finalize("handoff");
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
    const cap = getAgentCapability(this.agent);
    const cfg = d.settings?.delegate?.[this.agent] || {};
    const configuredBin = cfg.path || cap.acpCommand || "";
    let bin = findAgentBinary(this.agent, configuredBin);
    const hasPathSep = bin.includes("/") || bin.includes("\\");
    if (!hasPathSep || !fs.existsSync(bin)) {
      bin = await resolveExecutableWithFallback(bin, path.basename(bin));
    }
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    this.cwd = cwd;
    const model = opts.model !== undefined ? opts.model : (cfg.model !== undefined ? cfg.model : (cap.acpDefaultModel || ""));
    const effort = opts.effort || cfg.effort || cap.acpDefaultEffort || "";
    const spawnArgs = acpSpawnArgs(this.agent, bin, cfg.extraArgs || "", cap);
    const customEnv = cap.acpEnvRaw ? parseCustomAcpEnv(cap.acpEnvRaw) : {};
    this.job.command = redactSecrets([bin, ...spawnArgs].join(" "));
    this.trace?.recordFrame("acp.spawn", `${path.basename(bin)} ${spawnArgs.join(" ")}`);
    const child = spawnCli(bin, spawnArgs, { cwd, env: cleanEnv(customEnv), stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => this.onData(text));
    child.stdin.on("error", (e) => this.fail(e.message));
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = redactSecrets(err.slice(-1000)); });
    child.on("error", (e) => {
      if (e?.code === "ENOENT") {
        this.fail(t("找不到 {agent} 可执行文件「{bin}」，请确认已安装或已在设置中填写命令行路径", { agent: this.label, bin }));
      } else {
        this.fail(String(e && e.message || e));
      }
    });
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
      const modelsState = made?.models || null;
      const available = acpModels(this.agent, configOptions, modelsState);
      if (available.length) {
        const agentCfg = ((d.settings ||= {}).delegate ||= {})[this.agent] ||= {};
        agentCfg.availableModels = available;
        this.job.availableModels = available;
      }
      if (opts.discoverOnly) { this.done({}); return true; }
      this.job.state = "running";
      this.d.saveJobs();
      this.d.onSession(this.job, this.sessionId);
      const isDefault = (!model || model === `${this.agent}-default`) && cap.acpModelOptional;
      const modelOption = configOptions.find((x) => x.category === "model" || x.id === "model");
      const hasSessionModelPicker = Array.isArray(modelsState?.availableModels) && modelsState.availableModels.length > 0;
      if (opts.model && !isDefault && !modelOption && !hasSessionModelPicker) {
        throw new Error(t("{agent} 未提供模型选择", { agent: this.label }));
      }
      if (!isDefault && (!opts.sessionId || opts.model) && (modelOption || hasSessionModelPicker)) {
        const custom = this.d.plugin?.modelById?.(model);
        const builtin = MODEL_CATALOG.find((x) => x.agent === this.agent && (x.id === model || x.value === model));
        const selected = custom?.value || (this.agent === "dsh" ? resolveDshModel(model)?.value : (builtin?.value || builtin?.cli || model));
        if (!selected) throw new Error(t("无法识别 {agent} 模型：{model}", { agent: this.label, model }));
        if (modelOption) {
          const changed = await this.request("session/set_config_option", { sessionId: this.sessionId, configId: modelOption.id, value: selected }, 15000);
          configOptions = changed?.configOptions || configOptions;
        } else {
          await this.request("session/set_model", { sessionId: this.sessionId, modelId: selected }, 15000);
        }
      }
      const effortOption = configOptions.find((x) => x.category === "thought_level" || x.id === "reasoning_effort" || x.id === "variant");
      if (opts.effort && !effortOption && !cap.acpEffortOptional) throw new Error(t("{agent} 未提供推理强度选择", { agent: this.label }));
      if (effortOption && effort && (!opts.sessionId || opts.effort)) {
        const value = this.agent === "dsh" ? dshEffort(effort) : effort;
        if (!cap.acpAllowUnknownEffort && !effortOption.options?.some((o) => o.value === value)) {
          throw new Error(t("当前模型不支持推理强度 {value}", { value }));
        }
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
      if (msg.error) {
        const errMsg = msg.error.message || JSON.stringify(msg.error);
        this.trace?.recordFrame("acp.rpc_error", errMsg);
        p.reject(new Error(errMsg));
      } else p.resolve(msg.result);
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
        if (kind === "tool_call") this.trace?.recordFrame("acp.tool_call", name);
      } else if (kind === "usage_update") {
        this.job.contextUsed = u.used;
        this.job.contextSize = u.size;
      }
      this.d.saveJobsSoon();
      this.d.refreshUI();
      return;
    }
    if (method === "session/request_permission") {
      const cfg = this.d.settings?.delegate?.[this.agent] || {};
      const options = params.options || [];
      const policy = evaluatePermissionPolicy(params.toolCall, {
        cwd: this.cwd || cfg.cwd || this.d.vaultPath,
        vaultPath: this.d.vaultPath,
        autoApprove: cfg.autoApprove === true,
        allowlist: this.d.settings?.securityAllowlist || [],
      });
      this.trace?.recordFrame("acp.permission_request", `${params.toolCall?.title || params.toolCall?.kind || "tool"} [${policy.reason}]`);
      if (this.d.plugin?.requestAcpPermission && !policy.allowAuto) {
        this.job.state = "needs-approval";
        this.job.step = policy.escalated
          ? t("高风险操作需确认：{title}", { title: params.toolCall?.title || policy.risk })
          : (params.toolCall?.title || t("等待工具授权"));
        this.d.saveJobs(); this.d.refreshUI();
        const settlePermission = (selected, stepText = "") => {
          if (this.finished) return;
          this.trace?.recordPermission({
            tool: params.toolCall?.title || params.toolCall?.kind || "tool",
            mode: policy.escalated ? "policy_escalated" : "manual",
            outcome: selected ? "selected" : "cancelled",
            risk: policy.risk,
          });
          this.respond(msg.id, { outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" } });
          this.job.state = "running"; this.job.step = stepText;
          this.d.saveJobs(); this.d.refreshUI();
        };
        Promise.resolve().then(() => this.d.plugin.requestAcpPermission({
          agent: this.agent,
          toolCall: params.toolCall,
          options,
          policyReason: policy.reason,
          escalated: policy.escalated,
        }, this))
          .then((optionId) => settlePermission(options.find((o) => o.optionId === optionId), ""))
          .catch(() => settlePermission(null, t("工具调用已取消")));
        return;
      }
      const auto = policy.allowAuto === true;
      const option = pickPermissionOption(options, auto);
      this.trace?.recordPermission({
        tool: params.toolCall?.title || params.toolCall?.kind || "tool",
        mode: auto ? "auto_policy_ok" : (policy.escalated ? "escalated_headless_deny" : "headless_deny"),
        outcome: option ? "selected" : "cancelled",
        risk: policy.risk,
      });
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.trace?.recordFrame("acp.rpc_timeout", `${method} (${timeout}ms)`);
        reject(new Error(t("{method} 超时", { method })));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  onCleanup(reason) {
    this.permissionModal?.close();
    for (const m of this.permissionModals || []) m.close();
    this.permissionModals?.clear?.();
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
    for (const m of this.permissionModals || []) m.close();
    this.permissionModals?.clear?.();
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
      const timer = setTimeout(() => killChildProcess(this.child, "SIGTERM"), 1200);
      this.child.once("close", () => clearTimeout(timer));
      if (typeof timer?.unref === "function") timer.unref();
    }
    this.d.refreshUI();
  }
}

const CUSTOM_RUNNER_CLASSES = new Map();

export class T3CodeRunner extends BaseRunner {
  constructor(delegator, job) {
    super(delegator, job);
  }

  _parseJsonOutput(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { /* try last JSON line */ }
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("{")) continue;
      try { return JSON.parse(lines[i]); } catch { /* next */ }
    }
    return null;
  }

  _runOnce(bin, args, cwd, prompt) {
    return new Promise((resolve) => {
      const child = spawnCli(bin, args, { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      let out = "", err = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
        this.job.lastText = out.slice(-2000);
        this.d.saveJobsSoon();
        this.d.refreshUI();
      });
      child.stderr.on("data", (b) => {
        err += b.toString();
        if (err.length > 4000) err = err.slice(-4000);
        this.job.stderr = redactSecrets(err.slice(-1000));
      });
      child.on("error", (e) => resolve({ code: -1, out, err: String(e && e.message || e), spawnError: true, errCode: e?.code || "" }));
      child.on("close", (code) => resolve({ code: code ?? 1, out, err, spawnError: false }));
      try {
        child.stdin.write(prompt);
        child.stdin.end();
      } catch { /* closed early */ }
    });
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.t3code || DEFAULTS.delegate.t3code || {};
    const rawBin = findT3Binary(cfg.path || "");
    const bin = await resolveExecutableWithFallback(rawBin, path.basename(rawBin));
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    const extra = splitArgs(cfg.extraArgs || "");
    const isFollowUp = Boolean(opts.sessionId);
    const buildArgs = () => {
      if (isFollowUp) return ["thread", "send", opts.sessionId, "-", "--wait", "--json", ...extra];
      const args = ["thread", "start", cwd, "-", "--wait", "--json"];
      if (opts.name) args.push("--title", String(opts.name).slice(0, 80));
      args.push(...extra);
      return args;
    };

    const args = buildArgs();
    this.job.cwd = cwd;
    this.job.app = "desktop";
    if (opts.sessionId) this.job.sessionId = opts.sessionId;
    this.job.command = redactSecrets([bin, ...args].join(" "));
    this.trace?.recordFrame("t3code.spawn", path.basename(bin));
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.conversation ||= [];
    this.job.conversation.push({ role: "user", text: opts.prompt, at: Date.now() });
    this.timer = setTimeout(() => this.fail(t("委派超过 30 分钟没有结束")), 30 * 60000);

    let res = await this._runOnce(bin, args, cwd, opts.prompt);
    if (this.finished) return true;

    // Auto-register cwd as a T3 Code project if start failed because project isn't added yet.
    const combinedFirst = `${res.err}\n${res.out}`.trim();
    if (!isFollowUp && !res.spawnError && res.code !== 0 && /no project|project.*not found|not a project/i.test(combinedFirst)) {
      this.trace?.recordFrame("t3code.project_add", cwd);
      const addRes = await execCapture(bin, ["project", "add", cwd], { cwd, env: cleanEnv(), timeout: 10000 });
      if (addRes.ok && !this.finished) {
        res = await this._runOnce(bin, args, cwd, opts.prompt);
        if (this.finished) return true;
      }
    }

    const parsed = this._parseJsonOutput(res.out);
    const threadId = parsed?.threadId || opts.sessionId || "";
    if (threadId && !this.job.sessionId) this.d.onSession(this.job, threadId);

    if (res.code === 0) {
      this.done(parsed?.reply ?? res.out.trim());
    } else if (res.code === 2 || parsed?.status === "waiting") {
      this.done(parsed?.reply || t("T3 Code 正在等待你的回复，请在客户端继续"));
    } else if (res.spawnError && res.errCode === "ENOENT") {
      this.fail(t("找不到 {agent} 可执行文件「{bin}」，请确认已安装或已在设置中填写命令行路径", { agent: AGENTS.t3code.name, bin }));
    } else {
      const combined = parsed?.error || `${res.err}\n${res.out}`.trim();
      if (/ECONNREFUSED|not running|no running server|server.*unavailable/i.test(combined)) {
        this.fail(t("T3 Code 服务未运行，请先打开 T3 Code 桌面版或运行 t3 up"));
      } else {
        this.fail(combined || t("t3 退出码 {code}", { code: res.code }));
      }
    }
    return true;
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

export const BUILTIN_RUNNER_CLASSES = {
  claude: ClaudeRunner,
  codex: CodexDesktopRunner,
  acp: AcpRunner,
  qoder: QoderRunner,
  t3code: T3CodeRunner,
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
