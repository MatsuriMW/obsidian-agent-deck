import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseDoubaoWorkBuffer,
  snappyUncompress,
  discoverDoubaoWorkConversations,
  buildDoubaoWorkConversation,
} from "../src/doubaowork-sessions.js";

function v8OneByte(str) {
  const b = Buffer.from(str, "utf8");
  return Buffer.concat([Buffer.from([0x22, b.length]), b]);
}

function v8TwoByte(str) {
  const b = Buffer.from(str, "utf16le");
  return Buffer.concat([Buffer.from([0x63, b.length]), b]);
}

function makeRecord({ id, name, twoByte = false, botId = "7338286299411103781", createSec, updateSec }) {
  return Buffer.concat([
    Buffer.from("conversation_id", "ascii"),
    v8OneByte(id),
    Buffer.from("name", "ascii"),
    twoByte ? v8TwoByte(name) : v8OneByte(name),
    Buffer.from("bot_id", "ascii"),
    v8OneByte(botId),
    Buffer.from("create_time", "ascii"),
    v8OneByte(String(createSec)),
    Buffer.from("update_time", "ascii"),
    v8OneByte(String(updateSec)),
  ]);
}

test("parseDoubaoWorkBuffer decodes OneByte and TwoByte UTF-16LE titles and deduplicates", () => {
  const buf = Buffer.concat([
    Buffer.from("conversation-list-data-overall-v2", "ascii"),
    makeRecord({ id: "549356406166274", name: "Greeting and Asking About Day", createSec: 1734640810, updateSec: 1734641093 }),
    makeRecord({ id: "549105065905666", name: "周报总结与排期", twoByte: true, createSec: 1734641690, updateSec: 1734642000 }),
    // Newer update for the same id should win
    makeRecord({ id: "549105065905666", name: "周报总结与排期（更新）", twoByte: true, createSec: 1734641690, updateSec: 1734643000 }),
  ]);

  const list = parseDoubaoWorkBuffer(buf);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "549105065905666");
  assert.equal(list[0].title, "周报总结与排期（更新）");
  assert.equal(list[0].hasClientTitle, true);
  assert.equal(list[0].startedAt, 1734641690000);
  assert.equal(list[0].lastAt, 1734643000000);

  assert.equal(list[1].id, "549356406166274");
  assert.equal(list[1].title, "Greeting and Asking About Day");
});

test("snappyUncompress decompresses literal + copy-1 blocks", () => {
  // Uncompressed string: "abcdabcd" (len = 8)
  // varint(8) = 0x08
  // literal len=4: tag = ((4-1) << 2) | 0 = 0x0c, followed by "abcd"
  // copy-1 len=4, offset=4: tag = ((4-4) << 2) | 1 = 0x01, next byte = 0x04
  const compressed = Buffer.from([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x04]);
  const out = snappyUncompress(compressed);
  assert.ok(out);
  assert.equal(out.toString("ascii"), "abcdabcd");
});

test("discoverDoubaoWorkConversations and buildDoubaoWorkConversation read from IndexedDB dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-doubao-"));
  try {
    const idbDir = path.join(tmp, "chrome_doubaowork-chat_0.indexeddb.leveldb");
    fs.mkdirSync(idbDir, { recursive: true });
    fs.writeFileSync(
      path.join(idbDir, "000003.log"),
      makeRecord({ id: "987654321098765", name: "产品需求评审", twoByte: true, createSec: 1795360000, updateSec: 1795360600 }),
    );

    const res = discoverDoubaoWorkConversations({ indexedDbDir: idbDir });
    assert.equal(res.conversations.length, 1);
    assert.equal(res.conversations[0].title, "产品需求评审");

    const conv = buildDoubaoWorkConversation(`${idbDir}#987654321098765`);
    assert.equal(conv.length, 1);
    assert.match(conv[0].text, /产品需求评审/);
    assert.match(conv[0].text, /sdk_storage/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
