import { updateNote, serializeNote } from "./note-updates.js";
// Read conversation text on demand; usage summaries intentionally truncate prompts.
import fs from "fs";
import { desktopMessages } from "./desktop-sessions.js";
import { buildCursorConversation, readCursorTranscript } from "./cursor-sessions.js";
import { buildGrokBotConversation } from "./grok-bot-sessions.js";
import { buildMuseConversation } from "./muse-sessions.js";
import { buildKimiCodeConversation } from "./kimicode-sessions.js";
import { buildDoubaoWorkConversation } from "./doubaowork-sessions.js";
import { buildGeminiCliConversation } from "./gemini-cli-sessions.js";
import * as J from "./journal.js";
import { decompress } from "fzstd";
import { createHash } from "crypto";
import { t } from "./i18n.js";
import { cleanUserPrompt } from "./prompt-text.js";

const textOf = (content) => typeof content === "string" ? content : (Array.isArray(content) ? content : [])
  .filter((b) => ["text", "input_text", "output_text"].includes(b?.type)).map((b) => b.text || "").join("\n");

export function conversationMessages(agent, source, transcriptText = "") {
  if (agent === "cursor") return buildCursorConversation(source, transcriptText);
  if (agent === "grokbot") return buildGrokBotConversation(source);
  if (agent === "muse") return buildMuseConversation(source);
  if (agent === "kimicode") return buildKimiCodeConversation(source);
  if (agent === "doubaowork") return buildDoubaoWorkConversation(source);
  if (agent === "gemini") return buildGeminiCliConversation(source);
  const messages = [];
  const seen = new Map();
  for (const line of source.split("\n")) {
    if (!line) continue;
    if (agent === "dsh" && !line.includes("user/message") && !line.includes("assistant/message")) continue;
    if ((agent === "claude" || agent === "qoder" || agent === "qwenwork") && !line.includes('"user"') && !line.includes('"assistant"')) continue;
    if (agent === "codex" && !line.includes("response_item")) continue;
    if (agent === "workbuddy" && !line.includes('"message"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    let role, text, id;
    if (agent === "dsh" && ["user/message", "assistant/message"].includes(d.type)) {
      if (d.type === "user/message" && d.data?.source?.kind && d.data.source.kind !== "user") continue;
      role = d.type === "user/message" ? "user" : "assistant";
      text = textOf(d.data?.message?.content ?? d.data?.content);
      id = d.data?.message?.id || d.data?.id;
    } else if ((agent === "claude" || agent === "qoder" || agent === "qwenwork") && ["user", "assistant"].includes(d.type) && !d.isSidechain) {
      role = d.type; text = textOf(d.message?.content); id = d.uuid;
    } else if (agent === "codex" && d.type === "response_item" && d.payload?.type === "message") {
      role = d.payload.role; text = textOf(d.payload.content); id = d.payload.id;
    } else if (agent === "workbuddy" && d.type === "message") {
      role = d.role; text = textOf(d.content); id = d.id;
    }
    if (!["user", "assistant"].includes(role) || !text?.trim()) continue;
    const message = { role, text, at: d.time || Date.parse(d.timestamp) || 0 };
    const key = id && `${role}:${id}`;
    if (key && seen.has(key)) messages[seen.get(key)] = message;
    else { if (key) seen.set(key, messages.length); messages.push(message); }
  }
  return messages;
}

export async function readConversation(plugin, session, cache = new Map()) {
  const sid = session.sid || session.sessionId;
  const owned = Object.values(plugin.jobs).find((j) => j.sessionId === sid && j.agent === session.agent);
  if (session.agent === "antigravity" && owned?.transport === "acp") return [...(owned.conversation || [])];
  const files = [...(plugin.usage.files?.values() || [])].filter((f) => f.sid === sid && f.agent === session.agent && !f.sub);
  const messages = [];
  for (const file of files) {
    if (["opencode", "qoder", "hermes", "qwenwork", "minimax", "t3code", "cindy", "orca", "teleagent"].includes(session.agent) && file.path.includes("#")) {
      const db = file.path.slice(0, file.path.lastIndexOf("#"));
      const rows = await desktopMessages(db, session.agent, sid);
      messages.push(...rows.filter((m) => m.text.trim()).map(({ role, text, at }) => ({ role, text, at })));
      continue;
    }
    if (session.agent === "kimicode") {
      messages.push(...buildKimiCodeConversation(file.path));
      continue;
    }
    if (session.agent === "doubaowork") {
      messages.push(...buildDoubaoWorkConversation(file.path));
      continue;
    }
    if (session.agent === "gemini") {
      messages.push(...buildGeminiCliConversation(file.path));
      continue;
    }
    const realPath = file.path.includes("#") ? file.path.slice(0, file.path.lastIndexOf("#")) : file.path;
    const stat = await fs.promises.stat(realPath);
    let entry = cache.get(file.path);
    if (session.agent === "cursor") {
      const rawText = await fs.promises.readFile(realPath, "utf8");
      const tr = await readCursorTranscript(rawText, file.cursor?.transcript || "");
      if (!entry || entry.mtime !== stat.mtimeMs || entry.size !== stat.size || entry.tp !== tr.path || entry.tMtime !== tr.mtime || entry.tSize !== tr.size) {
        entry = {
          mtime: stat.mtimeMs,
          size: stat.size,
          tp: tr.path,
          tMtime: tr.mtime,
          tSize: tr.size,
          messages: conversationMessages("cursor", rawText, tr.text),
        };
        cache.set(file.path, entry);
      }
      messages.push(...entry.messages);
      continue;
    }
    if (!entry || entry.mtime !== stat.mtimeMs || entry.size !== stat.size) {
      const raw = await fs.promises.readFile(realPath);
      let bytes = raw;
      if (file.zstd) {
        try { bytes = decompress(raw); }
        catch (e) {
          if (!file.zOff) throw e;
          bytes = decompress(raw.subarray(0, file.zOff));
        }
      }
      entry = { mtime: stat.mtimeMs, size: stat.size, messages: conversationMessages(session.agent, Buffer.from(bytes).toString("utf8")) };
      cache.set(file.path, entry);
    }
    messages.push(...entry.messages);
  }
  // A fresh ACP turn can finish before the next filesystem scan discovers its log.
  if (!messages.length) {
    const job = Object.values(plugin.jobs).find((j) => j.sessionId === sid && j.agent === session.agent);
    messages.push(...(job?.conversation || []));
  }
  return messages;
}

function formatToolInputText(input) {
  if (input === undefined || input === null || input === "") return "";
  if (typeof input === "string") return input.trim();
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

function formatCursorToolLines(tools) {
  const lines = ["### 工具时间线", ""];
  const fenceSafe = (s) => String(s || "").replace(/```/g, "'''");
  const statusMap = {
    success: t("成功"),
    error: t("失败"),
    interrupted: t("中断"),
    missing: t("结果缺失"),
    running: t("执行中"),
  };
  for (const tool of tools) {
    const label = statusMap[tool.status] || tool.status || "未知";
    const dur = tool.durationMs > 0 ? `（${tool.durationMs}ms）` : "";
    lines.push(`- **${tool.name || "tool"}** — ${label}${dur}`);
    const inp = formatToolInputText(tool.input);
    if (inp) {
      if (!inp.includes("\n") && inp.length <= 140) {
        lines.push(`  - 输入：\`${inp.replace(/`/g, "'")}\``);
      } else {
        lines.push(`  - 输入：`, "", "```json", fenceSafe(inp.length > 1000 ? `${inp.slice(0, 1000)}\n…` : inp), "```", "");
      }
    }
    if (tool.missingResult) {
      lines.push("  - 结果：_未采集到工具结果_");
    } else if (tool.error) {
      lines.push(`  - 错误：${String(tool.error).replace(/\s+/g, " ").trim()}`);
    } else if (tool.output) {
      const out = String(tool.output);
      const outLines = out.split("\n");
      const totalLen = tool.outputLength || out.length;
      if (out.length > 400 || outLines.length > 8) {
        lines.push(
          `  - 输出（${totalLen} 字符${tool.outputTruncated ? "，已截断" : ""}）：`,
          "",
          "<details>",
          `<summary>展开完整工具结果（${totalLen} 字符）</summary>`,
          "",
          "```text",
          fenceSafe(out),
          "```",
          "",
          "</details>",
          "",
        );
      } else if (!out.includes("\n") && out.length <= 120) {
        lines.push(`  - 输出：\`${out.replace(/`/g, "'")}\``);
      } else {
        lines.push("  - 输出：", "", "```text", fenceSafe(out), "```", "");
      }
    }
  }
  lines.push("");
  return lines;
}

const UUID_LIKE_RE = /^[a-z]+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CONTEXT_HEADER_RE = /^(?:这条任务在笔记里挂的位置[，,:：]?|（来自 Obsidian：.*）).*$/;

function cleanConversationLabel(raw) {
  const cleaned = J.stripBlockId(String(raw || ""))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !CONTEXT_HEADER_RE.test(line))
    .join(" ");
  return J.stripInlineTitleMarkup(
    J.stripTaskKeyword(cleaned.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, ""))
      .replace(/^🤖\s*/, ""),
    { stripHash: true },
  );
}

export function conversationTitle(session = {}, messages = []) {
  const candidates = [];
  for (const raw of [session.title, session.name]) {
    const s = String(raw || "").trim();
    if (s && !UUID_LIKE_RE.test(s)) candidates.push(cleanConversationLabel(s));
  }
  for (const m of messages || []) {
    if (!m?.text) continue;
    const stripped = cleanConversationLabel(cleanUserPrompt(m.text));
    if (stripped && !UUID_LIKE_RE.test(stripped)) { candidates.push(stripped); break; }
  }
  for (const raw of [session.prompt, session.firstPrompt, session.task]) {
    const s = cleanConversationLabel(cleanUserPrompt(raw || ""));
    if (s && !UUID_LIKE_RE.test(s)) { candidates.push(s); break; }
  }
  const picked = candidates.find(Boolean) || "";
  if (picked) return picked.slice(0, 60).trim();
  const agent = String(session.agent || "Agent").trim();
  return `${agent} 对话`;
}

export function conversationMarkdown(session, messages) {
  const title = conversationTitle(session, messages).replace(/[\r\n]/g, " ");
  const sid = session.sid || session.sessionId;
  const hasTools = session.agent === "cursor" || messages.some((m) => Array.isArray(m.tools) && m.tools.length);
  const noteLine = hasTools
    ? "> 本文归档用户消息、工具调用时间线（长结果已折叠）与 Agent 回复正文；内部推理与附件不包含在内。"
    : "> 本文归档用户消息与 Agent 回复正文；工具结果、内部推理和附件不包含在内。";
  const body = messages.flatMap((m) => {
    const out = [`## ${m.role === "user" ? "用户" : "Agent"}`, ""];
    if (m.text) out.push(m.text, "");
    if (Array.isArray(m.tools) && m.tools.length) out.push(...formatCursorToolLines(m.tools));
    return out;
  });
  return [`# ${title}`, "", `Agent：${session.agent}`, `会话：${sid}`, "", noteLine, "", ...body].join("\n");
}

export function conversationPath(session, messages = []) {
  const title = conversationTitle(session, messages);
  const safeTitle = title
    .replace(/\.\.+/g, "-")
    .replace(/[\\/:*?"<>|\[\]#^]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    || "对话";
  const sid = String(session?.sid || session?.sessionId || "unknown");
  const agent = String(session?.agent || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const hash = createHash("sha256").update(`${agent}:${sid}`).digest("hex").slice(0, 8);
  return `Agent Deck/Conversations/${safeTitle}-${agent}-${hash}.md`;
}

export async function archiveConversation(plugin, session, { messages: suppliedMessages } = {}) {
  const active = Object.values(plugin.jobs).find((j) => j.agent === session.agent && j.sessionId === (session.sid || session.sessionId));
  if (["starting", "running", "needs-approval"].includes(active?.state)) throw new Error(t("请等当前这一轮结束后再归档"));
  const messages = suppliedMessages || await readConversation(plugin, session);
  if (!messages.length) throw new Error(t("暂未读取到对话正文，请扫描会话后重试"));
  const vault = plugin.app.vault;
  const title = conversationTitle(session, messages);
  const notePath = conversationPath(session, messages);
  for (const folder of ["Agent Deck", "Agent Deck/Conversations"]) {
    await serializeNote(plugin, folder, async () => {
      if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
    });
  }
  const body = conversationMarkdown(session, messages);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const content = `<!-- agent-deck-conversation sha256:${hash(body)} -->\n${body}\n<!-- /agent-deck-conversation -->`;

  const file = await serializeNote(plugin, notePath, async () =>
    vault.getAbstractFileByPath(notePath) || await vault.create(notePath, content));
  await updateNote(plugin, notePath, prior => {
    if (prior === content) return prior;
    const region = /<!-- agent-deck-conversation sha256:([a-f0-9]{64}) -->\n([\s\S]*?)\n<!-- \/agent-deck-conversation -->/.exec(prior);
    if (!region || hash(region[2]) !== region[1]) throw new Error(t("该会话已有归档，且正文经过手工修改。请先保留或移动旧归档后再导出"));
    return prior.slice(0, region.index) + content + prior.slice(region.index + region[0].length);
  });
  await linkArchive(plugin, session, notePath, title);
  return file;
}

async function linkArchive(plugin, session, archivePath, title = "") {
  if (!plugin.readNote || !plugin.writeNote) return;
  const sid = session.sid || session.sessionId;
  const job = Object.values(plugin.jobs).find(j => j.agent === session.agent && j.sessionId === sid);
  const binding = Object.values(plugin.settings?.taskBindings || {}).find(b => b.sid === sid);
  const target = binding?.path ? binding : job;
  if (!target?.path || !plugin.app.vault.getAbstractFileByPath(target.path)) return;
  const alias = title ? `对话归档 · ${title.slice(0, 36)}` : `对话归档 · ${session.agent}`;
  await updateNote(plugin, target.path, text => {
    if (text.includes(`[[${archivePath}|`)) return text;
    const task = J.findTask(text, target.key || J.workKey(target.name || ""), target.blockId, sid);
    if (!task) return text;
    const lines = text.split("\n"), indent = (lines[task.line].match(/^[ \t]*/)?.[0] || "") + "\t";
    lines.splice(task.line + 1, 0, `${indent}- 📄 [[${archivePath}|${alias}]]`);
    return lines.join("\n");
  });
}
