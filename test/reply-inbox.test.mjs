import test from "node:test";
import assert from "node:assert/strict";
import { inboxAdd, inboxRemove, inboxKey, inboxSorted, stillPending } from "../src/reply-inbox.js";

const item = (path, question, extra = {}) => ({ path, question, blockId: "ad-x", questionId: "ad-q-11111111", ...extra });

test("入箱：同一问只留一条，新的在前；缺 path 或 question 的忽略", () => {
  let list = [];
  list = inboxAdd(list, item("a.md", "A 还是 B？", { at: 1 }));
  list = inboxAdd(list, item("a.md", "A 还是 B？", { at: 2 }));
  assert.equal(list.length, 1, "同一问去重");
  assert.equal(list[0].at, 2, "时间更新");
  list = inboxAdd(list, item("b.md", "要不要发？", { at: 3 }));
  assert.deepEqual(inboxSorted(list).map((x) => x.path), ["b.md", "a.md"], "新的在前");
  assert.equal(inboxAdd(list, { question: "没有 path" }).length, 2);
  assert.equal(inboxAdd(list, { path: "c.md" }).length, 2);
});

test("出箱：按 path + 问题号删，不误删同笔记的其它问题", () => {
  const list = [item("a.md", "Q1", { questionId: "ad-q-1" }), item("a.md", "Q2", { questionId: "ad-q-2" })];
  const left = inboxRemove(list, { path: "a.md", questionId: "ad-q-1", question: "Q1" });
  assert.equal(left.length, 1);
  assert.equal(left[0].question, "Q2");
  assert.equal(inboxKey(left[0]), "a.md#ad-q-2");
});

test("核对：问答还在就留，答过 / 删了就清", () => {
  const note = [
    "- DOING 任务 ^ad-x",
    "  - ❓ 第1轮：用 npm 还是 pnpm？ ^ad-q-11111111",
  ].join("\n");
  assert.equal(stillPending(note, item("a.md", "用 npm 还是 pnpm？")), true);

  const answered = [...note.split("\n"), "  - ✍️ 答：npm ^ad-a-22222222"].join("\n");
  assert.equal(stillPending(answered, item("a.md", "用 npm 还是 pnpm？")), false, "答过了");

  const other = ["- DOING 任务 ^ad-x", "  - ❓ 第1轮：别的问？ ^ad-q-33333333"].join("\n");
  assert.equal(stillPending(other, item("a.md", "用 npm 还是 pnpm？")), false, "问题号对不上");

  assert.equal(stillPending("", item("a.md", "x")), false, "空笔记");
});
