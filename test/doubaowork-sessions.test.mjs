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

test("parseDoubaoWorkBuffer decodes V8 double timestamps and discoverDoubaoWorkConversations finds Windows User Data & multi-profile IndexedDB", () => {
  const numBuf = Buffer.alloc(9);
  numBuf[0] = 0x4e; // V8 double tag 'N'
  numBuf.writeDoubleLE(1795430000000, 1);
  const v8NumRecord = Buffer.concat([
    Buffer.from("conversation_id", "ascii"),
    v8OneByte("777888999000111"),
    Buffer.from("title", "ascii"),
    v8TwoByte("Windows 数值时间戳会话"),
    Buffer.from("updated_at", "ascii"),
    numBuf,
  ]);
  const parsed = parseDoubaoWorkBuffer(v8NumRecord);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "777888999000111");
  assert.equal(parsed[0].title, "Windows 数值时间戳会话");
  assert.equal(parsed[0].lastAt, 1795430000000);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-doubao-win-"));
  try {
    const localAppData = path.join(tmp, "Local");
    const appData = path.join(tmp, "Roaming");
    // Even if empty Roaming\DoubaoWork exists, discovery finds Local\DoubaoWork\User Data\Profile 1\IndexedDB
    fs.mkdirSync(path.join(appData, "DoubaoWork"), { recursive: true });
    const idbDir = path.join(localAppData, "DoubaoWork", "User Data", "Profile 1", "IndexedDB", "chrome_doubaowork-chat_0.indexeddb.leveldb");
    fs.mkdirSync(idbDir, { recursive: true });
    fs.writeFileSync(path.join(idbDir, "000003.log"), v8NumRecord);

    const res = discoverDoubaoWorkConversations({
      homeDir: tmp,
      platform: "win32",
      env: { APPDATA: appData, LOCALAPPDATA: localAppData },
    });
    assert.equal(res.conversations.length, 1);
    assert.equal(res.conversations[0].id, "777888999000111");

    // Multi-profile: Default also exists with a different conversation; Profile 1's conversation must resolve via its own dir#sid key
    const defaultIdbDir = path.join(localAppData, "DoubaoWork", "User Data", "Default", "IndexedDB", "chrome_doubaowork-chat_0.indexeddb.leveldb");
    fs.mkdirSync(defaultIdbDir, { recursive: true });
    fs.writeFileSync(
      path.join(defaultIdbDir, "000003.log"),
      makeRecord({ id: "111222333444555", name: "Default Profile 会话", twoByte: true, createSec: 1795420000, updateSec: 1795420500 }),
    );
    const multiRes = discoverDoubaoWorkConversations({
      homeDir: tmp,
      platform: "win32",
      env: { APPDATA: appData, LOCALAPPDATA: localAppData },
    });
    assert.equal(multiRes.conversations.length, 2);
    const prof1Conv = multiRes.conversations.find((c) => c.id === "777888999000111");
    assert.ok(prof1Conv?.filePath);
    const convKey = `${path.dirname(prof1Conv.filePath)}#${prof1Conv.id}`;
    const built = buildDoubaoWorkConversation(convKey);
    assert.equal(built.length, 1);
    assert.match(built[0].text, /Windows 数值时间戳会话/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
