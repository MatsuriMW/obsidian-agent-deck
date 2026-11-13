// User-facing destinations and lifecycle, independent of transport protocols.
export const activeJob = (job) => ["starting", "running", "needs-approval"].includes(job?.state);

export function destinations(agent) {
  const modes = {
    obsidian: { id: "obsidian", label: "在 Obsidian 中聊", hint: "发送后打开对话，在原会话中继续追问。" },
    desktop: { id: "desktop", label: "在桌面客户端中聊", hint: agent === "workbuddy" ? "复制任务并打开客户端，等待你粘贴发送。" : agent === "dsh" ? "建立会话后打开 Harness；当前轮结束后在侧栏选择同一会话继续。" : "先执行首轮，结束后打开桌面中的同一会话；首轮期间避免两边同时发送。" },
    background: { id: "background", label: "后台执行", hint: "留在当前笔记，完成或需要处理时提醒。" },
    terminal: { id: "terminal", label: "在终端中聊", hint: "打开交互终端，后续在终端继续。" },
  };
  const ids = { claude: ["desktop", "background", "terminal"], codex: ["desktop", "background", "terminal"], dsh: ["obsidian", "desktop", "background"], antigravity: ["obsidian", "background"], workbuddy: ["desktop"] };
  return (ids[agent] || []).map(id => modes[id]);
}

export function defaultDestination(plugin, agent) {
  if (["dsh", "antigravity"].includes(agent)) return "obsidian";
  if (agent === "codex") return plugin.settings.delegate.codex?.transport === "terminal" ? "terminal" : "desktop";
  if (agent === "claude") return plugin.settings.delegate.claude?.openDesktop ? "desktop" : "background";
  return "desktop";
}

export function canOpenClient(session) {
  return !(session.agent === "antigravity" && session.transport === "acp");
}

export function executionStatus(job) {
  if (!job) return "";
  if (job.handoff && !job.sessionId) return job.cli ? "等待终端会话建立" : "等待你在客户端粘贴发送";
  if (job.state === "starting") return "正在建立会话";
  if (job.state === "needs-approval") return "需要授权";
  if (job.state === "running") return job.destination === "desktop" && ["claude", "codex"].includes(job.agent) ? "首轮执行中，结束后打开桌面" : "正在执行";
  if (job.state === "done") return "本轮结束";
  return job.state === "cancelled" ? "已停止" : "";
}

// Generated workspace directory names belong in tooltips, not in session cards.
export function workspaceLabel(cwd) {
  const name = String(cwd || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "工作区";
  return /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.test(name) ? "会话工作区" : name;
}
