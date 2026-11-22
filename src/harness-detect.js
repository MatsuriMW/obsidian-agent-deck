// Auto-detect locally installed Harnesses / Agents and synchronize default enablement.
import fs from "fs";
import os from "os";
import path from "path";
import { AGENTS, AGENT_ORDER } from "./constants.js";
import { delegateAgents } from "./agent-registry.js";
import { expandedPathEntries } from "./delegation-runners.js";
import {
  cursorEventsDir,
  cursorHooksJsonPath,
  cursorStateDbPath,
  cursorTrackingDbPath,
} from "./cursor-sessions.js";
import { grokBotDataDir, grokBotPersistenceDir } from "./grok-bot-sessions.js";
import { museDataDirs } from "./muse-sessions.js";

export const HARNESS_DETECTION_VERSION = 1;

const norm = (p, homeDir) => String(p || "").replace(/^~(?=\/)/, homeDir);

function defaultAppDirs(homeDir, platform, env) {
  if (platform === "darwin") return ["/Applications", path.join(homeDir, "Applications")];
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return [
      path.join(localAppData, "Programs"),
      localAppData,
      appData,
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
    ].filter(Boolean);
  }
  return ["/usr/share/applications", path.join(homeDir, ".local", "share", "applications")];
}

function defaultPathEntries(homeDir, platform, env) {
  if (homeDir !== os.homedir() || env !== process.env || platform !== process.platform) {
    const sep = platform === "win32" ? ";" : ":";
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    const extra = platform === "win32"
      ? [
          path.join(appData, "npm"),
          path.join(localAppData, "pnpm"),
          path.join(homeDir, "scoop", "shims"),
        ]
      : [
          path.join(homeDir, ".npm-global", "bin"),
          path.join(homeDir, "Library", "pnpm"),
          path.join(homeDir, ".local", "share", "pnpm"),
        ];
    return [...new Set([
      ...String(env.PATH || "").split(sep).filter(Boolean),
      path.join(homeDir, ".local", "bin"),
      path.join(homeDir, ".bun", "bin"),
      ...extra,
    ])];
  }
  return expandedPathEntries(env.PATH || "", homeDir);
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function pathExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function claudeDesktopSessionsDir(homeDir, platform, env) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Claude", "claude-code-sessions");
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support", "Claude", "claude-code-sessions");
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "Claude", "claude-code-sessions");
}

function buildSpecs({ homeDir, platform, env, appDirs }) {
  const appSub = (rel) => appDirs.map((d) => path.join(d, rel));
  const claudeConfigDirs = String(env.CLAUDE_CONFIG_DIR || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((d) => [path.join(norm(d, homeDir), "projects"), norm(d, homeDir)]);
  const codexHome = env.CODEX_HOME ? norm(env.CODEX_HOME, homeDir) : path.join(homeDir, ".codex");
  const hermesHome = env.HERMES_HOME ? norm(env.HERMES_HOME, homeDir) : path.join(homeDir, ".hermes");
  const minimaxHome = env.MINIMAX_DATA_DIR
    ? norm(env.MINIMAX_DATA_DIR, homeDir)
    : env.MAVIS_DATA_DIR
      ? norm(env.MAVIS_DATA_DIR, homeDir)
      : path.join(homeDir, ".minimax");
  const qwenHome = env.QWENWORK_HOME ? norm(env.QWENWORK_HOME, homeDir) : path.join(homeDir, ".qwenworkcn");
  const t3DataDir = env.T3_DATA_DIR
    ? norm(env.T3_DATA_DIR, homeDir)
    : env.T3_STATE_DIR
      ? norm(env.T3_STATE_DIR, homeDir)
      : path.join(homeDir, ".t3", "userdata");
  const win = platform === "win32";

  return {
    // Deliberately exclude bare Claude.app so chat-only Claude Desktop users don't get Claude Code auto-enabled.
    claude: {
      binNames: ["claude"],
      binPaths: [
        path.join(homeDir, ".local", "bin", "claude"),
        path.join(homeDir, ".npm-global", "bin", "claude"),
        path.join(homeDir, ".bun", "bin", "claude"),
      ],
      apps: [],
      dataPaths: [
        path.join(homeDir, ".claude", "projects"),
        path.join(homeDir, ".claude", ".credentials.json"),
        path.join(homeDir, ".claude", "settings.json"),
        path.join(homeDir, ".config", "claude", "projects"),
        ...claudeConfigDirs,
        claudeDesktopSessionsDir(homeDir, platform, env),
      ],
    },
    codex: {
      binNames: ["codex"],
      binPaths: [
        ...appSub(path.join("Codex.app", "Contents", "Resources", "codex")),
        path.join(homeDir, ".local", "bin", "codex"),
        path.join(homeDir, ".npm-global", "bin", "codex"),
        path.join(homeDir, ".bun", "bin", "codex"),
      ],
      apps: win ? ["Codex/Codex.exe", "OpenAI/Codex/Codex.exe"] : ["Codex.app"],
      dataPaths: [codexHome],
    },
    workbuddy: {
      binNames: ["codebuddy"],
      binPaths: [
        path.join(homeDir, ".local", "bin", "codebuddy"),
        path.join(homeDir, ".npm-global", "bin", "codebuddy"),
      ],
      apps: win
        ? ["WorkBuddy/WorkBuddy.exe", "WorkBuddy AI/WorkBuddy AI.exe", "CodeBuddy/CodeBuddy.exe"]
        : ["WorkBuddy.app", "WorkBuddy AI.app"],
      dataPaths: [path.join(homeDir, ".workbuddy"), path.join(homeDir, ".codebuddy")],
    },
    dsh: {
      binNames: ["dsh"],
      binPaths: [
        ...appSub(path.join("DeepSeek Harness.app", "Contents", "Resources", "runtime", "cli", "bin", "dsh")),
        path.join(homeDir, ".local", "bin", "dsh"),
        path.join(homeDir, ".npm-global", "bin", "dsh"),
      ],
      apps: win ? ["DeepSeek Harness/DeepSeek Harness.exe"] : ["DeepSeek Harness.app"],
      dataPaths: [path.join(homeDir, ".dsh")],
    },
    antigravity: {
      binNames: ["agy"],
      binPaths: [
        ...appSub(path.join("Antigravity.app", "Contents", "Resources", "app", "bin", "agy")),
        path.join(homeDir, ".local", "bin", "agy"),
        path.join(homeDir, ".npm-global", "bin", "agy"),
      ],
      apps: win ? ["Antigravity/Antigravity.exe"] : ["Antigravity.app"],
      dataPaths: [path.join(homeDir, ".gemini", "antigravity")],
    },
    opencode: {
      binNames: ["opencode", "opencode-cli"],
      binPaths: [
        ...appSub(path.join("OpenCode.app", "Contents", "Resources", "opencode-cli")),
        path.join(homeDir, ".opencode", "bin", "opencode"),
        path.join(homeDir, ".local", "bin", "opencode"),
        path.join(homeDir, ".npm-global", "bin", "opencode"),
        path.join(homeDir, ".bun", "bin", "opencode"),
      ],
      apps: win ? ["OpenCode/OpenCode.exe"] : ["OpenCode.app"],
      dataPaths: [path.join(homeDir, ".local", "share", "opencode"), path.join(homeDir, ".opencode")],
    },
    qoder: {
      binNames: ["qodercli", "qoder"],
      binPaths: [
        path.join(homeDir, ".qoder", "bin", "qodercli", "qodercli"),
        path.join(homeDir, ".local", "bin", "qodercli"),
        path.join(homeDir, ".local", "bin", "qoder"),
        path.join(homeDir, ".qoder", "entry", "qoder"),
      ],
      apps: win ? ["Qoder/Qoder.exe"] : ["Qoder.app"],
      dataPaths: [
        path.join(homeDir, ".qoder"),
        ...(platform === "darwin" ? [path.join(homeDir, "Library", "Application Support", "com.qoder.app.stable")] : []),
        ...(win ? [path.join(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Qoder")] : []),
      ],
    },
    hermes: {
      binNames: ["hermes-acp", "hermes"],
      binPaths: [
        path.join(homeDir, ".local", "bin", "hermes-acp"),
        path.join(homeDir, ".local", "bin", "hermes"),
        path.join(homeDir, ".local", "share", "uv", "tools", "hermes-agent", "bin", "hermes-acp"),
        path.join(homeDir, ".local", "share", "uv", "tools", "hermes-agent", "bin", "hermes"),
      ],
      apps: [],
      dataPaths: [hermesHome],
    },
    minimax: {
      binNames: ["mcode"],
      binPaths: [
        path.join(homeDir, ".minimax-code", "bin", "mcode"),
        path.join(homeDir, ".local", "bin", "mcode"),
        path.join(homeDir, ".npm-global", "bin", "mcode"),
        path.join(homeDir, ".bun", "bin", "mcode"),
      ],
      apps: win
        ? ["MiniMax Code/MiniMax Code.exe", "MiniMax/MiniMax Code.exe"]
        : ["MiniMax Code.app"],
      dataPaths: [minimaxHome, path.join(homeDir, ".mavis")],
    },
    qwenwork: {
      binNames: [],
      binPaths: [],
      apps: win ? ["QwenWorkCN/QwenWorkCN.exe", "QwenWork/QwenWork.exe"] : ["QwenWorkCN.app", "QwenWork.app", "千问办公.app"],
      dataPaths: [qwenHome],
    },
    cursor: {
      binNames: ["cursor"],
      binPaths: [],
      apps: win ? ["cursor/Cursor.exe", "Cursor/Cursor.exe"] : ["Cursor.app"],
      dataPaths: [
        path.join(homeDir, ".cursor"),
        cursorHooksJsonPath(homeDir),
        cursorTrackingDbPath(homeDir),
        cursorStateDbPath(homeDir, platform, env),
        cursorEventsDir(homeDir),
      ],
    },
    grokbot: {
      binNames: [],
      binPaths: [],
      apps: win ? ["Grok Bot/Grok Bot.exe"] : ["Grok Bot.app"],
      dataPaths: [
        grokBotPersistenceDir(homeDir, platform, env),
        grokBotDataDir(homeDir, platform, env),
      ],
    },
    t3code: {
      binNames: ["t3"],
      binPaths: [
        path.join(homeDir, ".t3", "bin", "t3"),
        path.join(homeDir, ".local", "bin", "t3"),
      ],
      apps: win
        ? ["T3 Code/T3 Code.exe", "T3 Code (Beta)/T3 Code (Beta).exe"]
        : ["T3 Code (Beta).app", "T3 Code.app"],
      dataPaths: [
        path.join(t3DataDir, "statev2.sqlite"),
        path.join(t3DataDir, "state.sqlite"),
        t3DataDir,
        path.join(homeDir, ".t3"),
      ],
    },
    muse: {
      binNames: [],
      binPaths: [],
      apps: win ? [] : ["Muse.app"],
      dataPaths: museDataDirs(homeDir, platform, env),
    },
  };
}

function findBinHit(spec, configuredPath, { pathEntries, platform, homeDir, isFile }) {
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const checkFile = (p) => {
    for (const ext of exts) {
      const candidate = ext && !p.endsWith(ext) ? `${p}${ext}` : p;
      if (isFile(candidate)) return candidate;
    }
    return "";
  };

  const custom = String(configuredPath || "").trim();
  if (custom) {
    const resolved = checkFile(norm(custom, homeDir));
    if (resolved) return resolved;
  }
  for (const p of spec.binPaths || []) {
    const resolved = checkFile(p);
    if (resolved) return resolved;
  }
  for (const name of spec.binNames || []) {
    for (const dir of pathEntries) {
      if (!dir) continue;
      const resolved = checkFile(path.join(dir, name));
      if (resolved) return resolved;
    }
  }
  return "";
}

/**
 * Synchronously detect which of the 11 supported Harnesses are installed locally.
 * Checks configured/known CLI binaries, desktop app bundles, and local session/config paths.
 */
export function detectInstalledHarnesses(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const cfg = options.cfg || {};
  const appDirs = options.appDirs || defaultAppDirs(homeDir, platform, env);
  const pathEntries = options.pathEntries || defaultPathEntries(homeDir, platform, env);
  const exists = options.exists || pathExists;
  const isFile = options.isFile || fileExists;

  const specs = buildSpecs({ homeDir, platform, env, appDirs });
  const detected = {};
  const details = {};
  const installed = [];
  const missing = [];

  for (const id of AGENT_ORDER) {
    if (AGENTS[id]?.customAcp) continue;
    const spec = specs[id] || { binNames: [], binPaths: [], apps: [], dataPaths: [] };
    const via = [];

    const binHit = findBinHit(spec, cfg?.delegate?.[id]?.path || "", { pathEntries, platform, homeDir, isFile });
    if (binHit) via.push("cli");

    let appHit = "";
    for (const appName of spec.apps || []) {
      for (const dir of appDirs) {
        const candidate = path.join(dir, appName);
        if (exists(candidate)) { appHit = candidate; break; }
      }
      if (appHit) break;
    }
    if (appHit) via.push("app");

    let dataHit = "";
    for (const dp of spec.dataPaths || []) {
      if (dp && exists(dp)) { dataHit = dp; break; }
    }
    if (dataHit) via.push("data");

    const ok = via.length > 0;
    detected[id] = ok;
    details[id] = { installed: ok, via, bin: binHit, app: appHit, data: dataHit };
    if (ok) installed.push(id);
    else missing.push(id);
  }

  return { detected, details, installed, missing };
}

/**
 * Pick a valid default delegation target from enabled delegable agents.
 */
export function pickDefaultDelegateTarget(settings, currentTarget = "") {
  const agentsMap = settings?.agents || {};
  const enabled = (id) => (settings?.primaryAgents || []).includes(id) || agentsMap[id] !== false;
  const delegable = delegateAgents();
  if (currentTarget && delegable.includes(currentTarget) && enabled(currentTarget)) return currentTarget;
  const primaryMatch = (settings?.primaryAgents || []).find((id) => delegable.includes(id) && enabled(id));
  if (primaryMatch) return primaryMatch;
  const firstEnabled = delegable.find((id) => enabled(id));
  return firstEnabled || (delegable.includes(currentTarget) ? currentTarget : "claude");
}

/**
 * Apply detected Harness availability to plugin settings.
 * - mode "initial": fresh install — enable installed Harnesses, disable all others.
 * - mode "migrate": first upgrade from pre-detection config — disable uninstalled Harnesses
 *   while preserving manual disable choices for installed Harnesses.
 * - mode "redetect": explicit user re-detect — sync all Harnesses to current detection.
 */
export function applyHarnessDetection(settings, { mode = "initial", detection = null, now = Date.now(), ...detectOpts } = {}) {
  const result = detection || detectInstalledHarnesses({ cfg: settings, ...detectOpts });
  const { detected, installed } = result;

  const agents = (settings.agents ||= {});
  const autoLogAgents = (settings.autoLogAgents ||= {});
  const prevAgents = { ...agents };
  const prevPrimary = Array.isArray(settings.primaryAgents) ? [...settings.primaryAgents] : [];

  if (mode === "migrate") {
    for (const id of AGENT_ORDER) {
      if (AGENTS[id]?.customAcp) continue;
      if (!detected[id]) {
        agents[id] = false;
        autoLogAgents[id] = false;
      } else if (agents[id] === undefined) {
        agents[id] = true;
      }
    }
  } else {
    for (const id of AGENT_ORDER) {
      if (AGENTS[id]?.customAcp) continue;
      agents[id] = Boolean(detected[id]);
      autoLogAgents[id] = Boolean(detected[id]);
    }
  }

  const enabled = (id) => agents[id] !== false;
  if (Array.isArray(settings.primaryAgents)) {
    settings.primaryAgents = settings.primaryAgents.filter((id) => AGENT_ORDER.includes(id) && enabled(id)).slice(0, 3);
    if (mode === "migrate" && prevPrimary.length > 0 && settings.primaryAgents.length === 0) {
      settings.primaryAgentsInitialized = false;
    }
  }

  const delegate = (settings.delegate ||= {});
  delegate.target = pickDefaultDelegateTarget(settings, delegate.target);

  const steward = settings.projectTeams?.stewards?.default;
  if (steward && steward.enabled !== false && steward.agent && !enabled(steward.agent)) {
    settings.projectTeams.stewards.default = { enabled: false };
  }

  settings.harnessesDetected = {
    version: HARNESS_DETECTION_VERSION,
    at: now,
    installed: [...installed],
  };

  const added = AGENT_ORDER.filter((id) => prevAgents[id] === false && agents[id] !== false);
  const removed = AGENT_ORDER.filter((id) => prevAgents[id] !== false && agents[id] === false);
  return {
    detection: result,
    installed,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  };
}
