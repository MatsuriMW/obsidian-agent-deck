// 记录右键菜单的纯逻辑：置顶分区、母任务定位、复制与删除范围。
import test from "node:test";
import assert from "node:assert/strict";

import {
  RECORD_MENU_SECTION,
  createRecordMenuSection,
  parentTimelineLine,
  recordCopyText,
  recordDeleteRange,
} from "../src/record-menu.js";

const lines = [
  "- DOING 03:59-04:36 **agent-deck -> 修千问** ^dsh-0sutfssgux",
  "\t- 💬 第13轮：任务：提取信息增量；结论：已写入 2026_11_18.md。 <!-- ad-turn:0sutfssgux:13 -->",
  "\t\t- ⏱ 03:59–04:36 · 共 37m · 27k tok · DSH <!-- ad-clock:abc123 -->",
  "\t- 💬 第12轮：任务：继续说明 compact；结论：各家机制不同。",
  "- TODO 下一件事",
];

test("createRecordMenuSection puts the record section first and keeps it unique", () => {
  const menu = { sections: ["action", "selection"] };
  assert.equal(createRecordMenuSection(menu), true);
  assert.deepEqual(menu.sections, [RECORD_MENU_SECTION, "action", "selection"]);
  // 再调用一次不会重复插入
  assert.equal(createRecordMenuSection(menu), true);
  assert.deepEqual(menu.sections, [RECORD_MENU_SECTION, "action", "selection"]);
  // 不在第一位时会被移到第一位
  const again = { sections: ["action", RECORD_MENU_SECTION, "selection"] };
  createRecordMenuSection(again);
  assert.deepEqual(again.sections, [RECORD_MENU_SECTION, "action", "selection"]);
});

test("createRecordMenuSection degrades when the Menu API has no sections array", () => {
  assert.equal(createRecordMenuSection({}), false);
  assert.equal(createRecordMenuSection({ sections: null }), false);
});

test("parentTimelineLine finds the owning task line, not the nested clock line", () => {
  assert.equal(parentTimelineLine(lines, 1), 0);
  assert.equal(parentTimelineLine(lines, 2), 1);
  assert.equal(parentTimelineLine(lines, 0), -1);
});

test("recordCopyText strips the bullet and hidden turn marker, and can keep only the result", () => {
  const record = "  - 💬 第13轮：任务：提取信息增量；结论：已写入 2026_11_18.md。 <!-- ad-turn:0sutfssgux:13 -->";
  assert.equal(recordCopyText(record), "💬 第13轮：任务：提取信息增量；结论：已写入 2026_11_18.md。");
  assert.equal(recordCopyText(record, "conclusion"), "已写入 2026_11_18.md。");
  assert.equal(recordCopyText("💬 没有结论标记", "conclusion"), "💬 没有结论标记");
});

test("recordDeleteRange removes a record with its children but stops at the next sibling", () => {
  const range = recordDeleteRange(lines, 1);
  assert.deepEqual(range, { from: { line: 1, ch: 0 }, to: { line: 3, ch: 0 } });
  // 最后一行没有后继时删到行尾
  const tail = recordDeleteRange(["  - 💬 第一轮", "  - 💬 第二轮"], 1);
  assert.deepEqual(tail, { from: { line: 1, ch: 0 }, to: { line: 1, ch: "  - 💬 第二轮".length } });
  assert.deepEqual(recordDeleteRange(lines, 0)?.to, { line: 4, ch: 0 });
});

test("recordDeleteRange ignores non-list lines", () => {
  assert.equal(recordDeleteRange(["普通段落", "- 💬 记录"], 0), null);
  assert.equal(recordDeleteRange(undefined, 0), null);
});
