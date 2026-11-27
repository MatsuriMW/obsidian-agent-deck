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
  spawnCli,
  killChildProcess,
} from "../src/security.js";
import { writeMockNodeBin, rmDirSafe } from "./helpers/mock-cli.mjs";
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

test("security: spawnCli runs node script cleanly and killChildProcess handles nullish targets safely", async () => {
  killChildProcess(null);
  killChildProcess({});
  const child = spawnCli(process.execPath, ["-e", "process.stdout.write('CLI_OK')"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 0);
  assert.equal(out, "CLI_OK");
});

test("security: killChildProcess terminates a spawned CLI shim tree promptly without leaving orphan handles", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sec-kill-"));
  try {
    const bin = writeMockNodeBin(dir, "sleeper", "setInterval(() => {}, 1000);\n");
    const child = spawnCli(bin, [], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await new Promise((r) => setTimeout(r, 50));
    const closed = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("child process tree did not close within 4000ms")), 4000);
      child.once("close", (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
    });
    killChildProcess(child, "SIGTERM");
    await closed;
  } finally {
    rmDirSafe(dir);
  }
});

test("security: evaluatePermissionPolicy handles Windows long-path prefixes, case-insensitivity, and outside symlinks", () => {
  assert.equal(
    evaluatePermissionPolicy(
      { title: "edit", kind: "edit", rawInput: { path: "\\\\?\\c:\\users\\dev\\Repo\\src\\a.js" } },
      { cwd: "C:\\Users\\dev\\Repo", vaultPath: "D:\\Vault", autoApprove: true },
    ).allowAuto,
    true,
  );
  const winOutside = evaluatePermissionPolicy(
    { title: "edit", kind: "edit", rawInput: { path: "C:/Users/dev/Other/a.js" } },
    { cwd: "\\\\?\\C:\\Users\\dev\\Repo", vaultPath: "D:\\Vault", autoApprove: true },
  );
  assert.equal(winOutside.allowAuto, false);
  assert.equal(winOutside.risk, "outside_workspace");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sec-sym-"));
  const inside = path.join(tmp, "inside");
  const outside = path.join(tmp, "outside");
  try {
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    const escapeLink = path.join(inside, "escape");
    fs.symlinkSync(outside, escapeLink, process.platform === "win32" ? "junction" : "dir");
    const symOutside = evaluatePermissionPolicy(
      { title: "edit", kind: "edit", rawInput: { path: path.join(escapeLink, "secret.txt") } },
      { cwd: inside, vaultPath: path.join(tmp, "vault"), autoApprove: true },
    );
    assert.equal(symOutside.allowAuto, false);
    assert.equal(symOutside.risk, "outside_workspace");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
