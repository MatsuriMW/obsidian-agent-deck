import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MCP_SERVER_NAME,
  resolveNodeBinary,
  listMcpClients,
  installMcpClient,
  uninstallMcpClient,
  verifyMcpHandshake,
  readTomlServer,
  upsertTomlServer,
  removeTomlServer,
  readDshCordisServer,
  upsertDshCordisServer,
  removeDshCordisServer,
} from "../src/context-core/mcp-clients.js";

test("mcp-clients: TOML 无损读写、更新与移除（保留注释与其他 MCP）", () => {
  const original = [
    "# Codex global config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.computer-use]",
    'command = "node"',
    'args = ["/opt/cu.js"]',
    "",
    "[mcp_servers.other.env]",
    'FOO = "bar"',
    "",
  ].join("\n");

  const winArgs = ["C:\\Users\\Alice\\vault\\.obsidian\\plugins\\agent-deck\\scripts\\memory-mcp.mjs", "--vault", "D:\\My Vault", "--allow-write"];
  const added = upsertTomlServer(original, MCP_SERVER_NAME, { command: "node", args: winArgs });
  assert.match(added, /^# Codex global config/m);
  assert.match(added, /\[mcp_servers\.computer-use\]/);
  const parsedAdded = readTomlServer(added, MCP_SERVER_NAME);
  assert.equal(parsedAdded.found, true);
  assert.equal(parsedAdded.command, "node");
  assert.deepEqual(parsedAdded.args, winArgs);

  const updated = upsertTomlServer(added, MCP_SERVER_NAME, { command: "node", args: ["/tmp/mcp.mjs", "--vault", "/tmp/v"] });
  assert.equal(readTomlServer(updated, MCP_SERVER_NAME).args[1], "--vault");
  assert.match(updated, /\[mcp_servers\.other\.env\]/);

  const removed = removeTomlServer(updated, MCP_SERVER_NAME);
  assert.equal(readTomlServer(removed, MCP_SERVER_NAME).found, false);
  assert.match(removed, /\[mcp_servers\.computer-use\]/);
  assert.match(removed, /\[mcp_servers\.other\.env\]/);
});

test("mcp-clients: 9 家客户端隔离安装、备份、状态切换（只读 vs --allow-write）、损坏 JSON 保护与卸载", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mcp-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mcp-vault-"));
  const mcpScript = path.join(home, "scripts", "memory-mcp.mjs");
  try {
    fs.mkdirSync(path.dirname(mcpScript), { recursive: true });
    fs.writeFileSync(mcpScript, "// stub\n");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(home, ".gemini", "antigravity"), { recursive: true });
    fs.mkdirSync(path.join(home, "Library", "Application Support", "Claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(home, ".dsh", "profiles", "desktop"), { recursive: true });
    fs.mkdirSync(path.join(home, ".dsh", "profiles", "acp"), { recursive: true });

    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ theme: "dark", mcpServers: { keep: { command: "x", args: [] } } }, null, 2));
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), "# Keep me\n[mcp_servers.keep]\ncommand = \"echo\"\n");
    fs.writeFileSync(path.join(home, ".dsh", "profiles", "acp", "cordis.patch.yml"), "# DSH ACP\n[]\n");

    const env = { ...process.env };
    const before = listMcpClients({ vaultPath: vault, mcpScript, homeDir: home, platform: "darwin", env });
    assert.equal(before.length, 9);
    assert.equal(before.find((c) => c.id === "claude-code").status, "not-installed");
    assert.equal(before.find((c) => c.id === "codex").detected, true);
    assert.equal(before.find((c) => c.id === "opencode").detected, true);
    assert.equal(before.find((c) => c.id === "dsh-desktop").detected, true);
    assert.equal(before.find((c) => c.id === "dsh-acp").detected, true);

    for (const id of ["claude-code", "codex", "cursor", "antigravity", "claude-desktop", "gemini-cli", "opencode", "dsh-desktop", "dsh-acp"]) {
      const r = installMcpClient(id, { vaultPath: vault, mcpScript, allowWrite: false, homeDir: home, platform: "darwin", env });
      assert.equal(r.ok, true);
    }

    assert.ok(fs.existsSync(path.join(home, ".claude.json.agent-deck.bak")), "修改已有配置前生成备份");
    const claudeJson = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    assert.equal(claudeJson.theme, "dark");
    assert.ok(claudeJson.mcpServers.keep);
    assert.ok(claudeJson.mcpServers[MCP_SERVER_NAME]);

    const connected = listMcpClients({ vaultPath: vault, mcpScript, allowWrite: false, homeDir: home, platform: "darwin", env });
    assert.ok(connected.every((c) => c.status === "connected" && c.currentAllowWrite === false));

    const outdated = listMcpClients({ vaultPath: vault, mcpScript, allowWrite: true, homeDir: home, platform: "darwin", env });
    assert.ok(outdated.every((c) => c.status === "outdated"), "切换 --allow-write 后状态准确变为配置需更新");

    installMcpClient("codex", { vaultPath: vault, mcpScript, allowWrite: true, homeDir: home, platform: "darwin", env });
    const afterUpdate = listMcpClients({ vaultPath: vault, mcpScript, allowWrite: true, homeDir: home, platform: "darwin", env });
    assert.equal(afterUpdate.find((c) => c.id === "codex").status, "connected");
    assert.equal(afterUpdate.find((c) => c.id === "codex").currentAllowWrite, true);

    // 损坏的 JSON 文件必须报错并拒绝覆盖
    fs.writeFileSync(path.join(home, ".cursor", "mcp.json"), "{ invalid json");
    const errList = listMcpClients({ vaultPath: vault, mcpScript, homeDir: home, platform: "darwin", env });
    assert.equal(errList.find((c) => c.id === "cursor").status, "error");
    assert.throws(() => installMcpClient("cursor", { vaultPath: vault, mcpScript, homeDir: home, platform: "darwin", env }));
    assert.equal(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"), "{ invalid json");

    uninstallMcpClient("codex", { homeDir: home, platform: "darwin", env });
    const codexAfter = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    assert.match(codexAfter, /\[mcp_servers\.keep\]/);
    assert.ok(!codexAfter.includes(MCP_SERVER_NAME));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("mcp-clients: verifyMcpHandshake 实跑 stdio 握手并区分只读 9 工具与 --allow-write 10 工具", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-hs-vault-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-hs-idx-"));
  try {
    fs.mkdirSync(path.join(vault, ".outline-journal"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Agent Deck", "记忆"), { recursive: true });
    const mcpScript = path.resolve("src/context-core/mcp.js");

    const ro = verifyMcpHandshake({ mcpScript, vaultPath: vault, allowWrite: false, indexDir });
    assert.equal(ro.ok, true);
    assert.equal(ro.toolsCount, 9);
    assert.ok(ro.toolNames.includes("vault_find"));
    assert.ok(!ro.toolNames.includes("memory_propose"));

    const rw = verifyMcpHandshake({ mcpScript, vaultPath: vault, allowWrite: true, indexDir });
    assert.equal(rw.ok, true);
    assert.equal(rw.toolsCount, 10);
    assert.ok(rw.toolNames.includes("memory_propose"));

    const cfgDir = path.join(vault, ".outline-journal", "plugins", "agent-deck");
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, "data.json"), JSON.stringify({ dream: { mcp: { toolsMode: "memory-only" } } }));

    const roMemOnly = verifyMcpHandshake({ mcpScript, vaultPath: vault, allowWrite: false, configDir: ".outline-journal", indexDir });
    assert.equal(roMemOnly.ok, true);
    assert.equal(roMemOnly.toolsCount, 5);
    assert.ok(!roMemOnly.toolNames.includes("vault_find"));
    assert.ok(!roMemOnly.toolNames.includes("memory_propose"));

    const rwMemOnly = verifyMcpHandshake({ mcpScript, vaultPath: vault, allowWrite: true, toolsMode: "memory-only", configDir: ".outline-journal", indexDir });
    assert.equal(rwMemOnly.ok, true);
    assert.equal(rwMemOnly.toolsCount, 6);
    assert.ok(!rwMemOnly.toolNames.includes("vault_find"));
    assert.ok(rwMemOnly.toolNames.includes("memory_propose"));
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});

test("mcp-clients: resolveNodeBinary 在 Electron/Obsidian 精简 PATH 下优先选中最高版本 nvm node，并识别失效绝对路径", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ad-node-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-node-vault-"));
  const mcpScript = path.join(home, "memory-mcp.mjs");
  try {
    fs.writeFileSync(mcpScript, "// stub\n");
    const nvm20 = path.join(home, ".nvm", "versions", "node", "v20.11.0", "bin");
    const nvm24 = path.join(home, ".nvm", "versions", "node", "v24.12.0", "bin");
    fs.mkdirSync(nvm20, { recursive: true });
    fs.mkdirSync(nvm24, { recursive: true });
    fs.writeFileSync(path.join(home, ".nvm", "versions", "node", ".DS_Store"), "");
    fs.writeFileSync(path.join(nvm20, "node"), "");
    fs.writeFileSync(path.join(nvm24, "node"), "");
    fs.chmodSync(path.join(nvm20, "node"), 0o755);
    fs.chmodSync(path.join(nvm24, "node"), 0o755);
    const nvm25 = path.join(home, ".nvm", "versions", "node", "v25.0.0", "bin");
    fs.mkdirSync(nvm25, { recursive: true });
    fs.writeFileSync(path.join(nvm25, "node"), "");
    fs.chmodSync(path.join(nvm25, "node"), 0o644);

    const picked = resolveNodeBinary({
      homeDir: home,
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin" },
      execPath: "/Applications/Obsidian.app/Contents/MacOS/Obsidian Helper (Renderer)",
    });
    assert.equal(picked, path.join(nvm24, "node"), "跳过 .DS_Store 与不可执行文件并选最高可执行 semver node");

    installMcpClient("claude-code", {
      vaultPath: vault,
      mcpScript,
      homeDir: home,
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin" },
      execPath: "/Applications/Obsidian.app/Contents/MacOS/Obsidian Helper (Renderer)",
    });
    const list1 = listMcpClients({ vaultPath: vault, mcpScript, homeDir: home, platform: "darwin" });
    const cc = list1.find((c) => c.id === "claude-code");
    assert.equal(cc.status, "connected");
    assert.equal(cc.displayPath, "~/.claude.json");

    // Simulate deleted node binary -> status must become outdated
    fs.rmSync(path.join(nvm24, "node"));
    const list2 = listMcpClients({ vaultPath: vault, mcpScript, homeDir: home, platform: "darwin" });
    assert.equal(list2.find((c) => c.id === "claude-code").status, "outdated");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("mcp-clients: Codex 仅有子表时补写主表、卸载保留多行值空白且维持 0600 权限与自定义 configDir", () => {
  const onlyChild = [
    'banner = """',
    "line1",
    "",
    "",
    "line2",
    '"""',
    "",
    `[mcp_servers.${MCP_SERVER_NAME}.env]`,
    'FOO = "1"',
    "",
  ].join("\n");
  const upserted = upsertTomlServer(onlyChild, MCP_SERVER_NAME, { command: "node", args: ["/tmp/mcp.mjs", "--vault", "/tmp/v"] });
  assert.equal(readTomlServer(upserted, MCP_SERVER_NAME).found, true);
  assert.match(upserted, /\n\n\nline2/);

  const removed = removeTomlServer(upserted, MCP_SERVER_NAME);
  assert.equal(readTomlServer(removed, MCP_SERVER_NAME).found, false);
  assert.match(removed, /\n\n\nline2/, "卸载时不得破坏其他配置的多行字符串内部空行");

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ad-perm-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-perm-vault-"));
  const mcpScript = path.join(home, "memory-mcp.mjs");
  try {
    fs.writeFileSync(mcpScript, "// stub\n");
    const cfgPath = path.join(home, ".claude.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    fs.chmodSync(cfgPath, 0o600);
    installMcpClient("claude-code", { vaultPath: vault, mcpScript, configDir: ".custom-cfg", homeDir: home, platform: "darwin" });
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600, "原子写回不能放宽 0600 权限");
    }
    const items = listMcpClients({ vaultPath: vault, mcpScript, configDir: ".custom-cfg", homeDir: home, platform: "darwin" });
    const cc = items.find((c) => c.id === "claude-code");
    assert.equal(cc.status, "connected");
    assert.equal(cc.currentConfigDir, ".custom-cfg");

    // Preserve explicit .obsidian --config-dir and recognize single-quoted TOML keys
    installMcpClient("claude-code", { vaultPath: vault, mcpScript, configDir: ".obsidian", homeDir: home, platform: "darwin" });
    const obsItems = listMcpClients({ vaultPath: vault, mcpScript, configDir: ".obsidian", homeDir: home, platform: "darwin" });
    assert.equal(obsItems.find((c) => c.id === "claude-code").currentConfigDir, ".obsidian");

    const singleQuotedToml = `[mcp_servers.'${MCP_SERVER_NAME}']\ncommand = "node"\nargs = ["/old.js"]\n\n[mcp_servers.'${MCP_SERVER_NAME}'.env]\nA = "1"\n`;
    const sqUpsert = upsertTomlServer(singleQuotedToml, MCP_SERVER_NAME, { command: "node", args: ["/new.js", "--vault", vault] });
    assert.equal(sqUpsert.match(/mcp_servers/g)?.length, 1, "单引号 TOML 主表与子表去重不留重复段");
    assert.equal(removeTomlServer(singleQuotedToml, MCP_SERVER_NAME), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("mcp-clients: OpenCode opencode.json 与 DeepSeek Harness cordis.patch.yml 无损读写、保留 !!js / 兄弟项与非法保护", () => {
  // 1. DSH Cordis YAML: [] 文件插入与卸载还原为 []
  const emptyYaml = "# Header comment\n[]\n";
  const addedFromEmpty = upsertDshCordisServer(emptyYaml, MCP_SERVER_NAME, {
    command: "/usr/local/bin/node",
    args: ["C:\\Vault\\scripts\\memory-mcp.mjs", "--vault", "D:\\My Vault"],
  });
  assert.match(addedFromEmpty, /^# Header comment/m);
  assert.ok(!addedFromEmpty.includes("[]"));
  const readEmptyAdd = readDshCordisServer(addedFromEmpty, MCP_SERVER_NAME);
  assert.equal(readEmptyAdd.found, true);
  assert.equal(readEmptyAdd.command, "/usr/local/bin/node");
  assert.deepEqual(readEmptyAdd.args, ["C:\\Vault\\scripts\\memory-mcp.mjs", "--vault", "D:\\My Vault"]);
  const removedBackToEmpty = removeDshCordisServer(addedFromEmpty, MCP_SERVER_NAME);
  assert.match(removedBackToEmpty, /^# Header comment/m);
  assert.match(removedBackToEmpty, /^\[\]$/m);

  // 2. DSH Cordis YAML: 保留注释、!!js 表达式与同 `- insert:` 下兄弟条目（如 mcp-kimi-cu）
  const sharedInsertYaml = [
    "# DSH Desktop patch with !!js",
    "- id: custom-js",
    "  config:",
    "    expr: !!js/function 'function() { return 1; }'",
    "- insert:",
    "    - id: mcp-kimi-cu",
    '      name: "@deepseek-ai/dsh-mcp-client"',
    "      config:",
    "        serverName: kimi-cu",
    "        transport: stdio",
    "        command: /Applications/KimiCU.app/Contents/MacOS/kimi-cu",
    "        args: ['mcp', '-s', 'user']",
    `    - id: mcp-${MCP_SERVER_NAME}`,
    '      name: "@deepseek-ai/dsh-mcp-client"',
    "      config:",
    `        serverName: ${MCP_SERVER_NAME}`,
    "        transport: stdio",
    "        command: /old/node",
    "        args:",
    "          - /old/mcp.mjs",
    "          - --vault",
    "          - /old/vault",
    "- id: dsh-github",
    "  disabled: true",
    "",
  ].join("\n");
  const readShared = readDshCordisServer(sharedInsertYaml, MCP_SERVER_NAME);
  assert.equal(readShared.found, true);
  assert.equal(readShared.command, "/old/node");
  assert.deepEqual(readShared.args, ["/old/mcp.mjs", "--vault", "/old/vault"]);

  const updatedShared = upsertDshCordisServer(sharedInsertYaml, MCP_SERVER_NAME, {
    command: "/new/node",
    args: ["/new/mcp.mjs", "--vault", "/new/vault", "--allow-write"],
  });
  assert.match(updatedShared, /!!js\/function/);
  assert.match(updatedShared, /id: mcp-kimi-cu/);
  assert.match(updatedShared, /id: dsh-github/);
  assert.deepEqual(readDshCordisServer(updatedShared, MCP_SERVER_NAME).args, ["/new/mcp.mjs", "--vault", "/new/vault", "--allow-write"]);

  const removedShared = removeDshCordisServer(updatedShared, MCP_SERVER_NAME);
  assert.equal(readDshCordisServer(removedShared, MCP_SERVER_NAME).found, false);
  assert.match(removedShared, /id: mcp-kimi-cu/, "同组兄弟条目 mcp-kimi-cu 不受影响");
  assert.match(removedShared, /!!js\/function/);
  assert.match(removedShared, /id: dsh-github/);

  // 2b. DSH 路径包含 ` #` 且出现重复 `- insert:` 块时安全解析与去重
  const hashAndDupYaml = [
    "- insert:",
    `    - id: mcp-${MCP_SERVER_NAME}`,
    '      name: "@deepseek-ai/dsh-mcp-client"',
    "      config:",
    `        serverName: ${MCP_SERVER_NAME}`,
    '        command: "/usr/bin/node"',
    '        args: ["/tmp/dir #1/mcp.mjs", "--vault", "/tmp/v #2"] # inline comment',
    "- insert:",
    `    - id: mcp-${MCP_SERVER_NAME}`,
    '      name: "@deepseek-ai/dsh-mcp-client"',
    "      config:",
    "        command: /old/node",
    "        args: []",
    "",
  ].join("\n");
  assert.deepEqual(readDshCordisServer(hashAndDupYaml, MCP_SERVER_NAME).args, ["/tmp/dir #1/mcp.mjs", "--vault", "/tmp/v #2"]);
  const dedupedHash = upsertDshCordisServer(hashAndDupYaml, MCP_SERVER_NAME, { command: "/usr/bin/node", args: ["/tmp/clean.mjs", "--vault", "/tmp/v"] });
  assert.equal(dedupedHash.match(/mcp-agent-deck-memory/g)?.length, 1, "重复 DSH 条目去重且不留空 - insert:");
  assert.equal(dedupedHash.match(/^- insert:/gm)?.length, 1);

  // 3. OpenCode JSON 安装/兼容旧 mcp.<name> 与无效配置保护
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ad-oc-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-oc-vault-"));
  const mcpScript = path.join(home, "scripts", "memory-mcp.mjs");
  try {
    fs.mkdirSync(path.dirname(mcpScript), { recursive: true });
    fs.writeFileSync(mcpScript, "// stub\n");
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(home, ".dsh", "profiles", "desktop"), { recursive: true });

    const ocPath = path.join(home, ".config", "opencode", "opencode.json");
    fs.writeFileSync(ocPath, JSON.stringify({
      theme: "tokyo",
      mcp: {
        servers: { keep: { type: "local", command: ["/bin/echo", "hi"] } },
        [MCP_SERVER_NAME]: { type: "local", command: ["/legacy/node", mcpScript, "--vault", vault] },
      },
    }, null, 2));

    const env = { ...process.env };
    installMcpClient("opencode", { vaultPath: vault, mcpScript, allowWrite: true, homeDir: home, platform: "darwin", env });
    const ocSaved = JSON.parse(fs.readFileSync(ocPath, "utf8"));
    assert.equal(ocSaved.theme, "tokyo");
    assert.ok(ocSaved.mcp.servers.keep);
    assert.equal(ocSaved.mcp[MCP_SERVER_NAME], undefined, "兼容并清理旧 mcp.<name> 节点");
    assert.equal(ocSaved.mcp.servers[MCP_SERVER_NAME].type, "local");
    assert.ok(Array.isArray(ocSaved.mcp.servers[MCP_SERVER_NAME].command));
    assert.ok(ocSaved.mcp.servers[MCP_SERVER_NAME].command.includes("--allow-write"));

    uninstallMcpClient("opencode", { homeDir: home, platform: "darwin", env });
    const ocAfter = JSON.parse(fs.readFileSync(ocPath, "utf8"));
    assert.ok(ocAfter.mcp.servers.keep);
    assert.equal(ocAfter.mcp.servers[MCP_SERVER_NAME], undefined);

    // 非序列 Cordis YAML 拒写保护
    const badDshPath = path.join(home, ".dsh", "profiles", "desktop", "cordis.patch.yml");
    fs.writeFileSync(badDshPath, "not_a_list: true\n");
    const errList = listMcpClients({ vaultPath: vault, mcpScript, homeDir: home, platform: "darwin", env });
    assert.equal(errList.find((c) => c.id === "dsh-desktop").status, "error");
    assert.throws(() => installMcpClient("dsh-desktop", { vaultPath: vault, mcpScript, homeDir: home, platform: "darwin", env }));
    assert.equal(fs.readFileSync(badDshPath, "utf8"), "not_a_list: true\n");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
