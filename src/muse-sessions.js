// Muse (com.meta.endo) local conversation cache collector and transcript normalizer.
//
// Reads `~/Library/Caches/ConversationCache/*.json` (e.g. `hatch-main.json`) on macOS.
// Timestamps are Apple CFAbsoluteTime (seconds since 2001-01-01T00:00:00Z).
// Muse runs in a cloud VM, so local cache has no token counts or model names;
// both remain 0/unset without estimation.

import fs from "fs";
import path from "path";
import os from "os";

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

const expandHome = (p, homeDir) => String(p || "").replace(/^~(?=\/)/, homeDir);

export function museCacheDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (env?.MUSE_CACHE_DIR) return expandHome(env.MUSE_CACHE_DIR, homeDir);
  if (platform === "darwin") return path.join(homeDir, "Library", "Caches", "ConversationCache");
  return "";
}

export function museDataDirs(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  const dirs = [];
  const cacheDir = museCacheDir(homeDir, platform, env);
  if (cacheDir) dirs.push(cacheDir);
  if (platform === "darwin") {
    dirs.push(
      path.join(homeDir, "Library", "Application Support", "com.meta.endo"),
      path.join(homeDir, "Library", "Application Support", "Hatch"),
    );
  }
  return dirs;
}

export function museTime(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (value >= 1e12) return Math.round(value);
    if (value >= 1.5e9) return Math.round(value * 1000);
    return Math.round(APPLE_EPOCH_MS + value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return museTime(num);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const stripWidgetTokens = (text) => String(text || "").replace(/\[\[hatch_widget:[^\]]+\]\]/g, "").trim();

function extractMuseBlocks(msg) {
  const blocks = Array.isArray(msg?.contentBlocks) ? msg.contentBlocks : [];
  const mdParts = [];
  const extraParts = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.markdown?.text === "string" && b.markdown.text.trim()) {
      mdParts.push(b.markdown.text.trim());
    }
    const widget = b.optionWidget?._0 || b.optionWidget;
    if (widget && typeof widget === "object") {
      const opts = Array.isArray(widget.options) ? widget.options.map((x) => String(x || "").trim()).filter(Boolean) : [];
      const selected = String(widget.selectedText || "").trim();
      if (selected) extraParts.push(`[已选: ${selected}]`);
      else if (opts.length) extraParts.push(`[选项: ${opts.join(" / ")}]`);
      else if (widget.displayText) extraParts.push(`[选项: ${String(widget.displayText).trim()}]`);
    }
  }
  const summaryText = mdParts.length ? mdParts.join("\n\n") : stripWidgetTokens(msg?.content);
  const fullText = [summaryText, ...extraParts].filter(Boolean).join("\n\n");
  return { text: fullText, summaryText };
}

function extractMuseTool(msg) {
  const calls = Array.isArray(msg?.activeToolCalls) ? msg.activeToolCalls : [];
  if (!calls.length) return "";
  const last = calls[calls.length - 1];
  if (typeof last === "string") return last;
  return String(last?.name || last?.toolName || last?.tool || "").trim();
}

function inferMuseTitle(id, filePath) {
  if (id === "hatch-main") return "Muse";
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(raw)) {
      const firstUser = raw.find((m) => m && m.isUser && typeof m.content === "string" && m.content.trim());
      if (firstUser) {
        const clean = stripWidgetTokens(firstUser.content).replace(/\s+/g, " ").trim();
        if (clean) return clean.slice(0, 28);
      }
    }
  } catch { /* fallback to id */ }
  return id;
}

export function discoverMuseConversations(opts = {}) {
  const cacheDir = opts.cacheDir || museCacheDir(opts.homeDir, opts.platform, opts.env);
  if (!cacheDir) return { cacheDir: "", conversations: [] };
  let names;
  try {
    names = fs.readdirSync(cacheDir);
  } catch {
    return { cacheDir, conversations: [] };
  }
  const conversations = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const id = path.basename(name, ".json");
    if (!id) continue;
    const filePath = path.join(cacheDir, name);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs || 0; } catch { /* ignore */ }
    conversations.push({
      id,
      isMain: id === "hatch-main",
      title: inferMuseTitle(id, filePath),
      filePath,
      mtimeMs,
    });
  }
  conversations.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.id.localeCompare(b.id);
  });
  return { cacheDir, conversations };
}

export function parseMuseConversation(rawText, meta = {}) {
  let raw;
  try {
    raw = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;

  const sorted = [...raw].sort((a, b) => {
    const sa = Number(a?.sortSeq);
    const sb = Number(b?.sortSeq);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    return museTime(a?.timestamp) - museTime(b?.timestamp);
  });

  const nonProactiveIds = new Set();
  for (const m of sorted) {
    if (m && typeof m === "object" && m.isUser && m.id) nonProactiveIds.add(String(m.id));
  }

  const entries = [];
  let startedAt = 0;
  let lastAt = 0;
  let lastStreaming = false;
  let lastStep = "";
  let lastRole = "";
  let hasUserMessage = false;
  let lastTurnProactive = false;

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (!m || typeof m !== "object") continue;
    const role = m.isUser ? "user" : "assistant";
    const at = museTime(m.timestamp);
    const { text, summaryText } = extractMuseBlocks(m);
    const step = extractMuseTool(m);
    const isStreaming = Boolean(m.isStreaming);
    let isProactive = false;
    if (role === "user") {
      hasUserMessage = true;
      lastTurnProactive = false;
    } else {
      const replyTo = typeof m.replyToMessageId === "string" ? m.replyToMessageId.trim() : "";
      isProactive = !hasUserMessage || (replyTo ? (nonProactiveIds.size > 0 && !nonProactiveIds.has(replyTo)) : lastTurnProactive);
      lastTurnProactive = isProactive;
      if (!isProactive && m.id) nonProactiveIds.add(String(m.id));
    }
    if (at) {
      if (!startedAt || at < startedAt) startedAt = at;
      if (at > lastAt) lastAt = at;
    }
    lastStreaming = isStreaming;
    lastStep = step;
    lastRole = role;
    if (!text && !step) continue;
    entries.push({
      id: String(m.id || `${at}:${m.sortSeq ?? i}`),
      role,
      text,
      summaryText: summaryText || text,
      at,
      isStreaming,
      step,
      isProactive,
      isTurnReply: role === "assistant" && Boolean(summaryText || text),
    });
  }

  const state = lastStreaming || lastStep || lastRole === "user" ? "run" : "wait";
  return {
    id: meta.id || "hatch-main",
    title: meta.title || "Muse",
    entries,
    state,
    step: state === "run" ? lastStep : "",
    startedAt,
    lastAt,
  };
}

export function buildMuseConversation(rawText) {
  const parsed = parseMuseConversation(rawText);
  if (!parsed) return [];
  return parsed.entries
    .filter((e) => e.text && e.text.trim())
    .map(({ role, text, at }) => ({ role, text, at }));
}
