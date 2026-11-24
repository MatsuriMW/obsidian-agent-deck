// Custom ACP Agent registry helpers: normalize user-configured ACP CLI entries,
// resolve secret/env references in environment variables, and sync runtime registries.

import { AGENTS, AGENT_ORDER } from "./constants.js";
import { registerAgentCapability, unregisterAgentCapability } from "./agent-registry.js";
import { resolveSecret } from "./security.js";

export const BUILTIN_AGENT_IDS = Object.freeze([...AGENT_ORDER]);
const BUILTIN_SET = new Set(BUILTIN_AGENT_IDS);
const REGISTERED_CUSTOM_IDS = new Set();

const CUSTOM_ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeCustomAcpId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!CUSTOM_ID_RE.test(id)) return "";
  if (BUILTIN_SET.has(id)) return "";
  return id;
}

export function parseCustomAcpArgs(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean);
  const text = String(raw || "").trim();
  if (!text) return [];
  const out = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < text.length) {
        cur += text[++i];
      } else if (ch === quote) {
        quote = "";
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function parseCustomAcpEnv(raw, { resolve = resolveSecret } = {}) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k || "").trim();
      if (!ENV_KEY_RE.test(key)) continue;
      out[key] = resolve(String(v ?? ""));
    }
    return out;
  }
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = resolve(val);
  }
  return out;
}

export function normalizeCustomAcpEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizeCustomAcpId(raw.id);
  const command = String(raw.command || "").trim();
  if (!id || !command) return null;
  const name = String(raw.name || "").trim() || id;
  const args = Array.isArray(raw.args) ? raw.args.join(" ") : String(raw.args ?? "acp").trim();
  const env = typeof raw.env === "string"
    ? raw.env.replace(/\r\n/g, "\n").trim()
    : (raw.env && typeof raw.env === "object"
      ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join("\n")
      : "");
  const color = /^#[0-9a-fA-F]{3,8}$/.test(String(raw.color || "").trim())
    ? String(raw.color).trim()
    : "#6b7280";
  return {
    id,
    name,
    command,
    args,
    env,
    color,
    autoApprove: Boolean(raw.autoApprove),
    enabled: raw.enabled !== false,
  };
}

export function listCustomAcpAgents(settings) {
  const raw = Array.isArray(settings?.customAcpAgents) ? settings.customAcpAgents : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const norm = normalizeCustomAcpEntry(item);
    if (!norm || seen.has(norm.id)) continue;
    seen.add(norm.id);
    out.push(norm);
  }
  return out;
}

export function syncCustomAcpRegistry(entries = []) {
  for (const id of REGISTERED_CUSTOM_IDS) {
    delete AGENTS[id];
    const idx = AGENT_ORDER.indexOf(id);
    if (idx >= 0) AGENT_ORDER.splice(idx, 1);
    unregisterAgentCapability(id);
  }
  REGISTERED_CUSTOM_IDS.clear();

  const seen = new Set();
  const registered = [];
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = normalizeCustomAcpEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    REGISTERED_CUSTOM_IDS.add(entry.id);
    AGENTS[entry.id] = {
      id: entry.id,
      name: entry.name,
      short: entry.name.slice(0, 6),
      color: entry.color,
      soft: `color-mix(in srgb, ${entry.color} 13%, transparent)`,
      deep: "obsidian",
      customAcp: true,
      trackingOnly: false,
    };
    if (!AGENT_ORDER.includes(entry.id)) AGENT_ORDER.push(entry.id);
    registerAgentCapability(entry.id, {
      delegate: true,
      runnerKind: "acp",
      acp: true,
      acpArgs: parseCustomAcpArgs(entry.args),
      acpCommand: entry.command,
      acpEnvRaw: entry.env,
      acpAutoApprove: true,
      acpDefaultModel: "",
      acpDefaultEffort: "",
      acpModelOptional: true,
      acpEffortOptional: true,
      acpAllowUnknownEffort: true,
      desktopHandoffOnly: false,
      terminalHandoff: false,
      continueInApp: true,
      continueRequiresAcp: true,
      permissionControl: false,
      archiveDetection: false,
      modelCatalog: false,
      autoOpenDesktopOnDone: false,
      waitDesktopUntilDone: false,
      sessionLinkScheme: "obsidian",
      customAcp: true,
    });
    registered.push(entry);
  }
  return registered;
}
