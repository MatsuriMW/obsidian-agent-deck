import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expandHome,
  userDataDir,
  localDataDir,
  pathDelimiter,
  mergePathEnv,
  resolveExecutable,
  wrapSpawnCommand,
  spawnOptions,
  sqlite3Binary,
  shellQuote,
  openUrlCrossPlatform,
  windowsShellBinary,
} from "../src/platform.js";
import { desktopQuery } from "../src/desktop-sessions.js";
import { scanAgentWait } from "../src/external-state.js";
import { isScratchCwd, projectName, sessionProjectName } from "../src/readers.js";
import { stepText, ingestAntigravityLine } from "../src/agent-ingestors.js";
import { findNodeBinary, installCursorHooks } from "../src/cursor-sessions.js";
import { externalMemoryPath } from "../src/dream-sharing.js";

test("platform path helpers support win32, darwin, and linux cleanly", () => {
  assert.equal(expandHome("~/vault", "/home/alice"), "/home/alice/vault");
  assert.equal(expandHome("~\\vault", "C:\\Users\\alice"), "C:\\Users\\alice\\vault");
  assert.equal(userDataDir("C:\\Users\\alice", "win32", { APPDATA: "D:\\AppData\\Roaming" }), "D:\\AppData\\Roaming");
  assert.equal(userDataDir("/home/alice", "linux", { XDG_CONFIG_HOME: "/home/alice/.cfg" }), "/home/alice/.cfg");
  assert.equal(localDataDir("C:\\Users\\alice", "win32", { LOCALAPPDATA: "D:\\AppData\\Local" }), "D:\\AppData\\Local");
  assert.equal(pathDelimiter("win32"), ";");
  assert.equal(pathDelimiter("linux"), ":");
});

test("mergePathEnv preserves Windows drive colons using ';' and does not corrupt PATH", () => {
  const merged = mergePathEnv(
    { PATH: "C:\\Windows\\System32;D:\\Tools" },
    { homeDir: "C:\\Users\\alice", platform: "win32" },
  );
  const parts = merged.PATH.split(";");
  assert.ok(parts.includes("C:\\Windows\\System32"), "C: drive letter preserved intact");
  assert.ok(parts.includes("D:\\Tools"), "D: drive letter preserved intact");
  assert.ok(parts.some((p) => p.endsWith("npm")), "adds npm shim dir on Windows");
  assert.ok(!parts.some((p) => p === "C" || p === "\\Windows\\System32"), "must never split on ':'");
});

test("resolveExecutable finds .cmd/.exe on win32 and wrapSpawnCommand wraps npm shims via cmd.exe", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-win-test-"));
  const fakeHome = path.join(tmp, "home");
  const npmDir = path.join(tmp, "roaming", "npm");
  fs.mkdirSync(npmDir, { recursive: true });
  const claudeCmd = path.join(npmDir, "claude.cmd");
  fs.writeFileSync(claudeCmd, "@echo off\r\n");

  const resolved = resolveExecutable("claude", "", {
    homeDir: fakeHome,
    platform: "win32",
    env: { APPDATA: path.join(tmp, "roaming"), PATH: "" },
  });
  assert.equal(resolved, claudeCmd);

  const wrappedCmd = wrapSpawnCommand(claudeCmd, ["-p", "hello"], { platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } });
  assert.equal(wrappedCmd.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(wrappedCmd.args, ["/d", "/c", claudeCmd, "-p", "hello"]);

  const wrappedExe = wrapSpawnCommand("C:\\Tools\\Codex.exe", ["app-server"], { platform: "win32" });
  assert.equal(wrappedExe.command, "C:\\Tools\\Codex.exe");
  assert.deepEqual(wrappedExe.args, ["app-server"]);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("sqlite3Binary & desktopQuery degrade gracefully on Windows without /usr/bin/sqlite3", async () => {
  const emptyBin = sqlite3Binary({ homeDir: "/nonexistent", env: { PATH: "" }, platform: "win32" });
  assert.equal(emptyBin, "");

  const rows = await desktopQuery("/nonexistent/opencode.db", "SELECT 1");
  assert.deepEqual(rows, []);
});

test("shellQuote handles PowerShell vs POSIX escaping", () => {
  assert.equal(shellQuote("it's ok", "win32"), "'it''s ok'");
  assert.equal(shellQuote("it's ok", "darwin"), "'it'\"'\"'s ok'");
});

test("openUrlCrossPlatform & windowsShellBinary choose platform-appropriate launchers", () => {
  const calls = [];
  const fakeExec = (cmd, args) => calls.push({ cmd, args });
  // Only test fallback branch by stubbing require('electron') unavailable in Node test runner.
  assert.equal(openUrlCrossPlatform("codex://threads/abc", { platform: "win32", exec: fakeExec }), true);
  assert.equal(calls[0].cmd.toLowerCase().includes("cmd"), true);
  assert.deepEqual(calls[0].args, ["/d", "/c", "start", "", "codex://threads/abc"]);

  assert.equal(openUrlCrossPlatform("https://example.com", { platform: "linux", exec: fakeExec }), true);
  assert.equal(calls[1].cmd, "xdg-open");

  const shellInfo = windowsShellBinary("auto", { env: { PATH: "" }, homeDir: "/nonexistent" });
  assert.equal(shellInfo.which, "powershell");
  assert.ok(/powershell\.exe$/i.test(shellInfo.shellBin));
});

test("external-state scanAgentWait degrades cleanly when ps is unavailable on Windows", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wait-win-"));
  fs.writeFileSync(path.join(tmp, "s1.json"), JSON.stringify({ sid: "s1", pid: 999, at: Date.now() }));
  const orig = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const out = await scanAgentWait({ dir: tmp });
    assert.equal(out.size, 1);
    assert.equal(out.get("s1").released, undefined);
  } finally {
    Object.defineProperty(process, "platform", orig);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("wrapSpawnCommand unwraps npm .cmd node shims and quotes complex .cmd fallback safely", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-win-shim-"));
  const npmDir = path.join(tmp, "Program Files", "npm");
  const pkgDir = path.join(npmDir, "node_modules", "@anthropic-ai", "claude-code");
  fs.mkdirSync(pkgDir, { recursive: true });
  const nodeExe = path.join(npmDir, "node.exe");
  const cliJs = path.join(pkgDir, "cli.js");
  const claudeCmd = path.join(npmDir, "claude.cmd");
  fs.writeFileSync(nodeExe, "");
  fs.writeFileSync(cliJs, "console.log('ok');\n");
  fs.writeFileSync(
    claudeCmd,
    '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
  );

  const unwrapped = wrapSpawnCommand(claudeCmd, ["-p", "line 1\nline 2 & more"], { platform: "win32" });
  assert.equal(unwrapped.command, nodeExe);
  assert.deepEqual(unwrapped.args, [cliJs, "-p", "line 1\nline 2 & more"]);
  assert.equal(spawnOptions(unwrapped).windowsVerbatimArguments, undefined);
  assert.equal(spawnOptions(unwrapped).windowsHide, true);

  const plainBat = path.join(npmDir, "custom tool.cmd");
  fs.writeFileSync(plainBat, "@echo off\r\n");
  const fallback = wrapSpawnCommand(plainBat, ["-p", "hello world & more"], {
    platform: "win32",
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  assert.equal(fallback.command, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(fallback.args[0], "/d");
  assert.equal(fallback.args[1], "/s");
  assert.equal(fallback.args[2], "/c");
  assert.equal(fallback.windowsVerbatimArguments, true);
  assert.equal(spawnOptions(fallback).windowsVerbatimArguments, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readers and agent-ingestors handle Windows backslash paths cleanly", () => {
  assert.equal(projectName("C:\\Users\\alice\\claude\\agent-deck"), "agent-deck");
  assert.equal(projectName("C:\\Users\\alice\\claude\\agent-deck\\.claude\\worktrees\\feat-win"), "agent-deck");
  assert.equal(projectName("C:\\Users\\alice\\WorkBuddy\\2026-11-16\\s1"), "WorkBuddy");
  assert.equal(isScratchCwd("C:\\Users\\alice\\Documents\\Codex\\2026-11-16\\w-s"), true);
  assert.equal(sessionProjectName("C:\\"), "");
  assert.equal(sessionProjectName("D:\\Projects\\agent-workspace"), "agent-workspace");

  assert.equal(stepText("edit_file", { TargetFile: "C:\\Users\\alice\\repo\\src\\main.js" }), "改 main.js");

  const fc = { path: "t.jsonl", agent: "antigravity", sid: "s-win", cwd: "", app: "antigravity", model: "", days: new Map(), msgs: new Map(), titles: new Map(), live: null };
  const touched = new Set();
  const usage = {
    stale: () => false,
    touchSess: (_fc, tSet, _ms, sid, cwd, app) => {
      tSet.add("2026-11-16");
      return { key: "2026-11-16", day: { prompts: 0 }, s: { proj: projectName(cwd), cwd, app, text: "" } };
    },
    liveOf: (_fc, sid, ms) => ({ sid, at: ms, state: "run", step: "", title: "" }),
    titles: new Map(),
    meta: new Map(),
    noteMeta: () => {},
  };
  ingestAntigravityLine(
    { usage, inferWorkspaceRoot: (p) => (p.startsWith("D:\\Work\\demo") ? "D:\\Work\\demo" : p), projectName },
    JSON.stringify({ type: "USER_INPUT", created_at: "2026-11-16T08:00:00Z", content: "Inspect @[D:\\Work\\demo\\src\\app.ts]" }),
    fc,
    touched,
  );
  assert.equal(fc.cwd, "D:\\Work\\demo");
});

test("cursor-sessions and dream-sharing preserve Windows paths without mangling backslashes", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-win-cursor-"));
  const fakeNode = path.join(tmp, "Program Files", "nodejs", "node.exe");
  fs.mkdirSync(path.dirname(fakeNode), { recursive: true });
  fs.writeFileSync(fakeNode, "");

  const found = findNodeBinary(tmp, "win32", { ProgramFiles: path.join(tmp, "Program Files"), PATH: "" });
  assert.equal(found, fakeNode);

  const installed = installCursorHooks({ homeDir: tmp, nodePath: "C:\\Program Files\\nodejs\\node.exe", platform: "win32" });
  const cfg = JSON.parse(fs.readFileSync(installed.hooksPath, "utf8"));
  assert.ok(cfg.hooks.stop[0].command.startsWith('"C:\\Program Files\\nodejs\\node.exe" '));
  assert.ok(!cfg.hooks.stop[0].command.includes("\\\\"));

  assert.equal(expandHome("~\\shared\\memory.md", "C:\\Users\\alice"), "C:\\Users\\alice\\shared\\memory.md");
  const ext = externalMemoryPath("~/shared/memory.md");
  assert.equal(ext, path.normalize(path.join(os.homedir(), "shared", "memory.md")));

  fs.rmSync(tmp, { recursive: true, force: true });
});
