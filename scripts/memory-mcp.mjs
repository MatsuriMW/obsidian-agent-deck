#!/usr/bin/env node
// Agent Deck Dream Memory — 零依赖本地 stdio MCP Server。
// 支持 newline-delimited JSON 与 Content-Length 两种 MCP 传输帧，直接复用 ./memory-query.mjs。
//
//   node memory-mcp.mjs [--vault /path/to/vault] [--allow-write]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMemories,
  countArchivedMemories,
  searchMemories,
  recentMemories,
  findMemory,
  formatEntry,
  formatRead,
  formatIndex,
  formatStats,
  buildIndexes,
  neighborsOf,
  graphOf,
  formatGraph,
  inDateRange,
  DATE_RE,
  resolveVault,
  proposeMemory,
} from "./memory-query.mjs";

export const ASSET_VERSION = 5;

const BASE_TOOLS = [
  {
    name: "memory_index",
    description: "浏览 Agent Deck 长期记忆目录概览：按类型与项目统计分布，并列出近期/已确认记忆标题。开始任务前调用可快速了解有哪些跨会话记忆可查。",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"], description: "按记忆类型过滤" },
        project: { type: "string", description: "按项目名过滤" },
        limit: { type: "integer", minimum: 1, maximum: 60, description: "最多返回条数，默认 30" },
      },
    },
  },
  {
    name: "memory_search",
    description: "按关键词检索 Agent Deck 长期记忆（支持中英文混合词如 A股、技术词、项目名、时间窗），返回匹配原因、来源日记块号与取代链。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或短语" },
        k: { type: "integer", minimum: 1, maximum: 20, description: "返回条数上限，默认 5" },
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
        project: { type: "string", description: "限定项目名" },
        since: { type: "string", description: "起始日期 YYYY-MM-DD" },
        until: { type: "string", description: "结束日期 YYYY-MM-DD" },
        verified_only: { type: "boolean", description: "只看已人工确认的记忆" },
        trust: { type: "string", enum: ["human", "user", "ai"], description: "按可信度过滤（human=已人工确认 / user=用户日志 / ai=AI提炼）" },
        include_stale: { type: "boolean", description: "包含已过复核截止期的记忆" },
        include_inactive: { type: "boolean", description: "包含已被替代的历史条目" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description: "读取单条长期记忆的完整正文、来源日记链接、取代链与标签（只读，private 记忆不可见）。",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "记忆文件名（不含路径）或记忆 id（m-...）" },
      },
      required: ["ref"],
    },
  },
  {
    name: "memory_recent",
    description: "按时间倒序列出最近沉淀的长期记忆。",
    inputSchema: {
      type: "object",
      properties: {
        n: { type: "integer", minimum: 1, maximum: 30, description: "返回条数，默认 10" },
        kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
        project: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        verified_only: { type: "boolean" },
        trust: { type: "string", enum: ["human", "user", "ai"], description: "按可信度过滤（human=已人工确认 / user=用户日志 / ai=AI提炼）" },
        include_stale: { type: "boolean", description: "包含已过复核截止期的有效记忆（默认包含）" },
        include_inactive: { type: "boolean", description: "包含已被替代/已归档的历史条目" },
      },
    },
  },
  {
    name: "memory_graph",
    description: "沿 Obsidian 图谱边（concepts / project_link / source_notes / supersedes）做 1-2 跳关联漫游。可传记忆名、m-... ID 或概念名（如 Obsidian / 心智模型）。",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "记忆文件名、id（m-...）或概念/项目名" },
        depth: { type: "integer", minimum: 1, maximum: 2, description: "图谱遍历深度，默认 2" },
      },
      required: ["ref"],
    },
  },
];

const PROPOSE_TOOL = {
  name: "memory_propose",
  description: "向 Agent Deck 记忆库提交一条待人工确认的候选记忆（仅当 MCP 服务以 --allow-write 启动时可用）。",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "一句完整精炼的记忆陈述（4-500字）" },
      kind: { type: "string", enum: ["fact", "preference", "pattern", "lesson"] },
      short_title: { type: "string", description: "10-18 字图谱短命题文件名（可选）" },
      project: { type: "string", description: "适用项目名（可选）" },
      project_link: { type: "string", description: "项目双链（如 [[Agent Deck]]）" },
      concepts: { type: "array", items: { type: "string" }, description: "关联概念双链列表（如 [[RAG]]）" },
      tags: { type: "array", items: { type: "string" }, description: "最多 5 个关键词标签" },
      description: { type: "string", description: "简短触发/适用条件说明（OKF description）" },
      domain: { type: "string", description: "领域名，如 engineering / life / finance" },
      source: { type: "string", description: "来源说明或会话引用" },
    },
    required: ["text", "kind"],
  },
};

export function createMcpServer({ vault = "", allowWrite = false } = {}) {
  const resolveRoot = () => {
    const root = vault ? path.resolve(vault) : resolveVault();
    if (!root || !fs.existsSync(root)) throw new Error(`找不到 Obsidian Vault 根目录：${vault || "(未指定)"}`);
    return root;
  };

  const tools = allowWrite ? [...BASE_TOOLS, PROPOSE_TOOL] : [...BASE_TOOLS];

  const handleToolCall = (name, args = {}) => {
    const root = resolveRoot();
    if (name === "memory_propose") {
      if (!allowWrite) return { isError: true, content: [{ type: "text", text: "当前 MCP 服务处于只读模式；如需写入候选记忆请使用 --allow-write 启动。" }] };
      try {
        const res = proposeMemory(root, {
          ...args,
          shortTitle: args.short_title || "",
          projectLink: args.project_link || "",
        });
        const msg = res.rejected
          ? `该记忆曾被人工拒绝（${res.entry.id}），跳过写入。`
          : res.duplicate
            ? `库内已存在相同记忆（${res.entry.id}），跳过写入。`
            : `已写入候选记忆（待用户审阅确认）：${res.path}`;
        return { content: [{ type: "text", text: msg }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message || String(e) }] };
      }
    }

    const includeArchived = (name === "memory_search" || name === "memory_recent") && Boolean(args.include_inactive);
    const { dir, entries } = loadMemories(root, { includeArchived });
    const active = entries.filter((e) => e.state === "有效" && !e.private);
    const indexes = buildIndexes(entries);

    if (name === "memory_index") {
      const text = [
        formatIndex(active, { kind: args.kind || "", project: args.project || "", limit: Number(args.limit) || 30 }),
        "",
        formatStats(entries, { vault: root, archivedCount: countArchivedMemories(root) }),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (name === "memory_read") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "缺少参数 ref" }] };
      let readEntries = entries;
      let hit = findMemory(readEntries, dir, ref);
      if (!hit) {
        readEntries = loadMemories(root, { includeArchived: true }).entries;
        hit = findMemory(readEntries, dir, ref);
      }
      if (!hit) return { isError: true, content: [{ type: "text", text: `找不到记忆：${ref}` }] };
      const readIndexes = buildIndexes(readEntries);
      const extras = {
        supersedes: (hit.supersedes || []).map((id) => readIndexes.resolveRef(id) || id),
        supersededBy: readIndexes.supersededBy.get(hit.id) || readIndexes.supersededBy.get(hit.name) || [],
        neighbors: neighborsOf(active, hit, { vault: root, limit: 2 }),
      };
      const out = [formatRead(hit), formatEntry(hit, [], extras).split("\n").slice(2).join("\n")].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: out }] };
    }

    const since = String(args.since || "");
    const until = String(args.until || "");
    for (const [label, val] of [["since", since], ["until", until]]) {
      if (val && !DATE_RE.test(val)) return { isError: true, content: [{ type: "text", text: `${label} 格式需为 YYYY-MM-DD，收到：${val}` }] };
    }
    const basePool = args.include_inactive
      ? entries.filter((e) => !e.private)
      : active;
    const pool = basePool.filter((e) => inDateRange(e, { since, until }));
    const extrasFor = (entry) => ({
      supersedes: (entry.supersedes || []).map((id) => indexes.resolveRef(id) || id),
      supersededBy: indexes.supersededBy.get(entry.id) || indexes.supersededBy.get(entry.name) || [],
      neighbors: neighborsOf(pool, entry, { vault: root, limit: 2 }),
    });

    if (name === "memory_graph") {
      const ref = String(args.ref || "").trim();
      if (!ref) return { isError: true, content: [{ type: "text", text: "缺少参数 ref" }] };
      const depth = Number(args.depth) === 1 ? 1 : 2;
      return { content: [{ type: "text", text: formatGraph(graphOf(entries, ref, { vault: root, depth })) }] };
    }

    if (name === "memory_search") {
      const query = String(args.query || "").trim();
      if (!query) return { isError: true, content: [{ type: "text", text: "缺少参数 query" }] };
      const hits = searchMemories(pool, query, Number(args.k) || 5, {
        kind: args.kind || "",
        project: args.project || "",
        verifiedOnly: Boolean(args.verified_only),
        includeStale: Boolean(args.include_inactive || args.include_stale),
        trust: args.trust || "",
      });
      if (!hits.length) {
        return { content: [{ type: "text", text: `没有匹配「${query}」的记忆（当前有效记忆 ${pool.length} 条）。` }] };
      }
      const out = hits.map((h, i) => `${i + 1}. ${formatEntry(h.entry, h.why, extrasFor(h.entry))}`).join("\n");
      return { content: [{ type: "text", text: out }] };
    }

    if (name === "memory_recent") {
      const list = recentMemories(pool, Number(args.n) || 10, {
        kind: args.kind || "",
        project: args.project || "",
        verifiedOnly: Boolean(args.verified_only),
        trust: args.trust || "",
        includeStale: args.include_stale !== false || Boolean(args.include_inactive),
      });
      if (!list.length) return { content: [{ type: "text", text: "记忆库当前没有符合条件的条目。" }] };
      return { content: [{ type: "text", text: list.map((e, i) => `${i + 1}. ${formatEntry(e, [], extrasFor(e))}`).join("\n") }] };
    }

    return { isError: true, content: [{ type: "text", text: `未知工具：${name}` }] };
  };

  const handleRequest = (msg) => {
    if (!msg || typeof msg !== "object") return null;
    const { id, method, params = {} } = msg;
    // Notifications without id receive no JSON-RPC response.
    if (id === undefined || id === null) return null;

    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      if (method === "initialize") {
        return ok({
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "agent-deck-memory", version: "1.0.0" },
        });
      }
      if (method === "ping") return ok({});
      if (method === "tools/list") return ok({ tools });
      if (method === "tools/call") return ok(handleToolCall(params?.name, params?.arguments || {}));
      if (method === "resources/list") {
        return ok({
          resources: [
            { uri: "memory://index", name: "Agent Deck 记忆索引", description: "全部有效非私密长期记忆概览", mimeType: "text/plain" },
          ],
        });
      }
      if (method === "resources/read") {
        const uri = String(params?.uri || "");
        if (uri !== "memory://index") return err(-32602, `Unknown resource: ${uri}`);
        const root = resolveRoot();
        const { entries } = loadMemories(root);
        return ok({ contents: [{ uri, mimeType: "text/plain", text: formatIndex(entries) }] });
      }
      return err(-32601, `Method not found: ${method}`);
    } catch (e) {
      return err(-32603, e?.message || String(e));
    }
  };

  return { tools, handleRequest };
}

function parseCliArgs(argv) {
  let vault = "";
  let allowWrite = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") vault = argv[++i] || "";
    else if (a.startsWith("--vault=")) vault = a.slice(8);
    else if (a === "--allow-write") allowWrite = true;
  }
  return { vault, allowWrite };
}

export function startStdioLoop(server, input = process.stdin, output = process.stdout) {
  let buf = Buffer.alloc(0);
  let frameMode = "auto"; // "lsp" (Content-Length) | "jsonl"

  const send = (payload) => {
    if (!payload) return;
    const json = JSON.stringify(payload);
    if (frameMode === "lsp") {
      const body = Buffer.from(json, "utf8");
      output.write(`Content-Length: ${body.length}\r\n\r\n`);
      output.write(body);
    } else {
      output.write(json + "\n");
    }
  };

  const pump = () => {
    for (;;) {
      if (!buf.length) return;
      const headStr = buf.subarray(0, Math.min(buf.length, 128)).toString("utf8");
      if (/^Content-Length:\s*\d+/i.test(headStr)) {
        frameMode = "lsp";
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) return;
        const header = buf.subarray(0, sep).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) { buf = buf.subarray(sep + 4); continue; }
        const len = Number(m[1]);
        const bodyStart = sep + 4;
        if (buf.length < bodyStart + len) return;
        const raw = buf.subarray(bodyStart, bodyStart + len).toString("utf8");
        buf = buf.subarray(bodyStart + len);
        try {
          const res = server.handleRequest(JSON.parse(raw));
          if (res) send(res);
        } catch (e) {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e?.message || "Parse error" } });
        }
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      if (frameMode === "auto") frameMode = "jsonl";
      const line = buf.subarray(0, nl).toString("utf8").trim();
      buf = buf.subarray(nl + 1);
      if (!line) continue;
      try {
        const res = server.handleRequest(JSON.parse(line));
        if (res) send(res);
      } catch (e) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e?.message || "Parse error" } });
      }
    }
  };

  input.on("data", (chunk) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
    pump();
  });
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const real = (p) => {
      let s;
      try { s = (fs.realpathSync.native || fs.realpathSync)(p); } catch { s = path.resolve(p); }
      s = s.replace(/^(?:\\\\\?\\|\/\/\?\/)/, "").replace(/\\/g, "/");
      return process.platform === "win32" ? s.toLowerCase() : s;
    };
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2));
  const server = createMcpServer(opts);
  startStdioLoop(server);
}
