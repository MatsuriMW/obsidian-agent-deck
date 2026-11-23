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
import { blockIdOf, fencedLines, RESULT_RE } from "./journal.js";

export const QUESTION_RE = /^(\s*)[-*+]\s+❓\s*(?:(?:第\s*(\d+)\s*轮|Round\s+(\d+)(?:\s*\([^)]*\))?)\s*[：:]?\s*)?(.*)$/i;
export const ANSWER_RE = /^(\s*)[-*+]\s+✍️\s*(?:(?:答|Answer)\s*[：:]?\s*)?(.*)$/i;
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
      const roundNo = q[2] || q[3];
      questions.push({ line: i, indent: q[1] || "", round: roundNo ? Number(roundNo) : questions.length + 1, text: clean(q[4]), id: blockIdOf(line), answerLine: -1, answer: "", answerId: "" });
      continue;
    }
    const a = ANSWER_RE.exec(line);
    if (!a) continue;
    const open = [...questions].reverse().find((x) => x.answerLine < 0);
    const value = clean(a[2]);
    if (!open) { orphans.push({ line: i, text: value }); continue; }
    if (!value) { open.slotLine = i; continue; } // 空行只是留了位置，还不算回答
    open.answerLine = i;
    open.answer = value;
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
  return m ? clean(m[4]) : "";
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

function resolveBlockRange(lines, { blockId = "", atLine = -1 } = {}) {
  const anchor = blockId ? lines.findIndex((l) => blockIdOf(l) === blockId) : -1;
  const fallback = Number.isInteger(atLine) && atLine >= 0 && atLine < lines.length ? atLine : 0;
  const start = anchor >= 0 ? anchor : fallback;
  if (start < 0 || start >= lines.length) return null;
  const base = widthOf(lines[start] || "");
  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (widthOf(lines[i]) <= base && /^\s*[-*+]\s+/.test(lines[i])) { end = i - 1; break; }
  }
  while (end > start && !lines[end].trim()) end--;
  return { start, end };
}

// 老数据兼容：已经写好的 ❓ / ✍️ 没有块号时，一次性补上（可重复执行，幂等）。
export function anchorThreadText(text = "", { blockId = "", atLine = -1, seedPrefix = "" } = {}) {
  let out = String(text || "");
  const lines = out.split("\n");
  if (blockId && lines.findIndex((l) => blockIdOf(l) === blockId) < 0) return out;
  const range = resolveBlockRange(lines, { blockId, atLine });
  if (!range) return out;
  const { questions } = parseThread(lines, range);
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
  // 注入前统一去排版符号：和 agentText 同口径，免得同一句话在 prompt 里一处带 **、一处没有。
  const plain = (value) => String(value || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1").trim();
  if (pending) rows.push(t("这一问还等你回答：第{round}轮：{text}", { round: String(pending.round), text: plain(pending.text) }));
  if (answered.length) {
    rows.push(t("你已经回答过的（越往后越新）："));
    for (const q of answered) rows.push(t("- 第{round}轮：问「{question}」→ 答「{answer}」", { round: String(q.round), question: plain(q.text), answer: plain(q.answer) }));
  }
  if (!rows.length) return "";
  return `${t("任务里的问答记录（按原文为准，不要重复追问）：")}\n${rows.join("\n")}`;
}

// Agent 的回答里带问号 → 它在等你回答。
// 只看最后几行：常见写法是"先抛问题、再补一句'问完就停'"，
// 死盯最后一行会漏掉；但翻太远又会把解释里的反问当提问，所以窗口限 3 行。
export function lastQuestionLine(text = "", { window = 12 } = {}) {
  const raw = String(text || "").split("\n");
  const fenced = fencedLines(raw);
  const lines = raw.filter((_, i) => !fenced.has(i)).map((l) => l.trim()).filter(Boolean);
  // 窗口给到 12 行：真实提问常常是"先抛问题 → 列 A/B/C → 补一句'你选完我就照办'"，
  // 只盯最后三行会整段漏掉（真机踩过）。取窗口里**最后一个问句**，收尾的陈述句不影响。
  for (const line of lines.slice(-window).reverse()) {
    // 按句切：问题常常夹在一句解释中间（"用 npm 还是 pnpm？请告诉我，我先停在这"）。
    const sentences = clean(line).split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
    for (const sentence of sentences.reverse()) {
      // 下限 4：中文短问句（"你选哪个？""要不要跑？"）也得算，太长的不当提问。
      if (sentence.length < 4 || sentence.length > 280) continue;
      if (!/[？?]$/.test(sentence)) continue;
      return sentence;
    }
  }
  return "";
}

export const looksLikeQuestion = (text = "") => Boolean(lastQuestionLine(text));

// 把"它在问"写成笔记里的 `❓` 行：幂等（同一句不重复写），顺手带上块号。
export function appendQuestionText(text = "", { blockId = "", atLine = -1, question = "", round = 0, seed = "" } = {}) {
  const value = clean(question);
  if (!value) return text;
  const lines = String(text || "").split("\n");
  if (blockId && lines.findIndex((l) => blockIdOf(l) === blockId) < 0) return text;
  const range = resolveBlockRange(lines, { blockId, atLine });
  if (!range) return text;
  const { start, end } = range;
  const { questions } = parseThread(lines, range);
  if (questions.some((q) => q.text === value)) return text; // 同一句问过就不再写
  const roundNo = round || questions.length + 1;
  const indent = ((/^[ \t]*/.exec(lines[start] || "") || [""])[0]) + "\t";
  const id = makeQuestionId(seed || `${blockId}|${value}`);
  lines.splice(end + 1, 0, `${indent}- ❓ 第${roundNo}轮：${value} ^${id}`);
  return lines.join("\n");
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

// 找出这一块里最近一条"已手写好 ✍️ 答"但还没有后续 ❓ 的回答，供原地发出并续聊。
export function latestWrittenAnswer(lines = [], block = null) {
  if (!block) return null;
  const parsed = parseThread(lines, block);
  if (pendingQuestion(parsed)) return null;
  const q = [...parsed.questions].reverse().find((x) => x.answerLine >= 0 && x.answer);
  const entry = q
    ? { line: q.answerLine, answer: q.answer, question: q }
    : (() => {
        const orphan = [...parsed.orphans].reverse().find((o) => o.text);
        return orphan ? { line: orphan.line, answer: orphan.text, question: null } : null;
      })();
  if (!entry) return null;
  const fenced = fencedLines(lines);
  const end = Number.isInteger(block.end) ? block.end : lines.length - 1;
  let hasResultAfter = false;
  for (let i = entry.line + 1; i <= end && i < lines.length; i++) {
    if (!fenced.has(i) && RESULT_RE.test(lines[i] || "")) { hasResultAfter = true; break; }
  }
  return { ...entry, hasResultAfter };
}
