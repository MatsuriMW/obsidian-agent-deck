// Lucide icon mapping for the Obsidian UI.
// Obsidian ships Lucide; setIcon() accepts these ids directly.
import { setIcon } from "obsidian";

export const AGENT_ICONS = {
  claude: "asterisk",
  codex: "square-terminal",
  workbuddy: "users",
  dsh: "brain-circuit",
};

export const STATE_ICONS = {
  run: "loader-circle",
  wait: "hand",
  quiet: "clock",
  "needs-approval": "hand",
  error: "triangle-alert",
  limit: "triangle-alert",
  done: "check",
  cancelled: "circle-x",
  idle: "circle-dot",
  recent: "history",
};

export function setLucide(el, name, cls = "") {
  if (!el) return el;
  el.textContent = "";
  try { setIcon(el, name); }
  catch { el.textContent = ""; }
  el.classList.add("ad-icon");
  if (cls) el.classList.add(cls);
  return el;
}

export function agentIcon(el, agent, cls = "") {
  return setLucide(el, AGENT_ICONS[agent] || AGENT_ICONS.claude, cls);
}

export function stateIcon(el, state, cls = "") {
  return setLucide(el, STATE_ICONS[state] || STATE_ICONS.idle, cls);
}
