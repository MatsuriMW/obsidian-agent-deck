import { readConversation } from "./conversation.js";
import { createHash } from "crypto";
import { cardPathOf, skillRefIn } from "./skill-cards.js";
import { updateNote } from "./note-updates.js";
import { parseThread, replyPromptText, lastQuestionLine, appendQuestionText, makeQuestionId } from "./thread-replies.js";
import { inboxAdd } from "./reply-inbox.js";
// Agent Deck — delegate a note block to Claude Code or DeepSeek Harness.
//
// Claude Code: `claude --bg` (fallback: `claude -p --session-id`), then the
// session can be reopened in the desktop app through claude://resume.
// DeepSeek Harness: a small ACP (Agent Client Protocol) client over `dsh acp`,
// with model and reasoning-effort selection.

import fs from "fs";
import { saveBackgroundAnswer, clearBackgroundPending, backgroundRounds } from "./background-output.js";
import { destinations } from "./workflow.js";
import { folderExists, normalizeProjectFolder, projectFolderForName, rememberProjectFolder, resolveDispatchFolder, sameFolder, stripWinLongPrefix, suggestProjectForTask } from "./project-folders.js";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { AGENTS, DEFAULTS, CONFIRM_FIRST, clamp, truncate, journalPath } from "./constants.js";
import {
  TERMINAL_REGISTRY,
  TERMINAL_NAME,
  getTerminalOptions,
  pickTerminal,
  openTerminal,
  cliProcess,
  focusCliSession,
} from "./terminals.js";
import { RunTrace } from "./trace.js";
import * as J from "./journal.js";
import { mentionOptions, stripTaskMention, mentionTrigger } from "./task-mentions.js";
import { hasAgentCapability, getAgentCapability, canContinueInApp, canAgentReadLocalFiles } from "./agent-registry.js";
import { runHandoffDispatch } from "./teleagent-dispatch.js";
import { dispatchTeleagentLinux } from "./teleagent-dispatch-linux.js";
import { isPrivateFrontmatter, isPathExcluded } from "./memory-query-core.js";
import { resolvePluginScriptsDir } from "./context-core/config.js";
import {
  ancestorLines, withContext, freshTaskText, stripInternalIdentifiers,
  buildDelegationPayload, buildPromptFromContext, createDelegationRunner, HarnessPipeline,
  renderContextBundle,
} from "./harness.js";
import {
  findAgentBinary,
  resolveInstalledAgentBinary,
  findDshBinary,
  findAgyBinary,
  findOpenCodeBinary,
  findQoderBinary,
  findWorkbuddyBinary,
  findHermesCliBinary,
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
  fetchAgyCliModels,
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
  findHermesCliBinary,
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
const norm = (p) => stripWinLongPrefix(p).replace(/^~(?=[\\/])/, home());

export { CONFIRM_FIRST } from "./constants.js";

export const BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
export const LINK_RE = J.LINK_RE;
export const RESULT_RE = J.RESULT_RE;
export const STATUS_RE = new RegExp(`^(\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[[ xX/\\-]\\]\\s+)?(?:\\*\\*\\d{1,2}[:：]\\d{2}\\*\\*\\s*)?)(${J.TASK_KWS})(?=\\s|$)`, "i");
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

// 光标所在的不带列表标记的普通段落：整行当一项发出去（有列表标记的走 blockAt，带子块）。
export function paragraphBlock(lines, at) {
  if (at < 0 || at >= lines.length) return null;
  const text = lines[at];
  if (!text.trim() || BULLET_RE.test(text)) return null;
  return { start: at, end: at, indent: J.width(text), text };
}

// 发出去的一整段（预览和真正发出去的正文用同一个拼法）。
export function delegationText(lines, block, { newSession = false } = {}) {
  const task = newSession ? freshTaskText(block.text) : block.text;
  return withContext(block ? ancestorLines(lines, block.start) : [], task);
}

export function blockTitle(block, trigger = "@") {
  if (!block) return "";
  const first = J.stripBlockId(stripTaskMention(block.text, trigger).split("\n")[0] || "");
  return first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX/\-]\]\s+/, "").replace(/^\s*(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/, "")
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

const DELEGATED_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/\-]\]\s+)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/;

export function markDelegated(line) {
  const raw = line || "";
  const s = STATUS_RE.exec(raw);
  if (s) return `${s[1]}DELEGATED${raw.slice(s[1].length + s[2].length)}`;
  const m = DELEGATED_PREFIX_RE.exec(raw);
  return m ? `${m[1]}DELEGATED ${m[2]}` : `DELEGATED ${raw}`;
}

export function linkLine(indent, agent, name, sid) {
  return J.linkLine(indent, agent, String(name || "").slice(0, 48), sid);
}

export function openExternal(url) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") {
      Promise.resolve(shell.openExternal(url)).catch(() => {});
      return true;
    }
  } catch { /* not electron */ }
  try {
    if (process.platform === "win32") execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true }, () => {});
    else if (process.platform === "darwin") execFile("/usr/bin/open", [url], () => {});
    else execFile("xdg-open", [url], () => {});
    return true;
  } catch { return false; }
}

export function openExternalAsync(url) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") {
      return Promise.resolve(shell.openExternal(url)).then(() => true, () => false);
    }
  } catch { /* not electron */ }
  return new Promise((resolve) => {
    try {
      const done = (err) => resolve(!err);
      if (process.platform === "win32") execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true }, done);
      else if (process.platform === "darwin") execFile("/usr/bin/open", [url], done);
      else execFile("xdg-open", [url], done);
    } catch { resolve(false); }
  });
}

export {
  TERMINAL_REGISTRY,
  TERMINAL_NAME,
  getTerminalOptions,
  pickTerminal,
  openTerminal,
  cliProcess,
  focusCliSession,
};

// Codex 会话的 originator：桌面版 / IDE 插件里起的才有会话页可跳；codex_cli_rs、codex_exec 是命令行
export const isCodexDesktop = (app) => /desktop|vscode|app|ide|agent_deck/i.test(String(app || "")) && !/exec|cli/i.test(String(app || ""));
const CLI_SESSION_AGENTS = new Set(["claude", "qoder", "workbuddy", "hermes", "minimax", "gemini", "antigravity"]);
// 命令行会话（Claude Code 终端版、Codex 命令行、Qoder CLI 等）：点开回终端，而不是交给桌面版
export function isCliSession(agent, app) {
  if (CLI_SESSION_AGENTS.has(agent)) return app === "cli";
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
  if (agent === "cindy") return `cindy://session/${encodeURIComponent(sid)}`;
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
  qwenwork: { bundle: "cn.qwenwork.desktop.mac", url: "qwenwork-cn://" },
  minimax: { bundle: "com.minimax.agent.cn", fallbackBundles: ["com.minimax.agent"], url: "minimax-cn://open" },
  cursor: { bundle: "com.todesktop.230313mzl4w4u92", url: "cursor://" },
  trae: { bundle: "cn.trae.app", fallbackBundles: ["com.trae.app", "com.trae.ide"], url: "trae-cn://" },
  grokbot: { bundle: "com.anysphere.sand", url: "grokbot://" },
  t3code: { bundle: "com.t3tools.t3code", url: "t3code://" },
  cindy: { bundle: "com.xd.cindycn", fallbackBundles: ["com.xd.cindy"], url: "cindy://" },
  orca: { bundle: "com.stablyai.orca", url: "orca://" },
  muse: { bundle: "com.meta.endo", url: "hatch://" },
  kimicode: { bundle: "com.kimi.code.desktop", url: "kimi-code://" },
  doubaowork: { bundle: "com.work.pc.doubao", url: "doubaowork://" },
  // TeleAgent 的 macOS bundle id 没有核验到（本机只有 Windows 安装），留空直接走 URL scheme；
  // 桌面版注册的 scheme 是 teleai-cowork（Linux 上实测，见 docs/specs/teleagent-adapter.zh-CN.md）。
  teleagent: { bundle: "", url: "teleai-cowork://" },
};

export function openAgentApp(agent) {
  const app = AGENT_APPS[agent];
  if (!app) return Promise.resolve(false);
  if (process.platform !== "darwin") return Promise.resolve(openExternal(app.url));
  const bundles = [app.bundle, ...(app.fallbackBundles || [])].filter(Boolean);
  return new Promise((resolve) => {
    const tryNext = (idx) => {
      if (idx >= bundles.length) return resolve(openExternal(app.url));
      execFile("/usr/bin/open", ["-b", bundles[idx]], (err) => {
        if (!err) return resolve(true);
        tryNext(idx + 1);
      });
    };
    tryNext(0);
  });
}

export function copyText(text) {
  try { require("electron").clipboard.writeText(text); return true; } catch { /* not electron */ }
  try { navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function focusOrResume(plugin, agent, sid, resumeCmd, cwd) {
  focusCliSession(agent, sid).then((how) => {
    if (how === "tab") return;
    if (how === "app") return plugin.notice(t("已切到终端"));
    openTerminal(resumeCmd, cwd, plugin.settings.cliTerminal || "auto", AGENTS[agent]?.short || "Claude");
  }).catch(() => openTerminal(resumeCmd, cwd, plugin.settings.cliTerminal || "auto"));
  return true;
}

export function openSession(plugin, agent, sid, app = "", session = null) {
  if (!sid) { plugin.notice(t("这个会话还没有会话号，稍等一秒再点")); return false; }
  if (agent === "hermes") {
    const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
    return focusOrResume(plugin, agent, sid, `${cliQuote(findHermesCliBinary(plugin.settings?.delegate?.hermes?.path || ""))} --resume ${cliQuote(sid)}`, cwd);
  }
  if (agent === "gemini") {
    const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
    const bin = findAgentBinary("gemini", plugin.settings?.delegate?.gemini?.path || "");
    return focusOrResume(plugin, agent, sid, `${cliQuote(bin)} --resume ${cliQuote(sid)}`, cwd);
  }
  if (agent === "cindy") {
    copyText(sid);
    openExternalAsync(sessionDeepLink("cindy", sid)).then((ok) => {
      if (ok) return;
      return openAgentApp("cindy").then((opened) => plugin.notice(opened ? t("已打开 {agent}；会话号已复制，请在客户端选择会话", { agent: AGENTS[agent].name }) : t("没打开 {agent}：本机好像没装", { agent: AGENTS[agent].name })));
    });
    return true;
  }
  if (["opencode", "qoder", "minimax", "qwenwork", "cursor", "trae", "grokbot", "t3code", "muse", "kimicode", "doubaowork", "teleagent", "orca"].includes(agent)) {
    if (agent === "qoder" && app === "cli") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `${cliQuote(findQoderBinary(plugin.settings.delegate?.qoder?.path || ""))} -r ${cliQuote(sid)}`, cwd);
    }
    if (agent === "minimax" && app === "cli") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `${cliQuote(findAgentBinary("minimax", plugin.settings?.delegate?.minimax?.path || ""))} --session ${cliQuote(sid)}`, cwd);
    }
    copyText(sid);
    openAgentApp(agent).then((ok) => plugin.notice(ok ? t("已打开 {agent}；会话号已复制，请在客户端选择会话", { agent: AGENTS[agent].name }) : t("没打开 {agent}：本机好像没装", { agent: AGENTS[agent].name })));
    return true;
  }
  if (agent === "claude") {
    // 终端里起的会话：还开着就切到那个终端标签；关了才在新标签里 cd 到会话原来的目录 claude --resume。设置里可以改成走桌面版
    if (app === "cli" && plugin.settings.cliOpen !== "desktop") {
      const cwd = (session && session.cwd) || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return focusOrResume(plugin, agent, sid, `claude --resume ${cliQuote(sid)}`, cwd);
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") {
    const meta = session || (plugin.usage && plugin.usage.meta.get(sid)) || {};
    if ((app === "cli" || meta.app === "cli")) {
      return focusOrResume(plugin, agent, sid, `${cliQuote(findWorkbuddyBinary(plugin.settings?.delegate?.workbuddy?.path || ""))} -r ${cliQuote(sid)}`, meta.cwd || "");
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
    const meta = session || (plugin.usage && plugin.usage.meta.get(sid)) || {};
    if ((app === "cli" || session?.transport === "cli") && plugin.settings.cliOpen !== "desktop") {
      return focusOrResume(plugin, agent, sid, `agy --resume ${sid}`, meta.cwd || "");
    }
    openAgentApp("antigravity");
    copyText(sid);
    plugin.notice(t("已打开 Antigravity；会话号已复制"));
    return true;
  }
  return false;
}

const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'";
const cliQuote = (s) => (process.platform === "win32" ? `"${String(s ?? "").replace(/"/g, '\\"')}"` : shellQuote(s));
export const psSingleQuote = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";

export function buildWindowsPowerShellLauncher({ bin, preArgs = [], taskFile = "", postArgs = [] } = {}) {
  const cleanBin = stripWinLongPrefix(bin);
  const cleanFile = stripWinLongPrefix(taskFile);
  const invokeArgs = [
    ...preArgs.map((a) => psSingleQuote(stripWinLongPrefix(a))),
    ...(cleanFile ? ["$taskText"] : []),
    ...postArgs.map((a) => psSingleQuote(stripWinLongPrefix(a))),
  ].join(" ");
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    cleanFile
      ? `$taskText = [System.IO.File]::ReadAllText(${psSingleQuote(cleanFile)}, [System.Text.UTF8Encoding]::new($false))`
      : "$taskText = ''",
    `& ${psSingleQuote(cleanBin)}${invokeArgs ? " " + invokeArgs : ""}`,
  ].join("\r\n") + "\r\n";
}

// 任务块下面挂着的派发草稿链接（后出现的优先，方便"再生成一版"覆盖旧的；已消费的 📄 快照忽略）。
export function findDraftLink(lines = [], block = null) {
  if (!block) return "";
  const end = Number.isInteger(block.end) ? block.end : block.start;
  let found = "";
  for (let i = block.start; i <= end && i < lines.length; i++) {
    const line = lines[i] || "";
    if (/^\s*(?:[-*+]|\d+[.)])\s+📄/.test(line)) continue;
    const m = /\[\[([^\]|]*Agent Deck\/派发\/[^\]|]+?)(?:\|[^\]]*)?\]\]/.exec(line);
    if (m) found = m[1].replace(/\.md$/, "");
  }
  return found;
}

function draftFieldsOf(raw = "") {
  const fm = /^---\n([\s\S]*?)\n---/.exec(String(raw || ""));
  if (!fm) return { status: "", cwd: "", project: "" };
  const readVal = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm[1]);
    if (!m) return "";
    const v = m[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try { return JSON.parse(v); } catch { /* fall through */ }
    }
    return v.replace(/^['"]|['"]$/g, "");
  };
  return {
    status: readVal("status"),
    cwd: normalizeProjectFolder(readVal("cwd")),
    project: readVal("project"),
  };
}

function validateExplicitCwd(rawCwd) {
  const raw = String(rawCwd || "").trim();
  if (!raw) return "";
  const dir = normalizeProjectFolder(raw);
  if (!dir || !folderExists(dir)) throw new Error(t("工作目录不存在：{cwd}", { cwd: raw }));
  return dir;
}

export function detectRepoRuleFiles(cwd, vaultPath = "") {
  if (!cwd || (vaultPath && sameFolder(cwd, vaultPath))) return [];
  const found = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      if (fs.existsSync(path.join(cwd, name))) found.push(name);
    } catch { /* ignore */ }
  }
  return found;
}

function findProjectQuickstartEntry(vaultPath, projectName) {
  if (!vaultPath || !projectName) return "";
  const candidates = [
    `${projectName}.md`,
    path.posix.join("Projects", `${projectName}.md`),
    path.posix.join("Concepts", `${projectName}.md`),
  ];
  for (const rel of candidates) {
    try {
      if (fs.existsSync(path.join(vaultPath, ...rel.split("/")))) return rel;
    } catch { /* ignore */ }
  }
  return "";
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
    const effectiveEntryMap = typeof opts?.entryMapMode === "boolean"
      ? opts.entryMapMode
      : (opts?.agent ? canAgentReadLocalFiles(opts.agent, opts.destination || "") : false);
    const payload = await buildDelegationPayload({
      plugin: this.plugin,
      file,
      lines,
      block,
      opts: { ...opts, entryMapMode: effectiveEntryMap },
    });
    return { file, lines, block, title, name, ...payload };
  }

  // 草稿与派发共用：收集技能路径、引用笔记绝对路径、记忆查询提示与问答回灌；
  // 有 bundle 时写入对应槽位按「前稳后动」重渲，草稿（useRawPrompt）或独立调用则保留当前 prompt 正文并幂等补全。
  async enrichPrompt(resolved, skillRaw = "", { useRawPrompt = false } = {}) {
    const vault = this.plugin?.app?.vault;
    if (!vault || !resolved) return resolved;
    try {
      const scanLines = [
        ...(Array.isArray(resolved.contextLines) ? resolved.contextLines : []),
        ...String(resolved.block?.text || "").split("\n"),
      ];
      // 代码块与行内代码里出现的 [[...]] 只是文字，不是引用。
      const fenced = J.fencedLines(scanLines);
      const scan = scanLines.map((line, i) => (fenced.has(i) ? "" : line.replace(/`[^`]*`/g, ""))).join("\n");
      const notePaths = [];
      const privatePaths = resolved.bundle?.privatePaths instanceof Set ? resolved.bundle.privatePaths : new Set();
      const excludedDirs = this.settings?.delegate?.excludedDirs || [];
      for (const m of scan.matchAll(/\[\[([^\]|#]+)/g)) {
        const name = m[1].trim();
        const skillBase = name.replace(/^技能\//, "").replace(/\.md$/i, "");
        if (!name || name.startsWith("技能/") || vault.getAbstractFileByPath(`技能/${skillBase}.md`)) continue;
        const dest = this.plugin.app.metadataCache?.getFirstLinkpathDest?.(name, resolved.file?.path || "");
        // 任务块自己、以及它挂着的派发载荷/草稿、隐私排除目录与 private: true 笔记都不是素材。
        if (!dest || dest.extension !== "md" || dest.path === resolved.file?.path || dest.path.startsWith("Agent Deck/派发/")) continue;
        if (privatePaths.has(dest.path) || isPathExcluded(dest.path, excludedDirs)) continue;
        if (this.plugin?.readNote) {
          try {
            const raw = await this.plugin.readNote(dest.path);
            if (isPrivateFrontmatter(raw)) { privatePaths.add(dest.path); continue; }
          } catch { /* unreadable note handled by harness */ }
        }
        const abs = path.join(this.vaultPath, dest.path);
        if (!notePaths.includes(abs)) notePaths.push(abs);
      }
      const notesHead = t("任务里引用的笔记（可直接读全文）：");
      const notePathsBlock = notePaths.length ? `${notesHead}\n${notePaths.map((p) => `- ${p}`).join("\n")}` : "";
      const dispatchTarget = resolveDispatchFolder({
        settings: this.settings,
        explicitCwd: resolved.opts?.cwd || "",
        explicitVault: Boolean(resolved.opts?.explicitVault),
        explicitName: resolved.opts?.projectName || "",
        agentCwd: this.C[resolved.opts?.agent]?.cwd || "",
        vaultPath: this.vaultPath,
        notePath: resolved.file?.path || "",
        contextLines: resolved.contextLines || [],
        blockText: resolved.block?.text || "",
      });
      const hintProject = resolved.projectName || dispatchTarget.projectName || "";
      const repoRuleFiles = detectRepoRuleFiles(dispatchTarget.folder, this.vaultPath);
      const hasEntryMap = Boolean(resolved.bundle?.stats?.entryMapMode && resolved.bundle?.stats?.inlinedLinks > 0);
      const memoryHint = await this.memoryToolHint({ projectName: hintProject, repoRuleFiles, hasEntryMap });
      const replyText = replyPromptText(parseThread(resolved.lines, resolved.block));
      const plainSkill = [...scan.matchAll(/\[\[([^\]|#]+)/g)]
        .map((m) => m[1].trim().replace(/\.md$/i, ""))
        .find((name) => vault.getAbstractFileByPath(`技能/${name}.md`)) || "";
      const skillName = (skillRefIn(skillRaw) || skillRefIn(scan) || plainSkill).replace(/\.md$/i, "");
      const cardFile = skillName ? vault.getAbstractFileByPath(`技能/${skillName}.md`) : null;
      const skillPath = cardFile ? cardPathOf(await vault.read(cardFile)) : "";
      const skillLine = skillPath ? `${t("使用技能：")}${skillName}（${skillPath}）——先读这个文件，按其中流程执行。` : "";

      if (resolved.bundle && !useRawPrompt) {
        const b = resolved.bundle;
        if (memoryHint && !b.prefix.memoryHint) b.prefix.memoryHint = memoryHint;
        if (skillLine && !b.prefix.skillLine) b.prefix.skillLine = skillLine;
        if (notePathsBlock && !b.entries.notePaths) b.entries.notePaths = notePathsBlock;
        if (replyText && !b.tail.replyText) b.tail.replyText = replyText;
        if (b.stats) {
          b.stats.notePathCount = notePaths.length;
          b.stats.hasSkill = Boolean(b.prefix.skillLine);
          b.stats.hasReply = Boolean(b.tail.replyText);
          if (repoRuleFiles.length) b.stats.repoRuleFiles = repoRuleFiles;
        }
        resolved.prompt = renderContextBundle(b);
        return resolved;
      }

      // 草稿（useRawPrompt）或独立调用：保留当前 prompt 正文，稳定段放前面，每轮变的 replyText 放末尾（前稳后动），且各段幂等不重复。
      const pre = [memoryHint, skillLine, notePathsBlock]
        .filter((s) => s && !resolved.prompt.includes(s === notePathsBlock ? notesHead : s));
      if (pre.length) resolved.prompt = `${pre.join("\n\n")}\n\n${resolved.prompt}`;
      if (replyText && !resolved.prompt.includes(replyText)) resolved.prompt = `${resolved.prompt}\n\n${replyText}`;
      if (resolved.bundle?.stats) {
        resolved.bundle.stats.notePathCount = notePaths.length;
        resolved.bundle.stats.hasSkill = Boolean(skillLine || resolved.bundle.prefix.skillLine);
        resolved.bundle.stats.hasReply = Boolean(replyText || resolved.bundle.tail.replyText);
        if (repoRuleFiles.length) resolved.bundle.stats.repoRuleFiles = repoRuleFiles;
        resolved.bundle.stats.injectedChars = resolved.prompt.length;
      }
    } catch (e) { console.error("[agent-deck] 富化上下文失败（不影响派发）", e); }
    return resolved;
  }

  // 运行时记忆查询：脚本随插件装在库内；脚本和记忆目录都在，才值得告诉 Agent 这一行用法。
  // 当派发启用了入口地图模式（hasEntryMap）且脚本存在时，即使记忆数为空也保留全库 vault-* 入口用法。
  async memoryToolHint({ projectName = "", repoRuleFiles = [], hasEntryMap = false } = {}) {
    try {
      let script = this.plugin?.resolveMcpPaths?.()?.mqScript || "";
      if (!script) {
        const configDir = this.plugin?.app?.vault?.configDir || "";
        const fallbackDir = this.plugin?.manifest?._sourceDir ? path.join(this.plugin.manifest._sourceDir, "scripts") : "";
        script = path.join(resolvePluginScriptsDir(this.vaultPath, { configDir, fallbackDir }), "memory-query.mjs");
      }
      const relDir = String(this.settings?.dream?.dir || "Agent Deck/记忆").replace(/[\\/]+$/, "");
      const dir = path.join(this.vaultPath, ...relDir.split("/").filter(Boolean));
      // 用 fs 而不是 vault.adapter：adapter.exists 对 .obsidian 下的文件一律返回 false（2026-11-18 实测）。
      const hasMemoryDir = fs.existsSync(dir);
      if (!fs.existsSync(script) || (!hasMemoryDir && !hasEntryMap)) return "";
      const head = `${t("需要更多背景时：")}node "${script}" search "关键词"`;
      let count = 0;
      let topics = [];
      const indexPath = path.join(dir, "索引.md");
      if (hasMemoryDir && fs.existsSync(indexPath)) {
        try {
          const idxText = fs.readFileSync(indexPath, "utf8");
          const cm = /^共\s+(\d+)\s+条有效非私密记忆/m.exec(idxText);
          if (cm) count = Number(cm[1]) || 0;
          const tm = /^高频概念：(.+)$/m.exec(idxText);
          if (tm) {
            topics = [...tm[1].matchAll(/\[\[([^\]]+)\]\]/g)]
              .map((m) => String(m[1] || "").trim())
              .filter(Boolean)
              .slice(0, 6);
          }
        } catch { /* fallback below */ }
      }
      if (!count && hasMemoryDir && !fs.existsSync(indexPath)) {
        try {
          count = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "索引.md" && n !== "log.md").length;
        } catch { count = 0; }
      }
      if (count <= 0 && !repoRuleFiles.length && !hasEntryMap) return head;
      const parts = [];
      if (count > 0) {
        parts.push(t("库内共 {n} 条有效记忆", { n: count }));
        if (projectName) {
          parts.push(t("按项目筛选：search \"关键词\" --project {project}", { project: JSON.stringify(projectName) }));
          const entry = findProjectQuickstartEntry(this.vaultPath, projectName);
          if (entry) parts.push(t("项目入口：vault-outline {entry}", { entry: JSON.stringify(entry) }));
        }
        parts.push(t("图谱：graph \"概念\"｜目录：index｜单条：read <id/文件名>｜近期：recent 10"));
        parts.push(t("全库：vault-find \"关键词\"｜vault-outline <笔记>｜vault-read <笔记#章节>｜vault-related <笔记>"));
        if (topics.length) parts.push(t("常见主题：{topics}", { topics: topics.join(" / ") }));
      } else if (hasEntryMap) {
        parts.push(t("全库：vault-find \"关键词\"｜vault-outline <笔记>｜vault-read <笔记#章节>｜vault-related <笔记>"));
      }
      if (repoRuleFiles.length) {
        parts.push(t("仓内规范以 {files} 为准；跨仓经验与笔记上下文按需调用上述工具或 MCP 检索", { files: repoRuleFiles.join(" / ") }));
      }
      return parts.length ? `${head}\n（${parts.join("；")}）` : head;
    } catch { return ""; }
  }

  // 载荷快照：没有草稿时先把富化写进 payload 再落盘，让"文件为准"这句话站得住。
  async payloadSnapshot(resolved, draft, agent, meta = {}) {
    if (!draft) await this.enrichPrompt(resolved);
    return draft || await this.writeTaskPayload(resolved, agent, meta);
  }

  // 读草稿：只有 frontmatter 仍为 status: draft 才算待发草稿；消费后标成 dispatched 并更新笔记链接文案。
  async readDraft(draftPath, resolved, { consume = true } = {}) {
    try {
      const relPath = `${draftPath}.md`;
      const bare = draftPath.replace(/\.md$/, "");
      const file = this.plugin.app.vault.getAbstractFileByPath(relPath);
      if (!file) return null;
      const raw = await this.plugin.app.vault.read(file);
      const fields = draftFieldsOf(raw);
      if (fields.status !== "draft") return null;
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      if (!body) return null;
      if (!consume) {
        return {
          path: relPath,
          abs: this.vaultPath ? path.join(this.vaultPath, relPath) : relPath,
          draft: true,
          body,
          raw,
          hash: "",
          ...(fields.cwd ? { cwd: fields.cwd } : {}),
          ...(fields.project ? { project: fields.project } : {}),
        };
      }
      const next = raw
        .replace(/^status: .*$/m, "status: dispatched")
        .replace(/^(created: .+)$/m, `$1\ndispatched: ${new Date().toISOString()}`);
      if (next !== raw) await this.plugin.app.vault.modify(file, next);
      const hash = createHash("sha256").update(next).digest("hex").slice(0, 16);
      if (resolved?.file?.path) {
        await updateNote(this.plugin, resolved.file.path, (text) => {
          const lines = text.split("\n");
          let changed = false;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(`[[${relPath}`) && !line.includes(`[[${bare}|`) && !line.includes(`[[${bare}]]`)) continue;
            const indent = (/^[ \t]*/.exec(line) || [""])[0];
            const updated = `${indent}- 📄 [[${relPath}|${t("已派发载荷")}]]`;
            if (updated !== line) { lines[i] = updated; changed = true; }
          }
          return changed ? lines.join("\n") : text;
        });
      }
      return {
        path: relPath,
        abs: this.vaultPath ? path.join(this.vaultPath, relPath) : relPath,
        draft: true,
        body,
        raw,
        hash,
        ...(fields.cwd ? { cwd: fields.cwd } : {}),
        ...(fields.project ? { project: fields.project } : {}),
      };
    } catch (e) { console.error("[agent-deck] 读取派发草稿失败", e); return null; }
  }

  // 载荷文件名：日期 + 时间 + 可读 slug，保证同一天多次派发不覆盖。
  // 有块号就按块号命名：一个任务块永远只有一份载荷，后续派发覆盖它，文件数 ≈ 任务数。
  payloadName({ date, time, name, anchor = "" }) {
    const slug = J.normalizeTaskSlug(name) || String(name || "").replace(/[\\/:*?"<>|#^[\]\s]/g, "").slice(0, 24) || "task";
    return anchor ? `${date}-${anchor}-${slug}.md` : `${date}-${time}-${slug}.md`;
  }

  async writeTaskPayload(resolved, agent, { draft = false, model = "", effort = "", cwd = "", project = "" } = {}) {
    if (!this.plugin?.app?.vault) return null;
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const dir = "Agent Deck/派发";
      const anchor = resolved.block ? J.blockIdOf(resolved.lines[resolved.block.start]) : "";
      const relPath = `${dir}/${this.payloadName({ date, time, name: resolved.name, anchor })}`;
      const bare = relPath.replace(/\.md$/, "");
      const head = [
        "---",
        "type: 派发载荷",
        `status: ${draft ? "draft" : "dispatched"}`,
        `agent: ${agent}`,
        model ? `model: ${JSON.stringify(String(model))}` : "",
        effort ? `effort: ${JSON.stringify(String(effort))}` : "",
        project ? `project: ${JSON.stringify(String(project))}` : "",
        cwd && !sameFolder(cwd, this.vaultPath) ? `cwd: ${JSON.stringify(String(cwd))}` : "",
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
      const existing = vault.getAbstractFileByPath(relPath);
      if (existing) await vault.modify(existing, head);
      else await vault.create(relPath, head);
      await updateNote(this.plugin, resolved.file.path, (text) => {
        const lines = text.split("\n");
        const at = anchor ? lines.findIndex((l) => J.blockIdOf(l) === anchor) : resolved.block.start;
        if (at < 0) return text;
        const linkIdx = lines.findIndex((l) => l.includes(`[[${relPath}`) || l.includes(`[[${bare}|`) || l.includes(`[[${bare}]]`));
        if (linkIdx >= 0) {
          const indent = (/^[ \t]*/.exec(lines[linkIdx]) || [""])[0];
          const nextLine = draft ? `${indent}- 📝 [[${relPath}|${t("派发草稿")}]]` : `${indent}- 📄 [[${relPath}|${t("本次载荷")}]]`;
          if (lines[linkIdx] === nextLine) return text;
          lines[linkIdx] = nextLine;
          return lines.join("\n");
        }
        const indent = (/^[ \t]*/.exec(lines[at]) || [""])[0] + "\t";
        lines.splice(at + 1, 0, draft ? `${indent}- 📝 [[${relPath}|${t("派发草稿")}]]` : `${indent}- 📄 [[${relPath}|${t("本次载荷")}]]`);
        return lines.join("\n");
      });
      return { path: relPath, abs: this.vaultPath ? path.join(this.vaultPath, relPath) : relPath, hash: createHash("sha256").update(head).digest("hex").slice(0, 16) };
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
  openTerminal(...args) { return openTerminal(...args); }

  get C() { return this.settings.delegate || DEFAULTS.delegate; }

  defaultModel(agent) {
    const a = this.C[agent] || {};
    if (a.model !== undefined) return a.model;
    const mod = this.settings?.models?.defaultByAgent?.[agent];
    if (mod !== undefined) return mod;
    return DEFAULTS.models.defaultByAgent[agent] ?? "";
  }

  async delegate(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (opts.destination && !destinations(opts.agent).some(o => o.id === opts.destination)) throw new Error(t("此 Agent 不支持所选工作位置"));
    if (opts.destination === "terminal" || (opts.agent === "codex" && !opts.destination && this.C.codex?.transport === "terminal")) return this.handoffCli(opts);
    const wantsDesktopHandoff = opts.destination === "desktop" && (opts.agent === "qoder" || hasAgentCapability(opts.agent, "handoffFallback"));
    if (!hasAgentCapability(opts.agent, "delegate") || wantsDesktopHandoff) return this._performHandoff(opts);
    if (hasAgentCapability(opts.agent, "handoffFallback") && !resolveInstalledAgentBinary(opts.agent, this.C[opts.agent]?.path || "")) {
      return this._performHandoff(opts);
    }
    const agent = opts.agent;
    const validExplicitCwd = validateExplicitCwd(opts.cwd);
    const trace = new RunTrace({ agent, traceDir: opts.traceDir });
    const ctxSpan = trace.startSpan("context.resolve");
    const resolved = await this.resolveBlockContext(opts, t("光标要放在一个列表项里"));
    trace.endSpan(ctxSpan, "ok", { linkCount: resolved.bundle?.stats?.linkCount || 0 });
    const target = resolveDispatchFolder({
      settings: this.settings,
      explicitCwd: validExplicitCwd,
      explicitVault: Boolean(opts.explicitVault),
      explicitName: opts.projectName || "",
      agentCwd: this.C[agent]?.cwd || "",
      vaultPath: this.vaultPath,
      notePath: resolved.file?.path || "",
      contextLines: ancestorLines(resolved.lines, resolved.block.start),
      blockText: resolved.block.text,
    });
    let { folder: cwd, projectName, auto: autoProject } = target;
    if (target.explicit && projectName && folderExists(target.explicit)
      && !sameFolder(target.explicit, this.vaultPath)
      && rememberProjectFolder(this.settings, projectName, target.explicit)) this.plugin.saveSettings?.();
    // A dispatch outside today's journal is recorded in the note itself; autoLog
    // skips it unless the user opts back in (settings.noteDispatchJournal).
    const journalToday = (() => { try { return journalPath(this.plugin.app, this.settings); } catch { return ""; } })();
    const noteDispatch = !!resolved.file?.path && resolved.file.path !== journalToday;
    let suggest = null;
    if (!opts.fromDialog && !opts.explicitVault) {
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
    const conflict = !opts.fromDialog && !opts.explicitVault && autoProject && suggest && !sameFolder(suggest.path, cwd);
    if (conflict) {
      cwd = this.vaultPath;
      projectName = "";
      autoProject = null;
    }
    // 优先用挂在任务块下面的草稿：用户改过的内容就是这一趟真正要发的内容。
    const draftPath = findDraftLink(resolved.lines, resolved.block);
    const draft = draftPath ? await this.readDraft(draftPath, resolved) : null;
    if (draft?.cwd && !validExplicitCwd && !opts.explicitVault && folderExists(draft.cwd)) {
      cwd = draft.cwd;
      projectName = draft.project || projectName || path.basename(draft.cwd);
    }
    resolved.projectName = projectName;
    resolved.cwd = cwd;
    if (draft) {
      // 草稿正文可能被手改（比如加了 [[技能/x]]），基于草稿正文幂等富化且不让 bundle 覆盖草稿。
      resolved.prompt = draft.body;
      await this.enrichPrompt(resolved, draft.raw || "", { useRawPrompt: true });
    }
    // 载荷快照：先富化再落盘。payload 里缺了引用笔记 / 技能路径 / 记忆查询用法，
    // 而 prompt 写着"两者冲突时以文件为准"，那句话就名不副实。
    const snapSpan = trace.startSpan("payload.snapshot");
    const payload = await this.payloadSnapshot(resolved, draft, agent, { cwd, project: projectName });
    trace.endSpan(snapSpan, "ok", { hasPayload: Boolean(payload) });
    if (payload) {
      const source = resolved.prompt;
      const lead = payload.draft
        ? `${t("本次任务按这份已确认的草稿执行：")}\`${payload.abs}\``
        : `${t("本次任务的完整载荷（含上下文与来源）：")}\`${payload.abs}\``;
      resolved.prompt = `${lead}\n${t("下面是被截断的摘要；两者冲突时以文件为准。")}\n\n${source}`;
      if (resolved.bundle?.stats) resolved.bundle.stats.injectedChars = resolved.prompt.length;
    }
    const requestedModel = opts.model !== undefined ? opts.model : this.defaultModel(agent);
    const job = this.buildJobBase({
      agent,
      name: resolved.name,
      opts: { ...opts, file: resolved.file },
      lines: resolved.lines,
      block: resolved.block,
      question: resolved.question,
      prompt: resolved.prompt,
      model: agent === "codex" ? resolveCliModel(this.plugin, agent, requestedModel) : requestedModel,
      effort: opts.effort || this.C[agent]?.effort,
      permission: opts.permission || (hasAgentCapability(agent, "permissionControl") ? (this.C[agent]?.permission || "auto") : ""),
      cwd,
      project: projectName,
      noteDispatch,
    });
    // 记下载荷路径与派发时的 hash：之后若文件被改，说明人动过手，可以单独取用。
    if (payload) { job.payloadPath = payload.path; job.payloadHash = payload.hash; }
    if (resolved.bundle?.stats) job.contextStats = { ...resolved.bundle.stats };
    job.traceId = trace.traceId;
    trace.jobId = job.id;
    trace.project = projectName;
    trace.contextStats = job.contextStats || null;
    const hookPayload = { opts, resolved, job, prompt: resolved.prompt, name: resolved.name };
    await this.harness.run("beforeDelegate", hookPayload);
    if (requestedModel && requestedModel !== `${agent}-default` && this.settings?.models) {
      const counts = (this.settings.models.callCounts ||= {});
      counts[requestedModel] = (counts[requestedModel] || 0) + 1;
    }
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
    runner.trace = trace;
    this.runners.set(job.id, runner);
    // Runners resolve their own cwd from opts.cwd / per-agent settings; only
    // hand them the resolved folder when it is a project one. Leaving the vault
    // case untouched keeps Claude's trusted-directory fallback working.
    const startOpts = { ...opts, prompt: hookPayload.prompt, name: hookPayload.name };
    if ((cwd && !sameFolder(cwd, this.vaultPath)) || (opts.explicitVault && this.C[agent]?.cwd && this.vaultPath)) {
      startOpts.cwd = cwd;
    }
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
    if (agent === "antigravity") {
      const cfg = (this.settings.delegate ||= {}).antigravity ||= {};
      const models = await fetchAgyCliModels({ binPath: cfg.path || "", cwd: this.vaultPath });
      cfg.availableModels = models;
      this.saveJobs();
      return models;
    }
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
    const cap = getAgentCapability(session.agent);
    const transport = session.transport || existing?.transport || "";
    const canResumeTransport = Array.isArray(cap.continueTransports)
      ? cap.continueTransports.includes(transport)
      : (!cap.continueRequiresAcp || transport === "acp");
    if (!canResumeTransport) {
      throw new Error(t("这是 {agent} 桌面会话，请在客户端继续", { agent: AGENTS[session.agent]?.name || session.agent }));
    }
    let job = existing;
    if (!job) {
      job = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, agent: session.agent,
        name: session.title || session.name || t("{agent} 会话", { agent: AGENTS[session.agent].name }), sessionId: sid, cwd: session.cwd || "",
        ...(session.path ? { path: session.path } : {}),
        ...(session.blockId ? { blockId: session.blockId } : {}),
        ...(session.destination ? { destination: session.destination } : {}),
        ...(session.transport ? { transport: session.transport } : {}),
        linkWritten: true, model: "", effort: "", permission: "", conversation: [] };
      this.jobs[job.id] = job;
    } else {
      if (!job.path && session.path) job.path = session.path;
      if (!job.blockId && session.blockId) job.blockId = session.blockId;
      if (!job.destination && session.destination) job.destination = session.destination;
      if (!job.transport && session.transport) job.transport = session.transport;
    }
    const prevRawCwd = String(job.cwd || "").trim();
    const normJobCwd = normalizeProjectFolder(prevRawCwd);
    if (!normJobCwd || !folderExists(normJobCwd)) {
      const knownProj = job.project || session.project || session.proj || "";
      const byKnownProj = knownProj ? projectFolderForName(this.settings, knownProj) : "";
      let ctxLines = [];
      let blockText = job.blockText || "";
      if (!byKnownProj && job.path && this.plugin?.readNote) {
        try {
          const noteText = await this.plugin.readNote(job.path);
          const noteLines = noteText.split("\n");
          const at = job.blockId ? noteLines.findIndex((l) => J.blockIdOf(l) === job.blockId) : -1;
          if (at >= 0) {
            ctxLines = ancestorLines(noteLines, at);
            blockText = blockText || (blockAt(noteLines, at)?.text || noteLines[at]);
          } else if (noteLines.length) {
            ctxLines = noteLines.slice(0, 40);
          }
        } catch { /* note unreadable */ }
      }
      const fallback = (byKnownProj && folderExists(byKnownProj))
        ? { folder: byKnownProj, projectName: knownProj }
        : resolveDispatchFolder({
            settings: this.settings,
            vaultPath: this.vaultPath,
            notePath: job.path || "",
            contextLines: ctxLines,
            blockText,
            agentCwd: this.C[session.agent]?.cwd || "",
          });
      const resolvedCwd = (fallback.folder && folderExists(fallback.folder)) ? fallback.folder : this.vaultPath;
      if (prevRawCwd && this.vaultPath && !sameFolder(prevRawCwd, this.vaultPath)) {
        this.plugin.notice?.(t("原工作目录不存在（{old}），已改用：{next}", { old: prevRawCwd, next: resolvedCwd }), 7000);
      }
      job.cwd = resolvedCwd;
      if (!job.project && fallback.projectName) job.project = fallback.projectName;
    } else {
      job.cwd = normJobCwd;
    }
    if (!job.conversation?.length && !job.roundOffset) {
      let offset = this.plugin?.usage?.meta?.get(sid)?.rounds?.length || 0;
      if (job.path && this.plugin?.readNote) {
        try {
          const note = await this.plugin.readNote(job.path);
          while (J.hasRecordedTurn(note, sid, offset + 1)) offset++;
        } catch { /* note unreadable */ }
      }
      if (offset) job.roundOffset = offset;
    }
    Object.assign(job, { state: "starting", startedAt: Date.now(), endedAt: 0, error: "", result: "", lastText: "", step: "", resultWritten: false, awaitingReply: false });
    this.saveJobs(); this.refreshUI();
    const runner = createDelegationRunner(session.agent, this, job, getRunnerClasses());
    this.runners.set(job.id, runner);
    await runner.start({ sessionId: sid, prompt, cwd: job.cwd, ...(job.model ? { model: job.model } : {}), ...(job.effort ? { effort: job.effort } : {}) });
    return job;
  }

  // treeland 窗口激活 helper 随插件安装到 <plugin>/bin；运行时探测，缺失时回退到 PATH/环境变量。
  // 只做存在性检查，不启动、不修改用户系统路径。
  nativeActivationHelper() {
    try {
      const base = this.plugin?.app?.vault?.adapter?.basePath;
      const dir = this.plugin?.manifest?.dir || this.plugin?.manifestDir;
      if (!base || !dir) return "";
      const candidate = path.join(base, dir, "bin", "treeland-activate");
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      return "";
    }
  }

  // 尚未接入自动委派的客户端（或 Qoder 桌面模式）：复制任务并唤起应用，由用户发送。
  // 之后每轮扫描找这个 Agent 新出现、开头对得上的会话，找到就绑回这一行（🔗 + DELEGATED），面板里的卡片飞进「现在」。
  async handoff(opts) {
    this.refreshSettings();
    opts = mentionOptions(this.plugin, opts);
    if (opts.destination === "terminal") return this.handoffCli(opts);
    const wantsDesktopHandoff = opts.destination === "desktop" && (opts.agent === "qoder" || hasAgentCapability(opts.agent, "handoffFallback"));
    if (hasAgentCapability(opts.agent, "delegate") && !wantsDesktopHandoff) return this.delegate(opts);
    return this._performHandoff(opts);
  }

  async _performHandoff(opts) {
    const agent = opts.agent;
    const validExplicitCwd = validateExplicitCwd(opts.cwd);
    const resolved = await this.resolveBlockContext(
      { ...opts, entryMapMode: typeof opts?.entryMapMode === "boolean" ? opts.entryMapMode : false },
      t("要拖一个列表项"),
    );
    const target = resolveDispatchFolder({
      settings: this.settings,
      explicitCwd: validExplicitCwd,
      explicitVault: Boolean(opts.explicitVault),
      explicitName: opts.projectName || "",
      agentCwd: this.C[agent]?.cwd || "",
      vaultPath: this.vaultPath,
      notePath: resolved.file?.path || "",
      contextLines: ancestorLines(resolved.lines, resolved.block.start),
      blockText: resolved.block.text,
    });
    const projectName = opts.projectName || target.projectName || "";
    const cwd = target.folder || this.vaultPath;
    if (target.explicit && projectName && folderExists(target.explicit)
      && !sameFolder(target.explicit, this.vaultPath)
      && rememberProjectFolder(this.settings, projectName, target.explicit)) this.plugin.saveSettings?.();
    resolved.projectName = projectName;
    resolved.cwd = cwd;
    await this.enrichPrompt(resolved);
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
      cwd,
      project: projectName,
    });
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.copyText(resolved.prompt);
    await this.openAgentApp(agent);
    this.plugin.notice(t("📋 任务已复制，粘贴到 {agent} 里发出", { agent: AGENTS[agent]?.name || agent }), 10000);
    // 人的在场的一键派发：只在 Windows + TeleAgent + 用户明确点了“自动发送”时走。
    // 失败不静默——剪贴板里仍然有全文，但要明确告诉用户哪一步没成，别让人以为发出去了。
    const dispatched = await runHandoffDispatch({
      agent,
      autoSend: opts.autoSend,
      projectName,
      text: resolved.prompt,
      dispatchLinux: (payload) => dispatchTeleagentLinux(payload, { activationHelper: this.nativeActivationHelper() }),
    });
    if (dispatched.skipped === "no-project") this.plugin.notice(t("没有识别到项目名，已退回复制交接"), 8000);
    else if (dispatched.skipped === "platform") this.plugin.notice(t("派发只在 Windows/Linux 可用"), 8000);
    else if (dispatched.ok && dispatched.manualSubmit) {
      // Linux 端到端实测前只做到“填入 + 让用户手动提交”，提示里必须说清楚没有自动发送。
      this.plugin.notice(t("已填入任务文本，请在 TeleAgent 里手动点「运行」· {project}", { project: dispatched.project }), 12000);
      if (dispatched.textVerified === false) this.plugin.notice(t("未能自动确认输入框内容（没有截图工具），请目视确认后再点「运行」"), 10000);
    }
    else if (dispatched.ok && dispatched.verified) this.plugin.notice(t("已派发并确认落库 · {project}", { project: dispatched.project }), 6000);
    else if (dispatched.ok) this.plugin.notice(t("已发送，但本地库里还没查到 · {project}", { project: dispatched.project }), 9000);
    else if (!dispatched.skipped) this.plugin.notice(t("派发失败（{stage}）：{error}", { stage: dispatched.stage, error: String(dispatched.error || "").slice(0, 120) }), 12000);
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
    const validExplicitCwd = validateExplicitCwd(opts.cwd);
    const resolved = await this.resolveBlockContext(opts, t("要拖一个列表项"));
    const target = resolveDispatchFolder({
      settings: this.settings,
      explicitCwd: validExplicitCwd,
      explicitVault: Boolean(opts.explicitVault),
      explicitName: opts.projectName || "",
      agentCwd: this.C[agent]?.cwd || "",
      vaultPath: this.vaultPath,
      notePath: resolved.file?.path || "",
      contextLines: ancestorLines(resolved.lines, resolved.block.start),
      blockText: resolved.block.text,
    });
    let cwd = target.folder || this.vaultPath;
    const projectName = opts.projectName || target.projectName || "";
    if (target.explicit && projectName && folderExists(target.explicit)
      && !sameFolder(target.explicit, this.vaultPath)
      && rememberProjectFolder(this.settings, projectName, target.explicit)) this.plugin.saveSettings?.();
    resolved.projectName = projectName;
    resolved.cwd = cwd;
    await this.enrichPrompt(resolved);
    const { lines, block, name, question, prompt } = resolved;
    // 交互式 claude 在没信任过的目录里会先停在信任提示上，任务就不会自己跑：和后台委派一样换到信任过的目录，库用 --add-dir 加进去
    const extraArgs = [];
    if (agent === "claude") {
      const cfg = this.C.claude || {};
      if (cfg.autoTrustedCwd !== false && !validExplicitCwd && !target.auto && !opts.explicitVault && !cfg.cwd) {
        const trusted = await findTrustedDir(this.vaultPath);
        if (trusted) cwd = trusted;
      }
      if (this.vaultPath && !sameFolder(cwd, this.vaultPath)) extraArgs.push("--add-dir", this.vaultPath);
      if (cfg.permission) extraArgs.push("--permission-mode", cfg.permission);
    } else if (agent === "codex") {
      if (!validExplicitCwd && !target.auto && !opts.explicitVault && !this.C.codex?.cwd) {
        // 交互式 codex 在没信任过的目录里也会停在信任提示上：同样换到信任过的目录，库用 --add-dir 加进去
        cwd = await findCodexTrustedDir(this.vaultPath);
      }
      if (this.vaultPath && !sameFolder(cwd, this.vaultPath)) extraArgs.push("-C", cwd, "--add-dir", this.vaultPath);
    }
    const model = resolveCliModel(this.plugin, agent, opts.model !== undefined ? opts.model : this.defaultModel(agent));
    const effort = opts.effort || this.C[agent]?.effort || "high";
    if (agent === "codex") extraArgs.push(...codexCliArgs(this.plugin, opts));
    else if (agent === "claude") {
      if (model) extraArgs.push("--model", model);
      if (effort) extraArgs.push("--effort", effort);
    }
    // 任务文字放进临时文件，POSIX 用 "$(cat …)" 取、Windows 用 PowerShell 读 UTF-8 文件：多行、引号都不用转义
    const dir = path.join(os.tmpdir(), "agent-deck");
    await fsp.mkdir(dir, { recursive: true });
    const stamp = Date.now().toString(36);
    const taskFile = path.join(dir, `task-${stamp}.txt`);
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
      project: projectName,
    });
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    let launchBin = bin;
    let preArgs = [];
    let postArgs = [];
    if (agent === "opencode") {
      preArgs = [...(this.C.opencode?.autoApprove ? ["--auto"] : []), "--prompt"];
      postArgs = [cwd];
    } else if (agent === "qoder") {
      const perm = qoderPermissionArgs(opts.permission || this.C.qoder?.permission || "auto");
      const addDir = this.vaultPath && !sameFolder(cwd, this.vaultPath) ? ["--add-dir", this.vaultPath] : [];
      preArgs = ["-w", cwd, ...addDir, ...perm, "-m", model, "--reasoning-effort", effort, "-n", name, "--"];
    } else if (agent === "hermes") {
      launchBin = findHermesCliBinary(this.C.hermes?.path || "");
      const m = model && model !== "hermes-default" ? resolveCliModel(this.plugin, "hermes", model) : "";
      preArgs = ["chat", ...(m ? ["-m", m] : []), ...(effort ? ["--reasoning", effort] : []), ...(this.C.hermes?.autoApprove ? ["--yolo"] : []), "-q"];
    } else if (agent === "gemini") {
      const m = model && model !== "gemini-default" ? model : "";
      preArgs = [...(m ? ["-m", m] : []), ...(this.C.gemini?.autoApprove ? ["-y"] : []), "-i"];
    } else if (agent === "antigravity") {
      const addDir = this.vaultPath && !sameFolder(cwd, this.vaultPath) ? ["--add-dir", this.vaultPath] : [];
      const m = model && model !== "antigravity-default" ? model : "";
      const eff = this.C.antigravity?.effort || "";
      preArgs = [...addDir, ...(m ? ["--model", m] : []), ...(eff ? ["--effort", eff] : []), ...(this.C.antigravity?.autoApprove ? ["--dangerously-skip-permissions"] : []), ...extraArgs, "-i"];
    } else if (agent === "workbuddy") {
      const addDir = this.vaultPath && !sameFolder(cwd, this.vaultPath) ? ["--add-dir", this.vaultPath] : [];
      preArgs = [...addDir, "--"];
    } else {
      // 任务前面加 --：任务常以「- TODO」开头，不加会被当成命令行参数（unknown option）
      preArgs = [...extraArgs, "--"];
    }
    let cmd;
    if (process.platform === "win32") {
      const ps1File = path.join(dir, `run-${stamp}.ps1`);
      await fsp.writeFile(ps1File, buildWindowsPowerShellLauncher({ bin: launchBin, preArgs, taskFile, postArgs }), "utf8");
      cmd = `powershell.exe -NoExit -ExecutionPolicy Bypass -File "${ps1File}"`;
    } else {
      const quoteArg = (a) => (/^--?[A-Za-z0-9_-]*$/.test(a) ? a : shellQuote(a));
      const parts = [shellQuote(launchBin), ...preArgs.map(quoteArg), `"$(cat ${shellQuote(taskFile)})"`, ...postArgs.map(quoteArg)];
      cmd = parts.join(" ");
    }
    const term = await this.openTerminal(cmd, cwd, this.plugin.settings.cliTerminal || "auto", truncate(name, 24), { background: true });
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
        this.plugin.notice?.(job.error);
        this.saveJobs();
        continue;
      }
      const head = norm(job.name).slice(0, 10);
      const promptHead = norm(job.prompt).slice(0, 24);
      let best = null;
      for (const m of usage.meta.values()) {
        if (m.agent !== job.agent || taken.has(m.sid) || (m.lastAt || 0) < job.startedAt - 5000) continue;
        if (usage.isSubagentSession?.(m.sid)) continue;
        if (usage.delegatedOwnerOf?.(m.sid, m.agent) || (m.agent !== "t3code" && usage.t3OwnerOf?.(m.sid))) continue;
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
      if (job.agent === "antigravity" && (job.transport === "cli" || job.transport === "acp")) link = link.replace("antigravity://open", J.deckSessionUrl("antigravity", sid));
      if (job.agent === "workbuddy" && job.app === "cli") link = link.replace(/workbuddy:\/\/chat\/[^)]+/, J.deckSessionUrl("workbuddy", sid));
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
    // 结果已经记过也要看这一轮有没有提问：💬 写过不代表 ❓ 写过（那正是"去 CLI 才能回话"的根源）。
    if (!pending.length) {
      job.resultWritten = true;
      this.saveJobs();
      await this.captureQuestion(job, rounds.at(-1)?.said || job.result || "");
      return;
    }
    const messages = job.conversation?.length ? job.conversation : await readConversation(this.plugin, job);
    const offset = Number(job.roundOffset) || 0;
    const full = backgroundRounds(messages).map((r) => (offset ? { ...r, n: r.n + offset } : r));
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
    // 最后一段如果是问句，就是它在等你回答：写进笔记成 ❓。
    await this.captureQuestion(job, prepared.at(-1)?.said || "");
  }

  async writeResult(job, { rounds: scannedRounds } = {}) {
    if ((job.resultWritten && !scannedRounds) || this.settings.journalAutoWrite === false || this.plugin._unloaded || !job.path) return;
    const meta = this.plugin.usage?.meta.get(job.sessionId);
    const raw = job.result || meta?.rounds?.at(-1)?.said || meta?.lastText || job.lastText || "";
    if (!raw && !scannedRounds?.length) return;
    const offset = Number(job.roundOffset) || 0;
    const convRounds = job.conversation?.length
      ? backgroundRounds(job.conversation).map((r) => (offset ? { ...r, n: r.n + offset } : r))
      : [];
    if (job.destination === "background") {
      const rounds = scannedRounds || (
        convRounds.at(-1)?.said && convRounds.length >= (meta?.rounds?.length || 0)
          ? convRounds
          : job.result
            ? [{ n: Math.max(convRounds.length + offset, meta?.rounds?.at(-1)?.n || 1), said: job.result, ask: convRounds.at(-1)?.ask || meta?.rounds?.at(-1)?.ask }]
            : meta?.rounds?.length ? meta.rounds : [{ n: 1 + offset, said: raw }]
      );
      return this.writeBackgroundResult(job, rounds);
    }
    const rounds = scannedRounds || (convRounds.length > (meta?.rounds?.length || 0) ? convRounds : meta?.rounds?.length ? meta.rounds : [{ n: 1 + offset, at: job.startedAt, ask: "", said: raw }]);
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
    await this.captureQuestion(job, raw);
  }

  // 把 Agent 的提问落成笔记里的 `❓ 第N轮：…`（幂等：同一句不重复写）。
  async captureQuestion(job, text) {
    const question = lastQuestionLine(text);
    if (!question || !job?.path) return false;
    let wrote = false;
    try {
      await updateNote(this.plugin, job.path, (note) => {
        const lines = note.split("\n");
        const blockId = job.blockId || "";
        const start = blockId ? lines.findIndex((l) => J.blockIdOf(l) === blockId) : (Number.isInteger(job.line) ? job.line : -1);
        if (start < 0 || start >= lines.length) return note;
        if (!blockAt(lines, start)) return note;
        const next = appendQuestionText(note, { blockId, atLine: start, question, seed: `${job.path}|${blockId}|${question}` });
        if (next !== note) { wrote = true; return next; }
        return note;
      });
    } catch (e) {
      console.error("[agent-deck] 写回提问失败", e);
    }
    if (wrote) {
      job.awaitingReply = true;
      job.awaitingReplyRounds = Math.max(
        1,
        this.plugin.usage?.meta?.get?.(job.sessionId)?.rounds?.length
          || (job.conversation || []).filter((m) => m?.role === "assistant" && m.text).length
          || 1,
      );
      this.saveJobs();
      // 登记进回复信箱：用户不用回原文找那一行。
      const blockId = job.blockId || "";
      const questionId = makeQuestionId(`${job.path}|${blockId}|${question}`);
      const inbox = this.plugin.settings.replyInbox || [];
      this.plugin.settings.replyInbox = inboxAdd(inbox, {
        path: job.path, blockId, questionId, question,
        agent: job.agent || "", sid: job.sessionId || "", title: job.name || "",
        ...(job.transport ? { transport: job.transport } : {}),
      });
      await this.plugin.saveSettings();
      this.plugin.openReplyInbox?.({ focus: false }).catch?.(() => {});
      this.plugin.refreshReplyInbox?.();
      this.plugin.notice(t("Agent 在等你回答：{text}（侧栏「回复信箱」里回也行）", { text: truncate(question, 46) }), 9000);
    }
    return wrote;
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
