// Agent Deck — table-driven terminal registry, detection, launch, and focus.

import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { spawn, execFile } from "child_process";
import { appleScriptString, safeWarpConfigName } from "./security.js";
import { t } from "./i18n.js";

const fsp = fs.promises;
const HERDR_SPACE = "spagentdeck";
const TERN_SESSION = "Agent Deck";
const TMUX_SESSION = "agent-deck";

const defaultHome = () => os.homedir();

function shellQuote(s) {
  return `'${String(s || "").replace(/'/g, "'\\''")}'`;
}

async function defaultOpenExternal(url, platform) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") {
      await shell.openExternal(url);
      return true;
    }
  } catch { /* not electron */ }
  if (platform === "win32") return false;
  return new Promise((resolve) => execFile("/usr/bin/open", [url], (err) => resolve(!err)));
}

// Pass the CMD text through the environment so terminal argv quoting never rewrites it.
function encodeWindowsCommand(command) {
  const payload = Buffer.from(String(command), "utf8").toString("base64");
  const script = [
    `$env:AGENT_DECK_TERMINAL_COMMAND = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
    "cmd.exe /k '%AGENT_DECK_TERMINAL_COMMAND%'",
  ].join("\n");
  return ["powershell.exe", "-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

function windowsShellArgs(command) {
  const psFile = /^powershell\.exe\s+-NoExit\s+-ExecutionPolicy\s+Bypass\s+-File\s+"([^"]+)"$/i.exec(String(command).trim());
  return psFile
    ? ["powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", psFile[1]]
    : encodeWindowsCommand(command);
}

function sanitizeTitle(title, fallback = "Agent Deck") {
  const s = String(title || "").replace(/[\r\n\0]+/g, " ").trim();
  return s || fallback;
}

export const TERMINAL_REGISTRY = [
  {
    id: "terminal",
    label: () => t("系统终端"),
    app: "Terminal.app",
    bundle: "com.apple.Terminal",
    hostPattern: /Terminal\.app/i,
    autoOrder: 100,
    autoFallback: true,
    alwaysUsable: true,
  },
  {
    id: "iterm",
    label: () => "iTerm2",
    app: "iTerm.app",
    bundle: "com.googlecode.iterm2",
    hostPattern: /iTerm/i,
    autoOrder: 80,
    autoFallback: true,
  },
  {
    id: "warp",
    label: () => "Warp",
    app: "Warp.app",
    bundle: "dev.warp.Warp-Stable",
    winBin: "warp.exe",
    winReg: ["HKCU\\Software\\Warp.dev\\Warp", "InstallationPath"],
    hostPattern: /Warp\.app/i,
    autoOrder: 90,
    autoFallback: true,
  },
  {
    id: "ghostty",
    label: () => "Ghostty",
    app: "Ghostty.app",
    bundle: "com.mitchellh.ghostty",
    bin: "ghostty",
    appBins: ["/Applications/Ghostty.app/Contents/MacOS/ghostty"],
    hostPattern: /Ghostty\.app|(^|\/)ghostty$/i,
    autoOrder: 40,
    autoFallback: true,
  },
  {
    id: "cmux",
    label: () => "cmux",
    app: "cmux.app",
    bundle: "com.cmuxterm.app",
    bin: "cmux",
    appBins: [
      "/Applications/cmux.app/Contents/Resources/bin/cmux",
      "~/Applications/cmux.app/Contents/Resources/bin/cmux",
    ],
    hostPattern: /cmux\.app|(^|\/)cmux$/i,
    autoOrder: 30,
    autoFallback: true,
  },
  {
    id: "tmux",
    label: () => "tmux",
    bin: "tmux",
    winBin: "wsl.exe",
    hostPattern: /(^|\/)tmux(:.*)?$/,
    autoOrder: 35,
    autoFallback: false, // don't hijack auto mode just because brew installed tmux
  },
  {
    id: "wezterm",
    label: () => "WezTerm",
    app: "WezTerm.app",
    bundle: "com.github.wez.wezterm",
    bin: "wezterm",
    winBin: "wezterm.exe",
    appBins: ["/Applications/WezTerm.app/Contents/MacOS/wezterm"],
    hostPattern: /WezTerm\.app|(^|\/)wezterm(-gui)?$/i,
    autoOrder: 50,
    autoFallback: true,
  },
  {
    id: "kitty",
    label: () => "Kitty",
    app: "kitty.app",
    bundle: "net.kovidgoyal.kitty",
    bin: "kitty",
    appBins: ["/Applications/kitty.app/Contents/MacOS/kitty"],
    hostPattern: /kitty\.app|(^|\/)kitty$/i,
    autoOrder: 60,
    autoFallback: true,
  },
  {
    id: "alacritty",
    label: () => "Alacritty",
    app: "Alacritty.app",
    bundle: "org.alacritty",
    bin: "alacritty",
    winBin: "alacritty.exe",
    winReg: ["HKCR\\Directory\\Background\\shell\\Open Alacritty here", "Icon"],
    appBins: ["/Applications/Alacritty.app/Contents/MacOS/alacritty"],
    hostPattern: /Alacritty\.app|(^|\/)alacritty$/i,
    autoOrder: 70,
    autoFallback: true,
  },
  {
    id: "tern",
    label: () => "Tern",
    app: "Tern.app",
    bundle: "so.stencil.tern",
    winBin: "tern.exe",
    appBins: ["/Applications/Tern.app/Contents/MacOS/tern"],
    hostPattern: /Tern\.app|(^|\/)tern$/,
    autoOrder: 20,
    autoFallback: true,
  },
  {
    id: "herdr",
    label: () => "Herdr",
    app: "Herdr.app",
    bundle: "dev.herdr.app",
    bin: "hc",
    winBin: "hc.exe",
    requireBothAppAndBin: true,
    hostPattern: /(^|\/)herdr-core$|Herdr\.app/,
    autoOrder: 10,
    autoFallback: true,
  },
];

const TERMINAL_BY_ID = Object.fromEntries(TERMINAL_REGISTRY.map((entry) => [entry.id, entry]));
export const TERMINAL_ORDER = TERMINAL_REGISTRY.slice().sort((a, b) => a.autoOrder - b.autoOrder).map((e) => e.id);
export const TERMINAL_NAME = Object.fromEntries(TERMINAL_REGISTRY.map((e) => [e.id, e.label()]));

export function getTerminalOptions(platform = process.platform) {
  const entries = platform === "win32" ? TERMINAL_REGISTRY.filter((e) => e.alwaysUsable || e.winBin) : TERMINAL_REGISTRY;
  return [
    { id: "auto", label: t("自动") },
    ...entries.map((e) => ({ id: e.id, label: platform === "win32" && e.id === "tmux" ? t("tmux（通过 WSL）") : e.label() })),
  ];
}

export function createTerminalController(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const env = overrides.env || process.env;
  const home = overrides.home || defaultHome;
  const existsSync = overrides.existsSync || fs.existsSync;
  const mkdirSync = overrides.mkdirSync || fs.mkdirSync;
  const writeFileSync = overrides.writeFileSync || fs.writeFileSync;
  const readFile = overrides.readFile || ((p, enc) => fsp.readFile(p, enc));
  const writeFile = overrides.writeFile || ((p, data) => fsp.writeFile(p, data));
  const mkdir = overrides.mkdir || ((p, opts) => fsp.mkdir(p, opts));
  const readdir = overrides.readdir || ((p) => fsp.readdir(p));
  const kill = overrides.kill || ((pid, sig) => process.kill(pid, sig));
  const openExternal = overrides.openExternal || ((url) => defaultOpenExternal(url, platform));
  const spawnFn = overrides.spawn || spawn;
  const sleep = overrides.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const runResult = overrides.runResult || ((bin, args) => new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000, maxBuffer: 8 << 20, windowsHide: platform === "win32" }, (err, out) => {
      resolve({ ok: !err, out: err ? "" : String(out || "") });
    });
  }));
  const run = async (bin, args) => (await runResult(bin, args)).out;
  const osa = overrides.osa || ((script) => new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 8000 }, (err, out) => {
      resolve(err ? null : String(out || "").trim());
    });
  }));
  const execDetached = overrides.execDetached || ((bin, args, opts = {}) => {
    try {
      const child = spawnFn(bin, args, { detached: true, stdio: "ignore", ...opts });
      child.on("error", () => {});
      child.unref();
      return !!child.pid;
    } catch { return false; }
  });
  const execFire = overrides.execFire || ((bin, args) => {
    try { execFile(bin, args, () => {}); return true; } catch { return false; }
  });

  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const expandHome = (p) => (p.startsWith("~/") ? pathImpl.join(home(), p.slice(2)) : p);
  const localAppData = () => env.LOCALAPPDATA || pathImpl.join(home(), "AppData", "Local");

  const appInstalled = (name) => {
    if (!name || platform !== "darwin") return false;
    return ["/Applications", pathImpl.join(home(), "Applications")].some((d) => existsSync(pathImpl.join(d, name)));
  };

  const findBin = (name, extraPaths = []) => {
    if (!name && !extraPaths.length) return "";
    const candidates = [];
    for (const p of extraPaths) candidates.push(expandHome(p));
    if (name) {
      candidates.push(
        pathImpl.join(home(), ".local/bin", name),
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`,
      );
      const pathDirs = String(env.PATH || "").split(pathImpl.delimiter).filter(Boolean);
      for (const d of pathDirs) {
        const dir = platform === "win32" ? d.replace(/^"(.*)"$/, "$1") : d;
        if (dir) candidates.push(pathImpl.join(dir, name));
      }
    }
    return candidates.find((p) => existsSync(p)) || "";
  };

  function findWinBin(name) {
    if (!name) return "";
    const join = pathImpl.join;
    const local = localAppData();
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const standard = {
      "warp.exe": [join(local, "Programs", "Warp", name), join(programFiles, "Warp", name)],
      "alacritty.exe": [join(programFiles, "Alacritty", name)],
      "hc.exe": [join(local, "Programs", "herdr-core", name)],
      "herdr-app.exe": [join(local, "Programs", "herdr-app", name)],
      "wsl.exe": [join(env.SystemRoot || "C:\\Windows", "System32", name)],
      "wt.exe": [join(local, "Microsoft", "WindowsApps", name)],
    };
    return findBin(name, standard[name] || []);
  }

  async function windowsTerminalBin(id) {
    const entry = TERMINAL_BY_ID[id];
    if (!entry?.winBin) return "";
    const bin = findWinBin(entry.winBin);
    if (bin || !entry.winReg) return bin;
    const [key, value] = entry.winReg;
    const output = await run("reg.exe", ["query", key, "/v", value]);
    const registered = /\bREG_SZ\s+([^\r\n]+)/.exec(output)?.[1]
      .trim().replace(/,\s*0$/, "").replace(/^"|"$/g, "") || "";
    if (!pathImpl.isAbsolute(registered)) return "";
    const candidate = pathImpl.basename(registered).toLowerCase() === entry.winBin
      ? registered
      : pathImpl.join(registered, entry.winBin);
    return existsSync(candidate) ? candidate : "";
  }

  const loginShell = () => {
    const envShell = env.SHELL;
    if (envShell && existsSync(envShell)) return envShell;
    if (platform === "darwin" && existsSync("/bin/zsh")) return "/bin/zsh";
    if (existsSync("/bin/bash")) return "/bin/bash";
    return "/bin/sh";
  };

  const entryBin = (entry) => {
    if (platform === "win32") return findWinBin(entry.winBin);
    const appBins = entry.appBins || [];
    return findBin(entry.bin || "", [
      ...appBins,
      ...appBins.filter((p) => p.startsWith("/Applications/")).map((p) => "~" + p),
    ]);
  };

  const usable = (id) => {
    const entry = TERMINAL_BY_ID[id];
    if (!entry) return false;
    if (entry.alwaysUsable) return true;
    if (platform === "win32") return !!entryBin(entry);
    if (entry.requireBothAppAndBin) return appInstalled(entry.app) && !!entryBin(entry);
    if (entry.app && appInstalled(entry.app)) return true;
    if (entry.bin || entry.appBins?.length) return !!entryBin(entry);
    return false;
  };

  const DETECTED_FILE = () => path.join(home(), ".agent-deck", "terminal.json");

  async function terminalHost(pid) {
    if (platform === "win32") return "";
    for (let i = 0, p = pid; i < 12 && p > 1; i++) {
      const out = (await run("/bin/ps", ["-o", "ppid=,comm=", "-p", String(p)])).trim();
      const m = /^(\d+)\s+(.*)$/.exec(out);
      if (!m) break;
      for (const id of TERMINAL_ORDER) {
        const entry = TERMINAL_BY_ID[id];
        if (entry.hostPattern && entry.hostPattern.test(m[2])) return id;
      }
      p = Number(m[1]);
    }
    return "";
  }

  async function pickTerminal(which = "auto", { exclude = [] } = {}) {
    const excluded = new Set(exclude);
    if (platform === "win32") {
      return !excluded.has(which) && (which === "terminal" || await windowsTerminalBin(which)) ? which : "terminal";
    }
    if (TERMINAL_BY_ID[which] && !excluded.has(which)) return usable(which) ? which : "terminal";

    const ps = await run("/bin/ps", ["-ax", "-o", "pid=,tty=,comm="]);
    const count = {};
    for (const l of ps.split("\n")) {
      const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l);
      if (!m || m[2] === "??" || !/(^|\/)(claude|codex)$/.test(m[3])) continue;
      const host = await terminalHost(Number(m[1]));
      if (host && !excluded.has(host) && usable(host)) count[host] = (count[host] || 0) + 1;
    }
    const seen = TERMINAL_ORDER.filter((tId) => count[tId]).sort((a, b) => count[b] - count[a])[0];
    if (seen) {
      try {
        await mkdir(path.dirname(DETECTED_FILE()), { recursive: true });
        await writeFile(DETECTED_FILE(), JSON.stringify({ terminal: seen, at: Date.now() }));
      } catch { /* not writable */ }
      return seen;
    }
    try {
      const saved = JSON.parse(await readFile(DETECTED_FILE(), "utf8")).terminal;
      if (TERMINAL_BY_ID[saved] && !excluded.has(saved) && usable(saved)) return saved;
    } catch { /* none yet */ }

    const open = TERMINAL_ORDER.find((tId) => {
      const entry = TERMINAL_BY_ID[tId];
      return !excluded.has(tId) && entry.autoFallback && entry.app && usable(tId) && ps.includes(`/${entry.app}/`);
    });
    if (open) return open;
    return TERMINAL_ORDER.find((tId) => !excluded.has(tId) && TERMINAL_BY_ID[tId].autoFallback && usable(tId)) || "terminal";
  }

  function openWindowsHost(dir, args) {
    const wt = findWinBin("wt.exe");
    return !!((wt && execDetached(wt, ["-d", dir, ...args], { cwd: dir }))
      || execDetached("cmd.exe", ["/c", "start", "", "/D", dir, ...args], { cwd: dir }));
  }

  async function openWslTmux(bin, dir, title, args, background) {
    const probe = "command -v tmux >/dev/null && command -v powershell.exe >/dev/null && pwd";
    const linuxDir = (await run(bin, ["--cd", dir, "--exec", "sh", "-c", probe])).trim();
    if (!linuxDir.startsWith("/")) return false;
    const tmux = (args) => runResult(bin, ["--exec", "tmux", ...args]);
    const session = "=" + TMUX_SESSION;
    const hasSession = async () => (await tmux(["has-session", "-t", session])).ok;
    // A persistent tmux server can inherit an interop socket from a WSL invocation that has since exited.
    const launch = ["-n", title, "-c", linuxDir, "--", "env", "-u", "WSL_INTEROP", ...args];
    const newWindow = () => tmux(["new-window", "-t", session + ":", ...(background ? ["-d"] : []), ...launch]);
    const existing = await hasSession();
    let result = existing
      ? await newWindow()
      : await tmux(["new-session", "-d", "-s", TMUX_SESSION, ...launch]);
    if (!result.ok && !existing && await hasSession()) result = await newWindow();
    if (!result.ok) return false;
    if (!background) openWindowsHost(dir, [bin, "--exec", "tmux", "attach-session", "-t", session]);
    return true;
  }

  async function openHerdr(hc, app, dir, title, args, background) {
    const tab = "tbagentdeck" + randomBytes(6).toString("hex");
    const out = await run(hc, ["run", "--bg", "--keep", "--no-parent", "--json", "--cwd", dir, "--label", `herdr.space=${HERDR_SPACE}`, "--label", `herdr.tab=${tab}`, "--", ...args]);
    let addr = "";
    try { addr = JSON.parse(out).address || ""; } catch { /* hc not answering */ }
    if (!addr) return false;
    if (!background && platform === "win32") execDetached(app, [], { cwd: dir });
    if (app) {
      for (let i = 0; i < 15 && !(await run(app, ["ls"])).includes(tab); i++) await sleep(300);
      await run(app, ["do", "space.rename", "--id", HERDR_SPACE, "--name", "Agent Deck"]);
      await run(app, ["do", "tab.rename", "--id", tab, "--name", title]);
      if (!background) await run(app, ["do", "pane.focus", "--terminal", addr]);
    }
    if (!background && platform === "darwin") await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.herdr.bundle]);
    return true;
  }

  async function openTern(bin, dir, args, background) {
    const launch = ["--json", "--cwd", dir, "--", ...args];
    const tryOnce = async () => {
      if (!background) return (await runResult(bin, ["new", "tab", ...launch])).ok;
      let has = false;
      try { has = (JSON.parse(await run(bin, ["ls", "--json"]) || "{}").sessions || []).some((x) => x.name === TERN_SESSION); } catch { /* not running */ }
      return (await runResult(bin, has ? ["new", "tab", TERN_SESSION, ...launch] : ["new", "session", TERN_SESSION, ...launch])).ok;
    };
    let ok = await tryOnce();
    if (!ok) {
      await run(bin, ["daemon", "--login"]);
      ok = await tryOnce();
    }
    if (!ok) return execDetached(bin, ["-e", ...args], { cwd: dir });
    if (!background && platform === "darwin") execFire("/usr/bin/open", ["-b", TERMINAL_BY_ID.tern.bundle]);
    return true;
  }

  async function openWarp(command, dir, title) {
    try {
      const q = (s) => JSON.stringify(String(s).replace(/[\r\n\0]+/g, " "));
      const name = safeWarpConfigName(title) + "-" + randomBytes(6).toString("hex");
      if (platform === "win32") {
        const appData = env.APPDATA || pathImpl.join(home(), "AppData", "Roaming");
        const d = pathImpl.join(appData, "warp", "Warp", "data", "tab_configs");
        mkdirSync(d, { recursive: true });
        writeFileSync(pathImpl.join(d, name + ".toml"), [
          `name = ${q(title)}`, "[[panes]]", 'id = "main"', 'type = "terminal"', 'shell = "powershell"',
          `directory = ${q(dir)}`, `commands = [${q(encodeWindowsCommand(command).join(" "))}]`, "",
        ].join("\n"));
        return await openExternal("warp://tab_config/" + name);
      }
      const d = pathImpl.join(home(), ".warp", "launch_configurations");
      mkdirSync(d, { recursive: true });
      writeFileSync(pathImpl.join(d, name + ".yaml"), [
        "---", `name: ${q(name)}`, "windows:", "  - tabs:", `      - title: ${q(title)}`, "        layout:",
        `          cwd: ${q(dir)}`, "          commands:", `            - exec: ${q(command)}`, "",
      ].join("\n"));
      return await openExternal("warp://launch/" + name);
    } catch { return false; }
  }

  async function openWindowsTerminal(command, dir, term, title, background) {
    const args = windowsShellArgs(command);
    const bin = await windowsTerminalBin(term);
    if (bin) {
      if (term === "wezterm") {
        const launch = ["--cwd", dir, "--", ...args];
        if ((await runResult(bin, ["cli", "spawn", ...launch])).ok) return term;
        const gui = pathImpl.join(pathImpl.dirname(bin), "wezterm-gui.exe");
        const hasGui = existsSync(gui);
        if (execDetached(hasGui ? gui : bin, ["start", ...launch], { cwd: dir, windowsHide: !hasGui })) return term;
      } else if (term === "alacritty") {
        if (execDetached(bin, ["--working-directory", dir, "--title", title, "-e", ...args], { cwd: dir })) return term;
      } else if (term === "warp") {
        if (await openWarp(command, dir, title)) return term;
      } else if (term === "herdr") {
        const app = findWinBin("herdr-app.exe");
        if (app && await openHerdr(bin, app, dir, title, args, background)) return term;
      } else if (term === "tern") {
        if (await openTern(bin, dir, args, background)) return term;
      } else if (term === "tmux") {
        if (await openWslTmux(bin, dir, title, args, background)) return term;
      }
    }
    return openWindowsHost(dir, args) ? "terminal" : "";
  }

  async function openTerminal(command, cwd = "", which = "auto", title = "Claude", { background = false } = {}) {
    const dir = cwd && existsSync(cwd) ? cwd : home();
    const cleanTitle = sanitizeTitle(title, "Claude");
    if (platform === "win32") {
      return openWindowsTerminal(command, String(dir).replace(/\//g, "\\"), which, cleanTitle, background);
    }

    const term = await pickTerminal(which);
    const sh = loginShell();
    const interactiveCmd = `${command}; exec ${shellQuote(sh)} -l`;

    if (term === "herdr") {
      if (await openHerdr(entryBin(TERMINAL_BY_ID.herdr), findBin("herdr-app"), dir, cleanTitle, [sh, "-lc", interactiveCmd], background)) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // cmux: Ghostty-based macOS terminal multiplexer CLI
    // Official flags (manaflow-ai/cmux CLI/Commands/WorkspaceCommands.swift):
    //   new-workspace [--name <title>] [--cwd <path>] [--command <text>] [--focus <true|false>]
    // --command types text + Enter into the new interactive shell so it stays alive after exit.
    if (term === "cmux") {
      const bin = entryBin(TERMINAL_BY_ID.cmux);
      if (bin) {
        const args = ["new-workspace", "--name", cleanTitle, "--cwd", dir, "--command", command];
        if (background) args.push("--focus", "false");
        let res = await runResult(bin, args);
        if (!res.ok && platform === "darwin" && appInstalled("cmux.app")) {
          const openArgs = background ? ["-g", "-b", TERMINAL_BY_ID.cmux.bundle] : ["-b", TERMINAL_BY_ID.cmux.bundle];
          await run("/usr/bin/open", openArgs);
          await sleep(800);
          res = await runResult(bin, args);
        }
        if (res.ok) {
          if (!background && platform === "darwin") await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.cmux.bundle]);
          return term;
        }
      }
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // tmux: create/reuse dedicated "agent-deck" session and open a new window
    if (term === "tmux") {
      const bin = entryBin(TERMINAL_BY_ID.tmux);
      if (bin) {
        const hasSession = (await runResult(bin, ["has-session", "-t", TMUX_SESSION])).ok;
        const launchArgs = hasSession
          ? ["new-window", "-t", TMUX_SESSION, "-n", cleanTitle, "-c", dir, ...(background ? ["-d"] : []), "--", sh, "-lc", interactiveCmd]
          : ["new-session", "-d", "-s", TMUX_SESSION, "-n", cleanTitle, "-c", dir, "--", sh, "-lc", interactiveCmd];
        const res = await runResult(bin, launchArgs);
        if (res.ok) {
          if (!background) {
            const clients = (await run(bin, ["list-clients", "-t", TMUX_SESSION, "-F", "#{client_pid}"])).trim();
            const firstPid = Number(clients.split(/\s+/)[0]) || 0;
            if (firstPid) {
              const host = await terminalHost(firstPid);
              const bundle = host && TERMINAL_BY_ID[host]?.bundle;
              if (bundle && platform === "darwin") await run("/usr/bin/open", ["-b", bundle]);
            } else {
              const attachCmd = `${shellQuote(bin)} attach-session -t ${TMUX_SESSION}`;
              const hostTerm = await pickTerminal("auto", { exclude: ["tmux"] });
              await openTerminal(attachCmd, dir, hostTerm, cleanTitle, { background: false });
            }
          }
          return term;
        }
      }
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // Ghostty
    if (term === "ghostty") {
      if (platform === "darwin" && appInstalled("Ghostty.app")) {
        const openArgs = [
          ...(background ? ["-g"] : []),
          "-na", "Ghostty.app", "--args",
          `--working-directory=${dir}`,
          "-e", sh, "-lc", interactiveCmd,
        ];
        if (execFire("/usr/bin/open", openArgs)) return term;
      }
      const bin = entryBin(TERMINAL_BY_ID.ghostty);
      if (bin && execDetached(bin, [`--working-directory=${dir}`, "-e", sh, "-lc", interactiveCmd], { cwd: dir })) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // WezTerm
    if (term === "wezterm") {
      const bin = entryBin(TERMINAL_BY_ID.wezterm);
      if (bin) {
        const cliRes = await runResult(bin, ["cli", "spawn", "--cwd", dir, "--", sh, "-lc", interactiveCmd]);
        if (cliRes.ok) {
          if (!background && platform === "darwin") await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.wezterm.bundle]);
          return term;
        }
        if (execDetached(bin, ["start", "--cwd", dir, "--", sh, "-lc", interactiveCmd], { cwd: dir })) {
          if (!background && platform === "darwin") execFire("/usr/bin/open", ["-b", TERMINAL_BY_ID.wezterm.bundle]);
          return term;
        }
      }
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // Kitty
    if (term === "kitty") {
      const bin = entryBin(TERMINAL_BY_ID.kitty);
      if (bin) {
        const remoteRes = await runResult(bin, ["@", "launch", "--type=tab", "--cwd", dir, "--tab-title", cleanTitle, sh, "-lc", interactiveCmd]);
        if (remoteRes.ok) {
          if (!background && platform === "darwin") await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.kitty.bundle]);
          return term;
        }
      }
      if (platform === "darwin" && appInstalled("kitty.app")) {
        const openArgs = [
          ...(background ? ["-g"] : []),
          "-na", "kitty.app", "--args",
          "--directory", dir,
          "--title", cleanTitle,
          sh, "-lc", interactiveCmd,
        ];
        if (execFire("/usr/bin/open", openArgs)) return term;
      }
      if (bin && execDetached(bin, ["--directory", dir, "--title", cleanTitle, sh, "-lc", interactiveCmd], { cwd: dir })) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    // Alacritty
    if (term === "alacritty") {
      if (platform === "darwin" && appInstalled("Alacritty.app")) {
        const openArgs = [
          ...(background ? ["-g"] : []),
          "-na", "Alacritty.app", "--args",
          "--working-directory", dir,
          "--title", cleanTitle,
          "-e", sh, "-lc", interactiveCmd,
        ];
        if (execFire("/usr/bin/open", openArgs)) return term;
      }
      const bin = entryBin(TERMINAL_BY_ID.alacritty);
      if (bin && execDetached(bin, ["--working-directory", dir, "--title", cleanTitle, "-e", sh, "-lc", interactiveCmd], { cwd: dir })) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    if (term === "warp") {
      if (await openWarp(command, dir, cleanTitle)) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    if (term === "tern") {
      const bin = entryBin(TERMINAL_BY_ID.tern);
      if (bin && await openTern(bin, dir, [sh, "-lc", interactiveCmd], background)) return term;
      return openTerminal(command, cwd, "terminal", title, { background });
    }

    if (platform !== "darwin") return "";

    // macOS iTerm2 & Terminal.app via AppleScript
    const line = appleScriptString(`cd ${JSON.stringify(dir)} && ${command}`);
    const script = term === "iterm"
      ? `tell application "iTerm2"\nactivate\nif (count of windows) = 0 then\ncreate window with default profile\nelse\ntell current window to create tab with default profile\nend if\ntell current session of current window to write text ${line}\nend tell`
      : `tell application "Terminal"\nactivate\ndo script ${line}\nend tell`;
    return execFire("/usr/bin/osascript", ["-e", script]) ? (term === "iterm" ? "iterm" : "terminal") : "";
  }

  async function cliProcess(agent, sid) {
    if (!sid || platform === "win32") return null;
    let pid = 0;
    if (agent === "claude") {
      const dir = path.join(home(), ".claude/sessions");
      let names = [];
      try { names = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n)); } catch { return null; }
      for (const n of names) {
        try {
          const j = JSON.parse(await readFile(path.join(dir, n), "utf8"));
          if (j.sessionId === sid && (j.entrypoint || "cli") === "cli") { pid = Number(j.pid) || Number(n.split(".")[0]); break; }
        } catch { /* half-written */ }
      }
    } else if (agent === "codex") {
      const ps = await run("/bin/ps", ["-ax", "-o", "pid=,tty=,command="]);
      const cands = ps.split("\n").map((l) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter((m) => m && m[2] !== "??" && /(^|\/)codex(\s|$)/.test(m[3]) && !/app-server|exec\b/.test(m[3]));
      for (const m of cands) {
        const files = await run("/usr/sbin/lsof", ["-p", m[1], "-Fn"]);
        if (files.includes(sid)) { pid = Number(m[1]); break; }
      }
    }
    if (!pid) return null;
    try { kill(pid, 0); } catch { return null; }
    const tty = (await run("/bin/ps", ["-o", "tty=", "-p", String(pid)])).trim();
    if (!tty || tty === "??") return null;
    return { pid, tty: `/dev/${tty}`, host: await terminalHost(pid) };
  }

  async function focusCliSession(agent, sid) {
    const proc = overrides.cliProcess ? await overrides.cliProcess(agent, sid) : await cliProcess(agent, sid);
    if (!proc) return "";
    const tty = JSON.stringify(proc.tty);

    if (proc.host === "terminal") {
      const ok = await osa(`tell application "Terminal"\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is ${tty} then\nset selected of t to true\nset index of w to 1\nactivate\nreturn "ok"\nend if\nend repeat\nend repeat\nend tell\nreturn ""`);
      if (ok === "ok") return "tab";
    } else if (proc.host === "iterm") {
      const ok = await osa(`tell application "iTerm2"\nrepeat with w in windows\nrepeat with t in tabs of w\nrepeat with s in sessions of t\nif tty of s is ${tty} then\nselect w\ntell t to select\ntell s to select\nactivate\nreturn "ok"\nend if\nend repeat\nend repeat\nend repeat\nend tell\nreturn ""`);
      if (ok === "ok") return "tab";
    } else if (proc.host === "tmux") {
      const bin = entryBin(TERMINAL_BY_ID.tmux);
      if (bin) {
        const panes = await run(bin, ["list-panes", "-a", "-F", "#{pane_tty}\t#{session_name}\t#{window_index}\t#{pane_index}"]);
        for (const line of panes.split("\n")) {
          const [paneTty, sess, win, pane] = line.split("\t");
          if (paneTty === proc.tty && sess) {
            await run(bin, ["select-window", "-t", `${sess}:${win}`]);
            await run(bin, ["select-pane", "-t", `${sess}:${win}.${pane}`]);
            const clients = (await run(bin, ["list-clients", "-t", sess, "-F", "#{client_pid}"])).trim();
            const firstPid = Number(clients.split(/\s+/)[0]) || 0;
            if (firstPid && platform === "darwin") {
              const host = await terminalHost(firstPid);
              const bundle = host && TERMINAL_BY_ID[host]?.bundle;
              if (bundle) await run("/usr/bin/open", ["-b", bundle]);
            }
            return "tab";
          }
        }
      }
    } else if (proc.host === "wezterm") {
      const bin = entryBin(TERMINAL_BY_ID.wezterm);
      if (bin) {
        try {
          const list = JSON.parse(await run(bin, ["cli", "list", "--format", "json"]) || "[]");
          const match = list.find((p) => p && p.tty_name === proc.tty);
          if (match && match.pane_id != null) {
            await run(bin, ["cli", "activate-pane", "--pane-id", String(match.pane_id)]);
            if (platform === "darwin") await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.wezterm.bundle]);
            return "tab";
          }
        } catch { /* fallback to app focus */ }
      }
    } else if (proc.host === "tern") {
      const ternBin = entryBin(TERMINAL_BY_ID.tern);
      if (ternBin) {
        const chain = new Set([proc.pid]);
        for (let i = 0, p = proc.pid; i < 12 && p > 1; i++) {
          p = Number((await run("/bin/ps", ["-o", "ppid=", "-p", String(p)])).trim()) || 0;
          if (p) chain.add(p);
        }
        let blocks = [];
        try {
          const ls = JSON.parse(await run(ternBin, ["ls", "--json"]) || "{}");
          for (const se of ls.sessions || []) for (const tab of se.tabs || []) for (const b of tab.blocks || []) if (b.live) blocks.push(b.id);
        } catch { /* tern not answering */ }
        for (const id of blocks) {
          let pr = null;
          try { pr = JSON.parse(await run(ternBin, ["process", String(id), "--json"]) || "null"); } catch { /* skip */ }
          if (!pr) continue;
          if (chain.has(pr.foreground && pr.foreground.pid) || chain.has(pr.child && pr.child.pid)) {
            await run(ternBin, ["focus", String(id)]);
            await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.tern.bundle]);
            return "tab";
          }
        }
      }
    } else if (proc.host === "herdr" && findBin("hc")) {
      const hc = findBin("hc"), app = findBin("herdr-app");
      const chain = new Set([proc.pid]);
      for (let i = 0, p = proc.pid; i < 12 && p > 1; i++) {
        p = Number((await run("/bin/ps", ["-o", "ppid=", "-p", String(p)])).trim()) || 0;
        if (p) chain.add(p);
      }
      let list = [];
      try { list = (JSON.parse(await run(hc, ["ls", "--json"]) || "{}").terminals || []).filter((item) => item.state === "live"); } catch { /* hc not answering */ }
      for (const item of list) {
        let g = null;
        try { g = JSON.parse(await run(hc, ["get", item.address, "--json"]) || "null"); } catch { /* skip */ }
        if (!g || !(chain.has(g.pid) || chain.has(g.foreground && g.foreground.pid))) continue;
        if (app) await run(app, ["do", g.labels && g.labels["herdr.space"] ? "pane.focus" : "terminal.keep", "--terminal", item.address]);
        await run("/usr/bin/open", ["-b", TERMINAL_BY_ID.herdr.bundle]);
        return "tab";
      }
    }

    const bundle = TERMINAL_BY_ID[proc.host]?.bundle;
    if (!bundle || platform !== "darwin") return "";
    await run("/usr/bin/open", ["-b", bundle]);
    return "app";
  }

  return { pickTerminal, openTerminal, terminalHost, cliProcess, focusCliSession, usable, findBin };
}

const defaultController = createTerminalController();
export const pickTerminal = (...args) => defaultController.pickTerminal(...args);
export const openTerminal = (...args) => defaultController.openTerminal(...args);
export const cliProcess = (...args) => defaultController.cliProcess(...args);
export const focusCliSession = (...args) => defaultController.focusCliSession(...args);
