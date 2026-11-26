import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";
import { pathToFileURL } from "node:url";
import { normalizeProjectFolder } from "../src/project-folders.js";
import { AGENT_ORDER } from "../src/constants.js";
import * as J from "../src/journal.js";

const root = path.resolve(import.meta.dirname, "..");

class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.options = options;
    this.cls = options.cls || "";
    this.classes = new Set(String(options.cls || "").split(/\s+/).filter(Boolean));
    this.text = options.text || "";
    this.textContent = options.text || "";
    this.value = options.value ?? options.attr?.value ?? "";
    this.attrs = { ...(options.attr || {}) };
    this.dataset = {};
    this.ownerDocument = globalThis.document;
    this.children = [];
    this.listeners = {};
    this.style = { setProperty() {} };
    this.classList = {
      add: (...xs) => xs.forEach((x) => this.classes.add(x)),
      remove: (...xs) => xs.forEach((x) => this.classes.delete(x)),
      contains: (x) => this.classes.has(x),
      toggle: (x, on) => (on ? this.classes.add(x) : this.classes.delete(x)),
    };
  }
  addClass(...xs) { xs.forEach((x) => this.classes.add(x)); this.cls = [...this.classes].join(" "); }
  removeClass(...xs) { xs.forEach((x) => this.classes.delete(x)); this.cls = [...this.classes].join(" "); }
  setText(t) { this.text = t; this.textContent = t; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  setAttr(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  createEl(tag, options = {}) { const el = new Element(tag, options); return this.appendChild(el); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
  empty() { this.children = []; }
  focus() { this.focused = true; }
  contains(other) { return this.all().includes(other); }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  querySelector(sel) {
    if (sel.startsWith(".")) return this.all().find((el) => el.classes.has(sel.slice(1))) || null;
    if (sel === ":scope > .ad-row__right") return this.children.find((c) => c.classes.has("ad-row__right")) || null;
    if (sel === ":scope > .ad-row__left") return this.children.find((c) => c.classes.has("ad-row__left")) || null;
    return null;
  }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}

const openedModals = [];
const shownMenus = [];
const notices = [];

const obsidianStub = `
export class Plugin {
  constructor() { this.cleanups = []; }
  register(fn) { this.cleanups.push(fn); }
  registerView() {}
  addRibbonIcon() {}
  addSettingTab() {}
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  addCommand(cmd) { (this._commands ||= []).push(cmd); }
  registerObsidianProtocolHandler() {}
  registerInterval(id) { this.register(() => clearInterval(id)); }
}
export class Notice {
  constructor(msg, ms) { this.msg = msg; this.ms = ms; globalThis.__testObsidian.notices.push(String(msg)); }
  hide() {}
}
export class Modal {
  constructor(app) { this.app = app; this.contentEl = new globalThis.__testObsidian.Element(); this.modalEl = new globalThis.__testObsidian.Element(); this.scope = { register() {} }; }
  open() { globalThis.__testObsidian.openedModals.push(this); return this.onOpen?.(); }
  close() { this.closed = true; return this.onClose?.(); }
  onOpen() {}
  onClose() {}
}
export class Menu {
  constructor() { this.items = []; }
  addItem(fn) {
    const mi = {
      title: "", disabled: false, icon: "", handler: null,
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setDisabled(d) { this.disabled = !!d; return this; },
      setChecked() { return this; },
      onClick(fn2) { this.handler = fn2; return this; },
    };
    fn(mi);
    this.items.push(mi);
    return this;
  }
  addSeparator() { this.items.push({ separator: true }); return this; }
  showAtMouseEvent() { globalThis.__testObsidian.shownMenus.push(this); }
  showAtPosition() { globalThis.__testObsidian.shownMenus.push(this); }
}
export class MarkdownView {}
export class ItemView { constructor(leaf) { Object.assign(this, leaf); this.contentEl = new globalThis.__testObsidian.Element(); } }
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new globalThis.__testObsidian.Element(); } }
export class MarkdownRenderChild { constructor(el) { this.el = el; } }
export class Component { unload() {} }
export class MarkdownRenderer { static async render() {} }
export class FuzzySuggestModal extends Modal {}
export class EditorSuggest { constructor(app) { this.app = app; } }
export class App {}
export const editorInfoField = {};
export function setIcon() {}
`;

const cmViewStub = `
export class Decoration { static widget(s) { return s; } static line(s) { return s; } static mark(s) { return s; } static replace(s) { return s; } }
export class WidgetType {}
export class ViewPlugin { static fromClass(c) { return c; } }
export class EditorView { static domEventHandlers() { return {}; } static decorations = { from() { return {}; } }; }
`;

const cmStateStub = `
export class RangeSetBuilder { add() {} finish() { return {}; } }
export class StateEffect { static define() { return { of(v) { return { is: () => true, value: v }; } }; } }
export class StateField { static define() { return {}; } }
export class EditorState {}
export const Prec = { highest(x) { return x; }, high(x) { return x; } };
`;

const cmLangStub = `
export function foldedRanges() { return { iter() {} }; }
export const foldEffect = { of() { return {}; } };
export const unfoldEffect = { of() { return {}; } };
export function syntaxTree() { return { iterate() {} }; }
`;

globalThis.__testObsidian = { Element, openedModals, shownMenus, notices };
globalThis.document = { activeElement: null, createElement: (t) => new Element(t), body: new Element("body") };
globalThis.window = { setTimeout, clearTimeout, innerWidth: 1000, innerHeight: 800 };

const bundle = await esbuild.build({
  stdin: {
    contents: `
      export { default as AgentDeckPlugin } from "./src/main.js";
      export { AgentDeckSettingsTab } from "./src/settings.js";
      export { DelegateOptionsModal, ConfirmSendModal, FollowUpModal, renderProjectFolderPicker } from "./src/dialog.js";
      export { MemoryReviewModal } from "./src/memory-review.js";
      export { ConversationModal, AcpPermissionModal } from "./src/conversation-modal.js";
      export { ReplyInboxView } from "./src/reply-inbox-view.js";
      export { ReplyModal } from "./src/reply-modal.js";
      export { canContinueSession } from "./src/agent-registry.js";
      export { Delegator, findDraftLink } from "./src/delegation.js";
      export { applyStatusChoice } from "./src/task-status.js";
      export { DEFAULTS, deepMerge } from "./src/constants.js";
    `,
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".swift": "text" },
  write: false,
  plugins: [{
    name: "test-stubs",
    setup(b) {
      b.onResolve({ filter: /^obsidian$|^@codemirror\/|\.png$/ }, (args) => ({ path: args.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
        if (args.path === "obsidian") return { contents: obsidianStub, loader: "js" };
        if (args.path === "@codemirror/view") return { contents: cmViewStub, loader: "js" };
        if (args.path === "@codemirror/state") return { contents: cmStateStub, loader: "js" };
        if (args.path === "@codemirror/language") return { contents: cmLangStub, loader: "js" };
        return { contents: 'export default "icon.png";', loader: "js" };
      });
    },
  }],
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-next-fixes-"));
const modFile = path.join(tmpDir, "bundle.mjs");
fs.writeFileSync(modFile, bundle.outputFiles[0].text);
const M = await import(pathToFileURL(modFile));

function makeVaultEnv(initialNotes = {}) {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ad-vault-"));
  const files = new Map();
  for (const [p, text] of Object.entries(initialNotes)) files.set(p, { path: p, extension: "md", text });
  const vault = {
    getAbstractFileByPath: (p) => files.get(p) || null,
    createFolder: async () => {},
    create: async (p, text) => { const f = { path: p, extension: "md", text }; files.set(p, f); return f; },
    modify: async (f, text) => { f.text = text; },
    read: async (f) => f.text,
    process: async (f, fn) => { f.text = fn(f.text); },
    getMarkdownFiles: () => [...files.values()],
  };
  return { vaultRoot, files, vault, cleanup: () => fs.rmSync(vaultRoot, { recursive: true, force: true }) };
}

function makePlugin(env, { leaves = [], activeFile = null } = {}) {
  const p = new M.AgentDeckPlugin();
  p.settings = M.deepMerge(M.DEFAULTS, {});
  p.jobs = {};
  p._lineMaps = {};
  p.views = new Set();
  p.vaultPath = env.vaultRoot;
  p.saveSettings = async () => { p._saved = (p._saved || 0) + 1; };
  p.saveJobs = () => {};
  p.refreshUI = () => {};
  p.checkAttention = () => {};
  p.agentEnabled = (id) => p.settings.agents?.[id] !== false;
  p.isPrimary = (id) => (p.settings.primaryAgents || []).includes(id);
  p.allModels = () => [{ id: "gpt-6.1-sol", agent: "codex", name: "GPT 6.1" }];
  p.modelsFor = (id) => p.allModels().filter((m) => m.agent === id);
  p.modelById = () => null;
  p.modelEnabled = () => true;
  p.defaultModel = (id) => p.settings.delegate?.[id]?.model || "";
  p.defaultTarget = () => p.settings.delegate?.target || "claude";
  p.usage = { meta: new Map(), liveSessions: () => [] };
  p.app = {
    vault: env.vault,
    metadataCache: { getFirstLinkpathDest: () => null },
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => leaves.find((l) => l.view?.file?.path === activeFile?.path)?.view || null,
      getLeavesOfType: () => [],
      iterateAllLeaves: (fn) => { for (const leaf of leaves) fn(leaf); },
      openLinkText: async () => {},
    },
  };
  p.delegator = new M.Delegator(p);
  return p;
}

test("P0 #1: settings, DelegateOptionsModal, AcpPermissionModal expose Antigravity autoApprove + one-click button, and ConversationModal remains read-only", async () => {
  openedModals.length = 0;
  const env = makeVaultEnv({ "note.md": "- TODO test task\n" });
  try {
    const p = makePlugin(env);
    // 1. Settings tab renders antigravity autoApprove toggle
    const tab = new M.AgentDeckSettingsTab(p.app, p);
    const body = new Element();
    tab.renderDelegate(body);
    const agyCard = body.all().find((el) => el.tag === "details" && el.dataset?.agent === "antigravity");
    assert.ok(agyCard, "antigravity settings card rendered");
    const autoRow = agyCard.all().find((el) => el.classes.has("ad-row") && el.all().some((c) => c.text === "自动允许工具调用"));
    assert.ok(autoRow, "antigravity card renders 自动允许工具调用 row");
    const autoToggle = autoRow.all().find((el) => el.classes.has("ad-switch"));
    assert.ok(autoToggle, "antigravity card has autoApprove toggle");
    assert.equal(p.settings.delegate.antigravity.autoApprove, false);
    autoToggle.onclick();
    assert.equal(p.settings.delegate.antigravity.autoApprove, true);
    p.settings.delegate.antigravity.autoApprove = false;

    // 2. DelegateOptionsModal renders auto-approve switch for antigravity
    const dm = new M.DelegateOptionsModal(p.app, p, "note.md", 0);
    dm.agent = "antigravity";
    await dm.onOpen();
    const dmText = dm.contentEl.all().map((e) => e.text).join("\n");
    assert.ok(dmText.includes("Auto-approve tool calls"), "DelegateOptionsModal shows Auto-approve toggle for Antigravity");
    assert.ok(!dmText.includes("工具请求逐次确认，完成后"), "hint does not contradict autoApprove toggle");
    const dmSwitch = dm.contentEl.all().find((e) => e.classes.has("ad-switch"));
    dmSwitch.onclick();
    assert.equal(p.settings.delegate.antigravity.autoApprove, true);
    p.settings.delegate.antigravity.autoApprove = false;

    // 3. AcpPermissionModal one-click button sets autoApprove=true and resolves with allow option
    const runner = {};
    const choicePromise = p.requestAcpPermission({
      agent: "antigravity",
      toolCall: { title: "Run shell" },
      options: [{ optionId: "permit-1", name: "Allow once", kind: "allow_once" }, { optionId: "deny-1", name: "Reject", kind: "reject_once" }],
    }, runner);
    const permModal = openedModals.at(-1);
    const autoBtn = permModal.contentEl.all().find((el) => el.tag === "button" && el.text.includes("允许并开启"));
    assert.ok(autoBtn, "AcpPermissionModal exposes one-click auto-approve button");
    autoBtn.onclick();
    const chosen = await choicePromise;
    assert.equal(chosen, "permit-1");
    assert.equal(p.settings.delegate.antigravity.autoApprove, true);

    // 4. ConversationModal stays purely read-only (no textarea/input) and shows ACP follow-up hint
    const cm = new M.ConversationModal(p.app, p, { agent: "antigravity", sid: "s-acp", transport: "acp" });
    cm.onOpen();
    assert.equal(cm.contentEl.all().filter((e) => e.tag === "textarea" || e.tag === "input").length, 0, "ConversationModal stays read-only");
    assert.ok(cm.contentEl.all().some((e) => e.text.includes("继续对话（追问）")));
    cm.close();
  } finally {
    env.cleanup();
  }
});

test("P0 #2: toggleBoardFile passes plugin instance to dispatchRefresh without TypeError", async () => {
  const env = makeVaultEnv({ "board.md": "- [ ] A\n- [ ] B\n" });
  try {
    let dispatched = 0;
    const leaf = { view: { file: { path: "board.md" }, editor: { cm: { dispatch() { dispatched++; } } } } };
    const p = makePlugin(env, { leaves: [leaf], activeFile: { path: "board.md" } });
    p.toggleBoardFile();
    assert.equal(p.settings.taskBoardFiles["board.md"], true);
    assert.equal(dispatched, 1, "dispatchRefresh(this) refreshed the open CodeMirror editor");
  } finally {
    env.cleanup();
  }
});

test("P0 #3 & P2 #7: canContinueSession, ReplyInboxView, replyToQuestion, taskActions, FollowUpModal, and submitWrittenReply", async () => {
  assert.equal(M.canContinueSession({ agent: "claude", sid: "c1" }), false);
  assert.equal(M.canContinueSession({ agent: "codex", sid: "x1" }), false);
  assert.equal(M.canContinueSession({ agent: "qoder", sid: "q1" }), false);
  assert.equal(M.canContinueSession({ agent: "dsh", sid: "d1" }), true);
  assert.equal(M.canContinueSession({ agent: "opencode", sid: "o1" }), true);
  assert.equal(M.canContinueSession({ agent: "antigravity", sid: "a1" }), false);
  assert.equal(M.canContinueSession({ agent: "antigravity", sid: "a1", transport: "acp" }), true);

  const note = [
    "- DOING 任务甲 ^ad-a",
    "\t- 🔗 [Antigravity：任务甲](obsidian://agent-deck?do=open&agent=antigravity&sid=agy-123) `agy-123`",
    "- DOING 任务乙 ^ad-b",
    "\t- 🔗 [Claude：任务乙](claude://resume?session=11111111-2222-3333-4444-555555555555)",
    "\t- ❓ 第1轮：用方案 A 还是 B？",
    "- DOING 任务丙 ^ad-c",
    "\t- 🔗 [DeepSeek Harness：任务丙](dsh://open) `session-11111111-2222-3333-4444-555555555555`",
    "\t- ❓ 第1轮：选哪个？ ^q1",
    "\t- ✍️ 答：选方案 A",
  ].join("\n");
  const env = makeVaultEnv({ "daily.md": note });
  try {
    const editorView = {
      file: { path: "daily.md" },
      getMode: () => "source",
      containerEl: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      editor: {
        getValue: () => env.files.get("daily.md").text,
        getLine: (n) => env.files.get("daily.md").text.split("\n")[n] || "",
        getCursor: () => ({ line: 3 }),
        setCursor() {},
      },
    };
    const p = makePlugin(env, { leaves: [{ view: editorView }] });
    p.jobs = {
      j1: { id: "j1", agent: "antigravity", transport: "acp", sessionId: "agy-123", path: "daily.md", blockId: "ad-a", state: "done" },
    };

    // 1. ReplyInboxView hides 回答并继续 for claude, keeps it for antigravity ACP
    const inbox = new M.ReplyInboxView({ containerEl: new Element() }, p);
    const c1 = new Element();
    inbox.row(c1, { path: "daily.md", agent: "claude", sid: "1111", question: "Q?" });
    assert.equal(c1.all().some((e) => e.text === "回答并继续"), false, "claude inbox item omits broken 回答并继续");
    assert.equal(c1.all().some((e) => e.text === "先记下回答"), true);

    const c2 = new Element();
    inbox.row(c2, { path: "daily.md", agent: "antigravity", sid: "agy-123", question: "Q?" });
    assert.equal(c2.all().some((e) => e.text === "回答并继续"), true, "antigravity ACP inbox item shows 回答并继续");

    // 2. replyToQuestion passes canContinue: false for Claude task
    openedModals.length = 0;
    await p.replyToQuestion("daily.md", editorView.editor, { line: 2 });
    assert.equal(openedModals.at(-1).canContinue, false);

    // 3. taskActions for Antigravity ACP (without ❓): shows 继续对话（追问） and NO 在客户端打开
    shownMenus.length = 0;
    await p.taskActions("daily.md", 0);
    const agyMenu = shownMenus.at(-1).items.filter((i) => !i.separator).map((i) => i.title);
    assert.ok(agyMenu.some((t) => t.startsWith("继续对话（追问）")), "Antigravity ACP gets follow-up entry without ❓");
    assert.ok(agyMenu.some((t) => t.startsWith("查看正文与保存对话")));
    assert.equal(agyMenu.some((t) => t.startsWith("在客户端打开")), false);

    // 4. taskActions for Claude: NO duplicate 继续对话, ONLY ONE 在客户端打开
    shownMenus.length = 0;
    await p.taskActions("daily.md", 2);
    const claudeMenu = shownMenus.at(-1).items.filter((i) => !i.separator).map((i) => i.title);
    assert.equal(claudeMenu.filter((t) => t.startsWith("继续对话")).length, 0);
    assert.equal(claudeMenu.filter((t) => t.startsWith("在客户端打开")).length, 1);

    // 5. taskActions for DSH with hand-written ✍️ 答: shows 把已写好的 ✍️ 答 发给会话继续, and only 1 在客户端打开
    shownMenus.length = 0;
    await p.taskActions("daily.md", 5);
    const dshMenu = shownMenus.at(-1).items.filter((i) => !i.separator).map((i) => i.title);
    assert.ok(dshMenu.includes("把已写好的 ✍️ 答 发给会话继续"));
    assert.equal(dshMenu.filter((t) => t.startsWith("在客户端打开")).length, 1);

    // 6. submitWrittenReply dispatches continueSession with the hand-written answer
    let continued = null;
    p.delegator.continueSession = async (session, prompt) => { continued = { session, prompt }; };
    p.settings.replyInbox = [{ path: "daily.md", blockId: "ad-c", questionId: "q1", question: "选哪个？" }];
    await p.submitWrittenReply("daily.md", editorView.editor, { line: 5 });
    assert.ok(continued?.prompt.includes("选方案 A"));
    assert.equal(continued?.session.path, "daily.md");
    assert.equal(continued?.session.blockId, "ad-c");
    assert.equal(p.settings.replyInbox.length, 0, "sent reply is removed from inbox");

    // 7. FollowUpModal sends prompt and stays open if onSubmit throws
    openedModals.length = 0;
    let shouldFail = true;
    const fm = new M.FollowUpModal(p.app, {
      session: { agent: "antigravity", sid: "agy-123" },
      onSubmit: async (txt) => { if (shouldFail) throw new Error("boom"); continued = { prompt: txt }; },
    });
    fm.onOpen();
    const ta = fm.contentEl.all().find((e) => e.tag === "textarea");
    const sendBtn = fm.contentEl.all().find((e) => e.classes.has("ad-send__go"));
    ta.value = "请继续检查";
    await sendBtn.onclick();
    assert.notEqual(fm.closed, true, "modal stays open on error so user does not lose prompt");
    assert.equal(sendBtn.disabled, false);
    shouldFail = false;
    await sendBtn.onclick();
    assert.equal(fm.closed, true);
    assert.equal(continued.prompt, "请继续检查");
  } finally {
    env.cleanup();
  }
});

test("P1 #4: Reading view (preview mode) reads fresh vault text in gripSend, taskActions, gripPick, replyToQuestion, applyStatusChoice", async () => {
  const freshNote = [
    "- DOING 后台任务 ^ad-pv",
    "\t- 🔗 [Antigravity：后台任务](obsidian://agent-deck?do=open&agent=antigravity&sid=agy-pv) `agy-pv`",
    "\t- ❓ 第1轮：继续吗？",
  ].join("\n");
  const env = makeVaultEnv({ "preview.md": freshNote });
  try {
    const stalePreviewView = {
      file: { path: "preview.md" },
      getMode: () => "preview",
      containerEl: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      editor: {
        getValue() { throw new Error("must not read stale hidden preview editor"); },
        transaction() { throw new Error("must not write stale hidden preview editor"); },
        getCursor() { return { line: 0 }; },
      },
    };
    const p = makePlugin(env, { leaves: [{ view: stalePreviewView }], activeFile: { path: "preview.md" } });
    // gripSend should see the fresh 🔗 link and open taskActions instead of delegating again
    shownMenus.length = 0;
    await p.gripSend({ path: "preview.md", line: 0, lineText: "- DOING 后台任务 ^ad-pv" });
    assert.equal(shownMenus.length, 1, "gripSend opens taskActions in Reading view");
    assert.ok(shownMenus[0].items.some((i) => i.title?.startsWith("继续对话（追问）")));

    // gripPick should also route to taskActions in Reading view
    shownMenus.length = 0;
    await p.gripPick({ path: "preview.md", line: 0, lineText: "- DOING 后台任务 ^ad-pv" });
    assert.equal(shownMenus.length, 1, "gripPick opens taskActions in Reading view");

    // planTask / makeDispatchDraft must not read stale hidden preview editor
    notices.length = 0;
    await p.makeDispatchDraft();
    assert.ok(notices.at(-1).includes("请先打开笔记"));

    // applyStatusChoice must write via vault.process instead of stale hidden preview editor
    await M.applyStatusChoice(p, { path: "preview.md", raw: "- DOING 后台任务 ^ad-pv" }, "DONE");
    assert.ok(env.files.get("preview.md").text.startsWith("- DONE 后台任务"));
  } finally {
    env.cleanup();
  }
});

test("P1 #5 & P2 #6: makeDispatchDraft parses @agent, status:draft lifecycle prevents double-dispatch, and ConfirmSendModal previews draft + picks project", async () => {
  const env = makeVaultEnv({
    "inbox.md": "- TODO @codex/gpt-6.1-sol/low 写个测试 ^ad-draft1\n",
  });
  try {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-proj-"));
    const conflictDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-conf-"));
    try {
      const editorView = {
        file: { path: "inbox.md" },
        getMode: () => "source",
        editor: {
          getValue: () => env.files.get("inbox.md").text,
          getCursor: () => ({ line: 0 }),
          transaction({ changes }) {
            let txt = env.files.get("inbox.md").text;
            const c = changes[0];
            const lines = txt.split("\n");
            lines.splice(c.from.line, c.to.line - c.from.line + 1, ...c.text.split("\n"));
            env.files.get("inbox.md").text = lines.join("\n");
          },
        },
      };
      const p = makePlugin(env, { leaves: [{ view: editorView }], activeFile: { path: "inbox.md" } });
      p.settings.delegate.confirmFirst = false;
      p.settings.projectFolders = { inbox: projectDir };
      p.usage.meta.set("s-recent", { cwd: conflictDir, lastAt: Date.now() });

      // 1. makeDispatchDraft parses @codex/gpt-6.1-sol/low
      await p.makeDispatchDraft();
      const noteAfterDraft = env.files.get("inbox.md").text;
      const draftPath = M.findDraftLink(noteAfterDraft.split("\n"), { start: 0, end: 2 }) + ".md";
      assert.ok(draftPath.startsWith("Agent Deck/派发/"));
      const draftText = env.files.get(draftPath).text;
      assert.match(draftText, /^status: draft$/m);
      assert.match(draftText, /^agent: codex$/m);
      assert.match(draftText, /^model: "gpt-6.1-sol"$/m);
      assert.match(draftText, /^effort: "low"$/m);

      // Edit the draft body
      env.files.get(draftPath).text = draftText.replaceAll("写个测试", "用户改过的草稿正文");

      // 2. Non-consuming preview read keeps status: draft; ConfirmSendModal previews draft + project selector
      const preview = await p.delegator.readDraft(draftPath.replace(/\.md$/, ""), null, { consume: false });
      assert.ok(preview.body.includes("用户改过的草稿正文"));
      assert.match(env.files.get(draftPath).text, /^status: draft$/m, "consume:false leaves draft untouched");

      openedModals.length = 0;
      await p.delegateDrop("claude", { path: "inbox.md", line: 0, lineText: noteAfterDraft.split("\n")[0] });
      const confirmModal = openedModals.at(-1);
      assert.equal(confirmModal.agent, "codex", "ConfirmSendModal resolved @codex from task line");
      const modalText = confirmModal.contentEl.all().map((e) => e.text).join("\n");
      assert.ok(modalText.includes("将发送已编辑草稿"), "ConfirmSendModal shows draft banner");
      assert.ok(modalText.includes("用户改过的草稿正文"), "ConfirmSendModal previews edited draft body");
      const folderSelect = confirmModal.contentEl.all().find((e) => e.tag === "select" && e.children.some((o) => o.value === "inbox"));
      assert.ok(folderSelect, "ConfirmSendModal renders project folder selector");

      // P2 #6: conflict detection inside ConfirmSendModal resolves & forwards cwd + fromDialog:true without falling back to vaultPath
      let delegatedOpts = null;
      p.delegator.delegate = async (opts) => { delegatedOpts = opts; };
      env.files.set("inbox-conflict.md", { path: "inbox-conflict.md", extension: "md", text: "- TODO [[conf-proj]] 冲突测试\n" });
      const confName = path.basename(conflictDir);
      env.files.set("inbox-conflict.md", { path: "inbox-conflict.md", extension: "md", text: `- TODO [[${confName}]] 冲突测试\n` });
      p.projectFolderSuggestions = () => [{ name: confName, path: conflictDir }];
      p.settings.projectFolders = { "inbox-conflict": projectDir };
      openedModals.length = 0;
      await p.delegateDrop("claude", { path: "inbox-conflict.md", line: 0, lineText: `- TODO [[${confName}]] 冲突测试` });
      const confModal = openedModals.at(-1);
      const useTaskBtn = confModal.contentEl.all().find((e) => e.tag === "button" && e.text === "用任务的项目并记住");
      assert.ok(useTaskBtn, "ConfirmSendModal surfaces conflict resolution button");
      await useTaskBtn.onclick();
      assert.equal(p.settings.projectFolders[confName], normalizeProjectFolder(conflictDir), "conflict choice remembers project folder");
      const sendBtn = confModal.contentEl.all().find((e) => e.classes.has("ad-send__go"));
      sendBtn.onclick();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(normalizeProjectFolder(delegatedOpts?.cwd), normalizeProjectFolder(conflictDir), "ConfirmSendModal passes chosen cwd to delegate");
      assert.equal(delegatedOpts?.fromDialog, true, "ConfirmSendModal sets fromDialog:true so delegate does not fall back to vaultPath");

      // Stub delegator.delegate check is done; restore real readDraft check for consumed draft lifecycle
      const consumed = await p.delegator.readDraft(draftPath.replace(/\.md$/, ""), { file: { path: "inbox.md" } });
      assert.ok(consumed.body.includes("用户改过的草稿正文"));
      assert.match(env.files.get(draftPath).text, /^status: dispatched$/m, "consumed draft turns status: dispatched");
      assert.ok(env.files.get("inbox.md").text.includes("已派发载荷"), "note link label updates from 派发草稿 to 已派发载荷");
      assert.equal(M.findDraftLink(env.files.get("inbox.md").text.split("\n"), { start: 0, end: 2 }), "", "dispatched link ignored by findDraftLink");
      assert.equal(await p.delegator.readDraft(draftPath.replace(/\.md$/, ""), null), null, "dispatched draft is never reused");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(conflictDir, { recursive: true, force: true });
    }
  } finally {
    env.cleanup();
  }
});

test("P2 #8: lineMap caches static doc index separately from live session/job state + refreshEditorsNow", async () => {
  const env = makeVaultEnv({});
  try {
    let dispatched = 0;
    const leaf = { view: { editor: { cm: { dispatch() { dispatched++; } } } } };
    const p = makePlugin(env, { leaves: [leaf] });
    const sid = "11111111-2222-3333-4444-555555555555";
    let docCalls = 0;
    const doc = {
      toString() {
        docCalls++;
        return `- DOING 任务\n  - 🔗 [Codex](codex://threads/${sid})`;
      },
    };
    let liveState = "wait";
    p.usage = {
      meta: new Map([[sid, { sid, agent: "codex", state: "wait", out: 10, fresh: 20 }]]),
      liveSessions: () => [{ sid, state: liveState }],
    };

    const first = p.lineMap("note.md", doc);
    assert.equal(docCalls, 1);
    assert.equal(first.sessionByParent.get(0).state, "wait");

    // Mutate live state + jobs WITHOUT touching _lineMaps or doc reference
    liveState = "run";
    p.jobs = { j1: { id: "j1", sessionId: sid, step: "editing" } };
    const second = p.lineMap("note.md", doc);
    assert.equal(docCalls, 1, "doc structure is cached across runtime state changes");
    assert.equal(second.sessionByParent.get(0).state, "run", "live state updates immediately without clearing _lineMaps");
    assert.equal(second.sessionByParent.get(0).job?.step, "editing");

    p.refreshEditorsNow();
    assert.equal(dispatched, 1, "refreshEditorsNow synchronously dispatches editor refresh");
    p.lineMap("note.md", doc);
    assert.equal(docCalls, 2, "refreshEditorsNow clears _lineMaps cache");
  } finally {
    env.cleanup();
  }
});

test("Workspace picker sel.onchange conflict guard & MemoryReviewModal conflict peer skip", async () => {
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "ad-ui-p1-"));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ad-ui-p2-"));
  const env = makeVaultEnv({});
  try {
    const p = makePlugin(env);
    p.settings.projectFolders = { demo: dir1 };
    const state = {
      projectHint: { name: "demo", path: dir1 },
      projectSuggest: { name: "other", path: dir2 },
      projectConflict: true,
      projectAlt: "other",
      cwd: dir2,
      customCwd: false,
    };
    let renders = 0;
    const host = new Element();
    M.renderProjectFolderPicker(host, p, state, { compact: true, onRender: () => { renders++; } });
    const sel = host.all().find((el) => el.tag === "select");
    sel.value = "__suggested";
    sel.onchange();
    assert.equal(state.projectConflict, false);
    assert.equal(state.projectHint, null);
    assert.equal(state.cwd, dir2, "__suggested preserves prevSuggest.path across clearing");
    sel.value = "";
    sel.onchange();
    assert.equal(state.cwd, "", "switching to vault root clears cwd cleanly without TypeError");
    assert.equal(renders, 2);

    const peerEntry = { path: "Agent Deck/记忆/冲突二.md", kind: "fact", state: "有效", text: "旧结论", conflictsWith: ["[[Agent Deck/记忆/冲突一]]"] };
    const keepEntry = { path: "Agent Deck/记忆/冲突一.md", kind: "fact", state: "有效", text: "新结论", conflictsWith: ["[[Agent Deck/记忆/冲突二]]"] };
    const thirdEntry = { path: "Agent Deck/记忆/第三条.md", kind: "fact", state: "有效", text: "第三条" };
    const revModal = new M.MemoryReviewModal(
      { workspace: {} },
      [keepEntry, peerEntry, thirdEntry],
      async () => {},
      () => {},
      { onResolveConflict: async () => {}, allEntries: [keepEntry, peerEntry, thirdEntry] },
    );
    revModal.onOpen();
    const keepBtn = revModal.contentEl.all().find((el) => el.text === "保留本条·淘汰对方");
    assert.ok(keepBtn, "Conflict resolution button is rendered");
    await keepBtn.listeners.click[0]();
    assert.equal(peerEntry._skipInReview, true);
    await revModal.commitState("有效");
    assert.equal(revModal.index, 2, "stepping forward skips deprecated conflict peer");
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
    env.cleanup();
  }
});

test("AgentDeckPlugin exposes agentCatalog (21+ agents) and spiralUsageSnapshot with live today overlay", async () => {
  const env = makeVaultEnv({});
  try {
    const p = makePlugin(env);
    const catalog = p.agentCatalog();
    for (const id of AGENT_ORDER) {
      assert.ok(catalog[id]?.color, `catalog includes ${id}`);
    }
    assert.ok(Object.keys(catalog).length >= 21, "catalog covers all 21 built-in agents");

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const todayUnderscore = `${now.getFullYear()}_${pad2(now.getMonth() + 1)}_${pad2(now.getDate())}`;
    const todayDash = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    p.settings.dayCutoff = 0;
    p.store = {
      days: {
        "2026_11_20": { wall: 42, agent: 55, out: 1200, segs: [[600, 642]], by: { hermes: { wall: 42, agent: 55, out: 1200, segs: [[600, 642]] } }, list: [] },
        [todayUnderscore]: { wall: 5, agent: 5, out: 100, segs: [[500, 505]], by: { claude: { wall: 5, agent: 5, out: 100, segs: [[500, 505]] } }, list: [] },
      },
    };
    p.usage = {
      summary: (k) => (k === todayUnderscore ? {
        wall: 30, agent: 40, out: 900, segs: [[600, 630]],
        by: { claude: { wall: 15, segs: [[600, 615]], out: 400 }, cursor: { wall: 20, segs: [[610, 630]], out: 500 } },
        list: [{ sid: "s-cur", agent: "cursor", min: 20, out: 500, segs: [[610, 630]] }],
      } : null),
    };

    const snap = p.spiralUsageSnapshot("YYYY-MM-DD");
    assert.equal(snap.source, "agent-deck");
    assert.equal(snap.days["2026-11-20"].by.hermes.wall, 42);
    assert.equal(snap.days[todayDash].wall, 30, "today snapshot overlays live summary");
    assert.equal(snap.days[todayDash].by.cursor.wall, 20);
  } finally {
    env.cleanup();
  }
});

test("extractTaskProgress, progress survival across journal transforms, and AgentDeckPlugin mirror bridge", async () => {
  // 1. Progress extraction ignores dates, inline code, and wikilinks
  assert.deepEqual(J.extractTaskProgress("- DOING 写文档 25%"), { pct: 25, raw: "25%" });
  assert.deepEqual(J.extractTaskProgress("- TODO 修接口 进度 40% ^ad-x"), { pct: 40, raw: "进度 40%" });
  assert.deepEqual(J.extractTaskProgress("- TODO 看论文 1/3 2h"), { pct: 33, raw: "1/3" });
  assert.deepEqual(J.extractTaskProgress("- TODO 读完一半"), { pct: 50, raw: "一半" });
  assert.equal(J.extractTaskProgress("- TODO 核对 11/27 账单"), null);
  assert.equal(J.extractTaskProgress("- TODO 检查 `50%` 和 [[计划 75%]]"), null);

  // 2. Progress survives splitTask, flipToDone, cleanCompletedIdentifiers, bindInto, syncSessionEntry
  const sid = "33333333-4444-5555-6666-777777777777";
  const line = "- TODO [#A] 重构鉴权 50% 2h ^ad-prog-1";
  assert.ok(J.splitTask(line).rest.includes("50%"));
  const doneLine = J.flipToDone(line);
  assert.ok(doneLine.includes("DONE") && doneLine.includes("50%"), "flipToDone preserves 50%");
  const cleaned = J.cleanCompletedIdentifiers(`${doneLine}\n\t- ⏱ 10:00–11:00 · 共 1h · Codex`, new Set(["ad-prog-1"]));
  assert.ok(cleaned.includes("50%"), "cleanCompletedIdentifiers preserves 50%");
  const bound = J.bindInto("- TODO 补测试 进度 40% 1h\n", 0, { sid, agent: "codex", title: "补测试", state: "run", since: "10:00" }, { direct: true });
  assert.ok(bound.text.includes("进度 40%"), "direct bindInto preserves progress token");
  const synced = J.syncSessionEntry("- DOING 整理数据 1/3 ^ad-sync-p", { sid, blockId: "ad-sync-p", rounds: [{ n: 1, said: "阶段完成" }] }).text;
  assert.ok(synced.split("\n")[0].includes("1/3"), "syncSessionEntry preserves parent progress token");

  // 3. Mirror bridge resolveMirrorLine + updateMirrorBlock (preserving CRLF and strict idempotency)
  const srcNote = "# 项目计划\r\n- TODO 联调镜像同步 25% 1h ^ad-mir-1\r\n- 普通条目 备注 ^note-2\r\n```md\r\n- TODO 围栏内假任务 ^ad-mir-1\r\n```\r\n";
  const env = makeVaultEnv({
    "项目/计划.md": srcNote,
    "日记/2026_11_27.md": "- ![[项目/计划#^ad-mir-1]]\n- ![[项目/计划#^note-2]]\n",
  });
  try {
    const p = makePlugin(env);
    p.readNote = async (pth) => env.vault.read(env.vault.getAbstractFileByPath(pth));
    p.writeNote = async (pth, text) => env.vault.modify(env.vault.getAbstractFileByPath(pth), text);
    p.app.metadataCache.getFirstLinkpathDest = (target) => {
      if (target === "项目/计划") return env.vault.getAbstractFileByPath("项目/计划.md");
      return null;
    };

    const resTask = await p.resolveMirrorLine("- ![[项目/计划#^ad-mir-1]]", "日记/2026_11_27.md");
    assert.equal(resTask.path, "项目/计划.md");
    assert.equal(resTask.line, 1);
    assert.equal(resTask.blockId, "ad-mir-1");
    assert.equal(resTask.kw, "TODO");
    assert.ok(resTask.rawLine.includes("25%"));

    const resPlain = await p.resolveMirrorLine("  - ![[项目/计划#^note-2]]", "日记/2026_11_27.md");
    assert.equal(resPlain.line, 2);
    assert.ok(resPlain.rawLine.includes("普通条目"));

    const upd = await p.updateMirrorBlock(resTask, (cur) => cur.replace("TODO", "DOING").replace("25%", "50%"));
    assert.equal(upd.ok, true);
    assert.equal(upd.changed, true);
    const updatedSrc = env.vault.getAbstractFileByPath("项目/计划.md").text;
    assert.ok(updatedSrc.includes("\r\n"), "preserves CRLF line endings");
    assert.ok(updatedSrc.includes("- DOING 联调镜像同步 50% 1h ^ad-mir-1"));
    assert.ok(updatedSrc.includes("围栏内假任务 ^ad-mir-1"), "fenced block untouched");

    const noop = await p.updateMirrorBlock(resTask, (cur) => cur);
    assert.equal(noop.ok, true);
    assert.equal(noop.changed, false);

    const missing = await p.updateMirrorBlock({ path: "项目/计划.md", blockId: "nope" }, (cur) => cur + " x");
    assert.equal(missing.ok, false);
    assert.equal(missing.changed, false);
  } finally {
    env.cleanup();
  }
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
