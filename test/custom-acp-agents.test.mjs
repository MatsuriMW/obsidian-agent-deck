import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AGENTS, AGENT_ORDER, DEFAULTS, deepMerge, syncDelegationSettings } from "../src/constants.js";
import { getAgentCapability, delegateAgents, acpAgents, canContinueSession } from "../src/agent-registry.js";
import {
  normalizeCustomAcpId,
  parseCustomAcpArgs,
  parseCustomAcpEnv,
  normalizeCustomAcpEntry,
  syncCustomAcpRegistry,
} from "../src/custom-acp.js";
import { taskMention } from "../src/task-mentions.js";
import { applyHarnessDetection } from "../src/harness-detect.js";
import { AcpRunner, acpSpawnArgs } from "../src/delegation-runners.js";
import { writeMockNodeBin, rmDirSafe } from "./helpers/mock-cli.mjs";

test("custom ACP id, args, and env parsing with secret resolution", () => {
  assert.equal(normalizeCustomAcpId("Kiro"), "kiro");
  assert.equal(normalizeCustomAcpId("mistral-vibe_2"), "mistral-vibe_2");
  assert.equal(normalizeCustomAcpId("claude"), "");
  assert.equal(normalizeCustomAcpId("1bad"), "");
  assert.equal(normalizeCustomAcpId("a"), "");

  assert.deepEqual(parseCustomAcpArgs(""), []);
  assert.deepEqual(parseCustomAcpArgs('--mode "fast acp" --flag'), ["--mode", "fast acp", "--flag"]);

  const resolved = parseCustomAcpEnv(
    '# comment\nFOO=bar\nQUOTED="hello world"\nSECRET_KEY=secret:demo\nFROM_ENV=env:MY_TOKEN\nBAD-KEY=1',
    {
      resolve: (v) => (v === "secret:demo" ? "s3cr3t" : v === "env:MY_TOKEN" ? "tok-123" : v),
    }
  );
  assert.deepEqual(resolved, {
    FOO: "bar",
    QUOTED: "hello world",
    SECRET_KEY: "s3cr3t",
    FROM_ENV: "tok-123",
  });
});

test("syncCustomAcpRegistry registers, routes @mentions, survives harness detection, and cleans up", () => {
  const prevLen = AGENT_ORDER.length;
  try {
    const reg = syncCustomAcpRegistry([
      { id: "kiro", name: "Kiro", command: "kiro-cli", args: "--experimental-acp", env: "KIRO_ENV=1", autoApprove: true },
      { id: "claude", name: "Collision", command: "bad" },
    ]);
    assert.equal(reg.length, 1);
    assert.equal(AGENTS.kiro?.name, "Kiro");
    assert.equal(AGENTS.kiro?.customAcp, true);
    assert.ok(AGENT_ORDER.includes("kiro"));
    assert.ok(delegateAgents().includes("kiro"));
    assert.ok(acpAgents().includes("kiro"));

    const cap = getAgentCapability("kiro");
    assert.equal(cap.runnerKind, "acp");
    assert.equal(cap.acpCommand, "kiro-cli");
    assert.deepEqual(cap.acpArgs, ["--experimental-acp"]);
    assert.deepEqual(acpSpawnArgs("kiro", "kiro-cli", "--verbose", cap), ["--experimental-acp", "--verbose"]);
    assert.equal(canContinueSession({ agent: "kiro", sid: "s-1", transport: "acp" }), true);

    const mention = taskMention("- TODO @kiro 帮我跑一下测试");
    assert.equal(mention?.agent, "kiro");

    const settings = syncDelegationSettings(
      deepMerge(DEFAULTS, {
        customAcpAgents: [normalizeCustomAcpEntry({ id: "kiro", name: "Kiro", command: "kiro-cli", args: "acp" })],
        agents: { kiro: true },
        delegate: { target: "kiro" },
      }),
      { delegate: { target: "kiro" } }
    );
    assert.equal(settings.delegate.target, "kiro");

    applyHarnessDetection(settings, {
      mode: "rescan",
      detection: { detected: {}, installed: [], missing: [], details: {} },
    });
    assert.equal(settings.agents.kiro, true, "harness detection must not disable custom ACP agents");
  } finally {
    syncCustomAcpRegistry([]);
    assert.equal(AGENTS.kiro, undefined);
    assert.equal(AGENT_ORDER.length, prevLen);
  }
});

test("AcpRunner spawns custom ACP agent with custom args and resolved env", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-custom-acp-"));
  const prevEnv = process.env.AD_CUSTOM_ACP_TEST_TOKEN;
  process.env.AD_CUSTOM_ACP_TEST_TOKEN = "resolved-env-token";
  try {
    const cli = writeMockNodeBin(dir, "mock-custom-acp", `
      const rl = require("readline").createInterface({ input: process.stdin });
      const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
      const argvFlag = process.argv.slice(2).join("|");
      const token = process.env.CUSTOM_TOKEN || "";
      rl.on("line", (line) => {
        if (!line.trim()) return;
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
        } else if (msg.method === "session/new") {
          send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "custom-sid-1" } });
        } else if (msg.method === "session/prompt") {
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "custom-sid-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "args=" + argvFlag + " token=" + token },
              },
            },
          });
          send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
        }
      });
    `);

    syncCustomAcpRegistry([
      {
        id: "pi-custom",
        name: "Pi Custom",
        command: cli,
        args: "--acp-mode custom",
        env: "CUSTOM_TOKEN=env:AD_CUSTOM_ACP_TEST_TOKEN",
        autoApprove: true,
      },
    ]);

    const job = { id: "job-custom-1", agent: "pi-custom", state: "queued" };
    let resolveDone, rejectDone;
    const settled = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
    const delegator = {
      vaultPath: dir,
      settings: { delegate: { "pi-custom": { cwd: dir, autoApprove: true } } },
      saveJobs() {},
      saveJobsSoon() {},
      refreshUI() {},
      notify() {},
      onSession() {},
      onProgress() {},
      onDone(j) { resolveDone(j); },
      onError(j) { rejectDone(new Error(j?.error || "custom acp error")); },
    };

    const runner = new AcpRunner(delegator, job);
    await runner.start({ cwd: dir, prompt: "hello custom acp" });
    const finishedJob = await settled;
    runner.close?.();

    assert.equal(job.sessionId, "custom-sid-1");
    assert.equal(job.transport, "acp");
    assert.equal(finishedJob?.state, "done");
    assert.equal(job.result, "args=--acp-mode|custom token=resolved-env-token");
  } finally {
    syncCustomAcpRegistry([]);
    if (prevEnv === undefined) delete process.env.AD_CUSTOM_ACP_TEST_TOKEN;
    else process.env.AD_CUSTOM_ACP_TEST_TOKEN = prevEnv;
    rmDirSafe(dir);
  }
});
