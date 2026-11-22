// DoubaoWork (豆包工作, com.work.pc.doubao) read-only local session tracker.
//
// Reads conversation list metadata from Chromium IndexedDB LevelDB:
//   ~/Library/Application Support/DoubaoWork/Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb
// Supports uncompressed LevelDB `.log` WAL files and Snappy-compressed `.ldb`
// SSTable blocks without external native dependencies.
//
// Honest boundary: full message bodies live in DoubaoWork's SQLCipher-encrypted
// `sdk_storage/<uid>/messages.db` and are never decrypted or accessed. Token
// counts and model names are not present in local metadata and remain 0/unset.

import fs from "fs";
import path from "path";
import os from "os";

const expandHome = (p, homeDir) => String(p || "").replace(/^~(?=\/)/, homeDir);

export function doubaoWorkDataDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (env?.DOUBAOWORK_DATA_DIR) return expandHome(env.DOUBAOWORK_DATA_DIR, homeDir);
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support", "DoubaoWork");
  if (platform === "win32") {
    const appData = env?.APPDATA || path.join(homeDir, "AppData", "Roaming");
    const localAppData = env?.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    const roaming = path.join(appData, "DoubaoWork");
    if (fs.existsSync(roaming)) return roaming;
    return path.join(localAppData, "DoubaoWork");
  }
  return path.join(env?.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "DoubaoWork");
}

export function doubaoWorkIndexedDbDir(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  const base = doubaoWorkDataDir(homeDir, platform, env);
  if (!base) return "";
  return path.join(base, "Default", "IndexedDB", "chrome_doubaowork-chat_0.indexeddb.leveldb");
}

// Pure-JS Snappy block decompressor for LevelDB `.ldb` SSTable blocks.
export function snappyUncompress(src) {
  if (!Buffer.isBuffer(src) || src.length < 2) return null;
  let pos = 0;
  let uncompLen = 0;
  let shift = 0;
  while (pos < src.length) {
    const b = src[pos++];
    uncompLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) return null;
  }
  if (uncompLen <= 0 || uncompLen > 32 * 1024 * 1024) return null;
  const out = Buffer.allocUnsafe(uncompLen);
  let outPos = 0;

  while (pos < src.length && outPos < uncompLen) {
    const tag = src[pos++];
    const type = tag & 0x03;
    if (type === 0) {
      let len = tag >>> 2;
      if (len >= 60) {
        const extra = len - 59;
        if (pos + extra > src.length) return null;
        len = 0;
        for (let i = 0; i < extra; i++) len |= src[pos++] << (8 * i);
      }
      len += 1;
      if (pos + len > src.length || outPos + len > uncompLen) return null;
      src.copy(out, outPos, pos, pos + len);
      pos += len;
      outPos += len;
    } else {
      let len = 0;
      let offset = 0;
      if (type === 1) {
        if (pos >= src.length) return null;
        len = ((tag >>> 2) & 0x07) + 4;
        offset = ((tag & 0xe0) << 3) | src[pos++];
      } else if (type === 2) {
        if (pos + 2 > src.length) return null;
        len = (tag >>> 2) + 1;
        offset = src[pos] | (src[pos + 1] << 8);
        pos += 2;
      } else {
        if (pos + 4 > src.length) return null;
        len = (tag >>> 2) + 1;
        offset = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0;
        pos += 4;
      }
      if (offset === 0 || offset > outPos || outPos + len > uncompLen) return null;
      for (let i = 0; i < len; i++) {
        out[outPos] = out[outPos - offset];
        outPos++;
      }
    }
  }
  return outPos === uncompLen ? out : null;
}

function readVarint(buf, offset) {
  let val = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length && shift <= 28) {
    const b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { val, next: pos };
    shift += 7;
  }
  return null;
}

// Read a V8 Structured Clone string value immediately following a property key:
// `"` (0x22) = OneByteString (Latin-1/ASCII), `c` (0x63) = TwoByteString (UTF-16LE).
function readV8String(buf, pos) {
  if (pos >= buf.length) return null;
  const tag = buf[pos];
  if (tag !== 0x22 && tag !== 0x63) return null;
  const lenInfo = readVarint(buf, pos + 1);
  if (!lenInfo) return null;
  const { val: byteLen, next } = lenInfo;
  if (byteLen < 0 || byteLen > 4096 || next + byteLen > buf.length) return null;
  const slice = buf.subarray(next, next + byteLen);
  const text = tag === 0x63
    ? slice.toString("utf16le")
    : slice.toString("utf8");
  return { text, next: next + byteLen };
}

function readFieldString(buf, start, end, keyName) {
  const needle = Buffer.from(keyName, "ascii");
  const idx = buf.indexOf(needle, start);
  if (idx === -1 || idx + needle.length >= end) return "";
  const val = readV8String(buf, idx + needle.length);
  return val ? val.text : "";
}

function parseUnixSec(str) {
  if (!/^\d{9,13}$/.test(String(str || "").trim())) return 0;
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

// Extract DoubaoWork conversation records from raw LevelDB / V8 serialized bytes.
export function parseDoubaoWorkBuffer(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return [];
  const marker = Buffer.from("conversation_id", "ascii");
  const map = new Map();
  let pos = 0;

  while (pos < buf.length) {
    const idx = buf.indexOf(marker, pos);
    if (idx === -1) break;
    pos = idx + marker.length;

    const idRes = readV8String(buf, pos);
    if (!idRes) continue;
    const id = idRes.text.trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) continue;

    // Next conversation_id or 4096-byte window bounds this record.
    const nextIdx = buf.indexOf(marker, idRes.next);
    const end = nextIdx !== -1 && nextIdx - idRes.next < 4096
      ? nextIdx
      : Math.min(buf.length, idRes.next + 4096);

    const title = readFieldString(buf, idRes.next, end, "name").replace(/\s+/g, " ").trim();
    const botId = readFieldString(buf, idRes.next, end, "bot_id").trim();
    const createMs = parseUnixSec(readFieldString(buf, idRes.next, end, "create_time"));
    const updateMs = parseUnixSec(readFieldString(buf, idRes.next, end, "update_time"));
    const projectId = readFieldString(buf, idRes.next, end, "project_id").trim();

    if (!createMs && !updateMs) continue;
    const startedAt = createMs || updateMs;
    const lastAt = Math.max(startedAt, updateMs || startedAt);

    const prev = map.get(id);
    if (!prev || lastAt > prev.lastAt || (lastAt === prev.lastAt && title && !prev.title)) {
      map.set(id, {
        id,
        title: title || prev?.title || "豆包工作",
        hasClientTitle: Boolean(title && title !== "新对话" && title !== "豆包"),
        botId: botId || prev?.botId || "",
        projectId: projectId || prev?.projectId || "",
        startedAt: prev ? Math.min(prev.startedAt, startedAt) : startedAt,
        lastAt,
      });
    }
  }

  return [...map.values()].sort((a, b) => (b.lastAt - a.lastAt) || a.id.localeCompare(b.id));
}

// Extract uncompressed + Snappy-decompressed blocks from a LevelDB `.ldb` SSTable.
function extractLdbBuffers(buf) {
  const out = [buf];
  // LevelDB footer is the last 48 bytes; magic number is 0xdb4775248b80fb57 (LE).
  if (buf.length < 48) return out;
  const magicLo = buf.readUInt32LE(buf.length - 8);
  const magicHi = buf.readUInt32LE(buf.length - 4);
  if (magicLo !== 0x8b80fb57 || magicHi !== 0xdb477524) return out;

  // Read index_handle (second varint pair in footer).
  const metaOff = readVarint(buf, buf.length - 48);
  if (!metaOff) return out;
  const metaSize = readVarint(buf, metaOff.next);
  if (!metaSize) return out;
  const idxOff = readVarint(buf, metaSize.next);
  if (!idxOff) return out;
  const idxSize = readVarint(buf, idxOff.next);
  if (!idxSize) return out;

  const readBlock = (offset, size) => {
    if (offset < 0 || size <= 0 || offset + size + 1 > buf.length) return null;
    const type = buf[offset + size];
    const payload = buf.subarray(offset, offset + size);
    if (type === 0) return payload;
    if (type === 1) return snappyUncompress(payload);
    return null;
  };

  const indexBlock = readBlock(idxOff.val, idxSize.val);
  if (!indexBlock || indexBlock.length < 4) return out;
  const numRestarts = indexBlock.readUInt32LE(indexBlock.length - 4);
  const limit = indexBlock.length - 4 - numRestarts * 4;
  if (limit <= 0) return out;

  let p = 0;
  while (p < limit) {
    const shared = readVarint(indexBlock, p);
    if (!shared) break;
    const nonShared = readVarint(indexBlock, shared.next);
    if (!nonShared) break;
    const valLen = readVarint(indexBlock, nonShared.next);
    if (!valLen) break;
    const valStart = valLen.next + nonShared.val;
    const valEnd = valStart + valLen.val;
    if (valEnd > limit) break;
    const bOff = readVarint(indexBlock, valStart);
    const bSize = bOff ? readVarint(indexBlock, bOff.next) : null;
    if (bOff && bSize && bOff.val + bSize.val < buf.length) {
      const dataBlock = readBlock(bOff.val, bSize.val);
      if (dataBlock) out.push(dataBlock);
    }
    p = valEnd;
  }
  return out;
}

export function discoverDoubaoWorkConversations(opts = {}) {
  const idbDir = opts.indexedDbDir || doubaoWorkIndexedDbDir(opts.homeDir, opts.platform, opts.env);
  if (!idbDir) return { indexedDbDir: "", conversations: [], mtimeMs: 0, size: 0 };

  let names;
  try {
    names = fs.readdirSync(idbDir);
  } catch {
    return { indexedDbDir: idbDir, conversations: [], mtimeMs: 0, size: 0 };
  }

  const dataFiles = names
    .filter((n) => n.endsWith(".log") || n.endsWith(".ldb"))
    .sort();
  if (!dataFiles.length) return { indexedDbDir: idbDir, conversations: [], mtimeMs: 0, size: 0 };

  const merged = new Map();
  let maxMtime = 0;
  let totalSize = 0;

  for (const name of dataFiles) {
    const filePath = path.join(idbDir, name);
    let st;
    try { st = fs.statSync(filePath); } catch { continue; }
    if (st.size <= 0 || st.size > 64 * 1024 * 1024) continue;
    totalSize += st.size;
    if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;

    let raw;
    try { raw = fs.readFileSync(filePath); } catch { continue; }
    const buffers = name.endsWith(".ldb") ? extractLdbBuffers(raw) : [raw];
    for (const buf of buffers) {
      for (const conv of parseDoubaoWorkBuffer(buf)) {
        const prev = merged.get(conv.id);
        if (!prev || conv.lastAt > prev.lastAt || (conv.lastAt === prev.lastAt && conv.title && !prev.title)) {
          merged.set(conv.id, {
            ...conv,
            startedAt: prev ? Math.min(prev.startedAt, conv.startedAt) : conv.startedAt,
            filePath,
          });
        }
      }
    }
  }

  const conversations = [...merged.values()].sort((a, b) => (b.lastAt - a.lastAt) || a.id.localeCompare(b.id));
  return { indexedDbDir: idbDir, conversations, mtimeMs: maxMtime, size: totalSize };
}

export function buildDoubaoWorkConversation(source) {
  const [dirOrFile, sid] = String(source || "").split("#");
  if (!dirOrFile || !sid) return [];
  const indexedDbDir = fs.existsSync(dirOrFile) && fs.statSync(dirOrFile).isDirectory()
    ? dirOrFile
    : path.dirname(dirOrFile);
  const { conversations } = discoverDoubaoWorkConversations({ indexedDbDir });
  const conv = conversations.find((c) => c.id === sid);
  if (!conv) return [];
  const lines = [
    `会话标题：${conv.title}`,
    `会话 ID：${conv.id}`,
    "说明：豆包工作本地仅明文缓存会话列表元数据，完整对话正文存储在加密数据库（sdk_storage）中，Agent Deck 保持只读边界，不解密本地加密库。",
  ];
  return [{ role: "assistant", at: conv.lastAt || conv.startedAt, text: lines.join("\n") }];
}
