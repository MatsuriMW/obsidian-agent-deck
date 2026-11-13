// Read conversation text on demand; usage summaries intentionally truncate prompts.
import fs from "fs";
import * as J from "./journal.js";
import { decompress } from "fzstd";
import { createHash } from "crypto";
import { t } from "./i18n.js";

const textOf = (content) => typeof content === "string" ? content : (Array.isArray(content) ? content : [])
  .filter((b) => ["text", "input_text", "output_text"].includes(b?.type)).map((b) => b.text || "").join("\n");

export function conversationMessages(agent, source) {
  const messages = [];
  const seen = new Map();
  for (const line of source.split("\n")) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    let role, text, id;
    if (agent === "dsh" && ["user/message", "assistant/message"].includes(d.type)) {
      if (d.type === "user/message" && d.data?.source?.kind && d.data.source.kind !== "user") continue;
      role = d.type === "user/message" ? "user" : "assistant";
      text = textOf(d.data?.message?.content ?? d.data?.content);
      id = d.data?.message?.id || d.data?.id;
    } else if (agent === "claude" && ["user", "assistant"].includes(d.type) && !d.isSidechain) {
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
    const stat = await fs.promises.stat(file.path);
    let entry = cache.get(file.path);
    if (!entry || entry.mtime !== stat.mtimeMs || entry.size !== stat.size) {
      const raw = await fs.promises.readFile(file.path);
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

export function conversationMarkdown(session, messages) {
  const title = String(session.title || session.name || "Agent 对话").replace(/[\r\n]/g, " ");
  const sid = session.sid || session.sessionId;
  return [`# ${title}`, "", `Agent：${session.agent}`, `会话：${sid}`, "", "> 本文归档用户消息与 Agent 回复正文；工具结果、内部推理和附件不包含在内。", "",
    ...messages.flatMap((m) => [`## ${m.role === "user" ? "用户" : "Agent"}`, "", m.text, ""])].join("\n");
}

export function conversationPath(session) {
  const safe = (s) => String(s || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `Agent Deck/Conversations/${safe(session.agent)}-${safe(session.sid || session.sessionId)}.md`;
}

export async function archiveConversation(plugin, session) {
  const active = Object.values(plugin.jobs).find((j) => j.agent === session.agent && j.sessionId === (session.sid || session.sessionId));
  if (["starting", "running", "needs-approval"].includes(active?.state)) throw new Error(t("请等当前这一轮结束后再归档"));
  const messages = await readConversation(plugin, session);
  if (!messages.length) throw new Error(t("暂未读取到对话正文，请扫描会话后重试"));
  const vault = plugin.app.vault;
  const notePath = conversationPath(session);
  for (const folder of ["Agent Deck", "Agent Deck/Conversations"]) {
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
  }
  const body = conversationMarkdown(session, messages);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const content = `<!-- agent-deck-conversation sha256:${hash(body)} -->\n${body}\n<!-- /agent-deck-conversation -->`;

  const file = vault.getAbstractFileByPath(notePath);
  if (file) {
    const prior = await vault.read(file);
    if (prior === content) { await linkArchive(plugin, session, notePath); return file; }
    const region = /<!-- agent-deck-conversation sha256:([a-f0-9]{64}) -->\n([\s\S]*?)\n<!-- \/agent-deck-conversation -->/.exec(prior);
    if (!region || hash(region[2]) !== region[1]) throw new Error(t("该会话已有归档，且正文经过手工修改。请先保留或移动旧归档后再导出"));
    const next = prior.slice(0, region.index) + content + prior.slice(region.index + region[0].length);
    if (next !== prior) await vault.modify(file, next);
    await linkArchive(plugin, session, notePath);
    return file;
  }
  const created = await vault.create(notePath, content);
  await linkArchive(plugin, session, notePath);
  return created;
}

async function linkArchive(plugin, session, archivePath) {
  if (!plugin.readNote || !plugin.writeNote) return;
  const sid = session.sid || session.sessionId;
  const job = Object.values(plugin.jobs).find(j => j.agent === session.agent && j.sessionId === sid);
  const binding = Object.values(plugin.settings?.taskBindings || {}).find(b => b.sid === sid);
  const target = binding?.path ? binding : job;
  if (!target?.path || !plugin.app.vault.getAbstractFileByPath(target.path)) return;
  const text = await plugin.readNote(target.path);
  if (text.includes(`[[${archivePath}|`)) return;
  const task = J.findTask(text, target.key || J.workKey(target.name || ""), target.blockId, sid);
  if (!task) return;
  const lines = text.split("\n"), indent = (lines[task.line].match(/^[ \t]*/)?.[0] || "") + "\t";
  lines.splice(task.line + 1, 0, `${indent}- 📄 [[${archivePath}|对话归档 · ${session.agent}]]`);
  await plugin.writeNote(target.path, lines.join("\n"));
}
