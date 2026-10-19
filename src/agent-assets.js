// Official app icons for the four agents, embedded as data URIs.
//
// The dashboard renders them with <img>; the macOS menu-bar helper gets the same
// PNGs written to ~/.agent-deck/agents/ at startup. Sources are the installed
// apps: Claude.app, ChatGPT.app's Codex icon, WorkBuddy.app and DeepSeek Harness.app.
import claude from "../assets/agents/claude.png";
import codex from "../assets/agents/codex.png";
import workbuddy from "../assets/agents/workbuddy.png";
import dsh from "../assets/agents/dsh.png";

export const AGENT_IMAGES = { claude, codex, workbuddy, dsh };

export function agentImageBuffer(id) {
  const uri = AGENT_IMAGES[id];
  if (!uri) return null;
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
}
