import { readConversation } from "./conversation.js";
import { createHash } from "crypto";
import { cardPathOf, skillRefIn } from "./skill-cards.js";
import { updateNote } from "./note-updates.js";
// Agent Deck — delegate a note block to Claude Code or DeepSeek Harness.
//
// Claude Code: `claude --bg` (fallback: `claude -p --session-id`), then the
// session can be reopened in the desktop app through claude://resume.
// DeepSeek Harness: a small ACP (Agent Client Protocol) client over `dsh acp`,
// with model and reasoning-effort selection.

import fs from "fs";
import { saveBackgroundAnswer, clearBackgroundPending, backgroundRounds } from "./background-output.js";
import { destinations } from "./workflow.js";
import { folderExists, normalizeProjectFolder, rememberProjectFolder, resolveDispatchFolder, sameFolder, suggestProjectForTask } from "./project-folders.js";
import path from "path";
import os from "os";
import { spawn, execFile } from "child_process";
import { AGENTS, DEFAULTS, CONFIRM_FIRST, clamp, truncate, journalPath } from "./constants.js";
import * as J from "./journal.js";
import { mentionOptions, stripTaskMention, mentionTrigger } from "./task-mentions.js";
import { hasAgentCapability, canContinueInApp } from "./agent-registry.js";
import {
  ancestorLines, withContext, freshTaskText, stripInternalIdentifiers,
  buildDelegationPayload, buildPromptFromContext, createDelegationRunner, HarnessPipeline,
} from "./harness.js";
import {
  findAgentBinary,
  findDshBinary,
  findAgyBinary,
  findOpenCodeBinary,
  findQoderBinary,
  findWorkbuddyBinary,
  findClaudeBinary,
  findTrustedDir,
  findCodexTrustedDir,
  cleanEnv,
  resolveCliModel,
  codexCliArgs,
  resolveDshModel,
  dshEffort,
  acpModels,
  dshModels,
  qoderPermissionArgs,
  AcpRunner,
  getRunnerClasses,
  registerRunnerClass,
} from "./delegation-runners.js";
import { t } from "./i18n.js";

export {
  ancestorLines,
  withContext,
  freshTaskText,
  stripInternalIdentifiers,
  findAgentBinary,
  findDshBinary,
  findAgyBinary,
  findOpenCodeBinary,
  findQoderBinary,
  findWorkbuddyBinary,
  findClaudeBinary,
  findTrustedDir,
  findCodexTrustedDir,
  cleanEnv,
  resolveCliModel,
  codexCliArgs,
  resolveDshModel,
  dshEffort,
  acpModels,
  dshModels,
  qoderPermissionArgs,
  registerRunnerClass,
};

const fsp = fs.promises;
const home = () => os.homedir();
const norm = (p) => String(p || "").replace(/^~(?=\/)/, home());

export { CONFIRM_FIRST } from "./constants.js";

export const BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
export const LINK_RE = J.LINK_RE;
export const RESULT_RE = J.RESULT_RE;
export const STATUS_RE = new RegExp(`^(\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\*\\*\\d{1,2}[:：]\\d{2}\\*\\*\\s*)?)(${J.TASK_KWS})(?=\\s|$)`, "i");
const TITLE_KW_RE = new RegExp(`^(${J.TASK_KWS})\\s+`, "i");

export function blockAt(lines, at) {
  if (at < 0 || at >= lines.length) return null;
  const m = BULLET_RE.exec(lines[at]);
  if (!m) return null;
  // 缩进按视觉宽度算（tab = 4 列），母项用空格、子项用 tab 混着写时，也能认出更深的子块
  const indent = J.width(lines[at]);
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { end = i; continue; }
    if (J.width(line) <= indent) break;
    end = i;
  }
  return { start: at, end, indent, text: lines.slice(at, end + 1).join("\n") };
}

// 发出去的一整段（预览和真正发出去的正文用同一个拼法）。
export function delegationText(lines, block, { newSession = false } = {}) {
  const task = newSession ? freshTaskText(block.text) : block.text;
  return withContext(block ? ancestorLines(lines, block.start) : [], task);
}

export function blockTitle(block, trigger = "@") {
  if (!block) return "";
  const first = J.stripBlockId(stripTaskMention(block.text, trigger).split("\n")[0] || "");
  return first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/, "")
    .replace(TITLE_KW_RE, "")
    .replace(/[#*_`>[\]]/g, "").trim();
}

export function hasLink(lines, block) {
  for (let i = block.start + 1; i <= block.end; i++) if (LINK_RE.test(lines[i]) && J.markOwner(lines, i) === block.start) return i;
  return -1;
}

export function findLink(lines, block) {
  const at = hasLink(lines, block);
  if (at < 0) return null;
  const parsed = J.parseLink(lines[at]);
  if (parsed && parsed.sid) return { line: at, sid: parsed.sid, agent: parsed.agent, raw: lines[at] };
  const m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(lines[at]);
  const wb = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(lines[at]);
  const cx = /codex:\/\/threads\/([0-9a-f-]{36})/i.exec(lines[at]);
  const back = /`([0-9a-f-]{16,}|session-[0-9a-f-]{20,})`/i.exec(lines[at]);
  return { line: at, sid: (m && m[1]) || (cx && cx[1]) || (wb && decodeURIComponent(wb[1])) || (back && back[1]) || "", raw: lines[at] };
}

export function statusOf(line) {
  const m = STATUS_RE.exec(line || "");
  return m ? m[2].toUpperCase() : "";
}

export function markDelegated(line) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/.exec(line || "");
  if (!m) return `DELEGATED ${line || ""}`;
  const rest = m[2];
  const s = STATUS_RE.exec(line);
  if (s) return line.replace(s[2], "DELEGATED");
  return `${m[1]}DELEGATED ${rest}`;
}

export function linkLine(indent, agent, name, sid) {
  return J.linkLine(indent, agent, String(name || "").slice(0, 48), sid);
}

export function openExternal(url) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") { shell.openExternal(url); return true; }
  } catch { /* not electron */ }
  try { execFile("/usr/bin/open", [url], () => {}); return true; } catch { return false; }
}

const appInstalled = (name) => ["/Applications", path.join(home(), "Applications")].some((d) => fs.existsSync(path.join(d, name)));
const TERMINAL_BUNDLE = { terminal: "com.apple.Terminal", iterm: "com.googlecode.iterm2", warp: "dev.warp.Warp-Stable", tern: "so.stencil.tern", herdr: "dev.herdr.app" };
const TERMINAL_APP = { herdr: "Herdr.app", tern: "Tern.app", iterm: "iTerm.app", warp: "Warp.app", terminal: "Terminal.app" };
const TERMINAL_ORDER = ["herdr", "tern", "iterm", "warp", "terminal"];   // 几个都符合时的先后
const HERDR_SPACE = "spagentdeck";   // 委派出去的会话都开在 Herdr 里这个空间下（窗口里叫「Agent Deck」）
const findBin = (name) => [path.join(home(), ".local/bin", name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].find((p) => fs.existsSync(p)) || "";
const TERN_BIN = "/Applications/Tern.app/Contents/MacOS/tern";
const TERN_SESSION = "Agent Deck";   // 委派出去的会话都开在 Tern 里这个会话下
const osa = (script) => new Promise((resolve) => execFile("/usr/bin/osascript", ["-e", script], { timeout: 8000 }, (err, out) => resolve(err ? null : String(out || "").trim())));
const run = (bin, args) => new Promise((resolve) => execFile(bin, args, { timeout: 8000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? "" : String(out || ""))));

// 设置里的「主力终端」。auto 按这台电脑的情况挑：
//   1. 眼下开着的 claude / codex 命令行会话多半在哪个终端里（顺着父进程认），认出来就记下；
//   2. 没有就用上次记下的；3. 再没有就看开着哪个终端；4. 最后看装了哪个；都没有用系统终端。
const DETECTED_FILE = () => path.join(home(), ".agent-deck", "terminal.json");
const usable = (t) => t === "terminal" || (appInstalled(TERMINAL_APP[t]) && (t !== "herdr" || !!findBin("hc")));
export async function pickTerminal(which = "auto") {
  if (TERMINAL_APP[which]) return usable(which) ? which : "terminal";
  const ps = await run("/bin/ps", ["-ax", "-o", "pid=,tty=,comm="]);
  const count = {};
  for (const l of ps.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    if (!m || m[2] === "??" || !/(^|\/)(claude|codex)$/.test(m[3])) continue;
    const host = await terminalHost(Number(m[1]));
    if (host && usable(host)) count[host] = (count[host] || 0) + 1;
  }
  const seen = TERMINAL_ORDER.filter((t) => count[t]).sort((a, b) => count[b] - count[a])[0];
  if (seen) {
    try { await fsp.mkdir(path.dirname(DETECTED_FILE()), { recursive: true }); await fsp.writeFile(DETECTED_FILE(), JSON.stringify({ terminal: seen, at: Date.now() })); } catch { /* not writable */ }
    return seen;
  }
  try { const t = JSON.parse(await fsp.readFile(DETECTED_FILE(), "utf8")).terminal; if (TERMINAL_APP[t] && usable(t)) return t; } catch { /* none yet */ }
  const open = TERMINAL_ORDER.find((t) => usable(t) && ps.includes(`/${TERMINAL_APP[t]}/`));
  if (open) return open;
  return TERMINAL_ORDER.find(usable) || "terminal";
}

export const TERMINAL_NAME = { herdr: "Herdr", tern: "Tern", iterm: "iTerm2", warp: "Warp", terminal: t("系统终端") };

// 在终端里开一个标签跑 command，返回实际用的终端（auto 时是挑出来的那个）
export async function openTerminal(command, cwd = "", which = "auto", title = "Claude", { background = false } = {}) {
  const dir = cwd && fs.existsSync(cwd) ? cwd : home();
  const term = await pickTerminal(which);
  // Herdr：用 hc 起终端，带上 Herdr 的空间 / 标签记号它就出现在窗口里（窗口没开也行，开窗时就在）。
  // 委派放进「Agent Deck」空间、不切过去；resume 这类你点出来的，切过去并把 Herdr 叫到前台。跑完回到 shell，标签留着
  if (term === "herdr") {
    const hc = findBin("hc"), app = findBin("herdr-app");
    const tab = `tbagentdeck${Date.now().toString(36)}`;
    const out = await run(hc, ["run", "--bg", "--keep", "--no-parent", "--json", "--cwd", dir, "--label", `herdr.space=${HERDR_SPACE}`, "--label", `herdr.tab=${tab}`, "--", "/bin/zsh", "-lc", `${command}; exec /bin/zsh -l`]);
    let addr = "";
    try { addr = JSON.parse(out).address || ""; } catch { /* hc not answering */ }
    if (addr) {
      if (app) {
        // 窗口接手新终端要一会儿：等标签出现了再改名，不然改名落空
        for (let i = 0; i < 15 && !(await run(app, ["ls"])).includes(tab); i++) await new Promise((r) => setTimeout(r, 300));
        await run(app, ["do", "space.rename", "--id", HERDR_SPACE, "--name", "Agent Deck"]);
        await run(app, ["do", "tab.rename", "--id", tab, "--name", title]);
        if (!background) await run(app, ["do", "pane.focus", "--terminal", addr]);
      }
      if (!background) await run("/usr/bin/open", ["-b", TERMINAL_BUNDLE.herdr]);
      return term;
    }
    // hc 没起来：退回系统终端
    return openTerminal(command, cwd, "terminal", title, { background });
  }
  // Warp 没有「执行一条命令」的 URL；它认启动配置：写一份 yaml（目录 + 命令），用 warp://launch/<名字> 打开就是新标签里跑
  if (term === "warp") {
    try {
      const d = path.join(home(), ".warp/launch_configurations");
      fs.mkdirSync(d, { recursive: true });
      const q = (s) => JSON.stringify(String(s));
      fs.writeFileSync(path.join(d, "agent-deck-resume.yaml"), [
        "---", "name: agent-deck-resume", "windows:", "  - tabs:", `      - title: ${q(title)}`, "        layout:",
        `          cwd: ${q(dir)}`, "          commands:", `            - exec: ${q(command)}`, "",
      ].join("\n"));
      openExternal("warp://launch/agent-deck-resume");
      return term;
    } catch { /* fall back to Terminal */ }
  }
  // Tern 有命令行：委派（background）放进单独的「Agent Deck」会话里开标签跑，不抢你正看着的会话、也不把 Tern 叫到前台；
  // resume 这类你点出来的，开在正显示的会话里并叫到前台。跑完回到 shell，标签留着。Tern 没在跑先起守护进程再试，还不行就开个窗口
  if (term === "tern" && fs.existsSync(TERN_BIN)) {
    const launch = ["--cwd", dir, "--", "/bin/zsh", "-lc", `${command}; exec /bin/zsh -l`];
    (async () => {
      const tryOnce = async () => {
        if (!background) return (await run(TERN_BIN, ["new", "tab", "--json", ...launch])) !== "";
        let has = false;
        try { has = (JSON.parse(await run(TERN_BIN, ["ls", "--json"]) || "{}").sessions || []).some((x) => x.name === TERN_SESSION); } catch { /* not running */ }
        return (await run(TERN_BIN, has ? ["new", "tab", TERN_SESSION, "--json", ...launch] : ["new", "session", TERN_SESSION, "--json", ...launch])) !== "";
      };
      let ok = await tryOnce();
      if (!ok) { await run(TERN_BIN, ["daemon", "--login"]); ok = await tryOnce(); }
      if (!ok) { try { spawn(TERN_BIN, ["-e", "/bin/zsh", "-lc", `${command}; exec /bin/zsh -l`], { cwd: dir, detached: true, stdio: "ignore" }).unref(); } catch { /* not runnable */ } return; }
      if (!background) execFile("/usr/bin/open", ["-b", TERMINAL_BUNDLE.tern], () => {});
    })();
    return term;
  }
  const line = JSON.stringify(`cd ${JSON.stringify(dir)} && ${command}`);
  const script = term === "iterm"
    ? `tell application "iTerm2"\nactivate\nif (count of windows) = 0 then\ncreate window with default profile\nelse\ntell current window to create tab with default profile\nend if\ntell current session of current window to write text ${line}\nend tell`
    : `tell application "Terminal"\nactivate\ndo script ${line}\nend tell`;
  try { execFile("/usr/bin/osascript", ["-e", script], () => {}); return term === "iterm" ? "iterm" : "terminal"; } catch { return ""; }
}

// 命令行会话眼下跑在哪个进程、哪个 tty 上。没在跑就是 null。
//   Claude Code：每个交互进程写一份 ~/.claude/sessions/<pid>.json，里面有 sessionId；
//   Codex：找带 tty 的 codex 进程，看它开着的文件里有没有这个会话的 rollout-…-<sid>.jsonl。
export async function cliProcess(agent, sid) {
  if (!sid) return null;
  let pid = 0;
  if (agent === "claude") {
    const dir = path.join(home(), ".claude/sessions");
    let names = [];
    try { names = (await fsp.readdir(dir)).filter((n) => /^\d+\.json$/.test(n)); } catch { return null; }
    for (const n of names) {
      try {
        const j = JSON.parse(await fsp.readFile(path.join(dir, n), "utf8"));
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
  try { process.kill(pid, 0); } catch { return null; }
  const tty = (await run("/bin/ps", ["-o", "tty=", "-p", String(pid)])).trim();
  if (!tty || tty === "??") return null;
  return { pid, tty: `/dev/${tty}`, host: await terminalHost(pid) };
}

// 顺着父进程往上找，看这个进程是在哪个终端 App 里开的
async function terminalHost(pid) {
  for (let i = 0, p = pid; i < 12 && p > 1; i++) {
    const out = (await run("/bin/ps", ["-o", "ppid=,comm=", "-p", String(p)])).trim();
    const m = /^(\d+)\s+(.*)$/.exec(out);
    if (!m) break;
    if (/(^|\/)herdr-core$|Herdr\.app/.test(m[2])) return "herdr";
    if (/Warp\.app/i.test(m[2])) return "warp";
    if (/Tern\.app|(^|\/)tern$/.test(m[2])) return "tern";
    if (/iTerm/i.test(m[2])) return "iterm";
    if (/Terminal\.app/i.test(m[2])) return "terminal";
    p = Number(m[1]);
  }
  return "";
}

// 切到正在跑这个会话的那个终端标签。Terminal / iTerm2 按 tty 找到标签选中、窗口提到最前；
// Warp 没有脚本接口，只能把 Warp 叫到前台。返回 "tab"（切到了标签）/ "app"（只叫到了前台）/ ""（没找到）
export async function focusCliSession(agent, sid) {
  const proc = await cliProcess(agent, sid);
  if (!proc) return "";
  const tty = JSON.stringify(proc.tty);
  if (proc.host === "terminal") {
    const ok = await osa(`tell application "Terminal"\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is ${tty} then\nset selected of t to true\nset index of w to 1\nactivate\nreturn "ok"\nend if\nend repeat\nend repeat\nend tell\nreturn ""`);
    if (ok === "ok") return "tab";
  } else if (proc.host === "iterm") {
    const ok = await osa(`tell application "iTerm2"\nrepeat with w in windows\nrepeat with t in tabs of w\nrepeat with s in sessions of t\nif tty of s is ${tty} then\nselect w\ntell t to select\ntell s to select\nactivate\nreturn "ok"\nend if\nend repeat\nend repeat\nend repeat\nend tell\nreturn ""`);
    if (ok === "ok") return "tab";
  } else if (proc.host === "tern" && fs.existsSync(TERN_BIN)) {
    // Tern：tern ls 列出块，tern process 给出每个块的 shell 和前台进程，和会话进程的祖先链对上就 tern focus 那个块
    const chain = new Set([proc.pid]);
    for (let i = 0, p = proc.pid; i < 12 && p > 1; i++) {
      p = Number((await run("/bin/ps", ["-o", "ppid=", "-p", String(p)])).trim()) || 0;
      if (p) chain.add(p);
    }
    let blocks = [];
    try {
      const ls = JSON.parse(await run(TERN_BIN, ["ls", "--json"]) || "{}");
      for (const se of ls.sessions || []) for (const tab of se.tabs || []) for (const b of tab.blocks || []) if (b.live) blocks.push(b.id);
    } catch { /* tern not answering */ }
    for (const id of blocks) {
      let pr = null;
      try { pr = JSON.parse(await run(TERN_BIN, ["process", String(id), "--json"]) || "null"); } catch { /* skip */ }
      if (!pr) continue;
      if (chain.has(pr.foreground && pr.foreground.pid) || chain.has(pr.child && pr.child.pid)) {
        await run(TERN_BIN, ["focus", String(id)]);
        await run("/usr/bin/open", ["-b", TERMINAL_BUNDLE.tern]);
        return "tab";
      }
    }
  }
  if (proc.host === "herdr" && findBin("hc")) {
    // Herdr：hc ls 列出终端，hc get 给出每个终端的 shell 和前台进程，和会话进程的祖先链对上就切过去
    const hc = findBin("hc"), app = findBin("herdr-app");
    const chain = new Set([proc.pid]);
    for (let i = 0, p = proc.pid; i < 12 && p > 1; i++) {
      p = Number((await run("/bin/ps", ["-o", "ppid=", "-p", String(p)])).trim()) || 0;
      if (p) chain.add(p);
    }
    let list = [];
    try { list = (JSON.parse(await run(hc, ["ls", "--json"]) || "{}").terminals || []).filter((t) => t.state === "live"); } catch { /* hc not answering */ }
    for (const t of list) {
      let g = null;
      try { g = JSON.parse(await run(hc, ["get", t.address, "--json"]) || "null"); } catch { /* skip */ }
      if (!g || !(chain.has(g.pid) || chain.has(g.foreground && g.foreground.pid))) continue;
      // 没有 Herdr 记号的（别处用 hc 起的）先给它一个标签页，再切过去
      if (app) await run(app, ["do", g.labels && g.labels["herdr.space"] ? "pane.focus" : "terminal.keep", "--terminal", t.address]);
      await run("/usr/bin/open", ["-b", TERMINAL_BUNDLE.herdr]);
      return "tab";
    }
  }
  const bundle = TERMINAL_BUNDLE[proc.host];
  if (!bundle) return "";
  await run("/usr/bin/open", ["-b", bundle]);
  return "app";
}

// Codex 会话的 originator：桌面版 / IDE 插件里起的才有会话页可跳；codex_cli_rs、codex_exec 是命令行
export const isCodexDesktop = (app) => /desktop|vscode|app|ide|agent_deck/i.test(String(app || "")) && !/exec|cli/i.test(String(app || ""));
// 命令行会话（Claude Code 终端版、Codex 命令行、Qoder CLI）：点开回终端，而不是交给桌面版
export function isCliSession(agent, app) {
  if (["claude", "qoder", "workbuddy"].includes(agent)) return app === "cli";
  if (agent === "codex") return !isCodexDesktop(app);
  return false;
}

export function sessionDeepLink(agent, sid) {
  if (!sid) return "";
  if (agent === "claude") return `claude://resume?session=${sid}`;
  if (agent === "workbuddy") return `workbuddy://chat/${encodeURIComponent(sid)}`;
  if (agent === "dsh") return "dsh://open";
  if (agent === "antigravity") return "antigravity://";
  if (agent === "codex") return `codex://threads/${sid}`;
  return "";
}

// 点 Agent 卡片上的 App 图标：把那个客户端叫到前台。按 bundle id 找，App 改名、挪位置都不影响；
// 找不到再退回各家自己的 URL scheme
export const AGENT_APPS = {
  claude: { bundle: "com.anthropic.claudefordesktop", url: "claude://" },
  codex: { bundle: "com.openai.codex", url: "codex://launch" },
  workbuddy: { bundle: "com.tencent.workbuddy.mac", url: "workbuddy://home" },
  dsh: { bundle: "com.deepseek.dsh", url: "dsh://open" },
  antigravity: { bundle: "com.google.antigravity", url: "antigravity://" },
  opencode: { bundle: "ai.opencode.desktop", url: "opencode://" },
  qoder: { bundle: "com.qoder.app", url: "qoder://" },
  cursor: { bundle: "com.todesktop.230313mzl4w4u92", url: "cursor://" },
  grokbot: { bundle: "com.anysphere.sand", url: "grokbot://" },
};

export function openAgentApp(agent) {
  const app = AGENT_APPS[agent];
  if (!app) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("/usr/bin/open", ["-b", app.bundle], (err) => {
      if (!err) return resolve(true);
      resolve(openExternal(app.url));
    });
  });
}

export function copyText(text) {
  try { require("electron").clipboard.writeText(text); return true; } catch { /* not electron */ }
  try { navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function focusOrResume(plugin, agent, sid, resumeCmd, cwd) {
  focusCliSession(agent, sid).then((how) => {
    if (how === "tab") return;
    if (how === "app") return plugin.notice(t("已切到 Warp"));
    openTerminal(resumeCmd, cwd, plugin.settings.cliTerminal || "auto", AGENTS[agent]?.short || "Claude");
  }).catch(() => openTerminal(resumeCmd, cwd, plugin.settings.cliTerminal || "auto"));
  return true;
}

export function openSession(plugin, agent, sid, app = "", session = null) {
  if (!sid) { plugin.notice(t("这个会话还没有会话号，稍等一秒再点")); return false; }
  if (["opencode", "qoder", "cursor", "grokbot"].includes(agent)) {
    if (agent === "qoder" && app === "cli") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `${shellQuote(findQoderBinary(plugin.settings.delegate?.qoder?.path || ""))} -r ${shellQuote(sid)}`, cwd);
    }
    copyText(sid);
    openAgentApp(agent).then((ok) => plugin.notice(ok ? t("已打开 {agent}；会话号已复制，请在客户端选择会话", { agent: AGENTS[agent].name }) : t("没打开 {agent}：本机好像没装", { agent: AGENTS[agent].name })));
    return true;
  }
  if (agent === "claude") {
    // 终端里起的会话：还开着就切到那个终端标签；关了才在新标签里 cd 到会话原来的目录 claude --resume。设置里可以改成走桌面版
    if (app === "cli" && plugin.settings.cliOpen !== "desktop") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `claude --resume ${sid}`, cwd);
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") {
    const meta = session || (plugin.usage && plugin.usage.meta.get(sid)) || {};
    if ((app === "cli" || meta.app === "cli")) {
      return focusOrResume(plugin, agent, sid, `${shellQuote(findWorkbuddyBinary(plugin.settings?.delegate?.workbuddy?.path || ""))} -r ${shellQuote(sid)}`, meta.cwd || "");
    }
    openExternal(`workbuddy://chat/${encodeURIComponent(sid)}`);
    return true;
  }
  if (agent === "codex") {
    // 命令行里起的（codex / codex exec）：开着就切到那个终端标签，关了才 codex resume；桌面版里的用 codex://threads/<id> 回桌面版
    const meta = session || (plugin.usage && plugin.usage.meta.get(sid)) || {};
    if (!isCodexDesktop(app || meta.app) && plugin.settings.cliOpen !== "desktop") {
      return focusOrResume(plugin, agent, sid, `codex resume ${sid}`, meta.cwd || "");
    }
    openExternal(`codex://threads/${sid}`);
    copyText(`codex resume ${sid}`);
    return true;
  }
  if (agent === "dsh") {
    // The desktop build currently only exposes dsh://open (focus the client). Keep the
    // session id on the clipboard and say so, instead of pretending to deep-link a row.
    openExternal("dsh://open");
    try { navigator.clipboard.writeText(sid); } catch { /* clipboard */ }
    plugin.notice(t("已打开 DeepSeek Harness；会话号已复制"));
    return true;
  }
  if (agent === "antigravity") {
    openAgentApp("antigravity");
    copyText(sid);
    plugin.notice(t("已打开 Antigravity；会话号已复制"));
    return true;
  }
  return false;
}

const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'";

// 任务块下面挂着的派发草稿链接（后出现的优先，方便"再生成一版"覆盖旧的）。
export function findDraftLink(lines = [], block = null) {
  if (!block) return "";
  const end = Number.isInteger(block.end) ? block.end : block.start;
  let found = "";
  for (let i = block.start; i <= end && i < lines.length; i++) {
    const m = /\[\[([^\]|]*Agent Deck\/派发\/[^\]|]+?)(?:\|[^\]]*)?\]\]/.exec(lines[i] || "");
    if (m) found = m[1].replace(/\.md$/, "");
  }
  return found;
}

export class Delegator {
  constructor(plugin) {
    this.plugin = plugin;
    this.jobs = plugin.jobs;          // by id
    this.runners = new Map();         // id -> runner
    this.harness = new HarnessPipeline();
    this.settings = plugin.settings;
    this.vaultPath = plugin.vaultPath;
  }

  async resolveBlockContext(opts, missingBlockMsg) {
    const file = opts.file;
    if (!file) throw new Error(t("没有当前笔记"));
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error(missingBlockMsg);
    if (!opts.newSession && hasLink(lines, block) >= 0) throw new Error(t("这一块下面已经有 🔗 了；要重发先删掉那一行"));
    const title = blockTitle(block, mentionTrigger(this.plugin)) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const payload = await buildDelegationPayload({ plugin: this.plugin, file, lines, block, opts });
    return { file, lines, block, title, name, ...payload };
  }

  // 草稿与派发共用：把技能路径、被引用笔记的绝对路径前置进 prompt。
  async enrichPrompt(resolved, skillRaw = "") {
    const vault = this.plugin?.app?.vault;
    if (!vault || !resolved) return resolved;
    try {
    const text = String(resolved.block?.text || "");
    // 代码块与行内代码里出现的 [[...]] 只是文字，不是引用。
    const lines = text.split("\n");
    const fenced = J.fencedLines(lines);
    const scan = lines.map((line, i) => (fenced.has(i) ? "" : line.replace(/`[^`]*`/g, ""))).join("\n");
    const notePaths = [];
    for (const m of scan.matchAll(/\[\[([^\]|#]+)/g)) {
      const name = m[1].trim();
      if (!name || name.startsWith("技能/") || vault.getAbstractFileByPath(`技能/${name}.md`)) continue;
      const dest = this.plugin.app.metadataCache?.getFirstLinkpathDest?.(name, resolved.file?.path || "");
      // 任务块自己、以及它挂着的派发载荷/草稿都不是素材。
      if (!dest || dest.extension !== "md" || dest.path === resolved.file?.path || dest.path.startsWith("Agent Deck/派发/")) continue;
      const abs = `${this.vaultPath}/${dest.path}`;
      if (!notePaths.includes(abs)) notePaths.push(abs);
    }
    // 草稿里已经带过这些行：派发时沿用草稿的话别再套一遍，免得同一句出现两次。
    const notesHead = t("任务里引用的笔记（可直接读全文）：");
    if (notePaths.length && !resolved.prompt.includes(notesHead)) resolved.prompt = `${notesHead}\n${notePaths.map((p) => `- ${p}`).join("\n")}\n\n${resolved.prompt}`;
    const memoryHint = await this.memoryToolHint();
    if (memoryHint && !resolved.prompt.includes(memoryHint)) resolved.prompt = `${memoryHint}\n\n${resolved.prompt}`;
    const plainSkill = [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).find((name) => vault.getAbstractFileByPath(`技能/${name}.md`)) || "";
    const skillName = skillRefIn(skillRaw) || skillRefIn(text) || plainSkill;
    if (!skillName) return resolved;
    const cardFile = vault.getAbstractFileByPath(`技能/${skillName}.md`);
    const skillPath = cardFile ? cardPathOf(await vault.read(cardFile)) : "";
    const skillLine = `${t("使用技能：")}${skillName}（${skillPath}）——先读这个文件，按其中流程执行。`;
    if (skillPath && !resolved.prompt.includes(skillLine)) resolved.prompt = `${skillLine}\n\n${resolved.prompt}`;
    } catch (e) { console.error("[agent-deck] 富化上下文失败（不影响派发）", e); }
    return resolved;
  }

  // 运行时记忆查询：脚本随插件装在库内；脚本和记忆目录都在，才值得告诉 Agent 这一行用法。
  async memoryToolHint() {
    try {
      const script = `${this.vaultPath}/.obsidian/plugins/agent-deck/scripts/memory-query.mjs`;
      const dir = `${this.vaultPath}/${String(this.settings?.dream?.dir || "Agent Deck/记忆").replace(/\/+$/, "")}`;
      // 用 fs 而不是 vault.adapter：adapter.exists 对 .obsidian 下的文件一律返回 false（2026-11-18 实测）。
      if (!fs.existsSync(script) || !fs.existsSync(dir)) return "";
      return `${t("需要更多背景时：")}node "${script}" search "关键词"`;
    } catch { return ""; }
  }

  // 载荷快照：没有草稿时先把富化写进 payload 再落盘，让"文件为准"这句话站得住。
  async payloadSnapshot(resolved, draft, agent) {
    if (!draft) await this.enrichPrompt(resolved);
    return draft || await this.writeTaskPayload(resolved, agent);
  }

  // 读草稿：正文直接当 prompt；同时把 frontmatter 标成已派发，方便区分"还没发的"和"发过的"。
  async readDraft(draftPath, resolved) {
    try {
      const path = `${draftPath}.md`;
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!file) return null;
      const raw = await this.plugin.app.vault.read(file);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      if (!body) return null;
      const next = raw.replace(/^status: .*$/m, "status: dispatched").replace(/^(created: .+)$/m, `$1\ndispatched: ${new Date().toISOString()}`);
      if (next !== raw) await this.plugin.app.vault.modify(file, next);
      return { path, abs: `${this.vaultPath}/${path}`, draft: true, body, raw, hash: "" };
    } catch (e) { console.error("[agent-deck] 读取派发草稿失败", e); return null; }
  }

  // 载荷文件名：日期 + 时间 + 可读 slug，保证同一天多次派发不覆盖。
  // 有块号就按块号命名：一个任务块永远只有一份载荷，后续派发覆盖它，文件数 ≈ 任务数。
  payloadName({ date, time, name, anchor = "" }) {
    const slug = J.normalizeTaskSlug(name) || String(name || "").replace(/[\\/:*?"<>|#^[\]\s]/g, "").slice(0, 24) || "task";
    return anchor ? `${date}-${anchor}-${slug}.md` : `${date}-${time}-${slug}.md`;
  }

  async writeTaskPayload(resolved, agent, { draft = false } = {}) {
    if (!this.plugin?.app?.vault) return null;
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const dir = "Agent Deck/派发";
      const anchor = resolved.block ? J.blockIdOf(resolved.lines[resolved.block.start]) : "";
      const path = `${dir}/${this.payloadName({ date, time, name: resolved.name, anchor })}`;
      const head = [
        "---",
        "type: 派发载荷",
        `status: ${draft ? "draft" : "dispatched"}`,
        `agent: ${agent}`,
        `task: ${JSON.stringify(String(resolved.name || ""))}`,
        anchor ? `anchor: ${JSON.stringify(`[[${String(resolved.file?.path || "").replace(/\.md$/, "")}#^${anchor}]]`)}` : "",
        `created: ${now.toISOString()}`,
        "---",
        "",
        resolved.prompt,
        "",
      ].filter((l) => l !== "").join("\n");
      const vault = this.plugin.app.vault;
      let cur = "";
      for (const part of dir.split("/")) {
        cur = cur ? `${cur}/${part}` : part;
        if (!vault.getAbstractFileByPath(cur)) await vault.createFolder(cur);
      }
      const existing = vault.getAbstractFileByPath(path);
      if (existing) await vault.modify(existing, head);
      else await vault.create(path, head);
      await updateNote(this.plugin, resolved.file.path, (text) => {
        const lines = text.split("\n");
        const at = anchor ? lines.findIndex((l) => J.blockIdOf(l) === anchor) : resolved.block.start;
        if (at < 0) return text;
        if (lines.some((l) => l.includes(`[[${path}`))) return text;
        const indent = (/^[ \t]*/.exec(lines[at]) || [""])[0] + "\t";
        lines.splice(at + 1, 0, draft ? `${indent}- 📝 [[${path}|${t("派发草稿")}]]` : `${indent}- 📄 [[${path}|${t("本次载荷")}]]`);
        return lines.join("\n");
      });
      return { path, abs: `${this.vaultPath}/${path}`, hash: createHash("sha256").update(head).digest("hex").slice(0, 16) };
    } catch (e) { console.error("[agent-deck] 写入派发载荷失败", e); return null; }
  }

  buildJobBase({ agent, name, opts, lines, block, question, prompt, ...extra }) {
    return {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent,
      name,
      destination: opts.destination,
      newSession: !!opts.newSession,
      blockId: J.blockIdOf(lines[block.start]),
      path: opts.file.path,
      line: block.start,
      lineText: lines[block.start],
      question,
      blockText: block.text.slice(0, 6000),
      prompt: prompt.slice(0, 12000),
      originalLine: lines[block.start],
      startedAt: Date.now(),
      state: "starting",
      sessionId: "",
      linkWritten: false,
      resultWritten: false,
      ...extra,
    };
  }

  refreshSettings() {
    this.settings = this.plugin.settings;
    this.vaultPath = this.plugin.vaultPath;
  }

  notice(text, ms) { this.plugin.notice(text, ms); }
  notify({ title, body }) { this.plugin.notice(`${title}\n${body}`, 12000); }
  copyText(text) { return copyText(text); }
  openAgentApp(agent) { return openAgentApp(agent); }

  get C() { return this.settings.delegate || DEFAULTS.delegate; }

  defaultModel(agent) {
    const a = this.C[agent] || {};
    return a.model || DEFAULTS.models.defaultByAgent[agent] || "";
  }

  async delegate(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (opts.destination && !destinations(opts.agent).some(o => o.id === opts.destination)) throw new Error(t("此 Agent 不支持所选工作位置"));
    if (opts.destination === "terminal" || (opts.agent === "codex" && !opts.destination && this.C.codex?.transport === "terminal")) return this.handoffCli(opts);
    if (!hasAgentCapability(opts.agent, "delegate") || (opts.agent === "qoder" && opts.destination === "desktop")) return this.handoff(opts);
    const agent = opts.agent;
    const resolved = await this.resolveBlockContext(opts, t("光标要放在一个列表项里"));
    const target = resolveDispatchFolder({
      settings: this.settings,
      explicitCwd: opts.cwd || "",
      explicitName: opts.projectName || "",
      agentCwd: this.C[agent]?.cwd || "",
      vaultPath: this.vaultPath,
      notePath: resolved.file?.path || "",
      contextLines: ancestorLines(resolved.lines, resolved.block.start),
      blockText: resolved.block.text,
    });
    let { folder: cwd, projectName, auto: autoProject } = target;
    if (target.explicit && projectName && folderExists(target.explicit)
      && normalizeProjectFolder(target.explicit) !== normalizeProjectFolder(this.vaultPath)
      && rememberProjectFolder(this.settings, projectName, target.explicit)) this.plugin.saveSettings?.();
    // A dispatch outside today's journal is recorded in the note itself; autoLog
    // skips it unless the user opts back in (settings.noteDispatchJournal).
    const journalToday = (() => { try { return journalPath(this.plugin.app, this.settings); } catch { return ""; } })();
    const noteDispatch = !!resolved.file?.path && resolved.file.path !== journalToday;
    let suggest = null;
    if (!opts.fromDialog) {
      const seen = (this._projectHinted ||= new Set());
      suggest = suggestProjectForTask({
        settings: this.settings,
        recent: this.plugin.projectFolderSuggestions?.(8) || [],
        notePath: resolved.file?.path || "",
        contextLines: ancestorLines(resolved.lines, resolved.block.start),
        blockText: resolved.block.text,
      });
      if (suggest && seen.has(suggest.name)) suggest = null;
      else if (suggest) seen.add(suggest.name);
    }
    // The note path points at project X but the task itself names an
    // unregistered recent project Y: do not silently run in X.
    const conflict = !opts.fromDialog && autoProject && suggest && !sameFolder(suggest.path, cwd);
    if (conflict) {
      cwd = this.vaultPath;
      projectName = "";
      autoProject = null;
    }
    // 优先用挂在任务块下面的草稿：用户改过的内容就是这一趟真正要发的内容。
    const draftPath = findDraftLink(resolved.lines, resolved.block);
    const draft = draftPath ? await this.readDraft(draftPath, resolved) : null;
    // 载荷快照：先富化再落盘。payload 里缺了引用笔记 / 技能路径 / 记忆查询用法，
    // 而 prompt 写着"两者冲突时以文件为准"，那句话就名不副实。
    const payload = await this.payloadSnapshot(resolved, draft, agent);
    if (payload) {
      const source = payload.draft ? payload.body : resolved.prompt;
      const lead = payload.draft
        ? `${t("本次任务按这份已确认的草稿执行：")}\`${payload.abs}\``
        : `${t("本次任务的完整载荷（含上下文与来源）：")}\`${payload.abs}\``;
      resolved.prompt = `${lead}\n${t("下面是被截断的摘要；两者冲突时以文件为准。")}\n\n${source}`;
    }
    // 草稿路径：草稿正文可能被手改（比如加了 [[技能/x]]），按草稿原文再富化一次；
    // 已经带过的行靠 enrichPrompt 自己的去重不会重复。
    if (draft) await this.enrichPrompt(resolved, draft.raw || "");
    const job = this.buildJobBase({
      agent,
      name: resolved.name,
      opts: { ...opts, file: resolved.file },
      lines: resolved.lines,
      block: resolved.block,
      question: resolved.question,
      prompt: resolved.prompt,
      model: agent === "codex" ? resolveCliModel(this.plugin, agent, opts.model || this.defaultModel(agent)) : opts.model || this.defaultModel(agent),
      effort: opts.effort || this.C[agent]?.effort,
      permission: opts.permission || (hasAgentCapability(agent, "permissionControl") ? (this.C[agent]?.permission || "auto") : ""),
      cwd,
      project: projectName,
      noteDispatch,
    });
    // 记下载荷路径与派发时的 hash：之后若文件被改，说明人动过手，可以单独取用。
    if (payload) { job.payloadPath = payload.path; job.payloadHash = payload.hash; }
    const hookPayload = { opts, resolved, job, prompt: resolved.prompt, name: resolved.name };
    await this.harness.run("beforeDelegate", hookPayload);
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.plugin.refreshUI();
    const baseNotice = autoProject
      ? t("🛫 正在委派给 {agent}：{name}（项目 {project}）", { agent: AGENTS[agent]?.name || agent, name: hookPayload.name, project: autoProject.name })
      : t("🛫 正在委派给 {agent}：{name}", { agent: AGENTS[agent]?.name || agent, name: hookPayload.name });
    const hintNotice = conflict
      ? t("任务提到「{name}」，但笔记路径指向「{path}」；这次按库根派发，在委派对话框里选一次即可记住。", { name: suggest.candidate || suggest.name, path: target.auto?.name || "" })
      : suggest
        ? t("这条笔记提到「{name}」，还没登记目录；在委派对话框里选一次即可记住。", { name: suggest.candidate || suggest.name })
        : "";
    this.plugin.notice(hintNotice ? baseNotice + "\n" + hintNotice : baseNotice, hintNotice ? 9000 : 4000);
    const runner = createDelegationRunner(
      agent,
      this,
      job,
      getRunnerClasses(),
      () => (job.destination === "background" ? undefined : openSession(this.plugin, "codex", job.sessionId, "vscode")),
    );
    this.runners.set(job.id, runner);
    // Runners resolve their own cwd from opts.cwd / per-agent settings; only
    // hand them the resolved folder when it is a project one. Leaving the vault
    // case untouched keeps Claude's trusted-directory fallback working.
    const startOpts = { ...opts, prompt: hookPayload.prompt, name: hookPayload.name };
    if (cwd && normalizeProjectFolder(cwd) !== normalizeProjectFolder(this.vaultPath)) startOpts.cwd = cwd;
    try {
      await runner.start(startOpts);
    } catch (e) {
      runner.fail && runner.fail(e && e.message || String(e));
    }
    return job;
  }

  refreshDshModels() { return this.refreshAcpModels("dsh"); }

  async refreshAcpModels(agent) {
    this.refreshSettings();
    return new Promise((resolve, reject) => {
      const d = { settings: this.settings, vaultPath: this.vaultPath,
        saveJobs() {}, saveJobsSoon() {}, refreshUI() {}, onDone: (job) => { this.saveJobs(); resolve(job.availableModels || []); },
        onError: (job) => reject(new Error(job.error)) };
      const runner = new AcpRunner(d, { agent });
      runner.start({ discoverOnly: true }).catch((e) => runner.fail(e.message));
    });
  }

  async continueSession(session, prompt) {
    this.refreshSettings();
    if (!canContinueInApp(session.agent)) throw new Error(t("这个 Agent 不支持在 Obsidian 内续聊"));
    prompt = String(prompt || "").trim();
    if (!prompt) throw new Error(t("请输入追问内容"));
    const sid = session.sid || session.sessionId;
    if (!sid) throw new Error(t("这个会话还没有会话号"));
    const existing = Object.values(this.jobs).find((j) => j.agent === session.agent && j.sessionId === sid);
    if (["starting", "running", "needs-approval"].includes(existing?.state)) throw new Error(t("请等当前这一轮结束后再发送"));
    if (session.agent === "antigravity" && existing?.transport !== "acp") throw new Error(t("这是 Antigravity 桌面会话，请在客户端继续"));
    let job = existing;
    if (!job) {
      job = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, agent: session.agent,
        name: session.title || t("{agent} 会话", { agent: AGENTS[session.agent].name }), sessionId: sid, cwd: session.cwd || this.vaultPath,
        linkWritten: true, model: "", effort: "", permission: "", conversation: [] };
      this.jobs[job.id] = job;
    }
    Object.assign(job, { state: "starting", startedAt: Date.now(), endedAt: 0, error: "", result: "", lastText: "", step: "", resultWritten: false });
    this.saveJobs(); this.refreshUI();
    const runner = new AcpRunner(this, job);
    this.runners.set(job.id, runner);
    await runner.start({ sessionId: sid, prompt, cwd: job.cwd, ...(job.model ? { model: job.model } : {}), ...(job.effort ? { effort: job.effort } : {}) });
    return job;
  }

  // 尚未接入自动委派的客户端（或 Qoder 桌面模式）：复制任务并唤起应用，由用户发送。
  // 之后每轮扫描找这个 Agent 新出现、开头对得上的会话，找到就绑回这一行（🔗 + DELEGATED），面板里的卡片飞进「现在」。
  async handoff(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (opts.destination === "terminal") return this.handoffCli(opts);
    if (hasAgentCapability(opts.agent, "delegate") && (opts.agent !== "qoder" || opts.destination !== "desktop")) return this.delegate(opts);
    const agent = opts.agent;
    const resolved = await this.resolveBlockContext(opts, t("要拖一个列表项"));
    const job = this.buildJobBase({
      agent,
      name: resolved.name,
      opts: { ...opts, file: resolved.file },
      lines: resolved.lines,
      block: resolved.block,
      question: resolved.question,
      prompt: resolved.prompt,
      handoff: true,
      step: t("等你在 {agent} 里发出去", { agent: AGENTS[agent]?.name || agent }),
      cwd: this.vaultPath,
    });
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.copyText(resolved.prompt);
    await this.openAgentApp(agent);
    this.plugin.notice(t("📋 任务已复制，粘贴到 {agent} 里发出", { agent: AGENTS[agent]?.name || agent }), 10000);
    this.plugin.refreshUI();
    return job;
  }

  // 按住 ⌘ 拖到 Claude Code / Codex / OpenCode / Qoder 上：在主力终端里新开一个标签跑交互式命令行，任务直接当第一句发出去。
  // 进程是你的终端开的，不归插件管；会话一出现照交接的办法认领、绑回这一行。
  async handoffCli(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (!hasAgentCapability(opts.agent, "terminalHandoff")) return this.delegate(opts);
    const agent = opts.agent;
    const resolved = await this.resolveBlockContext(opts, t("要拖一个列表项"));
    const { lines, block, name, question, prompt } = resolved;
    let cwd = norm(opts.cwd || this.C[agent]?.cwd || this.vaultPath);
    // 交互式 claude 在没信任过的目录里会先停在信任提示上，任务就不会自己跑：和后台委派一样换到信任过的目录，库用 --add-dir 加进去
    let extra = "";
    if (agent === "claude") {
      const cfg = this.C.claude || {};
      if (cfg.autoTrustedCwd !== false && !opts.cwd && !cfg.cwd) {
        const trusted = await findTrustedDir(this.vaultPath);
        if (trusted) cwd = trusted;
      }
      if (this.vaultPath && cwd !== this.vaultPath) extra += ` --add-dir ${shellQuote(this.vaultPath)}`;
      if (cfg.permission) extra += ` --permission-mode ${cfg.permission}`;
    } else if (agent === "codex" && !opts.cwd && !this.C.codex?.cwd) {
      // 交互式 codex 在没信任过的目录里也会停在信任提示上：同样换到信任过的目录，库用 --add-dir 加进去
      cwd = await findCodexTrustedDir(this.vaultPath);
      if (this.vaultPath && cwd !== this.vaultPath) extra += ` -C ${shellQuote(cwd)} --add-dir ${shellQuote(this.vaultPath)}`;
    }
    const model = resolveCliModel(this.plugin, agent, opts.model || this.defaultModel(agent));
    const effort = opts.effort || this.C[agent]?.effort || "high";
    if (agent === "codex") extra += " " + codexCliArgs(this.plugin, opts).map(shellQuote).join(" ");
    else if (agent === "claude") extra += ` --model ${shellQuote(model)} --effort ${shellQuote(effort)}`;
    // 任务文字放进临时文件，命令里用 "$(cat …)" 取：多行、引号都不用转义
    const dir = path.join(os.tmpdir(), "agent-deck");
    await fsp.mkdir(dir, { recursive: true });
    const taskFile = path.join(dir, `task-${Date.now().toString(36)}.txt`);
    await fsp.writeFile(taskFile, prompt, "utf8");
    const bin = findAgentBinary(agent, this.C[agent]?.path || "");
    const job = this.buildJobBase({
      agent,
      name,
      opts: { ...opts, file: resolved.file },
      lines,
      block,
      question,
      prompt,
      model,
      effort,
      handoff: true,
      cli: true,
      app: agent === "codex" ? "codex_cli_rs" : "cli",
      step: t("在终端里开 {agent}", { agent: AGENTS[agent]?.name || agent }),
      cwd,
    });
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    let cmd;
    if (agent === "opencode") {
      const auto = this.C.opencode?.autoApprove ? " --auto" : "";
      cmd = `${shellQuote(bin)}${auto} --prompt "$(cat ${shellQuote(taskFile)})" ${shellQuote(cwd)}`;
    } else if (agent === "qoder") {
      const perm = qoderPermissionArgs(opts.permission || this.C.qoder?.permission || "auto").map(shellQuote).join(" ");
      const addDir = this.vaultPath && cwd !== this.vaultPath ? ` --add-dir ${shellQuote(this.vaultPath)}` : "";
      cmd = `${shellQuote(bin)} -w ${shellQuote(cwd)}${addDir} ${perm} -m ${shellQuote(model)} --reasoning-effort ${shellQuote(effort)} -n ${shellQuote(name)} -- "$(cat ${shellQuote(taskFile)})"`;
    } else if (agent === "workbuddy") {
      const addDir = this.vaultPath && cwd !== this.vaultPath ? ` --add-dir ${shellQuote(this.vaultPath)}` : "";
      cmd = `${shellQuote(bin)}${addDir} -- "$(cat ${shellQuote(taskFile)})"`;
    } else {
      // 任务前面加 --：任务常以「- TODO」开头，不加会被当成命令行参数（unknown option）
      cmd = `${shellQuote(bin)}${extra} -- "$(cat ${shellQuote(taskFile)})"`;
    }
    const term = await openTerminal(cmd, cwd, this.plugin.settings.cliTerminal || "auto", truncate(name, 24), { background: true });
    this.plugin.notice(t("已在 {terminal} 里开 {agent}", { terminal: term === "terminal" ? t("系统终端") : (TERMINAL_NAME[term] || t("终端")), agent: AGENTS[agent]?.name || agent }), 6000);
    this.plugin.refreshUI();
    return job;
  }

  // 每轮扫描后调用：交接中的任务认领新会话；半小时没等到就作罢
  resolveHandoffs(usage) {
    const waiting = Object.values(this.jobs).filter((j) => j.handoff && j.state === "starting" && !j.sessionId);
    if (!waiting.length) return;
    const taken = new Set(Object.values(this.jobs).map((j) => j.sessionId).filter(Boolean));
    const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    for (const job of waiting) {
      if (Date.now() - job.startedAt > 30 * 60000) {
        job.state = "cancelled";
        job.error = t("半小时里没在客户端看到这个任务的新会话");
        job.endedAt = Date.now();
        this.saveJobs();
        continue;
      }
      const head = norm(job.name).slice(0, 10);
      const promptHead = norm(job.prompt).slice(0, 24);
      let best = null;
      for (const m of usage.meta.values()) {
        if (m.agent !== job.agent || taken.has(m.sid) || (m.lastAt || 0) < job.startedAt - 5000) continue;
        if (job.cli && job.agent !== "opencode" && !isCliSession(m.agent, m.app)) continue;   // 终端里开的只认命令行会话
        const t = norm(m.text || m.title);
        if (!t || !(t.includes(head) || t.startsWith(promptHead.slice(0, 16)))) continue;
        if (!best || (m.lastAt || 0) < (best.lastAt || 0)) best = m;
      }
      if (!best) continue;
      taken.add(best.sid);
      job.app = best.app || "";
      this.onSession(job, best.sid);
    }
  }

  buildPrompt(opts) {
    return buildPromptFromContext(this.plugin, opts);
  }

  onSession(job, sid) {
    job.sessionId = sid;
    if (job.noteDispatch && !job.handoff) {
      const map = (this.settings.noteDispatchSessions ||= {});
      map[sid] = Date.now();
      const cutoff = Date.now() - 180 * 86400000;
      for (const [key, at] of Object.entries(map)) if (!(at > cutoff)) delete map[key];
      const keys = Object.keys(map);
      if (keys.length > 2000) for (const key of keys.slice(0, keys.length - 2000)) delete map[key];
      this.saveJobs();
    }
    // 交接来的会话不归 Agent Deck 管进程：绑上之后状态全看会话日志
    job.state = job.handoff ? "bound" : "running";
    this.plugin.markBound?.(sid);
    this.plugin.flyFromAgent?.(job);
    this.saveJobs();
    if (!job.openedDestination && !job.handoff && job.destination === "desktop") {
      job.openedDestination = true;
      if (job.agent === "dsh") openSession(this.plugin, job.agent, sid);
    }
    if (job.linkWritten) return;
    job.linkWritten = true;
    job._linkPromise = this.writeLink(job, sid).catch((e) => console.error("[agent-deck] writeLink", e));
    this.refreshUI();
  }

  async writeLink(job, sid) {
    if (!this.C.writeLink) return;
    const path = job.path;
    const existing = job.blockId || J.blockIdOf(job.lineText);
    const blockId = existing || (this.plugin.taskBlockId
      ? await this.plugin.taskBlockId(sid, job.agent, job.name)
      : J.makeBlockId(sid, job.agent, job.name));
    await updateNote(this.plugin, path, text => {
      const lines = text.split("\n");
      let at = job.blockId ? lines.findIndex((l) => J.blockIdOf(l) === job.blockId) : -1;
      if (at < 0) at = lines.findIndex((l) => l === job.lineText);
      if (at < 0) at = lines.findIndex((l) => blockTitle({ text: l }) && l.includes(truncate(job.name, 20)));
      if (at < 0) return text;
      const block = blockAt(lines, at);
      if (!block) return text;
      if (lines.slice(block.start + 1, block.end + 1).some(l => J.parseLink(l)?.sid === sid)) return text;
      const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "\t";
      let link = linkLine(indent, job.agent, job.name, sid);
      if (job.agent === "antigravity" && job.transport === "acp") link = link.replace("antigravity://open", `obsidian://agent-deck?do=open&agent=antigravity&sid=${encodeURIComponent(sid)}`);
      if (job.agent === "workbuddy" && job.app === "cli") link = link.replace(/workbuddy:\/\/chat\/[^)]+/, `obsidian://agent-deck?do=open&agent=workbuddy&sid=${encodeURIComponent(sid)}`);
      lines.splice(block.start + 1, 0, link);
      if (this.C.markStatus) lines[block.start] = markDelegated(lines[block.start]);
      const ensured = J.ensureBlockId(lines[block.start], blockId);
      lines[block.start] = ensured.line;
      job.blockId = ensured.blockId;
      job.line = block.start;
      job.lineText = lines[block.start];
      job.linkLineText = link;
      return lines.join("\n");
    });
    this.saveJobs();
  }

  async onDone(job) {
    try { if (job._linkPromise) await job._linkPromise; } catch { /* link failed */ }
    this.refreshUI();
    const agent = AGENTS[job.agent];
    this.plugin.notice(t("✅ {agent} 做完了一轮：{name}", { agent: agent ? agent.name : job.agent, name: job.name }), 8000);
    if ((job.destination === "desktop" || (!job.destination && this.C[job.agent]?.openDesktop === true)) && hasAgentCapability(job.agent, "autoOpenDesktopOnDone") && job.sessionId) openSession(this.plugin, job.agent, job.sessionId, job.app);
    if (this.settings.autoWriteResult && job.linkWritten && job.path) {
      try { await this.writeResult(job); } catch (e) { console.error("[agent-deck] writeResult", e); }
    }
    await this.harness.run("afterResult", { job });
    this.plugin.refreshUI();
  }

  onError(job) {
    this.refreshUI();
    this.harness.run("onError", { job }).catch(() => {});
    const err = String(job.error || "");
    if (job.agent === "claude" && /not trusted/i.test(err)) {
      this.plugin.notice(t("Claude Code 不信任这个工作目录：{cwd} 在终端里 cd 到那儿运行一次 claude，接受信任提示；或者在「委派」设置里把工作目录换成一个已经信任的目录。（这次没有真正跑起来，已经把 🔗 和 DELEGATED 撤回）", { cwd: job.cwd }), 16000);
    } else if (job.agent === "claude" && /unknown option|invalid option|unrecognized/i.test(err)) {
      this.plugin.notice(t("Claude Code 不认识传过去的参数：{error} 把「委派 → 额外参数」清空，或检查 claude --help。", { error: err.slice(0, 300) }), 12000);
    } else {
      this.plugin.notice(t("⚠️ {agent} 没跑完：{name} {error}", { agent: AGENTS[job.agent]?.name || job.agent, name: job.name, error: err || t("详情见控制台") }), 10000);
    }
    if (job.linkWritten && Date.now() - (job.startedAt || 0) < 12000 && /not trusted|unknown option|invalid option|unrecognized|ENOENT/i.test(err)) {
      this.removeLink(job).catch(() => {});
    }
    console.error("[agent-deck] delegate failed", job.id, job.error);
  }

  async removeLink(job) {
    try {
      await updateNote(this.plugin, job.path, text => {
      const lines = text.split("\n");
      const sid = job.sessionId || "";
      let li = sid ? lines.findIndex((l) => l.includes(sid)) : -1;
      if (li < 0 && job.linkLineText) li = lines.indexOf(job.linkLineText);
      if (li >= 0) lines.splice(li, 1);
      let at = lines.indexOf(job.lineText);
      if (at < 0) at = lines.findIndex((l) => /DELEGATED/.test(l) && job.originalLine && l.includes(String(job.name || "").slice(0, 16)));
      if (at >= 0 && job.originalLine && !job.newSession) {
        const block = blockAt(lines, at);
        if (!block || hasLink(lines, block) < 0) lines[at] = job.originalLine;
      }
      return lines.join("\n");
      });
      job.linkWritten = false;
      job.resultWritten = true;
      this.saveJobs();
    } catch (e) { console.error("[agent-deck] removeLink", e); }
  }

  retryBackgroundResults() {
    return Promise.all(Object.values(this.jobs).filter(job => job.destination === "background" && job.state === "done" && !job.resultWritten)
      .map(job => this.writeResult(job).catch(error => console.info("[agent-deck] background result pending", error.message))));
  }

  async writeBackgroundResult(job, rounds) {
    const note = await this.plugin.readNote(job.path);
    const pending = rounds.filter(round => round.said && !J.hasRecordedTurn(note, job.sessionId, round.n || 1));
    if (!pending.length) { job.resultWritten = true; this.saveJobs(); return; }
    const messages = job.conversation?.length ? job.conversation : await readConversation(this.plugin, job);
    const full = backgroundRounds(messages);
    const prepared = [];
    for (const round of pending) {
      const original = full.find(item => item.n === (round.n || 1));
      const complete = original?.said ? { ...round, ask: original.ask, said: original.said } : round;
      prepared.push({ ...complete, replyText: await saveBackgroundAnswer(this.plugin, job, complete) });
    }
    if (this.plugin._unloaded) return;
    let synced;
    await updateNote(this.plugin, job.path, text => {
      if (this.settings.journalAutoWrite === false) return text;
      for (const round of prepared) text = clearBackgroundPending(text, job, round.n || 1);
      synced = J.syncSessionEntry(text, { sid: job.sessionId || "", agent: job.agent, blockId: job.blockId || "",
        key: J.workKey(job.name || ""), rounds: prepared, granularity: "round", detail: "brief", ensureId: true });
      return synced.text;
    });
    if (synced?.line >= 0) {
      if (synced.blockId) job.blockId = synced.blockId;
      job.resultWritten = true;
      this.saveJobs();
    }
  }

  async writeResult(job, { rounds: scannedRounds } = {}) {
    if ((job.resultWritten && !scannedRounds) || this.settings.journalAutoWrite === false || this.plugin._unloaded || !job.path) return;
    const meta = this.plugin.usage?.meta.get(job.sessionId);
    const raw = job.result || meta?.rounds?.at(-1)?.said || meta?.lastText || job.lastText || "";
    if (!raw && !scannedRounds?.length) return;
    if (job.destination === "background") {
      const rounds = scannedRounds || (job.result ? [{ n: meta?.rounds?.at(-1)?.n || 1, said: job.result, ask: meta?.rounds?.at(-1)?.ask }]
        : meta?.rounds?.length ? meta.rounds : [{ n: 1, said: raw }]);
      return this.writeBackgroundResult(job, rounds);
    }
    const rounds = scannedRounds || (meta?.rounds?.length ? meta.rounds : [{ n: 1, at: job.startedAt, ask: "", said: raw }]);
    let synced;
    await updateNote(this.plugin, job.path, text => {
      if ((job.resultWritten && !scannedRounds) || this.settings.journalAutoWrite === false) return text;
      synced = J.syncSessionEntry(text, {
        granularity: this.settings.autoLogGranularity,
        compact: this.settings.autoLogSummaries?.[job.path.split("/").pop().replace(/\.md$/, "")]?.[job.sessionId],
        detail: this.settings.autoLogDetail,
        detailHistory: this.settings.autoLogDetailHistory,
        sid: job.sessionId || "", agent: job.agent, blockId: job.blockId || "", key: J.workKey(job.name || ""),
        said: J.oneSentenceConclusion(raw, clamp(Number(this.settings.resultMax) || 120, 40, 2000)),
        rounds,
        taskTodo: job.agent === "claude" && meta ? meta.todo : null, ensureId: true,
      });
      return synced.text;
    });
    if (synced?.line >= 0) {
      if (synced.blockId) job.blockId = synced.blockId;
      job.resultWritten = true;
      this.saveJobs();
    }
  }

  cancel(id) {
    const runner = this.runners.get(id);
    const job = this.jobs[id];
    if (!job) return false;
    if (runner) runner.cancel();
    else { job.state = "cancelled"; job.endedAt = Date.now(); this.saveJobs(); }
    this.harness.run("onCancel", { job }).catch(() => {});
    this.refreshUI();
    return true;
  }

  saveJobsSoon() {
    if (this._saveT) return;
    this._saveT = setTimeout(() => { this._saveT = null; this.saveJobs(); }, 1500);
  }

  saveJobs() {
    clearTimeout(this._saveT); this._saveT = null;
    this.plugin.saveSettings();
  }

  refreshUI() {
    this.plugin.refreshUI();
  }
}
