// Obsidian UI icons: the four agent marks use the official app icons; every
// other glyph stays Lucide.
import { setIcon } from "obsidian";
import { AGENT_IMAGES } from "./agent-assets.js";

// Fallback glyphs (used only if an image asset is ever missing).
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

// 官方 App 图标：装了哪个 Agent 就把哪个 App 的 icon 贴上去（PNG 以 data URI 编进 main.js）。
// 找不到图才退回原来的 Lucide 字形。
export function agentIcon(el, agent, cls = "") {
  if (!el) return el;
  const src = AGENT_IMAGES[agent];
  if (!src) return setLucide(el, AGENT_ICONS[agent] || AGENT_ICONS.claude, cls);
  el.textContent = "";
  const img = el.ownerDocument.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.className = "ad-agentimg" + (cls ? ` ${cls}` : "");
  el.appendChild(img);
  el.classList.add("ad-icon", "ad-glyph--img");
  return el;
}

export function stateIcon(el, state, cls = "") {
  return setLucide(el, STATE_ICONS[state] || STATE_ICONS.idle, cls);
}
