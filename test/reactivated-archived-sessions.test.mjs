import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

const { DEFAULTS, deepMerge, dayKey, dayKeyToday, dayMinute, startOfDay } = await import("../src/constants.js");
const { AgentUsage } = await import("../src/readers.js");
const { AutoLog } = await import("../src/autolog.js");
const { JournalSync } = await import("../src/sync.js");
const { planJournal, renderJournal } = await import("../src/organize-journal.js");
const { archiveCompletedTo } = await import("../src/journal-archive.js");
const { applyStatusChoice, suggestedStatus } = await import("../src/task-status.js");
const { resolveSqliteBinary } = await import("../src/sqlite.js");
const J = await import("../src/journal.js");

function makeVaultPlugin({ files = {}, meta = {}, summaryByDay = {}, cfg = {}, archived = [], archivedClaude = [] } = {}) {
  const settings = deepMerge(DEFAULTS, cfg);
  const store = { ...files };
  const fileObjs = new Map(Object.keys(store).map((p) => [p, { path: p, basename: path.basename(p, ".md"), extension: "md" }]));
  const metaMap = new Map(Object.entries(meta));
  const archivedSet = new Set(archived);
  const archivedClaudeSet = new Set(archivedClaude);
  const usage = {
    meta: metaMap,
    archived: archivedSet,
    archivedClaude: archivedClaudeSet,
    summary: (d) => summaryByDay[d] || null,
    isArchived: (sid) => archivedClaudeSet.has(sid) || archivedSet.has(sid) || !!metaMap.get(sid)?.archived,
    hidden: (sid) => (settings.hideArchived === false ? false : usage.isArchived(sid)),
  };
  const plugin = {
    settings,
    usage,
    jobs: {},
    app: {
      vault: {
        getAbstractFileByPath: (p) => fileObjs.get(p) || null,
        read: async (f) => store[f.path] ?? "",
        process: async (f, fn) => { store[f.path] = fn(store[f.path] ?? ""); },
        createFolder: async () => {},
        create: async (p, content) => {
          const f = { path: p, basename: path.basename(p, ".md"), extension: "md" };
          fileObjs.set(p, f);
          store[p] = content;
          return f;
        },
      },
      workspace: { iterateAllLeaves() {} },
      plugins: { plugins: {} },
    },
    readNote: async (p) => store[p] ?? "",
    viewForPath: () => null,
    saveSettings: async () => {},
    refreshUI() {},
    markBound(sid, blockId = "", key = "", extra = null) {
      if (!sid) return;
      const day = dayKeyToday(settings);
      const st = ((settings.autoLogState ||= {})[day] ||= {});
      const prev = st[sid] || {};
      st[sid] = {
        ...prev,
        skip: true,
        bound: true,
        ...(blockId ? { blockId } : {}),
        ...(key ? { key } : {}),
        ...(extra && typeof extra === "object" ? extra : {}),
      };
    },
    _store: store,
  };
  return plugin;
}

test("WorkBuddy DB deleted_at=-1 is not archived and force refresh clears unarchived sessions without wiping desktop DB IDs", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wb-arch-"));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  try {
    process.env.HOME = tmpHome;
    if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
    const wbDir = path.join(tmpHome, ".workbuddy");
    fs.mkdirSync(wbDir, { recursive: true });
    const wbDb = path.join(wbDir, "workbuddy.db");
    const sqlite = resolveSqliteBinary();
    execFileSync(sqlite, [
      wbDb,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT 'u1',
        title TEXT,
        custom_title TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT 1,
        deleted_at INTEGER,
        model TEXT DEFAULT '',
        group_title TEXT DEFAULT ''
      );
      INSERT INTO sessions (id, title, status, deleted_at) VALUES
        ('wb-arch', 'Archived WB', 'archived', NULL),
        ('wb-cloud', 'Cloud WB', 'completed', -1),
        ('wb-del', 'Deleted WB', 'completed', 1791402389326),
        ('wb-active', 'Active WB', 'completed', NULL);`,
    ]);

    const usage = new AgentUsage({ cfg: deepMerge(DEFAULTS, {}), settings: deepMerge(DEFAULTS, {}) });
    usage.archived.add("desktop-t3-arch");
    usage.meta.set("wb-arch", { sid: "wb-arch", agent: "workbuddy", archived: false });
    usage.meta.set("wb-cloud", { sid: "wb-cloud", agent: "workbuddy", archived: true });

    await usage.readCodexArchived();
    assert.equal(usage.isArchived("wb-arch"), true);
    assert.equal(usage.isArchived("wb-del"), true);
    assert.equal(usage.isArchived("wb-cloud"), false, "deleted_at = -1 sentinel must not mark cloud session archived");
    assert.equal(usage.isArchived("wb-active"), false);
    assert.equal(usage.isArchived("desktop-t3-arch"), true, "desktop DB archived IDs survive readCodexArchived");
    assert.equal(usage.meta.get("wb-arch").archived, true);
    assert.equal(usage.meta.get("wb-cloud").archived, false);

    // Unarchive wb-arch in workbuddy.db and force immediate refresh within 15s throttle window
    execFileSync(sqlite, [wbDb, `UPDATE sessions SET status = 'completed' WHERE id = 'wb-arch';`]);
    await usage.readCodexArchived({ force: false });
    assert.equal(usage.isArchived("wb-arch"), true, "throttled read keeps cached value");
    await usage.readCodexArchived({ force: true });
    assert.equal(usage.isArchived("wb-arch"), false, "force refresh immediately detects WorkBuddy unarchive");
    assert.equal(usage.meta.get("wb-arch").archived, false);
    assert.equal(usage.isArchived("desktop-t3-arch"), true);
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("isArchived, AutoLog.archived, JournalSync.archived and suggestedStatus respect archived/archivedClaude/meta.archived across all agents", () => {
  const agents = ["workbuddy", "claude", "codex", "qoder", "cindy", "orca", "t3code", "kimicode", "cursor", "dsh", "hermes", "minimax", "opencode"];
  const usage = new AgentUsage({ cfg: deepMerge(DEFAULTS, {}), settings: deepMerge(DEFAULTS, {}) });
  const settings = deepMerge(DEFAULTS, {});
  const plugin = { settings, usage };
  const al = new AutoLog(plugin);
  const sync = new JournalSync(plugin);

  for (const agent of agents) {
    const sid = `sid-${agent}-arch`;
    usage.meta.set(sid, { sid, agent, state: "wait", archived: true });
    assert.equal(usage.isArchived(sid), true, `${agent}: usage.isArchived true when meta.archived=true`);
    assert.equal(al.archived().has(sid), true, `${agent}: AutoLog.archived includes meta.archived`);
    assert.equal(sync.archived(sid), true, `${agent}: JournalSync.archived includes meta.archived`);
    assert.equal(suggestedStatus(settings, usage, `- DOING 任务\n\t- 🔗 [Agent](obsidian://agent-deck?do=open&agent=${agent}&sid=${sid})`, 0), "DONE", `${agent}: suggestedStatus returns DONE`);

    usage.meta.get(sid).archived = false;
    assert.equal(usage.isArchived(sid), false, `${agent}: usage.isArchived clears when unarchived`);
    assert.equal(al.archived().has(sid), false, `${agent}: AutoLog.archived clears when unarchived`);
    assert.equal(sync.archived(sid), false, `${agent}: JournalSync.archived clears when unarchived`);
    assert.equal(suggestedStatus(settings, usage, `- DONE 任务\n\t- 🔗 [Agent](obsidian://agent-deck?do=open&agent=${agent}&sid=${sid})`, 0), "TOREVIEW", `${agent}: suggestedStatus returns TOREVIEW after unarchive`);
  }
});

test("same-day archived session reactivates in-place (active and idle, repeatable) across all tracked agents", async () => {
  const agents = ["workbuddy", "claude", "codex", "qoder", "cindy", "orca", "t3code", "kimicode", "cursor", "dsh", "hermes", "minimax", "opencode"];
  const cfg = { dayCutoff: 0, autoLog: true, autoLogMinMinutes: 1 };
  const today = dayKeyToday(cfg);
  const dayStart = startOfDay(Date.now(), cfg);
  const journalPath = `日记/${today}.md`;

  for (const agent of agents) {
    for (const activeOnReactivate of [true, false]) {
      const sid = `11111111-2222-4333-8444-${agent.padEnd(12, "0").slice(0, 12)}-${activeOnReactivate ? "1" : "0"}`;
      const t1 = dayStart + 600 * 60000;
      const t2 = dayStart + 660 * 60000;
      const t3 = dayStart + 720 * 60000;
      const meta = {
        [sid]: {
          sid,
          agent,
          state: "wait",
          startedAt: t1,
          lastAt: t1 + 5 * 60000,
          lastText: "完成第一轮",
          rounds: [{ n: 1, at: t1, ask: "第一问", said: "完成第一轮" }],
          archived: false,
        },
      };
      const list = [{ sid, agent, min: 5, segs: [[600, 605]], title: `${agent} 会话` }];
      const p = makeVaultPlugin({
        files: { [journalPath]: "" },
        meta,
        summaryByDay: { [today]: { list } },
        cfg,
      });
      const al = new AutoLog(p);
      al.nowMin = () => 606;
      al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, { label: `${agent} 跟踪任务`, slug: `${agent}-task`, summary: "完成第一轮", matchKey: null, done: false, todos: [], skip: false }]));

      // 1. Initial log
      await al.run({ manual: true });
      assert.ok(p._store[journalPath].includes(`${agent} 跟踪任务`), `${agent}: initial task logged`);

      // 2. Archive -> DONE -> organizeJournal moves to ## 已完成
      p.usage.meta.get(sid).archived = true;
      await al.run({ manual: true });
      assert.ok(p._store[journalPath].includes("- DONE 🤖"), `${agent}: archived marks DONE`);
      const organized = renderJournal(planJournal(p._store[journalPath], { archived: al.archived(), layout: undefined }));
      p._store[journalPath] = organized;
      assert.ok(organized.includes("## 已完成\n- DONE 🤖"), `${agent}: organized into 已完成`);

      // 3. Unarchive + new round -> AutoLog reopens & restores blockId -> organize moves back to ## 正在做
      p.usage.meta.get(sid).archived = false;
      p.usage.meta.get(sid).state = activeOnReactivate ? "run" : "wait";
      p.usage.meta.get(sid).lastAt = t2 + 4 * 60000;
      p.usage.meta.get(sid).lastText = "完成第二轮";
      p.usage.meta.get(sid).rounds.push({ n: 2, at: t2, ask: "继续第二问", said: "完成第二轮" });
      list[0].segs = [[600, 605], [660, 664]];
      list[0].min = 9;
      al.nowMin = () => (activeOnReactivate ? 665 : 690);
      await al.run({ manual: true });

      const afterReactivate = p._store[journalPath];
      const expectedKw = activeOnReactivate ? "DOING" : "PAUSED";
      assert.ok(afterReactivate.includes(`- ${expectedKw} 🤖`), `${agent} (${expectedKw}): reopened from DONE:\n${afterReactivate}`);
      assert.ok(/\^[a-z0-9-]+/m.test(afterReactivate.split("\n").find((l) => l.includes(`${agent} 跟踪任务`)) || ""), `${agent}: restored blockId`);
      if (activeOnReactivate) {
        p.usage.meta.get(sid).state = "wait";
        await al.run({ manual: true });
      }
      assert.ok(p._store[journalPath].includes("完成第二轮"), `${agent}: appended round 2`);

      const reOrganized = renderJournal(planJournal(p._store[journalPath], { archived: al.archived() }));
      p._store[journalPath] = reOrganized;
      assert.ok(reOrganized.includes("## 正在做") && reOrganized.indexOf(`${agent} 跟踪任务`) > reOrganized.indexOf("## 正在做") && reOrganized.indexOf(`${agent} 跟踪任务`) < reOrganized.indexOf("## 已完成"), `${agent}: moved back to active band:\n${reOrganized}`);

      // 4. Second cycle: archive again -> DONE -> unarchive -> reopen again
      p.usage.meta.get(sid).archived = true;
      await al.run({ manual: true });
      assert.ok(p._store[journalPath].includes("- DONE 🤖"), `${agent}: second archive marks DONE`);

      p.usage.meta.get(sid).archived = false;
      p.usage.meta.get(sid).state = "run";
      p.usage.meta.get(sid).lastAt = t3 + 3 * 60000;
      p.usage.meta.get(sid).rounds.push({ n: 3, at: t3, ask: "第三问", said: "完成第三轮" });
      list[0].segs.push([720, 723]);
      list[0].min = 12;
      al.nowMin = () => 724;
      await al.run({ manual: true });
      assert.ok(p._store[journalPath].includes("- DOING 🤖"), `${agent}: second reactivation reopens to DOING`);
      p.usage.meta.get(sid).state = "wait";
      await al.run({ manual: true });
      assert.ok(p._store[journalPath].includes("完成第三轮"), `${agent}: appended round 3`);
    }
  }
});

test("archived block moved out via archiveCompletedTo (rec.gone) logs fresh block on reactivation while deleted active block stays gone", async () => {
  const cfg = { dayCutoff: 0, autoLog: true, autoLogMinMinutes: 1 };
  const today = dayKeyToday(cfg);
  const dayStart = startOfDay(Date.now(), cfg);
  const journalPath = `日记/${today}.md`;
  const archivePath = "Agent Deck/done/已完成.md";
  const sid = "wb-archived-out-1";
  const sidDeleted = "wb-deleted-active-2";

  const meta = {
    [sid]: { sid, agent: "workbuddy", state: "wait", startedAt: dayStart + 600 * 60000, lastAt: dayStart + 605 * 60000, lastText: "初版完成", rounds: [{ n: 1, at: dayStart + 600 * 60000, ask: "做第一版", said: "初版完成" }], archived: false },
    [sidDeleted]: { sid: sidDeleted, agent: "codex", state: "wait", startedAt: dayStart + 600 * 60000, lastAt: dayStart + 605 * 60000, rounds: [{ n: 1, at: dayStart + 600 * 60000, ask: "删掉的", said: "ok" }], archived: false },
  };
  const list = [
    { sid, agent: "workbuddy", min: 5, segs: [[600, 605]], title: "第一版" },
    { sid: sidDeleted, agent: "codex", min: 5, segs: [[600, 605]], title: "被删掉的活跃任务" },
  ];
  const p = makeVaultPlugin({ files: { [journalPath]: "" }, meta, summaryByDay: { [today]: { list } }, cfg });
  const al = new AutoLog(p);
  p.autoLog = al;
  al.nowMin = () => 606;
  al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, { label: x.title, slug: "task", summary: "ok", matchKey: null, done: false, todos: [], skip: false }]));

  await al.run({ manual: true });
  // Delete the active non-done task from the note
  p._store[journalPath] = p._store[journalPath].split("\n").filter((l) => !l.includes("被删掉的活跃任务")).join("\n");
  // Archive wb session -> DONE -> archiveCompletedTo moves it out
  p.usage.meta.get(sid).archived = true;
  await al.run({ manual: true });
  assert.equal(p.settings.autoLogState[today][sidDeleted].gone, true);

  const file = p.app.vault.getAbstractFileByPath(journalPath);
  const plan = planJournal(p._store[journalPath], {
    tracked: new Map([[p.settings.autoLogState[today][sid].blockId, new Set([sid])]]),
    archived: al.archived(),
  });
  await archiveCompletedTo(p, file, p._store[journalPath], plan, { path: archivePath });
  assert.ok(!p._store[journalPath].includes("第一版"));
  assert.ok(p._store[archivePath].includes("第一版"));
  assert.equal(p.settings.autoLogState[today][sid].archivedOut, true);
  assert.equal(p.settings.autoLogState[today][sid].gone, true);

  // Reactivate wb session -> creates new block in today's journal; deleted active codex task stays gone
  p.usage.meta.get(sid).archived = false;
  p.usage.meta.get(sid).state = "run";
  p.usage.meta.get(sid).lastAt = dayStart + 704 * 60000;
  p.usage.meta.get(sid).rounds.push({ n: 2, at: dayStart + 700 * 60000, ask: "继续改", said: "第二版完成" });
  list[0].segs = [[600, 605], [700, 704]];
  list[0].min = 9;
  list[1].segs = [[600, 605], [700, 704]];
  al.nowMin = () => 705;
  al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, { label: "继续第二版", slug: "v2", summary: "第二版完成", matchKey: null, done: false, todos: [], skip: false }]));

  await al.run({ manual: true });
  assert.ok(p._store[journalPath].includes("继续第二版"), `expected reactivated entry in today's journal, got:\n${p._store[journalPath]}`);
  assert.ok(!p._store[journalPath].includes("初版完成"), "must not duplicate round 1 already moved to archive");
  assert.ok(!p._store[journalPath].includes("被删掉的活跃任务"), "user-deleted active task stays ignored");
});

test("cross-day archived/finished sessions reactivate in today's journal while genuine overnight active sessions stay in yesterday's journal", async () => {
  const cfg = { dayCutoff: 0, autoLog: true, autoLogMinMinutes: 1 };
  const todayStart = startOfDay(Date.now(), cfg);
  const today = dayKey(todayStart + 12 * 3600000, cfg);
  const yesterday = dayKey(todayStart - 12 * 3600000, cfg);
  const threeDaysAgo = dayKey(todayStart - 72 * 3600000, cfg);

  const sidDoneState = "cross-done-state";
  const sidDoneNote = "cross-done-note";
  const sidBoundFinish = "cross-bound-finish";
  const sidOldUntracked = "cross-old-untracked";
  const sidOvernight = "cross-overnight-open";

  const yFile = `日记/${yesterday}.md`;
  const tFile = `日记/${today}.md`;
  const yText = [
    `- DONE 🤖 14:00-14:10 **前日状态已完** ^wb-d1`,
    `- DONE 🤖 15:00-15:10 **前日仅笔记完** ^wb-d2`,
    `- DONE 16:10 绑定完成任务`,
    `\t- 🔗 [WorkBuddy：绑定完成任务](workbuddy://chat/${sidBoundFinish})`,
    `- DOING 🤖 23:40-23:55 **跨夜未完任务** ^codex-over`,
  ].join("\n");

  const meta = {
    [sidDoneState]: { sid: sidDoneState, agent: "workbuddy", state: "run", startedAt: todayStart - 10 * 3600000, lastAt: todayStart + 605 * 60000, rounds: [{ n: 1, at: todayStart - 10 * 3600000, ask: "昨天", said: "昨完" }, { n: 2, at: todayStart + 600 * 60000, ask: "今天继续", said: "今天做" }] },
    [sidDoneNote]: { sid: sidDoneNote, agent: "claude", state: "run", startedAt: todayStart - 9 * 3600000, lastAt: todayStart + 615 * 60000, rounds: [{ n: 1, at: todayStart - 9 * 3600000, ask: "昨天2", said: "昨完2" }, { n: 2, at: todayStart + 610 * 60000, ask: "今天继续2", said: "今天做2" }] },
    [sidBoundFinish]: { sid: sidBoundFinish, agent: "workbuddy", state: "run", startedAt: todayStart - 8 * 3600000, lastAt: todayStart + 625 * 60000, rounds: [{ n: 1, at: todayStart - 8 * 3600000, ask: "昨天绑定", said: "昨完3" }, { n: 2, at: todayStart + 620 * 60000, ask: "今天激活", said: "今天做3" }] },
    [sidOldUntracked]: { sid: sidOldUntracked, agent: "qoder", state: "run", startedAt: todayStart - 70 * 3600000, lastAt: todayStart + 635 * 60000, rounds: [{ n: 1, at: todayStart - 70 * 3600000, ask: "三天前", said: "旧" }, { n: 2, at: todayStart + 630 * 60000, ask: "今天再问", said: "新" }] },
    [sidOvernight]: { sid: sidOvernight, agent: "codex", state: "wait", startedAt: todayStart - 20 * 60000, lastAt: todayStart + 10 * 60000, rounds: [{ n: 1, at: todayStart - 20 * 60000, ask: "跨夜", said: "继续中" }] },
  };

  const todayList = [
    { sid: sidDoneState, agent: "workbuddy", min: 5, segs: [[600, 605]], title: "状态已完" },
    { sid: sidDoneNote, agent: "claude", min: 5, segs: [[610, 615]], title: "仅笔记完" },
    { sid: sidBoundFinish, agent: "workbuddy", min: 5, segs: [[620, 625]], title: "绑定激活" },
    { sid: sidOldUntracked, agent: "qoder", min: 5, segs: [[630, 635]], title: "三天前激活" },
    { sid: sidOvernight, agent: "codex", min: 10, segs: [[0, 10]], title: "跨夜未完" },
  ];
  const yList = [
    { sid: sidOvernight, agent: "codex", min: 15, segs: [[1420, 1435]], title: "跨夜未完" },
  ];

  const p = makeVaultPlugin({
    files: { [yFile]: yText, [tFile]: "", [`日记/${threeDaysAgo}.md`]: "- DONE 旧\n" },
    meta,
    summaryByDay: { [today]: { list: todayList }, [yesterday]: { list: yList } },
    cfg: {
      ...cfg,
      autoLogState: {
        [yesterday]: {
          [sidDoneState]: { key: "🤖 前日状态已完", label: "🤖 前日状态已完", blockId: "wb-d1", status: "done", archivedDone: true, doneEndMs: todayStart - 9 * 3600000 },
          [sidDoneNote]: { key: "🤖 前日仅笔记完", label: "🤖 前日仅笔记完", blockId: "wb-d2", status: "doing" },
          [sidBoundFinish]: { key: "绑定完成任务", label: "绑定完成任务", skip: true, bound: true, status: "done", archivedDone: true, doneEndMs: todayStart - 7 * 3600000 },
          [sidOvernight]: { key: "🤖 跨夜未完任务", label: "🤖 跨夜未完任务", blockId: "codex-over", status: "doing" },
        },
      },
    },
  });

  const al = new AutoLog(p);
  al.nowMin = () => 636;
  al.ask = async (items) => new Map(items.map(({ x }) => [x.sid, { label: `今日-${x.title}`, slug: "reactivated", summary: "今天更新", matchKey: null, done: false, todos: [], skip: false }]));

  await al.run({ manual: true });
  const todayOut = p._store[tFile];
  const yOut = p._store[yFile];

  assert.ok(todayOut.includes("今日-状态已完"), `sidDoneState should land in today:\n${todayOut}`);
  assert.ok(todayOut.includes("今日-仅笔记完"), `sidDoneNote should land in today:\n${todayOut}`);
  assert.ok(todayOut.includes("今日-绑定激活"), `sidBoundFinish should land in today:\n${todayOut}`);
  assert.ok(todayOut.includes("今日-三天前激活"), `sidOldUntracked should land in today:\n${todayOut}`);
  assert.ok(!todayOut.includes("跨夜未完"), "genuine overnight session must not duplicate into today");
  assert.ok(yOut.includes("**跨夜未完任务**") && yOut.includes("⏱ 23:40–00:10"), `overnight session stays in yesterday:\n${yOut}`);
  // Today's reactivated entry should use today's segment clock (10:00-10:05), not yesterday's 14:00
  assert.ok(todayOut.includes("**今日-状态已完**") && todayOut.includes("⏱ 10:00–10:05"), `today's clock expected:\n${todayOut}`);
});

test("JournalSync reopens client-archived DONE tasks on unarchive while respecting manual DONE locks", async () => {
  const cfg = deepMerge(DEFAULTS, {});
  const today = dayKeyToday(cfg);
  const sidArch = "wb-link-arch-1";
  const sidManual = "wb-link-manual-2";
  const notePath = `日记/${today}.md`;

  const initial = [
    `- DOING 绑定工作任务 ^wb-aaaaaaaaaa`,
    `\t- 🔗 [WorkBuddy：绑定工作任务](workbuddy://chat/${sidArch})`,
    `- DOING 手动完成任务 ^wb-bbbbbbbbbb`,
    `\t- 🔗 [WorkBuddy：手动完成任务](workbuddy://chat/${sidManual})`,
  ].join("\n");

  const meta = {
    [sidArch]: { sid: sidArch, agent: "workbuddy", state: "wait", lastAt: Date.now() - 60000, rounds: [{ n: 1, ask: "一", said: "第一轮结果" }], archived: true },
    [sidManual]: { sid: sidManual, agent: "workbuddy", state: "run", lastAt: Date.now(), rounds: [{ n: 1, ask: "手", said: "手动" }], archived: false },
  };
  const p = makeVaultPlugin({ files: { [notePath]: initial }, meta, cfg });
  const sync = new JournalSync(p);

  // 1. Client archive completes sidArch via finish() -> cleanCompletedIdentifiers strips ^wb-aaaaaaaaaa, sets archivedDone
  let text = sync.keywords(initial);
  assert.ok(text.startsWith("- DONE "), `expected DONE after archive:\n${text}`);
  assert.ok(!text.includes("^wb-aaaaaaaaaa"), "completed ID cleaned");
  assert.equal(p.settings.autoLogState[today][sidArch].archivedDone, true);

  // 2. Manual DONE lock on sidManual
  p._store[notePath] = text;
  await applyStatusChoice(p, { path: notePath, raw: text.split("\n").find((l) => l.includes("手动完成任务")) }, "DONE");
  text = p._store[notePath];
  assert.ok(text.includes("- DONE 手动完成任务"));

  // 3. Unarchive sidArch and resume running with round 2
  p.usage.meta.get(sidArch).archived = false;
  p.usage.meta.get(sidArch).state = "run";
  p.usage.meta.get(sidArch).lastAt = Date.now();
  p.usage.meta.get(sidArch).rounds.push({ n: 2, ask: "二", said: "第二轮结果" });
  p.usage.meta.get(sidArch).state = "wait";
  p.usage.meta.get(sidArch).lastText = "第二轮结果";

  sync._reopenedInPass = false;
  text = sync.keywords(text);
  if (sync._reopenedInPass) text = sync.results(text);

  assert.ok(text.includes("- TOREVIEW "), `expected reopened task:\n${text}`);
  assert.ok(text.includes("^wb-aaaaaaaaaa"), `expected restored blockId:\n${text}`);
  assert.ok(text.includes("第二轮结果"), `expected round 2 written:\n${text}`);
  assert.ok(text.includes("- DONE 手动完成任务"), "manual DONE task must never reopen");
});

test("multi-session linked task and organizeJournal-archived linked task reopen when unarchived", () => {
  const cfg = deepMerge(DEFAULTS, {});
  const today = dayKeyToday(cfg);
  const s1 = "11111111-2222-4333-8444-555555555551";
  const s2 = "wb-multi-session-2";
  const sOrg = "22222222-3333-4444-8555-666666666662";
  const now = Date.now();
  const note = [
    `- DOING 联合任务 ^ad-multi12345`,
    `\t- 🔗 [Codex](codex://threads/${s1})`,
    `\t- 🔗 [WorkBuddy](workbuddy://chat/${s2})`,
    `- DOING 整理归档任务 ^ad-org1234567`,
    `\t- 🔗 [Claude](claude://resume?session=${sOrg})`,
  ].join("\n");

  const meta = {
    [s1]: { sid: s1, agent: "codex", state: "wait", lastAt: now - 120000, rounds: [{ n: 1, ask: "1", said: "r1" }], archived: true },
    [s2]: { sid: s2, agent: "workbuddy", state: "wait", lastAt: now - 60000, rounds: [{ n: 1, ask: "2", said: "r2" }], archived: true },
    [sOrg]: { sid: sOrg, agent: "claude", state: "wait", lastAt: now - 30000, rounds: [{ n: 1, ask: "3", said: "r3" }], archived: true },
  };
  const p = makeVaultPlugin({ files: { [`日记/${today}.md`]: note }, meta, cfg });
  const sync = new JournalSync(p);

  // Finish multi-session task via JournalSync.keywords() -> both s1 and s2 get archivedDone: true
  let out = sync.keywords(note);
  assert.ok(out.includes("- DONE 19:") || out.includes("- DONE "), out);
  assert.equal(p.settings.autoLogState[today][s1].archivedDone, true);
  assert.equal(p.settings.autoLogState[today][s2].archivedDone, true);

  // Unarchive s1 while s2 stays archived -> task reopens
  p.usage.meta.get(s1).archived = false;
  p.usage.meta.get(s1).state = "run";
  out = sync.keywords(out);
  assert.ok(/^- DOING .*联合任务 \^ad-multi12345/m.test(out), `expected multi-session task to reopen when s1 unarchives:\n${out}`);

  // Archive s1 again -> back to DONE, then unarchive s2 (bottom link) -> also reopens
  p.usage.meta.get(s1).archived = true;
  p.usage.meta.get(s1).state = "wait";
  out = sync.keywords(out);
  assert.ok(/^- DONE .*联合任务$/m.test(out), `expected DONE when both archived again:\n${out}`);
  p.usage.meta.get(s2).archived = false;
  p.usage.meta.get(s2).state = "run";
  out = sync.keywords(out);
  assert.ok(/^- DOING .*联合任务 \^ad-multi12345/m.test(out), `expected multi-session task to reopen when s2 unarchives:\n${out}`);

  // Simulate organizeJournal propagating archivedDone onto a 🔗-linked session (even with rec.skip=true)
  const orgNote = [
    `- DOING 整理归档任务 ^ad-org1234567`,
    `\t- 🔗 [Claude](claude://resume?session=${sOrg})`,
  ].join("\n");
  const plan = planJournal(orgNote, {
    tracked: new Map([["ad-org1234567", new Set([sOrg])]]),
    archived: new Set([sOrg]),
  });
  const orgDone = plan.done.find((e) => e.text.includes("整理归档任务"));
  assert.equal(orgDone?.archivedDone, true);
  let orgOut = renderJournal(plan);
  p.settings.autoLogState[today][sOrg] = { skip: true, bound: true, blockId: "ad-org1234567", status: "done", archivedDone: true };

  // Unarchive sOrg -> JournalSync reopens it
  p.usage.meta.get(sOrg).archived = false;
  p.usage.meta.get(sOrg).state = "run";
  orgOut = sync.keywords(orgOut);
  assert.ok(/^- DOING .*整理归档任务 \^ad-org1234567/m.test(orgOut), `expected organizeJournal-archived linked task to reopen:\n${orgOut}`);
});
