// Agent Deck — headless model calls used by journaling, semantic IDs, and Dream.
//
// Supports locally logged-in CLIs (Antigravity, Claude, Codex, Qoder, CodeBuddy)
// plus user-configured OpenAI-compatible HTTP endpoints. All CLI modes avoid
// tool execution and skip polluting user history.

import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import { spawn, execFile } from "child_process";
import { t } from "./i18n.js";
import { summarizeAutoTitle, stripTaskKeyword } from "./journal.js";
import { resolveSecret, redactSecrets, spawnCli, killChildProcess } from "./security.js";
import { cleanEnv, expandedPathEntries } from "./cli-env.js";

const home = () => os.homedir();

// Windows 上 .cmd 包装脚本被杀掉后，真正的子进程可能还短暂持有临时目录，
// 直接 rmSync 会抛 EPERM/EBUSY 并把真正的错误盖掉。重试几次，仍失败就留给系统清理。
function rmTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); }
  catch { /* 临时目录，交给系统回收 */ }
}

function workDir() {
  const dir = path.join(os.tmpdir(), "agent-deck-autolog");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* temp unavailable */ }
  return dir;
}

function buildEnv(env = process.env) {
  if (env === process.env) return cleanEnv();
  return { ...env, PATH: expandedPathEntries(env?.PATH || "").join(path.delimiter) };
}

function resolveBin(name, configured = "", homeDir = home(), env = process.env) {
  const custom = String(configured || "").trim();
  if (custom) return custom;
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = [
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".qoder", "bin", "qodercli"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...String(env.PATH || "").split(path.delimiter).filter(Boolean),
  ];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, `${name}${ext}`);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return "";
}

function hasClaudeSettingsAuth(homeDir) {
  try {
    const raw = fs.readFileSync(path.join(homeDir, ".claude", "settings.json"), "utf8");
    const env = JSON.parse(raw)?.env;
    return Boolean(env && (String(env.ANTHROPIC_AUTH_TOKEN || "").trim() || String(env.ANTHROPIC_API_KEY || "").trim()));
  } catch {
    return false;
  }
}

export const JOURNAL_CLI_ORDER = ["agy", "claude", "codex", "qodercli", "codebuddy", "deepseek"];

export const JOURNAL_PROVIDERS = {
  agy: {
    id: "agy",
    label: "Antigravity (agy)",
    binName: "agy",
    delegateKey: "antigravity",
    defaultModel: "gemini-3.8-flash-low",
    models: ["gemini-3.8-flash-low", "gemini-4-argon-low", "claude-sonnet-5-5-medium", "claude-opus-5-5-low", "gpt-oss-120b-medium"],
    loggedIn: (h) => fs.existsSync(path.join(h, ".gemini", "antigravity")),
  },
  claude: {
    id: "claude",
    label: "Claude CLI",
    binName: "claude",
    delegateKey: "claude",
    defaultModel: "haiku",
    models: ["haiku", "sonnet", "claude-opus-5-5", "fable"],
    loggedIn: (h, env) => fs.existsSync(path.join(h, ".claude", ".credentials.json")) || fs.existsSync(path.join(h, ".claude.json")) || Boolean(String(env?.ANTHROPIC_API_KEY || env?.ANTHROPIC_AUTH_TOKEN || "").trim()) || hasClaudeSettingsAuth(h),
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    binName: "codex",
    delegateKey: "codex",
    defaultModel: "gpt-6-luna",
    models: ["gpt-6-luna", "gpt-5.6-luna", "gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"],
    loggedIn: (h, env) => fs.existsSync(path.join(h, ".codex", "auth.json")) || Boolean(env.OPENAI_API_KEY),
  },
  qodercli: {
    id: "qodercli",
    label: "Qoder CLI",
    binName: "qodercli",
    delegateKey: "qoder",
    defaultModel: "auto",
    models: ["auto", "ultimate", "q38max"],
    loggedIn: (h) => fs.existsSync(path.join(h, ".qoder")),
  },
  // 走 deepseek-ds 包装脚本：隔离配置目录 + 从 keychain 取 key，不影响官方 gemini CLI。
  deepseek: {
    id: "deepseek",
    label: "DeepSeek CLI",
    binName: "deepseek-ds",
    delegateKey: "",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"],
    loggedIn: (h) => fs.existsSync(path.join(h, ".local", "bin", "deepseek-ds")),
  },
  codebuddy: {
    id: "codebuddy",
    label: "CodeBuddy CLI",
    binName: "codebuddy",
    delegateKey: "workbuddy",
    defaultModel: "",
    models: [],
    loggedIn: (h) => fs.existsSync(path.join(h, ".codebuddy")),
  },
};

export const API_PRESETS = [
  { id: "deepseek", label: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" },
  { id: "qwen", label: "阿里云百炼 (Qwen)", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "ollama", label: "Ollama (本地)", url: "http://127.0.0.1:11434/v1", model: "qwen2.5:14b" },
];

export function detectJournalProviders({ homeDir = home(), env = process.env, cfg = {} } = {}) {
  const providers = JOURNAL_CLI_ORDER.map((id) => {
    const spec = JOURNAL_PROVIDERS[id];
    const configuredBin = cfg.delegate?.[spec.delegateKey]?.path || "";
    const bin = resolveBin(spec.binName, configuredBin, homeDir, env);
    const found = Boolean(bin);
    let loggedIn = false;
    try { loggedIn = Boolean(spec.loggedIn(homeDir, env)); } catch { loggedIn = false; }
    return {
      id,
      label: spec.label,
      bin,
      found,
      loggedIn,
      available: found && loggedIn,
      defaultModel: spec.defaultModel,
      models: spec.models,
    };
  });
  const available = providers.filter((p) => p.available);
  const recommended = (available[0] || providers.find((p) => p.found) || providers[0]).id;
  return { providers, available, recommended };
}

function inferProviderFromPath(binPath) {
  const base = path.basename(String(binPath || "").trim());
  if (/agy/i.test(base)) return "agy";
  if (/codex/i.test(base)) return "codex";
  if (/qoder/i.test(base)) return "qodercli";
  if (/codebuddy/i.test(base)) return "codebuddy";
  if (/deepseek/i.test(base)) return "deepseek";
  return "claude";
}

export function resolveJournalProvider(cfg = {}, { homeDir = home(), env = process.env } = {}) {
  const explicit = cfg.autoLogProvider;
  if (!explicit) return "claude";
  if (explicit === "auto") {
    if (String(cfg.autoLogPath || "").trim()) return inferProviderFromPath(cfg.autoLogPath);
    return detectJournalProviders({ homeDir, env, cfg }).recommended;
  }
  if (explicit === "api" || JOURNAL_PROVIDERS[explicit]) return explicit;
  return "claude";
}

function runProcess(bin, args, { label, timeout = 120, stdin = null, env = buildEnv() }) {
  return new Promise((resolve, reject) => {
    let child;
    const stdio = stdin == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"];
    try { child = spawnCli(bin, args, { cwd: workDir(), env, stdio }); }
    catch (e) { return reject(new Error(t("启动 {name} 失败：{msg}", { name: label, msg: e.message }))); }
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { killChildProcess(child); reject(new Error(t("{name} 等了 {n} 秒没回来", { name: label, n: timeout }))); }, timeout * 1000);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(t("启动 {name} 失败：{msg}", { name: label, msg: e.message }))); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (stdin != null) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
  });
}

// 一问一答：-p 打完就退，不写会话记录（否则它自己也会被追踪成一个会话），
// 保留 user 设置源以读取 ~/.claude/settings.json 的 env 认证，同时屏蔽 MCP 与工具调用
export async function runClaude(prompt, { bin = "claude", model = "haiku", timeout = 120, system = "" } = {}) {
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "user,project", "--tools", "", "--system-prompt", system || "你是一个只输出 JSON 的整理助手。"];
  if (model) args.push("--model", model);
  const { code, out, err } = await runProcess(bin, args, { label: "claude", timeout, stdin: prompt });
  let d;
  try { d = JSON.parse(out); } catch { throw new Error((err || out || t("claude 退出码 {code}", { code })).trim().slice(0, 300)); }
  if (d.is_error) throw new Error(String(d.result || t("claude 返回错误")).slice(0, 300));
  return String(d.result || "");
}

// Codex 只做一次整理，不落会话日志，避免把整理本身再次记进日记。
export async function runCodex(prompt, { bin = "codex", model = "", effort = "low", timeout = 120 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-codex-"));
  const output = path.join(dir, "answer.txt");
  try {
    return await new Promise((resolve, reject) => {
      const args = ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--disable", "shell_tool", "-c", 'web_search="disabled"', "-c", "features.multi_agent=false", "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "--output-last-message", output];
      if (model) args.push("--model", model);
      args.push("-");
      const child = spawnCli(bin, args, { cwd: dir, env: buildEnv(), stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
      const timer = setTimeout(() => { killChildProcess(child); reject(new Error(t("codex 等了 {n} 秒没回来", { n: timeout }))); }, timeout * 1000);
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(t("启动 codex 失败：{msg}", { msg: e.message }))); });
      child.stdin.on("error", () => {});
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error((err || t("codex 退出码 {code}", { code })).trim().slice(-500)));
        try {
          const answer = fs.readFileSync(output, "utf8").trim();
          if (!answer) throw new Error(t("codex 没有返回文字"));
          resolve(answer);
        } catch (e) { reject(e); }
      });
      child.stdin.end("仅整理下列文字，直接输出要求的结果，不调用工具。\n\n" + prompt);
    });
  } finally { rmTempDir(dir); }
}

// Windows 上 .cmd/.bat 包装脚本经 cmd.exe 传参，参数里的换行会把后面的内容截断，
// 提示词会被静默截成第一行。这类 bin 把提示词压成单行（换行变空格）；真实 .exe 不受影响。
function flattenForCmd(text, bin) {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(String(bin || ""))) return text;
  return String(text).replace(/\r?\n/g, " ");
}

export async function runAgy(prompt, { bin = "agy", model = "gemini-3.8-flash-low", timeout = 120, system = "" } = {}) {
  const fullPrompt = flattenForCmd(`${system || "仅整理下列文字，直接输出要求的结果，不调用任何工具。"}\n\n${prompt}`, bin);
  const args = ["--output-format", "json", "--disable-slash-commands"];
  if (model) args.push("--model", model);
  args.push(`--print=${fullPrompt}`);
  const { code, out, err } = await runProcess(bin, args, { label: "agy", timeout });
  let d;
  try { d = JSON.parse(out); } catch { throw new Error((err || out || t("agy 退出码 {code}", { code })).trim().slice(0, 300)); }
  if (d.status && d.status !== "SUCCESS") throw new Error(String(d.error || err || t("agy 返回错误")).slice(0, 300));
  return String(d.response || "").trim();
}

export async function runQoderCli(prompt, { bin = "qodercli", model = "", timeout = 120, system = "" } = {}) {
  const fullPrompt = flattenForCmd(`${system || "仅整理下列文字，直接输出要求的结果，不调用任何工具。"}\n\n${prompt}`, bin);
  const args = ["-p", fullPrompt, "-o", "json", "--no-session-persistence", "--tools", ""];
  if (model) args.push("-m", model);
  const { code, out, err } = await runProcess(bin, args, { label: "qodercli", timeout });
  let d;
  try { d = JSON.parse(out); } catch { throw new Error((err || out || t("qodercli 退出码 {code}", { code })).trim().slice(0, 300)); }
  if (d.is_error) throw new Error(String(d.result || t("qodercli 返回错误")).slice(0, 300));
  return String(d.result || "").trim();
}

export async function runCodeBuddy(prompt, { bin = "codebuddy", model = "", timeout = 120, system = "" } = {}) {
  const fullPrompt = flattenForCmd(`${system || "仅整理下列文字，直接输出要求的结果，不调用任何工具。"}\n\n${prompt}`, bin);
  const args = ["-p", "--output-format", "json", "--tools", ""];
  if (model) args.push("--model", model);
  args.push(fullPrompt);
  const { code, out, err } = await runProcess(bin, args, { label: "codebuddy", timeout });
  let d;
  try { d = JSON.parse(out); } catch { throw new Error((err || out || t("codebuddy 退出码 {code}", { code })).trim().slice(0, 300)); }
  const res = Array.isArray(d) ? d.findLast((x) => x && x.type === "result") : d;
  if (res?.is_error) throw new Error(String(res.result || t("codebuddy 返回错误")).slice(0, 300));
  if (res && typeof res.result === "string") return res.result.trim();
  const msg = Array.isArray(d) ? d.findLast((x) => x && x.type === "message" && x.role === "assistant") : null;
  const text = (msg?.content || []).map((c) => c?.text || "").join("\n").trim();
  if (!text) throw new Error(t("codebuddy 没有返回文字"));
  return text;
}

export function normalizeApiUrl(raw) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function defaultRequestJson(urlStr, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const transport = u.protocol === "http:" ? http : https;
    const req = transport.request(u, { method: "POST", headers, timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on("timeout", () => { req.destroy(new Error(t("API 请求超时（{n} 秒）", { n: Math.round(timeoutMs / 1000) }))); });
    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

export async function runOpenAiApi(prompt, { url = "", apiKey = "", model = "", timeout = 60, system = "", requestFn = defaultRequestJson } = {}) {
  const endpoint = normalizeApiUrl(url);
  if (!endpoint) throw new Error(t("请先填写 API Base URL"));
  if (!String(model || "").trim()) throw new Error(t("请先填写整理用的模型名称"));
  const messages = [
    { role: "system", content: system || "仅整理下列文字，直接输出要求的结果，不调用工具。" },
    { role: "user", content: prompt },
  ];
  const headers = { "Content-Type": "application/json" };
  const resolvedKey = resolveSecret(apiKey);
  if (resolvedKey) headers.Authorization = `Bearer ${resolvedKey}`;
  const payload = JSON.stringify({ model: String(model).trim(), messages, temperature: 0.2 });
  const { status, text } = await requestFn(endpoint, headers, payload, Math.max(5, Number(timeout) || 60) * 1000);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON body */ }
  if (status < 200 || status >= 300) {
    const msg = parsed?.error?.message || parsed?.message || text || `HTTP ${status}`;
    throw new Error(redactSecrets(String(msg)).slice(0, 300));
  }
  const content = parsed?.choices?.[0]?.message?.content;
  const answer = Array.isArray(content) ? content.map((c) => c?.text || "").join("\n").trim() : String(content || "").trim();
  if (!answer) throw new Error(t("API 没有返回有效内容"));
  return answer;
}

export function fetchAgyModels(configured = "") {
  const bin = resolveBin("agy", configured) || "agy";
  return new Promise((resolve) => {
    execFile(bin, ["models"], { env: buildEnv(), timeout: 10000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err) return resolve([]);
      const list = String(out || "").split("\n").map((l) => l.split("\t")[0].trim()).filter((id) => id && !id.startsWith("Fetching"));
      resolve([...new Set(list)]);
    });
  });
}

// —— 整理来源的备用链 ——
// 主来源撞限额、超时或起不来时换下一个来源（另一个 CLI 或自填 API），
// 全部问不到才退回本地规则。冷却期内的来源直接跳过，上次成功的来源优先。
const QUOTA_ERROR_RE = /限额|额度|余额|quota|rate.?limit|too many requests|\b429\b|usage limit|insufficient|overloaded|超频/i;
const CONFIG_ERROR_RE = /请先填写/;
const DEFAULT_COOLDOWN_MIN = 30;
const coolingUntil = new Map();
let lastGoodProvider = "";

// API 会算钱：自动调用前先问人，同意后 30 分钟内不再问（进程内授权，重启失效）。
const API_GRANT_MS = 30 * 60000;
let apiGrantUntil = 0;
let apiDeniedUntil = 0;
let apiConsentAsker = null;

export function setJournalApiConsent(fn) {
  apiConsentAsker = typeof fn === "function" ? fn : null;
}

export function resetJournalFailoverState() {
  coolingUntil.clear();
  lastGoodProvider = "";
  apiGrantUntil = 0;
  apiDeniedUntil = 0;
}

async function hasApiConsent(cfg = {}, { automatic = false, fallback = false } = {}) {
  if (!automatic || cfg.autoLogApiConfirm === false) return true;
  const now = Date.now();
  if (now < apiGrantUntil) return true;
  // 刚拒绝过就别每轮都再弹一次，同一窗口内继续走本地规则。
  if (now < apiDeniedUntil) return false;
  // 没有地方能问、问不到人、或者没人应答，都按「不花这笔钱」处理。
  if (!apiConsentAsker) return false;
  let ok = false;
  try { ok = await Promise.resolve(apiConsentAsker({ provider: "api", fallback })); } catch { ok = false; }
  if (ok) apiGrantUntil = Date.now() + API_GRANT_MS;
  else apiDeniedUntil = Date.now() + API_GRANT_MS;
  return Boolean(ok);
}

const apiReady = (cfg = {}) => Boolean(String(cfg.autoLogApiUrl || "").trim() && String(cfg.autoLogModel || "").trim());

// 主来源 + 至多一个备用来源；开关关掉时和以前一样只问主来源。
export function journalProviderChain(cfg = {}, { homeDir = home(), env = process.env } = {}) {
  const primary = resolveJournalProvider(cfg, { homeDir, env });
  if (!cfg.autoLogFailover) return [{ id: primary, primary: true }];
  const chain = [{ id: primary, primary: true }];
  const backup = String(cfg.autoLogBackupProvider || "auto").trim() || "auto";
  const installed = detectJournalProviders({ homeDir, env, cfg }).available.map((x) => x.id).filter((id) => id !== primary);
  let pick = backup === "auto" ? installed[0] || "" : backup;
  if (pick && pick !== primary && pick !== "api" && !installed.includes(pick) && apiReady(cfg)) pick = "api";
  if (pick && pick !== primary) {
    if (pick === "api") { if (apiReady(cfg)) chain.push({ id: "api", model: String(cfg.autoLogModel || "").trim() }); }
    else if (JOURNAL_PROVIDERS[pick]) chain.push({ id: pick, model: JOURNAL_PROVIDERS[pick].defaultModel || "" });
  }
  const now = Date.now();
  const warm = chain.filter((e) => !(coolingUntil.get(e.id) > now));
  const list = warm.length ? warm : chain;
  const good = list.findIndex((e) => e.id === lastGoodProvider);
  if (good > 0) list.unshift(list.splice(good, 1)[0]);
  return list;
}

function runWithProvider(provider, prompt, cfg = {}, { polish = false, env = process.env, model, primary = false } = {}) {
  const spec = JOURNAL_PROVIDERS[provider];
  const polishModel = polish && String(cfg.roundPolishModel || "").trim();
  const picked = model !== undefined
    ? model
    : polishModel || String(cfg.autoLogModel || "").trim() || (provider === "codex" ? "" : spec?.defaultModel || "");
  const timeout = polish ? Math.max(5, Number(cfg.roundPolishTimeout) || 30) : Math.max(10, Number(cfg.autoLogTimeout) || 120);
  const system = polish ? "你是整理助手，只输出要求的结果，不补充解释。" : "";
  if (provider === "api") {
    return runOpenAiApi(prompt, {
      url: cfg.autoLogApiUrl || "",
      apiKey: cfg.autoLogApiKey || "",
      model: picked,
      timeout,
      system,
    });
  }
  const configured = (primary ? cfg.autoLogPath : "") || (spec ? cfg.delegate?.[spec.delegateKey]?.path : "") || "";
  const bin = resolveBin(spec?.binName || provider, configured, home(), env) || spec?.binName || provider;
  if (provider === "codex") return runCodex(prompt, { bin, model: picked, effort: cfg.autoLogEffort || "low", timeout });
  if (provider === "agy") return runAgy(prompt, { bin, model: picked || "gemini-3.8-flash-low", timeout, system });
  if (provider === "qodercli") return runQoderCli(prompt, { bin, model: picked, timeout, system });
  if (provider === "codebuddy") return runCodeBuddy(prompt, { bin, model: picked, timeout, system });
  if (provider === "deepseek") return runDeepseekCli(prompt, { bin, model: picked || "deepseek-chat", timeout });
  return runClaude(prompt, { bin, model: picked || "haiku", timeout, system });
}

// DeepSeek CLI：-p 一问一答，--output-format text 只要正文；包装脚本已把 key 和 HOME 准备好。
export async function runDeepseekCli(prompt, { bin = "deepseek-ds", model = "deepseek-chat", timeout = 120 } = {}) {
  const args = ["-p", prompt, "--output-format", "text", "--skip-trust"];
  if (model) args.push("-m", model);
  const { code, out, err } = await runProcess(bin, args, { label: "deepseek", timeout });
  const text = String(out || "").trim();
  if (!text) throw new Error((err || t("deepseek 退出码 {code}", { code })).trim().slice(-400));
  return text;
}

export async function runJournalModel(prompt, cfg = {}, { polish = false, env = process.env, automatic = false } = {}) {
  const chain = journalProviderChain(cfg, { env });
  const cooldownMs = Math.max(1, Number(cfg.autoLogCooldownMin) || DEFAULT_COOLDOWN_MIN) * 60000;
  let lastError = null;
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    try {
      if (entry.id === "api" && !(await hasApiConsent(cfg, { automatic, fallback: !entry.primary }))) {
        throw new Error(t("没有授权调用 API（会产生费用），这次先用会话标题记"));
      }
      const out = await runWithProvider(entry.id, prompt, cfg, { polish, env, model: entry.model, primary: entry.primary });
      lastGoodProvider = entry.id;
      return out;
    } catch (e) {
      lastError = e;
      const message = String(e?.message || e);
      // 配置没填全时换一家也没用，直接报出来。
      if (chain.length === 1 || CONFIG_ERROR_RE.test(message)) throw e;
      if (QUOTA_ERROR_RE.test(message)) coolingUntil.set(entry.id, Date.now() + cooldownMs);
      if (i === chain.length - 1) throw e;
    }
  }
  throw lastError || new Error("no usable journal provider");
}

export async function testJournalModel(cfg = {}) {
  const raw = await runJournalModel("只回复：OK", cfg, { polish: true });
  return String(raw || "").trim();
}

// 模型没装 / 没登录时的兜底名字：从会话标题或用户第一句话里浓缩成简短总结标题
export function safeLabel(s, max = 40) {
  if (max <= 40) return summarizeAutoTitle(s, Math.min(max, 22));
  const t0 = stripTaskKeyword(String(s || "").replace(/[\r\n←`*=~[\]|]/g, " "), { allowBullet: true })
    .replace(/(\d)[:：](\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/[。；;，,\s]+$/, "")
    .trim();
  const chars = [...t0];
  return (chars.length > max ? chars.slice(0, max).join("").trim() + "…" : t0).slice(0, max + 1);
}
