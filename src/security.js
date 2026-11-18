// Local security boundaries: secret resolution/redaction, permission policy guards, and terminal quoting.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const DEFAULT_SECRETS_FILE = () => path.join(os.homedir(), ".agent-deck", "secrets.json");

const SECRET_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /((?:ANTHROPIC|OPENAI|DEEPSEEK|DASHSCOPE|OPENROUTER|GEMINI)_(?:API_KEY|AUTH_TOKEN)\s*[:=]\s*["']?)[^\s"'`]+/gi,
];

/** Redact API keys, Bearer tokens, and common secret patterns from logs or diagnostics. */
export function redactSecrets(value) {
  let out = String(value ?? "");
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix) => (prefix ? `${prefix}[REDACTED]` : "[REDACTED]"));
  }
  return out;
}

function readSecretsMap(secretsFile = DEFAULT_SECRETS_FILE()) {
  try {
    const raw = fs.readFileSync(secretsFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve credentials without forcing plaintext keys into synced Vault data.json.
 * Supports `env:VAR_NAME`, `secret:KEY_NAME` (~/.agent-deck/secrets.json), or raw value.
 */
export function resolveSecret(rawValue, { env = process.env, secretsFile = DEFAULT_SECRETS_FILE() } = {}) {
  const val = String(rawValue || "").trim();
  if (!val) return "";
  if (val.startsWith("env:")) {
    const name = val.slice(4).trim();
    return name ? String(env?.[name] || "").trim() : "";
  }
  if (val.startsWith("secret:")) {
    const name = val.slice(7).trim();
    if (!name) return "";
    const map = readSecretsMap(secretsFile);
    return String(map[name] || "").trim();
  }
  return val;
}

/** Persist a named secret outside the Obsidian Vault with owner-only permissions (0600). */
export function saveExternalSecret(name, value, { secretsFile = DEFAULT_SECRETS_FILE() } = {}) {
  const key = String(name || "").trim();
  if (!key) throw new Error("Secret name is required");
  const dir = path.dirname(secretsFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const map = readSecretsMap(secretsFile);
  const nextVal = String(value || "").trim();
  if (nextVal) map[key] = nextVal;
  else delete map[key];
  fs.writeFileSync(secretsFile, JSON.stringify(map, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(secretsFile, 0o600); } catch { /* Windows ignores POSIX mode */ }
  return secretsFile;
}

const HIGH_RISK_SHELL_RE = [
  { id: "destructive_rm", re: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--no-preserve-root)\b/i },
  { id: "pipe_to_shell", re: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba|z|da)?sh\b/i },
  { id: "privilege_escalation", re: /(?:^|[;&|]\s*)sudo\b/i },
  { id: "disk_format", re: /\b(?:mkfs(?:\.[a-z0-9]+)?|dd\s+if=)\b/i },
  { id: "world_writable", re: /\bchmod\s+(?:-R\s+)?777\b/i },
  { id: "force_push", re: /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|\s-f\b)/i },
];

const SENSITIVE_PATH_RE = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.kube|secrets\.json|\.env(?:\.[^\\/\s]+)?)(?:$|[\\/])|^\/etc\/(?:passwd|shadow|sudoers)$/i;

function normalizeRoot(dir) {
  const s = String(dir || "").trim();
  if (!s) return "";
  const resolved = path.resolve(s);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function isInsideRoot(targetPath, root) {
  if (!targetPath || !root) return false;
  const resolved = path.resolve(targetPath);
  let real = resolved;
  try { real = fs.realpathSync(resolved); } catch { /* non-existent target uses resolved path */ }
  const rel = path.relative(root, real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function extractToolPaths(toolCall) {
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && (path.isAbsolute(s) || s.startsWith("~/"))) {
      out.push(s.startsWith("~/") ? path.join(os.homedir(), s.slice(2)) : s);
    }
  };
  const input = toolCall?.rawInput && typeof toolCall.rawInput === "object" ? toolCall.rawInput : {};
  for (const key of ["path", "filePath", "file_path", "target", "targetPath", "cwd", "dir"]) {
    push(input[key]);
  }
  for (const loc of Array.isArray(toolCall?.locations) ? toolCall.locations : []) {
    push(loc?.path);
  }
  return [...new Set(out)];
}

function extractToolText(toolCall) {
  const parts = [toolCall?.title, toolCall?.kind];
  if (typeof toolCall?.rawInput === "string") parts.push(toolCall.rawInput);
  else if (toolCall?.rawInput && typeof toolCall.rawInput === "object") {
    for (const k of ["command", "cmd", "script", "args", "url"]) {
      if (toolCall.rawInput[k]) parts.push(String(toolCall.rawInput[k]));
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Guard autoApprove against lethal-trifecta escalation:
 * even when autoApprove=true, destructive shell commands, sensitive credential paths,
 * and explicit writes/deletes outside allowed workspace roots escalate to manual approval.
 */
export function evaluatePermissionPolicy(toolCall, { cwd = "", vaultPath = "", autoApprove = false } = {}) {
  if (!autoApprove) {
    return { allowAuto: false, escalated: false, risk: "", reason: "manual" };
  }
  const text = extractToolText(toolCall);
  for (const rule of HIGH_RISK_SHELL_RE) {
    if (rule.re.test(text)) {
      return { allowAuto: false, escalated: true, risk: rule.id, reason: `high_risk_command:${rule.id}` };
    }
  }
  const paths = extractToolPaths(toolCall);
  for (const p of paths) {
    if (SENSITIVE_PATH_RE.test(p)) {
      return { allowAuto: false, escalated: true, risk: "sensitive_path", reason: "sensitive_path" };
    }
  }
  const roots = [normalizeRoot(cwd), normalizeRoot(vaultPath)].filter(Boolean);
  const kind = String(toolCall?.kind || "").toLowerCase();
  const isMutating = /edit|write|delete|remove|move|exec|execute|shell/.test(kind) || /\b(?:delete|remove|write|rm)\b/i.test(String(toolCall?.title || ""));
  if (roots.length && isMutating) {
    for (const p of paths) {
      if (!roots.some((r) => isInsideRoot(p, r))) {
        return { allowAuto: false, escalated: true, risk: "outside_workspace", reason: "outside_workspace" };
      }
    }
  }
  return { allowAuto: true, escalated: false, risk: "", reason: "policy_ok" };
}

/** Escape a string safely for embedding inside an AppleScript double-quoted literal. */
export function appleScriptString(value) {
  const clean = String(value ?? "").replace(/[\r\n\0]+/g, " ");
  return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Generate a collision-free Warp launch configuration stem from a task/session seed. */
export function safeWarpConfigName(seed = "") {
  const slug = String(seed || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const stamp = Date.now().toString(36);
  return slug ? `agent-deck-${slug}-${stamp}` : `agent-deck-${stamp}`;
}

/** Spawn a CLI binary safely, quoting arguments for Windows .cmd/.bat shims. */
export function spawnCli(bin, args = [], opts = {}) {
  const b = String(bin || "");
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(b)) {
    const q = (s) => {
      const str = String(s ?? "");
      return /[\s"&|<>^()%]/.test(str) || str === "" ? `"${str.replace(/"/g, '\\"')}"` : str;
    };
    return spawn(q(b), args.map(q), { ...opts, shell: true, windowsHide: true });
  }
  return spawn(b, args, opts);
}
