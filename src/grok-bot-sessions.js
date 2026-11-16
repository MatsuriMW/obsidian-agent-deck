// Grok Bot (com.anysphere.sand) local persistence collector and transcript normalizer.
//
// Reads `~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`
// (and `%APPDATA%\Grok Bot\sand-client-persistence` on Windows).
// Files are unpadded lowercase RFC-4648 Base32 encoded keys containing JSON
// `{ schemaVersion, value }`. Token counts and model names are absent from local
// replicas because Grok Bot executes in cloud sandboxes, so they stay 0/unset.

import fs from "fs";
import path from "path";
import os from "os";
import { userDataDir } from "./platform.js";

const BASE32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP = new Map([...BASE32_ALPHA].map((ch, idx) => [ch, idx]));

export function decodeSandBlobKey(filename) {
  const stem = path.basename(String(filename || "")).replace(/\.blob$/i, "").toUpperCase();
  if (!stem || !/^[A-Z2-7]+$/.test(stem)) return "";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of stem) {
    const v = BASE32_LOOKUP.get(ch);
    if (v === undefined) return "";
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export function encodeSandBlobKey(key) {
  const buf = Buffer.from(String(key || ""), "utf8");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHA[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHA[(value << (5 - bits)) & 31];
  return `${out.toLowerCase()}.blob`;
}

export function grokBotDataDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  return path.join(userDataDir(homeDir, platform, env), "Grok Bot");
}

export const grokBotPersistenceDir = (homeDir = os.homedir(), platform = process.platform, env = process.env) =>
  path.join(grokBotDataDir(homeDir, platform, env), "sand-client-persistence");

export const grokBotDesktopStatusPath = (homeDir = os.homedir(), platform = process.platform, env = process.env) =>
  path.join(grokBotDataDir(homeDir, platform, env), "desktop-status.json");

function safeReadJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function decodeAccountId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Synchronously discover all Grok Bot roster entries and transcript blob paths.
 * Returns `{ accountId, persistenceDir, bots }`.
 */
export function discoverGrokBotStorage(opts = {}) {
  const dir = opts.persistenceDir || grokBotPersistenceDir(opts.homeDir, opts.platform, opts.env);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { accountId: "", persistenceDir: dir, bots: [] };
  }

  let activeAccount = "";
  const rosters = [];
  const transcripts = new Map(); // botId -> { path, accountId }

  for (const name of names) {
    if (!name.endsWith(".blob")) continue;
    const key = decodeSandBlobKey(name);
    if (!key) continue;
    const fullPath = path.join(dir, name);
    if (key === "sand.client.slice.client-meta.account-slot") {
      const slot = safeReadJsonSync(fullPath);
      if (typeof slot?.value === "string") activeAccount = slot.value;
      continue;
    }
    const rosterMatch = /^sand\.client\.slice\.account\.([^.]+)\.roster\.last-roster$/.exec(key);
    if (rosterMatch) {
      rosters.push({ accountId: decodeAccountId(rosterMatch[1]), path: fullPath });
      continue;
    }
    const trMatch = /^sand\.client\.slice\.account\.([^.]+)\.transcript\.replicas\.([^.]+)$/.exec(key);
    if (trMatch) {
      const accountId = decodeAccountId(trMatch[1]);
      const botId = trMatch[2];
      const existing = transcripts.get(botId);
      if (!existing || (activeAccount && accountId === activeAccount)) {
        transcripts.set(botId, { path: fullPath, accountId });
      }
    }
  }

  if (activeAccount) {
    for (const name of names) {
      if (!name.endsWith(".blob")) continue;
      const key = decodeSandBlobKey(name);
      const trMatch = /^sand\.client\.slice\.account\.([^.]+)\.transcript\.replicas\.([^.]+)$/.exec(key);
      if (trMatch && decodeAccountId(trMatch[1]) === activeAccount) {
        transcripts.set(trMatch[2], { path: path.join(dir, name), accountId: activeAccount });
      }
    }
  }

  const activeRosters = activeAccount ? rosters.filter((r) => r.accountId === activeAccount) : [];
  const orderedRosters = activeRosters.length ? activeRosters : rosters;

  const botMap = new Map();
  for (const r of orderedRosters) {
    const data = safeReadJsonSync(r.path);
    const rows = Array.isArray(data?.value?.rows) ? data.value.rows : [];
    for (const row of rows) {
      const id = String(row?.id || "").trim();
      if (!id || botMap.has(id)) continue;
      const tr = transcripts.get(id);
      const createdAt = Number(row.createdAt) || 0;
      const updatedAt = Number(row.updatedAt) || 0;
      const lastActivityAt = Number(row.lastActivityAt) || updatedAt || createdAt || 0;
      botMap.set(id, {
        id,
        accountId: r.accountId,
        name: String(row.name || row.title || id).trim() || id,
        description: String(row.description || "").trim(),
        isHidden: !!row.isHiddenFromSidebar,
        isRemoved: !!row.isRemovedFromSidebar,
        isGroup: !!row.isGroup,
        inRoster: true,
        createdAt,
        updatedAt,
        lastActivityAt,
        awaitingUserResponse: row.awaitingUserResponse || null,
        lastPreview: String(row.lastEntry?.text || row.lastEntry?.sessionPreview?.text || "").trim(),
        transcriptPath: tr?.path || "",
      });
    }
  }

  for (const [botId, tr] of transcripts) {
    if (botMap.has(botId)) continue;
    botMap.set(botId, {
      id: botId,
      accountId: tr.accountId,
      name: botId,
      description: "",
      isHidden: false,
      isRemoved: false,
      isGroup: false,
      inRoster: false,
      createdAt: 0,
      updatedAt: 0,
      lastActivityAt: 0,
      awaitingUserResponse: null,
      lastPreview: "",
      transcriptPath: tr.path,
    });
  }

  const bots = [...botMap.values()].sort((a, b) => {
    const aHidden = a.isHidden || a.isRemoved ? 1 : 0;
    const bHidden = b.isHidden || b.isRemoved ? 1 : 0;
    if (aHidden !== bHidden) return aHidden - bHidden;
    if (b.lastActivityAt !== a.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
    return a.name.localeCompare(b.name);
  });

  return { accountId: activeAccount || orderedRosters[0]?.accountId || "", persistenceDir: dir, bots };
}

function unescapeGrokPathContent(text) {
  return String(text || "").replace(/\\([ \\~])/g, "$1").trim();
}

export function normalizeGrokBotEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const at = Number(entry.timestampMs) || 0;
  const seq = Number(entry.seq) || 0;
  const id = String(entry.id || `${at}:${seq}`);
  const kind = String(entry.kind || "");

  if (kind === "message") {
    const role = entry.role === "assistant" ? "assistant" : "user";
    let text = unescapeGrokPathContent(entry.content);
    if (!text) return null;
    if (role === "user" && entry.fromAgent?.name && !text.startsWith("[")) {
      text = `[来自 ${entry.fromAgent.name}] ${text}`;
    }
    return { id, kind, role, text, summaryText: text, at, seq, isStreaming: !!entry.isStreaming, step: "", needsApproval: false, isTurnReply: role === "assistant" };
  }

  if (kind === "user-attachment") {
    const name = String(entry.file_name || "").trim();
    if (!name) return null;
    const text = entry.secondaryText ? `[附件: ${name} (${entry.secondaryText})]` : `[附件: ${name}]`;
    return { id, kind, role: "user", text, summaryText: text, at, seq, isStreaming: false, step: "", needsApproval: false, isTurnReply: false };
  }

  if (kind === "send-message") {
    const m = entry.message;
    if (!m || typeof m !== "object") return null;
    const author = entry.author?.name ? String(entry.author.name).trim() : "";
    const withAuthor = (t) => (author && t ? `**${author}**: ${t}` : t);
    const type = String(m.type || "");

    if (type === "text") {
      let text = String(m.content || "").trim();
      if (!text && Array.isArray(m.images) && m.images.length) text = `[图片 ×${m.images.length}]`;
      if (!text) return null;
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: text,
        at, seq, isStreaming: !!entry.isStreaming, step: "", needsApproval: false, isTurnReply: true,
      };
    }

    if (type === "widget") {
      const prompt = String(m.widget?.prompt || "").trim();
      if (!prompt) return null;
      const opts = Array.isArray(m.widget?.options)
        ? m.widget.options.map((o) => String(o?.label || o?.value || "").trim()).filter(Boolean)
        : [];
      const full = opts.length ? `${prompt}\n- ${opts.join(" / ")}` : prompt;
      return {
        id, kind, role: "assistant",
        text: withAuthor(full),
        summaryText: prompt,
        at, seq, isStreaming: false, step: "", needsApproval: false, isTurnReply: true,
      };
    }

    if (type === "attachment") {
      const label = String(m.file_name || m.alt || m.source_path || "").trim();
      if (!label) return null;
      const text = `[附件: ${label}]`;
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: text,
        at, seq, isStreaming: false, step: "", needsApproval: false, isTurnReply: false,
      };
    }

    if (type === "local-tool-permission") {
      const ask = m.ask || {};
      const action = String(ask.action || "tool").trim();
      const target = String(ask.target || "").replace(/\s+/g, " ").trim();
      const status = String(ask.status || "").trim();
      const step = target ? `${action}: ${target.slice(0, 36)}` : action;
      const text = `[权限请求: ${action}] ${target}${status ? ` (${status})` : ""}`.trim();
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: "",
        at, seq, isStreaming: false, step, needsApproval: status === "pending", isTurnReply: false,
      };
    }

    if (type === "mobile-tool-permission") {
      const perm = m.permission || {};
      const status = String(perm.status || "").trim();
      const title = String(m.title || perm.toolId || "permission").trim();
      const text = `[设备权限: ${title}] ${String(m.body || "").trim()}`.trim();
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: "",
        at, seq, isStreaming: false, step: title, needsApproval: status === "pending", isTurnReply: false,
      };
    }

    if (type === "user-form") {
      const fr = m.formRequest || {};
      const title = String(fr.title || "").trim();
      if (!title) return null;
      return {
        id, kind, role: "assistant",
        text: withAuthor(`[表单: ${title}]`),
        summaryText: "",
        at, seq, isStreaming: false, step: title, needsApproval: !entry.formResolution, isTurnReply: false,
      };
    }

    if (type === "email-offer") {
      const text = String(m.summary || m.email || "").trim();
      if (!text) return null;
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: text,
        at, seq, isStreaming: false, step: "", needsApproval: false, isTurnReply: true,
      };
    }

    if (type === "connector" || type === "scm-connect") {
      const text = type === "connector" ? `[连接器: ${m.connector || ""}]` : `[连接仓库: ${m.provider || ""}]`;
      return {
        id, kind, role: "assistant",
        text: withAuthor(text),
        summaryText: "",
        at, seq, isStreaming: false, step: "", needsApproval: false, isTurnReply: false,
      };
    }
  }

  return null;
}

export function parseGrokBotTranscript(rawText, botMeta = {}) {
  let data;
  try {
    data = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  } catch {
    return null;
  }
  const value = data?.value && typeof data.value === "object" ? data.value : null;
  if (!value) return null;

  const rawEntries = Array.isArray(value.entries) ? value.entries : [];
  const entries = rawEntries
    .map(normalizeGrokBotEntry)
    .filter(Boolean)
    .sort((a, b) => (a.at - b.at) || (a.seq - b.seq));

  const persistedAt = Number(value.persistedAt) || 0;
  let startedAt = Number(botMeta.createdAt) || 0;
  let lastAt = Number(botMeta.lastActivityAt) || persistedAt || 0;
  for (const e of entries) {
    if (e.at > 0 && (!startedAt || e.at < startedAt)) startedAt = e.at;
    if (e.at > lastAt) lastAt = e.at;
  }

  const last = entries[entries.length - 1] || null;
  let pendingApproval = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role === "user" || e.isTurnReply) break;
    if (e.needsApproval) { pendingApproval = true; break; }
  }
  let state = "idle";
  if (botMeta.awaitingUserResponse || pendingApproval) state = "needs-approval";
  else if (last?.isStreaming || last?.role === "user") state = "run";
  else if (last?.role === "assistant") state = "wait";

  const step = state === "needs-approval" || state === "run" ? (last?.step || "") : "";
  return { persistedAt, entries, state, step, startedAt, lastAt };
}

export function buildGrokBotConversation(rawText, botMeta = {}) {
  const parsed = parseGrokBotTranscript(rawText, botMeta);
  if (!parsed) return [];
  return parsed.entries
    .filter((e) => e.text && e.text.trim())
    .map((e) => ({ role: e.role, text: e.text, at: e.at }));
}
