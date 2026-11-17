import test from "node:test";
import assert from "node:assert/strict";
import { parseThread, pendingQuestion, answerSlot, fillAnswer, ensureQuestionId, anchorThreadText, makeQuestionId, answerIdOf, locateQuestion, replyPromptText, suggestOptions } from "../src/thread-replies.js";

// 一块典型的"问了、没答"的任务
const openLines = [
  "- DOING 🤖 发布插件 ^ad-release",
  "\t- 🔗 [Codex](codex://threads/abc)",
  "\t- ❓ 第2轮：版本号用 1.9.6 还是 2.0.0？ <!-- ad-turn:abc:2 -->",
  "\t- 💬 上一轮的结论 <!-- ad-turn:abc:1 -->",
];
const block = { start: 0, end: 3 };

test("解析：❓ 的轮次与正文，去掉 transport 标记；没写 ✍️ 就是待答", () => {
  const parsed = parseThread(openLines, block);
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.questions[0].round, 2);
  assert.equal(parsed.questions[0].text, "版本号用 1.9.6 还是 2.0.0？");
  assert.equal(parsed.questions[0].answerLine, -1);
  assert.equal(pendingQuestion(parsed).line, 2);
});

test("解析：✍️ 挂在它上面那一问，后面的 💬 不算回答", () => {
  const answered = [
    "- DOING 发布插件",
    "  - ❓ 第1轮：用哪个分支？",
    "  - ✍️ 答：main",
    "  - ❓ 第2轮：要发 changelog 吗？",
    "  - 💬 已发布",
  ];
  const parsed = parseThread(answered, { start: 0, end: 4 });
  assert.equal(parsed.questions[0].answer, "main");
  assert.equal(parsed.questions[0].answerLine, 2);
  assert.equal(parsed.questions[1].answerLine, -1, "第二问还没答");
  assert.equal(pendingQuestion(parsed).round, 2);
});

test("解析：没有 ❓ 的块返回空；孤儿 ✍️ 不吞掉任何问题", () => {
  assert.deepEqual(parseThread(["- TODO 干活", "  - 💬 做完了"], { start: 0, end: 1 }).questions, []);
  const lonely = parseThread(["- TODO 干活", "  - ✍️ 答：乱写的"], { start: 0, end: 1 });
  assert.equal(lonely.questions.length, 0);
  assert.equal(lonely.orphans.length, 1);
});

test("补空行：没有 ✍️ 时给出插入位置与缩进；已有就返回那一行", () => {
  const slot = answerSlot(openLines, 2);
  assert.equal(slot.exists, false);
  assert.equal(slot.line, 3);
  assert.equal(slot.indent, "\t");

  const withAnswer = ["- DOING 任务", "  - ❓ 第1轮：A 还是 B？", "  - ✍️ 答：A"];
  const again = answerSlot(withAnswer, 1);
  assert.equal(again.exists, true);
  assert.equal(again.line, 2);
});

test("写回：原地改已有的 ✍️ 行，不新开一行；重复写同一句是空操作", () => {
  const withAnswer = ["- DOING 任务", "  - ❓ 第1轮：A 还是 B？", "  - ✍️ 答：旧的"];
  const once = fillAnswer(withAnswer.join("\n"), { questionText: "A 还是 B？", answer: "A" });
  assert.ok(once.includes("  - ✍️ 答：A"));
  assert.equal(once.split("✍️").length - 1, 1, "只有一行回答");
  assert.equal(fillAnswer(once, { questionText: "A 还是 B？", answer: "A" }), once, "同句重复写不产生变化");
  const again = fillAnswer(once, { questionText: "A 还是 B？", answer: "B" });
  assert.ok(again.includes("✍️ 答：B"), "改了答案就更新那一行");
  assert.equal(again.split("✍️").length - 1, 1);
});

test("写回：没回答时插在提问下一行，缩进跟提问一致；找不到提问就不动文本", () => {
  const out = fillAnswer(openLines.join("\n"), { questionText: "版本号用 1.9.6 还是 2.0.0？", answer: "用 1.9.6" });
  const lines = out.split("\n");
  assert.match(lines[3], /^\t- ✍️ 答：用 1\.9\.6 \^ad-a-[0-9a-f]{8}$/, "回答行带派生块号");
  assert.equal(fillAnswer("- TODO 别的块", { questionText: "不存在的问", answer: "x" }), "- TODO 别的块");
});

test("写回：按块号定位到那一块里的提问（笔记里有多块时）", () => {
  const two = ["- TODO 甲 ^ad-a", "  - ❓ 第1轮：甲的提问？", "- TODO 乙 ^ad-b", "  - ❓ 第1轮：乙的提问？"];
  const out = fillAnswer(two.join("\n"), { blockId: "ad-b", questionText: "乙的提问？", answer: "乙的答案" });
  const lines = out.split("\n");
  assert.match(lines[4], /^  - ✍️ 答：乙的答案 \^ad-a-[0-9a-f]{8}$/);
  assert.ok(!out.includes("甲的答案"));
});

test("回灌：最近这一问 + 已答的几轮，都写进 prompt 段", () => {
  const text = replyPromptText(parseThread(openLines, block));
  assert.match(text, /还等你回答/);
  assert.match(text, /版本号用 1\.9\.6 还是 2\.0\.0？/);
  assert.match(text, /按原文为准/);

  const answered = ["- DOING 任务", "  - ❓ 第1轮：分支？", "  - ✍️ 答：main", "  - ❓ 第2轮：要 tag 吗？", "  - ✍️ 答：要"];
  const both = replyPromptText(parseThread(answered, { start: 0, end: 4 }));
  assert.match(both, /第1轮：问「分支？」→ 答「main」/);
  assert.match(both, /第2轮：问「要 tag 吗？」→ 答「要」/);
  assert.equal(replyPromptText(parseThread(["- TODO 没提问"], { start: 0, end: 0 })), "");
});

test("选项：从「A 还是 B」里抽出两个可点选项，问不出就是空", () => {
  assert.deepEqual(suggestOptions("版本号用 1.9.6 还是 2.0.0？"), ["1.9.6", "2.0.0"]);
  assert.deepEqual(suggestOptions("用 Claude 还是 Codex"), ["Claude", "Codex"]);
  assert.deepEqual(suggestOptions("要不要现在发版？"), ["Yes", "No"].map((x) => (x === "Yes" ? "是" : "否")).sort((a, b) => (a === "是" ? -1 : 1)).length ? suggestOptions("要不要现在发版？") : []);
  assert.ok(suggestOptions("要不要现在发版？").length >= 2, "是否类问题给是与否");
  assert.deepEqual(suggestOptions("随便写点什么"), []);
});

test("块号：❓ 行补 ^ad-q-…（幂等、稳定），回答行拿到由它派生的 ^ad-a-…", () => {
  const seed = "笔记.md|ad-task|A 还是 B？";
  const qid = makeQuestionId(seed);
  assert.match(qid, /^ad-q-[0-9a-f]{8}$/);

  const base = ["- DOING 任务 ^ad-task", "  - ❓ 第1轮：A 还是 B？"];
  const withQ = ensureQuestionId(base.join("\n"), { blockId: "ad-task", questionText: "A 还是 B？", seed });
  assert.ok(withQ.includes(`- ❓ 第1轮：A 还是 B？ ^${qid}`), "问句补上块号");
  assert.equal(ensureQuestionId(withQ, { blockId: "ad-task", questionText: "A 还是 B？", seed }), withQ, "幂等");

  const answered = fillAnswer(withQ, { questionId: qid, answer: "A" });
  assert.ok(answered.includes(`  - ✍️ 答：A ^${answerIdOf(qid)}`), "回答行带派生块号");
  // 改答案不换块号：别处的转引不断
  const updated = fillAnswer(answered, { questionId: qid, answer: "B" });
  assert.ok(updated.includes(`  - ✍️ 答：B ^${answerIdOf(qid)}`));
  assert.equal(updated.split("✍️").length - 1, 1, "还是一条回答");
});

test("块号：按 ^ad-q-… 定位，不依赖正文；回灌文本里不带块号", () => {
  const seed = "笔记.md|ad-task|A 还是 B？";
  const qid = makeQuestionId(seed);
  const note = ["- DOING 任务 ^ad-task", `  - ❓ 第1轮：A 还是 B？ ^${qid}`, "  - 💬 上一轮"].join("\n");
  const lines = note.split("\n");
  assert.equal(locateQuestion(lines, { questionId: qid }), 1);
  assert.equal(locateQuestion(lines, { questionText: "A 还是 B？" }), 1);

  const parsed = parseThread(lines, { start: 0, end: 2 });
  assert.equal(parsed.questions[0].id, qid, "解析出问句块号");

  const answered = fillAnswer(note, { questionId: qid, answer: "A" });
  const text = replyPromptText(parseThread(answered.split("\n"), { start: 0, end: 3 }));
  assert.match(text, /问「A 还是 B？」→ 答「A」/);
  assert.ok(!text.includes("^ad-"), "注入的问答段落不带块号");
});

test("老数据兼容：一次补给已有问答补块号，幂等，且不碰同级的下一块", () => {
  const note = [
    "- DOING 甲 ^ad-a",
    "  - ❓ 第1轮：分支？",
    "  - ✍️ 答：main",
    "  - ❓ 第2轮：要 tag 吗？",
    "- TODO 乙 ^ad-b",
    "  - ❓ 第1轮：别人家的提问？",
  ].join("\n");
  const once = anchorThreadText(note, { blockId: "ad-a", seedPrefix: "笔记.md" });
  const lines = once.split("\n");
  assert.match(lines[1], /\^ad-q-[0-9a-f]{8}$/, "问句补块号");
  assert.match(lines[2], /\^ad-a-[0-9a-f]{8}$/, "回答补块号");
  assert.match(lines[3], /\^ad-q-[0-9a-f]{8}$/);
  assert.ok(!lines[5].includes("^ad-q-"), "同级的下一块不动");
  assert.equal(anchorThreadText(once, { blockId: "ad-a", seedPrefix: "笔记.md" }), once, "幂等");
});

test("代码块里的 ❓ / ✍️ 只是示例，不算问答（也不该被回灌）", () => {
  const note = [
    "- DOING 任务 ^ad-task",
    "  - ❓ 第1轮：真的问题？",
    "  ```md",
    "  - ❓ 第9轮：示例里的问句",
    "  - ✍️ 答：示例里的答案",
    "  ```",
  ];
  const parsed = parseThread(note, { start: 0, end: 5 });
  assert.equal(parsed.questions.length, 1, "只认代码块外那一问");
  assert.equal(parsed.questions[0].text, "真的问题？");
  assert.equal(pendingQuestion(parsed).round, 1);
  const filled = fillAnswer(note.join("\n"), { questionText: "真的问题？", answer: "答了" });
  assert.ok(filled.includes("答：答了"));
  assert.ok(!filled.includes("示例里的答案 ^ad-a-"), "代码块里的示例行不被改写");
});
