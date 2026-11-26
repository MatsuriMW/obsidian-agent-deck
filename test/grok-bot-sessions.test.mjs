import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s.endsWith('.png'))return {url:'data:text/javascript,export default "data:image/png;base64,AA==";',shortCircuit:true};if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};export class Modal{};export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin;}};export class App{};export class Menu{};export class Component{};export function setIcon(){};export const MarkdownRenderer={render:async()=>{}};',shortCircuit:true};return n(s,c)}`,
    ),
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ad-grokbot-test-"));
process.env.HOME = tmpRoot;

const GB = await import("../src/grok-bot-sessions.js");
const { AgentUsage, USAGE_CACHE_VERSION } = await import("../src/readers.js");
const { conversationMessages, conversationTitle, conversationMarkdown, readConversation, archiveConversation } = await import("../src/conversation.js");
const J = await import("../src/journal.js");
const { AGENTS, AGENT_ORDER, DEFAULTS, dayKeyToday, startOfDay } = await import("../src/constants.js");
const { getAgentCapability, usesDeckSessionLink } = await import("../src/agent-registry.js");
const { AGENT_APPS } = await import("../src/delegation.js");
const { AgentDeckSettingsTab } = await import("../src/settings.js");
const { AGENT_IMAGES } = await import("../src/agent-assets.js");
const { AutoLog } = await import("../src/autolog.js");

function writeSandBlob(dir, key, value, schemaVersion = 1) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, GB.encodeSandBlobKey(key));
  fs.writeFileSync(file, JSON.stringify({ schemaVersion, value }), "utf8");
  return file;
}

test("grokbot constants, registry, assets and cache version are wired", () => {
  assert.ok(AGENT_ORDER.includes("grokbot"));
  assert.equal(AGENTS.grokbot.trackingOnly, true);
  assert.equal(AGENTS.grokbot.desktopOnly, true);
  assert.equal(DEFAULTS.agents.grokbot, true);
  assert.equal(DEFAULTS.autoLogAgents.grokbot, true);
  assert.deepEqual(DEFAULTS.grokBotTrackedBotIds, []);
  assert.ok(USAGE_CACHE_VERSION >= 11);
  assert.equal(getAgentCapability("grokbot").trackingOnly, undefined);
  assert.equal(getAgentCapability("grokbot").desktopHandoffOnly, true);
  assert.equal(getAgentCapability("grokbot").delegate, false);
  assert.equal(usesDeckSessionLink("grokbot"), true);
  assert.equal(AGENT_APPS.grokbot.bundle, "com.anysphere.sand");
  assert.equal(AGENT_APPS.grokbot.url, "grokbot://");
  assert.ok(AGENT_IMAGES.grokbot);
  assert.ok(fs.existsSync(new URL("../assets/agents/grokbot.png", import.meta.url)));
});

test("decodeSandBlobKey / encodeSandBlobKey roundtrips real Sand keys", () => {
  const keys = [
    "sand.client.slice.client-meta.account-slot",
    "sand.client.slice.account.grok%7Cuser_01M4GA3Q9T6ZH4BVVVGTMNJ476.roster.last-roster",
    "sand.client.slice.account.grok%7Cuser_01M4GA3Q9T6ZH4BVVVGTMNJ476.transcript.replicas.2d963dde-269f-4234-bb26-7992492ba003",
  ];
  for (const k of keys) {
    const fname = GB.encodeSandBlobKey(k);
    assert.ok(fname.endsWith(".blob"));
    assert.equal(GB.decodeSandBlobKey(fname), k);
  }
  assert.equal(GB.decodeSandBlobKey("invalid!file.txt"), "");
});

test("discoverGrokBotStorage sorts active bots before hidden and respects active account slot", () => {
  const pDir = path.join(tmpRoot, "discover-case");
  const acct1 = "grok|user_active";
  const acct2 = "grok|user_old";
  writeSandBlob(pDir, "sand.client.slice.client-meta.account-slot", acct1, 1);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct2)}.roster.last-roster`, {
    rows: [{ id: "bot-old", name: "Old Bot", lastActivityAt: 9999999999999 }],
  }, 4);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct1)}.roster.last-roster`, {
    rows: [
      { id: "bot-hidden", name: "Hidden Bot", isHiddenFromSidebar: true, lastActivityAt: 5000 },
      { id: "bot-boss", name: "boss", isHiddenFromSidebar: false, lastActivityAt: 4000 },
      { id: "bot-muse", name: "缪斯", isHiddenFromSidebar: false, lastActivityAt: 6000 },
    ],
  }, 4);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct1)}.transcript.replicas.bot-boss`, {
    entries: [],
    persistedAt: 4000,
  });

  const found = GB.discoverGrokBotStorage({ persistenceDir: pDir });
  assert.equal(found.accountId, acct1);
  assert.deepEqual(found.bots.map((b) => b.id), ["bot-muse", "bot-boss", "bot-hidden"]);
  assert.ok(found.bots.find((b) => b.id === "bot-boss").transcriptPath.endsWith(".blob"));
});

test("AgentUsage tracks only selected grokBotTrackedBotIds, avoids token estimation, and prunes unselected", async () => {
  const pDir = path.join(tmpRoot, "usage-case");
  const acct = "grok|user_1";
  const now = Date.now();
  const t0 = now - 5 * 60000;
  writeSandBlob(pDir, "sand.client.slice.client-meta.account-slot", acct, 1);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.roster.last-roster`, {
    rows: [
      { id: "bot-boss", name: "boss", createdAt: t0 - 1000, lastActivityAt: t0 + 120000, awaitingUserResponse: null },
      { id: "bot-noise", name: "Noise Group", isGroup: true, createdAt: t0, lastActivityAt: t0 + 60000 },
    ],
  }, 4);

  // Older unanswered user-form followed by newer answered turn should settle to "wait", not stick in "needs-approval".
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.transcript.replicas.bot-boss`, {
    persistedAt: t0 + 120000,
    entries: [
      { kind: "send-message", id: "t0s1", message: { type: "user-form", formRequest: { title: "登录 Boss" } }, timestampMs: t0 - 10 * 86400000, seq: 1 },
      { kind: "message", id: "t1u", role: "user", content: "看下今天简历回复", timestampMs: t0, seq: 2 },
      { kind: "send-message", id: "t1s3", message: { type: "text", content: "今天有 2 个回复。" }, timestampMs: t0 + 120000, seq: 3 },
      { kind: "send-message", id: "t1s4", message: { type: "widget", widget: { prompt: "要发简历给邵先生吗？", options: [{ label: "发送" }] } }, timestampMs: t0 + 125000, seq: 4 },
    ],
  });
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.transcript.replicas.bot-noise`, {
    persistedAt: t0 + 60000,
    entries: [
      { kind: "message", id: "n1u", role: "user", content: "群聊测试", timestampMs: t0, seq: 1 },
      { kind: "send-message", id: "n1s2", author: { id: "a1", name: "Helper" }, message: { type: "text", content: "收到" }, timestampMs: t0 + 60000, seq: 2 },
    ],
  });

  // 1) Default empty grokBotTrackedBotIds tracks nothing
  const usageEmpty = new AgentUsage({
    cfg: { dayCutoff: 0 },
    settings: { agents: { grokbot: true }, grokBotTrackedBotIds: [], grokBotPersistenceDir: pDir },
  });
  await usageEmpty.scan({ agent: "grokbot" });
  assert.equal(usageEmpty.meta.size, 0);

  // 2) Select only bot-boss
  const settings = { agents: { grokbot: true }, grokBotTrackedBotIds: ["bot-boss"], grokBotPersistenceDir: pDir };
  const usage = new AgentUsage({ cfg: { dayCutoff: 0 }, settings });
  const touched = await usage.scan({ agent: "grokbot" });
  const today = dayKeyToday({ dayCutoff: 0 });
  assert.ok(touched.has(today));
  assert.equal(usage.meta.has("bot-boss"), true);
  assert.equal(usage.meta.has("bot-noise"), false);

  const meta = usage.meta.get("bot-boss");
  assert.equal(meta.agent, "grokbot");
  assert.equal(meta.title, "boss");
  assert.equal(meta.cwd, "");
  assert.equal(meta.out, 0);
  assert.equal(meta.fresh, 0);
  assert.equal(meta.cached, 0);
  assert.equal(meta.state, "wait");
  assert.ok(meta.startedAt >= t0 - 1000, "startedAt uses first ingested today entry rather than old bot createdAt");
  assert.equal(meta.turns, 1);
  assert.equal(meta.rounds[0].ask, "看下今天简历回复");
  assert.equal(meta.rounds[0].said, "要发简历给邵先生吗？");

  const summary = usage.summary(today);
  assert.equal(summary.by.grokbot.sessions, 1);
  assert.equal(summary.by.grokbot.out, 0);
  assert.ok(summary.by.grokbot.wall >= 2);

  // 3) Cache roundtrip preserves grokbot session
  const cacheFile = path.join(tmpRoot, "usage-cache.json.gz");
  await usage.saveCache(cacheFile);
  const restored = new AgentUsage({ cfg: { dayCutoff: 0 }, settings });
  assert.equal(await restored.loadCache(cacheFile), true);
  assert.equal(restored.meta.get("bot-boss").title, "boss");

  // 4) Unselecting bot-boss prunes it cleanly
  restored.settings.grokBotTrackedBotIds = [];
  await restored.scan({ agent: "grokbot" });
  assert.equal(restored.meta.has("bot-boss"), false);
  assert.equal(restored.summary(today), null);
});

test("Grok Bot conversation reading, archiving, and journal link/block IDs work end-to-end", async () => {
  const pDir = path.join(tmpRoot, "conv-case");
  const acct = "grok|user_conv";
  const t0 = Date.now() - 60000;
  writeSandBlob(pDir, "sand.client.slice.client-meta.account-slot", acct, 1);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.roster.last-roster`, {
    rows: [{ id: "bot-legal", name: "法理", createdAt: t0, lastActivityAt: t0 + 20000 }],
  }, 4);
  const trFile = writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.transcript.replicas.bot-legal`, {
    persistedAt: t0 + 20000,
    entries: [
      { kind: "user-attachment", id: "ua1", file_name: "合同.pdf", secondaryText: "1.2MB", timestampMs: t0, seq: 1 },
      { kind: "message", id: "u1", role: "user", content: "帮我审一下第一条", timestampMs: t0 + 1000, seq: 2 },
      { kind: "send-message", id: "s1", message: { type: "text", content: "第一条违约金比例偏高。" }, timestampMs: t0 + 10000, seq: 3 },
      { kind: "send-message", id: "s2", message: { type: "attachment", file_name: "修订版.docx" }, timestampMs: t0 + 20000, seq: 4 },
    ],
  });

  const msgs = conversationMessages("grokbot", fs.readFileSync(trFile, "utf8"));
  assert.equal(msgs.length, 4);
  assert.ok(msgs[0].text.includes("合同.pdf"));
  assert.equal(msgs[2].text, "第一条违约金比例偏高。");
  assert.ok(msgs[3].text.includes("修订版.docx"));

  const created = new Map();
  const mockPlugin = {
    jobs: {},
    usage: { files: new Map([[`${trFile}#bot-legal`, { path: `${trFile}#bot-legal`, agent: "grokbot", sid: "bot-legal" }]]) },
    app: {
      vault: {
        getAbstractFileByPath: (p) => created.get(p) || null,
        createFolder: async (p) => { created.set(p, { path: p }); },
        create: async (p, content) => { const f = { path: p, content }; created.set(p, f); return f; },
        read: async (f) => f.content,
        modify: async (f, content) => { f.content = content; },
      },
    },
  };
  const readBack = await readConversation(mockPlugin, { agent: "grokbot", sid: "bot-legal" });
  assert.equal(readBack.length, 4);
  assert.equal(conversationTitle({ agent: "grokbot", sid: "bot-legal", title: "法理" }, readBack), "法理");
  const md = conversationMarkdown({ agent: "grokbot", sid: "bot-legal", title: "法理" }, readBack);
  assert.ok(md.includes("# 法理"));
  assert.ok(md.includes("Agent：grokbot"));
  const archived = await archiveConversation(mockPlugin, { agent: "grokbot", sid: "bot-legal", title: "法理" });
  assert.ok(archived.path.includes("-grokbot-"));

  const line = J.linkLine("  ", "grokbot", "法理", "bot-legal");
  assert.ok(line.includes("agent=grokbot"));
  assert.equal(J.parseLink(line).agent, "grokbot");
  assert.equal(J.parseLink(line).sid, "bot-legal");
  const bid = J.makeBlockId("bot-legal", "grokbot", "review");
  assert.ok(bid.startsWith("grokbot-review-"));
  assert.ok(J.isDeckBlockId(bid));
});

test("Settings Recording page renders multi-select Grok Bot filter and updates grokBotTrackedBotIds", async () => {
  const pDir = path.join(tmpRoot, "settings-case");
  const acct = "grok|user_set";
  writeSandBlob(pDir, "sand.client.slice.client-meta.account-slot", acct, 1);
  writeSandBlob(pDir, `sand.client.slice.account.${encodeURIComponent(acct)}.roster.last-roster`, {
    rows: [
      { id: "bot-1", name: "boss", lastActivityAt: 2000 },
      { id: "bot-2", name: "old", isHiddenFromSidebar: true, lastActivityAt: 1000 },
    ],
  }, 4);

  class El {
    constructor(tag = "div", opts = {}) {
      this.tag = tag;
      this.className = opts.cls || "";
      this._textContent = opts.text || "";
      this.dataset = {};
      this.attrs = { ...(opts.attr || {}) };
      this.children = [];
      this.style = { setProperty() {} };
      this.ownerDocument = { createElement: (t) => new El(t) };
    }
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = String(v ?? ""); if (this._textContent === "") this.children = []; }
    createDiv(opts = {}) { return this.append(new El("div", opts)); }
    createSpan(opts = {}) { return this.append(new El("span", opts)); }
    createEl(tag, opts = {}) { return this.append(new El(tag, opts)); }
    append(child) {
      if (child && typeof child === "object") child.parentElement = this;
      this.children.push(child);
      return child;
    }
    appendChild(child) { return this.append(child); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    get classList() {
      const self = this;
      return {
        add(...cs) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const c of cs) if (c) set.add(c);
          self.className = [...set].join(" ");
        },
        remove(...cs) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const c of cs) set.delete(c);
          self.className = [...set].join(" ");
        },
        toggle(cls, force) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          const on = force === undefined ? !set.has(cls) : !!force;
          if (on) set.add(cls); else set.delete(cls);
          self.className = [...set].join(" ");
        },
        contains(cls) { return self.className.split(/\s+/).includes(cls); },
      };
    }
    querySelector(sel) {
      const clean = sel.replace(/^:scope\s*>\s*/, "");
      const cls = clean.startsWith(".") ? clean.slice(1) : "";
      for (const ch of this.children) {
        if (!ch || typeof ch !== "object") continue;
        if (cls && ch.classList?.contains(cls)) return ch;
        const found = ch.querySelector?.(sel);
        if (found) return found;
      }
      return null;
    }
    all() { return [this, ...this.children.filter((c) => c && typeof c.all === "function").flatMap((c) => c.all())]; }
    addEventListener() {}
  }

  let saved = 0;
  let scanned = [];
  const settings = structuredClone(DEFAULTS);
  settings.grokBotPersistenceDir = pDir;
  const plugin = {
    settings,
    usage: { meta: new Map(), files: new Map(), errors: [] },
    store: { days: {} },
    agentEnabled: (id) => settings.agents[id] !== false,
    isPrimary: (id) => settings.primaryAgents.includes(id),
    saveSettings: () => { saved++; },
    scanNow: (_force, opts) => { scanned.push(opts); },
    watchGrokBotPersistence: () => {},
  };
  const tab = new AgentDeckSettingsTab({}, plugin);
  const body = new El();
  tab.renderRecord(body);

  const grokCard = body.all().find((el) => el.dataset?.agent === "grokbot");
  assert.ok(grokCard, "Grok Bot has its own card");
  const picker = grokCard.all().find((el) => el.classList.contains("ad-grokbot-picker"));
  assert.ok(picker, "Bot picker is nested directly inside the Grok Bot card");
  const botBtns = () => picker.all().filter((el) => el.tag === "button" && el.attrs["data-bot-id"]);
  assert.equal(botBtns().length, 1, "hidden bots are collapsed by default");
  assert.equal(botBtns()[0].attrs["aria-pressed"], "false");

  const showHiddenBtn = picker.all().find((el) => el.tag === "button" && el.classList.contains("ad-linkbtn"));
  assert.ok(showHiddenBtn);
  showHiddenBtn.onclick();
  assert.equal(botBtns().length, 2, "hidden bots appear after toggling");

  await botBtns()[0].onclick();
  assert.deepEqual(settings.grokBotTrackedBotIds, ["bot-1"]);
  assert.equal(botBtns()[0].attrs["aria-pressed"], "true");
  assert.equal(saved, 1);
  assert.deepEqual(scanned, [{ agent: "grokbot" }]);

  // Verify 记录规则细则 subsection renders and mutates settings.recordRules & autoLogGrokBotDoneMinutes
  const rulesSection = body.all().find((el) => el.dataset?.section === "record-rules");
  assert.ok(rulesSection, "record-rules subsection renders inside Recording settings");
  const ruleToggles = rulesSection.all().filter((el) => el.classList.contains("ad-switch"));
  const ruleInputs = rulesSection.all().filter((el) => el.tag === "input");
  assert.equal(ruleToggles.length, 2, "boldTitle and projectPrefix toggles exist in record-rules");
  assert.equal(settings.recordRules.showTimeRange, false, "default timing scheme is Spiral child mode");
  const legacyTimingBtn = body.all().find((el) => el.tag === "button" && el.textContent === "行首 HH:MM-HH:MM（传统）");
  const childTimingBtn = body.all().find((el) => el.tag === "button" && el.textContent === "子块 ⏱（默认 · 与螺旋日程一致）");
  assert.ok(legacyTimingBtn && childTimingBtn, "two selectable session timing buttons render in Recording settings");
  legacyTimingBtn.onclick();
  assert.equal(settings.recordRules.showTimeRange, true);
  childTimingBtn.onclick();
  assert.equal(settings.recordRules.showTimeRange, false);
  assert.equal(ruleInputs.length, 2, "titleMax and autoLogGrokBotDoneMinutes number inputs exist");
  ruleToggles[0].onclick();
  assert.equal(settings.recordRules.boldTitle, false);
  ruleInputs[0].value = "30";
  ruleInputs[0].onchange();
  assert.equal(settings.recordRules.titleMax, 30);
  ruleInputs[1].value = "90";
  ruleInputs[1].onchange();
  assert.equal(settings.autoLogGrokBotDoneMinutes, 90);
});

test("AutoLog prefixes Grok Bot titles with 'bot -> title' and auto-marks DONE after long idle", async () => {
  const today = dayKeyToday({ dayCutoff: 0 });
  let noteText = "---\n## 进行中\n\n---\n## 还要做\n\n---\n## 已完成\n\n---\n";
  const file = { path: `日记/${today}.md`, extension: "md" };
  const settings = structuredClone(DEFAULTS);
  settings.autoLog = true;
  settings.autoLogGrokBotDoneMinutes = 120;
  settings.autoLogAgents.grokbot = true;

  let currentMin = 10 * 60; // 10:00
  const dayStart = startOfDay(Date.now(), { dayCutoff: 0 });
  const round1At = dayStart + 7 * 3600000;
  const meta = new Map([
    ["bot-boss", { sid: "bot-boss", agent: "grokbot", title: "boss", lastAt: round1At + 15 * 60000, lastText: "已发星元启航简历。", rounds: [{ n: 1, at: round1At, ask: "查看今天回复", said: "已发星元启航简历。" }] }],
  ]);
  const summaryData = {
    wall: 15,
    agent: 15,
    sessions: 1,
    prompts: 1,
    list: [{ sid: "bot-boss", agent: "grokbot", dir: "?", cwd: "", title: "boss", text: "查看今天回复", min: 15, out: 0, fresh: 0, cached: 0, turns: 1, segs: [[7 * 60, 7 * 60 + 15]] }],
  };
  const plugin = {
    settings,
    usage: { meta, archived: new Set(), archivedClaude: new Set(), summary: (d) => (d === today ? summaryData : null) },
    app: {
      vault: {
        getAbstractFileByPath: (p) => (p === file.path ? file : null),
        read: async () => noteText,
        process: async (_f, fn) => { noteText = fn(noteText); },
      },
      workspace: { iterateAllLeaves: () => {} },
    },
    saveSettings: async () => {},
  };

  const al = new AutoLog(plugin);
  al.nowMin = () => currentMin; // 10:00 -> 165 min idle >= 120 min
  assert.equal(al.projectOf({ agent: "grokbot", sid: "bot-boss", title: "boss" }), "boss");
  assert.equal(al.originDayOf({ agent: "grokbot", sid: "bot-boss" }, today), today);

  // Use fallback title builder (no LLM binary) -> should format as "boss -> ..." and auto-mark DONE!
  al.ask = async (items) => {
    const out = new Map();
    for (const { x } of items) {
      const proj = al.projectOf(x);
      out.set(x.sid, { label: `${proj} -> 跟进简历投递`, proj, slug: "boss-resume", summary: "已发星元启航简历。", matchKey: null, done: false, todos: [], skip: false });
    }
    return out;
  };

  await al.run({ manual: true });
  assert.ok(noteText.includes("DONE 🤖 **boss -> 跟进简历投递**") && noteText.includes("\t- ⏱ 07:00–07:15"), `expected DONE line with bot prefix and clock child, got:\n${noteText}`);
  assert.equal(settings.autoLogState[today]["bot-boss"].status, "done");

  // Later same day (10:15): user chats again with boss -> creates new active DOING block without touching earlier DONE block
  currentMin = 10 * 60 + 15;
  summaryData.list[0].segs = [[7 * 60, 7 * 60 + 15], [10 * 60 + 10, 10 * 60 + 14]];
  meta.get("bot-boss").lastAt = dayStart + (10 * 60 + 14) * 60000;
  meta.get("bot-boss").rounds.push({ n: 2, at: dayStart + (10 * 60 + 10) * 60000, ask: "看看新心文化回复", said: "还没回。" });
  al.ask = async (items) => {
    const out = new Map();
    for (const { x } of items) {
      const proj = al.projectOf(x);
      out.set(x.sid, { label: `${proj} -> 查新心文化回复`, proj, slug: "boss-reply", summary: "还没回。", matchKey: null, done: false, todos: [], skip: false });
    }
    return out;
  };
  await al.run({ manual: true });
  assert.ok(noteText.includes("DONE 🤖 **boss -> 跟进简历投递**"));
  assert.ok(noteText.includes("DOING 🤖 **boss -> 查新心文化回复**") && noteText.includes("\t- ⏱ "), `expected new DOING line, got:\n${noteText}`);
});
