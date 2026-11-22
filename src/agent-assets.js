// Official app icons for the agents, embedded as data URIs.
//
// The dashboard renders them with <img>; the macOS menu-bar helper gets the same
// PNGs written to ~/.agent-deck/agents/ at startup. Sources are the installed
// apps, including OpenCode.app and Qoder.app.
import claude from "../assets/agents/claude.png";
import codex from "../assets/agents/codex.png";
import workbuddy from "../assets/agents/workbuddy.png";
import dsh from "../assets/agents/dsh.png";
import antigravity from "../assets/agents/antigravity.png";
import opencode from "../assets/agents/opencode.png";
import qoder from "../assets/agents/qoder.png";
import hermes from "../assets/agents/hermes.png";
import qwenwork from "../assets/agents/qwenwork.png";
import cursor from "../assets/agents/cursor.png";
import grokbot from "../assets/agents/grokbot.png";
import minimax from "../assets/agents/minimax.png";
import t3code from "../assets/agents/t3code.png";
import muse from "../assets/agents/muse.png";
import kimicode from "../assets/agents/kimicode.png";
import doubaowork from "../assets/agents/doubaowork.png";
import gemini from "../assets/agents/gemini.png";

export const AGENT_IMAGES = { claude, codex, workbuddy, dsh, antigravity, opencode, qoder, hermes, minimax, qwenwork, cursor, grokbot, t3code, muse, kimicode, doubaowork, gemini };

export function agentImageBuffer(id) {
  const uri = AGENT_IMAGES[id];
  if (!uri) return null;
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
}
