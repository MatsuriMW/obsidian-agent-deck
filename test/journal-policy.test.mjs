import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class Notice{constructor(){}};export class MarkdownView{};export class Modal{};export class FuzzySuggestModal{}", shortCircuit: true };
  return next(spec, ctx);
}`));

const {
  DEFAULT_JOURNAL_POLICY,
  AI_ANCHOR_COMMENT,
  normalizeJournalPolicy,
  splitFrontMatterLines,
  extractTemplateHeadings,
  hasAiPlaceholder,
  expandJournalTemplateVars,
  resolveJournalInitialContent,
  findAiInsertPosition,
} = await import("../src/journal-policy.js");
const { planJournal, renderJournal, ensureTopRule } = await import("../src/organize-journal.js");
const { AutoLog } = await import("../src/autolog.js");
const { DEFAULTS } = await import("../src/constants.js");
const { AgentUsage, USAGE_CACHE_VERSION } = await import("../src/readers.js");

test("normalizeJournalPolicy handles fresh installs and legacy autoCreate=false upgrade", () => {
  const fresh = normalizeJournalPolicy(undefined, { legacyAutoCreate: true });
  assert.equal(fresh.configured, false);
  assert.equal(fresh.mode, "auto");
  assert.equal(fresh.templateSource, "obsidian");
  assert.equal(fresh.aiPlacement, "bottom");

  const upgradedOff = normalizeJournalPolicy({}, { legacyAutoCreate: false });
  assert.equal(upgradedOff.configured, false);
  assert.equal(upgradedOff.mode, "manual");

  const custom = normalizeJournalPolicy({
    configured: true,
    mode: "auto",
    templateSource: "custom",
    templateText: "## 今日计划\n{{ai}}",
    aiPlacement: "placeholder",
    updatedAt: 12345,
  });
  assert.equal(custom.configured, true);
  assert.equal(custom.templateSource, "custom");
  assert.equal(custom.aiPlacement, "placeholder");
  assert.equal(custom.updatedAt, 12345);
});

test("splitFrontMatterLines and extractTemplateHeadings support Unicode YAML keys and skip fences", () => {
  const md = [
    "---",
    "归属库: Note",
    "周期起始日期: 2026-11-27",
    "---",
    "",
    "# 今日复盘",
    "```markdown",
    "## 代码块里的假标题",
    "{{ai}}",
    "```",
    "## AI 记录",
    "{{ai}}",
    "### 细节",
  ].join("\n");

  const lines = md.split("\n");
  const fm = splitFrontMatterLines(lines);
  assert.equal(fm.start, 4);
  assert.deepEqual(fm.head, ["---", "归属库: Note", "周期起始日期: 2026-11-27", "---"]);

  const headings = extractTemplateHeadings(md);
  assert.deepEqual(
    headings.map((h) => h.raw),
    ["# 今日复盘", "## AI 记录", "### 细节"],
  );
  assert.equal(hasAiPlaceholder(md), true);
  assert.equal(hasAiPlaceholder("```md\n{{ai}}\n```"), false);
});

test("expandJournalTemplateVars and resolveJournalInitialContent handle obsidian, file, custom, none", async () => {
  const now = new Date("2026-11-27T09:15:00");
  const customOut = expandJournalTemplateVars("# {{title}}\n日期：{{date:YYYYMMDD}} {{time}}\n{{ai}}", {
    title: "20261127 - 日笔记",
    now,
  });
  assert.equal(customOut, `# 20261127 - 日笔记\n日期：20261127 09:15\n${AI_ANCHOR_COMMENT}`);

  const files = {
    "Templates/Obs.md": { path: "Templates/Obs.md", extension: "md", body: "obs:{{title}}:{{date:YYYY-MM-DD}}" },
    "Templates/CustomFile.md": { path: "Templates/CustomFile.md", extension: "md", body: "file:{{title}}\n{{ai}}" },
  };
  const app = {
    internalPlugins: {
      getPluginById: (id) => (id === "daily-notes" ? { enabled: true, instance: { options: { template: "Templates/Obs.md" } } } : null),
    },
    vault: {
      getAbstractFileByPath: (p) => files[p] || null,
      read: async (f) => f.body,
    },
  };

  assert.equal(
    await resolveJournalInitialContent(app, { templateSource: "obsidian" }, { path: "Log/20261127.md", now }),
    "obs:20261127:2026-11-27",
  );
  assert.equal(
    await resolveJournalInitialContent(app, { templateSource: "file", templatePath: "Templates/CustomFile.md" }, { path: "Log/20261127.md", now }),
    `file:20261127\n${AI_ANCHOR_COMMENT}`,
  );
  assert.equal(
    await resolveJournalInitialContent(app, { templateSource: "custom", templateText: "inline:{{title}}" }, { path: "Log/20261127.md", now }),
    "inline:20261127",
  );
  assert.equal(
    await resolveJournalInitialContent(app, { templateSource: "none" }, { path: "Log/20261127.md", now, fallbackSeed: "---\n---\n" }),
    "---\n---\n",
  );
});

test("findAiInsertPosition + planJournal + renderJournal support top, after-heading, placeholder, and Unicode frontmatter losslessly", () => {
  const layout = { order: ["active", "todo", "done"], titles: { active: "正在做", todo: "还要做", done: "已完成" } };

  // 1. Top placement below Chinese YAML frontmatter
  const noteTop = "---\n归属库: Note\n类型: Log\n---\n\n## 我的随想\n手写内容保持在下面\n";
  const planTop = planJournal(noteTop, { layout, placementPolicy: { aiPlacement: "top" } });
  const renderedTop = renderJournal(planTop);
  assert.ok(renderedTop.startsWith("---\n归属库: Note\n类型: Log\n---\n\n<!-- agent-deck:layout:start -->"), "top placement sits below Unicode frontmatter");
  assert.ok(renderedTop.includes("<!-- agent-deck:layout:end -->\n\n## 我的随想\n手写内容保持在下面"), "user content preserved below frame");
  // Idempotent on second organize pass
  assert.equal(renderJournal(planJournal(renderedTop, { layout, placementPolicy: { aiPlacement: "top" } })), renderedTop);

  // 2. Under a heading in the middle of template
  const noteMid = "---\n归属库: Note\n---\n\n## 今日计划\n- TODO 写周报\n\n## AI 记录\n\n## 晚间复盘\n总结一下\n";
  const planMid = planJournal(noteMid, { layout, placementPolicy: { aiPlacement: "after-heading", aiAnchorHeading: "## AI 记录" } });
  const renderedMid = renderJournal(planMid);
  const aiIdx = renderedMid.indexOf("## AI 记录");
  const startIdx = renderedMid.indexOf("<!-- agent-deck:layout:start -->");
  const endIdx = renderedMid.indexOf("<!-- agent-deck:layout:end -->");
  const revIdx = renderedMid.indexOf("## 晚间复盘");
  assert.ok(aiIdx >= 0 && aiIdx < startIdx && startIdx < endIdx && endIdx < revIdx, "AI region placed cleanly between target heading and next section");
  assert.equal(renderJournal(planJournal(renderedMid, { layout, placementPolicy: { aiPlacement: "after-heading", aiAnchorHeading: "## AI 记录" } })), renderedMid);
  // ensureTopRule does not double-insert dividers
  assert.equal(ensureTopRule(renderedMid), renderedMid);

  // 3. {{ai}} / anchor comment in-place replacement
  const noteAnchor = `## 上半部分\n上面\n\n${AI_ANCHOR_COMMENT}\n\n## 下半部分\n下面\n`;
  const renderedAnchor = renderJournal(planJournal(noteAnchor, { layout, placementPolicy: { aiPlacement: "placeholder" } }));
  assert.ok(!renderedAnchor.includes(AI_ANCHOR_COMMENT), "anchor comment replaced on frame creation");
  assert.ok(renderedAnchor.indexOf("## 上半部分") < renderedAnchor.indexOf("<!-- agent-deck:layout:start -->"));
  assert.ok(renderedAnchor.indexOf("<!-- agent-deck:layout:end -->") < renderedAnchor.indexOf("## 下半部分"));
  assert.equal(renderJournal(planJournal(renderedAnchor, { layout, placementPolicy: { aiPlacement: "placeholder" } })), renderedAnchor);

  // 4. Missing heading falls back to bottom cleanly
  const posFallback = findAiInsertPosition("## 其他标题\n正文", { aiPlacement: "after-heading", aiAnchorHeading: "## 不存在" });
  assert.equal(posFallback.head, "## 其他标题\n正文\n\n");
  assert.equal(posFallback.tail, "\n");
});

test("AutoLog.runOnce prompts once when unconfigured and respects manual choice until note appears", async () => {
  const files = new Map();
  let prompts = 0;
  let policy = { ...DEFAULT_JOURNAL_POLICY };
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const journalName = `${y}_${m}_${d}.md`;

  const usage = new AgentUsage({}, { fullHistoryDays: 14 });
  usage.day = () => ({
    list: [{
      sid: "sid-policy-1",
      agent: "claude",
      title: "重构设置模块",
      text: "重构设置模块",
      min: 3,
      out: 100,
      fresh: 50,
      segs: [[60, 63]],
    }],
  });
  usage.summary = () => usage.day();
  usage.meta.set("sid-policy-1", {
    state: "wait",
    lastAt: Date.now() - 120_000,
    lastText: "已完成重构。",
    rounds: [{ user: "重构设置模块", text: "已完成重构。", endMs: Date.now() - 120_000 }],
  });

  const cfg = {
    ...DEFAULTS,
    journalFolder: "日记",
    journalFormat: "YYYY_MM_DD",
    journalPolicy: { ...policy },
    autoLogState: {},
    autoLogMinMinutes: 1,
    autoLogFallback: true,
    recordRules: { ...DEFAULTS.recordRules, showTimeRange: false },
  };
  const fakeFile = (pPath) => ({ path: pPath, extension: "md" });
  const app = {
    vault: {
      getAbstractFileByPath: (p) => (files.has(p) ? fakeFile(p) : null),
      read: async (f) => files.get(f.path) ?? "",
      process: async (f, fn) => { files.set(f.path, fn(files.get(f.path) ?? "")); },
    },
    workspace: { iterateAllLeaves() {} },
  };
  const plugin = {
    app,
    settings: cfg,
    usage,
    agentEnabled: () => true,
    getJournalPolicy: () => policy,
    promptJournalPolicyIfNeeded: async ({ manualTrigger }) => {
      prompts++;
      if (!manualTrigger && prompts === 1) {
        // First time user dismisses
        return { saved: false, dismissed: true };
      }
      // Second (manual) prompt chooses manual mode + top placement
      policy = normalizeJournalPolicy({ configured: true, mode: "manual", aiPlacement: "top", updatedAt: 100 });
      cfg.journalPolicy = policy;
      return { saved: true, policy };
    },
    ensureNoteFile: async (pPath, content = "") => {
      files.set(pPath, content);
      return { path: pPath, file: fakeFile(pPath) };
    },
    refreshUI() {},
    saveSettings: async () => {},
    taskBlockId: () => `claude-rec-${USAGE_CACHE_VERSION}`,
  };

  const autolog = new AutoLog(plugin);
  // 1. Background run when unconfigured prompts & respects dismissal (no file created)
  const r1 = await autolog.runOnce({ fallback: true, manual: false, notify: false });
  assert.equal(prompts, 1);
  assert.equal(files.size, 0);
  assert.equal(r1.error, "");

  // 2. Manual run prompts again; user chooses manual + top placement -> still does not create file, reports missing
  const r2 = await autolog.runOnce({ fallback: true, manual: true, notify: false });
  assert.equal(prompts, 2);
  assert.equal(files.size, 0);
  assert.ok(r2.error.length > 0);

  // 3. Background run after manual mode selected: does NOT re-prompt and does NOT create file
  const r3 = await autolog.runOnce({ fallback: true, manual: false, notify: false });
  assert.equal(prompts, 2);
  assert.equal(files.size, 0);
  assert.equal(r3.error, "");

  // 4. User creates today's note manually with frontmatter + user text; next run writes AI region at TOP below frontmatter!
  const targetPath = `日记/${journalName}`;
  files.set(targetPath, "---\n归属库: Note\n---\n\n## 我的日志\n手写内容\n");
  await autolog.runOnce({ fallback: true, manual: false, notify: false });
  const after = files.get(targetPath);
  assert.ok(after.includes("重构设置模块"), "writes AI task once user created daily note");
  assert.ok(
    after.indexOf("归属库: Note") < after.indexOf("<!-- agent-deck:layout:start -->")
    && after.indexOf("<!-- agent-deck:layout:end -->") < after.indexOf("## 我的日志"),
    "honors top placement chosen in modal while preserving user frontmatter and body",
  );
});
