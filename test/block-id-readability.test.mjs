import test from "node:test";
import assert from "node:assert/strict";
import { makeBlockId, readableSlug, isDeckBlockId, normalizeTaskSlug } from "../src/journal.js";

test("块号里的人读提示：英文标题给语义词，中文标题给日期", () => {
  assert.equal(readableSlug("journal cleanup"), "journal-cleanup");
  assert.equal(normalizeTaskSlug("重构看板"), "", "中文无法直接做 slug");
  assert.match(readableSlug("重构看板", Date.parse("2026-11-18T12:00:00Z")), /^d\d{4}$/);
  assert.equal(readableSlug("重构看板", Date.parse("2026-11-18T12:00:00+08:00")), "d1118");
});

test("生成的块号仍能被识别为内部块号（会被隐藏和剥除），但前缀可读", () => {
  const zh = makeBlockId("", "ad", readableSlug("重构看板"));
  const en = makeBlockId("", "ad", readableSlug("journal cleanup"));
  assert.match(zh, /^ad-d\d{4}-[a-z0-9]{10}$/);
  assert.match(en, /^ad-journal-cleanup-[a-z0-9]{10}$/);
  assert.ok(isDeckBlockId(zh) && isDeckBlockId(en), "仍然是内部标识，注入时会被剥掉");
  assert.notEqual(zh, makeBlockId("", "ad", readableSlug("重构看板")), "唯一性不变");
});
