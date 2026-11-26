// Agent Deck — project folders.
//
// Projects are inferred from a session's cwd (readers.js); this module is the
// reverse mapping: a project name the user registered, and the folder work for
// that project should run in. Pure functions + fs only, so tests can call it.

import fs from "fs";
import os from "os";
import path from "path";
import { extractWikilinkRefs } from "./outline.js";
import { isScratchCwd, normalizeProjectRoot, sessionProjectName } from "./readers.js";

const home = () => os.homedir();

export function stripWinLongPrefix(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\\\\\?\\UNC\\/i.test(s)) return "\\\\" + s.slice(8);
  if (/^\/\/\?\/UNC\//i.test(s)) return "//" + s.slice(8);
  return s.replace(/^(?:\\\\\?\\|\/\/\?\/)/, "");
}

export function isTempPath(raw) {
  const p = stripWinLongPrefix(raw).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!p) return false;
  if (/^\/(?:private\/)?(?:tmp|var)(?:\/|$)/.test(p)) return true;
  if (/(?:\/appdata\/local\/temp|^[a-z]:\/windows\/temp)(?:\/|$)/i.test(p)) return true;
  const sysTmp = stripWinLongPrefix(os.tmpdir()).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return Boolean(sysTmp && (p === sysTmp || p.startsWith(`${sysTmp}/`)));
}

export function normalizeProjectFolder(raw) {
  let p = stripWinLongPrefix(raw).replace(/^~(?=[\\/])/, home()).replace(/\\/g, "/");
  if (!p) return "";
  const isUnc = p.startsWith("//");
  p = isUnc ? ("//" + p.slice(2).replace(/\/+$/, "")) : p.replace(/\/+$/, "");
  if (/^[a-z]:(?:\/|$)/i.test(p)) p = p[0].toUpperCase() + p.slice(1);
  // Windows 的 os.homedir() 是反斜杠（C:\Users\x），这里 p 已统一成 /，必须同样归一化再比，
  // 否则家目录会被当成合法项目目录登记进去。
  const homeRaw = stripWinLongPrefix(home()).replace(/\\/g, "/").replace(/\/+$/, "");
  const homePath = /^[a-z]:(?:\/|$)/i.test(homeRaw) ? homeRaw[0].toUpperCase() + homeRaw.slice(1) : homeRaw;
  const winLike = process.platform === "win32" || /^[A-Z]:(?:\/|$)/.test(p) || isUnc;
  const isHome = Boolean(homePath && (winLike ? p.toLowerCase() === homePath.toLowerCase() : p === homePath));
  if (!p || p === "~" || p === "/" || p === "//" || /^[A-Za-z]:$/.test(p) || isHome) return "";
  if (/^[A-Z]:\/.+/.test(p) || /^\/\/[^/]+\/[^/]+/.test(p)) return p;
  if (process.platform !== "win32" && path.isAbsolute(p)) return p;
  return "";
}

function realFolder(p) {
  try {
    const fn = fs.realpathSync?.native || fs.realpathSync;
    const resolved = stripWinLongPrefix(fn(p)).replace(/\\/g, "/");
    const trimmed = resolved.startsWith("//") ? ("//" + resolved.slice(2).replace(/\/+$/, "")) : resolved.replace(/\/+$/, "");
    return /^[a-z]:(?:\/|$)/i.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
  } catch {
    return p;
  }
}

export function sameFolder(a, b) {
  const x = normalizeProjectFolder(a);
  const y = normalizeProjectFolder(b);
  if (!x || !y) return false;
  const rx = realFolder(x);
  const ry = realFolder(y);
  const winPair = process.platform === "win32" || (/^(?:[A-Za-z]:\/|\/\/)/.test(rx) && /^(?:[A-Za-z]:\/|\/\/)/.test(ry));
  return winPair ? rx.toLowerCase() === ry.toLowerCase() : rx === ry;
}

export function folderExists(folder) {
  const p = normalizeProjectFolder(folder);
  if (!p) return false;
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function projectFolderEntries(settings) {
  const raw = settings?.projectFolders;
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  const seen = new Set();
  for (const [name, value] of Object.entries(raw)) {
    const label = String(name || "").trim();
    const folder = normalizeProjectFolder(value);
    if (!label || !folder || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ name: label, path: folder });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

// "Agent Deck" and "agent-deck" name the same project; keep punctuation out of
// the loose match so the two spellings still resolve.
export function projectKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_\-·.]+/g, "");
}

export function projectNameForFolder(settings, folder) {
  const hit = projectFolderEntries(settings).find((e) => sameFolder(e.path, folder));
  return hit ? hit.name : "";
}

export function projectFolderForName(settings, name) {
  const hit = matchEntry(projectFolderEntries(settings), name);
  return hit ? hit.path : "";
}

export function rememberProjectFolder(settings, name, folder) {
  const label = String(name || "").trim();
  const dir = normalizeProjectFolder(folder);
  if (!settings || !label || !dir) return false;
  settings.projectFolders ||= {};
  const entries = projectFolderEntries(settings);
  const same = entries.find((e) => sameFolder(e.path, dir));
  if (same && same.name === label) return false;
  // One folder keeps one name; a renamed project replaces the old entry.
  for (const [key, value] of Object.entries(settings.projectFolders)) {
    if (key !== label && sameFolder(value, dir)) delete settings.projectFolders[key];
  }
  settings.projectFolders[label] = dir;
  return true;
}

function matchEntry(entries, label) {
  const raw = String(label || "").trim();
  if (!raw) return null;
  const exact = entries.find((e) => e.name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const key = projectKey(raw);
  if (!key) return null;
  const loose = entries.filter((e) => projectKey(e.name) === key);
  return loose.length === 1 ? loose[0] : null;
}

function titlePrefix(blockText) {
  const first = String(blockText || "").split("\n")[0]
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*(?:TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)\s+/i, "")
    .replace(/^\s*(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/, "")
    .replace(/^(?:\*\*|🤖|\s)+/, "");
  const m = /^(.{1,60}?)\s*(?:->|→)\s+/.exec(first);
  return m ? m[1].trim() : "";
}

/**
 * Which registered project folder should a task run in?
 * Order is deliberate: explicit links win over the note's own path, and a
 * generated "Project -> title" prefix is the weakest signal.
 */
export function resolveProjectForTask({ settings, notePath = "", contextLines = [], blockText = "" } = {}) {
  // A registered folder that moved or was deleted must not send a task there.
  const entries = projectFolderEntries(settings).filter((e) => folderExists(e.path));
  if (!entries.length) return null;

  for (const ref of extractWikilinkRefs([...contextLines, String(blockText || "")])) {
    const target = String(ref.target || "").replace(/\\/g, "/");
    const base = target.split("/").pop().replace(/\.md$/i, "");
    const hit = matchEntry(entries, base) || matchEntry(entries, target);
    if (hit) return { name: hit.name, path: hit.path, source: "link" };
  }

  // A task-level "Project -> …" prefix is more specific than the note's own
  // path, so it outranks it (e.g. a task about wuxi inside Agent Deck.md).
  const titleHit = matchEntry(entries, titlePrefix(blockText));
  if (titleHit) return { name: titleHit.name, path: titleHit.path, source: "title" };

  const segments = String(notePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length) {
    segments[segments.length - 1] = segments[segments.length - 1].replace(/\.md$/i, "");
    for (const segment of [...segments].reverse()) {
      const hit = matchEntry(entries, segment);
      if (hit) return { name: hit.name, path: hit.path, source: "path" };
    }
  }
  return null;
}

/**
 * The folder and project name a dispatch should use.
 * An explicit cwd wins, then the note's project (when autoProjectFolder is on).
 * The per-agent default cwd is a fallback, not a task intent, so it only
 * applies when the note names no project; the vault root is the last resort.
 */
export function resolveDispatchFolder({
  settings,
  explicitCwd = "",
  explicitVault = false,
  agentCwd = "",
  vaultPath = "",
  notePath = "",
  contextLines = [],
  blockText = "",
  explicitName = "",
} = {}) {
  const explicit = normalizeProjectFolder(explicitCwd);
  if (explicitVault && !explicit) {
    return { folder: vaultPath, projectName: "", auto: null, explicit: "", explicitVault: true };
  }
  let auto = null;
  let folder = explicit;
  if (!folder && settings?.autoProjectFolder !== false) {
    auto = resolveProjectForTask({ settings, notePath, contextLines, blockText });
    if (auto) folder = auto.path;
  }
  if (!folder) folder = normalizeProjectFolder(agentCwd);
  folder = folder || vaultPath;
  const projectName = explicit
    ? (explicitName || projectNameForFolder(settings, explicit) || path.basename(explicit))
    : (auto?.name || projectNameForFolder(settings, folder) || "");
  return { folder, projectName, auto, explicit, explicitVault: false };
}

/** Candidate project names mentioned by a task, in signal order. */
export function projectCandidatesFromTask({ notePath = "", contextLines = [], blockText = "" } = {}) {
  const out = [];
  const push = (value) => {
    const name = String(value || "").trim();
    if (name) out.push(name);
  };
  for (const ref of extractWikilinkRefs([...contextLines, String(blockText || "")])) {
    const target = String(ref.target || "").replace(/\\/g, "/");
    push(target.split("/").pop().replace(/\.md$/i, ""));
  }
  const segments = String(notePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length) {
    push(segments[segments.length - 1].replace(/\.md$/i, ""));
    for (const segment of segments.slice(0, -1)) push(segment);
  }
  push(titlePrefix(blockText));
  return [...new Set(out)];
}

/** Recent real project folders seen in tracked sessions, newest first. */
export function recentProjectFolders(meta, { limit = 12 } = {}) {
  const byRoot = new Map();
  for (const item of meta?.values?.() || []) {
    const raw = String(item?.cwd || "").trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) continue;
    const normRaw = normalizeProjectFolder(raw);
    if (!normRaw || isScratchCwd(normRaw) || !folderExists(normRaw)) continue;
    const root = normalizeProjectRoot(normRaw);
    if (!root || isScratchCwd(root) || !folderExists(root)) continue;
    const name = sessionProjectName(root);
    if (!name) continue;
    const lastAt = Number(item?.lastAt) || 0;
    const prev = byRoot.get(root);
    if (!prev || lastAt > prev.lastAt) byRoot.set(root, { name, path: root, lastAt });
  }
  return [...byRoot.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, Math.max(1, limit));
}

function electronDialog() {
  try {
    const req = typeof window !== "undefined" && typeof window.require === "function"
      ? window.require
      : (typeof require === "function" ? require : null);
    return req?.("electron")?.remote?.dialog || null;
  } catch {
    return null;
  }
}

export function canPickNativeFolder() {
  return typeof electronDialog()?.showOpenDialog === "function";
}

export async function pickNativeFolder(defaultPath = "") {
  const dlg = electronDialog();
  if (typeof dlg?.showOpenDialog !== "function") return "";
  try {
    const normDefault = normalizeProjectFolder(defaultPath);
    const res = await dlg.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      ...(normDefault && folderExists(normDefault) ? { defaultPath: normDefault } : {}),
    });
    if (!res || res.canceled) return "";
    return normalizeProjectFolder(res.filePaths?.[0] || "");
  } catch {
    return "";
  }
}

/**
 * A project the note names, which is not registered yet but was recently seen
 * in a tracked session. Suggestions only; never dispatched without the user.
 */
export function suggestProjectForTask({ settings, recent = [], notePath = "", contextLines = [], blockText = "" } = {}) {
  if (!recent.length) return null;
  const registered = projectFolderEntries(settings);
  for (const candidate of projectCandidatesFromTask({ notePath, contextLines, blockText })) {
    if (matchEntry(registered, candidate)) continue;
    const hit = matchEntry(recent, candidate);
    if (hit && folderExists(hit.path) && !isScratchCwd(hit.path)) return { ...hit, candidate };
  }
  return null;
}
