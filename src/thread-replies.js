// 回复协议：笔记里的 ❓ / ✍️ / 💬 三行就是一轮对话。
//
//   - DOING 🤖 发布插件 ^ad-release
//     - ❓ 第2轮：版本号用 1.9.6 还是 2.0.0？   <!-- ad-turn:…:2 -->
//     - ✍️ 答：用 1.9.6                        ← 用户写；按钮写的也是这一行
//     - 💬 第3轮：按 1.9.6 发布，已完成
//
// 纯文本解析，不碰 Obsidian API：谁在问、答没答、要不要补空行、下一轮回灌什么，都在这里定。
// 状态不另造关键字：❓ 未答 = 等你，写了 ✍️ = 已答，之后出现 💬 = 已跑完。
// 两个块号：❓ 行 `^ad-q-…`、✍️ 行 `^ad-a-…`（`^ad-*` 类，注入前会被剥掉），
// 于是别处可以写 `[[笔记#^ad-q-…]]` 直接指到某一问，插件定位也按块号而不是正文。

import { createHash } from "crypto";
import { t } from "./i18n.js";
import { blockIdOf, fencedLines } from "./journal.js";

export const QUESTION_RE = /^(\s*)[-*+]\s+❓\s*(?:第\s*(\d+)\s*轮\s*[：:]?\s*)?(.*)$/;
export const ANSWER_RE = /^(\s*)[-*+]\s+✍️\s*(?:答\s*[：:]?\s*)?(.*)$/;
const TURN_MARKER_RE = /\s*<!--\s*ad-turn:[^>]*-->\s*/g;
// 行尾块号：注入给 Agent 的问答文本里不该出现（它们只是笔记里的锚点）。
const BLOCK_ID_TAIL_RE = /\s*\^[a-z0-9][a-z0-9-]*\s*$/i;

const stableId = (prefix, seed) => `${prefix}-${createHash("sha1").update(String(seed || "")).digest("hex").slice(0, 8)}`;
// ❓ 行与 ✍️ 行各有一个 `^ad-q-…` / `^ad-a-…` 块号：双链能直接指过来，定位也不靠正文模糊匹配。
export const makeQuestionId = (seed = "") => stableId("ad-q", seed);
export const answerIdOf = (questionId = "") => stableId("ad-a", questionId || "reply");

const clean = (text) =>
  String(text || "").replace(TURN_MARKER_RE, " ").replace(BLOCK_ID_TAIL_RE, " ").replace(/\s+/g, " ").trim();

// 解析一块（含子树）里的问答：question 之后、下一个更深或同级的 ❓ 之前的第一个 ✍️ 就是它的回答。
export function parseThread(lines = [], block = null) {
  const list = lines || [];
  const start = block && Number.isInteger(block.start) ? block.start : 0;
  const end = block && Number.isInteger(block.end) ? block.end : list.length - 1;
  const questions = [];
  const orphans = [];
  // 代码块里的 ❓ / ✍️ 只是示例文本，不算问答（和 agentText 的遮蔽口径一致）。
  const fenced = fencedLines(list);
  for (let i = start; i <= end && i < list.length; i++) {
    if (fenced.has(i)) continue;
    const line = list[i] || "";
    const q = QUESTION_RE.exec(line);
    if (q) {
      questions.push({ line: i, indent: q[1] || "", round: q[2] ? Number(q[2]) : questions.length + 1, text: clean(q[3]), id: blockIdOf(line), answerLine: -1, answer: "", answerId: "" });
      continue;
    }
    const a = ANSWER_RE.exec(line);
    if (!a) continue;
    const open = [...questions].reverse().find((x) => x.answerLine < 0);
    if (!open) { orphans.push({ line: i, text: clean(a[2]) }); continue; }
    open.answerLine = i;
    open.answer = clean(a[2]);
    open.answerId = blockIdOf(line);
  }
  return { questions, orphans };
}

// 最新一条还没答的提问。
export const pendingQuestion = (parsed) => [...(parsed?.questions || [])].reverse().find((q) => q.answerLine < 0) || null;

// 补空行：没有 ✍️ 就在提问下一行插一行空的，返回插入位置。
export function answerSlot(lines = [], questionLine = -1) {
  const list = lines || [];
  if (questionLine < 0 || questionLine >= list.length) return null;
  const q = QUESTION_RE.exec(list[questionLine] || "");
  if (!q) return null;
  const indent = q[1] || "";
  const unit = /\t/.test(indent) ? "\t" : "  ";
  const next = list[questionLine + 1] || "";
  const existing = ANSWER_RE.exec(next);
  if (existing && (existing[1] || "") === indent) return { line: questionLine + 1, indent, exists: true };
  return { line: questionLine + 1, indent, exists: false, unit };
}

const widthOf = (line) => ((/^[ \t]*/.exec(line) || [""])[0]).replace(/\t/g, "    ").length;
const questionTextOf = (line) => {
  const m = QUESTION_RE.exec(line);
  return m ? clean(m[3]) : "";
};

// 找到"这一问"那一行：块号优先，其次块号锚点 + 正文前缀，最后按正文匹配。
export function locateQuestion(lines = [], { blockId = "", questionId = "", questionText = "" } = {}) {
  if (!lines.length) return -1;
  if (questionId) {
    const byQid = lines.findIndex((l) => blockIdOf(l) === questionId);
    if (byQid >= 0) return byQid;
  }
  const want = clean(questionText);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const body = questionTextOf(lines[i]);
    if (body && (!want || body.startsWith(want.slice(0, 12)))) matches.push(i);
  }
  if (blockId) {
    const anchor = lines.findIndex((l) => blockIdOf(l) === blockId);
    const after = anchor >= 0 ? matches.find((i) => i > anchor) : -1;
    if (after >= 0) return after;
    if (anchor >= 0) {
      const base = widthOf(lines[anchor]);
      let last = -1;
      for (let i = anchor + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (widthOf(lines[i]) <= base) break;
        if (questionTextOf(lines[i])) last = i;
      }
      if (last >= 0) return last;
    }
  }
  return matches[0] ?? -1;
}

// 给 ❓ 补块号（幂等）。有了它，回答行、双链、外部引用都不再依赖正文。
export function ensureQuestionId(text = "", { blockId = "", questionId = "", questionText = "", seed = "" } = {}) {
  const lines = String(text || "").split("\n");
  const at = locateQuestion(lines, { blockId, questionId, questionText });
  if (at < 0) return text;
  if (blockIdOf(lines[at])) return text;
  const id = questionId || makeQuestionId(seed || questionText);
  lines[at] = `${lines[at].replace(/\s+$/, "")} ^${id}`;
  return lines.join("\n");
}

// 把答案写进去（幂等：同一句话不重复写；已有 ✍️ 行就原地改，不新开一行）。
// 答案行带 `^ad-a-…`，由提问块号稳定派生：改答案不换号，别处的转引不会断。
export function fillAnswer(text = "", { questionText = "", answer = "", blockId = "", questionId = "", seed = "" } = {}) {
  const value = clean(answer);
  if (!value) return text;
  const lines = String(text || "").split("\n");
  const at = locateQuestion(lines, { blockId, questionId, questionText });
  if (at < 0) return text;

  const qid = blockIdOf(lines[at]) || questionId || makeQuestionId(seed || questionText);
  const aid = answerIdOf(qid);
  const base = widthOf(lines[at]);
  const indent = (QUESTION_RE.exec(lines[at]) || [null, ""])[1] || "";
  let answerAt = -1;
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (widthOf(lines[i]) < base) break;
    if (questionTextOf(lines[i])) break;
    if (ANSWER_RE.test(lines[i])) { answerAt = i; break; }
  }
  if (answerAt >= 0) {
    const keep = blockIdOf(lines[answerAt]) || aid;
    const next = `${indent}- ✍️ 答：${value} ^${keep}`;
    if (next === lines[answerAt]) return text;
    lines[answerAt] = next;
    return lines.join("\n");
  }
  lines.splice(at + 1, 0, `${indent}- ✍️ 答：${value} ^${aid}`);
  return lines.join("\n");
}

// 老数据兼容：已经写好的 ❓ / ✍️ 没有块号时，一次性补上（可重复执行，幂等）。
export function anchorThreadText(text = "", { blockId = "", seedPrefix = "" } = {}) {
  let out = String(text || "");
  const lines = out.split("\n");
  const start = blockId ? lines.findIndex((l) => blockIdOf(l) === blockId) : 0;
  if (start < 0) return out;
  const base = widthOf(lines[start]);
  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (widthOf(lines[i]) <= base && /^\s*[-*+]\s+/.test(lines[i])) { end = i - 1; break; }
  }
  const { questions } = parseThread(lines, { start, end });
  for (const q of questions) {
    out = ensureQuestionId(out, { blockId, questionText: q.text, seed: `${seedPrefix}|${blockId}|${q.text}` });
    if (q.answer) out = fillAnswer(out, { blockId, questionText: q.text, answer: q.answer });
  }
  return out;
}

// 回灌给 Agent 的那一段：最近这一问 + 之前几轮的问答（默认 3 轮）。
export function replyPromptText(parsed, { limit = 3 } = {}) {
  const all = parsed?.questions || [];
  if (!all.length) return "";
  const answered = all.filter((q) => q.answerLine >= 0).slice(-limit);
  const pending = pendingQuestion(parsed);
  const rows = [];
  if (pending) rows.push(t("这一问还等你回答：第{round}轮：{text}", { round: String(pending.round), text: pending.text }));
  if (answered.length) {
    rows.push(t("你已经回答过的（越往后越新）："));
    for (const q of answered) rows.push(t("- 第{round}轮：问「{question}」→ 答「{answer}」", { round: String(q.round), question: q.text, answer: q.answer }));
  }
  if (!rows.length) return "";
  return `${t("任务里的问答记录（按原文为准，不要重复追问）：")}\n${rows.join("\n")}`;
}

// 从问句里猜可点的选项：A 还是 B / X 或 Y / 是否。
export function suggestOptions(question = "") {
  const text = clean(question);
  const out = [];
  const m = /([^\s，。？?]{1,24}?)\s*(?:还是|或者|或)\s*([^\s，。？?]{1,24})/.exec(text);
  if (m) for (const part of [m[1], m[2]]) {
    const value = part.replace(/^(?:用|选|按|采用)/, "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  if (!out.length && /(?:是否|要不要|对不对|可以吗|行吗)/.test(text)) out.push(t("是"), t("否"));
  const yesNo = /^(?:是|好|可以|同意|确认)\s*[，,]?\s*(?:否|不|不同意|取消)?$/.exec(text);
  if (!out.length && yesNo) out.push(t("是"), t("否"));
  return out.slice(0, 4);
}
