import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") {
    return {
      url: "data:text/javascript,export class Notice{constructor(){}};export class MarkdownView{};export class Menu{};",
      shortCircuit: true,
    };
  }
  return next(spec, ctx);
}`));

const { DEFAULTS, deepMerge } = await import("../src/constants.js");
const {
  AgentUsage,
  USAGE_CACHE_VERSION,
  codexStateFiles,
  pickCodexThreadTitle,
  isPlaceholderClientTitle,
} = await import("../src/readers.js");
const { desktopQuery } = await import("../src/desktop-sessions.js");
const { readCursorDbMeta } = await import("../src/cursor-sessions.js");
const {
  loadNodeSqlite,
  querySqliteRows,
  resolveSqliteBinary,
  resetSqliteBinaryCache,
} = await import("../src/sqlite.js");

function withCodexEnv(tmpHome, fn) {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CODEX_HOME: process.env.CODEX_HOME,
  };
  const codexDir = path.join(tmpHome, ".codex");
  process.env.HOME = tmpHome;
  if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
  process.env.CODEX_HOME = codexDir;
  return Promise.resolve()
    .then(() => fn(codexDir))
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function makeUsage() {
  const cfg = deepMerge(DEFAULTS, { fullHistoryDays: 30 });
  return new AgentUsage({ cfg, settings: deepMerge(DEFAULTS, { agents: { codex: true } }), historyAgents: ["codex"] });
}

test("codexStateFiles sorts numerically so state_10.sqlite beats state_5.sqlite", () => {
  assert.deepEqual(
    codexStateFiles(["state_5.sqlite", "state_10.sqlite", "state_2.sqlite", "state_5.sqlite-wal", "other.sqlite"]),
    ["state_2.sqlite", "state_5.sqlite", "state_10.sqlite"],
  );
});

test("querySqliteRows reads checkpointed WAL, active WAL, missing DBs, and CLI fallback", async () => {
  const { DatabaseSync } = loadNodeSqlite();
  assert.ok(DatabaseSync, "Node 24 runtime should expose node:sqlite DatabaseSync");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sqlite-rows-"));
  try {
    const missingDb = path.join(dir, "does-not-exist.sqlite");
    assert.deepEqual(await querySqliteRows(missingDb, "SELECT 1"), []);
    assert.equal(fs.existsSync(missingDb), false, "querySqliteRows must never create missing DB files");

    const dbPath = path.join(dir, "wal-test.sqlite");
    const writer = new DatabaseSync(dbPath);
    writer.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT);
      INSERT INTO threads VALUES ('s1', 'Short Name', 'Long raw prompt');
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    writer.close();
    for (const sfx of ["-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + sfx); } catch { /* ok */ }
    }

    const checkpointRows = await querySqliteRows(dbPath, "SELECT id, name, title FROM threads");
    assert.equal(checkpointRows.length, 1);
    assert.equal(checkpointRows[0].name, "Short Name");

    // Keep an active un-checkpointed WAL writer open concurrently.
    const liveWriter = new DatabaseSync(dbPath);
    liveWriter.exec("INSERT INTO threads VALUES ('s2', 'Live WAL Name', 'Prompt 2');");
    try {
      const liveRows = await querySqliteRows(dbPath, "SELECT id, name FROM threads ORDER BY id");
      assert.deepEqual(
        liveRows.map((r) => [r.id, r.name]),
        [["s1", "Short Name"], ["s2", "Live WAL Name"]],
      );
    } finally {
      liveWriter.close();
    }

    const sqliteBin = resolveSqliteBinary();
    if (path.isAbsolute(sqliteBin) && fs.existsSync(sqliteBin)) {
      const cliRows = await querySqliteRows(dbPath, "SELECT id, name FROM threads ORDER BY id", { useNodeSqlite: false });
      assert.deepEqual(
        cliRows.map((r) => [r.id, r.name]),
        [["s1", "Short Name"], ["s2", "Live WAL Name"]],
      );
    }

    // Missing sqlite3 CLI with useNodeSqlite disabled returns [] silently instead of throwing ENOENT.
    resetSqliteBinaryCache();
    assert.equal(resolveSqliteBinary({ platform: "win32", env: { PATH: dir }, homeDir: dir }), "sqlite3.exe");
    resetSqliteBinaryCache();
    const emptyRows = await querySqliteRows(dbPath, "SELECT id FROM threads", {
      useNodeSqlite: false,
      sqliteBin: path.join(dir, "missing-sqlite3"),
    });
    assert.deepEqual(emptyRows, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("Codex modern state_5.sqlite threads.name and session_index.jsonl never get overwritten by raw first_user_message", async () => {
  const { DatabaseSync } = loadNodeSqlite();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-codex-titles-"));
  const nowSec = Math.floor(Date.now() / 1000);
  const oldSec = nowSec - 60 * 86400; // older than 30 days
  const idBoth = "01a21410-6135-7bf1-b4f8-5bc427f256ee";
  const idNewerDb = "01a2140e-cba0-7e71-92b3-43ed5bad6cab";
  const idNewerIdx = "01a20ed1-f354-7e43-a9cd-0fbb992edecb";
  const idUnnamed = "01a211bc-b4c6-76d0-acbc-cd478b671f46";
  const idOld = "019e638e-b73d-7493-9b40-bae61b64f6a5";
  const idGuardian = "01a18137-9373-7640-8634-04e9cc133b03";
  const idArchived = "01a208d0-4088-73f0-ba55-479c6cc03cf7";

  try {
    await withCodexEnv(tmpHome, async (codexDir) => {
      fs.mkdirSync(codexDir, { recursive: true });
      const rawPayloadPrompt = "可直接发送到新对话）1. 任务目标 在现有成果基础上继续重构模块...";

      // UTF-8 BOM + CRLF + duplicate rename entry (later entry wins)
      const indexLines = [
        JSON.stringify({ id: idBoth, thread_name: "旧名称", updated_at: new Date((nowSec - 200) * 1000).toISOString() }),
        JSON.stringify({ id: idBoth, thread_name: "用户确认后收尾", updated_at: new Date(nowSec * 1000).toISOString() }),
        JSON.stringify({ id: idNewerDb, thread_name: "索引旧名", updated_at: new Date((nowSec - 120) * 1000).toISOString() }),
        JSON.stringify({ id: idNewerIdx, thread_name: "下载抖音视频（重命名）", updated_at: new Date((nowSec + 60) * 1000).toISOString() }),
      ];
      fs.writeFileSync(
        path.join(codexDir, "session_index.jsonl"),
        "\uFEFF" + indexLines.join("\r\n") + "\r\n",
        "utf8",
      );

      // Write both state_5.sqlite and state_10.sqlite to verify numerical sort picks state_10.sqlite
      const olderStateDb = new DatabaseSync(path.join(codexDir, "state_5.sqlite"));
      olderStateDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT, first_user_message TEXT, archived INTEGER DEFAULT 0, updated_at INTEGER);");
      olderStateDb.exec(`INSERT INTO threads VALUES ('${idBoth}', 'WrongOlderState', 'Wrong', 'Wrong', 0, ${nowSec + 999});`);
      olderStateDb.close();

      const db = new DatabaseSync(path.join(codexDir, "state_10.sqlite"));
      db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          name TEXT,
          title TEXT NOT NULL DEFAULT '',
          first_user_message TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0
        );
      `);
      const ins = db.prepare("INSERT INTO threads (id, name, title, first_user_message, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      ins.run(idBoth, "用户确认后收尾", rawPayloadPrompt, rawPayloadPrompt, 0, nowSec);
      ins.run(idNewerDb, "检查 README 状态", rawPayloadPrompt, rawPayloadPrompt, 0, nowSec);
      ins.run(idNewerIdx, "下载抖音视频", "[https://www.douyin.com/video/123]", "[https://www.douyin.com/video/123]", 0, nowSec - 30);
      ins.run(idUnnamed, null, "请只回复 pong 不要执行任何工具", "请只回复 pong 不要执行任何工具", 0, nowSec);
      ins.run(idOld, "六十天前老对话", "老对话很长的第一句提示词", "老对话很长的第一句提示词", 0, oldSec);
      ins.run(idGuardian, null, "Guardian review", "", 0, nowSec);
      ins.run(idArchived, "已归档测试名", "测试", "测试", 1, nowSec);
      db.close();

      const usage = makeUsage();
      await usage.readCodexTitles();
      assert.equal(usage.titles.get(idBoth), "用户确认后收尾");

      // readCodexArchived MUST NOT overwrite with rawPayloadPrompt, even after repeated calls when session_index mtime didn't change
      await usage.readCodexArchived({ force: true });
      await usage.readCodexArchived({ force: true });

      assert.equal(usage.titles.get(idBoth), "用户确认后收尾");
      assert.equal(usage.titles.get(idNewerDb), "检查 README 状态", "newer threads.name beats older session_index");
      assert.equal(usage.titles.get(idNewerIdx), "下载抖音视频（重命名）", "newer session_index beats older threads.name");
      assert.equal(usage.titles.has(idUnnamed), false, "unnamed thread with title == first_user_message must not become clientTitle");
      assert.equal(usage.hasClientTitle(idUnnamed), false);
      assert.equal(usage.titles.get(idOld), "六十天前老对话", "threads older than 30 days keep their DB name");
      assert.equal(usage.titles.get(idGuardian), "Guardian review", "empty first_user_message preserves subagent/custom title");
      assert.equal(usage.titles.get(idArchived), "已归档测试名");
      assert.equal(usage.isArchived(idArchived), true);
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("Codex legacy schemas and .codex-global-state.{json,sqlite} fallbacks behave safely", async () => {
  const { DatabaseSync } = loadNodeSqlite();
  assert.deepEqual(
    pickCodexThreadTitle(
      { title: "Raw prompt prefix", first_user_message: "Raw prompt prefix with more detail" },
      { hasName: false, hasTitle: true, hasFirstUserMsg: true },
    ),
    null,
  );
  assert.deepEqual(
    pickCodexThreadTitle(
      { title: "Curated legacy title", first_user_message: "Completely different first prompt" },
      { hasName: false, hasTitle: true, hasFirstUserMsg: true },
    ),
    { title: "Curated legacy title", source: "title" },
  );

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-codex-legacy-"));
  const nowSec = Math.floor(Date.now() / 1000);
  const idLegacyClobberGuard = "01a2140f-c627-7433-a136-6092d160f899";
  const idLegacyDbOnly = "01a202fc-9ea5-7321-8ca4-ceaf4f1a5cb9";
  const idGlobalJson = "019f665b-d02e-78d3-81d0-a6313d83d68b";
  const idGlobalSqlite = "01a1d095-000e-75c1-9ab4-ba326b146cfd";

  try {
    await withCodexEnv(tmpHome, async (codexDir) => {
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, "session_index.jsonl"),
        JSON.stringify({ id: idLegacyClobberGuard, thread_name: "索引真标题", updated_at: new Date((nowSec - 500) * 1000).toISOString() }) + "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(codexDir, ".codex-global-state.json"),
        "\uFEFF" + JSON.stringify({
          "thread-titles": {
            titles: {
              [idGlobalJson]: "Global JSON 兜底标题",
              [idLegacyClobberGuard]: "不应覆盖索引的旧全局标题",
            },
          },
        }),
        "utf8",
      );

      const gDb = new DatabaseSync(path.join(codexDir, ".codex-global-state.sqlite"));
      gDb.exec("CREATE TABLE settings (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key)) WITHOUT ROWID;");
      gDb.prepare("INSERT INTO settings (scope, key, value) VALUES (?, ?, ?)").run(
        "global",
        "thread-titles",
        JSON.stringify({ titles: { [idGlobalSqlite]: "Global SQLite 兜底标题" } }),
      );
      gDb.close();

      // Legacy state_1.sqlite without `name` or `first_user_message`
      const db = new DatabaseSync(path.join(codexDir, "state_1.sqlite"));
      db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, archived INTEGER DEFAULT 0, updated_at INTEGER);");
      db.prepare("INSERT INTO threads VALUES (?, ?, 0, ?)").run(idLegacyClobberGuard, "老库疑似首句标题", nowSec + 500);
      db.prepare("INSERT INTO threads VALUES (?, ?, 0, ?)").run(idLegacyDbOnly, "仅老库有的标题", nowSec);
      db.close();

      const usage = makeUsage();
      await usage.readCodexTitles();
      await usage.readCodexArchived({ force: true });

      assert.equal(usage.titles.get(idLegacyClobberGuard), "索引真标题", "legacy-title must not overwrite session_index");
      assert.equal(usage.titles.get(idLegacyDbOnly), "仅老库有的标题");
      assert.equal(usage.titles.get(idGlobalJson), "Global JSON 兜底标题");
      assert.equal(usage.titles.get(idGlobalSqlite), "Global SQLite 兜底标题");
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("End-to-end AgentUsage.scan() with rollout JSONL + state_5.sqlite + session_index.jsonl and USAGE_CACHE_VERSION >= 27", async () => {
  assert.ok(USAGE_CACHE_VERSION >= 27);
  const { DatabaseSync } = loadNodeSqlite();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-codex-e2e-"));
  const sidNamed = "01a218e1-4376-7eb3-bdd7-fb212a7caa95";
  const sidUnnamed = "01a218e1-0fb6-7af3-832c-f4492dca9614";
  const nowIso = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);

  const writeRollout = (file, sid, promptText) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [
      JSON.stringify({ timestamp: nowIso, type: "session_meta", payload: { id: sid, cwd: "D:\\work\\repo", originator: "Codex Desktop" } }),
      JSON.stringify({ timestamp: nowIso, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: promptText }] } }),
      JSON.stringify({ timestamp: nowIso, type: "event_msg", payload: { type: "task_complete" } }),
    ];
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  };

  try {
    await withCodexEnv(tmpHome, async (codexDir) => {
      const sessDir = path.join(codexDir, "sessions", "2026", "11", "27");
      const rawPrompt = "1. 任务目标 在现有成果基础上继续重构并返回结果";
      writeRollout(path.join(sessDir, `rollout-2026-11-27T12-00-00-${sidNamed}.jsonl`), sidNamed, rawPrompt);
      writeRollout(path.join(sessDir, `rollout-2026-11-27T12-01-00-${sidUnnamed}.jsonl`), sidUnnamed, "普通首句未命名会话");

      fs.writeFileSync(
        path.join(codexDir, "session_index.jsonl"),
        JSON.stringify({ id: sidNamed, thread_name: "重构目标模块", updated_at: nowIso }) + "\n",
        "utf8",
      );

      const db = new DatabaseSync(path.join(codexDir, "state_5.sqlite"));
      db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT, first_user_message TEXT, archived INTEGER DEFAULT 0, updated_at INTEGER);");
      db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, 0, ?)").run(sidNamed, "重构目标模块", rawPrompt, rawPrompt, nowSec);
      db.prepare("INSERT INTO threads VALUES (?, NULL, ?, ?, 0, ?)").run(sidUnnamed, "普通首句未命名会话", "普通首句未命名会话", nowSec);
      db.close();

      const usage = makeUsage();
      await usage.scan();
      const sessions = usage.sessions({ limit: 10 });
      const sNamed = sessions.find((s) => s.sid === sidNamed);
      const sUnnamed = sessions.find((s) => s.sid === sidUnnamed);

      assert.ok(sNamed);
      assert.equal(sNamed.title, "重构目标模块");
      assert.equal(sNamed.clientTitle, true);

      assert.ok(sUnnamed);
      assert.equal(sUnnamed.clientTitle, false, "unnamed session falls back to prompt without claiming clientTitle");
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("Unified title layer: summary() never overwrites client titles with prompt fallbacks (WorkBuddy & Antigravity) and resetTitles clears state", async () => {
  const { DatabaseSync } = loadNodeSqlite();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-unified-titles-"));
  const nowMs = Date.now();
  const wbSid = "wb-sess-0001-0000-0000-000000000001";
  const agSid = "ag-sess-0001";
  const day = DEFAULTS ? `${new Date(nowMs).getFullYear()}-${String(new Date(nowMs).getMonth() + 1).padStart(2, "0")}-${String(new Date(nowMs).getDate()).padStart(2, "0")}` : "";
  assert.ok(day);

  try {
    await withCodexEnv(tmpHome, async () => {
      // WorkBuddy DB custom_title
      const wbDir = path.join(tmpHome, ".workbuddy");
      fs.mkdirSync(path.join(wbDir, "projects", "proj1"), { recursive: true });
      const wbDb = new DatabaseSync(path.join(wbDir, "workbuddy.db"));
      wbDb.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, cwd TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL DEFAULT 'u1',
          title TEXT, custom_title TEXT, status TEXT NOT NULL DEFAULT 'completed',
          created_at INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER, model TEXT DEFAULT '', group_title TEXT DEFAULT ''
        );
      `);
      wbDb.prepare("INSERT INTO sessions (id, cwd, title, custom_title) VALUES (?, ?, ?, ?)").run(
        wbSid, tmpHome, "Initial DB Title", "用户自定义 WorkBuddy 标题",
      );
      wbDb.close();

      const usage = new AgentUsage({
        cfg: deepMerge(DEFAULTS, { fullHistoryDays: 14 }),
        settings: deepMerge(DEFAULTS, { agents: { workbuddy: true, antigravity: true } }),
        historyAgents: ["workbuddy", "antigravity"],
      });
      await usage.readCodexArchived({ force: true });

      const touched = new Set();
      const wbFile = path.join(wbDir, "projects", "proj1", `${wbSid}.jsonl`);
      const wbFc = usage.ensureFile(wbFile, "workbuddy");
      usage.ingestWorkbuddy(JSON.stringify({
        type: "message", role: "user", timestamp: nowMs, id: "m1",
        cwd: tmpHome, content: [{ type: "input_text", text: "这是一句很长的 WorkBuddy 原始用户首句，不应该覆盖 custom_title" }],
      }), wbFc, touched);

      const agFc = usage.ensureFile(path.join(tmpHome, ".gemini/antigravity/brain", agSid, ".system_generated/logs/transcript.jsonl"), "antigravity");
      usage.ingestAntigravity(JSON.stringify({
        type: "USER_INPUT", created_at: new Date(nowMs).toISOString(), step_index: 0,
        content: "Antigravity 原始长提问只该做兜底标题，不能进 clientTitles",
      }), agFc, touched);

      for (const dKey of touched) usage.summary(dKey);

      assert.equal(usage.titles.get(wbSid), "用户自定义 WorkBuddy 标题", "summary() preserves WorkBuddy custom_title");
      assert.equal(usage.hasClientTitle(wbSid), true);
      assert.equal(usage.titles.has(agSid), false, "Antigravity raw prompt must never leak into usage.titles");
      assert.equal(usage.hasClientTitle(agSid), false);
      assert.ok(usage.meta.get(agSid)?.title.includes("Antigravity 原始长提问"), "meta.title still keeps prompt fallback");

      usage.resetTitles();
      assert.equal(usage.titles.size, 0);
      assert.equal(usage.clientTitles.size, 0);
      assert.equal(usage.customTitles.size, 0);
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("Claude Desktop placeholder titles ('Side chat') are filtered and titleSource:'user' overrides previous custom-title", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-claude-titles-"));
  const sidSide = "289efb1c-0000-4000-8000-000000000001";
  const sidRename = "8328558d-0000-4000-8000-000000000002";
  const nowIso = new Date().toISOString();
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevAppData = process.env.APPDATA;

  assert.equal(isPlaceholderClientTitle("Side chat"), true);
  assert.equal(isPlaceholderClientTitle("  new thread "), true);
  assert.equal(isPlaceholderClientTitle("新对话"), true);
  assert.equal(isPlaceholderClientTitle("真实任务标题"), false);

  try {
    await withCodexEnv(tmpHome, async () => {
      const configBase = process.platform === "darwin"
        ? path.join(tmpHome, "Library/Application Support")
        : process.platform === "win32"
          ? path.join(tmpHome, "AppData/Roaming")
          : path.join(tmpHome, ".config");
      if (process.platform === "win32") process.env.APPDATA = configBase;
      if (process.platform === "linux") process.env.XDG_CONFIG_HOME = configBase;

      const deskDir = path.join(configBase, "Claude/claude-code-sessions/org/proj");
      fs.mkdirSync(deskDir, { recursive: true });
      fs.writeFileSync(path.join(deskDir, "local_side.json"), JSON.stringify({
        sessionId: "local_side", cliSessionId: sidSide, title: "Side chat", titleSource: "auto",
        createdAt: Date.now(), lastActivityAt: Date.now(), isArchived: false,
      }));
      fs.writeFileSync(path.join(deskDir, "local_rename.json"), JSON.stringify({
        sessionId: "local_rename", cliSessionId: sidRename, title: "桌面端用户手动重命名", titleSource: "user",
        createdAt: Date.now(), lastActivityAt: Date.now(), isArchived: false,
      }));

      const projDir = path.join(tmpHome, ".claude/projects/test-proj");
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, `${sidSide}.jsonl`), [
        JSON.stringify({ type: "user", timestamp: nowIso, sessionId: sidSide, cwd: tmpHome, message: { content: "请评估方案" } }),
        JSON.stringify({ type: "custom-title", customTitle: "事实与逻辑评估", sessionId: sidSide }),
      ].join("\n") + "\n");
      fs.writeFileSync(path.join(projDir, `${sidRename}.jsonl`), [
        JSON.stringify({ type: "user", timestamp: nowIso, sessionId: sidRename, cwd: tmpHome, message: { content: "日志快照" } }),
        JSON.stringify({ type: "custom-title", customTitle: "早期 JSONL 命名", sessionId: sidRename }),
      ].join("\n") + "\n");

      const usage = new AgentUsage({
        cfg: deepMerge(DEFAULTS, { fullHistoryDays: 14 }),
        settings: deepMerge(DEFAULTS, { agents: { claude: true }, claudeDesktop: true }),
        historyAgents: ["claude"],
      });
      await usage.scan();

      assert.equal(usage.titles.get(sidSide), "事实与逻辑评估", "'Side chat' placeholder must not replace real JSONL custom-title");
      assert.equal(usage.titles.get(sidRename), "桌面端用户手动重命名", "titleSource:'user' desktop rename overrides earlier custom-title");
      assert.equal(usage.meta.get(sidRename)?.title, "桌面端用户手动重命名");
    });
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("Desktop SQLite adapters: revision-invariant renames propagate immediately and desktopQuery / readCursorDbMeta use node:sqlite", async () => {
  const { DatabaseSync } = loadNodeSqlite();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-desktop-titles-"));
  const prevHermes = process.env.HERMES_HOME;
  const sid = "hermes-rename-001";
  const cursorSid = "11111111-2222-3333-4444-555555555555";
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    await withCodexEnv(tmpHome, async () => {
      const hermesDir = path.join(tmpHome, ".hermes");
      fs.mkdirSync(hermesDir, { recursive: true });
      process.env.HERMES_HOME = hermesDir;
      const hDbPath = path.join(hermesDir, "state.db");
      const hDb = new DatabaseSync(hDbPath);
      hDb.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, title TEXT,
          started_at REAL NOT NULL, ended_at REAL, end_reason TEXT, last_activity_at REAL,
          cwd TEXT, parent_session_id TEXT, hidden INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
          message_count INTEGER DEFAULT 1, input_tokens INTEGER DEFAULT 10, output_tokens INTEGER DEFAULT 20,
          cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0
        );
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
          content TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
          finish_reason TEXT, active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0
        );
      `);
      hDb.prepare("INSERT INTO sessions (id, source, model, title, started_at, ended_at, last_activity_at, cwd) VALUES (?, 'local', 'hermes-3', ?, ?, ?, ?, ?)").run(
        sid, "初始 Hermes 标题", nowSec, nowSec, nowSec, tmpHome,
      );
      hDb.prepare("INSERT INTO messages (session_id, role, content, timestamp, finish_reason) VALUES (?, 'user', 'hi', ?, 'stop')").run(sid, nowSec);
      hDb.close();

      // desktopQuery should work via node:sqlite and still throw on invalid SQL
      const qRows = await desktopQuery(hDbPath, "SELECT id, title FROM sessions");
      assert.equal(qRows[0].title, "初始 Hermes 标题");
      await assert.rejects(() => desktopQuery(hDbPath, "SELECT * FROM nonexistent_table"));

      const usage = new AgentUsage({
        cfg: deepMerge(DEFAULTS, { fullHistoryDays: 14 }),
        settings: deepMerge(DEFAULTS, { agents: { hermes: true } }),
        historyAgents: ["hermes"],
      });
      await usage.scan();
      assert.equal(usage.titles.get(sid), "初始 Hermes 标题");

      // Rename title ONLY without changing timestamps/counts (same revision!)
      const hDb2 = new DatabaseSync(hDbPath);
      hDb2.prepare("UPDATE sessions SET title = ? WHERE id = ?").run("重命名后的 Hermes 标题", sid);
      hDb2.close();

      await usage.scan();
      assert.equal(usage.titles.get(sid), "重命名后的 Hermes 标题");
      assert.equal(usage.meta.get(sid)?.title, "重命名后的 Hermes 标题");

      // Verify Cursor DB meta enrichment via node:sqlite
      const trackDir = path.join(tmpHome, ".cursor", "ai-tracking");
      fs.mkdirSync(trackDir, { recursive: true });
      const trackDb = new DatabaseSync(path.join(trackDir, "ai-code-tracking.db"));
      trackDb.exec("CREATE TABLE conversation_summaries (conversationId TEXT PRIMARY KEY, title TEXT, model TEXT);");
      trackDb.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?)").run(cursorSid, "Cursor 本地标题", "claude-4.5");
      trackDb.close();

      const cursorMeta = await readCursorDbMeta([cursorSid], { homeDir: tmpHome });
      assert.equal(cursorMeta.get(cursorSid)?.title, "Cursor 本地标题");
      assert.equal(cursorMeta.get(cursorSid)?.model, "claude-4.5");
    });
  } finally {
    if (prevHermes === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = prevHermes;
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

