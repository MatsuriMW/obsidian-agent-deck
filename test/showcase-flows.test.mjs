import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
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
  createEl(tag, options = {}) { const el = new Element(tag, options); return this.appendChild(el); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
  empty() { this.children = []; }
  focus() { this.focused = true; }
  contains(other) { return this.all().includes(other); }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}

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
export class Notice { constructor(msg) { this.msg = msg; } hide() {} }
export class Modal {
  constructor(app) { this.app = app; this.contentEl = new globalThis.__showcaseObs.Element(); this.modalEl = new globalThis.__showcaseObs.Element(); this.scope = { register() {} }; }
  open() { return this.onOpen?.(); }
  close() { this.closed = true; return this.onClose?.(); }
}
export class Menu {
  constructor() { this.items = []; }
  addItem(fn) { const mi = { setTitle() { return this; }, setIcon() { return this; }, setDisabled() { return this; }, setChecked() { return this; }, onClick() { return this; } }; fn(mi); this.items.push(mi); return this; }
  addSeparator() { return this; }
  showAtMouseEvent() {}
  showAtPosition() {}
}
export class MarkdownView {}
export class ItemView { constructor(leaf) { Object.assign(this, leaf); this.contentEl = new globalThis.__showcaseObs.Element(); } }
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new globalThis.__showcaseObs.Element(); } }
export class MarkdownRenderChild { constructor(el) { this.el = el; } }
export class Component { load() {} unload() {} }
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

globalThis.__showcaseObs = { Element };
globalThis.document = { activeElement: null, createElement: (t) => new Element(t), body: new Element("body") };
globalThis.window = { setTimeout, clearTimeout, innerWidth: 1000, innerHeight: 800 };

const bundle = await esbuild.build({
  stdin: {
    contents: `
      export { default as AgentDeckPlugin } from "./src/main.js";
      export { Delegator, findDraftLink } from "./src/delegation.js";
      export { registerRunnerClass } from "./src/delegation-runners.js";
      export { buildShowcaseMarkdown } from "./src/welcome-demo.js";
      export { parseThread } from "./src/thread-replies.js";
      export { buildDelegationPayload, extractWikilinkRefs } from "./src/harness.js";
      export { pickMemories } from "./src/dream.js";
      export { reconcileMemoryFile, parseMemoryFile, serializeMemoryFile } from "./src/memory-store.js";
      export { Dreaming } from "./src/dream.js";
      export { MemoryBoardView } from "./src/memory-board.js";
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
    name: "showcase-stubs",
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-showcase-"));
const modFile = path.join(tmpDir, "bundle.mjs");
fs.writeFileSync(modFile, bundle.outputFiles[0].text);
const M = await import(pathToFileURL(modFile));

function makeVaultEnv(initialNotes = {}) {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ad-showcase-vault-"));
  const files = new Map();
  const folders = new Set();
  for (const [p, text] of Object.entries(initialNotes)) {
    files.set(p, { path: p, extension: "md", text });
    const parts = p.split("/");
    parts.pop();
    let dir = "";
    for (const part of parts) {
      dir = dir ? `${dir}/${part}` : part;
      folders.add(dir);
    }
  }
  const vault = {
    getAbstractFileByPath(p) {
      if (files.has(p)) return files.get(p);
      if (folders.has(p)) {
        const children = [...files.values()].filter((f) => f.path.startsWith(`${p}/`) && !f.path.slice(p.length + 1).includes("/"));
        return { path: p, name: p.split("/").pop(), children };
      }
      return null;
    },
    createFolder: async (p) => { folders.add(p); },
    create: async (p, text) => {
      const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      if (parent && !folders.has(parent)) throw new Error(`Parent folder does not exist: ${parent}`);
      const f = { path: p, extension: "md", text };
      files.set(p, f);
      return f;
    },
    modify: async (f, text) => { f.text = text; },
    read: async (f) => f.text,
    process: async (f, fn) => { f.text = fn(f.text); },
    getMarkdownFiles: () => [...files.values()],
  };
  return { vaultRoot, files, folders, vault, cleanup: () => fs.rmSync(vaultRoot, { recursive: true, force: true }) };
}

function makePlugin(env, { leaves = [], activeFile = null, notes = {} } = {}) {
  const p = new M.AgentDeckPlugin();
  p.settings = M.deepMerge(M.DEFAULTS, { delegate: { confirmFirst: false } });
  p.jobs = {};
  p._lineMaps = {};
  p.views = new Set();
  p.vaultPath = env.vaultRoot;
  p.saveSettings = async () => {};
  p.saveJobs = () => {};
  p.refreshUI = () => {};
  p.checkAttention = () => {};
  p.agentEnabled = (id) => p.settings.agents?.[id] !== false;
  p.defaultModel = (id) => p.settings.delegate?.[id]?.model || "";
  p.defaultTarget = () => p.settings.delegate?.target || "claude";
  p.usage = { meta: new Map(), liveSessions: () => [] };
  p.app = {
    vault: env.vault,
    metadataCache: {
      getFirstLinkpathDest: (name) => {
        const target = notes[String(name).trim()] || [...env.files.keys()].find((k) => k === name || k === `${name}.md` || k.endsWith(`/${name}.md`));
        return target ? { path: target, extension: "md" } : null;
      },
      resolvedLinks: {},
    },
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => leaves.find((l) => l.view?.file?.path === activeFile?.path)?.view || null,
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: async () => {}, view: new M.MemoryBoardView({}, p) }),
      revealLeaf: () => {},
      iterateAllLeaves: (fn) => { for (const leaf of leaves) fn(leaf); },
      openLinkText: async () => {},
    },
  };
  p.delegator = new M.Delegator(p);
  p.dreaming = new M.Dreaming(p);
  return p;
}

test("Showcase §4 bilingual Q&A parses cleanly and backticked example links are ignored", () => {
  for (const lang of ["zh", "en"]) {
    const md = M.buildShowcaseMarkdown(lang);
    const lines = md.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("- TODO ") && (l.includes("双链上下文协议") || l.includes("Project Architecture")));
    assert.ok(idx >= 0, `${lang} Section 4 task exists`);
    const parsed = M.parseThread(lines, { start: idx, end: lines.length - 1 });
    assert.equal(parsed.questions.length, 1, `${lang} Section 4 Q&A parsed`);
    assert.ok(parsed.questions[0].answer.length > 0, `${lang} Section 4 Answer parsed without prefix`);
    assert.ok(!parsed.questions[0].answer.startsWith("Answer:"), "English Answer: prefix is stripped");
    assert.ok(!parsed.questions[0].answer.startsWith("答："), "Chinese 答： prefix is stripped");

    const refs = M.extractWikilinkRefs([lines[idx]]);
    assert.equal(refs.length, 0, `${lang} backticked demo wikilinks are not treated as real note refs`);
  }
});

test("Showcase §4 draft flow: Delegator.delegate actually sends user-edited draft and preserves skill/note enrichments", async () => {
  const env = makeVaultEnv({
    "inbox.md": "- TODO @claude 结合 [[资料A]] 推进任务 ^ad-d1\n",
    "资料/资料A.md": "# 资料A\n参考内容 A\n",
    "技能/my-skill.md": "---\ntype: 技能\nskill: \"my-skill\"\npath: \"/tmp/skills/my-skill/SKILL.md\"\n---\n",
  });
  let capturedPrompt = "";
  class FakeClaudeRunner {
    constructor(d, j) { this.d = d; this.j = j; }
    async start(opts) { capturedPrompt = opts.prompt; }
    cancel() {}
  }
  M.registerRunnerClass("claude", FakeClaudeRunner);
  try {
    const editorView = {
      file: { path: "inbox.md" },
      getMode: () => "source",
      editor: {
        getValue: () => env.files.get("inbox.md").text,
        getCursor: () => ({ line: 0 }),
        transaction({ changes }) {
          const lines = env.files.get("inbox.md").text.split("\n");
          const c = changes[0];
          lines.splice(c.from.line, c.to.line - c.from.line + 1, ...c.text.split("\n"));
          env.files.get("inbox.md").text = lines.join("\n");
        },
      },
    };
    const p = makePlugin(env, { leaves: [{ view: editorView }], activeFile: { path: "inbox.md" } });
    await p.makeDispatchDraft();
    const draftPath = M.findDraftLink(env.files.get("inbox.md").text.split("\n"), { start: 0, end: 2 }) + ".md";
    assert.ok(env.files.has(draftPath), "draft file created");
    // User edits the draft and adds a real [[技能/my-skill]] + keeps a backticked `[[技能/fake-skill]]`
    env.files.get(draftPath).text = env.files.get(draftPath).text.replace(
      "结合 [[资料A]] 推进任务",
      "USER_EDITED_DRAFT_TEXT 使用 [[技能/my-skill]]，不要管 `[[技能/fake-skill]]`",
    );
    await p.delegator.delegate({ file: { path: "inbox.md" }, line: 0, destination: "background" });
    assert.ok(capturedPrompt.includes("USER_EDITED_DRAFT_TEXT"), "runner receives the user-edited draft body, NOT overwritten by bundle");
    assert.ok(capturedPrompt.startsWith("本次任务按这份已确认的草稿执行："), "draft approval header stays at line 0");
    assert.ok(capturedPrompt.includes("/tmp/skills/my-skill/SKILL.md"), "skill added in draft resolves to real SKILL.md path");
    assert.ok(!capturedPrompt.includes("fake-skill/SKILL.md"), "backticked skill link is ignored");
    assert.match(env.files.get(draftPath).text, /^status: dispatched$/m);
    assert.ok(env.files.get("inbox.md").text.includes("已派发载荷"));
  } finally {
    env.cleanup();
  }
});

test("Privacy gate: private:true notes and excludedDirs never leak excerpts or paths", async () => {
  const env = makeVaultEnv({
    "公开/公开资料.md": "# 公开资料\n公开内容可以注入\n",
    "隐私/绝密.md": "---\nprivate: true\n---\n绝密内容不能泄露\n",
    "私密日记/2026_11_19.md": "# 今日日记\n私密日记目录内容不能泄露\n",
  });
  try {
    const p = makePlugin(env);
    p.settings.delegate.excludedDirs = ["私密日记"];
    const text = "- TODO 参考 [[公开资料]]、[[绝密]] 和 [[2026_11_19]]";
    const resolved = await p.delegator.resolveBlockContext({ file: { path: "task.md" }, lines: [text], line: 0 }, "err");
    await p.delegator.enrichPrompt(resolved);
    assert.ok(resolved.prompt.includes("公开内容可以注入"));
    assert.ok(resolved.prompt.includes("公开/公开资料.md"));
    assert.ok(!resolved.prompt.includes("绝密内容不能泄露"));
    assert.ok(!resolved.prompt.includes("隐私/绝密.md"), "private:true note path must not leak");
    assert.ok(!resolved.prompt.includes("私密日记目录内容不能泄露"));
    assert.ok(!resolved.prompt.includes("私密日记/2026_11_19.md"), "excludedDir note path must not leak");
    assert.equal(resolved.bundle.stats.omittedPrivate, 2);
    assert.match(resolved.prompt, /已按隐私设置跳过 2 篇受限笔记/);
  } finally {
    env.cleanup();
  }
});

test("memory-query-core: single technical keyword recalls cleanly, private memories are skipped, and extra YAML colons survive reconcile", () => {
  const entries = [
    { id: "m1", kind: "lesson", type: "项目经验", state: "有效", text: "esbuild 不支持未配置 loader 的 swift 文件" },
    { id: "m2", kind: "fact", type: "事实", state: "有效", private: true, text: "esbuild 私人密钥配置" },
    { id: "m3", kind: "lesson", type: "项目经验", state: "有效", text: "在 RAG 系统里通过设置阈值来拒答" },
  ];
  const picked = M.pickMemories(entries, "查一下 esbuild 打包报错");
  assert.deepEqual(picked.map((e) => e.id), ["m1"], "distinctive technical token recalls while private:true is blocked");
  assert.deepEqual(M.pickMemories(entries, "帮我调整一下设置页的样式"), [], "generic CJK bigram alone still yields zero noise");

  const withColon = "---\nid: m-1\ntitle: \"测试\"\nkind: fact\ntype: 事实\nstate: 有效\ndate: 2026-11-19\nnote: \"a: b\"\n---\n\n测试\n";
  const reconciled = M.reconcileMemoryFile(withColon, { today: "2026-11-19" });
  assert.ok(reconciled.includes('note: "a: b"'), "extra scalar containing ': ' is safely re-quoted");
});

test("Main fixes: writeVaultFile creates missing folders, writeWorkbenchTasks has no ReferenceError, openMemoryBoard opens pre-migration, and applyReply syncs replyInbox", async () => {
  const env = makeVaultEnv({
    "todo.md": "- TODO 拆分登录模块 ^ad-parent\n- TODO 原问题 ^ad-qtask\n  - ❓ 第1轮：用 A 还是 B？ ^ad-q1\n",
  });
  try {
    const p = makePlugin(env);
    // 1. writeVaultFile works when Agent Deck/任务 does not exist yet
    await p.writeVaultFile("Agent Deck/任务/2026-11-19-plan.md", "# 计划\n");
    assert.ok(env.files.has("Agent Deck/任务/2026-11-19-plan.md"));

    // 2. refreshWorkbenchNote works on a fresh vault without Agent Deck folder
    await p.refreshWorkbenchNote();
    assert.ok(env.files.has("Agent Deck/工作台.md"));

    // 3. writeWorkbenchTasks on existing line does not throw ReferenceError: grp is not defined
    const res = await p.writeWorkbenchTasks({
      path: "todo.md",
      line: 0,
      parentTitle: "拆分登录模块",
      subtasks: [
        { title: "实现接口", agent: "codex", destination: "background" },
        { title: "写单测", agent: "claude", destination: "background" },
      ],
      enableBoard: true,
    });
    assert.equal(res.subtaskLines.length, 2);
    assert.ok(env.files.get("todo.md").text.includes("实现接口"));

    // 4. openMemoryBoard opens before storeMode migration and shows initialize button
    const boardView = new M.MemoryBoardView({}, p);
    await boardView.onOpen();
    assert.ok(boardView.contentEl.all().some((el) => el.text === "初始化 / 迁移记忆库"));
    assert.ok(boardView.contentEl.all().some((el) => el.text === "+ 新建"));
    assert.ok(boardView.contentEl.all().some((el) => el.text === "导入…"));

    // 5. applyReply removes answered question from replyInbox
    const qLine = env.files.get("todo.md").text.split("\n").findIndex((l) => l.includes("^ad-qtask"));
    p.settings.replyInbox = [{ path: "todo.md", blockId: "ad-qtask", questionId: "ad-q1", question: "用 A 还是 B？" }];
    await p.applyReply("todo.md", qLine, { questionText: "用 A 还是 B？", answer: "用 A" });
    assert.equal(p.settings.replyInbox.length, 0);
    assert.ok(env.files.get("todo.md").text.includes("✍️ 答：用 A"));
  } finally {
    env.cleanup();
  }
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
