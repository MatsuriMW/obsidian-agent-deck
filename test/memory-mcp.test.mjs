import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createMcpServer } from "../scripts/memory-mcp.mjs";

const MCP_SCRIPT = path.join(import.meta.dirname, "..", "scripts", "memory-mcp.mjs");

function makeTestVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mcp-"));
  fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"),
    JSON.stringify({
      dream: { dir: "Agent Deck/记忆" },
      delegate: { excludedDirs: ["私密"] },
    }),
  );
  const memDir = path.join(vault, "Agent Deck", "记忆");
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(
    path.join(memDir, "2026-11-20-stock.md"),
    [
      "---",
      "id: m-stock",
      'title: "用户在 A 股投资中不买红利股与国内消费板块，认为科技才是长期方向"',
      "kind: preference",
      "type: 偏好",
      "state: 有效",
      "verified: true",
      "date: 2026-11-20",
      "sources:",
      '  - "[[日记/2026_11_20#^mem-11223344]]"',
      "---",
      "",
      "用户在 A 股投资中不买红利股与国内消费板块，认为科技才是长期方向",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(memDir, "2026-11-21-deck.md"),
    [
      "---",
      "id: m-deck",
      'title: "Agent Deck 打包构建时必须保留 obsidian 为 external 依赖"',
      "kind: lesson",
      "type: 项目经验",
      "project: agent-deck",
      "tags:",
      '  - "esbuild"',
      '  - "打包"',
      "state: 有效",
      "date: 2026-11-21",
      "---",
      "",
      "Agent Deck 打包构建时必须保留 obsidian 为 external 依赖",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(memDir, "2026-11-22-secret.md"),
    [
      "---",
      "id: m-secret",
      'title: "秘密 API Key sk-secret"',
      "kind: fact",
      "state: 有效",
      "private: true",
      "date: 2026-11-22",
      "---",
      "",
      "秘密 API Key sk-secret",
      "",
    ].join("\n"),
  );
  return vault;
}

function sendJsonlStdio(scriptArgs, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP_SCRIPT, ...scriptArgs], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const responses = [];
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
      const lines = out.split("\n");
      out = lines.pop();
      for (const line of lines) if (line.trim()) responses.push(JSON.parse(line));
      if (responses.length >= messages.filter((m) => m.id != null).length) child.kill();
    });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", reject);
    child.on("close", () => resolve({ responses, err }));
    for (const msg of messages) child.stdin.write(JSON.stringify(msg) + "\n");
    child.stdin.end();
  });
}

function sendLspStdio(scriptArgs, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP_SCRIPT, ...scriptArgs], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = Buffer.alloc(0);
    const responses = [];
    const expected = messages.filter((m) => m.id != null).length;
    child.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) break;
        const header = buf.subarray(0, sep).toString("utf8");
        const len = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] || 0);
        if (buf.length < sep + 4 + len) break;
        const body = buf.subarray(sep + 4, sep + 4 + len).toString("utf8");
        buf = buf.subarray(sep + 4 + len);
        responses.push(JSON.parse(body));
      }
      if (responses.length >= expected) child.kill();
    });
    child.on("error", reject);
    child.on("close", () => resolve(responses));
    for (const msg of messages) {
      const json = Buffer.from(JSON.stringify(msg), "utf8");
      child.stdin.write(`Content-Length: ${json.length}\r\n\r\n`);
      child.stdin.write(json);
    }
    child.stdin.end();
  });
}

test("memory-mcp: newline JSON stdio 跑通 initialize / tools/list / index / search / read / resources", async () => {
  const vault = makeTestVault();
  try {
    const { responses, err } = await sendJsonlStdio(["--vault", vault], [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory_index", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "memory_search", arguments: { query: "A股 投资偏好" } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "memory_read", arguments: { ref: "2026-11-22-secret" } } },
      { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "memory://index" } },
    ]);
    assert.equal(err, "");
    assert.equal(responses.length, 6);
    assert.equal(responses[0].result.serverInfo.name, "agent-deck-memory");
    assert.deepEqual(responses[1].result.tools.map((t) => t.name), ["memory_index", "memory_search", "memory_read", "memory_recent", "memory_graph"]);
    assert.match(responses[2].result.content[0].text, /共 2 条有效记忆（已确认 1 条）/);
    assert.match(responses[3].result.content[0].text, /A 股投资/);
    assert.equal(responses[4].result.isError, true, "private:true 记忆禁止被 memory_read 读出");
    assert.match(responses[5].result.contents[0].text, /agent-deck/);
    assert.ok(!responses[5].result.contents[0].text.includes("sk-secret"));
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("memory-mcp: Content-Length LSP 帧传输与默认只读拒绝写入", async () => {
  const vault = makeTestVault();
  try {
    const responses = await sendLspStdio(["--vault", vault], [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_search", arguments: { query: "插件打包构建", project: "agent-deck" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory_propose", arguments: { text: "不应在只读模式下写入", kind: "fact" } } },
    ]);
    assert.equal(responses.length, 3);
    assert.match(responses[1].result.content[0].text, /esbuild|obsidian/);
    assert.equal(responses[2].result.isError, true, "未传 --allow-write 时拒绝写入");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("memory-mcp: --allow-write 支持 memory_propose 写入未确认候选并自动去重", async () => {
  const vault = makeTestVault();
  try {
    const srv = createMcpServer({ vault, allowWrite: true });
    assert.ok(srv.tools.some((t) => t.name === "memory_propose"));
    const res1 = srv.handleRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "memory_propose",
        arguments: { text: "MCP 写入的候选经验应在 Obsidian 中审阅确认", kind: "lesson", project: "agent-deck", tags: ["mcp"] },
      },
    });
    assert.equal(res1.result.isError, undefined);
    assert.match(res1.result.content[0].text, /已写入候选记忆/);

    const res2 = srv.handleRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "memory_propose",
        arguments: { text: "MCP 写入的候选经验应在 Obsidian 中审阅确认", kind: "lesson" },
      },
    });
    assert.match(res2.result.content[0].text, /已存在相同记忆/);

    // verify OKF trust/stale filters and log.md exclusion
    fs.writeFileSync(path.join(vault, "Agent Deck/记忆/log.md"), "# 记忆变更日志\n\n## 2026-11-26\n- **Creation**：测试\n");
    fs.writeFileSync(
      path.join(vault, "Agent Deck/记忆/2020-01-01-stale.md"),
      "---\nid: m-stale\ntitle: \"过期的旧打包方案\"\nkind: lesson\nstate: 有效\nstale_after: 2020-01-01\ndate: 2020-01-01\n---\n\n过期的旧打包方案\n",
    );
    const defaultSearch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "memory_search", arguments: { query: "打包方案" } },
    });
    assert.ok(!defaultSearch.result.content[0].text.includes("过期的旧打包方案"));
    const staleSearch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "memory_search", arguments: { query: "打包方案", include_stale: true } },
    });
    assert.match(staleSearch.result.content[0].text, /已过复核期/);
    const idxOut = srv.handleRequest({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "memory_index", arguments: {} } });
    assert.ok(!idxOut.result.content[0].text.includes("记忆变更日志"));

    // verify memory_graph tool & short_title propose
    const propGraph = srv.handleRequest({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "memory_propose",
        arguments: {
          text: "图谱短命名与概念边结合后可直接零向量检索",
          short_title: "图谱零向量检索",
          kind: "lesson",
          project: "agent-deck",
          project_link: "[[Agent Deck]]",
          concepts: ["[[KnowledgeGraph]]"],
        },
      },
    });
    assert.match(propGraph.result.content[0].text, /图谱零向量检索\.md/);
    const gRes = srv.handleRequest({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "memory_graph", arguments: { ref: "KnowledgeGraph" } },
    });
    assert.match(gRes.result.content[0].text, /图谱零向量检索/);

    // verify ASSET_VERSION alignment & archive retrieval
    const { ASSET_VERSION: mcpVer } = await import("../scripts/memory-mcp.mjs");
    const { MEMORY_MCP_ASSET_VERSION } = await import("../src/constants.js");
    assert.equal(mcpVer, MEMORY_MCP_ASSET_VERSION);

    const archDir = path.join(vault, "Agent Deck", "记忆", "archive");
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(
      path.join(archDir, "旧版MCP归档记忆.md"),
      "---\nid: m-mcp-arch\ntitle: \"已归档的旧 MCP 打包方案\"\nkind: lesson\nstate: 已被替代\nstatus: deprecated\ndate: 2025-02-01\n---\n\n已归档的旧 MCP 打包方案\n",
    );
    const idxArch = srv.handleRequest({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "memory_index", arguments: {} } });
    assert.match(idxArch.result.content[0].text, /已归档 1 条/);
    const searchArch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: { name: "memory_search", arguments: { query: "旧 MCP 打包方案", include_inactive: true } },
    });
    assert.match(searchArch.result.content[0].text, /\[已归档\]/);
    const searchStaleArch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "memory_search", arguments: { query: "旧 MCP 打包方案", include_stale: true } },
    });
    assert.doesNotMatch(searchStaleArch.result.content[0].text, /\[已归档\]/, "include_stale 只放行过期有效条，不混入归档历史");

    // memory_propose 写入 ai-derived 与防重复被拒记录
    const aiSearch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "memory_search", arguments: { query: "审阅确认", trust: "ai" } },
    });
    assert.ok(aiSearch.result.content[0].text.includes("MCP 写入的候选经验应在 Obsidian 中审阅确认"), "MCP 写入应归入 ai 可信层级");
    const readArch = srv.handleRequest({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: { name: "memory_read", arguments: { ref: "旧版MCP归档记忆" } },
    });
    assert.match(readArch.result.content[0].text, /已归档的旧 MCP 打包方案/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
