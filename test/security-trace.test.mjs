import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  redactSecrets,
  resolveSecret,
  saveExternalSecret,
  evaluatePermissionPolicy,
  appleScriptString,
  safeWarpConfigName,
} from "../src/security.js";
import {
  RunTrace,
  classifyError,
  readRecentTraces,
  pruneOldTraces,
  checkExternalAssets,
  buildDiagnosticReport,
} from "../src/trace.js";

test("security: redactSecrets masks Bearer tokens, API keys, and env assignments", () => {
  const sample = "Authorization: Bearer abcdefgh12345678 sk-proj-abc1234567890xyz OPENAI_API_KEY=my-secret-value";
  const clean = redactSecrets(sample);
  assert.ok(!clean.includes("abcdefgh12345678"));
  assert.ok(!clean.includes("sk-proj-abc1234567890xyz"));
  assert.ok(!clean.includes("my-secret-value"));
  assert.match(clean, /\[REDACTED\]/);
});

test("security: resolveSecret resolves env:, secret:, and plaintext fallback without touching vault data.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sec-"));
  const secretsFile = path.join(dir, "secrets.json");
  try {
    saveExternalSecret("deepseek_main", "sk-ext-998877665544", { secretsFile });
    assert.equal(resolveSecret("env:TEST_AD_KEY", { env: { TEST_AD_KEY: "sk-env-1234" }, secretsFile }), "sk-env-1234");
    assert.equal(resolveSecret("secret:deepseek_main", { secretsFile }), "sk-ext-998877665544");
    assert.equal(resolveSecret("sk-raw-1122", { secretsFile }), "sk-raw-1122");
    assert.equal(resolveSecret("", { secretsFile }), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("security: evaluatePermissionPolicy blocks autoApprove on destructive commands, sensitive paths, and out-of-workspace writes", () => {
  const cwd = "/Users/demo/repo";
  const vaultPath = "/Users/demo/vault";

  assert.equal(evaluatePermissionPolicy({ title: "edit", kind: "edit", rawInput: { path: `${cwd}/src/a.js` } }, { cwd, vaultPath, autoApprove: false }).allowAuto, false);
  assert.equal(evaluatePermissionPolicy({ title: "edit", kind: "edit", rawInput: { path: `${cwd}/src/a.js` } }, { cwd, vaultPath, autoApprove: true }).allowAuto, true);

  const rmRes = evaluatePermissionPolicy({ title: "run shell", kind: "execute", rawInput: { command: "rm -rf /tmp/foo" } }, { cwd, vaultPath, autoApprove: true });
  assert.equal(rmRes.allowAuto, false);
  assert.equal(rmRes.escalated, true);
  assert.equal(rmRes.risk, "destructive_rm");

  const sshRes = evaluatePermissionPolicy({ title: "read file", kind: "read", rawInput: { path: `${os.homedir()}/.ssh/id_rsa` } }, { cwd, vaultPath, autoApprove: true });
  assert.equal(sshRes.allowAuto, false);
  assert.equal(sshRes.escalated, true);
  assert.equal(sshRes.risk, "sensitive_path");

  const outsideWrite = evaluatePermissionPolicy({ title: "write file", kind: "edit", rawInput: { path: "/etc/hosts" } }, { cwd, vaultPath, autoApprove: true });
  assert.equal(outsideWrite.allowAuto, false);
  assert.equal(outsideWrite.escalated, true);
  assert.equal(outsideWrite.risk, "outside_workspace");
});

test("security: appleScriptString and safeWarpConfigName sanitize control characters and avoid static race", () => {
  const escaped = appleScriptString('cd "/tmp/a\\"b" && echo "hi"\nrm -rf');
  assert.ok(!escaped.includes("\n"));
  assert.ok(escaped.startsWith('"') && escaped.endsWith('"'));
  assert.ok(escaped.includes('\\"'));

  const name1 = safeWarpConfigName("Fix bug: 'quote' & spaces");
  assert.match(name1, /^agent-deck-fix-bug-quote-spaces-[a-z0-9]+$/);
});

test("trace: RunTrace writes redacted JSONL records, enforces bounded buffers, and builds diagnostic report", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-trace-"));
  try {
    const tr = new RunTrace({ agent: "dsh", jobId: "job-1", project: "agent-deck", transport: "acp", traceDir: dir });
    const sp = tr.startSpan("context.resolve");
    tr.endSpan(sp, "ok", { linkCount: 2 });
    for (let i = 0; i < 40; i++) tr.recordFrame("acp.event", `frame-${i} sk-proj-secretkey12345678`);
    tr.recordPermission({ tool: "edit", mode: "auto_policy_ok", outcome: "selected" });
    const record = await tr.finalize("error", { error: "session/prompt 超时 Authorization: Bearer tok_1234567890" });

    assert.equal(record.status, "error");
    assert.equal(record.errorCategory, "timeout");
    assert.ok(!record.errorMessage.includes("tok_1234567890"));
    assert.equal(record.recentFrames.length, 30, "frame ring buffer stays bounded at 30");
    assert.ok(!record.recentFrames[0].summary.includes("sk-proj-secretkey12345678"));

    const recent = await readRecentTraces({ traceDir: dir, limit: 10 });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].traceId, tr.traceId);

    const report = buildDiagnosticReport({ version: "1.12.2", traces: recent });
    assert.equal(report.traceSummary.byErrorCategory.timeout, 1);
    assert.equal(classifyError("429 rate limit"), "quota_or_rate_limit");

    // Retention cleanup removes stale files while preserving recent ones
    fs.writeFileSync(path.join(dir, "2020-01-01.jsonl"), "{}\n");
    const removed = await pruneOldTraces({ traceDir: dir, keepDays: 14, now: Date.now() });
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(path.join(dir, "2020-01-01.jsonl")), false);

    // Default RunTrace inside test runner must not write to ~/.agent-deck/traces
    const defaultTrace = new RunTrace({ agent: "claude", jobId: "job-test-isolated" });
    assert.equal(defaultTrace.writeEnabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deploy: checkExternalAssets detects missing and drifted memory-query.mjs", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-assets-"));
  try {
    const missing = checkExternalAssets(vault, { expectedMemoryQueryVersion: 1 });
    assert.equal(missing.ok, false);
    assert.equal(missing.items[0].status, "missing");

    const scriptDir = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "memory-query.mjs"), "export const ASSET_VERSION = 0;\n");
    const drifted = checkExternalAssets(vault, { expectedMemoryQueryVersion: 1 });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.items[0].status, "drifted");

    fs.writeFileSync(path.join(scriptDir, "memory-query.mjs"), "export const ASSET_VERSION = 1;\n");
    const ok = checkExternalAssets(vault, { expectedMemoryQueryVersion: 1 });
    assert.equal(ok.ok, true);
    assert.equal(ok.items[0].status, "ok");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
