import { createHash } from "crypto";
import { serializeNote, updateNote } from "./note-updates.js";
import { CONFIRM_FIRST, DIRECT_EXECUTE } from "./constants.js";
import * as J from "./journal.js";
import { cleanUserPrompt } from "./prompt-text.js";
import { t } from "./i18n.js";

export const BACKGROUND_INLINE_LIMIT = 500;

// Remove note locators and plugin bookkeeping, preserving code and working links.
export function cleanBackgroundText(raw, job = {}) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const fenced = J.fencedLines(lines);
  return lines.flatMap((line, i) => {
    if (fenced.has(i)) return [line];
    if (J.parseLink(line) || /^\s*（来自 Obsidian：.*）\s*$/.test(line) || line.trim() === CONFIRM_FIRST || line.trim() === DIRECT_EXECUTE) return [];
    const metadata = /^\s*(?:[-*+]\s+)?(?:会话(?:ID|号)?|session(?:Id| ID)?|blockId|定位符|标识符)\s*[:：]\s*`?([^`]+?)`?\s*$/i.exec(line);
    if (metadata && ([job.sessionId, job.blockId, job.id].includes(metadata[1]) || J.isDeckBlockId(metadata[1]) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(metadata[1]))) return [];
    line = line.replace(/<!--\s*(?:ad-(?:turn|summary(?:-pending)?|clock):[^>]*|\/?agent-deck(?:-conversation|:)[^>]*)-->/g, "");
    const id = J.blockIdOf(line);
    if (id) line = J.stripBlockId(line);
    return [line];
  }).join("\n").trim();
}

export function backgroundRounds(messages) {
  const rounds = [];
  for (const message of messages) {
    if (message.role === "user") {
      const ask = cleanUserPrompt(message.text);
      if (ask) rounds.push({ n: rounds.length + 1, ask, said: "" });
    } else if (message.role === "assistant" && message.text) {
      if (!rounds.length) rounds.push({ n: 1, ask: "", said: "" });
      const round = rounds.at(-1);
      round.said = [round.said, message.text].filter(Boolean).join("\n\n");
    }
  }
  return rounds;
}

export function backgroundQuestion(job, round) {
  const users = (job.conversation || []).filter(message => message.role === "user");
  const raw = (round.n || 1) === 1 && job.question ? job.question
    : round.ask || users[(round.n || 1) - 1]?.text || job.question || job.blockText || job.prompt || job.name || "";
  const lines = cleanBackgroundText(raw, job).split("\n");
  const task = J.kwLine(lines[0]);
  if (task) lines[0] = task.body.replace(/^🤖\s*/, "");
  return lines.join("\n");
}

export async function saveBackgroundAnswer(plugin, job, round) {
  const reply = cleanBackgroundText(round.said, job);
  if ([...reply].length <= BACKGROUND_INLINE_LIMIT) return reply;
  const question = backgroundQuestion(job, round);
  const title = cleanBackgroundText(job.name || "问答", job).split("\n")[0].replace(/^#+\s*/, "");
  const name = title.replace(/[\\/:*?"<>|\[\]#^]/g, "-").slice(0, 70) || "问答";
  const n = round.n || 1, files = (job.backgroundFiles ||= {}), prior = files[n];
  const hash = text => createHash("sha256").update(text).digest("hex");
  const suffix = hash(job.sessionId || job.id).slice(0, 10);
  const path = prior?.path || `Agent Deck/Answers/${name}-${suffix}-${n}.md`;
  const body = `# ${title}\n\n## 问题\n\n${question}\n\n## 回答\n\n${reply}\n`;
  const vault = plugin.app.vault;
  for (const folder of ["Agent Deck", "Agent Deck/Answers"]) await serializeNote(plugin, folder, async () => {
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
  });
  await serializeNote(plugin, path, async () => vault.getAbstractFileByPath(path) || await vault.create(path, body));
  await updateNote(plugin, path, current => {
    if (current === body) return current;
    if (!prior || hash(current) !== prior.hash) throw new Error(t("问答文件已被手动修改，已保留原文，请另存后重试"));
    return body;
  });
  files[n] = { path, hash: hash(body) };
  return `📄 [[${path}|完整问答]]`;
}

export function clearBackgroundPending(text, job, round) {
  const markers = [J.sessionMarker('summary-pending', job.sessionId, round), `<!-- ad-summary-pending:${job.sessionId}:${round} -->`];
  return text.split('\n').filter((line, i, lines) => !(markers.some(marker => line.endsWith(marker)) && /^\s*[-*+] ⏳ 第\d+轮：总结暂未生成 /.test(line) && !J.hasDescendants(lines, i))).join('\n');
}
