// Agent Deck — delegate a note block to Claude Code or DeepSeek Harness.
//
// Claude Code: `claude --bg` (fallback: `claude -p --session-id`), then the
// session can be reopened in the desktop app through claude://resume.
// DeepSeek Harness: a small ACP (Agent Client Protocol) client over `dsh acp`,
// with model and reasoning-effort selection.

import fs from "fs";
import { destinations } from "./workflow.js";
import { CodexDesktopRunner } from "./codex-desktop.js";
import path from "path";
import os from "os";
import { spawn, execFile } from "child_process";
import { AGENTS, DEFAULTS, CONFIRM_FIRST, MODEL_CATALOG, clamp, truncate } from "./constants.js";
import * as J from "./journal.js";
import { mentionOptions, stripTaskMention, mentionTrigger } from "./task-mentions.js";
import { t } from "./i18n.js";

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

// 从最外层到直接母项，保留母项正文与续行，不带兄弟分支。
export function ancestorLines(lines, at) {
  if (at < 0 || at >= lines.length) return [];
  const stack = [], fenced = J.fencedLines(lines);
  for (let i = 0; i <= at; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const w = J.width(line);
    while (stack.length && stack.at(-1).width >= w) stack.pop();
    if (i === at) break;
    if (!fenced.has(i) && BULLET_RE.test(line)) stack.push({ width: w, body: [line] });
    else if (stack.length) stack.at(-1).body.push(line);
  }
  return stack.flatMap(item => item.body);
}

// 母项上下文 + 要做的这一块：母项各占一行、保留原缩进，前面一句说明只做最里面那项。
export function withContext(contextLines, task) {
  const ctx = (contextLines || []).filter((l) => l && l.trim());
  if (!ctx.length) return task;
  return `${t("这条任务在笔记里挂的位置，只做最里面这一项：")}\n\n${ctx.join("\n")}\n${task}`;
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

export function findDshBinary(configured = "") {
  if (configured.trim()) return norm(configured.trim());
  const candidates = [
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
    path.join(home(), "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"),
    path.join(home(), ".local/bin/dsh"),
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* next */ } }
  return "dsh";
}

export function findAgyBinary(configured = "") {
  if (configured.trim()) return norm(configured.trim());
  const candidates = [path.join(home(), ".local/bin/agy"), "/opt/homebrew/bin/agy", "/usr/local/bin/agy"];
  return candidates.find((p) => fs.existsSync(p)) || "agy";
}

export function findClaudeBinary(configured = "") {
  if (configured && configured.trim()) return norm(configured.trim());
  const candidates = [path.join(home(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* next */ } }
  return "claude";
}

// 从已信任的目录里挑一个当工作目录：库本身信任过就用库
function pickTrusted(list, vaultPath) {
  if (list.includes(vaultPath)) return vaultPath;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  // 临时目录随时会被清掉，不用
  const trusted = list.filter((p) => isDir(p) && !/^\/(private\/)?(tmp|var)\//.test(p));
  // Prefer a trusted directory that is not an ancestor of the vault, so a task
  // never starts writing in the middle of the user's home directory.
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

// Codex 的信任记录在 config.toml 的 [projects."目录"] trust_level = "trusted"
export async function findCodexTrustedDir(vaultPath) {
  try {
    const toml = await fsp.readFile(path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "config.toml"), "utf8");
    const list = [...toml.matchAll(/^\[projects\."([^"]+)"\]\s*\n\s*trust_level\s*=\s*"trusted"/gm)].map((m) => m[1]);
    return pickTrusted(list, vaultPath);
  } catch { return vaultPath; }
}

export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const parts = new Set(String(env.PATH || "").split(":").filter(Boolean));
  for (const p of [path.join(home(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) parts.add(p);
  env.PATH = [...parts].join(":");
  return env;
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
// 命令行会话（Claude Code 终端版、Codex 命令行）：点开回终端，而不是交给桌面版
export function isCliSession(agent, app) {
  if (agent === "claude") return app === "cli";
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
  if (agent === "claude") {
    // 终端里起的会话：还开着就切到那个终端标签；关了才在新标签里 cd 到会话原来的目录 claude --resume。设置里可以改成走桌面版
    if (app === "cli" && plugin.settings.cliOpen !== "desktop") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `claude --resume ${sid}`, cwd);
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") { openExternal(`workbuddy://chat/${encodeURIComponent(sid)}`); return true; }
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

// ----- Claude Code -----
class ClaudeRunner {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.short = "";
    this.pollTimer = null;
    this.finished = false;
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
    const model = opts.model || cfg.model || "claude-opus-5-5";
    const modelCli = resolveCliModel(d.plugin, "claude", model);
    const effort = opts.effort || cfg.effort || "high";
    const permission = opts.permission || cfg.permission || "auto";
    const addVault = cfg.addVault !== false && d.vaultPath && d.vaultPath !== cwd;
    const common = ["--model", modelCli, "--effort", effort, "--permission-mode", permission, "-n", name];
    if (addVault) common.push("--add-dir", d.vaultPath);
    if (cfg.extraArgs && cfg.extraArgs.trim()) common.push(...splitArgs(cfg.extraArgs));
    const prompt = opts.prompt;
    // Headless is the reliable default: a child process we own, with the exact
    // model / effort / permission mode, and a session id we choose. The optional
    // `claude --bg` daemon can be flaky across CLI versions, so it is opt-in.
    if (cfg.useBackground === true) {
      const args = ["--bg", ...common, "--", prompt];
      this.job.command = `${bin} ${args.slice(0, -2).join(" ")} …`;
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
    // Older CLI (or a dead background daemon): run headless with a session id we choose.
    const sid = require("crypto").randomUUID();
    const args2 = ["-p", "--session-id", sid, ...common, "--", prompt];
    this.job.command = `${bin} ${args2.slice(0, -2).join(" ")} …`;
    const child = spawn(bin, args2, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.fallbackStarted = true;
    this.job.sessionId = sid;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.short = "";
    this.job.agentState = "headless";
    let err = "";
    child.stdout.on("data", (b) => { const s = b.toString(); this.job.lastText = s.slice(-2000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      if (code === 0) this.done();
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
            // give the session log one poll to settle, then finish
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
    const model = this.job.model || cfg.model || "claude-opus-5-5";
    const modelCli = resolveCliModel(this.d.plugin, "claude", model);
    const addVault = cfg.addVault !== false && this.d.vaultPath && this.d.vaultPath !== (this.job.cwd || cfg.cwd);
    const out = ["--model", modelCli, "--effort", this.job.effort || cfg.effort || "high", "--permission-mode", this.job.permission || cfg.permission || "auto", "-n", this.job.name];
    if (addVault) out.push("--add-dir", this.d.vaultPath);
    return out;
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    if (this.short) {
      const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
      execFile(bin, ["stop", this.short], { env: cleanEnv() }, () => {});
    }
    if (this.child) { try { this.child.kill("SIGTERM"); } catch { /* gone */ } }
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
  }

  done() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onDone(this.job);
  }

  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onError(this.job);
  }
}

// ----- Local ACP agents: Harness and Antigravity -----
class AcpRunner {
  constructor(delegator, job) {
    this.d = delegator;
    this.agent = job.agent || "dsh";
    this.label = AGENTS[this.agent]?.name || this.agent;
    this.job = job;
    this.child = null;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.finished = false;
    this.assistantText = "";
    this.lastStep = "";
    this.sessionId = "";
    this.timer = null;
  }

  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate[this.agent];
    const bin = this.agent === "antigravity" ? findAgyBinary(cfg.path || "") : findDshBinary(cfg.path || "");
    const cwd = norm(opts.cwd || cfg.cwd || d.vaultPath);
    const model = opts.model || cfg.model || (this.agent === "dsh" ? "deepseek-v4-pro" : "");
    const effort = opts.effort || cfg.effort || (this.agent === "dsh" ? "high" : "");
    this.job.command = `${bin} acp`;
    const child = spawn(bin, ["acp", ...splitArgs(cfg.extraArgs || "")], { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => this.onData(text));
    child.stdin.on("error", (e) => this.fail(e.message));
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); this.job.stderr = err.slice(-1000); });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
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
      const available = acpModels(this.agent, configOptions);
      if (available.length) {
        cfg.availableModels = available;
        this.job.availableModels = available;
      }
      if (opts.discoverOnly) { this.done({}); return true; }
      this.job.state = "running";
      this.d.saveJobs();
      this.d.onSession(this.job, this.sessionId);
      const isDefault = this.agent === "antigravity" && (!model || model === "antigravity-default");
      const modelOption = configOptions.find((x) => x.category === "model" || x.id === "model");
      if (opts.model && !isDefault && !modelOption) throw new Error(t("{agent} 未提供模型选择", { agent: this.label }));
      if (modelOption && !isDefault && (!opts.sessionId || opts.model)) {
        const custom = this.d.plugin?.modelById?.(model);
        const selected = custom?.value || (this.agent === "dsh" ? resolveDshModel(model)?.value : model);
        if (!selected) throw new Error(t("无法识别 {agent} 模型：{model}", { agent: this.label, model }));
        const changed = await this.request("session/set_config_option", { sessionId: this.sessionId, configId: modelOption.id, value: selected }, 15000);
        configOptions = changed?.configOptions || configOptions;
      }
      const effortOption = configOptions.find((x) => x.category === "thought_level" || x.id === "reasoning_effort");
      if (opts.effort && !effortOption) throw new Error(t("{agent} 未提供推理强度选择", { agent: this.label }));
      if (effortOption && effort && (!opts.sessionId || opts.effort)) {
        const value = this.agent === "dsh" ? dshEffort(effort) : effort;
        if (this.agent === "antigravity" && !effortOption.options?.some((o) => o.value === value)) throw new Error(t("当前模型不支持推理强度 {value}", { value }));
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
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
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
      } else if (kind === "usage_update") {
        this.job.contextUsed = u.used;
        this.job.contextSize = u.size;
      }
      this.d.saveJobsSoon();
      this.d.refreshUI();
      return;
    }
    if (method === "session/request_permission") {
      const cfg = this.d.settings.delegate[this.agent];
      const options = params.options || [];
      if (this.d.plugin?.requestAcpPermission && cfg.autoApprove !== true) {
        this.job.state = "needs-approval";
        this.job.step = params.toolCall?.title || t("等待工具授权");
        this.d.saveJobs(); this.d.refreshUI();
        Promise.resolve().then(() => this.d.plugin.requestAcpPermission({ agent: this.agent, toolCall: params.toolCall, options }, this))
          .then((optionId) => {
            if (this.finished) return;
            const selected = options.find((o) => o.optionId === optionId);
            this.respond(msg.id, { outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" } });
            this.job.state = "running"; this.job.step = "";
            this.d.saveJobs(); this.d.refreshUI();
          }).catch(() => {
            if (this.finished) return;
            this.respond(msg.id, { outcome: { outcome: "cancelled" } });
            this.job.state = "running"; this.job.step = t("工具调用已取消");
            this.d.saveJobs(); this.d.refreshUI();
          });
        return;
      }
      const auto = cfg.autoApprove === true;
      const option = options.find((o) => o.kind === (auto ? "allow_once" : "reject_once"));
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(t("{method} 超时", { method }))); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.permissionModal?.close();
    this.clearPending();
    if (this.sessionId) { try { this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
    this.close();
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.refreshUI();
  }

  done(result) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.permissionModal?.close();
    this.clearPending();
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.job.stopReason = result && result.stopReason || "";
    if (this.assistantText) {
      this.job.result = this.assistantText;
      this.job.conversation ||= [];
      this.job.conversation.push({ role: "assistant", text: this.assistantText, at: Date.now() });
    }
    this.d.saveJobs();
    this.close();
    this.d.onDone(this.job);
  }

  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.permissionModal?.close();
    this.clearPending();
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.close();
    this.d.onError(this.job);
  }

  clearPending() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(t("{agent} 连接已结束", { agent: this.label }))); }
    this.pending.clear();
  }

  close() {
    if (this.sessionId && this.capabilities?.sessionCapabilities?.close) { try { this.send({ jsonrpc: "2.0", id: this.nextId++, method: "session/close", params: { sessionId: this.sessionId } }); } catch { /* closed */ } }
    if (this.child) {
      this.child.stdin.end();
      const timer = setTimeout(() => { try { this.child.kill("SIGTERM"); } catch { /* gone */ } }, 1200);
      this.child.once("close", () => clearTimeout(timer));
      timer.unref();
    }
    this.d.refreshUI();
  }
}

export function dshModels(configOptions) { return acpModels("dsh", configOptions); }

export function acpModels(agent, configOptions) {
  const option = configOptions.find((x) => x.category === "model" || x.id === "model");
  const result = [];
  for (const group of option?.options || []) {
    for (const item of group.options || [group]) {
      if (typeof item.value !== "string") continue;
      const builtin = MODEL_CATALOG.find((m) => m.agent === agent && m.value === item.value);
      result.push({ id: builtin?.id || `${agent}-acp-${Buffer.from(item.value).toString("base64url")}`, agent, name: item.name || item.value,
        value: item.value, provider: group.options ? group.name : AGENTS[agent].name, context: "—", tags: [], note: item.description || t("ACP 服务端返回的模型") });
    }
  }
  return result;
}

// 内置模型在命令行里的名字（opus / sonnet …）；不在目录里的原样传
export function resolveCliModel(plugin, agent, model) {
  const m = plugin?.modelById?.(model) || MODEL_CATALOG.find((m) => m.agent === agent && m.id === model);
  return m?.cli || m?.value || model;
}
const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'";

export function codexCliArgs(plugin, opts = {}) {
  const cfg = plugin.settings.delegate.codex || DEFAULTS.delegate.codex;
  const model = resolveCliModel(plugin, "codex", opts.model || cfg.model);
  const effort = opts.effort || cfg.effort || "low";
  return ["--model", model, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "--sandbox", cfg.sandbox || "workspace-write"];
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

export class Delegator {
  constructor(plugin) {
    this.plugin = plugin;
    this.jobs = plugin.jobs;          // by id
    this.runners = new Map();         // id -> runner
    this.settings = plugin.settings;
    this.vaultPath = plugin.vaultPath;
  }

  refreshSettings() {
    this.settings = this.plugin.settings;
    this.vaultPath = this.plugin.vaultPath;
  }

  notice(text, ms) { this.plugin.notice(text, ms); }
  notify({ title, body }) { this.plugin.notice(`${title}\n${body}`, 12000); }

  get C() { return this.settings.delegate || DEFAULTS.delegate; }

  defaultModel(agent) {
    const a = this.C[agent] || {};
    return a.model || DEFAULTS.models.defaultByAgent[agent] || "";
  }

  async delegate(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (opts.destination && !destinations(opts.agent).some(o => o.id === opts.destination)) throw new Error(t("此 Agent 不支持所选工作位置"));
    if (!["claude", "codex", "dsh", "antigravity"].includes(opts.agent)) return this.handoff(opts);
    if (opts.destination === "terminal" || (opts.agent === "codex" && !opts.destination && this.C.codex?.transport === "terminal")) return this.handoffCli(opts);
    const agent = opts.agent;
    const file = opts.file;
    if (!file) throw new Error(t("没有当前笔记"));
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error(t("光标要放在一个列表项里"));
    if (!opts.newSession && hasLink(lines, block) >= 0) throw new Error(t("这一块下面已经有 🔗 了；要重发先删掉那一行"));
    const title = blockTitle(block, mentionTrigger(this.plugin)) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title, contextLines: ancestorLines(lines, block.start) });
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent, name, destination: opts.destination, newSession: !!opts.newSession, blockId: J.blockIdOf(lines[block.start]), path: file.path, line: block.start, lineText: lines[block.start],
      blockText: block.text.slice(0, 6000), prompt: prompt.slice(0, 12000),
      originalLine: lines[block.start],
      startedAt: Date.now(), state: "starting", model: agent === "codex" ? resolveCliModel(this.plugin, agent, opts.model || this.defaultModel(agent)) : opts.model || this.defaultModel(agent),
      effort: opts.effort || this.C[agent]?.effort,
      permission: opts.permission || (agent === "dsh" ? "" : this.C.claude.permission),
      cwd: norm(opts.cwd || this.C[agent]?.cwd || this.vaultPath),
      sessionId: "", linkWritten: false, resultWritten: false,
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.plugin.refreshUI();
    this.plugin.notice(t("🛫 正在委派给 {agent}：{name}", { agent: AGENTS[agent]?.name || agent, name }));
    const runner = agent === "codex" ? new CodexDesktopRunner(this, job, () => job.destination === "background" ? undefined : openSession(this.plugin, "codex", job.sessionId, "vscode")) : ["dsh", "antigravity"].includes(agent) ? new AcpRunner(this, job) : new ClaudeRunner(this, job);
    this.runners.set(job.id, runner);
    try {
      await runner.start({ ...opts, prompt, name });
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
    if (!["dsh", "antigravity"].includes(session.agent)) throw new Error(t("这个 Agent 不支持在 Obsidian 内续聊"));
    prompt = String(prompt || "").trim();
    if (!prompt) throw new Error(t("请输入追问内容"));
    const sid = session.sid || session.sessionId;
    if (!sid) throw new Error(t("这个会话还没有会话号"));
    const existing = Object.values(this.jobs).find((j) => j.agent === session.agent && j.sessionId === sid);
    if (["starting", "running", "needs-approval"].includes(existing?.state)) throw new Error(t("请等当前这一轮结束后再发送"));
    if (session.agent === "antigravity" && existing?.transport !== "acp") throw new Error(t("这是 Antigravity 桌面会话，请在客户端继续；在插件中新建 ACP 委派后可在 Obsidian 内续聊"));
    let job = existing;
    if (!job) {
      job = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, agent: session.agent,
        name: session.title || t("{agent} 会话", { agent: AGENTS[session.agent].name }), sessionId: sid, cwd: session.cwd || this.vaultPath,
        linkWritten: true, model: "", effort: "", conversation: [] };
      this.jobs[job.id] = job;
    }
    Object.assign(job, { state: "starting", startedAt: Date.now(), endedAt: 0, error: "", result: "", lastText: "", step: "", resultWritten: false });
    this.saveJobs(); this.refreshUI();
    const runner = new AcpRunner(this, job);
    this.runners.set(job.id, runner);
    await runner.start({ sessionId: sid, prompt, cwd: job.cwd, ...(job.model ? { model: job.model } : {}), ...(job.effort ? { effort: job.effort } : {}) });
    return job;
  }

  // 尚未接入自动委派的客户端：复制任务并唤起应用，由用户发送。
  // 之后每轮扫描找这个 Agent 新出现、开头对得上的会话，找到就绑回这一行（🔗 + DELEGATED），面板里的卡片飞进「现在」。
  async handoff(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (["claude", "codex", "dsh", "antigravity"].includes(opts.agent)) return this.delegate(opts);
    const agent = opts.agent;
    const file = opts.file;
    if (!file) throw new Error(t("没有当前笔记"));
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error(t("要拖一个列表项"));
    if (!opts.newSession && hasLink(lines, block) >= 0) throw new Error(t("这一块下面已经有 🔗 了；要重发先删掉那一行"));
    const title = blockTitle(block, mentionTrigger(this.plugin)) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title, contextLines: ancestorLines(lines, block.start) });
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent, name, destination: opts.destination, newSession: !!opts.newSession, blockId: J.blockIdOf(lines[block.start]), path: file.path, line: block.start, lineText: lines[block.start],
      blockText: block.text.slice(0, 6000), prompt: prompt.slice(0, 12000), originalLine: lines[block.start],
      startedAt: Date.now(), state: "starting", handoff: true, step: t("等你在 {agent} 里发出去", { agent: AGENTS[agent]?.name || agent }),
      cwd: this.vaultPath, sessionId: "", linkWritten: false, resultWritten: false,
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    copyText(prompt);
    await openAgentApp(agent);
    this.plugin.notice(t("📋 任务已复制，粘贴到 {agent} 里发出", { agent: AGENTS[agent]?.name || agent }), 10000);
    this.plugin.refreshUI();
    return job;
  }

  // 按住 ⌘ 拖到 Claude Code / Codex 上：在主力终端里新开一个标签跑交互式的 claude / codex，任务直接当第一句发出去。
  // 进程是你的终端开的，不归插件管；会话一出现照交接的办法认领、绑回这一行。
  async handoffCli(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (!["claude", "codex"].includes(opts.agent)) return this.delegate(opts);
    const agent = opts.agent;
    const file = opts.file;
    if (!file) throw new Error(t("没有当前笔记"));
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error(t("要拖一个列表项"));
    if (!opts.newSession && hasLink(lines, block) >= 0) throw new Error(t("这一块下面已经有 🔗 了；要重发先删掉那一行"));
    const title = blockTitle(block, mentionTrigger(this.plugin)) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title, contextLines: ancestorLines(lines, block.start) });
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
    else extra += ` --model ${shellQuote(model)} --effort ${shellQuote(effort)}`;
    // 任务文字放进临时文件，命令里用 "$(cat …)" 取：多行、引号都不用转义
    const dir = path.join(os.tmpdir(), "agent-deck");
    await fsp.mkdir(dir, { recursive: true });
    const taskFile = path.join(dir, `task-${Date.now().toString(36)}.txt`);
    await fsp.writeFile(taskFile, prompt, "utf8");
    const bin = agent === "codex" ? (this.C.codex?.path || "codex") : findClaudeBinary(this.C.claude?.path || "");
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent, name, destination: opts.destination, newSession: !!opts.newSession, blockId: J.blockIdOf(lines[block.start]), path: file.path, line: block.start, lineText: lines[block.start],
      blockText: block.text.slice(0, 6000), prompt: prompt.slice(0, 12000), originalLine: lines[block.start],
      startedAt: Date.now(), state: "starting", model, effort, handoff: true, cli: true, app: agent === "claude" ? "cli" : "codex_cli_rs",
      step: t("在终端里开 {agent}", { agent: AGENTS[agent]?.name || agent }), cwd, sessionId: "", linkWritten: false, resultWritten: false,
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    // 任务前面加 --：任务常以「- TODO」开头，不加会被当成命令行参数（unknown option）
    const term = await openTerminal(`${shellQuote(bin)}${extra} -- "$(cat ${shellQuote(taskFile)})"`, cwd, this.plugin.settings.cliTerminal || "auto", truncate(name, 24), { background: true });
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
        if (job.cli && !isCliSession(m.agent, m.app)) continue;   // 终端里开的只认命令行会话
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
    const c = this.C;
    const parts = [];
    if (c.promptPrefix && c.promptPrefix.trim()) parts.push(c.promptPrefix.trim());
    const task = opts.newSession ? freshTaskText(opts.block.text) : opts.block.text;
    // 从子项发出去的活，把母项那几行原样带上当上下文，只做最里面这一项
    parts.push(stripTaskMention(withContext(opts.contextLines, task), mentionTrigger(this.plugin)).trim());
    if (opts.promptSuffix && opts.promptSuffix.trim()) parts.push(opts.promptSuffix.trim());
    else if (c.promptSuffix && c.promptSuffix.trim()) parts.push(c.promptSuffix.trim());
    if (opts.file) parts.push(`\n（来自 Obsidian：${opts.file.path}）`);
    if (c.confirmFirst !== false) {
      const prompt = c.confirmFirstPrompt ?? CONFIRM_FIRST;
      if (prompt.trim()) parts.push(prompt.trim());
    }
    return parts.join("\n\n");
  }

  onSession(job, sid) {
    job.sessionId = sid;
    // 交接来的会话不归 Agent Deck 管进程：绑上之后状态全看会话日志
    job.state = job.handoff ? "bound" : "running";
    this.plugin.markBound?.(sid);
    this.plugin.flyFromAgent?.(job);
    this.saveJobs();
    if (!job.openedDestination && !job.handoff && ["obsidian", "desktop"].includes(job.destination)) {
      job.openedDestination = true;
      if (job.destination === "obsidian") this.plugin.openConversation?.({ ...job, sid });
      else if (job.agent === "dsh") openSession(this.plugin, job.agent, sid);
    }
    if (job.linkWritten) return;
    job.linkWritten = true;
    job._linkPromise = this.writeLink(job, sid).catch((e) => console.error("[agent-deck] writeLink", e));
    this.refreshUI();
  }

  writeLink(job, sid) {
    const pending = (this._linkWrites || Promise.resolve()).catch(() => {}).then(() => this.writeLinkNow(job, sid));
    this._linkWrites = pending;
    return pending;
  }

  async writeLinkNow(job, sid) {
    if (!this.C.writeLink) return;
    const path = job.path;
    const text = await this.plugin.readNote(path);
    const lines = text.split("\n");
    let at = job.blockId ? lines.findIndex((l) => J.blockIdOf(l) === job.blockId) : -1;
    if (at < 0) at = lines.findIndex((l) => l === job.lineText);
    if (at < 0) at = lines.findIndex((l) => blockTitle({ text: l }) && l.includes(truncate(job.name, 20)));
    if (at < 0) return;
    const block = blockAt(lines, at);
    if (!block) return;
    if (lines.slice(block.start + 1, block.end + 1).some(l => J.parseLink(l)?.sid === sid)) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "\t";
    let link = linkLine(indent, job.agent, job.name, sid);
    if (job.agent === "antigravity" && job.transport === "acp") link = link.replace("antigravity://open", `obsidian://agent-deck?do=open&agent=antigravity&sid=${encodeURIComponent(sid)}`);
    lines.splice(block.start + 1, 0, link);
    if (this.C.markStatus) lines[block.start] = markDelegated(lines[block.start]);
    const ensured = J.ensureBlockId(lines[block.start], sid);
    lines[block.start] = ensured.line;
    job.blockId = ensured.blockId;
    await this.plugin.writeNote(path, lines.join("\n"));
    job.line = block.start;
    job.lineText = lines[block.start];
    job.linkLineText = link;
    this.saveJobs();
  }

  async onDone(job) {
    try { if (job._linkPromise) await job._linkPromise; } catch { /* link failed */ }
    this.refreshUI();
    const agent = AGENTS[job.agent];
    this.plugin.notice(t("✅ {agent} 做完了一轮：{name}", { agent: agent ? agent.name : job.agent, name: job.name }), 8000);
    if ((job.destination === "desktop" || (!job.destination && this.C.claude.openDesktop === true)) && job.agent === "claude" && job.sessionId) openSession(this.plugin, "claude", job.sessionId);
    if (this.settings.autoWriteResult && job.linkWritten && job.path) {
      try { await this.writeResult(job); } catch (e) { console.error("[agent-deck] writeResult", e); }
    }
    this.plugin.refreshUI();
  }

  onError(job) {
    this.refreshUI();
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
      const text = await this.plugin.readNote(job.path);
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
      await this.plugin.writeNote(job.path, lines.join("\n"));
      job.linkWritten = false;
      job.resultWritten = true;
      this.saveJobs();
    } catch (e) { console.error("[agent-deck] removeLink", e); }
  }

  async writeResult(job) {
    if (job.resultWritten || this.settings.journalAutoWrite === false) return;
    let said = job.result || job.lastText || "";
    const meta = this.plugin.usage && this.plugin.usage.meta.get(job.sessionId);
    if (!said) said = meta && (meta.lastText || "");
    const rawSaid = said;
    said = J.oneSentenceConclusion(said, clamp(Number(this.settings.resultMax) || 120, 40, 2000));
    if (!said) return;
    const text = await this.plugin.readNote(job.path);
    if (this.settings.journalAutoWrite === false) return;
    const synced = J.syncSessionEntry(text, {
      granularity: this.settings.autoLogGranularity,
      compact: this.settings.autoLogSummaries?.[job.path.split("/").pop().replace(/\.md$/, "")]?.[job.sessionId],
      detail: this.settings.autoLogDetail,
        detailHistory: this.settings.autoLogDetailHistory,
      sid: job.sessionId || "",
      blockId: job.blockId || "",
      key: J.workKey(job.name || ""),
      said,
      rounds: meta?.rounds?.length ? meta.rounds : [{ n: 1, at: job.startedAt, ask: "", said: rawSaid }],
      taskTodo: job.agent === "claude" && meta ? meta.todo : null,
      ensureId: true,
    });
    if (synced.line >= 0) {
      if (synced.text !== text) await this.plugin.writeNote(job.path, synced.text);
      if (synced.blockId) job.blockId = synced.blockId;
      job.resultWritten = true;
      this.saveJobs();
      return;
    }
    const lines = text.split("\n");
    let at = job.blockId ? lines.findIndex((l) => J.blockIdOf(l) === job.blockId) : -1;
    if (at < 0) at = lines.indexOf(job.lineText);
    let block = at >= 0 ? blockAt(lines, at) : null;
    if (!block) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "\t";
    let resultAt = -1;
    for (let i = block.start + 1; i <= block.end; i++) if (RESULT_RE.test(lines[i])) { resultAt = i; break; }
    const conclusion = this.settings.autoLogDetail === "standard" || this.settings.autoLogDetail === "detailed" ? said : J.oneSentenceConclusion(said, 45);
    const line = `${indent}- 💬 ${conclusion}`;
    if (resultAt < 0) {
      const link = findLink(lines, block);
      lines.splice((link ? link.line : block.start) + 1, 0, line);
    }
    await this.plugin.writeNote(job.path, lines.join("\n"));
    job.resultWritten = true;
    this.saveJobs();
  }

  cancel(id) {
    const runner = this.runners.get(id);
    const job = this.jobs[id];
    if (!job) return false;
    if (runner) runner.cancel();
    else { job.state = "cancelled"; job.endedAt = Date.now(); this.saveJobs(); }
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

// ----- process helpers -----
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
    try { child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ ok: false, out: "", err: String(e && e.message || e) }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGTERM"); } catch { /* gone */ } resolve({ ok: false, out, err: err || t("超时") }); } }, timeout);
    child.stdout.on("data", (b) => { out += b.toString(); if (out.length > 20000) out = out.slice(-20000); });
    child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 10000) err = err.slice(-10000); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, out, err: String(e && e.message || e) }); });
    child.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, out, err, code }); });
  });
}

function execCapture(bin, args, { cwd, env, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, out, errOut) => {
      resolve({ ok: !err, out: String(out || ""), err: String(errOut || (err && err.message) || "") });
    });
  });
}

// Saved AI output is working context, including edits and nested delegations.
export function freshTaskText(text) {
  return text.split("\n").map((l, i) => i === 0 ? J.stripBlockId(l) : l).join("\n");
}
