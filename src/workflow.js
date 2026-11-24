// User-facing destinations and lifecycle, independent of transport protocols.
import { AGENTS } from "./constants.js";
import { canDelegateDrop, getAgentCapability, hasAgentCapability } from "./agent-registry.js";
import { t } from "./i18n.js";

export const activeJob = (job) => ["starting", "running", "needs-approval"].includes(job?.state);

const DESTINATION_IDS = {
  claude: ["desktop", "background", "terminal"],
  codex: ["desktop", "background", "terminal"],
  dsh: ["desktop", "background"],
  antigravity: ["background"],
  opencode: ["desktop", "background", "terminal"],
  qoder: ["desktop", "background", "terminal"],
  hermes: ["background", "terminal"],
  minimax: ["desktop", "background", "terminal"],
  cursor: ["background", "desktop"],
  gemini: ["background", "terminal"],
  t3code: ["desktop", "background"],
  workbuddy: ["desktop", "terminal"],
  teleagent: ["desktop"],
};

const BACKGROUND_DEFAULT_AGENTS = new Set(["antigravity", "qoder", "hermes", "minimax", "cursor", "gemini", "t3code"]);

export function destinations(agent) {
  const modes = {
    desktop: { id: "desktop", label: t("在桌面客户端中聊"), hint: ["workbuddy", "qoder", "cursor", "teleagent"].includes(agent) ? t("复制任务并打开客户端，等待你粘贴发送。") : agent === "dsh" ? t("建立会话后打开 Harness；当前轮结束后在侧栏选择同一会话继续。") : t("先执行首轮，结束后打开桌面中的同一会话；首轮期间避免两边同时发送。") },
    background: { id: "background", label: t("后台执行"), hint: t("留在当前笔记，完成或需要处理时提醒。") },
    terminal: { id: "terminal", label: t("在终端中聊"), hint: t("打开交互终端，后续在终端继续。") },
  };
  if (DESTINATION_IDS[agent]) return DESTINATION_IDS[agent].map(id => modes[id]);
  if (hasAgentCapability(agent, "delegate")) {
    return [modes.background, ...(hasAgentCapability(agent, "terminalHandoff") ? [modes.terminal] : [])];
  }
  return [];
}

export function defaultDestination(plugin, agent) {
  if (BACKGROUND_DEFAULT_AGENTS.has(agent)) return "background";
  if (agent === "dsh") return "desktop";
  if (agent === "opencode") return plugin.settings?.delegate?.opencode?.openDesktop ? "desktop" : "background";
  if (agent === "codex") return plugin.settings?.delegate?.codex?.transport === "terminal" ? "terminal" : "desktop";
  if (agent === "claude") return plugin.settings?.delegate?.claude?.openDesktop ? "desktop" : "background";
  if (hasAgentCapability(agent, "delegate")) return "background";
  return "desktop";
}

export function agentDropMeta(plugin, id, metaKey = false) {
  const a = AGENTS[id] || { short: id || "Agent" };
  if (!canDelegateDrop(id)) return { delegable: false, cli: false, hint: t("暂不支持委派") };
  const cap = getAgentCapability(id);
  const handoff = id === "codex" || (!cap.delegate && Boolean(cap.desktopHandoffOnly));
  // 设置里「默认在终端里委派」开着时反过来：不按 ⌘ 在终端里开，按住 ⌘ 走原来的后台 / 客户端
  const cli = Boolean(cap.terminalHandoff) && (Boolean(metaKey) !== Boolean(plugin?.settings?.delegateInTerminal));
  const hint = cli
    ? t("在终端里开 {name}", { name: a.short })
    : (handoff ? t("交给 {name}", { name: a.short }) : t("委派给 {name}", { name: a.short }));
  return { delegable: true, cli, hint };
}

export function canOpenClient(session) {
  if (!session?.agent) return false;
  if (session.agent === "antigravity" && session.transport === "acp") return false;
  if (session.agent === "hermes" && session.app !== "cli" && session.app !== "terminal") return false;
  return true;
}

export function executionStatus(job) {
  if (!job) return "";
  if (job.handoff && !job.sessionId) return job.cli ? t("等待终端会话建立") : t("等待你在客户端粘贴发送");
  if (job.state === "starting") return t("正在建立会话");
  if (job.state === "needs-approval") return t("需要授权");
  if (job.state === "running") return job.destination === "desktop" && ["claude", "codex", "opencode"].includes(job.agent) ? t("首轮执行中，结束后打开桌面") : t("正在执行");
  if (job.state === "done") return t("本轮结束");
  return job.state === "cancelled" ? t("已停止") : "";
}

// Generated workspace directory names belong in tooltips, not in session cards.
export function workspaceLabel(cwd) {
  const name = String(cwd || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || t("工作区");
  return /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.test(name) ? t("会话工作区") : name;
}
