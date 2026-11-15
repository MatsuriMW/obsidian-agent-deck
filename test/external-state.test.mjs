import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  scanAgentWait,
  scanLimitQueue,
  resolveExternalState,
  parseTaskProgress,
  buildLineProgressInfo,
} from "../src/external-state.js";

test("scanAgentWait reads state files and releases entries once parent pid spawns shell-snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wait-"));
  const now = 1_700_000_100_000;
  try {
    fs.writeFileSync(
      path.join(dir, "s1.json"),
      JSON.stringify({ sid: "sid-1", pid: 4321, at: now - 10_000, tool: "Bash" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "s2.json"),
      JSON.stringify({ sid: "sid-2", pid: 9999, at: now - 5_000, tool: "Edit" }),
      "utf8",
    );
    const psText = [
      " 5001  4321 00:05 /bin/zsh -c source ~/.claude/shell-snapshots/snapshot-zsh-1.sh && npm test",
      " 5002  9999 01:00 /bin/zsh -c source ~/.claude/shell-snapshots/snapshot-zsh-2.sh && stale",
    ].join("\n");
    const first = await scanAgentWait({ dir, psText, now });
    assert.equal(first.get("sid-1")?.released, true);
    assert.equal(Boolean(first.get("sid-2")?.released), false);

    // Keeps released state even when ps snapshot process later exits.
    const second = await scanAgentWait({ dir, prev: first, psText: "", now: now + 30_000 });
    assert.equal(second.get("sid-1")?.released, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLimitQueue indexes pending queued sessions and skips running items", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-queue-"));
  const file = path.join(dir, "queue.json");
  try {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { session_id: "sid-q1", reset_at: 1_700_005_000, running: false },
        { session_id: "sid-q2", reset_at: 1_700_005_000, running: true },
      ]),
      "utf8",
    );
    const queue = await scanLimitQueue({ file });
    assert.equal(queue.has("sid-q1"), true);
    assert.equal(queue.get("sid-q1")?.reset_at, 1_700_005_000);
    assert.equal(queue.has("sid-q2"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExternalState maps limit+queue to queued and active perm to needs-approval", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    resolveExternalState({ baseState: "limit", queue: { reset_at: 1_700_003_600 }, now }),
    { state: "queued", queueResetAt: 1_700_003_600 },
  );
  assert.deepEqual(
    resolveExternalState({ baseState: "limit", resets: now - 1000, now }),
    { state: "wait" },
  );
  assert.deepEqual(
    resolveExternalState({ baseState: "run", lastAt: now - 500, perm: { at: now, tool: "Bash" }, now }),
    { state: "needs-approval", permTool: "Bash" },
  );
  assert.deepEqual(
    resolveExternalState({ baseState: "run", lastAt: now, archived: true, perm: { at: now, tool: "Bash" }, now }),
    { state: "run" },
  );
  assert.deepEqual(
    resolveExternalState({ baseState: "error", queue: { reset_at: 1_700_003_600 }, perm: { at: now, tool: "Bash" }, now }),
    { state: "error" },
  );
});

test("parseTaskProgress parses percentage, ascii fractions, Chinese fractions, and half", () => {
  assert.equal(parseTaskProgress("- DOING 整理脚本 40%"), 0.4);
  assert.equal(parseTaskProgress("- DOING 迁移模块 2/5"), 0.4);
  assert.equal(parseTaskProgress("- DOING 完成三分之二了"), 2 / 3);
  assert.equal(parseTaskProgress("- DOING 做了一半"), 0.5);
  assert.equal(parseTaskProgress("- DOING 没有进度数字 150%"), null);
});

test("buildLineProgressInfo produces bar, running bounce, external approval/queued, and subagent rows", () => {
  const now = 1_700_000_000_000;
  const subMap = new Map([
    ["a7de3cf8", { id: "a7de3cf8", desc: "Inspect CSS", type: "Explore", bg: false, at: now - 10_000, state: "run", step: "Read styles.css", tok: new Map([["m", 250_000]]) }],
  ]);
  const plugin = {
    settings: { dayCutoff: 8 },
    usage: {
      hidden: () => false,
      meta: new Map([["sid-parent", { sid: "sid-parent", state: "run", agent: "claude" }]]),
      subs: new Map([["sid-parent", subMap]]),
      subsOf: () => [],
    },
    applyExternalState: (s) => s,
  };

  const lines = [
    "- DOING 🤖 10:00-10:30 修复导出 ^b1",
    "- DOING **10:35** 查 CSS",
    "  - 🔗 子代理 `a7de3cf8`",
  ];

  const barInfo = buildLineProgressInfo(plugin, lines[0], lines, 0, {
    sid: "sid-1",
    agent: "claude",
    state: "run",
    lastAt: now - 10_000,
    todo: { done: 2, total: 5, cur: "跑单测" },
    turns: 3,
    tokens: 1_250_000,
  }, null, now);
  assert.equal(barInfo.mode, "bar");
  assert.equal(barInfo.pct, 0.4);
  assert.equal(barInfo.tok, 1_250_000);
  assert.match(barInfo.tail, /2\/5 步/);
  assert.match(barInfo.tail, /第 3 轮/);

  const approvalInfo = buildLineProgressInfo(plugin, lines[0], lines, 0, {
    sid: "sid-2",
    agent: "codex",
    state: "needs-approval",
    permTool: "Bash",
    lastAt: now - 5_000,
  }, null, now);
  assert.equal(approvalInfo.mode, "wait");
  assert.match(approvalInfo.tail, /等你允许 · Bash/);

  const queuedInfo = buildLineProgressInfo(plugin, lines[0], lines, 0, {
    sid: "sid-3",
    agent: "claude",
    state: "queued",
    queueResetAt: Math.floor((now + 3600_000) / 1000),
    lastAt: now - 5_000,
  }, null, now);
  assert.equal(queuedInfo.mode, "wait");
  assert.match(queuedInfo.tail, /排队续跑/);

  const subInfo = buildLineProgressInfo(plugin, lines[1], lines, 1, null, null, now);
  assert.equal(subInfo.mode, "run");
  assert.equal(subInfo.sid, "sid-parent");
  assert.equal(subInfo.tok, 250_000);
  assert.match(subInfo.tail, /子代理.*在跑/);
});
